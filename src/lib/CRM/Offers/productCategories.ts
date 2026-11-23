/*
 * Kategorie eventów produktu: główna (`offer_products.category_id`) i dodatkowe (`extra_category_ids`, migracja
 * `20261129120000_product_extra_categories.sql`) — ten sam produkt (cena, zdjęcia, sprzęt, obsada, strona PDF) pokazuje się
 * w kilku kategoriach (np. Fotolustro w „Wesele” i „EVENT”) zamiast kopii. Filtry katalogu, kreatora oferty i cenników
 * pytają o produkt przez `productInCategory`. Bez migracji pole nie istnieje — zostaje sama kategoria główna.
 */

export type ProductCategoryFields = { category_id?: string | null; extra_category_ids?: unknown };

/** Kategoria główna i dodatkowe, bez powtórzeń. */
export function productCategoryIds(product: ProductCategoryFields): string[] {
  const extra = Array.isArray(product.extra_category_ids) ? product.extra_category_ids.map((id) => String(id || '')) : [];
  return Array.from(new Set([product.category_id ? String(product.category_id) : '', ...extra].filter(Boolean)));
}

/** Czy produkt należy do kategorii (główna albo dodatkowa). */
export function productInCategory(product: ProductCategoryFields, categoryId: string): boolean {
  return productCategoryIds(product).includes(categoryId);
}

/** Czy baza ma już kategorie dodatkowe (kolumna przyszła w wierszu produktu). */
export const supportsExtraCategories = (product: object | null | undefined) => Boolean(product) && 'extra_category_ids' in (product as object);
