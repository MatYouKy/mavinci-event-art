'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, FileText, Mail, Send, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import FullScreenLoader from '@/components/UI/Loader/CustomModalLoader';
import UnifiedEmailComposer, {
  buildUnifiedEmailHtml,
  hasUnifiedEmailBody,
  loadUnifiedEmailAccounts,
  plainTextToEmailHtml,
  type UnifiedEmailAccount,
  type UnifiedEmailDraft,
} from '@/components/crm/UnifiedEmailComposer';
import { dispatchCrmEmail, formatScheduledEmailDate, resolveScheduledEmailDate } from '@/lib/emailScheduling';
import { linkEventEmail } from '@/lib/CRM/events/eventCorrespondence';
import {
  EVENT_DOCUMENT_ATTACHMENTS_LIMIT,
  EVENT_DOCUMENT_EMAIL,
  loadEventDocumentEmailContext,
  type EventDocumentEmailContext,
  type EventDocumentEmailFile,
  type EventDocumentKind,
} from '@/lib/CRM/events/eventDocumentEmail';

/** Base64 bez budowania jednego wielkiego napisu znak po znaku (PDF z obrazami ma kilka MB). */
function toBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(index, index + 0x8000) as unknown as number[]);
  }
  return btoa(binary);
}

async function downloadEventFile(path: string, label: string) {
  const { data, error } = await supabase.storage.from('event-files').createSignedUrl(path, 300);
  if (error || !data?.signedUrl) throw new Error(`Nie udało się pobrać pliku: ${label}`);
  const response = await fetch(data.signedUrl);
  if (!response.ok) throw new Error(`Nie udało się pobrać pliku: ${label}`);
  const blob = await response.blob();
  return { buffer: await blob.arrayBuffer(), type: blob.type };
}

/**
 * „Wyślij e-mailem” w zakładce „Agenda” (agenda albo Karta Weselna): skrzynka osoby wysyłającej (domyślnie własna), adresat
 * z eventu, temat i treść do edycji, stopka i szablon firmy („Podgląd”), zapisany PDF dokumentu zawsze w załączniku, wybrane
 * pliki eventu, wysyłka teraz albo zaplanowana. Wiadomość trafia do korespondencji eventu. Na Macu: `EventDocumentEmailSheet`.
 */
