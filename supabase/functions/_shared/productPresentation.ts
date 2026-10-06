export const COMPACT_PRODUCT_DESCRIPTION_LIMIT = 330;

type PresentationProduct = {
  offer_compact_description?: string | null;
  offer_description?: string | null;
  description?: string | null;
  variants?: Array<{ is_active?: boolean }> | null;
  offer_product_variants?: Array<{ is_active?: boolean }> | null;
  pricing_addons?: unknown[] | null;
  sales_packages_enabled?: boolean;
  sales_packages?: unknown[] | null;
};

export function compactProductBlockReason(product: PresentationProduct): string | null {
  if ((product.offer_product_variants || product.variants || []).some(v => v.is_active !== false)) {
    return 'Produkt ma aktywne elementy lub warianty, dlatego wymaga osobnej strony.';
  }
  if (product.sales_packages_enabled && product.sales_packages?.length) {
    return 'Produkt ma pakiety prezentowane na osobnej stronie.';
  }
  if (product.pricing_addons?.length) {
    return 'Produkt ma dodatki lub limity wymagające szczegółowej prezentacji.';
  }
  return null;
}

export function compactProductDescription(product: PresentationProduct, fallback = ''): string {
  return product.offer_compact_description?.trim() || fallback || product.offer_description || product.description || '';
}
