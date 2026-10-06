'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, FileText, Loader2, Search, SlidersHorizontal, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { repairBrokenBankText } from '@/lib/bankTextEncoding';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { externalDocumentKindLabel } from '@/lib/invoices/externalDocumentKinds';
import { loadExternalDocumentKinds } from '@/lib/invoices/loadExternalDocumentKinds';
import { loadPersonnelPaymentBreakdowns, salaryPaymentNeedsNetConfirmation, type PersonnelPaymentBreakdown } from '@/lib/personnel/payrollMatching';
import {
  applyBankTransactionMatchToDocument,
  assertBankTransactionCanMatchDocuments,
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
  document_kind?: string;
  payroll?: PersonnelPaymentBreakdown;
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
  const matchLock = useRef(false);
  const exceptionNoteRef = useRef<HTMLTextAreaElement>(null);
  const [exceptionDocument, setExceptionDocument] = useState<PickerDocument | null>(null);
  const [exceptionNote, setExceptionNote] = useState('');
  const [exceptionConfirmed, setExceptionConfirmed] = useState(false);
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
    setDocuments([]);
    setExceptionDocument(null);
    setExceptionNote('');
    setExceptionConfirmed(false);
    const load = async () => {
      try {
        setLoading(true);
        await assertBankTransactionCanMatchDocuments(supabase, transaction.id);
        if (cancelled) return;
        const rows: PickerDocument[] = [];
        const pageSize = 500;
        for (let offset = 0; !cancelled; offset += pageSize) {
          const { data, error } = await supabase
            .rpc('get_bank_transaction_document_picker_items', {
              p_transaction_id: transaction.id,
            })
            .order('document_source', { ascending: true })
            .order('document_id', { ascending: true })
            .range(offset, offset + pageSize - 1);
          if (cancelled) return;
          if (error) throw error;
          const page = (data || []) as PickerDocument[];
          rows.push(...page);
          if (page.length < pageSize) break;
        }
        if (cancelled) return;
        const [kinds, payroll] = await Promise.all([
          loadExternalDocumentKinds(
            supabase,
            rows.filter((document) => document.document_source === 'external').map((document) => document.document_id),
          ),
          loadPersonnelPaymentBreakdowns(
            supabase,
            rows.filter((document) => document.document_source === 'personnel').map((document) => document.document_id),
          ),
        ]);
        if (!cancelled) setDocuments(rows.map((document) => {
          if (document.document_source === 'external') {
            return { ...document, document_kind: kinds.get(document.document_id) || 'invoice' };
          }
          if (document.document_source !== 'personnel') return document;
          const payment = payroll.get(document.document_id);
          if (!payment) return { ...document, is_matchable: false };
          return {
            ...document,
            payroll: payment,
            gross_amount: payment.amount,
            outstanding_amount: payment.linkedTransactionId ? 0 : payment.amount,
            is_matched: Boolean(payment.linkedTransactionId),
            is_matchable: document.is_matchable && !salaryPaymentNeedsNetConfirmation(payment),
          };
        }));
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

  useEffect(() => {
    if (exceptionDocument) exceptionNoteRef.current?.focus();
  }, [exceptionDocument]);

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
        const text = [document.document_number, document.counterparty_name, document.issue_date,
          document.document_source === 'external' ? externalDocumentKindLabel(document.document_kind) : sourceLabels[document.document_source]]
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

  const paymentMethodConflict = (document: PickerDocument) =>
    !isBankStatementMatchablePaymentMethod(document.payment_method, document.document_source);

  const blockingReason = (document: PickerDocument, allowKsefCashException = false): string | null => {
    if (document.is_matched) return 'Dokument ma już zapisane powiązanie z płatnością. Sprawdź je przed kolejnym dopasowaniem.';
    if (remainingAmount <= 0.009) return 'Ta płatność jest już w całości rozliczona.';
    if (document.payroll && salaryPaymentNeedsNetConfirmation(document.payroll)) return 'Najpierw potwierdź kwotę netto w umowie personelu.';
    if (!document.is_matchable) return 'Brak dostępnej kwoty do dopasowania lub dokument nie spełnia warunków rozliczenia.';
    if (!Number.isFinite(Number(document.gross_amount)) || Math.abs(Number(document.gross_amount)) <= 0.009) return 'Dokument nie ma dodatniej kwoty do rozliczenia.';
    const sameCurrency = String(document.currency || 'PLN').toUpperCase()
      === String(transaction.currency || 'PLN').toUpperCase();
    if (!sameCurrency && document.document_source !== 'external') return 'Waluta dokumentu różni się od waluty płatności.';
    if (document.document_source === 'personnel') {
      if (!document.payroll) return 'Nie odczytano danych płatności kadrowej.';
      if (!sameCurrency || Number(document.gross_amount) > remainingAmount + 0.01) return 'Kwota wypłaty kadrowej przekracza pozostałą kwotę płatności lub ma inną walutę.';
    }
    if (paymentMethodConflict(document) && !(allowKsefCashException && document.document_source === 'ksef')) {
      return document.document_source === 'ksef'
        ? 'Faktura wskazuje gotówkę. Powiązanie z wyciągiem wymaga świadomego potwierdzenia wyjątku.'
        : 'Dokument wskazuje gotówkę. Zweryfikuj sposób zapłaty przed dopasowaniem do wyciągu.';
    }
    return null;
  };

  const canConfirmCashException = (document: PickerDocument) => document.document_source === 'ksef'
    && paymentMethodConflict(document) && blockingReason(document, true) === null;

  const openCashException = (document: PickerDocument) => {
    if (matchLock.current || !canConfirmCashException(document)) return;
    setExceptionNote('');
    setExceptionConfirmed(false);
    setExceptionDocument(document);
  };

  const matchDocument = async (document: PickerDocument, confirmedCashNote?: string) => {
    if (matchLock.current) return;
    const reviewNote = confirmedCashNote?.trim() || '';
    const cashException = Boolean(reviewNote)
      && exceptionDocument?.document_id === document.document_id
      && exceptionDocument?.document_source === document.document_source
      && exceptionConfirmed && canConfirmCashException(document);
    if (blockingReason(document, cashException)) return;
    if (paymentMethodConflict(document) && (!cashException || reviewNote.length < 3)) return;
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

    const exceptionReasons = cashException ? [
      'Świadomie potwierdzono ręczne dopasowanie do wyciągu mimo oznaczenia gotówki na fakturze KSeF. Oryginalny sposób płatności i XML pozostają bez zmian.',
      `Uzasadnienie użytkownika: ${reviewNote}`,
    ] : [];

    try {
      matchLock.current = true;
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
          reasons: ['Opłacony dokument KSeF wybrany ręcznie ze szczegółowej analizy wyciągu', ...exceptionReasons],
        });
      } else {
        await applyBankTransactionMatchToDocument(supabase, {
          transactionId: transaction.id,
          documentSource: document.document_source,
          documentId: document.document_id,
          amount: allocationAmount,
          confidence: 1,
          method: 'manual',
          reasons: ['Dokument wybrany ręcznie ze szczegółowej analizy wyciągu', ...exceptionReasons],
        });
      }
      showSnackbar(`Dopasowano ${document.document_number || 'wybrany dokument'}.`, 'success');
      await onMatched();
    } catch (error: any) {
      showSnackbar(error?.message || 'Nie udało się dopasować dokumentu.', 'error');
    } finally {
      matchLock.current = false;
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
          <button type="button" onClick={onClose} disabled={Boolean(matchingId)} aria-label="Zamknij wybór dokumentu" className="rounded p-2 text-[#e5e4e2]/55 hover:bg-white/5 disabled:opacity-40">
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
          {exceptionDocument && <section role="region" aria-labelledby="cash-match-exception-title" className="m-4 space-y-3 rounded-xl bg-[var(--brand-burgundy-800)] p-4 text-sm text-[var(--brand-platinum)]">
            <h4 id="cash-match-exception-title" className="flex items-center gap-2 font-medium text-[#d3bb73]"><AlertTriangle className="h-4 w-4" />Potwierdź rzeczywisty sposób zapłaty</h4>
            <p><strong>{exceptionDocument.document_number}</strong> · {exceptionDocument.counterparty_name} · {money(exceptionDocument.gross_amount, exceptionDocument.currency)}</p>
            <p className="text-xs leading-5 text-[#e5e4e2]/75">Faktura KSeF wskazuje gotówkę. Potwierdź wyjątek tylko jeśli sprawdziłeś, że wybrana płatność z wyciągu rzeczywiście dotyczy tego dokumentu, np. zakupu przez Allegro. Zgodna kwota sama w sobie nie wystarcza.</p>
            <p className="break-words text-xs leading-5 text-[#e5e4e2]/65">Płatność: {new Date(transaction.transaction_date).toLocaleDateString('pl-PL')} · {money(remainingAmount, transaction.currency)} do rozliczenia · {repairBrokenBankText(transaction.counterparty_name) || 'bez kontrahenta'}{transaction.title ? ` · ${repairBrokenBankText(transaction.title)}` : ''}</p>
            <p className="text-xs leading-5 text-[#e5e4e2]/65">Zapiszemy uzasadnienie przy powiązaniu. Nie zmienimy oryginalnej faktury ani jej XML. Wcześniejsze oznaczenie „Opłacona” zostanie powiązane z wyciągiem bez podwójnego naliczenia zapłaty.</p>
            <label className="block text-xs text-[#e5e4e2]/75" htmlFor="cash-match-exception-note">Uzasadnienie powiązania *</label>
            <textarea id="cash-match-exception-note" ref={exceptionNoteRef} rows={2} maxLength={1500} value={exceptionNote} disabled={Boolean(matchingId)}
              placeholder="Wyjaśnij, skąd wiesz, że ta płatność dotyczy faktury (np. numer zamówienia lub potwierdzenie Allegro)."
              onChange={(event) => { setExceptionNote(event.target.value); setExceptionConfirmed(false); }}
              className="w-full rounded-lg border border-white/10 bg-black/15 px-3 py-2 text-sm outline-none focus:border-[var(--crm-field-border-focus)]" />
            <label className="flex items-start gap-2 text-xs leading-5"><input type="checkbox" checked={exceptionConfirmed} disabled={Boolean(matchingId)} onChange={(event) => setExceptionConfirmed(event.target.checked)} className="mt-1 accent-[#d3bb73]" /><span>Sprawdziłem powiązanie. To ta sama zapłata, a nie dodatkowa płatność gotówką.</span></label>
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" disabled={Boolean(matchingId)} onClick={() => { setExceptionDocument(null); setExceptionNote(''); setExceptionConfirmed(false); }} className="rounded-lg bg-white/5 px-3 py-2 text-xs hover:bg-white/10 disabled:opacity-40">Anuluj wyjątek</button>
              <button type="button" disabled={Boolean(matchingId) || !exceptionConfirmed || exceptionNote.trim().length < 3 || !canConfirmCashException(exceptionDocument)}
                onClick={() => void matchDocument(exceptionDocument, exceptionNote)} className="rounded-lg bg-[#d3bb73] px-3 py-2 text-xs font-medium text-[#141827] disabled:cursor-not-allowed disabled:opacity-40">
                {matchingId ? 'Zapisywanie…' : 'Potwierdź wyjątek i dopasuj'}
              </button>
            </div>
          </section>}
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
                  const reason = blockingReason(document);
                  const cashReviewAvailable = canConfirmCashException(document);
                  const matchable = reason === null || cashReviewAvailable;
                  const paid = isPaid(document);
                  const wrongCurrency = document.document_source !== 'external'
                    && String(document.currency).toUpperCase() !== String(transaction.currency).toUpperCase();
                  return (
                    <tr key={`${document.document_source}:${document.document_id}`} className="border-b border-white/10 text-xs hover:bg-white/[0.03]">
                      <td className="px-3 py-2"><span className="rounded bg-sky-400/10 px-2 py-1 text-[10px] text-sky-100">{sourceLabels[document.document_source]}</span>{document.document_source === 'external' && <span className="mt-1 block text-[10px] text-[#e5e4e2]/60">{externalDocumentKindLabel(document.document_kind)}</span>}</td>
                      <td className="truncate px-3 py-2 font-medium text-[#e5e4e2]" title={document.document_number}>{document.document_number || 'bez numeru'}</td>
                      <td className="truncate px-3 py-2 text-[#e5e4e2]/70" title={document.counterparty_name || ''}>{document.counterparty_name || '—'}</td>
                      <td className="px-3 py-2 text-[#e5e4e2]/60">{document.issue_date ? new Date(document.issue_date).toLocaleDateString('pl-PL') : '—'}</td>
                      <td className="px-3 py-2 text-right font-medium text-[#d3bb73]">
                        {document.payroll?.paymentType === 'salary' && (
                          <span className="mb-1 block text-[10px] font-normal text-[#e5e4e2]/55">
                            {document.payroll.netConfirmed ? 'Netto na konto' : 'Kwota do weryfikacji'}
                          </span>
                        )}
                        {money(document.gross_amount, document.currency)}
                        {document.payroll?.paymentType === 'salary' && document.payroll.totalAmount != null && (
                          <span className="mt-1 block text-[10px] font-normal text-[#e5e4e2]/55">
                            Łącznie: {money(document.payroll.totalAmount, document.currency)}
                            {document.payroll.netConfirmed && document.payroll.totalAmount >= document.payroll.amount && (
                              <span className="block">Pozostałe obciążenia: {money(document.payroll.totalAmount - document.payroll.amount, document.currency)}</span>
                            )}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span className={paid ? 'text-green-300' : 'text-amber-200'}>{paid ? 'Opłacona' : 'Nieopłacona'}</span>
                        {document.is_matched && <span className="block text-[10px] text-[#e5e4e2]/35">już dopasowana</span>}
                        {!document.is_matched && paid && <span className="mt-1 block text-[10px] text-[#e5e4e2]/50">bez powiązania z wyciągiem</span>}
                        {paymentMethodConflict(document) && <span className="mt-1 block text-[10px] text-amber-200">Na dokumencie: gotówka</span>}
                        {document.payroll && salaryPaymentNeedsNetConfirmation(document.payroll) && (
                          <span className="mt-1 block text-[10px] text-amber-200">Uzupełnij netto w Umowy personelu → Otwórz umowę.</span>
                        )}
                        {wrongCurrency && <span className="block text-[10px] text-red-300/70">inna waluta</span>}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          disabled={!matchable || Boolean(matchingId)}
                          title={reason || 'Dopasuj dokument do tej płatności'}
                          onClick={() => cashReviewAvailable ? openCashException(document) : void matchDocument(document)}
                          className="inline-flex items-center justify-center rounded-lg bg-[#d3bb73] px-3 py-1.5 text-[11px] font-medium text-[#141827] disabled:cursor-not-allowed disabled:opacity-35"
                        >
                          {matchingId === document.document_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><FileText className="mr-1.5 h-3.5 w-3.5" />{cashReviewAvailable ? 'Potwierdź wyjątek' : 'Dopasuj'}</>}
                        </button>
                        {reason && <p className="mt-1 text-left text-[10px] leading-4 text-[#e5e4e2]/55">{reason}</p>}
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
