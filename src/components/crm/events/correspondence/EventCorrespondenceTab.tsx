'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Clock,
  Mail,
  Paperclip,
  MailPlus,
  Plus,
  RefreshCw,
  Reply,
  Search,
  ShieldCheck,
  Undo2,
  Users,
  X,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import FullScreenLoader from '@/components/UI/Loader/CustomModalLoader';
import ComposeEmailModal, { type EmailReplyContext } from '@/components/crm/ComposeEmailModal';
import { EmailThreadPicker } from '@/components/crm/inquiries/InquiryCorrespondencePanel';
import { loadUnifiedEmailAccounts, type UnifiedEmailAccount } from '@/components/crm/UnifiedEmailComposer';
import { dispatchCrmEmail, formatScheduledEmailDate } from '@/lib/emailScheduling';
import {
  EVENT_MAIL_SCHEDULED_LABELS,
  EVENT_MAIL_SOURCE_LABELS,
  eventMailMatches,
  excludeEventEmail,
  linkEventEmail,
  linkEventEmailManually,
  loadEventCorrespondence,
  loadEventCorrespondenceSuggestions,
  loadEventMailRecipient,
  replyHeaders,
  replySubject,
  type EventCorrespondence,
  type EventMailMessage,
  type EventMailSuggestion,
} from '@/lib/CRM/events/eventCorrespondence';

const HIDE_SYSTEM_KEY = 'crm-event-mail-hide-system';
const button = 'inline-flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-sm text-[#d3bb73] hover:bg-white/10 disabled:opacity-50';
const dateTime = (value: string | null) => (value ? new Date(value).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', dateStyle: 'short', timeStyle: 'short' }) : '');
const size = (bytes: number | null) => (bytes == null ? '' : bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

function toBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(index, index + 0x8000) as unknown as number[]);
  }
  return btoa(binary);
}

type Compose = { mode: 'new' } | { mode: 'reply'; message: EventMailMessage };
type Direction = 'all' | 'received' | 'sent';

/**
 * Zakładka „Korespondencja” eventu: wiadomości z klientem o evencie (wysłane z eventu, odpowiedzi w wątkach, korespondencja
 * zapytania, dołączone ręcznie) razem z wiadomościami systemowymi (np. potwierdzenie realizacji) — z filtrem „Ukryj systemowe”,
 * kierunkiem i wyszukiwaniem. „Napisz do klienta” i „Odpowiedz” wysyłają od osoby wysyłającej, a wiadomość trafia do wątku
 * eventu. Prywatność skrzynek jak w Wiadomościach (`get_event_correspondence`). Na Macu: `EventCorrespondenceTab`.
 */
