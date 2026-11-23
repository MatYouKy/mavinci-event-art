#!/usr/bin/env node
// Połączenie wbudowane w program Mavinci — uruchamia scripts/build-app.sh przed kompilacją.
//
// Czyta Resources/Configuration.json (poza gitem; tworzy go scripts/import-env.cjs) i zapisuje
// Sources/Mavinci/EmbeddedConnection.generated.swift (poza gitem): tylko źródło danych, adres serwera, publiczny klucz aplikacji
// i adres CRM, jako bajty JSON zamaskowane losowym kluczem (w programie nie ma czytelnego adresu ani klucza, w pakiecie — pliku
// konfiguracji). Ten sam plik źródłowy nie zmienia wygenerowanego pliku (bez zbędnej kompilacji). Nie wypisuje żadnych wartości.
//
// Kod wyjścia: 0 — połączenie gotowe do wbudowania, 2 — brak Resources/Configuration.json, 1 — konfiguracja niepoprawna.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const source = path.join(__dirname, '../Resources/Configuration.json');
const target = path.join(__dirname, '../Sources/Mavinci/EmbeddedConnection.generated.swift');

if (!fs.existsSync(source)) process.exit(2);

function fail(message) {
  console.error(`Resources/Configuration.json: ${message} Połączenie nie zostało wbudowane.`);
  process.exit(1);
}

let config;
try {
  config = JSON.parse(fs.readFileSync(source, 'utf8'));
} catch {
  fail('plik nie jest poprawnym JSON-em.');
}
if (!config || typeof config !== 'object') fail('oczekiwano obiektu JSON.');

// Te same reguły co `Connection.valid` / `Connection.crm` w Configuration.swift.
const local = (host) => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(host);
function address(value, field) {
  if (typeof value !== 'string' || !value.trim()) fail(`brak pola „${field}”.`);
  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    fail(`pole „${field}” nie jest adresem.`);
  }
  const secure = parsed.protocol === 'https:' || (parsed.protocol === 'http:' && local(parsed.hostname));
  if (!secure || !parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash) {
    fail(`pole „${field}” musi być adresem HTTPS (HTTP tylko dla localhost), bez loginu, parametrów i kotwicy.`);
  }
  return value.trim();
}

const provider = config.provider === undefined ? 'supabase' : config.provider;
if (provider !== 'supabase' && provider !== 'server') fail('pole „provider” musi mieć wartość „supabase” albo „server”.');
const url = address(config.url, 'url');
const publicKey = typeof config.publicKey === 'string' ? config.publicKey.trim() : '';
if (provider === 'supabase') {
  // Wyłącznie klucz publiczny: publishable albo JWT z rolą anon (nigdy service_role ani klucz sekretny).
  let valid = publicKey.startsWith('sb_publishable_');
  if (!valid && publicKey.split('.').length === 3) {
    try {
      valid = JSON.parse(Buffer.from(publicKey.split('.')[1], 'base64url').toString()).role === 'anon';
    } catch {
      valid = false;
    }
  }
  if (!valid) fail('pole „publicKey” musi być publicznym kluczem aplikacji (anon albo sb_publishable_).');
}
const clean = { provider, url, publicKey };
if (config.crmURL !== undefined && config.crmURL !== null && config.crmURL !== '') clean.crmURL = address(config.crmURL, 'crmURL');

const json = Buffer.from(JSON.stringify(clean), 'utf8');
const fingerprint = crypto.createHash('sha256').update(json).digest('hex').slice(0, 16);
const marker = `// Odcisk konfiguracji: ${fingerprint}`;
if (fs.existsSync(target) && fs.readFileSync(target, 'utf8').includes(marker)) process.exit(0);

const mask = crypto.randomBytes(json.length);
const payload = Buffer.alloc(json.length);
for (let i = 0; i < json.length; i += 1) payload[i] = json[i] ^ mask[i];
const rows = (bytes) => {
  const hex = Array.from(bytes, (byte) => `0x${byte.toString(16).padStart(2, '0')}`);
  const lines = [];
  for (let i = 0; i < hex.length; i += 16) lines.push(`        ${hex.slice(i, i + 16).join(', ')},`);
  return lines.join('\n');
};
const swift = `// Wygenerowane przez scripts/embed-connection.cjs z Resources/Configuration.json — nie edytuj i nie dodawaj do gita.
${marker}

#if MAVINCI_EMBEDDED_CONNECTION
enum EmbeddedConnectionData {
    static let payload: [UInt8] = [
${rows(payload)}
    ]
    static let mask: [UInt8] = [
${rows(mask)}
    ]
}
#endif
`;
fs.writeFileSync(target, swift, { mode: 0o600 });
fs.chmodSync(target, 0o600);
