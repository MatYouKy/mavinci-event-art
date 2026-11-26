/*
 * Tryb testowy „widok jako” (`docs/test-mode.md`) — część wspólna przeglądarki, serwera i middleware: nazwy ciasteczek,
 * klucz zastępczy sesji i reguły, które zapytania do Supabase przepuszczamy, wycofujemy albo blokujemy.
 *
 * Klucz zastępczy wygląda jak JWT (biblioteka Supabase odczytuje z niego `sub` i `exp`), ale nie jest podpisany — Supabase
 * go odrzuci. Serwer CRM rozpoznaje go po podpisie `mavinci-test` i podstawia prawdziwy klucz oglądanej osoby, który nigdy nie
 * trafia do przeglądarki. Bez importów zależnych od środowiska (działa w przeglądarce, Node i middleware).
 */

/** Czytelne dla przeglądarki: kogo oglądamy (pasek „Wyjdź z trybu”, przełączenie klienta Supabase na serwer CRM). */
export const TEST_MODE_COOKIE = 'mavinci_test_mode';
/** Tylko dla serwera (httpOnly): `<sesja>.<sekret>` — wyjście z trybu i zapytania przez serwer CRM. */
export const TEST_MODE_KEY_COOKIE = 'mavinci_test_key';
/** Zapytania przeglądarki do Supabase w trybie testowym — przez serwer CRM. */
export const TEST_MODE_PROXY_PATH = '/bridge/test-mode/sb';
/** Najdłuższa sesja testowa. */
export const TEST_MODE_MAX_HOURS = 8;
export const TEST_TOKEN_SIGNATURE = 'mavinci-test';

export type TestModeKind = 'employee' | 'seller';
export type TestModeLabel = { v: 1; id: string; kind: TestModeKind; label: string; landing: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECRET = /^[A-Za-z0-9_-]{32,128}$/;

// ─── base64url (UTF-8) ────────────────────────────────────────────────────────────────────────────────────────────────

export function base64UrlEncode(text: string) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized + '='.repeat((4 - (normalized.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// ─── Ciasteczka ───────────────────────────────────────────────────────────────────────────────────────────────────────

export function encodeTestModeLabel(label: TestModeLabel) {
  return base64UrlEncode(JSON.stringify(label));
}

export function decodeTestModeLabel(value: string | null | undefined): TestModeLabel | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(base64UrlDecode(decodeURIComponent(value))) as Partial<TestModeLabel>;
    if (parsed?.v !== 1 || typeof parsed.id !== 'string' || !UUID.test(parsed.id)) return null;
    if (parsed.kind !== 'employee' && parsed.kind !== 'seller') return null;
    return {
      v: 1,
      id: parsed.id,
      kind: parsed.kind,
      label: String(parsed.label || '').slice(0, 200),
      landing: parsed.landing === '/seller' ? '/seller' : '/crm',
    };
  } catch {
    return null;
  }
}

/** Wartość ciasteczka z nagłówka / `document.cookie`. */
export function readCookie(cookieHeader: string | null | undefined, name: string) {
  for (const part of (cookieHeader || '').split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}

/** Czy ciasteczka wskazują tryb testowy (lista z `cookies().getAll()` albo z middleware). */
export const isTestModeCookies = (cookies: Array<{ name: string }>) =>
  cookies.some((cookie) => cookie.name === TEST_MODE_COOKIE || cookie.name === TEST_MODE_KEY_COOKIE);

let navigating = false;
/** Przeglądarka: trwa wejście w tryb albo wyjście z niego — karty nie przeładowują się same (pasek trybu). */
export const setTestModeNavigation = (value: boolean) => {
  navigating = value;
};
export const testModeNavigating = () => navigating;

export function parseTestKey(value: string | null | undefined): { id: string; secret: string } | null {
  if (!value) return null;
  const decoded = decodeURIComponent(value);
  const index = decoded.indexOf('.');
  if (index < 0) return null;
  const id = decoded.slice(0, index);
  const secret = decoded.slice(index + 1);
  return UUID.test(id) && SECRET.test(secret) ? { id, secret } : null;
}

// ─── Klucz zastępczy ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Klucz zastępczy sesji (nagłówek.treść.`mavinci-test`) z danymi oglądanej osoby i sekretem sesji testowej. */
export function buildTestToken(input: { id: string; secret: string; sub: string; email: string | null; expiresAt: number }) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64UrlEncode(JSON.stringify({
    sub: input.sub,
    email: input.email || undefined,
    aud: 'authenticated',
    role: 'authenticated',
    aal: 'aal1',
    amr: [{ method: 'password', timestamp: now }],
    session_id: input.id,
    is_anonymous: false,
    iat: now,
    exp: input.expiresAt,
    mvt: `${input.id}.${input.secret}`,
  }));
  return `${header}.${payload}.${TEST_TOKEN_SIGNATURE}`;
}

export function parseTestToken(token: string | null | undefined): { id: string; secret: string } | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[2] !== TEST_TOKEN_SIGNATURE) return null;
  try {
    const payload = JSON.parse(base64UrlDecode(parts[1])) as { mvt?: unknown };
    return typeof payload.mvt === 'string' ? parseTestKey(payload.mvt) : null;
  } catch {
    return null;
  }
}

