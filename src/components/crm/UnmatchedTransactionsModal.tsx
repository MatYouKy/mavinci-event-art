'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { AlertCircle, CheckCircle, X, Link as LinkIcon, Search } from 'lucide-react';
import { findMatchingInvoices, type MatchCandidate } from '@/lib/bankStatementParsers';

interface Transaction {
  id: string;
  transaction_date: string;
  amount: number;
  currency: string;
  transaction_type: 'debit' | 'credit';
  counterparty_name?: string;
  counterparty_account?: string;
  title?: string;
  matched_invoice_id?: string;
  match_confidence?: number;
}

interface UnpaidInvoice {
  id: string;
  invoice_number: string;
  ksef_reference_number: string;
  gross_amount: number;
  payment_due_date: string;
  buyer_name: string;
  issue_date: string;
  invoice_type: string;
}

interface Props {
  month: number;
  year: number;
  onClose: () => void;
}

export default function UnmatchedTransactionsModal({ month, year, onClose }: Props) {
  const [unmatchedTransactions, setUnmatchedTransactions] = useState<Transaction[]>([]);
  const [unpaidInvoices, setUnpaidInvoices] = useState<UnpaidInvoice[]>([]);
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [matchCandidates, setMatchCandidates] = useState<MatchCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [matching, setMatching] = useState(false);
  const { showSnackbar } = useSnackbar();

  useEffect(() => {
    loadData();
  }, [month, year]);

  const loadData = async () => {
    try {
      setLoading(true);

      // Pobierz niedopasowane transakcje z wybranego miesiąca
      const { data: statements } = await supabase
        .from('bank_statements')
        .select('id')
        .eq('statement_month', month)
        .eq('statement_year', year);

      if (statements && statements.length > 0) {
        const statementIds = statements.map(s => s.id);

        const { data: transactions, error: transError } = await supabase
          .from('bank_transactions')
          .select('*')
          .in('statement_id', statementIds)
          .is('matched_invoice_id', null)
          .eq('transaction_type', 'credit')
          .order('transaction_date', { ascending: false });

        if (transError) throw transError;
        setUnmatchedTransactions(transactions || []);
      }

      // Pobierz nieopłacone faktury
      const { data: invoices, error: invError } = await supabase
        .from('ksef_invoices')
        .select('*')
        .in('payment_status', ['unpaid', 'overdue'])
        .order('payment_due_date', { ascending: true });

      if (invError) throw invError;
      setUnpaidInvoices(invoices || []);

    } catch (error: any) {
      console.error('Error loading data:', error);
      showSnackbar(error.message || 'Błąd podczas ładowania danych', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleFindMatches = async (transaction: Transaction) => {
    setSelectedTransaction(transaction);
    setMatching(true);

    try {
      const matches = await findMatchingInvoices({
        transactionDate: transaction.transaction_date,
        amount: transaction.amount,
        currency: transaction.currency,
        type: transaction.transaction_type,
        counterpartyName: transaction.counterparty_name,
        counterpartyAccount: transaction.counterparty_account,
        title: transaction.title,
      }, supabase);

      setMatchCandidates(matches);
    } catch (error: any) {
      console.error('Error finding matches:', error);
      showSnackbar('Błąd podczas szukania dopasowań', 'error');
    } finally {
      setMatching(false);
    }
  };

  const handleMatchInvoice = async (invoiceId: string, confidence: number) => {
    if (!selectedTransaction) return;

    try {
      // Zaktualizuj transakcję
      const { error: transError } = await supabase
        .from('bank_transactions')
        .update({
          matched_invoice_id: invoiceId,
          match_confidence: confidence,
          manual_match: true,
        })
        .eq('id', selectedTransaction.id);

      if (transError) throw transError;

      // Zaktualizuj fakturę
      const { error: invError } = await supabase
        .from('ksef_invoices')
        .update({
          payment_status: 'paid',
          payment_date: selectedTransaction.transaction_date,
        })
        .eq('id', invoiceId);

      if (invError) throw invError;

      showSnackbar('Płatność została dopasowana do faktury', 'success');
      setSelectedTransaction(null);
      setMatchCandidates([]);
      await loadData();

    } catch (error: any) {
      console.error('Error matching:', error);
      showSnackbar(error.message || 'Błąd podczas dopasowywania', 'error');
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-6xl rounded-xl bg-[#1c1f33] border border-[#d3bb73]/20 shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-[#d3bb73]/10 p-6">
          <div>
            <h3 className="text-xl font-medium text-[#e5e4e2]">
              Dopasowanie płatności - {month}/{year}
            </h3>
            <p className="mt-1 text-sm text-[#e5e4e2]/60">
              Ręczne dopasowanie transakcji bankowych do faktur
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center p-12">
            <div className="text-[#e5e4e2]/60">Ładowanie...</div>
          </div>
        ) : (
          <div className="p-6">
            <div className="grid gap-6 lg:grid-cols-2">
              {/* Niedopasowane transakcje */}
              <div>
                <div className="mb-4 flex items-center gap-2">
                  <AlertCircle className="h-5 w-5 text-orange-400" />
                  <h4 className="text-lg font-medium text-[#e5e4e2]">
                    Niedopasowane wpłaty ({unmatchedTransactions.length})
                  </h4>
                </div>

                {unmatchedTransactions.length === 0 ? (
                  <div className="rounded-lg bg-green-500/10 border border-green-500/20 p-8 text-center">
                    <CheckCircle className="mx-auto mb-3 h-12 w-12 text-green-400" />
                    <p className="text-green-400">
                      Wszystkie wpłaty zostały dopasowane!
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {unmatchedTransactions.map((transaction) => (
                      <div
                        key={transaction.id}
                        className={`rounded-lg border p-4 cursor-pointer transition-all ${
                          selectedTransaction?.id === transaction.id
                            ? 'border-[#d3bb73] bg-[#d3bb73]/10'
                            : 'border-[#d3bb73]/20 bg-[#252945] hover:border-[#d3bb73]/40'
                        }`}
                        onClick={() => handleFindMatches(transaction)}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-green-400">
                                +{transaction.amount.toFixed(2)} {transaction.currency}
                              </span>
                              <span className="text-xs text-[#e5e4e2]/40">
                                {new Date(transaction.transaction_date).toLocaleDateString('pl-PL')}
                              </span>
                            </div>
                            {transaction.counterparty_name && (
                              <div className="mt-1 text-sm text-[#e5e4e2]">
                                {transaction.counterparty_name}
                              </div>
                            )}
                            {transaction.title && (
                              <div className="mt-1 text-xs text-[#e5e4e2]/60 line-clamp-2">
                                {transaction.title}
                              </div>
                            )}
                          </div>
                          <Search className="h-5 w-5 text-[#d3bb73] flex-shrink-0" />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Nieopłacone faktury */}
              <div>
                <div className="mb-4 flex items-center gap-2">
                  <AlertCircle className="h-5 w-5 text-red-400" />
                  <h4 className="text-lg font-medium text-[#e5e4e2]">
                    Nieopłacone faktury ({unpaidInvoices.length})
                  </h4>
                </div>

                {unpaidInvoices.length === 0 ? (
                  <div className="rounded-lg bg-green-500/10 border border-green-500/20 p-8 text-center">
                    <CheckCircle className="mx-auto mb-3 h-12 w-12 text-green-400" />
                    <p className="text-green-400">
                      Wszystkie faktury opłacone!
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {unpaidInvoices.map((invoice) => (
                      <div
                        key={invoice.id}
                        className="rounded-lg border border-[#d3bb73]/20 bg-[#252945] p-4"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="font-medium text-[#e5e4e2]">
                              {invoice.invoice_number || invoice.ksef_reference_number}
                            </div>
                            <div className="mt-1 text-sm text-[#e5e4e2]/60">
                              {invoice.buyer_name}
                            </div>
                            <div className="mt-2 flex items-center gap-3">
                              <span className="font-medium text-[#d3bb73]">
                                {invoice.gross_amount.toFixed(2)} PLN
                              </span>
                              <span className="text-xs text-red-400">
                                Termin: {new Date(invoice.payment_due_date).toLocaleDateString('pl-PL')}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Sugestie dopasowań */}
            {selectedTransaction && matchCandidates.length > 0 && (
              <div className="mt-6 rounded-lg border border-[#d3bb73]/20 bg-[#252945] p-6">
                <h4 className="mb-4 text-lg font-medium text-[#e5e4e2]">
                  Sugerowane dopasowania dla {selectedTransaction.amount.toFixed(2)} PLN
                </h4>

                <div className="space-y-3">
                  {matchCandidates.slice(0, 5).map((candidate) => (
                    <div
                      key={candidate.invoiceId}
                      className="rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] p-4"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3">
                            <span className="font-medium text-[#e5e4e2]">
                              {candidate.invoiceNumber}
                            </span>
                            <span className={`rounded px-2 py-0.5 text-xs font-medium ${
                              candidate.confidence >= 0.9
                                ? 'bg-green-500/20 text-green-400'
                                : candidate.confidence >= 0.7
                                ? 'bg-yellow-500/20 text-yellow-400'
                                : 'bg-orange-500/20 text-orange-400'
                            }`}>
                              {(candidate.confidence * 100).toFixed(0)}% dopasowanie
                            </span>
                          </div>
                          <div className="mt-1 text-sm text-[#e5e4e2]/60">
                            {candidate.buyerName}
                          </div>
                          <div className="mt-2 flex items-center gap-3">
                            <span className="text-sm text-[#d3bb73]">
                              {candidate.amount.toFixed(2)} PLN
                            </span>
                            <span className="text-xs text-[#e5e4e2]/40">
                              Termin: {new Date(candidate.dueDate).toLocaleDateString('pl-PL')}
                            </span>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1">
                            {candidate.matchReason.map((reason, idx) => (
                              <span
                                key={idx}
                                className="rounded bg-[#d3bb73]/10 px-2 py-0.5 text-xs text-[#d3bb73]"
                              >
                                {reason}
                              </span>
                            ))}
                          </div>
                        </div>
                        <button
                          onClick={() => handleMatchInvoice(candidate.invoiceId, candidate.confidence)}
                          className="ml-4 flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
                        >
                          <LinkIcon className="h-4 w-4" />
                          Dopasuj
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {selectedTransaction && matchCandidates.length === 0 && !matching && (
              <div className="mt-6 rounded-lg bg-orange-500/10 border border-orange-500/20 p-4 text-center">
                <p className="text-orange-400">
                  Nie znaleziono pasujących faktur. Sprawdź czy faktura została zsynchronizowana z KSeF.
                </p>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end border-t border-[#d3bb73]/10 p-6">
          <button
            onClick={onClose}
            className="rounded-lg border border-[#d3bb73]/20 px-4 py-2 text-sm text-[#e5e4e2] hover:bg-[#252945]"
          >
            Zamknij
          </button>
        </div>
      </div>
    </div>
  );
}
