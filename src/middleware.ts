import { NextResponse, type NextRequest } from 'next/server';
import {
  TEST_MODE_COOKIE,
  TEST_MODE_KEY_COOKIE,
  TEST_MODE_MESSAGES,
  TEST_MODE_NATIVE_BODY_LIMIT,
  bearerTestToken,
  jsonBodyOp,
  testModeNativeReadAllowed,
} from '@/lib/testMode/shared';

/*
 * Tryb testowy „widok jako” (`docs/test-mode.md`): administrator oglądający CRM jako inna osoba — w przeglądarce (ciasteczka
 * trybu) albo w aplikacji na Maca / telefonie (klucz zastępczy w nagłówku `Authorization`). Serwer CRM nie wykonuje wtedy
 * operacji zapisujących — trasy `/bridge/*` innymi metodami niż GET i akcje serwera Next zwracają 423 — bo mogłyby wysłać
 * e-mail, wystawić dokument albo zapisać plik naprawdę. Wyjątek dla aplikacji natywnych: odczyty natywnego API wysyłane
 * metodą POST (`testModeNativeReadAllowed`, np. synchronizacja). Zapytania do bazy idą przez `/bridge/test-mode/sb` (zapis
 * wycofany). Bez trybu testowego — nic się nie zmienia.
 */

const blocked = () =>
  NextResponse.json(
    { error: TEST_MODE_MESSAGES.server, message: TEST_MODE_MESSAGES.server, code: 'test_mode' },
    { status: 423, headers: { 'Cache-Control': 'no-store' } },
  );

/** Odczyt natywnego API wysłany metodą POST (treść JSON z `op` z listy dozwolonych). */
async function nativeRead(request: NextRequest) {
  if (!(request.headers.get('content-type') || '').toLowerCase().includes('application/json')) return false;
  const declared = Number(request.headers.get('content-length') || '0');
  if (declared > TEST_MODE_NATIVE_BODY_LIMIT) return false;
  let text: string;
  try {
    // Next przekazuje trasie kopię treści — odczyt w middleware jej nie zużywa.
    text = await request.clone().text();
  } catch {
    return false;
  }
  if (text.length > TEST_MODE_NATIVE_BODY_LIMIT) return false;
  const bodyOp = jsonBodyOp(text);
  if (bodyOp === undefined) return false;
  return testModeNativeReadAllowed(request.nextUrl.pathname, [request.nextUrl.searchParams.get('op'), bodyOp]);
}

export async function middleware(request: NextRequest) {
  const cookieMode = request.cookies.has(TEST_MODE_COOKIE) || request.cookies.has(TEST_MODE_KEY_COOKIE);
  const bearerMode = !cookieMode && Boolean(bearerTestToken(request.headers.get('authorization')));
  if (!cookieMode && !bearerMode) return NextResponse.next();
  if (request.nextUrl.pathname.startsWith('/bridge/test-mode/')) return NextResponse.next();
  const method = request.method.toUpperCase();
  const serverAction = request.headers.has('next-action');
  if (!serverAction && (method === 'GET' || method === 'HEAD' || method === 'OPTIONS')) return NextResponse.next();
  if (bearerMode && !serverAction && method === 'POST' && (await nativeRead(request))) return NextResponse.next();
  return blocked();
}

export const config = {
  matcher: ['/bridge/:path*', '/crm/:path*', '/seller/:path*'],
};
