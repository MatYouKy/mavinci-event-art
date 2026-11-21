import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { decryptMarketingCredentials, encryptMarketingCredentials } from '@/lib/marketing/crypto.server';
import { isObject, text, type Row } from './socialCommon.server';

/*
 * LinkedIn (strona firmowa marki) — kanał „LinkedIn — post”: konto z integracji marketingu `linkedin` (token zaszyfrowany,
 * odświeżany po stronie serwera CRM), publikacja (jedno zdjęcie albo kilka — karuzela okładki i zdjęć posta), komentarze
 * i odpowiedzi jako strona. Community Management API (`/rest/*`, nagłówek `LinkedIn-Version`). Konfiguracja aplikacji
 * LinkedIn (LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET) — później; do tego czasu kanał pokazuje brak konfiguracji, a post
 * publikuje się ręcznie (paczka + „Oznacz jako opublikowany”).
 */

export const LINKEDIN_SCOPES = ['w_organization_social', 'r_organization_social', 'rw_organization_admin'];
/** Wersja API LinkedIn (RRRRMM) — zmiana bez wdrożenia kodu przez LINKEDIN_API_VERSION. */
export const linkedInVersion = () => (/^\d{6}$/.test(process.env.LINKEDIN_API_VERSION || '') ? String(process.env.LINKEDIN_API_VERSION) : '202510');
export const linkedInConfigured = () => Boolean(process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET);
const API = 'https://api.linkedin.com/rest';
const REAUTHORIZE = 'kliknij „Odśwież dostęp” przy LinkedIn w ustawieniach marketingu marki';
/** Treść posta LinkedIn (commentary) — limit platformy. */
export const LINKEDIN_TEXT_LIMIT = 3000;

type LinkedInCredentials = { access_token: string; refresh_token?: string | null; expires_at?: string | null; refresh_expires_at?: string | null };

export type LinkedInAccount = {
  integrationId: string | null;
  connected: boolean;
  organizationId: string | null;
  organizationName: string | null;
  token: string | null;
  scopes: string[];
  /** Co blokuje publikację (brak — gotowe). */
  problem: string | null;
  /** Odczyt komentarzy postów strony (`r_organization_social`). */
  comments: boolean;
  /** Odpowiedzi jako strona (`r_organization_social` i `w_organization_social`). */
  reply: boolean;
};

export class LinkedInError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
/** Przerwane wysłanie samego posta — nie wiadomo, czy LinkedIn go przyjął (sprawdzamy przy następnej próbie). */
export class LinkedInUncertainError extends LinkedInError {}

export const linkedInOrganizationUrn = (id: string) => `urn:li:organization:${id}`;

/** Wywołanie API LinkedIn (JSON); `status 0` — brak połączenia albo przekroczony czas (wynik nieznany). */
async function linkedIn<T = Row>(
  path: string,
  options: { token: string; label: string; method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown; query?: Record<string, string>; timeoutMs?: number },
): Promise<{ data: T; headers: Headers }> {
  const url = new URL(path.startsWith('https://') ? path : `${API}/${path}`);
  for (const [key, value] of Object.entries(options.query || {})) url.searchParams.set(key, value);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);
  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method || 'GET',
      headers: {
        Authorization: `Bearer ${options.token}`,
        'LinkedIn-Version': linkedInVersion(),
        'X-Restli-Protocol-Version': '2.0.0',
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      cache: 'no-store',
      signal: controller.signal,
    });
  } catch (error) {
    const aborted = (error as { name?: string })?.name === 'AbortError';
    throw new LinkedInError(`${options.label}: ${aborted ? 'LinkedIn nie odpowiedział na czas' : 'brak połączenia z LinkedIn'}.`, 0);
  } finally {
    clearTimeout(timer);
  }
  const raw = await response.text();
  let data: unknown = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
  if (!response.ok) {
    const message = isObject(data) ? text(data.message) || text(data.error_description) : '';
    const hint = response.status === 401 ? ` — ${REAUTHORIZE}` : response.status === 403 ? ' — brak uprawnień strony LinkedIn (administrator strony i zakres w_organization_social)' : '';
    throw new LinkedInError(`${options.label}: ${message || `HTTP ${response.status}`}${hint}.`, response.status);
  }
  return { data: data as T, headers: response.headers };
}

