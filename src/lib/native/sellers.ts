import 'server-only';
import type { NativeContext } from './auth';
import {
  SELLER_EVENT_TYPE_LABELS,
  SELLER_INQUIRY_STATUS_LABELS,
  SELLER_PORTAL_ACCOUNT_LABELS,
  SELLER_REALIZATION_STEP_LABELS,
  SELLER_WARNING_LABELS,
  formatPriceItems,
  formatWaitingHours,
  parseSellerCockpit,
  parseSellerPriceRequests,
  sellerCockpitJourneyStages,
  sellerCockpitTodayCount,
  type SellerCockpit,
  type SellerCockpitSeller,
} from '@/lib/seller/sellerCockpit';
import { SELLER_JOURNEY_ACTOR_LABELS, SELLER_JOURNEY_STAGES, sellerJourney, sellerWorkspaceJourneyInput, type SellerWorkspaceOfferFacts } from '@/lib/seller/offerJourney';
import { SELLER_READINESS_MIGRATION, sellerReadinessSteps, sellerReadinessSummary, type SellerReadinessFacts } from '@/lib/seller/readiness';
import { MANAGER_HELP } from '@/lib/help/managerHelp';

/**
 * Sprzedawcy zewnętrzni w aplikacji na Maca (`/bridge/native/v1/sellers`) — te same funkcje bazy co CRM „Sprzedawcy”
 * (kokpit opiekuna, „Gotowość do pracy”, sprzedaż sprzedawcy) i te same teksty: oś w 5 etapach (`offerJourney.ts`),
 * kroki gotowości (`readiness.ts`), instrukcja opiekuna (`src/lib/help/managerHelp.ts`). Aplikacja tylko wyświetla.
 * Tokenem pracownika — dostęp rozstrzyga baza jak w przeglądarce.
 */

type Tone = 'neutral' | 'warning' | 'danger' | 'success' | 'info';
/** Cel pozycji kokpitu. `chat` — rozmowa ze sprzedawcą (`id` — rozmowa, `seller` — profil sprzedawcy), otwierana w aplikacji. */
export type SellerTarget = { kind: 'offer' | 'event' | 'crm' | 'chat'; id?: string; tab?: string; seller?: string; href: string };
export type SellerCockpitItem = {
  id: string;
  title: string;
  meta: string[];
  quote?: string | null;
  /** Data do pokazania obok: `relative` — „wczoraj”, `until` — „za 3 dni”. */
  at?: string | null;
  atStyle?: 'relative' | 'until';
  side?: string | null;
  sideTone?: Tone;
  badges?: { text: string; tone: Tone }[];
  target?: SellerTarget;
  inquiry?: { id: string; status: string; guestName: string };
};
export type SellerCockpitGroup = { key: string; title: string; symbol: string; tone: 'brand' | 'warning'; empty: string; items: SellerCockpitItem[] };

const pln = (value: number | null | undefined) =>
  new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 0 }).format(Number(value || 0));
const plDate = (value: string | null | undefined) => {
  if (!value) return null;
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Warsaw' }) : null;
};
const missing = (error: { code?: string } | null | undefined) => ['PGRST202', '42883', '42P01'].includes(error?.code || '');

export const sellerCardHref = (seller: { id: string; contact_id?: string | null }, section?: string) => {
  const base = seller.contact_id ? `/crm/contacts/${seller.contact_id}?tab=seller` : `/crm/salespeople?seller=${seller.id}`;
  return section ? `${base}&section=${section}` : base;
};
const reviewHref = (offerId: string, documentId: string | null) =>
  documentId ? `/crm/offers/${offerId}?document=${documentId}&preview=1#seller-offer-review` : `/crm/offers/${offerId}#seller-offer-review`;
const chatHref = (chat: { contact_id: string | null; sales_partner_id: string; conversation_id: string }) => {
  const conversation = encodeURIComponent(chat.conversation_id);
  return chat.contact_id
    ? `/crm/contacts/${chat.contact_id}?tab=seller&section=chat&conversation=${conversation}`
    : `/crm/salespeople?seller=${chat.sales_partner_id}&section=chat&conversation=${conversation}`;
};
const STATUS_LABELS: Record<string, string> = { onboarding: 'Do uzgodnienia', active: 'Aktywny', inactive: 'Nieaktywny' };

