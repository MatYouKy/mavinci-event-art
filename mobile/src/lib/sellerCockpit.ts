/**
 * Kokpit opiekuna sprzedawców zewnętrznych — wspólny kod CRM ↔ aplikacja mobilna.
 * Kopia 1:1: src/lib/seller/sellerCockpit.ts ↔ mobile/src/lib/sellerCockpit.ts (scripts/ci/check-shared-copies.mjs).
 * Źródło danych: RPC get_my_seller_cockpit (migracja 20261105150000_seller_manager_cockpit.sql) oraz klucz `sellers`
 * w get_my_sales_day. Tu tylko typy, bezpieczny odczyt wyniku i etykiety — bez zależności od Reacta.
 */

export type SellerPortalAccount = 'none' | 'invited' | 'active';
export type SellerInquirySource = 'portal' | 'qr';
export type SellerInquiryStatus = 'new' | 'in_progress' | 'answered' | 'converted' | 'closed';
export type SellerWarningCode =
  | 'no_manager'
  | 'manager_without_rights'
  | 'no_active_terms'
  | 'invite_pending'
  | 'inactive_30'
  | 'inactive_60';
export type SellerPipelineStage = 'draft' | 'pdf' | 'review' | 'accepted' | 'confirmed' | 'completed' | 'settled';

export type SellerCockpitPerson = { id: string; name: string };

export type SellerCockpitBrand = {
  my_company_id: string;
  name: string;
  is_active: boolean;
  commission_enabled: boolean;
  rate: number | null;
  commissions_visible: boolean;
};

export type SellerCockpitSeller = {
  id: string;
  contact_id: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  organization_id: string | null;
  organization_name: string | null;
  partner_type: string;
  status: string;
  portal_enabled: boolean;
  portal_account: SellerPortalAccount;
  last_sign_in_at: string | null;
  last_activity_at: string | null;
  manager: SellerCockpitPerson | null;
  backup_manager: SellerCockpitPerson | null;
  manager_ok: boolean;
  brands: SellerCockpitBrand[];
  offers: { draft: number; pdf: number; review: number; accepted: number; total: number };
  upcoming_events: number;
  payable: number;
  forecast: number;
  /** Kody ostrzeżeń (SELLER_WARNING_LABELS). */
  warnings: string[];
  /** Te same ostrzeżenia jako gotowe komunikaty z bazy. */
  warning_messages: string[];
};

export type SellerCockpitReview = {
  offer_id: string;
  document_id: string | null;
  sales_partner_id: string;
  seller_name: string;
  title: string;
  offer_number: string | null;
  requested_at: string | null;
  client_total_net: number | null;
};
export type SellerCockpitWizardStep = {
  offer_id: string;
  event_id: string | null;
  sales_partner_id: string;
  seller_name: string;
  title: string;
  step_key: string;
  submitted_at: string | null;
};
export type SellerCockpitPendingEvent = {
  event_id: string;
  name: string;
  event_date: string | null;
  sales_partner_id: string;
  seller_name: string;
  confirmation_required: boolean;
  schedule_pending: boolean;
};
export type SellerCockpitChat = {
  conversation_id: string;
  sales_partner_id: string;
  seller_name: string;
  contact_id: string | null;
  offer_id: string | null;
  title: string;
  last_message_at: string | null;
  preview: string;
  waiting_hours: number;
};
export type SellerCockpitInquiry = {
  id: string;
  sales_partner_id: string;
  seller_name: string;
  source: SellerInquirySource;
  guest_name: string;
  event_date: string | null;
  guest_count: number | null;
  event_type: string | null;
  created_at: string | null;
  status: SellerInquiryStatus;
};
export type SellerCockpitGuestAcceptance = {
  offer_id: string;
  sales_partner_id: string;
  seller_name: string;
  title: string;
  accepted_at: string | null;
  accepted_name: string | null;
};
export type SellerCockpitUpcoming = {
  event_id: string;
  name: string;
  event_date: string | null;
  status: string;
  sales_partner_id: string;
  seller_name: string;
};
export type SellerCockpitWarning = { sales_partner_id: string; seller_name: string; code: SellerWarningCode; message: string };

