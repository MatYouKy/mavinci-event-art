'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, FileText, Loader2, Search, SlidersHorizontal, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { repairBrokenBankText } from '@/lib/bankTextEncoding';
import { useSnackbar } from '@/contexts/SnackbarContext';
import {
  applyBankTransactionMatchToDocument,
  isBankStatementMatchablePaymentMethod,
  reconcileExternalInvoiceWithBankTransaction,
  reconcilePaidKsefInvoiceWithBankTransaction,
  reconcilePersonnelPaymentWithBankTransaction,
} from '@/lib/bankTransactionMatching';

type DocumentSource = 'invoice' | 'ksef' | 'external' | 'personnel';

type PickerDocument = {
  document_source: DocumentSource;
  document_id: string;
  document_number: string;
  gross_amount: number | string;
  outstanding_amount: number | string;
  issue_date: string | null;
  due_date: string | null;
  counterparty_name: string | null;
  currency: string;
  payment_status: string;
  payment_method: string | null;
  is_matched: boolean;
  is_matchable: boolean;
};

export type DocumentPickerTransaction = {
  id: string;
  transaction_date: string;
  amount: number;
  currency: string;
  transaction_type: 'debit' | 'credit';
  counterparty_name?: string | null;
  title?: string | null;
  allocated_amount?: number | null;
};

const sourceLabels: Record<DocumentSource, string> = {
  invoice: 'CRM',
  ksef: 'KSeF',
  external: 'Spoza KSeF',
  personnel: 'Kadrowe',
};

function money(value: number | string, currency = 'PLN') {
  return `${Number(value || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} ${currency}`;
}

