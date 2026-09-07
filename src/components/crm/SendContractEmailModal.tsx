'use client';

import { useState, useEffect } from 'react';
import { BadgeCheck, X, Send, Mail, Loader, Paperclip } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import StorageFileThumbnail from './StorageFileThumbnail';
import {
  dispatchCrmEmail,
  formatScheduledEmailDate,
  resolveScheduledEmailDate,
} from '@/lib/emailScheduling';
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
  isDraft?: boolean;
  onClose: () => void;
  onSent?: () => void;
}

type ContractAttachmentSource = 'event-file';
type ContractAttachmentDocumentType = 'offer' | 'calculation';

interface ContractAttachmentApproval {
  state: 'accepted';
  documentType: ContractAttachmentDocumentType;
  documentId: string;
  label: string;
}

interface SelectableContractAttachment {
  key: string;
  id: string;
  source: ContractAttachmentSource;
  filename: string;
  displayName: string;
  storageBucket: 'event-files';
  storagePath: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  approval?: ContractAttachmentApproval;
}

const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer);
  const chunks: string[] = [];
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(index, index + chunkSize)));
  }
  return btoa(chunks.join(''));
};

const formatAttachmentSize = (sizeBytes: number) => {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return '';
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / 1024 / 1024).toFixed(2)} MB`;
};

export default function SendContractEmailModal({
  contractId,
  eventId,
  clientEmail = '',
  clientName = '',
  isDraft = false,
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
    subject: isDraft ? 'Draft umowy - Event' : 'Umowa - Event',
    messageHtml: isDraft
      ? `<p>Dzień dobry,</p><p><br></p><p>W załączeniu przesyłam wersję roboczą umowy na realizację wydarzenia.</p><p><br></p><p>Proszę o zapoznanie się z treścią i przekazanie ewentualnych uwag. Dokument pozostaje na tym etapie draftem.</p><p><br></p><p>W razie pytań proszę o kontakt.</p>`
      : `<p>Dzień dobry,</p><p><br></p><p>W załączeniu przesyłam umowę na realizację wydarzenia.</p><p><br></p><p>Proszę o zapoznanie się z treścią i odesłanie podpisanego egzemplarza.</p><p><br></p><p>W razie pytań proszę o kontakt.</p>`,
    fromAccountId: '',
  });
  const [showPreview, setShowPreview] = useState(false);
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [availableAttachments, setAvailableAttachments] = useState<SelectableContractAttachment[]>([]);
  const [selectedAttachmentKeys, setSelectedAttachmentKeys] = useState<string[]>([]);
  const [loadingAttachments, setLoadingAttachments] = useState(true);

  useEffect(() => {
    fetchEmailAccounts();
    fetchAvailableAttachments();
  }, []);

  useEffect(() => {
    if (clientEmail) {
      setFormData((prev) => ({ ...prev, to: clientEmail }));
    }
  }, [clientEmail]);

  useEffect(() => {
    generatePreview();
  }, [formData, clientName]);

  const fetchAvailableAttachments = async () => {
    try {
      setLoadingAttachments(true);
      const [filesResult, contractResult, acceptedOffersResult, acceptedCalculationsResult] =
        await Promise.all([
          supabase
            .from('event_files')
            .select(
              'id, name, original_name, file_path, file_size, mime_type, created_at, document_type, offer_id',
            )
            .eq('event_id', eventId)
            .order('created_at', { ascending: false }),
          supabase
            .from('contracts')
            .select('generated_pdf_path')
            .eq('id', contractId)
            .maybeSingle(),
          supabase.from('offers').select('id').eq('event_id', eventId).eq('status', 'accepted'),
          supabase
            .from('event_calculations')
            .select('id, generated_pdf_path')
            .eq('event_id', eventId)
            .eq('is_accepted', true),
        ]);

      if (filesResult.error) throw filesResult.error;
      if (contractResult.error) throw contractResult.error;

      if (acceptedOffersResult.error) {
        console.warn('Could not load accepted offer markers:', acceptedOffersResult.error);
      }
      if (acceptedCalculationsResult.error) {
        console.warn(
          'Could not load accepted calculation markers:',
          acceptedCalculationsResult.error,
        );
      }

      const currentContractPath = contractResult.data?.generated_pdf_path || '';
      const acceptedOfferIds = new Set(
        (acceptedOffersResult.data || []).map((offer) => offer.id),
      );
      const acceptedCalculationByPath = new Map(
        (acceptedCalculationsResult.data || [])
          .filter((calculation) => Boolean(calculation.generated_pdf_path))
          .map(
            (calculation): [string, string] => [
              calculation.generated_pdf_path as string,
              calculation.id,
            ],
          ),
      );

      // Pliki są posortowane od najnowszych, więc dla zaakceptowanej oferty
      // oznaczamy wyłącznie jej aktualny (najnowszy) PDF, a nie stare wersje.
      const latestAcceptedOfferFileIds = new Set<string>();
      const matchedOfferIds = new Set<string>();
      for (const file of filesResult.data || []) {
        if (
          file.document_type === 'offer' &&
          file.offer_id &&
          acceptedOfferIds.has(file.offer_id) &&
          !matchedOfferIds.has(file.offer_id)
        ) {
          matchedOfferIds.add(file.offer_id);
          latestAcceptedOfferFileIds.add(file.id);
        }
      }

      const eventFileAttachments: SelectableContractAttachment[] = (filesResult.data || [])
        .filter((file) => Boolean(file.file_path) && file.file_path !== currentContractPath)
        .map((file) => {
          const filename =
            file.original_name || file.name || file.file_path.split('/').pop() || 'Plik';
          const acceptedCalculationId = acceptedCalculationByPath.get(file.file_path);
          let approval: ContractAttachmentApproval | undefined;

          if (file.document_type === 'calculation' && acceptedCalculationId) {
            approval = {
              state: 'accepted',
              documentType: 'calculation',
              documentId: acceptedCalculationId,
              label: 'Zaakceptowana kalkulacja',
            };
          } else if (
            file.document_type === 'offer' &&
            file.offer_id &&
            latestAcceptedOfferFileIds.has(file.id)
          ) {
            approval = {
              state: 'accepted',
              documentType: 'offer',
              documentId: file.offer_id,
              label: 'Zaakceptowana oferta',
            };
          }

          return {
            key: `event-file:${file.id}`,
            id: file.id,
            source: 'event-file',
            filename,
            displayName: file.name || filename,
            storageBucket: 'event-files',
            storagePath: file.file_path,
            contentType: file.mime_type || 'application/octet-stream',
            sizeBytes: Number(file.file_size || 0),
            createdAt: file.created_at || '',
            approval,
          };
        });

      // Kolejne źródła (np. dokumenty klienta lub firmowa baza plików) mogą
      // zostać dopięte jako następne tablice zgodne z SelectableContractAttachment.
      setAvailableAttachments([...eventFileAttachments]);
    } catch (error) {
      console.error('Error fetching contract attachments:', error);
      setAvailableAttachments([]);
      showSnackbar('Nie udało się pobrać dostępnych plików wydarzenia', 'error');
    } finally {
      setLoadingAttachments(false);
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
    const base64 = arrayBufferToBase64(buffer);

    const filename =
      contractData.generated_pdf_path.split('/').pop() ||
      `Umowa_${contractData.contract_number || contractId}.pdf`;

    return { base64, filename };
  };

  const fetchSelectedAttachment = async (attachment: SelectableContractAttachment) => {
    const { data: signedData, error } = await supabase.storage
      .from(attachment.storageBucket)
      .createSignedUrl(attachment.storagePath, 300);

    if (error || !signedData?.signedUrl) {
      throw new Error(`Nie udało się uzyskać dostępu do pliku: ${attachment.displayName}`);
    }

    const response = await fetch(signedData.signedUrl);
    if (!response.ok) {
      throw new Error(`Nie udało się pobrać pliku: ${attachment.displayName}`);
    }

    const blob = await response.blob();
    return {
      filename: attachment.filename,
      content: arrayBufferToBase64(await blob.arrayBuffer()),
      contentType: attachment.contentType || blob.type || 'application/octet-stream',
      contentDisposition: 'attachment',
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
          contentDisposition: 'attachment',
        },
      ];

      const selectedAttachments = availableAttachments.filter((attachment) =>
        selectedAttachmentKeys.includes(attachment.key),
      );
      if (selectedAttachments.length > 0) {
        showSnackbar(`Pobieram dodatkowe załączniki (${selectedAttachments.length})...`, 'info');
        for (const attachment of selectedAttachments) {
          attachments.push(await fetchSelectedAttachment(attachment));
        }
      }

      showSnackbar(
        scheduledAt ? 'Załączniki gotowe, zapisuję termin wysyłki...' : 'Załączniki gotowe, wysyłam email...',
        'info',
      );
      const currentPreviewHtml = await buildPreviewHtml();
      setPreviewHtml(currentPreviewHtml);

      const result = await dispatchCrmEmail({
        accessToken: session.access_token,
        functionName: 'send-email',
        scheduledAt,
        metadata: {
          entityType: 'contract',
          entityId: contractId,
          eventId,
          markEntitySent: !isDraft,
          draft: isDraft,
          actionUrl: `/crm/events/${eventId}?tab=contract`,
        },
        payload: {
          emailAccountId: formData.fromAccountId,
          to: formData.to,
          subject: formData.subject,
          body: currentPreviewHtml,
          attachments,
          cc: formData.cc.trim(),
          bcc: formData.bcc.trim(),
        },
      });

      if (!isDraft && !result.scheduled) {
        await supabase
          .from('contracts')
          .update({
            status: 'sent',
            sent_at: new Date().toISOString(),
          })
          .eq('id', contractId);
      }

      showSnackbar(
        result.scheduled && result.scheduledAt
          ? `${isDraft ? 'Draft umowy' : 'Umowa'} zostanie wysłan${isDraft ? 'y' : 'a'} ${formatScheduledEmailDate(result.scheduledAt)}`
          : isDraft
            ? 'Draft umowy wysłany przez email'
            : 'Umowa wysłana przez email',
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
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33]">
        <div className="flex items-center justify-between border-b border-[#d3bb73]/20 p-6">
          <div className="flex items-center gap-3">
            <Mail className="h-6 w-6 text-[#d3bb73]" />
            <h2 className="text-xl font-light text-[#e5e4e2]">
              {isDraft ? 'Wyślij draft umowy przez email' : 'Wyślij umowę przez email'}
            </h2>
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
            <div className="rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] p-4">
              <div className="mb-3 flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-start gap-3">
                  <Paperclip className="mt-0.5 h-4 w-4 shrink-0 text-[#d3bb73]" />
                  <div>
                    <p className="text-sm font-medium text-[#e5e4e2]">Dodatkowe załączniki</p>
                    <p className="mt-1 text-xs text-[#e5e4e2]/50">
                      Pliki z zakładki „Pliki”, do których masz obecnie dostęp.
                    </p>
                  </div>
                </div>
                {availableAttachments.length > 0 && (
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => {
                      setSelectedAttachmentKeys((current) =>
                        current.length === availableAttachments.length
                          ? []
                          : availableAttachments.map((attachment) => attachment.key),
                      );
                    }}
                    className="shrink-0 text-xs text-[#d3bb73] hover:underline disabled:opacity-50"
                  >
                    {selectedAttachmentKeys.length === availableAttachments.length
                      ? 'Odznacz wszystkie'
                      : 'Zaznacz wszystkie'}
                  </button>
                )}
              </div>

              {loadingAttachments ? (
                <div className="flex items-center gap-2 py-3 text-sm text-[#e5e4e2]/50">
                  <Loader className="h-4 w-4 animate-spin" />
                  Ładowanie plików…
                </div>
              ) : availableAttachments.length === 0 ? (
                <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] px-3 py-3 text-sm text-[#e5e4e2]/50">
                  Brak dostępnych plików lub nie masz uprawnień do ich odczytu.
                </div>
              ) : (
                <div className="max-h-52 space-y-2 overflow-y-auto pr-1">
                  {availableAttachments.map((attachment) => {
                    const checked = selectedAttachmentKeys.includes(attachment.key);
                    const formattedSize = formatAttachmentSize(attachment.sizeBytes);
                    return (
                      <label
                        key={attachment.key}
                        className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 transition-colors ${
                          attachment.approval
                            ? 'border-emerald-400/40 bg-emerald-500/10 hover:border-emerald-300/70'
                            : 'border-[#d3bb73]/10 bg-[#1c1f33] hover:border-[#d3bb73]/30'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={loading}
                          onChange={() => {
                            setSelectedAttachmentKeys((current) =>
                              current.includes(attachment.key)
                                ? current.filter((key) => key !== attachment.key)
                                : [...current, attachment.key],
                            );
                          }}
                          className="h-4 w-4 rounded border-[#d3bb73]/40 bg-[#0a0d1a]"
                        />
                        <StorageFileThumbnail
                          bucket={attachment.storageBucket}
                          storagePath={attachment.storagePath}
                          mimeType={attachment.contentType}
                          fileName={attachment.filename}
                          alt={attachment.displayName}
                          className={`h-11 w-11 rounded-md border ${
                            attachment.approval
                              ? 'border-emerald-400/40'
                              : 'border-[#d3bb73]/10'
                          }`}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm text-[#e5e4e2]">
                            {attachment.displayName}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            <p className="text-xs text-[#e5e4e2]/40">
                              Pliki wydarzenia{formattedSize ? ` · ${formattedSize}` : ''}
                            </p>
                            {attachment.approval && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/35 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-200">
                                <BadgeCheck className="h-3 w-3" />
                                {attachment.approval.label}
                              </span>
                            )}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}

              {selectedAttachmentKeys.length > 0 && (
                <p className="mt-3 text-xs text-[#d3bb73]">
                  Wybrano: {selectedAttachmentKeys.length}
                </p>
              )}
            </div>
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3">
              <p className="text-xs text-amber-400">
                <strong>Wskazówka:</strong> PDF {isDraft ? 'draftu' : 'umowy'} zostanie dołączony
                zawsze. Zaznaczone pliki będą dodatkowymi załącznikami
                {isDraft
                  ? ', a dokument zachowa status „Szkic” i nadal będzie można go edytować.'
                  : ', a status umowy zmieni się na „Wysłana”.'}
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
                {formData.deliveryMode === 'scheduled'
                  ? `Zaplanuj ${isDraft ? 'draft' : 'umowę'}`
                  : isDraft
                    ? 'Wyślij draft'
                    : 'Wyślij umowę'}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
