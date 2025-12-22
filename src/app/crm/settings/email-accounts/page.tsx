'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import {
  Mail,
  RefreshCw,
  Search,
  Inbox,
  Loader2,
  Shield,
} from 'lucide-react';
import MessageActionsMenu from '@/components/crm/MessageActionsMenu';
import AssignMessageModal from '@/components/crm/AssignMessageModal';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import { useGetMessagesListQuery, useMarkMessageAsReadMutation, useDeleteMessageMutation, useToggleStarMessageMutation } from '@/store/api/messagesApi';

export default function AllEmailAccountsPage() {
  const router = useRouter();
  const { employee: currentEmployee } = useCurrentEmployee();
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();

  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [emailAccounts, setEmailAccounts] = useState<any[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<string>('all');
  const [filterType, setFilterType] = useState<'all' | 'contact_form' | 'sent' | 'received'>('all');
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [messageToAssign, setMessageToAssign] = useState<{id: string, type: 'contact_form' | 'received', assignedTo: string | null} | null>(null);
  const [offset, setOffset] = useState(0);
  const [allMessages, setAllMessages] = useState<any[]>([]);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const pageSize = 50;
  const observerTarget = useRef<HTMLDivElement>(null);

  const isAdmin = currentEmployee?.permissions?.includes('admin');

  const { data: messagesData, isLoading, isFetching, refetch } = useGetMessagesListQuery({
    emailAccountId: selectedAccount,
    offset,
    limit: pageSize,
    filterType,
  }, {
    skip: !selectedAccount || emailAccounts.length === 0 || !isAdmin,
  });

  const [markAsRead] = useMarkMessageAsReadMutation();
  const [deleteMessage] = useDeleteMessageMutation();
  const [toggleStar] = useToggleStarMessageMutation();

  useEffect(() => {
    if (messagesData?.messages) {
      if (offset === 0) {
        setAllMessages(messagesData.messages);
      } else {
        setAllMessages(prev => {
          const existingIds = new Set(prev.map(m => m.id));
          const newMessages = messagesData.messages.filter(m => !existingIds.has(m.id));
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
      setOffset(prev => prev + pageSize);
    }
  }, [isLoadingMore, messagesData?.hasMore, isFetching, pageSize]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadMore();
        }
      },
      { threshold: 0.1 }
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
    if (currentEmployee && isAdmin) {
      fetchEmailAccounts();
    }
  }, [currentEmployee, isAdmin]);

  useEffect(() => {
    if (!currentEmployee || emailAccounts.length === 0 || !isAdmin) return;

    const contactChannel = supabase
      .channel('contact_messages_changes_admin')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'contact_messages',
        },
        () => {
          refetch();
        }
      )
      .subscribe();

    const sentChannel = supabase
      .channel('sent_emails_changes_admin')
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
        }
      )
      .subscribe();

    const receivedChannel = supabase
      .channel('received_emails_changes_admin')
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
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(contactChannel);
      supabase.removeChannel(sentChannel);
      supabase.removeChannel(receivedChannel);
    };
  }, [currentEmployee, emailAccounts, selectedAccount, refetch, isAdmin]);

  const fetchEmailAccounts = async () => {
    if (!currentEmployee || !isAdmin) return;

    try {
      const { data, error } = await supabase
        .from('employee_email_accounts')
        .select('*, employees!employee_id(name, surname)')
        .eq('is_active', true)
        .order('employee_id');

      if (error) throw error;

      const accounts = [
        { id: 'all', email_address: 'Wszystkie konta', from_name: 'Wszystkie konta systemowe' },
        { id: 'contact_form', email_address: 'Formularz kontaktowy', from_name: 'Formularz kontaktowy' },
        ...(data || []).map((acc: any) => ({
          ...acc,
          from_name: `${acc.from_name} (${acc.employees?.name} ${acc.employees?.surname})`,
        })),
      ];

      setEmailAccounts(accounts);

      if (accounts.length > 0) {
        setSelectedAccount(accounts[0].id);
      }
    } catch (error) {
      console.error('Error fetching email accounts:', error);
    }
  };

  const handleMessageClick = async (messageId: string, messageType: 'contact_form' | 'sent' | 'received', isRead: boolean) => {
    router.push(`/crm/messages/${messageId}?type=${messageType}`);

    if (!isRead && (messageType === 'contact_form' || messageType === 'received')) {
      await markAsRead({ id: messageId, type: messageType });
    }
  };

  const handleStar = async (messageId: string, isStarred: boolean) => {
    try {
      await toggleStar({ id: messageId, isStarred }).unwrap();
      showSnackbar(
        isStarred ? 'Usunięto gwiazdkę' : 'Oznaczono gwiazdką',
        'success'
      );
    } catch (error) {
      console.error('Error toggling star:', error);
      showSnackbar('Błąd podczas oznaczania wiadomości', 'error');
    }
  };

  const handleArchive = async (message: any) => {
    showSnackbar('Funkcja archiwizacji będzie wkrótce dostępna', 'info');
  };

  const handleAssign = (messageId: string, messageType: 'contact_form' | 'received', assignedTo: string | null) => {
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
    if (!currentEmployee || !isAdmin) {
      showSnackbar('Musisz być administratorem', 'error');
      return;
    }

    if (selectedAccount === 'all' || selectedAccount === 'contact_form') {
      showSnackbar('Wybierz konkretne konto email', 'warning');
      return;
    }

    try {
      showSnackbar('Pobieranie wiadomości z serwera...', 'info');

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const apiUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/fetch-emails`;

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
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

    if (days === 0) {
      return messageDate.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
    } else if (days === 1) {
      return 'Wczoraj';
    } else if (days < 7) {
      return `${days} dni temu`;
    } else {
      return messageDate.toLocaleDateString('pl-PL');
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'contact_form': return { label: 'Formularz', color: 'bg-blue-500' };
      case 'sent': return { label: 'Wysłane', color: 'bg-green-500' };
      case 'received': return { label: 'Odebrane', color: 'bg-purple-500' };
      default: return { label: type, color: 'bg-gray-500' };
    }
  };

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-[#0f1119] flex items-center justify-center">
        <div className="text-center">
          <Shield className="w-16 h-16 text-[#e5e4e2]/20 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-white mb-2">Brak dostępu</h2>
          <p className="text-[#e5e4e2]/60">Tylko administratorzy mają dostęp do wszystkich skrzynek email.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f1119]">
      <div className="max-w-7xl mx-auto p-6">
        <div className="bg-[#1c1f33] rounded-lg shadow-xl border border-[#d3bb73]/20 overflow-hidden">
          <div className="p-6 border-b border-[#d3bb73]/20">
            <div className="flex items-center justify-between mb-6">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <Shield className="w-8 h-8 text-[#d3bb73]" />
                  <h1 className="text-3xl font-bold text-white">Wszystkie skrzynki email</h1>
                </div>
                <p className="text-[#e5e4e2]/60">Panel administratora - przeglądaj wszystkie wiadomości systemowe</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-[#e5e4e2]/70 mb-2">Konto Email</label>
                <select
                  value={selectedAccount}
                  onChange={(e) => setSelectedAccount(e.target.value)}
                  className="w-full px-4 py-3 bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg text-white focus:border-[#d3bb73] focus:outline-none"
                >
                  {emailAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.from_name || account.email_address}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm text-[#e5e4e2]/70 mb-2">Filtruj po typie</label>
                <select
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value as any)}
                  className="w-full px-4 py-3 bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg text-white focus:border-[#d3bb73] focus:outline-none"
                >
                  <option value="all">Wszystkie</option>
                  <option value="contact_form">Formularz</option>
                  <option value="received">Odebrane</option>
                  <option value="sent">Wysłane</option>
                </select>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-4">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#e5e4e2]/40" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Szukaj wiadomości..."
                  className="w-full pl-10 pr-4 py-3 bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg text-white placeholder-[#e5e4e2]/40 focus:border-[#d3bb73] focus:outline-none"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={fetchEmailsFromServer}
                  disabled={isLoading || selectedAccount === 'all' || selectedAccount === 'contact_form'}
                  className="px-4 py-3 bg-blue-500/20 text-blue-400 rounded-lg hover:bg-blue-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  title="Pobierz nowe wiadomości z serwera email"
                >
                  <Inbox className="w-5 h-5" />
                  <span className="hidden sm:inline">Pobierz z serwera</span>
                </button>
                <button
                  onClick={() => refetch()}
                  disabled={isLoading}
                  className="px-6 py-3 bg-[#d3bb73]/20 text-[#d3bb73] rounded-lg hover:bg-[#d3bb73]/30 transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>
          </div>

          <div className="overflow-y-auto max-h-[600px]">
            {isLoading && offset === 0 ? (
              <div className="p-8 text-center text-[#e5e4e2]/60">
                <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-2" />
                Ładowanie wiadomości...
              </div>
            ) : filteredMessages.length === 0 ? (
              <div className="p-8 text-center">
                <Inbox className="w-16 h-16 text-[#e5e4e2]/20 mx-auto mb-4" />
                <p className="text-[#e5e4e2]/60">Brak wiadomości</p>
              </div>
            ) : (
              <div className="divide-y divide-[#d3bb73]/10">
                {filteredMessages.map((message) => {
                  const typeInfo = getTypeLabel(message.type);
                  return (
                    <div
                      key={message.id}
                      className={`p-4 hover:bg-[#d3bb73]/5 transition-colors ${
                        !message.isRead ? 'font-semibold bg-[#d3bb73]/5' : ''
                      }`}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div
                          className="flex-1 min-w-0 cursor-pointer"
                          onClick={() => handleMessageClick(message.id, message.type, message.isRead)}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-white truncate">{message.from}</span>
                            {!message.isRead && (
                              <span className="w-2 h-2 rounded-full bg-[#d3bb73]"></span>
                            )}
                          </div>
                          <p className="text-sm text-[#e5e4e2]/70 truncate">{message.subject}</p>
                        </div>
                        <div className="flex items-center gap-2 ml-2">
                          <span className="text-xs text-[#e5e4e2]/50 whitespace-nowrap">
                            {formatDate(message.date)}
                          </span>
                          {(message.type === 'contact_form' || message.type === 'received') && (
                            <MessageActionsMenu
                              messageId={message.id}
                              messageType={message.type}
                              isStarred={message.isStarred}
                              onReply={() => {}}
                              onForward={message.type === 'received' ? () => {} : undefined}
                              onAssign={() => handleAssign(message.id, message.type as 'contact_form' | 'received', message.assigned_to || null)}
                              onDelete={() => handleDelete(message.id, message.type)}
                              onMove={() => handleMove(message.id)}
                              onStar={message.type === 'received' ? () => handleStar(message.id, message.isStarred) : undefined}
                              onArchive={message.type === 'received' ? () => handleArchive(message) : undefined}
                              canManage={true}
                            />
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs px-2 py-1 rounded ${typeInfo.color} text-white`}>
                          {typeInfo.label}
                        </span>
                        {message.assigned_employee && (
                          <span className="text-xs px-2 py-1 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">
                            Przypisano: {message.assigned_employee.name} {message.assigned_employee.surname}
                          </span>
                        )}
                        <p className="text-sm text-[#e5e4e2]/50 truncate flex-1">{message.preview}</p>
                      </div>
                    </div>
                  );
                })}

                {messagesData?.hasMore && (
                  <div ref={observerTarget} className="p-6 flex items-center justify-center">
                    <div className="flex items-center gap-3 text-[#d3bb73]">
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span className="text-sm">Ładowanie więcej wiadomości...</span>
                    </div>
                  </div>
                )}

                {!messagesData?.hasMore && filteredMessages.length > 0 && (
                  <div className="p-4 text-center text-[#e5e4e2]/40 text-sm">
                    Koniec listy wiadomości
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

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
