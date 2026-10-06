'use client';

import { formatSystemSubject } from '@/lib/ui/systemLabels';
import InquiryTypeBadges from '@/components/crm/inquiries/InquiryTypeBadges';

import { useRouter, useSearchParams } from 'next/navigation';
import {
  useGetMessageDetailsQuery,
  useGetEmailAccountsQuery,
  useMarkMessageAsReadMutation,
  useToggleStarMessageMutation,
  useDeleteMessageMutation,
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
  BrainCircuit,
  UserRound,
  Building2,
  ListTodo,
  ListPlus,
  History,
  UserPlus,
  MailOpen,
  MailCheck,
} from 'lucide-react';
import ResponsiveActionBar from '@/components/crm/ResponsiveActionBar';
import { useState, useEffect } from 'react';
import ComposeEmailModal from '@/components/crm/ComposeEmailModal';
import AssignMessageModal from '@/components/crm/AssignMessageModal';
import CreateInquiryFromMessageModal from '@/components/crm/CreateInquiryFromMessageModal';
import CreateTaskFromMessageModal from '@/components/crm/CreateTaskFromMessageModal';
import { supabase } from '@/lib/supabase/browser';
import { useDialog } from '@/contexts/DialogContext';
import EmailHtmlPreview from '../components/EmailHtmlPreview';
import MessageAttachments from '../components/MessageAttachments';
import { dispatchCrmEmail, formatScheduledEmailDate } from '@/lib/emailScheduling';

interface PageProps {
  params: { id: string };
}

interface EmailAiContext {
  status: 'pending' | 'processing' | 'classified' | 'skipped_continuation' | 'manual_review' | 'failed';
  intent: string | null;
  is_sales_opportunity: boolean | null;
  confidence: number | null;
  summary: string | null;
  reasoning: string | null;
  extracted_data: Record<string, unknown> | null;
  conversation: {
    id: string;
    participant_email: string;
    status: string;
    is_market_research: boolean;
    outcome_reason: string | null;
    contact: { id: string; first_name: string; last_name: string; email: string | null } | null;
    organization: { id: string; name: string } | null;
    inquiry: { id: string; title: string; inquiry_stage: string | null; lost_reason: string | null } | null;
  } | null;
}

