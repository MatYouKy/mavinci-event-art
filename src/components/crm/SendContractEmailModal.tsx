'use client';

import { useState, useEffect } from 'react';
import { X, Send, Mail, Loader } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import UnifiedEmailComposer, {
  buildUnifiedEmailHtml,
  hasUnifiedEmailBody,
  loadUnifiedEmailAccounts,
  type UnifiedEmailAccount,
  type UnifiedEmailDraft,
} from './UnifiedEmailComposer';

interface SendContractEmailModalProps {
  contractId: string;
  eventId: string;
  clientEmail?: string;
  clientName?: string;
  onClose: () => void;
  onSent?: () => void;
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
  const [emailAccounts, setEmailAccounts] = useState<UnifiedEmailAccount[]>([]);
  const [formData, setFormData] = useState<UnifiedEmailDraft>({
    to: clientEmail,
    cc: '',
    bcc: '',
    subject: `Umowa - Event`,
    messageHtml: `<p>Dzień dobry,</p><p><br></p><p>W załączeniu przesyłam umowę na realizację wydarzenia.</p><p><br></p><p>Proszę o zapoznanie się z treścią i odesłanie podpisanego egzemplarza.</p><p><br></p><p>W razie pytań proszę o kontakt.</p>`,
    fromAccountId: '',
  });
  const [showPreview, setShowPreview] = useState(false);
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [contract, setContract] = useState<any>(null);

  useEffect(() => {
    fetchEmailAccounts();
    fetchContract();
  }, []);

  useEffect(() => {
    if (clientEmail) {
      setFormData((prev) => ({ ...prev, to: clientEmail }));
    }
  }, [clientEmail]);

  useEffect(() => {
    generatePreview();
  }, [formData, clientName]);

  const fetchContract = async () => {
    try {
      const { data, error } = await supabase
        .from('contracts')
        .select('contract_number')
        .eq('id', contractId)
        .maybeSingle();

      if (error) throw error;
      setContract(data);
    } catch (error) {
      console.error('Error fetching contract:', error);
    }
  };

  const buildPreviewHtml = async () => {
    return buildUnifiedEmailHtml({
      draft: formData,
      purpose: 'contract',
      recipientName: clientName,
    });
  };

  const generatePreview = async () => {
    setPreviewLoading(true);
    try {
      setPreviewHtml(await buildPreviewHtml());
    } finally {
      setPreviewLoading(false);
    }
  };

  const fetchStoredContractPDF = async (): Promise<{ base64: string; filename: string }> => {
    const { data: contractData, error } = await supabase
      .from('contracts')
      .select('contract_number, generated_pdf_path')
      .eq('id', contractId)
      .maybeSingle();

    if (error || !contractData) {
      throw new Error('Nie znaleziono umowy');
    }

    if (!contractData.generated_pdf_path) {
      throw new Error(
        'PDF umowy nie został jeszcze wygenerowany. Najpierw użyj przycisku "Generuj PDF".',
      );
    }

    const { data: signedData, error: signedErr } = await supabase.storage
      .from('event-files')
      .createSignedUrl(contractData.generated_pdf_path, 300);

    if (signedErr || !signedData?.signedUrl) {
      throw new Error('Nie udało się pobrać PDF ze storage');
    }

    const pdfResp = await fetch(signedData.signedUrl);
    if (!pdfResp.ok) throw new Error('Błąd pobierania PDF');

    const buffer = await pdfResp.arrayBuffer();
    const base64 = btoa(
      new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), ''),
    );

    const filename =
      contractData.generated_pdf_path.split('/').pop() ||
      `Umowa_${contractData.contract_number || contractId}.pdf`;

    return { base64, filename };
  };

  const fetchEmailAccounts = async () => {
    try {
      setLoadingAccounts(true);
      const accounts = await loadUnifiedEmailAccounts();
      setEmailAccounts(accounts);

      if (accounts.length > 0) {
        setFormData((prev) => ({ ...prev, fromAccountId: accounts[0].id }));
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

    if (!hasUnifiedEmailBody(formData.messageHtml)) {
      showSnackbar('Wprowadź treść wiadomości', 'error');
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
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        showSnackbar('Brak sesji użytkownika', 'error');
        setLoading(false);
        return;
      }

      showSnackbar('Pobieram PDF umowy...', 'info');

      const pdfData = await fetchStoredContractPDF();
      const attachments = [
        {
          filename: pdfData.filename,
          content: pdfData.base64,
          contentType: 'application/pdf',
        },
      ];
      showSnackbar('PDF gotowy, wysyłam email...', 'info');
      const currentPreviewHtml = await buildPreviewHtml();
      setPreviewHtml(currentPreviewHtml);

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/send-email`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            emailAccountId: formData.fromAccountId,
            to: formData.to,
            subject: formData.subject,
            body: currentPreviewHtml,
            attachments: attachments,
            cc: formData.cc.trim(),
            bcc: formData.bcc.trim(),
          }),
        },
      );

      if (!response.ok) {
        const error = await response.json();
        console.error('[SendContract] Error response:', error);
        throw new Error(error.error || error.message || 'Błąd podczas wysyłania email');
      }

      const result = await response.json();

      await supabase
        .from('contracts')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33]">
        <div className="flex items-center justify-between border-b border-[#d3bb73]/20 p-6">
          <div className="flex items-center gap-3">
            <Mail className="h-6 w-6 text-[#d3bb73]" />
            <h2 className="text-xl font-light text-[#e5e4e2]">Wyślij umowę przez email</h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={loading}
              className="rounded-lg p-2 text-[#e5e4e2]/60 transition-colors hover:bg-[#d3bb73]/10 hover:text-[#e5e4e2]"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="p-6">
          <UnifiedEmailComposer
            draft={formData}
            onChange={setFormData}
            accounts={emailAccounts}
            accountsLoading={loadingAccounts}
            disabled={loading}
            showPreview={showPreview}
            onShowPreviewChange={setShowPreview}
            previewHtml={previewHtml}
            previewLoading={previewLoading}
            recipientHint={
              clientName ? <p className="mt-1 text-xs text-[#e5e4e2]/40">Klient: {clientName}</p> : null
            }
          >
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3">
              <p className="text-xs text-amber-400">
                <strong>Wskazówka:</strong> PDF umowy zostanie dołączony, a status zmieni się na
                „Wysłana”.
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
            disabled={loading || loadingAccounts || emailAccounts.length === 0}
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
                Wyślij umowę
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
