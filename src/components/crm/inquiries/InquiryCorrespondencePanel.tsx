'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Mail, RefreshCw, Search, Plus, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { invalidateInquiryCorrespondence, type useInquiryCorrespondence } from '@/lib/CRM/inquiries/useInquiryCorrespondence';
import { useSnackbar } from '@/contexts/SnackbarContext';

export type CorrespondenceMessage = {
  id: string; type: 'received' | 'sent'; subject: string; from_address: string;
  to_address: string; message_at: string; body: string;
};
const key = (m: {type: string; id: string}) => `${m.type}:${m.id}`;
const date = (value: string) => new Date(value).toLocaleString('pl-PL');
const button = 'inline-flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-sm text-[#d3bb73] hover:bg-white/10 disabled:opacity-50';
const input = 'w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm';
const friendlyError = (error: unknown) => (error as { message?: string })?.message || 'Nie udało się zapisać powiązania. Spróbuj ponownie.';

export function EmailThreadPicker({ onAttach }: {
  onAttach: (message: CorrespondenceMessage, wholeThread: boolean) => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CorrespondenceMessage[]>([]);
  const [selected, setSelected] = useState<CorrespondenceMessage | null>(null);
  const [preview, setPreview] = useState<CorrespondenceMessage[]>([]);
  const [wholeThread, setWholeThread] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const search = async () => {
    if (lock.current || query.trim().length < 3) return;
    lock.current = true; setBusy(true); setError(''); setSelected(null); setResults([]);
    try {
      // Escape LIKE metacharacters; query builder supplies the value separately.
      const pattern = `%${query.trim().replace(/[\\%_]/g, '\\$&')}%`;
      const result = await supabase.from('inquiry_email_index')
        .select('id,type,subject,from_address,to_address,message_at,body')
        .ilike('subject', pattern).order('message_at', { ascending: false }).limit(30);
      if (result.error) throw result.error;
      setResults(result.data as CorrespondenceMessage[] || []);
      if (!result.data?.length) setError('Nie znaleziono wiadomości o takim temacie w dostępnych skrzynkach.');
    } catch { setError('Wyszukiwanie korespondencji jest chwilowo niedostępne. Spróbuj ponownie później.'); }
    finally { lock.current = false; setBusy(false); }
  };
  const choose = async (message: CorrespondenceMessage) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setSelected(null);
    try {
      const result = await supabase.rpc('get_email_conversation_preview', { p_type: message.type, p_id: message.id });
      if (result.error) throw result.error;
      setPreview(result.data || []); setSelected(message); setWholeThread(true);
    } catch { setError('Nie udało się pobrać konwersacji. Spróbuj ponownie.'); }
    finally { lock.current = false; setBusy(false); }
  };
  const attach = async () => {
    if (!selected || lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { await onAttach(selected, wholeThread); setSelected(null); setResults([]); }
    catch (error) { setError(friendlyError(error)); }
    finally { lock.current = false; setBusy(false); }
  };
  return <div className="space-y-3 rounded-lg bg-black/15 p-4">
    <form onSubmit={event => { event.preventDefault(); void search(); }} className="flex gap-2">
      <input className={input} aria-label="Temat wiadomości" placeholder="Wyszukaj po temacie maila…" value={query} onChange={e => setQuery(e.target.value)} />
      <button type="submit" className={button} disabled={busy || query.trim().length < 3}><Search className="h-4 w-4" />Szukaj</button>
    </form>
    {error && <p role="alert" className="text-sm text-amber-200">{error}</p>}
    {busy && <p role="status" className="text-sm text-white/60">Wczytywanie / zapisywanie…</p>}
    {!selected && <div className="max-h-72 space-y-1 overflow-y-auto">{results.map(m => <button key={key(m)} disabled={busy} onClick={() => void choose(m)} className="block w-full rounded-lg p-3 text-left hover:bg-white/5">
      <p className="text-sm">{m.subject || '(bez tematu)'}</p><p className="text-xs text-white/50">{m.type === 'received' ? 'Odebrane' : 'Wysłane'} · {date(m.message_at)} · {m.from_address} → {m.to_address}</p>
    </button>)}</div>}
    {selected && <div className="space-y-3">
      <p className="text-sm font-medium">{selected.subject}</p>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={wholeThread} disabled={busy} onChange={e => setWholeThread(e.target.checked)} />Dołącz całą konwersację ({preview.length} wiadomości), także kolejne odpowiedzi</label>
      <p className="text-xs text-white/50">Łączymy odpowiedzi w wątku oraz wiadomości o tym samym temacie i z tym samym rozmówcą w tej skrzynce. Prefiksy Re:, Odp: i Fwd: nie zmieniają tematu.</p>
      <div className="max-h-40 overflow-y-auto text-xs text-white/60">{(wholeThread ? preview : [selected]).map(m => <div className="py-1" key={key(m)}>{date(m.message_at)} · {m.subject}</div>)}</div>
      <button className={button} disabled={busy} onClick={() => void attach()}><Plus className="h-4 w-4" />{wholeThread ? 'Dołącz konwersację' : 'Dołącz wiadomość'}</button>
      <button className={button} disabled={busy} onClick={() => setSelected(null)}>Wróć do wyników</button>
    </div>}
  </div>;
}

export function LinkEmailToInquiry({ message, onSuccess }: {
  message: { id: string; type: string; subject: string };
  onSuccess: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [inquiries, setInquiries] = useState<Array<{ id: string; title: string }>>([]);
  const [selected, setSelected] = useState('');
  const [wholeThread, setWholeThread] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      let request = supabase.from('tasks').select('id,title').eq('is_inquiry', true).is('archived_at', null).order('created_at', { ascending: false }).limit(30);
      if (query.trim()) request = request.ilike('title', `%${query.trim().replace(/[\\%_]/g, '\\$&')}%`);
      const result = await request;
      if (!active) return;
      setInquiries(result.data || []);
      setError(result.error ? 'Nie udało się pobrać zapytań.' : '');
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [query]);
  const attach = async () => {
    if (lock.current || !selected) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const result = await supabase.rpc('link_inquiry_email', { p_inquiry_id: selected, p_type: message.type, p_id: message.id, p_thread: wholeThread });
      if (result.error) throw result.error;
      invalidateInquiryCorrespondence(selected);
      onSuccess(selected);
    } catch (error) { setError(friendlyError(error)); }
    finally { lock.current = false; setBusy(false); }
  };
  return <div className="space-y-3 p-5">
    <p className="text-sm text-white/70">{message.subject}</p>
    <input aria-label="Wyszukaj zapytanie" placeholder="Wyszukaj zapytanie…" className={input} value={query} onChange={e => { setQuery(e.target.value); setSelected(''); }} />
    <select aria-label="Zapytanie" className={input} value={selected} disabled={busy} onChange={e => setSelected(e.target.value)}><option value="">Wybierz zapytanie</option>{inquiries.map(i => <option key={i.id} value={i.id}>{i.title}</option>)}</select>
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={wholeThread} disabled={busy} onChange={e => setWholeThread(e.target.checked)} />Powiąż całą konwersację i kolejne odpowiedzi</label>
    <p className="text-xs text-white/50">Ten sam temat i rozmówca w tej skrzynce lub identyfikatory odpowiedzi. Odznacz, aby dołączyć tylko wybrany mail.</p>
    {error && <p role="alert" className="text-sm text-amber-200">{error}</p>}
    <button className={button} disabled={busy || !selected} onClick={() => void attach()}>{busy ? 'Zapisywanie…' : 'Dołącz do zapytania'}</button>
  </div>;
}

