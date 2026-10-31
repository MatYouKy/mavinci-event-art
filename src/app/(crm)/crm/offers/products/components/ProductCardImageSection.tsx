'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Image as ImageIcon, Loader2, Pencil, Trash2, Upload, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { optimizeOfferImage } from '@/lib/optimizeOfferImage';

type ImageSettings = {
  offer_image_path?: string | null;
  offer_image_alt?: string | null;
  offer_image_position_x?: number | null;
  offer_image_position_y?: number | null;
  offer_image_zoom?: number | null;
};
type Props = {
  productId: string;
  productName: string;
  value: ImageSettings;
  imageUrl: string | null;
  canEdit: boolean;
  disabled?: boolean;
  onSave: (patch: ImageSettings) => Promise<void>;
  onEditingChange: (editing: boolean) => void;
  onSavingChange: (saving: boolean) => void;
};
const scale = (value?: number | null) => Math.min(3, Math.max(0.5, Number.isFinite(value) ? Number(value) : 1));

function Picture({ url, settings, name }: { url: string; settings: ImageSettings; name: string }) {
  const zoom = scale(settings.offer_image_zoom);
  const position = `${settings.offer_image_position_x ?? 50}% ${settings.offer_image_position_y ?? 25}%`;
  return <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-black/20">
    {zoom < 1 && <Image src={url} alt="" fill unoptimized aria-hidden className="object-cover opacity-55" style={{ objectPosition: position }} />}
    <Image src={url} alt={settings.offer_image_alt || name} fill unoptimized className={zoom < 1 ? 'object-contain' : 'object-cover'} style={{ objectPosition: position, transform: `scale(${zoom})`, transformOrigin: position }} />
  </div>;
}

