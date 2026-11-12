import 'server-only';
import type { NativeContext } from './auth';
import { blockFormal, storagePath } from './eventFiles';

/*
 * Pliki wydarzeń w Finderze (rozszerzenie File Provider aplikacji na Maca): Mavinci → Eventy → rok → „RRRR-MM-DD Nazwa”
 * → foldery i pliki z zakładki Pliki. Wszystko tokenem pracownika — RLS jak w CRM, więc w Finderze widać dokładnie to, co
 * w przeglądarce. Treść plików nie przechodzi przez serwer CRM: pobieranie i wysyłanie przez podpisane adresy magazynu.
 *
 * Synchronizacja: `events` i `list` na start, potem `changes?since=<kursor>` — zmienione wydarzenia, foldery, pliki i ślady
 * usunięć (z zakładką 5 min, powtórzenia są nieszkodliwe). Kursor starszy niż 25 dni → `reset` (Mac wczytuje wszystko od nowa).
 * Konflikty: podmiana treści podaje `baseContentVersion`; gdy na serwerze jest już nowsza wersja — 409 z aktualnym plikiem
 * (Mac zachowuje swoją wersję jako kopię „(konflikt …)”). Pliki można przenosić także między wydarzeniami, foldery — nie.
 * Usuwanie przenosi do kosza na 30 dni (wyzwalacze w bazie, migracja `20261112120000_finder_files_sync.sql`); obiekty w
 * magazynie usuwa dopiero `purge` / `deleteForever`, i tylko te, których nic już nie używa.
 */

const BUCKET = 'event-files';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const OVERLAP_MS = 5 * 60_000;
const CURSOR_MAX_AGE_MS = 25 * 24 * 3600_000;
const VERSION_KEEP_MS = 30 * 24 * 3600_000;
const PAGE = 1000;
const MAX_ROWS = 20_000;

const EVENT_COLUMNS = 'id,name,event_date,event_end_date,status,updated_at';
const FOLDER_COLUMNS = 'id,event_id,parent_folder_id,name,visibility,is_system_folder,created_at,updated_at,meta_version';
const FILE_COLUMNS =
  'id,event_id,folder_id,name,original_name,file_path,file_size,mime_type,document_type,created_at,updated_at,content_sha256,content_version,meta_version';
const TRASH_COLUMNS = 'id,kind,item_id,event_id,parent_folder_id,name,file_path,file_size,mime_type,batch,deleted_at,deleted_by,purge_after';

