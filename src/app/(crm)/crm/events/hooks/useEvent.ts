// useEvent.ts
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useUpdateEventMutation, useDeleteEventMutation } from '@/app/(crm)/crm/events/store/api/eventsApi';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/browser';
import type { IEvent } from '../type';

export function useEvent(initialEvent?: IEvent) {
  const params = useParams();
  const eventId = params?.id as string;

  const router = useRouter();
  const { showSnackbar } = useSnackbar();

  const [event, setEvent] = useState<IEvent | null>(initialEvent ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<any>(null);

  const [updateEventMutation, { isLoading: isUpdating }] = useUpdateEventMutation();
  const [deleteEventMutation, { isLoading: isDeleting }] = useDeleteEventMutation();

  // ✅ Stabilne "sygnały" do synchronizacji (nie zależymy od całego obiektu)
  const initialId = initialEvent?.id ?? null;
  const initialUpdatedAt = (initialEvent as any)?.updated_at ?? null; // jeśli masz

  useEffect(() => {
    if (!initialEvent) return;

    setEvent((prev) => {
      // 1) jeśli nie ma jeszcze eventu -> ustaw
      if (!prev) return initialEvent;

      // 2) jeśli zmienił się event (inna strona) -> ustaw
      if (prev.id !== initialEvent.id) return initialEvent;

      // 3) jeśli masz updated_at i się zmieniło -> ustaw
      const prevUpdatedAt = (prev as any)?.updated_at ?? null;
      if (initialUpdatedAt && prevUpdatedAt && prevUpdatedAt !== initialUpdatedAt) {
        return initialEvent;
      }

      // 4) inaczej nie ruszaj stanu (unikamy pętli)
      return prev;
    });
  }, [initialId, initialUpdatedAt]); // ✅ zamiast [initialEvent]

  const updateEvent = useCallback(
    async (data: Partial<IEvent>) => {
      try {
        // ✅ optymistycznie (opcjonalnie, ale fajne UX)
        setEvent((prev) => (prev ? ({ ...prev, ...data } as IEvent) : prev));

        await updateEventMutation({ id: eventId, data }).unwrap();
        showSnackbar('Wydarzenie zaktualizowane', 'success');
        return true;
      } catch (err: any) {
        showSnackbar(`Błąd: ${err?.message ?? 'Nie udało się zaktualizować wydarzenia'}`, 'error');
        return false;
      }
    },
    [eventId, updateEventMutation, showSnackbar],
  );

  const deleteEvent = useCallback(async () => {
    try {
      await deleteEventMutation(eventId).unwrap();
      showSnackbar('Wydarzenie usunięte', 'success');
      router.push('/crm/events');
      return true;
    } catch (err: any) {
      showSnackbar(`Błąd: ${err?.message ?? 'Nie udało się usunąć wydarzenia'}`, 'error');
      return false;
    }
  }, [eventId, deleteEventMutation, showSnackbar, router]);

  const logChange = useCallback(
    async (action: string, description: string, fieldName?: string, oldValue?: any, newValue?: any) => {
      try {
        await supabase.from('event_audit_log').insert([
          { event_id: eventId, action, field_name: fieldName, old_value: oldValue, new_value: newValue, description },
        ]);
      } catch (err) {
        console.error('Error logging change:', err);
      }
    },
    [eventId],
  );

  const refetch = useCallback(async () => {
    if (!eventId) return;

    try {
      setLoading(true);
      const { data, error: fetchError } = await supabase
        .from('events')
        .select('*')
        .eq('id', eventId)
        .single();

      if (fetchError) throw fetchError;
      setEvent(data as IEvent);
    } catch (err) {
      console.error('Error refetching event:', err);
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  return {
    event,
    loading,
    error,
    updateEvent,
    deleteEvent,
    logChange,
    refetch,
    isUpdating,
    isDeleting,
  };
}