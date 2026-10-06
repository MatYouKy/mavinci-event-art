// Run on the VPS by deploy.sh. Secrets remain on the server and are never printed.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const dotenv = require('dotenv');

function readEnvironment(filename) {
  return fs.existsSync(filename) ? dotenv.parse(fs.readFileSync(filename)) : {};
}

function readApplicationEnvironment(appName) {
  try {
    const applications = JSON.parse(execFileSync('pm2', ['jlist'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000, maxBuffer: 8 * 1024 * 1024,
    }));
    const application = applications.find((entry) => entry.name === appName);
    if (!application) return {};
    return { ...application.pm2_env?.env, ...application.pm2_env };
  } catch {
    // execFileSync errors can contain captured process environments. Never print them.
    throw new Error('Nie udało się odczytać konfiguracji aplikacji z PM2.');
  }
}

try {
  const frontendDir = process.argv[2];
  const appName = process.argv[3] || 'frontend-mavinci';
  const checkOnly = process.argv.includes('--check');
  if (!frontendDir || !path.isAbsolute(frontendDir)) throw new Error('Brak katalogu aplikacji.');
  const frontend = readEnvironment(path.join(frontendDir, '.env'));
  const relay = readEnvironment(path.join(__dirname, '.env'));
  // The running application's service key may be managed by PM2 rather than a dotenv file.
  // Consult only this named app, never another worker or an unrelated Supabase project.
  let serviceKey = frontend.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  let keySource = frontend.SUPABASE_SERVICE_ROLE_KEY ? 'plik .env aplikacji' : 'środowisko procesu';
  if (!serviceKey) {
    serviceKey = readApplicationEnvironment(appName).SUPABASE_SERVICE_ROLE_KEY;
    keySource = 'konfiguracja PM2 aplikacji';
  }
  if (!serviceKey) throw new Error('Brak SUPABASE_SERVICE_ROLE_KEY w pliku .env, środowisku procesu i konfiguracji PM2 aplikacji.');
  if (!relay.RELAY_SECRET) throw new Error('Brak RELAY_SECRET w konfiguracji workera.');
  const port = Number(relay.PORT || 3005);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Nieprawidłowy port workera.');
  if (checkOnly) {
    console.log(`Konfiguracja załączników dostępna. Źródło klucza: ${keySource}. Nie zapisano zmian.`);
  } else {
    const quote = (value) => "'" + value.replace(/'/g, "'\\''") + "'";
    const target = path.join(frontendDir, '.env.imap-attachments');
    // Pass the existing key explicitly to the app restart; startOrReload may replace PM2's env.
    const contents = `IMAP_ATTACHMENT_RELAY_URL=${quote(`http://127.0.0.1:${port}`)}\nIMAP_ATTACHMENT_RELAY_SECRET=${quote(relay.RELAY_SECRET)}\nSUPABASE_SERVICE_ROLE_KEY=${quote(serviceKey)}\n`;
    const temporary = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, contents, { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, target);
    console.log(`Konfiguracja pobierania załączników przygotowana na serwerze. Źródło klucza: ${keySource}.`);
  }
} catch (error) {
  console.error('Nie udało się przygotować konfiguracji załączników:', error.code || error.message);
  process.exit(1);
}
