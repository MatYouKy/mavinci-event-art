import { nativeContext, nativeJson, nativeUnauthorized, readJson } from '@/lib/native/auth';
import {
  deleteLocation, deleteRoom, locationDetail, locationPlaceDetails, locationPlaceSearch, locationsList, saveLocation, saveOfferBackground, saveRoom,
  saveTechnical, uploadMaterial,
} from '@/lib/native/locations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/*
 * Lokalizacje dla aplikacji na Maca (`src/lib/native/locations.ts`): GET op=list | location&id | placeSearch&input&sessiontoken |
 * placeDetails&placeId&sessiontoken; POST multipart ?op=upload&locationId&kind=plan|photo (pole „file”);
 * POST JSON op=save {id?, …pola} | delete {id} | technical {id, details, previous} | roomSave {id, room, previous} |
 * roomDelete {id, roomId} | offerBackground {id, path|null, name?} („Tło ofert” — zdjęcie z galerii albo przesłane; `name` —
 * nazwa przesłanego pliku do galerii obiektu).
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
        return nativeJson(await locationsList(ctx));
      case 'location':
        if (!uuid.test(id)) return failure('Nieprawidłowa lokalizacja.');
        return nativeJson(await locationDetail(ctx, id));
      case 'placeSearch':
        return nativeJson(await locationPlaceSearch(ctx, url.searchParams));
      case 'placeDetails':
        return nativeJson(await locationPlaceDetails(ctx, url.searchParams));
      default:
        return failure('Nieznana operacja.');
    }
  } catch (error) {
    if (statusOf(error) >= 500) console.error('[native-locations]', error);
    return failure(errorText(error, 'Nie udało się wczytać lokalizacji.'), statusOf(error));
  }
}

export async function POST(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  const url = new URL(request.url);
  if (url.searchParams.get('op') === 'upload') {
    const locationId = url.searchParams.get('locationId') || '';
    if (!uuid.test(locationId)) return failure('Nieprawidłowa lokalizacja.');
    try {
      const form = await request.formData();
      const file = form.get('file');
      if (!(file instanceof File)) return failure('Brak pliku.');
      return nativeJson(await uploadMaterial(ctx, locationId, url.searchParams.get('kind') || '', file));
    } catch (error) {
      if (statusOf(error) >= 500) console.error('[native-locations] upload', error);
      return failure(errorText(error, 'Nie udało się przesłać pliku.'), statusOf(error));
    }
  }
  let body: Record<string, any>;
  try {
    body = await readJson(request, 512_000);
  } catch {
    return failure('Nieprawidłowe dane.');
  }
  const id = String(body.id || '');
  try {
    switch (String(body.op || '')) {
      case 'save':
        if (id && !uuid.test(id)) return failure('Nieprawidłowa lokalizacja.');
        return nativeJson(await saveLocation(ctx, id || null, body));
      case 'delete':
        if (!uuid.test(id)) return failure('Nieprawidłowa lokalizacja.');
        return nativeJson(await deleteLocation(ctx, id));
      case 'technical':
        if (!uuid.test(id)) return failure('Nieprawidłowa lokalizacja.');
        return nativeJson(await saveTechnical(ctx, id, body.details, body.previous));
      case 'roomSave':
        if (!uuid.test(id)) return failure('Nieprawidłowa lokalizacja.');
        return nativeJson(await saveRoom(ctx, id, body.room, body.previous));
      case 'offerBackground':
        if (!uuid.test(id)) return failure('Nieprawidłowa lokalizacja.');
        return nativeJson(await saveOfferBackground(ctx, id, body.path, body.name));
      case 'roomDelete':
        if (!uuid.test(id) || !uuid.test(String(body.roomId || ''))) return failure('Nieprawidłowa sala.');
        return nativeJson(await deleteRoom(ctx, id, String(body.roomId)));
      default:
        return failure('Nieznana operacja.');
    }
  } catch (error) {
    if (statusOf(error) >= 500) console.error('[native-locations]', error);
    return failure(errorText(error, 'Nie udało się zapisać zmian.'), statusOf(error));
  }
}
