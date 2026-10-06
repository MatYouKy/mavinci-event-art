'use client';

import { useState, useEffect } from 'react';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Save, Cable, ImagePlus, X } from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useCreateCableMutation } from '../../store/equipmentApi';
import { supabase } from '@/lib/supabase/browser';
import { uploadImage } from '@/lib/storage';
import { ConnectorSelectWithPreview } from '@/components/crm/equipment/connectors/ConnectorSelectWithPreview';
import Image from 'next/image';

export default function NewCablePage() {
  const router = useRouter();
  const { canCreateInModule, loading: permissionsLoading } = useCurrentEmployee();
  const canCreate = canCreateInModule('equipment');
  const { showSnackbar } = useSnackbar();
  const [createCable] = useCreateCableMutation();

  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState<any[]>([]);
  const [cableCategories, setCableCategories] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [connectorTypes, setConnectorTypes] = useState<any[]>([]);

  const [form, setForm] = useState({
    name: '',
    length_meters: '',
    connector_in: '',
    connector_out: '',
    stock_quantity: '0',
    minimum_stock_quantity: '0',
    stock_unit: 'piece',
    tracking_mode: 'quantity',
    cable_category_id: '',
    is_directional: false,
    warehouse_category_id: '',
    storage_location_id: '',
    thumbnail_url: '',
    description: '',
    purchase_date: '',
    purchase_price: '',
    current_value: '',
    notes: '',
  });

  const detailedCableCategories = cableCategories.filter((category) => category.parent_id);
  const selectableCableCategories =
    detailedCableCategories.length > 0 ? detailedCableCategories : cableCategories;

  // Load data
  useEffect(() => {
    const loadData = async () => {
      const [cats, cableCats, locs, conns] = await Promise.all([
        supabase.from('warehouse_categories').select('id, name').order('name'),
        supabase
          .from('cable_categories')
          .select('id, parent_id, name, order_index')
          .eq('is_active', true)
          .order('order_index'),
        supabase.from('storage_locations').select('id, name').order('name'),
        supabase
          .from('connector_types')
          .select('id, name, description, common_uses, thumbnail_url, is_active, created_at, updated_at')
          .eq('is_active', true)
          .order('name'),
      ]);

      if (cats.data) setCategories(cats.data);
      if (cableCats.data) setCableCategories(cableCats.data);
      if (locs.data) setLocations(locs.data);
      if (conns.data) setConnectorTypes(conns.data);

      if (cableCats.error) {
        console.error('Error loading cable categories:', cableCats.error);
        showSnackbar('Nie udało się pobrać przeznaczeń technicznych przewodów', 'error');
      }
      if (conns.error) {
        console.error('Error loading connector types:', conns.error);
        showSnackbar('Nie udało się pobrać typów złącz', 'error');
      }
    };
    loadData();
  }, [showSnackbar]);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canCreate) return;

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
        minimum_stock_quantity: parseInt(form.minimum_stock_quantity) || 0,
        stock_unit: form.stock_unit,
        tracking_mode: form.tracking_mode,
        cable_category_id: form.cable_category_id || null,
        is_directional: form.is_directional,
        warehouse_category_id: form.warehouse_category_id || null,
        storage_location_id: form.storage_location_id || null,
        thumbnail_url: form.thumbnail_url || null,
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

  const handleThumbnailUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    showSnackbar('Przesyłanie miniatury przewodu...', 'info');
    try {
      const url = await uploadImage(file, 'equipment-thumbnails');
      setForm((previous) => ({ ...previous, thumbnail_url: url }));
      showSnackbar('Miniatura przewodu została dodana', 'success');
    } catch (error: any) {
      showSnackbar(error?.message || 'Nie udało się przesłać miniatury', 'error');
    }
  };

  if (permissionsLoading) return <p>Ładowanie uprawnień…</p>;
  if (!canCreate) return <p>Brak uprawnień do dodawania przewodów.</p>;

  return (
    <div className="min-h-screen bg-[#0f1117] p-6 text-[#e5e4e2]">
      <div className="mx-auto max-w-4xl">
        {/* Header */}
        <div className="mb-6 flex items-center gap-4">
          <button onClick={() => router.back()} className="rounded-lg p-2 hover:bg-[#1c1f33]">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Cable className="h-6 w-6" />
            Nowy przewód
          </h1>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Basic Info */}
          <div className="rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] p-6">
            <h2 className="mb-4 text-lg font-semibold">Podstawowe informacje</h2>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className="mb-2 block text-sm font-medium">Miniatura przewodu</label>
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex h-28 w-28 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[#d3bb73]/20 bg-[#0f1117]">
                    {form.thumbnail_url ? (
                      <Image
                        src={form.thumbnail_url}
                        alt="Miniatura przewodu"
                        width={112}
                        height={112}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <Cable className="h-10 w-10 text-[#e5e4e2]/25" />
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] px-4 py-2 text-sm hover:border-[#d3bb73]/50">
                      <ImagePlus className="h-4 w-4 text-[#d3bb73]" />
                      {form.thumbnail_url ? 'Zmień zdjęcie' : 'Dodaj zdjęcie'}
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleThumbnailUpload}
                        className="hidden"
                      />
                    </label>
                    {form.thumbnail_url && (
                      <button
                        type="button"
                        onClick={() => setForm((previous) => ({ ...previous, thumbnail_url: '' }))}
                        className="inline-flex items-center gap-2 rounded-lg border border-red-500/20 px-4 py-2 text-sm text-red-300 hover:bg-red-500/10"
                      >
                        <X className="h-4 w-4" />
                        Usuń
                      </button>
                    )}
                  </div>
                </div>
                <p className="mt-2 text-xs text-[#e5e4e2]/45">
                  Zdjęcie będzie widoczne na liście, w szczegółach oraz przy wybieraniu przewodu do zestawu.
                </p>
              </div>

              <div className="md:col-span-2">
                <label className="mb-2 block text-sm font-medium">Nazwa *</label>
                <input
                  type="text"
                  name="name"
                  value={form.name}
                  onChange={handleChange}
                  required
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] px-4 py-2 focus:border-[#d3bb73] focus:outline-none"
                  placeholder="np. XLR 5m"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium">Długość (m)</label>
                <input
                  type="number"
                  name="length_meters"
                  value={form.length_meters}
                  onChange={handleChange}
                  step="0.1"
                  min="0"
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] px-4 py-2 focus:border-[#d3bb73] focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium">
                  Stan początkowy ({form.stock_unit === 'meter' ? 'm' : 'szt.'}) *
                </label>
                <input
                  type="number"
                  name="stock_quantity"
                  value={form.stock_quantity}
                  onChange={handleChange}
                  min="0"
                  required
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] px-4 py-2 focus:border-[#d3bb73] focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium">Przeznaczenie techniczne *</label>
                <select
                  name="cable_category_id"
                  value={form.cable_category_id}
                  onChange={handleChange}
                  required
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] px-4 py-2 focus:border-[#d3bb73] focus:outline-none"
                >
                  <option value="">Wybierz kategorię...</option>
                  {selectableCableCategories.map((category) => {
                      const parent = cableCategories.find((item) => item.id === category.parent_id);
                      return (
                        <option key={category.id} value={category.id}>
                          {parent ? `${parent.name} / ` : ''}{category.name}
                        </option>
                      );
                    })}
                </select>
                {cableCategories.length === 0 && (
                  <p className="mt-2 text-xs text-amber-300">
                    Brak słownika przeznaczeń. Uruchom migrację kanonicznych kategorii przewodów.
                  </p>
                )}
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium">Jednostka magazynowa</label>
                <select
                  name="stock_unit"
                  value={form.stock_unit}
                  onChange={handleChange}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] px-4 py-2 focus:border-[#d3bb73] focus:outline-none"
                >
                  <option value="piece">Sztuki — gotowe przewody</option>
                  <option value="meter">Metry — przewód z rolki</option>
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium">Minimalny zapas</label>
                <input
                  type="number"
                  name="minimum_stock_quantity"
                  value={form.minimum_stock_quantity}
                  onChange={handleChange}
                  min="0"
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] px-4 py-2 focus:border-[#d3bb73] focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium">Sposób ewidencji</label>
                <select
                  name="tracking_mode"
                  value={form.tracking_mode}
                  onChange={handleChange}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] px-4 py-2 focus:border-[#d3bb73] focus:outline-none"
                >
                  <option value="quantity">Ilościowo — bez numerów seryjnych</option>
                  <option value="individual">Pojedyncze sztuki — dla drogich przewodów i bębnów</option>
                </select>
              </div>

              <ConnectorSelectWithPreview
                label="Złącze wejściowe *"
                value={form.connector_in}
                onChange={(value) => setForm((previous) => ({ ...previous, connector_in: value }))}
                connectorTypes={connectorTypes}
                placeholder="Wybierz złącze wejściowe"
              />

              <ConnectorSelectWithPreview
                label="Złącze wyjściowe *"
                value={form.connector_out}
                onChange={(value) => setForm((previous) => ({ ...previous, connector_out: value }))}
                connectorTypes={connectorTypes}
                placeholder="Wybierz złącze wyjściowe"
              />

              <div>
                <label className="mb-2 block text-sm font-medium">Kategoria magazynowa</label>
                <select
                  name="warehouse_category_id"
                  value={form.warehouse_category_id}
                  onChange={handleChange}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] px-4 py-2 focus:border-[#d3bb73] focus:outline-none"
                >
                  <option value="">Brak</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>

              <label className="flex items-center gap-3 rounded-lg border border-[#d3bb73]/15 bg-[#0f1117] px-4 py-3 text-sm">
                <input
                  type="checkbox"
                  checked={form.is_directional}
                  onChange={(event) => setForm((previous) => ({ ...previous, is_directional: event.target.checked }))}
                  className="h-4 w-4 accent-[#d3bb73]"
                />
                Przewód kierunkowy — końcówki IN i OUT nie są zamienne
              </label>

              <div>
                <label className="mb-2 block text-sm font-medium">Lokalizacja</label>
                <select
                  name="storage_location_id"
                  value={form.storage_location_id}
                  onChange={handleChange}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] px-4 py-2 focus:border-[#d3bb73] focus:outline-none"
                >
                  <option value="">Brak</option>
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-2">
                <label className="mb-2 block text-sm font-medium">Opis</label>
                <textarea
                  name="description"
                  value={form.description}
                  onChange={handleChange}
                  rows={3}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] px-4 py-2 focus:border-[#d3bb73] focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Purchase Info */}
          <div className="rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] p-6">
            <h2 className="mb-4 text-lg font-semibold">Informacje o zakupie</h2>

            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <label className="mb-2 block text-sm font-medium">Data zakupu</label>
                <input
                  type="date"
                  name="purchase_date"
                  value={form.purchase_date}
                  onChange={handleChange}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] px-4 py-2 focus:border-[#d3bb73] focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium">Cena zakupu (zł)</label>
                <input
                  type="number"
                  name="purchase_price"
                  value={form.purchase_price}
                  onChange={handleChange}
                  step="0.01"
                  min="0"
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] px-4 py-2 focus:border-[#d3bb73] focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium">Aktualna wartość (zł)</label>
                <input
                  type="number"
                  name="current_value"
                  value={form.current_value}
                  onChange={handleChange}
                  step="0.01"
                  min="0"
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] px-4 py-2 focus:border-[#d3bb73] focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] p-6">
            <h2 className="mb-4 text-lg font-semibold">Notatki</h2>
            <textarea
              name="notes"
              value={form.notes}
              onChange={handleChange}
              rows={4}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] px-4 py-2 focus:border-[#d3bb73] focus:outline-none"
              placeholder="Dodatkowe informacje..."
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => router.back()}
              className="rounded-lg border border-[#d3bb73]/20 px-6 py-2 hover:border-[#d3bb73]/40"
              disabled={saving}
            >
              Anuluj
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-2 text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {saving ? 'Zapisywanie...' : 'Zapisz'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
