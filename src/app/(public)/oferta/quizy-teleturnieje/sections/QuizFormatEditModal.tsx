'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Plus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { IconGridSelector } from '@/components/IconGridSelector';
import { uploadQuizImage } from '@/lib/quiz-shows/upload';
import { safeQuizLink, type QuizShowFormat } from '@/lib/quiz-shows/types';
import QuizDialog from './QuizDialog';

const inputClass = 'mt-2 w-full rounded-xl border border-white/10 bg-[#140910] px-4 py-3 text-base text-[#e5e4e2] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#d3bb73]/60';

export default function QuizFormatEditModal({ format, onClose, onSaved }: {
  format?: QuizShowFormat; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const { showSnackbar } = useSnackbar();
  const router = useRouter();
  const [title, setTitle] = useState(format?.title || '');
  const [level, setLevel] = useState(format?.level || '');
  const [description, setDescription] = useState(format?.description || '');
  const [features, setFeatures] = useState(format?.features?.length ? format.features : ['']);
  const [imageUrl, setImageUrl] = useState(format?.image_url || '');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [iconId, setIconId] = useState(format?.icon_id || '');
  const [layoutDirection, setLayoutDirection] = useState<'left' | 'right'>(format?.layout_direction || 'left');
  const [visible, setVisible] = useState(format?.is_visible ?? true);
  const [order, setOrder] = useState(String(format?.order_index ?? 0));
  const [link, setLink] = useState(format?.link_url || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!file) { setPreview(''); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const cleanFeatures = features.map(value => value.trim()).filter(Boolean);
    if (!title.trim() || !description.trim() || !level.trim() || !cleanFeatures.length || !order.trim() || !Number.isInteger(Number(order))) {
      setError('Uzupełnij nazwę, zastosowanie, opis, przynajmniej jedną cechę i poprawną kolejność.'); return;
    }
    if (link.trim() && !safeQuizLink(link)) { setError('Podaj adres zaczynający się od / lub pełny adres HTTPS.'); return; }
    setBusy(true); setError('');
    try {
      let savedImage = imageUrl;
      if (file) {
        savedImage = await uploadQuizImage(file, 'quiz-formats');
        setImageUrl(savedImage); setFile(null);
      }
      const values = { title: title.trim(), level: level.trim(), description: description.trim(),
        features: cleanFeatures, image_url: savedImage || null, icon_id: iconId || null,
        layout_direction: layoutDirection, is_visible: visible, order_index: Number(order), link_url: safeQuizLink(link) };
      const query = format
        ? supabase.from('quiz_show_formats').update(values).eq('id', format.id)
        : supabase.from('quiz_show_formats').insert(values);
      const { data, error: saveError } = await query.select('id').single();
      if (saveError || !data) throw new Error('Nie udało się zapisać formatu. Sprawdź połączenie i uprawnienia do edycji strony.');
      await onSaved();
      router.refresh();
      showSnackbar('Format został zapisany', 'success');
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Nie udało się zapisać zmian.'); }
    finally { setBusy(false); }
  }

  return <QuizDialog title={format ? 'Edytuj teleturniej' : 'Dodaj teleturniej'} busy={busy} onClose={onClose}>
    <form onSubmit={save}>
      <fieldset disabled={busy} className="space-y-5 disabled:opacity-70">
        <label className="block text-sm">Nazwa teleturnieju *<input required value={title} onChange={e => setTitle(e.target.value)} className={inputClass} /></label>
        <label className="block text-sm">Zastosowanie / etykieta *<input required value={level} onChange={e => setLevel(e.target.value)} placeholder="np. Integracja przy kolacji" className={inputClass} /></label>
        <label className="block text-sm">Jak wygląda zabawa? *<textarea required value={description} onChange={e => setDescription(e.target.value)} rows={4} className={inputClass} /></label>
        <div><p className="text-sm">Najważniejsze informacje *</p>
          {features.map((feature, index) => <div key={index} className="flex items-center gap-2">
            <input aria-label={`Informacja ${index + 1}`} value={feature} onChange={e => setFeatures(values => values.map((value, i) => i === index ? e.target.value : value))} className={`${inputClass} min-w-0`} />
            <button type="button" aria-label={`Usuń informację ${index + 1}`} onClick={() => setFeatures(values => values.filter((_, i) => i !== index))} className="p-3"><X size={18} /></button>
          </div>)}
          <button type="button" onClick={() => setFeatures(values => [...values, ''])} className="mt-3 inline-flex items-center gap-2 text-sm text-[#d3bb73]"><Plus size={16} /> Dodaj informację</button>
        </div>
        <div className="rounded-xl bg-white/5 p-4">
          {(preview || imageUrl) && <img src={preview || imageUrl} alt="Podgląd zdjęcia teleturnieju" className="mb-4 aspect-video w-full rounded-lg object-cover" />}
          <label className="block text-sm">Zdjęcie teleturnieju
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => { setFile(e.target.files?.[0] || null); e.target.value = ''; }} className="mt-3 block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-[#d3bb73] file:px-4 file:py-3 file:text-[#180a11]" />
          </label>
          <p className="mt-3 text-xs leading-relaxed text-white/60">JPG, PNG lub WebP do 10 MB. Przy zapisie przygotujemy lekkie wersje zdjęcia na telefon i komputer. Poprzednie zdjęcie pozostaje do czasu zapisu.</p>
          {(file || imageUrl) && <button type="button" onClick={() => { setFile(null); setImageUrl(''); }} className="mt-3 text-sm text-[#d3bb73]">Usuń zdjęcie z tego formatu</button>}
        </div>
        <IconGridSelector value={iconId} onChange={setIconId} label="Ikona teleturnieju" />
        {iconId && <button type="button" onClick={() => setIconId('')} className="text-sm text-[#d3bb73]">Przywróć ikonę domyślną</button>}
        <label className="block text-sm">Link do szczegółów (opcjonalnie)<input value={link} onChange={e => setLink(e.target.value)} placeholder="/oferta/... lub https://..." className={inputClass} /></label>
        <p className="text-xs text-white/60">Bez dodatkowego linku karta zawiera przycisk zapytania o ten format.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm">Kolejność<input type="number" step="1" value={order} onChange={e => setOrder(e.target.value)} className={inputClass} /></label>
          <label className="text-sm">Układ na komputerze<select value={layoutDirection} onChange={e => setLayoutDirection(e.target.value as 'left' | 'right')} className={inputClass}><option value="left">Zdjęcie z lewej</option><option value="right">Zdjęcie z prawej</option></select></label>
        </div>
        <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={visible} onChange={e => setVisible(e.target.checked)} className="h-5 w-5 accent-[#d3bb73]" /> Widoczny na stronie (wyłącz, aby ukryć)</label>
      </fieldset>
      {error && <p role="alert" className="mt-5 rounded-xl bg-red-950/50 p-4 text-sm text-red-200">{error}</p>}
      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <button type="button" disabled={busy} onClick={onClose} className="rounded-full bg-white/5 px-5 py-3">Anuluj</button>
        <button type="submit" disabled={busy} className="rounded-full bg-[#d3bb73] px-6 py-3 text-[#180a11] disabled:opacity-50">{busy ? 'Przygotowanie zdjęcia i zapis…' : 'Zapisz zmiany'}</button>
      </div>
    </form>
  </QuizDialog>;
}
