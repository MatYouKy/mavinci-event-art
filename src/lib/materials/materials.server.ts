import 'server-only';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { NativeContext } from '@/lib/native/auth';
import { evaluateInBrowser } from '@/lib/print/pdfRenderer.server';
import {
  MATERIALS_MAX_FILE_BYTES, MATERIALS_MAX_BATCH, MATERIAL_ALBUM_LIMITS, NO_MATERIAL_ACCESS, cleanMaterialAlbumName, cleanMaterialName,
  cleanMaterialTags, materialExtension, materialKind, numberedMaterialName, type MaterialAccess, type MaterialKind, type MaterialSystemFolder,
} from './materialsShared';

/*
 * Materiały — baza plików firmy (`/bridge/native/v1/materials`: CRM, Finder — Mavinci → Materiały, aplikacja na Maca i telefon).
 * Wszystko tokenem pracownika — RLS i funkcje bazy z migracji `20261120120000_materials_library.sql`, więc każdy klient widzi
 * dokładnie to, co w CRM. Treść plików nie przechodzi przez serwer: wysyłka i pobieranie przez podpisane adresy magazynu
 * (prywatny bucket `materials`). Serwer potwierdza wysyłkę (rozmiar i typ z magazynu), robi miniatury zdjęć, gdy klient
 * ich nie dostarczył, kopiuje pliki wydarzeń do Materiałów, kopiuje pliki i całe foldery Materiałów (kopia obiektów w magazynie,
 * bez pobierania) i sprząta magazyn (tylko obiekty, których nic już nie używa).
 */

export const MATERIALS_BUCKET = 'materials';
const EVENT_BUCKET = 'event-files';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const OBJECT_NAME = /^[A-Za-z0-9._-]{1,80}$/;
const PAGE = 1000;
const MAX_ROWS = 20_000;
const LIST_LIMIT = 500;
const SIGNED_TTL = 3600;
const UPLOAD_STALE_MS = 24 * 3600_000;
const VERSION_KEEP_MS = 30 * 24 * 3600_000;
const SERVER_THUMB_MAX_BYTES = 25 * 1024 * 1024;
const COPY_FALLBACK_MAX_BYTES = 300 * 1024 * 1024;
/** Kopiowanie w Materiałach: najwięcej plików i folderów w jednej operacji (z zawartością kopiowanych folderów). */
const COPY_MAX_FILES = 300;
const COPY_MAX_FOLDERS = 200;
const COPY_PARALLEL = 4;
const THUMB_MIME = /^image\/(jpeg|png|webp|gif|svg\+xml|avif|bmp)$/;

const FOLDER_COLUMNS = 'id,company_id,parent_id,name,system_key,sort_order,meta_version,created_at,updated_at';
const FILE_COLUMNS =
  'id,company_id,folder_id,name,status,storage_path,thumbnail_path,mime_type,size_bytes,content_sha256,content_version,meta_version,width,height,duration_seconds,description,tags,event_id,source_event_file_id,created_by,updated_by,created_at,updated_at';
const TRASH_COLUMNS =
  'id,kind,item_id,company_id,parent_folder_id,name,storage_path,thumbnail_path,size_bytes,mime_type,batch,deleted_at,deleted_by,purge_after';

type Row = Record<string, any>;

export class MaterialsError extends Error {
  status: number;
  extra: Record<string, unknown>;
  constructor(message: string, status = 400, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

function fail(message: string, status = 400, extra: Record<string, unknown> = {}): never {
  throw new MaterialsError(message, status, extra);
}

/** Błąd bazy → komunikat po polsku. Komunikaty wyzwalaczy (po polsku) przechodzą bez zmian. */
function dbFail(error: any, fallback: string, exists = 'Ta nazwa jest już zajęta w tym folderze.'): never {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  const polish = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(message) || /^(Nie |Folder|Plik|Za dużo|Nieprawidłow)/.test(message);
  if (code === '23505') fail(polish ? message : exists, 409, { code: 'exists' });
  if (code === '42501') fail(polish ? message : 'Nie masz uprawnień do tej zmiany w Materiałach.', 403, { code: 'forbidden' });
  if (code === '22023' || code === 'P0001') fail(polish ? message : fallback, 400);
  if (code === '23503') fail(polish ? message : 'Nie znaleziono folderu.', 404);
  if (code === '23514') fail(fallback, 400);
  console.error('[materials]', code, message);
  fail(fallback, 500);
}

const uuidOf = (value: unknown, message: string, status = 400) => {
  const id = String(value ?? '').toLowerCase();
  if (!UUID.test(id)) fail(message, status);
  return id;
};

const optionalUuid = (value: unknown, message: string): string | null => {
  if (value === null || value === undefined || value === '') return null;
  return uuidOf(value, message);
};

const nameOf = (value: unknown, message: string) => {
  const name = cleanMaterialName(value);
  if (!name) fail(message);
  return name;
};

const sha256Of = (value: unknown) => {
  const sha = String(value ?? '').toLowerCase();
  return SHA256.test(sha) ? sha : null;
};

const positiveInt = (value: unknown) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n > 0 && n < 1_000_000 ? n : null;
};

const duration = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n < 10_000_000 ? Math.round(n * 100) / 100 : null;
};

const text = (value: unknown) => (typeof value === 'string' ? value : value == null ? '' : String(value));

/** Nazwa obiektu w magazynie: `f-<czas>-<los>.<rozszerzenie>` (miniatura: `t-…jpg`). */
function objectName(prefix: 'f' | 't', fileName: string) {
  const ext = prefix === 't' ? 'jpg' : materialExtension(fileName) || 'bin';
  return `${prefix}-${Date.now().toString(36)}-${randomBytes(6).toString('hex')}.${ext}`;
}

type Page = PromiseLike<{ data: any[] | null; error: any }>;

/** Wszystkie wiersze stronami po 1000 (limit PostgREST). */
async function fetchAll(build: (from: number, to: number) => Page) {
  const rows: any[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

// MARK: Dostęp i marki

export type MaterialCompany = { id: string; name: string; isDefault: boolean; access: MaterialAccess };

export async function materialAccess(ctx: NativeContext, companyId: string | null): Promise<MaterialAccess> {
  const { data, error } = await ctx.supabase.rpc('materials_access', { p_company: companyId });
  if (error || !data || typeof data !== 'object') return { ...NO_MATERIAL_ACCESS, employeeId: ctx.employee.id };
  const row = data as Row;
  return { view: row.view === true, manage: row.manage === true, admin: row.admin === true, employeeId: text(row.employeeId) || ctx.employee.id };
}

async function requireAccess(ctx: NativeContext, companyId: string | null, scope: 'view' | 'manage') {
  const access = await materialAccess(ctx, companyId);
  if (!access[scope]) {
    fail(scope === 'view' ? 'Nie masz dostępu do Materiałów tej marki.' : 'Nie masz uprawnień do zmian w Materiałach tej marki.', 403, { code: 'forbidden' });
  }
  return access;
}

/** Marki z dostępem do Materiałów (domyślna pierwsza). */
export async function materialCompanies(ctx: NativeContext): Promise<MaterialCompany[]> {
  const { data, error } = await ctx.supabase.from('my_companies').select('id,name,is_default,is_active').order('name');
  if (error) dbFail(error, 'Nie udało się pobrać marek.');
  const rows = ((data || []) as Row[]).filter((row) => row.is_active !== false);
  const withAccess = await Promise.all(rows.map(async (row) => ({ row, access: await materialAccess(ctx, String(row.id)) })));
  return withAccess
    .filter((item) => item.access.view)
    .map(({ row, access }) => ({ id: String(row.id), name: text(row.name) || 'Marka', isDefault: row.is_default === true, access }))
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name, 'pl'));
}

// MARK: Elementy odpowiedzi

export type MaterialFolderItem = {
  id: string; companyId: string; parentId: string | null; name: string; systemKey: MaterialSystemFolder | null; sortOrder: number;
  createdAt: string | null; updatedAt: string | null; metaVersion: number;
};

export type MaterialFileItem = {
  id: string; companyId: string; folderId: string | null; name: string; status: 'uploading' | 'ready'; mime: string; kind: MaterialKind;
  size: number; sha256: string | null; contentVersion: number; metaVersion: number; width: number | null; height: number | null;
  duration: number | null; description: string; tags: string[]; eventId: string | null; sourceEventFileId: string | null;
  thumbnailUrl: string | null; createdAt: string | null; createdById: string | null; createdBy: string | null; updatedAt: string | null;
  updatedById: string | null; updatedBy: string | null;
};

const folderItem = (r: Row): MaterialFolderItem => ({
  id: r.id,
  companyId: r.company_id,
  parentId: r.parent_id ?? null,
  name: text(r.name) || 'Folder',
  systemKey: (r.system_key ?? null) as MaterialSystemFolder | null,
  sortOrder: Number(r.sort_order || 0),
  createdAt: r.created_at ?? null,
  updatedAt: r.updated_at ?? null,
  metaVersion: Number(r.meta_version || 1),
});

/** Kolejność folderów: domyślne marki (wg `sort_order`), potem alfabetycznie. */
const folderOrder = (a: MaterialFolderItem, b: MaterialFolderItem) =>
  Number(!a.systemKey) - Number(!b.systemKey) || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'pl', { numeric: true });

async function employeeNames(ctx: NativeContext, ids: unknown[]) {
  const unique = Array.from(new Set(ids.filter((id): id is string => typeof id === 'string' && UUID.test(id))));
  const names = new Map<string, string>();
  if (!unique.length) return names;
  const { data } = await ctx.supabase.from('employees').select('id,name,surname').in('id', unique);
  for (const e of (data || []) as Row[]) names.set(e.id, `${text(e.name)} ${text(e.surname)}`.trim() || 'Pracownik');
  return names;
}

async function signedUrls(ctx: NativeContext, bucket: string, paths: Array<string | null | undefined>) {
  const unique = Array.from(new Set(paths.filter((p): p is string => typeof p === 'string' && p.length > 0)));
  const urls = new Map<string, string>();
  for (let i = 0; i < unique.length; i += 100) {
    const { data } = await ctx.supabase.storage.from(bucket).createSignedUrls(unique.slice(i, i + 100), SIGNED_TTL);
    for (const item of data || []) if (item?.signedUrl && item.path) urls.set(item.path, item.signedUrl);
  }
  return urls;
}

async function fileItems(ctx: NativeContext, rows: Row[]): Promise<MaterialFileItem[]> {
  const [names, thumbs] = await Promise.all([
    employeeNames(ctx, rows.flatMap((r) => [r.created_by, r.updated_by])),
    signedUrls(ctx, MATERIALS_BUCKET, rows.map((r) => r.thumbnail_path)),
  ]);
  return rows.map((r) => ({
    id: r.id,
    companyId: r.company_id,
    folderId: r.folder_id ?? null,
    name: text(r.name) || 'plik',
    status: r.status === 'ready' ? 'ready' : 'uploading',
    mime: text(r.mime_type) || 'application/octet-stream',
    kind: materialKind(r.mime_type, r.name),
    size: Number(r.size_bytes || 0),
    sha256: r.content_sha256 ?? null,
    contentVersion: Number(r.content_version || 1),
    metaVersion: Number(r.meta_version || 1),
    width: r.width ?? null,
    height: r.height ?? null,
    duration: r.duration_seconds == null ? null : Number(r.duration_seconds),
    description: text(r.description),
    tags: Array.isArray(r.tags) ? r.tags.map(String) : [],
    eventId: r.event_id ?? null,
    sourceEventFileId: r.source_event_file_id ?? null,
    thumbnailUrl: r.thumbnail_path ? thumbs.get(r.thumbnail_path) || null : null,
    createdAt: r.created_at ?? null,
    createdById: r.created_by ?? null,
    createdBy: r.created_by ? names.get(r.created_by) || null : null,
    updatedAt: r.updated_at ?? null,
    updatedById: r.updated_by ?? null,
    updatedBy: r.updated_by ? names.get(r.updated_by) || null : null,
  }));
}

async function companyFolders(ctx: NativeContext, companyId: string): Promise<MaterialFolderItem[]> {
  const rows = await fetchAll((a, b) =>
    ctx.supabase.from('material_folders').select(FOLDER_COLUMNS).eq('company_id', companyId).order('id').range(a, b));
  return rows.map(folderItem);
}

