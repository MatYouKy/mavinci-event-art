import { useCallback, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useForegroundEffect } from './useForegroundEffect';
import { createRefreshQueue } from '../lib/refreshQueue';
import { operationalFallback } from '../lib/operationalStages';

export function useOperationalStages(events: { id: string; status: string }[], enabled: boolean) {
  const key = Array.from(new Set(events.map((e) => e.id).filter(Boolean)))
    .sort()
    .join(',');
  const [snapshot, setSnapshot] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const refreshRef = useRef<(() => Promise<void>) | null>(null);
  const refresh = useCallback(async () => { await refreshRef.current?.(); }, []);
  const statusKey = events.map((e) => e.status).join(',');
  useForegroundEffect(() => {
    setSnapshot({});
    if (!enabled || !key) return;
    const controller = new AbortController();
    const queue = createRefreshQueue(controller.signal, async signal => {
      
      const next: Record<string, string> = {};
      const ids = key.split(',');
      for (let i = 0; i < ids.length; i += 100) {
        const result = await supabase.rpc('get_event_operational_states', { p_event_ids: ids.slice(i, i + 100) }).abortSignal(signal);
        if (signal.aborted) return;
        if (result.error) { setError('Nie udało się odświeżyć etapów magazynu.'); return; }
        for (const row of result.data || []) next[row.event_id] = row.status;
      }
      const mine = await supabase.rpc('get_my_realizations').abortSignal(signal);
      if (signal.aborted) return;
      if (!mine.error) for (const row of mine.data || []) if (ids.includes(row.id)) next[row.id] = row.operational_status;
      setSnapshot(next);
      setError('');
    });
    refreshRef.current = queue.refresh;
    const catchUp = () => {  queue.schedule(); };
    void queue.refresh();
    const timer = setInterval(catchUp, 60000);
    
    return () => {
      controller.abort();
      if (refreshRef.current === queue.refresh) refreshRef.current = null;
      clearInterval(timer);
      
    };
  }, [statusKey, key, enabled]);
  const states = useMemo(() => (enabled ? snapshot : {}), [enabled, snapshot]);
  const stage = (event: { id: string; status: string }) =>
    enabled ? states[event.id] || operationalFallback(event.status) : event.status;
  return { states, stage, refresh, error };
}
