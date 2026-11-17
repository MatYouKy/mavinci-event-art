import { nativeContext, nativeJson, nativeUnauthorized, readJson } from '@/lib/native/auth';
import {
  addColumn, addRecord, createDatabase, databaseDetail, databaseShares, databasesList, deleteColumn, deleteDatabase, deleteRecord,
  renameDatabase, reorderColumns, requireId, revokeShare, shareDatabase, updateCell, updateColumn,
} from '@/lib/native/databases';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/*
 * Bazy danych dla aplikacji na Maca (`src/lib/native/databases.ts`): GET op=list | database&id | shares&id;
 * POST op=create {name, description} | rename {id, name} | delete {id} | columnAdd {databaseId, name, type} |
 * columnUpdate {id, name?, width?} | columnDelete {id} | columnsReorder {databaseId, ids} | recordAdd {databaseId} |
 * cell {id, columnId, value} | recordDelete {id} | share {databaseId, employeeId} | revoke {databaseId, employeeId}.
 */

const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const failure = (message: string, status = 400) => nativeJson({ error: message }, status);
const errorText = (error: unknown, fallback: string) => (error as { message?: string })?.message || fallback;
const statusOf = (error: unknown) => (error as { status?: number } | null)?.status || 500;

export async function GET(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  const url = new URL(request.url);
  const id = url.searchParams.get('id') || '';
  try {
    switch (url.searchParams.get('op')) {
      case 'list':
        return nativeJson(await databasesList(ctx));
      case 'database':
        if (!uuid.test(id)) return failure('Nieprawidłowa baza danych.');
        return nativeJson(await databaseDetail(ctx, id));
      case 'shares':
        if (!uuid.test(id)) return failure('Nieprawidłowa baza danych.');
        return nativeJson(await databaseShares(ctx, id));
      default:
        return failure('Nieznana operacja.');
    }
  } catch (error) {
    if (statusOf(error) >= 500) console.error('[native-databases]', error);
    return failure(errorText(error, 'Nie udało się wczytać baz danych.'), statusOf(error));
  }
}

export async function POST(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  let body: Record<string, any>;
  try {
    body = await readJson(request, 256_000);
  } catch {
    return failure('Nieprawidłowe dane.');
  }
  try {
    switch (String(body.op || '')) {
      case 'create':
        return nativeJson(await createDatabase(ctx, body));
      case 'rename':
        return nativeJson(await renameDatabase(ctx, requireId(body.id, 'Nieprawidłowa baza danych.'), body.name));
      case 'delete':
        return nativeJson(await deleteDatabase(ctx, requireId(body.id, 'Nieprawidłowa baza danych.')));
      case 'columnAdd':
        return nativeJson(await addColumn(ctx, requireId(body.databaseId, 'Nieprawidłowa baza danych.'), body));
      case 'columnUpdate':
        return nativeJson(await updateColumn(ctx, requireId(body.id, 'Nieprawidłowa kolumna.'), body));
      case 'columnDelete':
        return nativeJson(await deleteColumn(ctx, requireId(body.id, 'Nieprawidłowa kolumna.')));
      case 'columnsReorder':
        return nativeJson(await reorderColumns(ctx, requireId(body.databaseId, 'Nieprawidłowa baza danych.'), body.ids));
      case 'recordAdd':
        return nativeJson(await addRecord(ctx, requireId(body.databaseId, 'Nieprawidłowa baza danych.')));
      case 'cell':
        return nativeJson(await updateCell(ctx, requireId(body.id, 'Nieprawidłowy rekord.'), String(body.columnId || ''), body.value ?? null));
      case 'recordDelete':
        return nativeJson(await deleteRecord(ctx, requireId(body.id, 'Nieprawidłowy rekord.')));
      case 'share':
        return nativeJson(await shareDatabase(ctx, requireId(body.databaseId, 'Nieprawidłowa baza danych.'), requireId(body.employeeId, 'Wybierz pracownika.')));
      case 'revoke':
        return nativeJson(await revokeShare(ctx, requireId(body.databaseId, 'Nieprawidłowa baza danych.'), requireId(body.employeeId, 'Wybierz pracownika.')));
      default:
        return failure('Nieznana operacja.');
    }
  } catch (error) {
    if (statusOf(error) >= 500) console.error('[native-databases]', error);
    return failure(errorText(error, 'Nie udało się zapisać zmian.'), statusOf(error));
  }
}