/** Ścieżka folderu od głównego folderu marki (bez marki). */
function folderPath(folders: Map<string, MaterialFolderItem>, folderId: string | null): MaterialFolderItem[] {
  const path: MaterialFolderItem[] = [];
  let current = folderId ? folders.get(folderId) : undefined;
  for (let depth = 0; current && depth < 40; depth++) {
    path.unshift(current);
    current = current.parentId ? folders.get(current.parentId) : undefined;
  }
  return path;
}

async function fileRow(ctx: NativeContext, id: string): Promise<Row> {
  const { data, error } = await ctx.supabase.from('material_files').select(FILE_COLUMNS).eq('id', id).maybeSingle();
  if (error) dbFail(error, 'Nie udało się odczytać pliku.');
  if (!data) fail('Nie znaleziono pliku.', 404);
  return data as Row;
}

async function folderRow(ctx: NativeContext, id: string): Promise<Row> {
  const { data, error } = await ctx.supabase.from('material_folders').select(FOLDER_COLUMNS).eq('id', id).maybeSingle();
  if (error) dbFail(error, 'Nie udało się odczytać folderu.');
  if (!data) fail('Nie znaleziono folderu.', 404);
  return data as Row;
}

/** Folder docelowy w marce (`null` — główny folder marki). */
async function targetFolder(ctx: NativeContext, companyId: string, value: unknown): Promise<string | null> {
  const id = optionalUuid(value, 'Nieprawidłowy folder.');
  if (!id) return null;
  const folder = await folderRow(ctx, id);
  if (folder.company_id !== companyId) fail('Folder należy do innej marki.');
  return id;
}

// MARK: Odczyt

/** Ekran Materiałów: marki z dostępem, wybrana marka (domyślnie pierwsza), jej drzewo folderów i stan kosza. */
export async function materialsHome(ctx: NativeContext, params: URLSearchParams) {
  const companies = await materialCompanies(ctx);
  if (!companies.length) fail('Nie masz dostępu do Materiałów.', 403, { code: 'forbidden' });
  const wanted = (params.get('company') || '').toLowerCase();
  const company = companies.find((c) => c.id === wanted) || companies[0];
  const [folders, trash, events] = await Promise.all([
    companyFolders(ctx, company.id),
    company.access.manage
      ? ctx.supabase.from('material_trash').select('id', { count: 'exact', head: true }).eq('company_id', company.id)
      : Promise.resolve({ count: 0, error: null }),
    ctx.supabase.from('events').select('id').limit(1),
  ]);
  return {
    companies,
    company,
    access: company.access,
    folders: folders.sort(folderOrder),
    trashCount: Number((trash as { count: number | null }).count || 0),
    eventsAccess: !events.error && (events.data || []).length > 0,
    maxBytes: MATERIALS_MAX_FILE_BYTES,
  };
}

const SORTS: Record<string, { column: string; ascending: boolean }> = {
  name: { column: 'name', ascending: true },
  date: { column: 'updated_at', ascending: false },
  size: { column: 'size_bytes', ascending: false },
  type: { column: 'mime_type', ascending: true },
};

/** Zawartość folderu (albo głównego folderu marki): podfoldery, pliki (stronami), ścieżka. */
export async function materialsList(ctx: NativeContext, params: URLSearchParams) {
  const companyId = uuidOf(params.get('company'), 'Wybierz markę.');
  const access = await requireAccess(ctx, companyId, 'view');
  const folderId = optionalUuid(params.get('folder'), 'Nieprawidłowy folder.');
  const sort = SORTS[params.get('sort') || 'name'] || SORTS.name;
  const offset = Math.max(0, Math.min(MAX_ROWS, Number(params.get('offset')) || 0));
  const limit = Math.max(1, Math.min(LIST_LIMIT, Number(params.get('limit')) || LIST_LIMIT));
  const folders = await companyFolders(ctx, companyId);
  const byId = new Map(folders.map((f) => [f.id, f]));
  if (folderId && !byId.has(folderId)) fail('Nie znaleziono folderu.', 404);
  let query = ctx.supabase.from('material_files').select(FILE_COLUMNS, { count: 'exact' })
    .eq('company_id', companyId).eq('status', 'ready');
  query = folderId ? query.eq('folder_id', folderId) : query.is('folder_id', null);
  query = query.order(sort.column, { ascending: sort.ascending });
  if (sort.column !== 'name') query = query.order('name', { ascending: true });
  const { data, error, count } = await query.order('id').range(offset, offset + limit - 1);
  if (error) dbFail(error, 'Nie udało się pobrać plików.');
  return {
    companyId,
    access,
    folder: folderId ? byId.get(folderId)! : null,
    path: folderPath(byId, folderId),
    folders: folders.filter((f) => f.parentId === folderId).sort(folderOrder),
    files: await fileItems(ctx, (data || []) as Row[]),
    total: Number(count || 0),
    offset,
    limit,
  };
}

/** Wyszukiwanie: Materiały (nazwa, opis, tagi — wszystkie marki z dostępem albo jedna) albo pliki wydarzeń (wg dostępu do wydarzeń). */
export async function materialsSearch(ctx: NativeContext, params: URLSearchParams) {
  const q = text(params.get('q')).trim().slice(0, 200);
  const scope = params.get('scope') === 'events' ? 'events' : 'materials';
  await requireAccess(ctx, null, 'view');
  if (q.length < 2) return { q, scope, materials: [], events: [] };

  if (scope === 'events') {
    const { data, error } = await ctx.supabase.rpc('materials_search_event_files', { p_query: q, p_limit: 80 });
    if (error) dbFail(error, 'Nie udało się przeszukać plików eventów.');
    const rows = (data || []) as Row[];
    const thumbs = await signedUrls(ctx, EVENT_BUCKET,
      rows.filter((r) => materialKind(r.mime_type, r.name) === 'image').map((r) => r.file_path));
    return {
      q,
      scope,
      materials: [],
      events: rows.map((r) => ({
        id: r.id as string,
        eventId: r.event_id as string,
        eventName: text(r.event_name) || 'Event',
        eventDate: r.event_date ?? null,
        folderId: r.folder_id ?? null,
        folderName: r.folder_name ?? null,
        name: text(r.name) || 'plik',
        mime: text(r.mime_type) || 'application/octet-stream',
        kind: materialKind(r.mime_type, r.name),
        size: Number(r.file_size || 0),
        createdAt: r.created_at ?? null,
        thumbnailUrl: thumbs.get(r.file_path) || null,
      })),
    };
  }

  const companyId = optionalUuid(params.get('company'), 'Nieprawidłowa marka.');
  const { data, error } = await ctx.supabase.rpc('materials_search', { p_query: q, p_company: companyId, p_limit: 150 });
  if (error) dbFail(error, 'Nie udało się przeszukać Materiałów.');
  const rows = (data || []) as Row[];
  const companyIds = Array.from(new Set(rows.map((r) => r.company_id as string)));
  const [items, companies, trees] = await Promise.all([
    fileItems(ctx, rows),
    ctx.supabase.from('my_companies').select('id,name').in('id', companyIds.length ? companyIds : ['00000000-0000-0000-0000-000000000000']),
    Promise.all(companyIds.map((id) => companyFolders(ctx, id))),
  ]);
  const companyNames = new Map(((companies.data || []) as Row[]).map((c) => [c.id as string, text(c.name) || 'Marka']));
  const byId = new Map(trees.flat().map((f) => [f.id, f]));
  return {
    q,
    scope,
    events: [],
    materials: items.map((item) => ({
      ...item,
      companyName: companyNames.get(item.companyId) || 'Marka',
      path: folderPath(byId, item.folderId).map((f) => ({ id: f.id, name: f.name })),
    })),
  };
}

