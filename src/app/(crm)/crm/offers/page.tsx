import { getOffersData } from '@/lib/CRM/Offers/getOffersData';
import { cache } from 'react';
import { OfferPage } from './OfferPage';

export const getOffersDataCached = cache(getOffersData);
export const revalidate = 0; 

export default async function OffersPage() {
  const { offers, categories, products, templates } = await getOffersDataCached();
  return (
    <OfferPage offers={offers} categories={categories} products={products} templates={templates} />
  );
}