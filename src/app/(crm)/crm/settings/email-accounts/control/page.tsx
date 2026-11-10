'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Eye, File, Inbox, Loader2, Paperclip, Search, Send, ShieldCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import EmailHtmlPreview from '@/app/(crm)/crm/messages/components/EmailHtmlPreview';

/*
 * Kontrola korespondencji: podgląd dowolnej skrzynki tylko do odczytu dla administratora poczty
 * (messages_manage). Strona niczego nie zmienia w wiadomościach (status „przeczytana”, gwiazdki,
 * przypisania) i nie wysyła poczty. Każde wejście w skrzynkę i otwarcie wiadomości zapisuje
 * log_mailbox_control_access. Dostęp do danych wymuszają reguły bazy (RLS), nie tylko ten widok.
 */

type Mailbox = {
  id: string;
  account_name: string;
  email_address: string;
  account_type: 'personal' | 'shared' | 'system' | string;
  is_active: boolean;
  owner_name: string | null;
  assigned_names: string | null;
  received_count: number;
  unread_count: number;
  sent_count: number;
  last_message_at: string | null;
  last_control_at: string | null;
};
type Folder = 'received' | 'sent';
type ListItem = {
  id: string;
  counterpart: string;
  subject: string;
  date: string | null;
  isRead: boolean;
  hasAttachments: boolean;
  deleted: boolean;
};
type Details = { id: string; type: Folder; subject: string; from: string; to: string; date: string | null; html: string | null; text: string | null };
type Attachment = { id: string; filename: string; content_type: string | null; size_bytes: number | null; storage_path: string };

