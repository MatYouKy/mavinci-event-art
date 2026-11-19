import 'server-only';
import { randomUUID } from 'node:crypto';
import type { NativeContext } from './auth';
import { can } from './auth';
import { placeDetails, placeSearch } from './eventClientLocation';
import { isLocationBackgroundPath } from '@/lib/CRM/Offers/offerVenueBackground';

/*
 * Lokalizacje na Macu (`/crm/locations`, `/crm/locations/[id]`): lista obiektów, dodawanie i edycja (z wyszukiwaniem miejsc
 * Google jak `GoogleMapsPicker`), usuwanie, szczegóły obiektu, sale i przestrzenie zewnętrzne (`locations.rooms`) oraz
 * informacje techniczne obiektu i sal (`technical_details`, materiały w `location-materials`) oraz „Tło ofert” — zdjęcie miejsca
 * na okładkę ofert wydarzeń w tej lokalizacji (`offer_background_path`, `offerVenueBackground.ts`). Tokenem pracownika — RLS
 * (`locations_manage`) i walidacja w bazie (`validate_location_rooms`, `validate_location_technical_details`) jak w przeglądarce.
 */

type Row = Record<string, any>;
const UUID = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const BUCKET = 'location-materials';
const text = (value: unknown) => (typeof value === 'string' ? value : value == null ? '' : String(value));
const clip = (value: unknown, max: number) => text(value).trim().slice(0, max);
const orNull = (value: string) => (value ? value : null);
const num = (value: unknown) => (value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value));
const isObject = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value);

function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}
/** Błędy bazy: komunikaty walidacji (RAISE EXCEPTION) przekazujemy, brak uprawnień — po polsku, reszta — komunikat ogólny. */
function check(error: { message?: string; code?: string } | null | undefined, message: string) {
  if (!error) return;
  if (error.code === 'P0001' && error.message) fail(error.message);
  if (error.code === '42501') fail('Nie masz uprawnień do edycji lokalizacji.', 403);
  fail(message);
}

export const locationsAccess = (ctx: NativeContext) => ({ canManage: ctx.employee.isAdmin || can(ctx.employee, 'locations_manage') });
function requireManage(ctx: NativeContext) {
  if (!locationsAccess(ctx).canManage) fail('Nie masz uprawnień do edycji lokalizacji.', 403);
}

const LIST_FIELDS = 'id,name,address,city,postal_code,country,nip,contact_person_name,contact_phone,contact_email,notes,latitude,longitude,google_maps_url,google_place_id,formatted_address,created_at,updated_at';

function locationItem(row: Row) {
  return {
    id: String(row.id), name: text(row.name), address: text(row.address), city: text(row.city), postalCode: text(row.postal_code),
    country: text(row.country), nip: text(row.nip), contactName: text(row.contact_person_name), contactPhone: text(row.contact_phone),
    contactEmail: text(row.contact_email), notes: text(row.notes), latitude: num(row.latitude), longitude: num(row.longitude),
    googleMapsUrl: text(row.google_maps_url), placeId: text(row.google_place_id), formattedAddress: text(row.formatted_address),
    createdAt: text(row.created_at), updatedAt: text(row.updated_at),
  };
}

export async function locationsList(ctx: NativeContext) {
  const { data, error } = await ctx.supabase.from('locations').select(`${LIST_FIELDS},rooms`).order('name');
  check(error, 'Błąd podczas ładowania lokalizacji');
  return {
    access: locationsAccess(ctx),
    locations: ((data ?? []) as Row[]).map((row) => ({ ...locationItem(row), rooms: Array.isArray(row.rooms) ? row.rooms.length : 0 })),
  };
}

const isCad = (path: string) => /\.(dxf|dwg)$/i.test(path);

/** Podpisane linki (godzina) do rzutów i zdjęć obiektu i sal; pliki CAD do pobrania pod oryginalną nazwą (też baza hotelu — `offerBranding.ts`). */
export async function assetUrls(ctx: NativeContext, details: Row[]) {
  const assets = details.flatMap((item) => (Array.isArray(item?.assets) ? item.assets : []))
    .filter((asset: Row) => typeof asset?.path === 'string' && asset.path);
  const unique = Array.from(new Map<string, Row>(assets.map((asset: Row) => [String(asset.path), asset] as [string, Row])).values());
  const signed = await Promise.all(unique.map(async (asset) => {
    const result = await ctx.supabase.storage.from(BUCKET)
      .createSignedUrl(asset.path, 3600, isCad(asset.path) ? { download: text(asset.name) || 'plik' } : undefined);
    return [String(asset.path), result.error ? null : result.data?.signedUrl ?? null] as const;
  }));
  return Object.fromEntries(signed.filter(([, url]) => Boolean(url)));
}

