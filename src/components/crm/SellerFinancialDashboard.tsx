'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, CalendarDays, FileText, Loader2, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import type { SellerFinancialReport } from '@/lib/CRM/dashboard/sellerDashboardTypes';
import { CrmCartesianChart } from '@/components/crm/charts/CrmCharts';
import SystemBadge from '@/components/ui/SystemBadge';

const panelClass = 'rounded-xl bg-[var(--brand-burgundy-900,#3c1324)] p-5 sm:p-6';

function formatMoney(value: number, currency: string) {
  return `${Number(value || 0).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

export default function SellerFinancialDashboard({
  initialReport,
  filterCompanyIds,
}: {
  initialReport?: SellerFinancialReport | null;
  filterCompanyIds?: string[] | null;
}) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [report, setReport] = useState<SellerFinancialReport | null>(initialReport || null);
  const [loading, setLoading] = useState(!initialReport);
  const [error, setError] = useState<string | null>(null);
  const [currency, setCurrency] = useState('PLN');
  const [refreshVersion, setRefreshVersion] = useState(0);
  const initialRequest = useRef(true);
  const companyKey = useMemo(() => (filterCompanyIds || []).slice().sort().join(','), [filterCompanyIds]);

  useEffect(() => {
    if (initialRequest.current && initialReport && !companyKey
      && initialReport.date_from === `${year}-01-01` && refreshVersion === 0) {
      initialRequest.current = false;
      return;
    }
    initialRequest.current = false;
    let active = true;
    setLoading(true);
    setError(null);
    setReport(null);

    const loadReport = async () => {
      try {
        // The authenticated RPC decides ownership. Never fetch the company report
        // and filter it in the browser, or accept an employee ID from this page.
        const { data, error: queryError } = await supabase.rpc('get_my_sales_financial_report', {
          p_date_from: `${year}-01-01`,
          p_date_to: `${year}-12-31`,
          p_company_ids: companyKey ? companyKey.split(',') : null,
        });
        if (queryError || !data || data.scope !== 'own_sales') throw new Error('report_unavailable');
        if (active) setReport(data as SellerFinancialReport);
      } catch {
        if (active) setError('Nie udało się pobrać Twojego raportu sprzedaży. Dane całej firmy nie są udostępniane w tym widoku.');
      } finally {
        if (active) setLoading(false);
      }
    };
    void loadReport();
    return () => { active = false; };
  }, [companyKey, initialReport, refreshVersion, year]);

  const currencies = report?.currency_totals.map((item) => item.currency) || [];
  const selectedCurrency = currencies.includes(currency) ? currency : currencies[0] || 'PLN';
  const totals = report?.currency_totals.find((item) => item.currency === selectedCurrency);
  const rows = report?.events.filter((event) => event.currency === selectedCurrency) || [];
  const chartData = (report?.months || [])
    .filter((month) => month.currency === selectedCurrency)
    .map((month) => ({
      ...month,
      label: new Intl.DateTimeFormat('pl-PL', { month: 'short' })
        .format(new Date(`${month.key}-01T12:00:00`)).replace('.', ''),
    }));

  return (
    <div className="space-y-5 text-[#e5e4e2]">
      <section className={`${panelClass} flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between`}>
        <div>
          <h2 className="text-xl font-medium">Moja sprzedaż</h2>
          <p className="mt-2 max-w-3xl text-xs leading-relaxed text-[#e5e4e2]/50">
            Rok i miesiąc odnoszą się do daty wydarzenia. Kwoty obejmują wszystkie wystawione do niego faktury, także wystawione w innym okresie. To kwoty brutto, a nie zysk firmy.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button type="button" onClick={() => setYear((value) => value - 1)} aria-label="Poprzedni rok" className="rounded-lg bg-white/5 p-2 hover:bg-white/10"><ArrowLeft className="h-4 w-4" /></button>
          <span className="min-w-14 text-center text-sm font-medium">{year}</span>
          <button type="button" onClick={() => setYear((value) => value + 1)} aria-label="Następny rok" className="rounded-lg bg-white/5 p-2 hover:bg-white/10"><ArrowRight className="h-4 w-4" /></button>
          <button type="button" onClick={() => setRefreshVersion((value) => value + 1)} disabled={loading} aria-label="Odśwież moją sprzedaż" className="rounded-lg bg-white/5 p-2 hover:bg-white/10 disabled:opacity-40"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button>
        </div>
      </section>

      {loading ? <div className={`${panelClass} flex min-h-48 items-center justify-center gap-3 text-sm text-[#e5e4e2]/60`}><Loader2 className="h-5 w-5 animate-spin" />Wczytywanie Twojej sprzedaży…</div>
        : error || !report ? <div role="alert" className={`${panelClass} text-sm text-amber-200`}>{error || 'Raport sprzedaży nie jest obecnie dostępny.'}</div>
          : <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-4 text-sm text-[#e5e4e2]/70">
                <span className="inline-flex items-center gap-2"><CalendarDays className="h-4 w-4 text-[#d3bb73]" />Sprzedane wydarzenia: <strong className="text-[#e5e4e2]">{report.totals.sold_events}</strong></span>
                <span className="inline-flex items-center gap-2"><FileText className="h-4 w-4 text-[#d3bb73]" />Zafakturowane: <strong className="text-[#e5e4e2]">{report.totals.invoiced_events}</strong></span>
              </div>
              {currencies.length > 1 && <label className="flex items-center gap-2 text-sm text-[#e5e4e2]/65">Waluta
                <select value={selectedCurrency} onChange={(event) => setCurrency(event.target.value)} className="rounded-lg border border-white/10 bg-[var(--brand-burgundy-950,#200711)] px-3 py-2">
                  {currencies.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {[
                { label: 'Zafakturowana sprzedaż', value: totals?.invoiced_gross, helper: 'Zaliczki i końcowe rozliczenie bez podwójnego liczenia.' },
                { label: 'Potwierdzone płatności', value: totals?.paid_gross, helper: 'Płatności przypisane do faktur tych wydarzeń.' },
                { label: 'Pozostało do zapłaty', value: totals?.outstanding_gross, helper: 'Nierozliczona część faktur Twojej sprzedaży.' },
                { label: 'Po terminie płatności', value: totals?.overdue_gross, helper: 'Zaległości dotyczące wyłącznie tych faktur.' },
              ].map((card) => <article key={card.label} className={panelClass}>
                <p className="text-xs text-[#e5e4e2]/60">{card.label}</p>
                <p className="mt-2 text-xl font-medium tabular-nums text-[#d3bb73]">{formatMoney(card.value || 0, selectedCurrency)}</p>
                <p className="mt-2 text-xs leading-relaxed text-[#e5e4e2]/45">{card.helper}</p>
              </article>)}
            </div>

            <section className={panelClass}>
              <h3 className="text-base font-medium">Sprzedaż według miesiąca wydarzenia</h3>
              <p className="mt-1 text-xs text-[#e5e4e2]/50">Każda waluta jest pokazywana osobno. Wspólne faktury uwzględniają tylko udział przypisany do Twoich wydarzeń.</p>
              <div className="mt-5">
                <CrmCartesianChart data={chartData} categoryKey="label" kind="bar"
                  series={[{ key: 'invoiced_gross', label: 'Zafakturowano', color: '#d3bb73' }, { key: 'paid_gross', label: 'Opłacono', color: '#6ee7b7' }]}
                  valueFormatter={(value) => formatMoney(value, selectedCurrency)} ariaLabel={`Twoja zafakturowana i opłacona sprzedaż w ${selectedCurrency}`}
                  emptyMessage="Brak zafakturowanej sprzedaży w wybranym okresie." />
              </div>
            </section>

            <section className={panelClass}>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-base font-medium">Moje sprzedane wydarzenia</h3>
                <Link href="/crm/invoices?tab=local" className="rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-sm text-[#d3bb73] hover:bg-[#d3bb73]/15">Moje faktury</Link>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-[#e5e4e2]/50"><tr>
                    <th className="px-3 py-3 font-medium">Wydarzenie</th><th className="px-3 py-3 font-medium">Data / status</th>
                    <th className="px-3 py-3 text-right font-medium">Zafakturowano</th><th className="px-3 py-3 text-right font-medium">Opłacono</th><th className="px-3 py-3 text-right font-medium">Do zapłaty</th>
                  </tr></thead>
                  <tbody className="divide-y divide-white/5">
                    {rows.map((event) => <tr key={`${event.id}:${event.currency}`}>
                      <td className="min-w-48 px-3 py-3"><Link href={`/crm/events/${event.id}`} className="text-[#d3bb73] hover:underline">{event.name}</Link></td>
                      <td className="px-3 py-3"><div className="mb-1 whitespace-nowrap text-xs text-[#e5e4e2]/60">{new Date(event.event_date).toLocaleDateString('pl-PL')}</div><SystemBadge value={event.status} /></td>
                      <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{formatMoney(event.invoiced_gross, event.currency)}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{formatMoney(event.paid_gross, event.currency)}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-[#d3bb73]">{formatMoney(event.outstanding_gross, event.currency)}</td>
                    </tr>)}
                    {!rows.length && <tr><td colSpan={5} className="px-3 py-8 text-center text-[#e5e4e2]/50">Brak sprzedanych wydarzeń w tym okresie i walucie.</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>
          </>}
    </div>
  );
}
