import { supabase } from './supabase';
import type { FunnelInquiry, InquiryAccess, InquiryStageId } from './inquiryFunnel';

/*
 * Zapytania (lejek sprzedaży) w aplikacji — to samo API co aplikacja na Maca i strona `/crm/inquiries`
 * (`/bridge/native/v1/inquiries`, token sesji pracownika, RLS jak w CRM). Lista: `op=state` (skrót i koszyki) + `op=items`
 * (zapytania z koszyków); bez zmian na serwerze — ostatnia lista z pamięci. Czynności: etap, przejęcie, kontakt wykonany,
 * odłożenie, edycja (opiekun, etap, termin, wartość), usunięcie lub archiwizacja. Karta zapytania — `lib/inquiryWorkspace.ts`.
 */

const CRM_URL = (process.env.EXPO_PUBLIC_CRM_URL || 'https://mavinci.pl').replace(/\/+$/, '');
const ENDPOINT = `${CRM_URL}/bridge/native/v1/inquiries`;

async function headers(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Zaloguj się ponownie.');
  return { Authorization: `Bearer ${session.access_token}`, 'x-mavinci-client': 'phone', Accept: 'application/json' };
}

export async function inquiriesGet<T>(op: string, params: Record<string, string | null | undefined> = {}): Promise<T> {
  const query = Object.entries({ op, ...params })
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
  const response = await fetch(`${ENDPOINT}?${query}`, { headers: await headers() });
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok) throw new Error(body?.error || `Operacja nie powiodła się (HTTP ${response.status}).`);
  return body as T;
}

export async function inquiriesPost<T>(op: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { ...(await headers()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, op }),
  });
  const reply = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok) throw new Error(reply?.error || `Operacja nie powiodła się (HTTP ${response.status}).`);
  return reply as T;
}

type StateReply = { hash: string; width: number; buckets?: Record<string, string>; access?: InquiryAccess };
type ItemsReply = { buckets: Record<string, { hash: string; items: FunnelInquiry[] }>; more: string[] };

/** Ostatnia lista zalogowanego pracownika (po zmianie konta — pobierana od nowa). */
let cache: { user: string; hash: string; items: FunnelInquiry[]; access: InquiryAccess | null } | null = null;

/** Zapytania z lejka i uprawnienia (zakresy, przejmowanie, zarządzanie). `force` — pełne pobranie mimo zgodnego skrótu. */
export async function loadFunnel(force = false): Promise<{ items: FunnelInquiry[]; access: InquiryAccess | null }> {
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user?.id || '';
  const known = cache && cache.user === user && !force ? cache : null;
  let state = await inquiriesGet<StateReply>('state', { hash: known?.hash || '' });
  if (known && state.hash === known.hash) {
    cache = { ...known, access: state.access ?? known.access };
    return { items: known.items, access: cache.access };
  }
  // Skrót się zmienił, ale serwer nie wysłał koszyków (odpowiedź dla zgodnego skrótu) — pełny stan.
  if (!state.buckets) state = await inquiriesGet<StateReply>('state');
  const items: FunnelInquiry[] = [];
  let pending = Object.keys(state.buckets || {});
  for (let round = 0; pending.length && round < 100; round += 1) {
    const reply = await inquiriesPost<ItemsReply>('items', { buckets: pending });
    Object.values(reply.buckets || {}).forEach((bucket) => items.push(...(bucket.items || [])));
    // `more` — koszyki, które nie zmieściły się w odpowiedzi; bez postępu (pusta odpowiedź) — koniec, bez pętli.
    if (!Object.keys(reply.buckets || {}).length) break;
    pending = Array.isArray(reply.more) ? reply.more : [];
  }
  const unique = Array.from(new Map(items.map((item) => [item.id, item])).values())
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  cache = { user, hash: state.hash, items: unique, access: state.access ?? null };
  return { items: unique, access: cache.access };
}

/** Zmiana zapytania — następne odświeżenie pobiera listę od nowa (bez czekania na skrót). */
export const forgetFunnel = () => { if (cache) cache = { ...cache, hash: '' }; };

const act = async <T = Record<string, unknown>>(op: string, id: string, extra: Record<string, unknown> = {}) => {
  const reply = await inquiriesPost<T>(op, { id, ...extra });
  forgetFunnel();
  return reply;
};

/** Przeniesienie do etapu (bez „Przegrane” — tam powód utraty w edycji); serwer ustawia domyślną szansę etapu. */
export const moveInquiry = (id: string, stage: InquiryStageId) => act<{ probability: number }>('move', id, { stage });
export type InquiryUpdate = {
  title: string;
  stage: InquiryStageId;
  nextActionAt: string | null;
  lastContactAt: string | null;
  estimatedValue: number | null;
  probability: number;
  lostReason: string;
  lostReasonCategory: string;
  ownerId?: string | null;
};
export const updateInquiry = (id: string, data: InquiryUpdate) => act('update', id, { data });
export const claimInquiry = (id: string) => act('claim', id);
/** „Kontakt wykonany” z opcjonalnym terminem kolejnego działania (`complete_inquiry_followup`). */
export const contactInquiry = (id: string, nextActionAt: string | null) => act('contact', id, { nextActionAt });
export const snoozeInquiry = (id: string, minutes = 60) => act('snooze', id, { minutes });
/** Bez trybu — baza sprawdza powiązania: `deleted` (usunięcie) albo `archived` (archiwizacja z powodem). */
export const inquiryRemovalMode = (id: string) => inquiriesPost<{ mode: 'deleted' | 'archived' }>('remove', { id });
export const removeInquiry = (id: string, mode: 'deleted' | 'archived', reason: string) => act<{ mode: string }>('remove', id, { mode, reason });
/** Lista „Osoba odpowiedzialna” jak w CRM: wszyscy (zarządzanie wszystkimi), zespół albo tylko Ty. */
export const inquiryEmployees = () => inquiriesGet<{ employees: Array<{ id: string; name: string }> }>('employees');
export const inquiryCrmUrl = (id: string) => `${CRM_URL}/crm/inquiries/${id}`;
/** Adres w CRM (np. oferta `/crm/offers/…`) do otwarcia w przeglądarce. */
export const crmUrl = (path: string) => `${CRM_URL}${path.startsWith('/') ? path : `/${path}`}`;

/** POST na serwer CRM (np. `/bridge/events/calculation-pdf` — PDF kalkulacji generowany na serwerze), token sesji pracownika. */
export async function crmPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(crmUrl(path), {
    method: 'POST',
    headers: { ...(await headers()), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const reply = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok) throw new Error(reply?.error || `Operacja nie powiodła się (HTTP ${response.status}).`);
  return reply as T;
}

/** Podpisany adres zapisanego PDF oferty (`/bridge/native/v1/offers?op=pdf`, ważny godzinę) — uprawnienia ofert jak w CRM. */
export async function offerPdfLink(offerId: string, language: 'pl' | 'en' = 'pl'): Promise<{ url: string; name: string }> {
  const response = await fetch(`${CRM_URL}/bridge/native/v1/offers?op=pdf&id=${encodeURIComponent(offerId)}&language=${language}`, { headers: await headers() });
  const body = (await response.json().catch(() => null)) as { url?: string; name?: string; error?: string } | null;
  if (!response.ok || !body?.url) throw new Error(body?.error || `Nie udało się pobrać PDF (HTTP ${response.status}).`);
  return { url: body.url, name: body.name || 'Oferta.pdf' };
}
