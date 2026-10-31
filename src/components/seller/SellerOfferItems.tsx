'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { DragDropContext, Droppable, Draggable, type DraggableProvided } from '@hello-pangea/dnd';
import { ArrowDown, ArrowUp, Eye, GripVertical, Package, Settings2, Trash2 } from 'lucide-react';
import ResponsiveActionBar from '@/components/crm/ResponsiveActionBar';
import type { OfferConfiguration } from '@/lib/CRM/Offers/offerAddons';
import { sellerItemLayout, sellerItemLayouts, sellerPageLayouts, type SellerPageLayout } from '@/lib/seller/offerPresentation';
import { sellerMoney } from '@/lib/seller/portal';

export type SellerDraftItem = {
  key: string; days: number; configurationQuoteId?: string | null; configuration?: OfferConfiguration;
  product_id: string | null; product_variant_id: string | null; name: string; description: string;
  unit: string; quantity: number; baseUnitPrice: number; clientUnitPrice: number;
  imagePath?: string | null; isCustom: boolean; pageLayout: SellerPageLayout;
};
type Props = {
  items: SellerDraftItem[]; imageUrls: Record<string, string>; brandId: string;
  commission: boolean; disabled?: boolean; configurableProductIds: ReadonlySet<string>;
  onUpdate: (key: string, patch: Partial<SellerDraftItem>) => void;
  onRemove: (key: string) => void; onReorder: (items: SellerDraftItem[]) => void;
  onConfigure: (item: SellerDraftItem) => void;
};
const field = 'mt-1 h-9 w-full min-w-0 rounded-md border border-white/10 bg-black/15 px-2 text-sm outline-none focus:border-[#d3bb73]/30 disabled:opacity-50';
const iconButton = 'flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-white/55 hover:bg-white/5 hover:text-[#d3bb73] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#d3bb73]/30 disabled:cursor-not-allowed disabled:opacity-20';

