'use client';

import { useEffect, useMemo, useState } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { GripVertical, Pencil, Trash2, Eye, Plus, Package } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import ResponsiveActionBar, { Action } from '@/components/crm/ResponsiveActionBar';

const isHttpUrl = (v?: string) => !!v && /^https?:\/\//i.test(v);

async function resolveStorageDisplayUrl(
  pathOrUrl: string,
  bucket: ReturnType<typeof supabase.storage.from>,
) {
  // 1) jeśli w DB masz już pełny URL (public albo signed) -> użyj wprost
  if (isHttpUrl(pathOrUrl)) return pathOrUrl;

  // 2) jeśli to jest ścieżka w buckecie -> zrób signed URL (skoro public daje 400)
  const { data, error } = await bucket.createSignedUrl(pathOrUrl, 3600);
  if (error) throw error;
  return data?.signedUrl ?? null;
}

interface OfferItem {
  id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  discount_percent: number;
  discount_amount: number;
  subtotal: number;
  total: number;
  display_order: number;
  product?: {
    id: string;
    name: string;
    description: string;
    pdf_page_url?: string;
    pdf_thumbnail_url?: string;
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
  const router = useRouter();
  const [updating, setUpdating] = useState(false);

  const bucket = useMemo(() => supabase.storage.from('offer-product-pages'), []);

  // ✅ mapka: item.id -> displayUrl (signed lub pełny url)
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const entries = await Promise.all(
          items.map(async (item) => {
            const thumb = item.product?.pdf_thumbnail_url;
            if (!thumb) return null;

            const url = await resolveStorageDisplayUrl(thumb, bucket);
            if (!url) return null;

            return [item.id, url] as const;
          }),
        );

        if (cancelled) return;

        const next = Object.fromEntries(entries.filter(Boolean) as Array<[string, string]>);
        setThumbUrls(next);
      } catch (e: any) {
        // nie spamuj snackbarami za każdym itemem – wystarczy console
        console.warn('Thumbnail resolve error:', e?.message ?? e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [items, bucket]);

  const [orderedItems, setOrderedItems] = useState<OfferItem[]>([]);

  useEffect(() => {
    // zawsze trzymaj kolejność wg display_order jako bazę
    setOrderedItems([...items].sort((a, b) => a.display_order - b.display_order));
  }, [items]);

  const handleDragEnd = async (result: DropResult) => {
    if (!result.destination) return;

    const sourceIndex = result.source.index;
    const destinationIndex = result.destination.index;

    if (sourceIndex === destinationIndex) return;

    // ✅ optimistic reorder w UI
    const next = Array.from(orderedItems);
    const [moved] = next.splice(sourceIndex, 1);
    next.splice(destinationIndex, 0, moved);

    // nadaj nowe display_order lokalnie
    const nextWithOrder = next.map((it, idx) => ({
      ...it,
      display_order: idx,
    }));

    setOrderedItems(nextWithOrder);
    setUpdating(true);

    try {
      // zapis do bazy
      // (możesz też zrobić batch RPC, ale na razie zostawiamy 1:1)
      for (const it of nextWithOrder) {
        const { error } = await supabase
          .from('offer_items')
          .update({ display_order: it.display_order })
          .eq('id', it.id);

        if (error) throw error;
      }

      showSnackbar('Kolejność pozycji zaktualizowana', 'success');
      onItemsReordered(); // jeśli parent robi refetch - ok
    } catch (error: any) {
      console.error('Error reordering items:', error);
      showSnackbar('Błąd podczas zmiany kolejności', 'error');

      // ✅ rollback: wróć do kolejności z propsów
      setOrderedItems([...items].sort((a, b) => a.display_order - b.display_order));
    } finally {
      setUpdating(false);
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

                    const actions: Action[] = [
                      {
                        label: 'Produkt',
                        icon: <Eye className="h-4 w-4" />,
                        onClick: () => router.push(`/crm/offers/products/${item.product_id}`),
                        show: Boolean(item.product?.pdf_page_url),
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

                    const grossValue = item.total * (1 + vatRate / 100);

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
                              <ResponsiveActionBar actions={actions} disabledBackground mobileBreakpoint={4000} />
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
                                    alt={item.product?.name ?? 'Miniatura'}
                                    className="h-full w-full object-contain"
                                  />
                                </button>
                              ) : (
                                <div className="flex h-16 w-12 flex-shrink-0 items-center justify-center rounded-md border border-[#d3bb73]/10 bg-[#1c1f33] text-[#d3bb73]/60 md:h-24 md:w-20">
                                  <Package className="h-6 w-6" />
                                </div>
                              )}

                              <div className="min-w-0 flex-1">
                                <h3 className="line-clamp-1 text-sm font-semibold text-[#e5e4e2] md:text-base">
                                  {item.product?.name || 'Produkt'}
                                </h3>

                                {item.product?.description && (
                                  <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-[#e5e4e2]/55 md:text-sm">
                                    {item.product.description}
                                  </p>
                                )}

                                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#e5e4e2]/55">
                                  <span>
                                    Ilość:{' '}
                                    <strong className="text-[#e5e4e2]">{item.quantity}</strong>
                                  </span>
                                  <span>
                                    Netto:{' '}
                                    <strong className="text-[#e5e4e2]">
                                      {item.total.toFixed(2)} PLN
                                    </strong>
                                  </span>
                                  <span>
                                    Cena:{' '}
                                    <strong className="text-[#e5e4e2]">
                                      {item.unit_price.toFixed(2)} PLN
                                    </strong>
                                  </span>
                                </div>

                                {item.discount_percent > 0 && (
                                  <div className="mt-1 text-xs text-green-400">
                                    Rabat: {item.discount_percent}%
                                  </div>
                                )}
                              </div>
                            </div>

                            <div className="mt-3 flex items-end justify-between border-t border-[#d3bb73]/10 pt-2 md:mt-4">
                              <div className="text-xs text-[#e5e4e2]/40">brutto</div>

                              <div className="text-right">
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
