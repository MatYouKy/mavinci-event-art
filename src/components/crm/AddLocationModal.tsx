'use client';

import { useState } from 'react';
import { X, MapPin } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';
import GoogleMapsPicker from './GoogleMapsPicker';

interface AddLocationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLocationAdded: (location: {
    id: string;
    name: string;
    address?: string;
    city?: string;
    postal_code?: string;
    country?: string;
    formatted_address?: string;
    latitude?: number;
    longitude?: number;
  }) => void;
}

export default function AddLocationModal({
  isOpen,
  onClose,
  onLocationAdded,
}: AddLocationModalProps) {
  const { showSnackbar } = useSnackbar();
  const [saving, setSaving] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    address: '',
    city: '',
    postal_code: '',
    country: 'Polska',
    nip: '',
    contact_person_name: '',
    contact_phone: '',
    contact_email: '',
    notes: '',
    latitude: null as number | null,
    longitude: null as number | null,
    google_maps_url: '',
    google_place_id: '',
    formatted_address: '',
  });

  const handleSave = async () => {
    if (!formData.name) {
      showSnackbar('Nazwa lokalizacji jest wymagana', 'error');
      return;
    }

    setSaving(true);
    try {
      const { data, error } = await supabase
        .from('locations')
        .insert([formData])
        .select()
        .single();

      if (error) throw error;

      showSnackbar('Lokalizacja została dodana', 'success');
      onLocationAdded(data);
      handleClose();
    } catch (error) {
      console.error('Błąd podczas zapisywania lokalizacji:', error);
      showSnackbar('Błąd podczas zapisywania lokalizacji', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    setFormData({
      name: '',
      address: '',
      city: '',
      postal_code: '',
      country: 'Polska',
      nip: '',
      contact_person_name: '',
      contact_phone: '',
      contact_email: '',
      notes: '',
      latitude: null,
      longitude: null,
      google_maps_url: '',
      google_place_id: '',
      formatted_address: '',
    });
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-4">
      <div className="bg-[#1c1f33] rounded-lg w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-[#d3bb73]/20">
          <div className="flex items-center gap-3">
            <MapPin className="w-6 h-6 text-[#d3bb73]" />
            <h2 className="text-xl font-semibold text-[#e5e4e2]">
              Dodaj nową lokalizację
            </h2>
          </div>
          <button
            onClick={handleClose}
            className="text-[#e5e4e2]/50 hover:text-[#e5e4e2] transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto p-6 space-y-6">
          {/* Podstawowe informacje */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-[#d3bb73] uppercase tracking-wider">
              Podstawowe informacje
            </h3>

            <div>
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                Nazwa lokalizacji *
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                className="w-full px-4 py-2 bg-[#0f1117] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/50"
                placeholder="np. Hotel Marriott Warsaw"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                  Adres
                </label>
                <input
                  type="text"
                  value={formData.address}
                  onChange={(e) =>
                    setFormData({ ...formData, address: e.target.value })
                  }
                  className="w-full px-4 py-2 bg-[#0f1117] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/50"
                  placeholder="ul. Przykładowa 1"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                  Miasto
                </label>
                <input
                  type="text"
                  value={formData.city}
                  onChange={(e) =>
                    setFormData({ ...formData, city: e.target.value })
                  }
                  className="w-full px-4 py-2 bg-[#0f1117] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/50"
                  placeholder="Warszawa"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                  Kod pocztowy
                </label>
                <input
                  type="text"
                  value={formData.postal_code}
                  onChange={(e) =>
                    setFormData({ ...formData, postal_code: e.target.value })
                  }
                  className="w-full px-4 py-2 bg-[#0f1117] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/50"
                  placeholder="00-000"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                  Kraj
                </label>
                <input
                  type="text"
                  value={formData.country}
                  onChange={(e) =>
                    setFormData({ ...formData, country: e.target.value })
                  }
                  className="w-full px-4 py-2 bg-[#0f1117] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/50"
                  placeholder="Polska"
                />
              </div>
            </div>
          </div>

          {/* Google Maps Picker */}
          <div className="pt-4 border-t border-[#d3bb73]/10">
            <h3 className="text-sm font-medium text-[#d3bb73] uppercase tracking-wider mb-4">
              Lokalizacja na mapie
            </h3>
            <GoogleMapsPicker
              latitude={formData.latitude}
              longitude={formData.longitude}
              onLocationSelect={(data) => {
                setFormData({
                  ...formData,
                  name: data.name || formData.name,
                  latitude: data.latitude,
                  longitude: data.longitude,
                  google_maps_url: data.google_maps_url,
                  google_place_id: data.google_place_id || '',
                  formatted_address: data.formatted_address,
                  address: data.address || formData.address,
                  city: data.city || formData.city,
                  postal_code: data.postal_code || formData.postal_code,
                  country: data.country || formData.country,
                });
              }}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-[#d3bb73]/20">
          <button
            onClick={handleClose}
            disabled={saving}
            className="px-4 py-2 text-[#e5e4e2] hover:bg-[#d3bb73]/10 rounded-lg transition-colors disabled:opacity-50"
          >
            Anuluj
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg font-medium hover:bg-[#d3bb73]/90 transition-colors disabled:opacity-50"
          >
            {saving ? 'Zapisywanie...' : 'Dodaj lokalizację'}
          </button>
        </div>
      </div>
    </div>
  );
}
