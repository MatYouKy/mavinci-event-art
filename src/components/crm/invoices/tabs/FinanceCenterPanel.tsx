'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Info,
  Landmark,
  Loader2,
  PiggyBank,
  RefreshCw,
  Scale,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useInvoiceFinanceAccess } from '@/hooks/useInvoiceFinanceAccess';
import { filterFinanceCompanies } from '@/lib/invoices/financeAccess';

/**
 * Centrum finansów: gotówka, należności i zobowiązania z wiekowaniem, ZUS i podatki (szacunek VAT, rezerwa CIT),
 * prognoza 13 tygodni, kompletność danych i zamknięcie poprzedniego miesiąca — dla jednej działalności.
 * Dane: get_finance_center (migracja 20261117140000_finance_center.sql); prognozę składa ten ekran z pozycji z bazy.
 */

const card = 'rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]';
const input = 'rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-2.5 py-1.5 text-xs text-[#e5e4e2] outline-none focus:border-[#d3bb73]/50';
const ghost = 'inline-flex items-center gap-1 rounded-lg border border-[#d3bb73]/25 px-2.5 py-1 text-[11px] text-[#d3bb73] hover:bg-[#d3bb73]/10 disabled:opacity-50';
const th = 'px-3 py-2 text-left text-[10px] font-medium uppercase tracking-wide text-[#e5e4e2]/45';
const td = 'px-3 py-2 align-top text-xs text-[#e5e4e2]/85';

const money = (value: number | string | null | undefined, currency = 'PLN') =>
  `${Number(value || 0).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency === 'PLN' ? 'zł' : currency}`;
const short = (value: number) =>
  `${Math.round(value).toLocaleString('pl-PL')} zł`;
