import type { OfferConfiguration } from '@/lib/CRM/Offers/offerAddons';

export type SellerPageLayout = 'compact' | 'default' | 'visual';
export const sellerPageLayouts: { id: SellerPageLayout; label: string }[] = [
  { id: 'compact', label: 'Kompaktowo · 3/str.' },
  { id: 'default', label: 'Osobna strona' },
  { id: 'visual', label: 'Duża grafika' },
];

// Matches the shared PDF renderer: configured stages/LED geometry support
// compact scope pages; other technical configurations need a full scope page.
export function sellerItemLayouts(configuration?: OfferConfiguration | null): SellerPageLayout[] {
  const modular = configuration?.modular;
  if (modular) return ['stage', 'warehouse_stage'].includes(modular.profile) || (modular.profile === 'led' && Boolean(modular.selection.led_sections))
    ? ['compact', 'default'] : ['default'];
  if (configuration?.addons.length) return ['default'];
  return ['compact', 'default', 'visual'];
}

export function sellerItemLayout(configuration: OfferConfiguration | null | undefined, requested?: string | null): SellerPageLayout {
  return sellerItemLayouts(configuration).includes(requested as SellerPageLayout) ? requested as SellerPageLayout : 'default';
}
