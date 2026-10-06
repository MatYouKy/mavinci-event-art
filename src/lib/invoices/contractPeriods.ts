export type ExternalContractPeriod = {
  document_kind?: string | null;
  contract_term?: 'fixed' | 'indefinite' | null;
  contract_start_date?: string | null;
  contract_end_date?: string | null;
  invoice_date: string;
  period_month: number | null;
  period_year: number | null;
};

// Visibility only: a continuing contract never creates another invoice or payment.
export function externalObligationInMonth(row: ExternalContractPeriod, month: number, year: number): boolean {
  const period = `${year}-${String(month).padStart(2, '0')}`;
  if (row.document_kind === 'contract' && row.contract_term === 'indefinite' && row.contract_start_date) {
    return row.contract_start_date.slice(0, 7) <= period
      && (!row.contract_end_date || row.contract_end_date.slice(0, 7) >= period);
  }
  return row.period_month != null && row.period_year != null
    ? row.period_month === month && row.period_year === year
    : String(row.invoice_date || '').startsWith(period);
}
