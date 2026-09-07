'use client';

import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRightLeft,
  BookOpenCheck,
  CheckCircle,
  Eye,
  FileWarning,
  Link2,
  Loader2,
  MessageSquareText,
  ReceiptText,
  Search,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { decodeTextEntities } from '@/lib/textEncoding';
import { parseMT940Description } from '@/lib/bankStatementParsers';
import InvoiceDetailsModal from '@/components/crm/InvoiceDetailsModal';
import {
  applyBankTransactionMatch,
  applyBankTransactionMatchToDocument,
  findBankTransactionMatchCandidates,
  isBankStatementMatchablePaymentMethod,
  matchBankTransactionToDocuments,
  reconcileExternalInvoiceWithBankTransaction,
  reconcilePaidKsefInvoiceWithBankTransaction,
  reconcilePersonnelPaymentWithBankTransaction,
} from '@/lib/bankTransactionMatching';

type Priority = 'high' | 'medium' | 'low';
type Direction = 'credit' | 'debit';
type BankStatementAccountType = 'regular' | 'vat' | 'mt940';
type DocumentSourceFilter = 'all' | PreparedDocument['source'];
type DocumentPaymentFilter = 'all' | 'paid' | 'unpaid';

type PreparedTransaction = {
  id: string;
  ref: string;
  companyId: string;
  companyRef: string;
  date: string;
  direction: Direction;
  amount: number;
  remainingAmount: number;
  currency: string;
  counterparty: string;
  title: string;
  referenceNumber: string;
  rawDescription: string;
  mappedCounterparty: string;
  mappingAlias: string;
  accountingNote: string;
  accountingCategory: string;
  accountingReviewStatus: 'pending' | 'explained';
  statementAccountType?: BankStatementAccountType | null;
  statementImportFormat?: string | null;
  statementFileName?: string | null;
};

type PreparedDocument = {
  id: string;
  ref: string;
  companyRef: string;
  source: 'ksef' | 'crm' | 'external' | 'personnel';
  number: string;
  issueDate: string;
  dueDate: string;
  direction: Direction;
  amount: number;
  grossAmount: number;
  settledAmount: number;
  currency: string;
  counterparty: string;
  paymentStatus: string;
  documentKind: string;
  settlementDocumentNumbers: string[];
  sourceDocumentNumbers: string[];
  requiresKsefReview: boolean;
  companyInferred: boolean;
  accountingNote: string;
  linkedTransactionId?: string;
};

type AiAnalysis = {
  summary: string;
  likelyMatches: Array<{
    transactionRef: string;
    documentRefs: string[];
    confidence: Priority;
    reason: string;
    amountExplanation: string;
    recommendedAction: string;
  }>;
  missingDocuments: Array<{
    transactionRef: string;
    documentType: 'invoice' | 'receipt' | 'foreign_invoice' | 'customs' | 'tax_or_zus' | 'payroll' | 'bank_fee' | 'other';
    priority: Priority;
    reason: string;
    recommendedAction: string;
  }>;
  reviewTransactions: Array<{
    transactionRef: string;
    priority: Priority;
    reason: string;
    recommendedAction: string;
  }>;
  reviewDocuments: Array<{
    documentRef: string;
    priority: Priority;
    reason: string;
    recommendedAction: string;
  }>;
  warnings: string[];
};

type MatchSuggestion = AiAnalysis['likelyMatches'][number];

type SnapshotMaps = {
  transactions: Map<string, PreparedTransaction>;
  documents: Map<string, PreparedDocument>;
};

type SnapshotStats = {
  transactions: number;
  debitTransactions: number;
  debitAmount: number;
  documents: number;
  linkedPersonnelPayments: number;
};

type AnalysisProgress = {
  step: number;
  totalSteps: number;
  percent: number;
  label: string;
  detail: string;
  indeterminate?: boolean;
};

const initialAnalysisProgress: AnalysisProgress = {
  step: 1,
  totalSteps: 6,
  percent: 5,
  label: 'Sprawdzam wyciągi bankowe',
  detail: 'Szukam poprawnie przetworzonych wyciągów dla wybranego miesiąca.',
};

type StoredAiAnalysis = {
  version: number;
  analysis: AiAnalysis;
  transactions: Array<[string, PreparedTransaction]>;
  documents: Array<[string, PreparedDocument]>;
  snapshotStats: SnapshotStats;
  matchedKeys: string[];
};

type StoredAiAnalysisRow = {
  analysis_version: number;
  analysis: AiAnalysis;
  transactions: Array<[string, PreparedTransaction]>;
  documents: Array<[string, PreparedDocument]>;
  snapshot_stats: SnapshotStats;
  matched_keys: string[] | null;
  is_stale: boolean;
  updated_at: string;
};

const ANALYSIS_REPORT_VERSION = 19;

const money = (value: number, currency = 'PLN') => `${Number(value || 0)
  .toFixed(2)
  .replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} ${currency}`;

function localDate(year: number, monthIndex: number, day: number) {
  const date = new Date(year, monthIndex, day);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function priorityClasses(priority: Priority) {
  if (priority === 'high') return 'border-red-400/25 bg-red-400/5 text-red-200';
  if (priority === 'medium') return 'border-amber-400/25 bg-amber-400/5 text-amber-100';
  return 'border-sky-400/20 bg-sky-400/5 text-sky-100';
}

function priorityLabel(priority: Priority) {
  if (priority === 'high') return 'pilne';
  if (priority === 'medium') return 'ważne';
  return 'kontrola';
}

const documentTypeLabels: Record<AiAnalysis['missingDocuments'][number]['documentType'], string> = {
  invoice: 'Faktura kosztowa',
  receipt: 'Paragon lub faktura',
  foreign_invoice: 'Faktura zagraniczna',
  customs: 'Dokumenty celne/importowe',
  tax_or_zus: 'Podatek lub ZUS — bez faktury',
  payroll: 'Wynagrodzenie — dokument płacowy',
  bank_fee: 'Opłata bankowa — dokument bankowy',
  other: 'Inny dokument',
};

const accountingCategoryLabels: Record<string, string> = {
  bank_fee: 'Opłata bankowa',
  tax_or_zus: 'Podatek lub ZUS',
  payroll: 'Wynagrodzenie',
  own_transfer: 'Przelew własny',
  cash: 'Gotówka',
  foreign_purchase: 'Zakup zagraniczny',
  other: 'Inne',
};

const personnelPaymentLabels: Record<string, string> = {
  salary: 'Wynagrodzenie',
  advance: 'Zaliczka',
  tax: 'Podatek',
  zus: 'ZUS',
  reimbursement: 'Zwrot kosztów',
  other: 'Inna opłata',
};

function sourceLabel(source: PreparedDocument['source']) {
  if (source === 'ksef') return 'KSeF';
  if (source === 'external') return 'poza KSeF';
  if (source === 'personnel') return 'kadrowy';
  return 'CRM';
}

function documentHeading(document: PreparedDocument) {
  return document.source === 'personnel'
    ? 'Dokument kadrowy'
    : `Faktura ${sourceLabel(document.source)}`;
}

function isDocumentPaid(document: PreparedDocument) {
  const status = document.paymentStatus
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pl-PL')
    .trim();
  return ['paid', 'oplacona', 'zaplacona', 'settled', 'matched'].includes(status);
}

function transactionLabel(transaction?: PreparedTransaction) {
  if (!transaction) return 'Nieznana transakcja';
  return `${transaction.date || 'bez daty'} • ${money(transaction.remainingAmount, transaction.currency)} • ${transaction.mappedCounterparty || transaction.counterparty || transaction.title || 'bez kontrahenta'}`;
}

function parsedBankTransactionTitle(
  title?: string | null,
  rawDescription?: string | null,
) {
  if (!rawDescription) return String(title || '').trim();
  return parseMT940Description(rawDescription).title || String(title || '').trim();
}

function transactionStatementLabel(transaction?: PreparedTransaction) {
  if (!transaction) return 'Wyciąg bankowy';
  const accountLabel = transaction.statementAccountType === 'vat'
    ? 'Konto VAT'
    : 'Konto bieżące';
  const format = String(
    transaction.statementImportFormat
      || (transaction.statementAccountType === 'mt940' ? 'MT940' : 'PDF'),
  ).toUpperCase();
  return `${accountLabel} • ${format}`;
}

function normalizeCounterpartyAlias(value?: string | null) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function deduplicateStatementTransactions(
  rows: any[],
  statementMetadata: Map<string, any>,
) {
  const resolutionPriority = (row: any) => {
    if (String(row.match_status || '') === 'matched') return 4;
    if (Number(row.allocated_amount || 0) > 0.009) return 3;
    if (String(row.accounting_review_status || '') === 'explained') return 2;
    if (Boolean(row.private_transfer_detected)) return 1;
    return 0;
  };
  const sourcePriority = (row: any) => {
    const statement = statementMetadata.get(row.statement_id);
    const format = String(statement?.import_format || statement?.file_type || '').toUpperCase();
    return format === 'MT940' || statement?.account_type === 'mt940' ? 2 : 1;
  };
  const textIdentity = (row: any) => normalizeCounterpartyAlias(
    `${row.counterparty_name || ''} ${row.title || ''} ${row.raw_description || ''}`,
  );
  const accountIdentities = (row: any) => {
    const values = new Set<string>();
    const directAccount = String(row.counterparty_account || '').replace(/\D/g, '');
    if (directAccount.length >= 16) values.add(directAccount.slice(-26));
    const transactionText = [row.counterparty_name, row.title, row.raw_description]
      .filter(Boolean)
      .join(' ');
    const embeddedAccounts = transactionText.match(/(?:PL\s*)?\d{2}(?:[\s-]*\d{4}){6}/gi) || [];
    embeddedAccounts.forEach((account) => {
      const digits = account.replace(/\D/g, '');
      if (digits.length >= 16) values.add(digits.slice(-26));
    });
    return values;
  };
  const referenceIdentity = (row: any) => normalizeCounterpartyAlias(row.reference_number || '');
  const statementAccountIdentity = (row: any) => String(
    statementMetadata.get(row.statement_id)?.account_number || '',
  ).replace(/\D/g, '');
  const statementCompanyIdentity = (row: any) => String(
    statementMetadata.get(row.statement_id)?.my_company_id || '',
  );
  const isMt940Source = (row: any) => {
    const statement = statementMetadata.get(row.statement_id);
    const format = String(statement?.import_format || statement?.file_type || '').toUpperCase();
    return format.includes('MT940') || statement?.account_type === 'mt940';
  };
  const isPdfSource = (row: any) => {
    const statement = statementMetadata.get(row.statement_id);
    const format = String(statement?.import_format || statement?.file_type || '').toUpperCase();
    return format.includes('PDF') || String(statement?.file_name || '').toLowerCase().endsWith('.pdf');
  };
  const hasSameIdentity = (left: any, right: any) => {
    const leftAccounts = accountIdentities(left);
    const rightAccounts = accountIdentities(right);
    if (Array.from(leftAccounts).some((account) => rightAccounts.has(account))) return true;

    const leftReference = referenceIdentity(left);
    const rightReference = referenceIdentity(right);
    if (leftReference.length >= 4 && rightReference.length >= 4 && leftReference === rightReference) return true;

    const leftText = textIdentity(left);
    const rightText = textIdentity(right);
    const shorterTextLength = Math.min(leftText.length, rightText.length);
    return shorterTextLength >= 12 && (
      leftText.includes(rightText)
      || rightText.includes(leftText)
      || leftText.slice(0, 32) === rightText.slice(0, 32)
    );
  };
  const hasSameBookingData = (left: any, right: any) => {
    if (left.statement_id === right.statement_id) return false;
    const leftStatementAccount = statementAccountIdentity(left);
    const rightStatementAccount = statementAccountIdentity(right);
    const sameStatementAccount = leftStatementAccount.length >= 8
      && leftStatementAccount === rightStatementAccount;
    const sameCompanyAcrossPdfAndMt940 = Boolean(statementCompanyIdentity(left))
      && statementCompanyIdentity(left) === statementCompanyIdentity(right)
      && ((isPdfSource(left) && isMt940Source(right)) || (isMt940Source(left) && isPdfSource(right)));
    return (sameStatementAccount || sameCompanyAcrossPdfAndMt940)
      && String(left.transaction_date || '') === String(right.transaction_date || '')
      && String(left.transaction_type || '') === String(right.transaction_type || '')
      && String(left.currency || 'PLN').toUpperCase() === String(right.currency || 'PLN').toUpperCase()
      && Math.abs(Math.abs(Number(left.amount || 0)) - Math.abs(Number(right.amount || 0))) <= 0.009
      && hasSameIdentity(left, right);
  };

  return [...rows]
    .sort((left, right) => (
      resolutionPriority(right) - resolutionPriority(left)
      || sourcePriority(right) - sourcePriority(left)
    ))
    .reduce<any[]>((uniqueRows, row) => {
      if (!uniqueRows.some((existing) => hasSameBookingData(existing, row))) uniqueRows.push(row);
      return uniqueRows;
    }, []);
}

function transactionContainsDocumentNumber(
  transaction: Pick<PreparedTransaction, 'title'>,
  document: Pick<PreparedDocument, 'number'>,
) {
  const title = normalizeCounterpartyAlias(transaction.title);
  const number = normalizeCounterpartyAlias(document.number);
  return number.length >= 4 && title.includes(number);
}

function daysDocumentIssuedAfterPayment(
  transaction: Pick<PreparedTransaction, 'date'>,
  document: Pick<PreparedDocument, 'issueDate'>,
) {
  const transactionTime = new Date(transaction.date).getTime();
  const documentTime = new Date(document.issueDate).getTime();
  if (!Number.isFinite(transactionTime) || !Number.isFinite(documentTime)) return null;
  return (documentTime - transactionTime) / 86_400_000;
}

function isMissingCounterpartyMappingsTable(error: any) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  return code === 'PGRST205'
    || code === '42P01'
    || message.includes('bank_counterparty_mapping_templates');
}

function suggestedMappingAlias(transaction: PreparedTransaction) {
  if (transaction.mappingAlias) return transaction.mappingAlias;
  if (transaction.counterparty.trim()) return transaction.counterparty.trim();
  const words = transaction.title
    .split(/\s+/)
    .filter((word) => !/\d/.test(word) && word.replace(/[^A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]/g, '').length >= 2);
  return words.join(' ').trim() || transaction.title.trim();
}

function documentLabel(document?: PreparedDocument) {
  if (!document) return 'Nieznany dokument';
  const amount = Math.abs(document.grossAmount - document.amount) > 0.01
    ? `${money(document.amount, document.currency)} do zapłaty`
    : money(document.amount, document.currency);
  return `${document.number || 'bez numeru'} • ${amount} • ${document.counterparty || sourceLabel(document.source)}`;
}

function isDocumentConfirmed(documentRef: string, keys: Set<string>) {
  return Array.from(keys).some((key) => key.slice(key.indexOf(':') + 1) === documentRef);
}