/** Klucz zastępczy z nagłówka `Authorization: Bearer …`. */
export function bearerTestToken(authorization: string | null | undefined) {
  const token = /^Bearer\s+(\S+)$/i.exec(authorization || '')?.[1];
  return parseTestToken(token);
}

// ─── Reguły zapytań do Supabase ──────────────────────────────────────────────────────────────────────────────────────

export type TestModeDecision =
  /** Do Supabase z kluczem oglądanej osoby; `rollback` — zapis wykonany i wycofany (`Prefer: tx=rollback`). */
  | { kind: 'forward'; rollback: boolean }
  /** Odświeżenie sesji w przeglądarce — nowy klucz zastępczy. */
  | { kind: 'session' }
  /** Wylogowanie — bez zmian w prawdziwych sesjach (wyjście z trybu robi pasek „Wyjdź z trybu”). */
  | { kind: 'logout' }
  | { kind: 'block'; message: string };

export const TEST_MODE_MESSAGES = {
  server: 'Tryb testowy: ta operacja serwera jest wyłączona (mogłaby wysłać wiadomość albo zapisać dane) — nic nie zostało zmienione.',
  files: 'Tryb testowy: przesyłanie, przenoszenie i usuwanie plików jest wyłączone — nic nie zostało zapisane.',
  functions: 'Tryb testowy: funkcje serwera Supabase są wyłączone (mogą wysyłać wiadomości albo zapisywać dane).',
  account: 'Tryb testowy: logowanie i zmiana danych konta są wyłączone.',
  other: 'Tryb testowy: to zapytanie jest wyłączone.',
} as const;

const READ = new Set(['GET', 'HEAD']);
/** Odczyt plików, który Supabase wykonuje metodą POST: podpisane adresy i lista plików. */
const STORAGE_READ_POST = ['/storage/v1/object/sign/', '/storage/v1/object/list/'];

/** Co zrobić z zapytaniem do Supabase (`pathname` względem adresu projektu, np. `/rest/v1/events`). */
export function testModeDecision(method: string, pathname: string): TestModeDecision {
  const verb = method.toUpperCase();
  const read = READ.has(verb);
  if (pathname.startsWith('/rest/v1/')) return { kind: 'forward', rollback: !read };
  if (pathname === '/auth/v1/user') return read ? { kind: 'forward', rollback: false } : { kind: 'block', message: TEST_MODE_MESSAGES.account };
  if (pathname === '/auth/v1/token') return verb === 'POST' ? { kind: 'session' } : { kind: 'block', message: TEST_MODE_MESSAGES.account };
  if (pathname === '/auth/v1/logout') return { kind: 'logout' };
  if (pathname.startsWith('/auth/v1/')) return { kind: 'block', message: TEST_MODE_MESSAGES.account };
  if (pathname.startsWith('/storage/v1/')) {
    if (read || (verb === 'POST' && STORAGE_READ_POST.some((prefix) => pathname.startsWith(prefix)))) return { kind: 'forward', rollback: false };
    return { kind: 'block', message: TEST_MODE_MESSAGES.files };
  }
  if (pathname.startsWith('/functions/v1/')) return { kind: 'block', message: TEST_MODE_MESSAGES.functions };
  return { kind: 'block', message: TEST_MODE_MESSAGES.other };
}

