'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import {
  Mail,
  MailOpen,
  Archive,
  Star,
  Filter,
  Search,
  ChevronDown,
  User,
  Building2,
  Phone,
  Calendar,
  Tag,
  AlertCircle,
  CheckCircle,
  Clock,
  Trash2,
  Eye,
  Send
} from 'lucide-react';

interface ContactMessage {
  id: string;
  name: string;
  email: string;
  phone?: string;
  company?: string;
  category: string;
  source_page: string;
  subject?: string;
  message: string;
  status: 'new' | 'read' | 'replied' | 'archived';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  assigned_to?: string;
  notes?: string;
  read_at?: string;
  replied_at?: string;
  created_at: string;
  updated_at: string;
}

const categoryLabels: Record<string, string> = {
  general: 'Ogólne',
  team_join: 'Dołącz do zespołu',
  event_inquiry: 'Zapytanie o event',
  portfolio: 'Portfolio',
  services: 'Usługi',
};

const statusLabels: Record<string, { label: string; icon: any; color: string }> = {
  new: { label: 'Nowa', icon: Mail, color: 'text-blue-400' },
  read: { label: 'Przeczytana', icon: MailOpen, color: 'text-yellow-400' },
  replied: { label: 'Odpowiedziano', icon: CheckCircle, color: 'text-green-400' },
  archived: { label: 'Archiwum', icon: Archive, color: 'text-gray-400' },
};

const priorityLabels: Record<string, { label: string; color: string }> = {
  low: { label: 'Niska', color: 'text-gray-400' },
  normal: { label: 'Normalna', color: 'text-blue-400' },
  high: { label: 'Wysoka', color: 'text-orange-400' },
  urgent: { label: 'Pilna', color: 'text-red-400' },
};

