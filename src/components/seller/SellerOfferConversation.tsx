'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, MessageSquare } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { ConversationMessages, type SellerConversation } from './SellerChatPanel';

type Props = { offerId: string; partnerId: string; companyId: string; canStart: boolean; crm: boolean; compact?: boolean; standalone?: boolean; realization?: boolean };

export default function SellerOfferConversation({ offerId, partnerId, companyId, canStart, crm, compact = false, standalone = false, realization = false }: Props) {
  const [conversation, setConversation] = useState<SellerConversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  const openLock = useRef(false);
  const loadSequence = useRef(0);

  const reload = useCallback(async () => {
    const sequence = ++loadSequence.current;
    try {
      const { data, error: fetchError } = await supabase.rpc('list_seller_conversations', { p_partner: partnerId });
      if (fetchError) throw fetchError;
      // Never substitute the general conversation or another offer's thread.
      const current = ((data || []) as SellerConversation[]).find((item) => item.offer_id === offerId && item.my_company_id === companyId) || null;
      if (alive.current && sequence === loadSequence.current) { setConversation(current); setError(''); }
      return current;
    } catch {
      if (alive.current && sequence === loadSequence.current) setError('Nie udało się wczytać rozmowy. Odśwież ją; jeśli problem się powtarza, sprawdź dostęp do rozmów sprzedawców.');
      return null;
    } finally {
      if (alive.current && sequence === loadSequence.current) setLoading(false);
    }
  }, [offerId, partnerId, companyId]);

  useEffect(() => {
    alive.current = true;
    void reload();
    const refresh = () => { if (document.visibilityState === 'visible') void reload(); };
    const timer = window.setInterval(refresh, 15000);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('seller-workspace-changed', refresh);
    return () => { alive.current = false; ++loadSequence.current; window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh); window.removeEventListener('seller-workspace-changed', refresh); };
  }, [reload]);

  const start = async () => {
    if (!canStart || openLock.current) return;
    openLock.current = true; setOpening(true); setError('');
    try {
      // The existing RPC checks seller + brand access and reuses the offer's
      // unique conversation, including one already linked to a realization.
      const { error: openError } = await supabase.rpc('open_seller_conversation', { p_partner: partnerId, p_company: companyId, p_offer: offerId });
      if (openError) throw openError;
      await reload();
    } catch {
      if (alive.current) setError('Nie udało się otworzyć rozmowy. Sprawdź uprawnienia do tej marki i spróbuj ponownie.');
    } finally { openLock.current = false; if (alive.current) setOpening(false); }
  };

  const Heading = standalone ? 'h2' : 'h3';
  const fitViewport = compact && standalone;
  const isRealization = realization || Boolean(conversation?.has_event);
  const title = isRealization ? 'Rozmowa o realizacji' : 'Rozmowa o ofercie';
  return <section id="seller-offer-conversation" aria-label={title} className={`min-w-0 scroll-mt-6 space-y-3 rounded-xl ${fitViewport ? 'lg:flex lg:min-h-0 lg:flex-auto lg:flex-col' : ''} ${standalone ? 'bg-[#1c1f33] p-4 sm:p-5' : compact ? 'bg-white/[0.03] p-3' : 'my-5 bg-white/[0.03] p-4'}`}>
    <Heading className={`flex shrink-0 items-center gap-2 ${standalone ? 'text-base uppercase' : 'text-sm'}`}><MessageSquare className="h-4 w-4 shrink-0 text-[#d3bb73]" />{title}</Heading>
    <p className="shrink-0 text-xs leading-5 text-white/55">{isRealization ? 'Kontynuujcie ten sam wątek — cała historia oferty pozostaje tutaj. Wiadomości nie zmieniają decyzji o akceptacji ani potwierdzeniu wydarzenia.' : compact ? 'Pytania i uwagi do szkicu — bez zmiany decyzji o akceptacji.' : 'Tutaj omawiacie szkic: pytania, obawy i propozycje zmian. Wiadomość nie zatwierdza ani nie odrzuca zapytania. Ten sam wątek pozostaje przy ofercie, a później przy powiązanej realizacji.'}</p>
    {loading && <p role="status" className="text-sm text-white/50">Wczytywanie rozmowy…</p>}
    {error && <div role="alert" className="text-sm text-amber-200">{error}<button type="button" onClick={() => void reload()} className="ml-2 text-[#d3bb73] underline underline-offset-4">Odśwież rozmowę</button></div>}
    {conversation ? <ConversationMessages key={conversation.id} conversation={conversation} crm={crm} compact={compact} fitViewport={fitViewport} realization={isRealization} onRead={() => { void reload(); }} /> : !loading && !error && <div className="space-y-3 py-2">
      <p className="text-sm text-white/55">{isRealization ? 'Nie ma jeszcze wiadomości. Rozmowa będzie wspólna dla oferty i tej realizacji.' : 'Nie ma jeszcze wiadomości dotyczących tej oferty.'}</p>
      {canStart ? <button type="button" disabled={opening} onClick={() => void start()} className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73]/10 px-4 py-2.5 text-sm text-[#d3bb73] hover:bg-[#d3bb73]/20 disabled:opacity-40">
        {opening ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquare className="h-4 w-4" />}{opening ? 'Otwieranie rozmowy…' : compact || isRealization ? 'Rozpocznij rozmowę' : 'Rozpocznij rozmowę o tej ofercie'}
      </button> : <p className="text-xs text-white/45">Masz dostęp tylko do odczytu. Rozmowę może rozpocząć sprzedawca lub uprawniony opiekun.</p>}
    </div>}
  </section>;
}
