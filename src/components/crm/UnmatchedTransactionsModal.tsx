'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle, Link as LinkIcon, MoreVertical, Search, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { repairBrokenBankText } from '@/lib/bankTextEncoding';
import { useSnackbar } from '@/contexts/SnackbarContext';
import {
  applyBankTransactionMatch,
  BankMatchCandidate,
  findBankTransactionMatchCandidates,
  getBankMatchSourceLabel,
} from '@/lib/bankTransactionMatching';
import BankAiAnalysisPanel from './BankAiAnalysisPanel';
import BankTransactionAccountingModal, { BANK_ACCOUNTING_ACTIONS } from './BankTransactionAccountingModal';
import type { AccountingTransaction, BankAccountingSubtype } from './BankTransactionAccountingModal';

interface Transaction {
  id: string;
  statement_id: string;
  company_id: string;
  transaction_date: string;
  amount: number;
  currency: string;
  transaction_type: 'debit' | 'credit';
  counterparty_name?: string | null;
  counterparty_account?: string | null;
  title?: string | null;
  match_status?: 'unmatched' | 'partial' | 'matched';
  allocated_amount?: number | null;
  private_transfer_detected?: boolean | null;
  private_transfer_owner?: string | null;
  accounting_note?: string | null;
  accounting_category?: string | null;
  accounting_subtype?: BankAccountingSubtype | null;
  accounting_review_status?: 'pending' | 'explained' | null;
}

interface Props {
  month: number;
  year: number;
  companyId?: string | null;
  onClose: () => void;
}

function money(value: number, currency = 'PLN') {
  return `${Number(value || 0)
    .toFixed(2)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} ${currency}`;
}

