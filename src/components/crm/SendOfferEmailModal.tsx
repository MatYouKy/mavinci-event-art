'use client';

import { useState, useEffect } from 'react';
import { X, Send, Mail, Loader } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useUpdateEventOfferMutation } from '@/app/(crm)/crm/events/store/api/eventsApi';
import { buildCompanySignatureHtml } from '@/lib/buildCompanySignature';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';

type EmailAccount = {
  id: string;
  email_address: string;
  from_name?: string | null;
  account_type?: 'personal' | 'shared' | 'system' | null;
  is_default?: boolean | null;
};

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
  const { currentEmployee, loading: loadingEmployee } = useCurrentEmployee();
  const [updateOffer] = useUpdateEventOfferMutation();
  const [loading, setLoading] = useState(false);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [emailAccounts, setEmailAccounts] = useState<EmailAccount[]>([]);
  const [formData, setFormData] = useState({
    fromAccountId: '',
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

  useEffect(() => {
    if (loadingEmployee) return;
    if (!currentEmployee?.id) {
      setEmailAccounts([]);
      setLoadingAccounts(false);
      return;
    }

    let cancelled = false;
    const loadEmailAccounts = async () => {
      setLoadingAccounts(true);
      try {
        const [personalResult, assignmentsResult] = await Promise.all([
          supabase
            .from('employee_email_accounts')
            .select('id, email_address, from_name, account_type, is_default')
            .eq('employee_id', currentEmployee.id)
            .eq('is_active', true)
            .or('account_type.is.null,account_type.neq.system'),
          supabase
            .from('employee_email_account_assignments')
            .select('email_account_id')
            .eq('employee_id', currentEmployee.id)
            .eq('can_send', true),
        ]);

        if (personalResult.error) throw personalResult.error;
        if (assignmentsResult.error) throw assignmentsResult.error;

        const assignedIds = (assignmentsResult.data || []).map((row) => row.email_account_id);
        let assignedAccounts: EmailAccount[] = [];
        if (assignedIds.length > 0) {
          const { data, error } = await supabase
            .from('employee_email_accounts')
            .select('id, email_address, from_name, account_type, is_default')
            .in('id', assignedIds)
            .eq('is_active', true)
            .or('account_type.is.null,account_type.neq.system');
          if (error) throw error;
          assignedAccounts = data || [];
        }

        const accounts = Array.from(
          new Map(
            [...(personalResult.data || []), ...assignedAccounts]
              .map((account) => [account.id, account]),
          ).values(),
        ).sort((a, b) => {
          if (Boolean(a.is_default) !== Boolean(b.is_default)) return a.is_default ? -1 : 1;
          const aPersonal = (a.account_type || 'personal') === 'personal';
          const bPersonal = (b.account_type || 'personal') === 'personal';
          if (aPersonal !== bPersonal) return aPersonal ? -1 : 1;
          return a.email_address.localeCompare(b.email_address, 'pl');
        });

        if (cancelled) return;
        setEmailAccounts(accounts);
        setFormData((current) => ({
          ...current,
          fromAccountId: accounts.some((account) => account.id === current.fromAccountId)
            ? current.fromAccountId
            : accounts[0]?.id || '',
        }));
      } catch (error) {
        console.error('Error loading offer sender accounts:', error);
        if (!cancelled) {
          setEmailAccounts([]);
          showSnackbar('Nie udało się pobrać skrzynek pracownika', 'error');
        }
      } finally {
        if (!cancelled) setLoadingAccounts(false);
      }
    };

    void loadEmailAccounts();
    return () => {
      cancelled = true;
    };
  }, [currentEmployee?.id, loadingEmployee, showSnackbar]);

  const handleSend = async () => {
    if (!formData.to.trim()) {
      showSnackbar('Wprowadź adres email odbiorcy', 'error');
      return;
    }

    if (!formData.subject.trim()) {
      showSnackbar('Wprowadź temat wiadomości', 'error');
      return;
    }

    if (!formData.fromAccountId) {
      showSnackbar('Wybierz skrzynkę pracownika, z której ma zostać wysłana oferta', 'error');
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
            emailAccountId: formData.fromAccountId,
            to: formData.to,
            subject: formData.subject,
            message: formData.message,
            signatureHtml: (await buildCompanySignatureHtml()).html,
            recipientName: clientName,
          }),
        },
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || error.message || 'Błąd podczas wysyłania email');
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

      const { data: sentOffer } = await supabase
        .from('offers')
        .select('inquiry_id')
        .eq('id', offerId)
        .maybeSingle();

      if (sentOffer?.inquiry_id) {
        await supabase
          .from('tasks')
          .update({
            inquiry_stage: 'proposal',
            linked_offer_id: offerId,
            last_contact_at: new Date().toISOString(),
          })
          .eq('id', sentOffer.inquiry_id)
          .eq('is_inquiry', true);
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
              Wyślij ze skrzynki pracownika <span className="text-red-400">*</span>
            </label>
            <select
              value={formData.fromAccountId}
              onChange={(event) => setFormData({ ...formData, fromAccountId: event.target.value })}
              disabled={loading || loadingAccounts}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none disabled:opacity-50"
            >
              <option value="">
                {loadingAccounts ? 'Pobieranie dostępnych skrzynek…' : 'Wybierz skrzynkę'}
              </option>
              {emailAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.from_name ? `${account.from_name} — ` : ''}{account.email_address}
                  {account.account_type === 'shared' ? ' (wspólna)' : ''}
                </option>
              ))}
            </select>
            {!loadingAccounts && emailAccounts.length === 0 && (
              <p className="mt-2 text-xs text-red-300">
                Nie masz aktywnej skrzynki do wysyłki. Konto systemowe nie zostanie użyte zastępczo.
              </p>
            )}
          </div>

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
              Oferta {offerNumber} zostanie ponownie wygenerowana i dołączona jako plik PDF.
              W treści pozostanie również link do pobrania ważny przez 7 dni.
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
            disabled={loading || loadingAccounts || !formData.fromAccountId}
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