/** Odświeżenie tokenu (refresh token LinkedIn) i zapis zaszyfrowanych danych. */
async function refreshToken(admin: SupabaseClient, integrationId: string, credentials: LinkedInCredentials): Promise<LinkedInCredentials | null> {
  if (!credentials.refresh_token || !linkedInConfigured()) return null;
  const response = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: credentials.refresh_token,
      client_id: String(process.env.LINKEDIN_CLIENT_ID),
      client_secret: String(process.env.LINKEDIN_CLIENT_SECRET),
    }),
    cache: 'no-store',
  }).catch(() => null);
  if (!response?.ok) return null;
  const tokens = (await response.json().catch(() => ({}))) as Row;
  if (!text(tokens.access_token)) return null;
  const next: LinkedInCredentials = {
    access_token: text(tokens.access_token),
    refresh_token: text(tokens.refresh_token) || credentials.refresh_token,
    expires_at: tokens.expires_in ? new Date(Date.now() + Number(tokens.expires_in) * 1000).toISOString() : null,
    refresh_expires_at: tokens.refresh_token_expires_in
      ? new Date(Date.now() + Number(tokens.refresh_token_expires_in) * 1000).toISOString() : credentials.refresh_expires_at || null,
  };
  await admin.from('marketing_integrations').update({
    credentials_encrypted: encryptMarketingCredentials(next), token_expires_at: next.expires_at, status: 'connected', last_error: null,
  }).eq('id', integrationId);
  return next;
}

/** Konto LinkedIn marki (strona firmowa z ustawień marketingu) z gotowością do publikacji. */
export async function loadLinkedInAccount(admin: SupabaseClient, companyId: string): Promise<LinkedInAccount> {
  const empty: LinkedInAccount = {
    integrationId: null, connected: false, organizationId: null, organizationName: null, token: null, scopes: [], comments: false, reply: false,
    problem: linkedInConfigured()
      ? 'połącz LinkedIn w ustawieniach marketingu marki (strona firmowa).'
      : 'automatyczna publikacja na LinkedIn nie jest jeszcze skonfigurowana — opublikuj post ręcznie (paczka + „Oznacz jako opublikowany”) albo usuń kanał LinkedIn.',
  };
  const { data } = await admin.from('marketing_integrations').select('id, status, settings, scopes, credentials_encrypted, token_expires_at')
    .eq('company_id', companyId).eq('provider', 'linkedin').maybeSingle();
  const row = data as Row | null;
  if (!row || row.status === 'not_connected' || !row.credentials_encrypted) return empty;
  const settings = isObject(row.settings) ? row.settings : {};
  const scopes = Array.isArray(row.scopes) ? (row.scopes as unknown[]).map(text) : [];
  const account: LinkedInAccount = {
    ...empty,
    integrationId: String(row.id),
    connected: true,
    organizationId: text(settings.organization_id) || null,
    organizationName: text(settings.organization_name) || null,
    scopes,
    problem: null,
  };
  let credentials: LinkedInCredentials | null = null;
  try {
    credentials = decryptMarketingCredentials<LinkedInCredentials>(String(row.credentials_encrypted));
  } catch {
    return { ...account, problem: `nie udało się odczytać zapisanego dostępu do LinkedIn — ${REAUTHORIZE}.` };
  }
  const expiresAt = credentials?.expires_at ? new Date(credentials.expires_at).getTime() : Number.POSITIVE_INFINITY;
  if (credentials && Number.isFinite(expiresAt) && expiresAt < Date.now() + 5 * 60_000) {
    credentials = await refreshToken(admin, String(row.id), credentials);
    if (!credentials) return { ...account, problem: `dostęp do LinkedIn wygasł — ${REAUTHORIZE}.` };
  }
  account.token = credentials?.access_token || null;
  if (!account.token) return { ...account, problem: `brak tokenu LinkedIn — ${REAUTHORIZE}.` };
  const missing = scopes.length ? LINKEDIN_SCOPES.filter((scope) => scope !== 'rw_organization_admin' && !scopes.includes(scope)) : [];
  account.comments = Boolean(account.organizationId) && !missing.includes('r_organization_social');
  account.reply = account.comments && !missing.includes('w_organization_social');
  if (!account.organizationId) account.problem = 'wybierz stronę firmową LinkedIn w ustawieniach marketingu marki.';
  else if (missing.includes('w_organization_social')) account.problem = `brak uprawnienia LinkedIn w_organization_social — ${REAUTHORIZE}.`;
  return account;
}

