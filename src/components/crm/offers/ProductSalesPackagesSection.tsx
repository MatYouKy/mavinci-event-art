"use client";
import ProductPackageResourcesEditor from './ProductPackageResourcesEditor';
import ProductPackageCostsEditor, { ProductPackageCostSummary } from './ProductPackageCostsEditor';
import { useEffect, useId, useRef, useState } from 'react';
import { ImagePlus, Loader2, Plus, Save, Trash2, X, Eye, Pencil, GripVertical, ArrowUp, ArrowDown } from 'lucide-react';
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';
import ResponsiveActionBar from '@/components/crm/ResponsiveActionBar';
import { supabase } from '@/lib/supabase/browser';
import { optimizeOfferImage } from '@/lib/optimizeOfferImage';
import { validateSalesPackages, packageExtensionLabel, packageCostLineNet, packageCostSettlementLabels, type ProductSalesPackage } from '@/lib/CRM/Offers/productSalesPackages';
import type { IProductVariant } from '@/app/(crm)/crm/offers/types';

function PackageElementsPicker({ elements, selectedIds, packageName, onChange, disabled }: {
  elements: IProductVariant[];
  selectedIds: string[];
  packageName: string;
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [selectedOnly, setSelectedOnly] = useState(false);
  useEffect(() => {
    if (!open) { dialog.current?.close(); return; }
    dialog.current?.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [open]);
  const normalize = (value: string) => value.toLocaleLowerCase('pl-PL').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l').trim();
  const matches = elements.filter(element => normalize(element.name).includes(normalize(query))
    && (!selectedOnly || selection.includes(element.id)));
  const selectedCount = elements.filter(element => selectedIds.includes(element.id)).length;
  const draftCount = elements.filter(element => selection.includes(element.id)).length;
  const close = () => setOpen(false);

  return <div className="space-y-2 pt-3">
    <p className="text-xs font-medium text-[#e5e4e2]/70">Elementy w pakiecie</p>
    <button type="button" disabled={disabled} aria-haspopup="dialog" onClick={() => {
      setSelection([...selectedIds]); setQuery(''); setSelectedOnly(false); setOpen(true);
    }} className="flex w-full items-center justify-between gap-3 rounded-lg bg-[#d3bb73]/10 px-3 py-2.5 text-sm text-[#d3bb73] disabled:opacity-40">
      <span>Wybierz elementy</span><span className="rounded-md bg-black/15 px-2 py-0.5 text-xs">{selectedCount} / {elements.length}</span>
    </button>
    <dialog ref={dialog} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); event.stopPropagation(); close(); }} onClose={close}
      className="m-auto max-h-[80dvh] w-[calc(100%_-_2rem)] max-w-md overflow-hidden rounded-2xl bg-[#1c1f33] p-0 text-[#e5e4e2] shadow-2xl backdrop:bg-black/65">
      {open && <div className="flex max-h-[80dvh] flex-col">
        <header className="flex shrink-0 items-start justify-between gap-3 px-5 pb-3 pt-5">
          <div className="min-w-0"><h3 id={titleId} className="text-base font-medium">Elementy pakietu</h3><p className="mt-1 break-words text-sm text-[#e5e4e2]/60">{packageName}</p></div>
          <button type="button" aria-label="Zamknij wybór elementów" onClick={close} className="rounded-lg p-1.5 hover:bg-white/5"><X className="h-5 w-5" /></button>
        </header>
        <div className="shrink-0 space-y-3 px-5 pb-3">
          <input autoFocus type="search" value={query} onChange={event => setQuery(event.target.value)} aria-label="Szukaj elementu" placeholder="Szukaj elementu…" className="w-full rounded-lg border border-white/10 bg-black/15 px-3 py-2 text-sm" />
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-[#e5e4e2]/50">Wybrano {draftCount} z {elements.length}</span>
            <button type="button" aria-pressed={selectedOnly} onClick={() => setSelectedOnly(current => !current)} className={`rounded-md px-2 py-1 text-xs ${selectedOnly ? 'bg-[#d3bb73]/15 text-[#d3bb73]' : 'bg-white/5 text-[#e5e4e2]/60'}`}>Tylko wybrane</button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 [scrollbar-gutter:stable]">
          <div className="space-y-1 pb-2">
            {matches.map(element => <label key={element.id} className={`flex cursor-pointer items-start gap-2.5 rounded-lg px-3 py-2.5 text-sm ${selection.includes(element.id) ? 'bg-[#d3bb73]/10' : 'text-[#e5e4e2]/70 hover:bg-white/5'}`}>
              <input type="checkbox" disabled={disabled} checked={selection.includes(element.id)} onChange={event => {
                const checked = event.target.checked;
                setSelection(current => checked ? [...current, element.id] : current.filter(id => id !== element.id));
              }} className="mt-1 shrink-0 accent-[#d3bb73]" />
              <span className="min-w-0 break-words">{element.name}</span>
            </label>)}
            {!matches.length && <p className="py-5 text-sm text-[#e5e4e2]/50">{!elements.length ? 'Dodaj i zapisz elementy produktu, aby połączyć je w pakiet.' : 'Brak elementów pasujących do filtrów.'}</p>}
          </div>
        </div>
        <footer className="shrink-0 space-y-3 bg-[#1c1f33] p-5">
          <p className="text-xs text-[#e5e4e2]/45">Wybór zatwierdzisz w edytowanym pakiecie przyciskiem „Zapisz pakiet”.</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={close} className="rounded-lg bg-white/5 px-3 py-2 text-sm">Anuluj</button>
            <button type="button" disabled={disabled} onClick={() => { onChange(selection); close(); }} className="rounded-lg bg-[#d3bb73] px-3 py-2 text-sm text-[#1c1f33] disabled:opacity-40">Zastosuj wybór</button>
          </div>
        </footer>
      </div>}
    </dialog>
  </div>;
}

