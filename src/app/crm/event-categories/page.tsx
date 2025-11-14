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
        .select(
          `
          *,
          icon:custom_icons(id, name, svg_code, preview_color)
        `,
        )
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
      const { data, error } = await supabase.from('custom_icons').select('*').order('name');

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
        const { error } = await supabase.from('event_categories').insert([dataToSave]);

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
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.refreshSession();

      if (sessionError || !session?.user?.id) {
        throw new Error('Nie można odświeżyć sesji. Zaloguj się ponownie.');
      }


      const { data: employee, error: employeeError } = await supabase
        .from('employees')
        .select('id, name, surname, permissions')
        .eq('id', session.user.id)
        .maybeSingle();

      console.log('Employee data:', employee);
      console.log(
        'Has event_categories_manage?',
        employee?.permissions?.includes('event_categories_manage'),
      );

      if (!employee) {
        throw new Error('Nie znaleziono danych pracownika');
      }

      if (!employee.permissions?.includes('event_categories_manage')) {
        throw new Error(
          'Brak uprawnień: event_categories_manage. Skontaktuj się z administratorem.',
        );
      }

      if (editingIcon) {
        console.log('Updating icon:', editingIcon.id, iconFormData);

        const { data, error } = await supabase
          .from('custom_icons')
          .update({
            name: iconFormData.name,
            svg_code: iconFormData.svg_code,
            preview_color: iconFormData.preview_color,
            updated_at: new Date().toISOString(),
          })
          .eq('id', editingIcon.id)
          .select();

        if (error) {
          console.error('Update error:', error);
          throw error;
        }

        console.log('Update result:', data);
        alert('Ikona została zaktualizowana!');
      } else {
        console.log('Creating icon:', iconFormData);

        const { data, error } = await supabase
          .from('custom_icons')
          .insert([
            {
              name: iconFormData.name,
              svg_code: iconFormData.svg_code,
              preview_color: iconFormData.preview_color,
              created_by: session.user.id,
            },
          ])
          .select();

        if (error) {
          console.error('Insert error:', error);
          throw error;
        }

        console.log('Insert result:', data);
        alert('Ikona została dodana!');
      }

      await fetchIcons();
      await fetchCategories();
      handleCloseIconModal();
    } catch (error: any) {
      console.error('Error saving icon:', error);
      alert(
        `Błąd: ${error?.message || 'Nieznany błąd'}\n\nKod: ${error?.code || 'brak'}\n\nSprawdź konsolę (F12)`,
      );
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Czy na pewno chcesz usunąć tę kategorię?')) return;

    try {
      const { error } = await supabase.from('event_categories').delete().eq('id', id);

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
      const { error } = await supabase.from('custom_icons').delete().eq('id', id);

      if (error) throw error;
      await fetchIcons();
    } catch (error) {
      console.error('Error deleting icon:', error);
      alert('Błąd podczas usuwania ikony');
    }
  };

  const presetColors = [
    '#EF4444',
    '#F59E0B',
    '#10B981',
    '#3B82F6',
    '#8B5CF6',
    '#EC4899',
    '#6B7280',
    '#14B8A6',
    '#F97316',
    '#84CC16',
  ];

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-gray-400">Ładowanie...</div>
      </div>
    );
  }

  return (
    <PermissionGuard permission="event_categories_manage">
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 p-6">
        <div className="mx-auto max-w-6xl">
          <div className="mb-8 flex items-center justify-between">
            <div>
              <h1 className="mb-2 text-3xl font-bold text-white">Kategorie wydarzeń</h1>
              <p className="text-gray-400">Zarządzaj kategoriami i ikonami dla wydarzeń</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowIconModal(true)}
                className="flex items-center gap-2 rounded-lg bg-gray-700 px-6 py-3 text-white transition-colors hover:bg-gray-600"
              >
                <Sparkles className="h-5 w-5" />
                Zarządzaj ikonami
              </button>
              <button
                onClick={() => handleOpenModal()}
                className="flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-3 text-white transition-colors hover:bg-blue-700"
              >
                <Plus className="h-5 w-5" />
                Nowa kategoria
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {categories.map((category) => (
              <div
                key={category.id}
                className="rounded-lg border border-gray-700 bg-gray-800/50 p-6 backdrop-blur-sm transition-all hover:border-gray-600"
              >
                <div className="mb-4 flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className="flex h-12 w-12 items-center justify-center rounded-lg"
                      style={{ backgroundColor: category.color }}
                    >
                      {category.icon ? (
                        <div
                          className="h-6 w-6 text-white"
                          dangerouslySetInnerHTML={{ __html: category.icon.svg_code }}
                        />
                      ) : (
                        <Palette className="h-6 w-6 text-white" />
                      )}
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-white">{category.name}</h3>
                      <span className="text-xs text-gray-400">{category.color}</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleOpenModal(category)}
                      className="rounded p-2 text-gray-400 transition-colors hover:bg-gray-700 hover:text-blue-400"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(category.id)}
                      className="rounded p-2 text-gray-400 transition-colors hover:bg-gray-700 hover:text-red-400"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                {category.description && (
                  <p className="mb-3 text-sm text-gray-400">{category.description}</p>
                )}
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
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
            <div
              key={editingCategory?.id || 'new'}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
            >
              <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-gray-700 bg-gray-800 p-6">
                <div className="mb-6 flex items-center justify-between">
                  <h2 className="text-xl font-bold text-white">
                    {editingCategory ? 'Edytuj kategorię' : 'Nowa kategoria'}
                  </h2>
                  <button
                    onClick={handleCloseModal}
                    className="text-gray-400 transition-colors hover:text-white"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-gray-300">
                      Nazwa kategorii *
                    </label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full rounded-lg border border-gray-600 bg-gray-700 px-4 py-2 text-white focus:border-transparent focus:ring-2 focus:ring-blue-500"
                      required
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-gray-300">Ikona</label>
                    <div className="space-y-3">
                      <button
                        type="button"
                        onClick={() => setShowIconPicker(!showIconPicker)}
                        className="flex w-full items-center justify-between rounded-lg border border-gray-600 bg-gray-700 px-4 py-3 text-left transition-colors hover:bg-gray-600"
                      >
                        <div className="flex items-center gap-3">
                          {formData.icon_id ? (
                            <>
                              <div
                                className="flex h-8 w-8 items-center justify-center rounded bg-gray-600"
                                dangerouslySetInnerHTML={{
                                  __html:
                                    icons.find((i) => i.id === formData.icon_id)?.svg_code || '',
                                }}
                              />
                              <span className="text-white">
                                {icons.find((i) => i.id === formData.icon_id)?.name ||
                                  'Wybierz ikonę'}
                              </span>
                            </>
                          ) : (
                            <>
                              <Image className="h-8 w-8 text-gray-400" />
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
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </button>
                      {showIconPicker && (
                        <div className="grid max-h-48 grid-cols-4 gap-2 overflow-y-auto rounded-lg border border-gray-600 bg-gray-900 p-3">
                          {icons.map((icon) => (
                            <button
                              key={icon.id}
                              type="button"
                              onClick={() => {
                                setFormData({ ...formData, icon_id: icon.id });
                                setShowIconPicker(false);
                              }}
                              className={`rounded-lg p-3 transition-all ${
                                formData.icon_id === icon.id
                                  ? 'scale-110 bg-blue-600'
                                  : 'bg-gray-700 hover:bg-gray-600'
                              }`}
                              title={icon.name}
                            >
                              <div
                                className="mx-auto h-6 w-6 text-white"
                                dangerouslySetInnerHTML={{ __html: icon.svg_code }}
                              />
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-gray-300">Kolor *</label>
                    <div className="mb-3 flex gap-3">
                      <input
                        type="color"
                        value={formData.color}
                        onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                        className="h-10 w-16 cursor-pointer rounded"
                      />
                      <input
                        type="text"
                        value={formData.color}
                        onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                        className="flex-1 rounded-lg border border-gray-600 bg-gray-700 px-4 py-2 text-white focus:border-transparent focus:ring-2 focus:ring-blue-500"
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
                          className={`h-8 w-full rounded border-2 transition-all ${
                            formData.color === color
                              ? 'scale-110 border-white'
                              : 'border-transparent'
                          }`}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-gray-300">Opis</label>
                    <textarea
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      className="w-full rounded-lg border border-gray-600 bg-gray-700 px-4 py-2 text-white focus:border-transparent focus:ring-2 focus:ring-blue-500"
                      rows={3}
                    />
                  </div>

                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      id="is_active"
                      checked={formData.is_active}
                      onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                      className="h-4 w-4 rounded border-gray-600 text-blue-600 focus:ring-blue-500"
                    />
                    <label htmlFor="is_active" className="text-sm text-gray-300">
                      Kategoria aktywna
                    </label>
                  </div>

                  <div className="flex gap-3 pt-4">
                    <button
                      type="button"
                      onClick={handleCloseModal}
                      className="flex-1 rounded-lg bg-gray-700 px-4 py-2 text-white transition-colors hover:bg-gray-600"
                    >
                      Anuluj
                    </button>
                    <button
                      type="submit"
                      className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-white transition-colors hover:bg-blue-700"
                    >
                      {editingCategory ? 'Zapisz' : 'Utwórz'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {showIconModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
              <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-xl border border-gray-700 bg-gray-800 p-6">
                <div className="mb-6 flex items-center justify-between">
                  <h2 className="text-xl font-bold text-white">Zarządzanie ikonami</h2>
                  <button
                    onClick={handleCloseIconModal}
                    className="text-gray-400 transition-colors hover:text-white"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <form
                  onSubmit={handleSubmitIcon}
                  className="mb-6 space-y-4 rounded-lg bg-gray-900 p-4"
                >
                  <h3 className="mb-4 text-lg font-semibold text-white">
                    {editingIcon ? 'Edytuj ikonę' : 'Dodaj nową ikonę'}
                  </h3>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-gray-300">
                      Nazwa ikony *
                    </label>
                    <input
                      type="text"
                      value={iconFormData.name}
                      onChange={(e) => setIconFormData({ ...iconFormData, name: e.target.value })}
                      className="w-full rounded-lg border border-gray-600 bg-gray-700 px-4 py-2 text-white focus:border-transparent focus:ring-2 focus:ring-blue-500"
                      placeholder="np. Mikrofon"
                      required
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-gray-300">
                      Kod SVG *
                    </label>
                    <textarea
                      value={iconFormData.svg_code}
                      onChange={(e) =>
                        setIconFormData({ ...iconFormData, svg_code: e.target.value })
                      }
                      className="w-full rounded-lg border border-gray-600 bg-gray-700 px-4 py-2 font-mono text-sm text-white focus:border-transparent focus:ring-2 focus:ring-blue-500"
                      rows={6}
                      placeholder='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">...</svg>'
                      required
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-gray-300">Podgląd</label>
                    <div className="flex items-center gap-4 rounded-lg bg-gray-700 p-4">
                      {iconFormData.svg_code && (
                        <div
                          className="flex h-12 w-12 items-center justify-center rounded-lg"
                          style={{ backgroundColor: iconFormData.preview_color }}
                        >
                          <div
                            className="h-8 w-8 text-white"
                            dangerouslySetInnerHTML={{ __html: iconFormData.svg_code }}
                          />
                        </div>
                      )}
                      <div className="flex flex-1 gap-3">
                        <input
                          type="color"
                          value={iconFormData.preview_color}
                          onChange={(e) =>
                            setIconFormData({ ...iconFormData, preview_color: e.target.value })
                          }
                          className="h-10 w-16 cursor-pointer rounded"
                        />
                        <input
                          type="text"
                          value={iconFormData.preview_color}
                          onChange={(e) =>
                            setIconFormData({ ...iconFormData, preview_color: e.target.value })
                          }
                          className="flex-1 rounded-lg border border-gray-500 bg-gray-600 px-4 py-2 text-white"
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
                      className="rounded-lg bg-gray-700 px-4 py-2 text-white transition-colors hover:bg-gray-600"
                    >
                      Anuluj
                    </button>
                    <button
                      type="submit"
                      className="rounded-lg bg-blue-600 px-4 py-2 text-white transition-colors hover:bg-blue-700"
                    >
                      {editingIcon ? 'Zaktualizuj' : 'Dodaj ikonę'}
                    </button>
                  </div>
                </form>

                <div className="border-t border-gray-700 pt-6">
                  <h3 className="mb-4 text-lg font-semibold text-white">Dostępne ikony</h3>
                  <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                    {icons.map((icon) => (
                      <div
                        key={icon.id}
                        className="rounded-lg border border-gray-700 bg-gray-900 p-4 transition-all hover:border-gray-600"
                      >
                        <div className="mb-3 flex items-center justify-between">
                          <div
                            className="flex h-12 w-12 items-center justify-center rounded-lg"
                            style={{ backgroundColor: icon.preview_color }}
                          >
                            <div
                              className="h-8 w-8 text-white"
                              dangerouslySetInnerHTML={{ __html: icon.svg_code }}
                            />
                          </div>
                          <div className="flex gap-1">
                            <button
                              type="button"
                              onClick={() => handleOpenIconModal(icon)}
                              className="rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-blue-400"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteIcon(icon.id)}
                              className="rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-red-400"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                        <p className="text-sm font-medium text-white">{icon.name}</p>
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
