'use client';

import { useEffect, useMemo, useState } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { GripVertical, Pencil, Trash2, Eye, Plus, Package } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import Image from 'next/image';
import ResponsiveActionBar, { Action } from '@/components/crm/ResponsiveActionBar';
import type { IProductVariant } from '../../types';

const isHttpUrl = (v?: string) => !!v && /^https?:\/\//i.test(v);

async function resolveStorageDisplayUrl(
  pathOrUrl: string,
  bucket: ReturnType<typeof supabase.storage.from>,
) {
  if (isHttpUrl(pathOrUrl)) return pathOrUrl;

  const { data, error } = await bucket.createSignedUrl(pathOrUrl, 3600);
  if (error) throw error;

  return data?.signedUrl ?? null;
}

interface OfferItem {
  id: string;
  offer_id?: string;
  product_id: string;
  name: string;
  description?: string | null;
  quantity: number;
  unit?: string | null;
  unit_price: number;
  discount_percent: number;
  discount_amount: number;
  subtotal: number;
  total: number;
  display_order: number;
  product_variant_id?: string | null;
  offer_page_variant_override?: 'compact' | 'default' | 'visual' | null;
  show_variant_prices_in_pdf?: boolean;
  show_product_variants_in_pdf?: boolean;
  product_variant?: IProductVariant | null;
  product?: {
    id: string;
    name: string;
    description?: string | null;
    pdf_page_url?: string;
    pdf_thumbnail_url?: string;
    offer_image_path?: string | null;
    offer_page_variant?: string | null;
    product_page_url?: string | null;
    variants?: IProductVariant[];
  };
}

interface OfferItemsProps {
  items: OfferItem[];
  offerId: string;
  vatRate?: number;
  onItemsReordered: () => void;
  onEditItem: (item: OfferItem) => void;
  onDeleteItem: (itemId: string) => void;
  onPreviewImage: (imageUrl: string) => void;
  onAddItem?: () => void;
}

const getOfferItemName = (item: OfferItem) => {
  return item.name?.trim() || item.product?.name || 'Pozycja oferty';
};

const getOfferItemDescription = (item: OfferItem) => {
  return item.description?.trim() || item.product?.description || '';
};

