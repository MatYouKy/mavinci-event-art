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
        <div className="mb-2 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1 text-xs text-[#e5e4e2]/60 hover:text-white lg:hidden"
          >
            <ArrowLeft className="h-4 w-4" />
            Lista
          </button>

          <div className="ml-auto">
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

        <h2 className="line-clamp-2 text-sm font-semibold leading-snug text-white sm:text-base">
          {details.subject || '(bez tematu)'}
        </h2>
        <div className="mt-2 grid gap-0.5 text-[11px] leading-4 text-[#e5e4e2]/55 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-x-4">
          <div className="min-w-0 truncate">
            <span className="text-[#e5e4e2]/35">Od: </span>
            <span className="text-[#e5e4e2]/80">{details.from}</span>
          </div>
          <time className="whitespace-nowrap">{formatMessageDate(details.date)}</time>
          <div className="min-w-0 truncate sm:col-span-2">
            <span className="text-[#e5e4e2]/35">Do: </span>
            {details.to}
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5">
        <div className="mx-auto max-w-4xl">
          {details.bodyHtml?.trim() ? (
            <div
              className="email-content break-words text-sm leading-relaxed text-[#e5e4e2]"
              dangerouslySetInnerHTML={{ __html: details.bodyHtml }}
            />
          ) : details.body?.trim() ? (
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-[#e5e4e2]">
              {details.body}
            </p>
          ) : (
            <p className="text-sm italic text-[#e5e4e2]/40">Brak treści wiadomości</p>
          )}

          {details.attachments && details.attachments.length > 0 && (
            <div className="mt-6 border-t border-[#d3bb73]/15 pt-4">
              <div className="mb-2 flex items-center gap-2 text-xs font-medium text-[#e5e4e2]/70">
                <Paperclip className="h-4 w-4 text-[#d3bb73]" />
                Załączniki ({details.attachments.length})
              </div>
              <div className="grid gap-2 xl:grid-cols-2">
                {details.attachments.map((attachment) => (
                  <button
                    key={attachment.id}
                    type="button"
                    onClick={() => downloadAttachment(attachment)}
                    className="flex min-w-0 items-center gap-2 rounded-md border border-[#d3bb73]/15 bg-[#1c1f33] px-3 py-2 text-left hover:border-[#d3bb73]/35"
                  >
                    <Paperclip className="h-4 w-4 shrink-0 text-[#d3bb73]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs text-white">{attachment.filename}</span>
                      <span className="block text-[10px] text-[#e5e4e2]/40">
                        {(attachment.size_bytes / 1024).toFixed(1)} KB
                      </span>
                    </span>
                    <Download className="h-4 w-4 shrink-0 text-[#e5e4e2]/50" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
