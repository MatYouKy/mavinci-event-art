'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CalendarDays, FileText, Hotel, Presentation, RefreshCw, Sparkles, UserPlus, Users, WalletCards } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { parseSellerCockpit, sellerCockpitTodayCount, type SellerCockpit } from '@/lib/seller/sellerCockpit';
import CockpitToday from './cockpit/CockpitToday';
import CockpitSellers from './cockpit/CockpitSellers';
import { CockpitPipeline, CockpitUpcoming, CockpitWarnings } from './cockpit/CockpitOverview';
import { SellerError, SellerLoading, errorText, isMissingRpc, sellerFieldClass, sellerPln, sellerPrimaryButton, sellerSecondaryButton } from './sellerUi';

const MANAGER_FILTER_KEY = 'crm-seller-cockpit-manager';
const readStoredFilter = () => { try { return window.localStorage.getItem(MANAGER_FILTER_KEY) || ''; } catch { return ''; } };
const storeFilter = (value: string) => { try { if (value) window.localStorage.setItem(MANAGER_FILTER_KEY, value); else window.localStorage.removeItem(MANAGER_FILTER_KEY); } catch { /* tylko wygoda */ } };

type Props = {
  /** Liczba spraw „Dziś” — np. do licznika na zakładce. */
  onTodayCount?: (count: number) => void;
};

/**
 * Kokpit opiekuna sprzedawców zewnętrznych (get_my_seller_cockpit). Opiekun widzi wyłącznie swoich
 * sprzedawców (zakres wymusza baza), administrator wszystkich lub wybranego opiekuna.
 */
