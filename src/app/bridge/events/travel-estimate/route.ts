import { cookies } from 'next/headers';
import { getDrivingLeg as getLeg } from '@/lib/CRM/events/travelDirections';
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';
import { getFuelPriceQuote } from '@/lib/CRM/events/fuelPriceQuote';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const reply = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

function isTrustedRequestOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin || origin === 'null' || request.headers.get('sec-fetch-site') === 'cross-site')
    return false;

  // A reverse proxy may expose its internal address in request.url. Allow the
  // exact public origins without deriving trusted domains from forwarded headers.
  // Retain the direct same-origin check, including local development.
  return [
    'https://mavinci.pl',
    'https://www.mavinci.pl',
    new URL(request.url).origin,
  ].includes(origin);
}


export async function POST(request: Request) {
  try {
    if (!isTrustedRequestOrigin(request))
      return reply({ error: 'Nieprawidłowe źródło żądania.' }, 403);
    const body = await request.json().catch(() => null);
    if (
      !body ||
      typeof body.eventId !== 'string' ||
      !uuid.test(body.eventId) ||
      !['route', 'fuel'].includes(body.action)
    )
      return reply({ error: 'Nieprawidłowe dane wydarzenia.' }, 400);
    const client = createSupabaseServerClient(cookies());
    const { data: auth, error: authError } = await client.auth.getUser();
    if (authError || !auth.user)
      return reply({ error: 'Sesja wygasła. Zaloguj się ponownie.' }, 401);
    const [eventResult, employeeResult] = await Promise.all([
      client.from('events').select('id,location_id').eq('id', body.eventId).maybeSingle(),
      client
        .from('employees')
        .select('id')
        .eq('is_active', true)
        .or(`id.eq.${auth.user.id},auth_user_id.eq.${auth.user.id}`)
        .limit(1)
        .maybeSingle(),
    ]);
    if (eventResult.error || !eventResult.data || employeeResult.error || !employeeResult.data)
      return reply({ error: 'Brak dostępu do wydarzenia.' }, 403);

    if (body.action === 'fuel') return reply(await getFuelPriceQuote());
    if (
      typeof body.origin !== 'string' ||
      !body.origin.trim() ||
      body.origin.length > 500 ||
      typeof body.roundTrip !== 'boolean'
    )
      return reply({ error: 'Podaj adres startu i wybierz kierunek przejazdu.' }, 400);
    if (!eventResult.data.location_id)
      return reply({ error: 'Najpierw zapisz lokalizację wydarzenia w zakładce Przegląd.' }, 400);
    const { data: location, error } = await client
      .from('locations')
      .select('name,formatted_address,address,city,postal_code,google_place_id,latitude,longitude')
      .eq('id', eventResult.data.location_id)
      .single();
    if (error || !location)
      return reply({ error: 'Nie udało się odczytać lokalizacji wydarzenia.' }, 400);
    const address =
      location.formatted_address ||
      [location.address, location.postal_code, location.city].filter(Boolean).join(', ');
    const destination = location.google_place_id
      ? `place_id:${location.google_place_id}`
      : location.latitude != null && location.longitude != null
        ? `${location.latitude},${location.longitude}`
        : address;
    if (!destination)
      return reply({ error: 'Uzupełnij dokładny adres miejsca w zakładce Przegląd.' }, 400);
    const key = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!key) return reply({ error: 'Brak klucza Google Maps w konfiguracji serwera.' }, 503);
    // Return journey is calculated separately: one-way roads can change the distance.
    const [outbound, inbound] = await Promise.all([
      getLeg(body.origin.trim(), destination, key),
      body.roundTrip ? getLeg(destination, body.origin.trim(), key) : Promise.resolve(null),
    ]);
    return reply({
      outbound,
      inbound,
      distanceKm: Math.round((outbound.distanceMeters + (inbound?.distanceMeters || 0)) / 100) / 10,
      travelMinutes: Math.ceil(outbound.durationSeconds / 60),
      destination: [location.name, address].filter(Boolean).join(' — '),
    });
  } catch (error) {
    // Never expose the request URL containing the Maps key or upstream HTML.
    const safeMessage =
      error instanceof Error &&
      /^(Google Maps|Nie udało się|Zestawienie cen|Brak aktualnych)/.test(error.message)
        ? error.message
        : 'Nie udało się pobrać danych. Spróbuj ponownie lub uzupełnij wartości ręcznie.';
    return reply({ error: safeMessage }, 502);
  }
}