/** Grupy „Dziś” w tej samej kolejności i z tymi samymi tekstami co CRM (`CockpitToday.tsx`). */
function todayGroups(cockpit: SellerCockpit): SellerCockpitGroup[] {
  const today = cockpit.today;
  const groups: SellerCockpitGroup[] = [];
  if (today.price_requests.length) groups.push({
    key: 'prices', title: 'Ceny do zgody', symbol: 'tag', tone: 'warning', empty: 'Brak próśb o zgodę na cenę.',
    items: today.price_requests.map((price) => ({
      id: price.request_id, title: `${price.offer_number ? `${price.offer_number} · ` : ''}${price.offer_title}`,
      meta: [`${price.seller_name} · ${formatPriceItems(price.items)}`], quote: price.note || null, at: price.requested_at, atStyle: 'relative',
      target: { kind: 'offer', id: price.offer_id, href: `/crm/offers/${price.offer_id}#seller-price-approval` },
    })),
  });
  groups.push({
    key: 'reviews', title: 'Oferty do sprawdzenia', symbol: 'doc.text.magnifyingglass', tone: 'brand', empty: 'Brak ofert czekających na decyzję.',
    items: today.reviews.map((review) => ({
      id: review.offer_id, title: `${review.offer_number ? `${review.offer_number} · ` : ''}${review.title}`,
      meta: [`${review.seller_name}${review.client_total_net != null ? ` · ${pln(review.client_total_net)} netto` : ''}`],
      at: review.requested_at, atStyle: 'relative',
      target: { kind: 'offer', id: review.offer_id, href: reviewHref(review.offer_id, review.document_id) },
    })),
  });
  groups.push({
    key: 'wizard', title: 'Kroki realizacji do zatwierdzenia', symbol: 'checklist', tone: 'brand', empty: 'Sprzedawcy nie przesłali nowych kroków.',
    items: today.wizard_steps.map((step) => ({
      id: `${step.offer_id}-${step.step_key}`, title: step.title,
      meta: [`${SELLER_REALIZATION_STEP_LABELS[step.step_key] || 'Krok realizacji'} · ${step.seller_name}`],
      at: step.submitted_at, atStyle: 'relative',
      target: step.event_id
        ? { kind: 'event', id: step.event_id, tab: 'seller-arrangements', href: `/crm/events/${step.event_id}?tab=seller-arrangements` }
        : { kind: 'offer', id: step.offer_id, href: `/crm/offers/${step.offer_id}` },
    })),
  });
  groups.push({
    key: 'events', title: 'Wydarzenia do potwierdzenia', symbol: 'calendar.badge.checkmark', tone: 'warning', empty: 'Brak wydarzeń czekających na potwierdzenie.',
    items: today.events_pending.map((event) => ({
      id: event.event_id, title: event.name, meta: [`${event.seller_name} · ${plDate(event.event_date) || 'bez terminu'}`],
      at: event.event_date, atStyle: 'until',
      badges: [
        ...(event.confirmation_required ? [{ text: 'Wymaga potwierdzenia', tone: 'warning' as Tone }] : []),
        ...(event.schedule_pending ? [{ text: 'Harmonogram do akceptacji', tone: 'info' as Tone }] : []),
      ],
      target: { kind: 'event', id: event.event_id, href: `/crm/events/${event.event_id}` },
    })),
  });
  groups.push({
    key: 'chats', title: 'Rozmowy czekające na odpowiedź', symbol: 'bubble.left.and.bubble.right', tone: 'warning', empty: 'Odpowiedziałeś na wszystkie wiadomości.',
    items: today.chats_waiting.map((chat) => ({
      id: chat.conversation_id, title: chat.seller_name, meta: [chat.title], quote: chat.preview || null,
      side: `czeka ${formatWaitingHours(chat.waiting_hours)}`, sideTone: chat.waiting_hours >= 24 ? 'danger' : chat.waiting_hours >= 4 ? 'warning' : 'neutral',
      target: { kind: 'chat', id: chat.conversation_id, seller: chat.sales_partner_id, href: chatHref(chat) },
    })),
  });
  groups.push({
    key: 'inquiries', title: 'Zapytania klientów', symbol: 'tray', tone: 'brand', empty: 'Brak nowych zapytań klientów.',
    items: today.inquiries.map((inquiry) => ({
      id: inquiry.id, title: inquiry.guest_name,
      meta: [
        [inquiry.event_type ? SELLER_EVENT_TYPE_LABELS[inquiry.event_type] || 'Wydarzenie' : null,
          inquiry.event_date ? plDate(inquiry.event_date) : 'termin do ustalenia',
          inquiry.guest_count ? `${inquiry.guest_count} os.` : null].filter(Boolean).join(' · '),
        `${inquiry.seller_name} · ${inquiry.source === 'qr' ? 'z kodu QR' : 'z portalu'}`,
      ],
      side: SELLER_INQUIRY_STATUS_LABELS[inquiry.status] || 'Nowe', sideTone: 'neutral',
      inquiry: { id: inquiry.id, status: inquiry.status, guestName: inquiry.guest_name },
    })),
  });
  groups.push({
    key: 'acceptances', title: 'Akceptacje klientów', symbol: 'party.popper', tone: 'brand', empty: 'Brak nowych akceptacji ofert przez klientów.',
    items: today.guest_acceptances.map((acceptance) => ({
      id: acceptance.offer_id, title: acceptance.title,
      meta: [`${acceptance.accepted_name ? `Zaakceptował(a): ${acceptance.accepted_name}` : 'Klient zaakceptował ofertę'} · ${acceptance.seller_name}`],
      at: acceptance.accepted_at, atStyle: 'relative', sideTone: 'success',
      target: { kind: 'offer', id: acceptance.offer_id, href: `/crm/offers/${acceptance.offer_id}` },
    })),
  });
  return groups;
}

