import 'server-only';
import type { NativeContext } from './auth';
import { registerEventActions, registerEventQueries, registerEventTab } from './eventTabs';
import { canViewEventArea, parseEventAccess } from '@/lib/events/access/eventAccess';

/**
 * Zakładka „Pliki” (`EventFilesExplorer`): drzewo folderów i wszystkie pliki wydarzenia naraz (nawigacja po folderach na Macu
 * bez czekania na serwer), czynności jak w CRM — nowy folder, zmiana nazwy, usuwanie, kopiuj / wytnij / wklej, wysyłanie plików
 * (bezpośrednio do magazynu przez podpisany adres, potem wpis w `event_files`) i podpisane adresy do podglądu i pobierania.
 */

const BUCKET = 'event-files';
/** Ta sama reguła co `isFormalFolderName` w CRM i `private.event_folder_is_formal_name` w bazie. */
const FORMAL_FOLDER_NAME = /(umow|faktur|ofert|kalkulac|rozlicz|płatno|platno|kosztorys|finans)/;
const FORMAL_FOLDER_BLOCKED =
  'Ta nazwa jest zarezerwowana dla dokumentacji handlowej (oferty, umowy, faktury, kalkulacje, rozliczenia). Taki folder byłby dla Ciebie niewidoczny — wybierz inną nazwę.';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(message: string): never {
  throw Object.assign(new Error(message), { status: 400, expose: true });
}

async function canViewCommercialDocs(ctx: NativeContext, eventId: string) {
  const { data, error } = await ctx.supabase.rpc('get_event_access', { p_event_id: eventId });
  if (error || !data) return false;
  return canViewEventArea(parseEventAccess(data), 'commercial_docs');
}

async function filesTab(ctx: NativeContext, eventId: string) {
  const s = ctx.supabase;
  const [folders, files, commercial] = await Promise.all([
    s.from('event_folders').select('id,name,parent_folder_id,created_at').eq('event_id', eventId).order('name'),
    s.from('event_files').select('id,name,original_name,file_path,file_size,mime_type,folder_id,created_at').eq('event_id', eventId).order('name'),
    canViewCommercialDocs(ctx, eventId),
  ]);
  if (folders.error) throw folders.error;
  if (files.error) throw files.error;
  return {
    canViewCommercialDocs: commercial,
    folders: (folders.data || []).map((f: any) => ({ id: f.id, name: f.name || '', parentId: f.parent_folder_id ?? null, createdAt: f.created_at ?? null })),
    files: (files.data || []).map((f: any) => ({
      id: f.id, name: f.name || f.original_name || 'plik', originalName: f.original_name || f.name || 'plik', path: f.file_path, size: Number(f.file_size || 0),
      mime: f.mime_type || '', folderId: f.folder_id ?? null, createdAt: f.created_at ?? null,
    })),
  };
}

registerEventTab('files', filesTab);

async function folderOfEvent(ctx: NativeContext, eventId: string, folderId: unknown): Promise<string | null> {
  if (folderId === null || folderId === undefined || folderId === '') return null;
  const id = String(folderId);
  if (!UUID.test(id)) fail('Nieprawidłowy folder.');
  const { data, error } = await ctx.supabase.from('event_folders').select('id').eq('id', id).eq('event_id', eventId).maybeSingle();
  if (error || !data) fail('Nie znaleziono folderu.');
  return id;
}

export async function blockFormal(ctx: NativeContext, eventId: string, name: string) {
  if (FORMAL_FOLDER_NAME.test(name.toLocaleLowerCase('pl-PL')) && !(await canViewCommercialDocs(ctx, eventId))) fail(FORMAL_FOLDER_BLOCKED);
}

/** `handleCreateFolder`. */
async function createFolder(ctx: NativeContext, eventId: string, body: Record<string, any>) {
  const name = String(body.name || '').trim();
  if (!name) fail('Podaj nazwę folderu.');
  await blockFormal(ctx, eventId, name);
  const parent = await folderOfEvent(ctx, eventId, body.parentId);
  const { data, error } = await ctx.supabase.from('event_folders')
    .insert({ event_id: eventId, parent_folder_id: parent, name, created_by: ctx.employee.authUserId || ctx.employee.id })
    .select('id').single();
  if (error) fail('Błąd podczas tworzenia folderu');
  return { ok: true, id: (data as any).id };
}

