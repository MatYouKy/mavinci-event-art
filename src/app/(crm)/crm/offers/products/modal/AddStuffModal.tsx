import { useState } from 'react';

import { useSnackbar } from '@/contexts/SnackbarContext';
import { ProductStaffRow, StaffPaymentType } from '../../types';
import { X } from 'lucide-react';

export function AddStaffModal({
  productId,
  onClose,
  onSubmit,
}: {
  productId: string;
  onClose: () => void;
  onSubmit: (payload: ProductStaffRow) => Promise<void> | void;
}) {
  const [role, setRole] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [hourlyRate, setHourlyRate] = useState<string>('');
  const [estimatedHours, setEstimatedHours] = useState<string>('');
  const [isOptional, setIsOptional] = useState(false);
  const [notes, setNotes] = useState('');
  const [paymentType, setPaymentType] = useState<StaffPaymentType>('invoice_with_vat');
  const { showSnackbar } = useSnackbar();

  const submit = async () => {
    if (!role.trim()) {
      showSnackbar('Podaj nazwę roli', 'error');
      return;
    }

    await onSubmit({
      id: crypto.randomUUID() as string,
      product_id: productId,
      role: role.trim(),
      quantity,
      hourly_rate: hourlyRate ? Number(hourlyRate) : null,
      estimated_hours: estimatedHours ? Number(estimatedHours) : null,
      is_optional: isOptional,
      notes: notes.trim() ? notes.trim() : null,
      payment_type: paymentType,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-xl rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33]">
        <div className="flex items-center justify-between border-b border-[#d3bb73]/10 p-6">
          <h3 className="text-xl font-light text-[#e5e4e2]">Dodaj rolę</h3>
          <button onClick={onClose} className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-6">
          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Nazwa roli *</label>
            <input
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2]"
              placeholder="np. Operator dźwięku"
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Ilość</label>
              <input
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2]"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Stawka (zł/h)</label>
              <input
                type="number"
                step="0.01"
                value={hourlyRate}
                onChange={(e) => setHourlyRate(e.target.value)}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2]"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Godziny</label>
              <input
                type="number"
                step="0.5"
                value={estimatedHours}
                onChange={(e) => setEstimatedHours(e.target.value)}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2]"
              />
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Typ rozliczenia</label>
            <select
              value={paymentType}
              onChange={(e) => setPaymentType(e.target.value as StaffPaymentType)}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2]"
            >
              <option value="invoice_with_vat">Faktura VAT</option>
              <option value="invoice_no_vat">Faktura bez VAT</option>
              <option value="cash_no_receipt">Gotówka</option>
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Notatki</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2]"
              placeholder="np. 2 osoby na montaż + 1 osoba na show"
            />
          </div>

          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={isOptional}
              onChange={(e) => setIsOptional(e.target.checked)}
              className="h-4 w-4 rounded border-[#d3bb73]/20 bg-[#0a0d1a] text-[#d3bb73]"
            />
            <span className="text-sm text-[#e5e4e2]">Opcjonalny</span>
          </label>
        </div>

        <div className="flex justify-end gap-3 border-t border-[#d3bb73]/10 p-6">
          <button
            onClick={onClose}
            className="rounded-lg bg-white/5 px-5 py-2 text-[#e5e4e2] hover:bg-white/10"
          >
            Anuluj
          </button>
          <button
            onClick={submit}
            className="rounded-lg bg-[#d3bb73] px-5 py-2 font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
          >
            Dodaj
          </button>
        </div>
      </div>
    </div>
  );
}