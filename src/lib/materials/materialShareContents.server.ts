import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { MATERIAL_SHARE_LIMITS, materialKind, type MaterialKind, type MaterialShareItem, type MaterialShareItemKind } from './materialsShared';

/*
 * Zawartość linku do pobrania: pliki z udostępnionych folderów (z podfolderami — „na żywo”), albumów (w kolejności albumu)
 * i pojedyncze pliki, zawsze tylko gotowe pliki marki linku, bez powtórzeń, najwyżej `MATERIAL_SHARE_LIMITS.files`.
 * Ten sam kod liczy liczby na liście linków (token pracownika, RLS) i stronę `/pobierz` (klucz serwisowy — dlatego każde
 * zapytanie ma warunek marki linku).
 */

type Row = Record<string, any>;
const PAGE = 1000;
const IN_CHUNK = 150;
const FILE_COLUMNS = 'id,company_id,folder_id,name,status,storage_path,thumbnail_path,mime_type,size_bytes,width,height,duration_seconds,created_at,updated_at';

export type ShareFile = {
  id: string;
  name: string;
  mime: string;
  kind: MaterialKind;
  size: number;
  width: number | null;
  height: number | null;
  duration: number | null;
  updatedAt: string | null;
  storagePath: string;
  thumbnailPath: string | null;
  /** Podfolder względem udostępnionego folderu („Sesja/Wieczór”), w albumie i plikach — pusty. */
  dir: string;
};

export type ShareSection = {
  /** `f:<folder>`, `a:<album>` albo `files` — do pobrania części jako ZIP. */
  key: string;
  kind: MaterialShareItemKind | 'files';
  title: string;
  files: ShareFile[];
  bytes: number;
};

export type ShareContents = {
  sections: ShareSection[];
  items: MaterialShareItem[];
  fileCount: number;
  totalBytes: number;
  /** Plików było więcej niż limit — pokazujemy pierwsze `MATERIAL_SHARE_LIMITS.files`. */
  truncated: boolean;
};

export type ShareItemRow = { kind: MaterialShareItemKind; item_id: string; sort_order?: number | null };

const text = (value: unknown) => (typeof value === 'string' ? value : value == null ? '' : String(value));
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'pl', { numeric: true, sensitivity: 'base' });

