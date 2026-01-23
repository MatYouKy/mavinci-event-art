'use client';

import { useEffect, useMemo, useState } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { GripVertical, Pencil, Trash2, Eye, Plus } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useRouter } from 'next/navigation';
import Image from 'next/image';

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
  onItemsReordered: () => void;
  onEditItem: (item: OfferItem) => void;
  onDeleteItem: (itemId: string) => void;
  onPreviewImage: (imageUrl: string) => void;
  onAddItem?: () => void;
}

export default function OfferItems({
  items,
  offerId,
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
    <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-light text-[#e5e4e2]">Pozycje Oferty</h2>
        <div className="flex items-center gap-3">
          <p className="text-xs text-[#e5e4e2]/60">Przeciągnij aby zmienić kolejność</p>
          {onAddItem && (
            <button
              onClick={onAddItem}
              className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-3 py-1.5 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
            >
              <Plus className="h-4 w-4" />
              Dodaj pozycję
            </button>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="py-8 text-center text-[#e5e4e2]/60">Brak pozycji w ofercie</div>
      ) : (
        <DragDropContext onDragEnd={handleDragEnd}>
          <Droppable droppableId="offer-items">
            {(provided) => (
              <div {...provided.droppableProps} ref={provided.innerRef} className="space-y-2">
                {[...orderedItems]
                  .sort((a, b) => a.display_order - b.display_order)
                  .map((item, index) => {
                    const thumbUrl = thumbUrls[item.id]; // ✅ gotowy display url

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
                            className={`flex items-center gap-3 rounded-lg border border-[#d3bb73]/10 bg-[#0d0f1a] p-4 transition-all ${
                              snapshot.isDragging ? 'shadow-lg shadow-[#d3bb73]/20' : ''
                            }`}
                          >
                            <div
                              {...provided.dragHandleProps}
                              className="cursor-grab text-[#e5e4e2]/40 hover:text-[#d3bb73] active:cursor-grabbing"
                            >
                              <GripVertical className="h-5 w-5" />
                            </div>

                            {/* ✅ Miniatura – klik preview otwiera już URL, nie path */}
                            {thumbUrl && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onPreviewImage(thumbUrl);
                                }}
                                className="h-16 w-auto flex-shrink-0 overflow-hidden rounded border border-[#d3bb73]/10 transition-colors hover:border-[#d3bb73]/30"
                                title="Podgląd"
                              >
                                <Image
                                  width={44}
                                  height={62}
                                  sizes="44px 62px"
                                  src={thumbUrl}
                                  alt={item.product?.name ?? 'Miniatura'}
                                  className="h-full w-auto object-contain"
                                />
                              </button>
                            )}

                            <div className="min-w-0 flex-1">
                              <h3 className="truncate text-sm font-medium text-[#e5e4e2]">
                                {item.product?.name || 'Produkt'}
                              </h3>
                              <p className="truncate text-xs text-[#e5e4e2]/60">
                                {item.product?.description}
                              </p>
                              <div className="mt-1 flex items-center gap-4">
                                <span className="text-xs text-[#e5e4e2]/60">Ilość: {item.quantity}</span>
                                <span className="text-xs text-[#e5e4e2]/60">
                                  Cena: {item.unit_price.toFixed(2)} PLN
                                </span>
                                {item.discount_percent > 0 && (
                                  <span className="text-xs text-green-400">Rabat: {item.discount_percent}%</span>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              <div className="mr-4 text-right">
                                <div className="text-sm font-medium text-[#e5e4e2]">
                                  {item.total.toFixed(2)} PLN
                                </div>
                                {item.discount_amount > 0 && (
                                  <div className="text-xs text-[#e5e4e2]/60 line-through">
                                    {item.subtotal.toFixed(2)} PLN
                                  </div>
                                )}
                              </div>

                              {item.product?.pdf_page_url && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    router.push(`/crm/offers/products/${item.product_id}`);
                                  }}
                                  className="rounded p-2 text-[#e5e4e2]/60 transition-colors hover:bg-blue-500/10 hover:text-blue-400"
                                  title="Przejdź do produktu"
                                >
                                  <Eye className="h-4 w-4" />
                                </button>
                              )}

                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onEditItem(item);
                                }}
                                className="rounded p-2 text-[#e5e4e2]/60 transition-colors hover:bg-[#d3bb73]/10 hover:text-[#d3bb73]"
                              >
                                <Pencil className="h-4 w-4" />
                              </button>

                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onDeleteItem(item.id);
                                }}
                                className="rounded p-2 text-[#e5e4e2]/60 transition-colors hover:bg-red-500/10 hover:text-red-400"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
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