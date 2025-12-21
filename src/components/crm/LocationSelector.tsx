'use client';

import { useState, useEffect } from 'react';
import { MapPin, Plus, Search, Building2, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import AddLocationModal from './AddLocationModal';
import { ILocation } from '@/app/crm/locations/type';
import { useLocations } from '@/app/crm/locations/useLocations';

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
    const locationString = 
      `${location.name}${location.city ? ', ' + location.city : ''}${location.postal_code ? ', ' + location.postal_code : ''}`;
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
          <MapPin className="w-5 h-5" />
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
          className="w-full pl-10 pr-10 py-3 bg-[#1c1f33] border border-[#d3bb73]/30 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73] transition-colors"
        />
        {(showDropdown || value) && (
          <button
            type="button"
            onClick={() => {
              setShowDropdown(false);
              setSearchQuery('');
              onChange('');
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[#e5e4e2]/50 hover:text-[#e5e4e2] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Dropdown with saved locations */}
      {showDropdown && (
        <div className="absolute z-50 w-full mt-2 bg-[#1c1f33] border border-[#d3bb73]/30 rounded-lg shadow-xl max-h-80 overflow-hidden">
          {/* Header */}
          <div className="px-4 py-3 border-b border-[#d3bb73]/20 bg-[#0f1117]">
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
                className="flex items-center gap-2 px-3 py-1.5 text-xs bg-[#d3bb73]/20 text-[#d3bb73] rounded hover:bg-[#d3bb73]/30 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Dodaj nową
              </button>
            </div>
          </div>

          {/* Locations list */}
          <div className="overflow-y-auto max-h-64">
            {isLoading ? (
              <div className="px-4 py-8 text-center text-[#e5e4e2]/50">
                <div className="animate-spin w-6 h-6 border-2 border-[#d3bb73] border-t-transparent rounded-full mx-auto mb-2" />
                Ładowanie lokalizacji...
              </div>
            ) : filteredLocations.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <Building2 className="w-12 h-12 text-[#e5e4e2]/30 mx-auto mb-3" />
                <p className="text-sm text-[#e5e4e2]/50 mb-3">
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
                    className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors text-sm font-medium"
                  >
                    <Plus className="w-4 h-4" />
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
                      className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-[#1c1f33] border border-[#d3bb73]/30 text-[#e5e4e2] rounded-lg hover:bg-[#d3bb73]/10 transition-colors text-sm"
                    >
                      <Plus className="w-4 h-4" />
                      Użyj "{searchQuery}" jako tekst
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
                    className="w-full text-left px-4 py-3 hover:bg-[#d3bb73]/10 transition-colors border-b border-[#d3bb73]/10"
                  >
                    <div className="flex items-start gap-3">
                      <MapPin className="w-4 h-4 text-[#d3bb73] flex-shrink-0 mt-1" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-[#e5e4e2] mb-1">
                          {location.name}
                        </div>
                        {(location.address || location.city) && (
                          <div className="text-sm text-[#e5e4e2]/60">
                            {location.address}
                            {location.address && location.city && ', '}
                            {location.city}
                            {location.postal_code && ` ${location.postal_code}`}
                          </div>
                        )}
                        {location.formatted_address && (
                          <div className="text-xs text-[#e5e4e2]/40 mt-1">
                            {location.formatted_address}
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                ))}

                {/* Button to add new location when results exist but user wants more */}
                {searchQuery && (
                  <div className="px-4 py-3 bg-[#0f1117] border-t border-[#d3bb73]/10">
                    <p className="text-xs text-[#e5e4e2]/40 mb-2">
                      Nie znalazłeś czego szukasz?
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setShowAddModal(true);
                        setShowDropdown(false);
                      }}
                      className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-[#d3bb73]/20 text-[#d3bb73] rounded hover:bg-[#d3bb73]/30 transition-colors text-sm"
                    >
                      <Plus className="w-4 h-4" />
                      Dodaj nową lokalizację
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-3 border-t border-[#d3bb73]/20 bg-[#0f1117]">
            <button
              type="button"
              onClick={() => {
                setShowDropdown(false);
              }}
              className="w-full text-center text-xs text-[#e5e4e2]/50 hover:text-[#e5e4e2] transition-colors"
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
