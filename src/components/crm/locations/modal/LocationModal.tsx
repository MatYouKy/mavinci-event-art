'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Trash2 } from 'lucide-react';
import GoogleMapsPicker from '@/components/crm/GoogleMapsPicker';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import { useLocations } from '@/app/(crm)/crm/locations/useLocations';
import type { ILocation, LocationCreateInput } from '@/app/(crm)/crm/locations/type';

type LocationFormState = {
  name: string;
  address: string;
  city: string;
  postal_code: string;
  country: string;
  notes: string;
  latitude: number | null;
  longitude: number | null;
  google_maps_url: string;
  google_place_id: string;
  formatted_address: string;
};

const emptyForm: LocationFormState = {
  name: '',
  address: '',
  city: '',
  postal_code: '',
  country: 'Polska',
  notes: '',
  latitude: null,
  longitude: null,
  google_maps_url: '',
  google_place_id: '',
  formatted_address: '',
};

function toNull(v: any) {
  return v === '' || v === undefined ? null : v;
}

type Props = {
  open: boolean;
  onClose: () => void;
  editingLocation?: ILocation | null;
  
  onLocationSaved?: (location: ILocation) => void;
};

export default function LocationModal({ open, onClose, editingLocation = null, onLocationSaved }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const leftScrollRef = useRef<HTMLDivElement>(null);

  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const { create, updateById, deleteById } = useLocations();

  const [formData, setFormData] = useState<LocationFormState>(emptyForm);
  const [localError, setLocalError] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const isEdit = !!editingLocation?.id;

  useEffect(() => {
    if (!open) return;
    setLocalError('');

    if (editingLocation) {
      setFormData({
        name: editingLocation.name ?? '',
        address: editingLocation.address ?? '',
        city: editingLocation.city ?? '',
        postal_code: editingLocation.postal_code ?? '',
        country: editingLocation.country ?? 'Polska',
        notes: editingLocation.notes ?? '',
        latitude: editingLocation.latitude ?? null,
        longitude: editingLocation.longitude ?? null,
        google_maps_url: editingLocation.google_maps_url ?? '',
        google_place_id: editingLocation.google_place_id ?? '',
        formatted_address: editingLocation.formatted_address ?? '',
      });
    } else {
      setFormData(emptyForm);
    }
  }, [open, editingLocation]);

  // blokada scrolla body + ESC
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

  const payload = useMemo(() => {
    return {
      name: formData.name,
      address: toNull(formData.address),
      city: toNull(formData.city),
      postal_code: toNull(formData.postal_code),
      country: toNull(formData.country) ?? 'Polska',
      notes: toNull(formData.notes),
      latitude: formData.latitude,
      longitude: formData.longitude,
      google_maps_url: toNull(formData.google_maps_url),
      google_place_id: toNull(formData.google_place_id),
      formatted_address: toNull(formData.formatted_address),
    } as Partial<ILocation>;
  }, [formData]);

  const handleSave = async () => {
    setLocalError('');

    if (!formData.name.trim()) {
      setLocalError('Nazwa lokalizacji jest wymagana');
      showSnackbar('Nazwa lokalizacji jest wymagana', 'error');
      return;
    }

    try {
      setIsSaving(true);

      if (isEdit && editingLocation?.id) {
        await updateById(editingLocation.id, payload);
        showSnackbar('Lokalizacja zaktualizowana', 'success');
      } else {
        await create(payload as LocationCreateInput);
        showSnackbar('Lokalizacja dodana', 'success');
      }

      onLocationSaved(payload as ILocation);
      onClose();
    } catch (e) {
      console.error(e);
      showSnackbar('Błąd podczas zapisywania lokalizacji', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editingLocation?.id) return;

    const ok = await showConfirm('Czy na pewno chcesz usunąć tę lokalizację?', 'Potwierdzenie');
    if (!ok) return;

    try {
      setIsDeleting(true);
      await deleteById(editingLocation.id);
      showSnackbar('Lokalizacja usunięta', 'success');
      onClose();
    } catch (e) {
      console.error(e);
      showSnackbar('Błąd podczas usuwania lokalizacji', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      {/* backdrop zawsze full screen */}
      <div
        className="absolute inset-0 bg-black/50"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      />

      {/* center wrapper (desktop wyśrodkowane + oddech, mobile też) */}
      <div className="absolute inset-0 flex items-center justify-center p-3 sm:p-4 md:p-8">
        <div
          ref={panelRef}
          tabIndex={-1}
          onMouseDown={(e) => e.stopPropagation()}
          className={[
            'relative flex w-full flex-col bg-[#1c1f33] outline-none',
            // szeroko + oddech na desktop
            'max-w-6xl',
            // na mobile niech będzie prawie full width, ale z marginesem od wrappera
            'rounded-xl shadow-2xl',
            // wysokość: mieści się na ekranie i daje scroll wewnątrz
            'h-[calc(100vh-1.5rem)] sm:h-[calc(100vh-2rem)] md:h-[calc(100vh-4rem)]',
          ].join(' ')}
        >
          {/* header */}
          <div className="flex items-center justify-between border-b border-[#d3bb73]/20 px-5 py-4 sm:px-6">
            <h2 className="text-lg font-bold text-[#e5e4e2] sm:text-xl">
              {isEdit ? 'Edytuj lokalizację' : 'Dodaj lokalizację'}
            </h2>

            <button
              onClick={onClose}
              className="rounded-lg p-2 text-[#e5e4e2]/70 transition-colors hover:bg-[#d3bb73]/10 hover:text-[#e5e4e2]"
              aria-label="Zamknij"
              disabled={isSaving || isDeleting}
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* body: na desktop 2 kolumny, na mobile mapa pod formularzem */}
          <div className="flex-1 overflow-hidden">
            <div className="grid h-full grid-rows-[auto,1fr] gap-4 p-4 sm:p-6 md:grid-cols-2 md:grid-rows-1 md:gap-6">
              {/* LEFT: formularz (scroll) */}
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

                  <div>
                    <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                      Nazwa lokalizacji *
                    </label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData((s) => ({ ...s, name: e.target.value }))}
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                      placeholder="np. Hotel Marriott Warsaw"
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div className="sm:col-span-2">
                      <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Adres</label>
                      <input
                        type="text"
                        value={formData.address}
                        onChange={(e) => setFormData((s) => ({ ...s, address: e.target.value }))}
                        className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                        placeholder="ul. Przykładowa 1"
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Miasto</label>
                      <input
                        type="text"
                        value={formData.city}
                        onChange={(e) => setFormData((s) => ({ ...s, city: e.target.value }))}
                        className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                        placeholder="Warszawa"
                      />
                    </div>

                    <div className="sm:col-span-1">
                      <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                        Kod pocztowy
                      </label>
                      <input
                        type="text"
                        value={formData.postal_code}
                        onChange={(e) =>
                          setFormData((s) => ({ ...s, postal_code: e.target.value }))
                        }
                        className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                        placeholder="00-000"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="my-2 block text-sm font-medium text-[#e5e4e2]">Notatki</label>
                    <textarea
                      value={formData.notes}
                      onChange={(e) => setFormData((s) => ({ ...s, notes: e.target.value }))}
                      rows={4}
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                      placeholder="Dodatkowe informacje..."
                    />
                  </div>

                  {formData.google_maps_url && (
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

              {/* RIGHT: mapa (na mobile pod spodem) */}
              <div className="order-2 h-full overflow-y-auto md:order-none md:pl-1">
                <div className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1117] p-3 sm:p-4 md:border-none md:bg-transparent md:p-0">
                  <GoogleMapsPicker
                    latitude={formData.latitude}
                    longitude={formData.longitude}
                    onLocationSelect={(data) => {
                      setFormData((s) => ({
                        ...s,
                        name: data.name || s.name,
                        latitude: data.latitude,
                        longitude: data.longitude,
                        google_maps_url: data.google_maps_url || s.google_maps_url,
                        google_place_id: data.google_place_id || s.google_place_id,
                        formatted_address: data.formatted_address || s.formatted_address,
                        address: data.address || s.address,
                        city: data.city || s.city,
                        postal_code: data.postal_code || s.postal_code,
                        country: data.country || s.country,
                      }));
                    }}
                    // ✅ scroll do góry DOPIERO po kliknięciu "Użyj tej lokalizacji"
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

          {/* footer */}
          <div className="flex items-center justify-end gap-3 border-t border-[#d3bb73]/20 px-4 py-4 sm:px-6">
            {isEdit && (
              <button
                onClick={handleDelete}
                disabled={isSaving || isDeleting}
                className="mr-auto flex items-center gap-2 rounded-lg bg-red-500/10 px-4 py-2 font-medium text-red-300 transition-colors hover:bg-red-500/20 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
                {isDeleting ? 'Usuwam...' : 'Usuń'}
              </button>
            )}

            <button
              onClick={onClose}
              disabled={isSaving || isDeleting}
              className="rounded-lg px-4 py-2 text-[#e5e4e2] transition-colors hover:bg-[#d3bb73]/10 disabled:opacity-50"
            >
              Anuluj
            </button>

            <button
              onClick={handleSave}
              disabled={isSaving || isDeleting}
              className="rounded-lg bg-[#d3bb73] px-4 py-2 font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:opacity-50"
            >
              {isSaving ? 'Zapisuję...' : isEdit ? 'Zapisz zmiany' : 'Dodaj lokalizację'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}