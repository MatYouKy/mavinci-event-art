'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Plus, Trash2, Upload, Package } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { uploadImage } from '@/lib/storage';

interface Category {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
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

interface ConnectorType {
  id: string;
  name: string;
  description: string | null;
  common_uses: string | null;
}

export default function NewEquipmentPage() {
  const router = useRouter();
  const [categories, setCategories] = useState<Category[]>([]);
  const [connectorTypes, setConnectorTypes] = useState<ConnectorType[]>([]);
  const [saving, setSaving] = useState(false);
  const [uploadingThumbnail, setUploadingThumbnail] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    category_id: '',
    brand: '',
    model: '',
    description: '',
    thumbnail_url: '',
    user_manual_url: '',
    weight_kg: '',
    cable_length_meters: '',
    cable_connector_in: '',
    cable_connector_out: '',
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
    storage_location: '',
    min_stock_level: '0',
  });

  const [components, setComponents] = useState<Component[]>([]);

  useEffect(() => {
    fetchCategories();
    fetchConnectorTypes();
  }, []);

  const fetchCategories = async () => {
    const { data, error } = await supabase
      .from('equipment_categories')
      .select('*')
      .eq('is_active', true)
      .order('order_index');

    if (data) setCategories(data);
  };

  const fetchConnectorTypes = async () => {
    const { data, error } = await supabase
      .from('connector_types')
      .select('*')
      .eq('is_active', true)
      .order('name');

    if (data) setConnectorTypes(data);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleThumbnailUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingThumbnail(true);
    try {
      const url = await uploadImage(file, 'equipment-thumbnails');
      setFormData(prev => ({ ...prev, thumbnail_url: url }));
    } catch (error) {
      console.error('Error uploading thumbnail:', error);
      alert('Błąd podczas przesyłania zdjęcia');
    } finally {
      setUploadingThumbnail(false);
    }
  };

  const addComponent = () => {
    setComponents(prev => [
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
    setComponents(prev =>
      prev.map(comp => (comp.id === id ? { ...comp, [field]: value } : comp))
    );
  };

  const removeComponent = (id: string) => {
    setComponents(prev => prev.filter(comp => comp.id !== id));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name || !formData.category_id) {
      alert('Wypełnij wymagane pola: Nazwa i Kategoria');
      return;
    }

    setSaving(true);
    try {
      const dimensions = formData.dimensions_length || formData.dimensions_width || formData.dimensions_height
        ? {
            length: parseFloat(formData.dimensions_length) || null,
            width: parseFloat(formData.dimensions_width) || null,
            height: parseFloat(formData.dimensions_height) || null,
          }
        : null;

      const cableSpecs = formData.cable_length_meters || formData.cable_connector_in || formData.cable_connector_out
        ? {
            length_meters: formData.cable_length_meters ? parseFloat(formData.cable_length_meters) : null,
            connector_in: formData.cable_connector_in || null,
            connector_out: formData.cable_connector_out || null,
          }
        : null;

      const { data: equipmentData, error: equipmentError } = await supabase
        .from('equipment_items')
        .insert({
          name: formData.name,
          category_id: formData.category_id,
          brand: formData.brand || null,
          model: formData.model || null,
          description: formData.description || null,
          thumbnail_url: formData.thumbnail_url || null,
          user_manual_url: formData.user_manual_url || null,
          weight_kg: formData.weight_kg ? parseFloat(formData.weight_kg) : null,
          cable_specs: cableSpecs,
          dimensions_cm: dimensions,
          purchase_date: formData.purchase_date || null,
          purchase_price: formData.purchase_price ? parseFloat(formData.purchase_price) : null,
          current_value: formData.current_value ? parseFloat(formData.current_value) : null,
          warranty_until: formData.warranty_until || null,
          serial_number: formData.serial_number || null,
          barcode: formData.barcode || null,
          notes: formData.notes || null,
          is_active: true,
        })
        .select()
        .single();

      if (equipmentError) throw equipmentError;

      const initialQty = parseInt(formData.initial_quantity) || 0;
      const isCable = categories.find(c => c.id === formData.category_id)?.name?.toLowerCase().includes('przewod');

      if (initialQty > 0) {
        const { error: stockError } = await supabase
          .from('equipment_stock')
          .update({
            total_quantity: initialQty,
            available_quantity: initialQty,
            storage_location: formData.storage_location || null,
            min_stock_level: parseInt(formData.min_stock_level) || 0,
          })
          .eq('equipment_id', equipmentData.id);

        if (stockError) throw stockError;

        if (!isCable) {
          const unitsToCreate = Array.from({ length: initialQty }, (_, index) => ({
            equipment_id: equipmentData.id,
            unit_serial_number: `${equipmentData.id.slice(0, 8).toUpperCase()}-${String(index + 1).padStart(3, '0')}`,
            status: 'available',
            location: formData.storage_location || null,
            purchase_date: formData.purchase_date || null,
          }));

          const { error: unitsError } = await supabase
            .from('equipment_units')
            .insert(unitsToCreate);

          if (unitsError) throw unitsError;
        }

        const { error: historyError } = await supabase
          .from('equipment_stock_history')
          .insert({
            equipment_id: equipmentData.id,
            change_type: 'purchase',
            quantity_change: initialQty,
            quantity_after: initialQty,
            notes: isCable ? 'Początkowy stan magazynowy (drobnica)' : 'Początkowy stan magazynowy',
          });

        if (historyError) throw historyError;
      }

      if (components.length > 0) {
        const componentsToInsert = components
          .filter(c => c.component_name.trim())
          .map(c => ({
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
        const { error: galleryError } = await supabase
          .from('equipment_gallery')
          .insert({
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
          className="p-2 hover:bg-[#1c1f33] rounded-lg transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-[#e5e4e2]" />
        </button>
        <h2 className="text-2xl font-light text-[#e5e4e2]">Dodaj nowy sprzęt</h2>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
          <h3 className="text-lg font-medium text-[#e5e4e2] mb-4">Podstawowe informacje</h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                Nazwa sprzętu <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleInputChange}
                required
                className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                placeholder="np. Kolumna RCF ART932a"
              />
            </div>

            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                Kategoria <span className="text-red-400">*</span>
              </label>
              <select
                name="category_id"
                value={formData.category_id}
                onChange={handleInputChange}
                required
                className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
              >
                <option value="">Wybierz kategorię</option>
                {categories.map(cat => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Marka</label>
              <input
                type="text"
                name="brand"
                value={formData.brand}
                onChange={handleInputChange}
                className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                placeholder="np. RCF"
              />
            </div>

            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Model</label>
              <input
                type="text"
                name="model"
                value={formData.model}
                onChange={handleInputChange}
                className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                placeholder="np. ART932a"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Opis</label>
              <textarea
                name="description"
                value={formData.description}
                onChange={handleInputChange}
                rows={3}
                className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                placeholder="Opis sprzętu..."
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Miniaturka</label>
              {formData.thumbnail_url ? (
                <div className="flex items-center gap-4">
                  <img
                    src={formData.thumbnail_url}
                    alt="Miniaturka"
                    className="w-24 h-24 object-cover rounded-lg"
                  />
                  <button
                    type="button"
                    onClick={() => setFormData(prev => ({ ...prev, thumbnail_url: '' }))}
                    className="text-red-400 hover:text-red-300 text-sm"
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
                    className="flex items-center justify-center gap-2 w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-8 text-[#e5e4e2]/60 hover:border-[#d3bb73]/30 cursor-pointer transition-colors"
                  >
                    <Upload className="w-5 h-5" />
                    {uploadingThumbnail ? 'Przesyłanie...' : 'Kliknij aby wybrać zdjęcie'}
                  </label>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
          <h3 className="text-lg font-medium text-[#e5e4e2] mb-4">Parametry techniczne</h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {categories.find(c => c.id === formData.category_id)?.name?.toLowerCase().includes('przewod') ? (
              <>
                <div>
                  <label className="block text-sm text-[#e5e4e2]/60 mb-2">Długość (m)</label>
                  <input
                    type="number"
                    step="0.5"
                    name="cable_length_meters"
                    value={formData.cable_length_meters}
                    onChange={handleInputChange}
                    className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                    placeholder="10"
                  />
                </div>

                <div>
                  <label className="block text-sm text-[#e5e4e2]/60 mb-2">Wtyk wejściowy</label>
                  <select
                    name="cable_connector_in"
                    value={formData.cable_connector_in}
                    onChange={handleInputChange}
                    className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                  >
                    <option value="">Wybierz wtyk</option>
                    {connectorTypes.map((connector) => (
                      <option key={connector.id} value={connector.name} title={connector.description || undefined}>
                        {connector.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm text-[#e5e4e2]/60 mb-2">Wtyk wyjściowy</label>
                  <select
                    name="cable_connector_out"
                    value={formData.cable_connector_out}
                    onChange={handleInputChange}
                    className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                  >
                    <option value="">Wybierz wtyk</option>
                    {connectorTypes.map((connector) => (
                      <option key={connector.id} value={connector.name} title={connector.description || undefined}>
                        {connector.name}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            ) : (
              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">Waga (kg)</label>
                <input
                  type="number"
                  step="0.01"
                  name="weight_kg"
                  value={formData.weight_kg}
                  onChange={handleInputChange}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                  placeholder="0.00"
                />
              </div>
            )}

            {!categories.find(c => c.id === formData.category_id)?.name?.toLowerCase().includes('przewod') && (
              <div className="md:col-span-1">
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">Wymiary (cm)</label>
                <div className="grid grid-cols-3 gap-2">
                  <input
                    type="number"
                    step="0.1"
                    name="dimensions_length"
                    value={formData.dimensions_length}
                    onChange={handleInputChange}
                    className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                    placeholder="Długość"
                  />
                  <input
                    type="number"
                    step="0.1"
                    name="dimensions_width"
                    value={formData.dimensions_width}
                    onChange={handleInputChange}
                    className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                    placeholder="Szerokość"
                  />
                  <input
                    type="number"
                    step="0.1"
                    name="dimensions_height"
                    value={formData.dimensions_height}
                    onChange={handleInputChange}
                    className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                    placeholder="Wysokość"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Numer seryjny</label>
              <input
                type="text"
                name="serial_number"
                value={formData.serial_number}
                onChange={handleInputChange}
                className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                placeholder="SN12345"
              />
            </div>

            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Kod kreskowy</label>
              <input
                type="text"
                name="barcode"
                value={formData.barcode}
                onChange={handleInputChange}
                className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                placeholder="123456789"
              />
            </div>

            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Instrukcja obsługi (URL)</label>
              <input
                type="url"
                name="user_manual_url"
                value={formData.user_manual_url}
                onChange={handleInputChange}
                className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                placeholder="https://..."
              />
            </div>
          </div>
        </div>

        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
          <h3 className="text-lg font-medium text-[#e5e4e2] mb-4">Informacje zakupowe</h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Data zakupu</label>
              <input
                type="date"
                name="purchase_date"
                value={formData.purchase_date}
                onChange={handleInputChange}
                className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
              />
            </div>

            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Gwarancja do</label>
              <input
                type="date"
                name="warranty_until"
                value={formData.warranty_until}
                onChange={handleInputChange}
                className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
              />
            </div>

            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Cena zakupu (zł)</label>
              <input
                type="number"
                step="0.01"
                name="purchase_price"
                value={formData.purchase_price}
                onChange={handleInputChange}
                className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                placeholder="0.00"
              />
            </div>

            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Obecna wartość (zł)</label>
              <input
                type="number"
                step="0.01"
                name="current_value"
                value={formData.current_value}
                onChange={handleInputChange}
                className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                placeholder="0.00"
              />
            </div>
          </div>
        </div>

        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
          <h3 className="text-lg font-medium text-[#e5e4e2] mb-4">Stan magazynowy</h3>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Początkowa ilość</label>
              <input
                type="number"
                name="initial_quantity"
                value={formData.initial_quantity}
                onChange={handleInputChange}
                className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                placeholder="0"
              />
            </div>

            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Minimalny poziom</label>
              <input
                type="number"
                name="min_stock_level"
                value={formData.min_stock_level}
                onChange={handleInputChange}
                className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                placeholder="0"
              />
            </div>

            <div className="md:col-span-2 lg:col-span-3">
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Lokalizacja w magazynie</label>
              <input
                type="text"
                name="storage_location"
                value={formData.storage_location}
                onChange={handleInputChange}
                className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                placeholder="np. Regał A, Półka 3"
              />
            </div>
          </div>
        </div>

        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-medium text-[#e5e4e2]">Skład zestawu</h3>
            <button
              type="button"
              onClick={addComponent}
              className="flex items-center gap-2 text-[#d3bb73] hover:text-[#d3bb73]/80 text-sm"
            >
              <Plus className="w-4 h-4" />
              Dodaj komponent
            </button>
          </div>

          {components.length === 0 ? (
            <p className="text-[#e5e4e2]/40 text-sm text-center py-4">
              Brak komponentów. Kliknij "Dodaj komponent" aby dodać elementy wchodzące w skład zestawu.
            </p>
          ) : (
            <div className="space-y-3">
              {components.map((component) => (
                <div key={component.id} className="flex gap-3 items-start bg-[#0f1119] p-3 rounded-lg">
                  <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-3">
                    <input
                      type="text"
                      value={component.component_name}
                      onChange={(e) => updateComponent(component.id, 'component_name', e.target.value)}
                      className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded px-3 py-2 text-[#e5e4e2] text-sm focus:outline-none focus:border-[#d3bb73]/30"
                      placeholder="Nazwa komponentu"
                    />
                    <input
                      type="number"
                      value={component.quantity}
                      onChange={(e) => updateComponent(component.id, 'quantity', parseInt(e.target.value) || 1)}
                      className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded px-3 py-2 text-[#e5e4e2] text-sm focus:outline-none focus:border-[#d3bb73]/30"
                      placeholder="Ilość"
                      min="1"
                    />
                    <input
                      type="text"
                      value={component.description}
                      onChange={(e) => updateComponent(component.id, 'description', e.target.value)}
                      className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded px-3 py-2 text-[#e5e4e2] text-sm focus:outline-none focus:border-[#d3bb73]/30"
                      placeholder="Opis (opcjonalnie)"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeComponent(component.id)}
                    className="p-2 text-red-400 hover:text-red-300 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
          <label className="block text-sm text-[#e5e4e2]/60 mb-2">Notatki</label>
          <textarea
            name="notes"
            value={formData.notes}
            onChange={handleInputChange}
            rows={4}
            className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
            placeholder="Dodatkowe informacje..."
          />
        </div>

        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={() => router.back()}
            className="px-6 py-2.5 bg-[#e5e4e2]/10 text-[#e5e4e2] rounded-lg hover:bg-[#e5e4e2]/20 transition-colors"
          >
            Anuluj
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-2.5 bg-[#d3bb73] text-[#1c1f33] rounded-lg font-medium hover:bg-[#d3bb73]/90 transition-colors disabled:opacity-50"
          >
            {saving ? 'Zapisywanie...' : 'Zapisz sprzęt'}
          </button>
        </div>
      </form>
    </div>
  );
}
