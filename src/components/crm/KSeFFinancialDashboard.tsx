'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase/browser';
import { loadStatementFinancialSummaries, type StatementFinancialSummary } from '@/lib/invoices/statementFinancialSummaries';
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
  ChevronUp,
  ChevronDown,
  Download,
  Trash2,
  List,
  Pencil,
  RefreshCw,
} from 'lucide-react';
import { parseMT940, parseJPK_WB } from '@/lib/bankStatementParsers';
import { readBankTextFile, repairBrokenBankText } from '@/lib/bankTextEncoding';
import { bankStatementImportFormat, resolveStatementAccount } from '@/lib/bankStatementAccount';
import { selectBankStatementsForUpload, validateBankStatementUploadAccount } from '@/lib/bankStatementUploadScope';
import { assertBankStatementCanBeRemoved } from '@/lib/CRM/bankStatementRemovalGuard';
import { linkDetectedVatTransfersForPeriod } from '@/lib/CRM/bankVatTransfers';
import MonthlyAccountingDashboard from './invoices/tabs/MonthlyAccountingDashboard';
import CompanySelector from './CompanySelector';
import ResponsiveActionBar from './ResponsiveActionBar';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { useDialog } from '@/contexts/DialogContext';
import BankStatementsListModal from './invoices/modal/BankStatementRecord';

type AccountType = 'regular' | 'vat' | 'mt940';
type UploadAccountType = 'regular' | 'vat';
type UploadFormat = 'PDF' | 'MT940';

type MonthlySummary = StatementFinancialSummary;

