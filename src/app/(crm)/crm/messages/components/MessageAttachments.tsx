'use client';

import { File, Loader2, Paperclip } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useGetReceivedAttachmentsQuery, useGetSentAttachmentsQuery, type MessageDetails, type EmailAttachment } from '@/store/api/messagesApi';

export default function MessageAttachments({ message, onRetry }: { message: MessageDetails; onRetry: () => void }) {
  const { showSnackbar } = useSnackbar();
  const received = message.type === 'received';
  const sent = message.type === 'sent';
  const receivedQuery = useGetReceivedAttachmentsQuery(message.id, { skip: !received });
  const sentQuery = useGetSentAttachmentsQuery(message.id, { skip: !sent });
  const { currentData, error, isFetching, refetch } = sent ? sentQuery : receivedQuery;
  const attachments = currentData?.attachments || message.attachments || [];
  const requestError = error && 'data' in error ? (error.data as { error?: string })?.error : undefined;
  const errorMessage = currentData?.syncError || (error ? requestError || 'Nie udało się pobrać załączników. Spróbuj ponownie.' : message.attachmentsError);
  const archive = sent ? message.originalData?.delivery_archive : undefined;
  const expected = archive?.attachments?.expected;
  const missing = typeof expected === 'number' && attachments.length < expected;
  const sentCopy = archive?.sentCopy;
  const copyLabels: Record<string, string> = {
    saved: `Kopia zapisana na serwerze pocztowym${sentCopy?.mailbox ? ` w folderze „${sentCopy.mailbox}”` : ''}.`,
    provider_managed: 'Zapis kopii w folderze Wysłane obsługuje dostawca poczty.',
    unconfigured: 'Wiadomość wysłana. Brak konfiguracji IMAP do zapisania kopii na serwerze pocztowym.',
    failed: 'Wiadomość wysłana, ale nie potwierdzono zapisu kopii na serwerze pocztowym. Nie wysyłaj ponownie.',
    unknown: 'Brak potwierdzenia zapisu kopii na serwerze pocztowym.',
  };
  if (attachments.length === 0 && !errorMessage && !sent) return null;

  const download = async (attachment: EmailAttachment) => {
    try {
      const { data, error: downloadError } = await supabase.storage.from('email-attachments').download(attachment.storage_path);
      if (downloadError || !data) throw downloadError;
      const url = URL.createObjectURL(data);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = attachment.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      showSnackbar('Nie udało się pobrać załącznika. Spróbuj ponownie.', 'error');
    }
  };

  return (
    <section className="mt-2 min-w-0 rounded-md bg-white/[0.025] px-2 py-1" aria-label="Załączniki" aria-busy={isFetching}>
      {sent && (
        <div className="space-y-1 py-2 text-xs text-[#e5e4e2]/60">
          <p>{sentCopy ? copyLabels[sentCopy.status] || copyLabels.unknown : 'Ta starsza wiadomość nie ma informacji o zapisie kopii na serwerze pocztowym.'}</p>
          {isFetching && attachments.length === 0 ? <p role="status">Odczytywanie archiwum załączników…</p> : !errorMessage && (
            missing ? <p className="text-amber-200">Zarchiwizowano {attachments.length} z {expected} wysłanych załączników. Archiwum jest niepełne.</p> :
            attachments.length === 0 && <p>{expected === 0 && archive?.attachments?.status === 'complete'
              ? 'Wiadomość wysłana bez załączników.'
              : 'Brak załączników w archiwum CRM. Dla starszych wiadomości nie oznacza to, że wysłano je bez załączników.'}</p>
          )}
        </div>
      )}
      {attachments.length > 0 && (
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex shrink-0 items-center gap-1 text-[11px] text-[#e5e4e2]/60" title={`Załączniki: ${attachments.length}`}>
            <Paperclip className="h-3 w-3 text-[#d3bb73]" aria-hidden="true" />
            <span className="sr-only">Załączniki: </span>{attachments.length}
          </span>
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
            {attachments.map((attachment) => (
              <button
                key={attachment.id}
                type="button"
                onClick={() => void download(attachment)}
                className="flex h-7 max-w-56 shrink-0 items-center gap-1.5 rounded px-2 text-left transition-colors hover:bg-white/[0.07] focus-visible:bg-white/[0.07]"
                title={`Pobierz: ${attachment.filename} (${(attachment.size_bytes / 1024).toFixed(1)} KB)`}
                aria-label={`Pobierz załącznik: ${attachment.filename}`}
              >
                <File className="h-3 w-3 shrink-0 text-[#d3bb73]" aria-hidden="true" />
                <span className="truncate text-[11px] text-[#e5e4e2]">{attachment.filename}</span>
              </button>
            ))}
          </div>
          {isFetching && (
            <span role="status" className="shrink-0 text-[#e5e4e2]/60">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              <span className="sr-only">Pobieranie załączników…</span>
            </span>
          )}
        </div>
      )}
      {errorMessage && !isFetching && (
        <div role="alert" className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1 text-[11px] text-amber-200">
          <span>{errorMessage}</span>
          <button type="button" onClick={() => { if (received || sent) void refetch(); else onRetry(); }} className="rounded px-2 py-1 text-[#d3bb73] hover:bg-white/10">Spróbuj ponownie</button>
        </div>
      )}
    </section>
  );
}
