#!/usr/bin/env node
/**
 * Porównuje lokalne migracje z listą wersji zastosowanych w bazie.
 *
 * 1. W Supabase SQL Editor uruchom zapytanie z pliku scripts/migration-status.sql
 *    (sekcja 1) i zapisz wynik — jedna wersja w wierszu — do pliku, np. applied.txt.
 *    Migracje wklejane ręcznie w SQL Editor NIE trafiają do tabeli schema_migrations;
 *    dla nich użyj sekcji 2 tego samego pliku (kontrola obiektów).
 * 2. Uruchom:  node scripts/check-migration-status.mjs applied.txt
 *
 * Skrypt niczego nie zmienia w bazie ani w repozytorium.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = join(root, 'supabase', 'migrations');
const appliedFile = process.argv[2];

if (!appliedFile) {
  console.error('Użycie: node scripts/check-migration-status.mjs <plik-z-wersjami>');
  process.exit(1);
}

const applied = new Set(
  readFileSync(appliedFile, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim().match(/^(\d{8,14})/)?.[1])
    .filter(Boolean),
);

const local = readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => ({ name, version: name.match(/^(\d{8,14})/)?.[1] ?? null }));

const missing = local.filter((item) => item.version && !applied.has(item.version));
const unknownRemote = [...applied].filter((version) => !local.some((item) => item.version === version));

console.log(`Lokalnie: ${local.length} migracji, w bazie: ${applied.size} wersji.`);
console.log(`\nNiezastosowane w bazie (${missing.length}):`);
for (const item of missing) console.log(`  ${item.name}`);
if (unknownRemote.length) {
  console.log(`\nW bazie, ale bez pliku lokalnie (${unknownRemote.length}):`);
  for (const version of unknownRemote) console.log(`  ${version}`);
}
