'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { BadgePercent, FileText, Plus, Send, TrendingUp } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { sellerMoney, sellerStatusLabel, useSellerPortalContext } from '@/lib/seller/portal';
import { useOfferRefresh } from '@/lib/seller/useOfferRefresh';

type PartnerOffer = {
  my_company_id: string;
  id: string;
  offer_number: string | null;
  title: string | null;
  portal_client_name: string | null;
  portal_client_company: string | null;
  status: string;
  client_total_net: number;
  partner_earnings_amount: number;
  commercial_model: 'markup' | 'commission' | null;
  created_at: string;
};

export default function SellerDashboard() {
  const { context, loading: contextLoading, error: contextError } = useSellerPortalContext();
  const [offers, setOffers] = useState<PartnerOffer[]>([]);
  const [loadingOffers, setLoadingOffers] = useState(true);
  const revision = useOfferRefresh(context ? `sales_partner_id=eq.${context.profile.id}` : undefined);

  useEffect(() => {
    if (!context) {
      if (!contextLoading) setLoadingOffers(false);
      return;
    }
    void (async () => {
      const { data } = await supabase
        .from('offers')
        .select('id,my_company_id,offer_number,title,portal_client_name,portal_client_company,status,client_total_net,partner_earnings_amount,commercial_model,created_at')
        .eq('sales_channel', 'seller_portal')
        .eq('sales_partner_id', context.profile.id)
        .order('created_at', { ascending: false })
        .limit(100);
      setOffers((data || []) as PartnerOffer[]);
      setLoadingOffers(false);
    })();
  }, [context, contextLoading, revision]);

  const stats = useMemo(() => ({
    all: offers.length,
    active: offers.filter((offer) => ['draft', 'sent', 'viewed'].includes(offer.status)).length,
    accepted: offers.filter((offer) => offer.status === 'accepted').length,
    earnings: offers
      .filter((offer) => offer.status === 'accepted' && offer.commercial_model === 'commission' && context?.brands.some((brand) => brand.my_company_id === offer.my_company_id && brand.commission_enabled === true))
      .reduce((sum, offer) => sum + Number(offer.partner_earnings_amount || 0), 0),
  }), [offers, context]);
  const hasCommissionAccess = Boolean(context?.brands.some((brand) => brand.commission_enabled));
  const dashboardCards = [
    { label: 'Wszystkie oferty', value: stats.all, Icon: FileText, color: 'text-sky-300' },
    { label: 'W toku', value: stats.active, Icon: Send, color: 'text-amber-300' },
    { label: 'Zaakceptowane', value: stats.accepted, Icon: TrendingUp, color: 'text-emerald-300' },
    ...(hasCommissionAccess ? [{ label: 'Z zaakceptowanych ofert', value: sellerMoney(stats.earnings), Icon: BadgePercent, color: 'text-[#d3bb73]' }] : []),
  ];

  if (contextLoading || loadingOffers) {
    return <div className="flex min-h-[70vh] items-center justify-center text-[#d3bb73]">Ładowanie portalu...</div>;
  }

  if (!context) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center p-6">
        <div className="max-w-lg rounded-xl border border-amber-300/20 bg-[#1c1f33] p-8 text-center">
          <h2 className="text-xl text-[#e5e4e2]">Konto nie ma jeszcze dostępu</h2>
          <p className="mt-3 text-sm leading-6 text-[#e5e4e2]/55">
            Administrator musi w kartotece sprzedawcy włączyć portal i przypisać identyfikator tego konta. Dzięki temu dane hotelu nie zostaną udostępnione innej osobie.
          </p>
          {contextError && <p className="mt-4 text-xs text-amber-200/60">{contextError}</p>}
        </div>
      </div>
    );
  }

  const firstName = context.profile.person.name?.split(' ')[0] || 'Sprzedawco';

  return (
    <div className="min-h-screen p-4 text-[#e5e4e2] md:p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-light">Dzień dobry, {firstName}</h1>
            <p className="mt-1 text-sm text-[#e5e4e2]/45">
              {context.profile.organization?.alias || context.profile.organization?.name} · oferty przygotowane na bazie katalogu Mavinci
            </p>
          </div>
          <Link href="/seller/offers/new" className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-5 py-3 text-sm font-medium text-[#111522]">
            <Plus className="h-4 w-4" /> Przygotuj ofertę
          </Link>
        </header>

        <section className={`grid gap-4 md:grid-cols-2 ${hasCommissionAccess ? 'xl:grid-cols-4' : 'xl:grid-cols-3'}`}>
          {dashboardCards.map(({ label, value, Icon, color }) => (
            <div key={label} className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-5">
              <div className="flex items-center justify-between">
                <p className="text-xs text-[#e5e4e2]/45">{label}</p>
                <Icon className={`h-5 w-5 ${color}`} />
              </div>
              <p className="mt-3 text-2xl font-light">{value}</p>
            </div>
          ))}
        </section>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white/[0.03] px-5 py-4">
          <p className="max-w-2xl text-xs leading-5 text-[#e5e4e2]/45">Kwoty z ofert są prognozą wynagrodzenia, nie potwierdzeniem wypłaty. Zapisane naliczenia, wypłaty i pozostałe kwoty sprawdzisz w rozliczeniach.</p>
          <Link href="/seller/commissions" className="shrink-0 text-sm text-[#d3bb73] hover:underline">Moje wynagrodzenie i wypłaty</Link>
        </div>

        <section className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]">
          <div className="flex items-center justify-between border-b border-white/5 p-5">
            <div>
              <h2 className="font-medium">Ostatnie oferty</h2>
              <p className="mt-1 text-xs text-[#e5e4e2]/35">{hasCommissionAccess ? 'Cena Mavinci, cena klienta i Twoje wynagrodzenie są liczone oddzielnie.' : 'Cena Mavinci i cena dla klienta są liczone oddzielnie.'}</p>
            </div>
            <Link href="/seller/offers" className="text-sm text-[#d3bb73]">Wszystkie</Link>
          </div>
          <div className="divide-y divide-white/5">
            {offers.slice(0, 6).map((offer) => (
              <Link key={offer.id} href={`/seller/offers/${offer.id}`} className={`grid gap-3 p-5 transition-colors hover:bg-white/[0.02] ${hasCommissionAccess ? 'md:grid-cols-[1.4fr_1fr_130px_140px]' : 'md:grid-cols-[1.4fr_1fr_130px]'} md:items-center`}>
                <div>
                  <p className="text-sm">{offer.title || offer.offer_number || 'Oferta bez tytułu'}</p>
                  <p className="mt-1 text-xs text-[#e5e4e2]/35">{offer.portal_client_company || offer.portal_client_name || 'Klient do uzupełnienia'}</p>
                </div>
                <p className="text-xs text-[#e5e4e2]/55">{sellerStatusLabel(offer.status)}</p>
                <p className="text-sm">{sellerMoney(offer.client_total_net)} <span className="text-[10px] text-[#e5e4e2]/30">netto</span></p>
                {hasCommissionAccess && <p className="text-sm text-[#d3bb73]">{offer.commercial_model === 'commission' && context.brands.some((brand) => brand.my_company_id === offer.my_company_id && brand.commission_enabled === true) ? sellerMoney(offer.partner_earnings_amount) : '—'}</p>}
              </Link>
            ))}
            {offers.length === 0 && <p className="p-10 text-center text-sm text-[#e5e4e2]/35">Nie ma jeszcze ofert. Zacznij od wyboru produktów.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}
