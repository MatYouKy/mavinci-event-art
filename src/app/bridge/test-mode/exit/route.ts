import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { isChunkLike } from '@supabase/ssr';
import { SUPABASE_PROJECT_REF } from '@/lib/supabase/projectUrl';
import { TEST_MODE_COOKIE, TEST_MODE_KEY_COOKIE, bearerTestToken, parseTestKey } from '@/lib/testMode/shared';
import { closeTestSession, forgetTestSession, readTestSessionRow } from '@/lib/testMode/session.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/*
 * „Wyjdź z trybu” (pasek trybu testowego, `docs/test-mode.md`): sesja oglądanej osoby unieważniona w bazie, ciasteczka trybu
 * usunięte, wraca sesja administratora zapisana przy wejściu. Bez niej (np. tryb wygasł dawno temu) — strona logowania.
 * Mac i telefon: klucz zastępczy w nagłówku `Authorization` — tylko zakończenie sesji testowej (sesję administratora
 * aplikacja przywraca sama).
 */

const sameOrigin = (request: Request) => {
  try {
    const origin = request.headers.get('origin');
    return Boolean(origin) && new URL(origin as string).host === request.headers.get('host');
  } catch {
    return false;
  }
};

export async function POST(request: Request) {
  const cookieStore = cookies();
  const key = parseTestKey(cookieStore.get(TEST_MODE_KEY_COOKIE)?.value);
  const nativeKey = key ? null : bearerTestToken(request.headers.get('authorization'));
  if (nativeKey) {
    try {
      if (await readTestSessionRow(nativeKey.id, nativeKey.secret)) await closeTestSession(nativeKey.id, 'exit');
    } catch (error) {
      console.error('[test-mode/exit]', error);
      return NextResponse.json({ error: 'Nie udało się zakończyć sesji testowej na serwerze.' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
    }
    forgetTestSession(nativeKey.id);
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  }
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Nieprawidłowe źródło żądania.' }, { status: 403 });
  let adminCookies: Array<{ name: string; value: string }> = [];
  if (key) {
    try {
      const found = await readTestSessionRow(key.id, key.secret);
      if (found) {
        adminCookies = found.payload?.admin_cookies || [];
        await closeTestSession(key.id, 'exit');
      }
    } catch (error) {
      console.error('[test-mode/exit]', error);
    }
    forgetTestSession(key.id);
  }

  const base = `sb-${SUPABASE_PROJECT_REF}-auth-token`;
  const secure = new URL(request.url).protocol === 'https:' || process.env.NODE_ENV === 'production';
  const restored = new Set(adminCookies.map((cookie) => cookie.name));
  const response = NextResponse.json(
    { landing: adminCookies.length ? '/crm/settings?tab=test' : '/login' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
  for (const cookie of cookieStore.getAll()) {
    if (isChunkLike(cookie.name, base) && !restored.has(cookie.name)) response.cookies.set(cookie.name, '', { path: '/', maxAge: 0 });
  }
  for (const cookie of adminCookies) {
    // Jak ciasteczka sesji Supabase (@supabase/ssr): czytelne dla przeglądarki, 400 dni.
    response.cookies.set(cookie.name, cookie.value, { path: '/', sameSite: 'lax', httpOnly: false, secure, maxAge: 400 * 24 * 60 * 60 });
  }
  response.cookies.set(TEST_MODE_KEY_COOKIE, '', { path: '/', maxAge: 0 });
  response.cookies.set(TEST_MODE_COOKIE, '', { path: '/', maxAge: 0 });
  return response;
}
