import type { ProfileAddress } from '@/components/crm/subcontractors/profileAddress';
export type PersonnelPerson = {
  id: string; employee_id: string | null; subcontractor_id: string | null;
  name: string; surname: string; email: string | null; phone: string | null;
  address_parts?: Partial<ProfileAddress> | null;
  address: string | null; identifier: string | null; bank_account: string | null;
  notes: string | null; is_active: boolean;
};
export type PersonnelRate = {
  id: string; contract_id: string; valid_from: string; valid_to: string | null;
  pay_basis: 'hourly' | 'monthly' | 'fixed' | 'piecework'; rate_basis: 'gross' | 'net';
  unit_label?: string | null; rate: number; company_cost_rate: number | null; currency?: string;
};
export type PersonnelWork = {
  id: string; source: 'crm' | 'external'; contract_id: string; event_id: string | null;
  work_date: string; minutes: number; quantity?: number | null; description: string; rate_snapshot: PersonnelRate;
};
export type PersonnelSettlement = {
  id: string; contract_id: string; period: string; nominal_amount: number;
  rate_basis: 'gross' | 'net'; net_amount: number; company_cost: number;
  currency: string; paid_amount: number; remaining_amount: number;
  payroll_snapshot?: Record<string, any> | null; gross_amount?: number | null; minimum_amount?: number | null;
};
export const personnelInput = 'mt-1 w-full rounded-lg border border-white/10 bg-[var(--brand-burgundy-950)] px-3 py-2 text-sm text-[var(--brand-platinum)] outline-none focus:border-white/25 disabled:opacity-60';
export const personnelButton = 'rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#24101a] hover:bg-[#e5d799] disabled:opacity-50';
export const personnelSecondary = 'rounded-lg bg-white/5 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50';
export const payBasisLabels = { hourly: 'Za godzinę', monthly: 'Miesięcznie', fixed: 'Za całe zlecenie', piecework: 'Akord — za jednostkę' };
export const rateBasisLabels = { gross: 'Brutto', net: 'Netto' };
export const personName = (p: Pick<PersonnelPerson, 'name' | 'surname'>) => [p.name, p.surname].filter(Boolean).join(' ');
export const personnelMoney = (n: number, currency = 'PLN') => new Intl.NumberFormat('pl-PL', { style: 'currency', currency }).format(Number(n));
export const personnelDate = (v?: string | null) => v ? v.slice(0,10).split('-').reverse().join('.') : '—';
export const localMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; };
export const nextMonth = (month: string) => { const [y,m] = month.split('-').map(Number); return new Date(Date.UTC(y,m,1)).toISOString().slice(0,10); };
export function workAmounts(items: PersonnelWork[]) {
  const totals: Record<string, number> = {};
  for (const w of items) {
    if (!['hourly','piecework'].includes(w.rate_snapshot?.pay_basis)) continue;
    const key = `${w.rate_snapshot.currency || 'PLN'}:${w.rate_snapshot.rate_basis}`;
    totals[key] = (totals[key] || 0) + (w.rate_snapshot.pay_basis === 'piecework' ? Number(w.quantity || 0) : Number(w.minutes) / 60) * Number(w.rate_snapshot.rate);
  }
  return totals;
}
