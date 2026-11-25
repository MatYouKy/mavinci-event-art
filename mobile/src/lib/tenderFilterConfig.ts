/*
 * Konfiguracja filtrów przetargów (`tender_filter_config`) — wspólne reguły CRM (`/crm/tenders/config`), Maca
 * (`TenderFilterConfigView`) i telefonu (`TenderFilterConfigSheet`); zapis i przeliczenie ocen wykonuje serwer
 * (`/bridge/native/v1/tenders`). Kopia `mobile/src/lib/tenderFilterConfig.ts` musi być identyczna
 * (`scripts/ci/check-shared-copies.mjs`). Te same reguły list ma Mac (`TenderFilterRules` w `TenderFilterConfigView.swift`).
 */

export type TenderFilterListField = 'positive_keywords' | 'negative_keywords' | 'cpv_codes' | 'locations';

export type TenderFilterConfig = {
  id: string;
  name: string;
  positive_keywords: string[];
  negative_keywords: string[];
  cpv_codes: string[];
  locations: string[];
  sources: string[];
  min_relevance_score: number;
  notification_score_threshold: number;
  max_days_to_deadline: number;
  is_active: boolean;
  updated_at: string | null;
};

/** Pola zapisywane z formularza (źródła pobierania i daty ustawia serwer). */
export type TenderFilterInput = Pick<TenderFilterConfig,
  'name' | TenderFilterListField | 'min_relevance_score' | 'notification_score_threshold' | 'max_days_to_deadline' | 'is_active'>;

/** Stan ekranu konfiguracji: lista konfiguracji (najnowsza pierwsza) i uprawnienia pracownika. */
export type TenderConfigState = {
  configs: TenderFilterConfig[];
  /** Zmiany zapisuje administrator CRM (RLS `tender_filter_config`). */
  canEdit: boolean;
  /** Przeliczenie ocen wszystkich przetargów — administrator. */
  canRecalculate: boolean;
};

export const TENDER_FILTER_LIST_FIELDS: ReadonlyArray<{ key: TenderFilterListField; label: string; placeholder: string }> = [
  { key: 'positive_keywords', label: 'Słowa kluczowe (pozytywne)', placeholder: 'Dodaj słowo kluczowe...' },
  { key: 'negative_keywords', label: 'Słowa wykluczające', placeholder: 'Dodaj frazę wykluczającą...' },
  { key: 'cpv_codes', label: 'Kody CPV', placeholder: 'np. 79952000-2' },
  { key: 'locations', label: 'Lokalizacje', placeholder: 'np. Warszawa, małopolskie...' },
];

export const TENDER_FILTER_LIMITS = { name: 120, item: 200, items: 500 } as const;
export const TENDER_FILTER_NEW_NAME = 'Nowa konfiguracja';
export const TENDER_FILTER_DEFAULT_SOURCES = ['bzp', 'ted', 'baza_konkurencyjnosci'];
export const TENDER_FILTER_SELECT =
  'id, name, positive_keywords, negative_keywords, cpv_codes, locations, sources, min_relevance_score, notification_score_threshold, max_days_to_deadline, is_active, updated_at';

/** Rozdzielenie listy wklejonej albo wpisanej naraz: nowe linie, przecinki, średniki i kropki. */
export const splitTenderFilterValues = (value: string): string[] => value
  .split(/[\r\n,;.]+/g)
  .map((item) => item.replace(/\s+/g, ' ').trim().slice(0, TENDER_FILTER_LIMITS.item))
  .filter(Boolean);

const normalized = (value: string) => value.trim().toLowerCase();

/** Dopisuje pozycje bez powtórzeń (wielkość liter bez znaczenia); `duplicates` — czy coś pominięto jako powtórzenie. */
export function addTenderFilterValues(list: string[], input: string): { list: string[]; added: number; duplicates: boolean } {
  const seen = new Set(list.map(normalized));
  const next = [...list];
  let duplicates = false;
  for (const item of splitTenderFilterValues(input)) {
    const key = normalized(item);
    if (seen.has(key)) { duplicates = true; continue; }
    seen.add(key);
    next.push(item);
  }
  return { list: next, added: next.length - list.length, duplicates };
}

