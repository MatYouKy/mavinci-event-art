'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { parseEventSettlement, type EventSettlement } from '@/lib/events/settlement/eventSettlement';
import { isMissingRpc, settlementErrorMessage } from './settlementUi';

export type SettlementLoadState = 'loading' | 'ready' | 'missing' | 'forbidden' | 'error';

/**
 * Stan zakładki Podsumowanie: odczyt get_event_settlement i zapisy przez funkcje bazy.
 * Każdy zapis zwraca pełny JSON podsumowania — staje się nowym stanem (interfejs niczego nie przelicza).
 */
export function useEventSettlement(eventId: string) {
  const { showSnackbar } = useSnackbar();
  const [settlement, setSettlement] = useState<EventSettlement | null>(null);
  const [state, setState] = useState<SettlementLoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef<string | null>(null);
  const sequence = useRef(0);
  const alive = useRef(true);

  const load = useCallback(
    async (quiet = false) => {
      const request = ++sequence.current;
      if (!quiet) setLoadError('');
      const { data, error } = await supabase.rpc('get_event_settlement', { p_event_id: eventId });
      if (!alive.current || request !== sequence.current) return;
      if (error) {
        if (isMissingRpc(error)) {
          setSettlement(null);
          setState('missing');
          return;
        }
        if (error.code === '42501') {
          setSettlement(null);
          setState('forbidden');
          setLoadError(settlementErrorMessage(error));
          return;
        }
        setLoadError(settlementErrorMessage(error, 'Nie udało się wczytać podsumowania wydarzenia.'));
        setState(current => (current === 'ready' ? 'ready' : 'error'));
        return;
      }
      const parsed = parseEventSettlement(data);
      if (!parsed) {
        setLoadError('Baza zwróciła nieczytelne podsumowanie. Odśwież stronę.');
        setState(current => (current === 'ready' ? 'ready' : 'error'));
        return;
      }
      setSettlement(parsed);
      setLoadError('');
      setState('ready');
    },
    [eventId],
  );

  useEffect(() => {
    alive.current = true;
    setSettlement(null);
    setState('loading');
    void load();
    const refresh = () => {
      if (document.visibilityState === 'visible' && !busyRef.current) void load(true);
    };
    window.addEventListener('focus', refresh);
    return () => {
      alive.current = false;
      sequence.current += 1;
      window.removeEventListener('focus', refresh);
    };
  }, [load]);

  /**
   * Zapis przez funkcję bazy, która zwraca pełne podsumowanie. Zwraca true po udanym zapisie.
   * Błąd bazy (np. „Podaj powód wyłączenia…”) trafia do snackbara.
   */
  const mutate = useCallback(
    async (key: string, rpc: string, params: Record<string, unknown>, successMessage?: string): Promise<boolean> => {
      if (busyRef.current) return false;
      busyRef.current = key;
      setBusy(key);
      try {
        const { data, error } = await supabase.rpc(rpc, params);
        if (error) {
          if (isMissingRpc(error)) setState('missing');
          showSnackbar(settlementErrorMessage(error), 'error', 8000);
          return false;
        }
        const parsed = parseEventSettlement(data);
        // Nowy stan z odpowiedzi; trwający odczyt w tle nie nadpisze go starszymi danymi.
        sequence.current += 1;
        if (parsed && alive.current) {
          setSettlement(parsed);
          setState('ready');
        } else if (alive.current) {
          void load(true);
        }
        if (successMessage) showSnackbar(successMessage, 'success');
        return true;
      } catch {
        showSnackbar('Nie udało się połączyć z bazą. Sprawdź połączenie i odśwież podsumowanie.', 'error', 8000);
        return false;
      } finally {
        busyRef.current = null;
        if (alive.current) setBusy(null);
      }
    },
    [load, showSnackbar],
  );

  return { settlement, state, loadError, busy, load, mutate };
}

export type SettlementMutate = ReturnType<typeof useEventSettlement>['mutate'];