export default function InquiryCorrespondencePanel({ inquiryId, canManage, analyzing, onAnalyze, correspondence }: {
  inquiryId: string; canManage: boolean; analyzing: boolean; onAnalyze: () => void; correspondence: ReturnType<typeof useInquiryCorrespondence>;
}) {
  const { messages, links, loading, error, refreshing, savedAt, refresh } = correspondence;
  const excluded = links.filter(link => link.excluded);
  const [showPicker, setShowPicker] = useState(false);
  const [mutating, setMutating] = useState(false);
  const { showSnackbar } = useSnackbar();
  const change = async (m: {id: string; type: string}, thread: boolean, exclude = false) => {
    setMutating(true);
    try {
      const result = await supabase.rpc('link_inquiry_email', { p_inquiry_id: inquiryId, p_type: m.type, p_id: m.id, p_thread: thread, p_excluded: exclude });
      if (result.error) throw result.error;
      await refresh(true);
      showSnackbar(exclude ? 'Wiadomość wykluczona z korespondencji i analizy.' : 'Korespondencja została powiązana z zapytaniem.', 'success');
    } finally { setMutating(false); }
  };
  return <section className="space-y-4 rounded-xl bg-[#1c1f33] p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg">Korespondencja ({messages.length})</h2><div className="flex flex-wrap gap-2">
      <button className={button} disabled={refreshing} onClick={() => void refresh(true)} aria-label="Odśwież korespondencję"><RefreshCw className="h-4 w-4" /></button>
      {canManage && <><button className={button} disabled={mutating || analyzing} onClick={() => setShowPicker(!showPicker)}><Plus className="h-4 w-4" />Dołącz wiadomość lub konwersację</button>
      <button className={button} disabled={analyzing || mutating || loading || !!error || !messages.length} onClick={onAnalyze}>Otwórz analizę</button></>}
    </div></div>
    <p className="text-xs text-white/50">Wiadomości są uporządkowane od najstarszej. Kolejne odpowiedzi pojawiają się po odświeżeniu. Powiązania pozostają przy zapytaniu również po utworzeniu wydarzenia. Analiza obejmuje treść maili, bez zawartości załączników.</p>
    {savedAt && <p role="status" className="text-xs text-white/40">{refreshing ? 'Sprawdzam nowe wiadomości w tle…' : `Ostatnia aktualizacja: ${new Date(savedAt).toLocaleTimeString('pl-PL')}`}</p>}
    {error && <p role="alert" className="text-sm text-amber-200">{error}</p>}
    {showPicker && canManage && <EmailThreadPicker onAttach={async (m, thread) => { await change(m, thread); setShowPicker(false); }} />}
    {loading ? <p className="text-sm text-white/50">Wczytywanie korespondencji…</p> : !messages.length && !error && <p className="text-sm text-white/50">Brak powiązanych wiadomości dostępnych w Twoich skrzynkach.</p>}
    <div className="space-y-2">{messages.map(m => <details key={key(m)} className="rounded-lg bg-black/15 p-3">
      <summary className="cursor-pointer text-sm"><span className="text-[#d3bb73]">{m.type === 'received' ? 'Odebrane' : 'Wysłane'}</span> · {date(m.message_at)} · {m.subject || '(bez tematu)'}</summary>
      <p className="mt-2 break-words text-xs text-white/50">{m.from_address} → {m.to_address}</p>
      <div className="my-3 max-h-96 overflow-y-auto whitespace-pre-wrap break-words text-sm text-white/75">{m.body || 'Brak treści wiadomości.'}</div>
      <div className="flex flex-wrap gap-3"><Link className={button} href={`/crm/messages/${m.id}?type=${m.type}`}><Mail className="h-4 w-4" />Otwórz wiadomość</Link>
      {canManage && <button className={button} disabled={mutating || analyzing} onClick={() => void change(m, true, true).catch(e => showSnackbar(friendlyError(e), 'error'))}><X className="h-4 w-4" />Wyklucz wiadomość</button>}</div>
    </details>)}</div>
    {canManage && excluded.length > 0 && <details><summary className="text-sm text-white/50">Wykluczone wiadomości ({excluded.length})</summary>{excluded.map((m, i) => <div key={key(m)} className="mt-2 flex items-center gap-3 text-sm"><Link href={`/crm/messages/${m.id}?type=${m.type}`}>Otwórz wykluczoną wiadomość {i + 1}</Link><button className={button} disabled={mutating || analyzing} onClick={() => void change(m, true).catch(e => showSnackbar(friendlyError(e), 'error'))}>Przywróć</button></div>)}</details>}
  </section>;
}
