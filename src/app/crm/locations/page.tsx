'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  MapPin,
  Plus,
  Edit,
  Trash2,
  Building,
  Phone,
  Mail,
  User,
  FileText,
  ExternalLink,
  Search,
  Grid3x3,
  List,
  Table2,
  SortAsc,
  SortDesc,
  Filter,
  X,
  MapPinned,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';
import GoogleMapsPicker from '@/components/crm/GoogleMapsPicker';
import { ILocation } from './type';
import { useLocations } from './useLocations';
import { useDialog } from '@/contexts/DialogContext';

type ViewMode = 'grid' | 'list' | 'table';
type SortField = 'name' | 'city' | 'created_at';
type SortDirection = 'asc' | 'desc';

export default function LocationsPage() {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const {
    list: locations,
    loading: isLoading,
    error,
    updateById,
    create,
    deleteById,
  } = useLocations();
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingLocation, setEditingLocation] = useState<ILocation | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [cityFilter, setCityFilter] = useState<string>('all');

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

  // Filtrowanie i sortowanie
  const filteredAndSortedLocations = useMemo(() => {
    let filtered = locations as unknown as ILocation[];

    // Wyszukiwanie
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (loc) =>
          loc.name.toLowerCase().includes(query) ||
          loc.city?.toLowerCase().includes(query) ||
          loc.address?.toLowerCase().includes(query) ||
          loc.contact_person_name?.toLowerCase().includes(query),
      );
    }

    // Filtr miasta
    if (cityFilter !== 'all') {
      filtered = filtered.filter((loc) => loc.city === cityFilter);
    }

    // Sortowanie
    filtered.sort((a, b) => {
      let aVal: any = a[sortField];
      let bVal: any = b[sortField];

      if (sortField === 'created_at') {
        aVal = new Date(aVal).getTime();
        bVal = new Date(bVal).getTime();
      } else {
        aVal = aVal?.toLowerCase() || '';
        bVal = bVal?.toLowerCase() || '';
      }

      if (sortDirection === 'asc') {
        return aVal > bVal ? 1 : -1;
      } else {
        return aVal < bVal ? 1 : -1;
      }
    });

    return filtered;
  }, [locations, searchQuery, sortField, sortDirection, cityFilter]);

  // Lista unikalnych miast
  const cities = useMemo(() => {
    const citySet = new Set<string>();
    (locations as unknown as ILocation[]).forEach((loc: ILocation) => {
      if (loc.city) citySet.add(loc.city);
    });
    return Array.from(citySet).sort();
  }, [locations]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const handleOpenModal = (location?: ILocation) => {
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

    try {
    if (editingLocation) {
      await updateById(editingLocation.id, dataToSave);
    } else {
      await create(dataToSave);
    }
  } catch (error) {
    showSnackbar('Błąd podczas zapisywania lokalizacji', 'error');
  } finally {
    setLoading(false);
  }


  };

  const handleDelete = async (id: string) => {
    const confirmed = await showConfirm(
      'Czy na pewno chcesz usunąć tę lokalizację?',
      'Potwierdzenie',
    );
    if (!confirmed) return;

    try {
      await deleteById(id);
      showSnackbar('Lokalizacja usunięta', 'success');
    } catch (error) {
      showSnackbar('Błąd podczas usuwania lokalizacji', 'error');
    } finally {
      setShowModal(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0f1117] p-6">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[#e5e4e2]">Lokalizacje</h1>
            <p className="mt-1 text-[#e5e4e2]/60">
              {filteredAndSortedLocations.length}{' '}
              {filteredAndSortedLocations.length === 1 ? 'lokalizacja' : 'lokalizacji'}
            </p>
          </div>
          <button
            onClick={() => handleOpenModal()}
            className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
          >
            <Plus className="h-4 w-4" />
            Dodaj lokalizację
          </button>
        </div>

        {/* Toolbar - Search, Filters, View modes */}
        <div className="mb-6 rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] p-4">
          <div className="flex flex-col gap-4 lg:flex-row">
            {/* Search */}
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#e5e4e2]/50" />
                <input
                  type="text"
                  placeholder="Szukaj po nazwie, mieście, adresie..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] py-2 pl-10 pr-10 text-sm text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#e5e4e2]/50 hover:text-[#e5e4e2]"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>

            {/* City Filter */}
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-[#e5e4e2]/50" />
              <select
                value={cityFilter}
                onChange={(e) => setCityFilter(e.target.value)}
                className="rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
              >
                <option value="all">Wszystkie miasta</option>
                {cities.map((city) => (
                  <option key={city} value={city}>
                    {city}
                  </option>
                ))}
              </select>
            </div>

            {/* Sort */}
            <div className="flex items-center gap-2">
              <select
                value={sortField}
                onChange={(e) => setSortField(e.target.value as SortField)}
                className="rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
              >
                <option value="name">Nazwa</option>
                <option value="city">Miasto</option>
                <option value="created_at">Data dodania</option>
              </select>
              <button
                onClick={() => setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')}
                className="rounded-lg p-2 transition-colors hover:bg-[#d3bb73]/10"
                title={sortDirection === 'asc' ? 'Rosnąco' : 'Malejąco'}
              >
                {sortDirection === 'asc' ? (
                  <SortAsc className="h-4 w-4 text-[#d3bb73]" />
                ) : (
                  <SortDesc className="h-4 w-4 text-[#d3bb73]" />
                )}
              </button>
            </div>

            {/* View Mode Toggle */}
            <div className="flex items-center gap-1 rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] p-1">
              <button
                onClick={() => setViewMode('grid')}
                className={`rounded p-2 transition-colors ${
                  viewMode === 'grid'
                    ? 'bg-[#d3bb73] text-[#1c1f33]'
                    : 'text-[#e5e4e2]/50 hover:text-[#e5e4e2]'
                }`}
                title="Siatka"
              >
                <Grid3x3 className="h-4 w-4" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`rounded p-2 transition-colors ${
                  viewMode === 'list'
                    ? 'bg-[#d3bb73] text-[#1c1f33]'
                    : 'text-[#e5e4e2]/50 hover:text-[#e5e4e2]'
                }`}
                title="Lista"
              >
                <List className="h-4 w-4" />
              </button>
              <button
                onClick={() => setViewMode('table')}
                className={`rounded p-2 transition-colors ${
                  viewMode === 'table'
                    ? 'bg-[#d3bb73] text-[#1c1f33]'
                    : 'text-[#e5e4e2]/50 hover:text-[#e5e4e2]'
                }`}
                title="Tabela"
              >
                <Table2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="py-12 text-center text-[#e5e4e2]/50">Ładowanie...</div>
        ) : filteredAndSortedLocations.length === 0 ? (
          <div className="rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] py-12 text-center">
            <MapPin className="mx-auto mb-4 h-16 w-16 text-[#e5e4e2]/30" />
            <p className="mb-4 text-[#e5e4e2]/60">
              {searchQuery || cityFilter !== 'all'
                ? 'Brak lokalizacji pasujących do filtrów'
                : 'Brak lokalizacji'}
            </p>
            {(searchQuery || cityFilter !== 'all') && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setCityFilter('all');
                }}
                className="text-[#d3bb73] hover:underline"
              >
                Wyczyść filtry
              </button>
            )}
            {!searchQuery && cityFilter === 'all' && (
              <button onClick={() => handleOpenModal()} className="text-[#d3bb73] hover:underline">
                Dodaj pierwszą lokalizację
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Grid View */}
            {viewMode === 'grid' && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {filteredAndSortedLocations.map((location) => (
                  <LocationCardGrid
                    key={location.id}
                    location={location}
                    onEdit={() => handleOpenModal(location)}
                    onDelete={() => handleDelete(location.id)}
                    onClick={() => router.push(`/crm/locations/${location.id}`)}
                  />
                ))}
              </div>
            )}

            {/* List View */}
            {viewMode === 'list' && (
              <div className="space-y-3">
                {filteredAndSortedLocations.map((location) => (
                  <LocationCardList
                    key={location.id}
                    location={location}
                    onEdit={() => handleOpenModal(location)}
                    onDelete={() => handleDelete(location.id)}
                    onClick={() => router.push(`/crm/locations/${location.id}`)}
                  />
                ))}
              </div>
            )}

            {/* Table View */}
            {viewMode === 'table' && (
              <div className="overflow-hidden rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33]">
                <LocationTable
                  locations={filteredAndSortedLocations}
                  onEdit={handleOpenModal}
                  onDelete={handleDelete}
                />
              </div>
            )}
          </>
        )}

        {/* Modal */}
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 p-4">
            <div className="my-8 w-full max-w-2xl rounded-lg bg-[#1c1f33]">
              <div className="border-b border-[#d3bb73]/20 p-6">
                <h2 className="text-xl font-bold text-[#e5e4e2]">
                  {editingLocation ? 'Edytuj lokalizację' : 'Dodaj lokalizację'}
                </h2>
              </div>

              <div className="max-h-[calc(90vh-200px)] space-y-4 overflow-y-auto p-6">
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

                <div className="grid grid-cols-2 gap-4">
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
                </div>

                <div className="grid grid-cols-2 gap-4">
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
                    <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">NIP</label>
                    <input
                      type="text"
                      value={formData.nip}
                      onChange={(e) => setFormData({ ...formData, nip: e.target.value })}
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                      placeholder="123-456-78-90"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                    Osoba kontaktowa
                  </label>
                  <input
                    type="text"
                    value={formData.contact_person_name}
                    onChange={(e) =>
                      setFormData({ ...formData, contact_person_name: e.target.value })
                    }
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                    placeholder="Jan Kowalski"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Telefon</label>
                    <input
                      type="tel"
                      value={formData.contact_phone}
                      onChange={(e) => setFormData({ ...formData, contact_phone: e.target.value })}
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                      placeholder="+48 123 456 789"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Email</label>
                    <input
                      type="email"
                      value={formData.contact_email}
                      onChange={(e) => setFormData({ ...formData, contact_email: e.target.value })}
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                      placeholder="kontakt@example.com"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Notatki</label>
                  <textarea
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    rows={3}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                    placeholder="Dodatkowe informacje..."
                  />
                </div>

                {/* Google Maps Picker */}
                <div className="border-t border-[#d3bb73]/10 pt-4">
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

              <div className="flex items-center justify-end gap-3 border-t border-[#d3bb73]/20 p-6">
                <button
                  onClick={() => setShowModal(false)}
                  className="rounded-lg px-4 py-2 text-[#e5e4e2] transition-colors hover:bg-[#d3bb73]/10"
                >
                  Anuluj
                </button>
                <button
                  onClick={handleSave}
                  className="rounded-lg bg-[#d3bb73] px-4 py-2 font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
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

