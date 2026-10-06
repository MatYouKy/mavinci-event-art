'use client';

import { useState, useEffect } from 'react';
import { Plus, Pencil, Trash2, X, Palette, Image, Sparkles } from 'lucide-react';
import PermissionGuard from '@/components/crm/PermissionGuard';
import { ICustomIcon, IEventCategory } from './types';
import { useEventCategories } from './hook/useEventCategories';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';

export default function EventCategoriesPage() {
  const {
    categories,
    isLoading,
    icons,
    contractTemplates,
    offerTemplateCategories,
    deleteCategory,
    deleteIcon,
    upsertIcon,
    upsertCategory,
  } = useEventCategories();

  const { showConfirm } = useDialog();
  const { showSnackbar } = useSnackbar();

  const [showModal, setShowModal] = useState(false);
  const [showIconModal, setShowIconModal] = useState(false);
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [editingCategory, setEditingCategory] = useState<IEventCategory | null>(null);
  const [editingIcon, setEditingIcon] = useState<ICustomIcon | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    color: '#3B82F6',
    description: '',
    is_active: true,
    icon_id: '',
    contract_template_id: '',
    default_offer_template_category_id: '',
  });
  const [iconFormData, setIconFormData] = useState<ICustomIcon>({
    name: '',
    svg_code: '',
    preview_color: '#3B82F6',
    id: '',
  });

  useEffect(() => {
    if (editingCategory) {
      setFormData({
        name: editingCategory.name,
        color: editingCategory.color,
        description: editingCategory.description || '',
        is_active: editingCategory.is_active,
        icon_id: editingCategory.icon_id || '',
        contract_template_id: editingCategory.contract_template_id || '',
        default_offer_template_category_id:
          (editingCategory as any).default_offer_template_category_id || '',
      });
    }
  }, [editingCategory]);

  const handleOpenModal = (category?: IEventCategory) => {
    if (category) {
      setEditingCategory(category);
      setFormData({
        name: category.name,
        color: category.color,
        description: category.description || '',
        is_active: category.is_active,
        icon_id: category.icon_id || '',
        contract_template_id: category.contract_template_id || '',
        default_offer_template_category_id:
          (category as any).default_offer_template_category_id || '',
      });
    } else {
      setEditingCategory(null);
      setFormData({
        name: '',
        color: '#3B82F6',
        description: '',
        is_active: true,
        icon_id: '',
        contract_template_id: '',
        default_offer_template_category_id: '',
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
      contract_template_id: '',
      default_offer_template_category_id: '',
    });
  };

  const handleOpenIconModal = (icon?: ICustomIcon) => {
    if (icon) {
      setEditingIcon(icon);
      setIconFormData({
        name: icon.name,
        svg_code: icon.svg_code,
        preview_color: icon.preview_color || '#3B82F6',
        id: icon.id,
      } as ICustomIcon);
    } else {
      setEditingIcon(null);
      setIconFormData({
        name: '',
        svg_code: '',
        preview_color: '#3B82F6',
        id: '',
      } as ICustomIcon);
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
      id: '',
    } as ICustomIcon);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      await upsertCategory(
        {
          ...formData,
          icon_id: formData.icon_id || null,
          contract_template_id: formData.contract_template_id || null,
          default_offer_template_category_id: formData.default_offer_template_category_id || null,
        },
        editingCategory?.id ?? null,
      );

      showSnackbar(editingCategory ? 'Kategoria zaktualizowana!' : 'Kategoria utworzona!', 'info');
      handleCloseModal();
    } catch (error: any) {
      console.error('Error saving category:', error);
      showSnackbar(
        `Błąd: ${error?.message || 'Nieznany błąd'}\n\nKod: ${error?.code || 'brak'}`,
        'error',
      );
    }
  };

  const handleSubmitIcon = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      await upsertIcon(
        {
          ...iconFormData,
          preview_color: iconFormData.preview_color || '#3B82F6',
        },
        editingIcon?.id ?? null,
      );

      showSnackbar(editingIcon ? 'Ikona została zaktualizowana!' : 'Ikona została dodana!', 'info');
      handleCloseIconModal();
    } catch (error: any) {
      console.error('Error saving icon:', error);
      showSnackbar(
        `Błąd: ${error?.message || 'Nieznany błąd'}\n\nKod: ${error?.code || 'brak'}`,
        'error',
      );
    }
  };

  const handleDelete = async (id: string) => {
    if (!(await showConfirm('Czy na pewno chcesz usunąć tę kategorię?'))) return;

    try {
      await deleteCategory(id);
      showSnackbar('Kategoria została usunięta!', 'info');
    } catch (error: any) {
      console.error('Error deleting category:', error);
      showSnackbar(
        `Błąd: ${error?.message || 'Nieznany błąd'}\n\nKod: ${error?.code || 'brak'}\n\nSprawdź konsolę (F12)`,
        'error',
      );
    }
  };

  const handleDeleteIcon = async (id: string) => {
    if (!(await showConfirm('Czy na pewno chcesz usunąć tę ikonę?'))) return;

    try {
      await deleteIcon(id);
      showSnackbar('Ikona została usunięta!', 'info');
    } catch (error: any) {
      console.error('Error deleting icon:', error);
      showSnackbar(
        `Błąd: ${error?.message || 'Nieznany błąd'}\n\nKod: ${error?.code || 'brak'}\n\nSprawdź konsolę (F12)`,
        'error',
      );
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-[#d3bb73]"></div>
      </div>
    );
  }

  return (
    <PermissionGuard permission="event_categories_manage">
      <div className="min-h-screen bg-[var(--brand-burgundy-950)] text-[var(--brand-platinum)] p-6">
        <div className="mx-auto max-w-6xl">
          <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="mb-2 text-3xl font-bold text-white">Kategorie wydarzeń</h1>
              <p className="text-[var(--brand-platinum)]/60">Zarządzaj kategoriami i ikonami dla wydarzeń</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => setShowIconModal(true)}
                className="flex items-center gap-2 rounded-lg bg-[var(--brand-burgundy-900)] px-6 py-3 text-white transition-colors hover:bg-[var(--brand-burgundy-750)]"
              >
                <Sparkles className="h-5 w-5" />
                Zarządzaj ikonami
              </button>
              <button
                onClick={() => handleOpenModal()}
                className="flex items-center gap-2 rounded-lg bg-[var(--brand-gold)] px-6 py-3 text-[var(--brand-burgundy-950)] transition-colors hover:bg-[var(--brand-gold-hover)]"
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
                className="rounded-lg border border-white/10 bg-[var(--brand-burgundy-800)] p-6 backdrop-blur-sm transition-all hover:border-white/15"
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
                      <span className="text-xs text-[var(--brand-platinum)]/60">{category.color}</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleOpenModal(category)}
                      className="rounded p-2 text-[var(--brand-platinum)]/60 transition-colors hover:bg-[var(--brand-burgundy-750)] hover:text-[var(--brand-gold)]"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(category.id)}
                      className="rounded p-2 text-[var(--brand-platinum)]/60 transition-colors hover:bg-[var(--brand-burgundy-750)] hover:text-red-400"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                {category.description && (
                  <p className="mb-3 text-sm text-[var(--brand-platinum)]/60">{category.description}</p>
                )}
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      category.is_active
                        ? 'bg-green-500/20 text-green-400'
                        : 'bg-white/5 text-[var(--brand-platinum)]/60'
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
              <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-white/10 bg-[var(--brand-burgundy-800)] p-6">
                <div className="mb-6 flex items-center justify-between">
                  <h2 className="text-xl font-bold text-white">
                    {editingCategory ? 'Edytuj kategorię' : 'Nowa kategoria'}
                  </h2>
                  <button
                    onClick={handleCloseModal}
                    className="text-[var(--brand-platinum)]/60 transition-colors hover:text-white"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-[var(--brand-platinum)]/80">
                      Nazwa kategorii *
                    </label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full rounded-lg border border-[var(--app-field-border)] bg-[var(--brand-burgundy-900)] px-4 py-2 text-white outline-none focus:border-[var(--app-field-border-focus)]"
                      required
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-[var(--brand-platinum)]/80">Ikona</label>
                    <div className="space-y-3">
                      <button
                        type="button"
                        onClick={() => setShowIconPicker(!showIconPicker)}
                        className="flex w-full items-center justify-between rounded-lg border border-[var(--app-field-border)] bg-[var(--brand-burgundy-900)] px-4 py-3 text-left transition-colors hover:bg-[var(--brand-burgundy-750)]"
                      >
                        <div className="flex items-center gap-3">
                          {formData.icon_id ? (
                            <>
                              <div
                                className="flex h-8 w-8 items-center justify-center rounded bg-[var(--brand-burgundy-900)]"
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
                              <Image className="h-8 w-8 text-[var(--brand-platinum)]/60" />
                              <span className="text-[var(--brand-platinum)]/60">Wybierz ikonę (opcjonalnie)</span>
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
                        <div className="grid max-h-48 grid-cols-4 gap-2 overflow-y-auto rounded-lg border border-[var(--app-field-border)] bg-[var(--brand-burgundy-950)] p-3">
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
                                  ? 'bg-[var(--brand-burgundy-750)] ring-1 ring-inset ring-[var(--brand-gold)]/30'
                                  : 'bg-[var(--brand-burgundy-900)] hover:bg-[var(--brand-burgundy-750)]'
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
                    <label className="mb-2 block text-sm font-medium text-[var(--brand-platinum)]/80">Kolor *</label>
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
                        className="flex-1 rounded-lg border border-[var(--app-field-border)] bg-[var(--brand-burgundy-900)] px-4 py-2 text-white outline-none focus:border-[var(--app-field-border-focus)]"
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
                          className={`h-8 w-full rounded border transition-all ${
                            formData.color === color
                              ? 'border-[var(--brand-gold)]/40 brightness-125'
                              : 'border-transparent'
                          }`}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-[var(--brand-platinum)]/80">Opis</label>
                    <textarea
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      className="w-full rounded-lg border border-[var(--app-field-border)] bg-[var(--brand-burgundy-900)] px-4 py-2 text-white outline-none focus:border-[var(--app-field-border-focus)]"
                      rows={3}
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-[var(--brand-platinum)]/80">
                      Szablon oferty (opcjonalnie)
                    </label>
                    <select
                      value={formData.default_offer_template_category_id}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          default_offer_template_category_id: e.target.value,
                        })
                      }
                      className="w-full rounded-lg border border-[var(--app-field-border)] bg-[var(--brand-burgundy-900)] px-4 py-2 text-white outline-none focus:border-[var(--app-field-border-focus)]"
                    >
                      <option value="">Domyślny szablon</option>
                      {offerTemplateCategories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-[var(--brand-platinum)]/80">
                      Szablon umowy (opcjonalnie)
                    </label>
                    <select
                      value={formData.contract_template_id}
                      onChange={(e) =>
                        setFormData({ ...formData, contract_template_id: e.target.value })
                      }
                      className="w-full rounded-lg border border-[var(--app-field-border)] bg-[var(--brand-burgundy-900)] px-4 py-2 text-white outline-none focus:border-[var(--app-field-border-focus)]"
                    >
                      <option value="">Brak szablonu</option>
                      {contractTemplates.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      id="is_active"
                      checked={formData.is_active}
                      onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                      className="h-4 w-4 rounded border-[var(--app-field-border)] accent-[var(--brand-gold)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--brand-gold)]"
                    />
                    <label htmlFor="is_active" className="text-sm text-[var(--brand-platinum)]/80">
                      Kategoria aktywna
                    </label>
                  </div>

                  <div className="flex gap-3 pt-4">
                    <button
                      type="button"
                      onClick={handleCloseModal}
                      className="flex-1 rounded-lg bg-[var(--brand-burgundy-900)] px-4 py-2 text-white transition-colors hover:bg-[var(--brand-burgundy-750)]"
                    >
                      Anuluj
                    </button>
                    <button
                      type="submit"
                      className="flex-1 rounded-lg bg-[var(--brand-gold)] px-4 py-2 text-[var(--brand-burgundy-950)] transition-colors hover:bg-[var(--brand-gold-hover)]"
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
              <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-xl border border-white/10 bg-[var(--brand-burgundy-800)] p-6">
                <div className="mb-6 flex items-center justify-between">
                  <h2 className="text-xl font-bold text-white">Zarządzanie ikonami</h2>
                  <button
                    onClick={handleCloseIconModal}
                    className="text-[var(--brand-platinum)]/60 transition-colors hover:text-white"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <form
                  onSubmit={handleSubmitIcon}
                  className="mb-6 space-y-4 rounded-lg bg-[var(--brand-burgundy-950)] p-4"
                >
                  <h3 className="mb-4 text-lg font-semibold text-white">
                    {editingIcon ? 'Edytuj ikonę' : 'Dodaj nową ikonę'}
                  </h3>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-[var(--brand-platinum)]/80">
                      Nazwa ikony *
                    </label>
                    <input
                      type="text"
                      value={iconFormData.name}
                      onChange={(e) => setIconFormData({ ...iconFormData, name: e.target.value })}
                      className="w-full rounded-lg border border-[var(--app-field-border)] bg-[var(--brand-burgundy-900)] px-4 py-2 text-white outline-none focus:border-[var(--app-field-border-focus)]"
                      placeholder="np. Mikrofon"
                      required
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-[var(--brand-platinum)]/80">
                      Kod SVG *
                    </label>
                    <textarea
                      value={iconFormData.svg_code}
                      onChange={(e) =>
                        setIconFormData({ ...iconFormData, svg_code: e.target.value })
                      }
                      className="w-full rounded-lg border border-[var(--app-field-border)] bg-[var(--brand-burgundy-900)] px-4 py-2 font-mono text-sm text-white outline-none focus:border-[var(--app-field-border-focus)]"
                      rows={6}
                      placeholder='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">...</svg>'
                      required
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-[var(--brand-platinum)]/80">Podgląd</label>
                    <div className="flex items-center gap-4 rounded-lg bg-[var(--brand-burgundy-900)] p-4">
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
                          className="flex-1 rounded-lg border border-[var(--app-field-border)] bg-[var(--brand-burgundy-900)] px-4 py-2 text-white"
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
                        setIconFormData({
                          name: '',
                          svg_code: '',
                          preview_color: '#3B82F6',
                          id: '',
                        } as ICustomIcon);
                      }}
                      className="rounded-lg bg-[var(--brand-burgundy-900)] px-4 py-2 text-white transition-colors hover:bg-[var(--brand-burgundy-750)]"
                    >
                      Anuluj
                    </button>
                    <button
                      type="submit"
                      className="rounded-lg bg-[var(--brand-gold)] px-4 py-2 text-[var(--brand-burgundy-950)] transition-colors hover:bg-[var(--brand-gold-hover)]"
                    >
                      {editingIcon ? 'Zaktualizuj' : 'Dodaj ikonę'}
                    </button>
                  </div>
                </form>

                <div className="border-t border-white/10 pt-6">
                  <h3 className="mb-4 text-lg font-semibold text-white">Dostępne ikony</h3>
                  <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                    {icons.map((icon) => (
                      <div
                        key={icon.id}
                        className="rounded-lg border border-white/10 bg-[var(--brand-burgundy-950)] p-4 transition-all hover:border-white/15"
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
                              className="rounded p-1 text-[var(--brand-platinum)]/60 hover:bg-[var(--brand-burgundy-750)] hover:text-[var(--brand-gold)]"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteIcon(icon.id)}
                              className="rounded p-1 text-[var(--brand-platinum)]/60 hover:bg-[var(--brand-burgundy-750)] hover:text-red-400"
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
