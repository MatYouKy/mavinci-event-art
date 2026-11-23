/*
 * Edytor cennika sezonowego (CRM `PriceListsManager`, Mac przez `src/lib/native/priceLists.ts`): wiersze produktów
 * i wariantów z ceną katalogową i ceną w cenniku, zaokrąglanie i odczyt wpisanej ceny. Bez zależności od Supabase.
 *
 * Wiersz produktu („Cena bazowa”) — gdy produkt ma cenę katalogową, nie ma wariantów albo ma już cenę w cenniku; wiersze
 * wariantów — aktywne warianty. Produkty z konfiguratorem (cenę liczy kalkulator) i nieaktywne produkty / warianty pokazują
 * się tylko wtedy, gdy mają cenę w cenniku (do usunięcia albo zmiany).
 */

import { productCategoryIds } from './productCategories';

/** Pola produktów edytora cennika — z kategoriami dodatkowymi; bez migracji 20261129120000 (błąd 42703) — bez nich. */
export const PRICE_LIST_PRODUCT_SELECT = 'id, name, base_price, category_id, extra_category_ids, is_active, configuration_schema, variants:offer_product_variants(id, name, price_net, is_active, display_order)';
export const PRICE_LIST_PRODUCT_SELECT_LEGACY = 'id, name, base_price, category_id, is_active, configuration_schema, variants:offer_product_variants(id, name, price_net, is_active, display_order)';

export type PriceListCatalogVariant = {
  id: string;
  name: string;
  price_net: number | null;
  is_active?: boolean | null;
  display_order?: number | null;
};

export type PriceListCatalogProduct = {
  id: string;
  name: string;
  base_price: number | null;
  category_id?: string | null;
  /** Kategorie dodatkowe produktu (migracja 20261129120000). */
  extra_category_ids?: string[] | null;
  is_active?: boolean | null;
  configuration_schema?: unknown;
  variants?: PriceListCatalogVariant[] | null;
};

export type PriceListEntryRow = {
  id: string;
  product_id: string;
  product_variant_id: string | null;
  price_net: number;
};

export type PriceListRow = {
  /** `produkt:wariant` (wariant pusty dla ceny bazowej). */
  key: string;
  productId: string;
  variantId: string | null;
  productName: string;
  /** „Cena bazowa” albo nazwa wariantu. */
  label: string;
  categoryId: string | null;
  /** Kategoria główna i dodatkowe — filtr kategorii w edytorze cennika. */
  categoryIds: string[];
  catalogPrice: number;
  entryId: string | null;
  price: number | null;
  /** Produkt albo wariant nieaktywny lub z konfiguratorem — w cenniku tylko z wcześniejszą ceną. */
  inactive: boolean;
};

export const PRICE_ROUNDING_STEPS = [0.01, 1, 5, 10, 50, 100] as const;

export const priceRowKey = (productId: string, variantId: string | null | undefined) => `${productId}:${variantId || ''}`;

/** Zaokrąglenie ceny do kroku (jak `price_list_round` w bazie): 1 zł, 10 zł, 0,01 zł… */
export function priceRound(value: number, step: number): number {
  const safeStep = PRICE_ROUNDING_STEPS.includes(step as (typeof PRICE_ROUNDING_STEPS)[number]) ? step : 1;
  const rounded = Math.round(value / safeStep) * safeStep;
  return Math.max(0, Math.round(rounded * 100) / 100);
}

/** Cena po zmianie o procent i zaokrągleniu. */
export const priceWithPercent = (value: number, percent: number, step: number) => priceRound(value * (1 + percent / 100), step);

/**
 * Wpisana cena: liczba (z przecinkiem albo kropką, spacje pomijane), `null` — puste pole (usuń z cennika),
 * `undefined` — nieprawidłowa wartość.
 */
export function parsePriceInput(text: string): number | null | undefined {
  const cleaned = text.replace(/\s/g, '').replace(',', '.');
  if (!cleaned) return null;
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return undefined;
  const value = Number(cleaned);
  return Number.isFinite(value) && value <= 999999999.99 ? Math.round(value * 100) / 100 : undefined;
}

export function priceListRows(
  products: readonly PriceListCatalogProduct[],
  entries: readonly PriceListEntryRow[],
  categoryNames: Readonly<Record<string, string>> = {},
): PriceListRow[] {
  const byKey = new Map(entries.map((entry) => [priceRowKey(entry.product_id, entry.product_variant_id), entry]));
  const withEntries = new Set(entries.map((entry) => entry.product_id));
  const sorted = [...products].sort((a, b) => {
    const categoryA = (a.category_id && categoryNames[a.category_id]) || '￿';
    const categoryB = (b.category_id && categoryNames[b.category_id]) || '￿';
    return categoryA.localeCompare(categoryB, 'pl') || a.name.localeCompare(b.name, 'pl');
  });
  const rows: PriceListRow[] = [];
  for (const product of sorted) {
    const productInactive = product.is_active === false || Boolean(product.configuration_schema);
    if (productInactive && !withEntries.has(product.id)) continue;
    const variants = [...(product.variants || [])].sort((a, b) => (Number(a.display_order) || 0) - (Number(b.display_order) || 0));
    const activeVariants = variants.filter((variant) => variant.is_active !== false);
    const push = (variant: PriceListCatalogVariant | null, inactive: boolean) => {
      const entry = byKey.get(priceRowKey(product.id, variant?.id));
      rows.push({
        key: priceRowKey(product.id, variant?.id),
        productId: product.id,
        variantId: variant?.id || null,
        productName: product.name,
        label: variant ? variant.name : 'Cena bazowa',
        categoryId: product.category_id || null,
        categoryIds: productCategoryIds(product),
        catalogPrice: Number((variant ? variant.price_net : product.base_price) || 0),
        entryId: entry?.id || null,
        price: entry ? Number(entry.price_net) : null,
        inactive,
      });
    };
    const baseEntry = byKey.has(priceRowKey(product.id, null));
    if (baseEntry || (!productInactive && (Number(product.base_price) > 0 || activeVariants.length === 0))) push(null, productInactive);
    for (const variant of variants) {
      const hasEntry = byKey.has(priceRowKey(product.id, variant.id));
      const variantInactive = productInactive || variant.is_active === false;
      if (hasEntry || !variantInactive) push(variant, variantInactive);
    }
  }
  return rows;
}
