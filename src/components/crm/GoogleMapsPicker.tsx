'use client';

import { useState, useEffect, useRef } from 'react';
import { MapPin, Search, ExternalLink } from 'lucide-react';

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

export default function GoogleMapsPicker({
  latitude,
  longitude,
  onLocationSelect,
}: GoogleMapsPickerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [mapUrl, setMapUrl] = useState('');

  useEffect(() => {
    // Generuj URL do Google Maps
    if (latitude && longitude) {
      const url = `https://www.google.com/maps?q=${latitude},${longitude}&z=15`;
      setMapUrl(url);
    }
  }, [latitude, longitude]);

  const handleSearch = () => {
    if (!searchQuery) return;

    // Używamy Google Maps Geocoding przez iframe
    const encodedQuery = encodeURIComponent(searchQuery);
    const searchUrl = `https://www.google.com/maps/search/${encodedQuery}`;
    window.open(searchUrl, '_blank');
  };

  const handleManualCoordinates = () => {
    const lat = prompt('Wprowadź szerokość geograficzną (latitude):');
    const lng = prompt('Wprowadź długość geograficzną (longitude):');

    if (lat && lng) {
      const latNum = parseFloat(lat);
      const lngNum = parseFloat(lng);

      if (!isNaN(latNum) && !isNaN(lngNum)) {
        const googleMapsUrl = `https://www.google.com/maps?q=${latNum},${lngNum}`;
        onLocationSelect({
          latitude: latNum,
          longitude: lngNum,
          formatted_address: `${latNum}, ${lngNum}`,
          google_maps_url: googleMapsUrl,
        });
      }
    }
  };

  const handlePasteGoogleMapsLink = () => {
    const link = prompt(
      'Wklej link z Google Maps:\n(np. https://maps.google.com/?q=52.2297,21.0122)'
    );

    if (!link) return;

    // Parsuj różne formaty linków Google Maps
    const patterns = [
      /q=([-\d.]+),([-\d.]+)/, // ?q=lat,lng
      /@([-\d.]+),([-\d.]+)/, // @lat,lng
      /place\/([-\d.]+),([-\d.]+)/, // /place/lat,lng
    ];

    for (const pattern of patterns) {
      const match = link.match(pattern);
      if (match) {
        const lat = parseFloat(match[1]);
        const lng = parseFloat(match[2]);

        if (!isNaN(lat) && !isNaN(lng)) {
          const googleMapsUrl = `https://www.google.com/maps?q=${lat},${lng}`;
          onLocationSelect({
            latitude: lat,
            longitude: lng,
            formatted_address: `${lat}, ${lng}`,
            google_maps_url: googleMapsUrl,
          });
          return;
        }
      }
    }

    alert('Nie udało się sparsować współrzędnych z podanego linku.');
  };

  return (
    <div className="space-y-4">
      {/* Wyszukiwanie */}
      <div>
        <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
          Wyszukaj lokalizację
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
            className="flex-1 px-4 py-2 bg-[#0f1117] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/50"
            placeholder="Wpisz adres, nazwę miejsca..."
          />
          <button
            type="button"
            onClick={handleSearch}
            className="px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
          >
            <Search className="w-5 h-5" />
          </button>
        </div>
        <p className="text-xs text-[#e5e4e2]/50 mt-1">
          Otwiera Google Maps w nowej karcie - skopiuj link i wklej poniżej
        </p>
      </div>

      {/* Przyciski akcji */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={handlePasteGoogleMapsLink}
          className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-500/10 border border-blue-500/20 text-blue-300 rounded-lg hover:bg-blue-500/20 transition-colors"
        >
          <MapPin className="w-4 h-4" />
          Wklej link z Google Maps
        </button>

        <button
          type="button"
          onClick={handleManualCoordinates}
          className="flex items-center justify-center gap-2 px-4 py-2 bg-green-500/10 border border-green-500/20 text-green-300 rounded-lg hover:bg-green-500/20 transition-colors"
        >
          <MapPin className="w-4 h-4" />
          Wprowadź współrzędne
        </button>
      </div>

      {/* Podgląd mapy */}
      {latitude && longitude && (
        <div className="space-y-2">
          <label className="block text-sm font-medium text-[#e5e4e2]">
            Mapa lokalizacji
          </label>
          <div className="relative bg-[#0f1117] border border-[#d3bb73]/20 rounded-lg overflow-hidden">
            {/* Embedded Google Maps */}
            <iframe
              width="100%"
              height="300"
              style={{ border: 0 }}
              loading="lazy"
              src={`https://www.google.com/maps?q=${latitude},${longitude}&z=15&output=embed`}
              className="rounded-lg"
            />

            {/* Overlay z informacjami */}
            <div className="absolute top-2 right-2 bg-[#1c1f33]/90 backdrop-blur-sm px-3 py-2 rounded-lg border border-[#d3bb73]/20">
              <div className="text-xs text-[#e5e4e2]/70 space-y-1">
                <div>Lat: {latitude.toFixed(6)}</div>
                <div>Lng: {longitude.toFixed(6)}</div>
              </div>
            </div>

            {/* Link do Google Maps */}
            <a
              href={mapUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="absolute bottom-2 right-2 flex items-center gap-1 px-3 py-1.5 bg-[#d3bb73] text-[#1c1f33] text-xs font-medium rounded hover:bg-[#d3bb73]/90 transition-colors"
            >
              Otwórz w Google Maps
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          {/* Współrzędne do kopiowania */}
          <div className="flex items-center gap-2 p-3 bg-[#0f1117] border border-[#d3bb73]/20 rounded-lg">
            <MapPin className="w-4 h-4 text-[#d3bb73]" />
            <code className="flex-1 text-sm text-[#e5e4e2]">
              {latitude}, {longitude}
            </code>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(`${latitude}, ${longitude}`);
              }}
              className="text-xs text-[#d3bb73] hover:underline"
            >
              Kopiuj
            </button>
          </div>
        </div>
      )}

      {!latitude && !longitude && (
        <div className="text-center py-8 text-[#e5e4e2]/50 border border-dashed border-[#d3bb73]/20 rounded-lg">
          <MapPin className="w-12 h-12 mx-auto mb-2 text-[#e5e4e2]/30" />
          <p className="text-sm">Nie wybrano lokalizacji</p>
          <p className="text-xs mt-1">
            Użyj jednej z opcji powyżej aby dodać lokalizację
          </p>
        </div>
      )}
    </div>
  );
}