export default function MessagesPage() {
  const [messages, setMessages] = useState<ContactMessage[]>([]);
  const [filteredMessages, setFilteredMessages] = useState<ContactMessage[]>([]);
  const [selectedMessage, setSelectedMessage] = useState<ContactMessage | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [replyText, setReplyText] = useState('');
  const [notesText, setNotesText] = useState('');
  const [showReplyModal, setShowReplyModal] = useState(false);
  const [emailAccounts, setEmailAccounts] = useState<any[]>([]);
  const [selectedEmailAccount, setSelectedEmailAccount] = useState<string>('');
  const [showNewMessageModal, setShowNewMessageModal] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<string>('contact_form');

  useEffect(() => {
    fetchMessages();
    fetchEmailAccounts();
  }, []);

  useEffect(() => {
    filterMessages();
  }, [messages, searchQuery, statusFilter, categoryFilter, priorityFilter]);

  const fetchMessages = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('contact_messages')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setMessages(data || []);
    } catch (error) {
      console.error('Error fetching messages:', error);
    }
    setLoading(false);
  };

  const fetchEmailAccounts = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('employee_email_accounts')
        .select('*')
        .eq('is_active', true);

      if (error) throw error;
      setEmailAccounts(data || []);
      if (data && data.length > 0) {
        setSelectedEmailAccount(data[0].id);
      }
    } catch (error) {
      console.error('Error fetching email accounts:', error);
    }
  };

  const filterMessages = () => {
    let filtered = [...messages];

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (msg) =>
          msg.name.toLowerCase().includes(query) ||
          msg.email.toLowerCase().includes(query) ||
          msg.message.toLowerCase().includes(query) ||
          msg.company?.toLowerCase().includes(query)
      );
    }

    if (statusFilter !== 'all') {
      filtered = filtered.filter((msg) => msg.status === statusFilter);
    }

    if (categoryFilter !== 'all') {
      filtered = filtered.filter((msg) => msg.category === categoryFilter);
    }

    if (priorityFilter !== 'all') {
      filtered = filtered.filter((msg) => msg.priority === priorityFilter);
    }

    setFilteredMessages(filtered);
  };

  const handleSelectMessage = async (message: ContactMessage) => {
    setSelectedMessage(message);
    setNotesText(message.notes || '');

    if (message.status === 'new') {
      await updateMessageStatus(message.id, 'read');
    }
  };

  const updateMessageStatus = async (id: string, status: string) => {
    try {
      const updates: any = { status };
      if (status === 'read' && !selectedMessage?.read_at) {
        updates.read_at = new Date().toISOString();
      }
      if (status === 'replied' && !selectedMessage?.replied_at) {
        updates.replied_at = new Date().toISOString();
      }

      const { error } = await supabase
        .from('contact_messages')
        .update(updates)
        .eq('id', id);

      if (error) throw error;
      await fetchMessages();
    } catch (error) {
      console.error('Error updating message status:', error);
    }
  };

  const handleSaveNotes = async () => {
    if (!selectedMessage) return;

    try {
      const { error } = await supabase
        .from('contact_messages')
        .update({ notes: notesText })
        .eq('id', selectedMessage.id);

      if (error) throw error;
      await fetchMessages();
      alert('Notatki zapisane');
    } catch (error) {
      console.error('Error saving notes:', error);
      alert('Błąd podczas zapisywania notatek');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Czy na pewno chcesz usunąć tę wiadomość?')) return;

    try {
      const { error } = await supabase
        .from('contact_messages')
        .delete()
        .eq('id', id);

      if (error) throw error;
      setSelectedMessage(null);
      await fetchMessages();
    } catch (error) {
      console.error('Error deleting message:', error);
      alert('Błąd podczas usuwania wiadomości');
    }
  };

  const handleSendReply = async () => {
    if (!selectedMessage || !replyText.trim() || !selectedEmailAccount) {
      alert('Wypełnij wszystkie pola');
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
          to: selectedMessage.email,
          subject: `Re: ${selectedMessage.subject || 'Twoje zapytanie'}`,
          body: replyText,
          messageId: selectedMessage.id,
          emailAccountId: selectedEmailAccount,
        }),
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Nie udało się wysłać wiadomości');
      }

      alert('Odpowiedź została wysłana!');
      setReplyText('');
      setShowReplyModal(false);
      await fetchMessages();
    } catch (error) {
      console.error('Error sending reply:', error);
      alert(`Błąd podczas wysyłania odpowiedzi: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Przed chwilą';
    if (diffMins < 60) return `${diffMins} min temu`;
    if (diffHours < 24) return `${diffHours} godz. temu`;
    if (diffDays < 7) return `${diffDays} dni temu`;
    return date.toLocaleDateString('pl-PL');
  };

  const stats = {
    total: messages.length,
    new: messages.filter((m) => m.status === 'new').length,
    read: messages.filter((m) => m.status === 'read').length,
    replied: messages.filter((m) => m.status === 'replied').length,
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1a1d2e] to-[#16213e] p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-white mb-2">Wiadomości Kontaktowe</h1>
          <p className="text-gray-400">Zarządzaj wiadomościami z formularzy kontaktowych</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-[#1c1f33] rounded-xl p-4 border border-blue-500/20">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-400 text-sm">Wszystkie</p>
                <p className="text-2xl font-bold text-white">{stats.total}</p>
              </div>
              <Mail className="w-8 h-8 text-blue-400" />
            </div>
          </div>
          <div className="bg-[#1c1f33] rounded-xl p-4 border border-blue-500/20">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-400 text-sm">Nowe</p>
                <p className="text-2xl font-bold text-blue-400">{stats.new}</p>
              </div>
              <AlertCircle className="w-8 h-8 text-blue-400" />
            </div>
          </div>
          <div className="bg-[#1c1f33] rounded-xl p-4 border border-yellow-500/20">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-400 text-sm">Przeczytane</p>
                <p className="text-2xl font-bold text-yellow-400">{stats.read}</p>
              </div>
              <Eye className="w-8 h-8 text-yellow-400" />
            </div>
          </div>
          <div className="bg-[#1c1f33] rounded-xl p-4 border border-green-500/20">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-400 text-sm">Odpowiedziano</p>
                <p className="text-2xl font-bold text-green-400">{stats.replied}</p>
              </div>
              <CheckCircle className="w-8 h-8 text-green-400" />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 bg-[#1c1f33] rounded-xl border border-[#d3bb73]/20 overflow-hidden">
            <div className="p-4 border-b border-[#d3bb73]/20">
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Szukaj wiadomości..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-[#d3bb73]"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="flex-1 px-3 py-2 bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg text-white text-sm focus:outline-none focus:border-[#d3bb73]"
                >
                  <option value="all">Wszystkie statusy</option>
                  <option value="new">Nowe</option>
                  <option value="read">Przeczytane</option>
                  <option value="replied">Odpowiedziano</option>
                  <option value="archived">Archiwum</option>
                </select>

                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="flex-1 px-3 py-2 bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg text-white text-sm focus:outline-none focus:border-[#d3bb73]"
                >
                  <option value="all">Wszystkie kategorie</option>
                  {Object.entries(categoryLabels).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 400px)' }}>
              {loading ? (
                <div className="p-8 text-center text-gray-400">Ładowanie...</div>
              ) : filteredMessages.length === 0 ? (
                <div className="p-8 text-center text-gray-400">Brak wiadomości</div>
              ) : (
                filteredMessages.map((message) => {
                  const StatusIcon = statusLabels[message.status].icon;
                  return (
                    <div
                      key={message.id}
                      onClick={() => handleSelectMessage(message)}
                      className={`p-4 border-b border-[#d3bb73]/10 cursor-pointer transition-colors ${
                        selectedMessage?.id === message.id
                          ? 'bg-[#d3bb73]/10'
                          : 'hover:bg-[#0f1119]'
                      } ${message.status === 'new' ? 'bg-blue-500/5' : ''}`}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1 min-w-0">
                          <p className={`font-medium text-white truncate ${message.status === 'new' ? 'font-semibold' : ''}`}>
                            {message.name}
                          </p>
                          <p className="text-sm text-gray-400 truncate">{message.email}</p>
                        </div>
                        <StatusIcon className={`w-4 h-4 ml-2 flex-shrink-0 ${statusLabels[message.status].color}`} />
                      </div>
                      <p className="text-sm text-gray-300 mb-2 line-clamp-2">{message.message}</p>
                      <div className="flex items-center justify-between text-xs text-gray-500">
                        <span className={`px-2 py-0.5 rounded ${
                          message.priority === 'urgent' ? 'bg-red-500/20 text-red-400' :
                          message.priority === 'high' ? 'bg-orange-500/20 text-orange-400' :
                          'bg-gray-500/20 text-gray-400'
                        }`}>
                          {categoryLabels[message.category]}
                        </span>
                        <span>{formatDate(message.created_at)}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="lg:col-span-2 bg-[#1c1f33] rounded-xl border border-[#d3bb73]/20 overflow-hidden">
            {selectedMessage ? (
              <div className="h-full flex flex-col">
                <div className="p-6 border-b border-[#d3bb73]/20">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1">
                      <h2 className="text-2xl font-bold text-white mb-2">{selectedMessage.name}</h2>
                      <div className="flex flex-wrap gap-3 text-sm text-gray-400">
                        <div className="flex items-center gap-1">
                          <Mail className="w-4 h-4" />
                          <a href={`mailto:${selectedMessage.email}`} className="hover:text-[#d3bb73]">
                            {selectedMessage.email}
                          </a>
                        </div>
                        {selectedMessage.phone && (
                          <div className="flex items-center gap-1">
                            <Phone className="w-4 h-4" />
                            <a href={`tel:${selectedMessage.phone}`} className="hover:text-[#d3bb73]">
                              {selectedMessage.phone}
                            </a>
                          </div>
                        )}
                        {selectedMessage.company && (
                          <div className="flex items-center gap-1">
                            <Building2 className="w-4 h-4" />
                            {selectedMessage.company}
                          </div>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => handleDelete(selectedMessage.id)}
                      className="p-2 text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <span className={`px-3 py-1 rounded-full text-xs ${priorityLabels[selectedMessage.priority].color} bg-gray-500/10`}>
                      {priorityLabels[selectedMessage.priority].label} priorytet
                    </span>
                    <span className="px-3 py-1 rounded-full text-xs text-gray-400 bg-gray-500/10">
                      {categoryLabels[selectedMessage.category]}
                    </span>
                    <span className="px-3 py-1 rounded-full text-xs text-gray-400 bg-gray-500/10">
                      {selectedMessage.source_page}
                    </span>
                  </div>

                  <div className="mt-4 flex gap-2">
                    <button
                      onClick={() => setShowReplyModal(true)}
                      className="px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors text-sm font-medium flex items-center gap-2"
                    >
                      <Send className="w-4 h-4" />
                      Odpowiedz
                    </button>
                    {selectedMessage.status !== 'replied' && (
                      <button
                        onClick={() => updateMessageStatus(selectedMessage.id, 'replied')}
                        className="px-4 py-2 bg-green-500/20 text-green-400 rounded-lg hover:bg-green-500/30 transition-colors text-sm"
                      >
                        Oznacz jako odpowiedziano
                      </button>
                    )}
                    {selectedMessage.status !== 'archived' && (
                      <button
                        onClick={() => updateMessageStatus(selectedMessage.id, 'archived')}
                        className="px-4 py-2 bg-gray-500/20 text-gray-400 rounded-lg hover:bg-gray-500/30 transition-colors text-sm"
                      >
                        Archiwizuj
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-6">
                  <div className="mb-6">
                    <h3 className="text-sm font-semibold text-gray-400 mb-2">WIADOMOŚĆ</h3>
                    <div className="bg-[#0f1119] rounded-lg p-4 border border-[#d3bb73]/10">
                      <p className="text-white whitespace-pre-wrap">{selectedMessage.message}</p>
                    </div>
                  </div>

                  <div className="mb-6">
                    <h3 className="text-sm font-semibold text-gray-400 mb-2">NOTATKI WEWNĘTRZNE</h3>
                    <textarea
                      value={notesText}
                      onChange={(e) => setNotesText(e.target.value)}
                      placeholder="Dodaj notatki do tej wiadomości..."
                      className="w-full px-4 py-3 bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-[#d3bb73] resize-none"
                      rows={4}
                    />
                    <button
                      onClick={handleSaveNotes}
                      className="mt-2 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors text-sm font-medium"
                    >
                      Zapisz notatki
                    </button>
                  </div>

                  <div className="text-xs text-gray-500 space-y-1">
                    <div className="flex items-center gap-2">
                      <Calendar className="w-3 h-3" />
                      Utworzono: {new Date(selectedMessage.created_at).toLocaleString('pl-PL')}
                    </div>
                    {selectedMessage.read_at && (
                      <div className="flex items-center gap-2">
                        <Eye className="w-3 h-3" />
                        Przeczytano: {new Date(selectedMessage.read_at).toLocaleString('pl-PL')}
                      </div>
                    )}
                    {selectedMessage.replied_at && (
                      <div className="flex items-center gap-2">
                        <Send className="w-3 h-3" />
                        Odpowiedziano: {new Date(selectedMessage.replied_at).toLocaleString('pl-PL')}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-gray-400">
                <div className="text-center">
                  <Mail className="w-16 h-16 mx-auto mb-4 opacity-50" />
                  <p>Wybierz wiadomość, aby zobaczyć szczegóły</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {showReplyModal && selectedMessage && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-[#1c1f33] rounded-xl border border-[#d3bb73]/20 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <div className="p-6 border-b border-[#d3bb73]/20">
                <h2 className="text-2xl font-bold text-white">Odpowiedz na wiadomość</h2>
                <p className="text-gray-400 mt-1">Do: {selectedMessage.email}</p>
              </div>

              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Konto email
                  </label>
                  <select
                    value={selectedEmailAccount}
                    onChange={(e) => setSelectedEmailAccount(e.target.value)}
                    className="w-full px-4 py-2 bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
                  >
                    {emailAccounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.from_name} ({account.email_address})
                      </option>
                    ))}
                  </select>
                  {emailAccounts.length === 0 && (
                    <p className="text-yellow-400 text-sm mt-2">
                      Brak skonfigurowanych kont email. Przejdź do ustawień, aby dodać konto.
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Oryginalna wiadomość
                  </label>
                  <div className="bg-[#0f1119] rounded-lg p-4 border border-[#d3bb73]/10">
                    <p className="text-gray-400 text-sm whitespace-pre-wrap">{selectedMessage.message}</p>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Twoja odpowiedź
                  </label>
                  <textarea
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder="Napisz swoją odpowiedź..."
                    className="w-full px-4 py-3 bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-[#d3bb73] resize-none"
                    rows={8}
                  />
                </div>
              </div>

              <div className="p-6 border-t border-[#d3bb73]/20 flex gap-3 justify-end">
                <button
                  onClick={() => {
                    setShowReplyModal(false);
                    setReplyText('');
                  }}
                  className="px-6 py-2 bg-gray-500/20 text-gray-400 rounded-lg hover:bg-gray-500/30 transition-colors"
                >
                  Anuluj
                </button>
                <button
                  onClick={handleSendReply}
                  disabled={!replyText.trim() || !selectedEmailAccount || emailAccounts.length === 0}
                  className="px-6 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  <Send className="w-4 h-4" />
                  Wyślij odpowiedź
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
