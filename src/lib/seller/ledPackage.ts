import type { OfferConfiguration } from '@/lib/CRM/Offers/offerAddons';
import { ledSectionTotals, type EquipmentSnapshot, type LedSection } from '@/lib/CRM/Offers/modularProduct';

export const SELLER_LED_PACKAGE_RATE = 'led:package-m2';
const packageComponent = 'seller-led-package-m2-v1';
export type SellerLedSnapshot = EquipmentSnapshot & { profile: 'led' };

export function isSellerLedPackage(configuration?: OfferConfiguration | null): configuration is OfferConfiguration & { modular: SellerLedSnapshot } {
  return configuration?.modular?.profile === 'led'
    && Array.isArray(configuration.modular.catalog.components)
    && configuration.modular.catalog.components.some(component => component.id === packageComponent);
}

/** Commercial scope only. No warehouse rates, technical choices or automatic
 * resource reservations. The CRM team prepares the technical implementation. */
export function createSellerLedPackage(price: number | null): OfferConfiguration {
  return {
    version: 1, quantity_source: 'manual', base_unit_price: 0, addons: [],
    modular: {
      version: 1, profile: 'led',
      catalog: { version: 1, profile: 'led', multiplier: 1, components: [
        { id: packageComponent, name: 'Ekran LED — kompletny pakiet za m²', name_en: 'LED screen — complete package per m²', role: 'display', basis: 'area', quantity: 1, rate: price, required: true },
        { id: 'seller-led-support', name: 'Konstrukcja — w pakiecie', name_en: 'Support structure — included', role: 'support', basis: 'fixed', quantity: 1, rate: 0, required: true },
        { id: 'seller-led-processor', name: 'Procesor obrazu — w pakiecie', name_en: 'Video processor — included', role: 'processor', basis: 'fixed', quantity: 1, rate: 0, required: true },
        { id: 'seller-led-operator', name: 'Realizator ekranu — w pakiecie', name_en: 'LED screen operator — included', role: 'equipment', basis: 'fixed', quantity: 1, rate: 0, required: true },
      ] },
      selection: { area: 6, led_sections: [{ id: 'screen-1', name: 'Ekran 1', columns: 6, rows: 4 }], quantities: {} },
    },
  };
}

// Both browser and server copy dimensions only; rates and included services
// always come from the authenticated seller's current server-side price list.
export function selectSellerLedDimensions(template: SellerLedSnapshot, input: EquipmentSnapshot): SellerLedSnapshot {
  const supplied = input.selection?.led_sections;
  const sections: LedSection[] = Array.isArray(supplied) && supplied.length
    ? supplied.map(section => ({ id: section.id, name: section.name, columns: section.columns, rows: section.rows }))
    : [{ id: 'screen-1', name: 'Ekran 1', columns: NaN, rows: NaN }];
  let area = NaN;
  try { area = ledSectionTotals(sections).area; } catch { /* Show dimension validation, never silently change old geometry. */ }
  return { ...template, selection: { area, led_sections: sections, quantities: {} } };
}

export function sellerLedPackageScope(configuration: OfferConfiguration, english = false): string[] {
  if (!isSellerLedPackage(configuration)) return [];
  return [
    ...(configuration.modular.selection.led_sections || []).map(section => `${section.name}: ${section.columns / 2} × ${section.rows / 2} m`),
    `${english ? 'Total screen area' : 'Łączna powierzchnia ekranu'}: ${configuration.modular.selection.area} m²`,
    english ? 'Included: LED screen, support structure, video processor and LED screen operator.' : 'W cenie: ekran LED, konstrukcja, procesor obrazu i realizator ekranu.',
  ];
}
