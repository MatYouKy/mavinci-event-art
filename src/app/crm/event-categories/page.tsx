'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Plus, Pencil, Trash2, X, Palette } from 'lucide-react';
import PermissionGuard from '@/components/crm/PermissionGuard';

interface EventCategory {
  id: string;
  name: string;
  color: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export default function EventCategoriesPage() {
  const [categories, setCategories] = useState<EventCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState<EventCategory | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    color: '#3B82F6',
    description: '',
    is_active: true,
  });

  useEffect(() => {
    fetchCategories();
  }, []);

  const fetchCategories = async () => {
    try {
      const { data, error } = await supabase
        .from('event_categories')
        .select('*')
        .order('name');

      if (error) throw error;
      setCategories(data || []);
    } catch (error) {
      console.error('Error fetching categories:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenModal = (category?: EventCategory) => {
    if (category) {
      setEditingCategory(category);
      setFormData({
        name: category.name,
        color: category.color,
        description: category.description || '',
        is_active: category.is_active,
      });
    } else {
      setEditingCategory(null);
      setFormData({
        name: '',
        color: '#3B82F6',
        description: '',
        is_active: true,
      });
    }
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setEditingCategory(null);
    setFormData({
      name: '',
      color: '#3B82F6',
      description: '',
      is_active: true,
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      if (editingCategory) {
        const { error } = await supabase
          .from('event_categories')
          .update({
            ...formData,
            updated_at: new Date().toISOString(),
          })
          .eq('id', editingCategory.id);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('event_categories')
          .insert([formData]);

        if (error) throw error;
      }

      await fetchCategories();
      handleCloseModal();
    } catch (error) {
      console.error('Error saving category:', error);
      alert('Błąd podczas zapisywania kategorii');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Czy na pewno chcesz usunąć tę kategorię?')) return;

    try {
      const { error } = await supabase
        .from('event_categories')
        .delete()
        .eq('id', id);

      if (error) throw error;
      await fetchCategories();
    } catch (error) {
      console.error('Error deleting category:', error);
      alert('Błąd podczas usuwania kategorii');
    }
  };

  const presetColors = [
    '#EF4444', '#F59E0B', '#10B981', '#3B82F6', '#8B5CF6',
    '#EC4899', '#6B7280', '#14B8A6', '#F97316', '#84CC16',
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-400">Ładowanie...</div>
      </div>
    );
  }

  return (
    <PermissionGuard permission="events_manage">
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 p-6">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-3xl font-bold text-white mb-2">Kategorie wydarzeń</h1>
              <p className="text-gray-400">Zarządzaj kategoriami dla wydarzeń</p>
            </div>
            <button
              onClick={() => handleOpenModal()}
              className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
            >
              <Plus className="w-5 h-5" />
              Nowa kategoria
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {categories.map((category) => (
              <div
                key={category.id}
                className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg p-6 hover:border-gray-600 transition-all"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-12 h-12 rounded-lg flex items-center justify-center"
                      style={{ backgroundColor: category.color }}
                    >
                      <Palette className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <h3 className="text-white font-semibold text-lg">{category.name}</h3>
                      <span className="text-xs text-gray-400">{category.color}</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleOpenModal(category)}
                      className="p-2 text-gray-400 hover:text-blue-400 hover:bg-gray-700 rounded transition-colors"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(category.id)}
                      className="p-2 text-gray-400 hover:text-red-400 hover:bg-gray-700 rounded transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                {category.description && (
                  <p className="text-gray-400 text-sm mb-3">{category.description}</p>
                )}
                <div className="flex items-center gap-2">
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-medium ${
                      category.is_active
                        ? 'bg-green-500/20 text-green-400'
                        : 'bg-gray-500/20 text-gray-400'
                    }`}
                  >
                    {category.is_active ? 'Aktywna' : 'Nieaktywna'}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {showModal && (
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
              <div className="bg-gray-800 rounded-xl p-6 max-w-md w-full border border-gray-700">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-bold text-white">
                    {editingCategory ? 'Edytuj kategorię' : 'Nowa kategoria'}
                  </h2>
                  <button
                    onClick={handleCloseModal}
                    className="text-gray-400 hover:text-white transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Nazwa kategorii *
                    </label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Kolor *
                    </label>
                    <div className="flex gap-3 mb-3">
                      <input
                        type="color"
                        value={formData.color}
                        onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                        className="w-16 h-10 rounded cursor-pointer"
                      />
                      <input
                        type="text"
                        value={formData.color}
                        onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                        className="flex-1 px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="#3B82F6"
                        pattern="^#[0-9A-Fa-f]{6}$"
                        required
                      />
                    </div>
                    <div className="grid grid-cols-5 gap-2">
                      {presetColors.map((color) => (
                        <button
                          key={color}
                          type="button"
                          onClick={() => setFormData({ ...formData, color })}
                          className={`w-full h-8 rounded border-2 transition-all ${
                            formData.color === color ? 'border-white scale-110' : 'border-transparent'
                          }`}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Opis
                    </label>
                    <textarea
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      rows={3}
                    />
                  </div>

                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      id="is_active"
                      checked={formData.is_active}
                      onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                      className="w-4 h-4 rounded border-gray-600 text-blue-600 focus:ring-blue-500"
                    />
                    <label htmlFor="is_active" className="text-sm text-gray-300">
                      Kategoria aktywna
                    </label>
                  </div>

                  <div className="flex gap-3 pt-4">
                    <button
                      type="button"
                      onClick={handleCloseModal}
                      className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
                    >
                      Anuluj
                    </button>
                    <button
                      type="submit"
                      className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                    >
                      {editingCategory ? 'Zapisz' : 'Utwórz'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      </div>
    </PermissionGuard>
  );
}
