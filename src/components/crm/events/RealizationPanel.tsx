'use client';
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { Modal } from '@/components/UI/Modal';
import { OPERATIONAL_LABELS } from '@/lib/CRM/events/operationalStages';
export function RealizationPanel({ eventId }: { eventId: string }) {
  const [data, setData] = useState<any>(null),
    [notes, setNotes] = useState(''),
    [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const load = useCallback(async () => {
    const result = await supabase.rpc('get_event_realization_assignment', { p_event_id: eventId });
    if (result.error) {
      setError('Nie udało się odczytać kierownika realizacji.');
      return;
    }
    setData(result.data);
    setError('');
  }, [eventId]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 60000);
    window.addEventListener('realization-manager-changed', load);
    return () => {
      clearInterval(timer);
      window.removeEventListener('realization-manager-changed', load);
    };
  }, [load]);
  const run = async (action: 'start' | 'complete') => {
    if (busy || (action === 'complete' && !notes.trim())) return;
    setBusy(true);
    setError('');
    try {
      const r = await supabase.rpc('advance_realization', {
        p_event_id: eventId,
        p_action: action,
        p_notes: action === 'complete' ? notes.trim() : null,
      });
      if (r.error) throw r.error;
      setConfirm(false);
      await load();
    } catch (e: any) {
      setError(e.message || 'Nie udało się zapisać.');
    } finally {
      setBusy(false);
    }
  };
  if (!data && !error) return null;
  const button = 'mt-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#210811] disabled:opacity-50';
  return (
    <section className="mb-4 rounded-xl bg-white/5 p-4" aria-busy={busy}>
      <h3 className="font-medium">Kierownik realizacji</h3>
      <p className="mt-2 text-sm">
        {data?.realization?.manager_name || 'Nie wyznaczono kierownika'}
        {data?.status && ` · ${OPERATIONAL_LABELS[data.status] || 'Nowe wydarzenie'}`}
      </p>
      {data?.is_manager && !data?.realization?.started_at && data?.status === 'ready_for_live' && (
        <button disabled={busy} onClick={() => void run('start')} className={button}>
          {busy ? 'Zapisywanie…' : 'Przejmij realizację'}
        </button>
      )}
      {data?.realization?.started_at && (
        <p className="mt-2 text-sm">
          Przejęto: {new Date(data.realization.started_at).toLocaleString('pl-PL')}
        </p>
      )}
      {data?.is_manager &&
        data?.realization?.started_at &&
        !data?.realization?.completed_at &&
        data?.status !== 'cancelled' && (
          <>
            <button disabled={busy} className={button} onClick={() => {
              setNotes('Wszystko OK.');
              setError('');
              setConfirm(true);
            }}>Zrealizowane</button>
            <Modal open={confirm} onClose={() => { if (!busy) setConfirm(false); }} title="Podsumowanie realizacji">
              <form onSubmit={(event) => { event.preventDefault(); void run('complete'); }} aria-busy={busy}>
                <p className="mb-4 text-sm text-[#e5e4e2]/70">Jeśli realizacja przebiegła bez zastrzeżeń, zostaw „Wszystko OK.”. W przeciwnym razie opisz uwagi.</p>
                <label htmlFor={`realization-notes-${eventId}`} className="text-sm">Notatka z realizacji</label>
                <textarea id={`realization-notes-${eventId}`} autoFocus required maxLength={5000} rows={5} value={notes} disabled={busy} onChange={(event) => setNotes(event.target.value)} className="mt-2 block w-full rounded-lg border border-white/10 bg-black/20 p-3" />
                <p className="mt-1 text-right text-xs opacity-60">{notes.length}/5000</p>
                {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  <button type="button" disabled={busy} onClick={() => setConfirm(false)} className="rounded-lg bg-white/5 px-4 py-2">Anuluj</button>
                  <button type="submit" disabled={busy || !notes.trim()} className="rounded-lg bg-[#d3bb73] px-4 py-2 text-[#210811] disabled:opacity-50">{busy ? 'Zapisywanie…' : 'Zapisz i oznacz jako zrealizowane'}</button>
                </div>
              </form>
            </Modal>
          </>
        )}
      {data?.realization?.completed_at && (
        <p className="mt-2 whitespace-pre-wrap text-sm">
          Zrealizowano: {new Date(data.realization.completed_at).toLocaleString('pl-PL')}
          {data.realization.completion_notes && `\nUwagi: ${data.realization.completion_notes}`}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-red-300">
          {error}
        </p>
      )}
    </section>
  );
}
