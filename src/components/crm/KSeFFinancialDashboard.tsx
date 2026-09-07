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
import { parseMT940, parseJPK_WB } from '@/lib/bankStatementParsers';
import { readBankTextFile, repairBrokenBankText } from '@/lib/bankTextEncoding';
import BankTransactionsAnalysis from './BankTransactionsAnalysis';
import UnmatchedTransactionsModal from './UnmatchedTransactionsModal';
import CompanySelector from './CompanySelector';
import ResponsiveActionBar from './ResponsiveActionBar';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { useDialog } from '@/contexts/DialogContext';
import BankStatementsListModal from './invoices/modal/BankStatementRecord';

type AccountType = 'regular' | 'vat' | 'mt940';

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
  account_type: AccountType;
  statement_month: number;
  statement_year: number;
  my_company_id: string;
  file_storage_path: string | null;
  transactions_count: number;
  processed: boolean;
  validation_status?: 'pending' | 'valid' | 'rejected';
  validation_message?: string | null;
  parser_version?: number | null;
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

function formatFinancialAmount(value: number) {
  return Number(value || 0)
    .toFixed(2)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function extractBankAccountNumber(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const text = String(value || '');
    const compactAccount = text.match(/(?:\d[\s-]?){26}/)?.[0]?.replace(/\D/g, '');
    if (compactAccount?.length === 26) return compactAccount;

    const digits = text.replace(/\D/g, '');
    if (digits.length === 26) return digits;
  }
  return '';
}

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
  onDownload: (accountType: AccountType) => void;
}) {
  const [hasRegular, setHasRegular] = useState(false);
  const [hasVat, setHasVat] = useState(false);
  const [hasMt940, setHasMt940] = useState(false);

  useEffect(() => {
    if (!summary.bank_statement_uploaded) {
      setHasRegular(false);
      setHasVat(false);
      setHasMt940(false);
      return;
    }

    const check = async () => {
      let query = supabase
        .from('bank_statements')
        .select('account_type, file_storage_path')
        .eq('statement_month', summary.month)
        .eq('statement_year', summary.year)
        .eq('processed', true)
        .eq('validation_status', 'valid')
        .not('file_storage_path', 'is', null);

      if (selectedCompanyId) {
        query = query.eq('my_company_id', selectedCompanyId);
      } else if (!isAdmin) {
        if (!allowedCompanyIds || allowedCompanyIds.length === 0) {
          setHasRegular(false);
          setHasVat(false);
          setHasMt940(false);
          return;
        }

        query = query.in('my_company_id', allowedCompanyIds);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error checking statements:', error);
        setHasRegular(false);
        setHasVat(false);
        setHasMt940(false);
        return;
      }

      const types = (data || []).map((d) => d.account_type);

      setHasRegular(types.includes('regular'));
      setHasVat(types.includes('vat'));
      setHasMt940(types.includes('mt940'));
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
    {
      label: 'Pobierz wyciag MT940',
      onClick: () => onDownload('mt940'),
      icon: <Download className="h-4 w-4" />,
      show: hasMt940,
    },
  ];

  return <ResponsiveActionBar actions={actions} disabledBackground mobileBreakpoint={4000} />;
}

interface KSeFFinancialDashboardProps {
  filterCompanyIds?: string[] | null;
}

export default function KSeFFinancialDashboard({ filterCompanyIds }: KSeFFinancialDashboardProps) {
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
  const [uploadAccountType, setUploadAccountType] = useState<AccountType>('regular');
  const [uploadMonth, setUploadMonth] = useState<MonthlySummary | null>(null);
  const [showStatementsListModal, setShowStatementsListModal] = useState(false);
  const [allStatements, setAllStatements] = useState<BankStatementRecord[]>([]);
  const [loadingStatements, setLoadingStatements] = useState(false);
  const [uploadExistingStatements, setUploadExistingStatements] = useState<BankStatementRecord[]>([]);
  const [loadingUploadExistingStatements, setLoadingUploadExistingStatements] = useState(false);
  const [uploadStatementsRevision, setUploadStatementsRevision] = useState(0);
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
    if (filterCompanyIds && filterCompanyIds.length === 1) {
      setSelectedCompanyId(filterCompanyIds[0]);
    } else if (filterCompanyIds && filterCompanyIds.length > 1) {
      setSelectedCompanyId(filterCompanyIds[0]);
    } else if (filterCompanyIds === null || (filterCompanyIds && filterCompanyIds.length === 0)) {
      setSelectedCompanyId(null);
    }
  }, [filterCompanyIds]);

  useEffect(() => {
    loadSummaries();
  }, [selectedYear, selectedCompanyId]);

  useEffect(() => {
    let cancelled = false;

    if (!uploadMonth || !selectedCompanyId) {
      setUploadExistingStatements([]);
      setLoadingUploadExistingStatements(false);
      return;
    }

    const loadExistingStatementsForUpload = async () => {
      setLoadingUploadExistingStatements(true);
      const { data, error } = await supabase
        .from('bank_statements')
        .select('id,file_name,account_type,statement_month,statement_year,my_company_id,file_storage_path,transactions_count,processed,validation_status,validation_message,parser_version,created_at')
        .eq('statement_month', uploadMonth.month)
        .eq('statement_year', uploadMonth.year)
        .eq('my_company_id', selectedCompanyId)
        .eq('account_type', uploadAccountType)
        .order('created_at', { ascending: false });

      if (cancelled) return;
      if (error) {
        console.error('Error loading existing statement for upload:', error);
        setUploadExistingStatements([]);
      } else {
        setUploadExistingStatements((data || []) as BankStatementRecord[]);
      }
      setLoadingUploadExistingStatements(false);
    };

    void loadExistingStatementsForUpload();
    return () => { cancelled = true; };
  }, [selectedCompanyId, uploadAccountType, uploadMonth, uploadStatementsRevision]);

  const handleSelectedFile = async (file: File | null, month: number, year: number) => {
    if (!file) return;
    if (!selectedCompanyId) {
      showSnackbar('Najpierw wybierz działalność w oknie importu.', 'warning');
      return;
    }

    const lowerName = file.name.toLowerCase();

    const isValid =
      uploadAccountType === 'mt940' ? lowerName.endsWith('.txt') : lowerName.endsWith('.pdf');

    if (!isValid) {
      showSnackbar(
        uploadAccountType === 'mt940'
          ? 'Dla MT940 dozwolony jest tylko plik TXT'
          : 'Dozwolony jest tylko plik PDF z wyciągiem bankowym',
        'error',
      );
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
          'id, file_name, account_type, statement_month, statement_year, my_company_id, file_storage_path, transactions_count, processed, validation_status, validation_message, parser_version, created_at, my_companies(name)',
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
    accountType: 'regular' | 'vat' | 'mt940',
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

      if (accountType !== 'mt940') {
        window.open(signedUrl.signedUrl, '_blank', 'noopener,noreferrer');
        return;
      }

      const response = await fetch(signedUrl.signedUrl);
      if (!response.ok) {
        throw new Error('Nie udało się pobrać pliku MT940');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = url;
      link.download = stmt.file_name || `mt940-${year}-${month}.txt`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      window.URL.revokeObjectURL(url);
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

      const { error } = await supabase.from('bank_statements').delete().eq('id', statementId);

      if (error) throw error;

      if (stmt?.my_company_id) {
        const { error: staleReportError } = await supabase
          .from('bank_ai_reconciliation_reports')
          .update({ is_stale: true })
          .or(`my_company_id.eq.${stmt.my_company_id},my_company_id.is.null`);
        if (
          staleReportError
          && !['PGRST205', '42P01'].includes(String(staleReportError.code || ''))
        ) {
          console.warn('Nie udało się oznaczyć zapisanej analizy jako nieaktualnej:', staleReportError);
        }
      }

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

  const getStatementsForMonth = async (month: number, year: number, accountType: AccountType) => {
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

  const handleDownloadForMonth = async (month: number, year: number, accountType: AccountType) => {
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
        showSnackbar('Najpierw wybierz działalność w oknie importu.', 'warning');
        return;
      }

      setUploadingFile(true);
      setUploadProgress({ step: 'Wczytywanie pliku...', current: 0, total: 8 });

      const lowerName = file.name.toLowerCase();
      const isMt940 = uploadAccountType === 'mt940';

      if (isMt940) {
        if (!lowerName.endsWith('.txt')) {
          throw new Error('Dla MT940 obsługiwane są wyłącznie pliki TXT');
        }
      } else if (!lowerName.endsWith('.pdf')) {
        throw new Error('Obsługiwane są wyłącznie pliki PDF');
      }

      const fileType: 'MT940' | 'PDF' = isMt940 ? 'MT940' : 'PDF';

      setUploadProgress({
        step: isMt940 ? 'Parsowanie pliku MT940...' : 'Parsowanie PDF...',
        current: 1,
        total: 8,
      });

      let parsedStatement: any;
      let fileContent = '';

      if (isMt940) {
        fileContent = await readBankTextFile(file);
        parsedStatement = parseMT940(fileContent);
      } else {
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

        parsedStatement = result.data;
        fileContent = parsedStatement?.rawText || '[PDF parsed]';

        const expectedPeriod = `${year}-${String(month).padStart(2, '0')}`;
        const parsedPeriod = parsedStatement?.periodFrom?.slice(0, 7);
        if (!parsedPeriod || parsedPeriod !== expectedPeriod) {
          throw new Error(
            `Wyciąg dotyczy okresu ${parsedPeriod || 'nierozpoznanego'}, a wybrano ${expectedPeriod}. Import został zatrzymany.`,
          );
        }

        const outOfPeriod = (parsedStatement?.transactions || []).filter(
          (transaction: any) => !String(transaction.transactionDate || '').startsWith(expectedPeriod),
        );
        if (outOfPeriod.length > 0) {
          throw new Error(
            `Wyciąg zawiera ${outOfPeriod.length} operacji spoza wybranego miesiąca. Import został zatrzymany.`,
          );
        }

        if (parsedStatement?.integrity?.failedTransitions > 0) {
          throw new Error('Kontrola ciągłości salda wykryła nieprawidłowe kwoty. Import został zatrzymany.');
        }
      }

      const transactions = parsedStatement?.transactions || [];

      setUploadProgress({ step: 'Sprawdzanie poprzedniego importu...', current: 2, total: 8 });

      const { data: statementsForMonth, error: existingStatementsError } = await supabase
        .from('bank_statements')
        .select('id, file_storage_path, file_name, account_type, account_number, transactions_count, processed, validation_status')
        .eq('statement_month', month)
        .eq('statement_year', year)
        .eq('my_company_id', selectedCompanyId);

      if (existingStatementsError) throw existingStatementsError;

      const importedAccountNumber = extractBankAccountNumber(
        parsedStatement?.accountNumber,
        file.name,
      );
      const existingStatements = (statementsForMonth || []).filter((statement) => {
        if (statement.account_type !== uploadAccountType) return false;

        const existingAccountNumber = extractBankAccountNumber(
          statement.account_number,
          statement.file_name,
        );

        if (importedAccountNumber && existingAccountNumber) {
          return importedAccountNumber === existingAccountNumber;
        }

        return true;
      });

      const existingStatementIds = (existingStatements || []).map((s) => s.id);

      if (existingStatementIds.length > 0) {
        const { count: protectedTransactionsCount, error: protectedTransactionsError } = await supabase
          .from('bank_transactions')
          .select('id', { count: 'exact', head: true })
          .in('statement_id', existingStatementIds)
          .or('allocated_amount.gt.0,matched_document_count.gt.0,accounting_review_status.eq.explained');
        if (protectedTransactionsError) throw protectedTransactionsError;
        if (Number(protectedTransactionsCount || 0) > 0) {
          throw new Error(
            `Nie można zastąpić tego wyciągu, ponieważ zawiera ${protectedTransactionsCount} rozliczonych lub opisanych transakcji. Dotychczasowe dopasowania pozostają bez zmian. Jeśli plik jest innym źródłem, dodaj go jako osobny typ PDF, VAT albo MT940.`,
          );
        }

        const existingFiles = existingStatements
          .map((statement) => `${statement.file_name} (${statement.transactions_count || 0} transakcji)`)
          .join(', ');
        const confirmed = await showConfirm({
          title: 'Ponowny import wyciągu',
          message: `Dla ${MONTHS[month - 1].toLowerCase()} ${year} znaleziono już wyciąg tego samego typu: ${existingFiles}. Kontynuacja zastąpi wyłącznie ten import. Wyciąg bieżący, VAT i MT940 są przechowywane niezależnie, a wspólną analizę uruchomisz po dodaniu wszystkich plików.`,
          confirmText: 'Zastąp ten wyciąg',
          cancelText: 'Anuluj import',
        });
        if (!confirmed) {
          showSnackbar('Import anulowany. Dotychczasowy wyciąg pozostał bez zmian.', 'info');
          return;
        }

        setUploadProgress({ step: 'Czyszczenie starego wyciągu...', current: 3, total: 8 });

        const oldStoragePaths = (existingStatements || [])
          .map((s) => s.file_storage_path)
          .filter(Boolean) as string[];

        if (oldStoragePaths.length > 0) {
          await supabase.storage.from('bank-statements').remove(oldStoragePaths);
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

      const extension = isMt940 ? 'txt' : 'pdf';
      const contentType = isMt940 ? 'text/plain' : 'application/pdf';

      const storagePath = `${selectedCompanyId}/${year}/${month}_${uploadAccountType}_${Date.now()}.${extension}`;

      const { error: storageError } = await supabase.storage
        .from('bank-statements')
        .upload(storagePath, file, {
          contentType,
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
          account_number: importedAccountNumber || parsedStatement?.accountNumber || null,
          opening_balance: parsedStatement?.openingBalance ?? null,
          closing_balance: parsedStatement?.closingBalance ?? null,
          currency: parsedStatement?.currency || 'PLN',
          transactions_count: transactions.length,
          import_format: fileType,
          parser_version: isMt940 ? 2 : Number(parsedStatement?.parserVersion || 2),
          validation_status: 'pending',
          validation_message: null,
          uploaded_by: user?.id,
          processed: false,
        })
        .select()
        .single();

      if (statementError) throw statementError;

      setUploadProgress({
        step: `Przetwarzanie transakcji (0/${transactions.length})...`,
        current: 6,
        total: 8,
      });

      for (let i = 0; i < transactions.length; i++) {
        const transaction = transactions[i];

        if (i % 5 === 0) {
          setUploadProgress({
            step: `Przetwarzanie transakcji (${i + 1}/${transactions.length})...`,
            current: 6,
            total: 8,
          });
        }

        const { error: insertTransactionError } = await supabase
          .from('bank_transactions')
          .insert({
            statement_id: statement.id,
            transaction_date: transaction.transactionDate,
            posting_date: transaction.postingDate ?? null,
            amount: transaction.amount,
            currency: transaction.currency || 'PLN',
            transaction_type: transaction.type,
            counterparty_name: repairBrokenBankText(transaction.counterpartyName) || null,
            counterparty_account: transaction.counterpartyAccount ?? null,
            title: repairBrokenBankText(transaction.title) || null,
            reference_number: transaction.referenceNumber ?? null,
            raw_description: repairBrokenBankText(transaction.rawDescription) || null,
            raw_counterparty: repairBrokenBankText(transaction.rawCounterparty) || null,
          });

        if (insertTransactionError) throw insertTransactionError;
      }

      setUploadProgress({ step: 'Finalizowanie importu...', current: 7, total: 8 });

      const { error: finalizeStatementError } = await supabase
        .from('bank_statements')
        .update({
          processed: true,
          processed_at: new Date().toISOString(),
          validation_status: 'valid',
          validation_message: null,
        })
        .eq('id', statement.id);

      if (finalizeStatementError) throw finalizeStatementError;

      const { error: staleReportError } = await supabase
        .from('bank_ai_reconciliation_reports')
        .update({ is_stale: true })
        .or(`my_company_id.eq.${selectedCompanyId},my_company_id.is.null`);
      if (
        staleReportError
        && !['PGRST205', '42P01'].includes(String(staleReportError.code || ''))
      ) {
        console.warn('Nie udało się oznaczyć zapisanej analizy jako nieaktualnej:', staleReportError);
      }

      setUploadProgress({ step: 'Wyciąg gotowy. Oczekuje na wspólną analizę.', current: 8, total: 8 });
      await loadSummaries();

      setSelectedMonth((prev) =>
        prev
          ? {
              ...prev,
              bank_statement_uploaded: true,
            }
          : prev,
      );

      setIsDragOver(false);
      setUploadStatementsRevision((current) => current + 1);
      showSnackbar(
        `${isMt940 ? 'Plik MT940' : uploadAccountType === 'vat' ? 'Wyciąg VAT' : 'Wyciąg PDF'} został dodany. Transakcji: ${transactions.length}. Dodaj pozostałe wyciągi, a następnie uruchom wspólną Analizę AI.`,
        'success',
      );
    } catch (error: any) {
      console.error('Error uploading bank statement:', error);
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

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonthNumber = now.getMonth() + 1;

  const displayedSummaries = summaries.filter((summary) => {
    if (selectedYear < currentYear) return true;
    if (selectedYear > currentYear) return false;

    return summary.month <= currentMonthNumber;
  });

  const yearTotals = displayedSummaries.reduce(
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
            Wartości faktur według daty wystawienia. Wyciąg kontroluje płatności, ale nie ustala
            miesiąca przychodu.
          </p>
        </div>

        <div className="flex items-center gap-4">
          {!filterCompanyIds && (
            <CompanySelector
              value={selectedCompanyId}
              onChange={setSelectedCompanyId}
              showAllOption={true}
              className="w-64"
            />
          )}
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
                {formatFinancialAmount(yearTotals.income)} PLN
              </span>
            </div>

            <div className="hidden items-center gap-2 sm:flex">
              <TrendingDown className="h-4 w-4 text-red-400" />
              <span className="text-sm text-[#e5e4e2]/60">Wydatki:</span>
              <span className="text-sm font-medium text-red-400">
                {formatFinancialAmount(yearTotals.expenses)} PLN
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
                {formatFinancialAmount(yearTotals.income - yearTotals.expenses)} PLN
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
                {formatFinancialAmount(yearTotals.income)} PLN
              </div>
              <div className="text-xs text-[#e5e4e2]/40">{yearTotals.issued} faktur</div>
            </div>

            <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4">
              <div className="text-sm text-[#e5e4e2]/60">Wydatki</div>
              <div className="mt-1 text-xl font-bold text-red-400">
                {formatFinancialAmount(yearTotals.expenses)} PLN
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
                {formatFinancialAmount(yearTotals.income - yearTotals.expenses)} PLN
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
      </div>

      {false && currentMonth && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-green-500/20 bg-gradient-to-br from-green-500/10 to-green-600/5 p-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-[#e5e4e2]/60">Przychody</div>
                <div className="mt-2 text-2xl font-bold text-green-400">
                  {formatFinancialAmount(currentMonth.total_income)} PLN
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
                  {formatFinancialAmount(currentMonth.total_expenses)} PLN
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
                  {formatFinancialAmount(currentMonth.total_income - currentMonth.total_expenses)} PLN
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
                    Sprzedaż KSeF
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-[#e5e4e2]/60">
                    Zakupy KSeF
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
                          +{formatFinancialAmount(summary.total_income)} PLN
                        </span>
                        <div className="text-xs text-[#e5e4e2]/40">
                          {summary.invoices_issued_count} faktur
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <span className="text-sm text-red-400">
                          -{formatFinancialAmount(summary.total_expenses)} PLN
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
                          {formatFinancialAmount(balance)} PLN
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
                  <div className="text-sm text-[#e5e4e2]/60">Sprzedaż KSeF</div>
                  <div className="mt-1 text-xl font-bold text-green-400">
                    {formatFinancialAmount(selectedMonth.total_income)} PLN
                  </div>
                  <div className="mt-1 text-xs text-[#e5e4e2]/40">
                    {selectedMonth.invoices_issued_count} faktur
                  </div>
                </div>
                <div className="rounded-lg bg-[#252945] p-4">
                  <div className="text-sm text-[#e5e4e2]/60">Zakupy KSeF</div>
                  <div className="mt-1 text-xl font-bold text-red-400">
                    {formatFinancialAmount(selectedMonth.total_expenses)} PLN
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
                    {formatFinancialAmount(selectedMonth.total_income - selectedMonth.total_expenses)} PLN
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
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={loadingStatements}
                  onClick={() => {
                    setShowStatementsListModal(true);
                    void loadAllStatements();
                  }}
                  className="inline-flex items-center gap-2 rounded-lg border border-[#d3bb73]/20 px-3 py-2 text-xs font-medium text-[#d3bb73] hover:bg-[#d3bb73]/10 disabled:opacity-50"
                >
                  <List className="h-4 w-4" />
                  Lista wyciągów
                </button>
                <button
                  onClick={() => setUploadMonth(null)}
                  className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]"
                >
                  x
                </button>
              </div>
            </div>

            <div className="space-y-6 p-6">
              <div className="rounded-lg border border-[#d3bb73]/20 bg-[#252945] p-4">
                <CompanySelector
                  value={selectedCompanyId}
                  onChange={setSelectedCompanyId}
                  showAllOption={true}
                  emptyOptionLabel="Wybierz działalność…"
                  label="Działalność, której dotyczy wyciąg"
                />
                {!selectedCompanyId && (
                  <p className="mt-2 text-xs text-amber-200/80">
                    Wybierz działalność przed dodaniem pliku. Dzięki temu wyciąg i transakcje zostaną zapisane we właściwym miejscu.
                  </p>
                )}
              </div>

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
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="radio"
                      name="uploadAccountType"
                      value="mt940"
                      checked={uploadAccountType === 'mt940'}
                      onChange={() => setUploadAccountType('mt940')}
                      className="h-4 w-4 accent-[#d3bb73]"
                    />
                    <span className="text-sm text-[#e5e4e2]">MT940</span>
                  </label>
                </div>
              </div>

              {selectedCompanyId && (
                <div className="rounded-lg border border-[#d3bb73]/20 bg-[#252945] p-4">
                  {loadingUploadExistingStatements ? (
                    <div className="flex items-center gap-2 text-sm text-[#e5e4e2]/60">
                      <Clock className="h-4 w-4 animate-pulse text-[#d3bb73]" />
                      Sprawdzam wcześniej wgrane wyciągi…
                    </div>
                  ) : uploadExistingStatements.length > 0 ? (
                    <div>
                      <div className="flex items-start gap-2">
                        <CheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
                        <div>
                          <p className="text-sm font-medium text-emerald-200">
                            Ten wyciąg jest już wgrany
                          </p>
                          <p className="mt-1 text-xs text-[#e5e4e2]/55">
                            Możesz go zobaczyć albo wybrać nowy plik, aby zastąpić wyłącznie wyciąg tego samego typu i rachunku.
                          </p>
                        </div>
                      </div>

                      <div className="mt-3 space-y-2">
                        {uploadExistingStatements.map((statement) => (
                          <div key={statement.id} className="flex flex-col gap-3 rounded-lg border border-emerald-300/15 bg-[#1c1f33] p-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0">
                              <p className="truncate text-sm text-[#e5e4e2]">{statement.file_name}</p>
                              <p className="mt-1 text-xs text-[#e5e4e2]/45">
                                {statement.transactions_count || 0} transakcji • {statement.validation_status === 'valid' ? 'zweryfikowany' : statement.validation_status === 'rejected' ? 'wymaga ponownego importu' : 'oczekuje na weryfikację'}
                              </p>
                            </div>
                            <button
                              type="button"
                              disabled={!statement.file_storage_path}
                              onClick={() => void handleDownloadStatement(
                                statement.id,
                                statement.account_type,
                                statement.statement_month,
                                statement.statement_year,
                              )}
                              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-[#d3bb73]/25 px-3 py-2 text-xs font-medium text-[#d3bb73] hover:bg-[#d3bb73]/10 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {statement.account_type === 'mt940' ? <Download className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                              {statement.account_type === 'mt940' ? 'Pobierz' : 'Zobacz wyciąg'}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-sm text-[#e5e4e2]/55">
                      <FileText className="h-4 w-4 text-[#d3bb73]/70" />
                      Brak wgranego wyciągu tego typu dla wybranej działalności i miesiąca.
                    </div>
                  )}
                </div>
              )}

              <div
                onDragEnter={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (!uploadingFile && selectedCompanyId) setIsDragOver(true);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (!uploadingFile && selectedCompanyId) {
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
                  if (!selectedCompanyId) {
                    showSnackbar('Najpierw wybierz działalność w oknie importu.', 'warning');
                    return;
                  }

                  const file = e.dataTransfer.files?.[0] ?? null;
                  if (
                    file &&
                    uploadAccountType === 'mt940' &&
                    !file.name.toLowerCase().endsWith('.txt')
                  ) {
                    showSnackbar('Możesz upuscic tylko plik TXT', 'error');
                    return;
                  }
                  if (
                    file &&
                    uploadAccountType !== 'mt940' &&
                    !file.name.toLowerCase().endsWith('.pdf')
                  ) {
                    showSnackbar('Możesz upuscic tylko plik PDF', 'error');
                    return;
                  }

                  await handleSelectedFile(file, uploadMonth.month, uploadMonth.year);
                }}
                className={`rounded-lg border-2 border-dashed p-6 transition-all ${
                  isDragOver
                    ? 'border-[#d3bb73] bg-[#d3bb73]/10 shadow-[0_0_0_1px_rgba(211,187,115,0.35)]'
                    : 'border-[#d3bb73]/20'
                } ${uploadingFile || !selectedCompanyId ? 'opacity-60' : ''}`}
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

                  <p className="mt-1 text-xs text-[#e5e4e2]/60">
                    {uploadAccountType === 'mt940' ? 'Format TXT (.txt)' : 'Format PDF (.pdf)'}
                  </p>

                  <label className={`mt-4 inline-flex items-center gap-2 rounded-lg border border-[#d3bb73]/20 bg-[#252945] px-4 py-2 text-sm text-[#e5e4e2] ${selectedCompanyId && !uploadingFile ? 'cursor-pointer hover:border-[#d3bb73]/40 hover:bg-[#2d3254]' : 'cursor-not-allowed'}`}>
                    <Upload className="h-4 w-4" />
                    Wybierz plik
                    <input
                      type="file"
                      accept={uploadAccountType === 'mt940' ? '.txt' : '.pdf'}
                      disabled={uploadingFile || !selectedCompanyId}
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
                        Krok {Math.min(uploadProgress.current + 1, uploadProgress.total)} z {uploadProgress.total}
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
        <UnmatchedTransactionsModal
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

      <BankStatementsListModal
        open={showStatementsListModal}
        loading={loadingStatements}
        statements={allStatements}
        renamingStatement={renamingStatement}
        setRenamingStatement={setRenamingStatement}
        onClose={() => setShowStatementsListModal(false)}
        onRename={handleRenameStatement}
        onDownload={handleDownloadStatement}
        onDelete={handleDeleteStatement}
      />
    </div>
  );
}