export class FinderError extends Error {
  status: number;
  extra: Record<string, unknown>;
  constructor(message: string, status = 400, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

function fail(message: string, status = 400, extra: Record<string, unknown> = {}): never {
  throw new FinderError(message, status, extra);
}

/** Błąd bazy → komunikat dla Findera (zajęta nazwa: 409 `exists`, brak uprawnień: 403 `forbidden`). */
function dbFail(error: any, fallback: string, exists?: string): never {
  if (error?.code === '23505') fail(exists || 'Ta nazwa jest już zajęta.', 409, { code: 'exists' });
  if (error?.code === '42501') fail('Nie masz uprawnień do tej zmiany.', 403, { code: 'forbidden' });
  console.error('[native finder]', error?.code, error?.message);
  fail(fallback);
}

const uuidOf = (value: unknown, message: string) => {
  const id = String(value ?? '');
  if (!UUID.test(id)) fail(message);
  return id;
};

const uuidList = (value: unknown, max = 200) =>
  Array.from(new Set((Array.isArray(value) ? value : []).map(String).filter((id) => UUID.test(id)))).slice(0, max);

/** Nazwa jak w CRM (Mac zamienia „:” z Findera z powrotem na „/”); bez znaków sterujących, do 255 znaków. */
function cleanName(value: unknown, message: string) {
  const name = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 255);
  if (!name || name === '.' || name === '..') fail(message);
  return name;
}

const sha256Of = (value: unknown) => {
  const sha = String(value ?? '').toLowerCase();
  return SHA256.test(sha) ? sha : null;
};

/** Ścieżka w magazynie nadana przez `prepareUpload` (`<wydarzenie>/<czas>_<los>.<rozszerzenie>`). */
const uploadPattern = (eventId: string) => new RegExp(`^${eventId}/\\d+_[a-z0-9]+\\.[a-z0-9]{1,12}$`);

const warsawDay = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' });
function day(value: unknown): string | null {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : warsawDay.format(date);
}

const eventItem = (r: any) => ({
  id: r.id as string,
  name: String(r.name || '').trim() || 'Wydarzenie',
  date: day(r.event_date),
  endDate: day(r.event_end_date),
  status: r.status ?? null,
  updatedAt: r.updated_at ?? null,
});

const folderItem = (r: any) => ({
  id: r.id as string,
  eventId: r.event_id as string,
  parentId: (r.parent_folder_id ?? null) as string | null,
  name: String(r.name || '').trim() || 'Folder',
  formal: r.visibility === 'formal',
  system: !!r.is_system_folder,
  createdAt: r.created_at ?? null,
  updatedAt: r.updated_at ?? null,
  metaVersion: Number(r.meta_version || 1),
});

const fileItem = (r: any) => ({
  id: r.id as string,
  eventId: r.event_id as string,
  parentId: (r.folder_id ?? null) as string | null,
  name: String(r.name || r.original_name || '').trim() || 'plik',
  size: Number(r.file_size || 0),
  mime: r.mime_type || '',
  documentType: r.document_type ?? null,
  createdAt: r.created_at ?? null,
  updatedAt: r.updated_at ?? null,
  contentVersion: Number(r.content_version || 1),
  metaVersion: Number(r.meta_version || 1),
  sha256: r.content_sha256 ?? null,
});

type Page = PromiseLike<{ data: any[] | null; error: any }>;

/** Wszystkie wiersze zapytania stronami po 1000 (limit PostgREST); `truncated`, gdy przekroczono `MAX_ROWS`. */
async function fetchAll(build: (from: number, to: number) => Page) {
  const rows: any[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

async function eventVisible(ctx: NativeContext, eventId: string) {
  const { data, error } = await ctx.supabase.from('events').select('id').eq('id', eventId).maybeSingle();
  if (error) throw error;
  if (!data) fail('Nie znaleziono wydarzenia.', 404);
}

async function folderInEvent(ctx: NativeContext, eventId: string, folderId: unknown): Promise<string | null> {
  if (folderId === null || folderId === undefined || folderId === '') return null;
  const id = uuidOf(folderId, 'Nieprawidłowy folder.');
  const { data, error } = await ctx.supabase.from('event_folders').select('id,event_id').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) fail('Nie znaleziono folderu.', 404);
  if ((data as any).event_id !== eventId) fail('Pliki i foldery można przenosić tylko w obrębie jednego wydarzenia.', 400, { code: 'crossEvent' });
  return id;
}

/** Usuwa z magazynu obiekty, których nic już nie używa (plik, wpis w koszu, poprzednia wersja, PDF faktury). */
async function removeUnused(ctx: NativeContext, paths: string[]) {
  const unique = Array.from(new Set(paths.filter(Boolean)));
  if (!unique.length) return 0;
  const { data: used, error } = await ctx.supabase.rpc('event_file_paths_in_use', { p_paths: unique });
  if (error) {
    console.error('[native finder] paths in use', error.message);
    return 0;
  }
  const inUse = new Set<string>((used as string[] | null) || []);
  const free = unique.filter((p) => !inUse.has(p));
  for (let i = 0; i < free.length; i += 100) {
    const { error: removeError } = await ctx.supabase.storage.from(BUCKET).remove(free.slice(i, i + 100));
    if (removeError) console.error('[native finder] storage remove', removeError.message);
  }
  return free.length;
}

// MARK: Odczyt

/** Wszystkie wydarzenia widoczne dla pracownika (foldery „Eventy/<rok>/<data> <nazwa>” buduje Mac). */
export async function finderEvents(ctx: NativeContext) {
  const cursor = new Date().toISOString();
  const { rows } = await fetchAll((a, b) =>
    ctx.supabase.from('events').select(EVENT_COLUMNS).order('event_date', { ascending: false }).order('id').range(a, b));
  return { cursor, events: rows.map(eventItem) };
}

/** Zawartość jednego wydarzenia: wszystkie foldery i pliki naraz (Mac układa drzewo sam). */
export async function finderList(ctx: NativeContext, eventIdValue: string) {
  const eventId = uuidOf(eventIdValue, 'Nieprawidłowe wydarzenie.');
  const cursor = new Date().toISOString();
  const s = ctx.supabase;
  const [event, folders, files] = await Promise.all([
    s.from('events').select(EVENT_COLUMNS).eq('id', eventId).maybeSingle(),
    fetchAll((a, b) => s.from('event_folders').select(FOLDER_COLUMNS).eq('event_id', eventId).order('id').range(a, b)),
    fetchAll((a, b) => s.from('event_files').select(FILE_COLUMNS).eq('event_id', eventId).order('id').range(a, b)),
  ]);
  if (event.error) throw event.error;
  if (!event.data) fail('Nie znaleziono wydarzenia.', 404);
  return { cursor, event: eventItem(event.data), folders: folders.rows.map(folderItem), files: files.rows.map(fileItem) };
}

/** Zmiany od kursora: wydarzenia (nazwa, data), foldery, pliki i usunięcia. */
export async function finderChanges(ctx: NativeContext, since: string | null) {
  const started = Date.now();
  const cursor = new Date(started).toISOString();
  const sinceMs = since ? Date.parse(since) : NaN;
  if (!Number.isFinite(sinceMs) || started - sinceMs > CURSOR_MAX_AGE_MS) return { cursor, reset: true };
  const from = new Date(sinceMs - OVERLAP_MS).toISOString();
  const s = ctx.supabase;
  const [events, folders, files, tombstones] = await Promise.all([
    fetchAll((a, b) => s.from('events').select(EVENT_COLUMNS).gte('updated_at', from).order('updated_at').order('id').range(a, b)),
    fetchAll((a, b) => s.from('event_folders').select(FOLDER_COLUMNS).gte('updated_at', from).order('updated_at').order('id').range(a, b)),
    fetchAll((a, b) => s.from('event_files').select(FILE_COLUMNS).gte('updated_at', from).order('updated_at').order('id').range(a, b)),
    fetchAll((a, b) => s.from('event_file_tombstones').select('id,kind,item_id,event_id,deleted_at').gte('deleted_at', from).order('id').range(a, b)),
  ]);
  if (events.truncated || folders.truncated || files.truncated || tombstones.truncated) return { cursor, reset: true };
  // Element, który znów istnieje (np. przywrócony z kosza), wygrywa ze swoim śladem usunięcia.
  const alive = new Set<string>([...folders.rows.map((f) => f.id), ...files.rows.map((f) => f.id)]);
  const deleted = new Map<string, { kind: string; id: string; eventId: string; deletedAt: string }>();
  for (const t of tombstones.rows) {
    if (alive.has(t.item_id)) continue;
    deleted.set(t.item_id, { kind: t.kind, id: t.item_id, eventId: t.event_id, deletedAt: t.deleted_at });
  }
  return {
    cursor,
    reset: false,
    events: events.rows.map(eventItem),
    folders: folders.rows.map(folderItem),
    files: files.rows.map(fileItem),
    deleted: Array.from(deleted.values()),
  };
}

export async function finderItem(ctx: NativeContext, kind: string, idValue: string) {
  const id = uuidOf(idValue, 'Nieprawidłowy element.');
  const s = ctx.supabase;
  if (kind === 'event') {
    const { data, error } = await s.from('events').select(EVENT_COLUMNS).eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data) fail('Nie znaleziono wydarzenia.', 404);
    return { item: eventItem(data) };
  }
  if (kind === 'folder') {
    const { data, error } = await s.from('event_folders').select(FOLDER_COLUMNS).eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data) fail('Nie znaleziono folderu.', 404);
    return { item: folderItem(data) };
  }
  const { data, error } = await s.from('event_files').select(FILE_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) fail('Nie znaleziono pliku.', 404);
  return { item: fileItem(data) };
}

