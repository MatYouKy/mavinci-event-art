import { getOffersData } from '@/lib/CRM/Offers/getOffersData';
import { cache } from 'react';
import { OfferPage } from './OfferPage';

export const getOffersDataCached = cache(getOffersData);
export const revalidate = 0; // CRM zwykle bez cache ISR; cache() i tak dedupuje w ramach renderu

export default async function OffersPage() {
  const { offers, categories, products, templates } = await getOffersDataCached();

  // przekaż do client komponentu jeśli trzeba
  return (
    <OfferPage offers={offers} categories={categories} products={products} templates={templates} />
  );
}