'use client';

import { useState, useEffect } from 'react';
import { Plus, Edit, Trash2, Check, X, Tag } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';

interface TemplateCategory {
  id: string;
  name: string;
  description: string;
  is_default: boolean;
  color: string;
  created_at: string;
  updated_at: string;
}

export default function OfferTemplateCategoriesManager() {
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const [categories, setCategories] = useState<TemplateCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    is_default: false,
    color: '#d3bb73',
  });

  useEffect(() => {
    fetchCategories();
  }, []);

  const fetchCategories = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('offer_template_categories')
        .select('*')
        .order('is_default', { ascending: false })
        .order('name');

      if (error) throw error;
      setCategories(data || []);
    } catch (err: any) {
      console.error('Error fetching categories:', err);
      showSnackbar('Błąd podczas ładowania kategorii', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    try {
      if (!formData.name.trim()) {
        showSnackbar('Podaj nazwę kategorii', 'error');
        return;
      }

      const { error } = await supabase
        .from('offer_template_categories')
        .insert([
          {
            name: formData.name,
            description: formData.description,
            is_default: formData.is_default,
            color: formData.color,
          },
        ]);

      if (error) throw error;

      showSnackbar('Kategoria została dodana', 'success');
      setIsCreating(false);
      setFormData({ name: '', description: '', is_default: false, color: '#d3bb73' });
      fetchCategories();
    } catch (err: any) {
      console.error('Error creating category:', err);
      showSnackbar(err.message || 'Błąd podczas tworzenia kategorii', 'error');
    }
  };

  const handleUpdate = async (id: string) => {
    try {
      if (!formData.name.trim()) {
        showSnackbar('Podaj nazwę kategorii', 'error');
        return;
      }

      const { error } = await supabase
        .from('offer_template_categories')
        .update({
          name: formData.name,
          description: formData.description,
          is_default: formData.is_default,
          color: formData.color,
        })
        .eq('id', id);

      if (error) throw error;

      showSnackbar('Kategoria została zaktualizowana', 'success');
      setEditingId(null);
      fetchCategories();
    } catch (err: any) {
      console.error('Error updating category:', err);
      showSnackbar(err.message || 'Błąd podczas aktualizacji kategorii', 'error');
    }
  };

  const handleDelete = async (id: string, name: string) => {
    const confirmed = await showConfirm(
      'Czy na pewno chcesz usunąć tę kategorię?',
      `Kategoria "${name}" zostanie usunięta. Wszystkie szablony przypisane do tej kategorii zostaną zaktualizowane.`
    );

    if (!confirmed) return;

    try {
      const { error } = await supabase
        .from('offer_template_categories')
        .delete()
        .eq('id', id);

      if (error) throw error;

      showSnackbar('Kategoria została usunięta', 'success');
      fetchCategories();
    } catch (err: any) {
      console.error('Error deleting category:', err);
      showSnackbar(err.message || 'Błąd podczas usuwania kategorii', 'error');
    }
  };

  const startEdit = (category: TemplateCategory) => {
    setEditingId(category.id);
    setFormData({
      name: category.name,
      description: category.description || '',
      is_default: category.is_default,
      color: category.color,
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setIsCreating(false);
    setFormData({ name: '', description: '', is_default: false, color: '#d3bb73' });
  };

  const colorOptions = [
    { value: '#d3bb73', label: 'Złoty' },
    { value: '#e91e63', label: 'Różowy' },
    { value: '#2196f3', label: 'Niebieski' },
    { value: '#4caf50', label: 'Zielony' },
    { value: '#ff9800', label: 'Pomarańczowy' },
    { value: '#9c27b0', label: 'Fioletowy' },
    { value: '#f44336', label: 'Czerwony' },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-[#e5e4e2]/60">Ładowanie kategorii...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-light text-[#e5e4e2]">Kategorie Szablonów Ofert</h2>
          <p className="text-sm text-[#e5e4e2]/60 mt-1">
            Zarządzaj kategoriami szablonów (np. Wesela, Eventy, Konferencje)
          </p>
        </div>
        {!isCreating && (
          <button
            onClick={() => setIsCreating(true)}
            className="flex items-center gap-2 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
          >
            <Plus className="w-5 h-5" />
            Dodaj kategorię
          </button>
        )}
      </div>

      <div className="space-y-3">
        {isCreating && (
          <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl p-6">
            <h3 className="text-lg font-medium text-[#e5e4e2] mb-4">Nowa kategoria</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">Nazwa kategorii</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full bg-[#0f1118] border border-[#d3bb73]/20 rounded-lg px-3 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/50"
                  placeholder="np. Wesela"
                />
              </div>

              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">Opis</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={2}
                  className="w-full bg-[#0f1118] border border-[#d3bb73]/20 rounded-lg px-3 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/50 resize-none"
                  placeholder="Opis kategorii"
                />
              </div>

              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">Kolor</label>
                <div className="flex gap-2 flex-wrap">
                  {colorOptions.map((color) => (
                    <button
                      key={color.value}
                      onClick={() => setFormData({ ...formData, color: color.value })}
                      className={`w-10 h-10 rounded-lg transition-all ${
                        formData.color === color.value
                          ? 'ring-2 ring-[#d3bb73] ring-offset-2 ring-offset-[#0d0f1a]'
                          : 'hover:scale-110'
                      }`}
                      style={{ backgroundColor: color.value }}
                      title={color.label}
                    />
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="new-is-default"
                  checked={formData.is_default}
                  onChange={(e) => setFormData({ ...formData, is_default: e.target.checked })}
                  className="w-4 h-4 text-[#d3bb73] bg-[#0f1118] border-[#d3bb73]/20 rounded focus:ring-[#d3bb73]"
                />
                <label htmlFor="new-is-default" className="text-sm text-[#e5e4e2]/80">
                  Ustaw jako domyślną kategorię
                </label>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={handleCreate}
                  className="flex items-center gap-2 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
                >
                  <Check className="w-4 h-4" />
                  Zapisz
                </button>
                <button
                  onClick={cancelEdit}
                  className="flex items-center gap-2 px-4 py-2 bg-[#1c1f33] border border-[#d3bb73]/20 text-[#e5e4e2] rounded-lg hover:bg-[#d3bb73]/10 transition-colors"
                >
                  <X className="w-4 h-4" />
                  Anuluj
                </button>
              </div>
            </div>
          </div>
        )}

        {categories.map((category) => (
          <div
            key={category.id}
            className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6 hover:border-[#d3bb73]/20 transition-colors"
          >
            {editingId === category.id ? (
              <div className="space-y-4">
                <h3 className="text-lg font-medium text-[#e5e4e2] mb-4">Edytuj kategorię</h3>
                <div>
                  <label className="block text-sm text-[#e5e4e2]/60 mb-2">Nazwa kategorii</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full bg-[#0f1118] border border-[#d3bb73]/20 rounded-lg px-3 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/50"
                  />
                </div>

                <div>
                  <label className="block text-sm text-[#e5e4e2]/60 mb-2">Opis</label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    rows={2}
                    className="w-full bg-[#0f1118] border border-[#d3bb73]/20 rounded-lg px-3 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/50 resize-none"
                  />
                </div>

                <div>
                  <label className="block text-sm text-[#e5e4e2]/60 mb-2">Kolor</label>
                  <div className="flex gap-2 flex-wrap">
                    {colorOptions.map((color) => (
                      <button
                        key={color.value}
                        onClick={() => setFormData({ ...formData, color: color.value })}
                        className={`w-10 h-10 rounded-lg transition-all ${
                          formData.color === color.value
                            ? 'ring-2 ring-[#d3bb73] ring-offset-2 ring-offset-[#0d0f1a]'
                            : 'hover:scale-110'
                        }`}
                        style={{ backgroundColor: color.value }}
                        title={color.label}
                      />
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id={`edit-is-default-${category.id}`}
                    checked={formData.is_default}
                    onChange={(e) => setFormData({ ...formData, is_default: e.target.checked })}
                    className="w-4 h-4 text-[#d3bb73] bg-[#0f1118] border-[#d3bb73]/20 rounded focus:ring-[#d3bb73]"
                  />
                  <label htmlFor={`edit-is-default-${category.id}`} className="text-sm text-[#e5e4e2]/80">
                    Ustaw jako domyślną kategorię
                  </label>
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    onClick={() => handleUpdate(category.id)}
                    className="flex items-center gap-2 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
                  >
                    <Check className="w-4 h-4" />
                    Zapisz
                  </button>
                  <button
                    onClick={cancelEdit}
                    className="flex items-center gap-2 px-4 py-2 bg-[#1c1f33] border border-[#d3bb73]/20 text-[#e5e4e2] rounded-lg hover:bg-[#d3bb73]/10 transition-colors"
                  >
                    <X className="w-4 h-4" />
                    Anuluj
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div
                    className="w-12 h-12 rounded-lg flex items-center justify-center"
                    style={{ backgroundColor: category.color }}
                  >
                    <Tag className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-medium text-[#e5e4e2]">{category.name}</h3>
                      {category.is_default && (
                        <span className="px-2 py-0.5 text-xs bg-[#d3bb73] text-[#1c1f33] rounded">
                          Domyślna
                        </span>
                      )}
                    </div>
                    {category.description && (
                      <p className="text-sm text-[#e5e4e2]/60 mt-1">{category.description}</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => startEdit(category)}
                    className="p-2 text-[#e5e4e2]/60 hover:text-[#d3bb73] hover:bg-[#d3bb73]/10 rounded-lg transition-colors"
                    title="Edytuj"
                  >
                    <Edit className="w-5 h-5" />
                  </button>
                  {!category.is_default && (
                    <button
                      onClick={() => handleDelete(category.id, category.name)}
                      className="p-2 text-[#e5e4e2]/60 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                      title="Usuń"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}

        {categories.length === 0 && !isCreating && (
          <div className="text-center py-12 text-[#e5e4e2]/60">
            Brak kategorii szablonów. Dodaj pierwszą kategorię.
          </div>
        )}
      </div>
    </div>
  );
}
