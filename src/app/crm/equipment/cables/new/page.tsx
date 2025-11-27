'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Save, Cable } from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useCreateCableMutation } from '../../store/equipmentApi';
import supabase from '@/lib/supabase';

export default function NewCablePage() {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const [createCable] = useCreateCableMutation();

  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [connectorTypes, setConnectorTypes] = useState<any[]>([]);

  const [form, setForm] = useState({
    name: '',
    length_meters: '',
    connector_in: '',
    connector_out: '',
    stock_quantity: '0',
    warehouse_category_id: '',
    storage_location_id: '',
    description: '',
    purchase_date: '',
    purchase_price: '',
    current_value: '',
    notes: '',
  });

  // Load data
  useEffect(() => {
    const loadData = async () => {
      const [cats, locs, conns] = await Promise.all([
        supabase.from('warehouse_categories').select('id, name').order('name'),
        supabase.from('storage_locations').select('id, name').order('name'),
        supabase.from('connector_types').select('id, name').order('name'),
      ]);

      if (cats.data) setCategories(cats.data);
      if (locs.data) setLocations(locs.data);
      if (conns.data) setConnectorTypes(conns.data);
    };
    loadData();
  }, []);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!form.name.trim()) {
      showSnackbar('Podaj nazwę przewodu', 'error');
      return;
    }

    if (!form.connector_in || !form.connector_out) {
      showSnackbar('Wybierz typ złącz', 'error');
      return;
    }

    setSaving(true);
    try {
      const payload: any = {
        name: form.name.trim(),
        length_meters: form.length_meters ? parseFloat(form.length_meters) : null,
        connector_in: form.connector_in,
        connector_out: form.connector_out,
        stock_quantity: parseInt(form.stock_quantity) || 0,
        warehouse_category_id: form.warehouse_category_id || null,
        storage_location_id: form.storage_location_id || null,
        description: form.description || null,
        purchase_date: form.purchase_date || null,
        purchase_price: form.purchase_price ? parseFloat(form.purchase_price) : null,
        current_value: form.current_value ? parseFloat(form.current_value) : null,
        notes: form.notes || null,
      };

      const result = await createCable(payload).unwrap();
      showSnackbar('Przewód dodany', 'success');
      router.push(`/crm/equipment/cables/${result.id}`);
    } catch (e) {
      console.error('Error creating cable:', e);
      showSnackbar('Błąd podczas dodawania', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0f1117] text-[#e5e4e2] p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <button
            onClick={() => router.back()}
            className="p-2 hover:bg-[#1c1f33] rounded-lg"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Cable className="w-6 h-6" />
            Nowy przewód
          </h1>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Basic Info */}
          <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-4">Podstawowe informacje</h2>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium mb-2">Nazwa *</label>
                <input
                  type="text"
                  name="name"
                  value={form.name}
                  onChange={handleChange}
                  required
                  className="w-full bg-[#0f1117] border border-[#d3bb73]/20 rounded-lg px-4 py-2 focus:outline-none focus:border-[#d3bb73]"
                  placeholder="np. XLR 5m"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Długość (m)</label>
                <input
                  type="number"
                  name="length_meters"
                  value={form.length_meters}
                  onChange={handleChange}
                  step="0.1"
                  min="0"
                  className="w-full bg-[#0f1117] border border-[#d3bb73]/20 rounded-lg px-4 py-2 focus:outline-none focus:border-[#d3bb73]"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Ilość *</label>
                <input
                  type="number"
                  name="stock_quantity"
                  value={form.stock_quantity}
                  onChange={handleChange}
                  min="0"
                  required
                  className="w-full bg-[#0f1117] border border-[#d3bb73]/20 rounded-lg px-4 py-2 focus:outline-none focus:border-[#d3bb73]"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Złącze wejściowe *</label>
                <select
                  name="connector_in"
                  value={form.connector_in}
                  onChange={handleChange}
                  required
                  className="w-full bg-[#0f1117] border border-[#d3bb73]/20 rounded-lg px-4 py-2 focus:outline-none focus:border-[#d3bb73]"
                >
                  <option value="">Wybierz...</option>
                  {connectorTypes.map((ct) => (
                    <option key={ct.id} value={ct.id}>{ct.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Złącze wyjściowe *</label>
                <select
                  name="connector_out"
                  value={form.connector_out}
                  onChange={handleChange}
                  required
                  className="w-full bg-[#0f1117] border border-[#d3bb73]/20 rounded-lg px-4 py-2 focus:outline-none focus:border-[#d3bb73]"
                >
                  <option value="">Wybierz...</option>
                  {connectorTypes.map((ct) => (
                    <option key={ct.id} value={ct.id}>{ct.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Kategoria</label>
                <select
                  name="warehouse_category_id"
                  value={form.warehouse_category_id}
                  onChange={handleChange}
                  className="w-full bg-[#0f1117] border border-[#d3bb73]/20 rounded-lg px-4 py-2 focus:outline-none focus:border-[#d3bb73]"
                >
                  <option value="">Brak</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Lokalizacja</label>
                <select
                  name="storage_location_id"
                  value={form.storage_location_id}
                  onChange={handleChange}
                  className="w-full bg-[#0f1117] border border-[#d3bb73]/20 rounded-lg px-4 py-2 focus:outline-none focus:border-[#d3bb73]"
                >
                  <option value="">Brak</option>
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>{loc.name}</option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium mb-2">Opis</label>
                <textarea
                  name="description"
                  value={form.description}
                  onChange={handleChange}
                  rows={3}
                  className="w-full bg-[#0f1117] border border-[#d3bb73]/20 rounded-lg px-4 py-2 focus:outline-none focus:border-[#d3bb73]"
                />
              </div>
            </div>
          </div>

          {/* Purchase Info */}
          <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-4">Informacje o zakupie</h2>

            <div className="grid md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">Data zakupu</label>
                <input
                  type="date"
                  name="purchase_date"
                  value={form.purchase_date}
                  onChange={handleChange}
                  className="w-full bg-[#0f1117] border border-[#d3bb73]/20 rounded-lg px-4 py-2 focus:outline-none focus:border-[#d3bb73]"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Cena zakupu (zł)</label>
                <input
                  type="number"
                  name="purchase_price"
                  value={form.purchase_price}
                  onChange={handleChange}
                  step="0.01"
                  min="0"
                  className="w-full bg-[#0f1117] border border-[#d3bb73]/20 rounded-lg px-4 py-2 focus:outline-none focus:border-[#d3bb73]"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Aktualna wartość (zł)</label>
                <input
                  type="number"
                  name="current_value"
                  value={form.current_value}
                  onChange={handleChange}
                  step="0.01"
                  min="0"
                  className="w-full bg-[#0f1117] border border-[#d3bb73]/20 rounded-lg px-4 py-2 focus:outline-none focus:border-[#d3bb73]"
                />
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-4">Notatki</h2>
            <textarea
              name="notes"
              value={form.notes}
              onChange={handleChange}
              rows={4}
              className="w-full bg-[#0f1117] border border-[#d3bb73]/20 rounded-lg px-4 py-2 focus:outline-none focus:border-[#d3bb73]"
              placeholder="Dodatkowe informacje..."
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => router.back()}
              className="px-6 py-2 border border-[#d3bb73]/20 rounded-lg hover:border-[#d3bb73]/40"
              disabled={saving}
            >
              Anuluj
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-6 py-2 rounded-lg hover:bg-[#d3bb73]/90 disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Zapisywanie...' : 'Zapisz'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
