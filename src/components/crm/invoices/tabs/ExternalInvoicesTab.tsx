'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Trash2,
  Eye,
  FileText,
  RefreshCw,
  Repeat,
  AlertTriangle,
  Ban,
  RotateCcw,
  Paperclip,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { useDialog } from '@/contexts/DialogContext';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { Modal } from '@/components/UI/Modal';

interface ExternalInvoice {
  id: string;
  seller_name: string;
  seller_nip: string | null;
  invoice_number: string;
  label: string | null;
  invoice_date: string;
  payment_method: string | null;
  amount_gross: number | null;
  currency: string;
  file_url: string | null;
  notes: string | null;
  created_at: string;
}

interface Subscription {
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
}

const PAYMENT_METHODS = ['Przelew', 'Karta', 'Gotówka', 'BLIK', 'Polecenie zapłaty', 'Inne'];

const BILLING_CYCLES: { value: string; label: string }[] = [
  { value: 'weekly', label: 'Tygodniowo' },
  { value: 'monthly', label: 'Miesięcznie' },
  { value: 'quarterly', label: 'Kwartalnie' },
  { value: 'yearly', label: 'Rocznie' },
];

const BUCKET = 'external-invoices';

const inputClass =
  'w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-3 py-2 text-sm text-[#e5e4e2] outline-none focus:border-[#d3bb73]/60';
const labelClass = 'mb-1 block text-xs font-medium text-[#e5e4e2]/70';

function formatMoney(amount: number | null, currency: string) {
  if (amount === null || amount === undefined) return '—';
  return new Intl.NumberFormat('pl-PL', {
    style: 'currency',
    currency: currency || 'PLN',
  }).format(amount);
}

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('pl-PL');
}

