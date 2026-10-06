'use client';

import { useEffect, useRef, useState } from 'react';
import { Modal } from '@/components/UI/Modal';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';

type Candidate = { id: string; name: string; surname: string };
export default function InquiryHandoffModal({ inquiryId, ownerId, title, onClose, onSaved }: {
  inquiryId: string;
  ownerId: string;
  title: string;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { showSnackbar } = useSnackbar();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [target, setTarget] = useState('');
  const [mode, setMode] = useState<'transfer' | 'release'>('transfer');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const savingRef = useRef(false);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { data, error: loadError } = await supabase.rpc('get_inquiry_handoff_candidates', { p_inquiry_id: inquiryId });
        if (loadError) throw loadError;
        if (active) setCandidates(data || []);
      } catch (cause: any) {
        if (active) setError(cause?.code === 'PGRST202' ? 'Obsługa przekazywania zapytań wymaga aktualizacji bazy danych.' : cause?.message || 'Nie udało się pobrać listy opiekunów.');
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [inquiryId]);
  const close = () => { if (!savingRef.current) onClose(); };
  const save = async () => {
    if (savingRef.current || loading || (mode === 'transfer' && !target)) return;
    savingRef.current = true; setSaving(true); setError('');
    try {
      const { error: saveError } = await supabase.rpc('reassign_inquiry', {
        p_inquiry_id: inquiryId, p_expected_owner_id: ownerId, p_new_owner_id: mode === 'release' ? null : target,
      });
      if (saveError) throw saveError;
      showSnackbar(mode === 'release' ? 'Zapytanie wróciło do wspólnej puli.' : 'Zapytanie przekazano nowemu opiekunowi.', 'success');
      onClose();
      await onSaved();
    } catch (cause: any) { setError(cause?.message || 'Nie udało się zmienić opiekuna.'); }
    finally { savingRef.current = false; setSaving(false); }
  };
  return <Modal open onClose={close} title="Przekaż / oddaj zapytanie">
    <div className="space-y-4 text-sm">
      <p className="text-white/65">{title}</p>
      <div className="flex flex-wrap gap-2">{(['transfer','release'] as const).map(value =>
        <button key={value} type="button" disabled={saving} aria-pressed={mode === value} onClick={() => setMode(value)}
          className={`rounded-lg px-3 py-2 ${mode === value ? 'bg-[#d3bb73]/15 text-[#d3bb73]' : 'bg-white/5 text-white/65'}`}>
          {value === 'transfer' ? 'Przekaż osobie' : 'Oddaj do puli'}
        </button>)}</div>
      {loading ? <p>Wczytywanie opiekunów…</p> : mode === 'transfer' ? <label className="block space-y-2">
        <span>Nowy opiekun</span>
        <select value={target} onChange={event => setTarget(event.target.value)} disabled={saving} className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2">
          <option value="">Wybierz osobę</option>{candidates.map(person => <option key={person.id} value={person.id}>{person.name} {person.surname}</option>)}
        </select>
        {!candidates.length && !error && <p className="text-white/50">Brak dostępnych opiekunów w Twoim zakresie uprawnień. Możesz oddać zapytanie do puli.</p>}
      </label> : <p className="text-white/65">Zapytanie trafi do „Nieprzypisanych”. Inna osoba będzie mogła je przejąć.</p>}
      <p className="text-xs text-white/45">Po zmianie opiekuna zapytanie może zniknąć z Twojej listy. Historia, oferty i kalkulacje pozostaną przy zapytaniu.</p>
      {error && <p role="alert" className="text-amber-200">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={close} disabled={saving} className="rounded-lg bg-white/5 px-4 py-2 disabled:opacity-50">Anuluj</button>
        <button type="button" onClick={() => void save()} disabled={loading || saving || (mode === 'transfer' && !target)} className="rounded-lg bg-[#d3bb73] px-4 py-2 text-[#250914] disabled:opacity-50">
          {saving ? 'Zapisywanie…' : mode === 'release' ? 'Oddaj do puli' : 'Przekaż zapytanie'}
        </button>
      </div>
    </div>
  </Modal>;
}
