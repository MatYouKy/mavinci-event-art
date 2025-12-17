'use client';

import { useGetOffersQuery } from '@/app/crm/offers/api/OfferWizzardApi';

export function useOffersList() {
  const q = useGetOffersQuery();

  return {
    offers: q.data ?? [],
    isLoading: q.isLoading,
    isFetching: q.isFetching,
    error: q.error,
    refetch: q.refetch,
  };
}