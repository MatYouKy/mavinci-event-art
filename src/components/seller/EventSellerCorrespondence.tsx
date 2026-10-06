'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Loader2, MessageSquare } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import type { ChatOffer, SellerConversation } from './SellerChatPanel';
import { SellerCountBadge } from './SellerInboxPanel';
import SellerOfferArrangements from './SellerOfferArrangements';
import SellerOfferConversation from './SellerOfferConversation';
import SellerOwnerProfitPanel from './SellerOwnerProfitPanel';

type EventSellerOffer = ChatOffer & {
  sales_partner_id: string;
  partner_name: string;
  brand_name: string;
  can_start: boolean;
  conversation: SellerConversation | null;
};

export default function EventSellerCorrespondence({ eventId }: { eventId: string }) {
  const searchParams = useSearchParams();
  const requested = searchParams.get('conversation');
  const requestedOffer = searchParams.get('offer');
  const requestKey = `${eventId}:${requested || ''}:${requestedOffer || ''}`;
  const [offers, setOffers] = useState<EventSellerOffer[]>([]);
  const [selection, setSelection] = useState<{ requestKey: string; offerId: string } | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [arrangementsDirty, setArrangementsDirty] = useState(false);
  const [arrangementsRefresh, setArrangementsRefresh] = useState(0);
  const alive = useRef(true);
  const loadSequence = useRef(0);

  const reload = useCallback(async () => {
    const sequence = ++loadSequence.current;
    const { data, error } = await supabase.rpc('get_event_seller_correspondence', { p_event: eventId });
    if (!alive.current || sequence !== loadSequence.current) return;
    setLoading(false);
    if (error) {
      setLoadError('Nie udało się wczytać ustaleń. Wymagane są uprawnienia do wydarzenia i sprzedawcy oraz migracja rozmów ofert i realizacji.');
      return;
    }
    setOffers(data?.offers || []);
    setLoadError('');
  }, [eventId]);

  useEffect(() => {
    alive.current = true;
    void reload();
    const visible = () => { if (document.visibilityState === 'visible') void reload(); };
    const refreshArrangements = () => {
      if (document.visibilityState === 'visible') setArrangementsRefresh((value) => value + 1);
    };
    const timer = window.setInterval(visible, 15000);
    document.addEventListener('visibilitychange', visible);
    document.addEventListener('visibilitychange', refreshArrangements);
    window.addEventListener('focus', refreshArrangements);
    window.addEventListener('seller-workspace-changed', refreshArrangements);
    return () => {
      alive.current = false;
      ++loadSequence.current;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
      document.removeEventListener('visibilitychange', refreshArrangements);
      window.removeEventListener('focus', refreshArrangements);
      window.removeEventListener('seller-workspace-changed', refreshArrangements);
    };
  }, [reload]);

  const visibleOffers = offers.filter((offer) => `${offer.offer_number || ''} ${offer.title || ''} ${offer.partner_name} ${offer.brand_name}`.toLocaleLowerCase('pl-PL').includes(query.trim().toLocaleLowerCase('pl-PL')));
  const selectedOffer = selection?.requestKey === requestKey
    ? offers.find((offer) => offer.id === selection.offerId)
    : requested ? offers.find((offer) => offer.conversation?.id === requested)
    : requestedOffer ? offers.find((offer) => offer.id === requestedOffer) : offers[0];

  const selectOffer = (offerId: string) => {
    if (selectedOffer?.id === offerId) return;
    if (arrangementsDirty && !window.confirm('Zmienić ofertę i porzucić niezapisane zmiany ustaleń?')) return;
    setArrangementsDirty(false);
    setSelection({ requestKey, offerId });
  };

  return <section className="min-w-0 space-y-5 text-[#e5e4e2]">
    <div className="rounded-xl bg-[#1c1f33] p-5">
      <h2 className="flex items-center gap-2 text-base uppercase"><MessageSquare className="h-5 w-5 text-[#d3bb73]" />Ustalenia i rozmowa ze sprzedawcą</h2>
      <p className="mt-2 max-w-4xl text-xs leading-5 text-white/50">Kontynuacja oferty w realizacji: te same ustalenia, kontakty i pełna historia rozmowy, z zachowanymi autorami i datami. Zmiany są widoczne także przy ofercie i w realizacji sprzedawcy. Rozmowy ogólne pozostają oddzielnie.</p>
    </div>
    {loading && <p className="flex items-center gap-2 text-sm text-white/50"><Loader2 className="h-4 w-4 animate-spin" />Wczytywanie ustaleń…</p>}
    {loadError && <p role="alert" className="text-sm text-amber-200">{loadError}</p>}
    {!loading && !loadError && !offers.length && <p className="rounded-lg bg-white/[0.03] p-5 text-sm leading-6 text-white/50">Brak powiązanych ofert sprzedawców dostępnych w Twoim zakresie uprawnień. Po powiązaniu takiej oferty z wydarzeniem jej korespondencja pojawi się tutaj automatycznie.</p>}
    {offers.length > 1 && <div className="space-y-3 rounded-xl bg-[#1c1f33] p-4">
        <input aria-label="Szukaj oferty lub sprzedawcy" placeholder="Szukaj oferty lub sprzedawcy…" value={query} onChange={(event) => setQuery(event.target.value)} className="w-full rounded-lg bg-black/20 px-3 py-2.5 text-sm outline-none ring-1 ring-white/5 focus:ring-[#d3bb73]/30" />
        <div className="grid max-h-64 gap-2 overflow-y-auto sm:grid-cols-2 xl:grid-cols-3">
          {visibleOffers.map((offer) => <button key={offer.id} type="button" aria-pressed={selectedOffer?.id === offer.id} onClick={() => selectOffer(offer.id)} className={`block w-full min-w-0 space-y-2 rounded-lg p-3 text-left ${selectedOffer?.id === offer.id ? 'bg-[#d3bb73]/15' : 'bg-white/[0.03] hover:bg-white/[0.06]'}`}>
            <span className="flex items-center justify-between gap-2"><span className="truncate text-sm">{offer.offer_number || offer.title || 'Oferta'}</span><SellerCountBadge count={Number(offer.conversation?.unread || 0)} label="Nowe wiadomości" /></span>
            <span className="block text-xs text-[#d3bb73]">{offer.partner_name} · {offer.brand_name}</span>
            <span className="block truncate text-xs text-white/40">{offer.conversation?.last_message || 'Brak wiadomości'}</span>
          </button>)}
          {!visibleOffers.length && <p className="p-3 text-xs text-white/40">Brak pasujących ofert.</p>}
        </div>
    </div>}
    {selectedOffer ? <div className="grid min-w-0 items-start gap-6 lg:grid-cols-3">
      <div className="min-w-0 space-y-5 rounded-xl bg-[#1c1f33] p-4 sm:p-5 lg:col-span-2">
        <div className="space-y-2 rounded-lg bg-white/[0.035] p-3 text-sm">
          <p>{selectedOffer.partner_name} · {selectedOffer.brand_name}</p>
          <Link href={`/crm/offers/${selectedOffer.id}`} className="text-[#d3bb73] hover:underline">Oferta źródłowa: {selectedOffer.offer_number || selectedOffer.title || 'Otwórz ofertę'}</Link>
          <p className="text-xs leading-5 text-white/50">Ustalenia są wspólne z ofertą — nie tworzymy osobnej kopii. Ich zapis nie cofa akceptacji i nie zmienia automatycznie harmonogramu wydarzenia.</p>
        </div>
        <SellerOfferArrangements key={selectedOffer.id} offerId={selectedOffer.id} crm refreshKey={arrangementsRefresh} onDirtyChange={setArrangementsDirty} onSaved={reload}/>
        <SellerOwnerProfitPanel key={`profit:${selectedOffer.id}`} offerId={selectedOffer.id} refreshKey={arrangementsRefresh}/>
      </div>
      <aside aria-label="Rozmowa o realizacji" className="flex min-w-0 flex-col lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)]">
        <SellerOfferConversation key={selectedOffer.id} offerId={selectedOffer.id} partnerId={selectedOffer.sales_partner_id} companyId={selectedOffer.my_company_id} canStart={selectedOffer.can_start} crm compact standalone realization/>
      </aside>
    </div> : !loading && !loadError && offers.length > 0 && <p className="rounded-xl bg-[#1c1f33] p-5 text-sm text-white/50">Wybierz ofertę. Wskazana rozmowa lub oferta może nie należeć do tego wydarzenia albo być poza Twoimi uprawnieniami.</p>}
  </section>;
}
