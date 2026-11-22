import type { SupabaseClient } from '@supabase/supabase-js';

/*
 * „Tło ofert” lokalizacji (`locations.offer_background_path`, bucket `location-materials`) — zdjęcie miejsca wydarzenia na
 * okładce oferty, gdy oferta nie ma własnej grafiki. Miejscem jest pierwsza istniejąca lokalizacja: wybrana w ofercie („Miejsce
 * wydarzenia” z listy lokalizacji — `offers.location_id`), wydarzenia, z zapytania, organizacji klienta (np. hotel jako klient) —
 * tło innej lokalizacji nigdy nie trafia na okładkę. `offer_background_updated_at` (wyzwalacz w bazie) — ostatnia zmiana tła:
 * PDF wygenerowany wcześniej ma nieaktualną okładkę (funkcja w bazie `offer_venue_pdf_outdated`, ta sama kolejność miejsc).
 * Wspólne dla PDF oferty (`src/lib/offer-pdf/render.ts`), karty oferty w CRM (`OfferBasicInfo`, `OfferActions`, wysyłka) i na
 * Macu (`src/lib/native/offers.ts`, `offerActions.ts`).
 */

export const LOCATION_BACKGROUND_BUCKET = 'location-materials';
const UUID = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;

/** Ścieżka zdjęcia tła tej lokalizacji: `<id lokalizacji>/<uuid>.jpg|png|webp` (jak ograniczenie w bazie). */
export const isLocationBackgroundPath = (locationId: string, path: string) =>
  UUID.test(locationId) && new RegExp(`^${locationId.toLowerCase()}/[0-9a-f-]{36}\\.(jpg|png|webp)$`).test(path);

export type OfferVenueSource = 'offer' | 'event' | 'inquiry' | 'organization';
export type OfferVenueIds = { offer?: unknown; event?: unknown; inquiry?: unknown; organization?: unknown };
/** Miejsce oferty: `path` — „Tło ofert” albo `null` (lokalizacja bez tła), `updatedAt` — ostatnia zmiana tła (albo `null`). */
export type OfferVenue = { locationId: string; name: string; path: string | null; updatedAt: string | null; source: OfferVenueSource };
export type OfferVenueBackground = OfferVenue & { path: string };

type Row = Record<string, any>;

const SOURCES = ['offer', 'event', 'inquiry', 'organization'] as const;
const SOURCE_LABELS: Record<OfferVenueSource, string> = {
  offer: 'miejsce wybrane w ofercie',
  event: 'miejsce eventu',
  inquiry: 'miejsce z zapytania',
  organization: 'lokalizacja organizacji klienta',
};
// Kolejne próby — baza bez migracji „Tła ofert” (brak kolumn) nadal pokazuje miejsce, bez tła.
const VENUE_FIELDS = ['id, name, offer_background_path, offer_background_updated_at', 'id, name, offer_background_path', 'id, name'];

/** Identyfikatory lokalizacji z oferty pobranej z relacjami (`location_id`, `event.location_id`,
 * `inquiry.inquiry_details.location_id`, `organization.location_id`). */
export function offerVenueIds(offer: Row | null | undefined): OfferVenueIds {
  const details = offer?.inquiry?.inquiry_details;
  return {
    offer: offer?.location_id,
    event: offer?.event?.location_id,
    inquiry: details && typeof details === 'object' ? (details as Row).location_id : undefined,
    organization: offer?.organization?.location_id,
  };
}

/** Miejsce oferty (pierwsza istniejąca lokalizacja, także bez tła) albo `null` (brak powiązanej lokalizacji, błąd odczytu). */
export async function offerVenue(supabase: SupabaseClient, ids: OfferVenueIds): Promise<OfferVenue | null> {
  const order = SOURCES
    .map((source) => {
      const raw = ids[source];
      return { source, id: typeof raw === 'string' && UUID.test(raw.trim()) ? raw.trim().toLowerCase() : '' };
    })
    .filter((item) => item.id);
  if (!order.length) return null;
  const unique = Array.from(new Set(order.map((item) => item.id)));
  let rows: Row[] | null = null;
  for (const fields of VENUE_FIELDS) {
    const { data, error } = await supabase.from('locations').select(fields).in('id', unique);
    if (!error && data) {
      rows = data as unknown as Row[];
      break;
    }
  }
  if (!rows) return null;
  const byId = new Map(rows.map((row) => [String(row.id).toLowerCase(), row]));
  const venue = order.find((item) => byId.has(item.id));
  if (!venue) return null;
  const row = byId.get(venue.id) as Row;
  const path = typeof row.offer_background_path === 'string' ? row.offer_background_path.trim() : '';
  return {
    locationId: venue.id,
    name: String(row.name || '').trim() || 'Lokalizacja',
    path: path && isLocationBackgroundPath(venue.id, path) ? path : null,
    updatedAt: typeof row.offer_background_updated_at === 'string' ? row.offer_background_updated_at : null,
    source: venue.source,
  };
}

