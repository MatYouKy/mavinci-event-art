/**
 * Podsumowanie wydarzenia i ewidencja prowizji — wspólne typy, odczyt i etykiety CRM i aplikacji mobilnej.
 * Identyczna kopia: mobile/src/lib/eventSettlement.ts (pilnuje scripts/ci/check-shared-copies.mjs).
 * Źródło prawdy to baza (migracja 20261105130000_event_settlement_commissions.sql):
 *   get_event_settlement, save_event_settlement_line, delete_event_settlement_line, link_event_cost_invoice,
 *   list_event_cost_invoice_candidates, submit/return/approve/reopen_event_settlement, set_event_sales_shares,
 *   get_my_commissions, get_sales_commission_settings, set_sales_commission_defaults,
 *   set_employee_sales_commission_terms, settle_commission_deduction, add_event_partner_commission.
 * Ten plik niczego nie liczy — tylko odczytuje wynik bazy i opisuje go po polsku. Bez importów.
 */

export type SettlementStatus = 'draft' | 'submitted' | 'approved';
export type SettlementLineKind = 'revenue' | 'cost';
export type SettlementCategory = 'revenue' | 'subcontractor' | 'direct_cost' | 'team' | 'external_commission';
export type SettlementSourceType =
  | 'manual'
  | 'invoice'
  | 'offer'
  | 'cash'
  | 'forecast'
  | 'event_cost'
  | 'subcontractor_task'
  | 'team'
  | 'markup'
  | 'commission';
export type SettlementEditableField = 'included' | 'category' | 'net' | 'confirm' | 'note' | 'name' | 'delete';
export type CommissionStatus = 'planned' | 'approved' | 'paid' | 'cancelled';
export type CommissionEntryKind = 'accrual' | 'correction' | 'deduction';
export type CommissionPaymentMethod = 'cash_dividend' | 'invoice' | 'payroll' | 'other';

export type SettlementLine = {
  key: string;
  line_id: string | null;
  source_type: SettlementSourceType;
  source_id: string | null;
  kind: SettlementLineKind;
  category: SettlementCategory;
  name: string;
  detail: string | null;
  date: string | null;
  suggested_net: number | null;
  net_amount: number;
  gross_amount: number | null;
  auto_included: boolean;
  included: boolean;
  needs_confirmation: boolean;
  confirmed: boolean;
  /** Kwota źródła zmieniła się po korekcie — korekta przestała obowiązywać, trzeba potwierdzić ponownie. */
  source_changed: boolean;
  previous_source_net: number | null;
  auto: boolean;
  auto_note: string | null;
  note: string | null;
  updated_at: string | null;
  updated_by_name: string | null;
  editable: SettlementEditableField[];
};

export type SettlementTotals = {
  revenue_net: number;
  subcontractor_net: number;
  direct_cost_net: number;
  team_net: number;
  external_commission_lines: number;
  external_commission_auto: number;
  costs_net: number;
  partner_base: number;
  profit_net: number;
  internal_commissions: number;
  internal_commissions_cost: number;
  profit_after_commissions: number;
};

export type SettlementExternalCommission = {
  partner_id: string;
  name: string;
  source: string;
  eligible: boolean;
  skip_reason: string | null;
  rate: number | null;
  rate_reason: string | null;
  /** Prowizja już zatwierdzona — przy ponownym rozliczeniu zostaje jej stawka (zmiana warunków nie działa wstecz). */
  retained: boolean;
  base: number;
  amount: number;
  company_cost: number;
  payment_method: CommissionPaymentMethod;
  commission_id: string | null;
};

export type SettlementInternalCommission = {
  employee_id: string;
  name: string;
  share_percent: number;
  source: string;
  client_owned: boolean;
  client_label: string | null;
  client_checked_at: string | null;
  client_check_basis: string | null;
  enabled: boolean;
  blocked_reason: string | null;
  rate: number;
  rate_reason: string | null;
  retained: boolean;
  base: number;
  amount: number;
  company_cost: number;
  payment_method: CommissionPaymentMethod;
  employer_social_rate: number | null;
  commission_id: string | null;
};

export type SettlementVersion = {
  id: string;
  revision: number;
  action: 'submitted' | 'returned' | 'approved' | 'reopened';
  note: string | null;
  created_at: string;
  actor_name: string | null;
  totals: Partial<SettlementTotals> | null;
  internal: { name: string; amount: number; rate: number; share_percent: number }[];
  external: { name: string; amount: number; rate: number }[];
};

