'use client';

import { useState, useEffect } from 'react';
import { X, Send, Mail, Loader } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';

interface SendContractEmailModalProps {
  contractId: string;
  eventId: string;
  clientEmail?: string;
  clientName?: string;
  onClose: () => void;
  onSent?: () => void;
}

interface EmailAccount {
  id: string;
  email_address: string;
  from_name: string;
}

export default function SendContractEmailModal({
  contractId,
  eventId,
  clientEmail = '',
  clientName = '',
  onClose,
  onSent,
}: SendContractEmailModalProps) {
  const { showSnackbar } = useSnackbar();
  const [loading, setLoading] = useState(false);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [emailAccounts, setEmailAccounts] = useState<EmailAccount[]>([]);
  const [formData, setFormData] = useState({
    to: clientEmail,
    subject: `Umowa - Event`,
    message: `Dzień dobry,

W załączeniu przesyłam umowę na realizację wydarzenia.

Proszę o zapoznanie się z treścią i odesłanie podpisanego egzemplarza.

W razie pytań proszę o kontakt.`,
    fromAccountId: '',
  });

  useEffect(() => {
    fetchEmailAccounts();
  }, []);

  useEffect(() => {
    if (clientEmail) {
      setFormData((prev) => ({ ...prev, to: clientEmail }));
    }
  }, [clientEmail]);

  const fetchEmailAccounts = async () => {
    try {
      setLoadingAccounts(true);
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        showSnackbar('Brak zalogowanego użytkownika', 'error');
        return;
      }

      const { data: accounts, error } = await supabase
        .from('employee_email_accounts')
        .select('id, email_address, from_name')
        .eq('employee_id', user.id)
        .eq('is_active', true)
        .order('is_default', { ascending: false });

      if (error) throw error;

      setEmailAccounts(accounts || []);

      if (accounts && accounts.length > 0) {
        setFormData(prev => ({ ...prev, fromAccountId: accounts[0].id }));
      }
    } catch (error: any) {
      console.error('Error fetching email accounts:', error);
      showSnackbar('Błąd podczas ładowania kont email', 'error');
    } finally {
      setLoadingAccounts(false);
    }
  };

  const handleSend = async () => {
    if (!formData.to.trim()) {
      showSnackbar('Wprowadź adres email odbiorcy', 'error');
      return;
    }

    if (!formData.subject.trim()) {
      showSnackbar('Wprowadź temat wiadomości', 'error');
      return;
    }

    if (!formData.fromAccountId && emailAccounts.length > 0) {
      showSnackbar('Wybierz konto pocztowe nadawcy', 'error');
      return;
    }

    if (emailAccounts.length === 0) {
      showSnackbar('Nie masz skonfigurowanych kont pocztowych', 'error');
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

      const htmlBody = formData.message.replace(/\n/g, '<br>');

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/send-email`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            emailAccountId: formData.fromAccountId,
            to: formData.to,
            subject: formData.subject,
            body: htmlBody,
          }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Błąd podczas wysyłania email');
      }

      await supabase
        .from('contracts')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString()
        })
        .eq('id', contractId);

      showSnackbar('Umowa wysłana przez email', 'success');
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
            <h2 className="text-xl font-light text-[#e5e4e2]">Wyślij umowę przez email</h2>
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
          {loadingAccounts ? (
            <div className="text-center py-8 text-[#e5e4e2]/60">
              Ładowanie kont email...
            </div>
          ) : emailAccounts.length === 0 ? (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
              <p className="text-sm text-red-400">
                <strong>Brak skonfigurowanych kont email.</strong>
                <br />
                Skonfiguruj konto pocztowe w ustawieniach profilu, aby móc wysyłać wiadomości.
              </p>
            </div>
          ) : (
            <>
              {emailAccounts.length > 1 && (
                <div>
                  <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                    Wyślij z konta <span className="text-red-400">*</span>
                  </label>
                  <select
                    value={formData.fromAccountId}
                    onChange={(e) => setFormData({ ...formData, fromAccountId: e.target.value })}
                    disabled={loading}
                    className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-3 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73] disabled:opacity-50"
                  >
                    {emailAccounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.from_name} ({account.email_address})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {emailAccounts.length === 1 && (
                <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
                  <p className="text-sm text-blue-400">
                    <strong>Wysyła z konta:</strong> {emailAccounts[0].from_name} ({emailAccounts[0].email_address})
                  </p>
                </div>
              )}

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
                  placeholder="Umowa..."
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
                  rows={10}
                  placeholder="Wpisz treść wiadomości..."
                  className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-3 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73] resize-none disabled:opacity-50"
                />
              </div>

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
                <p className="text-xs text-amber-400">
                  <strong>Wskazówka:</strong> Po wysłaniu umowy status zostanie automatycznie zmieniony na "Wysłana".
                </p>
              </div>
            </>
          )}
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
            disabled={loading || loadingAccounts || emailAccounts.length === 0}
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
                Wyślij umowę
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
