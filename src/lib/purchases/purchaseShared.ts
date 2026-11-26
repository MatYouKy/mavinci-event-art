/*
 * Zakupy → „Moje wydatki” (`docs/purchases.md`) — typy i pomocnicze funkcje wspólne dla CRM, serwera i aplikacji mobilnej
 * (kopia: `mobile/src/lib/purchaseShared.ts`, pilnuje jej `scripts/ci/check-shared-copies.mjs`). Bez importów — plik musi
 * działać w przeglądarce, na serwerze i w React Native.
 */

export type PurchaseKind = 'invoice' | 'receipt' | 'other';
export type PurchaseMethod = 'Karta' | 'Gotówka' | 'BLIK' | 'Przelew';
export type PurchaseSettlementStatus = 'open' | 'submitted' | 'approved' | 'returned';

export const PURCHASE_KINDS: Array<{ value: PurchaseKind; label: string }> = [
  { value: 'receipt', label: 'Paragon' },
  { value: 'invoice', label: 'Faktura' },
  { value: 'other', label: 'Inny dowód zakupu' },
];

export const PURCHASE_METHODS: Array<{ value: PurchaseMethod; label: string }> = [
  { value: 'Karta', label: 'Karta firmowa' },
  { value: 'Gotówka', label: 'Gotówka' },
  { value: 'BLIK', label: 'BLIK' },
  { value: 'Przelew', label: 'Przelew — faktura do zapłaty przez firmę' },
];

export const PURCHASE_STATUS_LABELS: Record<PurchaseSettlementStatus, string> = {
  open: 'Otwarte',
  submitted: 'Wysłane do zatwierdzenia',
  approved: 'Zatwierdzone',
  returned: 'Do poprawy',
};

/** Kolory stanów rozliczenia (jak w CRM, na Macu i w telefonie). */
export const PURCHASE_STATUS_COLORS: Record<PurchaseSettlementStatus, string> = {
  open: '#9ca3af',
  submitted: '#7dd3fc',
  approved: '#34d399',
  returned: '#f59e0b',
};

export const PURCHASE_COST_STATUS_LABELS: Record<string, string> = {
  pending: 'czeka na rozliczenie',
  approved: 'zatwierdzony',
  paid: 'opłacony',
  rejected: 'odrzucony',
};

export const PURCHASE_MONTHS = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień',
  'październik', 'listopad', 'grudzień'];

/** Najwięcej stron (zdjęć) jednego dokumentu z aparatu — serwer składa z nich PDF. */
export const PURCHASE_MAX_PAGES = 10;
/** Największy plik dokumentu (PDF albo zdjęcie) i strona zdjęcia. */
export const PURCHASE_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const PURCHASE_MAX_PAGE_BYTES = 15 * 1024 * 1024;

export interface PurchaseCompanyRef {
  id: string;
  name: string;
}

export interface PurchaseAccess {
  employee_id: string | null;
  record: boolean;
  approve: boolean;
  record_companies: PurchaseCompanyRef[];
  approve_companies: PurchaseCompanyRef[];
}

export interface PurchaseEventLink {
  id: string;
  name: string;
  date: string | null;
  cost_id: string;
  amount: number;
  category_id: string | null;
  category_name: string | null;
  status: string | null;
}

export interface PurchaseDocument {
  id: string;
  company_id: string;
  company_name: string | null;
  kind: string;
  seller_name: string;
  seller_nip: string | null;
  number: string;
  date: string;
  label: string | null;
  net: number | null;
  gross: number | null;
  currency: string;
  payment_method: string | null;
  payment_status: string;
  category_id: string | null;
  category_name: string | null;
  notes: string | null;
  has_file: boolean;
  bank_matched: boolean;
  created_at: string;
  updated_at: string;
  event: PurchaseEventLink | null;
}

export interface PurchaseSettlement {
  id: string;
  status: Exclude<PurchaseSettlementStatus, 'open'>;
  employee_note: string | null;
  decision_note: string | null;
  document_count: number;
  totals: Record<string, number>;
  submitted_at: string | null;
  decided_at: string | null;
  decided_by_name: string | null;
}

export interface PurchaseMonthCompany {
  id: string;
  name: string;
  can_record: boolean;
  can_approve: boolean;
  settlement: PurchaseSettlement | null;
}

export interface PurchasePendingMonth {
  year: number;
  month: number;
  company_id: string;
  count: number;
  status: PurchaseSettlementStatus;
}