export type SettlementCommissionRow = {
  id: string;
  beneficiary_name: string;
  beneficiary_type: string;
  employee_id: string | null;
  sales_partner_id: string | null;
  entry_kind: CommissionEntryKind;
  corrects_commission_id: string | null;
  automatic_source: string | null;
  status: CommissionStatus;
  amount: number;
  base_amount: number | null;
  rate: number | null;
  company_cost_amount: number | null;
  payment_method: CommissionPaymentMethod;
  base_description: string | null;
  rate_reason: string | null;
  settlement_revision: number | null;
  /** Wypłacono przelewem / wypłatą. */
  paid_amount: number;
  /** Rozliczono potrąceniem (bez przelewu). */
  offset_amount: number;
  /** Powód ręcznego anulowania prowizji z podsumowania (finanse / administrator). */
  cancel_reason: string | null;
  manual: boolean;
};

export type EventSettlement = {
  event_id: string;
  status: SettlementStatus;
  revision: number;
  lines: SettlementLine[];
  totals: SettlementTotals;
  external: SettlementExternalCommission[];
  internal: SettlementInternalCommission[];
  shares_sum: number;
  issues: string[];
  warnings: string[];
  finished: boolean;
  forecast: boolean;
  /** Wydarzenie anulowane po zatwierdzeniu — ponowne zatwierdzenie zeruje prowizje. */
  clawback: boolean;
  /** Otwarte ponownie z przeliczeniem stawek — przy zatwierdzeniu stawki według aktualnych warunków. */
  refresh_rates: boolean;
  source_key: string;
  stale: boolean;
  submitted_stale: boolean;
  submitted: { at: string; note: string | null; by_name: string | null } | null;
  approved: { at: string; by_name: string | null } | null;
  returned: { at: string; note: string | null; by_name: string | null } | null;
  can_edit: boolean;
  can_submit: boolean;
  can_approve: boolean;
  can_return: boolean;
  can_reopen: boolean;
  can_edit_shares: boolean;
  versions: SettlementVersion[];
  commissions: SettlementCommissionRow[];
};

const num = (value: unknown, fallback = 0): number => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
};
const numOrNull = (value: unknown): number | null => {
  if (value == null || value === '') return null;
  const parsed = num(value, NaN);
  return Number.isFinite(parsed) ? parsed : null;
};
const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null);
const bool = (value: unknown): boolean => value === true;
const arr = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

const TOTAL_KEYS: (keyof SettlementTotals)[] = [
  'revenue_net',
  'subcontractor_net',
  'direct_cost_net',
  'team_net',
  'external_commission_lines',
  'external_commission_auto',
  'costs_net',
  'partner_base',
  'profit_net',
  'internal_commissions',
  'internal_commissions_cost',
  'profit_after_commissions',
];

function parseTotals(value: unknown): SettlementTotals {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const totals = {} as SettlementTotals;
  for (const key of TOTAL_KEYS) totals[key] = num(raw[key]);
  return totals;
}

