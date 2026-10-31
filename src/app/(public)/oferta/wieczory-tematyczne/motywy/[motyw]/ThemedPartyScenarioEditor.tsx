'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useEditMode } from '@/contexts/EditModeContext';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { supabase } from '@/lib/supabase/browser';
import { SCENARIO_SECTION, type ScenarioContent } from '@/lib/SEO/themedPartyScenarios';

type Props = { slug: string; recordId: string; updatedAt: string | null; content: ScenarioContent; alt: string };
const field = 'mt-2 w-full rounded-lg border border-white/10 bg-[#190f1b] p-3 text-base text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#d3bb73]/40';
const textFields: { key: 'title' | 'metaTitle' | 'description' | 'lead' | 'occasion' | 'summary' | 'evidenceIntro'; label: string; rows: number }[] = [
  { key: 'title', label: 'Nagłówek H1', rows: 2 }, { key: 'metaTitle', label: 'Tytuł wyniku wyszukiwania', rows: 2 },
  { key: 'description', label: 'Opis wyniku wyszukiwania', rows: 3 }, { key: 'lead', label: 'Wprowadzenie przy zdjęciu', rows: 4 },
  { key: 'occasion', label: 'Dla jakiego wydarzenia', rows: 3 }, { key: 'summary', label: 'Opis koncepcji', rows: 6 },
  { key: 'evidenceIntro', label: 'Wprowadzenie do powiązanych realizacji', rows: 4 },
];

