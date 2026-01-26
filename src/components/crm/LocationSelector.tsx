'use client';

import { useState, useEffect } from 'react';
import { MapPin, Plus, Search, Building2, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import AddLocationModal from './AddLocationModal';
import { ILocation } from '@/app/(crm)/crm/locations/type';
import { useLocations } from '@/app/(crm)/crm/locations/useLocations';

interface LocationSelectorProps {
  value: string;
  onChange: (value: string, locationData?: ILocation) => void;
  placeholder?: string;
}

export default function LocationSelector({
  value,
  onChange,
  placeholder = 'Wybierz lub wyszukaj lokalizację...',
}: LocationSelectorProps) {
  const [savedLocations, setSavedLocations] = useState<ILocation[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);

  const { list: locations, loading: isLoading } = useLocations();

  useEffect(() => {
    if (locations) {
      setSavedLocations(locations);
    }
  }, [locations]);

  const filteredLocations = savedLocations.filter((loc) => {
    const query = searchQuery.toLowerCase();
    return (
      loc.name?.toLowerCase().includes(query) ||
      loc.city?.toLowerCase().includes(query) ||
      loc.address?.toLowerCase().includes(query)
    );
  });

  const handleSelectLocation = (location: ILocation) => {
    const locationString = `${location.name}${location.city ? ', ' + location.city : ''}${location.postal_code ? ', ' + location.postal_code : ''}`;
    onChange(locationString, location);
    setShowDropdown(false);
    setSearchQuery('');
  };

  const handleLocationAdded = (location: ILocation) => {
    // Dodaj nową lokalizację do listy
    setSavedLocations((prev) => [...prev, location]);
    // Wybierz ją
    handleSelectLocation(location);
    setShowAddModal(false);
  };

  return (
    <div className="relative">
      {/* Search input */}
      <div className="relative">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-[#e5e4e2]/50">
          <MapPin className="h-5 w-5" />
        </div>
        <input
          type="text"
          value={showDropdown ? searchQuery : value}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            if (!showDropdown) setShowDropdown(true);
          }}
          onFocus={() => setShowDropdown(true)}
          placeholder={placeholder}
          className="w-full rounded-lg border border-[#d3bb73]/30 bg-[#1c1f33] py-3 pl-10 pr-10 text-[#e5e4e2] transition-colors focus:border-[#d3bb73] focus:outline-none"
        />
        {(showDropdown || value) && (
          <button
            type="button"
            onClick={() => {
              setShowDropdown(false);
              setSearchQuery('');
              onChange('');
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[#e5e4e2]/50 transition-colors hover:text-[#e5e4e2]"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Dropdown with saved locations */}
      {showDropdown && (
        <div className="absolute z-50 mt-2 max-h-80 w-full overflow-hidden rounded-lg border border-[#d3bb73]/30 bg-[#1c1f33] shadow-xl">
          {/* Header */}
          <div className="border-b border-[#d3bb73]/20 bg-[#0f1117] px-4 py-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-[#e5e4e2]">
                Twoje lokalizacje ({filteredLocations.length})
              </span>
              <button
                type="button"
                onClick={() => {
                  setShowAddModal(true);
                  setShowDropdown(false);
                }}
                className="flex items-center gap-2 rounded bg-[#d3bb73]/20 px-3 py-1.5 text-xs text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/30"
              >
                <Plus className="h-3.5 w-3.5" />
                Dodaj nową
              </button>
            </div>
          </div>

          {/* Locations list */}
          <div className="max-h-64 overflow-y-auto">
            {isLoading ? (
              <div className="px-4 py-8 text-center text-[#e5e4e2]/50">
                <div className="mx-auto mb-2 h-6 w-6 animate-spin rounded-full border-2 border-[#d3bb73] border-t-transparent" />
                Ładowanie lokalizacji...
              </div>
            ) : filteredLocations.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <Building2 className="mx-auto mb-3 h-12 w-12 text-[#e5e4e2]/30" />
                <p className="mb-3 text-sm text-[#e5e4e2]/50">
                  {searchQuery
                    ? `Nie znaleziono lokalizacji "${searchQuery}" w Twojej liście`
                    : 'Brak zapisanych lokalizacji'}
                </p>
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddModal(true);
                      setShowDropdown(false);
                    }}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
                  >
                    <Plus className="h-4 w-4" />
                    Dodaj nową lokalizację
                  </button>
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => {
                        onChange(searchQuery);
                        setShowDropdown(false);
                        setSearchQuery('');
                      }}
                      className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#d3bb73]/30 bg-[#1c1f33] px-4 py-2 text-sm text-[#e5e4e2] transition-colors hover:bg-[#d3bb73]/10"
                    >
                      <Plus className="h-4 w-4" />
                      Użyj &rdquo;{searchQuery}&rdquo; jako tekst
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <>
                {filteredLocations.map((location) => (
                  <button
                    key={location.id}
                    type="button"
                    onClick={() => handleSelectLocation(location)}
                    className="w-full border-b border-[#d3bb73]/10 px-4 py-3 text-left transition-colors hover:bg-[#d3bb73]/10"
                  >
                    <div className="flex items-start gap-3">
                      <MapPin className="mt-1 h-4 w-4 flex-shrink-0 text-[#d3bb73]" />
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 font-medium text-[#e5e4e2]">{location.name}</div>
                        {(location.address || location.city) && (
                          <div className="text-sm text-[#e5e4e2]/60">
                            {location.address}
                            {location.address && location.city && ', '}
                            {location.city}
                            {location.postal_code && ` ${location.postal_code}`}
                          </div>
                        )}
                        {location.formatted_address && (
                          <div className="mt-1 text-xs text-[#e5e4e2]/40">
                            {location.formatted_address}
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                ))}

                {/* Button to add new location when results exist but user wants more */}
                {searchQuery && (
                  <div className="border-t border-[#d3bb73]/10 bg-[#0f1117] px-4 py-3">
                    <p className="mb-2 text-xs text-[#e5e4e2]/40">Nie znalazłeś czego szukasz?</p>
                    <button
                      type="button"
                      onClick={() => {
                        setShowAddModal(true);
                        setShowDropdown(false);
                      }}
                      className="flex w-full items-center justify-center gap-2 rounded bg-[#d3bb73]/20 px-3 py-2 text-sm text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/30"
                    >
                      <Plus className="h-4 w-4" />
                      Dodaj nową lokalizację
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-[#d3bb73]/20 bg-[#0f1117] px-4 py-3">
            <button
              type="button"
              onClick={() => {
                setShowDropdown(false);
              }}
              className="w-full text-center text-xs text-[#e5e4e2]/50 transition-colors hover:text-[#e5e4e2]"
            >
              Zamknij
            </button>
          </div>
        </div>
      )}

      {/* Add Location Modal */}
      <AddLocationModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onLocationAdded={handleLocationAdded}
      />
    </div>
  );
}
