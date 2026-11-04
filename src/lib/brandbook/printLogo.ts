/**
 * Logo do druku (faktury, kalkulacje i inne wydruki na papierze): w brandbooku firmy zaznaczone
 * „Logo do druku” (`company_brandbook_logos.use_for_print`, jedno na firmę).
 * Dopóki żadne nie jest zaznaczone (albo przed migracją 20261104180000) — dotychczasowa reguła:
 * logo z nazwą lub wariantem „primary-black”.
 */

export type BrandbookLogoRow = {
  id?: string | null;
  url?: string | null;
  label?: string | null;
  variant?: string | null;
  is_default?: boolean | null;
  order_index?: number | null;
  use_for_print?: boolean | null;
};

export const normalizeLogoKey = (value: string | null | undefined) =>
  (value || '').trim().toLowerCase().replace(/\.(svg|png|webp|jpe?g)$/i, '').replace(/[\s_]+/g, '-');

export const PRINT_LOGO_MISSING_MESSAGE =
  'W brandbooku firmy zaznacz „Logo do druku” — najlepiej czarny logotyp na przezroczystym tle (np. primary-black).';

export function pickPrintLogo<T extends BrandbookLogoRow>(logos: T[] | null | undefined): T | null {
  const list = (logos ?? []).filter((entry) => String(entry.url ?? '').trim());
  return list.find((entry) => entry.use_for_print === true)
    || list.find((entry) => normalizeLogoKey(entry.label) === 'primary-black')
    || list.find((entry) => normalizeLogoKey(entry.variant) === 'primary-black')
    || null;
}
