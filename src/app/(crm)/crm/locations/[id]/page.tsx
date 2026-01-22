'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/browser';
import { MapPin, ArrowLeft, Edit, ExternalLink, Building2, Mail, Phone, Globe } from 'lucide-react';

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
      <div className="flex min-h-screen items-center justify-center bg-[#0a0d1a]">
        <div className="text-[#e5e4e2]">Ładowanie...</div>
      </div>
    );
  }

  if (error || !location) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#0a0d1a]">
        <div className="mb-4 text-red-400">{error || 'Lokalizacja nie została znaleziona'}</div>
        <button onClick={() => router.back()} className="text-[#d3bb73] hover:underline">
          Wróć
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0d1a] p-6 text-[#e5e4e2]">
      <div className="mx-auto max-w-6xl">
        {/* Header */}
        <div className="mb-6 flex items-center gap-4">
          <button
            onClick={() => router.back()}
            className="rounded-lg p-2 transition-colors hover:bg-[#1c1f33]"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-2xl font-light text-[#e5e4e2]">{location.name}</h1>
            {location.formatted_address && (
              <p className="mt-1 text-sm text-[#e5e4e2]/60">{location.formatted_address}</p>
            )}
          </div>
          <button
            onClick={() => router.push(`/crm/locations`)}
            className="flex items-center gap-2 rounded-lg bg-[#1c1f33] px-4 py-2 transition-colors hover:bg-[#1c1f33]/80"
          >
            <Edit className="h-4 w-4" />
            Edytuj
          </button>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Main Info */}
          <div className="space-y-6 lg:col-span-2">
            {/* Details Card */}
            <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
              <h2 className="mb-4 text-lg font-light text-[#e5e4e2]">Szczegóły</h2>
              <div className="space-y-4">
                {location.address && (
                  <div className="flex items-start gap-3">
                    <Building2 className="mt-0.5 h-5 w-5 text-[#d3bb73]" />
                    <div>
                      <p className="text-sm text-[#e5e4e2]/60">Adres</p>
                      <p className="text-[#e5e4e2]">{location.address}</p>
                    </div>
                  </div>
                )}

                {location.city && (
                  <div className="flex items-start gap-3">
                    <MapPin className="mt-0.5 h-5 w-5 text-[#d3bb73]" />
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
                    <Globe className="mt-0.5 h-5 w-5 text-[#d3bb73]" />
                    <div>
                      <p className="text-sm text-[#e5e4e2]/60">Kraj</p>
                      <p className="text-[#e5e4e2]">{location.country}</p>
                    </div>
                  </div>
                )}

                {location.latitude && location.longitude && (
                  <div className="flex items-start gap-3">
                    <MapPin className="mt-0.5 h-5 w-5 text-[#d3bb73]" />
                    <div>
                      <p className="text-sm text-[#e5e4e2]/60">Współrzędne</p>
                      <p className="font-mono text-sm text-[#e5e4e2]">
                        {location.latitude.toFixed(6)}, {location.longitude.toFixed(6)}
                      </p>
                    </div>
                  </div>
                )}

                {location.google_maps_url && (
                  <div className="border-t border-[#d3bb73]/10 pt-4">
                    <a
                      href={location.google_maps_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-[#d3bb73] transition-colors hover:text-[#d3bb73]/80"
                    >
                      <ExternalLink className="h-4 w-4" />
                      Otwórz w Google Maps
                    </a>
                  </div>
                )}
              </div>
            </div>

            {/* Notes */}
            {location.notes && (
              <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
                <h2 className="mb-4 text-lg font-light text-[#e5e4e2]">Notatki</h2>
                <p className="whitespace-pre-wrap leading-relaxed text-[#e5e4e2]/80">
                  {location.notes}
                </p>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Map */}
            {location.latitude && location.longitude && (
              <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
                <h2 className="mb-4 text-lg font-light text-[#e5e4e2]">Mapa</h2>
                <div className="relative h-64 w-full overflow-hidden rounded-lg border border-[#d3bb73]/20 bg-[#0f1117]">
                  <iframe
                    src={`https://www.google.com/maps/embed/v1/place?key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}&q=${location.latitude},${location.longitude}&zoom=15`}
                    className="h-full w-full border-0"
                    allowFullScreen
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                  />
                </div>
              </div>
            )}

            {/* Metadata */}
            <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
              <h2 className="mb-4 text-lg font-light text-[#e5e4e2]">Informacje</h2>
              <div className="space-y-3 text-sm">
                <div>
                  <p className="text-[#e5e4e2]/60">Utworzono</p>
                  <p className="text-[#e5e4e2]">
                    {new Date(location.created_at).toLocaleDateString('pl-PL', {
                      day: '2-digit',
                      month: 'long',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
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
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                )}
                {location.google_place_id && (
                  <div>
                    <p className="text-[#e5e4e2]/60">Google Place ID</p>
                    <p className="break-all font-mono text-xs text-[#e5e4e2]">
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