// Grid Card Component
function LocationCardGrid({
  location,
  onEdit,
  onDelete,
  onClick,
}: {
  location: ILocation;
  onEdit: () => void;
  onDelete: () => void;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className="cursor-pointer rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] p-4 transition-colors hover:border-[#d3bb73]/40"
    >
      <div className="mb-3 flex items-start justify-between">
        <div className="flex items-center gap-2">
          <MapPin className="h-5 w-5 flex-shrink-0 text-[#d3bb73]" />
          <h3 className="line-clamp-1 font-semibold text-[#e5e4e2]">{location.name}</h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            className="rounded p-1 transition-colors hover:bg-[#d3bb73]/10"
          >
            <Edit className="h-4 w-4 text-[#d3bb73]" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="rounded p-1 transition-colors hover:bg-red-500/10"
          >
            <Trash2 className="h-4 w-4 text-red-400" />
          </button>
        </div>
      </div>

      <div className="space-y-2 text-sm">
        {location.address && (
          <div className="flex items-start gap-2 text-[#e5e4e2]/70">
            <Building className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span className="line-clamp-1">{location.address}</span>
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
            <User className="h-4 w-4" />
            <span className="line-clamp-1">{location.contact_person_name}</span>
          </div>
        )}

        {location.contact_phone && (
          <div className="flex items-center gap-2 text-[#e5e4e2]/70">
            <Phone className="h-4 w-4" />
            <span>{location.contact_phone}</span>
          </div>
        )}

        {location.google_maps_url && (
          <div className="mt-2 border-t border-[#d3bb73]/10 pt-2">
            <a
              href={location.google_maps_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-[#d3bb73] transition-colors hover:text-[#d3bb73]/80"
            >
              <ExternalLink className="h-4 w-4" />
              <span className="text-sm">Zobacz na mapie</span>
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

// List Card Component
function LocationCardList({
  location,
  onEdit,
  onDelete,
  onClick,
}: {
  location: ILocation;
  onEdit: () => void;
  onDelete: () => void;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className="cursor-pointer rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] p-4 transition-colors hover:border-[#d3bb73]/40"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <MapPinned className="h-5 w-5 flex-shrink-0 text-[#d3bb73]" />

          <div className="min-w-0 flex-1">
            <h3 className="truncate font-semibold text-[#e5e4e2]">{location.name}</h3>
            <div className="mt-1 flex items-center gap-4 text-sm text-[#e5e4e2]/60">
              {location.city && <span>{location.city}</span>}
              {location.address && <span className="truncate">{location.address}</span>}
            </div>
          </div>
        </div>

        <div className="flex flex-shrink-0 items-center gap-3">
          {location.contact_person_name && (
            <div className="hidden items-center gap-2 text-sm text-[#e5e4e2]/60 lg:flex">
              <User className="h-4 w-4" />
              <span>{location.contact_person_name}</span>
            </div>
          )}

          {location.contact_phone && (
            <div className="hidden items-center gap-2 text-sm text-[#e5e4e2]/60 lg:flex">
              <Phone className="h-4 w-4" />
              <span>{location.contact_phone}</span>
            </div>
          )}

          {location.google_maps_url && (
            <a
              href={location.google_maps_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="rounded p-2 transition-colors hover:bg-[#d3bb73]/10"
              title="Zobacz na mapie"
            >
              <ExternalLink className="h-4 w-4 text-[#d3bb73]" />
            </a>
          )}

          <button
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            className="rounded p-2 transition-colors hover:bg-[#d3bb73]/10"
          >
            <Edit className="h-4 w-4 text-[#d3bb73]" />
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="rounded p-2 transition-colors hover:bg-red-500/10"
          >
            <Trash2 className="h-4 w-4 text-red-400" />
          </button>
        </div>
      </div>
    </div>
  );
}

// Table Component
function LocationTable({
  locations,
  onEdit,
  onDelete,
}: {
  locations: ILocation[];
  onEdit: (location: ILocation) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="bg-[#0f1117]">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[#e5e4e2]/70">
              Nazwa
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[#e5e4e2]/70">
              Adres
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[#e5e4e2]/70">
              Miasto
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[#e5e4e2]/70">
              Kontakt
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[#e5e4e2]/70">
              NIP
            </th>
            <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-[#e5e4e2]/70">
              Akcje
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#d3bb73]/10">
          {locations.map((location) => (
            <tr key={location.id} className="transition-colors hover:bg-[#d3bb73]/5">
              <td className="px-4 py-3 text-sm text-[#e5e4e2]">
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 flex-shrink-0 text-[#d3bb73]" />
                  <span className="font-medium">{location.name}</span>
                </div>
              </td>
              <td className="px-4 py-3 text-sm text-[#e5e4e2]/70">{location.address || '-'}</td>
              <td className="px-4 py-3 text-sm text-[#e5e4e2]/70">{location.city || '-'}</td>
              <td className="px-4 py-3 text-sm text-[#e5e4e2]/70">
                {location.contact_person_name || location.contact_phone || '-'}
              </td>
              <td className="px-4 py-3 text-sm text-[#e5e4e2]/70">{location.nip || '-'}</td>
              <td className="px-4 py-3 text-right text-sm">
                <div className="flex items-center justify-end gap-2">
                  {location.google_maps_url && (
                    <a
                      href={location.google_maps_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded p-1 transition-colors hover:bg-[#d3bb73]/10"
                      title="Zobacz na mapie"
                    >
                      <ExternalLink className="h-4 w-4 text-[#d3bb73]" />
                    </a>
                  )}
                  <button
                    onClick={() => onEdit(location)}
                    className="rounded p-1 transition-colors hover:bg-[#d3bb73]/10"
                  >
                    <Edit className="h-4 w-4 text-[#d3bb73]" />
                  </button>
                  <button
                    onClick={() => onDelete(location.id)}
                    className="rounded p-1 transition-colors hover:bg-red-500/10"
                  >
                    <Trash2 className="h-4 w-4 text-red-400" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
