'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, Save, Package, DollarSign, Truck, Users, Wrench, Tag, Settings } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';

interface Product {
  id: string;
  category_id: string;
  name: string;
  description: string;
  base_price: number;
  cost_price: number;
  transport_cost: number;
  logistics_cost: number;
  setup_time_hours: number;
  teardown_time_hours: number;
  unit: string;
  min_quantity: number;
  max_quantity: number | null;
  requires_vehicle: boolean;
  requires_driver: boolean;
  tags: string[];
  is_active: boolean;
  display_order: number;
  category?: {
    id: string;
    name: string;
  };
}

interface ProductEquipment {
  id: string;
  equipment_item_id: string;
  quantity: number;
  is_optional: boolean;
  notes: string;
  equipment_item?: {
    id: string;
    name: string;
    category?: {
      name: string;
    };
  };
}

interface ProductStaff {
  id: string;
  role: string;
  quantity: number;
  hourly_rate: number | null;
  estimated_hours: number | null;
  required_skills: string[];
  is_optional: boolean;
  notes: string;
}

export default function ProductDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { showSnackbar } = useSnackbar();
  const { employee, hasPermission } = useCurrentEmployee();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [product, setProduct] = useState<Product | null>(null);
  const [categories, setCategories] = useState<any[]>([]);
  const [equipment, setEquipment] = useState<ProductEquipment[]>([]);
  const [staff, setStaff] = useState<ProductStaff[]>([]);

  const canEdit = hasPermission('offers_manage');

  useEffect(() => {
    if (params.id) {
      fetchProduct();
      fetchCategories();
      fetchEquipment();
      fetchStaff();
    }
  }, [params.id]);

  const fetchProduct = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('offer_products')
        .select(`
          *,
          category:offer_product_categories(id, name)
        `)
        .eq('id', params.id)
        .single();

      if (error) throw error;
      if (data) setProduct(data);
    } catch (err: any) {
      showSnackbar(err.message || 'Błąd pobierania produktu', 'error');
    } finally {
      setLoading(false);
    }
  };

  const fetchCategories = async () => {
    const { data } = await supabase
      .from('offer_product_categories')
      .select('*')
      .eq('is_active', true)
      .order('display_order');
    if (data) setCategories(data);
  };

  const fetchEquipment = async () => {
    const { data } = await supabase
      .from('offer_product_equipment')
      .select(`
        *,
        equipment_item:equipment_items(id, name, category:equipment_categories(name))
      `)
      .eq('product_id', params.id);
    if (data) setEquipment(data);
  };

  const fetchStaff = async () => {
    const { data } = await supabase
      .from('offer_product_staff')
      .select('*')
      .eq('product_id', params.id);
    if (data) setStaff(data);
  };

  const handleSave = async () => {
    if (!product || !canEdit) return;

    try {
      setSaving(true);
      const { error } = await supabase
        .from('offer_products')
        .update({
          category_id: product.category_id,
          name: product.name,
          description: product.description,
          base_price: product.base_price,
          cost_price: product.cost_price,
          transport_cost: product.transport_cost,
          logistics_cost: product.logistics_cost,
          setup_time_hours: product.setup_time_hours,
          teardown_time_hours: product.teardown_time_hours,
          unit: product.unit,
          min_quantity: product.min_quantity,
          max_quantity: product.max_quantity,
          requires_vehicle: product.requires_vehicle,
          requires_driver: product.requires_driver,
          tags: product.tags,
          is_active: product.is_active,
          display_order: product.display_order,
        })
        .eq('id', product.id);

      if (error) throw error;
      showSnackbar('Zapisano zmiany', 'success');
      fetchProduct();
    } catch (err: any) {
      showSnackbar(err.message || 'Błąd zapisywania', 'error');
    } finally {
      setSaving(false);
    }
  };

  const margin = product ? ((product.base_price - product.cost_price) / product.base_price) * 100 : 0;
  const totalCost = product ? product.cost_price + product.transport_cost + product.logistics_cost : 0;
  const totalPrice = product ? product.base_price + product.transport_cost + product.logistics_cost : 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-[#e5e4e2]">Ładowanie...</div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-[#e5e4e2]">Nie znaleziono produktu</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push('/crm/offers?tab=catalog')}
            className="p-2 hover:bg-[#1c1f33] rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-[#e5e4e2]" />
          </button>
          <div>
            <h1 className="text-2xl font-light text-[#e5e4e2]">{product.name}</h1>
            <p className="text-sm text-[#e5e4e2]/60 mt-1">
              {product.category?.name}
            </p>
          </div>
        </div>
        {canEdit && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg hover:bg-[#d3bb73]/90 disabled:opacity-50 transition-colors"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Zapisywanie...' : 'Zapisz zmiany'}
          </button>
        )}
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-5">
          <div className="flex items-center gap-3 mb-2">
            <DollarSign className="w-5 h-5 text-[#d3bb73]" />
            <span className="text-2xl font-light text-[#e5e4e2]">
              {product.base_price.toLocaleString('pl-PL')} zł
            </span>
          </div>
          <p className="text-sm text-[#e5e4e2]/60">Cena bazowa</p>
        </div>

        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-5">
          <div className="flex items-center gap-3 mb-2">
            <DollarSign className="w-5 h-5 text-red-400" />
            <span className="text-2xl font-light text-[#e5e4e2]">
              {product.cost_price.toLocaleString('pl-PL')} zł
            </span>
          </div>
          <p className="text-sm text-[#e5e4e2]/60">Koszt własny</p>
        </div>

        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-5">
          <div className="flex items-center gap-3 mb-2">
            <DollarSign className="w-5 h-5 text-green-400" />
            <span className="text-2xl font-light text-[#e5e4e2]">
              {margin.toFixed(1)}%
            </span>
          </div>
          <p className="text-sm text-[#e5e4e2]/60">Marża</p>
        </div>

        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-5">
          <div className="flex items-center gap-3 mb-2">
            <Package className="w-5 h-5 text-blue-400" />
            <span className="text-2xl font-light text-[#e5e4e2]">
              {totalPrice.toLocaleString('pl-PL')} zł
            </span>
          </div>
          <p className="text-sm text-[#e5e4e2]/60">Cena całkowita</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Basic Info */}
        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <Settings className="w-5 h-5 text-[#d3bb73]" />
            <h2 className="text-lg font-medium text-[#e5e4e2]">Podstawowe informacje</h2>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Nazwa produktu</label>
              <input
                type="text"
                value={product.name}
                onChange={(e) => setProduct({ ...product, name: e.target.value })}
                disabled={!canEdit}
                className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] disabled:opacity-50"
              />
            </div>

            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Kategoria</label>
              <select
                value={product.category_id}
                onChange={(e) => setProduct({ ...product, category_id: e.target.value })}
                disabled={!canEdit}
                className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] disabled:opacity-50"
              >
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Opis</label>
              <textarea
                value={product.description || ''}
                onChange={(e) => setProduct({ ...product, description: e.target.value })}
                disabled={!canEdit}
                className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] min-h-[100px] disabled:opacity-50"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">Jednostka</label>
                <input
                  type="text"
                  value={product.unit}
                  onChange={(e) => setProduct({ ...product, unit: e.target.value })}
                  disabled={!canEdit}
                  placeholder="szt, komplet, dzień"
                  className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] disabled:opacity-50"
                />
              </div>
              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">Min. ilość</label>
                <input
                  type="number"
                  value={product.min_quantity}
                  onChange={(e) => setProduct({ ...product, min_quantity: parseInt(e.target.value) })}
                  disabled={!canEdit}
                  className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] disabled:opacity-50"
                />
              </div>
            </div>

            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={product.is_active}
                  onChange={(e) => setProduct({ ...product, is_active: e.target.checked })}
                  disabled={!canEdit}
                  className="w-4 h-4 rounded border-[#d3bb73]/20 bg-[#0a0d1a] text-[#d3bb73] focus:ring-[#d3bb73] disabled:opacity-50"
                />
                <span className="text-sm text-[#e5e4e2]">Aktywny</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={product.requires_vehicle}
                  onChange={(e) => setProduct({ ...product, requires_vehicle: e.target.checked })}
                  disabled={!canEdit}
                  className="w-4 h-4 rounded border-[#d3bb73]/20 bg-[#0a0d1a] text-[#d3bb73] focus:ring-[#d3bb73] disabled:opacity-50"
                />
                <span className="text-sm text-[#e5e4e2]">Wymaga pojazdu</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={product.requires_driver}
                  onChange={(e) => setProduct({ ...product, requires_driver: e.target.checked })}
                  disabled={!canEdit}
                  className="w-4 h-4 rounded border-[#d3bb73]/20 bg-[#0a0d1a] text-[#d3bb73] focus:ring-[#d3bb73] disabled:opacity-50"
                />
                <span className="text-sm text-[#e5e4e2]">Wymaga kierowcy</span>
              </label>
            </div>
          </div>
        </div>

        {/* Pricing */}
        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <DollarSign className="w-5 h-5 text-[#d3bb73]" />
            <h2 className="text-lg font-medium text-[#e5e4e2]">Ceny i koszty</h2>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Cena bazowa (dla klienta)</label>
              <input
                type="number"
                value={product.base_price}
                onChange={(e) => setProduct({ ...product, base_price: parseFloat(e.target.value) })}
                disabled={!canEdit}
                step="0.01"
                className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] disabled:opacity-50"
              />
            </div>

            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Koszt własny</label>
              <input
                type="number"
                value={product.cost_price}
                onChange={(e) => setProduct({ ...product, cost_price: parseFloat(e.target.value) })}
                disabled={!canEdit}
                step="0.01"
                className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] disabled:opacity-50"
              />
            </div>

            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Koszt transportu</label>
              <input
                type="number"
                value={product.transport_cost}
                onChange={(e) => setProduct({ ...product, transport_cost: parseFloat(e.target.value) })}
                disabled={!canEdit}
                step="0.01"
                className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] disabled:opacity-50"
              />
            </div>

            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Koszt logistyki</label>
              <input
                type="number"
                value={product.logistics_cost}
                onChange={(e) => setProduct({ ...product, logistics_cost: parseFloat(e.target.value) })}
                disabled={!canEdit}
                step="0.01"
                className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] disabled:opacity-50"
              />
            </div>

            <div className="pt-4 border-t border-[#d3bb73]/10">
              <div className="flex justify-between text-sm mb-2">
                <span className="text-[#e5e4e2]/60">Marża:</span>
                <span className={`font-medium ${margin > 50 ? 'text-green-400' : margin > 30 ? 'text-yellow-400' : 'text-red-400'}`}>
                  {margin.toFixed(1)}% ({(product.base_price - product.cost_price).toLocaleString('pl-PL')} zł)
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[#e5e4e2]/60">Całkowity koszt:</span>
                <span className="text-[#e5e4e2]">{totalCost.toLocaleString('pl-PL')} zł</span>
              </div>
              <div className="flex justify-between text-sm mt-1">
                <span className="text-[#e5e4e2]/60">Całkowita cena:</span>
                <span className="text-[#d3bb73] font-medium">{totalPrice.toLocaleString('pl-PL')} zł</span>
              </div>
            </div>
          </div>
        </div>

        {/* Time */}
        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <Truck className="w-5 h-5 text-[#d3bb73]" />
            <h2 className="text-lg font-medium text-[#e5e4e2]">Czas realizacji</h2>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Czas montażu (godz.)</label>
              <input
                type="number"
                value={product.setup_time_hours}
                onChange={(e) => setProduct({ ...product, setup_time_hours: parseFloat(e.target.value) })}
                disabled={!canEdit}
                step="0.5"
                className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] disabled:opacity-50"
              />
            </div>

            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Czas demontażu (godz.)</label>
              <input
                type="number"
                value={product.teardown_time_hours}
                onChange={(e) => setProduct({ ...product, teardown_time_hours: parseFloat(e.target.value) })}
                disabled={!canEdit}
                step="0.5"
                className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] disabled:opacity-50"
              />
            </div>

            <div className="pt-4 border-t border-[#d3bb73]/10">
              <div className="flex justify-between text-sm">
                <span className="text-[#e5e4e2]/60">Całkowity czas:</span>
                <span className="text-[#e5e4e2] font-medium">
                  {(product.setup_time_hours + product.teardown_time_hours).toFixed(1)} godz.
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Tags */}
        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <Tag className="w-5 h-5 text-[#d3bb73]" />
            <h2 className="text-lg font-medium text-[#e5e4e2]">Tagi</h2>
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">Tagi (oddzielone przecinkami)</label>
            <input
              type="text"
              value={product.tags?.join(', ') || ''}
              onChange={(e) => setProduct({ ...product, tags: e.target.value.split(',').map(t => t.trim()).filter(Boolean) })}
              disabled={!canEdit}
              placeholder="dj, wesele, premium"
              className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] disabled:opacity-50"
            />
          </div>

          {product.tags && product.tags.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-4">
              {product.tags.map((tag, idx) => (
                <span key={idx} className="px-3 py-1 bg-[#d3bb73]/20 text-[#d3bb73] rounded-full text-sm">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Equipment */}
      <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Wrench className="w-5 h-5 text-[#d3bb73]" />
            <h2 className="text-lg font-medium text-[#e5e4e2]">Wymagany sprzęt</h2>
          </div>
          {canEdit && (
            <button className="px-3 py-1 bg-[#d3bb73]/20 text-[#d3bb73] rounded-lg hover:bg-[#d3bb73]/30 text-sm">
              + Dodaj sprzęt
            </button>
          )}
        </div>

        {equipment.length === 0 ? (
          <p className="text-[#e5e4e2]/60 text-sm text-center py-8">
            Brak przypisanego sprzętu
          </p>
        ) : (
          <div className="space-y-2">
            {equipment.map((item) => (
              <div key={item.id} className="flex items-center justify-between p-3 bg-[#0a0d1a] rounded-lg">
                <div>
                  <div className="text-[#e5e4e2] font-medium">{item.equipment_item?.name}</div>
                  <div className="text-xs text-[#e5e4e2]/60">{item.equipment_item?.category?.name}</div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-sm text-[#e5e4e2]/80">Ilość: {item.quantity}</span>
                  {item.is_optional && (
                    <span className="px-2 py-1 bg-blue-500/20 text-blue-400 rounded text-xs">Opcjonalny</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Staff */}
      <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-[#d3bb73]" />
            <h2 className="text-lg font-medium text-[#e5e4e2]">Wymagani pracownicy</h2>
          </div>
          {canEdit && (
            <button className="px-3 py-1 bg-[#d3bb73]/20 text-[#d3bb73] rounded-lg hover:bg-[#d3bb73]/30 text-sm">
              + Dodaj rolę
            </button>
          )}
        </div>

        {staff.length === 0 ? (
          <p className="text-[#e5e4e2]/60 text-sm text-center py-8">
            Brak wymagań kadrowych
          </p>
        ) : (
          <div className="space-y-2">
            {staff.map((item) => (
              <div key={item.id} className="flex items-center justify-between p-3 bg-[#0a0d1a] rounded-lg">
                <div>
                  <div className="text-[#e5e4e2] font-medium">{item.role}</div>
                  {item.required_skills && item.required_skills.length > 0 && (
                    <div className="text-xs text-[#e5e4e2]/60">Umiejętności: {item.required_skills.join(', ')}</div>
                  )}
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-[#e5e4e2]/80">Ilość: {item.quantity}</span>
                  {item.hourly_rate && (
                    <span className="text-[#e5e4e2]/80">{item.hourly_rate} zł/h</span>
                  )}
                  {item.estimated_hours && (
                    <span className="text-[#e5e4e2]/80">~{item.estimated_hours}h</span>
                  )}
                  {item.is_optional && (
                    <span className="px-2 py-1 bg-blue-500/20 text-blue-400 rounded text-xs">Opcjonalny</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
