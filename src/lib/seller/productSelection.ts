import type { OfferConfiguration } from '@/lib/CRM/Offers/offerAddons';
import { calculateModular, ledTreeSnapshot } from '@/lib/CRM/Offers/modularProduct';
import { isSellerLedPackage, selectSellerLedDimensions, SELLER_LED_PACKAGE_RATE } from './ledPackage';
import type { SellerComponentRate } from './productConfiguration';

export function missingSellerConfigurationRate(configuration: OfferConfiguration, rates: SellerComponentRate[]): string | null {
  if (isSellerLedPackage(configuration) && rates.some(rate => rate.key === SELLER_LED_PACKAGE_RATE && rate.price === null)) return 'Ekran wymaga wyceny. Opiekun musi ustawić Twoją stawkę pakietową za m², obejmującą konstrukcję, procesor i realizatora.';
  const modular = configuration.modular;
  if (!modular) return null;
  if (modular.profile === 'stage' && rates.some(r => r.key === 'stage:deck' && r.price === null)) return 'Poproś opiekuna o wycenę blatu 1 × 2 m.';
  const graph = modular.profile === 'warehouse_stage' ? modular : modular.profile === 'led' && modular.catalog.led_tree ? ledTreeSnapshot(modular) : null;
  if (!graph) return null;
  const result = calculateModular(modular);
  for (const line of result.lines) {
    const root = graph.catalog.roots.find(r => r.id === line.key);
    const linkId = line.key.split('/').pop();
    const id = root?.equipment_id || Object.values(graph.equipment || {}).flatMap(n => n.links).find(l => l.id === linkId)?.equipment_id;
    if (!id || graph.equipment?.[id]?.rate == null) return `Poproś opiekuna o wycenę: ${line.name}. Brak stawki nie oznacza ceny 0 zł.`;
  }
  return null;
}

/** Only choices can come from the browser; catalog, prices and dependencies
 * always come from the authenticated seller's server-side price projection. */
export function applySellerSelection(template: OfferConfiguration, input: OfferConfiguration): OfferConfiguration {
  const result = structuredClone(template);
  if (isSellerLedPackage(result)) {
    if (input?.modular?.profile !== 'led') throw new Error('Otwórz ponownie konfigurację ekranu.');
    result.modular = selectSellerLedDimensions(result.modular, input.modular);
    return result;
  }
  if (result.modular) {
    if (!input.modular || input.modular.profile !== result.modular.profile) throw new Error('Otwórz ponownie konfigurację produktu.');
    const source = input.modular.selection as unknown as Record<string, unknown>;
    const target = result.modular.selection as unknown as Record<string, unknown>;
    const fields = result.modular.profile === 'warehouse_stage'
      ? ['width', 'depth', 'height', 'skirt', 'quantities', 'choices', 'enabled']
      : result.modular.profile === 'stage' ? ['width', 'depth', 'height', 'skirt', 'carpet', 'stairs']
      : ['area', 'quantities', 'led_sections', 'led_choices', 'led_enabled'];
    for (const key of fields) if (Object.prototype.hasOwnProperty.call(source, key)) target[key] = source[key];
  } else {
    if (!Array.isArray(input.addons)) throw new Error('Nieprawidłowy wybór dodatków.');
    result.addons = result.addons.map(a => {
      const chosen = input.addons.find(row => row.id === a.id);
      return chosen ? { ...a, quantity: chosen.quantity, enabled: chosen.enabled } : a;
    });
  }
  return result;
}
