import { useGetEventFilesQuery } from '@/app/crm/events/store/api/eventsApi';

export function useEventFiles(eventId: string) {
  const {
    data: files = [],
    isLoading,
    error,
    refetch,
  } = useGetEventFilesQuery(eventId, {
    skip: !eventId,
  });

  return {
    files,
    isLoading,
    error,
    refetch,
  };
}
