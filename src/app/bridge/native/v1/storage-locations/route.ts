import { nativeContext, nativeJson, nativeUnauthorized, readJson } from '@/lib/native/auth';
import { deleteStorageLocation, saveStorageLocation, storageLocationsAccess, storageLocationsList } from '@/lib/native/storageLocations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/*
 * Lokalizacje magazynowe dla aplikacji na Maca (`src/lib/native/storageLocations.ts`) — jak `/crm/equipment/locations`
 * (dostęp jak Magazyn): GET op=list; POST op=save {id?, form} | delete {id} — z uprawnieniem do zarządzania magazynem.
 */

const failure = (message: string, status = 400) => nativeJson({ error: message }, status);
const errorText = (error: unknown, fallback: string) => (error as { message?: string })?.message || fallback;
const statusOf = (error: unknown) => (error as { status?: number })?.status || 500;

export async function GET(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  if (!storageLocationsAccess(ctx).canView) return failure('Nie masz dostępu do magazynu.', 403);
  const op = new URL(request.url).searchParams.get('op') || '';
  try {
    if (op === 'list') return nativeJson(await storageLocationsList(ctx));
    return failure('Nieznana operacja.');
  } catch (error) {
    if (statusOf(error) >= 500) console.error('[native-storage-locations]', op, error);
    return failure(errorText(error, 'Błąd pobierania lokalizacji'), statusOf(error));
  }
}

export async function POST(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  if (!storageLocationsAccess(ctx).canView) return failure('Nie masz dostępu do magazynu.', 403);
  let body: Record<string, unknown>;
  try {
    body = await readJson(request, 64_000);
  } catch {
    return failure('Nieprawidłowe dane.');
  }
  const op = String(body.op || '');
  try {
    switch (op) {
      case 'save': return nativeJson(await saveStorageLocation(ctx, body));
      case 'delete': return nativeJson(await deleteStorageLocation(ctx, body));
      default: return failure('Nieznana operacja.');
    }
  } catch (error) {
    if (statusOf(error) >= 500) console.error('[native-storage-locations]', op, error);
    return failure(errorText(error, 'Błąd zapisywania lokalizacji'), statusOf(error));
  }
}
