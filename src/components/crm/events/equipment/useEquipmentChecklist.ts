'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { createRefreshQueue } from '@/lib/CRM/refreshQueue';
import {
  EQUIPMENT_CHECKLIST_RPC,
  isEquipmentChecklistMissing,
  parseEquipmentChecklist,
  type EquipmentChecklist,
} from '@/lib/events/equipment/equipmentChecklist';
import { channelSuffix } from '../steps/stepUi';
import { equipmentErrorMessage } from './equipmentChecklistUi';

export type EquipmentChecklistStatus = 'loading' | 'ready' | 'missing' | 'error';
export type EquipmentChecklistRpc = (typeof EQUIPMENT_CHECKLIST_RPC)[keyof typeof EQUIPMENT_CHECKLIST_RPC];
export type EquipmentChecklistRunResult = { ok: true; checklist: EquipmentChecklist } | { ok: false; message: string };

/**
 * Checklista sprzętu wydarzenia: odczyt (get_event_equipment_checklist), odświeżanie na żywo (Realtime: pozycje,
 * etapy, lista sprzętu, wydarzenie) i zapis przez RPC. Każda funkcja zwraca aktualną checklistę — zastępuje stan.
 * Odpowiedzi są numerowane: starsza odpowiedź (np. odczyt wysłany przed zapisem) nie nadpisuje nowszego stanu.
 */
export function useEquipmentChecklist(eventId: string) {
  const [checklist, setChecklist] = useState<EquipmentChecklist | null>(null);
  const [status, setStatus] = useState<EquipmentChecklistStatus>('loading');
  const [loadError, setLoadError] = useState('');
  const [busyKeys, setBusyKeys] = useState<ReadonlySet<string>>(() => new Set());
  const seqRef = useRef(0);
  const appliedRef = useRef(0);
  const eventRef = useRef(eventId);
  const queueRef = useRef<ReturnType<typeof createRefreshQueue> | null>(null);
  eventRef.current = eventId;

  const apply = useCallback((seq: number, raw: unknown): EquipmentChecklist | null => {
    const parsed = parseEquipmentChecklist(raw);
    if (!parsed || parsed.event_id !== eventRef.current) return null;
    if (seq > appliedRef.current) {
      appliedRef.current = seq;
      setChecklist(parsed);
      setStatus('ready');
      setLoadError('');
    }
    return parsed;
  }, []);

  useEffect(() => {
    if (!eventId) return;
    setChecklist(null);
    setStatus('loading');
    setLoadError('');
    appliedRef.current = seqRef.current;
    const controller = new AbortController();
    const failed = (message: string) => {
      setLoadError(message);
      setStatus(current => (current === 'ready' ? 'ready' : 'error'));
    };
    const queue = createRefreshQueue(controller.signal, async signal => {
      const seq = ++seqRef.current;
      const { data, error } = await supabase.rpc(EQUIPMENT_CHECKLIST_RPC.get, { p_event: eventId }).abortSignal(signal);
      if (signal.aborted) {
        // Przekroczony czas odczytu (nie zamknięcie widoku) — pokaż błąd zamiast wiecznego wczytywania.
        if (!controller.signal.aborted) failed('Nie udało się odświeżyć checklisty sprzętu.');
        return;
      }
      if (error) {
        if (isEquipmentChecklistMissing(error)) {
          setChecklist(null);
          setStatus('missing');
          return;
        }
        failed(equipmentErrorMessage(error, 'Nie udało się wczytać checklisty sprzętu.'));
        return;
      }
      if (!apply(seq, data) && seq > appliedRef.current) failed('Nie udało się odczytać checklisty sprzętu.');
    });
    queueRef.current = queue;
    void queue.refresh();

    const filter = `event_id=eq.${eventId}`;
    const schedule = () => queue.schedule();
    const channel = supabase
      .channel(`equipment-checklist-${eventId}-${channelSuffix()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_equipment_checks', filter }, schedule)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_equipment_checklists', filter }, schedule)
      // Zmiana listy sprzętu (ilość, nowa pozycja) i pól wydania w wydarzeniu (prośba o odblokowanie).
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_equipment', filter }, schedule)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'events', filter: `id=eq.${eventId}` }, schedule)
      .subscribe();
    const onVisibility = () => {
      if (!document.hidden) queue.schedule();
    };
    window.addEventListener('focus', schedule);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      controller.abort();
      queueRef.current = null;
      void supabase.removeChannel(channel);
      window.removeEventListener('focus', schedule);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [eventId, apply]);

  const refresh = useCallback(() => {
    void queueRef.current?.refresh();
  }, []);

  /** Wywołanie funkcji checklisty; `key` blokuje odpowiadający przycisk do czasu odpowiedzi. */
  const run = useCallback(
    async (key: string, fn: EquipmentChecklistRpc, params: Record<string, unknown>): Promise<EquipmentChecklistRunResult> => {
      const seq = ++seqRef.current;
      setBusyKeys(previous => new Set(previous).add(key));
      try {
        const { data, error } = await supabase.rpc(fn, params);
        if (error) {
          // Stan mógł się zmienić na innym urządzeniu (np. wydanie już potwierdzone) — odśwież listę.
          queueRef.current?.schedule();
          return { ok: false, message: equipmentErrorMessage(error) };
        }
        const parsed = apply(seq, data);
        if (!parsed) {
          queueRef.current?.schedule();
          return { ok: false, message: 'Zapisano, ale nie udało się odczytać checklisty. Odśwież widok.' };
        }
        return { ok: true, checklist: parsed };
      } catch (error) {
        return { ok: false, message: equipmentErrorMessage(error) };
      } finally {
        setBusyKeys(previous => {
          const next = new Set(previous);
          next.delete(key);
          return next;
        });
      }
    },
    [apply],
  );

  return { checklist, status, loadError, busyKeys, refresh, run };
}
