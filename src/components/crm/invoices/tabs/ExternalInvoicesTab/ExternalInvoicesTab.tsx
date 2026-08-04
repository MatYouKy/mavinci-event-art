'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, FileText, RefreshCw, Repeat, AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { useDialog } from '@/contexts/DialogContext';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { InvoiceFormModal } from './InvoiceFormModal';
import { GroupedInvoices } from './GroupedInvoices';
import { SubscriptionsList } from './SubscriptionsList';
import { SubscriptionFormModal } from './SubscriptionFormModal';

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

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
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
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchData}
            className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/20 px-3 py-2 text-sm text-[#e5e4e2]/70 hover:text-[#e5e4e2]"
          >
            <RefreshCw className="h-4 w-4" />
            Odśwież
          </button>
          {canManage && !schemaMissing && (
            <button
              onClick={() =>
                subTab === 'invoices'
                  ? setInvoiceModal({
                      open: true,
                      prefill: null,
                      invoice: null,
                    })
                  : setShowSubModal(true)
              }
              className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#0a0d1a] hover:bg-[#d3bb73]/90"
            >
              <Plus className="h-4 w-4" />
              {subTab === 'invoices' ? 'Dodaj fakturę' : 'Dodaj subskrypcję'}
            </button>
          )}
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
          invoices={invoices}
          subscriptions={subscriptions}
          canManage={canManage}
          onPreview={openFile}
          onDelete={deleteInvoice}
          onEdit={editInvoice}
          onAddForPlaceholder={openPlaceholder}
        />
      ) : (
        <SubscriptionsList
          subscriptions={subscriptions}
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
