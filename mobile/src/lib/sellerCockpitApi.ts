import { supabase } from './supabase';
import { type SellerCockpit, type SellerCockpitReview, parseSellerCockpit, parseSellerPriceRequests } from './sellerCockpit';
import { type SellerJourney, type SellerWorkspaceOfferFacts, sellerJourney, sellerWorkspaceJourneyInput } from './offerJourney';
import {
  SELLER_READINESS_MIGRATION,
  type SellerReadinessFacts,
  type SellerReadinessStep,
  sellerReadinessSteps,
  sellerReadinessSummary,
} from './sellerReadiness';
import type { SellerConversation } from './sellerChat';

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
    const cockpit = parseSellerCockpit(data);
    // Prośby o zgodę na cenę (migracja 20261114230000) — bez migracji grupa zostaje pusta.
    const prices = await supabase.rpc('get_my_seller_price_requests');
    cockpit.today.price_requests = prices.error ? [] : parseSellerPriceRequests(prices.data);
    return { status: 'ready', data: cockpit };
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
  priceApproval: (offerId: string) => `/crm/offers/${offerId}#seller-price-approval`,
  event: (eventId: string) => `/crm/events/${eventId}`,
  eventArrangements: (eventId: string) => `/crm/events/${eventId}?tab=seller-arrangements`,
  seller: (sellerId: string) => `/crm/salespeople?seller=${sellerId}`,
  /** Karta sprzedawcy w CRM (sekcja: settings, branding, chat, settlements) — jak sellerCardHref w CRM i na Macu. */
  sellerCard: (seller: { id: string; contact_id?: string | null }, section?: string) => {
    const base = seller.contact_id ? `/crm/contacts/${seller.contact_id}?tab=seller` : `/crm/salespeople?seller=${seller.id}`;
    return section ? `${base}&section=${section}` : base;
  },
  // Kokpit opiekuna (zakładka domyślna) przewija do zapytania i je wyróżnia — ten sam link co w get_my_sales_day.
  inquiry: (_sellerId: string, inquiryId: string) => `/crm/salespeople?inquiry=${inquiryId}`,
};

/*
 * Karta sprzedawcy w aplikacji — te same funkcje bazy co karta w CRM i na Macu (src/lib/native/sellers.ts):
 * get_crm_seller_readiness („Gotowość do pracy”, kroki z wspólnej kopii sellerReadiness.ts), get_crm_seller_workspace
 * (oferty na osi w 5 etapach — wspólna kopia offerJourney.ts, widok opiekuna) i list_seller_conversations (rozmowy).
 * Dostęp rozstrzyga baza (opiekun, zastępca, administrator).
 */

type WorkspaceOffer = SellerWorkspaceOfferFacts & {
  id: string;
  title: string | null;
  offer_number: string | null;
  brand_name: string | null;
  client_name: string | null;
  event_date: string | null;
  client_total_net: number | null;
  created_at: string | null;
};

export type SellerDetailEvent = { id: string; name: string; event_date: string | null; status: string; brand_name: string | null };

export type SellerDetailOffer = {
  id: string;
  title: string;
  number: string | null;
  client: string | null;
  brand: string | null;
  net: number | null;
  eventDate: string | null;
  eventId: string | null;
  journey: SellerJourney;
};

export type SellerDetail = {
  readiness: { steps: SellerReadinessStep[]; summary: ReturnType<typeof sellerReadinessSummary> } | null;
  readinessError: string | null;
  manager: { name: string | null; backupName: string | null; ok: boolean };
  portal: { account: string; lastSignInAt: string | null };
  canViewOffers: boolean;
  offers: SellerDetailOffer[];
  events: SellerDetailEvent[];
  conversations: SellerConversation[];
};

export type SellerDetailResult =
  | { status: 'ready'; data: SellerDetail }
  | { status: 'denied'; message: string }
  | { status: 'error'; message: string };

