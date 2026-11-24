import { NextRequest, NextResponse } from 'next/server';
import { shareZip } from '@/lib/materials/materialSharePublic.server';
import { shareCookieName } from '@/lib/materials/materialShareCrypto.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 3600;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,64}$/;
const SECTION_PATTERN = /^(files|[fa]:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const noStore = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };

/** Nazwa pliku w nagłówku: wersja ASCII (bez polskich znaków) i pełna w UTF-8 (RFC 5987). */
function disposition(filename: string) {
  const ascii = filename.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[łŁ]/g, (c) => (c === 'ł' ? 'l' : 'L'))
    .replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/**
 * „Pobierz wszystkie” / „Pobierz folder” na stronie linku: archiwum ZIP składane w locie (pliki kolejno z magazynu do
 * przeglądarki, bez kompresji). `section` — jedna część (folder, album, pliki), bez — cały link (do 4 GB).
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const token = params.get('token') || '';
  if (!TOKEN_PATTERN.test(token)) return new NextResponse(null, { status: 404, headers: noStore });
  const section = params.get('section');
  const back = (reason: string) => NextResponse.redirect(new URL(`/pobierz/${token}?zip=${reason}`, request.url), { status: 303, headers: noStore });
  if (section && !SECTION_PATTERN.test(section)) return back('brak');
  try {
    const result = await shareZip(token, request.cookies.get(shareCookieName(token))?.value, section ? section.toLowerCase() : null);
    if (!result.ok) return back(result.status === 413 ? 'za-duzy' : 'brak');
    return new Response(result.stream, {
      status: 200,
      headers: {
        ...noStore,
        'Content-Type': 'application/zip',
        'Content-Disposition': disposition(result.filename),
        'X-Content-Type-Options': 'nosniff',
        // Nginx: bez buforowania — archiwum płynie do przeglądarki od razu.
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    console.error('[material-share] zip', error);
    return back('blad');
  }
}
