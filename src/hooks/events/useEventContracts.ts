import { useGetEventContractsQuery } from '@/store/api/eventsApi';

export function useEventContracts(eventId: string) {
  const {
    data: contracts = [],
    isLoading,
    error,
    refetch,
  } = useGetEventContractsQuery(eventId, {
    skip: !eventId,
  });

  return {
    contracts,
    isLoading,
    error,
    refetch,
  };
}
