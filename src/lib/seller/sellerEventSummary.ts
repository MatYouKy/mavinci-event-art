/**
 * Podsumowanie wydarzenia w portalu sprzedawcy (RPC get_seller_event_summary, migracja
 * 20261106140000_external_seller_profit_commission.sql): odczyt wyniku bazy i polskie etykiety. Niczego nie liczy.
 */

export type SellerSummarySource = 'forecast' | 'submitted' | 'approved';

export type SellerSummaryLine = {
  kind: 'revenue' | 'cost';
  category: string;
  name: string;
  net_amount: number;
  date: string | null;
  to_confirm: boolean;
};

export type SellerSummaryTotals = {
  revenue_net: number;
  subcontractor_net: number;
  direct_cost_net: number;
  team_net: number;
  external_commission_lines: number;
  profit_before_external: number;
  external_commission_auto: number;
  own_commission_cost: number;
  other_sellers_cost: number;
  profit_net: number;
  partner_base: number;
  /** Wykonawcy + koszty wydarzenia + ekipa + narzuty (przychód − zysk przed prowizjami sprzedawców). */
  event_costs_net: number;
  /** Różnica z zaokrągleń do grosza (zysk przed prowizjami − koszt prowizji − podstawa); zwykle 0. */
  rounding_difference: number;
};

export type SellerSummaryMine = {
  rate: number;
  rate_label: string;
  base: number;
  amount: number;
  company_cost: number;
  payment_method: string | null;
  dividend_tax_rate: number | null;
};

export type SellerSummaryCommission = {
  id: string;
  entry_kind: string;
  status: string;
  amount: number;
  paid_amount: number;
  offset_amount: number;
};

export type SellerEventSummary = {
  event: { id: string; name: string; date: string | null; end_date: string | null; location: string | null; cancelled: boolean };
  source: SellerSummarySource;
  as_of: string | null;
  /** 'profit' = % od zysku netto po koszcie prowizji; starsze zatwierdzone rozliczenia: przychód − wykonawcy. */
  base_rule: 'profit' | 'revenue_minus_subcontractors';
  forecast: boolean;
  lines: SellerSummaryLine[];
  totals: SellerSummaryTotals;
  mine: SellerSummaryMine | null;
  commissions: SellerSummaryCommission[];
};

const num = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
};
const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null);
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const list = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value.map(record) : []);

const TOTAL_KEYS: (keyof SellerSummaryTotals)[] = [
  'revenue_net', 'subcontractor_net', 'direct_cost_net', 'team_net', 'external_commission_lines', 'profit_before_external',
  'external_commission_auto', 'own_commission_cost', 'other_sellers_cost', 'profit_net', 'partner_base', 'event_costs_net',
  'rounding_difference',
];

export function parseSellerEventSummary(data: unknown): SellerEventSummary | null {
  const raw = record(data);
  const event = record(raw.event);
  if (typeof event.id !== 'string') return null;
  const totalsRaw = record(raw.totals);
  const totals = {} as SellerSummaryTotals;
  for (const key of TOTAL_KEYS) totals[key] = num(totalsRaw[key]);
  const mineRaw = raw.mine && typeof raw.mine === 'object' ? record(raw.mine) : null;
  return {
    event: {
      id: event.id,
      name: text(event.name) ?? 'Wydarzenie',
      date: text(event.date),
      end_date: text(event.end_date),
      location: text(event.location),
      cancelled: event.cancelled === true,
    },
    source: raw.source === 'submitted' || raw.source === 'approved' ? raw.source : 'forecast',
    as_of: text(raw.as_of),
    base_rule: raw.base_rule === 'revenue_minus_subcontractors' ? 'revenue_minus_subcontractors' : 'profit',
    forecast: raw.forecast === true,
    lines: list(raw.lines).map(line => ({
      kind: line.kind === 'revenue' ? 'revenue' : 'cost',
      category: String(line.category ?? 'direct_cost'),
      name: text(line.name) ?? 'Pozycja',
      net_amount: num(line.net_amount),
      date: text(line.date),
      to_confirm: line.to_confirm === true,
    })),
    totals,
    mine: mineRaw
      ? {
          rate: num(mineRaw.rate),
          rate_label: text(mineRaw.rate_label) ?? 'Stawka z Twoich warunków współpracy',
          base: num(mineRaw.base),
          amount: num(mineRaw.amount),
          company_cost: num(mineRaw.company_cost),
          payment_method: text(mineRaw.payment_method),
          dividend_tax_rate: mineRaw.dividend_tax_rate == null ? null : num(mineRaw.dividend_tax_rate),
        }
      : null,
    commissions: list(raw.commissions).map(row => ({
      id: String(row.id ?? ''),
      entry_kind: String(row.entry_kind ?? 'accrual'),
      status: String(row.status ?? 'planned'),
      amount: num(row.amount),
      paid_amount: num(row.paid_amount),
      offset_amount: num(row.offset_amount),
    })),
  };
}

export const SELLER_SUMMARY_SOURCE_LABELS: Record<SellerSummarySource, { label: string; detail: string }> = {
  forecast: { label: 'Prognoza', detail: 'Kwoty zmieniają się, dopóki MAVINCI nie rozliczy kosztów wydarzenia.' },
  submitted: { label: 'Wysłane do zatwierdzenia', detail: 'Rozliczenie czeka na zatwierdzenie przez MAVINCI.' },
  approved: { label: 'Zatwierdzone', detail: 'Ostateczne rozliczenie wydarzenia.' },
};

export const SELLER_SUMMARY_CATEGORY_LABELS: Record<string, string> = {
  revenue: 'Przychód',
  subcontractor: 'Wykonawca zewnętrzny',
  direct_cost: 'Koszt wydarzenia',
  team: 'Ekipa',
  external_commission: 'Prowizja / narzut',
};

export const sellerSummaryPercent = (value: number) => `${String(Math.round(value * 100) / 100).replace('.', ',')}%`;
