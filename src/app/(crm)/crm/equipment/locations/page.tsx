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
import { supabase } from '@/lib/supabase/browser';
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
      const { data, error } = await supabase.from('storage_locations').select('*').order('name');

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
        const { error } = await supabase.from('storage_locations').insert([
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
      const { error } = await supabase.from('storage_locations').delete().eq('id', id);

      if (error) throw error;
      showSnackbar('Lokalizacja usunięta', 'success');
      fetchLocations();
    } catch (error: any) {
      showSnackbar(error.message || 'Błąd usuwania lokalizacji', 'error');
    }
  };

  return (
    <div className="min-h-screen bg-[#0f1119] p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <button
              onClick={() => router.push('/crm/equipment')}
              className="rounded-lg p-2 transition-colors hover:bg-[#1a1d2e]"
            >
              <ArrowLeft className="h-6 w-6 text-gray-400" />
            </button>
            <div>
              <h1 className="flex items-center space-x-3 text-3xl font-bold text-[#d3bb73]">
                <MapPin className="h-8 w-8" />
                <span>Lokalizacje magazynowe</span>
              </h1>
              <p className="text-gray-400">Zarządzaj lokalizacjami przechowywania sprzętu</p>
            </div>
          </div>
          <button
            onClick={() => handleOpenModal()}
            className="flex items-center space-x-2 rounded-lg bg-[#d3bb73] px-4 py-2 font-medium text-[#0f1119] transition-colors hover:bg-[#c4a859]"
          >
            <Plus className="h-5 w-5" />
            <span>Dodaj lokalizację</span>
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-[#d3bb73]" />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {locations.map((location) => (
              <div
                key={location.id}
                className={`rounded-lg border bg-[#1a1d2e] p-4 ${
                  location.is_active ? 'border-gray-700' : 'border-red-900 opacity-60'
                }`}
              >
                <div className="mb-3 flex items-start justify-between">
                  <div className="flex items-center space-x-2">
                    <Building2 className="h-5 w-5 text-[#d3bb73]" />
                    <h3 className="text-lg font-semibold text-white">{location.name}</h3>
                  </div>
                  <div className="flex items-center space-x-1">
                    {location.is_active ? (
                      <CheckCircle className="h-5 w-5 text-green-500" />
                    ) : (
                      <XCircle className="h-5 w-5 text-red-500" />
                    )}
                  </div>
                </div>

                {location.address && (
                  <p className="mb-2 text-sm text-gray-400">
                    <MapPin className="mr-1 inline h-4 w-4" />
                    {location.address}
                  </p>
                )}

                {location.access_info && (
                  <p className="mb-2 text-sm text-gray-300">
                    <span className="font-medium">Dostęp:</span> {location.access_info}
                  </p>
                )}

                {location.google_maps_url && (
                  <a
                    href={location.google_maps_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mb-2 block text-sm text-[#d3bb73] hover:underline"
                  >
                    🗺️ Otwórz w Google Maps
                  </a>
                )}

                {location.notes && <p className="mb-3 text-xs text-gray-500">{location.notes}</p>}

                <div className="flex items-center space-x-2 border-t border-gray-700 pt-3">
                  <button
                    onClick={() => handleOpenModal(location)}
                    className="flex flex-1 items-center justify-center space-x-1 rounded bg-[#d3bb73]/20 px-3 py-2 text-sm text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/30"
                  >
                    <Edit className="h-4 w-4" />
                    <span>Edytuj</span>
                  </button>
                  <button
                    onClick={() => handleDelete(location.id)}
                    className="rounded bg-red-900/20 px-3 py-2 text-red-400 transition-colors hover:bg-red-900/30"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && locations.length === 0 && (
          <div className="py-12 text-center">
            <Building2 className="mx-auto mb-4 h-16 w-16 text-gray-600" />
            <p className="mb-4 text-gray-400">Brak lokalizacji magazynowych</p>
            <button
              onClick={() => handleOpenModal()}
              className="inline-flex items-center space-x-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#0f1119] transition-colors hover:bg-[#c4a859]"
            >
              <Plus className="h-5 w-5" />
              <span>Dodaj pierwszą lokalizację</span>
            </button>
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-gray-700 bg-[#1a1d2e] p-6">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-2xl font-bold text-white">
                {editingLocation ? 'Edytuj lokalizację' : 'Nowa lokalizacja'}
              </h2>
              <button
                onClick={handleCloseModal}
                className="rounded-lg p-2 transition-colors hover:bg-[#0f1119]"
              >
                <X className="h-6 w-6 text-gray-400" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-300">
                  Nazwa lokalizacji <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full rounded-lg border border-gray-700 bg-[#0f1119] px-4 py-2 text-white focus:border-[#d3bb73] focus:outline-none"
                  placeholder="np. Magazyn główny, Biuro, Sala eventowa"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-gray-300">Adres</label>
                <input
                  type="text"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  className="w-full rounded-lg border border-gray-700 bg-[#0f1119] px-4 py-2 text-white focus:border-[#d3bb73] focus:outline-none"
                  placeholder="ul. Przykładowa 1, 00-000 Warszawa"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-gray-300">
                  URL Google Maps
                </label>
                <div className="flex space-x-2">
                  <input
                    type="url"
                    value={formData.google_maps_url}
                    onChange={(e) => setFormData({ ...formData, google_maps_url: e.target.value })}
                    className="flex-1 rounded-lg border border-gray-700 bg-[#0f1119] px-4 py-2 text-white focus:border-[#d3bb73] focus:outline-none"
                    placeholder="https://maps.google.com/..."
                  />
                  <button
                    type="button"
                    onClick={handleParseGoogleMaps}
                    className="flex items-center space-x-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#0f1119] transition-colors hover:bg-[#c4a859]"
                  >
                    <MapPin className="h-5 w-5" />
                    <span>Test</span>
                  </button>
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  Otwórz miejsce w Google Maps, skopiuj PEŁNY URL z paska adresu (nie skrócony
                  link!)
                </p>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-gray-300">
                  Informacje o dostępie
                </label>
                <textarea
                  value={formData.access_info}
                  onChange={(e) => setFormData({ ...formData, access_info: e.target.value })}
                  rows={2}
                  className="w-full rounded-lg border border-gray-700 bg-[#0f1119] px-4 py-2 text-white focus:border-[#d3bb73] focus:outline-none"
                  placeholder="np. wejście od podwórka, kod do bramy: 1234"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-gray-300">Notatki</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  rows={3}
                  className="w-full rounded-lg border border-gray-700 bg-[#0f1119] px-4 py-2 text-white focus:border-[#d3bb73] focus:outline-none"
                  placeholder="Dodatkowe informacje..."
                />
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="is_active"
                  checked={formData.is_active}
                  onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                  className="h-4 w-4 rounded border-gray-700 bg-[#0f1119] text-[#d3bb73] focus:ring-[#d3bb73]"
                />
                <label htmlFor="is_active" className="cursor-pointer text-sm text-gray-300">
                  Lokalizacja aktywna
                </label>
              </div>

              <div className="flex justify-end space-x-4 border-t border-gray-700 pt-4">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="rounded-lg border border-gray-700 px-6 py-2 text-gray-300 transition-colors hover:bg-[#0f1119]"
                >
                  Anuluj
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex items-center space-x-2 rounded-lg bg-[#d3bb73] px-6 py-2 font-medium text-[#0f1119] transition-colors hover:bg-[#c4a859] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Save className="h-5 w-5" />
                  )}
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
