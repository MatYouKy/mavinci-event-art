import 'server-only';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';
import {
  TEST_MODE_MAX_HOURS,
  bearerTestToken,
  buildTestToken,
  rollbackApplied,
  testModeBlockBody,
  testModeDecision,
  withRollbackPrefer,
  type TestModeKind,
} from './shared';

/*
 * Tryb testowy „widok jako” — serwer (`docs/test-mode.md`): sesje testowe w bazie (`private.test_mode_sessions`, funkcje
 * `test_mode_*`), szyfrowanie danych sesji kluczem z sekretu, który zna tylko przeglądarka administratora, odświeżanie klucza
 * oglądanej osoby i przekazywanie zapytań do Supabase z jej kluczem: odczyt bez zmian, zapis wycofany (`tx=rollback`),
 * pliki, funkcje Edge i zmiany konta — zablokowane.
 */

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
/** Odświeżenie klucza osoby, gdy do końca ważności zostało mniej niż tyle. */
const REFRESH_MARGIN_MS = 2 * 60 * 1000;
/** Jak długo trzymamy odczytaną sesję w pamięci procesu (wyjście z trybu działa najpóźniej po tym czasie na innych procesach). */
const CACHE_MS = 15 * 1000;
/** Klucz zastępczy w przeglądarce — ważny najwyżej tyle (odświeżany przez serwer CRM). */
const PLACEHOLDER_SECONDS = 60 * 60;

export type TestModePayload = {
  access_token: string;
  refresh_token: string;
  /** Sekundy (jak w sesji Supabase). */
  expires_at: number;
  user: Record<string, unknown>;
  /** Ciasteczka sesji administratora do przywrócenia po wyjściu. */
  admin_cookies: Array<{ name: string; value: string }>;
};

export type TestSession = {
  id: string;
  secret: string;
  kind: TestModeKind;
  label: string;
  targetAuthUserId: string;
  version: number;
  expiresAt: number;
  payload: TestModePayload;
};

export class TestModeError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

// ─── Szyfrowanie ─────────────────────────────────────────────────────────────────────────────────────────────────────

const pepper = () => {
  const value = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!value) throw new TestModeError('Brak konfiguracji serwera CRM (klucz serwisowy).', 500);
  return value;
};

const sealKey = (id: string, secret: string) => createHmac('sha256', pepper()).update(`mavinci-test-mode:${id}:${secret}`).digest();

export const secretHash = (secret: string) => createHash('sha256').update(secret).digest('hex');

export const newSecret = () => randomBytes(32).toString('base64url');

