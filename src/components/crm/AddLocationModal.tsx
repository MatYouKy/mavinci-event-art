'use client';

import { useState } from 'react';
import { X, MapPin } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
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
      const { data, error } = await supabase.from('locations').insert([formData]).select().single();

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
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-[#1c1f33]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#d3bb73]/20 p-6">
          <div className="flex items-center gap-3">
            <MapPin className="h-6 w-6 text-[#d3bb73]" />
            <h2 className="text-xl font-semibold text-[#e5e4e2]">Dodaj nową lokalizację</h2>
          </div>
          <button
            onClick={handleClose}
            className="text-[#e5e4e2]/50 transition-colors hover:text-[#e5e4e2]"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Content */}
        <div className="space-y-6 overflow-y-auto p-6">
          {/* Podstawowe informacje */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium uppercase tracking-wider text-[#d3bb73]">
              Podstawowe informacje
            </h3>

            <div>
              <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                Nazwa lokalizacji *
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                placeholder="np. Hotel Marriott Warsaw"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Adres</label>
                <input
                  type="text"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                  placeholder="ul. Przykładowa 1"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Miasto</label>
                <input
                  type="text"
                  value={formData.city}
                  onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                  placeholder="Warszawa"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                  Kod pocztowy
                </label>
                <input
                  type="text"
                  value={formData.postal_code}
                  onChange={(e) => setFormData({ ...formData, postal_code: e.target.value })}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                  placeholder="00-000"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Kraj</label>
                <input
                  type="text"
                  value={formData.country}
                  onChange={(e) => setFormData({ ...formData, country: e.target.value })}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                  placeholder="Polska"
                />
              </div>
            </div>
          </div>

          {/* Google Maps Picker */}
          <div className="border-t border-[#d3bb73]/10 pt-4">
            <h3 className="mb-4 text-sm font-medium uppercase tracking-wider text-[#d3bb73]">
              Lokalizacja na mapie
            </h3>
            <GoogleMapsPicker
              latitude={formData.latitude}
              longitude={formData.longitude}
              onLocationSelect={(data) => {
                // Aktualizuj formularz danymi z Google Maps
                // WAŻNE: data.name to nazwa miejsca (np. "Warmiński Hotel & Conference Olsztyn")
                // data.address to ulica i numer (np. "Kołobrzeska 1")

                setFormData((prev) => ({
                  ...prev,
                  // Nazwa: użyj nazwy miejsca z Google, jeśli nie ma - zachowaj poprzednią
                  name: data.name || prev.name,
                  latitude: data.latitude,
                  longitude: data.longitude,
                  google_maps_url: data.google_maps_url,
                  google_place_id: data.google_place_id || '',
                  formatted_address: data.formatted_address,
                  // Adres: numer domu + ulica (nie nazwa!)
                  address: data.address || prev.address,
                  city: data.city || prev.city,
                  postal_code: data.postal_code || prev.postal_code,
                  country: data.country || prev.country,
                }));
              }}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-[#d3bb73]/20 p-6">
          <button
            onClick={handleClose}
            disabled={saving}
            className="rounded-lg px-4 py-2 text-[#e5e4e2] transition-colors hover:bg-[#d3bb73]/10 disabled:opacity-50"
          >
            Anuluj
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-[#d3bb73] px-4 py-2 font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:opacity-50"
          >
            {saving ? 'Zapisywanie...' : 'Dodaj lokalizację'}
          </button>
        </div>
      </div>
    </div>
  );
}