/** Podpisany adres pobrania (1 h) i aktualne wersje pliku. */
export async function finderDownload(ctx: NativeContext, idValue: string) {
  const id = uuidOf(idValue, 'Nieprawidłowy plik.');
  const s = ctx.supabase;
  const { data, error } = await s.from('event_files').select(FILE_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw error;
  let row: any = data;
  if (!row) {
    // Plik w koszu (np. podgląd w Koszu Findera) — treść z wpisu kosza.
    const { data: trashed } = await s.from('event_file_trash').select('item_id,event_id,parent_folder_id,name,file_path,file_size,mime_type,deleted_at,snapshot')
      .eq('item_id', id).eq('kind', 'file').order('deleted_at', { ascending: false }).limit(1).maybeSingle();
    if (!trashed) fail('Nie znaleziono pliku.', 404);
    const t = trashed as any;
    row = { ...(t.snapshot || {}), id: t.item_id, event_id: t.event_id, folder_id: t.parent_folder_id, name: t.name, file_path: t.file_path,
      file_size: t.file_size, mime_type: t.mime_type };
  }
  const { data: signed, error: signError } = await s.storage.from(BUCKET).createSignedUrl(row.file_path, 3600);
  if (signError || !signed?.signedUrl) fail('Pliku nie ma już w magazynie.', 410, { code: 'missing' });
  return { url: signed.signedUrl, item: fileItem(row) };
}

/** Kosz: elementy usunięte w ostatnich 30 dniach, które użytkownik może przywrócić (całość albo jedno wydarzenie). */
export async function finderTrash(ctx: NativeContext, eventIdValue: string | null) {
  const s = ctx.supabase;
  let query = s.from('event_file_trash').select(TRASH_COLUMNS).order('deleted_at', { ascending: false }).limit(1000);
  if (eventIdValue) query = query.eq('event_id', uuidOf(eventIdValue, 'Nieprawidłowe wydarzenie.'));
  const { data, error } = await query;
  if (error) throw error;
  const rows = (data || []) as any[];
  const people = Array.from(new Set(rows.map((r) => r.deleted_by).filter(Boolean)));
  const names = new Map<string, string>();
  if (people.length) {
    const { data: employees } = await s.from('employees').select('id,name,surname').in('id', people);
    for (const e of (employees || []) as any[]) names.set(e.id, [e.name, e.surname].filter(Boolean).join(' '));
  }
  return {
    items: rows.map((r) => ({
      id: r.id as string,
      kind: r.kind as string,
      itemId: r.item_id as string,
      eventId: r.event_id as string,
      parentId: (r.parent_folder_id ?? null) as string | null,
      name: r.name || (r.kind === 'folder' ? 'Folder' : 'plik'),
      size: Number(r.file_size || 0),
      mime: r.mime_type || '',
      batch: String(r.batch),
      deletedAt: r.deleted_at,
      deletedBy: r.deleted_by ? names.get(r.deleted_by) || null : null,
      deletedById: r.deleted_by ?? null,
      mine: !!r.deleted_by && (r.deleted_by === ctx.employee.id || r.deleted_by === ctx.employee.authUserId),
      purgeAfter: r.purge_after,
    })),
  };
}

// MARK: Zapis

/** Krok 1 wysyłki: ścieżki w magazynie i jednorazowe podpisane adresy (plik idzie z Maca prosto do magazynu). */
export async function finderPrepareUpload(ctx: NativeContext, body: Record<string, any>) {
  const eventId = uuidOf(body.eventId, 'Nieprawidłowe wydarzenie.');
  await eventVisible(ctx, eventId);
  const names: string[] = (Array.isArray(body.names) ? body.names : [body.name]).map((n: unknown) => String(n ?? '')).slice(0, 50);
  const slots = [];
  for (const name of names) {
    const path = storagePath(eventId, name);
    const { data, error } = await ctx.supabase.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !data?.signedUrl) fail('Nie masz uprawnień do dodawania plików w tym wydarzeniu.', 403, { code: 'forbidden' });
    slots.push({ name, path, url: data.signedUrl });
  }
  return { slots };
}

