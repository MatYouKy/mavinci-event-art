import { useSnackbar } from '@/contexts/SnackbarContext';
import { supabase } from '@/lib/supabase/browser';
import { useEffect, useState } from 'react';
import {
  BUCKET,
  ExternalInvoice,
  InvoicePrefill,
  labelClass,
  inputClass,
  PAYMENT_METHODS,
  MONTH_NAMES,
} from './ExternalInvoicesTab';
import { uploadFile } from './uploadFile';
import { Modal } from '@/components/UI/Modal';
import { FileDropzone } from '@/components/UI/FileDropzone/FileDropzone';

export function InvoiceFormModal({
  invoice,
  prefill,
  onClose,
  onSaved,
}: {
  invoice: ExternalInvoice | null;
  prefill: InvoicePrefill | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { showSnackbar } = useSnackbar();
  const [saving, setSaving] = useState(false);
  const [removeExistingFile, setRemoveExistingFile] = useState(false);
  const [existingFileUrl, setExistingFileUrl] = useState<string | null>(null);

  const [form, setForm] = useState({
    seller_name: invoice?.seller_name ?? prefill?.seller_name ?? '',
    seller_nip: invoice?.seller_nip ?? '',
    invoice_number: invoice?.invoice_number ?? '',
    label: invoice?.label ?? '',
    invoice_date:
      invoice?.invoice_date ?? prefill?.invoice_date ?? new Date().toISOString().slice(0, 10),

    payment_method: invoice?.payment_method ?? prefill?.payment_method ?? 'Przelew',

    amount_net: invoice?.amount_net ? String(invoice.amount_net) : '',

    amount_gross: invoice?.amount_gross ? String(invoice.amount_gross) : '',

    currency: invoice?.currency ?? prefill?.currency ?? 'PLN',

    notes: invoice?.notes ?? '',
  });
  const [file, setFile] = useState<File | null>(null);
  

  const isSubscriptionInvoice = !!prefill?.subscription_id;

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

    const payload = {
      seller_name: form.seller_name.trim(),
      seller_nip: form.seller_nip.trim() || null,
      invoice_number: form.invoice_number.trim(),
      label: form.label.trim() || null,
      invoice_date: form.invoice_date,
      payment_method: form.payment_method || null,
      amount_net: form.amount_net ? Number(form.amount_net) : null,
      amount_gross: form.amount_gross ? Number(form.amount_gross) : null,
      currency: form.currency,
      file_url:
      removeExistingFile
        ? null
        : filePath ?? invoice?.file_url ?? null,
      notes: form.notes.trim() || null,
    };

    let result;

    if (invoice) {
      result = await supabase.from('external_invoices').update(payload).eq('id', invoice.id);
    } else {
      result = await supabase.from('external_invoices').insert(payload);
    }

    const { error } = result;

    setSaving(false);
    if (error) {
      if (filePath) await supabase.storage.from(BUCKET).remove([filePath]);
      showSnackbar('Nie udało się zapisać faktury', 'error');
      return;
    }
    showSnackbar(
      invoice ? 'Faktura została zaktualizowana' : 'Faktura została dodana',
      'success'
    );
    onSaved();
  };

  useEffect(() => {
    const loadFile = async () => {
      if (!invoice?.file_url) return;
  
      const { data } = await supabase.storage
        .from('external-invoices')
        .createSignedUrl(invoice.file_url, 3600);
  
      if (data?.signedUrl) {
        setExistingFileUrl(data.signedUrl);
      }
    };
  
    loadFile();
  }, [invoice]);

  return (
    <Modal
      open
      onClose={onClose}
      title={isSubscriptionInvoice ? 'Dodaj fakturę do subskrypcji' : 'Dodaj fakturę spoza KSeF'}
    >
      {isSubscriptionInvoice && prefill?.period_year && prefill?.period_month && (
        <div className="mb-4 rounded-lg border border-[#d3bb73]/20 bg-[#d3bb73]/5 px-3 py-2 text-xs text-[#e5e4e2]/70">
          Faktura zostanie przypisana do subskrypcji za okres{' '}
          <span className="font-medium text-[#d3bb73]">
            {MONTH_NAMES[prefill.period_month - 1]} {prefill.period_year}
          </span>
          .
        </div>
      )}
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
          <label className={labelClass}>Kwota netto</label>
          <input
            type="number"
            step="0.01"
            className={inputClass}
            value={form.amount_net}
            onChange={(e) =>
              setForm({
                ...form,
                amount_net: e.target.value,
              })
            }
          />
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
          <select
            className={inputClass}
            value={form.currency}
            onChange={(e) => setForm({ ...form, currency: e.target.value })}
          >
            <option value="PLN">PLN - złoty</option>
            <option value="EUR">EUR - euro</option>
            <option value="USD">USD - dolar</option>
            <option value="GBP">GBP - funt</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass}>Podgląd faktury (zdjęcie lub PDF)</label>
          <FileDropzone
            file={file}
            existingFile={{
              url: invoice?.file_url,
              name: invoice?.invoice_number,
            }}
            onRemoveExisting={() => setRemoveExistingFile(true)}
            onChange={setFile}
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
