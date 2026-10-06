/* eslint-disable react-hooks/exhaustive-deps */
'use client';
import { COMPACT_PRODUCT_DESCRIPTION_LIMIT, compactProductBlockReason } from '@/lib/CRM/Offers/productPresentation';
import ProductRelatedServicesSection from '@/components/crm/offers/ProductRelatedServicesSection';
import { ProductPackageCostSummary } from '@/components/crm/offers/ProductPackageCostsEditor';
import ProductSalesPackagesSection from '@/components/crm/offers/ProductSalesPackagesSection';
import { validateSalesPackages, type ProductSalesPackage } from '@/lib/CRM/Offers/productSalesPackages';
import ProductAddonsSection from '@/components/crm/offers/ProductAddonsSection';
import ProductSettingsDrawer from '@/components/crm/offers/ProductSettingsDrawer';
import ProductDataSection from '@/components/crm/offers/ProductDataSection';
import ProductRequirementsSection, { type OfferAdditionalRequirement } from '@/components/crm/offers/ProductRequirementsSection';
import { validateAddons, type ProductAddon } from '@/lib/CRM/Offers/offerAddons';

import { useEffect, useMemo, useRef, useState } from 'react';
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
import { ProductContractClauses } from '../components/StructuredProductContractClauses';
import { ProductMavinciLiveModules } from '../components/ProductMavinciLiveModules';
import { ProductOfferCardPreview } from '../components/ProductOfferCardPreview';
import { ProductVariantsEditor } from '../components/ProductVariantsEditor';
import { AddEquipmentModal } from '../modal/AddEquipmentModal';
import { useManageProduct } from '../hooks/useManageProduct';
import type {
  ContractClauseCategory,
  IProductVariant,
} from '@/app/(crm)/crm/offers/types';
import { serializeContractClauseEntries } from '@/lib/CRM/contracts/contractClauseContent';
import {
  getOfferRequirementLabel,
  inferOfferRequirementCategory,
} from '@/lib/CRM/Offers/offerRequirements';

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
  related_service_ids?: string[];
  related_service_url?: string | null;
  related_service_label?: string | null;
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
  is_personnel_service?: boolean;
  display_order: number;
  pdf_page_url?: string | null;
  pdf_thumbnail_url?: string | null;
  offer_short_description?: string | null;
  offer_description?: string | null;
  offer_compact_description?: string | null;
  offer_benefits?: string[] | null;
  offer_requirements?: string[] | null;
  offer_additional_requirements?: OfferAdditionalRequirement[] | null;
  offer_image_path?: string | null;
  offer_image_alt?: string | null;
  offer_image_position_x?: number | null;
  offer_image_position_y?: number | null;
  offer_image_zoom?: number | null;
  product_page_url?: string | null;
  sales_packages?: ProductSalesPackage[];
  sales_packages_enabled?: boolean;
  pricing_addons?: ProductAddon[];
  offer_page_variant?: string | null;
  offer_page_enabled?: boolean;
  recommended_contract_clauses?: string | null;
  recommended_contract_clause_category?: ContractClauseCategory;
  category?: IEventCategory;
  is_subcontractor_service?: boolean;
  subcontractor_id?: string | null;
  subcontractor_service_catalog_id?: string | null;
  subcontractor_settlement_method?: 'invoice' | 'cash_documented' | 'cash_non_deductible' | null;
  subcontractor_economic_cost?: number | null;
  offer_product_variants?: IProductVariant[];
}

