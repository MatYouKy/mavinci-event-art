'use client';

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  X,
  Download,
  Link as LinkIcon,
  Calendar,
  FileText,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  RefreshCw,
  ArrowRightLeft,
  MoreVertical,
  ReceiptText,
  UserRound,
} from 'lucide-react';
import {
  applyBankTransactionMatchToDocument,
  isBankStatementMatchablePaymentMethod,
  reconcileExternalInvoiceWithBankTransaction,
  removeBankTransactionMatch,
} from '@/lib/bankTransactionMatching';
import BankAiAnalysisPanel from './BankAiAnalysisPanel';
import BankTransactionAccountingModal from './BankTransactionAccountingModal';
import type { AccountingTransaction, BankAccountingSubtype } from './BankTransactionAccountingModal';
import BankTransactionDocumentPickerModal from './BankTransactionDocumentPickerModal';
import type { DocumentPickerTransaction } from './BankTransactionDocumentPickerModal';
import { repairBrokenBankText } from '@/lib/bankTextEncoding';
import { decodeTextEntities } from '@/lib/textEncoding';

interface InvoiceRelation {
  id?: string;
  invoice_number: string;
  ksef_reference_number: string;
  buyer_name: string;
  seller_name?: string;
  issue_date: string;
  payment_due_date: string;
  gross_amount: number;
  net_amount?: number;
  payment_status?: string;
  invoice_type?: 'issued' | 'received';
}

interface Transaction {
  id: string;
  statement_id: string;
  company_id: string;
  transaction_date: string;
  posting_date: string;
  amount: number;
  currency: string;
  transaction_type: 'debit' | 'credit';
  counterparty_name?: string;
  counterparty_account?: string;
  title?: string;
  reference_number?: string;
  matched_invoice_id?: string;
  match_confidence?: number;
  manual_match: boolean;
  match_status?: 'unmatched' | 'partial' | 'matched';
  allocated_amount?: number;
  matched_document_count?: number;
  private_transfer_detected?: boolean;
  private_transfer_owner?: string | null;
  accounting_note?: string | null;
  accounting_category?: string | null;
  accounting_subtype?: string | null;
  accounting_review_status?: 'pending' | 'explained' | null;
  invoice?: InvoiceRelation | InvoiceRelation[];
}

interface KSeFInvoice {
  source: 'ksef' | 'external';
  id: string;
  invoice_number?: string | null;
  ksef_reference_number?: string | null;
  buyer_name?: string | null;
  seller_name?: string | null;
  issue_date?: string | null;
  payment_due_date?: string | null;
  gross_amount?: number | null;
  net_amount?: number | null;
  payment_status?: string | null;
  invoice_type?: 'issued' | 'received' | null;
  ksef_issued_at?: string | null;
  payment_method?: string | null;
  currency?: string | null;
}

interface Props {
  month: number;
  year: number;
  companyId?: string | null;
  onClose: () => void;
}

function getInvoiceObject(invoice?: InvoiceRelation | InvoiceRelation[]) {
  if (!invoice) return null;
  return Array.isArray(invoice) ? (invoice[0] ?? null) : invoice;
}

function isTransactionFullyMatched(transaction: Transaction) {
  return transaction.match_status === 'matched' ||
    (!transaction.match_status && Boolean(transaction.matched_invoice_id));
}

function isTransactionResolved(transaction: Transaction) {
  return Boolean(transaction.private_transfer_detected)
    || transaction.accounting_review_status === 'explained'
    || isTransactionFullyMatched(transaction);
}

const accountingCategoryLabels: Record<string, string> = {
  bank_fee: 'Opłata lub prowizja bankowa',
  tax_or_zus: 'Podatek lub ZUS',
  payroll: 'Wynagrodzenie',
  own_transfer: 'Przelew własny',
  cash: 'Rozliczenie gotówkowe',
  foreign_purchase: 'Zakup zagraniczny',
  other: 'Inne wyjaśnienie',
};

function accountingCategoryLabel(transaction: Transaction) {
  return accountingCategoryLabels[transaction.accounting_category || 'other'] || 'Wyjaśniona operacja';
}

function accountingSubtypeForTransaction(transaction: Transaction): BankAccountingSubtype {
  if (transaction.accounting_subtype) return transaction.accounting_subtype as BankAccountingSubtype;
  if (transaction.accounting_category === 'bank_fee') return 'bank_fee';
  if (transaction.accounting_category === 'payroll') return 'payroll_payment';
  if (transaction.accounting_category === 'own_transfer') return 'own_transfer';
  if (transaction.accounting_category === 'cash') return 'cash_settlement';
  if (transaction.accounting_category === 'foreign_purchase') return 'supplier_invoice_missing';
  return 'other';
}

function hasTransactionMatches(transaction: Transaction) {
  return Number(transaction.allocated_amount || 0) > 0 || Boolean(transaction.matched_invoice_id);
}

function getExpectedTransactionDirection(invoice: KSeFInvoice): Transaction['transaction_type'] {
  const amountIsPositive = Number(invoice.gross_amount || 0) >= 0;

  if (invoice.source === 'external') {
    return amountIsPositive ? 'debit' : 'credit';
  }

  if (invoice.invoice_type === 'issued') {
    return amountIsPositive ? 'credit' : 'debit';
  }

  return amountIsPositive ? 'debit' : 'credit';
}

function safeDate(value?: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pl-PL');
}

function safeMoney(value?: number | null, currency = 'PLN') {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return `${Number(value).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} ${currency}`;
}

function sanitizeBrokenPolish(text?: string | null) {
  return repairBrokenBankText(text);
}

function normalizeForSearch(text?: string | null) {
  return sanitizeBrokenPolish(text)
    .toUpperCase()
    .replace(/[Ą]/g, 'A')
    .replace(/[Ć]/g, 'C')
    .replace(/[Ę]/g, 'E')
    .replace(/[Ł]/g, 'L')
    .replace(/[Ń]/g, 'N')
    .replace(/[Ó]/g, 'O')
    .replace(/[Ś]/g, 'S')
    .replace(/[Ź]/g, 'Z')
    .replace(/[Ż]/g, 'Z')
    .replace(/[^A-Z0-9]/g, '');
}

