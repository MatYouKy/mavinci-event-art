import type { FinalInvoiceItemInput, SettledInvoiceRef } from './createFinalInvoice';

const round2 = (value: number) => Math.round(value * 100) / 100;

/** One calculation shared by the pre-issue preview and persisted final invoice. */
export function calculateFinalInvoice(
  items: readonly FinalInvoiceItemInput[],
  settledInvoices: readonly Pick<SettledInvoiceRef, 'total_net' | 'total_vat' | 'total_gross'>[],
) {
  const computedItems = items.map((item, index) => {
    const valueNet = round2(Number(item.quantity) * Number(item.price_net));
    const vatAmount = round2((valueNet * Number(item.vat_rate)) / 100);
    const valueGross = round2(valueNet + vatAmount);

    return {
      position_number: index + 1,
      name: item.name,
      unit: item.unit,
      quantity: Number(item.quantity),
      price_net: Number(item.price_net),
      vat_rate: Number(item.vat_rate),
      vat_code: item.vat_code ?? String(item.vat_rate),
      vat_exemption_reason: item.vat_exemption_reason?.trim() || null,
      value_net: valueNet,
      vat_amount: vatAmount,
      value_gross: valueGross,
    };
  });

  const totals = {
    net: round2(computedItems.reduce((sum, item) => sum + item.value_net, 0)),
    vat: round2(computedItems.reduce((sum, item) => sum + item.vat_amount, 0)),
    gross: round2(computedItems.reduce((sum, item) => sum + item.value_gross, 0)),
  };
  const settled = {
    net: round2(settledInvoices.reduce((sum, invoice) => sum + Number(invoice.total_net ?? 0), 0)),
    vat: round2(settledInvoices.reduce((sum, invoice) => sum + Number(invoice.total_vat ?? 0), 0)),
    gross: round2(settledInvoices.reduce((sum, invoice) => sum + Number(invoice.total_gross ?? 0), 0)),
  };
  const remaining = {
    net: round2(totals.net - settled.net),
    vat: round2(totals.vat - settled.vat),
    gross: round2(totals.gross - settled.gross),
  };

  return { items: computedItems, totals, settled, remaining };
}

export type FinalInvoiceCalculation = ReturnType<typeof calculateFinalInvoice>;
