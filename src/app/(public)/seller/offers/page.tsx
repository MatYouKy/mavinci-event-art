'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { FileText, Plus, RefreshCw, Search } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { sellerCommissionsVisible, sellerMoney, useSellerPortalContext } from '@/lib/seller/portal';
import { loadSellerOfferDeliveries, sellerOfferStage, sellerOfferStageFilters, sellerOfferToneClass, type SellerOfferDelivery } from '@/lib/seller/offerStatus';
import SellerInboxPanel from '@/components/seller/SellerInboxPanel';
import { useOfferRefresh } from '@/lib/seller/useOfferRefresh';

type OfferRow = {
  my_company_id: string;
  id: string;
  offer_number: string | null;
  title: string | null;
  portal_client_name: string | null;
  portal_client_company: string | null;
  status: string;
  commercial_model: 'markup' | 'commission';
  partner_base_net: number;
  client_total_net: number;
  partner_earnings_amount: number;
  partner_approval_status: string;
  created_at: string;
  delivery?: SellerOfferDelivery;
};
const offerStage = (offer: OfferRow) => sellerOfferStage(offer, offer.delivery);
const FORECAST_NOTE = 'Szacunek od wartości oferty — prowizja liczy się od zysku po kosztach wydarzenia';

export default function SellerOffersPage() {
  const { context, loading: contextLoading } = useSellerPortalContext();
  const [offers, setOffers] = useState<OfferRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const revision = useOfferRefresh(context ? `sales_partner_id=eq.${context.profile.id}` : undefined);

  useEffect(() => {
    if (!context) {
      if (!contextLoading) setLoading(false);
      return;
    }
    let active = true;
    void (async () => {
      try {
      const { data, error: loadError } = await supabase
        .from('offers')
        .select('id,my_company_id,offer_number,title,portal_client_name,portal_client_company,status,commercial_model,partner_base_net,client_total_net,partner_earnings_amount,partner_approval_status,created_at')
        .eq('sales_channel', 'seller_portal')
        .eq('sales_partner_id', context.profile.id)
        .neq('status', 'accepted')
        .order('created_at', { ascending: false });
      if (!active) return;
      if (loadError) { setError('Nie udało się odświeżyć listy ofert.'); setLoading(false); return; }
      const rows = (data || []) as OfferRow[];
      const { deliveries: byOffer, error: progressError } = await loadSellerOfferDeliveries(rows.map((offer) => offer.id));
      if (!active) return;
      setError(progressError);
      setOffers(rows.map((offer) => ({ ...offer, delivery: byOffer.get(offer.id) })).filter((offer) => !offer.delivery?.is_realization));
      setLoading(false);
      } catch {
        if (active) { setError('Nie udało się odświeżyć ofert. Spróbuj ponownie.'); setLoading(false); }
      }
    })();
    return () => { active = false; };
  }, [context, contextLoading, revision, retry]);

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('pl');
    return offers.filter((offer) => {
      if (status !== 'all' && offerStage(offer).value !== status) return false;
      return !query || `${offer.offer_number || ''} ${offer.title || ''} ${offer.portal_client_name || ''} ${offer.portal_client_company || ''}`
        .toLocaleLowerCase('pl')
        .includes(query);
    });
  }, [offers, search, status]);

  if (contextLoading || loading) return <div className="p-10 text-center text-[#d3bb73]">Ładowanie ofert...</div>;
  if (!context) return <div className="p-10 text-center text-[#e5e4e2]/50">Brak dostępu do portalu sprzedawcy.</div>;

  return (
    <div className="min-h-screen p-4 text-[#e5e4e2] md:p-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-light uppercase">Moje oferty</h1>
            <p className="mt-1 text-sm text-[#e5e4e2]/50">Przygotuj ofertę → potwierdź akceptację klienta i przekaż do MAVINCI → po akceptacji opiekuna kontynuuj w zakładce <Link href="/seller/realizations" className="text-[#d3bb73] underline underline-offset-4">Potwierdzone wydarzenia</Link>.</p>
          </div>
          <Link href="/seller/offers/new" className="flex min-h-11 items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2.5 text-sm font-medium text-[#111522]"><Plus className="h-4 w-4" /> Nowa oferta</Link>
        </header>

        <SellerInboxPanel partnerId={context.profile.id} scope="offers" />
        {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-amber-300/10 p-3 text-sm text-amber-200"><p>{error}</p><button type="button" onClick={() => { setLoading(true); setRetry((value) => value + 1); }} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-[#d3bb73]"><RefreshCw className="h-4 w-4" />Spróbuj ponownie</button></div>}

        <section className="rounded-xl bg-[#1c1f33]">
          <div className="flex flex-wrap gap-3 border-b border-white/5 p-4">
            <label className="relative min-w-0 flex-1 basis-64"><span className="sr-only">Szukaj oferty</span><Search className="absolute left-3 top-3.5 h-4 w-4 text-[#e5e4e2]/30" /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Szukaj klienta, tytułu lub numeru..." className="min-h-11 w-full rounded-lg bg-[#0f1119] py-2.5 pl-9 pr-3 text-sm outline-none focus:border-[#d3bb73]/50" /></label>
            <select aria-label="Etap oferty" value={status} onChange={(event) => setStatus(event.target.value)} className="min-h-11 rounded-lg bg-[#0f1119] px-3 py-2 text-sm">{sellerOfferStageFilters.map((filter) => <option key={filter.value} value={filter.value}>{filter.label}</option>)}</select>
          </div>

          <div className="divide-y divide-white/5">
            {filtered.map((offer) => {
              const stage = offerStage(offer);
              const commission = offer.commercial_model === 'commission';
              const showEarnings = !commission || sellerCommissionsVisible(context, offer.my_company_id);
              return <Link key={offer.id} href={`/seller/offers/${offer.id}`} className="grid grid-cols-2 gap-3 p-4 transition-colors hover:bg-white/[0.02] sm:p-5 lg:grid-cols-[minmax(220px,1.5fr)_150px_130px_130px_130px] lg:items-center">
                <div className="col-span-2 min-w-0 lg:col-span-1">
                  <div className="flex items-center gap-2"><FileText className="h-4 w-4 shrink-0 text-[#d3bb73]" /><p className="truncate text-sm">{offer.title || offer.offer_number || 'Oferta bez tytułu'}</p></div>
                  <p className="mt-1 truncate pl-6 text-xs text-[#e5e4e2]/45">{offer.portal_client_company || offer.portal_client_name || 'Klient do uzupełnienia'}{offer.offer_number ? ` · ${offer.offer_number}` : ''}</p>
                  {stage.next && <p className="mt-2 pl-6 text-xs leading-5 text-white/50">{stage.next}</p>}
                </div>
                <div className="col-span-2 lg:col-span-1"><span className={`inline-block rounded-md px-2 py-1 text-[11px] ${sellerOfferToneClass[stage.tone]}`}>{stage.label}</span>{offer.partner_approval_status === 'required' && <p className="mt-1 text-[10px] text-amber-300">Cena wymaga zgody opiekuna</p>}</div>
                <div><p className="text-[10px] uppercase text-[#e5e4e2]/40">Cena MAVINCI</p><p className="mt-1 text-sm">{sellerMoney(offer.partner_base_net)}</p></div>
                <div><p className="text-[10px] uppercase text-[#e5e4e2]/40">Cena klienta</p><p className="mt-1 text-sm">{sellerMoney(offer.client_total_net)}</p></div>
                {showEarnings && <div title={commission ? FORECAST_NOTE : undefined}><p className="text-[10px] uppercase text-[#e5e4e2]/40">{commission ? 'Prowizja · szacunek' : 'Marża hotelu'}</p><p className="mt-1 text-sm text-[#d3bb73]">{sellerMoney(offer.partner_earnings_amount)}</p>{commission && <p className="mt-0.5 text-[10px] leading-4 text-white/35">przed kosztami wydarzenia</p>}</div>}
              </Link>;
            })}
            {filtered.length === 0 && !(error && !offers.length) && <p className="p-12 text-center text-sm text-[#e5e4e2]/45">{offers.length ? 'Brak ofert spełniających kryteria.' : 'Nie masz jeszcze ofert w przygotowaniu.'}</p>}
          </div>
        </section>
      </div>
    </div>
  );
}
