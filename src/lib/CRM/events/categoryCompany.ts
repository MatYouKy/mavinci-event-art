/*
 * Domyślna marka realizująca kategorii eventu (migracja `20261129100000_season_price_lists.sql`):
 * `event_categories.default_my_company_id` i `company_locked` (marka obowiązkowa, np. Wesele → Event Rulers).
 * Podkategoria bez własnej marki dziedziczy markę kategorii nadrzędnej. Baza i tak ustawia markę obowiązkową przy zapisie
 * nowego eventu (wyzwalacz `a_event_category_company`); formularze pokazują ją od razu po wyborze kategorii.
 * Przed migracją kolumn nie ma — reguły nie ma, formularze działają jak dotąd.
 */

export type EventCategoryCompanyRow = {
  id: string;
  name?: string | null;
  parent_category_id?: string | null;
  default_my_company_id?: string | null;
  company_locked?: boolean | null;
};

export type CategoryCompanyRule = {
  companyId: string;
  /** Marka obowiązkowa — nowy event tej kategorii zawsze ją dostaje. */
  locked: boolean;
  categoryName: string;
};

export function categoryCompanyRule(
  rows: readonly EventCategoryCompanyRow[],
  categoryId: string | null | undefined,
): CategoryCompanyRule | null {
  if (!categoryId) return null;
  const row = rows.find((category) => category.id === categoryId);
  if (!row) return null;
  if (row.default_my_company_id) {
    return { companyId: row.default_my_company_id, locked: row.company_locked === true, categoryName: row.name || '' };
  }
  const parent = row.parent_category_id ? rows.find((category) => category.id === row.parent_category_id) : null;
  if (parent?.default_my_company_id) {
    return { companyId: parent.default_my_company_id, locked: parent.company_locked === true, categoryName: row.name || parent.name || '' };
  }
  return null;
}

export function categoryCompanyHint(rule: CategoryCompanyRule, companyName: string | null | undefined): string {
  const company = companyName || 'przypisana marka';
  return rule.locked
    ? `Eventy z kategorii „${rule.categoryName}” zawsze realizuje ${company} — ta marka zostanie zapisana.`
    : `Domyślna marka kategorii „${rule.categoryName}”: ${company}.`;
}
