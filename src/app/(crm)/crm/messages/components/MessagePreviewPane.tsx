'use client';

import {
  ArrowLeft,
  Download,
  ExternalLink,
  Forward,
  Inbox,
  ListPlus,
  ListTodo,
  Loader2,
  Paperclip,
  Reply,
  Trash2,
  UserPlus,
} from 'lucide-react';
import ResponsiveActionBar from '@/components/crm/ResponsiveActionBar';
import { supabase } from '@/lib/supabase/browser';
import {
  useGetMessageDetailsQuery,
  type MessageDetails,
  type MessageListItem,
} from '@/store/api/messagesApi';
import { useSnackbar } from '@/contexts/SnackbarContext';
import EmailHtmlPreview from './EmailHtmlPreview';

interface MessagePreviewPaneProps {
  message: MessageListItem | null;
  canManage: boolean;
  onClose: () => void;
  onOpenInNewWindow: (message: MessageListItem) => void;
  onReply: (message: MessageDetails) => void;
  onForward: (message: MessageDetails) => void;
  onAssign: (message: MessageDetails) => void;
  onCreateInquiry: (message: MessageDetails) => void;
  onCreateTask?: (message: MessageDetails) => void;
  onDelete: (message: MessageDetails) => void;
}

const formatMessageDate = (date: string) =>
  new Date(date).toLocaleString('pl-PL', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

export function MessagePreviewPane({
  message,
  canManage,
  onClose,
  onOpenInNewWindow,
  onReply,
  onForward,
  onAssign,
  onCreateInquiry,
  onCreateTask,
  onDelete,
}: MessagePreviewPaneProps) {
  const { showSnackbar } = useSnackbar();
  const previewable = Boolean(message && message.type !== 'draft');
  const { data: details, isLoading, error } = useGetMessageDetailsQuery(
    {
      id: message?.id || '',
      type:
        message?.type === 'contact_form' ||
        message?.type === 'sent' ||
        message?.type === 'received'
          ? message.type
          : 'received',
    },
    { skip: !previewable },
  );

  const downloadAttachment = async (attachment: NonNullable<MessageDetails['attachments']>[number]) => {
    try {
      const { data, error: downloadError } = await supabase.storage
        .from('email-attachments')
        .download(attachment.storage_path);

      if (downloadError) throw downloadError;

      const url = URL.createObjectURL(data);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = attachment.filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch (downloadError) {
      console.error('Error downloading attachment:', downloadError);
      showSnackbar('Nie udało się pobrać załącznika', 'error');
    }
  };

  if (!message) {
    return (
      <div className="flex h-full min-h-0 flex-1 items-center justify-center bg-[#11141f] p-8">
        <div className="max-w-sm text-center">
          <Inbox className="mx-auto mb-3 h-10 w-10 text-[#d3bb73]/30" />
          <p className="text-sm font-medium text-[#e5e4e2]/70">Wybierz wiadomość</p>
          <p className="mt-1 text-xs leading-relaxed text-[#e5e4e2]/40">
            Jej treść i załączniki pojawią się tutaj bez otwierania kolejnej karty.
          </p>
        </div>
      </div>
    );
  }

  if (message.type === 'draft') {
    return (
      <div className="flex h-full min-h-0 flex-1 items-center justify-center bg-[#11141f] p-8">
        <div className="text-center">
          <p className="mb-4 text-sm text-[#e5e4e2]/70">Wersję roboczą otwórz w pełnym edytorze.</p>
          <button
            type="button"
            onClick={() => onOpenInNewWindow(message)}
            className="inline-flex items-center gap-2 rounded-md bg-[#d3bb73] px-3 py-2 text-sm font-medium text-[#11141f]"
          >
            <ExternalLink className="h-4 w-4" />
            Otwórz w nowym oknie
          </button>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-full min-h-0 flex-1 items-center justify-center bg-[#11141f]">
        <Loader2 className="h-6 w-6 animate-spin text-[#d3bb73]" />
      </div>
    );
  }

  if (error || !details) {
    return (
      <div className="flex h-full min-h-0 flex-1 items-center justify-center bg-[#11141f] p-6 text-center">
        <p className="text-sm text-red-300">Nie udało się pobrać treści wiadomości.</p>
      </div>
    );
  }

  const canActOnInbound = details.type === 'received' || details.type === 'contact_form';

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-[#11141f]">
      <header className="shrink-0 border-b border-[#d3bb73]/15 bg-[#171a28] px-3 py-2.5 sm:px-4 sm:py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <button
              type="button"
              onClick={onClose}
              className="mb-1 inline-flex items-center gap-1 text-xs text-[#e5e4e2]/60 hover:text-white lg:hidden"
            >
              <ArrowLeft className="h-4 w-4" />
              Lista
            </button>
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <h2 className="min-w-0 truncate text-sm font-semibold leading-snug text-white sm:text-base">
                {details.subject || '(bez tematu)'}
              </h2>
              <time className="shrink-0 text-[10px] text-[#e5e4e2]/40 sm:text-[11px]">
                {formatMessageDate(details.date)}
              </time>
            </div>
            <div className="mt-1 flex min-w-0 flex-wrap gap-x-4 gap-y-0.5 text-[10px] leading-4 text-[#e5e4e2]/55 sm:text-[11px]">
              <span className="min-w-0 truncate">
                <span className="text-[#e5e4e2]/35">Od: </span>
                <span className="text-[#e5e4e2]/80">{details.from}</span>
              </span>
              <span className="min-w-0 truncate">
                <span className="text-[#e5e4e2]/35">Do: </span>
                {details.to}
              </span>
            </div>
          </div>

          <div className="shrink-0">
            <ResponsiveActionBar
              compact
              disabledBackground
              actions={[
                {
                  label: 'Otwórz w nowym oknie',
                  onClick: () => onOpenInNewWindow(message),
                  icon: <ExternalLink className="h-4 w-4" />,
                  pin: true,
                },
                ...(canManage && canActOnInbound
                  ? [
                      {
                        label: 'Odpowiedz',
                        onClick: () => onReply(details),
                        icon: <Reply className="h-4 w-4" />,
                        variant: 'primary' as const,
                        pin: true,
                      },
                      {
                        label: 'Przypisz',
                        onClick: () => onAssign(details),
                        icon: <UserPlus className="h-4 w-4" />,
                      },
                      {
                        label: 'Dodaj do zapytań',
                        onClick: () => onCreateInquiry(details),
                        icon: <ListTodo className="h-4 w-4" />,
                      },
                    ]
                  : []),
                ...(canActOnInbound && onCreateTask
                  ? [
                      {
                        label: 'Utwórz zadanie',
                        onClick: () => onCreateTask(details),
                        icon: <ListPlus className="h-4 w-4" />,
                      },
                    ]
                  : []),
                ...(canManage && details.type === 'received'
                  ? [
                      {
                        label: 'Przekaż',
                        onClick: () => onForward(details),
                        icon: <Forward className="h-4 w-4" />,
                      },
                    ]
                  : []),
                ...(canManage
                  ? [
                      {
                        label: 'Przenieś do kosza',
                        onClick: () => onDelete(details),
                        icon: <Trash2 className="h-4 w-4" />,
                        variant: 'danger' as const,
                      },
                    ]
                  : []),
              ]}
            />
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5">
        <div className="mx-auto max-w-4xl">
          {details.bodyHtml?.trim() ? (
            <EmailHtmlPreview
              html={details.bodyHtml}
              employeeId={details.originalData?.employee_id}
              emailAccountId={details.email_account_id}
              title={`Wiadomość: ${details.subject || 'bez tematu'}`}
            />
          ) : details.body?.trim() ? (
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-[#e5e4e2]">
              {details.body}
            </p>
          ) : (
            <p className="text-sm italic text-[#e5e4e2]/40">Brak treści wiadomości</p>
          )}

        </div>
      </div>

      {details.attachments && details.attachments.length > 0 && (
        <div className="shrink-0 border-t border-[#d3bb73]/15 bg-[#11141f] px-4 pb-4 pt-2 sm:px-6 sm:pr-20">
          <div className="rounded-lg border border-[#d3bb73]/15 bg-[#171a28] p-2.5 shadow-lg shadow-black/20">
            <div className="mb-1.5 flex items-center gap-2 text-[11px] font-medium text-[#e5e4e2]/70">
              <Paperclip className="h-3.5 w-3.5 text-[#d3bb73]" />
              Załączniki ({details.attachments.length})
            </div>
            <div className="max-h-28 space-y-1.5 overflow-y-auto pr-1">
              {details.attachments.map((attachment) => (
                <button
                  key={attachment.id}
                  type="button"
                  onClick={() => downloadAttachment(attachment)}
                  className="flex w-full min-w-0 items-center gap-2 rounded-md border border-[#d3bb73]/10 bg-[#1c1f33] px-2.5 py-1.5 text-left transition-colors hover:border-[#d3bb73]/35"
                >
                  <Paperclip className="h-3.5 w-3.5 shrink-0 text-[#d3bb73]" />
                  <span className="min-w-0 flex-1 truncate text-xs text-white">
                    {attachment.filename}
                  </span>
                  <span className="shrink-0 text-[10px] text-[#e5e4e2]/40">
                    {(attachment.size_bytes / 1024).toFixed(1)} KB
                  </span>
                  <Download className="h-3.5 w-3.5 shrink-0 text-[#e5e4e2]/50" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