/** Karta pliku: dane, ścieżka, poprzednie wersje. */
export async function materialsFile(ctx: NativeContext, idValue: string) {
  const id = uuidOf(idValue, 'Nie znaleziono pliku.', 404);
  const row = await fileRow(ctx, id);
  const [access, folders, versions, event] = await Promise.all([
    materialAccess(ctx, row.company_id),
    companyFolders(ctx, row.company_id),
    ctx.supabase.from('material_file_versions')
      .select('id,content_version,size_bytes,mime_type,content_sha256,width,height,replaced_at,replaced_by')
      .eq('file_id', id).order('content_version', { ascending: false }),
    row.event_id
      ? ctx.supabase.from('events').select('id,name,event_date').eq('id', row.event_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  const versionRows = (versions.data || []) as Row[];
  const names = await employeeNames(ctx, versionRows.map((v) => v.replaced_by));
  const [item] = await fileItems(ctx, [row]);
  const byId = new Map(folders.map((f) => [f.id, f]));
  const ev = event.data as Row | null;
  return {
    file: item,
    access,
    path: folderPath(byId, row.folder_id ?? null),
    event: ev ? { id: ev.id as string, name: text(ev.name) || 'Event', date: ev.event_date ?? null } : null,
    versions: versionRows.map((v) => ({
      id: v.id as string,
      contentVersion: Number(v.content_version || 1),
      size: Number(v.size_bytes || 0),
      mime: text(v.mime_type),
      width: v.width ?? null,
      height: v.height ?? null,
      replacedAt: v.replaced_at ?? null,
      replacedBy: v.replaced_by ? names.get(v.replaced_by) || null : null,
    })),
  };
}

/** Podpisany adres (1 h): podgląd albo pobranie z nazwą pliku. `kind`: material | version | trash | event. */
export async function materialsUrl(ctx: NativeContext, params: URLSearchParams) {
  const kind = params.get('kind') || 'material';
  const id = uuidOf(params.get('id'), 'Nie znaleziono pliku.', 404);
  const download = params.get('mode') === 'download';
  let bucket = MATERIALS_BUCKET;
  let path = '';
  let name = 'plik';
  let mime = '';
  let size = 0;
  if (kind === 'event') {
    const { data, error } = await ctx.supabase.from('event_files').select('id,name,original_name,file_path,file_size,mime_type').eq('id', id).maybeSingle();
    if (error) dbFail(error, 'Nie udało się odczytać pliku eventu.');
    if (!data) fail('Nie znaleziono pliku eventu.', 404);
    const r = data as Row;
    bucket = EVENT_BUCKET;
    path = text(r.file_path);
    name = text(r.name) || text(r.original_name) || 'plik';
    mime = text(r.mime_type);
    size = Number(r.file_size || 0);
  } else if (kind === 'version') {
    const { data, error } = await ctx.supabase.from('material_file_versions').select('id,file_id,storage_path,size_bytes,mime_type,content_version').eq('id', id).maybeSingle();
    if (error) dbFail(error, 'Nie udało się odczytać wersji pliku.');
    if (!data) fail('Nie znaleziono wersji pliku.', 404);
    const r = data as Row;
    const file = await fileRow(ctx, r.file_id);
    path = text(r.storage_path);
    const ext = materialExtension(file.name);
    const base = ext ? String(file.name).slice(0, -(ext.length + 1)) : String(file.name);
    name = `${base} (wersja ${Number(r.content_version || 1)})${ext ? `.${ext}` : ''}`;
    mime = text(r.mime_type);
    size = Number(r.size_bytes || 0);
  } else if (kind === 'trash') {
    const { data, error } = await ctx.supabase.from('material_trash').select(TRASH_COLUMNS).eq('id', id).eq('kind', 'file').maybeSingle();
    if (error) dbFail(error, 'Nie udało się odczytać pliku z kosza.');
    if (!data) fail('Nie znaleziono pliku w koszu.', 404);
    const r = data as Row;
    path = text(r.storage_path);
    name = text(r.name) || 'plik';
    mime = text(r.mime_type);
    size = Number(r.size_bytes || 0);
  } else {
    const r = await fileRow(ctx, id);
    if (r.status !== 'ready') fail('Plik jest jeszcze wysyłany.', 409);
    path = text(r.storage_path);
    name = text(r.name) || 'plik';
    mime = text(r.mime_type);
    size = Number(r.size_bytes || 0);
  }
  if (!path) fail('Pliku nie ma w magazynie.', 410, { code: 'missing' });
  const { data: signed, error: signError } = await ctx.supabase.storage.from(bucket)
    .createSignedUrl(path, SIGNED_TTL, download ? { download: name } : undefined);
  if (signError || !signed?.signedUrl) fail('Pliku nie ma już w magazynie.', 410, { code: 'missing' });
  return { url: signed.signedUrl, name, mime, size, kind: materialKind(mime, name) };
}

/** Kosz marki (zarządzający). `insideFolder` — element usunięty razem z folderem (wraca z nim). */
export async function materialsTrash(ctx: NativeContext, params: URLSearchParams) {
  const companyId = uuidOf(params.get('company'), 'Wybierz markę.');
  await requireAccess(ctx, companyId, 'manage');
  const rows = await fetchAll((a, b) => ctx.supabase.from('material_trash').select(TRASH_COLUMNS)
    .eq('company_id', companyId).order('deleted_at', { ascending: false }).order('id').range(a, b));
  const [names, thumbs, folders] = await Promise.all([
    employeeNames(ctx, rows.map((r) => r.deleted_by)),
    signedUrls(ctx, MATERIALS_BUCKET, rows.map((r) => r.thumbnail_path)),
    companyFolders(ctx, companyId),
  ]);
  const byId = new Map(folders.map((f) => [f.id, f]));
  const deletedFolders = new Set(rows.filter((r) => r.kind === 'folder').map((r) => `${r.batch}:${r.item_id}`));
  return {
    items: rows.map((r) => {
      const kind = r.kind === 'folder' ? 'folder' : 'file';
      return {
        id: r.id as string,
        kind,
        itemId: r.item_id as string,
        parentId: (r.parent_folder_id ?? null) as string | null,
        insideFolder: !!r.parent_folder_id && deletedFolders.has(`${r.batch}:${r.parent_folder_id}`),
        location: r.parent_folder_id
          ? folderPath(byId, r.parent_folder_id).map((f) => f.name).join(' / ') || null
          : '',
        contains: kind === 'folder' ? rows.filter((x) => x.batch === r.batch && x.id !== r.id).length : 0,
        name: text(r.name) || (kind === 'folder' ? 'Folder' : 'plik'),
        size: Number(r.size_bytes || 0),
        mime: text(r.mime_type),
        fileKind: materialKind(r.mime_type, r.name),
        thumbnailUrl: r.thumbnail_path ? thumbs.get(r.thumbnail_path) || null : null,
        batch: String(r.batch),
        deletedAt: r.deleted_at,
        deletedBy: r.deleted_by ? names.get(r.deleted_by) || null : null,
        mine: r.deleted_by === ctx.employee.id,
        purgeAfter: r.purge_after,
      };
    }),
  };
}

// MARK: Foldery i pliki

export async function materialsCreateFolder(ctx: NativeContext, body: Row) {
  const companyId = uuidOf(body.companyId, 'Wybierz markę.');
  await requireAccess(ctx, companyId, 'manage');
  const name = nameOf(body.name, 'Podaj nazwę folderu.');
  const parentId = await targetFolder(ctx, companyId, body.parentId);
  const { data, error } = await ctx.supabase.from('material_folders')
    .insert({ company_id: companyId, parent_id: parentId, name }).select(FOLDER_COLUMNS).single();
  if (error) dbFail(error, 'Nie udało się utworzyć folderu.', 'Folder o tej nazwie już jest w tym miejscu.');
  return { item: folderItem(data as Row) };
}

/** Zmiana nazwy pliku albo folderu. */
export async function materialsRename(ctx: NativeContext, body: Row) {
  const id = uuidOf(body.id, 'Nieprawidłowy element.');
  if (body.kind === 'folder') {
    const name = nameOf(body.name, 'Podaj nazwę folderu.');
    const { data, error } = await ctx.supabase.from('material_folders').update({ name }).eq('id', id).select(FOLDER_COLUMNS).maybeSingle();
    if (error) dbFail(error, 'Nie udało się zmienić nazwy folderu.', 'Folder o tej nazwie już jest w tym miejscu.');
    if (!data) fail('Nie masz uprawnień do zmiany tego folderu.', 403, { code: 'forbidden' });
    return { folder: folderItem(data as Row) };
  }
  const name = nameOf(body.name, 'Podaj nazwę pliku.');
  const { data, error } = await ctx.supabase.from('material_files').update({ name }).eq('id', id).eq('status', 'ready').select(FILE_COLUMNS).maybeSingle();
  if (error) dbFail(error, 'Nie udało się zmienić nazwy pliku.', 'Plik o tej nazwie już jest w tym folderze.');
  if (!data) fail('Nie masz uprawnień do zmiany tego pliku.', 403, { code: 'forbidden' });
  const [file] = await fileItems(ctx, [data as Row]);
  return { file };
}

/** Przeniesienie plików i folderów do folderu tej samej marki (`targetFolderId: null` — główny folder marki). */
export async function materialsMove(ctx: NativeContext, body: Row) {
  const companyId = uuidOf(body.companyId, 'Wybierz markę.');
  await requireAccess(ctx, companyId, 'manage');
  const target = await targetFolder(ctx, companyId, body.targetFolderId);
  const items = (Array.isArray(body.items) ? body.items : []).slice(0, MATERIALS_MAX_BATCH) as Row[];
  if (!items.length) fail('Zaznacz elementy do przeniesienia.');
  let moved = 0;
  const failed: Array<{ id: string; name: string; error: string }> = [];
  for (const item of items) {
    const id = String(item?.id || '').toLowerCase();
    if (!UUID.test(id)) continue;
    const folder = item.kind === 'folder';
    const { data, error } = folder
      ? await ctx.supabase.from('material_folders').update({ parent_id: target }).eq('id', id).eq('company_id', companyId).select('id,name').maybeSingle()
      : await ctx.supabase.from('material_files').update({ folder_id: target }).eq('id', id).eq('company_id', companyId).select('id,name').maybeSingle();
    if (error || !data) {
      let message = 'Nie udało się przenieść.';
      try {
        if (error) dbFail(error, message, folder ? 'Folder o tej nazwie już jest w folderze docelowym.' : 'Plik o tej nazwie już jest w folderze docelowym.');
        message = 'Nie znaleziono elementu.';
      } catch (e) {
        message = e instanceof MaterialsError ? e.message : message;
      }
      failed.push({ id, name: text(item.name) || (folder ? 'Folder' : 'plik'), error: message });
      continue;
    }
    moved += 1;
  }
  return { moved, failed };
}

/**
 * „Nazwa kopia.pdf”, „Nazwa kopia 2.pdf” — wolna nazwa kopii w miejscu docelowym (jak w Finderze), `attempt` od 2.
 * Folder — bez rozszerzenia („Wersja 1.5 kopia”).
 */
function copyName(name: string, attempt: number, folder: boolean): string {
  if (attempt <= 1) return name;
  const ext = folder ? '' : materialExtension(name);
  const base = ext ? name.slice(0, -(ext.length + 1)) : name;
  const suffix = attempt === 2 ? ' kopia' : ` kopia ${attempt - 1}`;
  const room = 255 - suffix.length - (ext ? ext.length + 1 : 0);
  return `${base.slice(0, Math.max(1, room)).trimEnd()}${suffix}${ext ? `.${name.slice(-ext.length)}` : ''}`;
}

type CopyFailure = { id: string; name: string; error: string };

const failureText = (error: unknown, fallback: string) => (error instanceof MaterialsError ? error.message : fallback);

/** Nowy folder w miejscu docelowym; przy zajętej nazwie — „Nazwa kopia”, „Nazwa kopia 2”… (`numbered: false` — bez numerowania). */
async function insertCopiedFolder(ctx: NativeContext, companyId: string, parentId: string | null, name: string, numbered: boolean): Promise<Row> {
  for (let attempt = 1; attempt <= 50; attempt++) {
    const { data, error } = await ctx.supabase.from('material_folders')
      .insert({ company_id: companyId, parent_id: parentId, name: copyName(name, attempt, true) }).select(FOLDER_COLUMNS).single();
    if (!error) return data as Row;
    if (error.code !== '23505' || !numbered) dbFail(error, 'Nie udało się utworzyć kopii folderu.', 'Folder o tej nazwie już jest w tym miejscu.');
  }
  fail('Za dużo kopii o tej nazwie w tym folderze.', 409, { code: 'exists' });
}

/**
 * Kopia pliku: nowy wpis (`uploading`, wolna nazwa „… kopia”), kopia obiektu i miniatury w magazynie (bez pobierania), potwierdzenie
 * jak po wysyłce, opis i tagi z oryginału. Błąd — wpis i skopiowane obiekty znikają.
 */
async function copyFileTo(ctx: NativeContext, source: Row, companyId: string, folderId: string | null): Promise<Row> {
  if (source.status !== 'ready' || !text(source.storage_path)) fail('Plik jest jeszcze wysyłany.', 409);
  const row = await insertUploading(ctx, {
    companyId, folderId, name: text(source.name) || 'plik', mime: mimeOf(source.mime_type), size: Math.max(0, Number(source.size_bytes || 0)),
    sha256: sha256Of(source.content_sha256), rename: true, copy: true, eventId: source.event_id ?? null,
    sourceEventFileId: source.source_event_file_id ?? null,
  });
  const thumbPath = source.thumbnail_path ? `${companyId}/${row.id}/${objectName('t', '')}` : null;
  try {
    const storage = ctx.supabase.storage.from(MATERIALS_BUCKET);
    const { error: copyError } = await storage.copy(source.storage_path, row.storage_path);
    if (copyError) throw copyError;
    let thumb: string | null = null;
    if (thumbPath) {
      const { error: thumbError } = await storage.copy(source.thumbnail_path, thumbPath);
      if (!thumbError) thumb = thumbPath;
    }
    const { file } = await materialsCompleteUpload(ctx, {
      fileId: row.id, path: row.storage_path, thumbPath: thumb, width: source.width, height: source.height, duration: source.duration_seconds,
      sha256: source.content_sha256,
    });
    const description = text(source.description);
    const tags = Array.isArray(source.tags) ? source.tags : [];
    if (description || tags.length) {
      await ctx.supabase.from('material_files').update({ description, tags }).eq('id', row.id).eq('status', 'ready');
    }
    return { id: file.id, name: file.name };
  } catch (copyFailure) {
    console.error('[materials] copy', source.id, (copyFailure as Error)?.message);
    await ctx.supabase.from('material_files').delete().eq('id', row.id).eq('status', 'uploading');
    await removeUnused(ctx, [row.storage_path, thumbPath]);
    if (copyFailure instanceof MaterialsError) throw copyFailure;
    fail('Nie udało się skopiować pliku w magazynie.', 502);
  }
}

/** Zadania po kilka naraz (kopie obiektów w magazynie). */
async function inParallel<T>(items: T[], limit: number, work: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await work(item);
    }
  }));
}

/**
 * Kopiowanie plików i folderów (z całą zawartością) do folderu marki — także z innej marki z dostępem do podglądu
 * (`targetFolderId: null` — główny folder marki). Kopia obok oryginału dostaje nazwę „… kopia”. Kopie mają nowe obiekty w magazynie,
 * więc późniejsza zmiana albo usunięcie oryginału ich nie dotyczy. Zwraca nowe elementy z poziomu docelowego (do zaznaczenia).
 */
