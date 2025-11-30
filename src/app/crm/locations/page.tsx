'use client';

import { useState, useEffect } from 'react';
import { MapPin, Plus, Edit, Trash2, Building, Phone, Mail, User, FileText, ExternalLink } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';
import GoogleMapsPicker from '@/components/crm/GoogleMapsPicker';

interface Location {
  id: string;
  name: string;
  address?: string;
  city?: string;
  postal_code?: string;
  country?: string;
  nip?: string;
  contact_person_name?: string;
  contact_phone?: string;
  contact_email?: string;
  notes?: string;
  latitude?: number;
  longitude?: number;
  google_maps_url?: string;
  google_place_id?: string;
  formatted_address?: string;
  created_at: string;
}

export default function LocationsPage() {
  const { showSnackbar } = useSnackbar();
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingLocation, setEditingLocation] = useState<Location | null>(null);
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

  useEffect(() => {
    fetchLocations();
  }, []);

  const fetchLocations = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('locations')
      .select('*')
      .order('name');

    if (error) {
      showSnackbar('Błąd podczas ładowania lokalizacji', 'error');
    } else {
      setLocations(data || []);
    }
    setLoading(false);
  };

  const handleOpenModal = (location?: Location) => {
    if (location) {
      setEditingLocation(location);
      setFormData({
        name: location.name,
        address: location.address || '',
        city: location.city || '',
        postal_code: location.postal_code || '',
        country: location.country || 'Polska',
        nip: location.nip || '',
        contact_person_name: location.contact_person_name || '',
        contact_phone: location.contact_phone || '',
        contact_email: location.contact_email || '',
        notes: location.notes || '',
        latitude: location.latitude || null,
        longitude: location.longitude || null,
        google_maps_url: location.google_maps_url || '',
        google_place_id: location.google_place_id || '',
        formatted_address: location.formatted_address || '',
      });
    } else {
      setEditingLocation(null);
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
    }
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!formData.name) {
      showSnackbar('Nazwa lokalizacji jest wymagana', 'error');
      return;
    }

    const dataToSave = {
      name: formData.name,
      address: formData.address || null,
      city: formData.city || null,
      postal_code: formData.postal_code || null,
      country: formData.country || 'Polska',
      nip: formData.nip || null,
      contact_person_name: formData.contact_person_name || null,
      contact_phone: formData.contact_phone || null,
      contact_email: formData.contact_email || null,
      notes: formData.notes || null,
      latitude: formData.latitude,
      longitude: formData.longitude,
      google_maps_url: formData.google_maps_url || null,
      google_place_id: formData.google_place_id || null,
      formatted_address: formData.formatted_address || null,
    };

    if (editingLocation) {
      const { error } = await supabase
        .from('locations')
        .update(dataToSave)
        .eq('id', editingLocation.id);

      if (error) {
        showSnackbar('Błąd podczas aktualizacji lokalizacji', 'error');
      } else {
        showSnackbar('Lokalizacja zaktualizowana!', 'success');
        setShowModal(false);
        fetchLocations();
      }
    } else {
      const { error } = await supabase
        .from('locations')
        .insert([dataToSave]);

      if (error) {
        showSnackbar('Błąd podczas dodawania lokalizacji', 'error');
      } else {
        showSnackbar('Lokalizacja dodana!', 'success');
        setShowModal(false);
        fetchLocations();
      }
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Czy na pewno chcesz usunąć tę lokalizację?')) return;

    const { error } = await supabase
      .from('locations')
      .delete()
      .eq('id', id);

    if (error) {
      showSnackbar('Błąd podczas usuwania lokalizacji', 'error');
    } else {
      showSnackbar('Lokalizacja usunięta', 'success');
      fetchLocations();
    }
  };

  return (
    <div className="min-h-screen bg-[#0f1117] p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-[#e5e4e2]">Lokalizacje</h1>
            <p className="text-[#e5e4e2]/60 mt-1">Zarządzaj bazą lokalizacji eventów</p>
          </div>
          <button
            onClick={() => handleOpenModal()}
            className="flex items-center gap-2 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg font-medium hover:bg-[#d3bb73]/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Dodaj lokalizację
          </button>
        </div>

        {/* Lista lokalizacji */}
        {loading ? (
          <div className="text-center py-12 text-[#e5e4e2]/50">Ładowanie...</div>
        ) : locations.length === 0 ? (
          <div className="text-center py-12 bg-[#1c1f33] rounded-lg border border-[#d3bb73]/20">
            <MapPin className="w-16 h-16 text-[#e5e4e2]/30 mx-auto mb-4" />
            <p className="text-[#e5e4e2]/60 mb-4">Brak lokalizacji</p>
            <button
              onClick={() => handleOpenModal()}
              className="text-[#d3bb73] hover:underline"
            >
              Dodaj pierwszą lokalizację
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {locations.map((location) => (
              <div
                key={location.id}
                className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg p-4 hover:border-[#d3bb73]/40 transition-colors"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <MapPin className="w-5 h-5 text-[#d3bb73]" />
                    <h3 className="font-semibold text-[#e5e4e2]">{location.name}</h3>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleOpenModal(location)}
                      className="p-1 hover:bg-[#d3bb73]/10 rounded transition-colors"
                    >
                      <Edit className="w-4 h-4 text-[#d3bb73]" />
                    </button>
                    <button
                      onClick={() => handleDelete(location.id)}
                      className="p-1 hover:bg-red-500/10 rounded transition-colors"
                    >
                      <Trash2 className="w-4 h-4 text-red-400" />
                    </button>
                  </div>
                </div>

                <div className="space-y-2 text-sm">
                  {location.address && (
                    <div className="flex items-start gap-2 text-[#e5e4e2]/70">
                      <Building className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <span>{location.address}</span>
                    </div>
                  )}

                  {location.city && (
                    <div className="text-[#e5e4e2]/70">
                      {location.postal_code && `${location.postal_code} `}
                      {location.city}
                    </div>
                  )}

                  {location.contact_person_name && (
                    <div className="flex items-center gap-2 text-[#e5e4e2]/70">
                      <User className="w-4 h-4" />
                      <span>{location.contact_person_name}</span>
                    </div>
                  )}

                  {location.contact_phone && (
                    <div className="flex items-center gap-2 text-[#e5e4e2]/70">
                      <Phone className="w-4 h-4" />
                      <span>{location.contact_phone}</span>
                    </div>
                  )}

                  {location.contact_email && (
                    <div className="flex items-center gap-2 text-[#e5e4e2]/70">
                      <Mail className="w-4 h-4" />
                      <span className="truncate">{location.contact_email}</span>
                    </div>
                  )}

                  {location.nip && (
                    <div className="flex items-center gap-2 text-[#e5e4e2]/70">
                      <FileText className="w-4 h-4" />
                      <span>NIP: {location.nip}</span>
                    </div>
                  )}

                  {/* Google Maps link */}
                  {location.google_maps_url && (
                    <div className="pt-2 mt-2 border-t border-[#d3bb73]/10">
                      <a
                        href={location.google_maps_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-[#d3bb73] hover:text-[#d3bb73]/80 transition-colors"
                      >
                        <ExternalLink className="w-4 h-4" />
                        <span className="text-sm">Zobacz w Google Maps</span>
                      </a>
                    </div>
                  )}

                  {/* Mini mapa - preview */}
                  {location.latitude && location.longitude && (
                    <div className="mt-2 rounded overflow-hidden border border-[#d3bb73]/20">
                      <a
                        href={location.google_maps_url || `https://www.google.com/maps?q=${location.latitude},${location.longitude}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block"
                      >
                        <img
                          src={`https://maps.googleapis.com/maps/api/staticmap?center=${location.latitude},${location.longitude}&zoom=14&size=400x200&markers=color:red%7C${location.latitude},${location.longitude}&key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}`}
                          alt="Mapa lokalizacji"
                          className="w-full h-32 object-cover hover:opacity-80 transition-opacity"
                          onError={(e) => {
                            // Fallback - pokaż iframe zamiast static map
                            e.currentTarget.style.display = 'none';
                          }}
                        />
                      </a>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Modal */}
        {showModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-[#1c1f33] rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <div className="p-6 border-b border-[#d3bb73]/20">
                <h2 className="text-xl font-bold text-[#e5e4e2]">
                  {editingLocation ? 'Edytuj lokalizację' : 'Dodaj lokalizację'}
                </h2>
              </div>

              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                    Nazwa lokalizacji *
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-4 py-2 bg-[#0f1117] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/50"
                    placeholder="np. Hotel Marriott Warsaw"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                      Adres
                    </label>
                    <input
                      type="text"
                      value={formData.address}
                      onChange={(e) => setFormData({ ...formData, address: e.target.value })}
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
                      onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                      className="w-full px-4 py-2 bg-[#0f1117] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/50"
                      placeholder="Warszawa"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                      Kod pocztowy
                    </label>
                    <input
                      type="text"
                      value={formData.postal_code}
                      onChange={(e) => setFormData({ ...formData, postal_code: e.target.value })}
                      className="w-full px-4 py-2 bg-[#0f1117] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/50"
                      placeholder="00-000"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                      NIP
                    </label>
                    <input
                      type="text"
                      value={formData.nip}
                      onChange={(e) => setFormData({ ...formData, nip: e.target.value })}
                      className="w-full px-4 py-2 bg-[#0f1117] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/50"
                      placeholder="123-456-78-90"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                    Osoba kontaktowa
                  </label>
                  <input
                    type="text"
                    value={formData.contact_person_name}
                    onChange={(e) => setFormData({ ...formData, contact_person_name: e.target.value })}
                    className="w-full px-4 py-2 bg-[#0f1117] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/50"
                    placeholder="Jan Kowalski"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                      Telefon
                    </label>
                    <input
                      type="tel"
                      value={formData.contact_phone}
                      onChange={(e) => setFormData({ ...formData, contact_phone: e.target.value })}
                      className="w-full px-4 py-2 bg-[#0f1117] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/50"
                      placeholder="+48 123 456 789"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                      Email
                    </label>
                    <input
                      type="email"
                      value={formData.contact_email}
                      onChange={(e) => setFormData({ ...formData, contact_email: e.target.value })}
                      className="w-full px-4 py-2 bg-[#0f1117] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/50"
                      placeholder="kontakt@example.com"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                    Notatki
                  </label>
                  <textarea
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    rows={3}
                    className="w-full px-4 py-2 bg-[#0f1117] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/50"
                    placeholder="Dodatkowe informacje..."
                  />
                </div>

                {/* Google Maps Picker */}
                <div className="pt-4 border-t border-[#d3bb73]/10">
                  <GoogleMapsPicker
                    latitude={formData.latitude}
                    longitude={formData.longitude}
                    onLocationSelect={(data) => {
                      setFormData({
                        ...formData,
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

              <div className="flex items-center justify-end gap-3 p-6 border-t border-[#d3bb73]/20">
                <button
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-[#e5e4e2] hover:bg-[#d3bb73]/10 rounded-lg transition-colors"
                >
                  Anuluj
                </button>
                <button
                  onClick={handleSave}
                  className="px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg font-medium hover:bg-[#d3bb73]/90 transition-colors"
                >
                  {editingLocation ? 'Zapisz zmiany' : 'Dodaj lokalizację'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
