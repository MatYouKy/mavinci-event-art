'use client';

import { useState, useEffect, FC } from 'react';
import {
  ChevronDown,
  CheckCircle,
  Edit2,
  Trash2,
  Plus,
  Save,
  X,
  GripVertical,
} from 'lucide-react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { supabase } from '@/lib/supabase';
import { useEditMode } from '@/contexts/EditModeContext';
import { useMobile } from '@/hooks/useMobile';

const getIcon = (iconName: string) => {
  const icons: any = {
    CheckCircle,
  };
  return icons[iconName] || CheckCircle;
};

interface ServiceItem {
  id: string;
  name: string;
  description?: string | null;
  is_premium?: boolean;
  display_order: number;
  [key: string]: any;
}

interface Category {
  id: string;
  name: string;
  description?: string | null;
  icon?: string;
  items: ServiceItem[];
  [key: string]: any;
}

export default function ConferencesServicesAccordion() {
  const { isEditMode } = useEditMode();
  const [categories, setCategories] = useState<Category[]>([]);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [editingItem, setEditingItem] = useState<ServiceItem | null>(null);
  const [isAddingItem, setIsAddingItem] = useState<string | null>(null);
  const [newItemData, setNewItemData] = useState({ name: '', description: '' });
  const isMobile = useMobile();

  useEffect(() => {
    loadCategories();
  }, []);

  const loadCategories = async () => {
    const { data: cats, error: catsError } = await supabase
      .from('conferences_service_categories')
      .select('*')
      .eq('is_active', true)
      .order('display_order');

    if (cats && !catsError) {
      const categoriesWithItems: Category[] = await Promise.all(
        cats.map(async (cat: any) => {
          const { data: items } = await supabase
            .from('conferences_service_items')
            .select('*')
            .eq('category_id', cat.id)
            .eq('is_active', true)
            .order('display_order');

          return { ...cat, items: (items || []) as ServiceItem[] };
        })
      );
      setCategories(categoriesWithItems);
    }
  };

  const toggleCategory = (categoryId: string) => {
    setExpandedCategory(expandedCategory === categoryId ? null : categoryId);
  };

  const handleUpdateCategory = async (category: Category) => {
    const { error } = await supabase
      .from('conferences_service_categories')
      .update({
        name: category.name,
        description: category.description,
      })
      .eq('id', category.id);

    if (!error) {
      await loadCategories();
      setEditingCategory(null);
    }
  };

  const handleUpdateItem = async (item: ServiceItem) => {
    const { error } = await supabase
      .from('conferences_service_items')
      .update({
        name: item.name,
        description: item.description,
      })
      .eq('id', item.id);

    if (!error) {
      await loadCategories();
      setEditingItem(null);
    }
  };

  const handleAddItem = async (categoryId: string) => {
    const category = categories.find((c) => c.id === categoryId);
    const maxOrder = Math.max(
      ...(category?.items?.map((i: any) => i.display_order) || [0]),
      0
    );

    const { error } = await supabase.from('conferences_service_items').insert({
      category_id: categoryId,
      name: newItemData.name,
      description: newItemData.description || null,
      display_order: maxOrder + 1,
      is_active: true,
      is_premium: false,
    });

    if (!error) {
      await loadCategories();
      setIsAddingItem(null);
      setNewItemData({ name: '', description: '' });
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    if (!confirm('Czy na pewno chcesz usunąć tę usługę?')) return;

    const { error } = await supabase
      .from('conferences_service_items')
      .update({ is_active: false })
      .eq('id', itemId);

    if (!error) {
      await loadCategories();
    }
  };

  const reorder = <T,>(list: T[], startIndex: number, endIndex: number): T[] => {
    const result = Array.from(list);
    const [removed] = result.splice(startIndex, 1);
    result.splice(endIndex, 0, removed);
    return result;
  };

  const persistItemsOrder = async (categoryId: string, items: ServiceItem[]) => {
    // Update display_order in Supabase (1,2,3,...)
    const updates = items.map((item, idx) => ({
      id: item.id,
      display_order: idx + 1,
    }));

    // najprościej – jedna aktualizacja per item
    for (const u of updates) {
      await supabase
        .from('conferences_service_items')
        .update({ display_order: u.display_order })
        .eq('id', u.id);
    }
  };

  const onDragEnd = async (result: DropResult) => {
    const { destination, source, draggableId } = result;

    if (!destination) return;
    if (
      destination.droppableId === source.droppableId &&
      destination.index === source.index
    ) {
      return;
    }

    // Reorder tylko w ramach tej samej kategorii
    if (destination.droppableId !== source.droppableId) return;

    const categoryId = source.droppableId;
    setCategories((prev) => {
      const newCats = prev.map((cat) => {
        if (cat.id !== categoryId) return cat;

        const newItems = reorder(cat.items, source.index, destination.index);
        return { ...cat, items: newItems };
      });
      // Po ustawieniu stanu od razu odpalamy persist
      const changedCategory = newCats.find((c) => c.id === categoryId);
      if (changedCategory) {
        // Fire and forget – nie awaitujemy w setState callbacku
        persistItemsOrder(categoryId, changedCategory.items);
      }
      return newCats;
    });
  };

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="space-y-4">
        {categories.map((category) => {
          const Icon = getIcon(category.icon);
          const isExpanded = expandedCategory === category.id;
          const isEditing = editingCategory?.id === category.id;
          const isAddingHere = isAddingItem === category.id;

          return (
            <div
              key={category.id}
              className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl overflow-hidden hover:border-[#d3bb73]/40 transition-colors"
            >
              {/* Header */}
              <button
                onClick={() => !isEditing && toggleCategory(category.id)}
                className={`w-full flex items-center justify-between hover:bg-[#1c1f33]/50 transition-colors ${
                  isMobile ? 'px-4 py-3' : 'px-6 py-4'
                }`}
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-[#d3bb73]/10 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Icon className="w-5 h-5 text-[#d3bb73]" />
                  </div>

                  {isEditing ? (
                    <div
                      className="flex-1 flex flex-col gap-2 text-left"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="text"
                        value={editingCategory.name}
                        onChange={(e) =>
                          setEditingCategory({
                            ...editingCategory,
                            name: e.target.value,
                          } as Category)
                        }
                        className="bg-[#0f1119] border border-[#d3bb73]/20 rounded px-3 py-1.5 text-[#e5e4e2] text-lg outline-none focus:border-[#d3bb73]"
                      />
                      <textarea
                        value={editingCategory.description || ''}
                        onChange={(e) =>
                          setEditingCategory({
                            ...editingCategory,
                            description: e.target.value,
                          } as Category)
                        }
                        placeholder="Opis kategorii"
                        rows={2}
                        className="bg-[#0f1119] border border-[#d3bb73]/20 rounded px-3 py-1.5 text-[#e5e4e2]/60 text-sm outline-none focus:border-[#d3bb73]"
                      />
                    </div>
                  ) : (
                    <div className="text-left">
                      <h3
                        className={`font-medium text-[#e5e4e2] ${
                          isMobile ? 'text-base' : 'text-lg'
                        }`}
                      >
                        {category.name}
                      </h3>
                      {category.description && (
                        <p
                          className={`text-[#e5e4e2]/60 mt-1 ${
                            isMobile ? 'text-xs' : 'text-sm'
                          }`}
                        >
                          {category.description}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {isEditMode && !isEditing && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingCategory(category);
                      }}
                      className="p-2 hover:bg-[#d3bb73]/20 rounded transition-colors"
                    >
                      <Edit2 className="w-4 h-4 text-[#d3bb73]" />
                    </button>
                  )}
                  {isEditing && (
                    <>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleUpdateCategory(editingCategory);
                        }}
                        className="p-2 hover:bg-[#d3bb73]/20 rounded transition-colors"
                      >
                        <Save className="w-4 h-4 text-[#d3bb73]" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingCategory(null);
                        }}
                        className="p-2 hover:bg-[#800020]/20 rounded transition-colors"
                      >
                        <X className="w-4 h-4 text-[#800020]" />
                      </button>
                    </>
                  )}
                  <ChevronDown
                    className={`w-5 h-5 text-[#d3bb73] transition-transform ${
                      isExpanded ? 'rotate-180' : ''
                    }`}
                  />
                </div>
              </button>

              {/* Content */}
              {isExpanded && (
                <div
                  className={`border-t border-[#d3bb73]/10 ${
                    isMobile ? 'px-4 pb-4' : 'px-6 pb-6'
                  }`}
                >
                  <Droppable droppableId={category.id}>
                    {(provided) => (
                      <ul
                        className="space-y-3 mt-4"
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                      >
                        {category.items?.map((item, index) => {
                          const isEditingThisItem = editingItem?.id === item.id;

                          return (
                            <Draggable
                              key={item.id}
                              draggableId={item.id}
                              index={index}
                              isDragDisabled={!isEditMode}
                            >
                              {(dragProvided, snapshot) => (
                                <li
                                  ref={dragProvided.innerRef}
                                  {...dragProvided.draggableProps}
                                  className={`flex items-start gap-3 rounded ${
                                    snapshot.isDragging
                                      ? 'bg-[#0f1119] border border-[#d3bb73]/40 px-2 py-2'
                                      : ''
                                  }`}
                                >
                                  {isEditMode && (
                                    <div
                                      {...dragProvided.dragHandleProps}
                                      className="mt-1 flex-shrink-0 cursor-grab active:cursor-grabbing p-1 rounded hover:bg-[#d3bb73]/10"
                                    >
                                      <GripVertical className="w-3 h-3 text-[#d3bb73]" />
                                    </div>
                                  )}

                                  <ServiceItemRow
                                    item={item}
                                    isPremium={!!item.is_premium}
                                    isEditMode={isEditMode}
                                    isEditing={isEditingThisItem}
                                    editingItem={editingItem}
                                    setEditingItem={setEditingItem}
                                    onSave={handleUpdateItem}
                                    onDelete={handleDeleteItem}
                                  />
                                </li>
                              )}
                            </Draggable>
                          );
                        })}

                        {provided.placeholder}

                        {isEditMode && isAddingHere && (
                          <AddServiceItemRow
                            newItemData={newItemData}
                            setNewItemData={setNewItemData}
                            onAdd={() => handleAddItem(category.id)}
                            onCancel={() => {
                              setIsAddingItem(null);
                              setNewItemData({ name: '', description: '' });
                            }}
                          />
                        )}
                      </ul>
                    )}
                  </Droppable>

                  {isEditMode && isAddingItem === null && (
                    <button
                      onClick={() => setIsAddingItem(category.id)}
                      className="mt-4 flex items-center gap-2 text-[#d3bb73] hover:text-[#d3bb73]/80 text-sm"
                    >
                      <Plus className="w-4 h-4" />
                      Dodaj usługę
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </DragDropContext>
  );
}

/* ===========================
 *  ITEM KOMPONENTY
 * ===========================
 */

interface ServiceItemRowProps {
  item: ServiceItem;
  isPremium: boolean;
  isEditMode: boolean;
  isEditing: boolean;
  editingItem: ServiceItem | null;
  setEditingItem: (item: ServiceItem | null) => void;
  onSave: (item: ServiceItem) => void;
  onDelete: (id: string) => void;
}

const ServiceItemRow: FC<ServiceItemRowProps> = ({
  item,
  isPremium,
  isEditMode,
  isEditing,
  editingItem,
  setEditingItem,
  onSave,
  onDelete,
}) => {
  const isMobile = useMobile();
  const current = isEditing ? editingItem : item;

  if (!current) return null;

  return (
    <>
      {/* Ikona checka */}
      <CheckCircle
        className={`text-[#d3bb73] mt-1 flex-shrink-0 ${
          isMobile ? 'w-3 h-3' : 'w-4 h-4'
        }`}
      />
      {isEditing ? (
        <div className="flex-1 space-y-2">
          <input
            type="text"
            value={current.name}
            onChange={(e) =>
              setEditingItem({ ...current, name: e.target.value })
            }
            className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded px-3 py-1.5 text-[#e5e4e2] text-sm outline-none focus:border-[#d3bb73]"
          />
          <textarea
            value={current.description || ''}
            onChange={(e) =>
              setEditingItem({ ...current, description: e.target.value })
            }
            placeholder="Opis (opcjonalny)"
            rows={2}
            className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded px-3 py-1.5 text-[#e5e4e2]/60 text-xs outline-none focus:border-[#d3bb73]"
          />
          <div className="flex gap-2">
            <button
              onClick={() => onSave(current)}
              className="px-3 py-1 bg-[#d3bb73] text-[#1c1f33] rounded text-xs hover:bg-[#d3bb73]/90"
            >
              Zapisz
            </button>
            <button
              onClick={() => setEditingItem(null)}
              className="px-3 py-1 bg-[#800020] text-[#e5e4e2] rounded text-xs hover:bg-[#800020]/90"
            >
              Anuluj
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`${
                isMobile ? 'text-xs' : 'text-sm'
              } ${
                isPremium
                  ? 'text-[#d3bb73] font-medium'
                  : 'text-[#e5e4e2]/70'
              }`}
            >
              {current.name}
            </span>
            {isPremium && (
              <span className="rounded-full bg-[#d3bb73]/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#d3bb73]">
                Premium
              </span>
            )}
          </div>
          {current.description && (
            <p
              className={`text-[#e5e4e2]/40 mt-0.5 ${
                isMobile ? 'text-[11px]' : 'text-xs'
              }`}
            >
              {current.description}
            </p>
          )}
        </div>
      )}

      {isEditMode && !isEditing && (
        <div className="flex gap-1 ml-1">
          <button
            onClick={() => setEditingItem(item)}
            className="p-1 hover:bg-[#d3bb73]/20 rounded transition-colors"
          >
            <Edit2 className="w-3 h-3 text-[#d3bb73]" />
          </button>
          <button
            onClick={() => onDelete(item.id)}
            className="p-1 hover:bg-[#800020]/20 rounded transition-colors"
          >
            <Trash2 className="w-3 h-3 text-[#800020]" />
          </button>
        </div>
      )}
    </>
  );
};

interface AddServiceItemRowProps {
  newItemData: { name: string; description: string };
  setNewItemData: (data: { name: string; description: string }) => void;
  onAdd: () => void;
  onCancel: () => void;
}

const AddServiceItemRow: FC<AddServiceItemRowProps> = ({
  newItemData,
  setNewItemData,
  onAdd,
  onCancel,
}) => {
  const isMobile = useMobile();

  return (
    <li className="flex items-start gap-3 pt-3 border-t border-[#d3bb73]/10">
      <Plus
        className={`text-[#d3bb73] mt-1 flex-shrink-0 ${
          isMobile ? 'w-3 h-3' : 'w-4 h-4'
        }`}
      />
      <div className="flex-1 space-y-2">
        <input
          type="text"
          value={newItemData.name}
          onChange={(e) =>
            setNewItemData({ ...newItemData, name: e.target.value })
          }
          placeholder="Nazwa usługi"
          className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded px-3 py-1.5 text-[#e5e4e2] text-sm outline-none focus:border-[#d3bb73]"
        />
        <textarea
          value={newItemData.description}
          onChange={(e) =>
            setNewItemData({ ...newItemData, description: e.target.value })
          }
          placeholder="Opis (opcjonalny)"
          rows={2}
          className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded px-3 py-1.5 text-[#e5e4e2]/60 text-xs outline-none focus:border-[#d3bb73]"
        />
        <div className="flex gap-2">
          <button
            onClick={onAdd}
            className="px-3 py-1 bg-[#d3bb73] text-[#1c1f33] rounded text-xs hover:bg-[#d3bb73]/90"
          >
            Dodaj
          </button>
          <button
            onClick={onCancel}
            className="px-3 py-1 bg-[#800020] text-[#e5e4e2] rounded text-xs hover:bg-[#800020]/90"
          >
            Anuluj
          </button>
        </div>
      </div>
    </li>
  );
};