export async function finderCreateFolder(ctx: NativeContext, body: Record<string, any>) {
  const eventId = uuidOf(body.eventId, 'Nieprawidłowe wydarzenie.');
  const name = cleanName(body.name, 'Podaj nazwę folderu.');
  await blockFormal(ctx, eventId, name);
  const parentId = await folderInEvent(ctx, eventId, body.parentId);
  const { data, error } = await ctx.supabase.from('event_folders')
    .insert({ event_id: eventId, parent_folder_id: parentId, name, created_by: ctx.employee.authUserId || ctx.employee.id })
    .select(FOLDER_COLUMNS).single();
  if (error) dbFail(error, 'Nie udało się utworzyć folderu.', 'Folder o tej nazwie już istnieje.');
  return { item: folderItem(data) };
}

/** Krok 2 wysyłki: wpis w `event_files` dla obiektu wysłanego do magazynu (nieudany wpis usuwa obiekt). */
export async function finderCreateFile(ctx: NativeContext, body: Record<string, any>) {
  const eventId = uuidOf(body.eventId, 'Nieprawidłowe wydarzenie.');
  const path = String(body.path || '');
  if (!uploadPattern(eventId).test(path)) fail('Nieprawidłowa ścieżka pliku.');
  const s = ctx.supabase;
  try {
    const name = cleanName(body.name, 'Podaj nazwę pliku.');
    const parentId = await folderInEvent(ctx, eventId, body.parentId);
    const mime = String(body.mime || '').slice(0, 200);
    const { data, error } = await s.from('event_files').insert({
      event_id: eventId, folder_id: parentId, name, original_name: name, file_path: path,
      file_size: Math.max(0, Number(body.size) || 0), mime_type: mime,
      thumbnail_url: mime.startsWith('image/') ? s.storage.from(BUCKET).getPublicUrl(path).data.publicUrl : null,
      uploaded_by: ctx.employee.authUserId || ctx.employee.id, content_sha256: sha256Of(body.sha256),
    }).select(FILE_COLUMNS).single();
    if (error) dbFail(error, 'Nie udało się dodać pliku.', 'Plik o tej nazwie już jest w tym folderze.');
    return { item: fileItem(data) };
  } catch (error) {
    await removeUnused(ctx, [path]);
    throw error;
  }
}