export type SellerCockpit = {
  viewer: { employee_id: string | null; is_admin: boolean };
  managers: (SellerCockpitPerson & { eligible: boolean })[];
  today: {
    reviews: SellerCockpitReview[];
    wizard_steps: SellerCockpitWizardStep[];
    events_pending: SellerCockpitPendingEvent[];
    chats_waiting: SellerCockpitChat[];
    inquiries: SellerCockpitInquiry[];
    guest_acceptances: SellerCockpitGuestAcceptance[];
  };
  sellers: SellerCockpitSeller[];
  pipeline: Record<SellerPipelineStage, number>;
  upcoming: SellerCockpitUpcoming[];
  warnings: SellerCockpitWarning[];
};

export type SalesDaySellersItemKind = 'review' | 'chat' | 'inquiry' | 'wizard' | 'event' | 'guest';
export type SalesDaySellers = {
  reviews: number;
  chats_waiting: number;
  inquiries: number;
  wizard_steps: number;
  events_pending: number;
  guest_acceptances: number;
  items: { kind: SalesDaySellersItemKind; title: string; seller_name: string; at: string | null; url: string }[];
};

type Raw = Record<string, unknown>;
const obj = (value: unknown): Raw => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Raw) : {});
const list = (value: unknown): Raw[] => (Array.isArray(value) ? value.filter(item => item && typeof item === 'object') as Raw[] : []);
const str = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : value == null ? fallback : String(value));
const strOrNull = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null);
const num = (value: unknown, fallback = 0): number => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
};
const numOrNull = (value: unknown): number | null => (value == null || value === '' ? null : Number.isFinite(num(value, NaN)) ? num(value) : null);
const bool = (value: unknown): boolean => value === true;
const person = (value: unknown): SellerCockpitPerson | null => {
  const raw = obj(value);
  return typeof raw.id === 'string' ? { id: raw.id, name: str(raw.name, 'Pracownik') } : null;
};

export const SELLER_PIPELINE_STAGES: SellerPipelineStage[] = ['draft', 'pdf', 'review', 'accepted', 'confirmed', 'completed', 'settled'];

