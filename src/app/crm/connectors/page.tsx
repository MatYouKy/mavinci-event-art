'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Plus, Search, Edit2, Trash2, Image as ImageIcon } from 'lucide-react';

interface ConnectorType {
  id: string;
  name: string;
  description: string | null;
  common_uses: string | null;
  thumbnail_url: string | null;
  is_active: boolean;
  created_at: string;
}

export default function ConnectorsPage() {
  const [connectors, setConnectors] = useState<ConnectorType[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [selectedConnector, setSelectedConnector] = useState<ConnectorType | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    common_uses: '',
  });
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    loadConnectors();
  }, []);

  const loadConnectors = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('connector_types')
        .select('*')
        .order('name');

      if (error) throw error;
      setConnectors(data || []);
    } catch (err) {
      console.error('Error loading connectors:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setThumbnailFile(file);
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
    }
  };

  const uploadThumbnail = async (file: File): Promise<string | null> => {
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
      const filePath = fileName;

      const { error: uploadError } = await supabase.storage
        .from('connector-thumbnails')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data } = supabase.storage
        .from('connector-thumbnails')
        .getPublicUrl(filePath);

      return data.publicUrl;
    } catch (err) {
      console.error('Error uploading thumbnail:', err);
      return null;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      let thumbnailUrl = selectedConnector?.thumbnail_url || null;

      if (thumbnailFile) {
        thumbnailUrl = await uploadThumbnail(thumbnailFile);
      }

      if (selectedConnector) {
        const { error } = await supabase
          .from('connector_types')
          .update({
            ...formData,
            thumbnail_url: thumbnailUrl,
          })
          .eq('id', selectedConnector.id);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('connector_types')
          .insert({
            ...formData,
            thumbnail_url: thumbnailUrl,
            is_active: true,
          });

        if (error) throw error;
      }

      setShowModal(false);
      resetForm();
      loadConnectors();
    } catch (err) {
      console.error('Error saving connector:', err);
      alert('Błąd podczas zapisywania wtyka');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Czy na pewno chcesz usunąć ten wtyk?')) return;

    try {
      const { error } = await supabase
        .from('connector_types')
        .delete()
        .eq('id', id);

      if (error) throw error;
      loadConnectors();
    } catch (err) {
      console.error('Error deleting connector:', err);
      alert('Błąd podczas usuwania wtyka');
    }
  };

  const openEditModal = (connector: ConnectorType) => {
    setSelectedConnector(connector);
    setFormData({
      name: connector.name,
      description: connector.description || '',
      common_uses: connector.common_uses || '',
    });
    setPreviewUrl(connector.thumbnail_url);
    setShowModal(true);
  };

  const openAddModal = () => {
    setSelectedConnector(null);
    resetForm();
    setShowModal(true);
  };

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      common_uses: '',
    });
    setThumbnailFile(null);
    setPreviewUrl(null);
  };

  const filteredConnectors = connectors.filter(connector =>
    connector.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    connector.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    connector.common_uses?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-[#e5e4e2]/60">Ładowanie...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-light text-[#e5e4e2]">Baza wtyków</h2>
        <button
          onClick={openAddModal}
          className="flex items-center gap-2 bg-[#d3bb73] text-[#0f1119] px-4 py-2 rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Dodaj wtyk
        </button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#e5e4e2]/40" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Szukaj wtyków..."
          className="w-full bg-[#1c1f33] border border-[#d3bb73]/10 rounded-lg pl-10 pr-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredConnectors.map((connector) => (
          <div
            key={connector.id}
            className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-4 hover:border-[#d3bb73]/30 transition-colors"
          >
            <div className="flex items-start gap-4">
              <div className="w-20 h-20 bg-[#0f1119] rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden">
                {connector.thumbnail_url ? (
                  <img
                    src={connector.thumbnail_url}
                    alt={connector.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <ImageIcon className="w-8 h-8 text-[#e5e4e2]/20" />
                )}
              </div>

              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-medium text-[#e5e4e2] mb-1">{connector.name}</h3>
                {connector.description && (
                  <p className="text-sm text-[#e5e4e2]/60 mb-2 line-clamp-2">
                    {connector.description}
                  </p>
                )}
                {connector.common_uses && (
                  <p className="text-xs text-[#d3bb73]/80 line-clamp-2">
                    <span className="font-medium">Zastosowanie:</span> {connector.common_uses}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 mt-4 pt-4 border-t border-[#d3bb73]/10">
              <button
                onClick={() => openEditModal(connector)}
                className="flex-1 flex items-center justify-center gap-2 bg-[#0f1119] text-[#e5e4e2] px-3 py-2 rounded-lg hover:bg-[#0f1119]/80 transition-colors text-sm"
              >
                <Edit2 className="w-4 h-4" />
                Edytuj
              </button>
              <button
                onClick={() => handleDelete(connector.id)}
                className="flex items-center justify-center gap-2 bg-red-500/10 text-red-400 px-3 py-2 rounded-lg hover:bg-red-500/20 transition-colors text-sm"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {filteredConnectors.length === 0 && (
        <div className="text-center py-12 text-[#e5e4e2]/40">
          {searchQuery ? 'Nie znaleziono wtyków' : 'Brak wtyków w bazie'}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-medium text-[#e5e4e2] mb-4">
              {selectedConnector ? 'Edytuj wtyk' : 'Dodaj nowy wtyk'}
            </h3>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                  Nazwa wtyka <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                  placeholder="np. XLR Male"
                />
              </div>

              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">Opis</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={3}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                  placeholder="np. Wtyk XLR męski, 3-pinowy"
                />
              </div>

              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">Typowe zastosowania</label>
                <textarea
                  value={formData.common_uses}
                  onChange={(e) => setFormData({ ...formData, common_uses: e.target.value })}
                  rows={3}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                  placeholder="np. Mikrofony, sygnały audio balanced, DMX"
                />
              </div>

              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">Zdjęcie wtyka</label>
                {previewUrl && (
                  <div className="mb-2">
                    <img
                      src={previewUrl}
                      alt="Preview"
                      className="w-32 h-32 object-cover rounded-lg"
                    />
                  </div>
                )}
                <input
                  type="file"
                  onChange={handleFileChange}
                  accept="image/*"
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="submit"
                  className="flex-1 bg-[#d3bb73] text-[#0f1119] px-4 py-2 rounded-lg hover:bg-[#d3bb73]/90 transition-colors font-medium"
                >
                  {selectedConnector ? 'Zapisz zmiany' : 'Dodaj wtyk'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 bg-[#0f1119] text-[#e5e4e2] rounded-lg hover:bg-[#0f1119]/80 transition-colors"
                >
                  Anuluj
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
