'use client';

import React, { FC, useEffect, useMemo, useRef, useState } from 'react';
import { X, MapPin } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import GoogleMapsPicker from '@/components/crm/GoogleMapsPicker';

type PolishCityForm = {
  name: string;
  slug: string;
  postal_code: string;
  region: string;
  population: string;
  latitude: number | null;
  longitude: number | null;
  google_place_id: string;
  formatted_address: string;
};

const emptyForm: PolishCityForm = {
  name: '',
  slug: '',
  postal_code: '',
  region: '',
  population: '',
  latitude: null,
  longitude: null,
  google_place_id: '',
  formatted_address: '',
};

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
};

type GoogleAddressComponent = {
  long_name: string;
  short_name?: string;
  types: string[];
};

type GooglePlaceDetailsResult = {
  address_components?: GoogleAddressComponent[];
  name?: string;
  formatted_address?: string;
};

function isFullPostalCode(value?: string | null) {
  if (!value) return false;
  return /^\d{2}-\d{3}$/.test(value.trim());
}

function slugifyCity(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/ą/g, 'a')
    .replace(/ć/g, 'c')
    .replace(/ę/g, 'e')
    .replace(/ł/g, 'l')
    .replace(/ń/g, 'n')
    .replace(/ó/g, 'o')
    .replace(/ś/g, 's')
    .replace(/[źż]/g, 'z')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

function mapGoogleRegionToPolishVoivodeship(region?: string) {
  if (!region) return '';

  const map: Record<string, string> = {
    'Lower Silesian Voivodeship': 'Województwo Dolnośląskie',
    'Kuyavian-Pomeranian Voivodeship': 'Województwo Kujawsko-Pomorskie',
    'Lublin Voivodeship': 'Województwo Lubelskie',
    'Lubusz Voivodeship': 'Województwo Lubuskie',
    'Łódź Voivodeship': 'Województwo Łódzkie',
    'Lodz Voivodeship': 'Województwo Łódzkie',
    'Lesser Poland Voivodeship': 'Województwo Małopolskie',
    'Masovian Voivodeship': 'Województwo Mazowieckie',
    'Opole Voivodeship': 'Województwo Opolskie',
    'Subcarpathian Voivodeship': 'Województwo Podkarpackie',
    'Podlaskie Voivodeship': 'Województwo Podlaskie',
    'Pomeranian Voivodeship': 'Województwo Pomorskie',
    'Silesian Voivodeship': 'Województwo Śląskie',
    'Świętokrzyskie Voivodeship': 'Województwo Świętokrzyskie',
    'Swietokrzyskie Voivodeship': 'Województwo Świętokrzyskie',
    'Warmian-Masurian Voivodeship': 'Województwo Warmińsko-Mazurskie',
    'Greater Poland Voivodeship': 'Województwo Wielkopolskie',
    'West Pomeranian Voivodeship': 'Województwo Zachodniopomorskie',
  };

  return map[region] || region;
}

function getAddressComponent(components: GoogleAddressComponent[] = [], type: string) {
  return components.find((c) => c.types.includes(type))?.long_name || '';
}

