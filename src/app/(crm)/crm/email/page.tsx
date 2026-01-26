'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/browser';
import {
  Mail,
  RefreshCw,
  Inbox,
  Send as SendIcon,
  Search,
  Calendar,
  User,
  Loader2,
  MessageSquare,
} from 'lucide-react';

interface Email {
  from: string;
  to: string;
  subject: string;
  date: Date;
  text: string;
  html: string;
  messageId: string;
  type?: 'received' | 'sent';
  source?: 'contact_form' | 'sent_emails' | 'imap';
}

export default function EmailPage() {
  const [emails, setEmails] = useState<Email[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [loading, setLoading] = useState(false);
  const [emailAccounts, setEmailAccounts] = useState<any[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<string>('contact_form');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'contact_form' | 'sent' | 'imap'>('all');

  useEffect(() => {
    fetchEmailAccounts();
  }, []);

  const fetchEmailAccounts = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('employee_email_accounts')
        .select('*')
        .eq('is_active', true);

      if (error) throw error;

      const accounts = [
        {
          id: 'contact_form',
          email_address: 'Wiadomości z formularza',
          from_name: 'Formularz kontaktowy',
        },
        ...(data || []),
      ];

      setEmailAccounts(accounts);
    } catch (error) {
      console.error('Error fetching email accounts:', error);
    }
  };

  const fetchEmails = async () => {
    if (!selectedAccount) {
      alert('Wybierz źródło wiadomości');
      return;
    }

    setLoading(true);
    try {
      // Jeśli wybrano "Formularz kontaktowy"
      if (selectedAccount === 'contact_form') {
        const { data, error } = await supabase
          .from('contact_messages')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(50);

        if (error) throw error;

        const formattedEmails: Email[] = (data || []).map((msg: any) => ({
          from: `${msg.name} <${msg.email}>`,
          to: 'Formularz kontaktowy',
          subject: msg.subject || 'Wiadomość z formularza',
          date: new Date(msg.created_at),
          text: msg.message,
          html: `<p><strong>Od:</strong> ${msg.name} (${msg.email})</p>
                 ${msg.phone ? `<p><strong>Telefon:</strong> ${msg.phone}</p>` : ''}
                 <p><strong>Wiadomość:</strong></p>
                 <p>${(msg.message || '').replace(/\n/g, '<br>')}</p>`,
          messageId: msg.id,
          type: 'received',
          source: 'contact_form',
        }));

        setEmails(formattedEmails);
        alert(`Pobrano ${formattedEmails.length} wiadomości z formularza`);
        setLoading(false);
        return;
      }

      // Dla innych kont - użyj edge function
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        alert('Musisz być zalogowany');
        return;
      }

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

      if (!result.success) {
        throw new Error(result.error || 'Nie udało się pobrać wiadomości');
      }

      setEmails(result.emails || []);
      alert(`Pobrano ${result.count || 0} wiadomości`);
    } catch (error) {
      console.error('Error fetching emails:', error);
      alert(`Błąd: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
      <div className="mx-auto max-w-7xl">
        <div className="mb-6">
          <h1 className="mb-2 text-3xl font-bold text-white">Poczta Email</h1>
          <p className="text-gray-400">Zarządzaj swoją pocztą email</p>
        </div>

        <div className="mb-6 rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] p-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="min-w-[200px] flex-1">
              <select
                value={selectedAccount}
                onChange={(e) => setSelectedAccount(e.target.value)}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-white focus:border-[#d3bb73] focus:outline-none"
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
              disabled={loading || !selectedAccount}
              className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-2 font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Pobieranie...
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4" />
                  Pobierz wiadomości
                </>
              )}
            </button>
          </div>

          {emailAccounts.length === 0 && (
            <p className="mt-4 text-sm text-yellow-400">
              Brak skonfigurowanych kont email. Przejdź do ustawień pracownika, aby dodać konto.
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="overflow-hidden rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] lg:col-span-1">
            <div className="border-b border-[#d3bb73]/20 p-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 transform text-gray-400" />
                <input
                  type="text"
                  placeholder="Szukaj wiadomości..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] py-2 pl-10 pr-4 text-white placeholder-gray-500 focus:border-[#d3bb73] focus:outline-none"
                />
              </div>
            </div>

            <div className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 400px)' }}>
              {loading ? (
                <div className="p-8 text-center text-gray-400">
                  <Loader2 className="mx-auto mb-2 h-8 w-8 animate-spin" />
                  Ładowanie...
                </div>
              ) : filteredEmails.length === 0 ? (
                <div className="p-8 text-center text-gray-400">
                  <Inbox className="mx-auto mb-2 h-12 w-12 opacity-50" />
                  {emails.length === 0 ? 'Brak wiadomości' : 'Brak wyników wyszukiwania'}
                </div>
              ) : (
                filteredEmails.map((email, index) => (
                  <div
                    key={index}
                    onClick={() => setSelectedEmail(email)}
                    className={`cursor-pointer border-b border-[#d3bb73]/10 p-4 transition-colors ${
                      selectedEmail?.messageId === email.messageId
                        ? 'bg-[#d3bb73]/10'
                        : 'hover:bg-[#0f1119]'
                    }`}
                  >
                    <div className="mb-2 flex items-start justify-between">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-white">{email.from}</p>
                        <p className="truncate text-sm font-semibold text-gray-300">
                          {email.subject}
                        </p>
                      </div>
                      <span className="ml-2 flex-shrink-0 text-xs text-gray-500">
                        {formatDate(email.date)}
                      </span>
                    </div>
                    <p className="line-clamp-2 text-sm text-gray-400">{email.text}</p>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] lg:col-span-2">
            {selectedEmail ? (
              <div className="flex h-full flex-col">
                <div className="border-b border-[#d3bb73]/20 p-6">
                  <h2 className="mb-4 text-2xl font-bold text-white">{selectedEmail.subject}</h2>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-start gap-2">
                      <User className="mt-0.5 h-4 w-4 text-gray-400" />
                      <div>
                        <p className="text-gray-400">Od:</p>
                        <p className="text-white">{selectedEmail.from}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <SendIcon className="mt-0.5 h-4 w-4 text-gray-400" />
                      <div>
                        <p className="text-gray-400">Do:</p>
                        <p className="text-white">{selectedEmail.to}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <Calendar className="mt-0.5 h-4 w-4 text-gray-400" />
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
                  <div className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-4">
                    {selectedEmail.html ? (
                      <div
                        className="prose prose-invert max-w-none text-white"
                        dangerouslySetInnerHTML={{ __html: selectedEmail.html }}
                      />
                    ) : (
                      <p className="whitespace-pre-wrap text-white">{selectedEmail.text}</p>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-gray-400">
                <div className="text-center">
                  <Mail className="mx-auto mb-4 h-16 w-16 opacity-50" />
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




