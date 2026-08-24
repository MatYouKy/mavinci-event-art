'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Banknote,
  BrainCircuit,
  Building2,
  CircleDollarSign,
  Loader2,
  PieChart,
  ReceiptText,
  Scale,
  Sparkles,
  TrendingUp,
  WalletCards,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { TrendChart } from '@/components/crm/dashboard/DashboardCharts';
import type { DashboardMonth } from '@/lib/CRM/dashboard/dashboardData';

type MoneyTotals = {
  invoiced_revenue: number;
  cash_revenue: number;
  incurred_costs: number;
  cash_costs: number;
  operating_result: number;
  cash_result: number;
  outstanding_receivables: number;
  overdue_receivables: number;
};

type FinancialMonth = {
  key: string;
  label: string;
  invoiced_revenue: number;
  incurred_costs: number;
  cash_revenue: number;
  cash_costs: number;
  operating_result: number;
  cash_result: number;
};

type CompanySummary = Pick<MoneyTotals, 'invoiced_revenue' | 'cash_revenue' | 'incurred_costs' | 'cash_costs' | 'operating_result' | 'cash_result'> & {
  company_id: string | null;
  company_name: string;
};

type Breakdown = { code?: string; name: string; color?: string; amount: number };
type ProfitabilityArea = { name: string; color: string; revenue: number; costs: number; profit: number; margin_percent: number };

export type FinancialReport = {
  date_from: string;
  date_to: string;
  totals: MoneyTotals;
  months: FinancialMonth[];
  companies: CompanySummary[];
  profitability_areas: ProfitabilityArea[];
  cost_categories: Breakdown[];
  revenue_items: Breakdown[];
  expense_items: Breakdown[];
  quality: {
    unassigned_company: number;
    unclassified_costs: number;
    unmatched_bank_transactions: number;
    bank_months: number;
    deduplicated_ksef_links: number;
  };
};

type AiInsight = {
  severity: 'info' | 'warning' | 'opportunity';
  title: string;
  description: string;
  recommendation: string;
};

const money = new Intl.NumberFormat('pl-PL', {
  style: 'currency',
  currency: 'PLN',
  maximumFractionDigits: 0,
});

const emptyTotals: MoneyTotals = {
  invoiced_revenue: 0,
  cash_revenue: 0,
  incurred_costs: 0,
  cash_costs: 0,
  operating_result: 0,
  cash_result: 0,
  outstanding_receivables: 0,
  overdue_receivables: 0,
};

function NumberCard({
  label,
  value,
  helper,
  icon: Icon,
  tone = 'gold',
}: {
  label: string;
  value: number;
  helper: string;
  icon: typeof Banknote;
  tone?: 'green' | 'red' | 'gold' | 'blue';
}) {
  const tones = {
    green: 'bg-emerald-400/10 text-emerald-300',
    red: 'bg-red-400/10 text-red-300',
    gold: 'bg-[#d3bb73]/10 text-[#d3bb73]',
    blue: 'bg-sky-400/10 text-sky-300',
  };

  return (
    <article className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-4 sm:p-5">
      <div className={`mb-4 inline-flex rounded-lg p-2.5 ${tones[tone]}`}>
        <Icon className="h-5 w-5" />
      </div>
      <p className="text-xs text-[#e5e4e2]/50">{label}</p>
      <p className="mt-1 text-2xl font-light text-[#e5e4e2]">{money.format(value || 0)}</p>
      <p className="mt-2 text-[11px] leading-relaxed text-[#e5e4e2]/35">{helper}</p>
    </article>
  );
}