/** Miejsce oferty z ustawionym tłem albo `null` (brak miejsca, miejsce bez tła, baza bez kolumny — okładka jak dotąd). */
export async function offerVenueBackground(supabase: SupabaseClient, ids: OfferVenueIds): Promise<OfferVenueBackground | null> {
  const venue = await offerVenue(supabase, ids);
  return venue?.path ? { ...venue, path: venue.path } : null;
}

/** Okładka oferty może używać tła miejsca: bez własnej grafiki hero i poza ofertami sprzedawców (okładka z profilu). */
export const offerUsesVenueBackground = (offer: Row | null | undefined) =>
  Boolean(offer) && !offer?.hero_image_path && offer?.sales_channel !== 'seller_portal';

/** „Tło lokalizacji „Marina” (miejsce wydarzenia)” — opis okładki w karcie oferty. */
export function offerVenueLabel(venue: OfferVenue) {
  return `Tło lokalizacji „${venue.name}” (${SOURCE_LABELS[venue.source]})`;
}

/** Oferty, których zapisany PDF powstał przed ostatnią zmianą „Tła ofert” ich miejsca (dodanie, zmiana, usunięcie tła) — okładka
 * w PDF jest nieaktualna, wysyłka po ponownym wygenerowaniu (jak `modified_after_generation`). Liczy baza (`offer_venue_pdf_outdated`:
 * bez własnej grafiki i poza ofertami sprzedawców); baza bez migracji albo błąd odczytu — pusty zbiór (PDF jak dotąd). */
export async function venueOutdatedOffers(supabase: SupabaseClient, ids: unknown[]): Promise<Set<string>> {
  const unique = Array.from(new Set(ids.map((id) => String(id ?? '').toLowerCase()).filter((id) => UUID.test(id))));
  const outdated = new Set<string>();
  for (let start = 0; start < unique.length; start += 100) {
    const { data, error } = await supabase.from('offers').select('id, venue_pdf_outdated:offer_venue_pdf_outdated')
      .in('id', unique.slice(start, start + 100));
    if (error || !data) return new Set();
    for (const row of data as unknown as Row[]) if (row.venue_pdf_outdated === true) outdated.add(String(row.id).toLowerCase());
  }
  return outdated;
}

/** Podpis lokalizacji z listy („Nazwa, Miasto, Kod”) — tak `LocationSelector` zapisuje wybrane miejsce w ofercie. */
export function locationSelectorLabel(location: { name?: unknown; city?: unknown; postal_code?: unknown }) {
  const part = (value: unknown) => (typeof value === 'string' ? value : '');
  return `${part(location.name)}${part(location.city) ? `, ${part(location.city)}` : ''}${part(location.postal_code) ? `, ${part(location.postal_code)}` : ''}`;
}

/** Podpowiedź do okładki oferty bez tła miejsca (karta oferty w CRM i na Macu) albo `null`. `placeText` — miejsce wpisane
 * w ofercie (gdy nie jest powiązane z lokalizacją z bazy). */
export function offerVenueHint(offer: Row | null | undefined, venue: OfferVenue | null, placeText: string): string | null {
  if (!offerUsesVenueBackground(offer)) return null;
  if (venue && !venue.path) {
    return `Lokalizacja „${venue.name}” (${SOURCE_LABELS[venue.source]}) nie ma „Tła ofert” — dodaj zdjęcie na karcie lokalizacji, a okładka oferty pokaże to miejsce.`;
  }
  if (!venue && placeText.trim()) {
    return `Miejsce „${placeText.trim()}” nie jest powiązane z lokalizacją z bazy — wybierz je z listy w polu „Miejsce eventu”, żeby okładka mogła użyć „Tła ofert” tego miejsca.`;
  }
  return null;
}
