/*
 * Wycena weselna (`design_config.pricing_style = 'wedding'` kategorii szablonu oferty) — wartości domyślne wspólne dla PDF
 * (`weddingPricing.ts`), edytora szablonów w CRM i serwera Maca (`src/lib/native/offerTemplates.ts`). Bez zależności,
 * więc można je importować także w komponentach klienta.
 */

/** Zadatek w % kwoty do zapłaty (0 — bez zadatku na stronie wyceny). */
export const WEDDING_DEPOSIT_DEFAULT = 30;

/** Warunki pod wyceną: wiersz = warunek (zadatek ma własny wiersz w podsumowaniu). */
export const WEDDING_TERMS_DEFAULT = 'Ubezpieczenie OC\nDojazd: 50 km gratis, dalej 1 zł/km\nPokój dla zespołu';
