'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Settings,
  Download,
  Upload,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  Building2,
  Calendar,
  FileText,
  Eye,
  FileCheck,
  X,
  CreditCard as Edit,
  Link as LinkIcon,
  LayoutGrid,
  Table2,
  ArrowUpDown,
  Trash2,
  Star,
  Search,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import ResponsiveActionBar from './ResponsiveActionBar';
import InvoiceDetailsModal from './InvoiceDetailsModal';
import BankMatchingSimple from './BankMatchingSimple';
import CompanySelector from './CompanySelector';
import { useDialog } from '@/contexts/DialogContext';
import FullScreenLoader from '../UI/Loader/CustomModalLoader';
import { decodeTextEntities } from '@/lib/textEncoding';
import {
  TableColumnOption,
  TablePreferencesControl,
  tableDensityClasses,
  useStoredTablePreferences,
} from './invoices/TablePreferencesControl';

type KSeFViewMode = 'table' | 'list';

type KSeFSortKey =
  | 'invoice_number'
  | 'contractor'
  | 'issue_date'
  | 'net_amount'
  | 'gross_amount'
  | 'payment_status'
  | 'sync_status';

type SortDirection = 'asc' | 'desc';

interface KSeFCredentials {
  id: string;
  my_company_id: string;
  nip: string;
  is_test_environment: boolean;
  access_token?: string | null;
  access_token_valid_until?: string | null;
  refresh_token?: string | null;
  refresh_token_valid_until?: string | null;
  last_auth_reference_number?: string | null;
  last_authenticated_at?: string | null;
  is_active: boolean;
  my_company?: {
    id: string;
    name: string;
    nip: string;
    is_default: boolean;
  };
}

interface KSeFInvoice {
  id: string;
  invoice_id?: string;
  my_company_id?: string | null;
  ksef_reference_number: string;
  invoice_number?: string | null;
  invoice_type: 'issued' | 'received';
  sync_status: 'pending' | 'synced' | 'error';
  sync_error?: string;
  ksef_issued_at: string;
  issue_date?: string | null;
  seller_name?: string | null;
  buyer_name?: string | null;
  seller_nip?: string | null;
  buyer_nip?: string | null;
  net_amount?: number | null;
  gross_amount?: number | null;
  amount_to_pay_gross?: number | null;
  vat_rate?: string | null;
  invoice_items?: any;
  currency?: string | null;
  synced_at: string;
  payment_status?: string | null;
  payment_due_date?: string | null;
  payment_date?: string | null;
}

interface KSeFInvoicePayment {
  id: string;
  ksef_invoice_id: string;
  amount: number;
  payment_date: string;
  notes?: string | null;
  created_at?: string | null;
  bank_match_id?: string | null;
}

interface SyncLog {
  id: string;
  sync_type: string;
  status: string;
  invoices_count: number;
  error_message?: string;
  started_at: string;
  completed_at?: string;
}

const KSEF_TABLE_COLUMNS: TableColumnOption[] = [
  { id: 'number', label: 'Numer faktury', required: true },
  { id: 'reference', label: 'Numer referencyjny KSeF' },
  { id: 'contractor', label: 'Kontrahent' },
  { id: 'date', label: 'Data' },
  { id: 'net', label: 'Netto' },
  { id: 'gross', label: 'Brutto' },
  { id: 'vat', label: 'Stawka VAT' },
  { id: 'type', label: 'Typ faktury' },
  { id: 'payment', label: 'Status płatności' },
  { id: 'sync', label: 'Status KSeF' },
  { id: 'actions', label: 'Akcje' },
];

const getInvoiceTypeLabel = (invoiceNumber: string | null | undefined): string => {
  if (!invoiceNumber) return 'VAT';

  const upperNumber = invoiceNumber.toUpperCase();

  if (upperNumber.includes('PRO') || upperNumber.includes('PROFORMA')) return 'Pro forma';
  if (upperNumber.includes('ZAL') || upperNumber.includes('ADVANCE')) return 'Zaliczkowa';
  if (upperNumber.includes('KOR') || upperNumber.includes('CORRECTIVE')) return 'Korygująca';
  if (upperNumber.includes('FV')) return 'VAT';

  return 'VAT';
};

const getInvoiceTypeBadgeColor = (type: string): string => {
  switch (type) {
    case 'Pro forma':
      return 'text-blue-400 bg-blue-400/10';
    case 'Zaliczkowa':
      return 'text-purple-400 bg-purple-400/10';
    case 'Korygująca':
      return 'text-orange-400 bg-orange-400/10';
    default:
      return 'text-[#d3bb73] bg-[#d3bb73]/10';
  }
};