function ItemCard({ item, index, count, imageUrl, commission, disabled, configurable, brandId, onUpdate, onRemove, onConfigure, onMove, dragHandle }: {
  item: SellerDraftItem; index: number; count: number; imageUrl?: string; commission: boolean; disabled?: boolean;
  configurable: boolean; brandId: string; onUpdate: Props['onUpdate']; onRemove: Props['onRemove']; onConfigure: Props['onConfigure'];
  onMove: (from: number, to: number) => void; dragHandle?: DraggableProvided['dragHandleProps'];
}) {
  const [failedImage, setFailedImage] = useState('');
  const layout = sellerItemLayout(item.configuration, item.pageLayout);
  const choices = sellerItemLayouts(item.configuration);
  const price = commission ? item.baseUnitPrice : item.clientUnitPrice;
  const net = price * item.quantity * item.days;
  const amount = (value: number) => Number.isFinite(value) ? sellerMoney(value) : 'Uzupełnij wartość';
  const margin = (price - item.baseUnitPrice) * item.quantity * item.days;

  return <article aria-label={item.name} className="min-w-0 space-y-2.5 rounded-lg bg-black/15 p-3">
    <div className="flex items-center gap-2">
      <button type="button" {...dragHandle} disabled={disabled || !dragHandle} aria-label={'Przeciągnij: ' + item.name} title="Przeciągnij, aby zmienić kolejność" className={iconButton + ' touch-none cursor-grab active:cursor-grabbing'}><GripVertical className="h-4 w-4" /></button>
      <div className="relative hidden h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white/5 min-[400px]:flex">
        {imageUrl && imageUrl !== failedImage
          ? <Image src={imageUrl} alt="" fill unoptimized sizes="40px" onError={() => setFailedImage(imageUrl)} className="object-cover" />
          : <Package aria-hidden="true" className="h-4 w-4 text-white/25" />}
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="line-clamp-2 text-sm font-medium uppercase" title={item.name}><span className="mr-1.5 text-white/35">{index + 1}.</span>{item.name}</h3>
        <p className="mt-0.5 text-xs text-[#d3bb73]">{amount(net)} netto <span className="text-white/35">łącznie</span></p>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <button type="button" disabled={disabled || index === 0} onClick={() => onMove(index, index - 1)} aria-label={'Przenieś wyżej: ' + item.name} title="Przenieś wyżej" className={iconButton}><ArrowUp className="h-4 w-4" /></button>
        <button type="button" disabled={disabled || index === count - 1} onClick={() => onMove(index, index + 1)} aria-label={'Przenieś niżej: ' + item.name} title="Przenieś niżej" className={iconButton}><ArrowDown className="h-4 w-4" /></button>
        <ResponsiveActionBar alwaysDropdown compact disabledBackground actions={[
          { label: 'Otwórz produkt i opis', icon: <Eye className="h-4 w-4" />, show: Boolean(item.product_id), onClick: () => window.open('/seller/products/' + item.product_id + '?brand=' + encodeURIComponent(brandId), '_blank', 'noopener,noreferrer') },
          { label: item.configurationQuoteId ? 'Zmień konfigurację i przelicz' : 'Skonfiguruj produkt', icon: <Settings2 className="h-4 w-4" />, show: configurable, disabled, onClick: () => onConfigure(item) },
          { label: 'Usuń pozycję', icon: <Trash2 className="h-4 w-4" />, variant: 'danger', disabled, onClick: () => onRemove(item.key) },
        ]} />
      </div>
    </div>

    <div className="grid grid-cols-[3.75rem_3.75rem_minmax(0,1fr)] gap-2">
      <label className="text-[11px] text-white/50">Ilość<input aria-label={'Ilość: ' + item.name} type="number" min="1" step="1" disabled={disabled} value={Number.isFinite(item.quantity) ? item.quantity : ''} onChange={event => onUpdate(item.key, { quantity: event.target.valueAsNumber })} className={field} /></label>
      <label className="text-[11px] text-white/50">Dni<input aria-label={'Liczba dni: ' + item.name} type="number" min="1" max="3650" step="1" disabled={disabled} value={Number.isFinite(item.days) ? item.days : ''} onChange={event => onUpdate(item.key, { days: event.target.valueAsNumber })} className={field} /></label>
      <label className="min-w-0 text-[11px] text-white/50"><span className="block truncate" title={'Cena dla klienta netto / ' + item.unit + ' / dzień'}>Cena netto / {item.unit} / dzień</span><input aria-label={'Cena klienta netto za ' + item.unit + ' za dzień: ' + item.name} type="number" min="0" step="0.01" disabled={disabled || commission} value={Number.isFinite(price) ? price : ''} onChange={event => onUpdate(item.key, { clientUnitPrice: event.target.valueAsNumber })} className={field} /></label>
    </div>

    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 text-[11px]">
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        <span className="text-white/40" title={'Twoja cena Mavinci netto / ' + item.unit + ' / dzień'}>Mavinci: {amount(item.baseUnitPrice)}</span>
        {!commission && <span className={margin < 0 ? 'text-amber-200' : 'text-[#d3bb73]/80'} title="Marża netto za całą pozycję">Marża: {amount(margin)}</span>}
      </div>
      <label className="flex items-center gap-1.5 text-white/40">PDF
        <select aria-label={'Układ w PDF: ' + item.name} disabled={disabled || choices.length === 1} value={layout}
          onChange={event => onUpdate(item.key, { pageLayout: sellerItemLayout(item.configuration, event.target.value) })}
          className="h-7 max-w-[10.5rem] rounded-md border border-white/5 bg-black/15 px-1.5 text-[11px] text-white/65 outline-none focus:border-[#d3bb73]/30 disabled:opacity-50">
          {sellerPageLayouts.filter(option => choices.includes(option.id)).map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      </label>
    </div>
    {!commission && margin < 0 && <p className="text-[11px] text-amber-200">Cena poniżej Twojej stawki — wymaga akceptacji opiekuna.</p>}
    {item.isCustom && <p className="text-[11px] text-amber-100">Pozycja własna — do akceptacji. Marża nie uwzględnia Twoich kosztów.</p>}
  </article>;
}

export default function SellerOfferItems(props: Props) {
  const [mounted, setMounted] = useState(false);
  const [reorderMessage, setReorderMessage] = useState('');
  useEffect(() => setMounted(true), []);
  const move = (from: number, to: number) => {
    if (props.disabled || from === to || from < 0 || to < 0 || from >= props.items.length || to >= props.items.length) return;
    const next = [...props.items];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    props.onReorder(next);
    setReorderMessage(`Przeniesiono ${item.name} na pozycję ${to + 1} z ${next.length}.`);
  };
  const card = (item: SellerDraftItem, index: number, dragHandle?: DraggableProvided['dragHandleProps']) => <ItemCard item={item} index={index} count={props.items.length} imageUrl={props.imageUrls[item.imagePath || '']}
    commission={props.commission} disabled={props.disabled} brandId={props.brandId}
    configurable={Boolean(item.product_id && (item.configurationQuoteId || props.configurableProductIds.has(item.product_id)))}
    onUpdate={props.onUpdate} onRemove={props.onRemove} onConfigure={props.onConfigure} onMove={move} dragHandle={dragHandle} />;

  return <div className="space-y-3">
    <div><h2 className="text-lg uppercase">Pozycje oferty</h2><p className="mt-1 text-xs text-white/45">Przeciągnij uchwyt lub użyj ↑ ↓. Pełne opisy pozostają w PDF.</p></div>
    <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">{reorderMessage}</p>
    {!props.items.length ? <p className="rounded-lg bg-white/[0.025] p-7 text-center text-sm text-white/40">Dodane produkty pojawią się tutaj.</p>
      : !mounted ? <div className="space-y-2">{props.items.map((item, index) => <div key={item.key}>{card(item, index)}</div>)}</div>
      : <DragDropContext dragHandleUsageInstructions="Naciśnij spację, aby chwycić pozycję. Strzałkami zmień kolejność, spacją zatwierdź, Escape anuluje." onDragEnd={result => { if (result.destination) move(result.source.index, result.destination.index); }}>
        <Droppable droppableId="seller-offer-items">{provided => <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-2">
          {props.items.map((item, index) => <Draggable key={item.key} draggableId={item.key} index={index} isDragDisabled={props.disabled} disableInteractiveElementBlocking>{provided => <div ref={provided.innerRef} {...provided.draggableProps}>{card(item, index, provided.dragHandleProps)}</div>}</Draggable>)}
          {provided.placeholder}
        </div>}</Droppable>
      </DragDropContext>}
  </div>;
}
