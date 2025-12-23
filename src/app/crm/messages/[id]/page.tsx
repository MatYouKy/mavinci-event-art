'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useGetMessageDetailsQuery, useMarkMessageAsReadMutation, useToggleStarMessageMutation } from '@/store/api/messagesApi';
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
} from 'lucide-react';
import ResponsiveActionBar from '@/components/crm/ResponsiveActionBar';
import { useState, useEffect } from 'react';
import ComposeEmailModal from '@/components/crm/ComposeEmailModal';
import { supabase } from '@/lib/supabase';

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
    (searchParams.get('type') as 'contact_form' | 'sent' | 'received') || 'received'
  );
  const [showReplyModal, setShowReplyModal] = useState(false);
  const [showForwardModal, setShowForwardModal] = useState(false);

  const { data: message, isLoading, error } = useGetMessageDetailsQuery({
    id: params.id,
    type: messageType,
  });

  const [markAsRead] = useMarkMessageAsReadMutation();
  const [toggleStar] = useToggleStarMessageMutation();

  useEffect(() => {
    if (message && !message.isRead && (message.type === 'contact_form' || message.type === 'received')) {
      markAsRead({ id: message.id, type: message.type as 'contact_form' | 'received' });
    }
  }, [message, markAsRead]);

  const handleToggleStar = async () => {
    if (!message || message.type !== 'received') return;

    try {
      await toggleStar({ id: message.id, isStarred: message.isStarred }).unwrap();
      showSnackbar(
        message.isStarred ? 'Usunięto gwiazdkę' : 'Oznaczono gwiazdką',
        'success'
      );
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
      const { data: { session } } = await supabase.auth.getSession();
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
              ''
            )
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
      <div className="min-h-screen bg-[#0f1119] flex items-center justify-center">
        <div className="text-center">
          <Mail className="w-16 h-16 text-[#e5e4e2]/20 mx-auto mb-4 animate-pulse" />
          <p className="text-[#e5e4e2]/60">Ładowanie wiadomości...</p>
        </div>
      </div>
    );
  }

  if (error || !message) {
    return (
      <div className="min-h-screen bg-[#0f1119] flex items-center justify-center">
        <div className="text-center">
          <Mail className="w-16 h-16 text-[#e5e4e2]/20 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-white mb-2">Nie znaleziono wiadomości</h2>
          <p className="text-[#e5e4e2]/60 mb-4">Wiadomość została usunięta lub nie masz do niej dostępu.</p>
          <button
            onClick={() => router.push('/crm/messages')}
            className="px-6 py-3 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#c5ad65] transition-colors"
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
      <div className="max-w-5xl mx-auto p-6">
        <div className="bg-[#1c1f33] rounded-lg shadow-xl border border-[#d3bb73]/20">
          <div className="p-6 border-b border-[#d3bb73]/20">
            <div className="flex items-center justify-between mb-6">
              <button
                onClick={() => router.push('/crm/messages')}
                className="flex items-center gap-2 text-[#e5e4e2]/70 hover:text-white transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
                Powrót do listy
              </button>

              <ResponsiveActionBar
                actions={[
                  ...(message.type === 'received' ? [{
                    label: message.isStarred ? 'Usuń gwiazdkę' : 'Oznacz gwiazdką',
                    onClick: handleToggleStar,
                    icon: message.isStarred ? (
                      <Star className="w-4 h-4 fill-[#d3bb73] text-[#d3bb73]" />
                    ) : (
                      <StarOff className="w-4 h-4" />
                    ),
                    variant: 'default' as const,
                    show: true,
                  }] : []),
                  ...(canManage && (message.type === 'contact_form' || message.type === 'received') ? [{
                    label: 'Odpowiedz',
                    onClick: () => setShowReplyModal(true),
                    icon: <Reply className="w-4 h-4" />,
                    variant: 'primary' as const,
                    show: true,
                  }] : []),
                  ...(canManage && message.type === 'received' ? [{
                    label: 'Przekaż',
                    onClick: () => setShowForwardModal(true),
                    icon: <Forward className="w-4 h-4" />,
                    variant: 'default' as const,
                    show: true,
                  }] : []),
                  ...(canManage ? [{
                    label: 'Usuń',
                    onClick: handleDelete,
                    icon: <Trash2 className="w-4 h-4" />,
                    variant: 'danger' as const,
                    show: true,
                  }] : []),
                ]}
              />
            </div>

            <div className="flex items-start justify-between mb-4">
              <div className="flex-1">
                <h1 className="text-3xl font-bold text-white mb-4">{message.subject}</h1>
                <div className="space-y-2 text-sm text-[#e5e4e2]/70">
                  <p>
                    <strong className="text-white">Od:</strong> {message.from}
                  </p>
                  <p>
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
                className={`text-xs px-3 py-1 rounded ${typeInfo.color} text-white whitespace-nowrap`}
              >
                {typeInfo.label}
              </span>
            </div>
          </div>

          <div className="p-6">
            <div className="prose prose-invert max-w-none text-white">
              {message.bodyHtml && message.bodyHtml.trim() ? (
                <div
                  dangerouslySetInnerHTML={{ __html: message.bodyHtml }}
                  className="text-[#e5e4e2] [&_img]:max-w-full [&_a]:text-[#d3bb73] [&_a]:underline"
                  style={{
                    wordWrap: 'break-word',
                    overflowWrap: 'break-word'
                  }}
                />
              ) : message.body && message.body.trim() ? (
                <p className="whitespace-pre-wrap text-[#e5e4e2]">{message.body}</p>
              ) : (
                <p className="text-[#e5e4e2]/50 italic">Brak treści wiadomości</p>
              )}
            </div>
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
