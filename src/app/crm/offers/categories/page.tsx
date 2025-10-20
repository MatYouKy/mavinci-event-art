'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Plus, Edit, Trash2, FolderTree, Package, ChevronRight } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';

interface Category {
  id: string;
  name: string;
  description: string | null;
  parent_id: string | null;
  level: number;
  full_path: string | null;
  icon: string | null;
  display_order: number;
  is_active: boolean;
  products_count?: number;
  children_count?: number;
}

export default function OfferCategoriesPage() {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const { isAdmin, hasScope } = useCurrentEmployee();

  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [parentId, setParentId] = useState<string | null>(null);

  const canManage = isAdmin || hasScope('offers_manage');

  useEffect(() => {
    fetchCategories();
  }, []);

  const fetchCategories = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('offer_product_categories_hierarchy')
        .select('*')
        .order('path');

      if (error) throw error;
      setCategories(data || []);
    } catch (err: any) {
      showSnackbar(err.message || 'Błąd pobierania kategorii', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleAddCategory = (parent_id: string | null = null) => {
    setParentId(parent_id);
    setEditingCategory(null);
    setShowModal(true);
  };

  const handleEditCategory = (category: Category) => {
    setEditingCategory(category);
    setParentId(category.parent_id);
    setShowModal(true);
  };

  const handleDeleteCategory = async (id: string) => {
    if (!confirm('Czy na pewno chcesz usunąć tę kategorię? Produkty w niej zostaną bez kategorii.')) {
      return;
    }

    try {
      const { error } = await supabase
        .from('offer_product_categories')
        .delete()
        .eq('id', id);

      if (error) throw error;
      showSnackbar('Kategoria usunięta', 'success');
      fetchCategories();
    } catch (err: any) {
      showSnackbar(err.message || 'Błąd usuwania kategorii', 'error');
    }
  };

  const handleSaveCategory = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);

    const categoryData = {
      name: formData.get('name') as string,
      description: formData.get('description') as string || null,
      parent_id: parentId,
      icon: formData.get('icon') as string || null,
      display_order: parseInt(formData.get('display_order') as string) || 0,
      is_active: formData.get('is_active') === 'on',
    };

    try {
      if (editingCategory) {
        const { error } = await supabase
          .from('offer_product_categories')
          .update(categoryData)
          .eq('id', editingCategory.id);

        if (error) throw error;
        showSnackbar('Kategoria zaktualizowana', 'success');
      } else {
        const { error } = await supabase
          .from('offer_product_categories')
          .insert([categoryData]);

        if (error) throw error;
        showSnackbar('Kategoria dodana', 'success');
      }

      setShowModal(false);
      fetchCategories();
    } catch (err: any) {
      showSnackbar(err.message || 'Błąd zapisywania kategorii', 'error');
    }
  };

  const mainCategories = categories.filter((c) => c.level === 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push('/crm/offers?tab=catalog')}
            className="p-2 hover:bg-[#1c1f33] rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-[#e5e4e2]" />
          </button>
          <div>
            <h1 className="text-2xl font-light text-[#e5e4e2]">Kategorie produktów</h1>
            <p className="text-sm text-[#e5e4e2]/60 mt-1">
              Zarządzaj kategoriami i podkategoriami produktów ofertowych
            </p>
          </div>
        </div>
        {canManage && (
          <button
            onClick={() => handleAddCategory(null)}
            className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Dodaj kategorię główną
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-center py-12 text-[#e5e4e2]/60">Ładowanie...</div>
      ) : (
        <div className="space-y-4">
          {mainCategories.map((mainCat) => (
            <CategoryCard
              key={mainCat.id}
              category={mainCat}
              allCategories={categories}
              canManage={canManage}
              onEdit={handleEditCategory}
              onDelete={handleDeleteCategory}
              onAddSubcategory={handleAddCategory}
            />
          ))}

          {mainCategories.length === 0 && (
            <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-12 text-center">
              <FolderTree className="w-12 h-12 text-[#e5e4e2]/20 mx-auto mb-4" />
              <p className="text-[#e5e4e2]/60">Brak kategorii</p>
              {canManage && (
                <button
                  onClick={() => handleAddCategory(null)}
                  className="mt-4 px-4 py-2 bg-[#d3bb73]/20 text-[#d3bb73] rounded-lg hover:bg-[#d3bb73]/30 transition-colors"
                >
                  Dodaj pierwszą kategorię
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {showModal && (
        <CategoryModal
          category={editingCategory}
          parentId={parentId}
          categories={categories}
          onClose={() => setShowModal(false)}
          onSave={handleSaveCategory}
        />
      )}
    </div>
  );
}

interface CategoryCardProps {
  category: Category;
  allCategories: Category[];
  canManage: boolean;
  onEdit: (category: Category) => void;
  onDelete: (id: string) => void;
  onAddSubcategory: (parentId: string) => void;
}

function CategoryCard({
  category,
  allCategories,
  canManage,
  onEdit,
  onDelete,
  onAddSubcategory,
}: CategoryCardProps) {
  const [expanded, setExpanded] = useState(false);
  const subcategories = allCategories.filter((c) => c.parent_id === category.id);

  return (
    <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl overflow-hidden">
      <div className="p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4 flex-1">
            {subcategories.length > 0 && (
              <button
                onClick={() => setExpanded(!expanded)}
                className="p-1 hover:bg-[#0a0d1a] rounded transition-colors"
              >
                <ChevronRight
                  className={`w-5 h-5 text-[#e5e4e2]/60 transition-transform ${
                    expanded ? 'rotate-90' : ''
                  }`}
                />
              </button>
            )}
            {!subcategories.length && <div className="w-7" />}

            <div className="w-12 h-12 bg-[#d3bb73]/20 rounded-lg flex items-center justify-center">
              {category.icon ? (
                <span className="text-2xl">{category.icon}</span>
              ) : (
                <FolderTree className="w-6 h-6 text-[#d3bb73]" />
              )}
            </div>

            <div className="flex-1">
              <div className="flex items-center gap-3">
                <h3 className="text-lg font-medium text-[#e5e4e2]">{category.name}</h3>
                {!category.is_active && (
                  <span className="px-2 py-0.5 text-xs bg-gray-500/20 text-gray-400 rounded">
                    Nieaktywna
                  </span>
                )}
              </div>
              {category.description && (
                <p className="text-sm text-[#e5e4e2]/60 mt-1">{category.description}</p>
              )}
              <div className="flex items-center gap-4 mt-2 text-xs text-[#e5e4e2]/60">
                <span className="flex items-center gap-1">
                  <Package className="w-3 h-3" />
                  {category.products_count || 0} produktów
                </span>
                {subcategories.length > 0 && (
                  <span className="flex items-center gap-1">
                    <FolderTree className="w-3 h-3" />
                    {subcategories.length} podkategorii
                  </span>
                )}
              </div>
            </div>
          </div>

          {canManage && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => onAddSubcategory(category.id)}
                className="p-2 hover:bg-[#0a0d1a] rounded-lg transition-colors group"
                title="Dodaj podkategorię"
              >
                <Plus className="w-4 h-4 text-[#e5e4e2]/60 group-hover:text-[#d3bb73]" />
              </button>
              <button
                onClick={() => onEdit(category)}
                className="p-2 hover:bg-[#0a0d1a] rounded-lg transition-colors group"
              >
                <Edit className="w-4 h-4 text-[#e5e4e2]/60 group-hover:text-[#d3bb73]" />
              </button>
              <button
                onClick={() => onDelete(category.id)}
                className="p-2 hover:bg-[#0a0d1a] rounded-lg transition-colors group"
              >
                <Trash2 className="w-4 h-4 text-[#e5e4e2]/60 group-hover:text-red-400" />
              </button>
            </div>
          )}
        </div>
      </div>

      {expanded && subcategories.length > 0 && (
        <div className="border-t border-[#d3bb73]/10 bg-[#0a0d1a]/50 px-5 py-3 space-y-2">
          {subcategories.map((subcat) => (
            <div
              key={subcat.id}
              className="flex items-center justify-between p-3 bg-[#1c1f33] rounded-lg hover:bg-[#1c1f33]/80 transition-colors"
            >
              <div className="flex items-center gap-3 flex-1">
                <div className="w-8 h-8 bg-[#d3bb73]/10 rounded flex items-center justify-center">
                  {subcat.icon ? (
                    <span className="text-lg">{subcat.icon}</span>
                  ) : (
                    <FolderTree className="w-4 h-4 text-[#d3bb73]/60" />
                  )}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[#e5e4e2]">{subcat.name}</span>
                    {!subcat.is_active && (
                      <span className="px-2 py-0.5 text-xs bg-gray-500/20 text-gray-400 rounded">
                        Nieaktywna
                      </span>
                    )}
                  </div>
                  {subcat.description && (
                    <p className="text-xs text-[#e5e4e2]/60 mt-0.5">{subcat.description}</p>
                  )}
                </div>
                <span className="text-xs text-[#e5e4e2]/60">
                  {subcat.products_count || 0} produktów
                </span>
              </div>

              {canManage && (
                <div className="flex items-center gap-1 ml-4">
                  <button
                    onClick={() => onEdit(subcat)}
                    className="p-1.5 hover:bg-[#0a0d1a] rounded transition-colors group"
                  >
                    <Edit className="w-3.5 h-3.5 text-[#e5e4e2]/60 group-hover:text-[#d3bb73]" />
                  </button>
                  <button
                    onClick={() => onDelete(subcat.id)}
                    className="p-1.5 hover:bg-[#0a0d1a] rounded transition-colors group"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-[#e5e4e2]/60 group-hover:text-red-400" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface CategoryModalProps {
  category: Category | null;
  parentId: string | null;
  categories: Category[];
  onClose: () => void;
  onSave: (e: React.FormEvent<HTMLFormElement>) => void;
}

function CategoryModal({ category, parentId, categories, onClose, onSave }: CategoryModalProps) {
  const parentCategory = parentId ? categories.find((c) => c.id === parentId) : null;
  const mainCategories = categories.filter((c) => c.level === 0);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[#1c1f33] rounded-xl p-6 w-full max-w-md border border-[#d3bb73]/10">
        <h2 className="text-xl font-medium text-[#e5e4e2] mb-4">
          {category ? 'Edytuj kategorię' : parentCategory ? `Dodaj podkategorię do "${parentCategory.name}"` : 'Dodaj kategorię główną'}
        </h2>

        <form onSubmit={onSave} className="space-y-4">
          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">Nazwa</label>
            <input
              type="text"
              name="name"
              defaultValue={category?.name || ''}
              required
              className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
            />
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">Opis</label>
            <textarea
              name="description"
              defaultValue={category?.description || ''}
              rows={3}
              className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
            />
          </div>

          {!parentId && !category && (
            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Kategoria nadrzędna (opcjonalnie)</label>
              <select
                name="parent_category"
                defaultValue=""
                onChange={(e) => {
                  const form = e.target.form;
                  if (form) {
                    const input = document.createElement('input');
                    input.type = 'hidden';
                    input.name = 'parent_id';
                    input.value = e.target.value;
                    form.appendChild(input);
                  }
                }}
                className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
              >
                <option value="">Kategoria główna</option>
                {mainCategories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">Ikona (emoji)</label>
            <input
              type="text"
              name="icon"
              defaultValue={category?.icon || ''}
              placeholder="🎵 🎤 🎸"
              maxLength={2}
              className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
            />
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">Kolejność wyświetlania</label>
            <input
              type="number"
              name="display_order"
              defaultValue={category?.display_order || 0}
              className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              name="is_active"
              id="is_active"
              defaultChecked={category?.is_active !== false}
              className="w-4 h-4 rounded border-[#d3bb73]/20 bg-[#0a0d1a] text-[#d3bb73]"
            />
            <label htmlFor="is_active" className="text-sm text-[#e5e4e2]">
              Aktywna
            </label>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-[#0a0d1a] text-[#e5e4e2] rounded-lg hover:bg-[#0a0d1a]/80 transition-colors"
            >
              Anuluj
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
            >
              {category ? 'Zapisz' : 'Dodaj'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
