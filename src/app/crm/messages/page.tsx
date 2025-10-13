'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import {
  Mail,
  Send,
  RefreshCw,
  Search,
  Plus,
  Inbox,
  X,
} from 'lucide-react';

interface UnifiedMessage {
  id: string;
  type: 'contact_form' | 'sent' | 'received';
  from: string;
  to: string;
  subject: string;
  body: string;
  bodyHtml?: string;
  date: Date;
  isRead: boolean;
  isStarred: boolean;
  status?: string;
  originalData: any;
}

export default function MessagesPage() {
  const [messages, setMessages] = useState<UnifiedMessage[]>([]);
  const [selectedMessage, setSelectedMessage] = useState<UnifiedMessage | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [emailAccounts, setEmailAccounts] = useState<any[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<string>('all');
  const [showNewMessageModal, setShowNewMessageModal] = useState(false);
  const [filterType, setFilterType] = useState<'all' | 'contact_form' | 'sent' | 'received'>('all');

  const [newMessage, setNewMessage] = useState({
    to: '',
    subject: '',
    body: '',
  });

  useEffect(() => {
    fetchEmailAccounts();
  }, []);

  useEffect(() => {
    if (emailAccounts.length > 0) {
      fetchMessages();
    }
  }, [selectedAccount, emailAccounts]);

  const fetchEmailAccounts = async () => {
    try {
      const { data, error } = await supabase
        .from('employee_email_accounts')
        .select('*')
        .eq('is_active', true);

      if (error) throw error;

      const accounts = [
        { id: 'all', email_address: 'Wszystkie konta', from_name: 'Wszystkie' },
        { id: 'contact_form', email_address: 'Formularz kontaktowy', from_name: 'Formularz' },
        ...(data || []),
      ];

      setEmailAccounts(accounts);
    } catch (error) {
      console.error('Error fetching email accounts:', error);
    }
  };

  const fetchMessages = async () => {
    setLoading(true);
    try {
      const allMessages: UnifiedMessage[] = [];

      if (selectedAccount === 'all' || selectedAccount === 'contact_form') {
        const { data: contactMessages } = await supabase
          .from('contact_messages')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(50);

        if (contactMessages) {
          allMessages.push(
            ...contactMessages.map((msg) => ({
              id: msg.id,
              type: 'contact_form' as const,
              from: `${msg.name} <${msg.email}>`,
              to: 'Formularz kontaktowy',
              subject: msg.subject || 'Wiadomość z formularza',
              body: msg.message,
              bodyHtml: `<p><strong>Od:</strong> ${msg.name} (${msg.email})</p>
                         ${msg.phone ? `<p><strong>Telefon:</strong> ${msg.phone}</p>` : ''}
                         <p>${(msg.message || '').replace(/\n/g, '<br>')}</p>`,
              date: new Date(msg.created_at),
              isRead: msg.status !== 'new',
              isStarred: false,
              status: msg.status,
              originalData: msg,
            }))
          );
        }
      }

      if (selectedAccount !== 'contact_form') {
        const accountFilter = selectedAccount === 'all' ? {} : { email_account_id: selectedAccount };

        const { data: sentEmails } = await supabase
          .from('sent_emails')
          .select('*, employees(name, surname, email)')
          .match(accountFilter)
          .order('sent_at', { ascending: false })
          .limit(50);

        if (sentEmails) {
          allMessages.push(
            ...sentEmails.map((msg) => {
              const employee = msg.employees as any;
              const fromName = employee ? `${employee.name} ${employee.surname}` : 'System';
              return {
                id: msg.id,
                type: 'sent' as const,
                from: `${fromName}`,
                to: msg.to_address,
                subject: msg.subject,
                body: msg.body.replace(/<[^>]*>/g, ''),
                bodyHtml: msg.body,
                date: new Date(msg.sent_at),
                isRead: true,
                isStarred: false,
                originalData: msg,
              };
            })
          );
        }

        const { data: receivedEmails } = await supabase
          .from('received_emails')
          .select('*')
          .match(accountFilter)
          .order('received_date', { ascending: false })
          .limit(50);

        if (receivedEmails) {
          allMessages.push(
            ...receivedEmails.map((msg) => ({
              id: msg.id,
              type: 'received' as const,
              from: msg.from_address,
              to: msg.to_address,
              subject: msg.subject,
              body: msg.body_text || '',
              bodyHtml: msg.body_html || '',
              date: new Date(msg.received_date),
              isRead: msg.is_read,
              isStarred: msg.is_starred,
              originalData: msg,
            }))
          );
        }
      }

      allMessages.sort((a, b) => b.date.getTime() - a.date.getTime());
      setMessages(allMessages);
    } catch (error) {
      console.error('Error fetching messages:', error);
    }
    setLoading(false);
  };

  const markAsRead = async (message: UnifiedMessage) => {
    if (message.type === 'contact_form' && message.originalData.status === 'new') {
      await supabase
        .from('contact_messages')
        .update({ status: 'read', read_at: new Date().toISOString() })
        .eq('id', message.id);
    } else if (message.type === 'received' && !message.isRead) {
      await supabase
        .from('received_emails')
        .update({ is_read: true })
        .eq('id', message.id);
    }
    fetchMessages();
  };

  const handleSendNewMessage = async () => {
    if (!newMessage.to || !newMessage.subject || !newMessage.body) {
      alert('Wypełnij wszystkie pola');
      return;
    }

    if (selectedAccount === 'all' || selectedAccount === 'contact_form') {
      alert('Wybierz konto email do wysłania');
      return;
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        alert('Musisz być zalogowany');
        return;
      }

      const apiUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/send-email`;

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          emailAccountId: selectedAccount,
          to: newMessage.to,
          subject: newMessage.subject,
          body: newMessage.body.replace(/\n/g, '<br>'),
        }),
      });

      const result = await response.json();

      if (result.success) {
        alert('Wiadomość wysłana!');
        setShowNewMessageModal(false);
        setNewMessage({ to: '', subject: '', body: '' });
        fetchMessages();
      } else {
        alert(`Błąd: ${result.error}`);
      }
    } catch (error) {
      console.error('Error sending message:', error);
      alert('Nie udało się wysłać wiadomości');
    }
  };

  const filteredMessages = messages.filter((msg) => {
    if (filterType !== 'all' && msg.type !== filterType) return false;
    if (!searchQuery) return true;

    const query = searchQuery.toLowerCase();
    return (
      msg.from.toLowerCase().includes(query) ||
      msg.to.toLowerCase().includes(query) ||
      msg.subject.toLowerCase().includes(query) ||
      msg.body.toLowerCase().includes(query)
    );
  });

  const formatDate = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      return date.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
    } else if (days === 1) {
      return 'Wczoraj';
    } else if (days < 7) {
      return `${days} dni temu`;
    } else {
      return date.toLocaleDateString('pl-PL');
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

  return (
    <div className="min-h-screen bg-[#0f1119]">
      <div className="max-w-7xl mx-auto p-6">
        <div className="bg-[#1c1f33] rounded-lg shadow-xl border border-[#d3bb73]/20 overflow-hidden">
          <div className="p-6 border-b border-[#d3bb73]/20">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-3xl font-bold text-white mb-2">Wiadomości</h1>
                <p className="text-[#e5e4e2]/60">Zarządzaj komunikacją z klientami</p>
              </div>
              <button
                onClick={() => setShowNewMessageModal(true)}
                disabled={selectedAccount === 'all' || selectedAccount === 'contact_form'}
                className="flex items-center gap-2 px-6 py-3 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#c5ad65] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Plus className="w-5 h-5" />
                Nowa Wiadomość
              </button>
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
              <button
                onClick={fetchMessages}
                disabled={loading}
                className="px-6 py-3 bg-[#d3bb73]/20 text-[#d3bb73] rounded-lg hover:bg-[#d3bb73]/30 transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-5 divide-x divide-[#d3bb73]/10">
            <div className="lg:col-span-2 overflow-y-auto max-h-[600px]">
              {loading ? (
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
                        onClick={() => {
                          setSelectedMessage(message);
                          markAsRead(message);
                        }}
                        className={`p-4 cursor-pointer hover:bg-[#d3bb73]/5 transition-colors ${
                          selectedMessage?.id === message.id ? 'bg-[#d3bb73]/10' : ''
                        } ${!message.isRead ? 'font-semibold' : ''}`}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-white truncate">{message.from}</span>
                              {!message.isRead && (
                                <span className="w-2 h-2 rounded-full bg-[#d3bb73]"></span>
                              )}
                            </div>
                            <p className="text-sm text-[#e5e4e2]/70 truncate">{message.subject}</p>
                          </div>
                          <span className="text-xs text-[#e5e4e2]/50 ml-2 whitespace-nowrap">
                            {formatDate(message.date)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-xs px-2 py-1 rounded ${typeInfo.color} text-white`}>
                            {typeInfo.label}
                          </span>
                          <p className="text-sm text-[#e5e4e2]/50 truncate">{message.body}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="lg:col-span-3 p-6">
              {selectedMessage ? (
                <div>
                  <div className="mb-6 pb-6 border-b border-[#d3bb73]/20">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex-1">
                        <h2 className="text-2xl font-bold text-white mb-2">{selectedMessage.subject}</h2>
                        <div className="space-y-1 text-sm text-[#e5e4e2]/70">
                          <p><strong>Od:</strong> {selectedMessage.from}</p>
                          <p><strong>Do:</strong> {selectedMessage.to}</p>
                          <p><strong>Data:</strong> {selectedMessage.date.toLocaleString('pl-PL')}</p>
                        </div>
                      </div>
                      <span className={`text-xs px-3 py-1 rounded ${getTypeLabel(selectedMessage.type).color} text-white`}>
                        {getTypeLabel(selectedMessage.type).label}
                      </span>
                    </div>
                  </div>

                  <div className="prose prose-invert max-w-none">
                    {selectedMessage.bodyHtml ? (
                      <div dangerouslySetInnerHTML={{ __html: selectedMessage.bodyHtml }} />
                    ) : (
                      <p className="whitespace-pre-wrap text-[#e5e4e2]">{selectedMessage.body}</p>
                    )}
                  </div>

                  {(selectedMessage.type === 'contact_form' || selectedMessage.type === 'received') && (
                    <div className="mt-6 pt-6 border-t border-[#d3bb73]/20">
                      <button
                        onClick={() => {
                          const email = selectedMessage.type === 'contact_form'
                            ? selectedMessage.originalData.email
                            : selectedMessage.from;
                          setNewMessage({
                            to: email,
                            subject: `Re: ${selectedMessage.subject}`,
                            body: '',
                          });
                          setShowNewMessageModal(true);
                        }}
                        disabled={selectedAccount === 'all' || selectedAccount === 'contact_form'}
                        className="px-6 py-3 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#c5ad65] transition-colors disabled:opacity-50"
                      >
                        Odpowiedz
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-[#e5e4e2]/40">
                  <div className="text-center">
                    <Mail className="w-16 h-16 mx-auto mb-4" />
                    <p>Wybierz wiadomość, aby zobaczyć szczegóły</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {showNewMessageModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1c1f33] rounded-lg max-w-2xl w-full border border-[#d3bb73]/20">
            <div className="p-6 border-b border-[#d3bb73]/20 flex items-center justify-between">
              <h2 className="text-2xl font-bold text-white">Nowa Wiadomość</h2>
              <button
                onClick={() => setShowNewMessageModal(false)}
                className="text-[#e5e4e2]/60 hover:text-white"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm text-[#e5e4e2]/70 mb-2">Do:</label>
                <input
                  type="email"
                  value={newMessage.to}
                  onChange={(e) => setNewMessage({ ...newMessage, to: e.target.value })}
                  placeholder="email@example.com"
                  className="w-full px-4 py-3 bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg text-white focus:border-[#d3bb73] focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm text-[#e5e4e2]/70 mb-2">Temat:</label>
                <input
                  type="text"
                  value={newMessage.subject}
                  onChange={(e) => setNewMessage({ ...newMessage, subject: e.target.value })}
                  placeholder="Temat wiadomości"
                  className="w-full px-4 py-3 bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg text-white focus:border-[#d3bb73] focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm text-[#e5e4e2]/70 mb-2">Wiadomość:</label>
                <textarea
                  value={newMessage.body}
                  onChange={(e) => setNewMessage({ ...newMessage, body: e.target.value })}
                  placeholder="Treść wiadomości..."
                  rows={10}
                  className="w-full px-4 py-3 bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg text-white focus:border-[#d3bb73] focus:outline-none resize-none"
                />
              </div>
            </div>
            <div className="p-6 border-t border-[#d3bb73]/20 flex justify-end gap-4">
              <button
                onClick={() => setShowNewMessageModal(false)}
                className="px-6 py-3 bg-[#0f1119] text-white rounded-lg hover:bg-[#1a1d2e] transition-colors"
              >
                Anuluj
              </button>
              <button
                onClick={handleSendNewMessage}
                className="px-6 py-3 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#c5ad65] transition-colors flex items-center gap-2"
              >
                <Send className="w-5 h-5" />
                Wyślij
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
