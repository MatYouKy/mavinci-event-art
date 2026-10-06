'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Phone, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';

type Note = { id: string; body: string; kind: string; created_at: string; metadata?: { author_name?: string } };
export default function InquiryNotesPanel({ inquiryId, canWrite = false, phone, onSaved }: {
  inquiryId: string; canWrite?: boolean; phone?: string; onSaved?: () => void;
}) {
  const { showSnackbar } = useSnackbar();
  const [notes, setNotes] = useState<Note[]>([]);
  const [body, setBody] = useState('');
  const [kind, setKind] = useState('note');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [more, setMore] = useState(false);
  const busy = useRef(false);
  const requestId = useRef<string | null>(null);
  const generation = useRef(0);
  const load = useCallback(async (offset = 0) => {
    const current = ++generation.current;
    setLoading(true); setError('');
    try {
      const result = await supabase.from('inquiry_activity').select('id,body,kind,created_at,metadata')
        .eq('inquiry_id', inquiryId).in('kind', ['note', 'call_note', 'contact'])
        .order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + 49);
      if (result.error) throw result.error;
      if (current !== generation.current) return;
      setNotes(previous => offset ? [...previous, ...(result.data || [])] : result.data || []);
      setMore(result.data?.length === 50);
    } catch { if (current === generation.current) setError('Nie udało się pobrać notatek. Spróbuj ponownie.'); }
    finally { if (current === generation.current) setLoading(false); }
  }, [inquiryId]);
  useEffect(() => { setNotes([]); void load(); return () => { generation.current++; }; }, [load]);
  const save = async () => {
    if (!canWrite || busy.current || !body.trim()) return;
    busy.current = true; setSaving(true); setError('');
    requestId.current ||= crypto.randomUUID();
    try {
      const result = await supabase.rpc('add_inquiry_note', { p_inquiry: inquiryId, p_body: body.trim(), p_kind: kind, p_request_id: requestId.current });
      if (result.error) throw result.error;
      setBody(''); requestId.current = null;
      showSnackbar('Notatka została zapisana', 'success');
      await load(); onSaved?.();
    } catch {
      setError('Nie udało się zapisać notatki. Treść pozostaje w formularzu — spróbuj ponownie.');
      showSnackbar('Nie udało się zapisać notatki', 'error');
    } finally { busy.current = false; setSaving(false); }
  };
  const number = (phone || '').replace(/[^\d+]/g, '');
  return <section className="space-y-4 rounded-xl bg-black/10 p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg">Notatki i rozmowy</h2>
      {number && <a href={`tel:${number}`} className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73]/15 px-4 py-2 text-[#d3bb73]"><Phone className="h-4 w-4" />Zadzwoń: {phone}</a>}
    </div>
    {canWrite && <form className="space-y-3" onSubmit={event => { event.preventDefault(); void save(); }}>
      <fieldset disabled={saving} className="space-y-3">
        <label className="block text-sm">Rodzaj wpisu<select value={kind} onChange={e => { setKind(e.target.value); requestId.current = null; }} className="ml-3 rounded-lg bg-black/20 p-2"><option value="note">Notatka</option><option value="call_note">Notatka z odbytej rozmowy</option></select></label>
        <label className="block text-sm">Treść<textarea required maxLength={10000} rows={4} value={body} onChange={e => { setBody(e.target.value); requestId.current = null; }} className="mt-2 w-full rounded-lg bg-black/20 p-3" placeholder="Ustalenia, potrzeby klienta, uwagi i kolejne kroki…" /></label>
        <button disabled={!body.trim() || saving} className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#250914] disabled:opacity-50">{saving && <Loader2 className="h-4 w-4 animate-spin" />}{saving ? 'Zapisywanie…' : 'Dodaj notatkę'}</button>
      </fieldset>
    </form>}
    {error && <p role="alert" className="text-sm text-red-300">{error} <button type="button" onClick={() => void load()} className="underline">Odśwież notatki</button></p>}
    {notes.map(note => <article key={note.id} className="rounded-lg bg-black/15 p-4"><p className="mb-2 text-xs text-[#e5e4e2]/60">{note.kind === 'call_note' ? 'Rozmowa telefoniczna' : note.kind === 'contact' ? 'Kontakt z klientem' : 'Notatka'} · {new Date(note.created_at).toLocaleString('pl-PL')}{note.metadata?.author_name ? ` · ${note.metadata.author_name}` : ''}</p><p className="whitespace-pre-wrap break-words text-sm">{note.body}</p></article>)}
    {loading ? <p role="status" className="text-sm">Ładowanie notatek…</p> : !error && !notes.length ? <p className="text-sm text-[#e5e4e2]/60">Brak notatek do tego zapytania.</p> : null}
    {more && <button disabled={loading} onClick={() => void load(notes.length)} className="text-sm text-[#d3bb73]">Pokaż starsze notatki</button>}
  </section>;
}
