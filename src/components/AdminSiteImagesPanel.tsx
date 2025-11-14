'use client';

import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import {
  Upload,
  Image as ImageIcon,
  Save,
  Trash2,
  Eye,
  EyeOff,
  Plus,
  CreditCard as Edit2,
  X,
} from 'lucide-react';
import { useDialog } from '../contexts/DialogContext';

interface SiteImage {
  id: string;
  section: string;
  name: string;
  description: string;
  desktop_url: string;
  mobile_url: string | null;
  alt_text: string;
  position: string;
  order_index: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export default function AdminSiteImagesPanel() {
  const [images, setImages] = useState<SiteImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSection, setSelectedSection] = useState<string>('all');
  const [editingImage, setEditingImage] = useState<SiteImage | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const { showAlert, showConfirm } = useDialog();

  const sections = [
    { value: 'all', label: 'Wszystkie sekcje' },
    { value: 'hero', label: 'Hero (Strona główna)' },
    { value: 'divider1', label: 'Divider 1' },
    { value: 'divider2', label: 'Divider 2' },
    { value: 'divider3', label: 'Divider 3' },
    { value: 'divider4', label: 'Divider 4' },
    { value: 'process', label: 'Proces' },
    { value: 'about_hero', label: 'O Nas - Hero' },
    { value: 'about_gallery1', label: 'O Nas - Galeria 1' },
    { value: 'about_gallery2', label: 'O Nas - Galeria 2' },
    { value: 'team_hero', label: 'Zespół - Hero' },
    { value: 'portfolio_hero', label: 'Portfolio - Hero' },
    { value: 'service_konferencje', label: 'Usługi - Konferencje' },
    { value: 'service_integracje', label: 'Usługi - Integracje' },
    { value: 'service_wieczory', label: 'Usługi - Wieczory Tematyczne' },
    { value: 'service_quizy', label: 'Usługi - Quizy' },
    { value: 'service_kasyno', label: 'Usługi - Kasyno' },
    { value: 'service_vr', label: 'Usługi - VR' },
    { value: 'service_technika', label: 'Usługi - Technika Sceniczna' },
    { value: 'service_naglosnienie', label: 'Usługi - Nagłośnienie' },
    { value: 'service_streaming', label: 'Usługi - Streaming' },
  ];

  useEffect(() => {
    fetchImages();
  }, [selectedSection]);

  const fetchImages = async () => {
    setLoading(true);
    try {
      let query = supabase.from('site_images').select('*').order('section').order('order_index');

      if (selectedSection !== 'all') {
        query = query.eq('section', selectedSection);
      }

      const { data, error } = await query;

      if (error) throw error;
      setImages(data || []);
    } catch (error) {
      console.error('Error fetching images:', error);
    }
    setLoading(false);
  };

