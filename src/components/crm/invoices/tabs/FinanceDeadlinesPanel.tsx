'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  BellRing,
  CalendarClock,
  CheckCircle2,
  Landmark,
  Loader2,
  Mail,
  RefreshCw,
  Save,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useInvoiceFinanceAccess } from '@/hooks/useInvoiceFinanceAccess';
import { canFinanceCompany, filterFinanceCompanies } from '@/lib/invoices/financeAccess';
import SendInvoiceEmailModal from '@/components/crm/SendInvoiceEmailModal';

/**
 * Sekcja „Terminy” (Dokumenty i rozliczenia): kalendarz obowiązków ZUS i podatkowych, należności z monitami do
 * klientów i zobowiązania do zapłaty (z terminem dostawcy dla faktur bez terminu w KSeF). Dane: get_finance_deadlines
 * (migracja 20261117130000_finance_deadlines.sql); przypomnienia w powiadomieniach wysyła baza o 8:05.
 */

const card = 'rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]';
const input = 'rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-2.5 py-1.5 text-xs text-[#e5e4e2] outline-none focus:border-[#d3bb73]/50';
const ghost = 'inline-flex items-center gap-1 rounded-lg border border-[#d3bb73]/25 px-2.5 py-1 text-[11px] text-[#d3bb73] hover:bg-[#d3bb73]/10 disabled:opacity-50';
const th = 'px-3 py-2 text-left text-[10px] font-medium uppercase tracking-wide text-[#e5e4e2]/45';
const td = 'px-3 py-2 align-top text-xs text-[#e5e4e2]/85';

const money = (value: number | string | null | undefined, currency = 'PLN') =>
  `${Number(value || 0).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency === 'PLN' ? 'zł' : currency}`;
const date = (value?: string | null) => (value ? new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('pl-PL') : '—');
const daysBetween = (from: string, to: string) =>
  Math.round((new Date(`${to.slice(0, 10)}T12:00:00`).getTime() - new Date(`${from.slice(0, 10)}T12:00:00`).getTime()) / 86_400_000);
const dayWord = (days: number) => (Math.abs(days) === 1 ? 'dzień' : 'dni');

type ObligationStatus = 'paid' | 'paid_no_amount' | 'partial' | 'unpaid' | 'unconfirmed';

interface Obligation {
  kind: string;
  form: string;
  period_kind: 'month' | 'quarter' | 'year';
  period_start: string;
  label: string;
  setting_label: string | null;
  due_date: string;
  declaration_id: string | null;
  amount_due: number | null;
  paid: number;
  status: ObligationStatus;
  overdue: boolean;
  amount_missing: boolean;
}

interface Receivable {
  source: 'local' | 'ksef';
  id: string;
  invoice_id: string | null;
  invoice_number: string;
  buyer_name: string | null;
  buyer_email: string | null;
  issue_date: string | null;
  due_date: string;
  gross: number;
  outstanding: number;
  currency: string;
  pdf_url: string | null;
  in_ksef: boolean;
  days_overdue: number;
  reminders: number;
  last_reminder_at: string | null;
}

interface Payable {
  id: string;
  invoice_number: string;
  seller_name: string | null;
  seller_nip: string | null;
  issue_date: string | null;
  due_date: string | null;
  due_source: 'manual' | 'supplier_default' | null;
  amount: number;
  currency: string;
  bank_account: string | null;
  days_left: number | null;
  supplier_days: number | null;
}

type WhitelistVerdict = 'ok' | 'not_listed' | 'not_found' | 'no_account' | 'error';

interface WhitelistPayable {
  ksef_invoice_id: string;
  nip: string | null;
  account: string | null;
  gross: number;
  verdict: WhitelistVerdict | null;
  status_vat: string | null;
  check_date: string | null;
  request_id: string | null;
  fresh: boolean;
}

interface WhitelistPayment {
  bank_transaction_id: string;
  document_number: string | null;
  seller_name: string | null;
  nip: string | null;
  account: string | null;
  transaction_date: string;
  amount: number;
  document_gross: number;
  verdict: WhitelistVerdict | null;
  status_vat: string | null;
  request_id: string | null;
}

interface WhitelistStatus {
  today: string;
  payables: WhitelistPayable[];
  payments: WhitelistPayment[];
}

/** Ocena białej listy VAT do wyświetlenia (próg 15 000 zł — wartość transakcji). */
function whitelistChip(row: { verdict: WhitelistVerdict | null; status_vat: string | null; nip: string | null }, fresh: boolean, big: boolean) {
  if (!row.nip) return { text: 'bez polskiego NIP — nie dotyczy', className: 'bg-white/5 text-[#e5e4e2]/45' };
  if (!row.verdict) return { text: big ? 'niesprawdzone — ponad 15 000 zł' : 'niesprawdzone', className: big ? 'bg-amber-500/15 text-amber-300' : 'bg-white/10 text-[#e5e4e2]/55' };
  if (row.verdict === 'error') return { text: 'błąd sprawdzenia — powtórz', className: 'bg-white/10 text-[#e5e4e2]/55' };
  if (row.verdict === 'not_found') return { text: 'NIP poza wykazem VAT', className: 'bg-red-500/15 text-red-300' };
  if (row.verdict === 'not_listed') return { text: 'rachunku nie ma na białej liście', className: 'bg-red-500/15 text-red-300' };
  if (row.verdict === 'no_account') return { text: `faktura bez rachunku · VAT: ${row.status_vat || '—'}`, className: 'bg-white/10 text-[#e5e4e2]/60' };
  return fresh
    ? { text: `na białej liście${row.status_vat && row.status_vat !== 'Czynny' ? ` · VAT: ${row.status_vat}` : ''}`, className: 'bg-emerald-500/15 text-emerald-300' }
    : { text: 'na liście — sprawdź w dniu przelewu', className: 'bg-amber-500/15 text-amber-300' };
}