async function isInside(ctx: NativeContext, eventId: string, candidate: string, folderId: string) {
  const { data, error } = await ctx.supabase.from('event_folders').select('id,parent_folder_id').eq('event_id', eventId);
  if (error) throw error;
  const parent = new Map(((data || []) as any[]).map((f) => [f.id as string, (f.parent_folder_id ?? null) as string | null]));
  let current: string | null = candidate;
  for (let depth = 0; current && depth < 50; depth++) {
    if (current === folderId) return true;
    current = parent.get(current) ?? null;
  }
  return false;
}

/**
 * Zmiana nazwy, przeniesienie (w obrębie wydarzenia) i — dla pliku — podmiana treści (`content: {path, size, mime, sha256,
 * baseContentVersion}`; nowy obiekt z `prepareUpload`, poprzednia treść zostaje jako wersja).
 */
export async function finderUpdate(ctx: NativeContext, body: Record<string, any>) {
  const kind = body.kind === 'folder' ? 'folder' : 'file';
  const id = uuidOf(body.id, 'Nieprawidłowy element.');
  const s = ctx.supabase;

  if (kind === 'folder') {
    const { data: current, error } = await s.from('event_folders').select(FOLDER_COLUMNS).eq('id', id).maybeSingle();
    if (error) throw error;
    if (!current) fail('Nie znaleziono folderu.', 404);
    const folder = current as any;
    if (body.eventId && body.eventId !== folder.event_id) fail('Foldery można przenosić tylko w obrębie jednego wydarzenia — przenieś pliki.', 400, { code: 'crossEvent' });
    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) {
      const name = cleanName(body.name, 'Podaj nazwę folderu.');
      if (name !== folder.name) {
        await blockFormal(ctx, folder.event_id, name);
        patch.name = name;
      }
    }
    if ('parentId' in body) {
      const parentId = await folderInEvent(ctx, folder.event_id, body.parentId);
      if (parentId !== (folder.parent_folder_id ?? null)) {
        if (parentId && (await isInside(ctx, folder.event_id, parentId, id))) fail('Nie można przenieść folderu do jego własnego podfolderu.');
        patch.parent_folder_id = parentId;
      }
    }
    if (!Object.keys(patch).length) return { item: folderItem(folder) };
    const { data, error: updateError } = await s.from('event_folders').update(patch).eq('id', id).select(FOLDER_COLUMNS).maybeSingle();
    if (updateError) dbFail(updateError, 'Nie udało się zmienić folderu.', 'Folder o tej nazwie już istnieje.');
    if (!data) fail('Nie masz uprawnień do zmiany tego folderu.', 403, { code: 'forbidden' });
    return { item: folderItem(data) };
  }

  const { data: current, error } = await s.from('event_files').select(FILE_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw error;
  if (!current) fail('Nie znaleziono pliku.', 404);
  const file = current as any;
  // Plik można przenieść do innego wydarzenia (Finder: przeciągnięcie między folderami wydarzeń) — RLS sprawdza
  // uprawnienia w obu wydarzeniach; obiekt w magazynie zostaje pod dotychczasową ścieżką.
  const targetEvent = body.eventId ? uuidOf(body.eventId, 'Nieprawidłowe wydarzenie.') : file.event_id;
  if (targetEvent !== file.event_id) await eventVisible(ctx, targetEvent);
  const content = body.content && typeof body.content === 'object' ? (body.content as Record<string, any>) : null;
  const uploaded = content ? String(content.path || '') : '';
  try {
    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) {
      const name = cleanName(body.name, 'Podaj nazwę pliku.');
      if (name !== file.name) patch.name = name;
    }
    if ('parentId' in body || targetEvent !== file.event_id) {
      const parentId = await folderInEvent(ctx, targetEvent, body.parentId);
      if (parentId !== (file.folder_id ?? null)) patch.folder_id = parentId;
      if (targetEvent !== file.event_id) patch.event_id = targetEvent;
    }
    let base: number | null = null;
    if (content) {
      if (!uploadPattern(file.event_id).test(uploaded)) fail('Nieprawidłowa ścieżka pliku.');
      base = Number.isFinite(Number(content.baseContentVersion)) ? Number(content.baseContentVersion) : null;
      if (base !== null && base !== Number(file.content_version || 1)) {
        fail('Plik zmienił się w międzyczasie na serwerze.', 409, { code: 'conflict', item: fileItem(file) });
      }
      const mime = String(content.mime || file.mime_type || '').slice(0, 200);
      patch.file_path = uploaded;
      patch.file_size = Math.max(0, Number(content.size) || 0);
      patch.mime_type = mime;
      patch.content_sha256 = sha256Of(content.sha256);
      patch.thumbnail_url = mime.startsWith('image/') ? s.storage.from(BUCKET).getPublicUrl(uploaded).data.publicUrl : null;
    }
    if (!Object.keys(patch).length) return { item: fileItem(file) };
    let query = s.from('event_files').update(patch).eq('id', id);
    if (base !== null) query = query.eq('content_version', base);
    const { data, error: updateError } = await query.select(FILE_COLUMNS).maybeSingle();
    if (updateError) dbFail(updateError, 'Nie udało się zmienić pliku.', 'Plik o tej nazwie już jest w tym folderze.');
    if (!data) {
      const { data: now } = await s.from('event_files').select(FILE_COLUMNS).eq('id', id).maybeSingle();
      if (now && base !== null && Number((now as any).content_version || 1) !== base) {
        fail('Plik zmienił się w międzyczasie na serwerze.', 409, { code: 'conflict', item: fileItem(now) });
      }
      fail('Nie masz uprawnień do zmiany tego pliku.', 403, { code: 'forbidden' });
    }
    return { item: fileItem(data) };
  } catch (error) {
    if (uploaded) await removeUnused(ctx, [uploaded]);
    throw error;
  }
}