export default function ProductCardImageSection({ productId, productName, value, imageUrl, canEdit, disabled, onSave, onEditingChange, onSavingChange }: Props) {
  const [draft, setDraft] = useState<ImageSettings | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [localUrl, setLocalUrl] = useState('');
  const [removed, setRemoved] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!file) { setLocalUrl(''); return; }
    const url = URL.createObjectURL(file); setLocalUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => {
    if (draft) dialog.current?.showModal(); else dialog.current?.close();
  }, [Boolean(draft)]);
  const close = () => {
    if (busyRef.current) return;
    setDraft(null); setFile(null); setRemoved(false); setError(''); onEditingChange(false);
  };
  const open = () => {
    if (!canEdit || disabled || productId === 'new') return;
    setDraft({ offer_image_path: value.offer_image_path, offer_image_alt: value.offer_image_alt || '', offer_image_position_x: value.offer_image_position_x ?? 50, offer_image_position_y: value.offer_image_position_y ?? 25, offer_image_zoom: scale(value.offer_image_zoom) });
    setFile(null); setRemoved(false); setError(''); onEditingChange(true);
  };
  const chooseFile = (next: File) => {
    if (busyRef.current || disabled) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(next.type) || next.size > 10 * 1024 * 1024) { setError('Wybierz zdjęcie JPG, PNG lub WebP do 10 MB.'); return; }
    setFile(next); setRemoved(false); setError('');
  };
  const save = async () => {
    if (!draft || !canEdit || disabled || busyRef.current) return;
    busyRef.current = true; setBusy(true); onSavingChange(true); setError('');
    const bucket = supabase.storage.from('offer-product-pages');
    let uploadedPath: string | null = null;
    try {
      const patch = { ...draft, offer_image_path: removed ? null : draft.offer_image_path, offer_image_zoom: scale(draft.offer_image_zoom) };
      if (file) {
        const optimized = await optimizeOfferImage(file, { maxWidth: 1800, maxHeight: 1800, quality: 0.82 });
        const extension = optimized.type === 'image/png' ? 'png' : optimized.type === 'image/webp' ? 'webp' : 'jpg';
        const path = `assets/${productId}/offer-image-${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await bucket.upload(path, optimized, { contentType: optimized.type, upsert: false });
        if (uploadError) throw uploadError;
        uploadedPath = path; patch.offer_image_path = path;
      }
      await onSave(patch);
      // Existing files remain available to brochures and historical offers.
      busyRef.current = false; close();
    } catch (cause) {
      if (uploadedPath) await bucket.remove([uploadedPath]);
      setError(cause instanceof Error ? cause.message : 'Nie udało się zapisać grafiki. Spróbuj ponownie.');
    } finally { busyRef.current = false; setBusy(false); onSavingChange(false); }
  };
  const previewUrl = localUrl || (!removed ? imageUrl : '') || '';
  return <section className="self-start rounded-lg bg-black/15 p-4">
    <div className="mb-3 flex items-center justify-between gap-2"><h3 className="text-sm font-medium text-[#e5e4e2]">Grafika na karcie produktu</h3>{canEdit && <button type="button" onClick={open} disabled={disabled || productId === 'new'} aria-label="Edytuj grafikę" className="rounded-lg p-2 text-[#d3bb73] hover:bg-white/5 disabled:opacity-40"><Pencil className="h-4 w-4" /></button>}</div>
    {imageUrl ? <Picture url={imageUrl} settings={value} name={productName} /> : <div className="flex aspect-[4/3] items-center justify-center rounded-lg bg-black/10 text-[#e5e4e2]/40"><ImageIcon className="h-10 w-10" /></div>}
    {productId === 'new' && <p className="mt-3 text-xs text-[#e5e4e2]/50">Zapisz nowy produkt, aby dodać grafikę.</p>}
    <dialog ref={dialog} onCancel={event => { event.preventDefault(); close(); }} aria-labelledby="product-image-title" className="m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-3xl overflow-hidden rounded-2xl bg-[#1c1f33] p-0 text-[#e5e4e2] shadow-2xl backdrop:bg-black/65">
      {draft && <div className="flex max-h-[90dvh] flex-col">
        <header className="flex items-center justify-between gap-3 px-6 py-4"><h2 id="product-image-title" className="text-lg uppercase">Grafika na karcie produktu</h2><button type="button" aria-label="Zamknij" onClick={close} disabled={busy} className="rounded-lg p-2 hover:bg-white/5"><X className="h-5 w-5" /></button></header>
        <div className="min-h-0 overflow-y-auto px-6 py-4">
          <fieldset disabled={busy || disabled} className="grid min-w-0 gap-5 sm:grid-cols-2">
            <div onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const selected = event.dataTransfer.files[0]; if (selected) chooseFile(selected); }}>
              {previewUrl ? <Picture url={previewUrl} settings={draft} name={productName} /> : <div className="flex aspect-[4/3] items-center justify-center rounded-lg border border-dashed border-white/10 bg-black/15 text-sm text-[#e5e4e2]/50">Przeciągnij zdjęcie tutaj</div>}
              <label className={`mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-sm text-[#d3bb73] ${busy ? 'pointer-events-none opacity-50' : ''}`}><Upload className="h-4 w-4" />{previewUrl ? 'Zmień zdjęcie' : 'Wybierz zdjęcie'}<input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={event => { const selected = event.target.files?.[0]; event.target.value = ''; if (selected) chooseFile(selected); }} /></label>
              {previewUrl && <button type="button" onClick={() => { setFile(null); setRemoved(true); }} className="mt-2 flex items-center gap-2 px-3 py-2 text-sm text-red-300"><Trash2 className="h-4 w-4" />Usuń grafikę</button>}
              <p className="mt-3 text-xs text-[#e5e4e2]/45">PNG, JPG lub WebP, do 10 MB.</p>
            </div>
            <div className="space-y-4">
              <label className="block text-sm text-[#e5e4e2]/65">Opis grafiki<input value={draft.offer_image_alt || ''} onChange={event => setDraft({ ...draft, offer_image_alt: event.target.value })} className="mt-1 w-full rounded-lg border border-white/10 bg-black/15 px-3 py-2 text-[#e5e4e2]" /></label>
              <p className="text-xs uppercase text-[#d3bb73]">Kadrowanie w ofercie</p>
              {(['offer_image_position_x', 'offer_image_position_y'] as const).map((key, i) => <label key={key} className="block text-sm text-[#e5e4e2]/65">{i === 0 ? 'Poziom' : 'Pion'}: {draft[key]}%<input type="range" min="0" max="100" value={draft[key] ?? 50} disabled={!previewUrl} onChange={event => setDraft({ ...draft, [key]: Number(event.target.value) })} className="mt-2 w-full accent-[#d3bb73]" /></label>)}
              <label className="block text-sm text-[#e5e4e2]/65">Skala: {Math.round(scale(draft.offer_image_zoom) * 100)}%<input type="range" min="0.5" max="3" step="0.05" value={scale(draft.offer_image_zoom)} disabled={!previewUrl} onChange={event => setDraft({ ...draft, offer_image_zoom: Number(event.target.value) })} className="mt-2 w-full accent-[#d3bb73]" /></label>
              <button type="button" disabled={!previewUrl} onClick={() => setDraft({ ...draft, offer_image_position_x: 50, offer_image_position_y: 25, offer_image_zoom: 1 })} className="rounded-lg bg-white/5 px-3 py-2 text-xs text-[#d3bb73]">Przywróć domyślny kadr</button>
              <p className="text-xs leading-5 text-[#e5e4e2]/45">Poniżej 100% całe zdjęcie mieści się w kadrze, a tło wypełnia pozostałe miejsce.</p>
            </div>
          </fieldset>
        </div>
        <footer className="px-6 py-4">{error && <p role="alert" className="mb-3 text-sm text-red-300">{error}</p>}<div className="flex justify-end gap-2"><button type="button" disabled={busy} onClick={close} className="rounded-lg bg-white/5 px-4 py-2 text-sm">Anuluj</button><button type="button" disabled={busy || disabled} onClick={() => void save()} className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] disabled:opacity-40">{busy && <Loader2 className="h-4 w-4 animate-spin" />}{busy ? 'Zapisywanie…' : 'Zapisz grafikę'}</button></div></footer>
      </div>}
    </dialog>
  </section>;
}
