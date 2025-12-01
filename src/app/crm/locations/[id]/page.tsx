'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import {
  MapPin,
  ArrowLeft,
  Edit,
  ExternalLink,
  Building2,
  Mail,
  Phone,
  Globe
} from 'lucide-react';

interface Location {
  id: string;
  name: string;
  address?: string;
  city?: string;
  postal_code?: string;
  country?: string;
  formatted_address?: string;
  latitude?: number;
  longitude?: number;
  google_place_id?: string;
  google_maps_url?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export default function LocationDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const locationId = params.id as string;

  const [location, setLocation] = useState<Location | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (locationId) {
      fetchLocation();
    }
  }, [locationId]);

  const fetchLocation = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('locations')
        .select('*')
        .eq('id', locationId)
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        setError('Lokalizacja nie została znaleziona');
        return;
      }

      setLocation(data);
    } catch (err) {
      console.error('Error fetching location:', err);
      setError('Błąd podczas pobierania lokalizacji');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0a0d1a]">
        <div className="text-[#e5e4e2]">Ładowanie...</div>
      </div>
    );
  }

  if (error || !location) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#0a0d1a]">
        <div className="text-red-400 mb-4">{error || 'Lokalizacja nie została znaleziona'}</div>
        <button
          onClick={() => router.back()}
          className="text-[#d3bb73] hover:underline"
        >
          Wróć
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0d1a] text-[#e5e4e2] p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <button
            onClick={() => router.back()}
            className="p-2 hover:bg-[#1c1f33] rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-2xl font-light text-[#e5e4e2]">{location.name}</h1>
            {location.formatted_address && (
              <p className="text-sm text-[#e5e4e2]/60 mt-1">{location.formatted_address}</p>
            )}
          </div>
          <button
            onClick={() => router.push(`/crm/locations`)}
            className="flex items-center gap-2 px-4 py-2 bg-[#1c1f33] hover:bg-[#1c1f33]/80 rounded-lg transition-colors"
          >
            <Edit className="w-4 h-4" />
            Edytuj
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Info */}
          <div className="lg:col-span-2 space-y-6">
            {/* Details Card */}
            <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
              <h2 className="text-lg font-light text-[#e5e4e2] mb-4">Szczegóły</h2>
              <div className="space-y-4">
                {location.address && (
                  <div className="flex items-start gap-3">
                    <Building2 className="w-5 h-5 text-[#d3bb73] mt-0.5" />
                    <div>
                      <p className="text-sm text-[#e5e4e2]/60">Adres</p>
                      <p className="text-[#e5e4e2]">{location.address}</p>
                    </div>
                  </div>
                )}

                {location.city && (
                  <div className="flex items-start gap-3">
                    <MapPin className="w-5 h-5 text-[#d3bb73] mt-0.5" />
                    <div>
                      <p className="text-sm text-[#e5e4e2]/60">Miasto</p>
                      <p className="text-[#e5e4e2]">
                        {location.postal_code && `${location.postal_code} `}
                        {location.city}
                      </p>
                    </div>
                  </div>
                )}

                {location.country && (
                  <div className="flex items-start gap-3">
                    <Globe className="w-5 h-5 text-[#d3bb73] mt-0.5" />
                    <div>
                      <p className="text-sm text-[#e5e4e2]/60">Kraj</p>
                      <p className="text-[#e5e4e2]">{location.country}</p>
                    </div>
                  </div>
                )}

                {location.latitude && location.longitude && (
                  <div className="flex items-start gap-3">
                    <MapPin className="w-5 h-5 text-[#d3bb73] mt-0.5" />
                    <div>
                      <p className="text-sm text-[#e5e4e2]/60">Współrzędne</p>
                      <p className="text-[#e5e4e2] font-mono text-sm">
                        {location.latitude.toFixed(6)}, {location.longitude.toFixed(6)}
                      </p>
                    </div>
                  </div>
                )}

                {location.google_maps_url && (
                  <div className="pt-4 border-t border-[#d3bb73]/10">
                    <a
                      href={location.google_maps_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-[#d3bb73] hover:text-[#d3bb73]/80 transition-colors"
                    >
                      <ExternalLink className="w-4 h-4" />
                      Otwórz w Google Maps
                    </a>
                  </div>
                )}
              </div>
            </div>

            {/* Notes */}
            {location.notes && (
              <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
                <h2 className="text-lg font-light text-[#e5e4e2] mb-4">Notatki</h2>
                <p className="text-[#e5e4e2]/80 leading-relaxed whitespace-pre-wrap">
                  {location.notes}
                </p>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Map */}
            {location.latitude && location.longitude && (
              <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
                <h2 className="text-lg font-light text-[#e5e4e2] mb-4">Mapa</h2>
                <div
                  className="relative w-full h-64 bg-[#0f1117] rounded-lg overflow-hidden border border-[#d3bb73]/20"
                >
                  <iframe
                    src={`https://www.google.com/maps/embed/v1/place?key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}&q=${location.latitude},${location.longitude}&zoom=15`}
                    className="w-full h-full border-0"
                    allowFullScreen
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                  />
                </div>
              </div>
            )}

            {/* Metadata */}
            <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
              <h2 className="text-lg font-light text-[#e5e4e2] mb-4">Informacje</h2>
              <div className="space-y-3 text-sm">
                <div>
                  <p className="text-[#e5e4e2]/60">Utworzono</p>
                  <p className="text-[#e5e4e2]">
                    {new Date(location.created_at).toLocaleDateString('pl-PL', {
                      day: '2-digit',
                      month: 'long',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </p>
                </div>
                {location.updated_at !== location.created_at && (
                  <div>
                    <p className="text-[#e5e4e2]/60">Zaktualizowano</p>
                    <p className="text-[#e5e4e2]">
                      {new Date(location.updated_at).toLocaleDateString('pl-PL', {
                        day: '2-digit',
                        month: 'long',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </p>
                  </div>
                )}
                {location.google_place_id && (
                  <div>
                    <p className="text-[#e5e4e2]/60">Google Place ID</p>
                    <p className="text-[#e5e4e2] font-mono text-xs break-all">
                      {location.google_place_id}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