function RankedBars({ title, items }: { title: string; items: Breakdown[] }) {
  const visible = items.slice(0, 8);
  const max = Math.max(...visible.map((item) => Number(item.amount || 0)), 1);

  return (
    <section className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-5 sm:p-6">
      <h3 className="text-lg font-light text-[#e5e4e2]">{title}</h3>
      {visible.length === 0 ? (
        <p className="mt-6 text-sm text-[#e5e4e2]/40">Brak danych w wybranym okresie.</p>
      ) : (
        <div className="mt-5 space-y-4">
          {visible.map((item) => (
            <div key={`${item.code || ''}-${item.name}`}>
              <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
                <span className="truncate text-[#e5e4e2]/70" title={item.name}>{item.name}</span>
                <span className="shrink-0 font-medium text-[#e5e4e2]">{money.format(Number(item.amount || 0))}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-[#0f1119]">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max((Number(item.amount || 0) / max) * 100, 2)}%`,
                    backgroundColor: item.color || '#d3bb73',
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function DonutBreakdown({ title, description, items }: { title: string; description: string; items: Breakdown[] }) {
  const positiveItems = items.filter((item) => Number(item.amount) > 0);
  const primaryItems = positiveItems.slice(0, 6);
  const remainingAmount = positiveItems.slice(6).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const visible = remainingAmount > 0
    ? [...primaryItems, { code: 'remaining', name: 'Pozostałe', color: '#6b7280', amount: remainingAmount }]
    : primaryItems;
  const total = visible.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  let cursor = 0;
  const gradient = visible.length
    ? `conic-gradient(${visible.map((item) => {
      const start = cursor;
      cursor += (Number(item.amount || 0) / Math.max(total, 1)) * 100;
      return `${item.color || '#d3bb73'} ${start}% ${cursor}%`;
    }).join(', ')})`
    : 'conic-gradient(#272a3e 0 100%)';

  return (
    <section className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <PieChart className="mt-0.5 h-5 w-5 text-[#d3bb73]" />
        <div><h3 className="text-lg font-light text-[#e5e4e2]">{title}</h3><p className="mt-1 text-xs text-[#e5e4e2]/45">{description}</p></div>
      </div>
      <div className="mt-6 grid items-center gap-6 sm:grid-cols-[170px_1fr]">
        <div className="relative mx-auto h-40 w-40 rounded-full" style={{ background: gradient }}>
          <div className="absolute inset-[24px] flex flex-col items-center justify-center rounded-full bg-[#1c1f33] text-center">
            <span className="text-[10px] uppercase tracking-wider text-[#e5e4e2]/35">Łącznie</span>
            <strong className="mt-1 text-lg font-medium text-[#e5e4e2]">{money.format(total)}</strong>
          </div>
        </div>
        <div className="space-y-2.5">
          {visible.length ? visible.map((item) => {
            const share = total > 0 ? (Number(item.amount || 0) / total) * 100 : 0;
            return (
              <div key={`${item.code || ''}-${item.name}`} className="flex items-center gap-2 text-xs">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color || '#d3bb73' }} />
                <span className="min-w-0 flex-1 truncate text-[#e5e4e2]/60">{item.name}</span>
                <span className="text-[#e5e4e2]/40">{share.toFixed(1)}%</span>
                <span className="w-24 text-right font-medium text-[#e5e4e2]">{money.format(Number(item.amount || 0))}</span>
              </div>
            );
          }) : <p className="text-sm text-[#e5e4e2]/40">Brak kosztów w wybranym okresie.</p>}
        </div>
      </div>
    </section>
  );
}

function CompanyComparison({ companies }: { companies: CompanySummary[] }) {
  const max = Math.max(...companies.flatMap((company) => [company.invoiced_revenue, company.incurred_costs]), 1);
  return (
    <section className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <Building2 className="mt-0.5 h-5 w-5 text-[#d3bb73]" />
        <div><h3 className="text-lg font-light text-[#e5e4e2]">Porównanie działalności</h3><p className="mt-1 text-xs text-[#e5e4e2]/45">Przychody, koszty i wynik dla firm objętych aktualnym filtrem.</p></div>
      </div>
      <div className="mt-6 space-y-5">
        {companies.length ? companies.map((company) => (
          <div key={company.company_id || 'unassigned'}>
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="truncate text-sm font-medium text-[#e5e4e2]">{company.company_name}</span>
              <span className={`shrink-0 text-xs font-medium ${company.operating_result >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>Wynik {money.format(company.operating_result)}</span>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2"><span className="w-16 text-[10px] text-[#e5e4e2]/40">Przychód</span><div className="h-2 flex-1 overflow-hidden rounded-full bg-[#0f1119]"><div className="h-full rounded-full bg-emerald-400" style={{ width: `${Math.max((company.invoiced_revenue / max) * 100, company.invoiced_revenue ? 2 : 0)}%` }} /></div><span className="w-24 text-right text-[11px] text-[#e5e4e2]/55">{money.format(company.invoiced_revenue)}</span></div>
              <div className="flex items-center gap-2"><span className="w-16 text-[10px] text-[#e5e4e2]/40">Koszty</span><div className="h-2 flex-1 overflow-hidden rounded-full bg-[#0f1119]"><div className="h-full rounded-full bg-red-400" style={{ width: `${Math.max((company.incurred_costs / max) * 100, company.incurred_costs ? 2 : 0)}%` }} /></div><span className="w-24 text-right text-[11px] text-[#e5e4e2]/55">{money.format(company.incurred_costs)}</span></div>
            </div>
          </div>
        )) : <p className="text-sm text-[#e5e4e2]/40">Brak danych działalności.</p>}
      </div>
    </section>
  );
}

function RatioCard({ label, value, helper, tone = 'gold' }: { label: string; value: number; helper: string; tone?: 'green' | 'red' | 'gold' }) {
  const color = tone === 'green' ? '#34d399' : tone === 'red' ? '#f87171' : '#d3bb73';
  const safeValue = Math.max(0, Math.min(value, 100));
  return (
    <article className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-5">
      <div className="flex items-end justify-between gap-3"><p className="text-xs text-[#e5e4e2]/50">{label}</p><strong className="text-2xl font-light" style={{ color }}>{value.toFixed(1)}%</strong></div>
      <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-[#0f1119]"><div className="h-full rounded-full transition-all" style={{ width: `${safeValue}%`, backgroundColor: color }} /></div>
      <p className="mt-3 text-[11px] leading-relaxed text-[#e5e4e2]/35">{helper}</p>
    </article>
  );
}

export default function CanonicalFinancialDashboard({
  filterCompanyIds,
}: {
  filterCompanyIds?: string[] | null;
}) {
  const { showSnackbar } = useSnackbar();
  const [year, setYear] = useState(new Date().getFullYear());
  const [report, setReport] = useState<FinancialReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiInsights, setAiInsights] = useState<AiInsight[]>([]);
  const companyKey = useMemo(() => (filterCompanyIds || []).slice().sort().join(','), [filterCompanyIds]);
  const normalizedCompanyIds = useMemo(() => companyKey ? companyKey.split(',') : null, [companyKey]);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setAiInsights([]);
    const { data, error } = await supabase.rpc('get_financial_report', {
      p_date_from: `${year}-01-01`,
      p_date_to: `${year}-12-31`,
      p_company_ids: normalizedCompanyIds,
    });

    if (error) {
      console.error('get_financial_report error', error);
      setReport(null);
      showSnackbar(
        error.code === 'PGRST202'
          ? 'Najpierw uruchom migrację kanonicznego raportu finansowego.'
          : 'Nie udało się pobrać raportu finansowego.',
        'error',
      );
    } else {
      setReport(data as FinancialReport);
    }
    setLoading(false);
  }, [normalizedCompanyIds, showSnackbar, year]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const analyzeWithAi = async () => {
    if (!report) return;
    setAiLoading(true);
    const { data, error } = await supabase.functions.invoke('analyze-financial-report', {
      body: {
        date_from: report.date_from,
        date_to: report.date_to,
        company_ids: normalizedCompanyIds,
      },
    });
    setAiLoading(false);

    if (error || !data?.insights) {
      console.error('analyze-financial-report error', error || data);
      showSnackbar('Nie udało się przygotować analizy AI.', 'error');
      return;
    }
    setAiInsights(data.insights as AiInsight[]);
  };

  const totals = report?.totals || emptyTotals;
  const chartMonths: DashboardMonth[] = (report?.months || []).map((month) => ({
    key: month.key,
    label: new Intl.DateTimeFormat('pl-PL', { month: 'short' })
      .format(new Date(`${month.key}-01T12:00:00`))
      .replace('.', ''),
    inquiries: 0,
    offers: 0,
    events: 0,
    revenue: Number(month.cash_revenue || 0),
    costs: Number(month.cash_costs || 0),
    margin: Number(month.cash_result || 0),
  }));

  const qualityIssues = report
    ? report.quality.unassigned_company
      + report.quality.unclassified_costs
      + report.quality.unmatched_bank_transactions
      + (report.quality.bank_months === 0 ? 1 : 0)
    : 0;
  const hasVerifiedBankData = Number(report?.quality.bank_months || 0) > 0;
  const operatingMargin = totals.invoiced_revenue > 0 ? (totals.operating_result / totals.invoiced_revenue) * 100 : 0;
  const collectionRatio = totals.invoiced_revenue > 0
    ? ((totals.invoiced_revenue - totals.outstanding_receivables) / totals.invoiced_revenue) * 100
    : 0;
  const topCostShare = totals.incurred_costs > 0
    ? (Number(report?.cost_categories?.[0]?.amount || 0) / totals.incurred_costs) * 100
    : 0;
  const activeMonths = (report?.months || []).filter((month) =>
    month.invoiced_revenue !== 0 || month.incurred_costs !== 0 || month.cash_revenue !== 0 || month.cash_costs !== 0,
  );
  const bestOperatingMonth = activeMonths.reduce<FinancialMonth | null>(
    (best, month) => !best || month.operating_result > best.operating_result ? month : best,
    null,
  );
  const weakestCashMonth = activeMonths.reduce<FinancialMonth | null>(
    (weakest, month) => !weakest || month.cash_result < weakest.cash_result ? month : weakest,
    null,
  );
  const bestCompany = report?.companies?.reduce<CompanySummary | null>(
    (best, company) => !best || company.operating_result > best.operating_result ? company : best,
    null,
  );
  const monthName = (key?: string) => key
    ? new Intl.DateTimeFormat('pl-PL', { month: 'long', year: 'numeric' }).format(new Date(`${key}-01T12:00:00`))
    : 'brak danych';

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-light text-[#e5e4e2]">Rzetelny obraz finansów</h2>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-[#e5e4e2]/45">
            Faktury i koszty pokazują wynik memoriałowy. Wyciągi bankowe, potwierdzone płatności i gotówka pokazują rzeczywiste przepływy.
          </p>
          <p className="mt-2 text-[11px] font-medium text-[#d3bb73]/80">
            {normalizedCompanyIds?.length
              ? `Zakres: ${normalizedCompanyIds.length} ${normalizedCompanyIds.length === 1 ? 'wybrana działalność' : 'wybrane działalności'}`
              : 'Zakres: wszystkie dostępne działalności'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setYear((value) => value - 1)} className="rounded-lg border border-[#d3bb73]/15 p-2 text-[#e5e4e2]/70 hover:bg-[#d3bb73]/10" aria-label="Poprzedni rok">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <span className="min-w-16 text-center text-sm font-medium text-[#e5e4e2]">{year}</span>
          <button onClick={() => setYear((value) => value + 1)} className="rounded-lg border border-[#d3bb73]/15 p-2 text-[#e5e4e2]/70 hover:bg-[#d3bb73]/10" aria-label="Następny rok">
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex min-h-72 items-center justify-center rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]">
          <Loader2 className="h-8 w-8 animate-spin text-[#d3bb73]" />
        </div>
      ) : !report ? (
        <div className="rounded-xl border border-red-400/20 bg-red-400/5 p-6 text-sm text-red-200">
          Raport nie jest jeszcze dostępny. Uruchom nową migrację Supabase i odśwież widok.
        </div>
      ) : (
        <>
          {!hasVerifiedBankData && (
            <div className="rounded-xl border border-amber-400/25 bg-amber-400/5 p-4 text-sm text-amber-100">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
                <div>
                  <p className="font-medium">Brak zweryfikowanych wyciągów bankowych w tym okresie</p>
                  <p className="mt-1 text-xs leading-relaxed text-amber-100/65">
                    Przepływy są tymczasowo liczone wyłącznie z faktur oznaczonych jako opłacone i potwierdzonej gotówki. Nie są prezentowane jako pełny obrót rachunków.
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <NumberCard label="Przychód zafakturowany" value={totals.invoiced_revenue} helper="Bez proform i bez podwójnego liczenia zaliczki rozliczonej fakturą końcową." icon={ReceiptText} tone="blue" />
            <NumberCard
              label={hasVerifiedBankData ? 'Wpływy faktyczne' : 'Potwierdzone wpłaty'}
              value={totals.cash_revenue}
              helper={hasVerifiedBankData
                ? 'Zweryfikowane operacje bankowe i gotówka — według daty przepływu.'
                : 'Tylko faktury oznaczone jako opłacone i potwierdzona gotówka; bez pełnych danych bankowych.'}
              icon={ArrowDownRight}
              tone="green"
            />
            <NumberCard label="Koszty poniesione" value={totals.incurred_costs} helper="KSeF, koszty lokalne, eventowe, wynagrodzenia i ręczne wypłaty." icon={WalletCards} tone="red" />
            <NumberCard
              label={hasVerifiedBankData ? 'Wydatki faktyczne' : 'Potwierdzone wydatki'}
              value={totals.cash_costs}
              helper={hasVerifiedBankData
                ? 'Zweryfikowane wypływy bankowe oraz potwierdzone wypłaty gotówkowe.'
                : 'Tylko koszty oznaczone jako opłacone i potwierdzona gotówka; bez pełnych danych bankowych.'}
              icon={ArrowUpRight}
              tone="red"
            />
            <NumberCard label="Wynik memoriałowy" value={totals.operating_result} helper="Przychód zafakturowany minus koszty poniesione." icon={Scale} tone={totals.operating_result >= 0 ? 'green' : 'red'} />
            <NumberCard
              label={hasVerifiedBankData ? 'Wynik kasowy' : 'Saldo potwierdzonych płatności'}
              value={totals.cash_result}
              helper={hasVerifiedBankData
                ? 'Zweryfikowane wpływy minus zweryfikowane wydatki.'
                : 'Różnica płatności oznaczonych w systemie; nie jest pełnym saldem rachunków.'}
              icon={CircleDollarSign}
              tone={totals.cash_result >= 0 ? 'green' : 'red'}
            />
            <NumberCard label="Należności" value={totals.outstanding_receivables} helper="Kwoty pozostające do zapłaty, z uwzględnieniem dopłaty do faktury końcowej." icon={Banknote} tone="gold" />
            <NumberCard label="Po terminie" value={totals.overdue_receivables} helper="Część należności, której termin płatności już minął." icon={AlertTriangle} tone={totals.overdue_receivables > 0 ? 'red' : 'green'} />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <RatioCard label="Marża operacyjna" value={operatingMargin} helper="Udział wyniku memoriałowego w zafakturowanym przychodzie." tone={operatingMargin >= 20 ? 'green' : operatingMargin >= 0 ? 'gold' : 'red'} />
            <RatioCard label="Pokrycie należności" value={collectionRatio} helper="Jaka część zafakturowanego przychodu nie pozostaje już do zapłaty." tone={collectionRatio >= 80 ? 'green' : collectionRatio >= 50 ? 'gold' : 'red'} />
            <RatioCard label="Koncentracja największego kosztu" value={topCostShare} helper="Udział największej kategorii w kosztach — wysoki wynik wskazuje zależność od jednego obszaru." tone={topCostShare <= 35 ? 'green' : topCostShare <= 60 ? 'gold' : 'red'} />
          </div>

          <TrendChart
            title="Trend wyniku memoriałowego"
            description="Zafakturowany przychód, poniesione koszty i wynik — miesiąc po miesiącu"
            months={chartMonths.map((month, index) => ({
              ...month,
              revenue: Number(report.months[index]?.invoiced_revenue || 0),
              costs: Number(report.months[index]?.incurred_costs || 0),
              margin: Number(report.months[index]?.operating_result || 0),
            }))}
            series={[
              { key: 'revenue', label: 'Przychód', color: '#60a5fa' },
              { key: 'costs', label: 'Koszty', color: '#f87171' },
              { key: 'margin', label: 'Wynik', color: '#d3bb73' },
            ]}
            formatValue={(value) => money.format(value)}
          />

          <TrendChart
            title={hasVerifiedBankData ? 'Rzeczywiste przepływy pieniężne' : 'Potwierdzone płatności'}
            description={hasVerifiedBankData
              ? 'Wpływy, wydatki i wynik kasowy według daty płatności'
              : 'Dane z oznaczonych płatności i gotówki; bez pełnego obrotu rachunków bankowych'}
            months={chartMonths}
            series={[
              { key: 'revenue', label: 'Wpływy', color: '#34d399' },
              { key: 'costs', label: 'Wydatki', color: '#f87171' },
              { key: 'margin', label: 'Wynik kasowy', color: '#d3bb73' },
            ]}
            formatValue={(value) => money.format(value)}
          />

          <div className="grid gap-6 xl:grid-cols-2">
            <DonutBreakdown title="Struktura kosztów" description="Udział kategorii w całkowitych kosztach poniesionych." items={report.cost_categories} />
            <CompanyComparison companies={report.companies} />
          </div>

          <section className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-5 sm:p-6">
            <div className="flex items-start gap-3"><TrendingUp className="mt-0.5 h-5 w-5 text-[#d3bb73]" /><div><h3 className="text-lg font-light text-[#e5e4e2]">Najważniejsze obserwacje</h3><p className="mt-1 text-xs text-[#e5e4e2]/45">Wnioski obliczane bez AI bezpośrednio z aktualnie wybranego zakresu firm.</p></div></div>
            <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <article className="rounded-lg border border-[#d3bb73]/8 bg-[#0f1119] p-4"><span className="text-[10px] uppercase tracking-wider text-[#e5e4e2]/35">Najlepszy miesiąc</span><p className="mt-2 capitalize text-sm font-medium text-[#e5e4e2]">{monthName(bestOperatingMonth?.key)}</p><p className="mt-1 text-xs text-emerald-300">{money.format(bestOperatingMonth?.operating_result || 0)} wyniku</p></article>
              <article className="rounded-lg border border-[#d3bb73]/8 bg-[#0f1119] p-4"><span className="text-[10px] uppercase tracking-wider text-[#e5e4e2]/35">{hasVerifiedBankData ? 'Najsłabszy cash flow' : 'Najsłabszy bilans płatności'}</span><p className="mt-2 capitalize text-sm font-medium text-[#e5e4e2]">{monthName(weakestCashMonth?.key)}</p><p className={`mt-1 text-xs ${(weakestCashMonth?.cash_result || 0) >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>{money.format(weakestCashMonth?.cash_result || 0)}</p></article>
              <article className="rounded-lg border border-[#d3bb73]/8 bg-[#0f1119] p-4"><span className="text-[10px] uppercase tracking-wider text-[#e5e4e2]/35">Największy koszt</span><p className="mt-2 truncate text-sm font-medium text-[#e5e4e2]">{report.cost_categories[0]?.name || 'Brak danych'}</p><p className="mt-1 text-xs text-red-300">{money.format(Number(report.cost_categories[0]?.amount || 0))}</p></article>
              <article className="rounded-lg border border-[#d3bb73]/8 bg-[#0f1119] p-4"><span className="text-[10px] uppercase tracking-wider text-[#e5e4e2]/35">Najlepsza działalność</span><p className="mt-2 truncate text-sm font-medium text-[#e5e4e2]">{bestCompany?.company_name || 'Brak danych'}</p><p className={`mt-1 text-xs ${(bestCompany?.operating_result || 0) >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>{money.format(bestCompany?.operating_result || 0)} wyniku</p></article>
            </div>
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <RankedBars title="Na co wydajemy najwięcej" items={report.cost_categories} />
            <RankedBars title="Największe pozycje kosztowe" items={report.expense_items} />
            <RankedBars title="Największe źródła przychodu" items={report.revenue_items} />

            <section className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-5 sm:p-6">
              <h3 className="text-lg font-light text-[#e5e4e2]">Na czym zarabiamy najwięcej</h3>
              <p className="mt-1 text-xs text-[#e5e4e2]/40">Przychód i koszty powiązane z wydarzeniami, pogrupowane według ich kategorii.</p>
              <div className="mt-5 space-y-3">
                {report.profitability_areas?.length ? report.profitability_areas.slice(0, 8).map((area) => (
                  <div key={area.name} className="rounded-lg border border-[#d3bb73]/8 bg-[#0f1119] p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: area.color }} /><span className="truncate text-sm text-[#e5e4e2]">{area.name}</span></div>
                      <span className={`shrink-0 text-sm font-medium ${area.profit >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>{money.format(area.profit)}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[#e5e4e2]/40"><span>Przychód {money.format(area.revenue)}</span><span>Koszty {money.format(area.costs)}</span><span>Marża {Number(area.margin_percent || 0).toLocaleString('pl-PL')}%</span></div>
                  </div>
                )) : <p className="text-sm text-[#e5e4e2]/40">Powiąż przychody i koszty z wydarzeniami, aby policzyć rentowność obszarów.</p>}
              </div>
            </section>

            <section className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-5 sm:p-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="flex items-center gap-2 text-lg font-light text-[#e5e4e2]">
                    <BrainCircuit className="h-5 w-5 text-[#d3bb73]" /> Analiza AI
                  </h3>
                  <p className="mt-1 text-xs leading-relaxed text-[#e5e4e2]/45">
                    AI otrzymuje wyłącznie nazwy pozycji oraz ich koszty lub przychody — bez nagłówków faktur, NIP-ów, numerów dokumentów i danych klientów.
                  </p>
                </div>
                <button
                  onClick={analyzeWithAi}
                  disabled={aiLoading}
                  className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#0f1119] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {aiLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {aiInsights.length ? 'Odśwież analizę' : 'Analizuj'}
                </button>
              </div>
              <div className="mt-5 space-y-3">
                {aiInsights.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-[#d3bb73]/15 p-5 text-sm text-[#e5e4e2]/40">
                    Uruchom analizę, aby wskazać dominujące pozycje kosztowe, największe źródła przychodu i możliwe oszczędności.
                  </div>
                ) : aiInsights.map((insight, index) => (
                  <article key={`${insight.title}-${index}`} className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-4">
                    <div className="flex items-start gap-3">
                      <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${insight.severity === 'warning' ? 'bg-red-400' : insight.severity === 'opportunity' ? 'bg-emerald-400' : 'bg-sky-400'}`} />
                      <div>
                        <h4 className="text-sm font-medium text-[#e5e4e2]">{insight.title}</h4>
                        <p className="mt-1 text-xs leading-relaxed text-[#e5e4e2]/55">{insight.description}</p>
                        <p className="mt-2 text-xs leading-relaxed text-[#d3bb73]">{insight.recommendation}</p>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </div>

          <section className="overflow-hidden rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]">
            <div className="border-b border-[#d3bb73]/10 px-5 py-4">
              <h3 className="text-lg font-light text-[#e5e4e2]">Wynik według działalności</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-xs">
                <thead className="bg-[#0f1119] text-[#e5e4e2]/45">
                  <tr>
                    <th className="px-4 py-3 font-medium">Działalność</th>
                    <th className="px-4 py-3 text-right font-medium">Zafakturowano</th>
                    <th className="px-4 py-3 text-right font-medium">{hasVerifiedBankData ? 'Wpłynęło' : 'Potwierdzone wpłaty'}</th>
                    <th className="px-4 py-3 text-right font-medium">Koszty</th>
                    <th className="px-4 py-3 text-right font-medium">{hasVerifiedBankData ? 'Wydano' : 'Potwierdzone wydatki'}</th>
                    <th className="px-4 py-3 text-right font-medium">Wynik</th>
                  </tr>
                </thead>
                <tbody>
                  {report.companies.map((company) => (
                    <tr key={company.company_id || 'unassigned'} className="border-t border-[#d3bb73]/5 text-[#e5e4e2]/70">
                      <td className="px-4 py-3 font-medium text-[#e5e4e2]">{company.company_name}</td>
                      <td className="px-4 py-3 text-right">{money.format(company.invoiced_revenue)}</td>
                      <td className="px-4 py-3 text-right text-emerald-300">{money.format(company.cash_revenue)}</td>
                      <td className="px-4 py-3 text-right">{money.format(company.incurred_costs)}</td>
                      <td className="px-4 py-3 text-right text-red-300">{money.format(company.cash_costs)}</td>
                      <td className={`px-4 py-3 text-right font-medium ${company.operating_result >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>{money.format(company.operating_result)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className={`rounded-xl border p-5 ${qualityIssues ? 'border-amber-400/20 bg-amber-400/5' : 'border-emerald-400/20 bg-emerald-400/5'}`}>
            <div className="flex items-start gap-3">
              <AlertTriangle className={`mt-0.5 h-5 w-5 shrink-0 ${qualityIssues ? 'text-amber-300' : 'text-emerald-300'}`} />
              <div>
                <h3 className="text-sm font-medium text-[#e5e4e2]">Jakość danych finansowych</h3>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-xs text-[#e5e4e2]/55">
                  <span>Bez działalności: <b className="text-[#e5e4e2]">{report.quality.unassigned_company}</b></span>
                  <span>Niesklasyfikowane koszty: <b className="text-[#e5e4e2]">{report.quality.unclassified_costs}</b></span>
                  <span>Niedopasowane operacje bankowe: <b className="text-[#e5e4e2]">{report.quality.unmatched_bank_transactions}</b></span>
                  <span>Miesiące z wyciągiem: <b className="text-[#e5e4e2]">{report.quality.bank_months}</b></span>
                  <span>Powiązania KSeF bez duplikacji: <b className="text-[#e5e4e2]">{report.quality.deduplicated_ksef_links}</b></span>
                </div>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
