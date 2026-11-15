'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, BadgePercent, CalendarCheck, CalendarSearch, CheckCircle2, FileText, Hourglass, Loader2, Plus, RefreshCw, Send } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { sellerAnyCommissionsVisible, sellerCommissionsVisible, sellerMoney, useSellerPortalContext } from '@/lib/seller/portal';
import { loadSellerOfferDeliveries, loadSellerOfferPdfs, sellerOfferStage, sellerOfferToneClass, type SellerOfferDelivery } from '@/lib/seller/offerStatus';
import { SellerJourneyDots } from '@/components/seller/SellerJourney';
import { useOfferRefresh } from '@/lib/seller/useOfferRefresh';
import SellerInboxPanel from '@/components/seller/SellerInboxPanel';
import SellerManagerCard from '@/components/seller/SellerManagerCard';
import SellerWelcomeChecklist from '@/components/seller/SellerWelcomeChecklist';
import SellerOnboardingGuide from '@/components/seller/SellerOnboardingGuide';
import { useSellerOnboarding } from '@/lib/seller/onboarding';

type PartnerOffer = {
  my_company_id: string;
  id: string;
  offer_number: string | null;
  title: string | null;
  portal_client_name: string | null;
  portal_client_company: string | null;
  status: string;
  partner_approval_status: string | null;
  client_total_net: number;
  partner_earnings_amount: number;
  commercial_model: 'markup' | 'commission' | null;
  created_at: string;
};

