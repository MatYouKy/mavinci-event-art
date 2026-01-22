'use client';

import { useState, useEffect } from 'react';
import { MapPin, ExternalLink, Plus } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useRouter } from 'next/navigation';

interface Location {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  postal_code: string | null;
}

interface Props {
  organizationId: string;
  currentLocationId: string | null;
  onLocationChange: (locationId: string | null) => void;
  editMode: boolean;
}

export function OrganizationLocationPicker({
  organizationId,
  currentLocationId,
  onLocationChange,
  editMode,
}: Props) {
  const router = useRouter();
  const [locations, setLocations] = useState<Location[]>([]);
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLocations();
  }, []);

  useEffect(() => {
    if (currentLocationId && locations.length > 0) {
      const location = locations.find((l) => l.id === currentLocationId);
      setSelectedLocation(location || null);
    }
  }, [currentLocationId, locations]);

  const fetchLocations = async () => {
    try {
      const { data, error } = await supabase
        .from('locations')
        .select('id, name, address, city, postal_code')
        .order('name');

      if (error) throw error;
      setLocations(data || []);
    } catch (err) {
      console.error('Error fetching locations:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleLocationSelect = (locationId: string) => {
    const location = locations.find((l) => l.id === locationId);
    setSelectedLocation(location || null);
    onLocationChange(locationId || null);
  };

  if (loading) {
    return <div className="text-sm text-gray-400">Ładowanie lokalizacji...</div>;
  }

  return (
    <div className="space-y-3">
      {editMode ? (
        <>
          <div className="flex gap-2">
            <select
              value={currentLocationId || ''}
              onChange={(e) => handleLocationSelect(e.target.value)}
              className="flex-1 rounded-lg border border-gray-700 bg-[#0f1119] px-4 py-2 text-white focus:border-[#d3bb73] focus:outline-none"
            >
              <option value="">Brak lokalizacji (użyj ręcznego adresu)</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name} - {location.city || 'Brak miasta'}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => router.push('/crm/locations')}
              className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#0f1119] transition-colors hover:bg-[#c4a859]"
              title="Dodaj nową lokalizację"
            >
              <Plus className="h-4 w-4" />
              Nowa
            </button>
          </div>
          {selectedLocation && (
            <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 p-3">
              <div className="mb-1 text-xs text-blue-400">✓ Wybrana lokalizacja:</div>
              <div className="text-sm font-medium text-white">{selectedLocation.name}</div>
              {selectedLocation.address && (
                <div className="text-xs text-gray-400">
                  {selectedLocation.address}, {selectedLocation.postal_code} {selectedLocation.city}
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <>
          {selectedLocation ? (
            <div className="flex items-start justify-between rounded-lg border border-gray-700 bg-[#0f1119] p-4">
              <div className="flex-1">
                <div className="mb-2 flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-[#d3bb73]" />
                  <span className="text-sm font-medium text-[#d3bb73]">Powiązana lokalizacja:</span>
                </div>
                <div className="font-medium text-white">{selectedLocation.name}</div>
                {selectedLocation.address && (
                  <div className="mt-1 text-sm text-gray-400">
                    {selectedLocation.address}
                    <br />
                    {selectedLocation.postal_code} {selectedLocation.city}
                  </div>
                )}
              </div>
              <button
                onClick={() => router.push(`/crm/locations/${selectedLocation.id}`)}
                className="flex items-center gap-2 rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-sm text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/20"
              >
                <ExternalLink className="h-4 w-4" />
                Szczegóły
              </button>
            </div>
          ) : (
            <div className="text-sm italic text-gray-400">
              Brak powiązanej lokalizacji - używany jest ręczny adres
            </div>
          )}
        </>
      )}
    </div>
  );
}
