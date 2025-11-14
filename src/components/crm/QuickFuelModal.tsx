'use client';

import { useState } from 'react';
import { X, Fuel, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';

interface QuickFuelModalProps {
  vehicleId: string;
  vehicleName: string;
  currentMileage: number;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function QuickFuelModal({
  vehicleId,
  vehicleName,
  currentMileage,
  onClose,
  onSuccess,
}: QuickFuelModalProps) {
  const { showSnackbar } = useSnackbar();
  const { employee } = useCurrentEmployee();

  const now = new Date();
  const [formData, setFormData] = useState({
    date: now.toISOString().split('T')[0],
    time: now.toTimeString().slice(0, 5),
    liters: '',
    price_per_liter: '',
    mileage: currentMileage.toString(),
    payment_method: 'company_card',
    other_payment_method: '',
  });

  const [loading, setLoading] = useState(false);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [uploadingReceipt, setUploadingReceipt] = useState(false);

  const totalCost =
    formData.liters && formData.price_per_liter
      ? (parseFloat(formData.liters) * parseFloat(formData.price_per_liter)).toFixed(2)
      : '0.00';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.liters || !formData.price_per_liter || !formData.mileage) {
      showSnackbar('Wypełnij wszystkie wymagane pola', 'error');
      return;
    }

    if (formData.payment_method === 'other' && !formData.other_payment_method) {
      showSnackbar('Podaj metodę płatności', 'error');
      return;
    }

    setLoading(true);

    try {
      const dateTime = new Date(`${formData.date}T${formData.time}`);

      let receiptUrl = null;

      // Upload receipt if provided
      if (receiptFile) {
        setUploadingReceipt(true);
        const fileExt = receiptFile.name.split('.').pop();
        const fileName = `${vehicleId}_${Date.now()}.${fileExt}`;
        const filePath = `${vehicleId}/${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from('fuel-receipts')
          .upload(filePath, receiptFile);

        if (uploadError) throw uploadError;

        const {
          data: { publicUrl },
        } = supabase.storage.from('fuel-receipts').getPublicUrl(filePath);

        receiptUrl = publicUrl;
        setUploadingReceipt(false);
      }

      const { error } = await supabase.from('fuel_entries').insert({
        vehicle_id: vehicleId,
        date: dateTime.toISOString(),
        liters: parseFloat(formData.liters),
        price_per_liter: parseFloat(formData.price_per_liter),
        total_cost: parseFloat(totalCost),
        odometer_reading: parseInt(formData.mileage),
        payment_method:
          formData.payment_method === 'other'
            ? formData.other_payment_method
            : formData.payment_method,
        filled_by: employee?.id,
        receipt_url: receiptUrl,
        fuel_type: 'other',
      });

      if (error) throw error;

      const newMileage = parseInt(formData.mileage);
      if (newMileage > currentMileage) {
        await supabase.from('vehicles').update({ current_mileage: newMileage }).eq('id', vehicleId);
      }

      showSnackbar('Tankowanie zostało dodane', 'success');
      onSuccess?.();
      onClose();
    } catch (error: any) {
      console.error('Error adding fuel entry:', error);
      showSnackbar(error.message || 'Błąd podczas dodawania tankowania', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#d3bb73]/10 p-4">
          <div className="flex items-center gap-2">
            <Fuel className="h-5 w-5 text-[#d3bb73]" />
            <h2 className="text-lg font-semibold text-[#e5e4e2]">Szybkie tankowanie</h2>
          </div>
          <button
            onClick={onClose}
            className="text-[#e5e4e2]/60 transition-colors hover:text-[#e5e4e2]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-4">
          <div className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-3">
            <p className="text-sm text-[#e5e4e2]/60">Pojazd</p>
            <p className="font-medium text-[#e5e4e2]">{vehicleName}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm text-[#e5e4e2]/80">Data</label>
              <input
                type="date"
                value={formData.date}
                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-[#e5e4e2]"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-[#e5e4e2]/80">Godzina</label>
              <input
                type="time"
                value={formData.time}
                onChange={(e) => setFormData({ ...formData, time: e.target.value })}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-[#e5e4e2]"
                required
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm text-[#e5e4e2]/80">
              Ilość (litry) <span className="text-red-400">*</span>
            </label>
            <input
              type="number"
              step="0.01"
              value={formData.liters}
              onChange={(e) => setFormData({ ...formData, liters: e.target.value })}
              placeholder="np. 45.50"
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-[#e5e4e2]"
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-sm text-[#e5e4e2]/80">
              Cena za litr (zł) <span className="text-red-400">*</span>
            </label>
            <input
              type="number"
              step="0.01"
              value={formData.price_per_liter}
              onChange={(e) => setFormData({ ...formData, price_per_liter: e.target.value })}
              placeholder="np. 6.59"
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-[#e5e4e2]"
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-sm text-[#e5e4e2]/80">
              Przebieg (km) <span className="text-red-400">*</span>
            </label>
            <input
              type="number"
              value={formData.mileage}
              onChange={(e) => setFormData({ ...formData, mileage: e.target.value })}
              placeholder="np. 125000"
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-[#e5e4e2]"
              required
            />
            {parseInt(formData.mileage) < currentMileage && (
              <p className="mt-1 text-xs text-orange-400">
                Uwaga: Przebieg niższy niż obecny ({currentMileage} km)
              </p>
            )}
          </div>

          <div className="rounded-lg border border-[#d3bb73]/20 bg-[#d3bb73]/10 p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-[#e5e4e2]/60">Koszt całkowity:</span>
              <span className="text-xl font-bold text-[#d3bb73]">{totalCost} zł</span>
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/80">Metoda płatności</label>
            <div className="space-y-2">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="payment_method"
                  value="company_card"
                  checked={formData.payment_method === 'company_card'}
                  onChange={(e) => setFormData({ ...formData, payment_method: e.target.value })}
                  className="text-[#d3bb73]"
                />
                <span className="text-[#e5e4e2]">Karta firmowa</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="payment_method"
                  value="other"
                  checked={formData.payment_method === 'other'}
                  onChange={(e) => setFormData({ ...formData, payment_method: e.target.value })}
                  className="text-[#d3bb73]"
                />
                <span className="text-[#e5e4e2]">Inna metoda płatności</span>
              </label>
              {formData.payment_method === 'other' && (
                <input
                  type="text"
                  value={formData.other_payment_method}
                  onChange={(e) =>
                    setFormData({ ...formData, other_payment_method: e.target.value })
                  }
                  placeholder="Podaj metodę płatności (np. gotówka, prywatna karta)"
                  className="ml-6 w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-[#e5e4e2]"
                  required
                />
              )}
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/80">
              Paragon/Faktura (opcjonalnie)
            </label>
            <input
              type="file"
              accept="image/*,application/pdf"
              onChange={(e) => setReceiptFile(e.target.files?.[0] || null)}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-[#e5e4e2] file:mr-4 file:rounded file:border-0 file:bg-[#d3bb73] file:px-3 file:py-1 file:text-sm file:text-[#1c1f33] hover:file:bg-[#d3bb73]/90"
            />
            {receiptFile && (
              <p className="mt-1 text-xs text-[#d3bb73]">
                Wybrano: {receiptFile.name} ({(receiptFile.size / 1024 / 1024).toFixed(2)} MB)
              </p>
            )}
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg bg-[#0f1119] px-4 py-2 text-[#e5e4e2] transition-colors hover:bg-[#0f1119]/80"
            >
              Anuluj
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {uploadingReceipt ? 'Przesyłanie paragonu...' : 'Dodawanie...'}
                </>
              ) : (
                'Dodaj tankowanie'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
