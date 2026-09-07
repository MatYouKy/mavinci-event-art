'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileText,
  Landmark,
  Loader2,
  Mail,
  RefreshCw,
  Send,
  ShieldCheck,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { dispatchCrmEmail } from '@/lib/emailScheduling';
import {
  loadUnifiedEmailAccounts,
  type UnifiedEmailAccount,
} from '@/components/crm/UnifiedEmailComposer';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { decodeTextEntities } from '@/lib/textEncoding';

type SaldeoDocumentType = 'FK' | 'DS' | 'P';
type DeliverySource = 'external_invoice' | 'local_invoice' | 'bank_supporting_document';

interface CompanyOption {
  id: string;
  name: string;
  is_default: boolean | null;
  saldeo_document_email: string | null;
  accountant_email: string | null;
}

interface StatementRow {
  id: string;
  file_name: string;
  file_type: string;
  file_storage_path: string | null;
  account_type: string | null;
}

interface TransactionRow {
  id: string;
  statement_id: string;
  transaction_date: string;
  posting_date: string | null;
  amount: number;
  currency: string;
  transaction_type: 'debit' | 'credit';
  counterparty_name: string | null;
  counterparty_account: string | null;
  title: string | null;
  reference_number: string | null;
  match_status: string | null;
  allocated_amount: number | null;
  matched_document_count: number | null;
  accounting_review_status: string | null;
  accounting_subtype: string | null;
  accounting_note: string | null;
  private_transfer_detected: boolean | null;
}

interface DeliveryCandidate {
  sourceType: DeliverySource;
  sourceId: string;
  saldeoType: SaldeoDocumentType;
  bucket: string;
  path: string;
  filename: string;
  title: string;
  fileSize: number | null;
  deliveredAt: string | null;
}

interface PreparedAttachment {
  document: DeliveryCandidate;
  filename: string;
  content: string;
  contentType: string;
  size: number;
}

