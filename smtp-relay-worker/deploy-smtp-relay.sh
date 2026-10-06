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
  "${SCRIPT_DIR}/imap-attachments.js" \
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
const config = require('dotenv').parse(fs.readFileSync('.env'));
const port = Number(config.PORT || 3005);
const { spawnSync } = require('node:child_process');
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
        console.log('Worker gotowy do pobierania załączników.');
        return;
      }
    } catch {}
    await delay(1000);
  }
  console.error('Worker nie potwierdził obsługi załączników. Wdrożenie przerwane.');
  process.exitCode = 1;
})();
NODE
"

echo "SMTP Relay Worker wdrożony."