/** Sala w kształcie dla aplikacji (i do porównania wersji przy zapisie). */
export const roomItem = (room: Row) => ({
  id: text(room.id), name: text(room.name), kind: room.kind === 'outdoor' ? 'outdoor' : 'indoor', notes: text(room.notes),
  technical: isObject(room.technical) ? room.technical : {},
});
const roomsOf = (row: Row) => (Array.isArray(row.rooms) ? row.rooms.filter(isObject) : []) as Row[];
const technicalOf = (row: Row) => (isObject(row.technical_details) ? row.technical_details : {});

export async function locationDetail(ctx: NativeContext, id: string) {
  const { data, error } = await ctx.supabase.from('locations').select(`${LIST_FIELDS},rooms,technical_details`).eq('id', id).maybeSingle();
  check(error, 'Błąd podczas pobierania lokalizacji');
  if (!data) fail('Lokalizacja nie została znaleziona', 404);
  const row = data as Row;
  const rooms = roomsOf(row).map(roomItem);
  const technical = technicalOf(row);
  // Osobno — baza bez migracji „Tła ofert” nie blokuje szczegółów lokalizacji.
  const background = await ctx.supabase.from('locations').select('offer_background_path').eq('id', id).maybeSingle();
  const backgroundPath = !background.error && typeof (background.data as Row | null)?.offer_background_path === 'string'
    ? text((background.data as Row).offer_background_path) : '';
  let offerBackground: { path: string; url: string | null } | null = null;
  if (backgroundPath) {
    const signed = await ctx.supabase.storage.from(BUCKET).createSignedUrl(backgroundPath, 3600);
    offerBackground = { path: backgroundPath, url: signed.error ? null : signed.data?.signedUrl ?? null };
  }
  return {
    access: locationsAccess(ctx),
    location: locationItem(row),
    rooms,
    technical,
    urls: await assetUrls(ctx, [technical, ...rooms.map((room) => room.technical)]),
    offerBackground,
    offerBackgroundReady: !background.error,
  };
}

/** „Tło ofert”: zdjęcie z galerii obiektu lub sali albo nowo przesłane (`op=upload&kind=photo`) — takie dopisujemy do galerii
 * obiektu (`name` — nazwa pliku), żeby było widoczne w materiałach i dało się je wybrać ponownie; `null` — usunięcie tła (zdjęcie
 * zostaje w galerii). Zapis tylko, gdy lokalizacja nie zmieniła się od odczytu (jak informacje techniczne). */
export async function saveOfferBackground(ctx: NativeContext, id: string, rawPath: unknown, rawName?: unknown) {
  requireManage(ctx);
  const path = rawPath === null || rawPath === undefined ? '' : text(rawPath).trim();
  if (path && !isLocationBackgroundPath(id, path)) fail('Wybierz zdjęcie JPG, PNG lub WebP z materiałów tej lokalizacji.');
  const row = await current(ctx, id);
  const technical = technicalOf(row);
  const assetsOf = (details: Row) => (Array.isArray(details.assets) ? details.assets as Row[] : []);
  const inGallery = [technical, ...roomsOf(row).map((room) => (isObject(room.technical) ? room.technical : {}))]
    .some((details) => assetsOf(details).some((asset) => text(asset?.path) === path));
  const patch: Row = { offer_background_path: path || null };
  if (path && !inGallery) {
    const assets = assetsOf(technical);
    if (assets.length >= 30) {
      fail('Galeria obiektu ma już 30 materiałów — usuń któryś w „Informacjach technicznych obiektu” albo wybierz zdjęcie z galerii.');
    }
    patch.technical_details = { ...technical, assets: [...assets, { path, name: clip(rawName, 255) || 'Tło ofert', kind: 'photo' }] };
  }
  const { data, error } = await ctx.supabase.from('locations').update(patch).eq('id', row.id).eq('updated_at', row.updated_at).select('id');
  if (error?.code === '23514') fail('Wybierz zdjęcie JPG, PNG lub WebP z materiałów tej lokalizacji.');
  if (error && /offer_background_path/.test(error.message || '')) {
    fail('Baza nie ma jeszcze „Tła ofert” — wykonaj migrację 20261119150000_location_offer_background.sql.');
  }
  check(error, 'Nie udało się zapisać tła ofert.');
  if (!data?.length) fail('Dane zmieniły się lub nie masz uprawnień. Odśwież lokalizację.', 409);
  if (!path) return { ok: true, message: 'Usunięto tło ofert — zdjęcie zostaje w galerii' };
  return {
    ok: true,
    message: patch.technical_details
      ? 'Tło ofert zapisane i dodane do galerii obiektu — nowe PDF ofert z tego miejsca dostaną to zdjęcie na okładce.'
      : 'Tło ofert zapisane — nowe PDF ofert z tego miejsca dostaną to zdjęcie na okładce.',
  };
}

