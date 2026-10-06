'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, FileText, Landmark, Loader2, RefreshCw, Search } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { linkDetectedVatTransfersForPeriod } from '@/lib/CRM/bankVatTransfers';
import MonthlyStatementSourcesModal, { type StatementDownloadHandler } from './MonthlyStatementSourcesModal';
import {
  loadBankStatementParserPreview,
  type ParserAccountGroup,
  type ParserPreviewRow,
  type ParserStatement,
  type ParserTransaction,
} from '@/lib/invoices/bankStatementParserPreview';

type Props = {
  companyId: string;
  month: number;
  year: number;
  refreshKey?: number;
  hideRefresh?: boolean;
  onLoadingChange?: (loading: boolean) => void;
  onTransfersLinked?: () => void | Promise<void>;
  onDownload?: StatementDownloadHandler;
};
type Preview = Awaited<ReturnType<typeof loadBankStatementParserPreview>>;
const PAGE_SIZE = 100;
const buttonClass = 'inline-flex items-center justify-center gap-1.5 rounded-lg bg-white/5 px-3 py-2 text-xs text-[#e5e4e2] hover:bg-white/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--crm-field-border-focus)] disabled:cursor-not-allowed disabled:opacity-40';
const normalizedSearch = (value: unknown) => String(value ?? '').toLocaleLowerCase('pl-PL').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l');
const originalText = (value: unknown) => value == null || value === '' ? 'Nie zapisano' : String(value);
const mergedFieldLabels: Record<string, string> = {
  title: 'Tytuł', counterparty_name: 'Kontrahent', counterparty_account: 'Rachunek kontrahenta',
  reference_number: 'Numer referencyjny', posting_date: 'Data księgowania',
  raw_description: 'Opis źródłowy', raw_counterparty: 'Źródłowy zapis kontrahenta',
};

function displayDate(value?: string | null) {
  if (!value) return '—';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : value;
}

function formatAccount(value?: string | null) {
  if (!value) return 'Numer rachunku nie został rozpoznany';
  const compact = value.replace(/^PL/i, '').replace(/\s/g, '');
  return /^\d{26}$/.test(compact) ? `${compact.slice(0, 2)} ${compact.slice(2).match(/.{1,4}/g)?.join(' ')}` : value;
}

function sourceFormat(statement: ParserStatement) {
  const format = String(statement.import_format || statement.file_type || '').toUpperCase();
  if (format.includes('MT940') || statement.account_type === 'mt940') return 'MT940';
  if (format.includes('PDF') || /\.pdf$/i.test(statement.file_name || '')) return 'PDF';
  if (format.includes('JPK') || format.includes('XML') || /\.xml$/i.test(statement.file_name || '')) return 'XML / JPK';
  return 'Inny format';
}

function displayAmount(transaction: ParserTransaction) {
  if (transaction.amount == null || transaction.amount === '') return 'Nie odczytano kwoty';
  const amount = Number(transaction.amount);
  if (!Number.isFinite(amount)) return 'Nieprawidłowa kwota';
  const sign = transaction.transaction_type === 'credit' ? '+' : transaction.transaction_type === 'debit' ? '−' : '';
  return `${sign}${Math.abs(amount).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${transaction.currency || '(brak waluty)'}`;
}

