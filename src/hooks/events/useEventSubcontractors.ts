import { useGetEventSubcontractorsQuery } from '@/store/api/eventsApi';

export function useEventSubcontractors(eventId: string) {
  const {
    data: subcontractors = [],
    isLoading,
    error,
    refetch,
  } = useGetEventSubcontractorsQuery(eventId, {
    skip: !eventId,
  });

  return {
    subcontractors,
    isLoading,
    error,
    refetch,
  };
}
