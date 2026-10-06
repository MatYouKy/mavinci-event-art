import type { OfferConfiguration } from '@/lib/CRM/Offers/offerAddons';

export type OfferRecommendation = {
  id: string;
  product_id: string;
  product_variant_id: string | null;
  name: string;
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  pricing_configuration?: OfferConfiguration;
  discount_percent?: number;
  image_path: string | null;
};
