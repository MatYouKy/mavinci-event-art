 'use client';
import { useState } from 'react';
import { IMAGE_CROP_LAYOUTS, imageCrop, type ImageCrop, type ImageCrops } from '@/lib/CRM/Offers/productImageCrop';

type Source = { path: string; url: string; name: string; x?: number; y?: number; zoom?: number };
export default function ProductImageFraming({ value, sources, disabled, onSave, onEditingChange }: {
  value?: ImageCrops; sources: Source[]; disabled: boolean;
  onSave: (value: ImageCrops) => Promise<void>; onEditingChange: (value: boolean) => void;
}) {
  const [draft, setDraft] = useState<ImageCrops | null>(null);
  const [sourcePath, setSourcePath] = useState('');
  const [layoutId, setLayoutId] = useState('visual');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const source = sources.find(item => item.path === sourcePath) || sources[0];
  const layout = IMAGE_CROP_LAYOUTS.find(item => item.id === layoutId) || IMAGE_CROP_LAYOUTS[0];
  const crop = imageCrop(draft || value, source?.path, layout.id) || { fit: layout.id === 'recommendations' ? 'contain' : 'cover', x: source?.x ?? 50, y: source?.y ?? 50, zoom: source?.zoom ?? 1 };
  const position = `${crop.x}% ${crop.y}%`;
  const change = (patch: Partial<ImageCrop>) => {
    if (!source || !draft) return;
    setDraft({ ...draft, [source.path]: { ...draft[source.path], [layout.id]: { ...crop, ...patch } } });
  };
  const close = () => { setDraft(null); setError(''); onEditingChange(false); };
  return <section className="mb-6 rounded-xl bg-black/15 p-5">
    <div className="flex items-center justify-between gap-3"><div><h3 className="font-medium">Kadrowanie zdjęć w PDF</h3><p className="mt-1 text-sm text-[#e5e4e2]/55">Osobne ustawienia dla zdjęcia produktu, wariantów i układów karty.</p></div>
      {!draft && <button type="button" disabled={disabled || !sources.length} onClick={() => { setDraft(structuredClone(value || {})); setError(''); onEditingChange(true); }} className="shrink-0 rounded-lg bg-[#d3bb73] px-3 py-2 text-sm text-[#210914] disabled:opacity-40">Ustaw kadry</button>}
    </div>
    {draft && source && <>
      <fieldset disabled={busy || disabled} className="mt-5 grid gap-5 md:grid-cols-2">
        <div>
          <label className="block text-sm">Zdjęcie<select value={source.path} onChange={e => setSourcePath(e.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-[#210914] p-2">{sources.map(item => <option key={item.path} value={item.path}>{item.name}</option>)}</select></label>
          <label className="mt-3 block text-sm">Układ w PDF<select value={layout.id} onChange={e => setLayoutId(e.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-[#210914] p-2">{IMAGE_CROP_LAYOUTS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <div className="relative mt-4 isolate overflow-hidden rounded-lg bg-[#faf7f0]" style={{ aspectRatio: `${layout.width}/${layout.height}` }}>
            {crop.zoom < 1 && <div className="absolute inset-0 bg-cover bg-no-repeat opacity-55" style={{ backgroundImage: `url(${source.url})`, backgroundPosition: position }} />}
            <div role="img" aria-label={`Podgląd kadru: ${source.name}`} className="absolute inset-0 bg-no-repeat" style={{ backgroundImage: `url(${source.url})`, backgroundSize: crop.zoom < 1 || crop.fit === 'contain' ? 'contain' : 'cover', backgroundPosition: position, transform: `scale(${crop.zoom})`, transformOrigin: position }} />
          </div>
          <p className="mt-2 text-xs text-[#e5e4e2]/50">Proporcje standardowego układu. Własny szablon lub zmieniona wysokość grafiki może mieć inną ramkę; pełny podgląd karty jest poniżej.</p>
        </div>
        <div className="space-y-4">
          <label className="block text-sm">Dopasowanie<select value={crop.fit} onChange={e => change({ fit: e.target.value as ImageCrop['fit'] })} className="mt-1 w-full rounded-lg border border-white/10 bg-[#210914] p-2"><option value="cover">Wypełnij kadr — przytnij nadmiar</option><option value="contain">Pokaż całe zdjęcie</option></select></label>
          {(['x', 'y'] as const).map((key, i) => <label key={key} className="block text-sm">{i ? 'Pozycja pionowa' : 'Pozycja pozioma'}: {crop[key]}%<input type="range" min="0" max="100" value={crop[key]} onChange={e => change({ [key]: Number(e.target.value) })} className="mt-2 w-full accent-[#d3bb73]" /></label>)}
          <label className="block text-sm">Skala: {Math.round(crop.zoom * 100)}%<input type="range" min="0.5" max="3" step="0.05" value={crop.zoom} onChange={e => change({ zoom: Number(e.target.value) })} className="mt-2 w-full accent-[#d3bb73]" /></label>
          <div className="flex flex-wrap gap-2"><button type="button" onClick={() => change({ fit: 'cover', x: 50, y: 0, zoom: 1 })} className="rounded-lg bg-white/5 px-3 py-2 text-sm text-[#d3bb73]">Wyrównaj do góry</button><button type="button" onClick={() => change({ fit: 'contain', x: 50, y: 50, zoom: 1 })} className="rounded-lg bg-white/5 px-3 py-2 text-sm text-[#d3bb73]">Całe zdjęcie</button></div>
          <button type="button" onClick={() => { const next = { ...draft, [source.path]: { ...draft[source.path] } }; delete next[source.path][layout.id]; setDraft(next); }} className="text-sm text-[#d3bb73]">Usuń ustawienie tego kadru</button>
          <p className="text-xs leading-5 text-[#e5e4e2]/50">Ustawienie dotyczy tylko wybranego zdjęcia i układu. Zapis obejmuje wszystkie zmienione kadry. PL i EN korzystają z tych samych ustawień. Zmiana zdjęcia nie przenosi kadru na nowy plik.</p>
        </div>
      </fieldset>
      {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
      <div className="mt-4 flex justify-end gap-2"><button type="button" disabled={busy} onClick={close} className="rounded-lg bg-white/5 px-4 py-2 text-sm">Anuluj</button><button type="button" disabled={busy || disabled} onClick={async () => { setBusy(true); setError(''); try { await onSave(draft); close(); } catch (e) { setError(e instanceof Error ? e.message : 'Nie udało się zapisać kadrów.'); } finally { setBusy(false); } }} className="rounded-lg bg-[#d3bb73] px-4 py-2 text-sm text-[#210914] disabled:opacity-40">{busy ? 'Zapisywanie…' : 'Zapisz kadry'}</button></div>
    </>}
  </section>;
}
