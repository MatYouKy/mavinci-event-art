'use client';

import { useState, useEffect, useRef } from 'react';
import { MapPin, Plus, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface Location {
  id: string;
  name: string;
  address?: string;
  city?: string;
  postal_code?: string;
}

interface LocationAutocompleteProps {
  value: string;
  onChange: (value: string, locationId?: string) => void;
  placeholder?: string;
  className?: string;
}

export default function LocationAutocomplete({
  value,
  onChange,
  placeholder = 'Wpisz lokalizację...',
  className = '',
}: LocationAutocompleteProps) {
  const [locations, setLocations] = useState<Location[]>([]);
  const [filteredLocations, setFilteredLocations] = useState<Location[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [inputValue, setInputValue] = useState(value);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchLocations();
  }, []);

  useEffect(() => {
    setInputValue(value);
  }, [value]);

  useEffect(() => {
    if (inputValue.length >= 2) {
      const filtered = locations.filter((loc) =>
        loc.name.toLowerCase().includes(inputValue.toLowerCase()) ||
        loc.city?.toLowerCase().includes(inputValue.toLowerCase()) ||
        loc.address?.toLowerCase().includes(inputValue.toLowerCase())
      );
      setFilteredLocations(filtered);
      setShowDropdown(true);
    } else {
      setFilteredLocations([]);
      setShowDropdown(false);
    }
  }, [inputValue, locations]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(event.target as Node)
      ) {
        setShowDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const fetchLocations = async () => {
    const { data } = await supabase
      .from('locations')
      .select('id, name, address, city, postal_code')
      .order('name');
    if (data) setLocations(data);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setInputValue(newValue);
    onChange(newValue); // Zawsze przekazuj wartość jako string
    setHighlightedIndex(-1);
  };

  const handleSelectLocation = (location: Location) => {
    const locationString = formatLocationString(location);
    setInputValue(locationString);
    onChange(locationString, location.id);
    setShowDropdown(false);
  };

  const formatLocationString = (location: Location) => {
    const parts = [location.name];
    if (location.address) parts.push(location.address);
    if (location.city) parts.push(location.city);
    return parts.join(', ');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showDropdown || filteredLocations.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex((prev) =>
          prev < filteredLocations.length - 1 ? prev + 1 : 0
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex((prev) =>
          prev > 0 ? prev - 1 : filteredLocations.length - 1
        );
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < filteredLocations.length) {
          handleSelectLocation(filteredLocations[highlightedIndex]);
        }
        break;
      case 'Escape':
        setShowDropdown(false);
        setHighlightedIndex(-1);
        break;
    }
  };

  const handleClear = () => {
    setInputValue('');
    onChange('');
    setShowDropdown(false);
    inputRef.current?.focus();
  };

  return (
    <div className="relative">
      <div className="relative">
        <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#e5e4e2]/50" />
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => inputValue.length >= 2 && setShowDropdown(true)}
          placeholder={placeholder}
          className={`w-full pl-10 pr-10 py-2 bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/50 ${className}`}
        />
        {inputValue && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[#e5e4e2]/50 hover:text-[#e5e4e2] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {showDropdown && filteredLocations.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute z-50 w-full mt-2 bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg shadow-xl max-h-64 overflow-y-auto"
        >
          {filteredLocations.map((location, index) => (
            <button
              key={location.id}
              type="button"
              onClick={() => handleSelectLocation(location)}
              className={`w-full text-left px-4 py-3 hover:bg-[#d3bb73]/10 transition-colors border-b border-[#d3bb73]/10 last:border-b-0 ${
                index === highlightedIndex ? 'bg-[#d3bb73]/10' : ''
              }`}
            >
              <div className="flex items-start gap-3">
                <MapPin className="w-4 h-4 text-[#d3bb73] flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-[#e5e4e2] truncate">
                    {location.name}
                  </div>
                  {(location.address || location.city) && (
                    <div className="text-xs text-[#e5e4e2]/60 truncate mt-0.5">
                      {[location.address, location.city].filter(Boolean).join(', ')}
                    </div>
                  )}
                </div>
              </div>
            </button>
          ))}

          {inputValue && (
            <div className="px-4 py-2 border-t border-[#d3bb73]/20 bg-[#0f1117]">
              <div className="text-xs text-[#e5e4e2]/50">
                💡 Jeśli lokalizacji nie ma na liście, zostanie zapisana jako: <span className="text-[#d3bb73]">"{inputValue}"</span>
              </div>
            </div>
          )}
        </div>
      )}

      {showDropdown && filteredLocations.length === 0 && inputValue.length >= 2 && (
        <div
          ref={dropdownRef}
          className="absolute z-50 w-full mt-2 bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg shadow-xl p-4"
        >
          <div className="text-center">
            <MapPin className="w-8 h-8 text-[#e5e4e2]/30 mx-auto mb-2" />
            <p className="text-sm text-[#e5e4e2]/60 mb-2">
              Brak lokalizacji pasujących do "{inputValue}"
            </p>
            <p className="text-xs text-[#d3bb73]">
              ✓ Zostanie zapisana jako nowa lokalizacja tekstowa
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
