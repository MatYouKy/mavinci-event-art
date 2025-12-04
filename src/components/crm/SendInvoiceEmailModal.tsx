'use client';

import { useState, useEffect } from 'react';
import { X, Send, Mail, Loader } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';

interface SendInvoiceEmailModalProps {
  invoiceId: string;
  invoiceNumber: string;
  clientEmail?: string;
  clientName?: string;
  onClose: () => void;
  onSent?: () => void;
}

export default function SendInvoiceEmailModal({
  invoiceId,
  invoiceNumber,
  clientEmail = '',
  clientName = '',
  onClose,
  onSent,
}: SendInvoiceEmailModalProps) {
  const { showSnackbar } = useSnackbar();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    to: clientEmail,
    subject: `Faktura ${invoiceNumber}`,
    message: `Dzień dobry,

W załączeniu przesyłam fakturę ${invoiceNumber}.

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
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        showSnackbar('Brak sesji użytkownika', 'error');
        setLoading(false);
        return;
      }

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/send-invoice-email`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            invoiceId,
            to: formData.to,
            subject: formData.subject,
            message: formData.message,
          }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Błąd podczas wysyłania email');
      }

      showSnackbar('Faktura wysłana przez email', 'success');
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-[#d3bb73]/20">
          <div className="flex items-center gap-3">
            <Mail className="w-6 h-6 text-[#d3bb73]" />
            <h2 className="text-xl font-light text-[#e5e4e2]">Wyślij fakturę przez email</h2>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            className="p-2 text-[#e5e4e2]/60 hover:text-[#e5e4e2] hover:bg-[#d3bb73]/10 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">
              Do (email odbiorcy) <span className="text-red-400">*</span>
            </label>
            <input
              type="email"
              value={formData.to}
              onChange={(e) => setFormData({ ...formData, to: e.target.value })}
              disabled={loading}
              placeholder="klient@example.com"
              className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-3 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73] disabled:opacity-50"
            />
            {clientName && (
              <p className="text-xs text-[#e5e4e2]/40 mt-1">Klient: {clientName}</p>
            )}
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">
              Temat <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={formData.subject}
              onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
              disabled={loading}
              placeholder="Faktura..."
              className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-3 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73] disabled:opacity-50"
            />
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">
              Treść wiadomości
            </label>
            <textarea
              value={formData.message}
              onChange={(e) => setFormData({ ...formData, message: e.target.value })}
              disabled={loading}
              rows={8}
              placeholder="Wpisz treść wiadomości..."
              className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-3 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73] resize-none disabled:opacity-50"
            />
          </div>

          <div className="bg-[#d3bb73]/10 border border-[#d3bb73]/20 rounded-lg p-4">
            <p className="text-sm text-[#d3bb73]">
              <strong>Nadawca:</strong> Systemowa skrzynka email CRM
            </p>
            <p className="text-sm text-[#e5e4e2]/60 mt-2">
              <strong>Załącznik:</strong> Faktura {invoiceNumber} zostanie automatycznie wygenerowana w formacie PDF i dołączona do wiadomości.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 p-6 border-t border-[#d3bb73]/20">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-6 py-2.5 rounded-lg text-[#e5e4e2]/80 hover:bg-[#d3bb73]/10 transition-colors disabled:opacity-50"
          >
            Anuluj
          </button>
          <button
            onClick={handleSend}
            disabled={loading}
            className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-6 py-2.5 rounded-lg font-medium hover:bg-[#d3bb73]/90 transition-colors disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader className="w-4 h-4 animate-spin" />
                Wysyłanie...
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                Wyślij fakturę
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