/** Odpowiedź serwera autoryzacji LinkedIn (błąd jako `error` + `error_description`). */
async function oauthJson(response: Response, label: string): Promise<Row> {
  const data = (await response.json().catch(() => ({}))) as Row;
  if (!response.ok) {
    const code = text(data.error);
    const message = code === 'invalid_grant' || code === 'invalid_request'
      ? 'kod logowania wygasł lub został już użyty — połącz LinkedIn ponownie'
      : text(data.error_description) || code || `HTTP ${response.status}`;
    throw new Error(`${label}: ${message}.`);
  }
  return data;
}

/** Wymiana kodu z logowania LinkedIn na token (OAuth 2.0, 3-legged) — dane do zaszyfrowania i przyznane uprawnienia. */
export async function exchangeLinkedInCode(code: string, redirectUri: string) {
  if (!linkedInConfigured()) throw new Error('Brak konfiguracji OAuth LinkedIn.');
  const response = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: String(process.env.LINKEDIN_CLIENT_ID),
      client_secret: String(process.env.LINKEDIN_CLIENT_SECRET),
    }),
    cache: 'no-store',
  });
  const tokens = await oauthJson(response, 'Autoryzacja LinkedIn');
  const accessToken = text(tokens.access_token);
  if (!accessToken) throw new Error('LinkedIn nie zwrócił tokenu dostępu.');
  const expiresAt = tokens.expires_in ? new Date(Date.now() + Number(tokens.expires_in) * 1000).toISOString() : null;
  const credentials: LinkedInCredentials = {
    access_token: accessToken,
    refresh_token: text(tokens.refresh_token) || null,
    expires_at: expiresAt,
    refresh_expires_at: tokens.refresh_token_expires_in
      ? new Date(Date.now() + Number(tokens.refresh_token_expires_in) * 1000).toISOString() : null,
  };
  const scopes = text(tokens.scope).split(/[\s,]+/).filter(Boolean);
  return { credentials, expiresAt, scopes: scopes.length ? scopes : LINKEDIN_SCOPES };
}

/** Strony firmowe, którymi zarządza konto (administrator) — wybór strony w ustawieniach marketingu. */
export async function linkedInOrganizations(token: string): Promise<Array<{ id: string; name: string; vanityName: string | null }>> {
  const { data } = await linkedIn<{ elements?: Row[] }>('organizationAcls', {
    token, label: 'Strony LinkedIn', query: { q: 'roleAssignee', role: 'ADMINISTRATOR', state: 'APPROVED', count: '50' },
  });
  const ids = Array.from(new Set((data.elements || []).map((item) => text(item.organization).split(':').pop() || '').filter((id) => /^\d+$/.test(id))));
  const result: Array<{ id: string; name: string; vanityName: string | null }> = [];
  for (const id of ids.slice(0, 50)) {
    try {
      const { data: organization } = await linkedIn<Row>(`organizations/${id}`, { token, label: 'Strona LinkedIn' });
      const localized = isObject(organization.localizedName) ? '' : text(organization.localizedName);
      result.push({ id, name: localized || text(organization.vanityName) || `Strona ${id}`, vanityName: text(organization.vanityName) || null });
    } catch {
      result.push({ id, name: `Strona ${id}`, vanityName: null });
    }
  }
  return result;
}

/**
 * Tekst posta w formacie LinkedIn („little text”): znaki zastrzeżone poprzedzone „\”, hashtagi jako szablony
 * `{hashtag|\#|tag}` (klikalne na LinkedIn).
 */
