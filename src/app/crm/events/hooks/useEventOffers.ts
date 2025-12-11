import { useGetEventOffersQuery } from '@/app/crm/events/store/api/eventsApi';

export function useEventOffers(eventId: string) {
  const {
    data: offers = [],
    isLoading,
    error,
    refetch,
  } = useGetEventOffersQuery(eventId, {
    skip: !eventId,
  });

  return {
    offers,
    isLoading,
    error,
    refetch,
  };
}
