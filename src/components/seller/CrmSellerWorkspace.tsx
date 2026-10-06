'use client';

import { systemLabel } from '@/lib/ui/systemLabels';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { BarChart3, Calendar, FileText, Loader2, MessageSquare, Palette, RefreshCw, Search, WalletCards } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { sellerMoney, sellerStatusLabel } from '@/lib/seller/portal';
import { sellerInboxCounts } from '@/lib/seller/inbox';
import { useSellerSidebarBadge } from '@/lib/seller/sidebarBadge';
import { EVENT_STATUS_LABELS } from '@/components/crm/events/eventStatusPalette';
import CommissionSettlementsPanel from '@/components/crm/commissions/CommissionSettlementsPanel';
import { CrmCartesianChart } from '@/components/crm/charts/CrmCharts';
import SellerChatPanel, { ChatBrand, ChatOffer } from './SellerChatPanel';
import SellerInboxPanel, { SellerCountBadge } from './SellerInboxPanel';
import CrmOfferBrandingPanel from './CrmOfferBrandingPanel';

type Offer = ChatOffer & { status: string; client_name: string | null; created_at: string; event_date: string | null; event_id: string | null; client_total_net: number; partner_base_net: number; generated_at: string | null; brand_name: string; review_status: string | null; document_id: string | null };
type Event = { id: string; name: string; event_date: string; status: string; brand_name: string; my_company_id: string };
type Workspace = { brands: ChatBrand[]; offers: Offer[]; events: Event[]; can_view_offers: boolean };
const reviewLabels: Record<string, string> = { pending: 'Do decyzji opiekuna', approved: 'Zasoby zaakceptowane', changes_requested: 'Do poprawy', rejected: 'Zapytanie odrzucone' };

