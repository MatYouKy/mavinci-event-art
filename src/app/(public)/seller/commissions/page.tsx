'use client';

import { useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, WalletCards } from 'lucide-react';
import { sellerAnyCommissionsVisible, useSellerPortalContext } from '@/lib/seller/portal';
import { sellerCommissionPaymentLabels, SELLER_FORECAST_NOTE } from '@/lib/seller/commissions';
import SellerCommissionsView from '@/components/seller/SellerCommissionsView';

export default function SellerCommissionsPage() {
  const router = useRouter();
  const { context, loading: contextLoading, error: contextError, reload } = useSellerPortalContext();
  const visible = sellerAnyCommissionsVisible(context);
  // Terms are listed only for brands whose commissions MAVINCI has revealed.
  const commissionBrands = useMemo(() => context?.brands.filter((brand) => brand.commission_enabled && brand.commissions_visible === true) || [], [context]);

  useEffect(() => {
    if (!contextLoading && context && !visible) router.replace('/seller');
  }, [context, contextLoading, router, visible]);

  if (contextLoading || (context && !visible)) return <p role="status" className="flex items-center justify-center gap-2 p-10 text-[#d3bb73]"><Loader2 className="h-4 w-4 animate-spin" />Ładowanie rozliczeń…</p>;
  if (!context) return <div role="alert" className="space-y-3 p-10 text-center text-white/60"><p>{contextError || 'Brak dostępu do portalu sprzedawcy.'}</p><button type="button" onClick={() => void reload()} className="inline-flex min-h-10 items-center rounded-lg bg-[#d3bb73]/10 px-4 py-2 text-sm text-[#d3bb73]">Spróbuj ponownie</button></div>;

  return (
    <div className="min-h-screen p-4 text-[#e5e4e2] md:p-6"><div className="mx-auto max-w-4xl space-y-5">
      <header className="flex items-start gap-3"><span className="rounded-xl bg-[#d3bb73]/10 p-3"><WalletCards className="h-5 w-5 text-[#d3bb73]" /></span>
        <div><h1 className="text-2xl font-light">Moje wynagrodzenie</h1>
          <p className="mt-1 text-sm leading-6 text-white/50">Prowizje za wydarzenia z Twoich ofert: prognozy, kwoty do wypłaty i historia wypłat. Prognoza to {SELLER_FORECAST_NOTE}; ostateczną kwotę zobaczysz po rozliczeniu wydarzenia.</p></div>
      </header>
      <SellerCommissionsView />
      {commissionBrands.length > 0 && <section className="rounded-xl bg-[#1c1f33] p-5">
        <h2 className="text-base font-medium">Twoje warunki</h2>
        <p className="mt-1 text-xs text-white/45">Stawki ustalone indywidualnie z MAVINCI. Zmiana warunków nie zmienia wcześniejszych rozliczeń.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">{commissionBrands.map((brand) => <div key={brand.my_company_id} className="flex items-start justify-between gap-4 rounded-xl bg-[#0f1119] p-4">
          <div><p className="text-sm">{brand.name}</p><p className="mt-1 text-xs text-white/45">{(brand.default_payment_method && sellerCommissionPaymentLabels[brand.default_payment_method]) || 'Sposób wypłaty do ustalenia'}</p></div>
          <div className="text-right"><p className="text-[10px] uppercase tracking-wide text-white/40">Prowizja</p><p className="mt-1 text-xl text-[#d3bb73]">{Number(brand.default_commission_rate || 0)}%</p></div>
        </div>)}</div>
      </section>}
    </div></div>
  );
}
