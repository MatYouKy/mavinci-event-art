'use client';

import { useState } from 'react';
import { X, Fuel, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';

interface AddFuelEntryModalProps {
  vehicleId: string;
  vehicleName: string;
  currentMileage: number;
  onClose: () => void;
  onSuccess: () => void;
}

export default function AddFuelEntryModal({
  vehicleId,
  vehicleName,
  currentMileage,
  onClose,
  onSuccess,
}: AddFuelEntryModalProps) {
  const { showSnackbar } = useSnackbar();
  const { employee } = useCurrentEmployee();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    time: new Date().toTimeString().slice(0, 5),
    location: '',
    odometer_reading: currentMileage,
    fuel_type: 'diesel',
    liters: '',
    price_per_liter: '',
    payment_method: '',
    receipt_number: '',
    is_full_tank: true,
    notes: '',
  });

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ) => {
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

    if (
      !formData.date ||
      !formData.odometer_reading ||
      !formData.liters ||
      !formData.price_per_liter
    ) {
      showSnackbar('Wypełnij wymagane pola', 'error');
      return;
    }

    setLoading(true);

    try {
      const liters = parseFloat(formData.liters.toString());
      const pricePerLiter = parseFloat(formData.price_per_liter.toString());
      const totalCost = liters * pricePerLiter;

      const data = {
        vehicle_id: vehicleId,
        date: formData.date,
        time: formData.time || null,
        location: formData.location || null,
        odometer_reading: parseInt(formData.odometer_reading.toString()),
        fuel_type: formData.fuel_type,
        liters: liters,
        price_per_liter: pricePerLiter,
        total_cost: totalCost,
        payment_method: formData.payment_method || null,
        receipt_number: formData.receipt_number || null,
        is_full_tank: formData.is_full_tank,
        filled_by: employee?.id || null,
        notes: formData.notes || null,
      };

      const { error } = await supabase.from('fuel_entries').insert([data]);

      if (error) throw error;

      showSnackbar('Tankowanie zostało dodane', 'success');
      onSuccess();
      onClose();
    } catch (error: any) {
      console.error('Error adding fuel entry:', error);
      showSnackbar(error.message || 'Błąd podczas dodawania tankowania', 'error');
    } finally {
      setLoading(false);
    }
  };

  const calculateTotal = () => {
    if (formData.liters && formData.price_per_liter) {
      const liters = parseFloat(formData.liters.toString());
      const price = parseFloat(formData.price_per_liter.toString());
      return (liters * price).toFixed(2);
    }
    return '0.00';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33]">
        <div className="sticky top-0 flex items-center justify-between border-b border-[#d3bb73]/20 bg-[#1c1f33] p-6">
          <div className="flex items-center gap-3">
            <Fuel className="h-6 w-6 text-[#d3bb73]" />
            <div>
              <h2 className="text-xl font-bold text-[#e5e4e2]">Dodaj tankowanie</h2>
              <p className="text-sm text-[#e5e4e2]/60">{vehicleName}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]">
            <X className="h-6 w-6" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6 p-6">
          {/* Data i godzina */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                Data <span className="text-red-400">*</span>
              </label>
              <input
                type="date"
                name="date"
                value={formData.date}
                onChange={handleChange}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
                required
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Godzina</label>
              <input
                type="time"
                name="time"
                value={formData.time}
                onChange={handleChange}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
              />
            </div>
          </div>

          {/* Stacja i przebieg */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Stacja paliw</label>
              <input
                type="text"
                name="location"
                value={formData.location}
                onChange={handleChange}
                placeholder="np. Orlen - Kraków Balice"
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                Przebieg (km) <span className="text-red-400">*</span>
              </label>
              <input
                type="number"
                name="odometer_reading"
                value={formData.odometer_reading}
                onChange={handleChange}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
                required
              />
            </div>
          </div>

          {/* Typ paliwa */}
          <div>
            <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
              Typ paliwa <span className="text-red-400">*</span>
            </label>
            <select
              name="fuel_type"
              value={formData.fuel_type}
              onChange={handleChange}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
              required
            >
              <option value="benzyna95">Benzyna 95</option>
              <option value="benzyna98">Benzyna 98</option>
              <option value="diesel">Diesel</option>
              <option value="LPG">LPG</option>
              <option value="elektryczny">Elektryczny</option>
              <option value="other">Inne</option>
            </select>
          </div>

          {/* Ilość i cena */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                Litry <span className="text-red-400">*</span>
              </label>
              <input
                type="number"
                name="liters"
                value={formData.liters}
                onChange={handleChange}
                step="0.01"
                placeholder="np. 65.5"
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
                required
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                Cena za litr (zł) <span className="text-red-400">*</span>
              </label>
              <input
                type="number"
                name="price_per_liter"
                value={formData.price_per_liter}
                onChange={handleChange}
                step="0.01"
                placeholder="np. 6.89"
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
                required
              />
            </div>
          </div>

          {/* Koszt całkowity (obliczany) */}
          <div className="rounded-lg border border-[#d3bb73]/20 bg-[#d3bb73]/10 p-4">
            <div className="flex items-center justify-between">
              <span className="text-[#e5e4e2]/80">Koszt całkowity:</span>
              <span className="text-2xl font-bold text-[#d3bb73]">{calculateTotal()} zł</span>
            </div>
          </div>

          {/* Płatność */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                Metoda płatności
              </label>
              <select
                name="payment_method"
                value={formData.payment_method}
                onChange={handleChange}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
              >
                <option value="">Wybierz...</option>
                <option value="gotowka">Gotówka</option>
                <option value="karta">Karta</option>
                <option value="karta_paliwowa">Karta paliwowa</option>
                <option value="przelew">Przelew</option>
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                Numer paragonu
              </label>
              <input
                type="text"
                name="receipt_number"
                value={formData.receipt_number}
                onChange={handleChange}
                placeholder="np. 123456789"
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
              />
            </div>
          </div>

          {/* Pełny bak */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              name="is_full_tank"
              id="is_full_tank"
              checked={formData.is_full_tank}
              onChange={handleChange}
              className="h-4 w-4 rounded border border-[#d3bb73]/20 bg-[#0f1119]"
            />
            <label htmlFor="is_full_tank" className="text-sm text-[#e5e4e2]">
              Pełny bak (zaznacz aby obliczyć średnie zużycie)
            </label>
          </div>

          {/* Notatki */}
          <div>
            <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Notatki</label>
            <textarea
              name="notes"
              value={formData.notes}
              onChange={handleChange}
              rows={2}
              placeholder="Dodatkowe informacje..."
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
            />
          </div>

          {/* Przyciski */}
          <div className="flex justify-end gap-4 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-[#0f1119] px-6 py-2 text-[#e5e4e2] hover:bg-[#0f1119]/80"
              disabled={loading}
            >
              Anuluj
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-2 text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Dodawanie...
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
