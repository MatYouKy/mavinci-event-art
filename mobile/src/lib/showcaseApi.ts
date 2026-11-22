import { supabase } from './supabase';
import {
  localizeShowcaseUrls, offlineShowcaseHome, offlineShowcaseItem, openShowcaseOffline, saveOfflineShowcaseItem, syncShowcaseOffline,
  updateOfflineShowcaseHome,
} from './showcaseOffline';
import {
  showcaseLayoutOf, showcaseVisibleForMe,
  type ShowcaseBrand, type ShowcaseConfigEdit, type ShowcaseHome, type ShowcaseItemDetail, type ShowcaseOfferApproval, type ShowcaseOfferClientContext,
  type ShowcaseOfferClientHit, type ShowcaseOfferConfiguration, type ShowcaseOfferDiscountDisplay, type ShowcaseOfferDraft,
  type ShowcaseOfferEmailSetup, type ShowcaseOfferLocation, type ShowcaseOfferPreview, type ShowcaseOfferResult, type ShowcaseOfferSetup, type ShowcaseOfferStatus,
  type ShowcaseProductView, type ShowcaseUrls,
} from './showcaseShared';

/*
 * Strefa sprzedawcy → „Prezentacje” w aplikacji — to samo API co CRM i Mac (`/bridge/native/v1/showcase`, token sesji
 * pracownika, `x-mavinci-client: phone`). Zakres (działy i karty widoczne na spotkaniach, ukryte — tylko przy przygotowaniu)
 * sprawdza serwer i baza (RLS). Oferta ze spotkania (`offer*`) — to samo co pokaz w CRM i na Macu: wycena, klient i zapytanie,
 * oferta z PDF (`/bridge/offers/generate-pdf`), akceptacja rabatu, wysyłka e-mailem.
 * Lista i karty zapisują się w pamięci urządzenia (`showcaseOffline`): karta otwiera się od razu z dysku, bez internetu działa
 * cały pokaz. Układ (kolejność działów i kart, ukryte) jest własny dla pracownika — `saveLayout` / `resetLayout`, jak w CRM.
 */

const CRM_URL = (process.env.EXPO_PUBLIC_CRM_URL || 'https://mavinci.pl').replace(/\/+$/, '');
const ENDPOINT = `${CRM_URL}/bridge/native/v1/showcase`;

/** Marka z ostatniego odczytu listy (kolory i logo karty bez ponownego pobierania). */
let lastBrand: ShowcaseBrand | null = null;
export const showcaseBrand = () => lastBrand;
/** Ostatnia lista działów i kart (w układzie pracownika) — kolejność kart działu do przesuwania palcem w karcie. */
let lastHome: ShowcaseHome | null = null;

/** Karta działu do przeglądania w bok (kolejność jak na liście). */
export type ShowcasePage = { id: string; title: string; sectionTitle: string; thumb: string | null };

/** Karty działu, do którego należy `id` (jak na liście, bez ukrytych w układzie pracownika); bez listy w pamięci — sama karta. */
export function showcaseSiblings(id: string, title = ''): ShowcasePage[] {
  const home = lastHome;
  const item = home?.items.find((entry) => entry.id === id);
  if (!home || !item) return [{ id, title, sectionTitle: '', thumb: null }];
  const sectionTitle = home.sections.find((section) => section.id === item.sectionId)?.title || '';
  const urls = localizeShowcaseUrls(home.urls);
  const visible = new Set(showcaseVisibleForMe(home).items.map((entry) => entry.id));
  return home.items
    .filter((entry) => entry.sectionId === item.sectionId && (visible.has(entry.id) || entry.id === id))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, 'pl'))
    .map((entry) => ({ id: entry.id, title: entry.title, sectionTitle, thumb: entry.thumbKey ? urls[entry.thumbKey]?.thumb || null : null }));
}

/** Brak połączenia z serwerem (a nie błąd serwera) — wtedy prezentacje z pamięci urządzenia. */
const OFFLINE_MESSAGE = 'Brak połączenia z internetem.';
const offlineError = () => Object.assign(new Error(OFFLINE_MESSAGE), { offline: true });
export const isShowcaseOffline = (cause: unknown) => (cause as { offline?: unknown } | null)?.offline === true;

async function headers(): Promise<Record<string, string>> {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (!session) {
    // Sesja wygasła, a odświeżenie nie doszło do serwera (brak internetu) — to brak połączenia, nie wylogowanie.
    if ((error as { name?: string } | null)?.name === 'AuthRetryableFetchError') throw offlineError();
    throw new Error('Zaloguj się ponownie.');
  }
  return { Authorization: `Bearer ${session.access_token}`, 'x-mavinci-client': 'phone', Accept: 'application/json' };
}

/** Zapytanie do serwera; brak połączenia — błąd z `offline` (pokaz z pamięci urządzenia). */
async function request(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    throw offlineError();
  }
}

