// Start the development app and its local IMAP relay together. No VPS secrets are copied.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const dotenv = require('dotenv');
const root = path.resolve(__dirname, '..');
const workerDir = path.join(root, 'smtp-relay-worker');
const readEnv = (file) => fs.existsSync(file) ? dotenv.parse(fs.readFileSync(file)) : {};
const development = Object.assign({}, ...['.env', '.env.development', '.env.local', '.env.development.local'].map((file) => readEnv(path.join(root, file))), process.env);
let next;
let worker;
let stopping = false;

function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  if (next && next.exitCode === null) next.kill('SIGTERM');
  if (worker && worker.exitCode === null) worker.kill('SIGTERM');
  process.exitCode = code;
  const deadline = setTimeout(() => {
    if (next && next.exitCode === null) next.kill('SIGKILL');
    if (worker && worker.exitCode === null) worker.kill('SIGKILL');
  }, 5000);
  deadline.unref();
}
process.on('SIGINT', () => shutdown(130));
process.on('SIGTERM', () => shutdown(143));

async function relayReady(url, secret) {
  let response;
  try { response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1000) }); }
  catch { return false; }
  const health = await response.json().catch(() => null);
  if (!response.ok || health?.service !== 'smtp-relay-worker' || !health.capabilities?.includes('imap-attachments-v1')) {
    throw new Error('Port lokalnego workera jest zajęty przez inną usługę lub starszą wersję workera.');
  }
  // An invalid request verifies the shared secret without contacting any mailbox.
  const auth = await fetch(`${url}/api/imap/attachments`, {
    method: 'POST', signal: AbortSignal.timeout(1000),
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' }, body: '{}',
  });
  const result = await auth.json().catch(() => null);
  if (auth.status !== 400 || result?.code !== 'INVALID_REQUEST') {
    throw new Error('Uruchomiony lokalny worker używa innej konfiguracji. Zatrzymaj go przed uruchomieniem yarn dev.');
  }
  return true;
}

async function main() {
  let relayUrl = development.IMAP_ATTACHMENT_RELAY_URL || development.SMTP_RELAY_URL;
  let secret = development.IMAP_ATTACHMENT_RELAY_SECRET || development.SMTP_RELAY_SECRET;
  if (Boolean(relayUrl) !== Boolean(secret)) throw new Error('Uzupełnij zarówno adres, jak i sekret skonfigurowanego workera.');
  if (!relayUrl) {
    const local = readEnv(path.join(workerDir, '.env'));
    const port = Number(local.PORT || 3005);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Nieprawidłowy port lokalnego workera.');
    secret = local.RELAY_SECRET || randomBytes(32).toString('hex');
    relayUrl = `http://127.0.0.1:${port}`;
    if (!await relayReady(relayUrl, secret)) {
      if (stopping) return;
      worker = spawn(process.execPath, ['server.js'], {
        cwd: workerDir, stdio: 'inherit',
        env: { ...process.env, ...local, PORT: String(port), RELAY_SECRET: secret, RELAY_HOST: '127.0.0.1' },
      });
      worker.on('error', () => { console.error('Nie udało się uruchomić lokalnego workera.'); shutdown(1); });
      worker.on('exit', (code) => {
        if (!stopping) { console.error('Lokalny worker zakończył działanie.'); shutdown(code || 1); }
      });
      let ready = false;
      for (let attempt = 0; attempt < 20 && !stopping; attempt++) {
        if (await relayReady(relayUrl, secret)) { ready = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (stopping) return;
      if (!ready) throw new Error('Lokalny worker nie uruchomił się. Sprawdź jego zależności w smtp-relay-worker.');
    }
    console.log('Lokalne pobieranie załączników jest gotowe.');
  }
  if (stopping) return;
  next = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', ...process.argv.slice(2)], {
    cwd: root, stdio: 'inherit',
    env: { ...process.env, IMAP_ATTACHMENT_RELAY_URL: relayUrl, IMAP_ATTACHMENT_RELAY_SECRET: secret },
  });
  next.on('error', () => { console.error('Nie udało się uruchomić Next.js.'); shutdown(1); });
  next.on('exit', (code) => shutdown(code || 0));
}
main().catch((error) => { console.error(error.message); shutdown(1); });
