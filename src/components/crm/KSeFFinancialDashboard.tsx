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
  ChevronUp,
  ChevronDown,
  Download,
  Trash2,
  List,
  Pencil,
} from 'lucide-react';
import { parseMT940, parseJPK_WB, findMatchingInvoices } from '@/lib/bankStatementParsers';
import BankTransactionsAnalysis from './BankTransactionsAnalysis';
import BankMatchingSimple from './BankMatchingSimple';
import CompanySelector from './CompanySelector';
import ResponsiveActionBar from './ResponsiveActionBar';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { useDialog } from '@/contexts/DialogContext';
import { KSeFInvoice } from './BankMatchingSimple';

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

interface BankStatementRecord {
  id: string;
  file_name: string;
  account_type: 'regular' | 'vat';
  statement_month: number;
  statement_year: number;
  my_company_id: string;
  file_storage_path: string | null;
  transactions_count: number;
  processed: boolean;
  created_at: string;
  my_companies?: { name: string } | null;
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

function MonthActions({
  summary,
  selectedCompanyId,
  allowedCompanyIds,
  isAdmin,
  onUpload,
  onDetails,
  onDownload,
}: {
  summary: MonthlySummary;
  selectedCompanyId: string | null;
  allowedCompanyIds: string[] | null;
  isAdmin: boolean;
  onUpload: () => void;
  onDetails: () => void;
  onDownload: (accountType: 'regular' | 'vat') => void;
}) {
  const [hasRegular, setHasRegular] = useState(false);
  const [hasVat, setHasVat] = useState(false);

  useEffect(() => {
    if (!summary.bank_statement_uploaded) {
      setHasRegular(false);
      setHasVat(false);
      return;
    }

    const check = async () => {
      let query = supabase
        .from('bank_statements')
        .select('account_type, file_storage_path')
        .eq('statement_month', summary.month)
        .eq('statement_year', summary.year)
        .not('file_storage_path', 'is', null);

      if (selectedCompanyId) {
        query = query.eq('my_company_id', selectedCompanyId);
      } else if (!isAdmin) {
        if (!allowedCompanyIds || allowedCompanyIds.length === 0) {
          setHasRegular(false);
          setHasVat(false);
          return;
        }

        query = query.in('my_company_id', allowedCompanyIds);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error checking statements:', error);
        setHasRegular(false);
        setHasVat(false);
        return;
      }

      const types = (data || []).map((d) => d.account_type);

      setHasRegular(types.includes('regular'));
      setHasVat(types.includes('vat'));
    };

    void check();
  }, [
    summary.month,
    summary.year,
    summary.bank_statement_uploaded,
    selectedCompanyId,
    allowedCompanyIds,
    isAdmin,
  ]);

  const actions = [
    {
      label: 'Wgraj wyciag',
      onClick: onUpload,
      icon: <Upload className="h-4 w-4" />,
    },
    {
      label: 'Szczegoly',
      onClick: onDetails,
      icon: <FileText className="h-4 w-4" />,
    },
    {
      label: 'Pobierz wyciag',
      onClick: () => onDownload('regular'),
      icon: <Download className="h-4 w-4" />,
      show: hasRegular,
    },
    {
      label: 'Wyciag VAT',
      onClick: () => onDownload('vat'),
      icon: <Download className="h-4 w-4" />,
      show: hasVat,
    },
  ];

  return <ResponsiveActionBar actions={actions} disabledBackground mobileBreakpoint={4000} />;
}

export default function KSeFFinancialDashboard() {
  const [summaries, setSummaries] = useState<MonthlySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState<MonthlySummary | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ step: '', current: 0, total: 0 });
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [showUnmatchedModal, setShowUnmatchedModal] = useState(false);
  const [showSimpleMatchModal, setShowSimpleMatchModal] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [showYearSummary, setShowYearSummary] = useState(false);
  const [unmatchedModalMonth, setUnmatchedModalMonth] = useState<{
    month: number;
    year: number;
  } | null>(null);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [uploadAccountType, setUploadAccountType] = useState<'regular' | 'vat'>('regular');
  const [uploadMonth, setUploadMonth] = useState<MonthlySummary | null>(null);
  const [showStatementsListModal, setShowStatementsListModal] = useState(false);
  const [allStatements, setAllStatements] = useState<BankStatementRecord[]>([]);
  const [loadingStatements, setLoadingStatements] = useState(false);
  const [renamingStatement, setRenamingStatement] = useState<{ id: string; name: string } | null>(
    null,
  );
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const { employee: currentEmployee, isAdmin } = useCurrentEmployee();
  const allowedCompanyIds: string[] | null = (() => {
    if (isAdmin) return null;

    const ids = (currentEmployee as any)?.my_company_ids;

    if (!Array.isArray(ids)) return [];
    return ids as string[];
  })();

  useEffect(() => {
    loadSummaries();
  }, [selectedYear, selectedCompanyId]);

  const handleSelectedFile = async (file: File | null, month: number, year: number) => {
    if (!file) return;

    const isPdf = file.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      showSnackbar('Dozwolony jest tylko plik PDF z wyciągiem bankowym', 'error');
      return;
    }

    await handleFileUpload(file, month, year);
  };

  const loadSummaries = async () => {
    try {
      setLoading(true);

      const summariesPromises = [];
      for (let month = 1; month <= 12; month++) {
        summariesPromises.push(
          supabase.rpc('update_monthly_summary', {
            p_month: month,
            p_year: selectedYear,
            p_company_id: selectedCompanyId,
          }),
        );
      }

      await Promise.all(summariesPromises);

      let query = supabase.from('monthly_financial_summaries').select('*').eq('year', selectedYear);

      if (selectedCompanyId) {
        query = query.eq('my_company_id', selectedCompanyId);
      } else if (allowedCompanyIds) {
        query = query.in('my_company_id', allowedCompanyIds);
      } else {
        query = query.is('my_company_id', null);
      }

      const { data, error } = await query.order('month', { ascending: true });

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

  const loadAllStatements = async () => {
    try {
      setLoadingStatements(true);

      let query = supabase
        .from('bank_statements')
        .select(
          'id, file_name, account_type, statement_month, statement_year, my_company_id, file_storage_path, transactions_count, processed, created_at, my_companies(name)',
        )
        .order('statement_year', { ascending: false })
        .order('statement_month', { ascending: false });

      if (selectedCompanyId) {
        query = query.eq('my_company_id', selectedCompanyId);
      } else if (!isAdmin) {
        if (!allowedCompanyIds || allowedCompanyIds.length === 0) {
          setAllStatements([]);
          return;
        }

        query = query.in('my_company_id', allowedCompanyIds);
      }

      const { data, error } = await query;

      if (error) throw error;

      setAllStatements((data || []) as unknown as BankStatementRecord[]);
    } catch (error: any) {
      console.error('Error loading statements:', error);
      showSnackbar('Błąd ładowania listy wyciągów', 'error');
    } finally {
      setLoadingStatements(false);
    }
  };

  const handleDownloadStatement = async (
    statementId: string,
    accountType: 'regular' | 'vat',
    month: number,
    year: number,
  ) => {
    try {
      const { data: stmt } = await supabase
        .from('bank_statements')
        .select('file_storage_path, file_name')
        .eq('id', statementId)
        .maybeSingle();

      if (!stmt?.file_storage_path) {
        showSnackbar('Plik wyciągu nie jest dostępny do pobrania', 'warning');
        return;
      }

      const { data: signedUrl, error } = await supabase.storage
        .from('bank-statements')
        .createSignedUrl(stmt.file_storage_path, 60);

      if (error || !signedUrl?.signedUrl) {
        throw new Error('Nie udało się wygenerować linku do pobrania');
      }

      window.open(signedUrl.signedUrl, '_blank', 'noopener,noreferrer');


    } catch (error: any) {
      console.error('Download error:', error);
      showSnackbar(error.message || 'Błąd pobierania wyciągu', 'error');
    }
  };

  const handleDeleteStatement = async (statementId: string) => {
    const confirmed = await showConfirm({
      title: 'Usuń wyciąg bankowy',
      message:
        'Czy na pewno chcesz usunąć ten wyciąg? Wszystkie powiązane transakcje i dopasowania zostaną usunięte.',
      confirmText: 'Usuń',
      cancelText: 'Anuluj',
    });

    if (!confirmed) return;

    try {
      const { data: stmt } = await supabase
        .from('bank_statements')
        .select('file_storage_path, my_company_id, statement_month, statement_year')
        .eq('id', statementId)
        .maybeSingle();

      if (stmt?.file_storage_path) {
        await supabase.storage.from('bank-statements').remove([stmt.file_storage_path]);
      }

      const { data: transactions } = await supabase
        .from('bank_transactions')
        .select('id, matched_invoice_id')
        .eq('statement_id', statementId);

      const matchedInvoiceIds = [
        ...new Set((transactions || []).map((t) => t.matched_invoice_id).filter(Boolean)),
      ];

      if (matchedInvoiceIds.length > 0) {
        await supabase
          .from('ksef_invoices')
          .update({ payment_status: 'unpaid', payment_date: null })
          .in('id', matchedInvoiceIds);
      }

      const { error } = await supabase.from('bank_statements').delete().eq('id', statementId);

      if (error) throw error;

      showSnackbar('Wyciąg bankowy został usunięty', 'success');
      setAllStatements((prev) => prev.filter((s) => s.id !== statementId));
      await loadSummaries();
    } catch (error: any) {
      console.error('Delete error:', error);
      showSnackbar(error.message || 'Błąd usuwania wyciągu', 'error');
    }
  };

  const handleRenameStatement = async () => {
    if (!renamingStatement) return;
    const newName = renamingStatement.name.trim();
    if (!newName) {
      showSnackbar('Nazwa pliku nie moze byc pusta', 'error');
      return;
    }

    try {
      const { error } = await supabase
        .from('bank_statements')
        .update({ file_name: newName })
        .eq('id', renamingStatement.id);

      if (error) throw error;

      setAllStatements((prev) =>
        prev.map((s) => (s.id === renamingStatement.id ? { ...s, file_name: newName } : s)),
      );
      setRenamingStatement(null);
      showSnackbar('Nazwa wyciagu zostala zmieniona', 'success');
    } catch (error: any) {
      console.error('Rename error:', error);
      showSnackbar(error.message || 'Blad zmiany nazwy', 'error');
    }
  };

  const getStatementsForMonth = async (
    month: number,
    year: number,
    accountType: 'regular' | 'vat',
  ) => {
    let query = supabase
      .from('bank_statements')
      .select('id, file_storage_path, file_name, account_type, my_company_id')
      .eq('statement_month', month)
      .eq('statement_year', year)
      .eq('account_type', accountType)
      .not('file_storage_path', 'is', null);

    if (selectedCompanyId) {
      query = query.eq('my_company_id', selectedCompanyId);
    } else if (!isAdmin) {
      if (!allowedCompanyIds || allowedCompanyIds.length === 0) {
        return [];
      }

      query = query.in('my_company_id', allowedCompanyIds);
    }

    const { data, error } = await query;

    if (error) throw error;

    return data || [];
  };

  const handleDownloadForMonth = async (
    month: number,
    year: number,
    accountType: 'regular' | 'vat',
  ) => {
    const statements = await getStatementsForMonth(month, year, accountType);

    if (!statements.length) {
      showSnackbar(
        `Brak wyciągu ${accountType === 'vat' ? 'VAT' : 'bieżącego'} dla tego miesiąca`,
        'warning',
      );
      return;
    }

    if (statements.length > 1 && !selectedCompanyId) {
      showSnackbar(
        'Dla tego miesiąca jest kilka wyciągów. Wybierz firmę albo użyj listy wyciągów.',
        'warning',
      );
      return;
    }

    const stmt = statements[0];

    await handleDownloadStatement(stmt.id, accountType, month, year);
  };

  const handleFileUpload = async (file: File, month: number, year: number) => {
    try {
      if (!selectedCompanyId) {
        showSnackbar('Wybierz firmę przed uplodem wyciągu bankowego', 'error');
        return;
      }

      setUploadingFile(true);
      setUploadProgress({ step: 'Wczytywanie pliku PDF...', current: 0, total: 8 });

      const lowerName = file.name.toLowerCase();

      if (!lowerName.endsWith('.pdf')) {
        throw new Error('Obsługiwane są wyłącznie pliki PDF');
      }

      const fileType: 'MT940' = 'MT940';

      setUploadProgress({ step: 'Parsowanie PDF...', current: 1, total: 8 });

      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/bridge/ksef/bank/parse-pdf', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (!response.ok || !result?.success) {
        throw new Error(result?.error || 'Nie udało się sparsować PDF');
      }

      const parsedStatement = result.data;
      const fileContent = parsedStatement?.rawText || '[PDF parsed]';

      setUploadProgress({ step: 'Wyszukiwanie poprzedniego wyciągu...', current: 2, total: 8 });

      const { data: existingStatements, error: existingStatementsError } = await supabase
        .from('bank_statements')
        .select('id, file_storage_path')
        .eq('statement_month', month)
        .eq('statement_year', year)
        .eq('my_company_id', selectedCompanyId)
        .eq('account_type', uploadAccountType);

      if (existingStatementsError) throw existingStatementsError;

      const existingStatementIds = (existingStatements || []).map((s) => s.id);

      if (existingStatementIds.length > 0) {
        setUploadProgress({ step: 'Czyszczenie starego wyciągu...', current: 3, total: 8 });

        const oldStoragePaths = (existingStatements || [])
          .map((s) => s.file_storage_path)
          .filter(Boolean) as string[];
        if (oldStoragePaths.length > 0) {
          await supabase.storage.from('bank-statements').remove(oldStoragePaths);
        }

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

      setUploadProgress({ step: 'Przesyłanie pliku do magazynu...', current: 4, total: 8 });

      const storagePath = `${selectedCompanyId}/${year}/${month}_${uploadAccountType}_${Date.now()}.pdf`;

      const { error: storageError } = await supabase.storage
        .from('bank-statements')
        .upload(storagePath, file, {
          contentType: 'application/pdf',
          upsert: true,
        });

      if (storageError) {
        throw storageError;
      }

      setUploadProgress({ step: 'Zapisywanie nowego wyciągu...', current: 5, total: 8 });

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
          my_company_id: selectedCompanyId,
          account_type: uploadAccountType,
          file_storage_path: storagePath,
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
        current: 6,
        total: 8,
      });

      let matchedCount = 0;
      let unmatchedCount = 0;

      for (let i = 0; i < parsedStatement.transactions.length; i++) {
        const transaction = parsedStatement.transactions[i];

        if (i % 5 === 0) {
          setUploadProgress({
            step: `Przetwarzanie transakcji (${i + 1}/${parsedStatement.transactions.length})...`,
            current: 6,
            total: 8,
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
          raw_description: transaction.rawDescription ?? null,
          raw_counterparty: transaction.rawCounterparty ?? null,
        });

        if (insertTransactionError) throw insertTransactionError;
      }

      setUploadProgress({ step: 'Finalizowanie importu...', current: 7, total: 8 });

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
        `Wyciąg PDF został podmieniony. Transakcji: ${parsedStatement.transactions.length}, automatycznie dopasowanych: ${matchedCount}, do weryfikacji: ${unmatchedCount}`,
        'success',
      );
    } catch (error: any) {
      console.error('Error uploading PDF:', error);
      showSnackbar(error.message || 'Błąd podczas importu PDF', 'error');
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

  const displayedSummaries = summaries;

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

        <div className="flex items-center gap-4">
          <CompanySelector
            value={selectedCompanyId}
            onChange={setSelectedCompanyId}
            showAllOption={true}
            className="w-64"
          />
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
          <button
            onClick={() => {
              loadAllStatements();
              setShowStatementsListModal(true);
            }}
            className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/20 px-4 py-2 text-sm text-[#e5e4e2] transition-colors hover:border-[#d3bb73]/40 hover:bg-[#252945]"
          >
            <List className="h-4 w-4 text-[#d3bb73]" />
            Lista wyciagow
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33]">
        <button
          type="button"
          onClick={() => setShowYearSummary((prev) => !prev)}
          className="flex w-full items-center justify-between px-5 py-3 text-left transition-colors hover:bg-[#d3bb73]/5"
        >
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-green-400" />
              <span className="text-sm text-[#e5e4e2]/60">Przychody:</span>
              <span className="text-sm font-medium text-green-400">
                {yearTotals.income.toFixed(2)} PLN
              </span>
            </div>

            <div className="hidden items-center gap-2 sm:flex">
              <TrendingDown className="h-4 w-4 text-red-400" />
              <span className="text-sm text-[#e5e4e2]/60">Wydatki:</span>
              <span className="text-sm font-medium text-red-400">
                {yearTotals.expenses.toFixed(2)} PLN
              </span>
            </div>

            <div className="hidden items-center gap-2 lg:flex">
              <FileText className="h-4 w-4 text-[#d3bb73]" />
              <span className="text-sm text-[#e5e4e2]/60">Bilans:</span>
              <span
                className={`text-sm font-medium ${
                  yearTotals.income - yearTotals.expenses >= 0 ? 'text-green-400' : 'text-red-400'
                }`}
              >
                {(yearTotals.income - yearTotals.expenses).toFixed(2)} PLN
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs text-[#e5e4e2]/50">
            <span>{showYearSummary ? 'Ukryj podsumowanie' : 'Pokaż podsumowanie'}</span>
            {showYearSummary ? (
              <ChevronUp className="h-4 w-4 text-[#d3bb73]" />
            ) : (
              <ChevronDown className="h-4 w-4 text-[#d3bb73]" />
            )}
          </div>
        </button>

        {showYearSummary && (
          <div className="grid gap-4 border-t border-[#d3bb73]/10 p-5 md:grid-cols-4">
            <div className="rounded-lg border border-green-500/20 bg-green-500/10 p-4">
              <div className="text-sm text-[#e5e4e2]/60">Przychody</div>
              <div className="mt-1 text-xl font-bold text-green-400">
                {yearTotals.income.toFixed(2)} PLN
              </div>
              <div className="text-xs text-[#e5e4e2]/40">{yearTotals.issued} faktur</div>
            </div>

            <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4">
              <div className="text-sm text-[#e5e4e2]/60">Wydatki</div>
              <div className="mt-1 text-xl font-bold text-red-400">
                {yearTotals.expenses.toFixed(2)} PLN
              </div>
              <div className="text-xs text-[#e5e4e2]/40">{yearTotals.received} faktur</div>
            </div>

            <div className="rounded-lg border border-[#d3bb73]/20 bg-[#d3bb73]/5 p-4">
              <div className="text-sm text-[#e5e4e2]/60">Bilans</div>
              <div
                className={`mt-1 text-xl font-bold ${
                  yearTotals.income - yearTotals.expenses >= 0 ? 'text-green-400' : 'text-red-400'
                }`}
              >
                {(yearTotals.income - yearTotals.expenses).toFixed(2)} PLN
              </div>
              <div className="text-xs text-[#e5e4e2]/40">Rok {selectedYear}</div>
            </div>

            <div className="rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] p-4">
              <div className="text-sm text-[#e5e4e2]/60">Status płatności</div>
              <div className="mt-3 space-y-1 text-sm">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-green-400" />
                  <span className="text-green-400">{yearTotals.paid} opłacone</span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-orange-400" />
                  <span className="text-orange-400">{yearTotals.unpaid} nieopłacone</span>
                </div>
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-red-400" />
                  <span className="text-red-400">{yearTotals.overdue} po terminie</span>
                </div>
              </div>
            </div>
          </div>
        )}
        {monthsWithData.length > 0 && monthsWithData.length < 12 && (
          <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 p-4 text-sm text-blue-400">
            <strong>Uwaga:</strong> W roku {selectedYear} masz faktury tylko w{' '}
            {monthsWithData.length} {monthsWithData.length === 1 ? 'miesiącu' : 'miesiącach'}.
            Poniżej wyświetlane są tylko miesiące z danymi.
          </div>
        )}
      </div>

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
                        <MonthActions
                          summary={summary}
                          selectedCompanyId={selectedCompanyId}
                          allowedCompanyIds={allowedCompanyIds}
                          isAdmin={isAdmin}
                          onUpload={() => setUploadMonth(summary)}
                          onDetails={() => setSelectedMonth(summary)}
                          onDownload={(accountType) =>
                            handleDownloadForMonth(summary.month, summary.year, accountType)
                          }
                        />
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
                Podsumowanie: {MONTHS[selectedMonth.month - 1]} {selectedMonth.year}
              </h3>
              <button
                onClick={() => setSelectedMonth(null)}
                className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]"
              >
                x
              </button>
            </div>

            <div className="space-y-6 p-6">
              <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-lg bg-[#252945] p-4">
                  <div className="text-sm text-[#e5e4e2]/60">Przychody</div>
                  <div className="mt-1 text-xl font-bold text-green-400">
                    {selectedMonth.total_income.toFixed(2)} PLN
                  </div>
                  <div className="mt-1 text-xs text-[#e5e4e2]/40">
                    {selectedMonth.invoices_issued_count} faktur
                  </div>
                </div>
                <div className="rounded-lg bg-[#252945] p-4">
                  <div className="text-sm text-[#e5e4e2]/60">Wydatki</div>
                  <div className="mt-1 text-xl font-bold text-red-400">
                    {selectedMonth.total_expenses.toFixed(2)} PLN
                  </div>
                  <div className="mt-1 text-xs text-[#e5e4e2]/40">
                    {selectedMonth.invoices_received_count} faktur
                  </div>
                </div>
                <div className="rounded-lg bg-[#252945] p-4">
                  <div className="text-sm text-[#e5e4e2]/60">Bilans</div>
                  <div
                    className={`mt-1 text-xl font-bold ${
                      selectedMonth.total_income - selectedMonth.total_expenses >= 0
                        ? 'text-green-400'
                        : 'text-red-400'
                    }`}
                  >
                    {(selectedMonth.total_income - selectedMonth.total_expenses).toFixed(2)} PLN
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-[#d3bb73]/20 bg-[#252945] p-4">
                <h4 className="mb-3 text-sm font-medium text-[#e5e4e2]">Status platnosci</h4>
                <div className="flex gap-6">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-400" />
                    <span className="text-sm text-green-400">
                      {selectedMonth.invoices_paid_count} oplacone
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-orange-400" />
                    <span className="text-sm text-orange-400">
                      {selectedMonth.invoices_unpaid_count} nieoplacone
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-red-400" />
                    <span className="text-sm text-red-400">
                      {selectedMonth.invoices_overdue_count} po terminie
                    </span>
                  </div>
                </div>
              </div>

              {selectedMonth.bank_statement_uploaded && (
                <div className="rounded-lg border border-green-500/20 bg-green-500/10 p-4 text-sm text-green-400">
                  Wyciag bankowy zostal przeslany dla tego miesiaca
                </div>
              )}

              {selectedMonth.bank_statement_uploaded && (
                <div className="rounded-lg border border-[#d3bb73]/20 bg-[#252945] p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-sm font-medium text-[#e5e4e2]">Analiza transakcji</h4>
                      <p className="mt-1 text-xs text-[#e5e4e2]/60">
                        Przejrzyj wszystkie transakcje z wyciagu i zarzadzaj dopasowaniami
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setUnmatchedModalMonth({
                            month: selectedMonth.month,
                            year: selectedMonth.year,
                          });
                          setShowSimpleMatchModal(true);
                        }}
                        className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
                      >
                        <LinkIcon className="h-4 w-4" />
                        Dopasuj platnosci
                      </button>
                      <button
                        onClick={() => {
                          setUnmatchedModalMonth({
                            month: selectedMonth.month,
                            year: selectedMonth.year,
                          });
                          setShowUnmatchedModal(true);
                        }}
                        className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/20 px-4 py-2 text-sm font-medium text-[#e5e4e2] hover:bg-[#252945]"
                      >
                        <FileText className="h-4 w-4" />
                        Szczegolowa analiza
                      </button>
                    </div>
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

      {uploadMonth && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] shadow-xl">
            <div className="flex items-center justify-between border-b border-[#d3bb73]/10 p-6">
              <h3 className="text-xl font-medium text-[#e5e4e2]">
                Wgraj wyciag: {MONTHS[uploadMonth.month - 1]} {uploadMonth.year}
              </h3>
              <button
                onClick={() => setUploadMonth(null)}
                className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]"
              >
                x
              </button>
            </div>

            <div className="space-y-6 p-6">
              <div className="rounded-lg border border-[#d3bb73]/20 bg-[#252945] p-4">
                <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Typ wyciagu</label>
                <div className="flex gap-4">
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="radio"
                      name="uploadAccountType"
                      value="regular"
                      checked={uploadAccountType === 'regular'}
                      onChange={() => setUploadAccountType('regular')}
                      className="h-4 w-4 accent-[#d3bb73]"
                    />
                    <span className="text-sm text-[#e5e4e2]">Konto biezace</span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="radio"
                      name="uploadAccountType"
                      value="vat"
                      checked={uploadAccountType === 'vat'}
                      onChange={() => setUploadAccountType('vat')}
                      className="h-4 w-4 accent-[#d3bb73]"
                    />
                    <span className="text-sm text-[#e5e4e2]">Konto VAT</span>
                  </label>
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

                  const file = e.dataTransfer.files?.[0] ?? null;
                  if (file && !file.name.toLowerCase().endsWith('.pdf')) {
                    showSnackbar('Mozesz upuscic tylko plik PDF', 'error');
                    return;
                  }

                  await handleSelectedFile(file, uploadMonth.month, uploadMonth.year);
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
                    {isDragOver ? 'Upusc plik tutaj' : 'Przeslij wyciag bankowy'}
                  </h4>

                  <p className="mt-1 text-xs text-[#e5e4e2]/60">Format PDF (.pdf)</p>

                  <label className="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-lg border border-[#d3bb73]/20 bg-[#252945] px-4 py-2 text-sm text-[#e5e4e2] hover:border-[#d3bb73]/40 hover:bg-[#2d3254]">
                    <Upload className="h-4 w-4" />
                    Wybierz plik
                    <input
                      type="file"
                      accept=".pdf"
                      disabled={uploadingFile}
                      className="hidden"
                      onChange={async (e) => {
                        const input = e.currentTarget;
                        const file = input.files?.[0] ?? null;

                        try {
                          await handleSelectedFile(file, uploadMonth.month, uploadMonth.year);
                        } finally {
                          input.value = '';
                        }
                      }}
                    />
                  </label>

                  {isDragOver && (
                    <div className="mt-3 text-sm font-medium text-[#d3bb73]">
                      Pusc plik, aby rozpoczac import
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
            </div>

            <div className="flex justify-end border-t border-[#d3bb73]/10 p-6">
              <button
                onClick={() => setUploadMonth(null)}
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
          companyId={selectedCompanyId}
          onClose={() => {
            setShowUnmatchedModal(false);
            setUnmatchedModalMonth(null);
            loadSummaries();
          }}
        />
      )}

      {showSimpleMatchModal && unmatchedModalMonth && (
        <BankMatchingSimple
          month={unmatchedModalMonth.month}
          year={unmatchedModalMonth.year}
          companyId={selectedCompanyId}
          onClose={() => {
            setShowSimpleMatchModal(false);
            setUnmatchedModalMonth(null);
            loadSummaries();
          }}
        />
      )}

      {showStatementsListModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] shadow-xl">
            <div className="flex items-center justify-between border-b border-[#d3bb73]/10 p-6">
              <h3 className="text-xl font-medium text-[#e5e4e2]">Wszystkie wyciagi bankowe</h3>
              <button
                onClick={() => setShowStatementsListModal(false)}
                className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]"
              >
                x
              </button>
            </div>

            <div className="max-h-[70vh] overflow-y-auto p-6">
              {loadingStatements ? (
                <div className="flex items-center justify-center py-12">
                  <div className="text-[#e5e4e2]/60">Ladowanie...</div>
                </div>
              ) : allStatements.length === 0 ? (
                <div className="flex items-center justify-center py-12">
                  <div className="text-[#e5e4e2]/60">Brak dodanych wyciagow</div>
                </div>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[#d3bb73]/10">
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[#e5e4e2]/60">
                        Plik
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[#e5e4e2]/60">
                        Firma
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-[#e5e4e2]/60">
                        Typ
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-[#e5e4e2]/60">
                        Okres
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-[#e5e4e2]/60">
                        Transakcje
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-[#e5e4e2]/60">
                        Akcje
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {allStatements.map((stmt) => {
                      console.log(stmt);
                      return (
                        <tr
                          key={stmt.id}
                          className="border-b border-[#d3bb73]/10 transition-colors hover:bg-[#252945]/50"
                        >
                          <td className="px-4 py-3">
                            {renamingStatement?.id === stmt.id ? (
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  value={renamingStatement.name}
                                  onChange={(e) =>
                                    setRenamingStatement({
                                      ...renamingStatement,
                                      name: e.target.value,
                                    })
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleRenameStatement();
                                    if (e.key === 'Escape') setRenamingStatement(null);
                                  }}
                                  autoFocus
                                  className="w-full rounded border border-[#d3bb73]/30 bg-[#0f1119] px-2 py-1 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                                />
                                <button
                                  onClick={handleRenameStatement}
                                  className="rounded px-2 py-1 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/10"
                                >
                                  OK
                                </button>
                                <button
                                  onClick={() => setRenamingStatement(null)}
                                  className="rounded px-2 py-1 text-xs text-[#e5e4e2]/60 hover:bg-white/5"
                                >
                                  x
                                </button>
                              </div>
                            ) : (
                              <span className="text-sm text-[#e5e4e2]">{stmt.file_name}</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-sm text-[#e5e4e2]/70">
                              {stmt.my_companies?.name || '-'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span
                              className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
                                stmt.account_type === 'vat'
                                  ? 'bg-blue-500/20 text-blue-400'
                                  : 'bg-[#d3bb73]/20 text-[#d3bb73]'
                              }`}
                            >
                              {stmt.account_type === 'vat' ? 'VAT' : 'Biezace'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className="text-sm text-[#e5e4e2]/70">
                              {MONTHS[stmt.statement_month - 1]} {stmt.statement_year}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className="text-sm text-[#e5e4e2]/70">
                              {stmt.transactions_count}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <ResponsiveActionBar
                              disabledBackground
                              mobileBreakpoint={4000}
                              actions={[
                                {
                                  label: 'Pobierz',
                                  icon: <Download className="h-4 w-4" />,
                                  show: Boolean(stmt.file_storage_path),
                                  onClick: () =>
                                    handleDownloadStatement(
                                      stmt.id,
                                      stmt.account_type,
                                      stmt.statement_month,
                                      stmt.statement_year,
                                    ),
                                },
                                {
                                  label: 'Zmień nazwę',
                                  icon: <Pencil className="h-4 w-4" />,
                                  onClick: () =>
                                    setRenamingStatement({ id: stmt.id, name: stmt.file_name }),
                                },
                                {
                                  label: 'Usuń',
                                  icon: <Trash2 className="h-4 w-4" />,
                                  variant: 'danger',
                                  onClick: () => handleDeleteStatement(stmt.id),
                                },
                              ]}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <div className="flex justify-end border-t border-[#d3bb73]/10 p-6">
              <button
                onClick={() => setShowStatementsListModal(false)}
                className="rounded-lg border border-[#d3bb73]/20 px-4 py-2 text-sm text-[#e5e4e2] hover:bg-[#252945]"
              >
                Zamknij
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
