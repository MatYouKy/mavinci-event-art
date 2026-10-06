'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Eye, GripVertical, Layers3, Loader2, Pencil, Plus, Star, Trash2, Truck, X } from 'lucide-react';
import { DragDropContext, Draggable, Droppable } from '@hello-pangea/dnd';
import ResponsiveActionBar from '@/components/crm/ResponsiveActionBar';
import { supabase } from '@/lib/supabase/browser';
import OfferLogisticsEstimateEditor from '@/components/crm/offers/OfferLogisticsEstimateEditor';
import { emptyLogisticsEstimate, summarizeLogisticsEstimate, type LogisticsEstimate } from '@/lib/CRM/Offers/logisticsEstimate';
import { useSnackbar } from '@/contexts/SnackbarContext';

type Position = { id: string; product_id: string; product_variant_id: string | null; name: string; quantity: number; unit: string; unit_price: number };
type PackageItem = { offer_item_id: string; product_id: string; product_variant_id: string | null; quantity: number };
type Package = { id: string; name: string; description: string; price_net: number; list_price_net: number; discount_amount: number; discount_percent: number; is_recommended: boolean; items: PackageItem[] };
type Logistics = { cost: string; price: string; enabled: boolean; description: string; estimate: LogisticsEstimate | null };
type Modal = { kind: 'package'; value: Package; editing: boolean; creating: boolean } | { kind: 'logistics'; value: Logistics; editing: boolean } | { kind: 'delete'; value: Package };
const money = (n: number) => n.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const field = 'mt-1 w-full rounded-lg border border-white/10 bg-black/15 px-3 py-2 text-sm text-[#e5e4e2]';
const button = 'rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-sm text-[#d3bb73] disabled:opacity-40';
const primary = 'rounded-lg bg-[#d3bb73] px-3 py-2 text-sm text-[#1c1f33] disabled:opacity-40';
const logisticsFrom = (o: any): Logistics => ({ estimate: o.logistics_estimate ?? (o.logistics_cost_net == null ? emptyLogisticsEstimate() : null), cost: o.logistics_cost_net == null ? '' : String(o.logistics_cost_net), price: String(o.logistics_price_net ?? 0), enabled: Boolean(o.logistics_enabled), description: o.logistics_description || 'Transport, załadunek i obsługa logistyczna realizacji.' });
const validMoney = (s: string) => s.trim() !== '' && Number.isFinite(Number(s)) && Number(s) >= 0 && Number(s) <= 99999999.99 && Math.abs(Number(s) * 100 - Math.round(Number(s) * 100)) < 0.00001;

