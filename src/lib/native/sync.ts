import 'server-only';
import { createHash } from 'node:crypto';
import type { NativeContext } from './auth';
import { nativeSectionMetas, nativeSets } from './sets';

/*
 * Synchronizacja aplikacji natywnej (jak Wodami, piastpol `src/lib/sync.ts`) — serwer jest jedynym źródłem prawdy, aplikacja trzyma
 * lokalną kopię zbiorów i pobiera tylko to, co się zmieniło. Każdy zbiór dzielimy na koszyki (16 albo 256, według skrótu id).
 * Aplikacja wysyła skrót całego zbioru; gdy się różni, dostaje skróty koszyków i pobiera wyłącznie koszyki o innym skrócie (także usunięcia).
 * Porównujemy treść kart, nie `updated_at` — żadna zmiana (także uprawnień i powiązanych rekordów) nie umknie.
 */

type Item = { id: string; item: Record<string, unknown> };
type Bucket = { hash: string; items: Item[] };
type Snapshot = { hash: string; count: number; width: number; buckets: Map<string, Bucket> };

const digest = (value: string) => createHash('sha1').update(value).digest('hex').slice(0, 16);
const cache = new Map<string, { at: number; snapshot: Promise<Snapshot> }>();
const ttl = 10_000;

async function build(ctx: NativeContext, load: (ctx: NativeContext) => Promise<Item[]>): Promise<Snapshot> {
  const items = await load(ctx);
  const width = items.length > 400 ? 2 : 1;
  const buckets = new Map<string, Bucket & { parts: string[] }>();
  for (const row of items) {
    const key = digest(row.id).slice(0, width);
    const bucket = buckets.get(key) || { hash: '', items: [], parts: [] };
    bucket.items.push(row);
    bucket.parts.push(`${row.id}:${digest(JSON.stringify(row.item))}`);
    buckets.set(key, bucket);
  }
  const done = new Map<string, Bucket>();
  for (const [key, bucket] of [...buckets].sort(([a], [b]) => (a < b ? -1 : 1))) {
    bucket.parts.sort();
    done.set(key, { hash: digest(bucket.parts.join('|')), items: bucket.items });
  }
  return { hash: digest(`w${width}|` + [...done].map(([k, v]) => `${k}:${v.hash}`).join('|')), count: items.length, width, buckets: done };
}

/** Migawka zbioru dla pracownika — współdzielona przez kilka sekund między krokami jednej synchronizacji. */
function snapshot(ctx: NativeContext, name: string, load: (ctx: NativeContext) => Promise<Item[]>) {
  const key = `${ctx.employee.id}:${ctx.client}:${name}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.snapshot;
  const entry = { at: Date.now(), snapshot: build(ctx, load) };
  entry.snapshot.catch(() => cache.delete(key));
  cache.set(key, entry);
  if (cache.size > 500) for (const [k, v] of cache) if (Date.now() - v.at > ttl) cache.delete(k);
  return entry.snapshot;
}

/** Po zapisie z aplikacji kolejna synchronizacja ma od razu widzieć zmianę. */
export function invalidateNativeSync(names?: string[]) {
  for (const key of [...cache.keys()]) if (!names || names.some((n) => key.endsWith(`:${n}`))) cache.delete(key);
}

/** Zbiory nazwane prefiksem (np. tablice zadań wydarzeń `tasks-event-…`) — klucz to `pracownik:klient:nazwa`. */
export function invalidateNativeSyncPrefix(prefix: string) {
  for (const key of [...cache.keys()]) if (key.split(':').slice(2).join(':').startsWith(prefix)) cache.delete(key);
}

function allSets(ctx: NativeContext) {
  const sets = nativeSets.filter((s) => s.allowed(ctx.employee));
  const sections = {
    name: 'sections',
    allowed: () => true,
    load: async (c: NativeContext) => nativeSectionMetas(c).map((m) => ({ id: m.id, item: m as unknown as Record<string, unknown> })),
  };
  return [sections, ...sets];
}

/** Krok 1: skróty zbiorów; dla zbiorów, których skrót u klienta jest inny — skróty koszyków. Błąd jednego zbioru nie zatrzymuje pozostałych. */
export async function nativeSyncState(ctx: NativeContext, client: Record<string, { hash?: string }>, only?: string[]) {
  const out: Record<string, { hash: string; count: number; width: number; buckets?: Record<string, string> }> = {};
  const failed: string[] = [];
  for (const def of allSets(ctx).filter((s) => !only?.length || only.includes(s.name))) {
    let snap: Snapshot;
    try {
      snap = await snapshot(ctx, def.name, def.load);
    } catch (error) {
      failed.push(def.name);
      console.error('[native-sync]', def.name, error instanceof Error ? error.message : error);
      continue;
    }
    const local = client?.[def.name]?.hash;
    out[def.name] = {
      hash: snap.hash, count: snap.count, width: snap.width,
      ...(local === snap.hash ? {} : { buckets: Object.fromEntries([...snap.buckets].map(([k, v]) => [k, v.hash])) }),
    };
  }
  return {
    serverTime: new Date().toISOString(),
    complete: !only?.length && !failed.length,
    ...(failed.length ? { failed } : {}),
    sets: out,
    permissions: {},
  };
}

/** Krok 2: pełna zawartość wskazanych koszyków (pusta lista = koszyk zniknął). Najwyżej ok. 3000 pozycji na odpowiedź — reszta w `more`. */
export async function nativeSyncItems(ctx: NativeContext, name: string, requested: unknown[]) {
  const def = allSets(ctx).find((s) => s.name === name);
  if (!def) return null;
  return collectionItems(ctx, def.name, def.load, requested);
}

type Loader = (ctx: NativeContext) => Promise<Item[]>;

/**
 * Ten sam mechanizm dla zbiorów spoza rejestru kart (np. kopia Wiadomości): skrót zbioru, a gdy u klienta jest inny — skróty koszyków.
 * Koszyk pozycji = pierwsze 1–2 znaki `sha1(id)` (szerokość w odpowiedzi), więc klient może sam przypisać pozycję do koszyka.
 */
export async function collectionState(ctx: NativeContext, name: string, load: Loader, localHash?: string) {
  const snap = await snapshot(ctx, name, load);
  return {
    hash: snap.hash, count: snap.count, width: snap.width,
    ...(localHash === snap.hash ? {} : { buckets: Object.fromEntries([...snap.buckets].map(([k, v]) => [k, v.hash])) }),
  };
}

export async function collectionItems(ctx: NativeContext, name: string, load: Loader, requested: unknown[]) {
  const snap = await snapshot(ctx, name, load);
  const buckets: Record<string, { hash: string; items: unknown[] }> = {};
  const more: string[] = [];
  let size = 0;
  for (const key of [...new Set(requested.filter((v): v is string => typeof v === 'string' && /^[0-9a-f]{1,2}$/.test(v)))]) {
    const bucket = snap.buckets.get(key);
    if (size > 3000) { more.push(key); continue; }
    buckets[key] = bucket ? { hash: bucket.hash, items: bucket.items.map((i) => i.item) } : { hash: '', items: [] };
    size += bucket?.items.length || 0;
  }
  return { set: name, hash: snap.hash, width: snap.width, buckets, more };
}
