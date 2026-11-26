/*
 * Operacja z wyciągu z datą spoza miesiąca wyciągu: bank księguje ją później niż data operacji (np. płatność kartą 29.09,
 * zaksięgowana 01.10 — jest na wyciągu za październik, a nie wrzesień). Należy do miesiąca wyciągu — tam się ją rozlicza
 * i tam widzi ją księgowa — więc obok daty operacji pokazujemy datę księgowania i krótkie wyjaśnienie
 * (Przekazanie księgowej, Uzgodnienie wyciągów; `docs/bank-reconciliation.md`, sekcja 11).
 */

const MONTHS = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];

const isoDay = (value: unknown) => {
  const text = typeof value === 'string' ? value.slice(0, 10) : '';
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
};

const plDay = (value: string) => value.split('-').reverse().join('.');

/** Data księgowania, gdy operacja jest z innego miesiąca niż wyciąg (`year`, `month`), a księgowanie — z miesiąca wyciągu. */
export function bookedOutsideMonth(operationDate: unknown, postingDate: unknown, month: number, year: number): string | null {
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  const operation = isoDay(operationDate);
  const posting = isoDay(postingDate);
  if (!operation || !posting || operation.startsWith(prefix) || !posting.startsWith(prefix)) return null;
  return posting;
}

/** „Operacja z 29.09.2026 — bank zaksięgował ją 01.10.2026, dlatego jest na wyciągu za październik i tu trzeba ją rozliczyć.” */
export function bookedOutsideMonthNote(operationDate: unknown, booked: string, month: number): string {
  const operation = isoDay(operationDate);
  return `Operacja z ${operation ? plDay(operation) : 'innego miesiąca'} — bank zaksięgował ją ${plDay(booked)}, dlatego jest na wyciągu za ${MONTHS[month - 1] || 'ten miesiąc'} i tu trzeba ją rozliczyć.`;
}
