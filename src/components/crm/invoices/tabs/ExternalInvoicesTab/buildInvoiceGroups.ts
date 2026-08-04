import { ExternalInvoice, Subscription } from './ExternalInvoicesTab';
import { InvoiceRow, cycleStepMonths } from './ExternalInvoicesTab';

export function buildInvoiceGroups(invoices: ExternalInvoice[], subscriptions: Subscription[]) {
  const map = new Map<number, Map<number, InvoiceRow[]>>();

  const add = (year: number, month: number, row: InvoiceRow) => {
    let months = map.get(year);
    if (!months) {
      months = new Map();
      map.set(year, months);
    }
    const rows = months.get(month) ?? [];
    rows.push(row);
    months.set(month, rows);
  };

  for (const inv of invoices) {
    let year: number;
    let month: number;
    if (inv.period_year && inv.period_month) {
      year = inv.period_year;
      month = inv.period_month;
    } else {
      const d = new Date(inv.invoice_date);
      year = d.getFullYear();
      month = d.getMonth() + 1;
    }
    add(year, month, { kind: 'real', invoice: inv });
  }

  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1;

  const fulfilled = new Set(
    invoices
      .filter((i) => i.subscription_id && i.period_year && i.period_month)
      .map((i) => `${i.subscription_id}:${i.period_year}:${i.period_month}`),
  );

  for (const sub of subscriptions) {
    if (sub.status === 'cancelled') continue;
    const step = cycleStepMonths(sub.billing_cycle);
    const start = new Date(sub.created_at ?? sub.next_charge_date ?? now);
    let year = start.getFullYear();
    let month = start.getMonth() + 1;
    let guard = 0;
    while ((year < curYear || (year === curYear && month <= curMonth)) && guard < 600) {
      guard++;
      const key = `${sub.id}:${year}:${month}`;
      if (!fulfilled.has(key)) {
        add(year, month, { kind: 'placeholder', subscription: sub, year, month });
      }
      month += step;
      while (month > 12) {
        month -= 12;
        year++;
      }
    }
  }

  const years = Array.from(map.keys()).sort((a, b) => b - a);
  return years.map((year) => {
    const monthsMap = map.get(year)!;
    const months = Array.from(monthsMap.keys()).sort((a, b) => b - a);
    return {
      year,
      months: months.map((month) => {
        const rows = monthsMap.get(month)!;
        rows.sort((a, b) => {
          if (a.kind !== b.kind) return a.kind === 'placeholder' ? 1 : -1;
          return 0;
        });
        const missing = rows.filter((r) => r.kind === 'placeholder').length;
        return { month, rows, missing };
      }),
    };
  });
}