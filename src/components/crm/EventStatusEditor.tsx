'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { X } from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';

const EVENT_STATUSES = [
  { value: 'inquiry', label: 'Zapytanie' },
  { value: 'offer_to_send', label: 'Oferta do wysłania' },
  { value: 'offer_sent', label: 'Oferta wysłana' },
  { value: 'offer_accepted', label: 'Oferta zaakceptowana' },
  { value: 'in_preparation', label: 'W przygotowaniu' },
  { value: 'in_progress', label: 'W trakcie' },
  { value: 'completed', label: 'Zrealizowany' },
  { value: 'cancelled', label: 'Anulowany' },
  { value: 'invoiced', label: 'Zafakturowany' },
];

export default function EventStatusSelectModal({
  isOpen,
  onClose,
  eventId,
  currentStatus,
  onStatusChange,
}: {
  isOpen: boolean;
  onClose: () => void;
  eventId: string;
  currentStatus: string;
  onStatusChange?: (newStatus: string) => void;
}) {
  const { showSnackbar } = useSnackbar();
  const [value, setValue] = useState(currentStatus || 'draft');
  const [saving, setSaving] = useState(false);

  if (!isOpen) return null;

  const save = async () => {
    try {
      setSaving(true);

      const { error } = await supabase
        .from('events')
        .update({ status: value, updated_at: new Date().toISOString() })
        .eq('id', eventId);

      if (error) throw error;

      showSnackbar('Status eventu został zaktualizowany', 'success');
      onStatusChange?.(value);
      onClose();
    } catch (err: any) {
      console.error('Error updating status:', err);
      showSnackbar(err?.message || 'Błąd podczas aktualizacji statusu', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl border border-[#d3bb73]/20 bg-[#0f1119] p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-light text-[#e5e4e2]">Zmień status eventu</h2>
          <button onClick={onClose} className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]">
            <X className="h-5 w-5" />
          </button>
        </div>

        <label className="mb-2 block text-sm text-[#e5e4e2]/60">Status</label>
        <select
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
          disabled={saving}
        >
          {EVENT_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>

        <div className="mt-6 flex gap-3">
          <button
            onClick={save}
            disabled={saving}
            className="flex-1 rounded-lg bg-[#d3bb73] px-4 py-2 font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-50"
          >
            {saving ? 'Zapisywanie…' : 'Zapisz'}
          </button>
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded-lg px-4 py-2 text-[#e5e4e2]/60 hover:bg-[#1c1f33] disabled:opacity-50"
          >
            Anuluj
          </button>
        </div>
      </div>
    </div>
  );
}
