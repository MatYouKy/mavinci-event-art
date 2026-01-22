'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
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
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import {
  useGetMessagesListQuery,
  useMarkMessageAsReadMutation,
  useDeleteMessageMutation,
  useToggleStarMessageMutation,
  useLazySearchMessagesQuery,
} from '@/store/api/messagesApi';
import ResponsiveActionBar from '@/components/crm/ResponsiveActionBar';
import { MessageMobileFilteredModal } from './components/MessageMobileFilteredModal';
import { MobileSearchModal } from './components/MobileSearchModal';

const translateSubject = (subject: string): string => {
  if (!subject) return 'Wiadomość z formularza';
  return subject
    .replace(/^event_inquiry\s*-\s*/i, 'Zapytanie o event - ')
    .replace(/^team_join\s*-\s*/i, 'Rekrutacja - ')
    .replace(/^general\s*-\s*/i, 'Ogólna - ');
};

export default function MessagesPage() {
  const router = useRouter();
  const { employee: currentEmployee, canManageModule, canViewModule } = useCurrentEmployee();
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const canManage = canManageModule('messages');
  const canView = canViewModule('messages');

  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [emailAccounts, setEmailAccounts] = useState<any[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<string>('all');
  const [showNewMessageModal, setShowNewMessageModal] = useState(false);
  const [filterType, setFilterType] = useState<'all' | 'contact_form' | 'sent' | 'received'>('all');
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [messageToAssign, setMessageToAssign] = useState<{
    id: string;
    type: 'contact_form' | 'received';
    assignedTo: string | null;
  } | null>(null);
  const [replyToMessage, setReplyToMessage] = useState<any>(null);
  const [hasContactFormAccess, setHasContactFormAccess] = useState(false);
  const [forwardMessage, setForwardMessage] = useState<any>(null);
  const [offset, setOffset] = useState(0);
  const [allMessages, setAllMessages] = useState<any[]>([]);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [showAdvancedSearch, setShowAdvancedSearch] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [isSearchMode, setIsSearchMode] = useState(false);
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(true);
  const [showMobileSearch, setShowMobileSearch] = useState(false);
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const pageSize = 50;
  const observerTarget = useRef<HTMLDivElement>(null);

  const {
    data: messagesData,
    isLoading,
    isFetching,
    refetch,
  } = useGetMessagesListQuery(
    {
      emailAccountId: selectedAccount,
      offset,
      limit: pageSize,
      filterType,
    },
    {
      skip: !selectedAccount || emailAccounts.length === 0 || isSearchMode,
    },
  );

  const [triggerSearch, { data: searchData, isLoading: isSearching }] =
    useLazySearchMessagesQuery();

  const [markAsRead] = useMarkMessageAsReadMutation();
  const [deleteMessage] = useDeleteMessageMutation();
  const [toggleStar] = useToggleStarMessageMutation();

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
        filterType,
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
  };

  useEffect(() => {
    if (messagesData?.messages) {
      if (offset === 0) {
        setAllMessages(messagesData.messages);
      } else {
        setAllMessages((prev) => {
          const existingIds = new Set(prev.map((m) => m.id));
          const newMessages = messagesData.messages.filter((m) => !existingIds.has(m.id));
          return [...prev, ...newMessages];
        });
      }
      setIsLoadingMore(false);
    }
  }, [messagesData, offset]);

  useEffect(() => {
    setOffset(0);
    setAllMessages([]);
  }, [selectedAccount, filterType]);

  const loadMore = useCallback(() => {
    if (!isLoadingMore && messagesData?.hasMore && !isFetching) {
      setIsLoadingMore(true);
      setOffset((prev) => prev + pageSize);
    }
  }, [isLoadingMore, messagesData?.hasMore, isFetching, pageSize]);

  const fetchEmailAccounts = useCallback(async () => {
    if (!currentEmployee) return;

    setIsLoadingAccounts(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setIsLoadingAccounts(false);
        return;
      }

      const { data: personalAccounts, error: personalError } = await supabase
        .from('employee_email_accounts')
        .select('*')
        .eq('employee_id', user.id)
        .eq('is_active', true);

      if (personalError) throw personalError;

      const { data: assignments, error: assignmentsError } = await supabase
        .from('employee_email_account_assignments')
        .select('email_account_id')
        .eq('employee_id', user.id);

      if (assignmentsError) throw assignmentsError;

      const assignedAccountIds = assignments?.map((a) => a.email_account_id) || [];

      const { data: employeeData } = await supabase
        .from('employees')
        .select('can_receive_contact_forms')
        .eq('id', user.id)
        .maybeSingle();

      const hasAccess = employeeData?.can_receive_contact_forms || false;
      setHasContactFormAccess(hasAccess);

      let assignedAccounts = [];
      if (assignedAccountIds.length > 0) {
        const { data: assignedData, error: assignedError } = await supabase
          .from('employee_email_accounts')
          .select('*')
          .in('id', assignedAccountIds)
          .eq('is_active', true);

        if (assignedError) throw assignedError;
        assignedAccounts = assignedData || [];
      }

      const allUserAccounts = [...(personalAccounts || []), ...assignedAccounts];
      const uniqueAccounts = Array.from(
        new Map(allUserAccounts.map((acc) => [acc.id, acc])).values(),
      );

      const data = uniqueAccounts.sort((a, b) => {
        if (a.account_type !== b.account_type) {
          const order = { system: 0, shared: 1, personal: 2 };
          return (
            order[b.account_type as keyof typeof order] -
            order[a.account_type as keyof typeof order]
          );
        }
        return a.account_name.localeCompare(b.account_name);
      });

      const getAccountTypeBadge = (accountType: string) => {
        if (accountType === 'system') return '🔧';
        if (accountType === 'shared') return '🏢';
        return '👤';
      };

      const formatAccountName = (account: any) => {
        const badge = getAccountTypeBadge(account.account_type);
        if (account.account_type === 'shared' && account.department) {
          return `${badge} ${account.department} - ${account.account_name}`;
        }
        return `${badge} ${account.account_name}`;
      };

      const formattedAccounts = (data || []).map((acc) => ({
        ...acc,
        display_name: formatAccountName(acc),
      }));

      const accounts = [
        ...(formattedAccounts.length > 0
          ? [
              {
                id: 'all',
                email_address: 'Wszystkie dostępne konta',
                from_name: 'Wszystkie konta',
                display_name: '📧 Wszystkie konta',
              },
            ]
          : []),
        ...(hasAccess || canManage
          ? [
              {
                id: 'contact_form',
                email_address: 'Formularz kontaktowy',
                from_name: 'Formularz',
                display_name: '📝 Formularz kontaktowy',
              },
            ]
          : []),
        ...formattedAccounts,
      ];

      setEmailAccounts(accounts);

      if (accounts.length > 0) {
        setSelectedAccount(accounts[0].id);
      }
    } catch (error) {
      console.error('Error fetching email accounts:', error);
    } finally {
      setIsLoadingAccounts(false);
    }
  }, [currentEmployee, canManage]);

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
    if (currentEmployee) {
      fetchEmailAccounts();
    }
  }, [currentEmployee, fetchEmailAccounts]);

  useEffect(() => {
    const hasAccess = hasContactFormAccess || canManage;
    if (!hasAccess && selectedAccount === 'contact_form') {
      setSelectedAccount('all');
    }
    if (!hasAccess && filterType === 'contact_form') {
      setFilterType('all');
    }
  }, [hasContactFormAccess, canManage, selectedAccount, filterType]);

  useEffect(() => {
    if (emailAccounts.length > 0) {
      setOffset(0);
    }
  }, [selectedAccount, emailAccounts]);

  useEffect(() => {
    if (!currentEmployee || emailAccounts.length === 0) return;

    const contactChannel = supabase
      .channel('contact_messages_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'contact_messages',
        },
        () => {
          refetch();
        },
      )
      .subscribe();

    const sentChannel = supabase
      .channel('sent_emails_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'sent_emails',
        },
        () => {
          if (selectedAccount !== 'contact_form') {
            refetch();
          }
        },
      )
      .subscribe();

    const receivedChannel = supabase
      .channel('received_emails_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'received_emails',
        },
        () => {
          if (selectedAccount !== 'contact_form') {
            refetch();
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(contactChannel);
      supabase.removeChannel(sentChannel);
      supabase.removeChannel(receivedChannel);
    };
  }, [currentEmployee, emailAccounts, selectedAccount, refetch]);

  const handleMessageClick = async (
    messageId: string,
    messageType: 'contact_form' | 'sent' | 'received',
    isRead: boolean,
  ) => {
    window.open(`/crm/messages/${messageId}?type=${messageType}`, '_blank', 'noopener,noreferrer');

    if (!isRead && (messageType === 'contact_form' || messageType === 'received')) {
      await markAsRead({ id: messageId, type: messageType });
    }
  };

  const handleReply = (message: any) => {
    setReplyToMessage(message);
    setForwardMessage(null);
    setShowNewMessageModal(true);
  };

  const handleForward = (message: any) => {
    setForwardMessage(message);
    setReplyToMessage(null);
    setShowNewMessageModal(true);
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
        refetch();
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
  }) => {
    if (selectedAccount === 'all' || selectedAccount === 'contact_form') {
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

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          emailAccountId: selectedAccount,
          to: data.to,
          subject: data.subject,
          body: data.bodyHtml,
          attachments: attachmentsBase64,
        }),
      });

      const result = await response.json();

      if (result.success) {
        showSnackbar('Wiadomość wysłana!', 'success');
        setShowNewMessageModal(false);
        setReplyToMessage(null);
        setForwardMessage(null);
        refetch();
      } else {
        showSnackbar(`Błąd: ${result.error}`, 'error');
      }
    } catch (error) {
      console.error('Error sending message:', error);
      showSnackbar('Nie udało się wysłać wiadomości', 'error');
    }
  };

  const filteredMessages = allMessages.filter((msg) => {
    if (!searchQuery) return true;

    const query = searchQuery.toLowerCase();
    return (
      msg.from.toLowerCase().includes(query) ||
      msg.to.toLowerCase().includes(query) ||
      msg.subject.toLowerCase().includes(query) ||
      msg.preview.toLowerCase().includes(query)
    );
  });

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

  return (
    <div className="min-h-screen bg-[#0f1119]">
      <div className="mx-auto max-w-7xl p-3 sm:p-6">
        <div className="overflow-hidden rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] shadow-xl">
          <div className="border-b border-[#d3bb73]/20 p-3 sm:p-6">
            <div className="mb-4 flex items-center justify-between sm:mb-6">
              <div>
                <h1 className="mb-1 text-xl font-bold text-white sm:mb-2 sm:text-3xl">
                  Wiadomości
                </h1>
                <p className="text-xs text-[#e5e4e2]/60 sm:text-base">
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
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] py-3 pl-10 pr-4 text-base text-white placeholder-[#e5e4e2]/40 focus:border-[#d3bb73] focus:outline-none"
                />
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setShowAdvancedSearch(!showAdvancedSearch)}
                  className={`flex items-center gap-2 rounded-lg px-4 py-3 transition-colors ${
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
                    className="flex items-center gap-2 rounded-lg bg-red-500/20 px-4 py-3 text-red-400 transition-colors hover:bg-red-500/30"
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
                    className="flex items-center gap-2 rounded-lg bg-blue-500/20 px-4 py-3 text-blue-400 transition-colors hover:bg-blue-500/30 disabled:cursor-not-allowed disabled:opacity-50"
                    title="Pobierz nowe wiadomości z serwera email"
                  >
                    <Inbox className="h-5 w-5" />
                    <span className="hidden lg:inline">Pobierz z serwera</span>
                  </button>
                )}

                <button
                  onClick={() => (isSearchMode ? handleClearSearch() : refetch())}
                  disabled={isLoading}
                  className="rounded-lg bg-[#d3bb73]/20 px-6 py-3 text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/30 disabled:opacity-50"
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
                  onClick={() => (isSearchMode ? handleClearSearch() : refetch())}
                  disabled={isLoading}
                  className="rounded-lg bg-[#d3bb73]/20 p-2 text-[#d3bb73] disabled:opacity-50"
                  title="Odśwież"
                >
                  <RefreshCw className={`h-5 w-5 ${isLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>
          </div>

          <div className="max-h-[600px] overflow-y-auto">
            {isLoading ? (
              <div className="p-8 text-center text-[#e5e4e2]/60">
                <RefreshCw className="mx-auto mb-2 h-8 w-8 animate-spin" />
                Ładowanie wiadomości...
              </div>
            ) : filteredMessages.length === 0 ? (
              <div className="p-8 text-center">
                <Inbox className="mx-auto mb-4 h-16 w-16 text-[#e5e4e2]/20" />
                <p className="text-[#e5e4e2]/60">Brak wiadomości</p>
              </div>
            ) : (
              <div className="divide-y divide-[#d3bb73]/10">
                {filteredMessages.map((message) => {
                  const typeInfo = getTypeLabel(message.type);
                  return (
                    <div
                      key={message.id}
                      className={`p-2 transition-colors hover:bg-[#d3bb73]/5 sm:p-4 ${
                        !message.isRead ? 'bg-[#d3bb73]/5 font-semibold' : ''
                      }`}
                    >
                      <div className="mb-1.5 flex items-start justify-between gap-2 sm:mb-2">
                        <div
                          className="min-w-0 flex-1 cursor-pointer"
                          onClick={() =>
                            handleMessageClick(message.id, message.type, message.isRead)
                          }
                        >
                          <div className="mb-0.5 flex items-center gap-1.5 sm:mb-1 sm:gap-2">
                            <span className="truncate text-sm text-white sm:text-base">
                              {message.from}
                            </span>
                            {!message.isRead && (
                              <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#d3bb73] sm:h-2 sm:w-2"></span>
                            )}
                          </div>
                          <p className="truncate text-xs text-[#e5e4e2]/70 sm:text-sm">
                            {message.subject}
                          </p>
                        </div>
                        <div className="ml-2 flex flex-shrink-0 items-center gap-1 sm:gap-2">
                          <span className="whitespace-nowrap text-[10px] text-[#e5e4e2]/50 sm:text-xs">
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
                      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] sm:px-2 sm:py-1 sm:text-xs ${typeInfo.color} text-white`}
                        >
                          {typeInfo.label}
                        </span>
                        {message.assigned_employee && (
                          <span className="rounded border border-purple-500/30 bg-purple-500/20 px-1.5 py-0.5 text-[10px] text-purple-300 sm:px-2 sm:py-1 sm:text-xs">
                            {message.assigned_employee.name} {message.assigned_employee.surname}
                          </span>
                        )}
                        <p className="hidden flex-1 truncate text-sm text-[#e5e4e2]/50 sm:block">
                          {message.preview}
                        </p>
                      </div>
                    </div>
                  );
                })}

                {messagesData?.hasMore && (
                  <div ref={observerTarget} className="flex items-center justify-center p-6">
                    <div className="flex items-center gap-3 text-[#d3bb73]">
                      <Loader2 className="h-5 w-5 animate-spin" />
                      <span className="text-sm">Ładowanie więcej wiadomości...</span>
                    </div>
                  </div>
                )}

                {!messagesData?.hasMore && filteredMessages.length > 0 && (
                  <div className="p-4 text-center text-sm text-[#e5e4e2]/40">
                    Koniec listy wiadomości
                  </div>
                )}
              </div>
            )}
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
          setFilterType={(type: string) =>
            setFilterType(type as 'contact_form' | 'received' | 'all' | 'sent')
          }
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
        initialTo={replyToMessage?.from || ''}
        initialSubject={
          replyToMessage
            ? `Re: ${replyToMessage.subject}`
            : forwardMessage
              ? `Fwd: ${forwardMessage.subject}`
              : ''
        }
        initialBody={
          replyToMessage ? `\n\n--- Odpowiedź na wiadomość ---\n${replyToMessage.preview}` : ''
        }
        forwardedBody={
          forwardMessage
            ? `\n\n--- Przekazana wiadomość ---\nOd: ${forwardMessage.from}\nData: ${formatDate(forwardMessage.date)}\nTemat: ${forwardMessage.subject}\n\n${forwardMessage.preview}`
            : ''
        }
        selectedAccountId={selectedAccount}
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
            refetch();
          }}
        />
      )}
    </div>
  );
}