export default function SendEventDocumentEmailModal({
  eventId,
  document,
  onClose,
  onSent,
}: {
  eventId: string;
  document: EventDocumentKind;
  onClose: () => void;
  onSent?: () => void;
}) {
  const texts = EVENT_DOCUMENT_EMAIL[document];
  const { showSnackbar } = useSnackbar();
  const [context, setContext] = useState<EventDocumentEmailContext | null>(null);
  const [loadError, setLoadError] = useState('');
  const [accounts, setAccounts] = useState<UnifiedEmailAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [draft, setDraft] = useState<UnifiedEmailDraft>({
    fromAccountId: '', to: '', cc: '', bcc: '', subject: '', messageHtml: plainTextToEmailHtml(texts.text),
  });
  const [showPreview, setShowPreview] = useState(false);
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [includeFiles, setIncludeFiles] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let active = true;
    setLoadError('');
    loadEventDocumentEmailContext(supabase, eventId, document)
      .then((next) => {
        if (!active) return;
        setContext(next);
        setDraft((current) => ({ ...current, to: current.to || next.to, subject: current.subject || texts.subject(next.eventName) }));
      })
      .catch((error) => { if (active) setLoadError(error instanceof Error ? error.message : 'Nie udało się przygotować wysyłki'); });
    loadUnifiedEmailAccounts()
      .then((list) => {
        if (!active) return;
        setAccounts(list);
        // Pierwsza skrzynka to własna skrzynka osoby wysyłającej (`compareSendingAccounts`).
        setDraft((current) => ({ ...current, fromAccountId: current.fromAccountId || list[0]?.id || '' }));
      })
      .catch(() => { if (active) showSnackbar('Błąd podczas ładowania kont email', 'error'); })
      .finally(() => { if (active) setAccountsLoading(false); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, document]);

  useEffect(() => {
    if (!showPreview) return;
    let active = true;
    setPreviewLoading(true);
    buildUnifiedEmailHtml({ draft, purpose: 'general', recipientName: context?.recipientName })
      .then((html) => { if (active) setPreviewHtml(html); })
      .catch(() => { if (active) setPreviewHtml(''); })
      .finally(() => { if (active) setPreviewLoading(false); });
    return () => { active = false; };
  }, [showPreview, draft, context?.recipientName]);

  const files = context?.files || [];
  const toggleFile = (file: EventDocumentEmailFile) =>
    setSelectedFiles((current) => (current.includes(file.id) ? current.filter((id) => id !== file.id) : [...current, file.id]));

  const send = async () => {
    if (!context?.document) { showSnackbar(context?.missing || texts.missing, 'error'); return; }
    if (!draft.to.trim()) { showSnackbar('Wprowadź adres email odbiorcy', 'error'); return; }
    if (!draft.subject.trim()) { showSnackbar('Wprowadź temat wiadomości', 'error'); return; }
    if (!hasUnifiedEmailBody(draft.messageHtml)) { showSnackbar('Wprowadź treść wiadomości', 'error'); return; }
    if (!accounts.length) { showSnackbar('Nie masz skonfigurowanych kont pocztowych', 'error'); return; }
    if (!draft.fromAccountId) { showSnackbar('Wybierz konto pocztowe nadawcy', 'error'); return; }
    let scheduledAt: string | null;
    try {
      scheduledAt = resolveScheduledEmailDate(draft);
    } catch (error) {
      showSnackbar(error instanceof Error ? error.message : 'Nieprawidłowy termin wysyłki', 'error');
      return;
    }
    setSending(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Brak sesji użytkownika');
      const pdf = await downloadEventFile(context.document.path, context.document.filename);
      let total = pdf.buffer.byteLength;
      const attachments = [{
        filename: context.document.filename || texts.fallbackName,
        content: toBase64(pdf.buffer),
        contentType: 'application/pdf',
        contentDisposition: 'attachment',
      }];
      for (const file of includeFiles ? files.filter((item) => selectedFiles.includes(item.id)) : []) {
        const content = await downloadEventFile(file.path, file.name);
        total += content.buffer.byteLength;
        if (total > EVENT_DOCUMENT_ATTACHMENTS_LIMIT) throw new Error('Załączniki przekraczają 25 MB. Wybierz mniej plików eventu.');
        attachments.push({
          filename: file.filename,
          content: toBase64(content.buffer),
          contentType: file.mimeType || content.type || 'application/octet-stream',
          contentDisposition: 'attachment',
        });
      }
      const body = await buildUnifiedEmailHtml({ draft, purpose: 'general', recipientName: context.recipientName });
      const result = await dispatchCrmEmail({
        accessToken: session.access_token,
        functionName: 'send-email',
        scheduledAt,
        metadata: { eventId, actionUrl: `/crm/events/${eventId}?tab=${texts.tab}` },
        payload: {
          emailAccountId: draft.fromAccountId,
          to: draft.to.trim(),
          cc: draft.cc.trim(),
          bcc: draft.bcc.trim(),
          subject: draft.subject.trim(),
          body,
          attachments,
        },
      });
      await linkEventEmail(supabase, eventId, result);
      showSnackbar(
        result.scheduled && result.scheduledAt ? `${texts.scheduled} ${formatScheduledEmailDate(result.scheduledAt)}` : texts.sent,
        'success',
      );
      onSent?.();
      onClose();
    } catch (error) {
      showSnackbar(error instanceof Error ? error.message : 'Błąd podczas wysyłania email', 'error');
    } finally {
      setSending(false);
    }
  };

  const ready = Boolean(context?.document);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" data-crm-modal="true">
      <FullScreenLoader
        show={sending}
        title={draft.deliveryMode === 'scheduled' ? 'Planowanie wysyłki' : 'Wysyłanie wiadomości'}
        description={draft.deliveryMode === 'scheduled' ? 'Zapisuję termin wysyłki…' : texts.sending}
      />
      <div data-crm-modal-surface="true" className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33]">
        <div data-crm-modal-bar="true" className="flex items-center justify-between border-b border-[#d3bb73]/20 p-6">
          <div className="flex items-center gap-3">
            <Mail className="h-6 w-6 text-[#d3bb73]" aria-hidden />
            <h2 className="text-xl font-light text-[#e5e4e2]">{texts.title}</h2>
          </div>
          <button type="button" onClick={onClose} disabled={sending} aria-label="Zamknij"
            className="rounded-lg p-2 text-[#e5e4e2]/60 transition-colors hover:bg-[#d3bb73]/10 hover:text-[#e5e4e2]">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-6">
          {loadError ? (
            <p role="alert" className="rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">{loadError}</p>
          ) : !context ? (
            <p className="text-sm text-[#e5e4e2]/60">Ładowanie…</p>
          ) : (
            <UnifiedEmailComposer
              draft={draft}
              onChange={setDraft}
              accounts={accounts}
              accountsLoading={accountsLoading}
              disabled={sending}
              showPreview={showPreview}
              onShowPreviewChange={setShowPreview}
              previewHtml={previewHtml}
              previewLoading={previewLoading}
              allowScheduling
              recipientHint={context.recipientName ? <span>Adresat: {context.recipientName}</span> : null}
            >
              <div className={`flex items-start gap-3 rounded-lg border p-3 text-sm ${ready ? 'border-sky-400/20 bg-sky-400/10 text-sky-100' : 'border-amber-400/30 bg-amber-400/10 text-amber-100'}`}>
                {ready ? <FileText className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
                <div>
                  <p>{ready ? texts.attachment : context.missing}</p>
                  {ready && <p className="mt-1 text-xs opacity-70">{context.document?.filename}</p>}
                  {context.stale && texts.stale && <p className="mt-1 text-xs text-amber-200">{texts.stale}</p>}
                </div>
              </div>

              <div className="rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] p-4">
                <label className="flex cursor-pointer items-start gap-3">
                  <input type="checkbox" checked={includeFiles} disabled={sending}
                    onChange={(event) => { setIncludeFiles(event.target.checked); if (!event.target.checked) setSelectedFiles([]); }}
                    className="mt-1 h-4 w-4 rounded border-[#d3bb73]/40 bg-[#0a0d1a]" />
                  <div>
                    <p className="text-sm font-medium text-[#e5e4e2]">Dołącz dodatkowe pliki z eventu</p>
                    <p className="mt-1 text-xs text-[#e5e4e2]/50">Zobaczysz tylko pliki, do których masz dostęp zgodnie z uprawnieniami.</p>
                  </div>
                </label>
                {includeFiles && (
                  <div className="mt-3 space-y-2">
                    {context.filesError ? (
                      <p className="text-sm text-amber-200">{context.filesError}</p>
                    ) : files.length === 0 ? (
                      <p className="text-sm text-[#e5e4e2]/50">Brak dostępnych plików lub nie masz uprawnień do ich odczytu.</p>
                    ) : (
                      <>
                        <button type="button" className="text-xs text-[#d3bb73] hover:underline"
                          onClick={() => setSelectedFiles(selectedFiles.length === files.length ? [] : files.map((file) => file.id))}>
                          {selectedFiles.length === files.length ? 'Odznacz wszystkie' : 'Zaznacz wszystkie'}
                        </button>
                        <div className="max-h-48 space-y-2 overflow-y-auto">
                          {files.map((file) => (
                            <label key={file.id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] px-3 py-2 hover:border-[#d3bb73]/30">
                              <input type="checkbox" checked={selectedFiles.includes(file.id)} onChange={() => toggleFile(file)} disabled={sending}
                                className="h-4 w-4 rounded border-[#d3bb73]/40 bg-[#0a0d1a]" />
                              <span className="min-w-0 flex-1 truncate text-sm text-[#e5e4e2]">{file.name}</span>
                              {file.size ? <span className="text-xs text-[#e5e4e2]/40">{(file.size / 1024 / 1024).toFixed(2)} MB</span> : null}
                            </label>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
              <p className="text-xs text-[#e5e4e2]/50">Wysłana wiadomość pojawi się w zakładce „Korespondencja” eventu razem z odpowiedziami klienta.</p>
            </UnifiedEmailComposer>
          )}
        </div>

        <div data-crm-modal-bar="true" className="flex items-center justify-end gap-3 border-t border-[#d3bb73]/20 p-6">
          <button type="button" onClick={onClose} disabled={sending}
            className="rounded-lg px-6 py-2.5 text-[#e5e4e2]/80 transition-colors hover:bg-[#d3bb73]/10 disabled:opacity-50">
            Anuluj
          </button>
          <button type="button" onClick={() => void send()} disabled={sending || accountsLoading || !accounts.length || !ready}
            className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-2.5 font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:opacity-50">
            <Send className="h-4 w-4" aria-hidden />
            {draft.deliveryMode === 'scheduled' ? 'Zaplanuj wysyłkę' : 'Wyślij'}
          </button>
        </div>
      </div>
    </div>
  );
}