function isPaid(document: PickerDocument) {
  const status = String(document.payment_status || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return document.is_matched
    || Number(document.outstanding_amount || 0) <= 0.009
    || ['paid', 'oplacona', 'zaplacona', 'settled', 'matched'].includes(status);
}

export default function BankTransactionDocumentPickerModal({
  transaction,
  initialSource = 'all',
  onClose,
  onMatched,
}: {
  transaction: DocumentPickerTransaction;
  initialSource?: 'all' | DocumentSource;
  onClose: () => void;
  onMatched: () => void | Promise<void>;
}) {
  const { showSnackbar } = useSnackbar();
  const [documents, setDocuments] = useState<PickerDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [matchingId, setMatchingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'all' | DocumentSource>(initialSource);
  const [paymentFilter, setPaymentFilter] = useState<'all' | 'paid' | 'unpaid'>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const remainingAmount = Math.max(
    Math.abs(Number(transaction.amount || 0)) - Number(transaction.allocated_amount || 0),
    0,
  );

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        const { data, error } = await supabase.rpc('get_bank_transaction_document_picker_items', {
          p_transaction_id: transaction.id,
        });
        if (error) throw error;
        if (!cancelled) setDocuments((data || []) as PickerDocument[]);
      } catch (error: any) {
        if (!cancelled) {
          showSnackbar(
            error?.code === 'PGRST202'
              ? 'Wybór dokumentów wymaga migracji 20260903215000 w Supabase.'
              : error?.message || 'Nie udało się pobrać dokumentów.',
            'error',
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [transaction.id, showSnackbar]);

  const visibleDocuments = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase('pl-PL');
    const numericSearch = Number(normalizedSearch.replace(/\s/g, '').replace(',', '.'));
    return documents
      .filter((document) => sourceFilter === 'all' || document.document_source === sourceFilter)
      .filter((document) => paymentFilter === 'all' || (paymentFilter === 'paid' ? isPaid(document) : !isPaid(document)))
      .filter((document) => !dateFrom || Boolean(document.issue_date && document.issue_date >= dateFrom))
      .filter((document) => !dateTo || Boolean(document.issue_date && document.issue_date <= dateTo))
      .filter((document) => {
        if (!normalizedSearch) return true;
        const text = [document.document_number, document.counterparty_name, document.issue_date]
          .join(' ')
          .toLocaleLowerCase('pl-PL');
        return text.includes(normalizedSearch)
          || (Number.isFinite(numericSearch) && (
            Math.abs(Number(document.gross_amount) - numericSearch) <= 0.01
            || Math.abs(Number(document.outstanding_amount) - numericSearch) <= 0.01
          ));
      })
      .sort((left, right) => {
        const leftAmount = Number(left.outstanding_amount || left.gross_amount || 0);
        const rightAmount = Number(right.outstanding_amount || right.gross_amount || 0);
        const amountDifference = Math.abs(leftAmount - remainingAmount) - Math.abs(rightAmount - remainingAmount);
        if (amountDifference !== 0) return amountDifference;
        return String(right.issue_date || '').localeCompare(String(left.issue_date || ''));
      });
  }, [dateFrom, dateTo, documents, paymentFilter, remainingAmount, search, sourceFilter]);

  const canMatch = (document: PickerDocument) => {
    if (!document.is_matchable || document.is_matched || remainingAmount <= 0.009) return false;
    if (!isBankStatementMatchablePaymentMethod(document.payment_method, document.document_source)) return false;
    const sameCurrency = String(document.currency || 'PLN').toUpperCase()
      === String(transaction.currency || 'PLN').toUpperCase();
    if (!sameCurrency && document.document_source !== 'external') return false;
    if (document.document_source === 'personnel') {
      return sameCurrency && Number(document.gross_amount) <= remainingAmount + 0.01;
    }
    return true;
  };

  const matchDocument = async (document: PickerDocument) => {
    if (!canMatch(document)) return;
    const grossAmount = Math.abs(Number(document.gross_amount || 0));
    const outstandingAmount = Math.abs(Number(document.outstanding_amount || 0));
    const documentAmount = outstandingAmount > 0.009 ? outstandingAmount : grossAmount;
    const sameCurrency = String(document.currency || 'PLN').toUpperCase()
      === String(transaction.currency || 'PLN').toUpperCase();
    const allocationAmount = document.document_source === 'personnel'
      ? grossAmount
      : sameCurrency
        ? Math.min(remainingAmount, documentAmount)
        : remainingAmount;

    try {
      setMatchingId(document.document_id);
      if (document.document_source === 'personnel') {
        await reconcilePersonnelPaymentWithBankTransaction(supabase, {
          transactionId: transaction.id,
          personnelPaymentId: document.document_id,
          amount: grossAmount,
          confidence: 1,
          reasons: ['Dokument kadrowy wybrany ręcznie ze szczegółowej analizy wyciągu'],
        });
      } else if (document.document_source === 'external') {
        await reconcileExternalInvoiceWithBankTransaction(supabase, {
          transactionId: transaction.id,
          externalInvoiceId: document.document_id,
          transactionAmount: allocationAmount,
          documentAmount: sameCurrency ? allocationAmount : documentAmount,
          confidence: 1,
          reasons: ['Dokument spoza KSeF wybrany ręcznie ze szczegółowej analizy wyciągu'],
        });
      } else if (document.document_source === 'ksef' && isPaid(document)) {
        await reconcilePaidKsefInvoiceWithBankTransaction(supabase, {
          transactionId: transaction.id,
          ksefInvoiceId: document.document_id,
          amount: allocationAmount,
          confidence: 1,
          reasons: ['Opłacony dokument KSeF wybrany ręcznie ze szczegółowej analizy wyciągu'],
        });
      } else {
        await applyBankTransactionMatchToDocument(supabase, {
          transactionId: transaction.id,
          documentSource: document.document_source,
          documentId: document.document_id,
          amount: allocationAmount,
          confidence: 1,
          method: 'manual',
          reasons: ['Dokument wybrany ręcznie ze szczegółowej analizy wyciągu'],
        });
      }
      showSnackbar(`Dopasowano ${document.document_number || 'wybrany dokument'}.`, 'success');
      await onMatched();
    } catch (error: any) {
      showSnackbar(error?.message || 'Nie udało się dopasować dokumentu.', 'error');
    } finally {
      setMatchingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[10070] flex items-center justify-center bg-black/75 p-4">
      <div className="flex h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-white/10 bg-[#141827] shadow-2xl">
        <header className="flex items-start justify-between border-b border-white/10 px-5 py-4">
          <div>
            <h3 className="text-lg font-medium text-[#e5e4e2]">Dopasuj dokument do płatności</h3>
            <p className="mt-1 text-xs text-[#e5e4e2]/50">
              {new Date(transaction.transaction_date).toLocaleDateString('pl-PL')} · {money(remainingAmount, transaction.currency)} do rozliczenia · {repairBrokenBankText(transaction.counterparty_name) || 'bez kontrahenta'}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-2 text-[#e5e4e2]/55 hover:bg-white/5">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="border-b border-white/10 p-4">
          <div className="flex items-center gap-2">
            <label className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-white/15 bg-[#1c1f33] px-3 py-2">
              <Search className="h-4 w-4 shrink-0 text-[#d3bb73]" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Szukaj po numerze, kontrahencie lub kwocie…"
                className="min-w-0 flex-1 bg-transparent text-sm text-[#e5e4e2] outline-none placeholder:text-[#e5e4e2]/30"
              />
              <span className="text-[11px] text-[#e5e4e2]/40">{visibleDocuments.length}/{documents.length}</span>
            </label>
            <SlidersHorizontal className="h-4 w-4 shrink-0 text-[#d3bb73]" />
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value as 'all' | DocumentSource)} className="rounded-lg border border-white/15 bg-[#1c1f33] px-3 py-2 text-xs text-[#e5e4e2] outline-none">
              <option value="all">Wszystkie typy</option>
              <option value="ksef">KSeF</option>
              <option value="external">Spoza KSeF</option>
              <option value="invoice">CRM</option>
              <option value="personnel">Kadrowe</option>
            </select>
            <select value={paymentFilter} onChange={(event) => setPaymentFilter(event.target.value as 'all' | 'paid' | 'unpaid')} className="rounded-lg border border-white/15 bg-[#1c1f33] px-3 py-2 text-xs text-[#e5e4e2] outline-none">
              <option value="all">Wszystkie statusy</option>
              <option value="paid">Opłacone</option>
              <option value="unpaid">Nieopłacone / częściowe</option>
            </select>
            <input type="date" aria-label="Data wystawienia od" value={dateFrom} max={dateTo || undefined} onChange={(event) => setDateFrom(event.target.value)} className="rounded-lg border border-white/15 bg-[#1c1f33] px-3 py-2 text-xs text-[#e5e4e2] outline-none" />
            <input type="date" aria-label="Data wystawienia do" value={dateTo} min={dateFrom || undefined} onChange={(event) => setDateTo(event.target.value)} className="rounded-lg border border-white/15 bg-[#1c1f33] px-3 py-2 text-xs text-[#e5e4e2] outline-none" />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-[#e5e4e2]/50"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Pobieranie dokumentów…</div>
          ) : visibleDocuments.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center text-sm text-[#e5e4e2]/50">
              <AlertTriangle className="mb-3 h-8 w-8 text-amber-300" />
              Brak dokumentów spełniających wybrane filtry.
            </div>
          ) : (
            <table className="w-full min-w-[820px] table-fixed">
              <thead className="sticky top-0 z-10 bg-[#1c1f33] text-[10px] uppercase tracking-wide text-[#e5e4e2]/45">
                <tr className="border-b border-white/10">
                  <th className="w-28 px-3 py-2 text-left">Typ</th>
                  <th className="w-44 px-3 py-2 text-left">Numer</th>
                  <th className="px-3 py-2 text-left">Kontrahent</th>
                  <th className="w-28 px-3 py-2 text-left">Data</th>
                  <th className="w-32 px-3 py-2 text-right">Kwota</th>
                  <th className="w-32 px-3 py-2 text-left">Status</th>
                  <th className="w-28 px-3 py-2 text-right">Akcja</th>
                </tr>
              </thead>
              <tbody>
                {visibleDocuments.map((document) => {
                  const matchable = canMatch(document);
                  const paid = isPaid(document);
                  const wrongCurrency = document.document_source !== 'external'
                    && String(document.currency).toUpperCase() !== String(transaction.currency).toUpperCase();
                  return (
                    <tr key={`${document.document_source}:${document.document_id}`} className="border-b border-white/10 text-xs hover:bg-white/[0.03]">
                      <td className="px-3 py-2"><span className="rounded bg-sky-400/10 px-2 py-1 text-[10px] text-sky-100">{sourceLabels[document.document_source]}</span></td>
                      <td className="truncate px-3 py-2 font-medium text-[#e5e4e2]" title={document.document_number}>{document.document_number || 'bez numeru'}</td>
                      <td className="truncate px-3 py-2 text-[#e5e4e2]/70" title={document.counterparty_name || ''}>{document.counterparty_name || '—'}</td>
                      <td className="px-3 py-2 text-[#e5e4e2]/60">{document.issue_date ? new Date(document.issue_date).toLocaleDateString('pl-PL') : '—'}</td>
                      <td className="px-3 py-2 text-right font-medium text-[#d3bb73]">{money(document.gross_amount, document.currency)}</td>
                      <td className="px-3 py-2">
                        <span className={paid ? 'text-green-300' : 'text-amber-200'}>{paid ? 'Opłacona' : 'Nieopłacona'}</span>
                        {document.is_matched && <span className="block text-[10px] text-[#e5e4e2]/35">już dopasowana</span>}
                        {wrongCurrency && <span className="block text-[10px] text-red-300/70">inna waluta</span>}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          disabled={!matchable || matchingId === document.document_id}
                          onClick={() => void matchDocument(document)}
                          className="inline-flex items-center justify-center rounded-lg bg-[#d3bb73] px-3 py-1.5 text-[11px] font-medium text-[#141827] disabled:cursor-not-allowed disabled:opacity-35"
                        >
                          {matchingId === document.document_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><FileText className="mr-1.5 h-3.5 w-3.5" /> Dopasuj</>}
                        </button>
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
  );
}