async function fetchAll(build: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: any }>, max = MATERIAL_SHARE_LIMITS.files + PAGE) {
  const rows: Row[] = [];
  for (let from = 0; from < max; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...((data || []) as Row[]));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

function shareFile(row: Row, dir: string): ShareFile {
  return {
    id: String(row.id),
    name: text(row.name) || 'plik',
    mime: text(row.mime_type) || 'application/octet-stream',
    kind: materialKind(row.mime_type, row.name),
    size: Number(row.size_bytes || 0),
    width: row.width ?? null,
    height: row.height ?? null,
    duration: row.duration_seconds == null ? null : Number(row.duration_seconds),
    updatedAt: row.updated_at ?? row.created_at ?? null,
    storagePath: text(row.storage_path),
    thumbnailPath: row.thumbnail_path ? String(row.thumbnail_path) : null,
    dir,
  };
}

/** Pliki marki z podanych folderów (stronami, w porcjach identyfikatorów). */
async function filesInFolders(db: SupabaseClient, companyId: string, folderIds: string[]) {
  const rows: Row[] = [];
  for (let i = 0; i < folderIds.length && rows.length <= MATERIAL_SHARE_LIMITS.files; i += IN_CHUNK) {
    const chunk = folderIds.slice(i, i + IN_CHUNK);
    rows.push(...await fetchAll((a, b) => db.from('material_files').select(FILE_COLUMNS)
      .eq('company_id', companyId).eq('status', 'ready').in('folder_id', chunk).order('id').range(a, b)));
  }
  return rows;
}

async function filesById(db: SupabaseClient, companyId: string, ids: string[]) {
  const rows: Row[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const { data, error } = await db.from('material_files').select(FILE_COLUMNS)
      .eq('company_id', companyId).eq('status', 'ready').in('id', ids.slice(i, i + IN_CHUNK));
    if (error) throw error;
    rows.push(...((data || []) as Row[]));
  }
  return rows;
}

/** Zawartość linku marki `companyId` z elementów `items` (w kolejności `sort_order`); brakujące elementy — `missing`. */
export async function shareContents(db: SupabaseClient, companyId: string, items: ShareItemRow[]): Promise<ShareContents> {
  const ordered = [...items].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
  const folderItems = ordered.filter((item) => item.kind === 'folder');
  const albumItems = ordered.filter((item) => item.kind === 'album');
  const fileItems = ordered.filter((item) => item.kind === 'file');

  const folders = folderItems.length
    ? await fetchAll((a, b) => db.from('material_folders').select('id,parent_id,name').eq('company_id', companyId).order('id').range(a, b), 50_000)
    : [];
  const folderById = new Map(folders.map((f) => [String(f.id), f]));
  const children = new Map<string, string[]>();
  for (const folder of folders) {
    const parent = folder.parent_id ? String(folder.parent_id) : '';
    children.set(parent, [...(children.get(parent) || []), String(folder.id)]);
  }
  /** Ścieżka podfolderu względem `root` („Sesja/Wieczór”). */
  const relative = (root: string, folderId: string) => {
    const names: string[] = [];
    let current = folderById.get(folderId);
    for (let depth = 0; current && String(current.id) !== root && depth < 40; depth += 1) {
      names.unshift(text(current.name) || 'Folder');
      current = current.parent_id ? folderById.get(String(current.parent_id)) : undefined;
    }
    return names.join('/');
  };

  const albums = albumItems.length
    ? (await db.from('material_albums').select('id,name').eq('company_id', companyId).in('id', albumItems.map((item) => item.item_id))).data || []
    : [];
  const albumById = new Map((albums as Row[]).map((a) => [String(a.id), a]));
  const singleRows = fileItems.length ? await filesById(db, companyId, fileItems.map((item) => item.item_id)) : [];
  const singleById = new Map(singleRows.map((r) => [String(r.id), r]));

  const seen = new Set<string>();
  const sections: ShareSection[] = [];
  const itemInfo: MaterialShareItem[] = [];
  let truncated = false;
  let fileCount = 0;
  const take = (row: Row, dir: string, into: ShareFile[]) => {
    const id = String(row.id);
    if (seen.has(id)) return;
    if (fileCount >= MATERIAL_SHARE_LIMITS.files) { truncated = true; return; }
    seen.add(id);
    fileCount += 1;
    into.push(shareFile(row, dir));
  };

  const looseFiles: ShareFile[] = [];
  for (const item of ordered) {
    if (item.kind === 'folder') {
      const root = folderById.get(item.item_id);
      itemInfo.push({ kind: 'folder', id: item.item_id, name: text(root?.name) || 'Folder', missing: !root });
      if (!root) continue;
      const ids: string[] = [];
      const visit = (id: string, depth: number) => {
        ids.push(id);
        if (depth < 40) for (const child of children.get(id) || []) visit(child, depth + 1);
      };
      visit(item.item_id, 0);
      const rows = await filesInFolders(db, companyId, ids);
      const files: ShareFile[] = [];
      const sorted = rows.map((row) => ({ row, dir: relative(item.item_id, String(row.folder_id)), name: text(row.name) }))
        .sort((a, b) => a.dir.localeCompare(b.dir, 'pl', { numeric: true, sensitivity: 'base' }) || byName(a, b));
      for (const entry of sorted) take(entry.row, entry.dir, files);
      sections.push({ key: `f:${item.item_id}`, kind: 'folder', title: text(root.name) || 'Folder', files, bytes: files.reduce((sum, f) => sum + f.size, 0) });
    } else if (item.kind === 'album') {
      const album = albumById.get(item.item_id);
      itemInfo.push({ kind: 'album', id: item.item_id, name: text(album?.name) || 'Album', missing: !album });
      if (!album) continue;
      const entries = await fetchAll((a, b) => db.from('material_album_items').select('file_id,sort_order,added_at')
        .eq('album_id', item.item_id).eq('company_id', companyId).order('sort_order').order('added_at').range(a, b));
      const rows = await filesById(db, companyId, entries.map((entry) => String(entry.file_id)));
      const byId = new Map(rows.map((row) => [String(row.id), row]));
      const files: ShareFile[] = [];
      for (const entry of entries) {
        const row = byId.get(String(entry.file_id));
        if (row) take(row, '', files);
      }
      sections.push({ key: `a:${item.item_id}`, kind: 'album', title: text(album.name) || 'Album', files, bytes: files.reduce((sum, f) => sum + f.size, 0) });
    } else {
      const row = singleById.get(item.item_id);
      itemInfo.push({ kind: 'file', id: item.item_id, name: text(row?.name) || 'Plik', missing: !row });
      if (row) take(row, '', looseFiles);
    }
  }
  if (looseFiles.length) {
    sections.push({ key: 'files', kind: 'files', title: 'Pliki', files: looseFiles, bytes: looseFiles.reduce((sum, f) => sum + f.size, 0) });
  }
  return {
    sections: sections.filter((section) => section.files.length || section.kind !== 'files'),
    items: itemInfo,
    fileCount,
    totalBytes: sections.reduce((sum, s) => sum + s.bytes, 0),
    truncated,
  };
}
