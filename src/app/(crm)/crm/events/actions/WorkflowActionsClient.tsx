'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { createRefreshQueue } from '@/lib/CRM/refreshQueue';
import EventWorkflowActionCard, { type EventWorkflowAction } from '@/components/crm/events/EventWorkflowActionCard';
export default function WorkflowActionsClient() {
  const [items, setItems] = useState<EventWorkflowAction[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const queue = createRefreshQueue(controller.signal, async signal => {
      if (document.hidden) return;
      const { data, error } = await supabase.rpc('get_my_event_workflow_actions').abortSignal(signal);
      if (signal.aborted) return;
      setError(error ? 'Nie udało się wczytać kolejnych kroków. Spróbuj ponownie.' : '');
      if (!error) setItems(data || []);
      setLoading(false);
    });
    const refresh = () => queue.schedule();
    void queue.refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { controller.abort(); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [revision]);
  return <main className="mx-auto max-w-5xl space-y-4 p-4">
    <div className="flex items-start justify-between gap-4"><div><h1 className="text-xl text-[#e5e4e2]">Moje wydarzenia — następne kroki</h1><p className="mt-1 text-sm text-[#e5e4e2]/60">Tylko wydarzenia, których jesteś autorem. Jedno zbiorcze przypomnienie dziennie, od godziny 9:00.</p></div><button type="button" onClick={() => setRevision(v => v + 1)} className="rounded-lg bg-white/5 px-3 py-2 text-sm text-[#d3bb73]">Odśwież</button></div>
    {loading && <p className="text-sm text-[#e5e4e2]/60">Wczytywanie…</p>}
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    {!loading && !error && !items.length && <p className="text-[#e5e4e2]/60">Nie masz wydarzeń wymagających kolejnego kroku.</p>}
    {items.map(item => <EventWorkflowActionCard key={item.event_id + item.requirement_id} action={item} canSnooze onChanged={() => setRevision(v => v + 1)} />)}
  </main>;
}
