import { nativeContext, nativeJson, nativeUnauthorized, readJson } from '@/lib/native/auth';
import {
  MaterialsError, materialsAlbum, materialsAlbumAdd, materialsAlbumRemove, materialsAlbumReorder, materialsAlbums, materialsAlbumsReorder,
  materialsCreateAlbum, materialsDeleteAlbum, materialsUpdateAlbum, materialsCancelUpload, materialsChanges, materialsCompleteUpload, materialsCopy, materialsCopyFromEvent, materialsCreateFolder,
  materialsDeleteForever, materialsDownload, materialsFile, materialsFinderRemove, materialsFinderTrash, materialsFinderUpdate,
  materialsHome, materialsList, materialsMove, materialsPrepareUpload, materialsPurge, materialsRemove, materialsRename, materialsRestore,
  materialsSearch, materialsSync, materialsSyncItem, materialsTrash, materialsUpdateFile, materialsUrl,
} from '@/lib/materials/materials.server';
import { materialShareCreate, materialShareDelete, materialShareUpdate, materialSharesList } from '@/lib/materials/materialShares.server';
import { requestOrigin } from '@/lib/native/desktopRelease';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/*
 * Materiały — baza plików firmy. Jedno API dla CRM (`x-mavinci-client: web`), Findera (Mavinci → Materiały), aplikacji na
 * Maca i telefonu. Token pracownika (Bearer), RLS i funkcje bazy jak w przeglądarce (`src/lib/materials/materials.server.ts`).
 * GET op=home&company | list&company&folder&sort=name|date|size|type&offset&limit | search&q&scope=materials|events&company |
 *   file&id | url&kind=material|version|trash|event&id&mode=preview|download | trash&company.
 *   Finder: sync | changes&since | item&kind=folder|file&id | download&id | finderTrash.
 *   Albumy (migracja 20261122140000): albums&company? | album&id.
 * POST JSON op=createFolder {companyId, parentId, name} | rename {kind, id, name} | move {companyId, items[{kind, id, name}],
 *   targetFolderId} | copy {companyId, items[{kind, id, name}], targetFolderId} (kopie plików i folderów z zawartością — także
 *   z innej marki; obok oryginału „… kopia”) | updateFile {id, description, tags} | prepareUpload {companyId, folderId, name, size, mime, sha256,
 *   thumbnail, rename} albo {replaceId, baseContentVersion, …} | completeUpload {fileId, path, thumbPath, width, height,
 *   duration, sha256, baseContentVersion} | cancelUpload {fileId, path, thumbPath} | remove {items[{kind, id, name}]} |
 *   restore {ids | itemIds} | deleteForever {ids | itemIds} albo {companyId, all: true} | purge |
 *   copyFromEvent {eventFileId, companyId, folderId}. Finder: update {kind, id, name?, companyId?, parentId?} |
 *   finderRemove {kind, id}. Albumy: createAlbum {companyId, name, description?, fileIds?} | updateAlbum {id, name?,
 *   description?, coverFileId?} | deleteAlbum {id} | albumAdd {id, fileIds[]} | albumRemove {id, fileIds[]} |
 *   albumReorder {id, fileIds[]} | albumsReorder {companyId, ids[]} — album to odnośniki, pliki zostają na miejscu.
 * Linki do pobrania (migracja 20261130120000, `src/lib/materials/materialShares.server.ts`): GET shares&company. POST
 *   shareCreate {companyId, items[{kind: folder|album|file, id}], title, message, days, access: public|password, emails, password}
 *   → {share, password} (hasło jeden raz) | shareUpdate {id, title?, message?, days?, revoked?, access?, emails?, newPassword?,
 *   password?} → {share, password} | shareDelete {id}. Adres linku: `<serwer>/pobierz/<token>`.
 * Treść plików nie przechodzi przez serwer — wysyłka i pobieranie przez podpisane adresy magazynu.
 */

function failure(error: unknown, fallback: string) {
  if (error instanceof MaterialsError) {
    if (error.status >= 500) console.error('[native-materials]', error.message);
    return nativeJson({ error: error.message, ...error.extra }, error.status);
  }
  console.error('[native-materials]', error);
  return nativeJson({ error: fallback }, 500);
}

