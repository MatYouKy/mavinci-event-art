'use client';

import { useState } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { GripVertical, Pencil, Trash2, Eye, Plus } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useRouter } from 'next/navigation';

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
  const handleDragEnd = async (result: DropResult) => {
    if (!result.destination) return;

    const sourceIndex = result.source.index;
    const destinationIndex = result.destination.index;

    if (sourceIndex === destinationIndex) return;

    setUpdating(true);

    try {
      const reorderedItems = Array.from(items);
      const [movedItem] = reorderedItems.splice(sourceIndex, 1);
      reorderedItems.splice(destinationIndex, 0, movedItem);

      const updates = reorderedItems.map((item, index) => ({
        id: item.id,
        display_order: index,
      }));

      for (const update of updates) {
        const { error } = await supabase
          .from('offer_items')
          .update({ display_order: update.display_order })
          .eq('id', update.id);

        if (error) throw error;
      }

      showSnackbar('Kolejność pozycji zaktualizowana', 'success');
      onItemsReordered();
    } catch (error: any) {
      console.error('Error reordering items:', error);
      showSnackbar('Błąd podczas zmiany kolejności', 'error');
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
                {[...items]
                  .sort((a, b) => a.display_order - b.display_order)
                  .map((item, index) => (
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

                          {item.product?.pdf_thumbnail_url && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onPreviewImage(item.product!.pdf_thumbnail_url!);
                              }}
                              className="h-16 w-16 flex-shrink-0 overflow-hidden rounded border border-[#d3bb73]/10 transition-colors hover:border-[#d3bb73]/30"
                            >
                              <img
                                src={item.product.pdf_thumbnail_url}
                                alt={item.product.name}
                                className="h-full w-full object-cover"
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
                              <span className="text-xs text-[#e5e4e2]/60">
                                Ilość: {item.quantity}
                              </span>
                              <span className="text-xs text-[#e5e4e2]/60">
                                Cena: {item.unit_price.toFixed(2)} PLN
                              </span>
                              {item.discount_percent > 0 && (
                                <span className="text-xs text-green-400">
                                  Rabat: {item.discount_percent}%
                                </span>
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
                  ))}
                {provided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>
      )}
    </div>
  );
}