const sellerRow = (seller: SellerCockpitSeller) => ({
  id: seller.id,
  contactId: seller.contact_id,
  name: seller.name,
  organization: seller.organization_name,
  email: seller.email,
  phone: seller.phone,
  status: seller.status,
  statusLabel: STATUS_LABELS[seller.status] || 'Inny stan',
  portalAccount: seller.portal_account,
  portalLabel: SELLER_PORTAL_ACCOUNT_LABELS[seller.portal_account],
  lastActivityAt: seller.last_activity_at,
  lastSignInAt: seller.last_sign_in_at,
  managerName: seller.manager?.name || null,
  backupManagerName: seller.backup_manager?.name || null,
  managerOk: seller.manager_ok,
  offers: seller.offers,
  upcomingEvents: seller.upcoming_events,
  payable: pln(seller.payable),
  forecast: pln(seller.forecast),
  hasMoney: seller.payable > 0 || seller.forecast > 0,
  warnings: seller.warnings.map((code) => SELLER_WARNING_LABELS[code as keyof typeof SELLER_WARNING_LABELS] || 'Ostrzeżenie'),
  cardHref: sellerCardHref(seller),
});

export async function sellersCockpit(ctx: NativeContext, managerFilter: string | null) {
  const [{ data, error }, prices] = await Promise.all([
    ctx.supabase.rpc('get_my_seller_cockpit', managerFilter ? { p_manager: managerFilter } : {}),
    // Zgoda na cenę (migracja 20261114230000) — bez migracji grupa jest pusta, kokpit działa dalej.
    ctx.supabase.rpc('get_my_seller_price_requests', managerFilter ? { p_manager: managerFilter } : {}),
  ]);
  if (error) {
    if (missing(error)) throw Object.assign(new Error('Kokpit opiekuna wymaga migracji 20261105150000_seller_manager_cockpit.sql.'), { status: 409 });
    throw error;
  }
  const cockpit = parseSellerCockpit(data);
  cockpit.today.price_requests = prices.error ? [] : parseSellerPriceRequests(prices.data);
  const sellers = cockpit.sellers;
  const pipeline = cockpit.pipeline;
  const today = sellerCockpitTodayCount(cockpit);
  const payable = sellers.reduce((sum, seller) => sum + seller.payable, 0);
  const forecast = sellers.reduce((sum, seller) => sum + seller.forecast, 0);
  const isAdmin = cockpit.viewer.is_admin;
  return {
    viewer: { employeeId: cockpit.viewer.employee_id, isAdmin },
    managers: cockpit.managers,
    managerFilter: managerFilter || null,
    todayCount: today,
    empty: sellers.length === 0 && today === 0,
    tiles: [
      { key: 'today', label: 'Sprawy na dziś', value: String(today), helper: today ? 'czekają na Ciebie' : 'wszystko załatwione' },
      { key: 'sellers', label: isAdmin ? 'Sprzedawcy' : 'Moi sprzedawcy', value: String(sellers.length),
        helper: `${sellers.filter((s) => s.status === 'active').length} aktywnych · ${sellers.filter((s) => s.portal_account === 'active').length} w portalu` },
      { key: 'offers', label: 'Oferty w toku', value: String(pipeline.draft + pipeline.pdf + pipeline.review), helper: `${pipeline.review} do sprawdzenia` },
      { key: 'upcoming', label: 'Wydarzenia w 14 dni', value: String(cockpit.upcoming.length), helper: 'najbliższe realizacje' },
      { key: 'money', label: 'Do wypłaty', value: pln(payable), helper: `prognoza ${pln(forecast)}` },
    ],
    groups: todayGroups(cockpit),
    // Oś w 5 etapach (jak portal, CRM i aplikacja mobilna) z liczbami z lejka ofert i wydarzeń sprzedawców.
    stages: sellerCockpitJourneyStages(pipeline),
    upcoming: cockpit.upcoming.map((event) => ({ eventId: event.event_id, name: event.name, date: event.event_date, status: event.status, sellerName: event.seller_name })),
    warnings: cockpit.warnings.map((warning) => {
      const seller = sellers.find((item) => item.id === warning.sales_partner_id);
      // Opiekun, marki i „Wynagrodzenie w portalu” są w ustawieniach karty sprzedawcy.
      const settings = ['no_manager', 'manager_without_rights', 'no_active_terms', 'commission_reveal_due'].includes(warning.code);
      return {
        sellerId: warning.sales_partner_id, sellerName: warning.seller_name, message: warning.message,
        label: SELLER_WARNING_LABELS[warning.code] || 'Ostrzeżenie',
        href: sellerCardHref({ id: warning.sales_partner_id, contact_id: seller?.contact_id }, settings ? 'settings' : undefined),
      };
    }),
    sellers: sellers.map(sellerRow),
    priceRequestsError: prices.error && !missing(prices.error) ? 'Nie udało się wczytać próśb o zgodę na cenę.' : null,
  };
}

