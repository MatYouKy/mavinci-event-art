import { nativeContext, nativeJson, nativeUnauthorized, readJson } from '@/lib/native/auth';
import { eventsAccess } from '@/lib/native/events';
import {
  FinderError, finderChanges, finderCreateFile, finderCreateFolder, finderDeleteForever, finderDownload, finderEvents, finderItem,
  finderList, finderPrepareUpload, finderPurge, finderRemove, finderRestore, finderTrash, finderUpdate,
} from '@/lib/native/finderFiles';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/*
 * Pliki wydarzeń w Finderze (rozszerzenie File Provider aplikacji na Maca) — `src/lib/native/finderFiles.ts`.
 * GET  ?op=events | list&event= | changes&since= | item&kind=&id= | download&id= | trash[&event=]
 * POST {op: prepareUpload | createFolder | createFile | update | remove | restore | deleteForever | purge, …}
 * Tokenem pracownika (RLS jak w przeglądarce).
 */

function failure(error: unknown) {
  if (error instanceof FinderError) return nativeJson({ error: error.message, ...error.extra }, error.status);
  console.error('[native finder]', error);
  return nativeJson({ error: 'Nie udało się wykonać operacji na plikach.' }, 500);
}

export async function GET(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  if (!eventsAccess(ctx).canView) return nativeJson({ error: 'Nie masz dostępu do wydarzeń.' }, 403);
  const params = new URL(request.url).searchParams;
  try {
    switch (params.get('op')) {
      case 'events': return nativeJson(await finderEvents(ctx));
      case 'list': return nativeJson(await finderList(ctx, params.get('event') || ''));
      case 'changes': return nativeJson(await finderChanges(ctx, params.get('since')));
      case 'item': return nativeJson(await finderItem(ctx, params.get('kind') || 'file', params.get('id') || ''));
      case 'download': return nativeJson(await finderDownload(ctx, params.get('id') || ''));
      case 'trash': return nativeJson(await finderTrash(ctx, params.get('event')));
      default: return nativeJson({ error: 'Nieznana operacja.' }, 400);
    }
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  if (!eventsAccess(ctx).canView) return nativeJson({ error: 'Nie masz dostępu do wydarzeń.' }, 403);
  let body: Record<string, any>;
  try {
    body = await readJson(request, 100_000);
  } catch {
    return nativeJson({ error: 'Nieprawidłowe dane.' }, 400);
  }
  if (!body || typeof body !== 'object') return nativeJson({ error: 'Nieprawidłowe dane.' }, 400);
  try {
    switch (body.op) {
      case 'prepareUpload': return nativeJson(await finderPrepareUpload(ctx, body));
      case 'createFolder': return nativeJson(await finderCreateFolder(ctx, body));
      case 'createFile': return nativeJson(await finderCreateFile(ctx, body));
      case 'update': return nativeJson(await finderUpdate(ctx, body));
      case 'remove': return nativeJson(await finderRemove(ctx, body));
      case 'restore': return nativeJson(await finderRestore(ctx, body));
      case 'deleteForever': return nativeJson(await finderDeleteForever(ctx, body));
      case 'purge': return nativeJson(await finderPurge(ctx));
      default: return nativeJson({ error: 'Nieznana operacja.' }, 400);
    }
  } catch (error) {
    return failure(error);
  }
}