export default function MessageDetailPage({ params }: PageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const { employee, canManageModule, canCreateInModule, sessionUserId } = useCurrentEmployee();
  const canManage = canManageModule('messages');
  const canCreateTasks = canCreateInModule('tasks');

  const [messageType] = useState<'contact_form' | 'sent' | 'received'>(
    (searchParams.get('type') as 'contact_form' | 'sent' | 'received') || 'received',
  );
  const [showReplyModal, setShowReplyModal] = useState(false);
  const [showForwardModal, setShowForwardModal] = useState(false);
  const [aiContext, setAiContext] = useState<EmailAiContext | null>(null);
  const [previousConversationCount, setPreviousConversationCount] = useState(0);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showCreateInquiryModal, setShowCreateInquiryModal] = useState(false);
  const [showCreateTaskModal, setShowCreateTaskModal] = useState(false);
  const [linkedInquiryId, setLinkedInquiryId] = useState<string | null>(null);
  const { data: emailAccountsData } = useGetEmailAccountsQuery();
  const selectableEmailAccounts = (emailAccountsData?.accounts || []).filter(
    (account) => account.can_send === true,
  );

  const {
    data: message,
    isLoading,
    error,
    refetch: refetchMessage,
  } = useGetMessageDetailsQuery({
    id: params.id,
    type: messageType,
  });

  const [markAsRead] = useMarkMessageAsReadMutation();
  const [toggleStar] = useToggleStarMessageMutation();
  const [deleteMessage] = useDeleteMessageMutation();

  useEffect(() => {
    if (
      message &&
      !message.isRead &&
      (message.type === 'contact_form' || message.type === 'received')
    ) {
      markAsRead({ id: message.id, type: message.type as 'contact_form' | 'received' });
    }
  }, [message, markAsRead]);

  useEffect(() => {
    if (!message || (message.type !== 'contact_form' && message.type !== 'received')) {
      setLinkedInquiryId(null);
      return;
    }

    let active = true;
    supabase
      .from('tasks')
      .select('id')
      .eq('is_inquiry', true)
      .contains('inquiry_details', {
        source_message_id: message.id,
        source_message_type: message.type,
      })
      .limit(1)
      .maybeSingle()
      .then(({ data, error: inquiryError }) => {
        if (!active) return;
        if (inquiryError) {
          console.error('Error finding inquiry linked to message:', inquiryError);
          return;
        }
        setLinkedInquiryId(data?.id || null);
      });

    return () => {
      active = false;
    };
  }, [message]);

  useEffect(() => {
    let active = true;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;

    const loadAiContext = async () => {
      if (!message || message.type !== 'received') {
        setAiContext(null);
        setPreviousConversationCount(0);
        return;
      }

      const { data, error: qualificationError } = await supabase
        .from('email_ai_qualifications')
        .select(
          `
          status,
          intent,
          is_sales_opportunity,
          confidence,
          summary,
          reasoning,
          extracted_data,
          conversation:email_sales_conversations(
            id,
            participant_email,
            status,
            is_market_research,
            outcome_reason,
            contact:contacts(id, first_name, last_name, email),
            organization:organizations(id, name),
            inquiry:tasks(id, title, inquiry_stage, lost_reason)
          )
        `,
        )
        .eq('received_email_id', message.id)
        .maybeSingle();

      if (!active) return;
      if (qualificationError) {
        console.error('Error fetching AI email context:', qualificationError);
        return;
      }

      const context = data as unknown as EmailAiContext | null;
      setAiContext(context);

      if (!context || context.status === 'pending' || context.status === 'processing') {
        refreshTimer = setTimeout(loadAiContext, 8000);
      }

      if (context?.conversation?.participant_email && message.email_account_id) {
        const { count } = await supabase
          .from('email_sales_conversations')
          .select('id', { count: 'exact', head: true })
          .eq('email_account_id', message.email_account_id)
          .ilike('participant_email', context.conversation.participant_email);

        if (active) setPreviousConversationCount(Math.max((count || 1) - 1, 0));
      }
    };

    loadAiContext();
    return () => {
      active = false;
      if (refreshTimer) clearTimeout(refreshTimer);
    };
  }, [message]);

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

    const confirmed = await showConfirm({
      title: 'Przenieś wiadomość do kosza',
      message: 'Wiadomość będzie można później przywrócić z kosza.',
      confirmText: 'Przenieś do kosza',
      cancelText: 'Anuluj',
    });
    if (!confirmed) return;

    try {
      await deleteMessage({ id: message.id, type: message.type }).unwrap();

      showSnackbar('Wiadomość została przeniesiona do kosza', 'success');
      router.push('/crm/messages');
    } catch (error) {
      console.error('Error deleting message:', error);
      showSnackbar('Błąd podczas usuwania wiadomości', 'error');
    }
  };

  const handleToggleRead = async () => {
    if (!message || (message.type !== 'contact_form' && message.type !== 'received')) return;

    try {
      await markAsRead({
        id: message.id,
        type: message.type,
        isRead: !message.isRead,
      }).unwrap();
      showSnackbar(
        message.isRead ? 'Oznaczono jako nieprzeczytaną' : 'Oznaczono jako przeczytaną',
        'success',
      );
    } catch (error) {
      console.error('Error changing message read state:', error);
      showSnackbar('Nie udało się zmienić stanu wiadomości', 'error');
    }
  };

  const handleSendReply = async (data: {
    to: string;
    subject: string;
    body: string;
    bodyHtml: string;
    attachments?: File[];
    fromAccountId?: string;
    cc?: string;
    bcc?: string;
    scheduledAt?: string | null;
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

      const originalMessageId =
        message?.type === 'received' ? message.originalData?.message_id || null : null;
      const rawReferences = message?.originalData?.raw_headers?.references;
      const parsedReferences = Array.isArray(rawReferences)
        ? rawReferences.map(String)
        : typeof rawReferences === 'string'
          ? rawReferences.match(/<[^>]+>/g) || rawReferences.split(/\s+/).filter(Boolean)
          : [];
      const references = originalMessageId
        ? Array.from(new Set([...parsedReferences, originalMessageId]))
        : parsedReferences;

      const result = await dispatchCrmEmail({
        accessToken: session.access_token,
        functionName: 'send-email',
        scheduledAt: data.scheduledAt,
        metadata: {
          entityType: 'message',
          entityId: message?.id,
          actionUrl: message?.id ? `/crm/messages/${message.id}` : '/crm/messages',
        },
        payload: {
          emailAccountId: data.fromAccountId || message?.email_account_id,
          to: data.to,
          cc: data.cc,
          bcc: data.bcc,
          subject: data.subject,
          body: data.bodyHtml,
          attachments: attachmentsBase64,
          messageId: message?.type === 'contact_form' ? message.id : undefined,
          inReplyTo: showReplyModal ? originalMessageId : undefined,
          references: showReplyModal && references.length > 0 ? references : undefined,
        },
      });

      if (result.success) {
        showSnackbar(
          result.scheduled && result.scheduledAt
            ? `Wiadomość zostanie wysłana ${formatScheduledEmailDate(result.scheduledAt)}`
            : 'Wiadomość wysłana!',
          'success',
        );
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
      <div className="flex h-full min-h-0 items-center justify-center bg-[#0f1119]">
        <div className="text-center">
          <Mail className="mx-auto mb-4 h-16 w-16 animate-pulse text-[#e5e4e2]/20" />
          <p className="text-[#e5e4e2]/60">Ładowanie wiadomości...</p>
        </div>
      </div>
    );
  }

  if (error || !message) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center bg-[#0f1119]">
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

  const aiStatus = aiContext
    ? {
        pending: { label: 'Oczekuje na analizę AI', className: 'border-sky-400/30 bg-sky-400/10 text-sky-200' },
        processing: { label: 'Analiza AI w toku', className: 'border-sky-400/30 bg-sky-400/10 text-sky-200' },
        classified: aiContext.is_sales_opportunity
          ? { label: 'Potencjalne zapytanie', className: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200' }
          : { label: 'Wiadomość niesprzedażowa', className: 'border-slate-400/30 bg-slate-400/10 text-slate-200' },
        skipped_continuation: { label: 'Kontynuacja korespondencji', className: 'border-violet-400/30 bg-violet-400/10 text-violet-200' },
        manual_review: { label: 'Wymaga weryfikacji', className: 'border-amber-400/30 bg-amber-400/10 text-amber-100' },
        failed: { label: 'Analiza nieudana', className: 'border-red-400/30 bg-red-400/10 text-red-200' },
      }[aiContext.status]
    : null;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#0f1119]">
      <div className="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col p-3 sm:p-6">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] shadow-xl">
          <div className="shrink-0 border-b border-[#d3bb73]/20 p-3 sm:p-6">
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
                  ...((message.type === 'contact_form' ? selectableEmailAccounts.length > 0 : selectableEmailAccounts.some(account => account.id === message.email_account_id)) && (message.type === 'contact_form' || message.type === 'received')
                    ? [
                        {
                          label: 'Odpowiedz',
                          onClick: () => setShowReplyModal(true),
                          icon: <Reply className="h-4 w-4" />,
                          variant: 'primary' as const,
                          show: true,
                          pin: true,
                        },
                      ]
                    : []),
                  ...(canManage && (message.type === 'contact_form' || message.type === 'received')
                    ? [
                        {
                          label: linkedInquiryId ? 'Otwórz zapytanie' : 'Dodaj do zapytań',
                          onClick: () =>
                            linkedInquiryId
                              ? router.push(`/crm/inquiries/${linkedInquiryId}`)
                              : setShowCreateInquiryModal(true),
                          icon: <ListTodo className="h-4 w-4" />,
                          variant: 'default' as const,
                          show: true,
                          pin: true,
                        },
                        {
                          label: 'Przypisz',
                          onClick: () => setShowAssignModal(true),
                          icon: <UserPlus className="h-4 w-4" />,
                          variant: 'default' as const,
                          show: true,
                          pin: true,
                        },
                      ]
                    : []),
                  ...(canCreateTasks &&
                  (message.type === 'contact_form' || message.type === 'received')
                    ? [
                        {
                          label: 'Utwórz zadanie',
                          onClick: () => setShowCreateTaskModal(true),
                          icon: <ListPlus className="h-4 w-4" />,
                          variant: 'default' as const,
                          show: true,
                        },
                      ]
                    : []),
                  ...(message.type === 'contact_form' || message.type === 'received'
                    ? [
                        {
                          label: message.isRead
                            ? 'Oznacz jako nieprzeczytaną'
                            : 'Oznacz jako przeczytaną',
                          onClick: handleToggleRead,
                          icon: message.isRead ? (
                            <MailOpen className="h-4 w-4" />
                          ) : (
                            <MailCheck className="h-4 w-4" />
                          ),
                          variant: 'default' as const,
                          show: true,
                        },
                      ]
                    : []),
                  ...(message.type === 'received'
                    ? [
                        {
                          label: message.isStarred ? 'Usuń oznaczenie' : 'Oznacz gwiazdką',
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
                  ...(selectableEmailAccounts.some(account => account.id === message.email_account_id) && message.type === 'received'
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
                          label: 'Przenieś do kosza',
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
                  {formatSystemSubject(message.subject)}
                </h1>
                {message.type === 'contact_form' && <div className="mb-3"><InquiryTypeBadges title={message.subject} details={message.originalData} /></div>}
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

          <div className="min-h-0 flex-1 touch-pan-y overflow-x-hidden overflow-y-auto overscroll-contain p-3 sm:p-6">
            {aiContext && aiStatus && (
              <div className="mb-4 rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] p-3 sm:mb-6 sm:p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <BrainCircuit className="h-5 w-5 text-[#d3bb73]" />
                    <h2 className="font-semibold text-white">Kontekst sprzedażowy AI</h2>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full border px-2.5 py-1 text-xs ${aiStatus.className}`}>
                      {aiStatus.label}
                    </span>
                    {aiContext.confidence !== null && (
                      <span className="rounded-full border border-[#d3bb73]/20 px-2.5 py-1 text-xs text-[#e5e4e2]/70">
                        Pewność {Math.round(aiContext.confidence * 100)}%
                      </span>
                    )}
                  </div>
                </div>

                {aiContext.summary && (
                  <p className="mt-3 text-sm leading-relaxed text-[#e5e4e2]/80">
                    {aiContext.summary}
                  </p>
                )}

                <div className="mt-3 flex flex-wrap gap-2">
                  {aiContext.conversation?.contact && (
                    <button
                      onClick={() => router.push(`/crm/contacts/${aiContext.conversation?.contact?.id}`)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-[#d3bb73]/20 px-2.5 py-1.5 text-xs text-[#e5e4e2] transition-colors hover:bg-[#d3bb73]/10"
                    >
                      <UserRound className="h-3.5 w-3.5 text-[#d3bb73]" />
                      {aiContext.conversation.contact.first_name} {aiContext.conversation.contact.last_name}
                    </button>
                  )}
                  {aiContext.conversation?.organization && (
                    <button
                      onClick={() => router.push(`/crm/contacts/${aiContext.conversation?.organization?.id}`)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-[#d3bb73]/20 px-2.5 py-1.5 text-xs text-[#e5e4e2] transition-colors hover:bg-[#d3bb73]/10"
                    >
                      <Building2 className="h-3.5 w-3.5 text-[#d3bb73]" />
                      {aiContext.conversation.organization.name}
                    </button>
                  )}
                  {aiContext.conversation?.inquiry && (
                    <button
                      onClick={() => router.push(`/crm/inquiries/${aiContext.conversation?.inquiry?.id}`)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1.5 text-xs text-emerald-100 transition-colors hover:bg-emerald-400/20"
                    >
                      <ListTodo className="h-3.5 w-3.5" />
                      Otwórz zapytanie
                    </button>
                  )}
                  {aiContext.conversation && (
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-[#d3bb73]/20 px-2.5 py-1.5 text-xs text-[#e5e4e2]/70">
                      <History className="h-3.5 w-3.5 text-[#d3bb73]" />
                      {previousConversationCount > 0
                        ? `Wcześniejsze wątki: ${previousConversationCount}`
                        : 'Pierwszy rozpoznany wątek'}
                    </span>
                  )}
                </div>

                {(aiContext.conversation?.outcome_reason ||
                  aiContext.conversation?.inquiry?.lost_reason ||
                  (aiContext.extracted_data?.crm_context as { previous_lost_reason?: string | null } | undefined)?.previous_lost_reason) && (
                  <p className="mt-3 rounded-md bg-red-400/10 px-3 py-2 text-xs text-red-100">
                    Poprzedni powód utraty:{' '}
                    {aiContext.conversation?.outcome_reason ||
                      aiContext.conversation?.inquiry?.lost_reason ||
                      (aiContext.extracted_data?.crm_context as { previous_lost_reason?: string | null } | undefined)?.previous_lost_reason}
                  </p>
                )}
              </div>
            )}

            <div className="prose prose-invert prose-sm sm:prose-base max-w-none text-white">
              {message.bodyHtml && message.bodyHtml.trim() ? (
                <EmailHtmlPreview
                  html={message.bodyHtml}
                  employeeId={message.originalData?.employee_id}
                  emailAccountId={message.email_account_id}
                  title={`Wiadomość: ${formatSystemSubject(message.subject)}`}
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

            <MessageAttachments message={message} onRetry={() => { void refetchMessage(); }} />
          </div>
        </div>
      </div>

      <ComposeEmailModal
        isOpen={showReplyModal}
        onClose={() => setShowReplyModal(false)}
        onSend={handleSendReply}
        initialTo={
          message.type === 'contact_form'
            ? message.originalData.email
            : message.from.match(/<([^>]+)>/)?.[1] || message.from
        }
        initialSubject={/^re\s*:/i.test(message.subject) ? message.subject : `Re: ${formatSystemSubject(message.subject)}`}
        initialBody=""
        replyContext={{
          from: message.from,
          to: message.to,
          cc: message.originalData?.raw_headers?.cc || message.originalData?.cc || null,
          date: message.date,
          subject: message.subject,
          body: message.body,
          bodyHtml: message.bodyHtml,
          messageId: message.type === 'received' ? message.originalData?.message_id || null : null,
        }}
        selectedAccountId={message.email_account_id || ''}
        emailAccounts={selectableEmailAccounts}
      />

      <ComposeEmailModal
        isOpen={showForwardModal}
        onClose={() => setShowForwardModal(false)}
        onSend={handleSendReply}
        initialTo=""
        initialSubject={`Fwd: ${formatSystemSubject(message.subject)}`}
        forwardedBody={`\n\n--- Przekazana wiadomość ---\nOd: ${message.from}\nData: ${new Date(message.date).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' })}\nTemat: ${formatSystemSubject(message.subject)}\n\n${message.body}`}
        selectedAccountId={message.email_account_id || ''}
        emailAccounts={selectableEmailAccounts}
      />

      {showAssignModal && (message.type === 'contact_form' || message.type === 'received') && (
        <AssignMessageModal
          messageId={message.id}
          messageType={message.type}
          currentAssignee={message.assigned_to || null}
          onClose={() => setShowAssignModal(false)}
          onSuccess={() => {
            setShowAssignModal(false);
            void refetchMessage();
          }}
        />
      )}

      {showCreateInquiryModal && sessionUserId && (
        <CreateInquiryFromMessageModal
          message={message}
          userId={sessionUserId}
          onClose={() => setShowCreateInquiryModal(false)}
          onSuccess={(inquiryId) => {
            setLinkedInquiryId(inquiryId);
            setShowCreateInquiryModal(false);
            router.push(`/crm/inquiries/${inquiryId}`);
          }}
        />
      )}

      {showCreateTaskModal && (employee?.id || sessionUserId) && (
        <CreateTaskFromMessageModal
          message={message}
          inquiryId={linkedInquiryId}
          createdBy={employee?.id || sessionUserId!}
          onClose={() => setShowCreateTaskModal(false)}
          onSuccess={(taskId) => {
            setShowCreateTaskModal(false);
            router.push(`/crm/tasks/${taskId}`);
          }}
        />
      )}
    </div>
  );
}
