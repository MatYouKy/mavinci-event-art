#!/usr/bin/env node
// Explicit allowlist. Server credentials never enter the application bundle.
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const root = path.resolve(__dirname, '../../..');
const env = {};
const files = process.argv[2] ? [path.resolve(process.argv[2])] : [path.join(root, '.env'), path.join(root, 'mobile/.env'), path.join(root, 'mobile/.env.local')];
for (const file of files) {
  if (fs.existsSync(file)) Object.assign(env, dotenv.parse(fs.readFileSync(file)));
}
const url = env.EXPO_PUBLIC_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || '';
const publicKey = env.EXPO_PUBLIC_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || '';
let validKey = publicKey.startsWith('sb_publishable_');
if (!validKey && publicKey.split('.').length === 3) {
  try { validKey = JSON.parse(Buffer.from(publicKey.split('.')[1], 'base64url').toString()).role === 'anon'; } catch { }
}
try {
  const address = new URL(url);
  if (address.protocol !== 'https:' || address.username || address.password || address.search || address.hash || !validKey) throw new Error();
} catch {
  console.error('Brak poprawnego adresu HTTPS lub publicznego klucza anon/publishable. Konfiguracja nie została zapisana.');
  process.exit(1);
}
const target = path.join(__dirname, '../Resources/Configuration.json');
fs.writeFileSync(target, JSON.stringify({provider:'supabase',url,publicKey}, null, 2) + '\n', {mode:0o600});
fs.chmodSync(target, 0o600);
console.log('Zaimportowano wyłącznie publiczny adres Supabase i publiczny klucz aplikacji.');
