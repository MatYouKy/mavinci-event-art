'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/browser';
import {
  Mail,
  RefreshCw,
  Search,
  Plus,
  Inbox,
  Loader2,
  Calendar,
  X,
  SlidersHorizontal,
} from 'lucide-react';
import ComposeEmailModal from '@/components/crm/ComposeEmailModal';
import MessageActionsMenu from '@/components/crm/MessageActionsMenu';
import AssignMessageModal from '@/components/crm/AssignMessageModal';
import CreateInquiryFromMessageModal from '@/components/crm/CreateInquiryFromMessageModal';
import CreateTaskFromMessageModal from '@/components/crm/CreateTaskFromMessageModal';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import {
  useGetMessagesListQuery,
  useLazyGetMessageDetailsQuery,
  useMarkMessageAsReadMutation,
  useDeleteMessageMutation,
  useToggleStarMessageMutation,
  useLazySearchMessagesQuery,
  useGetEmailAccountsQuery,
  useGetUnreadCountsByAccountQuery,
  type MessageFolder,
  type MessageListItem,
  type MessageDetails,
  type MessageType,
} from '@/store/api/messagesApi';
import ResponsiveActionBar from '@/components/crm/ResponsiveActionBar';
import { MessageMobileFilteredModal } from './components/MessageMobileFilteredModal';
import { MobileSearchModal } from './components/MobileSearchModal';
import { MessagesSidebar } from './components/MessagesSidebar';
import { MessagePreviewPane } from './components/MessagePreviewPane';
import { revalidateMessages } from './actions';
import {
  readMessageListCache,
  writeMessageListCache,
} from '@/lib/CRM/messages/messageListCache';

const translateSubject = (subject: string): string => {
  if (!subject) return 'Wiadomość z formularza';
  return subject
    .replace(/^event_inquiry\s*-\s*/i, 'Zapytanie o event - ')
    .replace(/^team_join\s*-\s*/i, 'Rekrutacja - ')
    .replace(/^general\s*-\s*/i, 'Ogólna - ');
};

const extractReplyAddress = (message: MessageDetails | null) => {
  if (!message) return '';
  const original = message.originalData || {};
  const candidate =
    (message.type === 'contact_form' ? original.email : original.reply_to || original.from_address) ||
    message.from;
  const bracketAddress = String(candidate).match(/<([^>]+)>/);
  return (bracketAddress?.[1] || candidate || '').trim();
};

const replySubject = (subject: string) =>
  /^re\s*:/i.test(subject || '') ? subject : `Re: ${subject || '(bez tematu)'}`;

interface MessagesPageClientProps {
  userId: string;
  hasContactFormAccess: boolean;
  canManage: boolean;
  canView: boolean;
}

