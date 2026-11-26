import { cookies } from 'next/headers';
import { TEST_MODE_KEY_COOKIE, TEST_MODE_PROXY_PATH, bearerTestToken, parseTestKey, parseTestToken } from '@/lib/testMode/shared';
import { TestModeError, forwardTestRequest, loadTestSession, testModeErrorResponse } from '@/lib/testMode/session.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/*
 * Zapytania do Supabase w trybie testowym (`docs/test-mode.md`): klient Supabase w przeglądarce (`src/lib/supabase/browser.ts`)
 * i aplikacje na Maca / telefon wysyłają je tutaj zamiast do Supabase. Serwer podstawia klucz oglądanej osoby z sesji testowej
 * wskazanej ciasteczkiem httpOnly (przeglądarka) albo kluczem zastępczym (nagłówek `Authorization`; przy odświeżeniu sesji —
 * pole `refresh_token`) — odczyt jak u niej, zapis wycofany, pliki / funkcje Edge / zmiany konta zablokowane.
 */

/** Klucz zastępczy z treści odświeżenia sesji (`/auth/v1/token`, aplikacje natywne wysyłają go bez nagłówka). */
const refreshKey = (body: ArrayBuffer | null) => {
  if (!body || !body.byteLength || body.byteLength > 16_384) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(body)) as { refresh_token?: unknown };
    return typeof parsed.refresh_token === 'string' ? parseTestToken(parsed.refresh_token) : null;
  } catch {
    return null;
  }
};

async function handle(request: Request) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(`${TEST_MODE_PROXY_PATH}/`)) return testModeErrorResponse('Nieprawidłowy adres.', 404);
  const path = `${url.pathname.slice(TEST_MODE_PROXY_PATH.length)}${url.search}`;
  const method = request.method.toUpperCase();
  try {
    const body = method === 'GET' || method === 'HEAD' ? null : await request.arrayBuffer();
    const key = parseTestKey(cookies().get(TEST_MODE_KEY_COOKIE)?.value)
      ?? bearerTestToken(request.headers.get('authorization'))
      ?? (url.pathname === `${TEST_MODE_PROXY_PATH}/auth/v1/token` ? refreshKey(body) : null);
    if (!key) return testModeErrorResponse('Tryb testowy nie jest włączony — odśwież stronę albo wyjdź z trybu.', 401);
    const session = await loadTestSession(key.id, key.secret);
    return await forwardTestRequest(session, method, path, request.headers, body);
  } catch (error) {
    if (error instanceof TestModeError) return testModeErrorResponse(error.message, error.status);
    console.error('[test-mode/sb]', error);
    return testModeErrorResponse('Tryb testowy: zapytanie nie powiodło się.', 502);
  }
}

export { handle as GET, handle as POST, handle as PATCH, handle as PUT, handle as DELETE, handle as HEAD };
