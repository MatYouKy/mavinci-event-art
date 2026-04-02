'use client';

import { useState, useEffect } from 'react';
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
  DollarSign
} from 'lucide-react';

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
  invoice?: {
    invoice_number: string;
    ksef_reference_number: string;
    buyer_name: string;
    issue_date: string;
    payment_due_date: string;
    gross_amount: number;
  };
}

interface Props {
  month: number;
  year: number;
  onClose: () => void;
}

export default function BankTransactionsAnalysis({ month, year, onClose }: Props) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<'all' | 'matched' | 'unmatched'>('all');
  const { showSnackbar } = useSnackbar();

  useEffect(() => {
    loadTransactions();
  }, [month, year]);

  const loadTransactions = async () => {
    try {
      setLoading(true);

      // Pobierz wszystkie wyciągi z wybranego miesiąca
      const { data: statements } = await supabase
        .from('bank_statements')
        .select('id')
        .eq('statement_month', month)
        .eq('statement_year', year);

      if (!statements || statements.length === 0) {
        setTransactions([]);
        return;
      }

      const statementIds = statements.map(s => s.id);

      // Pobierz wszystkie transakcje z tych wyciągów
      const { data: transactionsData, error } = await supabase
        .from('bank_transactions')
        .select(`
          *,
          invoice:ksef_invoices(
            invoice_number,
            ksef_reference_number,
            buyer_name,
            issue_date,
            payment_due_date,
            gross_amount
          )
        `)
        .in('statement_id', statementIds)
        .order('transaction_date', { ascending: false });

      if (error) throw error;

      setTransactions(transactionsData || []);

    } catch (error: any) {
      console.error('Error loading transactions:', error);
      showSnackbar(error.message || 'Błąd podczas ładowania transakcji', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleUnmatch = async (transactionId: string, invoiceId: string) => {
    try {
      // Usuń dopasowanie z transakcji
      const { error: transError } = await supabase
        .from('bank_transactions')
        .update({
          matched_invoice_id: null,
          match_confidence: null,
          manual_match: false,
        })
        .eq('id', transactionId);

      if (transError) throw transError;

      // Przywróć status faktury na unpaid
      const { error: invError } = await supabase
        .from('ksef_invoices')
        .update({
          payment_status: 'unpaid',
          payment_date: null,
        })
        .eq('id', invoiceId);

      if (invError) throw invError;

      showSnackbar('Dopasowanie zostało usunięte', 'success');
      await loadTransactions();

    } catch (error: any) {
      console.error('Error unmatching:', error);
      showSnackbar(error.message || 'Błąd podczas usuwania dopasowania', 'error');
    }
  };

  const filteredTransactions = transactions.filter(t => {
    if (filterType === 'matched') return t.matched_invoice_id !== null;
    if (filterType === 'unmatched') return t.matched_invoice_id === null;
    return true;
  });

  const stats = {
    total: transactions.length,
    matched: transactions.filter(t => t.matched_invoice_id).length,
    unmatched: transactions.filter(t => !t.matched_invoice_id).length,
    totalAmount: transactions.reduce((sum, t) => sum + (t.transaction_type === 'credit' ? t.amount : -t.amount), 0),
    creditAmount: transactions.filter(t => t.transaction_type === 'credit').reduce((sum, t) => sum + t.amount, 0),
    debitAmount: transactions.filter(t => t.transaction_type === 'debit').reduce((sum, t) => sum + t.amount, 0),
  };

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
      'Dopasowanie ręczne'
    ].join(';');

    const rows = transactions.map(t => [
      new Date(t.transaction_date).toLocaleDateString('pl-PL'),
      new Date(t.posting_date).toLocaleDateString('pl-PL'),
      t.transaction_type === 'credit' ? 'Wpłata' : 'Wypłata',
      t.amount.toFixed(2),
      t.currency,
      t.counterparty_name || '',
      t.counterparty_account || '',
      (t.title || '').replace(/;/g, ','),
      t.matched_invoice_id ? 'Dopasowana' : 'Niedopasowana',
      t.invoice?.[0]?.invoice_number || '',
      t.invoice?.[0]?.payment_due_date ? new Date(t.invoice[0].payment_due_date).toLocaleDateString('pl-PL') : '',
      t.match_confidence ? `${(t.match_confidence * 100).toFixed(0)}%` : '',
      t.manual_match ? 'Tak' : 'Nie'
    ].join(';'));

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
      <div className="w-full max-w-7xl rounded-xl bg-[#1c1f33] border border-[#d3bb73]/20 shadow-xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between border-b border-[#d3bb73]/10 p-6">
          <div>
            <h3 className="text-xl font-medium text-[#e5e4e2]">
              Analiza transakcji bankowych - {month}/{year}
            </h3>
            <p className="mt-1 text-sm text-[#e5e4e2]/60">
              Pełna lista transakcji z wyciągu bankowego z analizą dopasowań
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
            <button
              onClick={onClose}
              className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center p-12">
            <div className="text-[#e5e4e2]/60">Ładowanie transakcji...</div>
          </div>
        ) : (
          <>
            {/* Statystyki */}
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

              {/* Filtry */}
              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => setFilterType('all')}
                  className={`rounded-lg px-4 py-2 text-sm font-medium ${
                    filterType === 'all'
                      ? 'bg-[#d3bb73] text-[#1c1f33]'
                      : 'bg-[#1c1f33] text-[#e5e4e2] border border-[#d3bb73]/20'
                  }`}
                >
                  Wszystkie ({stats.total})
                </button>
                <button
                  onClick={() => setFilterType('matched')}
                  className={`rounded-lg px-4 py-2 text-sm font-medium ${
                    filterType === 'matched'
                      ? 'bg-[#d3bb73] text-[#1c1f33]'
                      : 'bg-[#1c1f33] text-[#e5e4e2] border border-[#d3bb73]/20'
                  }`}
                >
                  Dopasowane ({stats.matched})
                </button>
                <button
                  onClick={() => setFilterType('unmatched')}
                  className={`rounded-lg px-4 py-2 text-sm font-medium ${
                    filterType === 'unmatched'
                      ? 'bg-[#d3bb73] text-[#1c1f33]'
                      : 'bg-[#1c1f33] text-[#e5e4e2] border border-[#d3bb73]/20'
                  }`}
                >
                  Niedopasowane ({stats.unmatched})
                </button>
              </div>
            </div>

            {/* Tabela transakcji */}
            <div className="flex-1 overflow-auto p-6">
              {filteredTransactions.length === 0 ? (
                <div className="rounded-lg bg-[#252945] p-8 text-center">
                  <AlertTriangle className="mx-auto mb-3 h-12 w-12 text-[#e5e4e2]/40" />
                  <p className="text-[#e5e4e2]/60">
                    Brak transakcji w wybranym filtrze
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredTransactions.map((transaction) => (
                    <div
                      key={transaction.id}
                      className="rounded-lg border border-[#d3bb73]/20 bg-[#252945] p-4 hover:border-[#d3bb73]/40 transition-colors"
                    >
                      <div className="flex items-start gap-4">
                        {/* Status dopasowania */}
                        <div className="flex-shrink-0">
                          {transaction.matched_invoice_id ? (
                            <CheckCircle className="h-6 w-6 text-green-400" />
                          ) : (
                            <XCircle className="h-6 w-6 text-orange-400" />
                          )}
                        </div>

                        {/* Szczegóły transakcji */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1">
                              {/* Data i kwota */}
                              <div className="flex items-center gap-3 flex-wrap">
                                <span className={`text-lg font-bold ${
                                  transaction.transaction_type === 'credit'
                                    ? 'text-green-400'
                                    : 'text-red-400'
                                }`}>
                                  {transaction.transaction_type === 'credit' ? '+' : '-'}
                                  {transaction.amount.toFixed(2)} {transaction.currency}
                                </span>
                                <span className="text-sm text-[#e5e4e2]/60">
                                  <Calendar className="inline h-3 w-3 mr-1" />
                                  {new Date(transaction.transaction_date).toLocaleDateString('pl-PL')}
                                </span>
                                {transaction.posting_date !== transaction.transaction_date && (
                                  <span className="text-xs text-[#e5e4e2]/40">
                                    Księg: {new Date(transaction.posting_date).toLocaleDateString('pl-PL')}
                                  </span>
                                )}
                              </div>

                              {/* Kontrahent */}
                              {transaction.counterparty_name && (
                                <div className="mt-2 text-sm text-[#e5e4e2]">
                                  <strong>Kontrahent:</strong> {transaction.counterparty_name}
                                </div>
                              )}

                              {/* Numer konta */}
                              {transaction.counterparty_account && (
                                <div className="mt-1 text-xs text-[#e5e4e2]/60">
                                  <strong>Konto:</strong> {transaction.counterparty_account}
                                </div>
                              )}

                              {/* Tytuł */}
                              {transaction.title && (
                                <div className="mt-2 text-sm text-[#e5e4e2]/80">
                                  <strong>Tytuł:</strong> {transaction.title}
                                </div>
                              )}

                              {/* Numer referencyjny */}
                              {transaction.reference_number && (
                                <div className="mt-1 text-xs text-[#e5e4e2]/40">
                                  <strong>Nr ref:</strong> {transaction.reference_number}
                                </div>
                              )}

                              {/* Dopasowana faktura */}
                              {transaction.matched_invoice_id && transaction.invoice?.[0] && (
                                <div className="mt-3 rounded-lg bg-green-500/10 border border-green-500/20 p-3">
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="flex-1">
                                      <div className="flex items-center gap-2">
                                        <LinkIcon className="h-4 w-4 text-green-400" />
                                        <span className="font-medium text-green-400">
                                          Dopasowana faktura
                                        </span>
                                        {transaction.manual_match && (
                                          <span className="rounded bg-blue-500/20 px-2 py-0.5 text-xs text-blue-400">
                                            Ręcznie
                                          </span>
                                        )}
                                        {transaction.match_confidence && (
                                          <span className="rounded bg-[#d3bb73]/20 px-2 py-0.5 text-xs text-[#d3bb73]">
                                            {(transaction.match_confidence * 100).toFixed(0)}% pewności
                                          </span>
                                        )}
                                      </div>
                                      <div className="mt-2 text-sm">
                                        <div className="text-[#e5e4e2]">
                                          <strong>Nr faktury:</strong> {transaction.invoice[0].invoice_number}
                                        </div>
                                        <div className="mt-1 text-[#e5e4e2]/80">
                                          <strong>Nabywca:</strong> {transaction.invoice[0].buyer_name}
                                        </div>
                                        <div className="mt-1 text-xs text-[#e5e4e2]/60 flex items-center gap-3">
                                          <span>
                                            <strong>Kwota faktury:</strong> {transaction.invoice[0].gross_amount.toFixed(2)} PLN
                                          </span>
                                          <span>
                                            <strong>Termin:</strong> {new Date(transaction.invoice[0].payment_due_date).toLocaleDateString('pl-PL')}
                                          </span>
                                        </div>
                                      </div>
                                    </div>
                                    <button
                                      onClick={() => handleUnmatch(transaction.id, transaction.matched_invoice_id!)}
                                      className="rounded bg-red-500/20 px-3 py-1 text-xs text-red-400 hover:bg-red-500/30"
                                    >
                                      Usuń dopasowanie
                                    </button>
                                  </div>
                                </div>
                              )}

                              {/* Brak dopasowania */}
                              {!transaction.matched_invoice_id && transaction.transaction_type === 'credit' && (
                                <div className="mt-3 rounded-lg bg-orange-500/10 border border-orange-500/20 p-2 text-sm text-orange-400">
                                  ⚠️ Transakcja nie została dopasowana do żadnej faktury
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
