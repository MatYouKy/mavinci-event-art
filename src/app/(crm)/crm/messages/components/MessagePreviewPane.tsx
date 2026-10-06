'use client';

import { formatSystemSubject } from '@/lib/ui/systemLabels';
import InquiryTypeBadges from '@/components/crm/inquiries/InquiryTypeBadges';

import {
  ArrowLeft,
  ExternalLink,
  Forward,
  Inbox,
  ListPlus,
  ListTodo,
  Loader2,
  Reply,
  Trash2,
  UserPlus,
} from 'lucide-react';
import ResponsiveActionBar from '@/components/crm/ResponsiveActionBar';
import {
  useGetMessageDetailsQuery,
  type MessageDetails,
  type MessageListItem,
} from '@/store/api/messagesApi';
import EmailHtmlPreview from './EmailHtmlPreview';
import MessageAttachments from './MessageAttachments';

interface MessagePreviewPaneProps {
  message: MessageListItem | null;
  canManage: boolean;
  canSend: boolean;
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
  canSend,
  onClose,
  onOpenInNewWindow,
  onReply,
  onForward,
  onAssign,
  onCreateInquiry,
  onCreateTask,
  onDelete,
}: MessagePreviewPaneProps) {
  const previewable = Boolean(message && message.type !== 'draft');
  const { currentData: details, isFetching, error, refetch } = useGetMessageDetailsQuery(
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

  if (isFetching && !details) {
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
                {formatSystemSubject(details.subject)}
              </h2>
              {details.type === 'contact_form' && <InquiryTypeBadges title={details.subject} details={details.originalData} />}
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
                ...(canSend && canActOnInbound
                  ? [
                      {
                        label: 'Odpowiedz',
                        onClick: () => onReply(details),
                        icon: <Reply className="h-4 w-4" />,
                        variant: 'primary' as const,
                        pin: true,
                      },
                    ] : []),
                ...(canManage && canActOnInbound ? [
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
                ...(canSend && details.type === 'received'
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
              title={`Wiadomość: ${formatSystemSubject(details.subject)}`}
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

      <div className="shrink-0 px-4 pb-2 empty:hidden sm:px-6 sm:pr-20">
        <MessageAttachments message={details} onRetry={() => { void refetch(); }} />
      </div>
    </section>
  );
}