interface ObligationSetting {
  kind: string;
  form: string;
  period_kind: 'month' | 'quarter' | 'year';
  enabled: boolean;
  due_day: number;
  due_month_offset: number;
  label: string | null;
}

interface Deadlines {
  today: string;
  statement_end: string | null;
  obligations: Obligation[];
  receivables: Receivable[];
  payables: Payable[];
  supplier_terms: Array<{ seller_nip: string; seller_name: string | null; days: number }>;
  settings: ObligationSetting[];
}

/** Obowiązki proponowane w ustawieniach (spółka); działalność włącza te, które ją dotyczą. */
const DEFAULT_OBLIGATIONS: ObligationSetting[] = [
  { kind: 'zus', form: 'DRA', period_kind: 'month', enabled: false, due_day: 15, due_month_offset: 1, label: 'ZUS (DRA)' },
  { kind: 'pit', form: 'PIT-4R', period_kind: 'month', enabled: false, due_day: 20, due_month_offset: 1, label: 'Zaliczki PIT od wynagrodzeń (PIT-4R)' },
  { kind: 'cit', form: 'CIT-8', period_kind: 'month', enabled: false, due_day: 20, due_month_offset: 1, label: 'Zaliczka CIT' },
  { kind: 'vat', form: 'VAT-7', period_kind: 'month', enabled: false, due_day: 25, due_month_offset: 1, label: 'VAT i JPK_V7M' },
  { kind: 'cit', form: 'CIT-8', period_kind: 'year', enabled: false, due_day: 31, due_month_offset: 3, label: 'Zeznanie CIT-8 i dopłata podatku' },
];

const PERIOD_LABELS: Record<ObligationSetting['period_kind'], string> = { month: 'co miesiąc', quarter: 'co kwartał', year: 'co rok' };
const settingKey = (s: Pick<ObligationSetting, 'kind' | 'form' | 'period_kind'>) => `${s.kind}|${s.form}|${s.period_kind}`;

function obligationChip(o: Obligation, today: string) {
  if (o.status === 'paid') return { text: 'Zapłacone', className: 'bg-emerald-500/15 text-emerald-300' };
  if (o.status === 'paid_no_amount') return { text: 'Zapłacone · brak kwoty z deklaracji', className: 'bg-amber-500/15 text-amber-300' };
  if (o.status === 'unconfirmed') return { text: 'Brak wyciągu — nie da się potwierdzić', className: 'bg-white/10 text-[#e5e4e2]/60' };
  if (o.overdue) return { text: o.status === 'partial' ? 'Częściowo · po terminie' : 'Po terminie', className: 'bg-red-500/15 text-red-300' };
  if (o.status === 'partial') return { text: 'Zapłacone częściowo', className: 'bg-amber-500/15 text-amber-300' };
  const left = daysBetween(today, o.due_date);
  if (left <= 3) return { text: left <= 0 ? 'Termin dziś' : `Termin za ${left} ${dayWord(left)}`, className: 'bg-amber-500/15 text-amber-300' };
  return { text: 'Do zapłaty', className: 'bg-white/10 text-[#e5e4e2]/70' };
}

interface Company { id: string; name: string }

interface Props {
  filterCompanyIds?: string[] | null;
  /** Przejście do „ZUS i podatki” (uzupełnienie kwoty, plik deklaracji). */
  onOpenDeclarations?: () => void;
  /** Przejście do uzgodnienia wyciągu (przypisanie przelewu). */
  onOpenReconciliation?: () => void;
}