export default function UnmatchedTransactionsModal({ month, year, companyId, onClose }: Props) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [candidates, setCandidates] = useState<BankMatchCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [matchingKey, setMatchingKey] = useState<string | null>(null);
  const [allocationAmounts, setAllocationAmounts] = useState<Record<string, string>>({});
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);
  const [accountingEditor, setAccountingEditor] = useState<{
    transaction: Transaction;
    subtype: BankAccountingSubtype;
  } | null>(null);
  const { showSnackbar } = useSnackbar();

  const loadTransactions = async ({ silent = false }: { silent?: boolean } = {}) => {
    try {
      if (!silent) setLoading(true);
      let statementsQuery = supabase
        .from('bank_statements')
        .select('id,my_company_id')
        .eq('statement_month', month)
        .eq('statement_year', year)
        .eq('processed', true)
        .eq('validation_status', 'valid');

      if (companyId) statementsQuery = statementsQuery.eq('my_company_id', companyId);
      const { data: statements, error: statementsError } = await statementsQuery;
      if (statementsError) throw statementsError;

      const statementIds = (statements || []).map((statement) => statement.id);
      const statementCompanies = new Map(
        (statements || []).map((statement) => [statement.id, statement.my_company_id as string]),
      );
      if (!statementIds.length) {
        setTransactions([]);
        return;
      }

      const { data, error } = await supabase
        .from('bank_transactions')
        .select(
          'id,statement_id,transaction_date,amount,currency,transaction_type,counterparty_name,counterparty_account,title,match_status,allocated_amount,private_transfer_detected,private_transfer_owner,accounting_note,accounting_category,accounting_subtype,accounting_review_status',
        )
        .in('statement_id', statementIds)
        .neq('match_status', 'matched')
        .order('transaction_date', { ascending: false });
      if (error) throw error;
      setTransactions(
        ((data || []) as Omit<Transaction, 'company_id'>[])
          .map((transaction) => ({
            ...transaction,
            company_id: statementCompanies.get(transaction.statement_id) || '',
          }))
          .filter(
            (transaction) =>
              !transaction.private_transfer_detected && transaction.accounting_review_status !== 'explained',
          ),
      );
    } catch (error: any) {
      console.error('Error loading unmatched bank transactions:', error);
      showSnackbar(error.message || 'Nie udało się pobrać transakcji', 'error');
    } finally {
      if (!silent) setLoading(false);
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
          'id,statement_id,transaction_date,amount,currency,transaction_type,counterparty_name,counterparty_account,title,match_status,allocated_amount,private_transfer_detected,private_transfer_owner,accounting_note,accounting_category,accounting_subtype,accounting_review_status',
        )
        .eq('id', selectedTransaction.id)
        .single();
      await loadTransactions();
      if (refreshedTransaction?.match_status === 'matched') {
        setSelectedTransaction(null);
        setCandidates([]);
      } else if (refreshedTransaction) {
        setSelectedTransaction({
          ...(refreshedTransaction as Omit<Transaction, 'company_id'>),
          company_id: selectedTransaction.company_id,
        });
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
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4"
      onClick={() => setActionMenuId(null)}
    >
      <div className="flex h-[94vh] max-h-[94vh] w-full max-w-7xl flex-col overflow-hidden rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] shadow-xl">
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

        <BankAiAnalysisPanel
          month={month}
          year={year}
          companyId={companyId}
          onMatchApplied={() => loadTransactions({ silent: true })}
        />

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
                    <div
                      key={transaction.id}
                      className={`w-full rounded-lg border p-3 text-left transition-colors ${
                        selectedTransaction?.id === transaction.id
                          ? 'border-[#d3bb73] bg-[#d3bb73]/10'
                          : 'border-[#d3bb73]/15 bg-[#1c1f33] hover:border-[#d3bb73]/40'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <button
                          type="button"
                          onClick={() => void findCandidates(transaction)}
                          className="min-w-0 flex-1 text-left"
                        >
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
                            {repairBrokenBankText(transaction.counterparty_name) || 'Nieznany kontrahent'}
                          </div>
                          <div className="mt-1 line-clamp-2 text-xs text-[#e5e4e2]/50">
                            {repairBrokenBankText(transaction.title) || 'Brak tytułu'}
                          </div>
                          {Number(transaction.allocated_amount || 0) > 0 && (
                            <div className="mt-2 text-xs text-blue-300">
                              Pozostało: {money(remaining, transaction.currency)}
                            </div>
                          )}
                          {transaction.accounting_subtype && (
                            <div className="mt-2 inline-flex rounded bg-amber-400/10 px-2 py-1 text-[11px] text-amber-200">
                              {BANK_ACCOUNTING_ACTIONS.find((item) => item.subtype === transaction.accounting_subtype)?.label || 'Opis księgowy'}
                            </div>
                          )}
                        </div>
                        </button>
                        <div className="relative shrink-0 text-right text-xs text-[#e5e4e2]/45">
                          {new Date(transaction.transaction_date).toLocaleDateString('pl-PL')}
                          <div className="mt-1 flex items-center justify-end gap-1">
                            <Search className="h-4 w-4 text-[#d3bb73]" />
                            <button
                              type="button"
                              aria-label="Więcej działań dla płatności"
                              onClick={(event) => {
                                event.stopPropagation();
                                setActionMenuId((current) => current === transaction.id ? null : transaction.id);
                              }}
                              className="rounded p-1.5 text-[#e5e4e2]/60 hover:bg-white/10 hover:text-[#d3bb73]"
                            >
                              <MoreVertical className="h-4 w-4" />
                            </button>
                          </div>

                          {actionMenuId === transaction.id && (
                            <div
                              className="absolute right-0 top-full z-30 mt-1 max-h-80 w-72 overflow-auto rounded-lg border border-white/10 bg-[#141827] p-1.5 text-left shadow-2xl"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <div className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide text-[#e5e4e2]/40">
                                Wyjaśnij bez faktury
                              </div>
                              {BANK_ACCOUNTING_ACTIONS.map((action) => (
                                <button
                                  key={action.subtype}
                                  type="button"
                                  onClick={() => {
                                    setAccountingEditor({ transaction, subtype: action.subtype });
                                    setActionMenuId(null);
                                  }}
                                  className="block w-full rounded px-2.5 py-2 text-left text-xs text-[#e5e4e2]/80 hover:bg-[#d3bb73]/10 hover:text-[#d3bb73]"
                                >
                                  {action.label}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
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

      {accountingEditor && (
        <BankTransactionAccountingModal
          transaction={accountingEditor.transaction as AccountingTransaction}
          initialSubtype={accountingEditor.subtype}
          onClose={() => setAccountingEditor(null)}
          onSaved={(resolved) => {
            const transactionId = accountingEditor.transaction.id;
            setAccountingEditor(null);
            if (resolved && selectedTransaction?.id === transactionId) {
              setSelectedTransaction(null);
              setCandidates([]);
            }
            void loadTransactions({ silent: true });
          }}
        />
      )}
    </div>
  );
}
