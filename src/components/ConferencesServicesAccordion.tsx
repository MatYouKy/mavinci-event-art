'use client';

import { useState, useEffect } from 'react';
import { ChevronDown, CheckCircle, Edit2, Trash2, Plus, Save, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useEditMode } from '@/contexts/EditModeContext';

const getIcon = (iconName: string) => {
  const icons: any = {
    CheckCircle,
  };
  return icons[iconName] || CheckCircle;
};

export default function ConferencesServicesAccordion() {
  const { isEditMode } = useEditMode();
  const [categories, setCategories] = useState<any[]>([]);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [editingCategory, setEditingCategory] = useState<any>(null);
  const [editingItem, setEditingItem] = useState<any>(null);
  const [isAddingItem, setIsAddingItem] = useState<string | null>(null);
  const [newItemData, setNewItemData] = useState({ name: '', description: '' });

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
      const categoriesWithItems = await Promise.all(
        cats.map(async (cat) => {
          const { data: items } = await supabase
            .from('conferences_service_items')
            .select('*')
            .eq('category_id', cat.id)
            .eq('is_active', true)
            .order('display_order');

          return { ...cat, items: items || [] };
        })
      );
      setCategories(categoriesWithItems);
    }
  };

  const toggleCategory = (categoryId: string) => {
    setExpandedCategory(expandedCategory === categoryId ? null : categoryId);
  };

  const handleUpdateCategory = async (category: any) => {
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

  const handleUpdateItem = async (item: any) => {
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
    const category = categories.find(c => c.id === categoryId);
    const maxOrder = Math.max(...(category?.items?.map((i: any) => i.display_order) || [0]), 0);

    const { error } = await supabase
      .from('conferences_service_items')
      .insert({
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

  return (
    <div className="space-y-4">
      {categories.map((category) => {
        const Icon = getIcon(category.icon);
        const isExpanded = expandedCategory === category.id;
        const isEditing = editingCategory?.id === category.id;

        return (
          <div
            key={category.id}
            className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl overflow-hidden hover:border-[#d3bb73]/40 transition-colors"
          >
            {/* Header */}
            <button
              onClick={() => !isEditing && toggleCategory(category.id)}
              className="w-full px-6 py-4 flex items-center justify-between hover:bg-[#1c1f33]/50 transition-colors"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-[#d3bb73]/10 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Icon className="w-5 h-5 text-[#d3bb73]" />
                </div>
                {isEditing ? (
                  <div className="flex-1 flex flex-col gap-2 text-left" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="text"
                      value={editingCategory.name}
                      onChange={(e) => setEditingCategory({ ...editingCategory, name: e.target.value })}
                      className="bg-[#0f1119] border border-[#d3bb73]/20 rounded px-3 py-1.5 text-[#e5e4e2] text-lg outline-none focus:border-[#d3bb73]"
                    />
                    <textarea
                      value={editingCategory.description || ''}
                      onChange={(e) => setEditingCategory({ ...editingCategory, description: e.target.value })}
                      placeholder="Opis kategorii"
                      rows={2}
                      className="bg-[#0f1119] border border-[#d3bb73]/20 rounded px-3 py-1.5 text-[#e5e4e2]/60 text-sm outline-none focus:border-[#d3bb73]"
                    />
                  </div>
                ) : (
                  <div className="text-left">
                    <h3 className="text-lg font-medium text-[#e5e4e2]">{category.name}</h3>
                    {category.description && (
                      <p className="text-[#e5e4e2]/60 text-sm mt-1">{category.description}</p>
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
                  className={`w-5 h-5 text-[#d3bb73] transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                />
              </div>
            </button>

            {/* Content */}
            {isExpanded && (
              <div className="px-6 pb-6 border-t border-[#d3bb73]/10">
                <ul className="space-y-3 mt-4">
                  {category.items?.map((item: any) => {
                    const isEditingThisItem = editingItem?.id === item.id;

                    return (
                      <li key={item.id} className="flex items-start gap-3">
                        <CheckCircle className="w-4 h-4 text-[#d3bb73] mt-1 flex-shrink-0" />
                        {isEditingThisItem ? (
                          <div className="flex-1 space-y-2">
                            <input
                              type="text"
                              value={editingItem.name}
                              onChange={(e) => setEditingItem({ ...editingItem, name: e.target.value })}
                              className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded px-3 py-1.5 text-[#e5e4e2] text-sm outline-none focus:border-[#d3bb73]"
                            />
                            <textarea
                              value={editingItem.description || ''}
                              onChange={(e) => setEditingItem({ ...editingItem, description: e.target.value })}
                              placeholder="Opis (opcjonalny)"
                              rows={2}
                              className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded px-3 py-1.5 text-[#e5e4e2]/60 text-xs outline-none focus:border-[#d3bb73]"
                            />
                            <div className="flex gap-2">
                              <button
                                onClick={() => handleUpdateItem(editingItem)}
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
                            <span className={`text-sm ${item.is_premium ? 'text-[#d3bb73] font-medium' : 'text-[#e5e4e2]/70'}`}>
                              {item.name}
                            </span>
                            {item.description && (
                              <p className="text-[#e5e4e2]/40 text-xs mt-0.5">{item.description}</p>
                            )}
                          </div>
                        )}
                        {isEditMode && !isEditingThisItem && (
                          <div className="flex gap-1">
                            <button
                              onClick={() => setEditingItem(item)}
                              className="p-1 hover:bg-[#d3bb73]/20 rounded transition-colors"
                            >
                              <Edit2 className="w-3 h-3 text-[#d3bb73]" />
                            </button>
                            <button
                              onClick={() => handleDeleteItem(item.id)}
                              className="p-1 hover:bg-[#800020]/20 rounded transition-colors"
                            >
                              <Trash2 className="w-3 h-3 text-[#800020]" />
                            </button>
                          </div>
                        )}
                      </li>
                    );
                  })}

                  {isEditMode && isAddingItem === category.id && (
                    <li className="flex items-start gap-3 pt-3 border-t border-[#d3bb73]/10">
                      <Plus className="w-4 h-4 text-[#d3bb73] mt-1 flex-shrink-0" />
                      <div className="flex-1 space-y-2">
                        <input
                          type="text"
                          value={newItemData.name}
                          onChange={(e) => setNewItemData({ ...newItemData, name: e.target.value })}
                          placeholder="Nazwa usługi"
                          className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded px-3 py-1.5 text-[#e5e4e2] text-sm outline-none focus:border-[#d3bb73]"
                        />
                        <textarea
                          value={newItemData.description}
                          onChange={(e) => setNewItemData({ ...newItemData, description: e.target.value })}
                          placeholder="Opis (opcjonalny)"
                          rows={2}
                          className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded px-3 py-1.5 text-[#e5e4e2]/60 text-xs outline-none focus:border-[#d3bb73]"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleAddItem(category.id)}
                            className="px-3 py-1 bg-[#d3bb73] text-[#1c1f33] rounded text-xs hover:bg-[#d3bb73]/90"
                          >
                            Dodaj
                          </button>
                          <button
                            onClick={() => {
                              setIsAddingItem(null);
                              setNewItemData({ name: '', description: '' });
                            }}
                            className="px-3 py-1 bg-[#800020] text-[#e5e4e2] rounded text-xs hover:bg-[#800020]/90"
                          >
                            Anuluj
                          </button>
                        </div>
                      </div>
                    </li>
                  )}
                </ul>

                {isEditMode && !isAddingItem && (
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
  );
}