export function sealPayload(id: string, secret: string, payload: TestModePayload) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', sealKey(id, secret), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return `v1.${Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64')}`;
}

export function openPayload(id: string, secret: string, sealed: string): TestModePayload {
  if (!sealed.startsWith('v1.')) throw new TestModeError('Nieprawidłowe dane sesji testowej.', 401);
  const raw = Buffer.from(sealed.slice(3), 'base64');
  const decipher = createDecipheriv('aes-256-gcm', sealKey(id, secret), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  const text = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  return JSON.parse(text) as TestModePayload;
}

const sameHash = (left: string, right: string) => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

/** Profil logowania osoby bez zbędnych danych (do sesji zastępczej w ciasteczku). */
export function trimUser(user: Record<string, any>): Record<string, unknown> {
  const metadata = (user.user_metadata || {}) as Record<string, unknown>;
  const keep = ['full_name', 'name', 'avatar_url', 'first_name', 'last_name'];
  return {
    id: user.id,
    aud: user.aud || 'authenticated',
    role: user.role || 'authenticated',
    email: user.email || null,
    phone: user.phone || '',
    app_metadata: user.app_metadata || {},
    user_metadata: Object.fromEntries(Object.entries(metadata).filter(([key]) => keep.includes(key))),
    identities: [],
    created_at: user.created_at,
    updated_at: user.updated_at,
    last_sign_in_at: user.last_sign_in_at,
    is_anonymous: false,
  };
}

/** Sesja zastępcza dla przeglądarki (jak sesja Supabase, ale z kluczem zastępczym). */
export function placeholderSession(session: Pick<TestSession, 'id' | 'secret' | 'expiresAt' | 'payload'>) {
  const expiresAt = Math.min(Math.floor(Date.now() / 1000) + PLACEHOLDER_SECONDS, Math.floor(session.expiresAt / 1000));
  const user = session.payload.user;
  const token = buildTestToken({
    id: session.id,
    secret: session.secret,
    sub: String(user.id || ''),
    email: typeof user.email === 'string' ? user.email : null,
    expiresAt,
  });
  return {
    access_token: token,
    token_type: 'bearer',
    expires_in: Math.max(expiresAt - Math.floor(Date.now() / 1000), 0),
    expires_at: expiresAt,
    refresh_token: token,
    user,
  };
}

// ─── Sesja testowa z bazy ────────────────────────────────────────────────────────────────────────────────────────────

const cache = new Map<string, { at: number; session: TestSession; touched: number }>();
const refreshing = new Map<string, Promise<TestSession>>();

export const forgetTestSession = (id: string) => cache.delete(id);

type Row = {
  id: string;
  secret_hash: string;
  payload: string | null;
  version: number;
  kind: TestModeKind;
  label: string;
  target_auth_user_id: string;
  expires_at: string;
  active: boolean;
};

/** Wiersz sesji testowej (także zakończonej — do przywrócenia sesji administratora przy wyjściu). */
export async function readTestSessionRow(id: string, secret: string): Promise<{ row: Row; payload: TestModePayload | null } | null> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc('test_mode_get', { p_id: id });
  if (error) throw new TestModeError('Nie udało się odczytać sesji testowej.', 500);
  const row = data as Row | null;
  if (!row || !sameHash(secretHash(secret), row.secret_hash)) return null;
  let payload: TestModePayload | null = null;
  if (row.payload) {
    try {
      payload = openPayload(id, secret, row.payload);
    } catch {
      payload = null;
    }
  }
  return { row, payload };
}

/** Aktywna sesja testowa (z pamięci procesu albo z bazy); błąd 401 — zakończona, wygasła albo zły sekret. */
export async function loadTestSession(id: string, secret: string): Promise<TestSession> {
  const cached = cache.get(id);
  if (cached && Date.now() - cached.at < CACHE_MS && sameHash(cached.session.secret, secret)) {
    if (cached.session.expiresAt <= Date.now()) throw new TestModeError('Sesja testowa wygasła — wyjdź z trybu testowego.', 401);
    return cached.session;
  }
  const found = await readTestSessionRow(id, secret);
  if (!found || !found.payload) throw new TestModeError('Sesja testowa nie istnieje albo została zakończona — wyjdź z trybu testowego.', 401);
  if (!found.row.active) {
    cache.delete(id);
    throw new TestModeError('Sesja testowa została zakończona albo wygasła — wyjdź z trybu testowego.', 401);
  }
  const session: TestSession = {
    id,
    secret,
    kind: found.row.kind,
    label: found.row.label,
    targetAuthUserId: found.row.target_auth_user_id,
    version: Number(found.row.version) || 0,
    expiresAt: new Date(found.row.expires_at).getTime(),
    payload: found.payload,
  };
  const previous = cache.get(id);
  const touched = previous?.touched || 0;
  cache.set(id, { at: Date.now(), session, touched });
  if (Date.now() - touched > 60 * 1000) {
    cache.set(id, { at: Date.now(), session, touched: Date.now() });
    void createSupabaseAdminClient().rpc('test_mode_touch', { p_id: id }).then(() => undefined, () => undefined);
  }
  return session;
}

/** Klucz oglądanej osoby ważny jeszcze co najmniej 2 minuty (odświeżany kluczem odświeżania sesji testowej). */
async function freshSession(session: TestSession): Promise<TestSession> {
  if (session.payload.expires_at * 1000 - Date.now() > REFRESH_MARGIN_MS) return session;
  const pending = refreshing.get(session.id);
  if (pending) return pending;
  const job = (async () => {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.payload.refresh_token }),
    });
    const body = await response.json().catch(() => null) as { access_token?: string; refresh_token?: string; expires_at?: number; expires_in?: number } | null;
    if (!response.ok || !body?.access_token || !body.refresh_token) {
      // Inny proces mógł już odświeżyć klucz — świeży odczyt z bazy.
      cache.delete(session.id);
      const reloaded = await loadTestSession(session.id, session.secret);
      if (reloaded.payload.expires_at * 1000 - Date.now() > REFRESH_MARGIN_MS) return reloaded;
      throw new TestModeError('Sesja oglądanej osoby wygasła — wyjdź z trybu testowego i wejdź ponownie.', 401);
    }
    const payload: TestModePayload = {
      ...session.payload,
      access_token: body.access_token,
      refresh_token: body.refresh_token,
      expires_at: body.expires_at || Math.floor(Date.now() / 1000) + (body.expires_in || 3600),
    };
    const admin = createSupabaseAdminClient();
    const { data: stored } = await admin.rpc('test_mode_store', {
      p_id: session.id,
      p_version: session.version,
      p_payload: sealPayload(session.id, session.secret, payload),
    });
    if (stored !== true) {
      cache.delete(session.id);
      return loadTestSession(session.id, session.secret);
    }
    const next: TestSession = { ...session, version: session.version + 1, payload };
    cache.set(session.id, { at: Date.now(), session: next, touched: Date.now() });
    return next;
  })();
  refreshing.set(session.id, job);
  try {
    return await job;
  } finally {
    refreshing.delete(session.id);
  }
}

/** Zakończenie sesji testowej (wyjście albo przerwanie po błędzie) — sesja osoby unieważniona w bazie. */
export async function closeTestSession(id: string, reason: string) {
  cache.delete(id);
  const admin = createSupabaseAdminClient();
  await admin.rpc('test_mode_close', { p_id: id, p_reason: reason });
}

// ─── Przekazywanie zapytań do Supabase ───────────────────────────────────────────────────────────────────────────────

const FORWARD_REQUEST_HEADERS = [
  'accept', 'accept-language', 'accept-profile', 'content-profile', 'content-type', 'prefer', 'range', 'range-unit',
  'x-client-info', 'x-upsert', 'cache-control', 'if-none-match', 'if-match', 'x-supabase-api-version',
];
const DROP_RESPONSE_HEADERS = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive', 'set-cookie']);

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

/** Odpowiedź błędu w trybie testowym (czytelna dla bibliotek Supabase). */
export const testModeErrorResponse = (message: string, status: number) => json(testModeBlockBody(message), status);

/**
 * Zapytanie do Supabase w imieniu oglądanej osoby. `path` — ścieżka z zapytaniem względem adresu projektu
 * (np. `/rest/v1/events?select=id`). Zapis do bazy jest wycofywany; gdy baza nie potwierdzi wycofania, tryb zostaje przerwany.
 */
export async function forwardTestRequest(
  session: TestSession, method: string, path: string, incoming: Headers, body?: ArrayBuffer | null,
): Promise<Response> {
  const pathname = path.split('?')[0];
  const decision = testModeDecision(method, pathname);
  if (decision.kind === 'block') return testModeErrorResponse(decision.message, 423);
  if (decision.kind === 'logout') return new Response(null, { status: 204 });
  if (decision.kind === 'session') return json(placeholderSession(session), 200);

  const current = await freshSession(session);
  const headers = new Headers();
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = incoming.get(name);
    if (value) headers.set(name, value);
  }
  headers.set('apikey', ANON_KEY);
  headers.set('Authorization', `Bearer ${current.payload.access_token}`);
  if (decision.rollback) headers.set('Prefer', withRollbackPrefer(headers.get('Prefer')));

  const upstream = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers,
    body: body && body.byteLength ? body : undefined,
    redirect: 'manual',
    cache: 'no-store',
  });
  if (decision.rollback && upstream.ok && !rollbackApplied(upstream.headers.get('preference-applied'))) {
    // Baza nie potwierdziła wycofania — zapis mógł zostać zatwierdzony. Natychmiast kończymy tryb testowy.
    console.error('[test-mode] brak potwierdzenia tx=rollback — sesja testowa przerwana', { session: session.id, method, pathname });
    await closeTestSession(session.id, 'rollback_unconfirmed').catch(() => undefined);
    return testModeErrorResponse('Tryb testowy został przerwany: baza nie potwierdziła wycofania zapisu. Wyjdź z trybu i zgłoś to administratorowi systemu.', 409);
  }
  const responseHeaders = new Headers();
  upstream.headers.forEach((value, name) => {
    if (!DROP_RESPONSE_HEADERS.has(name.toLowerCase())) responseHeaders.set(name, value);
  });
  responseHeaders.set('Cache-Control', 'no-store');
  return new Response(method.toUpperCase() === 'HEAD' ? null : upstream.body, { status: upstream.status, headers: responseHeaders });
}

/**
 * `fetch` dla klientów Supabase na serwerze CRM: zapytania z kluczem zastępczym (tryb testowy) idą w imieniu oglądanej
 * osoby (jak w `forwardTestRequest`), pozostałe — bez zmian.
 */
export function testModeFetch(base?: typeof fetch): typeof fetch {
  const next = base || fetch;
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (!SUPABASE_URL || !request.url.startsWith(`${SUPABASE_URL}/`)) return next(input, init);
    const key = bearerTestToken(request.headers.get('authorization'));
    if (!key) return next(input, init);
    let session: TestSession;
    try {
      session = await loadTestSession(key.id, key.secret);
    } catch (error) {
      const failure = error instanceof TestModeError ? error : new TestModeError('Tryb testowy jest niedostępny.', 500);
      return testModeErrorResponse(failure.message, failure.status);
    }
    const method = request.method.toUpperCase();
    const body = method === 'GET' || method === 'HEAD' ? null : await request.arrayBuffer();
    return forwardTestRequest(session, method, request.url.slice(SUPABASE_URL.length), request.headers, body);
  };
}

// ─── Kontrola przed otwarciem sesji ──────────────────────────────────────────────────────────────────────────────────

/** Czy baza naprawdę wycofuje zapis z `Prefer: tx=rollback` (wiersz próbny nie może zostać). */
export async function verifyRollbackSupport() {
  const admin = createSupabaseAdminClient();
  const token = randomUUID();
  let applied = false;
  // Ten sam klient co serwer (klucz serwisowy), tylko z `Prefer: tx=rollback` — jak każdy zapis w trybie testowym.
  const probeClient = createClient(SUPABASE_URL, pepper(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        headers.set('Prefer', withRollbackPrefer(headers.get('Prefer')));
        const response = await fetch(input, { ...init, headers, cache: 'no-store' });
        applied = rollbackApplied(response.headers.get('preference-applied'));
        return response;
      },
    },
  });
  const probe = await probeClient.rpc('test_mode_probe', { p_token: token });
  const ok = !probe.error;
  const { data: stayed, error } = await admin.rpc('test_mode_probe_take', { p_token: token });
  if (error) throw new TestModeError('Nie udało się sprawdzić bazy przed trybem testowym (migracja 20261202100000_crm_test_mode.sql?).', 500);
  if (stayed === true) {
    console.error('[test-mode] baza nie wycofała zapisu próbnego — tryb testowy wyłączony');
    throw new TestModeError('Baza nie wycofuje zapisów próbnych — tryb testowy jest niedostępny.', 503);
  }
  if (!ok || !applied) throw new TestModeError('Baza nie potwierdziła zapisu próbnego — tryb testowy jest niedostępny.', 503);
}

// ─── Otwarcie sesji testowej ──────────────────────────────────────────────────────────────────────────────────────────

export type OpenedTestSession = {
  id: string;
  secret: string;
  /** Milisekundy. */
  expiresAt: number;
  payload: TestModePayload;
  kind: TestModeKind;
  label: string;
  landing: string;
};

const dbMessage = (message: string | undefined, fallback: string) =>
  message && !/fetch|network|timeout/i.test(message) ? message.replace(/^[A-Z0-9]{5}:\s*/, '') : fallback;

/**
 * Wejście w tryb testowy (przeglądarka: `/bridge/test-mode/start` z ciasteczkami; Mac i telefon: ta sama trasa z kluczem
 * administratora w nagłówku). Baza sprawdza administratora i osobę (`test_mode_prepare`), serwer sprawdza, że baza wycofuje
 * zapisy próbne, otwiera w tle sesję osoby (link logowania wygenerowany na serwerze — bez e-maila) i zapisuje ją zaszyfrowaną
 * sekretem, który dostaje tylko administrator. `adminCookies` — sesja przeglądarki do przywrócenia po wyjściu (aplikacje
 * natywne trzymają sesję administratora u siebie — pusta lista).
 */
export async function openTestSessionFor(input: {
  adminAuthUserId: string;
  kind: TestModeKind;
  targetId: string;
  userAgent: string | null;
  adminCookies: Array<{ name: string; value: string }>;
}): Promise<OpenedTestSession> {
  const admin = createSupabaseAdminClient();
  await admin.rpc('test_mode_close_expired');
  const { data: prepared, error: prepareError } = await admin.rpc('test_mode_prepare', {
    p_admin_auth: input.adminAuthUserId, p_kind: input.kind, p_id: input.targetId,
  });
  if (prepareError || !prepared) {
    const missing = /test_mode_prepare/.test(prepareError?.message || '');
    throw new TestModeError(
      missing ? 'Tryb testowy nie jest jeszcze włączony w bazie (migracja 20261202100000_crm_test_mode.sql).'
        : dbMessage(prepareError?.message, 'Nie udało się przygotować trybu testowego.'),
      prepareError?.code === '42501' ? 403 : 400,
    );
  }
  const target = prepared as { admin_employee_id: string; target_auth_user_id: string; label: string; landing: string };

  await verifyRollbackSupport();

  const { data: found, error: userError } = await admin.auth.admin.getUserById(target.target_auth_user_id);
  const email = found?.user?.email;
  if (userError || !email) throw new TestModeError('Ta osoba nie ma adresu e-mail logowania — nie można otworzyć jej widoku.', 400);
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const hashed = link?.properties?.hashed_token;
  if (linkError || !hashed) throw new TestModeError('Nie udało się otworzyć sesji tej osoby.', 500);
  const anon = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: verified, error: verifyError } = await anon.auth.verifyOtp({ token_hash: hashed, type: 'magiclink' });
  const session = verified?.session;
  if (verifyError || !session || session.user.id !== target.target_auth_user_id) {
    if (session) await revokeAuthSession(session.access_token);
    throw new TestModeError('Nie udało się otworzyć sesji tej osoby.', 500);
  }

  const id = randomUUID();
  const secret = newSecret();
  const expiresAt = Date.now() + TEST_MODE_MAX_HOURS * 60 * 60 * 1000;
  const payload: TestModePayload = {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at || Math.floor(Date.now() / 1000) + (session.expires_in || 3600),
    user: trimUser(session.user as unknown as Record<string, unknown>),
    admin_cookies: input.adminCookies,
  };
  const { error: openError } = await admin.rpc('test_mode_open', {
    p_id: id,
    p_secret_hash: secretHash(secret),
    p_admin_auth: input.adminAuthUserId,
    p_admin_employee: target.admin_employee_id,
    p_kind: input.kind,
    p_ref: input.targetId,
    p_target_auth: target.target_auth_user_id,
    p_label: target.label,
    p_auth_session: authSessionIdFromJwt(session.access_token),
    p_payload: sealPayload(id, secret, payload),
    p_expires_at: new Date(expiresAt).toISOString(),
    p_user_agent: (input.userAgent || '').slice(0, 300) || null,
  });
  if (openError) {
    await revokeAuthSession(session.access_token);
    throw new TestModeError(dbMessage(openError.message, 'Nie udało się zapisać sesji testowej.'), 500);
  }
  return { id, secret, expiresAt, payload, kind: input.kind, label: target.label, landing: target.landing };
}

/** Identyfikator sesji logowania (`session_id`) z klucza Supabase — do unieważnienia przy wyjściu. */
export function authSessionIdFromJwt(token: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] || '', 'base64url').toString('utf8')) as { session_id?: unknown };
    return typeof payload.session_id === 'string' ? payload.session_id : null;
  } catch {
    return null;
  }
}

/** Unieważnienie tylko tej jednej sesji logowania (gdy nie udało się zapisać sesji testowej). */
export async function revokeAuthSession(accessToken: string) {
  await fetch(`${SUPABASE_URL}/auth/v1/logout?scope=local`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  }).catch(() => undefined);
}

/** Opcje `global` klienta Supabase z tokenem z nagłówka: klucz zastępczy trybu testowego — zapytania w imieniu oglądanej osoby. */
export const testModeGlobalFor = (token: string | null | undefined): { fetch?: typeof fetch } =>
  bearerTestToken(token ? `Bearer ${token}` : null) ? { fetch: testModeFetch() } : {};

/**
 * Klient do sprawdzenia tokenu z nagłówka (`auth.getUser(token)`): dla klucza zastępczego trybu testowego — klient w imieniu
 * oglądanej osoby (klucz serwisowy nie rozpozna klucza zastępczego); dla zwykłego tokenu — `null` (bez zmian).
 */
export function testModeAuthClient(token: string | null | undefined) {
  if (!bearerTestToken(token ? `Bearer ${token}` : null)) return null;
  return createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` }, fetch: testModeFetch() },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
