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
  const [mapUrl, setMapUrl] = useState('');
  const [zoom, setZoom] = useState(6);
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    if (latitude && longitude) {
      setSelectedLat(latitude);
      setSelectedLng(longitude);
      setZoom(13);
    }
  }, [latitude, longitude]);

  useEffect(() => {
    const url = `https://www.google.com/maps?q=${selectedLat},${selectedLng}&z=15`;
    setMapUrl(url);
  }, [selectedLat, selectedLng]);

  // Wyszukiwanie miejsc z debounce
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (searchQuery.length < 3) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    searchTimeoutRef.current = setTimeout(async () => {
      try {
        // Symulacja Google Places Autocomplete
        // W produkcji użyj prawdziwego API: https://maps.googleapis.com/maps/api/place/autocomplete/json

        // Dla demonstracji - otwórzmy wyszukiwarkę Google Maps
        const mockSuggestions: PlaceSuggestion[] = [
          {
            description: `${searchQuery} - wyszukaj w Google Maps`,
            place_id: 'search',
            structured_formatting: {
              main_text: searchQuery,
              secondary_text: 'Kliknij aby wyszukać'
            }
          }
        ];

        setSuggestions(mockSuggestions);
        setShowSuggestions(true);
      } catch (error) {
        console.error('Błąd wyszukiwania:', error);
      }
    }, 500);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery]);

  const handleSuggestionClick = async (suggestion: PlaceSuggestion) => {
    setSearchQuery(suggestion.structured_formatting.main_text);
    setShowSuggestions(false);

    // Otwórz Google Maps do wyszukania
    const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(suggestion.structured_formatting.main_text)}`;
    window.open(searchUrl, '_blank', 'width=800,height=600');

    // Instrukcja dla użytkownika
    alert(
      '📍 Znajdź miejsce w Google Maps\n\n' +
      '1. Znajdź właściwą lokalizację na otwartej mapie\n' +
      '2. Kliknij prawym na miejsce → "Co tu jest?"\n' +
      '3. Skopiuj współrzędne (pojawią się na dole)\n' +
      '4. Wklej je w polach poniżej\n\n' +
      'Lub użyj funkcji "Użyj mojej lokalizacji GPS"'
    );
  };

  const handleGetCurrentLocation = () => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;

          setSelectedLat(lat);
          setSelectedLng(lng);
          setZoom(15);

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

  const handleZoomChange = (newZoom: number) => {
    // Ustaw nowy zoom, ale zachowaj obecne centrum (selectedLat, selectedLng)
    setZoom(newZoom);

    // Wymuszenie przeładowania iframe z nowymi parametrami
    if (iframeRef.current) {
      iframeRef.current.src = `https://www.google.com/maps?q=${selectedLat},${selectedLng}&z=${newZoom}&output=embed&gestureHandling=greedy`;
    }
  };

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

      {/* Mapa */}
      <div>
        <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
          Mapa lokalizacji
        </label>
        <p className="text-xs text-[#e5e4e2]/60 mb-3">
          Przesuń mapę aby znaleźć miejsce. Pinezka (🔴) w centrum pokazuje wybraną lokalizację.
        </p>

        <div
          className="relative bg-[#0f1117] border-2 border-[#d3bb73]/30 rounded-lg overflow-hidden"
          style={{ height: '500px' }}
        >
          {/* Google Maps iframe */}
          <iframe
            ref={iframeRef}
            key={`${selectedLat}-${selectedLng}-${zoom}`}
            src={`https://www.google.com/maps?q=${selectedLat},${selectedLng}&z=${zoom}&output=embed&gestureHandling=greedy`}
            className="absolute inset-0 w-full h-full pointer-events-auto"
            style={{ border: 0 }}
            loading="lazy"
            allowFullScreen
          />

          {/* Pinezka w centrum */}
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center z-10">
            <div className="relative">
              <MapPin
                className="w-12 h-12 text-red-500"
                style={{
                  filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.7))',
                  strokeWidth: 2.5
                }}
              />
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3 h-3 bg-red-500 rounded-full animate-ping" />
            </div>
          </div>

          {/* Overlay z współrzędnymi */}
          <div className="absolute top-4 left-4 bg-[#1c1f33]/95 backdrop-blur-sm rounded-lg border border-[#d3bb73]/30 px-4 py-2 shadow-lg z-20">
            <div className="text-xs text-[#e5e4e2]/70 mb-1">Wybrana lokalizacja:</div>
            <div className="font-mono text-sm text-[#d3bb73] font-semibold">
              {selectedLat.toFixed(6)}, {selectedLng.toFixed(6)}
            </div>
          </div>

          {/* Kontrolki zoom */}
          <div className="absolute right-4 top-4 flex flex-col gap-2 bg-[#1c1f33]/95 backdrop-blur-sm rounded-lg border border-[#d3bb73]/30 p-1 shadow-lg z-20">
            <button
              type="button"
              onClick={() => handleZoomChange(Math.min(zoom + 1, 20))}
              className="p-2 hover:bg-[#d3bb73]/20 rounded transition-colors text-[#e5e4e2] font-bold text-lg"
              title="Przybliż"
            >
              +
            </button>
            <div className="h-px bg-[#d3bb73]/30" />
            <button
              type="button"
              onClick={() => handleZoomChange(Math.max(zoom - 1, 3))}
              className="p-2 hover:bg-[#d3bb73]/20 rounded transition-colors text-[#e5e4e2] font-bold text-lg"
              title="Oddal"
            >
              −
            </button>
          </div>

          {/* Instrukcja */}
          <div className="absolute left-4 bottom-4 bg-[#1c1f33]/95 backdrop-blur-sm rounded-lg border border-[#d3bb73]/30 px-4 py-3 max-w-xs shadow-lg z-20">
            <div className="flex items-start gap-2">
              <span className="text-xl">💡</span>
              <div className="text-xs text-[#e5e4e2]/90 leading-relaxed">
                <strong className="text-[#d3bb73]">Jak używać:</strong>
                <br />• Wyszukaj miejsce powyżej
                <br />• Lub przesuń mapę ręcznie
                <br />• Pinezka (🔴) = wybrana lokalizacja
                <br />• Zoom zachowuje pozycję pinezki
              </div>
            </div>
          </div>

          {/* Link do Google Maps */}
          {mapUrl && (
            <a
              href={mapUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="absolute bottom-4 right-4 flex items-center gap-2 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] text-sm font-medium rounded-lg hover:bg-[#d3bb73]/90 transition-colors shadow-lg z-20"
            >
              Otwórz w Google Maps
              <ExternalLink className="w-4 h-4" />
            </a>
          )}
        </div>
      </div>

      {/* Ręczna edycja współrzędnych */}
      <div className="grid grid-cols-2 gap-4 p-4 bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg">
        <div>
          <label className="block text-xs text-[#e5e4e2]/70 mb-1 font-medium">
            Szerokość geograficzna (Latitude)
          </label>
          <input
            type="number"
            step="0.000001"
            value={selectedLat}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              if (!isNaN(val)) {
                setSelectedLat(val);
                const googleMapsUrl = `https://www.google.com/maps?q=${val},${selectedLng}`;
                onLocationSelect({
                  latitude: val,
                  longitude: selectedLng,
                  formatted_address: `${val.toFixed(6)}, ${selectedLng.toFixed(6)}`,
                  google_maps_url: googleMapsUrl,
                });
              }
            }}
            className="w-full px-3 py-2 bg-[#0f1117] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] text-sm focus:outline-none focus:border-[#d3bb73]/50 font-mono"
          />
        </div>
        <div>
          <label className="block text-xs text-[#e5e4e2]/70 mb-1 font-medium">
            Długość geograficzna (Longitude)
          </label>
          <input
            type="number"
            step="0.000001"
            value={selectedLng}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              if (!isNaN(val)) {
                setSelectedLng(val);
                const googleMapsUrl = `https://www.google.com/maps?q=${selectedLat},${val}`;
                onLocationSelect({
                  latitude: selectedLat,
                  longitude: val,
                  formatted_address: `${selectedLat.toFixed(6)}, ${val.toFixed(6)}`,
                  google_maps_url: googleMapsUrl,
                });
              }
            }}
            className="w-full px-3 py-2 bg-[#0f1117] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] text-sm focus:outline-none focus:border-[#d3bb73]/50 font-mono"
          />
        </div>
      </div>

      {/* Kopiowanie współrzędnych */}
      <div className="flex items-center justify-between p-3 bg-[#0f1117] border border-[#d3bb73]/20 rounded-lg">
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-[#d3bb73]" />
          <code className="text-sm text-[#e5e4e2] font-mono">
            {selectedLat.toFixed(6)}, {selectedLng.toFixed(6)}
          </code>
        </div>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(`${selectedLat}, ${selectedLng}`);
          }}
          className="text-xs text-[#d3bb73] hover:underline font-medium"
        >
          Kopiuj współrzędne
        </button>
      </div>
    </div>
  );
}
