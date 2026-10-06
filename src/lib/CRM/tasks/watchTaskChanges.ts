import { supabase } from '@/lib/supabase/browser';

// A single subscription per RTK cache entry keeps every mounted task view current.
export function watchTaskChanges(key: string, reload: () => PromiseLike<unknown>, taskId?: string) {
  let disposed = false;
  let running = false;
  let requested = false;
  const refresh = async () => {
    requested = true;
    if (running || disposed) return;
    running = true;
    try {
      // If another change arrives during a request, fetch again after it finishes.
      while (requested && !disposed) {
        requested = false;
        try { await reload(); } catch { /* The query exposes the error to its view. */ }
      }
    } finally { running = false; }
  };
  const channel = supabase.channel(`task-views:${key}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, (payload) => {
      const row = payload.eventType === 'DELETE' ? payload.old : payload.new;
      if (!taskId || row.id === taskId) refresh();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'task_assignees' }, (payload) => {
      const row = payload.eventType === 'DELETE' ? payload.old : payload.new;
      if (!taskId || !row.task_id || row.task_id === taskId) refresh();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'task_comments' }, (payload) => {
      const row = payload.eventType === 'DELETE' ? payload.old : payload.new;
      if (!taskId || !row.task_id || row.task_id === taskId) refresh();
    })
    .subscribe((status) => { if (status === 'SUBSCRIBED') refresh(); });
  window.addEventListener('focus', refresh);
  return () => {
    disposed = true;
    window.removeEventListener('focus', refresh);
    void supabase.removeChannel(channel);
  };
}
