'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, Save, Package, DollarSign, Truck, Users, Wrench, Tag, Settings, X } from 'lucide-react';
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
  vat_rate: number;
  price_net: number;
  price_gross: number;
  cost_net: number;
  cost_gross: number;
  transport_cost_net: number;
  transport_cost_gross: number;
  logistics_cost_net: number;
  logistics_cost_gross: number;
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
    full_path?: string;
  };
}

interface ProductEquipment {
  id: string;
  equipment_item_id: string | null;
  equipment_kit_id: string | null;
  quantity: number;
  is_optional: boolean;
  notes: string;
  equipment_item?: {
    id: string;
    name: string;
    warehouse_category?: {
      name: string;
    };
  };
  equipment_kit?: {
    id: string;
    name: string;
    description: string | null;
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
  payment_type: 'invoice_with_vat' | 'invoice_no_vat' | 'cash_no_receipt';
}

export default function ProductDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { showSnackbar } = useSnackbar();
  const { employee, hasScope, isAdmin } = useCurrentEmployee();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [product, setProduct] = useState<Product | null>(null);
  const [categories, setCategories] = useState<any[]>([]);
  const [equipment, setEquipment] = useState<ProductEquipment[]>([]);
  const [staff, setStaff] = useState<ProductStaff[]>([]);
  const [showAddEquipmentModal, setShowAddEquipmentModal] = useState(false);
  const [showAddStaffModal, setShowAddStaffModal] = useState(false);

  const canEdit = isAdmin || hasScope('offers_manage');

