import { nativeContext, nativeJson, nativeUnauthorized, readJson } from '@/lib/native/auth';
import {
  MaterialsError, materialsCancelUpload, materialsCompleteUpload, materialsCopyFromEvent, materialsCreateFolder, materialsDeleteForever,
  materialsFile, materialsHome, materialsList, materialsMove, materialsPrepareUpload, materialsPurge, materialsRemove, materialsRename,
  materialsRestore, materialsSearch, materialsTrash, materialsUpdateFile, materialsUrl,
} from '@/lib/materials/materials.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/*
 * Materiały — baza plików firmy. Jedno API dla CRM (`x-mavinci-client: web`), a w kolejnych etapach Findera, aplikacji na
 * Maca i telefonu. Token pracownika (Bearer), RLS i funkcje bazy jak w przeglądarce (`src/lib/materials/materials.server.ts`).
 * GET op=home&company | list&company&folder&sort=name|date|size|type&offset&limit | search&q&scope=materials|events&company |
 *   file&id | url&kind=material|version|trash|event&id&mode=preview|download | trash&company.
 * POST JSON op=createFolder {companyId, parentId, name} | rename {kind, id, name} | move {companyId, items[{kind, id, name}],
 *   targetFolderId} | updateFile {id, description, tags} | prepareUpload {companyId, folderId, name, size, mime, sha256,
 *   thumbnail, rename} albo {replaceId, baseContentVersion, …} | completeUpload {fileId, path, thumbPath, width, height,
 *   duration, sha256, baseContentVersion} | cancelUpload {fileId, path, thumbPath} | remove {items[{kind, id, name}]} |
 *   restore {ids} | deleteForever {ids} albo {companyId, all: true} | purge | copyFromEvent {eventFileId, companyId, folderId}.
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
      default:
        return nativeJson({ error: 'Nieznana operacja.' }, 400);
    }
  } catch (error) {
    return failure(error, 'Nie udało się zapisać zmian w Materiałach.');
  }
}
