import 'server-only';
import type { NativeContext } from './auth';
import { getFuelPriceQuote } from '@/lib/CRM/events/fuelPriceQuote';
import { getDrivingLeg } from '@/lib/CRM/events/travelDirections';

/**
 * Kalkulator trasy i paliwa w logistyce oferty (`OfferLogisticsRoute` + `VehicleTravelCalculator`) — te same reguły co
 * `/bridge/offers/travel-estimate`: cel z lokalizacji wydarzenia, potem z tekstu wydarzenia i miejsca z oferty albo zapisana
 * lokalizacja z katalogu; wyszukiwanie lokalizacji (do 20), trasa Google Maps (tam i z powrotem) i średnie ceny paliw.
 * Odczyty klientem zalogowanego pracownika (uprawnienia jak w CRM).
 */

const ORIGIN = 'Marcina Kasprzaka 15, Olsztyn, Polska';
const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const FIELDS = 'id,name,formatted_address,address,city,postal_code,google_place_id,latitude,longitude';
type Row = Record<string, any>;
type Destination = { target: string; label: string; locationId: string | null; source: string };

function fail(message: string): never {
  throw new Error(message);
}

const safeError = (error: unknown, fallback: string) =>
  error instanceof Error && /^(Google Maps|Nie udało się|Zestawienie cen|Brak aktualnych)/.test(error.message) ? error.message : fallback;

function locationDestination(location: Row, source: string): Destination | null {
  const address = location.formatted_address || [location.address, location.postal_code, location.city].filter(Boolean).join(', ');
  const target = location.google_place_id ? `place_id:${location.google_place_id}`
    : location.latitude != null && location.longitude != null ? `${location.latitude},${location.longitude}` : address;
  return target ? { target, label: [location.name, address].filter(Boolean).join(' — '), locationId: location.id, source } : null;
}

export async function offerTravel(ctx: NativeContext, offerId: string, params: URLSearchParams) {
  const action = params.get('action') || '';
  if (!UUID.test(offerId) || !['destination', 'search', 'route', 'fuel'].includes(action)) fail('Nieprawidłowe dane oferty.');
  const locationId = params.get('locationId');
  if (locationId != null && !UUID.test(locationId)) fail('Wybierz zapisaną lokalizację.');
  const s = ctx.supabase;
  const offerResult = await s.from('offers').select('id,event_id,event_location').eq('id', offerId).maybeSingle();
  if (offerResult.error || !offerResult.data) fail('Brak dostępu do oferty.');
  if (action === 'fuel') {
    try {
      return await getFuelPriceQuote();
    } catch (error) {
      fail(safeError(error, 'Nie udało się pobrać cen paliw. Wpisz cenę ręcznie lub spróbuj ponownie.'));
    }
  }
  if (action === 'search') {
    const term = String(params.get('query') || '').slice(0, 120).replace(/[^\p{L}\p{N}\s-]/gu, '').trim();
    let query = s.from('locations').select('id,name,formatted_address,address,city,postal_code').order('name').limit(20);
    if (term) query = query.or(`name.ilike.%${term}%,city.ilike.%${term}%,address.ilike.%${term}%,formatted_address.ilike.%${term}%`);
    const result = await query;
    if (result.error) fail('Nie udało się wyszukać lokalizacji.');
    return { locations: result.data || [] };
  }
  let destination: Destination | null = null;
  if (locationId) {
    const { data, error } = await s.from('locations').select(FIELDS).eq('id', locationId).maybeSingle();
    if (error || !data) fail('Nie masz dostępu do wybranej lokalizacji.');
    destination = locationDestination(data as Row, 'catalog');
    if (!destination) fail('Wybrana lokalizacja nie ma dokładnego adresu ani współrzędnych. Uzupełnij ją w katalogu lokalizacji.');
  } else {
    const offer = offerResult.data as Row;
    let eventText = '';
    if (offer.event_id) {
      const event = await s.from('events').select('location_id,location').eq('id', offer.event_id).maybeSingle();
      if (!event.error && event.data) {
        const row = event.data as Row;
        if (typeof row.location === 'string') eventText = row.location.trim();
        if (row.location_id) {
          const location = await s.from('locations').select(FIELDS).eq('id', row.location_id).maybeSingle();
          if (!location.error && location.data) destination = locationDestination(location.data as Row, 'event');
        }
      }
    }
    if (!destination && eventText) destination = { target: eventText, label: eventText, locationId: null, source: 'event' };
    if (!destination && typeof offer.event_location === 'string' && offer.event_location.trim()) {
      destination = { target: offer.event_location.trim(), label: offer.event_location.trim(), locationId: null, source: 'offer' };
    }
  }
  if (action === 'destination') {
    return { origin: ORIGIN, destination: destination ? { label: destination.label, locationId: destination.locationId, source: destination.source } : null };
  }
  if (!destination) fail('Wybierz cel przejazdu z zapisanych lokalizacji.');
  const origin = params.get('origin');
  const roundTrip = params.get('roundTrip');
  if (typeof origin !== 'string' || !origin.trim() || origin.length > 500 || !['1', '0'].includes(roundTrip || '')) {
    fail('Podaj adres startu i wybierz kierunek przejazdu.');
  }
  const start = origin.trim();
  const back = roundTrip === '1';
  const key = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!key) fail('Brak klucza Google Maps w konfiguracji serwera.');
  try {
    const [outbound, inbound] = await Promise.all([getDrivingLeg(start, destination.target, key), back ? getDrivingLeg(destination.target, start, key) : Promise.resolve(null)]);
    const distanceKm = Math.round((outbound.distanceMeters + (inbound?.distanceMeters || 0)) / 100) / 10;
    return {
      outbound, inbound, distanceKm,
      travelMinutes: Math.ceil(outbound.durationSeconds / 60),
      round_trip: back,
      origin: start, destination: destination.label, location_id: destination.locationId, source: destination.source,
      distance_km: distanceKm,
      travel_minutes: Math.ceil((outbound.durationSeconds + (inbound?.durationSeconds || 0)) / 60),
      outbound_km: Math.round(outbound.distanceMeters / 100) / 10,
      inbound_km: Math.round((inbound?.distanceMeters || 0) / 100) / 10,
      resolved_destination: outbound.endAddress, calculated_at: new Date().toISOString(),
    };
  } catch (error) {
    fail(safeError(error, 'Nie udało się obliczyć trasy. Spróbuj ponownie.'));
  }
}