export default function EventCorrespondenceTab({ eventId }: { eventId: string }) {
  const { showSnackbar } = useSnackbar();
  const [data, setData] = useState<EventCorrespondence | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [direction, setDirection] = useState<Direction>('all');
  const [hideSystem, setHideSystem] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [compose, setCompose] = useState<Compose | null>(null);
  const [accounts, setAccounts] = useState<UnifiedEmailAccount[]>([]);
  const [recipient, setRecipient] = useState<{ eventName: string; to: string; name: string } | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [suggestions, setSuggestions] = useState<EventMailSuggestion[] | null>(null);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);

  useEffect(() => {
    try { setHideSystem(window.localStorage.getItem(HIDE_SYSTEM_KEY) === '1'); } catch { /* Pamięć przeglądarki jest opcjonalna. */ }
  }, []);
  const toggleHideSystem = (value: boolean) => {
    setHideSystem(value);
    try { window.localStorage.setItem(HIDE_SYSTEM_KEY, value ? '1' : '0'); } catch { /* Opcjonalne. */ }
  };

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      setData(await loadEventCorrespondence(supabase, eventId));
      setError('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Nie udało się wczytać korespondencji');
    } finally {
      setRefreshing(false);
    }
  }, [eventId]);

  useEffect(() => {
    setData(null);
    setSuggestions(null);
    setSuggestionsOpen(false);
    void load();
    void loadEventMailRecipient(supabase, eventId).then(setRecipient).catch(() => setRecipient(null));
  }, [eventId, load]);

  // Nowe odpowiedzi klienta: odświeżenie po powrocie do karty.
  useEffect(() => {
    const focus = () => { if (document.visibilityState === 'visible') void load(); };
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, [load]);

  const messages = data?.messages || [];
  const visible = useMemo(
    () => messages.filter((message) => eventMailMatches(message, { query, direction, hideSystem })),
    [messages, query, direction, hideSystem],
  );
  const systemCount = messages.filter((message) => message.system).length;
  const canManage = data?.canManage === true;

  const run = async (label: string, action: () => Promise<void>, success: string) => {
    setBusy(label);
    try {
      await action();
      showSnackbar(success, 'success');
      await load();
    } catch (failure) {
      showSnackbar(failure instanceof Error ? failure.message : 'Operacja nie powiodła się', 'error');
    } finally {
      setBusy(null);
    }
  };

  const openCompose = async (next: Compose) => {
    if (!accounts.length) {
      try { setAccounts(await loadUnifiedEmailAccounts()); } catch { showSnackbar('Błąd podczas ładowania kont email', 'error'); return; }
    }
    setCompose(next);
  };

  const replyContext: EmailReplyContext | undefined = compose?.mode === 'reply'
    ? { from: compose.message.from, to: compose.message.to, date: compose.message.at, subject: compose.message.subject, body: compose.message.body }
    : undefined;

  const send = async (draft: {
    to: string; subject: string; bodyHtml: string; attachments?: File[]; fromAccountId?: string; cc?: string; bcc?: string; scheduledAt?: string | null;
  }) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Brak sesji użytkownika');
    if (!draft.fromAccountId) throw new Error('Wybierz konto pocztowe nadawcy');
    const attachments = [];
    for (const file of draft.attachments || []) {
      attachments.push({ filename: file.name, content: toBase64(await file.arrayBuffer()), contentType: file.type || 'application/octet-stream' });
    }
    const headers = compose?.mode === 'reply' && compose.message.type === 'received' ? await replyHeaders(supabase, compose.message.id) : null;
    const result = await dispatchCrmEmail({
      accessToken: session.access_token,
      functionName: 'send-email',
      scheduledAt: draft.scheduledAt,
      metadata: { eventId, actionUrl: `/crm/events/${eventId}?tab=correspondence` },
      payload: {
        emailAccountId: draft.fromAccountId,
        to: draft.to,
        cc: draft.cc,
        bcc: draft.bcc,
        subject: draft.subject,
        body: draft.bodyHtml,
        attachments,
        inReplyTo: headers?.inReplyTo,
        references: headers?.references,
      },
    });
    await linkEventEmail(supabase, eventId, result);
    showSnackbar(
      result.scheduled && result.scheduledAt ? `Wiadomość zostanie wysłana ${formatScheduledEmailDate(result.scheduledAt)}` : 'Wiadomość wysłana',
      'success',
    );
    if (result.warning) showSnackbar(String(result.warning), 'warning');
    setCompose(null);
    void load();
  };

  const toggleSuggestions = async () => {
    const next = !suggestionsOpen;
    setSuggestionsOpen(next);
    if (!next || suggestions) return;
    setSuggestionsLoading(true);
    try {
      const known = [...messages.map((message) => message.key), ...(data?.excluded || []).map((item) => item.key)];
      setSuggestions((await loadEventCorrespondenceSuggestions(supabase, eventId, known)).messages);
    } catch (failure) {
      showSnackbar(failure instanceof Error ? failure.message : 'Nie udało się wyszukać wiadomości', 'error');
      setSuggestionsOpen(false);
    } finally {
      setSuggestionsLoading(false);
    }
  };

  const attachSuggestion = (item: EventMailSuggestion) =>
    run('Dołączanie wiadomości', async () => {
      await linkEventEmailManually(supabase, eventId, item.type, item.id, true);
      setSuggestions((current) => current?.filter((entry) => entry.key !== item.key) || null);
    }, 'Wiadomość dołączona do korespondencji eventu');

  return (
    <section className="space-y-4">
      <FullScreenLoader show={busy !== null} title={busy || ''} description="Czekamy na potwierdzenie serwera." />
      {compose && (
        <ComposeEmailModal
          isOpen
          onClose={() => setCompose(null)}
          onSend={send}
          emailAccounts={accounts}
          initialTo={compose.mode === 'reply' ? compose.message.from : recipient?.to || ''}
          initialSubject={compose.mode === 'reply' ? replySubject(compose.message.subject) : recipient?.eventName || ''}
          replyContext={replyContext}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-light text-[#e5e4e2]">Korespondencja</h2>
          <p className="text-sm text-[#e5e4e2]/60">
            {data ? `${messages.length} ${messages.length === 1 ? 'wiadomość' : 'wiadomości'}${systemCount ? ` · systemowe: ${systemCount}` : ''}` : 'Wczytywanie…'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={button} disabled={refreshing} onClick={() => void load()} aria-label="Odśwież korespondencję">
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
          {canManage && (
            <button type="button" className={button} onClick={() => setShowPicker((value) => !value)}>
              <Plus className="h-4 w-4" />Dołącz wiadomość lub konwersację
            </button>
          )}
          <button type="button" className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
            onClick={() => void openCompose({ mode: 'new' })}>
            <MailPlus className="h-4 w-4" />Napisz do klienta
          </button>
        </div>
      </div>

      <p className="text-xs text-[#e5e4e2]/50">
        Wiadomości wysłane z eventu (agenda, kalkulacja, umowa, oferta i faktura eventu), odpowiedzi klienta w tych wątkach,
        korespondencja zapytania i wiadomości dołączone ręcznie. Widzisz wiadomości ze swoich skrzynek oraz wiadomości systemowe o evencie.
      </p>

      {showPicker && canManage && (
        <EmailThreadPicker onAttach={async (message, wholeThread) => {
          await linkEventEmailManually(supabase, eventId, message.type, message.id, wholeThread);
          setShowPicker(false);
          showSnackbar('Korespondencja została dołączona do eventu', 'success');
          await load();
        }} />
      )}

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#d3bb73]/15 bg-[#1c1f33] p-3">
        <label className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#e5e4e2]/40" aria-hidden />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Szukaj w temacie, adresach, treści…"
            aria-label="Szukaj w korespondencji"
            className="w-full rounded-lg border border-white/10 bg-[#0f1119] py-2 pl-9 pr-3 text-sm text-[#e5e4e2] placeholder-[#e5e4e2]/30" />
        </label>
        <div className="flex rounded-lg border border-white/10 p-0.5" role="radiogroup" aria-label="Kierunek">
          {([['all', 'Wszystkie'], ['received', 'Odebrane'], ['sent', 'Wysłane']] as const).map(([value, label]) => (
            <button key={value} type="button" role="radio" aria-checked={direction === value} onClick={() => setDirection(value)}
              className={`rounded-md px-3 py-1.5 text-xs ${direction === value ? 'bg-[#d3bb73]/20 text-[#d3bb73]' : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'}`}>
              {label}
            </button>
          ))}
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-[#e5e4e2]/80">
          <input type="checkbox" checked={hideSystem} onChange={(event) => toggleHideSystem(event.target.checked)} className="h-4 w-4 rounded border-[#d3bb73]/40 bg-[#0a0d1a]" />
          Ukryj systemowe
        </label>
      </div>

      {error && <p role="alert" className="rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">{error}</p>}

      {(data?.scheduled.length || 0) > 0 && (
        <div className="space-y-2 rounded-xl border border-sky-400/20 bg-sky-400/5 p-4">
          <p className="flex items-center gap-2 text-sm font-medium text-sky-100"><Clock className="h-4 w-4" aria-hidden />Zaplanowane wysyłki</p>
          {data?.scheduled.map((item) => (
            <div key={item.id} className="flex flex-wrap items-baseline justify-between gap-2 text-sm text-[#e5e4e2]/80">
              <span className="min-w-0 truncate">{item.subject || '(bez tematu)'} → {item.to}</span>
              <span className={`text-xs ${item.status === 'failed' ? 'text-red-300' : 'text-sky-200'}`}>
                {EVENT_MAIL_SCHEDULED_LABELS[item.status] || item.status}{item.scheduledAt ? ` · ${dateTime(item.scheduledAt)}` : ''}{item.author ? ` · ${item.author}` : ''}
                {item.error ? ` — ${item.error}` : ''}
              </span>
            </div>
          ))}
        </div>
      )}

      {!data && !error ? (
        <p className="text-sm text-[#e5e4e2]/50">Wczytywanie korespondencji…</p>
      ) : data && visible.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-[#1c1f33] p-8 text-center text-sm text-[#e5e4e2]/60">
          {messages.length ? 'Żadna wiadomość nie pasuje do filtrów.' : 'Brak wiadomości o tym evencie w Twoich skrzynkach. Wiadomości wysłane z eventu i odpowiedzi klienta pojawią się tutaj.'}
        </div>
      ) : (
        <ul className="space-y-2">
          {visible.map((message) => {
            const expanded = open.has(message.key);
            const incoming = message.type === 'received';
            return (
              <li key={message.key} className={`rounded-xl border p-4 ${message.system ? 'border-white/5 bg-white/[0.02]' : 'border-[#d3bb73]/15 bg-[#1c1f33]'}`}>
                <button type="button" className="flex w-full items-start gap-3 text-left" aria-expanded={expanded}
                  onClick={() => setOpen((current) => { const next = new Set(current); if (next.has(message.key)) next.delete(message.key); else next.add(message.key); return next; })}>
                  {incoming
                    ? <ArrowDownLeft className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" aria-label="Odebrana" />
                    : <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 text-[#d3bb73]" aria-label="Wysłana" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <p className="min-w-0 truncate font-medium text-[#e5e4e2]">{message.subject || '(bez tematu)'}</p>
                      <span className="shrink-0 text-xs text-[#e5e4e2]/50">{dateTime(message.at)}</span>
                    </div>
                    <p className="truncate text-xs text-[#e5e4e2]/55">{incoming ? `Od: ${message.from}` : `Do: ${message.to}`}{!incoming && message.from ? ` · z ${message.from}` : ''}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
                      <span className="rounded-full bg-white/5 px-2 py-0.5 text-[#e5e4e2]/60">{EVENT_MAIL_SOURCE_LABELS[message.source]}</span>
                      {message.system && <span className="inline-flex items-center gap-1 rounded-full bg-sky-400/10 px-2 py-0.5 text-sky-200"><ShieldCheck className="h-3 w-3" aria-hidden />Systemowa</span>}
                      {message.attachments.length > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-0.5 text-[#e5e4e2]/60"><Paperclip className="h-3 w-3" aria-hidden />{message.attachments.length}</span>}
                    </div>
                    {!expanded && message.body && <p className="mt-2 line-clamp-2 text-sm text-[#e5e4e2]/60">{message.body}</p>}
                  </div>
                </button>
                {expanded && (
                  <div className="mt-3 space-y-3 border-t border-white/5 pt-3">
                    <p className="break-words text-xs text-[#e5e4e2]/50">{message.from} → {message.to}</p>
                    <div className="max-h-[28rem] overflow-y-auto whitespace-pre-wrap break-words text-sm text-[#e5e4e2]/80">{message.body || 'Brak treści wiadomości.'}</div>
                    {message.attachments.length > 0 && (
                      <ul className="flex flex-wrap gap-2">
                        {message.attachments.map((attachment) => (
                          <li key={attachment.id} className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-2.5 py-1 text-xs text-[#e5e4e2]/70">
                            <Paperclip className="h-3 w-3" aria-hidden />{attachment.filename}{attachment.size ? ` · ${size(attachment.size)}` : ''}
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {message.accessible && incoming && (
                        <button type="button" className={button} onClick={() => void openCompose({ mode: 'reply', message })}><Reply className="h-4 w-4" />Odpowiedz</button>
                      )}
                      {message.accessible && (
                        <Link className={button} href={`/crm/messages/${message.id}?type=${message.type}`}><Mail className="h-4 w-4" />Otwórz w Wiadomościach</Link>
                      )}
                      {canManage && (
                        <button type="button" className={button} disabled={busy !== null}
                          onClick={() => void run('Wykluczanie wiadomości', () => excludeEventEmail(supabase, eventId, message.type, message.id, true), 'Wiadomość wykluczona z korespondencji eventu')}>
                          <X className="h-4 w-4" />Wyklucz z eventu
                        </button>
                      )}
                    </div>
                    {!message.accessible && (
                      <p className="text-xs text-[#e5e4e2]/40">Wiadomość ze skrzynki, do której nie masz dostępu — widoczna tutaj jako wiadomość systemowa o evencie.</p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="rounded-xl border border-white/10 bg-[#1c1f33]">
        <button type="button" className="flex w-full items-center justify-between gap-3 p-4 text-left text-sm text-[#e5e4e2]/80" aria-expanded={suggestionsOpen} onClick={() => void toggleSuggestions()}>
          <span className="flex items-center gap-2"><Users className="h-4 w-4 text-[#d3bb73]" aria-hidden />Inne wiadomości z klientem</span>
          <span className="text-xs text-[#e5e4e2]/40">{suggestionsOpen ? 'Zwiń' : 'Pokaż'}</span>
        </button>
        {suggestionsOpen && (
          <div className="space-y-2 border-t border-white/5 p-4">
            <p className="text-xs text-[#e5e4e2]/50">Niepowiązane wiadomości z adresami klienta (osoba kontaktowa, organizacja, jej domeny) z okresu eventu — tylko z Twoich skrzynek.</p>
            {suggestionsLoading ? (
              <p className="text-sm text-[#e5e4e2]/50">Wyszukiwanie…</p>
            ) : !suggestions?.length ? (
              <p className="text-sm text-[#e5e4e2]/50">Brak innych wiadomości z klientem.</p>
            ) : (
              suggestions.map((item) => (
                <div key={item.key} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-black/15 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate text-[#e5e4e2]">{item.subject || '(bez tematu)'}</p>
                    <p className="truncate text-xs text-[#e5e4e2]/50">{item.type === 'received' ? `Od: ${item.from}` : `Do: ${item.to}`} · {dateTime(item.at)}</p>
                  </div>
                  <div className="flex gap-2">
                    <Link className={button} href={`/crm/messages/${item.id}?type=${item.type}`}>Otwórz</Link>
                    {canManage && <button type="button" className={button} disabled={busy !== null} onClick={() => void attachSuggestion(item)}><Plus className="h-4 w-4" />Dołącz z wątkiem</button>}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {canManage && (data?.excluded.length || 0) > 0 && (
        <details className="rounded-xl border border-white/10 bg-[#1c1f33] p-4">
          <summary className="cursor-pointer text-sm text-[#e5e4e2]/60">Wykluczone wiadomości ({data?.excluded.length})</summary>
          <div className="mt-3 space-y-2">
            {data?.excluded.map((item) => (
              <div key={item.key} className="flex flex-wrap items-center justify-between gap-2 text-sm text-[#e5e4e2]/70">
                <span className="min-w-0 truncate">{item.subject || 'Wiadomość spoza Twoich skrzynek'}{item.at ? ` · ${dateTime(item.at)}` : ''}</span>
                <button type="button" className={button} disabled={busy !== null}
                  onClick={() => void run('Przywracanie wiadomości', () => excludeEventEmail(supabase, eventId, item.type, item.id, false), 'Wiadomość przywrócona do korespondencji eventu')}>
                  <Undo2 className="h-4 w-4" />Przywróć
                </button>
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
