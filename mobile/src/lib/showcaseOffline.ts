import * as FileSystem from 'expo-file-system/legacy';
import { showcaseVisibleForMe, type ShowcaseHome, type ShowcaseItemDetail, type ShowcaseUrls } from './showcaseShared';

/*
 * Prezentacje w pamięci urządzenia (telefon, iPad): lista działów i kart, treść każdej karty widocznej w układzie pracownika
 * i wszystkie jej zdjęcia (pełne i miniatury) leżą na dysku aplikacji. Karta otwiera się od razu z dysku — bez czekania na
 * internet i ładowanie zdjęć; bez połączenia działa cały pokaz. Synchronizacja (w tle, po otwarciu „Prezentacji”) pobiera tylko
 * zmienione karty (wersja; treść produktów z katalogu odświeża się co kilka godzin) i brakujące zdjęcia, a usuwa to, czego już
 * nie ma w prezentacjach. Inny pracownik na urządzeniu — pamięć od nowa (bez cudzych układów i kart).
 */

const ROOT = `${FileSystem.documentDirectory || ''}showcase/`;
const MEDIA = `${ROOT}media/`;
const ITEMS = `${ROOT}items/`;
const INDEX = `${ROOT}index.json`;
const HOME = `${ROOT}home.json`;
/** Treść karty z katalogu produktów (ceny, warianty) może się zmienić bez zmiany wersji karty — odświeżenie co 6 godzin. */
const ITEM_REFRESH_MS = 6 * 60 * 60 * 1000;
const PARALLEL = 3;

/** Potrzebne pliki zdjęcia (bity): 1 — pełne, 2 — osobna miniatura. */
type Need = number;
type MediaEntry = { url?: string; thumb?: string };
type ItemEntry = { version: number; updatedAt: string; savedAt: number; media: Record<string, Need> };
type Index = {
  user: string;
  /** Klucz zdjęcia (`showcaseMediaKey`) → nazwy plików na dysku. */
  media: Record<string, MediaEntry>;
  items: Record<string, ItemEntry>;
  bytes: number;
  syncedAt: string | null;
};

export type ShowcaseOfflineStatus = {
  /** `idle` — gotowe albo jeszcze nie pobierano, `syncing` — zapisywanie, `error` — przerwane (np. brak internetu). */
  state: 'idle' | 'syncing' | 'error';
  done: number;
  total: number;
  /** Miejsce zajęte przez zdjęcia prezentacji (bajty). */
  bytes: number;
  syncedAt: string | null;
  /** Karty zapisane w pamięci / widoczne w układzie pracownika. */
  itemsSaved: number;
  itemsTotal: number;
  message: string;
};

let index: Index | null = null;
let status: ShowcaseOfflineStatus = { state: 'idle', done: 0, total: 0, bytes: 0, syncedAt: null, itemsSaved: 0, itemsTotal: 0, message: '' };
const listeners = new Set<(value: ShowcaseOfflineStatus) => void>();
let running: Promise<void> | null = null;
/** Nowsza lista, która przyszła w trakcie synchronizacji — następna synchronizacja zaraz po bieżącej. */
let queued: { user: string; home: ShowcaseHome; fetchItem: (id: string) => Promise<ShowcaseItemDetail> } | null = null;

const publish = (change: Partial<ShowcaseOfflineStatus>) => {
  status = { ...status, ...change };
  listeners.forEach((listener) => listener(status));
};

/** Stan pamięci prezentacji (pasek „Zapisano w pamięci urządzenia” / postęp pobierania). */
export function subscribeShowcaseOffline(listener: (value: ShowcaseOfflineStatus) => void): () => void {
  listeners.add(listener);
  listener(status);
  return () => { listeners.delete(listener); };
}

/** Krótki skrót tekstu (dwa 32-bitowe skróty) — nazwa pliku zdjęcia na dysku. */
function digest(value: string): string {
  let a = 0x811c9dc5;
  let b = 5381;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = (Math.imul(b, 33) + code) >>> 0;
  }
  return `${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`;
}

