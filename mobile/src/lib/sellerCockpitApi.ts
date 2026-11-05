import { supabase } from './supabase';
import { type SellerCockpit, type SellerCockpitReview, parseSellerCockpit } from './sellerCockpit';

/*
 * Kokpit opiekuna sprzedawców zewnętrznych w aplikacji — to samo RPC co CRM: get_my_seller_cockpit
 * (migracja 20261105150000_seller_manager_cockpit.sql). Zakres liczy baza: pracownik dostaje wyłącznie swoich
 * sprzedawców (opiekun lub zastępca), administrator — wszystkich. Aplikacja tylko wyświetla wynik (wspólna kopia
 * sellerCockpit.ts). Decyzje — sprawdzenie oferty, potwierdzenie wydarzenia, odpowiedź na zapytanie, zmiana
 * opiekuna, widoczność prowizji — zostają w CRM; aplikacja otwiera je w przeglądarce (openInCrmWeb).
 */

type RpcError = { code?: string; message?: string } | null | undefined;

export type SellerCockpitResult =
  | { status: 'ready'; data: SellerCockpit }
  /** RPC jeszcze niewdrożone (starsza baza) — wejście ukryte. */
  | { status: 'missing' }
  /** Brak konta pracownika / dostępu (42501) — wejście ukryte. */
  | { status: 'denied'; message: string }
  | { status: 'error'; message: string };

/** Komunikat, gdy RPC nie jest jeszcze wdrożone (pokazywany tylko przy jawnym otwarciu ekranu). */
export const SELLER_COCKPIT_DATABASE_UPDATE_MESSAGE = 'Wymaga aktualizacji bazy';

const isRpcMissing = (error: RpcError) => ['PGRST202', '42883'].includes(error?.code ?? '');

function cockpitErrorMessage(error: unknown, fallback: string): string {
  const message =
    error && typeof error === 'object' && 'message' in error ? String((error as { message?: unknown }).message ?? '') : '';
  if (/Failed to fetch|Network request failed|fetch failed/i.test(message)) return 'Brak połączenia. Spróbuj ponownie za chwilę.';
  return message || fallback;
}

/** Kokpit zalogowanego pracownika (bez filtra opiekuna — u administratora wszyscy sprzedawcy). */
export async function fetchSellerCockpit(): Promise<SellerCockpitResult> {
  const fallback = 'Nie udało się pobrać danych sprzedawców.';
  try {
    const { data, error } = await supabase.rpc('get_my_seller_cockpit');
    if (error) {
      if (isRpcMissing(error)) return { status: 'missing' };
      if (error.code === '42501') return { status: 'denied', message: cockpitErrorMessage(error, fallback) };
      console.warn('Error loading seller cockpit:', error);
      return { status: 'error', message: cockpitErrorMessage(error, fallback) };
    }
    return { status: 'ready', data: parseSellerCockpit(data) };
  } catch (error) {
    console.warn('Error loading seller cockpit:', error);
    return { status: 'error', message: cockpitErrorMessage(error, fallback) };
  }
}

/** Wejście „Moi sprzedawcy”: administrator albo opiekun co najmniej jednego sprzedawcy. */
export function canOpenSellerCockpit(cockpit: SellerCockpit | null | undefined): boolean {
  return Boolean(cockpit && (cockpit.viewer.is_admin || cockpit.sellers.length > 0));
}

/*
 * Adresy CRM dla spraw z kokpitu — te same miejsca, w których CRM podejmuje decyzję
 * (sprawdzenie oferty jak w get_seller_inbox, potwierdzenie wydarzenia na stronie wydarzenia,
 * kroki realizacji w „Ustaleniach ze sprzedawcą”, sprawy sprzedawcy w jego karcie).
 */
export const sellerCockpitCrmPath = {
  review: (item: Pick<SellerCockpitReview, 'offer_id' | 'document_id'>) =>
    `/crm/offers/${item.offer_id}${item.document_id ? `?document=${item.document_id}&preview=1` : ''}#seller-offer-review`,
  offer: (offerId: string) => `/crm/offers/${offerId}`,
  event: (eventId: string) => `/crm/events/${eventId}`,
  eventArrangements: (eventId: string) => `/crm/events/${eventId}?tab=seller-arrangements`,
  seller: (sellerId: string) => `/crm/salespeople?seller=${sellerId}`,
  // Kokpit opiekuna (zakładka domyślna) przewija do zapytania i je wyróżnia — ten sam link co w get_my_sales_day.
  inquiry: (_sellerId: string, inquiryId: string) => `/crm/salespeople?inquiry=${inquiryId}`,
};
