/*
 * „Wszystkie dokumenty” — jeden stan zapłaty dla faktur KSeF, faktur CRM i dokumentów spoza KSeF (CRM: Dokumenty i rozliczenia
 * → „Wszystkie dokumenty”, Mac: Finanse → „Wszystkie dokumenty” przez `documentRegister` w `src/lib/native/financeBank.ts`).
 * Ten sam stan i te same filtry w przeglądarce i na Macu: „Nieopłacone” obejmuje też częściowo opłacone i po terminie.
 */

export type RegisterState = 'paid' | 'partial' | 'overdue' | 'unpaid' | 'draft' | 'cancelled';
export type RegisterStateFilter = 'all' | 'open' | 'overdue' | 'paid';
export type RegisterSide = 'cost' | 'sales';

export const REGISTER_STATE_LABELS: Record<RegisterState, string> = {
  paid: 'Opłacony',
  partial: 'Częściowo opłacony',
  overdue: 'Po terminie',
  unpaid: 'Nieopłacony',
  draft: 'Szkic',
  cancelled: 'Anulowany',
};

export const REGISTER_STATE_FILTERS: Array<{ value: RegisterStateFilter; label: string }> = [
  { value: 'all', label: 'Każdy stan zapłaty' },
  { value: 'open', label: 'Nieopłacone' },
  { value: 'overdue', label: 'Po terminie' },
  { value: 'paid', label: 'Opłacone' },
];

export const REGISTER_SIDE_FILTERS: Array<{ value: 'all' | RegisterSide; label: string }> = [
  { value: 'all', label: 'Koszty i sprzedaż' },
  { value: 'cost', label: 'Kosztowe (zakup)' },
  { value: 'sales', label: 'Sprzedażowe' },
];

/** Dzisiejsza data w Polsce (`RRRR-MM-DD`) — termin płatności porównywany z polskim dniem, jak w terminach i monitach. */
export function warsawToday(now = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw' }).format(now);
}

const plain = (value: unknown) => (value === null || value === undefined ? '' : String(value));

/** Stan zapłaty z zapisanego statusu zapłaty, statusu dokumentu (szkic, anulowana) i terminu. */
export function registerState(
  paymentStatus: unknown,
  dueDate: string | null | undefined,
  today: string,
  documentStatus?: unknown,
): RegisterState {
  const status = plain(documentStatus).toLowerCase();
  if (status === 'cancelled') return 'cancelled';
  if (status === 'draft') return 'draft';
  // „Opłacona” / „Zapłacona” z polskimi znakami („ł” nie rozkłada się przy NFD) — jak „paid”.
  const payment = plain(paymentStatus).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ł/g, 'l');
  if (['paid', 'oplacona', 'zaplacona', 'settled'].includes(payment) || status === 'paid') return 'paid';
  if (payment === 'partially_paid') return 'partial';
  const due = dueDate ? dueDate.slice(0, 10) : '';
  if (payment === 'overdue' || status === 'overdue' || (due && due < today)) return 'overdue';
  return 'unpaid';
}

export function matchesRegisterState(state: RegisterState | null | undefined, filter: RegisterStateFilter) {
  if (filter === 'all') return true;
  if (!state) return false;
  if (filter === 'open') return state === 'unpaid' || state === 'partial' || state === 'overdue';
  return state === filter;
}
