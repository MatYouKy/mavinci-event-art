'use client';

import { useState } from 'react';
import { X, Shield, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';

interface AddInsuranceModalProps {
  vehicleId: string;
  vehicleName: string;
  onClose: () => void;
  onSuccess: () => void;
}

export default function AddInsuranceModal({
  vehicleId,
  vehicleName,
  onClose,
  onSuccess,
}: AddInsuranceModalProps) {
  const { showSnackbar } = useSnackbar();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    type: 'oc',
    insurance_company: '',
    policy_number: '',
    start_date: new Date().toISOString().split('T')[0],
    end_date: '',
    issue_date: '',
    premium_amount: '',
    payment_frequency: 'annual',
    deductible: '',
    sum_insured: '',
    status: 'active',
    auto_renewal: false,
    notes: '',
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;

    if (type === 'checkbox') {
      const checked = (e.target as HTMLInputElement).checked;
      setFormData((prev) => ({ ...prev, [name]: checked }));
    } else {
      setFormData((prev) => ({ ...prev, [name]: value }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.insurance_company || !formData.policy_number || !formData.start_date || !formData.end_date || !formData.premium_amount) {
      showSnackbar('Wypełnij wymagane pola', 'error');
      return;
    }

    setLoading(true);

    try {
      const data = {
        vehicle_id: vehicleId,
        type: formData.type,
        insurance_company: formData.insurance_company,
        policy_number: formData.policy_number,
        start_date: formData.start_date,
        end_date: formData.end_date,
        issue_date: formData.issue_date || null,
        premium_amount: parseFloat(formData.premium_amount.toString()),
        payment_frequency: formData.payment_frequency,
        deductible: formData.deductible ? parseFloat(formData.deductible.toString()) : null,
        sum_insured: formData.sum_insured ? parseFloat(formData.sum_insured.toString()) : null,
        status: formData.status,
        auto_renewal: formData.auto_renewal,
        notes: formData.notes || null,
      };

      const { error } = await supabase.from('insurance_policies').insert([data]);

      if (error) throw error;

      // Usuń stare alerty o ubezpieczeniu dla tego pojazdu i typu
      await supabase
        .from('vehicle_alerts')
        .delete()
        .eq('vehicle_id', vehicleId)
        .eq('alert_type', 'insurance');

      showSnackbar('Polisa ubezpieczeniowa została dodana', 'success');
      onSuccess();
      onClose();
    } catch (error: any) {
      console.error('Error adding insurance policy:', error);
      showSnackbar(error.message || 'Błąd podczas dodawania polisy', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/20 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-[#1c1f33] border-b border-[#d3bb73]/20 p-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Shield className="w-6 h-6 text-[#d3bb73]" />
            <div>
              <h2 className="text-xl font-bold text-[#e5e4e2]">Dodaj ubezpieczenie</h2>
              <p className="text-sm text-[#e5e4e2]/60">{vehicleName}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]">
            <X className="w-6 h-6" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Typ i status */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                Typ ubezpieczenia <span className="text-red-400">*</span>
              </label>
              <select
                name="type"
                value={formData.type}
                onChange={handleChange}
                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                required
              >
                <option value="oc">OC</option>
                <option value="ac">AC</option>
                <option value="nnw">NNW</option>
                <option value="assistance">Assistance</option>
                <option value="gap">GAP</option>
                <option value="other">Inne</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Status</label>
              <select
                name="status"
                value={formData.status}
                onChange={handleChange}
                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
              >
                <option value="active">Aktywne</option>
                <option value="expired">Wygasłe</option>
                <option value="cancelled">Anulowane</option>
              </select>
            </div>
          </div>

          {/* Ubezpieczyciel i polisa */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                Ubezpieczyciel <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                name="insurance_company"
                value={formData.insurance_company}
                onChange={handleChange}
                placeholder="np. PZU"
                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                Numer polisy <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                name="policy_number"
                value={formData.policy_number}
                onChange={handleChange}
                placeholder="np. OC/2024/123456"
                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                required
              />
            </div>
          </div>

          {/* Daty */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                Data początkowa <span className="text-red-400">*</span>
              </label>
              <input
                type="date"
                name="start_date"
                value={formData.start_date}
                onChange={handleChange}
                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                Data końcowa <span className="text-red-400">*</span>
              </label>
              <input
                type="date"
                name="end_date"
                value={formData.end_date}
                onChange={handleChange}
                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Data wystawienia</label>
              <input
                type="date"
                name="issue_date"
                value={formData.issue_date}
                onChange={handleChange}
                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
              />
            </div>
          </div>

          {/* Składka */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                Składka (zł) <span className="text-red-400">*</span>
              </label>
              <input
                type="number"
                name="premium_amount"
                value={formData.premium_amount}
                onChange={handleChange}
                step="0.01"
                placeholder="np. 1200"
                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Częstotliwość płatności</label>
              <select
                name="payment_frequency"
                value={formData.payment_frequency}
                onChange={handleChange}
                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
              >
                <option value="annual">Roczna</option>
                <option value="semi_annual">Półroczna</option>
                <option value="quarterly">Kwartalna</option>
                <option value="monthly">Miesięczna</option>
              </select>
            </div>
          </div>

          {/* Zakres ochrony */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Franszyza (zł)</label>
              <input
                type="number"
                name="deductible"
                value={formData.deductible}
                onChange={handleChange}
                step="0.01"
                placeholder="np. 300"
                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Suma ubezpieczenia (zł)</label>
              <input
                type="number"
                name="sum_insured"
                value={formData.sum_insured}
                onChange={handleChange}
                step="0.01"
                placeholder="np. 150000"
                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
              />
            </div>
          </div>

          {/* Auto-odnowienie */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              name="auto_renewal"
              id="auto_renewal"
              checked={formData.auto_renewal}
              onChange={handleChange}
              className="w-4 h-4 bg-[#0f1119] border border-[#d3bb73]/20 rounded"
            />
            <label htmlFor="auto_renewal" className="text-sm text-[#e5e4e2]">
              Automatyczne odnawianie
            </label>
          </div>

          {/* Notatki */}
          <div>
            <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Notatki</label>
            <textarea
              name="notes"
              value={formData.notes}
              onChange={handleChange}
              rows={3}
              placeholder="Dodatkowe informacje o zakresie ochrony..."
              className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
            />
          </div>

          {/* Przyciski */}
          <div className="flex gap-4 justify-end pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2 bg-[#0f1119] text-[#e5e4e2] rounded-lg hover:bg-[#0f1119]/80"
              disabled={loading}
            >
              Anuluj
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-6 py-2 rounded-lg hover:bg-[#d3bb73]/90 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Dodawanie...
                </>
              ) : (
                'Dodaj polisę'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
