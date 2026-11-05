'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Building2, MessageSquare, Pencil, Search, UserRound, Users } from 'lucide-react';
import {
  SELLER_WARNING_LABELS,
  type SellerCockpit,
  type SellerCockpitSeller,
  type SellerWarningCode,
} from '@/lib/seller/sellerCockpit';
import CommissionVisibilityToggle from '../CommissionVisibilityToggle';
import SellerManagerAssignment, { ManagerRightsBadge } from '../SellerManagerAssignment';
import {
  PortalAccountPill,
  SellerDialog,
  SellerStatusPill,
  formatSellerRelative,
  sellerCardHref,
  sellerFieldClass,
  sellerPln,
} from '../sellerUi';

type Filter = 'all' | 'active' | 'onboarding' | 'inactive' | 'warnings';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Wszyscy' },
  { id: 'active', label: 'Aktywni' },
  { id: 'onboarding', label: 'Do uzgodnienia' },
  { id: 'inactive', label: 'Nieaktywni' },
  { id: 'warnings', label: 'Z ostrzeżeniami' },
];
const PARTNER_TYPE_LABELS: Record<string, string> = {
  internal_employee: 'Sprzedawca Mavinci',
  hotel_employee: 'Pracownik hotelu',
  agency_employee: 'Pracownik agencji',
  independent_referrer: 'Niezależny polecający',
};
const knownWarnings = (codes: string[]) => codes.filter((code): code is SellerWarningCode => code in SELLER_WARNING_LABELS);

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return <div className="min-w-0">
    <p className="text-[10px] uppercase tracking-wide text-white/35">{label}</p>
    <p className={`mt-0.5 truncate text-sm ${tone || 'text-[#e5e4e2]'}`}>{value}</p>
  </div>;
}