  useEffect(() => {
    if (params.id) {
      if (params.id === 'new') {
        setProduct({
          id: '',
          category_id: '',
          name: '',
          description: '',
          base_price: 0,
          cost_price: 0,
          transport_cost: 0,
          logistics_cost: 0,
          vat_rate: 23,
          price_net: 0,
          price_gross: 0,
          cost_net: 0,
          cost_gross: 0,
          transport_cost_net: 0,
          transport_cost_gross: 0,
          logistics_cost_net: 0,
          logistics_cost_gross: 0,
          setup_time_hours: 0,
          teardown_time_hours: 0,
          unit: 'szt',
          min_quantity: 1,
          max_quantity: null,
          requires_vehicle: false,
          requires_driver: false,
          tags: [],
          is_active: true,
          display_order: 0,
        });
        setLoading(false);
      } else {
        fetchProduct();
        fetchEquipment();
        fetchStaff();
      }
      fetchCategories();
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
        equipment_item:equipment_items(id, name, warehouse_category:warehouse_categories(name)),
        equipment_kit:equipment_kits(id, name, description)
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

  const handleDeleteEquipment = async (equipmentId: string) => {
    try {
      const { error } = await supabase
        .from('offer_product_equipment')
        .delete()
        .eq('id', equipmentId);

      if (error) throw error;

      showSnackbar('Sprzęt usunięty', 'success');
      fetchEquipment();
    } catch (error) {
      console.error('Error deleting equipment:', error);
      showSnackbar('Błąd podczas usuwania sprzętu', 'error');
    }
  };

  const handleUpdateEquipmentQuantity = async (equipmentId: string, quantity: number) => {
    if (quantity < 1) return;

    try {
      const { error } = await supabase
        .from('offer_product_equipment')
        .update({ quantity })
        .eq('id', equipmentId);

      if (error) throw error;

      fetchEquipment();
    } catch (error) {
      console.error('Error updating quantity:', error);
      showSnackbar('Błąd podczas aktualizacji ilości', 'error');
    }
  };

  const handleSave = async () => {
    if (!product || !canEdit) return;

    try {
      setSaving(true);

      const productData = {
        category_id: product.category_id || null,
        name: product.name,
        description: product.description,
        vat_rate: product.vat_rate,
        price_net: product.price_net,
        price_gross: product.price_gross,
        cost_net: product.cost_net,
        cost_gross: product.cost_gross,
        transport_cost_net: product.transport_cost_net,
        transport_cost_gross: product.transport_cost_gross,
        logistics_cost_net: product.logistics_cost_net,
        logistics_cost_gross: product.logistics_cost_gross,
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
      };

      if (params.id === 'new') {
        const { data, error } = await supabase
          .from('offer_products')
          .insert(productData)
          .select()
          .single();

        if (error) throw error;
        showSnackbar('Produkt został dodany', 'success');
        router.push(`/crm/offers/products/${data.id}`);
      } else {
        const { error } = await supabase
          .from('offer_products')
          .update(productData)
          .eq('id', product.id);

        if (error) throw error;
        showSnackbar('Zapisano zmiany', 'success');
        fetchProduct();
      }
    } catch (err: any) {
      showSnackbar(err.message || 'Błąd zapisywania', 'error');
    } finally {
      setSaving(false);
    }
  };

  const updateNetPrice = (net: number) => {
    if (!product) return;
    const gross = net * (1 + product.vat_rate / 100);
    setProduct({ ...product, price_net: net, price_gross: gross });
  };

  const updateGrossPrice = (gross: number) => {
    if (!product) return;
    const net = gross / (1 + product.vat_rate / 100);
    setProduct({ ...product, price_net: net, price_gross: gross });
  };

  const updateNetCost = (net: number) => {
    if (!product) return;
    const gross = net * (1 + product.vat_rate / 100);
    setProduct({ ...product, cost_net: net, cost_gross: gross });
  };

  const updateGrossCost = (gross: number) => {
    if (!product) return;
    const net = gross / (1 + product.vat_rate / 100);
    setProduct({ ...product, cost_net: net, cost_gross: gross });
  };

  // Fallback dla starych danych (przed migracją VAT)
  const priceNet = product?.price_net ?? product?.base_price ?? 0;
  const priceGross = product?.price_gross ?? (priceNet * 1.23) ?? 0;
  const costNet = product?.cost_net ?? product?.cost_price ?? 0;
  const costGross = product?.cost_gross ?? (costNet * 1.23) ?? 0;
  const transportNet = product?.transport_cost_net ?? product?.transport_cost ?? 0;
  const transportGross = product?.transport_cost_gross ?? (transportNet * 1.23) ?? 0;
  const logisticsNet = product?.logistics_cost_net ?? product?.logistics_cost ?? 0;
  const logisticsGross = product?.logistics_cost_gross ?? (logisticsNet * 1.23) ?? 0;
  const vatRate = product?.vat_rate ?? 23;

  const margin = priceNet > 0 ? ((priceNet - costNet) / priceNet) * 100 : 0;
  const totalCostNet = costNet + transportNet + logisticsNet;
  const totalCostGross = costGross + transportGross + logisticsGross;
  const totalPriceNet = priceNet + transportNet + logisticsNet;
  const totalPriceGross = priceGross + transportGross + logisticsGross;

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
            <h1 className="text-2xl font-light text-[#e5e4e2]">
              {params.id === 'new' ? 'Nowy produkt' : product.name}
            </h1>
            {params.id !== 'new' && (
              <p className="text-sm text-[#e5e4e2]/60 mt-1">
                {product.category?.name}
              </p>
            )}
          </div>
        </div>
        {canEdit && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg hover:bg-[#d3bb73]/90 disabled:opacity-50 transition-colors"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Zapisywanie...' : params.id === 'new' ? 'Dodaj produkt' : 'Zapisz zmiany'}
          </button>
        )}
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-5">
          <div className="flex items-center gap-3 mb-2">
            <DollarSign className="w-5 h-5 text-[#d3bb73]" />
            <div>
              <div className="text-2xl font-light text-[#e5e4e2]">
                {priceNet.toLocaleString('pl-PL')} zł
              </div>
              <div className="text-xs text-[#e5e4e2]/40">
                brutto: {priceGross.toLocaleString('pl-PL')} zł
              </div>
            </div>
          </div>
          <p className="text-sm text-[#e5e4e2]/60">Cena netto</p>
        </div>

        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-5">
          <div className="flex items-center gap-3 mb-2">
            <DollarSign className="w-5 h-5 text-red-400" />
            <div>
              <div className="text-2xl font-light text-[#e5e4e2]">
                {costNet.toLocaleString('pl-PL')} zł
              </div>
              <div className="text-xs text-[#e5e4e2]/40">
                brutto: {costGross.toLocaleString('pl-PL')} zł
              </div>
            </div>
          </div>
          <p className="text-sm text-[#e5e4e2]/60">Koszt netto</p>
        </div>

        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-5">
          <div className="flex items-center gap-3 mb-2">
            <DollarSign className="w-5 h-5 text-green-400" />
            <div>
              <div className="text-2xl font-light text-[#e5e4e2]">
                {margin.toFixed(1)}%
              </div>
              <div className="text-xs text-[#e5e4e2]/40">
                {(priceNet - costNet).toLocaleString('pl-PL')} zł netto
              </div>
            </div>
          </div>
          <p className="text-sm text-[#e5e4e2]/60">Marża</p>
        </div>

        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-5">
          <div className="flex items-center gap-3 mb-2">
            <Package className="w-5 h-5 text-blue-400" />
            <div>
              <div className="text-2xl font-light text-[#e5e4e2]">
                {totalPriceNet.toLocaleString('pl-PL')} zł
              </div>
              <div className="text-xs text-[#e5e4e2]/40">
                brutto: {totalPriceGross.toLocaleString('pl-PL')} zł
              </div>
            </div>
          </div>
          <p className="text-sm text-[#e5e4e2]/60">Cena całkowita netto</p>
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
            <h2 className="text-lg font-medium text-[#e5e4e2]">Ceny i koszty (netto/brutto)</h2>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Stawka VAT (%)</label>
              <input
                type="number"
                value={vatRate}
                onChange={(e) => {
                  const newVat = parseFloat(e.target.value);
                  setProduct({
                    ...product,
                    vat_rate: newVat,
                    price_gross: priceNet * (1 + newVat / 100),
                    cost_gross: costNet * (1 + newVat / 100),
                    transport_cost_gross: transportNet * (1 + newVat / 100),
                    logistics_cost_gross: logisticsNet * (1 + newVat / 100),
                  });
                }}
                disabled={!canEdit}
                step="0.01"
                className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] disabled:opacity-50"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">Cena netto</label>
                <input
                  type="number"
                  value={priceNet}
                  onChange={(e) => updateNetPrice(parseFloat(e.target.value))}
                  disabled={!canEdit}
                  step="0.01"
                  className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] disabled:opacity-50"
                />
              </div>
              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">Cena brutto</label>
                <input
                  type="number"
                  value={priceGross}
                  onChange={(e) => updateGrossPrice(parseFloat(e.target.value))}
                  disabled={!canEdit}
                  step="0.01"
                  className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] disabled:opacity-50"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">Koszt netto</label>
                <input
                  type="number"
                  value={costNet}
                  onChange={(e) => updateNetCost(parseFloat(e.target.value))}
                  disabled={!canEdit}
                  step="0.01"
                  className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] disabled:opacity-50"
                />
              </div>
              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">Koszt brutto</label>
                <input
                  type="number"
                  value={costGross}
                  onChange={(e) => updateGrossCost(parseFloat(e.target.value))}
                  disabled={!canEdit}
                  step="0.01"
                  className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] disabled:opacity-50"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">Transport netto</label>
                <input
                  type="number"
                  value={transportNet}
                  onChange={(e) => {
                    const net = parseFloat(e.target.value);
                    setProduct({
                      ...product,
                      transport_cost_net: net,
                      transport_cost_gross: net * (1 + vatRate / 100),
                    });
                  }}
                  disabled={!canEdit}
                  step="0.01"
                  className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] disabled:opacity-50"
                />
              </div>
              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">Logistyka netto</label>
                <input
                  type="number"
                  value={logisticsNet}
                  onChange={(e) => {
                    const net = parseFloat(e.target.value);
                    setProduct({
                      ...product,
                      logistics_cost_net: net,
                      logistics_cost_gross: net * (1 + vatRate / 100),
                    });
                  }}
                  disabled={!canEdit}
                  step="0.01"
                  className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] disabled:opacity-50"
                />
              </div>
            </div>

            <div className="pt-4 border-t border-[#d3bb73]/10 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-[#e5e4e2]/60">Marża:</span>
                <span className={`font-medium ${margin > 50 ? 'text-green-400' : margin > 30 ? 'text-yellow-400' : 'text-red-400'}`}>
                  {margin.toFixed(1)}% ({(priceNet - costNet).toLocaleString('pl-PL')} zł netto)
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[#e5e4e2]/60">Całkowity koszt:</span>
                <span className="text-[#e5e4e2]">{totalCostNet.toLocaleString('pl-PL')} zł netto / {totalCostGross.toLocaleString('pl-PL')} zł brutto</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[#e5e4e2]/60">Całkowita cena:</span>
                <span className="text-[#d3bb73] font-medium">{totalPriceNet.toLocaleString('pl-PL')} zł netto / {totalPriceGross.toLocaleString('pl-PL')} zł brutto</span>
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
      {params.id !== 'new' && (
      <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Wrench className="w-5 h-5 text-[#d3bb73]" />
            <h2 className="text-lg font-medium text-[#e5e4e2]">Wymagany sprzęt</h2>
          </div>
          {canEdit && (
            <button
              onClick={() => setShowAddEquipmentModal(true)}
              className="px-3 py-1 bg-[#d3bb73]/20 text-[#d3bb73] rounded-lg hover:bg-[#d3bb73]/30 text-sm"
            >
              + Dodaj sprzęt / pakiet
            </button>
          )}
        </div>

        {equipment.length === 0 ? (
          <p className="text-[#e5e4e2]/60 text-sm text-center py-8">
            Brak przypisanego sprzętu
          </p>
        ) : (
          <div className="space-y-3">
            {equipment.map((item) => (
              <div key={item.id} className="bg-[#0a0d1a] rounded-lg overflow-hidden">
                <div className="flex items-center justify-between p-3">
                  <div className="flex-1">
                    {item.equipment_kit ? (
                      <div>
                        <div className="flex items-center gap-2">
                          <Package className="w-4 h-4 text-[#d3bb73]" />
                          <div className="text-[#e5e4e2] font-medium">{item.equipment_kit.name}</div>
                        </div>
                        {item.equipment_kit.description && (
                          <div className="text-xs text-[#e5e4e2]/60 mt-1 ml-6">{item.equipment_kit.description}</div>
                        )}
                        <div className="text-xs text-[#d3bb73]/80 mt-1 ml-6">Pakiet sprzętu</div>
                      </div>
                    ) : (
                      <div>
                        <div className="text-[#e5e4e2] font-medium">{item.equipment_item?.name}</div>
                        <div className="text-xs text-[#e5e4e2]/60">{item.equipment_item?.warehouse_category?.name}</div>
                      </div>
                    )}
                    {item.notes && (
                      <div className="text-xs text-[#e5e4e2]/50 mt-1 italic">{item.notes}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-4">
                    {canEdit ? (
                      <div className="flex items-center gap-2">
                        <label className="text-sm text-[#e5e4e2]/60">Ilość:</label>
                        <input
                          type="number"
                          value={item.quantity}
                          onChange={(e) => handleUpdateEquipmentQuantity(item.id, parseInt(e.target.value) || 1)}
                          min="1"
                          className="w-20 px-2 py-1 bg-[#1c1f33] border border-[#d3bb73]/20 rounded text-[#e5e4e2] text-sm focus:outline-none focus:border-[#d3bb73]"
                        />
                      </div>
                    ) : (
                      <span className="text-sm text-[#e5e4e2]/80">Ilość: {item.quantity}</span>
                    )}
                    {item.is_optional && (
                      <span className="px-2 py-1 bg-blue-500/20 text-blue-400 rounded text-xs">Opcjonalny</span>
                    )}
                    {canEdit && (
                      <button
                        onClick={() => handleDeleteEquipment(item.id)}
                        className="text-red-400 hover:text-red-300 text-xs"
                      >
                        Usuń
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      )}

      {/* Staff */}
      {params.id !== 'new' && (
      <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-[#d3bb73]" />
            <h2 className="text-lg font-medium text-[#e5e4e2]">Wymagani pracownicy</h2>
          </div>
          {canEdit && (
            <button
              onClick={() => setShowAddStaffModal(true)}
              className="px-3 py-1 bg-[#d3bb73]/20 text-[#d3bb73] rounded-lg hover:bg-[#d3bb73]/30 text-sm"
            >
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
      )}

      {/* Add Equipment/Kit Modal */}
      {showAddEquipmentModal && (
        <AddEquipmentModal
          productId={params.id as string}
          existingEquipment={equipment}
          onClose={() => setShowAddEquipmentModal(false)}
          onSuccess={() => {
            fetchEquipment();
            setShowAddEquipmentModal(false);
          }}
        />
      )}

      {/* Add Staff Modal */}
      {showAddStaffModal && (
        <AddStaffModal
          productId={params.id as string}
          onClose={() => setShowAddStaffModal(false)}
          onSuccess={() => {
            fetchStaff();
            setShowAddStaffModal(false);
          }}
        />
      )}
    </div>
  );
}

function AddEquipmentModal({
  productId,
  existingEquipment,
  onClose,
  onSuccess
}: {
  productId: string;
  existingEquipment: ProductEquipment[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [mode, setMode] = useState<'item' | 'kit'>('kit');
  const [selectedItemId, setSelectedItemId] = useState('');
  const [selectedKitId, setSelectedKitId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [isOptional, setIsOptional] = useState(false);
  const [notes, setNotes] = useState('');
  const [equipmentItems, setEquipmentItems] = useState<any[]>([]);
  const [filteredItems, setFilteredItems] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [kits, setKits] = useState<any[]>([]);
  const [kitDetails, setKitDetails] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const { showSnackbar } = useSnackbar();

  useEffect(() => {
    fetchEquipmentItems();
    fetchKits();
  }, []);

  useEffect(() => {
    if (selectedKitId) {
      fetchKitDetails(selectedKitId);
    } else {
      setKitDetails(null);
    }
  }, [selectedKitId]);

  useEffect(() => {
    if (searchQuery) {
      const filtered = equipmentItems.filter(item =>
        item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.brand?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.model?.toLowerCase().includes(searchQuery.toLowerCase())
      );
      setFilteredItems(filtered);
    } else {
      setFilteredItems(equipmentItems);
    }
  }, [searchQuery, equipmentItems]);

  const fetchEquipmentItems = async () => {
    const { data } = await supabase
      .from('equipment_items')
      .select('id, name, brand, model, warehouse_categories(name)')
      .eq('is_active', true)
      .order('name');

    if (data) {
      const existingItemIds = existingEquipment
        .filter(e => e.equipment_item_id)
        .map(e => e.equipment_item_id);

      const availableItems = data.filter(item => !existingItemIds.includes(item.id));

      const itemsWithAvailability = await Promise.all(
        availableItems.map(async (item) => {
          const { data: availData } = await supabase.rpc('get_available_equipment_quantity', {
            p_equipment_id: item.id
          });
          return {
            ...item,
            available_quantity: availData || 0
          };
        })
      );
      setEquipmentItems(itemsWithAvailability);
      setFilteredItems(itemsWithAvailability);
    }
  };

  const fetchKits = async () => {
    const { data } = await supabase
      .from('equipment_kits')
      .select('id, name, description')
      .eq('is_active', true)
      .order('name');

    if (data) {
      const existingKitIds = existingEquipment
        .filter(e => e.equipment_kit_id)
        .map(e => e.equipment_kit_id);

      const availableKits = data.filter(kit => !existingKitIds.includes(kit.id));
      setKits(availableKits);
    }
  };

  const fetchKitDetails = async (kitId: string) => {
    const { data } = await supabase
      .from('equipment_kit_items')
      .select(`
        quantity,
        equipment:equipment_items(name, brand, model)
      `)
      .eq('kit_id', kitId)
      .order('order_index');
    if (data) setKitDetails(data);
  };

  const handleSubmit = async () => {
    if (mode === 'item' && !selectedItemId) {
      showSnackbar('Wybierz sprzęt', 'error');
      return;
    }
    if (mode === 'kit' && !selectedKitId) {
      showSnackbar('Wybierz pakiet', 'error');
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase
        .from('offer_product_equipment')
        .insert({
          product_id: productId,
          equipment_item_id: mode === 'item' ? selectedItemId : null,
          equipment_kit_id: mode === 'kit' ? selectedKitId : null,
          quantity,
          is_optional: isOptional,
          notes: notes || null,
        });

      if (error) throw error;

      showSnackbar(mode === 'kit' ? 'Pakiet dodany' : 'Sprzęt dodany', 'success');
      onSuccess();
    } catch (error) {
      console.error('Error adding equipment:', error);
      showSnackbar('Błąd podczas dodawania', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-[#d3bb73]/10 flex items-center justify-between sticky top-0 bg-[#1c1f33] z-10">
          <h3 className="text-xl font-light text-[#e5e4e2]">Dodaj sprzęt do produktu</h3>
          <button onClick={onClose} className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Mode selection */}
          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-3">Wybierz typ</label>
            <div className="flex gap-3">
              <button
                onClick={() => setMode('kit')}
                className={`flex-1 px-4 py-3 rounded-lg border transition-colors ${
                  mode === 'kit'
                    ? 'bg-[#d3bb73]/20 border-[#d3bb73] text-[#d3bb73]'
                    : 'bg-[#0a0d1a] border-[#d3bb73]/10 text-[#e5e4e2]/60 hover:border-[#d3bb73]/30'
                }`}
              >
                <Package className="w-5 h-5 mx-auto mb-1" />
                <div className="text-sm font-medium">Pakiet sprzętu</div>
                <div className="text-xs opacity-60">Zestaw gotowych itemów</div>
              </button>
              <button
                onClick={() => setMode('item')}
                className={`flex-1 px-4 py-3 rounded-lg border transition-colors ${
                  mode === 'item'
                    ? 'bg-[#d3bb73]/20 border-[#d3bb73] text-[#d3bb73]'
                    : 'bg-[#0a0d1a] border-[#d3bb73]/10 text-[#e5e4e2]/60 hover:border-[#d3bb73]/30'
                }`}
              >
                <Wrench className="w-5 h-5 mx-auto mb-1" />
                <div className="text-sm font-medium">Pojedynczy sprzęt</div>
                <div className="text-xs opacity-60">Wybierz jeden item</div>
              </button>
            </div>
          </div>

          {/* Kit selection */}
          {mode === 'kit' && (
            <>
              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">Wybierz pakiet *</label>
                <select
                  value={selectedKitId}
                  onChange={(e) => setSelectedKitId(e.target.value)}
                  className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                >
                  <option value="">-- Wybierz pakiet --</option>
                  {kits.map((kit) => (
                    <option key={kit.id} value={kit.id}>
                      {kit.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Kit details preview */}
              {kitDetails && kitDetails.length > 0 && (
                <div className="bg-[#0a0d1a] border border-[#d3bb73]/10 rounded-lg p-4">
                  <div className="text-sm text-[#e5e4e2]/60 mb-2">Zawartość pakietu:</div>
                  <div className="space-y-1">
                    {kitDetails.map((item: any, idx: number) => (
                      <div key={idx} className="text-sm text-[#e5e4e2] flex items-center gap-2">
                        <span className="text-[#d3bb73]">•</span>
                        <span>{item.quantity}x {item.equipment?.name}</span>
                        {item.equipment?.model && (
                          <span className="text-[#e5e4e2]/60 text-xs">({item.equipment.model})</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Item selection */}
          {mode === 'item' && (
            <>
              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">Wyszukaj sprzęt</label>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Szukaj po nazwie, marce lub modelu..."
                  className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] placeholder:text-[#e5e4e2]/40"
                />
              </div>

              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">Wybierz sprzęt * ({filteredItems.length} wyników)</label>
                <div className="max-h-60 overflow-y-auto bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg">
                  {filteredItems.length === 0 ? (
                    <div className="p-4 text-center text-[#e5e4e2]/60 text-sm">
                      Brak wyników wyszukiwania
                    </div>
                  ) : (
                    filteredItems.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setSelectedItemId(item.id)}
                        disabled={item.available_quantity === 0}
                        className={`w-full text-left px-4 py-3 border-b border-[#d3bb73]/10 transition-colors ${
                          selectedItemId === item.id
                            ? 'bg-[#d3bb73]/20'
                            : item.available_quantity === 0
                            ? 'opacity-50 cursor-not-allowed'
                            : 'hover:bg-[#d3bb73]/10'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="text-[#e5e4e2] font-medium">{item.name}</div>
                          <div className={`text-xs px-2 py-0.5 rounded ${
                            item.available_quantity === 0
                              ? 'bg-red-500/20 text-red-400'
                              : item.available_quantity < 5
                              ? 'bg-yellow-500/20 text-yellow-400'
                              : 'bg-green-500/20 text-green-400'
                          }`}>
                            {item.available_quantity === 0 ? 'Brak' : `${item.available_quantity} szt.`}
                          </div>
                        </div>
                        <div className="text-xs text-[#e5e4e2]/60 mt-1">
                          {item.brand && <span>{item.brand} </span>}
                          {item.model && <span>• {item.model} </span>}
                          {item.warehouse_categories?.name && <span>• {item.warehouse_categories.name}</span>}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </>
          )}

          {/* Quantity */}
          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">
              Ilość
              {mode === 'item' && selectedItemId && (() => {
                const selected = equipmentItems.find(item => item.id === selectedItemId);
                return selected && (
                  <span className="ml-2 text-xs">
                    (dostępne: <span className={selected.available_quantity < 5 ? 'text-yellow-400' : 'text-green-400'}>
                      {selected.available_quantity} szt.
                    </span>)
                  </span>
                );
              })()}
            </label>
            <input
              type="number"
              min="1"
              max={mode === 'item' && selectedItemId ? equipmentItems.find(item => item.id === selectedItemId)?.available_quantity : undefined}
              value={quantity}
              onChange={(e) => {
                const val = parseInt(e.target.value) || 1;
                if (mode === 'item' && selectedItemId) {
                  const selected = equipmentItems.find(item => item.id === selectedItemId);
                  if (selected) {
                    setQuantity(Math.min(val, selected.available_quantity));
                  } else {
                    setQuantity(val);
                  }
                } else {
                  setQuantity(val);
                }
              }}
              className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
            />
            {mode === 'item' && selectedItemId && (() => {
              const selected = equipmentItems.find(item => item.id === selectedItemId);
              return selected && selected.available_quantity < 10 && (
                <p className="text-xs text-yellow-400 mt-1">
                  ⚠️ Niska dostępność - dostępne tylko {selected.available_quantity} szt.
                </p>
              );
            })()}
          </div>

          {/* Optional */}
          <div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isOptional}
                onChange={(e) => setIsOptional(e.target.checked)}
                className="w-4 h-4 rounded border-[#d3bb73]/20 bg-[#0a0d1a] text-[#d3bb73] focus:ring-[#d3bb73]"
              />
              <span className="text-sm text-[#e5e4e2]">Opcjonalny (można usunąć z oferty)</span>
            </label>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">Notatki (opcjonalnie)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Dodatkowe informacje..."
              className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
            />
          </div>
        </div>

        <div className="p-6 border-t border-[#d3bb73]/10 flex gap-3 justify-end sticky bottom-0 bg-[#1c1f33]">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-[#e5e4e2]/10 text-[#e5e4e2] rounded-lg hover:bg-[#e5e4e2]/20 transition-colors"
          >
            Anuluj
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || (mode === 'item' ? !selectedItemId : !selectedKitId)}
            className="px-6 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg font-medium hover:bg-[#d3bb73]/90 transition-colors disabled:opacity-50"
          >
            {loading ? 'Dodawanie...' : 'Dodaj'}
          </button>
        </div>
      </div>
    </div>
  );
}

function AddStaffModal({ productId, onClose, onSuccess }: { productId: string; onClose: () => void; onSuccess: () => void }) {
  const [role, setRole] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [hourlyRate, setHourlyRate] = useState('');
  const [estimatedHours, setEstimatedHours] = useState('');
  const [isOptional, setIsOptional] = useState(false);
  const [notes, setNotes] = useState('');
  const [skills, setSkills] = useState<any[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<Array<{skill_id: string, minimum_proficiency: string}>>([]);
  const [loading, setLoading] = useState(false);
  const { showSnackbar } = useSnackbar();

  useEffect(() => {
    fetchSkills();
  }, []);

  const fetchSkills = async () => {
    const { data } = await supabase
      .from('skills')
      .select('id, name, skill_categories(name)')
      .eq('is_active', true)
      .order('name');
    if (data) setSkills(data);
  };

  const toggleSkill = (skillId: string) => {
    const exists = selectedSkills.find(s => s.skill_id === skillId);
    if (exists) {
      setSelectedSkills(selectedSkills.filter(s => s.skill_id !== skillId));
    } else {
      setSelectedSkills([...selectedSkills, { skill_id: skillId, minimum_proficiency: 'basic' }]);
    }
  };

  const updateSkillLevel = (skillId: string, level: string) => {
    setSelectedSkills(selectedSkills.map(s =>
      s.skill_id === skillId ? { ...s, minimum_proficiency: level } : s
    ));
  };

  const handleSubmit = async () => {
    if (!role) {
      showSnackbar('Podaj nazwę roli', 'error');
      return;
    }

    setLoading(true);
    try {
      const { data: staffData, error: staffError } = await supabase
        .from('offer_product_staff')
        .insert({
          product_id: productId,
          role,
          quantity,
          hourly_rate: hourlyRate ? parseFloat(hourlyRate) : null,
          estimated_hours: estimatedHours ? parseFloat(estimatedHours) : null,
          is_optional: isOptional,
          notes: notes || null,
        })
        .select()
        .single();

      if (staffError) throw staffError;

      if (selectedSkills.length > 0) {
        const skillsToInsert = selectedSkills.map(s => ({
          staff_requirement_id: staffData.id,
          skill_id: s.skill_id,
          minimum_proficiency: s.minimum_proficiency,
          is_required: true,
        }));

        const { error: skillsError } = await supabase
          .from('offer_product_staff_skills')
          .insert(skillsToInsert);

        if (skillsError) throw skillsError;
      }

      showSnackbar('Rola dodana', 'success');
      onSuccess();
    } catch (error) {
      console.error('Error adding staff:', error);
      showSnackbar('Błąd podczas dodawania roli', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-[#d3bb73]/10 flex items-center justify-between sticky top-0 bg-[#1c1f33] z-10">
          <h3 className="text-xl font-light text-[#e5e4e2]">Dodaj wymagania kadrowe</h3>
          <button onClick={onClose} className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">Nazwa roli *</label>
            <input
              type="text"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="np. Realizator dźwięku, Operator świateł..."
              className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Ilość osób</label>
              <input
                type="number"
                min="1"
                value={quantity}
                onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
                className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
              />
            </div>
            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Stawka godzinowa (zł)</label>
              <input
                type="number"
                step="0.01"
                value={hourlyRate}
                onChange={(e) => setHourlyRate(e.target.value)}
                placeholder="opcjonalne"
                className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
              />
            </div>
            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Szacowane godziny</label>
              <input
                type="number"
                step="0.5"
                value={estimatedHours}
                onChange={(e) => setEstimatedHours(e.target.value)}
                placeholder="opcjonalne"
                className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-3">Wymagane umiejętności</label>
            <div className="max-h-60 overflow-y-auto bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg divide-y divide-[#d3bb73]/10">
              {skills.map((skill) => {
                const selected = selectedSkills.find(s => s.skill_id === skill.id);
                return (
                  <div key={skill.id} className="p-3">
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={!!selected}
                        onChange={() => toggleSkill(skill.id)}
                        className="w-4 h-4 rounded border-[#d3bb73]/20 bg-[#0a0d1a] text-[#d3bb73] focus:ring-[#d3bb73]"
                      />
                      <div className="flex-1">
                        <div className="text-[#e5e4e2] text-sm">{skill.name}</div>
                        <div className="text-xs text-[#e5e4e2]/60">{skill.skill_categories?.name}</div>
                      </div>
                      {selected && (
                        <select
                          value={selected.minimum_proficiency}
                          onChange={(e) => updateSkillLevel(skill.id, e.target.value)}
                          className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded px-2 py-1 text-xs text-[#e5e4e2]"
                        >
                          <option value="basic">Podstawowy</option>
                          <option value="intermediate">Średniozaawansowany</option>
                          <option value="advanced">Zaawansowany</option>
                          <option value="expert">Ekspert</option>
                        </select>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {selectedSkills.length > 0 && (
              <p className="text-xs text-[#d3bb73] mt-2">
                Wybrano {selectedSkills.length} umiejętności
              </p>
            )}
          </div>

          <div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isOptional}
                onChange={(e) => setIsOptional(e.target.checked)}
                className="w-4 h-4 rounded border-[#d3bb73]/20 bg-[#0a0d1a] text-[#d3bb73] focus:ring-[#d3bb73]"
              />
              <span className="text-sm text-[#e5e4e2]">Opcjonalny (można usunąć z oferty)</span>
            </label>
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">Notatki (opcjonalnie)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Dodatkowe informacje..."
              className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
            />
          </div>
        </div>

        <div className="p-6 border-t border-[#d3bb73]/10 flex gap-3 justify-end sticky bottom-0 bg-[#1c1f33]">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-[#e5e4e2]/10 text-[#e5e4e2] rounded-lg hover:bg-[#e5e4e2]/20 transition-colors"
          >
            Anuluj
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || !role}
            className="px-6 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg font-medium hover:bg-[#d3bb73]/90 transition-colors disabled:opacity-50"
          >
            {loading ? 'Dodawanie...' : 'Dodaj'}
          </button>
        </div>
      </div>
    </div>
  );
}
