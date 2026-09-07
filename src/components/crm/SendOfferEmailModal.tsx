'use client';

import { useState, useEffect } from 'react';
import { X, Send, Mail, Loader } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useUpdateEventOfferMutation } from '@/app/(crm)/crm/events/store/api/eventsApi';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import {
  dispatchCrmEmail,
  formatScheduledEmailDate,
  resolveScheduledEmailDate,
} from '@/lib/emailScheduling';
import UnifiedEmailComposer, {
  buildUnifiedEmailContent,
  buildUnifiedEmailHtml,
  hasUnifiedEmailBody,
  plainTextToEmailHtml,
  unifiedEmailHtmlToPlainText,
  type UnifiedEmailDraft,
} from './UnifiedEmailComposer';

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
  const [formData, setFormData] = useState<UnifiedEmailDraft>({
    fromAccountId: '',
    to: clientEmail,
    cc: '',
    bcc: '',
    subject: `Oferta ${offerNumber}`,
    messageHtml: plainTextToEmailHtml(`Dzień dobry,

W załączeniu przesyłam ofertę ${offerNumber}.

W razie pytań proszę o kontakt.`),
  });
  const [showPreview, setShowPreview] = useState(false);
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);

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

  useEffect(() => {
    let cancelled = false;
    const refreshPreview = async () => {
      setPreviewLoading(true);
      try {
        const html = await buildUnifiedEmailHtml({
          draft: formData,
          purpose: 'offer',
          recipientName: clientName,
        });
        if (!cancelled) setPreviewHtml(html);
      } catch (error) {
        console.error('Error building offer email preview:', error);
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    };
    void refreshPreview();
    return () => {
      cancelled = true;
    };
  }, [formData, clientName]);

  const handleSend = async () => {
    if (!formData.to.trim()) {
      showSnackbar('Wprowadź adres email odbiorcy', 'error');
      return;
    }

    if (!formData.subject.trim()) {
      showSnackbar('Wprowadź temat wiadomości', 'error');
      return;
    }

    if (!hasUnifiedEmailBody(formData.messageHtml)) {
      showSnackbar('Wprowadź treść wiadomości', 'error');
      return;
    }

    if (!formData.fromAccountId) {
      showSnackbar('Wybierz skrzynkę pracownika, z której ma zostać wysłana oferta', 'error');
      return;
    }

    let scheduledAt: string | null;
    try {
      scheduledAt = resolveScheduledEmailDate(formData);
    } catch (error) {
      showSnackbar(error instanceof Error ? error.message : 'Nieprawidłowy termin wysyłki', 'error');
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

      const currentEmail = await buildUnifiedEmailContent({
        draft: formData,
        purpose: 'offer',
        recipientName: clientName,
      });
      const result = await dispatchCrmEmail({
        accessToken: session.access_token,
        functionName: 'send-offer-email',
        scheduledAt,
        metadata: {
          entityType: 'offer',
          entityId: offerId,
          markEntitySent: true,
          actionUrl: `/crm/offers/${offerId}`,
        },
        payload: {
          offerId,
          emailAccountId: formData.fromAccountId,
          to: formData.to,
          cc: formData.cc,
          bcc: formData.bcc,
          subject: formData.subject,
          message: unifiedEmailHtmlToPlainText(formData.messageHtml),
          messageHtml: currentEmail.html,
          signatureHtml: currentEmail.signatureHtml,
          recipientName: clientName,
        },
      });

      if (!result.scheduled && eventId) {
        await updateOffer({
          eventId,
          offerId,
          data: { status: 'sent' },
        }).unwrap();
      } else if (!result.scheduled) {
        await supabase.from('offers').update({ status: 'sent' }).eq('id', offerId);
      }

      if (!result.scheduled) {
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
      }

      showSnackbar(
        result.scheduled && result.scheduledAt
          ? `Oferta zostanie wysłana ${formatScheduledEmailDate(result.scheduledAt)}`
          : 'Oferta wysłana przez email',
        'success',
      );
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
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33]">
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
          <UnifiedEmailComposer
            draft={formData}
            onChange={setFormData}
            accounts={emailAccounts}
            accountsLoading={loadingAccounts || loadingEmployee}
            disabled={loading}
            showPreview={showPreview}
            onShowPreviewChange={setShowPreview}
            previewHtml={previewHtml}
            previewLoading={previewLoading}
            recipientHint={clientName ? <span>Klient: {clientName}</span> : null}
          >
          <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 p-4">
            <p className="text-sm text-blue-400">
              Oferta {offerNumber} zostanie ponownie wygenerowana i dołączona jako plik PDF.
              W treści pozostanie również link do pobrania ważny przez 7 dni.
            </p>
          </div>
          </UnifiedEmailComposer>
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
                {formData.deliveryMode === 'scheduled' ? 'Planowanie...' : 'Wysyłanie...'}
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                {formData.deliveryMode === 'scheduled' ? 'Zaplanuj ofertę' : 'Wyślij ofertę'}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