  const handleSave = async () => {
    if (!editingImage) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from('site_images')
        .update({
          name: editingImage.name,
          description: editingImage.description,
          desktop_url: editingImage.desktop_url,
          mobile_url: editingImage.mobile_url,
          alt_text: editingImage.alt_text,
          position: editingImage.position,
          order_index: editingImage.order_index,
          is_active: editingImage.is_active,
        })
        .eq('id', editingImage.id);

      if (error) throw error;

      await fetchImages();
      setIsModalOpen(false);
      setEditingImage(null);
    } catch (error) {
      console.error('Error saving image:', error);
      showAlert('Wystąpił błąd podczas zapisywania obrazu', 'Błąd', 'error');
    }
    setSaving(false);
  };

  const handleCreate = async () => {
    if (!editingImage) return;

    setSaving(true);
    try {
      const { error } = await supabase.from('site_images').insert({
        section: editingImage.section,
        name: editingImage.name,
        description: editingImage.description,
        desktop_url: editingImage.desktop_url,
        mobile_url: editingImage.mobile_url,
        alt_text: editingImage.alt_text,
        position: editingImage.position,
        order_index: editingImage.order_index,
        is_active: editingImage.is_active,
      });

      if (error) throw error;

      await fetchImages();
      setIsModalOpen(false);
      setEditingImage(null);
    } catch (error) {
      console.error('Error creating image:', error);
      showAlert('Wystąpił błąd podczas tworzenia obrazu', 'Błąd', 'error');
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    const confirmed = await showConfirm('Czy na pewno chcesz usunąć ten obraz?', 'Usuń obraz');
    if (!confirmed) return;

    try {
      const { error } = await supabase.from('site_images').delete().eq('id', id);

      if (error) throw error;
      await fetchImages();
    } catch (error) {
      console.error('Error deleting image:', error);
      showAlert('Wystąpił błąd podczas usuwania obrazu', 'Błąd', 'error');
    }
  };

  const toggleActive = async (image: SiteImage) => {
    try {
      const { error } = await supabase
        .from('site_images')
        .update({ is_active: !image.is_active })
        .eq('id', image.id);

      if (error) throw error;
      await fetchImages();
    } catch (error) {
      console.error('Error toggling active status:', error);
    }
  };

  const openEditModal = (image: SiteImage) => {
    setEditingImage({ ...image });
    setIsModalOpen(true);
  };

  const openCreateModal = () => {
    setEditingImage({
      id: '',
      section: selectedSection !== 'all' ? selectedSection : 'hero',
      name: '',
      description: '',
      desktop_url: '',
      mobile_url: '',
      alt_text: '',
      position: 'center',
      order_index: 0,
      is_active: true,
      created_at: '',
      updated_at: '',
    });
    setIsModalOpen(true);
  };

  const filteredImages = images;

  return (
    <div className="min-h-screen bg-[#0f1119] text-[#e5e4e2]">
      <div className="mx-auto max-w-7xl p-6">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="mb-2 text-3xl font-light text-[#e5e4e2]">Zarządzanie Obrazami Strony</h1>
            <p className="text-[#e5e4e2]/60">
              Edytuj obrazy wyświetlane na stronie głównej i podstronach
            </p>
          </div>
          <button
            onClick={openCreateModal}
            className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-3 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
          >
            <Plus className="h-5 w-5" />
            Dodaj Obraz
          </button>
        </div>

        <div className="mb-6">
          <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
            Filtruj po sekcji:
          </label>
          <select
            value={selectedSection}
            onChange={(e) => setSelectedSection(e.target.value)}
            className="w-full max-w-md rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
          >
            {sections.map((section) => (
              <option key={section.value} value={section.value}>
                {section.label}
              </option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-[#d3bb73]">Ładowanie...</div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {filteredImages.map((image) => (
              <div
                key={image.id}
                className="overflow-hidden rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33]"
              >
                <div className="relative aspect-video bg-[#0f1119]">
                  <img
                    src={image.desktop_url}
                    alt={image.alt_text}
                    className="h-full w-full object-cover"
                  />
                  <div className="absolute right-2 top-2 flex gap-2">
                    <button
                      onClick={() => toggleActive(image)}
                      className={`rounded-lg p-2 backdrop-blur-sm ${
                        image.is_active
                          ? 'bg-green-500/80 hover:bg-green-500'
                          : 'bg-gray-500/80 hover:bg-gray-500'
                      } transition-colors`}
                      title={image.is_active ? 'Aktywny' : 'Nieaktywny'}
                    >
                      {image.is_active ? (
                        <Eye className="h-4 w-4 text-white" />
                      ) : (
                        <EyeOff className="h-4 w-4 text-white" />
                      )}
                    </button>
                  </div>
                </div>
                <div className="p-4">
                  <div className="mb-2 flex items-start justify-between">
                    <div>
                      <h3 className="text-lg font-medium text-[#e5e4e2]">{image.name}</h3>
                      <p className="text-xs text-[#d3bb73]">
                        {sections.find((s) => s.value === image.section)?.label || image.section}
                      </p>
                    </div>
                  </div>
                  {image.description && (
                    <p className="mb-3 text-sm text-[#e5e4e2]/60">{image.description}</p>
                  )}
                  <div className="mb-3 flex items-center gap-2">
                    <span className="rounded bg-[#d3bb73]/20 px-2 py-1 text-xs text-[#d3bb73]">
                      Desktop: {image.desktop_url ? 'Tak' : 'Brak'}
                    </span>
                    <span className="rounded bg-[#d3bb73]/20 px-2 py-1 text-xs text-[#d3bb73]">
                      Mobile: {image.mobile_url ? 'Tak' : 'Brak'}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => openEditModal(image)}
                      className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#d3bb73]/20 px-4 py-2 text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/30"
                    >
                      <Edit2 className="h-4 w-4" />
                      Edytuj
                    </button>
                    <button
                      onClick={() => handleDelete(image.id)}
                      className="flex items-center justify-center gap-2 rounded-lg bg-red-500/20 px-4 py-2 text-red-400 transition-colors hover:bg-red-500/30"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && filteredImages.length === 0 && (
          <div className="py-12 text-center text-[#e5e4e2]/60">Brak obrazów w tej sekcji</div>
        )}
      </div>

      {isModalOpen && editingImage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-[#1c1f33]">
            <div className="sticky top-0 flex items-center justify-between border-b border-[#d3bb73]/20 bg-[#1c1f33] p-6">
              <h2 className="text-2xl font-light text-[#e5e4e2]">
                {editingImage.id ? 'Edytuj Obraz' : 'Dodaj Nowy Obraz'}
              </h2>
              <button
                onClick={() => {
                  setIsModalOpen(false);
                  setEditingImage(null);
                }}
                className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            <div className="space-y-4 p-6">
              <div>
                <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Sekcja</label>
                <select
                  value={editingImage.section}
                  onChange={(e) => setEditingImage({ ...editingImage, section: e.target.value })}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                >
                  {sections.slice(1).map((section) => (
                    <option key={section.value} value={section.value}>
                      {section.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Nazwa</label>
                <input
                  type="text"
                  value={editingImage.name}
                  onChange={(e) => setEditingImage({ ...editingImage, name: e.target.value })}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                  placeholder="Np. Hero Background"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Opis</label>
                <textarea
                  value={editingImage.description}
                  onChange={(e) =>
                    setEditingImage({ ...editingImage, description: e.target.value })
                  }
                  className="min-h-20 w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                  placeholder="Opis użycia obrazu"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">URL Desktop</label>
                <input
                  type="text"
                  value={editingImage.desktop_url}
                  onChange={(e) =>
                    setEditingImage({ ...editingImage, desktop_url: e.target.value })
                  }
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                  placeholder="https://images.pexels.com/..."
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                  URL Mobile (opcjonalnie)
                </label>
                <input
                  type="text"
                  value={editingImage.mobile_url || ''}
                  onChange={(e) => setEditingImage({ ...editingImage, mobile_url: e.target.value })}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                  placeholder="https://images.pexels.com/..."
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                  Tekst alternatywny (ALT)
                </label>
                <input
                  type="text"
                  value={editingImage.alt_text}
                  onChange={(e) => setEditingImage({ ...editingImage, alt_text: e.target.value })}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                  placeholder="Opis obrazu dla dostępności"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Pozycja</label>
                  <select
                    value={editingImage.position}
                    onChange={(e) => setEditingImage({ ...editingImage, position: e.target.value })}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                  >
                    <option value="center">Center</option>
                    <option value="top">Top</option>
                    <option value="bottom">Bottom</option>
                    <option value="left">Left</option>
                    <option value="right">Right</option>
                    <option value="cover">Cover</option>
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Kolejność</label>
                  <input
                    type="number"
                    value={editingImage.order_index}
                    onChange={(e) =>
                      setEditingImage({ ...editingImage, order_index: parseInt(e.target.value) })
                    }
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="is_active"
                  checked={editingImage.is_active}
                  onChange={(e) =>
                    setEditingImage({ ...editingImage, is_active: e.target.checked })
                  }
                  className="h-4 w-4 rounded border-[#d3bb73]/20 bg-[#0f1119] text-[#d3bb73] focus:ring-[#d3bb73]"
                />
                <label htmlFor="is_active" className="text-sm text-[#e5e4e2]">
                  Aktywny (widoczny na stronie)
                </label>
              </div>

              {editingImage.desktop_url && (
                <div>
                  <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                    Podgląd Desktop
                  </label>
                  <div className="aspect-video overflow-hidden rounded-lg bg-[#0f1119]">
                    <img
                      src={editingImage.desktop_url}
                      alt="Preview"
                      className="h-full w-full object-cover"
                    />
                  </div>
                </div>
              )}

              {editingImage.mobile_url && (
                <div>
                  <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                    Podgląd Mobile
                  </label>
                  <div className="aspect-video max-w-xs overflow-hidden rounded-lg bg-[#0f1119]">
                    <img
                      src={editingImage.mobile_url}
                      alt="Preview Mobile"
                      className="h-full w-full object-cover"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="sticky bottom-0 flex gap-3 border-t border-[#d3bb73]/20 bg-[#1c1f33] p-6">
              <button
                onClick={() => {
                  setIsModalOpen(false);
                  setEditingImage(null);
                }}
                className="flex-1 rounded-lg bg-[#e5e4e2]/10 px-6 py-3 text-[#e5e4e2] transition-colors hover:bg-[#e5e4e2]/20"
              >
                Anuluj
              </button>
              <button
                onClick={editingImage.id ? handleSave : handleCreate}
                disabled={saving}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-3 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:opacity-50"
              >
                {saving ? (
                  'Zapisywanie...'
                ) : (
                  <>
                    <Save className="h-5 w-5" />
                    {editingImage.id ? 'Zapisz Zmiany' : 'Utwórz Obraz'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
