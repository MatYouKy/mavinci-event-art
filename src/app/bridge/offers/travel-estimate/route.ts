import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';
import { getFuelPriceQuote } from '@/lib/CRM/events/fuelPriceQuote';
import { getDrivingLeg } from '@/lib/CRM/events/travelDirections';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const ORIGIN = 'Marcina Kasprzaka 15, Olsztyn, Polska';
const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const fields = 'id,name,formatted_address,address,city,postal_code,google_place_id,latitude,longitude';
const reply = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const locationDestination = (location: any, source: string) => {
  const address = location.formatted_address || [location.address, location.postal_code, location.city].filter(Boolean).join(', ');
  const target = location.google_place_id ? `place_id:${location.google_place_id}` : location.latitude != null && location.longitude != null ? `${location.latitude},${location.longitude}` : address;
  return target ? { target, label: [location.name, address].filter(Boolean).join(' — '), locationId: location.id, source } : null;
};

export async function POST(request: Request) {
  try {
    const origin = request.headers.get('origin');
    if (!origin || request.headers.get('sec-fetch-site') === 'cross-site' || !['https://mavinci.pl', 'https://www.mavinci.pl', new URL(request.url).origin].includes(origin)) return reply({ error: 'Nieprawidłowe źródło żądania.' }, 403);
    const body = await request.json().catch(() => null);
    if (!body || typeof body.offerId !== 'string' || !uuid.test(body.offerId) || !['destination', 'search', 'route', 'fuel'].includes(body.action)) return reply({ error: 'Nieprawidłowe dane oferty.' }, 400);
    if (body.locationId != null && (typeof body.locationId !== 'string' || !uuid.test(body.locationId))) return reply({ error: 'Wybierz zapisaną lokalizację.' }, 400);
    const client = createSupabaseServerClient(cookies());
    const { data: auth, error: authError } = await client.auth.getUser();
    if (authError || !auth.user) return reply({ error: 'Sesja wygasła. Zaloguj się ponownie.' }, 401);
    const [offerResult, employeeResult] = await Promise.all([
      client.from('offers').select('id,event_id,event_location').eq('id', body.offerId).maybeSingle(),
      client.from('employees').select('id').eq('is_active', true).or(`id.eq.${auth.user.id},auth_user_id.eq.${auth.user.id}`).limit(1).maybeSingle(),
    ]);
    if (offerResult.error || !offerResult.data || employeeResult.error || !employeeResult.data) return reply({ error: 'Brak dostępu do oferty.' }, 403);
    if (body.action === 'fuel') return reply(await getFuelPriceQuote());
    if (body.action === 'search') {
      const term = String(body.query || '').slice(0, 120).replace(/[^\p{L}\p{N}\s-]/gu, '').trim();
      let query = client.from('locations').select('id,name,formatted_address,address,city,postal_code').order('name').limit(20);
      if (term) query = query.or(`name.ilike.%${term}%,city.ilike.%${term}%,address.ilike.%${term}%,formatted_address.ilike.%${term}%`);
      const result = await query;
      if (result.error) return reply({ error: 'Nie udało się wyszukać lokalizacji.' }, 502);
      return reply({ locations: result.data || [] });
    }
    let destination: ReturnType<typeof locationDestination> = null;
    if (body.locationId) {
      const { data, error } = await client.from('locations').select(fields).eq('id', body.locationId).maybeSingle();
      if (error || !data) return reply({ error: 'Nie masz dostępu do wybranej lokalizacji.' }, 403);
      destination = locationDestination(data, 'catalog');
      if (!destination) return reply({ error: 'Wybrana lokalizacja nie ma dokładnego adresu ani współrzędnych. Uzupełnij ją w katalogu lokalizacji.' }, 400);
    } else {
      const offer = offerResult.data;
      let eventText = '';
      if (offer.event_id) {
        const event = await client.from('events').select('location_id,location').eq('id', offer.event_id).maybeSingle();
        if (!event.error && event.data) {
          if (typeof event.data.location === 'string') eventText = event.data.location.trim();
          if (event.data.location_id) {
            const location = await client.from('locations').select(fields).eq('id', event.data.location_id).maybeSingle();
            if (!location.error && location.data) destination = locationDestination(location.data, 'event');
          }
        }
      }
      if (!destination && eventText) destination = { target: eventText, label: eventText, locationId: null, source: 'event' };
      if (!destination && typeof offer.event_location === 'string' && offer.event_location.trim()) destination = { target: offer.event_location.trim(), label: offer.event_location.trim(), locationId: null, source: 'offer' };
    }
    if (body.action === 'destination') return reply({ origin: ORIGIN, destination: destination ? { label: destination.label, locationId: destination.locationId, source: destination.source } : null });
    if (!destination) return reply({ error: 'Wybierz cel przejazdu z zapisanych lokalizacji.' }, 400);
    if (typeof body.origin !== 'string' || !body.origin.trim() || body.origin.length > 500 || typeof body.roundTrip !== 'boolean') return reply({ error: 'Podaj adres startu i wybierz kierunek przejazdu.' }, 400);
    const start = body.origin.trim();
    const key = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!key) return reply({ error: 'Brak klucza Google Maps w konfiguracji serwera.' }, 503);
    const [outbound, inbound] = await Promise.all([getDrivingLeg(start, destination.target, key), body.roundTrip ? getDrivingLeg(destination.target, start, key) : Promise.resolve(null)]);
    return reply({
      outbound, inbound,
      distanceKm: Math.round((outbound.distanceMeters + (inbound?.distanceMeters || 0)) / 100) / 10,
      travelMinutes: Math.ceil(outbound.durationSeconds / 60),
      round_trip: body.roundTrip,
      origin: start, destination: destination.label, location_id: destination.locationId, source: destination.source,
      distance_km: Math.round((outbound.distanceMeters + (inbound?.distanceMeters || 0)) / 100) / 10,
      travel_minutes: Math.ceil((outbound.durationSeconds + (inbound?.durationSeconds || 0)) / 60),
      outbound_km: Math.round(outbound.distanceMeters / 100) / 10,
      inbound_km: Math.round((inbound?.distanceMeters || 0) / 100) / 10,
      resolved_destination: outbound.endAddress, calculated_at: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error && /^(Google Maps|Nie udało się|Zestawienie cen|Brak aktualnych)/.test(error.message) ? error.message : 'Nie udało się obliczyć trasy. Spróbuj ponownie.';
    return reply({ error: message }, 502);
  }
}
