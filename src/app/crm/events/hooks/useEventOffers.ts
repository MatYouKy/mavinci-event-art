'use client';

import { skipToken } from '@reduxjs/toolkit/query';
import {
  useGetEventOffersQuery,
  useDeleteEventOfferMutation,
  useUpdateEventOfferMutation,
} from '@/app/crm/events/store/api/eventsApi';

import { useEffect } from 'react';

export function useEventOffers(eventId?: string) {
  const q = useGetEventOffersQuery(eventId ?? skipToken);

  const [deleteOffer, del] = useDeleteEventOfferMutation();
  const [updateOffer, upd] = useUpdateEventOfferMutation();

  useEffect(() => {
    console.log('isDeleting changed:', del.isLoading, 'status:', del.status);
  }, [del.isLoading, del.status]);

  useEffect(() => {
    console.log('isUpdating changed:', upd.isLoading, 'status:', upd.status);
  }, [upd.isLoading, upd.status]);

  return {
    offers: q.data ?? [],
    isLoading: q.isLoading,
    isFetching: q.isFetching,
    error: q.error,
    refetch: q.refetch,

    removeOffer: (offerId: string) => deleteOffer({ eventId: eventId!, offerId }).unwrap(),

    updateOffer: (offerId: string, data: any) =>
      updateOffer({ eventId: eventId!, offerId, data }).unwrap(),

    isDeleting: del.isLoading,
    isUpdating: upd.isLoading,
  };
}
