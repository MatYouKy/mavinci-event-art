'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plus,
  FileText,
  RefreshCw,
  Repeat,
  AlertTriangle,
  Search,
  X,
  Table2,
  LayoutGrid,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { useDialog } from '@/contexts/DialogContext';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { InvoiceFormModal } from './InvoiceFormModal';
import { EXTERNAL_INVOICE_COLUMNS, GroupedInvoices } from './GroupedInvoices';
import { SubscriptionsList } from './SubscriptionsList';
import { SubscriptionFormModal } from './SubscriptionFormModal';
import ResponsiveActionBar from '../../../ResponsiveActionBar';
import {
  TablePreferencesControl,
  useStoredTablePreferences,
} from '../../TablePreferencesControl';

export interface ExternalInvoice {
  id: string;
  seller_name: string;
  seller_nip: string | null;
  invoice_number: string;
  label: string | null;
  invoice_date: string;
  payment_method: string | null;

  amount_net: number | null;
  amount_gross: number | null;

  currency: string;
  file_url: string | null;
  notes: string | null;
  subscription_id: string | null;
  period_year: number | null;
  period_month: number | null;
  created_at: string;
}

export interface Subscription {
  id: string;
  name: string;
  seller_name: string | null;
  seller_nip: string | null;
  amount: number | null;
  currency: string;
  billing_cycle: string;
  next_charge_date: string | null;
  payment_method: string | null;
  status: string;
  cancelled_at: string | null;
  file_url: string | null;
  notes: string | null;
  created_at: string;
}

export interface InvoicePrefill {
  seller_name?: string;
  seller_nip?: string;
  label?: string;
  amount_gross?: string;
  currency?: string;
  payment_method?: string;
  invoice_date?: string;
  notes?: string;
  subscription_id?: string;
  period_year?: number;
  period_month?: number;
}

export type InvoiceRow =
  | { kind: 'real'; invoice: ExternalInvoice }
  | { kind: 'placeholder'; subscription: Subscription; year: number; month: number };

export const PAYMENT_METHODS = ['Przelew', 'Karta', 'Gotówka', 'BLIK', 'Polecenie zapłaty', 'Inne'];

export const BILLING_CYCLES: { value: string; label: string }[] = [
  { value: 'weekly', label: 'Tygodniowo' },
  { value: 'monthly', label: 'Miesięcznie' },
  { value: 'quarterly', label: 'Kwartalnie' },
  { value: 'yearly', label: 'Rocznie' },
];