export default function OfferPackagesEditor({ offer, canEdit, onSaved }: { offer: any; canEdit: boolean; onSaved?: () => void }) {
  const { showSnackbar } = useSnackbar();
  const dialog = useRef<HTMLDialogElement>(null);
  const submitting = useRef(false);
  const titleId = useId();
  const listId = useId();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [routeBusy, setRouteBusy] = useState(false);
  const [packages, setPackages] = useState<Package[]>([]);
  const [enabled, setEnabled] = useState(Boolean(offer.package_mode));
  const [revision, setRevision] = useState<number>(offer.content_revision ?? 0);
  const [logistics, setLogistics] = useState<Logistics>(() => logisticsFrom(offer));
  const [modal, setModal] = useState<Modal | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [showCatalog, setShowCatalog] = useState(false);
  const positions: Position[] = useMemo(() => (offer.offer_items || []).filter((i: any) => i.id && (i.product_id || i.product?.id)).map((i: any) => ({
    id: i.id, product_id: i.product_id || i.product.id, product_variant_id: i.product_variant_id || null,
    name: i.name || i.product?.name || 'Pozycja oferty', quantity: Number(i.quantity || 1), unit: i.unit || 'szt.', unit_price: Number(i.unit_price || 0),
  })), [offer.offer_items]);

  const load = async () => {
    setLoading(true); setLoadError('');
    try {
      const [rows, state] = await Promise.all([
        supabase.from('offer_packages').select('id,name,description,price_net,list_price_net,discount_amount,discount_percent,is_recommended,items:offer_package_items(offer_item_id,product_id,product_variant_id,quantity,display_order)').eq('offer_id', offer.id).order('display_order'),
        supabase.from('offers').select('content_revision,package_mode,logistics_cost_net,logistics_estimate,logistics_enabled,logistics_price_net,logistics_description').eq('id', offer.id).single(),
      ]);
      if (rows.error) throw rows.error;
      if (state.error) throw state.error;
      setPackages((rows.data || []).map((p: any) => ({ ...p, description: p.description || '', items: [...(p.items || [])].sort((a,b) => a.display_order-b.display_order).map((i: any) => ({ ...i, offer_item_id: i.offer_item_id || positions.find(source => source.product_id === i.product_id)?.id || '', quantity: Number(i.quantity) })) })));
      setEnabled(state.data.package_mode); setLogistics(logisticsFrom(state.data)); setRevision(state.data.content_revision);
    } catch (e: any) { setLoadError(e.message || 'Nie udało się wczytać pakietów i logistyki.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (!modal && !submitting.current) void load(); /* Refresh only saved data; drafts stay local. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offer.id, offer.content_revision]);
  useEffect(() => {
    if (!modal) { dialog.current?.close(); return; }
    dialog.current?.showModal();
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = overflow; };
  }, [Boolean(modal)]);
  const close = () => { if (submitting.current) return; setModal(null); setError(''); };
  const open = (next: Modal) => { setError(''); setQuery(''); setShowCatalog(false); setModal(next); };
  const newPackage = () => open({ kind: 'package', creating: true, editing: true, value: { id: crypto.randomUUID(), name: '', description: '', price_net: 0, list_price_net: 0, discount_amount: 0, discount_percent: 0, is_recommended: false, items: [] } });
  const listPrice = (items: PackageItem[]) => round(items.reduce((sum, i) => sum + Number(positions.find(p => p.id === i.offer_item_id)?.unit_price || 0) * i.quantity, 0));
  const calculate = (p: Package, amount = p.discount_amount): Package => {
    const list = listPrice(p.items), discount = Math.min(list, Math.max(0, amount));
    return { ...p, list_price_net: list, discount_amount: round(discount), discount_percent: list ? round(discount / list * 100) : 0, price_net: round(list - discount) };
  };
  const patch = (changes: Partial<Package>) => setModal(current => current?.kind === 'package' ? { ...current, value: { ...current.value, ...changes } } : current);
  const patchLogistics = (changes: Partial<Logistics>) => setModal(current => current?.kind === 'logistics' ? { ...current, value: { ...current.value, ...changes } } : current);

  const save = async (nextPackages: Package[] | null, nextEnabled = enabled, nextLogistics: Logistics | null = null) => {
    if (!canEdit || submitting.current || routeBusy) return;
    setError('');
    if (nextLogistics?.estimate) {
      const calculation = summarizeLogisticsEstimate(nextLogistics.estimate);
      if (calculation.error || calculation.total == null) { setError(calculation.error); return; }
      nextLogistics = { ...nextLogistics, cost: String(calculation.total) };
    }
    if (nextLogistics && (!validMoney(nextLogistics.cost) || !validMoney(nextLogistics.price))) { setError('Podaj nieujemny koszt i cenę z maksymalnie dwoma miejscami po przecinku. Wpisz 0, jeśli koszt nie występuje.'); return; }
    if (nextPackages && nextPackages.some(p => !p.name.trim() || !p.items.length || p.items.some(i => !i.offer_item_id || !positions.some(source => source.id === i.offer_item_id)))) { setError('Każdy pakiet musi mieć nazwę i co najmniej jedną dostępną pozycję tej oferty.'); return; }
    submitting.current = true; setSaving(true);
    try {
      const { error: rpcError } = await supabase.rpc('save_offer_packages_and_logistics', {
        p_offer_id: offer.id, p_revision: revision,
        p_packages: nextPackages?.map(p => ({ ...p, name: p.name.trim(), description: p.description.trim() })) ?? null,
        p_enabled: nextEnabled,
        p_logistics: nextLogistics ? { estimate: nextLogistics.estimate, cost_net: Number(nextLogistics.cost), price_net: Number(nextLogistics.price), enabled: nextLogistics.enabled, description: nextLogistics.description.trim() } : null,
      });
      if (rpcError) throw rpcError;
      setModal(null); await load(); onSaved?.(); showSnackbar('Zapisano zmiany', 'success');
    } catch (e: any) { setError(e.message || 'Nie udało się zapisać zmian.'); }
    finally { submitting.current = false; setSaving(false); }
  };
  const move = (from: number, to: number) => {
    if (saving || modal || to < 0 || to >= packages.length) return;
    const next = [...packages]; next.splice(to, 0, next.splice(from,1)[0]); void save(next);
  };
  const draft = modal?.kind === 'package' ? modal.value : null;
  const totalWithLogistics = (price: number) => price + (logistics.enabled ? Number(logistics.price) : 0);
  const available = draft ? positions.filter(p => !draft.items.some(i => i.offer_item_id === p.id) && p.name.toLocaleLowerCase('pl-PL').includes(query.toLocaleLowerCase('pl-PL'))) : [];
  const commitPackage = () => {
    if (modal?.kind !== 'package') return;
    const normalized = calculate(modal.value);
    const next = modal.creating ? [...packages, normalized] : packages.map(p => p.id === normalized.id ? normalized : p);
    void save(next.map(p => normalized.is_recommended && p.id !== normalized.id ? { ...p, is_recommended: false } : p), modal.creating && packages.length === 0 ? true : enabled);
  };

  return <section id="offer-packages-logistics" className="rounded-xl bg-[#1c1f33] p-5 text-[#e5e4e2]">
    <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="flex items-center gap-2 text-lg uppercase"><Layers3 className="h-5 w-5 text-[#b94b69]" />Pakiety oferty</h2><p className="mt-1 text-sm text-[#e5e4e2]/55">Do trzech alternatyw z pozycji tej oferty. Każdy pakiet edytujesz oddzielnie.</p></div>
      {canEdit && <button type="button" onClick={newPackage} disabled={saving || loading || !!loadError || packages.length >= 3} className={button}><Plus className="mr-1 inline h-4 w-4" />Dodaj pakiet</button>}
    </header>
    {loading ? <p className="text-sm text-[#e5e4e2]/50">Wczytywanie…</p> : loadError ? <div role="alert" className="text-sm text-red-200">{loadError}<button type="button" onClick={() => void load()} className={button}>Spróbuj ponownie</button></div> : <>
      {!!packages.length && <label className="mb-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} disabled={!canEdit || saving} onChange={e => void save(packages,e.target.checked)} className="accent-[#d3bb73]" />Pokaż pakiety jako alternatywy w ofercie</label>}
      <DragDropContext onDragEnd={({source,destination}) => { if(destination && source.index !== destination.index) move(source.index,destination.index); }}><Droppable droppableId={listId}>{provided => <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-2">
        {packages.map((p,index) => <Draggable key={p.id} draggableId={p.id} index={index} isDragDisabled={!canEdit || saving || !!modal}>{drag => <article ref={drag.innerRef} {...drag.draggableProps} className="flex items-center gap-3 rounded-xl bg-black/15 p-3">
          {canEdit && <span {...drag.dragHandleProps} aria-label={`Przenieś pakiet ${p.name}`} className="text-[#e5e4e2]/40"><GripVertical className="h-4 w-4" /></span>}
          <span className="text-sm text-[#d3bb73]">{String(index+1).padStart(2,'0')}</span>
          <div className="min-w-0 flex-1"><h3 className="flex items-center gap-2 text-sm uppercase">{p.name}{p.is_recommended && <Star className="h-3.5 w-3.5 fill-[#d3bb73] text-[#d3bb73]" aria-label="Rekomendowany" />}</h3><p className="mt-1 truncate text-xs text-[#e5e4e2]/50">{p.items.length} pozycji · {p.description}</p></div>
          <span className="text-right text-sm text-[#d3bb73]">{money(p.price_net)} zł<small className="block text-[10px] text-[#e5e4e2]/45">netto / pakiet</small></span>
          <ResponsiveActionBar alwaysDropdown compact actions={[
            { label:'Podgląd',icon:<Eye className="h-4 w-4" />,onClick:()=>open({kind:'package',value:structuredClone(p),editing:false,creating:false}),disabled:saving },
            { label:'Edytuj',icon:<Pencil className="h-4 w-4" />,onClick:()=>open({kind:'package',value:calculate(structuredClone(p)),editing:true,creating:false}),show:canEdit,disabled:saving },
            { label:'Przenieś wyżej',icon:<ArrowUp className="h-4 w-4" />,onClick:()=>move(index,index-1),show:canEdit,disabled:saving || index===0 },
            { label:'Przenieś niżej',icon:<ArrowDown className="h-4 w-4" />,onClick:()=>move(index,index+1),show:canEdit,disabled:saving || index===packages.length-1 },
            { label:'Usuń',icon:<Trash2 className="h-4 w-4" />,variant:'danger',onClick:()=>open({kind:'delete',value:p}),show:canEdit,disabled:saving },
          ]} />
        </article>}</Draggable>)}{provided.placeholder}
      </div>}</Droppable></DragDropContext>
      {!packages.length && <p className="py-2 text-sm text-[#e5e4e2]/50">Dodaj pierwszy pakiet, aby przygotować alternatywny zakres oferty.</p>}
      <div className="mt-4 flex items-center gap-3 rounded-xl bg-black/15 p-3">
        <Truck className="h-5 w-5 shrink-0 text-[#d3bb73]" /><div className="min-w-0 flex-1"><h3 className="text-sm uppercase">Logistyka oferty</h3><p className="mt-1 text-xs text-[#e5e4e2]/55">{logistics.cost === '' ? 'Wymaga oszacowania przed wygenerowaniem oferty.' : `Koszt dla firmy: ${money(Number(logistics.cost))} zł netto`}</p><p className="mt-1 text-xs text-[#d3bb73]">{logistics.enabled ? `Doliczana klientowi: ${money(Number(logistics.price))} zł netto` : 'Bez osobnej dopłaty dla klienta — uwzględnij ją w cenach pozycji lub pakietów.'}</p></div>
        <button type="button" disabled={saving} className={button} onClick={()=>open({kind:'logistics',value:{...logistics},editing:canEdit})}>{canEdit ? 'Ustaw logistykę' : 'Podgląd'}</button>
      </div>
    </>}
    {!modal && error && <p role="alert" className="mt-3 text-sm text-red-200">{error}</p>}
    <dialog ref={dialog} aria-labelledby={titleId} onCancel={e=>{e.preventDefault();close();}} onClose={close} className="m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-2xl overflow-hidden rounded-2xl bg-[#1c1f33] p-0 text-[#e5e4e2] shadow-2xl backdrop:bg-black/65">
      {modal && <div className="flex max-h-[90dvh] flex-col">
        <header className="flex items-start justify-between gap-3 p-5"><h3 id={titleId} className="text-base uppercase">{modal.kind==='logistics' ? 'Logistyka oferty' : modal.kind==='delete' ? 'Usuń pakiet' : modal.editing ? modal.creating ? 'Dodaj pakiet oferty' : 'Edytuj pakiet oferty' : 'Podgląd pakietu'}</h3><button type="button" onClick={close} disabled={saving} aria-label="Zamknij" className="rounded-lg p-1"><X className="h-5 w-5" /></button></header>
        <div className="min-h-0 space-y-4 overflow-y-auto px-5 pb-4">
          {modal.kind==='delete' && <p className="text-sm">Usunąć pakiet „{modal.value.name}”? Pozycje oferty pozostaną dostępne.</p>}
          {modal.kind==='package' && draft && <>
            {modal.editing ? <>
              <label className="block text-xs text-[#e5e4e2]/60">Nazwa pakietu<input autoFocus maxLength={120} value={draft.name} disabled={saving} onChange={e=>patch({name:e.target.value})} className={field} /></label>
              <label className="block text-xs text-[#e5e4e2]/60">Krótki opis<textarea maxLength={1000} rows={3} value={draft.description} disabled={saving} onChange={e=>patch({description:e.target.value})} className={field} /></label>
              <button type="button" disabled={saving} aria-pressed={draft.is_recommended} onClick={()=>patch({is_recommended:!draft.is_recommended})} className={button}><Star className={`mr-2 inline h-4 w-4 ${draft.is_recommended?'fill-current':''}`} />Rekomenduj (opcjonalnie)</button>
            </> : <><h4 className="uppercase text-[#d3bb73]">{draft.name}</h4><p className="whitespace-pre-wrap text-sm text-[#e5e4e2]/70">{draft.description}</p></>}
            <div className="space-y-2"><h4 className="text-sm uppercase">Pozycje pakietu ({draft.items.length})</h4>{draft.items.map((item,index)=>{
              const position=positions.find(p=>p.id===item.offer_item_id);
              return <div key={item.offer_item_id || index} className="flex items-center gap-3 rounded-lg bg-black/15 p-3"><div className="min-w-0 flex-1 text-sm">{position?.name || 'Pozycja usunięta z oferty'}<p className="mt-1 text-xs text-[#e5e4e2]/50">{item.quantity} {position?.unit} · {money((position?.unit_price || 0)*item.quantity)} zł netto</p></div>{modal.editing && <button type="button" aria-label={`Usuń ${position?.name || 'pozycję'} z pakietu`} disabled={saving} onClick={()=>patch(calculate({...draft,items:draft.items.filter((_,i)=>i!==index)}))} className="p-1 text-red-200"><Trash2 className="h-4 w-4" /></button>}</div>;
            })}</div>
            {modal.editing && <><button type="button" disabled={saving} onClick={()=>setShowCatalog(v=>!v)} className={button}><Plus className="mr-1 inline h-4 w-4" />{showCatalog?'Zamknij listę pozycji':'Dodaj pozycje oferty'}</button>{showCatalog && <div className="rounded-xl bg-black/10 p-3"><input type="search" aria-label="Szukaj pozycji oferty" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Szukaj pozycji…" className={field} /><div className="mt-2 max-h-52 space-y-1 overflow-y-auto">{available.map(position=><button key={position.id} type="button" disabled={saving} onClick={()=>patch(calculate({...draft,items:[...draft.items,{offer_item_id:position.id,product_id:position.product_id,product_variant_id:position.product_variant_id,quantity:position.quantity}]}))} className="flex w-full items-center justify-between gap-3 rounded-lg bg-white/5 px-3 py-2 text-left text-sm"><span>{position.name}<small className="block text-[#e5e4e2]/50">{position.quantity} {position.unit} · {money(position.unit_price*position.quantity)} zł netto</small></span><span className="text-xs text-[#d3bb73]">Dodaj</span></button>)}{!available.length && <p className="py-3 text-xs text-[#e5e4e2]/50">Brak dostępnych pozycji. Już dodane są ukryte.</p>}</div><p className="mt-2 text-xs text-[#e5e4e2]/45">Zakres, ilość i wariant pochodzą z pozycji oferty. Zmienisz je w jej edytorze.</p></div>}</>}
            <div className="rounded-xl bg-black/15 p-4"><p className="text-sm text-[#e5e4e2]/60">Suma pozycji: {money(draft.list_price_net)} zł netto</p>{modal.editing && <div className="mt-3 grid grid-cols-2 gap-3"><label className="text-xs text-[#e5e4e2]/60">Rabat (%)<input type="number" min={0} max={100} step="0.01" disabled={saving} value={draft.discount_percent} onChange={e=>patch(calculate(draft,draft.list_price_net*Math.min(100,Math.max(0,Number(e.target.value)||0))/100))} className={field} /></label><label className="text-xs text-[#e5e4e2]/60">Rabat netto (zł)<input type="number" min={0} max={draft.list_price_net} step="0.01" disabled={saving} value={draft.discount_amount} onChange={e=>patch(calculate(draft,Number(e.target.value)||0))} className={field} /></label></div>}<p className="mt-3 text-lg text-[#d3bb73]">Cena pakietu: {money(draft.price_net)} zł netto</p><p className="mt-1 text-xs text-[#e5e4e2]/60">Dla klienta z logistyką: {money(totalWithLogistics(draft.price_net))} zł netto</p><p className="mt-2 text-xs text-[#e5e4e2]/50">{logistics.cost===''?'Koszt logistyki wymaga oszacowania.':`Wewnętrzny koszt wspólnej logistyki: ${money(Number(logistics.cost))} zł netto — uwzględniany raz dla wybranego pakietu.`}</p></div>
          </>}
          {modal.kind==='logistics' && <>
            <p className="text-sm text-[#e5e4e2]/60">Koszt wspólny dla całej realizacji. Nie powtarzaj tutaj kosztów już zapisanych w produktach lub ich pakietach.</p>
            {modal.editing ? <>
              <OfferLogisticsEstimateEditor offerId={offer.id} onBusyChange={setRouteBusy} value={modal.value.estimate} cost={modal.value.cost} disabled={saving} onChange={(estimate,cost)=>patchLogistics({estimate,cost})} />
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={modal.value.enabled} disabled={saving} onChange={e=>patchLogistics({enabled:e.target.checked})} className="mt-1 accent-[#d3bb73]" />Dolicz logistykę jako osobną pozycję dla klienta</label>
              {modal.value.enabled ? <><label className="block text-sm">Cena logistyki dla klienta netto (zł)<input type="number" min="0" step="0.01" value={modal.value.price} disabled={saving} onChange={e=>patchLogistics({price:e.target.value})} className={field} /></label><label className="block text-sm">Opis widoczny w ofercie<textarea rows={2} maxLength={1000} value={modal.value.description} disabled={saving} onChange={e=>patchLogistics({description:e.target.value})} className={field} /></label></> : <p className="rounded-lg bg-[#d3bb73]/10 p-3 text-sm text-[#d3bb73]">Klient zobaczy wyłącznie ceny pozycji lub pakietów. Uwzględnij w nich logistykę samodzielnie — system nie podniesie ich automatycznie.</p>}
            </> : <><OfferLogisticsEstimateEditor offerId={offer.id} onBusyChange={setRouteBusy} value={modal.value.estimate} cost={modal.value.cost} readOnly onChange={()=>{}} /><p className="text-sm">{modal.value.enabled ? `Osobna dopłata klienta: ${money(Number(modal.value.price))} zł netto` : 'Bez osobnej dopłaty klienta'}</p>{modal.value.enabled && <p className="text-sm text-[#e5e4e2]/60">{modal.value.description}</p>}</>}
          </>}
          {error && <p role="alert" className="text-sm text-red-200">{error}</p>}
        </div>
        <footer className="flex shrink-0 justify-end gap-2 bg-[#1c1f33] p-5"><button type="button" disabled={saving} onClick={close} className={button}>Anuluj</button>
          {modal.kind==='delete' ? <button type="button" disabled={saving} onClick={()=>void save(packages.filter(p=>p.id!==modal.value.id),packages.length>1 && enabled)} className="rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-200">Usuń pakiet</button> : modal.editing ? <button type="button" disabled={saving || routeBusy} onClick={()=>modal.kind==='logistics'?void save(null,enabled,modal.value):commitPackage()} className={primary}>{saving && <Loader2 className="mr-1 inline h-4 w-4 animate-spin" />}{modal.kind==='logistics'?'Zapisz logistykę':'Zapisz pakiet'}</button> : canEdit && <button type="button" onClick={()=>setModal({...modal,editing:true})} className={primary}>Edytuj</button>}
        </footer>
      </div>}
    </dialog>
  </section>;
}
