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
  const [showEmailConfirm, setShowEmailConfirm] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);

  if (!isOpen) return null;

  const sendConfirmationEmail = async () => {
    setSendingEmail(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) {
        showSnackbar('Brak sesji - nie można wysłać maila', 'error');
        return;
      }

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/send-event-confirmation`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ eventId }),
        },
      );

      const result = await response.json();
      if (result.success) {
        showSnackbar(`Email potwierdzający wysłany do: ${result.recipientEmail}`, 'success');
      } else {
        showSnackbar(result.message || result.error || 'Nie udało się wysłać maila', 'error');
      }
    } catch (err: any) {
      console.error('[EventStatus] Error sending confirmation email:', err);
      showSnackbar('Błąd podczas wysyłania maila potwierdzającego', 'error');
    } finally {
      setSendingEmail(false);
      setShowEmailConfirm(false);
    }
  };

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

      if (value === 'offer_accepted' && currentStatus !== 'offer_accepted') {
        setShowEmailConfirm(true);
      } else {
        onClose();
      }
    } catch (err: any) {
      console.error('Error updating status:', err);
      showSnackbar(err?.message || 'Błąd podczas aktualizacji statusu', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (showEmailConfirm) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="w-full max-w-md rounded-xl border border-[#d3bb73]/20 bg-[#0f1119] p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-light text-[#e5e4e2]">Potwierdzenie email</h2>
            <button
              onClick={() => { setShowEmailConfirm(false); onClose(); }}
              disabled={sendingEmail}
              className="text-[#e5e4e2]/60 hover:text-[#e5e4e2] disabled:opacity-50"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <p className="mb-6 text-sm text-[#e5e4e2]/80 leading-relaxed">
            Status został zmieniony na <span className="font-medium text-[#d3bb73]">Oferta zaakceptowana</span>.
            Czy wysłać email z potwierdzeniem realizacji do klienta?
          </p>

          <div className="flex gap-3">
            <button
              onClick={sendConfirmationEmail}
              disabled={sendingEmail}
              className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-50"
            >
              {sendingEmail ? (
                <>
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Wysyłanie...
                </>
              ) : (
                'Wyślij'
              )}
            </button>
            <button
              onClick={() => { setShowEmailConfirm(false); onClose(); }}
              disabled={sendingEmail}
              className="rounded-lg px-4 py-2 text-[#e5e4e2]/60 hover:bg-[#1c1f33] disabled:opacity-50"
            >
              Pomiń
            </button>
          </div>
        </div>
      </div>
    );
  }

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
            {saving ? 'Zapisywanie...' : 'Zapisz'}
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
