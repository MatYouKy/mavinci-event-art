'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  HelpCircle,
  Download,
  Eye,
  FileQuestion,
  Info,
  FileSearch,
  Landmark,
  Link2,
  Loader2,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  Undo2,
  Wand2,
  X,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useInvoiceFinanceAccess } from '@/hooks/useInvoiceFinanceAccess';
import { canFinanceCompany } from '@/lib/invoices/financeAccess';
import { repairBrokenBankText } from '@/lib/bankTextEncoding';
import BankTransactionDocumentPickerModal from '@/components/crm/BankTransactionDocumentPickerModal';
import BankTransactionAccountingModal from '@/components/crm/BankTransactionAccountingModal';
import BankTransactionDetailsModal from '@/components/crm/BankTransactionDetailsModal';
import { isPreviewableDocumentSource, useDocumentPreview } from '@/components/crm/invoices/useDocumentPreview';
import { DeclarationLinkModal } from './FinanceDeclarationsPanel';
import { RecurringContractLinkModal } from './RecurringContractsPanel';
import BankRefundPairModal from './BankRefundPairModal';
import {
  DECLARATION_STATUS_META,
  RECURRING_MONTH_STATUS_META,
  RECONCILIATION_STATUS_META,
  RECONCILIATION_STATUS_ORDER,
  directionSign,
  documentKindLabel,
  explanationLabel,
  matchMethodLabel,
  proposalRuleLabel,
  reconciliationRunSentence,
  refundCounterpartLabel,
  refundOtherRole,
  type ReconciliationMonth,
  type ReconciliationProposalDocument,
  type ReconciliationStatus,
  type ReconciliationTransaction,
} from '@/lib/invoices/bankReconciliation';

interface Props {
  filterCompanyIds?: string[] | null;
  /** Przejście do zakładki z wgrywaniem wyciągów. */
  onOpenStatements?: () => void;
  /** Przejście do rejestru deklaracji ZUS i podatkowych. */
  onOpenDeclarations?: () => void;
  /** Przejście do rejestru umów stałych (najem, leasing, abonamenty). */
  onOpenContracts?: () => void;
}

interface Period {
  companyId: string;
  companyName: string;
  year: number;
  month: number;
}

const MONTHS = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień',
  'październik', 'listopad', 'grudzień'];

const money = (value: number | string | null | undefined, currency = 'PLN') =>
  `${Number(value || 0).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency === 'PLN' ? 'zł' : currency}`;

const date = (value?: string | null) => (value ? new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('pl-PL') : '—');

const text = (value?: string | null) => repairBrokenBankText(value).replace(/[˙]+/g, ' ').replace(/\s+/g, ' ').trim();

const sourceLabel = (source: string) => ({ ksef: 'KSeF', external: 'Spoza KSeF', invoice: 'CRM', declaration: 'Deklaracja', personnel: 'Wypłata', contract: 'Umowa stała', refund: 'Zwrot płatności' } as Record<string, string>)[source] || source;

/** „12.08” (ten sam rok) albo „12.08.2025”. */
const shortDate = (value?: string | null, year?: number) => {
  if (!value) return '—';
  const d = new Date(`${value.slice(0, 10)}T12:00:00`);
  return d.toLocaleDateString('pl-PL', d.getFullYear() === year
    ? { day: '2-digit', month: '2-digit' } : { day: '2-digit', month: '2-digit', year: 'numeric' });
};

/** Druga operacja w propozycji „zwrot płatności”: dowód, pozostała kwota, wyciąg z innego miesiąca. */
function refundFacts(doc: ReconciliationProposalDocument, currency: string, period: { year: number; month: number } | null): string {
  const parts: string[] = [];
  if (doc.evidence) parts.push(`dowód: ${doc.evidence}`);
  if (doc.tx_amount != null && doc.remaining != null && Number(doc.remaining) < Number(doc.tx_amount) - 0.009) {
    parts.push(`pozostało do rozliczenia ${money(doc.remaining, currency)} z ${money(doc.tx_amount, currency)}`);
  }
  if (period && doc.statement_year && doc.statement_month
      && (doc.statement_year !== period.year || doc.statement_month !== period.month)) {
    parts.push(`wyciąg ${String(doc.statement_month).padStart(2, '0')}/${doc.statement_year}`);
  }
  if (Number(doc.amount) < Number(doc.tx_amount || 0) - 0.009) parts.push(`zwrot częściowy — para ${money(doc.amount, currency)}`);
  return parts.join(' · ');
}

const foreign = (amount?: number | null, currency?: string | null, rate?: number | null) =>
  amount != null && currency
    ? ` = ${Number(amount).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}${rate ? ` (kurs ${Number(rate).toLocaleString('pl-PL', { maximumFractionDigits: 4 })})` : ''}`
    : '';

const OPEN_STATUSES: ReconciliationStatus[] = ['proposal', 'choice', 'partial', 'missing'];

/** Wpłata gotówki we wpłatomacie / wpłata własna — podpowiadamy wyjaśnienie „Wpłata własna”. */
const isCashDeposit = (t: { title: string | null; source_description: string | null }) =>
  /WP[ŁL]ATA\s+(GOT[ÓO]WKI|W[ŁL]ASNA)|WP[ŁL]ATOMA/i.test(`${t.title || ''} ${t.source_description || ''}`);

/** Rodzaj, daty i stan płatności dokumentu — żeby wybrać właściwy, gdy kilka ma tę samą kwotę. */
function documentFacts(doc: {
  kind?: string | null; issueDate?: string | null; dueDate?: string | null; status?: string | null;
  due?: number | null; paid?: number | null; manualPaid?: number | null; manualDate?: string | null;
}, currency: string): string {
  const parts: string[] = [];
  const kind = documentKindLabel(doc.kind);
  if (kind) parts.push(kind);
  if (doc.issueDate) parts.push(`wystawiona ${date(doc.issueDate)}`);
  if (doc.dueDate) parts.push(`termin ${date(doc.dueDate)}`);
  const due = Number(doc.due || 0);
  const paid = Number(doc.paid || 0);
  if (doc.status === 'partially_paid' || (paid > 0.009 && due - paid > 0.009)) {
    parts.push(`częściowo opłacona: ${money(paid, currency)} z ${money(due, currency)}, pozostało ${money(Math.max(due - paid, 0), currency)}`);
  } else if (Number(doc.manualPaid || 0) > 0.009) {
    parts.push(`oznaczona ręcznie jako opłacona${doc.manualDate ? ` ${date(doc.manualDate)}` : ''}`);
  }
  return parts.join(' · ');
}

