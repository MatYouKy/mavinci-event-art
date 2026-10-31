'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useEditMode } from '@/contexts/EditModeContext';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { supabase } from '@/lib/supabase/browser';
import type { ThemedPartyEditorial } from '@/lib/SEO/themedPartyContent';

const field = 'mt-2 w-full rounded-lg border border-white/10 bg-[#190f1b] p-3 text-base text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#d3bb73]/40';
type Props = { citySlug: string; cityName: string; content: ThemedPartyEditorial; recordId: string | null };

export default function ThemedPartyCityContentEditor({ citySlug, cityName, content, recordId }: Props) {
  const { isEditMode } = useEditMode();
  const { showSnackbar } = useSnackbar();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content);
  const [checks, setChecks] = useState(content.planning_checks.join('\n'));
  const [saving, setSaving] = useState(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      // Merge only our fields; preserve other CMS settings and concurrent additions.
      const { data: latest, error: readError } = await supabase.from('seo_city_content')
        .select('id,local_features').eq('page_slug', 'wieczory-tematyczne').eq('city', citySlug).maybeSingle();
      if (readError) throw readError;
      const localFeatures = {
        ...(latest?.local_features && typeof latest.local_features === 'object' ? latest.local_features : {}),
        ...draft, planning_checks: checks.split('\n').map(line => line.trim()).filter(Boolean),
        faq: draft.faq.filter(item => item.question.trim() && item.answer.trim()),
      };
      const values = { local_features: localFeatures, is_active: true, updated_at: new Date().toISOString() };
      const id = latest?.id || recordId;
      const result = id
        ? await supabase.from('seo_city_content').update(values).eq('id', id).select('id').single()
        : await supabase.from('seo_city_content').insert({ ...values, page_slug: 'wieczory-tematyczne', city: citySlug, region: null }).select('id').single();
      if (result.error) throw result.error;
      showSnackbar(`Zapisano treści dla miasta: ${cityName}`, 'success');
      setEditing(false);
      router.refresh();
    } catch {
      showSnackbar('Nie udało się zapisać treści. Spróbuj ponownie.', 'error');
    } finally { setSaving(false); }
  }
  if (!isEditMode) return null;
  return <aside className="mx-auto max-w-7xl px-5 py-6 sm:px-6">
    <div className="flex flex-wrap gap-3 text-sm">
      <button type="button" onClick={() => { setDraft(content); setChecks(content.planning_checks.join('\n')); setEditing(!editing); }} className="min-h-11 rounded-lg bg-white/10 px-4">Edytuj treści: {cityName}</button>
      <Link href="/oferta/wieczory-tematyczne" className="inline-flex min-h-11 items-center rounded-lg bg-white/10 px-4">Edytuj wspólne motywy i galerię</Link>
    </div>
    {editing && <form onSubmit={save} className="mt-6 space-y-5 rounded-2xl bg-[#291320] p-5 sm:p-7">
      <p className="text-sm leading-6 text-white/70">Treści tej lokalizacji są publikowane od razu w HTML. Opisuj zakres obsługi; miejsca realizacji przypisuj wyłącznie do rzeczywistych projektów.</p>
      <label className="block text-sm">Nagłówek wprowadzenia<input required className={field} value={draft.intro_heading} onChange={e => setDraft({ ...draft, intro_heading: e.target.value })} /></label>
      <label className="block text-sm">Wprowadzenie<textarea required rows={6} className={field} value={draft.intro_text} onChange={e => setDraft({ ...draft, intro_text: e.target.value })} /></label>
      <label className="block text-sm">Nagłówek informacji lokalnych<input required className={field} value={draft.planning_heading} onChange={e => setDraft({ ...draft, planning_heading: e.target.value })} /></label>
      <label className="block text-sm">Informacje lokalne i logistyka<textarea required rows={6} className={field} value={draft.planning_text} onChange={e => setDraft({ ...draft, planning_text: e.target.value })} /></label>
      <label className="block text-sm">Co ustalić przed realizacją — jeden punkt w wierszu<textarea required rows={4} className={field} value={checks} onChange={e => setChecks(e.target.value)} /></label>
      <fieldset className="space-y-4"><legend className="mb-4 text-lg">Pytania i odpowiedzi</legend>
        {draft.faq.map((item, i) => <div key={i} className="rounded-xl bg-white/[0.04] p-4">
          <label className="block text-sm">Pytanie {i + 1}<input required className={field} value={item.question} onChange={e => setDraft({ ...draft, faq: draft.faq.map((row, index) => index === i ? { ...row, question: e.target.value } : row) })} /></label>
          <label className="mt-3 block text-sm">Odpowiedź<textarea required rows={3} className={field} value={item.answer} onChange={e => setDraft({ ...draft, faq: draft.faq.map((row, index) => index === i ? { ...row, answer: e.target.value } : row) })} /></label>
          <button type="button" className="mt-2 min-h-11 text-sm text-white/60" onClick={() => setDraft({ ...draft, faq: draft.faq.filter((_, index) => index !== i) })}>Usuń pytanie</button>
        </div>)}
        <button type="button" className="min-h-11 rounded-lg bg-white/10 px-4 text-sm" onClick={() => setDraft({ ...draft, faq: [...draft.faq, { question: '', answer: '' }] })}>Dodaj pytanie</button>
      </fieldset>
      <div className="flex flex-wrap gap-3"><button disabled={saving} className="min-h-12 rounded-lg bg-[#d3bb73] px-5 text-[#190f1b] disabled:opacity-60">{saving ? 'Zapisywanie…' : 'Zapisz treści'}</button><button disabled={saving} type="button" onClick={() => setEditing(false)} className="min-h-12 px-4">Anuluj</button></div>
    </form>}

  </aside>;
}
