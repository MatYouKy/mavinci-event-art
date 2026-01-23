'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
  ArrowLeft,
  Save,
  Package,
  DollarSign,
  Truck,
  Tag,
  Settings,
  X,
  Trash2,
  FileText,
  Upload,
  Eye,
  Loader2,
} from 'lucide-react';
import Image from 'next/image';

import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';

import { IEventCategory } from '@/app/(crm)/crm/event-categories/types';
import { ProductEquipment } from '../components/ProductEquipment';
import { ProductStaffSection } from '../components/ProductStuffSection';
import { AddEquipmentModal } from '../modal/AddEquipmentModal';
import { useManageProduct } from '../hooks/useManageProduct';
import ResponsiveActionBar, { Action } from '@/components/crm/ResponsiveActionBar';

const toNumber = (v: string, fallback = 0) => {
  if (v === '' || v === null || v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

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

type Props = {
  initialProduct: IProduct | null;
  initialCategories: IEventCategory[];
};

export default function ProductDetailPage({ initialProduct, initialCategories }: Props) {
  const router = useRouter();
  const params = useParams();
  const { showSnackbar } = useSnackbar();
  const { hasScope, isAdmin } = useCurrentEmployee();

  const canEdit = isAdmin || hasScope('offers_manage');

  const productId = params.id as string;

  // hooki zależne od id zostawiamy (to nie jest "fetch produktu", tylko zależne zasoby)
  const { items } = useManageProduct({ productId });
  const [draftStaff, setDraftStaff] = useState<any[]>([]);
  const [showAddEquipmentModal, setShowAddEquipmentModal] = useState(false);

  // -----------------------------
  // STATE
  // -----------------------------
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);

  const [product, setProduct] = useState<IProduct | null>(initialProduct);
  const [tagsInput, setTagsInput] = useState<string>((initialProduct?.tags ?? []).join(', '));

  const [uploadingPdf, setUploadingPdf] = useState(false);
  const [pdfFile, setPdfFile] = useState<File | null>(null);

  const [uploadingThumbnail, setUploadingThumbnail] = useState(false);
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);

  // -----------------------------
  // TAGS
  // -----------------------------
  const parseTags = (raw: string) =>
    raw
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

  useEffect(() => {
    // gdy produkt się zmieni (np. initial -> refresh), zsynchronizuj pole tekstowe
    setTagsInput((product?.tags ?? []).join(', '));
  }, [product?.id]);

  // -----------------------------
  // INITIALIZATION (NO UNNECESSARY FETCH)
  // -----------------------------
  useEffect(() => {
    if (!productId) return;

    // NEW: budujemy pusty produkt (bez fetch)
    if (productId === 'new') {
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
      return;
    }

    // EDIT: jeśli mamy initialProduct dla tego id — nie fetchujemy
    if (initialProduct && initialProduct.id === productId) {
      setProduct(initialProduct);
      setLoading(false);
      return;
    }

    // fallback: jeśli ktoś wejdzie “bokiem” bez initial (np. nawigacja client) — fetch jednorazowy
    fetchProduct();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  // -----------------------------
  // THUMB SRC (instant from initial)
  // -----------------------------
  const bucket = useMemo(() => supabase.storage.from('offer-product-pages'), []);

  const thumbPublicUrl = useMemo(() => {
    if (!product?.pdf_thumbnail_url) return null;
    return bucket.getPublicUrl(product.pdf_thumbnail_url).data.publicUrl;
  }, [bucket, product?.pdf_thumbnail_url]);
  
  const [thumbSrc, setThumbSrc] = useState<string | null>(thumbPublicUrl);
  
  // ważne: aktualizuj thumbSrc tylko gdy zmieni się pdf_thumbnail_url (np po upload/delete)
  useEffect(() => {
    setThumbSrc(thumbPublicUrl);
  }, [thumbPublicUrl]);

  // -----------------------------
  // FETCH (ONLY ACTIONS / FALLBACK)
  // -----------------------------
  const fetchProduct = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('offer_products')
        .select(`*, category:event_categories(id, name)`)
        .eq('id', productId)
        .single();

      if (error) throw error;
      if (data) setProduct(data);
    } catch (err: any) {
      showSnackbar(err.message || 'Błąd pobierania produktu', 'error');
    } finally {
      setLoading(false);
    }
  };

  // -----------------------------
  // PDF OPEN
  // -----------------------------
  const handleOpenPdf = async () => {
    if (!product?.pdf_page_url) return;

    const { data, error } = await bucket.createSignedUrl(product.pdf_page_url, 3600);
    if (error) {
      showSnackbar(error.message, 'error');
      return;
    }
    if (data?.signedUrl) window.open(data.signedUrl, '_blank');
  };

  // -----------------------------
  // UPLOAD PDF
  // -----------------------------
  const handleUploadPdf = async () => {
    if (!pdfFile || !product || productId === 'new') return;

    if (pdfFile.type !== 'application/pdf') {
      showSnackbar('Tylko pliki PDF są dozwolone', 'error');
      return;
    }

    try {
      setUploadingPdf(true);

      const filePath = `${product.id}.pdf`;

      // usuwanie starego pdf (jeśli był)
      if (product.pdf_page_url) {
        await bucket.remove([product.pdf_page_url]);
      }

      const { error: uploadError } = await bucket.upload(filePath, pdfFile, {
        upsert: true,
        contentType: 'application/pdf',
      });
      if (uploadError) throw uploadError;

      const { error: updateError } = await supabase
        .from('offer_products')
        .update({ pdf_page_url: filePath })
        .eq('id', product.id);

      if (updateError) throw updateError;

      // lokalnie od razu ustaw (bez fetch) – a fetch ewentualnie tylko po to, by dograć miniaturkę
      setProduct((p) => (p ? { ...p, pdf_page_url: filePath } : p));

      showSnackbar('Strona PDF została przesłana', 'success');
      setPdfFile(null);

      // jeśli generujesz miniaturkę asynchronicznie po stronie server/edge — tu możesz zrobić polling
      // na razie: refresh po akcji (ale tylko w tej akcji, nie na starcie)
      await fetchProduct();
    } catch (err: any) {
      showSnackbar(err.message || 'Błąd przesyłania pliku', 'error');
    } finally {
      setUploadingPdf(false);
    }
  };

  // -----------------------------
  // UPLOAD THUMBNAIL (manual / optional)
  // -----------------------------
  const handleUploadThumbnail = async () => {
    if (!thumbnailFile || !product || productId === 'new') return;

    if (!thumbnailFile.type.startsWith('image/')) {
      showSnackbar('Tylko pliki graficzne są dozwolone', 'error');
      return;
    }

    try {
      setUploadingThumbnail(true);

      const ext = thumbnailFile.name.split('.').pop() || 'png';
      const filePath = `thumbnails/${product.id}-thumbnail.${ext}`;

      if (product.pdf_thumbnail_url) {
        await bucket.remove([product.pdf_thumbnail_url]);
      }

      const { error: uploadError } = await bucket.upload(filePath, thumbnailFile, {
        upsert: true,
        contentType: thumbnailFile.type,
      });
      if (uploadError) throw uploadError;

      const { error: updateError } = await supabase
        .from('offer_products')
        .update({ pdf_thumbnail_url: filePath })
        .eq('id', product.id);

      if (updateError) throw updateError;

      setProduct((p) => (p ? { ...p, pdf_thumbnail_url: filePath } : p));
      setThumbnailFile(null);

      showSnackbar('Miniaturka została przesłana', 'success');
      // odśwież tylko jeśli chcesz – ale nie jest konieczne
      // await fetchProduct();
    } catch (err: any) {
      showSnackbar(err.message || 'Błąd przesyłania miniaturki', 'error');
    } finally {
      setUploadingThumbnail(false);
    }
  };

  // -----------------------------
  // DELETE THUMBNAIL
  // -----------------------------
  const handleDeleteThumbnail = async () => {
    if (!product || !product.pdf_thumbnail_url || productId === 'new') return;

    if (!confirm('Czy na pewno chcesz usunąć miniaturkę?')) return;

    try {
      setSaving(true);

      const { error: storageError } = await bucket.remove([product.pdf_thumbnail_url]);
      if (storageError) throw storageError;

      const { error: updateError } = await supabase
        .from('offer_products')
        .update({ pdf_thumbnail_url: null })
        .eq('id', product.id);

      if (updateError) throw updateError;

      setProduct((p) => (p ? { ...p, pdf_thumbnail_url: null } : p));
      setThumbSrc(null);

      showSnackbar('Miniaturka została usunięta', 'success');
    } catch (err: any) {
      showSnackbar(err.message || 'Błąd usuwania miniaturki', 'error');
    } finally {
      setSaving(false);
    }
  };

  // -----------------------------
  // DELETE PDF (also thumbnail)
  // -----------------------------
  const handleDeletePdf = async () => {
    if (!product || !product.pdf_page_url || productId === 'new') return;

    if (!confirm('Czy na pewno chcesz usunąć stronę PDF tego produktu (wraz z miniaturką)?')) return;

    try {
      setSaving(true);

      const paths = [product.pdf_page_url, product.pdf_thumbnail_url].filter(
        (p): p is string => !!p,
      );

      if (paths.length) {
        const { error: storageError } = await bucket.remove(paths);
        if (storageError) throw storageError;
      }

      const { error: updateError } = await supabase
        .from('offer_products')
        .update({ pdf_page_url: null, pdf_thumbnail_url: null })
        .eq('id', product.id);

      if (updateError) throw updateError;

      setProduct((p) =>
        p ? { ...p, pdf_page_url: null, pdf_thumbnail_url: null } : p,
      );
      setThumbSrc(null);

      showSnackbar('Strona PDF została usunięta', 'success');
    } catch (err: any) {
      showSnackbar(err.message || 'Błąd usuwania pliku', 'error');
    } finally {
      setSaving(false);
    }
  };

  // -----------------------------
  // SAVE PRODUCT
  // -----------------------------
  const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

  // fallback ceny (Twoje)
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
  const totalCostNet = round2(costNet + transportNet + logisticsNet);
  const totalCostGross = round2(costGross + transportGross + logisticsGross);
  const totalPriceNet = round2(priceNet + transportNet + logisticsNet);
  const totalPriceGross = round2(priceGross + transportGross + logisticsGross);

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

      if (productId === 'new') {
        const { data, error } = await supabase
          .from('offer_products')
          .insert(productData)
          .select()
          .single();

        if (error) throw error;

        showSnackbar('Produkt został dodany', 'success');
        router.push(`/crm/offers/products/${data.id}`);
      } else {
        const { error } = await supabase.from('offer_products').update(productData).eq('id', product.id);
        if (error) throw error;

        showSnackbar('Zapisano zmiany', 'success');
        // tylko po akcji
        await fetchProduct();
      }
    } catch (err: any) {
      showSnackbar(err.message || 'Błąd zapisywania', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!product || !canEdit || productId === 'new') return;

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


  const pdfSectionActions = useMemo<Action[]>(() => {
    const actions: Action[] = [];
  
    // 1) Brak PDF -> upload PDF
    if (canEdit && !product?.pdf_page_url) {
      actions.push({
        label: uploadingPdf ? 'Przesyłanie...' : 'Prześlij PDF',
        onClick: handleUploadPdf,
        icon: <Upload className="h-4 w-4" />,
        variant: 'primary',
        show: true,
      });
      return actions;
    }
  
    // 2) PDF istnieje -> miniaturka tylko gdy null
    if (canEdit && product?.pdf_page_url && !product?.pdf_thumbnail_url) {
      actions.push({
        label: uploadingThumbnail ? 'Przesyłanie...' : 'Prześlij miniaturkę',
        onClick: handleUploadThumbnail,
        icon: <Upload className="h-4 w-4" />,
        variant: 'primary',
        show: true,
      });
    }
  
    // 3) PDF istnieje -> delete PDF
    if (canEdit && product?.pdf_page_url) {
      actions.push({
        label: '',
        onClick: handleDeletePdf,
        icon: <Trash2 className="h-4 w-4" />,
        variant: 'danger',
        show: true,
      });
    }
  
    return actions;
  }, [canEdit, product?.pdf_page_url, product?.pdf_thumbnail_url, uploadingPdf, uploadingThumbnail, handleUploadPdf, handleUploadThumbnail, handleDeletePdf]);
  

  // -----------------------------
  // RENDER
  // -----------------------------
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
              {productId === 'new' ? 'Nowy produkt' : product.name}
            </h1>
            {productId !== 'new' && (
              <p className="mt-1 text-sm text-[#e5e4e2]/60">{product.category?.name}</p>
            )}
          </div>
        </div>

        {canEdit && (
          <div className="flex items-center gap-3">
            {productId !== 'new' && (
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
              {saving ? 'Zapisywanie...' : productId === 'new' ? 'Dodaj produkt' : 'Zapisz zmiany'}
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
              </label>

              <select
                value={product.category_id ?? ''}
                onChange={(e) =>
                  setProduct({ ...product, category_id: e.target.value === '' ? '' : e.target.value })
                }
                disabled={!canEdit}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] disabled:opacity-50"
              >
                <option value="">-- Wybierz kategorię --</option>
                {initialCategories.map((cat) => (
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
                  value={Number.isFinite(product.min_quantity) ? product.min_quantity : 0}
                  onChange={(e) => setProduct({ ...product, min_quantity: toNumber(e.target.value) })}
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
                value={Number.isFinite(product?.vat_rate) ? product?.vat_rate : 0}
                onChange={(e) => {
                  const vat = toNumber(e.target.value);
                  setProduct({
                    ...product,
                    vat_rate: vat,
                    price_gross: round2(priceNet * (1 + vat / 100)),
                    cost_gross: round2(costNet * (1 + vat / 100)),
                    transport_cost_gross: round2(transportNet * (1 + vat / 100)),
                    logistics_cost_gross: round2(logisticsNet * (1 + vat / 100)),
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
                  value={Number(priceNet.toFixed(2))}
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
                  value={Number(priceGross.toFixed(2))}
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
                  value={Number(costNet.toFixed(2))}
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
                  value={Number(costGross.toFixed(2))}
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
                  value={Number(transportNet.toFixed(2))}
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
                  value={Number(logisticsNet.toFixed(2))}
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
                  className={`font-medium ${
                    margin > 50 ? 'text-green-400' : margin > 30 ? 'text-yellow-400' : 'text-red-400'
                  }`}
                >
                  {margin.toFixed(1)}% ({Number((priceNet - costNet).toFixed(2)).toLocaleString('pl-PL')} zł netto)
                </span>
              </div>

              <div className="flex justify-between text-sm">
                <span className="text-[#e5e4e2]/60">Całkowity koszt:</span>
                <span className="text-[#e5e4e2]">
                  {Number(totalCostNet.toFixed(2)).toLocaleString('pl-PL')} zł netto /{' '}
                  {Number(totalCostGross.toFixed(2)).toLocaleString('pl-PL')} zł brutto
                </span>
              </div>

              <div className="flex justify-between text-sm">
                <span className="text-[#e5e4e2]/60">Całkowita cena:</span>
                <span className="font-medium text-[#d3bb73]">
                  {Number(totalPriceNet.toFixed(2)).toLocaleString('pl-PL')} zł netto /{' '}
                  {Number(totalPriceGross.toFixed(2)).toLocaleString('pl-PL')} zł brutto
                </span>
              </div>
            </div>
          </div>
        </div>
                  {/* PDF Upload Section */}
{productId !== 'new' && (
  <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
    <div className="mb-4 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <FileText className="h-5 w-5 text-[#d3bb73]" />
        <h2 className="text-lg font-medium text-[#e5e4e2]">Strona PDF produktu</h2>
      </div>

      {/* JEDEN ActionBar */}
      <ResponsiveActionBar actions={pdfSectionActions} />
    </div>

    <div className="space-y-4">
      <p className="text-sm text-[#e5e4e2]/60">
        Upload pojedynczej strony PDF dla tego produktu. Strona zostanie automatycznie dołączona do finalnej oferty.
      </p>

      {product.pdf_page_url ? (
        <div className="rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] p-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[200px_1fr] md:items-start">
            {/* Miniaturka / placeholder */}
            <div className="relative">
              {product.pdf_thumbnail_url ? (
                <div
                  className="group relative cursor-pointer"
                  onClick={handleOpenPdf}
                  title="Otwórz PDF"
                >
                  <Image
                    src={thumbSrc ?? bucket.getPublicUrl(product.pdf_thumbnail_url).data.publicUrl}
                    alt="Podgląd PDF"
                    className="w-full rounded-lg border border-[#d3bb73]/20 transition-colors hover:border-[#d3bb73]/40"
                    width={400}
                    height={520}
                    sizes="200px"
                    priority
                    onError={async () => {
                      // fallback tylko jeśli publicUrl nie działa (np. prywatny bucket)
                      const { data } = await bucket.createSignedUrl(product.pdf_thumbnail_url!, 3600);
                      if (data?.signedUrl) setThumbSrc(data.signedUrl);
                    }}
                  />
                  {/* Oczko na hover */}
                  <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                    <Eye className="h-8 w-8 text-white" />
                  </div>
                </div>
              ) : (
                <div
                  className="flex aspect-[3/4] w-full items-center justify-center rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33]"
                  title="Brak miniaturki"
                >
                  <FileText className="h-12 w-12 text-[#e5e4e2]/20" />
                </div>
              )}
            </div>

            {/* Informacje + (warunkowo) wybór miniaturki */}
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

              {/* WYBÓR MINIATURKI: tylko gdy thumbnail === null */}
              {canEdit && !product.pdf_thumbnail_url && (
                <div className="mt-4 space-y-2">
                  <p className="text-xs text-[#e5e4e2]/60">
                    Dodaj miniaturkę aby zobaczyć podgląd zawartości PDF
                  </p>

                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      if (!file.type.startsWith('image/')) {
                        showSnackbar('Tylko pliki graficzne są dozwolone', 'error');
                        return;
                      }
                      setThumbnailFile(file);
                    }}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] file:mr-4 file:rounded-lg file:border-0 file:bg-[#d3bb73] file:px-4 file:py-2 file:text-sm file:text-[#1c1f33] hover:file:bg-[#d3bb73]/90"
                  />

                  {thumbnailFile && (
                    <p className="text-xs text-[#d3bb73]">
                      Wybrany plik: {thumbnailFile.name} ({(thumbnailFile.size / 1024).toFixed(2)} KB)
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        canEdit ? (
          <div className="space-y-3">
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Wybierz plik PDF</label>
              <input
                type="file"
                accept=".pdf,application/pdf"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.type !== 'application/pdf') {
                    showSnackbar('Tylko pliki PDF są dozwolone', 'error');
                    return;
                  }
                  setPdfFile(file);
                }}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] file:mr-4 file:rounded-lg file:border-0 file:bg-[#d3bb73] file:px-4 file:py-2 file:text-sm file:text-[#1c1f33] hover:file:bg-[#d3bb73]/90"
              />

              {pdfFile && (
                <p className="mt-2 text-xs text-[#d3bb73]">
                  Wybrany plik: {pdfFile.name} ({(pdfFile.size / 1024).toFixed(2)} KB)
                </p>
              )}
            </div>

            {/* ActionBar już jest w headerze, więc tu nie dajemy przycisku */}
            <p className="text-xs text-[#e5e4e2]/40">
              Kliknij “Prześlij PDF” w prawym górnym rogu sekcji.
            </p>
          </div>
        ) : null
      )}

      {!canEdit && !product.pdf_page_url && (
        <p className="py-4 text-center text-sm text-[#e5e4e2]/40">
          Brak strony PDF dla tego produktu
        </p>
      )}
    </div>
  </div>
)}

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
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              onBlur={() => {
                const tags = parseTags(tagsInput);
                setProduct((p) => (p ? { ...p, tags } : p));
                setTagsInput(tags.join(', '));
              }}
              disabled={!canEdit}
              placeholder="Wpisz tagi oddzielone przecinkami..."
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] placeholder:text-[#e5e4e2]/30 disabled:opacity-50"
            />

            <p className="mt-1 text-xs text-[#e5e4e2]/40">Tagi pomagają w wyszukiwaniu produktów w ofercie</p>
          </div>
          

          {product.tags?.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {product.tags.map((tag, idx) => (
                <div
                  key={`${tag}-${idx}`}
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


      </div>

      {/* Equipment */}
      {productId !== 'new' && (
        <ProductEquipment canEdit={canEdit} setShowAddEquipmentModal={setShowAddEquipmentModal} />
      )}

      {/* Staff */}
      {productId !== 'new' && (
        <ProductStaffSection
          productId={productId === 'new' ? null : productId}
          canEdit={canEdit}
          draftStaff={draftStaff}
          setDraftStaff={setDraftStaff}
        />
      )}

      {/* Add Equipment/Kit Modal */}
      {showAddEquipmentModal && (
        <AddEquipmentModal
          productId={productId}
          existingEquipment={items}
          onClose={() => setShowAddEquipmentModal(false)}
          onSuccess={() => setShowAddEquipmentModal(false)}
        />
      )}
    </div>
  );
}