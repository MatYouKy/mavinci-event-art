import { CalcItem } from '@/app/(crm)/crm/events/[id]/components/tabs/EventCalculationsTab';

export const fmt = (n: number) =>
  n.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const DEFAULT_VAT = 23;
export const round2 = (n: number) => Math.round(n * 100) / 100;
export const rowNet = (it: CalcItem) => round2(it.quantity * it.unit_price * (it.days || 1));
export const rowGross = (it: CalcItem) => round2(rowNet(it) * (1 + (it.vat_rate ?? DEFAULT_VAT) / 100));
export const rowTotal = rowNet;