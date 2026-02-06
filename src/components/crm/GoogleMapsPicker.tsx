'use client';

import { useState, useEffect, useRef } from 'react';
import { MapPin, ExternalLink, Search, X, ZoomIn, ZoomOut } from 'lucide-react';
import { buildBestAddress } from '../CityMapEmbed/buildBestAddress';

declare global {
  interface Window {
    google: any;
  }
}

interface GoogleMapsPickerProps {
  latitude?: number | null;
  longitude?: number | null;
  onConfirmLocation?: () => void;
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
  onConfirmLocation,
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

  const getTargetZoomForPlace = (place: any) => {
    const vp = place?.geometry?.viewport;
  
    // jeśli google zwróci viewport – dopasuj mapę do obszaru (najlepsze UX)
    if (vp && mapRef.current?.fitBounds) {
      return { type: 'fit' as const, vp };
    }
  
    // fallback: “miejsce/POI” bliżej, adresy trochę dalej
    const types: string[] = place?.types ?? [];
    const isPOI =
      types.includes('point_of_interest') ||
      types.includes('establishment') ||
      types.includes('restaurant') ||
      types.includes('lodging');
  
    return { type: 'zoom' as const, zoom: isPOI ? 16 : 15 };
  };

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
        clickableIcons: true,
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
        try {
          // ✅ Jeśli kliknięto POI, Google daje placeId
          if (e.placeId) {
            // ✅ blokuje domyślny biały popup Google
            if (typeof e.stop === 'function') e.stop();

            const placeId = e.placeId as string;

            const detailsResponse = await fetch(
              `/bridge/places/details?place_id=${encodeURIComponent(placeId)}`,
            );
            const detailsData = await detailsResponse.json();

            if (detailsData.status === 'OK' && detailsData.result) {
              const place = detailsData.result;
              const lat = place.geometry.location.lat;
              const lng = place.geometry.location.lng;

              // parse adresu jak u Ciebie
              let address = '';
              let city = '';
              let postalCode = '';
              let country = '';

              if (place.address_components) {
                place.address_components.forEach((component: any) => {
                  if (component.types.includes('route')) address = component.long_name;
                  if (component.types.includes('street')) address = component.long_name;
                  if (component.types.includes('street_number'))
                    address = `${component.long_name} ${address}`.trim();
                  if (component.types.includes('locality')) city = component.long_name;
                  if (component.types.includes('postal_code')) postalCode = component.long_name;
                  if (component.types.includes('country')) country = component.long_name;
                });
              }

              const parsed = buildBestAddress(place);

              setClickedPlace({
                name: place.name || parsed.formatted_short || 'Wybrane miejsce',
                lat,
                lng,
                place_id: place.place_id || placeId,
                ...parsed,
              });
              setShowPlacePopup(true);
              return;
            }
          }

          // ✅ fallback: klik w “puste” miejsce → reverse geocode
          const lat = e.latLng.lat();
          const lng = e.latLng.lng();

          const geocoder = new window.google.maps.Geocoder();
          const result = await geocoder.geocode({ location: { lat, lng } });

          if (result.results && result.results.length > 0) {
            const place = result.results[0];

            let address = '';
            let city = '';
            let postalCode = '';
            let country = '';

            if (place.address_components) {
              place.address_components.forEach((component: any) => {
                if (component.types.includes('route')) address = component.long_name;
                if (component.types.includes('street')) address = component.long_name;
                if (component.types.includes('street_number'))
                  address = `${component.long_name} ${address}`.trim();
                if (component.types.includes('locality')) city = component.long_name;
                if (component.types.includes('postal_code')) postalCode = component.long_name;
                if (component.types.includes('country')) country = component.long_name;
              });
            }

            // ⛔ tutaj nie udawaj “nazwy”, bo reverse geocode jej nie ma
            const parsed = buildBestAddress(place);

            setClickedPlace({
              name: parsed.formatted_short || 'Wybrany punkt',
              lat,
              lng,
              place_id: place.place_id,
              ...parsed,
            });
            setShowPlacePopup(true);
          }
        } catch (err) {
          console.error('Map click error', err);
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
          `/bridge/places/autocomplete?input=${encodeURIComponent(searchQuery)}`,
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
      const detailsResponse = await fetch(`/bridge/places/details?place_id=${suggestion.place_id}`);

      const detailsData = await detailsResponse.json();

      if (detailsData.status === 'OK' && detailsData.result) {
        const place = detailsData.result;
        const lat = place.geometry.location.lat;
        const lng = place.geometry.location.lng;
      
        const parsed = buildBestAddress(place);
      
        setCenterLat(lat);
        setCenterLng(lng);
      
        if (mapRef.current) {
          // płynne przesunięcie
          mapRef.current.panTo({ lat, lng });
        
          const z = getTargetZoomForPlace(place);
        
          if (z.type === 'fit') {
            // viewport -> perfekcyjny zoom do obiektu/obszaru
            mapRef.current.fitBounds(z.vp);
          } else {
            mapRef.current.setZoom(z.zoom);
          }
        }
      
        const googleMapsUrl = `https://www.google.com/maps?q=${lat},${lng}`;

        onLocationSelect({
          name: place.name || suggestion.structured_formatting.main_text || undefined,
          latitude: lat,
          longitude: lng,
          formatted_address:
            parsed.formatted_address || parsed.formatted_short || place.formatted_address || '',
          google_place_id: suggestion.place_id,
          google_maps_url: googleMapsUrl,
          address: parsed.address,
          city: parsed.city,
          postal_code: parsed.postal_code,
          country: parsed.country,
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
        },
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
    onConfirmLocation?.();
  };

  return (
    <div className="space-y-4">
      {/* Wyszukiwarka */}
      <div className="relative">
        <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Wyszukaj miejsce</label>
        <div className="relative">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-[#e5e4e2]/50">
            <Search className="h-5 w-5" />
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
            placeholder="np. Hotel Omega Kraków, Stadion Narodowy..."
            className="w-full rounded-lg border border-[#d3bb73]/30 bg-[#1c1f33] py-3 pl-10 pr-10 text-[#e5e4e2] transition-colors focus:border-[#d3bb73] focus:outline-none"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setSuggestions([]);
                setShowSuggestions(false);
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#e5e4e2]/50 transition-colors hover:text-[#e5e4e2]"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* Sugestie */}
        {showSuggestions && suggestions.length > 0 && (
          <div className="absolute z-50 mt-2 max-h-60 w-full overflow-y-auto rounded-lg border border-[#d3bb73]/30 bg-[#1c1f33] shadow-xl">
            {suggestions.map((suggestion, index) => (
              <button
                key={index}
                type="button"
                onClick={() => handleSuggestionClick(suggestion)}
                className="w-full border-b border-[#d3bb73]/10 px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-[#d3bb73]/10"
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
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-2 text-blue-300 transition-colors hover:bg-blue-500/20"
      >
        <MapPin className="h-4 w-4" />
        Użyj mojej lokalizacji GPS
      </button>

      {/* Mapa interaktywna - Google Maps JS API */}
      <div>
        <div
          className="relative overflow-hidden rounded-lg border-2 border-[#d3bb73]/30 bg-[#0f1117]"
          style={{ height: '500px' }}
        >
          {/* Google Maps Container */}
          <div ref={mapContainerRef} className="absolute inset-0 h-full w-full" />

          {/* Pinezka w centrum - stała pozycja */}
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
            <div className="relative">
              <MapPin
                className="h-12 w-12 text-red-500"
                style={{
                  filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.7))',
                  strokeWidth: 2.5,
                  transform: 'translateY(-50%)',
                }}
              />
              <div className="absolute left-1/2 top-0 h-3 w-3 -translate-x-1/2 animate-ping rounded-full bg-red-500" />
            </div>
          </div>

          {/* Overlay z współrzędnymi - lewy górny róg */}
          <div className="absolute left-4 top-4 z-20 rounded-lg border border-[#d3bb73]/30 bg-[#1c1f33]/95 px-4 py-2 shadow-lg backdrop-blur-sm">
            <div className="mb-1 text-xs text-[#e5e4e2]/70">Wybrana lokalizacja:</div>
            <div className="font-mono text-sm font-semibold text-[#d3bb73]">
              {centerLat.toFixed(6)}, {centerLng.toFixed(6)}
            </div>
          </div>

          {/* Kontrolki zoom - prawy górny róg */}
          <div className="absolute right-4 top-4 z-20 flex flex-col gap-2 rounded-lg border border-[#d3bb73]/30 bg-[#1c1f33]/95 p-1 shadow-lg backdrop-blur-sm">
            <button
              type="button"
              onClick={() => handleZoom(1)}
              className="rounded p-2 text-[#e5e4e2] transition-colors hover:bg-[#d3bb73]/20"
              title="Przybliż"
            >
              <ZoomIn className="h-5 w-5" />
            </button>
            <div className="h-px bg-[#d3bb73]/30" />
            <button
              type="button"
              onClick={() => handleZoom(-1)}
              className="rounded p-2 text-[#e5e4e2] transition-colors hover:bg-[#d3bb73]/20"
              title="Oddal"
            >
              <ZoomOut className="h-5 w-5" />
            </button>
          </div>

          {/* Instrukcja - lewy dolny róg */}
          <div className="absolute bottom-4 left-4 z-20 max-w-xs rounded-lg border border-[#d3bb73]/30 bg-[#1c1f33]/95 px-4 py-3 shadow-lg backdrop-blur-sm">
            <div className="flex items-start gap-2">
              <MapPin className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#d3bb73]" />
              <p className="text-xs text-[#e5e4e2]/70">
                Przeciągnij mapę aby zmienić lokalizację. Czerwona pinezka zawsze wskazuje wybrany
                punkt.
              </p>
            </div>
          </div>

          {/* Link do pełnej Google Maps - prawy dolny róg */}
          <div className="absolute bottom-4 right-4 z-20">
            <a
              href={`https://www.google.com/maps?q=${centerLat},${centerLng}&z=${zoom}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 font-medium text-[#1c1f33] shadow-lg transition-colors hover:bg-[#d3bb73]/90"
            >
              Otwórz w Google Maps
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>

          {/* Custom popup po kliknięciu na miejscu */}
          {showPlacePopup && clickedPlace && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
              <div className="mx-4 w-full max-w-md rounded-xl border-2 border-[#d3bb73] bg-[#1c1f33] p-6 shadow-2xl">
                <div className="mb-4 flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <MapPin className="h-6 w-6 flex-shrink-0 text-[#d3bb73]" />
                    <h3 className="text-lg font-semibold text-[#e5e4e2]">
                      {clickedPlace.name || 'Wybrane miejsce'}
                    </h3>
                  </div>
                  <button
                    onClick={() => setShowPlacePopup(false)}
                    className="rounded p-1 transition-colors hover:bg-[#d3bb73]/10"
                  >
                    <X className="h-5 w-5 text-[#e5e4e2]/70" />
                  </button>
                </div>

                <div className="mb-6 space-y-3">
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
                    <div className="border-t border-[#d3bb73]/20 pt-3 text-sm text-[#e5e4e2]/60">
                      {clickedPlace.formatted_address}
                    </div>
                  )}
                  <div className="rounded bg-[#0f1117] px-3 py-2 font-mono text-xs text-[#d3bb73]/80">
                    {clickedPlace.lat.toFixed(6)}, {clickedPlace.lng.toFixed(6)}
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => setShowPlacePopup(false)}
                    className="flex-1 rounded-lg bg-[#0f1117] px-4 py-2.5 font-medium text-[#e5e4e2] transition-colors hover:bg-[#d3bb73]/10"
                  >
                    Anuluj
                  </button>
                  <button
                    onClick={handleUseClickedPlace}
                    className="flex-1 rounded-lg bg-[#d3bb73] px-4 py-2.5 font-semibold text-[#1c1f33] shadow-lg transition-colors hover:bg-[#d3bb73]/90"
                  >
                    Użyj tej lokalizacji
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