export async function materialsCopy(ctx: NativeContext, body: Row) {
  const companyId = uuidOf(body.companyId, 'Wybierz markę.');
  await requireAccess(ctx, companyId, 'manage');
  const target = await targetFolder(ctx, companyId, body.targetFolderId);
  const items = (Array.isArray(body.items) ? body.items : []).slice(0, MATERIALS_MAX_BATCH) as Row[];
  if (!items.length) fail('Zaznacz elementy do skopiowania.');

  // 1. Źródła: pliki i drzewa folderów (z plikami), limity sprawdzane przed kopiowaniem.
  const failed: CopyFailure[] = [];
  const foldersOf = new Map<string, MaterialFolderItem[]>();
  const companyTree = async (company: string) => {
    if (!foldersOf.has(company)) foldersOf.set(company, await companyFolders(ctx, company));
    return foldersOf.get(company)!;
  };
  type Plan = { kind: 'file'; source: Row } | { kind: 'folder'; source: Row; folders: MaterialFolderItem[]; files: Row[] };
  const plans: Plan[] = [];
  let fileCount = 0;
  let folderCount = 0;
  for (const item of items) {
    const id = String(item?.id || '').toLowerCase();
    if (!UUID.test(id)) continue;
    const label = text(item.name) || (item.kind === 'folder' ? 'Folder' : 'plik');
    try {
      if (item.kind === 'folder') {
        const source = await folderRow(ctx, id);
        const all = await companyTree(source.company_id);
        const subtree = [folderItem(source)];
        for (let i = 0; i < subtree.length && subtree.length <= COPY_MAX_FOLDERS; i++) {
          subtree.push(...all.filter((folder) => folder.parentId === subtree[i].id));
        }
        if (source.company_id === companyId && target && subtree.some((folder) => folder.id === target)) {
          fail('Nie można skopiować folderu do niego samego ani do jego podfolderu.');
        }
        const ids = subtree.map((folder) => folder.id);
        const files: Row[] = [];
        for (let i = 0; i < ids.length; i += 100) {
          const chunk = ids.slice(i, i + 100);
          files.push(...await fetchAll((a, b) => ctx.supabase.from('material_files').select(FILE_COLUMNS)
            .in('folder_id', chunk).eq('status', 'ready').order('id').range(a, b)));
        }
        folderCount += subtree.length;
        fileCount += files.length;
        plans.push({ kind: 'folder', source, folders: subtree, files });
      } else {
        const source = await fileRow(ctx, id);
        if (source.status !== 'ready') fail('Plik jest jeszcze wysyłany.', 409);
        fileCount += 1;
        plans.push({ kind: 'file', source });
      }
    } catch (error) {
      failed.push({ id, name: label, error: failureText(error, 'Nie udało się odczytać elementu.') });
    }
  }
  if (fileCount > COPY_MAX_FILES || folderCount > COPY_MAX_FOLDERS) {
    fail(`Naraz można skopiować najwyżej ${COPY_MAX_FILES} plików i ${COPY_MAX_FOLDERS} folderów (razem z zawartością folderów) — skopiuj mniejszymi częściami.`, 413);
  }

  // 2. Foldery (od góry drzewa), potem pliki — po kilka naraz.
  const created: Array<{ kind: 'file' | 'folder'; id: string; name: string }> = [];
  const jobs: Array<{ source: Row; folderId: string | null; top: boolean }> = [];
  let copied = 0;
  for (const plan of plans) {
    if (plan.kind === 'file') {
      jobs.push({ source: plan.source, folderId: target, top: true });
      continue;
    }
    try {
      const mapped = new Map<string, string>();
      const top = await insertCopiedFolder(ctx, companyId, target, text(plan.source.name) || 'Folder', true);
      mapped.set(plan.source.id, top.id);
      created.push({ kind: 'folder', id: top.id, name: top.name });
      for (const folder of plan.folders.slice(1)) {
        const parent = folder.parentId ? mapped.get(folder.parentId) : undefined;
        if (!parent) continue;
        const copy = await insertCopiedFolder(ctx, companyId, parent, folder.name, false);
        mapped.set(folder.id, copy.id);
      }
      for (const file of plan.files) {
        const folderId = file.folder_id ? mapped.get(file.folder_id) : undefined;
        if (folderId) jobs.push({ source: file, folderId, top: false });
      }
      copied += 1;
    } catch (error) {
      failed.push({ id: plan.source.id, name: text(plan.source.name) || 'Folder', error: failureText(error, 'Nie udało się skopiować folderu.') });
    }
  }
  await inParallel(jobs, COPY_PARALLEL, async (job) => {
    try {
      const file = await copyFileTo(ctx, job.source, companyId, job.folderId);
      if (job.top) {
        copied += 1;
        created.push({ kind: 'file', id: file.id, name: file.name });
      }
    } catch (error) {
      failed.push({ id: job.source.id, name: text(job.source.name) || 'plik', error: failureText(error, 'Nie udało się skopiować pliku.') });
    }
  });
  return { copied, failed, items: created };
}

/** Opis i tagi pliku. */
export async function materialsUpdateFile(ctx: NativeContext, body: Row) {
  const id = uuidOf(body.id, 'Nieprawidłowy plik.');
  const patch: Row = {};
  if (body.description !== undefined) patch.description = text(body.description).replace(/\r\n/g, '\n').trim().slice(0, 2000);
  if (body.tags !== undefined) patch.tags = cleanMaterialTags(body.tags);
  if (!Object.keys(patch).length) {
    const [file] = await fileItems(ctx, [await fileRow(ctx, id)]);
    return { file };
  }
  const { data, error } = await ctx.supabase.from('material_files').update(patch).eq('id', id).eq('status', 'ready').select(FILE_COLUMNS).maybeSingle();
  if (error) dbFail(error, 'Nie udało się zapisać opisu.');
  if (!data) fail('Nie masz uprawnień do zmiany tego pliku.', 403, { code: 'forbidden' });
  const [file] = await fileItems(ctx, [data as Row]);
  return { file };
}

/** Usunięcie (do kosza na 30 dni — wpisy tworzy baza, obiekty w magazynie zostają). Element, którego już nie ma, to sukces. */
export async function materialsRemove(ctx: NativeContext, body: Row) {
  const items = (Array.isArray(body.items) ? body.items : []).slice(0, MATERIALS_MAX_BATCH) as Row[];
  if (!items.length) fail('Zaznacz elementy do usunięcia.');
  let removed = 0;
  const failed: Array<{ id: string; name: string; error: string }> = [];
  for (const item of items) {
    const id = String(item?.id || '').toLowerCase();
    if (!UUID.test(id)) continue;
    const table = item.kind === 'folder' ? 'material_folders' : 'material_files';
    const { data, error } = await ctx.supabase.from(table).delete().eq('id', id).select('id');
    if (error) {
      let message = 'Nie udało się usunąć.';
      try {
        dbFail(error, message);
      } catch (e) {
        message = e instanceof MaterialsError ? e.message : message;
      }
      failed.push({ id, name: text(item.name), error: message });
      continue;
    }
    if (!data?.length) {
      const { data: still } = await ctx.supabase.from(table).select('id').eq('id', id).maybeSingle();
      if (still) {
        failed.push({ id, name: text(item.name), error: 'Nie masz uprawnień do usunięcia tego elementu.' });
        continue;
      }
    }
    removed += 1;
  }
  return { removed, failed };
}

// MARK: Wysyłka

/** Obiekt w magazynie (rozmiar i typ zapisane przez magazyn) albo `null`. */
async function storedObject(ctx: NativeContext, path: string): Promise<{ size: number; mime: string } | null> {
  const slash = path.lastIndexOf('/');
  const folder = path.slice(0, slash);
  const name = path.slice(slash + 1);
  const { data, error } = await ctx.supabase.storage.from(MATERIALS_BUCKET).list(folder, { limit: 100, search: name });
  if (error) {
    console.error('[materials] list', error.message);
    return null;
  }
  const item = (data || []).find((o: Row) => o.name === name) as Row | undefined;
  if (!item) return null;
  const meta = (item.metadata || {}) as Row;
  return { size: Math.max(0, Number(meta.size ?? meta.contentLength ?? 0) || 0), mime: text(meta.mimetype || meta.contentType) };
}

/** Usuwa z magazynu obiekty, których nic już nie używa (plik, miniatura, wpis w koszu, poprzednia wersja). */
async function removeUnused(ctx: NativeContext, paths: Array<string | null | undefined>) {
  const unique = Array.from(new Set(paths.filter((p): p is string => typeof p === 'string' && p.length > 0)));
  if (!unique.length) return 0;
  const { data: used, error } = await ctx.supabase.rpc('material_paths_in_use', { p_paths: unique });
  if (error) {
    console.error('[materials] paths in use', error.message);
    return 0;
  }
  const inUse = new Set<string>((used as string[] | null) || []);
  const free = unique.filter((p) => !inUse.has(p));
  for (let i = 0; i < free.length; i += 100) {
    const { error: removeError } = await ctx.supabase.storage.from(MATERIALS_BUCKET).remove(free.slice(i, i + 100));
    if (removeError) console.error('[materials] storage remove', removeError.message);
  }
  return free.length;
}

async function signUpload(ctx: NativeContext, path: string) {
  const { data, error } = await ctx.supabase.storage.from(MATERIALS_BUCKET).createSignedUploadUrl(path);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

/** Nowy wpis pliku (`uploading`) z wolną nazwą: przy konflikcie „Nazwa (2).ext”… (albo 409, gdy `rename = false`). */
async function insertUploading(ctx: NativeContext, input: {
  companyId: string; folderId: string | null; name: string; mime: string; size: number; sha256: string | null; rename: boolean;
  eventId?: string | null; sourceEventFileId?: string | null; copy?: boolean;
}) {
  const id = randomUUID();
  const path = `${input.companyId}/${id}/${objectName('f', input.name)}`;
  for (let attempt = 1; attempt <= 50; attempt++) {
    const name = attempt === 1 ? input.name : input.copy ? copyName(input.name, attempt, false) : numberedMaterialName(input.name, attempt);
    const { data, error } = await ctx.supabase.from('material_files').insert({
      id, company_id: input.companyId, folder_id: input.folderId, name, status: 'uploading', storage_path: path,
      mime_type: input.mime, size_bytes: input.size, content_sha256: input.sha256, event_id: input.eventId ?? null,
      source_event_file_id: input.sourceEventFileId ?? null,
    }).select(FILE_COLUMNS).single();
    if (!error) return data as Row;
    if (error.code !== '23505' || !input.rename) {
      dbFail(error, 'Nie udało się przygotować wysyłki.', 'Plik o tej nazwie już jest w tym folderze.');
    }
  }
  fail('Za dużo plików o tej nazwie w tym folderze.', 409, { code: 'exists' });
}

/**
 * Duplikat przy wysyłce: gotowy plik marki o tej samej treści (SHA-256 — przeglądarka do 100 MB, Mac zawsze), a bez skrótu
 * (większe pliki z przeglądarki, telefon) — o tej samej nazwie i rozmiarze w tym samym folderze. Kosz się nie liczy.
 */
async function duplicateOf(ctx: NativeContext, input: {
  companyId: string; folderId: string | null; name: string; size: number; sha256: string | null;
}): Promise<Row | null> {
  let query = ctx.supabase.from('material_files').select(FILE_COLUMNS).eq('company_id', input.companyId).eq('status', 'ready');
  if (input.sha256) {
    query = query.eq('content_sha256', input.sha256);
  } else {
    query = (input.folderId ? query.eq('folder_id', input.folderId) : query.is('folder_id', null)).eq('name', input.name).eq('size_bytes', input.size);
  }
  const { data, error } = await query.order('created_at', { ascending: true }).limit(1).maybeSingle();
  if (error) dbFail(error, 'Nie udało się sprawdzić, czy plik już jest w Materiałach.');
  return (data as Row | null) ?? null;
}

const mimeOf = (value: unknown) => {
  const mime = text(value).trim().toLowerCase().slice(0, 200);
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mime) ? mime : 'application/octet-stream';
};

/**
 * Krok 1 wysyłki: wpis pliku i jednorazowe podpisane adresy (plik idzie z przeglądarki / Maca / telefonu prosto do
 * magazynu). `replaceId` — nowa treść istniejącego pliku (`baseContentVersion` chroni przed nadpisaniem cudzej zmiany).
 * `thumbnail: true` — także adres na miniaturę JPEG przygotowaną przez klienta. `skipDuplicates: true` (CRM, Mac i telefon od wersji
 * z pomijaniem duplikatów; Finder i starsze wersje — bez) — gdy ten plik już jest w Materiałach marki (`duplicateOf`), bez wpisu
 * i adresów: `{ duplicate: true, file }` z istniejącym plikiem.
 */
