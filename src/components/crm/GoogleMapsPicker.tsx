'use client';

import { useState, useEffect, useRef } from 'react';
import { MapPin, ExternalLink, Search, X } from 'lucide-react';

interface GoogleMapsPickerProps {
  latitude?: number | null;
  longitude?: number | null;
  onLocationSelect: (data: {
    latitude: number;
    longitude: number;
    formatted_address: string;
    google_place_id?: string;
    google_maps_url: string;
    address?: string;
    city?: string;
    postal_code?: string;
    country?: string;
  }) => void;
}

interface PlaceSuggestion {
  description: string;
  place_id: string;
  structured_formatting: {
    main_text: string;
    secondary_text: string;
  };
}

export default function GoogleMapsPicker({
  latitude,
  longitude,
  onLocationSelect,
}: GoogleMapsPickerProps) {
  const [selectedLat, setSelectedLat] = useState<number>(latitude || 52.2297);
  const [selectedLng, setSelectedLng] = useState<number>(longitude || 21.0122);
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (latitude && longitude) {
      setSelectedLat(latitude);
      setSelectedLng(longitude);
    }
  }, [latitude, longitude]);

  // Wyszukiwanie miejsc z debounce - Google Places API
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current as NodeJS.Timeout);
    }

    if (searchQuery.length < 3) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/places/autocomplete?input=${encodeURIComponent(searchQuery)}`
        );

        const data = await response.json();

        if (data.status === 'OK' && data.predictions) {
          setSuggestions(data.predictions);
          setShowSuggestions(true);
        } else if (data.predictions && data.predictions.length === 0) {
          setSuggestions([]);
          setShowSuggestions(false);
        } else {
          console.error('Places API error:', data.status || data.error);
          setSuggestions([]);
        }
      } catch (error) {
        console.error('Błąd wyszukiwania:', error);
        setSuggestions([]);
      }
    }, 500) as unknown as NodeJS.Timeout;
  }, [searchQuery]);

  const handleSuggestionClick = async (suggestion: PlaceSuggestion) => {
    setSearchQuery(suggestion.structured_formatting.main_text);
    setShowSuggestions(false);

    try {
      const detailsResponse = await fetch(
        `/api/places/details?place_id=${suggestion.place_id}`
      );

      const detailsData = await detailsResponse.json();

      if (detailsData.status === 'OK' && detailsData.result) {
        const place = detailsData.result;
        const lat = place.geometry.location.lat;
        const lng = place.geometry.location.lng;

        let address = '';
        let city = '';
        let postalCode = '';
        let country = '';

        if (place.address_components) {
          place.address_components.forEach((component: any) => {
            if (component.types.includes('route')) {
              address = component.long_name;
            }
            if (component.types.includes('street_number')) {
              address = `${component.long_name} ${address}`.trim();
            }
            if (component.types.includes('locality')) {
              city = component.long_name;
            }
            if (component.types.includes('postal_code')) {
              postalCode = component.long_name;
            }
            if (component.types.includes('country')) {
              country = component.long_name;
            }
          });
        }

        setSelectedLat(lat);
        setSelectedLng(lng);

        const googleMapsUrl = `https://www.google.com/maps?q=${lat},${lng}`;

        onLocationSelect({
          latitude: lat,
          longitude: lng,
          formatted_address: place.formatted_address || `${lat.toFixed(6)}, ${lng.toFixed(6)}`,
          google_place_id: suggestion.place_id,
          google_maps_url: googleMapsUrl,
          address: address || undefined,
          city: city || undefined,
          postal_code: postalCode || undefined,
          country: country || undefined,
        });
      } else {
        console.error('Place Details API error:', detailsData.status || detailsData.error);
      }
    } catch (error) {
      console.error('Błąd pobierania szczegółów miejsca:', error);
    }
  };

  const handleGetCurrentLocation = () => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;

          setSelectedLat(lat);
          setSelectedLng(lng);

          const googleMapsUrl = `https://www.google.com/maps?q=${lat},${lng}`;
          onLocationSelect({
            latitude: lat,
            longitude: lng,
            formatted_address: `${lat.toFixed(6)}, ${lng.toFixed(6)}`,
            google_maps_url: googleMapsUrl,
          });
        },
        (error) => {
          alert('Nie udało się pobrać lokalizacji: ' + error.message);
        }
      );
    } else {
      alert('Geolokalizacja nie jest dostępna w tej przeglądarce');
    }
  };

  const mapUrl = `https://www.google.com/maps?q=${selectedLat},${selectedLng}&z=15`;

  return (
    <div className="space-y-4">
      {/* Wyszukiwarka */}
      <div className="relative">
        <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
          Wyszukaj miejsce
        </label>
        <div className="relative">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-[#e5e4e2]/50">
            <Search className="w-5 h-5" />
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
            placeholder="np. Hotel Omega Kraków, Stadion Narodowy..."
            className="w-full pl-10 pr-10 py-3 bg-[#1c1f33] border border-[#d3bb73]/30 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73] transition-colors"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setSuggestions([]);
                setShowSuggestions(false);
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#e5e4e2]/50 hover:text-[#e5e4e2] transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Sugestie */}
        {showSuggestions && suggestions.length > 0 && (
          <div className="absolute z-50 w-full mt-2 bg-[#1c1f33] border border-[#d3bb73]/30 rounded-lg shadow-xl max-h-60 overflow-y-auto">
            {suggestions.map((suggestion, index) => (
              <button
                key={index}
                type="button"
                onClick={() => handleSuggestionClick(suggestion)}
                className="w-full text-left px-4 py-3 hover:bg-[#d3bb73]/10 transition-colors border-b border-[#d3bb73]/10 last:border-b-0"
              >
                <div className="font-medium text-[#e5e4e2]">
                  {suggestion.structured_formatting.main_text}
                </div>
                <div className="text-sm text-[#e5e4e2]/60">
                  {suggestion.structured_formatting.secondary_text}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Przycisk GPS */}
      <button
        type="button"
        onClick={handleGetCurrentLocation}
        className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-500/10 border border-blue-500/30 text-blue-300 rounded-lg hover:bg-blue-500/20 transition-colors"
      >
        <MapPin className="w-4 h-4" />
        Użyj mojej lokalizacji GPS
      </button>

      {/* Mapa - otwarcie w Google Maps */}
      <div>
        <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
          Lokalizacja na mapie
        </label>
        <p className="text-xs text-[#e5e4e2]/60 mb-3">
          Kliknij poniżej aby otworzyć Google Maps i precyzyjnie wybrać lokalizację
        </p>

        <a
          href={mapUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block relative bg-[#0f1117] border-2 border-[#d3bb73]/30 rounded-lg overflow-hidden hover:border-[#d3bb73]/50 transition-colors"
          style={{ height: '300px' }}
        >
          {/* Statyczny podgląd mapy */}
          <img
            src={`https://maps.googleapis.com/maps/api/staticmap?center=${selectedLat},${selectedLng}&zoom=15&size=800x300&markers=color:red%7C${selectedLat},${selectedLng}&key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}`}
            alt="Mapa lokalizacji"
            className="w-full h-full object-cover"
          />

          {/* Overlay z informacją */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent pointer-events-none" />

          <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between">
            <div className="bg-[#1c1f33]/95 backdrop-blur-sm rounded-lg border border-[#d3bb73]/30 px-4 py-2">
              <div className="text-xs text-[#e5e4e2]/70 mb-1">Wybrana lokalizacja:</div>
              <div className="font-mono text-sm text-[#d3bb73] font-semibold">
                {selectedLat.toFixed(6)}, {selectedLng.toFixed(6)}
              </div>
            </div>

            <div className="flex items-center gap-2 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] text-sm font-medium rounded-lg shadow-lg">
              Otwórz w Google Maps
              <ExternalLink className="w-4 h-4" />
            </div>
          </div>
        </a>

        <p className="text-xs text-[#e5e4e2]/50 mt-2 italic">
          💡 Kliknij na mapę aby otworzyć pełną wersję Google Maps, gdzie możesz dowolnie przesuwać i zoomować
        </p>
      </div>

      {/* Kopiowanie współrzędnych */}
      <div className="flex items-center justify-between p-3 bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg">
        <div className="flex items-center gap-3">
          <MapPin className="w-5 h-5 text-[#d3bb73]" />
          <code className="text-sm text-[#e5e4e2] font-mono font-medium">
            {selectedLat.toFixed(6)}, {selectedLng.toFixed(6)}
          </code>
        </div>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(`${selectedLat}, ${selectedLng}`);
          }}
          className="px-3 py-1.5 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/10 rounded transition-colors font-medium"
        >
          Kopiuj współrzędne
        </button>
      </div>
    </div>
  );
}