/** `handleRename`. */
async function rename(ctx: NativeContext, eventId: string, body: Record<string, any>) {
  const name = String(body.name || '').trim();
  const id = String(body.id || '');
  if (!name || !UUID.test(id)) fail('Podaj nową nazwę.');
  if (body.kind === 'folder') {
    await blockFormal(ctx, eventId, name);
    const { error } = await ctx.supabase.from('event_folders').update({ name }).eq('id', id).eq('event_id', eventId);
    if (error) fail('Nie udało się zmienić nazwy folderu');
  } else {
    const { error } = await ctx.supabase.from('event_files').update({ name }).eq('id', id).eq('event_id', eventId);
    if (error) fail('Nie udało się zmienić nazwy pliku');
  }
  return { ok: true };
}

async function removeStored(ctx: NativeContext, paths: string[]) {
  const unique = Array.from(new Set(paths.filter(Boolean)));
  for (let i = 0; i < unique.length; i += 100) {
    const { error } = await ctx.supabase.storage.from(BUCKET).remove(unique.slice(i, i + 100));
    if (error) console.error('[native files] storage remove', error.message);
  }
}

/**
 * `handleDelete` — do kosza na 30 dni: usuwamy wpis (folder razem z zawartością usuwa baza), kosz i ślad usunięcia zapisują
 * wyzwalacze, a obiekt w magazynie zostaje do przywrócenia (sprząta go `finderFiles.ts` → `purge`).
 */
async function remove(ctx: NativeContext, eventId: string, body: Record<string, any>) {
  const id = String(body.id || '');
  if (!UUID.test(id)) fail('Nieprawidłowy element.');
  const s = ctx.supabase;
  if (body.kind === 'folder') {
    const { error } = await s.from('event_folders').delete().eq('id', id).eq('event_id', eventId);
    if (error) fail('Błąd podczas usuwania folderu');
    return { ok: true };
  }
  const { data: file } = await s.from('event_files').select('id,file_path').eq('id', id).eq('event_id', eventId).maybeSingle();
  if (!file) fail('Nie znaleziono pliku.');
  const { error } = await s.from('event_files').delete().eq('id', id).eq('event_id', eventId);
  if (error) fail('Błąd podczas usuwania pliku');
  return { ok: true };
}

/** `handleBulkDelete` — zaznaczone pliki (do kosza, jak `remove`). */
async function removeFiles(ctx: NativeContext, eventId: string, body: Record<string, any>) {
  const ids = (Array.isArray(body.ids) ? body.ids : []).map(String).filter((id: string) => UUID.test(id));
  if (!ids.length) return { ok: true, removed: 0 };
  const { data: files, error: readError } = await ctx.supabase.from('event_files').select('id,file_path').eq('event_id', eventId).in('id', ids);
  if (readError) fail('Błąd podczas usuwania');
  const { error } = await ctx.supabase.from('event_files').delete().eq('event_id', eventId).in('id', (files || []).map((f: any) => f.id));
  if (error) fail('Błąd podczas usuwania');
  return { ok: true, removed: (files || []).length };
}

export const storagePath = (eventId: string, name: string) => {
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  const safe = /^[a-z0-9]{1,12}$/.test(ext) ? ext : 'bin';
  return `${eventId}/${Date.now()}_${Math.random().toString(36).substring(7)}.${safe}`;
};

/** `handlePaste`: kopia (nowy obiekt w magazynie i wpis) albo wycięcie (przeniesienie do folderu). */
async function paste(ctx: NativeContext, eventId: string, body: Record<string, any>) {
  const ids = (Array.isArray(body.ids) ? body.ids : []).map(String).filter((id: string) => UUID.test(id));
  const target = await folderOfEvent(ctx, eventId, body.folderId);
  if (!ids.length) return { ok: true, pasted: 0 };
  const s = ctx.supabase;
  const { data: files, error } = await s.from('event_files').select('*').eq('event_id', eventId).in('id', ids);
  if (error) fail('Nie udało się wkleić plików');
  let pasted = 0;
  for (const f of (files || []) as any[]) {
    if (body.mode === 'cut') {
      const { error: moveError } = await s.from('event_files').update({ folder_id: target }).eq('id', f.id).eq('event_id', eventId);
      if (!moveError) pasted++;
      continue;
    }
    const path = storagePath(eventId, String(f.original_name || f.name || ''));
    const { error: copyError } = await s.storage.from(BUCKET).copy(f.file_path, path);
    if (copyError) { console.error('[native files] copy', copyError.message); continue; }
    const { error: insertError } = await s.from('event_files').insert({
      event_id: eventId, folder_id: target, name: f.name, original_name: f.original_name, file_path: path, file_size: f.file_size,
      mime_type: f.mime_type, thumbnail_url: f.thumbnail_url ?? null, uploaded_by: f.uploaded_by,
    });
    if (insertError) { await removeStored(ctx, [path]); continue; }
    pasted++;
  }
  return { ok: true, pasted };
}

