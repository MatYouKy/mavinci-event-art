import 'server-only';
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadConfigurationEquipment } from '@/lib/CRM/Offers/loadConfigurationEquipment';
import { productConfigurationSnapshot, type ProductConfigurator } from '@/lib/CRM/Offers/modularProduct';
import { createConfiguration, type OfferConfiguration, type ProductAddon } from '@/lib/CRM/Offers/offerAddons';
import { createSellerLedPackage, SELLER_LED_PACKAGE_RATE } from './ledPackage';
import type { SellerConfigurationCatalog, SellerComponentRate } from './productConfiguration';

// This projection never exposes rental prices. Missing individual prices are
// deliberately not inherited from the internal warehouse or treated as free.
export async function sellerConfigurationCatalog(admin: SupabaseClient, partner: string, company: string, product: string, basePrice: number): Promise<SellerConfigurationCatalog> {
  const [source, prices] = await Promise.all([
    admin.from('offer_products').select('name,configuration_schema,pricing_addons').eq('id', product).single(),
    admin.from('sales_partner_component_prices').select('component_key,price_net').eq('sales_partner_id', partner).eq('my_company_id', company).eq('product_id', product),
  ]);
  if (source.error || prices.error) throw new Error('Nie udało się odczytać konfiguracji i indywidualnych stawek. Sprawdź wdrożenie migracji konfiguratora sprzedawcy.');
  const rates: SellerComponentRate[] = [];
  const saved = new Map<string, number | null>((prices.data || []).map(r => [r.component_key, r.price_net == null ? null : Number(r.price_net)]));
  const rate = (key: string, label: string) => {
    const price = saved.get(key) ?? null;
    rates.push({ key, label, price });
    return price;
  };
  let configuration: OfferConfiguration;
  if (source.data.configuration_schema?.profile === 'led') {
    configuration = createSellerLedPackage(rate(SELLER_LED_PACKAGE_RATE, 'Kompletny ekran LED — netto / m² / dzień (konstrukcja, procesor, realizator)'));
  } else if (source.data.configuration_schema) {
    const schema = structuredClone(source.data.configuration_schema) as ProductConfigurator;
    schema.multiplier = 1;
    const snapshot = productConfigurationSnapshot(schema);
    if (snapshot.profile === 'warehouse_stage' || (snapshot.profile === 'led' && snapshot.catalog.led_tree)) {
      const tree = snapshot.profile === 'warehouse_stage' ? snapshot.catalog : snapshot.catalog.led_tree!;
      tree.multiplier = 1;
      const equipment = await loadConfigurationEquipment(admin, tree, snapshot.profile === 'led' ? 'led' : 'stage');
      for (const node of Object.values(equipment)) {
        node.rate = rate('equipment:' + node.id, node.name);
        delete node.thumbnail_url;
      }
      if (snapshot.profile === 'warehouse_stage') { snapshot.equipment = equipment; snapshot.loaded_at = 'seller-price-snapshot'; }
      else { snapshot.selection.led_equipment = equipment; snapshot.selection.led_loaded_at = 'seller-price-snapshot'; }
    } else if (snapshot.profile === 'stage') {
      // Legacy profile requires a numeric deck price; NaN is never persisted.
      // The route refuses a quote until this obligatory rate is configured.
      snapshot.catalog.deck_rate = rate('stage:deck', 'Blat 1 × 2 m') ?? 0;
      snapshot.catalog.heights.forEach(h => { h.leg_rate = rate('stage:leg:' + h.cm, 'Noga ' + h.cm + ' cm'); });
      snapshot.catalog.fascia_rate = rate('stage:fascia', 'Mocowanie wysłony');
      snapshot.catalog.skirt_rate = rate('stage:skirt', 'Wysłona');
      snapshot.catalog.carpet_rate = rate('stage:carpet', 'Dywan / m²');
      snapshot.catalog.stairs_rate = rate('stage:stairs', 'Schody');
    } else {
      snapshot.catalog.components.forEach(c => { c.rate = rate('component:' + c.id, c.name); });
    }
    configuration = { version: 1, quantity_source: 'manual', base_unit_price: 0, addons: [], modular: snapshot };
  } else {
    const addons: ProductAddon[] = (source.data.pricing_addons || []).map((a: ProductAddon) => {
      const price = rate('addon:' + a.id, a.name);
      // Retain only commercial descriptions, never staffing costs/resources.
      return { id: a.id, name: a.name, description: a.description, kind: a.kind, unit: a.unit,
        included_quantity: a.included_quantity, quantity: a.quantity, enabled: a.enabled,
        unit_price: price ?? 0, price_on_request: price === null, max_quantity: a.max_quantity };
    });
    configuration = createConfiguration(basePrice, addons);
  }
  const revision = createHash('sha256').update(JSON.stringify({ configuration, rates })).digest('hex');
  return { name: source.data.name, revision, configuration, rates, configurable: Boolean(configuration.modular || configuration.addons.length) };
}

export { applySellerSelection } from './productSelection';
