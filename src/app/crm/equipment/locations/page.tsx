'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  MapPin,
  Plus,
  Edit,
  Trash2,
  ArrowLeft,
  Save,
  X,
  Building2,
  CheckCircle,
  XCircle,
  Loader2,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { parseGoogleMapsUrl } from '@/lib/gus';

interface StorageLocation {
  id: string;
  name: string;
  address: string | null;
  access_info: string | null;
  google_maps_url: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export default function StorageLocationsPage() {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();

  const [locations, setLocations] = useState<StorageLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingLocation, setEditingLocation] = useState<StorageLocation | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    address: '',
    access_info: '',
    google_maps_url: '',
    notes: '',
    is_active: true,
  });

  useEffect(() => {
    fetchLocations();
  }, []);

  const fetchLocations = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('storage_locations')
        .select('*')
        .order('name');

      if (error) throw error;
      setLocations(data || []);
    } catch (error: any) {
      showSnackbar(error.message || 'Błąd pobierania lokalizacji', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenModal = (location?: StorageLocation) => {
    if (location) {
      setEditingLocation(location);
      setFormData({
        name: location.name,
        address: location.address || '',
        access_info: location.access_info || '',
        google_maps_url: location.google_maps_url || '',
        notes: location.notes || '',
        is_active: location.is_active,
      });
    } else {
      setEditingLocation(null);
      setFormData({
        name: '',
        address: '',
        access_info: '',
        google_maps_url: '',
        notes: '',
        is_active: true,
      });
    }
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setEditingLocation(null);
    setFormData({
      name: '',
      address: '',
      access_info: '',
      google_maps_url: '',
      notes: '',
      is_active: true,
    });
  };

  const handleParseGoogleMaps = () => {
    if (!formData.google_maps_url) {
      showSnackbar('Wprowadź URL Google Maps', 'error');
      return;
    }

    try {
      const coords = parseGoogleMapsUrl(formData.google_maps_url);
      if (coords) {
        showSnackbar(`Współrzędne: ${coords.latitude}, ${coords.longitude}`, 'success');
      } else {
        showSnackbar('Nie udało się odczytać współrzędnych. Sprawdź format linku.', 'error');
      }
    } catch (error: any) {
      showSnackbar(error.message || 'Błąd parsowania URL', 'error');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      showSnackbar('Nazwa lokalizacji jest wymagana', 'error');
      return;
    }

    try {
      setLoading(true);

      if (editingLocation) {
        const { error } = await supabase
          .from('storage_locations')
          .update({
            name: formData.name,
            address: formData.address || null,
            access_info: formData.access_info || null,
            google_maps_url: formData.google_maps_url || null,
            notes: formData.notes || null,
            is_active: formData.is_active,
            updated_at: new Date().toISOString(),
          })
          .eq('id', editingLocation.id);

        if (error) throw error;
        showSnackbar('Lokalizacja zaktualizowana', 'success');
      } else {
        const { error } = await supabase
          .from('storage_locations')
          .insert([
            {
              name: formData.name,
              address: formData.address || null,
              access_info: formData.access_info || null,
              google_maps_url: formData.google_maps_url || null,
              notes: formData.notes || null,
              is_active: formData.is_active,
            },
          ]);

        if (error) throw error;
        showSnackbar('Lokalizacja dodana', 'success');
      }

      handleCloseModal();
      fetchLocations();
    } catch (error: any) {
      showSnackbar(error.message || 'Błąd zapisywania lokalizacji', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Czy na pewno chcesz usunąć tę lokalizację?')) return;

    try {
      const { error } = await supabase
        .from('storage_locations')
        .delete()
        .eq('id', id);

      if (error) throw error;
      showSnackbar('Lokalizacja usunięta', 'success');
      fetchLocations();
    } catch (error: any) {
      showSnackbar(error.message || 'Błąd usuwania lokalizacji', 'error');
    }
  };

  return (
    <div className="min-h-screen bg-[#0f1119] p-6">
      <div className="max-w-6xl mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <button
              onClick={() => router.push('/crm/equipment')}
              className="p-2 hover:bg-[#1a1d2e] rounded-lg transition-colors"
            >
              <ArrowLeft className="w-6 h-6 text-gray-400" />
            </button>
            <div>
              <h1 className="text-3xl font-bold text-[#d3bb73] flex items-center space-x-3">
                <MapPin className="w-8 h-8" />
                <span>Lokalizacje magazynowe</span>
              </h1>
              <p className="text-gray-400">Zarządzaj lokalizacjami przechowywania sprzętu</p>
            </div>
          </div>
          <button
            onClick={() => handleOpenModal()}
            className="px-4 py-2 bg-[#d3bb73] text-[#0f1119] rounded-lg hover:bg-[#c4a859] transition-colors flex items-center space-x-2 font-medium"
          >
            <Plus className="w-5 h-5" />
            <span>Dodaj lokalizację</span>
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center items-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-[#d3bb73]" />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {locations.map((location) => (
              <div
                key={location.id}
                className={`bg-[#1a1d2e] border rounded-lg p-4 ${
                  location.is_active ? 'border-gray-700' : 'border-red-900 opacity-60'
                }`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center space-x-2">
                    <Building2 className="w-5 h-5 text-[#d3bb73]" />
                    <h3 className="text-lg font-semibold text-white">{location.name}</h3>
                  </div>
                  <div className="flex items-center space-x-1">
                    {location.is_active ? (
                      <CheckCircle className="w-5 h-5 text-green-500" />
                    ) : (
                      <XCircle className="w-5 h-5 text-red-500" />
                    )}
                  </div>
                </div>

                {location.address && (
                  <p className="text-sm text-gray-400 mb-2">
                    <MapPin className="w-4 h-4 inline mr-1" />
                    {location.address}
                  </p>
                )}

                {location.access_info && (
                  <p className="text-sm text-gray-300 mb-2">
                    <span className="font-medium">Dostęp:</span> {location.access_info}
                  </p>
                )}

                {location.google_maps_url && (
                  <a
                    href={location.google_maps_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-[#d3bb73] hover:underline block mb-2"
                  >
                    🗺️ Otwórz w Google Maps
                  </a>
                )}

                {location.notes && (
                  <p className="text-xs text-gray-500 mb-3">{location.notes}</p>
                )}

                <div className="flex items-center space-x-2 pt-3 border-t border-gray-700">
                  <button
                    onClick={() => handleOpenModal(location)}
                    className="flex-1 px-3 py-2 bg-[#d3bb73]/20 text-[#d3bb73] rounded hover:bg-[#d3bb73]/30 transition-colors flex items-center justify-center space-x-1 text-sm"
                  >
                    <Edit className="w-4 h-4" />
                    <span>Edytuj</span>
                  </button>
                  <button
                    onClick={() => handleDelete(location.id)}
                    className="px-3 py-2 bg-red-900/20 text-red-400 rounded hover:bg-red-900/30 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && locations.length === 0 && (
          <div className="text-center py-12">
            <Building2 className="w-16 h-16 text-gray-600 mx-auto mb-4" />
            <p className="text-gray-400 mb-4">Brak lokalizacji magazynowych</p>
            <button
              onClick={() => handleOpenModal()}
              className="px-4 py-2 bg-[#d3bb73] text-[#0f1119] rounded-lg hover:bg-[#c4a859] transition-colors inline-flex items-center space-x-2"
            >
              <Plus className="w-5 h-5" />
              <span>Dodaj pierwszą lokalizację</span>
            </button>
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1a1d2e] border border-gray-700 rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-white">
                {editingLocation ? 'Edytuj lokalizację' : 'Nowa lokalizacja'}
              </h2>
              <button
                onClick={handleCloseModal}
                className="p-2 hover:bg-[#0f1119] rounded-lg transition-colors"
              >
                <X className="w-6 h-6 text-gray-400" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Nazwa lokalizacji <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-4 py-2 bg-[#0f1119] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
                  placeholder="np. Magazyn główny, Biuro, Sala eventowa"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Adres</label>
                <input
                  type="text"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  className="w-full px-4 py-2 bg-[#0f1119] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
                  placeholder="ul. Przykładowa 1, 00-000 Warszawa"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  URL Google Maps
                </label>
                <div className="flex space-x-2">
                  <input
                    type="url"
                    value={formData.google_maps_url}
                    onChange={(e) => setFormData({ ...formData, google_maps_url: e.target.value })}
                    className="flex-1 px-4 py-2 bg-[#0f1119] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
                    placeholder="https://maps.google.com/..."
                  />
                  <button
                    type="button"
                    onClick={handleParseGoogleMaps}
                    className="px-4 py-2 bg-[#d3bb73] text-[#0f1119] rounded-lg hover:bg-[#c4a859] transition-colors flex items-center space-x-2"
                  >
                    <MapPin className="w-5 h-5" />
                    <span>Test</span>
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Otwórz miejsce w Google Maps, skopiuj PEŁNY URL z paska adresu (nie skrócony link!)
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Informacje o dostępie
                </label>
                <textarea
                  value={formData.access_info}
                  onChange={(e) => setFormData({ ...formData, access_info: e.target.value })}
                  rows={2}
                  className="w-full px-4 py-2 bg-[#0f1119] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
                  placeholder="np. wejście od podwórka, kod do bramy: 1234"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Notatki</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  rows={3}
                  className="w-full px-4 py-2 bg-[#0f1119] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
                  placeholder="Dodatkowe informacje..."
                />
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="is_active"
                  checked={formData.is_active}
                  onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                  className="w-4 h-4 rounded border-gray-700 bg-[#0f1119] text-[#d3bb73] focus:ring-[#d3bb73]"
                />
                <label htmlFor="is_active" className="text-sm text-gray-300 cursor-pointer">
                  Lokalizacja aktywna
                </label>
              </div>

              <div className="flex justify-end space-x-4 pt-4 border-t border-gray-700">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="px-6 py-2 border border-gray-700 text-gray-300 rounded-lg hover:bg-[#0f1119] transition-colors"
                >
                  Anuluj
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-6 py-2 bg-[#d3bb73] text-[#0f1119] rounded-lg hover:bg-[#c4a859] transition-colors flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                  <span>{loading ? 'Zapisywanie...' : 'Zapisz'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
