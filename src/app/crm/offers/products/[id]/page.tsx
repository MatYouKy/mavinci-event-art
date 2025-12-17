'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
  ArrowLeft,
  Save,
  Package,
  DollarSign,
  Truck,
  Users,
  Wrench,
  Tag,
  Settings,
  X,
  Trash2,
  FileText,
  Upload,
  Eye,
  Loader2,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { IEventCategory } from '@/app/crm/event-categories/types';
import { useEventCategories } from '@/app/crm/event-categories/hook/useEventCategories';
import { ProductEquipment } from '../components/ProductEquipment';
import { ProductStaffSection } from '../components/ProductStuffSection';
import { AddEquipmentModal } from '../modal/AddEquipmentModal';
import { useManageProduct } from '../hooks/useManageProduct';

interface IProduct {
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
  pdf_page_url?: string | null;
  pdf_thumbnail_url?: string | null;
  category?: IEventCategory;
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
  console.log(params);
  const { showSnackbar } = useSnackbar();
  const { hasScope, isAdmin } = useCurrentEmployee();
  const { categories, isLoading: isLoadingCategories } = useEventCategories();
  const { items, isLoading, isFetching, remove } = useManageProduct({
    productId: params.id as string,
  });

  console.log('items', items);
  console.log('isLoading', isLoading);
  console.log('isFetching', isFetching);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [product, setProduct] = useState<IProduct | null>(null);