export async function GET(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  const params = new URL(request.url).searchParams;
  try {
    switch (params.get('op')) {
      case 'home':
        return nativeJson(await materialsHome(ctx, params));
      case 'list':
        return nativeJson(await materialsList(ctx, params));
      case 'search':
        return nativeJson(await materialsSearch(ctx, params));
      case 'file':
        return nativeJson(await materialsFile(ctx, params.get('id') || ''));
      case 'url':
        return nativeJson(await materialsUrl(ctx, params));
      case 'trash':
        return nativeJson(await materialsTrash(ctx, params));
      case 'sync':
        return nativeJson(await materialsSync(ctx));
      case 'changes':
        return nativeJson(await materialsChanges(ctx, params.get('since')));
      case 'item':
        return nativeJson(await materialsSyncItem(ctx, params.get('kind') || 'file', params.get('id') || ''));
      case 'download':
        return nativeJson(await materialsDownload(ctx, params.get('id') || ''));
      case 'finderTrash':
        return nativeJson(await materialsFinderTrash(ctx));
      case 'albums':
        return nativeJson(await materialsAlbums(ctx, params));
      case 'album':
        return nativeJson(await materialsAlbum(ctx, params.get('id') || ''));
      case 'shares':
        return nativeJson(await materialSharesList(ctx, params, requestOrigin(request)));
      default:
        return nativeJson({ error: 'Nieznana operacja.' }, 400);
    }
  } catch (error) {
    return failure(error, 'Nie udało się załadować Materiałów.');
  }
}

export async function POST(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  let body: Record<string, any>;
  try {
    body = await readJson(request, 1_000_000);
  } catch {
    return nativeJson({ error: 'Nieprawidłowe dane.' }, 400);
  }
  try {
    switch (String(body.op || '')) {
      case 'createFolder':
        return nativeJson(await materialsCreateFolder(ctx, body));
      case 'rename':
        return nativeJson(await materialsRename(ctx, body));
      case 'move':
        return nativeJson(await materialsMove(ctx, body));
      case 'copy':
        return nativeJson(await materialsCopy(ctx, body));
      case 'updateFile':
        return nativeJson(await materialsUpdateFile(ctx, body));
      case 'prepareUpload':
        return nativeJson(await materialsPrepareUpload(ctx, body));
      case 'completeUpload':
        return nativeJson(await materialsCompleteUpload(ctx, body));
      case 'cancelUpload':
        return nativeJson(await materialsCancelUpload(ctx, body));
      case 'remove':
        return nativeJson(await materialsRemove(ctx, body));
      case 'restore':
        return nativeJson(await materialsRestore(ctx, body));
      case 'deleteForever':
        return nativeJson(await materialsDeleteForever(ctx, body));
      case 'purge':
        return nativeJson(await materialsPurge(ctx));
      case 'copyFromEvent':
        return nativeJson(await materialsCopyFromEvent(ctx, body));
      case 'update':
        return nativeJson(await materialsFinderUpdate(ctx, body));
      case 'finderRemove':
        return nativeJson(await materialsFinderRemove(ctx, body));
      case 'createAlbum':
        return nativeJson(await materialsCreateAlbum(ctx, body));
      case 'updateAlbum':
        return nativeJson(await materialsUpdateAlbum(ctx, body));
      case 'deleteAlbum':
        return nativeJson(await materialsDeleteAlbum(ctx, body));
      case 'albumAdd':
        return nativeJson(await materialsAlbumAdd(ctx, body));
      case 'albumRemove':
        return nativeJson(await materialsAlbumRemove(ctx, body));
      case 'albumReorder':
        return nativeJson(await materialsAlbumReorder(ctx, body));
      case 'albumsReorder':
        return nativeJson(await materialsAlbumsReorder(ctx, body));
      case 'shareCreate':
        return nativeJson(await materialShareCreate(ctx, body, requestOrigin(request)));
      case 'shareUpdate':
        return nativeJson(await materialShareUpdate(ctx, body, requestOrigin(request)));
      case 'shareDelete':
        return nativeJson(await materialShareDelete(ctx, body));
      default:
        return nativeJson({ error: 'Nieznana operacja.' }, 400);
    }
  } catch (error) {
    return failure(error, 'Nie udało się zapisać zmian w Materiałach.');
  }
}