/** Usunięcie (do kosza na 30 dni — wpis tworzy baza, obiekt w magazynie zostaje). Element, którego już nie ma, to sukces. */
export async function finderRemove(ctx: NativeContext, body: Record<string, any>) {
  const table = body.kind === 'folder' ? 'event_folders' : 'event_files';
  const id = uuidOf(body.id, 'Nieprawidłowy element.');
  const { data, error } = await ctx.supabase.from(table).delete().eq('id', id).select('id');
  if (error) dbFail(error, 'Nie udało się usunąć.');
  if (!data?.length) {
    const { data: still } = await ctx.supabase.from(table).select('id').eq('id', id).maybeSingle();
    if (still) fail('Nie masz uprawnień do usunięcia tego elementu.', 403, { code: 'forbidden' });
    return { ok: true, gone: true };
  }
  return { ok: true };
}

/** Przywrócenie z kosza (folder wraca z zawartością usuniętą razem z nim). */
/** Wpisy kosza wskazane wprost (`ids`) albo przez identyfikatory usuniętych plików / folderów (`itemIds` — Finder). */
async function trashIds(ctx: NativeContext, body: Record<string, any>) {
  const ids = uuidList(body.ids);
  const itemIds = uuidList(body.itemIds);
  if (itemIds.length) {
    const { data, error } = await ctx.supabase.from('event_file_trash').select('id,item_id,deleted_at').in('item_id', itemIds)
      .order('deleted_at', { ascending: false });
    if (error) throw error;
    const seen = new Set<string>();
    for (const r of (data || []) as any[]) {
      if (seen.has(r.item_id)) continue;
      seen.add(r.item_id);
      ids.push(r.id);
    }
  }
  return Array.from(new Set(ids));
}

