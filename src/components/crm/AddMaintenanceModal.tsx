'use client';

import { useState } from 'react';
import { X, Wrench, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';

interface AddMaintenanceModalProps {
  vehicleId: string;
  vehicleName: string;
  currentMileage: number;
  onClose: () => void;
  onSuccess: () => void;
}

export default function AddMaintenanceModal({
  vehicleId,
  vehicleName,
  currentMileage,
  onClose,
  onSuccess,
}: AddMaintenanceModalProps) {
  const { showSnackbar } = useSnackbar();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    type: 'service',
    category: '',
    date: new Date().toISOString().split('T')[0],
    odometer_reading: currentMileage,
    title: '',
    description: '',
    service_provider: '',
    service_provider_address: '',
    service_provider_phone: '',
    labor_cost: '',
    parts_cost: '',
    invoice_number: '',
    warranty_end_date: '',
    next_service_date: '',
    next_service_mileage: '',
    status: 'completed',
    notes: '',
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.title || !formData.date || !formData.odometer_reading) {
      showSnackbar('Wypełnij wymagane pola', 'error');
      return;
    }

    setLoading(true);

    try {
      const data = {
        vehicle_id: vehicleId,
        type: formData.type,
        category: formData.category || null,
        date: formData.date,
        odometer_reading: parseInt(formData.odometer_reading.toString()),
        title: formData.title,
        description: formData.description || null,
        service_provider: formData.service_provider || null,
        service_provider_address: formData.service_provider_address || null,
        service_provider_phone: formData.service_provider_phone || null,
        labor_cost: formData.labor_cost ? parseFloat(formData.labor_cost.toString()) : 0,
        parts_cost: formData.parts_cost ? parseFloat(formData.parts_cost.toString()) : 0,
        invoice_number: formData.invoice_number || null,
        warranty_end_date: formData.warranty_end_date || null,
        next_service_date: formData.next_service_date || null,
        next_service_mileage: formData.next_service_mileage ? parseInt(formData.next_service_mileage.toString()) : null,
        status: formData.status,
        notes: formData.notes || null,
      };

      const { error } = await supabase.from('maintenance_records').insert([data]);

      if (error) throw error;

      showSnackbar('Wpis serwisowy został dodany', 'success');
      onSuccess();
      onClose();
    } catch (error: any) {
      console.error('Error adding maintenance record:', error);
      showSnackbar(error.message || 'Błąd podczas dodawania wpisu', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/20 max-w-3xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-[#1c1f33] border-b border-[#d3bb73]/20 p-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Wrench className="w-6 h-6 text-[#d3bb73]" />
            <div>
              <h2 className="text-xl font-bold text-[#e5e4e2]">Dodaj wpis serwisowy</h2>
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
                Typ <span className="text-red-400">*</span>
              </label>
              <select
                name="type"
                value={formData.type}
                onChange={handleChange}
                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                required
              >
                <option value="service">Przegląd</option>
                <option value="repair">Naprawa</option>
                <option value="inspection">Kontrola techniczna</option>
                <option value="tire_change">Wymiana opon</option>
                <option value="oil_change">Wymiana oleju</option>
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
                <option value="scheduled">Zaplanowany</option>
                <option value="in_progress">W trakcie</option>
                <option value="completed">Zakończony</option>
                <option value="cancelled">Anulowany</option>
              </select>
            </div>
          </div>

          {/* Data i przebieg */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                Data <span className="text-red-400">*</span>
              </label>
              <input
                type="date"
                name="date"
                value={formData.date}
                onChange={handleChange}
                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                Przebieg (km) <span className="text-red-400">*</span>
              </label>
              <input
                type="number"
                name="odometer_reading"
                value={formData.odometer_reading}
                onChange={handleChange}
                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                required
              />
            </div>
          </div>

          {/* Tytuł */}
          <div>
            <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
              Tytuł <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              name="title"
              value={formData.title}
              onChange={handleChange}
              placeholder="np. Przegląd okresowy 80 000 km"
              className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
              required
            />
          </div>

          {/* Opis */}
          <div>
            <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Opis prac</label>
            <textarea
              name="description"
              value={formData.description}
              onChange={handleChange}
              rows={3}
              placeholder="Szczegółowy opis wykonanych prac..."
              className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
            />
          </div>

          {/* Warsztat */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-[#e5e4e2]">Warsztat</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Nazwa</label>
                <input
                  type="text"
                  name="service_provider"
                  value={formData.service_provider}
                  onChange={handleChange}
                  placeholder="np. ASO Mercedes"
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Adres</label>
                <input
                  type="text"
                  name="service_provider_address"
                  value={formData.service_provider_address}
                  onChange={handleChange}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Telefon</label>
                <input
                  type="tel"
                  name="service_provider_phone"
                  value={formData.service_provider_phone}
                  onChange={handleChange}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                />
              </div>
            </div>
          </div>

          {/* Koszty */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-[#e5e4e2]">Koszty</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Robocizna (zł)</label>
                <input
                  type="number"
                  name="labor_cost"
                  value={formData.labor_cost}
                  onChange={handleChange}
                  step="0.01"
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Części (zł)</label>
                <input
                  type="number"
                  name="parts_cost"
                  value={formData.parts_cost}
                  onChange={handleChange}
                  step="0.01"
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Nr faktury</label>
                <input
                  type="text"
                  name="invoice_number"
                  value={formData.invoice_number}
                  onChange={handleChange}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                />
              </div>
            </div>
          </div>

          {/* Następny serwis */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-[#e5e4e2]">Następny przegląd</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Data</label>
                <input
                  type="date"
                  name="next_service_date"
                  value={formData.next_service_date}
                  onChange={handleChange}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Przebieg (km)</label>
                <input
                  type="number"
                  name="next_service_mileage"
                  value={formData.next_service_mileage}
                  onChange={handleChange}
                  placeholder="np. 90000"
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                />
              </div>
            </div>
          </div>

          {/* Notatki */}
          <div>
            <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Notatki</label>
            <textarea
              name="notes"
              value={formData.notes}
              onChange={handleChange}
              rows={2}
              placeholder="Dodatkowe informacje..."
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
                'Dodaj wpis'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
