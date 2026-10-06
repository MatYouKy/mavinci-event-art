'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';
import { Plus, Save, Trash2, Sparkles, ArrowUp, ArrowDown, GripVertical } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import AddOfferItemModal, { ProductThumbnail } from './AddOfferItemModal';
import type { OfferRecommendation } from './offerRecommendation';
import ProductAddonsEditor from '@/components/crm/offers/ProductAddonsEditor';
import { configurationPrice, createConfiguration, validateConfiguration } from '@/lib/CRM/Offers/offerAddons';

type Props = { offer: any; canEdit: boolean; onSaved: () => void };
const money = (value: number) => value.toLocaleString('pl-PL', { style: 'currency', currency: 'PLN' });

export default function OfferRecommendationsEditor({ offer, canEdit: mayEdit, onSaved }: Props) {
  const { showSnackbar } = useSnackbar();
  const [editing, setEditing] = useState(false);
  const [items, setItems] = useState<OfferRecommendation[]>([]);
  const [original, setOriginal] = useState<OfferRecommendation[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const canEdit = mayEdit && editing && !saving;
  const savingRef = useRef(false);
  const [showAdd, setShowAdd] = useState(false);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const mainOfferProductIds = useMemo(() => new Set<string>((offer.offer_items || [])
    .map((item: { product_id?: string | null }) => item.product_id)
    .filter((id: string | null | undefined): id is string => Boolean(id))), [offer.offer_items]);
  useEffect(() => {
    // A product moved to the main offer must disappear even when other proposals
    // have local edits. Preserve those edits and their optimistic-lock snapshot.
    setItems(current => current.filter(item => !mainOfferProductIds.has(item.product_id)));
    setOriginal(current => current.filter(item => !mainOfferProductIds.has(item.product_id)));
  }, [mainOfferProductIds]);
  const imagePathsKey = JSON.stringify(Array.from(new Set(items.map((item) => item.image_path).filter(Boolean))));
  useEffect(() => {
    let cancelled = false;
    const paths: string[] = JSON.parse(imagePathsKey);
    if (!paths.length) { setImageUrls({}); return; }
    void supabase.storage.from('offer-product-pages').createSignedUrls(paths, 3600).then(({ data }) => {
      if (cancelled) return;
      setImageUrls(Object.fromEntries((data || []).filter((image) => image.path && image.signedUrl && !image.error).map((image) => [image.path!, image.signedUrl!])));
    });
    return () => { cancelled = true; };
  }, [imagePathsKey]);
  const vatRate = Number(offer.tax_percent ?? 23);

  useEffect(() => {
    if (dirty) return;
    const saved = Array.isArray(offer.recommended_items) ? offer.recommended_items : [];
    setItems(saved);
    setOriginal(saved);
  }, [offer.id, offer.recommended_items]);

  const persist = async (next: OfferRecommendation[]) => {
    if (!canEdit || savingRef.current) throw new Error('Nie można teraz zapisać propozycji.');
    if (next.some((item) => !item.name.trim() || !Number.isFinite(item.quantity) || item.quantity <= 0 || !Number.isFinite(item.unit_price) || item.unit_price < 0)) {
      throw new Error('Uzupełnij nazwę, dodatnią ilość i cenę nie mniejszą niż zero.');
    }
    for (const item of next) {
      if (!item.pricing_configuration) continue;
      const error = validateConfiguration(item.pricing_configuration);
      if (error) throw new Error(`${item.name}: ${error}`);
      const discount = item.discount_percent ?? 0;
      if (!Number.isFinite(discount) || discount < 0 || discount > 100) throw new Error('Podaj rabat od 0 do 100%.');
    }
    const keys = next.map((item) => item.product_id);
    if (new Set(keys).size !== keys.length) throw new Error('Ta sama pozycja występuje na liście propozycji więcej niż raz. Usuń powtórzenie.');
    savingRef.current = true;
    setSaving(true);
    try {
      // Re-read the quote before saving: the catalog may have been open while
      // another employee added a product to the main offer.
      const quoted = await supabase.from('offer_items').select('product_id').eq('offer_id', offer.id);
      if (quoted.error) throw quoted.error;
      const quotedProducts = new Set((quoted.data || []).map((item) => item.product_id).filter(Boolean));
      if (next.some((item) => quotedProducts.has(item.product_id))) {
        throw new Error('Produkt z propozycji jest już w głównej ofercie. Usuń go z propozycji i odśwież ofertę, aby wczytać aktualny katalog.');
      }
      const { data, error } = await supabase.from('offers')
        .update({ recommended_items: next })
        .eq('id', offer.id)
        .eq('recommended_items', JSON.stringify(original))
        .select('id')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Oferta została zmieniona w innym oknie lub nie masz prawa zapisu. Odśwież ofertę przed kolejną zmianą.');
      setItems(next);
      setOriginal(next);
      setDirty(false);
      onSaved();
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const save = async () => {
    try {
      await persist(items);
      setEditing(false);
      showSnackbar('Propozycje zapisane poza wyceną', 'success');
    } catch (error: any) {
      showSnackbar(error.message || 'Nie udało się zapisać propozycji', 'error');
    }
  };
  const update = (id: string, patch: Partial<OfferRecommendation>) => {
    setItems((current) => current.map((item) => {
      if (item.id !== id) return item;
      const next = { ...item, ...patch };
      if (next.pricing_configuration) next.unit_price = Math.round(configurationPrice(next.pricing_configuration) * (1 - (next.discount_percent ?? 0) / 100) * 100) / 100;
      return next;
    }));
    setDirty(true);
  };
  const move = (index: number, direction: number) => {
    if (!canEdit || savingRef.current || index + direction < 0 || index + direction >= items.length) return;
    setItems((current) => {
      const next = [...current];
      [next[index], next[index + direction]] = [next[index + direction], next[index]];
      return next;
    });
    setDirty(true);
  };
  const handleDragEnd = ({ source, destination }: DropResult) => {
    if (!canEdit || savingRef.current || !destination || source.index === destination.index) return;
    setItems(current => {
      if (source.index < 0 || source.index >= current.length || destination.index < 0 || destination.index >= current.length) return current;
      const next = [...current];
      const [moved] = next.splice(source.index, 1);
      next.splice(destination.index, 0, moved);
      return next;
    });
    setDirty(true);
  };
  const inputClass = 'w-full rounded border border-[#d3bb73]/20 bg-[#0f1119] p-2 text-sm text-[#e5e4e2] disabled:opacity-70';

  return (
    <section className="rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-medium text-[#e5e4e2]"><Sparkles className="h-5 w-5 shrink-0 text-[#d3bb73]" />Zobacz, co warto dobrać do takiego wydarzenia</h2>
          <p className="mt-2 text-sm text-[#e5e4e2]/60">Proponowane produkty z indywidualnymi cenami. Poza wyceną i rezerwacją sprzętu; w PDF po kalkulacji i pakietach.</p>
          <p className="mt-2 text-xs text-[#e5e4e2]/45">Przy dodawaniu ukrywamy produkty obecne już w głównej ofercie, razem z ich wariantami.</p>
        </div>
        {canEdit && <div className="flex gap-2">
          <button type="button" disabled={saving} onClick={() => setShowAdd(true)} className="flex items-center gap-2 rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-sm text-[#d3bb73] disabled:opacity-50"><Plus className="h-4 w-4" />Dodaj produkt</button>
          {dirty && <button type="button" disabled={saving} onClick={save} className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-3 py-2 text-sm text-[#0f1119] disabled:opacity-50"><Save className="h-4 w-4" />{saving ? 'Zapisywanie…' : 'Zapisz'}</button>}
        </div>}
      </div>
      {mayEdit && <div className="mt-3 flex gap-2">
        {!editing ? <button type="button" className="rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-sm text-[#d3bb73] disabled:opacity-50" onClick={() => setEditing(true)}>Edytuj</button>
        : <button type="button" disabled={saving} className="rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-sm text-[#d3bb73] disabled:opacity-50" onClick={() => { setItems(original.filter(item => !mainOfferProductIds.has(item.product_id))); setDirty(false); setShowAdd(false); setEditing(false); }}>Anuluj</button>}
      </div>}
      {!items.length && <p className="mt-5 text-sm text-[#e5e4e2]/50">Wybierz produkty warte zaproponowania klientowi, np. telewizor, oświetlenie lub podest. Pusta sekcja nie pojawi się w PDF.</p>}
      {canEdit && items.length > 1 && <p className="mt-3 text-xs text-[#e5e4e2]/50">Przeciągnij za uchwyt, aby zmienić kolejność w PDF. Zatwierdź przyciskiem „Zapisz”.</p>}
      <DragDropContext onDragEnd={handleDragEnd} dragHandleUsageInstructions="Naciśnij spację, aby podnieść propozycję, użyj strzałek do zmiany kolejności i ponownie spacji, aby ją odłożyć. Escape anuluje przeciąganie.">
        <Droppable droppableId={`offer-recommendations-${offer.id}`} isDropDisabled={!canEdit}>
          {(dropProvided) => <div ref={dropProvided.innerRef} {...dropProvided.droppableProps} className="mt-5 space-y-3">
        {items.map((item, index) => <Draggable key={item.id} draggableId={item.id} index={index} isDragDisabled={!canEdit}>
          {(provided, snapshot) => <div ref={provided.innerRef} {...provided.draggableProps} className={`rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-4 ${snapshot.isDragging ? 'shadow-lg shadow-black/25' : ''}`}>
          <div className="flex items-start gap-3">
            {canEdit && <button type="button" {...provided.dragHandleProps} aria-label={`Zmień kolejność propozycji: ${item.name}`} className="shrink-0 cursor-grab touch-none rounded p-1 text-[#e5e4e2]/40 hover:bg-[#d3bb73]/10 hover:text-[#d3bb73] active:cursor-grabbing"><GripVertical className="h-5 w-5" /></button>}
            <ProductThumbnail src={item.image_path ? imageUrls[item.image_path] : null} />
            <div className="min-w-0 flex-1 space-y-3">
              <input aria-label="Nazwa proponowanego produktu" maxLength={160} value={item.name} disabled={!canEdit || saving} onChange={(event) => update(item.id, { name: event.target.value })} className={inputClass} />
              <textarea aria-label="Opis proponowanego produktu" maxLength={500} rows={2} value={item.description} disabled={!canEdit || saving} onChange={(event) => update(item.id, { description: event.target.value })} className={inputClass} placeholder="Dlaczego warto wybrać ten produkt?" />
              <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-3">
                <label className="text-xs text-[#e5e4e2]/60">Ilość ({item.unit})<input type="number" min="0.01" step="0.01" value={item.quantity} disabled={!canEdit || saving} onChange={(event) => update(item.id, { quantity: event.target.valueAsNumber })} className={inputClass} /></label>
                <label className="text-xs text-[#e5e4e2]/60">{item.pricing_configuration ? 'Cena bazowa netto' : 'Cena jednostkowa netto'}<input type="number" min="0" step="0.01" value={Number.isFinite(item.pricing_configuration?.base_unit_price ?? item.unit_price) ? (item.pricing_configuration?.base_unit_price ?? item.unit_price) : ''} disabled={!canEdit || saving} onChange={(event) => update(item.id, item.pricing_configuration ? { pricing_configuration: createConfiguration(event.target.valueAsNumber, item.pricing_configuration.addons, item.pricing_configuration.product_package) } : { unit_price: event.target.valueAsNumber })} className={inputClass} /></label>
                {item.pricing_configuration && <label className="text-xs text-[#e5e4e2]/60">Rabat (%)<input type="number" min="0" max="100" step="0.01" value={Number.isFinite(item.discount_percent ?? 0) ? (item.discount_percent ?? 0) : ''} disabled={!canEdit || saving} onChange={(event) => update(item.id, { discount_percent: event.target.valueAsNumber })} className={inputClass} /></label>}
                <p className="text-sm text-[#d3bb73]">{money(item.quantity * item.unit_price)} netto<span className="block text-xs text-[#e5e4e2]/60">{money(item.quantity * item.unit_price * (1 + vatRate / 100))} brutto</span></p>
              </div>
              {item.pricing_configuration && <details className="rounded-lg bg-black/10 p-3">
                <summary className="cursor-pointer text-sm text-[#d3bb73]">Zakres i dodatki ({item.pricing_configuration.addons.length})</summary>
                <div className="mt-3"><ProductAddonsEditor value={item.pricing_configuration.addons} disabled={!canEdit || saving} onChange={(addons) => update(item.id, { pricing_configuration: createConfiguration(item.pricing_configuration!.base_unit_price, addons, item.pricing_configuration!.product_package) })} /></div>
              </details>}
            </div>
            {canEdit && <div className="flex flex-col gap-2">
              <button type="button" aria-label="Przenieś wyżej" disabled={saving || index === 0} onClick={() => move(index, -1)} className="text-[#d3bb73] disabled:opacity-25"><ArrowUp className="h-4 w-4" /></button>
              <button type="button" aria-label="Przenieś niżej" disabled={saving || index === items.length - 1} onClick={() => move(index, 1)} className="text-[#d3bb73] disabled:opacity-25"><ArrowDown className="h-4 w-4" /></button>
              <button type="button" aria-label={`Usuń propozycję ${item.name}`} disabled={saving} onClick={() => { setItems((current) => current.filter((row) => row.id !== item.id)); setDirty(true); }} className="text-red-400 disabled:opacity-25"><Trash2 className="h-4 w-4" /></button>
            </div>}
          </div>
        </div>}
        </Draggable>)}
            {dropProvided.placeholder}
          </div>}
        </Droppable>
      </DragDropContext>
      {showAdd && <AddOfferItemModal offerId={offer.id} excludedProductIds={new Set([...Array.from(mainOfferProductIds),...items.map(item=>item.product_id)])} onClose={() => setShowAdd(false)} onSuccess={() => {}} onAddRecommendation={async (item) => {
        if (mainOfferProductIds.has(item.product_id)) throw new Error('Ten produkt jest już w głównej ofercie. Nie dodawaj go ponownie do propozycji.');
        if (items.some((row) => row.product_id === item.product_id)) throw new Error('Ten produkt jest już na liście propozycji.');
        setItems(current => [...current, item]);
        setDirty(true);
      }} />}
    </section>
  );
}