function SellerRow({ seller, isAdmin, onManage, onChanged }: { seller: SellerCockpitSeller; isAdmin: boolean; onManage: () => void; onChanged: () => void }) {
  const warnings = knownWarnings(seller.warnings);
  const activeBrands = seller.brands.filter(brand => brand.is_active);
  const offers = seller.offers;
  return <article className="rounded-2xl bg-[#1c1f33] p-4 sm:p-5">
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[minmax(220px,1.3fr)_minmax(170px,0.9fr)_minmax(180px,0.9fr)_minmax(240px,1.2fr)] xl:items-start">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-[#d3bb73]/10 p-1.5"><UserRound className="h-4 w-4 text-[#d3bb73]" /></span>
          <Link href={sellerCardHref(seller)} className="truncate text-base hover:text-[#d3bb73]">{seller.name}</Link>
        </div>
        <p className="mt-1.5 flex items-center gap-1.5 truncate text-xs text-white/50"><Building2 className="h-3.5 w-3.5 shrink-0" />{seller.organization_name || 'Bez organizacji'}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <SellerStatusPill status={seller.status} />
          <span className="text-[11px] text-white/35">{PARTNER_TYPE_LABELS[seller.partner_type] || 'Sprzedawca zewnętrzny'}</span>
        </div>
      </div>
      <div className="space-y-1.5 text-xs">
        <PortalAccountPill account={seller.portal_account} enabled={seller.portal_enabled} />
        <p className="text-white/45">Logowanie: <span className="text-white/70">{formatSellerRelative(seller.last_sign_in_at)}</span></p>
        <p className="text-white/45">Aktywność: <span className="text-white/70">{formatSellerRelative(seller.last_activity_at, 'brak')}</span></p>
      </div>
      <div className="space-y-1.5 text-xs">
        <p className="text-white/45">Opiekun: <span className="text-white/75">{seller.manager?.name || 'brak'}</span></p>
        {seller.manager && !seller.manager_ok && <ManagerRightsBadge />}
        <p className="text-white/45">Zastępca: <span className="text-white/75">{seller.backup_manager?.name || 'brak'}</span></p>
        {isAdmin && <button type="button" onClick={onManage} className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[#d3bb73] hover:bg-white/5"><Pencil className="h-3 w-3" />Zmień opiekuna</button>}
      </div>
      <div className="grid grid-cols-3 gap-3 rounded-xl bg-[#0f1119]/60 p-3">
        <Stat label="Oferty" value={offers.total} />
        <Stat label="Wydarzenia" value={seller.upcoming_events} />
        <Stat label="Do sprawdzenia" value={offers.review} tone={offers.review ? 'text-amber-200' : undefined} />
        <Stat label="Do wypłaty" value={sellerPln(seller.payable)} tone="text-violet-200" />
        <Stat label="Prognoza" value={sellerPln(seller.forecast)} tone="text-white/70" />
        <Stat label="Zaakceptowane" value={offers.accepted} tone={offers.accepted ? 'text-emerald-200' : undefined} />
        <p className="col-span-3 text-[10px] text-white/35">Szkice {offers.draft} · PDF {offers.pdf}</p>
      </div>
    </div>
    <div className="mt-4 flex flex-col gap-3 rounded-xl bg-[#0f1119]/40 p-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        {activeBrands.length === 0 && <span className="text-xs text-amber-200/80">Brak aktywnej marki</span>}
        {activeBrands.map(brand => <span key={brand.my_company_id} className="inline-flex flex-wrap items-center gap-2 rounded-xl bg-white/[0.04] py-1 pl-3 pr-1 text-xs">
          <span className="text-[#d3bb73]">{brand.name}</span>
          <span className="text-white/50">{brand.commission_enabled ? (brand.rate == null ? 'prowizja' : `${brand.rate.toLocaleString('pl-PL', { maximumFractionDigits: 2 })}%`) : 'narzut'}</span>
          {brand.commission_enabled && <CommissionVisibilityToggle compact partnerId={seller.id} companyId={brand.my_company_id} brandName={brand.name} visible={brand.commissions_visible} onChanged={onChanged} />}
        </span>)}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {warnings.map(code => <span key={code} className="inline-flex items-center gap-1 rounded-full bg-amber-400/10 px-2 py-0.5 text-[11px] text-amber-200"><AlertTriangle className="h-3 w-3" />{SELLER_WARNING_LABELS[code]}</span>)}
        <Link href={sellerCardHref(seller, 'chat')} className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.05] px-3 py-1.5 text-xs text-white/70 hover:bg-white/[0.09]"><MessageSquare className="h-3.5 w-3.5" />Rozmowy</Link>
        <Link href={sellerCardHref(seller)} className="rounded-lg bg-[#d3bb73]/10 px-3 py-1.5 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/15">Karta sprzedawcy</Link>
      </div>
    </div>
  </article>;
}

/** „Moi sprzedawcy” — stan konta, aktywność, opiekun, marki z widocznością wynagrodzenia, oferty i ostrzeżenia. */
export default function CockpitSellers({ cockpit, onChanged }: { cockpit: SellerCockpit; onChanged: () => void }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [managing, setManaging] = useState<SellerCockpitSeller | null>(null);
  const isAdmin = cockpit.viewer.is_admin;

  const counts = useMemo(() => ({
    all: cockpit.sellers.length,
    active: cockpit.sellers.filter(seller => seller.status === 'active').length,
    onboarding: cockpit.sellers.filter(seller => seller.status === 'onboarding').length,
    inactive: cockpit.sellers.filter(seller => seller.status === 'inactive').length,
    warnings: cockpit.sellers.filter(seller => knownWarnings(seller.warnings).length > 0).length,
  }), [cockpit.sellers]);

  const sellers = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('pl-PL');
    return cockpit.sellers
      .filter(seller => filter === 'all' || (filter === 'warnings' ? knownWarnings(seller.warnings).length > 0 : seller.status === filter))
      .filter(seller => !needle || `${seller.name} ${seller.organization_name || ''} ${seller.email || ''} ${seller.manager?.name || ''}`.toLocaleLowerCase('pl-PL').includes(needle))
      .sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active') || b.offers.review - a.offers.review || a.name.localeCompare(b.name, 'pl'));
  }, [cockpit.sellers, filter, query]);

  return <section aria-labelledby="cockpit-sellers-heading" className="space-y-3">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 id="cockpit-sellers-heading" className="flex items-center gap-2 text-lg font-medium"><Users className="h-5 w-5 text-[#d3bb73]" />{isAdmin ? 'Sprzedawcy' : 'Moi sprzedawcy'}</h2>
        <p className="mt-0.5 text-xs text-white/45">Stan konta w portalu, aktywność, marki i to, czy sprzedawca widzi swoje wynagrodzenie.</p>
      </div>
      <div className="relative w-full sm:w-72"><Search className="absolute left-3 top-3 h-4 w-4 text-white/30" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Szukaj sprzedawcy lub hotelu…" aria-label="Szukaj sprzedawcy" className={`${sellerFieldClass} pl-9`} /></div>
    </div>
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filtr sprzedawców">
      {FILTERS.filter(item => item.id === 'all' || counts[item.id] > 0).map(item => <button key={item.id} type="button" role="tab" aria-selected={filter === item.id} onClick={() => setFilter(item.id)} className={`rounded-lg px-3 py-1.5 text-xs transition-colors ${filter === item.id ? 'bg-[#d3bb73]/15 text-[#d3bb73]' : 'bg-white/[0.03] text-white/55 hover:bg-white/[0.06]'}`}>{item.label} <span className="opacity-60">{counts[item.id]}</span></button>)}
    </div>
    <div className="space-y-3">
      {sellers.map(seller => <SellerRow key={seller.id} seller={seller} isAdmin={isAdmin} onManage={() => setManaging(seller)} onChanged={onChanged} />)}
      {sellers.length === 0 && <p className="rounded-2xl bg-[#1c1f33] p-8 text-center text-sm text-white/40">Brak sprzedawców spełniających filtry.</p>}
    </div>
    <SellerDialog open={Boolean(managing)} onClose={() => setManaging(null)} title={managing ? `Opiekun: ${managing.name}` : 'Opiekun'} description="Opiekun prowadzi rozmowy, decyzje o ofertach i realizacje sprzedawcy. Zastępca przejmuje je podczas nieobecności." wide>
      {managing && <SellerManagerAssignment
        partnerId={managing.id}
        isAdmin={isAdmin}
        managers={cockpit.managers}
        managerId={managing.manager?.id || null}
        managerName={managing.manager?.name || null}
        backupId={managing.backup_manager?.id || null}
        backupName={managing.backup_manager?.name || null}
        managerOk={managing.manager ? managing.manager_ok : null}
        onCancel={() => setManaging(null)}
        onSaved={() => { setManaging(null); onChanged(); }}
      />}
    </SellerDialog>
  </section>;
}
