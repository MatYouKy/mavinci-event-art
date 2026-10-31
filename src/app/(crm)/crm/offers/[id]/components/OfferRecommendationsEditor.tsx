'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';
import { Plus, Save, Sparkles, GripVertical, Eye, Pencil, Trash2 } from 'lucide-react';
import Dialog from '@mui/material/Dialog';
import ResponsiveActionBar from '@/components/crm/ResponsiveActionBar';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import AddOfferItemModal, { ProductThumbnail } from './AddOfferItemModal';
import type { OfferRecommendation } from './offerRecommendation';
import ProductAddonsEditor from '@/components/crm/offers/ProductAddonsEditor';
import ModularProductConfigurator from '@/components/crm/offers/ModularProductConfigurator';
import { modularTitle, modularScope } from '@/lib/CRM/Offers/modularProduct';
import ModularPriceHint from '@/components/crm/offers/ModularPriceHint';
import { configurationPrice, createModularConfiguration, createConfiguration, validateConfiguration } from '@/lib/CRM/Offers/offerAddons';

type Props = { offer: any; canEdit: boolean; onSaved: () => void };
const money = (value: number) => value.toLocaleString('pl-PL', { style: 'currency', currency: 'PLN' });

export default function OfferRecommendationsEditor({ offer, canEdit: mayEdit, onSaved }: Props) {
  const { showSnackbar } = useSnackbar();
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState<OfferRecommendation | null>(null);
  const updateDraft = (_id: string, patch: Partial<OfferRecommendation>) => setEditDraft(current => {
    if (!current) return current;
    const next = { ...current, ...patch, ...(patch.description !== undefined ? { description_override: true } : {}) };
    if (next.pricing_configuration) next.unit_price = Math.round(configurationPrice(next.pricing_configuration) * (1 - (next.discount_percent ?? 0) / 100) * 100) / 100;
    return next;
  });
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
    if (next.some((item) => !item.name.trim() || !Number.isInteger(item.days ?? 1) || (item.days ?? 1) < 1 || (item.days ?? 1) > 3650 || !Number.isFinite(item.quantity) || item.quantity <= 0 || !Number.isFinite(item.unit_price) || item.unit_price < 0)) {
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
      // Package snapshots include resources and can exceed the URL limit.
      // Compare and save them atomically through a POST body instead.
      const { data, error } = await supabase.rpc('save_offer_recommendations', {
        p_offer_id: offer.id,
        p_expected_recommendations: original,
        p_recommendations: next,
      });
      if (error) throw error;
      if (!data || !Array.isArray(data.recommended_items)) throw new Error('Nie otrzymano potwierdzenia zapisu propozycji. Odśwież ofertę, aby sprawdzić zapisane dane.');
      // Use the server snapshot: participant-based prices may be normalized there.
      const saved = data.recommended_items as OfferRecommendation[];
      setItems(saved);
      setOriginal(saved);
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
    <section data-offer-editing={editing || Boolean(editDraft)} className="rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-lg font-medium text-[#e5e4e2]"><Sparkles className="h-5 w-5 shrink-0 text-[#d3bb73]" />Zobacz, co warto dobrać do takiego wydarzenia</h2>
          <p className="mt-2 text-sm text-[#e5e4e2]/60">Proponowane produkty z indywidualnymi cenami. Poza wyceną i rezerwacją sprzętu; w PDF po kalkulacji i pakietach.</p>
          <p className="mt-2 text-xs text-[#e5e4e2]/45">Przy dodawaniu ukrywamy produkty obecne już w głównej ofercie, razem z ich wariantami.</p>
        </div>
        <div className="ml-auto flex shrink-0 flex-col items-end gap-2">
      {mayEdit && <div className="flex gap-2">
        {!editing ? <button type="button" className="rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-sm text-[#d3bb73] disabled:opacity-50" onClick={() => setEditing(true)}>Edytuj</button>
        : <button type="button" disabled={saving} className="rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-sm text-[#d3bb73] disabled:opacity-50" onClick={() => { setItems(original.filter(item => !mainOfferProductIds.has(item.product_id))); setDirty(false); setShowAdd(false); setEditing(false); }}>Anuluj</button>}
      </div>}
        {canEdit && <div className="flex flex-wrap justify-end gap-2">
          <button type="button" disabled={saving} onClick={() => setShowAdd(true)} className="flex items-center gap-2 rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-sm text-[#d3bb73] disabled:opacity-50"><Plus className="h-4 w-4" />Dodaj produkt</button>
          {dirty && <button type="button" disabled={saving} onClick={save} className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-3 py-2 text-sm text-[#0f1119] disabled:opacity-50"><Save className="h-4 w-4" />{saving ? 'Zapisywanie…' : 'Zapisz'}</button>}
        </div>}
        </div>
      </div>

      {!items.length && <p className="mt-5 text-sm text-[#e5e4e2]/50">Wybierz produkty warte zaproponowania klientowi, np. telewizor, oświetlenie lub podest. Pusta sekcja nie pojawi się w PDF.</p>}
      {canEdit && items.length > 1 && <p className="mt-3 text-xs text-[#e5e4e2]/50">Przeciągnij za uchwyt, aby zmienić kolejność w PDF. Zatwierdź przyciskiem „Zapisz”.</p>}
      <DragDropContext onDragEnd={handleDragEnd} dragHandleUsageInstructions="Naciśnij spację, aby podnieść propozycję, użyj strzałek do zmiany kolejności i ponownie spacji, aby ją odłożyć. Escape anuluje przeciąganie.">
        <Droppable droppableId={`offer-recommendations-${offer.id}`} isDropDisabled={!canEdit}>
          {(dropProvided) => <div ref={dropProvided.innerRef} {...dropProvided.droppableProps} className="mt-5 space-y-3">
        {items.map((item, index) => <Draggable key={item.id} draggableId={item.id} index={index} isDragDisabled={!canEdit}>
          {(provided, snapshot) => <div ref={provided.innerRef} {...provided.draggableProps} className={`rounded-lg border border-[#d3bb73]/10 bg-[#0f1118] p-4 ${snapshot.isDragging ? 'shadow-lg shadow-black/25' : ''}`}>
          <div className="flex items-start gap-3">
            {canEdit && <button type="button" {...provided.dragHandleProps} aria-label={`Zmień kolejność propozycji: ${item.name}`} className="shrink-0 cursor-grab touch-none p-1 text-[#e5e4e2]/40"><GripVertical className="h-5 w-5" /></button>}
            <a href={`/produkty/${item.product_id}`} target="_blank" rel="noopener noreferrer" className="shrink-0">
              {item.image_path && imageUrls[item.image_path] ? <img src={imageUrls[item.image_path]} alt={item.name} className="h-16 w-12 rounded-md object-cover md:h-24 md:w-20" /> : <ProductThumbnail src={null} />}
            </a>
            <div className="min-w-0 flex-1">
              <h3 className="line-clamp-1 text-sm font-semibold text-[#e5e4e2] md:text-base"><a href={`/produkty/${item.product_id}`} target="_blank" rel="noopener noreferrer" className="underline decoration-[#d3bb73]/30 underline-offset-4">{item.name}</a></h3>
              <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-[#e5e4e2]/55 md:text-sm">{item.description}</p>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[#e5e4e2]/55">
                <span>Ilość: <strong className="text-[#e5e4e2]">{item.quantity} {item.unit} × {item.days ?? 1} dni</strong></span>
                <span>Cena netto: <strong className="text-[#e5e4e2]">{money(item.unit_price)}</strong></span>
                <span>Cena brutto (VAT {vatRate}%): <strong className="text-[#e5e4e2]">{money(item.unit_price * (1 + vatRate / 100))}</strong></span>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-[10px] uppercase text-[#e5e4e2]/40">Układ w PDF</span>
                <div className="inline-flex rounded-lg bg-white/5 p-1">
                  {([{ value: 'compact', label: 'Kompaktowo · 3/str.' }, { value: 'full_page', label: 'Osobna strona' }, { value: 'visual', label: 'Duża grafika' }] as const).map(layout => <button key={layout.value} type="button" disabled={!mayEdit || saving} aria-pressed={(item.pdf_layout || 'compact') === layout.value} onClick={() => { setEditing(true); update(item.id, { pdf_layout: layout.value }); }} className={`rounded-md px-3 py-1 text-xs disabled:opacity-60 ${(item.pdf_layout || 'compact') === layout.value ? 'bg-[#6b0024] text-white' : 'text-[#e5e4e2]/60 hover:bg-white/5'}`}>{layout.label}</button>)}
                </div>
                <span className="text-xs text-[#d3bb73]">Poza wyceną</span>
              </div>
            </div>
            <div className="shrink-0">
              <ResponsiveActionBar disabledBackground mobileBreakpoint={4000} actions={[
                { label: 'Otwórz produkt w CRM', icon: <Eye className="h-4 w-4" />, show: Boolean(item.product_id), onClick: () => window.open(`/crm/offers/products/${item.product_id}`, '_blank', 'noopener,noreferrer') },
                { label: 'Edytuj', icon: <Pencil className="h-4 w-4" />, variant: 'primary', show: mayEdit, disabled: saving, onClick: () => { setEditing(true); setEditDraft(structuredClone(item)); } },
                { label: 'Usuń', icon: <Trash2 className="h-4 w-4" />, variant: 'danger', show: mayEdit, disabled: saving, onClick: () => { setEditing(true); setItems(current => current.filter(row => row.id !== item.id)); setDirty(true); } },
              ]} />
            </div>
          </div>
          <div className="mt-4 flex items-end justify-between gap-3 border-t border-[#d3bb73]/10 pt-3">
            <p className="text-xs text-[#e5e4e2]/50">Wartość netto: {money(item.quantity * (item.days ?? 1) * item.unit_price)}</p>
            <div className="text-right"><p className="text-[10px] uppercase text-[#e5e4e2]/40">Brutto · VAT {vatRate}%</p><p className="text-xl font-semibold text-[#d3bb73]">{money(item.quantity * (item.days ?? 1) * item.unit_price * (1 + vatRate / 100))}</p></div>
          </div>
        </div>}
        </Draggable>)}
            {dropProvided.placeholder}
          </div>}
        </Droppable>
      </DragDropContext>
      <Dialog open={Boolean(editDraft)} onClose={() => { if (!saving) setEditDraft(null); }} fullWidth maxWidth="md">
        {editDraft && <div className="bg-[#1c1f33] p-6 text-[#e5e4e2]">
          <h2 className="mb-4 text-lg uppercase">Edytuj propozycję</h2>
          <p className="mb-4 text-sm text-[#d3bb73]">Pozycja poza wyceną — nie zmienia sumy oferty.</p>
          <fieldset disabled={saving} className="space-y-3">
              <input aria-label="Nazwa proponowanego produktu" maxLength={160} value={editDraft.name} disabled={!canEdit || saving} onChange={(event) => updateDraft(editDraft.id, { name: event.target.value })} className={inputClass} />
              <textarea aria-label="Opis proponowanego produktu" maxLength={5000} rows={editDraft.pdf_layout === 'full_page' ? 6 : 2} value={editDraft.description} disabled={!canEdit || saving} onChange={(event) => updateDraft(editDraft.id, { description: event.target.value })} className={inputClass} placeholder="Dlaczego warto wybrać ten produkt?" />
              {editDraft.pricing_configuration?.modular && <ModularProductConfigurator quantity={editDraft.quantity} value={editDraft.pricing_configuration.modular} disabled={!canEdit || saving} onChange={modular => updateDraft(editDraft.id, { pricing_configuration:createModularConfiguration(modular, editDraft.pricing_configuration?.modular_price_source === 'manual' ? editDraft.pricing_configuration.base_unit_price : undefined), name:modularTitle(modular), description:modularScope(modular).join('\n') })} />}
              {editDraft.pricing_configuration?.modular && <ModularPriceHint value={editDraft.pricing_configuration.modular} manual={editDraft.pricing_configuration.modular_price_source === 'manual'} disabled={!canEdit || saving} onReset={() => updateDraft(editDraft.id, { pricing_configuration: createModularConfiguration(editDraft.pricing_configuration!.modular!) })} />}
              <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-3">
                <label className="text-xs text-[#e5e4e2]/60">Liczba dni<input type="number" min="1" max="3650" step="1" value={editDraft.days ?? 1} disabled={!canEdit || saving} onChange={event => updateDraft(editDraft.id, { days: event.target.valueAsNumber })} className={inputClass} /></label><label className="text-xs text-[#e5e4e2]/60">Ilość ({editDraft.unit})<input type="number" min="0.01" step="0.01" value={editDraft.quantity} disabled={!canEdit || saving} onChange={(event) => updateDraft(editDraft.id, { quantity: event.target.valueAsNumber })} className={inputClass} /></label>
                <label className="text-xs text-[#e5e4e2]/60">{editDraft.pricing_configuration ? 'Cena bazowa netto' : 'Cena jednostkowa netto'}<input type="number" min="0" step="0.01" value={Number.isFinite(editDraft.pricing_configuration?.base_unit_price ?? editDraft.unit_price) ? (editDraft.pricing_configuration?.base_unit_price ?? editDraft.unit_price) : ''} disabled={!canEdit || saving} onChange={(event) => updateDraft(editDraft.id, editDraft.pricing_configuration ? { pricing_configuration: editDraft.pricing_configuration.modular ? createModularConfiguration(editDraft.pricing_configuration.modular, event.target.valueAsNumber) : createConfiguration(event.target.valueAsNumber, editDraft.pricing_configuration.addons, editDraft.pricing_configuration.product_package) } : { unit_price: event.target.valueAsNumber })} className={inputClass} /></label>
                {editDraft.pricing_configuration && <label className="text-xs text-[#e5e4e2]/60">Rabat (%)<input type="number" min="0" max="100" step="0.01" value={Number.isFinite(editDraft.discount_percent ?? 0) ? (editDraft.discount_percent ?? 0) : ''} disabled={!canEdit || saving} onChange={(event) => updateDraft(editDraft.id, { discount_percent: event.target.valueAsNumber })} className={inputClass} /></label>}
                <p className="text-sm text-[#d3bb73]">{money(editDraft.quantity * (editDraft.days ?? 1) * editDraft.unit_price)} netto<span className="block text-xs text-[#e5e4e2]/60">{money(editDraft.quantity * (editDraft.days ?? 1) * editDraft.unit_price * (1 + vatRate / 100))} brutto</span></p>
              </div>
              {editDraft.pricing_configuration && !editDraft.pricing_configuration.modular && <details className="rounded-lg bg-black/10 p-3">
                <summary className="cursor-pointer text-sm text-[#d3bb73]">Zakres i dodatki ({editDraft.pricing_configuration.addons.length})</summary>
                <div className="mt-3"><ProductAddonsEditor value={editDraft.pricing_configuration.addons} disabled={!canEdit || saving} onChange={(addons) => updateDraft(editDraft.id, { pricing_configuration: createConfiguration(editDraft.pricing_configuration!.base_unit_price, addons, editDraft.pricing_configuration!.product_package) })} /></div>
              </details>}
          </fieldset>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" disabled={saving} onClick={() => setEditDraft(null)} className="rounded-lg bg-white/5 px-4 py-2">Anuluj</button>
            <button type="button" disabled={saving} onClick={async () => {
              try { await persist(items.map(item => item.id === editDraft.id ? editDraft : item)); setEditDraft(null); showSnackbar('Propozycja zapisana poza wyceną', 'success'); }
              catch (error: any) { showSnackbar(error.message || 'Nie udało się zapisać propozycji', 'error'); }
            }} className="rounded-lg bg-[#d3bb73] px-4 py-2 text-[#250914] disabled:opacity-50">{saving ? 'Zapisywanie…' : 'Zapisz'}</button>
          </div>
        </div>}
      </Dialog>
      {showAdd && <AddOfferItemModal offerId={offer.id} excludedProductIds={new Set([...Array.from(mainOfferProductIds),...items.map(item=>item.product_id)])} onClose={() => setShowAdd(false)} onSuccess={() => {}} onAddRecommendation={async (item) => {
        if (mainOfferProductIds.has(item.product_id)) throw new Error('Ten produkt jest już w głównej ofercie. Nie dodawaj go ponownie do propozycji.');
        if (items.some((row) => row.product_id === item.product_id)) throw new Error('Ten produkt jest już na liście propozycji.');
        setItems(current => [...current, item]);
        setDirty(true);
      }} />}
    </section>
  );
}
