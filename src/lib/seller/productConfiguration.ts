import type { OfferConfiguration } from '@/lib/CRM/Offers/offerAddons';

export type SellerComponentRate = { key: string; label: string; price: number | null };
export type SellerConfigurationCatalog = {
  name: string;
  revision: string;
  configuration: OfferConfiguration;
  rates: SellerComponentRate[];
  configurable: boolean;
};
export type SellerConfigurationQuote = {
  id: string;
  configuration: OfferConfiguration;
  price: number;
  name: string;
  description: string;
};