export default function SellerManagerCockpit({ onTodayCount }: Props) {
  const [managerFilter, setManagerFilter] = useState<string | null>(null);
  const [cockpit, setCockpit] = useState<SellerCockpit | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const revision = useRef(0);
  const todayCallback = useRef(onTodayCount);
  todayCallback.current = onTodayCount;

  useEffect(() => { setManagerFilter(readStoredFilter()); }, []);

  const load = useCallback(async (background = false) => {
    if (managerFilter === null) return;
    const request = ++revision.current;
    if (!background) setLoading(true);
    const { data, error: rpcError } = await supabase.rpc('get_my_seller_cockpit', managerFilter ? { p_manager: managerFilter } : {});
    if (request !== revision.current) return;
    if (rpcError) {
      setError(isMissingRpc(rpcError)
        ? 'Kokpit opiekuna wymaga migracji 20261105150000_seller_manager_cockpit.sql.'
        : errorText(rpcError, 'Nie udało się wczytać kokpitu opiekuna.'));
      if (!background) setCockpit(null);
    } else {
      const parsed = parseSellerCockpit(data);
      // Filtr opiekuna działa tylko dla administratora; nieaktualny wybór czyścimy.
      if (managerFilter && (!parsed.viewer.is_admin || (parsed.managers.length > 0 && !parsed.managers.some(item => item.id === managerFilter) && managerFilter !== parsed.viewer.employee_id))) {
        storeFilter('');
        setManagerFilter('');
      }
      setCockpit(parsed);
      setError('');
      todayCallback.current?.(sellerCockpitTodayCount(parsed));
    }
    setLoading(false);
  }, [managerFilter]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') void load(true); };
    const timer = window.setInterval(refresh, 60000);
    window.addEventListener('focus', refresh);
    window.addEventListener('seller-workspace-changed', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('seller-workspace-changed', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [load]);

  const stats = useMemo(() => {
    if (!cockpit) return null;
    const sellers = cockpit.sellers;
    return {
      today: sellerCockpitTodayCount(cockpit),
      sellers: sellers.length,
      active: sellers.filter(seller => seller.status === 'active').length,
      portal: sellers.filter(seller => seller.portal_account === 'active').length,
      inProgress: cockpit.pipeline.draft + cockpit.pipeline.pdf + cockpit.pipeline.review,
      review: cockpit.pipeline.review,
      upcoming: cockpit.upcoming.length,
      payable: sellers.reduce((sum, seller) => sum + seller.payable, 0),
      forecast: sellers.reduce((sum, seller) => sum + seller.forecast, 0),
      warnings: cockpit.warnings.length,
    };
  }, [cockpit]);

  const changeManager = (value: string) => { storeFilter(value); setManagerFilter(value); };
  const isAdmin = cockpit?.viewer.is_admin === true;
  const selectedManagerName = managerFilter ? cockpit?.managers.find(item => item.id === managerFilter)?.name : null;
  const empty = cockpit && cockpit.sellers.length === 0 && stats?.today === 0;

  return <div className="space-y-6">
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-gradient-to-r from-[#1c1f33] to-[#1c1f33]/40 p-5">
      <div className="min-w-0">
        <h2 className="text-xl font-light">Kokpit opiekuna</h2>
        <p className="mt-1 text-sm text-white/50">{isAdmin
          ? (selectedManagerName ? `Sprzedawcy opiekuna: ${selectedManagerName}.` : managerFilter && managerFilter === cockpit?.viewer.employee_id ? 'Sprzedawcy przypisani do Ciebie.' : 'Wszyscy sprzedawcy zewnętrzni.')
          : 'Twoi sprzedawcy zewnętrzni — sprawy na dziś, lejek, wydarzenia i ostrzeżenia.'}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {isAdmin && <label className="flex items-center gap-2 text-xs text-white/50">
          <span className="hidden sm:inline">Opiekun</span>
          <select value={managerFilter || ''} onChange={(event) => changeManager(event.target.value)} className={`${sellerFieldClass} w-56 py-2`} aria-label="Filtr opiekuna">
            <option value="">Wszyscy opiekunowie</option>
            {cockpit?.viewer.employee_id && <option value={cockpit.viewer.employee_id}>Przypisani do mnie</option>}
            {cockpit?.managers.filter(item => item.id !== cockpit.viewer.employee_id).map(item => <option key={item.id} value={item.id}>{item.name}{item.eligible ? '' : ' (bez uprawnień)'}</option>)}
          </select>
        </label>}
        <button type="button" onClick={() => void load()} disabled={loading} aria-label="Odśwież kokpit" className="rounded-lg bg-white/5 p-2.5 text-[#d3bb73] hover:bg-white/10 disabled:opacity-40"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button>
        <Link href="/crm/salespeople/demo" className={sellerSecondaryButton}><Presentation className="h-4 w-4" />Pokaż portal hotelowi</Link>
      </div>
    </section>

    {loading && !cockpit && <SellerLoading label="Wczytywanie kokpitu opiekuna…" />}
    {error && <SellerError message={error} onRetry={() => void load()} />}

    {cockpit && stats && empty && <section className="grid gap-6 overflow-hidden rounded-2xl bg-[#1c1f33] p-6 md:grid-cols-[1.2fr_1fr] md:p-8">
      <div>
        <span className="inline-flex rounded-2xl bg-[#d3bb73]/10 p-3"><Hotel className="h-7 w-7 text-[#d3bb73]" /></span>
        <h3 className="mt-4 text-xl font-light">{isAdmin && managerFilter ? 'Ten opiekun nie ma jeszcze sprzedawców' : 'Nie masz jeszcze przypisanych sprzedawców'}</h3>
        <p className="mt-2 max-w-xl text-sm leading-6 text-white/55">{isAdmin
          ? 'Przypisz sprzedawców w ich karcie (Ustawienia → Opiekun i zastępca). Opiekun musi mieć uprawnienie do ofert i dostęp do marek sprzedawcy.'
          : 'Sprzedawców zewnętrznych — pracowników hoteli i agencji — przypisuje Ci administrator. Gdy pozyskasz nowy hotel, pokaż mu portal i zaproś osobę kontaktową; administrator przypisze ją do Ciebie.'}</p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link href="/crm/salespeople/demo" className={sellerPrimaryButton}><Presentation className="h-4 w-4" />Pokaż portal hotelowi</Link>
          <Link href="/crm/salespeople?new=1" className={sellerSecondaryButton}><UserPlus className="h-4 w-4" />Zaproś hotel do portalu</Link>
        </div>
      </div>
      <ol className="space-y-2 text-sm">
        {['Odwiedź hotel i pokaż portal w trybie pokazowym', 'Dodaj osobę z hotelu jako sprzedawcę i wyślij zaproszenie', 'Administrator przypisuje Cię jako opiekuna', 'Tu zobaczysz oferty, rozmowy i zapytania gości'].map((step, index) => (
          <li key={step} className="flex items-start gap-3 rounded-xl bg-[#0f1119]/60 p-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#d3bb73]/15 text-xs text-[#d3bb73]">{index + 1}</span><span className="text-white/70">{step}</span></li>
        ))}
      </ol>
    </section>}

    {cockpit && stats && !empty && <>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5" aria-label="Podsumowanie">
        {([
          { label: 'Sprawy na dziś', value: stats.today, helper: stats.today ? 'czekają na Ciebie' : 'wszystko załatwione', icon: Sparkles, href: '#cockpit-today-heading' },
          { label: isAdmin ? 'Sprzedawcy' : 'Moi sprzedawcy', value: stats.sellers, helper: `${stats.active} aktywnych · ${stats.portal} w portalu`, icon: Users, href: '#cockpit-sellers-heading' },
          { label: 'Oferty w toku', value: stats.inProgress, helper: `${stats.review} do sprawdzenia`, icon: FileText, href: '#cockpit-pipeline-heading' },
          { label: 'Wydarzenia w 14 dni', value: stats.upcoming, helper: 'najbliższe realizacje', icon: CalendarDays, href: '#cockpit-upcoming-heading' },
          { label: 'Do wypłaty', value: sellerPln(stats.payable), helper: `prognoza ${sellerPln(stats.forecast)}`, icon: WalletCards, href: '#cockpit-sellers-heading' },
        ] as const).map(tile => <a key={tile.label} href={tile.href} className="rounded-2xl bg-[#1c1f33] p-4 transition-colors hover:bg-[#232741]">
          <span className="flex items-center justify-between text-xs text-white/45">{tile.label}<tile.icon className="h-4 w-4 text-[#d3bb73]/60" /></span>
          <span className="mt-2 block truncate text-2xl font-light">{tile.value}</span>
          <span className="mt-1 block truncate text-[11px] text-white/40">{tile.helper}</span>
        </a>)}
      </section>
      {stats.warnings > 0 && <a href="#cockpit-warnings" className="flex items-center gap-2 rounded-xl bg-amber-400/[0.07] px-4 py-3 text-sm text-amber-100 hover:bg-amber-400/10"><AlertTriangle className="h-4 w-4" />{stats.warnings === 1 ? '1 ostrzeżenie wymaga uwagi' : `${stats.warnings} ostrzeżeń wymaga uwagi`} — zobacz poniżej</a>}
      <CockpitToday cockpit={cockpit} onChanged={() => void load(true)} />
      <CockpitSellers cockpit={cockpit} onChanged={() => void load(true)} />
      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <CockpitPipeline cockpit={cockpit} />
        <CockpitUpcoming cockpit={cockpit} />
      </div>
      <CockpitWarnings cockpit={cockpit} />
    </>}
  </div>;
}
