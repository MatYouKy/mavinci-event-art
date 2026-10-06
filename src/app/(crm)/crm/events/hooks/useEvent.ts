// useEvent.ts
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { eventsApi, useUpdateEventMutation, useDeleteEventMutation } from '@/app/(crm)/crm/events/store/api/eventsApi';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/browser';
import { useAppDispatch } from '@/store/hooks';
import type { IEvent } from '../type';

export function useEvent(initialEvent?: IEvent) {
  const params = useParams();
  const eventId = params?.id as string;

  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const dispatch = useAppDispatch();
  const subscriptionId = useId();
  const mountedRef = useRef(true);
  const activeEventIdRef = useRef(eventId);
  const requestVersionRef = useRef(0);
  activeEventIdRef.current = eventId;

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

  const refetch = useCallback(async (silent = false) => {
    if (!eventId) return;

    const requestVersion = ++requestVersionRef.current;
    const isCurrentRequest = () =>
      mountedRef.current &&
      activeEventIdRef.current === eventId &&
      requestVersionRef.current === requestVersion;

    try {
      if (!silent) setLoading(true);
      const { data, error: fetchError } = await supabase
        .from('events')
        .select('*')
        .eq('id', eventId)
        .maybeSingle();

      if (fetchError) throw fetchError;
      if (!isCurrentRequest()) return;
      // Odczyt events.* nie zawiera relacji dostarczonych przez stronę serwerową.
      setEvent((previous) => data
        ? ({ ...(previous?.id === data.id ? previous : {}), ...data } as IEvent)
        : null);
      setError(null);
      dispatch(eventsApi.util.invalidateTags([
        { type: 'EventDetails', id: eventId },
        { type: 'Events', id: eventId },
        { type: 'Events', id: 'LIST' },
        { type: 'EventFinances', id: eventId },
      ]));
    } catch (err) {
      if (!isCurrentRequest()) return;
      console.error('Error refetching event:', err);
      setError(err);
    } finally {
      if (isCurrentRequest()) setLoading(false);
    }
  }, [dispatch, eventId]);

  useEffect(() => {
    mountedRef.current = true;
    if (!eventId) return;

    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (refreshTimer !== null) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        void refetch(true);
      }, 0);
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState !== 'hidden') scheduleRefresh();
    };

    // Status rozliczenia ustala baza po zmianie faktury lub rejestru wpłat.
    // Nasłuch dotyczy wyłącznie odczytu: UI nie ustala samodzielnie statusu wydarzenia.
    const channel = supabase
      .channel(`event-details:${eventId}:${subscriptionId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'events',
        filter: `id=eq.${eventId}`,
      }, scheduleRefresh)
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') scheduleRefresh();
      });

    // Powrót z faktury odświeża także stan po przerwie w połączeniu realtime.
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    scheduleRefresh();

    return () => {
      mountedRef.current = false;
      requestVersionRef.current += 1;
      if (refreshTimer !== null) clearTimeout(refreshTimer);
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      void supabase.removeChannel(channel);
    };
  }, [eventId, refetch, subscriptionId]);

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
