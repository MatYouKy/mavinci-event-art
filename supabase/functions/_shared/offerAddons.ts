import { calculateModular, type ProductConfigurationSnapshot } from './modularProduct.ts';
import { validateAudiencePricing, type QuantitySource, type OfferAudience } from './audiencePricing.ts';
import { validatePackageResources, validatePackageCosts, validPackageExtensionPrice, type ProductPackageSelection } from './productSalesPackages.ts';
/** Pricing snapshot shared by the CRM and the PDF renderer. Amounts are net PLN. */
export type AddonKind = 'over_limit' | 'quantity' | 'optional';
export type ProductAddon = {
  quantity_source?: QuantitySource;
  id: string; name: string; description: string; kind: AddonKind; unit: string;
  included_quantity: number; quantity: number; unit_price: number; enabled: boolean;
  price_on_request?: boolean;
  staff_role?: string;
  staff_hours?: number;
  max_quantity?: number;
};
export type OfferConfiguration = { modular_price_source?: 'calculator' | 'manual'; modular?: ProductConfigurationSnapshot; quantity_source?: QuantitySource; audience_snapshot?: OfferAudience; version: 1; base_unit_price: number; addons: ProductAddon[]; product_package?: ProductPackageSelection };
export const addonLabels: Record<AddonKind, string> = {
  over_limit: 'Ponad limit w pakiecie', quantity: 'Ilość × cena', optional: 'Opcjonalny dodatek',
};
export const addonMoney = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export function addonQuantity(a: ProductAddon): number {
  return a.kind === 'optional' ? (a.enabled ? 1 : 0)
    : a.kind === 'over_limit' ? Math.max(0, a.quantity - a.included_quantity) : a.quantity;
}
export function addonsTotal(addons: ProductAddon[]): number {
  return addonMoney(addons.reduce((sum, a) => sum + addonMoney(addonQuantity(a) * a.unit_price), 0));
}
export function configurationPrice(c: OfferConfiguration): number {
  if (c.modular) return c.modular_price_source === 'manual' ? c.base_unit_price : calculateModular(c.modular).total;
  return addonMoney(c.base_unit_price + addonsTotal(c.addons));
}
export function validateAddons(addons: ProductAddon[]): string | null {
  if (!Array.isArray(addons) || addons.length > 40) return 'Możesz dodać maksymalnie 40 dodatków.';
  const ids = new Set<string>();
  for (const a of addons) {
    if (a.quantity_source && (!['manual','guests','tables'].includes(a.quantity_source) || (a.kind === 'optional' && a.quantity_source !== 'manual'))) return 'Wybierz poprawny sposób wyliczania ilości dodatku.';
    if (!a || !a.id || ids.has(a.id)) return 'Dodatki muszą mieć unikalne identyfikatory.';
    ids.add(a.id);
    if (a.staff_role !== undefined && (typeof a.staff_role !== 'string' || !a.staff_role.trim() || a.staff_role.length > 120)) return 'Podaj poprawną rolę obsady dodatku.';
    if (a.staff_hours !== undefined && (!validPackageExtensionPrice(a.staff_hours) || a.staff_hours > 10000)) return 'Podaj poprawny czas pracy obsady dodatku.';
    if (a.max_quantity !== undefined && (!Number.isInteger(a.max_quantity) || a.max_quantity < 1 || a.max_quantity > 10000)) return 'Podaj całkowity limit dodatku od 1 do 10 000.';
    if (a.staff_role && (!Number.isInteger(addonQuantity(a)) || addonQuantity(a) > 10000)) return 'Obsada wymaga całkowitej liczby osób.';
    if (a.max_quantity !== undefined && addonQuantity(a) > a.max_quantity) return `Przekroczono zakres dodatku: ${a.name}. Zmień pakiet lub uzgodnij indywidualny zakres.`;
    if (a.price_on_request !== undefined && typeof a.price_on_request !== 'boolean') return 'Nieprawidłowe oznaczenie indywidualnej wyceny.';
    if (!Object.prototype.hasOwnProperty.call(addonLabels, a.kind)) return 'Wybierz rodzaj dodatku.';
    if (!a.name?.trim() || a.name.length > 120 || !a.unit?.trim() || a.unit.length > 20 || (a.description || '').length > 500) return 'Podaj nazwę (do 120 znaków), jednostkę i opis do 500 znaków.';
    if ([a.quantity, a.included_quantity, a.unit_price].some(n => !Number.isFinite(n) || n < 0)) return 'Ilości, limity i ceny muszą być nieujemnymi liczbami.';
    if (a.quantity > 100000 || a.included_quantity > 100000 || a.unit_price > 99999999 || typeof a.enabled !== 'boolean') return 'Przekroczono dopuszczalną ilość lub cenę dodatku.';
    if (Math.abs(a.quantity * 100 - Math.round(a.quantity * 100)) > 0.0001 || Math.abs(a.included_quantity * 100 - Math.round(a.included_quantity * 100)) > 0.0001 || Math.abs(a.unit_price * 100 - Math.round(a.unit_price * 100)) > 0.0001) return 'Użyj maksymalnie dwóch miejsc po przecinku.';
  }
  return null;
}
export function createModularConfiguration(modular: ProductConfigurationSnapshot, manualPrice?: number): OfferConfiguration {
  return { version: 1, quantity_source: 'manual', modular_price_source: manualPrice === undefined ? 'calculator' : 'manual', base_unit_price: manualPrice === undefined ? calculateModular(modular).total : manualPrice, addons: [], modular };
}
export function validateConfiguration(c: OfferConfiguration): string | null {
  if (c.modular) {
    if (c.modular_price_source !== undefined && c.modular_price_source !== 'manual' && c.modular_price_source !== 'calculator') return 'Nieprawidłowy sposób ustalenia ceny.';
    if (c.product_package || c.addons.length || (c.quantity_source && c.quantity_source !== 'manual')) return 'Konfigurator produktu nie może być łączony z innym przelicznikiem, pakietem lub dodatkami.';
    const error = calculateModular(c.modular).error;
    if (error) return error;
    if (c.modular_price_source !== 'manual' && Math.abs(c.base_unit_price - calculateModular(c.modular).total) > .001) return 'Cena konfiguracji jest nieaktualna. Zapisz ponownie konfigurację produktu.';
  }
  if (c.version !== 1 || !Number.isFinite(c.base_unit_price) || c.base_unit_price < 0 || c.base_unit_price > 999999999) return 'Podaj poprawną cenę bazową.';
  if (Math.abs(c.base_unit_price * 100 - Math.round(c.base_unit_price * 100)) > 0.0001) return 'Cena bazowa może mieć dwa miejsca po przecinku.';
  if (c.product_package) {
    const options = c.product_package.options;
    if (!Array.isArray(options) || options.length > 3 || !options.some(p => p.id === c.product_package?.selected_id)) return 'Wybierz pakiet do kalkulacji.';
    const selected = options.find(p => p.id === c.product_package?.selected_id);
    if (selected?.price_on_request && c.base_unit_price <= 0) return `Wpisz uzgodnioną cenę pakietu „${selected.name}”. Wycena indywidualna nie oznacza bezpłatnej usługi.`;
    for (const p of options) {
      const audienceError = validateAudiencePricing(p.audience_pricing);
      if (audienceError) return audienceError;
      const resourceError = validatePackageResources(p.resources);
      if (resourceError) return `${p.name || 'Pakiet'}: ${resourceError}`;
      const costError = validatePackageCosts(p.cost_items);
      if (costError) return `${p.name || 'Pakiet'}: ${costError}`;
    }
    if (options.some(p => !validPackageExtensionPrice(p.extension_price_net_per_hour))) return 'Podaj poprawną stawkę przedłużenia pakietu lub pozostaw puste pole.';
    if (options.some(p => !Number.isFinite(p.price_net) || p.price_net < 0 || p.price_net > 99999999 || Math.abs(p.price_net * 100 - Math.round(p.price_net * 100)) > .0001)) return 'Podaj poprawne ceny pakietów z maksymalnie dwoma miejscami po przecinku.';
  }
  const error = validateAddons(c.addons);
  if (error) return error;
  const unpriced = c.addons.find(a => a.price_on_request && addonQuantity(a) > 0 && a.unit_price <= 0);
  if (unpriced) return `Podaj uzgodnioną cenę dodatku: ${unpriced.name}. Opcja wymaga indywidualnej wyceny.`;
  return configurationPrice(c) > 999999999 ? 'Wartość konfiguracji jest zbyt wysoka.' : null;
}
export function createConfiguration(base: number, addons: ProductAddon[] = [], productPackage?: ProductPackageSelection): OfferConfiguration {
  const selection = productPackage ? { ...productPackage, options: productPackage.options.map(p => {
    if (p.id !== productPackage.selected_id || !p.resources) return p;
    const previous = p.resources.staff;
    const staff = previous.filter(row => !row.id.startsWith('addon-staff:'));
    for (const addon of addons) {
      const quantity = addonQuantity(addon);
      if (!addon.staff_role || quantity <= 0) continue;
      const id = `addon-staff:${addon.id}`;
      const existing = previous.find(row => row.id === id);
      staff.push({ id, role: addon.staff_role, quantity, estimated_hours: existing?.estimated_hours ?? addon.staff_hours ?? null,
        notes: existing?.notes ?? `Obsada dodatku: ${addon.name}. Stawkę kosztową ustal oddzielnie od ceny sprzedaży.`, is_optional: false,
        compensation: existing?.compensation ?? null });
    }
    return { ...p, resources: { ...p.resources, staff } };
  }) } : undefined;
  return { version: 1, base_unit_price: base, addons: addons.map(a => ({ ...a })), ...(selection ? { product_package: selection } : {}) };
}
export function hasOfferAddons(item: { pricing_configuration?: OfferConfiguration | null }): boolean {
  return Boolean(item.pricing_configuration?.addons?.length);
}
/** Item unit_price already includes extras: expand it, never add extras a second time. */
export function expandConfiguredItems(items: any[]): any[] {
  return items.flatMap((item) => {
    const c = item.pricing_configuration as OfferConfiguration | null;
    if (c?.modular || !c?.addons?.length) return [{ ...item }];
    const error = validateConfiguration(c);
    if (error) throw new Error(error);
    const count = Number(item.quantity ?? 1);
    const days = Number(item.days ?? 1);
    const allowances = c.addons.filter(a => a.kind === 'over_limit').map(a => `${a.name}: ${a.included_quantity} ${a.unit} w pakiecie; wybrano ${a.quantity}`);
    const base = { ...item, pricing_configuration: null, name: `${item.name} — pakiet bazowy`,
      description: allowances.join('. '), unit_price: c.base_unit_price, subtotal: addonMoney(count * days * c.base_unit_price),
      calculation_note: allowances.join('. '), pricing_parent_id: item.id };
    const rows = [base, ...c.addons.filter(a => addonQuantity(a) > 0).map(a => ({
      ...item, pricing_configuration: null, id: `${item.id}:${a.id}`, pricing_parent_id: item.id,
      name: `${item.name} / ${a.name}${a.kind === 'over_limit' ? ` — ponad ${a.included_quantity} ${a.unit}/pakiet` : ''}`,
      description: a.description, calculation_note: a.description,
      quantity: addonMoney(addonQuantity(a) * count), unit: a.unit,
      unit_price: a.unit_price, subtotal: addonMoney(addonMoney(addonQuantity(a) * a.unit_price) * count * days),
    }))];
    // Preserve the recorded line total when fractional package quantities cause cent rounding.
    const expected = addonMoney(count * days * Number(item.unit_price));
    const rendered = addonMoney(rows.reduce((sum, row) => sum + row.subtotal, 0));
    rows[0].subtotal = addonMoney(rows[0].subtotal + expected - rendered);
    return rows;
  });
}