export const AddPolishCityModal: FC<Props> = ({ open, onClose, onSaved }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const leftScrollRef = useRef<HTMLDivElement>(null);

  const [formData, setFormData] = useState<PolishCityForm>(emptyForm);
  const [isSaving, setIsSaving] = useState(false);
  const [isResolvingRegion, setIsResolvingRegion] = useState(false);
  const [localError, setLocalError] = useState('');

  const { showSnackbar } = useSnackbar();

  useEffect(() => {
    if (!open) return;
    setFormData(emptyForm);
    setLocalError('');
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', onKeyDown);
    setTimeout(() => panelRef.current?.focus(), 0);

    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  const normalizedPayload = useMemo(() => {
    return {
      name: formData.name.trim(),
      slug: slugifyCity(formData.slug || formData.name),
      postal_code: formData.postal_code.trim() || null,
      region: formData.region.trim(),
      population: formData.population.trim() ? Number(formData.population) : null,
    };
  }, [formData]);

  const resolveRegionFromPlaceId = async (placeId?: string) => {
    if (!placeId) return '';

    try {
      setIsResolvingRegion(true);

      const detailsResponse = await fetch(
        `/bridge/places/details?place_id=${encodeURIComponent(placeId)}`,
      );
      const detailsData = await detailsResponse.json();

      if (detailsData?.status !== 'OK' || !detailsData?.result) return '';

      const place = detailsData.result as GooglePlaceDetailsResult;
      const components = place.address_components || [];

      const regionRaw = getAddressComponent(components, 'administrative_area_level_1');
      return mapGoogleRegionToPolishVoivodeship(regionRaw);
    } catch (error) {
      console.error('Błąd pobierania regionu z Google Places:', error);
      return '';
    } finally {
      setIsResolvingRegion(false);
    }
  };

  const handleSave = async () => {
    setLocalError('');

    if (!normalizedPayload.name) {
      const msg = 'Nazwa miasta jest wymagana';
      setLocalError(msg);
      showSnackbar(msg, 'error');
      return;
    }

    if (!normalizedPayload.slug) {
      const msg = 'Slug miasta jest wymagany';
      setLocalError(msg);
      showSnackbar(msg, 'error');
      return;
    }

    if (!normalizedPayload.region) {
      const msg = 'Region jest wymagany';
      setLocalError(msg);
      showSnackbar(msg, 'error');
      return;
    }

    try {
      setIsSaving(true);

      const { data: existingBySlug } = await supabase
        .from('polish_cities')
        .select('id')
        .eq('slug', normalizedPayload.slug)
        .maybeSingle();

      if (existingBySlug) {
        const msg = 'Miasto z takim slugiem już istnieje';
        setLocalError(msg);
        showSnackbar(msg, 'error');
        return;
      }

      const { error } = await supabase.from('polish_cities').insert({
        name: normalizedPayload.name,
        slug: normalizedPayload.slug,
        postal_code: normalizedPayload.postal_code,
        region: normalizedPayload.region,
        population: normalizedPayload.population,
      });

      if (error) throw error;

      showSnackbar('Miasto dodane do sugestii', 'success');
      onSaved?.();
      onClose();
    } catch (error) {
      console.error(error);
      setLocalError('Błąd podczas dodawania miasta');
      showSnackbar('Błąd podczas dodawania miasta', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 bg-black/50"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      />

      <div className="absolute inset-0 flex items-center justify-center p-3 sm:p-4 md:p-8">
        <div
          ref={panelRef}
          tabIndex={-1}
          onMouseDown={(e) => e.stopPropagation()}
          className="relative flex h-[calc(100vh-1.5rem)] w-full max-w-6xl flex-col rounded-xl bg-[#1c1f33] text-[#e5e4e2] shadow-2xl outline-none sm:h-[calc(100vh-2rem)] md:h-[calc(100vh-4rem)]"
        >
          <div className="flex items-center justify-between border-b border-[#d3bb73]/20 px-5 py-4 sm:px-6">
            <h2 className="text-lg font-bold text-[#e5e4e2] sm:text-xl">
              Dodaj miasto do sugestii
            </h2>

            <button
              onClick={onClose}
              className="rounded-lg p-2 text-[#e5e4e2]/70 transition-colors hover:bg-[#d3bb73]/10 hover:text-[#e5e4e2]"
              aria-label="Zamknij"
              disabled={isSaving}
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="flex-1 overflow-hidden">
            <div className="grid h-full grid-rows-[auto,1fr] gap-4 p-4 sm:p-6 md:grid-cols-2 md:grid-rows-1 md:gap-6">
              <div
                ref={leftScrollRef}
                className="order-1 h-full overflow-y-auto pr-0 md:order-none md:pr-1"
              >
                <div className="space-y-4">
                  {localError && (
                    <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                      {localError}
                    </div>
                  )}

                  <div className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1117] px-4 py-3 text-sm text-[#e5e4e2]/70">
                    <div className="mb-1 flex items-center gap-2 font-medium text-[#e5e4e2]">
                      <MapPin className="h-4 w-4 text-[#d3bb73]" />
                      Wybór miasta
                    </div>
                    Wyszukaj miasto po prawej stronie, kliknij wynik i zatwierdź lokalizację.
                    Formularz uzupełni się automatycznie.
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                      Nazwa miasta *
                    </label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) =>
                        setFormData((s) => ({
                          ...s,
                          name: e.target.value,
                          slug: slugifyCity(e.target.value),
                        }))
                      }
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                      placeholder="np. Olsztyn"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Slug *</label>
                    <input
                      type="text"
                      value={formData.slug}
                      onChange={(e) =>
                        setFormData((s) => ({
                          ...s,
                          slug: slugifyCity(e.target.value),
                        }))
                      }
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                      placeholder="np. olsztyn"
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                        Region *
                      </label>
                      <input
                        type="text"
                        value={formData.region}
                        onChange={(e) => setFormData((s) => ({ ...s, region: e.target.value }))}
                        className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                        placeholder="np. Województwo Warmińsko-Mazurskie"
                      />
                      {isResolvingRegion && (
                        <p className="mt-1 text-xs text-[#d3bb73]">Pobieranie regionu z Google...</p>
                      )}
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                        Kod pocztowy
                      </label>
                      <input
                        type="text"
                        value={formData.postal_code}
                        onChange={(e) =>
                          setFormData((s) => ({ ...s, postal_code: e.target.value }))
                        }
                        placeholder="opcjonalnie"
                        className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                      Liczba ludności
                    </label>
                    <input
                      type="number"
                      value={formData.population}
                      onChange={(e) => setFormData((s) => ({ ...s, population: e.target.value }))}
                      placeholder="opcjonalnie"
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                    />
                  </div>

                  {formData.formatted_address && (
                    <div className="rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] px-4 py-3 text-sm text-[#e5e4e2]/70">
                      <div className="font-medium text-[#e5e4e2]">Wybrana lokalizacja</div>
                      <div className="mt-1 text-xs text-[#e5e4e2]/60">
                        {formData.formatted_address}
                      </div>
                    </div>
                  )}

                  <div className="h-8" />
                </div>
              </div>

              <div className="order-2 h-full overflow-y-auto md:order-none md:pl-1">
                <div className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1117] p-3 sm:p-4 md:border-none md:bg-transparent md:p-0">
                  <GoogleMapsPicker
                    latitude={formData.latitude}
                    longitude={formData.longitude}
                    onLocationSelect={async (data) => {
                      const cityName = data.city || data.name || '';

                      setFormData((s) => ({
                        ...s,
                        name: cityName || s.name,
                        slug: cityName ? slugifyCity(cityName) : s.slug,
                        postal_code: isFullPostalCode(data.postal_code) ? data.postal_code! : s.postal_code,
                        latitude: data.latitude,
                        longitude: data.longitude,
                        google_place_id: data.google_place_id || s.google_place_id,
                        formatted_address: data.formatted_address || s.formatted_address,
                      }));

                      if (data.google_place_id) {
                        const region = await resolveRegionFromPlaceId(data.google_place_id);

                        if (region) {
                          setFormData((s) => ({
                            ...s,
                            region,
                          }));
                        }
                      }

                      requestAnimationFrame(() => {
                        leftScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
                      });
                    }}
                    onConfirmLocation={() => {
                      requestAnimationFrame(() => {
                        leftScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
                      });
                    }}
                  />
                </div>

                <div className="h-6 md:hidden" />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-[#d3bb73]/20 px-4 py-4 sm:px-6">
            <button
              onClick={onClose}
              disabled={isSaving}
              className="rounded-lg px-4 py-2 text-[#e5e4e2] transition-colors hover:bg-[#d3bb73]/10 disabled:opacity-50"
            >
              Anuluj
            </button>

            <button
              onClick={handleSave}
              disabled={isSaving}
              className="rounded-lg bg-[#d3bb73] px-4 py-2 font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:opacity-50"
            >
              {isSaving ? 'Zapisuję...' : 'Dodaj miasto'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};