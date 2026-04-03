'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import {
  TrendingUp,
  TrendingDown,
  FileText,
  Calendar,
  Upload,
  CheckCircle,
  AlertCircle,
  Clock,
  Link as LinkIcon,
} from 'lucide-react';
import { parseMT940, parseJPK_WB, findMatchingInvoices } from '@/lib/bankStatementParsers';
import BankTransactionsAnalysis from './BankTransactionsAnalysis';

interface MonthlySummary {
  id: string;
  month: number;
  year: number;
  total_income: number;
  total_expenses: number;
  invoices_issued_count: number;
  invoices_received_count: number;
  invoices_paid_count: number;
  invoices_unpaid_count: number;
  invoices_overdue_count: number;
  bank_statement_uploaded: boolean;
}

const MONTHS = [
  'Styczeń',
  'Luty',
  'Marzec',
  'Kwiecień',
  'Maj',
  'Czerwiec',
  'Lipiec',
  'Sierpień',
  'Wrzesień',
  'Październik',
  'Listopad',
  'Grudzień',
];

export default function KSeFFinancialDashboard() {
  const [summaries, setSummaries] = useState<MonthlySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState<MonthlySummary | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ step: '', current: 0, total: 0 });
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [showUnmatchedModal, setShowUnmatchedModal] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [unmatchedModalMonth, setUnmatchedModalMonth] = useState<{
    month: number;
    year: number;
  } | null>(null);
  const { showSnackbar } = useSnackbar();

  useEffect(() => {
    loadSummaries();
  }, [selectedYear]);

  const handleSelectedFile = async (file: File | null, month: number, year: number) => {
    if (!file) return;
    await handleFileUpload(file, month, year);
  };

  const loadSummaries = async () => {
    try {
      setLoading(true);

      const summariesPromises = [];
      for (let month = 1; month <= 12; month++) {
        summariesPromises.push(
          supabase.rpc('update_monthly_summary', { p_month: month, p_year: selectedYear }),
        );
      }

      await Promise.all(summariesPromises);

      const { data, error } = await supabase
        .from('monthly_financial_summaries')
        .select('*')
        .eq('year', selectedYear)
        .order('month', { ascending: true });

      if (error) throw error;

      const fullYearData: MonthlySummary[] = [];
      for (let month = 1; month <= 12; month++) {
        const existingMonth = data?.find((d) => d.month === month);
        if (existingMonth) {
          fullYearData.push(existingMonth);
        } else {
          fullYearData.push({
            id: `${selectedYear}-${month}`,
            month,
            year: selectedYear,
            total_income: 0,
            total_expenses: 0,
            invoices_issued_count: 0,
            invoices_received_count: 0,
            invoices_paid_count: 0,
            invoices_unpaid_count: 0,
            invoices_overdue_count: 0,
            bank_statement_uploaded: false,
          });
        }
      }

      setSummaries(fullYearData);

      const { data: yearsData } = await supabase
        .from('monthly_financial_summaries')
        .select('year')
        .order('year', { ascending: false });

      if (yearsData) {
        const uniqueYears = [...new Set(yearsData.map((d) => d.year))];
        if (!uniqueYears.includes(new Date().getFullYear())) {
          uniqueYears.unshift(new Date().getFullYear());
        }
        setAvailableYears(uniqueYears);
      }
    } catch (error: any) {
      console.error('Error loading summaries:', error);
      showSnackbar(error.message || 'Błąd podczas ładowania podsumowań', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (file: File, month: number, year: number) => {
    try {
      setUploadingFile(true);
      setUploadProgress({ step: 'Wczytywanie pliku...', current: 0, total: 7 });

      const fileContent = await file.text();
      const fileType = file.name.toLowerCase().endsWith('.xml') ? 'JPK_WB' : 'MT940';

      setUploadProgress({ step: 'Wyszukiwanie poprzedniego wyciągu...', current: 1, total: 7 });

      const { data: existingStatements, error: existingStatementsError } = await supabase
        .from('bank_statements')
        .select('id')
        .eq('statement_month', month)
        .eq('statement_year', year);

      if (existingStatementsError) throw existingStatementsError;

      const existingStatementIds = (existingStatements || []).map((s) => s.id);

      if (existingStatementIds.length > 0) {
        setUploadProgress({ step: 'Czyszczenie starego wyciągu...', current: 2, total: 7 });

        const { data: oldTransactions, error: oldTransactionsError } = await supabase
          .from('bank_transactions')
          .select('id, matched_invoice_id')
          .in('statement_id', existingStatementIds);

        if (oldTransactionsError) throw oldTransactionsError;

        const oldMatchedInvoiceIds = [
          ...new Set((oldTransactions || []).map((t) => t.matched_invoice_id).filter(Boolean)),
        ];

        if (oldMatchedInvoiceIds.length > 0) {
          const { error: resetInvoicesError } = await supabase
            .from('ksef_invoices')
            .update({
              payment_status: 'unpaid',
              payment_date: null,
            })
            .in('id', oldMatchedInvoiceIds);

          if (resetInvoicesError) throw resetInvoicesError;
        }

        const { error: deleteTransactionsError } = await supabase
          .from('bank_transactions')
          .delete()
          .in('statement_id', existingStatementIds);

        if (deleteTransactionsError) throw deleteTransactionsError;

        const { error: deleteStatementsError } = await supabase
          .from('bank_statements')
          .delete()
          .in('id', existingStatementIds);

        if (deleteStatementsError) throw deleteStatementsError;
      }

      setUploadProgress({ step: 'Parsowanie wyciągu bankowego...', current: 3, total: 7 });

      let parsedStatement;
      try {
        if (fileType === 'MT940') {
          parsedStatement = parseMT940(fileContent);
        } else {
          parsedStatement = parseJPK_WB(fileContent);
        }
      } catch (parseError: any) {
        throw new Error(`Błąd parsowania: ${parseError.message}`);
      }

      setUploadProgress({ step: 'Zapisywanie nowego wyciągu...', current: 4, total: 7 });

      const {
        data: { user },
      } = await supabase.auth.getUser();

      const { data: statement, error: statementError } = await supabase
        .from('bank_statements')
        .insert({
          file_name: file.name,
          file_type: fileType,
          file_content: fileContent,
          statement_month: month,
          statement_year: year,
          account_number: parsedStatement.accountNumber,
          opening_balance: parsedStatement.openingBalance,
          closing_balance: parsedStatement.closingBalance,
          currency: parsedStatement.currency,
          transactions_count: parsedStatement.transactions.length,
          uploaded_by: user?.id,
          processed: false,
        })
        .select()
        .single();

      if (statementError) throw statementError;

      setUploadProgress({
        step: `Przetwarzanie transakcji (0/${parsedStatement.transactions.length})...`,
        current: 5,
        total: 7,
      });

      let matchedCount = 0;
      let unmatchedCount = 0;

      for (let i = 0; i < parsedStatement.transactions.length; i++) {
        const transaction = parsedStatement.transactions[i];

        if (i % 5 === 0) {
          setUploadProgress({
            step: `Przetwarzanie transakcji (${i + 1}/${parsedStatement.transactions.length})...`,
            current: 5,
            total: 7,
          });
        }

        const matches = await findMatchingInvoices(transaction, supabase);

        let matchedInvoiceId: string | null = null;
        let matchConfidence: number | null = null;

        if (matches.length > 0 && matches[0].confidence >= 0.95) {
          matchedInvoiceId = matches[0].invoiceId;
          matchConfidence = matches[0].confidence;
          matchedCount++;

          const { error: markPaidError } = await supabase
            .from('ksef_invoices')
            .update({
              payment_status: 'paid',
              payment_date: transaction.transactionDate,
            })
            .eq('id', matchedInvoiceId);

          if (markPaidError) throw markPaidError;
        } else if (matches.length > 0 && matches[0].confidence >= 0.75) {
          matchedInvoiceId = matches[0].invoiceId;
          matchConfidence = matches[0].confidence;
          unmatchedCount++;
        } else {
          unmatchedCount++;
        }

        const { error: insertTransactionError } = await supabase.from('bank_transactions').insert({
          statement_id: statement.id,
          transaction_date: transaction.transactionDate,
          posting_date: transaction.postingDate,
          amount: transaction.amount,
          currency: transaction.currency,
          transaction_type: transaction.type,
          counterparty_name: transaction.counterpartyName,
          counterparty_account: transaction.counterpartyAccount,
          title: transaction.title,
          reference_number: transaction.referenceNumber,
          matched_invoice_id: matchedInvoiceId,
          match_confidence: matchConfidence,
          manual_match: false,
        });

        if (insertTransactionError) throw insertTransactionError;
      }

      setUploadProgress({ step: 'Finalizowanie importu...', current: 6, total: 7 });

      const { error: finalizeStatementError } = await supabase
        .from('bank_statements')
        .update({
          processed: true,
          processed_at: new Date().toISOString(),
        })
        .eq('id', statement.id);

      if (finalizeStatementError) throw finalizeStatementError;

      await loadSummaries();

      setSelectedMonth((prev) =>
        prev
          ? {
              ...prev,
              bank_statement_uploaded: true,
            }
          : prev,
      );

      showSnackbar(
        `Wyciąg został podmieniony. Transakcji: ${parsedStatement.transactions.length}, automatycznie dopasowanych: ${matchedCount}, do weryfikacji: ${unmatchedCount}`,
        'success',
      );
    } catch (error: any) {
      console.error('Error uploading file:', error);
      showSnackbar(error.message || 'Błąd podczas importu wyciągu', 'error');
    } finally {
      setUploadingFile(false);
      setUploadProgress({ step: '', current: 0, total: 0 });
    }
  };

  const currentDate = new Date();
  const currentMonth =
    summaries.find((s) => s.month === currentDate.getMonth() + 1 && s.year === selectedYear) ||
    summaries[0] ||
    null;

  const monthsWithData = summaries.filter(
    (s) => s.invoices_issued_count > 0 || s.invoices_received_count > 0,
  );

  const displayedSummaries =
    monthsWithData.length > 0 && monthsWithData.length < 12 ? monthsWithData : summaries;

  const yearTotals = summaries.reduce(
    (acc, s) => ({
      income: acc.income + s.total_income,
      expenses: acc.expenses + s.total_expenses,
      issued: acc.issued + s.invoices_issued_count,
      received: acc.received + s.invoices_received_count,
      paid: acc.paid + s.invoices_paid_count,
      unpaid: acc.unpaid + s.invoices_unpaid_count,
      overdue: acc.overdue + s.invoices_overdue_count,
    }),
    { income: 0, expenses: 0, issued: 0, received: 0, paid: 0, unpaid: 0, overdue: 0 },
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-light text-[#e5e4e2]">Dashboard Finansowy KSeF</h2>
          <p className="mt-1 text-sm text-[#e5e4e2]/60">
            Podsumowanie finansowe faktur z systemu KSeF
          </p>
        </div>

        <div className="flex items-center gap-3">
          <label className="text-sm text-[#e5e4e2]/60">Rok rozliczeniowy:</label>
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            className="rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
          >
            {availableYears.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="rounded-xl border border-[#d3bb73]/20 bg-gradient-to-br from-[#d3bb73]/10 to-[#d3bb73]/5 p-6">
        <h3 className="mb-4 text-lg font-medium text-[#e5e4e2]">
          Podsumowanie {selectedYear} roku
        </h3>
        <div className="grid gap-4 md:grid-cols-4">
          <div>
            <div className="text-sm text-[#e5e4e2]/60">Przychody</div>
            <div className="text-xl font-bold text-green-400">
              {yearTotals.income.toFixed(2)} PLN
            </div>
            <div className="text-xs text-[#e5e4e2]/40">{yearTotals.issued} faktur</div>
          </div>
          <div>
            <div className="text-sm text-[#e5e4e2]/60">Wydatki</div>
            <div className="text-xl font-bold text-red-400">
              {yearTotals.expenses.toFixed(2)} PLN
            </div>
            <div className="text-xs text-[#e5e4e2]/40">{yearTotals.received} faktur</div>
          </div>
          <div>
            <div className="text-sm text-[#e5e4e2]/60">Bilans</div>
            <div
              className={`text-xl font-bold ${
                yearTotals.income - yearTotals.expenses >= 0 ? 'text-green-400' : 'text-red-400'
              }`}
            >
              {(yearTotals.income - yearTotals.expenses).toFixed(2)} PLN
            </div>
          </div>
          <div>
            <div className="text-sm text-[#e5e4e2]/60">Status płatności</div>
            <div className="mt-1 flex gap-2 text-xs">
              <span className="text-green-400">{yearTotals.paid} opł.</span>
              <span className="text-orange-400">{yearTotals.unpaid} nieop.</span>
              <span className="text-red-400">{yearTotals.overdue} przet.</span>
            </div>
          </div>
        </div>
      </div>

      {monthsWithData.length > 0 && monthsWithData.length < 12 && (
        <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 p-4 text-sm text-blue-400">
          <strong>Uwaga:</strong> W roku {selectedYear} masz faktury tylko w {monthsWithData.length}{' '}
          {monthsWithData.length === 1 ? 'miesiącu' : 'miesiącach'}. Poniżej wyświetlane są tylko
          miesiące z danymi.
        </div>
      )}

      {false && currentMonth && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-green-500/20 bg-gradient-to-br from-green-500/10 to-green-600/5 p-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-[#e5e4e2]/60">Przychody</div>
                <div className="mt-2 text-2xl font-bold text-green-400">
                  {currentMonth.total_income.toFixed(2)} PLN
                </div>
                <div className="mt-1 text-xs text-[#e5e4e2]/40">
                  {currentMonth.invoices_issued_count} faktur
                </div>
              </div>
              <TrendingUp className="h-8 w-8 text-green-400" />
            </div>
          </div>

          <div className="rounded-xl border border-red-500/20 bg-gradient-to-br from-red-500/10 to-red-600/5 p-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-[#e5e4e2]/60">Wydatki</div>
                <div className="mt-2 text-2xl font-bold text-red-400">
                  {currentMonth.total_expenses.toFixed(2)} PLN
                </div>
                <div className="mt-1 text-xs text-[#e5e4e2]/40">
                  {currentMonth.invoices_received_count} faktur
                </div>
              </div>
              <TrendingDown className="h-8 w-8 text-red-400" />
            </div>
          </div>

          <div className="rounded-xl border border-blue-500/20 bg-gradient-to-br from-blue-500/10 to-blue-600/5 p-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-[#e5e4e2]/60">Bilans</div>
                <div
                  className={`mt-2 text-2xl font-bold ${
                    currentMonth.total_income - currentMonth.total_expenses >= 0
                      ? 'text-green-400'
                      : 'text-red-400'
                  }`}
                >
                  {(currentMonth.total_income - currentMonth.total_expenses).toFixed(2)} PLN
                </div>
                <div className="mt-1 text-xs text-[#e5e4e2]/40">
                  {MONTHS[currentMonth.month - 1]} {currentMonth.year}
                </div>
              </div>
              <FileText className="h-8 w-8 text-blue-400" />
            </div>
          </div>

          <div className="rounded-xl border border-[#d3bb73]/20 bg-gradient-to-br from-[#d3bb73]/10 to-[#d3bb73]/5 p-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-[#e5e4e2]/60">Status płatności</div>
                <div className="mt-2 space-y-1">
                  <div className="flex items-center gap-2 text-sm">
                    <CheckCircle className="h-4 w-4 text-green-400" />
                    <span className="text-[#e5e4e2]">
                      {currentMonth.invoices_paid_count} opłacone
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Clock className="h-4 w-4 text-orange-400" />
                    <span className="text-[#e5e4e2]">
                      {currentMonth.invoices_unpaid_count} nieopłacone
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <AlertCircle className="h-4 w-4 text-red-400" />
                    <span className="text-[#e5e4e2]">
                      {currentMonth.invoices_overdue_count} po terminie
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33]">
        <div className="border-b border-[#d3bb73]/10 p-6">
          <h3 className="text-lg font-medium text-[#e5e4e2]">Historia miesięczna</h3>
        </div>

        {loading ? (
          <div className="flex items-center justify-center p-12">
            <div className="text-[#e5e4e2]/60">Ładowanie...</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#d3bb73]/10">
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-[#e5e4e2]/60">
                    Miesiąc
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-[#e5e4e2]/60">
                    Przychody
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-[#e5e4e2]/60">
                    Wydatki
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-[#e5e4e2]/60">
                    Bilans
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-medium uppercase tracking-wider text-[#e5e4e2]/60">
                    Płatności
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-medium uppercase tracking-wider text-[#e5e4e2]/60">
                    Wyciąg
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-[#e5e4e2]/60">
                    Akcje
                  </th>
                </tr>
              </thead>
              <tbody>
                {displayedSummaries.map((summary) => {
                  const balance = summary.total_income - summary.total_expenses;

                  return (
                    <tr
                      key={summary.id}
                      className="border-b border-[#d3bb73]/10 transition-colors hover:bg-[#252945]/50"
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <Calendar className="h-4 w-4 text-[#d3bb73]" />
                          <span className="text-sm font-medium text-[#e5e4e2]">
                            {MONTHS[summary.month - 1]} {summary.year}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <span className="text-sm text-green-400">
                          +{summary.total_income.toFixed(2)} PLN
                        </span>
                        <div className="text-xs text-[#e5e4e2]/40">
                          {summary.invoices_issued_count} faktur
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <span className="text-sm text-red-400">
                          -{summary.total_expenses.toFixed(2)} PLN
                        </span>
                        <div className="text-xs text-[#e5e4e2]/40">
                          {summary.invoices_received_count} faktur
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <span
                          className={`text-sm font-medium ${
                            balance >= 0 ? 'text-green-400' : 'text-red-400'
                          }`}
                        >
                          {balance >= 0 ? '+' : ''}
                          {balance.toFixed(2)} PLN
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex justify-center gap-2 text-xs">
                          <span className="text-green-400">{summary.invoices_paid_count}</span>
                          <span className="text-[#e5e4e2]/40">/</span>
                          <span className="text-orange-400">{summary.invoices_unpaid_count}</span>
                          <span className="text-[#e5e4e2]/40">/</span>
                          <span className="text-red-400">{summary.invoices_overdue_count}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        {summary.bank_statement_uploaded ? (
                          <CheckCircle className="inline-block h-5 w-5 text-green-400" />
                        ) : (
                          <AlertCircle className="inline-block h-5 w-5 text-orange-400" />
                        )}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => setSelectedMonth(summary)}
                          className="text-sm text-[#d3bb73] hover:text-[#d3bb73]/80"
                        >
                          Szczegóły
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedMonth && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] shadow-xl">
            <div className="flex items-center justify-between border-b border-[#d3bb73]/10 p-6">
              <h3 className="text-xl font-medium text-[#e5e4e2]">
                {MONTHS[selectedMonth.month - 1]} {selectedMonth.year}
              </h3>
              <button
                onClick={() => setSelectedMonth(null)}
                className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]"
              >
                ×
              </button>
            </div>

            <div className="space-y-6 p-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-lg bg-[#252945] p-4">
                  <div className="text-sm text-[#e5e4e2]/60">Przychody</div>
                  <div className="mt-1 text-xl font-bold text-green-400">
                    {selectedMonth.total_income.toFixed(2)} PLN
                  </div>
                </div>
                <div className="rounded-lg bg-[#252945] p-4">
                  <div className="text-sm text-[#e5e4e2]/60">Wydatki</div>
                  <div className="mt-1 text-xl font-bold text-red-400">
                    {selectedMonth.total_expenses.toFixed(2)} PLN
                  </div>
                </div>
              </div>

              <div
                onDragEnter={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (!uploadingFile) setIsDragOver(true);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (!uploadingFile) {
                    e.dataTransfer.dropEffect = 'copy';
                    setIsDragOver(true);
                  }
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  e.stopPropagation();

                  const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                  const x = e.clientX;
                  const y = e.clientY;

                  const inside =
                    x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

                  if (!inside) {
                    setIsDragOver(false);
                  }
                }}
                onDrop={async (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsDragOver(false);

                  if (uploadingFile) return;

                  const file = e.dataTransfer.files?.[0];
                  await handleSelectedFile(file ?? null, selectedMonth.month, selectedMonth.year);
                }}
                className={`rounded-lg border-2 border-dashed p-6 transition-all ${
                  isDragOver
                    ? 'border-[#d3bb73] bg-[#d3bb73]/10 shadow-[0_0_0_1px_rgba(211,187,115,0.35)]'
                    : 'border-[#d3bb73]/20'
                } ${uploadingFile ? 'opacity-60' : ''}`}
              >
                <div className="text-center">
                  <Upload
                    className={`mx-auto h-12 w-12 transition-colors ${
                      isDragOver ? 'text-[#d3bb73]' : 'text-[#d3bb73]/40'
                    }`}
                  />

                  <h4 className="mt-2 text-sm font-medium text-[#e5e4e2]">
                    {isDragOver ? 'Upuść plik tutaj' : 'Prześlij wyciąg bankowy'}
                  </h4>

                  <p className="mt-1 text-xs text-[#e5e4e2]/60">
                    Format MT940 (.txt) lub JPK_WB (.xml)
                  </p>

                  <label className="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-lg border border-[#d3bb73]/20 bg-[#252945] px-4 py-2 text-sm text-[#e5e4e2] hover:border-[#d3bb73]/40 hover:bg-[#2d3254]">
                    <Upload className="h-4 w-4" />
                    Wybierz plik
                    <input
                      type="file"
                      accept=".txt,.xml"
                      disabled={uploadingFile}
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0] ?? null;
                        await handleSelectedFile(file, selectedMonth.month, selectedMonth.year);
                        e.currentTarget.value = '';
                      }}
                    />
                  </label>

                  {isDragOver && (
                    <div className="mt-3 text-sm font-medium text-[#d3bb73]">
                      Puść plik, aby rozpocząć import
                    </div>
                  )}

                  {uploadingFile && (
                    <div className="mt-4 space-y-2">
                      <div className="text-sm font-medium text-[#d3bb73]">
                        {uploadProgress.step}
                      </div>
                      <div className="h-2 w-full rounded-full bg-[#252945]">
                        <div
                          className="h-2 rounded-full bg-[#d3bb73] transition-all duration-300"
                          style={{
                            width: `${
                              uploadProgress.total > 0
                                ? (uploadProgress.current / uploadProgress.total) * 100
                                : 0
                            }%`,
                          }}
                        />
                      </div>
                      <div className="text-xs text-[#e5e4e2]/60">
                        Krok {uploadProgress.current + 1} z {uploadProgress.total}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {selectedMonth.bank_statement_uploaded && (
                <div className="rounded-lg border border-green-500/20 bg-green-500/10 p-4 text-sm text-green-400">
                  ✓ Wyciąg bankowy został przesłany
                </div>
              )}

              {selectedMonth.bank_statement_uploaded && (
                <div className="rounded-lg border border-[#d3bb73]/20 bg-[#252945] p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-sm font-medium text-[#e5e4e2]">Analiza transakcji</h4>
                      <p className="mt-1 text-xs text-[#e5e4e2]/60">
                        Przejrzyj wszystkie transakcje z wyciągu i zarządzaj dopasowaniami
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setUnmatchedModalMonth({
                          month: selectedMonth.month,
                          year: selectedMonth.year,
                        });
                        setShowUnmatchedModal(true);
                      }}
                      className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
                    >
                      <LinkIcon className="h-4 w-4" />
                      Analizuj transakcje
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end border-t border-[#d3bb73]/10 p-6">
              <button
                onClick={() => setSelectedMonth(null)}
                className="rounded-lg border border-[#d3bb73]/20 px-4 py-2 text-sm text-[#e5e4e2] hover:bg-[#252945]"
              >
                Zamknij
              </button>
            </div>
          </div>
        </div>
      )}

      {showUnmatchedModal && unmatchedModalMonth && (
        <BankTransactionsAnalysis
          month={unmatchedModalMonth.month}
          year={unmatchedModalMonth.year}
          onClose={() => {
            setShowUnmatchedModal(false);
            setUnmatchedModalMonth(null);
            loadSummaries();
          }}
        />
      )}
    </div>
  );
}
