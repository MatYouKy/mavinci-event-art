import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const input = url.searchParams.get('input') || '';
  const sessiontoken = url.searchParams.get('sessiontoken') || '';

  const key = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!key) return new NextResponse('Missing GOOGLE_MAPS_API_KEY', { status: 500 });
  if (!input.trim()) return NextResponse.json({ predictions: [] });

  const gUrl = new URL('https://maps.googleapis.com/maps/api/place/autocomplete/json');
  gUrl.searchParams.set('input', input);
  gUrl.searchParams.set('key', key);
  gUrl.searchParams.set('language', 'pl');
  gUrl.searchParams.set('components', 'country:pl');
  if (sessiontoken) gUrl.searchParams.set('sessiontoken', sessiontoken);

  const resp = await fetch(gUrl.toString(), { cache: 'no-store' });
  const data = await resp.json();

  return NextResponse.json(data, { status: resp.status });
}