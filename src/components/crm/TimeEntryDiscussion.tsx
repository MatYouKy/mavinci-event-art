'use client';
import { useCallback, useEffect, useState, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { createPortal } from 'react-dom';
import { Dialog } from '@mui/material';
import { MessageSquare, Trash2, X, ChevronDown, ChevronUp } from 'lucide-react';
import ResponsiveActionBar from '@/components/crm/ResponsiveActionBar';
import { supabase } from '@/lib/supabase/browser';

export function useTimeEntryDiscussions() {
  const [threads, setThreads] = useState<any[]>([]);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    const { data, error } = await supabase.rpc('list_time_entry_discussions');
    if (error) { setError('Nie udało się pobrać rozmów. Sprawdź, czy migracja wątków została zastosowana.'); return; }
    setThreads(Array.isArray(data) ? data : []); setError('');
  }, []);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 20000);
    const focus = () => { void refresh(); };
    window.addEventListener('focus', focus);
    return () => { clearInterval(timer); window.removeEventListener('focus', focus); };
  }, [refresh]);
  return { threads, refresh, error };
}

export function TimeEntryDiscussion({ entry, isAdmin, discussions, onDelete, hideActions = false, panelId }: {
  entry: { id: string; title?: string | null; description?: string | null; start_time: string; duration_minutes?: number | null };
  isAdmin: boolean;
  onDelete?: () => void;
  hideActions?: boolean;
  panelId?: string;
  discussions: ReturnType<typeof useTimeEntryDiscussions>;
}) {
  const thread = discussions.threads.find(t => t.time_entry_id === entry.id);
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const searchParams = useSearchParams();
  const router = useRouter();
  const target = searchParams.get('discussion');
  const openedTarget = useRef<string | null>(null);
  useEffect(() => {
    if (target !== entry.id) { openedTarget.current = null; return; }
    if (thread && openedTarget.current !== target) { setOpen(true); openedTarget.current = target; }
  }, [target, entry.id, thread]);
  const close = () => {
    if (busy) return;
    setOpen(false);
    if (target === entry.id) {
      const params = new URLSearchParams(searchParams.toString()); params.delete('discussion');
      router.replace(`${window.location.pathname}${params.size ? `?${params}` : ''}`, { scroll: false });
    }
  };
  if (!isAdmin && !thread && !onDelete) return null;
  const mutate = async (resolve?: boolean) => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const result = resolve === undefined
        ? await supabase.rpc('post_time_entry_discussion', { p_entry: entry.id, p_body: body })
        : await supabase.rpc('resolve_time_entry_discussion', { p_entry: entry.id, p_resolved: resolve });
      if (result.error) throw result.error;
      if (resolve === undefined) setBody('');
      await discussions.refresh();
    } catch (e: any) { setError(e.message || 'Nie udało się zapisać wiadomości.'); }
    finally { setBusy(false); }
  };
  const conversation = (
      <div className={panelId ? "flex min-h-0 flex-col py-2" : "flex min-h-0 flex-col p-4"}>
        {!panelId && <div className="mb-2 flex items-center justify-between gap-3"><h3 className="text-sm font-medium">{entry.title || 'Rozmowa o czasie pracy'}</h3><button type="button" aria-label="Zamknij" disabled={busy} onClick={close}><X className="h-4 w-4" /></button></div>}
        <div className="mb-2 min-h-0 max-h-[50vh] space-y-2 overflow-y-auto" aria-live="polite">
          {thread?.messages.map((m: any) => <article key={m.id} className="border-b border-white/5 py-2"><div className="flex flex-wrap justify-between gap-2 text-xs text-white/60"><strong>{m.author_name}</strong><time>{new Date(m.created_at).toLocaleString('pl-PL')}</time></div><p className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-snug">{m.body}</p></article>)}

        </div>
        {thread?.resolved ? <p className="text-sm text-green-400">Wątek oznaczono jako wyjaśniony.</p> : <form className="flex items-end gap-2" onSubmit={e => { e.preventDefault(); void mutate(); }}>
          <label htmlFor={`reply-${entry.id}`} className="sr-only">{thread ? 'Odpowiedź' : 'Pytanie do wpisu'}</label>
          <textarea id={`reply-${entry.id}`} rows={2} placeholder={thread ? "Napisz odpowiedź…" : "Zadaj pytanie…"} maxLength={4000} value={body} disabled={busy} onChange={e => setBody(e.target.value)} className="min-w-0 flex-1 resize-y rounded-lg border border-white/10 bg-black/15 px-2 py-1.5 text-sm outline-none" />
          <button disabled={busy || !body.trim() || !!discussions.error} className="shrink-0 rounded-lg bg-[#d3bb73] px-3 py-2 text-xs text-black disabled:opacity-40">{busy ? 'Zapisywanie…' : 'Wyślij'}</button>
        </form>}
        {isAdmin && thread && <button type="button" disabled={busy} onClick={() => void mutate(!thread.resolved)} className="mt-2 self-end text-xs text-[#d3bb73]">{thread.resolved ? 'Otwórz ponownie' : 'Oznacz jako wyjaśnione'}</button>}
        {(error || discussions.error) && <p role="alert" className="mt-3 text-sm text-red-400">{error || discussions.error}</p>}
      </div>
  );
  return <>
    {!hideActions && <div className="flex flex-wrap items-center justify-end gap-2">
    {thread && <button type="button" aria-expanded={open} aria-controls={panelId} onClick={() => { if (open) close(); else { setOpen(true); void discussions.refresh(); } }} className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs ${thread.resolved ? 'bg-green-500/10 text-green-400' : 'bg-amber-500/15 text-amber-300'}`}>
      <MessageSquare className="h-3.5 w-3.5" />{thread.resolved ? 'Wyjaśnione' : 'Do wyjaśnienia'} · {thread.messages.length}{open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
    </button>}
    <ResponsiveActionBar alwaysDropdown disabledBackground compact actions={[
      {
        label: thread ? `Otwórz wątek · ${thread.resolved ? 'Wyjaśnione' : 'Do wyjaśnienia'} (${thread.messages.length})` : 'Rozpocznij wątek',
        icon: <MessageSquare className="h-4 w-4" />,
        show: isAdmin || !!thread,
        onClick: () => { setOpen(true); void discussions.refresh(); },
      },
      {
        label: 'Usuń',
        icon: <Trash2 className="h-4 w-4" />,
        variant: 'danger',
        show: !!onDelete,
        onClick: () => onDelete?.(),
      },
    ]} />
    </div>}
    {panelId ? (open && typeof document !== 'undefined' && document.getElementById(panelId)
      ? createPortal(conversation, document.getElementById(panelId)!) : null)
      : <Dialog open={open} onClose={close} fullWidth maxWidth="sm" PaperProps={{ sx: { backgroundColor: '#1c1f33', color: '#e5e4e2', borderRadius: 3, maxHeight: '90dvh' } }}>{conversation}</Dialog>}

  </>;
}

// A notification can point to an entry outside the current date filter.
export function TimeEntryDiscussionTarget({ entries, discussions, isAdmin }: {
  entries: { id: string }[]; discussions: ReturnType<typeof useTimeEntryDiscussions>; isAdmin: boolean;
}) {
  const target = useSearchParams().get('discussion');
  const thread = discussions.threads.find(t => t.time_entry_id === target);
  if (!thread || entries.some(e => e.id === target)) return null;
  return <TimeEntryDiscussion entry={{ ...thread, id: thread.time_entry_id }} discussions={discussions} isAdmin={isAdmin} hideActions />;
}
