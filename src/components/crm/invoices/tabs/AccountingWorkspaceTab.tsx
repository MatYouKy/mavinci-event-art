'use client';

import { systemLabel } from '@/lib/ui/systemLabels';

import { useCallback, useMemo, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  ArrowRight,
  Briefcase,
  CheckCircle2,
  Download,
  FileText,
  FolderOpen,
  Landmark,
  Link as LinkIcon,
  ListChecks,
  Loader2,
  Receipt,
  RefreshCw,
  Search,
  ShieldCheck,
  WalletCards,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { BANK_STATEMENT_DEDUPLICATION_COLUMNS, deduplicateStatementTransactions, loadBankStatementTransactionPages } from '@/lib/bankStatementDeduplication';
import { useSnackbar } from '@/contexts/SnackbarContext';
import KSeFFinancialDashboard from '@/components/crm/KSeFFinancialDashboard';
import UnmatchedTransactionsModal from '@/components/crm/UnmatchedTransactionsModal';
import { ExternalInvoicesTab } from './ExternalInvoicesTab/ExternalInvoicesTab';
import { PersonnelContractsRegistry } from './PersonnelContractsRegistry';
import SaldeoDeliveryPanel from './SaldeoDeliveryPanel';
import { repairBrokenBankText } from '@/lib/bankTextEncoding';
import { decodeTextEntities } from '@/lib/textEncoding';
import { externalDocumentKindLabel } from '@/lib/invoices/externalDocumentKinds';

type WorkspaceSection =
  | 'control'
  | 'documents'
  | 'statements'
  | 'external'
  | 'contracts'
  | 'accountant';

type DocumentSource =
  | 'ksef'
  | 'local'
  | 'external'
  | 'employment_contract'
  | 'mandate_contract'
  | 'specific_work_contract';

interface AccountingDocument {
  id: string;
  source: DocumentSource;
  number: string;
  title: string;
  counterparty: string;
  date: string | null;
  amount: number | null;
  currency: string;
  status: string;
  href?: string;
}

interface BankTransaction {
  id: string;
  statement_id: string;
  transaction_date: string;
  amount: number;
  currency: string;
  transaction_type: 'debit' | 'credit';
  counterparty_name: string | null;
  title: string | null;
  match_status: 'unmatched' | 'partial' | 'matched' | null;
  allocated_amount: number | null;
  matched_document_count: number | null;
  matched_invoice_id: string | null;
  statementMonth?: number;
  statementYear?: number;
  companyId?: string | null;
}

interface Props {
  filterCompanyIds?: string[] | null;
}

const SECTIONS: Array<{
  id: WorkspaceSection;
  label: string;
  shortLabel: string;
  icon: typeof FileText;
}> = [
  { id: 'control', label: 'Kontrola przepływów', shortLabel: 'Kontrola', icon: ListChecks },
  { id: 'documents', label: 'Wszystkie dokumenty', shortLabel: 'Dokumenty', icon: FolderOpen },
  { id: 'statements', label: 'Wyciągi i płatności', shortLabel: 'Wyciągi', icon: Landmark },
  { id: 'external', label: 'Dokumenty spoza KSeF', shortLabel: 'Poza KSeF', icon: Receipt },
  { id: 'contracts', label: 'Umowy personelu', shortLabel: 'Umowy', icon: Briefcase },
  { id: 'accountant', label: 'Dla księgowej', shortLabel: 'Księgowość', icon: ShieldCheck },
];

function isWorkspaceSection(value: string | null): value is WorkspaceSection {
  return SECTIONS.some((section) => section.id === value);
}

const SOURCE_META: Record<DocumentSource, { label: string; className: string }> = {
  ksef: { label: 'KSeF', className: 'bg-blue-500/15 text-blue-300' },
  local: { label: 'CRM', className: 'bg-violet-500/15 text-violet-300' },
  external: { label: 'Poza KSeF', className: 'bg-amber-500/15 text-amber-300' },
  employment_contract: { label: 'Umowa o pracę', className: 'bg-violet-500/15 text-violet-300' },
  mandate_contract: { label: 'Umowa zlecenie', className: 'bg-emerald-500/15 text-emerald-300' },
  specific_work_contract: { label: 'Umowa o dzieło', className: 'bg-cyan-500/15 text-cyan-300' },
};

function formatMoney(value: number | null, currency = 'PLN') {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return new Intl.NumberFormat('pl-PL', {
    style: 'currency',
    currency: currency || 'PLN',
    maximumFractionDigits: 2,
  }).format(Number(value));
}

function formatDate(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('pl-PL');
}

function statusBadge(status: string) {
  const normalized = String(status || '').toLowerCase();
  const positive = ['paid', 'accepted', 'signed', 'completed', 'active', 'issued'].includes(normalized);
  const negative = ['overdue', 'rejected', 'cancelled', 'unpaid'].includes(normalized);
  const labels: Record<string, string> = {
    paid: 'Opłacony',
    unpaid: 'Nieopłacony',
    partially_paid: 'Częściowo opłacony',
    accepted: 'Przyjęty',
    pending: 'W toku',
    rejected: 'Odrzucony',
    signed: 'Podpisana',
    active: 'Aktywna',
    completed: 'Zakończone',
    issued: 'Wystawiona',
    draft: 'Szkic',
    cancelled: 'Anulowany',
    overdue: 'Po terminie',
  };

  return (
    <span
      className={`inline-flex rounded-full px-2 py-1 text-xs ${
        positive
          ? 'bg-green-500/15 text-green-300'
          : negative
            ? 'bg-red-500/15 text-red-300'
            : 'bg-[#d3bb73]/10 text-[#d3bb73]'
      }`}
    >
      {labels[normalized] || (status ? systemLabel(status) : 'Brak statusu')}
    </span>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = 'gold',
}: {
  icon: typeof FileText;
  label: string;
  value: string | number;
  hint: string;
  tone?: 'gold' | 'green' | 'orange' | 'blue';
}) {
  const tones = {
    gold: 'text-[#d3bb73] bg-[#d3bb73]/10',
    green: 'text-green-400 bg-green-500/10',
    orange: 'text-orange-400 bg-orange-500/10',
    blue: 'text-blue-400 bg-blue-500/10',
  };

  return (
    <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-4">
      <div className={`mb-2 inline-flex rounded-md p-2 ${tones[tone]}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="text-xl font-light leading-none text-[#e5e4e2]">{value}</div>
      <div className="mt-1.5 text-xs font-medium text-[#e5e4e2]">{label}</div>
      <div className="mt-1 text-[11px] leading-4 text-[#e5e4e2]/45">{hint}</div>
    </div>
  );
}

function DocumentsTable({
  documents,
  onOpen,
}: {
  documents: AccountingDocument[];
  onOpen: (document: AccountingDocument) => void;
}) {
  if (documents.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[#d3bb73]/20 bg-[#1c1f33]/60 px-6 py-14 text-center">
        <FolderOpen className="mx-auto mb-3 h-10 w-10 text-[#d3bb73]/45" />
        <p className="text-sm text-[#e5e4e2]/55">Brak dokumentów dla wybranych filtrów.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px]">
          <thead className="border-b border-[#d3bb73]/10 bg-[#0a0d1a]/55">
            <tr className="text-left text-xs font-medium uppercase tracking-wider text-[#e5e4e2]/40">
              <th className="px-5 py-3">Dokument</th>
              <th className="px-5 py-3">Kontrahent / opis</th>
              <th className="px-5 py-3">Data</th>
              <th className="px-5 py-3 text-right">Kwota</th>
              <th className="px-5 py-3">Status</th>
              <th className="px-5 py-3 text-right">Akcja</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#d3bb73]/10">
            {documents.map((document) => {
              const source = SOURCE_META[document.source];
              return (
                <tr key={`${document.source}:${document.id}`} className="hover:bg-[#d3bb73]/[0.035]">
                  <td className="px-5 py-4">
                    <div className="flex items-start gap-3">
                      <span className={`mt-0.5 shrink-0 rounded px-2 py-1 text-[11px] ${source.className}`}>
                        {source.label}
                      </span>
                      <div className="min-w-0">
                        <div className="font-medium text-[#e5e4e2]">{document.number}</div>
                        <div className="mt-1 max-w-[260px] truncate text-xs text-[#e5e4e2]/45">
                          {document.title}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="max-w-[280px] px-5 py-4 text-sm text-[#e5e4e2]/70">
                    <span className="line-clamp-2">{document.counterparty || '—'}</span>
                  </td>
                  <td className="px-5 py-4 text-sm text-[#e5e4e2]/60">{formatDate(document.date)}</td>
                  <td className="px-5 py-4 text-right text-sm font-medium text-[#e5e4e2]">
                    {formatMoney(document.amount, document.currency)}
                  </td>
                  <td className="px-5 py-4">{statusBadge(document.status)}</td>
                  <td className="px-5 py-4 text-right">
                    <button
                      type="button"
                      onClick={() => onOpen(document)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-[#d3bb73] hover:text-[#e5d799]"
                    >
                      Otwórz <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function AccountingWorkspaceTab({ filterCompanyIds = null }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showSnackbar } = useSnackbar();
  const [section, setSection] = useState<WorkspaceSection>(() => {
    const requestedSection = searchParams.get('section');
    return isWorkspaceSection(requestedSection) ? requestedSection : 'control';
  });
  const [documents, setDocuments] = useState<AccountingDocument[]>([]);
  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<DocumentSource | 'all'>('all');
  const [matchPeriod, setMatchPeriod] = useState<{
    month: number;
    year: number;
    companyId: string | null;
  } | null>(null);

  const companyFilterKey =
    filterCompanyIds === null ? '*' : [...filterCompanyIds].sort().join(',');
  const statementMonth = Number(searchParams.get('statementMonth'));
  const statementYear = Number(searchParams.get('statementYear'));
  const isStatementMonthOpen = section === 'statements'
    && Number.isInteger(statementMonth) && statementMonth >= 1 && statementMonth <= 12
    && Number.isInteger(statementYear) && statementYear >= 2000 && statementYear <= 2100;

  const changeSection = useCallback(
    (nextSection: WorkspaceSection) => {
      setSection(nextSection);
      const params = new URLSearchParams(searchParams.toString());
      params.set('tab', 'external');
      params.set('section', nextSection);
      router.push(`/crm/invoices?${params.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  useEffect(() => {
    const requestedSection = searchParams.get('section');
    setSection(isWorkspaceSection(requestedSection) ? requestedSection : 'control');
  }, [searchParams]);

  const loadWorkspaceData = useCallback(async () => {
    setLoading(true);
    try {
      const companyIds = companyFilterKey === '*' ? null : companyFilterKey.split(',').filter(Boolean);
      if (companyIds && companyIds.length === 0) {
        setDocuments([]);
        setTransactions([]);
        return;
      }

      let statementsQuery = supabase
        .from('bank_statements')
        .select(BANK_STATEMENT_DEDUPLICATION_COLUMNS)
        .order('statement_year', { ascending: false })
        .order('statement_month', { ascending: false });
      if (companyIds) statementsQuery = statementsQuery.in('my_company_id', companyIds);

      const statementResult = await statementsQuery;
      const statementRows = statementResult.data || [];
      const statementMap = new Map(statementRows.map((row) => [row.id, row]));

      if (statementRows.length > 0) {
        const transactionRows = await loadBankStatementTransactionPages((from, to) =>
          supabase
            .from('bank_transactions')
            .select(
              'id, statement_id, transaction_date, posting_date, amount, currency, transaction_type, counterparty_name, counterparty_account, title, raw_description, reference_number, match_status, allocated_amount, matched_document_count, matched_invoice_id, accounting_review_status, private_transfer_detected',
            )
            .in(
              'statement_id',
              statementRows.map((row) => row.id),
            )
            .order('transaction_date', { ascending: false })
            .order('id', { ascending: true })
            .range(from, to),
        );

        setTransactions(
          deduplicateStatementTransactions(transactionRows, statementMap).map((transaction) => {
            const statement = statementMap.get(transaction.statement_id);
            return {
              ...transaction,
              counterparty_name: repairBrokenBankText(transaction.counterparty_name) || null,
              title: repairBrokenBankText(transaction.title) || null,
              statementMonth: statement?.statement_month,
              statementYear: statement?.statement_year,
              companyId: statement?.my_company_id,
            };
          }),
        );
      } else {
        setTransactions([]);
      }

      let ksefQuery = supabase
        .from('ksef_invoices')
        .select(
          'id, invoice_number, ksef_reference_number, issue_date, ksef_issued_at, seller_name, buyer_name, gross_amount, currency, invoice_type, payment_status, my_company_id',
        )
        .eq('sync_status', 'synced')
        .not('ksef_reference_number', 'is', null)
        .neq('ksef_reference_number', '')
        .order('issue_date', { ascending: false })
        .limit(1000);
      let localQuery = supabase
        .from('invoices')
        .select(
          'id, invoice_number, issue_date, buyer_name, total_gross, status, invoice_type, ksef_status, my_company_id',
        )
        .order('issue_date', { ascending: false })
        .limit(1000);
      let externalQuery = supabase
        .from('external_invoices')
        .select(
          'id, document_kind, invoice_number, label, invoice_date, seller_name, amount_gross, currency, payment_status, my_company_id',
        )
        .order('invoice_date', { ascending: false })
        .limit(1000);

      if (companyIds) {
        ksefQuery = ksefQuery.in('my_company_id', companyIds);
        localQuery = localQuery.in('my_company_id', companyIds);
        externalQuery = externalQuery.in('my_company_id', companyIds);
      }

      const [ksefResult, localResult, externalResult, personnelContractResult] = await Promise.all([
        ksefQuery,
        localQuery,
        externalQuery,
        supabase
          .from('personnel_contracts')
          .select(
            'id, employee_id, subcontractor_id, my_company_id, party_name, party_identifier, contract_kind, contract_number, title, start_date, end_date, gross_value, currency, status, created_at',
          )
          .order('start_date', { ascending: false })
          .limit(500),
      ]);

      const partialErrors = [
        statementResult.error,
        ksefResult.error,
        localResult.error,
        externalResult.error,
        personnelContractResult.error,
      ].filter(Boolean);
      if (partialErrors.length > 0) {
        console.error('Partial accounting workspace load error:', partialErrors);
        showSnackbar('Część rejestrów nie była dostępna. Pokazuję pozostałe dane.', 'warning');
      }

      const ksefRows = (ksefResult.data || []) as any[];
      const issuedInKsef = new Set(
        ksefRows
          .filter((row) => String(row.invoice_type).toLowerCase() === 'issued')
          .map((row) => String(row.invoice_number || '').trim())
          .filter(Boolean),
      );

      const normalized: AccountingDocument[] = [
        ...ksefRows.map((row) => ({
          id: row.id,
          source: 'ksef' as const,
          number: row.invoice_number || row.ksef_reference_number || 'Faktura KSeF',
          title:
            String(row.invoice_type).toLowerCase() === 'received'
              ? 'Faktura zakupowa z KSeF'
              : 'Faktura sprzedażowa z KSeF',
          counterparty:
            String(row.invoice_type).toLowerCase() === 'received'
              ? decodeTextEntities(row.seller_name) || 'Nieznany sprzedawca'
              : decodeTextEntities(row.buyer_name) || 'Nieznany nabywca',
          date: row.issue_date || row.ksef_issued_at,
          amount: row.gross_amount == null ? null : Number(row.gross_amount),
          currency: row.currency || 'PLN',
          status: row.payment_status || 'accepted',
        })),
        ...((localResult.data || []) as any[])
          .filter(
            (row) =>
              !(
                row.ksef_status === 'accepted' &&
                issuedInKsef.has(String(row.invoice_number || '').trim())
              ),
          )
          .map((row) => ({
            id: row.id,
            source: 'local' as const,
            number: row.invoice_number || 'Dokument lokalny',
            title: row.invoice_type === 'proforma' ? 'Proforma' : 'Faktura utworzona w CRM',
            counterparty: row.buyer_name || 'Nieznany nabywca',
            date: row.issue_date,
            amount: row.total_gross == null ? null : Number(row.total_gross),
            currency: 'PLN',
            status: row.status || row.ksef_status || 'draft',
            href: `/crm/invoices/${row.id}`,
          })),
        ...((externalResult.data || []) as any[]).map((row) => ({
          id: row.id,
          source: 'external' as const,
          number: row.invoice_number || 'Dokument kosztowy',
          title: `${externalDocumentKindLabel(row.document_kind)}${row.label ? ` · ${row.label}` : ' spoza KSeF'}`,
          counterparty: row.seller_name || 'Nieznany sprzedawca',
          date: row.invoice_date,
          amount: row.amount_gross == null ? null : Number(row.amount_gross),
          currency: row.currency || 'PLN',
          status: row.payment_status || 'unpaid',
        })),
        ...((personnelContractResult.data || []) as any[]).map((row) => {
          const isEmployment = row.contract_kind === 'employment';
          const isMandate = row.contract_kind === 'mandate';
          return {
            id: row.id,
            source: isEmployment
              ? ('employment_contract' as const)
              : isMandate
                ? ('mandate_contract' as const)
                : ('specific_work_contract' as const),
            number: row.contract_number || (isEmployment ? 'Umowa o pracę' : isMandate ? 'Umowa zlecenie' : 'Umowa o dzieło'),
            title: row.title || (isEmployment ? 'Umowa o pracę' : isMandate ? 'Umowa zlecenie' : 'Umowa o dzieło'),
            counterparty: row.party_name || 'Nieprzypisana osoba',
            date: row.start_date,
            amount: row.gross_value == null ? null : Number(row.gross_value),
            currency: row.currency || 'PLN',
            status: row.status || 'draft',
            href: row.employee_id
              ? `/crm/employees/${row.employee_id}`
              : row.subcontractor_id
                ? `/crm/subcontractors/${row.subcontractor_id}`
                : undefined,
          };
        }),
      ];

      normalized.sort((left, right) => {
        const leftTime = left.date ? new Date(left.date).getTime() : 0;
        const rightTime = right.date ? new Date(right.date).getTime() : 0;
        return rightTime - leftTime;
      });
      setDocuments(normalized);
    } catch (error: any) {
      console.error('Accounting workspace load error:', error);
      showSnackbar(error?.message || 'Nie udało się pobrać danych rozliczeniowych', 'error');
    } finally {
      setLoading(false);
    }
  }, [companyFilterKey, showSnackbar]);

  useEffect(() => {
    void loadWorkspaceData();
  }, [loadWorkspaceData]);

  const isMatched = (transaction: BankTransaction) =>
    transaction.match_status === 'matched' ||
    (!transaction.match_status && Boolean(transaction.matched_invoice_id));

  const unresolvedTransactions = useMemo(
    () => transactions.filter((transaction) => !isMatched(transaction)),
    [transactions],
  );
  const missingOutflows = useMemo(
    () =>
      unresolvedTransactions.filter(
        (transaction) => transaction.transaction_type === 'debit',
      ),
    [unresolvedTransactions],
  );
  const matchedCount = transactions.filter(isMatched).length;
  const completeness = transactions.length
    ? Math.round((matchedCount / transactions.length) * 100)
    : 100;
  const filteredDocuments = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('pl-PL');
    return documents.filter((document) => {
      if (sourceFilter !== 'all' && document.source !== sourceFilter) return false;
      if (!needle) return true;
      return [document.number, document.title, document.counterparty]
        .join(' ')
        .toLocaleLowerCase('pl-PL')
        .includes(needle);
    });
  }, [documents, search, sourceFilter]);

  const openDocument = (document: AccountingDocument) => {
    if (document.href) {
      router.push(document.href);
      return;
    }
    if (document.source === 'external') {
      changeSection('external');
      return;
    }
    if (['employment_contract', 'mandate_contract', 'specific_work_contract'].includes(document.source)) {
      changeSection('contracts');
      return;
    }
    if (document.source === 'ksef') {
      router.push('/crm/invoices?tab=ksef');
    }
  };

  const openMatching = (transaction: BankTransaction) => {
    const transactionDate = new Date(transaction.transaction_date);
    setMatchPeriod({
      month: transaction.statementMonth || transactionDate.getMonth() + 1,
      year: transaction.statementYear || transactionDate.getFullYear(),
      companyId: transaction.companyId || null,
    });
  };

  const exportMissingList = () => {
    if (unresolvedTransactions.length === 0) {
      showSnackbar('Brak nierozliczonych transakcji do eksportu', 'success');
      return;
    }
    const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const rows = [
      ['Data', 'Kierunek', 'Kontrahent', 'Tytuł', 'Kwota', 'Waluta', 'Status'],
      ...unresolvedTransactions.map((transaction) => [
        transaction.transaction_date,
        transaction.transaction_type === 'debit' ? 'Wydatek' : 'Wpływ',
        transaction.counterparty_name || '',
        transaction.title || '',
        Math.abs(Number(transaction.amount || 0)).toFixed(2),
        transaction.currency || 'PLN',
        transaction.match_status === 'partial' ? 'Częściowo rozliczona' : 'Brak dokumentu',
      ]),
    ];
    const csv = `\uFEFF${rows.map((row) => row.map(escape).join(';')).join('\n')}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = window.document.createElement('a');
    link.href = url;
    link.download = `braki-dokumentow-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-xl border border-[#d3bb73]/15 bg-gradient-to-br from-[#1c1f33] to-[#141728]">
        <div className="flex flex-col gap-3 px-4 py-3.5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.16em] text-[#d3bb73]">
              <WalletCards className="h-3.5 w-3.5" /> Centrum dokumentów
            </div>
            <h2 className="text-xl font-light text-[#e5e4e2]">Dokumenty i rozliczenia</h2>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-[#e5e4e2]/55">
              Faktury KSeF i spoza KSeF, dokumenty lokalne, wyciągi oraz umowy cywilnoprawne —
              połączone z kontrolą przepływów pieniężnych.
            </p>
          </div>
          {!isStatementMonthOpen && <button data-crm-action="secondary"
            type="button"
            onClick={() => void loadWorkspaceData()}
            disabled={loading}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#d3bb73]/25 px-3 py-2 text-xs text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/10 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Odśwież dane
          </button>}
        </div>

        <div className="flex snap-x gap-0.5 overflow-x-auto border-t border-[#d3bb73]/10 px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {SECTIONS.map((item) => {
            const Icon = item.icon;
            return (
              <button data-crm-tab-active={section === item.id}
                key={item.id}
                type="button"
                onClick={() => changeSection(item.id)}
                title={item.label}
                className={`flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 py-2 text-xs transition-colors sm:px-3 ${
                  section === item.id
                    ? 'border-[#d3bb73] text-[#d3bb73]'
                    : 'border-transparent text-[#e5e4e2]/50 hover:text-[#e5e4e2]'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="sm:hidden">{item.shortLabel}</span>
                <span className="hidden sm:inline">{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {loading && documents.length === 0 ? (
        <div className="flex min-h-[320px] items-center justify-center rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] text-[#e5e4e2]/50">
          <Loader2 className="mr-2 h-5 w-5 animate-spin text-[#d3bb73]" /> Ładowanie rejestrów…
        </div>
      ) : section === 'control' ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              icon={CheckCircle2}
              label="Kompletność rozliczeń"
              value={`${completeness}%`}
              hint={`${matchedCount} z ${transactions.length} transakcji ma przypisane dokumenty`}
              tone="green"
            />
            <MetricCard
              icon={AlertTriangle}
              label="Wydatki bez dokumentu"
              value={missingOutflows.length}
              hint="Płatności wychodzące wymagające faktury albo wyjaśnienia"
              tone="orange"
            />
            <MetricCard
              icon={LinkIcon}
              label="Do rozliczenia"
              value={unresolvedTransactions.length}
              hint="Pełne i częściowe braki po imporcie wyciągów"
              tone="blue"
            />
            <MetricCard
              icon={FileText}
              label="Dokumenty w rejestrze"
              value={documents.length}
              hint="KSeF, CRM, dokumenty kosztowe, umowy i zlecenia"
            />
          </div>

          <div className="rounded-xl border border-blue-500/20 bg-blue-500/[0.07] p-5">
            <div className="flex items-start gap-3">
              <LinkIcon className="mt-0.5 h-5 w-5 shrink-0 text-blue-300" />
              <div>
                <div className="font-medium text-blue-200">Płatności zbiorcze są obsługiwane</div>
                <p className="mt-1 text-sm leading-6 text-blue-100/65">
                  Jedną transakcję — np. Allegro Pay — możesz rozdzielić na kilka faktur z KSeF,
                  CRM i spoza KSeF. Każda pozycja ma własną przypisaną kwotę, a transakcja pozostaje
                  częściowo rozliczona aż do wykorzystania całej wartości.
                </p>
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]">
            <div className="flex flex-col gap-3 border-b border-[#d3bb73]/10 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="font-medium text-[#e5e4e2]">Lista brakujących dokumentów</h3>
                <p className="mt-1 text-xs text-[#e5e4e2]/45">
                  Powstaje automatycznie na podstawie wgranych wyciągów.
                </p>
              </div>
              <div className="flex gap-2">
                <button data-crm-action="secondary"
                  type="button"
                  onClick={exportMissingList}
                  className="inline-flex items-center gap-2 rounded-lg border border-[#d3bb73]/20 px-3 py-2 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/10"
                >
                  <Download className="h-4 w-4" /> Eksport CSV
                </button>
                <button
                  type="button"
                  onClick={() => changeSection('statements')}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-3 py-2 text-xs font-medium text-[#0a0d1a] hover:bg-[#e5d799]"
                >
                  <Landmark className="h-4 w-4" /> Wgraj wyciąg
                </button>
              </div>
            </div>

            {unresolvedTransactions.length === 0 ? (
              <div className="px-6 py-14 text-center text-green-400">
                <CheckCircle2 className="mx-auto mb-3 h-10 w-10" />
                Wszystkie zaimportowane transakcje są rozliczone.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[850px]">
                  <thead className="bg-[#0a0d1a]/50 text-left text-xs uppercase tracking-wider text-[#e5e4e2]/40">
                    <tr>
                      <th className="px-5 py-3">Data</th>
                      <th className="px-5 py-3">Kontrahent i tytuł</th>
                      <th className="px-5 py-3">Rodzaj</th>
                      <th className="px-5 py-3 text-right">Kwota / rozliczono</th>
                      <th className="px-5 py-3 text-right">Akcja</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#d3bb73]/10">
                    {unresolvedTransactions.slice(0, 40).map((transaction) => (
                      <tr key={transaction.id} className="hover:bg-[#d3bb73]/[0.035]">
                        <td className="px-5 py-4 text-sm text-[#e5e4e2]/60">
                          {formatDate(transaction.transaction_date)}
                        </td>
                        <td className="max-w-[360px] px-5 py-4">
                          <div className="truncate text-sm font-medium text-[#e5e4e2]">
                            {transaction.counterparty_name || 'Nieznany kontrahent'}
                          </div>
                          <div className="mt-1 truncate text-xs text-[#e5e4e2]/45">
                            {transaction.title || 'Brak tytułu przelewu'}
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <span
                            className={`rounded-full px-2 py-1 text-xs ${
                              transaction.transaction_type === 'debit'
                                ? 'bg-orange-500/15 text-orange-300'
                                : 'bg-green-500/15 text-green-300'
                            }`}
                          >
                            {transaction.transaction_type === 'debit' ? 'Wydatek' : 'Wpływ'}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-right">
                          <div className="text-sm font-medium text-[#e5e4e2]">
                            {formatMoney(Math.abs(Number(transaction.amount)), transaction.currency)}
                          </div>
                          {Number(transaction.allocated_amount || 0) > 0 && (
                            <div className="mt-1 text-xs text-blue-300">
                              rozliczono {formatMoney(Number(transaction.allocated_amount), transaction.currency)}
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-4 text-right">
                          <button data-crm-action="secondary"
                            type="button"
                            onClick={() => openMatching(transaction)}
                            className="inline-flex items-center gap-1 rounded-lg border border-[#d3bb73]/20 px-3 py-2 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/10"
                          >
                            Rozlicz <ArrowRight className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : section === 'documents' ? (
        <div className="space-y-5">
          <div className="flex flex-col gap-3 rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-4 lg:flex-row lg:items-center">
            <div className="crm-search-field relative flex-1 rounded-lg border bg-[#0a0d1a]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#e5e4e2]/35" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Szukaj po numerze, kontrahencie lub nazwie…"
                className="crm-search-input w-full rounded-lg bg-transparent py-2.5 pl-10 pr-4 text-sm text-[#e5e4e2] outline-none placeholder:text-[#e5e4e2]/30"
              />
            </div>
            <select
              value={sourceFilter}
              onChange={(event) => setSourceFilter(event.target.value as DocumentSource | 'all')}
              className="rounded-lg border border-[#d3bb73]/15 bg-[#0a0d1a] px-4 py-2.5 text-sm text-[#e5e4e2] outline-none focus:border-[#d3bb73]/45"
            >
              <option value="all">Wszystkie źródła</option>
              {Object.entries(SOURCE_META).map(([value, meta]) => (
                <option key={value} value={value}>
                  {meta.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => changeSection('external')}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2.5 text-sm font-medium text-[#0a0d1a] hover:bg-[#e5d799]"
            >
              <Receipt className="h-4 w-4" /> Dodaj dokument kosztowy
            </button>
          </div>
          <div className="flex items-center justify-between text-xs text-[#e5e4e2]/45">
            <span>{filteredDocuments.length} dokumentów</span>
            <span>KSeF, CRM i pozostałe rejestry w jednej kolejności</span>
          </div>
          <DocumentsTable documents={filteredDocuments} onOpen={openDocument} />
        </div>
      ) : section === 'statements' ? (
        <div className="space-y-4">
          {!isStatementMonthOpen && <div className="rounded-xl border border-[#d3bb73]/15 bg-[#d3bb73]/[0.05] px-5 py-4 text-sm leading-6 text-[#e5e4e2]/65">
            Wybierz miesiąc, aby otworzyć jego dashboard: wyciągi, płatności, braki, kadry i podatki.
            W tym samym miejscu przygotujesz paczkę dokumentów spoza KSeF oraz zestawienie płatności zbiorczych dla księgowej.
          </div>}
          <KSeFFinancialDashboard filterCompanyIds={filterCompanyIds} />
        </div>
      ) : section === 'external' ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-[#d3bb73]/15 bg-[#d3bb73]/[0.05] px-5 py-4">
            <h3 className="font-medium text-[#e5e4e2]">Dokumenty spoza KSeF</h3>
            <p className="mt-1 text-sm leading-6 text-[#e5e4e2]/55">
              Wspólny rejestr dokumentów spoza KSeF obejmuje faktury, paragony, polisy ubezpieczeniowe,
              umowy, noty oraz inne dokumenty potwierdzające koszt. Wybierz rodzaj dokumentu podczas dodawania.
            </p>
          </div>
          <ExternalInvoicesTab />
        </div>
      ) : section === 'contracts' ? (
        <div className="space-y-5">
          <div className="rounded-xl border border-[#d3bb73]/15 bg-[#d3bb73]/[0.05] px-5 py-4 text-sm leading-6 text-[#e5e4e2]/65">
            Rejestr obejmuje umowy o pracę, zlecenia i umowy o dzieło. Powiązanie z pracownikiem
            lub podwykonawcą jest opcjonalne — dane osoby pozostają w umowie również po usunięciu jej z CRM.
            Umowy, oferty i kalkulacje wydarzeń nie są tutaj wyświetlane.
          </div>
          <PersonnelContractsRegistry
            filterCompanyIds={filterCompanyIds}
            onChanged={() => void loadWorkspaceData()}
          />
        </div>
      ) : (
        <SaldeoDeliveryPanel filterCompanyIds={filterCompanyIds} />
      )}

      {matchPeriod && (
        <UnmatchedTransactionsModal
          month={matchPeriod.month}
          year={matchPeriod.year}
          companyId={matchPeriod.companyId}
          onClose={() => {
            setMatchPeriod(null);
            void loadWorkspaceData();
          }}
        />
      )}
    </div>
  );
}
