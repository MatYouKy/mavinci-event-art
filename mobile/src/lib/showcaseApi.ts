import { supabase } from './supabase';
import type {
  ShowcaseBrand, ShowcaseConfigEdit, ShowcaseHome, ShowcaseItemDetail, ShowcaseOfferApproval, ShowcaseOfferClientContext, ShowcaseOfferClientHit,
  ShowcaseOfferConfiguration, ShowcaseOfferDraft,
  ShowcaseOfferEmailSetup, ShowcaseOfferLocation, ShowcaseOfferPreview, ShowcaseOfferResult, ShowcaseOfferSetup, ShowcaseOfferStatus,
  ShowcaseProductView, ShowcaseUrls,
} from './showcaseShared';

/*
 * Strefa sprzedawcy → „Prezentacje” w aplikacji — to samo API co CRM i Mac (`/bridge/native/v1/showcase`, token sesji
 * pracownika, `x-mavinci-client: phone`). Zakres (działy i karty widoczne na spotkaniach, ukryte — tylko przy przygotowaniu)
 * sprawdza serwer i baza (RLS). Oferta ze spotkania (`offer*`) — to samo co pokaz w CRM i na Macu: wycena, klient i zapytanie,
 * oferta z PDF (`/bridge/offers/generate-pdf`), akceptacja rabatu, wysyłka e-mailem.
 */

const CRM_URL = (process.env.EXPO_PUBLIC_CRM_URL || 'https://mavinci.pl').replace(/\/+$/, '');
const ENDPOINT = `${CRM_URL}/bridge/native/v1/showcase`;

/** Marka z ostatniego odczytu listy (kolory i logo karty bez ponownego pobierania). */
let lastBrand: ShowcaseBrand | null = null;
export const showcaseBrand = () => lastBrand;
/** Ostatnia lista działów i kart — kolejność kart działu do przesuwania palcem w karcie. */
let lastHome: ShowcaseHome | null = null;

/** Karta działu do przeglądania w bok (kolejność jak na liście). */
export type ShowcasePage = { id: string; title: string; sectionTitle: string; thumb: string | null };

/** Karty działu, do którego należy `id` (jak na liście); bez listy w pamięci — sama karta. */
export function showcaseSiblings(id: string, title = ''): ShowcasePage[] {
  const home = lastHome;
  const item = home?.items.find((entry) => entry.id === id);
  if (!home || !item) return [{ id, title, sectionTitle: '', thumb: null }];
  const sectionTitle = home.sections.find((section) => section.id === item.sectionId)?.title || '';
  return home.items
    .filter((entry) => entry.sectionId === item.sectionId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, 'pl'))
    .map((entry) => ({ id: entry.id, title: entry.title, sectionTitle, thumb: entry.thumbKey ? home.urls[entry.thumbKey]?.thumb || null : null }));
}

async function headers(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Zaloguj się ponownie.');
  return { Authorization: `Bearer ${session.access_token}`, 'x-mavinci-client': 'phone', Accept: 'application/json' };
}

async function get<T>(op: string, params: Record<string, string | null | undefined> = {}): Promise<T> {
  const query = Object.entries({ op, ...params })
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
  const response = await fetch(`${ENDPOINT}?${query}`, { headers: await headers() });
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok) throw new Error(body?.error || `Operacja nie powiodła się (HTTP ${response.status}).`);
  return body as T;
}

/** Błąd „Utwórz ofertę” po zapisaniu zapytania i klienta — ponowna próba dopina ofertę do nich. */
export type ShowcaseOfferFailure = Error & { inquiryId?: string; organizationId?: string; contactId?: string };

async function post<T>(op: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(ENDPOINT, {
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

export async function showcaseHome(): Promise<ShowcaseHome> {
  const home = await get<ShowcaseHome>('home');
  lastBrand = home.brand;
  lastHome = home;
  return home;
}

export const showcaseItem = (id: string) => get<ShowcaseItemDetail>('item', { id });

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
