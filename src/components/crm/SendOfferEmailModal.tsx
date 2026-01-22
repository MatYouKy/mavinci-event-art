'use client';

import { useState, useEffect } from 'react';
import { X, Send, Mail, Loader } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useUpdateEventOfferMutation } from '@/app/(crm)/crm/events/store/api/eventsApi';

interface SendOfferEmailModalProps {
  offerId: string;
  offerNumber: string;
  clientEmail?: string;
  clientName?: string;
  eventId?: string;
  onClose: () => void;
  onSent?: () => void;
}

export default function SendOfferEmailModal({
  offerId,
  offerNumber,
  clientEmail = '',
  clientName = '',
  eventId,
  onClose,
  onSent,
}: SendOfferEmailModalProps) {
  const { showSnackbar } = useSnackbar();
  const [updateOffer] = useUpdateEventOfferMutation();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    to: clientEmail,
    subject: `Oferta ${offerNumber}`,
    message: `Dzień dobry,

W załączeniu przesyłam ofertę ${offerNumber}.

W razie pytań proszę o kontakt.`,
  });

  useEffect(() => {
    if (clientEmail) {
      setFormData((prev) => ({ ...prev, to: clientEmail }));
    }
  }, [clientEmail]);

  const handleSend = async () => {
    if (!formData.to.trim()) {
      showSnackbar('Wprowadź adres email odbiorcy', 'error');
      return;
    }

    if (!formData.subject.trim()) {
      showSnackbar('Wprowadź temat wiadomości', 'error');
      return;
    }

    setLoading(true);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        showSnackbar('Brak sesji użytkownika', 'error');
        setLoading(false);
        return;
      }

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/send-offer-email`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            offerId,
            to: formData.to,
            subject: formData.subject,
            message: formData.message,
          }),
        },
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Błąd podczas wysyłania email');
      }

      if (eventId) {
        await updateOffer({
          eventId,
          offerId,
          data: { status: 'sent' },
        }).unwrap();
      } else {
        await supabase.from('offers').update({ status: 'sent' }).eq('id', offerId);
      }

      showSnackbar('Oferta wysłana przez email', 'success');
      onSent?.();
      onClose();
    } catch (error: any) {
      console.error('Error sending email:', error);
      showSnackbar(error.message || 'Błąd podczas wysyłania email', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33]">
        <div className="flex items-center justify-between border-b border-[#d3bb73]/20 p-6">
          <div className="flex items-center gap-3">
            <Mail className="h-6 w-6 text-[#d3bb73]" />
            <h2 className="text-xl font-light text-[#e5e4e2]">Wyślij ofertę przez email</h2>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            className="rounded-lg p-2 text-[#e5e4e2]/60 transition-colors hover:bg-[#d3bb73]/10 hover:text-[#e5e4e2]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-6">
          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">
              Do (email odbiorcy) <span className="text-red-400">*</span>
            </label>
            <input
              type="email"
              value={formData.to}
              onChange={(e) => setFormData({ ...formData, to: e.target.value })}
              disabled={loading}
              placeholder="klient@example.com"
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none disabled:opacity-50"
            />
            {clientName && <p className="mt-1 text-xs text-[#e5e4e2]/40">Klient: {clientName}</p>}
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">
              Temat <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={formData.subject}
              onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
              disabled={loading}
              placeholder="Oferta..."
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none disabled:opacity-50"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Treść wiadomości</label>
            <textarea
              value={formData.message}
              onChange={(e) => setFormData({ ...formData, message: e.target.value })}
              disabled={loading}
              rows={8}
              placeholder="Wpisz treść wiadomości..."
              className="w-full resize-none rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none disabled:opacity-50"
            />
          </div>

          <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 p-4">
            <p className="text-sm text-blue-400">
              <strong>Załącznik:</strong> Oferta {offerNumber} zostanie automatycznie wygenerowana w
              formacie PDF i dołączona do wiadomości.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-[#d3bb73]/20 p-6">
          <button
            onClick={onClose}
            disabled={loading}
            className="rounded-lg px-6 py-2.5 text-[#e5e4e2]/80 transition-colors hover:bg-[#d3bb73]/10 disabled:opacity-50"
          >
            Anuluj
          </button>
          <button
            onClick={handleSend}
            disabled={loading}
            className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-2.5 font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader className="h-4 w-4 animate-spin" />
                Wysyłanie...
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                Wyślij ofertę
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
