'use client';
import { loadOfferPickerCatalog } from '@/lib/CRM/Offers/offerPickerCatalog';
import { useUserPreferences } from '@/app/(crm)/crm/PreferencesClientProvider';
import ModularProductConfigurator from '@/components/crm/offers/ModularProductConfigurator';
import { productConfigurationSnapshot, modularTitle, modularScope, type ProductConfigurationSnapshot } from '@/lib/CRM/Offers/modularProduct';
import ModularPriceHint from '@/components/crm/offers/ModularPriceHint';
import { createModularConfiguration } from '@/lib/CRM/Offers/offerAddons';
import InlineOfferAudience from '@/components/crm/offers/InlineOfferAudience';
import { resolveAudienceConfiguration, configurationNeedsTables, quantitySourceLabels, type QuantitySource } from '@/lib/CRM/Offers/audiencePricing';
import { QuantitySourceSelect } from '@/components/crm/offers/AudiencePricingEditor';
import { useOfferAudience } from '@/components/crm/offers/useOfferAudience';

import ProductPackagePicker from '@/components/crm/offers/ProductPackagePicker';
import { pricedPackageSelection, type ProductSalesPackage } from '@/lib/CRM/Offers/productSalesPackages';

import ProductAddonsEditor from '@/components/crm/offers/ProductAddonsEditor';
import { createConfiguration, configurationPrice, validateConfiguration, type ProductAddon } from '@/lib/CRM/Offers/offerAddons';
import { useDialog } from '@/contexts/DialogContext';
import { VariantPricesEditor } from './VariantPricesEditor';

import { useState, useEffect, useRef, useMemo } from 'react';
import { X, Plus, Search, Package, LayoutGrid, List, RefreshCw } from 'lucide-react';
import Image from 'next/image';
import { createPortal } from 'react-dom';
import type { OfferRecommendation } from './offerRecommendation';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import type { IProductVariant } from '@/app/(crm)/crm/offers/types';

interface Product {
  configuration_schema?: import('@/lib/CRM/Offers/modularProduct').ProductConfigurator | null;
  quantity_source?: QuantitySource;
  sales_packages?: ProductSalesPackage[];
  sales_packages_enabled?: boolean;
  pricing_addons?: ProductAddon[];
  id: string;
  name: string;
  description: string;
  offer_description?: string | null;
  base_price: number;
  pdf_thumbnail_url?: string | null;
  offer_image_path?: string | null;
  thumbnailSrc?: string | null;
  unit: string;
  category?: {
    name: string;
  };
  variants?: IProductVariant[];
}

export function ProductThumbnail({ src }: { src?: string | null }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[#d3bb73]/10">
      {src && failedSrc !== src ? (
        <Image
          src={src}
          alt=""
          width={48}
          height={48}
          sizes="48px"
          quality={60}
          unoptimized={false}
          loading="lazy"
          className="h-full w-full object-cover"
          onError={() => setFailedSrc(src)}
        />
      ) : (
        <Package className="h-5 w-5 text-[#d3bb73]" />
      )}
    </div>
  );
}

interface AddOfferItemModalProps {
  offerId: string;
  onClose: () => void;
  onSuccess: () => void;
  onAddRecommendation?: (item: OfferRecommendation) => Promise<void>;
  excludedProductIds?: ReadonlySet<string>;
}