type SortField = 'date' | 'amount' | 'counterparty' | 'title' | 'invoice_number' | 'invoice_date' | 'invoice_amount' | 'contractor';
type SortDirection = 'asc' | 'desc';

export default function BankTransactionsAnalysis({ month, year, companyId, onClose }: Props) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [ksefInvoices, setKsefInvoices] = useState<KSeFInvoice[]>([]);
  const [matchedDocumentKeys, setMatchedDocumentKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<'all' | 'matched' | 'unmatched' | 'explained' | 'private'>('all');
  const [matchModalOpen, setMatchModalOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<KSeFInvoice | null>(null);
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);
  const [documentPicker, setDocumentPicker] = useState<{
    transaction: Transaction;
    source: 'all' | 'personnel';
  } | null>(null);
  const [accountingEditor, setAccountingEditor] = useState<{
    transaction: Transaction;
    subtype: BankAccountingSubtype;
  } | null>(null);
  const [transactionSort, setTransactionSort] = useState<{ field: SortField; direction: SortDirection }>({ field: 'date', direction: 'desc' });
  const [invoiceSort, setInvoiceSort] = useState<{ field: SortField; direction: SortDirection }>({ field: 'invoice_date', direction: 'desc' });
  const { showSnackbar } = useSnackbar();

  useEffect(() => {
    loadData();
  }, [month, year, companyId]);

  const loadData = async ({ silent = false }: { silent?: boolean } = {}) => {
    try {
      if (!silent) setLoading(true);

      let statementsQuery = supabase
        .from('bank_statements')
        .select('id,my_company_id')
        .eq('statement_month', month)
        .eq('statement_year', year)
        .eq('processed', true)
        .eq('validation_status', 'valid');

      if (companyId) {
        statementsQuery = statementsQuery.eq('my_company_id', companyId);
      }

      const { data: statements, error: statementsError } = await statementsQuery;

      if (statementsError) throw statementsError;

      if (!statements || statements.length === 0) {
        setTransactions([]);
      } else {
        const statementIds = statements.map((s) => s.id);

        const { data: transactionsData, error } = await supabase
          .from('bank_transactions')
          .select(`
            *,
            invoice:ksef_invoices(
              id,
              invoice_number,
              ksef_reference_number,
              buyer_name,
              seller_name,
              issue_date,
              payment_due_date,
              gross_amount,
              net_amount,
              payment_status,
              invoice_type
            )
          `)
          .in('statement_id', statementIds)
          .order('transaction_date', { ascending: false });

        if (error) throw error;
        const statementCompanies = new Map(
          statements.map((statement) => [statement.id, statement.my_company_id || '']),
        );
        setTransactions((transactionsData || []).map((transaction) => ({
          ...transaction,
          company_id: statementCompanies.get(transaction.statement_id) || '',
        })));
      }

      const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
      const monthEndDate = new Date(year, month, 0);
      const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(monthEndDate.getDate()).padStart(2, '0')}`;

      let invoicesQuery = supabase
        .from('ksef_invoices')
        .select(`
          id,
          invoice_number,
          ksef_reference_number,
          buyer_name,
          seller_name,
          issue_date,
          payment_due_date,
          gross_amount,
          net_amount,
          payment_status,
          invoice_type,
          ksef_issued_at,
          payment_method,
          currency
        `)
        .or(
          `and(issue_date.gte.${monthStart},issue_date.lte.${monthEnd}),and(issue_date.is.null,ksef_issued_at.gte.${monthStart}T00:00:00,ksef_issued_at.lte.${monthEnd}T23:59:59)`
        )
        .order('issue_date', { ascending: false });

      if (companyId) {
        invoicesQuery = invoicesQuery.eq('my_company_id', companyId);
      }

      const { data: invoicesData, error: invoicesError } = await invoicesQuery;

      if (invoicesError) throw invoicesError;

      let externalInvoicesQuery = supabase
        .from('external_invoices')
        .select('id,invoice_number,seller_name,invoice_date,amount_gross,amount_net,currency,payment_status,payment_method')
        .gte('invoice_date', monthStart)
        .lte('invoice_date', monthEnd)
        .neq('payment_status', 'cancelled')
        .order('invoice_date', { ascending: false });
      if (companyId) {
        externalInvoicesQuery = externalInvoicesQuery.eq('my_company_id', companyId);
      }
      const { data: externalInvoicesData, error: externalInvoicesError } = await externalInvoicesQuery;
      if (externalInvoicesError) throw externalInvoicesError;

      const visibleDocuments: KSeFInvoice[] = [
        ...(invoicesData || [])
          .filter((invoice) => isBankStatementMatchablePaymentMethod(invoice.payment_method, 'ksef'))
          .map((invoice) => ({
            ...invoice,
            source: 'ksef' as const,
            seller_name: decodeTextEntities(invoice.seller_name) || null,
            buyer_name: decodeTextEntities(invoice.buyer_name) || null,
          })),
        ...(externalInvoicesData || [])
          .filter((invoice) => isBankStatementMatchablePaymentMethod(invoice.payment_method, 'external'))
          .map((invoice) => ({
            source: 'external' as const,
            id: invoice.id,
            invoice_number: invoice.invoice_number,
            ksef_reference_number: null,
            buyer_name: null,
            seller_name: invoice.seller_name,
            issue_date: invoice.invoice_date,
            payment_due_date: null,
            gross_amount: invoice.amount_gross,
            net_amount: invoice.amount_net,
            payment_status: invoice.payment_status,
            invoice_type: 'received' as const,
            ksef_issued_at: null,
            payment_method: invoice.payment_method,
            currency: invoice.currency || 'PLN',
          })),
      ];
      setKsefInvoices(visibleDocuments);

      const loadMatchedDocuments = (
        column: 'ksef_invoice_id' | 'external_invoice_id',
        ids: string[],
      ) => ids.length > 0
        ? supabase.from('bank_transaction_invoice_matches').select(column).in(column, ids)
        : Promise.resolve({ data: [], error: null });
      const [matchedKsefResult, matchedExternalResult] = await Promise.all([
        loadMatchedDocuments('ksef_invoice_id', visibleDocuments.filter((document) => document.source === 'ksef').map((document) => document.id)),
        loadMatchedDocuments('external_invoice_id', visibleDocuments.filter((document) => document.source === 'external').map((document) => document.id)),
      ]);
      const matchedDocumentsError = matchedKsefResult.error || matchedExternalResult.error;
      if (matchedDocumentsError) throw matchedDocumentsError;
      setMatchedDocumentKeys(new Set([
        ...(matchedKsefResult.data || []).map((match: any) => `ksef:${match.ksef_invoice_id}`),
        ...(matchedExternalResult.data || []).map((match: any) => `external:${match.external_invoice_id}`),
      ]));
    } catch (error: any) {
      console.error('Error loading transactions/invoices:', error);
      showSnackbar(error.message || 'Błąd podczas ładowania danych analizy', 'error');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const handleManualMatch = async (transactionId: string, invoice: KSeFInvoice) => {
    try {
      const transaction = transactions.find((t) => t.id === transactionId);
      if (!transaction) throw new Error('Transakcja nie została znaleziona');

      if (invoice.source === 'external') {
        const transactionAmount = Math.max(
          Math.abs(Number(transaction.amount || 0)) - Number(transaction.allocated_amount || 0),
          0,
        );
        const documentAmount = Math.abs(Number(invoice.gross_amount || 0));
        const differentCurrency = String(transaction.currency || 'PLN').toUpperCase()
          !== String(invoice.currency || 'PLN').toUpperCase();
        await reconcileExternalInvoiceWithBankTransaction(supabase, {
          transactionId,
          externalInvoiceId: invoice.id,
          transactionAmount: differentCurrency ? transactionAmount : Math.min(transactionAmount, documentAmount),
          documentAmount: differentCurrency ? documentAmount : Math.min(transactionAmount, documentAmount),
          confidence: 1,
          reasons: ['Ręczne dopasowanie dokumentu spoza KSeF w analizie wyciągu'],
        });
      } else {
        await applyBankTransactionMatchToDocument(supabase, {
          transactionId,
          documentSource: 'ksef',
          documentId: invoice.id,
          confidence: 1,
          method: 'manual',
          reasons: ['Ręczne dopasowanie dokumentu KSeF w analizie wyciągu'],
        });
      }

      showSnackbar('Płatność została ręcznie dopasowana', 'success');
      setMatchModalOpen(false);
      setSelectedInvoice(null);
      await loadData();
    } catch (error: any) {
      console.error('Error matching:', error);
      showSnackbar(error.message || 'Błąd podczas dopasowywania płatności', 'error');
    }
  };

  const handleTransactionSort = (field: SortField) => {
    setTransactionSort((prev) => ({
      field,
      direction: prev.field === field && prev.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  const handleInvoiceSort = (field: SortField) => {
    setInvoiceSort((prev) => ({
      field,
      direction: prev.field === field && prev.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  const handleUnmatch = async (transactionId: string) => {
    try {
      await removeBankTransactionMatch(supabase, transactionId);

      showSnackbar('Dopasowanie zostało usunięte', 'success');
      await loadData();
    } catch (error: any) {
      console.error('Error unmatching:', error);
      showSnackbar(error.message || 'Błąd podczas usuwania dopasowania', 'error');
    }
  };

  const openMatchModal = (invoice: KSeFInvoice) => {
    setSelectedInvoice(invoice);
    setMatchModalOpen(true);
  };

  const filteredTransactions = useMemo(() => {
    let filtered = transactions.filter((t) => {
      if (filterType === 'matched') return isTransactionFullyMatched(t);
      if (filterType === 'unmatched') return !isTransactionResolved(t);
      if (filterType === 'explained') return t.accounting_review_status === 'explained';
      if (filterType === 'private') return Boolean(t.private_transfer_detected);
      return true;
    });

    return filtered.sort((a, b) => {
      const { field, direction } = transactionSort;
      const multiplier = direction === 'asc' ? 1 : -1;

      switch (field) {
        case 'date':
          return multiplier * (new Date(a.transaction_date).getTime() - new Date(b.transaction_date).getTime());
        case 'amount':
          return multiplier * (a.amount - b.amount);
        case 'counterparty':
          return multiplier * (a.counterparty_name || '').localeCompare(b.counterparty_name || '');
        case 'title':
          return multiplier * (a.title || '').localeCompare(b.title || '');
        default:
          return 0;
      }
    });
  }, [transactions, filterType, transactionSort]);

  const sortedInvoices = useMemo(() => {
    return [...ksefInvoices].sort((a, b) => {
      const { field, direction } = invoiceSort;
      const multiplier = direction === 'asc' ? 1 : -1;

      switch (field) {
        case 'invoice_number':
          return multiplier * (a.invoice_number || '').localeCompare(b.invoice_number || '');
        case 'invoice_date':
          return multiplier * (new Date(a.issue_date || a.ksef_issued_at || 0).getTime() - new Date(b.issue_date || b.ksef_issued_at || 0).getTime());
        case 'invoice_amount':
          return multiplier * ((a.gross_amount || 0) - (b.gross_amount || 0));
        case 'contractor':
          const contractorA = (a.invoice_type === 'issued' ? a.buyer_name : a.seller_name) || '';
          const contractorB = (b.invoice_type === 'issued' ? b.buyer_name : b.seller_name) || '';
          return multiplier * contractorA.localeCompare(contractorB);
        default:
          return 0;
      }
    });
  }, [ksefInvoices, invoiceSort]);

  const isDocumentMatched = (invoice: KSeFInvoice) => matchedDocumentKeys.has(`${invoice.source}:${invoice.id}`)
    || (invoice.source === 'ksef' && transactions.some((transaction) => transaction.matched_invoice_id === invoice.id));

  const stats = useMemo(
    () => ({
      total: transactions.length,
      matched: transactions.filter(isTransactionFullyMatched).length,
      unmatched: transactions.filter((t) => !isTransactionResolved(t)).length,
      explained: transactions.filter((t) => t.accounting_review_status === 'explained').length,
      privateTransfers: transactions.filter((t) => t.private_transfer_detected).length,
      totalAmount: transactions.reduce(
        (sum, t) => sum + (t.transaction_type === 'credit' ? t.amount : -t.amount),
        0,
      ),
      creditAmount: transactions
        .filter((t) => t.transaction_type === 'credit')
        .reduce((sum, t) => sum + t.amount, 0),
      debitAmount: transactions
        .filter((t) => t.transaction_type === 'debit')
        .reduce((sum, t) => sum + t.amount, 0),
    }),
    [transactions],
  );

  const exportToCSV = () => {
    const headers = [
      'Data transakcji',
      'Data księgowania',
      'Typ',
      'Kwota',
      'Waluta',
      'Kontrahent',
      'Numer konta',
      'Tytuł',
      'Status dopasowania',
      'Numer faktury',
      'Termin płatności',
      'Pewność dopasowania',
      'Dopasowanie ręczne',
    ].join(';');

    const rows = transactions.map((t) => {
      const invoice = getInvoiceObject(t.invoice);

      return [
        safeDate(t.transaction_date),
        safeDate(t.posting_date),
        t.transaction_type === 'credit' ? 'Wpłata' : 'Wypłata',
        t.amount.toFixed(2),
        t.currency,
        sanitizeBrokenPolish(t.counterparty_name || ''),
        t.counterparty_account || '',
        sanitizeBrokenPolish(t.title || '').replace(/;/g, ','),
        t.private_transfer_detected
          ? 'Przelew prywatny — bez faktury'
          : t.accounting_review_status === 'explained'
          ? `Wyjaśniona bez faktury — ${accountingCategoryLabel(t)}`
          : isTransactionFullyMatched(t)
          ? 'Dopasowana'
          : hasTransactionMatches(t)
            ? 'Częściowo dopasowana'
            : 'Niedopasowana',
        invoice?.invoice_number || '',
        invoice?.payment_due_date ? safeDate(invoice.payment_due_date) : '',
        t.match_confidence ? `${(t.match_confidence * 100).toFixed(0)}%` : '',
        t.manual_match ? 'Tak' : 'Nie',
      ].join(';');
    });

    const csv = [headers, ...rows].join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `transakcje_bankowe_${month}_${year}.csv`;
    link.click();

    showSnackbar('Raport został wyeksportowany', 'success');
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4"
      onClick={() => setActionMenuId(null)}
    >
      <div className="flex h-[94vh] max-h-[94vh] w-full max-w-[1800px] flex-col overflow-hidden rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] shadow-xl">
        <div className="flex items-center justify-between border-b border-[#d3bb73]/10 p-6">
          <div>
            <h3 className="text-xl font-medium text-[#e5e4e2]">
              Analiza transakcji bankowych — {month}/{year}
            </h3>
            <p className="mt-1 text-sm text-[#e5e4e2]/60">
              Transakcje z wyciągu oraz faktury z KSeF i spoza KSeF; dokumenty gotówkowe są pomijane
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={exportToCSV}
              className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/20 px-4 py-2 text-sm text-[#e5e4e2] hover:bg-[#252945]"
            >
              <Download className="h-4 w-4" />
              Eksportuj CSV
            </button>
            <button onClick={onClose} className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center p-12">
            <div className="text-[#e5e4e2]/60">Ładowanie danych...</div>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-[#d3bb73]/10 bg-[#252945] px-4 py-2.5">
              {[
                ['Wszystkie', stats.total, 'text-[#e5e4e2]'],
                ['Dopasowane', stats.matched, 'text-green-400'],
                ['Niedopasowane', stats.unmatched, 'text-orange-400'],
                ['Wyjaśnione', stats.explained, 'text-sky-300'],
                ['Prywatne', stats.privateTransfers, 'text-violet-300'],
              ].map(([label, value, color]) => (
                <div key={String(label)} className="flex items-baseline gap-1.5 rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] px-2.5 py-1.5">
                  <span className="text-[10px] text-[#e5e4e2]/45">{label}</span>
                  <strong className={`text-sm ${color}`}>{value}</strong>
                </div>
              ))}
              <div className="ml-1 text-[11px] text-green-400">Wpłaty +{safeMoney(stats.creditAmount)}</div>
              <div className="text-[11px] text-red-400">Wypłaty -{safeMoney(stats.debitAmount)}</div>

              <div className="ml-auto flex gap-1.5">
                <button
                  onClick={() => setFilterType('all')}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-medium ${
                    filterType === 'all'
                      ? 'bg-[#d3bb73] text-[#1c1f33]'
                      : 'border border-[#d3bb73]/20 bg-[#1c1f33] text-[#e5e4e2]'
                  }`}
                >
                  Wszystkie
                </button>
                <button
                  onClick={() => setFilterType('matched')}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-medium ${
                    filterType === 'matched'
                      ? 'bg-[#d3bb73] text-[#1c1f33]'
                      : 'border border-[#d3bb73]/20 bg-[#1c1f33] text-[#e5e4e2]'
                  }`}
                >
                  Dopasowane
                </button>
                <button
                  onClick={() => setFilterType('unmatched')}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-medium ${
                    filterType === 'unmatched'
                      ? 'bg-[#d3bb73] text-[#1c1f33]'
                      : 'border border-[#d3bb73]/20 bg-[#1c1f33] text-[#e5e4e2]'
                  }`}
                >
                  Niedopasowane
                </button>
                <button
                  onClick={() => setFilterType('explained')}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-medium ${
                    filterType === 'explained'
                      ? 'bg-sky-300 text-[#1c1f33]'
                      : 'border border-sky-300/20 bg-[#1c1f33] text-sky-200'
                  }`}
                >
                  Wyjaśnione
                </button>
                <button
                  onClick={() => setFilterType('private')}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-medium ${
                    filterType === 'private'
                      ? 'bg-violet-300 text-[#1c1f33]'
                      : 'border border-violet-300/20 bg-[#1c1f33] text-violet-200'
                  }`}
                >
                  Prywatne
                </button>
              </div>
            </div>

            <BankAiAnalysisPanel
              month={month}
              year={year}
              companyId={companyId}
              onMatchApplied={() => loadData({ silent: true })}
            />

            <div className="grid min-h-0 flex-1 gap-4 overflow-hidden p-4 xl:grid-cols-2">
              <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-[#d3bb73]/20 bg-[#252945]">
                <div className="flex items-center justify-between border-b border-[#d3bb73]/10 px-4 py-3">
                  <div className="flex items-center gap-2 text-[#e5e4e2]">
                    <Calendar className="h-4 w-4 text-[#d3bb73]" />
                    <span className="font-medium">Transakcje bankowe</span>
                  </div>
                  <span className="text-sm text-[#e5e4e2]/60">{filteredTransactions.length}</span>
                </div>

                <div className="min-h-0 flex-1 overflow-auto">
                  {filteredTransactions.length === 0 ? (
                    <div className="p-8 text-center">
                      <AlertTriangle className="mx-auto mb-3 h-12 w-12 text-[#e5e4e2]/40" />
                      <p className="text-[#e5e4e2]/60">Brak transakcji w wybranym filtrze</p>
                    </div>
                  ) : (
                    <table className="w-full min-w-[744px] table-fixed">
                      <thead className="sticky top-0 bg-[#1f233b]">
                        <tr className="border-b border-[#d3bb73]/10">
                          <th className="w-12 px-2 py-2 text-left text-[10px] uppercase tracking-wider text-[#e5e4e2]/60">
                            Status
                          </th>
                          <th
                            className="w-20 px-2 py-2 text-left text-[10px] uppercase tracking-wider text-[#e5e4e2]/60 cursor-pointer hover:text-[#d3bb73] select-none"
                            onClick={() => handleTransactionSort('date')}
                          >
                            <div className="flex items-center gap-1">
                              Data
                              {transactionSort.field === 'date' ? (
                                transactionSort.direction === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                              ) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
                            </div>
                          </th>
                          <th
                            className="w-24 px-2 py-2 text-left text-[10px] uppercase tracking-wider text-[#e5e4e2]/60 cursor-pointer hover:text-[#d3bb73] select-none"
                            onClick={() => handleTransactionSort('amount')}
                          >
                            <div className="flex items-center gap-1">
                              Kwota
                              {transactionSort.field === 'amount' ? (
                                transactionSort.direction === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                              ) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
                            </div>
                          </th>
                          <th
                            className="w-40 px-2 py-2 text-left text-[10px] uppercase tracking-wider text-[#e5e4e2]/60 cursor-pointer hover:text-[#d3bb73] select-none"
                            onClick={() => handleTransactionSort('counterparty')}
                          >
                            <div className="flex items-center gap-1">
                              Kontrahent
                              {transactionSort.field === 'counterparty' ? (
                                transactionSort.direction === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                              ) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
                            </div>
                          </th>
                          <th
                            className="w-44 px-2 py-2 text-left text-[10px] uppercase tracking-wider text-[#e5e4e2]/60 cursor-pointer hover:text-[#d3bb73] select-none"
                            onClick={() => handleTransactionSort('title')}
                          >
                            <div className="flex items-center gap-1">
                              Tytuł
                              {transactionSort.field === 'title' ? (
                                transactionSort.direction === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                              ) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
                            </div>
                          </th>
                          <th className="w-36 px-2 py-2 text-left text-[10px] uppercase tracking-wider text-[#e5e4e2]/60">
                            Dopasowanie
                          </th>
                          <th className="w-10 px-1.5 py-2 text-right text-[10px] uppercase tracking-wider text-[#e5e4e2]/60">
                            ···
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredTransactions.map((transaction) => {
                          const invoice = getInvoiceObject(transaction.invoice);

                          return (
                            <tr
                              key={transaction.id}
                              className="border-b border-[#d3bb73]/10 align-top hover:bg-[#1c1f33]/40"
                            >
                              <td className="px-2 py-2">
                                {transaction.private_transfer_detected ? (
                                  <ArrowRightLeft className="h-5 w-5 text-violet-300" />
                                ) : transaction.accounting_review_status === 'explained' ? (
                                  <CheckCircle className="h-5 w-5 text-sky-300" />
                                ) : isTransactionFullyMatched(transaction) ? (
                                  <CheckCircle className="h-5 w-5 text-green-400" />
                                ) : hasTransactionMatches(transaction) ? (
                                  <LinkIcon className="h-5 w-5 text-blue-400" />
                                ) : (
                                  <XCircle className="h-5 w-5 text-orange-400" />
                                )}
                              </td>
                              <td className="px-2 py-2 text-xs text-[#e5e4e2]/80">
                                <div>{safeDate(transaction.transaction_date)}</div>
                                {transaction.posting_date &&
                                  transaction.posting_date !== transaction.transaction_date && (
                                    <div className="mt-1 text-xs text-[#e5e4e2]/40">
                                      Księg.: {safeDate(transaction.posting_date)}
                                    </div>
                                  )}
                              </td>
                              <td className="px-2 py-2 text-xs">
                                <div
                                  className={`font-semibold ${
                                    transaction.transaction_type === 'credit'
                                      ? 'text-green-400'
                                      : 'text-red-400'
                                  }`}
                                >
                                  {transaction.transaction_type === 'credit' ? '+' : '-'}
                                  {safeMoney(transaction.amount, transaction.currency)}
                                </div>
                              </td>
                              <td className="px-2 py-2 text-xs text-[#e5e4e2]/85">
                                <div className="line-clamp-2">{sanitizeBrokenPolish(transaction.counterparty_name || '—')}</div>
                                {transaction.private_transfer_detected && (
                                  <div className="mt-1 inline-flex rounded bg-violet-400/10 px-2 py-0.5 text-xs font-medium text-violet-200">
                                    Przelew prywatny{transaction.private_transfer_owner ? ` • ${transaction.private_transfer_owner}` : ''}
                                  </div>
                                )}
                                {transaction.counterparty_account && (
                                  <div className="mt-1 text-xs text-[#e5e4e2]/40">
                                    {transaction.counterparty_account}
                                  </div>
                                )}
                              </td>
                              <td className="px-2 py-2 text-xs text-[#e5e4e2]/70">
                                <div className="line-clamp-2 break-words">
                                  {sanitizeBrokenPolish(transaction.title || '—')}
                                </div>
                                {transaction.reference_number && (
                                  <div className="mt-1 text-xs text-[#e5e4e2]/40">
                                    Nr ref: {transaction.reference_number}
                                  </div>
                                )}
                              </td>
                              <td className="px-2 py-2 text-xs text-[#e5e4e2]/80">
                                {transaction.private_transfer_detected ? (
                                  <div>
                                    <div className="font-medium text-violet-200">Przelew prywatny / własny</div>
                                    <div className="mt-1 text-xs text-violet-200/55">Nie wymaga dopasowania do faktury</div>
                                  </div>
                                ) : transaction.accounting_review_status === 'explained' ? (
                                  <div>
                                    <div className="font-medium text-sky-300">{accountingCategoryLabel(transaction)}</div>
                                    <div className="mt-1 text-xs text-sky-200/55">Wyjaśniona bez faktury</div>
                                    {transaction.accounting_note && (
                                      <div className="mt-1 max-w-[260px] text-xs text-[#e5e4e2]/45">
                                        {transaction.accounting_note}
                                      </div>
                                    )}
                                  </div>
                                ) : invoice ? (
                                  <div>
                                    <div className="font-medium text-green-400">
                                      {invoice.invoice_number || invoice.ksef_reference_number}
                                    </div>
                                    <div className="mt-1 text-xs text-[#e5e4e2]/50">
                                      Termin: {safeDate(invoice.payment_due_date)}
                                    </div>
                                    {transaction.match_confidence != null && (
                                      <div className="mt-1 text-xs text-[#d3bb73]">
                                        {(transaction.match_confidence * 100).toFixed(0)}%
                                        {transaction.manual_match ? ' • ręczne' : ''}
                                      </div>
                                    )}
                                  </div>
                                ) : hasTransactionMatches(transaction) ? (
                                  <div>
                                    <div className="font-medium text-blue-300">
                                      {transaction.matched_document_count || 1}{' '}
                                      {transaction.matched_document_count === 1 ? 'dokument' : 'dokumenty'}
                                    </div>
                                    <div className="mt-1 text-xs text-[#e5e4e2]/50">
                                      Rozliczono {safeMoney(transaction.allocated_amount, transaction.currency)}
                                    </div>
                                  </div>
                                ) : (
                                  <span className="text-orange-400">Brak dopasowania</span>
                                )}
                              </td>
                              <td className="relative px-1.5 py-2 text-right">
                                <button
                                  type="button"
                                  aria-label="Działania dla transakcji"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setActionMenuId((current) => current === transaction.id ? null : transaction.id);
                                  }}
                                  className="rounded p-1.5 text-[#e5e4e2]/55 hover:bg-white/10 hover:text-[#d3bb73]"
                                >
                                  <MoreVertical className="h-4 w-4" />
                                </button>

                                {actionMenuId === transaction.id && (
                                  <div
                                    className="absolute right-7 top-1 z-30 w-64 rounded-lg border border-white/10 bg-[#141827] p-1.5 text-left shadow-2xl"
                                    onClick={(event) => event.stopPropagation()}
                                  >
                                    {!isTransactionFullyMatched(transaction) && transaction.accounting_review_status !== 'explained' && (
                                      <>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setDocumentPicker({ transaction, source: 'all' });
                                            setActionMenuId(null);
                                          }}
                                          className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-xs text-[#e5e4e2]/80 hover:bg-[#d3bb73]/10 hover:text-[#d3bb73]"
                                        >
                                          <ReceiptText className="h-4 w-4" /> Dopasuj dokument z bazy
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setDocumentPicker({ transaction, source: 'personnel' });
                                            setActionMenuId(null);
                                          }}
                                          className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-xs text-[#e5e4e2]/80 hover:bg-[#d3bb73]/10 hover:text-[#d3bb73]"
                                        >
                                          <UserRound className="h-4 w-4" /> Dopasuj płatność kadrową
                                        </button>
                                      </>
                                    )}
                                    {!hasTransactionMatches(transaction) && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setAccountingEditor({
                                            transaction,
                                            subtype: accountingSubtypeForTransaction(transaction),
                                          });
                                          setActionMenuId(null);
                                        }}
                                        className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-xs text-[#e5e4e2]/80 hover:bg-[#d3bb73]/10 hover:text-[#d3bb73]"
                                      >
                                        <MoreVertical className="h-4 w-4" />
                                        {transaction.accounting_review_status === 'explained' ? 'Edytuj wyjaśnienie' : 'Wyjaśnij bez faktury'}
                                      </button>
                                    )}
                                    {hasTransactionMatches(transaction) && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setActionMenuId(null);
                                          void handleUnmatch(transaction.id);
                                        }}
                                        className="block w-full rounded px-2.5 py-2 text-left text-xs text-red-300 hover:bg-red-400/10"
                                      >
                                        Usuń dopasowanie
                                      </button>
                                    )}
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-[#d3bb73]/20 bg-[#252945]">
                <div className="flex items-center justify-between border-b border-[#d3bb73]/10 px-4 py-3">
                  <div className="flex items-center gap-2 text-[#e5e4e2]">
                    <FileText className="h-4 w-4 text-[#d3bb73]" />
                    <span className="font-medium">Dokumenty — {month}/{year}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => void loadData()}
                      className="flex items-center gap-1.5 rounded-lg border border-[#d3bb73]/20 px-3 py-1.5 text-xs text-[#e5e4e2] hover:bg-[#1c1f33]"
                      title="Odśwież dokumenty z KSeF i spoza KSeF"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Odśwież
                    </button>
                    <span className="text-sm text-[#e5e4e2]/60">{ksefInvoices.length}</span>
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-auto">
                  {ksefInvoices.length === 0 ? (
                    <div className="p-8 text-center">
                      <AlertTriangle className="mx-auto mb-3 h-12 w-12 text-[#e5e4e2]/40" />
                      <p className="text-[#e5e4e2]/60">Brak faktur z KSeF i spoza KSeF w tym miesiącu</p>
                    </div>
                  ) : (
                    <table className="w-full min-w-[740px] table-fixed">
                      <thead className="sticky top-0 bg-[#1f233b]">
                        <tr className="border-b border-[#d3bb73]/10">
                          <th className="w-12 px-2 py-2 text-left text-[10px] uppercase tracking-wider text-[#e5e4e2]/60">
                            Match
                          </th>
                          <th
                            className="w-40 px-2 py-2 text-left text-[10px] uppercase tracking-wider text-[#e5e4e2]/60 cursor-pointer hover:text-[#d3bb73] select-none"
                            onClick={() => handleInvoiceSort('invoice_number')}
                          >
                            <div className="flex items-center gap-1">
                              Numer
                              {invoiceSort.field === 'invoice_number' ? (
                                invoiceSort.direction === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                              ) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
                            </div>
                          </th>
                          <th
                            className="px-2 py-2 text-left text-[10px] uppercase tracking-wider text-[#e5e4e2]/60 cursor-pointer hover:text-[#d3bb73] select-none"
                            onClick={() => handleInvoiceSort('contractor')}
                          >
                            <div className="flex items-center gap-1">
                              Kontrahent
                              {invoiceSort.field === 'contractor' ? (
                                invoiceSort.direction === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                              ) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
                            </div>
                          </th>
                          <th
                            className="w-24 px-2 py-2 text-left text-[10px] uppercase tracking-wider text-[#e5e4e2]/60 cursor-pointer hover:text-[#d3bb73] select-none"
                            onClick={() => handleInvoiceSort('invoice_date')}
                          >
                            <div className="flex items-center gap-1">
                              Data
                              {invoiceSort.field === 'invoice_date' ? (
                                invoiceSort.direction === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                              ) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
                            </div>
                          </th>
                          <th className="w-24 px-2 py-2 text-left text-[10px] uppercase tracking-wider text-[#e5e4e2]/60">
                            Termin
                          </th>
                          <th
                            className="w-24 px-2 py-2 text-right text-[10px] uppercase tracking-wider text-[#e5e4e2]/60 cursor-pointer hover:text-[#d3bb73] select-none"
                            onClick={() => handleInvoiceSort('invoice_amount')}
                          >
                            <div className="flex items-center justify-end gap-1">
                              Brutto
                              {invoiceSort.field === 'invoice_amount' ? (
                                invoiceSort.direction === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                              ) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
                            </div>
                          </th>
                          <th className="w-24 px-2 py-2 text-left text-[10px] uppercase tracking-wider text-[#e5e4e2]/60">
                            Status
                          </th>
                          <th className="w-10 px-1.5 py-2 text-right text-[10px] uppercase tracking-wider text-[#e5e4e2]/60">
                            ···
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedInvoices.map((invoice) => {
                          const contractor =
                            sanitizeBrokenPolish(
                              invoice.invoice_type === 'issued'
                                ? invoice.buyer_name
                                : invoice.seller_name,
                            ) || '—';

                          return (
                            <tr
                              key={invoice.id}
                              className="border-b border-[#d3bb73]/10 hover:bg-[#1c1f33]/40"
                            >
                              <td className="px-2 py-2">
                                {isDocumentMatched(invoice) ? (
                                  <div className="flex items-center gap-2 text-green-400">
                                    <LinkIcon className="h-4 w-4" />
                                    <span className="text-xs">tak</span>
                                  </div>
                                ) : (
                                  <span className="text-xs text-[#e5e4e2]/30">—</span>
                                )}
                              </td>
                              <td className="px-2 py-2 text-xs text-[#e5e4e2]">
                                <div className="flex min-w-0 items-center gap-1.5">
                                  <span className="truncate font-medium" title={invoice.invoice_number || 'Brak numeru'}>{invoice.invoice_number || 'Brak numeru'}</span>
                                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] uppercase ${invoice.source === 'ksef' ? 'bg-sky-400/10 text-sky-200' : 'bg-violet-400/10 text-violet-200'}`}>
                                    {invoice.source === 'ksef' ? 'KSeF' : 'Poza'}
                                  </span>
                                </div>
                                {invoice.ksef_reference_number && <div className="mt-1 truncate text-[10px] text-[#e5e4e2]/35" title={invoice.ksef_reference_number}>{invoice.ksef_reference_number}</div>}
                              </td>
                              <td className="px-2 py-2 text-xs text-[#e5e4e2]/80">
                                <div className="line-clamp-2" title={contractor}>{contractor}</div>
                              </td>
                              <td className="px-2 py-2 text-xs text-[#e5e4e2]/70">
                                {safeDate(invoice.issue_date || invoice.ksef_issued_at)}
                              </td>
                              <td className="px-2 py-2 text-xs text-[#e5e4e2]/70">
                                {safeDate(invoice.payment_due_date)}
                              </td>
                              <td className="px-2 py-2 text-right text-xs font-medium text-[#d3bb73]">
                                {safeMoney(invoice.gross_amount, invoice.currency || 'PLN')}
                              </td>
                              <td className="px-2 py-2 text-xs">
                                <span
                                  className={`inline-flex rounded px-1.5 py-0.5 text-[10px] ${
                                    invoice.payment_status === 'paid'
                                      ? 'bg-green-500/10 text-green-400'
                                      : invoice.payment_status === 'overdue'
                                        ? 'bg-red-500/10 text-red-400'
                                        : 'bg-orange-500/10 text-orange-400'
                                  }`}
                                >
                                  {invoice.payment_status === 'paid'
                                    ? 'Opłacona'
                                    : invoice.payment_status === 'overdue'
                                      ? 'Po terminie'
                                      : 'Nieopłacona'}
                                </span>
                              </td>
                              <td className="relative px-1.5 py-2 text-right">
                                <button
                                  type="button"
                                  aria-label="Działania dla dokumentu"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    const menuKey = `invoice:${invoice.source}:${invoice.id}`;
                                    setActionMenuId((current) => current === menuKey ? null : menuKey);
                                  }}
                                  className="rounded p-1.5 text-[#e5e4e2]/55 hover:bg-white/10 hover:text-[#d3bb73]"
                                >
                                  <MoreVertical className="h-4 w-4" />
                                </button>
                                {actionMenuId === `invoice:${invoice.source}:${invoice.id}` && (
                                  <div
                                    className="absolute right-7 top-1 z-30 w-52 rounded-lg border border-white/10 bg-[#141827] p-1.5 text-left shadow-2xl"
                                    onClick={(event) => event.stopPropagation()}
                                  >
                                    {isDocumentMatched(invoice) ? (
                                      <div className="px-2.5 py-2 text-xs text-green-300">Dopasowanie zapisane</div>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setActionMenuId(null);
                                          openMatchModal(invoice);
                                        }}
                                        className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-xs text-[#e5e4e2]/80 hover:bg-[#d3bb73]/10 hover:text-[#d3bb73]"
                                      >
                                        <ReceiptText className="h-4 w-4" /> Dopasuj płatność
                                      </button>
                                    )}
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {matchModalOpen && selectedInvoice && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-3xl max-h-[80vh] flex flex-col overflow-hidden rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#d3bb73]/10 p-4">
              <div>
                <h3 className="text-lg font-medium text-[#e5e4e2]">
                  Dopasuj płatność do faktury
                </h3>
                <p className="mt-1 text-sm text-[#e5e4e2]/60">
                  Faktura: {selectedInvoice.invoice_number || selectedInvoice.ksef_reference_number}
                  {' • '}
                  {safeMoney(selectedInvoice.gross_amount, selectedInvoice.currency || 'PLN')}
                  {' • '}
                  {selectedInvoice.source === 'ksef' ? 'KSeF' : 'Poza KSeF'}
                </p>
              </div>
              <button
                onClick={() => {
                  setMatchModalOpen(false);
                  setSelectedInvoice(null);
                }}
                className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-auto p-4">
              <div className="space-y-2">
                {transactions
                  .filter((t) => (
                    !isTransactionResolved(t) &&
                    t.transaction_type === getExpectedTransactionDirection(selectedInvoice)
                  ))
                  .map((transaction) => {
                    const amountMatch =
                      selectedInvoice.gross_amount != null &&
                      String(selectedInvoice.currency || 'PLN').toUpperCase() === String(transaction.currency || 'PLN').toUpperCase() &&
                      Math.abs(selectedInvoice.gross_amount - transaction.amount) < 0.01;

                    return (
                      <button
                        key={transaction.id}
                        onClick={() => handleManualMatch(transaction.id, selectedInvoice)}
                        className={`w-full rounded-lg border p-4 text-left transition-colors hover:bg-[#252945] ${
                          amountMatch
                            ? 'border-green-500/40 bg-green-500/5'
                            : 'border-[#d3bb73]/20 bg-[#252945]'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-[#e5e4e2]">
                                {safeDate(transaction.transaction_date)}
                              </span>
                              {amountMatch && (
                                <span className="rounded bg-green-500/20 px-2 py-0.5 text-xs text-green-400">
                                  Kwota się zgadza
                                </span>
                              )}
                              <span
                                className={`rounded px-2 py-0.5 text-xs ${
                                  transaction.transaction_type === 'credit'
                                    ? 'bg-green-500/10 text-green-400'
                                    : 'bg-red-500/10 text-red-400'
                                }`}
                              >
                                {transaction.transaction_type === 'credit' ? 'Wpłata' : 'Wypłata'}
                              </span>
                            </div>
                            <div className="mt-2 text-sm text-[#e5e4e2]/70">
                              {sanitizeBrokenPolish(transaction.counterparty_name || '—')}
                            </div>
                            {transaction.counterparty_account && (
                              <div className="mt-1 text-xs text-[#e5e4e2]/40">
                                {transaction.counterparty_account}
                              </div>
                            )}
                            <div className="mt-2 text-xs text-[#e5e4e2]/50">
                              {sanitizeBrokenPolish(transaction.title || '—')}
                            </div>
                            {transaction.reference_number && (
                              <div className="mt-1 text-xs text-[#e5e4e2]/40">
                                Nr ref: {transaction.reference_number}
                              </div>
                            )}
                          </div>
                          <div className="text-right">
                            <div className={`text-lg font-bold ${
                              transaction.transaction_type === 'credit' ? 'text-green-400' : 'text-red-400'
                            }`}>
                              {transaction.transaction_type === 'credit' ? '+' : '-'}
                              {safeMoney(transaction.amount, transaction.currency)}
                            </div>
                            {transaction.posting_date && transaction.posting_date !== transaction.transaction_date && (
                              <div className="mt-1 text-xs text-[#e5e4e2]/40">
                                Księg.: {safeDate(transaction.posting_date)}
                              </div>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}

                {transactions.filter((t) => (
                  !isTransactionResolved(t) &&
                  t.transaction_type === getExpectedTransactionDirection(selectedInvoice)
                )).length === 0 && (
                  <div className="py-8 text-center text-[#e5e4e2]/60">
                    Brak niedopasowanych transakcji o właściwym kierunku płatności
                  </div>
                )}
              </div>
            </div>

            <div className="border-t border-[#d3bb73]/10 p-4">
              <button
                onClick={() => {
                  setMatchModalOpen(false);
                  setSelectedInvoice(null);
                }}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#252945] px-4 py-2 text-sm text-[#e5e4e2] hover:bg-[#1c1f33]"
              >
                Anuluj
              </button>
            </div>
          </div>
        </div>
      )}

      {documentPicker && (
        <BankTransactionDocumentPickerModal
          transaction={documentPicker.transaction as DocumentPickerTransaction}
          initialSource={documentPicker.source}
          onClose={() => setDocumentPicker(null)}
          onMatched={async () => {
            setDocumentPicker(null);
            await loadData({ silent: true });
          }}
        />
      )}

      {accountingEditor && (
        <BankTransactionAccountingModal
          transaction={accountingEditor.transaction as AccountingTransaction}
          initialSubtype={accountingEditor.subtype}
          onClose={() => setAccountingEditor(null)}
          onSaved={() => {
            setAccountingEditor(null);
            void loadData({ silent: true });
          }}
        />
      )}
    </div>
  );
}
