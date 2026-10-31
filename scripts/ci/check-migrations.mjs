#!/usr/bin/env node
/**
 * Kontrola nazw migracji Supabase.
 * - Nowe migracje (od 20261031000000) muszą mieć format YYYYMMDDHHMMSS_nazwa.sql i unikalną wersję.
 * - Starsze duplikaty wersji są tylko raportowane (supabase db push wymaga unikalnych wersji).
 */
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const STRICT_FROM = '20261031000000';
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'supabase', 'migrations');
const files = readdirSync(dir).filter((name) => name.endsWith('.sql')).sort();
const byVersion = new Map();
let failed = false;

for (const name of files) {
  const version = name.match(/^(\d+)_/)?.[1] ?? name;
  byVersion.set(version, [...(byVersion.get(version) || []), name]);
  if (version >= STRICT_FROM && !/^\d{14}_[a-z0-9_]+\.sql$/.test(name)) {
    console.error(`::error file=supabase/migrations/${name}::Nazwa migracji musi mieć format YYYYMMDDHHMMSS_nazwa.sql`);
    failed = true;
  }
}

const legacy = [];
for (const [version, names] of byVersion) {
  if (names.length < 2) continue;
  if (version >= STRICT_FROM) {
    console.error(`::error::Zduplikowana wersja migracji ${version}: ${names.join(', ')}`);
    failed = true;
  } else {
    legacy.push(`${version}: ${names.join(', ')}`);
  }
}

if (legacy.length) {
  console.log(`::warning::${legacy.length} starszych wersji migracji jest zduplikowanych (supabase db push ich nie przyjmie):`);
  for (const line of legacy) console.log(`  ${line}`);
}
console.log(`Sprawdzono ${files.length} migracji.`);
process.exit(failed ? 1 : 0);