export const MONTH_NAMES = [
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

export const BUCKET = 'external-invoices';

export const inputClass =
  'w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-3 py-2 text-sm text-[#e5e4e2] outline-none focus:border-[#d3bb73]/60';
export const labelClass = 'mb-1 block text-xs font-medium text-[#e5e4e2]/70';

export function formatMoney(amount: number | null, currency: string) {
  if (amount === null || amount === undefined) return '—';
  return new Intl.NumberFormat('pl-PL', {
    style: 'currency',
    currency: currency || 'PLN',
  }).format(amount);
}

export function formatDate(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('pl-PL');
}

export function cycleLabel(value: string) {
  return BILLING_CYCLES.find((c) => c.value === value)?.label ?? value;
}

export function cycleStepMonths(cycle: string) {
  if (cycle === 'quarterly') return 3;
  if (cycle === 'yearly') return 12;
  return 1;
}

export function lastDayOfMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

export function ExternalInvoicesTab() {
  const { canManageModule } = useCurrentEmployee();
  const { showConfirm } = useDialog();
  const { showSnackbar } = useSnackbar();

  const canManage = useMemo(() => canManageModule('invoices'), [canManageModule]);

  const [subTab, setSubTab] = useState<'invoices' | 'subscriptions'>('invoices');
  const [invoices, setInvoices] = useState<ExternalInvoice[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [schemaMissing, setSchemaMissing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'table' | 'list'>('table');
  const tablePreferences = useStoredTablePreferences(
    'crm.external-invoices.table-preferences.v1',
    EXTERNAL_INVOICE_COLUMNS,
  );

  const [invoiceModal, setInvoiceModal] = useState<{
    open: boolean;
    prefill: InvoicePrefill | null;
    invoice: ExternalInvoice | null;
  }>({
    open: false,
    prefill: null,
    invoice: null,
  });

  const [showSubModal, setShowSubModal] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [invRes, subRes] = await Promise.all([
      supabase.from('external_invoices').select('*').order('invoice_date', { ascending: false }),
      supabase.from('subscriptions').select('*').order('next_charge_date', { ascending: true }),
    ]);

    const tablesMissing = invRes.error?.code === 'PGRST205' || subRes.error?.code === 'PGRST205';

    if (tablesMissing) {
      setSchemaMissing(true);
      setInvoices([]);
      setSubscriptions([]);
      setLoading(false);
      return;
    }

    setSchemaMissing(false);

    if (invRes.error) {
      showSnackbar('Nie udało się pobrać faktur spoza KSeF', 'error');
    } else {
      setInvoices(invRes.data || []);
    }

    if (subRes.error) {
      showSnackbar('Nie udało się pobrać subskrypcji', 'error');
    } else {
      setSubscriptions(subRes.data || []);
    }

    setLoading(false);
  }, [showSnackbar]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const openFile = useCallback(
    async (path: string | null) => {
      if (!path) return;
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
      if (error || !data?.signedUrl) {
        showSnackbar('Nie udało się otworzyć podglądu', 'error');
        return;
      }
      window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
    },
    [showSnackbar],
  );

  const editInvoice = useCallback((invoice: ExternalInvoice) => {
    setInvoiceModal({
      open: true,
      prefill: null,
      invoice,
    });
  }, []);

  const deleteInvoice = useCallback(
    async (inv: ExternalInvoice) => {
      const ok = await showConfirm({
        title: 'Usuń fakturę',
        message: `Czy na pewno usunąć fakturę ${inv.invoice_number}?`,
        confirmText: 'Usuń',
      });
      if (!ok) return;

      if (inv.file_url) {
        await supabase.storage.from(BUCKET).remove([inv.file_url]);
      }
      const { error } = await supabase.from('external_invoices').delete().eq('id', inv.id);
      if (error) {
        showSnackbar('Nie udało się usunąć faktury', 'error');
        return;
      }
      showSnackbar('Faktura została usunięta', 'success');
      fetchData();
    },
    [showConfirm, showSnackbar, fetchData],
  );

  const deleteSubscription = useCallback(
    async (sub: Subscription) => {
      const ok = await showConfirm({
        title: 'Usuń subskrypcję',
        message: `Czy na pewno usunąć subskrypcję "${sub.name}"?`,
        confirmText: 'Usuń',
      });
      if (!ok) return;

      if (sub.file_url) {
        await supabase.storage.from(BUCKET).remove([sub.file_url]);
      }
      const { error } = await supabase.from('subscriptions').delete().eq('id', sub.id);
      if (error) {
        showSnackbar('Nie udało się usunąć subskrypcji', 'error');
        return;
      }
      showSnackbar('Subskrypcja została usunięta', 'success');
      fetchData();
    },
    [showConfirm, showSnackbar, fetchData],
  );

  const toggleSubscriptionStatus = useCallback(
    async (sub: Subscription) => {
      const cancelling = sub.status === 'active';
      const { error } = await supabase
        .from('subscriptions')
        .update({
          status: cancelling ? 'cancelled' : 'active',
          cancelled_at: cancelling ? new Date().toISOString().slice(0, 10) : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', sub.id);
      if (error) {
        showSnackbar('Nie udało się zmienić statusu', 'error');
        return;
      }
      showSnackbar(
        cancelling ? 'Subskrypcja została anulowana' : 'Subskrypcja została wznowiona',
        'success',
      );
      fetchData();
    },
    [showSnackbar, fetchData],
  );

  const openPlaceholder = useCallback((sub: Subscription, year: number, month: number) => {
    const day = lastDayOfMonth(year, month);
    setInvoiceModal({
      open: true,
      prefill: {
        seller_name: sub.seller_name || sub.name,
        seller_nip: sub.seller_nip || '',
        label: sub.name,
        amount_gross: sub.amount != null ? String(sub.amount) : '',
        currency: sub.currency || 'PLN',
        payment_method: sub.payment_method || 'Karta',
        invoice_date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        notes: sub.notes || '',
        subscription_id: sub.id,
        period_year: year,
        period_month: month,
      },
      invoice: null,
    });
  }, []);

  const today = new Date().toISOString().slice(0, 10);

  const normalizedSearch = searchQuery
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pl-PL');

  const matchesSearch = useCallback(
    (values: Array<string | number | null | undefined>) => {
      if (!normalizedSearch) return true;
      return values
        .filter((value) => value !== null && value !== undefined)
        .map((value) =>
          String(value)
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLocaleLowerCase('pl-PL'),
        )
        .some((value) => value.includes(normalizedSearch));
    },
    [normalizedSearch],
  );

  const filteredInvoices = useMemo(
    () =>
      invoices.filter((invoice) =>
        matchesSearch([
          invoice.invoice_number,
          invoice.label,
          invoice.seller_name,
          invoice.seller_nip,
          invoice.notes,
          invoice.payment_method,
          invoice.currency,
          invoice.amount_net,
          invoice.amount_gross,
        ]),
      ),
    [invoices, matchesSearch],
  );

  const filteredSubscriptions = useMemo(
    () =>
      subscriptions.filter((subscription) =>
        matchesSearch([
          subscription.name,
          subscription.seller_name,
          subscription.seller_nip,
          subscription.notes,
          subscription.payment_method,
          subscription.currency,
        ]),
      ),
    [matchesSearch, subscriptions],
  );

  const actionItems = [
    {
      label: 'Odśwież',
      onClick: fetchData,
      icon: <RefreshCw className="h-4 w-4" />,
    },
    ...(canManage && !schemaMissing
      ? [
          {
            label: subTab === 'invoices' ? 'Dodaj fakturę' : 'Dodaj subskrypcję',
            onClick: () =>
              subTab === 'invoices'
                ? setInvoiceModal({ open: true, prefill: null, invoice: null })
                : setShowSubModal(true),
            icon: <Plus className="h-4 w-4" />,
            variant: 'primary' as const,
          },
        ]
      : []),
  ];

  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex w-full shrink-0 items-center gap-2 lg:w-auto">
          <button
            onClick={() => setSubTab('invoices')}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              subTab === 'invoices'
                ? 'bg-[#d3bb73] text-[#0a0d1a]'
                : 'bg-[#1c1f33] text-[#e5e4e2]/70 hover:text-[#e5e4e2]'
            }`}
          >
            <FileText className="h-4 w-4" />
            Faktury
          </button>
          <button
            onClick={() => setSubTab('subscriptions')}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              subTab === 'subscriptions'
                ? 'bg-[#d3bb73] text-[#0a0d1a]'
                : 'bg-[#1c1f33] text-[#e5e4e2]/70 hover:text-[#e5e4e2]'
            }`}
          >
            <Repeat className="h-4 w-4" />
            Subskrypcje
          </button>

          <div className="ml-auto shrink-0 lg:hidden">
            <ResponsiveActionBar
              disabledBackground
              mobileBreakpoint={10000}
              actions={actionItems}
            />
          </div>
        </div>

        <div className="ml-auto flex w-full min-w-0 flex-wrap items-center justify-end gap-2 lg:w-auto lg:flex-nowrap">
          <div className="flex h-9 min-w-[190px] flex-1 items-center gap-2 rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-3 lg:w-64 lg:flex-none">
            <Search className="h-4 w-4 shrink-0 text-[#e5e4e2]/40" />
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={subTab === 'invoices' ? 'Numer, nazwa, NIP, sprzedawca…' : 'Nazwa, NIP, sprzedawca…'}
              className="min-w-0 flex-1 bg-transparent text-xs text-[#e5e4e2] outline-none placeholder:text-[#e5e4e2]/35"
              aria-label="Szukaj faktury spoza KSeF"
            />
            {searchQuery && (
              <button type="button" onClick={() => setSearchQuery('')} aria-label="Wyczyść wyszukiwanie">
                <X className="h-4 w-4 text-[#e5e4e2]/40" />
              </button>
            )}
          </div>

          {subTab === 'invoices' && viewMode === 'table' && (
            <TablePreferencesControl
              columns={EXTERNAL_INVOICE_COLUMNS}
              density={tablePreferences.density}
              visibleColumns={tablePreferences.visibleColumns}
              onToggleColumn={tablePreferences.toggleColumn}
              onDensityChange={tablePreferences.setDensity}
              onReset={tablePreferences.reset}
            />
          )}

          {subTab === 'invoices' && (
            <div className="flex h-9 shrink-0 overflow-hidden rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33]">
              <button
                type="button"
                onClick={() => setViewMode('table')}
                className={`px-2.5 transition-colors ${viewMode === 'table' ? 'bg-[#d3bb73]/20 text-[#d3bb73]' : 'text-[#e5e4e2]/45 hover:text-[#e5e4e2]'}`}
                title="Widok tabeli"
              >
                <Table2 className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode('list')}
                className={`border-l border-[#d3bb73]/20 px-2.5 transition-colors ${viewMode === 'list' ? 'bg-[#d3bb73]/20 text-[#d3bb73]' : 'text-[#e5e4e2]/45 hover:text-[#e5e4e2]'}`}
                title="Widok listy"
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
            </div>
          )}

          <div className="hidden shrink-0 lg:block">
            <ResponsiveActionBar
              disabledBackground
              mobileBreakpoint={900}
              actions={actionItems}
            />
          </div>
        </div>
      </div>

      {schemaMissing ? (
        <div className="rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] px-6 py-12 text-center">
          <AlertTriangle className="mx-auto mb-4 h-10 w-10 text-[#d3bb73]" />
          <h3 className="mb-2 text-lg font-semibold text-[#e5e4e2]">
            Ta sekcja nie jest jeszcze gotowa do zapisu danych
          </h3>
          <p className="mx-auto max-w-xl text-sm leading-relaxed text-[#e5e4e2]/60">
            Miejsce do przechowywania faktur spoza KSeF i subskrypcji nie zostało jeszcze utworzone
            w bazie danych. Zakładka i formularze są gotowe — dodawanie zostanie włączone
            automatycznie, gdy tylko baza zostanie skonfigurowana.
          </p>
        </div>
      ) : loading ? (
        <div className="py-16 text-center text-[#e5e4e2]/50">Ładowanie...</div>
      ) : subTab === 'invoices' ? (
        <GroupedInvoices
          invoices={filteredInvoices}
          subscriptions={filteredSubscriptions}
          canManage={canManage}
          onPreview={openFile}
          onDelete={deleteInvoice}
          onEdit={editInvoice}
          onAddForPlaceholder={openPlaceholder}
          viewMode={viewMode}
          density={tablePreferences.density}
          isColumnVisible={tablePreferences.isColumnVisible}
          hasSearchQuery={Boolean(searchQuery.trim())}
        />
      ) : (
        <SubscriptionsList
          subscriptions={filteredSubscriptions}
          today={today}
          canManage={canManage}
          onPreview={openFile}
          onDelete={deleteSubscription}
          onToggleStatus={toggleSubscriptionStatus}
        />
      )}

      {invoiceModal.open && (
        <InvoiceFormModal
          invoice={invoiceModal.invoice ?? null}
          prefill={invoiceModal.prefill}
          onClose={() =>
            setInvoiceModal({
              open: false,
              prefill: null,
              invoice: null,
            })
          }
          onSaved={() => {
            setInvoiceModal({
              open: false,
              prefill: null,
              invoice: null,
            });
            fetchData();
          }}
        />
      )}

      {showSubModal && (
        <SubscriptionFormModal
          onClose={() => setShowSubModal(false)}
          onSaved={() => {
            setShowSubModal(false);
            fetchData();
          }}
        />
      )}
    </div>
  );
}