function RawField({ label, value }: { label: string; value: unknown }) {
  return <div className="min-w-0"><dt className="text-[11px] text-[#e5e4e2]/45">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-[#e5e4e2]/85 [overflow-wrap:anywhere]">{originalText(value)}</dd></div>;
}

function TransactionRow({ row, separateReadouts }: { row: ParserPreviewRow; separateReadouts: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const { statement, reconciled } = row;
  const transaction = separateReadouts ? row.transaction : reconciled.transaction;
  const sources = separateReadouts ? [statement] : row.sourceStatements;
  const combined = !separateReadouts && reconciled.sources.length > 1;
  const detailsId = `parser-transaction-${row.transaction.id}`;

  return <Fragment>
    <tr className="border-t border-white/[0.06] align-top hover:bg-white/[0.025]">
      <td className="px-3 py-3 text-xs tabular-nums"><p className="whitespace-nowrap">{displayDate(transaction.transaction_date)}</p><p className="mt-1 whitespace-nowrap text-[11px] text-[#e5e4e2]/45">Księg.: {displayDate(transaction.posting_date)}</p></td>
      <td className="px-3 py-3 text-xs"><p className={`whitespace-nowrap font-medium tabular-nums ${transaction.transaction_type === 'credit' ? 'text-emerald-300' : transaction.transaction_type === 'debit' ? 'text-red-300' : 'text-[#e5e4e2]'}`}>{displayAmount(transaction)}</p><p className="mt-1 text-[11px] text-[#e5e4e2]/45">{transaction.transaction_type === 'credit' ? 'Wpływ' : transaction.transaction_type === 'debit' ? 'Wydatek' : 'Nieustalony kierunek'}</p></td>
      <td className="px-3 py-3 text-xs"><p className="line-clamp-2 break-words">{transaction.counterparty_name || 'Nie odczytano kontrahenta'}</p>{transaction.counterparty_account && <p className="mt-1 break-all text-[10px] text-[#e5e4e2]/45">{transaction.counterparty_account}</p>}</td>
      <td className="px-3 py-3 text-xs"><p className="line-clamp-2 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{transaction.title || 'Nie odczytano tytułu'}</p><p className="mt-1 break-all text-[10px] text-[#e5e4e2]/45">Nr ref.: {transaction.reference_number || 'nie zapisano'}</p>{row.vatTransfer && <p className="mt-2 text-[10px] text-emerald-300">{row.vatTransfer.kind === 'saved' ? 'Powiązany transfer bieżące ↔ VAT' : 'Rozpoznany transfer bieżące ↔ VAT'}</p>}</td>
      <td className="px-3 py-3 text-xs"><span className="inline-flex rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-[#d3bb73]">{[...new Set(sources.map(sourceFormat))].join(' + ')}</span>{combined && <p className="mt-1 text-[10px] text-[#e5e4e2]/45">Jedna operacja</p>}</td>
      <td className="px-2 py-3 text-right"><button type="button" onClick={() => setExpanded((current) => !current)} aria-expanded={expanded} aria-controls={detailsId} aria-label={`${expanded ? 'Zwiń' : 'Pokaż'} dane parsera: ${transaction.reference_number || transaction.transaction_date || 'transakcja'}`} className={buttonClass}>{expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}<span className="sr-only">Dane parsera</span></button></td>
    </tr>
    {expanded && <tr><td colSpan={6} className="px-3 pb-4"><div id={detailsId} className="rounded-lg bg-[var(--brand-burgundy-950)] p-4"><p className="mb-4 text-xs text-[#d3bb73]">{combined ? 'Pełniejszy zapis tej samej operacji z PDF i MT940. Kwoty, rozliczenia i oryginały pozostają bez zmian.' : 'Zapisany odczyt — bez ponownego uruchamiania parsera.'}</p>{row.vatTransfer && <p className="mb-4 rounded-lg bg-emerald-400/5 p-3 text-xs text-emerald-300">{row.vatTransfer.reason}</p>}<dl className="grid gap-4 md:grid-cols-2">
      <RawField label="Pełny tytuł" value={transaction.title} />
      <RawField label="Kontrahent" value={transaction.counterparty_name} />
      <RawField label="Opis źródłowy zapisany w CRM" value={transaction.raw_description} />
      <RawField label="Źródłowy zapis kontrahenta" value={transaction.raw_counterparty} />
      <RawField label="Numer referencyjny" value={transaction.reference_number} />
      <RawField label="Rachunek kontrahenta" value={transaction.counterparty_account} />
      <RawField label="Kwota zapisana / waluta" value={`${originalText(transaction.amount)} / ${originalText(transaction.currency)}`} />
      <RawField label="Numer rachunku zapisany z wyciągiem" value={statement.account_number} />
    </dl>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <RawField label="Pozycja w pliku źródłowym" value={transaction.source_index == null ? null : transaction.source_index + 1} />
        <RawField label="Potwierdzenie odczytu źródłowego" value={transaction.source_verified === true ? 'Pozycja i ciąg sald potwierdzone w oryginale' : 'Nie potwierdzono pełnej pozycji i ciągu sald'} />
        <RawField label="Saldo przed operacją" value={transaction.source_balance_before == null ? null : `${Number(transaction.source_balance_before).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${transaction.currency || ''}`} />
        <RawField label="Saldo po operacji" value={transaction.source_balance_after == null ? null : `${Number(transaction.source_balance_after).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${transaction.currency || ''}`} />
      </div>
      {combined && <div className="mt-5 space-y-2"><h5 className="text-xs font-medium text-[#d3bb73]">Skąd pochodzą uzupełnione dane</h5>{Object.entries(reconciled.fieldSources).map(([field, sourceId]) => { const source = reconciled.sources.find((item) => item.id === sourceId); const file = row.sourceStatements.find((item) => item.id === source?.statement_id); return <p key={field} className="break-words text-[11px] text-[#e5e4e2]/60">{mergedFieldLabels[field] || 'Pole odczytu'}: {file ? sourceFormat(file) : 'Odczyt źródłowy'}</p>; })}</div>}
      {reconciled.conflicts.length > 0 && <div className="mt-5 rounded-lg bg-amber-400/5 p-3"><h5 className="text-xs text-amber-200">Różnice pomiędzy odczytami — zachowano oba warianty</h5>{reconciled.conflicts.map((conflict) => <div key={conflict.field} className="mt-3"><p className="text-xs font-medium">{mergedFieldLabels[conflict.field] || 'Pole odczytu'}</p>{conflict.values.map((value) => { const source = reconciled.sources.find((item) => item.id === value.transactionId); const file = row.sourceStatements.find((item) => item.id === source?.statement_id); return <p key={value.transactionId} className="mt-1 whitespace-pre-wrap break-words text-xs text-[#e5e4e2]/65">{file ? sourceFormat(file) : 'Źródło'}: {value.value}</p>; })}</div>)}</div>}
      {reconciled.sources.length > 1 && <div className="mt-5 space-y-3"><h5 className="text-xs font-medium text-[#d3bb73]">Oryginalne odczyty operacji</h5>{reconciled.sources.map((source) => { const file = row.sourceStatements.find((item) => item.id === source.statement_id); return <details key={source.id} className="rounded-lg bg-white/[0.035] p-3"><summary className="cursor-pointer text-xs">{file ? sourceFormat(file) : 'Odczyt źródłowy'}</summary><dl className="mt-3 grid gap-4 md:grid-cols-2"><RawField label="Tytuł odczytany" value={source.title} /><RawField label="Kontrahent odczytany" value={source.counterparty_name} /><RawField label="Numer referencyjny" value={source.reference_number} /><RawField label="Rachunek kontrahenta" value={source.counterparty_account} /><RawField label="Data operacji / księgowania" value={`${displayDate(source.transaction_date)} / ${displayDate(source.posting_date)}`} /><RawField label="Kwota / waluta" value={`${originalText(source.amount)} / ${originalText(source.currency)}`} /><RawField label="Opis źródłowy" value={source.raw_description} /><RawField label="Źródłowy zapis kontrahenta" value={source.raw_counterparty} /></dl></details>; })}</div>}
    </div></td></tr>}
  </Fragment>;
}

function AccountTable({ group, rows, filtered, separateReadouts }: { group: ParserAccountGroup; rows: ParserPreviewRow[]; filtered: boolean; separateReadouts: boolean }) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const start = currentPage * PAGE_SIZE;
  const visibleRows = rows.slice(start, start + PAGE_SIZE);
  const transactionCount = group.rows.filter((row) => !row.hiddenAsDuplicate).length;

  return <section className="overflow-hidden rounded-xl bg-[var(--brand-burgundy-800)]">
    <header className="flex flex-wrap items-start justify-between gap-3 px-4 py-4"><div><h4 className="flex items-center gap-2 text-sm font-medium"><Landmark className="h-4 w-4 text-[#d3bb73]" />{group.label}</h4><p className="mt-1 text-xs tabular-nums text-[#e5e4e2]/60">{formatAccount(group.accountNumber)}</p>{group.kind === 'unclassified' && <p className="mt-2 text-xs text-amber-200">Nie potwierdzono rodzaju rachunku. Tych operacji nie mieszamy z rachunkiem bieżącym ani VAT.</p>}</div><p className="text-sm font-medium tabular-nums text-[#d3bb73]">{transactionCount} transakcji</p></header>
    {rows.length ? <><div className="overflow-x-auto"><table className="w-full min-w-[930px] table-fixed text-left"><caption className="sr-only">Wynik parsera transakcji — {group.label}, {formatAccount(group.accountNumber)}</caption><colgroup><col className="w-[115px]" /><col className="w-[150px]" /><col className="w-[19%]" /><col /><col className="w-[20%]" /><col className="w-[58px]" /></colgroup><thead className="bg-[var(--brand-burgundy-900)] text-[10px] uppercase tracking-wide text-[#e5e4e2]/50"><tr><th scope="col" className="px-3 py-2.5">Daty</th><th scope="col" className="px-3 py-2.5">Kwota i kierunek</th><th scope="col" className="px-3 py-2.5">Kontrahent</th><th scope="col" className="px-3 py-2.5">Tytuł i referencja</th><th scope="col" className="px-3 py-2.5">Źródło odczytu</th><th scope="col" className="px-2 py-2.5"><span className="sr-only">Szczegóły</span></th></tr></thead><tbody>{visibleRows.map((row) => <TransactionRow key={row.transaction.id} row={row} separateReadouts={separateReadouts} />)}</tbody></table></div>
      <footer className="flex flex-wrap items-center justify-between gap-2 bg-[var(--brand-burgundy-900)] px-4 py-3"><p className="text-xs text-[#e5e4e2]/55">Pozycje {start + 1}–{Math.min(start + PAGE_SIZE, rows.length)} z {rows.length}{filtered ? ' po filtrach' : ''}. Wszystkie strony odczytu są dostępne.</p><div className="flex items-center gap-2"><button type="button" onClick={() => setPage(currentPage - 1)} disabled={currentPage === 0} aria-label={`Poprzednia strona: ${group.label}`} className={buttonClass}><ChevronLeft className="h-4 w-4" /></button><span className="text-xs tabular-nums text-[#e5e4e2]/60">{currentPage + 1} / {pages}</span><button type="button" onClick={() => setPage(currentPage + 1)} disabled={currentPage + 1 >= pages} aria-label={`Następna strona: ${group.label}`} className={buttonClass}><ChevronRight className="h-4 w-4" /></button></div></footer>
    </> : <p className="px-4 pb-5 text-sm text-[#e5e4e2]/50">{group.rows.length ? 'Brak transakcji dla wybranych filtrów.' : 'Nie ma zapisanych transakcji z tych plików. Sprawdź stan ich odczytu.'}</p>}
  </section>;
}

export default function BankStatementParserPreview({ companyId, month, year, refreshKey = 0, hideRefresh = false, onLoadingChange, onTransfersLinked, onDownload }: Props) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showSources, setShowSources] = useState(false);
  const [showVatTransfers, setShowVatTransfers] = useState(true);
  const [linkingTransfers, setLinkingTransfers] = useState(false);
  const [transferNotice, setTransferNotice] = useState<string | null>(null);
  const requestRef = useRef(0);
  const loadingCallbackRef = useRef(onLoadingChange);
  const load = useCallback(async () => {
    const requestId = ++requestRef.current;
    setLoading(true); setError(null);
    try {
      const result = await loadBankStatementParserPreview(supabase, { companyId, month, year });
      if (requestId === requestRef.current) setPreview(result);
    } catch (cause) {
      if (requestId === requestRef.current) { setPreview(null); setError(cause instanceof Error ? cause.message : 'Nie udało się odczytać pełnej listy transakcji parsera.'); }
    } finally { if (requestId === requestRef.current) setLoading(false); }
  }, [companyId, month, year]);

  useEffect(() => { void load(); return () => { requestRef.current += 1; }; }, [load, refreshKey]);
  useEffect(() => {
    loadingCallbackRef.current = onLoadingChange;
    onLoadingChange?.(loading || linkingTransfers);
  }, [loading, linkingTransfers, onLoadingChange]);
  useEffect(() => () => { loadingCallbackRef.current?.(false); }, []);
  useEffect(() => { setSearch(''); setShowSources(false); setShowVatTransfers(true); setTransferNotice(null); }, [companyId, month, year]);
  const saveVatPairs = async () => {
    if (linkingTransfers) return;
    const revision = requestRef.current;
    setLinkingTransfers(true);
    setTransferNotice(null);
    try {
      const result = await linkDetectedVatTransfersForPeriod(supabase, { companyId, month, year });
      if (requestRef.current !== revision) return;
      setTransferNotice([`Zapisano par transferów VAT: ${result.linkedPairs}.`, ...result.warnings].join(' '));
      await load();
      await onTransfersLinked?.();
    } catch (cause) {
      if (requestRef.current === revision) setTransferNotice(cause instanceof Error ? cause.message : 'Nie udało się zapisać par transferów VAT.');
    } finally {
      setLinkingTransfers(false);
    }
  };
  const filtered = Boolean(search.trim() || !showVatTransfers);
  const visibleGroups = useMemo(() => {
    const query = normalizedSearch(search.trim());
    return (preview?.groups || []).map((group) => ({ group, rows: group.rows.filter((row) => {
      if (row.hiddenAsDuplicate) return false;
      if (!showVatTransfers && row.vatTransfer) return false;
      if (!query) return true;
      const bank = row.reconciled.transaction;
      return [bank.transaction_date, displayDate(bank.transaction_date), bank.posting_date, bank.counterparty_name,
        bank.counterparty_account, bank.title, bank.reference_number, bank.raw_description, bank.raw_counterparty,
        bank.amount, String(bank.amount ?? '').replace('.', ','), bank.currency, group.accountNumber]
        .some((value) => normalizedSearch(value).includes(query));
    }) }));
  }, [preview, search, showVatTransfers]);
  const allRows = preview?.groups.flatMap((group) => group.rows) || [];
  const detectedVatPairCount = Math.floor(allRows.filter((row) => !row.hiddenAsDuplicate && row.vatTransfer?.kind === 'detected').length / 2);

  return <section aria-label="Odczyt transakcji z wyciągów" className="space-y-4 rounded-xl bg-[var(--brand-burgundy-900)] p-4 text-[var(--brand-platinum)] sm:p-5">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-base font-medium">Transakcje bankowe</h3><p className="mt-2 max-w-3xl text-xs leading-5 text-[#e5e4e2]/60">Każdą operację pokazujemy raz, z danymi uzupełnionymi z PDF i MT940. Konto bieżące i VAT pozostają oddzielne.</p></div><div className="flex flex-wrap items-center gap-2"><button type="button" onClick={() => setShowSources(true)} disabled={loading || !preview} className={buttonClass}><FileText className="h-4 w-4" />Pokaż wyciągi</button>{!hideRefresh && <button type="button" onClick={() => void load()} disabled={loading || linkingTransfers} className={buttonClass}><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />Odśwież odczyt</button>}</div></header>
    {transferNotice && <p role="status" className="rounded-lg bg-white/5 p-3 text-xs leading-5 text-[#d3bb73]">{transferNotice}</p>}
    {loading ? <div role="status" className="flex items-center gap-2 rounded-lg bg-white/5 p-5 text-sm"><Loader2 className="h-4 w-4 animate-spin" />Wczytuję wszystkie zapisane transakcje z plików miesiąca…</div> : error ? <div role="alert" className="rounded-lg bg-amber-400/10 p-4 text-sm text-amber-200"><p>{error}</p><button type="button" onClick={() => void load()} className={`${buttonClass} mt-3`}>Spróbuj ponownie</button></div> : preview && <>
      <p className={`text-xs leading-5 ${preview.completeness.status === 'complete' ? 'text-emerald-300' : 'text-amber-200'}`} role="status">{preview.completeness.status === 'complete' ? 'Komplet źródeł bankowych — PDF i MT940 dla rozpoznanych rachunków.' : preview.completeness.status === 'unavailable' ? 'Nie można potwierdzić kompletności źródeł. Szczegóły znajdziesz w „Pokaż wyciągi”.' : 'Źródła wymagają uzupełnienia. Szczegóły znajdziesz w „Pokaż wyciągi”.'}</p>
      {preview.reconciliationSummary.unresolvedOverlapCount > 0 && <p className="rounded-lg bg-amber-400/5 p-3 text-xs leading-5 text-amber-200">Niejednoznaczne odczyty: {preview.reconciliationSummary.unresolvedOverlapCount}. Liczba operacji wymaga jeszcze potwierdzenia. Szczegóły są w „Pokaż wyciągi”.</p>}
      {detectedVatPairCount > 0 && <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-white/[0.035] p-3"><p className="max-w-3xl text-xs leading-5 text-[#e5e4e2]/65">Rozpoznano {detectedVatPairCount} par własnych transferów między kontem bieżącym i VAT. Możesz zapisać powiązanie ich dwóch stron.</p><button type="button" onClick={() => void saveVatPairs()} disabled={linkingTransfers} className={buttonClass}>{linkingTransfers && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Połącz transfery VAT ({detectedVatPairCount})</button></div>}
      <label className="crm-search-field flex min-w-0 items-center gap-2 rounded-lg border bg-[var(--brand-burgundy-950)] px-3 py-2.5"><Search className="h-4 w-4 shrink-0 text-[#d3bb73]" /><span className="sr-only">Szukaj w transakcjach bankowych</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Kontrahent, tytuł, kwota lub numer referencyjny…" className="crm-search-input min-w-0 flex-1 bg-transparent text-sm text-[#e5e4e2] outline-none placeholder:text-[#e5e4e2]/35" /></label>
      <label className="flex items-center gap-2 text-xs text-[#e5e4e2]/70"><input type="checkbox" checked={showVatTransfers} onChange={(event) => setShowVatTransfers(event.target.checked)} className="h-4 w-4 accent-[var(--brand-gold)]" />Pokaż transfery między kontem bieżącym i VAT</label>
      {visibleGroups.map(({ group, rows }) => <AccountTable key={`${group.key}:${showVatTransfers}:${search}`} group={group} rows={rows} filtered={filtered} separateReadouts={false} />)}
      {!preview.statements.length && <p className="rounded-lg bg-white/5 p-4 text-sm text-[#e5e4e2]/60">Nie dodano plików wyciągów dla tej firmy i miesiąca.</p>}
    </>}
    {showSources && preview && <MonthlyStatementSourcesModal preview={preview} month={month} year={year} onClose={() => setShowSources(false)} onDownload={onDownload} />}
  </section>;
}