/** Wysyłanie z Maca, krok 1: ścieżki jak w CRM i jednorazowe podpisane adresy wysyłki do magazynu (plik nie przechodzi przez serwer CRM). */
async function prepareUpload(ctx: NativeContext, eventId: string, body: Record<string, any>) {
  const names: string[] = (Array.isArray(body.names) ? body.names : []).map(String).slice(0, 200);
  const slots = [];
  for (const name of names) {
    const path = storagePath(eventId, name);
    const { data, error } = await ctx.supabase.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !data?.signedUrl) fail('Nie masz uprawnień do dodawania plików w tym wydarzeniu.');
    slots.push({ name, path, url: data.signedUrl });
  }
  return { slots };
}

/** Krok 2: wpisy w `event_files` dla wysłanych plików (jak `handleFileUpload`); nieudany wpis usuwa obiekt z magazynu. */
async function registerUploads(ctx: NativeContext, eventId: string, body: Record<string, any>) {
  const folder = await folderOfEvent(ctx, eventId, body.folderId);
  const pattern = new RegExp(`^${eventId}/\\d+_[a-z0-9]+\\.[a-z0-9]{1,12}$`);
  const added: string[] = [];
  const failed: string[] = [];
  for (const file of (Array.isArray(body.files) ? body.files : []) as any[]) {
    const path = String(file?.path || '');
    const name = String(file?.name || '').trim() || 'plik';
    if (!pattern.test(path)) { failed.push(name); continue; }
    const mime = String(file?.mime || '');
    const thumbnail = mime.startsWith('image/') ? ctx.supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl : null;
    const { error } = await ctx.supabase.from('event_files').insert({
      event_id: eventId, folder_id: folder, name, original_name: name, file_path: path, file_size: Math.max(0, Number(file?.size) || 0),
      mime_type: mime, thumbnail_url: thumbnail, uploaded_by: ctx.employee.authUserId || ctx.employee.id,
    });
    if (error) { await removeStored(ctx, [path]); failed.push(name); continue; }
    added.push(name);
  }
  return { ok: true, added: added.length, failed };
}

registerEventActions('files', { createFolder, rename, remove, removeFiles, paste, prepareUpload, registerUploads });

/** Podpisane adresy (1 h) do miniatur, podglądu i pobierania — tylko pliki tego wydarzenia widoczne dla pracownika. */
async function urls(ctx: NativeContext, eventId: string, params: URLSearchParams) {
  const ids = (params.get('ids') || '').split(',').filter((id) => UUID.test(id)).slice(0, 200);
  if (!ids.length) return { urls: {} };
  const { data: files, error } = await ctx.supabase.from('event_files').select('id,file_path').eq('event_id', eventId).in('id', ids);
  if (error) fail('Nie udało się pobrać plików.');
  const list = (files || []) as any[];
  const { data: signed } = await ctx.supabase.storage.from(BUCKET).createSignedUrls(list.map((f) => f.file_path), 3600);
  const byPath = new Map((signed || []).filter((s: any) => s.signedUrl).map((s: any) => [s.path, s.signedUrl]));
  return { urls: Object.fromEntries(list.filter((f) => byPath.has(f.file_path)).map((f) => [f.id, byPath.get(f.file_path)])) };
}

/**
 * Wydruki z karty wydarzenia na Macu (przycisk drukarki): dokumenty wygenerowane w wydarzeniu — oferty, kalkulacje, umowy,
 * agendy, checklisty sprzętu, faktury — najnowsze najpierw. Widoczność jak w zakładce Pliki (RLS: zakres wydarzeń, foldery
 * formalne, dokumenty wrażliwe, faktury dla handlowców).
 */
async function documents(ctx: NativeContext, eventId: string) {
  const { data, error } = await ctx.supabase.from('event_files')
    .select('id,name,original_name,document_type,mime_type,file_size,created_at,updated_at')
    .eq('event_id', eventId)
    .in('document_type', ['offer', 'calculation', 'contract', 'agenda', 'equipment_checklist', 'invoice'])
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) fail('Nie udało się pobrać dokumentów wydarzenia.');
  return {
    documents: ((data || []) as any[]).map((f) => ({
      id: f.id, name: f.name || f.original_name || 'dokument.pdf', type: f.document_type, mime: f.mime_type || '',
      size: Number(f.file_size || 0), createdAt: f.created_at ?? null, updatedAt: f.updated_at ?? f.created_at ?? null,
    })),
  };
}

registerEventQueries('files', { urls, documents });
