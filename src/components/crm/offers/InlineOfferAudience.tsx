'use client';
import { useEffect, useState } from 'react';
import OfferAudienceFields, { type AudienceFields } from './OfferAudienceFields';
import type { OfferAudience } from '@/lib/CRM/Offers/audiencePricing';

const toFields = (a: OfferAudience): AudienceFields => ({
  guest_count: a.guest_count == null ? '' : String(a.guest_count),
  guests_per_table: String(a.guests_per_table ?? 10),
  table_count: a.table_count == null ? '' : String(a.table_count),
});
export default function InlineOfferAudience({ audience, needsTables, required, loading, saving, loadError, disabled, onSave, onRetry, onDirtyChange }: {
  audience: OfferAudience; needsTables: boolean; required: boolean;
  loading: boolean; saving: boolean; disabled?: boolean; loadError: string | null;
  onSave: (value: OfferAudience) => Promise<OfferAudience>;
  onRetry: () => void; onDirtyChange: (value: boolean) => void;
}) {
  const [draft, setDraft] = useState(() => toFields(audience));
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => { setDraft(toFields(audience)); onDirtyChange(false); }, [audience.guest_count, audience.guests_per_table, audience.table_count, onDirtyChange]);
  const change = (next: AudienceFields) => {
    setDraft(next); setSaved(false); setError('');
    onDirtyChange(JSON.stringify(next) !== JSON.stringify(toFields(audience)));
  };
  const save = async () => {
    if (required && draft.guest_count === '') { setError('Wpisz liczbę osób, aby obliczyć cenę tego pakietu.'); return; }
    setError(''); setSaved(false);
    try {
      const result = await onSave({ guest_count: draft.guest_count === '' ? null : Number(draft.guest_count), guests_per_table: Number(draft.guests_per_table), table_count: draft.table_count === '' ? null : Number(draft.table_count) });
      setDraft(toFields(result)); onDirtyChange(false); setSaved(true);
    } catch (e) { setError(e instanceof Error ? e.message : 'Nie udało się zapisać liczby osób.'); }
  };
  return <section aria-label="Uczestnicy oferty" className="space-y-3 rounded-xl bg-white/5 p-4">
    <h3 className="text-sm font-medium uppercase">Uczestnicy oferty</h3>
    <p className="text-xs text-white/60">Uzupełnij tutaj dane do wyceny. Zapis dotyczy całej oferty i przelicza jej powiązane pozycje.</p>
    {loading ? <p role="status" className="text-sm text-white/60">Wczytywanie danych uczestników…</p> : loadError ? <div role="alert"><p className="text-sm text-amber-200">{loadError}</p><button type="button" onClick={onRetry} className="mt-2 text-sm text-[#d3bb73]">Wczytaj ponownie</button></div> : <fieldset disabled={saving || disabled} className="space-y-3">
      <OfferAudienceFields value={draft} onChange={change} needsTables={needsTables} required={required} />
      {error && <p role="alert" className="text-sm text-amber-200">{error}</p>}
      {saved && <p role="status" className="text-sm text-green-200">Zapisano dane uczestników. Cena została przeliczona.</p>}
      <button type="button" disabled={saving || disabled} onClick={() => void save()} className="rounded-lg bg-[#d3bb73] px-3 py-2 text-sm text-[#250914] disabled:opacity-50">{saving ? 'Zapisuję i przeliczam…' : 'Zapisz liczbę osób i przelicz'}</button>
    </fieldset>}
  </section>;
}