export default function ThemedPartyScenarioEditor({ slug, recordId, updatedAt, content, alt }: Props) {
  const { isEditMode } = useEditMode();
  const { showSnackbar } = useSnackbar();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content);
  const [planning, setPlanning] = useState(content.planning.join('\n'));
  const [imageAlt, setImageAlt] = useState(alt);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const { data: latest, error } = await supabase.from('site_images').select('id,image_metadata,updated_at')
        .eq('id', recordId).eq('section', SCENARIO_SECTION).eq('name', slug).single();
      if (error || !latest) throw new Error('Nie udało się odczytać zapisanego scenariusza.');
      if (latest.updated_at !== updatedAt) throw new Error('Scenariusz został zmieniony w innym miejscu. Odśwież stronę przed dalszą edycją.');
      const normalized: ScenarioContent = { ...draft, planning: planning.split('\n').map(item => item.trim()).filter(Boolean), faq: draft.faq.map(item => ({ question: item.question.trim(), answer: item.answer.trim() })) };
      if (!normalized.planning.length) throw new Error('Dodaj przynajmniej jeden punkt ustaleń przed wyceną.');
      const metadata = latest.image_metadata && typeof latest.image_metadata === 'object' && !Array.isArray(latest.image_metadata) ? latest.image_metadata : {};
      const values: Record<string, unknown> = { image_metadata: { ...metadata, content: normalized }, alt_text: imageAlt.trim(), updated_at: new Date().toISOString() };
      if (file) {
        const { uploadOptimizedImage } = await import('@/lib/storage');
        const images = await uploadOptimizedImage(file, 'themed-party-scenarios');
        values.desktop_url = images.desktop;
        values.mobile_url = images.mobile;
        values.image_metadata = { ...metadata, content: normalized, thumbnail: images.thumbnail };
      }
      let query = supabase.from('site_images').update(values).eq('id', recordId).eq('section', SCENARIO_SECTION);
      query = latest.updated_at ? query.eq('updated_at', latest.updated_at) : query.is('updated_at', null);
      const result = await query.select('id').single();
      if (result.error) throw new Error('Zapis nie został potwierdzony. Odśwież stronę, aby sprawdzić, czy ktoś nie zmienił scenariusza.');
      setEditing(false);
      setFile(null);
      showSnackbar('Zapisano treść, metadane i zdjęcie scenariusza.', 'success');
      router.refresh();
    } catch (err) {
      showSnackbar(err instanceof Error ? err.message : 'Nie udało się zapisać scenariusza.', 'error');
    } finally { setSaving(false); }
  }

  if (!isEditMode) return null;
  return <aside className="mx-auto max-w-7xl px-5 py-6 sm:px-6">
    <button type="button" onClick={() => { setDraft(content); setPlanning(content.planning.join('\n')); setImageAlt(alt); setFile(null); setEditing(!editing); }} className="min-h-11 rounded-lg bg-white/10 px-5 text-sm">Edytuj scenariusz, SEO i zdjęcie</button>
    {editing && <form onSubmit={save} className="mt-6 space-y-6 rounded-2xl bg-[#291320] p-5 sm:p-8">
      <p className="text-sm leading-6 text-white/70">Opisuj możliwości i uzgodniony zakres. Powiązane realizacje dokumentują faktyczne projekty; nie przypisuj im niepotwierdzonych miejsc ani elementów. Zapisane treści i SEO są odczytywane po stronie serwera.</p>
      <fieldset disabled={saving} className="space-y-5">
        {textFields.map(item => <label key={item.key} className="block text-sm">{item.label}<textarea required maxLength={item.key === 'metaTitle' ? 150 : item.key === 'description' ? 350 : 5000} rows={item.rows} value={draft[item.key]} onChange={e => setDraft({ ...draft, [item.key]: e.target.value })} className={field} /></label>)}
        <label className="block text-sm">Zdjęcie nagłówka<input type="file" accept="image/jpeg,image/png,image/webp" className={field} onChange={e => setFile(e.target.files?.[0] || null)} /><span className="mt-2 block text-xs text-white/60">Nowe zdjęcie otrzyma wersję na telefon, komputer i miniaturę.</span></label>
        <label className="block text-sm">Opis zdjęcia<input required maxLength={250} className={field} value={imageAlt} onChange={e => setImageAlt(e.target.value)} /></label>
        {(['program', 'scope'] as const).map(key => <fieldset key={key} className="space-y-4"><legend className="mb-3 text-lg text-[#d3bb73]">{key === 'program' ? 'Przykładowy przebieg' : 'Zakres obsługi'}</legend>
          {draft[key].map((item, index) => <div key={index} className="rounded-xl bg-white/[0.04] p-4"><label className="block text-sm">Nagłówek {index + 1}<input required maxLength={180} className={field} value={item.heading} onChange={e => setDraft({ ...draft, [key]: draft[key].map((row, i) => i === index ? { ...row, heading: e.target.value } : row) })} /></label><label className="mt-3 block text-sm">Opis<textarea required maxLength={2000} rows={4} className={field} value={item.text} onChange={e => setDraft({ ...draft, [key]: draft[key].map((row, i) => i === index ? { ...row, text: e.target.value } : row) })} /></label><button type="button" disabled={draft[key].length <= 1} className="mt-2 min-h-11 text-sm text-white/60 disabled:opacity-40" onClick={() => setDraft({ ...draft, [key]: draft[key].filter((_, i) => i !== index) })}>Usuń punkt</button></div>)}
          <button type="button" className="min-h-11 rounded-lg bg-white/10 px-4 text-sm" onClick={() => setDraft({ ...draft, [key]: [...draft[key], { heading: '', text: '' }] })}>Dodaj punkt</button>
        </fieldset>)}
        <label className="block text-sm">Ustalenia przed wyceną — jeden punkt w wierszu<textarea required rows={5} maxLength={5000} className={field} value={planning} onChange={e => setPlanning(e.target.value)} /></label>
        <fieldset className="space-y-4"><legend className="mb-3 text-lg text-[#d3bb73]">Pytania i odpowiedzi</legend>{draft.faq.map((item, index) => <div key={index} className="rounded-xl bg-white/[0.04] p-4"><label className="block text-sm">Pytanie<input required maxLength={250} className={field} value={item.question} onChange={e => setDraft({ ...draft, faq: draft.faq.map((row, i) => i === index ? { ...row, question: e.target.value } : row) })} /></label><label className="mt-3 block text-sm">Odpowiedź<textarea required maxLength={2000} rows={4} className={field} value={item.answer} onChange={e => setDraft({ ...draft, faq: draft.faq.map((row, i) => i === index ? { ...row, answer: e.target.value } : row) })} /></label><button type="button" className="mt-2 min-h-11 text-sm text-white/60" onClick={() => setDraft({ ...draft, faq: draft.faq.filter((_, i) => i !== index) })}>Usuń pytanie</button></div>)}<button type="button" className="min-h-11 rounded-lg bg-white/10 px-4 text-sm" onClick={() => setDraft({ ...draft, faq: [...draft.faq, { question: '', answer: '' }] })}>Dodaj pytanie</button></fieldset>
      </fieldset>
      <div className="flex flex-wrap gap-3"><button disabled={saving} className="min-h-12 rounded-lg bg-[#d3bb73] px-6 text-sm text-[#190f1b] disabled:opacity-60">{saving ? 'Zapisywanie…' : 'Zapisz scenariusz'}</button><button type="button" disabled={saving} onClick={() => setEditing(false)} className="min-h-12 px-4 text-sm">Anuluj</button></div>
    </form>}
  </aside>;
}
