import { useGetEventVehiclesQuery } from '@/store/api/eventsApi';

export function useEventVehicles(eventId: string) {
  const {
    data: vehicles = [],
    isLoading,
    error,
    refetch,
  } = useGetEventVehiclesQuery(eventId, {
    skip: !eventId,
  });

  return {
    vehicles,
    isLoading,
    error,
    refetch,
  };
}
