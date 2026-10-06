'use client';

import { useMemo } from 'react';
import { WalletCards } from 'lucide-react';
import { useSellerPortalContext } from '@/lib/seller/portal';
import CommissionSettlementsPanel from '@/components/crm/commissions/CommissionSettlementsPanel';
const paymentMethodLabels: Record<string, string> = {
  cash_dividend: 'Wypłata gotówkowa',
  payroll: 'Lista płac',
  invoice: 'Faktura',
  transfer: 'Przelew',
  other: 'Inny sposób rozliczenia',
};

export default function SellerCommissionsPage() {
  const { context, loading: contextLoading, error: contextError } = useSellerPortalContext();
  const commissionBrands = useMemo(() => context?.brands.filter((brand) => brand.commission_enabled) || [], [context]);

  if (contextLoading) return <div className="p-10 text-center text-[#d3bb73]">Ładowanie rozliczeń...</div>;
  if (!context) return <div className="p-10 text-center text-white/40"><p>Brak dostępu do portalu sprzedawcy.</p>{contextError && <p className="mt-2 text-sm text-amber-200">{contextError}</p>}</div>;

  return (
    <div className="min-h-screen p-4 text-[#e5e4e2] md:p-6"><div className="mx-auto max-w-6xl space-y-5">
      <header><div className="flex items-center gap-3"><span className="rounded-xl bg-[#d3bb73]/10 p-3"><WalletCards className="h-5 w-5 text-[#d3bb73]" /></span><div><h1 className="text-2xl font-light">Moje wynagrodzenie</h1><p className="mt-1 text-sm text-white/40">Twoje naliczenia, historia wypłat i pozostałe rozliczenia. Widok jest tylko do odczytu; zmiana bieżących warunków nie usuwa historii.</p></div></div></header>
      <CommissionSettlementsPanel mode="seller" />
      {commissionBrands.length > 0 ? <section className="rounded-xl border border-white/5 bg-[#1c1f33]">
        <div className="border-b border-white/5 p-5"><h2 className="font-medium">Indywidualne warunki wynagrodzenia</h2><p className="mt-1 text-xs text-white/40">Stawki są ustalane indywidualnie z MAVINCI i automatycznie stosowane w ofertach prowizyjnych.</p></div>
        <div className="grid gap-3 p-5 md:grid-cols-2">{commissionBrands.map((brand) => <div key={brand.my_company_id} className="rounded-xl bg-[#0f1119] p-4"><div className="flex items-start justify-between gap-4"><div><p className="text-sm">{brand.name}</p><p className="mt-1 text-xs text-white/35">{paymentMethodLabels[brand.default_payment_method] || brand.default_payment_method || 'Sposób wypłaty do ustalenia'}</p></div><div className="text-right"><p className="text-[10px] uppercase tracking-wide text-white/30">Prowizja</p><p className="mt-1 text-xl text-[#d3bb73]">{Number(brand.default_commission_rate || 0)}%</p></div></div></div>)}</div>
      </section> : <p className="rounded-xl bg-white/[0.03] p-4 text-sm text-white/45">Nie masz aktualnie włączonych warunków prowizyjnych dla nowych ofert. Własne wcześniejsze rozliczenia pozostają dostępne powyżej.</p>}
    </div></div>
  );
}
