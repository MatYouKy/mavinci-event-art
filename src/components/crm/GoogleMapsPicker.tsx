'use client';

import { useState, useEffect } from 'react';
import { MapPin, ExternalLink, Map } from 'lucide-react';
import InteractiveMapModal from './InteractiveMapModal';

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
  const [mapUrl, setMapUrl] = useState('');
  const [showMapModal, setShowMapModal] = useState(false);

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
      {/* Główny przycisk - Otwórz mapę */}
      <div>
        <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
          Wybierz lokalizację na mapie
        </label>
        <button
          type="button"
          onClick={() => setShowMapModal(true)}
          className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-gradient-to-r from-[#d3bb73] to-[#c4a960] text-[#1c1f33] rounded-lg font-medium hover:from-[#c4a960] hover:to-[#d3bb73] transition-all transform hover:scale-[1.02] shadow-lg"
        >
          <Map className="w-6 h-6" />
          <span className="text-lg">Otwórz mapę i wybierz miejsce</span>
        </button>
        <p className="text-xs text-[#e5e4e2]/50 mt-2 text-center">
          Kliknij aby otworzyć interaktywną mapę - znajdź i zaznacz lokalizację
        </p>
      </div>

      {/* Separator */}
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-[#d3bb73]/20"></div>
        </div>
        <div className="relative flex justify-center text-xs">
          <span className="px-2 bg-[#0f1117] text-[#e5e4e2]/50">lub użyj alternatywnych metod</span>
        </div>
      </div>

      {/* Alternatywne metody - kompaktowe */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={handlePasteGoogleMapsLink}
          className="flex items-center justify-center gap-2 px-3 py-2 bg-blue-500/10 border border-blue-500/20 text-blue-300 rounded-lg hover:bg-blue-500/20 transition-colors text-sm"
        >
          <MapPin className="w-4 h-4" />
          Wklej link
        </button>

        <button
          type="button"
          onClick={handleManualCoordinates}
          className="flex items-center justify-center gap-2 px-3 py-2 bg-green-500/10 border border-green-500/20 text-green-300 rounded-lg hover:bg-green-500/20 transition-colors text-sm"
        >
          <MapPin className="w-4 h-4" />
          Współrzędne
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
            Kliknij "Otwórz mapę" aby wybrać miejsce
          </p>
        </div>
      )}

      {/* Interactive Map Modal */}
      <InteractiveMapModal
        isOpen={showMapModal}
        onClose={() => setShowMapModal(false)}
        initialLatitude={latitude}
        initialLongitude={longitude}
        onLocationConfirm={(data) => {
          onLocationSelect(data);
          setShowMapModal(false);
        }}
      />
    </div>
  );
}
