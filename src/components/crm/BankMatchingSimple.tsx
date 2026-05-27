'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import {
  CheckCircle,
  X,
  AlertCircle,
  TrendingUp,
  Link as LinkIcon,
  Calendar,
  Building2,
  CreditCard,
} from 'lucide-react';
import ResponsiveActionBar from './ResponsiveActionBar';

interface Transaction {
  id: string;
  transaction_date: string;
  posting_date?: string | null;
  amount: number;
  currency: string;
  transaction_type: 'debit' | 'credit';
  counterparty_name?: string | null;
  counterparty_account?: string | null;
  title?: string | null;
  reference_number?: string | null;
  matched_invoice_id?: string | null;
  match_confidence?: number | null;
  manual_match?: boolean;
}

export interface KSeFInvoice {
  id: string;
  invoice_number?: string | null;
  ksef_reference_number: string;
  buyer_name?: string | null;
  seller_name?: string | null;
  issue_date?: string | null;
  payment_due_date?: string | null;
  gross_amount?: number | null;
  payment_status?: string | null;
  invoice_type?: 'issued' | 'received' | null;
  seller_nip?: string | null;
  buyer_nip?: string | null;
  my_company_id?: string | null;
}

interface Props {
  month: number;
  year: number;
  companyId: string | null;
  onClose: () => void;
  invoiceData: KSeFInvoice;
}

interface MatchScore {
  transaction: Transaction;
  invoice: KSeFInvoice;
  score: number;
  reasons: string[];
}

function normalizeText(text?: string | null): string {
  if (!text) return '';

  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function formatMoney(value?: number | null, currency = 'PLN') {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return `${Number(value).toFixed(2)} ${currency}`;
}

function formatDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('pl-PL');
}

function calculateMatchScore(transaction: Transaction, invoice: KSeFInvoice): MatchScore | null {
  const reasons: string[] = [];
  let score = 0;

  const transactionAmount = Math.abs(Number(transaction.amount || 0));
  const invoiceAmount = Math.abs(Number(invoice.gross_amount || 0));

  if (invoiceAmount <= 0 || transactionAmount <= 0) return null;

  const amountDiff = Math.abs(transactionAmount - invoiceAmount);
  const amountDiffPercent = (amountDiff / invoiceAmount) * 100;

  if (amountDiffPercent < 0.5) {
    score += 55;
    reasons.push('Kwota dokładnie zgadza się');
  } else if (amountDiffPercent < 2) {
    score += 40;
    reasons.push('Kwota prawie się zgadza');
  } else if (amountDiffPercent < 5) {
    score += 25;
    reasons.push('Kwota zbliżona');
  } else if (amountDiffPercent > 20) {
    return null;
  }

  const transactionDate = new Date(transaction.transaction_date);
  const issueDate = invoice.issue_date ? new Date(invoice.issue_date) : null;
  const dueDate = invoice.payment_due_date ? new Date(invoice.payment_due_date) : null;

  if (issueDate && !Number.isNaN(issueDate.getTime())) {
    const daysFromIssue = Math.abs(
      (transactionDate.getTime() - issueDate.getTime()) / (1000 * 60 * 60 * 24),
    );

    if (daysFromIssue <= 3) {
      score += 12;
      reasons.push('Data bliska wystawieniu');
    } else if (daysFromIssue <= 7) {
      score += 6;
      reasons.push('Data bliska dacie faktury');
    }
  }

  if (dueDate && !Number.isNaN(dueDate.getTime())) {
    const daysFromDue = Math.abs(
      (transactionDate.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24),
    );

    if (daysFromDue <= 3) {
      score += 18;
      reasons.push('Płatność blisko terminu');
    } else if (daysFromDue <= 7) {
      score += 10;
      reasons.push('Termin płatności pasuje');
    }
  }

  const transactionParty = normalizeText(transaction.counterparty_name);
  const sellerName = normalizeText(invoice.seller_name);
  const buyerName = normalizeText(invoice.buyer_name);

  if (transactionParty && sellerName) {
    if (
      transactionParty.includes(sellerName.slice(0, 10)) ||
      sellerName.includes(transactionParty.slice(0, 10))
    ) {
      score += 22;
      reasons.push('Kontrahent dokładnie pasuje');
    }
  } else if (transactionParty && buyerName) {
    if (
      transactionParty.includes(buyerName.slice(0, 10)) ||
      buyerName.includes(transactionParty.slice(0, 10))
    ) {
      score += 12;
      reasons.push('Kontrahent częściowo pasuje');
    }
  }

  const transactionTitle = normalizeText(transaction.title);
  const invoiceNumber = normalizeText(invoice.invoice_number);
  const ksefNumber = normalizeText(invoice.ksef_reference_number);

  if (transactionTitle && invoiceNumber && transactionTitle.includes(invoiceNumber)) {
    score += 25;
    reasons.push('Numer faktury w tytule');
  } else if (transactionTitle && invoiceNumber) {
    const shortenedInvoiceNumber = invoiceNumber.slice(-8);
    if (shortenedInvoiceNumber && transactionTitle.includes(shortenedInvoiceNumber)) {
      score += 15;
      reasons.push('Końcówka numeru faktury w tytule');
    }
  }

  if (transactionTitle && ksefNumber && transactionTitle.includes(ksefNumber.slice(-10))) {
    score += 10;
    reasons.push('Numer KSeF w tytule');
  }

  if (score < 20) return null;

  return {
    transaction,
    invoice,
    score: Math.min(score, 100),
    reasons,
  };
}