/** Bezpieczny odczyt wyniku get_my_seller_cockpit. */
export function parseSellerCockpit(data: unknown): SellerCockpit {
  const raw = obj(data);
  const viewer = obj(raw.viewer);
  const today = obj(raw.today);
  const pipelineRaw = obj(raw.pipeline);
  const pipeline = {} as Record<SellerPipelineStage, number>;
  for (const stage of SELLER_PIPELINE_STAGES) pipeline[stage] = num(pipelineRaw[stage]);
  return {
    viewer: { employee_id: strOrNull(viewer.employee_id), is_admin: bool(viewer.is_admin) },
    managers: list(raw.managers).map(item => ({ id: str(item.id), name: str(item.name, 'Pracownik'), eligible: bool(item.eligible) })),
    today: {
      reviews: list(today.reviews).map(item => ({
        offer_id: str(item.offer_id),
        document_id: strOrNull(item.document_id),
        sales_partner_id: str(item.sales_partner_id),
        seller_name: str(item.seller_name, 'Sprzedawca'),
        title: str(item.title, 'Oferta'),
        offer_number: strOrNull(item.offer_number),
        requested_at: strOrNull(item.requested_at),
        client_total_net: numOrNull(item.client_total_net),
      })),
      wizard_steps: list(today.wizard_steps).map(item => ({
        offer_id: str(item.offer_id),
        event_id: strOrNull(item.event_id),
        sales_partner_id: str(item.sales_partner_id),
        seller_name: str(item.seller_name, 'Sprzedawca'),
        title: str(item.title, 'Realizacja'),
        step_key: str(item.step_key),
        submitted_at: strOrNull(item.submitted_at),
      })),
      events_pending: list(today.events_pending).map(item => ({
        event_id: str(item.event_id),
        name: str(item.name, 'Wydarzenie'),
        event_date: strOrNull(item.event_date),
        sales_partner_id: str(item.sales_partner_id),
        seller_name: str(item.seller_name, 'Sprzedawca'),
        confirmation_required: bool(item.confirmation_required),
        schedule_pending: bool(item.schedule_pending),
      })),
      chats_waiting: list(today.chats_waiting).map(item => ({
        conversation_id: str(item.conversation_id),
        sales_partner_id: str(item.sales_partner_id),
        seller_name: str(item.seller_name, 'Sprzedawca'),
        contact_id: strOrNull(item.contact_id),
        offer_id: strOrNull(item.offer_id),
        title: str(item.title, 'Rozmowa'),
        last_message_at: strOrNull(item.last_message_at),
        preview: str(item.preview),
        waiting_hours: num(item.waiting_hours),
      })),
      inquiries: list(today.inquiries).map(item => ({
        id: str(item.id),
        sales_partner_id: str(item.sales_partner_id),
        seller_name: str(item.seller_name, 'Sprzedawca'),
        source: item.source === 'qr' ? 'qr' : 'portal',
        guest_name: str(item.guest_name, 'Gość'),
        event_date: strOrNull(item.event_date),
        guest_count: numOrNull(item.guest_count),
        event_type: strOrNull(item.event_type),
        created_at: strOrNull(item.created_at),
        status: (str(item.status, 'new') as SellerInquiryStatus),
      })),
      guest_acceptances: list(today.guest_acceptances).map(item => ({
        offer_id: str(item.offer_id),
        sales_partner_id: str(item.sales_partner_id),
        seller_name: str(item.seller_name, 'Sprzedawca'),
        title: str(item.title, 'Oferta'),
        accepted_at: strOrNull(item.accepted_at),
        accepted_name: strOrNull(item.accepted_name),
      })),
    },
    sellers: list(raw.sellers).map(item => {
      const offers = obj(item.offers);
      return {
        id: str(item.id),
        contact_id: strOrNull(item.contact_id),
        name: str(item.name, 'Sprzedawca'),
        email: strOrNull(item.email),
        phone: strOrNull(item.phone),
        organization_id: strOrNull(item.organization_id),
        organization_name: strOrNull(item.organization_name),
        partner_type: str(item.partner_type),
        status: str(item.status, 'active'),
        portal_enabled: bool(item.portal_enabled),
        portal_account: item.portal_account === 'active' || item.portal_account === 'invited' ? item.portal_account : 'none',
        last_sign_in_at: strOrNull(item.last_sign_in_at),
        last_activity_at: strOrNull(item.last_activity_at),
        manager: person(item.manager),
        backup_manager: person(item.backup_manager),
        manager_ok: bool(item.manager_ok),
        brands: list(item.brands).map(brand => ({
          my_company_id: str(brand.my_company_id),
          name: str(brand.name, 'Marka'),
          is_active: bool(brand.is_active),
          commission_enabled: bool(brand.commission_enabled),
          rate: numOrNull(brand.rate),
          commissions_visible: bool(brand.commissions_visible),
        })),
        offers: {
          draft: num(offers.draft),
          pdf: num(offers.pdf),
          review: num(offers.review),
          accepted: num(offers.accepted),
          total: num(offers.total),
        },
        upcoming_events: num(item.upcoming_events),
        payable: num(item.payable),
        forecast: num(item.forecast),
        warnings: Array.isArray(item.warnings) ? item.warnings.filter((w): w is string => typeof w === 'string') : [],
        warning_messages: Array.isArray(item.warning_messages) ? item.warning_messages.filter((w): w is string => typeof w === 'string') : [],
      };
    }),
    pipeline,
    upcoming: list(raw.upcoming).map(item => ({
      event_id: str(item.event_id),
      name: str(item.name, 'Wydarzenie'),
      event_date: strOrNull(item.event_date),
      status: str(item.status),
      sales_partner_id: str(item.sales_partner_id),
      seller_name: str(item.seller_name, 'Sprzedawca'),
    })),
    warnings: list(raw.warnings).map(item => ({
      sales_partner_id: str(item.sales_partner_id),
      seller_name: str(item.seller_name, 'Sprzedawca'),
      code: str(item.code) as SellerWarningCode,
      message: str(item.message),
    })),
  };
}