async function get<T>(op: string, params: Record<string, string | null | undefined> = {}): Promise<T> {
  const query = Object.entries({ op, ...params })
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
  const response = await request(`${ENDPOINT}?${query}`, { headers: await headers() });
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok) throw new Error(body?.error || `Operacja nie powiodła się (HTTP ${response.status}).`);
  return body as T;
}

/** Błąd „Utwórz ofertę” po zapisaniu zapytania i klienta — ponowna próba dopina ofertę do nich. */
export type ShowcaseOfferFailure = Error & { inquiryId?: string; organizationId?: string; contactId?: string };

async function post<T>(op: string, body: Record<string, unknown>): Promise<T> {
  const response = await request(ENDPOINT, {
    method: 'POST',
    headers: { ...(await headers()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, op }),
  });
  const reply = (await response.json().catch(() => null)) as (T & { error?: string; inquiryId?: unknown; organizationId?: unknown; contactId?: unknown }) | null;
  if (!response.ok) {
    const failure: ShowcaseOfferFailure = new Error(reply?.error || `Operacja nie powiodła się (HTTP ${response.status}).`);
    if (typeof reply?.inquiryId === 'string') failure.inquiryId = reply.inquiryId;
    if (typeof reply?.organizationId === 'string') failure.organizationId = reply.organizationId;
    if (typeof reply?.contactId === 'string') failure.contactId = reply.contactId;
    throw failure;
  }
  return reply as T;
}

const remember = (home: ShowcaseHome) => {
  lastBrand = home.brand;
  lastHome = home;
};

const fetchItem = (id: string) => get<ShowcaseItemDetail>('item', { id });

/**
 * Lista działów i kart w układzie pracownika. Z internetem — z serwera, zapis w pamięci urządzenia i pobieranie kart oraz zdjęć
 * w tle (`offline: false`); bez internetu — lista z pamięci (`offline: true`). `user` — zalogowany pracownik (auth).
 */
export async function showcaseHome(user: string | null): Promise<{ home: ShowcaseHome; offline: boolean }> {
  await openShowcaseOffline(user);
  try {
    const home = await get<ShowcaseHome>('home');
    remember(home);
    if (user) void syncShowcaseOffline(user, home, fetchItem);
    return { home: { ...home, urls: localizeShowcaseUrls(home.urls) }, offline: false };
  } catch (cause) {
    if (!isShowcaseOffline(cause)) throw cause;
    const saved = await offlineShowcaseHome(user).catch(() => null);
    if (!saved) throw new Error('Brak internetu, a prezentacje nie są jeszcze zapisane w pamięci urządzenia. Otwórz je raz z internetem.');
    remember(saved);
    return { home: saved, offline: true };
  }
}

/** Karta zapisana w pamięci urządzenia (od razu, bez czekania na internet); `null` — jeszcze niezapisana. */
export const showcaseSavedItem = (id: string, user: string | null) => offlineShowcaseItem(user, id).catch(() => null);

/** Karta z serwera (zdjęcia już zapisane — z dysku); od razu trafia do pamięci urządzenia. */
export async function showcaseItem(id: string, user: string | null): Promise<ShowcaseItemDetail> {
  const detail = await fetchItem(id);
  if (user) await saveOfflineShowcaseItem(user, detail).catch(() => undefined);
  return { ...detail, urls: localizeShowcaseUrls(detail.urls) };
}

// Własny układ pracownika ------------------------------------------------------------------------------------------------

/** Kolejność i ukryte z `next` w zapisanej liście (adresy zdjęć zostają z zapisu). */
function arranged(saved: ShowcaseHome, next: ShowcaseHome): ShowcaseHome {
  const sections = new Map(next.sections.map((section) => [section.id, section]));
  const items = new Map(next.items.map((item) => [item.id, item]));
  return {
    ...saved,
    layout: showcaseLayoutOf(next),
    sections: saved.sections.map((section) => {
      const change = sections.get(section.id);
      return change ? { ...section, sortOrder: change.sortOrder, hiddenForMe: change.hiddenForMe === true } : section;
    }),
    items: saved.items.map((item) => {
      const change = items.get(item.id);
      return change ? { ...item, sortOrder: change.sortOrder, hiddenForMe: change.hiddenForMe === true } : item;
    }),
  };
}

/** Lista po zmianie układu: świeża z serwera do pamięci urządzenia (karty pokazane z powrotem pobierają się, ukryte znikają). */
function refreshSaved(user: string | null) {
  void get<ShowcaseHome>('home')
    .then((home) => {
      remember(home);
      if (user) void syncShowcaseOffline(user, home, fetchItem);
    })
    .catch(() => undefined);
}

/** Zapis własnego układu (kolejność działów i kart, ukryte u pracownika) — ten sam w CRM, na Macu, telefonie i iPadzie. */
export async function saveShowcaseLayout(next: ShowcaseHome, user: string | null): Promise<void> {
  await post<{ ok: boolean }>('saveLayout', { layout: showcaseLayoutOf(next) });
  if (lastHome) lastHome = arranged(lastHome, next);
  if (user) await updateOfflineShowcaseHome(user, (saved) => arranged(saved, next)).catch(() => undefined);
  refreshSaved(user);
}

