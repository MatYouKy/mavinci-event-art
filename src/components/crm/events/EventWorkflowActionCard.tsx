'use client';
import { useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';

export type EventWorkflowAction = {
  event_id: string; event_name: string; requirement_id: string; stage_id: string; label: string;
  stage_name: string; status: 'actionable' | 'waiting' | 'snoozed'; due_at: string | null;
  starts_at: string | null; snoozed_until?: string; snooze_note?: string; action_url: string;
};
const dateLabel = (value?: string | null) => value ? new Date(value).toLocaleString('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
export default function EventWorkflowActionCard({ action, canSnooze, onChanged }: { action: EventWorkflowAction; canSnooze: boolean; onChanged: () => void | Promise<void> }) {
  const [until, setUntil] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const { showSnackbar } = useSnackbar();
  const snooze = async (resume = false) => {
    const when = resume ? null : new Date(until);
    if (!resume && (!when || Number.isNaN(when.getTime()) || when.getTime() <= Date.now())) { showSnackbar('Wybierz przyszły termin przypomnienia.', 'error'); return; }
    setSaving(true);
    try {
      const { error } = await supabase.rpc('snooze_event_workflow', { p_event_id: action.event_id, p_requirement_id: action.requirement_id, p_until: when?.toISOString() ?? null, p_note: resume ? null : note });
      if (error) throw error;
      showSnackbar(resume ? 'Wznowiono przypomnienia.' : 'Przypomnienie zostało odroczone.', 'success');
      await onChanged();
    } catch (error) { showSnackbar((error as { message?: string }).message || 'Nie udało się zapisać przypomnienia.', 'error'); }
    finally { setSaving(false); }
  };
  return <article className="rounded-xl bg-[#d3bb73]/[0.07] p-4">
    <p className="text-xs text-[#e5e4e2]/55">{action.event_name} · {action.stage_name}</p>
    <p className="mt-1 font-medium text-[#e5e4e2]">Następny krok: {action.label}</p>
    <p className="mt-1 text-xs text-[#e5e4e2]/60">{action.status === 'snoozed' ? `Przypomnienie wstrzymane do ${dateLabel(action.snoozed_until)}` : action.status === 'waiting' ? `Zaplanowane od ${dateLabel(action.starts_at)}` : `Termin: ${dateLabel(action.due_at)}`}</p>
    {action.snooze_note && <p className="mt-1 text-sm text-[#e5e4e2]/60">{action.snooze_note}</p>}
    <Link href={action.action_url} className="mt-3 inline-block text-sm text-[#d3bb73]">Otwórz wydarzenie →</Link>
    {canSnooze && <details className="mt-3 text-sm text-[#e5e4e2]/70">
      <summary className="cursor-pointer">Czekam na klienta / przypomnij później</summary>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">Termin przypomnienia<input type="datetime-local" value={until} disabled={saving} onChange={e => setUntil(e.target.value)} className="rounded-lg border border-white/10 bg-black/15 p-2" /></label>
        <label className="flex min-w-48 flex-1 flex-col gap-1">Powód — opcjonalnie<input value={note} maxLength={500} disabled={saving} onChange={e => setNote(e.target.value)} placeholder="Np. czekam na decyzję klienta" className="rounded-lg border border-white/10 bg-black/15 p-2" /></label>
        <button type="button" disabled={saving || !until} onClick={() => void snooze()} className="rounded-lg bg-[#d3bb73]/15 px-3 py-2 text-[#d3bb73] disabled:opacity-50">{saving ? 'Zapisywanie…' : 'Odrocz przypomnienie'}</button>
        {action.status === 'snoozed' && <button type="button" disabled={saving} onClick={() => void snooze(true)} className="px-3 py-2 text-[#d3bb73]">Wznów teraz</button>}
      </div>
    </details>}
  </article>;
}