const getPaymentStatus = (
  invoice: KSeFInvoice,
  paidSum?: number,
): { status: string; label: string; color: string; icon: any } => {
  if (invoice.payment_status === 'paid') {
    return {
      status: 'paid',
      label: invoice.payment_date
        ? `Opłacona ${new Date(invoice.payment_date).toLocaleDateString('pl-PL')}`
        : 'Opłacona',
      color: 'text-green-400 bg-green-400/10',
      icon: CheckCircle,
    };
  }

  if (invoice.payment_status === 'partially_paid') {
    const gross = Number(invoice.gross_amount || 0);
    const paid = Number(paidSum ?? 0);
    const label =
      paid > 0 && gross > 0
        ? `Częściowo opłacona (${paid.toFixed(2)} / ${gross.toFixed(2)} PLN)`
        : 'Częściowo opłacona';
    return {
      status: 'partially_paid',
      label,
      color: 'text-yellow-400 bg-yellow-400/10',
      icon: RefreshCw,
    };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (invoice.payment_due_date) {
    const dueDate = new Date(invoice.payment_due_date);
    dueDate.setHours(0, 0, 0, 0);

    if (dueDate < today || invoice.payment_status === 'overdue') {
      return {
        status: 'overdue',
        label: 'Płatność po terminie',
        color: 'text-red-400 bg-red-400/10',
        icon: AlertCircle,
      };
    }
  }

  return {
    status: 'unpaid',
    label: 'Nieopłacona',
    color: 'text-orange-400 bg-orange-400/10',
    icon: RefreshCw,
  };
};

const getVatRateLabel = (invoice: KSeFInvoice) => {
  if (invoice.vat_rate) return invoice.vat_rate;

  if (invoice.net_amount != null && invoice.gross_amount != null) {
    const net = Number(invoice.net_amount);
    const gross = Number(invoice.gross_amount);

    if (!net) return '—';

    if (Math.abs(gross - net) < 0.01) {
      return 'zw';
    }

    const vatPercent = Math.round(((gross - net) / net) * 100);
    return `${vatPercent}%`;
  }

  return '23%';
};

interface KSeFIntegrationPanelProps {
  filterCompanyIds?: string[] | null;
}

const normalizeSearchText = (value: unknown) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pl-PL');

const getInvoiceItemsSearchText = (items: unknown): string => {
  if (!items) return '';

  if (typeof items === 'string') return items;

  if (Array.isArray(items)) {
    return items
      .map((item) => {
        if (!item || typeof item !== 'object') return String(item ?? '');
        const record = item as Record<string, unknown>;
        return [
          record.name,
          record.description,
          record.serviceName,
          record.productName,
          record.label,
          record.P_7,
          record.P_7A,
        ]
          .filter(Boolean)
          .join(' ');
      })
      .join(' ');
  }

  if (typeof items === 'object') {
    return Object.values(items as Record<string, unknown>)
      .map((value) => (typeof value === 'object' ? getInvoiceItemsSearchText(value) : String(value ?? '')))
      .join(' ');
  }

  return String(items);
};

export default function KSeFIntegrationPanel({ filterCompanyIds }: KSeFIntegrationPanelProps) {
  const [allCredentials, setAllCredentials] = useState<KSeFCredentials[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [issuedInvoices, setIssuedInvoices] = useState<KSeFInvoice[]>([]);
  const [receivedInvoices, setReceivedInvoices] = useState<KSeFInvoice[]>([]);
  const [syncLogs, setSyncLogs] = useState<SyncLog[]>([]);
  const [activeTab, setActiveTab] = useState<'issued' | 'received' | 'logs'>('issued');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState<KSeFInvoice | null>(null);
  const [editPaymentInvoice, setEditPaymentInvoice] = useState<KSeFInvoice | null>(null);
  const [paymentDate, setPaymentDate] = useState('');
  const [paymentDueDate, setPaymentDueDate] = useState('');
  const [paymentsMap, setPaymentsMap] = useState<Record<string, KSeFInvoicePayment[]>>({});
  const [paymentReviewIds, setPaymentReviewIds] = useState<Set<string>>(new Set());
  const [manualPaymentReviewNotes, setManualPaymentReviewNotes] = useState<Record<string, string>>({});
  const [editingPayments, setEditingPayments] = useState<KSeFInvoicePayment[]>([]);
  const [newPaymentAmount, setNewPaymentAmount] = useState('');
  const [newPaymentDate, setNewPaymentDate] = useState('');
  const [newPaymentNotes, setNewPaymentNotes] = useState('');
  const [viewMode, setViewMode] = useState<KSeFViewMode>('table');
  const [sortKey, setSortKey] = useState<KSeFSortKey>('issue_date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [showMatchModal, setShowMatchModal] = useState(false);
  const [matchModalDate, setMatchModalDate] = useState<{ month: number; year: number } | null>(
    null,
  );
  const [matchInvoice, setMatchInvoice] = useState<KSeFInvoice | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const tablePreferences = useStoredTablePreferences(
    'crm.ksef-invoices.table-preferences.v1',
    KSEF_TABLE_COLUMNS,
  );

  const { canManageModule, employee: currentEmployee, isAdmin } = useCurrentEmployee();
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();

  const allowedCompanyIds = useMemo<string[] | null>(() => {
    if (isAdmin) return null;

    const ids = (currentEmployee as any)?.my_company_ids;

    if (!Array.isArray(ids) || ids.length === 0) return null;

    return ids as string[];
  }, [currentEmployee, isAdmin]);

  useEffect(() => {
    if (filterCompanyIds && filterCompanyIds.length >= 1) {
      setSelectedCompanyId(filterCompanyIds[0]);
    } else if (filterCompanyIds === null || (filterCompanyIds && filterCompanyIds.length === 0)) {
      setSelectedCompanyId(null);
    }
  }, [filterCompanyIds]);

  const canManageKSeF = useMemo(() => canManageModule('invoices'), [canManageModule]);

  const selectedCredentials = allCredentials.find(
    (c) =>
      c.my_company_id === selectedCompanyId ||
      (selectedCompanyId === null && c.my_company?.is_default),
  );

  const currentInvoices = useMemo(() => {
    return activeTab === 'issued' ? issuedInvoices : receivedInvoices;
  }, [activeTab, issuedInvoices, receivedInvoices]);

  const filteredInvoices = useMemo(() => {
    const query = normalizeSearchText(searchQuery.trim());
    if (!query) return currentInvoices;

    return currentInvoices.filter((invoice) => {
      const searchableText = [
        invoice.invoice_number,
        invoice.ksef_reference_number,
        invoice.buyer_name,
        invoice.seller_name,
        invoice.buyer_nip,
        invoice.seller_nip,
        getInvoiceItemsSearchText(invoice.invoice_items),
      ]
        .map(normalizeSearchText)
        .join(' ');

      return searchableText.includes(query);
    });
  }, [currentInvoices, searchQuery]);

  const totalNetAmount = useMemo(() => {
    return filteredInvoices.reduce((sum, inv) => sum + Number(inv.net_amount || 0), 0);
  }, [filteredInvoices]);

  const totalGrossAmount = useMemo(() => {
    return filteredInvoices.reduce((sum, inv) => sum + Number(inv.gross_amount || 0), 0);
  }, [filteredInvoices]);

  const handleSort = (key: KSeFSortKey) => {
    if (sortKey === key) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }

    setSortKey(key);
    setSortDirection('desc');
  };

  const getSortIcon = (key: KSeFSortKey) => {
    if (sortKey !== key) return <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />;
    return sortDirection === 'asc' ? '↑' : '↓';
  };

  const sortedInvoices = useMemo(() => {
    const collator = new Intl.Collator('pl-PL', {
      numeric: true,
      sensitivity: 'base',
    });

    return [...filteredInvoices].sort((a, b) => {
      const direction = sortDirection === 'asc' ? 1 : -1;

      if (sortKey === 'invoice_number') {
        return collator.compare(a.invoice_number || '', b.invoice_number || '') * direction;
      }

      if (sortKey === 'contractor') {
        const aName = activeTab === 'issued' ? a.buyer_name || '' : a.seller_name || '';
        const bName = activeTab === 'issued' ? b.buyer_name || '' : b.seller_name || '';

        return collator.compare(aName, bName) * direction;
      }

      if (sortKey === 'issue_date') {
        const aDate = new Date(a.issue_date || a.ksef_issued_at || 0).getTime();
        const bDate = new Date(b.issue_date || b.ksef_issued_at || 0).getTime();

        return (aDate - bDate) * direction;
      }

      if (sortKey === 'net_amount') {
        return (Number(a.net_amount || 0) - Number(b.net_amount || 0)) * direction;
      }

      if (sortKey === 'gross_amount') {
        return (Number(a.gross_amount || 0) - Number(b.gross_amount || 0)) * direction;
      }

      if (sortKey === 'payment_status') {
        return collator.compare(a.payment_status || '', b.payment_status || '') * direction;
      }

      if (sortKey === 'sync_status') {
        return collator.compare(a.sync_status || '', b.sync_status || '') * direction;
      }

      return 0;
    });
  }, [activeTab, filteredInvoices, sortDirection, sortKey]);

  const loadCredentials = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('ksef_credentials')
        .select(
          `
        *,
        my_company:my_companies(id, name, nip, is_default)
      `,
        )
        .eq('is_active', true);

      if (error) throw error;

      const filtered = (
        allowedCompanyIds
          ? (data || []).filter((c: any) => allowedCompanyIds.includes(c.my_company_id))
          : data || []
      ).sort((a: any, b: any) => {
        return (
          Number(Boolean(b.my_company?.is_default)) - Number(Boolean(a.my_company?.is_default))
        );
      });

      setAllCredentials(filtered);

      const defaultCredential = filtered.find((c: any) => c.my_company?.is_default) || filtered[0];

      if (
        selectedCompanyId &&
        allowedCompanyIds &&
        !allowedCompanyIds.includes(selectedCompanyId)
      ) {
        setSelectedCompanyId(defaultCredential?.my_company_id ?? null);
      } else if (filtered.length > 0 && !selectedCompanyId) {
        setSelectedCompanyId(defaultCredential?.my_company_id ?? null);
      }
    } catch (error) {
      console.error('Error loading credentials:', error);
      showSnackbar('Błąd wczytywania konfiguracji KSeF', 'error');
    }
  }, [allowedCompanyIds, selectedCompanyId, showSnackbar]);

  const loadInvoices = useCallback(async () => {
    try {
      let query = supabase
        .from('ksef_invoices')
        .select('*')
        .eq('sync_status', 'synced')
        .not('ksef_reference_number', 'is', null)
        .neq('ksef_reference_number', '');

      if (selectedCompanyId) {
        query = query.eq('my_company_id', selectedCompanyId);
      } else if (allowedCompanyIds) {
        query = query.in('my_company_id', allowedCompanyIds);
      }

      const { data, error } = await query.order('issue_date', { ascending: false, nullsFirst: false });;

      if (error) throw error;

      const normalizedInvoices = (data || []).map((invoice) => ({
        ...invoice,
        seller_name: decodeTextEntities(invoice.seller_name) || null,
        buyer_name: decodeTextEntities(invoice.buyer_name) || null,
      }));
      const normalizedIssued = normalizedInvoices.filter(
        (inv) => String(inv.invoice_type || '').toLowerCase() === 'issued',
      );
      const normalizedReceived = normalizedInvoices.filter(
        (inv) => String(inv.invoice_type || '').toLowerCase() === 'received',
      );

      setIssuedInvoices(normalizedIssued);
      setReceivedInvoices(normalizedReceived);

      const allIds = [...normalizedIssued, ...normalizedReceived].map((inv) => inv.id);
      if (allIds.length > 0) {
        const { data: paymentsData, error: paymentsErr } = await supabase
          .from('ksef_invoice_payments')
          .select('*')
          .in('ksef_invoice_id', allIds)
          .order('payment_date', { ascending: true });

        if (!paymentsErr && paymentsData) {
          const map: Record<string, KSeFInvoicePayment[]> = {};
          for (const p of paymentsData as KSeFInvoicePayment[]) {
            (map[p.ksef_invoice_id] = map[p.ksef_invoice_id] || []).push(p);
          }
          setPaymentsMap(map);
        }
        const { data: reviewData } = await supabase
          .from('financial_payment_review_issues')
          .select('document_id,issue_code,details')
          .eq('document_source', 'ksef')
          .in('issue_code', [
            'payment_status_without_ledger',
            'manual_match_explanation_required',
          ])
          .is('resolved_at', null)
          .in('document_id', allIds);
        setPaymentReviewIds(new Set((reviewData || []).map((issue) => issue.document_id)));
        setManualPaymentReviewNotes(Object.fromEntries(
          (reviewData || [])
            .filter((issue) => issue.issue_code === 'manual_match_explanation_required')
            .map((issue) => [
              issue.document_id,
              String((issue as { details?: { note?: unknown } }).details?.note || ''),
            ]),
        ));
      } else {
        setPaymentsMap({});
        setPaymentReviewIds(new Set());
        setManualPaymentReviewNotes({});
      }
    } catch (error) {
      console.error('Error loading invoices:', error);
      showSnackbar('Błąd wczytywania faktur z bazy', 'error');
    }
  }, [allowedCompanyIds, selectedCompanyId, showSnackbar]);

  const loadSyncLogs = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('ksef_sync_log')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(20);

      if (error) throw error;

      setSyncLogs(data || []);
    } catch (error) {
      console.error('Error loading sync logs:', error);
    }
  }, []);

  useEffect(() => {
    loadCredentials();
  }, [loadCredentials]);

  useEffect(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();

    const firstDay = new Date(year, month, 1);
    const today = new Date(year, month, now.getDate());

    const formatDate = (date: Date) => {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    };

    setDateFrom(formatDate(firstDay));
    setDateTo(formatDate(today));
  }, []);

  useEffect(() => {
    loadInvoices();
    loadSyncLogs();
  }, [loadInvoices, loadSyncLogs]);

  const handleOpenMatchPayment = (invoice: KSeFInvoice) => {
    const baseDate = invoice.issue_date ? new Date(invoice.issue_date) : new Date();

    setMatchInvoice(invoice);
    setMatchModalDate({
      month: baseDate.getMonth() + 1,
      year: baseDate.getFullYear(),
    });
    setShowMatchModal(true);
  };

  const authenticateForSync = async () => {
    if (!selectedCredentials) {
      throw new Error('Skonfiguruj najpierw dane KSeF dla wybranej firmy');
    }

    const response = await fetch('/bridge/ksef/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyId: selectedCredentials.my_company_id,
      }),
    });

    const raw = await response.text();
    let result: any = null;

    try {
      result = raw ? JSON.parse(raw) : null;
    } catch {
      result = { raw };
    }

    if (!response.ok || !result?.success || !result?.data?.redeemed) {
      throw new Error(
        result?.error ||
          result?.details ||
          `Błąd automatycznej autoryzacji KSeF (HTTP ${response.status})`,
      );
    }
  };

  const handleSyncInvoices = async () => {
    if (!selectedCredentials) {
      showSnackbar('Brak konfiguracji KSeF', 'error');
      return;
    }

    if (!dateFrom || !dateTo) {
      showSnackbar('Wybierz zakres dat w formularzu', 'error');
      return;
    }

    setSyncing(true);

    try {
      if (dateFrom > dateTo) {
        showSnackbar('Data "od" nie może być późniejsza niż data "do"', 'error');
        setSyncing(false);
        return;
      }

      await authenticateForSync();

      const payload = {
        companyId: selectedCredentials.my_company_id,
        dateFrom: `${dateFrom}T00:00:00`,
        dateTo: `${dateTo}T23:59:59`,
      };

      const [issuedResponse, receivedResponse] = await Promise.all([
        fetch('/bridge/ksef/invoices/issued', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }),
        fetch('/bridge/ksef/invoices/received', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }),
      ]);

      const issuedRaw = await issuedResponse.text();
      const receivedRaw = await receivedResponse.text();

      let issuedResult: any = null;
      let receivedResult: any = null;

      try {
        issuedResult = issuedRaw ? JSON.parse(issuedRaw) : null;
      } catch {
        issuedResult = { raw: issuedRaw };
      }

      try {
        receivedResult = receivedRaw ? JSON.parse(receivedRaw) : null;
      } catch {
        receivedResult = { raw: receivedRaw };
      }

      if (!issuedResponse.ok || !issuedResult?.success) {
        throw new Error(
          issuedResult?.error ||
            issuedResult?.details ||
            `Błąd synchronizacji wystawionych (HTTP ${issuedResponse.status})`,
        );
      }

      if (!receivedResponse.ok || !receivedResult?.success) {
        throw new Error(
          receivedResult?.error ||
            receivedResult?.details ||
            `Błąd synchronizacji otrzymanych (HTTP ${receivedResponse.status})`,
        );
      }

      const issuedNew = issuedResult?.data?.newCount || 0;
      const issuedSkipped = issuedResult?.data?.skippedCount || 0;
      const receivedNew = receivedResult?.data?.newCount || 0;
      const receivedSkipped = receivedResult?.data?.skippedCount || 0;

      const parts = [];
      if (issuedNew > 0 || receivedNew > 0) {
        parts.push(`Nowe: ${issuedNew + receivedNew}`);
      }
      if (issuedSkipped > 0 || receivedSkipped > 0) {
        parts.push(`Pominięte (już istnieją): ${issuedSkipped + receivedSkipped}`);
      }

      showSnackbar(
        parts.length > 0
          ? `Synchronizacja zakończona. ${parts.join(', ')}`
          : 'Synchronizacja zakończona - brak nowych faktur',
        'success',
      );

      await new Promise((resolve) => setTimeout(resolve, 400));
      await loadCredentials();
      await loadInvoices();
      await loadSyncLogs();
    } catch (error: any) {
      console.error('[KSEF_FRONT] sync error', error);
      showSnackbar(error.message || 'Błąd synchronizacji', 'error');
    } finally {
      setSyncing(false);
    }
  };

  const handleViewInvoiceXml = async (_invoice: KSeFInvoice) => {
    showSnackbar('Podgląd XML nie został jeszcze przepięty na nowe API Next.js', 'error');
  };

  const handleMarkAsPaid = async (invoice: KSeFInvoice) => {
    try {
      const alreadyPaid = (paymentsMap[invoice.id] || []).reduce(
        (sum, payment) => sum + Number(payment.amount || 0),
        0,
      );
      const remaining = Math.max(
        Math.abs(Number(invoice.amount_to_pay_gross ?? invoice.gross_amount ?? 0)) - alreadyPaid,
        0,
      );
      if (remaining <= 0.009) {
        showSnackbar('Faktura jest już rozliczona w rejestrze wpłat', 'success');
        return;
      }
      const { error } = await supabase.from('ksef_invoice_payments').insert({
        ksef_invoice_id: invoice.id,
        amount: remaining,
        payment_date: new Date().toISOString().slice(0, 10),
        notes: 'Ręczne oznaczenie jako opłacona',
        created_by: currentEmployee?.id ?? null,
      });

      if (error) throw error;

      showSnackbar('Faktura oznaczona jako opłacona', 'success');
      await loadInvoices();
    } catch (error: any) {
      console.error('Error marking invoice as paid:', error);
      showSnackbar(error.message || 'Błąd podczas oznaczania faktury', 'error');
    }
  };

  const handleDeleteKsefInvoice = useCallback(
    async (invoice: KSeFInvoice) => {
      if (!isAdmin) {
        showSnackbar('Tylko administrator może usunąć fakturę z lokalnej bazy', 'error');
        return;
      }

      const confirmed = await showConfirm(
        `Czy na pewno chcesz usunąć fakturę ${
          invoice.invoice_number || invoice.ksef_reference_number
        } z lokalnej bazy? Nie usuwa to faktury z KSeF.`,
      );

      if (!confirmed) return;

      try {
        const { data, error } = await supabase
          .from('ksef_invoices')
          .delete()
          .eq('id', invoice.id)
          .select('id');

        if (error) throw error;

        if (!data || data.length === 0) {
          showSnackbar(
            'Nie usunięto faktury. Rekord nie istnieje albo brak uprawnień RLS do usuwania.',
            'error',
          );
          return;
        }

        showSnackbar('Faktura została usunięta z lokalnej bazy', 'success');

        await loadInvoices();
        await loadSyncLogs();
      } catch (error: any) {
        console.error('Error deleting KSeF invoice:', error);
        showSnackbar(error.message || 'Błąd podczas usuwania faktury', 'error');
      }
    },
    [isAdmin, loadInvoices, loadSyncLogs, showSnackbar],
  );

  const handleMarkAsUnpaid = async (invoice: KSeFInvoice) => {
    try {
      const { error } = await supabase
        .from('ksef_invoice_payments')
        .delete()
        .eq('ksef_invoice_id', invoice.id)
        .is('bank_match_id', null);

      if (error) throw error;

      await supabase
        .from('financial_payment_review_issues')
        .update({ resolved_at: new Date().toISOString(), resolved_by: currentEmployee?.id ?? null })
        .eq('document_source', 'ksef')
        .eq('document_id', invoice.id)
        .eq('issue_code', 'payment_status_without_ledger')
        .is('resolved_at', null);

      showSnackbar('Usunięto ręczne wpłaty. Dopasowania z wyciągów pozostają zachowane.', 'success');
      await loadInvoices();
    } catch (error: any) {
      console.error('Error marking invoice as unpaid:', error);
      showSnackbar(error.message || 'Błąd podczas aktualizacji statusu', 'error');
    }
  };

  const handleOpenEditPayment = (invoice: KSeFInvoice) => {
    setEditPaymentInvoice(invoice);
    setPaymentDate(
      invoice.payment_date ? new Date(invoice.payment_date).toISOString().split('T')[0] : '',
    );
    setPaymentDueDate(invoice.payment_due_date || '');
    setEditingPayments(paymentsMap[invoice.id] || []);
    setNewPaymentAmount('');
    setNewPaymentDate(new Date().toISOString().split('T')[0]);
    setNewPaymentNotes('');
  };

  const handleAddPartialPayment = async () => {
    if (!editPaymentInvoice) return;
    const amount = parseFloat(newPaymentAmount.replace(',', '.'));
    if (!amount || amount <= 0) {
      showSnackbar('Podaj poprawną kwotę wpłaty', 'error');
      return;
    }
    if (!newPaymentDate) {
      showSnackbar('Podaj datę wpłaty', 'error');
      return;
    }

    try {
      const { data, error } = await supabase
        .from('ksef_invoice_payments')
        .insert({
          ksef_invoice_id: editPaymentInvoice.id,
          amount,
          payment_date: newPaymentDate,
          notes: newPaymentNotes || null,
          created_by: currentEmployee?.id ?? null,
        })
        .select()
        .single();

      if (error) throw error;

      setEditingPayments((prev) => [...prev, data as KSeFInvoicePayment]);
      setNewPaymentAmount('');
      setNewPaymentNotes('');
      showSnackbar('Wpłata dodana', 'success');
      await loadInvoices();
    } catch (error: any) {
      console.error('Error adding payment:', error);
      showSnackbar(error.message || 'Błąd dodawania wpłaty', 'error');
    }
  };

  const handleRemovePartialPayment = async (payment: KSeFInvoicePayment) => {
    if (payment.bank_match_id) {
      showSnackbar('Wpłatę z wyciągu usuń przez odpięcie dopasowania transakcji', 'error');
      return;
    }
    try {
      const { error } = await supabase
        .from('ksef_invoice_payments')
        .delete()
        .eq('id', payment.id)
        .is('bank_match_id', null);

      if (error) throw error;

      setEditingPayments((prev) => prev.filter((p) => p.id !== payment.id));
      showSnackbar('Wpłata usunięta', 'success');
      await loadInvoices();
    } catch (error: any) {
      console.error('Error removing payment:', error);
      showSnackbar(error.message || 'Błąd usuwania wpłaty', 'error');
    }
  };

  const handleSavePaymentEdit = async () => {
    if (!editPaymentInvoice) return;

    try {
      const updates: any = {
        payment_due_date: paymentDueDate || null,
      };

      const hasPayments = editingPayments.length > 0;
      const gross = Math.abs(
        Number(editPaymentInvoice.amount_to_pay_gross ?? editPaymentInvoice.gross_amount ?? 0),
      );

      if (!hasPayments) {
        if (paymentDate) {
          const { error: paymentError } = await supabase.from('ksef_invoice_payments').insert({
            ksef_invoice_id: editPaymentInvoice.id,
            amount: gross,
            payment_date: paymentDate,
            notes: 'Ręcznie zarejestrowana pełna płatność',
            created_by: currentEmployee?.id ?? null,
          });
          if (paymentError) throw paymentError;
        } else {
          updates.payment_date = null;
          if (paymentDueDate && new Date(paymentDueDate) < new Date()) {
            updates.payment_status = 'overdue';
          } else {
            updates.payment_status = 'unpaid';
          }
        }
      }

      const { error } = await supabase
        .from('ksef_invoices')
        .update(updates)
        .eq('id', editPaymentInvoice.id);

      if (error) throw error;

      if (!hasPayments && !paymentDate) {
        await supabase
          .from('financial_payment_review_issues')
          .update({ resolved_at: new Date().toISOString(), resolved_by: currentEmployee?.id ?? null })
          .eq('document_source', 'ksef')
          .eq('document_id', editPaymentInvoice.id)
          .eq('issue_code', 'payment_status_without_ledger')
          .is('resolved_at', null);
      }

      showSnackbar('Dane płatności zaktualizowane', 'success');
      setEditPaymentInvoice(null);
      await loadInvoices();
    } catch (error: any) {
      console.error('Error updating payment:', error);
      showSnackbar(error.message || 'Błąd podczas aktualizacji', 'error');
    }
  };

  const handleResolveManualPaymentReview = useCallback(async (invoice: KSeFInvoice) => {
    try {
      const { data, error } = await supabase
        .from('financial_payment_review_issues')
        .update({
          resolved_at: new Date().toISOString(),
          resolved_by: currentEmployee?.id ?? null,
        })
        .eq('document_source', 'ksef')
        .eq('document_id', invoice.id)
        .eq('issue_code', 'manual_match_explanation_required')
        .is('resolved_at', null)
        .select('id');

      if (error) throw error;
      if (!data?.length) throw new Error('Nie znaleziono aktywnej uwagi albo brak uprawnień do jej zamknięcia.');

      showSnackbar('Faktura została oznaczona jako wyjaśniona.', 'success');
      await loadInvoices();
    } catch (error: any) {
      showSnackbar(error?.message || 'Nie udało się zamknąć uwagi do faktury.', 'error');
    }
  }, [currentEmployee?.id, loadInvoices, showSnackbar]);

  const getInvoiceActions = useCallback(
    (invoice: KSeFInvoice) => {
      const actions = [
        {
          label: 'Szczegóły',
          onClick: () => setSelectedInvoice(invoice),
          icon: <FileCheck className="h-4 w-4" />,
          variant: 'default' as const,
        },
        {
          label: 'Edytuj płatność',
          onClick: () => handleOpenEditPayment(invoice),
          icon: <Edit className="h-4 w-4" />,
          variant: 'default' as const,
        },
        {
          label: 'Zobacz XML',
          onClick: () => handleViewInvoiceXml(invoice),
          icon: <Eye className="h-4 w-4" />,
          variant: 'default' as const,
          disabled: invoice.sync_status !== 'synced',
        },
      ];

      if (manualPaymentReviewNotes[invoice.id]) {
        actions.push({
          label: 'Oznacz uwagę jako wyjaśnioną',
          onClick: () => handleResolveManualPaymentReview(invoice),
          icon: <CheckCircle className="h-4 w-4" />,
          variant: 'default' as const,
        });
      }

      if (invoice.payment_status === 'paid') {
        actions.push({
          label: 'Oznacz jako nieopłaconą',
          onClick: () => handleMarkAsUnpaid(invoice),
          icon: <X className="h-4 w-4" />,
          variant: 'default' as const,
        });
      } else {
        actions.push(
          {
            label: 'Dopasuj płatność',
            onClick: () => handleOpenMatchPayment(invoice),
            icon: <LinkIcon className="h-4 w-4" />,
            variant: 'default' as const,
          },
          {
            label: 'Oznacz jako opłaconą',
            onClick: () => handleMarkAsPaid(invoice),
            icon: <CheckCircle className="h-4 w-4" />,
            variant: 'default' as const,
          },
        );
      }

      if (isAdmin) {
        actions.push({
          label: 'Usuń z bazy',
          onClick: () => handleDeleteKsefInvoice(invoice),
          icon: <Trash2 className="h-4 w-4" />,
          variant: 'default' as const,
        });
      }

      return actions;
    },
    [
      isAdmin,
      handleDeleteKsefInvoice,
      handleMarkAsPaid,
      handleMarkAsUnpaid,
      handleOpenMatchPayment,
      handleOpenEditPayment,
      handleViewInvoiceXml,
      handleResolveManualPaymentReview,
      manualPaymentReviewNotes,
    ],
  );

  const renderActions = useCallback(
    (invoice: KSeFInvoice) => (
      <ResponsiveActionBar
        disabledBackground
        compact
        mobileBreakpoint={4000}
        actions={getInvoiceActions(invoice)}
      />
    ),
    [getInvoiceActions],
  );

  const SortableHeader = ({
    label,
    sort,
    align = 'left',
  }: {
    label: string;
    sort: KSeFSortKey;
    align?: 'left' | 'right';
  }) => (
    <th
      onClick={() => handleSort(sort)}
      className={`cursor-pointer px-2.5 py-2 text-[11px] font-medium uppercase tracking-wide text-[#e5e4e2]/60 transition-colors hover:text-[#d3bb73] ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      <span className={`flex items-center gap-1 ${align === 'right' ? 'justify-end' : ''}`}>
        {label} {getSortIcon(sort)}
      </span>
    </th>
  );

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-[#e5e4e2]/60">
            Krajowy System e-Faktur - synchronizacja faktur
          </p>
        </div>
      </div>

      {allCredentials.length === 0 && (
        <div className="rounded-xl border border-[#d3bb73]/20 bg-[#252945] p-8 text-center">
          <Building2 className="mx-auto mb-4 h-12 w-12 text-[#e5e4e2]/20" />
          <p className="mb-4 text-[#e5e4e2]/60">
            Brak skonfigurowanych firm. Najpierw dodaj firmę i skonfiguruj jej dane KSeF.
          </p>
          {canManageKSeF && (
            <button
              onClick={() => setShowSetup(true)}
              className="text-[#d3bb73] hover:text-[#d3bb73]/80"
            >
              Skonfiguruj KSeF
            </button>
          )}
        </div>
      )}

      {allCredentials.length > 0 && (
        <div className="min-w-0 overflow-hidden rounded-xl border border-[#d3bb73]/20 bg-[#252945] p-3">
          <div className="mb-3 flex items-center justify-between gap-3 border-b border-[#d3bb73]/10 pb-3 xl:hidden">
            <div className="min-w-0">
              <p className="text-sm font-medium text-[#e5e4e2]">Połączenie z KSeF</p>
              <p className="mt-0.5 text-xs text-[#e5e4e2]/45">
                Automatyczna synchronizacja codziennie o 09:30
              </p>
            </div>
            <div className="shrink-0">
              <ResponsiveActionBar
                mobileBreakpoint={4000}
                actions={
                  canManageKSeF
                    ? [
                        {
                          label: 'Konfiguracja',
                          onClick: () => setShowSetup(true),
                          icon: <Settings className="h-4 w-4" />,
                          variant: 'default' as const,
                        },
                        {
                          label: syncing ? 'Synchronizacja...' : 'Synchronizuj',
                          onClick: handleSyncInvoices,
                          icon: <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />,
                          variant: 'primary' as const,
                          disabled: syncing || !selectedCredentials,
                        },
                      ]
                    : []
                }
              />
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="grid min-w-0 flex-1 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[minmax(260px,360px)_auto_auto] xl:items-center">
              {!filterCompanyIds ? (
              <div className="min-w-0">
                <label className="mb-1 block text-xs text-[#e5e4e2]/50">Firma KSeF</label>
                <select
                  value={selectedCompanyId ?? ''}
                  onChange={(e) => setSelectedCompanyId(e.target.value || null)}
                  className="h-10 w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-3 text-sm text-[#e5e4e2] outline-none transition-colors focus:border-[#d3bb73]"
                >
                  {allCredentials.map((credential) => (
                    <option key={credential.id} value={credential.my_company_id}>
                      {credential.my_company?.is_default ? '★ ' : ''}
                      {credential.my_company?.name || credential.nip}
                      {credential.my_company?.nip ? ` — ${credential.my_company.nip}` : ''}
                    </option>
                  ))}
                </select>
              </div>
              ) : null}

              {selectedCredentials && (
                <div className="min-w-0">
                  <label className="mb-1 block text-xs text-[#e5e4e2]/50">
                    {' '}
                    <div className="flex items-center gap-2 text-xs text-[#e5e4e2]/50">
                      <span>
                        {selectedCredentials.is_test_environment ? 'Testowe' : 'Produkcyjne'}
                      </span>

                      {selectedCredentials.my_company?.is_default && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[#d3bb73]/10 px-2 py-0.5 text-[10px] text-[#d3bb73]">
                          <Star className="h-3 w-3 fill-current" />
                          Główna
                        </span>
                      )}
                    </div>
                  </label>
                  <div className="flex h-10 items-center gap-2 rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] px-3">
                    <Building2 className="h-4 w-4 text-[#d3bb73]" />

                    <div className="min-w-0">
                      <div className="truncate text-sm text-[#e5e4e2]">
                        NIP: {selectedCredentials.nip}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="min-w-0">
                <label className="mb-1 block text-xs text-[#e5e4e2]/50">Automatyzacja</label>

                <div className="flex h-10 items-center gap-2 rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] px-3">
                  <CheckCircle className="h-4 w-4 text-green-400" />
                  <span className="text-sm text-green-400">Codziennie 09:30</span>
                </div>
              </div>
            </div>
            <div className="min-w-0">
              <label className="mb-1 block text-xs text-[#e5e4e2]/50">Zakres dat</label>
              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] px-2 py-2 sm:flex sm:px-3">
                <Calendar className="hidden h-4 w-4 shrink-0 text-[#d3bb73] sm:block" />

                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="min-w-0 w-full bg-transparent text-xs text-[#e5e4e2] outline-none sm:w-[135px] sm:text-sm"
                />

                <span className="text-xs text-[#e5e4e2]/40">—</span>

                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="min-w-0 w-full bg-transparent text-xs text-[#e5e4e2] outline-none sm:w-[135px] sm:text-sm"
                />
              </div>
            </div>
            <div className="hidden xl:block">
              <label className="mb-1 block text-xs text-[#e5e4e2]/50">Akcje</label>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end xl:items-center">
                <ResponsiveActionBar
                  mobileBreakpoint={4000}
                  actions={
                    canManageKSeF
                      ? [
                          {
                            label: 'Konfiguracja',
                            onClick: () => setShowSetup(true),
                            icon: <Settings className="h-4 w-4" />,
                            variant: 'default' as const,
                          },
                          {
                            label: syncing ? 'Synchronizacja...' : 'Synchronizuj',
                            onClick: handleSyncInvoices,
                            icon: <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />,
                            variant: 'primary' as const,
                            disabled: syncing || !selectedCredentials,
                          },
                        ]
                      : []
                  }
                />
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex snap-x snap-mandatory gap-1 overflow-x-auto overscroll-x-contain rounded-lg border border-[#d3bb73]/20 bg-[#252945] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <button data-crm-tab-active={activeTab === 'issued'}
          onClick={() => setActiveTab('issued')}
          className={`shrink-0 snap-start whitespace-nowrap rounded px-4 py-2 text-sm font-medium transition-colors sm:flex-1 ${
            activeTab === 'issued'
              ? 'bg-[#d3bb73] text-[#1c1f33]'
              : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
          }`}
        >
          <Upload className="mr-2 inline-block h-4 w-4" />
          Wystawione ({issuedInvoices.length})
        </button>

        <button data-crm-tab-active={activeTab === 'received'}
          onClick={() => setActiveTab('received')}
          className={`shrink-0 snap-start whitespace-nowrap rounded px-4 py-2 text-sm font-medium transition-colors sm:flex-1 ${
            activeTab === 'received'
              ? 'bg-[#d3bb73] text-[#1c1f33]'
              : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
          }`}
        >
          <Download className="mr-2 inline-block h-4 w-4" />
          Otrzymane ({receivedInvoices.length})
        </button>

        <button data-crm-tab-active={activeTab === 'logs'}
          onClick={() => setActiveTab('logs')}
          className={`shrink-0 snap-start whitespace-nowrap rounded px-4 py-2 text-sm font-medium transition-colors sm:flex-1 ${
            activeTab === 'logs'
              ? 'bg-[#d3bb73] text-[#1c1f33]'
              : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
          }`}
        >
          <FileText className="mr-2 inline-block h-4 w-4" />
          Historia ({syncLogs.length})
        </button>
      </div>

      <div className="rounded-xl border border-[#d3bb73]/20 bg-[#252945]">
        <div className="flex flex-col gap-3 border-b border-[#d3bb73]/10 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h3 className="font-medium text-[#e5e4e2]">
              {activeTab === 'issued' && 'Faktury wystawione'}
              {activeTab === 'received' && 'Faktury otrzymane'}
              {activeTab === 'logs' && 'Historia synchronizacji'}
            </h3>
            {activeTab !== 'logs' && searchQuery.trim() && (
              <p className="mt-1 text-xs text-[#e5e4e2]/45">
                Znaleziono {sortedInvoices.length} z {currentInvoices.length}
              </p>
            )}
          </div>

          {activeTab !== 'logs' && (
            <div className="flex w-full min-w-0 flex-wrap items-center justify-end gap-2 sm:w-auto sm:flex-nowrap">
              <div className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-3 sm:w-80 sm:flex-none">
                <Search className="h-4 w-4 shrink-0 text-[#e5e4e2]/40" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Numer, klient lub usługa…"
                  className="min-w-0 flex-1 bg-transparent text-sm text-[#e5e4e2] outline-none placeholder:text-[#e5e4e2]/35"
                  aria-label="Szukaj faktury KSeF"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="shrink-0 rounded p-1 text-[#e5e4e2]/40 transition-colors hover:text-[#e5e4e2]"
                    aria-label="Wyczyść wyszukiwanie"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              {viewMode === 'table' && (
                <TablePreferencesControl
                  columns={KSEF_TABLE_COLUMNS}
                  density={tablePreferences.density}
                  visibleColumns={tablePreferences.visibleColumns}
                  onToggleColumn={tablePreferences.toggleColumn}
                  onDensityChange={tablePreferences.setDensity}
                  onReset={tablePreferences.reset}
                />
              )}

              <div className="flex shrink-0 overflow-hidden rounded-lg border border-[#d3bb73]/20">
                <button
                  onClick={() => setViewMode('table')}
                  className={`flex items-center gap-1.5 px-3 py-2 text-sm transition-colors ${
                    viewMode === 'table'
                      ? 'bg-[#d3bb73]/20 text-[#d3bb73]'
                      : 'text-[#e5e4e2]/50 hover:text-[#e5e4e2]'
                  }`}
                  title="Widok tabeli"
                >
                  <Table2 className="h-4 w-4" />
                </button>

                <button
                  onClick={() => setViewMode('list')}
                  className={`flex items-center gap-1.5 border-l border-[#d3bb73]/20 px-3 py-2 text-sm transition-colors ${
                    viewMode === 'list'
                      ? 'bg-[#d3bb73]/20 text-[#d3bb73]'
                      : 'text-[#e5e4e2]/50 hover:text-[#e5e4e2]'
                  }`}
                  title="Widok listy"
                >
                  <LayoutGrid className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>

        {(activeTab === 'issued' || activeTab === 'received') && (
          <>
            {sortedInvoices.length === 0 ? (
              <div className="p-8 text-center text-[#e5e4e2]/40">
                {searchQuery.trim()
                  ? 'Nie znaleziono faktury pasującej do wyszukiwania'
                  : 'Brak faktur do wyświetlenia'}
              </div>
            ) : viewMode === 'table' ? (
              <div className="overflow-x-auto">
                <table
                  className={`min-w-[760px] border-collapse ${tableDensityClasses[tablePreferences.density]}`}
                >
                  <thead>
                    <tr className="border-b border-[#d3bb73]/10 bg-[#1c1f33]/40">
                      <SortableHeader label="Numer faktury" sort="invoice_number" />
                      {tablePreferences.isColumnVisible('reference') && (
                        <th className="px-2.5 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-[#e5e4e2]/60">Nr KSeF</th>
                      )}
                      {tablePreferences.isColumnVisible('contractor') && <SortableHeader label="Kontrahent" sort="contractor" />}
                      {tablePreferences.isColumnVisible('date') && <SortableHeader label="Data" sort="issue_date" />}
                      {tablePreferences.isColumnVisible('net') && <SortableHeader label="Netto" sort="net_amount" align="right" />}
                      {tablePreferences.isColumnVisible('gross') && <SortableHeader label="Brutto" sort="gross_amount" align="right" />}
                      {tablePreferences.isColumnVisible('vat') && (
                        <th className="px-2.5 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-[#e5e4e2]/60">VAT</th>
                      )}
                      {tablePreferences.isColumnVisible('type') && (
                        <th className="px-2.5 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-[#e5e4e2]/60">Typ</th>
                      )}
                      {tablePreferences.isColumnVisible('payment') && <SortableHeader label="Płatność" sort="payment_status" />}
                      {tablePreferences.isColumnVisible('sync') && <SortableHeader label="KSeF" sort="sync_status" />}
                      {tablePreferences.isColumnVisible('actions') && (
                        <th className="px-2.5 py-2 text-right text-[11px] font-medium uppercase tracking-wide text-[#e5e4e2]/60">Akcje</th>
                      )}
                    </tr>
                  </thead>

                  <tbody>
                    {sortedInvoices.map((invoice) => {
                      const contractorName =
                        activeTab === 'issued'
                          ? invoice.buyer_name || 'Brak danych nabywcy'
                          : invoice.seller_name || 'Brak danych sprzedawcy';

                      const contractorNip =
                        activeTab === 'issued'
                          ? invoice.buyer_nip || 'Brak NIP'
                          : invoice.seller_nip || 'Brak NIP';

                      const invoiceDate = invoice.issue_date || invoice.ksef_issued_at;
                      const invoiceType = getInvoiceTypeLabel(invoice.invoice_number);
                      const typeBadgeColor = getInvoiceTypeBadgeColor(invoiceType);
                      const paidSum = (paymentsMap[invoice.id] || []).reduce(
                        (s, p) => s + Number(p.amount || 0),
                        0,
                      );
                      const paymentStatus = getPaymentStatus(invoice, paidSum);
                      const PaymentIcon = paymentStatus.icon;

                      return (
                        <tr
                          key={invoice.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedInvoice(invoice)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              setSelectedInvoice(invoice);
                            }
                          }}
                          className="cursor-pointer border-b border-[#d3bb73]/10 transition-colors hover:bg-[#1c1f33]/60 focus:bg-[#1c1f33]/60 focus:outline-none"
                        >
                          <td className="px-2.5 py-2 text-xs font-medium text-[#e5e4e2]">
                            {invoice.invoice_number || 'Brak numeru faktury'}
                          </td>

                          {tablePreferences.isColumnVisible('reference') && (
                            <td className="max-w-[180px] truncate px-2.5 py-2 font-mono text-[#e5e4e2]/45" title={invoice.ksef_reference_number}>
                              {invoice.ksef_reference_number}
                            </td>
                          )}

                          {tablePreferences.isColumnVisible('contractor') && (
                            <td className="px-2.5 py-2 text-[#e5e4e2]/80">
                              {contractorName} <span className="text-[#e5e4e2]/35">· {contractorNip}</span>
                            </td>
                          )}

                          {tablePreferences.isColumnVisible('date') && (
                            <td className="whitespace-nowrap px-2.5 py-2 text-[#e5e4e2]/80">
                              {invoiceDate ? new Date(invoiceDate).toLocaleDateString('pl-PL') : '—'}
                            </td>
                          )}

                          {tablePreferences.isColumnVisible('net') && (
                            <td className="whitespace-nowrap px-2.5 py-2 text-right text-[#e5e4e2]/80">
                              {invoice.net_amount != null ? `${Number(invoice.net_amount).toFixed(2)} PLN` : '—'}
                            </td>
                          )}

                          {tablePreferences.isColumnVisible('gross') && (
                            <td className="whitespace-nowrap px-2.5 py-2 text-right font-medium text-[#e5e4e2]">
                              {invoice.gross_amount != null ? `${Number(invoice.gross_amount).toFixed(2)} PLN` : '—'}
                            </td>
                          )}

                          {tablePreferences.isColumnVisible('vat') && (
                            <td className="px-2.5 py-2 text-blue-400">{getVatRateLabel(invoice)}</td>
                          )}

                          {tablePreferences.isColumnVisible('type') && (
                            <td className={`px-2.5 py-2 font-medium ${typeBadgeColor.split(' ')[0]}`}>{invoiceType}</td>
                          )}

                          {tablePreferences.isColumnVisible('payment') && (
                            <td className={`whitespace-nowrap px-2.5 py-2 font-medium ${paymentStatus.color.split(' ')[0]}`}>
                              <PaymentIcon className="mr-1 inline h-3 w-3" />
                              {paymentStatus.label}
                              {paymentReviewIds.has(invoice.id) && (
                                <span
                                  title={manualPaymentReviewNotes[invoice.id] || undefined}
                                  className="ml-2 rounded bg-orange-500/15 px-1.5 py-0.5 text-[10px] text-orange-300"
                                >
                                  {manualPaymentReviewNotes[invoice.id]
                                    ? 'wymaga wyjaśnienia'
                                    : 'do weryfikacji'}
                                </span>
                              )}
                            </td>
                          )}

                          {tablePreferences.isColumnVisible('sync') && (
                            <td className="px-2.5 py-2">
                              {invoice.sync_status === 'synced' && <span className="text-green-400">✓ OK</span>}
                              {invoice.sync_status === 'error' && <span className="text-red-400">⚠ Błąd</span>}
                              {invoice.sync_status === 'pending' && <span className="text-yellow-400">↻ Oczekuje</span>}
                            </td>
                          )}

                          {tablePreferences.isColumnVisible('actions') && (
                            <td className="px-2.5 py-2 text-right">{renderActions(invoice)}</td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="sticky left-0 flex items-center justify-end gap-4 border-t border-[#d3bb73]/20 bg-[#d3bb73]/5 px-2 py-1.5 text-[10px]">
                  <span className="text-[#e5e4e2]/55">Netto: {totalNetAmount.toFixed(2)} PLN</span>
                  <span className="font-semibold text-[#d3bb73]">Brutto: {totalGrossAmount.toFixed(2)} PLN</span>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-2 xl:grid-cols-3">
                {sortedInvoices.map((invoice) => {
                  const contractorName =
                    activeTab === 'issued'
                      ? invoice.buyer_name || 'Brak danych nabywcy'
                      : invoice.seller_name || 'Brak danych sprzedawcy';

                  const contractorNip =
                    activeTab === 'issued'
                      ? invoice.buyer_nip || 'Brak NIP'
                      : invoice.seller_nip || 'Brak NIP';

                  const invoiceDate = invoice.issue_date || invoice.ksef_issued_at;
                  const invoiceType = getInvoiceTypeLabel(invoice.invoice_number);
                  const typeBadgeColor = getInvoiceTypeBadgeColor(invoiceType);
                  const paidSumList = (paymentsMap[invoice.id] || []).reduce(
                    (s, p) => s + Number(p.amount || 0),
                    0,
                  );
                  const paymentStatus = getPaymentStatus(invoice, paidSumList);
                  const PaymentIcon = paymentStatus.icon;

                  return (
                    <div
                      key={invoice.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedInvoice(invoice)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setSelectedInvoice(invoice);
                        }
                      }}
                      className="cursor-pointer rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-4 transition-colors hover:border-[#d3bb73]/30 focus:border-[#d3bb73]/30 focus:outline-none"
                    >
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <div>
                          <div className="font-medium text-[#e5e4e2]">
                            {invoice.invoice_number || 'Brak numeru faktury'}
                          </div>
                          <div className="mt-1 text-xs text-[#e5e4e2]/40">
                            KSeF: {invoice.ksef_reference_number}
                          </div>
                        </div>

                        <span
                          className={`rounded-full px-3 py-1 text-xs font-medium ${typeBadgeColor}`}
                        >
                          {invoiceType}
                        </span>
                      </div>

                      <div className="mb-3 text-sm text-[#e5e4e2]/80">
                        <div>{contractorName}</div>
                        <div className="mt-1 text-xs text-[#e5e4e2]/40">NIP: {contractorNip}</div>
                      </div>

                      <div className="mb-3 grid grid-cols-2 gap-3 border-t border-[#d3bb73]/10 pt-3 text-sm">
                        <div>
                          <div className="text-xs text-[#e5e4e2]/40">Data</div>
                          <div className="text-[#e5e4e2]/80">
                            {invoiceDate ? new Date(invoiceDate).toLocaleDateString('pl-PL') : '—'}
                          </div>
                        </div>

                        <div className="text-right">
                          <div className="text-xs text-[#e5e4e2]/40">Brutto</div>
                          <div className="font-medium text-[#d3bb73]">
                            {invoice.gross_amount != null
                              ? `${Number(invoice.gross_amount).toFixed(2)} PLN`
                              : '—'}
                          </div>
                        </div>

                        <div>
                          <div className="text-xs text-[#e5e4e2]/40">Netto</div>
                          <div className="text-[#e5e4e2]/80">
                            {invoice.net_amount != null
                              ? `${Number(invoice.net_amount).toFixed(2)} PLN`
                              : '—'}
                          </div>
                        </div>

                        <div className="text-right">
                          <div className="text-xs text-[#e5e4e2]/40">KSeF</div>
                          <div className="text-[#e5e4e2]/80">{invoice.sync_status}</div>
                        </div>
                      </div>

                      <div className="mb-4 flex items-center gap-2">
                        <PaymentIcon className="h-4 w-4" />
                        <span
                          className={`text-sm font-medium ${paymentStatus.color.split(' ')[0]}`}
                        >
                          {paymentStatus.label}
                        </span>
                        {paymentReviewIds.has(invoice.id) && (
                          <span
                            title={manualPaymentReviewNotes[invoice.id] || undefined}
                            className="rounded bg-orange-500/15 px-2 py-1 text-xs text-orange-300"
                          >
                            {manualPaymentReviewNotes[invoice.id]
                              ? 'Wymaga dodatkowego wyjaśnienia'
                              : 'Status bez wpisu wpłaty — zweryfikuj'}
                          </span>
                        )}
                      </div>

                      {manualPaymentReviewNotes[invoice.id] && (
                        <div className="mb-4 rounded-lg border border-orange-400/20 bg-orange-400/5 px-3 py-2.5 text-xs leading-relaxed text-orange-100/85">
                          <strong className="block text-orange-200">Uwaga do rozliczenia</strong>
                          <span className="mt-1 block whitespace-pre-wrap">
                            {manualPaymentReviewNotes[invoice.id]}
                          </span>
                        </div>
                      )}

                      {renderActions(invoice)}
                    </div>
                  );
                })}

                <div className="rounded-xl border border-[#d3bb73]/20 bg-[#d3bb73]/5 p-4 lg:col-span-2 xl:col-span-3">
                  <div className="flex flex-wrap items-center justify-end gap-6 text-sm">
                    <span className="text-[#e5e4e2]/70">
                      Netto:{' '}
                      <span className="font-medium text-[#e5e4e2]">
                        {totalNetAmount.toFixed(2)} PLN
                      </span>
                    </span>
                    <span className="text-[#e5e4e2]/70">
                      Brutto:{' '}
                      <span className="font-bold text-[#d3bb73]">
                        {totalGrossAmount.toFixed(2)} PLN
                      </span>
                    </span>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {activeTab === 'logs' && (
          <div className="divide-y divide-[#d3bb73]/10">
            {syncLogs.length === 0 ? (
              <div className="p-8 text-center text-[#e5e4e2]/40">Brak historii synchronizacji</div>
            ) : (
              syncLogs.map((log) => (
                <div key={log.id} className="p-4 hover:bg-[#1c1f33]/50">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className={`rounded-full p-2 ${
                          log.status === 'success' ? 'bg-green-400/10' : 'bg-red-400/10'
                        }`}
                      >
                        {log.status === 'success' ? (
                          <CheckCircle className="h-4 w-4 text-green-400" />
                        ) : (
                          <AlertCircle className="h-4 w-4 text-red-400" />
                        )}
                      </div>

                      <div>
                        <p className="font-medium text-[#e5e4e2]">
                          Synchronizacja: {log.sync_type === 'issued' ? 'Wystawione' : 'Otrzymane'}
                        </p>
                        <p className="text-sm text-[#e5e4e2]/60">
                          {new Date(log.started_at).toLocaleString('pl-PL')}
                        </p>
                      </div>
                    </div>

                    <div className="text-right">
                      <p className="font-medium text-[#e5e4e2]">{log.invoices_count} faktur</p>
                      {log.error_message && (
                        <p className="text-xs text-red-400">{log.error_message}</p>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {editPaymentInvoice && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] shadow-xl">
            <div className="flex items-center justify-between border-b border-[#d3bb73]/10 p-6">
              <h3 className="text-xl font-medium text-[#e5e4e2]">Edycja płatności</h3>
              <button
                onClick={() => setEditPaymentInvoice(null)}
                className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 p-6">
              <div>
                <div className="mb-2 text-sm text-[#e5e4e2]/60">Faktura</div>
                <div className="text-base font-medium text-[#e5e4e2]">
                  {editPaymentInvoice.invoice_number || editPaymentInvoice.ksef_reference_number}
                </div>
              </div>

              <div>
                <div className="mb-2 text-sm text-[#e5e4e2]/60">Kwota</div>
                <div className="text-base font-medium text-[#d3bb73]">
                  {editPaymentInvoice.gross_amount != null
                    ? `${Number(editPaymentInvoice.gross_amount).toFixed(2)} PLN`
                    : 'Brak danych'}
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]">Termin płatności</label>
                <input
                  type="date"
                  value={paymentDueDate}
                  onChange={(e) => setPaymentDueDate(e.target.value)}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#252945] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                />
              </div>

              {editingPayments.length === 0 && (
                <div>
                  <label className="mb-2 block text-sm text-[#e5e4e2]">
                    Data płatności (pełna){' '}
                    <span className="text-[#e5e4e2]/40">(opcjonalne)</span>
                  </label>
                  <input
                    type="date"
                    value={paymentDate}
                    onChange={(e) => setPaymentDate(e.target.value)}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#252945] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                  />
                  <div className="mt-1 text-xs text-[#e5e4e2]/40">
                    Wypełnij, jeśli faktura została opłacona w całości jedną wpłatą.
                  </div>
                </div>
              )}

              <div className="border-t border-[#d3bb73]/10 pt-4">
                <div className="mb-3 flex items-center justify-between">
                  <h4 className="text-sm font-medium text-[#e5e4e2]">Wpłaty częściowe</h4>
                  {(() => {
                    const paid = editingPayments.reduce(
                      (s, p) => s + Number(p.amount || 0),
                      0,
                    );
                    const gross = Number(editPaymentInvoice.gross_amount || 0);
                    const remaining = Math.max(gross - paid, 0);
                    return (
                      <div className="text-xs text-[#e5e4e2]/60">
                        Opłacono: <span className="text-[#d3bb73]">{paid.toFixed(2)} PLN</span> /{' '}
                        {gross.toFixed(2)} PLN · pozostało{' '}
                        <span className="text-yellow-400">{remaining.toFixed(2)} PLN</span>
                      </div>
                    );
                  })()}
                </div>

                {editingPayments.length > 0 ? (
                  <div className="mb-3 max-h-40 space-y-2 overflow-y-auto">
                    {editingPayments.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between rounded border border-[#d3bb73]/10 bg-[#252945] px-3 py-2 text-sm"
                      >
                        <div>
                          <div className="text-[#e5e4e2]">
                            {Number(p.amount).toFixed(2)} PLN
                          </div>
                          <div className="text-xs text-[#e5e4e2]/50">
                            {new Date(p.payment_date).toLocaleDateString('pl-PL')}
                            {p.notes ? ` · ${p.notes}` : ''}
                          </div>
                        </div>
                        {p.bank_match_id ? (
                          <span className="rounded bg-blue-500/15 px-2 py-1 text-xs text-blue-300">
                            Wyciąg bankowy
                          </span>
                        ) : (
                          <button
                            onClick={() => handleRemovePartialPayment(p)}
                            className="text-red-400 hover:text-red-300"
                            title="Usuń wpłatę"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mb-3 text-xs text-[#e5e4e2]/40">Brak zarejestrowanych wpłat.</div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="Kwota PLN"
                    value={newPaymentAmount}
                    onChange={(e) => setNewPaymentAmount(e.target.value)}
                    className="rounded-lg border border-[#d3bb73]/20 bg-[#252945] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                  />
                  <input
                    type="date"
                    value={newPaymentDate}
                    onChange={(e) => setNewPaymentDate(e.target.value)}
                    className="rounded-lg border border-[#d3bb73]/20 bg-[#252945] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                  />
                </div>
                <input
                  type="text"
                  placeholder="Notatka (opcjonalnie)"
                  value={newPaymentNotes}
                  onChange={(e) => setNewPaymentNotes(e.target.value)}
                  className="mt-2 w-full rounded-lg border border-[#d3bb73]/20 bg-[#252945] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                />
                <button
                  onClick={handleAddPartialPayment}
                  className="mt-2 w-full rounded-lg border border-[#d3bb73]/30 bg-[#d3bb73]/10 px-3 py-2 text-sm text-[#d3bb73] hover:bg-[#d3bb73]/20"
                >
                  Dodaj wpłatę
                </button>
              </div>

              <div className="rounded border border-[#d3bb73]/10 bg-[#252945] p-3 text-xs text-[#e5e4e2]/60">
                Status płatności aktualizuje się automatycznie: suma wpłat równa kwocie brutto oznacza
                fakturę jako opłaconą, częściowe wpłaty oznaczają ją jako częściowo opłaconą.
              </div>
            </div>

            <div className="flex justify-end gap-3 border-t border-[#d3bb73]/10 p-6">
              <button
                onClick={() => setEditPaymentInvoice(null)}
                className="rounded-lg border border-[#d3bb73]/20 px-4 py-2 text-sm text-[#e5e4e2] hover:bg-[#252945]"
              >
                Anuluj
              </button>

              <button
                onClick={handleSavePaymentEdit}
                className="rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
              >
                Zapisz
              </button>
            </div>
          </div>
        </div>
      )}

      <FullScreenLoader
        show={syncing}
        title="Synchronizacja KSeF"
        description="Proszę poczekać..."
      />

      {showSetup && (
        <KSeFSetupModal
          selectedCredentials={selectedCredentials || null}
          onClose={() => setShowSetup(false)}
          onSave={() => {
            setShowSetup(false);
            loadCredentials();
          }}
        />
      )}

      {selectedInvoice && (
        <InvoiceDetailsModal invoice={selectedInvoice} onClose={() => setSelectedInvoice(null)} />
      )}

      {showMatchModal && matchModalDate && matchInvoice && (
        <BankMatchingSimple
          month={matchModalDate.month}
          year={matchModalDate.year}
          invoiceData={matchInvoice}
          companyId={selectedCompanyId}
          onClose={() => {
            setShowMatchModal(false);
            setMatchModalDate(null);
            setMatchInvoice(null);
            loadInvoices();
          }}
        />
      )}
    </div>
  );
}

function KSeFSetupModal({
  selectedCredentials,
  onClose,
  onSave,
}: {
  selectedCredentials: KSeFCredentials | null;
  onClose: () => void;
  onSave: () => void;
}) {
  const [nip, setNip] = useState(selectedCredentials?.nip || '');
  const [token, setToken] = useState('');
  const [isTestEnv, setIsTestEnv] = useState(selectedCredentials?.is_test_environment ?? true);
  const [myCompanyId, setMyCompanyId] = useState(selectedCredentials?.my_company_id || '');
  const [loading, setLoading] = useState(false);
  const [myCompanies, setMyCompanies] = useState<any[]>([]);

  const { showSnackbar } = useSnackbar();

  useEffect(() => {
    loadMyCompanies();
  }, []);

  const loadMyCompanies = async () => {
    const { data } = await supabase
      .from('my_companies')
      .select('id, name, nip')
      .eq('is_active', true)
      .order('is_default', { ascending: false });

    setMyCompanies(data || []);
  };

  const handleSave = async () => {
    const normalizedToken = token.trim();
    const normalizedNip = nip.trim();

    if (!normalizedNip || !normalizedToken || !myCompanyId) {
      showSnackbar('Wszystkie pola są wymagane', 'error');
      return;
    }

    setLoading(true);

    try {
      const payload = {
        my_company_id: myCompanyId,
        nip: normalizedNip,
        token: normalizedToken,
        is_test_environment: isTestEnv,
        is_active: true,
      };

      if (selectedCredentials) {
        const { error } = await supabase
          .from('ksef_credentials')
          .update(payload)
          .eq('id', selectedCredentials.id);

        if (error) throw error;
      } else {
        const { error } = await supabase.from('ksef_credentials').insert(payload);

        if (error) throw error;
      }

      showSnackbar('Dane KSeF zapisane pomyślnie', 'success');
      onSave();
    } catch (error: any) {
      showSnackbar(error.message || 'Błąd zapisu', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33]">
        <div className="border-b border-[#d3bb73]/10 p-6">
          <h3 className="text-xl font-light text-[#e5e4e2]">Konfiguracja KSeF</h3>
        </div>

        <div className="space-y-4 p-6">
          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]">Moja firma</label>
            <select
              value={myCompanyId}
              onChange={(e) => setMyCompanyId(e.target.value)}
              className="w-full rounded border border-[#d3bb73]/20 bg-[#252945] px-3 py-2 text-[#e5e4e2]"
            >
              <option value="">Wybierz firmę</option>
              {myCompanies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name} ({company.nip})
                </option>
              ))}
            </select>

            {myCompanies.length === 0 && (
              <p className="mt-2 text-xs text-[#e5e4e2]/60">
                Najpierw dodaj firmę w{' '}
                <a href="/crm/settings/my-companies" className="text-[#d3bb73]">
                  Ustawieniach → Moje firmy
                </a>
              </p>
            )}
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]">NIP</label>
            <input
              type="text"
              value={nip}
              onChange={(e) => setNip(e.target.value)}
              placeholder="1234567890"
              className="w-full rounded border border-[#d3bb73]/20 bg-[#252945] px-3 py-2 text-[#e5e4e2]"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]">Token autoryzacyjny</label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Wprowadź token z KSeF"
              className="w-full rounded border border-[#d3bb73]/20 bg-[#252945] px-3 py-2 text-[#e5e4e2]"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="isTestEnv"
              checked={isTestEnv}
              onChange={(e) => setIsTestEnv(e.target.checked)}
              className="h-4 w-4 rounded border-[#d3bb73]/20 bg-[#252945]"
            />
            <label htmlFor="isTestEnv" className="text-sm text-[#e5e4e2]">
              Środowisko testowe
            </label>
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-[#d3bb73]/10 p-6">
          <button
            onClick={onClose}
            className="rounded-lg border border-[#d3bb73]/20 px-4 py-2 text-sm text-[#e5e4e2] hover:bg-[#252945]"
          >
            Anuluj
          </button>

          <button
            onClick={handleSave}
            disabled={loading}
            className="rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-50"
          >
            {loading ? 'Zapisywanie...' : 'Zapisz'}
          </button>
        </div>
      </div>
    </div>
  );
}