export async function materialsPrepareUpload(ctx: NativeContext, body: Row) {
  const size = Math.max(0, Math.round(Number(body.size) || 0));
  if (size > MATERIALS_MAX_FILE_BYTES) fail('Plik jest większy niż 2 GB — tak duże pliki trzymaj na dysku firmowym.', 413);
  const mime = mimeOf(body.mime);
  const sha256 = sha256Of(body.sha256);

  if (body.replaceId) {
    const file = await fileRow(ctx, uuidOf(body.replaceId, 'Nieprawidłowy plik.'));
    await requireAccess(ctx, file.company_id, 'manage');
    if (file.status !== 'ready') fail('Plik jest jeszcze wysyłany.', 409);
    const base = Number.isFinite(Number(body.baseContentVersion)) ? Number(body.baseContentVersion) : null;
    if (base !== null && base !== Number(file.content_version || 1)) {
      const [item] = await fileItems(ctx, [file]);
      fail('Plik zmienił się w międzyczasie — odśwież widok.', 409, { code: 'conflict', file: item });
    }
    const path = `${file.company_id}/${file.id}/${objectName('f', text(body.name) || file.name)}`;
    const thumbPath = body.thumbnail ? `${file.company_id}/${file.id}/${objectName('t', '')}` : null;
    const [uploadUrl, thumbUploadUrl] = await Promise.all([signUpload(ctx, path), thumbPath ? signUpload(ctx, thumbPath) : null]);
    if (!uploadUrl) fail('Nie masz uprawnień do zmiany tego pliku.', 403, { code: 'forbidden' });
    return {
      fileId: file.id as string, name: file.name as string, replace: true, contentVersion: Number(file.content_version || 1),
      path, uploadUrl, thumbPath: thumbUploadUrl ? thumbPath : null, thumbUploadUrl,
    };
  }

  const companyId = uuidOf(body.companyId, 'Wybierz markę.');
  await requireAccess(ctx, companyId, 'manage');
  const folderId = await targetFolder(ctx, companyId, body.folderId);
  const name = nameOf(body.name, 'Plik nie ma nazwy.');
  if (body.skipDuplicates === true) {
    const existing = await duplicateOf(ctx, { companyId, folderId, name, size, sha256 });
    if (existing) {
      const [file] = await fileItems(ctx, [existing]);
      return { duplicate: true as const, file };
    }
  }
  const row = await insertUploading(ctx, { companyId, folderId, name, mime, size, sha256, rename: body.rename !== false });
  const thumbPath = body.thumbnail ? `${companyId}/${row.id}/${objectName('t', '')}` : null;
  const [uploadUrl, thumbUploadUrl] = await Promise.all([signUpload(ctx, row.storage_path), thumbPath ? signUpload(ctx, thumbPath) : null]);
  if (!uploadUrl) {
    await ctx.supabase.from('material_files').delete().eq('id', row.id);
    fail('Nie masz uprawnień do dodawania plików w tej marce.', 403, { code: 'forbidden' });
  }
  return {
    fileId: row.id as string, name: row.name as string, replace: false, contentVersion: 1,
    path: row.storage_path as string, uploadUrl, thumbPath: thumbUploadUrl ? thumbPath : null, thumbUploadUrl,
  };
}

/** Ścieżka obiektu tego pliku (`<marka>/<plik>/<nazwa>`). */
function ownPath(file: Row, value: unknown): string | null {
  const path = text(value);
  if (!path) return null;
  const prefix = `${file.company_id}/${file.id}/`;
  if (!path.startsWith(prefix) || !OBJECT_NAME.test(path.slice(prefix.length))) fail('Nieprawidłowa ścieżka pliku.');
  return path;
}

const IMAGE_THUMB_SOURCE = String.raw`async function (input) {
  var img = new Image();
  img.src = input.src;
  await img.decode();
  var W = img.naturalWidth, H = img.naturalHeight;
  if (!W || !H) throw new Error('empty');
  var scale = Math.min(1, input.side / Math.max(W, H));
  var w = Math.max(1, Math.round(W * scale)), h = Math.max(1, Math.round(H * scale));
  var canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  var g = canvas.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, w, h);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, w, h);
  return { width: W, height: H, thumb: canvas.toDataURL('image/jpeg', 0.82).split(',')[1] };
}`;

/** Miniatura zdjęcia na serwerze (Chromium), gdy klient jej nie przysłał. Błąd — bez miniatury. */
async function serverThumbnail(ctx: NativeContext, file: Row): Promise<Row | null> {
  const mime = text(file.mime_type).toLowerCase();
  if (!THUMB_MIME.test(mime) || Number(file.size_bytes || 0) > SERVER_THUMB_MAX_BYTES || file.thumbnail_path) return null;
  try {
    const { data, error } = await ctx.supabase.storage.from(MATERIALS_BUCKET).download(file.storage_path);
    if (error || !data) return null;
    const bytes = Buffer.from(await data.arrayBuffer());
    const result = await evaluateInBrowser<unknown, { width: number; height: number; thumb: string }>(IMAGE_THUMB_SOURCE, {
      src: `data:${mime};base64,${bytes.toString('base64')}`,
      side: 640,
    }, 60_000);
    if (!result?.thumb) return null;
    const thumbPath = `${file.company_id}/${file.id}/${objectName('t', '')}`;
    const { error: uploadError } = await ctx.supabase.storage.from(MATERIALS_BUCKET)
      .upload(thumbPath, Buffer.from(result.thumb, 'base64'), { contentType: 'image/jpeg', upsert: false, cacheControl: '31536000' });
    if (uploadError) return null;
    const patch: Row = { thumbnail_path: thumbPath };
    if (!file.width && positiveInt(result.width)) patch.width = positiveInt(result.width);
    if (!file.height && positiveInt(result.height)) patch.height = positiveInt(result.height);
    const { data: updated, error: updateError } = await ctx.supabase.from('material_files').update(patch)
      .eq('id', file.id).eq('storage_path', file.storage_path).select(FILE_COLUMNS).maybeSingle();
    if (updateError || !updated) {
      await removeUnused(ctx, [thumbPath]);
      return null;
    }
    return updated as Row;
  } catch (error) {
    console.error('[materials] thumbnail', file.id, error);
    return null;
  }
}

/**
 * Krok 2 wysyłki: potwierdzenie — rozmiar i typ z magazynu, miniatura (klienta albo serwera), wymiary i czas trwania.
 * Nowy plik: `uploading` → `ready`. Podmiana treści: nowa ścieżka, poprzednia treść zostaje jako wersja (30 dni).
 */
export async function materialsCompleteUpload(ctx: NativeContext, body: Row) {
  const file = await fileRow(ctx, uuidOf(body.fileId, 'Nieprawidłowy plik.'));
  const path = ownPath(file, body.path);
  if (!path) fail('Nieprawidłowa ścieżka pliku.');
  let thumbPath = ownPath(file, body.thumbPath);
  const stored = await storedObject(ctx, path);
  if (!stored) fail('Plik nie dotarł do magazynu. Spróbuj wysłać go ponownie.', 409, { code: 'missing' });
  if (stored.size > MATERIALS_MAX_FILE_BYTES) {
    await removeUnused(ctx, [path, thumbPath]);
    fail('Plik jest większy niż 2 GB.', 413);
  }
  if (thumbPath && !(await storedObject(ctx, thumbPath))) thumbPath = null;
  const meta: Row = {
    size_bytes: stored.size,
    mime_type: mimeOf(stored.mime || file.mime_type),
    thumbnail_path: thumbPath,
    width: positiveInt(body.width),
    height: positiveInt(body.height),
    duration_seconds: duration(body.duration),
  };
  const sha = sha256Of(body.sha256);

  let updated: Row | null = null;
  if (file.status === 'uploading') {
    if (path !== file.storage_path) fail('Nieprawidłowa ścieżka pliku.');
    const { data, error } = await ctx.supabase.from('material_files')
      .update({ ...meta, status: 'ready', ...(sha ? { content_sha256: sha } : {}) })
      .eq('id', file.id).eq('status', 'uploading').select(FILE_COLUMNS).maybeSingle();
    if (error) dbFail(error, 'Nie udało się zapisać pliku.');
    updated = (data as Row) || null;
  } else if (path === file.storage_path) {
    // Powtórzone potwierdzenie (np. ponowienie po zerwanym połączeniu) — plik już gotowy.
    updated = file;
  } else {
    const base = Number.isFinite(Number(body.baseContentVersion)) ? Number(body.baseContentVersion) : null;
    let query = ctx.supabase.from('material_files').update({ ...meta, storage_path: path, content_sha256: sha }).eq('id', file.id);
    if (base !== null) query = query.eq('content_version', base);
    const { data, error } = await query.select(FILE_COLUMNS).maybeSingle();
    if (error) {
      await removeUnused(ctx, [path, thumbPath]);
      dbFail(error, 'Nie udało się podmienić pliku.');
    }
    if (!data) {
      await removeUnused(ctx, [path, thumbPath]);
      const now = await fileRow(ctx, file.id);
      const [item] = await fileItems(ctx, [now]);
      if (base !== null && Number(now.content_version || 1) !== base) {
        fail('Plik zmienił się w międzyczasie — odśwież widok.', 409, { code: 'conflict', file: item });
      }
      fail('Nie masz uprawnień do zmiany tego pliku.', 403, { code: 'forbidden' });
    }
    updated = data as Row;
  }
  if (!updated) fail('Nie udało się zapisać pliku.', 409);
  const withThumb = (!updated.thumbnail_path && (await serverThumbnail(ctx, updated))) || updated;
  const [item] = await fileItems(ctx, [withThumb]);
  return { file: item };
}

/** Przerwana wysyłka: nowy plik znika (bez kosza), przy podmianie — tylko wysłany obiekt. */
export async function materialsCancelUpload(ctx: NativeContext, body: Row) {
  const id = uuidOf(body.fileId, 'Nieprawidłowy plik.');
  const { data } = await ctx.supabase.from('material_files').select(FILE_COLUMNS).eq('id', id).maybeSingle();
  const file = data as Row | null;
  if (!file) return { ok: true };
  const paths = [ownPath(file, body.path), ownPath(file, body.thumbPath)];
  if (file.status === 'uploading') {
    const { error } = await ctx.supabase.from('material_files').delete().eq('id', id).eq('status', 'uploading');
    if (error) dbFail(error, 'Nie udało się anulować wysyłki.');
    paths.push(file.storage_path, file.thumbnail_path);
  }
  await removeUnused(ctx, paths);
  return { ok: true };
}

/**
 * Kopia pliku wydarzenia w Materiałach (np. najlepsze zdjęcia z realizacji → „Zdjęcia”): wpis z odnośnikiem do wydarzenia
 * i pliku źródłowego, kopia obiektu w magazynie (bez pobierania przez przeglądarkę). Ten sam plik w tej marce — bez duplikatu.
 */
export async function materialsCopyFromEvent(ctx: NativeContext, body: Row) {
  const eventFileId = uuidOf(body.eventFileId, 'Nieprawidłowy plik eventu.');
  const companyId = uuidOf(body.companyId, 'Wybierz markę.');
  await requireAccess(ctx, companyId, 'manage');
  const folderId = await targetFolder(ctx, companyId, body.folderId);
  const { data: source, error } = await ctx.supabase.from('event_files')
    .select('id,event_id,name,original_name,file_path,file_size,mime_type').eq('id', eventFileId).maybeSingle();
  if (error) dbFail(error, 'Nie udało się odczytać pliku eventu.');
  if (!source) fail('Nie znaleziono pliku eventu.', 404);
  const src = source as Row;
  if (!text(src.file_path)) fail('Pliku eventu nie ma w magazynie.', 410);
  if (Number(src.file_size || 0) > MATERIALS_MAX_FILE_BYTES) fail('Plik jest większy niż 2 GB.', 413);

  const { data: existing } = await ctx.supabase.from('material_files').select(FILE_COLUMNS)
    .eq('company_id', companyId).eq('source_event_file_id', eventFileId).eq('status', 'ready').limit(1).maybeSingle();
  if (existing) {
    const [file] = await fileItems(ctx, [existing as Row]);
    return { file, existing: true };
  }

  const name = cleanMaterialName(src.name) || cleanMaterialName(src.original_name) || 'plik';
  const row = await insertUploading(ctx, {
    companyId, folderId, name, mime: mimeOf(src.mime_type), size: Math.max(0, Number(src.file_size || 0)), sha256: null, rename: true,
    eventId: src.event_id ?? null, sourceEventFileId: eventFileId,
  });
  try {
    const { error: copyError } = await ctx.supabase.storage.from(EVENT_BUCKET)
      .copy(src.file_path, row.storage_path, { destinationBucket: MATERIALS_BUCKET });
    if (copyError) {
      // Magazyn bez kopiowania między bucketami — przez serwer (pliki do 300 MB).
      if (Number(src.file_size || 0) > COPY_FALLBACK_MAX_BYTES) throw copyError;
      const { data: blob, error: downloadError } = await ctx.supabase.storage.from(EVENT_BUCKET).download(src.file_path);
      if (downloadError || !blob) throw downloadError || copyError;
      const { error: uploadError } = await ctx.supabase.storage.from(MATERIALS_BUCKET)
        .upload(row.storage_path, Buffer.from(await blob.arrayBuffer()), { contentType: mimeOf(src.mime_type), upsert: false });
      if (uploadError) throw uploadError;
    }
  } catch (copyFailure) {
    console.error('[materials] copy from event', eventFileId, (copyFailure as Error)?.message);
    await ctx.supabase.from('material_files').delete().eq('id', row.id).eq('status', 'uploading');
    await removeUnused(ctx, [row.storage_path]);
    fail('Nie udało się skopiować pliku eventu do Materiałów.', 502);
  }
  return { ...(await materialsCompleteUpload(ctx, { fileId: row.id, path: row.storage_path })), existing: false };
}

