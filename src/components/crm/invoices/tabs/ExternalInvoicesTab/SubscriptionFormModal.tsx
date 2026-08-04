import { useSnackbar } from '@/contexts/SnackbarContext';
import { useState } from 'react';
import { Modal } from '@/components/UI/Modal';
import { uploadFile } from './uploadFile';
import { supabase } from '@/lib/supabase/browser';
import { BILLING_CYCLES, BUCKET, inputClass, labelClass, PAYMENT_METHODS } from './ExternalInvoicesTab';

export function SubscriptionFormModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
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