// ─── Aplikacje natywne (Mac, telefon) ────────────────────────────────────────────────────────────────────────────────

/**
 * Odczyty natywnego API (`/bridge/native/v1/*`), które aplikacje wysyłają metodą POST (lista identyfikatorów w treści) — jedyne
 * zapytania POST przepuszczane w trybie testowym z kluczem zastępczym w nagłówku (Mac, telefon). `true` — cała trasa jest
 * odczytem; lista — dozwolone `op` (z treści JSON i z adresu; każde podane musi być na liście). Wszystko inne (zapis, wysyłka
 * pliku, e-mail, KSeF, PDF) — 423 w `src/middleware.ts` (i drugi raz w `readJson`, `src/lib/native/auth.ts`).
 * Nowy odczyt wysyłany metodą POST trzeba tu dopisać — inaczej w trybie testowym zwróci „operacja wyłączona”.
 */
const NATIVE_READ_POST: Record<string, true | readonly string[]> = {
  sync: true,
  'sync/items': true,
  contacts: ['items'],
  employees: ['items'],
  events: ['items'],
  'events/card': ['equipmentCatalogItems'],
  inquiries: ['items'],
  meetings: ['items'],
  tasks: ['items'],
  warehouse: ['items'],
  messages: ['mirrorItems', 'bodies'],
  brochures: ['imageUrls', 'fileUrl'],
};
const NATIVE_PREFIX = '/bridge/native/v1/';
/** Największa treść odczytu POST sprawdzana w trybie testowym (listy identyfikatorów są małe). */
export const TEST_MODE_NATIVE_BODY_LIMIT = 512 * 1024;

/** Czy zapytanie POST aplikacji natywnej w trybie testowym jest odczytem (`ops` — `op` z adresu i z treści JSON). */
export function testModeNativeReadAllowed(pathname: string, ops: Array<string | null | undefined>): boolean {
  if (!pathname.startsWith(NATIVE_PREFIX)) return false;
  const route = pathname.slice(NATIVE_PREFIX.length).replace(/\/+$/, '');
  const rule = Object.prototype.hasOwnProperty.call(NATIVE_READ_POST, route) ? NATIVE_READ_POST[route] : undefined;
  if (!rule) return false;
  if (rule === true) return true;
  const present = ops.filter((op): op is string => typeof op === 'string' && op.length > 0);
  return present.length > 0 && present.every((op) => rule.includes(op));
}

/** `op` z treści JSON zapytania (bez rzucania błędów); `undefined` — treść nie jest obiektem JSON. */
export function jsonBodyOp(text: string): string | null | undefined {
  try {
    const parsed = text ? JSON.parse(text) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const op = (parsed as { op?: unknown }).op;
    return typeof op === 'string' ? op : null;
  } catch {
    return undefined;
  }
}

/** `Prefer` z wycofaniem zapisu (bez wcześniejszego `tx=`); `handling=strict` — baza odrzuci zapis, jeśli nie może go wycofać. */
export function withRollbackPrefer(prefer: string | null | undefined) {
  const parts = (prefer || '').split(',').map((part) => part.trim()).filter(Boolean)
    .filter((part) => !/^tx\s*=/i.test(part) && !/^handling\s*=/i.test(part));
  return [...parts, 'tx=rollback', 'handling=strict'].join(', ');
}

/** Czy baza potwierdziła wycofanie (`Preference-Applied: …tx=rollback…`). */
export const rollbackApplied = (preferenceApplied: string | null | undefined) =>
  (preferenceApplied || '').split(',').some((part) => part.trim().toLowerCase() === 'tx=rollback');

/**
 * Treść odpowiedzi „zablokowane” czytelna dla bibliotek Supabase (baza, pliki, logowanie) i aplikacji natywnych (Mac, telefon
 * pokazują pole `error`). Rozpoznanie programowe — `code` / `error_code` = `test_mode`.
 */
export const testModeBlockBody = (message: string) => ({
  code: 'test_mode',
  error: message,
  error_code: 'test_mode',
  message,
  msg: message,
  error_description: message,
  statusCode: '423',
});
