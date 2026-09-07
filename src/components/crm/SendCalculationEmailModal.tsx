'use client';

import { useState, useEffect } from 'react';
import { X, Send, Mail, Loader } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import UnifiedEmailComposer, {
  buildUnifiedEmailHtml,
  hasUnifiedEmailBody,
  loadUnifiedEmailAccounts,
  plainTextToEmailHtml,
  type UnifiedEmailAccount,
  type UnifiedEmailDraft,
} from './UnifiedEmailComposer';
import {
  dispatchCrmEmail,
  formatScheduledEmailDate,
  resolveScheduledEmailDate,
} from '@/lib/emailScheduling';

interface SendCalculationEmailModalProps {
  calculationId: string;
  eventId: string | null;
  calculationName?: string;
  eventName?: string;
  defaultEmail?: string;
  recipientName?: string;
  contactPerson?: {
    id: string;
    name: string;
    email: string | null;
  } | null;
  onClose: () => void;
  onSent?: () => void;
}

interface EventAttachment {
  id: string;
  name: string;
  original_name: string;
  file_path: string;
  file_type?: string | null;
  mime_type?: string | null;
  file_size?: number | null;
  created_at: string;
}

export default function SendCalculationEmailModal({
  calculationId,
  eventId,
  calculationName = '',
  eventName = '',
  defaultEmail = '',
  recipientName = '',
  contactPerson = null,
  onClose,
  onSent,
}: SendCalculationEmailModalProps) {
  const { showSnackbar } = useSnackbar();
  const [loading, setLoading] = useState(false);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [emailAccounts, setEmailAccounts] = useState<UnifiedEmailAccount[]>([]);
  const [eventFiles, setEventFiles] = useState<EventAttachment[]>([]);
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [formData, setFormData] = useState<UnifiedEmailDraft>({
    to: defaultEmail,
    cc: '',
    bcc: '',
    subject: calculationName
      ? `Kalkulacja: ${calculationName}`
      : eventName
        ? `Kalkulacja - ${eventName}`
        : 'Kalkulacja wydarzenia',
    messageHtml: plainTextToEmailHtml(`Dzień dobry,

W załączeniu przesyłam kalkulację wydarzenia.

Proszę o zapoznanie się z treścią. W razie pytań lub uwag pozostaję do dyspozycji.`),
    fromAccountId: '',
  });
  const [showPreview, setShowPreview] = useState(false);
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [includeEventFiles, setIncludeEventFiles] = useState(false);

  useEffect(() => {
    if (defaultEmail) {
      setFormData((prev) => ({ ...prev, to: defaultEmail }));
    }
  }, [defaultEmail]);

  useEffect(() => {
    generatePreview();
  }, [
    formData,
    recipientName,
  ]);

  const fetchEventFiles = async () => {
    if (!eventId) {
      setEventFiles([]);
      return;
    }
    try {
      setLoadingFiles(true);

      const { data, error } = await supabase
        .from('event_files')
        .select('id, name, original_name, file_path, file_size, mime_type, created_at, uploaded_by')
        .eq('event_id', eventId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const { data: currentCalc } = await supabase
        .from('event_calculations')
        .select('generated_pdf_path')
        .eq('id', calculationId)
        .maybeSingle();

      const currentPdfPath = currentCalc?.generated_pdf_path ?? null;

      const files =
        data
          ?.filter((file) => file.file_path !== currentPdfPath)
          .map((file) => ({
            id: file.id,
            name: file.name || file.original_name || file.file_path.split('/').pop() || 'Plik',
            file_path: file.file_path,
            file_type: file.mime_type,
            file_size: file.file_size,
            created_at: file.created_at,
            original_name: file.original_name,
            uploaded_by: file.uploaded_by,
          })) || [];

      setEventFiles(files);
    } catch (error) {
      console.error('Error fetching event files:', error);
      showSnackbar('Nie udało się pobrać plików wydarzenia', 'error');
    } finally {
      setLoadingFiles(false);
    }
  };

  const generatePreview = async () => {
    setPreviewLoading(true);
    try {
      setPreviewHtml(await buildUnifiedEmailHtml({
      draft: formData,
      purpose: 'offer',
      recipientName,
      }));
    } finally {
      setPreviewLoading(false);
    }
  };

  const fetchStoredCalculationPDF = async (): Promise<{
    base64: string;
    filename: string;
    storagePath: string;
  }> => {
    const { data, error } = await supabase
      .from('event_calculations')
      .select('name, generated_pdf_path')
      .eq('id', calculationId)
      .maybeSingle();

    if (error || !data) {
      throw new Error('Nie znaleziono kalkulacji');
    }

    if (!data.generated_pdf_path) {
      throw new Error(
        'PDF kalkulacji nie został jeszcze wygenerowany. Najpierw kliknij "Generuj PDF".',
      );
    }

    const { data: signedData, error: signedErr } = await supabase.storage
      .from('event-files')
      .createSignedUrl(data.generated_pdf_path, 300);

    if (signedErr || !signedData?.signedUrl) {
      throw new Error('Nie udało się pobrać PDF ze storage');
    }

    const pdfResp = await fetch(signedData.signedUrl);
    if (!pdfResp.ok) throw new Error('Błąd pobierania PDF');

    const buffer = await pdfResp.arrayBuffer();
    const base64 = btoa(
      new Uint8Array(buffer).reduce((acc, byte) => acc + String.fromCharCode(byte), ''),
    );

    const filename =
      data.generated_pdf_path.split('/').pop() || `Kalkulacja_${data.name || calculationId}.pdf`;

    return {
      base64,
      filename,
      storagePath: data.generated_pdf_path,
    };
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

  const fetchEventFileAsAttachment = async (file: EventAttachment) => {
    const { data: signedData, error } = await supabase.storage
      .from('event-files')
      .createSignedUrl(file.file_path, 300);

    if (error || !signedData?.signedUrl) {
      throw new Error(`Nie udało się pobrać pliku: ${file.name}`);
    }

    const response = await fetch(signedData.signedUrl);

    if (!response.ok) {
      throw new Error(`Błąd pobierania pliku: ${file.name}`);
    }

    const blob = await response.blob();
    const buffer = await blob.arrayBuffer();

    const base64 = btoa(
      new Uint8Array(buffer).reduce((acc, byte) => acc + String.fromCharCode(byte), ''),
    );

    return {
      filename: file.original_name || file.name,
      content: base64,
      contentType: file.mime_type || file.file_type || blob.type || 'application/octet-stream',

      // TO JEST KLUCZOWE
      contentDisposition: 'attachment',
    };
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
        return;
      }

      showSnackbar('Pobieram PDF kalkulacji...', 'info');

      const pdfData = await fetchStoredCalculationPDF();

      const attachments = [
        {
          filename: pdfData.filename,
          content: pdfData.base64,
          contentType: 'application/pdf',
          contentDisposition: 'attachment',
        },
      ];

      const selectedFiles = eventFiles
        .filter((file) => selectedFileIds.includes(file.id))
        .filter((file) => file.file_path !== pdfData.storagePath);

      if (selectedFiles.length > 0) {
        showSnackbar(`Pobieram dodatkowe załączniki (${selectedFiles.length})...`, 'info');

        for (const file of selectedFiles) {
          const attachment = await fetchEventFileAsAttachment(file);

          attachments.push({
            filename: attachment.filename,
            content: attachment.content,
            contentType: attachment.contentType,
            contentDisposition: 'attachment',
          });
        }
      }

      showSnackbar(
        scheduledAt ? 'Załączniki gotowe, zapisuję termin wysyłki...' : 'Załączniki gotowe, wysyłam email...',
        'info',
      );
      const currentPreviewHtml = await buildUnifiedEmailHtml({
        draft: formData,
        purpose: 'offer',
        recipientName,
      });
      setPreviewHtml(currentPreviewHtml);

      const result = await dispatchCrmEmail({
        accessToken: session.access_token,
        functionName: 'send-email',
        scheduledAt,
        metadata: {
          entityType: 'calculation',
          entityId: calculationId,
          eventId,
          actionUrl: `/crm/events/${eventId}?tab=calculations`,
        },
        payload: {
          emailAccountId: formData.fromAccountId,
          to: formData.to.trim(),
          subject: formData.subject.trim(),
          body: currentPreviewHtml,
          attachments,
          cc: formData.cc.trim(),
          bcc: formData.bcc.trim(),
        },
      });

      showSnackbar(
        result.scheduled && result.scheduledAt
          ? `Kalkulacja zostanie wysłana ${formatScheduledEmailDate(result.scheduledAt)}`
          : 'Kalkulacja wysłana przez email',
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

  useEffect(() => {
    if (!includeEventFiles || !eventId) {
      setSelectedFileIds([]);
      return;
    }

    fetchEventFiles();
  }, [includeEventFiles, eventId]);

  useEffect(() => {
    fetchEmailAccounts();
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      data-crm-modal="true"
    >
      <div
        data-crm-modal-surface="true"
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33]"
      >
        <div
          data-crm-modal-bar="true"
          className="flex items-center justify-between border-b border-[#d3bb73]/20 p-6"
        >
          <div className="flex items-center gap-3">
            <Mail className="h-6 w-6 text-[#d3bb73]" />
            <h2 className="text-xl font-light text-[#e5e4e2]">Wyślij kalkulację przez email</h2>
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

        <div className="space-y-4 p-6">
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
            recipientHint={contactPerson?.email ? (
              <span>
                Kontakt główny: {contactPerson.name} ({contactPerson.email})
              </span>
            ) : null}
          >
              {eventId && <div className="rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] p-4">
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={includeEventFiles}
                    onChange={(e) => setIncludeEventFiles(e.target.checked)}
                    disabled={loading}
                    className="mt-1 h-4 w-4 rounded border-[#d3bb73]/40 bg-[#0a0d1a]"
                  />

                  <div>
                    <p className="text-sm font-medium text-[#e5e4e2]">
                      Dołącz dodatkowe pliki z eventu
                    </p>
                    <p className="mt-1 text-xs text-[#e5e4e2]/50">
                      Zobaczysz tylko pliki, do których masz dostęp zgodnie z uprawnieniami.
                    </p>
                  </div>
                </label>
              </div>}
              {eventId && includeEventFiles && (
                <div className="rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-[#e5e4e2]">
                        Dodatkowe załączniki z eventu
                      </p>
                      <p className="text-xs text-[#e5e4e2]/50">
                        Wybierz pliki, które chcesz dołączyć do wiadomości
                      </p>
                    </div>

                    {eventFiles.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          if (selectedFileIds.length === eventFiles.length) {
                            setSelectedFileIds([]);
                          } else {
                            setSelectedFileIds(eventFiles.map((f) => f.id));
                          }
                        }}
                        className="text-xs text-[#d3bb73] hover:underline"
                      >
                        {selectedFileIds.length === eventFiles.length
                          ? 'Odznacz wszystkie'
                          : 'Zaznacz wszystkie'}
                      </button>
                    )}
                  </div>

                  {loadingFiles ? (
                    <div className="py-4 text-sm text-[#e5e4e2]/50">Ładowanie plików...</div>
                  ) : eventFiles.length === 0 ? (
                    <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] px-3 py-3 text-sm text-[#e5e4e2]/50">
                      Brak dostępnych plików lub nie masz uprawnień do ich odczytu.
                    </div>
                  ) : (
                    <div className="max-h-48 space-y-2 overflow-y-auto">
                      {eventFiles.map((file) => {
                        const checked = selectedFileIds.includes(file.id);

                        return (
                          <label
                            key={file.id}
                            className="flex cursor-pointer items-center gap-3 rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] px-3 py-2 hover:border-[#d3bb73]/30"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                setSelectedFileIds((prev) =>
                                  prev.includes(file.id)
                                    ? prev.filter((id) => id !== file.id)
                                    : [...prev, file.id],
                                );
                              }}
                              className="h-4 w-4 rounded border-[#d3bb73]/40 bg-[#0a0d1a]"
                            />

                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm text-[#e5e4e2]">{file.name}</p>
                              {file.file_size && (
                                <p className="text-xs text-[#e5e4e2]/40">
                                  {(file.file_size / 1024 / 1024).toFixed(2)} MB
                                </p>
                              )}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3">
                <p className="text-xs text-amber-400">
                  <strong>Wskazówka:</strong> Kalkulacja w formacie PDF zostanie załączona do
                  wiadomości. Upewnij się, że wcześniej wygenerowałeś aktualny PDF.
                </p>
              </div>
          </UnifiedEmailComposer>
        </div>

        <div
          data-crm-modal-bar="true"
          className="flex items-center justify-end gap-3 border-t border-[#d3bb73]/20 p-6"
        >
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
                {formData.deliveryMode === 'scheduled' ? 'Planowanie...' : 'Wysyłanie...'}
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                {formData.deliveryMode === 'scheduled'
                  ? 'Zaplanuj kalkulację'
                  : 'Wyślij kalkulację'}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