export const locationPlaceSearch = (ctx: NativeContext, params: URLSearchParams) => placeSearch(ctx, '', params);
export const locationPlaceDetails = (ctx: NativeContext, params: URLSearchParams) => placeDetails(ctx, '', params);

/** Dodanie albo edycja obiektu (pola formularza CRM i dane kontaktowe); puste pola zapisujemy jako `null` (jak `normalizeLocationPayload`). */
export async function saveLocation(ctx: NativeContext, id: string | null, body: Row) {
  requireManage(ctx);
  const name = clip(body.name, 300);
  if (!name) fail('Nazwa lokalizacji jest wymagana');
  const contactEmail = clip(body.contactEmail, 300);
  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) fail('Podaj poprawny adres e-mail osoby kontaktowej.');
  const latitude = num(body.latitude), longitude = num(body.longitude);
  if ((latitude === null) !== (longitude === null)) fail('Podaj obie współrzędne albo żadnej.');
  if (latitude !== null && (latitude < -90 || latitude > 90 || longitude! < -180 || longitude! > 180)) fail('Nieprawidłowe współrzędne.');
  const payload = {
    name, address: orNull(clip(body.address, 300)), city: orNull(clip(body.city, 200)), postal_code: orNull(clip(body.postalCode, 20)),
    country: clip(body.country, 100) || 'Polska', nip: orNull(clip(body.nip, 20)), contact_person_name: orNull(clip(body.contactName, 300)),
    contact_phone: orNull(clip(body.contactPhone, 50)), contact_email: orNull(contactEmail), notes: orNull(clip(body.notes, 5000)),
    latitude, longitude, google_maps_url: orNull(clip(body.googleMapsUrl, 500)), google_place_id: orNull(clip(body.placeId, 300)),
    formatted_address: orNull(clip(body.formattedAddress, 500)),
  };
  if (id) {
    const { data, error } = await ctx.supabase.from('locations').update(payload).eq('id', id).select('id');
    check(error, 'Błąd podczas zapisywania lokalizacji');
    if (!data?.length) fail('Nie znaleziono lokalizacji albo nie masz uprawnień do jej edycji.', 404);
    return { ok: true, id, message: 'Lokalizacja zaktualizowana' };
  }
  const { data, error } = await ctx.supabase.from('locations').insert([payload]).select('id').single();
  check(error, 'Błąd podczas zapisywania lokalizacji');
  return { ok: true, id: String((data as Row).id), message: 'Lokalizacja dodana' };
}

export async function deleteLocation(ctx: NativeContext, id: string) {
  requireManage(ctx);
  const { data, error } = await ctx.supabase.from('locations').delete().eq('id', id).select('id');
  if (error?.code === '23503') fail('Nie można usunąć lokalizacji używanej w wydarzeniach lub ofertach.');
  check(error, 'Błąd podczas usuwania lokalizacji');
  if (!data?.length) fail('Nie udało się usunąć lokalizacji (brak uprawnień albo została już usunięta).', 403);
  return { ok: true, message: 'Lokalizacja usunięta' };
}

/** Stan obiektu do zapisu z kontrolą zmian (jak `.eq('rooms', …)` / `.eq('technical_details', …)` w CRM). */
async function current(ctx: NativeContext, id: string) {
  const { data, error } = await ctx.supabase.from('locations').select('id,rooms,technical_details,updated_at').eq('id', id).maybeSingle();
  check(error, 'Nie udało się pobrać lokalizacji.');
  if (!data) fail('Lokalizacja nie została znaleziona', 404);
  return data as Row;
}

async function writeIfUnchanged(ctx: NativeContext, row: Row, patch: Row) {
  const { data, error } = await ctx.supabase.from('locations').update(patch).eq('id', row.id).eq('updated_at', row.updated_at).select('id');
  check(error, 'Nie udało się zapisać. Spróbuj ponownie.');
  if (!data?.length) fail('Dane zmieniły się lub nie masz uprawnień. Odśwież lokalizację.', 409);
}

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value ?? null);
};

/** Informacje techniczne obiektu; `previous` — wersja, od której zaczęła się edycja (inna na serwerze → konflikt). */
export async function saveTechnical(ctx: NativeContext, id: string, details: unknown, previous: unknown) {
  requireManage(ctx);
  if (!isObject(details)) fail('Nieprawidłowe informacje techniczne.');
  const row = await current(ctx, id);
  if (previous !== undefined && canonical(technicalOf(row)) !== canonical(isObject(previous) ? previous : {})) {
    fail('Dane zmieniły się lub nie masz uprawnień. Odśwież lokalizację.', 409);
  }
  await writeIfUnchanged(ctx, row, { technical_details: details });
  return { ok: true, message: 'Informacje techniczne zapisane' };
}

