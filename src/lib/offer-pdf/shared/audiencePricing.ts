import type { OfferConfiguration } from './offerAddons';
export type QuantitySource = 'manual' | 'guests' | 'tables';
export type AudiencePricing = { fixed_net: number; per_guest_net: number; per_table_net: number; reference_guests: number };
export type OfferAudience = { guest_count?: number | null; guests_per_table?: number | null; table_count?: number | null };
export const quantitySourceLabels: Record<QuantitySource, string> = { manual: 'Ilość wpisywana ręcznie', guests: 'Liczba osób z oferty', tables: 'Liczba stołów z oferty' };
export function validateAudiencePricing(p?: AudiencePricing | null): string | null {
  if (p == null) return null;
  if (![p.fixed_net, p.per_guest_net, p.per_table_net].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 99999999 && Math.abs(n * 100 - Math.round(n * 100)) < .0001)) return 'Podaj poprawne stawki kalkulatora pakietu.';
  if (!Number.isInteger(p.reference_guests) || p.reference_guests < 1 || p.reference_guests > 100000) return 'Podaj referencyjną liczbę osób od 1 do 100 000.';
  return null;
}
export function audienceTables(a: OfferAudience): number | null {
  if (!Number.isInteger(a.guest_count) || Number(a.guest_count) < 1 || Number(a.guest_count) > 100000) return null;
  const capacity = a.guests_per_table ?? 10;
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100) return null;
  if (a.table_count != null) return Number.isInteger(a.table_count) && a.table_count >= 1 && a.table_count <= 100000 ? a.table_count : null;
  return Math.ceil(Number(a.guest_count) / capacity);
}
export function audiencePackagePrice(p: AudiencePricing, a: OfferAudience): number | null {
  const tables = audienceTables(a);
  if (validateAudiencePricing(p) || tables == null) return null;
  const price = Math.round((p.fixed_net + p.per_guest_net * Number(a.guest_count) + p.per_table_net * tables + Number.EPSILON) * 100) / 100;
  return price <= 999999999 ? price : null;
}
/** Resolve from the saved offer counts; catalog reference counts never become an offer quantity. */
export function resolveAudienceConfiguration(config: OfferConfiguration, a: OfferAudience, manualQuantity = 1) {
  const c = structuredClone(config);
  const source = c.quantity_source || 'manual';
  const selected = c.product_package?.options.find(p => p.id === c.product_package?.selected_id);
  const required = source !== 'manual' || Boolean(selected?.audience_pricing) || c.addons.some(x => x.quantity_source && x.quantity_source !== 'manual');
  if (!required) delete c.audience_snapshot;
  const tables = audienceTables(a);
  if (required && tables == null) return { configuration: c, quantity: manualQuantity, error: 'Uzupełnij liczbę osób i poprawne ustawienia stołów w szczegółach oferty.' };
  if (c.product_package && tables != null) {
    c.product_package.options = c.product_package.options.map(p => {
      if (!p.audience_pricing) return p;
      const price = audiencePackagePrice(p.audience_pricing, a);
      return { ...p, price_net: price ?? NaN };
    });
    const resolved = c.product_package.options.find(p => p.id === c.product_package?.selected_id);
    if (resolved?.audience_pricing) c.base_unit_price = resolved.price_net;
  }
  if (tables != null) c.addons = c.addons.map(x => x.quantity_source === 'guests' ? { ...x, quantity: Number(a.guest_count) } : x.quantity_source === 'tables' ? { ...x, quantity: tables } : x);
  const quantity = source === 'guests' ? Number(a.guest_count) : source === 'tables' ? Number(tables) : manualQuantity;
  if (required) c.audience_snapshot = { guest_count: Number(a.guest_count), guests_per_table: a.guests_per_table ?? 10, table_count: tables };
  return { configuration: c, quantity, error: Number.isFinite(c.base_unit_price) ? null : 'Cena pakietu przekracza dopuszczalny zakres.' };
}

/** Only the selected package and included add-ons require table counts. */
export function configurationNeedsTables(config?: Partial<OfferConfiguration> | null): boolean {
  if (!config) return false;
  const selected = config.product_package?.options?.find(p => p.id === config.product_package?.selected_id);
  return config.quantity_source === 'tables'
    || Number(selected?.audience_pricing?.per_table_net || 0) > 0
    || Boolean(config.addons?.some(a => a.kind !== 'optional' && a.quantity_source === 'tables'));
}
export function offerNeedsTables(offer: { offer_items?: { pricing_configuration?: Partial<OfferConfiguration> | null }[] | null; recommended_items?: { pricing_configuration?: Partial<OfferConfiguration> | null }[] | null }): boolean {
  return [...(offer.offer_items || []), ...(offer.recommended_items || [])].some(item => configurationNeedsTables(item.pricing_configuration));
}