export default function BankReconciliationPanel({ filterCompanyIds = null, onOpenStatements, onOpenDeclarations, onOpenContracts }: Props) {
  const { showSnackbar } = useSnackbar();
  const { access } = useInvoiceFinanceAccess();

  const [periods, setPeriods] = useState<Period[]>([]);
  const [period, setPeriod] = useState<Period | null>(null);
  // Uzgadnianie widzi poziom „Podgląd finansów” działalności wyciągu; akcje — tylko „Zarządzanie finansami” tej działalności.
  const canManage = canFinanceCompany(access, period?.companyId, 'finance_manage');
  const [data, setData] = useState<ReconciliationMonth | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'todo' | 'all' | ReconciliationStatus>('todo');
  const [accountFilter, setAccountFilter] = useState<'all' | 'regular' | 'vat'>('all');
  const [search, setSearch] = useState('');
  const [showRules, setShowRules] = useState(false);
  const [choice, setChoice] = useState<Record<string, number>>({});
  const [pickerFor, setPickerFor] = useState<ReconciliationTransaction | null>(null);
  const [explainFor, setExplainFor] = useState<ReconciliationTransaction | null>(null);
  const [declarationFor, setDeclarationFor] = useState<ReconciliationTransaction | null>(null);
  const [contractFor, setContractFor] = useState<ReconciliationTransaction | null>(null);
  const [refundFor, setRefundFor] = useState<ReconciliationTransaction | null>(null);
  const [detailsFor, setDetailsFor] = useState<ReconciliationTransaction | null>(null);
  // „Szczegóły płatności” drugiej operacji pary (z propozycji lub chipu zwrotu).
  const [detailsOther, setDetailsOther] = useState<{ id: string; statement_id: string } | null>(null);
  const { openPreview, previewModal, opening: previewOpening } = useDocumentPreview();

  const companyKey = filterCompanyIds === null ? '*' : [...filterCompanyIds].sort().join(',');

  // Okresy z wgranymi wyciągami (firma + miesiąc), najnowsze pierwsze.
  useEffect(() => {
    let cancelled = false;
    if (!access) return () => { cancelled = true; };
    (async () => {
      let query = supabase
        .from('bank_statements')
        .select('my_company_id, statement_year, statement_month, my_companies(name)')
        .eq('processed', true)
        .eq('validation_status', 'valid')
        .order('statement_year', { ascending: false })
        .order('statement_month', { ascending: false });
      if (filterCompanyIds) query = query.in('my_company_id', filterCompanyIds.length ? filterCompanyIds : ['00000000-0000-0000-0000-000000000000']);
      const { data: rows, error } = await query;
      if (cancelled) return;
      if (error) {
        showSnackbar('Nie udało się wczytać listy wyciągów.', 'error');
        setLoading(false);
        return;
      }
      const seen = new Set<string>();
      const next: Period[] = [];
      for (const row of (rows || []) as Array<{ my_company_id: string; statement_year: number; statement_month: number; my_companies?: { name?: string } | { name?: string }[] | null }>) {
        const key = `${row.my_company_id}:${row.statement_year}:${row.statement_month}`;
        if (seen.has(key) || !canFinanceCompany(access, row.my_company_id, 'finance_view')) continue;
        seen.add(key);
        const company = Array.isArray(row.my_companies) ? row.my_companies[0] : row.my_companies;
        next.push({ companyId: row.my_company_id, companyName: company?.name || 'Firma', year: row.statement_year, month: row.statement_month });
      }
      setPeriods(next);
      setPeriod((current) => (current && next.some((p) => p.companyId === current.companyId && p.year === current.year && p.month === current.month)
        ? current : next[0] || null));
      if (next.length === 0) setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyKey, access]);

  const load = useCallback(async () => {
    if (!period) return;
    setLoading(true);
    const { data: result, error } = await supabase.rpc('get_bank_reconciliation_month', {
      p_company_id: period.companyId, p_year: period.year, p_month: period.month,
    });
    if (error) {
      showSnackbar(error.message || 'Nie udało się wczytać uzgodnienia.', 'error');
      setData(null);
    } else {
      setData(result as ReconciliationMonth);
    }
    setLoading(false);
  }, [period, showSnackbar]);

  useEffect(() => { void load(); }, [load]);

  const companyPeriods = useMemo(
    () => periods.filter((p) => p.companyId === period?.companyId),
    [periods, period?.companyId],
  );
  const companies = useMemo(() => {
    const map = new Map<string, string>();
    periods.forEach((p) => map.set(p.companyId, p.companyName));
    return Array.from(map.entries());
  }, [periods]);
  const periodIndex = companyPeriods.findIndex((p) => p.year === period?.year && p.month === period?.month);

  const transactions = useMemo(() => data?.transactions || [], [data]);

  // Przy wyborze spośród kilku dokumentów zaznacz wskazany przez bazę (np. ręczna płatność z dnia przelewu).
  useEffect(() => {
    if (!data) return;
    setChoice((current) => {
      let changed = false;
      const next = { ...current };
      for (const t of data.transactions) {
        const proposal = t.proposal;
        if (proposal?.kind !== 'choose' || next[proposal.id] !== undefined) continue;
        const index = proposal.documents.findIndex((doc) => doc.suggested);
        if (index >= 0) { next[proposal.id] = index; changed = true; }
      }
      return changed ? next : current;
    });
  }, [data]);
  const counts = useMemo(() => {
    const result = Object.fromEntries(RECONCILIATION_STATUS_ORDER.map((s) => [s, { count: 0, amount: 0 }])) as Record<ReconciliationStatus, { count: number; amount: number }>;
    transactions.forEach((t) => {
      result[t.status].count += 1;
      result[t.status].amount += t.status === 'partial' ? t.remaining : t.amount;
    });
    return result;
  }, [transactions]);
  const todoCount = OPEN_STATUSES.reduce((sum, s) => sum + counts[s].count, 0);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return transactions.filter((t) => {
      if (statusFilter === 'todo' && !OPEN_STATUSES.includes(t.status)) return false;
      if (statusFilter !== 'todo' && statusFilter !== 'all' && t.status !== statusFilter) return false;
      if (accountFilter !== 'all' && t.account_kind !== accountFilter) return false;
      if (!needle) return true;
      return [t.counterparty, t.title, t.source_description, String(t.amount), ...t.allocations.map((a) => a.number),
        ...t.personnel.map((p) => p.recipient), ...(t.declarations || []).map((d) => d.label),
        ...(t.contracts || []).flatMap((c) => [c.title, c.counterparty]),
        ...(t.refunds || []).flatMap((r) => [r.other.counterparty, r.other.title, String(r.other.amount)])]
        .some((value) => text(value).toLowerCase().includes(needle));
    });
  }, [transactions, statusFilter, accountFilter, search]);

  const runReconciliation = async () => {
    if (!period) return;
    setRunning(true);
    const { data: summary, error } = await supabase.rpc('reconcile_bank_month', {
      p_company_id: period.companyId, p_year: period.year, p_month: period.month,
    });
    setRunning(false);
    if (error) {
      showSnackbar(error.message || 'Uzgodnienie nie powiodło się.', 'error');
      return;
    }
    showSnackbar(reconciliationRunSentence(summary as Record<string, unknown>), 'success');
    await load();
  };

  const callAction = async (key: string, action: () => PromiseLike<{ error: { message?: string } | null }>, success: string): Promise<boolean> => {
    setBusyKey(key);
    const { error } = await action();
    setBusyKey(null);
    if (error) {
      showSnackbar(error.message || 'Operacja nie powiodła się.', 'error');
      return false;
    }
    showSnackbar(success, 'success');
    await load();
    return true;
  };

  const REJECT_MESSAGE = 'Propozycja odrzucona. Ten dokument nie wróci do tej płatności; dla innych płatności nadal czeka na dopasowanie.';
  const REJECT_REFUND_MESSAGE = 'Propozycja odrzucona. Ta para płatność + zwrot nie wróci — ani przy tej operacji, ani przy drugiej.';
  const rejectProposal = (t: ReconciliationTransaction, thenPick = false) => {
    if (!t.proposal) return;
    const refund = t.proposal.rule === 'zwrot_platnosci';
    void callAction(`reject:${t.id}`, () => supabase.rpc('reject_bank_reconciliation_proposal', { p_proposal_id: t.proposal!.id }),
      refund ? REJECT_REFUND_MESSAGE : REJECT_MESSAGE)
      .then((ok) => { if (ok && thenPick) (refund ? setRefundFor : setPickerFor)(t); });
  };

  const acceptProposal = (t: ReconciliationTransaction) => {
    if (!t.proposal) return;
    const index = t.proposal.kind === 'choose' ? choice[t.proposal.id] : null;
    if (t.proposal.kind === 'choose' && (index === undefined || index === null)) {
      showSnackbar('Wybierz jeden dokument z listy.', 'warning');
      return;
    }
    void callAction(`accept:${t.id}`, () => supabase.rpc('accept_bank_reconciliation_proposal', {
      p_proposal_id: t.proposal!.id, p_document_index: index,
    }), t.proposal.rule === 'zwrot_platnosci'
      ? 'Płatność i zwrot powiązane — obie operacje są rozliczone bez faktury.' : 'Płatność rozliczona.');
  };

  // Lista dla księgowej: operacje bez dokumentu (brak, częściowe, propozycje do sprawdzenia).
  const exportMissing = () => {
    const rows = transactions.filter((t) => OPEN_STATUSES.includes(t.status));
    if (rows.length === 0) {
      showSnackbar('Wszystkie operacje są rozliczone lub wyjaśnione.', 'success');
      return;
    }
    const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const csv = [
      ['Data', 'Rachunek', 'Kierunek', 'Kontrahent', 'Tytuł', 'Kwota', 'Pozostało', 'Waluta', 'Status', 'Wskazówka'],
      ...rows.map((t) => [
        t.date, t.account_kind === 'vat' ? 'VAT' : 'bieżący', t.direction === 'credit' ? 'Wpływ' : 'Wydatek',
        text(t.counterparty), text(t.title), t.amount.toFixed(2).replace('.', ','), t.remaining.toFixed(2).replace('.', ','),
        t.currency, RECONCILIATION_STATUS_META[t.status].label, t.proposal?.reason || '',
      ]),
    ].map((row) => row.map(escape).join(';')).join('\n');
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    const link = window.document.createElement('a');
    link.href = url;
    link.download = `braki-dokumentow-${period ? `${period.year}-${String(period.month).padStart(2, '0')}` : 'miesiac'}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const sources = data?.sources || [];
  const sourceSummary = (kind: 'regular' | 'vat') => {
    const files = sources.filter((s) => s.kind === kind);
    if (files.length === 0) return null;
    const formats = files.map((f) => f.format?.toUpperCase()).filter(Boolean);
    const confirmed = files.reduce((sum, f) => sum + Number(f.confirmed || 0), 0) / Math.max(files.length, 1);
    const unconfirmed = files.reduce((sum, f) => sum + Number(f.unconfirmed || 0), 0);
    const count = Math.max(...files.map((f) => Number(f.transactions_count || 0)));
    return { files, formats, confirmed: Math.round(confirmed), unconfirmed, count };
  };

  if (!loading && periods.length === 0) {
    return (
      <div className="rounded-xl border border-[#d3bb73]/15 bg-[#1c1f33] p-8 text-center">
        <Landmark className="mx-auto mb-3 h-10 w-10 text-[#d3bb73]/50" />
        <p className="text-[#e5e4e2]">Nie ma jeszcze wgranych wyciągów.</p>
        <p className="mt-1 text-sm text-[#e5e4e2]/50">Wgraj wyciąg (PDF i MT940) w zakładce „Wyciągi i płatności” — uzgodnienie uruchomi się po imporcie.</p>
        {onOpenStatements && (
          <button type="button" onClick={onOpenStatements} className="mt-4 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#0a0d1a] hover:bg-[#e5d799]">
            Wgraj wyciąg
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Nagłówek: firma, miesiąc, akcje */}
      <div className="rounded-xl border border-[#d3bb73]/15 bg-[#1c1f33] p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-lg font-light text-[#e5e4e2]">Uzgodnienie wyciągów</h3>
            <p className="mt-0.5 max-w-2xl text-xs leading-5 text-[#e5e4e2]/55">
              Jedna potwierdzona lista operacji z obu wyciągów (PDF i MT940). Każda operacja ma jeden status i powód.
              Pewne dopasowania system robi sam, resztę proponuje do zatwierdzenia — każdą decyzję możesz cofnąć.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {companies.length > 1 && (
              <select
                value={period?.companyId || ''}
                onChange={(e) => {
                  const next = periods.find((p) => p.companyId === e.target.value);
                  if (next) setPeriod(next);
                }}
                className="rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-2.5 py-2 text-xs text-[#e5e4e2]"
              >
                {companies.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            )}
            <div className="flex items-center rounded-lg border border-[#d3bb73]/20 bg-[#0f1119]">
              <button type="button" aria-label="Wcześniejszy miesiąc" disabled={periodIndex < 0 || periodIndex >= companyPeriods.length - 1}
                onClick={() => setPeriod(companyPeriods[periodIndex + 1])}
                className="p-2 text-[#e5e4e2]/60 hover:text-[#d3bb73] disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
              <span className="min-w-[130px] text-center text-sm capitalize text-[#e5e4e2]">
                {period ? `${MONTHS[period.month - 1]} ${period.year}` : '—'}
              </span>
              <button type="button" aria-label="Późniejszy miesiąc" disabled={periodIndex <= 0}
                onClick={() => setPeriod(companyPeriods[periodIndex - 1])}
                className="p-2 text-[#e5e4e2]/60 hover:text-[#d3bb73] disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
            </div>
            <button type="button" onClick={() => void load()} disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#d3bb73]/20 px-3 py-2 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/10 disabled:opacity-50">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Odśwież
            </button>
            {canManage && (
              <button type="button" data-crm-action="primary" onClick={() => void runReconciliation()} disabled={running || !period}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#d3bb73] px-3 py-2 text-xs font-medium text-[#0a0d1a] hover:bg-[#e5d799] disabled:opacity-50">
                {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />} Uzgodnij automatycznie
              </button>
            )}
          </div>
        </div>
        {data?.last_run && (
          <p className="mt-3 border-t border-[#d3bb73]/10 pt-3 text-xs text-[#e5e4e2]/55">
            <Sparkles className="mr-1 inline h-3.5 w-3.5 text-[#d3bb73]" />
            Ostatnie uzgodnienie {new Date(data.last_run.created_at).toLocaleString('pl-PL')}: {reconciliationRunSentence(data.last_run.summary)}
          </p>
        )}
      </div>

      {/* Źródła: dwa wyciągi → jedna lista */}
      <div className="grid gap-3 md:grid-cols-2">
        {(['regular', 'vat'] as const).map((kind) => {
          const summary = sourceSummary(kind);
          const label = kind === 'vat' ? 'Rachunek VAT' : 'Rachunek bieżący';
          if (!summary) {
            return (
              <div key={kind} className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] px-4 py-3 text-xs text-[#e5e4e2]/45">
                <span className="font-medium text-[#e5e4e2]/70">{label}:</span> brak wyciągu za ten miesiąc.
              </div>
            );
          }
          const bothFormats = summary.formats.includes('PDF') && summary.formats.includes('MT940');
          return (
            <div key={kind} className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium text-[#e5e4e2]">{label}</span>
                <span className="flex gap-1">
                  {summary.formats.map((f) => (
                    <span key={f} className="rounded bg-[#d3bb73]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#d3bb73]">{f}</span>
                  ))}
                </span>
              </div>
              <p className={`mt-1.5 text-xs ${!bothFormats || summary.unconfirmed > 0 ? 'text-amber-300' : 'text-green-400'}`}>
                {bothFormats
                  ? summary.unconfirmed > 0
                    ? `${summary.unconfirmed} operacji nie ma pary w drugim pliku — sprawdź wyciągi.`
                    : `${summary.count} operacji potwierdzonych w obu plikach.`
                  : `Wgrany tylko ${summary.formats[0]} — wgraj ${summary.formats[0] === 'PDF' ? 'MT940' : 'PDF'}, aby potwierdzić listę operacji.`}
              </p>
            </div>
          );
        })}
      </div>

      {/* Deklaracje ZUS i podatkowe tego miesiąca */}
      {data && (data.declarations || []).length > 0 && (
        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-[#e5e4e2]"><Landmark className="h-4 w-4 text-[#d3bb73]" /> ZUS i podatki</span>
            {onOpenDeclarations && (
              <button type="button" onClick={onOpenDeclarations} className="text-[11px] text-[#d3bb73] hover:underline">Rejestr deklaracji →</button>
            )}
          </div>
          <p className="mt-0.5 text-[11px] text-[#e5e4e2]/45">Deklaracje za poprzedni miesiąc i te, które mają przelew w tym wyciągu.</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {data.declarations.map((d) => (
              <li key={d.id} className="flex items-center gap-2 rounded-lg bg-[#0f1119] px-2.5 py-1.5 text-xs">
                <span className="text-[#e5e4e2]">{d.label}</span>
                <span className="text-[#e5e4e2]/50">{d.amount_due == null ? 'bez kwoty' : money(d.amount_due)} · zapłacono {money(d.paid)}</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] ${DECLARATION_STATUS_META[d.status].chip}`}>{DECLARATION_STATUS_META[d.status].label}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Umowy stałe obowiązujące w miesiącu */}
      {data && (data.contracts || []).some((c) => c.status !== 'not_due') && (() => {
        const contracts = (data.contracts || []).filter((c) => c.status !== 'not_due');
        const paid = contracts.filter((c) => c.status === 'paid').length;
        const unpaid = contracts.filter((c) => c.status === 'missing' || c.status === 'overdue');
        return (
          <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-[#e5e4e2]">
                <CalendarClock className="h-4 w-4 text-[#d3bb73]" /> Umowy stałe: {paid} {paid === 1 ? 'opłacona' : 'opłacone'}, {unpaid.length} bez płatności
              </span>
              {onOpenContracts && (
                <button type="button" onClick={onOpenContracts} className="text-[11px] text-[#d3bb73] hover:underline">Rejestr umów →</button>
              )}
            </div>
            <p className="mt-0.5 text-[11px] text-[#e5e4e2]/45">Najem, leasing, abonamenty i raty z okresem zaczynającym się w tym miesiącu.</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {contracts.map((c) => (
                <li key={c.id} className="flex items-center gap-2 rounded-lg bg-[#0f1119] px-2.5 py-1.5 text-xs">
                  <span className="text-[#e5e4e2]">{c.title}</span>
                  <span className="text-[#e5e4e2]/50">
                    {c.periods.join(', ')} · {money(c.due, c.currency)}
                    {Number(c.missing) > 0.009 && Number(c.paid_for_periods) > 0.009 ? ` · brakuje ${money(c.missing, c.currency)}` : ''}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] ${RECURRING_MONTH_STATUS_META[c.status].chip}`}>{RECURRING_MONTH_STATUS_META[c.status].label}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })()}

      {/* Statusy */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
        {RECONCILIATION_STATUS_ORDER.map((status) => {
          const meta = RECONCILIATION_STATUS_META[status];
          const active = statusFilter === status;
          return (
            <button key={status} type="button" onClick={() => setStatusFilter(active ? 'all' : status)}
              className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${active ? 'border-[#d3bb73]/60 bg-[#d3bb73]/10' : 'border-[#d3bb73]/10 bg-[#1c1f33] hover:border-[#d3bb73]/30'}`}>
              <div className={`text-[11px] ${meta.text}`}>{meta.label}</div>
              <div className="mt-0.5 text-xl font-light text-[#e5e4e2]">{counts[status].count}</div>
              <div className="text-[10px] text-[#e5e4e2]/40">{money(counts[status].amount)}</div>
            </button>
          );
        })}
      </div>

      {/* Jak działają reguły */}
      <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]">
        <button type="button" onClick={() => setShowRules((v) => !v)} className="flex w-full items-center justify-between px-4 py-2.5 text-left text-xs text-[#e5e4e2]/70">
          <span className="inline-flex items-center gap-1.5"><HelpCircle className="h-3.5 w-3.5 text-[#d3bb73]" /> Jak system uzgadnia wyciąg</span>
          <ChevronDown className={`h-4 w-4 transition-transform ${showRules ? 'rotate-180' : ''}`} />
        </button>
        {showRules && (
          <ol className="list-decimal space-y-1.5 border-t border-[#d3bb73]/10 px-8 py-3 text-xs leading-5 text-[#e5e4e2]/65">
            <li><b>Dwa wyciągi → jedna lista.</b> Operacje z PDF i MT940 są parowane po saldzie (a gdy bank inaczej ułożył operacje z jednego dnia — po kwocie i dacie). Rozliczasz zawsze jedną operację.</li>
            <li><b>Numer i kwota</b> — numer faktury w tytule i kwota równa kwocie do zapłaty: rozliczenie automatyczne. Kilka numerów, których suma równa się przelewowi — też automatycznie.</li>
            <li><b>Opłacona ręcznie</b> — faktura oznaczona ręcznie jako opłacona i przelew z jej numerem i kwotą: ręczny wpis zamienia się w powiązanie z wyciągiem.</li>
            <li><b>Płatność kartą w walucie</b> — wyciąg podaje kwotę oryginalną (np. 44,03 USD). Gdy w dokumentach spoza KSeF jest faktura w tej walucie na tę kwotę, od tego sprzedawcy i z daty płatności (±7 dni) — przypisanie automatyczne z kursem banku. Sprzedawcę rozpoznajemy po nazwie w opisie albo z wcześniejszych płatności.</li>
            <li><b>ZUS i podatki</b> — przelew do ZUS lub na mikrorachunek podatkowy z okresem w tytule („ZUS DRA 03.2026”, „N 26M03 PIT-4R”) trafia do deklaracji za ten okres w rejestrze „ZUS i podatki”. Gdy rok w tytule nie pasuje do daty przelewu — wybierasz okres.</li>
            <li><b>Umowy stałe</b> — przelew na rachunek z umowy (najem, leasing, abonament, raty) z kwotą okresu przypisuje się sam do najwcześniejszego nieopłaconego okresu w rejestrze „Umowy stałe”. Zgodny rachunek i inna kwota albo nazwa kontrahenta i kwota — propozycja do zatwierdzenia. Umowy z fakturami kontrahenta rozliczasz z fakturą.</li>
            <li><b>Zwrot płatności (bez faktury)</b> — sklep nie zrealizował zamówienia i oddał pieniądze (albo my zwróciliśmy klientowi): operacja i jedna operacja przeciwnego kierunku z tą samą pozostałą kwotą (co do grosza), datą ±45 dni (także z sąsiedniego miesiąca) i wspólną nazwą sklepu w opisie (np. „MUSICCENTER”, także rozcięta przez MT940) albo tym samym rachunkiem — propozycja pary do zatwierdzenia. Nigdy automatycznie. Ręcznie: „Powiąż ze zwrotem” — także zwrot częściowy (reszta płatności czeka na fakturę).</li>
            <li><b>Wypłaty</b> — przelew z kwotą zapisanej wypłaty, nazwiskiem lub rachunkiem odbiorcy i datą (±10 dni) łączy się z umową. Jeśli netto nie jest potwierdzone, zatwierdzenie propozycji je potwierdza.</li>
            <li><b>Bez faktury</b> — opłaty bankowe i przelewy podatkowe bez symbolu deklaracji są wyjaśniane po tytule.</li>
            <li><b>Propozycje</b> — zgodna kwota i kontrahent (NIP, rachunek znany z wcześniejszych płatności, nazwa), płatność częściowa lub zbiorcza (np. koszyk Allegro): czekają na Twoje zatwierdzenie.</li>
            <li><b>Ochrona przed podwójnym rozliczeniem</b> — operacja nie może być rozliczona ponad swoją kwotę (faktury, wypłaty, deklaracje, umowy stałe i pary zwrotu razem), a faktura ponad należność, także gdy ta sama faktura jest w KSeF i w dokumentach spoza KSeF. Robocze kopie faktur bez numeru KSeF są pomijane.</li>
            <li><b>Twoja decyzja jest ostateczna</b> — odrzucona propozycja, cofnięte dopasowanie i cofnięte wyjaśnienie nie wracają przy kolejnym uzgodnieniu. AI w panelu miesiąca może tylko podpowiadać.</li>
          </ol>
        )}
      </div>

      {/* Filtry */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex overflow-x-auto rounded-lg border border-[#d3bb73]/15 bg-[#1c1f33] p-0.5 text-xs">
          {([['todo', `Do zrobienia (${todoCount})`], ['all', `Wszystkie (${transactions.length})`]] as const).map(([key, label]) => (
            <button key={key} type="button" onClick={() => setStatusFilter(key)}
              className={`whitespace-nowrap rounded-md px-3 py-1.5 ${statusFilter === key ? 'bg-[#d3bb73] text-[#0a0d1a]' : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'}`}>{label}</button>
          ))}
        </div>
        <select value={accountFilter} onChange={(e) => setAccountFilter(e.target.value as typeof accountFilter)}
          className="rounded-lg border border-[#d3bb73]/15 bg-[#1c1f33] px-2.5 py-2 text-xs text-[#e5e4e2]">
          <option value="all">Oba rachunki</option>
          <option value="regular">Rachunek bieżący</option>
          <option value="vat">Rachunek VAT</option>
        </select>
        <button type="button" onClick={exportMissing} disabled={!data}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#d3bb73]/20 px-3 py-2 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/10 disabled:opacity-50">
          <Download className="h-3.5 w-3.5" /> Braki dokumentów (CSV)
        </button>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#e5e4e2]/35" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Szukaj: kontrahent, tytuł, kwota, numer faktury"
            className="w-full rounded-lg border border-[#d3bb73]/15 bg-[#1c1f33] py-2 pl-9 pr-3 text-xs text-[#e5e4e2] placeholder-[#e5e4e2]/35 outline-none focus:border-[#d3bb73]/40" />
        </div>
      </div>

      {/* Operacje */}
      <div className="overflow-hidden rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-sm text-[#e5e4e2]/50"><Loader2 className="mr-2 h-5 w-5 animate-spin text-[#d3bb73]" /> Wczytywanie…</div>
        ) : visible.length === 0 ? (
          <div className="py-14 text-center text-sm text-green-400">
            <CheckCircle2 className="mx-auto mb-2 h-8 w-8" />
            {statusFilter === 'todo' ? 'Wszystkie operacje tego miesiąca są rozliczone lub wyjaśnione.' : 'Brak operacji dla wybranych filtrów.'}
          </div>
        ) : (
          <ul className="divide-y divide-[#d3bb73]/10">
            {visible.map((t) => {
              const meta = RECONCILIATION_STATUS_META[t.status];
              const isOpen = OPEN_STATUSES.includes(t.status);
              return (
                <li key={t.id} className="px-4 py-3">
                  <div className="flex flex-col gap-2 md:flex-row md:items-start">
                    <div className="w-24 shrink-0 text-xs text-[#e5e4e2]/55">
                      {date(t.date)}
                      <div className="mt-0.5 text-[10px] text-[#e5e4e2]/35">{t.account_kind === 'vat' ? 'Rach. VAT' : 'Rach. bieżący'}</div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-[#e5e4e2]">{text(t.counterparty) || 'Bez nazwy kontrahenta'}</div>
                      <div className="mt-0.5 break-words text-xs text-[#e5e4e2]/55 [overflow-wrap:anywhere]">{text(t.title) || '—'}</div>
                      {t.source_description && (
                        <div className="mt-0.5 break-words text-[11px] text-[#e5e4e2]/35 [overflow-wrap:anywhere]">PDF: {text(t.source_description)}</div>
                      )}
                      {t.source_confirmation === 'unconfirmed' && (
                        <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-amber-300">
                          <AlertTriangle className="h-3 w-3" /> Tej operacji nie ma w drugim pliku wyciągu.
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-row items-center gap-3 md:flex-col md:items-end md:gap-1">
                      <span className={`text-sm font-medium ${t.direction === 'credit' ? 'text-green-400' : 'text-[#e5e4e2]'}`}>
                        {t.direction === 'credit' ? '+' : '−'}{money(t.amount, t.currency)}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${meta.chip}`}>{meta.label}</span>
                      {t.status === 'partial' && <span className="text-[10px] text-[#e5e4e2]/45">pozostało {money(t.remaining, t.currency)}</span>}
                      <button type="button" onClick={() => setDetailsFor(t)}
                        className="inline-flex items-center gap-1 text-[10px] text-[#e5e4e2]/45 hover:text-[#d3bb73]">
                        <Info className="h-3 w-3" /> Szczegóły płatności
                      </button>
                    </div>
                  </div>

                  {/* Rozliczenia */}
                  {(t.allocations.length > 0 || t.personnel.length > 0 || (t.declarations || []).length > 0 || (t.contracts || []).length > 0
                    || (t.refunds || []).length > 0) && (
                    <div className="mt-2 flex flex-wrap gap-1.5 md:pl-24">
                      {t.allocations.map((a) => (
                        <span key={a.match_id} title={(a.reasons || []).join('\n')}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-green-500/20 bg-green-500/[0.07] px-2 py-1 text-[11px] text-green-200">
                          <Check className="h-3 w-3" />
                          {sourceLabel(a.source)} {a.number || 'dokument'} · {money(a.amount, t.currency)}{foreign(a.document_amount, a.document_currency, a.exchange_rate)} · {matchMethodLabel(a.method)}
                          {Number(a.doc_open || 0) > 0.009 && (
                            <span className="text-amber-200" title={documentFacts({ kind: a.doc_kind, issueDate: a.issue_date, dueDate: a.due_date, status: a.doc_status, due: a.doc_due, paid: a.doc_paid, manualPaid: a.doc_manual }, t.currency)}>
                              · faktura częściowo opłacona, pozostało {money(a.doc_open, t.currency)}
                            </span>
                          )}
                          {isPreviewableDocumentSource(a.source) && a.document_id && (
                            <button type="button" title="Podgląd dokumentu" disabled={previewOpening === a.document_id}
                              onClick={() => void openPreview(a.source as 'ksef' | 'invoice' | 'external', a.document_id, a.number)}
                              className="ml-0.5 text-green-200/60 hover:text-[#d3bb73]"><Eye className="h-3 w-3" /></button>
                          )}
                          {canManage && (
                            <button type="button" disabled={busyKey === `undo:${a.match_id}`} title="Cofnij dopasowanie"
                              onClick={() => void callAction(`undo:${a.match_id}`, () => supabase.rpc('undo_bank_match', { p_transaction_id: t.id, p_match_id: a.match_id }), 'Dopasowanie cofnięte. Ten dokument nie zostanie ponownie przypisany automatycznie.')}
                              className="ml-0.5 text-green-200/60 hover:text-red-300"><Undo2 className="h-3 w-3" /></button>
                          )}
                        </span>
                      ))}
                      {t.personnel.map((p) => (
                        <span key={p.id} title={(p.reasons || []).join('\n')}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-green-500/20 bg-green-500/[0.07] px-2 py-1 text-[11px] text-green-200">
                          <Check className="h-3 w-3" />
                          Wypłata: {p.recipient}{p.contract_number ? ` (umowa ${p.contract_number})` : ''} · {money(p.amount, t.currency)} · {matchMethodLabel(p.method)}
                          {canManage && (
                            <button type="button" disabled={busyKey === `undo-p:${p.id}`} title="Odepnij wypłatę"
                              onClick={() => void callAction(`undo-p:${p.id}`, () => supabase.rpc('undo_bank_personnel_payment', { p_transaction_id: t.id, p_payment_id: p.id }), 'Wypłata odpięta. Nie zostanie powiązana ponownie automatycznie.')}
                              className="ml-0.5 text-green-200/60 hover:text-red-300"><Undo2 className="h-3 w-3" /></button>
                          )}
                        </span>
                      ))}
                      {(t.declarations || []).map((d) => (
                        <span key={d.payment_id} title={(d.reasons || []).join('\n')}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-green-500/20 bg-green-500/[0.07] px-2 py-1 text-[11px] text-green-200">
                          <Landmark className="h-3 w-3" />
                          {d.label} · {money(d.amount, t.currency)} · {matchMethodLabel(d.method)}
                          <span className={`rounded-full px-1.5 py-px text-[9px] ${DECLARATION_STATUS_META[d.status].chip}`}>{DECLARATION_STATUS_META[d.status].label}</span>
                          {canManage && (
                            <button type="button" disabled={busyKey === `undo-d:${d.payment_id}`} title="Odepnij od deklaracji"
                              onClick={() => void callAction(`undo-d:${d.payment_id}`, () => supabase.rpc('undo_bank_declaration_payment', { p_payment_id: d.payment_id }), 'Przelew odpięty od deklaracji. Nie zostanie przypięty ponownie automatycznie.')}
                              className="ml-0.5 text-green-200/60 hover:text-red-300"><Undo2 className="h-3 w-3" /></button>
                          )}
                        </span>
                      ))}
                      {(t.contracts || []).map((c) => (
                        <span key={c.payment_id} title={(c.reasons || []).join('\n')}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-green-500/20 bg-green-500/[0.07] px-2 py-1 text-[11px] text-green-200">
                          <CalendarClock className="h-3 w-3" />
                          Umowa: {c.title} · {c.period_label} · {money(c.amount, t.currency)} · {matchMethodLabel(c.method)}
                          {Number(c.period_paid) < Number(c.period_amount) - 0.009 && (
                            <span className="text-amber-200">· okres opłacony w części: {money(c.period_paid, t.currency)} z {money(c.period_amount, t.currency)}</span>
                          )}
                          {canManage && (
                            <button type="button" disabled={busyKey === `undo-c:${c.payment_id}`} title="Odepnij od umowy"
                              onClick={() => void callAction(`undo-c:${c.payment_id}`, () => supabase.rpc('undo_bank_recurring_contract_payment', { p_payment_id: c.payment_id }), 'Przelew odpięty od umowy. Nie zostanie przypięty ponownie automatycznie.')}
                              className="ml-0.5 text-green-200/60 hover:text-red-300"><Undo2 className="h-3 w-3" /></button>
                          )}
                        </span>
                      ))}
                      {(t.refunds || []).map((r) => (
                        <span key={r.pair_id} title={(r.reasons || []).join('\n')}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-green-500/20 bg-green-500/[0.07] px-2 py-1 text-[11px] text-green-200">
                          <RotateCcw className="h-3 w-3" />
                          {refundCounterpartLabel(refundOtherRole(r.role))}: {directionSign(r.other.direction)}{money(r.other.amount, r.other.currency)} z {shortDate(r.other.date, period?.year)}
                          {r.other.counterparty ? ` · ${text(r.other.counterparty)}` : ''}
                          {Math.abs(Number(r.amount) - Number(r.other.amount)) > 0.009 || Math.abs(Number(r.amount) - Number(t.amount)) > 0.009
                            ? <span className="text-amber-200">· para {money(r.amount, t.currency)}{r.role === 'payment' && Number(r.amount) < Number(t.amount) - 0.009 ? ' (zwrot częściowy)' : ''}</span> : null}
                          {' · '}{matchMethodLabel(r.method)}
                          <button type="button" title="Szczegóły drugiej operacji" onClick={() => setDetailsOther({ id: r.other.id, statement_id: r.other.statement_id })}
                            className="ml-0.5 text-green-200/60 hover:text-[#d3bb73]"><Info className="h-3 w-3" /></button>
                          {canManage && (
                            <button type="button" disabled={busyKey === `undo-r:${r.pair_id}`} title="Cofnij powiązanie płatności ze zwrotem"
                              onClick={() => void callAction(`undo-r:${r.pair_id}`, () => supabase.rpc('undo_bank_refund_pair', { p_pair_id: r.pair_id }), 'Powiązanie cofnięte. Obie operacje wracają do rozliczenia, a ta para nie zostanie zaproponowana ponownie.')}
                              className="ml-0.5 text-green-200/60 hover:text-red-300"><Undo2 className="h-3 w-3" /></button>
                          )}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Wyjaśnienie bez faktury */}
                  {t.explanation && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-teal-200 md:pl-24">
                      <span className="rounded-lg border border-teal-500/20 bg-teal-500/[0.07] px-2 py-1">
                        {explanationLabel(t.explanation.category, t.explanation.subtype)}
                        {' · '}{t.explanation.by?.startsWith('rule:') ? 'reguła automatyczna' : 'wyjaśnione ręcznie'}
                        {t.explanation.note ? ` — ${t.explanation.note}` : ''}
                      </span>
                      {canManage && t.status === 'explained' && t.explanation.category === 'tax_or_zus' && t.remaining > 0.009 && t.direction === 'debit' && (
                        <button type="button" onClick={() => setDeclarationFor(t)}
                          className="inline-flex items-center gap-1 text-teal-200/80 hover:text-[#d3bb73]"><Link2 className="h-3 w-3" /> Przypisz do deklaracji</button>
                      )}
                      {canManage && t.status !== 'transfer' && (
                        <button type="button" disabled={busyKey === `clear:${t.id}`}
                          onClick={() => void callAction(`clear:${t.id}`, () => supabase.rpc('clear_bank_transaction_explanation', { p_transaction_id: t.id }), 'Wyjaśnienie cofnięte.')}
                          className="inline-flex items-center gap-1 text-teal-200/60 hover:text-red-300"><Undo2 className="h-3 w-3" /> Cofnij</button>
                      )}
                    </div>
                  )}

                  {/* Propozycja / wskazówka */}
                  {t.proposal && t.proposal.kind !== 'hint' && (
                    <div className="mt-2 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] p-3 md:ml-24">
                      <div className="text-[11px] font-medium text-amber-200">{proposalRuleLabel(t.proposal.rule)}</div>
                      <p className="mt-0.5 text-xs leading-5 text-[#e5e4e2]/75">{t.proposal.reason}</p>
                      <div className="mt-2 space-y-1">
                        {t.proposal.documents.map((doc, index) => {
                          const facts = doc.source === 'refund'
                            ? refundFacts(doc, t.currency, period)
                            : documentFacts({ kind: doc.doc_kind, issueDate: doc.issue_date, dueDate: doc.due_date, status: doc.payment_status, due: doc.due, paid: doc.paid, manualPaid: doc.manual_paid, manualDate: doc.manual_date }, t.currency);
                          return (
                          <div key={`${doc.id || doc.number}:${index}`} className={`rounded-md px-1.5 py-1 ${doc.suggested ? 'bg-green-500/[0.06] ring-1 ring-green-500/20' : ''}`}>
                          <label className="flex flex-wrap items-center gap-2 text-xs text-[#e5e4e2]/80">
                            {t.proposal!.kind === 'choose' && (
                              <input type="radio" name={`choice-${t.proposal!.id}`} checked={choice[t.proposal!.id] === index}
                                onChange={() => setChoice((c) => ({ ...c, [t.proposal!.id]: index }))} />
                            )}
                            <span className="rounded bg-[#0f1119] px-1.5 py-0.5 text-[10px] text-[#e5e4e2]/60">{sourceLabel(doc.source)}</span>
                            <span className="font-medium">{doc.number || 'Dokument bez numeru'}</span>
                            <span className="truncate text-[#e5e4e2]/50">{doc.party}</span>
                            <span className="ml-auto whitespace-nowrap">{money(doc.amount, t.currency)}{foreign(doc.document_amount, doc.document_currency, doc.rate)}</span>
                            {doc.manual && <span className="whitespace-nowrap text-[10px] text-amber-200/80">opłacona ręcznie</span>}
                            {doc.source === 'declaration' && !doc.id && <span className="whitespace-nowrap text-[10px] text-amber-200/80">deklaracja zostanie założona</span>}
                            {doc.source === 'contract' && doc.period_label && (
                              <span className="whitespace-nowrap rounded bg-[#d3bb73]/10 px-1.5 py-0.5 text-[10px] text-[#d3bb73]">
                                okres {doc.period_label}{doc.contract_amount != null && Math.abs(Number(doc.contract_amount) - Number(doc.amount)) > 0.009 ? ` (z ${money(doc.contract_amount, t.currency)})` : ''}
                              </span>
                            )}
                            {doc.confirm_net && <span className="whitespace-nowrap text-[10px] text-amber-200/80">netto do potwierdzenia</span>}
                            {doc.source === 'refund' && doc.id && doc.statement_id && (
                              <button type="button"
                                onClick={(event) => { event.preventDefault(); setDetailsOther({ id: doc.id!, statement_id: doc.statement_id! }); }}
                                className="inline-flex items-center gap-1 whitespace-nowrap rounded border border-[#d3bb73]/20 px-1.5 py-0.5 text-[10px] text-[#d3bb73] hover:bg-[#d3bb73]/10">
                                <Info className="h-3 w-3" /> Szczegóły płatności
                              </button>
                            )}
                            {isPreviewableDocumentSource(doc.source) && doc.id && (
                              <button type="button" disabled={previewOpening === doc.id}
                                onClick={(event) => { event.preventDefault(); void openPreview(doc.source as 'ksef' | 'invoice' | 'external', doc.id!, doc.number); }}
                                className="inline-flex items-center gap-1 whitespace-nowrap rounded border border-[#d3bb73]/20 px-1.5 py-0.5 text-[10px] text-[#d3bb73] hover:bg-[#d3bb73]/10 disabled:opacity-50">
                                <Eye className="h-3 w-3" /> Podgląd
                              </button>
                            )}
                          </label>
                          {facts && <p className={`mt-0.5 text-[11px] text-[#e5e4e2]/50 ${t.proposal!.kind === 'choose' ? 'pl-6' : ''}`}>{facts}</p>}
                          {doc.hint && (
                            <p className={`mt-0.5 flex items-start gap-1 text-[11px] ${doc.suggested ? 'text-green-300' : 'text-[#e5e4e2]/50'} ${t.proposal!.kind === 'choose' ? 'pl-6' : ''}`}>
                              <Info className="mt-0.5 h-3 w-3 shrink-0" />{doc.suggested ? 'Sugerowany: ' : ''}{doc.hint}
                            </p>
                          )}
                          </div>
                          );
                        })}
                      </div>
                      {canManage && (
                        <div className="mt-2.5 flex gap-2">
                          <button type="button" disabled={busyKey === `accept:${t.id}`} onClick={() => acceptProposal(t)}
                            className="inline-flex items-center gap-1 rounded-lg bg-[#d3bb73] px-3 py-1.5 text-xs font-medium text-[#0a0d1a] hover:bg-[#e5d799] disabled:opacity-50">
                            <Check className="h-3.5 w-3.5" /> {t.proposal.documents.some((doc) => doc.confirm_net)
                              ? (t.proposal.kind === 'choose' ? 'Potwierdź netto i powiąż wybraną' : 'Potwierdź netto i powiąż')
                              : t.proposal.rule === 'zwrot_platnosci'
                                ? (t.proposal.kind === 'choose' ? 'Zatwierdź wybraną parę' : 'Zatwierdź parę')
                                : t.proposal.kind === 'choose' ? 'Zatwierdź wybrany' : 'Zatwierdź'}
                          </button>
                          <button type="button" disabled={busyKey === `reject:${t.id}`} onClick={() => rejectProposal(t)}
                            className="inline-flex items-center gap-1 rounded-lg border border-[#e5e4e2]/15 px-3 py-1.5 text-xs text-[#e5e4e2]/70 hover:bg-white/5 disabled:opacity-50">
                            <X className="h-3.5 w-3.5" /> Odrzuć
                          </button>
                          <button type="button" disabled={busyKey === `reject:${t.id}`} onClick={() => rejectProposal(t, true)}
                            title={t.proposal.rule === 'zwrot_platnosci'
                              ? 'Odrzuć tę parę i od razu wybierz właściwą drugą operację (zwrot lub płatność)'
                              : 'Odrzuć tę propozycję i od razu wybierz właściwy dokument dla tej płatności'}
                            className="inline-flex items-center gap-1 rounded-lg border border-[#d3bb73]/25 px-3 py-1.5 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/10 disabled:opacity-50">
                            <FileSearch className="h-3.5 w-3.5" /> {t.proposal.rule === 'zwrot_platnosci' ? 'Odrzuć i wybierz inną operację' : 'Odrzuć i wybierz inny'}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  {t.proposal?.kind === 'hint' && (
                    <div className="mt-2 flex items-start gap-1.5 text-xs text-[#e5e4e2]/55 md:pl-24">
                      <FileQuestion className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#e5e4e2]/40" /> {t.proposal.reason}
                    </div>
                  )}

                  {/* Akcje ręczne */}
                  {canManage && isOpen && (
                    <div className="mt-2 flex flex-wrap gap-2 md:pl-24">
                      <button type="button" onClick={() => setPickerFor(t)}
                        className="inline-flex items-center gap-1 rounded-lg border border-[#d3bb73]/25 px-2.5 py-1 text-[11px] text-[#d3bb73] hover:bg-[#d3bb73]/10">
                        <FileSearch className="h-3.5 w-3.5" /> Wybierz dokument
                      </button>
                      <button type="button" onClick={() => setExplainFor(t)}
                        className="inline-flex items-center gap-1 rounded-lg border border-[#e5e4e2]/15 px-2.5 py-1 text-[11px] text-[#e5e4e2]/70 hover:bg-white/5">
                        <ArrowLeftRight className="h-3.5 w-3.5" /> Wyjaśnij bez faktury
                      </button>
                      {t.direction === 'credit' && isCashDeposit(t) && (
                        <button type="button" onClick={() => setExplainFor(t)}
                          className="inline-flex items-center gap-1 rounded-lg border border-[#d3bb73]/25 px-2.5 py-1 text-[11px] text-[#d3bb73] hover:bg-[#d3bb73]/10">
                          <ArrowLeftRight className="h-3.5 w-3.5" /> Wpłata własna
                        </button>
                      )}
                      <button type="button" onClick={() => setContractFor(t)}
                        className="inline-flex items-center gap-1 rounded-lg border border-[#e5e4e2]/15 px-2.5 py-1 text-[11px] text-[#e5e4e2]/70 hover:bg-white/5">
                        <CalendarClock className="h-3.5 w-3.5" /> Przypisz do umowy (najem / abonament)
                      </button>
                      <button type="button" onClick={() => setRefundFor(t)}
                        title={t.direction === 'debit'
                          ? 'Sklep lub kontrahent zwrócił pieniądze bez faktury — powiąż tę płatność z wpływem zwrotu'
                          : 'To zwrot wcześniejszej płatności (albo nasza płatność zwrócona klientowi) — powiąż z drugą operacją'}
                        className="inline-flex items-center gap-1 rounded-lg border border-[#e5e4e2]/15 px-2.5 py-1 text-[11px] text-[#e5e4e2]/70 hover:bg-white/5">
                        <RotateCcw className="h-3.5 w-3.5" /> Powiąż ze zwrotem
                      </button>
                      {t.direction === 'debit' && (
                        <button type="button" onClick={() => setDeclarationFor(t)}
                          className="inline-flex items-center gap-1 rounded-lg border border-[#e5e4e2]/15 px-2.5 py-1 text-[11px] text-[#e5e4e2]/70 hover:bg-white/5">
                          <Link2 className="h-3.5 w-3.5" /> Przypisz do deklaracji (ZUS / podatek)
                        </button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Strona faktur */}
      {data && (
        <div className="grid gap-3 xl:grid-cols-3">
          <DocumentList
            title="Opłacone ręcznie, bez potwierdzenia w wyciągu"
            hint="Faktury oznaczone jako opłacone w tym miesiącu, których płatności nie ma na wyciągu. Sprawdź, czy zapłacono gotówką lub z innego rachunku."
            empty="Każda ręcznie opłacona faktura ma potwierdzenie w wyciągu."
            rows={data.paid_without_statement.map((d) => ({
              key: `${d.source}:${d.id}`, label: `${sourceLabel(d.source)} ${d.number || ''}`, party: d.party,
              amount: d.manual_paid, currency: d.currency || 'PLN', note: `opłacona ${date(d.payment_date)} · ${d.side === 'issued' ? 'sprzedaż' : 'koszt'}`,
            }))}
          />
          <DocumentList
            title="Nieopłacone z terminem do końca miesiąca"
            hint="Faktury bez płatności z wyciągu i bez ręcznego oznaczenia, z terminem płatności w tym miesiącu lub wcześniej (do 6 miesięcy wstecz)."
            empty="Brak zaległych faktur."
            rows={data.unpaid_due.map((d) => ({
              key: `${d.source}:${d.id}`, label: `${sourceLabel(d.source)} ${d.number || ''}`, party: d.party,
              amount: d.open, currency: d.currency || 'PLN', note: `termin ${date(d.due_date || d.issue_date)} · ${d.side === 'issued' ? 'należność' : 'zobowiązanie'}`,
            }))}
          />
          <DocumentList
            title="Robocze kopie faktur (pomijane)"
            hint="Wpisy KSeF bez numeru KSeF obok tej samej faktury z numerem. Nie są rozliczane i nie liczą się do należności — można je usunąć w zakładce KSeF."
            empty="Brak roboczych kopii."
            rows={data.shadow_documents.map((d) => ({
              key: d.id, label: d.number || 'bez numeru', party: d.party, amount: d.due, note: `wystawiona ${date(d.issue_date)}`,
            }))}
          />
        </div>
      )}

      {pickerFor && (
        <BankTransactionDocumentPickerModal
          transaction={{
            id: pickerFor.id, transaction_date: pickerFor.date, amount: pickerFor.amount, currency: pickerFor.currency,
            transaction_type: pickerFor.direction, counterparty_name: text(pickerFor.counterparty), title: text(pickerFor.title),
            allocated_amount: pickerFor.allocated,
          }}
          onClose={() => setPickerFor(null)}
          onMatched={async () => { setPickerFor(null); await load(); }}
        />
      )}
      {detailsFor && period && (
        <BankTransactionDetailsModal
          transaction={{ id: detailsFor.id, company_id: period.companyId, statement_id: detailsFor.statement_id }}
          onClose={() => setDetailsFor(null)}
          onMatchDocuments={canManage && OPEN_STATUSES.includes(detailsFor.status) ? () => { const target = detailsFor; setDetailsFor(null); setPickerFor(target); } : undefined}
        />
      )}
      {previewModal}
      {declarationFor && period && (
        <DeclarationLinkModal
          companyId={period.companyId}
          transaction={{ id: declarationFor.id, date: declarationFor.date, amount: declarationFor.amount, remaining: declarationFor.remaining, title: text(declarationFor.title) }}
          onClose={() => setDeclarationFor(null)}
          onLinked={async () => { setDeclarationFor(null); await load(); }}
        />
      )}
      {contractFor && period && (
        <RecurringContractLinkModal
          companyId={period.companyId}
          transaction={{
            id: contractFor.id, date: contractFor.date, amount: contractFor.amount, remaining: contractFor.remaining,
            title: text(contractFor.title), counterparty: text(contractFor.counterparty), counterparty_account: contractFor.counterparty_account,
            direction: contractFor.direction, currency: contractFor.currency,
          }}
          onClose={() => setContractFor(null)}
          onLinked={async () => { setContractFor(null); await load(); }}
        />
      )}
      {refundFor && period && (
        <BankRefundPairModal
          companyId={period.companyId}
          transaction={{
            id: refundFor.id, statement_id: refundFor.statement_id, date: refundFor.date, amount: refundFor.amount,
            remaining: refundFor.remaining, direction: refundFor.direction, currency: refundFor.currency,
            counterparty: text(refundFor.counterparty), title: text(refundFor.title),
          }}
          onClose={() => setRefundFor(null)}
          onLinked={async () => { setRefundFor(null); await load(); }}
        />
      )}
      {detailsOther && period && (
        <BankTransactionDetailsModal
          transaction={{ id: detailsOther.id, company_id: period.companyId, statement_id: detailsOther.statement_id }}
          onClose={() => setDetailsOther(null)}
        />
      )}
      {explainFor && period && (
        <BankTransactionAccountingModal
          transaction={{
            id: explainFor.id, statement_id: explainFor.statement_id, company_id: period.companyId,
            transaction_date: explainFor.date, amount: explainFor.amount, currency: explainFor.currency,
            transaction_type: explainFor.direction, counterparty_name: text(explainFor.counterparty), title: text(explainFor.title),
            accounting_note: explainFor.explanation?.note ?? null,
          }}
          initialSubtype={explainFor.direction === 'credit' && isCashDeposit(explainFor) ? 'owner_deposit' : 'other'}
          onClose={() => setExplainFor(null)}
          onSaved={async () => { setExplainFor(null); await load(); }}
        />
      )}
    </div>
  );
}

function DocumentList({ title, hint, empty, rows }: {
  title: string;
  hint: string;
  empty: string;
  rows: Array<{ key: string; label: string; party?: string | null; amount: number; currency?: string; note: string }>;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? rows : rows.slice(0, 6);
  return (
    <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-4">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-medium text-[#e5e4e2]">{title}</h4>
        <span className="rounded-full bg-[#d3bb73]/10 px-2 py-0.5 text-[11px] text-[#d3bb73]">{rows.length}</span>
      </div>
      <p className="mt-1 text-[11px] leading-4 text-[#e5e4e2]/45">{hint}</p>
      {rows.length === 0 ? (
        <p className="mt-3 text-xs text-green-400">{empty}</p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {shown.map((row) => (
            <li key={row.key} className="flex items-start justify-between gap-2 text-xs">
              <div className="min-w-0">
                <div className="truncate text-[#e5e4e2]/85">{row.label}</div>
                <div className="truncate text-[10px] text-[#e5e4e2]/40">{row.party ? `${row.party} · ` : ''}{row.note}</div>
              </div>
              <span className="whitespace-nowrap text-[#e5e4e2]/80">{money(row.amount, row.currency)}</span>
            </li>
          ))}
        </ul>
      )}
      {rows.length > 6 && (
        <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-2 text-[11px] text-[#d3bb73] hover:underline">
          {expanded ? 'Pokaż mniej' : `Pokaż wszystkie (${rows.length})`}
        </button>
      )}
    </div>
  );
}