// MARK: Kosz i sprzątanie

/** Wpisy kosza: wskazane i — dla folderu — wszystko usunięte z nim w tej samej operacji. */
async function trashWithBatches(ctx: NativeContext, ids: string[]) {
  if (!ids.length) return [];
  const { data, error } = await ctx.supabase.from('material_trash').select('id,kind,batch,company_id').in('id', ids);
  if (error) dbFail(error, 'Nie udało się odczytać kosza.');
  const all = new Set(((data || []) as Row[]).map((r) => r.id as string));
  for (const folder of ((data || []) as Row[]).filter((r) => r.kind === 'folder')) {
    const { data: batch } = await ctx.supabase.from('material_trash').select('id').eq('batch', folder.batch).eq('company_id', folder.company_id);
    for (const r of (batch || []) as Row[]) all.add(r.id);
  }
  return Array.from(all);
}

const trashIdsOf = (value: unknown) =>
  Array.from(new Set((Array.isArray(value) ? value : []).map((v) => String(v).toLowerCase()).filter((v) => UUID.test(v)))).slice(0, 500);

/** Wpisy kosza po identyfikatorach usuniętych plików i folderów (Finder zna tylko je) — najnowszy wpis każdego elementu. */
async function trashIdsOfItems(ctx: NativeContext, value: unknown): Promise<string[]> {
  const itemIds = trashIdsOf(value);
  if (!itemIds.length) return [];
  const { data, error } = await ctx.supabase.from('material_trash').select('id,item_id,deleted_at').in('item_id', itemIds)
    .order('deleted_at', { ascending: false });
  if (error) dbFail(error, 'Nie udało się odczytać kosza.');
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const r of (data || []) as Row[]) {
    if (seen.has(r.item_id)) continue;
    seen.add(r.item_id);
    ids.push(r.id as string);
  }
  return ids;
}

/** Przywrócenie z kosza: `ids` — wpisy kosza (CRM), `itemIds` — usunięte pliki i foldery (Finder). */
export async function materialsRestore(ctx: NativeContext, body: Row) {
  const ids = Array.from(new Set([...trashIdsOf(body.ids), ...(await trashIdsOfItems(ctx, body.itemIds))]));
  if (!ids.length) return { restored: 0, skipped: 0 };
  const { data, error } = await ctx.supabase.rpc('restore_material_trash', { p_ids: ids });
  if (error) dbFail(error, 'Nie udało się przywrócić.');
  return data as { restored: number; skipped: number };
}

/** Usuwa wpisy kosza, poprzednie wersje ich plików i nieużywane obiekty w magazynie. */
async function dropTrash(ctx: NativeContext, ids: string[]) {
  if (!ids.length) return 0;
  const s = ctx.supabase;
  const { data: rows, error } = await s.from('material_trash').select('id,kind,item_id,storage_path,thumbnail_path').in('id', ids);
  if (error) dbFail(error, 'Nie udało się odczytać kosza.');
  const files = ((rows || []) as Row[]).filter((r) => r.kind === 'file');
  const paths: string[] = files.flatMap((r) => [r.storage_path, r.thumbnail_path]);
  if (files.length) {
    const { data: versions } = await s.from('material_file_versions').delete().in('file_id', files.map((r) => r.item_id)).select('storage_path,thumbnail_path');
    paths.push(...((versions || []) as Row[]).flatMap((v) => [v.storage_path, v.thumbnail_path]));
  }
  const { data: removed, error: deleteError } = await s.from('material_trash').delete().in('id', ids).select('id');
  if (deleteError) dbFail(deleteError, 'Nie udało się opróżnić kosza.');
  await removeUnused(ctx, paths);
  return (removed || []).length;
}

/** Usunięcie na zawsze (wskazane wpisy, usunięte elementy z Findera — `itemIds`, albo cały kosz marki: `companyId` + `all: true`). */
export async function materialsDeleteForever(ctx: NativeContext, body: Row) {
  let ids = Array.from(new Set([...trashIdsOf(body.ids), ...(await trashIdsOfItems(ctx, body.itemIds))]));
  if (body.all === true) {
    const companyId = uuidOf(body.companyId, 'Wybierz markę.');
    await requireAccess(ctx, companyId, 'manage');
    const rows = await fetchAll((a, b) => ctx.supabase.from('material_trash').select('id').eq('company_id', companyId).order('id').range(a, b));
    ids = rows.map((r) => r.id as string);
  }
  if (!ids.length) return { removed: 0 };
  const all = await trashWithBatches(ctx, ids);
  let removed = 0;
  for (let i = 0; i < all.length; i += 100) removed += await dropTrash(ctx, all.slice(i, i + 100));
  return { removed };
}

/**
 * Sprzątanie (CRM woła najwyżej co kilka godzin, Finder raz dziennie): kosz po 30 dniach, poprzednie wersje starsze niż
 * 30 dni, przerwane wysyłki starsze niż doba, stare ślady usunięć. Tylko w markach, którymi pracownik zarządza (RLS).
 */
export async function materialsPurge(ctx: NativeContext) {
  if (!(await materialAccess(ctx, null)).manage) return { trash: 0, versions: 0, uploads: 0, objects: 0, tombstones: 0 };
  const s = ctx.supabase;
  const now = new Date();
  const { data: expired, error } = await s.from('material_trash').select('id').lt('purge_after', now.toISOString()).limit(500);
  if (error) dbFail(error, 'Nie udało się odczytać kosza.');
  const trash = await dropTrash(ctx, ((expired || []) as Row[]).map((r) => r.id));

  const cutoff = new Date(now.getTime() - VERSION_KEEP_MS).toISOString();
  const { data: old } = await s.from('material_file_versions').select('id').lt('replaced_at', cutoff).limit(500);
  const oldIds = ((old || []) as Row[]).map((v) => v.id as string);
  const { data: versions } = oldIds.length
    ? await s.from('material_file_versions').delete().in('id', oldIds).select('storage_path,thumbnail_path')
    : { data: [] as Row[] };

  const staleCutoff = new Date(now.getTime() - UPLOAD_STALE_MS).toISOString();
  const { data: stale } = await s.from('material_files').select('id,storage_path,thumbnail_path')
    .eq('status', 'uploading').lt('created_at', staleCutoff).limit(500);
  const staleRows = (stale || []) as Row[];
  const { data: dropped } = staleRows.length
    ? await s.from('material_files').delete().in('id', staleRows.map((r) => r.id)).eq('status', 'uploading').select('id')
    : { data: [] as Row[] };

  const objects = await removeUnused(ctx, [
    ...((versions || []) as Row[]).flatMap((v) => [v.storage_path, v.thumbnail_path]),
    ...staleRows.flatMap((r) => [r.storage_path, r.thumbnail_path]),
  ]);
  const { data: tombstones } = await s.rpc('purge_material_tombstones');
  return { trash, versions: (versions || []).length, uploads: (dropped || []).length, objects, tombstones: Number(tombstones || 0) };
}

// MARK: Finder — Mavinci → Materiały → marka → foldery i pliki (rozszerzenie File Provider aplikacji na Maca)
//
// Mac trzyma kopię całego drzewa (bez treści plików — ta pobiera się przy otwarciu): `sync` na start, potem `changes` od
// kursora (zmienione foldery i pliki, ślady usunięć z `material_tombstones`, z zakładką 5 min) i lista marek z zakresami
// (odebrany dostęp albo zmiana „zarządzania” — Mac porównuje z kopią). Kursor starszy niż 25 dni albo za dużo zmian →
// `reset` (Mac wczytuje wszystko od nowa). Zapis: `createFolder`, `prepareUpload` / `completeUpload` (jak w CRM),
// `update` (nazwa, folder; treść — `prepareUpload` z `replaceId`), `finderRemove` (do kosza), `restore` / `deleteForever`
// z `itemIds`. Kosz w Finderze: elementy usunięte przez zalogowanego pracownika (`finderTrash`).

const SYNC_OVERLAP_MS = 5 * 60_000;
const SYNC_CURSOR_MAX_AGE_MS = 25 * 24 * 3600_000;
const SYNC_MAX_ROWS = 100_000;
const CHANGES_MAX_ROWS = 20_000;
const SYNC_FILE_COLUMNS =
  'id,company_id,folder_id,name,status,mime_type,size_bytes,content_sha256,content_version,meta_version,created_at,updated_at';

export type MaterialSyncCompany = { id: string; name: string; manage: boolean };
/** Plik w Finderze — bez miniatur i autorów (podpisywanie adresów tysięcy plików przy każdej synchronizacji jest zbędne). */
export type MaterialSyncFile = {
  id: string; companyId: string; folderId: string | null; name: string; mime: string; size: number; sha256: string | null;
  contentVersion: number; metaVersion: number; createdAt: string | null; updatedAt: string | null;
};

const syncFile = (r: Row): MaterialSyncFile => ({
  id: r.id,
  companyId: r.company_id,
  folderId: r.folder_id ?? null,
  name: text(r.name) || 'plik',
  mime: text(r.mime_type) || 'application/octet-stream',
  size: Number(r.size_bytes || 0),
  sha256: r.content_sha256 ?? null,
  contentVersion: Number(r.content_version || 1),
  metaVersion: Number(r.meta_version || 1),
  createdAt: r.created_at ?? null,
  updatedAt: r.updated_at ?? null,
});