interface BankStatementRecord {
  id: string;
  file_name: string;
  account_type: AccountType;
  account_number?: string | null;
  import_format?: string | null;
  file_type?: string | null;
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
        .select('account_type, import_format, file_type, file_name, file_storage_path')
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
      setHasMt940((data || []).some((statement) => bankStatementImportFormat(statement) === 'MT940'));
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
      label: 'Otwórz miesiąc',
      onClick: onDetails,
      icon: <FileText className="h-4 w-4" />,
    },
    {
      label: 'Wyciągi konta bieżącego',
      onClick: () => onDownload('regular'),
      icon: <Download className="h-4 w-4" />,
      show: hasRegular,
    },
    {
      label: 'Wyciągi konta VAT',
      onClick: () => onDownload('vat'),
      icon: <Download className="h-4 w-4" />,
      show: hasVat,
    },
    {
      label: 'Pliki MT940',
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const [summaryRows, setSummaries] = useState<MonthlySummary[]>([]);
  const [summaryCurrency, setSummaryCurrency] = useState('PLN');
  const [summaryCurrencies, setSummaryCurrencies] = useState<string[]>(['PLN']);
  const [summaryWarnings, setSummaryWarnings] = useState<string[]>([]);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const summaryRequest = useRef(0);
  const summaries = summaryRows.filter((summary) => summary.currency === summaryCurrency);
  const [loading, setLoading] = useState(true);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ step: '', current: 0, total: 0 });
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [availableYears, setAvailableYears] = useState<number[]>([new Date().getFullYear()]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [showYearSummary, setShowYearSummary] = useState(false);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [uploadAccountType, setUploadAccountType] = useState<UploadAccountType>('regular');
  const [uploadFormat, setUploadFormat] = useState<UploadFormat>('PDF');
  const [uploadMonth, setUploadMonth] = useState<MonthlySummary | null>(null);
  const [showStatementsListModal, setShowStatementsListModal] = useState(false);
  const [allStatements, setAllStatements] = useState<BankStatementRecord[]>([]);
  const [loadingStatements, setLoadingStatements] = useState(false);
  const [uploadExistingStatements, setUploadExistingStatements] = useState<BankStatementRecord[]>([]);
  const [loadingUploadExistingStatements, setLoadingUploadExistingStatements] = useState(false);
  const [uploadExistingScope, setUploadExistingScope] = useState('');
  const [uploadExistingError, setUploadExistingError] = useState<string | null>(null);
  const [deletingStatementId, setDeletingStatementId] = useState<string | null>(null);
  const statementMutationInProgress = useRef(false);
  const [uploadStatementsRevision, setUploadStatementsRevision] = useState(0);
  const [renamingStatement, setRenamingStatement] = useState<{ id: string; name: string } | null>(
    null,
  );
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const { employee: currentEmployee, isAdmin } = useCurrentEmployee();
  const uploadScope = `${selectedCompanyId}:${uploadMonth?.year}:${uploadMonth?.month}:${uploadAccountType}:${uploadFormat}:${uploadStatementsRevision}`;
  const uploadSelectionReady = uploadExistingScope === uploadScope
    && !loadingUploadExistingStatements && !uploadExistingError;
  const statementMutationBusy = uploadingFile || deletingStatementId !== null;
  const queryMonth = Number(searchParams.get('statementMonth'));
  const queryYear = Number(searchParams.get('statementYear'));
  const selectedMonth: MonthlySummary | null = Number.isInteger(queryMonth) && queryMonth >= 1 && queryMonth <= 12
    && Number.isInteger(queryYear) && queryYear >= 2000 && queryYear <= 2100
    ? summaries.find((summary) => summary.month === queryMonth && summary.year === queryYear) || {
      id: `${queryYear}-${queryMonth}`, month: queryMonth, year: queryYear, total_income: 0, total_expenses: 0,
      invoices_issued_count: 0, invoices_received_count: 0, invoices_paid_count: 0, invoices_unpaid_count: 0,
      invoices_overdue_count: 0, bank_statement_uploaded: false, currency: summaryCurrency, cash_document_count: 0,
    } : null;
  const setSelectedMonth = (summary: MonthlySummary | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (summary) {
      params.set('statementMonth', String(summary.month));
      params.set('statementYear', String(summary.year));
    } else {
      params.delete('statementMonth'); params.delete('statementYear');
      void loadSummaries();
    }
    router.push(`/crm/invoices?${params.toString()}`, { scroll: false });
  };
  const allowedCompanyIds: string[] | null = (() => {
    if (isAdmin) return null;

    const ids = (currentEmployee as any)?.my_company_ids;

    if (!Array.isArray(ids)) return [];
    return ids as string[];
  })();
  const requestedSummaryCompanies = selectedCompanyId ? [selectedCompanyId] : filterCompanyIds ?? null;
  const summaryCompanies = allowedCompanyIds === null ? requestedSummaryCompanies
    : requestedSummaryCompanies === null ? allowedCompanyIds : requestedSummaryCompanies.filter((id) => allowedCompanyIds.includes(id));
  const summaryCompanyKey = summaryCompanies === null ? '*' : [...new Set(summaryCompanies)].sort().join(',');

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
    void loadSummaries();
    return () => { summaryRequest.current += 1; };
  }, [selectedYear, selectedCompanyId, summaryCompanyKey]);

  useEffect(() => {
    let cancelled = false;

    if (!uploadMonth || !selectedCompanyId) {
      setUploadExistingStatements([]);
      setUploadExistingScope('');
      setUploadExistingError(null);
      setLoadingUploadExistingStatements(false);
      return;
    }

    const loadExistingStatementsForUpload = async () => {
      setLoadingUploadExistingStatements(true);
      setUploadExistingStatements([]);
      setUploadExistingError(null);
      try {
        // Read both account kinds before resolving legacy MT940 by account number.
        const [statementsResult, companyResult] = await Promise.all([
          supabase.from('bank_statements')
            .select('id,file_name,account_type,account_number,import_format,file_type,statement_month,statement_year,my_company_id,file_storage_path,transactions_count,processed,validation_status,validation_message,parser_version,created_at')
            .eq('statement_month', uploadMonth.month)
            .eq('statement_year', uploadMonth.year)
            .eq('my_company_id', selectedCompanyId)
            .order('created_at', { ascending: false }),
          supabase.from('my_companies').select('bank_account,vat_bank_account')
            .eq('id', selectedCompanyId).single(),
        ]);
        if (statementsResult.error) throw statementsResult.error;
        if (companyResult.error) throw companyResult.error;
        if (cancelled) return;
        setUploadExistingStatements(selectBankStatementsForUpload(
          (statementsResult.data || []) as BankStatementRecord[],
          uploadAccountType, uploadFormat, companyResult.data,
        ));
      } catch (error) {
        if (cancelled) return;
        console.error('Error loading existing statement for upload:', error);
        setUploadExistingError('Nie udało się sprawdzić plików i rachunków firmy. Odśwież listę przed importem.');
      } finally {
        if (!cancelled) {
          setUploadExistingScope(uploadScope);
          setLoadingUploadExistingStatements(false);
        }
      }
    };

    void loadExistingStatementsForUpload();
    return () => { cancelled = true; };
  }, [selectedCompanyId, uploadAccountType, uploadFormat, uploadMonth, uploadStatementsRevision]);

  const handleSelectedFile = async (file: File | null, month: number, year: number) => {
    if (!file) return;
    if (statementMutationInProgress.current) return;
    if (!uploadSelectionReady) {
      showSnackbar(uploadExistingError || 'Poczekaj na sprawdzenie plików wybranego rachunku.', 'warning');
      return;
    }
    if (!selectedCompanyId) {
      showSnackbar('Najpierw wybierz działalność w oknie importu.', 'warning');
      return;
    }

    const lowerName = file.name.toLowerCase();

    const isValid =
      uploadFormat === 'MT940' ? /\.(txt|sta|mt940)$/.test(lowerName) : lowerName.endsWith('.pdf');

    if (!isValid) {
      showSnackbar(
        uploadFormat === 'MT940'
          ? 'Dla MT940 wybierz plik TXT, STA lub MT940'
          : 'Dozwolony jest tylko plik PDF z wyciągiem bankowym',
        'error',
      );
      return;
    }

    await handleFileUpload(file, month, year);
  };

  const loadSummaries = async () => {
    const requestId = ++summaryRequest.current;
    try {
      setLoading(true);
      setSummaryError(null); setSummaryWarnings([]); setSummaries([]);
      const result = await loadStatementFinancialSummaries(supabase, {
        year: selectedYear,
        companyIds: summaryCompanyKey === '*' ? null : summaryCompanyKey.split(',').filter(Boolean),
      });
      if (requestId !== summaryRequest.current) return;
      setSummaries(result.summaries);
      const currencies = result.currencies.length ? result.currencies : ['PLN'];
      setSummaryCurrencies(currencies);
      setSummaryCurrency((current) => currencies.includes(current) ? current : currencies.includes('PLN') ? 'PLN' : currencies[0]);
      setAvailableYears([...new Set([selectedYear, new Date().getFullYear(), ...result.availableYears])].sort((a, b) => b - a));
      setSummaryWarnings(result.warnings);
    } catch (error: any) {
      if (requestId !== summaryRequest.current) return;
      setSummaries([]);
      setSummaryError(error.message || 'Nie udało się pobrać wszystkich rejestrów. Podsumowanie nie jest dostępne.');
    } finally {
      if (requestId === summaryRequest.current) setLoading(false);
    }
  };

  const loadAllStatements = async () => {
    try {
      setLoadingStatements(true);

      let query = supabase
        .from('bank_statements')
        .select(
          'id, file_name, account_type, account_number, import_format, file_type, statement_month, statement_year, my_company_id, file_storage_path, transactions_count, processed, validation_status, validation_message, parser_version, created_at, my_companies(name)',
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
        .select('file_storage_path, file_name, account_type, import_format, file_type')
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

      if (bankStatementImportFormat(stmt) !== 'MT940') {
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
    if (statementMutationInProgress.current) return;
    statementMutationInProgress.current = true;
    setDeletingStatementId(statementId);
    try {
      const { data: stmt, error: statementError } = await supabase
        .from('bank_statements')
        .select('file_name,file_storage_path,my_company_id,statement_month,statement_year,account_type,account_number,import_format,file_type')
        .eq('id', statementId)
        .single();
      if (statementError) throw statementError;
      await assertBankStatementCanBeRemoved(supabase, statementId);
      const accountNumber = resolveStatementAccount(stmt).accountNumber;
      const confirmed = await showConfirm({
        title: 'Usuń ten plik wyciągu',
        message: `Usunąć „${stmt.file_name}” (${bankStatementImportFormat(stmt)}, rachunek ${accountNumber || 'nierozpoznany'}, ${stmt.statement_month}/${stmt.statement_year}) i jego niepowiązane odczyty transakcji? Drugi format oraz pliki innych rachunków pozostaną bez zmian. Po usunięciu możesz wgrać nowy plik.`,
        confirmText: 'Usuń ten plik',
        cancelText: 'Zachowaj plik',
      });
      if (!confirmed) return;
      // Recheck links after the user has reviewed the exact deletion target.
      await assertBankStatementCanBeRemoved(supabase, statementId);
      let deleteQuery = supabase.from('bank_statements').delete()
        .eq('id', statementId).eq('my_company_id', stmt.my_company_id)
        .eq('statement_month', stmt.statement_month).eq('statement_year', stmt.statement_year)
        .eq('file_name', stmt.file_name).eq('account_type', stmt.account_type);
      deleteQuery = stmt.file_storage_path
        ? deleteQuery.eq('file_storage_path', stmt.file_storage_path)
        : deleteQuery.is('file_storage_path', null);
      const { data: deleted, error } = await deleteQuery.select('id');
      if (error) throw error;
      if (deleted?.length !== 1) throw new Error('Plik zmienił się w trakcie operacji. Odśwież listę i spróbuj ponownie.');

      // Never erase the original if the database refuses to remove its record.
      let retainedOriginal = false;
      if (stmt.file_storage_path) {
        const { error: storageError } = await supabase.storage.from('bank-statements').remove([stmt.file_storage_path]);
        retainedOriginal = Boolean(storageError);
      }

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

      showSnackbar(retainedOriginal
        ? 'Usunięto wpis i niepowiązane odczyty. Oryginał pozostał w magazynie, ponieważ jego usunięcie się nie powiodło.'
        : 'Usunięto wskazany plik i jego niepowiązane odczyty. Możesz teraz wgrać nowy plik.',
      retainedOriginal ? 'warning' : 'success');
      setAllStatements((prev) => prev.filter((s) => s.id !== statementId));
      setUploadStatementsRevision((current) => current + 1);
      await loadSummaries();
    } catch (error: any) {
      console.error('Delete error:', error);
      showSnackbar(error.message || 'Błąd usuwania wyciągu', 'error');
    } finally {
      statementMutationInProgress.current = false;
      setDeletingStatementId(null);
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
      .select('id, file_storage_path, file_name, account_type, import_format, file_type, my_company_id')
      .eq('statement_month', month)
      .eq('statement_year', year)
      .not('file_storage_path', 'is', null)
      .order('created_at', { ascending: false });

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

    return (data || []).filter((statement) => accountType === 'mt940'
      ? bankStatementImportFormat(statement) === 'MT940'
      : statement.account_type === accountType);
  };

  const handleDownloadForMonth = async (month: number, year: number, accountType: AccountType) => {
    const statements = await getStatementsForMonth(month, year, accountType);

    if (!statements.length) {
      showSnackbar(
        `Brak ${accountType === 'mt940' ? 'pliku MT940' : accountType === 'vat' ? 'wyciągu VAT' : 'wyciągu bieżącego'} dla tego miesiąca`,
        'warning',
      );
      return;
    }

    if (statements.length > 1) {
      showSnackbar(
        'Wybierz konkretny plik z listy wyciągów — PDF i MT940 są dostępne osobno.',
        'info',
      );
      setShowStatementsListModal(true);
      void loadAllStatements();
      return;
    }

    const stmt = statements[0];

    await handleDownloadStatement(stmt.id, accountType, month, year);
  };

  const handleFileUpload = async (file: File, month: number, year: number) => {
    if (statementMutationInProgress.current) return;
    statementMutationInProgress.current = true;
    try {
      if (!selectedCompanyId) {
        showSnackbar('Najpierw wybierz działalność w oknie importu.', 'warning');
        return;
      }

      setUploadingFile(true);
      setUploadProgress({ step: 'Wczytywanie pliku...', current: 0, total: 8 });

      const lowerName = file.name.toLowerCase();
      const isMt940 = uploadFormat === 'MT940';

      if (isMt940) {
        if (!/\.(txt|sta|mt940)$/.test(lowerName)) {
          throw new Error('Dla MT940 wybierz plik TXT, STA lub MT940');
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

      const [statementsResult, companyResult] = await Promise.all([
        supabase.from('bank_statements')
          .select('id,file_storage_path,file_name,account_type,account_number,import_format,file_type,transactions_count,processed,validation_status')
          .eq('statement_month', month).eq('statement_year', year).eq('my_company_id', selectedCompanyId),
        supabase.from('my_companies').select('bank_account,vat_bank_account').eq('id', selectedCompanyId).single(),
      ]);
      if (statementsResult.error) throw statementsResult.error;
      if (companyResult.error) throw companyResult.error;
      const statementsForMonth = statementsResult.data || [];

      const resolvedAccount = resolveStatementAccount({
        account_number: parsedStatement?.accountNumber,
        file_name: file.name,
      });
      const importedAccountNumber = resolvedAccount.accountNumber;
      const accountError = validateBankStatementUploadAccount({
        accountType: uploadAccountType,
        accountNumber: importedAccountNumber,
        statements: statementsForMonth,
        companyAccounts: companyResult.data,
      });
      if (accountError) throw new Error(accountError);
      if (resolvedAccount.warning) {
        const confirmedAccount = await showConfirm({
          title: 'Sprawdź numer rachunku',
          message: `${resolvedAccount.warning} Rachunek z treści: ${importedAccountNumber}. Czy zaimportować plik do ${uploadAccountType === 'vat' ? 'konta VAT' : 'konta bieżącego'}?`,
          confirmText: 'Użyj rachunku z treści',
          cancelText: 'Anuluj import',
        });
        if (!confirmedAccount) return;
      }
      const existingStatements = selectBankStatementsForUpload(
        statementsForMonth, uploadAccountType, fileType, companyResult.data,
      ).filter((statement) => resolveStatementAccount(statement).accountNumber === importedAccountNumber);
      if (existingStatements.length > 0) {
        const existingFiles = existingStatements.map((statement) => `„${statement.file_name}”`).join(', ');
        throw new Error(`${fileType} dla ${uploadAccountType === 'vat' ? 'konta VAT' : 'konta bieżącego'} ${importedAccountNumber} za ${month}/${year} jest już zapisany: ${existingFiles}. Jeśli chcesz wgrać nową wersję, najpierw użyj „Usuń ten plik” przy właściwym pliku na liście. Nie usuwaj drugiego formatu ani wyciągu innego konta.`);
      }

      setUploadProgress({ step: 'Przesyłanie pliku do magazynu...', current: 4, total: 8 });

      const extension = isMt940 ? 'txt' : 'pdf';
      const contentType = isMt940 ? 'text/plain' : 'application/pdf';

      const storagePath = `${selectedCompanyId}/${year}/${month}_${uploadAccountType}_${fileType.toLowerCase()}_${Date.now()}.${extension}`;

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
          parser_version: isMt940 ? 4 : Number(parsedStatement?.parserVersion || 2),
          validation_status: 'pending',
          validation_message: null,
          uploaded_by: user?.id,
          processed: false,
        })
        .select()
        .single();

      if (statementError) {
        // This is only the freshly uploaded object, never an existing source file.
        await supabase.storage.from('bank-statements').remove([storagePath]);
        if (statementError.code === '23505') {
          throw new Error('Baza zablokowała zapis. Odśwież listę, aby sprawdzić, czy ten sam plik nie został już dodany. Jeżeli zapisany jest tylko drugi format (PDF/MT940), potrzebna jest aktualizacja ograniczenia w bazie. Nie usuwaj drugiego formatu ani wyciągu innego rachunku — dotychczasowe pliki pozostały bez zmian.');
        }
        throw statementError;
      }

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
            source_index: transaction.sourceIndex ?? null,
            source_balance_before: transaction.balanceBefore ?? null,
            source_balance_after: transaction.balanceAfter ?? null,
            source_verified: transaction.sourceVerified === true,
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

      let vatPairingWarning = '';
      try {
        const pairing = await linkDetectedVatTransfersForPeriod(supabase, {
          companyId: selectedCompanyId, month, year,
        });
        vatPairingWarning = pairing.warnings?.join(' ') || '';
      } catch (error) {
        console.warn('Wyciąg zapisano, ale nie udało się powiązać transferów między kontami VAT.', error);
        vatPairingWarning = 'Automatyczne powiązanie transferów VAT wymaga ponowienia w analizie miesiąca.';
      }

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

      setIsDragOver(false);
      setUploadStatementsRevision((current) => current + 1);
      showSnackbar(
        `${fileType} dla ${uploadAccountType === 'vat' ? 'konta VAT' : 'konta bieżącego'} został dodany. Transakcji: ${transactions.length}. ${vatPairingWarning || 'Dodaj pozostałe wyciągi, a następnie uruchom wspólną Analizę AI.'}`,
        vatPairingWarning ? 'warning' : 'success',
      );
    } catch (error: any) {
      console.error('Error uploading bank statement:', error);
      showSnackbar(error.message || 'Błąd podczas importu wyciągu', 'error');
    } finally {
      statementMutationInProgress.current = false;
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
      cash: acc.cash + s.cash_document_count,
    }),

    { income: 0, expenses: 0, issued: 0, received: 0, paid: 0, unpaid: 0, overdue: 0, cash: 0 },
  );

  return (
    <div className="space-y-6">
      {!selectedMonth && <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-light text-[#e5e4e2]">Wyciągi i rozliczenia miesięczne</h2>
          <p className="mt-1 text-sm text-[#e5e4e2]/60">
            Otwórz miesiąc, aby sprawdzić wyciągi, braki i przygotować paczkę do Saldeo.
            Podsumowanie obejmuje dokumenty z KSeF, CRM i spoza KSeF, także gotówkowe oraz bez dopasowanego przelewu. Połączone kopie są liczone raz.
            Kwoty brutto według daty wystawienia pokazujemy osobno dla każdej waluty — nie są obrotami bankowymi ani wynikiem podatkowym.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
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
          <label className="flex items-center gap-2 text-sm text-[#e5e4e2]/60">Waluta:
            <select value={summaryCurrency} onChange={(event) => setSummaryCurrency(event.target.value)} className="rounded-lg border border-white/10 bg-[var(--brand-burgundy-800)] px-3 py-2 text-[#e5e4e2] outline-none focus:border-[var(--crm-field-border-focus)]">
              {summaryCurrencies.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => void loadSummaries()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-sm text-[#e5e4e2] hover:bg-white/10 disabled:opacity-40"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Odśwież podsumowanie</button>
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

      {summaryError && <div role="alert" className="rounded-xl bg-amber-400/5 p-4 text-sm text-amber-200">{summaryError} Nie pokazujemy niepełnych danych jako zerowych kwot.</div>}
      {!!summaryWarnings.length && <div role="status" className="rounded-xl bg-amber-400/5 p-4 text-sm text-amber-200"><p className="font-medium">Podsumowanie wymaga uwagi</p><ul className="mt-2 list-disc space-y-1 pl-5">{summaryWarnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div>}
      {!loading && !summaryError && <div className="overflow-hidden rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]">
        <button
          type="button"
          onClick={() => setShowYearSummary((prev) => !prev)}
          className="flex w-full items-center justify-between px-5 py-3 text-left transition-colors hover:bg-[#d3bb73]/5"
        >
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-green-400" />
              <span className="text-sm text-[#e5e4e2]/60">Przychody brutto:</span>
              <span className="text-sm font-medium text-green-400">
                {formatFinancialAmount(yearTotals.income)} {summaryCurrency}
              </span>
            </div>

            <div className="hidden items-center gap-2 sm:flex">
              <TrendingDown className="h-4 w-4 text-red-400" />
              <span className="text-sm text-[#e5e4e2]/60">Koszty brutto:</span>
              <span className="text-sm font-medium text-red-400">
                {formatFinancialAmount(yearTotals.expenses)} {summaryCurrency}
              </span>
            </div>

            <div className="hidden items-center gap-2 lg:flex">
              <FileText className="h-4 w-4 text-[#d3bb73]" />
              <span className="text-sm text-[#e5e4e2]/60">Różnica brutto:</span>
              <span
                className={`text-sm font-medium ${
                  yearTotals.income - yearTotals.expenses >= 0 ? 'text-green-400' : 'text-red-400'
                }`}
              >
                {formatFinancialAmount(yearTotals.income - yearTotals.expenses)} {summaryCurrency}
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
              <div className="text-sm text-[#e5e4e2]/60">Przychody brutto</div>
              <div className="mt-1 text-xl font-bold text-green-400">
                {formatFinancialAmount(yearTotals.income)} {summaryCurrency}
              </div>
              <div className="text-xs text-[#e5e4e2]/40">{yearTotals.issued} dokumentów sprzedaży</div>
            </div>

            <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4">
              <div className="text-sm text-[#e5e4e2]/60">Koszty brutto</div>
              <div className="mt-1 text-xl font-bold text-red-400">
                {formatFinancialAmount(yearTotals.expenses)} {summaryCurrency}
              </div>
              <div className="text-xs text-[#e5e4e2]/40">{yearTotals.received} dokumentów kosztowych</div>
            </div>

            <div className="rounded-lg border border-[#d3bb73]/20 bg-[#d3bb73]/5 p-4">
              <div className="text-sm text-[#e5e4e2]/60">Różnica brutto</div>
              <div
                className={`mt-1 text-xl font-bold ${
                  yearTotals.income - yearTotals.expenses >= 0 ? 'text-green-400' : 'text-red-400'
                }`}
              >
                {formatFinancialAmount(yearTotals.income - yearTotals.expenses)} {summaryCurrency}
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
                <p className="pt-2 text-xs text-[#e5e4e2]/55">Uwzględniono {yearTotals.cash} dokumentów z oznaczeniem gotówki. Sam sposób płatności nie potwierdza zapłaty.</p>
              </div>
            </div>
          </div>
        )}
      </div>}

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
        ) : summaryError ? (
          <p className="p-6 text-sm text-[#e5e4e2]/60">Nie można wyświetlić pełnego podsumowania. Użyj „Odśwież podsumowanie”.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#d3bb73]/10">
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-[#e5e4e2]/60">
                    Miesiąc
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-[#e5e4e2]/60">
                    Przychody brutto — wszystkie źródła
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-[#e5e4e2]/60">
                    Koszty brutto — wszystkie źródła
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-[#e5e4e2]/60">
                    Różnica brutto
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
                          <button type="button" onClick={() => setSelectedMonth(summary)} className="rounded text-left text-sm font-medium text-[#e5e4e2] hover:text-[#d3bb73] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#d3bb73]/30">
                            {MONTHS[summary.month - 1]} {summary.year}
                          </button>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <span className="text-sm text-green-400">
                          {formatFinancialAmount(summary.total_income)} {summaryCurrency}
                        </span>
                        <div className="text-xs text-[#e5e4e2]/40">
                          {summary.invoices_issued_count} dokumentów
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <span className="text-sm text-red-400">
                          {formatFinancialAmount(summary.total_expenses)} {summaryCurrency}
                        </span>
                        <div className="text-xs text-[#e5e4e2]/40">
                          {summary.invoices_received_count} dokumentów
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <span
                          className={`text-sm font-medium ${
                            balance >= 0 ? 'text-green-400' : 'text-red-400'
                          }`}
                        >
                          {balance >= 0 ? '+' : ''}
                          {formatFinancialAmount(balance)} {summaryCurrency}
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
                        {summary.cash_document_count > 0 && <p className="mt-1 text-center text-[10px] text-[#e5e4e2]/50">Gotówka w dokumentach: {summary.cash_document_count}</p>}
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
      </>}

      {selectedMonth && (selectedCompanyId ? <MonthlyAccountingDashboard
        key={`${selectedCompanyId}:${selectedMonth.year}:${selectedMonth.month}:${uploadStatementsRevision}`}
        month={selectedMonth.month} year={selectedMonth.year} companyId={selectedCompanyId}
        onBack={() => { setSelectedMonth(null); void loadSummaries(); }} onUpload={() => setUploadMonth(selectedMonth)}
        onDownload={handleDownloadStatement}
      /> : <div className="space-y-4 rounded-xl bg-[#1c1f33] p-6">
        <button type="button" onClick={() => setSelectedMonth(null)} className="rounded-lg bg-white/5 px-3 py-2 text-sm text-[#e5e4e2]">← Wszystkie miesiące</button>
        <h3 className="text-lg text-[#e5e4e2]">{MONTHS[selectedMonth.month - 1]} {selectedMonth.year} — wybierz działalność</h3>
        <p className="text-sm text-[#e5e4e2]/60">Rozliczenie miesiąca i paczka do Saldeo muszą dotyczyć jednej firmy.</p>
        <CompanySelector value={selectedCompanyId} onChange={setSelectedCompanyId} showAllOption={false} className="max-w-sm" />
      </div>)}

      {uploadMonth && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] shadow-xl">
            <div className="flex items-center justify-between border-b border-[#d3bb73]/10 p-6">
              <h3 className="text-xl font-medium text-[#e5e4e2]">
                Wgraj wyciag: {MONTHS[uploadMonth.month - 1]} {uploadMonth.year}
              </h3>
              <div className="flex items-center gap-2">
                <button data-crm-action="secondary"
                  type="button"
                  disabled={loadingStatements || statementMutationBusy}
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
                  disabled={statementMutationBusy}
                  onClick={() => setUploadMonth(null)}
                  className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]"
                >
                  x
                </button>
              </div>
            </div>

            <div className="space-y-6 p-6">
              <fieldset disabled={statementMutationBusy} className="rounded-lg bg-[#252945] p-4">
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
              </fieldset>

              <div className="space-y-4 rounded-lg bg-[var(--brand-burgundy-800)] p-4">
                <fieldset disabled={statementMutationBusy}>
                  <legend className="mb-2 text-sm font-medium text-[#e5e4e2]">Rachunek, którego dotyczy wyciąg</legend>
                  <div className="flex flex-wrap gap-4">
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="radio"
                      name="uploadAccountType"
                      value="regular"
                      checked={uploadAccountType === 'regular'}
                      onChange={() => setUploadAccountType('regular')}
                      className="h-4 w-4 accent-[#d3bb73]"
                    />
                    <span className="text-sm text-[#e5e4e2]">Konto bieżące</span>
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
                </fieldset>
                <fieldset disabled={statementMutationBusy}>
                  <legend className="mb-2 text-sm font-medium text-[#e5e4e2]">Format pliku</legend>
                  <div className="flex flex-wrap gap-4">
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="radio"
                      name="uploadFormat"
                      value="PDF"
                      checked={uploadFormat === 'PDF'}
                      onChange={() => setUploadFormat('PDF')}
                      className="h-4 w-4 accent-[#d3bb73]"
                    />
                    <span className="text-sm text-[#e5e4e2]">PDF</span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="radio"
                      name="uploadFormat"
                      value="MT940"
                      checked={uploadFormat === 'MT940'}
                      onChange={() => setUploadFormat('MT940')}
                      className="h-4 w-4 accent-[#d3bb73]"
                    />
                    <span className="text-sm text-[#e5e4e2]">MT940</span>
                  </label>
                  </div>
                </fieldset>
                <p className="text-xs leading-relaxed text-[#e5e4e2]/60">
                  Do każdego konta możesz dodać PDF i MT940. Pliki uzupełniają się w podglądzie transakcji; konto VAT pozostaje oddzielone od bieżącego.
                </p>
              </div>

              {selectedCompanyId && (
                <div className="rounded-lg border border-[#d3bb73]/20 bg-[#252945] p-4">
                  {loadingUploadExistingStatements || uploadExistingScope !== uploadScope ? (
                    <div className="flex items-center gap-2 text-sm text-[#e5e4e2]/60">
                      <Clock className="h-4 w-4 animate-pulse text-[#d3bb73]" />
                      Sprawdzam wcześniej wgrane wyciągi…
                    </div>
                  ) : uploadExistingError ? (
                    <div className="space-y-2 text-sm text-amber-200">
                      <p>{uploadExistingError}</p>
                      <button type="button" onClick={() => setUploadStatementsRevision((current) => current + 1)}
                        className="rounded-lg bg-white/5 px-3 py-2 text-xs hover:bg-white/10">Odśwież listę</button>
                    </div>
                  ) : uploadExistingStatements.length > 0 ? (
                    <div>
                      <div className="flex items-start gap-2">
                        <CheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
                        <div>
                          <p className="text-sm font-medium text-emerald-200">
                            {uploadFormat} — {uploadAccountType === 'vat' ? 'konto VAT' : 'konto bieżące'}: plik już dodany
                          </p>
                          <p className="mt-1 text-xs text-[#e5e4e2]/55">
                            Aby wgrać nową wersję, usuń konkretny plik przyciskiem poniżej i potwierdź operację. Drugiego formatu oraz wyciągów innych kont nie trzeba usuwać. Pliki z opisami lub powiązaniami są chronione.
                          </p>
                        </div>
                      </div>

                      <div className="mt-3 space-y-2">
                        {uploadExistingStatements.map((statement) => (
                          <div key={statement.id} className="flex flex-col gap-3 rounded-lg border border-emerald-300/15 bg-[#1c1f33] p-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0">
                              <p className="break-all text-sm text-[#e5e4e2]">{statement.file_name}</p>
                              <p className="mt-1 text-xs text-[#e5e4e2]/45">
                                {uploadAccountType === 'vat' ? 'Konto VAT' : 'Konto bieżące'} · {bankStatementImportFormat(statement)} · {' '}
                                {statement.transactions_count || 0} transakcji • {statement.validation_status === 'valid' ? 'zweryfikowany' : statement.validation_status === 'rejected' ? 'wymaga ponownego importu' : 'oczekuje na weryfikację'}
                              </p>
                              <p className="mt-1 break-all text-xs text-[#e5e4e2]/45">Rachunek: {resolveStatementAccount(statement).accountNumber || 'numer nie został odczytany'}</p>
                            </div>
                            <div className="flex shrink-0 flex-wrap gap-2 sm:flex-col">
                            <button data-crm-action="secondary"
                              type="button"
                              disabled={!statement.file_storage_path || statementMutationBusy}
                              onClick={() => void handleDownloadStatement(
                                statement.id,
                                statement.account_type,
                                statement.statement_month,
                                statement.statement_year,
                              )}
                              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-[#d3bb73]/25 px-3 py-2 text-xs font-medium text-[#d3bb73] hover:bg-[#d3bb73]/10 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {bankStatementImportFormat(statement) === 'MT940' ? <Download className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                              {bankStatementImportFormat(statement) === 'MT940' ? 'Pobierz MT940' : 'Zobacz PDF'}
                            </button>
                            <button type="button" disabled={statementMutationBusy}
                              onClick={() => void handleDeleteStatement(statement.id)}
                              className="inline-flex items-center justify-center gap-2 rounded-lg bg-red-400/5 px-3 py-2 text-xs font-medium text-red-200 hover:bg-red-400/10 disabled:opacity-40">
                              <Trash2 className="h-4 w-4" />
                              {deletingStatementId === statement.id ? 'Sprawdzam…' : 'Usuń ten plik'}
                            </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-sm text-[#e5e4e2]/55">
                      <FileText className="h-4 w-4 text-[#d3bb73]/70" />
                      Brak pliku {uploadFormat} dla wybranego konta, działalności i miesiąca.
                    </div>
                  )}
                </div>
              )}

              <div
                onDragEnter={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (!statementMutationBusy && selectedCompanyId && uploadSelectionReady) setIsDragOver(true);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (!statementMutationBusy && selectedCompanyId && uploadSelectionReady) {
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

                  if (statementMutationBusy || !uploadSelectionReady) return;
                  if (!selectedCompanyId) {
                    showSnackbar('Najpierw wybierz działalność w oknie importu.', 'warning');
                    return;
                  }

                  const file = e.dataTransfer.files?.[0] ?? null;
                  await handleSelectedFile(file, uploadMonth.month, uploadMonth.year);
                }}
                className={`rounded-lg border border-dashed border-[var(--crm-field-border)] p-6 transition-colors ${
                  isDragOver
                    ? 'bg-[#d3bb73]/10'
                    : 'bg-black/5'
                } ${statementMutationBusy || !selectedCompanyId || !uploadSelectionReady ? 'opacity-60' : ''}`}
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
                    {uploadFormat === 'MT940' ? 'MT940 (.txt, .sta, .mt940)' : 'PDF (.pdf)'} · {uploadAccountType === 'vat' ? 'konto VAT' : 'konto bieżące'}
                  </p>

                  <label className={`mt-4 inline-flex items-center gap-2 rounded-lg border border-[#d3bb73]/20 bg-[#252945] px-4 py-2 text-sm text-[#e5e4e2] ${selectedCompanyId && !statementMutationBusy && uploadSelectionReady ? 'cursor-pointer hover:border-[#d3bb73]/40 hover:bg-[#2d3254]' : 'cursor-not-allowed'}`}>
                    <Upload className="h-4 w-4" />
                    Wybierz plik
                    <input
                      type="file"
                      accept={uploadFormat === 'MT940' ? '.txt,.sta,.mt940' : '.pdf'}
                      disabled={statementMutationBusy || !selectedCompanyId || !uploadSelectionReady}
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
                disabled={statementMutationBusy}
                onClick={() => setUploadMonth(null)}
                className="rounded-lg border border-[#d3bb73]/20 px-4 py-2 text-sm text-[#e5e4e2] hover:bg-[#252945]"
              >
                Zamknij
              </button>
            </div>
          </div>
        </div>
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
