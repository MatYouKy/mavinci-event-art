import 'server-only';
import { randomBytes, randomUUID } from 'node:crypto';
import type { NativeContext } from '@/lib/native/auth';
import { evaluateInBrowser } from '@/lib/print/pdfRenderer.server';
import {
  MATERIALS_MAX_FILE_BYTES, MATERIALS_MAX_BATCH, NO_MATERIAL_ACCESS, cleanMaterialName, cleanMaterialTags, materialExtension,
  materialKind, numberedMaterialName, type MaterialAccess, type MaterialKind, type MaterialSystemFolder,
} from './materialsShared';

/*
 * Materiały — baza plików firmy (`/bridge/native/v1/materials`: CRM, w kolejnych etapach Finder, Mac i telefon).
 * Wszystko tokenem pracownika — RLS i funkcje bazy z migracji `20261120120000_materials_library.sql`, więc każdy klient widzi
 * dokładnie to, co w CRM. Treść plików nie przechodzi przez serwer: wysyłka i pobieranie przez podpisane adresy magazynu
 * (prywatny bucket `materials`). Serwer potwierdza wysyłkę (rozmiar i typ z magazynu), robi miniatury zdjęć, gdy klient
 * ich nie dostarczył, kopiuje pliki wydarzeń do Materiałów i sprząta magazyn (tylko obiekty, których nic już nie używa).
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
    if (error) dbFail(error, 'Nie udało się przeszukać plików wydarzeń.');
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
        eventName: text(r.event_name) || 'Wydarzenie',
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
    event: ev ? { id: ev.id as string, name: text(ev.name) || 'Wydarzenie', date: ev.event_date ?? null } : null,
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
    if (error) dbFail(error, 'Nie udało się odczytać pliku wydarzenia.');
    if (!data) fail('Nie znaleziono pliku wydarzenia.', 404);
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
  eventId?: string | null; sourceEventFileId?: string | null;
}) {
  const id = randomUUID();
  const path = `${input.companyId}/${id}/${objectName('f', input.name)}`;
  for (let attempt = 1; attempt <= 50; attempt++) {
    const name = attempt === 1 ? input.name : numberedMaterialName(input.name, attempt);
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

const mimeOf = (value: unknown) => {
  const mime = text(value).trim().toLowerCase().slice(0, 200);
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mime) ? mime : 'application/octet-stream';
};

/**
 * Krok 1 wysyłki: wpis pliku i jednorazowe podpisane adresy (plik idzie z przeglądarki / Maca / telefonu prosto do
 * magazynu). `replaceId` — nowa treść istniejącego pliku (`baseContentVersion` chroni przed nadpisaniem cudzej zmiany).
 * `thumbnail: true` — także adres na miniaturę JPEG przygotowaną przez klienta.
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
  const eventFileId = uuidOf(body.eventFileId, 'Nieprawidłowy plik wydarzenia.');
  const companyId = uuidOf(body.companyId, 'Wybierz markę.');
  await requireAccess(ctx, companyId, 'manage');
  const folderId = await targetFolder(ctx, companyId, body.folderId);
  const { data: source, error } = await ctx.supabase.from('event_files')
    .select('id,event_id,name,original_name,file_path,file_size,mime_type').eq('id', eventFileId).maybeSingle();
  if (error) dbFail(error, 'Nie udało się odczytać pliku wydarzenia.');
  if (!source) fail('Nie znaleziono pliku wydarzenia.', 404);
  const src = source as Row;
  if (!text(src.file_path)) fail('Pliku wydarzenia nie ma w magazynie.', 410);
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
    fail('Nie udało się skopiować pliku wydarzenia do Materiałów.', 502);
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

export async function materialsRestore(ctx: NativeContext, body: Row) {
  const ids = trashIdsOf(body.ids);
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

/** Usunięcie na zawsze (wskazane wpisy albo cały kosz marki: `companyId` + `all: true`). */
export async function materialsDeleteForever(ctx: NativeContext, body: Row) {
  let ids = trashIdsOf(body.ids);
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