const textList = (value: unknown): string[] => (Array.isArray(value)
  ? value.map((item) => String(item ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean)
  : []);
const whole = (value: unknown, fallback: number) => {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(number) ? Math.round(number) : fallback;
};

/** Wiersz bazy (albo odpowiedź serwera) → konfiguracja z domyślnymi wartościami jak w bazie. */
export function tenderFilterConfigFromRow(row: Record<string, unknown>): TenderFilterConfig {
  const sources = textList(row.sources);
  return {
    id: String(row.id ?? ''),
    name: String(row.name ?? '').trim() || 'Konfiguracja bez nazwy',
    positive_keywords: textList(row.positive_keywords),
    negative_keywords: textList(row.negative_keywords),
    cpv_codes: textList(row.cpv_codes),
    locations: textList(row.locations),
    sources: sources.length ? sources : [...TENDER_FILTER_DEFAULT_SOURCES],
    min_relevance_score: whole(row.min_relevance_score, 30),
    notification_score_threshold: whole(row.notification_score_threshold, 70),
    max_days_to_deadline: whole(row.max_days_to_deadline, 60),
    is_active: row.is_active === true,
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : null,
  };
}

/**
 * Dane formularza → pola zapisu: przycięta nazwa, listy bez pustych pozycji i powtórzeń (zapisane pozycje nie są dzielone —
 * separatory rozdzielają tylko nowo dodawany tekst). Liczby sprawdza `validateTenderFilterInput`.
 */
export function tenderFilterInput(source: Record<string, unknown>): TenderFilterInput {
  const list = (value: unknown) => {
    const seen = new Set<string>();
    return textList(value).map((item) => item.slice(0, TENDER_FILTER_LIMITS.item)).filter((item) => {
      const key = normalized(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  return {
    name: String(source.name ?? '').replace(/\s+/g, ' ').trim(),
    positive_keywords: list(source.positive_keywords),
    negative_keywords: list(source.negative_keywords),
    cpv_codes: list(source.cpv_codes),
    locations: list(source.locations),
    min_relevance_score: whole(source.min_relevance_score, NaN),
    notification_score_threshold: whole(source.notification_score_threshold, NaN),
    max_days_to_deadline: whole(source.max_days_to_deadline, NaN),
    is_active: source.is_active === true,
  };
}

const within = (value: number, min: number, max: number) => Number.isInteger(value) && value >= min && value <= max;

/** Komunikat pierwszego błędu formularza albo `null` (te same zakresy co pola w CRM). */
export function validateTenderFilterInput(input: TenderFilterInput): string | null {
  if (!input.name) return 'Podaj nazwę konfiguracji.';
  if (input.name.length > TENDER_FILTER_LIMITS.name) return `Nazwa konfiguracji może mieć najwyżej ${TENDER_FILTER_LIMITS.name} znaków.`;
  if (!within(input.min_relevance_score, 0, 100)) return 'Minimalna ocena trafności musi być liczbą od 0 do 100.';
  if (!within(input.notification_score_threshold, 0, 100)) return '„Powiadom od oceny” musi być liczbą od 0 do 100.';
  if (!within(input.max_days_to_deadline, 1, 365)) return '„Max dni do terminu” musi być liczbą od 1 do 365.';
  for (const field of TENDER_FILTER_LIST_FIELDS) {
    if (input[field.key].length > TENDER_FILTER_LIMITS.items) {
      return `${field.label}: najwyżej ${TENDER_FILTER_LIMITS.items} pozycji.`;
    }
  }
  return null;
}

/** Czy formularz różni się od zapisanej konfiguracji. */
export function tenderFilterChanged(saved: TenderFilterConfig, draft: TenderFilterInput): boolean {
  const current = tenderFilterInput(saved as unknown as Record<string, unknown>);
  return JSON.stringify(current) !== JSON.stringify(tenderFilterInput(draft as unknown as Record<string, unknown>));
}

const plural = (count: number, one: string, few: string, many: string) => {
  const n = Math.abs(count);
  if (n === 1) return one;
  return n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many;
};

/** „Przeliczono 2793 przetargi — zmieniona ocena: 41.” */
export function tenderRecalculationMessage(checked: number, updated: number): string {
  const base = `Przeliczono ${checked} ${plural(checked, 'przetarg', 'przetargi', 'przetargów')}`;
  return updated > 0 ? `${base} — zmieniona ocena: ${updated}.` : `${base} — oceny bez zmian.`;
}
