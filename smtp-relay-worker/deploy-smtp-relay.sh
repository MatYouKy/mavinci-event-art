#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REMOTE="${MAVINCI_DEPLOY_REMOTE:-root@185.235.68.130}"
REMOTE_DIR="/var/www/mavinci/smtp-relay-worker"
NODE_BIN="/root/.nvm/versions/node/v20.11.0/bin"

echo "Wysyłam SMTP Relay Worker wraz z obsługą załączników…"
ssh "$REMOTE" "mkdir -p '${REMOTE_DIR}'"
# Do not copy macOS node_modules or overwrite server secrets/logs.
rsync -avz \
  "${SCRIPT_DIR}/server.js" \
  "${SCRIPT_DIR}/sent-copy.js" \
  "${SCRIPT_DIR}/brochure-attachments.js" \
  "${SCRIPT_DIR}/imap-attachments.js" \
  "${SCRIPT_DIR}/imap-trash.js" \
  "${SCRIPT_DIR}/configure-attachments-env.cjs" \
  "${SCRIPT_DIR}/package.json" \
  "${SCRIPT_DIR}/yarn.lock" \
  "${REMOTE}:${REMOTE_DIR}/"

ssh "$REMOTE" "
  set -e
  export PATH='${NODE_BIN}':\$PATH
  cd '${REMOTE_DIR}'
  test -f .env || { echo 'Brak konfiguracji .env workera na serwerze.'; exit 1; }
  # Node 20.11 can stall in io_uring during file linking on some Linux kernels.
  # Use the thread-pool filesystem backend only for this dependency installation.
  if command -v yarn >/dev/null 2>&1; then
    UV_USE_IO_URING=0 yarn install --production --frozen-lockfile --non-interactive
  else
    UV_USE_IO_URING=0 corepack yarn@1.22.22 install --production --frozen-lockfile --non-interactive
  fi
  node --input-type=commonjs - <<'NODE'
const fs = require('node:fs');
const dotenv = require('dotenv');
const originalEnvironment = fs.readFileSync('.env', 'utf8');
const config = dotenv.parse(originalEnvironment);
const port = Number(config.PORT || 3005);
const { spawnSync } = require('node:child_process');
if (!config.RELAY_SECRET) {
  console.error('Brak RELAY_SECRET w konfiguracji workera. Nie restartuję usługi.');
  process.exit(1);
}
// Copy only the PUBLIC project URL from the existing application environment.
// Never replace relay credentials or copy the application's service-role key.
if (!config.SUPABASE_URL) {
  const frontendEnvPath = '/var/www/mavinci/frontend/.env';
  const frontend = fs.existsSync(frontendEnvPath)
    ? dotenv.parse(fs.readFileSync(frontendEnvPath)) : {};
  let projectUrl = frontend.NEXT_PUBLIC_SUPABASE_URL || frontend.SUPABASE_URL;
  if (!projectUrl) {
    const processList = spawnSync('pm2', ['jlist'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000,
      maxBuffer: 8 * 1024 * 1024,
    });
    if (processList.status === 0) {
      try {
        const frontendProcess = JSON.parse(processList.stdout)
          .find((entry) => entry.name === 'frontend-mavinci');
        const frontendEnvironment = { ...frontendProcess?.pm2_env?.env, ...frontendProcess?.pm2_env };
        projectUrl = frontendEnvironment.NEXT_PUBLIC_SUPABASE_URL || frontendEnvironment.SUPABASE_URL;
      } catch {
        // PM2 output contains credentials: never print it, even on failure.
      }
    }
  }
  if (projectUrl) config.SUPABASE_URL = projectUrl;
}
try {
  const projectUrl = new URL(config.SUPABASE_URL || '');
  if (projectUrl.protocol !== 'https:' || projectUrl.username || projectUrl.password || projectUrl.port
    || !/^[a-z0-9-]+\.supabase\.co$/.test(projectUrl.hostname)) throw new Error('Invalid URL');
  config.SUPABASE_URL = projectUrl.origin;
} catch {
  console.error('Ustaw SUPABASE_URL w .env workera na publiczny adres projektu Supabase. Nie restartuję usługi.');
  process.exit(1);
}
if (!dotenv.parse(originalEnvironment).SUPABASE_URL) {
  const backup = '.env.before-brochure-' + Date.now();
  fs.writeFileSync(backup, originalEnvironment, { mode: 0o600, flag: 'wx' });
  const temporary = '.env.brochure-' + process.pid + '.tmp';
  fs.writeFileSync(temporary, originalEnvironment.replace(/\s*$/, '') + '\nSUPABASE_URL=' + config.SUPABASE_URL + '\n',
    { mode: 0o600, flag: 'wx' });
  fs.renameSync(temporary, '.env');
  console.log('Uzupełniono publiczny adres projektu Supabase. Pozostała konfiguracja bez zmian; zachowano kopię .env.');
}
const exists = spawnSync('pm2', ['describe', 'smtp-relay-worker'], { stdio: 'ignore' }).status === 0;
const args = exists
  ? ['restart', 'smtp-relay-worker', '--update-env']
  : ['start', 'server.js', '--name', 'smtp-relay-worker', '--cwd', process.cwd()];
// Refresh PM2's saved credentials from the server .env without putting secrets in arguments.
if (spawnSync('pm2', args, { stdio: 'inherit', env: { ...process.env, ...config } }).status !== 0) process.exit(1);
if (spawnSync('pm2', ['save'], { stdio: 'inherit' }).status !== 0) process.exit(1);
const { setTimeout: delay } = require('node:timers/promises');
(async () => {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const response = await fetch('http://127.0.0.1:' + port + '/health', { signal: AbortSignal.timeout(3000) });
      const health = await response.json();
      if (response.ok && health.capabilities?.includes('imap-attachments-v1')) {
        const capabilityResponse = await fetch('http://127.0.0.1:' + port + '/api/capabilities', {
          headers: { Authorization: 'Bearer ' + config.RELAY_SECRET },
          signal: AbortSignal.timeout(3000),
        });
        const capabilities = await capabilityResponse.json();
        if (capabilityResponse.ok && capabilities.brochureStorageAttachments === 1
          && capabilities.brochureStorageConfigured === true) {
          console.log('Worker gotowy do pobierania załączników i wysyłania zapisanych broszur.');
          return;
        }
      }
    } catch {}
    await delay(1000);
  }
  console.error('Worker nie potwierdził obsługi załączników i zapisanych broszur. Wdrożenie nie zostało ukończone.');
  process.exitCode = 1;
})();
NODE
"

echo "SMTP Relay Worker wdrożony."