const date = (value?: string | null) => (value ? new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('pl-PL') : '—');
const dayMonth = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' });
const addDays = (value: string, days: number) => {
  const d = new Date(`${value}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const daysBetween = (from: string, to: string) =>
  Math.round((new Date(`${to.slice(0, 10)}T12:00:00`).getTime() - new Date(`${from.slice(0, 10)}T12:00:00`).getTime()) / 86_400_000);
const MONTHS = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];
const monthLabel = (value: string) => {
  const d = new Date(`${value.slice(0, 10)}T12:00:00`);
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};

type ItemKind =
  | 'receivable' | 'receivable_ksef_paid' | 'proforma' | 'milestone' | 'payable'
  | 'recurring_income' | 'recurring_cost' | 'payroll';

interface Item {
  kind: ItemKind;
  direction: 'in' | 'out';
  id: string;
  invoice_id: string | null;
  label: string | null;
  counterparty: string | null;
  issue_date: string | null;
  due_date: string | null;
  amount: number;
  currency: string;
  estimated: boolean;
  note: string | null;
  days_overdue: number | null;
}

interface Obligation {
  kind: string;
  form: string;
  period_kind: string;
  period_start: string;
  label: string;
  due_date: string;
  amount: number | null;
  estimated: boolean;
  status: 'unpaid' | 'partial' | 'unconfirmed';
  overdue: boolean;
}

interface VatMonth {
  period_start: string;
  output_vat: number;
  input_vat: number;
  carried: number;
  estimate: number;
  sales_count: number;
  cost_count: number;
  foreign_count: number;
  declared: number | null;
  paid: number;
  due_date: string | null;
}

interface CenterData {
  company_id: string;
  company_name: string;
  today: string;
  can_manage: boolean;
  cash: {
    accounts: Array<{ key: string; label: string; account_type: string; currency: string; balance: number | null; as_of: string }>;
    as_of: string | null;
    total: number;
    days_old: number | null;
  };
  items: Item[];
  obligations: Obligation[];
  vat: VatMonth[] | null;
  cit: { year: number; rate: number | null; revenue_net: number; costs_net: number; result: number; tax: number | null; paid: number; reserve: number | null };
  forecast: { week0: string; until: string; weeks: number };
  quality: Array<{ level: 'error' | 'warning' | 'info'; key: string; text: string; tab: string; section: string | null }>;
  checklist: {
    period_year: number;
    period_month: number;
    items: Array<{ key: string; label: string; done: boolean | null; detail: string | null; tab: string; section: string | null }>;
  };
  tax_settings: { cit_rate: number | null };
}

interface Flow {
  key: string;
  direction: 'in' | 'out';
  kindLabel: string;
  label: string;
  counterparty: string | null;
  due_date: string | null;
  amount: number;
  estimated: boolean;
  href: string | null;
  unassigned?: boolean;
}

const KIND_LABELS: Record<ItemKind | 'obligation', string> = {
  receivable: 'Należność',
  receivable_ksef_paid: 'Do wyjaśnienia',
  proforma: 'Pro forma',
  milestone: 'Harmonogram wydarzenia',
  payable: 'Faktura kosztowa',
  recurring_income: 'Umowa stała',
  recurring_cost: 'Umowa stała',
  payroll: 'Wynagrodzenie',
  obligation: 'ZUS i podatki',
};

const BUCKETS = [
  { key: 'no_due', label: 'Bez terminu' },
  { key: 'current', label: 'W terminie' },
  { key: 'd1_30', label: '1–30 dni po terminie' },
  { key: 'd31_60', label: '31–60 dni' },
  { key: 'd61_90', label: '61–90 dni' },
  { key: 'd90', label: 'Ponad 90 dni' },
] as const;
type BucketKey = (typeof BUCKETS)[number]['key'];

function bucketOf(item: Item, today: string): BucketKey {
  if (!item.due_date) return 'no_due';
  const late = daysBetween(item.due_date, today);
  if (late <= 0) return 'current';
  if (late <= 30) return 'd1_30';
  if (late <= 60) return 'd31_60';
  if (late <= 90) return 'd61_90';
  return 'd90';
}

function aging(items: Item[], today: string) {
  const sums: Record<BucketKey, { amount: number; count: number }> = {
    no_due: { amount: 0, count: 0 }, current: { amount: 0, count: 0 }, d1_30: { amount: 0, count: 0 },
    d31_60: { amount: 0, count: 0 }, d61_90: { amount: 0, count: 0 }, d90: { amount: 0, count: 0 },
  };
  let total = 0;
  let overdue = 0;
  for (const item of items) {
    const bucket = bucketOf(item, today);
    sums[bucket].amount += Number(item.amount || 0);
    sums[bucket].count += 1;
    total += Number(item.amount || 0);
    if (bucket !== 'no_due' && bucket !== 'current') overdue += Number(item.amount || 0);
  }
  return { sums, total, overdue };
}

function itemHref(item: Item): string | null {
  if (item.invoice_id) return `/crm/invoices/${item.invoice_id}`;
  if (item.kind === 'payable' && item.note !== 'dokument spoza KSeF') return '/crm/invoices?tab=external&section=deadlines';
  if (item.kind === 'payable') return '/crm/invoices?tab=external&section=external';
  if (item.kind === 'receivable') return '/crm/invoices?tab=ksef';
  if (item.kind === 'recurring_cost' || item.kind === 'recurring_income') return '/crm/invoices?tab=external&section=recurring';
  if (item.kind === 'payroll') return '/crm/invoices?tab=external&section=contracts';
  return null;
}

const sectionHref = (tab: string, section: string | null) =>
  `/crm/invoices?tab=${encodeURIComponent(tab)}${section ? `&section=${encodeURIComponent(section)}` : ''}`;

interface Company { id: string; name: string }

export default function FinanceCenterPanel({ filterCompanyIds = null }: { filterCompanyIds?: string[] | null }) {
  const { showSnackbar } = useSnackbar();
  const { access } = useInvoiceFinanceAccess();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [data, setData] = useState<CenterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingRate, setSavingRate] = useState(false);
  const [fetchingUpo, setFetchingUpo] = useState(false);
  const [includeOverdueIn, setIncludeOverdueIn] = useState(false);
  const [includeUnassigned, setIncludeUnassigned] = useState(false);
  const [openWeek, setOpenWeek] = useState<number | 'overdue' | 'undated' | null>(null);
  const companyKey = filterCompanyIds === null ? '*' : [...filterCompanyIds].sort().join(',');

  useEffect(() => {
    let cancelled = false;
    if (!access) return () => { cancelled = true; };
    (async () => {
      let query = supabase.from('my_companies').select('id,name,nip').eq('is_active', true).order('name');
      if (filterCompanyIds) query = query.in('id', filterCompanyIds.length ? filterCompanyIds : ['00000000-0000-0000-0000-000000000000']);
      const { data: rows, error } = await query;
      if (cancelled) return;
      if (error) { showSnackbar('Nie udało się wczytać firm.', 'error'); setLoading(false); return; }
      // Tylko działalności (firmy z NIP) — marki bez NIP (np. Event Rulers) nie mają własnych finansów.
      const entities = ((rows || []) as Array<Company & { nip: string | null }>).filter((c) => String(c.nip || '').trim() !== '');
      const list = filterFinanceCompanies(access, entities, 'finance_view');
      setCompanies(list);
      setCompanyId((current) => (current && list.some((c) => c.id === current) ? current : list[0]?.id || ''));
      if (list.length === 0) setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyKey, access]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    const { data: result, error } = await supabase.rpc('get_finance_center', { p_company_id: companyId });
    if (error) {
      showSnackbar(error.message || 'Nie udało się wczytać Centrum finansów.', 'error');
      setData(null);
    } else {
      setData(result as CenterData);
    }
    setLoading(false);
  }, [companyId, showSnackbar]);

  useEffect(() => { setOpenWeek(null); void load(); }, [load]);

  const view = useMemo(() => {
    if (!data) return null;
    const today = data.today;
    const pln = (item: Item) => (item.currency || 'PLN') === 'PLN';
    const receivables = data.items.filter((i) => i.kind === 'receivable' && pln(i));
    const payables = data.items.filter((i) => i.kind === 'payable' && pln(i));
    const conflicts = data.items.filter((i) => i.kind === 'receivable_ksef_paid');
    const foreign = data.items.filter((i) => !pln(i) && i.kind !== 'receivable_ksef_paid');

    // Prognoza: pozycje w PLN (bez faktur do wyjaśnienia) i ZUS/podatki z kwotą.
    const flows: Flow[] = data.items
      .filter((i) => pln(i) && i.kind !== 'receivable_ksef_paid')
      .map((i) => ({
        key: `${i.kind}:${i.id}:${i.due_date ?? ''}:${i.label ?? ''}`,
        direction: i.direction,
        kindLabel: KIND_LABELS[i.kind],
        label: i.label || '—',
        counterparty: i.counterparty,
        due_date: i.due_date,
        amount: Number(i.amount || 0),
        estimated: i.estimated,
        href: itemHref(i),
      }));
    const unknownObligations: Obligation[] = [];
    for (const o of data.obligations) {
      if (o.amount === null) { unknownObligations.push(o); continue; }
      if (Number(o.amount) <= 0.009) continue;
      flows.push({
        key: `obligation:${o.kind}:${o.form}:${o.period_start}`,
        direction: 'out',
        kindLabel: KIND_LABELS.obligation,
        label: o.label,
        counterparty: o.kind === 'zus' ? 'ZUS' : 'Urząd skarbowy',
        due_date: o.due_date,
        amount: Number(o.amount),
        estimated: o.estimated,
        href: sectionHref('external', 'deadlines'),
        // Brak jakiejkolwiek zapłaty mimo wyciągu za termin — zwykle nieprzypisany przelew; częściowa zapłata = realna reszta.
        unassigned: o.status === 'unpaid' && o.overdue,
      });
    }

    const week0 = data.forecast.week0;
    const weeks = Array.from({ length: data.forecast.weeks }, (_, index) => {
      const start = addDays(week0, index * 7);
      return { index, start, end: addDays(start, 6), inflows: 0, outflows: 0, flows: [] as Flow[] };
    });
    const overdue = { inflows: 0, outflows: 0, unassigned: 0, flows: [] as Flow[] };
    const undated = { inflows: 0, outflows: 0, flows: [] as Flow[] };
    for (const flow of flows) {
      if (!flow.due_date) {
        undated.flows.push(flow);
        if (flow.direction === 'in') undated.inflows += flow.amount; else undated.outflows += flow.amount;
        continue;
      }
      if (flow.due_date < today) {
        overdue.flows.push(flow);
        if (flow.direction === 'in') overdue.inflows += flow.amount;
        else if (flow.unassigned) overdue.unassigned += flow.amount;
        else overdue.outflows += flow.amount;
        continue;
      }
      if (flow.due_date > data.forecast.until) continue;
      const index = Math.floor(daysBetween(week0, flow.due_date) / 7);
      const week = weeks[index];
      if (!week) continue;
      week.flows.push(flow);
      if (flow.direction === 'in') week.inflows += flow.amount; else week.outflows += flow.amount;
    }
    const opening = Number(data.cash.total || 0);
    const start = opening + (includeOverdueIn ? overdue.inflows : 0) - overdue.outflows - (includeUnassigned ? overdue.unassigned : 0);
    let running = start;
    const balances = weeks.map((week) => {
      running += week.inflows - week.outflows;
      return running;
    });
    const lowest = balances.reduce((min, value, index) => (value < min.value ? { value, index } : min), { value: start, index: -1 });
    const maxFlow = Math.max(1, ...weeks.map((w) => Math.max(w.inflows, w.outflows)));
    const firstNegative = balances.findIndex((value) => value < 0);

    const vatCurrent = data.vat?.find((v) => v.period_start.slice(0, 7) === today.slice(0, 7)) ?? null;
    const vatPrevious = data.vat?.find((v) => v.period_start.slice(0, 7) !== today.slice(0, 7)) ?? null;

    return {
      today, receivables, payables, conflicts, foreign,
      receivableAging: aging(receivables, today),
      payableAging: aging(payables, today),
      weeks, overdue, undated, unknownObligations, opening, start, balances, lowest, maxFlow, firstNegative,
      vatCurrent, vatPrevious,
      upcomingObligations: data.obligations
        .filter((o) => o.due_date >= today && daysBetween(today, o.due_date) <= 45)
        .sort((a, b) => a.due_date.localeCompare(b.due_date)),
      overdueObligations: data.obligations.filter((o) => o.due_date < today),
    };
  }, [data, includeOverdueIn, includeUnassigned]);

  // UPO faktur przyjętych przez KSeF, których CRM jeszcze nie ma (do 10 na kliknięcie — limit zapytań KSeF).
  const fetchMissingUpo = async () => {
    if (!data || fetchingUpo) return;
    setFetchingUpo(true);
    try {
      const response = await fetch('/bridge/ksef/invoices/upo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: data.company_id, missing: true }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.success) {
        showSnackbar(result?.error || 'Nie udało się pobrać UPO z KSeF.', 'error');
        return;
      }
      const parts = [`Pobrano UPO: ${result.fetched}`];
      if (result.remaining > 0) parts.push(`do pobrania: ${result.remaining}`);
      if (result.unavailable > 0) parts.push(`bez sesji w KSeF: ${result.unavailable}`);
      showSnackbar(`${parts.join(', ')}.`, result.failed > 0 ? 'warning' : 'success');
      if (result.failed > 0 && result.failures?.[0]?.error) showSnackbar(`${result.failures[0].invoice}: ${result.failures[0].error}`, 'warning');
      await load();
    } catch {
      showSnackbar('Nie udało się połączyć z serwerem CRM.', 'error');
    } finally {
      setFetchingUpo(false);
    }
  };

  const saveRate = async (value: string) => {
    if (!data) return;
    setSavingRate(true);
    const { error } = await supabase.rpc('save_finance_tax_settings', {
      p_company_id: data.company_id, p_cit_rate: value === '' ? null : Number(value),
    });
    setSavingRate(false);
    if (error) { showSnackbar(error.message || 'Nie udało się zapisać stawki CIT.', 'error'); return; }
    showSnackbar('Stawka CIT zapisana.', 'success');
    await load();
  };

  if (!loading && companies.length === 0) {
    return <div className={`${card} p-6 text-sm text-[#e5e4e2]/60`}>Brak działalności z dostępem do finansów.</div>;
  }

  return (
    <div className="space-y-4">
      <div className={`${card} flex flex-wrap items-center gap-3 p-4`}>
        <Scale className="h-5 w-5 text-[#d3bb73]" />
        <div className="mr-auto">
          <div className="text-sm font-medium text-[#e5e4e2]">Centrum finansów</div>
          <div className="text-[11px] text-[#e5e4e2]/50">
            Gotówka, należności, zobowiązania, podatki i prognoza na 13 tygodni{data ? ` — stan na ${date(data.today)}` : ''}.
          </div>
        </div>
        {companies.length > 1 && (
          <select className={input} value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        <button type="button" className={ghost} onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}Odśwież
        </button>
      </div>

      {loading && !data ? (
        <div className={`${card} flex items-center justify-center p-10`}><Loader2 className="h-6 w-6 animate-spin text-[#d3bb73]" /></div>
      ) : data && view ? (
        <>
          {data.quality.length > 0 && (
            <section className={`${card} p-4`}>
              <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-[#e5e4e2]">
                <AlertTriangle className="h-4 w-4 text-amber-300" />Kompletność danych — liczby poniżej są tak dobre, jak te dane
              </h3>
              <ul className="space-y-1.5">
                {data.quality.map((q) => (
                  <li key={q.key} className="flex items-start gap-2 text-xs">
                    {q.level === 'error'
                      ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-red-300" />
                      : q.level === 'warning'
                        ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-300" />
                        : <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[#e5e4e2]/50" />}
                    <span className={`mr-auto ${q.level === 'error' ? 'text-red-200' : q.level === 'warning' ? 'text-amber-100/90' : 'text-[#e5e4e2]/65'}`}>{q.text}</span>
                    {q.key === 'upo_missing' ? (
                      <button type="button" className="flex-shrink-0 text-[11px] text-[#d3bb73] hover:underline disabled:opacity-50"
                        disabled={fetchingUpo} onClick={() => void fetchMissingUpo()}>
                        {fetchingUpo ? 'Pobieranie…' : 'Pobierz UPO'}
                      </button>
                    ) : (
                      <Link href={sectionHref(q.tab, q.section)} className="flex-shrink-0 text-[11px] text-[#d3bb73] hover:underline">Przejdź</Link>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Tile icon={Wallet} label="Gotówka na rachunkach" value={money(data.cash.total)}
              hint={data.cash.as_of ? `saldo z wyciągów na ${date(data.cash.as_of)}` : 'brak wyciągów'}
              warn={data.cash.days_old !== null && data.cash.days_old > 35} />
            <Tile icon={TrendingUp} label="Należności" value={money(view.receivableAging.total)}
              hint={`po terminie ${money(view.receivableAging.overdue)}`} warn={view.receivableAging.overdue > 0} />
            <Tile icon={TrendingDown} label="Zobowiązania" value={money(view.payableAging.total)}
              hint={`po terminie ${money(view.payableAging.overdue)} · bez terminu ${view.payableAging.sums.no_due.count}`}
              warn={view.payableAging.overdue > 0} />
            <Tile icon={Landmark} label="VAT — szacunek"
              value={view.vatCurrent ? money(Math.max(view.vatCurrent.estimate, 0)) : '—'}
              hint={view.vatCurrent
                ? (view.vatCurrent.estimate < 0 ? `nadwyżka ${money(-view.vatCurrent.estimate)} — ${monthLabel(view.vatCurrent.period_start)}` : monthLabel(view.vatCurrent.period_start))
                : 'brak obowiązku VAT miesięcznego'}
              warn={false} />
            <Tile icon={PiggyBank} label={`Rezerwa CIT ${data.cit.year}`}
              value={data.cit.reserve === null ? '—' : money(data.cit.reserve)}
              hint={data.cit.rate === null ? 'ustaw stawkę CIT w sekcji podatków' : `orientacyjnie, ${data.cit.rate}% od wyniku`}
              warn={false} />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <section className={card}>
              <header className="flex items-center gap-2 border-b border-[#d3bb73]/10 px-4 py-3">
                <Wallet className="h-4 w-4 text-[#d3bb73]" />
                <h3 className="mr-auto text-sm font-medium text-[#e5e4e2]">Rachunki</h3>
                <Link href={sectionHref('external', 'statements')} className="text-[11px] text-[#d3bb73] hover:underline">Wyciągi</Link>
              </header>
              {data.cash.accounts.length === 0 ? (
                <div className="px-4 py-6 text-xs text-[#e5e4e2]/60">Brak wczytanych wyciągów.</div>
              ) : (
                <table className="w-full">
                  <thead><tr><th className={th}>Rachunek</th><th className={th}>Saldo na dzień</th><th className={`${th} text-right`}>Saldo</th></tr></thead>
                  <tbody className="divide-y divide-white/5">
                    {data.cash.accounts.map((a) => (
                      <tr key={a.key}>
                        <td className={td}>{a.label}</td>
                        <td className={td}>{date(a.as_of)}</td>
                        <td className={`${td} text-right`}>{a.balance === null ? 'brak salda' : money(a.balance, a.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="border-t border-[#d3bb73]/10 px-4 py-2 text-[10px] text-[#e5e4e2]/45">
                Saldo końcowe ostatniego wyciągu każdego rachunku. Operacji po tej dacie CRM nie zna — prognoza zaczyna się od tego salda.
              </p>
            </section>

            <section className={card}>
              <header className="flex items-center gap-2 border-b border-[#d3bb73]/10 px-4 py-3">
                <CheckCircle2 className="h-4 w-4 text-[#d3bb73]" />
                <h3 className="mr-auto text-sm font-medium text-[#e5e4e2]">
                  Zamknięcie miesiąca: {MONTHS[data.checklist.period_month - 1]} {data.checklist.period_year}
                </h3>
              </header>
              <ul className="divide-y divide-white/5">
                {data.checklist.items.map((item) => (
                  <li key={item.key} className="flex items-center gap-2 px-4 py-2 text-xs">
                    {item.done === null
                      ? <Circle className="h-4 w-4 flex-shrink-0 text-[#e5e4e2]/25" />
                      : item.done
                        ? <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-emerald-300" />
                        : <Circle className="h-4 w-4 flex-shrink-0 text-amber-300" />}
                    <span className={`mr-auto ${item.done ? 'text-[#e5e4e2]/60' : 'text-[#e5e4e2]'}`}>
                      {item.label}
                      {item.detail && <span className="text-[#e5e4e2]/45"> — {item.detail}</span>}
                    </span>
                    {!item.done && item.done !== null && (
                      <Link href={sectionHref(item.tab, item.section)} className="text-[11px] text-[#d3bb73] hover:underline">Przejdź</Link>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <AgingCard title="Należności" icon={TrendingUp} aging={view.receivableAging}
              top={view.receivables.filter((i) => (i.days_overdue ?? 0) > 0).sort((a, b) => b.amount - a.amount).slice(0, 6)}
              topLabel="Największe po terminie" emptyText="Brak nieopłaconych faktur sprzedaży."
              footer={view.conflicts.length > 0
                ? `Poza sumą: ${view.conflicts.length} faktur CRM zapłaconych według KSeF (${money(view.conflicts.reduce((s, i) => s + Number(i.amount), 0))}) — do wyjaśnienia.`
                : 'Faktury CRM (bez pro form) i faktury sprzedaży wystawione tylko w KSeF; zapłata z uzgodnienia wyciągów.'} />
            <AgingCard title="Zobowiązania" icon={TrendingDown} aging={view.payableAging}
              top={view.payables.filter((i) => i.due_date && daysBetween(view.today, i.due_date) <= 14).sort((a, b) => (a.due_date || '').localeCompare(b.due_date || '')).slice(0, 6)}
              topLabel="Do zapłaty w 14 dni i po terminie" emptyText="Brak nieopłaconych faktur kosztowych."
              footer="Faktury kosztowe z KSeF (kwota po zapisanych płatnościach) i nieopłacone dokumenty spoza KSeF. Terminy uzupełnisz w „Terminy i monity”." />
          </div>

          <section className={card}>
            <header className="flex flex-wrap items-center gap-2 border-b border-[#d3bb73]/10 px-4 py-3">
              <Landmark className="h-4 w-4 text-[#d3bb73]" />
              <h3 className="mr-auto text-sm font-medium text-[#e5e4e2]">ZUS i podatki</h3>
              <Link href={sectionHref('external', 'deadlines')} className="text-[11px] text-[#d3bb73] hover:underline">Kalendarz obowiązków</Link>
            </header>
            <div className="grid gap-4 p-4 lg:grid-cols-3">
              <div>
                <div className="mb-2 text-[10px] uppercase tracking-wide text-[#e5e4e2]/45">Najbliższe 45 dni</div>
                {view.upcomingObligations.length === 0 ? (
                  <div className="text-xs text-[#e5e4e2]/55">Brak niezapłaconych obowiązków w najbliższych 45 dniach.</div>
                ) : (
                  <ul className="space-y-1.5 text-xs">
                    {view.upcomingObligations.map((o) => (
                      <li key={`${o.kind}:${o.form}:${o.period_start}`} className="flex items-baseline gap-2">
                        <span className="w-12 flex-shrink-0 text-[#e5e4e2]/55">{dayMonth(o.due_date)}</span>
                        <span className="mr-auto text-[#e5e4e2]">{o.label}</span>
                        <span className={o.amount === null ? 'text-[#e5e4e2]/45' : 'text-[#e5e4e2]'}>
                          {o.amount === null ? 'kwota nieznana' : `${o.estimated ? '~' : ''}${money(o.amount)}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {view.overdueObligations.length > 0 && (
                  <p className="mt-2 text-[11px] text-amber-200/90">
                    Po terminie lub bez potwierdzenia zapłaty: {view.overdueObligations.length} — szczegóły w kalendarzu obowiązków.
                  </p>
                )}
              </div>
              <div>
                <div className="mb-2 text-[10px] uppercase tracking-wide text-[#e5e4e2]/45">VAT (szacunek z faktur)</div>
                {!data.vat ? (
                  <div className="text-xs text-[#e5e4e2]/55">Działalność nie ma włączonego VAT miesięcznego w obowiązkach.</div>
                ) : (
                  <table className="w-full text-xs">
                    <thead><tr><th className={th}>Miesiąc</th><th className={`${th} text-right`}>Należny</th><th className={`${th} text-right`}>Naliczony</th><th className={`${th} text-right`}>Do zapłaty</th></tr></thead>
                    <tbody className="divide-y divide-white/5">
                      {[view.vatPrevious, view.vatCurrent].filter((v): v is VatMonth => Boolean(v)).map((v) => (
                        <tr key={v.period_start}>
                          <td className={td}>
                            <div>{monthLabel(v.period_start)}</div>
                            <div className="text-[10px] text-[#e5e4e2]/45">
                              {v.due_date ? `termin ${date(v.due_date)}` : ''}
                              {v.declared !== null ? ` · deklaracja ${money(v.declared)}` : ''}
                              {v.paid > 0 ? ` · zapłacono ${money(v.paid)}` : ''}
                            </div>
                          </td>
                          <td className={`${td} text-right`}>{money(v.output_vat)}</td>
                          <td className={`${td} text-right`}>
                            {money(v.input_vat)}
                            {v.carried > 0 && <div className="text-[10px] text-[#e5e4e2]/45">+ nadwyżka {money(v.carried)}</div>}
                          </td>
                          <td className={`${td} text-right font-medium`}>
                            {v.estimate < 0 ? <span className="text-emerald-300">nadwyżka {money(-v.estimate)}</span> : money(v.estimate)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <p className="mt-2 text-[10px] text-[#e5e4e2]/45">
                  Według daty wystawienia faktur w PLN; nadwyżka naliczonego przechodzi na kolejny miesiąc. Kwotę deklaracji ustala biuro.
                  {(view.vatCurrent?.foreign_count || 0) + (view.vatPrevious?.foreign_count || 0) > 0 && ' Faktury w walutach obcych pominięte.'}
                </p>
              </div>
              <div>
                <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-wide text-[#e5e4e2]/45">
                  <span className="mr-auto">CIT {data.cit.year} — orientacyjnie</span>
                  {data.can_manage && (
                    <select className={input} value={data.tax_settings.cit_rate ?? ''} disabled={savingRate}
                      onChange={(e) => void saveRate(e.target.value)} aria-label="Stawka CIT">
                      <option value="">stawka: nie ustawiono</option>
                      <option value="9">9% (mały podatnik)</option>
                      <option value="19">19%</option>
                    </select>
                  )}
                </div>
                <dl className="space-y-1 text-xs">
                  <Row label="Przychody netto z faktur" value={money(data.cit.revenue_net)} />
                  <Row label="Koszty netto z faktur" value={money(data.cit.costs_net)} />
                  <Row label="Wynik" value={money(data.cit.result)} strong />
                  <Row label={data.cit.rate ? `Podatek ${data.cit.rate}%` : 'Podatek'} value={data.cit.tax === null ? '—' : money(data.cit.tax)} />
                  <Row label="Zaliczki zapłacone w roku" value={money(data.cit.paid)} />
                  <Row label="Rezerwa" value={data.cit.reserve === null ? '—' : money(data.cit.reserve)} strong />
                </dl>
                <p className="mt-2 text-[10px] text-[#e5e4e2]/45">
                  Bez wynagrodzeń, ZUS, amortyzacji i kosztów niestanowiących kosztu podatkowego — rezerwa jest ostrożna (raczej zawyżona).
                  Kwotę zaliczki ustala biuro rachunkowe.
                </p>
              </div>
            </div>
          </section>

          <section className={card}>
            <header className="flex flex-wrap items-center gap-3 border-b border-[#d3bb73]/10 px-4 py-3">
              <TrendingUp className="h-4 w-4 text-[#d3bb73]" />
              <h3 className="mr-auto text-sm font-medium text-[#e5e4e2]">Prognoza 13 tygodni</h3>
              <label className="flex items-center gap-1.5 text-[11px] text-[#e5e4e2]/65">
                <input type="checkbox" checked={includeOverdueIn} onChange={(e) => setIncludeOverdueIn(e.target.checked)} />
                Licz zaległe wpływy ({short(view.overdue.inflows)})
              </label>
              <label className="flex items-center gap-1.5 text-[11px] text-[#e5e4e2]/65">
                <input type="checkbox" checked={includeUnassigned} onChange={(e) => setIncludeUnassigned(e.target.checked)} />
                Licz ZUS i podatki bez przypisanej zapłaty ({short(view.overdue.unassigned)})
              </label>
            </header>
            {view.firstNegative >= 0 ? (
              <div className="flex items-start gap-2 border-b border-red-500/20 bg-red-500/10 px-4 py-2 text-xs text-red-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                Saldo spada poniżej zera w tygodniu od {dayMonth(view.weeks[view.firstNegative].start)} (najniżej {money(view.lowest.value)}).
              </div>
            ) : (
              <div className="border-b border-[#d3bb73]/10 px-4 py-2 text-[11px] text-[#e5e4e2]/55">
                Najniższe saldo w horyzoncie: {money(view.lowest.value)}{view.lowest.index >= 0 ? ` (tydzień od ${dayMonth(view.weeks[view.lowest.index].start)})` : ''}.
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr>
                  <th className={th}>Tydzień</th><th className={`${th} text-right`}>Wpływy</th><th className={`${th} text-right`}>Wydatki</th>
                  <th className={th} /><th className={`${th} text-right`}>Saldo na koniec</th>
                </tr></thead>
                <tbody className="divide-y divide-white/5">
                  <tr>
                    <td className={td} colSpan={4}>
                      Saldo z wyciągów{data.cash.as_of ? ` na ${date(data.cash.as_of)}` : ''}
                      {data.cash.days_old !== null && data.cash.days_old > 10 && (
                        <span className="ml-1 text-amber-200/80">— sprzed {data.cash.days_old} dni; wpływy i wydatki od tej daty liczone z terminów.</span>
                      )}
                    </td>
                    <td className={`${td} text-right`}>{money(view.opening)}</td>
                  </tr>
                  <ExpandableRow
                    open={openWeek === 'overdue'} onToggle={() => setOpenWeek(openWeek === 'overdue' ? null : 'overdue')}
                    label="Termin minął (również od ostatniego wyciągu)"
                    inflows={view.overdue.inflows} outflows={view.overdue.outflows + view.overdue.unassigned}
                    inflowsNote={includeOverdueIn ? undefined : 'nieliczone'}
                    outflowsNote={!includeUnassigned && view.overdue.unassigned > 0 ? `w tym ${short(view.overdue.unassigned)} nieliczone` : undefined}
                    balance={view.start} flows={view.overdue.flows} maxFlow={view.maxFlow} />
                  {view.weeks.map((week, index) => (
                    <ExpandableRow key={week.start}
                      open={openWeek === index} onToggle={() => setOpenWeek(openWeek === index ? null : index)}
                      label={`${dayMonth(week.start)}–${dayMonth(week.end)}`}
                      inflows={week.inflows} outflows={week.outflows} balance={view.balances[index]}
                      flows={week.flows} maxFlow={view.maxFlow} bars />
                  ))}
                  <ExpandableRow
                    open={openWeek === 'undated'} onToggle={() => setOpenWeek(openWeek === 'undated' ? null : 'undated')}
                    label="Bez terminu (poza saldem)" inflows={view.undated.inflows} outflows={view.undated.outflows}
                    balance={null} flows={view.undated.flows} maxFlow={view.maxFlow} />
                </tbody>
              </table>
            </div>
            <div className="space-y-1 border-t border-[#d3bb73]/10 px-4 py-2 text-[10px] text-[#e5e4e2]/45">
              <p>
                Wpływy: należności, pro formy i harmonogramy płatności wydarzeń bez faktury. Wydatki: faktury kosztowe, umowy stałe,
                wynagrodzenia z umów personelu (do 10. następnego miesiąca) oraz ZUS i podatki (kwota z deklaracji, bez niej — szacunek
                VAT albo ostatnia zapłata; „~” = szacunek). Tylko kwoty w PLN.
              </p>
              {view.unknownObligations.length > 0 && (
                <p>Bez kwoty (poza prognozą): {view.unknownObligations.map((o) => `${o.label} (${date(o.due_date)})`).join(', ')}.</p>
              )}
              {view.foreign.length > 0 && <p>Poza prognozą: {view.foreign.length} pozycji w walutach obcych.</p>}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

function Tile({ icon: Icon, label, value, hint, warn }: { icon: typeof Wallet; label: string; value: string; hint: string; warn: boolean }) {
  return (
    <div className={`${card} p-3`}>
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-[#e5e4e2]/45">
        <Icon className={`h-4 w-4 ${warn ? 'text-amber-300' : 'text-[#d3bb73]/70'}`} />{label}
      </div>
      <div className="mt-1 text-lg font-light text-[#e5e4e2]">{value}</div>
      <div className={`text-[11px] ${warn ? 'text-amber-200/90' : 'text-[#e5e4e2]/50'}`}>{hint}</div>
    </div>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="mr-auto text-[#e5e4e2]/60">{label}</dt>
      <dd className={strong ? 'font-medium text-[#e5e4e2]' : 'text-[#e5e4e2]/85'}>{value}</dd>
    </div>
  );
}

function AgingCard({ title, icon: Icon, aging: data, top, topLabel, emptyText, footer }: {
  title: string;
  icon: typeof Wallet;
  aging: ReturnType<typeof aging>;
  top: Item[];
  topLabel: string;
  emptyText: string;
  footer: string;
}) {
  const max = Math.max(1, ...BUCKETS.map((b) => data.sums[b.key].amount));
  return (
    <section className={card}>
      <header className="flex items-center gap-2 border-b border-[#d3bb73]/10 px-4 py-3">
        <Icon className="h-4 w-4 text-[#d3bb73]" />
        <h3 className="mr-auto text-sm font-medium text-[#e5e4e2]">{title}</h3>
        <span className="text-xs text-[#e5e4e2]/70">{money(data.total)}</span>
      </header>
      {data.total <= 0 ? (
        <div className="px-4 py-6 text-xs text-[#e5e4e2]/60">{emptyText}</div>
      ) : (
        <div className="space-y-1.5 px-4 py-3">
          {BUCKETS.map((bucket) => {
            const value = data.sums[bucket.key];
            const late = bucket.key !== 'no_due' && bucket.key !== 'current';
            return (
              <div key={bucket.key} className="flex items-center gap-2 text-xs">
                <span className="w-36 flex-shrink-0 text-[#e5e4e2]/60">{bucket.label}</span>
                <div className="h-2 flex-1 overflow-hidden rounded bg-white/5">
                  <div className={`h-2 rounded ${late ? 'bg-red-400/70' : bucket.key === 'no_due' ? 'bg-amber-300/60' : 'bg-[#d3bb73]/70'}`}
                    style={{ width: `${(value.amount / max) * 100}%` }} />
                </div>
                <span className="w-28 flex-shrink-0 text-right text-[#e5e4e2]/85">{money(value.amount)}</span>
                <span className="w-8 flex-shrink-0 text-right text-[10px] text-[#e5e4e2]/45">{value.count}</span>
              </div>
            );
          })}
        </div>
      )}
      {top.length > 0 && (
        <div className="border-t border-[#d3bb73]/10 px-4 py-2">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-[#e5e4e2]/45">{topLabel}</div>
          <ul className="space-y-1 text-xs">
            {top.map((item) => {
              const href = itemHref(item);
              return (
                <li key={`${item.kind}:${item.id}`} className="flex items-baseline gap-2">
                  {href ? (
                    <Link href={href} className="truncate text-[#d3bb73] hover:underline">{item.label || '—'}</Link>
                  ) : <span className="truncate">{item.label || '—'}</span>}
                  <span className="mr-auto truncate text-[#e5e4e2]/50">{item.counterparty || ''}</span>
                  <span className={`flex-shrink-0 text-[10px] ${(item.days_overdue ?? 0) > 0 ? 'text-red-300' : 'text-[#e5e4e2]/45'}`}>
                    {(item.days_overdue ?? 0) > 0 ? `${item.days_overdue} dni po terminie` : item.due_date ? `termin ${date(item.due_date)}` : 'bez terminu'}
                  </span>
                  <span className="w-28 flex-shrink-0 text-right">{money(item.amount, item.currency)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <p className="border-t border-[#d3bb73]/10 px-4 py-2 text-[10px] text-[#e5e4e2]/45">{footer}</p>
    </section>
  );
}

function ExpandableRow({ open, onToggle, label, inflows, outflows, balance, flows, maxFlow, bars = false, inflowsNote, outflowsNote }: {
  open: boolean;
  onToggle: () => void;
  label: string;
  inflows: number;
  outflows: number;
  balance: number | null;
  flows: Flow[];
  maxFlow: number;
  bars?: boolean;
  inflowsNote?: string;
  outflowsNote?: string;
}) {
  const sorted = [...flows].sort((a, b) => (a.due_date || '').localeCompare(b.due_date || '') || b.amount - a.amount);
  return (
    <>
      <tr className={flows.length ? 'cursor-pointer hover:bg-white/[0.02]' : ''} onClick={flows.length ? onToggle : undefined}>
        <td className={td}>
          <span className="inline-flex items-center gap-1">
            {flows.length > 0 ? (open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />) : <span className="w-3" />}
            {label}
            {flows.length > 0 && <span className="text-[10px] text-[#e5e4e2]/40">({flows.length})</span>}
          </span>
        </td>
        <td className={`${td} text-right text-emerald-300/90`}>
          {inflows > 0 ? money(inflows) : '—'}
          {inflowsNote && inflows > 0 && <div className="text-[10px] text-[#e5e4e2]/45">{inflowsNote}</div>}
        </td>
        <td className={`${td} text-right text-red-300/90`}>
          {outflows > 0 ? money(outflows) : '—'}
          {outflowsNote && <div className="text-[10px] text-[#e5e4e2]/45">{outflowsNote}</div>}
        </td>
        <td className={`${td} w-40`}>
          {bars && (
            <div className="space-y-0.5">
              <div className="h-1.5 rounded bg-emerald-400/60" style={{ width: `${(inflows / maxFlow) * 100}%` }} />
              <div className="h-1.5 rounded bg-red-400/60" style={{ width: `${(outflows / maxFlow) * 100}%` }} />
            </div>
          )}
        </td>
        <td className={`${td} text-right font-medium ${balance !== null && balance < 0 ? 'text-red-300' : 'text-[#e5e4e2]'}`}>
          {balance === null ? '' : money(balance)}
        </td>
      </tr>
      {open && sorted.map((flow) => (
        <tr key={flow.key} className="bg-black/10">
          <td className={`${td} pl-8`} colSpan={2}>
            <div className="flex items-baseline gap-2">
              <span className="text-[10px] text-[#e5e4e2]/45">{flow.due_date ? dayMonth(flow.due_date) : '—'}</span>
              {flow.href ? (
                <Link href={flow.href} className="text-[#d3bb73] hover:underline">{flow.label}</Link>
              ) : <span>{flow.label}</span>}
            </div>
            <div className="text-[10px] text-[#e5e4e2]/45">
              {flow.kindLabel}{flow.counterparty ? ` · ${flow.counterparty}` : ''}{flow.estimated ? ' · szacunek' : ''}
              {flow.unassigned ? ' · bez przypisanej zapłaty' : ''}
            </div>
          </td>
          <td className={`${td} text-right ${flow.direction === 'in' ? 'text-emerald-300/80' : 'text-red-300/80'}`} colSpan={2}>
            {flow.direction === 'in' ? '+' : '−'}{flow.estimated ? '~' : ''}{money(flow.amount)}
          </td>
          <td className={td} />
        </tr>
      ))}
      {open && (
        <tr className="bg-black/10"><td colSpan={5} className="px-3 py-1 text-right">
          <Link href={sectionHref('external', 'deadlines')} className="inline-flex items-center gap-1 text-[10px] text-[#d3bb73] hover:underline">
            Terminy i monity <ArrowRight className="h-3 w-3" />
          </Link>
        </td></tr>
      )}
    </>
  );
}
