import 'server-only';

import { getMetaGraphVersion } from './providers.server';

/*
 * Klient Meta Graph API: token wyłącznie w nagłówku `Authorization: Bearer` (nigdy w adresie — adresy trafiają do logów
 * serwerów pośrednich), parametry GET w adresie, POST jako formularz, limit czasu, czytelne błędy po polsku.
 * Kody błędów Meta: 190 — token wygasł lub cofnięty, 10 / 200–299 — brak uprawnienia, 4 / 17 / 32 / 613 — limity,
 * `is_transient` — błąd chwilowy (ponowienie ma sens).
 */

export class MetaGraphError extends Error {
  status: number;
  code: number | null;
  subcode: number | null;
  transient: boolean;

  constructor(message: string, options: { status: number; code: number | null; subcode: number | null; transient: boolean }) {
    super(message);
    this.name = 'MetaGraphError';
    this.status = options.status;
    this.code = options.code;
    this.subcode = options.subcode;
    this.transient = options.transient;
  }
}

type Params = Record<string, string | number | boolean | null | undefined>;

export const metaAuthHeaders = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` });

function graphUrl(path: string) {
  return `https://graph.facebook.com/${getMetaGraphVersion()}/${path.replace(/^\/+/, '')}`;
}

function describe(label: string, status: number, payload: any): MetaGraphError {
  const error = payload?.error || {};
  const code = Number.isFinite(Number(error.code)) ? Number(error.code) : null;
  const subcode = Number.isFinite(Number(error.error_subcode)) ? Number(error.error_subcode) : null;
  const transient = error.is_transient === true || status >= 500 || [1, 2, 4, 17, 32, 341, 613].includes(code ?? -1);
  let message = String(error.error_user_msg || error.message || `HTTP ${status}`).trim();
  if (code === 190) {
    message = 'Token Meta wygasł albo został cofnięty — w ustawieniach marketingu marki kliknij „Odśwież dostęp” przy Meta.';
  } else if (code === 10 || (code !== null && code >= 200 && code <= 299)) {
    message = `Brak uprawnienia w Meta (${error.message || 'odmowa dostępu'}). Dodaj uprawnienie w konfiguracji logowania aplikacji Meta i kliknij „Odśwież dostęp”.`;
  } else if (code === 4 || code === 17 || code === 32 || code === 613) {
    message = 'Meta chwilowo ogranicza liczbę zapytań — spróbuj ponownie za kilka minut.';
  } else if (code === 9007 || subcode === 2207027) {
    message = 'Instagram jeszcze przetwarza grafikę — spróbuj ponownie za chwilę.';
  } else if (code === 9 || subcode === 2207042) {
    message = 'Osiągnięto dzienny limit publikacji Instagrama dla tego konta — spróbuj jutro.';
  }
  return new MetaGraphError(`${label}: ${message}`.slice(0, 1000), { status, code, subcode, transient });
}

/** Zapytanie Graph API (`path` bez wersji, np. `123/photos`). */
export async function metaGraph<T = any>(
  path: string,
  options: { token: string; label: string; method?: 'GET' | 'POST' | 'DELETE'; params?: Params; timeoutMs?: number },
): Promise<T> {
  const method = options.method || 'GET';
  const url = new URL(graphUrl(path));
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(options.params || {})) {
    if (value === null || value === undefined) continue;
    if (method === 'GET') url.searchParams.set(key, String(value));
    else form.set(key, String(value));
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        ...metaAuthHeaders(options.token),
        ...(method === 'GET' ? {} : { 'Content-Type': 'application/x-www-form-urlencoded' }),
      },
      body: method === 'GET' ? undefined : form,
      cache: 'no-store',
      signal: controller.signal,
    });
  } catch (error) {
    const aborted = (error as { name?: string })?.name === 'AbortError';
    throw new MetaGraphError(`${options.label}: ${aborted ? 'Meta nie odpowiedziała na czas' : 'brak połączenia z Meta'}.`, {
      status: 0, code: null, subcode: null, transient: true,
    });
  } finally {
    clearTimeout(timer);
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.error) throw describe(options.label, response.status, payload);
  return payload as T;
}

/** Uprawnienia Meta potrzebne do publikacji, komentarzy i statystyk postów (konfiguracja logowania aplikacji Meta). */
export const META_SOCIAL_SCOPES = {
  facebookPublish: ['pages_manage_posts', 'pages_read_engagement'],
  instagramPublish: ['instagram_basic', 'instagram_content_publish'],
  facebookCommentsRead: ['pages_read_user_content'],
  facebookCommentsReply: ['pages_manage_engagement'],
  instagramComments: ['instagram_manage_comments'],
  facebookInsights: ['read_insights'],
  instagramInsights: ['instagram_manage_insights'],
} as const;

/** `pages_read_user_content` występuje w nowszych konfiguracjach Meta także jako `pages_read_user_engagement`. */
export function hasMetaScope(scopes: readonly string[], scope: string) {
  if (scopes.includes(scope)) return true;
  if (scope === 'pages_read_user_content') return scopes.includes('pages_read_user_engagement');
  return false;
}

export const missingMetaScopes = (scopes: readonly string[], required: readonly string[]) =>
  required.filter((scope) => !hasMetaScope(scopes, scope));
