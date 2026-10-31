import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';
import { getFuelPriceQuote } from '@/lib/CRM/events/fuelPriceQuote';
import { getDrivingLeg } from '@/lib/CRM/events/travelDirections';
import { DEFAULT_TRAVEL_ORIGIN } from '@/lib/CRM/events/travelEstimate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const fields = 'id,name,formatted_address,address,city,postal_code,google_place_id,latitude,longitude';
const reply = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
type Destination = { target: string; label: string; locationId: string | null; source: string };

export async function POST(request: Request) {
  try {
    const origin = request.headers.get('origin');
    if (!origin || request.headers.get('sec-fetch-site') === 'cross-site' || !['https://mavinci.pl', 'https://www.mavinci.pl', new URL(request.url).origin].includes(origin)) return reply({ error: 'Nieprawidłowe źródło żądania.' }, 403);
    const body = await request.json().catch(() => null);
    if (!body || typeof body.calculationId !== 'string' || !uuid.test(body.calculationId) || !['destination', 'route', 'fuel'].includes(body.action)) return reply({ error: 'Nieprawidłowe dane kalkulacji.' }, 400);
    if (body.destination !== undefined && (typeof body.destination !== 'string' || body.destination.length > 500)) return reply({ error: 'Podaj adres docelowy (maks. 500 znaków).' }, 400);
    const client = createSupabaseServerClient(cookies());
    const { data: auth, error: authError } = await client.auth.getUser();
    if (authError || !auth.user) return reply({ error: 'Sesja wygasła. Zaloguj się ponownie.' }, 401);
    const [calc, employee] = await Promise.all([
      client.from('event_calculations').select('id,event_id,inquiry_id').eq('id', body.calculationId).maybeSingle(),
      client.from('employees').select('id').eq('is_active', true).or(`id.eq.${auth.user.id},auth_user_id.eq.${auth.user.id}`).limit(1).maybeSingle(),
    ]);
    if (calc.error || !calc.data || employee.error || !employee.data) return reply({ error: 'Brak dostępu do kalkulacji.' }, 403);
    if (body.action === 'fuel') return reply(await getFuelPriceQuote());
    const readLocation = async (id: unknown, source: string): Promise<Destination | null> => {
      if (typeof id !== 'string' || !uuid.test(id)) return null;
      const { data, error } = await client.from('locations').select(fields).eq('id', id).maybeSingle();
      if (error || !data) return null;
      const address = data.formatted_address || [data.address, data.postal_code, data.city].filter(Boolean).join(', ');
      const target = data.google_place_id ? `place_id:${data.google_place_id}` : data.latitude != null && data.longitude != null ? `${data.latitude},${data.longitude}` : address;
      return target ? { target, label: [data.name, address].filter(Boolean).join(' — '), locationId: data.id, source } : null;
    };
    let destination: Destination | null = null;
    if (body.action === 'route' && body.destination !== undefined) {
      if (!body.destination.trim()) return reply({ error: 'Wpisz miejsce docelowe.' }, 400);
      destination = { target: body.destination.trim(), label: body.destination.trim(), locationId: null, source: 'manual' };
    } else {
      if (calc.data.event_id) {
        const event = await client.from('events').select('location_id,location').eq('id', calc.data.event_id).maybeSingle();
        if (event.error) return reply({ error: 'Nie udało się odczytać miejsca wydarzenia. Możesz wpisać adres ręcznie.' }, 502);
        if (event.data) {
          destination = await readLocation(event.data.location_id, 'event');
          if (!destination && typeof event.data.location === 'string' && event.data.location.trim()) destination = { target: event.data.location.trim(), label: event.data.location.trim(), locationId: null, source: 'event' };
        }
      }
      if (!destination && calc.data.inquiry_id) {
        const inquiry = await client.from('tasks').select('inquiry_details').eq('id', calc.data.inquiry_id).eq('is_inquiry', true).maybeSingle();
        if (inquiry.error) return reply({ error: 'Nie udało się odczytać miejsca z zapytania. Możesz wpisać adres ręcznie.' }, 502);
        const details = inquiry.data?.inquiry_details;
        if (details) {
          destination = await readLocation(details.location_id, 'inquiry');
          if (!destination && typeof details.location_text === 'string' && details.location_text.trim()) destination = { target: details.location_text.trim(), label: details.location_text.trim(), locationId: null, source: 'inquiry' };
        }
      }
    }
    if (body.action === 'destination') return reply({ origin: DEFAULT_TRAVEL_ORIGIN, destination: destination ? { label: destination.label, locationId: destination.locationId, source: destination.source } : null });
    if (!destination) return reply({ error: 'Brak lokalizacji w zapytaniu lub wydarzeniu. Wpisz miejsce docelowe.' }, 400);
    if (typeof body.origin !== 'string' || !body.origin.trim() || body.origin.length > 500 || typeof body.roundTrip !== 'boolean') return reply({ error: 'Podaj adres startu i wybierz kierunek przejazdu.' }, 400);
    const key = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!key) return reply({ error: 'Brak klucza Google Maps w konfiguracji serwera.' }, 503);
    const start = body.origin.trim();
    const [outbound, inbound] = await Promise.all([getDrivingLeg(start, destination.target, key), body.roundTrip ? getDrivingLeg(destination.target, start, key) : Promise.resolve(null)]);
    return reply({ outbound, inbound, distanceKm: Math.round((outbound.distanceMeters + (inbound?.distanceMeters || 0)) / 100) / 10, travelMinutes: Math.ceil(outbound.durationSeconds / 60), origin: start, destination: destination.label, location_id: destination.locationId, source: destination.source, round_trip: body.roundTrip, calculated_at: new Date().toISOString() });
  } catch (error) {
    const message = error instanceof Error && /^(Google Maps|Nie udało się|Zestawienie cen|Brak aktualnych)/.test(error.message) ? error.message : 'Nie udało się pobrać danych trasy. Spróbuj ponownie lub wpisz wartości ręcznie.';
    return reply({ error: message }, 502);
  }
}
