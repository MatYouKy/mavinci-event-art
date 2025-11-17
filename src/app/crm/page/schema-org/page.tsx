'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Plus, Edit2, Trash2, MapPin, Save, X } from 'lucide-react';

interface SchemaOrgBusiness {
  id: string;
  page_slug: string;
  schema_type: string;
  name: string;
  description: string | null;
  telephone: string | null;
  email: string | null;
  url: string | null;
  price_range: string | null;
  opening_hours: string | null;
  street_address: string | null;
  locality: string | null;
  postal_code: string | null;
  region: string | null;
  country: string;
  facebook_url: string | null;
  instagram_url: string | null;
  linkedin_url: string | null;
  rating_value: number | null;
  best_rating: number;
  review_count: number;
  is_active: boolean;
}

interface SchemaOrgPlace {
  id: string;
  business_id: string;
  name: string;
  locality: string;
  postal_code: string | null;
  region: string | null;
  country: string;
  display_order: number;
  is_active: boolean;
}

export default function SchemaOrgManagementPage() {
  const [businesses, setBusinesses] = useState<SchemaOrgBusiness[]>([]);
  const [places, setPlaces] = useState<SchemaOrgPlace[]>([]);
  const [selectedBusiness, setSelectedBusiness] = useState<SchemaOrgBusiness | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState<Partial<SchemaOrgBusiness>>({});
  const [isAddingPlace, setIsAddingPlace] = useState(false);
  const [newPlace, setNewPlace] = useState({
    name: '',
    locality: '',
    postal_code: '',
    region: 'Województwo Mazowieckie',
  });

  useEffect(() => {
    loadBusinesses();
  }, []);

  useEffect(() => {
    if (selectedBusiness) {
      loadPlaces(selectedBusiness.id);
    }
  }, [selectedBusiness]);

  const loadBusinesses = async () => {
    const { data, error } = await supabase
      .from('schema_org_business')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error loading businesses:', error);
      return;
    }

    setBusinesses(data || []);
    if (data && data.length > 0 && !selectedBusiness) {
      setSelectedBusiness(data[0]);
    }
  };

  const loadPlaces = async (businessId: string) => {
    const { data, error } = await supabase
      .from('schema_org_places')
      .select('*')
      .eq('business_id', businessId)
      .order('display_order');

    if (error) {
      console.error('Error loading places:', error);
      return;
    }

    setPlaces(data || []);
  };

  const handleSaveBusiness = async () => {
    if (!selectedBusiness) return;

    const { error } = await supabase
      .from('schema_org_business')
      .update({
        ...editData,
        updated_at: new Date().toISOString(),
      })
      .eq('id', selectedBusiness.id);

    if (error) {
      alert('Błąd podczas zapisywania');
      console.error(error);
      return;
    }

    alert('Dane zapisane!');
    setIsEditing(false);
    loadBusinesses();
  };

  const handleAddPlace = async () => {
    if (!selectedBusiness || !newPlace.name || !newPlace.locality) {
      alert('Wypełnij wymagane pola');
      return;
    }

    const { error } = await supabase
      .from('schema_org_places')
      .insert({
        business_id: selectedBusiness.id,
        name: newPlace.name,
        locality: newPlace.locality.toLowerCase(),
        postal_code: newPlace.postal_code,
        region: newPlace.region,
        country: 'PL',
        display_order: places.length,
        is_active: true,
      });

    if (error) {
      alert('Błąd podczas dodawania miejsca');
      console.error(error);
      return;
    }

    setNewPlace({ name: '', locality: '', postal_code: '', region: 'Województwo Mazowieckie' });
    setIsAddingPlace(false);
    loadPlaces(selectedBusiness.id);
  };

  const handleDeletePlace = async (placeId: string) => {
    if (!confirm('Czy na pewno usunąć to miejsce?')) return;

    const { error } = await supabase
      .from('schema_org_places')
      .delete()
      .eq('id', placeId);

    if (error) {
      alert('Błąd podczas usuwania');
      console.error(error);
      return;
    }

    if (selectedBusiness) {
      loadPlaces(selectedBusiness.id);
    }
  };

  const startEditing = () => {
    setEditData(selectedBusiness || {});
    setIsEditing(true);
  };

  return (
    <div className="min-h-screen bg-[#0f1119] text-[#e5e4e2] p-6">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-light mb-8">Dane strukturalne Schema.org</h1>

        {/* Business Selector */}
        <div className="mb-6">
          <label className="block text-sm text-[#e5e4e2]/60 mb-2">Wybierz stronę:</label>
          <select
            value={selectedBusiness?.id || ''}
            onChange={(e) => {
              const business = businesses.find((b) => b.id === e.target.value);
              setSelectedBusiness(business || null);
              setIsEditing(false);
            }}
            className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-3 text-[#e5e4e2] outline-none focus:border-[#d3bb73]"
          >
            {businesses.map((business) => (
              <option key={business.id} value={business.id}>
                {business.name} ({business.page_slug})
              </option>
            ))}
          </select>
        </div>

        {selectedBusiness && (
          <div className="grid lg:grid-cols-2 gap-6">
            {/* Business Data */}
            <div className="bg-[#1c1f33] rounded-lg p-6 border border-[#d3bb73]/20">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-medium">Dane firmy</h2>
                {!isEditing && (
                  <button
                    onClick={startEditing}
                    className="px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded hover:bg-[#d3bb73]/90 transition-colors flex items-center gap-2"
                  >
                    <Edit2 className="w-4 h-4" />
                    Edytuj
                  </button>
                )}
                {isEditing && (
                  <div className="flex gap-2">
                    <button
                      onClick={handleSaveBusiness}
                      className="px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded hover:bg-[#d3bb73]/90 transition-colors flex items-center gap-2"
                    >
                      <Save className="w-4 h-4" />
                      Zapisz
                    </button>
                    <button
                      onClick={() => setIsEditing(false)}
                      className="px-4 py-2 bg-[#800020]/20 text-[#e5e4e2] rounded hover:bg-[#800020]/30 transition-colors flex items-center gap-2"
                    >
                      <X className="w-4 h-4" />
                      Anuluj
                    </button>
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-[#e5e4e2]/60 mb-1">Nazwa</label>
                  {isEditing ? (
                    <input
                      type="text"
                      value={editData.name || ''}
                      onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                      className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded px-3 py-2 outline-none focus:border-[#d3bb73]"
                    />
                  ) : (
                    <p className="text-[#e5e4e2]">{selectedBusiness.name}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm text-[#e5e4e2]/60 mb-1">Opis</label>
                  {isEditing ? (
                    <textarea
                      value={editData.description || ''}
                      onChange={(e) => setEditData({ ...editData, description: e.target.value })}
                      rows={3}
                      className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded px-3 py-2 outline-none focus:border-[#d3bb73] resize-none"
                    />
                  ) : (
                    <p className="text-[#e5e4e2]/70 text-sm">{selectedBusiness.description}</p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-[#e5e4e2]/60 mb-1">Telefon</label>
                    {isEditing ? (
                      <input
                        type="text"
                        value={editData.telephone || ''}
                        onChange={(e) => setEditData({ ...editData, telephone: e.target.value })}
                        className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded px-3 py-2 outline-none focus:border-[#d3bb73]"
                      />
                    ) : (
                      <p className="text-[#e5e4e2]">{selectedBusiness.telephone}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm text-[#e5e4e2]/60 mb-1">Email</label>
                    {isEditing ? (
                      <input
                        type="email"
                        value={editData.email || ''}
                        onChange={(e) => setEditData({ ...editData, email: e.target.value })}
                        className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded px-3 py-2 outline-none focus:border-[#d3bb73]"
                      />
                    ) : (
                      <p className="text-[#e5e4e2]">{selectedBusiness.email}</p>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-sm text-[#e5e4e2]/60 mb-1">Adres</label>
                  {isEditing ? (
                    <div className="space-y-2">
                      <input
                        type="text"
                        placeholder="Ulica"
                        value={editData.street_address || ''}
                        onChange={(e) => setEditData({ ...editData, street_address: e.target.value })}
                        className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded px-3 py-2 outline-none focus:border-[#d3bb73]"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="text"
                          placeholder="Miasto"
                          value={editData.locality || ''}
                          onChange={(e) => setEditData({ ...editData, locality: e.target.value })}
                          className="bg-[#0f1119] border border-[#d3bb73]/20 rounded px-3 py-2 outline-none focus:border-[#d3bb73]"
                        />
                        <input
                          type="text"
                          placeholder="Kod pocztowy"
                          value={editData.postal_code || ''}
                          onChange={(e) => setEditData({ ...editData, postal_code: e.target.value })}
                          className="bg-[#0f1119] border border-[#d3bb73]/20 rounded px-3 py-2 outline-none focus:border-[#d3bb73]"
                        />
                      </div>
                    </div>
                  ) : (
                    <p className="text-[#e5e4e2]/70 text-sm">
                      {selectedBusiness.street_address}, {selectedBusiness.locality} {selectedBusiness.postal_code}
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm text-[#e5e4e2]/60 mb-1">Ocena</label>
                    {isEditing ? (
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        max="5"
                        value={editData.rating_value || ''}
                        onChange={(e) => setEditData({ ...editData, rating_value: parseFloat(e.target.value) })}
                        className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded px-3 py-2 outline-none focus:border-[#d3bb73]"
                      />
                    ) : (
                      <p className="text-[#e5e4e2]">{selectedBusiness.rating_value}/5</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm text-[#e5e4e2]/60 mb-1">Opinie</label>
                    {isEditing ? (
                      <input
                        type="number"
                        value={editData.review_count || ''}
                        onChange={(e) => setEditData({ ...editData, review_count: parseInt(e.target.value) })}
                        className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded px-3 py-2 outline-none focus:border-[#d3bb73]"
                      />
                    ) : (
                      <p className="text-[#e5e4e2]">{selectedBusiness.review_count}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm text-[#e5e4e2]/60 mb-1">Ceny</label>
                    {isEditing ? (
                      <input
                        type="text"
                        value={editData.price_range || ''}
                        onChange={(e) => setEditData({ ...editData, price_range: e.target.value })}
                        className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded px-3 py-2 outline-none focus:border-[#d3bb73]"
                      />
                    ) : (
                      <p className="text-[#e5e4e2]">{selectedBusiness.price_range}</p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Places (areaServed) */}
            <div className="bg-[#1c1f33] rounded-lg p-6 border border-[#d3bb73]/20">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-medium flex items-center gap-2">
                  <MapPin className="w-5 h-5" />
                  Obszary obsługi ({places.length})
                </h2>
                <button
                  onClick={() => setIsAddingPlace(true)}
                  className="px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded hover:bg-[#d3bb73]/90 transition-colors flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  Dodaj miejsce
                </button>
              </div>

              {isAddingPlace && (
                <div className="mb-4 p-4 bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg space-y-3">
                  <input
                    type="text"
                    placeholder="Nazwa miasta (np. Warszawa)"
                    value={newPlace.name}
                    onChange={(e) => setNewPlace({ ...newPlace, name: e.target.value })}
                    className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded px-3 py-2 outline-none focus:border-[#d3bb73]"
                  />
                  <input
                    type="text"
                    placeholder="Locality (slug, np. warszawa)"
                    value={newPlace.locality}
                    onChange={(e) => setNewPlace({ ...newPlace, locality: e.target.value })}
                    className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded px-3 py-2 outline-none focus:border-[#d3bb73]"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      placeholder="Kod pocztowy"
                      value={newPlace.postal_code}
                      onChange={(e) => setNewPlace({ ...newPlace, postal_code: e.target.value })}
                      className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded px-3 py-2 outline-none focus:border-[#d3bb73]"
                    />
                    <input
                      type="text"
                      placeholder="Województwo"
                      value={newPlace.region}
                      onChange={(e) => setNewPlace({ ...newPlace, region: e.target.value })}
                      className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded px-3 py-2 outline-none focus:border-[#d3bb73]"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleAddPlace}
                      className="px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded hover:bg-[#d3bb73]/90 transition-colors"
                    >
                      Dodaj
                    </button>
                    <button
                      onClick={() => {
                        setIsAddingPlace(false);
                        setNewPlace({ name: '', locality: '', postal_code: '', region: 'Województwo Mazowieckie' });
                      }}
                      className="px-4 py-2 bg-[#800020]/20 text-[#e5e4e2] rounded hover:bg-[#800020]/30 transition-colors"
                    >
                      Anuluj
                    </button>
                  </div>
                </div>
              )}

              <div className="space-y-2 max-h-[600px] overflow-y-auto">
                {places.map((place) => (
                  <div
                    key={place.id}
                    className="flex items-center justify-between p-3 bg-[#0f1119] border border-[#d3bb73]/10 rounded hover:border-[#d3bb73]/30 transition-colors"
                  >
                    <div>
                      <p className="text-[#e5e4e2] font-medium">{place.name}</p>
                      <p className="text-[#e5e4e2]/60 text-sm">
                        {place.locality} {place.postal_code && `· ${place.postal_code}`}
                      </p>
                      <p className="text-[#e5e4e2]/40 text-xs">{place.region}</p>
                    </div>
                    <button
                      onClick={() => handleDeletePlace(place.id)}
                      className="text-[#800020] hover:text-[#800020]/80 p-2"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
