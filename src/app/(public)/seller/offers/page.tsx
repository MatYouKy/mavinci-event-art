'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { FileText, Plus, Search } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { sellerMoney, sellerStatusLabel, useSellerPortalContext } from '@/lib/seller/portal';
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
  delivery?: { offer_id: string; is_realization: boolean; review_status: string | null; client_confirmed: boolean };
};
const offerStage = (offer: OfferRow) => {
  if (offer.delivery?.review_status === 'pending') return { value: 'awaiting_mavinci', label: 'Oczekuje na MAVINCI', next: offer.delivery.client_confirmed ? 'Klient zaakceptował. Czekamy na decyzję opiekuna.' : 'Zapytanie przekazane opiekunowi. Historyczna zgoda klienta nie została zapisana.' };
  if (offer.delivery?.review_status === 'changes_requested') return { value: 'changes_requested', label: 'Do uzupełnienia', next: 'Sprawdź odpowiedź opiekuna i rozmowę o ofercie.' };
  if (offer.delivery?.review_status === 'rejected') return { value: 'review_rejected', label: 'Brak akceptacji MAVINCI', next: 'Szczegóły decyzji i dalsze ustalenia znajdziesz w ofercie.' };
  if (offer.delivery?.review_status === 'approved') return { value: 'approved', label: 'Zaakceptowana przez opiekuna', next: 'Otwórz ofertę, aby sprawdzić przygotowanie realizacji.' };
  return { value: offer.status, label: sellerStatusLabel(offer.status), next: ['draft', 'sent', 'viewed'].includes(offer.status) ? 'Po akceptacji klienta przekaż aktualną ofertę do potwierdzenia MAVINCI.' : '' };
};

export default function SellerOffersPage() {
  const { context, loading: contextLoading } = useSellerPortalContext();
  const [offers, setOffers] = useState<OfferRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [error, setError] = useState('');
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
      const states: NonNullable<OfferRow['delivery']>[] = [];
      let progressError = '';
      for (let offset = 0; offset < rows.length; offset += 200) {
        const response = await supabase.rpc('get_seller_offer_delivery_states', { p_offers: rows.slice(offset, offset + 200).map((offer) => offer.id) });
        if (!active) return;
        if (response.error) { progressError = 'Nie udało się wczytać etapów akceptacji. Otwórz ofertę, aby sprawdzić aktualną decyzję. Nowy widok wymaga migracji 20260917230000.'; break; }
        states.push(...(response.data || []));
      }
      if (!active) return;
      const byOffer = new Map(states.map((state) => [state.offer_id, state]));
      setError(progressError);
      setOffers(rows.map((offer) => ({ ...offer, delivery: byOffer.get(offer.id) })).filter((offer) => !offer.delivery?.is_realization));
      setLoading(false);
      } catch {
        if (active) { setError('Nie udało się odświeżyć ofert. Spróbuj ponownie.'); setLoading(false); }
      }
    })();
    return () => { active = false; };
  }, [context, contextLoading, revision]);

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
            <p className="mt-1 text-sm text-[#e5e4e2]/40">Przygotuj ofertę → potwierdź akceptację klienta i przekaż do MAVINCI → po akceptacji opiekuna kontynuuj w <Link href="/seller/realizations" className="text-[#d3bb73] underline underline-offset-4">Realizacjach</Link>. Potwierdzenie wydarzenia jest osobnym krokiem.</p>
          </div>
          <Link href="/seller/offers/new" className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2.5 text-sm font-medium text-[#111522]"><Plus className="h-4 w-4" /> Nowa oferta</Link>
        </header>

        <SellerInboxPanel partnerId={context.profile.id} scope="offers" />
        {error && <p role="alert" className="rounded-lg bg-amber-300/10 p-3 text-sm text-amber-200">{error}</p>}

        <section className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]">
          <div className="flex flex-wrap gap-3 border-b border-white/5 p-4">
            <label className="relative min-w-64 flex-1"><Search className="absolute left-3 top-3 h-4 w-4 text-[#e5e4e2]/30" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Szukaj klienta, tytułu lub numeru..." className="w-full rounded-lg border border-white/10 bg-[#0f1119] py-2.5 pl-9 pr-3 text-sm outline-none focus:border-[#d3bb73]/50" /></label>
            <select aria-label="Etap oferty" value={status} onChange={(event) => setStatus(event.target.value)} className="rounded-lg border border-white/10 bg-[#0f1119] px-3 py-2 text-sm"><option value="all">Wszystkie etapy</option><option value="draft">Szkice</option><option value="sent">Wysłane</option><option value="viewed">Wyświetlone</option><option value="awaiting_mavinci">Oczekuje na MAVINCI</option><option value="changes_requested">Do uzupełnienia</option><option value="review_rejected">Brak akceptacji MAVINCI</option><option value="approved">Zaakceptowane przez opiekuna</option><option value="rejected">Odrzucone</option></select>
          </div>

          <div className="divide-y divide-white/5">
            {filtered.map((offer) => (
              <Link key={offer.id} href={`/seller/offers/${offer.id}`} className="grid gap-3 p-5 transition-colors hover:bg-white/[0.02] lg:grid-cols-[minmax(220px,1.5fr)_110px_150px_150px_130px] lg:items-center">
                <div className="min-w-0">
                  <div className="flex items-center gap-2"><FileText className="h-4 w-4 shrink-0 text-[#d3bb73]" /><p className="truncate text-sm">{offer.title || offer.offer_number || 'Oferta bez tytułu'}</p></div>
                  <p className="mt-1 truncate pl-6 text-xs text-[#e5e4e2]/35">{offer.portal_client_company || offer.portal_client_name || 'Klient do uzupełnienia'} · {offer.offer_number}</p>
                  <p className="mt-2 pl-6 text-xs leading-5 text-white/50">{offerStage(offer).next}</p>
                </div>
                <div><p className="text-xs text-[#d3bb73]">{offerStage(offer).label}</p>{offer.partner_approval_status === 'required' && <p className="mt-1 text-[10px] text-amber-300">Dodatkowa zgoda handlowa wymagana</p>}</div>
                <div><p className="text-[10px] text-[#e5e4e2]/30">CENA MAVINCI</p><p className="mt-1 text-sm">{sellerMoney(offer.partner_base_net)}</p></div>
                <div><p className="text-[10px] text-[#e5e4e2]/30">CENA KLIENTA</p><p className="mt-1 text-sm">{sellerMoney(offer.client_total_net)}</p></div>
                {(offer.commercial_model !== 'commission' || context.brands.some((brand) => brand.my_company_id === offer.my_company_id && brand.commission_enabled === true)) && <div><p className="text-[10px] text-[#e5e4e2]/30">DLA CIEBIE</p><p className="mt-1 text-sm text-[#d3bb73]">{sellerMoney(offer.partner_earnings_amount)}</p></div>}
              </Link>
            ))}
            {filtered.length === 0 && <p className="p-12 text-center text-sm text-[#e5e4e2]/35">Brak ofert spełniających kryteria.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}