export async function finderRestore(ctx: NativeContext, body: Record<string, any>) {
  const ids = await trashIds(ctx, body);
  if (!ids.length) return { restored: 0, missing: 0, skipped: 0 };
  const { data, error } = await ctx.supabase.rpc('restore_event_trash', { p_ids: ids });
  if (error) {
    if (error.code === '23505') fail(error.message, 409, { code: 'exists' });
    dbFail(error, 'Nie udało się przywrócić.');
  }
  return data as { restored: number; missing: number; skipped: number };
}

/** Usunięcie na zawsze z kosza (folder razem z zawartością usuniętą w tej samej operacji) i sprzątanie magazynu. */
export async function finderDeleteForever(ctx: NativeContext, body: Record<string, any>) {
  const ids = await trashIds(ctx, body);
  if (!ids.length) return { removed: 0 };
  const s = ctx.supabase;
  const { data: chosen, error } = await s.from('event_file_trash').select('id,kind,item_id,event_id,batch').in('id', ids);
  if (error) throw error;
  const all = new Set(((chosen || []) as any[]).map((r) => r.id as string));
  for (const folder of ((chosen || []) as any[]).filter((r) => r.kind === 'folder')) {
    const { data: batch } = await s.from('event_file_trash').select('id').eq('batch', folder.batch).eq('event_id', folder.event_id);
    for (const r of (batch || []) as any[]) all.add(r.id);
  }
  return { removed: await dropTrash(ctx, Array.from(all)) };
}

/** Usuwa wpisy kosza, wersje ich plików i nieużywane obiekty w magazynie. */
async function dropTrash(ctx: NativeContext, ids: string[]) {
  if (!ids.length) return 0;
  const s = ctx.supabase;
  const { data: rows, error } = await s.from('event_file_trash').select('id,kind,item_id,file_path').in('id', ids);
  if (error) throw error;
  const files = ((rows || []) as any[]).filter((r) => r.kind === 'file');
  const paths: string[] = files.map((r) => r.file_path);
  if (files.length) {
    const { data: versions } = await s.from('event_file_versions').delete().in('file_id', files.map((r) => r.item_id)).select('file_path');
    paths.push(...((versions || []) as any[]).map((v) => v.file_path));
  }
  const { data: removed, error: deleteError } = await s.from('event_file_trash').delete().in('id', ids).select('id');
  if (deleteError) dbFail(deleteError, 'Nie udało się opróżnić kosza.');
  await removeUnused(ctx, paths);
  return (removed || []).length;
}

/** Sprzątanie (Mac woła raz dziennie): kosz po 30 dniach, wersje starsze niż 30 dni, stare ślady usunięć. */
export async function finderPurge(ctx: NativeContext) {
  const s = ctx.supabase;
  const now = new Date().toISOString();
  const { data: expired, error } = await s.from('event_file_trash').select('id').lt('purge_after', now).limit(500);
  if (error) throw error;
  const trash = await dropTrash(ctx, ((expired || []) as any[]).map((r) => r.id));
  const cutoff = new Date(Date.now() - VERSION_KEEP_MS).toISOString();
  const { data: old, error: oldError } = await s.from('event_file_versions').select('id').lt('replaced_at', cutoff).limit(500);
  if (oldError) console.error('[native finder] versions purge', oldError.message);
  const oldIds = ((old || []) as any[]).map((v) => v.id as string);
  const { data: versions } = oldIds.length
    ? await s.from('event_file_versions').delete().in('id', oldIds).select('file_path')
    : { data: [] as any[] };
  const objects = await removeUnused(ctx, ((versions || []) as any[]).map((v) => v.file_path));
  const { data: tombstones } = await s.rpc('purge_event_file_tombstones');
  return { trash, versions: (versions || []).length, objects, tombstones: Number(tombstones || 0) };
}