const retryButton = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[#d3bb73]/10 px-4 py-2 text-sm text-[#d3bb73] hover:bg-[#d3bb73]/20 disabled:opacity-40';
const FORECAST_NOTE = 'szacunek od wartości oferty — prowizja liczy się od zysku po kosztach wydarzenia';

export default function SellerDashboard() {
  const { context, loading: contextLoading, error: contextError, reload: reloadContext } = useSellerPortalContext();
  const [offers, setOffers] = useState<PartnerOffer[]>([]);
  const [deliveries, setDeliveries] = useState<Map<string, SellerOfferDelivery>>(new Map());
  const [pdfs, setPdfs] = useState<Set<string> | null>(null);
  const [loadingOffers, setLoadingOffers] = useState(true);
  const [offersError, setOffersError] = useState('');
  const [stagesError, setStagesError] = useState('');
  const [retry, setRetry] = useState(0);
  const revision = useOfferRefresh(context ? `sales_partner_id=eq.${context.profile.id}` : undefined);
  const onboarding = useSellerOnboarding(context?.profile.id);

  useEffect(() => {
    if (!context) {
      if (!contextLoading) setLoadingOffers(false);
      return;
    }
    let active = true;
    void (async () => {
      try {
        const { data, error } = await supabase
          .from('offers')
          .select('id,my_company_id,offer_number,title,portal_client_name,portal_client_company,status,partner_approval_status,client_total_net,partner_earnings_amount,commercial_model,created_at')
          .eq('sales_channel', 'seller_portal')
          .eq('sales_partner_id', context.profile.id)
          .order('created_at', { ascending: false })
          .limit(100);
        if (!active) return;
        if (error) throw error;
        const rows = (data || []) as PartnerOffer[];
        const open = rows.filter((offer) => offer.status !== 'accepted').map((offer) => offer.id);
        const [stages, documents] = await Promise.all([loadSellerOfferDeliveries(open), loadSellerOfferPdfs(open)]);
        if (!active) return;
        setOffers(rows); setDeliveries(stages.deliveries); setPdfs(documents); setStagesError(stages.error); setOffersError('');
      } catch {
        // Keep previously loaded rows; never present a failed read as "no offers".
        if (active) setOffersError('Nie udało się wczytać Twoich ofert.');
      } finally { if (active) setLoadingOffers(false); }
    })();
    return () => { active = false; };
  }, [context, contextLoading, revision, retry]);

  const retryOffers = useCallback(() => { setLoadingOffers(true); setRetry((value) => value + 1); }, []);
  const managerName = context?.manager?.name;
  const rows = useMemo(() => offers.map((offer) => ({ offer, stage: sellerOfferStage(offer, deliveries.get(offer.id), {
    hasPdf: pdfs ? pdfs.has(offer.id) : undefined, managerName,
  }) })), [offers, deliveries, pdfs, managerName]);
  const anyCommissionVisible = sellerAnyCommissionsVisible(context);
  const stats = useMemo(() => {
    const open = rows.filter(({ stage }) => !stage.journey.ended);
    return {
      offer: open.filter(({ stage }) => stage.value === 'offer').length,
      client: open.filter(({ stage }) => stage.value === 'client').length,
      manager: open.filter(({ stage }) => stage.value === 'manager').length,
      realized: rows.filter(({ stage }) => stage.journey.index >= 3).length,
      forecast: rows
        .filter(({ offer, stage }) => stage.journey.index >= 3 && offer.commercial_model === 'commission' && sellerCommissionsVisible(context, offer.my_company_id))
        .reduce((sum, { offer }) => sum + Number(offer.partner_earnings_amount || 0), 0),
    };
  }, [rows, context]);
  const todo = useMemo(() => rows.filter(({ stage }) => stage.needsAction && stage.journey.index < 3)
    .sort((left, right) => Number(right.stage.tone === 'action' || right.stage.tone === 'danger') - Number(left.stage.tone === 'action' || left.stage.tone === 'danger'))
    .slice(0, 5), [rows]);

  if (contextLoading || (context && loadingOffers && !offers.length && !offersError)) {
    return <div role="status" className="flex min-h-[70vh] items-center justify-center gap-2 text-[#d3bb73]"><Loader2 className="h-5 w-5 animate-spin" />Ładowanie portalu…</div>;
  }

  if (!context) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center p-6">
        <div className="max-w-lg rounded-xl bg-[#1c1f33] p-8 text-center text-[#e5e4e2]">
          {contextError ? <>
            <h1 className="text-xl">Nie udało się wczytać portalu</h1>
            <p className="mt-3 text-sm leading-6 text-white/55">Sprawdź połączenie z internetem i spróbuj ponownie. Jeśli problem się powtarza, napisz do opiekuna MAVINCI.</p>
            <button type="button" onClick={() => void reloadContext()} className={`${retryButton} mt-5`}><RefreshCw className="h-4 w-4" />Spróbuj ponownie</button>
          </> : <>
            <h1 className="text-xl">Konto nie ma jeszcze dostępu</h1>
            <p className="mt-3 text-sm leading-6 text-white/55">
              Opiekun MAVINCI musi włączyć portal dla Twojego konta. Dzięki temu dane hotelu nie zostaną udostępnione innej osobie.
            </p>
          </>}
        </div>
      </div>
    );
  }

  const firstName = context.profile.person.name?.split(' ')[0] || 'Sprzedawco';
  const cards: { label: string; value: string | number; Icon: typeof Send; color: string; href: string; note?: string }[] = [
    { label: '1 · Oferta', value: stats.offer, Icon: FileText, color: 'text-amber-300', href: '/seller/offers?etap=offer', note: 'w przygotowaniu' },
    { label: '2 · U klienta', value: stats.client, Icon: Send, color: 'text-amber-200', href: '/seller/offers?etap=client', note: 'PDF lub link u klienta' },
    { label: '3 · U opiekuna', value: stats.manager, Icon: Hourglass, color: 'text-sky-300', href: '/seller/offers?etap=manager', note: context.manager?.name ? `sprawdza: ${context.manager.name.split(' ')[0]}` : 'ocena oferty' },
    { label: '4 · Wydarzenia', value: stats.realized, Icon: CalendarCheck, color: 'text-emerald-300', href: '/seller/realizations', note: 'przyjęte przez opiekuna' },
    ...(anyCommissionVisible ? [{ label: 'Prognoza wynagrodzenia', value: sellerMoney(stats.forecast), Icon: BadgePercent, color: 'text-[#d3bb73]', href: '/seller/commissions', note: FORECAST_NOTE }] : []),
  ];

  return (
    <div className="min-h-screen p-4 text-[#e5e4e2] md:p-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-light sm:text-3xl">Dzień dobry, {firstName}</h1>
            <p className="mt-1 text-sm text-white/50">
              {context.profile.organization?.alias || context.profile.organization?.name} · sprzedaż wydarzeń MAVINCI
            </p>
          </div>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            <Link href="/seller/inquiries" className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-white/[0.06] px-4 py-2.5 text-sm hover:bg-white/10 sm:flex-none"><CalendarSearch className="h-4 w-4 text-[#d3bb73]" />Sprawdź termin</Link>
            <Link href="/seller/offers/new" className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-5 py-2.5 text-sm font-medium text-[#111522] sm:flex-none"><Plus className="h-4 w-4" />Przygotuj ofertę</Link>
          </div>
        </header>

        <SellerWelcomeChecklist context={context} offerCount={offers.length} onboarding={onboarding} />
        <SellerOnboardingGuide context={context} onboarding={onboarding} autoOpen={!loadingOffers && !offersError && offers.length === 0} />

        {offersError && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-rose-300/10 p-4 text-sm text-rose-100">
          <p className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{offersError} {offers.length ? 'Wyświetlamy ostatnio wczytane dane.' : 'Liczby poniżej nie są jeszcze dostępne.'}</p>
          <button type="button" onClick={retryOffers} disabled={loadingOffers} className={retryButton}><RefreshCw className={`h-4 w-4 ${loadingOffers ? 'animate-spin' : ''}`} />Spróbuj ponownie</button>
        </div>}
        {stagesError && !offersError && <p role="status" className="rounded-lg bg-amber-300/10 p-3 text-sm text-amber-100">{stagesError}</p>}

        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-5">
            <section aria-label="Oferty na etapach" className={`grid grid-cols-2 gap-3 ${anyCommissionVisible ? 'xl:grid-cols-5' : 'xl:grid-cols-4'}`}>
              {cards.map(({ label, value, Icon, color, href, note }) => (
                <Link key={label} href={href} className="rounded-xl bg-[#1c1f33] p-4 transition hover:bg-[#232741] sm:p-5">
                  <div className="flex items-center justify-between gap-2"><p className="text-xs text-white/50">{label}</p><Icon className={`h-5 w-5 shrink-0 ${color}`} /></div>
                  <p className="mt-3 text-xl font-light sm:text-2xl">{offersError && !offers.length ? '—' : value}</p>
                  {note && <p className="mt-1 text-[10px] leading-4 text-white/40">{note}</p>}
                </Link>
              ))}
            </section>

            <section aria-labelledby="seller-todo-title" className="rounded-xl bg-[#1c1f33] p-5">
              <div className="flex items-center justify-between gap-3"><h2 id="seller-todo-title" className="text-base font-medium">Do zrobienia</h2><Link href="/seller/offers" className="text-sm text-[#d3bb73]">Wszystkie oferty</Link></div>
              {offersError && !offers.length ? <p className="mt-4 text-sm text-white/50">Lista zadań pojawi się po wczytaniu ofert.</p>
                : !todo.length ? <p className="mt-4 flex items-center gap-2 text-sm text-white/55"><CheckCircle2 className="h-4 w-4 text-emerald-300" />Wszystko na bieżąco. Gdy będziesz musiał coś zrobić, zobaczysz to tutaj.</p>
                : <ul className="mt-4 space-y-2">{todo.map(({ offer, stage }) => <li key={offer.id}>
                  <Link href={`/seller/offers/${offer.id}`} className="flex items-center gap-3 rounded-lg bg-white/[0.03] p-3 transition hover:bg-white/[0.07]">
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2"><SellerJourneyDots journey={stage.journey} /><span className={`rounded-md px-2 py-0.5 text-[11px] ${sellerOfferToneClass[stage.tone]}`}>{stage.label}</span><span className="truncate text-sm">{offer.title || offer.offer_number || 'Oferta bez tytułu'}</span></span>
                      <span className="mt-1 block text-xs leading-5 text-white/50">{stage.next}</span>
                    </span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-white/40" />
                  </Link>
                </li>)}</ul>}
            </section>

            <section aria-labelledby="seller-recent-title" className="rounded-xl bg-[#1c1f33]">
              <div className="flex items-center justify-between gap-3 p-5 pb-3">
                <div><h2 id="seller-recent-title" className="text-base font-medium">Ostatnie oferty</h2><p className="mt-1 text-xs text-white/40">Cena dla klienta netto i aktualny etap.</p></div>
                <Link href="/seller/offers" className="text-sm text-[#d3bb73]">Wszystkie</Link>
              </div>
              <div className="divide-y divide-white/5">
                {rows.slice(0, 6).map(({ offer, stage }) => {
                  const showCommission = offer.commercial_model === 'commission' && sellerCommissionsVisible(context, offer.my_company_id);
                  return <Link key={offer.id} href={stage.journey.index >= 3 ? `/seller/realizations/${offer.id}` : `/seller/offers/${offer.id}`} className="grid gap-2 px-5 py-4 transition-colors hover:bg-white/[0.02] sm:grid-cols-[minmax(0,1.4fr)_auto_9rem] sm:items-center sm:gap-4">
                    <div className="min-w-0">
                      <p className="truncate text-sm">{offer.title || offer.offer_number || 'Oferta bez tytułu'}</p>
                      <p className="mt-1 truncate text-xs text-white/40">{offer.portal_client_company || offer.portal_client_name || 'Klient do uzupełnienia'}</p>
                    </div>
                    <span className="flex flex-col gap-1"><SellerJourneyDots journey={stage.journey} /><span className={`w-fit rounded-md px-2 py-1 text-[11px] ${sellerOfferToneClass[stage.tone]}`}>{stage.journey.stageLabel} · {stage.label}</span></span>
                    <div className="sm:text-right">
                      <p className="text-sm">{sellerMoney(offer.client_total_net)} <span className="text-[10px] text-white/40">netto</span></p>
                      {offer.commercial_model !== 'commission' && Number(offer.partner_earnings_amount) !== 0 && <p className="text-[11px] text-[#d3bb73]/80">Marża hotelu: {sellerMoney(offer.partner_earnings_amount)}</p>}
                      {showCommission && <p className="text-[11px] text-[#d3bb73]/80" title={FORECAST_NOTE}>Prowizja (szacunek): {sellerMoney(offer.partner_earnings_amount)}</p>}
                    </div>
                  </Link>;
                })}
                {!offersError && offers.length === 0 && <div className="p-10 text-center"><FileText className="mx-auto h-8 w-8 text-white/20" /><p className="mt-3 text-sm text-white/50">Nie ma jeszcze ofert. Zacznij od wyboru usług lub szybkiego zapytania o termin.</p><Link href="/seller/offers/new" className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#d3bb73]/15 px-4 py-2 text-sm text-[#d3bb73]"><Plus className="h-4 w-4" />Przygotuj pierwszą ofertę</Link></div>}
              </div>
            </section>
            {anyCommissionVisible && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white/[0.03] px-5 py-4">
              <p className="max-w-2xl text-xs leading-5 text-white/50">Kwoty prowizji z ofert to prognoza ({FORECAST_NOTE}), nie potwierdzenie wypłaty. Naliczenia i wypłaty sprawdzisz w rozliczeniach.</p>
              <Link href="/seller/commissions" className="shrink-0 text-sm text-[#d3bb73] hover:underline">Moje wynagrodzenie i wypłaty</Link>
            </div>}
          </div>

          <aside className="min-w-0 space-y-5">
            <SellerManagerCard manager={context.manager} partnerId={context.profile.id} />
            <SellerInboxPanel partnerId={context.profile.id} />
          </aside>
        </div>
      </div>
    </div>
  );
}