function cycleLabel(value: string) {
  return BILLING_CYCLES.find((c) => c.value === value)?.label ?? value;
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

  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [showSubModal, setShowSubModal] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [invRes, subRes] = await Promise.all([
      supabase
        .from('external_invoices')
        .select('*')
        .order('invoice_date', { ascending: false }),
      supabase.from('subscriptions').select('*').order('next_charge_date', { ascending: true }),
    ]);

    const tablesMissing =
      invRes.error?.code === 'PGRST205' || subRes.error?.code === 'PGRST205';

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
                subTab === 'invoices' ? setShowInvoiceModal(true) : setShowSubModal(true)
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
            Miejsce do przechowywania faktur spoza KSeF i subskrypcji nie zostało jeszcze
            utworzone w bazie danych. Zakładka i formularze są gotowe — dodawanie zostanie
            włączone automatycznie, gdy tylko baza zostanie skonfigurowana.
          </p>
        </div>
      ) : loading ? (
        <div className="py-16 text-center text-[#e5e4e2]/50">Ładowanie...</div>
      ) : subTab === 'invoices' ? (
        <InvoicesList
          invoices={invoices}
          canManage={canManage}
          onPreview={openFile}
          onDelete={deleteInvoice}
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

      {showInvoiceModal && (
        <InvoiceFormModal
          onClose={() => setShowInvoiceModal(false)}
          onSaved={() => {
            setShowInvoiceModal(false);
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

function InvoicesList({
  invoices,
  canManage,
  onPreview,
  onDelete,
}: {
  invoices: ExternalInvoice[];
  canManage: boolean;
  onPreview: (path: string | null) => void;
  onDelete: (inv: ExternalInvoice) => void;
}) {
  if (invoices.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[#d3bb73]/20 py-16 text-center text-[#e5e4e2]/50">
        Brak faktur spoza KSeF. Dodaj pierwszą fakturę papierową, zagraniczną lub paragon.
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {invoices.map((inv) => (
        <div
          key={inv.id}
          className="flex flex-col gap-3 rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-[#e5e4e2]">{inv.invoice_number}</span>
              {inv.label && (
                <span className="rounded-full bg-[#d3bb73]/15 px-2 py-0.5 text-xs text-[#d3bb73]">
                  {inv.label}
                </span>
              )}
            </div>
            <div className="mt-1 text-sm text-[#e5e4e2]/70">
              {inv.seller_name}
              {inv.seller_nip ? ` · NIP ${inv.seller_nip}` : ''}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#e5e4e2]/50">
              <span>Data: {formatDate(inv.invoice_date)}</span>
              {inv.payment_method && <span>Płatność: {inv.payment_method}</span>}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-right font-medium text-[#d3bb73]">
              {formatMoney(inv.amount_gross, inv.currency)}
            </span>
            {inv.file_url && (
              <button
                onClick={() => onPreview(inv.file_url)}
                title="Podgląd faktury"
                className="rounded-lg border border-[#d3bb73]/20 p-2 text-[#e5e4e2]/70 hover:text-[#d3bb73]"
              >
                <Eye className="h-4 w-4" />
              </button>
            )}
            {canManage && (
              <button
                onClick={() => onDelete(inv)}
                title="Usuń"
                className="rounded-lg border border-red-500/20 p-2 text-red-400 hover:bg-red-500/10"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function SubscriptionsList({
  subscriptions,
  today,
  canManage,
  onPreview,
  onDelete,
  onToggleStatus,
}: {
  subscriptions: Subscription[];
  today: string;
  canManage: boolean;
  onPreview: (path: string | null) => void;
  onDelete: (sub: Subscription) => void;
  onToggleStatus: (sub: Subscription) => void;
}) {
  if (subscriptions.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[#d3bb73]/20 py-16 text-center text-[#e5e4e2]/50">
        Brak subskrypcji. Dodaj cykliczne płatności, aby nie zapomnieć o comiesięcznych fakturach.
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {subscriptions.map((sub) => {
        const isCancelled = sub.status === 'cancelled';
        const isOverdue =
          !isCancelled && !!sub.next_charge_date && sub.next_charge_date < today;

        return (
          <div
            key={sub.id}
            className={`flex flex-col gap-3 rounded-xl border bg-[#1c1f33] p-4 sm:flex-row sm:items-center sm:justify-between ${
              isOverdue ? 'border-red-500/50' : 'border-[#d3bb73]/10'
            } ${isCancelled ? 'opacity-60' : ''}`}
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-[#e5e4e2]">{sub.name}</span>
                {isCancelled ? (
                  <span className="rounded-full bg-[#e5e4e2]/10 px-2 py-0.5 text-xs text-[#e5e4e2]/60">
                    Anulowana
                  </span>
                ) : isOverdue ? (
                  <span className="flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-xs text-red-400">
                    <AlertTriangle className="h-3 w-3" />
                    Termin minął
                  </span>
                ) : (
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-400">
                    Aktywna
                  </span>
                )}
              </div>
              {sub.seller_name && (
                <div className="mt-1 text-sm text-[#e5e4e2]/70">
                  {sub.seller_name}
                  {sub.seller_nip ? ` · NIP ${sub.seller_nip}` : ''}
                </div>
              )}
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#e5e4e2]/50">
                <span>Cykl: {cycleLabel(sub.billing_cycle)}</span>
                <span
                  className={isOverdue ? 'font-medium text-red-400' : undefined}
                >
                  Najbliższe obciążenie: {formatDate(sub.next_charge_date)}
                </span>
                {sub.payment_method && <span>Płatność: {sub.payment_method}</span>}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-right font-medium text-[#d3bb73]">
                {formatMoney(sub.amount, sub.currency)}
              </span>
              {sub.file_url && (
                <button
                  onClick={() => onPreview(sub.file_url)}
                  title="Załącznik"
                  className="rounded-lg border border-[#d3bb73]/20 p-2 text-[#e5e4e2]/70 hover:text-[#d3bb73]"
                >
                  <Paperclip className="h-4 w-4" />
                </button>
              )}
              {canManage && (
                <>
                  <button
                    onClick={() => onToggleStatus(sub)}
                    title={isCancelled ? 'Wznów' : 'Anuluj'}
                    className="rounded-lg border border-[#d3bb73]/20 p-2 text-[#e5e4e2]/70 hover:text-[#d3bb73]"
                  >
                    {isCancelled ? (
                      <RotateCcw className="h-4 w-4" />
                    ) : (
                      <Ban className="h-4 w-4" />
                    )}
                  </button>
                  <button
                    onClick={() => onDelete(sub)}
                    title="Usuń"
                    className="rounded-lg border border-red-500/20 p-2 text-red-400 hover:bg-red-500/10"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

async function uploadFile(file: File): Promise<string | null> {
  const ext = file.name.split('.').pop() || 'bin';
  const path = `${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
  });
  if (error) return null;
  return path;
}

function InvoiceFormModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const { showSnackbar } = useSnackbar();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    seller_name: '',
    seller_nip: '',
    invoice_number: '',
    label: '',
    invoice_date: new Date().toISOString().slice(0, 10),
    payment_method: 'Przelew',
    amount_gross: '',
    currency: 'PLN',
    notes: '',
  });
  const [file, setFile] = useState<File | null>(null);

  const submit = async () => {
    if (!form.seller_name.trim() || !form.invoice_number.trim() || !form.invoice_date) {
      showSnackbar('Uzupełnij sprzedającego, numer i datę faktury', 'error');
      return;
    }
    setSaving(true);

    let filePath: string | null = null;
    if (file) {
      filePath = await uploadFile(file);
      if (!filePath) {
        setSaving(false);
        showSnackbar('Nie udało się wgrać pliku', 'error');
        return;
      }
    }

    const { error } = await supabase.from('external_invoices').insert({
      seller_name: form.seller_name.trim(),
      seller_nip: form.seller_nip.trim() || null,
      invoice_number: form.invoice_number.trim(),
      label: form.label.trim() || null,
      invoice_date: form.invoice_date,
      payment_method: form.payment_method || null,
      amount_gross: form.amount_gross ? Number(form.amount_gross) : null,
      currency: form.currency || 'PLN',
      file_url: filePath,
      notes: form.notes.trim() || null,
    });

    setSaving(false);
    if (error) {
      if (filePath) await supabase.storage.from(BUCKET).remove([filePath]);
      showSnackbar('Nie udało się zapisać faktury', 'error');
      return;
    }
    showSnackbar('Faktura została dodana', 'success');
    onSaved();
  };

  return (
    <Modal open onClose={onClose} title="Dodaj fakturę spoza KSeF">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass}>Nazwa sprzedającego *</label>
          <input
            className={inputClass}
            value={form.seller_name}
            onChange={(e) => setForm({ ...form, seller_name: e.target.value })}
          />
        </div>
        <div>
          <label className={labelClass}>NIP sprzedającego</label>
          <input
            className={inputClass}
            value={form.seller_nip}
            onChange={(e) => setForm({ ...form, seller_nip: e.target.value })}
          />
        </div>
        <div>
          <label className={labelClass}>Numer faktury / paragonu *</label>
          <input
            className={inputClass}
            value={form.invoice_number}
            onChange={(e) => setForm({ ...form, invoice_number: e.target.value })}
          />
        </div>
        <div>
          <label className={labelClass}>Nazwa opisowa (np. faktura za paliwo)</label>
          <input
            className={inputClass}
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
          />
        </div>
        <div>
          <label className={labelClass}>Data faktury *</label>
          <input
            type="date"
            className={inputClass}
            value={form.invoice_date}
            onChange={(e) => setForm({ ...form, invoice_date: e.target.value })}
          />
        </div>
        <div>
          <label className={labelClass}>Sposób płatności</label>
          <select
            className={inputClass}
            value={form.payment_method}
            onChange={(e) => setForm({ ...form, payment_method: e.target.value })}
          >
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Kwota brutto</label>
          <input
            type="number"
            step="0.01"
            className={inputClass}
            value={form.amount_gross}
            onChange={(e) => setForm({ ...form, amount_gross: e.target.value })}
          />
        </div>
        <div>
          <label className={labelClass}>Waluta</label>
          <input
            className={inputClass}
            value={form.currency}
            onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass}>Podgląd faktury (zdjęcie lub PDF)</label>
          <input
            type="file"
            accept="image/jpeg,image/png,image/jpg,image/webp,application/pdf"
            className="w-full text-sm text-[#e5e4e2]/70 file:mr-3 file:rounded-lg file:border-0 file:bg-[#d3bb73]/20 file:px-3 file:py-2 file:text-sm file:text-[#d3bb73]"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass}>Uwagi</label>
          <textarea
            className={inputClass}
            rows={2}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </div>
      </div>

      <div className="mt-6 flex justify-end gap-3">
        <button
          onClick={onClose}
          className="rounded-lg border border-[#d3bb73]/20 px-4 py-2 text-sm text-[#e5e4e2]/70 hover:text-[#e5e4e2]"
        >
          Anuluj
        </button>
        <button
          onClick={submit}
          disabled={saving}
          className="rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#0a0d1a] hover:bg-[#d3bb73]/90 disabled:opacity-50"
        >
          {saving ? 'Zapisywanie...' : 'Zapisz fakturę'}
        </button>
      </div>
    </Modal>
  );
}

function SubscriptionFormModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const { showSnackbar } = useSnackbar();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '',
    seller_name: '',
    seller_nip: '',
    amount: '',
    currency: 'PLN',
    billing_cycle: 'monthly',
    next_charge_date: new Date().toISOString().slice(0, 10),
    payment_method: 'Karta',
    notes: '',
  });
  const [file, setFile] = useState<File | null>(null);

  const submit = async () => {
    if (!form.name.trim()) {
      showSnackbar('Podaj nazwę subskrypcji', 'error');
      return;
    }
    setSaving(true);

    let filePath: string | null = null;
    if (file) {
      filePath = await uploadFile(file);
      if (!filePath) {
        setSaving(false);
        showSnackbar('Nie udało się wgrać pliku', 'error');
        return;
      }
    }

    const { error } = await supabase.from('subscriptions').insert({
      name: form.name.trim(),
      seller_name: form.seller_name.trim() || null,
      seller_nip: form.seller_nip.trim() || null,
      amount: form.amount ? Number(form.amount) : null,
      currency: form.currency || 'PLN',
      billing_cycle: form.billing_cycle,
      next_charge_date: form.next_charge_date || null,
      payment_method: form.payment_method || null,
      status: 'active',
      file_url: filePath,
      notes: form.notes.trim() || null,
    });

    setSaving(false);
    if (error) {
      if (filePath) await supabase.storage.from(BUCKET).remove([filePath]);
      showSnackbar('Nie udało się zapisać subskrypcji', 'error');
      return;
    }
    showSnackbar('Subskrypcja została dodana', 'success');
    onSaved();
  };

  return (
    <Modal open onClose={onClose} title="Dodaj subskrypcję">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={labelClass}>Nazwa subskrypcji *</label>
          <input
            className={inputClass}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>
        <div>
          <label className={labelClass}>Dostawca</label>
          <input
            className={inputClass}
            value={form.seller_name}
            onChange={(e) => setForm({ ...form, seller_name: e.target.value })}
          />
        </div>
        <div>
          <label className={labelClass}>NIP dostawcy</label>
          <input
            className={inputClass}
            value={form.seller_nip}
            onChange={(e) => setForm({ ...form, seller_nip: e.target.value })}
          />
        </div>
        <div>
          <label className={labelClass}>Kwota</label>
          <input
            type="number"
            step="0.01"
            className={inputClass}
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
          />
        </div>
        <div>
          <label className={labelClass}>Waluta</label>
          <input
            className={inputClass}
            value={form.currency}
            onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })}
          />
        </div>
        <div>
          <label className={labelClass}>Cykl rozliczeniowy</label>
          <select
            className={inputClass}
            value={form.billing_cycle}
            onChange={(e) => setForm({ ...form, billing_cycle: e.target.value })}
          >
            {BILLING_CYCLES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Najbliższe obciążenie</label>
          <input
            type="date"
            className={inputClass}
            value={form.next_charge_date}
            onChange={(e) => setForm({ ...form, next_charge_date: e.target.value })}
          />
        </div>
        <div>
          <label className={labelClass}>Sposób płatności</label>
          <select
            className={inputClass}
            value={form.payment_method}
            onChange={(e) => setForm({ ...form, payment_method: e.target.value })}
          >
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass}>Załącznik (zdjęcie lub PDF)</label>
          <input
            type="file"
            accept="image/jpeg,image/png,image/jpg,image/webp,application/pdf"
            className="w-full text-sm text-[#e5e4e2]/70 file:mr-3 file:rounded-lg file:border-0 file:bg-[#d3bb73]/20 file:px-3 file:py-2 file:text-sm file:text-[#d3bb73]"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass}>Uwagi</label>
          <textarea
            className={inputClass}
            rows={2}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </div>
      </div>

      <div className="mt-6 flex justify-end gap-3">
        <button
          onClick={onClose}
          className="rounded-lg border border-[#d3bb73]/20 px-4 py-2 text-sm text-[#e5e4e2]/70 hover:text-[#e5e4e2]"
        >
          Anuluj
        </button>
        <button
          onClick={submit}
          disabled={saving}
          className="rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#0a0d1a] hover:bg-[#d3bb73]/90 disabled:opacity-50"
        >
          {saving ? 'Zapisywanie...' : 'Zapisz subskrypcję'}
        </button>
      </div>
    </Modal>
  );
}
