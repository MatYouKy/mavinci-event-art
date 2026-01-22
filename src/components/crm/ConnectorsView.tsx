'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { Plus, Search, Edit2, Trash2, Image as ImageIcon } from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';

interface ConnectorType {
  id: string;
  name: string;
  description: string | null;
  common_uses: string | null;
  thumbnail_url: string | null;
  is_active: boolean;
}

interface ConnectorsViewProps {
  viewMode: 'grid' | 'list' | 'compact';
}

export default function ConnectorsView({ viewMode }: ConnectorsViewProps) {
  const { canManageModule } = useCurrentEmployee();
  const canManage = canManageModule('equipment');

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
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();

  useEffect(() => {
    loadConnectors();
  }, []);

  const loadConnectors = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.from('connector_types').select('*').order('name');

      if (error) throw error;
      setConnectors(data || []);
    } catch (err) {
      console.error('Error loading connectors:', err);
      showSnackbar('Błąd podczas ładowania wtyków', 'error');
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

      const { data } = supabase.storage.from('connector-thumbnails').getPublicUrl(filePath);

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
        showSnackbar('Wtyk zaktualizowany', 'success');
      } else {
        const { error } = await supabase.from('connector_types').insert({
          ...formData,
          thumbnail_url: thumbnailUrl,
          is_active: true,
        });

        if (error) throw error;
        showSnackbar('Wtyk dodany', 'success');
      }

      setShowModal(false);
      resetForm();
      loadConnectors();
    } catch (err) {
      console.error('Error saving connector:', err);
      showSnackbar('Błąd podczas zapisywania wtyka', 'error');
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();

    const confirmed = await showConfirm('Czy na pewno chcesz usunąć ten wtyk?', 'Usuń wtyk');
    if (!confirmed) return;

    try {
      const { error } = await supabase.from('connector_types').delete().eq('id', id);

      if (error) throw error;
      showSnackbar('Wtyk usunięty', 'success');
      loadConnectors();
    } catch (err) {
      console.error('Error deleting connector:', err);
      showSnackbar('Błąd podczas usuwania wtyka', 'error');
    }
  };

  const openEditModal = (connector: ConnectorType, e: React.MouseEvent) => {
    e.stopPropagation();
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

  const filteredConnectors = connectors.filter(
    (connector) =>
      connector.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      connector.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      connector.common_uses?.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-[#e5e4e2]/60">Ładowanie wtyków...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="relative max-w-md flex-1">
          <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#e5e4e2]/40" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Szukaj wtyków..."
            className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] py-2 pl-10 pr-4 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
          />
        </div>
        {canManage && (
          <button
            onClick={openAddModal}
            className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#0f1119] transition-colors hover:bg-[#d3bb73]/90"
          >
            <Plus className="h-4 w-4" />
            Dodaj wtyk
          </button>
        )}
      </div>

      {filteredConnectors.length === 0 ? (
        <div className="py-12 text-center text-[#e5e4e2]/40">
          {searchQuery ? 'Nie znaleziono wtyków' : 'Brak wtyków w bazie'}
        </div>
      ) : viewMode === 'compact' ? (
        <div className="overflow-hidden rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]">
          <div className="sticky top-0 grid grid-cols-[50px_1fr_80px_80px] gap-2 border-b border-[#d3bb73]/20 bg-[#d3bb73]/10 px-4 py-2 text-xs font-medium text-[#e5e4e2]">
            <div></div>
            <div>Nazwa</div>
            <div className="text-center">Akcje</div>
            <div></div>
          </div>
          {filteredConnectors.map((connector) => (
            <div
              key={connector.id}
              className="grid grid-cols-[50px_1fr_80px_80px] items-center gap-2 border-b border-[#d3bb73]/5 px-4 py-3 transition-colors hover:bg-[#d3bb73]/5"
            >
              <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded bg-[#0f1119]">
                {connector.thumbnail_url ? (
                  <img
                    src={connector.thumbnail_url}
                    alt={connector.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <ImageIcon className="h-4 w-4 text-[#e5e4e2]/20" />
                )}
              </div>
              <div>
                <div className="text-sm font-medium text-[#e5e4e2]">{connector.name}</div>
                {connector.description && (
                  <div className="line-clamp-1 text-xs text-[#e5e4e2]/50">
                    {connector.description}
                  </div>
                )}
              </div>
              {canManage && (
                <div className="flex items-center justify-center gap-1">
                  <button
                    onClick={(e) => openEditModal(connector, e)}
                    className="rounded bg-[#0f1119] p-1.5 text-[#e5e4e2] transition-colors hover:bg-[#0f1119]/80"
                    title="Edytuj"
                  >
                    <Edit2 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={(e) => handleDelete(connector.id, e)}
                    className="rounded bg-red-500/10 p-1.5 text-red-400 transition-colors hover:bg-red-500/20"
                    title="Usuń"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
              <div></div>
            </div>
          ))}
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredConnectors.map((connector) => (
            <div
              key={connector.id}
              className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-4 transition-colors hover:border-[#d3bb73]/30"
            >
              <div className="flex items-start gap-4">
                <div className="flex h-20 w-20 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[#0f1119]">
                  {connector.thumbnail_url ? (
                    <img
                      src={connector.thumbnail_url}
                      alt={connector.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <ImageIcon className="h-8 w-8 text-[#e5e4e2]/20" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <h3 className="mb-1 text-lg font-medium text-[#e5e4e2]">{connector.name}</h3>
                  {connector.description && (
                    <p className="mb-2 line-clamp-2 text-sm text-[#e5e4e2]/60">
                      {connector.description}
                    </p>
                  )}
                  {connector.common_uses && (
                    <p className="line-clamp-2 text-xs text-[#d3bb73]/80">
                      <span className="font-medium">Zastosowanie:</span> {connector.common_uses}
                    </p>
                  )}
                </div>
              </div>

              {canManage && (
                <div className="mt-4 flex items-center gap-2 border-t border-[#d3bb73]/10 pt-4">
                  <button
                    onClick={(e) => openEditModal(connector, e)}
                    className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#0f1119] px-3 py-2 text-sm text-[#e5e4e2] transition-colors hover:bg-[#0f1119]/80"
                  >
                    <Edit2 className="h-4 w-4" />
                    Edytuj
                  </button>
                  <button
                    onClick={(e) => handleDelete(connector.id, e)}
                    className="flex items-center justify-center gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400 transition-colors hover:bg-red-500/20"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {filteredConnectors.map((connector) => (
            <div
              key={connector.id}
              className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-4 transition-colors hover:border-[#d3bb73]/30"
            >
              <div className="flex items-center gap-4">
                <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[#0f1119]">
                  {connector.thumbnail_url ? (
                    <img
                      src={connector.thumbnail_url}
                      alt={connector.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <ImageIcon className="h-6 w-6 text-[#e5e4e2]/20" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <h3 className="text-base font-medium text-[#e5e4e2]">{connector.name}</h3>
                  {connector.description && (
                    <p className="line-clamp-1 text-sm text-[#e5e4e2]/60">
                      {connector.description}
                    </p>
                  )}
                </div>

                {canManage && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => openEditModal(connector, e)}
                      className="rounded-lg bg-[#0f1119] p-2 text-[#e5e4e2] transition-colors hover:bg-[#0f1119]/80"
                    >
                      <Edit2 className="h-4 w-4" />
                    </button>
                    <button
                      onClick={(e) => handleDelete(connector.id, e)}
                      className="rounded-lg bg-red-500/10 p-2 text-red-400 transition-colors hover:bg-red-500/20"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
            <h3 className="mb-4 text-xl font-medium text-[#e5e4e2]">
              {selectedConnector ? 'Edytuj wtyk' : 'Dodaj nowy wtyk'}
            </h3>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                  Nazwa wtyka <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                  className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
                  placeholder="np. XLR Male"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Opis</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={3}
                  className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
                  placeholder="np. Wtyk XLR męski, 3-pinowy"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Typowe zastosowania</label>
                <textarea
                  value={formData.common_uses}
                  onChange={(e) => setFormData({ ...formData, common_uses: e.target.value })}
                  rows={3}
                  className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
                  placeholder="np. Mikrofony, sygnały audio balanced, DMX"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Zdjęcie wtyka</label>
                {previewUrl && (
                  <div className="mb-2">
                    <img
                      src={previewUrl}
                      alt="Preview"
                      className="h-32 w-32 rounded-lg object-cover"
                    />
                  </div>
                )}
                <input
                  type="file"
                  onChange={handleFileChange}
                  accept="image/*"
                  className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] file:mr-4 file:rounded-lg file:border-0 file:bg-[#d3bb73] file:px-4 file:py-2 file:text-sm file:text-[#0f1119] hover:file:bg-[#d3bb73]/90 focus:border-[#d3bb73]/30 focus:outline-none"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="submit"
                  className="flex-1 rounded-lg bg-[#d3bb73] px-4 py-2 font-medium text-[#0f1119] transition-colors hover:bg-[#d3bb73]/90"
                >
                  {selectedConnector ? 'Zapisz zmiany' : 'Dodaj wtyk'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="rounded-lg bg-[#0f1119] px-4 py-2 text-[#e5e4e2] transition-colors hover:bg-[#0f1119]/80"
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
