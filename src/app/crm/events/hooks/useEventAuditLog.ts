import { useGetEventAuditLogQuery } from '@/app/crm/events/store/api/eventsApi';

export function useEventAuditLog(eventId: string) {
  const {
    data: auditLog = [],
    isLoading,
    error,
    refetch,
  } = useGetEventAuditLogQuery(eventId, {
    skip: !eventId,
  });

  return {
    auditLog,
    isLoading,
    error,
    refetch,
  };
}
