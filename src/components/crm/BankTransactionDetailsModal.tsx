'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, ArrowRightLeft, FileText, Link as LinkIcon, Loader2, MessageSquareText, RefreshCw, UserRound, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { repairBrokenBankText } from '@/lib/bankTextEncoding';
import { decodeTextEntities } from '@/lib/textEncoding';
import { BANK_ACCOUNTING_ACTIONS } from './BankTransactionAccountingModal';

export interface BankTransactionDetailsTransaction {
  id: string;
  statement_id: string;
  company_id: string;
  transaction_date: string;
  posting_date: string;
  amount: number;
  currency: string;
  transaction_type: 'debit' | 'credit';
  manual_match: boolean;
  counterparty_name?: string | null;
  counterparty_account?: string | null;
  title?: string | null;
  reference_number?: string | null;
  matched_invoice_id?: string | null;
  match_confidence?: number | null;
  match_status?: 'unmatched' | 'partial' | 'matched';
  allocated_amount?: number | null;
  matched_document_count?: number | null;
  private_transfer_detected?: boolean;
  private_transfer_owner?: string | null;
  accounting_note?: string | null;
  accounting_category?: string | null;
  accounting_subtype?: string | null;
  accounting_review_status?: 'pending' | 'explained' | null;
  raw_description?: string | null;
  raw_counterparty?: string | null;
  paired_bank_transaction_id?: string | null;
  created_at?: string | null;
}

type Props = {
  transaction: Pick<BankTransactionDetailsTransaction, 'id' | 'company_id'>
    & Partial<Pick<BankTransactionDetailsTransaction, 'statement_id'>>;
  onClose: () => void;
  onMatchDocuments?: (fresh: BankTransactionDetailsTransaction) => void;
  onMatchPersonnel?: (fresh: BankTransactionDetailsTransaction) => void;
  onExplain?: (fresh: BankTransactionDetailsTransaction) => void;
  onDescribe?: (fresh: BankTransactionDetailsTransaction) => void;
};

type Statement = {
  id: string;
  my_company_id: string | null;
  file_name: string | null;
  file_type: string | null;
  import_format: string | null;
  account_type: string | null;
  account_number: string | null;
  statement_month: number | null;
  statement_year: number | null;
  processed: boolean | null;
  validation_status: string | null;
};

type Allocation = {
  id: string;
  document_source: 'invoice' | 'ksef' | 'external';
  invoice_id: string | null;
  ksef_invoice_id: string | null;
  external_invoice_id: string | null;
  amount: number;
  currency: string;
  document_amount: number | null;
  document_currency: string | null;
  exchange_rate: number | null;
  match_method: string;
  match_reasons: string[] | null;
  created_at: string;
};

type DocumentInfo = {
  id: string;
  number: string | null;
  party: string | null;
  issueDate: string | null;
  dueDate: string | null;
  amount: number | null;
  currency: string | null;
  reference: string | null;
  paymentStatus: string | null;
};

type PersonnelPayment = {
  id: string;
  payment_date: string;
  amount: number;
  currency: string;
  payment_type: string;
  recipient_name: string;
  title: string | null;
  notes: string | null;
  personnel_contracts: { contract_number: string; title: string | null } | { contract_number: string; title: string | null }[] | null;
};

type SupportingDocument = {
  id: string;
  title: string;
  document_type: string;
  document_date: string | null;
  amount: number | null;
  currency: string;
  original_file_name: string;
  notes: string | null;
};

type Details = {
  fresh: BankTransactionDetailsTransaction;
  statement: Statement | null;
  allocations: Allocation[];
  documents: Record<string, DocumentInfo>;
  personnel: PersonnelPayment[];
  supporting: SupportingDocument[];
  paired: { transaction: BankTransactionDetailsTransaction; statement: Statement | null } | null;
  warnings: string[];
  canManage: boolean;
  canViewPersonnel: boolean;
  canManagePersonnel: boolean;
  allocationsComplete: boolean;
};

