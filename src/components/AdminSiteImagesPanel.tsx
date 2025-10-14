'use client';

import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Upload, Image as ImageIcon, Save, Trash2, Eye, EyeOff, Plus, CreditCard as Edit2, X } from 'lucide-react';
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
      let query = supabase
        .from('site_images')
        .select('*')
        .order('section')
        .order('order_index');

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
      const { error } = await supabase
        .from('site_images')
        .insert({
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
      const { error } = await supabase
        .from('site_images')
        .delete()
        .eq('id', id);

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
      <div className="max-w-7xl mx-auto p-6">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-light text-[#e5e4e2] mb-2">Zarządzanie Obrazami Strony</h1>
            <p className="text-[#e5e4e2]/60">Edytuj obrazy wyświetlane na stronie głównej i podstronach</p>
          </div>
          <button
            onClick={openCreateModal}
            className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-6 py-3 rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
          >
            <Plus className="w-5 h-5" />
            Dodaj Obraz
          </button>
        </div>

        <div className="mb-6">
          <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Filtruj po sekcji:</label>
          <select
            value={selectedSection}
            onChange={(e) => setSelectedSection(e.target.value)}
            className="bg-[#1c1f33] border border-[#d3bb73]/20 text-[#e5e4e2] rounded-lg px-4 py-2 w-full max-w-md focus:outline-none focus:border-[#d3bb73]"
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredImages.map((image) => (
              <div
                key={image.id}
                className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg overflow-hidden"
              >
                <div className="relative aspect-video bg-[#0f1119]">
                  <img
                    src={image.desktop_url}
                    alt={image.alt_text}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute top-2 right-2 flex gap-2">
                    <button
                      onClick={() => toggleActive(image)}
                      className={`p-2 rounded-lg backdrop-blur-sm ${
                        image.is_active
                          ? 'bg-green-500/80 hover:bg-green-500'
                          : 'bg-gray-500/80 hover:bg-gray-500'
                      } transition-colors`}
                      title={image.is_active ? 'Aktywny' : 'Nieaktywny'}
                    >
                      {image.is_active ? (
                        <Eye className="w-4 h-4 text-white" />
                      ) : (
                        <EyeOff className="w-4 h-4 text-white" />
                      )}
                    </button>
                  </div>
                </div>
                <div className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <h3 className="text-lg font-medium text-[#e5e4e2]">{image.name}</h3>
                      <p className="text-xs text-[#d3bb73]">{sections.find(s => s.value === image.section)?.label || image.section}</p>
                    </div>
                  </div>
                  {image.description && (
                    <p className="text-sm text-[#e5e4e2]/60 mb-3">{image.description}</p>
                  )}
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xs bg-[#d3bb73]/20 text-[#d3bb73] px-2 py-1 rounded">
                      Desktop: {image.desktop_url ? 'Tak' : 'Brak'}
                    </span>
                    <span className="text-xs bg-[#d3bb73]/20 text-[#d3bb73] px-2 py-1 rounded">
                      Mobile: {image.mobile_url ? 'Tak' : 'Brak'}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => openEditModal(image)}
                      className="flex-1 flex items-center justify-center gap-2 bg-[#d3bb73]/20 text-[#d3bb73] px-4 py-2 rounded-lg hover:bg-[#d3bb73]/30 transition-colors"
                    >
                      <Edit2 className="w-4 h-4" />
                      Edytuj
                    </button>
                    <button
                      onClick={() => handleDelete(image.id)}
                      className="flex items-center justify-center gap-2 bg-red-500/20 text-red-400 px-4 py-2 rounded-lg hover:bg-red-500/30 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && filteredImages.length === 0 && (
          <div className="text-center py-12 text-[#e5e4e2]/60">
            Brak obrazów w tej sekcji
          </div>
        )}
      </div>

      {isModalOpen && editingImage && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1c1f33] rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-[#1c1f33] border-b border-[#d3bb73]/20 p-6 flex items-center justify-between">
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
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Sekcja</label>
                <select
                  value={editingImage.section}
                  onChange={(e) => setEditingImage({ ...editingImage, section: e.target.value })}
                  className="bg-[#0f1119] border border-[#d3bb73]/20 text-[#e5e4e2] rounded-lg px-4 py-2 w-full focus:outline-none focus:border-[#d3bb73]"
                >
                  {sections.slice(1).map((section) => (
                    <option key={section.value} value={section.value}>
                      {section.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Nazwa</label>
                <input
                  type="text"
                  value={editingImage.name}
                  onChange={(e) => setEditingImage({ ...editingImage, name: e.target.value })}
                  className="bg-[#0f1119] border border-[#d3bb73]/20 text-[#e5e4e2] rounded-lg px-4 py-2 w-full focus:outline-none focus:border-[#d3bb73]"
                  placeholder="Np. Hero Background"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Opis</label>
                <textarea
                  value={editingImage.description}
                  onChange={(e) => setEditingImage({ ...editingImage, description: e.target.value })}
                  className="bg-[#0f1119] border border-[#d3bb73]/20 text-[#e5e4e2] rounded-lg px-4 py-2 w-full focus:outline-none focus:border-[#d3bb73] min-h-20"
                  placeholder="Opis użycia obrazu"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[#e5e4e2] mb-2">URL Desktop</label>
                <input
                  type="text"
                  value={editingImage.desktop_url}
                  onChange={(e) => setEditingImage({ ...editingImage, desktop_url: e.target.value })}
                  className="bg-[#0f1119] border border-[#d3bb73]/20 text-[#e5e4e2] rounded-lg px-4 py-2 w-full focus:outline-none focus:border-[#d3bb73]"
                  placeholder="https://images.pexels.com/..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[#e5e4e2] mb-2">URL Mobile (opcjonalnie)</label>
                <input
                  type="text"
                  value={editingImage.mobile_url || ''}
                  onChange={(e) => setEditingImage({ ...editingImage, mobile_url: e.target.value })}
                  className="bg-[#0f1119] border border-[#d3bb73]/20 text-[#e5e4e2] rounded-lg px-4 py-2 w-full focus:outline-none focus:border-[#d3bb73]"
                  placeholder="https://images.pexels.com/..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Tekst alternatywny (ALT)</label>
                <input
                  type="text"
                  value={editingImage.alt_text}
                  onChange={(e) => setEditingImage({ ...editingImage, alt_text: e.target.value })}
                  className="bg-[#0f1119] border border-[#d3bb73]/20 text-[#e5e4e2] rounded-lg px-4 py-2 w-full focus:outline-none focus:border-[#d3bb73]"
                  placeholder="Opis obrazu dla dostępności"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Pozycja</label>
                  <select
                    value={editingImage.position}
                    onChange={(e) => setEditingImage({ ...editingImage, position: e.target.value })}
                    className="bg-[#0f1119] border border-[#d3bb73]/20 text-[#e5e4e2] rounded-lg px-4 py-2 w-full focus:outline-none focus:border-[#d3bb73]"
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
                  <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Kolejność</label>
                  <input
                    type="number"
                    value={editingImage.order_index}
                    onChange={(e) => setEditingImage({ ...editingImage, order_index: parseInt(e.target.value) })}
                    className="bg-[#0f1119] border border-[#d3bb73]/20 text-[#e5e4e2] rounded-lg px-4 py-2 w-full focus:outline-none focus:border-[#d3bb73]"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="is_active"
                  checked={editingImage.is_active}
                  onChange={(e) => setEditingImage({ ...editingImage, is_active: e.target.checked })}
                  className="w-4 h-4 text-[#d3bb73] bg-[#0f1119] border-[#d3bb73]/20 rounded focus:ring-[#d3bb73]"
                />
                <label htmlFor="is_active" className="text-sm text-[#e5e4e2]">
                  Aktywny (widoczny na stronie)
                </label>
              </div>

              {editingImage.desktop_url && (
                <div>
                  <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Podgląd Desktop</label>
                  <div className="aspect-video bg-[#0f1119] rounded-lg overflow-hidden">
                    <img
                      src={editingImage.desktop_url}
                      alt="Preview"
                      className="w-full h-full object-cover"
                    />
                  </div>
                </div>
              )}

              {editingImage.mobile_url && (
                <div>
                  <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Podgląd Mobile</label>
                  <div className="aspect-video bg-[#0f1119] rounded-lg overflow-hidden max-w-xs">
                    <img
                      src={editingImage.mobile_url}
                      alt="Preview Mobile"
                      className="w-full h-full object-cover"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="sticky bottom-0 bg-[#1c1f33] border-t border-[#d3bb73]/20 p-6 flex gap-3">
              <button
                onClick={() => {
                  setIsModalOpen(false);
                  setEditingImage(null);
                }}
                className="flex-1 px-6 py-3 bg-[#e5e4e2]/10 text-[#e5e4e2] rounded-lg hover:bg-[#e5e4e2]/20 transition-colors"
              >
                Anuluj
              </button>
              <button
                onClick={editingImage.id ? handleSave : handleCreate}
                disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors disabled:opacity-50"
              >
                {saving ? (
                  'Zapisywanie...'
                ) : (
                  <>
                    <Save className="w-5 h-5" />
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