export async function fetchSellerDetail(partnerId: string): Promise<SellerDetailResult> {
  const fallback = 'Nie udało się pobrać karty sprzedawcy.';
  try {
    const [readiness, workspace, conversations] = await Promise.all([
      supabase.rpc('get_crm_seller_readiness', { p_partner: partnerId }),
      supabase.rpc('get_crm_seller_workspace', { p_partner: partnerId }),
      supabase.rpc('list_seller_conversations', { p_partner: partnerId }),
    ]);
    if (workspace.error) {
      if (workspace.error.code === '42501') return { status: 'denied', message: workspace.error.message || 'Brak dostępu do tego sprzedawcy.' };
      return { status: 'error', message: cockpitErrorMessage(workspace.error, fallback) };
    }
    const data = (workspace.data || {}) as {
      offers?: WorkspaceOffer[];
      events?: SellerDetailEvent[];
      can_view_offers?: boolean;
      manager?: { manager_name?: string | null; backup_manager_name?: string | null; manager_ok?: boolean } | null;
      portal?: { portal_account?: string; last_sign_in_at?: string | null } | null;
    };
    const offers = Array.isArray(data.offers) ? data.offers : [];
    const events = Array.isArray(data.events) ? data.events : [];
    const eventStatus = new Map(events.map((event) => [event.id, event.status]));
    // Zgoda na cenę — offers.partner_approval_status (jak karta sprzedawcy na Macu).
    const approval = new Map<string, string>();
    if (offers.length && data.can_view_offers) {
      const ids = offers.map((offer) => offer.id);
      for (let index = 0; index < ids.length; index += 100) {
        const { data: rows } = await supabase.from('offers').select('id,partner_approval_status').in('id', ids.slice(index, index + 100));
        for (const row of (rows || []) as { id: string; partner_approval_status: string | null }[]) {
          approval.set(row.id, row.partner_approval_status || 'not_required');
        }
      }
    }
    const managerName = data.manager?.manager_name || null;
    let readinessBlock: SellerDetail['readiness'] = null;
    let readinessError: string | null = null;
    if (readiness.error) {
      readinessError = isRpcMissing(readiness.error)
        ? `„Gotowość do pracy” wymaga aktualizacji bazy (${SELLER_READINESS_MIGRATION}).`
        : cockpitErrorMessage(readiness.error, 'Nie udało się sprawdzić gotowości sprzedawcy.');
    } else if (readiness.data) {
      const steps = sellerReadinessSteps(readiness.data as SellerReadinessFacts);
      readinessBlock = { steps, summary: sellerReadinessSummary(steps) };
    }
    return {
      status: 'ready',
      data: {
        readiness: readinessBlock,
        readinessError,
        manager: { name: managerName, backupName: data.manager?.backup_manager_name || null, ok: data.manager?.manager_ok === true },
        portal: { account: data.portal?.portal_account || 'none', lastSignInAt: data.portal?.last_sign_in_at || null },
        canViewOffers: data.can_view_offers === true,
        offers: offers.map((offer) => ({
          id: offer.id,
          title: offer.title || 'Oferta bez tytułu',
          number: offer.offer_number,
          client: offer.client_name,
          brand: offer.brand_name,
          net: offer.client_total_net == null ? null : Number(offer.client_total_net),
          eventDate: offer.event_date,
          eventId: offer.event_id,
          journey: sellerJourney(sellerWorkspaceJourneyInput(offer, {
            priceApprovalRequired: approval.get(offer.id) === 'required',
            eventStatus: offer.event_id ? eventStatus.get(offer.event_id) || null : null,
          }), { viewer: 'manager', managerName }),
        })),
        events,
        // Rozmowy są dodatkiem — bez dostępu (42501) albo przy błędzie karta działa dalej.
        conversations: conversations.error || !Array.isArray(conversations.data) ? [] : (conversations.data as SellerConversation[]),
      },
    };
  } catch (error) {
    console.warn('Error loading seller detail:', error);
    return { status: 'error', message: cockpitErrorMessage(error, fallback) };
  }
}

/**
 * Ponowne zaproszenie do portalu — ta sama trasa co „Wyślij zaproszenie ponownie” w CRM i na Macu
 * (`/bridge/seller/invite`, token sesji pracownika; uprawnienia i warunki sprawdza serwer).
 */
export async function resendSellerInvite(crmUrl: string, partnerId: string): Promise<{ email: string; emailSent: boolean }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Zaloguj się ponownie.');
  let response: Response;
  try {
    response = await fetch(`${crmUrl}/bridge/seller/invite`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ salesPartnerId: partnerId, forceEmail: true }),
    });
  } catch {
    throw new Error('Brak połączenia. Spróbuj ponownie za chwilę.');
  }
  const result = (await response.json().catch(() => null)) as { error?: string; email?: string; emailSent?: boolean } | null;
  if (!response.ok) throw new Error(result?.error || `Nie udało się wysłać zaproszenia (HTTP ${response.status}).`);
  return { email: String(result?.email || ''), emailSent: result?.emailSent === true };
}
