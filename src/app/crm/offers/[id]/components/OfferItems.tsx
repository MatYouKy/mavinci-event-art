'use client';

import { useState } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { GripVertical, Pencil, Trash2, Eye, Plus } from 'lucide-react';
import { supabase } from '@/lib/supabase';
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
    <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-light text-[#e5e4e2]">Pozycje Oferty</h2>
        <div className="flex items-center gap-3">
          <p className="text-xs text-[#e5e4e2]/60">Przeciągnij aby zmienić kolejność</p>
          {onAddItem && (
            <button
              onClick={onAddItem}
              className="flex items-center gap-2 px-3 py-1.5 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 text-sm font-medium"
            >
              <Plus className="w-4 h-4" />
              Dodaj pozycję
            </button>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="text-center py-8 text-[#e5e4e2]/60">
          Brak pozycji w ofercie
        </div>
      ) : (
        <DragDropContext onDragEnd={handleDragEnd}>
          <Droppable droppableId="offer-items">
            {(provided) => (
              <div
                {...provided.droppableProps}
                ref={provided.innerRef}
                className="space-y-2"
              >
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
                          className={`flex items-center gap-3 p-4 bg-[#0d0f1a] border border-[#d3bb73]/10 rounded-lg transition-all ${
                            snapshot.isDragging ? 'shadow-lg shadow-[#d3bb73]/20' : ''
                          }`}
                        >
                          <div
                            {...provided.dragHandleProps}
                            className="text-[#e5e4e2]/40 hover:text-[#d3bb73] cursor-grab active:cursor-grabbing"
                          >
                            <GripVertical className="w-5 h-5" />
                          </div>

                          {item.product?.pdf_thumbnail_url && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onPreviewImage(item.product!.pdf_thumbnail_url!);
                              }}
                              className="flex-shrink-0 w-16 h-16 rounded overflow-hidden border border-[#d3bb73]/10 hover:border-[#d3bb73]/30 transition-colors"
                            >
                              <img
                                src={item.product.pdf_thumbnail_url}
                                alt={item.product.name}
                                className="w-full h-full object-cover"
                              />
                            </button>
                          )}

                          <div className="flex-1 min-w-0">
                            <h3 className="text-sm font-medium text-[#e5e4e2] truncate">
                              {item.product?.name || 'Produkt'}
                            </h3>
                            <p className="text-xs text-[#e5e4e2]/60 truncate">
                              {item.product?.description}
                            </p>
                            <div className="flex items-center gap-4 mt-1">
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
                            <div className="text-right mr-4">
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
  className="p-2 text-[#e5e4e2]/60 hover:text-blue-400 hover:bg-blue-500/10 rounded transition-colors"
  title="Przejdź do produktu"
>
  <Eye className="w-4 h-4" />
</button> 
                            )}

                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onEditItem(item);
                              }}
                              className="p-2 text-[#e5e4e2]/60 hover:text-[#d3bb73] hover:bg-[#d3bb73]/10 rounded transition-colors"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>

                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onDeleteItem(item.id);
                              }}
                              className="p-2 text-[#e5e4e2]/60 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
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