export interface PurchaseMonth {
  employee: { id: string; name: string };
  self: boolean;
  year: number;
  month: number;
  companies: PurchaseMonthCompany[];
  documents: PurchaseDocument[];
  pending_months: PurchasePendingMonth[];
}

export interface PurchaseCategories {
  finance: Array<{ id: string; name: string; code: string }>;
  event: Array<{ id: string; name: string }>;
}

export interface PurchaseState {
  access: PurchaseAccess;
  month: PurchaseMonth | null;
  categories: PurchaseCategories;
}

export interface PurchaseEventOption {
  id: string;
  name: string;
  date: string | null;
  end_date: string | null;
  status: string;
  location: string | null;
}

export interface PurchaseEventCost {
  id: string;
  name: string;
  category_name: string | null;
  amount: number;
  currency: string;
  date: string;
  status: string | null;
  from_purchase: boolean;
  created_by_name: string | null;
  mine: boolean;
  document: string | null;
}

export interface PurchaseEventCosts {
  event: { id: string; name: string; date: string | null; status: string };
  settlement_open: boolean;
  costs: PurchaseEventCost[];
  total: number;
}

export interface PurchaseReviewRow {
  employee_id: string;
  employee_name: string | null;
  company_id: string;
  company_name: string;
  year: number;
  month: number;
  status: PurchaseSettlementStatus;
  settlement_id: string | null;
  documents: number;
  document_count: number | null;
  totals: Record<string, number> | null;
  submitted_at: string | null;
  decided_at: string | null;
  decision_note: string | null;
  employee_note: string | null;
  last_change: string | null;
}

/** Odczyt dokumentu przez AI (pola do sprawdzenia przed zapisem). */
export interface PurchaseReading {
  kind: string;
  fields: {
    seller_name: string | null;
    seller_nip: string | null;
    invoice_number: string | null;
    invoice_date: string | null;
    label: string | null;
    payment_method: string | null;
    amount_net: number | null;
    amount_gross: number | null;
    currency: string | null;
  };
  buyer_name: string | null;
  buyer_nip: string | null;
  amount_vat: number | null;
  warnings: string[];
}

/** Plik zapisany na serwerze (czeka na zapis dokumentu) i jego odczyt. */
export interface PurchaseUpload {
  file: { path: string; mime: string; size: number; pages: number };
  reading: PurchaseReading | null;
  readingError: string | null;
}

/** Dane formularza zakupu (to samo wysyła CRM, Mac i telefon). */
export interface PurchaseDraft {
  company_id: string;
  kind: PurchaseKind;
  seller_name: string;
  seller_nip: string;
  number: string;
  date: string;
  label: string;
  net: string;
  gross: string;
  currency: string;
  payment_method: PurchaseMethod;
  category_id: string;
  notes: string;
  event_id: string;
  event_amount: string;
  event_category_id: string;
}

/** Dzisiejsza data w Polsce (rrrr-mm-dd). */
export function purchaseToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Bieżący miesiąc w Polsce. */
export function purchaseCurrentMonth(now = new Date()) {
  const [year, month] = purchaseToday(now).split('-').map(Number);
  return { year, month };
}

