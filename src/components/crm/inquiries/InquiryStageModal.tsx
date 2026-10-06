'use client';

import { useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Modal } from '@/components/UI/Modal';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { supabase } from '@/lib/supabase/browser';
import { STAGES, LOST_REASON_CATEGORIES } from '@/lib/CRM/inquiries/pipeline';
import type { InquiryStage } from '@/lib/CRM/inquiries/inquiriesData.server';

type StageUpdate = {
  inquiry_stage: InquiryStage;
  win_probability: number;
  lost_reason: string | null;
  lost_reason_category: string | null;
};

export default function InquiryStageModal({ inquiry, onClose, onSaved }: {
  inquiry: { id: string; inquiry_stage: InquiryStage; lost_reason?: string | null; lost_reason_category?: string | null };
  onClose: () => void;
  onSaved: (saved: StageUpdate) => void;
}) {
  const { showSnackbar } = useSnackbar();
  const [stage, setStage] = useState(inquiry.inquiry_stage);
  const [reason, setReason] = useState(inquiry.lost_reason || '');
  const [category, setCategory] = useState(inquiry.lost_reason_category || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const savingRef = useRef(false);
  const close = () => { if (!savingRef.current) onClose(); };
  const save = async () => {
    if (savingRef.current || stage === inquiry.inquiry_stage) return;
    if (stage === 'lost' && (!category || !reason.trim())) {
      setError('Wybierz kategorię i opisz powód przegrania zapytania.');
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      const { data, error: saveError } = await supabase.from('tasks').update({
        inquiry_stage: stage,
        win_probability: STAGES.find(item => item.id === stage)!.defaultProbability,
        lost_reason: stage === 'lost' ? reason.trim() : null,
        lost_reason_category: stage === 'lost' ? category : null,
      }).eq('id', inquiry.id).eq('is_inquiry', true).eq('inquiry_stage', inquiry.inquiry_stage)
        .is('archived_at', null).select('inquiry_stage,win_probability,lost_reason,lost_reason_category').maybeSingle();
      if (saveError) throw saveError;
      if (!data) throw new Error('Zapytanie zostało zmienione lub nie masz uprawnień do zapisu. Odśwież szczegóły i spróbuj ponownie.');
      showSnackbar(`Etap zapytania: ${STAGES.find(item => item.id === data.inquiry_stage)?.label || 'Zaktualizowany'}`, 'success');
      onSaved(data as StageUpdate);
    } catch (cause: any) {
      setError(cause?.message || 'Nie udało się zmienić etapu zapytania. Spróbuj ponownie.');
      showSnackbar('Nie udało się zmienić etapu zapytania', 'error');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  return <Modal open onClose={close} title="Zmień etap zapytania">
    <form onSubmit={event => { event.preventDefault(); void save(); }} className="space-y-5" aria-busy={saving}>
      <fieldset disabled={saving} className="space-y-4">
        <legend className="mb-3 text-sm text-[#e5e4e2]/65">Wybierz miejsce w lejku zapytań</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {STAGES.map(item => <label key={item.id} className={`flex cursor-pointer items-center gap-3 rounded-lg px-4 py-3 text-sm ${stage === item.id ? 'bg-[#d3bb73]/15 text-[#d3bb73]' : 'bg-black/15 text-[#e5e4e2]/75 hover:bg-black/20'}`}>
            <input type="radio" name="inquiry-stage" value={item.id} checked={stage === item.id} onChange={() => { setStage(item.id); setError(''); }} className="accent-[#d3bb73]" />
            {item.label}
          </label>)}
        </div>
        {stage === 'lost' && <div className="space-y-3">
          <label className="block text-sm">Kategoria utraty *
            <select required value={category} onChange={event => setCategory(event.target.value)} className="mt-2 w-full rounded-lg bg-black/20 px-3 py-2.5">
              <option value="">Wybierz kategorię</option>
              {LOST_REASON_CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="block text-sm">Powód przegrania *
            <textarea required value={reason} onChange={event => setReason(event.target.value)} rows={3} className="mt-2 w-full rounded-lg bg-black/20 px-3 py-2.5" />
          </label>
        </div>}
      </fieldset>
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      <div className="flex justify-end gap-3">
        <button type="button" onClick={close} disabled={saving} className="rounded-lg bg-white/5 px-4 py-2 text-[#e5e4e2] disabled:opacity-50">Anuluj</button>
        <button type="submit" disabled={saving || stage === inquiry.inquiry_stage} className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#250914] disabled:opacity-50">
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}{saving ? 'Zapisywanie…' : 'Zapisz etap'}
        </button>
      </div>
    </form>
  </Modal>;
}
