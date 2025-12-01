'use client';

import { useState, useEffect } from 'react';
import { MapPin, ExternalLink, Plus } from 'lucide-react';
import { supabase } from '@/lib/supabase';
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

export function OrganizationLocationPicker({ organizationId, currentLocationId, onLocationChange, editMode }: Props) {
  const router = useRouter();
  const [locations, setLocations] = useState<Location[]>([]);
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLocations();
  }, []);

  useEffect(() => {
    if (currentLocationId && locations.length > 0) {
      const location = locations.find(l => l.id === currentLocationId);
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
    const location = locations.find(l => l.id === locationId);
    setSelectedLocation(location || null);
    onLocationChange(locationId || null);
  };

  if (loading) {
    return <div className="text-gray-400 text-sm">Ładowanie lokalizacji...</div>;
  }

  return (
    <div className="space-y-3">
      {editMode ? (
        <>
          <div className="flex gap-2">
            <select
              value={currentLocationId || ''}
              onChange={(e) => handleLocationSelect(e.target.value)}
              className="flex-1 px-4 py-2 bg-[#0f1119] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
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
              className="px-4 py-2 bg-[#d3bb73] text-[#0f1119] rounded-lg hover:bg-[#c4a859] transition-colors flex items-center gap-2"
              title="Dodaj nową lokalizację"
            >
              <Plus className="w-4 h-4" />
              Nowa
            </button>
          </div>
          {selectedLocation && (
            <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
              <div className="text-xs text-blue-400 mb-1">✓ Wybrana lokalizacja:</div>
              <div className="text-sm text-white font-medium">{selectedLocation.name}</div>
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
            <div className="flex items-start justify-between p-4 bg-[#0f1119] border border-gray-700 rounded-lg">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <MapPin className="w-4 h-4 text-[#d3bb73]" />
                  <span className="text-sm font-medium text-[#d3bb73]">Powiązana lokalizacja:</span>
                </div>
                <div className="text-white font-medium">{selectedLocation.name}</div>
                {selectedLocation.address && (
                  <div className="text-sm text-gray-400 mt-1">
                    {selectedLocation.address}
                    <br />
                    {selectedLocation.postal_code} {selectedLocation.city}
                  </div>
                )}
              </div>
              <button
                onClick={() => router.push(`/crm/locations/${selectedLocation.id}`)}
                className="px-3 py-2 bg-[#d3bb73]/10 text-[#d3bb73] rounded-lg hover:bg-[#d3bb73]/20 transition-colors flex items-center gap-2 text-sm"
              >
                <ExternalLink className="w-4 h-4" />
                Szczegóły
              </button>
            </div>
          ) : (
            <div className="text-gray-400 text-sm italic">
              Brak powiązanej lokalizacji - używany jest ręczny adres
            </div>
          )}
        </>
      )}
    </div>
  );
}
