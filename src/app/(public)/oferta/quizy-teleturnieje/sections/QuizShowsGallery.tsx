'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Edit2, ImagePlus, Star } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/browser';
import { useWebsiteEdit } from '@/hooks/useWebsiteEdit';
import { uploadQuizImage } from '@/lib/quiz-shows/upload';
import { isQuizStockImage, quizImageSrcSet, type QuizGalleryImage } from '@/lib/quiz-shows/types';
import QuizDialog from './QuizDialog';

function GalleryEditor({ image, onSaved, onClose }: { image: QuizGalleryImage; onSaved: () => Promise<void>; onClose: () => void }) {
  const [title, setTitle] = useState(image.title || '');
  const [visible, setVisible] = useState(image.is_visible);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();
  return <QuizDialog title="Opis zdjęcia realizacji" busy={busy} onClose={onClose}><form onSubmit={async event => {
    event.preventDefault(); if (busy) return; setBusy(true); setError('');
    try {
      const { data, error } = await supabase.from('quiz_show_gallery').update({ title: title.trim(), is_visible: visible }).eq('id', image.id).select('id').single();
      if (error || !data) throw new Error('Nie udało się zapisać zdjęcia. Sprawdź uprawnienia do edycji.');
      await onSaved(); router.refresh(); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Nie udało się zapisać zdjęcia.'); }
    finally { setBusy(false); }
  }}><fieldset disabled={busy} className="space-y-5">
    <img src={image.image_url} alt={image.title || 'Podgląd realizacji'} className="max-h-64 w-full rounded-xl object-contain" />
    <label className="block text-sm">Podpis zdjęcia i opis dla czytnika ekranu<input required value={title} onChange={event => setTitle(event.target.value)} placeholder="np. Drużynowy finał podczas wieczoru firmowego" className="mt-2 w-full rounded-xl border border-white/10 bg-[#140910] px-4 py-3 text-base" /></label>
    <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={visible} onChange={event => setVisible(event.target.checked)} className="h-5 w-5 accent-[#d3bb73]" /> Widoczne w galerii</label>
    <p className="text-xs text-white/60">Ukrycie zdjęcia zachowuje plik i pozwala później przywrócić je w edytorze.</p>
    <button type="submit" className="rounded-full bg-[#d3bb73] px-6 py-3 text-[#180a11]">{busy ? 'Zapisywanie…' : 'Zapisz opis'}</button>
  </fieldset>{error && <p role="alert" className="mt-4 text-sm text-red-200">{error}</p>}</form></QuizDialog>;
}

export default function QuizShowsGallery({ initialImages }: { initialImages: QuizGalleryImage[] }) {
  const { canEdit } = useWebsiteEdit();
  const router = useRouter();
  const [images, setImages] = useState(initialImages);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<QuizGalleryImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const refetch = useCallback(async () => {
    let query = supabase.from('quiz_show_gallery').select('*').order('is_primary', { ascending: false }).order('order_index');
    if (!canEdit) query = query.eq('is_visible', true);
    const { data, error } = await query;
    if (error) { setMessage('Nie udało się odświeżyć galerii. Spróbuj ponownie.'); return; }
    setImages((data || []) as QuizGalleryImage[]);
  }, [canEdit]);
  useEffect(() => {
    if (canEdit) void refetch();
    const channel = supabase.channel('quiz-gallery-editor')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quiz_show_gallery' }, () => { void refetch(); }).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [canEdit, refetch]);

  const displayed = images.filter(image => canEdit || (image.is_visible && !isQuizStockImage(image.image_url)));
  const selected = displayed.find(image => image.id === selectedId);
  async function upload(files: File[]) {
    if (!canEdit || busy || !files.length) return;
    setBusy(true); setMessage('Przygotowanie zdjęć…');
    let saved = 0;
    const failures: string[] = [];
    const startOrder = Math.max(-1, ...images.map(image => image.order_index)) + 1;
    for (let index = 0; index < files.length; index++) {
      try {
        setMessage(`Przygotowanie zdjęcia ${index + 1} z ${files.length}…`);
        const url = await uploadQuizImage(files[index], 'quiz-gallery');
        const { data, error } = await supabase.from('quiz_show_gallery').insert({ image_url: url, title: 'Teleturniej podczas wydarzenia firmowego', is_primary: false, is_visible: true, order_index: startOrder + index }).select('id').single();
        if (error || !data) throw new Error('Nie udało się zapisać w galerii. Sprawdź uprawnienia do edycji.');
        saved++;
      } catch (cause) { failures.push(`${files[index].name}: ${cause instanceof Error ? cause.message : 'Nie udało się przesłać zdjęcia.'}`); }
    }
    await refetch(); router.refresh(); setBusy(false);
    setMessage([saved ? `Dodano ${saved} zdjęć. Uzupełnij ich podpisy przyciskiem „Edytuj”.` : '', ...failures].filter(Boolean).join(' '));
  }
  async function setPrimary(id: string) {
    if (busy) return; setBusy(true);
    const { error } = await supabase.rpc('set_quiz_gallery_primary', { image_id: id });
    if (error) setMessage('Nie udało się wyróżnić zdjęcia. Sprawdź uprawnienia i aktualność migracji galerii.');
    else { await refetch(); router.refresh(); setMessage('Zdjęcie będzie wyświetlane jako pierwsze.'); }
    setBusy(false);
  }
  if (!displayed.length && !canEdit) return null;
  return <section className="px-5 py-12 sm:px-6 lg:py-20" aria-labelledby="quiz-gallery-title"><div className="mx-auto max-w-7xl">
    <div className="mb-8 flex flex-wrap items-end justify-between gap-5"><div><p className="quiz-eyebrow">Ludzie, emocje, realizacja</p><h2 id="quiz-gallery-title" className="quiz-heading">Teleturnieje w obiektywie</h2><p className="mt-4 text-white/70">Zobacz rozgrywkę i oprawę naszych wydarzeń.</p></div>
      {canEdit && <label className={`quiz-button-secondary cursor-pointer ${busy ? 'opacity-50' : ''}`}><ImagePlus size={19} />{busy ? 'Przesyłanie…' : 'Dodaj zdjęcia'}<input type="file" multiple accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ''; void upload(files); }} className="sr-only" /></label>}
    </div>
    {canEdit && <p className="mb-5 text-sm leading-relaxed text-white/60">Dodawaj zdjęcia Waszych realizacji. Zdjęcia przykładowe z Unsplash są widoczne tylko w edytorze. Nowe pliki mają automatycznie przygotowane wersje na telefon i komputer.</p>}
    {message && <p role="status" className="mb-5 rounded-xl bg-white/5 p-4 text-sm">{message}</p>}
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{displayed.map(image => <figure key={image.id} className="overflow-hidden rounded-2xl bg-[#25131c]">
      <button type="button" onClick={() => setSelectedId(image.id)} aria-label={`Powiększ: ${image.title || 'zdjęcie teleturnieju'}`} className="block aspect-[4/3] w-full overflow-hidden"><img src={image.image_url} srcSet={quizImageSrcSet(image.image_url)} sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw" width={1280} height={960} alt={image.title || 'Teleturniej MAVINCI'} loading="lazy" decoding="async" className="h-full w-full object-cover transition-transform duration-500 motion-safe:hover:scale-[1.025]" /></button>
      <figcaption className="p-5 text-sm leading-relaxed text-white/75">{image.title}
        {canEdit && <><p className="mt-2 text-xs text-[#d3bb73]">{isQuizStockImage(image.image_url) ? 'Zdjęcie przykładowe — niewidoczne publicznie' : image.is_visible ? 'Opublikowane' : 'Ukryte'}</p><div className="mt-3 flex flex-wrap gap-3"><button disabled={busy} onClick={() => setEditing(image)} className="quiz-button-secondary"><Edit2 size={16} /> Edytuj</button><button disabled={busy || image.is_primary} onClick={() => void setPrimary(image.id)} className="quiz-button-secondary"><Star size={16} />{image.is_primary ? 'Wyróżnione' : 'Wyróżnij'}</button></div></>}
      </figcaption>
    </figure>)}</div>
    {canEdit && !displayed.length && <p className="rounded-2xl bg-white/5 p-6 text-white/60">Dodaj pierwsze zdjęcia z realizacji teleturnieju.</p>}
  </div>
    {selected && <QuizDialog title={selected.title || 'Zdjęcie teleturnieju'} onClose={() => setSelectedId(null)}><img src={selected.image_url} alt={selected.title || 'Teleturniej MAVINCI'} className="max-h-[65dvh] w-full rounded-xl object-contain" />{displayed.length > 1 && <div className="mt-4 flex justify-between"><button className="quiz-button-secondary" onClick={() => setSelectedId(displayed[(displayed.findIndex(image => image.id === selected.id) - 1 + displayed.length) % displayed.length].id)}><ChevronLeft size={20} /> Poprzednie</button><button className="quiz-button-secondary" onClick={() => setSelectedId(displayed[(displayed.findIndex(image => image.id === selected.id) + 1) % displayed.length].id)}>Następne <ChevronRight size={20} /></button></div>}</QuizDialog>}
    {editing && <GalleryEditor image={editing} onSaved={refetch} onClose={() => setEditing(null)} />}
  </section>;
}