  const [showAddEquipmentModal, setShowAddEquipmentModal] = useState(false);
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [uploadingThumbnail, setUploadingThumbnail] = useState(false);
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [draftStaff, setDraftStaff] = useState<any[]>([]);

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
      }
    }
  }, [params.id]);

  const fetchProduct = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('offer_products')
        .select(
          `
          *,
          category:offer_product_categories(id, name)
        `,
        )
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

  const handleUploadPdf = async () => {
    if (!pdfFile || !product || params.id === 'new') return;

    if (pdfFile.type !== 'application/pdf') {
      showSnackbar('Tylko pliki PDF są dozwolone', 'error');
      return;
    }

    try {
      setUploadingPdf(true);

      const fileExt = 'pdf';
      const fileName = `${product.id}.${fileExt}`;
      const filePath = `${fileName}`;

      if (product.pdf_page_url) {
        const oldPath = product.pdf_page_url.split('/').pop();
        if (oldPath) {
          await supabase.storage.from('offer-product-pages').remove([oldPath]);
        }
      }

      const { error: uploadError } = await supabase.storage
        .from('offer-product-pages')
        .upload(filePath, pdfFile, {
          upsert: true,
          contentType: 'application/pdf',
        });

      if (uploadError) throw uploadError;

      const {
        data: { publicUrl },
      } = supabase.storage.from('offer-product-pages').getPublicUrl(filePath);

      const { error: updateError } = await supabase
        .from('offer_products')
        .update({ pdf_page_url: filePath })
        .eq('id', product.id);

      if (updateError) throw updateError;

      showSnackbar('Strona PDF została przesłana', 'success');
      setPdfFile(null);
      fetchProduct();
    } catch (err: any) {
      showSnackbar(err.message || 'Błąd przesyłania pliku', 'error');
    } finally {
      setUploadingPdf(false);
    }
  };

  const handleUploadThumbnail = async () => {
    if (!thumbnailFile || !product || params.id === 'new') return;

    if (!thumbnailFile.type.startsWith('image/')) {
      showSnackbar('Tylko pliki graficzne są dozwolone', 'error');
      return;
    }

    try {
      setUploadingThumbnail(true);

      const fileExt = thumbnailFile.name.split('.').pop();
      const fileName = `${product.id}-thumbnail.${fileExt}`;
      const filePath = `thumbnails/${fileName}`;

      if (product.pdf_thumbnail_url) {
        const oldPath = product.pdf_thumbnail_url;
        await supabase.storage.from('offer-product-pages').remove([oldPath]);
      }

      const { error: uploadError } = await supabase.storage
        .from('offer-product-pages')
        .upload(filePath, thumbnailFile, {
          upsert: true,
          contentType: thumbnailFile.type,
        });

      if (uploadError) throw uploadError;

      const { error: updateError } = await supabase
        .from('offer_products')
        .update({ pdf_thumbnail_url: filePath })
        .eq('id', product.id);

      if (updateError) throw updateError;

      showSnackbar('Miniaturka została przesłana', 'success');
      setThumbnailFile(null);
      fetchProduct();
    } catch (err: any) {
      showSnackbar(err.message || 'Błąd przesyłania miniaturki', 'error');
    } finally {
      setUploadingThumbnail(false);
    }
  };

  const handleDeleteThumbnail = async () => {
    if (!product || !product.pdf_thumbnail_url || params.id === 'new') return;

    if (!confirm('Czy na pewno chcesz usunąć miniaturkę?')) {
      return;
    }

    try {
      const { error: storageError } = await supabase.storage
        .from('offer-product-pages')
        .remove([product.pdf_thumbnail_url]);

      if (storageError) throw storageError;

      const { error: updateError } = await supabase
        .from('offer_products')
        .update({ pdf_thumbnail_url: null })
        .eq('id', product.id);

      if (updateError) throw updateError;

      showSnackbar('Miniaturka została usunięta', 'success');
      fetchProduct();
    } catch (err: any) {
      showSnackbar(err.message || 'Błąd usuwania miniaturki', 'error');
    }
  };

  const handleDeletePdf = async () => {
    if (!product || !product.pdf_page_url || params.id === 'new') return;

    if (!confirm('Czy na pewno chcesz usunąć stronę PDF tego produktu?')) {
      return;
    }

    try {
      const { error: storageError } = await supabase.storage
        .from('offer-product-pages')
        .remove([product.pdf_page_url]);

      if (storageError) throw storageError;

      const { error: updateError } = await supabase
        .from('offer_products')
        .update({ pdf_page_url: null })
        .eq('id', product.id);

      if (updateError) throw updateError;

      showSnackbar('Strona PDF została usunięta', 'success');
      fetchProduct();
    } catch (err: any) {
      showSnackbar(err.message || 'Błąd usuwania pliku', 'error');
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

  const handleDelete = async () => {
    if (!product || !canEdit || params.id === 'new') return;

    if (
      !confirm(
        `Czy na pewno chcesz usunąć produkt "${product.name}"?\n\nTa operacja jest nieodwracalna.`,
      )
    ) {
      return;
    }

    try {
      setSaving(true);

      const { error } = await supabase.from('offer_products').delete().eq('id', product.id);

      if (error) throw error;

      showSnackbar('Produkt został usunięty', 'success');
      router.push('/crm/offers?tab=catalog');
    } catch (err: any) {
      showSnackbar(err.message || 'Błąd usuwania produktu', 'error');
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
  const priceGross =
    product?.price_gross !== undefined && product?.price_gross !== null
      ? product.price_gross
      : priceNet * (1 + (product?.vat_rate ?? 0) / 100);

  const costNet = product?.cost_net ?? product?.cost_price ?? 0;
  const costGross =
    product?.cost_gross !== undefined && product?.cost_gross !== null
      ? product.cost_gross
      : costNet * (1 + (product?.vat_rate ?? 0) / 100);

  const transportNet = product?.transport_cost_net ?? product?.transport_cost ?? 0;
  const transportGross =
    product?.transport_cost_gross !== undefined && product?.transport_cost_gross !== null
      ? product.transport_cost_gross
      : transportNet * (1 + (product?.vat_rate ?? 0) / 100);
  const logisticsNet = product?.logistics_cost_net ?? product?.logistics_cost ?? 0;
  const logisticsGross =
    product?.logistics_cost_gross !== undefined && product?.logistics_cost_gross !== null
      ? product.logistics_cost_gross
      : logisticsNet * (1 + (product?.vat_rate ?? 0) / 100);

  const margin = priceNet > 0 ? ((priceNet - costNet) / priceNet) * 100 : 0;
  const totalCostNet = costNet + transportNet + logisticsNet;
  const totalCostGross = costGross + transportGross + logisticsGross;
  const totalPriceNet = priceNet + transportNet + logisticsNet;
  const totalPriceGross = priceGross + transportGross + logisticsGross;

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-[#e5e4e2]">Ładowanie...</div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="flex h-screen items-center justify-center">
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
            className="rounded-lg p-2 transition-colors hover:bg-[#1c1f33]"
          >
            <ArrowLeft className="h-5 w-5 text-[#e5e4e2]" />
          </button>
          <div>
            <h1 className="text-2xl font-light text-[#e5e4e2]">
              {params.id === 'new' ? 'Nowy produkt' : product.name}
            </h1>
            {params.id !== 'new' && (
              <p className="mt-1 text-sm text-[#e5e4e2]/60">{product.category?.name}</p>
            )}
          </div>
        </div>
        {canEdit && (
          <div className="flex items-center gap-3">
            {params.id !== 'new' && (
              <button
                onClick={handleDelete}
                disabled={saving}
                className="flex items-center gap-2 rounded-lg bg-red-500/20 px-4 py-2 text-red-400 transition-colors hover:bg-red-500/30 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
                Usuń
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {saving ? 'Zapisywanie...' : params.id === 'new' ? 'Dodaj produkt' : 'Zapisz zmiany'}
            </button>
          </div>
        )}
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-5">
          <div className="mb-2 flex items-center gap-3">
            <DollarSign className="h-5 w-5 text-[#d3bb73]" />
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

        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-5">
          <div className="mb-2 flex items-center gap-3">
            <DollarSign className="h-5 w-5 text-red-400" />
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

        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-5">
          <div className="mb-2 flex items-center gap-3">
            <DollarSign className="h-5 w-5 text-green-400" />
            <div>
              <div className="text-2xl font-light text-[#e5e4e2]">{margin.toFixed(1)}%</div>
              <div className="text-xs text-[#e5e4e2]/40">
                {(priceNet - costNet).toLocaleString('pl-PL')} zł netto
              </div>
            </div>
          </div>
          <p className="text-sm text-[#e5e4e2]/60">Marża</p>
        </div>

        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-5">
          <div className="mb-2 flex items-center gap-3">
            <Package className="h-5 w-5 text-blue-400" />
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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Basic Info */}
        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          <div className="mb-4 flex items-center gap-2">
            <Settings className="h-5 w-5 text-[#d3bb73]" />
            <h2 className="text-lg font-medium text-[#e5e4e2]">Podstawowe informacje</h2>
          </div>

          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Nazwa produktu</label>
              <input
                type="text"
                value={product.name}
                onChange={(e) => setProduct({ ...product, name: e.target.value })}
                disabled={!canEdit}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] disabled:opacity-50"
              />
            </div>

            <div>
              <label className="mb-2 flex items-center gap-2 text-sm text-[#e5e4e2]/60">
                <span>Kategoria</span>
                {isLoadingCategories && (
                  <span>
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </span>
                )}
              </label>
              <select
                value={product.category_id}
                onChange={(e) => setProduct({ ...product, category_id: e.target.value })}
                disabled={!canEdit}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] disabled:opacity-50"
              >
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Opis</label>
              <textarea
                value={product.description || ''}
                onChange={(e) => setProduct({ ...product, description: e.target.value })}
                disabled={!canEdit}
                className="min-h-[100px] w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] disabled:opacity-50"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Jednostka</label>
                <input
                  type="text"
                  value={product.unit}
                  onChange={(e) => setProduct({ ...product, unit: e.target.value })}
                  disabled={!canEdit}
                  placeholder="szt, komplet, dzień"
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] disabled:opacity-50"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Min. ilość</label>
                <input
                  type="number"
                  value={product.min_quantity}
                  onChange={(e) =>
                    setProduct({ ...product, min_quantity: parseInt(e.target.value) })
                  }
                  disabled={!canEdit}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] disabled:opacity-50"
                />
              </div>
            </div>

            <div className="flex items-center gap-4">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={product.is_active}
                  onChange={(e) => setProduct({ ...product, is_active: e.target.checked })}
                  disabled={!canEdit}
                  className="h-4 w-4 rounded border-[#d3bb73]/20 bg-[#0a0d1a] text-[#d3bb73] focus:ring-[#d3bb73] disabled:opacity-50"
                />
                <span className="text-sm text-[#e5e4e2]">Aktywny</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={product.requires_vehicle}
                  onChange={(e) => setProduct({ ...product, requires_vehicle: e.target.checked })}
                  disabled={!canEdit}
                  className="h-4 w-4 rounded border-[#d3bb73]/20 bg-[#0a0d1a] text-[#d3bb73] focus:ring-[#d3bb73] disabled:opacity-50"
                />
                <span className="text-sm text-[#e5e4e2]">Wymaga pojazdu</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={product.requires_driver}
                  onChange={(e) => setProduct({ ...product, requires_driver: e.target.checked })}
                  disabled={!canEdit}
                  className="h-4 w-4 rounded border-[#d3bb73]/20 bg-[#0a0d1a] text-[#d3bb73] focus:ring-[#d3bb73] disabled:opacity-50"
                />
                <span className="text-sm text-[#e5e4e2]">Wymaga kierowcy</span>
              </label>
            </div>
          </div>
        </div>

        {/* Pricing */}
        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          <div className="mb-4 flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-[#d3bb73]" />
            <h2 className="text-lg font-medium text-[#e5e4e2]">Ceny i koszty (netto/brutto)</h2>
          </div>

          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Stawka VAT (%)</label>
              <input
                type="number"
                value={product?.vat_rate}
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
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] disabled:opacity-50"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Cena netto</label>
                <input
                  type="number"
                  value={priceNet}
                  onChange={(e) => updateNetPrice(parseFloat(e.target.value))}
                  disabled={!canEdit}
                  step="0.01"
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] disabled:opacity-50"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Cena brutto</label>
                <input
                  type="number"
                  value={priceGross}
                  onChange={(e) => updateGrossPrice(parseFloat(e.target.value))}
                  disabled={!canEdit}
                  step="0.01"
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] disabled:opacity-50"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Koszt netto</label>
                <input
                  type="number"
                  value={costNet}
                  onChange={(e) => updateNetCost(parseFloat(e.target.value))}
                  disabled={!canEdit}
                  step="0.01"
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] disabled:opacity-50"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Koszt brutto</label>
                <input
                  type="number"
                  value={costGross}
                  onChange={(e) => updateGrossCost(parseFloat(e.target.value))}
                  disabled={!canEdit}
                  step="0.01"
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] disabled:opacity-50"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Transport netto</label>
                <input
                  type="number"
                  value={transportNet}
                  onChange={(e) => {
                    const net = parseFloat(e.target.value);
                    setProduct({
                      ...product,
                      transport_cost_net: net,
                      transport_cost_gross: net * (1 + product?.vat_rate / 100),
                    });
                  }}
                  disabled={!canEdit}
                  step="0.01"
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] disabled:opacity-50"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Logistyka netto</label>
                <input
                  type="number"
                  value={logisticsNet}
                  onChange={(e) => {
                    const net = parseFloat(e.target.value);
                    setProduct({
                      ...product,
                      logistics_cost_net: net,
                      logistics_cost_gross: net * (1 + product?.vat_rate / 100),
                    });
                  }}
                  disabled={!canEdit}
                  step="0.01"
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] disabled:opacity-50"
                />
              </div>
            </div>

            <div className="space-y-2 border-t border-[#d3bb73]/10 pt-4">
              <div className="flex justify-between text-sm">
                <span className="text-[#e5e4e2]/60">Marża:</span>
                <span
                  className={`font-medium ${margin > 50 ? 'text-green-400' : margin > 30 ? 'text-yellow-400' : 'text-red-400'}`}
                >
                  {margin.toFixed(1)}% ({(priceNet - costNet).toLocaleString('pl-PL')} zł netto)
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[#e5e4e2]/60">Całkowity koszt:</span>
                <span className="text-[#e5e4e2]">
                  {totalCostNet.toLocaleString('pl-PL')} zł netto /{' '}
                  {totalCostGross.toLocaleString('pl-PL')} zł brutto
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[#e5e4e2]/60">Całkowita cena:</span>
                <span className="font-medium text-[#d3bb73]">
                  {totalPriceNet.toLocaleString('pl-PL')} zł netto /{' '}
                  {totalPriceGross.toLocaleString('pl-PL')} zł brutto
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Time */}
        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          <div className="mb-4 flex items-center gap-2">
            <Truck className="h-5 w-5 text-[#d3bb73]" />
            <h2 className="text-lg font-medium text-[#e5e4e2]">Czas realizacji</h2>
          </div>

          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Czas montażu (godz.)</label>
              <input
                type="number"
                value={product.setup_time_hours}
                onChange={(e) =>
                  setProduct({ ...product, setup_time_hours: parseFloat(e.target.value) })
                }
                disabled={!canEdit}
                step="0.5"
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] disabled:opacity-50"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Czas demontażu (godz.)</label>
              <input
                type="number"
                value={product.teardown_time_hours}
                onChange={(e) =>
                  setProduct({ ...product, teardown_time_hours: parseFloat(e.target.value) })
                }
                disabled={!canEdit}
                step="0.5"
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] disabled:opacity-50"
              />
            </div>

            <div className="border-t border-[#d3bb73]/10 pt-4">
              <div className="flex justify-between text-sm">
                <span className="text-[#e5e4e2]/60">Całkowity czas:</span>
                <span className="font-medium text-[#e5e4e2]">
                  {(product.setup_time_hours + product.teardown_time_hours).toFixed(1)} godz.
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Tags */}
        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          <div className="mb-4 flex items-center gap-2">
            <Tag className="h-5 w-5 text-[#d3bb73]" />
            <h2 className="text-lg font-medium text-[#e5e4e2]">Tagi</h2>
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">
              Tagi (oddzielone przecinkami)
              <span className="ml-2 text-xs text-[#e5e4e2]/40">np: dj, wesele, premium</span>
            </label>
            <input
              type="text"
              value={(product.tags || []).join(', ')}
              onChange={(e) => {
                const value = e.target.value.trim();
                const tags = value
                  ? value
                      .split(',')
                      .map((t) => t.trim())
                      .filter(Boolean)
                  : [];
                setProduct({ ...product, tags });
              }}
              disabled={!canEdit}
              placeholder="Wpisz tagi oddzielone przecinkami..."
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] placeholder:text-[#e5e4e2]/30 disabled:opacity-50"
            />
            <p className="mt-1 text-xs text-[#e5e4e2]/40">
              Tagi pomagają w wyszukiwaniu produktów w ofercie
            </p>
          </div>

          {product.tags && product.tags.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {product.tags.map((tag, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-1 rounded-full bg-[#d3bb73]/20 px-3 py-1 text-sm text-[#d3bb73]"
                >
                  <span>{tag}</span>
                  {canEdit && (
                    <button
                      onClick={() =>
                        setProduct({
                          ...product,
                          tags: product.tags.filter((_, i) => i !== idx),
                        })
                      }
                      className="ml-1 text-[#d3bb73]/60 transition-colors hover:text-[#d3bb73]"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* PDF Upload Section */}
        {params.id !== 'new' && (
          <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
            <div className="mb-4 flex items-center gap-2">
              <FileText className="h-5 w-5 text-[#d3bb73]" />
              <h2 className="text-lg font-medium text-[#e5e4e2]">Strona PDF produktu</h2>
            </div>

            <div className="space-y-4">
              <p className="text-sm text-[#e5e4e2]/60">
                Upload pojedynczej strony PDF dla tego produktu. Strona zostanie automatycznie
                dołączona do finalnej oferty.
              </p>

              {product.pdf_page_url ? (
                <div className="space-y-4">
                  <div className="rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] p-4">
                    <div className="grid grid-cols-[200px_1fr_auto] items-start gap-4">
                      {/* Miniaturka PDF po lewej */}
                      <div className="relative">
                        {product.pdf_thumbnail_url ? (
                          <div
                            className="group relative cursor-pointer"
                            onClick={async () => {
                              const { data } = await supabase.storage
                                .from('offer-product-pages')
                                .createSignedUrl(product.pdf_page_url!, 3600);
                              if (data?.signedUrl) window.open(data.signedUrl, '_blank');
                            }}
                          >
                            <img
                              src={`${supabase.storage.from('offer-product-pages').getPublicUrl(product.pdf_thumbnail_url).data.publicUrl}`}
                              alt="Podgląd PDF"
                              className="w-full rounded-lg border border-[#d3bb73]/20 transition-colors hover:border-[#d3bb73]/40"
                              onError={(e) => {
                                (async () => {
                                  const { data } = await supabase.storage
                                    .from('offer-product-pages')
                                    .createSignedUrl(product.pdf_thumbnail_url!, 3600);
                                  if (data?.signedUrl) {
                                    (e.target as HTMLImageElement).src = data.signedUrl;
                                  }
                                })();
                              }}
                            />
                            <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                              <Eye className="h-8 w-8 text-white" />
                            </div>
                          </div>
                        ) : (
                          <div className="flex aspect-[3/4] w-full items-center justify-center rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33]">
                            <FileText className="h-12 w-12 text-[#e5e4e2]/20" />
                          </div>
                        )}
                      </div>

                      {/* Informacje o PDF */}
                      <div className="flex flex-col justify-center">
                        <div className="mb-2 flex items-center gap-2">
                          <FileText className="h-5 w-5 text-[#d3bb73]" />
                          <div className="font-medium text-[#e5e4e2]">Strona PDF przesłana</div>
                        </div>
                        <div className="text-sm text-[#e5e4e2]/60">
                          {product.pdf_thumbnail_url
                            ? 'Kliknij miniaturkę aby otworzyć PDF w nowej karcie'
                            : 'PDF jest dostępny, ale nie ma miniaturki'}
                        </div>
                      </div>

                      {/* Przyciski akcji */}
                      {canEdit && (
                        <div className="flex flex-col gap-2">
                          <button
                            onClick={handleDeletePdf}
                            className="flex items-center gap-2 whitespace-nowrap rounded-lg bg-red-500/20 px-3 py-2 text-sm text-red-400 hover:bg-red-500/30"
                          >
                            <Trash2 className="h-4 w-4" />
                            Usuń PDF
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Thumbnail Section */}
                  <div className="rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] p-4">
                    <div className="mb-3 text-sm font-medium text-[#e5e4e2]">
                      Miniaturka podglądu PDF
                    </div>

                    {product.pdf_thumbnail_url ? (
                      <div className="space-y-3">
                        <div className="relative mx-auto w-full max-w-md">
                          <img
                            src={`${supabase.storage.from('offer-product-pages').getPublicUrl(product.pdf_thumbnail_url).data.publicUrl}`}
                            alt="Miniaturka PDF"
                            className="h-auto w-full rounded-lg border border-[#d3bb73]/20"
                            onError={(e) => {
                              (async () => {
                                const { data } = await supabase.storage
                                  .from('offer-product-pages')
                                  .createSignedUrl(product.pdf_thumbnail_url!, 3600);
                                if (data?.signedUrl) {
                                  (e.target as HTMLImageElement).src = data.signedUrl;
                                }
                              })();
                            }}
                          />
                        </div>
                        {canEdit && (
                          <div className="flex justify-center gap-2">
                            <button
                              onClick={handleDeleteThumbnail}
                              className="flex items-center gap-2 rounded-lg bg-red-500/20 px-3 py-2 text-sm text-red-400 hover:bg-red-500/30"
                            >
                              <Trash2 className="h-4 w-4" />
                              Usuń miniaturkę
                            </button>
                          </div>
                        )}
                      </div>
                    ) : (
                      canEdit && (
                        <div className="space-y-3">
                          <p className="text-xs text-[#e5e4e2]/60">
                            Dodaj miniaturkę aby zobaczyć podgląd zawartości PDF
                          </p>
                          <div>
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                  if (!file.type.startsWith('image/')) {
                                    showSnackbar('Tylko pliki graficzne są dozwolone', 'error');
                                    return;
                                  }
                                  setThumbnailFile(file);
                                }
                              }}
                              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] file:mr-4 file:rounded-lg file:border-0 file:bg-[#d3bb73] file:px-4 file:py-2 file:text-sm file:text-[#1c1f33] hover:file:bg-[#d3bb73]/90"
                            />
                            {thumbnailFile && (
                              <p className="mt-2 text-xs text-[#d3bb73]">
                                Wybrany plik: {thumbnailFile.name} (
                                {(thumbnailFile.size / 1024).toFixed(2)} KB)
                              </p>
                            )}
                          </div>
                          <button
                            onClick={handleUploadThumbnail}
                            disabled={!thumbnailFile || uploadingThumbnail}
                            className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <Upload className="h-4 w-4" />
                            {uploadingThumbnail ? 'Przesyłanie...' : 'Prześlij miniaturkę'}
                          </button>
                        </div>
                      )
                    )}

                    {!canEdit && !product.pdf_thumbnail_url && (
                      <p className="py-4 text-center text-sm text-[#e5e4e2]/40">
                        Brak miniaturki dla tego produktu
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                canEdit && (
                  <div className="space-y-3">
                    <div>
                      <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                        Wybierz plik PDF
                      </label>
                      <input
                        type="file"
                        accept=".pdf,application/pdf"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            if (file.type !== 'application/pdf') {
                              showSnackbar('Tylko pliki PDF są dozwolone', 'error');
                              return;
                            }
                            setPdfFile(file);
                          }
                        }}
                        className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] file:mr-4 file:rounded-lg file:border-0 file:bg-[#d3bb73] file:px-4 file:py-2 file:text-sm file:text-[#1c1f33] hover:file:bg-[#d3bb73]/90"
                      />
                      {pdfFile && (
                        <p className="mt-2 text-xs text-[#d3bb73]">
                          Wybrany plik: {pdfFile.name} ({(pdfFile.size / 1024).toFixed(2)} KB)
                        </p>
                      )}
                    </div>

                    <button
                      onClick={handleUploadPdf}
                      disabled={!pdfFile || uploadingPdf}
                      className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Upload className="h-4 w-4" />
                      {uploadingPdf ? 'Przesyłanie...' : 'Prześlij PDF'}
                    </button>
                  </div>
                )
              )}

              {!canEdit && !product.pdf_page_url && (
                <p className="py-4 text-center text-sm text-[#e5e4e2]/40">
                  Brak strony PDF dla tego produktu
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Equipment */}
      {params.id !== 'new' && (
        <ProductEquipment
          canEdit={canEdit}
          setShowAddEquipmentModal={setShowAddEquipmentModal}
        />
      )}

      {/* Staff */}
      {params.id !== 'new' && (
        <ProductStaffSection
          productId={params.id === 'new' ? null : (params.id as string)}
          canEdit={canEdit}
          draftStaff={draftStaff}
          setDraftStaff={setDraftStaff}
        />
      )}

      {/* Add Equipment/Kit Modal */}
      {showAddEquipmentModal && (
        <AddEquipmentModal
          productId={params.id as string}
          existingEquipment={items}
          onClose={() => setShowAddEquipmentModal(false)}
          onSuccess={() => {
            setShowAddEquipmentModal(false);
          }}
        />
      )}
    </div>
  );
}