const extensionOf = (url: string) => {
  const match = /\.(webp|jpe?g|png|gif|heic|avif)(?:$|[?#])/i.exec(url);
  return match ? match[1].toLowerCase() : 'img';
};

async function ensureDirs() {
  for (const dir of [ROOT, MEDIA, ITEMS]) {
    const info = await FileSystem.getInfoAsync(dir);
    if (!info.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return null;
    return JSON.parse(await FileSystem.readAsStringAsync(path)) as T;
  } catch {
    return null;
  }
}

const writeJson = (path: string, value: unknown) => FileSystem.writeAsStringAsync(path, JSON.stringify(value));
const sizeOf = (info: FileSystem.FileInfo) => (info.exists ? Number(info.size) || 0 : 0);

/**
 * Pamięć pracownika `user`; inny pracownik — pamięć od nowa. `null` (sesji nie da się sprawdzić bez internetu) — pamięć
 * ostatniego pracownika na tym urządzeniu (jest zalogowany w aplikacji; logowanie innego konta i tak czyści pamięć).
 */
async function loadIndex(user: string | null): Promise<Index> {
  if (index && (user === null || index.user === user)) return index;
  await ensureDirs();
  const saved = await readJson<Index>(INDEX);
  if (saved && (user === null || saved.user === user)) {
    index = { user: saved.user || '', media: saved.media || {}, items: saved.items || {}, bytes: Number(saved.bytes) || 0, syncedAt: saved.syncedAt || null };
  } else {
    if (saved) {
      await FileSystem.deleteAsync(ROOT, { idempotent: true });
      await ensureDirs();
    }
    index = { user: user || '', media: {}, items: {}, bytes: 0, syncedAt: null };
    if (user) await writeJson(INDEX, index);
  }
  publish({ bytes: index.bytes, syncedAt: index.syncedAt });
  return index;
}

const saveIndex = async () => { if (index?.user) await writeJson(INDEX, index); };

/** Otwiera pamięć pracownika (przed pokazaniem listy — miniatury od razu z dysku). */
export async function openShowcaseOffline(user: string | null): Promise<void> {
  try { await loadIndex(user); } catch { /* pamięć niedostępna — wszystko z serwera */ }
}

function complete(key: string, need: Need): boolean {
  const local = index?.media[key];
  return Boolean((!(need & 1) || local?.url) && (!(need & 2) || local?.thumb || local?.url));
}

const needOf = (pair: { url: string | null; thumb: string | null }): Need => (pair.url ? 1 : 0) | (pair.thumb && pair.thumb !== pair.url ? 2 : 0);

/** Adresy zdjęć z dysku tam, gdzie zdjęcie jest już zapisane (pozostałe — z serwera). */
export function localizeShowcaseUrls(urls: ShowcaseUrls): ShowcaseUrls {
  if (!index) return urls;
  const out: ShowcaseUrls = {};
  for (const [key, pair] of Object.entries(urls)) {
    const local = index.media[key];
    const full = local?.url ? `${MEDIA}${local.url}` : null;
    const thumb = local?.thumb ? `${MEDIA}${local.thumb}` : null;
    out[key] = { url: full || pair.url, thumb: thumb || full || pair.thumb };
  }
  return out;
}

/** Lista z pamięci (bez internetu); `null` — nic jeszcze nie zapisano. */
export async function offlineShowcaseHome(user: string | null): Promise<ShowcaseHome | null> {
  await loadIndex(user);
  const home = await readJson<ShowcaseHome>(HOME);
  return home ? { ...home, urls: localizeShowcaseUrls(home.urls) } : null;
}

/** Karta z pamięci (od razu, także bez internetu); `null` — karta jeszcze nie zapisana. */
export async function offlineShowcaseItem(user: string | null, id: string): Promise<ShowcaseItemDetail | null> {
  const current = await loadIndex(user);
  if (!current.items[id]) return null;
  const detail = await readJson<ShowcaseItemDetail>(`${ITEMS}${id}.json`);
  return detail ? { ...detail, urls: localizeShowcaseUrls(detail.urls) } : null;
}

async function storeItem(current: Index, detail: ShowcaseItemDetail) {
  await writeJson(`${ITEMS}${detail.item.id}.json`, detail);
  const media: Record<string, Need> = {};
  for (const [key, pair] of Object.entries(detail.urls)) media[key] = needOf(pair);
  current.items[detail.item.id] = { version: detail.item.version, updatedAt: detail.item.updatedAt, savedAt: Date.now(), media };
}

/** Karta otwarta z internetem — od razu do pamięci (brakujące zdjęcia dociągnie najbliższa synchronizacja). */
export async function saveOfflineShowcaseItem(user: string, detail: ShowcaseItemDetail) {
  const current = await loadIndex(user);
  await storeItem(current, detail);
  await saveIndex();
}

/** Zmiana układu (kolejność, ukryte) w zapisanej liście — bez internetu lista ma ten sam układ co w CRM. */
export async function updateOfflineShowcaseHome(user: string, change: (home: ShowcaseHome) => ShowcaseHome) {
  await loadIndex(user);
  const home = await readJson<ShowcaseHome>(HOME);
  if (home) await writeJson(HOME, change(home));
}

async function download(current: Index, key: string, variant: 'url' | 'thumb', remote: string): Promise<number> {
  const name = `${digest(`${key}|${variant}`)}.${extensionOf(remote)}`;
  const target = `${MEDIA}${name}`;
  const result = await FileSystem.downloadAsync(remote, target);
  if (result.status < 200 || result.status >= 300) {
    await FileSystem.deleteAsync(target, { idempotent: true });
    throw new Error(`HTTP ${result.status}`);
  }
  const entry = current.media[key] || {};
  entry[variant] = name;
  current.media[key] = entry;
  return sizeOf(await FileSystem.getInfoAsync(target));
}

async function pool<T>(jobs: T[], work: (job: T) => Promise<void>) {
  const queue = [...jobs];
  const worker = async () => {
    while (queue.length) await work(queue.shift() as T);
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, queue.length) }, worker));
}