/** Dodanie albo edycja sali (identyfikator z aplikacji albo nowy); nazwy sal w obiekcie nie mogą się powtarzać. */
export async function saveRoom(ctx: NativeContext, id: string, input: unknown, previous: unknown) {
  requireManage(ctx);
  if (!isObject(input)) fail('Nieprawidłowa sala.');
  const name = clip(input.name, 150);
  if (!name) fail('Uzupełnij nazwę sali.');
  const notes = clip(input.notes, 1000);
  if (!isObject(input.technical)) fail('Nieprawidłowe informacje techniczne sali.');
  const roomId = UUID.test(text(input.id)) ? text(input.id).toLowerCase() : randomUUID();
  const row = await current(ctx, id);
  const rooms = roomsOf(row);
  const existing = rooms.find((room) => text(room.id).toLowerCase() === roomId);
  if (existing && previous !== undefined && (!isObject(previous) || canonical(roomItem(existing)) !== canonical(roomItem(previous)))) {
    fail('Sala zmieniła się w międzyczasie. Odśwież lokalizację.', 409);
  }
  if (rooms.some((room) => text(room.id).toLowerCase() !== roomId && text(room.name).trim().toLocaleLowerCase('pl-PL') === name.toLocaleLowerCase('pl-PL'))) {
    fail('Nazwy sal w obiekcie nie mogą się powtarzać.');
  }
  if (!existing && rooms.length >= 100) fail('Obiekt może mieć najwyżej 100 sal i przestrzeni.');
  const room = { ...(existing ?? {}), id: roomId, name, notes, kind: input.kind === 'outdoor' ? 'outdoor' : 'indoor', technical: input.technical };
  await writeIfUnchanged(ctx, row, { rooms: existing ? rooms.map((item) => (text(item.id).toLowerCase() === roomId ? room : item)) : [...rooms, room] });
  return { ok: true, roomId, message: existing ? 'Przestrzeń zapisana' : 'Przestrzeń dodana' };
}

export async function deleteRoom(ctx: NativeContext, id: string, roomId: string) {
  requireManage(ctx);
  const row = await current(ctx, id);
  const rooms = roomsOf(row);
  if (!rooms.some((room) => text(room.id).toLowerCase() === roomId.toLowerCase())) fail('Sala została już usunięta. Odśwież lokalizację.', 404);
  await writeIfUnchanged(ctx, row, { rooms: rooms.filter((room) => text(room.id).toLowerCase() !== roomId.toLowerCase()) });
  return { ok: true, message: 'Przestrzeń usunięta' };
}

const FORMATS: Record<string, { extension: string; contentType: string }> = {
  jpg: { extension: 'jpg', contentType: 'image/jpeg' }, jpeg: { extension: 'jpg', contentType: 'image/jpeg' },
  png: { extension: 'png', contentType: 'image/png' }, webp: { extension: 'webp', contentType: 'image/webp' },
  pdf: { extension: 'pdf', contentType: 'application/pdf' }, dxf: { extension: 'dxf', contentType: 'image/vnd.dxf' },
  dwg: { extension: 'dwg', contentType: 'image/vnd.dwg' },
};

/** Materiał obiektu lub sali (rzut: PDF, DXF, DWG, zdjęcia; galeria: JPG, PNG, WebP; do 20 MB) — zwraca wpis do `assets`. */
export async function uploadMaterial(ctx: NativeContext, locationId: string, kind: string, file: File) {
  requireManage(ctx);
  if (kind !== 'plan' && kind !== 'photo') fail('Nieprawidłowy rodzaj materiału.');
  const extension = (file.name.split('.').pop() || '').toLowerCase();
  const format = FORMATS[extension];
  if (!format || (kind === 'photo' && !['jpg', 'png', 'webp'].includes(format.extension))) {
    fail(kind === 'photo' ? 'Dodaj zdjęcia w formacie JPG, PNG lub WebP.' : 'Dodaj JPG, PNG lub WebP, a dla rzutu także PDF, DXF lub DWG.');
  }
  if (!file.size || file.size > 20 * 1024 * 1024 || file.name.length > 255) fail('Plik musi mieć od 1 bajta do 20 MB, a jego nazwa maksymalnie 255 znaków.');
  const path = `${locationId}/${randomUUID()}.${format.extension}`;
  const { error } = await ctx.supabase.storage.from(BUCKET).upload(path, new Uint8Array(await file.arrayBuffer()), { contentType: format.contentType, upsert: false });
  if (error) {
    const denied = /row.level security|permission denied/i.test(error.message || '');
    fail(denied
      ? `Nie udało się przesłać pliku „${file.name}”: brak dostępu do magazynu materiałów lokalizacji.`
      : `Nie udało się przesłać pliku „${file.name}”.`);
  }
  return { ok: true, asset: { path, name: file.name, kind } };
}
