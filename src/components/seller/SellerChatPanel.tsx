'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Loader2, MessageSquare, Plus, Send } from 'lucide-react';
import SearchCombobox from '@/components/crm/SearchCombobox';
import { supabase } from '@/lib/supabase/browser';
import { refreshSellerInbox } from '@/lib/seller/inbox';
import { refreshSellerSidebarBadge } from '@/lib/seller/sidebarBadge';
import { SellerCountBadge } from './SellerInboxPanel';

export type ChatBrand = { id: string; name: string; can_chat?: boolean };
export type ChatOffer = { id: string; my_company_id: string; title: string | null; offer_number: string | null };
export type SellerConversation = {
  id: string; my_company_id: string; brand_name: string; offer_id: string | null;
  title: string; offer_title?: string | null; has_event?: boolean;
  event_id?: string | null; event_name?: string | null; can_view_event?: boolean;
  last_message: string | null; last_at: string | null; unread: number; can_send: boolean;
};
type Message = { id: string; seq: number; sender_kind: string; sender_name: string; body: string; created_at: string; own: boolean };

export function ConversationMessages({ conversation, crm, onRead, compact = false, fitViewport = false, realization = false }: { conversation: SellerConversation; crm: boolean; onRead: () => void; compact?: boolean; fitViewport?: boolean; realization?: boolean }) {
  const isRealization = Boolean(conversation.offer_id && (realization || conversation.has_event));
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [older, setOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef<{ id: string; text: string } | null>(null);
  const sendLock = useRef(false);
  const alive = useRef(true);
  const readThrough = useRef(0);
  const messagesRef = useRef<Message[]>([]);
  const initial = useRef(true);
  const listRef = useRef<HTMLDivElement>(null);
  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;

  const reload = useCallback(async () => {
    if (document.visibilityState !== 'visible') return;
    const { data, error: fetchError } = await supabase.rpc('get_seller_messages', { p_conversation: conversation.id });
    if (!alive.current) return;
    setLoading(false);
    if (fetchError) { setError('Nie udało się wczytać rozmowy. Ponowimy za chwilę.'); return; }
    const rows: Message[] = data || [];
    const el = listRef.current;
    const atBottom = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    const newest = Number(rows[rows.length - 1]?.seq || 0);
    const changed = newest !== Number(messagesRef.current[messagesRef.current.length - 1]?.seq || 0);
    if (initial.current) setHasOlder(rows.length === 50);
    const merged = [...new Map([...messagesRef.current, ...rows].map((row) => [row.id, row])).values()].sort((a, b) => Number(a.seq) - Number(b.seq));
    messagesRef.current = merged;
    setMessages(merged);
    if (initial.current || (atBottom && changed)) window.requestAnimationFrame(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; });
    initial.current = false;
    // An embedded offer thread can be below the PDF and outside the viewport.
    // Do not consume unread messages until the user actually sees the thread.
    const bounds = el?.getBoundingClientRect();
    const inView = Boolean(bounds && bounds.height > 0 && bounds.width > 0 && bounds.bottom > 0 && bounds.top < window.innerHeight);
    if (inView && newest > readThrough.current && (atBottom || readThrough.current === 0) && document.visibilityState === 'visible') {
      const { error: readError } = await supabase.rpc('mark_seller_conversation_read', { p_conversation: conversation.id, p_through: newest });
      if (!readError && alive.current) { readThrough.current = newest; onReadRef.current(); void refreshSellerInbox(); void refreshSellerSidebarBadge(); }
    }
  }, [conversation.id]);

  useEffect(() => {
    alive.current = true;
    void reload();
    const channel = supabase.channel(`seller-chat-${conversation.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'seller_messages', filter: `conversation_id=eq.${conversation.id}` }, () => void reload()).subscribe();
    const timer = window.setInterval(() => void reload(), 15000);
    const visible = () => void reload();
    document.addEventListener('visibilitychange', visible);
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) void reload(); });
    if (listRef.current) observer.observe(listRef.current);
    return () => { alive.current = false; window.clearInterval(timer); void supabase.removeChannel(channel); document.removeEventListener('visibilitychange', visible); observer.disconnect(); };
  }, [conversation.id, reload]);

  const loadOlder = async () => {
    setOlder(true);
    const el = listRef.current, oldHeight = el?.scrollHeight || 0;
    const { data, error: fetchError } = await supabase.rpc('get_seller_messages', { p_conversation: conversation.id, p_before: messages[0]?.seq });
    if (!alive.current) return;
    setOlder(false);
    if (fetchError) { setError('Nie udało się wczytać starszych wiadomości.'); return; }
    const rows: Message[] = data || [];
    setHasOlder(rows.length === 50);
    const merged = [...new Map([...rows, ...messagesRef.current].map((row) => [row.id, row])).values()].sort((a, b) => Number(a.seq) - Number(b.seq));
    messagesRef.current = merged; setMessages(merged);
    window.requestAnimationFrame(() => { if (el) el.scrollTop += el.scrollHeight - oldHeight; });
  };

  const send = async (event: FormEvent) => {
    event.preventDefault();
    const body = text.trim();
    if (!body || sendLock.current || !conversation.can_send) return;
    sendLock.current = true; setSending(true); setError('');
    if (!pending.current || pending.current.text !== body) pending.current = { id: crypto.randomUUID(), text: body };
    try {
      const { error: sendError } = await supabase.rpc('send_seller_message', { p_conversation: conversation.id, p_message_id: pending.current.id, p_body: body });
      if (sendError) throw sendError;
      if (!alive.current) return;
      pending.current = null; setText('');
      await reload(); onReadRef.current();
      window.requestAnimationFrame(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; });
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : 'Nie potwierdzono wysyłki. Możesz ponowić; wiadomość nie zostanie zdublowana.');
    } finally { sendLock.current = false; if (alive.current) setSending(false); }
  };

  return <div className={`min-w-0 rounded-xl bg-black/15 ${fitViewport ? 'lg:flex lg:min-h-0 lg:flex-auto lg:flex-col' : ''}`}>
    <div className={`shrink-0 ${compact ? 'space-y-1 px-3 py-2' : 'space-y-2 px-4 py-3'}`}>
      {!compact && <h3 className="text-sm font-medium">{conversation.title}</h3>}
      {!compact && conversation.offer_title && conversation.offer_title !== conversation.title && <p className="text-xs text-white/60">{conversation.offer_title}</p>}
      <p className="text-xs text-white/45">{conversation.brand_name} · {conversation.offer_id ? (isRealization ? 'Ustalenia realizacji · kontynuacja oferty' : 'Ustalenia do oferty') : 'Rozmowa ogólna'}</p>
      {!compact && <p className="text-xs leading-5 text-white/45">{conversation.offer_id
        ? 'Cała historia tego wątku pozostaje przy ofercie i jest dostępna w powiązanym wydarzeniu. Tutaj kontynuujemy ustalenia dotyczące realizacji.'
        : 'Luźne pytania i bieżący kontakt. Ta rozmowa nie jest dołączana do ofert ani wydarzeń.'}</p>}
      {(!compact || (crm && conversation.can_view_event && conversation.event_id)) && <div className="flex flex-wrap gap-x-4 gap-y-2">
        {!compact && conversation.offer_id && <Link className="text-xs text-[#d3bb73]" href={crm ? `/crm/offers/${conversation.offer_id}` : `/seller/${isRealization ? 'realizations' : 'offers'}/${conversation.offer_id}#seller-offer-conversation`}>{!crm && isRealization ? 'Otwórz realizację' : 'Otwórz ofertę'}</Link>}
        {crm && conversation.can_view_event && conversation.event_id && <Link className="text-xs text-[#d3bb73]" href={`/crm/events/${conversation.event_id}?tab=seller-arrangements&conversation=${conversation.id}`}>Ustalenia realizacji{conversation.event_name ? ` · ${conversation.event_name}` : ''}</Link>}
      </div>}
    </div>
    <div ref={listRef} onScroll={() => { const el = listRef.current; if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 20) void reload(); }} role="log" aria-label="Historia rozmowy" aria-live="polite" className={`${compact ? 'h-[clamp(10rem,28vh,17rem)] space-y-2 overflow-y-auto overscroll-contain px-3 py-2' : 'h-96 space-y-3 overflow-y-auto px-4 py-3'} ${fitViewport ? 'lg:min-h-0 lg:shrink' : ''}`}>
      {hasOlder && <button type="button" disabled={older} onClick={() => void loadOlder()} className="w-full py-2 text-xs text-[#d3bb73]">{older ? 'Wczytywanie…' : 'Pokaż starsze wiadomości'}</button>}
      {loading && <p className="text-sm text-white/45">Wczytywanie rozmowy…</p>}
      {!loading && !messages.length && <p className="py-10 text-center text-sm text-white/45">Napisz pierwszą wiadomość. Rozmowa pozostanie w historii sprzedawcy.</p>}
      {messages.map((message) => <div key={message.id} className={`flex ${message.own ? 'justify-end' : 'justify-start'}`}><article className={`min-w-0 max-w-[90%] break-words rounded-xl ${compact ? 'px-3 py-2' : 'px-4 py-3'} ${message.own ? 'bg-[#d3bb73]/15' : 'bg-white/5'}`}>
        <p className="text-xs text-[#d3bb73]">{message.sender_name} <span className="text-white/35">· {message.sender_kind === 'crm' ? 'MAVINCI' : 'Sprzedawca'}</span></p>
        <p className={compact ? 'mt-1 whitespace-pre-wrap break-words text-sm leading-5' : 'mt-2 whitespace-pre-wrap break-words text-sm leading-6'}>{message.body}</p>
        <time dateTime={message.created_at} className="mt-2 block text-[10px] text-white/40">{new Date(message.created_at).toLocaleString('pl-PL')}</time>
      </article></div>)}
    </div>
    {error && <p role="alert" className="px-4 py-2 text-xs text-amber-200">{error}</p>}
    {conversation.can_send ? <form onSubmit={send} className={`shrink-0 ${compact ? 'space-y-2 p-3' : 'space-y-2 p-4'}`}>
      <label className="sr-only" htmlFor={`seller-message-${conversation.id}`}>Wiadomość</label>
      <textarea
        id={`seller-message-${conversation.id}`}
        aria-describedby={`seller-message-shortcuts-${conversation.id}`}
        value={text}
        readOnly={sending}
        aria-busy={sending}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          // Enter used to confirm IME composition must not send the message.
          if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
          event.preventDefault();
          if (event.repeat || sending || sendLock.current || !text.trim() || !conversation.can_send) return;
          event.currentTarget.form?.requestSubmit();
        }}
        maxLength={10000}
        rows={compact ? 2 : 3}
        placeholder={crm ? 'Odpowiedź widoczna dla sprzedawcy…' : 'Pytanie do opiekuna MAVINCI…'}
        className={`w-full resize-y rounded-lg bg-black/20 px-3 py-2.5 text-sm outline-none ring-1 ring-white/5 focus:ring-[#d3bb73]/30 ${compact ? 'max-h-32' : ''}`}
      />
      <div className="flex items-center justify-between gap-3"><p className="text-[10px] text-white/35"><span id={`seller-message-shortcuts-${conversation.id}`} className="block">Enter — wyślij · Shift+Enter — nowa linia</span>{!compact && 'Wiadomości zachowują autora i datę. Nie można ich edytować ani usuwać.'}</p><button type="submit" disabled={sending || !text.trim()} className="flex shrink-0 items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2.5 text-sm font-medium text-[#210811] disabled:opacity-40">{sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Wyślij</button></div>
    </form> : <p className="p-4 text-xs text-white/45">Masz dostęp do odczytu tej rozmowy.</p>}
  </div>;
}

