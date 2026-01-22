'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Plus, Trash2, Upload, Package } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { uploadImage } from '@/lib/storage';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { useGetStorageLocationsQuery } from '../store/equipmentApi';

interface Category {
  id: string;
  parent_id: string | null;
  name: string;
  description: string | null;
  icon: string | null;
  level: number;
  order_index: number;
  is_active: boolean;
}

interface Component {
  id: string;
  component_name: string;
  quantity: number;
  description: string;
  is_included: boolean;
}

export default function NewEquipmentPage() {
  const router = useRouter();
  const { canCreateInModule, loading: employeeLoading } = useCurrentEmployee();

  const canCreate = canCreateInModule('equipment');

  const [categories, setCategories] = useState<Category[]>([]);
  const [subcategories, setSubcategories] = useState<Category[]>([]);
  const [saving, setSaving] = useState(false);
  const [uploadingThumbnail, setUploadingThumbnail] = useState(false);

  const { data: storageLocations = [] } = useGetStorageLocationsQuery();

  useEffect(() => {
    if (!employeeLoading && !canCreate) {
      router.push('/crm/equipment');
    }
  }, [canCreate, employeeLoading, router]);

  const [formData, setFormData] = useState({
    name: '',
    category_id: '',
    subcategory_id: '',
    brand: '',
    model: '',
    description: '',
    thumbnail_url: '',
    user_manual_url: '',
    weight_kg: '',
    dimensions_length: '',
    dimensions_width: '',
    dimensions_height: '',
    purchase_date: '',
    purchase_price: '',
    current_value: '',
    warranty_until: '',
    serial_number: '',
    barcode: '',
    notes: '',
    initial_quantity: '0',
    storage_location_id: '',
    min_stock_level: '0',
  });

  const [components, setComponents] = useState<Component[]>([]);

  useEffect(() => {
    fetchCategories();
  }, []);

  // Filtruj podkategorie gdy zmienia się kategoria
  useEffect(() => {
    if (formData.category_id) {
      const filtered = categories.filter(
        (c) => c.parent_id === formData.category_id && c.level === 2,
      );
      setSubcategories(filtered);
    } else {
      setSubcategories([]);
    }
    // Wyczyść podkategorię gdy zmienia się kategoria
    setFormData((prev) => ({ ...prev, subcategory_id: '' }));
  }, [formData.category_id, categories]);

  const fetchCategories = async () => {
    const { data, error } = await supabase
      .from('warehouse_categories')
      .select('*')
      .eq('is_active', true)
      .order('level, order_index');

    if (error) {
      console.error('Error fetching categories:', error);
      return;
    }
    if (data) setCategories(data);
  };

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleThumbnailUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingThumbnail(true);
    try {
      const url = await uploadImage(file, 'equipment-thumbnails');
      setFormData((prev) => ({ ...prev, thumbnail_url: url }));
    } catch (error) {
      console.error('Error uploading thumbnail:', error);
      alert('Błąd podczas przesyłania zdjęcia');
    } finally {
      setUploadingThumbnail(false);
    }
  };

  const addComponent = () => {
    setComponents((prev) => [
      ...prev,
      {
        id: `temp-${Date.now()}`,
        component_name: '',
        quantity: 1,
        description: '',
        is_included: true,
      },
    ]);
  };

  const updateComponent = (id: string, field: keyof Component, value: any) => {
    setComponents((prev) =>
      prev.map((comp) => (comp.id === id ? { ...comp, [field]: value } : comp)),
    );
  };

  const removeComponent = (id: string) => {
    setComponents((prev) => prev.filter((comp) => comp.id !== id));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name || !formData.category_id) {
      alert('Wypełnij wymagane pola: Nazwa i Kategoria');
      return;
    }

    setSaving(true);
    try {
      const dimensions =
        formData.dimensions_length || formData.dimensions_width || formData.dimensions_height
          ? {
              length: parseFloat(formData.dimensions_length) || null,
              width: parseFloat(formData.dimensions_width) || null,
              height: parseFloat(formData.dimensions_height) || null,
            }
          : null;

      const { data: equipmentData, error: equipmentError } = await supabase
        .from('equipment_items')
        .insert({
          name: formData.name,
          warehouse_category_id: formData.subcategory_id || formData.category_id,
          brand: formData.brand || null,
          model: formData.model || null,
          description: formData.description || null,
          thumbnail_url: formData.thumbnail_url || null,
          user_manual_url: formData.user_manual_url || null,
          weight_kg: formData.weight_kg ? parseFloat(formData.weight_kg) : null,
          dimensions_cm: dimensions,
          purchase_date: formData.purchase_date || null,
          purchase_price: formData.purchase_price ? parseFloat(formData.purchase_price) : null,
          current_value: formData.current_value ? parseFloat(formData.current_value) : null,
          warranty_until: formData.warranty_until || null,
          serial_number: formData.serial_number || null,
          barcode: formData.barcode || null,
          notes: formData.notes || null,
          storage_location_id: formData.storage_location_id || null,
          is_active: true,
        })
        .select()
        .single();

      if (equipmentError) throw equipmentError;

      const initialQty = parseInt(formData.initial_quantity) || 0;

      if (initialQty > 0) {
        const { error: stockError } = await supabase
          .from('equipment_stock')
          .update({
            total_quantity: initialQty,
            available_quantity: initialQty,
            min_stock_level: parseInt(formData.min_stock_level) || 0,
          })
          .eq('equipment_id', equipmentData.id);

        if (stockError) throw stockError;

        const unitsToCreate = Array.from({ length: initialQty }, (_, index) => ({
          equipment_id: equipmentData.id,
          unit_serial_number: `${equipmentData.id.slice(0, 8).toUpperCase()}-${String(index + 1).padStart(3, '0')}`,
          status: 'available',
          location_id: formData.storage_location_id || null,
          purchase_date: formData.purchase_date || null,
        }));

        const { error: unitsError } = await supabase.from('equipment_units').insert(unitsToCreate);

        if (unitsError) throw unitsError;

        const { error: historyError } = await supabase.from('equipment_stock_history').insert({
          equipment_id: equipmentData.id,
          change_type: 'purchase',
          quantity_change: initialQty,
          quantity_after: initialQty,
          notes: 'Początkowy stan magazynowy',
        });

        if (historyError) throw historyError;
      }

      if (components.length > 0) {
        const componentsToInsert = components
          .filter((c) => c.component_name.trim())
          .map((c) => ({
            equipment_id: equipmentData.id,
            component_name: c.component_name,
            quantity: c.quantity,
            description: c.description || null,
            is_included: c.is_included,
          }));

        if (componentsToInsert.length > 0) {
          const { error: componentsError } = await supabase
            .from('equipment_components')
            .insert(componentsToInsert);

          if (componentsError) throw componentsError;
        }
      }

      if (formData.thumbnail_url) {
        const { error: galleryError } = await supabase.from('equipment_gallery').insert({
          equipment_id: equipmentData.id,
          image_url: formData.thumbnail_url,
          caption: 'Główne zdjęcie',
          order_index: 0,
        });

        if (galleryError) console.error('Error adding thumbnail to gallery:', galleryError);
      }

      router.push(`/crm/equipment/${equipmentData.id}`);
    } catch (error) {
      console.error('Error creating equipment:', error);
      alert('Błąd podczas tworzenia sprzętu');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <button
          onClick={() => router.back()}
          className="rounded-lg p-2 transition-colors hover:bg-[#1c1f33]"
        >
          <ArrowLeft className="h-5 w-5 text-[#e5e4e2]" />
        </button>
        <h2 className="text-2xl font-light text-[#e5e4e2]">Dodaj nowy sprzęt</h2>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          <h3 className="mb-4 text-lg font-medium text-[#e5e4e2]">Podstawowe informacje</h3>

          <div className="mb-6">
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">
              Kategoria <span className="text-red-400">*</span>
            </label>
            <select
              name="category_id"
              value={formData.category_id}
              onChange={handleInputChange}
              required
              className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-3 text-base text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
            >
              <option value="">Wybierz kategorię sprzętu</option>
              {categories
                .filter((c) => c.level === 1)
                .map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
            </select>
            <p className="mt-2 text-xs text-[#e5e4e2]/40">
              Wybór kategorii określi dostępne pola w formularzu
            </p>
          </div>

          {subcategories.length > 0 && (
            <div className="mb-6">
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Podkategoria</label>
              <select
                name="subcategory_id"
                value={formData.subcategory_id}
                onChange={handleInputChange}
                className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-3 text-base text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
              >
                <option value="">Wybierz podkategorię (opcjonalnie)</option>
                {subcategories.map((subcat) => (
                  <option key={subcat.id} value={subcat.id}>
                    {subcat.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                Nazwa sprzętu <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleInputChange}
                required
                className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
                placeholder="np. Kolumna RCF ART932a"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Marka</label>
              <input
                type="text"
                name="brand"
                value={formData.brand}
                onChange={handleInputChange}
                className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
                placeholder="np. RCF"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Model</label>
              <input
                type="text"
                name="model"
                value={formData.model}
                onChange={handleInputChange}
                className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
                placeholder="np. ART932a"
              />
            </div>

            <div className="md:col-span-2">
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Opis</label>
              <textarea
                name="description"
                value={formData.description}
                onChange={handleInputChange}
                rows={3}
                className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
                placeholder="Opis sprzętu..."
              />
            </div>

            <div className="md:col-span-2">
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Miniaturka</label>
              {formData.thumbnail_url ? (
                <div className="flex items-center gap-4">
                  <img
                    src={formData.thumbnail_url}
                    alt="Miniaturka"
                    className="h-24 w-24 rounded-lg object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => setFormData((prev) => ({ ...prev, thumbnail_url: '' }))}
                    className="text-sm text-red-400 hover:text-red-300"
                  >
                    Usuń
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleThumbnailUpload}
                    className="hidden"
                    id="thumbnail-upload"
                  />
                  <label
                    htmlFor="thumbnail-upload"
                    className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-8 text-[#e5e4e2]/60 transition-colors hover:border-[#d3bb73]/30"
                  >
                    <Upload className="h-5 w-5" />
                    {uploadingThumbnail ? 'Przesyłanie...' : 'Kliknij aby wybrać zdjęcie'}
                  </label>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          <h3 className="mb-4 text-lg font-medium text-[#e5e4e2]">Parametry techniczne</h3>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Waga (kg)</label>
              <input
                type="number"
                step="0.01"
                name="weight_kg"
                value={formData.weight_kg}
                onChange={handleInputChange}
                className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
                placeholder="0.00"
              />
            </div>

            <div className="md:col-span-1">
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Wymiary (cm)</label>
              <div className="grid grid-cols-3 gap-2">
                <input
                  type="number"
                  step="0.1"
                  name="dimensions_length"
                  value={formData.dimensions_length}
                  onChange={handleInputChange}
                  className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
                  placeholder="Długość"
                />
                <input
                  type="number"
                  step="0.1"
                  name="dimensions_width"
                  value={formData.dimensions_width}
                  onChange={handleInputChange}
                  className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
                  placeholder="Szerokość"
                />
                <input
                  type="number"
                  step="0.1"
                  name="dimensions_height"
                  value={formData.dimensions_height}
                  onChange={handleInputChange}
                  className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
                  placeholder="Wysokość"
                />
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Numer seryjny</label>
              <input
                type="text"
                name="serial_number"
                value={formData.serial_number}
                onChange={handleInputChange}
                className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
                placeholder="SN12345"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Kod kreskowy</label>
              <input
                type="text"
                name="barcode"
                value={formData.barcode}
                onChange={handleInputChange}
                className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
                placeholder="123456789"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                Instrukcja obsługi (URL)
              </label>
              <input
                type="url"
                name="user_manual_url"
                value={formData.user_manual_url}
                onChange={handleInputChange}
                className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
                placeholder="https://..."
              />
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          <h3 className="mb-4 text-lg font-medium text-[#e5e4e2]">Informacje zakupowe</h3>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Data zakupu</label>
              <input
                type="date"
                name="purchase_date"
                value={formData.purchase_date}
                onChange={handleInputChange}
                className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Gwarancja do</label>
              <input
                type="date"
                name="warranty_until"
                value={formData.warranty_until}
                onChange={handleInputChange}
                className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Cena zakupu (zł)</label>
              <input
                type="number"
                step="0.01"
                name="purchase_price"
                value={formData.purchase_price}
                onChange={handleInputChange}
                className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
                placeholder="0.00"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Obecna wartość (zł)</label>
              <input
                type="number"
                step="0.01"
                name="current_value"
                value={formData.current_value}
                onChange={handleInputChange}
                className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
                placeholder="0.00"
              />
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          <h3 className="mb-4 text-lg font-medium text-[#e5e4e2]">Stan magazynowy</h3>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Początkowa ilość</label>
              <input
                type="number"
                name="initial_quantity"
                value={formData.initial_quantity}
                onChange={handleInputChange}
                className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
                placeholder="0"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Minimalny poziom</label>
              <input
                type="number"
                name="min_stock_level"
                value={formData.min_stock_level}
                onChange={handleInputChange}
                className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
                placeholder="0"
              />
            </div>

            <div className="md:col-span-2 lg:col-span-3">
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                Lokalizacja w magazynie
              </label>
              <select
                name="storage_location_id"
                value={formData.storage_location_id}
                onChange={handleInputChange}
                className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
              >
                <option value="">Wybierz lokalizację</option>
                {storageLocations.map((loc: any) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-medium text-[#e5e4e2]">Skład zestawu</h3>
            <button
              type="button"
              onClick={addComponent}
              className="flex items-center gap-2 text-sm text-[#d3bb73] hover:text-[#d3bb73]/80"
            >
              <Plus className="h-4 w-4" />
              Dodaj komponent
            </button>
          </div>

          {components.length === 0 ? (
            <p className="py-4 text-center text-sm text-[#e5e4e2]/40">
              Brak komponentów. Kliknij "Dodaj komponent" aby dodać elementy wchodzące w skład
              zestawu.
            </p>
          ) : (
            <div className="space-y-3">
              {components.map((component) => (
                <div
                  key={component.id}
                  className="flex items-start gap-3 rounded-lg bg-[#0f1119] p-3"
                >
                  <div className="grid flex-1 grid-cols-1 gap-3 md:grid-cols-3">
                    <input
                      type="text"
                      value={component.component_name}
                      onChange={(e) =>
                        updateComponent(component.id, 'component_name', e.target.value)
                      }
                      className="rounded border border-[#d3bb73]/10 bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
                      placeholder="Nazwa komponentu"
                    />
                    <input
                      type="number"
                      value={component.quantity}
                      onChange={(e) =>
                        updateComponent(component.id, 'quantity', parseInt(e.target.value) || 1)
                      }
                      className="rounded border border-[#d3bb73]/10 bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
                      placeholder="Ilość"
                      min="1"
                    />
                    <input
                      type="text"
                      value={component.description}
                      onChange={(e) => updateComponent(component.id, 'description', e.target.value)}
                      className="rounded border border-[#d3bb73]/10 bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
                      placeholder="Opis (opcjonalnie)"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeComponent(component.id)}
                    className="p-2 text-red-400 transition-colors hover:text-red-300"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          <label className="mb-2 block text-sm text-[#e5e4e2]/60">Notatki</label>
          <textarea
            name="notes"
            value={formData.notes}
            onChange={handleInputChange}
            rows={4}
            className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
            placeholder="Dodatkowe informacje..."
          />
        </div>

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="rounded-lg bg-[#e5e4e2]/10 px-6 py-2.5 text-[#e5e4e2] transition-colors hover:bg-[#e5e4e2]/20"
          >
            Anuluj
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-[#d3bb73] px-6 py-2.5 font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:opacity-50"
          >
            {saving ? 'Zapisywanie...' : 'Zapisz sprzęt'}
          </button>
        </div>
      </form>
    </div>
  );
}
