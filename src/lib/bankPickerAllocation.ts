/**
 * Okno „Dopasuj dokument do płatności” — ile płatność rozliczy w dokumencie i czy dokument przyjmie jeszcze przelew.
 * Wspólne dla CRM (`BankTransactionDocumentPickerModal`) i Maca (`/bridge/native/v1/finance/bank`, `financeBank.ts`).
 *
 * Od migracji 20261202180000 (docs/bank-reconciliation.md, sekcja 17) baza podaje przy dokumencie, ile jego kwoty
 * potwierdzają już przelewy z wyciągu (`bank_matched_amount`) i ile oznaczono ręcznie (`manual_paid_amount`). Dokument
 * z częściowym powiązaniem przyjmuje wtedy kolejną płatność (np. drugą ratę), a ręczne oznaczenie zapłaty ustępuje przelewowi.
 * Bez tych kolumn (baza przed migracją) — zachowanie jak dotąd.
 */

export type PickerAllocationDocument = {
  document_source: string;
  gross_amount: number | string;
  outstanding_amount: number | string;
  currency: string | null;
  payment_status: string | null;
  is_matched: boolean;
  is_matchable: boolean;
  bank_matched_amount?: number | string | null;
  manual_paid_amount?: number | string | null;
};

const absolute = (value: unknown) => Math.abs(Number(value || 0));

/** Baza podaje część potwierdzoną przelewami (migracja 20261202180000). */
export const pickerKnowsBankPart = (document: PickerAllocationDocument) =>
  document.bank_matched_amount !== undefined && document.bank_matched_amount !== null;

/** Część dokumentu potwierdzona przelewami z wyciągu (0, gdy baza tego nie podaje). */
export const pickerBankMatched = (document: PickerAllocationDocument) =>
  pickerKnowsBankPart(document) ? absolute(document.bank_matched_amount) : 0;

/** Część oznaczona ręcznie jako zapłacona, której nie potwierdza wyciąg (0, gdy baza tego nie podaje). */
export const pickerManualPaid = (document: PickerAllocationDocument) => absolute(document.manual_paid_amount);

/** Ile kwoty dokumentu może jeszcze rozliczyć przelew: nie potwierdzona wyciągiem (dawniej: do zapłaty albo całość). */
export function pickerBankOpen(document: PickerAllocationDocument) {
  const gross = absolute(document.gross_amount);
  if (pickerKnowsBankPart(document)) return Math.max(gross - pickerBankMatched(document), 0);
  const outstanding = absolute(document.outstanding_amount);
  return outstanding > 0.009 ? outstanding : gross;
}

/** Stan „opłacona” na liście: w całości powiązana z wyciągiem, zapłacona albo oznaczona jako opłacona. */
export function pickerIsPaid(document: PickerAllocationDocument) {
  const status = String(document.payment_status || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  return (document.is_matched && !document.is_matchable)
    || Number(document.outstanding_amount || 0) <= 0.009
    || ['paid', 'oplacona', 'zaplacona', 'settled', 'matched'].includes(status);
}

export function pickerIsPartiallyPaid(document: PickerAllocationDocument) {
  return String(document.payment_status || '').toLowerCase() === 'partially_paid'
    && Number(document.outstanding_amount || 0) > 0.009;
}

/**
 * Ile ta płatność rozliczy w dokumencie. Mniej niż brakuje = płatność częściowa (np. rata): dokument czeka na kolejny
 * przelew, a uzgodnienie proponuje płatność na brakującą kwotę.
 */
export function pickerPlannedAllocation(document: PickerAllocationDocument, remaining: number, transactionCurrency: string | null) {
  const gross = absolute(document.gross_amount);
  const documentAmount = pickerBankOpen(document);
  const sameCurrency = String(document.currency || 'PLN').toUpperCase() === String(transactionCurrency || 'PLN').toUpperCase();
  const amount = document.document_source === 'personnel'
    ? gross
    : sameCurrency ? Math.min(remaining, documentAmount) : remaining;
  const partial = document.document_source !== 'personnel' && sameCurrency
    && (pickerKnowsBankPart(document) || !pickerIsPaid(document))
    && amount > 0.009 && documentAmount - amount > 0.009;
  return { amount, documentAmount, sameCurrency, partial, left: Math.max(documentAmount - amount, 0) };
}

/** Powód blokady dokumentu już w całości powiązanego (albo — w starej bazie — mającego jakiekolwiek powiązanie). */
export function pickerMatchedBlockingReason(document: PickerAllocationDocument): string | null {
  if (!document.is_matched || document.is_matchable) return null;
  if (document.document_source === 'personnel') return 'Ta wypłata jest już powiązana z przelewem.';
  return pickerKnowsBankPart(document)
    ? 'Dokument jest już w całości potwierdzony płatnościami z wyciągu.'
    : 'Dokument ma już zapisane powiązanie z płatnością. Sprawdź je przed kolejnym dopasowaniem.';
}