const PAGE_SIZE = 50;
const typeLabel: Record<string, string> = { personal: 'Osobiste', shared: 'Wspólne', system: 'Systemowe' };
const formatDate = (value: string | null) => (value ? new Date(value).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' }) : '—');
// Znaki o specjalnym znaczeniu w filtrze PostgREST (or=…) usuwamy z wyszukiwanej frazy.
const cleanSearch = (value: string) => value.replace(/[,()%*\\]/g, ' ').trim();

function MailboxControl() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { employee, loading: employeeLoading } = useCurrentEmployee();
  const canControl = Boolean(employee?.permissions?.includes('messages_manage'));

  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [accountId, setAccountId] = useState<string | null>(searchParams.get('account'));
  const [folder, setFolder] = useState<Folder>('received');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<ListItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [details, setDetails] = useState<Details | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [logWarning, setLogWarning] = useState(false);

  const mailbox = useMemo(() => mailboxes.find((entry) => entry.id === accountId) || null, [mailboxes, accountId]);

  useEffect(() => {
    if (!canControl) return;
    (async () => {
      setLoadingOverview(true);
      const { data, error } = await supabase.rpc('get_mailbox_control_overview');
      if (error) {
        setOverviewError(error.code === 'PGRST202'
          ? 'Brak funkcji kontroli w bazie. Zastosuj migrację 20261031190000_mailbox_view_preferences_and_control.'
          : 'Nie udało się wczytać listy skrzynek.');
      } else {
        setMailboxes((data || []) as Mailbox[]);
      }
      setLoadingOverview(false);
    })();
  }, [canControl]);

  const logAccess = useCallback(async (account: string, type?: Folder, emailId?: string) => {
    const { error } = await supabase.rpc('log_mailbox_control_access', {
      p_account_id: account, p_email_type: type ?? null, p_email_id: emailId ?? null,
    });
    if (error) setLogWarning(true);
  }, []);

  const loadPage = useCallback(async (account: string, currentFolder: Folder, phrase: string, offset: number) => {
    setLoadingList(true);
    setListError(null);
    try {
      const term = cleanSearch(phrase);
      let rows: ListItem[] = [];
      if (currentFolder === 'received') {
        let query = supabase.from('received_emails')
          .select('id, from_address, subject, received_date, is_read, has_attachments, deleted_at')
          .eq('email_account_id', account)
          .order('received_date', { ascending: false })
          .range(offset, offset + PAGE_SIZE);
        if (term) query = query.or(`subject.ilike.%${term}%,from_address.ilike.%${term}%,to_address.ilike.%${term}%`);
        const { data, error } = await query;
        if (error) throw error;
        rows = (data || []).map((row: any) => ({
          id: row.id, counterpart: row.from_address || '', subject: row.subject || '(bez tematu)',
          date: row.received_date, isRead: Boolean(row.is_read), hasAttachments: Boolean(row.has_attachments), deleted: Boolean(row.deleted_at),
        }));
      } else {
        let query = supabase.from('sent_emails')
          .select('id, to_address, subject, sent_at, created_at, has_attachments, deleted_at')
          .eq('email_account_id', account)
          .order('sent_at', { ascending: false, nullsFirst: false })
          .range(offset, offset + PAGE_SIZE);
        if (term) query = query.or(`subject.ilike.%${term}%,to_address.ilike.%${term}%`);
        const { data, error } = await query;
        if (error) throw error;
        rows = (data || []).map((row: any) => ({
          id: row.id, counterpart: row.to_address || '', subject: row.subject || '(bez tematu)',
          date: row.sent_at || row.created_at, isRead: true, hasAttachments: Boolean(row.has_attachments), deleted: Boolean(row.deleted_at),
        }));
      }
      setHasMore(rows.length > PAGE_SIZE);
      const page = rows.slice(0, PAGE_SIZE);
      setItems((previous) => (offset === 0 ? page : [...previous, ...page]));
    } catch {
      setListError('Nie udało się wczytać wiadomości tej skrzynki.');
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    if (!canControl || !accountId) return;
    setDetails(null);
    setAttachments([]);
    setItems([]);
    void loadPage(accountId, folder, search, 0);
  }, [canControl, accountId, folder, search, loadPage]);

  useEffect(() => {
    if (canControl && accountId) void logAccess(accountId);
  }, [canControl, accountId, logAccess]);

  const selectMailbox = (id: string) => {
    setAccountId(id);
    setFolder('received');
    setSearch('');
    setSearchInput('');
    router.replace(`/crm/settings/email-accounts/control?account=${id}`);
  };

  const openMessage = async (item: ListItem) => {
    if (!accountId) return;
    setLoadingDetails(true);
    setAttachments([]);
    try {
      if (folder === 'received') {
        const { data, error } = await supabase.from('received_emails')
          .select('id, from_address, to_address, subject, received_date, body_html, body_text')
          .eq('id', item.id).single();
        if (error) throw error;
        setDetails({ id: data.id, type: 'received', subject: data.subject || '(bez tematu)', from: data.from_address || '',
          to: data.to_address || '', date: data.received_date, html: data.body_html, text: data.body_text });
      } else {
        const { data, error } = await supabase.from('sent_emails')
          .select('id, to_address, subject, sent_at, created_at, body')
          .eq('id', item.id).single();
        if (error) throw error;
        setDetails({ id: data.id, type: 'sent', subject: data.subject || '(bez tematu)', from: mailbox?.email_address || '',
          to: data.to_address || '', date: data.sent_at || data.created_at, html: data.body, text: null });
      }
      void logAccess(accountId, folder, item.id);
      const { data: files } = await supabase.from('email_attachments')
        .select('id, filename, content_type, size_bytes, storage_path')
        .eq('email_id', item.id).eq('email_type', folder).order('created_at');
      setAttachments((files || []) as Attachment[]);
    } catch {
      setDetails(null);
      setListError('Nie udało się otworzyć wiadomości.');
    } finally {
      setLoadingDetails(false);
    }
  };

  const downloadAttachment = async (attachment: Attachment) => {
    const { data, error } = await supabase.storage.from('email-attachments').download(attachment.storage_path);
    if (error || !data) {
      setListError('Nie udało się pobrać załącznika.');
      return;
    }
    const url = URL.createObjectURL(data);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = attachment.filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  if (employeeLoading) {
    return <div className="flex min-h-[400px] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-[#d3bb73]" /></div>;
  }
  if (!canControl) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center p-6 text-center">
        <h2 className="mb-2 text-2xl font-bold text-white">Brak dostępu</h2>
        <p className="text-sm text-[#e5e4e2]/60">Kontrola korespondencji wymaga uprawnienia do zarządzania pocztą.</p>
      </div>
    );
  }

  const groups = (['personal', 'shared', 'system'] as const)
    .map((type) => ({ type, entries: mailboxes.filter((entry) => entry.account_type === type) }))
    .filter((group) => group.entries.length > 0);

  return (
    <div className="min-h-screen bg-[#0f1119] p-4 sm:p-6">
      <div className="w-full">
        <button type="button" onClick={() => router.push('/crm/settings/email-accounts')}
          className="mb-4 flex items-center gap-2 text-sm text-[#e5e4e2]/60 hover:text-[#e5e4e2]">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Konta email
        </button>
        <h1 className="mb-1 text-2xl font-light text-[#e5e4e2]">Kontrola korespondencji</h1>
        <div className="mb-5 flex items-start gap-3 rounded-lg border border-[#d3bb73]/20 bg-[#d3bb73]/[0.06] p-3 text-xs leading-5 text-[#e5e4e2]/75">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#d3bb73]" aria-hidden="true" />
          <p>
            Podgląd tylko do odczytu. Otwarcie wiadomości nie zmienia jej statusu u pracownika, nie wysyła powiadomień
            i nie dodaje skrzynki do Twoich Wiadomości. Każde wejście jest zapisywane w dzienniku kontroli.
            Pracownicy powinni być wcześniej poinformowani o możliwości kontroli poczty służbowej.
          </p>
        </div>
        {logWarning && (
          <p role="alert" className="mb-4 rounded-lg bg-amber-500/10 p-3 text-xs text-amber-200">
            Nie udało się zapisać wejścia w dzienniku kontroli. Sprawdź migrację 20261031190000.
          </p>
        )}

        <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,380px)_minmax(0,1fr)]">
          <nav aria-label="Skrzynki" className="rounded-xl bg-[#1c1f33] p-3">
            {loadingOverview ? (
              <p className="p-2 text-xs text-[#e5e4e2]/50">Wczytywanie skrzynek…</p>
            ) : overviewError ? (
              <p role="alert" className="p-2 text-xs text-amber-200">{overviewError}</p>
            ) : groups.map((group) => (
              <div key={group.type} className="mb-3">
                <h2 className="px-2 pb-1 text-[11px] uppercase tracking-wide text-[#e5e4e2]/40">{typeLabel[group.type]}</h2>
                {group.entries.map((entry) => (
                  <button key={entry.id} type="button" onClick={() => selectMailbox(entry.id)}
                    aria-current={entry.id === accountId ? 'true' : undefined}
                    className={`mb-1 w-full rounded-lg px-2 py-2 text-left transition-colors ${entry.id === accountId ? 'bg-[#d3bb73]/15' : 'hover:bg-white/[0.05]'}`}>
                    <span className="flex items-center justify-between gap-2">
                      <span className={`truncate text-sm ${entry.is_active ? 'text-[#e5e4e2]' : 'text-[#e5e4e2]/40'}`}>{entry.account_name}</span>
                      {entry.unread_count > 0 && <span className="shrink-0 text-[11px] text-[#d3bb73]">{entry.unread_count}</span>}
                    </span>
                    <span className="block truncate text-[11px] text-[#e5e4e2]/45">
                      {entry.owner_name || entry.assigned_names || entry.email_address}{!entry.is_active && ' · nieaktywna'}
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </nav>

          <section aria-label="Lista wiadomości" className="min-w-0 rounded-xl bg-[#1c1f33] p-3">
            {!mailbox ? (
              <p className="p-2 text-sm text-[#e5e4e2]/50">Wybierz skrzynkę z listy.</p>
            ) : (
              <>
                <div className="mb-3 px-1">
                  <p className="truncate text-sm text-[#e5e4e2]">{mailbox.email_address}</p>
                  <p className="text-[11px] text-[#e5e4e2]/45">
                    Odebrane {mailbox.received_count} · Wysłane {mailbox.sent_count}
                    {mailbox.last_control_at && ` · ostatnia kontrola ${formatDate(mailbox.last_control_at)}`}
                  </p>
                </div>
                <div className="mb-3 flex gap-1" role="tablist" aria-label="Folder">
                  {([['received', 'Odebrane', Inbox], ['sent', 'Wysłane', Send]] as const).map(([value, label, Icon]) => (
                    <button key={value} type="button" role="tab" aria-selected={folder === value} onClick={() => setFolder(value)}
                      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs ${folder === value ? 'bg-[#d3bb73] text-[#1c1f33]' : 'text-[#e5e4e2]/70 hover:bg-white/[0.06]'}`}>
                      <Icon className="h-3.5 w-3.5" aria-hidden="true" />{label}
                    </button>
                  ))}
                </div>
                <form className="mb-3 flex gap-2" onSubmit={(event) => { event.preventDefault(); setSearch(searchInput); }}>
                  <label className="sr-only" htmlFor="control-search">Szukaj w skrzynce</label>
                  <input id="control-search" value={searchInput} onChange={(event) => setSearchInput(event.target.value)}
                    placeholder="Temat, nadawca lub odbiorca"
                    className="min-w-0 flex-1 rounded-lg border border-white/10 bg-[#0f1119] px-3 py-1.5 text-sm text-[#e5e4e2] placeholder:text-[#e5e4e2]/30" />
                  <button type="submit" className="rounded-lg bg-white/[0.06] px-3 text-[#e5e4e2]/80 hover:bg-white/[0.1]" aria-label="Szukaj">
                    <Search className="h-4 w-4" aria-hidden="true" />
                  </button>
                </form>
                {listError && <p role="alert" className="mb-2 text-xs text-amber-200">{listError}</p>}
                <ul className="max-h-[65vh] space-y-1 overflow-y-auto">
                  {items.map((item) => (
                    <li key={item.id}>
                      <button type="button" onClick={() => void openMessage(item)}
                        className={`w-full rounded-lg px-2 py-2 text-left transition-colors ${details?.id === item.id ? 'bg-[#d3bb73]/15' : 'hover:bg-white/[0.05]'}`}>
                        <span className="flex items-center justify-between gap-2 text-[11px] text-[#e5e4e2]/50">
                          <span className={`truncate ${item.isRead ? '' : 'font-semibold text-[#e5e4e2]'}`}>{item.counterpart}</span>
                          <span className="shrink-0">{formatDate(item.date)}</span>
                        </span>
                        <span className="flex items-center gap-1.5">
                          {item.hasAttachments && <Paperclip className="h-3 w-3 shrink-0 text-[#d3bb73]" aria-label="Załączniki" />}
                          <span className={`truncate text-sm ${item.isRead ? 'text-[#e5e4e2]/80' : 'font-semibold text-[#e5e4e2]'}`}>{item.subject}</span>
                          {item.deleted && <span className="shrink-0 text-[10px] text-red-300/80">usunięta</span>}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                {loadingList && <p className="p-2 text-xs text-[#e5e4e2]/50">Wczytywanie…</p>}
                {!loadingList && items.length === 0 && !listError && <p className="p-2 text-xs text-[#e5e4e2]/50">Brak wiadomości.</p>}
                {hasMore && !loadingList && accountId && (
                  <button type="button" onClick={() => void loadPage(accountId, folder, search, items.length)}
                    className="mt-2 w-full rounded-lg bg-white/[0.05] py-2 text-xs text-[#e5e4e2]/70 hover:bg-white/[0.08]">
                    Wczytaj starsze
                  </button>
                )}
              </>
            )}
          </section>

          <article aria-label="Podgląd wiadomości" className="min-w-0 rounded-xl bg-[#1c1f33] p-4">
            {loadingDetails ? (
              <p className="text-sm text-[#e5e4e2]/50">Otwieranie wiadomości…</p>
            ) : !details ? (
              <p className="flex items-center gap-2 text-sm text-[#e5e4e2]/50"><Eye className="h-4 w-4" aria-hidden="true" />Wybierz wiadomość, aby ją przejrzeć.</p>
            ) : (
              <>
                <h2 className="mb-2 break-words text-lg font-light text-[#e5e4e2]">{details.subject}</h2>
                <dl className="mb-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs text-[#e5e4e2]/60">
                  <dt>Od</dt><dd className="break-words text-[#e5e4e2]/85">{details.from}</dd>
                  <dt>Do</dt><dd className="break-words text-[#e5e4e2]/85">{details.to}</dd>
                  <dt>Data</dt><dd className="text-[#e5e4e2]/85">{formatDate(details.date)}</dd>
                </dl>
                {attachments.length > 0 && (
                  <div className="mb-4 flex flex-wrap gap-1">
                    {attachments.map((attachment) => (
                      <button key={attachment.id} type="button" onClick={() => void downloadAttachment(attachment)}
                        className="flex max-w-64 items-center gap-1.5 rounded bg-white/[0.05] px-2 py-1 text-[11px] text-[#e5e4e2] hover:bg-white/[0.09]"
                        aria-label={`Pobierz załącznik: ${attachment.filename}`}>
                        <File className="h-3 w-3 shrink-0 text-[#d3bb73]" aria-hidden="true" />
                        <span className="truncate">{attachment.filename}</span>
                      </button>
                    ))}
                  </div>
                )}
                {details.html ? (
                  <EmailHtmlPreview html={details.html} emailAccountId={accountId} title={details.subject} />
                ) : (
                  <pre className="whitespace-pre-wrap break-words font-sans text-sm text-[#e5e4e2]/85">{details.text || '(brak treści)'}</pre>
                )}
              </>
            )}
          </article>
        </div>
      </div>
    </div>
  );
}

export default function MailboxControlPage() {
  return (
    <Suspense fallback={<div className="flex min-h-[400px] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-[#d3bb73]" /></div>}>
      <MailboxControl />
    </Suspense>
  );
}