type Props = { productId: string; value: ProductSalesPackage[]; enabled: boolean; elements: IProductVariant[]; canEdit: boolean; disabled?: boolean; onSave: (packages: ProductSalesPackage[], enabled: boolean) => Promise<void>; onEditingChange: (editing: boolean) => void };
export default function ProductSalesPackagesSection({ productId, value, enabled, elements, canEdit, disabled, onSave, onEditingChange }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const listId = useId();
  const submitting = useRef(false);
  const [active, setActive] = useState<ProductSalesPackage | null>(null);
  const [draft, setDraft] = useState<ProductSalesPackage | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [preparingImageId, setPreparingImageId] = useState<string | null>(null);
  const [draggingImageId, setDraggingImageId] = useState<string | null>(null);
  const imageInputs = useRef(new Map<string, HTMLInputElement>());
  const preparingRef = useRef(false);
  const [error, setError] = useState('');
  const [listError, setListError] = useState('');
  const [pendingOrder, setPendingOrder] = useState<ProductSalesPackage[] | null>(null);
  const [imageRevision, setImageRevision] = useState(0);
  const [images, setImages] = useState<Record<string,string>>({});
  const files = useRef(new Map<string,{file:File;url:string}>());
  const displayed = pendingOrder ?? value;
  const visible = draft ? [...value.filter(p => p.id !== draft.id), draft] : value;
  const signature = visible.map(p => p.id + ':' + p.image_path).join('|');
  const busy = Boolean(disabled || saving || preparing);
  const field = 'mt-1 w-full rounded-lg border border-white/10 bg-black/15 px-3 py-2 text-sm text-[#e5e4e2]';
  const p = draft || active;

  useEffect(() => {
    let stale = false;
    (async () => {
      const entries = await Promise.all(visible.map(async item => {
        if (!item.image_path) return [item.id, ''];
        const { data } = await supabase.storage.from('offer-product-pages').createSignedUrl(item.image_path, 3600);
        return [item.id, data?.signedUrl || ''];
      }));
      if (!stale) setImages({ ...Object.fromEntries(entries), ...Object.fromEntries([...files.current].map(([id, f]) => [id, f.url])) });
    })();
    return () => { stale = true; };
  }, [signature, imageRevision]);
  useEffect(() => {
    if (!active) { dialog.current?.close(); return; }
    dialog.current?.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [active?.id]);
  const clearFiles = () => { files.current.forEach(f => URL.revokeObjectURL(f.url)); files.current.clear(); };
  useEffect(() => () => clearFiles(), []);
  const finish = () => {
    clearFiles(); setImageRevision(current => current + 1); setActive(null); setDraft(null);
    setCreating(false); setDeleting(false); setError(''); setDraggingImageId(null); onEditingChange(false);
  };
  const close = () => { if (!busy && !submitting.current && !preparingRef.current) finish(); };
  const change = (id: string, patch: Partial<ProductSalesPackage>) => setDraft(current => current?.id === id ? { ...current, ...patch } : current);
  const openPackage = (item: ProductSalesPackage, mode: 'preview' | 'edit' | 'delete' = 'preview') => {
    if (busy || submitting.current || (mode !== 'preview' && !canEdit)) return;
    setActive(structuredClone(item)); setDraft(mode === 'edit' ? structuredClone(item) : null);
    setCreating(false); setDeleting(mode === 'delete'); setError(''); onEditingChange(mode !== 'preview');
  };
  const add = () => {
    if (busy || submitting.current || !canEdit || value.length >= 3) return;
    const item: ProductSalesPackage = { id: crypto.randomUUID(), name: '', description: '', included_label: '', element_ids: [], price_net: 0, extension_price_net_per_hour: null, bonus: '', highlighted: false, image_path: null, image_alt: '' };
    setActive(item); setDraft(item); setCreating(true); setDeleting(false); setError(''); onEditingChange(true);
  };
  const upload = async (id: string, file: File) => {
    if (busy || submitting.current || preparingRef.current || !canEdit || !draft || productId === 'new') return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) { setError('Wybierz JPG, PNG lub WebP o wielkości do 10 MB.'); return; }
    preparingRef.current = true; setPreparing(true); setPreparingImageId(id); setDraggingImageId(null); setError('');
    try {
      const optimized = await optimizeOfferImage(file, { maxWidth: 1400, maxHeight: 1400, quality: .82 });
      const old = files.current.get(id); if (old) URL.revokeObjectURL(old.url);
      const url = URL.createObjectURL(optimized); files.current.set(id, { file: optimized, url });
      setImages(current => ({ ...current, [id]: url }));
    } catch { setError('Nie udało się przygotować zdjęcia.'); }
    finally { preparingRef.current = false; setPreparing(false); setPreparingImageId(null); }
  };
  const persist = async (remove = false) => {
    if (!active || !canEdit || busy || submitting.current || preparingRef.current || (!remove && !draft)) return;
    if (!creating && !value.some(item => item.id === active.id)) { setError('Pakiet został usunięty. Zamknij modal i otwórz listę ponownie.'); return; }
    const updated = draft ? { ...structuredClone(draft), name: draft.name.trim(), included_label: draft.included_label.trim() } : null;
    const next = remove ? value.filter(item => item.id !== active.id) : creating ? [...value, updated!] : value.map(item => item.id === active.id ? updated! : item);
    const problem = validateSalesPackages(next);
    if (problem) { setError(problem); return; }
    if (updated && !remove && updated.element_ids.some(id => !elements.some(element => element.id === id))) { setError('Zaktualizuj skład pakietu — jeden z elementów został usunięty.'); return; }
    submitting.current = true; setSaving(true); setError('');
    let uploaded: string | null = null;
    let committed = false;
    try {
      const image = !remove && updated ? files.current.get(updated.id) : null;
      if (image && updated) {
        if (productId === 'new') throw new Error('Zapisz najpierw produkt, aby dodać zdjęcie.');
        const ext = image.file.type === 'image/webp' ? 'webp' : image.file.type === 'image/png' ? 'png' : 'jpg';
        const path = `assets/${productId}/packages/${updated.id}-${crypto.randomUUID()}.${ext}`;
        const { error: uploadError } = await supabase.storage.from('offer-product-pages').upload(path, image.file, { upsert: false, contentType: image.file.type });
        if (uploadError) throw uploadError;
        uploaded = path; updated.image_path = path;
      }
      await onSave(next, next.length > 0 && (enabled || (creating && value.length === 0)));
      committed = true; finish();
    } catch (failure) {
      if (uploaded && !committed) await supabase.storage.from('offer-product-pages').remove([uploaded]).catch(() => {});
      setError(failure instanceof Error ? failure.message : 'Nie udało się zapisać pakietu. Spróbuj ponownie.');
    } finally { submitting.current = false; setSaving(false); }
  };
  const saveList = async (next: ProductSalesPackage[], nextEnabled: boolean) => {
    if (!canEdit || busy || submitting.current || active) return;
    submitting.current = true; setSaving(true); setPendingOrder(next); setListError(''); onEditingChange(true);
    try { await onSave(next, nextEnabled); }
    catch (failure) { setListError(failure instanceof Error ? failure.message : 'Nie udało się zapisać ustawień pakietów.'); }
    finally { submitting.current = false; setSaving(false); setPendingOrder(null); onEditingChange(false); }
  };
  const move = (from: number, to: number) => {
    if (from === to || to < 0 || from < 0 || to >= value.length || from >= value.length) return;
    const next = [...value]; const [item] = next.splice(from, 1); next.splice(to, 0, item);
    void saveList(next, enabled);
  };
  const onDragEnd = ({ source, destination }: DropResult) => { if (destination) move(source.index, destination.index); };

  return <section aria-busy={saving || preparing} className="rounded-xl bg-[#1c1f33] p-5 sm:p-6">
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-lg text-[#e5e4e2]">Pakiety · druga strona oferty</h2><p className="mt-1 text-xs text-[#e5e4e2]/55">Pakiety mają własne ceny, koszty realizacji i zdjęcia. Dodaj maksymalnie 3 pakiety.</p></div>
      {canEdit && <button type="button" disabled={busy || Boolean(active) || value.length >= 3} onClick={add} className="flex items-center gap-2 rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-sm text-[#d3bb73] disabled:opacity-40"><Plus className="h-4 w-4"/>Dodaj pakiet</button>}
    </div>
    <label className="mb-4 flex items-center gap-2 text-sm text-[#e5e4e2]/70"><input type="checkbox" checked={enabled} disabled={!canEdit || busy || Boolean(active) || !value.length} onChange={event => void saveList(value, event.target.checked)} className="accent-[#d3bb73]"/>Dwie strony: elementy bez cen + wybór pakietu</label>
    {listError && <p role="alert" className="mb-3 text-sm text-red-200">{listError}</p>}
    {!displayed.length && <p className="text-sm text-[#e5e4e2]/50">Dodaj pakiet, aby przygotować drugą stronę oferty.</p>}
    <DragDropContext onDragEnd={onDragEnd}><Droppable droppableId={listId}>{provided => <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-2">
      {displayed.map((item, index) => <Draggable key={item.id} draggableId={item.id} index={index} isDragDisabled={!canEdit || busy || Boolean(active)}>{drag => <article ref={drag.innerRef} {...drag.draggableProps} className="flex items-center gap-3 rounded-lg bg-black/15 p-3">
        {canEdit && <span {...drag.dragHandleProps} aria-label={`Przenieś pakiet: ${item.name}`} className="shrink-0 text-[#e5e4e2]/35"><GripVertical className="h-4 w-4"/></span>}
        <span className="text-xs tabular-nums text-[#d3bb73]">{String(index + 1).padStart(2, '0')}</span>
        {images[item.id] ? <img src={images[item.id]} alt={item.image_alt || item.name} className="h-14 w-14 shrink-0 rounded-lg object-cover"/> : <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-white/5 text-[#d3bb73]/45"><ImagePlus className="h-5 w-5"/></span>}
        <div className="min-w-0 flex-1"><h3 className="break-words text-sm font-medium text-[#e5e4e2]">{item.name}</h3><p className="mt-1 line-clamp-1 text-xs text-[#e5e4e2]/55">{item.description || item.included_label}</p><p className="mt-1 text-xs text-[#d3bb73]">{item.price_net.toLocaleString('pl-PL')} zł netto</p></div>
        <ResponsiveActionBar alwaysDropdown compact actions={[
          { label: 'Podgląd', icon: <Eye className="h-4 w-4"/>, onClick: () => openPackage(item), disabled: busy },
          { label: 'Edytuj', icon: <Pencil className="h-4 w-4"/>, onClick: () => openPackage(item, 'edit'), show: canEdit, disabled: busy },
          { label: 'Dodaj pakiet', icon: <Plus className="h-4 w-4"/>, onClick: add, show: canEdit, disabled: busy || value.length >= 3 },
          { label: 'Przenieś wyżej', icon: <ArrowUp className="h-4 w-4"/>, onClick: () => move(index, index - 1), show: canEdit, disabled: busy || index === 0 },
          { label: 'Przenieś niżej', icon: <ArrowDown className="h-4 w-4"/>, onClick: () => move(index, index + 1), show: canEdit, disabled: busy || index === displayed.length - 1 },
          { label: 'Usuń', icon: <Trash2 className="h-4 w-4"/>, onClick: () => openPackage(item, 'delete'), variant: 'danger', show: canEdit, disabled: busy },
        ]}/>
      </article>}</Draggable>)}
      {provided.placeholder}
    </div>}</Droppable></DragDropContext>
    <dialog ref={dialog} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); event.stopPropagation(); close(); }} className="m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-3xl overflow-hidden rounded-2xl bg-[#1c1f33] p-0 text-[#e5e4e2] shadow-2xl backdrop:bg-black/65">
      {active && p && <div className="flex max-h-[90dvh] flex-col">
        <header className="flex shrink-0 items-start justify-between gap-3 px-5 py-4"><h2 id={titleId} className="text-lg font-medium">{deleting ? 'Usuń pakiet' : creating ? 'Dodaj pakiet' : draft ? 'Edytuj pakiet' : 'Podgląd pakietu'}</h2><button type="button" disabled={busy} onClick={close} aria-label="Zamknij pakiet" className="rounded-lg p-1.5 hover:bg-white/5 disabled:opacity-40"><X className="h-5 w-5"/></button></header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 pb-5 [scrollbar-gutter:stable]">
          {error && <p role="alert" className="text-sm text-red-200">{error}</p>}
          {deleting ? <p className="text-sm text-[#e5e4e2]/75">Usunąć pakiet „{active.name}”? Istniejące oferty zachowają jego zapisany zakres.{value.length === 1 ? ' Usunięcie ostatniego pakietu wyłączy drugą stronę pakietów.' : ''}</p> : draft ? <fieldset disabled={busy || !canEdit} className="disabled:opacity-60">
        <div className="grid items-start gap-5 grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))]">
        <div className="w-full min-w-0 max-w-[320px] space-y-2">
          <p className="text-xs text-[#e5e4e2]/60">Zdjęcie pakietu</p>
          <div
            onDragEnter={event=>{event.preventDefault();event.stopPropagation();if(!busy&&canEdit&&productId!=='new')setDraggingImageId(p.id);}}
            onDragOver={event=>{event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect=busy||productId==='new'?'none':'copy';}}
            onDragLeave={event=>{event.preventDefault();if(!event.currentTarget.contains(event.relatedTarget as Node | null))setDraggingImageId(current=>current===p.id?null:current);}}
            onDrop={event=>{
              event.preventDefault();event.stopPropagation();setDraggingImageId(null);
              if(busy||!canEdit||productId==='new')return;
              if(event.dataTransfer.files.length>1){setError('Dodaj jedno zdjęcie do pakietu.');return;}
              const file=event.dataTransfer.files[0];if(file)void upload(p.id,file);
            }}
            className={`overflow-hidden rounded-xl border border-dashed transition-colors ${draggingImageId===p.id?'border-[#d3bb73]/25 bg-[#d3bb73]/10':'border-white/10 bg-black/10'} ${busy||productId==='new'?'opacity-60':''}`}
          >
            <input
              ref={node=>{if(node)imageInputs.current.set(p.id,node);else imageInputs.current.delete(p.id);}}
              type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
              disabled={busy||!canEdit||productId==='new'} aria-label={`Zdjęcie pakietu ${p.name || 'Nowy pakiet'}`}
              onChange={event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value='';if(file)void upload(p.id,file);}}
            />
            <button
              type="button" disabled={busy||!canEdit||productId==='new'}
              onClick={()=>imageInputs.current.get(p.id)?.click()}
              aria-label={`${images[p.id]?'Zmień':'Dodaj'} zdjęcie pakietu ${p.name || 'Nowy pakiet'}`}
              aria-busy={preparingImageId===p.id}
              className="group relative flex aspect-square w-full flex-col items-center justify-center overflow-hidden rounded-xl text-center transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[#d3bb73]/25 disabled:cursor-not-allowed"
            >
              {images[p.id]&&<img src={images[p.id]} alt={p.image_alt||p.name} className="absolute inset-0 h-full w-full object-cover"/>}
              <span className={`relative flex flex-col items-center gap-2 p-4 ${images[p.id] ? 'mt-auto w-full bg-[#260b17]/95' : ''}`}>
                {preparingImageId===p.id?<Loader2 className="h-5 w-5 animate-spin text-[#d3bb73]"/>:<ImagePlus className="h-5 w-5 text-[#d3bb73]/80"/>}
                <span className="text-sm font-medium text-[#d3bb73]">{preparingImageId===p.id?'Przygotowuję zdjęcie…':draggingImageId===p.id?'Upuść zdjęcie tutaj':images[p.id]?'Zmień zdjęcie':'Przeciągnij zdjęcie tutaj'}</span>
                <span className="text-xs text-[#e5e4e2]/65">Przeciągnij plik lub kliknij</span>
              </span>
            </button>
          </div>
          <p className="text-xs text-[#e5e4e2]/40">JPG, PNG lub WebP · maks. 10 MB · automatyczna kompresja</p>
          {productId==='new'?<p className="text-xs text-[#e5e4e2]/50">Zapisz produkt, aby dodać zdjęcia pakietów.</p>:<p className="text-xs text-[#e5e4e2]/40">Zdjęcie dotyczy wyłącznie tego pakietu. Zapiszesz je przyciskiem „Zapisz pakiet”.</p>}
          {images[p.id]&&<button type="button" disabled={busy} onClick={()=>{const f=files.current.get(p.id);if(f)URL.revokeObjectURL(f.url);files.current.delete(p.id);setImages(current=>({...current,[p.id]:''}));change(p.id,{image_path:null});}} className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-red-200/80 hover:bg-white/5 disabled:opacity-40"><Trash2 className="h-3.5 w-3.5"/>Usuń zdjęcie pakietu</button>}
          <PackageElementsPicker disabled={busy || !canEdit} elements={elements} selectedIds={p.element_ids} packageName={p.name || 'Nowy pakiet'} onChange={ids => change(p.id, { element_ids: ids })} />
        </div>
          <div className="min-w-0 space-y-4">
        <div className="grid min-w-0 gap-3">{([['name','Nazwa',42],['description','Krótki opis',95],['included_label','Zakres widoczny dla klienta',95],['bonus','Bonus w cenie',65]] as const).map(([key,label,max])=><label key={key} className="text-xs text-[#e5e4e2]/65">{label}<input value={p[key]} maxLength={max} onChange={e=>change(p.id,{[key]:e.target.value})} className={field}/><span className="block text-right opacity-50">{p[key].length}/{max}</span></label>)}<label className="text-xs text-[#e5e4e2]/65">Pełna cena pakietu netto (zł)<input type="number" min={0} step="0.01" value={Number.isFinite(p.price_net)?p.price_net:''} onChange={e=>change(p.id,{price_net:e.target.valueAsNumber})} className={field}/></label><label className="text-xs text-[#e5e4e2]/65">Dodatkowa godzina netto (zł) — opcjonalnie<input type="number" min={0} step="0.01" value={p.extension_price_net_per_hour ?? ''} onChange={e=>change(p.id,{extension_price_net_per_hour:e.target.value === '' ? null : e.target.valueAsNumber})} placeholder="Nie pokazuj stawki" className={field}/><span className="mt-1 block text-xs text-[#e5e4e2]/40">Przedłużenie całego pakietu. Puste pole ukrywa informację; stawka nie jest doliczana do ceny bazowej.</span></label><p className="text-xs leading-5 text-[#e5e4e2]/50">W PDF bordowym tłem wyróżniamy wyłącznie pakiet wybrany w danej ofercie.</p></div>
            <ProductPackageResourcesEditor value={p} disabled={busy || !canEdit} onChange={resources => change(p.id, { resources })}/>
            <ProductPackageCostsEditor value={p} disabled={busy || !canEdit} onChange={cost_items => change(p.id, { cost_items })}/>
          </div>
        </div>

          </fieldset> : <div className="grid gap-5 sm:grid-cols-2">
            <div>{images[p.id] && <img src={images[p.id]} alt={p.image_alt || p.name} className="aspect-square w-full rounded-xl object-cover"/>}<h3 className="mt-3 text-xs text-[#e5e4e2]/50">Elementy pakietu</h3><ul className="mt-2 space-y-1 text-sm">{p.element_ids.map(id => <li key={id}>{elements.find(element => element.id === id)?.name || 'Element niedostępny'}</li>)}</ul>{!p.element_ids.length && <p className="mt-2 text-sm text-[#e5e4e2]/50">Nie wybrano elementów.</p>}</div>
            <div className="space-y-3"><h3 className="text-lg">{p.name}</h3><p className="text-sm text-[#e5e4e2]/70">{p.description}</p><div><p className="text-xs text-[#e5e4e2]/50">Zakres widoczny dla klienta</p><p className="mt-1 text-sm">{p.included_label}</p></div><p className="text-lg text-[#d3bb73]">{p.price_net.toLocaleString('pl-PL')} zł netto</p>{p.bonus && <p className="text-sm text-[#d3bb73]">{p.bonus}</p>}{packageExtensionLabel(p) && <p className="text-xs text-[#e5e4e2]/65">{packageExtensionLabel(p)}</p>}<ProductPackageResourcesEditor value={p} readOnly/><ProductPackageCostSummary value={p}/>{Boolean(p.cost_items?.length) && <ul className="space-y-1 text-xs text-[#e5e4e2]/60">{p.cost_items!.map(cost => <li key={cost.id}>{cost.name}: {cost.quantity.toLocaleString('pl-PL')} × {cost.unit_cost_net.toLocaleString('pl-PL')} zł · {packageCostSettlementLabels[cost.settlement_method || 'invoice']} · koszt spółki: {packageCostLineNet(cost)?.toLocaleString('pl-PL') ?? 'nieustalony'} zł</li>)}</ul>}</div>
          </div>}
        </div>
        <footer className="flex shrink-0 flex-wrap justify-end gap-2 bg-black/10 px-5 py-4">
          <button type="button" disabled={busy} onClick={close} className="rounded-lg bg-white/5 px-3 py-2 text-sm disabled:opacity-40">{draft || deleting ? 'Anuluj' : 'Zamknij'}</button>
          {deleting ? <button type="button" disabled={busy || !canEdit} onClick={() => void persist(true)} className="flex items-center gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-200 disabled:opacity-40">{saving ? <Loader2 className="h-4 w-4 animate-spin"/> : <Trash2 className="h-4 w-4"/>}Usuń pakiet</button> : draft ? <button type="button" disabled={busy || !canEdit} onClick={() => void persist()} className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-3 py-2 text-sm text-[#1c1f33] disabled:opacity-40">{saving || preparing ? <Loader2 className="h-4 w-4 animate-spin"/> : <Save className="h-4 w-4"/>}{saving ? 'Zapisywanie…' : 'Zapisz pakiet'}</button> : canEdit && <button type="button" disabled={busy} onClick={() => { setDraft(structuredClone(active)); onEditingChange(true); }} className="flex items-center gap-2 rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-sm text-[#d3bb73]"><Pencil className="h-4 w-4"/>Edytuj</button>}
        </footer>
      </div>}
    </dialog>
  </section>;
}