const STATEMENT_FIELDS = 'id,my_company_id,file_name,file_type,import_format,account_type,account_number,statement_month,statement_year,processed,validation_status';
const sourceLabels = { invoice: 'Faktura CRM', ksef: 'Faktura KSeF', external: 'Faktura spoza KSeF' };
const categoryLabels: Record<string, string> = {
  bank_fee: 'Opłata lub prowizja bankowa', tax_or_zus: 'Podatek lub ZUS', payroll: 'Wynagrodzenie',
  own_transfer: 'Przelew własny', cash: 'Rozliczenie gotówkowe', foreign_purchase: 'Zakup zagraniczny', other: 'Inne',
};
const payrollLabels: Record<string, string> = {
  salary: 'Wynagrodzenie', advance: 'Zaliczka', tax: 'Podatek', zus: 'ZUS', reimbursement: 'Zwrot kosztów', other: 'Inna płatność',
};

function money(value?: number | null, currency?: string | null) {
  if (value == null || !Number.isFinite(Number(value))) return 'Brak danych';
  return `${Number(value).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency || ''}`.trim();
}

function date(value?: string | null) {
  if (!value) return 'Nie zapisano';
  const parsed = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString('pl-PL');
}

function text(value?: string | null) {
  return decodeTextEntities(value) || 'Nie zapisano';
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0"><dt className="mb-1 text-xs text-gray-400">{label}</dt><dd className="whitespace-pre-wrap break-words text-sm text-gray-100 [overflow-wrap:anywhere]">{children}</dd></div>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="min-w-0 rounded-xl bg-black/15 p-4"><h3 className="mb-4 text-sm font-semibold text-gray-100">{title}</h3>{children}</section>;
}

async function read<T>(query: PromiseLike<{ data: unknown; error: unknown }>): Promise<{ data: T | null; failed: boolean }> {
  try {
    const result = await query;
    return { data: result.error ? null : result.data as T | null, failed: Boolean(result.error) };
  } catch {
    return { data: null, failed: true };
  }
}

// Paginate only the selected payment's relations; never query the company-wide register.
async function readRelations<T>(table: string, fields: string, transactionId: string) {
  const rows: T[] = [];
  for (let from = 0; ; from += 200) {
    const result = await read<T[]>(supabase.from(table).select(fields)
      .eq('bank_transaction_id', transactionId).order('id').range(from, from + 199));
    if (result.failed) return { data: null, failed: true };
    const page = result.data || [];
    rows.push(...page);
    if (page.length < 200) return { data: rows, failed: false };
  }
}

async function readDocuments(allocations: Allocation[], legacyKsefId?: string | null) {
  const documents: Record<string, DocumentInfo> = {};
  const warnings: string[] = [];
  await Promise.all((['invoice', 'ksef', 'external'] as const).map(async (source) => {
    const ids = [...new Set(allocations.filter((item) => item.document_source === source)
      .map((item) => source === 'invoice' ? item.invoice_id : source === 'ksef' ? item.ksef_invoice_id : item.external_invoice_id)
      .filter((id): id is string => Boolean(id)))];
    if (source === 'ksef' && legacyKsefId && !ids.includes(legacyKsefId)) ids.push(legacyKsefId);
    if (!ids.length) return;
    const table = source === 'invoice' ? 'invoices' : source === 'ksef' ? 'ksef_invoices' : 'external_invoices';
    const fields = source === 'invoice'
      ? 'id,invoice_number,buyer_name,issue_date,payment_due_date,total_gross,currency_code,ksef_reference_number,payment_status'
      : source === 'ksef'
        ? 'id,invoice_number,buyer_name,seller_name,invoice_type,issue_date,payment_due_date,gross_amount,currency,ksef_reference_number,payment_status'
        : 'id,invoice_number,seller_name,invoice_date,amount_gross,currency,payment_status';
    for (let start = 0; start < ids.length; start += 100) {
      const result = await read<Record<string, unknown>[]>(supabase.from(table).select(fields).in('id', ids.slice(start, start + 100)));
      if (result.failed) {
        warnings.push(`Nie udało się odczytać szczegółów dokumentów: ${sourceLabels[source]}. Powiązania nadal pokazano z rejestru płatności.`);
        continue;
      }
      for (const row of result.data || []) {
        documents[`${source}:${row.id}`] = {
          id: String(row.id), number: row.invoice_number as string | null,
          party: (source === 'external' || (source === 'ksef' && row.invoice_type === 'received') ? row.seller_name : row.buyer_name) as string | null,
          issueDate: (row.issue_date || row.invoice_date || null) as string | null,
          dueDate: (row.payment_due_date || null) as string | null,
          amount: (row.total_gross ?? row.gross_amount ?? row.amount_gross ?? null) as number | null,
          currency: (row.currency_code || row.currency || null) as string | null,
          reference: (row.ksef_reference_number || null) as string | null,
          paymentStatus: (row.payment_status || null) as string | null,
        };
      }
    }
  }));
  return { documents, warnings };
}

