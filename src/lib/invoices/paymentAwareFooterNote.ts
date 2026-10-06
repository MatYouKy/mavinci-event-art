type InvoicePaymentContext = {
  paymentStatus?: string | null;
  /** Amount due before direct payments; for a final invoice, after advances. */
  amountDue: number;
  paidAmount?: number | null;
  isRefund?: boolean;
};

/** Filter only the standard payment demand; preserve all other invoice notes. */
export function getPaymentAwareInvoiceFooterNote(
  note: string | null | undefined,
  { paymentStatus, amountDue, paidAmount = 0, isRefund = false }: InvoicePaymentContext,
): string {
  const original = note ?? '';
  const due = Number(amountDue);
  const paid = Number(paidAmount ?? 0);
  const remaining = Number.isFinite(due) && Number.isFinite(paid)
    ? Math.round((Math.max(due, 0) - Math.max(paid, 0)) * 100) / 100
    : null;
  const hasNoPaymentDue = paymentStatus === 'paid' || paymentStatus === 'refunded'
    || isRefund || (remaining !== null && remaining <= 0);

  if (!hasNoPaymentDue) return original;

  // Whitespace and punctuation differ between saved company defaults. Match
  // this known clause, not an entire paragraph containing unrelated remarks.
  const paymentDemand = /Niniejsza\s+faktura\s+jest\s+wezwaniem\s+do\s+zap[łl]aty\s+zgodnie\s+z\s+(?:artyku[łl]em|art\.?)\s*455(?!\d)\s*k\.?\s*c\.?\s*\.?(?:\s*Po\s+przekroczeniu\s+terminu\s+p[łl]atno[śs]ci\s+b[ęe]d[ąa]\s+naliczane\s+ustawowe\s+odsetki\s+za\s+zw[łl]ok[ęe]\s*\.?)?/gi;
  const filtered = original.replace(paymentDemand, '');
  return filtered === original ? original : filtered.trim();
}