export default function OfferItems({
  items,
  offerId,
  vatRate = 23,
  onItemsReordered,
  onEditItem,
  onDeleteItem,
  onPreviewImage,
  onAddItem,
}: OfferItemsProps) {
  const { showSnackbar } = useSnackbar();

  const [updating, setUpdating] = useState(false);
  const [updatingLayoutId, setUpdatingLayoutId] = useState<string | null>(null);
  const [updatingVariantPriceId, setUpdatingVariantPriceId] = useState<string | null>(null);
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});
  const [orderedItems, setOrderedItems] = useState<OfferItem[]>([]);

  const bucket = useMemo(() => supabase.storage.from('offer-product-pages'), []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const entries = await Promise.all(
          items.map(async (item) => {
            const thumb = item.product_variant?.offer_image_path
              || item.product?.offer_image_path
              || item.product?.pdf_thumbnail_url;
            if (!thumb) return null;

            try {
              const url = await resolveStorageDisplayUrl(thumb, bucket);
              if (!url) return null;

              return [item.id, url] as const;
            } catch (error) {
              console.warn(`Nie udało się wczytać miniatury produktu ${item.product_id}:`, error);
              return null;
            }
          }),
        );

        if (cancelled) return;

        const next = Object.fromEntries(entries.filter(Boolean) as Array<[string, string]>);
        setThumbUrls(next);
      } catch (e: any) {
        console.warn('Thumbnail resolve error:', e?.message ?? e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [items, bucket]);

  useEffect(() => {
    setOrderedItems([...items].sort((a, b) => a.display_order - b.display_order));
  }, [items]);

  const handleDragEnd = async (result: DropResult) => {
    if (!result.destination) return;

    const sourceIndex = result.source.index;
    const destinationIndex = result.destination.index;

    if (sourceIndex === destinationIndex) return;

    const next = Array.from(orderedItems);
    const [moved] = next.splice(sourceIndex, 1);
    next.splice(destinationIndex, 0, moved);

    const nextWithOrder = next.map((it, idx) => ({
      ...it,
      display_order: idx,
    }));

    setOrderedItems(nextWithOrder);
    setUpdating(true);

    try {
      for (const it of nextWithOrder) {
        const { error } = await supabase
          .from('offer_items')
          .update({ display_order: it.display_order })
          .eq('id', it.id);

        if (error) throw error;
      }

      showSnackbar('Kolejność pozycji zaktualizowana', 'success');
      onItemsReordered();
    } catch (error: any) {
      console.error('Error reordering items:', error);
      showSnackbar('Błąd podczas zmiany kolejności', 'error');

      setOrderedItems([...items].sort((a, b) => a.display_order - b.display_order));
    } finally {
      setUpdating(false);
    }
  };

  const updatePrintLayout = async (
    itemId: string,
    layout: 'compact' | 'default' | 'visual',
  ) => {
    const previous = orderedItems;
    setOrderedItems((current) => current.map((item) => (
      item.id === itemId ? { ...item, offer_page_variant_override: layout } : item
    )));
    setUpdatingLayoutId(itemId);

    try {
      const { error } = await supabase
        .from('offer_items')
        .update({ offer_page_variant_override: layout })
        .eq('id', itemId);
      if (error) throw error;
      showSnackbar(
        layout === 'compact'
          ? 'Produkt zostanie wydrukowany kompaktowo'
          : layout === 'visual'
            ? 'Produkt otrzyma stronę z dużą grafiką'
            : 'Produkt otrzyma osobną stronę',
        'success',
      );
      onItemsReordered();
    } catch (error: any) {
      setOrderedItems(previous);
      showSnackbar(error.message || 'Nie udało się zmienić układu produktu', 'error');
    } finally {
      setUpdatingLayoutId(null);
    }
  };

  const updateVariantPriceVisibility = async (itemId: string, show: boolean) => {
    const previous = orderedItems;
    setOrderedItems((current) => current.map((item) => (
      item.id === itemId ? { ...item, show_variant_prices_in_pdf: show } : item
    )));
    setUpdatingVariantPriceId(itemId);
    try {
      const { error } = await supabase
        .from('offer_items')
        .update({ show_variant_prices_in_pdf: show })
        .eq('id', itemId);
      if (error) throw error;
      showSnackbar(show ? 'Ceny wariantów pojawią się w PDF' : 'Ceny wariantów zostały ukryte w PDF', 'success');
      onItemsReordered();
    } catch (error: any) {
      setOrderedItems(previous);
      showSnackbar(error.message || 'Nie udało się zmienić widoczności cen', 'error');
    } finally {
      setUpdatingVariantPriceId(null);
    }
  };

  const updateVariantPageVisibility = async (itemId: string, show: boolean) => {
    const previous = orderedItems;
    setOrderedItems((current) => current.map((item) => (
      item.id === itemId ? { ...item, show_product_variants_in_pdf: show } : item
    )));
    setUpdatingVariantPriceId(itemId);
    try {
      const { error } = await supabase
        .from('offer_items')
        .update({ show_product_variants_in_pdf: show })
        .eq('id', itemId);
      if (error) throw error;
      showSnackbar(
        show
          ? 'PDF pokaże porównanie wszystkich wariantów'
          : 'PDF potraktuje wybrany wariant jak zwykły produkt',
        'success',
      );
      onItemsReordered();
    } catch (error: any) {
      setOrderedItems(previous);
      showSnackbar(error.message || 'Nie udało się zmienić widoczności wariantów', 'error');
    } finally {
      setUpdatingVariantPriceId(null);
    }
  };

  return (
    <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-4 md:p-6">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-lg font-light text-[#e5e4e2]">Pozycje Oferty</h2>
          <p className="mt-1 text-xs text-[#e5e4e2]/50">
            Przeciągnij uchwyt, aby zmienić kolejność
          </p>
        </div>

        {onAddItem && (
          <button
            onClick={onAddItem}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-3 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 sm:w-auto"
          >
            <Plus className="h-4 w-4" />
            Dodaj pozycję
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[#d3bb73]/20 bg-[#0d0f1a] py-10 text-center text-sm text-[#e5e4e2]/60">
          Brak pozycji w ofercie
        </div>
      ) : (
        <DragDropContext onDragEnd={handleDragEnd}>
          <Droppable droppableId="offer-items">
            {(provided) => (
              <div {...provided.droppableProps} ref={provided.innerRef} className="space-y-3">
                {[...orderedItems]
                  .sort((a, b) => a.display_order - b.display_order)
                  .map((item, index) => {
                    const thumbUrl = thumbUrls[item.id];
                    const itemName = getOfferItemName(item);
                    const itemDescription = getOfferItemDescription(item);
                    const effectiveVatRate = Number(vatRate || 23);
                    const netValue = Number(item.total || 0);
                    const grossValue = netValue * (1 + effectiveVatRate / 100);
                    const unitGross = Number(item.unit_price || 0) * (1 + effectiveVatRate / 100);
                    const catalogLayout = item.product?.offer_page_variant === 'compact'
                      || item.product?.offer_page_variant === 'visual'
                      ? item.product.offer_page_variant
                      : 'default';
                    const printLayout = item.offer_page_variant_override || catalogLayout;
                    const hasProductVariants = (item.product?.variants || []).length > 0;
                    const showsVariantComparison = hasProductVariants && item.show_product_variants_in_pdf !== false;

                    const actions: Action[] = [
                      {
                        label: 'Otwórz produkt',
                        icon: <Eye className="h-4 w-4" />,
                        onClick: () => window.open(`/crm/offers/products/${item.product_id}`, '_blank', 'noopener,noreferrer'),
                        show: Boolean(item.product_id),
                      },
                      {
                        label: 'Edytuj',
                        icon: <Pencil className="h-4 w-4" />,
                        onClick: () => onEditItem(item),
                        variant: 'primary',
                      },
                      {
                        label: 'Usuń',
                        icon: <Trash2 className="h-4 w-4" />,
                        onClick: () => onDeleteItem(item.id),
                        variant: 'danger',
                      },
                    ];

                    return (
                      <Draggable
                        key={item.id}
                        draggableId={item.id}
                        index={index}
                        isDragDisabled={updating}
                      >
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            className={`relative rounded-xl border border-[#d3bb73]/10 bg-[#0d0f1a] p-3 transition-all md:p-5 ${
                              snapshot.isDragging ? 'shadow-lg shadow-[#d3bb73]/20' : ''
                            }`}
                          >
                            <div className="absolute right-2 top-2 z-20">
                              <ResponsiveActionBar
                                actions={actions}
                                disabledBackground
                                mobileBreakpoint={4000}
                              />
                            </div>

                            <div className="flex gap-3 pr-10">
                              <div
                                {...provided.dragHandleProps}
                                className="flex w-6 flex-shrink-0 cursor-grab items-center justify-center text-[#e5e4e2]/35 hover:text-[#d3bb73] active:cursor-grabbing"
                              >
                                <GripVertical className="h-5 w-5" />
                              </div>

                              {thumbUrl ? (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onPreviewImage(thumbUrl);
                                  }}
                                  className="h-16 w-12 flex-shrink-0 overflow-hidden rounded-md border border-[#d3bb73]/10 bg-black/20 transition-colors hover:border-[#d3bb73]/30 md:h-24 md:w-20"
                                  title="Podgląd"
                                >
                                  <Image
                                    width={80}
                                    height={96}
                                    sizes="80px"
                                    src={thumbUrl}
                                    alt={itemName}
                                    className="h-full w-full object-cover"
                                  />
                                </button>
                              ) : (
                                <div className="flex h-16 w-12 flex-shrink-0 items-center justify-center rounded-md border border-[#d3bb73]/10 bg-[#1c1f33] text-[#d3bb73]/60 md:h-24 md:w-20">
                                  <Package className="h-6 w-6" />
                                </div>
                              )}

                              <div className="min-w-0 flex-1">
                                <h3 className="line-clamp-1 text-sm font-semibold text-[#e5e4e2] md:text-base">
                                  {itemName}
                                </h3>

                                {item.product_variant?.name && (
                                  <span className="mt-1 inline-flex rounded-full bg-[#7f1734]/25 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[#e8b7c4]">
                                    Wariant: {item.product_variant.name}
                                  </span>
                                )}

                                {item.product?.name && item.product.name !== getOfferItemName(item) && (
                                  <p className="mt-0.5 line-clamp-1 text-xs text-[#e5e4e2]/35">
                                    Produkt bazowy: {getOfferItemName(item)}
                                  </p>
                                )}

                                {itemDescription && (
                                  <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-[#e5e4e2]/55 md:text-sm">
                                    {itemDescription}
                                  </p>
                                )}

                                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#e5e4e2]/55">
                                  <span>
                                    Ilość:{' '}
                                    <strong className="text-[#e5e4e2]">{item.quantity}</strong>
                                  </span>
                                  <span>
                                    Cena netto:{' '}
                                    <strong className="text-[#e5e4e2]">
                                      {item.unit_price.toFixed(2)} PLN
                                    </strong>
                                  </span>
                                  <span>
                                    Cena brutto (VAT {effectiveVatRate}%):{' '}
                                    <strong className="text-[#e5e4e2]">
                                      {unitGross.toFixed(2)} PLN
                                    </strong>
                                  </span>
                                </div>

                                <div className="mt-3 flex flex-wrap items-center gap-2">
                                  <span className="text-[10px] font-medium uppercase tracking-wide text-[#e5e4e2]/40">
                                    Układ w PDF
                                  </span>
                                  <div className={`inline-flex rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] p-0.5 ${showsVariantComparison ? 'opacity-40' : ''}`}>
                                    <button
                                      type="button"
                                      disabled={updatingLayoutId === item.id || showsVariantComparison}
                                      onClick={() => updatePrintLayout(item.id, 'compact')}
                                      className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${
                                        printLayout === 'compact'
                                          ? 'bg-[#d3bb73] font-medium text-[#1c1f33]'
                                          : 'text-[#e5e4e2]/55 hover:text-[#e5e4e2]'
                                      }`}
                                    >
                                      Kompaktowo · 3/str.
                                    </button>
                                    <button
                                      type="button"
                                      disabled={updatingLayoutId === item.id || showsVariantComparison}
                                      onClick={() => updatePrintLayout(item.id, 'default')}
                                      className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${
                                        printLayout === 'default'
                                          ? 'bg-[#7f1734] font-medium text-white'
                                          : 'text-[#e5e4e2]/55 hover:text-[#e5e4e2]'
                                      }`}
                                    >
                                      Osobna strona
                                    </button>
                                    <button
                                      type="button"
                                      disabled={updatingLayoutId === item.id || showsVariantComparison}
                                      onClick={() => updatePrintLayout(item.id, 'visual')}
                                      className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${
                                        printLayout === 'visual'
                                          ? 'bg-[#7f1734] font-medium text-white'
                                          : 'text-[#e5e4e2]/55 hover:text-[#e5e4e2]'
                                      }`}
                                    >
                                      Duża grafika
                                    </button>
                                  </div>
                                  {hasProductVariants && (
                                    <>
                                      <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-[#d3bb73]/15 bg-[#1c1f33] px-2.5 py-1 text-[11px] text-[#e5e4e2]/60">
                                        <input
                                          type="checkbox"
                                          checked={item.show_product_variants_in_pdf !== false}
                                          disabled={updatingVariantPriceId === item.id}
                                          onChange={(event) => void updateVariantPageVisibility(item.id, event.target.checked)}
                                          className="h-3.5 w-3.5 accent-[#d3bb73]"
                                        />
                                        Pokaż warianty
                                      </label>
                                      <label className={`inline-flex items-center gap-2 rounded-lg border border-[#d3bb73]/15 bg-[#1c1f33] px-2.5 py-1 text-[11px] text-[#e5e4e2]/60 ${item.show_product_variants_in_pdf === false ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}`}>
                                        <input
                                          type="checkbox"
                                          checked={item.show_variant_prices_in_pdf !== false}
                                          disabled={updatingVariantPriceId === item.id || item.show_product_variants_in_pdf === false}
                                          onChange={(event) => void updateVariantPriceVisibility(item.id, event.target.checked)}
                                          className="h-3.5 w-3.5 accent-[#d3bb73]"
                                        />
                                        Ceny wariantów
                                      </label>
                                    </>
                                  )}
                                </div>
                                {showsVariantComparison && (
                                  <p className="mt-1.5 text-[10px] text-[#e5e4e2]/35">Wybór układu strony zacznie obowiązywać po wyłączeniu „Pokaż warianty”.</p>
                                )}

                                {item.discount_percent > 0 && (
                                  <div className="mt-1 text-xs text-green-400">
                                    Rabat: {item.discount_percent}%
                                  </div>
                                )}
                              </div>
                            </div>

                            <div className="mt-3 flex items-end justify-between border-t border-[#d3bb73]/10 pt-2 md:mt-4">
                              <div className="text-xs text-[#e5e4e2]/40">
                                Wartość netto: <span className="text-[#e5e4e2]/70">{netValue.toFixed(2)} PLN</span>
                              </div>

                              <div className="text-right">
                                <div className="mb-1 text-[10px] uppercase tracking-wide text-[#e5e4e2]/40">
                                  brutto · VAT {effectiveVatRate}%
                                </div>
                                <div className="text-lg font-bold leading-none text-[#d3bb73] md:text-xl">
                                  {grossValue.toFixed(2)} PLN
                                </div>

                                {item.discount_amount > 0 && (
                                  <div className="mt-1 text-xs text-[#e5e4e2]/35 line-through">
                                    {item.subtotal.toFixed(2)} PLN
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </Draggable>
                    );
                  })}

                {provided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>
      )}
    </div>
  );
}
