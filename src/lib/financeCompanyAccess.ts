/**
 * Dostęp do finansów według działalności (employees.finance_company_access, migracja 20261101165000).
 * Poziomy są uporządkowane: każdy kolejny obejmuje poprzednie. Administrator ma niejawnie
 * „finance_manage” we wszystkich działalnościach; konto portalu sprzedawcy — zawsze „none”.
 * Źródłem prawdy jest baza (RLS i funkcje finance_company_level*); te definicje służą tylko UI.
 */
export const FINANCE_COMPANY_LEVELS = [
  'none',
  'sales',
  'invoices',
  'invoices_issue',
  'finance_view',
  'finance_manage',
] as const;

export type FinanceCompanyLevel = (typeof FINANCE_COMPANY_LEVELS)[number];

export const FINANCE_COMPANY_LEVEL_OPTIONS: Array<{ value: FinanceCompanyLevel; label: string; description: string }> = [
  { value: 'none', label: 'Brak dostępu', description: 'Nie widzi żadnych finansów tej działalności.' },
  {
    value: 'sales',
    label: 'Własna sprzedaż',
    description: 'Własne faktury, oferty, prowizje sprzedawców pod opieką i raport własnej sprzedaży. Bez banku i kosztów, bez wystawiania faktur.',
  },
  {
    value: 'invoices',
    label: 'Podgląd faktur',
    description: 'Wszystkie faktury sprzedaży i kosztowe, KSeF i dokumenty zewnętrzne tej działalności. Bez banku.',
  },
  {
    value: 'invoices_issue',
    label: 'Wystawianie faktur',
    description: 'Jak podgląd faktur, plus wystawianie i edycja faktur tej działalności.',
  },
  {
    value: 'finance_view',
    label: 'Podgląd finansów',
    description: 'Wszystkie finanse tej działalności tylko do odczytu: faktury, KSeF, dokumenty kosztowe, wyciągi i operacje bankowe, uzgadnianie, deklaracje ZUS/US, zestawienia, gotówka.',
  },
  {
    value: 'finance_manage',
    label: 'Zarządzanie finansami',
    description: 'Pełne finanse tej działalności: import wyciągów, uzgadnianie, deklaracje, usuwanie z KSeF, ustawienia działalności.',
  },
];

export const isFinanceCompanyLevel = (value: unknown): value is FinanceCompanyLevel =>
  typeof value === 'string' && (FINANCE_COMPANY_LEVELS as readonly string[]).includes(value);

export const financeLevelRank = (level: unknown): number =>
  isFinanceCompanyLevel(level) ? FINANCE_COMPANY_LEVELS.indexOf(level) : 0;

export const financeLevelAtLeast = (level: unknown, required: FinanceCompanyLevel): boolean =>
  financeLevelRank(level) >= financeLevelRank(required);

/** Normalizuje zapis z bazy: tylko znane poziomy, bez wpisów „none”. */
export function normalizeFinanceCompanyAccess(raw: unknown): Record<string, FinanceCompanyLevel> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const result: Record<string, FinanceCompanyLevel> = {};
  for (const [companyId, level] of Object.entries(raw as Record<string, unknown>)) {
    if (isFinanceCompanyLevel(level) && level !== 'none') result[companyId] = level;
  }
  return result;
}

/** Czy pracownik ma w jakiejkolwiek działalności co najmniej dany poziom (pozycja „Finanse” w menu). */
export function hasAnyFinanceCompanyLevel(raw: unknown, required: FinanceCompanyLevel = 'sales'): boolean {
  return Object.values(normalizeFinanceCompanyAccess(raw)).some((level) => financeLevelAtLeast(level, required));
}
