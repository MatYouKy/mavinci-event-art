'use client';

import { useState, useEffect, useRef } from 'react';
import { MapPin, ExternalLink, Search, X, ZoomIn, ZoomOut } from 'lucide-react';

declare global {
  interface Window {
    google: any;
  }
}

interface GoogleMapsPickerProps {
  latitude?: number | null;
  longitude?: number | null;
  onLocationSelect: (data: {
    name?: string;
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
  const [centerLat, setCenterLat] = useState<number>(latitude || 52.2297);
  const [centerLng, setCenterLng] = useState<number>(longitude || 21.0122);
  const [zoom, setZoom] = useState(latitude && longitude ? 15 : 6);

  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [clickedPlace, setClickedPlace] = useState<any>(null);
  const [showPlacePopup, setShowPlacePopup] = useState(false);

  const mapRef = useRef<any>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Inicjalizacja mapy Google Maps JavaScript API
  useEffect(() => {
    if (!mapContainerRef.current) return;

    const initMap = () => {
      if (!window.google) {
        console.error('Google Maps API not loaded');
        return;
      }

      const map = new window.google.maps.Map(mapContainerRef.current, {
        center: { lat: centerLat, lng: centerLng },
        zoom: zoom,
        gestureHandling: 'greedy',
        mapTypeControl: true,
        streetViewControl: true,
        fullscreenControl: false,
      });

      mapRef.current = map;

      // LISTENER NA ZAKOŃCZENIE PRZECIĄGANIA - płynne przesuwanie
      map.addListener('dragend', () => {
        const center = map.getCenter();
        if (center) {
          const lat = center.lat();
          const lng = center.lng();

          // Aktualizuj state TYLKO po zakończeniu przeciągania
          setCenterLat(lat);
          setCenterLng(lng);

          // Aktualizuj dane lokalizacji
          const googleMapsUrl = `https://www.google.com/maps?q=${lat},${lng}`;
          onLocationSelect({
            latitude: lat,
            longitude: lng,
            formatted_address: `${lat.toFixed(6)}, ${lng.toFixed(6)}`,
            google_maps_url: googleMapsUrl,
          });
        }
      });

      // LISTENER NA ZAKOŃCZENIE ZOOM - płynny zoom
      map.addListener('zoom_changed', () => {
        const newZoom = map.getZoom();
        if (newZoom) {
          setZoom(newZoom);
        }
      });

      // LISTENER NA KLIKNIĘCIE MAPY - pobierz info o miejscu
      map.addListener('click', async (e: any) => {
        const lat = e.latLng.lat();
        const lng = e.latLng.lng();

        // Pobierz informacje o miejscu za pomocą Geocoding API
        try {
          const geocoder = new window.google.maps.Geocoder();
          const result = await geocoder.geocode({ location: { lat, lng } });

          if (result.results && result.results.length > 0) {
            const place = result.results[0];

            let name = '';
            let address = '';
            let city = '';
            let postalCode = '';
            let country = '';

            // Spróbuj znaleźć nazwę POI (Point of Interest)
            const poiResult = result.results.find((r: any) => r.types.includes('point_of_interest'));
            if (poiResult) {
              name = poiResult.name || '';
            }

            // Parse address components
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

            setClickedPlace({
              name: name || place.formatted_address?.split(',')[0] || '',
              lat,
              lng,
              formatted_address: place.formatted_address,
              place_id: place.place_id,
              address,
              city,
              postal_code: postalCode,
              country,
            });
            setShowPlacePopup(true);
          }
        } catch (error) {
          console.error('Błąd geocoding:', error);
        }
      });
    };

    // Załaduj Google Maps API jeśli jeszcze nie załadowane
    if (!window.google) {
      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}&libraries=places`;
      script.async = true;
      script.onload = initMap;
      document.head.appendChild(script);
    } else {
      initMap();
    }
  }, []);

  // Aktualizuj mapę gdy zmieniają się współrzędne z zewnątrz
  useEffect(() => {
    if (mapRef.current && latitude && longitude) {
      mapRef.current.setCenter({ lat: latitude, lng: longitude });
      // Nie zmieniaj zoom - zachowaj aktualny poziom
    }
  }, [latitude, longitude]);

  // Wyszukiwanie miejsc z debounce
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
        } else {
          setSuggestions([]);
          setShowSuggestions(false);
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

        setCenterLat(lat);
        setCenterLng(lng);

        if (mapRef.current) {
          mapRef.current.setCenter({ lat, lng });
          // Nie zmieniaj zoom - zachowaj aktualny poziom
        }

        const googleMapsUrl = `https://www.google.com/maps?q=${lat},${lng}`;

        onLocationSelect({
          name: place.name || suggestion.structured_formatting.main_text || undefined,
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

          setCenterLat(lat);
          setCenterLng(lng);

          if (mapRef.current) {
            mapRef.current.setCenter({ lat, lng });
            // Nie zmieniaj zoom - zachowaj aktualny poziom
          }

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

  // Zoom - UŻYWA AKTUALNEGO CENTRUM MAPY
  const handleZoom = (delta: number) => {
    if (mapRef.current) {
      const currentZoom = mapRef.current.getZoom();
      const newZoom = Math.max(3, Math.min(20, currentZoom + delta));

      // WAŻNE: setZoom automatycznie centruje na AKTUALNYM centrum mapy
      mapRef.current.setZoom(newZoom);
    }
  };

  // Użyj klikniętego miejsca
  const handleUseClickedPlace = () => {
    if (!clickedPlace) return;

    const googleMapsUrl = `https://www.google.com/maps?q=${clickedPlace.lat},${clickedPlace.lng}`;

    setCenterLat(clickedPlace.lat);
    setCenterLng(clickedPlace.lng);

    if (mapRef.current) {
      mapRef.current.setCenter({ lat: clickedPlace.lat, lng: clickedPlace.lng });
    }

    onLocationSelect({
      name: clickedPlace.name || undefined,
      latitude: clickedPlace.lat,
      longitude: clickedPlace.lng,
      formatted_address: clickedPlace.formatted_address,
      google_place_id: clickedPlace.place_id,
      google_maps_url: googleMapsUrl,
      address: clickedPlace.address || undefined,
      city: clickedPlace.city || undefined,
      postal_code: clickedPlace.postal_code || undefined,
      country: clickedPlace.country || undefined,
    });

    setShowPlacePopup(false);
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

      {/* Mapa interaktywna - Google Maps JS API */}
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
          {/* Google Maps Container */}
          <div ref={mapContainerRef} className="absolute inset-0 w-full h-full" />

          {/* Pinezka w centrum - stała pozycja */}
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center z-10">
            <div className="relative">
              <MapPin
                className="w-12 h-12 text-red-500"
                style={{
                  filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.7))',
                  strokeWidth: 2.5,
                  transform: 'translateY(-50%)',
                }}
              />
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3 h-3 bg-red-500 rounded-full animate-ping" />
            </div>
          </div>

          {/* Overlay z współrzędnymi - lewy górny róg */}
          <div className="absolute top-4 left-4 bg-[#1c1f33]/95 backdrop-blur-sm rounded-lg border border-[#d3bb73]/30 px-4 py-2 shadow-lg z-20">
            <div className="text-xs text-[#e5e4e2]/70 mb-1">Wybrana lokalizacja:</div>
            <div className="font-mono text-sm text-[#d3bb73] font-semibold">
              {centerLat.toFixed(6)}, {centerLng.toFixed(6)}
            </div>
          </div>

          {/* Kontrolki zoom - prawy górny róg */}
          <div className="absolute right-4 top-4 flex flex-col gap-2 bg-[#1c1f33]/95 backdrop-blur-sm rounded-lg border border-[#d3bb73]/30 p-1 shadow-lg z-20">
            <button
              type="button"
              onClick={() => handleZoom(1)}
              className="p-2 hover:bg-[#d3bb73]/20 rounded transition-colors text-[#e5e4e2]"
              title="Przybliż"
            >
              <ZoomIn className="w-5 h-5" />
            </button>
            <div className="h-px bg-[#d3bb73]/30" />
            <button
              type="button"
              onClick={() => handleZoom(-1)}
              className="p-2 hover:bg-[#d3bb73]/20 rounded transition-colors text-[#e5e4e2]"
              title="Oddal"
            >
              <ZoomOut className="w-5 h-5" />
            </button>
          </div>

          {/* Instrukcja - lewy dolny róg */}
          <div className="absolute left-4 bottom-4 bg-[#1c1f33]/95 backdrop-blur-sm rounded-lg border border-[#d3bb73]/30 px-4 py-3 max-w-xs shadow-lg z-20">
            <div className="flex items-start gap-2">
              <MapPin className="w-4 h-4 text-[#d3bb73] flex-shrink-0 mt-0.5" />
              <p className="text-xs text-[#e5e4e2]/70">
                Przeciągnij mapę aby zmienić lokalizację. Czerwona pinezka zawsze wskazuje wybrany punkt.
              </p>
            </div>
          </div>

          {/* Link do pełnej Google Maps - prawy dolny róg */}
          <div className="absolute right-4 bottom-4 z-20">
            <a
              href={`https://www.google.com/maps?q=${centerLat},${centerLng}&z=${zoom}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg font-medium hover:bg-[#d3bb73]/90 transition-colors shadow-lg"
            >
              Otwórz w Google Maps
              <ExternalLink className="w-4 h-4" />
            </a>
          </div>

          {/* Custom popup po kliknięciu na miejscu */}
          {showPlacePopup && clickedPlace && (
            <div className="absolute inset-0 flex items-center justify-center z-50 bg-black/30 backdrop-blur-sm">
              <div className="bg-[#1c1f33] border-2 border-[#d3bb73] rounded-xl shadow-2xl p-6 max-w-md w-full mx-4">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <MapPin className="w-6 h-6 text-[#d3bb73] flex-shrink-0" />
                    <h3 className="text-lg font-semibold text-[#e5e4e2]">
                      {clickedPlace.name || 'Wybrane miejsce'}
                    </h3>
                  </div>
                  <button
                    onClick={() => setShowPlacePopup(false)}
                    className="p-1 hover:bg-[#d3bb73]/10 rounded transition-colors"
                  >
                    <X className="w-5 h-5 text-[#e5e4e2]/70" />
                  </button>
                </div>

                <div className="space-y-3 mb-6">
                  {clickedPlace.address && (
                    <div className="text-sm text-[#e5e4e2]/80">
                      <span className="font-medium">Adres:</span> {clickedPlace.address}
                    </div>
                  )}
                  {clickedPlace.city && (
                    <div className="text-sm text-[#e5e4e2]/80">
                      <span className="font-medium">Miasto:</span> {clickedPlace.city}
                      {clickedPlace.postal_code && `, ${clickedPlace.postal_code}`}
                    </div>
                  )}
                  {clickedPlace.formatted_address && (
                    <div className="text-sm text-[#e5e4e2]/60 border-t border-[#d3bb73]/20 pt-3">
                      {clickedPlace.formatted_address}
                    </div>
                  )}
                  <div className="text-xs font-mono text-[#d3bb73]/80 bg-[#0f1117] px-3 py-2 rounded">
                    {clickedPlace.lat.toFixed(6)}, {clickedPlace.lng.toFixed(6)}
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => setShowPlacePopup(false)}
                    className="flex-1 px-4 py-2.5 bg-[#0f1117] text-[#e5e4e2] rounded-lg hover:bg-[#d3bb73]/10 transition-colors font-medium"
                  >
                    Anuluj
                  </button>
                  <button
                    onClick={handleUseClickedPlace}
                    className="flex-1 px-4 py-2.5 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors font-semibold shadow-lg"
                  >
                    Użyj tej lokalizacji
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Kopiowanie współrzędnych */}
      <div className="flex items-center justify-between p-3 bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg">
        <div className="flex items-center gap-3">
          <MapPin className="w-5 h-5 text-[#d3bb73]" />
          <code className="text-sm text-[#e5e4e2] font-mono font-medium">
            {centerLat.toFixed(6)}, {centerLng.toFixed(6)}
          </code>
        </div>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(`${centerLat}, ${centerLng}`);
          }}
          className="px-3 py-1.5 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/10 rounded transition-colors font-medium"
        >
          Kopiuj współrzędne
        </button>
      </div>
    </div>
  );
}
