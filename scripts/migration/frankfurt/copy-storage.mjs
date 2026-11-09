// Kopiowanie plików Storage między projektami Supabase (05-storage.sh, docs/migracja-frankfurt.md).
// Kontenery: ten sam identyfikator, publiczność, limit rozmiaru i dozwolone typy. Pliki: pobranie ze starego,
// zapis w nowym (upsert). Pomija pliki o tej samej ścieżce i rozmiarze — skrypt można uruchamiać wielokrotnie.
import { appendFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const { OLD_URL, OLD_SERVICE_ROLE_KEY, NEW_URL, NEW_SERVICE_ROLE_KEY, LOG_DIR = '.' } = process.env;
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const PRUNE = args.includes('--prune');
const ONLY = (args.find((a) => a.startsWith('--bucket=')) || '').slice('--bucket='.length) || null;
const CONCURRENCY = 6;

if (!OLD_URL || !OLD_SERVICE_ROLE_KEY || !NEW_URL || !NEW_SERVICE_ROLE_KEY) {
  console.error('Brak OLD_URL / OLD_SERVICE_ROLE_KEY / NEW_URL / NEW_SERVICE_ROLE_KEY — uruchom przez 05-storage.sh');
  process.exit(1);
}
if (OLD_URL === NEW_URL) {
  console.error('Stary i nowy projekt to ten sam adres — przerywam.');
  process.exit(1);
}

const options = { auth: { persistSession: false, autoRefreshToken: false } };
const src = createClient(OLD_URL, OLD_SERVICE_ROLE_KEY, options);
const dst = createClient(NEW_URL, NEW_SERVICE_ROLE_KEY, options);
const logFile = `${LOG_DIR}/storage-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
const log = (line) => {
  console.log(line);
  appendFileSync(logFile, `${line}\n`);
};

async function listAll(client, bucket, prefix = '') {
  const files = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await client.storage.from(bucket).list(prefix, { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw new Error(`lista ${bucket}/${prefix}: ${error.message}`);
    for (const entry of data || []) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null) files.push(...(await listAll(client, bucket, path)));
      else files.push({ path, size: entry.metadata?.size ?? null, mimetype: entry.metadata?.mimetype ?? null, cacheControl: entry.metadata?.cacheControl ?? null });
    }
    if (!data || data.length < 1000) break;
  }
  return files;
}

async function withRetry(label, fn, attempts = 3) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= attempts) throw new Error(`${label}: ${error.message || error}`);
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
}

async function pool(items, size, worker) {
  let next = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await worker(item);
    }
  }));
}

async function ensureBucket(bucket, existing) {
  const settings = {
    public: bucket.public,
    fileSizeLimit: bucket.file_size_limit ?? null,
    allowedMimeTypes: bucket.allowed_mime_types ?? null,
  };
  if (DRY) return;
  const { error } = existing.has(bucket.id)
    ? await dst.storage.updateBucket(bucket.id, settings)
    : await dst.storage.createBucket(bucket.id, settings);
  if (error) throw new Error(`kontener ${bucket.id}: ${error.message}`);
}

const { data: srcBuckets, error: srcError } = await src.storage.listBuckets();
if (srcError) throw new Error(`stary projekt: ${srcError.message}`);
const { data: dstBuckets, error: dstError } = await dst.storage.listBuckets();
if (dstError) throw new Error(`nowy projekt: ${dstError.message}`);
const existing = new Set((dstBuckets || []).map((bucket) => bucket.id));

const totals = { copied: 0, skipped: 0, failed: 0, removed: 0, bytes: 0 };
log(`${DRY ? '[próba] ' : ''}Kontenery: ${srcBuckets.length}${ONLY ? ` (tylko ${ONLY})` : ''} → log ${logFile}`);

for (const bucket of srcBuckets) {
  if (ONLY && bucket.id !== ONLY) continue;
  await ensureBucket(bucket, existing);
  const files = await listAll(src, bucket.id);
  const present = existing.has(bucket.id) ? await listAll(dst, bucket.id) : [];
  const presentSize = new Map(present.map((file) => [file.path, file.size]));
  const todo = files.filter((file) => presentSize.get(file.path) !== file.size || file.size === null);
  const stats = { copied: 0, skipped: files.length - todo.length, failed: 0, removed: 0 };

  if (!DRY) {
    await pool(todo, CONCURRENCY, async (file) => {
      try {
        const blob = await withRetry(`pobranie ${bucket.id}/${file.path}`, async () => {
          const { data, error } = await src.storage.from(bucket.id).download(file.path);
          if (error) throw error;
          return data;
        });
        await withRetry(`zapis ${bucket.id}/${file.path}`, async () => {
          const { error } = await dst.storage.from(bucket.id).upload(file.path, blob, {
            upsert: true,
            contentType: file.mimetype || blob.type || undefined,
            cacheControl: String(file.cacheControl || '').replace(/^max-age=/, '') || '3600',
          });
          if (error) throw error;
        });
        stats.copied += 1;
        totals.bytes += file.size || blob.size || 0;
      } catch (error) {
        stats.failed += 1;
        log(`  BŁĄD ${error.message}`);
      }
    });
  } else {
    stats.copied = todo.length;
    totals.bytes += todo.reduce((sum, file) => sum + (file.size || 0), 0);
  }

  if (PRUNE) {
    const sourcePaths = new Set(files.map((file) => file.path));
    const extra = present.filter((file) => !sourcePaths.has(file.path)).map((file) => file.path);
    for (let i = 0; i < extra.length && !DRY; i += 100) {
      const { error } = await dst.storage.from(bucket.id).remove(extra.slice(i, i + 100));
      if (error) log(`  BŁĄD usuwania w ${bucket.id}: ${error.message}`);
    }
    stats.removed = extra.length;
  }

  log(`${bucket.id}${bucket.public ? ' (publiczny)' : ''}: plików ${files.length}, ${DRY ? 'do skopiowania' : 'skopiowano'} ${stats.copied}, bez zmian ${stats.skipped}, błędy ${stats.failed}${PRUNE ? `, ${DRY ? 'do usunięcia' : 'usunięto'} ${stats.removed}` : ''}`);
  for (const key of ['copied', 'skipped', 'failed', 'removed']) totals[key] += stats[key];
}

log(`Razem: ${DRY ? 'do skopiowania' : 'skopiowano'} ${totals.copied} (${(totals.bytes / 1048576).toFixed(0)} MB), bez zmian ${totals.skipped}, błędy ${totals.failed}${PRUNE ? `, usunięte ${totals.removed}` : ''}`);
if (totals.failed > 0) process.exit(1);