export default function AddOfferItemModal({ offerId, onClose, onSuccess, onAddRecommendation, excludedProductIds }: AddOfferItemModalProps) {
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const saveLock = useRef(false);
  const [configurationOpen, setConfigurationOpen] = useState(false);
  const catalogDialogRef = useRef<HTMLDivElement>(null);
  const configurationDialogRef = useRef<HTMLDivElement>(null);
  const productTriggerRef = useRef<HTMLElement | null>(null);
  const closeConfiguration = () => {
    if (saveLock.current) return;
    setConfigurationOpen(false);
    setSelectedProduct(null);
  };
  useEffect(() => {
    if (!configurationOpen) return;
    const catalog = catalogDialogRef.current;
    catalog?.setAttribute('inert', '');
    configurationDialogRef.current?.focus();
    return () => {
      catalog?.removeAttribute('inert');
      productTriggerRef.current?.focus();
    };
  }, [configurationOpen]);
  const chooseProduct = (product: Product) => {
    productTriggerRef.current = document.activeElement as HTMLElement;
    setSelectedProduct(product);
    setConfigurationOpen(Boolean(product.configuration_schema || product.variants?.length
      || product.pricing_addons?.length || (product.sales_packages_enabled && product.sales_packages?.length)
      || (product.quantity_source && product.quantity_source !== 'manual')));
  };
  const { getViewMode, setViewMode } = useUserPreferences();
  const viewMode = getViewMode('offerProductPicker') === 'grid' ? 'grid' : 'list';
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState(false);
  const [mainProductIds,setMainProductIds] = useState<string[]>([]);
  const [recommendations,setRecommendations] = useState<OfferRecommendation[]>([]);
  const blockedProductIds = useMemo(()=>new Set([...mainProductIds,...Array.from(excludedProductIds || []),...(onAddRecommendation ? recommendations.map(r=>r.product_id) : [])]),[mainProductIds,excludedProductIds,recommendations,onAddRecommendation]);
  const [loading, setLoading] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<IProductVariant | null>(null);
  const [variantPrices, setVariantPrices] = useState<Record<string, number>>({});
  const [quantity, setQuantity] = useState(1);
  const [quantitySource,setQuantitySource]=useState<QuantitySource>('manual');
  const {audience,error:audienceLoadError,loading:audienceLoading,saving:audienceSaving,saveAudience,reload:reloadAudience}=useOfferAudience(offerId);
  const [audienceDirty,setAudienceDirty]=useState(false);
  const [days, setDays] = useState(1);
  const [unitPrice, setUnitPrice] = useState(0);
  const [manualModularPrice, setManualModularPrice] = useState(false);
  const [addons, setAddons] = useState<ProductAddon[]>([]);
  const [modular, setModular] = useState<ProductConfigurationSnapshot | null>(null);
  const [packageOptions, setPackageOptions] = useState<ProductSalesPackage[]>([]);
  const [selectedPackageId, setSelectedPackageId] = useState('');
  const selectedPackage = packageOptions.find(p => p.id === selectedPackageId);
  const rawConfiguration = modular ? createModularConfiguration(modular, manualModularPrice ? unitPrice : undefined) : { ...createConfiguration(unitPrice, addons, selectedPackage ? pricedPackageSelection({ selected_id: selectedPackage.id, options: packageOptions }, unitPrice) : undefined), quantity_source: selectedPackage ? 'manual' as const : quantitySource };
  const resolvedAudience=resolveAudienceConfiguration(rawConfiguration,audience,quantity);
  const configuration=resolvedAudience.configuration;
  const resolvedQuantity=resolvedAudience.quantity;
  const audienceRequired = Boolean(selectedPackage?.audience_pricing) || rawConfiguration.quantity_source !== 'manual' || addons.some(a => a.quantity_source && a.quantity_source !== 'manual');
  const audienceError=audienceLoadError || (audienceDirty ? 'Zapisz liczbę osób przyciskiem nad wyborem pakietu.' : resolvedAudience.error ? 'Uzupełnij i zapisz dane w sekcji Uczestnicy oferty powyżej.' : null);
  const configuredPrice = configurationPrice(configuration);
  const [discountPercent, setDiscountPercent] = useState(0);
  const [showVariantPricesInPdf, setShowVariantPricesInPdf] = useState(true);
  const [showProductVariantsInPdf, setShowProductVariantsInPdf] = useState(true);

  useEffect(() => {
    fetchProducts();
  }, []);

  useEffect(() => {
    if (selectedProduct) {
      const variants = selectedProduct.variants || [];
      setVariantPrices({});
      const recommendation = !onAddRecommendation ? recommendations.find(r=>r.product_id===selectedProduct.id) : undefined;
      const savedModular = recommendation?.pricing_configuration?.modular;
      const nextModular = savedModular ? structuredClone(savedModular) : !recommendation && selectedProduct.configuration_schema ? productConfigurationSnapshot(selectedProduct.configuration_schema) : null;
      setModular(nextModular);
      setManualModularPrice(recommendation?.pricing_configuration?.modular_price_source === 'manual');
      if (nextModular) {
        setSelectedVariant(null); setVariantPrices({}); setQuantitySource('manual'); setPackageOptions([]); setSelectedPackageId(''); setAddons([]);
        setUnitPrice(recommendation?.pricing_configuration?.modular_price_source === 'manual' ? recommendation.pricing_configuration.base_unit_price : createModularConfiguration(nextModular).base_unit_price); setQuantity(recommendation?.quantity || 1); setDays(recommendation?.days ?? 1); setDiscountPercent(recommendation?.discount_percent || 0);
        setShowVariantPricesInPdf(false); setShowProductVariantsInPdf(false); return;
      }
      // A saved proposal owns its prices and scope; do not replace them with catalog defaults.
      setAddons((recommendation ? recommendation.pricing_configuration?.addons || [] : selectedProduct.pricing_addons || []).map(a => ({ ...a })));
      const defaultVariant = recommendation ? variants.find(v=>v.id===recommendation.product_variant_id) || null : variants.find((variant) => variant.is_recommended) || variants[0] || null;
      setSelectedVariant(defaultVariant);
      setQuantitySource(recommendation?.pricing_configuration?.quantity_source || defaultVariant?.quantity_source || selectedProduct.quantity_source || 'manual');
      setUnitPrice(recommendation ? Number(recommendation.pricing_configuration?.base_unit_price ?? recommendation.unit_price) : defaultVariant ? Number(defaultVariant.price_net || 0) : selectedProduct.base_price);
      setQuantity(recommendation?.quantity || 1);
      setDays(recommendation?.days ?? 1);
      setDiscountPercent(recommendation?.pricing_configuration ? Number(recommendation.discount_percent || 0) : 0);
      const copied = recommendation?.pricing_configuration?.product_package;
      const options = copied?.options || (selectedProduct.sales_packages_enabled ? selectedProduct.sales_packages || [] : []);
      setPackageOptions(structuredClone(options));
      const pkg = copied ? options.find(p => p.id === copied.selected_id) : recommendation ? null : options[0];
      setSelectedPackageId(pkg?.id || '');
      if (pkg) {
        setSelectedVariant(null);
        setAddons(recommendation?.pricing_configuration?.addons || (pkg.include_product_addons ? structuredClone(selectedProduct.pricing_addons || []) : []));
        setUnitPrice(recommendation?.pricing_configuration?.base_unit_price ?? pkg.price_net);
        setShowVariantPricesInPdf(false);
      }

    }
  }, [selectedProduct]);

  useEffect(() => {
    if (selectedProduct && blockedProductIds.has(selectedProduct.id)) {
      setSelectedProduct(null);
      setSelectedVariant(null);
    }
  }, [blockedProductIds, selectedProduct]);

  const fetchProducts = async (refresh = false) => {
    setCatalogLoading(true); setCatalogError(false);
    try {
      const [main, extras] = await Promise.all([
        supabase.from('offer_items').select('product_id').eq('offer_id',offerId),
        supabase.from('offers').select('recommended_items').eq('id',offerId).single(),
      ]);
      if(main.error) throw main.error;
      if(extras.error) throw extras.error;
      setMainProductIds((main.data||[]).map(row=>row.product_id).filter(Boolean));
      setRecommendations(extras.data.recommended_items||[]);
      setProducts(await loadOfferPickerCatalog(refresh));
    } catch (error) {
      setCatalogError(true);
      console.error('Error fetching products:', error);
      showSnackbar('Błąd podczas ładowania produktów', 'error');
    } finally { setCatalogLoading(false); }
  };

  const filteredProducts = products.filter(
    (p) =>
      !blockedProductIds.has(p.id) && (
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.description?.toLowerCase().includes(searchQuery.toLowerCase())
      ),
  );

  const handleAddItem = async () => {
    if (saveLock.current) return;
    if (audienceLoading || audienceSaving || audienceError) { showSnackbar(audienceError || 'Wczytywanie liczby uczestników…','error'); return; }
    if (!selectedProduct) {
      showSnackbar('Wybierz produkt', 'error');
      return;
    }
    if (blockedProductIds.has(selectedProduct.id)) {
      showSnackbar('Ten produkt jest już dodany. Wybierz inną pozycję.', 'error');
      return;
    }

    if (!Number.isInteger(days) || days < 1 || days > 3650 || !Number.isFinite(resolvedQuantity) || resolvedQuantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0 || !Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) {
      showSnackbar('Podaj poprawną ilość, liczbę dni (1–3650), cenę i rabat od 0 do 100%.', 'error');
      return;
    }

    if (Object.values(variantPrices).some(price => !Number.isFinite(price) || price < 0 || price > 999999999.99)) {
      showSnackbar('Podaj poprawne, nieujemne ceny wszystkich wariantów.', 'error'); return;
    }
    const addonError = validateConfiguration(configuration);
    if (addonError) { showSnackbar(addonError, 'error'); return; }
    saveLock.current = true;
    setLoading(true);

    try {
      const calculatedDiscountAmount = Math.round(resolvedQuantity * days * configuredPrice * discountPercent) / 100;

      if (onAddRecommendation) {
        await onAddRecommendation({
          id: crypto.randomUUID(),
          product_id: selectedProduct.id,
          product_variant_id: selectedVariant?.id || null,
          name: modular ? modularTitle(modular) : selectedPackage ? `${selectedProduct.name} — ${selectedPackage.name}` : selectedVariant ? `${selectedProduct.name} — ${selectedVariant.name}` : selectedProduct.name,
          description: modular ? modularScope(modular).join('\n') : selectedProduct.offer_description || selectedProduct.description || selectedVariant?.description || selectedVariant?.short_description || '',
          quantity: resolvedQuantity,
          days,
          unit: modular ? 'zestaw' : selectedPackage ? 'pakiet' : quantitySource === 'guests' ? 'osoba' : quantitySource === 'tables' ? 'stół' : selectedProduct.unit,
          unit_price: Math.round(configuredPrice * (1 - discountPercent / 100) * 100) / 100,
          pricing_configuration: configuration,
          discount_percent: discountPercent,
          image_path: selectedPackage?.image_path || selectedVariant?.offer_image_path || selectedProduct.offer_image_path || selectedProduct.pdf_thumbnail_url || null,
        });
        showSnackbar('Propozycja dodana do edycji — zatwierdź przyciskiem Zapisz w sekcji propozycji', 'success');
        onSuccess();
        onClose();
        return;
      }

      const {data: current, error: currentError} = await supabase.from('offers').select('recommended_items').eq('id',offerId).single();
      if(currentError) throw currentError;
      const proposal = (current.recommended_items || []).find((r: OfferRecommendation)=>r.product_id===selectedProduct.id) as OfferRecommendation | undefined;
      const moving = Boolean(proposal);
      if(proposal && JSON.stringify(proposal) !== JSON.stringify(recommendations.find(r=>r.product_id===selectedProduct.id))) throw new Error('Propozycja została zmieniona. Zamknij i otwórz ponownie dodawanie, aby wczytać jej aktualne dane.');
      if(moving && !await showConfirm({title:'Przenieść produkt do oferty?',message:`„${selectedProduct.name}” jest już w sekcji „Zobacz, co warto dobrać do takiego wydarzenia”. Przenieść go do głównej listy? Zniknie z propozycji i będzie uwzględniony w wycenie.`,confirmText:'Przenieś do oferty',cancelText:'Anuluj'})) return;
      const { error } = await supabase.rpc('add_offer_item_without_duplicate', {p_offer_id:offerId,p_move_recommendation:moving,p_expected_recommendations:current.recommended_items,p_item:{
        offer_id: offerId,
        product_id: selectedProduct.id,
        product_variant_id: selectedVariant?.id || null,
        variant_prices_net: { ...variantPrices, ...(selectedVariant ? { [selectedVariant.id]: unitPrice } : {}) },
        show_variant_prices_in_pdf: modular ? false : showVariantPricesInPdf,
        show_product_variants_in_pdf: modular ? false : showProductVariantsInPdf,
        name: modular ? modularTitle(modular) : selectedPackage ? `${selectedProduct.name} — ${selectedPackage.name}` : proposal && proposal.product_variant_id === (selectedVariant?.id || null) ? proposal.name : selectedVariant ? `${selectedProduct.name} — ${selectedVariant.name}` : selectedProduct.name,
        description: modular ? modularScope(modular).join('\n') : selectedPackage ? [selectedPackage.included_label, selectedPackage.bonus].filter(Boolean).join('. ') : proposal && proposal.product_variant_id === (selectedVariant?.id || null) ? proposal.description : selectedVariant?.description || selectedVariant?.short_description || selectedProduct.description,
        quantity: resolvedQuantity,
        days,
        unit: modular ? 'zestaw' : selectedPackage ? 'pakiet' : quantitySource === 'guests' ? 'osoba' : quantitySource === 'tables' ? 'stół' : selectedProduct.unit,
        unit_price: configuredPrice,
        pricing_configuration: configuration,
        unit_cost: 0,
        discount_percent: discountPercent,
        discount_amount: calculatedDiscountAmount,
        transport_cost: 0,
        logistics_cost: 0,
        display_order: 999,
        notes: null,
      }});

      if (error) throw error;

      showSnackbar('Pozycja dodana do oferty', 'success');
      onSuccess();
      onClose();
    } catch (error: any) {
      console.error('Error adding item:', error);
      showSnackbar(error.message || 'Błąd podczas dodawania pozycji', 'error');
    } finally {
      saveLock.current = false;
      setLoading(false);
    }
  };

  const subtotal = resolvedQuantity * days * configuredPrice;
  const total = onAddRecommendation
    ? Math.round(resolvedQuantity * days * (Math.round(configuredPrice * (1 - discountPercent / 100) * 100) / 100) * 100) / 100
    : Math.round((subtotal - Math.round(subtotal * discountPercent) / 100) * 100) / 100;
  const discountAmount = Math.round((subtotal - total) * 100) / 100;

  const detailsPanel = selectedProduct ? (
<div className="space-y-4 rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
              <h3 className="text-lg font-medium text-[#e5e4e2]">Szczegóły pozycji</h3>

              <InlineOfferAudience audience={audience} needsTables={configurationNeedsTables(rawConfiguration)} required={audienceRequired} loading={audienceLoading} saving={audienceSaving} loadError={audienceLoadError} disabled={loading} onSave={saveAudience} onRetry={reloadAudience} onDirtyChange={setAudienceDirty} />
              {modular && <ModularProductConfigurator quantity={quantity} value={modular} disabled={loading} onChange={next => { setModular(next); if (!manualModularPrice) setUnitPrice(createModularConfiguration(next).base_unit_price); }} />}
          {modular && <ModularPriceHint value={modular} manual={manualModularPrice} disabled={loading} onReset={() => { setManualModularPrice(false); setUnitPrice(createModularConfiguration(modular).base_unit_price); }} />}
              {!modular && <ProductPackagePicker allowIndividual={Boolean(selectedProduct.variants?.length)} options={configuration.product_package?.options || packageOptions} selectedId={selectedPackageId} disabled={loading} discountPercent={discountPercent}
                onChange={options => { setPackageOptions(options); const p = options.find(p => p.id === selectedPackageId); if(p) setUnitPrice(p.price_net); }}
                onSelect={id => { setSelectedPackageId(id); const p = packageOptions.find(p => p.id === id); if(p) { setQuantity(1); setQuantitySource('manual'); setSelectedVariant(null); setUnitPrice(p.price_net); setAddons(p.include_product_addons ? structuredClone(selectedProduct.pricing_addons || []) : []); } else { const v = selectedProduct.variants?.[0] || null; setSelectedVariant(v); setQuantitySource(v?.quantity_source || selectedProduct.quantity_source || 'manual'); setUnitPrice(Number(v?.price_net ?? selectedProduct.base_price)); setAddons((selectedProduct.pricing_addons || []).map(a=>({...a}))); } }} />}
              {!modular && !selectedPackage && (selectedProduct.variants || []).length > 0 && (
                <div>
                  <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                    Wariant produktu
                  </label>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {(selectedProduct.variants || []).map((variant) => (
                      <button
                        key={variant.id}
                        type="button"
                        onClick={() => {
                          setSelectedVariant(variant);
                          setQuantitySource(variant.quantity_source || 'manual');
                          setUnitPrice(Number(variantPrices[variant.id] ?? variant.price_net ?? 0));
                        }}
                        className={`rounded-lg border px-3 py-3 text-left ${
                          selectedVariant?.id === variant.id
                            ? 'border-[#d3bb73]/20 bg-[#d3bb73]/10'
                            : 'border-[#d3bb73]/10 bg-[#0d0f1a]'
                        }`}
                      >
                        <span className="block text-sm font-medium text-[#e5e4e2]">{variant.name}</span>
                        <span className="mt-1 block text-sm text-[#d3bb73]">
                          {Number(variantPrices[variant.id] ?? variant.price_net ?? 0).toFixed(2)} PLN
                        </span>
                      </button>
                    ))}
                  </div>
                  {!onAddRecommendation && <div className="mt-3 space-y-2">
                    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-[#d3bb73]/10 bg-[#0d0f1a] px-3 py-2.5">
                      <span><span className="block text-sm text-[#e5e4e2]">Pokaż wszystkie warianty w PDF</span><span className="mt-0.5 block text-xs text-[#e5e4e2]/40">Po wyłączeniu drukowany jest tylko wybrany wariant</span></span>
                      <input type="checkbox" checked={addons.length ? false : showProductVariantsInPdf} disabled={Boolean(addons.length)} onChange={(event) => setShowProductVariantsInPdf(event.target.checked)} className="h-4 w-4 accent-[#d3bb73]" />
                    </label>
                    <label className={`flex items-center justify-between gap-3 rounded-lg border border-[#d3bb73]/10 bg-[#0d0f1a] px-3 py-2.5 ${showProductVariantsInPdf ? 'cursor-pointer' : 'cursor-not-allowed opacity-40'}`}>
                      <span><span className="block text-sm text-[#e5e4e2]">Pokaż ceny wariantów w PDF</span><span className="mt-0.5 block text-xs text-[#e5e4e2]/40">Cena netto i brutto VAT 23% przy każdym wariancie</span></span>
                      <input type="checkbox" checked={showVariantPricesInPdf} disabled={!showProductVariantsInPdf || Boolean(addons.length)} onChange={(event) => setShowVariantPricesInPdf(event.target.checked)} className="h-4 w-4 accent-[#d3bb73]" />
                    </label>
                  </div>}
                </div>
              )}

              <div className="grid grid-cols-2 items-end gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,2.5fr)_minmax(0,1fr)]">
                <div className="min-w-0">
                  <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Liczba dni</label>
                  <input type="number" min="1" max="3650" step="1" value={days} onChange={e => setDays(Number(e.target.value))} className="w-full min-w-0 rounded-lg border border-white/10 bg-[#0d0f1a] px-4 py-2 text-[#e5e4e2]" />
                </div>
                <div className="min-w-0">
                  <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Ilość</label>
                  <input
                    type="number"
                    value={resolvedQuantity}
                    disabled={quantitySource !== 'manual' && !selectedPackage}
                    onChange={(e) => setQuantity(Number(e.target.value))}
                    min="1"
                    step="1"
                    className="w-full min-w-0 rounded-lg border border-[#d3bb73]/10 bg-[#0d0f1a] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
                  />
                </div>

                <div className="min-w-0">
                  <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                    {addons.length ? 'Cena bazowa netto / dzień (PLN)' : 'Cena jednostkowa netto / dzień (PLN)'}
                  </label>
                  <input
                    type="number"
                    disabled={loading || Boolean(selectedPackage?.audience_pricing)}
                    value={selectedPackage?.audience_pricing || (modular && !manualModularPrice) ? configuration.base_unit_price : Number.isFinite(unitPrice) ? unitPrice : ''}
                    onChange={(e) => {
                      const price = e.target.value === '' ? NaN : Number(e.target.value);
                      if (modular) setManualModularPrice(true);
                      setUnitPrice(price);
                      if (selectedVariant) setVariantPrices(current => ({ ...current, [selectedVariant.id]: price }));
                    }}
                    min="0"
                    step="0.01"
                    className="w-full min-w-0 rounded-lg border border-[#d3bb73]/10 bg-[#0d0f1a] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
                  />
                </div>

                <div className="min-w-0">
                  <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Rabat (%)</label>
                  <input
                    type="number"
                    value={discountPercent}
                    onChange={(e) => setDiscountPercent(Number(e.target.value))}
                    min="0"
                    max="100"
                    step="1"
                    className="w-full min-w-0 rounded-lg border border-[#d3bb73]/10 bg-[#0d0f1a] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
                  />
                </div>
              </div>

              <div className="space-y-2 text-xs text-[#e5e4e2]/65">
                {!modular && !selectedPackage && <QuantitySourceSelect value={quantitySource} onChange={setQuantitySource}/>}
                {audience.guest_count && <p>Oferta dla {audience.guest_count} osób{configurationNeedsTables(configuration) ? ` · stoły: ${audience.table_count ?? Math.ceil(audience.guest_count/(audience.guests_per_table || 10))}` : ''}</p>}
                {selectedPackage?.audience_pricing && <p>Cena pakietu obliczona z liczby gości i stołów. Stawki zmienisz w ustawieniach pakietu.</p>}
                {audienceError && <p role="alert" className="text-amber-300">{audienceError}</p>}
              </div>
              {!modular && <ProductAddonsEditor value={configuration.addons} onChange={setAddons} disabled={loading} />}

              {!modular && !selectedPackage && !onAddRecommendation && !!selectedProduct.variants?.length && <VariantPricesEditor variants={selectedProduct.variants} prices={variantPrices} disabled={loading} onChange={(id, price) => {
                setVariantPrices(current => ({ ...current, [id]: price }));
                if (id === selectedVariant?.id) setUnitPrice(price);
              }} />}

              <div className="border-t border-[#d3bb73]/10 pt-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[#e5e4e2]/60">Wartość netto przed rabatem:</span>
                  <span className="text-[#e5e4e2]">{subtotal.toFixed(2)} PLN</span>
                </div>
                {discountPercent > 0 && (
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[#e5e4e2]/60">Rabat:</span>
                    <span className="text-green-400">-{discountAmount.toFixed(2)} PLN</span>
                  </div>
                )}
                <div className="flex items-center justify-between text-lg font-medium">
                  <span className="text-[#e5e4e2]">Razem netto:</span>
                  <span className="text-[#d3bb73]">{total.toFixed(2)} PLN</span>
                </div>
              </div>
            </div>
  ) : null;

  return (
    <>
    <div ref={catalogDialogRef} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex h-[90dvh] max-h-[90dvh] w-full max-w-5xl flex-col rounded-xl border border-[#d3bb73]/20 bg-[#0f1119]">
        <div className="flex shrink-0 items-center justify-between border-b border-[#d3bb73]/20 p-6">
          <h2 className="text-xl font-light text-[#e5e4e2]">{onAddRecommendation ? 'Dodaj proponowany produkt' : 'Dodaj pozycję do oferty'}</h2>
          <button
            onClick={onClose}
            className="text-[#e5e4e2]/60 transition-colors hover:text-[#e5e4e2]"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="shrink-0 px-6 pt-4 pb-3">
          <div>
            <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
              Wyszukaj produkt
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#e5e4e2]/40" />
              <input
                type="text"
                autoFocus
                aria-label="Wyszukaj produkt"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Nazwa produktu..."
                className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] py-2 pl-10 pr-4 text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:border-[#d3bb73]/30 focus:outline-none"
              />
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between gap-3">
            <button type="button" disabled={catalogLoading} onClick={() => void fetchProducts(true)} className="inline-flex items-center gap-2 text-xs text-[#d3bb73] disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${catalogLoading ? 'animate-spin' : ''}`} />Odśwież katalog</button>
            <div className="flex gap-1" role="group" aria-label="Widok produktów">
              {(['grid', 'list'] as const).map(mode => <button type="button" key={mode} aria-pressed={viewMode === mode} onClick={() => setViewMode('offerProductPicker', mode)} className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm ${viewMode === mode ? 'bg-[#d3bb73]/15 text-[#d3bb73]' : 'text-white/50 hover:bg-white/5'}`}>{mode === 'grid' ? <LayoutGrid className="h-4 w-4" /> : <List className="h-4 w-4" />}{mode === 'grid' ? 'Siatka' : 'Lista'}</button>)}
            </div>
          </div>
        </div>
        <div className={`min-h-0 flex-1 px-6 pb-6 ${selectedProduct && !configurationOpen ? 'space-y-4 overflow-y-auto' : 'flex flex-col gap-3 overflow-hidden'}`} style={{ scrollbarGutter: 'stable' }}>
          {catalogLoading && !products.length && <p role="status" className="py-6 text-sm text-white/50">Ładowanie katalogu…</p>}
          {catalogError && <p role="alert" className="text-sm text-red-300">Nie udało się odświeżyć katalogu. Użyj przycisku „Odśwież katalog”.</p>}
          <div className={`grid content-start gap-3 overflow-y-auto ${selectedProduct && !configurationOpen ? 'max-h-40 shrink-0' : 'min-h-0 flex-1'} ${viewMode === 'grid' ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}`}>

            {filteredProducts.map((product) => (
              <button
                key={product.id}
                onClick={() => chooseProduct(product)}
                className={`rounded-lg border text-left transition-colors ${viewMode === 'list' ? 'px-3 py-2' : 'p-4'} ${
                  selectedProduct?.id === product.id
                    ? 'border-[#d3bb73]/20 bg-[#d3bb73]/10'
                    : 'border-[#d3bb73]/10 bg-[#1c1f33] hover:border-[#d3bb73]/30'
                }`}
              >
                <div className="flex items-start gap-3">
                  <ProductThumbnail src={product.thumbnailSrc} />
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-medium text-[#e5e4e2]">{product.name}</h3>
                    <p className={`mt-1 text-xs text-[#e5e4e2]/60 ${viewMode === 'list' ? 'line-clamp-1' : 'line-clamp-2'}`}>
                      {product.description}
                    </p>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-xs text-[#e5e4e2]/40">{product.category?.name}</span>
                      <span className="text-sm font-medium text-[#d3bb73]">
                        {product.configuration_schema ? 'Konfiguruj cenę' : product.sales_packages_enabled && product.sales_packages?.some(p=>p.price_on_request && p.price_net <= 0) ? 'Wycena indywidualna' : `${(product.sales_packages_enabled && product.sales_packages?.length ? Math.min(...product.sales_packages.map(p=>p.price_net)) : product.variants?.length ? Math.min(...product.variants.map(v=>Number(v.price_net || 0))) : product.base_price).toFixed(2)} PLN`}
                      </span>
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
          {!catalogLoading && !catalogError && !filteredProducts.length && <p className="text-center text-sm text-[#e5e4e2]/45">{onAddRecommendation ? 'Brak pasujących propozycji. Produkty obecne w głównej ofercie są ukryte.' : 'Nie znaleziono pasujących produktów.'}</p>}

          {!configurationOpen && detailsPanel}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-3 border-t border-[#d3bb73]/20 p-6">
          <button
            onClick={onClose}
            className="rounded-lg px-6 py-2 text-[#e5e4e2] transition-colors hover:bg-[#1c1f33]"
          >
            Anuluj
          </button>
          <button
            onClick={handleAddItem}
            disabled={loading || !selectedProduct || blockedProductIds.has(selectedProduct.id)}
            className="rounded-lg bg-[#d3bb73] px-6 py-2 font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? 'Dodawanie...' : onAddRecommendation ? 'Dodaj propozycję' : 'Dodaj pozycję'}
          </button>
        </div>
      </div>
    </div>
    {configurationOpen && selectedProduct && createPortal(
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4">
        <div ref={configurationDialogRef} role="dialog" aria-modal="true" aria-labelledby="offer-product-configuration-title" tabIndex={-1}
          className="flex h-[90dvh] w-full max-w-5xl flex-col rounded-xl bg-[#0f1119] outline-none"
          onKeyDown={event => {
            if (event.key === 'Escape') { event.stopPropagation(); closeConfiguration(); }
            if (event.key === 'Tab') {
              const nodes = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]')).filter(node => node.getClientRects().length > 0);
              const first = nodes[0], last = nodes[nodes.length - 1];
              if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last?.focus(); }
              else if (!event.shiftKey && (document.activeElement === last || document.activeElement === event.currentTarget)) { event.preventDefault(); first?.focus(); }
            }
          }}>
          <div className="flex shrink-0 items-center justify-between gap-4 p-6">
            <h2 id="offer-product-configuration-title" className="text-xl text-[#e5e4e2]">Konfiguracja: {selectedProduct.name}</h2>
            <button type="button" disabled={loading} onClick={closeConfiguration} aria-label="Zamknij konfigurację" className="p-2 text-white/60 hover:text-white"><X className="h-6 w-6" /></button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">{detailsPanel}</div>
          <div className="flex shrink-0 items-center justify-end gap-3 border-t border-white/5 p-6">
            <button type="button" disabled={loading} onClick={closeConfiguration} className="rounded-lg px-4 py-2 text-[#e5e4e2] hover:bg-white/5">Wróć do produktów</button>
            <button type="button" onClick={handleAddItem} disabled={loading || blockedProductIds.has(selectedProduct.id)} className="rounded-lg bg-[#d3bb73] px-6 py-2 font-medium text-[#1c1f33] disabled:opacity-50">{loading ? 'Dodawanie…' : onAddRecommendation ? 'Dodaj propozycję' : 'Dodaj pozycję'}</button>
          </div>
        </div>
      </div>, document.body)}
    </>
  );
}