/** Bezpieczny odczyt wyniku RPC get_event_settlement (i każdej funkcji, która go zwraca po zapisie). */
export function parseEventSettlement(data: unknown): EventSettlement | null {
  if (!data || typeof data !== 'object') return null;
  const raw = data as Record<string, unknown>;
  if (typeof raw.event_id !== 'string') return null;
  const status = raw.status === 'submitted' || raw.status === 'approved' ? raw.status : 'draft';
  return {
    event_id: raw.event_id,
    status,
    revision: num(raw.revision),
    lines: arr<Record<string, unknown>>(raw.lines).map(line => ({
      key: String(line.key ?? ''),
      line_id: text(line.line_id),
      source_type: String(line.source_type ?? 'manual') as SettlementSourceType,
      source_id: text(line.source_id),
      kind: line.kind === 'revenue' ? 'revenue' : 'cost',
      category: String(line.category ?? 'direct_cost') as SettlementCategory,
      name: text(line.name) ?? 'Pozycja',
      detail: text(line.detail),
      date: text(line.date),
      suggested_net: numOrNull(line.suggested_net),
      net_amount: num(line.net_amount),
      gross_amount: numOrNull(line.gross_amount),
      auto_included: bool(line.auto_included),
      included: bool(line.included),
      needs_confirmation: bool(line.needs_confirmation),
      confirmed: bool(line.confirmed),
      source_changed: bool(line.source_changed),
      previous_source_net: numOrNull(line.previous_source_net),
      auto: bool(line.auto),
      auto_note: text(line.auto_note),
      note: text(line.note),
      updated_at: text(line.updated_at),
      updated_by_name: text(line.updated_by_name),
      editable: arr<string>(line.editable).filter(Boolean) as SettlementEditableField[],
    })),
    totals: parseTotals(raw.totals),
    external: arr<Record<string, unknown>>(raw.external).map(item => ({
      partner_id: String(item.partner_id ?? ''),
      name: text(item.name) ?? 'Sprzedawca',
      source: String(item.source ?? ''),
      eligible: bool(item.eligible),
      skip_reason: text(item.skip_reason),
      rate: numOrNull(item.rate),
      rate_reason: text(item.rate_reason),
      retained: bool(item.retained),
      base: num(item.base),
      amount: num(item.amount),
      company_cost: num(item.company_cost),
      payment_method: String(item.payment_method ?? 'other') as CommissionPaymentMethod,
      commission_id: text(item.commission_id),
    })),
    internal: arr<Record<string, unknown>>(raw.internal).map(item => ({
      employee_id: String(item.employee_id ?? ''),
      name: text(item.name) ?? 'Pracownik',
      share_percent: num(item.share_percent),
      source: String(item.source ?? ''),
      client_owned: bool(item.client_owned),
      client_label: text(item.client_label),
      client_checked_at: text(item.client_checked_at),
      client_check_basis: text(item.client_check_basis),
      enabled: bool(item.enabled),
      blocked_reason: text(item.blocked_reason),
      rate: num(item.rate),
      rate_reason: text(item.rate_reason),
      retained: bool(item.retained),
      base: num(item.base),
      amount: num(item.amount),
      company_cost: num(item.company_cost),
      payment_method: String(item.payment_method ?? 'payroll') as CommissionPaymentMethod,
      employer_social_rate: numOrNull(item.employer_social_rate),
      commission_id: text(item.commission_id),
    })),
    shares_sum: num(raw.shares_sum),
    issues: arr<string>(raw.issues).filter(item => typeof item === 'string'),
    warnings: arr<string>(raw.warnings).filter(item => typeof item === 'string'),
    finished: bool(raw.finished),
    forecast: bool(raw.forecast),
    clawback: bool(raw.clawback),
    refresh_rates: bool(raw.refresh_rates),
    source_key: String(raw.source_key ?? ''),
    stale: bool(raw.stale),
    submitted_stale: bool(raw.submitted_stale),
    submitted: raw.submitted && typeof raw.submitted === 'object'
      ? {
          at: String((raw.submitted as Record<string, unknown>).at ?? ''),
          note: text((raw.submitted as Record<string, unknown>).note),
          by_name: text((raw.submitted as Record<string, unknown>).by_name),
        }
      : null,
    approved: raw.approved && typeof raw.approved === 'object'
      ? {
          at: String((raw.approved as Record<string, unknown>).at ?? ''),
          by_name: text((raw.approved as Record<string, unknown>).by_name),
        }
      : null,
    returned: raw.returned && typeof raw.returned === 'object'
      ? {
          at: String((raw.returned as Record<string, unknown>).at ?? ''),
          note: text((raw.returned as Record<string, unknown>).note),
          by_name: text((raw.returned as Record<string, unknown>).by_name),
        }
      : null,
    can_edit: bool(raw.can_edit),
    can_submit: bool(raw.can_submit),
    can_approve: bool(raw.can_approve),
    can_return: bool(raw.can_return),
    can_reopen: bool(raw.can_reopen),
    can_edit_shares: bool(raw.can_edit_shares),
    versions: arr<Record<string, unknown>>(raw.versions).map(version => ({
      id: String(version.id ?? ''),
      revision: num(version.revision),
      action: String(version.action ?? 'submitted') as SettlementVersion['action'],
      note: text(version.note),
      created_at: String(version.created_at ?? ''),
      actor_name: text(version.actor_name),
      totals: version.totals && typeof version.totals === 'object' ? parseTotals(version.totals) : null,
      internal: arr<Record<string, unknown>>(version.internal).map(item => ({
        name: text(item.name) ?? 'Pracownik',
        amount: num(item.amount),
        rate: num(item.rate),
        share_percent: num(item.share_percent),
      })),
      external: arr<Record<string, unknown>>(version.external).map(item => ({
        name: text(item.name) ?? 'Sprzedawca',
        amount: num(item.amount),
        rate: num(item.rate),
      })),
    })),
    commissions: arr<Record<string, unknown>>(raw.commissions).map(row => ({
      id: String(row.id ?? ''),
      beneficiary_name: text(row.beneficiary_name) ?? 'Odbiorca',
      beneficiary_type: String(row.beneficiary_type ?? ''),
      employee_id: text(row.employee_id),
      sales_partner_id: text(row.sales_partner_id),
      entry_kind: (row.entry_kind === 'correction' || row.entry_kind === 'deduction' ? row.entry_kind : 'accrual') as CommissionEntryKind,
      corrects_commission_id: text(row.corrects_commission_id),
      automatic_source: text(row.automatic_source),
      status: String(row.status ?? 'planned') as CommissionStatus,
      amount: num(row.amount),
      base_amount: numOrNull(row.base_amount),
      rate: numOrNull(row.rate),
      company_cost_amount: numOrNull(row.company_cost_amount),
      payment_method: String(row.payment_method ?? 'other') as CommissionPaymentMethod,
      base_description: text(row.base_description),
      rate_reason: text(row.rate_reason),
      settlement_revision: numOrNull(row.settlement_revision),
      paid_amount: num(row.paid_amount),
      offset_amount: num(row.offset_amount),
      cancel_reason: text(row.cancel_reason),
      manual: bool(row.manual),
    })),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Moje prowizje (RPC get_my_commissions) — CRM i aplikacja.
// ---------------------------------------------------------------------------------------------------------------

export type MyCommissionRow = {
  id: string;
  event_id: string;
  event_name: string;
  event_date: string | null;
  event_status: string | null;
  entry_kind: CommissionEntryKind;
  corrects_commission_id: string | null;
  status: CommissionStatus;
  amount: number;
  base_amount: number | null;
  rate: number | null;
  rate_reason: string | null;
  share_percent: number | null;
  client_owned: boolean | null;
  base_description: string | null;
  payment_method: CommissionPaymentMethod;
  automatic: boolean;
  /** Wypłacono przelewem / wypłatą (bez potrąceń). */
  paid_amount: number;
  /** Rozliczono potrąceniem. */
  offset_amount: number;
  /** Przy naliczeniu i dopłacie — do wypłaty; przy potrąceniu — jeszcze do potrącenia. */
  remaining_amount: number;
  settlement_status: SettlementStatus;
  settlement_revision: number | null;
  created_at: string | null;
  updated_at: string | null;
  payments: { amount: number; payment_date: string | null; reference: string | null; is_offset: boolean }[];
};

export type MyCommissions = {
  employee_id: string;
  enabled: boolean;
  standard_rate: number;
  own_client_rate: number;
  payment_method: CommissionPaymentMethod;
  totals: { forecast: number; to_pay: number; paid: number; to_offset: number };
  commissions: MyCommissionRow[];
};

export function parseMyCommissions(data: unknown): MyCommissions | null {
  if (!data || typeof data !== 'object') return null;
  const raw = data as Record<string, unknown>;
  const totals = (raw.totals && typeof raw.totals === 'object' ? raw.totals : {}) as Record<string, unknown>;
  return {
    employee_id: String(raw.employee_id ?? ''),
    enabled: bool(raw.enabled),
    standard_rate: num(raw.standard_rate, 5),
    own_client_rate: num(raw.own_client_rate, 10),
    payment_method: String(raw.payment_method ?? 'payroll') as CommissionPaymentMethod,
    totals: {
      forecast: num(totals.forecast),
      to_pay: num(totals.to_pay),
      paid: num(totals.paid),
      to_offset: num(totals.to_offset),
    },
    commissions: arr<Record<string, unknown>>(raw.commissions).map(row => ({
      id: String(row.id ?? ''),
      event_id: String(row.event_id ?? ''),
      event_name: text(row.event_name) ?? 'Wydarzenie',
      event_date: text(row.event_date),
      event_status: text(row.event_status),
      entry_kind: (row.entry_kind === 'correction' || row.entry_kind === 'deduction' ? row.entry_kind : 'accrual') as CommissionEntryKind,
      corrects_commission_id: text(row.corrects_commission_id),
      status: String(row.status ?? 'planned') as CommissionStatus,
      amount: num(row.amount),
      base_amount: numOrNull(row.base_amount),
      rate: numOrNull(row.rate),
      rate_reason: text(row.rate_reason),
      share_percent: numOrNull(row.share_percent),
      client_owned: typeof row.client_owned === 'boolean' ? row.client_owned : null,
      base_description: text(row.base_description),
      payment_method: String(row.payment_method ?? 'payroll') as CommissionPaymentMethod,
      automatic: bool(row.automatic),
      paid_amount: num(row.paid_amount),
      offset_amount: num(row.offset_amount),
      remaining_amount: num(row.remaining_amount),
      settlement_status: (row.settlement_status === 'submitted' || row.settlement_status === 'approved'
        ? row.settlement_status
        : 'draft') as SettlementStatus,
      settlement_revision: numOrNull(row.settlement_revision),
      created_at: text(row.created_at),
      updated_at: text(row.updated_at),
      payments: arr<Record<string, unknown>>(row.payments).map(payment => ({
        amount: num(payment.amount),
        payment_date: text(payment.payment_date),
        reference: text(payment.reference),
        is_offset: bool(payment.is_offset),
      })),
    })),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Etykiety i formatowanie
// ---------------------------------------------------------------------------------------------------------------

export const SETTLEMENT_STATUS_LABELS: Record<SettlementStatus, string> = {
  draft: 'Wersja robocza',
  submitted: 'Czeka na zatwierdzenie',
  approved: 'Zatwierdzone',
};

export const SETTLEMENT_CATEGORY_LABELS: Record<SettlementCategory, string> = {
  revenue: 'Przychód',
  subcontractor: 'Wykonawca zewnętrzny',
  direct_cost: 'Koszt bezpośredni',
  team: 'Ekipa',
  external_commission: 'Prowizja / narzut sprzedawcy',
};

/** Krótki opis wpływu kategorii na prowizje (podpowiedź przy wyborze). */
export const SETTLEMENT_CATEGORY_HINTS: Record<SettlementCategory, string> = {
  revenue: 'Liczy się do przychodu netto.',
  subcontractor: 'Zespoły, atrakcje, podwykonawcy, na których nie mamy marży — pomniejsza podstawę prowizji sprzedawców zewnętrznych i zysk.',
  direct_cost: 'Wynajem, zakupy, transport, materiały — pomniejsza zysk (prowizja pracownika).',
  team: 'Wynagrodzenie ekipy za to wydarzenie — pomniejsza zysk.',
  external_commission: 'Prowizja lub narzut sprzedawcy zewnętrznego — pomniejsza zysk.',
};

export const SETTLEMENT_SOURCE_LABELS: Record<SettlementSourceType, string> = {
  manual: 'Dopisane ręcznie',
  invoice: 'Faktura sprzedaży',
  offer: 'Oferta (prognoza)',
  cash: 'Gotówka',
  forecast: 'Prognoza',
  event_cost: 'Koszt wydarzenia',
  subcontractor_task: 'Zlecenie podwykonawcy',
  team: 'Ewidencja czasu',
  markup: 'Narzut sprzedawcy',
  commission: 'Prowizja wpisana ręcznie',
};

export const SETTLEMENT_VERSION_ACTION_LABELS: Record<SettlementVersion['action'], string> = {
  submitted: 'Wysłane do zatwierdzenia',
  returned: 'Zwrócone do poprawy',
  approved: 'Zatwierdzone',
  reopened: 'Otwarte ponownie',
};

export const COMMISSION_STATUS_LABELS: Record<CommissionStatus, string> = {
  planned: 'Prognoza',
  approved: 'Do wypłaty',
  paid: 'Wypłacona',
  cancelled: 'Anulowana',
};

export const COMMISSION_ENTRY_KIND_LABELS: Record<CommissionEntryKind, string> = {
  accrual: 'Naliczenie',
  correction: 'Dopłata',
  deduction: 'Do potrącenia',
};

export const COMMISSION_PAYMENT_LABELS: Record<CommissionPaymentMethod, string> = {
  cash_dividend: 'Gotówka z zysku spółki',
  invoice: 'Faktura / rachunek',
  payroll: 'Wynagrodzenie pracownicze',
  other: 'Inny sposób',
};

export const COMMISSION_SOURCE_LABELS: Record<string, string> = {
  sales_share: 'Sprzedawca wydarzenia',
  seller_portal: 'Oferta z portalu sprzedawcy',
  event_referral: 'Polecenie',
  billing_contact: 'Kontakt rozliczeniowy (hotel / agencja)',
  partner_arrangement: 'Pośrednik (Ustalenia ze sprzedawcą)',
  manual_partner: 'Dodany do wydarzenia',
};

export const SALES_SHARE_SOURCE_LABELS: Record<string, string> = {
  offer_author: 'Autor zaakceptowanej oferty',
  seller_portal_owner: 'Opiekun sprzedawcy z portalu',
  inquiry_owner: 'Prowadzący zapytanie',
  event_creator: 'Twórca wydarzenia',
  manual: 'Ustawione przez administratora',
};

/** „12 345,60 zł” (z minusem typograficznym dla wartości ujemnych). */
export function formatPln(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const rounded = Math.round(value * 100) / 100;
  const abs = Math.abs(rounded);
  const [whole, fraction] = abs.toFixed(2).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${rounded < 0 ? '−' : ''}${grouped},${fraction} zł`;
}

/** „5%”, „12,5%”. */
export function formatPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const rounded = Math.round(value * 100) / 100;
  return `${String(rounded).replace('.', ',')}%`;
}

export function settlementLineCanEdit(line: SettlementLine, field: SettlementEditableField): boolean {
  return line.editable.includes(field);
}

/** Pozycje według sekcji tabeli: przychody, wykonawcy zewnętrzni, koszty bezpośrednie, ekipa, prowizje. */
export const SETTLEMENT_SECTIONS: { id: SettlementCategory; label: string }[] = [
  { id: 'revenue', label: 'Przychody netto' },
  { id: 'subcontractor', label: 'Wykonawcy zewnętrzni' },
  { id: 'direct_cost', label: 'Koszty bezpośrednie' },
  { id: 'team', label: 'Ekipa' },
  { id: 'external_commission', label: 'Prowizje i narzuty sprzedawców zewnętrznych' },
];

export function settlementLinesBySection(lines: SettlementLine[]): { id: SettlementCategory; label: string; lines: SettlementLine[] }[] {
  return SETTLEMENT_SECTIONS.map(section => ({
    ...section,
    lines: lines.filter(line => (section.id === 'revenue' ? line.kind === 'revenue' : line.kind === 'cost' && line.category === section.id)),
  }));
}

/**
 * Wiersze wyniku podsumowania — ta sama kolejność i nazwy w CRM i w aplikacji (docs/event-commissions.md).
 * Kilka pól w `keys` = suma pól zwróconych przez bazę (prowizje zewnętrzne: pozycje + naliczone).
 */
export const SETTLEMENT_TOTAL_ROWS: { label: string; keys: (keyof SettlementTotals)[]; strong?: boolean }[] = [
  { label: 'Przychód netto', keys: ['revenue_net'] },
  { label: 'Wykonawcy zewnętrzni', keys: ['subcontractor_net'] },
  { label: 'Koszty bezpośrednie', keys: ['direct_cost_net'] },
  { label: 'Ekipa', keys: ['team_net'] },
  { label: 'Prowizje i narzuty zewnętrzne', keys: ['external_commission_lines', 'external_commission_auto'] },
  { label: 'Zysk netto', keys: ['profit_net'], strong: true },
  { label: 'Podstawa prowizji sprzedawców zewnętrznych', keys: ['partner_base'] },
  { label: 'Prowizje pracowników (koszt firmy)', keys: ['internal_commissions_cost'] },
  { label: 'Zysk po prowizjach', keys: ['profit_after_commissions'], strong: true },
];

export function settlementTotalValue(totals: SettlementTotals, keys: (keyof SettlementTotals)[]): number {
  return Math.round(keys.reduce((sum, key) => sum + (totals[key] ?? 0), 0) * 100) / 100;
}

/** Opis prowizji pracownika: „10% od 9 648,15 zł (klient własny: Firma X)”. */
export function internalCommissionLabel(item: SettlementInternalCommission): string {
  const share = item.share_percent !== 100 ? ` · udział ${formatPercent(item.share_percent)}` : '';
  return `${formatPercent(item.rate)} od ${formatPln(item.base)}${share}`;
}
