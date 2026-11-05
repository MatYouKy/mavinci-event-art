import type { CommissionSettlement } from '@/lib/CRM/events/commissionSettlements';

/** Portal wording of a commission row (no CRM terms, no internal cost data). */
export type SellerCommissionTone = 'forecast' | 'payable' | 'paid' | 'deduction' | 'muted';
export const sellerCommissionToneClass: Record<SellerCommissionTone, string> = {
  forecast: 'bg-sky-300/10 text-sky-200',
  payable: 'bg-[#d3bb73]/15 text-[#d3bb73]',
  paid: 'bg-emerald-300/10 text-emerald-200',
  deduction: 'bg-rose-300/10 text-rose-200',
  muted: 'bg-white/5 text-white/50',
};

export function sellerCommissionStatus(row: CommissionSettlement): { label: string; tone: SellerCommissionTone; detail?: string } {
  if (row.entry_kind === 'deduction') {
    if (row.status === 'paid') return { label: 'Potrącona', tone: 'muted' };
    if (row.status === 'cancelled') return { label: 'Anulowana', tone: 'muted' };
    return { label: 'Do potrącenia', tone: 'deduction', detail: 'Kwota zostanie odjęta od kolejnej wypłaty.' };
  }
  if (row.status === 'cancelled') return { label: 'Anulowana', tone: 'muted' };
  if (row.status === 'paid') return { label: 'Wypłacona', tone: 'paid' };
  if (row.status === 'approved') {
    return Number(row.paid_amount) > 0
      ? { label: 'Do wypłaty', tone: 'payable', detail: 'Część kwoty została już wypłacona.' }
      : { label: 'Do wypłaty', tone: 'payable' };
  }
  return { label: 'Prognoza', tone: 'forecast', detail: row.automatic_waiting_for_offer ? 'Kwota zostanie ustalona po rozliczeniu wydarzenia.' : 'Kwota szacunkowa — ostateczna po rozliczeniu wydarzenia.' };
}

const percent = (value: number) => `${String(Math.round(value * 100) / 100).replace('.', ',')}%`;
const zloty = (value: number) => `${Number(value || 0).toLocaleString('pl-PL', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} zł`;

/** "10% od 15 000 zł" — rate and base only (the base description is never shown in the portal). */
export function sellerCommissionBasis(row: CommissionSettlement): string | null {
  if (row.entry_kind && row.entry_kind !== 'accrual' && row.entry_kind !== 'correction') return null;
  if (row.rate == null || row.base_amount == null || !(Number(row.rate) > 0)) return null;
  const share = row.share_percent != null && Number(row.share_percent) !== 100 ? ` · udział ${percent(Number(row.share_percent))}` : '';
  return `${percent(Number(row.rate))} od ${zloty(Number(row.base_amount))}${share}`;
}

export const sellerCommissionPaymentLabels: Record<string, string> = {
  cash_dividend: 'Wypłata gotówkowa',
  invoice: 'Faktura / rachunek',
  payroll: 'Lista płac',
  transfer: 'Przelew',
  other: 'Inny sposób rozliczenia',
};

export const sellerCommissionDate = (value: string | null | undefined) =>
  value ? value.slice(0, 10).split('-').reverse().join('.') : 'Data do ustalenia';

export const SELLER_FORECAST_NOTE = 'szacunek przed kosztami wykonawców zewnętrznych';
