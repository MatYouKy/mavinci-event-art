'use client';

import { skipToken } from '@reduxjs/toolkit/query';
import {
  useGetEventOffersQuery,
  useCreateEventOfferMutation,
  useDeleteEventOfferMutation,
  useUpdateEventOfferMutation,
} from '@/app/crm/events/store/api/eventsApi';

export function useEventOffers(eventId?: string) {
  const q = useGetEventOffersQuery(eventId ?? skipToken);

  const [createOffer, create] = useCreateEventOfferMutation();
  const [deleteOffer, del] = useDeleteEventOfferMutation();
  const [updateOffer, upd] = useUpdateEventOfferMutation();

  return {
    offers: q.data ?? [],
    isLoading: q.isLoading,
    isFetching: q.isFetching,
    error: q.error,
    refetch: q.refetch,

    createOffer: (offerData: any) => createOffer({ eventId: eventId!, offerData }).unwrap(),

    removeOffer: (offerId: string) => deleteOffer({ eventId: eventId!, offerId }).unwrap(),

    updateOffer: (offerId: string, data: any) =>
      updateOffer({ eventId: eventId!, offerId, data }).unwrap(),

    isCreating: create.isLoading,
    isDeleting: del.isLoading,
    isUpdating: upd.isLoading,
  };
}