/** Wszystkie wiersze stronami po 1000 z informacją o przekroczeniu limitu (niepełna lista nie może udawać pełnej). */
async function fetchRows(build: (from: number, to: number) => Page, max: number) {
  const rows: any[] = [];
  for (let from = 0; from < max; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

/** Marki z dostępem do Materiałów i zakres „zarządzanie” (dodawanie, zmiany i kosz w Finderze). */
async function syncCompanies(ctx: NativeContext): Promise<MaterialSyncCompany[]> {
  return (await materialCompanies(ctx)).map((c) => ({ id: c.id, name: c.name, manage: c.access.manage }));
}

/** Całe drzewo Materiałów pracownika (wszystkie marki z dostępem). Bez dostępu — pusta lista marek (Finder ukrywa folder). */
export async function materialsSync(ctx: NativeContext) {
  const cursor = new Date().toISOString();
  const companies = await syncCompanies(ctx);
  if (!companies.length) return { cursor, companies, folders: [], files: [] };
  const ids = companies.map((c) => c.id);
  const s = ctx.supabase;
  const [folders, files] = await Promise.all([
    fetchRows((a, b) => s.from('material_folders').select(FOLDER_COLUMNS).in('company_id', ids).order('id').range(a, b), SYNC_MAX_ROWS),
    fetchRows((a, b) => s.from('material_files').select(SYNC_FILE_COLUMNS).in('company_id', ids).eq('status', 'ready')
      .order('id').range(a, b), SYNC_MAX_ROWS),
  ]).catch((error) => dbFail(error, 'Nie udało się pobrać Materiałów.'));
  if (folders.truncated || files.truncated) fail('W Materiałach jest za dużo plików, by pokazać je w Finderze.', 413);
  return { cursor, companies, folders: folders.rows.map(folderItem), files: files.rows.map(syncFile) };
}

/** Zmiany od kursora: foldery, gotowe pliki, usunięcia i bieżąca lista marek. */
export async function materialsChanges(ctx: NativeContext, since: string | null) {
  const started = Date.now();
  const cursor = new Date(started).toISOString();
  const sinceMs = since ? Date.parse(since) : NaN;
  if (!Number.isFinite(sinceMs) || started - sinceMs > SYNC_CURSOR_MAX_AGE_MS) return { cursor, reset: true };
  const from = new Date(sinceMs - SYNC_OVERLAP_MS).toISOString();
  const companies = await syncCompanies(ctx);
  if (!companies.length) return { cursor, reset: false, companies, folders: [], files: [], deleted: [] };
  const ids = companies.map((c) => c.id);
  const s = ctx.supabase;
  const [folders, files, tombstones] = await Promise.all([
    fetchRows((a, b) => s.from('material_folders').select(FOLDER_COLUMNS).in('company_id', ids).gte('updated_at', from)
      .order('updated_at').order('id').range(a, b), CHANGES_MAX_ROWS),
    fetchRows((a, b) => s.from('material_files').select(SYNC_FILE_COLUMNS).in('company_id', ids).eq('status', 'ready')
      .gte('updated_at', from).order('updated_at').order('id').range(a, b), CHANGES_MAX_ROWS),
    fetchRows((a, b) => s.from('material_tombstones').select('id,kind,item_id,company_id,deleted_at').in('company_id', ids)
      .gte('deleted_at', from).order('id').range(a, b), CHANGES_MAX_ROWS),
  ]).catch((error) => dbFail(error, 'Nie udało się pobrać zmian w Materiałach.'));
  if (folders.truncated || files.truncated || tombstones.truncated) return { cursor, reset: true };
  // Element, który znów istnieje (np. przywrócony z kosza), wygrywa ze swoim śladem usunięcia.
  const alive = new Set<string>([...folders.rows.map((f) => f.id as string), ...files.rows.map((f) => f.id as string)]);
  const deleted = new Map<string, { kind: 'file' | 'folder'; id: string; companyId: string }>();
  for (const t of tombstones.rows) {
    if (alive.has(t.item_id)) continue;
    deleted.set(t.item_id, { kind: t.kind === 'folder' ? 'folder' : 'file', id: t.item_id, companyId: t.company_id });
  }
  return {
    cursor,
    reset: false,
    companies,
    folders: folders.rows.map(folderItem),
    files: files.rows.map(syncFile),
    deleted: Array.from(deleted.values()),
  };
}

/** Jeden folder albo gotowy plik (Finder pyta o element spoza kopii). */
export async function materialsSyncItem(ctx: NativeContext, kind: string, idValue: string) {
  const id = uuidOf(idValue, 'Nie znaleziono elementu.', 404);
  if (kind === 'folder') return { item: folderItem(await folderRow(ctx, id)) };
  const row = await fileRow(ctx, id);
  if (row.status !== 'ready') fail('Nie znaleziono pliku.', 404);
  return { item: syncFile(row) };
}

/** Plik z najnowszego wpisu kosza (stan sprzed usunięcia) — albo 404. */
async function trashedFileRow(ctx: NativeContext, id: string): Promise<Row> {
  const { data, error } = await ctx.supabase.from('material_trash')
    .select('item_id,company_id,parent_folder_id,name,storage_path,size_bytes,mime_type,snapshot,deleted_at')
    .eq('item_id', id).eq('kind', 'file').order('deleted_at', { ascending: false }).limit(1).maybeSingle();
  if (error) dbFail(error, 'Nie udało się odczytać pliku.');
  if (!data) fail('Nie znaleziono pliku.', 404);
  const t = data as Row;
  return {
    ...(t.snapshot && typeof t.snapshot === 'object' ? (t.snapshot as Row) : {}),
    id: t.item_id, company_id: t.company_id, folder_id: t.parent_folder_id, name: t.name, storage_path: t.storage_path,
    size_bytes: t.size_bytes, mime_type: t.mime_type,
  };
}

/** Podpisany adres treści (1 h) i aktualne wersje pliku; plik w koszu (podgląd w Koszu Findera) — treść z wpisu kosza. */
export async function materialsDownload(ctx: NativeContext, idValue: string) {
  const id = uuidOf(idValue, 'Nie znaleziono pliku.', 404);
  const { data, error } = await ctx.supabase.from('material_files').select(FILE_COLUMNS).eq('id', id).eq('status', 'ready').maybeSingle();
  if (error) dbFail(error, 'Nie udało się odczytać pliku.');
  const row: Row = (data as Row | null) || (await trashedFileRow(ctx, id));
  const path = text(row.storage_path);
  if (!path) fail('Pliku nie ma w magazynie.', 410, { code: 'missing' });
  const { data: signed, error: signError } = await ctx.supabase.storage.from(MATERIALS_BUCKET).createSignedUrl(path, SIGNED_TTL);
  if (signError || !signed?.signedUrl) fail('Pliku nie ma już w magazynie.', 410, { code: 'missing' });
  return { url: signed.signedUrl, item: syncFile(row) };
}

/** Kosz w Finderze: elementy usunięte przez zalogowanego pracownika w markach, którymi zarządza (RLS kosza). */
export async function materialsFinderTrash(ctx: NativeContext) {
  const { rows } = await fetchRows((a, b) => ctx.supabase.from('material_trash')
    .select('id,kind,item_id,company_id,parent_folder_id,name,size_bytes,mime_type,batch,deleted_at')
    .eq('deleted_by', ctx.employee.id).order('deleted_at', { ascending: false }).order('id').range(a, b), 5_000)
    .catch((error) => dbFail(error, 'Nie udało się odczytać kosza.'));
  return {
    items: rows.map((r) => ({
      id: r.id as string,
      kind: r.kind === 'folder' ? 'folder' : 'file',
      itemId: r.item_id as string,
      companyId: r.company_id as string,
      parentId: (r.parent_folder_id ?? null) as string | null,
      name: text(r.name) || (r.kind === 'folder' ? 'Folder' : 'plik'),
      size: Number(r.size_bytes || 0),
      mime: text(r.mime_type),
      batch: String(r.batch),
      deletedAt: r.deleted_at ?? null,
    })),
  };
}

/**
 * Zmiana z Findera: nazwa i folder (w obrębie marki; `parentId: null` — główny folder marki). Treść pliku zmienia się przez
 * `prepareUpload` z `replaceId` i `completeUpload` (wersje, konflikt 409 z aktualnym plikiem).
 */
export async function materialsFinderUpdate(ctx: NativeContext, body: Row) {
  const id = uuidOf(body.id, 'Nieprawidłowy element.');
  const s = ctx.supabase;
  const otherCompany = (companyId: string) =>
    body.companyId !== undefined && body.companyId !== null && String(body.companyId).toLowerCase() !== companyId;

  if (body.kind === 'folder') {
    const folder = await folderRow(ctx, id);
    const patch: Row = {};
    if (body.name !== undefined) {
      const name = nameOf(body.name, 'Podaj nazwę folderu.');
      if (name !== folder.name) patch.name = name;
    }
    if ('parentId' in body) {
      if (otherCompany(folder.company_id)) fail('Foldery można przenosić tylko w obrębie jednej marki.', 400, { code: 'crossCompany' });
      const parentId = await targetFolder(ctx, folder.company_id, body.parentId);
      if (parentId !== (folder.parent_id ?? null)) patch.parent_id = parentId;
    }
    if (!Object.keys(patch).length) return { item: folderItem(folder) };
    const { data, error } = await s.from('material_folders').update(patch).eq('id', id).select(FOLDER_COLUMNS).maybeSingle();
    if (error) dbFail(error, 'Nie udało się zmienić folderu.', 'Folder o tej nazwie już jest w tym miejscu.');
    if (!data) fail('Nie masz uprawnień do zmiany tego folderu.', 403, { code: 'forbidden' });
    return { item: folderItem(data as Row) };
  }

  const file = await fileRow(ctx, id);
  if (file.status !== 'ready') fail('Plik jest jeszcze wysyłany.', 409);
  const patch: Row = {};
  if (body.name !== undefined) {
    const name = nameOf(body.name, 'Podaj nazwę pliku.');
    if (name !== file.name) patch.name = name;
  }
  if ('parentId' in body) {
    if (otherCompany(file.company_id)) fail('Pliki można przenosić tylko w obrębie jednej marki.', 400, { code: 'crossCompany' });
    const folderId = await targetFolder(ctx, file.company_id, body.parentId);
    if (folderId !== (file.folder_id ?? null)) patch.folder_id = folderId;
  }
  if (!Object.keys(patch).length) return { item: syncFile(file) };
  const { data, error } = await s.from('material_files').update(patch).eq('id', id).eq('status', 'ready').select(FILE_COLUMNS).maybeSingle();
  if (error) dbFail(error, 'Nie udało się zmienić pliku.', 'Plik o tej nazwie już jest w tym folderze.');
  if (!data) fail('Nie masz uprawnień do zmiany tego pliku.', 403, { code: 'forbidden' });
  return { item: syncFile(data as Row) };
}

/** Usunięcie z Findera (do kosza na 30 dni). Element, którego już nie ma, to sukces; brak uprawnień — 403. */
export async function materialsFinderRemove(ctx: NativeContext, body: Row) {
  const id = uuidOf(body.id, 'Nieprawidłowy element.');
  const table = body.kind === 'folder' ? 'material_folders' : 'material_files';
  const { data, error } = await ctx.supabase.from(table).delete().eq('id', id).select('id');
  if (error) dbFail(error, 'Nie udało się usunąć.');
  if (!data?.length) {
    const { data: still } = await ctx.supabase.from(table).select('id').eq('id', id).maybeSingle();
    if (still) fail('Nie masz uprawnień do usunięcia tego elementu.', 403, { code: 'forbidden' });
    return { ok: true, gone: true };
  }
  return { ok: true };
}

// MARK: Albumy — Materiały → Albumy (główna baza zdjęć): odnośniki do plików marki, bez kopiowania
// Migracja `20261122140000_material_albums.sql`. Plik w koszu znika z albumu do czasu przywrócenia; usunięty na zawsze —
// odnośnik znika (wyzwalacz). Te same uprawnienia co Materiały (RLS `materials_can`).

const ALBUM_COLUMNS = 'id,company_id,name,description,cover_file_id,sort_order,created_by,created_at,updated_at';
const ALBUMS_MISSING = 'Albumy nie są jeszcze włączone na serwerze — potrzebna migracja 20261122140000_material_albums.sql.';

export type MaterialAlbumItem = {
  id: string; companyId: string; name: string; description: string; coverFileId: string | null; sortOrder: number; count: number;
  coverUrl: string | null; createdAt: string | null; updatedAt: string | null;
};

function albumFail(error: any, fallback: string): never {
  const code = String(error?.code || '');
  if (code === '42P01' || code === 'PGRST205' || code === 'PGRST202' || code === '42883') fail(ALBUMS_MISSING, 503, { code: 'migration' });
  if (code === '23505') fail('Album o tej nazwie już jest w tej marce.', 409, { code: 'exists' });
  if (code === 'P0002') fail('Nie znaleziono albumu.', 404);
  dbFail(error, fallback);
}

const albumIdsOf = (value: unknown) =>
  Array.from(new Set((Array.isArray(value) ? value : []).map((v) => String(v).toLowerCase()).filter((v) => UUID.test(v))))
    .slice(0, MATERIAL_ALBUM_LIMITS.batch);

async function albumRow(ctx: NativeContext, id: string): Promise<Row> {
  const { data, error } = await ctx.supabase.from('material_albums').select(ALBUM_COLUMNS).eq('id', id).maybeSingle();
  if (error) albumFail(error, 'Nie udało się odczytać albumu.');
  if (!data) fail('Nie znaleziono albumu.', 404);
  return data as Row;
}

/** Pliki albumów w kolejności (tylko istniejące, gotowe pliki). */
async function albumEntries(ctx: NativeContext, albumIds: string[]) {
  if (!albumIds.length) return { entries: [] as Array<{ albumId: string; fileId: string; sortOrder: number }>, files: new Map<string, Row>() };
  const items = await fetchAll((a, b) => ctx.supabase.from('material_album_items').select('album_id,file_id,sort_order,added_at')
    .in('album_id', albumIds).order('sort_order').order('added_at').range(a, b)).catch((error) => albumFail(error, 'Nie udało się odczytać albumów.'));
  const fileIds = Array.from(new Set(items.map((r: Row) => String(r.file_id))));
  const files = new Map<string, Row>();
  for (let i = 0; i < fileIds.length; i += 200) {
    const { data, error } = await ctx.supabase.from('material_files').select(FILE_COLUMNS).in('id', fileIds.slice(i, i + 200)).eq('status', 'ready');
    if (error) dbFail(error, 'Nie udało się odczytać plików albumu.');
    for (const r of (data || []) as Row[]) files.set(String(r.id), r);
  }
  const entries = items.filter((r: Row) => files.has(String(r.file_id)))
    .map((r: Row) => ({ albumId: String(r.album_id), fileId: String(r.file_id), sortOrder: Number(r.sort_order || 0) }));
  return { entries, files };
}

async function albumItems(ctx: NativeContext, rows: Row[]): Promise<MaterialAlbumItem[]> {
  const { entries, files } = await albumEntries(ctx, rows.map((r) => String(r.id)));
  const covers = new Map<string, Row>();
  for (const row of rows) {
    const own = entries.filter((e) => e.albumId === row.id);
    const chosen = (row.cover_file_id && own.find((e) => e.fileId === row.cover_file_id))
      || own.find((e) => files.get(e.fileId)?.thumbnail_path) || own[0];
    const file = chosen ? files.get(chosen.fileId) : undefined;
    if (file) covers.set(String(row.id), file);
  }
  const thumbs = await signedUrls(ctx, MATERIALS_BUCKET, Array.from(covers.values()).map((f) => f.thumbnail_path));
  return rows.map((row) => {
    const cover = covers.get(String(row.id));
    return {
      id: String(row.id),
      companyId: String(row.company_id),
      name: text(row.name) || 'Album',
      description: text(row.description),
      coverFileId: cover ? String(cover.id) : null,
      sortOrder: Number(row.sort_order || 0),
      count: entries.filter((e) => e.albumId === row.id).length,
      coverUrl: cover?.thumbnail_path ? thumbs.get(cover.thumbnail_path) || null : null,
      createdAt: row.created_at ?? null,
      updatedAt: row.updated_at ?? null,
    };
  });
}

/** Albumy marki (`company`) albo wszystkich marek z dostępem (bez `company`). */
export async function materialsAlbums(ctx: NativeContext, params: URLSearchParams) {
  const companyId = optionalUuid(params.get('company'), 'Nieprawidłowa marka.');
  if (companyId) await requireAccess(ctx, companyId, 'view');
  let query = ctx.supabase.from('material_albums').select(ALBUM_COLUMNS).order('sort_order').order('name').limit(1000);
  if (companyId) query = query.eq('company_id', companyId);
  const { data, error } = await query;
  if (error) albumFail(error, 'Nie udało się pobrać albumów.');
  const albums = await albumItems(ctx, (data || []) as Row[]);
  return { companyId, albums, access: await materialAccess(ctx, companyId) };
}

/** Album z plikami w kolejności albumu. */
export async function materialsAlbum(ctx: NativeContext, idValue: string) {
  const row = await albumRow(ctx, uuidOf(idValue, 'Nie znaleziono albumu.', 404));
  const [album] = await albumItems(ctx, [row]);
  const { entries, files } = await albumEntries(ctx, [String(row.id)]);
  const items = await fileItems(ctx, entries.map((e) => files.get(e.fileId)!).filter(Boolean));
  return { album, files: items, access: await materialAccess(ctx, String(row.company_id)) };
}

/** Pliki do albumu: tylko gotowe pliki tej samej marki; już dodane — bez zmian. */
async function addToAlbum(ctx: NativeContext, album: Row, value: unknown) {
  const ids = albumIdsOf(value);
  if (!ids.length) return { added: 0, skipped: 0 };
  const { data: files, error } = await ctx.supabase.from('material_files').select('id').in('id', ids)
    .eq('company_id', album.company_id).eq('status', 'ready');
  if (error) dbFail(error, 'Nie udało się odczytać plików.');
  const allowed = new Set(((files || []) as Row[]).map((r) => String(r.id)));
  const { data: present, error: presentError } = await ctx.supabase.from('material_album_items').select('file_id,sort_order').eq('album_id', album.id);
  if (presentError) albumFail(presentError, 'Nie udało się odczytać albumu.');
  const already = new Set(((present || []) as Row[]).map((r) => String(r.file_id)));
  let order = Math.max(0, ...((present || []) as Row[]).map((r) => Number(r.sort_order || 0)));
  const rows = ids.filter((id) => allowed.has(id) && !already.has(id))
    .map((id) => ({ album_id: album.id, file_id: id, company_id: album.company_id, sort_order: (order += 1) }));
  if (rows.length) {
    const { error: insertError } = await ctx.supabase.from('material_album_items')
      .upsert(rows, { onConflict: 'album_id,file_id', ignoreDuplicates: true });
    if (insertError) albumFail(insertError, 'Nie udało się dodać plików do albumu.');
  }
  return { added: rows.length, skipped: ids.length - rows.length };
}

export async function materialsCreateAlbum(ctx: NativeContext, body: Row) {
  const companyId = uuidOf(body.companyId, 'Wybierz markę.');
  await requireAccess(ctx, companyId, 'manage');
  const name = cleanMaterialAlbumName(body.name);
  if (!name) fail('Podaj nazwę albumu.');
  const { data: last } = await ctx.supabase.from('material_albums').select('sort_order').eq('company_id', companyId)
    .order('sort_order', { ascending: false }).limit(1);
  const { data, error } = await ctx.supabase.from('material_albums').insert({
    company_id: companyId, name, description: text(body.description).trim().slice(0, MATERIAL_ALBUM_LIMITS.description),
    sort_order: (Number(((last || []) as Row[])[0]?.sort_order) || 0) + 1,
  }).select(ALBUM_COLUMNS).single();
  if (error) albumFail(error, 'Nie udało się utworzyć albumu.');
  const added = await addToAlbum(ctx, data as Row, body.fileIds);
  const [album] = await albumItems(ctx, [await albumRow(ctx, String((data as Row).id))]);
  return { album, ...added };
}

export async function materialsUpdateAlbum(ctx: NativeContext, body: Row) {
  const row = await albumRow(ctx, uuidOf(body.id, 'Nie znaleziono albumu.', 404));
  await requireAccess(ctx, String(row.company_id), 'manage');
  const patch: Row = {};
  if ('name' in body) {
    const name = cleanMaterialAlbumName(body.name);
    if (!name) fail('Podaj nazwę albumu.');
    patch.name = name;
  }
  if ('description' in body) patch.description = text(body.description).trim().slice(0, MATERIAL_ALBUM_LIMITS.description);
  if ('coverFileId' in body) patch.cover_file_id = optionalUuid(body.coverFileId, 'Nieprawidłowy plik.');
  if (!Object.keys(patch).length) return { album: (await albumItems(ctx, [row]))[0] };
  const { data, error } = await ctx.supabase.from('material_albums').update(patch).eq('id', row.id).select(ALBUM_COLUMNS).maybeSingle();
  if (error) albumFail(error, 'Nie udało się zapisać albumu.');
  if (!data) fail('Nie masz uprawnień do zmian w Materiałach tej marki.', 403, { code: 'forbidden' });
  return { album: (await albumItems(ctx, [data as Row]))[0] };
}

/** Usunięcie albumu — pliki zostają w Materiałach. */
export async function materialsDeleteAlbum(ctx: NativeContext, body: Row) {
  const row = await albumRow(ctx, uuidOf(body.id, 'Nie znaleziono albumu.', 404));
  await requireAccess(ctx, String(row.company_id), 'manage');
  const { error } = await ctx.supabase.from('material_albums').delete().eq('id', row.id);
  if (error) albumFail(error, 'Nie udało się usunąć albumu.');
  return { deleted: String(row.id) };
}

export async function materialsAlbumAdd(ctx: NativeContext, body: Row) {
  const row = await albumRow(ctx, uuidOf(body.id, 'Nie znaleziono albumu.', 404));
  await requireAccess(ctx, String(row.company_id), 'manage');
  return addToAlbum(ctx, row, body.fileIds);
}

/** Usunięcie odnośników z albumu — pliki zostają w Materiałach. */
export async function materialsAlbumRemove(ctx: NativeContext, body: Row) {
  const row = await albumRow(ctx, uuidOf(body.id, 'Nie znaleziono albumu.', 404));
  await requireAccess(ctx, String(row.company_id), 'manage');
  const ids = albumIdsOf(body.fileIds);
  if (!ids.length) return { removed: 0 };
  const { data, error } = await ctx.supabase.from('material_album_items').delete().eq('album_id', row.id).in('file_id', ids).select('file_id');
  if (error) albumFail(error, 'Nie udało się usunąć plików z albumu.');
  if (row.cover_file_id && ids.includes(String(row.cover_file_id))) {
    await ctx.supabase.from('material_albums').update({ cover_file_id: null }).eq('id', row.id);
  }
  return { removed: (data || []).length };
}

export async function materialsAlbumReorder(ctx: NativeContext, body: Row) {
  const id = uuidOf(body.id, 'Nie znaleziono albumu.', 404);
  const { error } = await ctx.supabase.rpc('material_album_reorder', { p_album: id, p_files: albumIdsOf(body.fileIds) });
  if (error) albumFail(error, 'Nie udało się zmienić kolejności.');
  return { ok: true };
}

export async function materialsAlbumsReorder(ctx: NativeContext, body: Row) {
  const companyId = uuidOf(body.companyId, 'Wybierz markę.');
  const { error } = await ctx.supabase.rpc('material_albums_reorder', { p_company: companyId, p_ids: albumIdsOf(body.ids) });
  if (error) albumFail(error, 'Nie udało się zmienić kolejności albumów.');
  return { ok: true };
}

// MARK: Dla innych modułów (Prezentacje): plik z serwera do Materiałów i odczyt pliku

/** Plik Materiałów tokenem pracownika (RLS — tylko pliki marek z dostępem). */
export async function materialFileRow(ctx: NativeContext, idValue: unknown): Promise<Row> {
  return fileRow(ctx, uuidOf(idValue, 'Nie znaleziono pliku w Materiałach.', 404));
}

/**
 * Plik Materiałów z miejscem w Dysku (np. źródło zdjęcia produktu): nazwa, bieżąca wersja treści, „Marka / folder / …”.
 * Plik usunięty albo bez dostępu (RLS) — `null`.
 */
export async function materialFilePlace(ctx: NativeContext, idValue: unknown) {
  const id = String(idValue || '').toLowerCase();
  if (!UUID.test(id)) return null;
  const { data, error } = await ctx.supabase.from('material_files').select('id,company_id,folder_id,name,status,content_version')
    .eq('id', id).maybeSingle();
  if (error || !data) return null;
  const row = data as Row;
  const [folders, company] = await Promise.all([
    companyFolders(ctx, String(row.company_id)),
    ctx.supabase.from('my_companies').select('name').eq('id', row.company_id).maybeSingle(),
  ]);
  const byId = new Map(folders.map((f) => [f.id, f]));
  return {
    id,
    companyId: String(row.company_id),
    folderId: (row.folder_id as string | null) ?? null,
    name: text(row.name) || 'plik',
    ready: row.status === 'ready',
    contentVersion: Number(row.content_version || 1),
    place: [text((company.data as Row | null)?.name) || 'Marka', ...folderPath(byId, row.folder_id ?? null).map((f) => f.name)].join(' / '),
  };
}

/** Folder domyślny marki (`photos` — „Zdjęcia”) albo `null` — główny folder marki. */
export async function materialSystemFolder(ctx: NativeContext, companyId: string, key: MaterialSystemFolder) {
  const { data } = await ctx.supabase.from('material_folders').select('id,name').eq('company_id', companyId).eq('system_key', key).limit(1).maybeSingle();
  return data ? { id: String((data as Row).id), name: text((data as Row).name) } : null;
}

/**
 * Plik z serwera (np. zdjęcie dodane w Prezentacjach z dysku) do folderu marki. Ten sam plik (SHA-256) jest już w marce —
 * bez duplikatu (`existing: true`). Zwraca wiersz pliku (`FILE_COLUMNS`).
 */
export async function materialsStoreBytes(ctx: NativeContext, input: {
  companyId: string; folderId: string | null; name: string; mime: string; bytes: Buffer;
}): Promise<{ row: Row; existing: boolean }> {
  await requireAccess(ctx, input.companyId, 'manage');
  if (input.bytes.length > MATERIALS_MAX_FILE_BYTES) fail('Plik jest większy niż 2 GB.', 413);
  const folderId = await targetFolder(ctx, input.companyId, input.folderId);
  const sha256 = createHash('sha256').update(input.bytes).digest('hex');
  const { data: existing } = await ctx.supabase.from('material_files').select(FILE_COLUMNS)
    .eq('company_id', input.companyId).eq('content_sha256', sha256).eq('status', 'ready').order('created_at').limit(1).maybeSingle();
  if (existing) return { row: existing as Row, existing: true };
  const mime = mimeOf(input.mime);
  const row = await insertUploading(ctx, {
    companyId: input.companyId, folderId, name: cleanMaterialName(input.name) || 'zdjecie', mime, size: input.bytes.length, sha256, rename: true,
  });
  const { error } = await ctx.supabase.storage.from(MATERIALS_BUCKET).upload(row.storage_path, input.bytes, { contentType: mime, upsert: false });
  if (error) {
    console.error('[materials] store bytes', error.message);
    await ctx.supabase.from('material_files').delete().eq('id', row.id).eq('status', 'uploading');
    await removeUnused(ctx, [row.storage_path]);
    fail('Nie udało się zapisać pliku w Materiałach.', 502);
  }
  await materialsCompleteUpload(ctx, { fileId: row.id, path: row.storage_path, sha256 });
  return { row: await fileRow(ctx, String(row.id)), existing: false };
}