export function purchaseShiftMonth(year: number, month: number, delta: number) {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export const purchaseMonthLabel = (year: number, month: number) => `${PURCHASE_MONTHS[month - 1] || ''} ${year}`;

/** „12.11.2026” z „2026-11-12”; znacznik czasu (wysłanie, decyzja, termin eventu) — dzień w Polsce. */
export function purchaseDay(value: string | null | undefined) {
  if (!value) return '—';
  const instant = value.length > 10 && value.includes('T') ? new Date(value) : null;
  const text = instant && !Number.isNaN(instant.getTime()) ? purchaseToday(instant) : value.slice(0, 10);
  const [year, month, day] = text.split('-');
  return year && month && day ? `${day}.${month}.${year}` : value;
}

/** „1 234,50 zł” / „12,00 EUR”. */
export function purchaseMoney(value: number | null | undefined, currency = 'PLN') {
  const amount = Number(value || 0);
  const fixed = Math.abs(amount).toFixed(2);
  const [whole, cents] = fixed.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${amount < 0 ? '−' : ''}${grouped},${cents} ${!currency || currency === 'PLN' ? 'zł' : currency}`;
}

/** Sumy brutto według waluty: „123,45 zł · 10,00 EUR”. */
export function purchaseTotalsText(totals: Record<string, number> | null | undefined) {
  const entries = Object.entries(totals || {}).filter(([, value]) => Number(value) !== 0);
  if (!entries.length) return purchaseMoney(0);
  return entries.sort(([a], [b]) => (a === 'PLN' ? -1 : b === 'PLN' ? 1 : a.localeCompare(b)))
    .map(([currency, value]) => purchaseMoney(Number(value), currency)).join(' · ');
}

/** Sumy dokumentów według waluty. */
export function purchaseTotals(documents: Array<{ gross: number | null; currency: string }>) {
  const totals: Record<string, number> = {};
  for (const document of documents) {
    const currency = document.currency || 'PLN';
    totals[currency] = Math.round(((totals[currency] || 0) + Number(document.gross || 0)) * 100) / 100;
  }
  return totals;
}

export const purchaseKindLabel = (kind: string) => PURCHASE_KINDS.find((item) => item.value === kind)?.label
  || (kind === 'credit_note' ? 'Korekta' : 'Dokument');

export const purchaseMethodLabel = (method: string | null | undefined) =>
  PURCHASE_METHODS.find((item) => item.value === method)?.label || method || '—';

/** Stan rozliczenia miesiąca działalności. */
export const purchaseSettlementStatus = (company: PurchaseMonthCompany | null | undefined): PurchaseSettlementStatus =>
  company?.settlement?.status || 'open';

/** Dokumenty miesiąca można zmieniać (rozliczenie otwarte albo zwrócone). */
export const purchaseMonthEditable = (status: PurchaseSettlementStatus) => status === 'open' || status === 'returned';

/** Liczba z pola („1 234,56” → 1234.56); puste albo błędne — null. */
export function purchaseNumber(text: string | number | null | undefined) {
  if (typeof text === 'number') return Number.isFinite(text) ? text : null;
  const clean = String(text ?? '').replace(/[\s ]/g, '').replace(',', '.');
  if (!clean) return null;
  const value = Number(clean);
  return Number.isFinite(value) ? value : null;
}

/** Kwota do pola edycji („1234,50”). */
export function purchaseAmountText(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '';
  return Number(value).toFixed(2).replace('.', ',');
}

const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Kategoria kosztu eventu podpowiadana z kategorii kosztów firmy (ta sama nazwa; zakup sprzętu i reszta — Materiały / Inne). */
export function purchaseEventCategoryFor(financeCategoryName: string | null | undefined, eventCategories: Array<{ id: string; name: string }>) {
  const byName = (name: string) => eventCategories.find((category) => fold(category.name) === fold(name))?.id || '';
  const name = fold(financeCategoryName || '');
  if (name) {
    const same = eventCategories.find((category) => fold(category.name) === name || name.startsWith(fold(category.name)));
    if (same) return same.id;
    if (name.includes('transport')) return byName('Transport');
    if (name.includes('noclegi')) return byName('Noclegi');
  }
  return byName('Materiały') || byName('Inne') || '';
}

/** Pusty formularz zakupu (działalność domyślna, dziś, karta firmowa). */
export function purchaseEmptyDraft(companyId: string, today = purchaseToday()): PurchaseDraft {
  return {
    company_id: companyId, kind: 'receipt', seller_name: '', seller_nip: '', number: '', date: today, label: '', net: '', gross: '',
    currency: 'PLN', payment_method: 'Karta', category_id: '', notes: '', event_id: '', event_amount: '', event_category_id: '',
  };
}

/** Formularz z zapisanego dokumentu. */
export function purchaseDraftFrom(document: PurchaseDocument): PurchaseDraft {
  const kind = (['invoice', 'receipt', 'other'] as string[]).includes(document.kind) ? document.kind as PurchaseKind : 'other';
  const method = (PURCHASE_METHODS.map((item) => item.value) as string[]).includes(document.payment_method || '')
    ? document.payment_method as PurchaseMethod : 'Karta';
  return {
    company_id: document.company_id, kind, seller_name: document.seller_name || '', seller_nip: document.seller_nip || '',
    number: document.number || '', date: document.date?.slice(0, 10) || purchaseToday(), label: document.label || '',
    net: purchaseAmountText(document.net), gross: purchaseAmountText(document.gross), currency: document.currency || 'PLN',
    payment_method: method, category_id: document.category_id || '', notes: document.notes || '',
    event_id: document.event?.id || '', event_amount: purchaseAmountText(document.event?.amount ?? null),
    event_category_id: document.event?.category_id || '',
  };
}

/** Formularz uzupełniony odczytem AI (tylko odczytane pola; reszta bez zmian). */
export function purchaseDraftWithReading(draft: PurchaseDraft, reading: PurchaseReading | null): PurchaseDraft {
  if (!reading) return draft;
  const f = reading.fields;
  const kind: PurchaseKind = reading.kind === 'invoice' ? 'invoice' : reading.kind === 'receipt' ? 'receipt' : reading.kind ? 'other' : draft.kind;
  const method = f.payment_method && (PURCHASE_METHODS.map((item) => item.value) as string[]).includes(f.payment_method)
    ? f.payment_method as PurchaseMethod : draft.payment_method;
  const date = f.invoice_date && f.invoice_date <= purchaseToday() ? f.invoice_date : draft.date;
  return {
    ...draft,
    kind,
    seller_name: f.seller_name || draft.seller_name,
    seller_nip: f.seller_nip || draft.seller_nip,
    number: f.invoice_number || draft.number,
    date,
    label: f.label || draft.label,
    net: f.amount_net !== null && f.amount_net > 0 ? purchaseAmountText(f.amount_net) : draft.net,
    gross: f.amount_gross !== null && f.amount_gross > 0 ? purchaseAmountText(f.amount_gross) : draft.gross,
    currency: f.currency || draft.currency,
    payment_method: method,
  };
}

/** Dane do zapisu (`purchase_save`); `filePath` — nowy plik z serwera (bez — plik bez zmian). */
export function purchasePayload(draft: PurchaseDraft, filePath?: string | null) {
  const eventId = draft.event_id.trim();
  return {
    company_id: draft.company_id,
    kind: draft.kind,
    seller_name: draft.seller_name.trim(),
    seller_nip: draft.seller_nip.trim(),
    number: draft.number.trim(),
    date: draft.date,
    label: draft.label.trim(),
    net: purchaseNumber(draft.net),
    gross: purchaseNumber(draft.gross),
    currency: (draft.currency || 'PLN').trim().toUpperCase(),
    payment_method: draft.payment_method,
    category_id: draft.category_id || null,
    notes: draft.notes.trim(),
    event_id: eventId || null,
    event_amount: eventId ? purchaseNumber(draft.event_amount) : null,
    event_category_id: eventId ? draft.event_category_id || null : null,
    ...(filePath ? { file_path: filePath } : {}),
  };
}

/** Błędy formularza przed wysłaniem (to samo sprawdza baza). */
export function purchaseDraftErrors(draft: PurchaseDraft, today = purchaseToday()) {
  const errors: string[] = [];
  const gross = purchaseNumber(draft.gross);
  const net = purchaseNumber(draft.net);
  if (!draft.company_id) errors.push('Wybierz działalność.');
  if (!draft.seller_name.trim()) errors.push('Podaj sprzedawcę.');
  if (!draft.number.trim()) errors.push('Podaj numer dokumentu (faktury albo paragonu).');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date) || draft.date > today) errors.push('Data zakupu nie może być pusta ani z przyszłości.');
  if (gross === null || gross <= 0) errors.push('Podaj kwotę brutto większą od zera.');
  if (net !== null && (net <= 0 || (gross !== null && net > gross))) errors.push('Kwota netto musi być dodatnia i nie większa niż brutto.');
  if (!/^[A-Za-z]{3}$/.test(draft.currency.trim())) errors.push('Waluta to trzyliterowy kod, np. PLN.');
  if (draft.event_id) {
    const part = purchaseNumber(draft.event_amount);
    if (draft.currency.trim().toUpperCase() !== 'PLN') errors.push('Do eventu można przypisać zakup w PLN.');
    if (part !== null && (part <= 0 || (gross !== null && part > gross))) errors.push('Kwota dla eventu musi być większa od zera i nie większa niż brutto.');
  }
  return errors;
}

/** Komunikat błędu z odpowiedzi serwera albo wyjątku. */
export function purchaseErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === 'object' && 'message' in error && typeof (error as { message?: unknown }).message === 'string') {
    const message = (error as { message: string }).message.trim();
    if (message) return message;
  }
  return fallback;
}
