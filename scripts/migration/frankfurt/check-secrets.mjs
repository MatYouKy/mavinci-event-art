// Porównanie sekretów z functions.env ze starym projektem po skrótach SHA-256 (supabase secrets list pokazuje skrót,
// nie wartość). Wartości nie są nigdzie wypisywane. Użycie: node check-secrets.mjs <functions.env> <secrets-old.json>
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const [envPath, oldPath] = process.argv.slice(2);
const parseEnv = (text) => Object.fromEntries(text.split('\n')
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#') && line.includes('='))
  .map((line) => {
    const index = line.indexOf('=');
    let value = line.slice(index + 1).trim();
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    return [line.slice(0, index).trim(), value];
  }));

const local = parseEnv(readFileSync(envPath, 'utf8'));
let old = [];
try {
  const parsed = JSON.parse(readFileSync(oldPath, 'utf8'));
  old = Array.isArray(parsed) ? parsed : [];
} catch {
  console.log('(nie udało się odczytać listy sekretów starego projektu — pomijam porównanie)');
}
const oldDigest = new Map(old.map((item) => [item.name, String(item.value || item.digest || '').toLowerCase()]));
const sha = (value) => createHash('sha256').update(value).digest('hex');

console.log('Sekret                            Twoja wartość   Stary projekt');
for (const [name, value] of Object.entries(local)) {
  const digest = oldDigest.get(name);
  const mine = value ? 'wpisana' : 'pusta';
  let state = digest === undefined ? 'nie było' : 'ustawiony';
  if (value && digest) state = digest === sha(value) ? 'TA SAMA ✓' : 'INNA';
  console.log(`${name.padEnd(34)}${mine.padEnd(16)}${state}`);
}
const missing = [...oldDigest.keys()].filter((name) => !(name in local) && !name.startsWith('SUPABASE_') && !name.startsWith('NEXT_PUBLIC_'));
if (missing.length) console.log(`W starym projekcie są też: ${missing.join(', ')} — dopisz je do functions.env, jeśli są potrzebne.`);
