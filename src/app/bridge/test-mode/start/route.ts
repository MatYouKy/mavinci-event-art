import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createChunks, isChunkLike, stringToBase64URL } from '@supabase/ssr';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';
import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';
import { SUPABASE_PROJECT_REF } from '@/lib/supabase/projectUrl';
import {
  TEST_MODE_COOKIE,
  TEST_MODE_KEY_COOKIE,
  TEST_MODE_MAX_HOURS,
  TEST_MODE_PROXY_PATH,
  encodeTestModeLabel,
  isTestModeCookies,
  parseTestToken,
  type TestModeKind,
} from '@/lib/testMode/shared';
import { TestModeError, openTestSessionFor, placeholderSession } from '@/lib/testMode/session.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/*
 * Wejście w tryb testowy „widok jako” (`docs/test-mode.md`). Tylko administrator (sprawdza baza: `test_mode_prepare`).
 * Serwer sprawdza, że baza wycofuje zapisy próbne, otwiera w tle sesję wybranej osoby (link logowania wygenerowany na
 * serwerze — bez e-maila) i zapisuje ją zaszyfrowaną (`openTestSessionFor`).
 * - Przeglądarka (Ustawienia → „Tryb testowy”, ciasteczka): ciasteczko sesji podmienione na sesję zastępczą; sesja
 *   administratora wraca przy wyjściu (`/bridge/test-mode/exit`).
 * - Mac i telefon (`Authorization: Bearer <klucz administratora>`, tylko pracownicy): odpowiedź z sesją zastępczą — aplikacja
 *   łączy się z bazą przez `/bridge/test-mode/sb`, a własną sesję administratora trzyma u siebie do wyjścia.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
const sameOrigin = (request: Request) => {
  try {
    const origin = request.headers.get('origin');
    return Boolean(origin) && new URL(origin as string).host === request.headers.get('host');
  } catch {
    return false;
  }
};

export async function POST(request: Request) {
  const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') || '')?.[1] || null;
  if (!bearer && !sameOrigin(request)) return fail('Nieprawidłowe źródło żądania.', 403);
  let body: { kind?: unknown; id?: unknown };
  try {
    body = await request.json();
  } catch {
    return fail('Nieprawidłowe dane.', 400);
  }
  const kind: TestModeKind | null = body.kind === 'employee' ? 'employee' : body.kind === 'seller' ? 'seller' : null;
  const targetId = typeof body.id === 'string' && UUID.test(body.id) ? body.id : null;
  if (!kind || !targetId) return fail('Wybierz osobę.', 400);
  const userAgent = request.headers.get('user-agent');

  try {
    if (bearer) {
      // Mac / telefon: administrator rozpoznany po własnym kluczu; sesja zastępcza w odpowiedzi (bez ciasteczek).
      if (parseTestToken(bearer)) return fail('Jesteś już w trybie testowym — najpierw wyjdź z trybu.', 409);
      if (kind !== 'employee') {
        return fail('Widok sprzedawcy zewnętrznego sprawdzisz w CRM w przeglądarce (Ustawienia → „Tryb testowy”).', 400);
      }
      const { data: auth, error } = await createSupabaseAdminClient().auth.getUser(bearer);
      if (error || !auth.user) return fail('Sesja wygasła — zaloguj się ponownie.', 401);
      const opened = await openTestSessionFor({ adminAuthUserId: auth.user.id, kind, targetId, userAgent, adminCookies: [] });
      return NextResponse.json({
        id: opened.id,
        kind: opened.kind,
        label: opened.label,
        landing: opened.landing,
        proxy: TEST_MODE_PROXY_PATH,
        expires_at: Math.floor(opened.expiresAt / 1000),
        session: placeholderSession(opened),
      }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const cookieStore = cookies();
    if (isTestModeCookies(cookieStore.getAll())) return fail('Jesteś już w trybie testowym — najpierw wyjdź z trybu.', 409);

    // Sesja administratora: odświeżona przy sprawdzeniu (nowe klucze) trafia do kopii przywracanej po wyjściu — bez tego stary
    // klucz odświeżania byłby już zużyty i po wyjściu trzeba by logować się ponownie.
    const updated = new Map<string, string>();
    const adminStore = {
      getAll: () => {
        const current = cookieStore.getAll().map((cookie) => (updated.has(cookie.name) ? { name: cookie.name, value: updated.get(cookie.name) || '' } : cookie));
        const added = [...updated].filter(([name]) => !current.some((cookie) => cookie.name === name)).map(([name, value]) => ({ name, value }));
        return [...current, ...added];
      },
      set: (name: string, value: string) => {
        updated.set(name, value);
      },
    };
    const supabase = createSupabaseServerClient(adminStore);
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return fail('Zaloguj się ponownie.', 401);

    const base = `sb-${SUPABASE_PROJECT_REF}-auth-token`;
    const adminCookies = adminStore.getAll().filter((cookie) => isChunkLike(cookie.name, base) && cookie.value)
      .map(({ name, value }) => ({ name, value }));
    const opened = await openTestSessionFor({ adminAuthUserId: auth.user.id, kind, targetId, userAgent, adminCookies });

    const placeholder = placeholderSession(opened);
    const chunks = createChunks(base, `base64-${stringToBase64URL(JSON.stringify(placeholder))}`);
    const written = new Set(chunks.map((chunk) => chunk.name));
    const present = cookieStore.getAll().filter((cookie) => isChunkLike(cookie.name, base)).map((cookie) => cookie.name);
    const secure = new URL(request.url).protocol === 'https:' || process.env.NODE_ENV === 'production';
    const maxAge = TEST_MODE_MAX_HOURS * 60 * 60;
    const response = NextResponse.json({ landing: opened.landing, label: opened.label }, { headers: { 'Cache-Control': 'no-store' } });
    for (const name of new Set([...present, ...adminCookies.map((cookie) => cookie.name)])) {
      if (!written.has(name)) response.cookies.set(name, '', { path: '/', maxAge: 0 });
    }
    for (const chunk of chunks) {
      response.cookies.set(chunk.name, chunk.value, { path: '/', sameSite: 'lax', httpOnly: false, secure, maxAge });
    }
    response.cookies.set(TEST_MODE_KEY_COOKIE, `${opened.id}.${opened.secret}`, { path: '/', sameSite: 'lax', httpOnly: true, secure, maxAge });
    response.cookies.set(TEST_MODE_COOKIE, encodeTestModeLabel({ v: 1, id: opened.id, kind, label: opened.label, landing: opened.landing }), {
      path: '/', sameSite: 'lax', httpOnly: false, secure, maxAge,
    });
    return response;
  } catch (error) {
    if (error instanceof TestModeError) return fail(error.message, error.status);
    console.error('[test-mode/start]', error);
    return fail('Nie udało się włączyć trybu testowego.', 500);
  }
}