export default function FinanceDeadlinesPanel({ filterCompanyIds = null, onOpenDeclarations, onOpenReconciliation }: Props) {
  const { showSnackbar } = useSnackbar();
  const { access } = useInvoiceFinanceAccess();

  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [data, setData] = useState<Deadlines | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<ObligationSetting[]>([]);
  const [dueEdit, setDueEdit] = useState<{ id: string; date: string; remember: boolean } | null>(null);
  const [reminder, setReminder] = useState<Receivable | null>(null);
  const [whitelist, setWhitelist] = useState<WhitelistStatus | null>(null);
  const [checkingWhitelist, setCheckingWhitelist] = useState<'payables' | 'payments' | null>(null);
  const [showPaidObligations, setShowPaidObligations] = useState(false);

  const canManage = canFinanceCompany(access, companyId, 'finance_manage');
  const canRemind = canFinanceCompany(access, companyId, 'invoices_issue');
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
    const [deadlines, whitelistResult] = await Promise.all([
      supabase.rpc('get_finance_deadlines', { p_company_id: companyId }),
      supabase.rpc('get_vat_whitelist_status', { p_company_id: companyId }),
    ]);
    if (deadlines.error) { showSnackbar(deadlines.error.message || 'Nie udało się wczytać terminów.', 'error'); setData(null); }
    else setData(deadlines.data as Deadlines);
    // Biała lista jest dodatkiem — jej błąd nie blokuje terminów.
    setWhitelist(whitelistResult.error ? null : (whitelistResult.data as WhitelistStatus));
    setLoading(false);
  }, [companyId, showSnackbar]);

  const whitelistByInvoice = useMemo(
    () => new Map((whitelist?.payables || []).map((row) => [row.ksef_invoice_id, row])),
    [whitelist],
  );

  const runWhitelistCheck = async (mode: 'payables' | 'payments') => {
    if (!companyId || checkingWhitelist) return;
    setCheckingWhitelist(mode);
    try {
      const response = await fetch('/bridge/finance/vat-whitelist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, mode }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result) {
        showSnackbar(result?.error || 'Nie udało się sprawdzić białej listy.', 'error');
        return;
      }
      const summary = result.summary || {};
      const bad = Number(summary.not_listed || 0) + Number(summary.not_found || 0);
      if (result.checked === 0 && !result.error) {
        showSnackbar(mode === 'payables' ? 'Wszystkie faktury do zapłaty były już dziś sprawdzone.' : 'Brak przelewów do sprawdzenia.', 'info');
      } else {
        showSnackbar(
          `Sprawdzono ${result.checked}: na liście ${summary.ok || 0}${bad ? `, problem: ${bad}` : ''}${summary.no_account ? `, bez rachunku: ${summary.no_account}` : ''}.`,
          bad ? 'warning' : 'success',
        );
      }
      if (result.error) showSnackbar(result.error, 'warning');
      await load();
    } catch {
      showSnackbar('Nie udało się połączyć z serwerem CRM.', 'error');
    } finally {
      setCheckingWhitelist(null);
    }
  };

  useEffect(() => { void load(); }, [load]);

  const today = data?.today || new Date().toISOString().slice(0, 10);
  const obligations = useMemo(() => {
    const rows = data?.obligations || [];
    return showPaidObligations ? rows : rows.filter((o) => !['paid', 'paid_no_amount'].includes(o.status) || o.due_date >= today);
  }, [data, showPaidObligations, today]);
  const attention = useMemo(() => ({
    obligations: (data?.obligations || []).filter((o) => o.overdue).length,
    receivables: (data?.receivables || []).filter((r) => r.days_overdue > 0),
    payables: (data?.payables || []).filter((p) => p.due_date && p.due_date < today),
    noDue: (data?.payables || []).filter((p) => !p.due_date).length,
  }), [data, today]);
  const statementGap = data?.statement_end ? daysBetween(data.statement_end, today) : null;

  const openSettings = () => {
    const current = new Map((data?.settings || []).map((s) => [settingKey(s), s]));
    const merged = DEFAULT_OBLIGATIONS.map((d) => current.get(settingKey(d)) || d);
    for (const s of data?.settings || []) if (!merged.some((m) => settingKey(m) === settingKey(s))) merged.push(s);
    setSettingsDraft(merged.map((s) => ({ ...s, label: s.label || DEFAULT_OBLIGATIONS.find((d) => settingKey(d) === settingKey(s))?.label || null })));
    setSettingsOpen(true);
  };

  const saveSettings = async () => {
    setBusy('settings');
    const known = new Map((data?.settings || []).map((s) => [settingKey(s), s]));
    for (const s of settingsDraft) {
      const before = known.get(settingKey(s));
      const unchanged = before ? before.enabled === s.enabled && before.due_day === s.due_day
        && before.due_month_offset === s.due_month_offset && (before.label || null) === (s.label || null) : !s.enabled;
      if (unchanged) continue;
      if (!Number.isInteger(s.due_day) || s.due_day < 1 || s.due_day > 31) {
        setBusy(null);
        showSnackbar(`${s.form}: dzień terminu musi być od 1 do 31.`, 'warning');
        return;
      }
      const { error } = await supabase.rpc('save_finance_obligation_setting', {
        p_company_id: companyId, p_kind: s.kind, p_form: s.form, p_period_kind: s.period_kind, p_enabled: s.enabled,
        p_due_day: s.due_day, p_due_month_offset: s.due_month_offset, p_label: s.label,
      });
      if (error) { setBusy(null); showSnackbar(error.message || 'Nie udało się zapisać ustawień.', 'error'); return; }
    }
    setBusy(null);
    setSettingsOpen(false);
    showSnackbar('Obowiązki działalności zapisane.', 'success');
    await load();
  };

  const saveDue = async () => {
    if (!dueEdit) return;
    if (dueEdit.remember && !dueEdit.date) { showSnackbar('Podaj termin, żeby zapamiętać go dla dostawcy.', 'warning'); return; }
    setBusy(`due:${dueEdit.id}`);
    const { data: count, error } = await supabase.rpc('set_ksef_invoice_payment_due', {
      p_invoice_id: dueEdit.id, p_due_date: dueEdit.date || null, p_remember: dueEdit.remember,
    });
    setBusy(null);
    if (error) { showSnackbar(error.message || 'Nie udało się zapisać terminu.', 'error'); return; }
    const updated = Number(count || 0);
    showSnackbar(dueEdit.remember && updated > 1
      ? `Termin zapisany i zapamiętany dla dostawcy — uzupełniono ${updated} faktury.`
      : dueEdit.date ? 'Termin płatności zapisany.' : 'Termin płatności usunięty.', 'success');
    setDueEdit(null);
    await load();
  };

  const removeSupplierTerm = async (nip: string) => {
    if (!window.confirm('Usunąć domyślny termin dostawcy? Terminy już wpisane w fakturach zostaną.')) return;
    setBusy(`term:${nip}`);
    const { error } = await supabase.rpc('delete_finance_supplier_payment_term', { p_company_id: companyId, p_seller_nip: nip });
    setBusy(null);
    if (error) { showSnackbar(error.message || 'Nie udało się usunąć terminu dostawcy.', 'error'); return; }
    await load();
  };

  if (!loading && companies.length === 0) {
    return <div className={`${card} p-6 text-sm text-[#e5e4e2]/60`}>Brak działalności z dostępem do finansów.</div>;
  }

  return (
    <div className="space-y-4">
      <div className={`${card} flex flex-wrap items-center gap-3 p-4`}>
        <CalendarClock className="h-5 w-5 text-[#d3bb73]" />
        <div className="mr-auto">
          <div className="text-sm font-medium text-[#e5e4e2]">Terminy, przypomnienia i monity</div>
          <div className="text-[11px] text-[#e5e4e2]/50">
            ZUS i podatki, należności od klientów i faktury do zapłaty. Przypomnienia przychodzą codziennie o 8:05 do osób
            z „Zarządzaniem finansami”.
          </div>
        </div>
        {companies.length > 1 && (
          <select className={input} value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        {canManage && (
          <button type="button" className={ghost} onClick={openSettings} disabled={!data}>
            <Settings2 className="h-3.5 w-3.5" />Obowiązki działalności
          </button>
        )}
        <button type="button" className={ghost} onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}Odśwież
        </button>
      </div>

      {data && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Summary icon={Landmark} label="ZUS i podatki po terminie" value={String(attention.obligations)} warn={attention.obligations > 0} />
          <Summary icon={BellRing} label="Należności po terminie"
            value={`${attention.receivables.length} · ${money(attention.receivables.reduce((s, r) => s + Number(r.outstanding || 0), 0))}`}
            warn={attention.receivables.length > 0} />
          <Summary icon={AlertTriangle} label="Faktury kosztowe po terminie"
            value={`${attention.payables.length} · ${money(attention.payables.reduce((s, p) => s + Number(p.amount || 0), 0))}`}
            warn={attention.payables.length > 0} />
          <Summary icon={CalendarClock} label="Faktury kosztowe bez terminu" value={String(attention.noDue)} warn={attention.noDue > 0} />
        </div>
      )}

      {data && (statementGap === null || statementGap > 31) && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>
            {data.statement_end
              ? `Wyciągi są wczytane do ${date(data.statement_end)}. Zapłat po tej dacie CRM nie widzi — obowiązki z późniejszym terminem mają stan „brak wyciągu”, a należności i zobowiązania mogą być już zapłacone.`
              : 'Brak wczytanych wyciągów — CRM nie potwierdzi żadnej zapłaty ZUS i podatków.'}
            {onOpenReconciliation && (
              <> <button type="button" className="underline" onClick={onOpenReconciliation}>Wczytaj wyciąg</button></>
            )}
          </span>
        </div>
      )}

      {loading && !data ? (
        <div className={`${card} flex items-center justify-center p-10`}><Loader2 className="h-6 w-6 animate-spin text-[#d3bb73]" /></div>
      ) : data ? (
        <>
          <section className={card}>
            <header className="flex flex-wrap items-center gap-2 border-b border-[#d3bb73]/10 px-4 py-3">
              <Landmark className="h-4 w-4 text-[#d3bb73]" />
              <h3 className="mr-auto text-sm font-medium text-[#e5e4e2]">ZUS i podatki</h3>
              <label className="flex items-center gap-1.5 text-[11px] text-[#e5e4e2]/60">
                <input type="checkbox" checked={showPaidObligations} onChange={(e) => setShowPaidObligations(e.target.checked)} />
                Pokaż zapłacone z ostatniego roku
              </label>
              {onOpenDeclarations && (
                <button type="button" className={ghost} onClick={onOpenDeclarations}>Deklaracje i kwoty</button>
              )}
            </header>
            {data.settings.filter((s) => s.enabled).length === 0 ? (
              <div className="px-4 py-6 text-xs text-[#e5e4e2]/60">
                Ta działalność nie ma ustawionych obowiązków ZUS i podatkowych.
                {canManage ? ' Włącz je w „Obowiązki działalności”.' : ' Ustawia je osoba z „Zarządzaniem finansami”.'}
              </div>
            ) : obligations.length === 0 ? (
              <div className="flex items-center gap-2 px-4 py-6 text-xs text-emerald-300">
                <CheckCircle2 className="h-4 w-4" />Wszystkie obowiązki z ostatniego roku są zapłacone.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead><tr>
                    <th className={th}>Obowiązek</th><th className={th}>Termin</th><th className={`${th} text-right`}>Kwota z deklaracji</th>
                    <th className={`${th} text-right`}>Zapłacono</th><th className={th}>Stan</th>
                  </tr></thead>
                  <tbody className="divide-y divide-white/5">
                    {obligations.map((o) => {
                      const chip = obligationChip(o, today);
                      const left = daysBetween(today, o.due_date);
                      return (
                        <tr key={`${o.kind}|${o.form}|${o.period_kind}|${o.period_start}`}>
                          <td className={td}>
                            <div className="font-medium text-[#e5e4e2]">{o.label}</div>
                            {o.setting_label && <div className="text-[10px] text-[#e5e4e2]/45">{o.setting_label}</div>}
                          </td>
                          <td className={td}>
                            <div>{date(o.due_date)}</div>
                            <div className="text-[10px] text-[#e5e4e2]/45">
                              {left > 0 ? `za ${left} ${dayWord(left)}` : left === 0 ? 'dziś' : `${-left} ${dayWord(left)} temu`}
                            </div>
                          </td>
                          <td className={`${td} text-right`}>
                            {o.amount_due === null ? <span className="text-amber-300/80">brak kwoty</span> : money(o.amount_due)}
                          </td>
                          <td className={`${td} text-right`}>{o.paid > 0 ? money(o.paid) : '—'}</td>
                          <td className={td}><span className={`rounded-full px-2 py-0.5 text-[10px] ${chip.className}`}>{chip.text}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="border-t border-[#d3bb73]/10 px-4 py-2 text-[10px] text-[#e5e4e2]/45">
              Termin w sobotę, niedzielę lub święto przechodzi na następny dzień roboczy. Kwota pochodzi z deklaracji w „ZUS i podatki”,
              zapłata — z przelewu przypisanego do deklaracji w uzgodnieniu wyciągu. Terminy potwierdź z biurem rachunkowym.
            </p>
          </section>

          <section className={card}>
            <header className="flex flex-wrap items-center gap-2 border-b border-[#d3bb73]/10 px-4 py-3">
              <BellRing className="h-4 w-4 text-[#d3bb73]" />
              <h3 className="mr-auto text-sm font-medium text-[#e5e4e2]">Należności — po terminie i z terminem w 14 dni</h3>
            </header>
            {data.receivables.length === 0 ? (
              <div className="px-4 py-6 text-xs text-[#e5e4e2]/60">Brak nieopłaconych faktur sprzedaży z terminem do 14 dni.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead><tr>
                    <th className={th}>Faktura</th><th className={th}>Klient</th><th className={th}>Termin</th>
                    <th className={`${th} text-right`}>Do zapłaty</th><th className={th}>Monity</th><th className={th} />
                  </tr></thead>
                  <tbody className="divide-y divide-white/5">
                    {data.receivables.map((r) => (
                      <tr key={`${r.source}:${r.id}`}>
                        <td className={td}>
                          {r.invoice_id
                            ? <Link href={`/crm/invoices/${r.invoice_id}`} className="font-medium text-[#d3bb73] hover:underline">{r.invoice_number}</Link>
                            : <span className="font-medium text-[#e5e4e2]">{r.invoice_number}</span>}
                          <div className="text-[10px] text-[#e5e4e2]/45">wystawiona {date(r.issue_date)}{r.in_ksef ? ' · KSeF' : ''}</div>
                        </td>
                        <td className={td}>{r.buyer_name || '—'}</td>
                        <td className={td}>
                          <div>{date(r.due_date)}</div>
                          <div className={`text-[10px] ${r.days_overdue > 0 ? 'text-red-300' : 'text-[#e5e4e2]/45'}`}>
                            {r.days_overdue > 0 ? `${r.days_overdue} ${dayWord(r.days_overdue)} po terminie` : `za ${daysBetween(today, r.due_date)} ${dayWord(daysBetween(today, r.due_date))}`}
                          </div>
                        </td>
                        <td className={`${td} text-right`}>{money(r.outstanding, r.currency)}</td>
                        <td className={td}>
                          {r.reminders > 0
                            ? <span>{r.reminders}× · ostatni {date(r.last_reminder_at)}</span>
                            : <span className="text-[#e5e4e2]/45">brak</span>}
                        </td>
                        <td className={`${td} text-right`}>
                          {r.source === 'local' && r.invoice_id ? (
                            canRemind && (
                              <button type="button" className={ghost} onClick={() => setReminder(r)}>
                                <Mail className="h-3.5 w-3.5" />Wyślij przypomnienie
                              </button>
                            )
                          ) : (
                            <span className="text-[10px] text-[#e5e4e2]/45">faktura spoza CRM — przypomnienie z poczty</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="border-t border-[#d3bb73]/10 px-4 py-2 text-[10px] text-[#e5e4e2]/45">
              Przypomnienie idzie e-mailem z fakturą w załączniku, z adresu wybranego przy wysyłce; CRM zapisuje datę i adresata.
              Status zapłaty pochodzi z uzgodnienia wyciągów — przed wysłaniem sprawdź, czy wpłata nie przyszła po ostatnim wyciągu.
            </p>
          </section>

          <section className={card}>
            <header className="flex flex-wrap items-center gap-2 border-b border-[#d3bb73]/10 px-4 py-3">
              <AlertTriangle className="h-4 w-4 text-[#d3bb73]" />
              <h3 className="mr-auto text-sm font-medium text-[#e5e4e2]">Faktury kosztowe do zapłaty — w 14 dni, po terminie i bez terminu</h3>
              {whitelist && (
                <button type="button" className={ghost} disabled={checkingWhitelist !== null}
                  onClick={() => void runWhitelistCheck('payables')}
                  title="Sprawdza NIP i rachunek z faktury w wykazie podatników VAT (API MF) na dziś — rób to w dniu zlecenia przelewu.">
                  {checkingWhitelist === 'payables' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                  Sprawdź na białej liście
                </button>
              )}
            </header>
            {data.payables.length === 0 ? (
              <div className="px-4 py-6 text-xs text-[#e5e4e2]/60">Brak nieopłaconych faktur kosztowych z terminem do 14 dni.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead><tr>
                    <th className={th}>Dostawca</th><th className={th}>Faktura</th><th className={th}>Termin</th>
                    <th className={`${th} text-right`}>Kwota</th><th className={th}>Rachunek</th>
                    {whitelist && <th className={th}>Biała lista</th>}
                  </tr></thead>
                  <tbody className="divide-y divide-white/5">
                    {data.payables.map((p) => {
                      const editing = dueEdit?.id === p.id;
                      const editable = canManage && (!p.due_date || p.due_source !== null);
                      return (
                        <tr key={p.id}>
                          <td className={td}>
                            <div className="font-medium text-[#e5e4e2]">{p.seller_name || '—'}</div>
                            {p.seller_nip && <div className="text-[10px] text-[#e5e4e2]/45">NIP {p.seller_nip}</div>}
                          </td>
                          <td className={td}>
                            <div>{p.invoice_number}</div>
                            <div className="text-[10px] text-[#e5e4e2]/45">wystawiona {date(p.issue_date)}</div>
                          </td>
                          <td className={td}>
                            {editing ? (
                              <div className="space-y-1.5">
                                <input type="date" className={input} value={dueEdit.date} min={p.issue_date || undefined}
                                  onChange={(e) => setDueEdit({ ...dueEdit, date: e.target.value })} />
                                {p.seller_nip && (
                                  <label className="flex items-center gap-1.5 text-[10px] text-[#e5e4e2]/70">
                                    <input type="checkbox" checked={dueEdit.remember}
                                      onChange={(e) => setDueEdit({ ...dueEdit, remember: e.target.checked })} />
                                    Zapamiętaj dla dostawcy
                                    {dueEdit.date && p.issue_date ? ` (${daysBetween(p.issue_date, dueEdit.date)} dni od wystawienia)` : ''}
                                  </label>
                                )}
                                <div className="flex gap-1.5">
                                  <button type="button" className={ghost} disabled={busy === `due:${p.id}`} onClick={() => void saveDue()}>
                                    {busy === `due:${p.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}Zapisz
                                  </button>
                                  <button type="button" className={ghost} onClick={() => setDueEdit(null)}><X className="h-3 w-3" /></button>
                                </div>
                              </div>
                            ) : p.due_date ? (
                              <div>
                                <div className={p.due_date < today ? 'text-red-300' : ''}>{date(p.due_date)}</div>
                                <div className="text-[10px] text-[#e5e4e2]/45">
                                  {p.due_source === 'manual' ? 'wpisany w CRM' : p.due_source === 'supplier_default' ? 'termin dostawcy' : 'z faktury'}
                                  {p.days_left !== null && (p.days_left < 0 ? ` · ${-p.days_left} ${dayWord(p.days_left)} po terminie`
                                    : p.days_left === 0 ? ' · dziś' : ` · za ${p.days_left} ${dayWord(p.days_left)}`)}
                                </div>
                                {editable && (
                                  <button type="button" className="mt-1 text-[10px] text-[#d3bb73] hover:underline"
                                    onClick={() => setDueEdit({ id: p.id, date: p.due_date || '', remember: false })}>Zmień</button>
                                )}
                              </div>
                            ) : (
                              <div>
                                <span className="text-amber-300/80">brak terminu w fakturze</span>
                                {editable && (
                                  <button type="button" className="ml-2 text-[10px] text-[#d3bb73] hover:underline"
                                    onClick={() => setDueEdit({
                                      id: p.id,
                                      date: p.issue_date && p.supplier_days !== null
                                        ? new Date(new Date(`${p.issue_date}T12:00:00`).getTime() + p.supplier_days * 86_400_000).toISOString().slice(0, 10)
                                        : '',
                                      remember: Boolean(p.seller_nip),
                                    })}>Ustaw termin</button>
                                )}
                              </div>
                            )}
                          </td>
                          <td className={`${td} text-right`}>{money(p.amount, p.currency)}</td>
                          <td className={`${td} font-mono text-[10px]`}>{p.bank_account || '—'}</td>
                          {whitelist && (() => {
                            const check = whitelistByInvoice.get(p.id);
                            if (!check) return <td className={td} />;
                            const chip = whitelistChip(check, check.fresh, Number(p.amount) > 15000);
                            return (
                              <td className={td}>
                                <span className={`rounded-full px-2 py-0.5 text-[10px] ${chip.className}`}
                                  title={check.request_id ? `Identyfikator zapytania MF: ${check.request_id}` : undefined}>{chip.text}</span>
                                {check.check_date && (
                                  <div className="mt-0.5 text-[10px] text-[#e5e4e2]/40">
                                    sprawdzono {date(check.check_date)}{check.request_id ? ` · ${check.request_id}` : ''}
                                  </div>
                                )}
                              </td>
                            );
                          })()}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {data.supplier_terms.length > 0 && (
              <details className="border-t border-[#d3bb73]/10 px-4 py-2 text-xs text-[#e5e4e2]/70">
                <summary className="cursor-pointer text-[11px] text-[#e5e4e2]/60">Domyślne terminy dostawców ({data.supplier_terms.length})</summary>
                <ul className="mt-2 space-y-1">
                  {data.supplier_terms.map((t) => (
                    <li key={t.seller_nip} className="flex items-center gap-2">
                      <span className="mr-auto">{t.seller_name || 'Dostawca'} · NIP {t.seller_nip} · {t.days} dni od wystawienia</span>
                      {canManage && (
                        <button type="button" className={ghost} disabled={busy === `term:${t.seller_nip}`}
                          onClick={() => void removeSupplierTerm(t.seller_nip)}>
                          <Trash2 className="h-3 w-3" />Usuń
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <p className="border-t border-[#d3bb73]/10 px-4 py-2 text-[10px] text-[#e5e4e2]/45">
              Termin z faktury w KSeF ma pierwszeństwo — w CRM ustawia się go tylko fakturom bez terminu. Termin dostawcy (dni od
              wystawienia) uzupełnia jego pozostałe nieopłacone faktury i nowe, pobrane z KSeF. Biała lista: przy transakcji ponad
              15 000 zł płać tylko na rachunek z wykazu, sprawdzony w dniu zlecenia przelewu (identyfikator zapytania MF to dowód).
            </p>
          </section>

          {whitelist && (
            <section className={card}>
              <header className="flex flex-wrap items-center gap-2 border-b border-[#d3bb73]/10 px-4 py-3">
                <ShieldAlert className="h-4 w-4 text-[#d3bb73]" />
                <h3 className="mr-auto text-sm font-medium text-[#e5e4e2]">Przelewy ponad 15 000 zł — kontrola białej listy (90 dni)</h3>
                {whitelist.payments.length > 0 && (
                  <button type="button" className={ghost} disabled={checkingWhitelist !== null}
                    onClick={() => void runWhitelistCheck('payments')}
                    title="Sprawdza rachunek z wyciągu w wykazie podatników VAT na dzień przelewu (tylko niesprawdzone).">
                    {checkingWhitelist === 'payments' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                    Sprawdź przelewy
                  </button>
                )}
              </header>
              {whitelist.payments.length === 0 ? (
                <div className="px-4 py-6 text-xs text-[#e5e4e2]/60">
                  Brak przelewów ponad 15 000 zł dopasowanych do faktur kosztowych w ostatnich 90 dniach (według wczytanych wyciągów).
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead><tr>
                      <th className={th}>Data przelewu</th><th className={th}>Dostawca</th><th className={th}>Dokument</th>
                      <th className={`${th} text-right`}>Przelew</th><th className={th}>Rachunek odbiorcy</th><th className={th}>Biała lista</th>
                    </tr></thead>
                    <tbody className="divide-y divide-white/5">
                      {whitelist.payments.map((payment) => {
                        const chip = whitelistChip(payment, true, true);
                        return (
                          <tr key={`${payment.bank_transaction_id}:${payment.document_number}`}>
                            <td className={td}>{date(payment.transaction_date)}</td>
                            <td className={td}>
                              <div className="text-[#e5e4e2]">{payment.seller_name || '—'}</div>
                              {payment.nip && <div className="text-[10px] text-[#e5e4e2]/45">NIP {payment.nip}</div>}
                            </td>
                            <td className={td}>
                              <div>{payment.document_number || '—'}</div>
                              <div className="text-[10px] text-[#e5e4e2]/45">wartość {money(payment.document_gross)}</div>
                            </td>
                            <td className={`${td} text-right`}>{money(payment.amount)}</td>
                            <td className={`${td} font-mono text-[10px]`}>{payment.account || 'brak na wyciągu'}</td>
                            <td className={td}>
                              <span className={`rounded-full px-2 py-0.5 text-[10px] ${chip.className}`}>{chip.text}</span>
                              {payment.request_id && <div className="mt-0.5 text-[10px] text-[#e5e4e2]/40">{payment.request_id}</div>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="border-t border-[#d3bb73]/10 px-4 py-2 text-[10px] text-[#e5e4e2]/45">
                Przelew za transakcję ponad 15 000 zł na rachunek spoza wykazu: koszt nie jest kosztem podatkowym, a za VAT dostawcy
                odpowiada się solidarnie — chyba że w 7 dni od zlecenia przelewu złożysz zawiadomienie ZAW-NR do urzędu skarbowego.
                Skonsultuj z biurem rachunkowym.
              </p>
            </section>
          )}
        </>
      ) : null}

      {settingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
          <div className={`${card} max-h-[90vh] w-full max-w-3xl overflow-y-auto p-5`}>
            <div className="mb-3 flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-[#d3bb73]" />
              <h3 className="mr-auto text-sm font-medium text-[#e5e4e2]">Obowiązki działalności</h3>
              <button type="button" className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]" onClick={() => setSettingsOpen(false)}><X className="h-4 w-4" /></button>
            </div>
            <p className="mb-3 text-[11px] text-[#e5e4e2]/55">
              Termin = wskazany dzień miesiąca, który przypada tyle miesięcy po ostatnim miesiącu okresu. Spółka: ZUS do 15.,
              PIT-4R i zaliczka CIT do 20., VAT do 25. następnego miesiąca, CIT-8 do końca 3. miesiąca po roku. Jednoosobowa
              działalność płaci ZUS do 20. Zaliczki kwartalne lub uproszczone — ustal z biurem rachunkowym.
            </p>
            <table className="w-full">
              <thead><tr>
                <th className={th}>Włączony</th><th className={th}>Obowiązek</th><th className={th}>Okres</th>
                <th className={th}>Dzień terminu</th><th className={th}>Miesięcy po okresie</th>
              </tr></thead>
              <tbody className="divide-y divide-white/5">
                {settingsDraft.map((s, index) => (
                  <tr key={settingKey(s)}>
                    <td className={td}>
                      <input type="checkbox" checked={s.enabled}
                        onChange={(e) => setSettingsDraft((rows) => rows.map((r, i) => (i === index ? { ...r, enabled: e.target.checked } : r)))} />
                    </td>
                    <td className={td}>
                      <div className="font-medium text-[#e5e4e2]">{s.form}</div>
                      <div className="text-[10px] text-[#e5e4e2]/45">{s.label}</div>
                    </td>
                    <td className={td}>{PERIOD_LABELS[s.period_kind]}</td>
                    <td className={td}>
                      <input type="number" min={1} max={31} className={`${input} w-16`} value={s.due_day}
                        onChange={(e) => setSettingsDraft((rows) => rows.map((r, i) => (i === index ? { ...r, due_day: Number(e.target.value) } : r)))} />
                    </td>
                    <td className={td}>
                      <input type="number" min={0} max={12} className={`${input} w-16`} value={s.due_month_offset}
                        onChange={(e) => setSettingsDraft((rows) => rows.map((r, i) => (i === index ? { ...r, due_month_offset: Number(e.target.value) } : r)))} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className={ghost} onClick={() => setSettingsOpen(false)}>Anuluj</button>
              <button type="button" className={ghost} disabled={busy === 'settings'} onClick={() => void saveSettings()}>
                {busy === 'settings' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}Zapisz
              </button>
            </div>
          </div>
        </div>
      )}

      {reminder && reminder.invoice_id && (
        <SendInvoiceEmailModal
          mode="reminder"
          invoiceId={reminder.invoice_id}
          invoiceNumber={reminder.invoice_number}
          clientEmail={reminder.buyer_email || ''}
          clientName={reminder.buyer_name || ''}
          pdfStoragePath={reminder.pdf_url}
          reminder={{ dueDate: reminder.due_date, issueDate: reminder.issue_date, outstanding: Number(reminder.outstanding || 0), currency: reminder.currency }}
          onClose={() => setReminder(null)}
          onSent={() => { void load(); }}
        />
      )}
    </div>
  );
}

function Summary({ icon: Icon, label, value, warn }: { icon: typeof Landmark; label: string; value: string; warn: boolean }) {
  return (
    <div className={`${card} flex items-center gap-3 p-3`}>
      <Icon className={`h-5 w-5 ${warn ? 'text-amber-300' : 'text-[#d3bb73]/70'}`} />
      <div>
        <div className="text-[10px] uppercase tracking-wide text-[#e5e4e2]/45">{label}</div>
        <div className={`text-sm font-medium ${warn ? 'text-amber-200' : 'text-[#e5e4e2]'}`}>{value}</div>
      </div>
    </div>
  );
}