const normalizeRequirementText = (value: string) => value
  .toLocaleLowerCase('pl-PL')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/ł/g, 'l')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const withCategorizedProductRequirements = (source: IProduct): IProduct => {
  const categorized = [...(source.offer_additional_requirements || [])].map((requirement, index) => {
    const description = String(requirement.description || requirement.title || '').trim();
    const category = inferOfferRequirementCategory(description, requirement.category) as OfferAdditionalRequirement['category'];
    return {
      ...requirement,
      id: requirement.id || `stored-${index}`,
      category,
      title: String(requirement.title || getOfferRequirementLabel(category)).trim(),
      description,
    };
  });
  const known = new Set(categorized.map((requirement) => normalizeRequirementText(requirement.description)));
  (source.offer_requirements || []).forEach((description, index) => {
    const text = String(description || '').trim();
    const fingerprint = normalizeRequirementText(text);
    if (!text || known.has(fingerprint)) return;
    const category = inferOfferRequirementCategory(text) as OfferAdditionalRequirement['category'];
    categorized.push({
      id: `legacy-${index}-${fingerprint.slice(0, 20)}`,
      category,
      title: getOfferRequirementLabel(category),
      description: text,
    });
    known.add(fingerprint);
  });
  return { ...source, offer_additional_requirements: categorized };
};

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
  hideHeading = false,
}: {
  hideHeading?: boolean;
  product: IProduct;
  canEdit: boolean;
  onChange: (next: IProduct) => void;
  className?: string;
}) {
  const packagePricing = Boolean(product.sales_packages_enabled && product.sales_packages?.length);
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
      {!hideHeading && <div className="mb-4 flex items-center gap-2">
        <DollarSign className="h-5 w-5 text-[#d3bb73]" />
        <h2 className="text-lg font-medium text-[#e5e4e2]">Ceny i koszty (netto/brutto)</h2>
      </div>}

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

        {packagePricing ? <p className="text-sm text-[#e5e4e2]/60">Ceny i koszty ustalisz oddzielnie w edycji każdego pakietu. Tutaj ustawiasz wspólną stawkę VAT.</p> : <>
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
        </>}
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
  const [staffCostNet, setStaffCostNet] = useState<number | null>(null);
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
  const [variantDraft, setVariantDraft] = useState<IProductVariant[] | null>(null);
  const [savingVariants, setSavingVariants] = useState(false);
  const [addonsEditing, setAddonsEditing] = useState(false);
  const [savingAddons, setSavingAddons] = useState(false);
  const [requirementsEditing, setRequirementsEditing] = useState(false);
  const [savingRequirements, setSavingRequirements] = useState(false);
  const [editingProductSections, setEditingProductSections] = useState<string[]>([]);
  const [savingProductSection, setSavingProductSection] = useState<string | null>(null);
  const [previewPage, setPreviewPage] = useState<'elements' | 'packages'>('elements');
  const [basicPreview, setBasicPreview] = useState<Partial<IProduct> | null>(null);
  const setSectionEditing = (key: string, editing: boolean) => setEditingProductSections(current => editing ? [...new Set([...current, key])] : current.filter(item => item !== key));
  const visibleVariants = variantDraft ?? productVariants;
  const compactBlockReason = compactProductBlockReason({ ...product, offer_product_variants: visibleVariants });
  const hasIndividualExtensionRates = visibleVariants.some(v => v.is_active !== false)
    || Boolean(product?.sales_packages_enabled && product.sales_packages?.length);
  const effectivePageVariant = product?.offer_page_variant === 'compact' && compactBlockReason
    ? 'default' : product?.offer_page_variant || 'default';
  const variantsEditing = variantDraft !== null;
  const variantImageSnapshot = useRef<Record<string, string>>({});
  const variantDraftImageSnapshot = useRef(new Map<string, { file: File; preview: string }>());
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


  const [uploadingOfferImage, setUploadingOfferImage] = useState(false);
  const [offerImageFile, setOfferImageFile] = useState<File | null>(null);
  const [offerImageSrc, setOfferImageSrc] = useState<string | null>(null);
  const [draggingOfferImage, setDraggingOfferImage] = useState(false);
  const [variantImageUrls, setVariantImageUrls] = useState<Record<string, string>>({});
  const draftVariantImages = useRef(new Map<string, { file: File; preview: string }>());
  const createdProductId = useRef<string | null>(null);

  useEffect(() => () => {
    draftVariantImages.current.forEach(({ preview }) => URL.revokeObjectURL(preview));
    draftVariantImages.current.clear();
    variantDraftImageSnapshot.current.forEach(({ preview }) => URL.revokeObjectURL(preview));
    variantDraftImageSnapshot.current.clear();
  }, []);

  useEffect(() => {
    const activeIds = new Set(visibleVariants.map(variant => variant.id));
    draftVariantImages.current.forEach(({ preview }, id) => {
      if (!activeIds.has(id)) {
        if (variantDraftImageSnapshot.current.get(id)?.preview !== preview) URL.revokeObjectURL(preview);
        draftVariantImages.current.delete(id);
      }
    });
  }, [visibleVariants]);

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
        offer_compact_description: '',
        service_duration_hours: null,
        extension_price_net_per_hour: null,
        offer_benefits: [],
        offer_requirements: [],
        offer_additional_requirements: [],
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
      setProduct(withCategorizedProductRequirements(initialProduct));
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
      visibleVariants.map((variant) => `${variant.id}:${variant.offer_image_path || ''}`).join('|'),
    [visibleVariants],
  );

  useEffect(() => {
    let cancelled = false;

    const loadVariantImages = async () => {
      const entries = await Promise.all(
        visibleVariants.map(async (variant) => {
          if (!variant.offer_image_path || variant.id.startsWith('temp-')) return null;
          const { data } = await bucket.createSignedUrl(variant.offer_image_path, 3600);
          return data?.signedUrl ? ([variant.id, data.signedUrl] as const) : null;
        }),
      );
      if (!cancelled) {
        setVariantImageUrls({
          ...Object.fromEntries(entries.filter(Boolean) as Array<[string, string]>),
          ...Object.fromEntries(Array.from(draftVariantImages.current, ([id, image]) => [id, image.preview])),
        });
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
        setProduct(withCategorizedProductRequirements(data));
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

  const handleUploadOfferImage = async (selectedFile?: File | null) => {
    const file = selectedFile || offerImageFile;
    if (!file || !product || productId === 'new') return;

    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      showSnackbar('Grafika do PDF musi być plikiem PNG, JPG lub WebP', 'error');
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
      const extension =
        optimizedFile.type === 'image/png'
          ? 'png'
          : optimizedFile.type === 'image/webp'
            ? 'webp'
            : 'jpg';
      const filePath = `assets/${product.id}/offer-image-${Date.now()}.${extension}`;

      const { error: uploadError } = await bucket.upload(filePath, optimizedFile, {
        contentType: optimizedFile.type,
        upsert: false,
      });
      if (uploadError) throw uploadError;

      const { error: updateError } = await supabase
        .from('offer_products')
        .update({ offer_image_path: filePath })
        .eq('id', product.id);
      if (updateError) {
        await bucket.remove([filePath]);
        throw updateError;
      }

      // Older images may still be referenced by brochures and offer snapshots.
      // Replacing a catalog image must not delete those immutable assets.
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
    if (!product || !canEdit || !variantsEditing || saving || savingVariants || uploadingVariantImageId) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) {
      showSnackbar('Wybierz zdjęcie PNG, JPG lub WebP o wielkości do 10 MB', 'error');
      return;
    }
    try {
      setUploadingVariantImageId(variant.id);
      const optimizedFile = await optimizeOfferImage(file, { maxWidth: 1800, maxHeight: 1800, quality: 0.82 });
      const previous = draftVariantImages.current.get(variant.id);
      if (previous && variantDraftImageSnapshot.current.get(variant.id)?.preview !== previous.preview) URL.revokeObjectURL(previous.preview);
      const preview = URL.createObjectURL(optimizedFile);
      draftVariantImages.current.set(variant.id, { file: optimizedFile, preview });
      setVariantImageUrls(current => ({ ...current, [variant.id]: preview }));
    } catch (err: any) {
      showSnackbar(err.message || 'Nie udało się przygotować zdjęcia', 'error');
      throw err;
    } finally {
      setUploadingVariantImageId(null);
    }
  };

  const handleDeleteVariantImage = async (variant: IProductVariant) => {
    if (!canEdit || !variantsEditing || saving || savingVariants || uploadingVariantImageId) return;
    const draft = draftVariantImages.current.get(variant.id);
    if (draft && variantDraftImageSnapshot.current.get(variant.id)?.preview !== draft.preview) URL.revokeObjectURL(draft.preview);
    draftVariantImages.current.delete(variant.id);
    setVariantDraft(current => current?.map(item => item.id === variant.id ? { ...item, offer_image_path: null } : item) ?? null);
    setVariantImageUrls(current => {
      const next = { ...current };
      delete next[variant.id];
      return next;
    });
  };

  const handleDeleteOfferImage = async () => {
    if (!product?.offer_image_path || productId === 'new') return;
    if (!confirm('Odłączyć grafikę od produktu? Plik pozostanie dostępny w broszurach i wcześniej przygotowanych ofertach.')) return;

    try {
      setUploadingOfferImage(true);
      const { error: updateError } = await supabase
        .from('offer_products')
        .update({ offer_image_path: null })
        .eq('id', product.id);
      if (updateError) throw updateError;

      // Keep shared files so existing brochures and snapshots remain usable.
      setOfferImageSrc(null);
      setProduct((current) => (current ? { ...current, offer_image_path: null } : current));
      showSnackbar('Grafikę odłączono od produktu. Zachowano ją dla istniejących materiałów.', 'success');
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

  const persistVariants = async (savedProductId: string, source: IProductVariant[]) => {
    const variants = source.map((variant, index) => ({
      id: variant.id,
      offer_image_path: variant.offer_image_path || null,
      offer_image_alt: variant.offer_image_alt || null,
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
      is_recommended: Boolean(variant.is_recommended),
      is_active: variant.is_active !== false,
      display_order: index,
    }));

    if ((product?.sales_packages || []).some(p => p.element_ids.some(id => !source.some(v => v.id === id)))) {
      throw new Error('Najpierw usuń element ze składu pakietów, aby usunąć go z produktu.');
    }
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
      .map((variant) => variant.id.startsWith('temp-') ? variant.id.slice(5) : variant.id);
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
      .map(({ id, ...variant }) => ({ ...variant, id: id.slice(5), product_id: savedProductId }));

    const uploadedPaths: string[] = [];
    try {
      for (const payload of [...existingPayload, ...newPayload]) {
        const draft = draftVariantImages.current.get(payload.id) || draftVariantImages.current.get(`temp-${payload.id}`);
        if (!draft) continue;
        const extension = draft.file.type === 'image/png' ? 'png' : draft.file.type === 'image/webp' ? 'webp' : 'jpg';
        const path = `assets/${savedProductId}/variants/${payload.id}-${crypto.randomUUID()}.${extension}`;
        const { error } = await bucket.upload(path, draft.file, { contentType: draft.file.type, upsert: false });
        if (error) throw error;
        uploadedPaths.push(path);
        payload.offer_image_path = path;
      }
      const payload = [...existingPayload, ...newPayload];
      if (payload.length > 0) {
        const { data, error } = await supabase.from('offer_product_variants').upsert(payload, { onConflict: 'id' }).select('*');
        if (error) throw error;
        return (data as IProductVariant[]).sort((a, b) => a.display_order - b.display_order);
      }
      return [];
    } catch (error) {
      if (uploadedPaths.length) await bucket.remove(uploadedPaths);
      throw error;
    }
  };

  const beginVariantEdit = () => {
    if (!canEdit || saving || savingVariants || uploadingVariantImageId) return;
    variantImageSnapshot.current = { ...variantImageUrls };
    variantDraftImageSnapshot.current = new Map(draftVariantImages.current);
    setVariantDraft(structuredClone(productVariants));
  };

  const cancelVariantEdit = () => {
    if (savingVariants || uploadingVariantImageId) return;
    draftVariantImages.current.forEach(({ preview }, id) => {
      if (variantDraftImageSnapshot.current.get(id)?.preview !== preview) URL.revokeObjectURL(preview);
    });
    draftVariantImages.current = new Map(variantDraftImageSnapshot.current);
    variantDraftImageSnapshot.current.clear();
    setVariantImageUrls(variantImageSnapshot.current);
    setVariantDraft(null);
  };

  const saveVariantSection = async () => {
    if (!product || !canEdit || !variantDraft || saving || savingVariants || savingAddons || savingRequirements || savingProductSection || uploadingVariantImageId) return;
    try {
      setSavingVariants(true);
      if (variantDraft.some(variant => !variant.name.trim())) throw new Error('Każdy wariant musi mieć nazwę');
      const names = variantDraft.map(variant => variant.name.trim().toLocaleLowerCase('pl-PL'));
      if (new Set(names).size !== names.length) throw new Error('Nazwy wariantów produktu muszą być unikalne');
      if (variantDraft.some(variant => [variant.price_net, variant.price_gross, variant.service_duration_hours, variant.extension_price_net_per_hour].some(value => value != null && (!Number.isFinite(Number(value)) || Number(value) < 0)))) {
        throw new Error('Ceny i czas usługi muszą być nieujemnymi liczbami');
      }
      const saved = productId === 'new' ? structuredClone(variantDraft) : await persistVariants(product.id, variantDraft);
      setProductVariants(saved);
      setProduct(current => current ? { ...current, offer_product_variants: saved } : current);
      variantDraftImageSnapshot.current.forEach(({ preview }, id) => {
        if (draftVariantImages.current.get(id)?.preview !== preview) URL.revokeObjectURL(preview);
      });
      variantDraftImageSnapshot.current.clear();
      if (productId !== 'new') {
        draftVariantImages.current.forEach(({ preview }) => URL.revokeObjectURL(preview));
        draftVariantImages.current.clear();
      }
      setVariantDraft(null);
      showSnackbar(productId === 'new' ? 'Warianty zatwierdzone. Zapisz produkt, aby dodać go do katalogu.' : 'Zapisano warianty produktu', 'success');
    } catch (err: any) {
      showSnackbar(err.message || 'Nie udało się zapisać wariantów', 'error');
    } finally {
      setSavingVariants(false);
    }
  };

  const saveAddonSection = async (pricing_addons: ProductAddon[]) => {
    if (!product || !canEdit || saving || savingVariants || savingAddons || savingRequirements || savingProductSection) throw new Error('Zapis jest chwilowo niedostępny. Spróbuj ponownie.');
    const validation = validateAddons(pricing_addons);
    if (validation) throw new Error(validation);
    const patch = { pricing_addons, ...(pricing_addons.length ? { offer_page_variant: 'default' as const } : {}) };
    try {
      setSavingAddons(true);
      if (productId !== 'new') {
        const { data, error } = await supabase.from('offer_products').update(patch).eq('id', product.id).select('id').single();
        if (error || !data) throw new Error(error?.message || 'Nie udało się zapisać dodatków');
      }
      setProduct(current => current ? { ...current, ...patch } : current);
      showSnackbar(productId === 'new' ? 'Dodatki zatwierdzone. Zapisz produkt, aby dodać go do katalogu.' : 'Zapisano dodatki i limity pakietu', 'success');
    } finally {
      setSavingAddons(false);
    }
  };

  const saveRequirementSection = async (requirements: OfferAdditionalRequirement[]) => {
    if (!product || !canEdit || saving || savingVariants || savingAddons || savingRequirements || savingProductSection) throw new Error('Zapis jest chwilowo niedostępny. Spróbuj ponownie.');
    const patch = {
      offer_requirements: [],
      offer_additional_requirements: requirements.map(requirement => ({
        ...requirement,
        id: requirement.id || crypto.randomUUID(),
        category: requirement.category || 'other' as const,
        title: requirement.title.trim(),
        description: requirement.description.trim(),
      })).filter(requirement => requirement.title || requirement.description),
    };
    try {
      setSavingRequirements(true);
      if (productId !== 'new') {
        const { data, error } = await supabase.from('offer_products').update(patch).eq('id', product.id).select('id').single();
        if (error || !data) throw new Error(error?.message || 'Nie udało się zapisać wymagań');
      }
      setProduct(current => current ? { ...current, ...patch } : current);
      showSnackbar(productId === 'new' ? 'Wymagania zatwierdzone. Zapisz produkt, aby dodać go do katalogu.' : 'Zapisano wymagania produktu', 'success');
    } finally {
      setSavingRequirements(false);
    }
  };

  const saveProductSection = async (section: string, patch: Partial<IProduct>) => {
    if (!product || !canEdit || saving || savingVariants || savingAddons || savingRequirements || savingProductSection) throw new Error('Trwa zapis innej sekcji. Spróbuj ponownie.');
    const normalized = { ...patch };
    if (section === 'basic') {
      normalized.name = String(patch.name || '').trim();
      if (!normalized.name) throw new Error('Podaj nazwę produktu');
    }
    if (section === 'pricing_units') {
      normalized.unit = String(patch.unit || '').trim();
      if (!normalized.unit) throw new Error('Podaj jednostkę produktu');
      if (!Number.isFinite(patch.min_quantity) || Number(patch.min_quantity) <= 0) throw new Error('Minimalna ilość musi być większa od zera');
    }
    const nextProduct = { ...product, ...normalized };
    if (nextProduct.sales_packages_enabled && nextProduct.sales_packages?.length) {
      normalized.unit = 'pakiet';
      normalized.min_quantity = 1;
    }
    if (section === 'tags') normalized.tags = (patch.tags || []).map(tag => tag.trim()).filter(Boolean);
    const numericKeys: (keyof IProduct)[] = ['vat_rate', 'price_net', 'price_gross', 'cost_net', 'cost_gross', 'transport_cost_net', 'transport_cost_gross', 'logistics_cost_net', 'logistics_cost_gross', 'min_quantity', 'max_quantity', 'setup_time_hours', 'teardown_time_hours'];
    if (numericKeys.some(key => normalized[key] != null && (!Number.isFinite(Number(normalized[key])) || Number(normalized[key]) < 0))) throw new Error('Ilości, czas i kwoty muszą być nieujemnymi liczbami');
    try {
      setSavingProductSection(section);
      if (productId !== 'new') {
        const { data, error } = await supabase.from('offer_products').update({ ...normalized, ...('category_id' in normalized ? { category_id: normalized.category_id || null } : {}) }).eq('id', product.id).select('id').single();
        if (error || !data) throw new Error(error?.message || 'Nie udało się zapisać sekcji');
      }
      setProduct(current => current ? { ...current, ...normalized } : current);
      showSnackbar(productId === 'new' ? 'Sekcja zatwierdzona. Zapisz produkt, aby dodać go do katalogu.' : 'Zapisano sekcję produktu', 'success');
    } finally { setSavingProductSection(null); }
  };

  const applySupplierService = (current: IProduct, serviceId: string): IProduct => {
    const service = subcontractorServices.find(item => item.id === serviceId) as any;
    if (!service) return { ...current, subcontractor_service_catalog_id: serviceId || null };
    const isEquipment = service._type === 'equipment';
    const cash = !isEquipment && service.settlement_method === 'cash_non_deductible';
    const gross = Number(isEquipment ? service.daily_price_gross || service.rental_price_per_day || 0 : service.price_gross || service.unit_price || 0);
    const supplierVat = Number(service.vat_rate ?? 23);
    const net = Number((isEquipment ? service.daily_price_net : service.price_net) || gross / (1 + supplierVat / 100));
    const vat = !isEquipment && service.settlement_method !== 'invoice' ? Number(current.vat_rate ?? 23) || 23 : supplierVat;
    const cost = Number(service.economic_cost ?? net);
    return { ...current, subcontractor_service_catalog_id: serviceId, base_price: net, price_net: net, price_gross: Math.round(net * (1 + vat / 100) * 100) / 100, cost_net: cost, cost_gross: cash ? cost : gross, vat_rate: vat, subcontractor_settlement_method: isEquipment ? null : service.settlement_method || 'invoice', subcontractor_economic_cost: isEquipment ? null : cost };
  };

  const saveSalesPackages = async (packages: ProductSalesPackage[], enabled: boolean) => {
    const error = validateSalesPackages(packages);
    if (error) throw new Error(error);
    await saveProductSection('sales_packages', { sales_packages: packages, sales_packages_enabled: enabled });
  };

  const handleSave = async () => {
    if (!product || !canEdit || saving || savingVariants || savingAddons || savingRequirements || savingProductSection || uploadingVariantImageId) return;
    if (variantsEditing || addonsEditing || requirementsEditing || editingProductSections.length > 0) {
      showSnackbar('Najpierw zapisz lub anuluj zmiany w edytowanych sekcjach produktu', 'error');
      return;
    }

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

      const addonError = validateAddons(product.pricing_addons || []);
      if (addonError) throw new Error(addonError);
      const productData = {
        pricing_addons: product.pricing_addons || [],
        category_id: product.category_id || null,
        related_service_ids: product.related_service_ids || [],
        related_service_url: product.related_service_url || null,
        related_service_label: product.related_service_label || null,
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
        unit: product.sales_packages_enabled && product.sales_packages?.length ? 'pakiet' : product.unit,
        min_quantity: product.sales_packages_enabled && product.sales_packages?.length ? 1 : product.min_quantity,
        max_quantity: product.max_quantity,
        requires_vehicle: product.requires_vehicle,
        requires_driver: product.requires_driver,
        tags: product.tags,
        is_active: product.is_active,
        is_personnel_service: Boolean(product.is_personnel_service),
        display_order: product.display_order,
        offer_short_description: product.offer_short_description || null,
        offer_description: product.offer_description || null,
        offer_compact_description: product.offer_compact_description?.trim() || null,
        service_duration_hours: product.service_duration_hours == null
          ? null
          : Number(product.service_duration_hours),
        extension_price_net_per_hour: product.extension_price_net_per_hour == null
          ? null
          : Number(product.extension_price_net_per_hour),
        offer_benefits: product.offer_benefits || [],
        // Wymagania mają jedno źródło prawdy: rekordy z przypisaną kategorią.
        // Starsza lista tekstowa jest czyszczona po pierwszym zapisie produktu.
        offer_requirements: [],
        offer_additional_requirements: (product.offer_additional_requirements || [])
          .map((requirement) => ({
            id: requirement.id || crypto.randomUUID(),
            category: requirement.category || 'other',
            title: String(requirement.title || '').trim(),
            description: String(requirement.description || '').trim(),
          }))
          .filter((requirement) => requirement.title || requirement.description),
        offer_image_path: product.offer_image_path || null,
        offer_image_alt: product.offer_image_alt || null,
        offer_image_position_x: Number(product.offer_image_position_x ?? 50),
        offer_image_position_y: Number(product.offer_image_position_y ?? 25),
        offer_image_zoom: normalizeOfferImageScale(product.offer_image_zoom),
        product_page_url: productPageUrl || null,
        offer_page_variant: product.pricing_addons?.length ? 'default' : effectivePageVariant,
        offer_page_enabled: true,
        is_subcontractor_service: product.is_subcontractor_service || false,
        subcontractor_id: product.subcontractor_id || null,
        subcontractor_service_catalog_id: product.subcontractor_service_catalog_id || null,
        subcontractor_settlement_method: product.subcontractor_settlement_method || null,
        subcontractor_economic_cost: product.subcontractor_economic_cost ?? null,
      };


      if (productId === 'new') {
        const result = createdProductId.current
          ? await supabase.from('offer_products').update(productData).eq('id', createdProductId.current).select().single()
          : await supabase.from('offer_products').insert(productData).select().single();
        if (result.error) throw result.error;
        const data = result.data;
        createdProductId.current = data.id;
        await persistVariants(data.id, productVariants);

        showSnackbar('Produkt został dodany', 'success');
        router.push(`/crm/offers/products/${data.id}`);
      } else {
        const { error } = await supabase
          .from('offer_products')
          .update(productData)
          .eq('id', product.id);
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
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
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
              disabled={saving || uploadingOfferImage || !!uploadingVariantImageId}
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

      <div className="grid items-start gap-6 lg:grid-cols-12">
        <div className="min-w-0 space-y-6 lg:col-span-8">
<ProductDataSection<IProduct>
              title="Podstawowe informacje" value={product} fields={["name", "category_id", "description", "is_active"]}
              canEdit={canEdit} disabled={saving || savingVariants || savingAddons || savingRequirements || Boolean(savingProductSection)}
              onEditingChange={editing => setSectionEditing('basic', editing)}
              onSave={patch => saveProductSection('basic', patch)}
              onDraftChange={setBasicPreview}
              renderView={(product) => (<div className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-xl font-medium text-[#e5e4e2]">{product.name || 'Nowy produkt'}</h3><span className="rounded-full bg-[#d3bb73]/10 px-3 py-1 text-xs text-[#d3bb73]">{product.is_active ? 'Aktywny' : 'Nieaktywny'}</span></div><p className="text-sm text-[#d3bb73]">{initialCategories.find(category => category.id === product.category_id)?.name || 'Bez kategorii'}</p><p className="whitespace-pre-line text-sm leading-relaxed text-[#e5e4e2]/65">{product.description || 'Brak opisu produktu.'}</p></div>)}
              renderEditor={(product, setProduct) => (<div className="grid gap-4 sm:grid-cols-2"><label className="text-sm text-[#e5e4e2]/65 sm:col-span-2">Nazwa produktu<input value={product.name} onChange={e => setProduct({ ...product, name: e.target.value })} className="mt-1 w-full rounded-lg border border-white/10 bg-black/15 px-3 py-2 text-sm text-[#e5e4e2]" /></label><label className="text-sm text-[#e5e4e2]/65 sm:col-span-2">Kategoria<select value={product.category_id || ''} onChange={e => setProduct({ ...product, category_id: e.target.value })} className="mt-1 w-full rounded-lg border border-white/10 bg-black/15 px-3 py-2 text-sm text-[#e5e4e2]"><option value="">Bez kategorii</option>{initialCategories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label className="text-sm text-[#e5e4e2]/65 sm:col-span-2">Opis produktu<textarea rows={4} value={product.description || ''} onChange={e => setProduct({ ...product, description: e.target.value })} className="mt-1 w-full rounded-lg border border-white/10 bg-black/15 px-3 py-2 text-sm text-[#e5e4e2]" /></label><label className="flex items-center gap-2 text-sm text-[#e5e4e2]"><input type="checkbox" checked={product.is_active} onChange={e => setProduct({ ...product, is_active: e.target.checked })} className="accent-[#d3bb73]" />Produkt aktywny</label></div>)}
            />
        {/* Presentation in generated offer */}
        <div className="rounded-xl border border-[#7f1734]/40 bg-[#1c1f33] p-6 ">
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

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_260px]">
            <div className="space-y-4">


              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Lead — wspólne zdanie pod tytułem</label>
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
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Opis rozszerzony — osobna strona i duża grafika</label>
                <textarea
                  value={product.offer_description || ''}
                  onChange={(e) => setProduct({ ...product, offer_description: e.target.value })}
                  disabled={!canEdit}
                  className="min-h-[140px] w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] disabled:opacity-50"
                  placeholder="Zakres, sposób realizacji i najważniejsze informacje dla klienta"
                />
              </div>

              <div>
                <label htmlFor="product-compact-description" className="mb-2 block text-sm text-[#e5e4e2]/60">Krótki opis do oferty kompaktowej</label>
                <textarea
                  id="product-compact-description"
                  rows={4}
                  value={product.offer_compact_description || ''}
                  onChange={e => setProduct({ ...product, offer_compact_description: e.target.value })}
                  maxLength={COMPACT_PRODUCT_DESCRIPTION_LIMIT}
                  disabled={!canEdit || Boolean(compactBlockReason)}
                  aria-describedby="product-compact-description-help"
                  placeholder="Samodzielny, zwięzły opis produktu i najważniejszej korzyści"
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] disabled:cursor-not-allowed disabled:opacity-40"
                />
                <p id="product-compact-description-help" className="mt-1 text-xs text-[#e5e4e2]/50">
                  {compactBlockReason
                    ? `${compactBlockReason} Krótki opis nie jest używany. Zachowamy go na wypadek zmiany konfiguracji.`
                    : `${(product.offer_compact_description || '').length}/${COMPACT_PRODUCT_DESCRIPTION_LIMIT} znaków. Tylko dla układu do 3 produktów na stronie; podgląd uwzględnia miejsce w szablonie.`}
                </p>
                {!compactBlockReason && !product.offer_compact_description?.trim() && <p className="mt-2 text-xs text-[#d3bb73]">Uzupełnij osobny krótki opis. Do tego czasu wersja kompaktowa korzysta ze skróconego opisu rozszerzonego, tak jak dotychczas.</p>}
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
                    disabled={!canEdit || hasIndividualExtensionRates}
                    placeholder="np. 500"
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] disabled:opacity-50"
                  />
                </div>
              </div>
              <p className="-mt-2 text-xs leading-5 text-[#e5e4e2]/40">
                {hasIndividualExtensionRates
                  ? 'Wspólna stawka przedłużenia jest wyłączona. Ustaw ją osobno w elemencie, wariancie lub pakiecie. Dotychczasowa wartość pozostaje zachowana. Czas usługi nadal jest domyślny dla produktu.'
                  : 'Stawka dotyczy każdej dodatkowej godziny całej usługi. Pozostaw puste pole, jeśli nie chcesz podawać kosztu przedłużenia.'}
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
                    value={effectivePageVariant}
                    onChange={(e) => setProduct({ ...product, offer_page_variant: e.target.value })}
                    disabled={!canEdit}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] disabled:opacity-50"
                  >
                    <option value="default">Domyślny</option>
                    <option value="compact" disabled={Boolean(compactBlockReason)}>Kompaktowy - do 3 produktów na stronie</option>
                    <option value="visual">Duża grafika</option>
                  </select>
                  <p className="mt-1 text-xs text-[#e5e4e2]/40">
                    {compactBlockReason || 'Wariant kompaktowy grupuje kolejne produkty po maksymalnie trzy na jednej stronie PDF.'}
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
                        className="object-cover opacity-55"
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
                        transformOrigin: `${Number(product.offer_image_position_x ?? 50)}% ${Number(product.offer_image_position_y ?? 25)}%`,
                      }}
                    />
                  </div>
                ) : (
                  <div className="flex aspect-[4/3] flex-col items-center justify-center gap-3 text-center">
                    <ImageIcon className="h-12 w-12 text-[#e5e4e2]/15" />
                    <span className="px-4 text-xs text-[#e5e4e2]/40">
                      {productId === 'new'
                        ? 'Najpierw zapisz produkt'
                        : 'Przeciągnij tutaj plik PNG, JPG lub WebP'}
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
                    accept="image/png,image/jpeg,image/webp"
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
                          <button data-crm-action="secondary"
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
                    PNG, JPG lub WebP, maksymalnie 10 MB. Plik zapisuje się automatycznie po wybraniu lub
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


        {/* Presentation in generated offer */}
        <div className="lg:col-span-2">
          <div className="mb-6"><ProductRelatedServicesSection
            value={product.related_service_ids || []}
            pageUrl={product.related_service_url}
            pageLabel={product.related_service_label}
            canEdit={canEdit}
            disabled={saving || savingVariants || savingAddons || savingRequirements || Boolean(savingProductSection)}
            onSave={(ids, url, label) => saveProductSection('related_services', { related_service_ids: ids, related_service_url: url, related_service_label: label })}
            onEditingChange={editing => setSectionEditing('related_services', editing)}
          /></div>
          <ProductVariantsEditor
            elementMode={Boolean(product.sales_packages_enabled)}
            productName={product.name}
            variants={visibleVariants}
            editing={variantsEditing}
            sectionActions={canEdit ? (
              <div className="flex flex-wrap items-center gap-2">
                {variantsEditing ? <>
                  <button type="button" onClick={cancelVariantEdit} disabled={saving || savingVariants || savingAddons || savingRequirements || Boolean(savingProductSection) || !!uploadingVariantImageId} className="rounded-lg bg-white/5 px-4 py-2 text-sm text-[#e5e4e2] hover:bg-white/10 disabled:opacity-40">Anuluj</button>
                  <button type="button" onClick={saveVariantSection} disabled={saving || savingVariants || savingAddons || savingRequirements || Boolean(savingProductSection) || !!uploadingVariantImageId} className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] disabled:opacity-40">
                    {savingVariants ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    {savingVariants ? 'Zapisywanie…' : product.sales_packages_enabled ? 'Zapisz elementy' : 'Zapisz warianty'}
                  </button>
                </> : <button type="button" onClick={beginVariantEdit} disabled={saving || savingVariants || savingRequirements || Boolean(savingProductSection)} className="rounded-lg bg-[#d3bb73]/10 px-4 py-2 text-sm text-[#d3bb73] hover:bg-[#d3bb73]/20 disabled:opacity-40">Edytuj warianty</button>}
              </div>
            ) : undefined}
            vatRate={product.vat_rate}
            defaultServiceDurationHours={product.service_duration_hours}
            defaultExtensionPriceNetPerHour={hasIndividualExtensionRates ? null : product.extension_price_net_per_hour}
            disabled={!canEdit || !variantsEditing || saving || savingVariants || !!uploadingVariantImageId}
            onChange={setVariantDraft}
            imageUrls={variantImageUrls}
            uploadingImageId={uploadingVariantImageId}
            onImageUpload={handleUploadVariantImage}
            onImageDelete={handleDeleteVariantImage}
          />
        </div>


        <ProductSalesPackagesSection productId={productId} value={product.sales_packages || []}
          enabled={Boolean(product.sales_packages_enabled)} elements={persistedProductVariants}
          canEdit={canEdit} disabled={saving || savingVariants || savingAddons || savingRequirements || Boolean(savingProductSection)}
          onSave={saveSalesPackages} onEditingChange={editing => setSectionEditing('sales_packages', editing)} />
        <div className="lg:col-span-2">
          <ProductAddonsSection
            value={product.pricing_addons || []}
            canEdit={canEdit}
            disabled={saving || savingVariants || savingRequirements || Boolean(savingProductSection)}
            saving={savingAddons}
            onSave={saveAddonSection}
            onEditingChange={setAddonsEditing}
          />
        </div>


<ProductRequirementsSection
                value={withCategorizedProductRequirements(product).offer_additional_requirements || []}
                canEdit={canEdit}
                disabled={saving || savingVariants || savingAddons || Boolean(savingProductSection)}
                saving={savingRequirements}
                onSave={saveRequirementSection}
                onEditingChange={setRequirementsEditing}
              />

{!(product.sales_packages_enabled && product.sales_packages?.length) && <ProductSettingsDrawer title="Ustawienia wyceny" description="Jednostka rozliczenia i minimalna ilość produktu.">
            <ProductDataSection<IProduct>
              title="Ustawienia wyceny" value={product} fields={["unit", "min_quantity"]}
              canEdit={canEdit} disabled={saving || savingVariants || savingAddons || savingRequirements || Boolean(savingProductSection)}
              onEditingChange={editing => setSectionEditing('pricing_units', editing)}
              onSave={patch => saveProductSection('pricing_units', patch)}
              renderView={product => (<dl className="flex flex-wrap gap-6 text-sm"><div><dt className="text-xs text-[#e5e4e2]/45">Jednostka</dt><dd className="mt-1 text-[#e5e4e2]">{product.unit || '—'}</dd></div><div><dt className="text-xs text-[#e5e4e2]/45">Minimalna ilość</dt><dd className="mt-1 text-[#e5e4e2]">{product.min_quantity}</dd></div></dl>)}
              renderEditor={(product, setProduct) => (<div className="grid gap-4 sm:grid-cols-2"><label className="text-sm text-[#e5e4e2]/65">Jednostka<input value={product.unit} onChange={e => setProduct({ ...product, unit: e.target.value })} className="mt-1 w-full rounded-lg border border-white/10 bg-black/15 px-3 py-2 text-sm text-[#e5e4e2]" /></label><label className="text-sm text-[#e5e4e2]/65">Minimalna ilość<input type="number" min={0.01} step="0.01" value={Number.isFinite(product.min_quantity) ? product.min_quantity : ''} onChange={e => setProduct({ ...product, min_quantity: e.target.valueAsNumber })} className="mt-1 w-full rounded-lg border border-white/10 bg-black/15 px-3 py-2 text-sm text-[#e5e4e2]" /></label><p className="text-xs text-[#e5e4e2]/45 sm:col-span-2">Jednostka pojawia się w kalkulacji, np. szt., godz. lub usługa. Domyślna minimalna ilość wynosi 1.</p></div>)}
            />
          </ProductSettingsDrawer>}

<ProductSettingsDrawer title="Ceny i koszty" description={product.sales_packages_enabled && product.sales_packages?.length ? "Ceny i koszty poszczególnych pakietów oraz wspólna stawka VAT." : "Cena sprzedaży, koszty realizacji, transport i logistyka."}><ProductDataSection<IProduct>
              title="Ceny i koszty" value={product} fields={["vat_rate", "price_net", "price_gross", "cost_net", "cost_gross", "transport_cost_net", "transport_cost_gross", "logistics_cost_net", "logistics_cost_gross"]}
              canEdit={canEdit} disabled={saving || savingVariants || savingAddons || savingRequirements || Boolean(savingProductSection)}
              onEditingChange={editing => setSectionEditing('pricing', editing)}
              onSave={patch => saveProductSection('pricing', patch)}
              
              renderView={(product) => product.sales_packages_enabled && product.sales_packages?.length ? <div className="space-y-3">
                <p className="text-sm text-[#e5e4e2]/60">VAT: {product.vat_rate}%. Cena i koszty zależą od wybranego pakietu — zmienisz je przez menu pakietu → „Edytuj”. Koszty bazowe nie są dziedziczone przez pakiety.</p>
                {product.sales_packages.map(p => <div key={p.id} className="space-y-2 rounded-lg bg-black/10 p-3"><h3 className="text-sm text-[#e5e4e2]">{p.name}</h3><p className="text-sm text-[#d3bb73]">Cena: {p.price_net.toLocaleString('pl-PL')} zł netto</p><ProductPackageCostSummary value={p}/></div>)}
              </div> : (<dl className="grid gap-4 sm:grid-cols-2">{[
 ['Cena sprzedaży', `${Number(product.price_net || 0).toLocaleString('pl-PL')} zł netto / ${Number(product.price_gross || 0).toLocaleString('pl-PL')} zł brutto`],
 ['Pozostały koszt realizacji (bez obsady)', `${Number(product.cost_net || 0).toLocaleString('pl-PL')} zł netto / ${Number(product.cost_gross || 0).toLocaleString('pl-PL')} zł brutto`],
 ['Transport', `${Number(product.transport_cost_net || 0).toLocaleString('pl-PL')} zł netto`],
 ['Logistyka', `${Number(product.logistics_cost_net || 0).toLocaleString('pl-PL')} zł netto`],
 ['VAT', `${product.vat_rate}%`],
 ['Obsada — koszt dla firmy', staffCostNet == null ? 'Uzupełnij rozliczenie obsady' : `${staffCostNet.toLocaleString('pl-PL')} zł`],
 ['Marża po koszcie realizacji i obsady', staffCostNet == null ? 'Nieustalona' : `${product.price_net > 0 ? (((product.price_net - (product.cost_net || 0) - staffCostNet) / product.price_net) * 100).toFixed(1) : '0'}%`],
 ['Cena z transportem i logistyką', `${((product.price_net || 0) + (product.transport_cost_net || 0) + (product.logistics_cost_net || 0)).toLocaleString('pl-PL')} zł netto`],
 ['Koszt łącznie z obsadą, transportem i logistyką', staffCostNet == null ? 'Nieustalony — uzupełnij obsadę' : `${((product.cost_net || 0) + staffCostNet + (product.transport_cost_net || 0) + (product.logistics_cost_net || 0)).toLocaleString('pl-PL')} zł`],
].map(([label, value]) => <div key={label}><dt className="text-xs text-[#e5e4e2]/45">{label}</dt><dd className="mt-1 text-sm text-[#e5e4e2]">{value}</dd></div>)}</dl>)}
              renderEditor={(product, setProduct) => (<ProductPricingPanel product={product} canEdit={canEdit} onChange={setProduct} className="!bg-transparent !p-0 !border-0" hideHeading />)}
            /></ProductSettingsDrawer>
          <div className="pt-4"><h2 className="text-sm font-semibold uppercase tracking-wider text-[#d3bb73]">Realizacja i ustawienia dodatkowe</h2><p className="mt-1 text-sm text-[#e5e4e2]/45">Rozwiń wybraną sekcję, aby sprawdzić lub zmienić konfigurację.</p></div>

<ProductSettingsDrawer title="Warunki techniczne i logistyka" description="Transport, montaż, demontaż i ograniczenia realizacji."><ProductDataSection<IProduct>
              title="Ustawienia realizacji" value={product} fields={["requires_vehicle", "requires_driver", "is_personnel_service", "setup_time_hours", "teardown_time_hours", "max_quantity"]}
              canEdit={canEdit} disabled={saving || savingVariants || savingAddons || savingRequirements || Boolean(savingProductSection)}
              onEditingChange={editing => setSectionEditing('technical', editing)}
              onSave={patch => saveProductSection('technical', patch)}
              
              renderView={(product) => (<dl className="grid gap-4 sm:grid-cols-2">{[['Pojazd', product.requires_vehicle ? 'Wymagany' : 'Niewymagany'], ['Kierowca', product.requires_driver ? 'Wymagany' : 'Niewymagany'], ['Usługa personelu bez sprzętu', product.is_personnel_service ? 'Tak' : 'Nie'], ['Montaż', `${product.setup_time_hours || 0} h`], ['Demontaż', `${product.teardown_time_hours || 0} h`], ['Maksymalna ilość', product.max_quantity == null ? 'Bez limitu' : String(product.max_quantity)]].map(([label, value]) => <div key={label}><dt className="text-xs text-[#e5e4e2]/45">{label}</dt><dd className="mt-1 text-sm text-[#e5e4e2]">{value}</dd></div>)}</dl>)}
              renderEditor={(product, setProduct) => (<div className="space-y-4">{([['requires_vehicle', 'Wymaga pojazdu'], ['requires_driver', 'Wymaga kierowcy'], ['is_personnel_service', 'Usługa personelu — bez sprzętu']] as const).map(([key, label]) => <label key={key} className="flex items-center gap-2 text-sm text-[#e5e4e2]"><input type="checkbox" checked={Boolean(product[key])} onChange={e => setProduct({ ...product, [key]: e.target.checked })} className="accent-[#d3bb73]" />{label}</label>)}<div className="grid gap-4 sm:grid-cols-2">{([['setup_time_hours', 'Montaż (h)'], ['teardown_time_hours', 'Demontaż (h)']] as const).map(([key, label]) => <label key={key} className="text-sm text-[#e5e4e2]/65">{label}<input type="number" min="0" step="0.25" value={product[key] || 0} onChange={e => setProduct({ ...product, [key]: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-white/10 bg-black/15 px-3 py-2 text-sm text-[#e5e4e2]" /></label>)}<label className="text-sm text-[#e5e4e2]/65">Maksymalna ilość<input type="number" min="0" step="0.01" value={product.max_quantity ?? ''} onChange={e => setProduct({ ...product, max_quantity: e.target.value === '' ? null : Number(e.target.value) })} placeholder="Bez limitu" className="mt-1 w-full rounded-lg border border-white/10 bg-black/15 px-3 py-2 text-sm text-[#e5e4e2]" /></label></div></div>)}
            /></ProductSettingsDrawer>
{persistedProductVariants.length > 0 && (<ProductSettingsDrawer title="Zakres konfiguracji wariantu" description="Wybierz produkt bazowy lub wariant dla sprzętu, obsady i klauzul.">        {persistedProductVariants.length > 0 && (
          <section className="rounded-xl border border-[#d3bb73]/25 bg-[#1c1f33] p-6 ">
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_1fr] lg:items-end">
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

</ProductSettingsDrawer>)}
{productId !== 'new' && !(product.sales_packages_enabled && product.sales_packages?.length) && (<ProductSettingsDrawer title="Sprzęt i zasoby" description="Wyposażenie potrzebne do realizacji." canEdit={canEdit} render={(canEdit) => (<>      {/* Equipment */}
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

</>)} />)}
{productId !== 'new' && !(product.sales_packages_enabled && product.sales_packages?.length) && (<ProductSettingsDrawer title="Obsada i personel" description="Role, liczba osób i koszty, również za realizację oraz przy wypłacie gotówką." canEdit={canEdit} render={(canEdit) => (<>      {/* Staff */}
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
          onCostChange={setStaffCostNet}
          onCustomizeVariant={() => handleCustomizeVariantSection('staff')}
          onResetInheritance={() => handleResetVariantSection('staff')}
        />
      )}

</>)} />)}
{productId !== 'new' && (<ProductSettingsDrawer title="Mavinci LIVE" description="Moduły uruchamiane przy realizacji produktu." canEdit={canEdit} render={(canEdit) => (<>      {/* Mavinci LIVE */}
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

</>)} />)}
{productId !== 'new' && (<ProductSettingsDrawer title="Klauzule i warunki umowy" description="Stałe ustalenia wykorzystywane w dokumentach.">      {/* Contract Clauses */}
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
          onSave={async (clauseEntries) => {
            try {
              const firstCategory = clauseEntries[0]?.category;
              // Kolumna historyczna ma starszy CHECK. Pełna kategoria znajduje się
              // w dokumencie v2; tutaj zapisujemy zgodny znacznik awaryjny.
              const storedFirstCategory = firstCategory === 'additional_requirements'
                ? 'general'
                : firstCategory === 'conditions'
                  ? 'requirements'
                  : firstCategory || 'requirements';
              const serializedClauses = clauseEntries.length > 0
                ? serializeContractClauseEntries(clauseEntries)
                : null;
              const target = selectedConfigurationVariant
                ? supabase
                    .from('offer_product_variants')
                    .update({
                      recommended_contract_clauses: serializedClauses,
                      recommended_contract_clause_category: storedFirstCategory,
                      overrides_contract_clauses: true,
                    })
                    .eq('id', selectedConfigurationVariant.id)
                    .eq('product_id', productId)
                : supabase
                    .from('offer_products')
                    .update({
                      recommended_contract_clauses: serializedClauses,
                      recommended_contract_clause_category: storedFirstCategory,
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
                          recommended_contract_clauses: serializedClauses,
                          recommended_contract_clause_category: storedFirstCategory,
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
                        recommended_contract_clauses: serializedClauses,
                        recommended_contract_clause_category: storedFirstCategory,
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

</ProductSettingsDrawer>)}
<ProductSettingsDrawer title="Podwykonawca" description="Powiązanie produktu z zewnętrzną usługą."><ProductDataSection<IProduct>
              title="Podwykonawca" value={product} fields={["is_subcontractor_service", "subcontractor_id", "subcontractor_service_catalog_id", "subcontractor_settlement_method", "subcontractor_economic_cost", "vat_rate", "price_net", "price_gross", "cost_net", "cost_gross", "transport_cost_net", "transport_cost_gross", "logistics_cost_net", "logistics_cost_gross", "base_price"]}
              canEdit={canEdit} disabled={saving || savingVariants || savingAddons || savingRequirements || Boolean(savingProductSection)}
              onEditingChange={editing => setSectionEditing('supplier', editing)}
              onSave={patch => saveProductSection('supplier', patch)}
              
              renderView={(product) => (<div className="space-y-2 text-sm text-[#e5e4e2]/65"><p>{product.is_subcontractor_service ? 'Usługa realizowana przez podwykonawcę' : 'Realizacja własna'}</p>{product.subcontractor_id && <a href={`/crm/contacts/${product.subcontractor_id}`} target="_blank" rel="noopener noreferrer" className="text-[#d3bb73]">{subcontractors.find(item => item.id === product.subcontractor_id)?.name || 'Otwórz kartę podwykonawcy'}</a>}</div>)}
              renderEditor={(product, setProduct) => (<>            {/* Sekcja Podwykonawcy */}
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
                      value={product.subcontractor_id || ''}
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

                  {product.subcontractor_id && (
                    <div>
                      <label className="mb-1 block text-xs text-[#e5e4e2]/60">Usługa</label>
                      <select
                        value={product.subcontractor_service_catalog_id || ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          
                          setProduct(applySupplierService(product, val));
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

</>)}
            /></ProductSettingsDrawer>
<ProductSettingsDrawer title="Tagi i wyszukiwanie" description="Słowa ułatwiające odnalezienie produktu."><ProductDataSection<IProduct>
              title="Tagi" value={product} fields={["tags"]}
              canEdit={canEdit} disabled={saving || savingVariants || savingAddons || savingRequirements || Boolean(savingProductSection)}
              onEditingChange={editing => setSectionEditing('tags', editing)}
              onSave={patch => saveProductSection('tags', patch)}
              
              renderView={(product) => (<div className="flex flex-wrap gap-2">{product.tags?.length ? product.tags.map((tag, index) => <span key={index} className="rounded-full bg-[#d3bb73]/10 px-3 py-1 text-sm text-[#d3bb73]">{tag}</span>) : <p className="text-sm text-[#e5e4e2]/50">Brak tagów.</p>}</div>)}
              renderEditor={(product, setProduct) => (<label className="text-sm text-[#e5e4e2]/65">Tagi oddzielone przecinkami<input value={(product.tags || []).join(',')} onChange={e => setProduct({ ...product, tags: e.target.value.split(',') })} className="mt-1 w-full rounded-lg border border-white/10 bg-black/15 px-3 py-2 text-sm text-[#e5e4e2]" /></label>)}
            /></ProductSettingsDrawer>
{productId === 'new' && (<ProductSettingsDrawer title="Import usługi od podwykonawcy" description="Utworzenie produktu na podstawie istniejącej usługi." canEdit={canEdit} render={(canEdit) => (<>      {/* Subcontractor Import (tylko w trybie NEW) */}
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

</>)} />)}
        </div>
        <aside className="min-w-0 order-first lg:order-last lg:sticky lg:top-6 lg:col-span-4 lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto lg:[scrollbar-gutter:stable]">
          {product.sales_packages_enabled && Boolean(product.sales_packages?.length) && <div className="mb-3 flex gap-2 rounded-lg bg-[#1c1f33] p-2">
            <button type="button" aria-pressed={previewPage === 'elements'} onClick={() => setPreviewPage('elements')} className={`flex-1 rounded-md px-3 py-2 text-sm ${previewPage === 'elements' ? 'bg-[#d3bb73]/15 text-[#d3bb73]' : 'text-white/60'}`}>Elementy</button>
            <button type="button" aria-pressed={previewPage === 'packages'} onClick={() => setPreviewPage('packages')} className={`flex-1 rounded-md px-3 py-2 text-sm ${previewPage === 'packages' ? 'bg-[#d3bb73]/15 text-[#d3bb73]' : 'text-white/60'}`}>Pakiety</button>
          </div>}
          <ProductOfferCardPreview
            previewPage={product.sales_packages_enabled && product.sales_packages?.length ? previewPage : 'elements'}
            product={{ ...product, ...basicPreview, offer_product_variants: visibleVariants }}
            imageUrl={offerImageSrc}
            variantImageUrls={variantImageUrls}
          />

        </aside>
      </div>

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
