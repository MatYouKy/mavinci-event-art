/* eslint-disable react-hooks/exhaustive-deps */
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
  Sparkles,
  Image as ImageIcon,
} from 'lucide-react';
import Image from 'next/image';

import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { optimizeOfferImage } from '@/lib/optimizeOfferImage';

import { IEventCategory } from '@/app/(crm)/crm/event-categories/types';
import { Building2, ExternalLink } from 'lucide-react';
import { ProductEquipment } from '../components/ProductEquipment';
import { ProductStaffSection } from '../components/ProductStuffSection';
import { ProductContractClauses } from '../components/ProductContractClauses';
import { ProductMavinciLiveModules } from '../components/ProductMavinciLiveModules';
import { ProductOfferCardPreview } from '../components/ProductOfferCardPreview';
import { ProductVariantsEditor } from '../components/ProductVariantsEditor';
import { AddEquipmentModal } from '../modal/AddEquipmentModal';
import { useManageProduct } from '../hooks/useManageProduct';
import ResponsiveActionBar, { Action } from '@/components/crm/ResponsiveActionBar';
import type { IProductVariant } from '@/app/(crm)/crm/offers/types';

const toNumber = (v: string, fallback = 0) => {
  if (v === '' || v === null || v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const normalizeOfferImageScale = (value: unknown) => {
  const scale = Number(value ?? 1);
  if (!Number.isFinite(scale)) return 1;
  return Math.min(3, Math.max(0.5, scale));
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
  service_duration_hours?: number | null;
  extension_price_net_per_hour?: number | null;
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
  offer_short_description?: string | null;
  offer_description?: string | null;
  offer_benefits?: string[] | null;
  offer_requirements?: string[] | null;
  offer_image_path?: string | null;
  offer_image_alt?: string | null;
  offer_image_position_x?: number | null;
  offer_image_position_y?: number | null;
  offer_image_zoom?: number | null;
  product_page_url?: string | null;
  offer_page_variant?: string | null;
  offer_page_enabled?: boolean;
  recommended_contract_clauses?: string | null;
  recommended_contract_clause_category?: 'requirements' | 'obligations' | 'risks' | 'general';
  category?: IEventCategory;
  is_subcontractor_service?: boolean;
  subcontractor_id?: string | null;
  subcontractor_service_catalog_id?: string | null;
  subcontractor_settlement_method?: 'invoice' | 'cash_documented' | 'cash_non_deductible' | null;
  subcontractor_economic_cost?: number | null;
  offer_product_variants?: IProductVariant[];
}

type Props = {
  initialProduct: IProduct | null;
  initialCategories: IEventCategory[];
};

type ProductOfferAiDraft = {
  short_description: string;
  description: string;
  benefits: string[];
  image_alt: string;
};

function ProductPricingPanel({
  product,
  canEdit,
  onChange,
  className = '',
}: {
  product: IProduct;
  canEdit: boolean;
  onChange: (next: IProduct) => void;
  className?: string;
}) {
  const roundPrice = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
  const vatMultiplier = 1 + Number(product.vat_rate || 0) / 100;
  const priceNet = Number(product.price_net ?? product.base_price ?? 0);
  const priceGross = Number(product.price_gross ?? priceNet * vatMultiplier);
  const costNet = Number(product.cost_net ?? product.cost_price ?? 0);
  const costGross = Number(product.cost_gross ?? costNet * vatMultiplier);
  const transportNet = Number(product.transport_cost_net ?? product.transport_cost ?? 0);
  const logisticsNet = Number(product.logistics_cost_net ?? product.logistics_cost ?? 0);
  const totalCostNet = costNet + transportNet + logisticsNet;
  const totalPriceNet = priceNet + transportNet + logisticsNet;
  const margin = priceNet > 0 ? ((priceNet - costNet) / priceNet) * 100 : 0;

  const inputClass =
    'w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] disabled:opacity-50';

  return (
    <section className={`rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6 ${className}`}>
      <div className="mb-4 flex items-center gap-2">
        <DollarSign className="h-5 w-5 text-[#d3bb73]" />
        <h2 className="text-lg font-medium text-[#e5e4e2]">Ceny i koszty (netto/brutto)</h2>
      </div>

      <div className="space-y-4">
        <div>
          <label className="mb-2 block text-sm text-[#e5e4e2]/60">Stawka VAT (%)</label>
          <input
            type="number"
            value={Number.isFinite(product.vat_rate) ? product.vat_rate : 0}
            onChange={(event) => {
              const vatRate = toNumber(event.target.value);
              const multiplier = 1 + vatRate / 100;
              onChange({
                ...product,
                vat_rate: vatRate,
                price_gross: roundPrice(priceNet * multiplier),
                cost_gross: roundPrice(costNet * multiplier),
                transport_cost_gross: roundPrice(transportNet * multiplier),
                logistics_cost_gross: roundPrice(logisticsNet * multiplier),
              });
            }}
            disabled={!canEdit}
            step="0.01"
            className={inputClass}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Cena netto</label>
            <input
              type="number"
              value={roundPrice(priceNet)}
              onChange={(event) => {
                const value = toNumber(event.target.value);
                onChange({
                  ...product,
                  price_net: value,
                  price_gross: roundPrice(value * vatMultiplier),
                });
              }}
              disabled={!canEdit}
              step="0.01"
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Cena brutto</label>
            <input
              type="number"
              value={roundPrice(priceGross)}
              onChange={(event) => {
                const value = toNumber(event.target.value);
                onChange({
                  ...product,
                  price_gross: value,
                  price_net: roundPrice(value / vatMultiplier),
                });
              }}
              disabled={!canEdit}
              step="0.01"
              className={inputClass}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Koszt netto</label>
            <input
              type="number"
              value={roundPrice(costNet)}
              onChange={(event) => {
                const value = toNumber(event.target.value);
                onChange({
                  ...product,
                  cost_net: value,
                  cost_gross: roundPrice(value * vatMultiplier),
                });
              }}
              disabled={!canEdit}
              step="0.01"
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Koszt brutto</label>
            <input
              type="number"
              value={roundPrice(costGross)}
              onChange={(event) => {
                const value = toNumber(event.target.value);
                onChange({
                  ...product,
                  cost_gross: value,
                  cost_net: roundPrice(value / vatMultiplier),
                });
              }}
              disabled={!canEdit}
              step="0.01"
              className={inputClass}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Transport netto</label>
            <input
              type="number"
              value={roundPrice(transportNet)}
              onChange={(event) => {
                const value = toNumber(event.target.value);
                onChange({
                  ...product,
                  transport_cost_net: value,
                  transport_cost_gross: roundPrice(value * vatMultiplier),
                });
              }}
              disabled={!canEdit}
              step="0.01"
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Logistyka netto</label>
            <input
              type="number"
              value={roundPrice(logisticsNet)}
              onChange={(event) => {
                const value = toNumber(event.target.value);
                onChange({
                  ...product,
                  logistics_cost_net: value,
                  logistics_cost_gross: roundPrice(value * vatMultiplier),
                });
              }}
              disabled={!canEdit}
              step="0.01"
              className={inputClass}
            />
          </div>
        </div>

        <div className="space-y-2 border-t border-[#d3bb73]/10 pt-4 text-sm">
          <div className="flex justify-between gap-4">
            <span className="text-[#e5e4e2]/60">Marża:</span>
            <span
              className={
                margin > 50 ? 'text-green-400' : margin > 30 ? 'text-yellow-400' : 'text-red-400'
              }
            >
              {margin.toFixed(1)}% ({(priceNet - costNet).toLocaleString('pl-PL')} zł netto)
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-[#e5e4e2]/60">Całkowity koszt:</span>
            <span className="text-[#e5e4e2]">{totalCostNet.toLocaleString('pl-PL')} zł netto</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-[#e5e4e2]/60">Całkowita cena:</span>
            <span className="font-medium text-[#d3bb73]">
              {totalPriceNet.toLocaleString('pl-PL')} zł netto
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function ProductDetailPage({ initialProduct, initialCategories }: Props) {
  const router = useRouter();
  const params = useParams();
  const { showSnackbar } = useSnackbar();
  const { hasScope, isAdmin } = useCurrentEmployee();

  const canEdit = isAdmin || hasScope('offers_manage');

  const productId = params.id as string;
  const [configurationVariantId, setConfigurationVariantId] = useState<string | null>(null);
  const [draftStaff, setDraftStaff] = useState<any[]>([]);
  const [showAddEquipmentModal, setShowAddEquipmentModal] = useState(false);

  // -----------------------------
  // STATE
  // -----------------------------
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);

  const [product, setProduct] = useState<IProduct | null>(initialProduct);
  const [tagsInput, setTagsInput] = useState<string>((initialProduct?.tags ?? []).join(', '));
  const [productVariants, setProductVariants] = useState<IProductVariant[]>(
    [...(initialProduct?.offer_product_variants || [])].sort(
      (a, b) => a.display_order - b.display_order,
    ),
  );
  const persistedProductVariants = useMemo(
    () => productVariants.filter((variant) => !variant.id.startsWith('temp-')),
    [productVariants],
  );
  const selectedConfigurationVariant = useMemo(
    () => persistedProductVariants.find((variant) => variant.id === configurationVariantId) || null,
    [persistedProductVariants, configurationVariantId],
  );
  useEffect(() => {
    if (configurationVariantId && !selectedConfigurationVariant) {
      setConfigurationVariantId(null);
    }
  }, [configurationVariantId, selectedConfigurationVariant]);
  const effectiveEquipmentVariantId = selectedConfigurationVariant?.overrides_equipment
    ? selectedConfigurationVariant.id
    : null;
  const { items, refetch: refetchProductEquipment } = useManageProduct({
    productId,
    productVariantId: effectiveEquipmentVariantId,
  });
  const [configuringSection, setConfiguringSection] = useState<string | null>(null);

  const [uploadingPdf, setUploadingPdf] = useState(false);
  const [pdfFile, setPdfFile] = useState<File | null>(null);

  const [uploadingThumbnail, setUploadingThumbnail] = useState(false);
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [uploadingOfferImage, setUploadingOfferImage] = useState(false);
  const [offerImageFile, setOfferImageFile] = useState<File | null>(null);
  const [offerImageSrc, setOfferImageSrc] = useState<string | null>(null);
  const [draggingOfferImage, setDraggingOfferImage] = useState(false);
  const [variantImageUrls, setVariantImageUrls] = useState<Record<string, string>>({});
  const [uploadingVariantImageId, setUploadingVariantImageId] = useState<string | null>(null);
  const [generatingOfferCopy, setGeneratingOfferCopy] = useState(false);
  const [offerAiDraft, setOfferAiDraft] = useState<ProductOfferAiDraft | null>(null);

  // Subcontractors
  const [subcontractors, setSubcontractors] = useState<any[]>([]);
  const [subcontractorServices, setSubcontractorServices] = useState<any[]>([]);
  const [selectedSubcontractor, setSelectedSubcontractor] = useState<string>('');
  const [selectedService, setSelectedService] = useState<string>('');
  const [loadingSubcontractors, setLoadingSubcontractors] = useState(false);

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

  // Fetch subcontractors always
  useEffect(() => {
    fetchSubcontractors();
  }, []);

  // Initialize from existing product data
  useEffect(() => {
    if (product && product.is_subcontractor_service) {
      if (product.subcontractor_id && product.subcontractor_id !== selectedSubcontractor) {
        setSelectedSubcontractor(product.subcontractor_id);
      }
      if (
        product.subcontractor_service_catalog_id &&
        product.subcontractor_service_catalog_id !== selectedService
      ) {
        setSelectedService(product.subcontractor_service_catalog_id);
      }
    }
  }, [product?.id, product?.is_subcontractor_service]);

  // Fetch services when subcontractor changes
  useEffect(() => {
    if (selectedSubcontractor) {
      fetchSubcontractorServices(selectedSubcontractor);
    } else {
      setSubcontractorServices([]);
      setSelectedService('');
    }
  }, [selectedSubcontractor]);

  // Auto-update pricing when service is selected
  useEffect(() => {
    if (selectedService && subcontractorServices.length > 0) {
      const service = subcontractorServices.find((s) => s.id === selectedService);
      if (service && product) {
        const isEquipment = (service as any)._type === 'equipment';
        const isCashWithoutTaxDocument =
          !isEquipment && (service as any).settlement_method === 'cash_non_deductible';
        const supplierGross = isEquipment
          ? (service as any).daily_price_gross || (service as any).rental_price_per_day
          : (service as any).price_gross || (service as any).unit_price;
        const supplierNet = isEquipment
          ? (service as any).daily_price_net
          : (service as any).price_net;
        const supplierVatRate = Number((service as any).vat_rate ?? 23);
        const vatRate =
          !isEquipment && (service as any).settlement_method !== 'invoice'
            ? Number(product.vat_rate ?? 23) || 23
            : supplierVatRate;
        const calculatedNet =
          supplierNet || (supplierGross ? supplierGross / (1 + supplierVatRate / 100) : 0);
        const defaultSaleGross = Number((calculatedNet * (1 + vatRate / 100)).toFixed(2));
        const economicCost = Number((service as any).economic_cost ?? calculatedNet);

        setProduct({
          ...product,
          base_price: calculatedNet,
          price_gross: defaultSaleGross,
          price_net: calculatedNet,
          cost_gross: isCashWithoutTaxDocument ? economicCost : supplierGross || 0,
          cost_net: economicCost,
          vat_rate: vatRate,
          subcontractor_settlement_method: isEquipment
            ? null
            : (service as any).settlement_method || 'invoice',
          subcontractor_economic_cost: isEquipment ? null : economicCost,
        });
      }
    }
  }, [selectedService, subcontractorServices]);

  const fetchSubcontractors = async () => {
    try {
      setLoadingSubcontractors(true);
      const { data, error } = await supabase
        .from('organizations')
        .select('id, name, status, subcontractor_id')
        .eq('organization_type', 'subcontractor')
        .eq('status', 'active')
        .order('name');

      if (error) throw error;
      setSubcontractors(data || []);
    } catch (err: any) {
      showSnackbar(err.message || 'Błąd pobierania podwykonawców', 'error');
    } finally {
      setLoadingSubcontractors(false);
    }
  };

  const fetchSubcontractorServices = async (organizationId: string) => {
    try {
      // Najpierw pobierz subcontractor_id dla tej organizacji
      const { data: orgData, error: orgError } = await supabase
        .from('organizations')
        .select('subcontractor_id')
        .eq('id', organizationId)
        .maybeSingle();

      if (orgError) {
        console.error('Error fetching organization:', orgError);
        setSubcontractorServices([]);
        return;
      }

      if (!orgData?.subcontractor_id) {
        setSubcontractorServices([]);
        return;
      }

      // Pobierz usługi z service_catalog
      const { data: services, error: servicesError } = await supabase
        .from('subcontractor_service_catalog')
        .select('*')
        .eq('subcontractor_id', orgData.subcontractor_id)
        .eq('is_active', true)
        .order('name');

      if (servicesError) {
        console.error('Error fetching services:', servicesError);
      }

      // Pobierz sprzęt z rental_equipment
      const { data: equipment, error: equipmentError } = await supabase
        .from('subcontractor_rental_equipment')
        .select('*')
        .eq('subcontractor_id', orgData.subcontractor_id)
        .eq('is_active', true)
        .order('name');

      if (equipmentError) {
        console.error('Error fetching equipment:', equipmentError);
      }

      // Połącz obie listy, dodając pole type dla rozróżnienia
      const servicesWithType = (services || []).map((s) => ({ ...s, _type: 'service' }));
      const equipmentWithType = (equipment || []).map((e) => ({ ...e, _type: 'equipment' }));

      const allItems = [...servicesWithType, ...equipmentWithType];

      setSubcontractorServices(allItems);
    } catch (err: any) {
      showSnackbar(err.message || 'Błąd pobierania usług podwykonawcy', 'error');
      setSubcontractorServices([]);
    }
  };

  const handleImportServiceFromSubcontractor = async () => {
    if (!selectedService) return;

    const item = subcontractorServices.find((s) => s.id === selectedService);
    const organization = subcontractors.find((s) => s.id === selectedSubcontractor);

    if (!item || !organization) return;

    const isEquipment = (item as any)._type === 'equipment';

    // Wybierz cenę w zależności od typu
    const price = isEquipment
      ? (item as any).rental_price_per_day || 0
      : (item as any).unit_price || 0;
    const supplierVatRate = Number((item as any).vat_rate ?? 23);
    const supplierNet = isEquipment
      ? Number((item as any).daily_price_net ?? price / (1 + supplierVatRate / 100))
      : Number((item as any).price_net ?? price / (1 + supplierVatRate / 100));
    const economicCost = isEquipment
      ? supplierNet
      : Number((item as any).economic_cost ?? supplierNet);
    const isCashWithoutTaxDocument =
      !isEquipment && (item as any).settlement_method === 'cash_non_deductible';
    const saleVatRate =
      !isEquipment && (item as any).settlement_method !== 'invoice'
        ? Number(product?.vat_rate ?? 23) || 23
        : supplierVatRate;
    const defaultSaleGross = Number((supplierNet * (1 + saleVatRate / 100)).toFixed(2));

    const unit = isEquipment ? 'dzień' : (item as any).unit || 'szt';
    const typeLabel = isEquipment ? 'Wynajem' : 'Usługa';

    // Wypełnij formularz danymi z usługi/sprzętu podwykonawcy
    setProduct({
      ...product!,
      name: `${item.name} (${organization.name})`,
      description: item.description || '',
      price_net: supplierNet,
      price_gross: defaultSaleGross,
      cost_net: economicCost,
      cost_gross: isCashWithoutTaxDocument ? economicCost : price,
      vat_rate: saleVatRate,
      unit: unit,
      is_subcontractor_service: true,
      subcontractor_id: selectedSubcontractor,
      subcontractor_service_catalog_id: selectedService,
      subcontractor_settlement_method: isEquipment
        ? null
        : (item as any).settlement_method || 'invoice',
      subcontractor_economic_cost: isEquipment ? null : economicCost,
      tags: [...(product?.tags || []), 'podwykonawca', organization.name, typeLabel],
    });

    showSnackbar(`Zaimportowano ${typeLabel.toLowerCase()} od podwykonawcy`, 'success');
  };

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
        subcontractor_settlement_method: null,
        subcontractor_economic_cost: null,
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
        offer_short_description: '',
        offer_description: '',
        service_duration_hours: null,
        extension_price_net_per_hour: null,
        offer_benefits: [],
        offer_requirements: [],
        offer_image_path: null,
        offer_image_alt: '',
        offer_image_position_x: 50,
        offer_image_position_y: 25,
        offer_image_zoom: 1,
        product_page_url: '',
        offer_page_variant: 'default',
        offer_page_enabled: true,
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

  useEffect(() => {
    let cancelled = false;

    const loadOfferImage = async () => {
      if (!product?.offer_image_path) {
        setOfferImageSrc(null);
        return;
      }

      const { data } = await bucket.createSignedUrl(product.offer_image_path, 3600);
      if (!cancelled) setOfferImageSrc(data?.signedUrl || null);
    };

    loadOfferImage();
    return () => {
      cancelled = true;
    };
  }, [bucket, product?.offer_image_path]);

  const variantImageSignature = useMemo(
    () =>
      productVariants.map((variant) => `${variant.id}:${variant.offer_image_path || ''}`).join('|'),
    [productVariants],
  );

  useEffect(() => {
    let cancelled = false;

    const loadVariantImages = async () => {
      const entries = await Promise.all(
        productVariants.map(async (variant) => {
          if (!variant.offer_image_path || variant.id.startsWith('temp-')) return null;
          const { data } = await bucket.createSignedUrl(variant.offer_image_path, 3600);
          return data?.signedUrl ? ([variant.id, data.signedUrl] as const) : null;
        }),
      );
      if (!cancelled) {
        setVariantImageUrls(Object.fromEntries(entries.filter(Boolean) as Array<[string, string]>));
      }
    };

    loadVariantImages();
    return () => {
      cancelled = true;
    };
  }, [bucket, variantImageSignature]);

  // -----------------------------
  // FETCH (ONLY ACTIONS / FALLBACK)
  // -----------------------------
  const fetchProduct = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('offer_products')
        .select(
          `
          *,
          category:event_categories(id, name),
          offer_product_variants(*),
          subcontractor:organizations(id, name)
        `,
        )
        .eq('id', productId)
        .maybeSingle();

      if (error) throw error;
      if (data) {
        setProduct(data);
        setProductVariants(
          [...(data.offer_product_variants || [])].sort(
            (a: IProductVariant, b: IProductVariant) => a.display_order - b.display_order,
          ),
        );
      }
    } catch (err: any) {
      showSnackbar(err.message || 'Błąd pobierania produktu', 'error');
    } finally {
      setLoading(false);
    }
  };

  const variantOverrideField = {
    equipment: 'overrides_equipment',
    staff: 'overrides_staff',
    mavinci_live: 'overrides_mavinci_live',
    contract_clauses: 'overrides_contract_clauses',
  } as const;

  const cloneBaseConfigurationRows = async (
    table: 'offer_product_equipment' | 'offer_product_staff' | 'offer_product_mavinci_live_modules',
    variantId: string,
  ) => {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .eq('product_id', productId)
      .is('product_variant_id', null);
    if (error) throw error;
    if (!data?.length) return;

    const rows = data.map((row: any) => {
      const { id: _id, created_at: _createdAt, updated_at: _updatedAt, ...copy } = row;
      return { ...copy, product_id: productId, product_variant_id: variantId };
    });
    const { error: insertError } = await supabase.from(table).insert(rows);
    if (insertError) throw insertError;
  };

  const handleCustomizeVariantSection = async (section: keyof typeof variantOverrideField) => {
    if (!selectedConfigurationVariant || configuringSection) return;
    const variantId = selectedConfigurationVariant.id;
    const overrideField = variantOverrideField[section];

    try {
      setConfiguringSection(section);
      if (section === 'equipment') {
        await cloneBaseConfigurationRows('offer_product_equipment', variantId);
      } else if (section === 'staff') {
        await cloneBaseConfigurationRows('offer_product_staff', variantId);
      } else if (section === 'mavinci_live') {
        await cloneBaseConfigurationRows('offer_product_mavinci_live_modules', variantId);
      }

      const patch: Record<string, unknown> = { [overrideField]: true };
      if (section === 'contract_clauses') {
        patch.recommended_contract_clauses = product?.recommended_contract_clauses || null;
        patch.recommended_contract_clause_category =
          product?.recommended_contract_clause_category || 'requirements';
      }

      const { error } = await supabase
        .from('offer_product_variants')
        .update(patch)
        .eq('id', variantId)
        .eq('product_id', productId);
      if (error) throw error;

      setProductVariants((current) =>
        current.map((variant) => (variant.id === variantId ? { ...variant, ...patch } : variant)),
      );
      showSnackbar(
        `Wariant „${selectedConfigurationVariant.name}” ma teraz własną konfigurację`,
        'success',
      );
    } catch (error: any) {
      showSnackbar(error?.message || 'Nie udało się utworzyć konfiguracji wariantu', 'error');
    } finally {
      setConfiguringSection(null);
    }
  };

  const handleResetVariantSection = async (section: keyof typeof variantOverrideField) => {
    if (!selectedConfigurationVariant || configuringSection) return;
    const variantId = selectedConfigurationVariant.id;
    const overrideField = variantOverrideField[section];

    try {
      setConfiguringSection(section);
      const table =
        section === 'equipment'
          ? 'offer_product_equipment'
          : section === 'staff'
            ? 'offer_product_staff'
            : section === 'mavinci_live'
              ? 'offer_product_mavinci_live_modules'
              : null;
      if (table) {
        const { error: deleteError } = await supabase
          .from(table)
          .delete()
          .eq('product_id', productId)
          .eq('product_variant_id', variantId);
        if (deleteError) throw deleteError;
      }

      const patch: Record<string, unknown> = { [overrideField]: false };
      if (section === 'contract_clauses') {
        patch.recommended_contract_clauses = null;
        patch.recommended_contract_clause_category = 'requirements';
      }
      const { error } = await supabase
        .from('offer_product_variants')
        .update(patch)
        .eq('id', variantId)
        .eq('product_id', productId);
      if (error) throw error;

      setProductVariants((current) =>
        current.map((variant) => (variant.id === variantId ? { ...variant, ...patch } : variant)),
      );
      showSnackbar(`Przywrócono dziedziczenie z produktu bazowego`, 'success');
    } catch (error: any) {
      showSnackbar(error?.message || 'Nie udało się przywrócić dziedziczenia', 'error');
    } finally {
      setConfiguringSection(null);
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

  const handleUploadOfferImage = async (selectedFile?: File | null) => {
    const file = selectedFile || offerImageFile;
    if (!file || !product || productId === 'new') return;

    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      showSnackbar('Grafika do PDF musi być plikiem PNG lub JPG', 'error');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      showSnackbar('Grafika nie może być większa niż 10 MB', 'error');
      return;
    }

    const previousPreview = offerImageSrc;
    let localPreview = '';
    try {
      setUploadingOfferImage(true);
      const optimizedFile = await optimizeOfferImage(file, {
        maxWidth: 1800,
        maxHeight: 1800,
        quality: 0.82,
      });
      localPreview = URL.createObjectURL(optimizedFile);
      setOfferImageFile(optimizedFile);
      setOfferImageSrc(localPreview);
      const extension = optimizedFile.type === 'image/png' ? 'png' : 'jpg';
      const filePath = `assets/${product.id}/offer-image-${Date.now()}.${extension}`;

      const { error: uploadError } = await bucket.upload(filePath, optimizedFile, {
        contentType: optimizedFile.type,
        upsert: false,
      });
      if (uploadError) throw uploadError;

      const previousPath = product.offer_image_path;
      const { error: updateError } = await supabase
        .from('offer_products')
        .update({ offer_image_path: filePath })
        .eq('id', product.id);
      if (updateError) {
        await bucket.remove([filePath]);
        throw updateError;
      }

      if (previousPath) await bucket.remove([previousPath]);
      const { data } = await bucket.createSignedUrl(filePath, 3600);
      setOfferImageSrc(data?.signedUrl || null);
      setOfferImageFile(null);
      setProduct((current) => (current ? { ...current, offer_image_path: filePath } : current));
      showSnackbar('Grafika produktu została zapisana', 'success');
    } catch (err: any) {
      setOfferImageSrc(previousPreview);
      showSnackbar(err.message || 'Błąd przesyłania grafiki', 'error');
    } finally {
      if (localPreview) URL.revokeObjectURL(localPreview);
      setUploadingOfferImage(false);
    }
  };

  const handleOfferImageDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDraggingOfferImage(false);
    if (!canEdit || productId === 'new' || uploadingOfferImage) return;

    const file = event.dataTransfer.files?.[0];
    if (file) await handleUploadOfferImage(file);
  };

  const handleUploadVariantImage = async (variant: IProductVariant, file: File) => {
    if (!product || productId === 'new' || variant.id.startsWith('temp-')) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      showSnackbar('Zdjęcie wariantu musi być plikiem PNG lub JPG', 'error');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      showSnackbar('Zdjęcie wariantu nie może być większe niż 10 MB', 'error');
      return;
    }

    const previousUrl = variantImageUrls[variant.id];
    let localPreview = '';
    try {
      setUploadingVariantImageId(variant.id);
      const optimizedFile = await optimizeOfferImage(file, {
        maxWidth: 1800,
        maxHeight: 1800,
        quality: 0.82,
      });
      localPreview = URL.createObjectURL(optimizedFile);
      setVariantImageUrls((current) => ({ ...current, [variant.id]: localPreview }));

      const extension = optimizedFile.type === 'image/png' ? 'png' : 'jpg';
      const filePath = `assets/${product.id}/variants/${variant.id}-${Date.now()}.${extension}`;
      const { error: uploadError } = await bucket.upload(filePath, optimizedFile, {
        contentType: optimizedFile.type,
        upsert: false,
      });
      if (uploadError) throw uploadError;

      const { error: updateError } = await supabase
        .from('offer_product_variants')
        .update({ offer_image_path: filePath })
        .eq('id', variant.id);
      if (updateError) {
        await bucket.remove([filePath]);
        throw updateError;
      }

      if (variant.offer_image_path) await bucket.remove([variant.offer_image_path]);
      const { data } = await bucket.createSignedUrl(filePath, 3600);
      setVariantImageUrls((current) => ({
        ...current,
        [variant.id]: data?.signedUrl || localPreview,
      }));
      setProductVariants((current) =>
        current.map((item) =>
          item.id === variant.id ? { ...item, offer_image_path: filePath } : item,
        ),
      );
      showSnackbar('Zdjęcie wariantu zostało zapisane', 'success');
    } catch (err: any) {
      setVariantImageUrls((current) => {
        const next = { ...current };
        if (previousUrl) next[variant.id] = previousUrl;
        else delete next[variant.id];
        return next;
      });
      showSnackbar(err.message || 'Błąd przesyłania zdjęcia wariantu', 'error');
    } finally {
      if (localPreview) URL.revokeObjectURL(localPreview);
      setUploadingVariantImageId(null);
    }
  };

  const handleDeleteVariantImage = async (variant: IProductVariant) => {
    if (!variant.offer_image_path || variant.id.startsWith('temp-')) return;
    if (!confirm(`Usunąć zdjęcie wariantu „${variant.name}”?`)) return;

    try {
      setUploadingVariantImageId(variant.id);
      const { error } = await supabase
        .from('offer_product_variants')
        .update({ offer_image_path: null })
        .eq('id', variant.id);
      if (error) throw error;
      await bucket.remove([variant.offer_image_path]);
      setProductVariants((current) =>
        current.map((item) =>
          item.id === variant.id ? { ...item, offer_image_path: null } : item,
        ),
      );
      setVariantImageUrls((current) => {
        const next = { ...current };
        delete next[variant.id];
        return next;
      });
      showSnackbar('Zdjęcie wariantu zostało usunięte', 'success');
    } catch (err: any) {
      showSnackbar(err.message || 'Nie udało się usunąć zdjęcia wariantu', 'error');
    } finally {
      setUploadingVariantImageId(null);
    }
  };

  const handleDeleteOfferImage = async () => {
    if (!product?.offer_image_path || productId === 'new') return;
    if (!confirm('Czy na pewno chcesz usunąć grafikę używaną w ofercie?')) return;

    try {
      setUploadingOfferImage(true);
      const imagePath = product.offer_image_path;
      const { error: updateError } = await supabase
        .from('offer_products')
        .update({ offer_image_path: null })
        .eq('id', product.id);
      if (updateError) throw updateError;

      await bucket.remove([imagePath]);
      setOfferImageSrc(null);
      setProduct((current) => (current ? { ...current, offer_image_path: null } : current));
      showSnackbar('Grafika produktu została usunięta', 'success');
    } catch (err: any) {
      showSnackbar(err.message || 'Błąd usuwania grafiki', 'error');
    } finally {
      setUploadingOfferImage(false);
    }
  };

  const handleGenerateOfferCopy = async () => {
    if (!product || productId === 'new') return;

    try {
      setGeneratingOfferCopy(true);
      setOfferAiDraft(null);
      const { data, error } = await supabase.functions.invoke('assist-inquiry', {
        body: {
          action: 'draft_product_offer_content',
          productId: product.id,
          currentContent: {
            short_description: product.offer_short_description || '',
            description: product.offer_description || '',
            benefits: product.offer_benefits || [],
            image_alt: product.offer_image_alt || '',
          },
        },
      });
      if (error) {
        let errorMessage = error.message;
        const response = (error as any).context;
        if (response instanceof Response) {
          const payload = await response
            .clone()
            .json()
            .catch(() => null);
          if (payload?.error) errorMessage = payload.error;
        }
        throw new Error(errorMessage);
      }
      if (!data?.result) throw new Error('AI nie zwróciło propozycji treści');

      setOfferAiDraft(data.result as ProductOfferAiDraft);
    } catch (err: any) {
      showSnackbar(err.message || 'Nie udało się przygotować propozycji AI', 'error');
    } finally {
      setGeneratingOfferCopy(false);
    }
  };

  const handleApplyOfferAiDraft = () => {
    if (!offerAiDraft) return;
    setProduct((current) =>
      current
        ? {
            ...current,
            offer_short_description: offerAiDraft.short_description,
            offer_description: offerAiDraft.description,
            offer_benefits: offerAiDraft.benefits,
            offer_image_alt: offerAiDraft.image_alt,
          }
        : current,
    );
    setOfferAiDraft(null);
    showSnackbar(
      'Propozycję przeniesiono do formularza. Zapisz produkt, aby ją zatwierdzić.',
      'info',
    );
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

    if (!confirm('Czy na pewno chcesz usunąć stronę PDF tego produktu (wraz z miniaturką)?'))
      return;

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

      setProduct((p) => (p ? { ...p, pdf_page_url: null, pdf_thumbnail_url: null } : p));
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

      const productPageUrl = product.product_page_url?.trim() || '';
      if (productPageUrl) {
        try {
          const parsedProductPageUrl = new URL(productPageUrl);
          if (!['http:', 'https:'].includes(parsedProductPageUrl.protocol)) throw new Error();
        } catch {
          throw new Error('Wklej pełny link rozpoczynający się od https:// lub http://');
        }
      }

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
        offer_short_description: product.offer_short_description || null,
        offer_description: product.offer_description || null,
        service_duration_hours: product.service_duration_hours == null
          ? null
          : Number(product.service_duration_hours),
        extension_price_net_per_hour: product.extension_price_net_per_hour == null
          ? null
          : Number(product.extension_price_net_per_hour),
        offer_benefits: product.offer_benefits || [],
        offer_requirements: product.offer_requirements || [],
        offer_image_path: product.offer_image_path || null,
        offer_image_alt: product.offer_image_alt || null,
        offer_image_position_x: Number(product.offer_image_position_x ?? 50),
        offer_image_position_y: Number(product.offer_image_position_y ?? 25),
        offer_image_zoom: normalizeOfferImageScale(product.offer_image_zoom),
        product_page_url: productPageUrl || null,
        offer_page_variant: product.offer_page_variant || 'default',
        offer_page_enabled: product.offer_page_enabled !== false,
        is_subcontractor_service: product.is_subcontractor_service || false,
        subcontractor_id: product.subcontractor_id || null,
        subcontractor_service_catalog_id: product.subcontractor_service_catalog_id || null,
        subcontractor_settlement_method: product.subcontractor_settlement_method || null,
        subcontractor_economic_cost: product.subcontractor_economic_cost ?? null,
      };

      const persistVariants = async (savedProductId: string) => {
        const variants = productVariants.slice(0, 3).map((variant, index) => ({
          ...variant,
          name: variant.name.trim(),
          short_description: variant.short_description?.trim() || null,
          description: variant.description?.trim() || null,
          benefits: (variant.benefits || []).map((item) => item.trim()).filter(Boolean),
          price_net: Number(variant.price_net || 0),
          price_gross: Number(variant.price_gross || 0),
          service_duration_hours: variant.service_duration_hours == null
            ? null
            : Number(variant.service_duration_hours),
          extension_price_net_per_hour: variant.extension_price_net_per_hour == null
            ? null
            : Number(variant.extension_price_net_per_hour),
          is_recommended: productVariants.some((item) => item.is_recommended)
            ? variant.is_recommended
            : index === 0,
          is_active: true,
          display_order: index,
        }));

        if (variants.some((variant) => !variant.name)) {
          throw new Error('Każdy wariant musi mieć nazwę');
        }
        const normalizedNames = variants.map((variant) => variant.name.toLocaleLowerCase('pl-PL'));
        if (new Set(normalizedNames).size !== normalizedNames.length) {
          throw new Error('Nazwy wariantów produktu muszą być unikalne');
        }

        const { data: existingVariants, error: existingError } = await supabase
          .from('offer_product_variants')
          .select('id')
          .eq('product_id', savedProductId);
        if (existingError) throw existingError;

        const persistedIds = variants
          .map((variant) => variant.id)
          .filter((id) => id && !id.startsWith('temp-'));
        const removedIds = (existingVariants || [])
          .map((variant) => variant.id)
          .filter((id) => !persistedIds.includes(id));

        if (removedIds.length > 0) {
          const { error } = await supabase
            .from('offer_product_variants')
            .delete()
            .in('id', removedIds);
          if (error) throw error;
        }

        const existingPayload = variants
          .filter((variant) => !variant.id.startsWith('temp-'))
          .map(({ id, ...variant }) => ({ ...variant, id, product_id: savedProductId }));
        const newPayload = variants
          .filter((variant) => variant.id.startsWith('temp-'))
          .map(({ id: _temporaryId, ...variant }) => ({ ...variant, product_id: savedProductId }));

        if (existingPayload.length > 0) {
          const { error } = await supabase
            .from('offer_product_variants')
            .upsert(existingPayload, { onConflict: 'id' });
          if (error) throw error;
        }
        if (newPayload.length > 0) {
          const { error } = await supabase.from('offer_product_variants').insert(newPayload);
          if (error) throw error;
        }
      };

      if (productId === 'new') {
        const { data, error } = await supabase
          .from('offer_products')
          .insert(productData)
          .select()
          .single();

        if (error) throw error;

        await persistVariants(data.id);

        showSnackbar('Produkt został dodany', 'success');
        router.push(`/crm/offers/products/${data.id}`);
      } else {
        const { error } = await supabase
          .from('offer_products')
          .update(productData)
          .eq('id', product.id);
        if (error) throw error;

        await persistVariants(product.id);

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
  }, [
    canEdit,
    product?.pdf_page_url,
    product?.pdf_thumbnail_url,
    uploadingPdf,
    uploadingThumbnail,
    handleUploadPdf,
    handleUploadThumbnail,
    handleDeletePdf,
  ]);

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
              disabled={saving || uploadingOfferImage}
              className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {uploadingOfferImage
                ? 'Zapisywanie grafiki...'
                : saving
                  ? 'Zapisywanie...'
                  : productId === 'new'
                    ? 'Dodaj produkt'
                    : 'Zapisz zmiany'}
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
        {/* Subcontractor Import (tylko w trybie NEW) */}
        {productId === 'new' && (
          <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
            <div className="mb-4 flex items-center gap-2">
              <Building2 className="h-5 w-5 text-[#d3bb73]" />
              <h2 className="text-lg font-medium text-[#e5e4e2]">Import usługi od podwykonawcy</h2>
            </div>

            <div className="space-y-4">
              <p className="text-sm text-[#e5e4e2]/60">
                Zaznacz poniżej, jeśli chcesz stworzyć produkt bazujący na usłudze podwykonawcy
              </p>

              <div>
                <label className="mb-2 flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={product?.is_subcontractor_service || false}
                    onChange={(e) => {
                      setProduct({ ...product!, is_subcontractor_service: e.target.checked });
                      if (!e.target.checked) {
                        setSelectedSubcontractor('');
                        setSelectedService('');
                      }
                    }}
                    disabled={!canEdit}
                    className="h-4 w-4 rounded border-[#d3bb73]/20 bg-[#0a0d1a] text-[#d3bb73] focus:ring-[#d3bb73]"
                  />
                  <span className="text-sm text-[#e5e4e2]">To jest usługa od podwykonawcy</span>
                </label>
              </div>

              {product?.is_subcontractor_service && (
                <>
                  <div>
                    <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                      Wybierz podwykonawcę
                    </label>
                    <select
                      value={selectedSubcontractor}
                      onChange={(e) => setSelectedSubcontractor(e.target.value)}
                      disabled={!canEdit || loadingSubcontractors}
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] disabled:opacity-50"
                    >
                      <option value="">-- Wybierz podwykonawcę --</option>
                      {subcontractors.map((org) => (
                        <option key={org.id} value={org.id}>
                          {org.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {selectedSubcontractor && (
                    <div>
                      <label className="mb-2 block text-sm text-[#e5e4e2]/60">Wybierz usługę</label>
                      <select
                        value={selectedService}
                        onChange={(e) => setSelectedService(e.target.value)}
                        disabled={!canEdit}
                        className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] disabled:opacity-50"
                      >
                        <option value="">-- Wybierz usługę --</option>
                        {subcontractorServices.map((item) => {
                          const isEquipment = (item as any)._type === 'equipment';
                          const price = isEquipment
                            ? (item as any).rental_price_per_day
                            : (item as any).unit_price;
                          const unit = isEquipment ? 'dzień' : (item as any).unit || 'szt';
                          const badge = isEquipment ? '[WYNAJEM] ' : '[USŁUGA] ';

                          return (
                            <option key={item.id} value={item.id}>
                              {badge}
                              {item.name} - {price?.toLocaleString('pl-PL') || '0'} zł / {unit}
                            </option>
                          );
                        })}
                      </select>
                    </div>
                  )}

                  {selectedService && (
                    <button
                      onClick={handleImportServiceFromSubcontractor}
                      className="w-full rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
                    >
                      Importuj usługę
                    </button>
                  )}

                  {selectedSubcontractor && (
                    <a
                      href={`/crm/contacts/${selectedSubcontractor}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-sm text-[#d3bb73] transition-colors hover:text-[#d3bb73]/80"
                    >
                      <ExternalLink className="h-4 w-4" />
                      Otwórz kartę podwykonawcy
                    </a>
                  )}
                </>
              )}
            </div>
          </div>
        )}

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
                  setProduct({
                    ...product,
                    category_id: e.target.value === '' ? '' : e.target.value,
                  })
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

            {/* Sekcja Podwykonawcy */}
            <div className="space-y-3 rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] p-4">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={product?.is_subcontractor_service || false}
                  onChange={(e) => {
                    const isChecked = e.target.checked;
                    setProduct({
                      ...product,
                      is_subcontractor_service: isChecked,
                      subcontractor_id: isChecked ? product.subcontractor_id : null,
                      subcontractor_service_catalog_id: isChecked
                        ? product.subcontractor_service_catalog_id
                        : null,
                      subcontractor_settlement_method: isChecked
                        ? product.subcontractor_settlement_method
                        : null,
                      subcontractor_economic_cost: isChecked
                        ? product.subcontractor_economic_cost
                        : null,
                    });
                    if (!isChecked) {
                      setSelectedSubcontractor('');
                      setSelectedService('');
                    }
                  }}
                  disabled={!canEdit}
                  className="h-4 w-4 rounded border-[#d3bb73]/20 bg-[#0f1119] text-[#d3bb73]"
                />
                <span className="text-sm font-medium text-[#e5e4e2]">Usługa od podwykonawcy</span>
              </label>

              {product?.is_subcontractor_service && (
                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-xs text-[#e5e4e2]/60">Podwykonawca</label>
                    <select
                      value={selectedSubcontractor}
                      onChange={(e) => {
                        const val = e.target.value;
                        setSelectedSubcontractor(val);
                        setProduct({ ...product, subcontractor_id: val || null });
                      }}
                      disabled={!canEdit || loadingSubcontractors}
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-sm text-[#e5e4e2]"
                    >
                      <option value="">-- Wybierz podwykonawcę --</option>
                      {subcontractors.map((org) => (
                        <option key={org.id} value={org.id}>
                          {org.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {selectedSubcontractor && (
                    <div>
                      <label className="mb-1 block text-xs text-[#e5e4e2]/60">Usługa</label>
                      <select
                        value={selectedService}
                        onChange={(e) => {
                          const val = e.target.value;
                          setSelectedService(val);
                          setProduct({ ...product, subcontractor_service_catalog_id: val || null });
                        }}
                        disabled={!canEdit}
                        className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-sm text-[#e5e4e2]"
                      >
                        <option value="">-- Wybierz usługę --</option>
                        {subcontractorServices.map((item) => {
                          const isEquip = (item as any)._type === 'equipment';
                          const price = isEquip
                            ? (item as any).rental_price_per_day
                            : (item as any).unit_price;
                          const unit = isEquip ? 'dzień' : (item as any).unit || 'szt';
                          const badge = isEquip ? '[WYNAJEM] ' : '[USŁUGA] ';
                          const economicCost = Number((item as any).economic_cost ?? price ?? 0);
                          const cashCostLabel =
                            !isEquip && (item as any).settlement_method === 'cash_non_deductible'
                              ? ` · koszt firmy ${economicCost.toLocaleString('pl-PL')} zł`
                              : '';
                          return (
                            <option key={item.id} value={item.id}>
                              {badge}
                              {item.name} - {price?.toLocaleString('pl-PL') || '0'} zł / {unit}
                              {cashCostLabel}
                            </option>
                          );
                        })}
                      </select>
                    </div>
                  )}
                </div>
              )}
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
                  onChange={(e) =>
                    setProduct({ ...product, min_quantity: toNumber(e.target.value) })
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

        <ProductPricingPanel
          product={product}
          canEdit={canEdit}
          onChange={setProduct}
          className="hidden lg:block"
        />

        {/* Presentation in generated offer */}
        <div className="lg:col-span-2">
          <ProductVariantsEditor
            variants={productVariants}
            vatRate={product.vat_rate}
            defaultServiceDurationHours={product.service_duration_hours}
            defaultExtensionPriceNetPerHour={product.extension_price_net_per_hour}
            disabled={!canEdit}
            onChange={setProductVariants}
            imageUrls={variantImageUrls}
            uploadingImageId={uploadingVariantImageId}
            onImageUpload={handleUploadVariantImage}
            onImageDelete={handleDeleteVariantImage}
          />
        </div>

        {/* Presentation in generated offer */}
        <div className="rounded-xl border border-[#7f1734]/40 bg-[#1c1f33] p-6 lg:col-span-2">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <ImageIcon className="h-5 w-5 text-[#b94b69]" />
              <h2 className="text-lg font-medium text-[#e5e4e2]">Prezentacja w ofercie PDF</h2>
            </div>
            {canEdit && productId !== 'new' && (
              <button
                type="button"
                onClick={handleGenerateOfferCopy}
                disabled={generatingOfferCopy}
                className="flex items-center gap-2 rounded-lg border border-violet-400/30 bg-violet-400/10 px-4 py-2 text-sm text-violet-300 transition-colors hover:bg-violet-400/20 disabled:opacity-50"
              >
                {generatingOfferCopy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                {generatingOfferCopy ? 'Przygotowywanie...' : 'Zaproponuj treść z AI'}
              </button>
            )}
          </div>
          <p className="mb-5 text-sm text-[#e5e4e2]/60">
            Te zatwierdzone dane z CRM zasilają dynamiczną kartę produktu. AI przygotowuje wyłącznie
            roboczą propozycję tekstu i nie zmienia cen, ilości ani terminów.
          </p>

          {product.pdf_page_url && (
            <div className="mb-5 rounded-lg border border-amber-400/25 bg-amber-400/10 p-3 text-sm text-amber-200">
              Ten produkt ma własną stronę PDF, więc generator użyje jej w pierwszej kolejności.
              Usuń statyczny PDF w sekcji poniżej, aby przełączyć produkt na kartę dynamiczną.
            </div>
          )}

          {offerAiDraft && (
            <div className="mb-5 rounded-lg border border-violet-400/30 bg-violet-400/10 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium text-violet-200">Robocza propozycja AI</h3>
                  <p className="text-xs text-violet-200/60">
                    Sprawdź treść. Zastosowanie wypełni formularz, ale nie zapisze produktu.
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setOfferAiDraft(null)}
                    className="rounded-lg px-3 py-2 text-xs text-[#e5e4e2]/70 hover:bg-white/10"
                  >
                    Odrzuć
                  </button>
                  <button
                    type="button"
                    onClick={handleApplyOfferAiDraft}
                    className="rounded-lg bg-violet-400 px-3 py-2 text-xs font-medium text-[#1c1f33] hover:bg-violet-300"
                  >
                    Zastosuj do formularza
                  </button>
                </div>
              </div>
              <p className="text-sm font-medium text-[#e5e4e2]">{offerAiDraft.short_description}</p>
              <p className="mt-2 whitespace-pre-wrap text-sm text-[#e5e4e2]/70">
                {offerAiDraft.description}
              </p>
              {offerAiDraft.benefits.length > 0 && (
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-[#e5e4e2]/70">
                  {offerAiDraft.benefits.map((benefit, index) => (
                    <li key={`${benefit}-${index}`}>{benefit}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
            <div className="space-y-4">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={product.offer_page_enabled !== false}
                  onChange={(e) => setProduct({ ...product, offer_page_enabled: e.target.checked })}
                  disabled={!canEdit}
                  className="h-4 w-4 rounded border-[#d3bb73]/20 bg-[#0a0d1a] text-[#7f1734]"
                />
                <span className="text-sm text-[#e5e4e2]">
                  Dodawaj dynamiczną kartę tego produktu
                </span>
              </label>

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Krótki opis / lead</label>
                <input
                  type="text"
                  value={product.offer_short_description || ''}
                  onChange={(e) =>
                    setProduct({ ...product, offer_short_description: e.target.value })
                  }
                  disabled={!canEdit}
                  maxLength={220}
                  placeholder="Jedno zdanie wyjaśniające wartość produktu"
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] disabled:opacity-50"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Opis dla klienta</label>
                <textarea
                  value={product.offer_description || ''}
                  onChange={(e) => setProduct({ ...product, offer_description: e.target.value })}
                  disabled={!canEdit}
                  className="min-h-[140px] w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] disabled:opacity-50"
                  placeholder="Zakres, sposób realizacji i najważniejsze informacje dla klienta"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                    Czas usługi (godziny)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={product.service_duration_hours ?? ''}
                    onChange={(event) => setProduct({
                      ...product,
                      service_duration_hours: event.target.value === ''
                        ? null
                        : Number(event.target.value),
                    })}
                    disabled={!canEdit}
                    placeholder="np. 6"
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] disabled:opacity-50"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                    Każda dodatkowa godzina netto
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={product.extension_price_net_per_hour ?? ''}
                    onChange={(event) => setProduct({
                      ...product,
                      extension_price_net_per_hour: event.target.value === ''
                        ? null
                        : Number(event.target.value),
                    })}
                    disabled={!canEdit}
                    placeholder="np. 500"
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] disabled:opacity-50"
                  />
                </div>
              </div>
              <p className="-mt-2 text-xs leading-5 text-[#e5e4e2]/40">
                Wartości główne dotyczą całej usługi. W wariancie możesz je nadpisać,
                jeśli Standard, Premium lub VIP mają inne warunki.
              </p>

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                  Korzyści <span className="text-xs text-[#e5e4e2]/40">(jedna w wierszu)</span>
                </label>
                <textarea
                  value={(product.offer_benefits || []).join('\n')}
                  onChange={(e) =>
                    setProduct({
                      ...product,
                      offer_benefits: e.target.value
                        .split('\n')
                        .map((item) => item.trim())
                        .filter(Boolean),
                    })
                  }
                  disabled={!canEdit}
                  className="min-h-[120px] w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] disabled:opacity-50"
                  placeholder={
                    'Czytelny obraz dla uczestników\nObsługa techniczna podczas wydarzenia'
                  }
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                  Wymagania po stronie klienta / obiektu{' '}
                  <span className="text-xs text-[#e5e4e2]/40">(jedno w wierszu)</span>
                </label>
                <textarea
                  value={(product.offer_requirements || []).join('\n')}
                  onChange={(e) =>
                    setProduct({
                      ...product,
                      offer_requirements: e.target.value
                        .split('\n')
                        .map((item) => item.trim())
                        .filter(Boolean),
                    })
                  }
                  disabled={!canEdit}
                  className="min-h-[110px] w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] disabled:opacity-50"
                  placeholder={
                    'Stabilne łącze internetowe po kablu Ethernet\nZasilanie 230 V / 16 A\nPrzy większych realizacjach: dostęp do zasilania 400 V (siła)'
                  }
                />
                <p className="mt-1 text-xs text-[#e5e4e2]/40">
                  Te informacje zostaną pokazane klientowi na karcie produktu w wygenerowanej
                  ofercie.
                </p>
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Link „Zobacz więcej”</label>
                <input
                  type="url"
                  value={product.product_page_url || ''}
                  onChange={(e) => setProduct({ ...product, product_page_url: e.target.value })}
                  disabled={!canEdit}
                  placeholder="https://mavinci.pl/uslugi/streaming lub https://www.eventrulers.pl/..."
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] disabled:opacity-50"
                />
                <p className="mt-1 text-xs text-[#e5e4e2]/40">
                  W PDF pojawi się klikalny odnośnik do rozszerzonego opisu i galerii produktu.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm text-[#e5e4e2]/60">Wariant strony</label>
                  <select
                    value={product.offer_page_variant || 'default'}
                    onChange={(e) => setProduct({ ...product, offer_page_variant: e.target.value })}
                    disabled={!canEdit}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] disabled:opacity-50"
                  >
                    <option value="default">Domyślny</option>
                    <option value="compact">Kompaktowy - do 3 produktów na stronie</option>
                    <option value="visual">Duża grafika</option>
                  </select>
                  <p className="mt-1 text-xs text-[#e5e4e2]/40">
                    Wariant kompaktowy grupuje kolejne produkty po maksymalnie trzy na jednej
                    stronie PDF.
                  </p>
                </div>
                <div>
                  <label className="mb-2 block text-sm text-[#e5e4e2]/60">Opis grafiki</label>
                  <input
                    type="text"
                    value={product.offer_image_alt || ''}
                    onChange={(e) => setProduct({ ...product, offer_image_alt: e.target.value })}
                    disabled={!canEdit}
                    placeholder="Co przedstawia grafika"
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] disabled:opacity-50"
                  />
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-[#d3bb73]/15 bg-[#0a0d1a] p-4">
              <p className="mb-3 text-sm font-medium text-[#e5e4e2]">Grafika na karcie produktu</p>
              <div
                onDragEnter={(event) => {
                  event.preventDefault();
                  if (canEdit && productId !== 'new') setDraggingOfferImage(true);
                }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                    setDraggingOfferImage(false);
                  }
                }}
                onDrop={handleOfferImageDrop}
                className={`relative overflow-hidden rounded-lg border-2 border-dashed transition-colors ${
                  draggingOfferImage
                    ? 'border-[#b94b69] bg-[#7f1734]/20'
                    : 'border-[#e5e4e2]/15 bg-[#1c1f33]'
                }`}
              >
                {offerImageSrc ? (
                  <div className="relative aspect-[4/3] w-full overflow-hidden rounded-t-lg bg-black/20">
                    {normalizeOfferImageScale(product.offer_image_zoom) < 1 && (
                      <Image
                        src={offerImageSrc}
                        alt=""
                        fill
                        unoptimized
                        aria-hidden
                        className="scale-110 object-cover opacity-55 blur-lg"
                        style={{
                          objectPosition: `${Number(product.offer_image_position_x ?? 50)}% ${Number(product.offer_image_position_y ?? 25)}%`,
                        }}
                      />
                    )}
                    <Image
                      src={offerImageSrc}
                      alt={product.offer_image_alt || product.name}
                      fill
                      unoptimized
                      className={`z-10 transition-transform duration-150 ${
                        normalizeOfferImageScale(product.offer_image_zoom) < 1
                          ? 'object-contain'
                          : 'object-cover'
                      }`}
                      style={{
                        objectPosition: `${Number(product.offer_image_position_x ?? 50)}% ${Number(product.offer_image_position_y ?? 25)}%`,
                        transform: `scale(${normalizeOfferImageScale(product.offer_image_zoom)})`,
                      }}
                    />
                  </div>
                ) : (
                  <div className="flex aspect-[4/3] flex-col items-center justify-center gap-3 text-center">
                    <ImageIcon className="h-12 w-12 text-[#e5e4e2]/15" />
                    <span className="px-4 text-xs text-[#e5e4e2]/40">
                      {productId === 'new'
                        ? 'Najpierw zapisz produkt'
                        : 'Przeciągnij tutaj plik PNG lub JPG'}
                    </span>
                  </div>
                )}

                {uploadingOfferImage && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#0a0d1a]/75 text-white backdrop-blur-sm">
                    <Loader2 className="h-8 w-8 animate-spin text-[#b94b69]" />
                    <span className="text-sm">Zapisywanie grafiki...</span>
                  </div>
                )}

                {draggingOfferImage && !uploadingOfferImage && (
                  <div className="absolute inset-0 flex items-center justify-center bg-[#7f1734]/65 text-sm font-medium text-white backdrop-blur-sm">
                    Upuść, aby zapisać grafikę
                  </div>
                )}
              </div>

              {canEdit && productId !== 'new' && (
                <div className="mt-4 space-y-3">
                  <label
                    htmlFor={`offer-image-${product.id}`}
                    className={`flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-[#7f1734] px-3 py-2 text-sm text-white hover:bg-[#941d3e] ${
                      uploadingOfferImage ? 'pointer-events-none opacity-50' : ''
                    }`}
                  >
                    <Upload className="h-4 w-4" />
                    {offerImageSrc ? 'Zmień grafikę' : 'Wybierz grafikę'}
                  </label>
                  <input
                    id={`offer-image-${product.id}`}
                    type="file"
                    accept="image/png,image/jpeg"
                    disabled={uploadingOfferImage}
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      if (file) await handleUploadOfferImage(file);
                      event.target.value = '';
                    }}
                    className="hidden"
                  />
                  {offerImageSrc && (
                    <>
                      <div className="space-y-3 rounded-lg border border-[#d3bb73]/15 bg-[#111421] p-3">
                        <p className="text-xs font-medium uppercase tracking-wide text-[#d3bb73]">
                          Kadrowanie w ofercie
                        </p>
                        <label className="block text-xs text-[#e5e4e2]/55">
                          Poziom: {Math.round(Number(product.offer_image_position_x ?? 50))}%
                          <input
                            type="range"
                            min="0"
                            max="100"
                            value={Number(product.offer_image_position_x ?? 50)}
                            onChange={(event) =>
                              setProduct({
                                ...product,
                                offer_image_position_x: Number(event.target.value),
                              })
                            }
                            className="mt-1 w-full accent-[#d3bb73]"
                          />
                        </label>
                        <label className="block text-xs text-[#e5e4e2]/55">
                          Pion: {Math.round(Number(product.offer_image_position_y ?? 25))}%
                          <input
                            type="range"
                            min="0"
                            max="100"
                            value={Number(product.offer_image_position_y ?? 25)}
                            onChange={(event) =>
                              setProduct({
                                ...product,
                                offer_image_position_y: Number(event.target.value),
                              })
                            }
                            className="mt-1 w-full accent-[#d3bb73]"
                          />
                        </label>
                        <label className="block text-xs text-[#e5e4e2]/55">
                          Skala:{' '}
                          {Math.round(normalizeOfferImageScale(product.offer_image_zoom) * 100)}%
                          <input
                            type="range"
                            min="0.5"
                            max="3"
                            step="0.05"
                            value={normalizeOfferImageScale(product.offer_image_zoom)}
                            onChange={(event) =>
                              setProduct({
                                ...product,
                                offer_image_zoom: Number(event.target.value),
                              })
                            }
                            className="mt-1 w-full accent-[#d3bb73]"
                          />
                        </label>
                        <div className="flex items-center justify-between gap-3 text-[11px] text-[#e5e4e2]/35">
                          <span>50% — pomniejszenie</span>
                          <button
                            type="button"
                            onClick={() => setProduct({ ...product, offer_image_zoom: 1 })}
                            className="rounded border border-[#d3bb73]/20 px-2 py-1 text-[#d3bb73] hover:bg-[#d3bb73]/10"
                          >
                            Ustaw 100%
                          </button>
                          <span>300% — powiększenie</span>
                        </div>
                        <p className="text-[11px] leading-4 text-[#e5e4e2]/35">
                          Poniżej 100% zdjęcie jest pomniejszane wewnątrz stałego kadru, a jego tło
                          nadal wypełnia cały obszar.
                        </p>
                        <p className="text-[11px] text-[#e5e4e2]/35">
                          Ustawienia zatwierdzisz przyciskiem „Zapisz zmiany”.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleDeleteOfferImage}
                        disabled={uploadingOfferImage}
                        className="flex w-full items-center justify-center gap-2 rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-300 hover:bg-red-500/25 disabled:opacity-50"
                      >
                        <Trash2 className="h-4 w-4" />
                        Usuń grafikę
                      </button>
                    </>
                  )}
                  <p className="text-xs text-[#e5e4e2]/40">
                    PNG lub JPG, maksymalnie 10 MB. Plik zapisuje się automatycznie po wybraniu lub
                    upuszczeniu.
                  </p>
                </div>
              )}
              {productId === 'new' && (
                <p className="mt-3 text-xs text-[#e5e4e2]/40">
                  Najpierw zapisz nowy produkt, aby dodać grafikę i użyć AI.
                </p>
              )}
            </div>
          </div>
        </div>

        <ProductOfferCardPreview
          product={{ ...product, offer_product_variants: productVariants }}
          imageUrl={offerImageSrc}
          variantImageUrls={variantImageUrls}
        />

        {persistedProductVariants.length > 0 && (
          <section className="rounded-xl border border-[#d3bb73]/25 bg-[#1c1f33] p-6 lg:col-span-2">
            <div className="grid gap-4 lg:grid-cols-[minmax(280px,420px)_1fr] lg:items-end">
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[.16em] text-[#d3bb73]">
                  Konfigurowany zakres produktu
                </label>
                <select
                  value={configurationVariantId || ''}
                  onChange={(event) => setConfigurationVariantId(event.target.value || null)}
                  disabled={Boolean(configuringSection)}
                  className="w-full rounded-lg border border-[#d3bb73]/25 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2] disabled:opacity-50"
                >
                  <option value="">Produkt bazowy — główny zakres oferty</option>
                  {persistedProductVariants.map((variant) => (
                    <option key={variant.id} value={variant.id}>
                      Wariant: {variant.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <p className="text-sm text-[#e5e4e2]/65">
                  {selectedConfigurationVariant
                    ? `Poniższe sekcje pokazują konfigurację wariantu „${selectedConfigurationVariant.name}”. Sekcja bez własnych zmian dziedziczy dane produktu bazowego.`
                    : 'Poniższe sekcje tworzą główny zakres produktu używany bez wariantu oraz dziedziczony przez warianty.'}
                </p>
                {selectedConfigurationVariant && (
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                    {[
                      ['Sprzęt', selectedConfigurationVariant.overrides_equipment],
                      ['Pracownicy', selectedConfigurationVariant.overrides_staff],
                      ['Mavinci Live', selectedConfigurationVariant.overrides_mavinci_live],
                      ['Klauzule', selectedConfigurationVariant.overrides_contract_clauses],
                    ].map(([label, overridden]) => (
                      <span
                        key={String(label)}
                        className={`rounded-full px-2.5 py-1 ${
                          overridden
                            ? 'bg-[#d3bb73]/15 text-[#d3bb73]'
                            : 'bg-white/5 text-[#e5e4e2]/45'
                        }`}
                      >
                        {label}: {overridden ? 'własne' : 'dziedziczone'}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* Pricing */}
        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6 lg:hidden">
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
                    margin > 50
                      ? 'text-green-400'
                      : margin > 30
                        ? 'text-yellow-400'
                        : 'text-red-400'
                  }`}
                >
                  {margin.toFixed(1)}% (
                  {Number((priceNet - costNet).toFixed(2)).toLocaleString('pl-PL')} zł netto)
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
                Upload pojedynczej strony PDF dla tego produktu. Strona zostanie automatycznie
                dołączona do finalnej oferty.
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
                            src={
                              thumbSrc ??
                              bucket.getPublicUrl(product.pdf_thumbnail_url).data.publicUrl
                            }
                            alt="Podgląd PDF"
                            className="w-full rounded-lg border border-[#d3bb73]/20 transition-colors hover:border-[#d3bb73]/40"
                            width={400}
                            height={520}
                            sizes="200px"
                            priority
                            onError={async () => {
                              // fallback tylko jeśli publicUrl nie działa (np. prywatny bucket)
                              const { data } = await bucket.createSignedUrl(
                                product.pdf_thumbnail_url!,
                                3600,
                              );
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
                              Wybrany plik: {thumbnailFile.name} (
                              {(thumbnailFile.size / 1024).toFixed(2)} KB)
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : canEdit ? (
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
              ) : null}

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

            <p className="mt-1 text-xs text-[#e5e4e2]/40">
              Tagi pomagają w wyszukiwaniu produktów w ofercie
            </p>
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

      {/* Subcontractor Info (w trybie edycji) */}
      {productId !== 'new' && product?.is_subcontractor_service && (
        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          <div className="mb-4 flex items-center gap-2">
            <Building2 className="h-5 w-5 text-[#d3bb73]" />
            <h2 className="text-lg font-medium text-[#e5e4e2]">Informacje o podwykonawcy</h2>
          </div>

          <div className="space-y-4">
            <div className="rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] p-4">
              <div className="mb-2 flex items-center gap-2">
                <Building2 className="h-5 w-5 text-[#d3bb73]" />
                <span className="text-sm font-medium text-[#e5e4e2]">Usługa od podwykonawcy</span>
              </div>
              <p className="text-sm text-[#e5e4e2]/60">
                Ten produkt jest powiązany z usługą świadczoną przez podwykonawcę
              </p>
            </div>

            {product.subcontractor_id && (
              <a
                href={`/crm/contacts/${product.subcontractor_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-[#d3bb73] transition-colors hover:text-[#d3bb73]/80"
              >
                <ExternalLink className="h-4 w-4" />
                Otwórz kartę podwykonawcy
              </a>
            )}
          </div>
        </div>
      )}

      {/* Equipment */}
      {productId !== 'new' && (
        <ProductEquipment
          canEdit={canEdit}
          setShowAddEquipmentModal={setShowAddEquipmentModal}
          productVariantId={selectedConfigurationVariant?.id || null}
          productVariantName={selectedConfigurationVariant?.name || null}
          isInherited={Boolean(
            selectedConfigurationVariant && !selectedConfigurationVariant.overrides_equipment,
          )}
          onCustomizeVariant={() => handleCustomizeVariantSection('equipment')}
          onResetInheritance={() => handleResetVariantSection('equipment')}
        />
      )}

      {/* Mavinci LIVE */}
      {productId !== 'new' && (
        <ProductMavinciLiveModules
          productId={productId}
          productVariantId={selectedConfigurationVariant?.id || null}
          productVariantName={selectedConfigurationVariant?.name || null}
          isInherited={Boolean(
            selectedConfigurationVariant && !selectedConfigurationVariant.overrides_mavinci_live,
          )}
          canEdit={canEdit}
          onCustomizeVariant={() => handleCustomizeVariantSection('mavinci_live')}
          onResetInheritance={() => handleResetVariantSection('mavinci_live')}
        />
      )}

      {/* Staff */}
      {productId !== 'new' && (
        <ProductStaffSection
          productId={productId === 'new' ? null : productId}
          productVariantId={selectedConfigurationVariant?.id || null}
          productVariantName={selectedConfigurationVariant?.name || null}
          isInherited={Boolean(
            selectedConfigurationVariant && !selectedConfigurationVariant.overrides_staff,
          )}
          canEdit={canEdit}
          draftStaff={draftStaff}
          setDraftStaff={setDraftStaff}
          onCustomizeVariant={() => handleCustomizeVariantSection('staff')}
          onResetInheritance={() => handleResetVariantSection('staff')}
        />
      )}

      {/* Contract Clauses */}
      {productId !== 'new' && product && (
        <ProductContractClauses
          productId={productId}
          productVariantId={selectedConfigurationVariant?.id || null}
          productVariantName={selectedConfigurationVariant?.name || null}
          isInherited={Boolean(
            selectedConfigurationVariant &&
            !selectedConfigurationVariant.overrides_contract_clauses,
          )}
          initialClauses={
            selectedConfigurationVariant?.overrides_contract_clauses
              ? selectedConfigurationVariant.recommended_contract_clauses || null
              : product.recommended_contract_clauses || null
          }
          initialCategory={
            selectedConfigurationVariant?.overrides_contract_clauses
              ? selectedConfigurationVariant.recommended_contract_clause_category || 'requirements'
              : product.recommended_contract_clause_category || 'requirements'
          }
          canEdit={canEdit}
          onSave={async (clauses, category) => {
            try {
              const target = selectedConfigurationVariant
                ? supabase
                    .from('offer_product_variants')
                    .update({
                      recommended_contract_clauses: clauses,
                      recommended_contract_clause_category: category,
                      overrides_contract_clauses: true,
                    })
                    .eq('id', selectedConfigurationVariant.id)
                    .eq('product_id', productId)
                : supabase
                    .from('offer_products')
                    .update({
                      recommended_contract_clauses: clauses,
                      recommended_contract_clause_category: category,
                    })
                    .eq('id', productId);

              const { error } = await target;

              if (error) throw error;

              if (selectedConfigurationVariant) {
                setProductVariants((current) =>
                  current.map((variant) =>
                    variant.id === selectedConfigurationVariant.id
                      ? {
                          ...variant,
                          recommended_contract_clauses: clauses,
                          recommended_contract_clause_category: category,
                          overrides_contract_clauses: true,
                        }
                      : variant,
                  ),
                );
              } else {
                setProduct((prev) =>
                  prev
                    ? {
                        ...prev,
                        recommended_contract_clauses: clauses,
                        recommended_contract_clause_category: category,
                      }
                    : prev,
                );
              }

              showSnackbar('Zapisano klauzule umowy', 'success');
            } catch (err: any) {
              console.error('Error saving contract clauses:', err);
              showSnackbar(err?.message || 'Błąd podczas zapisywania klauzul', 'error');
              throw err;
            }
          }}
          onResetInheritance={
            selectedConfigurationVariant
              ? () => handleResetVariantSection('contract_clauses')
              : undefined
          }
        />
      )}

      {/* Add Equipment/Kit Modal */}
      {showAddEquipmentModal && (
        <AddEquipmentModal
          productId={productId}
          productVariantId={effectiveEquipmentVariantId}
          productVariantName={selectedConfigurationVariant?.name || null}
          existingEquipment={items}
          onClose={() => setShowAddEquipmentModal(false)}
          onSuccess={async () => {
            await refetchProductEquipment().unwrap();
            setShowAddEquipmentModal(false);
          }}
        />
      )}
    </div>
  );
}
