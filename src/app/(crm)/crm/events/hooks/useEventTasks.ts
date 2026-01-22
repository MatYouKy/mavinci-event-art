import { useGetEventTasksQuery } from '@/app/(crm)/crm/events/store/api/eventsApi';

export function useEventTasks(eventId: string) {
  const {
    data: tasks = [],
    isLoading,
    error,
    refetch,
  } = useGetEventTasksQuery(eventId, {
    skip: !eventId,
  });

  return {
    tasks,
    isLoading,
    error,
    refetch,
  };
}