export default function MessagesPageClient({
  userId,
  hasContactFormAccess: initialHasContactFormAccess,
  canManage: initialCanManage,
  canView: initialCanView,
}: MessagesPageClientProps) {
  const router = useRouter();
  const { employee: currentEmployee, canCreateInModule } = useCurrentEmployee();
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const canManage = initialCanManage;
  const canView = initialCanView;

  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Load email accounts using RTK Query
  const {
    data: accountsData,
    isLoading: isLoadingAccounts,
    isError: isAccountsError,
  } = useGetEmailAccountsQuery();

  const emailAccounts = accountsData?.accounts || [];
  const hasContactFormAccess = accountsData?.hasContactFormAccess ?? initialHasContactFormAccess;

  const [selectedAccount, setSelectedAccount] = useState<string>('');
  const [showNewMessageModal, setShowNewMessageModal] = useState(false);
  const [filterType, setFilterType] = useState<MessageFolder>('all');
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [messageToAssign, setMessageToAssign] = useState<{
    id: string;
    type: 'contact_form' | 'received';
    assignedTo: string | null;
  } | null>(null);
  const [replyToMessage, setReplyToMessage] = useState<any>(null);

  const [forwardMessage, setForwardMessage] = useState<any>(null);
  const [offset, setOffset] = useState(0);
  const [allMessages, setAllMessages] = useState<MessageListItem[]>([]);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [showAdvancedSearch, setShowAdvancedSearch] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [isSearchMode, setIsSearchMode] = useState(false);
  const [showMobileSearch, setShowMobileSearch] = useState(false);
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [cacheRestoreVersion, setCacheRestoreVersion] = useState(0);
  const pageSize = 50;
  const observerTarget = useRef<HTMLDivElement>(null);
  const serverDataAppliedKeyRef = useRef<string | null>(null);

  const mailboxCacheKey = `${userId}:${selectedAccount}:${filterType}`;

  const {
    currentData: messagesData,
    isLoading,
    isFetching,
    refetch,
    isSuccess,
  } = useGetMessagesListQuery(
    {
      emailAccountId: selectedAccount,
      offset,
      limit: pageSize,
      filterType,
    },
    {
      skip: !selectedAccount || emailAccounts.length === 0 || isSearchMode,
      refetchOnMountOrArgChange: false,
    },
  );

  const [triggerSearch, { data: searchData, isLoading: isSearching }] =
    useLazySearchMessagesQuery();

  const [markAsRead] = useMarkMessageAsReadMutation();
  const [deleteMessage] = useDeleteMessageMutation();
  const [toggleStar] = useToggleStarMessageMutation();
  const [getMessageDetails] = useLazyGetMessageDetailsQuery();
  const { data: unreadCounts, refetch: refetchUnreadCounts } =
    useGetUnreadCountsByAccountQuery(undefined, {
      pollingInterval: 60000,
      refetchOnMountOrArgChange: true,
    });

  const handleAdvancedSearch = async () => {
    if (!searchQuery.trim()) {
      showSnackbar('Wprowadź frazę do wyszukania', 'warning');
      return;
    }

    setIsSearchMode(true);
    setAllMessages([]);

    try {
      const result = await triggerSearch({
        emailAccountId: selectedAccount,
        query: searchQuery,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        filterType: filterType as any,
      }).unwrap();

      setAllMessages(result.messages);
      showSnackbar(`Znaleziono ${result.total} wiadomości`, 'success');
    } catch (error) {
      console.error('Search error:', error);
      showSnackbar('Błąd podczas wyszukiwania', 'error');
    }
  };

  const handleClearSearch = () => {
    setIsSearchMode(false);
    setSearchQuery('');
    setDateFrom('');
    setDateTo('');
    setShowAdvancedSearch(false);
    setOffset(0);
    setAllMessages([]);
    setSelectedMessageId(null);
    setCacheRestoreVersion((version) => version + 1);
  };

  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refetchDebounced = useCallback(() => {
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(() => {
      refetch();
    }, 250);
  }, [refetch]);

  // Set selectedAccount when accounts are loaded
  useEffect(() => {
    if (emailAccounts.length > 0 && !selectedAccount) {
      setSelectedAccount(emailAccounts[0].id);
    }
  }, [emailAccounts, selectedAccount]);

  useEffect(() => {
    if (messagesData?.messages && !isSearchMode) {
      serverDataAppliedKeyRef.current = mailboxCacheKey;
      if (offset === 0) {
        setAllMessages((previous) => {
          const merged = Array.from(
            new Map(
              [...messagesData.messages, ...previous].map((message) => [
                `${message.type}:${message.id}`,
                message,
              ] as const),
            ).values(),
          ).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

          void writeMessageListCache(userId, selectedAccount, filterType, merged);
          return merged;
        });
      } else {
        setAllMessages((prev: MessageListItem[]) => {
          const merged = Array.from(
            new Map(
              [...prev, ...messagesData.messages].map((message) => [
                `${message.type}:${message.id}`,
                message,
              ] as const),
            ).values(),
          ).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

          void writeMessageListCache(userId, selectedAccount, filterType, merged);
          return merged;
        });
      }
      setIsLoadingMore(false);
    }
  }, [filterType, isSearchMode, mailboxCacheKey, messagesData, offset, selectedAccount, userId]);

  useEffect(() => {
    let active = true;
    const currentServerMessages = messagesData?.messages;
    serverDataAppliedKeyRef.current = currentServerMessages ? mailboxCacheKey : null;
    setOffset(0);
    setSelectedMessageId(null);
    setAllMessages([]);

    if (!selectedAccount) return () => undefined;

    if (currentServerMessages) {
      setAllMessages(currentServerMessages);
      void writeMessageListCache(userId, selectedAccount, filterType, currentServerMessages);
      return () => {
        active = false;
      };
    }

    void readMessageListCache(userId, selectedAccount, filterType).then((cachedMessages) => {
      if (
        active &&
        serverDataAppliedKeyRef.current !== mailboxCacheKey &&
        cachedMessages.length > 0
      ) {
        setAllMessages(cachedMessages);
      }
    });

    return () => {
      active = false;
    };
  }, [cacheRestoreVersion, filterType, mailboxCacheKey, selectedAccount, userId]);

  const loadMore = useCallback(() => {
    if (!isLoading && !isLoadingMore && messagesData?.hasMore && !isFetching) {
      setIsLoadingMore(true);
      setOffset((previousOffset) =>
        previousOffset === 0
          ? Math.max(pageSize, Math.floor(allMessages.length / pageSize) * pageSize)
          : previousOffset + pageSize,
      );
    }
  }, [allMessages.length, isLoading, isLoadingMore, messagesData?.hasMore, isFetching, pageSize]);

  // Email accounts are now loaded from server-side props

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadMore();
        }
      },
      { threshold: 0.1 },
    );

    const currentTarget = observerTarget.current;
    if (currentTarget) {
      observer.observe(currentTarget);
    }

    return () => {
      if (currentTarget) {
        observer.unobserve(currentTarget);
      }
    };
  }, [loadMore]);

  useEffect(() => {
    if (emailAccounts.length > 0) {
      setOffset(0);
    }
  }, [selectedAccount, emailAccounts]);

  useEffect(() => {
    if (!currentEmployee || emailAccounts.length === 0) return;

    const channels: any[] = [];

    // Contact form tylko jeśli ma dostęp (albo manage)
    if (hasContactFormAccess || canManage) {
      channels.push(
        supabase
          .channel('contact_messages_changes')
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'contact_messages' },
            () => {
              refetchDebounced();
              void refetchUnreadCounts();
            },
          )
          .subscribe(),
      );
    }

    // Sent/Received zawsze (bo to “poczta”)
    channels.push(
      supabase
        .channel('sent_emails_changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'sent_emails' }, () => {
          if (selectedAccount !== 'contact_form') refetchDebounced();
        })
        .subscribe(),
    );

    channels.push(
      supabase
        .channel('received_emails_changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'received_emails' }, () => {
          if (selectedAccount !== 'contact_form') refetchDebounced();
          void refetchUnreadCounts();
        })
        .subscribe(),
    );

    return () => {
      channels.forEach((ch) => supabase.removeChannel(ch));
    };
  }, [
    currentEmployee,
    emailAccounts.length,
    selectedAccount,
    refetchDebounced,
    hasContactFormAccess,
    canManage,
    refetchUnreadCounts,
  ]);

  const openMessageInNewWindow = (message: MessageListItem) => {
    window.open(
      `/crm/messages/${message.id}?type=${message.type}`,
      '_blank',
      'noopener,noreferrer',
    );
  };

  const handleMessageClick = async (
    messageId: string,
    messageType: MessageType,
    isRead: boolean,
  ) => {
    setSelectedMessageId(messageId);

    if (!isRead && (messageType === 'contact_form' || messageType === 'received')) {
      // Natychmiastowy feedback. Błąd zewnętrznego IMAP nie powinien
      // przywracać wiadomości do stanu nieprzeczytanego w CRM.
      setAllMessages((previous) => {
        const next = previous.map((message) =>
          message.id === messageId ? { ...message, isRead: true } : message,
        );
        if (!isSearchMode) {
          void writeMessageListCache(userId, selectedAccount, filterType, next);
        }
        return next;
      });

      try {
        await markAsRead({ id: messageId, type: messageType }).unwrap();
      } catch (error) {
        console.error('Error marking message as read:', error);
        showSnackbar('Wiadomość odczytana w CRM; synchronizacja poczty zostanie ponowiona', 'warning');
      }
    }
  };

  const loadCompleteMessage = async (message: MessageListItem | MessageDetails) => {
    if ('body' in message && 'originalData' in message) return message as MessageDetails;
    if (message.type === 'draft') throw new Error('Draft cannot be used as reply context');
    return getMessageDetails({ id: message.id, type: message.type }).unwrap();
  };

  const handleReply = async (message: MessageListItem | MessageDetails) => {
    try {
      const completeMessage = await loadCompleteMessage(message);
      setReplyToMessage(completeMessage);
      setForwardMessage(null);
      setShowNewMessageModal(true);
    } catch (error) {
      console.error('Error loading reply context:', error);
      showSnackbar('Nie udało się pobrać pełnej treści wiadomości', 'error');
    }
  };

  const handleForward = async (message: MessageListItem | MessageDetails) => {
    try {
      const completeMessage = await loadCompleteMessage(message);
      setForwardMessage(completeMessage);
      setReplyToMessage(null);
      setShowNewMessageModal(true);
    } catch (error) {
      console.error('Error loading forward context:', error);
      showSnackbar('Nie udało się pobrać pełnej treści wiadomości', 'error');
    }
  };

  const handleStar = async (messageId: string, isStarred: boolean) => {
    try {
      await toggleStar({ id: messageId, isStarred }).unwrap();
      showSnackbar(isStarred ? 'Usunięto gwiazdkę' : 'Oznaczono gwiazdką', 'success');
    } catch (error) {
      console.error('Error toggling star:', error);
      showSnackbar('Błąd podczas oznaczania wiadomości', 'error');
    }
  };

  const handleArchive = async (message: any) => {
    showSnackbar('Funkcja archiwizacji będzie wkrótce dostępna', 'info');
  };

  const handleAssign = (
    messageId: string,
    messageType: 'contact_form' | 'received',
    assignedTo: string | null,
  ) => {
    setMessageToAssign({ id: messageId, type: messageType, assignedTo });
    setShowAssignModal(true);
  };

  const handleDelete = async (messageId: string, messageType: string) => {
    const confirmed = await showConfirm({
      title: 'Usuń wiadomość',
      message: 'Czy na pewno chcesz usunąć tę wiadomość? Ta operacja jest nieodwracalna.',
      confirmText: 'Usuń',
      cancelText: 'Anuluj',
    });

    if (!confirmed) return;

    try {
      await deleteMessage({ id: messageId, type: messageType as any }).unwrap();
      setAllMessages((previous) => {
        const next = previous.filter(
          (message) => !(message.id === messageId && message.type === messageType),
        );
        if (!isSearchMode) {
          void writeMessageListCache(userId, selectedAccount, filterType, next);
        }
        return next;
      });
      showSnackbar('Wiadomość została usunięta', 'success');
      if (selectedMessageId === messageId) {
        setSelectedMessageId(null);
      }
    } catch (error) {
      console.error('Error deleting message:', error);
      showSnackbar('Błąd podczas usuwania wiadomości', 'error');
    }
  };

  const handleMove = async (messageId: string) => {
    showSnackbar('Funkcja przenoszenia będzie wkrótce dostępna', 'info');
  };

  const [inquiryMessage, setInquiryMessage] = useState<MessageListItem | null>(null);
  const [taskMessage, setTaskMessage] = useState<MessageDetails | null>(null);
  const canCreateTasks = canCreateInModule('tasks');

  const handleCreateInquiry = (message: MessageListItem) => {
    setInquiryMessage(message);
  };

  const handleCreateTask = async (message: MessageListItem | MessageDetails) => {
    try {
      const completeMessage = await loadCompleteMessage(message);
      setTaskMessage(completeMessage);
    } catch (error) {
      console.error('Error loading message task context:', error);
      showSnackbar('Nie udało się pobrać treści wiadomości do zadania', 'error');
    }
  };

  const fetchEmailsFromServer = async () => {
    if (!currentEmployee) {
      showSnackbar('Musisz być zalogowany', 'error');
      return;
    }

    if (selectedAccount === 'all' || selectedAccount === 'contact_form') {
      showSnackbar('Wybierz konkretne konto email', 'warning');
      return;
    }

    try {
      showSnackbar('Pobieranie wiadomości z serwera...', 'info');

      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;

      const apiUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/fetch-emails`;

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          emailAccountId: selectedAccount,
        }),
      });

      const result = await response.json();

      if (result.success) {
        showSnackbar(`Pobrano ${result.count || 0} nowych wiadomości`, 'success');
        await revalidateMessages();
        refetchDebounced();
        router.refresh();
      } else {
        showSnackbar(`Błąd: ${result.error}`, 'error');
      }
    } catch (error) {
      console.error('Error fetching emails:', error);
      showSnackbar('Nie udało się pobrać wiadomości', 'error');
    }
  };

  const handleSendNewMessage = async (data: {
    to: string;
    subject: string;
    body: string;
    bodyHtml: string;
    attachments?: File[];
    fromAccountId?: string;
    cc?: string;
    bcc?: string;
  }) => {
    const accountToUse = data.fromAccountId || selectedAccount;

    if (!accountToUse || accountToUse === 'all' || accountToUse === 'contact_form') {
      showSnackbar('Wybierz konto email do wysłania', 'warning');
      return;
    }

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
          try {
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
          } catch (err) {
            console.error('Error converting attachment:', err);
            showSnackbar(`Błąd konwersji załącznika: ${file.name}`, 'warning');
          }
        }
      }

      const apiUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/send-email`;
      let inReplyTo: string | undefined;
      let references: string[] | undefined;
      if (replyToMessage?.type === 'received') {
        const { data: original } = await supabase
          .from('received_emails')
          .select('message_id, raw_headers')
          .eq('id', replyToMessage.id)
          .maybeSingle();
        inReplyTo = original?.message_id || undefined;
        const rawReferences = original?.raw_headers?.references;
        const parsedReferences = Array.isArray(rawReferences)
          ? rawReferences.map(String)
          : typeof rawReferences === 'string'
            ? rawReferences.match(/<[^>]+>/g) || rawReferences.split(/\s+/).filter(Boolean)
            : [];
        references = inReplyTo
          ? Array.from(new Set([...parsedReferences, inReplyTo]))
          : parsedReferences;
      }

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          emailAccountId: accountToUse,
          to: data.to,
          cc: data.cc,
          bcc: data.bcc,
          subject: data.subject,
          body: data.bodyHtml,
          attachments: attachmentsBase64,
          messageId: replyToMessage?.type === 'contact_form' ? replyToMessage.id : undefined,
          inReplyTo,
          references,
        }),
      });

      const result = await response.json();

      if (result.success) {
        showSnackbar('Wiadomość wysłana!', 'success');
        setShowNewMessageModal(false);
        setReplyToMessage(null);
        setForwardMessage(null);
        await revalidateMessages();
        refetchDebounced();
        router.refresh();
      } else {
        showSnackbar(`Błąd: ${result.error}`, 'error');
      }
    } catch (error) {
      console.error('Error sending message:', error);
      showSnackbar('Nie udało się wysłać wiadomości', 'error');
    }
  };

  const filteredMessages = useMemo(() => {
    if (!searchQuery) return allMessages;

    const query = searchQuery.toLowerCase();
    return allMessages.filter((msg) => {
      return (
        (msg.from || '').toLowerCase().includes(query) ||
        (msg.subject || '').toLowerCase().includes(query) ||
        (msg.preview || '').toLowerCase().includes(query)
      );
    });
  }, [allMessages, searchQuery]);

  const selectedMessage = useMemo(
    () => allMessages.find((message) => message.id === selectedMessageId) || null,
    [allMessages, selectedMessageId],
  );

  const formatDate = (date: string) => {
    const messageDate = new Date(date);
    const now = new Date();
    const diff = now.getTime() - messageDate.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const time = messageDate.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });

    if (days === 0) {
      return time;
    } else if (days === 1) {
      return `wczoraj o ${time}`;
    } else if (days === 2) {
      return `przedwczoraj o ${time}`;
    } else if (days < 7) {
      return `${days} dni temu`;
    } else {
      return messageDate.toLocaleDateString('pl-PL');
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'contact_form':
        return { label: 'Formularz', color: 'bg-blue-500' };
      case 'sent':
        return { label: 'Wysłane', color: 'bg-green-500' };
      case 'received':
        return { label: 'Odebrane', color: 'bg-purple-500' };
      case 'draft':
        return { label: 'Wersja robocza', color: 'bg-yellow-500' };
      default:
        return { label: type, color: 'bg-gray-500' };
    }
  };

  if (!canView && !canManage) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0f1119]">
        <div className="text-center">
          <Mail className="mx-auto mb-4 h-16 w-16 text-[#e5e4e2]/20" />
          <h2 className="mb-2 text-2xl font-bold text-white">Brak dostępu</h2>
          <p className="text-[#e5e4e2]/60">Nie masz uprawnień do przeglądania wiadomości.</p>
        </div>
      </div>
    );
  }

  if (isLoadingAccounts) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0f1119]">
        <div className="text-center">
          <Loader2 className="mx-auto mb-4 h-16 w-16 animate-spin text-[#d3bb73]" />
          <p className="text-[#e5e4e2]/60">Ładowanie kont email...</p>
        </div>
      </div>
    );
  }

  if (emailAccounts.length === 0 && currentEmployee) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0f1119]">
        <div className="mx-auto max-w-md p-6 text-center">
          <Mail className="mx-auto mb-4 h-16 w-16 text-[#e5e4e2]/20" />
          <h2 className="mb-2 text-2xl font-bold text-white">Brak kont email</h2>
          <p className="mb-4 text-[#e5e4e2]/60">
            {canManage
              ? 'Nie masz jeszcze skonfigurowanych kont email. Przejdź do ustawień pracownika, aby dodać konto.'
              : 'Nie masz skonfigurowanych kont email. Skontaktuj się z administratorem, aby uzyskać dostęp do poczty.'}
          </p>
          {canManage && (
            <button
              onClick={() => (window.location.href = `/crm/employees/${currentEmployee.id}`)}
              className="rounded-lg bg-[#d3bb73] px-6 py-3 text-[#1c1f33] transition-colors hover:bg-[#c5ad65]"
            >
              Przejdź do ustawień
            </button>
          )}
        </div>
      </div>
    );
  }

  // Show loader while loading accounts
  if (isLoadingAccounts) {
    return (
      <div className="flex min-h-[600px] items-center justify-center">
        <div className="text-center">
          <Loader2 className="mx-auto h-12 w-12 animate-spin text-[#d3bb73]" />
          <p className="mt-4 text-[#e5e4e2]/60">Ładowanie kont email...</p>
        </div>
      </div>
    );
  }

  // Show error if accounts failed to load
  if (isAccountsError) {
    return (
      <div className="flex min-h-[600px] items-center justify-center">
        <div className="text-center">
          <p className="text-red-400">Błąd ładowania kont email</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#0f1119] hover:bg-[#c5ad65]"
          >
            Odśwież stronę
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[#0f1119]">
      <div className="hidden h-full min-h-0 w-64 shrink-0 overflow-hidden lg:block">
        <MessagesSidebar
          emailAccounts={emailAccounts}
          selectedAccount={selectedAccount}
          setSelectedAccount={setSelectedAccount}
          filterType={filterType}
          setFilterType={setFilterType}
          hasContactFormAccess={hasContactFormAccess}
          canManage={canManage}
          unreadCounts={unreadCounts}
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col p-2.5 sm:p-4">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] shadow-xl">
          <div className="shrink-0 border-b border-[#d3bb73]/20 p-3 sm:p-4">
            <div className="mb-3 flex items-center justify-between sm:mb-4">
              <div>
                <h1 className="mb-0.5 text-xl font-bold text-white sm:text-2xl">
                  Wiadomości
                </h1>
                <p className="text-xs text-[#e5e4e2]/60 sm:text-sm">
                  {canManage ? 'Zarządzaj komunikacją z klientami' : 'Przeglądaj wiadomości email'}
                </p>
              </div>
              {canManage && (
                <ResponsiveActionBar
                  actions={[
                    {
                      label: 'Nowa wiadomość',
                      onClick: () => setShowNewMessageModal(true),
                      icon: <Plus className="h-5 w-5" />,
                    },
                    {
                      label: 'Pobierz z serwera',
                      onClick: fetchEmailsFromServer,
                      icon: <Inbox className="h-5 w-5" />,
                    },
                  ]}
                />
              )}
            </div>

            {/* DESKTOP search row */}
            <div className="hidden items-center gap-4 sm:flex">
              {/* Email account selector */}
              <div className="w-64 shrink-0">
                <select
                  value={selectedAccount}
                  onChange={(e) => setSelectedAccount(e.target.value)}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-sm text-white focus:border-[#d3bb73] focus:outline-none"
                >
                  {emailAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.display_name || account.email_address}
                    </option>
                  ))}
                </select>
              </div>

              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#e5e4e2]/40" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && searchQuery.trim()) handleAdvancedSearch();
                  }}
                  placeholder="Szukaj..."
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] py-2 pl-10 pr-3 text-sm text-white placeholder-[#e5e4e2]/40 focus:border-[#d3bb73] focus:outline-none"
                />
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setShowAdvancedSearch(!showAdvancedSearch)}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 transition-colors ${
                    showAdvancedSearch
                      ? 'bg-[#d3bb73] text-[#1c1f33]'
                      : 'bg-[#d3bb73]/20 text-[#d3bb73] hover:bg-[#d3bb73]/30'
                  }`}
                  title="Zaawansowane wyszukiwanie"
                >
                  <Calendar className="h-5 w-5" />
                </button>

                {isSearchMode && (
                  <button
                    onClick={handleClearSearch}
                    className="flex items-center gap-2 rounded-lg bg-red-500/20 px-3 py-2 text-red-400 transition-colors hover:bg-red-500/30"
                    title="Wyczyść wyszukiwanie"
                  >
                    <X className="h-5 w-5" />
                  </button>
                )}

                {canManage && (
                  <button
                    onClick={fetchEmailsFromServer}
                    disabled={
                      isLoading || selectedAccount === 'all' || selectedAccount === 'contact_form'
                    }
                    className="flex items-center gap-2 rounded-lg bg-blue-500/20 px-3 py-2 text-blue-400 transition-colors hover:bg-blue-500/30 disabled:cursor-not-allowed disabled:opacity-50"
                    title="Pobierz nowe wiadomości z serwera email"
                  >
                    <Inbox className="h-5 w-5" />
                    <span className="hidden lg:inline">Pobierz z serwera</span>
                  </button>
                )}

                <button
                  onClick={() => (isSearchMode ? handleClearSearch() : refetchDebounced())}
                  disabled={isLoading}
                  className="rounded-lg bg-[#d3bb73]/20 px-3 py-2 text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/30 disabled:opacity-50"
                  title="Odśwież"
                >
                  <RefreshCw className={`h-5 w-5 ${isLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            {/* MOBILE compact row */}
            <div className="flex items-center justify-between gap-2 sm:hidden">
              <div className="flex items-center gap-2">
                {/* lupka -> modal search */}
                <button
                  onClick={() => setShowMobileSearch(true)}
                  className="rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] p-2 text-[#e5e4e2]/80 hover:text-[#e5e4e2]"
                  title="Szukaj"
                >
                  <Search className="h-5 w-5" />
                </button>

                {/* filtry -> modal */}
                <button
                  onClick={() => setShowMobileFilters(true)}
                  className="rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] p-2 text-[#e5e4e2]/80 hover:text-[#e5e4e2]"
                  title="Filtry"
                >
                  <SlidersHorizontal className="h-5 w-5" />
                </button>

                {/* advanced toggle (opcjonalnie w mobile) */}
                <button
                  onClick={() => setShowAdvancedSearch(!showAdvancedSearch)}
                  className={`rounded-lg p-2 transition-colors ${
                    showAdvancedSearch
                      ? 'bg-[#d3bb73] text-[#1c1f33]'
                      : 'bg-[#d3bb73]/20 text-[#d3bb73]'
                  }`}
                  title="Zaawansowane"
                >
                  <Calendar className="h-5 w-5" />
                </button>

                {isSearchMode && (
                  <button
                    onClick={handleClearSearch}
                    className="rounded-lg bg-red-500/20 p-2 text-red-400 hover:bg-red-500/30"
                    title="Wyczyść wyszukiwanie"
                  >
                    <X className="h-5 w-5" />
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                {canManage && (
                  <button
                    onClick={fetchEmailsFromServer}
                    disabled={
                      isLoading || selectedAccount === 'all' || selectedAccount === 'contact_form'
                    }
                    className="rounded-lg bg-blue-500/20 p-2 text-blue-400 disabled:opacity-50"
                    title="Pobierz z serwera"
                  >
                    <Inbox className="h-5 w-5" />
                  </button>
                )}

                <button
                  onClick={() => (isSearchMode ? handleClearSearch() : refetchDebounced())}
                  disabled={isLoading}
                  className="rounded-lg bg-[#d3bb73]/20 p-2 text-[#d3bb73] disabled:opacity-50"
                  title="Odśwież"
                >
                  <RefreshCw className={`h-5 w-5 ${isLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 overflow-hidden">
            <div
              className={`${
                selectedMessage ? 'hidden lg:flex' : 'flex'
              } min-h-0 w-full shrink-0 flex-col border-r border-[#d3bb73]/15 lg:w-[390px] xl:w-[430px] 2xl:w-[480px]`}
            >
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                {isLoading && allMessages.length === 0 ? (
                  <div className="p-8 text-center text-[#e5e4e2]/60">
                    <RefreshCw className="mx-auto mb-2 h-8 w-8 animate-spin" />
                    Ładowanie wiadomości...
                  </div>
                ) : filteredMessages.length === 0 ? (
                  <div className="p-8 text-center">
                    <Inbox className="mx-auto mb-4 h-12 w-12 text-[#e5e4e2]/20" />
                    <p className="text-sm text-[#e5e4e2]/60">Brak wiadomości</p>
                  </div>
                ) : (
                  <div className="divide-y divide-[#d3bb73]/10">
                    {filteredMessages.map((message) => {
                      const typeInfo = getTypeLabel(message.type);
                      const isSelected = selectedMessageId === message.id;
                      return (
                        <div
                          key={message.id}
                          role="button"
                          tabIndex={0}
                          title="Kliknij, aby wyświetlić podgląd. Kliknij dwukrotnie, aby otworzyć w nowej karcie."
                          onClick={() =>
                            handleMessageClick(message.id, message.type, message.isRead)
                          }
                          onDoubleClick={() => openMessageInNewWindow(message)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              handleMessageClick(message.id, message.type, message.isRead);
                            }
                          }}
                          className={`cursor-default px-2.5 py-2 outline-none transition-colors hover:bg-[#d3bb73]/10 focus-visible:bg-[#d3bb73]/10 ${
                            isSelected
                              ? 'bg-[#d3bb73]/10 shadow-[inset_3px_0_0_#d3bb73]'
                              : !message.isRead
                                ? 'bg-[#d3bb73]/5 font-semibold'
                                : ''
                          }`}
                        >
                          <div className="mb-0.5 flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className="truncate text-[13px] leading-4 text-white">
                                  {message.from}
                                </span>
                                {!message.isRead && (
                                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#d3bb73]" />
                                )}
                              </div>
                              <p className="truncate text-[11px] leading-4 text-[#e5e4e2]/70">
                                {translateSubject(message.subject)}
                              </p>
                            </div>
                            <div
                              className="ml-1 flex shrink-0 items-center gap-0.5"
                              onClick={(event) => event.stopPropagation()}
                              onDoubleClick={(event) => event.stopPropagation()}
                            >
                              <span className="whitespace-nowrap text-[9px] leading-4 text-[#e5e4e2]/45">
                                {formatDate(message.date)}
                              </span>
                              {(message.type === 'contact_form' || message.type === 'received') && (
                                <MessageActionsMenu
                                  messageId={message.id}
                                  messageType={message.type}
                                  isStarred={message.isStarred}
                                  onReply={() => handleReply(message)}
                                  onForward={
                                    message.type === 'received'
                                      ? () => handleForward(message)
                                      : undefined
                                  }
                                  onAssign={() =>
                                    handleAssign(
                                      message.id,
                                      message.type as 'contact_form' | 'received',
                                      message.assigned_to || null,
                                    )
                                  }
                                  onDelete={() => handleDelete(message.id, message.type)}
                                  onMove={() => handleMove(message.id)}
                                  onCreateInquiry={() => handleCreateInquiry(message)}
                                  onCreateTask={
                                    canCreateTasks
                                      ? () => void handleCreateTask(message)
                                      : undefined
                                  }
                                  onStar={
                                    message.type === 'received'
                                      ? () => handleStar(message.id, message.isStarred)
                                      : undefined
                                  }
                                  onArchive={
                                    message.type === 'received'
                                      ? () => handleArchive(message)
                                      : undefined
                                  }
                                  canManage={canManage}
                                />
                              )}
                            </div>
                          </div>
                          <div className="flex min-w-0 items-center gap-1.5">
                            <span
                              className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] leading-3 ${typeInfo.color} text-white`}
                            >
                              {typeInfo.label}
                            </span>
                            {message.assigned_employee && (
                              <span className="max-w-[110px] shrink-0 truncate rounded border border-purple-500/25 bg-purple-500/15 px-1.5 py-0.5 text-[9px] leading-3 text-purple-300">
                                {message.assigned_employee.name} {message.assigned_employee.surname}
                              </span>
                            )}
                            <p className="min-w-0 flex-1 truncate text-[10px] leading-4 text-[#e5e4e2]/40">
                              {message.preview}
                            </p>
                          </div>
                        </div>
                      );
                    })}

                    {messagesData?.hasMore && (
                      <div ref={observerTarget} className="flex items-center justify-center p-4">
                        <div className="flex items-center gap-2 text-[#d3bb73]">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span className="text-xs">Ładowanie kolejnych…</span>
                        </div>
                      </div>
                    )}

                    {!messagesData?.hasMore && filteredMessages.length > 0 && (
                      <div className="p-3 text-center text-[10px] text-[#e5e4e2]/35">
                        Koniec listy wiadomości
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div
              className={`${selectedMessage ? 'flex' : 'hidden lg:flex'} min-h-0 min-w-0 flex-1`}
            >
              <MessagePreviewPane
                message={selectedMessage}
                canManage={canManage}
                onClose={() => setSelectedMessageId(null)}
                onOpenInNewWindow={openMessageInNewWindow}
                onReply={handleReply}
                onForward={handleForward}
                onAssign={(message) => {
                  if (message.type === 'received' || message.type === 'contact_form') {
                    handleAssign(message.id, message.type, message.assigned_to || null);
                  }
                }}
                onCreateInquiry={handleCreateInquiry}
                onCreateTask={canCreateTasks ? handleCreateTask : undefined}
                onDelete={(message) => handleDelete(message.id, message.type)}
              />
            </div>
          </div>
        </div>
      </div>

      {showMobileSearch && (
        <MobileSearchModal
          setShowMobileSearch={setShowMobileSearch}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          handleAdvancedSearch={handleAdvancedSearch}
          handleClearSearch={handleClearSearch}
        />
      )}

      {showMobileFilters && (
        <MessageMobileFilteredModal
          setShowMobileFilters={setShowMobileFilters}
          selectedAccount={selectedAccount}
          setSelectedAccount={setSelectedAccount}
          emailAccounts={emailAccounts}
          filterType={filterType}
          setFilterType={(type: string) => setFilterType(type as MessageFolder)}
          hasContactFormAccess={hasContactFormAccess}
          canManage={canManage}
        />
      )}

      <ComposeEmailModal
        isOpen={showNewMessageModal}
        onClose={() => {
          setShowNewMessageModal(false);
          setReplyToMessage(null);
          setForwardMessage(null);
        }}
        onSend={handleSendNewMessage}
        initialTo={extractReplyAddress(replyToMessage)}
        initialSubject={
          replyToMessage
            ? replySubject(replyToMessage.subject)
            : forwardMessage
              ? `Fwd: ${forwardMessage.subject}`
              : ''
        }
        initialBody=""
        replyContext={
          replyToMessage
            ? {
                from: replyToMessage.from,
                date: replyToMessage.date,
                subject: replyToMessage.subject,
                body: replyToMessage.body,
                bodyHtml: replyToMessage.bodyHtml,
                messageId: replyToMessage.originalData?.message_id || null,
              }
            : undefined
        }
        forwardedBody={
          forwardMessage
            ? `\n\n--- Przekazana wiadomość ---\nOd: ${forwardMessage.from}\nData: ${formatDate(forwardMessage.date)}\nTemat: ${forwardMessage.subject}\n\n${forwardMessage.body}`
            : ''
        }
        selectedAccountId={replyToMessage?.email_account_id || forwardMessage?.email_account_id || selectedAccount}
        emailAccounts={emailAccounts.filter((acc) => acc.id !== 'all' && acc.id !== 'contact_form')}
      />

      {showAssignModal && messageToAssign && (
        <AssignMessageModal
          messageId={messageToAssign.id}
          messageType={messageToAssign.type}
          currentAssignee={messageToAssign.assignedTo}
          onClose={() => {
            setShowAssignModal(false);
            setMessageToAssign(null);
          }}
          onSuccess={() => {
            refetchDebounced();
          }}
        />
      )}

      {inquiryMessage && (
        <CreateInquiryFromMessageModal
          message={inquiryMessage}
          userId={userId}
          onClose={() => setInquiryMessage(null)}
          onSuccess={() => {
            setInquiryMessage(null);
          }}
        />
      )}

      {taskMessage && (
        <CreateTaskFromMessageModal
          message={taskMessage}
          createdBy={currentEmployee?.id || userId}
          onClose={() => setTaskMessage(null)}
          onSuccess={() => setTaskMessage(null)}
        />
      )}
    </div>
  );
}
