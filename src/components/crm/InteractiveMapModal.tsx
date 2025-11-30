'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Search, MapPin, Navigation, Crosshair } from 'lucide-react';

interface InteractiveMapModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialLatitude?: number | null;
  initialLongitude?: number | null;
  onLocationConfirm: (data: {
    latitude: number;
    longitude: number;
    formatted_address: string;
    google_maps_url: string;
  }) => void;
}

export default function InteractiveMapModal({
  isOpen,
  onClose,
  initialLatitude,
  initialLongitude,
  onLocationConfirm,
}: InteractiveMapModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLat, setSelectedLat] = useState<number>(initialLatitude || 52.2297);
  const [selectedLng, setSelectedLng] = useState<number>(initialLongitude || 21.0122);
  const [markerPosition, setMarkerPosition] = useState({ x: 50, y: 50 });
  const [isDragging, setIsDragging] = useState(false);
  const [mapCenter, setMapCenter] = useState({ lat: selectedLat, lng: selectedLng });
  const [zoom, setZoom] = useState(13);
  const mapContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initialLatitude && initialLongitude) {
      setSelectedLat(initialLatitude);
      setSelectedLng(initialLongitude);
      setMapCenter({ lat: initialLatitude, lng: initialLongitude });
    }
  }, [initialLatitude, initialLongitude]);

  const handleSearch = () => {
    if (!searchQuery) return;

    // Używamy Geocoding API przez Google Maps
    const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(searchQuery)}&key=YOUR_API_KEY`;

    // Dla demonstracji - otwieramy Google Maps w nowej karcie
    const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(searchQuery)}`;
    window.open(searchUrl, '_blank');
  };

  const handleGetCurrentLocation = () => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          setSelectedLat(lat);
          setSelectedLng(lng);
          setMapCenter({ lat, lng });
        },
        (error) => {
          alert('Nie udało się pobrać lokalizacji: ' + error.message);
        }
      );
    } else {
      alert('Geolokalizacja nie jest dostępna w tej przeglądarce');
    }
  };

  const handleMapClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!mapContainerRef.current) return;

    const rect = mapContainerRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    setMarkerPosition({ x, y });

    // Przybliżone przeliczenie kliknięcia na współrzędne
    // W rzeczywistości potrzebowałbyś użyć Google Maps API
    const latOffset = (50 - y) * 0.05;
    const lngOffset = (x - 50) * 0.05;

    const newLat = mapCenter.lat + latOffset;
    const newLng = mapCenter.lng + lngOffset;

    setSelectedLat(newLat);
    setSelectedLng(newLng);
  };

  const handleConfirm = () => {
    const googleMapsUrl = `https://www.google.com/maps?q=${selectedLat},${selectedLng}`;

    onLocationConfirm({
      latitude: selectedLat,
      longitude: selectedLng,
      formatted_address: `${selectedLat.toFixed(6)}, ${selectedLng.toFixed(6)}`,
      google_maps_url: googleMapsUrl,
    });

    onClose();
  };

  const handleZoomIn = () => {
    setZoom(Math.min(zoom + 1, 20));
  };

  const handleZoomOut = () => {
    setZoom(Math.max(zoom - 1, 1));
  };

  const handleRecenter = () => {
    setMapCenter({ lat: selectedLat, lng: selectedLng });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-[#1c1f33] rounded-lg w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[#d3bb73]/20">
          <div>
            <h2 className="text-xl font-bold text-[#e5e4e2]">Wybierz lokalizację</h2>
            <p className="text-sm text-[#e5e4e2]/60 mt-1">
              Wyszukaj adres lub kliknij na mapie aby zaznaczyć lokalizację
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[#d3bb73]/10 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-[#e5e4e2]" />
          </button>
        </div>

        {/* Search bar */}
        <div className="p-4 border-b border-[#d3bb73]/20">
          <div className="flex gap-2">
            <div className="flex-1 flex gap-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="Wyszukaj adres, nazwę miejsca..."
                className="flex-1 px-4 py-2 bg-[#0f1117] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/50"
              />
              <button
                onClick={handleSearch}
                className="px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
              >
                <Search className="w-5 h-5" />
              </button>
            </div>
            <button
              onClick={handleGetCurrentLocation}
              className="px-4 py-2 bg-blue-500/10 border border-blue-500/20 text-blue-300 rounded-lg hover:bg-blue-500/20 transition-colors flex items-center gap-2"
              title="Użyj mojej lokalizacji"
            >
              <Navigation className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Map container */}
        <div className="flex-1 p-4 overflow-hidden">
          <div className="relative h-full rounded-lg overflow-hidden border border-[#d3bb73]/20">
            {/* Google Maps iframe */}
            <iframe
              src={`https://www.google.com/maps?q=${mapCenter.lat},${mapCenter.lng}&z=${zoom}&output=embed&gestureHandling=greedy`}
              className="absolute inset-0 w-full h-full"
              style={{ border: 0 }}
              loading="lazy"
              allowFullScreen
            />

            {/* Overlay marker (centrum) */}
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div className="relative">
                <MapPin className="w-12 h-12 text-red-500 drop-shadow-lg" style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))' }} />
                <div className="absolute -top-2 -right-2 w-4 h-4 bg-red-500 rounded-full animate-ping" />
              </div>
            </div>

            {/* Zoom controls */}
            <div className="absolute right-4 top-4 flex flex-col gap-2 bg-[#1c1f33]/90 backdrop-blur-sm rounded-lg border border-[#d3bb73]/20 p-1">
              <button
                onClick={handleZoomIn}
                className="p-2 hover:bg-[#d3bb73]/20 rounded transition-colors text-[#e5e4e2]"
                title="Przybliż"
              >
                <span className="text-xl">+</span>
              </button>
              <div className="h-px bg-[#d3bb73]/20" />
              <button
                onClick={handleZoomOut}
                className="p-2 hover:bg-[#d3bb73]/20 rounded transition-colors text-[#e5e4e2]"
                title="Oddal"
              >
                <span className="text-xl">−</span>
              </button>
              <div className="h-px bg-[#d3bb73]/20" />
              <button
                onClick={handleRecenter}
                className="p-2 hover:bg-[#d3bb73]/20 rounded transition-colors text-[#e5e4e2]"
                title="Wyśrodkuj"
              >
                <Crosshair className="w-5 h-5" />
              </button>
            </div>

            {/* Coordinates display */}
            <div className="absolute left-4 top-4 bg-[#1c1f33]/90 backdrop-blur-sm rounded-lg border border-[#d3bb73]/20 px-4 py-2">
              <div className="text-xs text-[#e5e4e2]/70 mb-1">Współrzędne:</div>
              <div className="font-mono text-sm text-[#d3bb73]">
                {selectedLat.toFixed(6)}, {selectedLng.toFixed(6)}
              </div>
            </div>

            {/* Instructions */}
            <div className="absolute left-4 bottom-4 bg-[#1c1f33]/90 backdrop-blur-sm rounded-lg border border-[#d3bb73]/20 px-4 py-2 max-w-xs">
              <div className="text-xs text-[#e5e4e2]/70">
                💡 Wskazówka: Przesuń mapę aby ustawić pineskę w wybranym miejscu
              </div>
            </div>
          </div>
        </div>

        {/* Manual coordinates input */}
        <div className="p-4 border-t border-[#d3bb73]/20">
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <label className="block text-xs text-[#e5e4e2]/60 mb-1">Szerokość geograficzna</label>
              <input
                type="number"
                step="0.000001"
                value={selectedLat}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  if (!isNaN(val)) {
                    setSelectedLat(val);
                    setMapCenter({ lat: val, lng: selectedLng });
                  }
                }}
                className="w-full px-3 py-2 bg-[#0f1117] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] text-sm focus:outline-none focus:border-[#d3bb73]/50"
                placeholder="np. 52.229700"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-[#e5e4e2]/60 mb-1">Długość geograficzna</label>
              <input
                type="number"
                step="0.000001"
                value={selectedLng}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  if (!isNaN(val)) {
                    setSelectedLng(val);
                    setMapCenter({ lat: selectedLat, lng: val });
                  }
                }}
                className="w-full px-3 py-2 bg-[#0f1117] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] text-sm focus:outline-none focus:border-[#d3bb73]/50"
                placeholder="np. 21.012200"
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-[#d3bb73]/20">
          <div className="text-sm text-[#e5e4e2]/60">
            Wybrana lokalizacja: <span className="text-[#d3bb73] font-medium">
              {selectedLat.toFixed(6)}, {selectedLng.toFixed(6)}
            </span>
          </div>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-[#e5e4e2] hover:bg-[#d3bb73]/10 rounded-lg transition-colors"
            >
              Anuluj
            </button>
            <button
              onClick={handleConfirm}
              className="px-6 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg font-medium hover:bg-[#d3bb73]/90 transition-colors"
            >
              Potwierdź lokalizację
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