/** Odczyt klucza `sellers` z get_my_sales_day (brak klucza = starsza baza → null). */
export function parseSalesDaySellers(value: unknown): SalesDaySellers | null {
  if (!value || typeof value !== 'object') return null;
  const raw = obj(value);
  return {
    reviews: num(raw.reviews),
    chats_waiting: num(raw.chats_waiting),
    inquiries: num(raw.inquiries),
    wizard_steps: num(raw.wizard_steps),
    events_pending: num(raw.events_pending),
    guest_acceptances: num(raw.guest_acceptances),
    items: list(raw.items).map(item => ({
      kind: (str(item.kind, 'review') as SalesDaySellersItemKind),
      title: str(item.title),
      seller_name: str(item.seller_name, 'Sprzedawca'),
      at: strOrNull(item.at),
      url: str(item.url),
    })),
  };
}

export const SELLER_PIPELINE_LABELS: Record<SellerPipelineStage, string> = {
  draft: 'Szkic',
  pdf: 'PDF gotowy',
  review: 'Do sprawdzenia',
  accepted: 'Zaakceptowana',
  confirmed: 'Potwierdzone',
  completed: 'Zrealizowane',
  settled: 'Rozliczone',
};

export const SELLER_PORTAL_ACCOUNT_LABELS: Record<SellerPortalAccount, string> = {
  none: 'Bez konta w portalu',
  invited: 'Zaproszony',
  active: 'Aktywny w portalu',
};

export const SELLER_INQUIRY_STATUS_LABELS: Record<SellerInquiryStatus, string> = {
  new: 'Nowe',
  in_progress: 'W toku',
  answered: 'Odpowiedziano',
  converted: 'Przekazane do zapytań',
  closed: 'Zamknięte',
};

export const SELLER_EVENT_TYPE_LABELS: Record<string, string> = {
  wedding: 'Wesele',
  conference: 'Konferencja',
  gala: 'Gala',
  party: 'Impreza',
  corporate: 'Wydarzenie firmowe',
  other: 'Inne',
};

export const SELLER_WARNING_LABELS: Record<SellerWarningCode, string> = {
  no_manager: 'Brak opiekuna',
  manager_without_rights: 'Opiekun bez uprawnień',
  no_active_terms: 'Brak aktywnych warunków marki',
  invite_pending: 'Zaproszenie nieprzyjęte',
  inactive_30: 'Brak aktywności 30 dni',
  inactive_60: 'Brak aktywności 60 dni',
};

export const SELLER_REALIZATION_STEP_LABELS: Record<string, string> = {
  contact: 'Osoba na miejscu',
  organization: 'Sala, dostęp i liczba gości',
  materials: 'Materiały i wymagania',
  plan: 'Plan wydarzenia',
};

/** Ile godzin czeka rozmowa — czytelnie po polsku. */
export function formatWaitingHours(hours: number): string {
  if (!Number.isFinite(hours) || hours < 1) return 'przed chwilą';
  if (hours < 24) return `${Math.floor(hours)} h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '1 dzień' : `${days} dni`;
}

/** Łączna liczba spraw „Dziś” w kokpicie. */
export function sellerCockpitTodayCount(cockpit: SellerCockpit): number {
  const t = cockpit.today;
  return t.reviews.length + t.wizard_steps.length + t.events_pending.length + t.chats_waiting.length + t.inquiries.length
    + t.guest_acceptances.length;
}