interface TransactionMatchDetail {
  transactionId: string;
  source: 'CRM' | 'KSeF' | 'Poza KSeF' | 'Kadry';
  documentId: string;
  documentNumber: string;
  counterparty: string;
  allocatedAmount: number;
  documentAmount: number | null;
  currency: string;
  description: string;
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

const ACCOUNTING_LABELS: Record<string, string> = {
  automatic_vat_transfer: 'Automatyczny transfer: rachunek bieżący ↔ VAT',
  vat7_payment: 'Płatność VAT-7 / JPK_V7 do urzędu',
  pit4_payment: 'Płatność PIT-4R',
  zus_payment: 'Płatność ZUS',
  payroll_payment: 'Wynagrodzenie / lista płac',
  bank_fee: 'Opłata lub prowizja bankowa',
  own_transfer: 'Przelew między własnymi kontami',
  cash_settlement: 'Rozliczenie gotówkowe',
  supplier_invoice_missing: 'Brak faktury od dostawcy',
  other: 'Inne wyjaśnienie',
};

const PERSONNEL_PAYMENT_LABELS: Record<string, string> = {
  salary: 'Wynagrodzenie',
  advance: 'Zaliczka pracownicza',
  tax: 'Podatek od wynagrodzenia',
  zus: 'Składki ZUS',
  reimbursement: 'Zwrot kosztów pracownika',
  other: 'Inna płatność kadrowa',
};

const inputClass =
  'w-full rounded-lg border border-white/10 bg-[#0a0d1a] px-3 py-2.5 text-sm text-[#e5e4e2] outline-none transition-colors hover:border-white/20 focus:border-[#d3bb73]/40';

function csvEscape(value: unknown) {
  const raw = String(value ?? '');
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

function safeFilename(value: string) {
  const normalized = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return normalized.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'dokument';
}

function extensionFromPath(path: string, fallback = 'pdf') {
  const filename = path.split('/').pop() || '';
  const extension = filename.includes('.') ? filename.split('.').pop() : '';
  return String(extension || fallback).toLowerCase().replace(/[^a-z0-9]/g, '') || fallback;
}

function contentTypeFor(filename: string) {
  const extension = extensionFromPath(filename, 'bin');
  if (extension === 'pdf') return 'application/pdf';
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  return 'application/octet-stream';
}

function monthBounds(year: number, month: number) {
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const next = new Date(Date.UTC(year, month, 1));
  const end = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-01`;
  return { start, end };
}

function transactionStatus(transaction: TransactionRow) {
  if (transaction.private_transfer_detected) return 'Prywatna — bez faktury';
  if (transaction.accounting_review_status === 'explained') {
    return ACCOUNTING_LABELS[transaction.accounting_subtype || ''] || 'Wyjaśniona bez faktury';
  }
  if (transaction.match_status === 'matched') return 'Dopasowana';
  if (transaction.match_status === 'partial') return 'Częściowo dopasowana';
  return 'Brak dopasowania';
}

function buildCsv(rows: unknown[][]) {
  return `\uFEFF${rows.map((row) => row.map(csvEscape).join(';')).join('\n')}`;
}

function htmlEscape(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function blobToBase64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunkSize = 8192;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export default function SaldeoDeliveryPanel({
  filterCompanyIds = null,
}: {
  filterCompanyIds?: string[] | null;
}) {
  const { showSnackbar } = useSnackbar();
  const now = new Date();
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [emailAccounts, setEmailAccounts] = useState<UnifiedEmailAccount[]>([]);
  const [emailAccountId, setEmailAccountId] = useState('');
  const [saldeoEmail, setSaldeoEmail] = useState('');
  const [accountantEmail, setAccountantEmail] = useState('');
  const [pin, setPin] = useState('');
  const [includeDelivered, setIncludeDelivered] = useState(false);
  const [statements, setStatements] = useState<StatementRow[]>([]);
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [matchDetails, setMatchDetails] = useState<TransactionMatchDetail[]>([]);
  const [candidates, setCandidates] = useState<DeliveryCandidate[]>([]);
  const [missingFileCount, setMissingFileCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [sendingAccountantPackage, setSendingAccountantPackage] = useState(false);
  const [sendProgress, setSendProgress] = useState('');

  const loadCompaniesAndAccounts = useCallback(async () => {
    try {
      let companyQuery = supabase
        .from('my_companies')
        .select('id,name,is_default,saldeo_document_email,accountant_email')
        .eq('is_active', true)
        .order('is_default', { ascending: false })
        .order('name');
      if (filterCompanyIds?.length) companyQuery = companyQuery.in('id', filterCompanyIds);

      const [companyResult, accounts] = await Promise.all([
        companyQuery,
        loadUnifiedEmailAccounts(),
      ]);
      if (companyResult.error) throw companyResult.error;

      const companyRows = (companyResult.data || []) as CompanyOption[];
      setCompanies(companyRows);
      setEmailAccounts(accounts);
      setCompanyId((current) =>
        companyRows.some((company) => company.id === current) ? current : companyRows[0]?.id || '',
      );
      setEmailAccountId((current) => current || accounts[0]?.id || '');
    } catch (error: any) {
      console.error('Saldeo configuration load error:', error);
      showSnackbar(error?.message || 'Nie udało się pobrać konfiguracji Saldeo', 'error');
    }
  }, [filterCompanyIds, showSnackbar]);

  useEffect(() => {
    void loadCompaniesAndAccounts();
  }, [loadCompaniesAndAccounts]);

  useEffect(() => {
    const company = companies.find((item) => item.id === companyId);
    setSaldeoEmail(company?.saldeo_document_email || '');
    setAccountantEmail(company?.accountant_email || '');
  }, [companies, companyId]);

  const loadPeriod = useCallback(async () => {
    if (!companyId) {
      setLoading(false);
      setStatements([]);
      setTransactions([]);
      setMatchDetails([]);
      setCandidates([]);
      return;
    }

    setLoading(true);
    try {
      const { start, end } = monthBounds(year, month);
      const [statementResult, externalResult, localResult, deliveryResult] = await Promise.all([
        supabase
          .from('bank_statements')
          .select('id,file_name,file_type,file_storage_path,account_type')
          .eq('my_company_id', companyId)
          .eq('statement_month', month)
          .eq('statement_year', year)
          .order('account_type'),
        supabase
          .from('external_invoices')
          .select('id,invoice_number,label,file_url,invoice_date,payment_status')
          .eq('my_company_id', companyId)
          .gte('invoice_date', start)
          .lt('invoice_date', end)
          .neq('payment_status', 'cancelled')
          .order('invoice_date'),
        supabase
          .from('invoices')
          .select('id,invoice_number,issue_date,pdf_url,status,ksef_status')
          .eq('my_company_id', companyId)
          .gte('issue_date', start)
          .lt('issue_date', end)
          .order('issue_date'),
        supabase
          .from('saldeo_delivery_log')
          .select('source_type,source_id,delivered_at')
          .eq('my_company_id', companyId)
          .eq('period_month', month)
          .eq('period_year', year)
          .order('delivered_at', { ascending: false }),
      ]);

      const firstError = statementResult.error || externalResult.error || localResult.error || deliveryResult.error;
      if (firstError) throw firstError;

      const statementRows = (statementResult.data || []) as StatementRow[];
      setStatements(statementRows);

      let transactionRows: TransactionRow[] = [];
      let supportingRows: any[] = [];
      let loadedMatchDetails: TransactionMatchDetail[] = [];
      const statementIds = statementRows.map((statement) => statement.id);
      if (statementIds.length) {
        const transactionResult = await supabase
          .from('bank_transactions')
          .select(
            'id,statement_id,transaction_date,posting_date,amount,currency,transaction_type,counterparty_name,counterparty_account,title,reference_number,match_status,allocated_amount,matched_document_count,accounting_review_status,accounting_subtype,accounting_note,private_transfer_detected',
          )
          .in('statement_id', statementIds)
          .order('transaction_date');
        if (transactionResult.error) throw transactionResult.error;
        transactionRows = (transactionResult.data || []) as TransactionRow[];

        if (transactionRows.length) {
          const transactionIds = transactionRows.map((transaction) => transaction.id);
          const [supportResult, invoiceMatchesResult, personnelPaymentsResult] = await Promise.all([
            supabase
              .from('bank_transaction_supporting_documents')
              .select('id,bank_transaction_id,title,storage_path,original_file_name,mime_type,file_size')
              .in('bank_transaction_id', transactionIds)
              .order('created_at'),
            supabase
              .from('bank_transaction_invoice_matches')
              .select('id,bank_transaction_id,document_source,invoice_id,ksef_invoice_id,external_invoice_id,amount,document_amount,currency')
              .in('bank_transaction_id', transactionIds),
            supabase
              .from('personnel_contract_payments')
              .select('id,bank_transaction_id,amount,currency,payment_type,recipient_name,title,personnel_contract_id,personnel_contracts(contract_number,party_name)')
              .in('bank_transaction_id', transactionIds),
          ]);
          const relationError = supportResult.error || invoiceMatchesResult.error || personnelPaymentsResult.error;
          if (relationError) throw relationError;
          supportingRows = supportResult.data || [];

          const invoiceMatches = invoiceMatchesResult.data || [];
          const crmIds = invoiceMatches.map((match: any) => match.invoice_id).filter(Boolean);
          const ksefIds = invoiceMatches.map((match: any) => match.ksef_invoice_id).filter(Boolean);
          const externalIds = invoiceMatches.map((match: any) => match.external_invoice_id).filter(Boolean);
          const emptyResult = Promise.resolve({ data: [], error: null });
          const [crmResult, ksefResult, externalDocumentResult] = await Promise.all([
            crmIds.length
              ? supabase.from('invoices').select('id,invoice_number,buyer_name,total_gross,currency_code').in('id', crmIds)
              : emptyResult,
            ksefIds.length
              ? supabase.from('ksef_invoices').select('id,invoice_number,seller_name,buyer_name,gross_amount,currency,invoice_type').in('id', ksefIds)
              : emptyResult,
            externalIds.length
              ? supabase.from('external_invoices').select('id,invoice_number,seller_name,amount_gross,currency').in('id', externalIds)
              : emptyResult,
          ]);
          const documentError = crmResult.error || ksefResult.error || externalDocumentResult.error;
          if (documentError) throw documentError;

          const crmById = new Map((crmResult.data || []).map((document: any) => [document.id, document]));
          const ksefById = new Map((ksefResult.data || []).map((document: any) => [document.id, document]));
          const externalById = new Map((externalDocumentResult.data || []).map((document: any) => [document.id, document]));

          loadedMatchDetails = invoiceMatches.map((match: any) => {
            if (match.document_source === 'invoice') {
              const document: any = crmById.get(match.invoice_id);
              return {
                transactionId: match.bank_transaction_id,
                source: 'CRM' as const,
                documentId: match.invoice_id,
                documentNumber: document?.invoice_number || 'Dokument CRM bez numeru',
                counterparty: document?.buyer_name || '',
                allocatedAmount: Number(match.amount || 0),
                documentAmount: document?.total_gross == null ? null : Number(document.total_gross),
                currency: document?.currency_code || match.currency || 'PLN',
                description: 'Faktura wystawiona w CRM',
              };
            }
            if (match.document_source === 'ksef') {
              const document: any = ksefById.get(match.ksef_invoice_id);
              return {
                transactionId: match.bank_transaction_id,
                source: 'KSeF' as const,
                documentId: match.ksef_invoice_id,
                documentNumber: document?.invoice_number || 'Dokument KSeF bez numeru',
                counterparty: decodeTextEntities(document?.seller_name || document?.buyer_name),
                allocatedAmount: Number(match.amount || 0),
                documentAmount: document?.gross_amount == null ? null : Number(document.gross_amount),
                currency: document?.currency || match.currency || 'PLN',
                description: document?.invoice_type === 'issued' ? 'Sprzedaż KSeF' : 'Zakup KSeF',
              };
            }
            const document: any = externalById.get(match.external_invoice_id);
            return {
              transactionId: match.bank_transaction_id,
              source: 'Poza KSeF' as const,
              documentId: match.external_invoice_id,
              documentNumber: document?.invoice_number || 'Dokument bez numeru',
              counterparty: document?.seller_name || '',
              allocatedAmount: Number(match.amount || 0),
              documentAmount: document?.amount_gross == null
                ? (match.document_amount == null ? null : Number(match.document_amount))
                : Number(document.amount_gross),
              currency: document?.currency || match.currency || 'PLN',
              description: 'Faktura kosztowa spoza KSeF',
            };
          });

          loadedMatchDetails.push(...(personnelPaymentsResult.data || []).map((payment: any) => {
            const contract = Array.isArray(payment.personnel_contracts)
              ? payment.personnel_contracts[0]
              : payment.personnel_contracts;
            return {
              transactionId: payment.bank_transaction_id,
              source: 'Kadry' as const,
              documentId: payment.id,
              documentNumber: contract?.contract_number || payment.title || 'Płatność kadrowa',
              counterparty: payment.recipient_name || contract?.party_name || '',
              allocatedAmount: Number(payment.amount || 0),
              documentAmount: Number(payment.amount || 0),
              currency: payment.currency || 'PLN',
              description: PERSONNEL_PAYMENT_LABELS[payment.payment_type] || payment.title || 'Płatność kadrowa',
            };
          }));
        }
      }
      setTransactions(transactionRows);
      setMatchDetails(loadedMatchDetails);

      const latestDelivery = new Map<string, string>();
      for (const delivery of deliveryResult.data || []) {
        const key = `${delivery.source_type}:${delivery.source_id}`;
        if (!latestDelivery.has(key)) latestDelivery.set(key, delivery.delivered_at);
      }

      const externalRows = externalResult.data || [];
      const localRows = (localResult.data || []).filter(
        (invoice) =>
          !['draft', 'cancelled'].includes(String(invoice.status || '').toLowerCase()) &&
          String(invoice.ksef_status || '').toLowerCase() !== 'accepted',
      );

      const externalCandidates: DeliveryCandidate[] = externalRows
        .filter((invoice) => Boolean(invoice.file_url))
        .map((invoice) => {
          const extension = extensionFromPath(invoice.file_url, 'pdf');
          const key = `external_invoice:${invoice.id}`;
          return {
            sourceType: 'external_invoice',
            sourceId: invoice.id,
            saldeoType: 'FK',
            bucket: 'external-invoices',
            path: invoice.file_url!,
            filename: `${safeFilename(invoice.invoice_number || invoice.label || 'faktura-kosztowa')}.${extension}`,
            title: invoice.invoice_number || invoice.label || 'Faktura kosztowa',
            fileSize: null,
            deliveredAt: latestDelivery.get(key) || null,
          };
        });

      const localCandidates: DeliveryCandidate[] = localRows
        .filter((invoice) => Boolean(invoice.pdf_url))
        .map((invoice) => {
          const key = `local_invoice:${invoice.id}`;
          return {
            sourceType: 'local_invoice',
            sourceId: invoice.id,
            saldeoType: 'DS',
            bucket: 'event-files',
            path: invoice.pdf_url!,
            filename: `${safeFilename(invoice.invoice_number || 'dokument-sprzedazy')}.pdf`,
            title: invoice.invoice_number || 'Dokument sprzedaży',
            fileSize: null,
            deliveredAt: latestDelivery.get(key) || null,
          };
        });

      const supportingCandidates: DeliveryCandidate[] = supportingRows.map((document) => {
        const key = `bank_supporting_document:${document.id}`;
        return {
          sourceType: 'bank_supporting_document',
          sourceId: document.id,
          saldeoType: 'P',
          bucket: 'bank-supporting-documents',
          path: document.storage_path,
          filename: safeFilename(document.original_file_name || document.title || 'dokument-ksiegowy'),
          title: document.title || document.original_file_name || 'Dokument księgowy',
          fileSize: document.file_size == null ? null : Number(document.file_size),
          deliveredAt: latestDelivery.get(key) || null,
        };
      });

      setCandidates([...externalCandidates, ...localCandidates, ...supportingCandidates]);
      setMissingFileCount(
        externalRows.filter((invoice) => !invoice.file_url).length +
          localRows.filter((invoice) => !invoice.pdf_url).length,
      );
    } catch (error: any) {
      console.error('Saldeo period load error:', error);
      setStatements([]);
      setTransactions([]);
      setMatchDetails([]);
      setCandidates([]);
      showSnackbar(error?.message || 'Nie udało się przygotować danych dla Saldeo', 'error');
    } finally {
      setLoading(false);
    }
  }, [companyId, month, year, showSnackbar]);

  useEffect(() => {
    void loadPeriod();
  }, [loadPeriod]);

  const documentsToSend = useMemo(
    () => candidates.filter((document) => includeDelivered || !document.deliveredAt),
    [candidates, includeDelivered],
  );

  const matchesByTransaction = useMemo(() => {
    const grouped = new Map<string, TransactionMatchDetail[]>();
    for (const match of matchDetails) {
      const current = grouped.get(match.transactionId) || [];
      current.push(match);
      grouped.set(match.transactionId, current);
    }
    return grouped;
  }, [matchDetails]);

  const transactionRemaining = useCallback((transaction: TransactionRow) => (
    Math.max(Math.abs(Number(transaction.amount || 0)) - Number(transaction.allocated_amount || 0), 0)
  ), []);

  const unresolvedTransactions = useMemo(
    () => transactions.filter((transaction) => (
      !transaction.private_transfer_detected
      && transaction.accounting_review_status !== 'explained'
      && transactionRemaining(transaction) > 0.01
    )),
    [transactionRemaining, transactions],
  );

  const inconsistentTransactionRelations = useMemo(
    () => transactions.filter((transaction) => {
      if (transaction.private_transfer_detected || transaction.accounting_review_status === 'explained') return false;
      const relationTotal = (matchesByTransaction.get(transaction.id) || [])
        .reduce((sum, relation) => sum + relation.allocatedAmount, 0);
      return Math.abs(relationTotal - Number(transaction.allocated_amount || 0)) > 0.01;
    }),
    [matchesByTransaction, transactions],
  );

  const statementsWithoutFiles = statements.filter((statement) => !statement.file_storage_path);
  const pendingSaldeoCount = candidates.filter((document) => !document.deliveredAt).length;
  const isAccountantPackageReady = transactions.length > 0
    && statements.length > 0
    && unresolvedTransactions.length === 0
    && inconsistentTransactionRelations.length === 0
    && missingFileCount === 0
    && statementsWithoutFiles.length === 0
    && pendingSaldeoCount === 0;

  const deliveredCount = candidates.filter((document) => document.deliveredAt).length;
  const resolvedTransactions = transactions.filter(
    (transaction) =>
      transaction.match_status === 'matched' ||
      transaction.accounting_review_status === 'explained' ||
      transaction.private_transfer_detected,
  ).length;

  const statementNames = useMemo(
    () => new Map(statements.map((statement) => [statement.id, statement.file_name])),
    [statements],
  );

  const reconciliationCsv = useMemo(() => buildCsv([
    [
      'Wyciąg',
      'Data transakcji',
      'Data księgowania',
      'Kierunek',
      'Kwota transakcji',
      'Waluta',
      'Kontrahent',
      'Rachunek kontrahenta',
      'Tytuł',
      'Status uzgodnienia',
      'Rozliczona kwota',
      'Pozostało do wyjaśnienia',
      'Powiązane dokumenty i kwoty',
      'Wyjaśnienie księgowe',
      'Numer referencyjny',
    ],
    ...transactions.map((transaction) => {
      const relations = matchesByTransaction.get(transaction.id) || [];
      const relatedDocuments = relations.map((relation) => (
        `${relation.source}: ${relation.documentNumber} — ${relation.allocatedAmount.toFixed(2)} ${transaction.currency || 'PLN'}`
      )).join(' | ');
      return [
        statementNames.get(transaction.statement_id) || '',
        transaction.transaction_date,
        transaction.posting_date || '',
        transaction.transaction_type === 'credit' ? 'Wpływ' : 'Wydatek',
        Math.abs(Number(transaction.amount || 0)).toFixed(2),
        transaction.currency || 'PLN',
        transaction.counterparty_name || '',
        transaction.counterparty_account || '',
        transaction.title || '',
        transactionStatus(transaction),
        Number(transaction.allocated_amount || 0).toFixed(2),
        transactionRemaining(transaction).toFixed(2),
        relatedDocuments,
        transaction.accounting_note || '',
        transaction.reference_number || '',
      ];
    }),
  ]), [matchesByTransaction, statementNames, transactionRemaining, transactions]);

  const mappingCsv = useMemo(() => buildCsv([
    [
      'Wyciąg',
      'Data płatności',
      'Kwota płatności',
      'Waluta płatności',
      'Kontrahent z banku',
      'Źródło dokumentu',
      'Numer dokumentu / umowy',
      'Kontrahent / odbiorca dokumentu',
      'Kwota przypisana',
      'Wartość dokumentu',
      'Waluta dokumentu',
      'Rodzaj',
      'Numer referencyjny banku',
    ],
    ...transactions.flatMap((transaction) => (
      (matchesByTransaction.get(transaction.id) || []).map((relation) => [
        statementNames.get(transaction.statement_id) || '',
        transaction.transaction_date,
        Math.abs(Number(transaction.amount || 0)).toFixed(2),
        transaction.currency || 'PLN',
        transaction.counterparty_name || '',
        relation.source,
        relation.documentNumber,
        relation.counterparty,
        relation.allocatedAmount.toFixed(2),
        relation.documentAmount == null ? '' : relation.documentAmount.toFixed(2),
        relation.currency,
        relation.description,
        transaction.reference_number || '',
      ])
    )),
  ]), [matchesByTransaction, statementNames, transactions]);

  const downloadReport = () => {
    if (!transactions.length) {
      showSnackbar('Brak transakcji w wybranym okresie', 'warning');
      return;
    }

    const url = URL.createObjectURL(new Blob([reconciliationCsv], { type: 'text/csv;charset=utf-8' }));
    const link = window.document.createElement('a');
    link.href = url;
    link.download = `uzgodnienie-saldeo-${year}-${String(month).padStart(2, '0')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    showSnackbar('Pobrano raport wszystkich transakcji', 'success');
  };

  const downloadStatement = async (statement: StatementRow) => {
    if (!statement.file_storage_path) {
      showSnackbar('Plik źródłowy wyciągu nie jest dostępny', 'warning');
      return;
    }
    try {
      const { data, error } = await supabase.storage
        .from('bank-statements')
        .createSignedUrl(statement.file_storage_path, 60);
      if (error || !data?.signedUrl) throw error || new Error('Brak linku do pliku');
      const link = window.document.createElement('a');
      link.href = data.signedUrl;
      link.download = statement.file_name;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.click();
    } catch (error: any) {
      showSnackbar(error?.message || 'Nie udało się pobrać wyciągu', 'error');
    }
  };

  const prepareAttachment = async (document: DeliveryCandidate): Promise<PreparedAttachment> => {
    const { data, error } = await supabase.storage.from(document.bucket).download(document.path);
    if (error || !data) {
      throw new Error(`Nie udało się pobrać pliku „${document.title}”`);
    }
    return {
      document,
      filename: document.filename,
      content: await blobToBase64(data),
      contentType: data.type || contentTypeFor(document.filename),
      size: data.size,
    };
  };

  const sendPreparedBatch = async (
    saldeoType: SaldeoDocumentType,
    batch: PreparedAttachment[],
    accessToken: string,
  ) => {
    const cleanPin = pin.replace(/[()]/g, '').trim();
    const result = await dispatchCrmEmail({
      accessToken,
      functionName: 'send-email',
      payload: {
        emailAccountId,
        to: saldeoEmail.trim(),
        subject: `(${String(month).padStart(2, '0')}/${year}) (${cleanPin}) {${saldeoType}}`,
        body: '<p>Dokumenty przekazane automatycznie z CRM Mavinci.</p>',
        attachments: batch.map((attachment) => ({
          filename: attachment.filename,
          content: attachment.content,
          contentType: attachment.contentType,
          contentDisposition: 'attachment',
        })),
      },
    });

    const { error } = await supabase.from('saldeo_delivery_log').insert(
      batch.map((attachment) => ({
        my_company_id: companyId,
        period_month: month,
        period_year: year,
        source_type: attachment.document.sourceType,
        source_id: attachment.document.sourceId,
        saldeo_document_type: saldeoType,
        delivered_to: saldeoEmail.trim(),
        email_message_id: typeof result.messageId === 'string' ? result.messageId : null,
        original_file_name: attachment.filename,
      })),
    );
    if (error) {
      console.error('Saldeo delivery log error:', error);
      showSnackbar('Dokumenty wysłano, ale nie udało się zapisać historii wysyłki', 'warning');
    }
  };

  const sendToSaldeo = async () => {
    const cleanPin = pin.replace(/[()]/g, '').trim();
    if (!companyId || !emailAccountId) {
      showSnackbar('Wybierz działalność i konto nadawcze', 'error');
      return;
    }
    if (!/^[^\s@]+@dok\.saldeo\.pl$/i.test(saldeoEmail.trim())) {
      showSnackbar('Podaj dedykowany adres firmy w domenie @dok.saldeo.pl', 'error');
      return;
    }
    if (cleanPin.length < 4) {
      showSnackbar('Podaj kod PIN Saldeo (minimum 4 znaki)', 'error');
      return;
    }
    if (!documentsToSend.length) {
      showSnackbar('Brak nowych plików do wysłania', 'warning');
      return;
    }

    try {
      setSending(true);
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error('Brak aktywnej sesji CRM');

      const savedCompany = companies.find((company) => company.id === companyId);
      if (savedCompany?.saldeo_document_email !== saldeoEmail.trim()) {
        const { error } = await supabase
          .from('my_companies')
          .update({ saldeo_document_email: saldeoEmail.trim() })
          .eq('id', companyId);
        if (error) throw error;
      }

      let sentFiles = 0;
      for (const saldeoType of ['FK', 'DS', 'P'] as SaldeoDocumentType[]) {
        const documents = documentsToSend.filter((document) => document.saldeoType === saldeoType);
        let batch: PreparedAttachment[] = [];
        let batchBytes = 0;

        for (const document of documents) {
          setSendProgress(`Pobieram plik ${sentFiles + batch.length + 1} z ${documentsToSend.length}: ${document.title}`);
          const attachment = await prepareAttachment(document);

          // Funkcja pocztowa otrzymuje dane jako base64. Mniejsze paczki są
          // stabilniejsze niż jedna wiadomość z limitem Saldeo wynoszącym 100 MB.
          if (batch.length && (batch.length >= 10 || batchBytes + attachment.size > 7 * 1024 * 1024)) {
            setSendProgress(`Wysyłam paczkę ${saldeoType} (${batch.length} plików)…`);
            await sendPreparedBatch(saldeoType, batch, accessToken);
            sentFiles += batch.length;
            batch = [];
            batchBytes = 0;
          }

          batch.push(attachment);
          batchBytes += attachment.size;
        }

        if (batch.length) {
          setSendProgress(`Wysyłam paczkę ${saldeoType} (${batch.length} plików)…`);
          await sendPreparedBatch(saldeoType, batch, accessToken);
          sentFiles += batch.length;
        }
      }

      setPin('');
      showSnackbar(`Wysłano do Saldeo ${sentFiles} plików`, 'success');
      await loadCompaniesAndAccounts();
      await loadPeriod();
    } catch (error: any) {
      console.error('Saldeo delivery error:', error);
      showSnackbar(error?.message || 'Nie udało się wysłać dokumentów do Saldeo', 'error');
    } finally {
      setSending(false);
      setSendProgress('');
    }
  };

  const sendAccountantPackage = async () => {
    if (!companyId || !emailAccountId) {
      showSnackbar('Wybierz działalność i konto nadawcze', 'error');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(accountantEmail.trim())) {
      showSnackbar('Podaj poprawny adres e-mail księgowej', 'error');
      return;
    }
    if (/@dok\.saldeo\.pl$/i.test(accountantEmail.trim())) {
      showSnackbar('Podaj zwykły adres księgowej, nie techniczny adres dokumentów Saldeo', 'error');
      return;
    }
    if (unresolvedTransactions.length > 0) {
      showSnackbar(`Pozostało ${unresolvedTransactions.length} transakcji bez pełnego rozliczenia lub wyjaśnienia`, 'error');
      return;
    }
    if (inconsistentTransactionRelations.length > 0) {
      showSnackbar(`W ${inconsistentTransactionRelations.length} transakcjach suma relacji nie zgadza się z rozliczoną kwotą`, 'error');
      return;
    }
    if (missingFileCount > 0) {
      showSnackbar(`Uzupełnij ${missingFileCount} dokumentów, które nie mają załącznika`, 'error');
      return;
    }
    if (statementsWithoutFiles.length > 0) {
      showSnackbar('Co najmniej jeden wyciąg nie ma dostępnego pliku źródłowego', 'error');
      return;
    }
    if (pendingSaldeoCount > 0) {
      showSnackbar(`Najpierw wyślij do Saldeo ${pendingSaldeoCount} nowych dokumentów`, 'error');
      return;
    }
    if (!transactions.length || !statements.length) {
      showSnackbar('Brak wyciągu lub transakcji dla wybranego miesiąca', 'error');
      return;
    }

    try {
      setSendingAccountantPackage(true);
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error('Brak aktywnej sesji CRM');

      const company = companies.find((item) => item.id === companyId);
      if (company?.accountant_email !== accountantEmail.trim()) {
        const { error } = await supabase
          .from('my_companies')
          .update({ accountant_email: accountantEmail.trim() })
          .eq('id', companyId);
        if (error) throw error;
      }

      const period = `${String(month).padStart(2, '0')}/${year}`;
      const periodSlug = `${year}-${String(month).padStart(2, '0')}`;
      const attachments: Array<{
        filename: string;
        content: string;
        contentType: string;
        contentDisposition: 'attachment';
      }> = [
        {
          filename: `uzgodnienie-transakcji-${periodSlug}.csv`,
          content: await blobToBase64(new Blob([reconciliationCsv], { type: 'text/csv;charset=utf-8' })),
          contentType: 'text/csv; charset=utf-8',
          contentDisposition: 'attachment',
        },
        {
          filename: `mapowanie-platnosci-dokumenty-${periodSlug}.csv`,
          content: await blobToBase64(new Blob([mappingCsv], { type: 'text/csv;charset=utf-8' })),
          contentType: 'text/csv; charset=utf-8',
          contentDisposition: 'attachment',
        },
      ];

      let rawAttachmentBytes = new Blob([reconciliationCsv, mappingCsv]).size;
      for (const statement of statements) {
        const { data, error } = await supabase.storage
          .from('bank-statements')
          .download(statement.file_storage_path!);
        if (error || !data) throw new Error(`Nie udało się pobrać wyciągu „${statement.file_name}”`);
        rawAttachmentBytes += data.size;
        attachments.push({
          filename: statement.file_name,
          content: await blobToBase64(data),
          contentType: data.type || contentTypeFor(statement.file_name),
          contentDisposition: 'attachment',
        });
      }

      if (rawAttachmentBytes > 18 * 1024 * 1024) {
        throw new Error('Paczka przekracza 18 MB. Pobierz raport i wyciągi ręcznie lub zmniejsz pliki wyciągów.');
      }

      const totals = (type: TransactionRow['transaction_type']) => {
        const byCurrency = new Map<string, number>();
        transactions.filter((transaction) => transaction.transaction_type === type).forEach((transaction) => {
          const currency = transaction.currency || 'PLN';
          byCurrency.set(currency, (byCurrency.get(currency) || 0) + Math.abs(Number(transaction.amount || 0)));
        });
        return [...byCurrency.entries()]
          .map(([currency, amount]) => `${amount.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`)
          .join(', ') || '0,00 PLN';
      };
      const explainedCount = transactions.filter((transaction) => transaction.accounting_review_status === 'explained').length;
      const privateCount = transactions.filter((transaction) => transaction.private_transfer_detected).length;
      const companyName = company?.name || 'Działalność';
      const statementList = statements
        .map((statement) => `<li>${htmlEscape(statement.account_type === 'vat' ? `VAT — ${statement.file_name}` : statement.file_name)}</li>`)
        .join('');
      const body = `
        <p>Dzień dobry,</p>
        <p>przesyłam kompletny pakiet księgowy za <strong>${htmlEscape(period)}</strong> dla działalności <strong>${htmlEscape(companyName)}</strong>.</p>
        <h3>Kontrola kompletności</h3>
        <ul>
          <li>transakcje z wyciągów: <strong>${transactions.length}</strong>, wszystkie dopasowane albo opisane,</li>
          <li>powiązania płatność–dokument/umowa: <strong>${matchDetails.length}</strong>,</li>
          <li>pozycje wyjaśnione bez faktury (VAT, PIT, ZUS, opłaty, przelewy własne itp.): <strong>${explainedCount}</strong>,</li>
          <li>przelewy prywatne: <strong>${privateCount}</strong>,</li>
          <li>dokumenty spoza KSeF przekazane do Saldeo: <strong>${deliveredCount}</strong>,</li>
          <li>dokumenty bez pliku lub transakcje bez wyjaśnienia: <strong>0</strong>.</li>
        </ul>
        <h3>Podsumowanie rachunków</h3>
        <ul>
          <li>wpływy: <strong>${htmlEscape(totals('credit'))}</strong>,</li>
          <li>wydatki: <strong>${htmlEscape(totals('debit'))}</strong>.</li>
        </ul>
        <p>Faktury KSeF pozostają w Saldeo i nie zostały ponownie załączone, aby nie tworzyć duplikatów. Dokumenty spoza KSeF, dokumenty sprzedaży oraz załączniki do płac i deklaracji zostały wcześniej przekazane na adres dokumentów Saldeo.</p>
        <p>Załącznik <strong>uzgodnienie transakcji</strong> obejmuje każdą pozycję z wyciągu, jej status, kwotę rozliczoną, ewentualne wyjaśnienie i numery dokumentów. Załącznik <strong>mapowanie płatności–dokumenty</strong> zawiera osobny wiersz dla każdej relacji wraz z przypisaną kwotą, także dla płatności częściowych, zbiorczych i kadrowych.</p>
        <p>Oryginalne wyciągi dołączone do wiadomości:</p>
        <ul>${statementList}</ul>
        <p>Pozdrawiam</p>
      `;

      const result = await dispatchCrmEmail({
        accessToken,
        functionName: 'send-email',
        payload: {
          emailAccountId,
          to: accountantEmail.trim(),
          subject: `Komplet dokumentów i uzgodnienie — ${companyName} — ${period}`,
          body,
          attachments,
        },
      });

      const { error: handoffError } = await supabase.from('accounting_month_handoffs').insert({
        my_company_id: companyId,
        period_month: month,
        period_year: year,
        delivered_to: accountantEmail.trim(),
        email_message_id: typeof result.messageId === 'string' ? result.messageId : null,
        transaction_count: transactions.length,
        statement_count: statements.length,
        matched_relation_count: matchDetails.length,
        saldeo_document_count: deliveredCount,
        unresolved_count: 0,
        snapshot: {
          inflows: totals('credit'),
          outflows: totals('debit'),
          explained_without_invoice: explainedCount,
          private_transfers: privateCount,
          source_statements: statements.map((statement) => statement.file_name),
        },
      });
      if (handoffError) {
        console.error('Accounting handoff log error:', handoffError);
        showSnackbar('Wiadomość wysłano, ale nie udało się zapisać historii przekazania', 'warning');
      } else {
        showSnackbar('Kompletny pakiet miesiąca został wysłany do księgowej', 'success');
      }
      await loadCompaniesAndAccounts();
    } catch (error: any) {
      console.error('Accountant package error:', error);
      showSnackbar(error?.message || 'Nie udało się wysłać pakietu do księgowej', 'error');
    } finally {
      setSendingAccountantPackage(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-blue-400/15 bg-blue-500/[0.06] p-5">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-blue-300" />
          <div>
            <h3 className="font-medium text-blue-100">Integracja Saldeo bez API</h3>
            <p className="mt-1 text-sm leading-6 text-blue-100/65">
              CRM wysyła wyłącznie dokumenty, których Saldeo nie pobiera z KSeF: faktury spoza KSeF,
              lokalne dokumenty sprzedaży bez numeru KSeF oraz listy płac i deklaracje dołączone do
              transakcji. Faktury KSeF są pomijane, aby nie tworzyć duplikatów.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-5 lg:grid-cols-5">
        <label className="text-xs text-[#e5e4e2]/60">
          Działalność
          <select value={companyId} onChange={(event) => setCompanyId(event.target.value)} className={`mt-1.5 ${inputClass}`}>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>{company.name}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-[#e5e4e2]/60">
          Miesiąc
          <select value={month} onChange={(event) => setMonth(Number(event.target.value))} className={`mt-1.5 ${inputClass}`}>
            {MONTHS.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}
          </select>
        </label>
        <label className="text-xs text-[#e5e4e2]/60">
          Rok
          <input type="number" min={2000} max={2100} value={year} onChange={(event) => setYear(Number(event.target.value))} className={`mt-1.5 ${inputClass}`} />
        </label>
        <label className="text-xs text-[#e5e4e2]/60 lg:col-span-2">
          Adres dokumentów Saldeo
          <input type="email" value={saldeoEmail} onChange={(event) => setSaldeoEmail(event.target.value)} placeholder="firma@dok.saldeo.pl" className={`mt-1.5 ${inputClass}`} />
        </label>
      </div>

      {loading ? (
        <div className="flex min-h-[220px] items-center justify-center rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] text-[#e5e4e2]/50">
          <Loader2 className="mr-2 h-5 w-5 animate-spin text-[#d3bb73]" /> Przygotowuję komplet danych…
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-4">
              <div className="text-xs text-[#e5e4e2]/45">Transakcje z wyciągów</div>
              <div className="mt-2 text-2xl text-[#e5e4e2]">{transactions.length}</div>
              <div className={`mt-1 text-xs ${unresolvedTransactions.length ? 'text-orange-300' : 'text-green-300'}`}>
                {resolvedTransactions} rozliczonych lub wyjaśnionych · {unresolvedTransactions.length} otwartych
              </div>
            </div>
            <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-4">
              <div className="text-xs text-[#e5e4e2]/45">Pliki do Saldeo</div>
              <div className="mt-2 text-2xl text-[#e5e4e2]">{documentsToSend.length}</div>
              <div className="mt-1 text-xs text-[#e5e4e2]/45">{deliveredCount} wysłanych wcześniej</div>
            </div>
            <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-4">
              <div className="text-xs text-[#e5e4e2]/45">Wyciągi źródłowe</div>
              <div className="mt-2 text-2xl text-[#e5e4e2]">{statements.length}</div>
              <div className="mt-1 text-xs text-[#e5e4e2]/45">PDF banku jest obsługiwany osobno</div>
            </div>
            <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-4">
              <div className="text-xs text-[#e5e4e2]/45">Dokumenty bez pliku</div>
              <div className={`mt-2 text-2xl ${missingFileCount ? 'text-orange-300' : 'text-green-300'}`}>{missingFileCount}</div>
              <div className="mt-1 text-xs text-[#e5e4e2]/45">Nie zostaną wysłane bez załącznika</div>
            </div>
          </div>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(360px,0.75fr)]">
            <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="flex items-center gap-2 font-medium text-[#e5e4e2]"><Mail className="h-5 w-5 text-[#d3bb73]" /> Dokumenty do wysłania</h3>
                  <p className="mt-1 text-xs leading-5 text-[#e5e4e2]/45">Saldeo przyjmie je w osobnych paczkach: FK, DS i P, maksymalnie 50 plików na formularz.</p>
                </div>
                <button type="button" onClick={() => void loadPeriod()} className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-[#e5e4e2]/65 hover:bg-white/5">
                  <RefreshCw className="h-3.5 w-3.5" /> Odśwież
                </button>
              </div>

              <div className="mt-4 max-h-[320px] space-y-2 overflow-y-auto pr-1">
                {candidates.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-white/10 px-4 py-10 text-center text-sm text-[#e5e4e2]/45">Brak plików spoza KSeF dla tego okresu.</div>
                ) : candidates.map((document) => (
                  <div key={`${document.sourceType}:${document.sourceId}`} className="flex items-center gap-3 rounded-lg border border-white/[0.07] bg-[#0a0d1a]/60 px-3 py-2.5">
                    <span className="w-8 shrink-0 rounded bg-[#d3bb73]/10 px-1.5 py-1 text-center text-[11px] font-medium text-[#d3bb73]">{document.saldeoType}</span>
                    <FileText className="h-4 w-4 shrink-0 text-[#e5e4e2]/35" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-[#e5e4e2]">{document.title}</div>
                      <div className="truncate text-xs text-[#e5e4e2]/35">{document.filename}</div>
                    </div>
                    {document.deliveredAt ? (
                      <span className="inline-flex shrink-0 items-center gap-1 text-xs text-green-300"><CheckCircle2 className="h-3.5 w-3.5" /> Wysłano</span>
                    ) : (
                      <span className="shrink-0 text-xs text-[#d3bb73]">Nowy</span>
                    )}
                  </div>
                ))}
              </div>

              {deliveredCount > 0 && (
                <label className="mt-4 flex items-center gap-2 text-xs text-[#e5e4e2]/55">
                  <input type="checkbox" checked={includeDelivered} onChange={(event) => setIncludeDelivered(event.target.checked)} className="accent-[#d3bb73]" />
                  Wyślij ponownie dokumenty oznaczone jako wysłane
                </label>
              )}
            </div>

            <div className="space-y-4">
              <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-5">
                <h3 className="flex items-center gap-2 font-medium text-[#e5e4e2]"><Send className="h-5 w-5 text-[#d3bb73]" /> Wyślij do Saldeo</h3>
                <label className="mt-4 block text-xs text-[#e5e4e2]/60">
                  Konto nadawcze CRM
                  <select value={emailAccountId} onChange={(event) => setEmailAccountId(event.target.value)} className={`mt-1.5 ${inputClass}`}>
                    <option value="">Wybierz konto</option>
                    {emailAccounts.map((account) => <option key={account.id} value={account.id}>{account.email_address}</option>)}
                  </select>
                </label>
                <label className="mt-3 block text-xs text-[#e5e4e2]/60">
                  Jednorazowy kod PIN Saldeo
                  <input type="password" autoComplete="off" value={pin} onChange={(event) => setPin(event.target.value)} placeholder="••••" className={`mt-1.5 ${inputClass}`} />
                </label>
                <p className="mt-2 text-xs leading-5 text-[#e5e4e2]/35">PIN nie jest zapisywany w ustawieniach działalności. Jest używany tylko w temacie wiadomości wymaganym przez Saldeo.</p>
                <button type="button" onClick={() => void sendToSaldeo()} disabled={sending || documentsToSend.length === 0} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2.5 text-sm font-medium text-[#0a0d1a] hover:bg-[#e5d799] disabled:cursor-not-allowed disabled:opacity-45">
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {sending ? 'Wysyłam…' : `Wyślij ${documentsToSend.length} plików do Saldeo`}
                </button>
                {sendProgress && <div className="mt-3 text-xs leading-5 text-[#d3bb73]">{sendProgress}</div>}
              </div>

              <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-5">
                <h3 className="flex items-center gap-2 font-medium text-[#e5e4e2]"><Download className="h-5 w-5 text-[#d3bb73]" /> Uzgodnienie dla księgowej</h3>
                <p className="mt-2 text-xs leading-5 text-[#e5e4e2]/45">Wiadomość zawiera dwa raporty: pełny rejestr transakcji oraz dokładne relacje płatność–dokument z przypisaną kwotą. Dołącza również oryginalne wyciągi bankowe.</p>
                <div className={`mt-4 rounded-lg border px-3 py-2.5 text-xs leading-5 ${
                  isAccountantPackageReady
                    ? 'border-green-400/20 bg-green-400/[0.06] text-green-200'
                    : 'border-orange-400/20 bg-orange-400/[0.06] text-orange-200'
                }`}>
                  {isAccountantPackageReady ? (
                    <span className="inline-flex items-center gap-2"><CheckCircle2 className="h-4 w-4" /> Miesiąc jest kompletny i gotowy do wysłania.</span>
                  ) : (
                    <div>
                      <div className="inline-flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4" /> Przed wysłaniem uzupełnij:</div>
                      <ul className="mt-1 list-disc pl-5 text-orange-100/70">
                        {unresolvedTransactions.length > 0 && <li>{unresolvedTransactions.length} transakcji bez pełnego dopasowania lub wyjaśnienia</li>}
                        {inconsistentTransactionRelations.length > 0 && <li>{inconsistentTransactionRelations.length} transakcji z niespójną sumą powiązań</li>}
                        {missingFileCount > 0 && <li>{missingFileCount} dokumentów bez załącznika</li>}
                        {statementsWithoutFiles.length > 0 && <li>{statementsWithoutFiles.length} wyciągów bez pliku źródłowego</li>}
                        {pendingSaldeoCount > 0 && <li>{pendingSaldeoCount} nowych dokumentów nieprzekazanych jeszcze do Saldeo</li>}
                        {transactions.length === 0 && <li>brak transakcji dla okresu</li>}
                        {statements.length === 0 && <li>brak wyciągu dla okresu</li>}
                      </ul>
                    </div>
                  )}
                </div>
                <label className="mt-4 block text-xs text-[#e5e4e2]/60">
                  Konto nadawcze CRM
                  <select value={emailAccountId} onChange={(event) => setEmailAccountId(event.target.value)} className={`mt-1.5 ${inputClass}`}>
                    <option value="">Wybierz konto</option>
                    {emailAccounts.map((account) => <option key={account.id} value={account.id}>{account.email_address}</option>)}
                  </select>
                </label>
                <label className="mt-4 block text-xs text-[#e5e4e2]/60">
                  E-mail księgowej lub biura rachunkowego
                  <input type="email" value={accountantEmail} onChange={(event) => setAccountantEmail(event.target.value)} placeholder="ksiegowosc@biuro.pl" className={`mt-1.5 ${inputClass}`} />
                </label>
                <button type="button" onClick={() => void sendAccountantPackage()} disabled={sendingAccountantPackage || !isAccountantPackageReady} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2.5 text-sm font-medium text-[#0a0d1a] hover:bg-[#e5d799] disabled:cursor-not-allowed disabled:opacity-45">
                  {sendingAccountantPackage ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                  {sendingAccountantPackage ? 'Wysyłam komplet…' : 'Wyślij kompletny miesiąc księgowej'}
                </button>
                <button type="button" onClick={downloadReport} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-[#d3bb73]/25 px-4 py-2.5 text-sm text-[#d3bb73] hover:bg-[#d3bb73]/10">
                  <Download className="h-4 w-4" /> Pobierz raport CSV
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-orange-400/15 bg-orange-500/[0.05] p-5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-orange-300" />
              <div className="min-w-0 flex-1">
                <h3 className="font-medium text-orange-100">Oryginalne wyciągi bankowe</h3>
                <p className="mt-1 text-xs leading-5 text-orange-100/60">Na tym koncie Saldeo nie ma modułu wyciągów. Saldeo odczytuje wyłącznie oryginalny elektroniczny PDF banku i nie przyjmuje wyciągów przez adres dokumentów.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {statements.length === 0 ? (
                    <span className="text-xs text-orange-100/45">Brak wyciągów dla wybranego okresu.</span>
                  ) : statements.map((statement) => (
                    <button key={statement.id} type="button" onClick={() => void downloadStatement(statement)} className="inline-flex items-center gap-2 rounded-lg border border-orange-300/20 px-3 py-2 text-xs text-orange-100 hover:bg-orange-300/10">
                      <Landmark className="h-3.5 w-3.5" /> {statement.account_type === 'vat' ? 'VAT · ' : ''}{statement.file_name}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
