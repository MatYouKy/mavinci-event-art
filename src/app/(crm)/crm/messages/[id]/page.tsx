'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import {
  useGetMessageDetailsQuery,
  useMarkMessageAsReadMutation,
  useToggleStarMessageMutation,
} from '@/store/api/messagesApi';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { useSnackbar } from '@/contexts/SnackbarContext';
import {
  ArrowLeft,
  Mail,
  Star,
  StarOff,
  Reply,
  Forward,
  Trash2,
  Pin,
  Paperclip,
  Download,
} from 'lucide-react';
import ResponsiveActionBar from '@/components/crm/ResponsiveActionBar';
import { useState, useEffect } from 'react';
import ComposeEmailModal from '@/components/crm/ComposeEmailModal';
import { supabase } from '@/lib/supabase/browser';

interface PageProps {
  params: { id: string };
}

export default function MessageDetailPage({ params }: PageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showSnackbar } = useSnackbar();
  const { canManageModule } = useCurrentEmployee();
  const canManage = canManageModule('messages');

  const [messageType, setMessageType] = useState<'contact_form' | 'sent' | 'received'>(
    (searchParams.get('type') as 'contact_form' | 'sent' | 'received') || 'received',
  );
  const [showReplyModal, setShowReplyModal] = useState(false);
  const [showForwardModal, setShowForwardModal] = useState(false);

  const {
    data: message,
    isLoading,
    error,
  } = useGetMessageDetailsQuery({
    id: params.id,
    type: messageType,
  });

  const [markAsRead] = useMarkMessageAsReadMutation();
  const [toggleStar] = useToggleStarMessageMutation();

  useEffect(() => {
    if (
      message &&
      !message.isRead &&
      (message.type === 'contact_form' || message.type === 'received')
    ) {
      markAsRead({ id: message.id, type: message.type as 'contact_form' | 'received' });
    }
  }, [message, markAsRead]);

  const handleToggleStar = async () => {
    if (!message || message.type !== 'received') return;

    try {
      await toggleStar({ id: message.id, isStarred: message.isStarred }).unwrap();
      showSnackbar(message.isStarred ? 'Usunięto gwiazdkę' : 'Oznaczono gwiazdką', 'success');
    } catch (error) {
      console.error('Error toggling star:', error);
      showSnackbar('Błąd podczas oznaczania wiadomości', 'error');
    }
  };

  const handleDelete = async () => {
    if (!message) return;

    try {
      const tableName =
        message.type === 'contact_form'
          ? 'contact_messages'
          : message.type === 'received'
            ? 'received_emails'
            : 'sent_emails';

      await supabase.from(tableName).delete().eq('id', message.id);

      showSnackbar('Wiadomość została usunięta', 'success');
      router.push('/crm/messages');
    } catch (error) {
      console.error('Error deleting message:', error);
      showSnackbar('Błąd podczas usuwania wiadomości', 'error');
    }
  };

  const handleSendReply = async (data: {
    to: string;
    subject: string;
    body: string;
    bodyHtml: string;
    attachments?: File[];
  }) => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        showSnackbar('Musisz być zalogowany', 'error');
        return;
      }

      const attachmentsBase64 = [];
      if (data.attachments && data.attachments.length > 0) {
        for (const file of data.attachments) {
          const arrayBuffer = await file.arrayBuffer();
          const base64 = btoa(
            new Uint8Array(arrayBuffer).reduce(
              (data, byte) => data + String.fromCharCode(byte),
              '',
            ),
          );
          attachmentsBase64.push({
            filename: file.name,
            content: base64,
            contentType: file.type || 'application/octet-stream',
          });
        }
      }

      const apiUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/send-email`;

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          emailAccountId: message?.email_account_id,
          to: data.to,
          subject: data.subject,
          body: data.bodyHtml,
          attachments: attachmentsBase64,
        }),
      });

      const result = await response.json();

      if (result.success) {
        showSnackbar('Wiadomość wysłana!', 'success');
        setShowReplyModal(false);
        setShowForwardModal(false);
      } else {
        showSnackbar(`Błąd: ${result.error}`, 'error');
      }
    } catch (error) {
      console.error('Error sending message:', error);
      showSnackbar('Nie udało się wysłać wiadomości', 'error');
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0f1119]">
        <div className="text-center">
          <Mail className="mx-auto mb-4 h-16 w-16 animate-pulse text-[#e5e4e2]/20" />
          <p className="text-[#e5e4e2]/60">Ładowanie wiadomości...</p>
        </div>
      </div>
    );
  }

  if (error || !message) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0f1119]">
        <div className="text-center">
          <Mail className="mx-auto mb-4 h-16 w-16 text-[#e5e4e2]/20" />
          <h2 className="mb-2 text-2xl font-bold text-white">Nie znaleziono wiadomości</h2>
          <p className="mb-4 text-[#e5e4e2]/60">
            Wiadomość została usunięta lub nie masz do niej dostępu.
          </p>
          <button
            onClick={() => router.push('/crm/messages')}
            className="rounded-lg bg-[#d3bb73] px-6 py-3 text-[#1c1f33] transition-colors hover:bg-[#c5ad65]"
          >
            Powrót do listy wiadomości
          </button>
        </div>
      </div>
    );
  }

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'contact_form':
        return { label: 'Formularz', color: 'bg-blue-500' };
      case 'sent':
        return { label: 'Wysłane', color: 'bg-green-500' };
      case 'received':
        return { label: 'Odebrane', color: 'bg-purple-500' };
      default:
        return { label: type, color: 'bg-gray-500' };
    }
  };

  const typeInfo = getTypeLabel(message.type);

  return (
    <div className="min-h-screen bg-[#0f1119]">
      <div className="mx-auto max-w-5xl p-3 sm:p-6">
        <div className="rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] shadow-xl">
          <div className="border-b border-[#d3bb73]/20 p-3 sm:p-6">
            <div className="mb-4 flex items-center justify-between sm:mb-6">
              <button
                onClick={() => router.push('/crm/messages')}
                className="flex items-center gap-1.5 text-sm text-[#e5e4e2]/70 transition-colors hover:text-white sm:gap-2 sm:text-base"
              >
                <ArrowLeft className="h-4 w-4 sm:h-5 sm:w-5" />
                <span className="hidden sm:inline">Powrót do listy</span>
                <span className="sm:hidden">Powrót</span>
              </button>

              <ResponsiveActionBar
                actions={[
                  ...(message.type === 'received'
                    ? [
                        {
                          label: message.isStarred ? 'Usuń ' : 'Oznacz',
                          onClick: handleToggleStar,
                          icon: message.isStarred ? (
                            <Star className="h-4 w-4 fill-[#d3bb73] text-[#d3bb73]" />
                          ) : (
                            <StarOff className="h-4 w-4" />
                          ),
                          variant: 'default' as const,
                          show: true,
                        },
                      ]
                    : []),
                  ...(canManage && (message.type === 'contact_form' || message.type === 'received')
                    ? [
                        {
                          label: 'Odpowiedz',
                          onClick: () => setShowReplyModal(true),
                          icon: <Reply className="h-4 w-4" />,
                          variant: 'primary' as const,
                          show: true,
                        },
                      ]
                    : []),
                  ...(canManage && message.type === 'received'
                    ? [
                        {
                          label: 'Przekaż',
                          onClick: () => setShowForwardModal(true),
                          icon: <Forward className="h-4 w-4" />,
                          variant: 'default' as const,
                          show: true,
                        },
                      ]
                    : []),
                  ...(canManage
                    ? [
                        {
                          label: 'Usuń',
                          onClick: handleDelete,
                          icon: <Trash2 className="h-4 w-4" />,
                          variant: 'danger' as const,
                          show: true,
                        },
                      ]
                    : []),
                ]}
              />
            </div>

            <div className="mb-3 flex items-start justify-between gap-2 sm:mb-4">
              <div className="min-w-0 flex-1">
                <h1 className="mb-2 break-words text-xl font-bold text-white sm:mb-4 sm:text-3xl">
                  {message.subject}
                </h1>
                <div className="space-y-1.5 text-xs text-[#e5e4e2]/70 sm:space-y-2 sm:text-sm">
                  <p className="break-all">
                    <strong className="text-white">Od:</strong> {message.from}
                  </p>
                  <p className="break-all">
                    <strong className="text-white">Do:</strong> {message.to}
                  </p>
                  <p>
                    <strong className="text-white">Data:</strong>{' '}
                    {new Date(message.date).toLocaleString('pl-PL')}
                  </p>
                  {message.assigned_employee && (
                    <p>
                      <strong className="text-white">Przypisano:</strong>{' '}
                      {message.assigned_employee.name} {message.assigned_employee.surname}
                    </p>
                  )}
                </div>
              </div>
              <span
                className={`rounded px-2 py-0.5 text-[10px] sm:px-3 sm:py-1 sm:text-xs ${typeInfo.color} flex-shrink-0 whitespace-nowrap text-white`}
              >
                {typeInfo.label}
              </span>
            </div>
          </div>

          <div className="p-3 sm:p-6">
            <div className="prose prose-invert prose-sm sm:prose-base max-w-none text-white">
              {message.bodyHtml && message.bodyHtml.trim() ? (
                <div
                  dangerouslySetInnerHTML={{ __html: message.bodyHtml }}
                  className="text-sm text-[#e5e4e2] sm:text-base [&_a]:text-[#d3bb73] [&_a]:underline [&_img]:max-w-full"
                  style={{
                    wordWrap: 'break-word',
                    overflowWrap: 'break-word',
                  }}
                />
              ) : message.body && message.body.trim() ? (
                <p className="whitespace-pre-wrap text-sm text-[#e5e4e2] sm:text-base">
                  {message.body}
                </p>
              ) : (
                <p className="text-sm italic text-[#e5e4e2]/50 sm:text-base">
                  Brak treści wiadomości
                </p>
              )}
            </div>

            {message.attachments && message.attachments.length > 0 && (
              <div className="mt-4 border-t border-[#d3bb73]/20 pt-4 sm:mt-6 sm:pt-6">
                <div className="mb-2 flex items-center gap-1.5 sm:mb-3 sm:gap-2">
                  <Paperclip className="h-4 w-4 text-[#d3bb73] sm:h-5 sm:w-5" />
                  <h3 className="text-base font-semibold text-white sm:text-lg">
                    Załączniki ({message.attachments.length})
                  </h3>
                </div>
                <div className="space-y-1.5 sm:space-y-2">
                  {message.attachments.map((attachment) => (
                    <div
                      key={attachment.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] p-2 transition-colors hover:bg-[#d3bb73]/5 sm:p-3"
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
                        <Paperclip className="h-3 w-3 flex-shrink-0 text-[#d3bb73] sm:h-4 sm:w-4" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs text-white sm:text-sm">
                            {attachment.filename}
                          </p>
                          <p className="text-[10px] text-[#e5e4e2]/50 sm:text-xs">
                            {(attachment.size_bytes / 1024).toFixed(1)} KB
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={async () => {
                          try {
                            const { data, error } = await supabase.storage
                              .from('email-attachments')
                              .download(attachment.storage_path);

                            if (error) throw error;

                            const url = URL.createObjectURL(data);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = attachment.filename;
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                            URL.revokeObjectURL(url);
                          } catch (error) {
                            console.error('Error downloading attachment:', error);
                            showSnackbar('Błąd podczas pobierania załącznika', 'error');
                          }
                        }}
                        className="flex flex-shrink-0 items-center gap-1 rounded-lg bg-[#d3bb73]/20 px-2 py-1.5 text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/30 sm:gap-2 sm:px-3 sm:py-2"
                      >
                        <Download className="h-3 w-3 sm:h-4 sm:w-4" />
                        <span className="hidden text-xs sm:inline sm:text-sm">Pobierz</span>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <ComposeEmailModal
        isOpen={showReplyModal}
        onClose={() => setShowReplyModal(false)}
        onSend={handleSendReply}
        initialTo={message.type === 'contact_form' ? message.originalData.email : message.from}
        initialSubject={`Re: ${message.subject}`}
        initialBody={`\n\n--- Odpowiedź na wiadomość ---\n${message.body}`}
        selectedAccountId={message.email_account_id || ''}
      />

      <ComposeEmailModal
        isOpen={showForwardModal}
        onClose={() => setShowForwardModal(false)}
        onSend={handleSendReply}
        initialTo=""
        initialSubject={`Fwd: ${message.subject}`}
        forwardedBody={`\n\n--- Przekazana wiadomość ---\nOd: ${message.from}\nData: ${new Date(message.date).toLocaleString('pl-PL')}\nTemat: ${message.subject}\n\n${message.body}`}
        selectedAccountId={message.email_account_id || ''}
      />
    </div>
  );
}
