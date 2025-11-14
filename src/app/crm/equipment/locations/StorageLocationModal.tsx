'use client';

import React, { useEffect, useState } from 'react';
import { MapPin, Save, X, Loader2 } from 'lucide-react';
import { checkGoogleMapsUrl } from '@/lib/gus';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { IStorageLocation } from '../types/equipment.types';

type StorageLocationModalProps = {
  open: boolean;
  title?: string;                // 'Nowa lokalizacja' / 'Edytuj lokalizację'
  initialValues: IStorageLocation;
  submitting?: boolean;          // spinner dla zapisu
  onClose: () => void;
  onSubmit: (values: IStorageLocation) => void | Promise<void>;
};

export function StorageLocationModal({
  open,
  title = 'Lokalizacja',
  initialValues,
  submitting = false,
  onClose,
  onSubmit,
}: StorageLocationModalProps) {
  const { showSnackbar } = useSnackbar();
  const [form, setForm] = useState<IStorageLocation>(initialValues);

  // gdy zmieniają się initialValues (np. tryb edycji), zsynchronizuj
  useEffect(() => {
    if (open) setForm(initialValues);
  }, [open, initialValues]);

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      showSnackbar('Nazwa lokalizacji jest wymagana', 'error');
      return;
    }
    onSubmit(form);
  };

  const onParseMaps = () => {
    const raw = form.google_maps_url?.trim();
    if (!raw) {
      showSnackbar('Wprowadź URL Google Maps', 'error');
      return;
    }
    try {
      const res = checkGoogleMapsUrl(raw);
      if (!res) {
        showSnackbar('To nie wygląda na prawidłowy link Google Maps.', 'error');
        return;
      }
      if ((res as any).kind === 'full') {
        showSnackbar(`OK — współrzędne: ${(res as any).lat}, ${(res as any).lng}`, 'success');
      } else {
        showSnackbar('OK — skrócony link wygląda poprawnie ✅', 'success');
      }
    } catch (e: any) {
      showSnackbar(e?.message || 'Błąd weryfikacji linku', 'error');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-[#d3bb73]/15 bg-[#1a1d2e] p-6">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-white">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-2 transition-colors hover:bg-[#0f1119]"
          >
            <X className="h-6 w-6 text-gray-400" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Nazwa */}
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-300">
              Nazwa lokalizacji <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              required
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-white focus:border-[#d3bb73] focus:outline-none"
              placeholder="np. Magazyn główny, Biuro, Sala eventowa"
            />
          </div>

          {/* Adres */}
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-300">Adres</label>
            <input
              type="text"
              value={form.address || ''}
              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-white focus:border-[#d3bb73] focus:outline-none"
              placeholder="ul. Przykładowa 1, 00-000 Warszawa"
            />
          </div>

          {/* Google Maps */}
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-300">
              URL Google Maps
            </label>
            <div className="flex gap-2">
              <input
                type="url"
                value={form.google_maps_url || ''}
                onChange={(e) => setForm((f) => ({ ...f, google_maps_url: e.target.value }))}
                className="flex-1 rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-white focus:border-[#d3bb73] focus:outline-none"
                placeholder="https://maps.google.com/... lub https://maps.app.goo.gl/…"
              />
              <button
                type="button"
                onClick={onParseMaps}
                className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#0f1119] transition-colors hover:bg-[#c4a859]"
              >
                <MapPin className="h-5 w-5" />
                <span>Test</span>
              </button>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Obsługiwane są pełne i skrócone linki Google Maps. Dla skróconych nie wyświetlimy
              współrzędnych (pojawiają się po przekierowaniu), ale link zostanie poprawnie
              zweryfikowany ✅
            </p>
          </div>

          {/* Dostęp */}
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-300">
              Informacje o dostępie
            </label>
            <textarea
              value={form.access_info || ''}
              onChange={(e) => setForm((f) => ({ ...f, access_info: e.target.value }))}
              rows={2}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-white focus:border-[#d3bb73] focus:outline-none"
              placeholder="np. wejście od podwórka, kod do bramy: 1234"
            />
          </div>

          {/* Notatki */}
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-300">Notatki</label>
            <textarea
              value={form.notes || ''}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              rows={3}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-white focus:border-[#d3bb73] focus:outline-none"
              placeholder="Dodatkowe informacje..."
            />
          </div>

          {/* Aktywna */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="is_active"
              checked={!!form.is_active}
              onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
              className="h-4 w-4 rounded border-[#d3bb73]/30 bg-[#0f1119] text-[#d3bb73] focus:ring-[#d3bb73]"
            />
            <label htmlFor="is_active" className="cursor-pointer text-sm text-gray-300">
              Lokalizacja aktywna
            </label>
          </div>

          {/* Akcje */}
          <div className="flex justify-end gap-3 border-t border-[#d3bb73]/15 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[#d3bb73]/20 px-6 py-2 text-gray-300 transition-colors hover:bg-[#0f1119]"
            >
              Anuluj
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-2 font-medium text-[#0f1119] transition-colors hover:bg-[#c4a859] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />}
              <span>{submitting ? 'Zapisywanie…' : 'Zapisz'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}