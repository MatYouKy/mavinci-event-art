'use client';
import ProductPackagePicker from '@/components/crm/offers/ProductPackagePicker';
import { pricedPackageSelection, type ProductSalesPackage } from '@/lib/CRM/Offers/productSalesPackages';

import ProductAddonsEditor from '@/components/crm/offers/ProductAddonsEditor';
import { createConfiguration, configurationPrice, validateConfiguration, type ProductAddon } from '@/lib/CRM/Offers/offerAddons';
import { useDialog } from '@/contexts/DialogContext';
import { VariantPricesEditor } from './VariantPricesEditor';

import { useState, useEffect, useRef, useMemo } from 'react';
import { X, Plus, Search, Package } from 'lucide-react';
import Image from 'next/image';
import type { OfferRecommendation } from './offerRecommendation';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import type { IProductVariant } from '@/app/(crm)/crm/offers/types';

interface Product {
  sales_packages?: ProductSalesPackage[];
  sales_packages_enabled?: boolean;
  pricing_addons?: ProductAddon[];
  id: string;
  name: string;
  description: string;
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
  const [unitPrice, setUnitPrice] = useState(0);
  const [addons, setAddons] = useState<ProductAddon[]>([]);
  const [packageOptions, setPackageOptions] = useState<ProductSalesPackage[]>([]);
  const [selectedPackageId, setSelectedPackageId] = useState('');
  const selectedPackage = packageOptions.find(p => p.id === selectedPackageId);
  const configuration = createConfiguration(unitPrice, addons, selectedPackage ? pricedPackageSelection({ selected_id: selectedPackage.id, options: packageOptions }, unitPrice) : undefined);
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
      // A saved proposal owns its prices and scope; do not replace them with catalog defaults.
      setAddons((recommendation ? recommendation.pricing_configuration?.addons || [] : selectedProduct.pricing_addons || []).map(a => ({ ...a })));
      const defaultVariant = recommendation ? variants.find(v=>v.id===recommendation.product_variant_id) || null : variants.find((variant) => variant.is_recommended) || variants[0] || null;
      setSelectedVariant(defaultVariant);
      setUnitPrice(recommendation ? Number(recommendation.pricing_configuration?.base_unit_price ?? recommendation.unit_price) : defaultVariant ? Number(defaultVariant.price_net || 0) : selectedProduct.base_price);
      setQuantity(recommendation?.quantity || 1);
      setDiscountPercent(recommendation?.pricing_configuration ? Number(recommendation.discount_percent || 0) : 0);
      const copied = recommendation?.pricing_configuration?.product_package;
      const options = copied?.options || (selectedProduct.sales_packages_enabled ? selectedProduct.sales_packages || [] : []);
      setPackageOptions(structuredClone(options));
      const pkg = copied ? options.find(p => p.id === copied.selected_id) : recommendation ? null : options[0];
      setSelectedPackageId(pkg?.id || '');
      if (pkg) {
        setSelectedVariant(null);
        setAddons(recommendation?.pricing_configuration?.addons || []);
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

  const fetchProducts = async () => {
    try {
      const [main, extras] = await Promise.all([
        supabase.from('offer_items').select('product_id').eq('offer_id',offerId),
        supabase.from('offers').select('recommended_items').eq('id',offerId).single(),
      ]);
      if(main.error) throw main.error;
      if(extras.error) throw extras.error;
      setMainProductIds((main.data||[]).map(row=>row.product_id).filter(Boolean));
      setRecommendations(extras.data.recommended_items||[]);
      const { data, error } = await supabase
        .from('offer_products')
        .select(
          `
          *,
          variants:offer_product_variants(id, product_id, name, short_description, description, benefits, price_net, price_gross, offer_image_path, is_recommended, is_active, display_order),
          category:event_categories(name)
        `,
        )
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      const imagePaths = Array.from(new Set<string>((data || [])
        .map((product) => product.pdf_thumbnail_url || product.offer_image_path)
        .filter((path): path is string => Boolean(path))));
      const thumbnailUrls = new Map<string, string>();
      if (imagePaths.length > 0) {
        // Sign in one request; Next Image resizes and compresses before delivery.
        const { data: signedImages, error: imageError } = await supabase.storage
          .from('offer-product-pages')
          .createSignedUrls(imagePaths, 3600);
        if (imageError) console.error('Error preparing product thumbnails:', imageError);
        for (const image of signedImages || []) {
          if (image.path && image.signedUrl && !image.error) {
            thumbnailUrls.set(image.path, image.signedUrl);
          }
        }
      }
      setProducts((data || []).map((product: any) => ({
        ...product,
        thumbnailSrc: thumbnailUrls.get(product.pdf_thumbnail_url || product.offer_image_path) || null,
        variants: [...(product.variants || [])]
          .filter((variant: IProductVariant) => variant.is_active !== false)
          .sort((a: IProductVariant, b: IProductVariant) => a.display_order - b.display_order),
      })));
    } catch (error) {
      console.error('Error fetching products:', error);
      showSnackbar('Błąd podczas ładowania produktów', 'error');
    }
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
    if (!selectedProduct) {
      showSnackbar('Wybierz produkt', 'error');
      return;
    }
    if (blockedProductIds.has(selectedProduct.id)) {
      showSnackbar('Ten produkt jest już dodany. Wybierz inną pozycję.', 'error');
      return;
    }

    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0 || !Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) {
      showSnackbar('Podaj poprawną ilość, cenę i rabat od 0 do 100%.', 'error');
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
      const calculatedDiscountAmount = Math.round(quantity * configuredPrice * discountPercent) / 100;

      if (onAddRecommendation) {
        await onAddRecommendation({
          id: crypto.randomUUID(),
          product_id: selectedProduct.id,
          product_variant_id: selectedVariant?.id || null,
          name: selectedPackage ? `${selectedProduct.name} — ${selectedPackage.name}` : selectedVariant ? `${selectedProduct.name} — ${selectedVariant.name}` : selectedProduct.name,
          description: selectedPackage ? [selectedPackage.included_label, selectedPackage.bonus].filter(Boolean).join('. ') : selectedVariant?.short_description || selectedVariant?.description || selectedProduct.description || '',
          quantity,
          unit: selectedPackage ? 'pakiet' : selectedProduct.unit,
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
        show_variant_prices_in_pdf: showVariantPricesInPdf,
        show_product_variants_in_pdf: showProductVariantsInPdf,
        name: selectedPackage ? `${selectedProduct.name} — ${selectedPackage.name}` : proposal && proposal.product_variant_id === (selectedVariant?.id || null) ? proposal.name : selectedVariant ? `${selectedProduct.name} — ${selectedVariant.name}` : selectedProduct.name,
        description: selectedPackage ? [selectedPackage.included_label, selectedPackage.bonus].filter(Boolean).join('. ') : proposal && proposal.product_variant_id === (selectedVariant?.id || null) ? proposal.description : selectedVariant?.description || selectedVariant?.short_description || selectedProduct.description,
        quantity,
        unit: selectedPackage ? 'pakiet' : selectedProduct.unit,
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

  const subtotal = quantity * configuredPrice;
  const total = onAddRecommendation
    ? Math.round(quantity * (Math.round(configuredPrice * (1 - discountPercent / 100) * 100) / 100) * 100) / 100
    : Math.round((subtotal - Math.round(subtotal * discountPercent) / 100) * 100) / 100;
  const discountAmount = Math.round((subtotal - total) * 100) / 100;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col rounded-xl border border-[#d3bb73]/20 bg-[#0f1119]">
        <div className="flex items-center justify-between border-b border-[#d3bb73]/20 p-6">
          <h2 className="text-xl font-light text-[#e5e4e2]">{onAddRecommendation ? 'Dodaj proponowany produkt' : 'Dodaj pozycję do oferty'}</h2>
          <button
            onClick={onClose}
            className="text-[#e5e4e2]/60 transition-colors hover:text-[#e5e4e2]"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto p-6">
          <div>
            <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
              Wyszukaj produkt
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#e5e4e2]/40" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Nazwa produktu..."
                className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] py-2 pl-10 pr-4 text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:border-[#d3bb73]/30 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid max-h-64 grid-cols-1 gap-3 overflow-y-auto md:grid-cols-2">
            {filteredProducts.map((product) => (
              <button
                key={product.id}
                onClick={() => setSelectedProduct(product)}
                className={`rounded-lg border p-4 text-left transition-all ${
                  selectedProduct?.id === product.id
                    ? 'border-[#d3bb73] bg-[#d3bb73]/10'
                    : 'border-[#d3bb73]/10 bg-[#1c1f33] hover:border-[#d3bb73]/30'
                }`}
              >
                <div className="flex items-start gap-3">
                  <ProductThumbnail src={product.thumbnailSrc} />
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-medium text-[#e5e4e2]">{product.name}</h3>
                    <p className="mt-1 line-clamp-2 text-xs text-[#e5e4e2]/60">
                      {product.description}
                    </p>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-xs text-[#e5e4e2]/40">{product.category?.name}</span>
                      <span className="text-sm font-medium text-[#d3bb73]">
                        {(product.variants?.length
                          ? Math.min(...product.variants.map((variant) => Number(variant.price_net || 0)))
                          : product.base_price
                        ).toFixed(2)} PLN
                      </span>
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
          {!filteredProducts.length && <p className="text-center text-sm text-[#e5e4e2]/45">{onAddRecommendation ? 'Brak pasujących propozycji. Produkty obecne w głównej ofercie są ukryte.' : 'Nie znaleziono pasujących produktów.'}</p>}

          {selectedProduct && (
            <div className="space-y-4 rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
              <h3 className="text-lg font-medium text-[#e5e4e2]">Szczegóły pozycji</h3>

              <ProductPackagePicker options={packageOptions.map(p => p.id === selectedPackageId ? { ...p, price_net: unitPrice } : p)} selectedId={selectedPackageId} disabled={loading} discountPercent={discountPercent}
                onChange={options => { setPackageOptions(options); const p = options.find(p => p.id === selectedPackageId); if(p) setUnitPrice(p.price_net); }}
                onSelect={id => { setSelectedPackageId(id); const p = packageOptions.find(p => p.id === id); if(p) { setSelectedVariant(null); setUnitPrice(p.price_net); setAddons([]); } else { const v = selectedProduct.variants?.[0] || null; setSelectedVariant(v); setUnitPrice(Number(v?.price_net ?? selectedProduct.base_price)); setAddons((selectedProduct.pricing_addons || []).map(a=>({...a}))); } }} />
              {!selectedPackage && (selectedProduct.variants || []).length > 0 && (
                <div>
                  <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                    Wariant produktu
                  </label>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {(selectedProduct.variants || []).slice(0, 3).map((variant) => (
                      <button
                        key={variant.id}
                        type="button"
                        onClick={() => {
                          setSelectedVariant(variant);
                          setUnitPrice(Number(variantPrices[variant.id] ?? variant.price_net ?? 0));
                        }}
                        className={`rounded-lg border px-3 py-3 text-left ${
                          selectedVariant?.id === variant.id
                            ? 'border-[#d3bb73] bg-[#d3bb73]/10'
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

              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div>
                  <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Ilość</label>
                  <input
                    type="number"
                    value={quantity}
                    onChange={(e) => setQuantity(Number(e.target.value))}
                    min="1"
                    step="1"
                    className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0d0f1a] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                    {addons.length ? 'Cena bazowa netto (PLN)' : 'Cena jednostkowa netto (PLN)'}
                  </label>
                  <input
                    type="number"
                    value={Number.isFinite(unitPrice) ? unitPrice : ''}
                    onChange={(e) => {
                      const price = e.target.value === '' ? NaN : Number(e.target.value);
                      setUnitPrice(price);
                      if (selectedVariant) setVariantPrices(current => ({ ...current, [selectedVariant.id]: price }));
                    }}
                    min="0"
                    step="0.01"
                    className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0d0f1a] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Rabat (%)</label>
                  <input
                    type="number"
                    value={discountPercent}
                    onChange={(e) => setDiscountPercent(Number(e.target.value))}
                    min="0"
                    max="100"
                    step="1"
                    className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0d0f1a] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
                  />
                </div>
              </div>

              <ProductAddonsEditor value={addons} onChange={setAddons} disabled={loading} />

              {!selectedPackage && !onAddRecommendation && !!selectedProduct.variants?.length && <VariantPricesEditor variants={selectedProduct.variants} prices={variantPrices} disabled={loading} onChange={(id, price) => {
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
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-[#d3bb73]/20 p-6">
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
  );
}