type WorkspaceOffer = SellerWorkspaceOfferFacts & {
  id: string; title: string | null; offer_number: string | null; my_company_id: string; brand_name: string;
  created_at: string; client_name: string | null; event_date: string | null; client_total_net: number | null;
};
type WorkspaceEvent = { id: string; name: string; event_date: string; status: string; brand_name: string };

/** Karta sprzedawcy: „Gotowość do pracy”, oferty na osi, realizacje, marki, opiekun i konto w portalu. */
export async function sellerCard(ctx: NativeContext, partnerId: string) {
  const [profile, readiness, workspace] = await Promise.all([
    ctx.supabase.from('sales_partner_profiles').select('id,contact_id').eq('id', partnerId).maybeSingle(),
    ctx.supabase.rpc('get_crm_seller_readiness', { p_partner: partnerId }),
    ctx.supabase.rpc('get_crm_seller_workspace', { p_partner: partnerId }),
  ]);
  if (workspace.error) {
    if (workspace.error.code === '42501') throw Object.assign(new Error(workspace.error.message || 'Brak dostępu do tego sprzedawcy.'), { status: 403 });
    throw workspace.error;
  }
  const data = (workspace.data || {}) as {
    offers?: WorkspaceOffer[]; events?: WorkspaceEvent[]; can_view_offers?: boolean;
    manager?: { manager_name?: string | null; backup_manager_name?: string | null; manager_ok?: boolean } | null;
    portal?: { portal_account?: string; last_sign_in_at?: string | null } | null;
    terms?: { my_company_id: string; name: string; is_active: boolean; commission_enabled: boolean; rate: number | null; commissions_visible: boolean }[];
  };
  const contactId = (profile.data as { contact_id?: string | null } | null)?.contact_id || null;
  const card = { id: partnerId, contact_id: contactId };
  const offers = data.offers || [];
  const events = data.events || [];
  const eventStatus = new Map(events.map((event) => [event.id, event.status]));
  // Zgoda na cenę — offers.partner_approval_status (CRM czyta oferty sprzedawców tym samym tokenem).
  const approval = new Map<string, string>();
  if (offers.length && data.can_view_offers) {
    const ids = offers.map((offer) => offer.id);
    for (let index = 0; index < ids.length; index += 100) {
      const { data: rows } = await ctx.supabase.from('offers').select('id,partner_approval_status').in('id', ids.slice(index, index + 100));
      for (const row of (rows || []) as { id: string; partner_approval_status: string | null }[]) approval.set(row.id, row.partner_approval_status || 'not_required');
    }
  }
  const managerName = data.manager?.manager_name || null;
  const offerRows = offers.map((offer) => {
    const journey = sellerJourney(sellerWorkspaceJourneyInput(offer, {
      priceApprovalRequired: approval.get(offer.id) === 'required',
      eventStatus: offer.event_id ? eventStatus.get(offer.event_id) || null : null,
    }), { viewer: 'manager', managerName });
    return {
      id: offer.id, number: offer.offer_number, title: offer.title || 'Oferta bez tytułu', client: offer.client_name, brand: offer.brand_name,
      net: offer.client_total_net == null ? null : pln(offer.client_total_net), eventDate: offer.event_date, eventId: offer.event_id, createdAt: offer.created_at,
      journey: { index: journey.index, key: journey.key, stageLabel: journey.stageLabel, state: journey.state, now: journey.now, tone: journey.tone,
        actor: SELLER_JOURNEY_ACTOR_LABELS[journey.actor].manager, needsAction: journey.needsAction, ended: journey.ended },
      href: `/crm/offers/${offer.id}`,
    };
  });
  let readinessBlock: null | { summary: ReturnType<typeof sellerReadinessSummary>; steps: ReturnType<typeof sellerReadinessSteps> } = null;
  let readinessError: string | null = null;
  if (readiness.error) {
    readinessError = missing(readiness.error) ? `„Gotowość do pracy” wymaga migracji ${SELLER_READINESS_MIGRATION}.`
      : readiness.error.message || 'Nie udało się sprawdzić gotowości sprzedawcy.';
  } else {
    const steps = sellerReadinessSteps(readiness.data as SellerReadinessFacts);
    readinessBlock = { summary: sellerReadinessSummary(steps), steps };
  }
  return {
    id: partnerId,
    contactId,
    readiness: readinessBlock,
    readinessError,
    manager: { name: managerName, backupName: data.manager?.backup_manager_name || null, ok: data.manager?.manager_ok === true },
    portal: { account: data.portal?.portal_account || 'none', lastSignInAt: data.portal?.last_sign_in_at || null },
    terms: (data.terms || []).map((term) => ({
      companyId: term.my_company_id, name: term.name, active: term.is_active, commission: term.commission_enabled,
      rate: term.rate, commissionsVisible: term.commissions_visible,
    })),
    canViewOffers: data.can_view_offers === true,
    offers: offerRows,
    events: events.map((event) => ({ id: event.id, name: event.name, date: event.event_date, status: event.status, brand: event.brand_name })),
    links: {
      card: sellerCardHref(card),
      settings: sellerCardHref(card, 'settings'),
      branding: sellerCardHref(card, 'branding'),
      chat: sellerCardHref(card, 'chat'),
      settlements: sellerCardHref(card, 'settlements'),
      pricing: `/crm/salespeople/${partnerId}/pricing`,
    },
  };
}

/** Instrukcja opiekuna — ta sama treść co panel „?” w CRM. */
export const sellersHelp = () => ({
  title: MANAGER_HELP.title,
  stages: SELLER_JOURNEY_STAGES.map((stage) => ({ key: stage.key, label: stage.label, hint: stage.hint })),
  chapters: MANAGER_HELP.chapters,
});