const COL_CONTRACTOR = 'w-[260px]';
const COL_DOC = 'w-[260px]';
const COL_DATE = 'w-[260px]';
const COL_AMOUNT = 'w-[260px]';
const COL_SCORE = 'w-[260px]';
const COL_REASONS = 'w-[12%]';
const COL_ACTION = 'w-[6%]';

export default function BankMatchingSimple({ month, year, companyId, invoiceData, onClose }: Props) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [matchingId, setMatchingId] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<KSeFInvoice[]>([]);
  const { showSnackbar } = useSnackbar();

  useEffect(() => {
    void loadData();
  }, [month, year, companyId]);

  const loadData = async () => {
    try {
      setLoading(true);
  
      // 1. Pobierz wszystkie wyciągi z danego roku
      let statementsQuery = supabase
        .from('bank_statements')
        .select('id')
        .eq('statement_year', year);
  
      if (companyId) {
        statementsQuery = statementsQuery.eq('my_company_id', companyId);
      }
  
      const { data: statements, error: statementsError } = await statementsQuery;
  
      if (statementsError) throw statementsError;
  
      const allStatementIds = (statements || []).map((statement) => statement.id);
  
      if (!allStatementIds.length) {
        setTransactions([]);
      } else {
        const { data: transactionsData, error: transactionsError } = await supabase
          .from('bank_transactions')
          .select('*')
          .in('statement_id', allStatementIds)
          .is('matched_invoice_id', null)
          .eq('transaction_type', 'debit')
          .order('transaction_date', { ascending: false });
  
        if (transactionsError) throw transactionsError;
  
        setTransactions((transactionsData || []) as Transaction[]);
      }
  
      // 2. Pobierz nieopłacone faktury kosztowe z całego roku
      const yearStart = `${year}-01-01`;
      const yearEnd = `${year + 1}-01-01`;
  
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
          payment_status,
          invoice_type,
          seller_nip,
          buyer_nip,
          my_company_id
        `)
        .eq('invoice_type', 'received')
        .neq('payment_status', 'paid')
        .gte('issue_date', yearStart)
        .lt('issue_date', yearEnd);
  
      if (companyId) {
        invoicesQuery = invoicesQuery.eq('my_company_id', companyId);
      }
  
      const { data: invoicesData, error: invoicesError } = await invoicesQuery;
  
      if (invoicesError) throw invoicesError;
  
      setInvoices((invoicesData || []) as KSeFInvoice[]);
    } catch (error: any) {
      console.error('Error loading bank matching data:', error);
      showSnackbar(error.message || 'Błąd podczas ładowania danych do dopasowania', 'error');
    } finally {
      setLoading(false);
    }
  };

  const matchScores = useMemo(() => {
    return transactions
      .flatMap((transaction) =>
        invoices
          .map((invoice) => calculateMatchScore(transaction, invoice))
          .filter((match): match is MatchScore => Boolean(match)),
      )
      .sort((a, b) => b.score - a.score);
  }, [transactions, invoices]);

  const handleMatch = async (match: MatchScore) => {
    try {
      setMatchingId(match.transaction.id);

      const { error: transactionError } = await supabase
        .from('bank_transactions')
        .update({
          matched_invoice_id: match.invoice.id,
          match_confidence: match.score / 100,
          manual_match: true,
        })
        .eq('id', match.transaction.id);

      if (transactionError) throw transactionError;

      const { error: invoiceError } = await supabase
        .from('ksef_invoices')
        .update({
          payment_status: 'paid',
          payment_date: match.transaction.transaction_date,
        })
        .eq('id', match.invoice.id);

      if (invoiceError) throw invoiceError;

      showSnackbar('Płatność została dopasowana', 'success');
      onClose();
    } catch (error: any) {
      console.error('Error matching payment:', error);
      showSnackbar(error.message || 'Błąd podczas dopasowania płatności', 'error');
    } finally {
      setMatchingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[90vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-[#d3bb73]/20 bg-[#1c1f33] shadow-xl">
        <div className="flex items-start justify-between border-b border-[#d3bb73]/10 p-6">
          <div>
            <h3 className="text-2xl font-medium text-[#e5e4e2]">Dopasowanie płatności</h3>
            <p className="mt-1 text-sm text-[#e5e4e2]/60">
              Szukamy wypłat z wyciągów, które pasują do tej faktury kosztowej
            </p>
          </div>

          <button
            onClick={onClose}
            className="text-[#e5e4e2]/60 transition-colors hover:text-[#e5e4e2]"
          >
            <X className="h-6 w-6" />
          </button>
        </div>


        {loading ? (
          <div className="flex min-h-[320px] items-center justify-center">
            <div className="text-lg text-[#e5e4e2]/60">Ładowanie...</div>
          </div>
        ) : matchScores.length === 0 ? (
          <div className="flex min-h-[320px] items-center justify-center p-8">
            <div className="text-center">
              <CheckCircle className="mx-auto mb-4 h-12 w-12 text-green-400" />
              <div className="text-lg text-[#e5e4e2]">Brak sugestii do dopasowania</div>
              <div className="mt-2 text-sm text-[#e5e4e2]/60">
                Nie znaleziono wypłat pasujących do tej faktury w wyciągach z okolic {month}/{year}.
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-auto p-6">
            <div className="mb-4 flex items-center justify-between">
              <div className="text-sm text-[#e5e4e2]/60">
                Znalezione sugestie:{' '}
                <span className="font-medium text-[#e5e4e2]">{matchScores.length}</span>
              </div>
              <div className="text-xs text-[#e5e4e2]/40">Maksymalny score: 100%</div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-[#d3bb73]/10">
              <table className="min-w-full table-fixed border-collapse">
                <thead>
                  <tr className="border-b border-[#d3bb73]/10 bg-[#252945] text-left">
                    <th
                      className={`${COL_CONTRACTOR} px-6 py-4 text-xs font-medium uppercase tracking-wider text-[#e5e4e2]/60 max-${COL_CONTRACTOR}`}
                    >
                      Kontrahent
                    </th>
                    <th
                      className={`${COL_DOC} px-6 py-4 text-xs font-medium uppercase tracking-wider text-[#e5e4e2]/60`}
                    >
                      Numer faktury / tytuł przelewu
                    </th>
                    <th
                      className={`${COL_DATE} px-6 py-4 text-xs font-medium uppercase tracking-wider text-[#e5e4e2]/60`}
                    >
                      Data płatności
                    </th>
                    <th
                      className={`${COL_AMOUNT} px-6 py-4 text-xs font-medium uppercase tracking-wider text-[#e5e4e2]/60`}
                    >
                      Kwota brutto
                    </th>
                    <th
                      className={`${COL_SCORE} px-6 py-4 text-xs font-medium uppercase tracking-wider text-[#e5e4e2]/60`}
                    >
                      % dopasowania
                    </th>
                    <th
                      className={`${COL_REASONS} px-6 py-4 text-xs font-medium uppercase tracking-wider text-[#e5e4e2]/60`}
                    >
                      Powody dopasowania
                    </th>
                    <th
                      className={`${COL_ACTION} px-6 py-4 text-right text-xs font-medium uppercase tracking-wider text-[#e5e4e2]/60`}
                    >
                      Akcja
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {matchScores.map((match, index) => (
                    <tr
                      key={`${match.transaction.id}-${match.invoice.id}`}
                      className="border-b border-[#d3bb73]/10 transition-colors hover:bg-[#1c1f33]/30"
                    >
                      <td
                        className={`${COL_CONTRACTOR} px-6 py-5 align-top text-sm text-[#e5e4e2]/80 max-w-[260px]`}
                      >
                        <div className="truncate">
                          {match.transaction.counterparty_name || 'Brak kontrahenta'}
                        </div>
                        {match.transaction.counterparty_account && (
                          <div className="mt-1 truncate text-xs text-[#e5e4e2]/40">
                            {match.transaction.counterparty_account}
                          </div>
                        )}
                      </td>

                      <td className={`${COL_DOC} px-6 py-5 align-top text-sm text-[#e5e4e2] max-w-[260px]`}>
                        <div className="truncate font-medium">
                          {match.transaction.title || 'Brak tytułu przelewu'}
                        </div>
                        <div className="mt-2 truncate text-xs text-[#e5e4e2]/40">
                          Faktura:{' '}
                          {match.invoice.invoice_number || match.invoice.ksef_reference_number}
                        </div>
                        {match.transaction.reference_number && (
                          <div className="mt-1 truncate text-xs text-[#e5e4e2]/40">
                            Ref: {match.transaction.reference_number}
                          </div>
                        )}
                      </td>

                      <td className={`${COL_DATE} px-6 py-5 align-top text-sm text-[#e5e4e2]/80`}>
                        <div>{formatDate(match.transaction.transaction_date)}</div>
                        <div className="mt-1 text-xs text-[#e5e4e2]/40">
                          Wystawiona: {formatDate(match.invoice.issue_date)}
                        </div>
                      </td>

                      <td
                        className={`${COL_AMOUNT} px-6 py-5 align-top text-sm font-medium text-[#e5e4e2]`}
                      >
                        {formatMoney(match.transaction.amount)}
                      </td>

                      <td className={`${COL_SCORE} px-6 py-5 align-top`}>
                        <div
                          className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${
                            match.score >= 80
                              ? 'bg-green-500/20 text-green-400'
                              : match.score >= 60
                                ? 'bg-blue-500/20 text-blue-400'
                                : 'bg-orange-500/20 text-orange-400'
                          }`}
                        >
                          <TrendingUp className="h-3 w-3" />
                          {match.score}%
                        </div>

                        {index === 0 && (
                          <div className="mt-2 text-xs font-medium text-[#d3bb73]">
                            Najlepsze dopasowanie
                          </div>
                        )}
                      </td>

                      <td className={`${COL_REASONS} px-6 py-5 align-top`}>
                        <div className="flex flex-wrap gap-2">
                          {match.reasons.map((reason, idx) => (
                            <span
                              key={idx}
                              className="inline-flex items-center gap-1 rounded-full bg-[#d3bb73]/10 px-2.5 py-1 text-xs text-[#d3bb73]"
                            >
                              <AlertCircle className="h-3 w-3" />
                              {reason}
                            </span>
                          ))}
                        </div>
                      </td>

                      <td className={`${COL_ACTION} px-6 py-5 text-right align-top`}>
                        <ResponsiveActionBar
                          actions={[
                            {
                              label: 'Dopasuj',
                              onClick: () => handleMatch(match),
                              variant: 'primary',
                            },
                          ]}
                          disabledBackground
                          mobileBreakpoint={4000}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
