'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Plus, Edit2, Trash2, MapPin, Save, X, Globe } from 'lucide-react';

interface SchemaOrgGlobal {
  id: string;
  organization_name: string;
  organization_url: string;
  organization_logo: string | null;
  telephone: string | null;
  email: string | null;
  facebook_url: string | null;
  instagram_url: string | null;
  linkedin_url: string | null;
  youtube_url: string | null;
  twitter_url: string | null;
  street_address: string | null;
  locality: string | null;
  postal_code: string | null;
  region: string | null;
  country: string;
  default_image: string | null;
}

interface SchemaOrgPlace {
  id: string;
  name: string;
  locality: string;
  postal_code: string | null;
  region: string | null;
  country: string;
  display_order: number;
  is_active: boolean;
  is_global: boolean;
}

export default function SchemaOrgManagementPage() {
  const [globalConfig, setGlobalConfig] = useState<SchemaOrgGlobal | null>(null);
  const [places, setPlaces] = useState<SchemaOrgPlace[]>([]);
  const [isEditingGlobal, setIsEditingGlobal] = useState(false);
  const [editGlobalData, setEditGlobalData] = useState<Partial<SchemaOrgGlobal>>({});
  const [isAddingPlace, setIsAddingPlace] = useState(false);
  const [newPlace, setNewPlace] = useState({
    name: '',
    locality: '',
    postal_code: '',
    region: 'Województwo Mazowieckie',
  });
  const [citySearch, setCitySearch] = useState('');
  const [citySuggestions, setCitySuggestions] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (citySearch.length >= 2) {
      searchCities(citySearch);
    } else {
      setCitySuggestions([]);
      setShowSuggestions(false);
    }
  }, [citySearch]);

  const loadData = async () => {
    const [globalRes, placesRes] = await Promise.all([
      supabase.from('schema_org_global').select('*').single(),
      supabase.from('schema_org_places').select('*').eq('is_global', true).eq('is_active', true).order('display_order'),
    ]);

    if (globalRes.data) setGlobalConfig(globalRes.data);
    if (placesRes.data) setPlaces(placesRes.data);
  };

  const searchCities = async (query: string) => {
    const normalizedQuery = query
      .toLowerCase()
      .replace(/ą/g, 'a')
      .replace(/ć/g, 'c')
      .replace(/ę/g, 'e')
      .replace(/ł/g, 'l')
      .replace(/ń/g, 'n')
      .replace(/ó/g, 'o')
      .replace(/ś/g, 's')
      .replace(/ź|ż/g, 'z');

    const addedLocalities = places.map(p => p.locality.toLowerCase());

    const { data, error } = await supabase
      .from('polish_cities')
      .select('*')
      .or(`name.ilike.%${query}%,slug.ilike.%${normalizedQuery}%`)
      .order('population', { ascending: false })
      .limit(20);

    if (data && !error) {
      const filtered = data.filter(city => !addedLocalities.includes(city.slug.toLowerCase()));
      setCitySuggestions(filtered.slice(0, 10));
      setShowSuggestions(true);
    }
  };

  const selectCity = (city: any) => {
    setNewPlace({
      name: city.name,
      locality: city.slug,
      postal_code: city.postal_code,
      region: city.region,
    });
    setCitySearch('');
    setShowSuggestions(false);
  };

  const handleSaveGlobal = async () => {
    if (!globalConfig) return;

    const { error } = await supabase
      .from('schema_org_global')
      .update({
        ...editGlobalData,
        updated_at: new Date().toISOString(),
      })
      .eq('id', globalConfig.id);

    if (error) {
      alert('Błąd podczas zapisywania');
      console.error(error);
      return;
    }

    alert('Dane zapisane!');
    setIsEditingGlobal(false);
    loadData();
  };

  const handleAddPlace = async () => {
    if (!newPlace.name || !newPlace.locality) {
      alert('Wypełnij wymagane pola');
      return;
    }

    const { error} = await supabase
      .from('schema_org_places')
      .insert({
        name: newPlace.name,
        locality: newPlace.locality.toLowerCase(),
        postal_code: newPlace.postal_code,
        region: newPlace.region,
        country: 'PL',
        display_order: places.length,
        is_active: true,
        is_global: true,
      });

    if (error) {
      alert('Błąd podczas dodawania miejsca');
      console.error(error);
      return;
    }

    setNewPlace({ name: '', locality: '', postal_code: '', region: 'Województwo Mazowieckie' });
    setIsAddingPlace(false);
    loadData();
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

    loadData();
  };

  const startEditingGlobal = () => {
    setEditGlobalData(globalConfig || {});
    setIsEditingGlobal(true);
  };

  if (!globalConfig) {
    return (
      <div className="min-h-screen bg-[#0f1119] flex items-center justify-center">
        <div className="text-[#d3bb73]">Ładowanie...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f1119] text-[#e5e4e2] p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-light mb-2">Dane strukturalne Schema.org</h1>
          <p className="text-[#e5e4e2]/60">
            Globalna konfiguracja danych strukturalnych dla wszystkich podstron
          </p>
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          {/* Global Configuration */}
          <div className="bg-[#1c1f33] rounded-lg p-6 border border-[#d3bb73]/20">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-medium flex items-center gap-2">
                <Globe className="w-5 h-5" />
                Dane globalne
              </h2>
              {!isEditingGlobal && (
                <button
                  onClick={startEditingGlobal}
                  className="px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded hover:bg-[#d3bb73]/90 transition-colors flex items-center gap-2"
                >
                  <Edit2 className="w-4 h-4" />
                  Edytuj
                </button>
              )}
              {isEditingGlobal && (
                <div className="flex gap-2">
                  <button
                    onClick={handleSaveGlobal}
                    className="px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded hover:bg-[#d3bb73]/90 transition-colors flex items-center gap-2"
                  >
                    <Save className="w-4 h-4" />
                    Zapisz
                  </button>
                  <button
                    onClick={() => setIsEditingGlobal(false)}
                    className="px-4 py-2 bg-[#800020]/20 text-[#e5e4e2] rounded hover:bg-[#800020]/30 transition-colors flex items-center gap-2"
                  >
                    <X className="w-4 h-4" />
                    Anuluj
                  </button>
                </div>
              )}
            </div>

            <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-2">
              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-1">Nazwa organizacji</label>
                {isEditingGlobal ? (
                  <input
                    type="text"
                    value={editGlobalData.organization_name || ''}
                    onChange={(e) => setEditGlobalData({ ...editGlobalData, organization_name: e.target.value })}
                    className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded px-3 py-2 outline-none focus:border-[#d3bb73]"
                  />
                ) : (
                  <p className="text-[#e5e4e2]">{globalConfig.organization_name}</p>
                )}
              </div>

              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-1">URL organizacji</label>
                {isEditingGlobal ? (
                  <input
                    type="url"
                    value={editGlobalData.organization_url || ''}
                    onChange={(e) => setEditGlobalData({ ...editGlobalData, organization_url: e.target.value })}
                    className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded px-3 py-2 outline-none focus:border-[#d3bb73]"
                  />
                ) : (
                  <p className="text-[#e5e4e2]">{globalConfig.organization_url}</p>
                )}
              </div>

              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-1">Logo (URL)</label>
                {isEditingGlobal ? (
                  <input
                    type="url"
                    value={editGlobalData.organization_logo || ''}
                    onChange={(e) => setEditGlobalData({ ...editGlobalData, organization_logo: e.target.value })}
                    className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded px-3 py-2 outline-none focus:border-[#d3bb73]"
                  />
                ) : (
                  <p className="text-[#e5e4e2] truncate">{globalConfig.organization_logo}</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-[#e5e4e2]/60 mb-1">Telefon</label>
                  {isEditingGlobal ? (
                    <input
                      type="text"
                      value={editGlobalData.telephone || ''}
                      onChange={(e) => setEditGlobalData({ ...editGlobalData, telephone: e.target.value })}
                      className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded px-3 py-2 outline-none focus:border-[#d3bb73]"
                    />
                  ) : (
                    <p className="text-[#e5e4e2]">{globalConfig.telephone}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm text-[#e5e4e2]/60 mb-1">Email</label>
                  {isEditingGlobal ? (
                    <input
                      type="email"
                      value={editGlobalData.email || ''}
                      onChange={(e) => setEditGlobalData({ ...editGlobalData, email: e.target.value })}
                      className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded px-3 py-2 outline-none focus:border-[#d3bb73]"
                    />
                  ) : (
                    <p className="text-[#e5e4e2]">{globalConfig.email}</p>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">Social Media (sameAs)</label>
                <div className="space-y-2">
                  {[
                    { key: 'facebook_url', label: 'Facebook' },
                    { key: 'instagram_url', label: 'Instagram' },
                    { key: 'linkedin_url', label: 'LinkedIn' },
                    { key: 'youtube_url', label: 'YouTube' },
                    { key: 'twitter_url', label: 'Twitter/X' },
                  ].map(({ key, label }) => (
                    <div key={key}>
                      <label className="block text-xs text-[#e5e4e2]/40 mb-1">{label}</label>
                      {isEditingGlobal ? (
                        <input
                          type="url"
                          value={(editGlobalData as any)[key] || ''}
                          onChange={(e) => setEditGlobalData({ ...editGlobalData, [key]: e.target.value })}
                          placeholder={`https://${label.toLowerCase()}.com/...`}
                          className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded px-3 py-1.5 text-sm outline-none focus:border-[#d3bb73]"
                        />
                      ) : (
                        <p className="text-[#e5e4e2]/70 text-sm truncate">{(globalConfig as any)[key] || '-'}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">Adres głównej siedziby</label>
                {isEditingGlobal ? (
                  <div className="space-y-2">
                    <input
                      type="text"
                      placeholder="Ulica"
                      value={editGlobalData.street_address || ''}
                      onChange={(e) => setEditGlobalData({ ...editGlobalData, street_address: e.target.value })}
                      className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded px-3 py-2 outline-none focus:border-[#d3bb73]"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        placeholder="Miasto"
                        value={editGlobalData.locality || ''}
                        onChange={(e) => setEditGlobalData({ ...editGlobalData, locality: e.target.value })}
                        className="bg-[#0f1119] border border-[#d3bb73]/20 rounded px-3 py-2 outline-none focus:border-[#d3bb73]"
                      />
                      <input
                        type="text"
                        placeholder="Kod pocztowy"
                        value={editGlobalData.postal_code || ''}
                        onChange={(e) => setEditGlobalData({ ...editGlobalData, postal_code: e.target.value })}
                        className="bg-[#0f1119] border border-[#d3bb73]/20 rounded px-3 py-2 outline-none focus:border-[#d3bb73]"
                      />
                    </div>
                    <input
                      type="text"
                      placeholder="Województwo"
                      value={editGlobalData.region || ''}
                      onChange={(e) => setEditGlobalData({ ...editGlobalData, region: e.target.value })}
                      className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded px-3 py-2 outline-none focus:border-[#d3bb73]"
                    />
                  </div>
                ) : (
                  <p className="text-[#e5e4e2]/70 text-sm">
                    {globalConfig.street_address}<br />
                    {globalConfig.locality} {globalConfig.postal_code}<br />
                    {globalConfig.region}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Global Places (areaServed) */}
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
                Dodaj
              </button>
            </div>

            <p className="text-[#e5e4e2]/60 text-sm mb-4">
              Te miejsca będą dostępne jako <code className="text-[#d3bb73]">areaServed</code> na wszystkich podstronach
            </p>

            {isAddingPlace && (
              <div className="mb-4 p-4 bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg space-y-3">
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Wpisz nazwę miasta (np. Olsztyn)"
                    value={citySearch}
                    onChange={(e) => setCitySearch(e.target.value)}
                    className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded px-3 py-2 outline-none focus:border-[#d3bb73]"
                  />
                  {showSuggestions && citySuggestions.length > 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-[#1c1f33] border border-[#d3bb73]/20 rounded shadow-lg max-h-60 overflow-y-auto">
                      {citySuggestions.map((city) => (
                        <button
                          key={city.id}
                          onClick={() => selectCity(city)}
                          className="w-full px-3 py-2 text-left hover:bg-[#d3bb73]/10 transition-colors"
                        >
                          <div className="font-medium text-[#e5e4e2]">{city.name}</div>
                          <div className="text-sm text-[#e5e4e2]/60">
                            {city.postal_code} · {city.region}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="p-3 bg-[#1c1f33] border border-[#d3bb73]/10 rounded">
                  <div className="text-xs text-[#e5e4e2]/40 mb-2">Wybrane miasto:</div>
                  {newPlace.name ? (
                    <div>
                      <div className="font-medium text-[#e5e4e2]">{newPlace.name}</div>
                      <div className="text-sm text-[#e5e4e2]/60">
                        {newPlace.locality} · {newPlace.postal_code} · {newPlace.region}
                      </div>
                    </div>
                  ) : (
                    <div className="text-[#e5e4e2]/40 text-sm">Wyszukaj miasto...</div>
                  )}
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

            <div className="space-y-2 max-h-[60vh] overflow-y-auto">
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
      </div>
    </div>
  );
}
