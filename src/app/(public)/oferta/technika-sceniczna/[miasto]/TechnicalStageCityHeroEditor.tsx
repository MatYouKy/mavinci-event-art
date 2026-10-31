'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil } from 'lucide-react';
import { useEditMode } from '@/contexts/EditModeContext';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { supabase } from '@/lib/supabase/browser';
import type { TechnicalStageHeroSettings } from './TechnicalStageCityHero';

type Props = { pageSlug: string; cityName: string; title: string; lead: string; settings: TechnicalStageHeroSettings; localSettings: TechnicalStageHeroSettings };
const fieldClass = 'mt-2 w-full rounded-lg border border-white/10 bg-[#190f1b] p-3 text-sm text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#d3bb73]/40';

/** Only authorized editors receive this interactive part of the hero. */
export default function TechnicalStageCityHeroEditor({ pageSlug, cityName, title, lead, settings, localSettings }: Props) {
  const { isEditMode } = useEditMode();
  const { showSnackbar } = useSnackbar();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title);
  const [draftLead, setDraftLead] = useState(lead);
  const [alt, setAlt] = useState(settings.alt_text || 'Technika sceniczna i eventowa MAVINCI');
  const [opacity, setOpacity] = useState(settings.opacity ?? 0.25);
  const [position, setPosition] = useState(settings.image_metadata?.object_position || 'center');
  const [file, setFile] = useState<File | null>(null);
  const [useSharedImage, setUseSharedImage] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      let imageUrl = useSharedImage ? null : localSettings.image_url || null;
      let metadata = useSharedImage ? {} : { ...localSettings.image_metadata };
      if (file && !useSharedImage) {
        const { uploadOptimizedImage } = await import('@/lib/storage');
        const variants = await uploadOptimizedImage(file, 'technical-stage-cities');
        imageUrl = variants.desktop;
        metadata = { ...metadata, desktop: { src: variants.desktop }, mobile: { src: variants.mobile } };
      }
      const { error } = await supabase.from('service_hero_images').upsert({
        page_slug: pageSlug, section: 'hero', is_active: true,
        title: draftTitle.trim(), description: draftLead.trim(),
        image_url: imageUrl, alt_text: alt.trim(), opacity,
        image_metadata: { ...metadata, object_position: position },
        updated_at: new Date().toISOString(),
      }, { onConflict: 'page_slug' });
      if (error) throw error;
      setEditing(false);
      setFile(null);
      showSnackbar(`Zapisano nagłówek strony: ${cityName}`, 'success');
      router.refresh();
    } catch {
      showSnackbar('Nie udało się zapisać nagłówka tego miasta. Zmiany nie zostały potwierdzone.', 'error');
    } finally { setSaving(false); }
  }

  return <>
      {isEditMode && <button type="button" className="ml-3 mt-4 inline-flex min-h-12 items-center gap-2 rounded-full bg-white/10 px-5 py-3 text-sm" onClick={() => { setDraftTitle(title); setDraftLead(lead); setOpacity(settings.opacity ?? 0.25); setAlt(settings.alt_text || 'Technika sceniczna i eventowa MAVINCI'); setPosition(settings.image_metadata?.object_position || 'center'); setFile(null); setUseSharedImage(false); setEditing(true); }}><Pencil size={16} aria-hidden="true" />Edytuj nagłówek tego miasta</button>}
      {editing && <form onSubmit={save} className="mt-8 max-w-3xl space-y-4 rounded-2xl bg-[#291320] p-5 sm:p-7">
        <p className="text-sm leading-6 text-white/70">Zmieniasz tylko stronę „{cityName}”. Tytuł i opis wyniku Google edytujesz osobno w ustawieniach metadanych.</p>
        <label className="block text-sm">Nagłówek H1<input required maxLength={180} className={fieldClass} value={draftTitle} onChange={event => setDraftTitle(event.target.value)} /></label>
        <label className="block text-sm">Wprowadzenie<textarea required maxLength={1500} rows={4} className={fieldClass} value={draftLead} onChange={event => setDraftLead(event.target.value)} /></label>
        <label className="block text-sm">Zdjęcie nagłówka tej strony<input disabled={useSharedImage} type="file" accept="image/jpeg,image/png,image/webp" className={fieldClass} onChange={event => setFile(event.target.files?.[0] || null)} /></label>
        <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={useSharedImage} onChange={event => setUseSharedImage(event.target.checked)} />Użyj wspólnego zdjęcia techniki scenicznej</label>
        <label className="block text-sm">Opis zdjęcia<input className={fieldClass} maxLength={250} value={alt} onChange={event => setAlt(event.target.value)} /></label>
        <label className="block text-sm">Kadr<select className={fieldClass} value={position} onChange={event => setPosition(event.target.value)}><option value="center">Środek</option><option value="top">Góra</option><option value="bottom">Dół</option></select></label>
        <label className="block text-sm">Widoczność zdjęcia w tle: {Math.round(opacity * 100)}%<input type="range" min="0" max="0.65" step="0.05" className="mt-3 block w-full accent-[#d3bb73]" value={opacity} onChange={event => setOpacity(Number(event.target.value))} /></label>
        <div className="flex flex-wrap gap-3"><button disabled={saving} className="min-h-11 rounded-lg bg-[#d3bb73] px-5 py-3 text-sm text-[#190f1b] disabled:opacity-60">{saving ? 'Zapisywanie…' : 'Zapisz nagłówek'}</button><button disabled={saving} type="button" onClick={() => setEditing(false)} className="min-h-11 px-4 text-sm">Anuluj</button></div>
      </form>}
  </>;
}
