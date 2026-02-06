import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const place_id = url.searchParams.get('place_id') || '';
  const sessiontoken = url.searchParams.get('sessiontoken') || '';

  const key = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!key) return new NextResponse('Missing GOOGLE_MAPS_API_KEY', { status: 500 });
  if (!place_id.trim()) return new NextResponse('Missing place_id', { status: 400 });

  const gUrl = new URL('https://maps.googleapis.com/maps/api/place/details/json');
  gUrl.searchParams.set('place_id', place_id);
  gUrl.searchParams.set('key', key);
  gUrl.searchParams.set('language', 'pl');
  gUrl.searchParams.set('fields', [
    'place_id',
    'name',
    'formatted_address',
    'geometry/location',
    'url',
    'address_component',
  ].join(','));
  if (sessiontoken) gUrl.searchParams.set('sessiontoken', sessiontoken);

  const resp = await fetch(gUrl.toString(), { cache: 'no-store' });
  const data = await resp.json();

  return NextResponse.json(data, { status: resp.status });
}