'use client';

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import {
  CheckCircle,
  X,
  Link as LinkIcon,
  TrendingUp,
  AlertCircle,
} from 'lucide-react';
import ResponsiveActionBar from './ResponsiveActionBar';

interface Transaction {
  id: string;
  transaction_date: string;
  amount: number;
  currency: string;
  counterparty_name?: string;
  title?: string;
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
  payment_status?: string | null;
  invoice_type?: 'issued' | 'received' | null;
}

interface MatchScore {
  invoice: KSeFInvoice;
  transaction: Transaction;
  score: number;
  reasons: string[];
}

interface Props {
  month: number;
  year: number;
  onClose: () => void;
}

function normalizeText(text?: string | null): string {
  if (!text) return '';
  return text
    .toUpperCase()
    .replace(/[ĄĆĘŁŃÓŚŹŻ]/g, (char) => {
      const map: Record<string, string> = {
        'Ą': 'A', 'Ć': 'C', 'Ę': 'E', 'Ł': 'L',
        'Ń': 'N', 'Ó': 'O', 'Ś': 'S', 'Ź': 'Z', 'Ż': 'Z'
      };
      return map[char] || char;
    })
    .replace(/[^A-Z0-9]/g, '');
}

function calculateMatchScore(
  transaction: Transaction,
  invoice: KSeFInvoice
): MatchScore | null {
  const reasons: string[] = [];
  let score = 0;

  const amount = Math.abs(transaction.amount);
  const invoiceAmount = invoice.gross_amount ?? 0;
  const amountDiff = Math.abs(amount - invoiceAmount);
  const amountDiffPercent = invoiceAmount > 0 ? (amountDiff / invoiceAmount) * 100 : 100;

  if (amountDiffPercent < 1) {
    score += 50;
    reasons.push('Kwota dokładnie zgadza się');
  } else if (amountDiffPercent < 5) {
    score += 30;
    reasons.push('Kwota prawie się zgadza');
  } else if (amountDiffPercent > 20) {
    return null;
  }

  const transDate = new Date(transaction.transaction_date);
  const invoiceDate = invoice.issue_date ? new Date(invoice.issue_date) : null;
  const dueDate = invoice.payment_due_date ? new Date(invoice.payment_due_date) : null;

  if (dueDate) {
    const daysDiff = Math.abs((transDate.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
    if (daysDiff <= 3) {
      score += 20;
      reasons.push('Płatność w terminie');
    } else if (daysDiff <= 7) {
      score += 10;
      reasons.push('Płatność blisko terminu');
    }
  }

  const transParty = normalizeText(transaction.counterparty_name);
  const invoiceBuyer = normalizeText(invoice.buyer_name);
  const invoiceSeller = normalizeText(invoice.seller_name);

  if (transParty && invoiceBuyer && transParty.includes(invoiceBuyer.slice(0, 10))) {
    score += 20;
    reasons.push('Nazwa kontrahenta pasuje');
  } else if (transParty && invoiceSeller && transParty.includes(invoiceSeller.slice(0, 10))) {
    score += 20;
    reasons.push('Nazwa kontrahenta pasuje');
  }

  const transTitle = normalizeText(transaction.title);
  const invoiceNumber = normalizeText(invoice.invoice_number);

  if (transTitle && invoiceNumber && transTitle.includes(invoiceNumber)) {
    score += 30;
    reasons.push('Numer faktury w tytule');
  }

  if (score < 20) return null;

  return {
    invoice,
    transaction,
    score,
    reasons,
  };
}

export default function BankMatchingSimple({ month, year, onClose }: Props) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [invoices, setInvoices] = useState<KSeFInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const { showSnackbar } = useSnackbar();

  useEffect(() => {
    loadData();
  }, [month, year]);

  const loadData = async () => {
    try {
      setLoading(true);

      const { data: statements } = await supabase
        .from('bank_statements')
        .select('id')
        .eq('statement_month', month)
        .eq('statement_year', year);

      if (statements && statements.length > 0) {
        const statementIds = statements.map((s) => s.id);

        const { data: transData, error: transError } = await supabase
          .from('bank_transactions')
          .select('*')
          .in('statement_id', statementIds)
          .is('matched_invoice_id', null)
          .eq('transaction_type', 'credit')
          .order('transaction_date', { ascending: false });

        if (transError) throw transError;
        setTransactions(transData || []);
      }

      const { data: invoicesData, error: invError } = await supabase
        .from('ksef_invoices')
        .select('*')
        .in('payment_status', ['unpaid', 'overdue'])
        .neq('payment_method', '1')
        .order('payment_due_date', { ascending: true });

      if (invError) throw invError;
      setInvoices(invoicesData || []);
    } catch (error: any) {
      console.error('Error loading data:', error);
      showSnackbar(error.message || 'Błąd podczas ładowania danych', 'error');
    } finally {
      setLoading(false);
    }
  };

  const matchScores = useMemo(() => {
    const scores: MatchScore[] = [];

    transactions.forEach((trans) => {
      invoices.forEach((inv) => {
        const match = calculateMatchScore(trans, inv);
        if (match) {
          scores.push(match);
        }
      });
    });

    return scores.sort((a, b) => b.score - a.score);
  }, [transactions, invoices]);

  const handleMatch = async (match: MatchScore) => {
    try {
      const { error: transError } = await supabase
        .from('bank_transactions')
        .update({
          matched_invoice_id: match.invoice.id,
          match_confidence: match.score / 100,
          manual_match: true,
        })
        .eq('id', match.transaction.id);

      if (transError) throw transError;

      const { error: invError } = await supabase
        .from('ksef_invoices')
        .update({
          payment_status: 'paid',
          payment_date: match.transaction.transaction_date,
        })
        .eq('id', match.invoice.id);

      if (invError) throw invError;

      showSnackbar('Płatność została dopasowana', 'success');
      await loadData();
    } catch (error: any) {
      console.error('Error matching:', error);
      showSnackbar(error.message || 'Błąd podczas dopasowywania', 'error');
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-6xl rounded-xl bg-[#1c1f33] border border-[#d3bb73]/20 shadow-xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between border-b border-[#d3bb73]/10 p-6">
          <div>
            <h3 className="text-xl font-medium text-[#e5e4e2]">
              Dopasowanie płatności - {month}/{year}
            </h3>
            <p className="mt-1 text-sm text-[#e5e4e2]/60">
              Faktury gotówkowe są automatycznie wykluczane
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
        ) : matchScores.length === 0 ? (
          <div className="flex items-center justify-center p-12">
            <div className="text-center">
              <CheckCircle className="mx-auto mb-3 h-12 w-12 text-green-400" />
              <p className="text-[#e5e4e2]">Brak sugestii do dopasowania</p>
              <p className="mt-2 text-sm text-[#e5e4e2]/60">
                Wszystkie transakcje zostały dopasowane lub nie ma pasujących faktur
              </p>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="space-y-4">
              {matchScores.map((match, index) => (
                <div
                  key={`${match.transaction.id}-${match.invoice.id}`}
                  className="rounded-lg bg-[#252942] border border-[#d3bb73]/10 p-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-3">
                      <div className="flex items-center gap-3">
                        <div
                          className={`flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${
                            match.score >= 80
                              ? 'bg-green-500/20 text-green-400'
                              : match.score >= 60
                                ? 'bg-blue-500/20 text-blue-400'
                                : 'bg-orange-500/20 text-orange-400'
                          }`}
                        >
                          <TrendingUp className="h-3 w-3" />
                          {match.score}% dopasowania
                        </div>
                        {index === 0 && (
                          <span className="text-xs text-[#d3bb73]">
                            Najlepsze dopasowanie
                          </span>
                        )}
                      </div>

                      <div className="grid gap-3 md:grid-cols-2">
                        <div>
                          <div className="text-xs text-[#e5e4e2]/60 mb-1">Transakcja</div>
                          <div className="text-sm text-[#e5e4e2]">
                            {new Date(match.transaction.transaction_date).toLocaleDateString('pl-PL')}
                          </div>
                          <div className="text-sm font-medium text-[#e5e4e2]">
                            {match.transaction.amount.toFixed(2)} {match.transaction.currency}
                          </div>
                          {match.transaction.counterparty_name && (
                            <div className="text-xs text-[#e5e4e2]/60 mt-1">
                              {match.transaction.counterparty_name}
                            </div>
                          )}
                        </div>

                        <div>
                          <div className="text-xs text-[#e5e4e2]/60 mb-1">Faktura</div>
                          <div className="text-sm text-[#e5e4e2]">
                            {match.invoice.invoice_number || match.invoice.ksef_reference_number}
                          </div>
                          <div className="text-sm font-medium text-[#e5e4e2]">
                            {match.invoice.gross_amount?.toFixed(2)} PLN
                          </div>
                          <div className="text-xs text-[#e5e4e2]/60 mt-1">
                            Termin: {match.invoice.payment_due_date
                              ? new Date(match.invoice.payment_due_date).toLocaleDateString('pl-PL')
                              : '—'}
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {match.reasons.map((reason, idx) => (
                          <span
                            key={idx}
                            className="inline-flex items-center gap-1 rounded-full bg-[#d3bb73]/10 px-2 py-1 text-xs text-[#d3bb73]"
                          >
                            <AlertCircle className="h-3 w-3" />
                            {reason}
                          </span>
                        ))}
                      </div>
                    </div>

                    <ResponsiveActionBar
                      actions={[
                        {
                          label: 'Dopasuj',
                          icon: LinkIcon,
                          onClick: () => handleMatch(match),
                          variant: 'primary',
                        },
                      ]}
                      disabledBackground
                      alwaysBreakpoint
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