export default function SellerChatPanel({ partnerId, brands, offers = [], crm = false }: { partnerId: string; brands: ChatBrand[]; offers?: ChatOffer[]; crm?: boolean }) {
  const searchParams = useSearchParams();
  const requested = searchParams.get('conversation');
  const requestedOffer = searchParams.get('offer');
  const requestKey = `${partnerId}:${requested || ''}:${requestedOffer || ''}`;
  const [threads, setThreads] = useState<SellerConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [selection, setSelection] = useState<{ requestKey: string; layer: 'general' | 'offer'; id?: string } | null>(null);
  const [companyId, setCompanyId] = useState(brands[0]?.id || '');
  const [offerId, setOfferId] = useState('');
  const [query, setQuery] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  const startLock = useRef(false);
  const reload = useCallback(async () => {
    const { data, error: fetchError } = await supabase.rpc('list_seller_conversations', { p_partner: partnerId });
    if (!alive.current) return;
    setLoading(false);
    if (fetchError) { setError('Nie udało się wczytać rozmów sprzedawcy.'); return; }
    setThreads(data || []); setError('');
  }, [partnerId]);
  useEffect(() => {
    alive.current = true; void reload();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void reload(); }, 15000);
    return () => { alive.current = false; window.clearInterval(timer); };
  }, [reload]);
  useEffect(() => {
    const offer = offers.find((item) => item.id === requestedOffer);
    if (offer) { setCompanyId(offer.my_company_id); setOfferId(offer.id); }
  }, [requestedOffer, offers]);
  useEffect(() => { if (!companyId && brands[0]) setCompanyId(brands[0].id); }, [brands, companyId]);

  const manualSelection = selection?.requestKey === requestKey ? selection : null;
  const requestedThread = threads.find((thread) => requested ? thread.id === requested : Boolean(requestedOffer && thread.offer_id === requestedOffer));
  const layer = manualSelection?.layer || (requestedThread ? (requestedThread.offer_id ? 'offer' : 'general') : requestedOffer ? 'offer' : 'general');
  const layerThreads = threads.filter((thread) => Boolean(thread.offer_id) === (layer === 'offer'));
  const visibleThreads = layerThreads.filter((thread) => `${thread.title} ${thread.offer_title || ''} ${thread.event_name || ''} ${thread.brand_name}`.toLocaleLowerCase('pl-PL').includes(query.trim().toLocaleLowerCase('pl-PL')));
  // A deep link must not briefly open and mark an unrelated general thread read.
  const selectedThread = layerThreads.find((thread) => thread.id === (manualSelection?.id || (!manualSelection ? requestedThread?.id : undefined)))
    || ((manualSelection || (!requested && !requestedOffer)) ? visibleThreads[0] : undefined);
  const writableBrands = brands.filter((brand) => brand.can_chat !== false);
  const canStart = writableBrands.some((brand) => brand.id === companyId)
    && (layer === 'general' || offers.some((offer) => offer.id === offerId && offer.my_company_id === companyId));
  const start = async () => {
    if (startLock.current || !canStart) return;
    startLock.current = true; setStarting(true); setError('');
    try {
      const { data, error: startError } = await supabase.rpc('open_seller_conversation', { p_partner: partnerId, p_company: companyId, p_offer: layer === 'offer' ? offerId : null });
      if (startError) throw startError;
      if (!alive.current) return;
      await reload();
      if (alive.current) { setQuery(''); setSelection({ requestKey, layer, id: data }); }
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : 'Nie udało się otworzyć rozmowy. Spróbuj ponownie.');
    } finally { startLock.current = false; if (alive.current) setStarting(false); }
  };
  return <section className="space-y-4 rounded-xl bg-[#1c1f33] p-5 text-[#e5e4e2]" id="seller-chat">
    <div><h2 className="flex items-center gap-2 text-base"><MessageSquare className="h-5 w-5 text-[#d3bb73]" />{crm ? 'Rozmowy ze sprzedawcą' : 'Rozmowy z opiekunem MAVINCI'}</h2><p className="mt-2 text-xs leading-5 text-white/45">Oddzielamy bieżący kontakt od ustaleń do konkretnych zleceń. Każda rozmowa pozostaje w obrębie swojej marki.</p></div>
    <div className="flex flex-wrap gap-2" role="group" aria-label="Rodzaj rozmowy">
      {([{ id: 'general', label: 'Rozmowa ogólna' }, { id: 'offer', label: 'Oferty i realizacje' }] as const).map((item) => <button type="button" key={item.id} aria-pressed={layer === item.id} onClick={() => { setSelection({ requestKey, layer: item.id }); setQuery(''); }} className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm ${layer === item.id ? 'bg-[#d3bb73]/15 text-[#d3bb73]' : 'bg-white/[0.03] text-white/55'}`}>{item.label}<SellerCountBadge count={threads.filter((thread) => Boolean(thread.offer_id) === (item.id === 'offer')).reduce((sum, thread) => sum + Number(thread.unread), 0)} label="Nowe wiadomości" /></button>)}
    </div>
    <p className="text-xs leading-5 text-white/45">{layer === 'general' ? 'Jedna rozmowa ogólna dla każdej marki. Do ustaleń dotyczących konkretnego zlecenia użyj zakładki „Oferty i realizacje”.' : 'Osobny wątek każdej oferty. Po powiązaniu oferty z wydarzeniem ten sam wątek pojawi się w jego zakładce „Ustalenia”, bez kopiowania ani utraty historii.'}</p>
    {writableBrands.length > 0 && <div className="space-y-3 rounded-lg bg-white/[0.03] p-3">
      <div className="flex flex-wrap gap-2">{writableBrands.map((brand) => <button key={brand.id} type="button" onClick={() => { setCompanyId(brand.id); setOfferId(''); }} className={`rounded-lg px-3 py-2 text-xs ${companyId === brand.id ? 'bg-[#d3bb73]/20 text-[#d3bb73]' : 'bg-white/5 text-white/55'}`}>{brand.name}</button>)}</div>
      <div className="flex flex-wrap items-center gap-3">{layer === 'offer' && <div className="min-w-56 flex-1"><SearchCombobox value={offerId} onChange={setOfferId} options={offers.filter((offer) => offer.my_company_id === companyId).map((offer) => ({ id: offer.id, label: offer.offer_number || offer.title || 'Oferta', description: offer.title }))} placeholder="Wybierz lub wyszukaj ofertę…" allowClear /></div>}
        <button type="button" onClick={() => void start()} disabled={starting || !canStart} className="flex items-center gap-2 rounded-lg bg-[#d3bb73]/15 px-3 py-2.5 text-sm text-[#d3bb73] disabled:opacity-40">{starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}{layer === 'general' ? 'Otwórz rozmowę ogólną' : 'Otwórz ustalenia oferty'}</button></div>
    </div>}
    {error && <p role="alert" className="text-sm text-amber-200">{error}</p>}
    {loading && <p className="text-sm text-white/45">Wczytywanie rozmów…</p>}
    <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
      <div className="space-y-3">
        <input aria-label="Szukaj rozmowy" placeholder="Szukaj rozmowy…" value={query} onChange={(event) => setQuery(event.target.value)} className="w-full rounded-lg bg-black/20 px-3 py-2.5 text-sm outline-none ring-1 ring-white/5 focus:ring-[#d3bb73]/30" />
        <div className="max-h-[580px] space-y-2 overflow-y-auto">{visibleThreads.map((thread) => <button key={thread.id} type="button" onClick={() => setSelection({ requestKey, layer, id: thread.id })} className={`block w-full rounded-lg p-3 text-left ${selectedThread?.id === thread.id ? 'bg-[#d3bb73]/15' : 'bg-white/[0.03] hover:bg-white/[0.06]'}`}><span className="flex items-center justify-between gap-2"><span className="truncate text-sm">{thread.title}</span><SellerCountBadge count={Number(thread.unread)} label="Nowe wiadomości" /></span><span className="mt-1 block text-[10px] text-[#d3bb73]">{thread.brand_name}{thread.offer_id ? ` · ${thread.has_event ? 'Realizacja' : 'Oferta'}` : ''}</span><span className="mt-2 block truncate text-xs text-white/40">{thread.last_message || 'Brak wiadomości'}</span></button>)}
          {!loading && !visibleThreads.length && <p className="p-3 text-xs text-white/40">{query ? 'Brak pasujących rozmów.' : 'Nie ma jeszcze rozmów w tej sekcji.'}</p>}
        </div>
      </div>
      {selectedThread ? <ConversationMessages key={selectedThread.id} conversation={selectedThread} crm={crm} onRead={() => void reload()} /> : <p className="rounded-xl bg-black/10 px-5 py-14 text-center text-sm text-white/40">Wybierz rozmowę lub rozpocznij nową.</p>}
    </div>
  </section>;
}
