import { NextRequest, NextResponse } from 'next/server';
import { unlockShare } from '@/lib/materials/materialSharePublic.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,64}$/;
const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };

/**
 * Link do pobrania z hasłem (`/pobierz/<token>`): e-mail z listy linku i hasło → ciasteczko sesji (httpOnly, do końca
 * ważności linku, najwyżej 7 dni). Ograniczenie prób liczy skrót adresu IP (`unlockShare`).
 */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > 4000) throw new Error('too_large');
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return NextResponse.json({ error: 'Nieprawidłowe dane.' }, { status: 400, headers });
  }
  const token = String(body.token || '');
  if (!TOKEN_PATTERN.test(token)) return NextResponse.json({ error: 'Ten link nie istnieje.' }, { status: 404, headers });
  const client = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || request.headers.get('x-real-ip') || 'unknown';
  try {
    const result = await unlockShare(token, body.email, body.password, client);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status, headers });
    const response = NextResponse.json({ ok: true }, { headers });
    response.cookies.set(result.cookieName, result.cookieValue, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: result.maxAge,
    });
    return response;
  } catch (error) {
    console.error('[material-share] unlock', error);
    return NextResponse.json({ error: 'Nie udało się otworzyć linku. Spróbuj ponownie za chwilę.' }, { status: 500, headers });
  }
}