export function linkedInCommentary(message: string): string {
  const escape = (value: string) => value.replace(/[\\|{}@[\]()<>#*_~]/g, (char) => `\\${char}`);
  const parts: string[] = [];
  const pattern = /#([\p{L}\p{N}_]+)/gu;
  let last = 0;
  for (const match of message.matchAll(pattern)) {
    const index = match.index ?? 0;
    parts.push(escape(message.slice(last, index)));
    parts.push(`{hashtag|\\#|${match[1].replace(/_/g, '\\_')}}`);
    last = index + match[0].length;
  }
  parts.push(escape(message.slice(last)));
  return parts.join('');
}

async function uploadImage(account: LinkedInAccount, bytes: Buffer): Promise<string> {
  const token = account.token as string;
  const { data } = await linkedIn<{ value?: Row }>('images', {
    token, method: 'POST', label: 'Zdjęcie LinkedIn', query: { action: 'initializeUpload' },
    body: { initializeUploadRequest: { owner: linkedInOrganizationUrn(account.organizationId as string) } },
  });
  const uploadUrl = isObject(data.value) ? text(data.value.uploadUrl) : '';
  const image = isObject(data.value) ? text(data.value.image) : '';
  if (!uploadUrl || !image) throw new Error('LinkedIn nie przygotował wysyłki zdjęcia.');
  const upload = await fetch(uploadUrl, {
    method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/jpeg' }, body: new Uint8Array(bytes), cache: 'no-store',
  }).catch(() => null);
  if (!upload?.ok) throw new Error('LinkedIn nie przyjął zdjęcia.');
  return image;
}

/** Ostatnie posty strony (sprawdzenie, czy przerwana publikacja już jest na LinkedIn). */
export async function linkedInRecentPost(account: LinkedInAccount, message: string, since: number): Promise<{ id: string; permalink: string } | null> {
  const commentary = linkedInCommentary(message);
  const { data } = await linkedIn<{ elements?: Row[] }>('posts', {
    token: account.token as string, label: 'Posty LinkedIn',
    query: { q: 'author', author: linkedInOrganizationUrn(account.organizationId as string), count: '10', sortBy: 'CREATED' },
  });
  const clean = (value: string) => value.replace(/\s+/g, ' ').trim();
  const found = (data.elements || []).find((item) => clean(text(item.commentary)) === clean(commentary)
    && Number(item.createdAt || (isObject(item.created) ? item.created.time : 0)) >= since);
  if (!found) return null;
  const id = text(found.id);
  return id ? { id, permalink: linkedInPermalink(id) } : null;
}

export const linkedInPermalink = (urn: string) => `https://www.linkedin.com/feed/update/${encodeURIComponent(urn)}/`;

/**
 * Publikacja posta strony: jedno zdjęcie albo kilka (okładka i zdjęcia karuzeli — LinkedIn „multiImage”, 2–20 zdjęć)
 * z opisem. Zdjęcia najpierw trafiają do LinkedIn (bez publikacji), dopiero potem jeden post — tylko przerwanie tego
 * ostatniego kroku daje niepewny wynik (`LinkedInUncertainError`).
 */
export async function publishLinkedInPost(account: LinkedInAccount, files: Buffer[], message: string): Promise<{ id: string; permalink: string }> {
  if (account.problem || !account.token || !account.organizationId) throw new Error(account.problem || 'LinkedIn nie jest połączony.');
  const images: string[] = [];
  for (const bytes of files.slice(0, 20)) images.push(await uploadImage(account, bytes));
  if (!images.length) throw new Error('brak grafiki do publikacji.');
  let response: { data: Row; headers: Headers };
  try {
    response = await linkedIn<Row>('posts', {
      token: account.token,
      method: 'POST',
      label: 'Post LinkedIn',
      timeoutMs: 90_000,
      body: {
        author: linkedInOrganizationUrn(account.organizationId),
        commentary: linkedInCommentary(message),
        visibility: 'PUBLIC',
        distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
        content: images.length > 1 ? { multiImage: { images: images.map((id) => ({ id })) } } : { media: { id: images[0] } },
        lifecycleState: 'PUBLISHED',
        isReshareDisabledByAuthor: false,
      },
    });
  } catch (error) {
    if (error instanceof LinkedInError && error.status === 0) throw new LinkedInUncertainError(error.message, 0);
    throw error;
  }
  const { headers, data } = response;
  const id = headers.get('x-restli-id') || headers.get('x-linkedin-id') || text(data.id);
  if (!id) throw new Error('LinkedIn nie zwrócił identyfikatora posta.');
  return { id, permalink: linkedInPermalink(id) };
}

export type LinkedInComment = {
  external_id: string; parent_external_id: string | null; author_name: string; author_external_id: string | null;
  is_own: boolean; message: string; commented_at: string; like_count: number;
};

/** Komentarze posta strony (najwyżej 50 najnowszych) wraz z odpowiedziami w wątkach. */
export async function linkedInComments(account: LinkedInAccount, postUrn: string): Promise<LinkedInComment[] | null> {
  if (!account.token || !account.organizationId || !account.comments) return null;
  const orgUrn = linkedInOrganizationUrn(account.organizationId);
  const map = (item: Row, parent: string | null): LinkedInComment => {
    const actor = text(item.actor);
    const created = isObject(item.created) ? Number(item.created.time) : Number(item.createdAt);
    return {
      external_id: text(item.commentUrn) || text(item.$URN) || text(item.id),
      parent_external_id: parent,
      author_name: actor === orgUrn ? account.organizationName || 'Strona marki' : 'Użytkownik LinkedIn',
      author_external_id: actor || null,
      is_own: actor === orgUrn,
      message: (isObject(item.message) ? text(item.message.text) : '').slice(0, 8000),
      commented_at: Number.isFinite(created) && created > 0 ? new Date(created).toISOString() : new Date().toISOString(),
      like_count: isObject(item.likesSummary) ? Math.max(0, Number(item.likesSummary.totalLikes) || 0) : 0,
    };
  };
  const { data } = await linkedIn<{ elements?: Row[] }>(`socialActions/${encodeURIComponent(postUrn)}/comments`, {
    token: account.token, label: 'Komentarze LinkedIn', query: { count: '50' },
  });
  const result: LinkedInComment[] = [];
  for (const item of data.elements || []) {
    const comment = map(item, null);
    if (!comment.external_id) continue;
    result.push(comment);
    const replies = isObject(item.commentsSummary) ? Number(item.commentsSummary.aggregatedTotalComments) || 0 : 0;
    if (replies > 0) {
      try {
        const { data: thread } = await linkedIn<{ elements?: Row[] }>(`socialActions/${encodeURIComponent(comment.external_id)}/comments`, {
          token: account.token, label: 'Odpowiedzi LinkedIn', query: { count: '50' },
        });
        for (const reply of thread.elements || []) {
          const mapped = map(reply, comment.external_id);
          if (mapped.external_id) result.push(mapped);
        }
      } catch {
        // Wątek niedostępny — zostaje sam komentarz.
      }
    }
  }
  return result;
}

/** Odpowiedź strony na komentarz (wątek pod komentarzem najwyższego poziomu). */
export async function replyOnLinkedIn(account: LinkedInAccount, postUrn: string, commentUrn: string, message: string): Promise<string | null> {
  if (!account.token || !account.organizationId || !account.reply) {
    throw Object.assign(new Error(`Odpowiedzi na LinkedIn wymagają połączonej strony firmowej i uprawnień r_organization_social, w_organization_social — ${REAUTHORIZE}.`), { status: 422 });
  }
  // Odpowiedź w wątku: `object` — aktywność, do której należy komentarz (część jego URN), inaczej post.
  const activity = /^urn:li:comment:\((urn:li:[A-Za-z]+:\d+),/.exec(commentUrn)?.[1] || postUrn;
  const { headers, data } = await linkedIn<Row>(`socialActions/${encodeURIComponent(commentUrn)}/comments`, {
    token: account.token, method: 'POST', label: 'Odpowiedź LinkedIn',
    body: { actor: linkedInOrganizationUrn(account.organizationId), object: activity, parentComment: commentUrn, message: { text: message.slice(0, 1250) } },
  });
  // Ten sam identyfikator co przy pobieraniu komentarzy (URN komentarza), żeby odpowiedź nie zapisała się dwa razy.
  const id = text(data.commentUrn) || text(data.$URN) || headers.get('x-restli-id') || '';
  if (!id) return null;
  return id.startsWith('urn:li:comment:') || !/^\d+$/.test(id) ? id : `urn:li:comment:(${activity},${id})`;
}
