'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useEditMode } from '@/contexts/EditModeContext';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { supabase } from '@/lib/supabase/browser';
import type { AgencyContent } from '@/lib/SEO/eventAgencyContent';

type Hero = { desktop: string; mobile?: string; alt?: string } | null;
type Props = { pageSlug: string; content: AgencyContent; hero: Hero; imageAlt: string; metaTitle: string; description: string };
const field = 'mt-2 block w-full rounded-lg border border-white/10 bg-[#180b14] p-3 text-base leading-6 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#d3bb73]/40';
const button = 'min-h-11 rounded-lg bg-white/10 px-4 py-3 text-sm text-white';

export default function AgencyEditor({ pageSlug, content, hero, imageAlt, metaTitle, description }: Props) {
  const { isEditMode } = useEditMode();
  const { showSnackbar } = useSnackbar();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<AgencyContent>({ ...content, title: metaTitle, description });
  const [checks, setChecks] = useState(content.checks.join('\n'));
  const [alt, setAlt] = useState(imageAlt);
  const [file, setFile] = useState<File | null>(null);
  const [defaultPhoto, setDefaultPhoto] = useState(false);
  const [saving, setSaving] = useState(false);
  const open = () => { setDraft({ ...content, title: metaTitle, description }); setChecks(content.checks.join('\n')); setAlt(imageAlt); setFile(null); setDefaultPhoto(false); setEditing(true); };
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const { data: latest, error: readError } = await supabase.from('schema_org_page_metadata').select('id,custom_schema,og_image')
        .eq('page_slug', pageSlug).maybeSingle();
      if (readError) throw readError;
      let nextHero: Hero = defaultPhoto ? null : hero ? { ...hero, alt: alt.trim() } : null;
      if (file && !defaultPhoto) {
        const { uploadOptimizedImage } = await import('@/lib/storage');
        const variants = await uploadOptimizedImage(file, 'event-agency');
        nextHero = { desktop: variants.desktop, mobile: variants.mobile, alt: alt.trim() };
      }
      const nextContent = { ...draft, checks: checks.split('\n').map(item => item.trim()).filter(Boolean),
        faq: draft.faq.map(item => ({ question: item.question.trim(), answer: item.answer.trim() })) };
      if (!nextContent.checks.length || !nextContent.faq.length) throw new Error('Uzupełnij co najmniej jeden punkt i jedno pytanie.');
      const payload = {
        page_slug: pageSlug, title: draft.title.trim(), description: draft.description.trim(), is_active: true,
        og_image: defaultPhoto ? null : file ? nextHero?.desktop : latest?.og_image || null,
        custom_schema: { ...(latest?.custom_schema || {}), agencyContent: nextContent, agencyHero: nextHero },
        updated_at: new Date().toISOString(),
      };
      // One row contains the page content, metadata and image; a failed save publishes none of them.
      const result = latest?.id
        ? await supabase.from('schema_org_page_metadata').update(payload).eq('id', latest.id).select('id').single()
        : await supabase.from('schema_org_page_metadata').insert(payload).select('id').single();
      if (result.error) throw result.error;
      setEditing(false);
      showSnackbar('Zapisano stronę agencji eventowej', 'success');
      router.refresh();
    } catch {
      showSnackbar('Nie udało się zapisać strony. Uzupełnij pola i spróbuj ponownie.', 'error');
    } finally { setSaving(false); }
  }
  if (!isEditMode) return null;
  return <aside className="mx-auto max-w-7xl px-5 py-5 text-white sm:px-6">
    <button type="button" className={button} onClick={open}>Edytuj stronę agencji, zdjęcie i SEO</button>
    {editing && <form onSubmit={save} className="mt-5 space-y-5 rounded-2xl bg-[#2b1422] p-5 sm:p-8">
      <p className="text-sm leading-6 text-white/65">Edytujesz tę stronę. Opisuj faktyczny zakres i doświadczenie; dane lokalizacji projektu zmieniaj w portfolio. Zachowaj czytelne rozróżnienie miejsca realizacji i obszaru obsługi.</p>
      <div className="grid gap-5 md:grid-cols-2">
        <label className="text-sm">Tytuł wyniku wyszukiwania<input required maxLength={120} className={field} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
        <label className="text-sm">Nagłówek strony<input required maxLength={160} className={field} value={draft.heading} onChange={e => setDraft({ ...draft, heading: e.target.value })} /></label>
      </div>
      <label className="block text-sm">Opis wyniku wyszukiwania<textarea required rows={2} maxLength={400} className={field} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} /></label>
      <label className="block text-sm">Tekst pod nagłówkiem<textarea required rows={3} className={field} value={draft.lead} onChange={e => setDraft({ ...draft, lead: e.target.value })} /></label>
      <div className="grid gap-5 md:grid-cols-2">
        <label className="text-sm">Zdjęcie nagłówka<input key={editing ? 'open' : 'closed'} disabled={defaultPhoto} type="file" accept="image/jpeg,image/png,image/webp" className={field} onChange={e => setFile(e.target.files?.[0] || null)} /></label>
        <label className="text-sm">Opis własnego zdjęcia<input className={field} value={alt} onChange={e => setAlt(e.target.value)} /></label>
      </div>
      <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={defaultPhoto} onChange={e => setDefaultPhoto(e.target.checked)} />Przywróć domyślne zdjęcie z realizacji MAVINCI</label>
      <label className="block text-sm">Nagłówek opisu współpracy<input required className={field} value={draft.localHeading} onChange={e => setDraft({ ...draft, localHeading: e.target.value })} /></label>
      <label className="block text-sm">Opis współpracy i planowania<textarea required rows={7} className={field} value={draft.localText} onChange={e => setDraft({ ...draft, localText: e.target.value })} /></label>
      <label className="block text-sm">Pytania do briefu — jeden punkt w wierszu<textarea required rows={4} className={field} value={checks} onChange={e => setChecks(e.target.value)} /></label>
      <fieldset className="space-y-4"><legend className="mb-4 text-lg">Propozycje wydarzeń</legend>{draft.scenarios.map((item, i) => <div key={i} className="rounded-xl bg-white/[0.04] p-4">
        <label className="block text-sm">Nazwa formatu<input required className={field} value={item.title} onChange={e => setDraft({ ...draft, scenarios: draft.scenarios.map((row, n) => n === i ? { ...row, title: e.target.value } : row) })} /></label>
        <label className="mt-3 block text-sm">Opis<textarea required rows={3} className={field} value={item.description} onChange={e => setDraft({ ...draft, scenarios: draft.scenarios.map((row, n) => n === i ? { ...row, description: e.target.value } : row) })} /></label>
      </div>)}</fieldset>
      <fieldset className="space-y-4"><legend className="mb-4 text-lg">Pytania i odpowiedzi</legend>{draft.faq.map((item, i) => <div key={i} className="rounded-xl bg-white/[0.04] p-4">
        <label className="block text-sm">Pytanie<input required className={field} value={item.question} onChange={e => setDraft({ ...draft, faq: draft.faq.map((row, n) => n === i ? { ...row, question: e.target.value } : row) })} /></label>
        <label className="mt-3 block text-sm">Odpowiedź<textarea required rows={3} className={field} value={item.answer} onChange={e => setDraft({ ...draft, faq: draft.faq.map((row, n) => n === i ? { ...row, answer: e.target.value } : row) })} /></label>
        {draft.faq.length > 1 && <button type="button" className="mt-2 min-h-11 text-sm text-white/65" onClick={() => setDraft({ ...draft, faq: draft.faq.filter((_, n) => n !== i) })}>Usuń pytanie</button>}
      </div>)}<button type="button" className={button} onClick={() => setDraft({ ...draft, faq: [...draft.faq, { question: '', answer: '' }] })}>Dodaj pytanie</button></fieldset>
      <div className="flex gap-4"><button disabled={saving} className="min-h-12 rounded-lg bg-[#d3bb73] px-5 text-sm text-[#190f1b] disabled:opacity-50">{saving ? 'Zapisywanie…' : 'Zapisz stronę'}</button><button type="button" disabled={saving} className={button} onClick={() => setEditing(false)}>Anuluj</button></div>
    </form>}
  </aside>;
}
