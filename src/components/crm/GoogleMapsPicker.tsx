'use client';

import { useState, useEffect } from 'react';
import { MapPin, ExternalLink } from 'lucide-react';

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
  const [selectedLat, setSelectedLat] = useState<number>(latitude || 52.2297);
  const [selectedLng, setSelectedLng] = useState<number>(longitude || 21.0122);
  const [mapUrl, setMapUrl] = useState('');
  const [zoom, setZoom] = useState(6);

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

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
          Mapa lokalizacji
        </label>
        <p className="text-xs text-[#e5e4e2]/60 mb-3">
          Przesuń mapę aby znaleźć miejsce. Pinezka (🔴) w centrum pokazuje wybraną lokalizację.
        </p>

        {/* Interaktywna mapa */}
        <div
          className="relative bg-[#0f1117] border-2 border-[#d3bb73]/30 rounded-lg overflow-hidden"
          style={{ height: '500px' }}
        >
          {/* Google Maps iframe */}
          <iframe
            src={`https://www.google.com/maps?q=${selectedLat},${selectedLng}&z=${zoom}&output=embed&gestureHandling=greedy`}
            className="absolute inset-0 w-full h-full pointer-events-auto"
            style={{ border: 0 }}
            loading="lazy"
            allowFullScreen
            onLoad={(e) => {
              // Nasłuchuj na zmiany centrum mapy
              const iframe = e.currentTarget;

              // Event listener dla zmian mapy
              const checkMapChanges = setInterval(() => {
                try {
                  // Gdy user przestanie przesuwać mapę, pobierz nowe centrum
                  const currentUrl = iframe.src;
                  const match = currentUrl.match(/q=([-\d.]+),([-\d.]+)/);
                  if (match) {
                    const lat = parseFloat(match[1]);
                    const lng = parseFloat(match[2]);

                    if (Math.abs(lat - selectedLat) > 0.0001 || Math.abs(lng - selectedLng) > 0.0001) {
                      setSelectedLat(lat);
                      setSelectedLng(lng);

                      const googleMapsUrl = `https://www.google.com/maps?q=${lat},${lng}`;
                      onLocationSelect({
                        latitude: lat,
                        longitude: lng,
                        formatted_address: `${lat.toFixed(6)}, ${lng.toFixed(6)}`,
                        google_maps_url: googleMapsUrl,
                      });
                    }
                  }
                } catch (err) {
                  // Cross-origin - nie możemy czytać iframe
                }
              }, 1000);

              // Cleanup
              return () => clearInterval(checkMapChanges);
            }}
          />

          {/* Pinezka w centrum - pokazuje wybraną lokalizację */}
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
              onClick={(e) => {
                e.stopPropagation();
                setZoom(Math.min(zoom + 2, 15));
              }}
              className="p-2 hover:bg-[#d3bb73]/20 rounded transition-colors text-[#e5e4e2] font-bold text-lg"
              title="Przybliż"
            >
              +
            </button>
            <div className="h-px bg-[#d3bb73]/30" />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setZoom(Math.max(zoom - 2, 3));
              }}
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
                <br />• Przesuń mapę aby znaleźć miejsce
                <br />• Pinezka (🔴) pokazuje centrum
                <br />• Przybliż/oddal [+] [-]
                <br />• Współrzędne zapisują się automatycznie
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
              onClick={(e) => e.stopPropagation()}
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
      {selectedLat && selectedLng && (
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
      )}
    </div>
  );
}