function canonicalInvoiceKey({
  companyId,
  number,
  amount,
  counterparty,
}: {
  companyId?: string | null;
  number?: string | null;
  amount?: number | string | null;
  counterparty?: string | null;
}) {
  const normalize = (value?: string | null) => String(value || '')
    .replace(/&(?:amp|#0*38|#x0*26);/gi, '&')
    .replace(/&(?:nbsp|#0*160|#x0*a0);/gi, ' ')
    .replace(/&(?:quot|#0*34|#x0*22);/gi, '"')
    .replace(/&(?:apos|#0*39|#x0*27);/gi, "'")
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  const normalizedNumber = normalize(number);
  const normalizedCounterparty = normalize(counterparty);
  const normalizedAmount = Math.abs(Number(amount));
  if (!normalizedNumber || !normalizedCounterparty || !Number.isFinite(normalizedAmount)) return '';
  return `${companyId || 'bez-firmy'}:${normalizedNumber}:${normalizedAmount.toFixed(2)}:${normalizedCounterparty}`;
}

function canonicalInvoiceNumberKey(companyId?: string | null, number?: string | null) {
  const normalizedNumber = String(number || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return normalizedNumber ? `${companyId || 'bez-firmy'}:${normalizedNumber}` : '';
}

const merchantTokenStopWords = new Set([
  'BANK', 'BLIK', 'CARD', 'FAKTURA', 'INVOICE', 'LIMITED', 'PAYMENT', 'PLN', 'SPOLKA', 'THE', 'WITH',
]);

function merchantTokens(value: string) {
  return new Set(String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((token) => /^[A-Z]/.test(token) && token.length >= 4 && !merchantTokenStopWords.has(token)));
}

function hasMerchantIdentityMatch(transaction: PreparedTransaction, document: PreparedDocument) {
  const transactionTokens = merchantTokens(`${transaction.counterparty} ${transaction.title} ${transaction.mappedCounterparty}`);
  const documentTokens = merchantTokens(`${document.counterparty} ${document.number}`);
  return Array.from(documentTokens).some((token) => transactionTokens.has(token));
}

function hasSameDocumentCounterparty(left: PreparedDocument, right: PreparedDocument) {
  const leftCounterparty = normalizeCounterpartyAlias(left.counterparty);
  const rightCounterparty = normalizeCounterpartyAlias(right.counterparty);
  if (leftCounterparty.length < 5 || rightCounterparty.length < 5) return false;
  return leftCounterparty === rightCounterparty
    || leftCounterparty.includes(rightCounterparty)
    || rightCounterparty.includes(leftCounterparty);
}

function dateDistanceInDays(left?: string, right?: string) {
  if (!left || !right) return Number.POSITIVE_INFINITY;
  const leftTime = new Date(left).getTime();
  const rightTime = new Date(right).getTime();
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) return Number.POSITIVE_INFINITY;
  return Math.abs(leftTime - rightTime) / 86_400_000;
}

function belongsToAnalysedMonth(date: string, year: number, month: number) {
  return date.startsWith(`${year}-${String(month).padStart(2, '0')}`);
}

function isExternalCurrencyCandidate(transaction: PreparedTransaction, document: PreparedDocument) {
  return document.source === 'external'
    && document.companyRef === transaction.companyRef
    && document.direction === transaction.direction
    && document.currency.toUpperCase() !== transaction.currency.toUpperCase()
    && dateDistanceInDays(transaction.date, document.issueDate) <= 62
    && hasMerchantIdentityMatch(transaction, document);
}

export default function BankAiAnalysisPanel({
  month,
  year,
  companyId,
  onMatchApplied,
}: {
  month: number;
  year: number;
  companyId?: string | null;
  onMatchApplied?: () => void | Promise<void>;
}) {
  const { showSnackbar } = useSnackbar();
  const [loading, setLoading] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState<AnalysisProgress>(initialAnalysisProgress);
  const [analysis, setAnalysis] = useState<AiAnalysis | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [detailsTab, setDetailsTab] = useState<'matches' | 'missing' | 'transactions' | 'documents'>('matches');
  const [selectedMatchIndex, setSelectedMatchIndex] = useState(0);
  const [selectedTransactionRef, setSelectedTransactionRef] = useState<string | null>(null);
  const [showTransactionPicker, setShowTransactionPicker] = useState(false);
  const [searchOtherMonths, setSearchOtherMonths] = useState(false);
  const [otherMonthsLoading, setOtherMonthsLoading] = useState(false);
  const [transactionSearch, setTransactionSearch] = useState('');
  const [documentSearch, setDocumentSearch] = useState('');
  const [documentFiltersOpen, setDocumentFiltersOpen] = useState(false);
  const [documentSourceFilter, setDocumentSourceFilter] = useState<DocumentSourceFilter>('all');
  const [documentPaymentFilter, setDocumentPaymentFilter] = useState<DocumentPaymentFilter>('all');
  const [documentDateFrom, setDocumentDateFrom] = useState('');
  const [documentDateTo, setDocumentDateTo] = useState('');
  const [selectedDocumentRefs, setSelectedDocumentRefs] = useState<Set<string>>(new Set());
  const [manualMatch, setManualMatch] = useState<MatchSuggestion | null>(null);
  const [matchingKey, setMatchingKey] = useState<string | null>(null);
  const [matchedKeys, setMatchedKeys] = useState<Set<string>>(new Set());
  const [matchNeedsExplanation, setMatchNeedsExplanation] = useState(false);
  const [matchExplanation, setMatchExplanation] = useState('');
  const [confirmedReviewNotes, setConfirmedReviewNotes] = useState<Map<string, string>>(new Map());
  const [analysisSavedAt, setAnalysisSavedAt] = useState<string | null>(null);
  const [analysisStale, setAnalysisStale] = useState(false);
  const [noteEditor, setNoteEditor] = useState<{ kind: 'transaction' | 'document'; ref: string } | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [noteCategory, setNoteCategory] = useState('other');
  const [noteExplained, setNoteExplained] = useState(false);
  const [noteSaving, setNoteSaving] = useState(false);
  const [mappingEditorRef, setMappingEditorRef] = useState<string | null>(null);
  const [mappingAliasDraft, setMappingAliasDraft] = useState('');
  const [mappingCounterpartyDraft, setMappingCounterpartyDraft] = useState('');
  const [mappingNipDraft, setMappingNipDraft] = useState('');
  const [mappingSaving, setMappingSaving] = useState(false);
  const [invoiceDetails, setInvoiceDetails] = useState<any | null>(null);
  const [invoiceDetailsLoadingId, setInvoiceDetailsLoadingId] = useState<string | null>(null);
  const [reportReadyKey, setReportReadyKey] = useState<string | null>(null);
  const [reportPersistenceAvailable, setReportPersistenceAvailable] = useState(true);
  const lastPersistedReportRef = useRef('');
  const [maps, setMaps] = useState<SnapshotMaps>({
    transactions: new Map(),
    documents: new Map(),
  });
  const [snapshotStats, setSnapshotStats] = useState<SnapshotStats | null>(null);
  const reportKey = `${year}:${month}:${companyId || 'all'}`;

  useEffect(() => {
    let cancelled = false;
    setReportReadyKey(null);
    setReportPersistenceAvailable(true);
    lastPersistedReportRef.current = '';
    setAnalysis(null);
    setMaps({ transactions: new Map(), documents: new Map() });
    setSnapshotStats(null);
    setMatchedKeys(new Set());
    setAnalysisSavedAt(null);
    setAnalysisStale(false);
    setSelectedMatchIndex(0);
    setSelectedTransactionRef(null);
    setShowTransactionPicker(false);
    setSearchOtherMonths(false);
    setOtherMonthsLoading(false);
    setTransactionSearch('');
    setDocumentSearch('');
    setDocumentFiltersOpen(false);
    setDocumentSourceFilter('all');
    setDocumentPaymentFilter('all');
    setDocumentDateFrom('');
    setDocumentDateTo('');
    setSelectedDocumentRefs(new Set());
    setManualMatch(null);
    setMatchNeedsExplanation(false);
    setMatchExplanation('');
    setConfirmedReviewNotes(new Map());
    setShowDetails(false);
    setNoteEditor(null);
    setMappingEditorRef(null);
    setInvoiceDetails(null);
    setInvoiceDetailsLoadingId(null);

    try {
      Object.keys(window.localStorage)
        .filter((key) => key.startsWith('bank-ai-analysis:'))
        .forEach((key) => window.localStorage.removeItem(key));
    } catch (error) {
      console.warn('Nie udało się usunąć dawnego lokalnego zapisu analizy:', error);
    }

    const loadStoredReport = async () => {
      let query = supabase
        .from('bank_ai_reconciliation_reports')
        .select('analysis_version,analysis,transactions,documents,snapshot_stats,matched_keys,is_stale,updated_at')
        .eq('statement_month', month)
        .eq('statement_year', year);
      query = companyId
        ? query.eq('my_company_id', companyId)
        : query.is('my_company_id', null);

      const { data, error } = await query.maybeSingle();
      if (cancelled) return;
      if (error) {
        const missingTable = error.code === 'PGRST205' || error.code === '42P01';
        setReportPersistenceAvailable(!missingTable);
        console.warn('Nie udało się odczytać analizy z Supabase:', error);
        setReportReadyKey(reportKey);
        return;
      }

      const stored = data as StoredAiAnalysisRow | null;
      if (
        stored?.analysis_version === ANALYSIS_REPORT_VERSION
        && stored.analysis
        && Array.isArray(stored.transactions)
        && Array.isArray(stored.documents)
      ) {
        const signature = JSON.stringify({
          version: stored.analysis_version,
          analysis: stored.analysis,
          transactions: stored.transactions,
          documents: stored.documents,
          snapshotStats: stored.snapshot_stats,
          matchedKeys: stored.matched_keys || [],
          isStale: stored.is_stale,
        });
        lastPersistedReportRef.current = signature;
        setAnalysis(stored.analysis);
        setMaps({
          transactions: new Map(stored.transactions.map(([ref, transaction]) => [
            ref,
            {
              ...transaction,
              title: parsedBankTransactionTitle(transaction.title, transaction.rawDescription),
            },
          ])),
          documents: new Map(stored.documents),
        });
        setSnapshotStats(stored.snapshot_stats);
        setMatchedKeys(new Set(stored.matched_keys || []));
        setAnalysisSavedAt(stored.updated_at || null);
        setAnalysisStale(stored.is_stale);
      }
      setReportReadyKey(reportKey);
    };

    void loadStoredReport();
    return () => { cancelled = true; };
  }, [companyId, month, reportKey, year]);

  useEffect(() => {
    if (
      reportReadyKey !== reportKey
      || !reportPersistenceAvailable
      || !analysis
      || !snapshotStats
    ) return;
    const stored: StoredAiAnalysis = {
        version: ANALYSIS_REPORT_VERSION,
        analysis,
        transactions: Array.from(maps.transactions.entries()).filter(([, transaction]) => (
          belongsToAnalysedMonth(transaction.date, year, month)
        )),
        documents: Array.from(maps.documents.entries()),
        snapshotStats,
        matchedKeys: Array.from(matchedKeys),
    };
    const signature = JSON.stringify({ ...stored, isStale: analysisStale });
    if (signature === lastPersistedReportRef.current) return;

    let cancelled = false;
    const timeout = window.setTimeout(async () => {
      const { data, error } = await supabase
        .from('bank_ai_reconciliation_reports')
        .upsert({
          my_company_id: companyId || null,
          statement_month: month,
          statement_year: year,
          analysis_version: stored.version,
          analysis: stored.analysis,
          transactions: stored.transactions,
          documents: stored.documents,
          snapshot_stats: stored.snapshotStats,
          matched_keys: stored.matchedKeys,
          contains_personnel_data: stored.documents.some(([, document]) => document.source === 'personnel'),
          is_stale: analysisStale,
        }, { onConflict: 'scope_key,statement_year,statement_month' })
        .select('updated_at')
        .single();
      if (cancelled) return;
      if (error) {
        console.error('Nie udało się zapisać analizy w Supabase:', error);
        showSnackbar('Analiza jest gotowa, ale nie udało się zapisać jej w Supabase.', 'error');
        return;
      }
      lastPersistedReportRef.current = signature;
      setAnalysisSavedAt(data?.updated_at || new Date().toISOString());
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [analysis, analysisStale, companyId, maps, matchedKeys, month, reportKey, reportPersistenceAvailable, reportReadyKey, showSnackbar, snapshotStats, year]);

  const runAnalysis = async () => {
    setAnalysisProgress(initialAnalysisProgress);
    setLoading(true);
    lastPersistedReportRef.current = '';
    let autoLinkedVatPairCount = 0;
    let autoVatPairingWarning = '';
    try {
      let statementsQuery = supabase
        .from('bank_statements')
        .select('id,my_company_id,account_type,account_number,import_format,file_type,file_name')
        .eq('statement_month', month)
        .eq('statement_year', year)
        .eq('processed', true)
        .eq('validation_status', 'valid');
      if (companyId) statementsQuery = statementsQuery.eq('my_company_id', companyId);
      const { data: statements, error: statementsError } = await statementsQuery;
      if (statementsError) throw statementsError;

      const statementRows = statements || [];
      const statementIds = statementRows.map((statement) => statement.id);
      if (!statementIds.length) throw new Error('Brak poprawnie przetworzonego wyciągu dla tego miesiąca.');

      setAnalysisProgress({
        step: 2,
        totalSteps: 6,
        percent: 14,
        label: 'Łączę rachunek bieżący z VAT',
        detail: 'Szukam jednoznacznych par o tej samej kwocie i walucie, przeciwnym kierunku oraz tej samej dacie.',
      });
      const { data: vatPairingData, error: vatPairingError } = await supabase.rpc(
        'auto_link_vat_account_transfers_for_period',
        {
          p_statement_month: month,
          p_statement_year: year,
          p_company_id: companyId || null,
        },
      );
      if (vatPairingError) {
        const migrationMissing = ['PGRST202', '42703', '42883'].includes(String(vatPairingError.code || ''));
        if (!migrationMissing) throw vatPairingError;
        autoVatPairingWarning = 'Automatyczne parowanie rachunku VAT wymaga migracji 20260904143000 w Supabase.';
        showSnackbar(autoVatPairingWarning, 'warning');
      } else {
        const pairingResult = Array.isArray(vatPairingData) ? vatPairingData[0] : vatPairingData;
        autoLinkedVatPairCount = Math.max(Number(pairingResult?.linked_pairs || 0), 0);
        if (autoLinkedVatPairCount > 0) {
          setAnalysisStale(true);
          showSnackbar(`Automatyczne transfery rachunek bieżący ↔ VAT zostały połączone (${autoLinkedVatPairCount}).`, 'success');
          await onMatchApplied?.();
        }
      }

      setAnalysisProgress({
        step: 2,
        totalSteps: 6,
        percent: 18,
        label: 'Wczytuję transakcje',
        detail: autoLinkedVatPairCount > 0
          ? `Automatycznie połączono transfery VAT (${autoLinkedVatPairCount}). Pobieram pozostałe pozycje z ${statementIds.length} wyciągów.`
          : `Znaleziono ${statementIds.length} ${statementIds.length === 1 ? 'wyciąg' : 'wyciągi'}. Pobieram ich pozycje.`,
      });

      const statementCompany = new Map(
        statementRows.map((statement) => [statement.id, statement.my_company_id || 'bez-firmy']),
      );
      const statementMetadata = new Map(
        statementRows.map((statement) => [statement.id, statement]),
      );
      const { data: transactionRows, error: transactionsError } = await supabase
        .from('bank_transactions')
        .select('id,statement_id,transaction_date,amount,currency,transaction_type,counterparty_name,counterparty_account,title,reference_number,raw_description,match_status,allocated_amount,accounting_note,accounting_category,accounting_review_status,private_transfer_detected')
        .in('statement_id', statementIds)
        .order('transaction_date', { ascending: true });
      if (transactionsError) throw transactionsError;
      const uniqueTransactionRows = deduplicateStatementTransactions(
        transactionRows || [],
        statementMetadata,
      );

      setAnalysisProgress({
        step: 3,
        totalSteps: 6,
        percent: 34,
        label: 'Wczytuję dokumenty',
        detail: `Wczytano ${uniqueTransactionRows.length} unikalnych transakcji ze wszystkich wyciągów. Pobieram faktury KSeF, CRM, spoza KSeF i płatności kadrowe.`,
      });

      const companyIds = [...new Set(statementRows
        .map((statement) => statement.my_company_id)
        .filter(Boolean))] as string[];
      const companyRefs = new Map<string, string>();
      companyIds.forEach((id, index) => companyRefs.set(id, `F${index + 1}`));
      companyRefs.set('bez-firmy', 'F0');
      const inferredExternalCompanyId = companyId || (companyIds.length === 1 ? companyIds[0] : null);

      const dateFrom = localDate(year, month - 7, 1);
      const dateTo = localDate(year, month + 2, 0);

      let ksefQuery = supabase
        .from('ksef_invoices')
        .select('id,invoice_id,my_company_id,invoice_number,ksef_reference_number,invoice_type,issue_date,payment_due_date,ksef_issued_at,gross_amount,amount_to_pay_gross,settlement_summary,settled_invoices,currency,buyer_name,seller_name,payment_status,payment_method,sync_status,accounting_note')
        .gte('issue_date', dateFrom)
        .lte('issue_date', dateTo)
        .order('issue_date', { ascending: false })
        .limit(1000);
      let crmQuery = supabase
        .from('invoices')
        .select('id,my_company_id,invoice_number,invoice_type,status,payment_status,payment_method,issue_date,payment_due_date,total_gross,currency_code,buyer_name,settlement_summary,settled_invoices,related_invoice_id,ksef_status,ksef_reference_number,accounting_note')
        .gte('issue_date', dateFrom)
        .lte('issue_date', dateTo)
        .order('issue_date', { ascending: false })
        .limit(1000);
      let externalQuery = supabase
        .from('external_invoices')
        .select('id,my_company_id,invoice_number,invoice_date,amount_gross,currency,seller_name,payment_status,payment_method,accounting_note')
        .gte('invoice_date', dateFrom)
        .lte('invoice_date', dateTo)
        .order('invoice_date', { ascending: false })
        .limit(1000);
      const personnelPaymentsQuery = supabase
        .from('personnel_contract_payments')
        .select('id,payment_date,amount,currency,payment_type,recipient_name,title,notes,bank_transaction_id,personnel_contracts!personnel_contract_payments_personnel_contract_id_fkey!inner(id,my_company_id,contract_number,title,party_name,status)')
        .gte('payment_date', dateFrom)
        .lte('payment_date', dateTo)
        .order('payment_date', { ascending: false })
        .limit(400);

      if (companyId) {
        ksefQuery = ksefQuery.eq('my_company_id', companyId);
        crmQuery = crmQuery.eq('my_company_id', companyId);
        externalQuery = externalQuery.or(`my_company_id.eq.${companyId},my_company_id.is.null`);
      } else if (companyIds.length) {
        ksefQuery = ksefQuery.in('my_company_id', companyIds);
        crmQuery = crmQuery.in('my_company_id', companyIds);
        externalQuery = companyIds.length === 1
          ? externalQuery.or(`my_company_id.eq.${companyIds[0]},my_company_id.is.null`)
          : externalQuery.in('my_company_id', companyIds);
      }

      const [ksefResult, crmResult, externalResult, personnelPaymentsResult] = await Promise.all([
        ksefQuery,
        crmQuery,
        externalQuery,
        personnelPaymentsQuery,
      ]);
      const mappingsResult = await supabase
        .from('bank_counterparty_mapping_templates')
        .select('my_company_id,alias_pattern,normalized_alias,counterparty_name,counterparty_nip')
        .eq('is_active', true);
      const mappingsError = isMissingCounterpartyMappingsTable(mappingsResult.error)
        ? null
        : mappingsResult.error;
      const missingPersonnelPaymentsTable = personnelPaymentsResult.error
        && ['PGRST205', '42P01'].includes(String(personnelPaymentsResult.error.code || ''));
      const personnelPaymentsError = missingPersonnelPaymentsTable ? null : personnelPaymentsResult.error;
      const documentError = ksefResult.error
        || crmResult.error
        || externalResult.error
        || personnelPaymentsError
        || mappingsError;
      if (documentError) throw documentError;

      const loadedDocumentCount = (ksefResult.data || []).length
        + (crmResult.data || []).length
        + (externalResult.data || []).length
        + (personnelPaymentsResult.data || []).length;
      setAnalysisProgress({
        step: 4,
        totalSteps: 6,
        percent: 52,
        label: 'Sprawdzam wcześniejsze dopasowania',
        detail: `Wczytano ${loadedDocumentCount} dokumentów. Odrzucam pozycje rozliczone, gotówkowe i duplikaty CRM/KSeF.`,
      });
      const counterpartyMappings = mappingsResult.data || [];
      const visiblePersonnelPayments = (personnelPaymentsResult.data || []).filter((payment: any) => {
        const relation = Array.isArray(payment.personnel_contracts)
          ? payment.personnel_contracts[0]
          : payment.personnel_contracts;
        const paymentCompanyId = relation?.my_company_id || null;
        if (companyId) return !paymentCompanyId || paymentCompanyId === companyId;
        if (companyIds.length) return !paymentCompanyId || companyIds.includes(paymentCompanyId);
        return true;
      });
      const personnelPayments = visiblePersonnelPayments.filter((payment: any) => !payment.bank_transaction_id);
      const linkedPersonnelPayments = visiblePersonnelPayments.filter((payment: any) => Boolean(payment.bank_transaction_id));

      const structurallyValidKsefInvoices = (ksefResult.data || [])
        .filter((invoice) => invoice.sync_status !== 'error' && invoice.ksef_reference_number);
      const validKsefInvoices = structurallyValidKsefInvoices
        .filter((invoice) => isBankStatementMatchablePaymentMethod(invoice.payment_method, 'ksef'));
      const loadDocumentMatches = (column: 'invoice_id' | 'ksef_invoice_id' | 'external_invoice_id', ids: string[]) => (
        ids.length > 0
          ? supabase
            .from('bank_transaction_invoice_matches')
            .select(`${column},amount,document_amount`)
            .in(column, ids)
            .limit(2000)
          : Promise.resolve({ data: [], error: null })
      );
      const [crmMatchesResult, ksefMatchesResult, externalMatchesResult] = await Promise.all([
        loadDocumentMatches('invoice_id', (crmResult.data || []).map((invoice) => invoice.id)),
        loadDocumentMatches('ksef_invoice_id', validKsefInvoices.map((invoice) => invoice.id)),
        loadDocumentMatches('external_invoice_id', (externalResult.data || []).map((invoice) => invoice.id)),
      ]);
      const matchesError = crmMatchesResult.error || ksefMatchesResult.error || externalMatchesResult.error;
      if (matchesError) throw matchesError;
      const summedMatches = (
        rows: any[],
        idColumn: 'invoice_id' | 'ksef_invoice_id' | 'external_invoice_id',
        useDocumentAmount = false,
      ) => rows.reduce((totals, row) => {
        const documentId = row[idColumn];
        if (!documentId) return totals;
        const amount = Number(useDocumentAmount ? row.document_amount ?? row.amount : row.amount);
        totals.set(documentId, (totals.get(documentId) || 0) + (Number.isFinite(amount) ? amount : 0));
        return totals;
      }, new Map<string, number>());
      const crmBankMatchedAmounts = summedMatches(crmMatchesResult.data || [], 'invoice_id');
      const ksefBankMatchedAmounts = summedMatches(ksefMatchesResult.data || [], 'ksef_invoice_id');
      const externalBankMatchedAmounts = summedMatches(
        externalMatchesResult.data || [],
        'external_invoice_id',
        true,
      );
      const linkedCrmIds = new Set(structurallyValidKsefInvoices
        .map((invoice) => invoice.invoice_id)
        .filter(Boolean));
      const canonicalKsefKeys = new Set(structurallyValidKsefInvoices
        .filter((invoice) => invoice.invoice_type === 'issued')
        .map((invoice) => canonicalInvoiceKey({
          companyId: invoice.my_company_id,
          number: invoice.invoice_number,
          amount: invoice.gross_amount,
          counterparty: invoice.buyer_name,
        }))
        .filter(Boolean));
      const issuedKsefNumberKeys = new Set(structurallyValidKsefInvoices
        .filter((invoice) => invoice.invoice_type === 'issued')
        .map((invoice) => canonicalInvoiceNumberKey(invoice.my_company_id, invoice.invoice_number))
        .filter(Boolean));
      const duplicateCrmIds = new Set((crmResult.data || [])
        .filter((invoice) => (
          linkedCrmIds.has(invoice.id)
          || issuedKsefNumberKeys.has(canonicalInvoiceNumberKey(invoice.my_company_id, invoice.invoice_number))
          || canonicalKsefKeys.has(canonicalInvoiceKey({
            companyId: invoice.my_company_id,
            number: invoice.invoice_number,
            amount: invoice.total_gross,
            counterparty: invoice.buyer_name,
          }))
        ))
        .map((invoice) => invoice.id));
      const crmInvoicesById = new Map((crmResult.data || []).map((invoice) => [invoice.id, invoice]));
      const crmInvoicesByNumberKey = new Map((crmResult.data || [])
        .map((invoice) => [
          canonicalInvoiceNumberKey(invoice.my_company_id, invoice.invoice_number),
          invoice,
        ] as const)
        .filter(([key]) => Boolean(key)));
      const settlementDetails = (invoice: any, fallbackInvoice?: any) => {
        const summary = invoice?.settlement_summary || fallbackInvoice?.settlement_summary;
        const settledInvoices = Array.isArray(invoice?.settled_invoices)
          ? invoice.settled_invoices
          : Array.isArray(fallbackInvoice?.settled_invoices)
            ? fallbackInvoice.settled_invoices
            : [];
        const grossAmount = Math.abs(Number(
          invoice?.gross_amount ?? invoice?.total_gross ?? fallbackInvoice?.total_gross ?? 0,
        ));
        const summaryRemaining = summary?.remainingGross == null
          ? Number.NaN
          : Number(summary.remainingGross);
        const storedAmountToPay = invoice?.amount_to_pay_gross == null
          ? Number.NaN
          : Number(invoice.amount_to_pay_gross);
        const isFinal = fallbackInvoice?.invoice_type === 'final'
          || Boolean(summary && settledInvoices.length > 0);
        const amount = Math.abs(
          isFinal && Number.isFinite(summaryRemaining)
            ? summaryRemaining
            : Number.isFinite(storedAmountToPay)
              ? storedAmountToPay
              : grossAmount,
        );
        const settledAmount = Math.max(
          Number(summary?.settledGross ?? grossAmount - amount) || 0,
          0,
        );
        const settlementDocumentNumbers = settledInvoices
          .map((item: any) => String(item?.invoiceNumber || item?.invoice_number || '').trim())
          .filter(Boolean);
        const sourceDocumentNumbers = settledInvoices
          .map((item: any) => crmInvoicesById.get(item?.id))
          .map((advance: any) => advance?.related_invoice_id ? crmInvoicesById.get(advance.related_invoice_id) : null)
          .map((source: any) => String(source?.invoice_number || '').trim())
          .filter(Boolean);
        return {
          amount,
          grossAmount,
          settledAmount,
          documentKind: isFinal ? 'final' : String(fallbackInvoice?.invoice_type || ''),
          settlementDocumentNumbers: [...new Set(settlementDocumentNumbers)],
          sourceDocumentNumbers: [...new Set(sourceDocumentNumbers)],
        };
      };
      const rawDocuments = [
        ...validKsefInvoices
          .map((invoice) => {
            const linkedInvoice = invoice.invoice_id
              ? crmInvoicesById.get(invoice.invoice_id)
              : crmInvoicesByNumberKey.get(canonicalInvoiceNumberKey(
                invoice.my_company_id,
                invoice.invoice_number,
              ));
            const settlement = settlementDetails(invoice, linkedInvoice);
            const bankMatchedAmount = (ksefBankMatchedAmounts.get(invoice.id) || 0)
              + (linkedInvoice?.id ? crmBankMatchedAmounts.get(linkedInvoice.id) || 0 : 0);
            const issued = invoice.invoice_type === 'issued';
            const signedAmount = Number(invoice.amount_to_pay_gross ?? invoice.gross_amount ?? 0);
            return {
              id: invoice.id,
              companyId: invoice.my_company_id || 'bez-firmy',
              source: 'ksef' as const,
              number: invoice.invoice_number || invoice.ksef_reference_number || 'bez numeru',
              issueDate: invoice.issue_date || String(invoice.ksef_issued_at || '').slice(0, 10),
              dueDate: invoice.payment_due_date || '',
              direction: (issued ? signedAmount >= 0 ? 'credit' : 'debit' : signedAmount >= 0 ? 'debit' : 'credit') as Direction,
              ...settlement,
              amount: Math.max(settlement.amount - bankMatchedAmount, 0),
              settledAmount: settlement.settledAmount + bankMatchedAmount,
              currency: invoice.currency || 'PLN',
              counterparty: decodeTextEntities(issued ? invoice.buyer_name : invoice.seller_name),
              paymentStatus: invoice.payment_status || 'unpaid',
              requiresKsefReview: false,
              companyInferred: false,
              accountingNote: invoice.accounting_note || '',
            };
          }),
        ...(crmResult.data || [])
          .filter((invoice) => !duplicateCrmIds.has(invoice.id))
          .filter((invoice) => !['draft', 'cancelled', 'proforma'].includes(invoice.status))
          .filter((invoice) => invoice.invoice_type !== 'proforma')
          .filter((invoice) => isBankStatementMatchablePaymentMethod(invoice.payment_method, 'invoice'))
          .map((invoice) => {
            const settlement = settlementDetails(invoice);
            const bankMatchedAmount = crmBankMatchedAmounts.get(invoice.id) || 0;
            return {
              id: invoice.id,
              companyId: invoice.my_company_id || 'bez-firmy',
              source: 'crm' as const,
              number: invoice.invoice_number || 'bez numeru',
              issueDate: invoice.issue_date || '',
              dueDate: invoice.payment_due_date || '',
              direction: (invoice.invoice_type === 'corrective' && Number(invoice.total_gross) < 0 ? 'debit' : 'credit') as Direction,
              ...settlement,
              amount: Math.max(settlement.amount - bankMatchedAmount, 0),
              settledAmount: settlement.settledAmount + bankMatchedAmount,
              currency: invoice.currency_code || 'PLN',
              counterparty: invoice.buyer_name || '',
              paymentStatus: invoice.payment_status || invoice.status || 'unpaid',
              requiresKsefReview: !invoice.ksef_reference_number
                && !['accepted', 'sent', 'processing'].includes(String(invoice.ksef_status || '').toLowerCase()),
              companyInferred: false,
              accountingNote: invoice.accounting_note || '',
            };
          }),
        ...(externalResult.data || [])
          .filter((invoice) => invoice.payment_status !== 'cancelled')
          .filter((invoice) => isBankStatementMatchablePaymentMethod(invoice.payment_method, 'external'))
          .map((invoice) => {
            const grossAmount = Math.abs(Number(invoice.amount_gross || 0));
            const bankMatchedAmount = externalBankMatchedAmounts.get(invoice.id) || 0;
            return {
              id: invoice.id,
              companyId: invoice.my_company_id || inferredExternalCompanyId || 'bez-firmy',
              source: 'external' as const,
              number: invoice.invoice_number || 'bez numeru',
              issueDate: invoice.invoice_date || '',
              dueDate: '',
              direction: (Number(invoice.amount_gross || 0) >= 0 ? 'debit' : 'credit') as Direction,
              amount: Math.max(grossAmount - bankMatchedAmount, 0),
              grossAmount,
              settledAmount: bankMatchedAmount,
              currency: invoice.currency || 'PLN',
              counterparty: invoice.seller_name || '',
              paymentStatus: bankMatchedAmount > 0 ? 'partially_matched' : invoice.payment_status || 'unpaid',
              documentKind: 'external',
              settlementDocumentNumbers: [],
              sourceDocumentNumbers: [],
              requiresKsefReview: false,
              companyInferred: !invoice.my_company_id && Boolean(inferredExternalCompanyId),
              accountingNote: invoice.accounting_note || '',
            };
          }),
        ...visiblePersonnelPayments.map((payment: any) => {
          const contract = Array.isArray(payment.personnel_contracts)
            ? payment.personnel_contracts[0]
            : payment.personnel_contracts;
          const paymentType = String(payment.payment_type || 'other');
          const paymentLabel = personnelPaymentLabels[paymentType] || personnelPaymentLabels.other;
          const inferredCompany = contract?.my_company_id || inferredExternalCompanyId || 'bez-firmy';
          const isLinked = Boolean(payment.bank_transaction_id);
          const paymentAmount = Math.abs(Number(payment.amount || 0));
          return {
            id: payment.id,
            companyId: inferredCompany,
            source: 'personnel' as const,
            number: [contract?.contract_number || 'Umowa bez numeru', paymentLabel].join(' · '),
            issueDate: payment.payment_date || '',
            dueDate: payment.payment_date || '',
            direction: 'debit' as Direction,
            amount: isLinked ? 0 : paymentAmount,
            grossAmount: paymentAmount,
            settledAmount: isLinked ? paymentAmount : 0,
            currency: payment.currency || 'PLN',
            counterparty: payment.recipient_name || contract?.party_name || '',
            paymentStatus: isLinked ? 'już dopasowana' : 'do dopasowania',
            documentKind: `personnel_${paymentType}`,
            settlementDocumentNumbers: [],
            sourceDocumentNumbers: [],
            requiresKsefReview: false,
            companyInferred: !contract?.my_company_id && Boolean(inferredExternalCompanyId),
            accountingNote: payment.notes
              || [payment.title, contract?.title].filter(Boolean).join(' • '),
            linkedTransactionId: payment.bank_transaction_id || undefined,
          };
        }),
      ].filter((document) => (
        document.amount > 0
        || (document.source === 'personnel' && Boolean(document.linkedTransactionId))
      ));

      const unresolved = uniqueTransactionRows
        .map((transaction) => {
          const amount = Math.abs(Number(transaction.amount || 0));
          const remainingAmount = Math.max(amount - Number(transaction.allocated_amount || 0), 0);
          const transactionCompanyId = statementCompany.get(transaction.statement_id) || 'bez-firmy';
          const statement = statementMetadata.get(transaction.statement_id);
          const normalizedTransactionText = normalizeCounterpartyAlias(
            `${transaction.counterparty_name || ''} ${transaction.title || ''} ${transaction.raw_description || ''}`,
          );
          const matchedMapping = counterpartyMappings
            .filter((mapping) => !mapping.my_company_id || mapping.my_company_id === transactionCompanyId)
            .filter((mapping) => normalizedTransactionText.includes(
              mapping.normalized_alias || normalizeCounterpartyAlias(mapping.alias_pattern),
            ))
            .sort((left, right) => {
              const companyDifference = Number(right.my_company_id === transactionCompanyId)
                - Number(left.my_company_id === transactionCompanyId);
              if (companyDifference !== 0) return companyDifference;
              return right.normalized_alias.length - left.normalized_alias.length;
            })[0];
          return {
            id: transaction.id,
            companyId: transactionCompanyId,
            date: transaction.transaction_date || '',
            direction: transaction.transaction_type as Direction,
            amount,
            remainingAmount,
            currency: transaction.currency || 'PLN',
            counterparty: transaction.counterparty_name || '',
            title: parsedBankTransactionTitle(transaction.title, transaction.raw_description),
            referenceNumber: transaction.reference_number || '',
            rawDescription: transaction.raw_description || '',
            mappedCounterparty: matchedMapping?.counterparty_name || '',
            mappingAlias: matchedMapping?.alias_pattern || '',
            matchStatus: transaction.match_status || 'unmatched',
            accountingNote: transaction.accounting_note || '',
            accountingCategory: transaction.accounting_category || 'other',
            accountingReviewStatus: transaction.accounting_review_status === 'explained' ? 'explained' as const : 'pending' as const,
            privateTransferDetected: Boolean(transaction.private_transfer_detected),
            statementAccountType: statement?.account_type as BankStatementAccountType | null | undefined,
            statementImportFormat: statement?.import_format || statement?.file_type || null,
            statementFileName: statement?.file_name || null,
          };
        })
        .filter((transaction) => (
          !transaction.privateTransferDetected
          && transaction.accountingReviewStatus !== 'explained'
          && transaction.matchStatus !== 'matched'
          && transaction.remainingAmount > 0.009
        ))
        .sort((left, right) => right.remainingAmount - left.remainingAmount)
        .slice(0, 160);

      if (!unresolved.length && autoLinkedVatPairCount === 0) {
        throw new Error('Wszystkie transakcje z tego miesiąca są już rozliczone.');
      }

      const transactions: PreparedTransaction[] = unresolved.map((transaction, index) => ({
        id: transaction.id,
        ref: `T${index + 1}`,
        companyId: transaction.companyId === 'bez-firmy' ? '' : transaction.companyId,
        companyRef: companyRefs.get(transaction.companyId) || 'F0',
        date: transaction.date,
        direction: transaction.direction,
        amount: transaction.amount,
        remainingAmount: transaction.remainingAmount,
        currency: transaction.currency,
        counterparty: transaction.counterparty,
        title: transaction.title,
        referenceNumber: transaction.referenceNumber,
        rawDescription: transaction.rawDescription,
        mappedCounterparty: transaction.mappedCounterparty,
        mappingAlias: transaction.mappingAlias,
        accountingNote: transaction.accountingNote,
        accountingCategory: transaction.accountingCategory,
        accountingReviewStatus: transaction.accountingReviewStatus,
        statementAccountType: transaction.statementAccountType,
        statementImportFormat: transaction.statementImportFormat,
        statementFileName: transaction.statementFileName,
      }));
      const distanceFromAnalysedTransactions = (documentDate: string) => unresolved.reduce(
        (nearest, transaction) => Math.min(nearest, dateDistanceInDays(transaction.date, documentDate)),
        Number.POSITIVE_INFINITY,
      );
      const documents: PreparedDocument[] = rawDocuments
        .sort((left, right) => {
          const leftExactNumber = unresolved.some((transaction) => transactionContainsDocumentNumber(
            { title: transaction.title || '' },
            { number: left.number || '' },
          ));
          const rightExactNumber = unresolved.some((transaction) => transactionContainsDocumentNumber(
            { title: transaction.title || '' },
            { number: right.number || '' },
          ));
          if (leftExactNumber !== rightExactNumber) return Number(rightExactNumber) - Number(leftExactNumber);
          const distanceDifference = distanceFromAnalysedTransactions(left.issueDate)
            - distanceFromAnalysedTransactions(right.issueDate);
          if (Number.isFinite(distanceDifference) && distanceDifference !== 0) return distanceDifference;
          return right.issueDate.localeCompare(left.issueDate);
        })
        .slice(0, 600)
        .map((document, index) => ({
          id: document.id,
          ref: `D${index + 1}`,
          companyRef: companyRefs.get(document.companyId) || 'F0',
          source: document.source,
          number: document.number,
          issueDate: document.issueDate,
          dueDate: document.dueDate,
          direction: document.direction,
          amount: document.amount,
          grossAmount: document.grossAmount,
          settledAmount: document.settledAmount,
          currency: document.currency,
          counterparty: document.counterparty,
          paymentStatus: document.paymentStatus,
          documentKind: document.documentKind,
          settlementDocumentNumbers: document.settlementDocumentNumbers,
          sourceDocumentNumbers: document.sourceDocumentNumbers,
          requiresKsefReview: document.requiresKsefReview,
          companyInferred: document.companyInferred,
          accountingNote: document.accountingNote,
          linkedTransactionId: document.source === 'personnel'
            ? document.linkedTransactionId
            : undefined,
        }));

      const usedPersonnelDocumentRefs = new Set<string>();
      const personnelRelatedTransactionRefs = new Set<string>();
      const personnelTransactionsWithoutRecords = new Set<string>();
      const personnelSuggestions: AiAnalysis['likelyMatches'] = transactions.flatMap((transaction) => {
        const transactionText = normalizeCounterpartyAlias(
          `${transaction.counterparty} ${transaction.title} ${transaction.mappedCounterparty}`,
        );
        const hasPayrollKeyword = transaction.direction === 'debit' && [
          'WYNAGRODZEN',
          'PENSJ',
          'WYPLAT',
          'LISTAPLAC',
          'UMOWAZLECEN',
          'UMOWAODZIELO',
        ].some((keyword) => transactionText.includes(keyword));
        const relatedDocuments = documents
          .filter((document) => document.source === 'personnel')
          .filter((document) => !document.linkedTransactionId && document.amount > 0.009)
          .filter((document) => document.companyRef === transaction.companyRef)
          .filter((document) => document.direction === transaction.direction)
          .filter((document) => document.currency.toUpperCase() === transaction.currency.toUpperCase())
          .map((document) => {
            const contractNumber = normalizeCounterpartyAlias(document.number.split(' · ')[0]);
            const identityMatches = hasMerchantIdentityMatch(transaction, document);
            const contractMatches = contractNumber.length >= 4 && transactionText.includes(contractNumber);
            const dateDistance = dateDistanceInDays(transaction.date, document.issueDate);
            return { document, identityMatches, contractMatches, dateDistance };
          })
          .filter((item) => item.dateDistance <= 62 && (item.identityMatches || item.contractMatches));
        if (relatedDocuments.length > 0 || hasPayrollKeyword) {
          personnelRelatedTransactionRefs.add(transaction.ref);
        }
        if (hasPayrollKeyword && relatedDocuments.length === 0) {
          personnelTransactionsWithoutRecords.add(transaction.ref);
        }
        const candidate = relatedDocuments
          .filter((item) => !usedPersonnelDocumentRefs.has(item.document.ref))
          .map((item) => {
            const amountDifference = Math.abs(item.document.amount - transaction.remainingAmount);
            const amountMatches = amountDifference <= 0.01;
            const amountNearlyMatches = amountDifference <= 1;
            const eligible = amountMatches || amountNearlyMatches;
            const score = Number(amountMatches) * 5
              + Number(item.identityMatches) * 4
              + Number(item.contractMatches) * 4
              + Number(item.dateDistance <= 7) * 2
              + Number(item.dateDistance <= 31);
            return { ...item, eligible, score, amountMatches };
          })
          .filter((item) => item.eligible)
          .sort((left, right) => right.score - left.score)[0];
        if (!candidate) return [];
        usedPersonnelDocumentRefs.add(candidate.document.ref);
        const signals = [
          candidate.identityMatches ? 'odbiorca' : '',
          candidate.contractMatches ? 'numer umowy w tytule' : '',
          candidate.amountMatches ? 'identyczna kwota' : 'kwota różniąca się maksymalnie o 1 PLN',
        ].filter(Boolean).join(', ');
        return [{
          transactionRef: transaction.ref,
          documentRefs: [candidate.document.ref],
          confidence: candidate.amountMatches && candidate.identityMatches ? 'high' as const : 'medium' as const,
          reason: `Lokalne dopasowanie dokumentu kadrowego: ${signals}. Dane wynagrodzenia nie zostały wysłane do OpenAI.`,
          amountExplanation: `Przelew ${money(transaction.remainingAmount, transaction.currency)} porównano z zapisaną wypłatą ${money(candidate.document.amount, candidate.document.currency)}.`,
          recommendedAction: 'Porównaj odbiorcę, okres wynagrodzenia i numer umowy, a następnie zatwierdź powiązanie.',
        }];
      });
      const safeTransactions = transactions
        .filter((transaction) => !personnelRelatedTransactionRefs.has(transaction.ref))
        .map(({ id: _id, rawDescription: _rawDescription, referenceNumber: _referenceNumber, ...transaction }) => transaction);
      const safeDocuments = documents
        .filter((document) => document.source !== 'personnel')
        .map(({ id: _id, ...document }) => document);
      setAnalysisProgress({
        step: 5,
        totalSteps: 6,
        percent: 72,
        label: safeTransactions.length > 0 ? 'Analizuję możliwe powiązania' : 'Kończę analizę lokalną',
        detail: safeTransactions.length > 0
          ? `${safeTransactions.length} nierozliczonych transakcji porównuję z ${safeDocuments.length} dokumentami. Oczekuję na odpowiedź AI — ten etap nie udostępnia dokładnego procentu.`
          : 'Wszystkie pozostałe pozycje udało się sprawdzić lokalnie, bez wysyłania danych do AI.',
        indeterminate: safeTransactions.length > 0,
      });
      let parsedAnalysis: AiAnalysis = {
        summary: 'Pozycje kadrowe zostały sprawdzone lokalnie w CRM.',
        likelyMatches: [],
        missingDocuments: [],
        reviewTransactions: [],
        reviewDocuments: [],
        warnings: [],
      };
      if (safeTransactions.length > 0) {
        const { data: responseBody, error: analysisError } = await supabase.functions.invoke(
          'analyze-bank-reconciliation',
          {
            body: { month, year, transactions: safeTransactions, documents: safeDocuments },
          },
        );
        if (analysisError) {
          let details: any = null;
          const context = (analysisError as any)?.context;
          if (context && typeof context.json === 'function') {
            details = await context.json().catch(() => null);
          }
          throw new Error(details?.error || analysisError.message || 'Nie udało się przygotować analizy AI.');
        }
        if (!responseBody || responseBody.error) {
          throw new Error(responseBody?.error || 'Nie udało się przygotować analizy AI.');
        }
        parsedAnalysis = responseBody as AiAnalysis;
      }

      setAnalysisProgress({
        step: 6,
        totalSteps: 6,
        percent: 92,
        label: 'Porządkuję wynik',
        detail: 'Łączę wynik AI z dopasowaniami lokalnymi i przygotowuję listę do ręcznego zatwierdzenia.',
      });

      setMaps({
        transactions: new Map(transactions.map((transaction) => [transaction.ref, transaction])),
        documents: new Map(documents.map((document) => [document.ref, document])),
      });
      setSnapshotStats({
        transactions: transactions.length,
        debitTransactions: transactions.filter((transaction) => transaction.direction === 'debit').length,
        debitAmount: transactions
          .filter((transaction) => transaction.direction === 'debit')
          .reduce((sum, transaction) => sum + transaction.remainingAmount, 0),
        documents: documents.length,
        linkedPersonnelPayments: linkedPersonnelPayments.filter((payment: any) => (
          String(payment.payment_date || '').startsWith(`${year}-${String(month).padStart(2, '0')}`)
        )).length,
      });
      const documentsByRef = new Map(documents.map((document) => [document.ref, document]));
      const transactionsByRef = new Map(transactions.map((transaction) => [transaction.ref, transaction]));
      const usedExactNumberDocumentRefs = new Set<string>();
      const exactNumberSuggestions: AiAnalysis['likelyMatches'] = transactions.flatMap((transaction) => {
        if (personnelRelatedTransactionRefs.has(transaction.ref)) return [];
        const candidate = documents
          .filter((document) => document.source !== 'personnel')
          .filter((document) => !usedExactNumberDocumentRefs.has(document.ref))
          .filter((document) => document.companyRef === transaction.companyRef)
          .filter((document) => document.direction === transaction.direction)
          .filter((document) => document.currency.toUpperCase() === transaction.currency.toUpperCase())
          .filter((document) => transactionContainsDocumentNumber(transaction, document))
          .sort((left, right) => {
            const amountDifference = Number(Math.abs(right.amount - transaction.remainingAmount) <= 0.01)
              - Number(Math.abs(left.amount - transaction.remainingAmount) <= 0.01);
            if (amountDifference !== 0) return amountDifference;
            const counterpartyDifference = Number(hasMerchantIdentityMatch(transaction, right))
              - Number(hasMerchantIdentityMatch(transaction, left));
            if (counterpartyDifference !== 0) return counterpartyDifference;
            const leftAfterPayment = daysDocumentIssuedAfterPayment(transaction, left);
            const rightAfterPayment = daysDocumentIssuedAfterPayment(transaction, right);
            const chronologyDifference = Number(leftAfterPayment != null && leftAfterPayment > 7)
              - Number(rightAfterPayment != null && rightAfterPayment > 7);
            if (chronologyDifference !== 0) return chronologyDifference;
            return dateDistanceInDays(transaction.date, left.issueDate)
              - dateDistanceInDays(transaction.date, right.issueDate);
          })[0];
        if (!candidate) return [];
        usedExactNumberDocumentRefs.add(candidate.ref);
        const amountMatches = Math.abs(candidate.amount - transaction.remainingAmount) <= 0.01;
        const counterpartyMatches = hasMerchantIdentityMatch(transaction, candidate);
        return [{
          transactionRef: transaction.ref,
          documentRefs: [candidate.ref],
          confidence: amountMatches && counterpartyMatches ? 'high' as const : 'medium' as const,
          reason: `Numer dokumentu ${candidate.number} występuje w tytule przelewu. ${counterpartyMatches ? 'Kontrahent również jest zgodny.' : 'Kontrahenta trzeba dodatkowo potwierdzić.'}`,
          amountExplanation: amountMatches
            ? `Płatność i dokument mają identyczną pozostałą kwotę ${money(transaction.remainingAmount, transaction.currency)}.`
            : `Numer dokumentu jest zgodny, ale płatność ${money(transaction.remainingAmount, transaction.currency)} różni się od kwoty dokumentu ${money(candidate.amount, candidate.currency)}; możliwa jest płatność częściowa lub zbiorcza.`,
          recommendedAction: 'Sprawdź numer dokumentu, kontrahenta i kwotę, a następnie zatwierdź właściwą alokację.',
        }];
      });
      const exactNumberTransactionRefs = new Set(exactNumberSuggestions.map((item) => item.transactionRef));
      const parsedLikelyMatches: AiAnalysis['likelyMatches'] = (parsedAnalysis.likelyMatches || [])
        .flatMap((item) => {
          const transaction = transactionsByRef.get(item.transactionRef);
          if (!transaction || exactNumberTransactionRefs.has(item.transactionRef)) return [];
          const plausibleDocumentRefs = item.documentRefs.filter((ref) => {
            const document = documentsByRef.get(ref);
            if (!document) return false;
            if (transactionContainsDocumentNumber(transaction, document)) return true;
            const issuedAfterPayment = daysDocumentIssuedAfterPayment(transaction, document);
            return issuedAfterPayment == null || issuedAfterPayment <= 7;
          });
          return plausibleDocumentRefs.length > 0 ? [{ ...item, documentRefs: plausibleDocumentRefs }] : [];
        });
      const usedCurrencyDocumentRefs = new Set<string>(
        exactNumberSuggestions.flatMap((item) => item.documentRefs),
      );
      const currencySuggestions: AiAnalysis['likelyMatches'] = transactions.flatMap((transaction) => {
        if (exactNumberTransactionRefs.has(transaction.ref)) return [];
        const candidates = documents
          .filter((document) => isExternalCurrencyCandidate(transaction, document))
          .filter((document) => !usedCurrencyDocumentRefs.has(document.ref))
          .sort((left, right) => dateDistanceInDays(transaction.date, left.issueDate)
            - dateDistanceInDays(transaction.date, right.issueDate));
        const document = candidates[0];
        if (!document) return [];
        usedCurrencyDocumentRefs.add(document.ref);
        const rate = transaction.remainingAmount / document.amount;
        return [{
          transactionRef: transaction.ref,
          documentRefs: [document.ref],
          confidence: 'medium' as const,
          reason: `Nazwa sprzedawcy ${document.counterparty || sourceLabel(document.source)} występuje w tytule płatności, a dokument pochodzi z sekcji spoza KSeF.`,
          amountExplanation: `Płatność ${money(transaction.remainingAmount, transaction.currency)} może odpowiadać fakturze ${money(document.amount, document.currency)} po przewalutowaniu (kurs wynikowy ${rate.toFixed(4)} ${transaction.currency}/${document.currency}).`,
          recommendedAction: 'Porównaj PDF i datę obciążenia, a następnie ręcznie zatwierdź obie kwoty oraz kurs przewalutowania.',
        }];
      });
      const personnelTransactionRefs = new Set(personnelSuggestions.map((item) => item.transactionRef));
      const missingPersonnelDocuments: AiAnalysis['missingDocuments'] = Array.from(personnelTransactionsWithoutRecords)
        .map((transactionRef) => ({
          transactionRef,
          documentType: 'payroll' as const,
          priority: 'high' as const,
          reason: 'Tytuł przelewu wskazuje na wynagrodzenie, ale w rejestrze umów nie znaleziono odpowiadającej wypłaty.',
          recommendedAction: 'Dodaj wynagrodzenie do właściwej umowy albo sprawdź odbiorcę i okres płatności.',
        }));
      const personnelTransactionReviews: AiAnalysis['reviewTransactions'] = Array.from(personnelRelatedTransactionRefs)
        .filter((transactionRef) => !personnelTransactionRefs.has(transactionRef))
        .filter((transactionRef) => !personnelTransactionsWithoutRecords.has(transactionRef))
        .map((transactionRef) => ({
          transactionRef,
          priority: 'medium' as const,
          reason: 'Rozpoznano odbiorcę lub numer umowy, ale kwota przelewu nie odpowiada zapisanej wypłacie.',
          recommendedAction: 'Sprawdź kwotę netto, zaliczkę, potrącenia albo wybierz właściwy zapis wynagrodzenia.',
        }));
      const analysedMonthPrefix = `${year}-${String(month).padStart(2, '0')}`;
      const unmatchedPersonnelReviews: AiAnalysis['reviewDocuments'] = documents
        .filter((document) => document.source === 'personnel')
        .filter((document) => !document.linkedTransactionId)
        .filter((document) => document.issueDate.startsWith(analysedMonthPrefix))
        .filter((document) => !usedPersonnelDocumentRefs.has(document.ref))
        .map((document) => ({
          documentRef: document.ref,
          priority: 'medium' as const,
          reason: `${personnelPaymentLabels[document.documentKind.replace('personnel_', '')] || 'Opłata kadrowa'} nie ma jednoznacznego przelewu w analizowanym wyciągu.`,
          recommendedAction: 'Sprawdź odbiorcę, datę i tytuł przelewu albo wybierz właściwą płatność ręcznie.',
      }));
      const currencyTransactionRefs = new Set(currencySuggestions.map((item) => item.transactionRef));
      const alreadySuggestedTransactionRefs = new Set([
        ...personnelTransactionRefs,
        ...exactNumberTransactionRefs,
        ...currencyTransactionRefs,
        ...parsedLikelyMatches.map((item) => item.transactionRef),
      ]);
      const reservedDocumentRefs = new Set([
        ...personnelSuggestions.flatMap((item) => item.documentRefs),
        ...exactNumberSuggestions.flatMap((item) => item.documentRefs),
        ...currencySuggestions.flatMap((item) => item.documentRefs),
        ...parsedLikelyMatches.flatMap((item) => item.documentRefs),
      ]);
      const amountOnlySuggestions: AiAnalysis['likelyMatches'] = transactions.flatMap((transaction) => {
        if (alreadySuggestedTransactionRefs.has(transaction.ref)) return [];
        const candidate = documents
          .filter((document) => document.source !== 'personnel')
          .filter((document) => !reservedDocumentRefs.has(document.ref))
          .filter((document) => document.companyRef === transaction.companyRef)
          .filter((document) => document.direction === transaction.direction)
          .filter((document) => document.currency.toUpperCase() === transaction.currency.toUpperCase())
          .filter((document) => Math.abs(document.amount - transaction.remainingAmount) <= 0.01)
          .filter((document) => {
            const issuedAfterPayment = daysDocumentIssuedAfterPayment(transaction, document);
            return issuedAfterPayment == null || issuedAfterPayment <= 7;
          })
          .sort((left, right) => {
            const merchantDifference = Number(hasMerchantIdentityMatch(transaction, right))
              - Number(hasMerchantIdentityMatch(transaction, left));
            if (merchantDifference !== 0) return merchantDifference;
            return dateDistanceInDays(transaction.date, left.issueDate)
              - dateDistanceInDays(transaction.date, right.issueDate);
          })[0];
        if (!candidate) return [];
        reservedDocumentRefs.add(candidate.ref);
        const merchantMatches = hasMerchantIdentityMatch(transaction, candidate);
        return [{
          transactionRef: transaction.ref,
          documentRefs: [candidate.ref],
          confidence: merchantMatches ? 'medium' as const : 'low' as const,
          reason: merchantMatches
            ? 'Kwota dokumentu jest identyczna z pozostałą kwotą płatności, a nazwa zawiera wspólny element.'
            : 'Kwota dokumentu jest identyczna z pozostałą kwotą płatności, ale nazwa kontrahenta nie potwierdza dopasowania.',
          amountExplanation: `Płatność i dokument mają wartość ${money(transaction.remainingAmount, transaction.currency)}. Dokument wybrano jako najbliższy datą spośród zgodnych kwotowo pozycji.`,
          recommendedAction: 'Sprawdź kontrahenta, numer dokumentu i datę. Zgodność samej kwoty nie wystarcza do zatwierdzenia.',
        }];
      });
      const amountOnlyTransactionRefs = new Set(amountOnlySuggestions.map((item) => item.transactionRef));
      const existingReviewRefs = new Set(
        (parsedAnalysis.reviewDocuments || []).map((item) => item.documentRef),
      );
      const missingKsefReviews: AiAnalysis['reviewDocuments'] = documents
        .filter((document) => document.source === 'crm' && document.requiresKsefReview)
        .filter((document) => !existingReviewRefs.has(document.ref))
        .map((document) => ({
          documentRef: document.ref,
          priority: 'high' as const,
          reason: 'Dokument sprzedażowy jest w CRM, ale w pobranych danych nie ma potwierdzonego odpowiednika KSeF.',
          recommendedAction: 'Sprawdź status wysyłki do KSeF albo udokumentowane wyłączenie z obowiązku.',
        }));
      const refreshedAnalysis: AiAnalysis = {
        ...parsedAnalysis,
        summary: [
          parsedAnalysis.summary,
          documents.some((document) => document.source === 'personnel')
            ? `Rejestr kadrowy sprawdzono lokalnie: ${personnelSuggestions.length} ${personnelSuggestions.length === 1 ? 'propozycja' : 'propozycji'} dopasowania.`
            : '',
          autoLinkedVatPairCount > 0
            ? `Automatycznie połączono jednoznaczne transfery rachunek bieżący ↔ VAT (${autoLinkedVatPairCount}).`
            : '',
        ].filter(Boolean).join(' '),
        likelyMatches: [
          ...personnelSuggestions,
          ...exactNumberSuggestions,
          ...currencySuggestions,
          ...amountOnlySuggestions,
          ...parsedLikelyMatches.filter((item) => (
            !personnelTransactionRefs.has(item.transactionRef)
            && !exactNumberTransactionRefs.has(item.transactionRef)
            && !currencyTransactionRefs.has(item.transactionRef)
            && !amountOnlyTransactionRefs.has(item.transactionRef)
          )),
        ].slice(0, 40),
        missingDocuments: [
          ...missingPersonnelDocuments,
          ...(parsedAnalysis.missingDocuments || [])
            .filter((item) => !personnelRelatedTransactionRefs.has(item.transactionRef))
            .filter((item) => !exactNumberTransactionRefs.has(item.transactionRef))
            .filter((item) => !currencyTransactionRefs.has(item.transactionRef))
            .filter((item) => !amountOnlyTransactionRefs.has(item.transactionRef)),
        ],
        reviewTransactions: [
          ...personnelTransactionReviews,
          ...(parsedAnalysis.reviewTransactions || [])
            .filter((item) => !personnelRelatedTransactionRefs.has(item.transactionRef))
            .filter((item) => !exactNumberTransactionRefs.has(item.transactionRef))
            .filter((item) => !currencyTransactionRefs.has(item.transactionRef))
            .filter((item) => !amountOnlyTransactionRefs.has(item.transactionRef)),
        ],
        reviewDocuments: [
          ...missingKsefReviews,
          ...unmatchedPersonnelReviews,
          ...(parsedAnalysis.reviewDocuments || []),
        ].slice(0, 60),
        warnings: [
          ...(parsedAnalysis.warnings || []),
          ...(autoVatPairingWarning ? [autoVatPairingWarning] : []),
        ],
      };
      setAnalysis(refreshedAnalysis);
      setAnalysisSavedAt(null);
      setAnalysisStale(false);
      setSelectedMatchIndex(0);
      setMatchedKeys(new Set());
      setAnalysisProgress({
        step: 6,
        totalSteps: 6,
        percent: 100,
        label: 'Analiza zakończona',
        detail: autoLinkedVatPairCount > 0
          ? `Wynik jest gotowy. Automatycznie zamknięto transfery VAT (${autoLinkedVatPairCount}).`
          : 'Wynik jest gotowy do wyświetlenia i zapisania w CRM.',
      });
    } catch (error: any) {
      console.error('Bank AI analysis error:', error);
      showSnackbar(error?.message || 'Nie udało się przygotować analizy AI.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadOtherMonthsTransactions = async ({ notify = true }: { notify?: boolean } = {}) => {
    try {
      setOtherMonthsLoading(true);
      const currentCompanyIds = [...new Set(Array.from(maps.transactions.values())
        .map((transaction) => transaction.companyId)
        .filter(Boolean))];
      let statementsQuery = supabase
        .from('bank_statements')
        .select('id,my_company_id,statement_month,statement_year,account_type,account_number,import_format,file_type,file_name')
        .gte('statement_year', year - 1)
        .lte('statement_year', year + 1)
        .eq('processed', true)
        .eq('validation_status', 'valid');
      if (companyId) {
        statementsQuery = statementsQuery.eq('my_company_id', companyId);
      } else if (currentCompanyIds.length) {
        statementsQuery = statementsQuery.in('my_company_id', currentCompanyIds);
      } else {
        statementsQuery = statementsQuery.is('my_company_id', null);
      }
      const { data: statements, error: statementsError } = await statementsQuery;
      if (statementsError) throw statementsError;

      const surroundingStatements = (statements || []).filter((statement) => {
        const distance = Math.abs(
          (Number(statement.statement_year) * 12 + Number(statement.statement_month))
          - (year * 12 + month),
        );
        return distance <= 12;
      });
      const statementIds = surroundingStatements.map((statement) => statement.id);
      if (statementIds.length === 0) {
        if (notify) showSnackbar('Nie ma poprawnie wgranych wyciągów w zakresie 12 miesięcy.', 'info');
        return [] as PreparedTransaction[];
      }

      const transactionRows: any[] = [];
      const pageSize = 1000;
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabase
          .from('bank_transactions')
          .select('id,statement_id,transaction_date,amount,currency,transaction_type,counterparty_name,counterparty_account,title,reference_number,raw_description,match_status,allocated_amount,accounting_note,accounting_category,accounting_review_status,private_transfer_detected')
          .in('statement_id', statementIds)
          .order('transaction_date', { ascending: false })
          .range(from, from + pageSize - 1);
        if (error) throw error;
        transactionRows.push(...(data || []));
        if (!data || data.length < pageSize) break;
      }

      const statementCompanies = new Map(
        surroundingStatements.map((statement) => [statement.id, statement.my_company_id || '']),
      );
      const statementMetadata = new Map(
        surroundingStatements.map((statement) => [statement.id, statement]),
      );
      const uniqueTransactionRows = deduplicateStatementTransactions(
        transactionRows,
        statementMetadata,
      );
      const companyRefs = new Map<string, string>();
      Array.from(maps.transactions.values()).forEach((transaction) => {
        if (transaction.companyId) companyRefs.set(transaction.companyId, transaction.companyRef);
      });
      const existingRefsById = new Map(
        Array.from(maps.transactions.entries()).map(([ref, transaction]) => [transaction.id, ref]),
      );
      const maxRefNumber = Array.from(maps.transactions.keys()).reduce((maximum, ref) => {
        const value = Number(ref.replace(/^T/, ''));
        return Number.isFinite(value) ? Math.max(maximum, value) : maximum;
      }, 0);
      let nextRefNumber = maxRefNumber + 1;
      const refreshedTransactions: PreparedTransaction[] = uniqueTransactionRows
        .map((transaction) => {
          const amount = Math.abs(Number(transaction.amount || 0));
          const remainingAmount = Math.max(amount - Number(transaction.allocated_amount || 0), 0);
          const transactionCompanyId = statementCompanies.get(transaction.statement_id) || '';
          const statement = statementMetadata.get(transaction.statement_id);
          return {
            id: transaction.id,
            companyId: transactionCompanyId,
            companyRef: companyRefs.get(transactionCompanyId) || (transactionCompanyId ? 'F1' : 'F0'),
            date: transaction.transaction_date || '',
            direction: transaction.transaction_type as Direction,
            amount,
            remainingAmount,
            currency: transaction.currency || 'PLN',
            counterparty: transaction.counterparty_name || '',
            title: parsedBankTransactionTitle(transaction.title, transaction.raw_description),
            referenceNumber: transaction.reference_number || '',
            rawDescription: transaction.raw_description || '',
            mappedCounterparty: '',
            mappingAlias: '',
            accountingNote: transaction.accounting_note || '',
            accountingCategory: transaction.accounting_category || 'other',
            accountingReviewStatus: transaction.accounting_review_status === 'explained'
              ? 'explained' as const
              : 'pending' as const,
            matchStatus: transaction.match_status || 'unmatched',
            privateTransferDetected: Boolean(transaction.private_transfer_detected),
            statementAccountType: statement?.account_type as BankStatementAccountType | null | undefined,
            statementImportFormat: statement?.import_format || statement?.file_type || null,
            statementFileName: statement?.file_name || null,
          };
        })
        .filter((transaction) => !transaction.privateTransferDetected)
        .filter((transaction) => transaction.accountingReviewStatus !== 'explained')
        .filter((transaction) => transaction.matchStatus !== 'matched' && transaction.remainingAmount > 0.009)
        .sort((left, right) => right.date.localeCompare(left.date))
        .map(({ matchStatus: _matchStatus, privateTransferDetected: _private, ...transaction }) => ({
          ...transaction,
          ref: existingRefsById.get(transaction.id) || `T${nextRefNumber++}`,
        }));

      const refreshedIds = new Set(refreshedTransactions.map((transaction) => transaction.id));
      setMaps((current) => {
        const transactions = new Map(current.transactions);
        transactions.forEach((transaction, ref) => {
          const [transactionYear, transactionMonth] = transaction.date
            .slice(0, 7)
            .split('-')
            .map(Number);
          const distance = Number.isFinite(transactionYear) && Number.isFinite(transactionMonth)
            ? Math.abs((transactionYear * 12 + transactionMonth) - (year * 12 + month))
            : Number.POSITIVE_INFINITY;
          const sameScope = companyId
            ? transaction.companyId === companyId
            : currentCompanyIds.length === 0 || currentCompanyIds.includes(transaction.companyId);
          if (distance <= 12 && sameScope && !refreshedIds.has(transaction.id)) {
            transactions.delete(ref);
          }
        });
        refreshedTransactions.forEach((transaction) => transactions.set(transaction.ref, transaction));
        return { ...current, transactions };
      });
      if (notify) {
        const otherMonthsCount = refreshedTransactions.filter((transaction) => (
          !belongsToAnalysedMonth(transaction.date, year, month)
        )).length;
        showSnackbar(
          otherMonthsCount > 0
            ? `Odświeżono ${otherMonthsCount} nierozliczonych płatności z innych miesięcy.`
            : 'W innych miesiącach nie znaleziono nierozliczonych płatności.',
          'info',
        );
      }
      return refreshedTransactions;
    } catch (error: any) {
      showSnackbar(error?.message || 'Nie udało się pobrać płatności z innych miesięcy.', 'error');
      return [] as PreparedTransaction[];
    } finally {
      setOtherMonthsLoading(false);
    }
  };

  const matchDocument = async (
    transactionRef: string,
    documentRef: string,
    { allowDirect = false }: { allowDirect?: boolean } = {},
  ) => {
    const transaction = maps.transactions.get(transactionRef);
    const document = maps.documents.get(documentRef);
    if (!transaction || !document) {
      showSnackbar('Nie udało się odnaleźć transakcji lub dokumentu.', 'error');
      return;
    }

    const key = `${transactionRef}:${documentRef}`;
    try {
      setMatchingKey(key);
      const candidates = await findBankTransactionMatchCandidates(supabase, transaction.id);
      const documentSource = document.source === 'crm' ? 'invoice' : document.source;
      const candidate = candidates.find((item) =>
        item.documentId === document.id && item.documentSource === documentSource,
      );
      const replacesManualKsefPayment =
        !candidate
        && documentSource === 'ksef'
        && document.paymentStatus.toLowerCase() === 'paid';
      const reconcilesExternalDocument = documentSource === 'external' && (
        !candidate
        || document.paymentStatus.toLowerCase() === 'paid'
        || document.companyInferred
        || document.currency.toUpperCase() !== transaction.currency.toUpperCase()
      );
      const reconcilesPersonnelPayment = documentSource === 'personnel';
      if (!candidate && !replacesManualKsefPayment && !reconcilesExternalDocument && !reconcilesPersonnelPayment && !allowDirect) {
        throw new Error('Dokument nie jest już dostępny do bezpiecznego dopasowania. Odśwież analizę lub sprawdź jego status płatności.');
      }

      const isDifferentCurrency = document.currency.toUpperCase() !== transaction.currency.toUpperCase();
      const proposedAmount = reconcilesPersonnelPayment
        ? document.amount
        : isDifferentCurrency && documentSource === 'external'
          ? transaction.remainingAmount
          : Math.min(transaction.remainingAmount, candidate?.outstandingAmount ?? document.amount);
      if (reconcilesPersonnelPayment && proposedAmount > transaction.remainingAmount + 0.01) {
        throw new Error('Kwota zapisanej wypłaty przekracza pozostałą kwotę przelewu. Wybierz inną płatność albo popraw zapis wynagrodzenia.');
      }
      let matchResult: any = null;
      if (reconcilesPersonnelPayment) {
        matchResult = await reconcilePersonnelPaymentWithBankTransaction(supabase, {
          transactionId: transaction.id,
          personnelPaymentId: document.id,
          amount: proposedAmount,
          confidence: 1,
          reasons: [allowDirect
            ? 'Dokument kadrowy i płatność wybrane ręcznie przez użytkownika'
            : 'Dopasowanie wynagrodzenia zatwierdzone przez użytkownika na podstawie analizy lokalnej'],
        });
      } else if (replacesManualKsefPayment) {
        matchResult = await reconcilePaidKsefInvoiceWithBankTransaction(supabase, {
          transactionId: transaction.id,
          ksefInvoiceId: document.id,
          amount: proposedAmount,
          confidence: 1,
          reasons: [
            allowDirect
              ? 'Inna płatność wybrana ręcznie przez użytkownika'
              : 'Dopasowanie zatwierdzone przez użytkownika na podstawie analizy AI',
          ],
        });
      } else if (reconcilesExternalDocument) {
        matchResult = await reconcileExternalInvoiceWithBankTransaction(supabase, {
          transactionId: transaction.id,
          externalInvoiceId: document.id,
          transactionAmount: proposedAmount,
          documentAmount: isDifferentCurrency ? document.amount : Math.min(document.amount, proposedAmount),
          confidence: 1,
          reasons: [
            isDifferentCurrency
              ? 'Ręcznie zatwierdzone dopasowanie dokumentu walutowego po przewalutowaniu'
              : 'Ręcznie zatwierdzone dopasowanie dokumentu spoza KSeF',
          ],
        });
      } else if (candidate) {
        matchResult = await applyBankTransactionMatch(supabase, {
          transactionId: transaction.id,
          candidate,
          amount: proposedAmount,
          method: 'manual',
        });
      } else {
        matchResult = await applyBankTransactionMatchToDocument(supabase, {
          transactionId: transaction.id,
          documentSource,
          documentId: document.id,
          amount: null,
          confidence: 1,
          method: 'manual',
          reasons: ['Inna płatność wybrana ręcznie przez użytkownika'],
        });
      }

      const returnedAmount = Number(matchResult?.amount);
      const amount = Number.isFinite(returnedAmount) && returnedAmount > 0
        ? returnedAmount
        : proposedAmount;
      const nextMatchedKeys = new Set(matchedKeys).add(key);
      const remainingAfterMatch = Math.max(transaction.remainingAmount - amount, 0);
      setMatchedKeys(nextMatchedKeys);
      setMaps((current) => {
        const nextTransactions = new Map(current.transactions);
        const nextDocuments = new Map(current.documents);
        nextTransactions.set(transactionRef, {
          ...transaction,
          remainingAmount: remainingAfterMatch,
        });
        const documentAmountReduction = document.source === 'personnel'
          || document.currency.toUpperCase() !== transaction.currency.toUpperCase()
          ? document.amount
          : Math.min(amount, document.amount);
        const remainingDocumentAmount = Math.max(document.amount - documentAmountReduction, 0);
        nextDocuments.set(documentRef, {
          ...document,
          amount: remainingDocumentAmount,
          settledAmount: document.settledAmount + documentAmountReduction,
          paymentStatus: remainingDocumentAmount <= 0.009 ? 'paid' : 'partially_paid',
        });
        return { transactions: nextTransactions, documents: nextDocuments };
      });

      if (analysis) {
        const isPending = (matchIndex: number) => {
          const match = analysis.likelyMatches[matchIndex];
          if (!match) return false;
          const matchTransaction = maps.transactions.get(match.transactionRef);
          const remaining = match.transactionRef === transactionRef
            ? remainingAfterMatch
            : matchTransaction?.remainingAmount || 0;
          return remaining > 0.009
            && match.documentRefs.some((ref) => !isDocumentConfirmed(ref, nextMatchedKeys));
        };

        if (!isPending(selectedMatchIndex)) {
          const orderedIndexes = analysis.likelyMatches.map((_, index) => index);
          const nextIndex = [
            ...orderedIndexes.filter((index) => index > selectedMatchIndex),
            ...orderedIndexes.filter((index) => index < selectedMatchIndex),
          ].find(isPending);
          if (nextIndex !== undefined) setSelectedMatchIndex(nextIndex);
        }
      }
      showSnackbar(
        reconcilesPersonnelPayment
          ? `Powiązano dokument kadrowy z płatnością ${money(amount, transaction.currency)}`
          : replacesManualKsefPayment
          ? `Powiązano z przelewem ${money(amount, transaction.currency)} bez podwójnego naliczenia`
          : reconcilesExternalDocument
            ? `Powiązano dokument spoza KSeF z płatnością ${money(amount, transaction.currency)}`
            : `Rozliczono ${money(amount, candidate?.currency || document.currency)}`,
        'success',
      );
      await onMatchApplied?.();
    } catch (error: any) {
      console.error('AI suggestion matching error:', error);
      showSnackbar(error?.message || 'Nie udało się zapisać dopasowania.', 'error');
    } finally {
      setMatchingKey(null);
    }
  };

  const selectedMatch = manualMatch || analysis?.likelyMatches[selectedMatchIndex] || null;

  useEffect(() => {
    setSelectedTransactionRef(selectedMatch?.transactionRef || null);
    setShowTransactionPicker(false);
    setSearchOtherMonths(false);
    setTransactionSearch('');
    setDocumentSearch('');
    setDocumentFiltersOpen(false);
    setDocumentSourceFilter('all');
    setDocumentPaymentFilter('all');
    setDocumentDateFrom('');
    setDocumentDateTo('');
    setSelectedDocumentRefs(new Set(
      manualMatch
        ? []
        : selectedMatch?.documentRefs.filter((ref) => !isDocumentConfirmed(ref, matchedKeys)) || [],
    ));
    setMatchNeedsExplanation(false);
    setMatchExplanation('');
  }, [analysis, manualMatch, selectedMatchIndex, selectedMatch?.transactionRef]);

  const selectedTransaction = selectedTransactionRef
    ? maps.transactions.get(selectedTransactionRef)
    : selectedMatch
      ? maps.transactions.get(selectedMatch.transactionRef)
      : undefined;
  const pendingMatches = analysis?.likelyMatches
    .map((match, index) => ({ match, index }))
    .filter(({ match }) => {
      const transaction = maps.transactions.get(match.transactionRef);
      return Boolean(
        transaction
        && transaction.remainingAmount > 0.009
        && match.documentRefs.some((ref) => !isDocumentConfirmed(ref, matchedKeys)),
      );
    }) || [];
  const confirmedPairs = Array.from(matchedKeys).flatMap((key) => {
    const separator = key.indexOf(':');
    if (separator < 1) return [];
    const transactionRef = key.slice(0, separator);
    const documentRef = key.slice(separator + 1);
    if (!maps.transactions.has(transactionRef) || !maps.documents.has(documentRef)) return [];
    return [{ transactionRef, documentRef }];
  });
  const pickerDocument = selectedMatch?.documentRefs
    .map((ref) => maps.documents.get(ref))
    .find((document) => document && !isDocumentConfirmed(document.ref, matchedKeys));
  const matchesSelectedPaymentAmount = (document: PreparedDocument) => Boolean(
    selectedTransaction
    && document.companyRef === selectedTransaction.companyRef
    && document.direction === selectedTransaction.direction
    && document.currency.toUpperCase() === selectedTransaction.currency.toUpperCase()
    && Math.abs(document.amount - selectedTransaction.remainingAmount) <= 0.01,
  );
  const availableDocumentRefs = (() => {
    if (!selectedMatch) return [] as string[];
    if (manualMatch) return selectedMatch.documentRefs;
    const suggestedDocuments = selectedMatch.documentRefs
      .map((ref) => maps.documents.get(ref))
      .filter((document): document is PreparedDocument => Boolean(document));
    if (suggestedDocuments.length === 0) return selectedMatch.documentRefs;
    const suggestedRefs = new Set(selectedMatch.documentRefs);
    const alternatives = Array.from(maps.documents.values())
      .filter((document) => !suggestedRefs.has(document.ref))
      .filter((document) => !isDocumentConfirmed(document.ref, matchedKeys))
      .filter((document) => (
        matchesSelectedPaymentAmount(document)
        || suggestedDocuments.some((suggested) => (
          document.source === suggested.source
          && document.companyRef === suggested.companyRef
          && document.direction === suggested.direction
          && document.currency.toUpperCase() === suggested.currency.toUpperCase()
          && Math.abs(document.amount - suggested.amount) <= 0.01
          && hasSameDocumentCounterparty(document, suggested)
        ))
      ))
      .sort((left, right) => {
        if (selectedTransaction) {
          const exactNumberDifference = Number(transactionContainsDocumentNumber(selectedTransaction, right))
            - Number(transactionContainsDocumentNumber(selectedTransaction, left));
          if (exactNumberDifference !== 0) return exactNumberDifference;
        }
        const exactPaymentDifference = Number(matchesSelectedPaymentAmount(right))
          - Number(matchesSelectedPaymentAmount(left));
        if (exactPaymentDifference !== 0) return exactPaymentDifference;
        const counterpartyDifference = Number(suggestedDocuments.some((suggested) => hasSameDocumentCounterparty(right, suggested)))
          - Number(suggestedDocuments.some((suggested) => hasSameDocumentCounterparty(left, suggested)));
        if (counterpartyDifference !== 0) return counterpartyDifference;
        if (!selectedTransaction) return right.issueDate.localeCompare(left.issueDate);
        return dateDistanceInDays(selectedTransaction.date, left.issueDate)
          - dateDistanceInDays(selectedTransaction.date, right.issueDate);
      })
      .slice(0, 60)
      .map((document) => document.ref);
    return [...new Set([...selectedMatch.documentRefs, ...alternatives])]
      .filter((ref) => {
        const document = maps.documents.get(ref);
        return Boolean(
          document
          && document.amount > 0.009
          && !isDocumentConfirmed(ref, matchedKeys),
        );
      });
  })();
  const normalizedSearch = transactionSearch.trim().toLocaleLowerCase('pl-PL');
  const numericSearch = Number(normalizedSearch.replace(/\s/g, '').replace(',', '.'));
  const compatibleTransactions = Array.from(maps.transactions.values())
    .filter((transaction) => transaction.remainingAmount > 0.009)
    .filter((transaction) => searchOtherMonths || belongsToAnalysedMonth(transaction.date, year, month))
    .filter((transaction) => !pickerDocument || (
      transaction.companyRef === pickerDocument.companyRef
      && transaction.direction === pickerDocument.direction
      && (
        transaction.currency.toUpperCase() === pickerDocument.currency.toUpperCase()
        || isExternalCurrencyCandidate(transaction, pickerDocument)
      )
    ))
    .filter((transaction) => {
      if (!normalizedSearch) return true;
      const text = [
        transaction.date,
        transaction.counterparty,
        transaction.mappedCounterparty,
        transaction.title,
        transaction.referenceNumber,
        transaction.rawDescription,
        transaction.amount,
      ]
        .join(' ')
        .toLocaleLowerCase('pl-PL');
      return text.includes(normalizedSearch)
        || (Number.isFinite(numericSearch) && Math.abs(transaction.remainingAmount - numericSearch) < 0.01);
    })
    .sort((left, right) => {
      if (!pickerDocument) return right.date.localeCompare(left.date);
      return Math.abs(left.remainingAmount - pickerDocument.amount)
        - Math.abs(right.remainingAmount - pickerDocument.amount);
    });

  const openTransactionMatches = (transactionRef: string) => {
    const transaction = maps.transactions.get(transactionRef);
    if (!transaction) {
      showSnackbar('Nie udało się odnaleźć tej transakcji w zapisanej analizie.', 'error');
      return;
    }

    const transactionText = `${transaction.counterparty} ${transaction.mappedCounterparty} ${transaction.title}`
      .toLocaleLowerCase('pl-PL')
      .replace(/[^a-z0-9ąćęłńóśźż]/g, '');
    const documents = Array.from(maps.documents.values())
      .filter((document) => !isDocumentConfirmed(document.ref, matchedKeys))
      .filter((document) => (
        document.companyRef === transaction.companyRef
        && document.direction === transaction.direction
        && (
          document.currency.toUpperCase() === transaction.currency.toUpperCase()
          || isExternalCurrencyCandidate(transaction, document)
        )
      ))
      .sort((left, right) => {
        const leftNumber = left.number.toLocaleLowerCase('pl-PL').replace(/[^a-z0-9ąćęłńóśźż]/g, '');
        const rightNumber = right.number.toLocaleLowerCase('pl-PL').replace(/[^a-z0-9ąćęłńóśźż]/g, '');
        const leftNumberMatch = leftNumber.length >= 4 && transactionText.includes(leftNumber) ? 1 : 0;
        const rightNumberMatch = rightNumber.length >= 4 && transactionText.includes(rightNumber) ? 1 : 0;
        if (leftNumberMatch !== rightNumberMatch) return rightNumberMatch - leftNumberMatch;
        const leftAfterPayment = daysDocumentIssuedAfterPayment(transaction, left);
        const rightAfterPayment = daysDocumentIssuedAfterPayment(transaction, right);
        const chronologyDifference = Number(leftAfterPayment != null && leftAfterPayment > 7)
          - Number(rightAfterPayment != null && rightAfterPayment > 7);
        if (chronologyDifference !== 0) return chronologyDifference;
        return Math.abs(left.amount - transaction.remainingAmount)
          - Math.abs(right.amount - transaction.remainingAmount);
      });

    if (documents.length === 0) {
      showSnackbar('Nie znaleziono dokumentów zgodnych z firmą, walutą i kierunkiem tej płatności.', 'info');
      return;
    }

    setManualMatch({
      transactionRef,
      documentRefs: documents.map((document) => document.ref),
      confidence: 'low',
      reason: 'Ręczne sprawdzanie możliwych powiązań dla wybranej transakcji.',
      amountExplanation: `Znaleziono ${documents.length} zgodnych dokumentów z KSeF, CRM, sekcji spoza KSeF i rejestru kadrowego.`,
      recommendedAction: 'Zaznacz właściwy dokument lub kilka dokumentów, porównaj sumę i zatwierdź dopasowanie.',
    });
    setDetailsTab('matches');
  };

  const openDocumentMatches = async (documentRef: string) => {
    const document = maps.documents.get(documentRef);
    if (!document) {
      showSnackbar('Nie udało się odnaleźć tego dokumentu w zapisanej analizie.', 'error');
      return;
    }

    const additionalTransactions = await loadOtherMonthsTransactions({ notify: false });
    const transactionPool = [...additionalTransactions, ...Array.from(maps.transactions.values())]
      .filter((transaction, index, values) => values.findIndex((item) => item.id === transaction.id) === index);
    const transactions = transactionPool
      .filter((transaction) => (
        transaction.remainingAmount > 0.009
        && transaction.companyRef === document.companyRef
        && transaction.direction === document.direction
        && (
          transaction.currency.toUpperCase() === document.currency.toUpperCase()
          || isExternalCurrencyCandidate(transaction, document)
        )
      ))
      .sort(
        (left, right) => Math.abs(left.remainingAmount - document.amount)
          - Math.abs(right.remainingAmount - document.amount),
      );

    if (transactions.length === 0) {
      showSnackbar('Nie znaleziono zgodnej nierozliczonej płatności także w wyciągach z 12 miesięcy przed i po analizowanym miesiącu.', 'info');
      return;
    }

    setManualMatch({
      transactionRef: transactions[0].ref,
      documentRefs: [documentRef],
      confidence: 'low',
      reason: 'Ręczne sprawdzanie płatności dla dokumentu wskazanego przez analizę.',
      amountExplanation: `Najbliższa kwotowo płatność ma wartość ${money(transactions[0].remainingAmount, transactions[0].currency)} i pochodzi z ${belongsToAnalysedMonth(transactions[0].date, year, month) ? 'analizowanego miesiąca' : 'innego miesiąca'}.`,
      recommendedAction: 'Porównaj płatność z dokumentem. W razie potrzeby wybierz inną płatność.',
    });
    setDetailsTab('matches');
  };
  const selectedDocuments = availableDocumentRefs
    .filter((ref) => selectedDocumentRefs.has(ref) && !isDocumentConfirmed(ref, matchedKeys))
    .map((ref) => maps.documents.get(ref))
    .filter((document): document is PreparedDocument => Boolean(document));
  const crossCurrencyDocument = selectedDocuments.length === 1
    && selectedTransaction
    && selectedDocuments[0].source === 'external'
    && selectedDocuments[0].currency.toUpperCase() !== selectedTransaction.currency.toUpperCase()
      ? selectedDocuments[0]
      : null;
  const hasUnsupportedCurrencySelection = Boolean(
    selectedTransaction
    && selectedDocuments.some((document) => document.currency.toUpperCase() !== selectedTransaction.currency.toUpperCase())
    && !crossCurrencyDocument,
  );
  const hasUnsupportedPersonnelSelection = selectedDocuments.length > 1
    && selectedDocuments.some((document) => document.source === 'personnel');
  const canFlagSelectedDocumentsForExplanation = selectedDocuments.length > 0
    && selectedDocuments.every((document) => document.source !== 'personnel');
  const selectedDocumentAllocations = selectedDocuments.map((document) => ({
    document,
    amount: document.source === 'personnel'
      ? document.amount
      : crossCurrencyDocument && selectedTransaction
      ? selectedTransaction.remainingAmount
      : selectedDocuments.length === 1 && selectedTransaction
        ? Math.min(document.amount, selectedTransaction.remainingAmount)
        : document.amount,
  }));
  const selectedDocumentsTotal = selectedDocumentAllocations.reduce((sum, item) => sum + item.amount, 0);
  const selectionExceedsPayment = Boolean(
    selectedTransaction
    && selectedDocumentsTotal > selectedTransaction.remainingAmount + 0.01,
  );
  const normalizedDocumentSearch = documentSearch.trim().toLocaleLowerCase('pl-PL');
  const numericDocumentSearch = Number(
    normalizedDocumentSearch.replace(/\s/g, '').replace(',', '.'),
  );
  const visibleDocumentRefs = availableDocumentRefs.filter((ref) => {
    const document = maps.documents.get(ref);
    if (!document) return false;
    if (documentSourceFilter !== 'all' && document.source !== documentSourceFilter) return false;
    if (documentPaymentFilter === 'paid' && !isDocumentPaid(document)) return false;
    if (documentPaymentFilter === 'unpaid' && isDocumentPaid(document)) return false;
    if (documentDateFrom && (!document.issueDate || document.issueDate < documentDateFrom)) return false;
    if (documentDateTo && (!document.issueDate || document.issueDate > documentDateTo)) return false;
    if (!normalizedDocumentSearch) return true;
    const searchableText = [
      document.number,
      document.counterparty,
      document.accountingNote,
      ...document.settlementDocumentNumbers,
      ...document.sourceDocumentNumbers,
    ].join(' ').toLocaleLowerCase('pl-PL');
    return searchableText.includes(normalizedDocumentSearch)
      || (Number.isFinite(numericDocumentSearch) && (
        Math.abs(document.amount - numericDocumentSearch) <= 0.01
        || Math.abs(document.grossAmount - numericDocumentSearch) <= 0.01
      ));
  });
  const activeDocumentFilterCount = Number(documentSourceFilter !== 'all')
    + Number(documentPaymentFilter !== 'all')
    + Number(Boolean(documentDateFrom || documentDateTo));
  const bulkMatchingKey = selectedTransaction ? `bulk:${selectedTransaction.ref}` : null;

  const matchSelectedDocuments = async () => {
    if (!analysis || !selectedMatch || !selectedTransaction || selectedDocuments.length === 0) return;
    const reviewNote = canFlagSelectedDocumentsForExplanation && matchNeedsExplanation
      ? matchExplanation.trim()
      : '';
    if (canFlagSelectedDocumentsForExplanation && matchNeedsExplanation && !reviewNote) {
      showSnackbar('Dodaj uwagę wyjaśniającą, dlaczego dokument wymaga dalszej kontroli.', 'error');
      return;
    }
    if (selectionExceedsPayment) {
      showSnackbar('Suma zaznaczonych dokumentów przekracza pozostałą kwotę płatności.', 'error');
      return;
    }
    if (hasUnsupportedCurrencySelection) {
      showSnackbar('Dokument walutowy dopasuj pojedynczo, aby zapisać obie kwoty i kurs przewalutowania.', 'error');
      return;
    }
    if (hasUnsupportedPersonnelSelection) {
      showSnackbar('Wynagrodzenie lub inną opłatę kadrową dopasuj pojedynczo.', 'error');
      return;
    }

    try {
      setMatchingKey(bulkMatchingKey);
      const externalDocument = selectedDocuments.length === 1 && selectedDocuments[0].source === 'external'
        ? selectedDocuments[0]
        : null;
      const shouldReconcileExternal = Boolean(externalDocument && (
        externalDocument.companyInferred
        || externalDocument.paymentStatus.toLowerCase() === 'paid'
        || externalDocument.currency.toUpperCase() !== selectedTransaction.currency.toUpperCase()
      ));
      const personnelDocument = selectedDocuments.length === 1 && selectedDocuments[0].source === 'personnel'
        ? selectedDocuments[0]
        : null;
      const results = personnelDocument
        ? [await reconcilePersonnelPaymentWithBankTransaction(supabase, {
          transactionId: selectedTransaction.id,
          personnelPaymentId: personnelDocument.id,
          amount: personnelDocument.amount,
          confidence: 1,
          reasons: ['Dopasowanie dokumentu kadrowego zatwierdzone przez użytkownika na podstawie analizy lokalnej'],
        })]
        : shouldReconcileExternal && externalDocument
        ? [await reconcileExternalInvoiceWithBankTransaction(supabase, {
          transactionId: selectedTransaction.id,
          externalInvoiceId: externalDocument.id,
          transactionAmount: selectedDocumentAllocations[0].amount,
          documentAmount: crossCurrencyDocument
            ? externalDocument.amount
            : selectedDocumentAllocations[0].amount,
          confidence: 1,
          reasons: [crossCurrencyDocument
            ? 'Ręcznie zatwierdzone dopasowanie dokumentu walutowego po przewalutowaniu'
            : 'Ręcznie zatwierdzone dopasowanie dokumentu spoza KSeF'],
          reviewNote,
        })]
        : await matchBankTransactionToDocuments(supabase, {
          transactionId: selectedTransaction.id,
          documents: selectedDocumentAllocations.map(({ document, amount }) => ({
            documentSource: document.source === 'crm' ? 'invoice' : document.source,
            documentId: document.id,
            amount,
          })),
          reviewNote,
        });
      const returnedTotal = (results as Array<{ amount?: number | string }>).reduce(
        (sum, result) => sum + Number(result.amount || 0),
        0,
      );
      const matchedAmount = returnedTotal > 0 ? returnedTotal : selectedDocumentsTotal;
      const nextMatchedKeys = new Set(matchedKeys);
      selectedDocuments.forEach((document) => {
        nextMatchedKeys.add(`${selectedTransaction.ref}:${document.ref}`);
      });
      if (reviewNote) {
        setConfirmedReviewNotes((current) => {
          const next = new Map(current);
          selectedDocuments.forEach((document) => {
            next.set(`${selectedTransaction.ref}:${document.ref}`, reviewNote);
          });
          return next;
        });
      }
      const remainingAfterMatch = Math.max(
        selectedTransaction.remainingAmount - matchedAmount,
        0,
      );

      setMatchedKeys(nextMatchedKeys);
      setMaps((current) => {
        const nextTransactions = new Map(current.transactions);
        const nextDocuments = new Map(current.documents);
        nextTransactions.set(selectedTransaction.ref, {
          ...selectedTransaction,
          remainingAmount: remainingAfterMatch,
        });
        selectedDocumentAllocations.forEach(({ document, amount }) => {
          const documentAmountReduction = document.source === 'personnel'
            || document.currency.toUpperCase() !== selectedTransaction.currency.toUpperCase()
            ? document.amount
            : Math.min(amount, document.amount);
          const remainingDocumentAmount = Math.max(document.amount - documentAmountReduction, 0);
          nextDocuments.set(document.ref, {
            ...document,
            amount: remainingDocumentAmount,
            settledAmount: document.settledAmount + documentAmountReduction,
            paymentStatus: remainingDocumentAmount <= 0.009 ? 'paid' : 'partially_paid',
          });
        });
        return { transactions: nextTransactions, documents: nextDocuments };
      });

      const isPending = (matchIndex: number) => {
        const match = analysis.likelyMatches[matchIndex];
        if (!match) return false;
        const matchTransaction = maps.transactions.get(match.transactionRef);
        const remaining = match.transactionRef === selectedTransaction.ref
          ? remainingAfterMatch
          : matchTransaction?.remainingAmount || 0;
        return remaining > 0.009
          && match.documentRefs.some((ref) => !isDocumentConfirmed(ref, nextMatchedKeys));
      };

      if (manualMatch) {
        setManualMatch(null);
        const nextIndex = analysis.likelyMatches
          .map((_, index) => index)
          .find(isPending);
        if (nextIndex !== undefined) setSelectedMatchIndex(nextIndex);
        else setSelectedDocumentRefs(new Set());
      } else if (isPending(selectedMatchIndex)) {
        setSelectedDocumentRefs(new Set(
          selectedMatch.documentRefs.filter((ref) => !isDocumentConfirmed(ref, nextMatchedKeys)),
        ));
      } else {
        const orderedIndexes = analysis.likelyMatches.map((_, index) => index);
        const nextIndex = [
          ...orderedIndexes.filter((index) => index > selectedMatchIndex),
          ...orderedIndexes.filter((index) => index < selectedMatchIndex),
        ].find(isPending);
        if (nextIndex !== undefined) setSelectedMatchIndex(nextIndex);
        else setSelectedDocumentRefs(new Set());
      }

      const documentWord = selectedDocuments.length === 1
        ? 'dokument'
        : selectedDocuments.length >= 2 && selectedDocuments.length <= 4
          ? 'dokumenty'
          : 'dokumentów';
      showSnackbar(
        reviewNote
          ? `Dopasowano ${selectedDocuments.length} ${documentWord} i oznaczono do dodatkowego wyjaśnienia`
          : `Dopasowano ${selectedDocuments.length} ${documentWord} na kwotę ${money(matchedAmount, selectedTransaction.currency)}`,
        'success',
      );
      await onMatchApplied?.();
    } catch (error: any) {
      console.error('Bulk AI suggestion matching error:', error);
      showSnackbar(error?.message || 'Nie udało się dopasować zaznaczonych dokumentów.', 'error');
    } finally {
      setMatchingKey(null);
    }
  };

  const openTransactionNote = (
    transactionRef: string,
    suggestedType?: AiAnalysis['missingDocuments'][number]['documentType'],
  ) => {
    const transaction = maps.transactions.get(transactionRef);
    if (!transaction) return;
    const suggestedCategory = suggestedType === 'bank_fee'
      ? 'bank_fee'
      : suggestedType === 'tax_or_zus'
        ? 'tax_or_zus'
        : suggestedType === 'payroll'
          ? 'payroll'
          : suggestedType === 'foreign_invoice' || suggestedType === 'customs'
            ? 'foreign_purchase'
            : 'other';
    setNoteEditor({ kind: 'transaction', ref: transactionRef });
    setNoteDraft(transaction.accountingNote);
    setNoteCategory(transaction.accountingCategory === 'other' ? suggestedCategory : transaction.accountingCategory);
    setNoteExplained(transaction.accountingReviewStatus === 'explained');
  };

  const openDocumentNote = (documentRef: string) => {
    const document = maps.documents.get(documentRef);
    if (!document) return;
    setNoteEditor({ kind: 'document', ref: documentRef });
    setNoteDraft(document.accountingNote);
    setNoteCategory('other');
    setNoteExplained(false);
  };

  const openInvoiceDetails = async (document: PreparedDocument) => {
    if (document.source !== 'ksef' && document.source !== 'crm') {
      showSnackbar('Pełny podgląd pozycji jest dostępny dla faktur KSeF i CRM.', 'info');
      return;
    }

    try {
      setInvoiceDetailsLoadingId(document.id);
      const table = document.source === 'ksef' ? 'ksef_invoices' : 'invoices';
      const { data, error } = await supabase
        .from(table)
        .select('*')
        .eq('id', document.id)
        .single();
      if (error) throw error;
      if (!data) throw new Error('Nie znaleziono faktury.');

      if (document.source === 'ksef') {
        setInvoiceDetails(data);
        return;
      }

      setInvoiceDetails({
        ...data,
        invoice_id: data.id,
        net_amount: data.total_net,
        vat_amount: data.total_vat,
        gross_amount: data.total_gross,
        currency: data.currency_code || 'PLN',
        seller_address: [data.seller_street, data.seller_postal_code, data.seller_city]
          .filter(Boolean)
          .join(', '),
        buyer_address: [data.buyer_street, data.buyer_postal_code, data.buyer_city]
          .filter(Boolean)
          .join(', '),
      });
    } catch (error: any) {
      console.error('Invoice details loading error:', error);
      showSnackbar(error?.message || 'Nie udało się pobrać szczegółów faktury.', 'error');
    } finally {
      setInvoiceDetailsLoadingId(null);
    }
  };

  const saveAccountingNote = async () => {
    if (!noteEditor || !noteDraft.trim()) return;
    try {
      setNoteSaving(true);
      const note = noteDraft.trim();
      if (noteEditor.kind === 'transaction') {
        const transaction = maps.transactions.get(noteEditor.ref);
        if (!transaction) throw new Error('Nie znaleziono płatności.');
        const { error } = await supabase.from('bank_transactions').update({
          accounting_note: note,
          accounting_category: noteCategory,
          accounting_review_status: noteExplained ? 'explained' : 'pending',
          accounting_reviewed_at: noteExplained ? new Date().toISOString() : null,
        }).eq('id', transaction.id);
        if (error) throw error;
        setMaps((current) => {
          const transactions = new Map(current.transactions);
          transactions.set(noteEditor.ref, {
            ...transaction,
            accountingNote: note,
            accountingCategory: noteCategory,
            accountingReviewStatus: noteExplained ? 'explained' : 'pending',
          });
          return { ...current, transactions };
        });
        showSnackbar(noteExplained ? 'Płatność została opisana i oznaczona jako wyjaśniona.' : 'Opis płatności został zapisany.', 'success');
      } else {
        const document = maps.documents.get(noteEditor.ref);
        if (!document) throw new Error('Nie znaleziono dokumentu.');
        const table = document.source === 'crm'
          ? 'invoices'
          : document.source === 'ksef'
            ? 'ksef_invoices'
            : document.source === 'personnel'
              ? 'personnel_contract_payments'
              : 'external_invoices';
        const payload = document.source === 'personnel' ? { notes: note } : { accounting_note: note };
        const { error } = await supabase.from(table).update(payload).eq('id', document.id);
        if (error) throw error;
        setMaps((current) => {
          const documents = new Map(current.documents);
          documents.set(noteEditor.ref, { ...document, accountingNote: note });
          return { ...current, documents };
        });
        showSnackbar('Opis dokumentu został zapisany.', 'success');
      }
      setNoteEditor(null);
    } catch (error: any) {
      showSnackbar(error?.message || 'Nie udało się zapisać opisu.', 'error');
    } finally {
      setNoteSaving(false);
    }
  };

  const openCounterpartyMapping = (transactionRef: string, suggestedCounterparty = '') => {
    const transaction = maps.transactions.get(transactionRef);
    if (!transaction) return;
    setMappingEditorRef(transactionRef);
    setMappingAliasDraft(suggestedMappingAlias(transaction));
    setMappingCounterpartyDraft(
      suggestedCounterparty || transaction.mappedCounterparty || transaction.counterparty,
    );
    setMappingNipDraft('');
  };

  const saveCounterpartyMapping = async () => {
    if (!mappingEditorRef) return;
    const transaction = maps.transactions.get(mappingEditorRef);
    const alias = mappingAliasDraft.trim();
    const normalizedAlias = normalizeCounterpartyAlias(alias);
    const counterpartyName = mappingCounterpartyDraft.trim();
    const counterpartyNip = mappingNipDraft.replace(/\D/g, '');
    if (!transaction?.companyId) {
      showSnackbar('Wyciąg nie ma przypisanej działalności, więc nie można zapisać szablonu.', 'error');
      return;
    }
    if (normalizedAlias.length < 4 || !counterpartyName) {
      showSnackbar('Podaj rozpoznawalny fragment płatności i właściwą nazwę kontrahenta.', 'error');
      return;
    }
    if (counterpartyNip && counterpartyNip.length !== 10) {
      showSnackbar('NIP powinien zawierać 10 cyfr.', 'error');
      return;
    }
    try {
      setMappingSaving(true);
      const { error } = await supabase
        .from('bank_counterparty_mapping_templates')
        .upsert({
          my_company_id: transaction.companyId,
          alias_pattern: alias,
          normalized_alias: normalizedAlias,
          counterparty_name: counterpartyName,
          counterparty_nip: counterpartyNip || null,
          source_transaction_id: transaction.id,
          is_active: true,
        }, { onConflict: 'my_company_id,normalized_alias' });
      if (error) throw error;
      setMaps((current) => {
        const transactions = new Map(current.transactions);
        transactions.forEach((item, ref) => {
          const transactionText = normalizeCounterpartyAlias(`${item.counterparty} ${item.title}`);
          if (item.companyId === transaction.companyId && transactionText.includes(normalizedAlias)) {
            transactions.set(ref, {
              ...item,
              mappedCounterparty: counterpartyName,
              mappingAlias: alias,
            });
          }
        });
        return { ...current, transactions };
      });
      setMappingEditorRef(null);
      showSnackbar('Szablon kontrahenta został zapisany i działa dla kolejnych płatności.', 'success');
    } catch (error: any) {
      showSnackbar(
        isMissingCounterpartyMappingsTable(error)
          ? 'Baza mapowań nie jest jeszcze aktywna. Wykonaj migrację 20260903207000 i spróbuj ponownie.'
          : error?.message || 'Nie udało się zapisać szablonu kontrahenta.',
        'error',
      );
    } finally {
      setMappingSaving(false);
    }
  };

  return (
    <section className="border-b border-[#d3bb73]/10 bg-[#141827] px-4 py-3">
      {loading && (
        <div
          className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Trwa analiza AI"
        >
          <div className="w-full max-w-md rounded-xl border border-[#d3bb73]/25 bg-[#141827] p-8 text-center shadow-2xl">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-[#d3bb73]/20 bg-[#d3bb73]/5">
              <Loader2 className="h-8 w-8 animate-spin text-[#d3bb73]" />
            </div>
            <h3 className="mt-5 text-lg font-medium text-[#e5e4e2]">Analizuję transakcje i dokumenty</h3>
            <p className="mt-2 text-xs font-medium uppercase tracking-[0.16em] text-[#d3bb73]">
              Etap {analysisProgress.step} z {analysisProgress.totalSteps}
            </p>
            <p className="mt-2 text-sm font-medium text-[#e5e4e2]/80">{analysisProgress.label}</p>
            <p className="mt-1 min-h-10 text-xs leading-relaxed text-[#e5e4e2]/50">
              {analysisProgress.detail}
            </p>
            <div
              className="mt-5 h-2 overflow-hidden rounded-full bg-[#252945]"
              role="progressbar"
              aria-label={analysisProgress.label}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={analysisProgress.percent}
            >
              <div
                className={`h-full rounded-full bg-[#d3bb73] transition-[width] duration-500 ease-out ${analysisProgress.indeterminate ? 'animate-pulse' : ''}`}
                style={{ width: `${analysisProgress.percent}%` }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-[#e5e4e2]/40">
              <span>{analysisProgress.indeterminate ? 'Trwa bieżący etap' : 'Postęp etapów'}</span>
              <span>{analysisProgress.percent}%</span>
            </div>
            <p className="mt-3 text-xs text-[#e5e4e2]/35">
              Uzgodnienie za {month}/{year}. Okno pozostanie zablokowane do zakończenia analizy.
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h4 className="flex items-center gap-2 font-medium text-[#e5e4e2]">
            <Sparkles className="h-4 w-4 text-[#d3bb73]" /> Analiza uzgodnienia przez AI
          </h4>
          <p className="mt-1 max-w-4xl text-[11px] leading-relaxed text-[#e5e4e2]/45">
            Korzysta ze wszystkich poprawnie przetworzonych wyciągów: rachunku bieżącego, rachunku VAT oraz importów MT940. Szuka płatności zbiorczych i częściowych, brakujących dokumentów kosztowych oraz pozycji wymagających ręcznej kontroli. Porównuje faktury KSeF, faktury CRM i dokumenty spoza KSeF, pomijając dokumenty oznaczone jako płatne gotówką. Wynagrodzenia, zaliczki, PIT, ZUS i zwroty kosztów są porównywane lokalnie w CRM — dane kadrowe nie są wysyłane do OpenAI. Do AI trafiają daty, kwoty, waluty, kontrahenci i skrócone tytuły pozostałych pozycji, bez rachunków bankowych, NIP-ów i plików. Sugestie nie są zatwierdzane automatycznie.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {analysis && (
            <button
              type="button"
              onClick={() => setShowDetails(true)}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#d3bb73]/35 bg-[#1c1f33] px-4 py-2 text-sm font-medium text-[#d3bb73] hover:bg-[#d3bb73]/10"
            >
              <Eye className="h-4 w-4" />
              Pokaż analizę
            </button>
          )}
          <button
            type="button"
            onClick={() => void runAnalysis()}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#141827] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {loading ? 'Analizuję…' : analysis ? 'Analizuj ponownie' : 'Analizuj AI'}
          </button>
        </div>
      </div>

      {!reportPersistenceAvailable && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-xs text-amber-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Trwały zapis analizy wymaga uruchomienia migracji <strong>20260903212000</strong> w Supabase. Do tego czasu raport nie jest zapisywany w przeglądarce.
          </span>
        </div>
      )}

      {analysis && (
        <div className="mt-3 flex flex-col gap-3 rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] px-3 py-2.5 lg:flex-row lg:items-center">
          <p className="min-w-0 flex-1 line-clamp-2 text-xs leading-relaxed text-[#e5e4e2]/65">{analysis.summary}</p>
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            {analysisStale && (
              <span className="rounded bg-amber-400/15 px-2 py-1 font-medium text-amber-100">
                Źródła zmieniły się — uruchom analizę ponownie
              </span>
            )}
            <span className="rounded bg-emerald-400/10 px-2 py-1 text-emerald-200">Do potwierdzenia: {pendingMatches.length}</span>
            {confirmedPairs.length > 0 && <span className="rounded bg-green-400/10 px-2 py-1 text-green-200">Potwierdzone: {confirmedPairs.length}</span>}
            <span className="rounded bg-red-400/10 px-2 py-1 text-red-200">Braki: {analysis.missingDocuments.length}</span>
            <span className="rounded bg-amber-400/10 px-2 py-1 text-amber-100">Przelewy: {analysis.reviewTransactions.length}</span>
            {Boolean(snapshotStats?.linkedPersonnelPayments) && (
              <span className="rounded bg-violet-400/10 px-2 py-1 text-violet-100">
                Kadrowe już rozliczone: {snapshotStats?.linkedPersonnelPayments}
              </span>
            )}
            {snapshotStats && <span className="text-[#e5e4e2]/40">{snapshotStats.debitTransactions} wydatków / {money(snapshotStats.debitAmount)}</span>}
            {analysisSavedAt && <span className="text-[#e5e4e2]/35">Zapisano w Supabase {new Date(analysisSavedAt).toLocaleString('pl-PL')}</span>}
          </div>
        </div>
      )}

      {showDetails && analysis && (
        <div className="fixed inset-0 z-[10020] flex items-center justify-center bg-black/75 p-3 sm:p-5">
          <div className="flex h-[94vh] w-full max-w-[1560px] flex-col overflow-hidden rounded-xl border border-[#d3bb73]/25 bg-[#141827] shadow-2xl">
            <header className="flex items-start justify-between border-b border-[#d3bb73]/15 px-5 py-4">
              <div>
                <h3 className="flex items-center gap-2 text-lg font-medium text-[#e5e4e2]">
                  <Sparkles className="h-5 w-5 text-[#d3bb73]" /> Analiza AI — {month}/{year}
                </h3>
                <p className="mt-1 text-xs text-[#e5e4e2]/45">Porównaj dane źródłowe i zatwierdzaj dopasowania pojedynczo.</p>
              </div>
              <button type="button" onClick={() => setShowDetails(false)} className="rounded p-2 text-[#e5e4e2]/55 hover:bg-white/5 hover:text-[#e5e4e2]">
                <X className="h-5 w-5" />
              </button>
            </header>

            <nav className="flex gap-2 overflow-x-auto border-b border-[#d3bb73]/10 px-4 py-2">
              {([
                ['matches', `Do potwierdzenia (${pendingMatches.length})`],
                ['missing', `Brakujące dokumenty (${analysis.missingDocuments.length})`],
                ['transactions', `Przelewy do kontroli (${analysis.reviewTransactions.length})`],
                ['documents', `Dokumenty do kontroli (${analysis.reviewDocuments.length})`],
              ] as const).map(([tab, label]) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setDetailsTab(tab)}
                  className={`shrink-0 rounded-lg px-3 py-2 text-xs font-medium ${detailsTab === tab ? 'bg-[#d3bb73] text-[#141827]' : 'border border-[#d3bb73]/15 text-[#e5e4e2]/65 hover:bg-white/5'}`}
                >
                  {label}
                </button>
              ))}
            </nav>

            <div className="min-h-0 flex-1 overflow-hidden p-4">
              {detailsTab === 'matches' && (
                <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
                  <aside
                    className="min-h-0 overflow-y-auto rounded-lg border border-[#d3bb73]/15 bg-[#1c1f33] p-3"
                    style={{ fontFamily: "Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}
                  >
                    <h4 className="mb-3 flex items-center gap-2 text-sm font-medium text-emerald-200"><Link2 className="h-4 w-4" /> Do potwierdzenia ({pendingMatches.length})</h4>
                    {manualMatch && (
                      <div className="mb-3 rounded-lg border border-[#d3bb73]/25 bg-[#d3bb73]/10 p-3 text-xs">
                        <strong className="text-[#d3bb73]">Ręczne sprawdzanie powiązań</strong>
                        <p className="mt-1 text-[#e5e4e2]/55">Pokazuję możliwe dokumenty lub płatność wybrane z raportu.</p>
                        <button
                          type="button"
                          onClick={() => setManualMatch(null)}
                          className="mt-2 rounded border border-[#d3bb73]/30 px-2.5 py-1.5 font-medium text-[#d3bb73] hover:bg-[#d3bb73]/10"
                        >
                          Wróć do sugestii AI
                        </button>
                      </div>
                    )}
                    <div className="space-y-2">
                      {pendingMatches.map(({ match, index }) => (
                        <button
                          key={`${match.transactionRef}-${index}`}
                          type="button"
                          onClick={() => {
                            setManualMatch(null);
                            setSelectedMatchIndex(index);
                          }}
                          className={`w-full rounded-lg border p-3 text-left text-xs ${!manualMatch && selectedMatchIndex === index ? 'border-[#d3bb73] bg-[#d3bb73]/10' : 'border-[#d3bb73]/10 bg-[#141827] hover:border-[#d3bb73]/35'}`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <strong className="text-[#e5e4e2]">{transactionLabel(maps.transactions.get(match.transactionRef))}</strong>
                            <span className="shrink-0 uppercase text-[#d3bb73]/65">{priorityLabel(match.confidence)}</span>
                          </div>
                          <p className="mt-2 line-clamp-2 text-[#e5e4e2]/50">{match.documentRefs.length} {match.documentRefs.length === 1 ? 'dokument' : 'dokumenty'} • {match.reason}</p>
                        </button>
                      ))}
                      {pendingMatches.length === 0 && <p className="p-4 text-center text-xs text-green-300/70">Wszystkie propozycje zostały obsłużone.</p>}
                    </div>

                    {confirmedPairs.length > 0 && (
                      <div className="mt-5 border-t border-green-400/15 pt-4">
                        <h4 className="mb-3 flex items-center gap-2 text-sm font-medium text-green-300"><CheckCircle className="h-4 w-4" /> Potwierdzone ({confirmedPairs.length})</h4>
                        <div className="space-y-2">
                          {confirmedPairs.map(({ transactionRef, documentRef }) => {
                            const pairKey = `${transactionRef}:${documentRef}`;
                            const reviewNote = confirmedReviewNotes.get(pairKey);
                            return (
                              <div key={pairKey} className="rounded-lg border border-green-400/15 bg-green-400/5 p-3 text-xs">
                                <strong className="block text-green-200">{transactionLabel(maps.transactions.get(transactionRef))}</strong>
                                <span className="mt-1 block text-[#e5e4e2]/55">{documentLabel(maps.documents.get(documentRef))}</span>
                                {reviewNote && (
                                  <div className="mt-2 rounded border border-amber-300/20 bg-amber-300/10 px-2.5 py-2 text-amber-100">
                                    <strong className="block text-[10px] uppercase tracking-wide text-amber-200">Wymaga wyjaśnienia</strong>
                                    <span className="mt-1 block whitespace-pre-wrap leading-relaxed">{reviewNote}</span>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </aside>

                  <main className="min-h-0 overflow-y-auto rounded-lg border border-[#d3bb73]/15 bg-[#1c1f33] p-4 xl:overflow-hidden">
                    {!selectedMatch || !selectedTransaction ? (
                      <div className="flex h-full items-center justify-center text-sm text-[#e5e4e2]/45">Wybierz propozycję z listy.</div>
                    ) : (
                      <div className="space-y-4 xl:flex xl:h-full xl:min-h-0 xl:flex-col xl:space-y-0 xl:gap-4">
                        <div className="rounded-lg border border-[#d3bb73]/15 bg-[#141827] p-3 text-xs">
                          <p className="text-[#e5e4e2]/70">{selectedMatch.reason}</p>
                          <p className="mt-1 text-[#e5e4e2]/50">{selectedMatch.amountExplanation}</p>
                          <p className="mt-2 font-medium text-[#d3bb73]">{selectedMatch.recommendedAction}</p>
                        </div>

                        <div className="grid gap-4 xl:min-h-0 xl:flex-1 xl:grid-cols-2">
                          <section className="self-start rounded-lg border border-amber-400/20 bg-amber-400/5 p-4">
                            <div className="flex items-center justify-between gap-3">
                              <h5 className="flex items-center gap-2 text-sm font-medium text-amber-100"><ArrowRightLeft className="h-4 w-4" /> Płatność bankowa</h5>
                              <div className="flex flex-wrap justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() => openCounterpartyMapping(
                                    selectedTransaction.ref,
                                    selectedDocuments[0]?.counterparty || pickerDocument?.counterparty || '',
                                  )}
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300/25 px-2.5 py-1.5 text-[11px] font-medium text-amber-100 hover:bg-amber-300/10"
                                >
                                  <BookOpenCheck className="h-3.5 w-3.5" />
                                  {selectedTransaction.mappingAlias ? 'Edytuj mapowanie' : 'Dodaj do mapowań'}
                                </button>
                                <button
                                  type="button"
                                  disabled={otherMonthsLoading}
                                  onClick={() => {
                                    setTransactionSearch('');
                                    setSearchOtherMonths(false);
                                    void loadOtherMonthsTransactions({ notify: false })
                                      .then(() => setShowTransactionPicker(true));
                                  }}
                                  className="rounded-lg border border-amber-300/25 px-2.5 py-1.5 text-[11px] font-medium text-amber-100 hover:bg-amber-300/10 disabled:opacity-50"
                                >
                                  Wybierz inną płatność
                                </button>
                                <button
                                  type="button"
                                  disabled={otherMonthsLoading}
                                  onClick={() => {
                                    setTransactionSearch('');
                                    setSearchOtherMonths(true);
                                    void loadOtherMonthsTransactions().then(() => setShowTransactionPicker(true));
                                  }}
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-sky-300/25 px-2.5 py-1.5 text-[11px] font-medium text-sky-100 hover:bg-sky-300/10 disabled:opacity-50"
                                >
                                  {otherMonthsLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                                  Szukaj w innych miesiącach
                                </button>
                              </div>
                            </div>
                            {selectedTransaction.ref !== selectedMatch.transactionRef && (
                              <p className="mt-3 rounded bg-sky-400/10 px-2.5 py-2 text-[11px] text-sky-100">
                                Wybrano inną płatność niż propozycja AI. Porównaj dane przed zatwierdzeniem.
                              </p>
                            )}
                            <dl className="mt-4 grid grid-cols-[120px_1fr] gap-x-3 gap-y-2 text-xs">
                              <dt className="text-[#e5e4e2]/40">Data</dt><dd className="text-[#e5e4e2]">{selectedTransaction.date || '—'}</dd>
                              <dt className="text-[#e5e4e2]/40">Kwota</dt><dd className="font-medium text-amber-100">{money(selectedTransaction.amount, selectedTransaction.currency)}</dd>
                              <dt className="text-[#e5e4e2]/40">Pozostało</dt><dd className="font-medium text-[#d3bb73]">{money(selectedTransaction.remainingAmount, selectedTransaction.currency)}</dd>
                              <dt className="text-[#e5e4e2]/40">Kierunek</dt><dd className="text-[#e5e4e2]">{selectedTransaction.direction === 'credit' ? 'Wpłata' : 'Wydatek'}</dd>
                              <dt className="text-[#e5e4e2]/40">Źródło</dt><dd className="text-[#e5e4e2]">{transactionStatementLabel(selectedTransaction)}{selectedTransaction.statementFileName && <span className="mt-0.5 block break-all text-[10px] text-[#e5e4e2]/40">{selectedTransaction.statementFileName}</span>}</dd>
                              <dt className="text-[#e5e4e2]/40">Kontrahent</dt><dd className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere] text-[#e5e4e2]">{selectedTransaction.counterparty || '—'}</dd>
                              {selectedTransaction.mappedCounterparty && (
                                <><dt className="text-[#e5e4e2]/40">Rozpoznano jako</dt><dd className="break-words font-medium text-green-200">{selectedTransaction.mappedCounterparty}<span className="mt-0.5 block text-[10px] font-normal text-[#e5e4e2]/40">szablon: {selectedTransaction.mappingAlias}</span></dd></>
                              )}
                              {selectedTransaction.referenceNumber && (
                                <><dt className="text-[#e5e4e2]/40">Numer referencyjny</dt><dd className="min-w-0 font-mono text-[11px] text-[#e5e4e2]/60 [overflow-wrap:anywhere]">{selectedTransaction.referenceNumber}</dd></>
                              )}
                              <div className="col-span-2 mt-1 min-w-0">
                                <dt className="mb-1 text-[#e5e4e2]/40">Pełny tytuł przelewu</dt>
                                <dd className="min-w-0 whitespace-pre-wrap text-sm leading-relaxed text-[#e5e4e2] [overflow-wrap:anywhere]">
                                  {selectedTransaction.title || '—'}
                                </dd>
                              </div>
                            </dl>
                          </section>

                          <section className="space-y-3 xl:min-h-0 xl:overflow-y-auto xl:overscroll-contain xl:pr-1">
                            <div className="sticky top-0 z-10 flex flex-col gap-2 bg-[#1c1f33] pb-1 sm:flex-row">
                              <div className="relative flex min-w-0 flex-1 gap-2">
                                <label className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-[#d3bb73]/20 bg-[#141827] px-3 py-2 shadow-lg">
                                  <Search className="h-4 w-4 shrink-0 text-[#d3bb73]" />
                                  <input
                                    value={documentSearch}
                                    onChange={(event) => setDocumentSearch(event.target.value)}
                                    placeholder="Szukaj po odbiorcy, numerze lub kwocie…"
                                    className="min-w-0 flex-1 bg-transparent text-sm text-[#e5e4e2] outline-none placeholder:text-[#e5e4e2]/30"
                                  />
                                  <span className="shrink-0 text-[11px] text-[#e5e4e2]/40">
                                    {visibleDocumentRefs.length}/{availableDocumentRefs.length}
                                  </span>
                                </label>
                                <button
                                  type="button"
                                  aria-label="Filtry dokumentów"
                                  aria-expanded={documentFiltersOpen}
                                  onClick={() => setDocumentFiltersOpen((current) => !current)}
                                  className={`relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border bg-[#141827] shadow-lg ${
                                    activeDocumentFilterCount > 0
                                      ? 'border-[#d3bb73]/55 text-[#d3bb73]'
                                      : 'border-white/15 text-[#e5e4e2]/65 hover:border-[#d3bb73]/35 hover:text-[#d3bb73]'
                                  }`}
                                >
                                  <SlidersHorizontal className="h-4 w-4" />
                                  {activeDocumentFilterCount > 0 && (
                                    <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#d3bb73] px-1 text-[10px] font-semibold text-[#141827]">
                                      {activeDocumentFilterCount}
                                    </span>
                                  )}
                                </button>

                                {documentFiltersOpen && (
                                  <div className="absolute right-0 top-full z-30 mt-2 w-[min(360px,calc(100vw-3rem))] rounded-xl border border-white/10 bg-[#141827] p-4 shadow-2xl">
                                    <div className="mb-4 flex items-center justify-between gap-3">
                                      <div>
                                        <h5 className="text-sm font-medium text-[#e5e4e2]">Filtry dokumentów</h5>
                                        <p className="mt-0.5 text-[11px] text-[#e5e4e2]/45">Filtry działają razem z wyszukiwarką.</p>
                                      </div>
                                      <button type="button" onClick={() => setDocumentFiltersOpen(false)} className="rounded p-1.5 text-[#e5e4e2]/50 hover:bg-white/5 hover:text-[#e5e4e2]">
                                        <X className="h-4 w-4" />
                                      </button>
                                    </div>

                                    <div className="grid gap-3 sm:grid-cols-2">
                                      <label className="text-[11px] text-[#e5e4e2]/60">
                                        Typ dokumentu
                                        <select
                                          value={documentSourceFilter}
                                          onChange={(event) => setDocumentSourceFilter(event.target.value as DocumentSourceFilter)}
                                          className="mt-1.5 w-full rounded-lg border border-white/15 bg-[#1c1f33] px-3 py-2 text-xs text-[#e5e4e2] outline-none focus:border-[#d3bb73]/55"
                                        >
                                          <option value="all">Wszystkie typy</option>
                                          <option value="ksef">KSeF</option>
                                          <option value="external">Spoza KSeF</option>
                                          <option value="crm">CRM</option>
                                          <option value="personnel">Kadrowe</option>
                                        </select>
                                      </label>
                                      <label className="text-[11px] text-[#e5e4e2]/60">
                                        Status płatności
                                        <select
                                          value={documentPaymentFilter}
                                          onChange={(event) => setDocumentPaymentFilter(event.target.value as DocumentPaymentFilter)}
                                          className="mt-1.5 w-full rounded-lg border border-white/15 bg-[#1c1f33] px-3 py-2 text-xs text-[#e5e4e2] outline-none focus:border-[#d3bb73]/55"
                                        >
                                          <option value="all">Wszystkie statusy</option>
                                          <option value="paid">Opłacone</option>
                                          <option value="unpaid">Nieopłacone / częściowe</option>
                                        </select>
                                      </label>
                                      <label className="text-[11px] text-[#e5e4e2]/60">
                                        Data wystawienia od
                                        <input
                                          type="date"
                                          value={documentDateFrom}
                                          max={documentDateTo || undefined}
                                          onChange={(event) => setDocumentDateFrom(event.target.value)}
                                          className="mt-1.5 w-full rounded-lg border border-white/15 bg-[#1c1f33] px-3 py-2 text-xs text-[#e5e4e2] outline-none focus:border-[#d3bb73]/55"
                                        />
                                      </label>
                                      <label className="text-[11px] text-[#e5e4e2]/60">
                                        Data wystawienia do
                                        <input
                                          type="date"
                                          value={documentDateTo}
                                          min={documentDateFrom || undefined}
                                          onChange={(event) => setDocumentDateTo(event.target.value)}
                                          className="mt-1.5 w-full rounded-lg border border-white/15 bg-[#1c1f33] px-3 py-2 text-xs text-[#e5e4e2] outline-none focus:border-[#d3bb73]/55"
                                        />
                                      </label>
                                    </div>

                                    <div className="mt-4 flex justify-between gap-2 border-t border-white/10 pt-3">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setDocumentSourceFilter('all');
                                          setDocumentPaymentFilter('all');
                                          setDocumentDateFrom('');
                                          setDocumentDateTo('');
                                        }}
                                        className="rounded-lg border border-white/15 px-3 py-2 text-xs text-[#e5e4e2]/65 hover:bg-white/5"
                                      >
                                        Wyczyść
                                      </button>
                                      <button type="button" onClick={() => setDocumentFiltersOpen(false)} className="rounded-lg bg-[#d3bb73] px-4 py-2 text-xs font-medium text-[#141827]">
                                        Gotowe
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={() => openTransactionMatches(selectedTransaction.ref)}
                                className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-sky-300/25 bg-[#141827] px-3 py-2 text-xs font-medium text-sky-100 hover:bg-sky-300/10"
                              >
                                <ReceiptText className="h-3.5 w-3.5" /> Wybierz inny dokument
                              </button>
                            </div>
                            {visibleDocumentRefs.map((ref) => {
                              const document = maps.documents.get(ref);
                              if (!document) return null;
                              const matched = isDocumentConfirmed(ref, matchedKeys);
                              const alreadyLinked = Boolean(document.linkedTransactionId);
                              const linkedToSelectedTransaction = alreadyLinked
                                && document.linkedTransactionId === selectedTransaction.id;
                              const isOriginalSuggestion = selectedMatch.documentRefs.includes(ref);
                              const isCounterpartyAlternative = !isOriginalSuggestion
                                && selectedMatch.documentRefs.some((suggestedRef) => {
                                  const suggested = maps.documents.get(suggestedRef);
                                  return Boolean(suggested && hasSameDocumentCounterparty(document, suggested));
                                });
                              return (
                                <article key={ref} className="rounded-lg border border-sky-400/20 bg-sky-400/5 p-4">
                                  <div className="flex items-start justify-between gap-3">
                                    <h5 className="flex items-center gap-2 text-sm font-medium text-sky-100">
                                      <ReceiptText className="h-4 w-4" /> {documentHeading(document)}
                                      {document.documentKind === 'final' && (
                                        <span className="rounded bg-[#d3bb73]/15 px-2 py-0.5 text-[10px] uppercase text-[#d3bb73]">końcowa</span>
                                      )}
                                      {document.source === 'personnel' && (
                                        <span className="rounded bg-violet-400/15 px-2 py-0.5 text-[10px] uppercase text-violet-100">
                                          {personnelPaymentLabels[document.documentKind.replace('personnel_', '')] || 'kadry'}
                                        </span>
                                      )}
                                      {isCounterpartyAlternative && (
                                        <span className="rounded bg-sky-400/15 px-2 py-0.5 text-[10px] uppercase text-sky-100">
                                          ta sama kwota i kontrahent
                                        </span>
                                      )}
                                      {!isCounterpartyAlternative
                                        && matchesSelectedPaymentAmount(document)
                                        && (!isOriginalSuggestion || (selectedTransaction && !hasMerchantIdentityMatch(selectedTransaction, document)))
                                        && (
                                          <span className="rounded bg-amber-400/15 px-2 py-0.5 text-[10px] uppercase text-amber-100">
                                            zgodna kwota — sprawdź kontrahenta
                                          </span>
                                        )}
                                    </h5>
                                    <div className="flex flex-wrap items-center justify-end gap-3">
                                      {(document.source === 'ksef' || document.source === 'crm') && (
                                        <button
                                          type="button"
                                          disabled={invoiceDetailsLoadingId === document.id}
                                          onClick={() => void openInvoiceDetails(document)}
                                          className="inline-flex items-center gap-1.5 rounded-lg border border-sky-300/25 px-2.5 py-1.5 text-[11px] font-medium text-sky-100 hover:bg-sky-300/10 disabled:opacity-50"
                                        >
                                          {invoiceDetailsLoadingId === document.id
                                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                            : <Eye className="h-3.5 w-3.5" />}
                                          Szczegóły
                                        </button>
                                      )}
                                      <label className={`flex items-center gap-1.5 text-[11px] ${
                                        matched || alreadyLinked ? 'cursor-not-allowed text-green-300' : 'cursor-pointer text-[#e5e4e2]/65'
                                      }`}>
                                        <input
                                          type="checkbox"
                                          checked={matched || linkedToSelectedTransaction || selectedDocumentRefs.has(ref)}
                                          disabled={matched || alreadyLinked}
                                          onChange={() => {
                                            if (!selectedDocumentRefs.has(ref) && selectedDocumentRefs.size >= 20) {
                                              showSnackbar('Jednocześnie możesz dopasować maksymalnie 20 dokumentów.', 'info');
                                              return;
                                            }
                                            setSelectedDocumentRefs((current) => {
                                              const next = new Set(current);
                                              if (next.has(ref)) next.delete(ref);
                                              else next.add(ref);
                                              return next;
                                            });
                                          }}
                                          className="h-4 w-4 rounded border-[#d3bb73]/40 bg-[#141827] accent-[#d3bb73]"
                                        />
                                        {matched
                                          ? 'Dopasowana'
                                          : linkedToSelectedTransaction
                                            ? 'Dopasowana do tej płatności'
                                            : alreadyLinked
                                              ? 'Dopasowana do innej płatności'
                                              : 'Zaznacz'}
                                      </label>
                                      <span className="rounded bg-sky-400/10 px-2 py-0.5 text-[10px] uppercase text-sky-200">{document.paymentStatus}</span>
                                    </div>
                                  </div>
                                  <dl className="mt-4 grid grid-cols-[100px_1fr] gap-x-3 gap-y-2 text-xs">
                                    <dt className="text-[#e5e4e2]/40">Numer</dt><dd className="break-words font-medium text-[#e5e4e2]">{document.number || '—'}</dd>
                                    <dt className="text-[#e5e4e2]/40">Kontrahent</dt><dd className="break-words text-[#e5e4e2]">{document.counterparty || '—'}</dd>
                                    <dt className="text-[#e5e4e2]/40">Wystawienie</dt><dd className="text-[#e5e4e2]">{document.issueDate || '—'}</dd>
                                    <dt className="text-[#e5e4e2]/40">Termin</dt><dd className="text-[#e5e4e2]">{document.dueDate || '—'}</dd>
                                    {alreadyLinked && document.source === 'personnel' ? (
                                      <>
                                        <dt className="text-[#e5e4e2]/40">Kwota</dt><dd className="font-medium text-sky-100">{money(document.grossAmount, document.currency)}</dd>
                                        <dt className="text-[#e5e4e2]/40">Powiązanie</dt><dd className="text-green-200">Ta wypłata została już rozliczona z płatnością bankową.</dd>
                                      </>
                                    ) : Math.abs(document.grossAmount - document.amount) > 0.01 ? (
                                      <>
                                        <dt className="text-[#e5e4e2]/40">Brutto</dt><dd className="text-[#e5e4e2]">{money(document.grossAmount, document.currency)}</dd>
                                        <dt className="text-[#e5e4e2]/40">Zaliczki</dt><dd className="text-emerald-200">− {money(document.settledAmount, document.currency)}</dd>
                                        <dt className="text-[#e5e4e2]/40">Do dopłaty</dt><dd className="font-medium text-[#d3bb73]">{money(document.amount, document.currency)}</dd>
                                      </>
                                    ) : (
                                      <><dt className="text-[#e5e4e2]/40">Kwota</dt><dd className="font-medium text-sky-100">{money(document.amount, document.currency)}</dd></>
                                    )}
                                  </dl>
                                  {document.accountingNote && (
                                    <div className="mt-3 rounded-lg border border-amber-300/20 bg-amber-300/5 p-2.5 text-[11px] leading-relaxed text-amber-100/85">
                                      <strong className="text-amber-200">Wcześniejsze uwagi do dokumentu:</strong>{' '}
                                      <span className="whitespace-pre-wrap">{document.accountingNote}</span>
                                    </div>
                                  )}
                                  {selectedTransaction
                                    && document.source === 'external'
                                    && document.currency.toUpperCase() !== selectedTransaction.currency.toUpperCase()
                                    && (
                                      <div className="mt-3 rounded-lg border border-violet-400/20 bg-violet-400/5 p-2.5 text-[11px] leading-relaxed text-violet-100/85">
                                        <strong className="text-violet-200">Przewalutowanie:</strong>{' '}
                                        faktura {money(document.amount, document.currency)} ↔ płatność {money(selectedTransaction.remainingAmount, selectedTransaction.currency)}.
                                        {' '}Kurs wynikowy {(selectedTransaction.remainingAmount / document.amount).toFixed(4)} {selectedTransaction.currency}/{document.currency}; sprawdź go na PDF lub potwierdzeniu karty.
                                      </div>
                                    )}
                                  {(document.sourceDocumentNumbers.length > 0 || document.settlementDocumentNumbers.length > 0) && (
                                    <div className="mt-3 rounded-lg border border-emerald-400/15 bg-emerald-400/5 p-2.5 text-[11px] leading-relaxed text-emerald-100/80">
                                      <strong className="text-emerald-200">Łańcuch rozliczenia:</strong>{' '}
                                      {document.sourceDocumentNumbers.length > 0 && `proforma ${document.sourceDocumentNumbers.join(', ')} → `}
                                      {document.settlementDocumentNumbers.length > 0 && `zaliczka ${document.settlementDocumentNumbers.join(', ')} → `}
                                      faktura końcowa {document.number}
                                    </div>
                                  )}
                                </article>
                              );
                            })}
                            {visibleDocumentRefs.length === 0 && (
                              <div className="rounded-lg border border-[#d3bb73]/10 bg-[#141827] px-4 py-10 text-center text-sm text-[#e5e4e2]/45">
                                Brak dokumentów pasujących do wyszukiwania.
                              </div>
                            )}
                            {availableDocumentRefs.some((ref) => {
                              const document = maps.documents.get(ref);
                              return Boolean(
                                document
                                && !document.linkedTransactionId
                                && document.amount > 0.009
                                && !isDocumentConfirmed(ref, matchedKeys),
                              );
                            }) && (
                              <div className="sticky bottom-0 rounded-lg border border-[#d3bb73]/25 bg-[#141827] p-3 shadow-xl">
                                {canFlagSelectedDocumentsForExplanation && (
                                  <div className="mb-3 rounded-lg border border-amber-300/20 bg-amber-300/5 p-3">
                                    <label className="flex cursor-pointer items-start gap-2.5 text-xs text-amber-100">
                                      <input
                                        type="checkbox"
                                        checked={matchNeedsExplanation}
                                        onChange={(event) => setMatchNeedsExplanation(event.target.checked)}
                                        className="mt-0.5 h-4 w-4 accent-[#d3bb73]"
                                      />
                                      <span>
                                        <strong className="block text-amber-200">Wymaga dodatkowego wyjaśnienia</strong>
                                        <span className="mt-0.5 block text-[11px] leading-relaxed text-amber-100/65">
                                          Faktura pozostanie oznaczona do kontroli również po zapisaniu dopasowania.
                                        </span>
                                      </span>
                                    </label>
                                    {matchNeedsExplanation && (
                                      <label className="mt-3 block text-[11px] text-[#e5e4e2]/60">
                                        Uwaga do rozliczenia
                                        <textarea
                                          value={matchExplanation}
                                          onChange={(event) => setMatchExplanation(event.target.value)}
                                          rows={2}
                                          maxLength={2000}
                                          placeholder="Np. faktura zostanie skorygowana lub zastąpiona — przed zamknięciem miesiąca sprawdzić nowy dokument."
                                          className="mt-1.5 w-full resize-y rounded-lg border border-amber-300/20 bg-[#1c1f33] px-3 py-2 text-xs text-[#e5e4e2] outline-none placeholder:text-[#e5e4e2]/25 focus:border-amber-300/50"
                                        />
                                        {selectedDocuments.length > 1 && (
                                          <span className="mt-1 block text-amber-100/55">
                                            Ta sama uwaga zostanie przypisana do wszystkich zaznaczonych faktur.
                                          </span>
                                        )}
                                      </label>
                                    )}
                                  </div>
                                )}
                                <div className="mb-3 flex items-center justify-between gap-3 text-xs">
                                  <span className="text-[#e5e4e2]/55">
                                    Zaznaczono: <strong className="text-[#e5e4e2]">{selectedDocuments.length}</strong>
                                  </span>
                                  <span className={selectionExceedsPayment ? 'font-medium text-red-300' : 'font-medium text-[#d3bb73]'}>
                                    Do przypisania: {money(selectedDocumentsTotal, selectedTransaction.currency)}
                                  </span>
                                </div>
                                {selectionExceedsPayment && (
                                  <p className="mb-3 rounded bg-red-400/10 px-2.5 py-2 text-[11px] text-red-200">
                                    Suma dokumentów przekracza pozostałą kwotę płatności. Odznacz część pozycji.
                                  </p>
                                )}
                                {hasUnsupportedCurrencySelection && (
                                  <p className="mb-3 rounded bg-red-400/10 px-2.5 py-2 text-[11px] text-red-200">
                                    Dokument walutowy można dopasować tylko pojedynczo.
                                  </p>
                                )}
                                {hasUnsupportedPersonnelSelection && (
                                  <p className="mb-3 rounded bg-red-400/10 px-2.5 py-2 text-[11px] text-red-200">
                                    Wynagrodzenie lub inną opłatę kadrową dopasuj pojedynczo.
                                  </p>
                                )}
                                {selectedDocuments.length === 1
                                  && selectedDocuments[0].source !== 'personnel'
                                  && selectedDocuments[0].amount > selectedTransaction.remainingAmount + 0.01
                                  && (
                                    <p className="mb-3 rounded bg-sky-400/10 px-2.5 py-2 text-[11px] text-sky-100">
                                      Zostanie zapisane dopasowanie częściowe na kwotę płatności: {money(selectedTransaction.remainingAmount, selectedTransaction.currency)}.
                                    </p>
                                  )}
                                <button
                                  type="button"
                                  disabled={
                                    selectedDocuments.length === 0
                                    || selectionExceedsPayment
                                    || hasUnsupportedCurrencySelection
                                    || hasUnsupportedPersonnelSelection
                                    || (canFlagSelectedDocumentsForExplanation
                                      && matchNeedsExplanation
                                      && !matchExplanation.trim())
                                    || matchingKey === bulkMatchingKey
                                    || selectedTransaction.remainingAmount <= 0.009
                                  }
                                  onClick={() => void matchSelectedDocuments()}
                                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-3 py-2.5 text-sm font-medium text-[#141827] disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {matchingKey === bulkMatchingKey ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                                  {matchingKey === bulkMatchingKey
                                    ? 'Dopasowuję…'
                                    : selectedDocuments.length === 1
                                      ? 'Dopasuj 1 dokument'
                                      : selectedDocuments.length >= 2 && selectedDocuments.length <= 4
                                        ? `Dopasuj ${selectedDocuments.length} dokumenty`
                                        : `Dopasuj ${selectedDocuments.length} dokumentów`}
                                </button>
                              </div>
                            )}
                          </section>
                        </div>
                      </div>
                    )}
                  </main>
                </div>
              )}

              {detailsTab === 'missing' && (
                <div className="h-full overflow-y-auto rounded-lg border border-red-400/15 bg-[#1c1f33] p-4">
                  <div className="grid gap-3 lg:grid-cols-2">
                    {analysis.missingDocuments.map((item, index) => (
                      <article key={`${item.transactionRef}-${index}`} className={`rounded border p-4 text-xs ${priorityClasses(item.priority)}`}>
                        <div className="flex justify-between gap-3"><strong>{documentTypeLabels[item.documentType]}</strong><span className="uppercase opacity-60">{priorityLabel(item.priority)}</span></div>
                        <p className="mt-2 text-[#e5e4e2]/70">{transactionLabel(maps.transactions.get(item.transactionRef))}</p>
                        {maps.transactions.get(item.transactionRef)?.accountingNote && <p className="mt-2 rounded bg-emerald-400/10 px-2.5 py-2 text-emerald-100">Opis: {maps.transactions.get(item.transactionRef)?.accountingNote}</p>}
                        <p className="mt-2 opacity-80">{item.reason}</p><p className="mt-2 font-medium text-[#d3bb73]">{item.recommendedAction}</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button type="button" onClick={() => openTransactionMatches(item.transactionRef)} className="inline-flex items-center gap-2 rounded-lg border border-[#d3bb73]/30 bg-[#141827]/60 px-3 py-2 font-medium text-[#d3bb73] hover:bg-[#d3bb73]/10"><Search className="h-3.5 w-3.5" /> Sprawdź powiązania</button>
                          <button type="button" onClick={() => openCounterpartyMapping(item.transactionRef)} className="inline-flex items-center gap-2 rounded-lg border border-[#d3bb73]/30 bg-[#141827]/60 px-3 py-2 font-medium text-[#d3bb73] hover:bg-[#d3bb73]/10"><BookOpenCheck className="h-3.5 w-3.5" /> Dodaj do mapowań</button>
                          <button type="button" onClick={() => openTransactionNote(item.transactionRef, item.documentType)} className="inline-flex items-center gap-2 rounded-lg border border-[#d3bb73]/30 bg-[#141827]/60 px-3 py-2 font-medium text-[#d3bb73] hover:bg-[#d3bb73]/10"><MessageSquareText className="h-3.5 w-3.5" /> Opisz płatność</button>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              )}

              {detailsTab === 'transactions' && (
                <div className="h-full overflow-y-auto rounded-lg border border-amber-400/15 bg-[#1c1f33] p-4">
                  <div className="grid gap-3 lg:grid-cols-2">
                    {analysis.reviewTransactions.map((item, index) => (
                      <article key={`${item.transactionRef}-${index}`} className={`rounded border p-4 text-xs ${priorityClasses(item.priority)}`}>
                        <strong>{transactionLabel(maps.transactions.get(item.transactionRef))}</strong><p className="mt-2 opacity-80">{item.reason}</p><p className="mt-2 font-medium text-[#d3bb73]">{item.recommendedAction}</p>
                        {maps.transactions.get(item.transactionRef)?.accountingNote && <p className="mt-2 rounded bg-emerald-400/10 px-2.5 py-2 text-emerald-100">Opis: {maps.transactions.get(item.transactionRef)?.accountingNote}</p>}
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button type="button" onClick={() => openTransactionMatches(item.transactionRef)} className="inline-flex items-center gap-2 rounded-lg border border-[#d3bb73]/30 bg-[#141827]/60 px-3 py-2 font-medium text-[#d3bb73] hover:bg-[#d3bb73]/10"><Search className="h-3.5 w-3.5" /> Sprawdź powiązania</button>
                          <button type="button" onClick={() => openCounterpartyMapping(item.transactionRef)} className="inline-flex items-center gap-2 rounded-lg border border-[#d3bb73]/30 bg-[#141827]/60 px-3 py-2 font-medium text-[#d3bb73] hover:bg-[#d3bb73]/10"><BookOpenCheck className="h-3.5 w-3.5" /> Dodaj do mapowań</button>
                          <button type="button" onClick={() => openTransactionNote(item.transactionRef)} className="inline-flex items-center gap-2 rounded-lg border border-[#d3bb73]/30 bg-[#141827]/60 px-3 py-2 font-medium text-[#d3bb73] hover:bg-[#d3bb73]/10"><MessageSquareText className="h-3.5 w-3.5" /> Opisz płatność</button>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              )}

              {detailsTab === 'documents' && (
                <div className="h-full overflow-y-auto rounded-lg border border-sky-400/15 bg-[#1c1f33] p-4">
                  <div className="grid gap-3 lg:grid-cols-2">
                    {analysis.reviewDocuments.map((item, index) => (
                      <article key={`${item.documentRef}-${index}`} className={`rounded border p-4 text-xs ${priorityClasses(item.priority)}`}>
                        <strong>{documentLabel(maps.documents.get(item.documentRef))}</strong><p className="mt-2 opacity-80">{item.reason}</p><p className="mt-2 font-medium text-[#d3bb73]">{item.recommendedAction}</p>
                        {maps.documents.get(item.documentRef)?.accountingNote && <p className="mt-2 rounded bg-sky-400/10 px-2.5 py-2 text-sky-100">Opis: {maps.documents.get(item.documentRef)?.accountingNote}</p>}
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button type="button" disabled={otherMonthsLoading} onClick={() => void openDocumentMatches(item.documentRef)} className="inline-flex items-center gap-2 rounded-lg border border-[#d3bb73]/30 bg-[#141827]/60 px-3 py-2 font-medium text-[#d3bb73] hover:bg-[#d3bb73]/10 disabled:opacity-50">{otherMonthsLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />} Znajdź płatność</button>
                          <button type="button" onClick={() => openDocumentNote(item.documentRef)} className="inline-flex items-center gap-2 rounded-lg border border-[#d3bb73]/30 bg-[#141827]/60 px-3 py-2 font-medium text-[#d3bb73] hover:bg-[#d3bb73]/10"><MessageSquareText className="h-3.5 w-3.5" /> Opisz dokument</button>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {analysis.warnings.length > 0 && (
              <footer className="flex items-start gap-2 border-t border-[#d3bb73]/10 px-5 py-2 text-[11px] text-[#e5e4e2]/45">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#d3bb73]" />
                <span className="line-clamp-2">{analysis.warnings.join(' • ')}</span>
              </footer>
            )}
          </div>
        </div>
      )}

      {noteEditor && (
        <div className="fixed inset-0 z-[10070] flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-xl rounded-xl border border-[#d3bb73]/25 bg-[#141827] shadow-2xl">
            <header className="flex items-start justify-between border-b border-[#d3bb73]/15 px-5 py-4">
              <div><h3 className="text-lg font-medium text-[#e5e4e2]">{noteEditor.kind === 'transaction' ? 'Opis płatności' : 'Opis dokumentu'}</h3><p className="mt-1 text-xs text-[#e5e4e2]/45">Notatka będzie widoczna przy kolejnych analizach i podczas ręcznej kontroli.</p></div>
              <button type="button" onClick={() => setNoteEditor(null)} className="rounded p-2 text-[#e5e4e2]/55 hover:bg-white/5"><X className="h-5 w-5" /></button>
            </header>
            <div className="space-y-4 p-5">
              {noteEditor.kind === 'transaction' && <label className="block text-xs text-[#e5e4e2]/65">Rodzaj płatności<select value={noteCategory} onChange={(event) => setNoteCategory(event.target.value)} className="mt-2 w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2.5 text-sm text-[#e5e4e2] outline-none">{Object.entries(accountingCategoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
              <label className="block text-xs text-[#e5e4e2]/65">Opis księgowy<textarea autoFocus value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} rows={5} maxLength={2000} placeholder={noteEditor.kind === 'transaction' ? 'Np. miesięczna prowizja bankowa — dokumentem źródłowym jest wyciąg bankowy.' : 'Dodaj informacje pomocne przy rozliczeniu tego dokumentu…'} className="mt-2 w-full resize-y rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2.5 text-sm text-[#e5e4e2] outline-none placeholder:text-[#e5e4e2]/25" /></label>
              {noteEditor.kind === 'transaction' && <label className="flex items-start gap-3 rounded-lg border border-emerald-400/15 bg-emerald-400/5 p-3 text-xs text-emerald-100/85"><input type="checkbox" checked={noteExplained} onChange={(event) => setNoteExplained(event.target.checked)} className="mt-0.5 h-4 w-4 accent-[#d3bb73]" /><span><strong className="block text-emerald-200">Wyjaśnione bez faktury</strong>Włącz dla opłaty bankowej, podatku, ZUS lub innej płatności, której podstawą nie jest faktura.</span></label>}
            </div>
            <footer className="flex justify-end gap-2 border-t border-[#d3bb73]/10 px-5 py-4"><button type="button" onClick={() => setNoteEditor(null)} className="rounded-lg border border-[#d3bb73]/20 px-4 py-2 text-sm text-[#e5e4e2]/70 hover:bg-white/5">Anuluj</button><button type="button" disabled={noteSaving || !noteDraft.trim()} onClick={() => void saveAccountingNote()} className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#141827] disabled:opacity-50">{noteSaving && <Loader2 className="h-4 w-4 animate-spin" />} Zapisz opis</button></footer>
          </div>
        </div>
      )}

      {mappingEditorRef && (
        <div className="fixed inset-0 z-[10080] flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-xl rounded-xl border border-[#d3bb73]/25 bg-[#141827] shadow-2xl">
            <header className="flex items-start justify-between border-b border-[#d3bb73]/15 px-5 py-4">
              <div>
                <h3 className="text-lg font-medium text-[#e5e4e2]">Szablon rozpoznawania kontrahenta</h3>
                <p className="mt-1 text-xs text-[#e5e4e2]/45">Po tym fragmencie system rozpozna kontrahenta w kolejnych transakcjach tej działalności.</p>
              </div>
              <button type="button" onClick={() => setMappingEditorRef(null)} className="rounded p-2 text-[#e5e4e2]/55 hover:bg-white/5"><X className="h-5 w-5" /></button>
            </header>
            <div className="space-y-4 p-5">
              <label className="block text-xs text-[#e5e4e2]/65">Fragment widoczny w płatności<input autoFocus value={mappingAliasDraft} onChange={(event) => setMappingAliasDraft(event.target.value)} maxLength={180} placeholder="np. OLSZTYN PL HOTEL WARMI NSKI" className="mt-2 w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2.5 text-sm text-[#e5e4e2] outline-none placeholder:text-[#e5e4e2]/25" /></label>
              <label className="block text-xs text-[#e5e4e2]/65">Właściwa nazwa kontrahenta<input value={mappingCounterpartyDraft} onChange={(event) => setMappingCounterpartyDraft(event.target.value)} maxLength={240} placeholder='np. "MAZUR-TOURIST" Sp. z o.o. UL. KOŁOBRZESKA 1' className="mt-2 w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2.5 text-sm text-[#e5e4e2] outline-none placeholder:text-[#e5e4e2]/25" /></label>
              <label className="block text-xs text-[#e5e4e2]/65">NIP kontrahenta — opcjonalnie<input value={mappingNipDraft} onChange={(event) => setMappingNipDraft(event.target.value)} inputMode="numeric" maxLength={13} placeholder="10 cyfr" className="mt-2 w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2.5 text-sm text-[#e5e4e2] outline-none placeholder:text-[#e5e4e2]/25" /></label>
              <p className="rounded-lg border border-sky-400/15 bg-sky-400/5 p-3 text-xs leading-relaxed text-sky-100/75">Użyj możliwie charakterystycznego fragmentu, ale pomiń numery rachunku, identyfikatory karty i datę. Mapowanie wzmacnia podpowiedź — kwota, kierunek i dokument nadal są sprawdzane.</p>
            </div>
            <footer className="flex justify-end gap-2 border-t border-[#d3bb73]/10 px-5 py-4"><button type="button" onClick={() => setMappingEditorRef(null)} className="rounded-lg border border-[#d3bb73]/20 px-4 py-2 text-sm text-[#e5e4e2]/70 hover:bg-white/5">Anuluj</button><button type="button" disabled={mappingSaving || normalizeCounterpartyAlias(mappingAliasDraft).length < 4 || !mappingCounterpartyDraft.trim()} onClick={() => void saveCounterpartyMapping()} className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#141827] disabled:opacity-50">{mappingSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <BookOpenCheck className="h-4 w-4" />} Zapisz szablon</button></footer>
          </div>
        </div>
      )}

      {invoiceDetails && (
        <InvoiceDetailsModal
          invoice={invoiceDetails}
          onClose={() => setInvoiceDetails(null)}
          overlayClassName="z-[10100]"
        />
      )}

      {showTransactionPicker && selectedMatch && (
        <div className="fixed inset-0 z-[10040] flex items-center justify-center bg-black/80 p-4">
          <div className="flex max-h-[84vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-[#d3bb73]/25 bg-[#141827] shadow-2xl">
            <header className="flex items-start justify-between border-b border-[#d3bb73]/15 px-5 py-4">
              <div>
                <h3 className="text-lg font-medium text-[#e5e4e2]">Wybierz inną płatność</h3>
                <p className="mt-1 text-xs text-[#e5e4e2]/50">
                  {searchOtherMonths
                    ? 'Pokazujemy zgodne nierozliczone płatności z 12 miesięcy przed i po analizowanym miesiącu.'
                    : 'Pokazujemy nierozliczone płatności z analizowanego miesiąca, zgodne z działalnością, walutą i kierunkiem dokumentu.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowTransactionPicker(false)}
                className="rounded p-2 text-[#e5e4e2]/55 hover:bg-white/5 hover:text-[#e5e4e2]"
              >
                <X className="h-5 w-5" />
              </button>
            </header>

            <div className="border-b border-[#d3bb73]/10 p-4">
              <div className="mb-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => setSearchOtherMonths(false)} className={`rounded-lg border px-3 py-1.5 text-xs ${!searchOtherMonths ? 'border-[#d3bb73] bg-[#d3bb73]/10 text-[#d3bb73]' : 'border-[#d3bb73]/15 text-[#e5e4e2]/55'}`}>Analizowany miesiąc</button>
                <button type="button" disabled={otherMonthsLoading} onClick={() => { setSearchOtherMonths(true); void loadOtherMonthsTransactions(); }} className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs ${searchOtherMonths ? 'border-[#d3bb73] bg-[#d3bb73]/10 text-[#d3bb73]' : 'border-[#d3bb73]/15 text-[#e5e4e2]/55'}`}>{otherMonthsLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Wszystkie miesiące ±12</button>
              </div>
              <label className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2">
                <Search className="h-4 w-4 shrink-0 text-[#d3bb73]" />
                <input
                  autoFocus
                  value={transactionSearch}
                  onChange={(event) => setTransactionSearch(event.target.value)}
                  placeholder="Szukaj po kwocie, dacie, kontrahencie lub tytule przelewu…"
                  className="min-w-0 flex-1 bg-transparent text-sm text-[#e5e4e2] outline-none placeholder:text-[#e5e4e2]/30"
                />
              </label>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {compatibleTransactions.length === 0 ? (
                <div className="py-12 text-center text-sm text-[#e5e4e2]/50">
                  <p>Nie znaleziono zgodnej nierozliczonej płatności.</p>
                  {!searchOtherMonths && (
                    <button type="button" disabled={otherMonthsLoading} onClick={() => { setSearchOtherMonths(true); void loadOtherMonthsTransactions(); }} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-[#d3bb73]/25 px-3 py-2 text-xs font-medium text-[#d3bb73] hover:bg-[#d3bb73]/10 disabled:opacity-50">
                      {otherMonthsLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                      Szukaj w innych miesiącach
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  {compatibleTransactions.map((transaction) => (
                    <button
                      key={transaction.ref}
                      type="button"
                      onClick={() => {
                        setSelectedTransactionRef(transaction.ref);
                        setShowTransactionPicker(false);
                      }}
                      className={`w-full rounded-lg border p-3 text-left hover:border-[#d3bb73]/50 ${
                        selectedTransaction?.ref === transaction.ref
                          ? 'border-[#d3bb73] bg-[#d3bb73]/10'
                          : 'border-[#d3bb73]/12 bg-[#1c1f33]'
                      }`}
                    >
                      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
                        <div className="min-w-0">
                          <div className="text-xs text-[#e5e4e2]/45">{transaction.date || 'bez daty'}</div>
                          <div className="mt-1 inline-flex rounded bg-[#d3bb73]/10 px-2 py-0.5 text-[10px] uppercase text-[#d3bb73]">{transactionStatementLabel(transaction)}</div>
                          {!belongsToAnalysedMonth(transaction.date, year, month) && <div className="mt-1 inline-flex rounded bg-sky-400/10 px-2 py-0.5 text-[10px] uppercase text-sky-200">inny miesiąc</div>}
                          <div className="mt-1 font-medium text-[#e5e4e2]">{transaction.mappedCounterparty || transaction.counterparty || 'Brak kontrahenta'}</div>
                          {transaction.mappedCounterparty && <div className="mt-0.5 text-[10px] text-green-300/70">rozpoznano z szablonu „{transaction.mappingAlias}”</div>}
                          <div className="mt-1 whitespace-pre-wrap text-xs text-[#e5e4e2]/55 [overflow-wrap:anywhere]">{transaction.title || 'Brak tytułu'}</div>
                        </div>
                        <div className="shrink-0 text-right">
                          <strong className="text-amber-100">{money(transaction.remainingAmount, transaction.currency)}</strong>
                          {pickerDocument && Math.abs(transaction.remainingAmount - pickerDocument.amount) < 0.01 && (
                            <div className="mt-1 text-[10px] uppercase text-green-300">zgodna kwota</div>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
