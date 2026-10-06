'use client';

import { File, Loader2, Paperclip } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useGetReceivedAttachmentsQuery, type MessageDetails, type EmailAttachment } from '@/store/api/messagesApi';

export default function MessageAttachments({ message, onRetry }: { message: MessageDetails; onRetry: () => void }) {
  const { showSnackbar } = useSnackbar();
  const received = message.type === 'received';
  const { currentData, error, isFetching, refetch } = useGetReceivedAttachmentsQuery(message.id, { skip: !received });
  const attachments = (received ? currentData?.attachments : undefined) || message.attachments || [];
  const requestError = error && 'data' in error ? (error.data as { error?: string })?.error : undefined;
  const errorMessage = received
    ? currentData?.syncError || (error ? requestError || 'Nie udało się pobrać załączników. Spróbuj ponownie.' : undefined)
    : message.attachmentsError;
  if (attachments.length === 0 && !errorMessage) return null;

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
          <button type="button" onClick={() => { if (received) void refetch(); else onRetry(); }} className="rounded px-2 py-1 text-[#d3bb73] hover:bg-white/10">Spróbuj ponownie</button>
        </div>
      )}
    </section>
  );
}
