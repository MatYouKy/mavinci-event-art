import { NextRequest, NextResponse } from 'next/server';
import { shareFileUrl } from '@/lib/materials/materialSharePublic.server';
import { shareCookieName } from '@/lib/materials/materialShareCrypto.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,64}$/;
const noStore = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };

/**
 * Plik z linku do pobrania: krótki podpisany adres magazynu (podgląd albo pobranie z nazwą pliku). Bez dostępu (link wygasł,
 * wyłączony, bez hasła) albo pliku spoza linku — powrót na stronę linku, która pokaże, co się stało.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const token = params.get('token') || '';
  if (!TOKEN_PATTERN.test(token)) return new NextResponse(null, { status: 404, headers: noStore });
  const mode = params.get('mode') === 'download' ? 'download' : 'preview';
  try {
    const url = await shareFileUrl(token, request.cookies.get(shareCookieName(token))?.value, params.get('id') || '', mode);
    if (url) {
      return NextResponse.redirect(url, { status: 307, headers: { ...noStore, 'Referrer-Policy': 'no-referrer' } });
    }
  } catch (error) {
    console.error('[material-share] file', error);
  }
  return NextResponse.redirect(new URL(`/pobierz/${token}`, request.url), { status: 303, headers: noStore });
}
