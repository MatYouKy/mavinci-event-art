import { useCallback } from 'react';
import {
  useGetEventDetailsQuery,
  useUpdateEventMutation,
  useDeleteEventMutation,
} from '@/app/crm/events/store/api/eventsApi';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export function useEvent(eventId: string) {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();

  const {
    data: event,
    isLoading,
    error,
    refetch,
  } = useGetEventDetailsQuery(eventId, {
    skip: !eventId,
  });

  const [updateEvent, { isLoading: isUpdating }] = useUpdateEventMutation();
  const [deleteEvent, { isLoading: isDeleting }] = useDeleteEventMutation();

  const handleUpdateEvent = useCallback(
    async (data: any) => {
      try {
        await updateEvent({ id: eventId, data }).unwrap();
        showSnackbar('Wydarzenie zaktualizowane', 'success');
        return true;
      } catch (error: any) {
        showSnackbar(`Błąd: ${error.message}`, 'error');
        return false;
      }
    },
    [eventId, updateEvent, showSnackbar],
  );

  const handleDeleteEvent = useCallback(async () => {
    try {
      await deleteEvent(eventId).unwrap();
      showSnackbar('Wydarzenie usunięte', 'success');
      router.push('/crm/events');
      return true;
    } catch (error: any) {
      showSnackbar(`Błąd: ${error.message}`, 'error');
      return false;
    }
  }, [eventId, deleteEvent, showSnackbar, router]);

  const logChange = useCallback(
    async (
      action: string,
      description: string,
      fieldName?: string,
      oldValue?: any,
      newValue?: any,
    ) => {
      try {
        await supabase.from('event_audit_log').insert([
          {
            event_id: eventId,
            action,
            field_name: fieldName,
            old_value: oldValue,
            new_value: newValue,
            description,
          },
        ]);
      } catch (err) {
        console.error('Error logging change:', err);
      }
    },
    [eventId],
  );

  return {
    event,
    isLoading,
    error,
    refetch,
    updateEvent: handleUpdateEvent,
    deleteEvent: handleDeleteEvent,
    logChange,
    isUpdating,
    isDeleting,
  };
}
