'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle, Link as LinkIcon, Search, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import {
  applyBankTransactionMatch,
  BankMatchCandidate,
  findBankTransactionMatchCandidates,
  getBankMatchSourceLabel,
} from '@/lib/bankTransactionMatching';

interface Transaction {
  id: string;
  transaction_date: string;
  amount: number;
  currency: string;
  transaction_type: 'debit' | 'credit';
  counterparty_name?: string | null;
  counterparty_account?: string | null;
  title?: string | null;
  match_status?: 'unmatched' | 'partial' | 'matched';
  allocated_amount?: number | null;
}

interface Props {
  month: number;
  year: number;
  companyId?: string | null;
  onClose: () => void;
}

function money(value: number, currency = 'PLN') {
  return `${Number(value || 0).toFixed(2)} ${currency}`;
}

export default function UnmatchedTransactionsModal({ month, year, companyId, onClose }: Props) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [candidates, setCandidates] = useState<BankMatchCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [matchingKey, setMatchingKey] = useState<string | null>(null);
  const [allocationAmounts, setAllocationAmounts] = useState<Record<string, string>>({});
  const { showSnackbar } = useSnackbar();

  const loadTransactions = async () => {
    try {
      setLoading(true);
      let statementsQuery = supabase
        .from('bank_statements')
        .select('id')
        .eq('statement_month', month)
        .eq('statement_year', year)
        .eq('processed', true)
        .eq('validation_status', 'valid');

      if (companyId) statementsQuery = statementsQuery.eq('my_company_id', companyId);
      const { data: statements, error: statementsError } = await statementsQuery;
      if (statementsError) throw statementsError;

      const statementIds = (statements || []).map((statement) => statement.id);
      if (!statementIds.length) {
        setTransactions([]);
        return;
      }

      const { data, error } = await supabase
        .from('bank_transactions')
        .select(
          'id,transaction_date,amount,currency,transaction_type,counterparty_name,counterparty_account,title,match_status,allocated_amount',
        )
        .in('statement_id', statementIds)
        .neq('match_status', 'matched')
        .order('transaction_date', { ascending: false });
      if (error) throw error;
      setTransactions((data || []) as Transaction[]);
    } catch (error: any) {
      console.error('Error loading unmatched bank transactions:', error);
      showSnackbar(error.message || 'Nie udało się pobrać transakcji', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadTransactions();
  }, [month, year, companyId]);

  const findCandidates = async (transaction: Transaction) => {
    setSelectedTransaction(transaction);
    setSearching(true);
    setCandidates([]);
    setAllocationAmounts({});
    try {
      setCandidates(await findBankTransactionMatchCandidates(supabase, transaction.id));
    } catch (error: any) {
      console.error('Error finding bank match candidates:', error);
      showSnackbar(error.message || 'Nie udało się wyszukać dokumentów', 'error');
    } finally {
      setSearching(false);
    }
  };

  const matchCandidate = async (candidate: BankMatchCandidate) => {
    if (!selectedTransaction) return;
    const key = `${candidate.documentSource}:${candidate.documentId}`;
    try {
      setMatchingKey(key);
      const maximumAllocation = Math.min(
        Math.abs(Number(selectedTransaction.amount)) - Number(selectedTransaction.allocated_amount || 0),
        candidate.outstandingAmount,
      );
      const allocatedNow = Number(allocationAmounts[key] || maximumAllocation);
      if (!Number.isFinite(allocatedNow) || allocatedNow <= 0 || allocatedNow > maximumAllocation + 0.01) {
        showSnackbar(`Podaj kwotę od 0,01 do ${money(maximumAllocation, candidate.currency)}`, 'error');
        return;
      }
      await applyBankTransactionMatch(supabase, {
        transactionId: selectedTransaction.id,
        candidate,
        amount: allocatedNow,
        method: 'manual',
      });
      showSnackbar(`Rozliczono ${money(allocatedNow, candidate.currency)}`, 'success');

      const { data: refreshedTransaction } = await supabase
        .from('bank_transactions')
        .select(
          'id,transaction_date,amount,currency,transaction_type,counterparty_name,counterparty_account,title,match_status,allocated_amount',
        )
        .eq('id', selectedTransaction.id)
        .single();
      await loadTransactions();
      if (refreshedTransaction?.match_status === 'matched') {
        setSelectedTransaction(null);
        setCandidates([]);
      } else if (refreshedTransaction) {
        setSelectedTransaction(refreshedTransaction as Transaction);
        setAllocationAmounts({});
        setCandidates(await findBankTransactionMatchCandidates(supabase, selectedTransaction.id));
      }
    } catch (error: any) {
      console.error('Error matching bank transaction:', error);
      showSnackbar(error.message || 'Nie udało się zatwierdzić dopasowania', 'error');
    } finally {
      setMatchingKey(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[90vh] w-full max-w-7xl flex-col overflow-hidden rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] shadow-xl">
        <div className="flex items-start justify-between border-b border-[#d3bb73]/10 p-6">
          <div>
            <h3 className="text-xl font-medium text-[#e5e4e2]">Dopasowanie płatności</h3>
            <p className="mt-1 text-sm text-[#e5e4e2]/60">
              Faktury KSeF, dokumenty wystawione w CRM i faktury kosztowe spoza KSeF — {month}/{year}
            </p>
          </div>
          <button onClick={onClose} className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 gap-6 overflow-hidden p-6 lg:grid-cols-[minmax(320px,0.85fr)_minmax(460px,1.15fr)]">
          <section className="min-h-0 overflow-auto rounded-lg border border-[#d3bb73]/15 bg-[#252945] p-4">
            <div className="mb-4 flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-orange-400" />
              <h4 className="font-medium text-[#e5e4e2]">Do rozliczenia ({transactions.length})</h4>
            </div>
            {loading ? (
              <div className="py-12 text-center text-[#e5e4e2]/50">Ładowanie…</div>
            ) : transactions.length === 0 ? (
              <div className="py-12 text-center text-green-400">
                <CheckCircle className="mx-auto mb-3 h-10 w-10" />
                Wszystkie transakcje są rozliczone
              </div>
            ) : (
              <div className="space-y-2">
                {transactions.map((transaction) => {
                  const remaining = Math.max(
                    Math.abs(Number(transaction.amount)) - Number(transaction.allocated_amount || 0),
                    0,
                  );
                  return (
                    <button
                      key={transaction.id}
                      type="button"
                      onClick={() => void findCandidates(transaction)}
                      className={`w-full rounded-lg border p-3 text-left transition-colors ${
                        selectedTransaction?.id === transaction.id
                          ? 'border-[#d3bb73] bg-[#d3bb73]/10'
                          : 'border-[#d3bb73]/15 bg-[#1c1f33] hover:border-[#d3bb73]/40'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div
                            className={`font-medium ${
                              transaction.transaction_type === 'credit' ? 'text-green-400' : 'text-red-400'
                            }`}
                          >
                            {transaction.transaction_type === 'credit' ? '+' : '-'}
                            {money(Math.abs(Number(transaction.amount)), transaction.currency)}
                          </div>
                          <div className="mt-1 truncate text-sm text-[#e5e4e2]">
                            {transaction.counterparty_name || 'Nieznany kontrahent'}
                          </div>
                          <div className="mt-1 line-clamp-2 text-xs text-[#e5e4e2]/50">
                            {transaction.title || 'Brak tytułu'}
                          </div>
                          {Number(transaction.allocated_amount || 0) > 0 && (
                            <div className="mt-2 text-xs text-blue-300">
                              Pozostało: {money(remaining, transaction.currency)}
                            </div>
                          )}
                        </div>
                        <div className="shrink-0 text-right text-xs text-[#e5e4e2]/45">
                          {new Date(transaction.transaction_date).toLocaleDateString('pl-PL')}
                          <Search className="ml-auto mt-2 h-4 w-4 text-[#d3bb73]" />
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <section className="min-h-0 overflow-auto rounded-lg border border-[#d3bb73]/15 bg-[#252945] p-4">
            <div className="mb-4 flex items-center gap-2">
              <Search className="h-5 w-5 text-[#d3bb73]" />
              <h4 className="font-medium text-[#e5e4e2]">Pasujące dokumenty</h4>
            </div>
            {!selectedTransaction ? (
              <div className="py-16 text-center text-sm text-[#e5e4e2]/50">
                Wybierz transakcję, aby znaleźć dokumenty o właściwej działalności, walucie i kierunku płatności.
              </div>
            ) : searching ? (
              <div className="py-16 text-center text-[#e5e4e2]/50">Analizowanie…</div>
            ) : candidates.length === 0 ? (
              <div className="rounded-lg border border-orange-500/20 bg-orange-500/10 p-5 text-sm text-orange-300">
                Nie znaleziono bezpiecznych kandydatów. Dokument może być już rozliczony, mieć inną walutę,
                należeć do innej działalności albo wymagać uzupełnienia kwoty częściowej płatności.
              </div>
            ) : (
              <div className="space-y-3">
                {candidates.slice(0, 20).map((candidate) => {
                  const key = `${candidate.documentSource}:${candidate.documentId}`;
                  const maximumAllocation = Math.min(
                    Math.abs(Number(selectedTransaction.amount)) - Number(selectedTransaction.allocated_amount || 0),
                    candidate.outstandingAmount,
                  );
                  return (
                    <div key={key} className="rounded-lg border border-[#d3bb73]/15 bg-[#1c1f33] p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-[#e5e4e2]">{candidate.invoiceNumber}</span>
                            <span className="rounded bg-blue-500/15 px-2 py-0.5 text-xs text-blue-300">
                              {getBankMatchSourceLabel(candidate.documentSource)}
                            </span>
                            <span
                              className={`rounded px-2 py-0.5 text-xs ${
                                candidate.confidence >= 0.92
                                  ? 'bg-green-500/15 text-green-300'
                                  : candidate.confidence >= 0.7
                                    ? 'bg-yellow-500/15 text-yellow-300'
                                    : 'bg-orange-500/15 text-orange-300'
                              }`}
                            >
                              {(candidate.confidence * 100).toFixed(0)}%
                            </span>
                          </div>
                          <div className="mt-1 text-sm text-[#e5e4e2]/65">{candidate.buyerName}</div>
                          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                            <span className="text-[#d3bb73]">
                              Pozostało: {money(candidate.outstandingAmount, candidate.currency)}
                            </span>
                            <span className="text-[#e5e4e2]/45">
                              Wartość: {money(candidate.amount, candidate.currency)}
                            </span>
                            {candidate.dueDate && (
                              <span className="text-[#e5e4e2]/45">
                                Termin: {new Date(candidate.dueDate).toLocaleDateString('pl-PL')}
                              </span>
                            )}
                          </div>
                          <div className="mt-3 flex flex-wrap gap-1">
                            {candidate.matchReason.map((reason) => (
                              <span key={reason} className="rounded bg-[#d3bb73]/10 px-2 py-0.5 text-xs text-[#d3bb73]">
                                {reason}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div className="w-36 shrink-0 space-y-2">
                          <label className="block text-xs text-[#e5e4e2]/50">Kwota alokacji</label>
                          <input
                            type="number"
                            min="0.01"
                            max={maximumAllocation}
                            step="0.01"
                            value={allocationAmounts[key] ?? maximumAllocation.toFixed(2)}
                            onChange={(event) =>
                              setAllocationAmounts((current) => ({
                                ...current,
                                [key]: event.target.value,
                              }))
                            }
                            className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#252945] px-3 py-2 text-sm text-[#e5e4e2] outline-none focus:border-[#d3bb73]"
                          />
                          <button
                            type="button"
                            disabled={matchingKey === key}
                            onClick={() => void matchCandidate(candidate)}
                            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-3 py-2 text-sm font-medium text-[#1c1f33] disabled:opacity-50"
                          >
                            <LinkIcon className="h-4 w-4" />
                            {matchingKey === key ? 'Zapisywanie…' : 'Dopasuj'}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <div className="flex justify-end border-t border-[#d3bb73]/10 p-4">
          <button onClick={onClose} className="rounded-lg border border-[#d3bb73]/20 px-4 py-2 text-sm text-[#e5e4e2]">
            Zamknij
          </button>
        </div>
      </div>
    </div>
  );
}