export default function BankTransactionDetailsModal({ transaction, onClose, onMatchDocuments, onMatchPersonnel, onExplain, onDescribe }: Props) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const openingChildRef = useRef(false);
  const [details, setDetails] = useState<Details | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  closeRef.current = onClose;

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeRef.current();
      } else if (event.key === 'Tab') {
        event.stopImmediatePropagation();
        const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])',
        ) || []).filter((item) => item.offsetParent !== null);
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first) { event.preventDefault(); dialogRef.current?.focus(); return; }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current || !dialogRef.current?.contains(document.activeElement))) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current?.contains(document.activeElement))) {
          event.preventDefault(); first.focus();
        }
      }
    };
    document.addEventListener('keydown', handleKey, true);
    return () => {
      document.removeEventListener('keydown', handleKey, true);
      if (openingChildRef.current) return;
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
      else document.querySelector<HTMLButtonElement>(`[data-bank-transaction-actions="${CSS.escape(transaction.id)}"]`)?.focus();
    };
  }, [transaction.id]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setDetails(null);
    const load = async () => {
      // Zapis analizy AI zawiera ID transakcji, ale starsze raporty nie mają ID wyciągu.
      // Pełne dane i powiązania zawsze odczytujemy z bazy z uprawnieniami użytkownika.
      let bankQuery = supabase.from('bank_transactions').select('*').eq('id', transaction.id);
      if (transaction.statement_id) bankQuery = bankQuery.eq('statement_id', transaction.statement_id);
      const bank = await read<BankTransactionDetailsTransaction>(bankQuery.maybeSingle());
      if (cancelled) return;
      if (bank.failed || !bank.data) {
        setError('Nie udało się pobrać aktualnej transakcji. Mogła zostać usunięta albo Twoje konto nie ma dostępu.');
        setLoading(false);
        return;
      }
      const row = bank.data;
      const [source, ledger, personnelPermission, personnelManagePermission, managePermission, supporting] = await Promise.all([
        read<Statement>(supabase.from('bank_statements').select(STATEMENT_FIELDS).eq('id', row.statement_id).maybeSingle()),
        readRelations<Allocation>('bank_transaction_invoice_matches', 'id,document_source,invoice_id,ksef_invoice_id,external_invoice_id,amount,currency,document_amount,document_currency,exchange_rate,match_method,match_reasons,created_at', row.id),
        read<boolean>(supabase.rpc('can_view_personnel_contracts')),
        read<boolean>(supabase.rpc('can_manage_personnel_contracts')),
        read<boolean>(supabase.rpc('finance_can_manage')),
        readRelations<SupportingDocument>('bank_transaction_supporting_documents', 'id,title,document_type,document_date,amount,currency,original_file_name,notes', row.id),
      ]);
      const warnings: string[] = [];
      const sourceVerified = Boolean(source.data?.my_company_id && source.data.my_company_id === transaction.company_id);
      if (!sourceVerified) warnings.push('Nie można potwierdzić źródłowego wyciągu i działalności. Dopasowanie jest zablokowane do czasu ponownego odczytu.');
      if (ledger.failed) warnings.push('Nie udało się odczytać rejestru dopasowań faktur. To nie oznacza, że transakcja nie ma dopasowań.');
      if (supporting.failed) warnings.push('Nie udało się odczytać dokumentów do wyjaśnienia tej transakcji.');
      if (managePermission.failed) warnings.push('Nie udało się potwierdzić uprawnień do zmiany rozliczenia.');
      if (personnelPermission.failed) warnings.push('Nie udało się potwierdzić dostępu do rozliczeń kadrowych.');
      const personnel = personnelPermission.data === true
        ? await readRelations<PersonnelPayment>('personnel_contract_payments', 'id,payment_date,amount,currency,payment_type,recipient_name,title,notes,personnel_contracts!personnel_contract_payments_personnel_contract_id_fkey(contract_number,title)', row.id)
        : { data: null, failed: false };
      if (personnel.failed) warnings.push('Nie udało się odczytać powiązanych płatności kadrowych. Nie są traktowane jako brak dopasowań.');
      const allocations = ledger.data || [];
      const payroll = personnel.data || [];
      const invoiceAllocated = allocations.reduce((sum, item) => sum + Number(item.amount), 0);
      const payrollAllocated = payroll.reduce((sum, item) => sum + Number(item.amount), 0);
      const visibleAllocated = invoiceAllocated + payrollAllocated;
      const storedAllocated = Number(row.allocated_amount || 0);
      const legacy = Boolean(row.matched_invoice_id && !allocations.some((item) => item.ksef_invoice_id === row.matched_invoice_id));
      const allocationsComplete = !ledger.failed && !personnel.failed && !legacy
        && Math.abs(visibleAllocated - storedAllocated) <= 0.01
        && allocations.length + payroll.length === Number(row.matched_document_count || 0);
      if (!allocationsComplete && !ledger.failed && !personnel.failed) warnings.push('Podgląd nie obejmuje całego zapisanego rozliczenia lub stan wymaga sprawdzenia. Część powiązań może być niedostępna dla Twojego konta. Akcje rozliczenia są zablokowane.');
      const documentResult = await readDocuments(allocations, legacy ? row.matched_invoice_id : null);
      warnings.push(...documentResult.warnings);
      let paired: Details['paired'] = null;
      if (row.paired_bank_transaction_id) {
        const pair = await read<BankTransactionDetailsTransaction>(supabase.from('bank_transactions')
          .select('id,statement_id,transaction_date,posting_date,amount,currency,transaction_type,counterparty_name,counterparty_account,title,reference_number,paired_bank_transaction_id')
          .eq('id', row.paired_bank_transaction_id).maybeSingle());
        if (pair.failed || !pair.data) warnings.push('Druga strona powiązanego transferu VAT jest niedostępna.');
        else {
          const pairStatement = await read<Statement>(supabase.from('bank_statements').select(STATEMENT_FIELDS).eq('id', pair.data.statement_id).maybeSingle());
          if (!pairStatement.data || pairStatement.data.my_company_id !== source.data?.my_company_id) warnings.push('Nie można potwierdzić wyciągu drugiej strony transferu VAT.');
          else paired = { transaction: pair.data, statement: pairStatement.data };
        }
      }
      if (cancelled) return;
      setDetails({
        fresh: { ...row, company_id: source.data?.my_company_id || transaction.company_id, posting_date: row.posting_date || '',
          amount: Number(row.amount), allocated_amount: Math.max(storedAllocated, visibleAllocated), manual_match: Boolean(row.manual_match) },
        statement: source.data, allocations, documents: documentResult.documents, personnel: payroll,
        supporting: supporting.data || [], paired, warnings,
        canManage: sourceVerified && managePermission.data === true,
        canViewPersonnel: personnelPermission.data === true,
        canManagePersonnel: personnelManagePermission.data === true,
        allocationsComplete,
      });
      setLoading(false);
    };
    void load().catch(() => {
      if (!cancelled) { setError('Nie udało się odczytać pełnych szczegółów. Spróbuj ponownie — żadne dane nie zostały zmienione.'); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [transaction.id, transaction.statement_id, transaction.company_id, revision]);

  const fresh = details?.fresh;
  const allocated = Number(fresh?.allocated_amount || 0);
  const total = Math.abs(Number(fresh?.amount || 0));
  const remaining = Math.max(Math.round((total - allocated) * 100) / 100, 0);
  const canChange = Boolean(!loading && fresh && details?.canManage && details.allocationsComplete && !fresh.private_transfer_detected && !fresh.paired_bank_transaction_id);
  const canMatch = canChange && remaining > 0.009 && fresh?.match_status !== 'matched' && fresh?.accounting_review_status !== 'explained';
  const canExplain = canChange && allocated <= 0.009 && !fresh?.matched_invoice_id && !fresh?.matched_document_count;
  const hasActions = Boolean(onMatchDocuments || onMatchPersonnel || onExplain || onDescribe);
  const openChild = (callback: Props['onMatchDocuments']) => {
    if (!fresh || !callback) return;
    openingChildRef.current = true;
    callback(fresh);
  };
  const status = fresh?.private_transfer_detected ? 'Przelew prywatny'
    : fresh?.accounting_review_status === 'explained' ? 'Wyjaśniona bez faktury'
      : fresh?.match_status === 'matched' ? 'W pełni dopasowana'
        : allocated > 0.009 ? 'Częściowo dopasowana' : 'Niedopasowana';
  const buttonClass = 'inline-flex items-center justify-center gap-2 rounded-lg bg-white/5 px-4 py-2.5 text-sm text-gray-100 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4bf73]/35 disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <div className="fixed inset-0 z-[10060] flex items-center justify-center bg-black/75 p-3 sm:p-6" onClick={(event) => event.stopPropagation()} onMouseDown={(event) => { event.stopPropagation(); if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={loading} tabIndex={-1}
        className="flex max-h-[92dvh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-[#191a29] text-gray-100 shadow-2xl outline-none ring-1 ring-white/10"
        style={{ fontFamily: "Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
        <header className="flex items-start justify-between gap-4 bg-[#401426] px-5 py-4">
          <div><h2 id={titleId} className="text-lg font-semibold">Szczegóły transakcji</h2><p className="mt-1 text-xs text-gray-400">Pełne dane z wyciągu i aktualne rozliczenie zapisane w CRM.</p></div>
          <button type="button" onClick={onClose} aria-label="Zamknij szczegóły transakcji" className={`${buttonClass} !p-2`}><X size={20} /></button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
          {loading && <div role="status" className="flex items-center justify-center gap-3 py-14 text-sm text-gray-300"><Loader2 size={22} className="animate-spin text-[#d4bf73]" />Pobieram aktualne szczegóły i powiązania…</div>}
          {error && <div role="alert" className="rounded-xl bg-amber-500/10 p-4 text-sm text-amber-200">{error}<button type="button" className={`${buttonClass} mt-4 flex`} onClick={() => setRevision((value) => value + 1)}><RefreshCw size={16} />Spróbuj ponownie</button></div>}
          {!loading && details && fresh && <>
            {!!details.warnings.length && <div role="status" className="space-y-2 rounded-xl bg-amber-500/10 p-4 text-sm text-amber-200"><div className="flex items-center gap-2 font-medium"><AlertTriangle size={17} />Nie wszystkie informacje są dostępne</div>{details.warnings.map((warning, index) => <p key={index}>{warning}</p>)}<button type="button" className={buttonClass} onClick={() => setRevision((value) => value + 1)}><RefreshCw size={15} />Ponów odczyt</button></div>}
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-white/5 p-4"><p className="text-xs text-gray-400">{fresh.transaction_type === 'credit' ? 'Wpłata' : 'Wydatek'} — kwota operacji</p><p className={`mt-1 text-xl font-semibold ${fresh.transaction_type === 'credit' ? 'text-green-400' : 'text-red-400'}`}>{fresh.transaction_type === 'credit' ? '+' : '−'}{money(total, fresh.currency)}</p></div>
              <div className="rounded-xl bg-white/5 p-4"><p className="text-xs text-gray-400">Przypisano do faktur i płac</p><p className="mt-1 text-xl font-semibold">{money(allocated, fresh.currency)}</p></div>
              <div className="rounded-xl bg-white/5 p-4"><p className="text-xs text-gray-400">{fresh.accounting_review_status === 'explained' || fresh.private_transfer_detected ? 'Kwota nieprzypisana do dokumentów' : 'Pozostało do przypisania'}</p><p className="mt-1 text-xl font-semibold text-[#d4bf73]">{money(remaining, fresh.currency)}</p><p className="mt-2 text-xs text-gray-300">{status}</p></div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Section title="Dane operacji"><dl className="grid gap-4 sm:grid-cols-2">
                <Field label="Data operacji / płatności">{date(fresh.transaction_date)}</Field><Field label="Data księgowania">{date(fresh.posting_date)}</Field>
                <div className="sm:col-span-2"><Field label={fresh.transaction_type === 'credit' ? 'Nadawca' : 'Odbiorca'}>{repairBrokenBankText(fresh.counterparty_name) || 'Brak rozpoznanej nazwy — sprawdź pełny opis bankowy poniżej.'}</Field></div>
                <div className="sm:col-span-2"><Field label="Rachunek kontrahenta">{text(fresh.counterparty_account)}</Field></div>
                <div className="sm:col-span-2"><Field label="Pełny tytuł przelewu">{repairBrokenBankText(fresh.title) || 'Nie zapisano'}</Field></div>
                <div className="sm:col-span-2"><Field label="Numer referencyjny banku">{text(fresh.reference_number)}</Field></div>
              </dl></Section>
              <Section title="Źródłowy wyciąg"><dl className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2"><Field label="Plik">{details.statement ? text(details.statement.file_name) : 'Wyciąg niedostępny'}</Field></div>
                <Field label="Format">{text(details.statement?.import_format || details.statement?.file_type)}</Field>
                <Field label="Miesiąc wyciągu">{details.statement?.statement_month && details.statement.statement_year ? `${details.statement.statement_month}/${details.statement.statement_year}` : 'Nie zapisano'}</Field>
                <Field label="Typ rachunku">{details.statement?.account_type === 'vat' ? 'Rachunek VAT' : details.statement?.account_type ? 'Rachunek bieżący' : 'Nie zapisano'}</Field>
                <Field label="Stan importu">{details.statement ? details.statement.processed && details.statement.validation_status === 'valid' ? 'Przetworzony i zweryfikowany' : 'Import wymaga sprawdzenia' : 'Niedostępny'}</Field>
                <div className="sm:col-span-2"><Field label="Rachunek na wyciągu">{text(details.statement?.account_number)}</Field></div>
              </dl></Section>
            </div>
            <Section title="Klasyfikacja i wyjaśnienia"><dl className="grid gap-4 sm:grid-cols-2">
              <Field label="Status rozliczenia">{status}</Field>
              <Field label="Kontrola księgowa">{fresh.accounting_review_status === 'explained' ? 'Wyjaśniona' : fresh.accounting_review_status === 'pending' ? 'Do wyjaśnienia' : 'Nie oznaczono'}</Field>
              <Field label="Kategoria">{fresh.accounting_category ? categoryLabels[fresh.accounting_category] || fresh.accounting_category : 'Nie przypisano'}</Field>
              <Field label="Rodzaj operacji">{BANK_ACCOUNTING_ACTIONS.find((action) => action.subtype === fresh.accounting_subtype)?.label || fresh.accounting_subtype || 'Nie przypisano'}</Field>
              {fresh.private_transfer_detected && <Field label="Oznaczenie przelewu prywatnego">{text(fresh.private_transfer_owner)}</Field>}
              <div className="sm:col-span-2"><Field label="Notatka księgowa / powód pozostawienia do wyjaśnienia">{text(fresh.accounting_note)}</Field></div>
            </dl></Section>
            <Section title="Zapisane dopasowania faktur">
              {!details.allocations.length ? <p className="text-sm text-gray-400">{details.allocationsComplete ? 'Brak zapisanych dopasowań faktur do tej transakcji.' : 'Nie można potwierdzić pełnej listy powiązań — sprawdź komunikaty powyżej.'}</p> : <div className="space-y-3">{details.allocations.map((allocation) => {
                const documentId = allocation.invoice_id || allocation.ksef_invoice_id || allocation.external_invoice_id;
                const document = details.documents[`${allocation.document_source}:${documentId}`];
                const documentCurrency = allocation.document_currency || allocation.currency;
                return <article key={allocation.id} className="rounded-lg bg-white/5 p-4">
                  <div className="mb-3 flex flex-wrap items-start justify-between gap-2"><p className="break-words text-sm font-semibold [overflow-wrap:anywhere]">{sourceLabels[allocation.document_source]} · {document?.number ? text(document.number) : 'Szczegóły dokumentu niedostępne'}</p><span className="text-xs text-gray-400">{allocation.match_method === 'automatic' ? 'Automatyczne' : allocation.match_method === 'legacy' ? 'Przeniesione ze starszego rozliczenia' : 'Zatwierdzone ręcznie'} · {date(allocation.created_at)}</span></div>
                  <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <Field label="Przypisano z tej płatności">{money(allocation.amount, allocation.currency)}</Field><Field label="Rozliczono w walucie dokumentu">{money(allocation.document_amount ?? allocation.amount, documentCurrency)}</Field>
                    <Field label="Pełna wartość dokumentu">{document ? money(document.amount, document.currency) : 'Brak dostępu do dokumentu'}</Field>
                    <Field label="Kontrahent">{document ? text(document.party) : 'Brak dostępu do dokumentu'}</Field><Field label="Wystawienie">{document ? date(document.issueDate) : 'Niedostępne'}</Field><Field label="Termin płatności">{document ? date(document.dueDate) : 'Niedostępny'}</Field>
                    {document?.reference && <div className="sm:col-span-2 lg:col-span-3"><Field label="Numer KSeF">{document.reference}</Field></div>}
                    {documentCurrency !== allocation.currency && <div className="sm:col-span-2 lg:col-span-3"><Field label="Zapisane przewalutowanie">{Number(allocation.exchange_rate) > 0 ? `1 ${documentCurrency} = ${Number(allocation.exchange_rate).toLocaleString('pl-PL', { maximumFractionDigits: 8 })} ${allocation.currency}` : 'Nie zapisano kursu'} — kurs wynikający z przypisanych kwot, nie bieżący kurs rynkowy.</Field></div>}
                    {!!allocation.match_reasons?.length && <div className="sm:col-span-2 lg:col-span-3"><Field label="Podstawa dopasowania">{allocation.match_reasons.map((reason) => text(reason)).join('\n')}</Field></div>}
                  </dl>
                </article>;
              })}</div>}
              {fresh.matched_invoice_id && !details.allocations.some((item) => item.ksef_invoice_id === fresh.matched_invoice_id) && <p className="mt-3 break-words text-sm text-amber-200">Starsze powiązanie KSeF: {details.documents[`ksef:${fresh.matched_invoice_id}`]?.number || fresh.matched_invoice_id}. Brak odpowiadającego wpisu w dostępnym rejestrze alokacji — nie dopisuj kolejnej płatności bez wyjaśnienia.</p>}
            </Section>
            <Section title="Powiązane płatności kadrowe">
              {!details.canViewPersonnel ? <p className="text-sm text-gray-400">Szczegóły płac i umów są dostępne wyłącznie z uprawnieniem kadrowym. Brak widoczności nie oznacza braku powiązanej wypłaty.</p>
                : !details.personnel.length ? <p className="text-sm text-gray-400">{details.allocationsComplete ? 'Brak powiązanych płatności kadrowych.' : 'Nie można potwierdzić kompletności rozliczenia kadrowego.'}</p>
                  : <div className="space-y-3">{details.personnel.map((payment) => { const contract = Array.isArray(payment.personnel_contracts) ? payment.personnel_contracts[0] : payment.personnel_contracts; return <article key={payment.id} className="rounded-lg bg-white/5 p-4"><dl className="grid gap-3 sm:grid-cols-2"><Field label={payrollLabels[payment.payment_type] || payment.payment_type}>{money(payment.amount, payment.currency)}</Field><Field label="Data płatności">{date(payment.payment_date)}</Field><Field label="Odbiorca">{text(payment.recipient_name)}</Field><Field label="Umowa">{contract ? text(contract.contract_number) : 'Umowa niedostępna'}</Field><div className="sm:col-span-2"><Field label="Tytuł">{text(payment.title)}</Field></div>{payment.notes && <div className="sm:col-span-2"><Field label="Uwagi kadrowe">{text(payment.notes)}</Field></div>}</dl></article>; })}</div>}
            </Section>
            {fresh.paired_bank_transaction_id && <Section title="Powiązany transfer między rachunkami"><div className="mb-3 flex items-center gap-2 text-sm text-sky-300"><ArrowRightLeft size={17} />To druga strona transferu, a nie dodatkowa płatność faktury.</div>{details.paired ? <dl className="grid gap-3 sm:grid-cols-2"><Field label="Data">{date(details.paired.transaction.transaction_date)}</Field><Field label="Kwota">{details.paired.transaction.transaction_type === 'credit' ? '+' : '−'}{money(Math.abs(details.paired.transaction.amount), details.paired.transaction.currency)}</Field><Field label="Rachunek">{text(details.paired.statement?.account_number)}</Field><Field label="Wyciąg">{text(details.paired.statement?.file_name)}</Field><div className="sm:col-span-2"><Field label="Tytuł">{text(details.paired.transaction.title)}</Field></div></dl> : <p className="text-sm text-gray-400">Szczegóły drugiej strony są niedostępne.</p>}</Section>}
            {!!details.supporting.length && <Section title="Dokumenty do wyjaśnienia operacji"><div className="space-y-3">{details.supporting.map((document) => <article key={document.id} className="rounded-lg bg-white/5 p-4"><dl className="grid gap-3 sm:grid-cols-2"><Field label="Dokument">{text(document.title)}</Field><Field label="Plik źródłowy">{text(document.original_file_name)}</Field><Field label="Data dokumentu">{date(document.document_date)}</Field><Field label="Kwota dokumentu">{money(document.amount, document.currency)}</Field>{document.notes && <div className="sm:col-span-2"><Field label="Uwagi">{text(document.notes)}</Field></div>}</dl></article>)}</div></Section>}
            <details className="rounded-xl bg-black/15 p-4"><summary className="cursor-pointer text-sm font-medium text-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4bf73]/35">Pełny opis bankowy i dane techniczne</summary><p className="my-3 text-xs text-gray-400">Oryginalne pola zapisane przy imporcie, bez skracania i naprawiania treści. Ich brak oznacza, że importer nie zachował danego pola.</p><dl className="grid gap-4"><Field label="Surowy opis operacji">{fresh.raw_description || 'Nie zapisano surowego opisu.'}</Field><Field label="Surowe dane kontrahenta">{fresh.raw_counterparty || 'Nie zapisano surowych danych kontrahenta.'}</Field><Field label="Oryginalny zapis tytułu">{fresh.title || 'Nie zapisano'}</Field><Field label="Oryginalny zapis kontrahenta">{fresh.counterparty_name || 'Nie zapisano'}</Field><Field label="ID transakcji">{fresh.id}</Field><Field label="ID wyciągu">{fresh.statement_id}</Field><Field label="Data zapisania w CRM">{date(fresh.created_at)}</Field></dl></details>
          </>}
        </div>

        <footer className="shrink-0 space-y-3 bg-black/20 px-5 py-4">
          {!hasActions && <p className="text-xs text-gray-400">Podgląd aktualnych danych — otwarcie szczegółów nie zmienia transakcji ani jej powiązań.</p>}
          {hasActions && !loading && details && <p className="text-xs text-gray-400">{!details.canManage ? 'Podgląd jest tylko do odczytu — brak potwierdzonych uprawnień do zmiany rozliczenia.' : !details.allocationsComplete ? 'Najpierw odczytaj lub wyjaśnij pełny stan istniejących powiązań.' : fresh?.paired_bank_transaction_id ? 'Transfer został powiązany z drugim rachunkiem i nie wymaga dopasowania faktury.' : fresh?.private_transfer_detected ? 'Operacja jest oznaczona jako prywatna; dopasowanie faktury jest zablokowane.' : fresh?.accounting_review_status === 'explained' ? 'Operacja została wyjaśniona bez faktury. Możesz otworzyć jej wyjaśnienie.' : remaining <= 0.009 ? 'Cała płatność została już przypisana. Nie trzeba dopasowywać jej ponownie.' : allocated > 0.009 ? 'Nowe dopasowanie obejmie wyłącznie pozostałą kwotę. Istniejące powiązania pozostaną bez zmian.' : 'Wybierz dokument z bazy, płatność kadrową albo wyjaśnij operację bez faktury.'}</p>}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {onDescribe && <button type="button" className={buttonClass} disabled={loading || !fresh || !details?.canManage} onClick={() => openChild(onDescribe)}><MessageSquareText size={16} />Opisz płatność</button>}
            {onExplain && <button type="button" className={buttonClass} disabled={!canExplain} onClick={() => openChild(onExplain)}><FileText size={16} />{fresh?.accounting_review_status === 'explained' ? 'Otwórz wyjaśnienie' : 'Wyjaśnij bez faktury'}</button>}
            {onMatchPersonnel && <button type="button" className={buttonClass} disabled={!canMatch || !details?.canManagePersonnel || fresh?.transaction_type !== 'debit'} onClick={() => openChild(onMatchPersonnel)}><UserRound size={16} />Dopasuj płatność kadrową</button>}
            {onMatchDocuments && <button type="button" className={`${buttonClass} !bg-[#d4bf73] !text-[#191a29] hover:!bg-[#e0cc8b]`} disabled={!canMatch} onClick={() => openChild(onMatchDocuments)}><LinkIcon size={16} />Otwórz dopasowanie dokumentów</button>}
            <button type="button" className={buttonClass} onClick={onClose}>Zamknij</button>
          </div>
        </footer>
      </div>
    </div>
  );
}
