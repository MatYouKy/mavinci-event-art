// useEvent.ts

import { useCallback, useEffect, useState } from 'react';
import {
  useUpdateEventMutation,
  useDeleteEventMutation,
} from '@/app/(crm)/crm/events/store/api/eventsApi';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/browser';
import { IEvent } from '../type';

export function useEvent(initialEvent?: IEvent) {
  const eventId = useParams().id as string;

  const [event, setEvent] = useState<IEvent | null>(initialEvent || null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<any>(null);

  useEffect(() => {
    if (initialEvent) {
      setEvent(initialEvent);
    }
  }, [initialEvent]);

  const router = useRouter();
  const { showSnackbar } = useSnackbar();

  const [updateEvent, { isLoading: isUpdating }] = useUpdateEventMutation();
  const [deleteEvent, { isLoading: isDeleting }] = useDeleteEventMutation();

  const handleUpdateEvent = useCallback(
    async (data: any) => {
      try {
        await updateEvent({ id: eventId, data }).unwrap();
        // ⬆️ invalidatesTags => spowoduje REFRESH tylko tam,
        // gdzie faktycznie użyto useGetEventDetailsQuery(eventId),
        // czyli w głównym komponencie
        showSnackbar('Wydarzenie zaktualizowane', 'success');
        return true;
      } catch (error: any) {
        showSnackbar(
          `Błąd: ${error?.message ?? 'Nie udało się zaktualizować wydarzenia'}`,
          'error',
        );
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
      showSnackbar(`Błąd: ${error?.message ?? 'Nie udało się usunąć wydarzenia'}`, 'error');
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
    loading,
    error,
    updateEvent: handleUpdateEvent,
    deleteEvent: handleDeleteEvent,
    logChange,
    isUpdating,
    isDeleting,
  };
}
