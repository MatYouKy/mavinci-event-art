'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Plus, Pencil, Trash2, X, Palette, Image, Sparkles } from 'lucide-react';
import PermissionGuard from '@/components/crm/PermissionGuard';

interface CustomIcon {
  id: string;
  name: string;
  svg_code: string;
  preview_color: string;
}

interface EventCategory {
  id: string;
  name: string;
  color: string;
  description: string | null;
  is_active: boolean;
  icon_id: string | null;
  icon?: CustomIcon;
  created_at: string;
  updated_at: string;
}

export default function EventCategoriesPage() {
  const [categories, setCategories] = useState<EventCategory[]>([]);
  const [icons, setIcons] = useState<CustomIcon[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showIconModal, setShowIconModal] = useState(false);
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [editingCategory, setEditingCategory] = useState<EventCategory | null>(null);
  const [editingIcon, setEditingIcon] = useState<CustomIcon | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    color: '#3B82F6',
    description: '',
    is_active: true,
    icon_id: '',
  });
  const [iconFormData, setIconFormData] = useState({
    name: '',
    svg_code: '',
    preview_color: '#3B82F6',
  });

  useEffect(() => {
    fetchCategories();
    fetchIcons();
  }, []);

  useEffect(() => {
    if (editingCategory) {
      setFormData({
        name: editingCategory.name,
        color: editingCategory.color,
        description: editingCategory.description || '',
        is_active: editingCategory.is_active,
        icon_id: editingCategory.icon_id || '',
      });
    }
  }, [editingCategory]);

  const fetchCategories = async () => {
    try {
      const { data, error } = await supabase
        .from('event_categories')
        .select(`
          *,
          icon:custom_icons(id, name, svg_code, preview_color)
        `)
        .order('name');

      if (error) throw error;
      setCategories(data || []);
    } catch (error) {
      console.error('Error fetching categories:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchIcons = async () => {
    try {
      const { data, error } = await supabase
        .from('custom_icons')
        .select('*')
        .order('name');

      if (error) throw error;
      setIcons(data || []);
    } catch (error) {
      console.error('Error fetching icons:', error);
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
        icon_id: category.icon_id || '',
      });
    } else {
      setEditingCategory(null);
      setFormData({
        name: '',
        color: '#3B82F6',
        description: '',
        is_active: true,
        icon_id: '',
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
      icon_id: '',
    });
  };

  const handleOpenIconModal = (icon?: CustomIcon) => {
    if (icon) {
      setEditingIcon(icon);
      setIconFormData({
        name: icon.name,
        svg_code: icon.svg_code,
        preview_color: icon.preview_color,
      });
    } else {
      setEditingIcon(null);
      setIconFormData({
        name: '',
        svg_code: '',
        preview_color: '#3B82F6',
      });
    }
    setShowIconModal(true);
  };

  const handleCloseIconModal = () => {
    setShowIconModal(false);
    setEditingIcon(null);
    setIconFormData({
      name: '',
      svg_code: '',
      preview_color: '#3B82F6',
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const dataToSave = {
        ...formData,
        icon_id: formData.icon_id || null,
        updated_at: new Date().toISOString(),
      };

      if (editingCategory) {
        const { error } = await supabase
          .from('event_categories')
          .update(dataToSave)
          .eq('id', editingCategory.id);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('event_categories')
          .insert([dataToSave]);

        if (error) throw error;
      }

      await fetchCategories();
      handleCloseModal();
    } catch (error) {
      console.error('Error saving category:', error);
      alert('Błąd podczas zapisywania kategorii');
    }
  };

  const handleSubmitIcon = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const { data: { session } } = await supabase.auth.getSession();

      if (editingIcon) {
        const { error } = await supabase
          .from('custom_icons')
          .update({
            ...iconFormData,
            updated_at: new Date().toISOString(),
          })
          .eq('id', editingIcon.id);

        if (error) throw error;
        alert('Ikona została zaktualizowana!');
      } else {
        const { error } = await supabase
          .from('custom_icons')
          .insert([{
            ...iconFormData,
            created_by: session?.user?.id || null,
          }]);

        if (error) throw error;
        alert('Ikona została dodana!');
      }

      await fetchIcons();
      await fetchCategories();
      handleCloseIconModal();
    } catch (error) {
      console.error('Error saving icon:', error);
      alert('Błąd podczas zapisywania ikony: ' + (error as any).message);
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

  const handleDeleteIcon = async (id: string) => {
    if (!confirm('Czy na pewno chcesz usunąć tę ikonę?')) return;

    try {
      const { error } = await supabase
        .from('custom_icons')
        .delete()
        .eq('id', id);

      if (error) throw error;
      await fetchIcons();
    } catch (error) {
      console.error('Error deleting icon:', error);
      alert('Błąd podczas usuwania ikony');
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
    <PermissionGuard permission="event_categories_manage">
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 p-6">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-3xl font-bold text-white mb-2">Kategorie wydarzeń</h1>
              <p className="text-gray-400">Zarządzaj kategoriami i ikonami dla wydarzeń</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowIconModal(true)}
                className="flex items-center gap-2 px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
              >
                <Sparkles className="w-5 h-5" />
                Zarządzaj ikonami
              </button>
              <button
                onClick={() => handleOpenModal()}
                className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
              >
                <Plus className="w-5 h-5" />
                Nowa kategoria
              </button>
            </div>
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
                      {category.icon ? (
                        <div
                          className="w-6 h-6 text-white"
                          dangerouslySetInnerHTML={{ __html: category.icon.svg_code }}
                        />
                      ) : (
                        <Palette className="w-6 h-6 text-white" />
                      )}
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
            <div key={editingCategory?.id || 'new'} className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
              <div className="bg-gray-800 rounded-xl p-6 max-w-md w-full border border-gray-700 max-h-[90vh] overflow-y-auto">
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
                      Ikona
                    </label>
                    <div className="space-y-3">
                      <button
                        type="button"
                        onClick={() => setShowIconPicker(!showIconPicker)}
                        className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-left flex items-center justify-between hover:bg-gray-600 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          {formData.icon_id ? (
                            <>
                              <div
                                className="w-8 h-8 flex items-center justify-center rounded bg-gray-600"
                                dangerouslySetInnerHTML={{
                                  __html: icons.find((i) => i.id === formData.icon_id)?.svg_code || '',
                                }}
                              />
                              <span className="text-white">
                                {icons.find((i) => i.id === formData.icon_id)?.name || 'Wybierz ikonę'}
                              </span>
                            </>
                          ) : (
                            <>
                              <Image className="w-8 h-8 text-gray-400" />
                              <span className="text-gray-400">Wybierz ikonę (opcjonalnie)</span>
                            </>
                          )}
                        </div>
                        {formData.icon_id && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setFormData({ ...formData, icon_id: '' });
                            }}
                            className="text-red-400 hover:text-red-300"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        )}
                      </button>
                      {showIconPicker && (
                        <div className="grid grid-cols-4 gap-2 p-3 bg-gray-900 rounded-lg border border-gray-600 max-h-48 overflow-y-auto">
                          {icons.map((icon) => (
                            <button
                              key={icon.id}
                              type="button"
                              onClick={() => {
                                setFormData({ ...formData, icon_id: icon.id });
                                setShowIconPicker(false);
                              }}
                              className={`p-3 rounded-lg transition-all ${
                                formData.icon_id === icon.id
                                  ? 'bg-blue-600 scale-110'
                                  : 'bg-gray-700 hover:bg-gray-600'
                              }`}
                              title={icon.name}
                            >
                              <div
                                className="w-6 h-6 text-white mx-auto"
                                dangerouslySetInnerHTML={{ __html: icon.svg_code }}
                              />
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
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

          {showIconModal && (
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
              <div className="bg-gray-800 rounded-xl p-6 max-w-4xl w-full border border-gray-700 max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-bold text-white">Zarządzanie ikonami</h2>
                  <button
                    onClick={handleCloseIconModal}
                    className="text-gray-400 hover:text-white transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <form onSubmit={handleSubmitIcon} className="space-y-4 mb-6 p-4 bg-gray-900 rounded-lg">
                  <h3 className="text-lg font-semibold text-white mb-4">
                    {editingIcon ? 'Edytuj ikonę' : 'Dodaj nową ikonę'}
                  </h3>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Nazwa ikony *
                    </label>
                    <input
                      type="text"
                      value={iconFormData.name}
                      onChange={(e) => setIconFormData({ ...iconFormData, name: e.target.value })}
                      className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="np. Mikrofon"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Kod SVG *
                    </label>
                    <textarea
                      value={iconFormData.svg_code}
                      onChange={(e) => setIconFormData({ ...iconFormData, svg_code: e.target.value })}
                      className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
                      rows={6}
                      placeholder='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">...</svg>'
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Podgląd
                    </label>
                    <div className="flex items-center gap-4 p-4 bg-gray-700 rounded-lg">
                      {iconFormData.svg_code && (
                        <div
                          className="w-12 h-12 flex items-center justify-center rounded-lg"
                          style={{ backgroundColor: iconFormData.preview_color }}
                        >
                          <div
                            className="w-8 h-8 text-white"
                            dangerouslySetInnerHTML={{ __html: iconFormData.svg_code }}
                          />
                        </div>
                      )}
                      <div className="flex gap-3 flex-1">
                        <input
                          type="color"
                          value={iconFormData.preview_color}
                          onChange={(e) => setIconFormData({ ...iconFormData, preview_color: e.target.value })}
                          className="w-16 h-10 rounded cursor-pointer"
                        />
                        <input
                          type="text"
                          value={iconFormData.preview_color}
                          onChange={(e) => setIconFormData({ ...iconFormData, preview_color: e.target.value })}
                          className="flex-1 px-4 py-2 bg-gray-600 border border-gray-500 rounded-lg text-white"
                          placeholder="#3B82F6"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingIcon(null);
                        setIconFormData({ name: '', svg_code: '', preview_color: '#3B82F6' });
                      }}
                      className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
                    >
                      Anuluj
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                    >
                      {editingIcon ? 'Zaktualizuj' : 'Dodaj ikonę'}
                    </button>
                  </div>
                </form>

                <div className="border-t border-gray-700 pt-6">
                  <h3 className="text-lg font-semibold text-white mb-4">Dostępne ikony</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {icons.map((icon) => (
                      <div
                        key={icon.id}
                        className="bg-gray-900 border border-gray-700 rounded-lg p-4 hover:border-gray-600 transition-all"
                      >
                        <div className="flex items-center justify-between mb-3">
                          <div
                            className="w-12 h-12 flex items-center justify-center rounded-lg"
                            style={{ backgroundColor: icon.preview_color }}
                          >
                            <div
                              className="w-8 h-8 text-white"
                              dangerouslySetInnerHTML={{ __html: icon.svg_code }}
                            />
                          </div>
                          <div className="flex gap-1">
                            <button
                              type="button"
                              onClick={() => handleOpenIconModal(icon)}
                              className="p-1 text-gray-400 hover:text-blue-400 hover:bg-gray-700 rounded"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteIcon(icon.id)}
                              className="p-1 text-gray-400 hover:text-red-400 hover:bg-gray-700 rounded"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                        <p className="text-white text-sm font-medium">{icon.name}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </PermissionGuard>
  );
}
