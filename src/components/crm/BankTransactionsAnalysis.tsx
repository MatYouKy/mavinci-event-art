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
} from 'lucide-react';

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
  invoice?: InvoiceRelation | InvoiceRelation[];
}

interface KSeFInvoice {
  id: string;
  invoice_number?: string | null;
  ksef_reference_number: string;
  buyer_name?: string | null;
  seller_name?: string | null;
  issue_date?: string | null;
  payment_due_date?: string | null;
  gross_amount?: number | null;
  net_amount?: number | null;
  payment_status?: string | null;
  invoice_type?: 'issued' | 'received' | null;
  ksef_issued_at?: string | null;
}

interface Props {
  month: number;
  year: number;
  onClose: () => void;
}

function getInvoiceObject(invoice?: InvoiceRelation | InvoiceRelation[]) {
  if (!invoice) return null;
  return Array.isArray(invoice) ? (invoice[0] ?? null) : invoice;
}

function safeDate(value?: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pl-PL');
}

function safeMoney(value?: number | null, currency = 'PLN') {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return `${Number(value).toFixed(2)} ${currency}`;
}

function sanitizeBrokenPolish(text?: string | null) {
  if (!text) return '';

  return text
    .replace(/�/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/RACHU NKU/g, 'RACHUNKU')
    .replace(/ROZL ICZENIOWE/g, 'ROZLICZENIOWE')
    .replace(/OP ATA/g, 'OPŁATA')
    .replace(/URZ D/g, 'URZĄD')
    .replace(/SKARBOWY CENTRUM ROZL ICZENIOWE/g, 'SKARBOWY CENTRUM ROZLICZENIOWE')
    .trim();
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

export default function BankTransactionsAnalysis({ month, year, onClose }: Props) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [ksefInvoices, setKsefInvoices] = useState<KSeFInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<'all' | 'matched' | 'unmatched'>('all');
  const [matchModalOpen, setMatchModalOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<KSeFInvoice | null>(null);
  const [transactionSort, setTransactionSort] = useState<{ field: SortField; direction: SortDirection }>({ field: 'date', direction: 'desc' });
  const [invoiceSort, setInvoiceSort] = useState<{ field: SortField; direction: SortDirection }>({ field: 'invoice_date', direction: 'desc' });
  const { showSnackbar } = useSnackbar();

  useEffect(() => {
    loadData();
  }, [month, year]);

  const loadData = async () => {
    try {
      setLoading(true);

      const { data: statements, error: statementsError } = await supabase
        .from('bank_statements')
        .select('id')
        .eq('statement_month', month)
        .eq('statement_year', year);

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

        setTransactions(transactionsData || []);
      }

      const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
      const monthEndDate = new Date(year, month, 0);
      const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(monthEndDate.getDate()).padStart(2, '0')}`;

      const { data: invoicesData, error: invoicesError } = await supabase
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
          ksef_issued_at
        `)
        .gte('issue_date', monthStart)
        .lte('issue_date', monthEnd)
        .order('issue_date', { ascending: false });

      if (invoicesError) throw invoicesError;

      setKsefInvoices(invoicesData || []);
    } catch (error: any) {
      console.error('Error loading transactions/invoices:', error);
      showSnackbar(error.message || 'Błąd podczas ładowania danych analizy', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleManualMatch = async (transactionId: string, invoiceId: string) => {
    try {
      const transaction = transactions.find((t) => t.id === transactionId);
      if (!transaction) throw new Error('Transakcja nie została znaleziona');

      const { error: transError } = await supabase
        .from('bank_transactions')
        .update({
          matched_invoice_id: invoiceId,
          match_confidence: 1.0,
          manual_match: true,
        })
        .eq('id', transactionId);

      if (transError) throw transError;

      const { error: invError } = await supabase
        .from('ksef_invoices')
        .update({
          payment_status: 'paid',
          payment_date: transaction.transaction_date,
        })
        .eq('id', invoiceId);

      if (invError) throw invError;

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

  const handleUnmatch = async (transactionId: string, invoiceId: string) => {
    try {
      const { error: transError } = await supabase
        .from('bank_transactions')
        .update({
          matched_invoice_id: null,
          match_confidence: null,
          manual_match: false,
        })
        .eq('id', transactionId);

      if (transError) throw transError;

      const { error: invError } = await supabase
        .from('ksef_invoices')
        .update({
          payment_status: 'unpaid',
          payment_date: null,
        })
        .eq('id', invoiceId);

      if (invError) throw invError;

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
      if (filterType === 'matched') return !!t.matched_invoice_id;
      if (filterType === 'unmatched') return !t.matched_invoice_id;
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

  const matchedInvoiceIds = useMemo(() => {
    return new Set(
      transactions
        .map((t) => t.matched_invoice_id)
        .filter(Boolean) as string[],
    );
  }, [transactions]);

  const stats = useMemo(
    () => ({
      total: transactions.length,
      matched: transactions.filter((t) => t.matched_invoice_id).length,
      unmatched: transactions.filter((t) => !t.matched_invoice_id).length,
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
        t.matched_invoice_id ? 'Dopasowana' : 'Niedopasowana',
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
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-[1800px] flex-col overflow-hidden rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] shadow-xl">
        <div className="flex items-center justify-between border-b border-[#d3bb73]/10 p-6">
          <div>
            <h3 className="text-xl font-medium text-[#e5e4e2]">
              Analiza transakcji bankowych — {month}/{year}
            </h3>
            <p className="mt-1 text-sm text-[#e5e4e2]/60">
              Transakcje z wyciągu oraz faktury KSeF z analizowanego miesiąca
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
            <div className="border-b border-[#d3bb73]/10 bg-[#252945] p-6">
              <div className="grid gap-4 md:grid-cols-5">
                <div>
                  <div className="text-xs text-[#e5e4e2]/60">Wszystkich transakcji</div>
                  <div className="mt-1 text-2xl font-bold text-[#e5e4e2]">{stats.total}</div>
                </div>
                <div>
                  <div className="text-xs text-[#e5e4e2]/60">Dopasowanych</div>
                  <div className="mt-1 text-2xl font-bold text-green-400">{stats.matched}</div>
                </div>
                <div>
                  <div className="text-xs text-[#e5e4e2]/60">Niedopasowanych</div>
                  <div className="mt-1 text-2xl font-bold text-orange-400">{stats.unmatched}</div>
                </div>
                <div>
                  <div className="text-xs text-[#e5e4e2]/60">Wpłaty</div>
                  <div className="mt-1 text-xl font-bold text-green-400">
                    +{stats.creditAmount.toFixed(2)} PLN
                  </div>
                </div>
                <div>
                  <div className="text-xs text-[#e5e4e2]/60">Wypłaty</div>
                  <div className="mt-1 text-xl font-bold text-red-400">
                    -{stats.debitAmount.toFixed(2)} PLN
                  </div>
                </div>
              </div>

              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => setFilterType('all')}
                  className={`rounded-lg px-4 py-2 text-sm font-medium ${
                    filterType === 'all'
                      ? 'bg-[#d3bb73] text-[#1c1f33]'
                      : 'border border-[#d3bb73]/20 bg-[#1c1f33] text-[#e5e4e2]'
                  }`}
                >
                  Wszystkie ({stats.total})
                </button>
                <button
                  onClick={() => setFilterType('matched')}
                  className={`rounded-lg px-4 py-2 text-sm font-medium ${
                    filterType === 'matched'
                      ? 'bg-[#d3bb73] text-[#1c1f33]'
                      : 'border border-[#d3bb73]/20 bg-[#1c1f33] text-[#e5e4e2]'
                  }`}
                >
                  Dopasowane ({stats.matched})
                </button>
                <button
                  onClick={() => setFilterType('unmatched')}
                  className={`rounded-lg px-4 py-2 text-sm font-medium ${
                    filterType === 'unmatched'
                      ? 'bg-[#d3bb73] text-[#1c1f33]'
                      : 'border border-[#d3bb73]/20 bg-[#1c1f33] text-[#e5e4e2]'
                  }`}
                >
                  Niedopasowane ({stats.unmatched})
                </button>
              </div>
            </div>

            <div className="grid flex-1 gap-6 overflow-hidden p-6 xl:grid-cols-2">
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
                    <table className="w-full min-w-[980px]">
                      <thead className="sticky top-0 bg-[#1f233b]">
                        <tr className="border-b border-[#d3bb73]/10">
                          <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-[#e5e4e2]/60">
                            Status
                          </th>
                          <th
                            className="px-4 py-3 text-left text-xs uppercase tracking-wider text-[#e5e4e2]/60 cursor-pointer hover:text-[#d3bb73] select-none"
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
                            className="px-4 py-3 text-left text-xs uppercase tracking-wider text-[#e5e4e2]/60 cursor-pointer hover:text-[#d3bb73] select-none"
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
                            className="px-4 py-3 text-left text-xs uppercase tracking-wider text-[#e5e4e2]/60 cursor-pointer hover:text-[#d3bb73] select-none"
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
                            className="px-4 py-3 text-left text-xs uppercase tracking-wider text-[#e5e4e2]/60 cursor-pointer hover:text-[#d3bb73] select-none"
                            onClick={() => handleTransactionSort('title')}
                          >
                            <div className="flex items-center gap-1">
                              Tytuł
                              {transactionSort.field === 'title' ? (
                                transactionSort.direction === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                              ) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
                            </div>
                          </th>
                          <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-[#e5e4e2]/60">
                            Dopasowanie
                          </th>
                          <th className="px-4 py-3 text-right text-xs uppercase tracking-wider text-[#e5e4e2]/60">
                            Akcja
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
                              <td className="px-4 py-3">
                                {transaction.matched_invoice_id ? (
                                  <CheckCircle className="h-5 w-5 text-green-400" />
                                ) : (
                                  <XCircle className="h-5 w-5 text-orange-400" />
                                )}
                              </td>
                              <td className="px-4 py-3 text-sm text-[#e5e4e2]/80">
                                <div>{safeDate(transaction.transaction_date)}</div>
                                {transaction.posting_date &&
                                  transaction.posting_date !== transaction.transaction_date && (
                                    <div className="mt-1 text-xs text-[#e5e4e2]/40">
                                      Księg.: {safeDate(transaction.posting_date)}
                                    </div>
                                  )}
                              </td>
                              <td className="px-4 py-3 text-sm">
                                <div
                                  className={`font-semibold ${
                                    transaction.transaction_type === 'credit'
                                      ? 'text-green-400'
                                      : 'text-red-400'
                                  }`}
                                >
                                  {transaction.transaction_type === 'credit' ? '+' : '-'}
                                  {transaction.amount.toFixed(2)} {transaction.currency}
                                </div>
                              </td>
                              <td className="px-4 py-3 text-sm text-[#e5e4e2]/85">
                                <div>{sanitizeBrokenPolish(transaction.counterparty_name || '—')}</div>
                                {transaction.counterparty_account && (
                                  <div className="mt-1 text-xs text-[#e5e4e2]/40">
                                    {transaction.counterparty_account}
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-3 text-sm text-[#e5e4e2]/70">
                                <div className="max-w-[320px] whitespace-normal break-words">
                                  {sanitizeBrokenPolish(transaction.title || '—')}
                                </div>
                                {transaction.reference_number && (
                                  <div className="mt-1 text-xs text-[#e5e4e2]/40">
                                    Nr ref: {transaction.reference_number}
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-3 text-sm text-[#e5e4e2]/80">
                                {invoice ? (
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
                                ) : (
                                  <span className="text-orange-400">Brak dopasowania</span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-right">
                                {transaction.matched_invoice_id ? (
                                  <button
                                    onClick={() =>
                                      handleUnmatch(transaction.id, transaction.matched_invoice_id!)
                                    }
                                    className="rounded bg-red-500/20 px-3 py-1 text-xs text-red-400 hover:bg-red-500/30"
                                  >
                                    Usuń
                                  </button>
                                ) : (
                                  <span className="text-xs text-[#e5e4e2]/30">—</span>
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
                    <span className="font-medium">Faktury KSeF z miesiąca {month}/{year}</span>
                  </div>
                  <span className="text-sm text-[#e5e4e2]/60">{ksefInvoices.length}</span>
                </div>

                <div className="min-h-0 flex-1 overflow-auto">
                  {ksefInvoices.length === 0 ? (
                    <div className="p-8 text-center">
                      <AlertTriangle className="mx-auto mb-3 h-12 w-12 text-[#e5e4e2]/40" />
                      <p className="text-[#e5e4e2]/60">Brak faktur KSeF w tym miesiącu</p>
                    </div>
                  ) : (
                    <table className="w-full min-w-[920px]">
                      <thead className="sticky top-0 bg-[#1f233b]">
                        <tr className="border-b border-[#d3bb73]/10">
                          <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-[#e5e4e2]/60">
                            Match
                          </th>
                          <th
                            className="px-4 py-3 text-left text-xs uppercase tracking-wider text-[#e5e4e2]/60 cursor-pointer hover:text-[#d3bb73] select-none"
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
                            className="px-4 py-3 text-left text-xs uppercase tracking-wider text-[#e5e4e2]/60 cursor-pointer hover:text-[#d3bb73] select-none"
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
                            className="px-4 py-3 text-left text-xs uppercase tracking-wider text-[#e5e4e2]/60 cursor-pointer hover:text-[#d3bb73] select-none"
                            onClick={() => handleInvoiceSort('invoice_date')}
                          >
                            <div className="flex items-center gap-1">
                              Data
                              {invoiceSort.field === 'invoice_date' ? (
                                invoiceSort.direction === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                              ) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
                            </div>
                          </th>
                          <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-[#e5e4e2]/60">
                            Termin
                          </th>
                          <th
                            className="px-4 py-3 text-right text-xs uppercase tracking-wider text-[#e5e4e2]/60 cursor-pointer hover:text-[#d3bb73] select-none"
                            onClick={() => handleInvoiceSort('invoice_amount')}
                          >
                            <div className="flex items-center justify-end gap-1">
                              Brutto
                              {invoiceSort.field === 'invoice_amount' ? (
                                invoiceSort.direction === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                              ) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
                            </div>
                          </th>
                          <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-[#e5e4e2]/60">
                            Status
                          </th>
                          <th className="px-4 py-3 text-right text-xs uppercase tracking-wider text-[#e5e4e2]/60">
                            Akcja
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
                              <td className="px-4 py-3">
                                {matchedInvoiceIds.has(invoice.id) ? (
                                  <div className="flex items-center gap-2 text-green-400">
                                    <LinkIcon className="h-4 w-4" />
                                    <span className="text-xs">tak</span>
                                  </div>
                                ) : (
                                  <span className="text-xs text-[#e5e4e2]/30">—</span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-sm text-[#e5e4e2]">
                                <div className="font-medium">
                                  {invoice.invoice_number || 'Brak numeru'}
                                </div>
                                <div className="mt-1 text-xs text-[#e5e4e2]/40">
                                  {invoice.ksef_reference_number}
                                </div>
                              </td>
                              <td className="px-4 py-3 text-sm text-[#e5e4e2]/80">
                                {contractor}
                              </td>
                              <td className="px-4 py-3 text-sm text-[#e5e4e2]/70">
                                {safeDate(invoice.issue_date || invoice.ksef_issued_at)}
                              </td>
                              <td className="px-4 py-3 text-sm text-[#e5e4e2]/70">
                                {safeDate(invoice.payment_due_date)}
                              </td>
                              <td className="px-4 py-3 text-right text-sm font-medium text-[#d3bb73]">
                                {safeMoney(invoice.gross_amount)}
                              </td>
                              <td className="px-4 py-3 text-sm">
                                <span
                                  className={`rounded px-2 py-1 text-xs ${
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
                              <td className="px-4 py-3 text-right">
                                {matchedInvoiceIds.has(invoice.id) ? (
                                  <span className="text-xs text-green-400">Dopasowana</span>
                                ) : (
                                  <button
                                    onClick={() => openMatchModal(invoice)}
                                    className="rounded bg-[#d3bb73]/20 px-3 py-1 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/30"
                                  >
                                    Dopasuj płatność
                                  </button>
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
                  {safeMoney(selectedInvoice.gross_amount)}
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
                  .filter((t) => !t.matched_invoice_id)
                  .map((transaction) => {
                    const amountMatch =
                      selectedInvoice.gross_amount != null &&
                      Math.abs(selectedInvoice.gross_amount - transaction.amount) < 0.01;

                    return (
                      <button
                        key={transaction.id}
                        onClick={() => handleManualMatch(transaction.id, selectedInvoice.id)}
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
                              {transaction.amount.toFixed(2)} {transaction.currency}
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

                {transactions.filter((t) => !t.matched_invoice_id).length === 0 && (
                  <div className="py-8 text-center text-[#e5e4e2]/60">
                    Wszystkie transakcje z tego miesiąca są już dopasowane
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
    </div>
  );
}