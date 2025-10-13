'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import {
  Mail,
  RefreshCw,
  Inbox,
  Send as SendIcon,
  Search,
  Calendar,
  User,
  Loader2,
} from 'lucide-react';

interface Email {
  from: string;
  to: string;
  subject: string;
  date: Date;
  text: string;
  html: string;
  messageId: string;
}

export default function EmailPage() {
  const [emails, setEmails] = useState<Email[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [loading, setLoading] = useState(false);
  const [emailAccounts, setEmailAccounts] = useState<any[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchEmailAccounts();
  }, []);

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
        setSelectedAccount(data[0].id);
      }
    } catch (error) {
      console.error('Error fetching email accounts:', error);
    }
  };

  const fetchEmails = async () => {
    setLoading(true);
    try {
      // Pobierz wiadomości z formularza kontaktowego jako tymczasowe rozwiązanie
      const { data, error } = await supabase
        .from('contact_messages')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      // Przekształć wiadomości kontaktowe na format emaila
      const formattedEmails = (data || []).map((msg: any) => ({
        from: `${msg.name} <${msg.email}>`,
        to: selectedAccount ? emailAccounts.find(a => a.id === selectedAccount)?.email_address || '' : '',
        subject: msg.subject || 'Wiadomość z formularza kontaktowego',
        date: new Date(msg.created_at),
        text: msg.message,
        html: `<p><strong>Od:</strong> ${msg.name} (${msg.email})</p>
               ${msg.phone ? `<p><strong>Telefon:</strong> ${msg.phone}</p>` : ''}
               <p><strong>Wiadomość:</strong></p>
               <p>${msg.message.replace(/\n/g, '<br>')}</p>`,
        messageId: msg.id,
      }));

      setEmails(formattedEmails);
      alert(`Pobrano ${formattedEmails.length} wiadomości z formularza kontaktowego`);
    } catch (error) {
      console.error('Error fetching emails:', error);
      alert(`Błąd podczas pobierania wiadomości: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (date: Date) => {
    const d = new Date(date);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffHours < 24) {
      return d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
    }
    if (diffDays < 7) {
      return d.toLocaleDateString('pl-PL', { weekday: 'short' });
    }
    return d.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' });
  };

  const filteredEmails = emails.filter((email) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      email.from.toLowerCase().includes(query) ||
      email.subject.toLowerCase().includes(query) ||
      email.text.toLowerCase().includes(query)
    );
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1a1d2e] to-[#16213e] p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-white mb-2">Poczta Email</h1>
          <p className="text-gray-400">Zarządzaj swoją pocztą email</p>
          <div className="mt-3 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
            <p className="text-yellow-400 text-sm">
              <strong>Uwaga:</strong> Obecnie wyświetlane są tylko wiadomości z formularza kontaktowego.
              Pobieranie emaili przez IMAP nie jest dostępne w środowisku Supabase Edge Functions.
            </p>
          </div>
        </div>

        <div className="bg-[#1c1f33] rounded-xl border border-[#d3bb73]/20 p-4 mb-6">
          <div className="flex flex-wrap gap-4 items-center">
            <div className="flex-1 min-w-[200px]">
              <select
                value={selectedAccount}
                onChange={(e) => setSelectedAccount(e.target.value)}
                className="w-full px-4 py-2 bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg text-white focus:outline-none focus:border-[#d3bb73]"
              >
                {emailAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.from_name} ({account.email_address})
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={fetchEmails}
              disabled={loading}
              className="px-6 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Pobieranie...
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4" />
                  Pobierz wiadomości kontaktowe
                </>
              )}
            </button>
          </div>

          {emailAccounts.length === 0 && (
            <p className="text-yellow-400 text-sm mt-4">
              Brak skonfigurowanych kont email. Przejdź do ustawień pracownika, aby dodać konto.
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 bg-[#1c1f33] rounded-xl border border-[#d3bb73]/20 overflow-hidden">
            <div className="p-4 border-b border-[#d3bb73]/20">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Szukaj wiadomości..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-[#d3bb73]"
                />
              </div>
            </div>

            <div className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 400px)' }}>
              {loading ? (
                <div className="p-8 text-center text-gray-400">
                  <Loader2 className="w-8 h-8 mx-auto mb-2 animate-spin" />
                  Ładowanie...
                </div>
              ) : filteredEmails.length === 0 ? (
                <div className="p-8 text-center text-gray-400">
                  <Inbox className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  {emails.length === 0 ? 'Brak wiadomości' : 'Brak wyników wyszukiwania'}
                </div>
              ) : (
                filteredEmails.map((email, index) => (
                  <div
                    key={index}
                    onClick={() => setSelectedEmail(email)}
                    className={`p-4 border-b border-[#d3bb73]/10 cursor-pointer transition-colors ${
                      selectedEmail?.messageId === email.messageId
                        ? 'bg-[#d3bb73]/10'
                        : 'hover:bg-[#0f1119]'
                    }`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-white truncate">{email.from}</p>
                        <p className="text-sm text-gray-300 truncate font-semibold">{email.subject}</p>
                      </div>
                      <span className="text-xs text-gray-500 ml-2 flex-shrink-0">
                        {formatDate(email.date)}
                      </span>
                    </div>
                    <p className="text-sm text-gray-400 line-clamp-2">{email.text}</p>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="lg:col-span-2 bg-[#1c1f33] rounded-xl border border-[#d3bb73]/20 overflow-hidden">
            {selectedEmail ? (
              <div className="h-full flex flex-col">
                <div className="p-6 border-b border-[#d3bb73]/20">
                  <h2 className="text-2xl font-bold text-white mb-4">{selectedEmail.subject}</h2>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-start gap-2">
                      <User className="w-4 h-4 text-gray-400 mt-0.5" />
                      <div>
                        <p className="text-gray-400">Od:</p>
                        <p className="text-white">{selectedEmail.from}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <SendIcon className="w-4 h-4 text-gray-400 mt-0.5" />
                      <div>
                        <p className="text-gray-400">Do:</p>
                        <p className="text-white">{selectedEmail.to}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <Calendar className="w-4 h-4 text-gray-400 mt-0.5" />
                      <div>
                        <p className="text-gray-400">Data:</p>
                        <p className="text-white">
                          {new Date(selectedEmail.date).toLocaleString('pl-PL')}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-6">
                  <div className="bg-[#0f1119] rounded-lg p-4 border border-[#d3bb73]/10">
                    {selectedEmail.html ? (
                      <div
                        className="text-white prose prose-invert max-w-none"
                        dangerouslySetInnerHTML={{ __html: selectedEmail.html }}
                      />
                    ) : (
                      <p className="text-white whitespace-pre-wrap">{selectedEmail.text}</p>
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
      </div>
    </div>
  );
}