/** „Układ domyślny” — kolejność z przygotowania, nic nie jest ukryte; zwraca listę od nowa. */
export async function resetShowcaseLayout(user: string | null): Promise<{ home: ShowcaseHome; offline: boolean }> {
  await post<{ ok: boolean }>('resetLayout', {});
  return showcaseHome(user);
}

// Oferta ze spotkania ----------------------------------------------------------------------------------------------------

export const showcaseOfferSetup = () => get<ShowcaseOfferSetup>('offerSetup');
export const showcaseOfferClients = (q: string) => get<{ clients: ShowcaseOfferClientHit[] }>('offerClients', { q });
/** Podpowiedzi miejsca z bazy lokalizacji CRM („Nazwa, miasto”); bez trafienia — miejsce wpisane ręcznie. */
export const showcaseOfferLocations = (q: string) => get<{ locations: ShowcaseOfferLocation[] }>('offerLocations', { q: q.trim() });
/** Produkty katalogu do „Dodaj pozycję” (aktywne, z miniaturą). */
export type ShowcaseProductOption = { id: string; name: string; category: string; priceNet: number | null; unit: string; thumbnailUrl: string | null };
export const showcaseProducts = (q: string) => get<{ products: ShowcaseProductOption[] }>('products', { q: q.trim() });
/** Produkt katalogu na bieżąco (warianty, pakiety, zdjęcia) — wybór wariantu albo pakietu do oferty. */
export const showcaseOfferProduct = (id: string) => get<{ product: ShowcaseProductView; urls: ShowcaseUrls }>('offerProduct', { id });
export const showcaseOfferClient = (target: { organization?: string | null; contact?: string | null }) =>
  get<ShowcaseOfferClientContext>('offerClient', target.organization ? { organization: target.organization } : { contact: target.contact || '' });
export const showcaseOfferPreview = (draft: ShowcaseOfferDraft) => post<ShowcaseOfferPreview>('offerPreview', { draft });
/** Konfigurator sceny i ekranu LED w ofercie ze spotkania: nowa konfiguracja (`productId`) albo zmiany zapisanej (`snapshot`). */
export const showcaseOfferConfigure = (body: { productId?: string; snapshot?: Record<string, unknown>; edits?: ShowcaseConfigEdit[]; refresh?: boolean; quantity?: number }) =>
  post<ShowcaseOfferConfiguration>('offerConfigure', body);
export const showcaseOfferCreate = (draft: ShowcaseOfferDraft) => post<ShowcaseOfferResult>('offerCreate', { draft });
export const showcaseOfferStatus = (id: string) => get<ShowcaseOfferStatus>('offerStatus', { id });
export const showcaseOfferApproval = (id: string, note: string) => post<ShowcaseOfferApproval>('offerApproval', { id, note });
/** Zapamiętany sposób pokazania rabatu klientowi w PDF — ten sam w CRM, na Macu i w aplikacji. */
export const showcaseOfferDiscountDisplay = (discountDisplay: ShowcaseOfferDiscountDisplay) =>
  post<{ discountDisplay: ShowcaseOfferDiscountDisplay }>('offerDiscountDisplay', { discountDisplay });
export const showcaseOfferPdf = (id: string) => get<{ url: string; name: string }>('offerPdf', { id });
export const showcaseOfferEmail = (id: string) => get<ShowcaseOfferEmailSetup>('offerEmail', { id });
export const showcaseOfferEmailSend = (body: { id: string; to: string; subject: string; text: string; accountId: string; recipientName: string }) =>
  post<{ sent: boolean; warning: string | null }>('offerEmailSend', body);

/** PDF oferty jak „Generuj PDF” w CRM (`/bridge/offers/generate-pdf`, odpowiedź JSON po zapisaniu pliku — do kilku minut). */
export async function showcaseOfferGeneratePdf(offerId: string): Promise<{ pageCount: number }> {
  const response = await fetch(`${CRM_URL}/bridge/offers/generate-pdf`, {
    method: 'POST',
    headers: { ...(await headers()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ offerId, language: 'pl' }),
  });
  const result = (await response.json().catch(() => null)) as { success?: boolean; pageCount?: number; error?: string; message?: string; code?: string } | null;
  if (!response.ok || !result?.success) {
    const limit = response.status === 546 || result?.code === 'WORKER_RESOURCE_LIMIT' || result?.code === 'WORKER_LIMIT';
    throw new Error(limit ? 'Generator PDF chwilowo przekroczył limit zasobów. Spróbuj ponownie za chwilę.'
      : result?.error || result?.message || `Nie udało się wygenerować PDF (HTTP ${response.status}).`);
  }
  return { pageCount: Number(result.pageCount) || 0 };
}
