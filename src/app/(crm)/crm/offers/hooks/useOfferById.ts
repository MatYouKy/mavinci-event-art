'use client';

import { skipToken } from '@reduxjs/toolkit/query';
import {
  useGetOfferByIdQuery,
  useLazyGetOfferByIdQuery,
  useUpdateOfferByIdMutation,
  useDeleteOfferByIdMutation,
} from '@/app/(crm)/crm/offers/api/OfferWizzardApi';

export function useOfferById(offerId?: string) {
  const q = useGetOfferByIdQuery(offerId ? { offerId } : skipToken);

  return {
    offer: q.data ?? null,
    isLoading: q.isLoading,
    isFetching: q.isFetching,
    error: q.error,
    refetch: q.refetch,
  };
}

export function useOfferActions() {
  const [fetchTrigger, fetchQ] = useLazyGetOfferByIdQuery();
  const [updateTrigger, updateQ] = useUpdateOfferByIdMutation();
  const [deleteTrigger, deleteQ] = useDeleteOfferByIdMutation();

  return {
    // READ (lazy)
    fetchOfferById: (offerId: string) => fetchTrigger({ offerId }, true).unwrap(),

    // UPDATE
    updateOfferById: (offerId: string, patch: Record<string, any>) =>
      updateTrigger({ offerId, patch }).unwrap(),

    // DELETE
    deleteOfferById: (offerId: string) => deleteTrigger({ offerId }).unwrap(),

    // stany (opcjonalnie)
    fetchState: fetchQ,
    updateState: updateQ,
    deleteState: deleteQ,
  };
}