/**
 * Synchronizacja (jedna naraz; nowsza lista w trakcie — kolejna zaraz po niej): lista, karty widoczne w układzie pracownika
 * (zmienione, starsze niż 6 godzin albo z brakującymi zdjęciami — świeże adresy z serwera), brakujące zdjęcia; pliki i karty
 * spoza prezentacji znikają. `fetchItem` — karta z serwera.
 */
export function syncShowcaseOffline(user: string, home: ShowcaseHome, fetchItem: (id: string) => Promise<ShowcaseItemDetail>): Promise<void> {
  if (running) {
    queued = { user, home, fetchItem };
    return running;
  }
  running = (async () => {
    const current = await loadIndex(user);
    await writeJson(HOME, home);
    const visible = showcaseVisibleForMe(home).items;
    let failed = 0;
    let changed = false;

    // 1. Treść kart.
    const remote = new Map<string, { url: string | null; thumb: string | null }>();
    for (const [key, pair] of Object.entries(home.urls)) remote.set(key, { url: null, thumb: pair.thumb || pair.url });
    const stale = visible.filter((summary) => {
      const saved = current.items[summary.id];
      return !saved || saved.version !== summary.version || saved.updatedAt !== summary.updatedAt || Date.now() - saved.savedAt > ITEM_REFRESH_MS
        || Object.entries(saved.media).some(([key, need]) => !complete(key, need));
    });
    let done = visible.length - stale.length;
    publish({ state: 'syncing', done, total: visible.length, itemsTotal: visible.length, message: 'Zapisuję karty w pamięci urządzenia…' });
    await pool(stale, async (summary) => {
      try {
        const detail = await fetchItem(summary.id);
        await storeItem(current, detail);
        for (const [key, pair] of Object.entries(detail.urls)) {
          const before = remote.get(key);
          remote.set(key, { url: pair.url || before?.url || null, thumb: pair.thumb || before?.thumb || null });
        }
        changed = true;
      } catch {
        failed += 1;
      }
      done += 1;
      publish({ done });
    });
    await saveIndex();

    // 2. Zdjęcia: miniatury listy i okładki działów oraz zdjęcia kart (pełne i miniatury).
    const jobs: Array<{ key: string; variant: 'url' | 'thumb'; url: string }> = [];
    for (const [key, pair] of remote) {
      const local = current.media[key] || {};
      if (pair.url && !local.url) jobs.push({ key, variant: 'url', url: pair.url });
      if (pair.thumb && !local.thumb && !local.url && pair.thumb !== pair.url) jobs.push({ key, variant: 'thumb', url: pair.thumb });
    }
    if (jobs.length) publish({ done: 0, total: jobs.length, message: 'Pobieram zdjęcia do pamięci urządzenia…' });
    let fetched = 0;
    await pool(jobs, async (job) => {
      try {
        current.bytes += await download(current, job.key, job.variant, job.url);
        changed = true;
      } catch {
        failed += 1;
      }
      fetched += 1;
      if (fetched % 5 === 0 || fetched === jobs.length) {
        publish({ done: fetched, bytes: current.bytes });
        await saveIndex();
      }
    });

    // 3. Porządek: karty i zdjęcia, których nie ma już w prezentacjach pracownika.
    const visibleIds = new Set(visible.map((item) => item.id));
    for (const id of Object.keys(current.items)) {
      if (visibleIds.has(id)) continue;
      delete current.items[id];
      await FileSystem.deleteAsync(`${ITEMS}${id}.json`, { idempotent: true });
      changed = true;
    }
    const wanted = new Set(Object.keys(home.urls));
    for (const entry of Object.values(current.items)) Object.keys(entry.media).forEach((key) => wanted.add(key));
    for (const key of Object.keys(current.media)) {
      if (!wanted.has(key)) { delete current.media[key]; changed = true; }
    }
    if (changed || !current.bytes) {
      const keep = new Set(Object.values(current.media).flatMap((entry) => [entry.url, entry.thumb]).filter((name): name is string => Boolean(name)));
      try {
        let bytes = 0;
        for (const name of await FileSystem.readDirectoryAsync(MEDIA)) {
          if (!keep.has(name)) { await FileSystem.deleteAsync(`${MEDIA}${name}`, { idempotent: true }); continue; }
          bytes += sizeOf(await FileSystem.getInfoAsync(`${MEDIA}${name}`));
        }
        current.bytes = bytes;
      } catch { /* zostaje dotychczasowa suma */ }
    }
    if (!failed) current.syncedAt = new Date().toISOString();
    await saveIndex();
    publish({
      state: failed ? 'error' : 'idle', done: jobs.length, total: jobs.length, bytes: current.bytes, syncedAt: current.syncedAt,
      itemsSaved: visible.filter((item) => current.items[item.id]).length, itemsTotal: visible.length,
      message: failed ? 'Część prezentacji nie zapisała się w pamięci urządzenia — dokończę przy następnym otwarciu z internetem.' : '',
    });
  })()
    .catch(() => { publish({ state: 'error', message: 'Nie udało się zapisać prezentacji w pamięci urządzenia.' }); })
    .finally(() => {
      running = null;
      const next = queued;
      queued = null;
      if (next) void syncShowcaseOffline(next.user, next.home, next.fetchItem);
    });
  return running;
}