export default function CrmSellerWorkspace({ partnerId, contactId }: { partnerId: string; contactId?: string }) {
  const params = useSearchParams();
  const [tab, setTab] = useState(params.get('conversation') || params.get('section') === 'chat' ? 'chat' : params.get('section') === 'branding' ? 'branding' : params.get('section') === 'settlements' ? 'settlements' : 'summary');
  const [data, setData] = useState<Workspace | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [brandId, setBrandId] = useState('');
  const [offerPage, setOfferPage] = useState(1);
  const [eventPage, setEventPage] = useState(1);
  const inbox = useSellerSidebarBadge();
  const counts = sellerInboxCounts(inbox.items, partnerId);
  const reload = useCallback(async () => {
    setLoading(true);
    const { data: loaded, error: loadError } = await supabase.rpc('get_crm_seller_workspace', { p_partner: partnerId });
    if (loadError) { setError(loadError.message); setData(null); }
    else { setData(loaded as Workspace); setError(''); }
    setLoading(false);
  }, [partnerId]);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    const update = () => void reload();
    window.addEventListener('seller-workspace-changed', update);
    return () => window.removeEventListener('seller-workspace-changed', update);
  }, [reload]);
  useEffect(() => {
    if (params.get('conversation') || params.get('section') === 'chat') setTab('chat');
    else if (params.get('section') === 'branding') setTab('branding');
    else if (params.get('section') === 'settlements') setTab('settlements');
  }, [params]);
  useEffect(() => { setOfferPage(1); setEventPage(1); }, [brandId, query]);
  const brandOffers = useMemo(() => (data?.offers || []).filter((offer) => !brandId || offer.my_company_id === brandId), [data, brandId]);
  const stats = useMemo(() => {
    const accepted = brandOffers.filter((offer) => offer.status === 'accepted');
    return { created: brandOffers.length, generated: brandOffers.filter((offer) => offer.generated_at).length, accepted: accepted.length, conversion: brandOffers.length ? Math.round(accepted.length / brandOffers.length * 100) : 0,
      clientNet: accepted.reduce((sum, offer) => sum + Number(offer.client_total_net || 0), 0), baseNet: accepted.reduce((sum, offer) => sum + Number(offer.partner_base_net || 0), 0) };
  }, [brandOffers]);
  const offerStatusData = useMemo(() => {
    const grouped = new Map<string, number>();
    brandOffers.forEach((offer) => grouped.set(offer.status, (grouped.get(offer.status) || 0) + 1));
    return [...grouped].map(([status, count]) => ({ status: sellerStatusLabel(status), count }))
      .sort((left, right) => right.count - left.count || left.status.localeCompare(right.status, 'pl'));
  }, [brandOffers]);
  const eventStatusData = useMemo(() => {
    const grouped = new Map<string, number>();
    (data?.events || []).filter((event) => !brandId || event.my_company_id === brandId)
      .forEach((event) => grouped.set(event.status, (grouped.get(event.status) || 0) + 1));
    return [...grouped].map(([status, count]) => ({ status: EVENT_STATUS_LABELS[status as keyof typeof EVENT_STATUS_LABELS] || systemLabel(status), count }))
      .sort((left, right) => right.count - left.count || left.status.localeCompare(right.status, 'pl'));
  }, [data, brandId]);
  const offers = brandOffers.filter((offer) => `${offer.title} ${offer.offer_number} ${offer.client_name}`.toLocaleLowerCase('pl-PL').includes(query.trim().toLocaleLowerCase('pl-PL')));
  const events = (data?.events || []).filter((event) => (!brandId || event.my_company_id === brandId) && event.name.toLocaleLowerCase('pl-PL').includes(query.trim().toLocaleLowerCase('pl-PL')));
  if (loading && !data) return <div className="flex items-center gap-2 py-10 text-sm text-white/50"><Loader2 className="h-4 w-4 animate-spin" />Wczytywanie sprzedaży sprzedawcy…</div>;
  if (error || !data) return <div className="rounded-xl bg-amber-300/5 p-5 text-sm text-amber-200"><p>{error || 'Brak danych sprzedaży.'}</p><button type="button" onClick={() => void reload()} className="mt-3 text-[#d3bb73]">Spróbuj ponownie</button></div>;
  return <div className="space-y-5 text-[#e5e4e2]">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg">Sprzedaż sprzedawcy</h2><p className="mt-1 text-xs text-white/45">Oferty, powiązane realizacje i ustalenia tej osoby w dostępnych dla Ciebie markach.</p></div><button type="button" onClick={() => void reload()} className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-xs text-[#d3bb73]"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Odśwież</button></header>
    <nav className="flex flex-wrap gap-2" aria-label="Sprzedaż sprzedawcy">{[
      { id: 'summary', label: 'Podsumowanie', icon: BarChart3, count: 0 },
      { id: 'offers', label: `Oferty (${data.offers.length})`, icon: FileText, count: counts.reviews },
      { id: 'events', label: `Realizacje (${data.events.length})`, icon: Calendar, count: 0 },
      { id: 'settlements', label: 'Rozliczenia', icon: WalletCards, count: 0 },
      { id: 'chat', label: 'Rozmowy', icon: MessageSquare, count: counts.messages },
      { id: 'branding', label: 'Branding i wizytówka', icon: Palette, count: 0 },
    ].map((item) => <button data-crm-tab-active={tab === item.id} key={item.id} type="button" onClick={() => setTab(item.id)} className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm ${tab === item.id ? 'bg-[#d3bb73]/15 text-[#d3bb73]' : 'bg-white/[0.03] text-white/55 hover:bg-white/5'}`}><item.icon className="h-4 w-4" />{item.label}<SellerCountBadge count={item.count} label={item.label} /></button>)}</nav>
    {tab !== 'chat' && tab !== 'branding' && tab !== 'settlements' && <div className="flex flex-wrap gap-2">{[{ id: '', name: 'Wszystkie marki' }, ...data.brands].map((brand) => <button key={brand.id} type="button" onClick={() => setBrandId(brand.id)} className={`rounded-lg px-3 py-2 text-xs ${brandId === brand.id ? 'bg-[#d3bb73]/15 text-[#d3bb73]' : 'text-white/45 hover:bg-white/5'}`}>{brand.name}</button>)}</div>}
    {tab === 'summary' && <>
      {!data.can_view_offers && <p className="text-sm text-amber-200">Twój zakres uprawnień nie obejmuje ofert. Dane handlowe nie są dostępne w tym widoku.</p>}
      {data.can_view_offers && <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{[
        ['Oferty / wygenerowane PDF', `${stats.created} / ${stats.generated}`], ['Zaakceptowane przez klienta', stats.accepted], ['Skuteczność ofert', `${stats.conversion}%`],
        ['Zaakceptowane — cena klienta netto', sellerMoney(stats.clientNet)], ['Zaakceptowane — baza MAVINCI netto', sellerMoney(stats.baseNet)], ['Powiązane realizacje', data.events.filter((event) => !brandId || event.my_company_id === brandId).length],
      ].map(([label, value]) => <div key={label} className="rounded-xl bg-[#1c1f33] p-4"><p className="text-xs text-white/45">{label}</p><p className="mt-2 text-xl text-[#d3bb73]">{value}</p></div>)}</div>}
      <p className="text-xs text-white/40">Akceptacja klienta jest liczona oddzielnie od potwierdzenia terminu i zasobów przez opiekuna. Wartości ofert nie oznaczają opłaconych faktur.</p>
      <div className={`grid gap-4 ${data.can_view_offers ? 'xl:grid-cols-2' : ''}`}>
        {data.can_view_offers && <section className="min-w-0 rounded-xl bg-black/10 p-4">
          <h3 className="text-sm font-medium">Statusy ofert</h3>
          <p className="mt-1 mb-3 text-xs text-white/40">Liczba dostępnych ofert w wybranych markach, według ich aktualnego statusu.</p>
          <CrmCartesianChart
            data={offerStatusData}
            categoryKey="status"
            series={[{ key: 'count', label: 'Oferty', color: '#d3bb73' }]}
            kind="bar"
            horizontal
            height={280}
            valueFormatter={(value) => value.toLocaleString('pl-PL', { maximumFractionDigits: 0 })}
            axisFormatter={(value) => Number.isInteger(value) ? String(value) : ''}
            ariaLabel="Liczba ofert sprzedawcy według aktualnego statusu w wybranych markach"
            emptyMessage="Brak ofert dla wybranej marki."
          />
        </section>}
        <section className="min-w-0 rounded-xl bg-black/10 p-4">
          <h3 className="text-sm font-medium">Statusy realizacji</h3>
          <p className="mt-1 mb-3 text-xs text-white/40">Powiązane wydarzenia dostępne dla Ciebie w wybranych markach.</p>
          <CrmCartesianChart
            data={eventStatusData}
            categoryKey="status"
            series={[{ key: 'count', label: 'Realizacje', color: '#93c5fd' }]}
            kind="bar"
            horizontal
            height={280}
            valueFormatter={(value) => value.toLocaleString('pl-PL', { maximumFractionDigits: 0 })}
            axisFormatter={(value) => Number.isInteger(value) ? String(value) : ''}
            ariaLabel="Liczba powiązanych realizacji sprzedawcy według aktualnego statusu w wybranych markach"
            emptyMessage="Brak powiązanych realizacji dla wybranej marki."
          />
        </section>
      </div>
      <SellerInboxPanel partnerId={partnerId} />
      <button type="button" onClick={() => setTab('settlements')} className="flex items-center gap-2 rounded-xl bg-white/5 px-4 py-3 text-left text-sm text-[#d3bb73] hover:bg-white/10"><WalletCards className="h-4 w-4" />Zobacz naliczenia, historię wypłat i kwoty pozostałe do rozliczenia</button>
    </>}
    {(tab === 'offers' || tab === 'events') && <div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-white/35" /><input aria-label="Wyszukaj w sprzedaży sprzedawcy" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tab === 'offers' ? 'Szukaj oferty, numeru lub klienta…' : 'Szukaj realizacji…'} className="w-full rounded-lg bg-[#1c1f33] py-2.5 pl-10 pr-3 text-sm outline-none ring-1 ring-white/5 focus:ring-[#d3bb73]/25" /></div>}
    {tab === 'offers' && <section className="space-y-2">{offers.slice((offerPage - 1) * 20, offerPage * 20).map((offer) => <article key={offer.id} className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-[#1c1f33] p-4">
      <div className="min-w-0 flex-1"><Link href={`/crm/offers/${offer.id}${offer.review_status === 'pending' && offer.document_id ? `?document=${offer.document_id}&preview=1#seller-offer-review` : ''}`} className="text-sm text-[#d3bb73] hover:underline">{offer.offer_number || 'Oferta'} · {offer.title}</Link><p className="mt-1 text-xs text-white/45">{offer.client_name || 'Bez nazwy klienta'} · {offer.brand_name} · {offer.event_date ? new Date(offer.event_date).toLocaleDateString('pl-PL') : 'Bez terminu'}</p></div>
      <div className="text-right"><p className="text-sm">{sellerMoney(offer.client_total_net)} netto</p><p className="mt-1 text-xs text-white/50">{sellerStatusLabel(offer.status)}</p>{offer.review_status && <p className={`mt-1 text-xs ${offer.review_status === 'pending' ? 'text-amber-200' : 'text-white/45'}`}>{reviewLabels[offer.review_status] || systemLabel(offer.review_status)}</p>}</div>
    </article>)}{!offers.length && <p className="p-8 text-center text-sm text-white/40">Brak pasujących ofert tego sprzedawcy.</p>}{offers.length > 20 && <div className="flex items-center justify-center gap-4 py-3 text-sm"><button disabled={offerPage === 1} onClick={() => setOfferPage((page) => page - 1)} className="text-[#d3bb73] disabled:opacity-30">Poprzednie</button><span>{offerPage} / {Math.ceil(offers.length / 20)}</span><button disabled={offerPage * 20 >= offers.length} onClick={() => setOfferPage((page) => page + 1)} className="text-[#d3bb73] disabled:opacity-30">Następne</button></div>}</section>}
    {tab === 'events' && <section className="space-y-2">{events.slice((eventPage - 1) * 20, eventPage * 20).map((event) => <Link key={event.id} href={`/crm/events/${event.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#1c1f33] p-4"><span className="text-sm text-[#d3bb73]">{event.name}<span className="mt-1 block text-xs text-white/45">{event.brand_name}</span></span><span className="text-right text-xs text-white/60">{new Date(event.event_date).toLocaleDateString('pl-PL')}<span className="mt-1 block">{EVENT_STATUS_LABELS[event.status as keyof typeof EVENT_STATUS_LABELS] || systemLabel(event.status)}</span></span></Link>)}{!events.length && <p className="p-8 text-center text-sm text-white/40">Brak powiązanych realizacji dostępnych w Twoim zakresie uprawnień.</p>}{events.length > 20 && <div className="flex items-center justify-center gap-4 py-3 text-sm"><button disabled={eventPage === 1} onClick={() => setEventPage((page) => page - 1)} className="text-[#d3bb73] disabled:opacity-30">Poprzednie</button><span>{eventPage} / {Math.ceil(events.length / 20)}</span><button disabled={eventPage * 20 >= events.length} onClick={() => setEventPage((page) => page + 1)} className="text-[#d3bb73] disabled:opacity-30">Następne</button></div>}</section>}
    {tab === 'settlements' && <CommissionSettlementsPanel key={contactId || partnerId} mode="crm" accountType={contactId ? 'contact' : 'partner'} accountId={contactId || partnerId} />}
    {tab === 'chat' && <SellerChatPanel partnerId={partnerId} brands={data.brands} offers={data.offers} crm />}
    {tab === 'branding' && <CrmOfferBrandingPanel key={partnerId} partnerId={partnerId} />}
  </div>;
}
