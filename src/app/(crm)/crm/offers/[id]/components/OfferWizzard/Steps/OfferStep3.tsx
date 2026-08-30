'use client';

import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  LayoutList,
  Package,
  Search,
  ShoppingCart,
  Table2,
  Trash2,
} from 'lucide-react';
import { useUserPreferences } from '@/app/(crm)/crm/PreferencesClientProvider';
import type { IOfferItem, IProduct, IProductVariant } from '@/app/(crm)/crm/offers/types';
import { supabase } from '@/lib/supabase/browser';
import Popover from '@/components/UI/Tooltip';

interface ProductCategory {
  id: string;
  name: string;
}

type CatalogViewMode = 'list' | 'table';

interface OfferStep3Props {
  offerItems: IOfferItem[];
  products: IProduct[];
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  selectedCategory: string;
  setSelectedCategory: (value: string) => void;
  categories: ProductCategory[];
  filteredProducts: IProduct[];
  addProductToOffer: (product: IProduct, variant?: IProductVariant) => void;
  updateOfferItem: (itemId: string, patch: Partial<IOfferItem>) => void;
  removeOfferItem: (itemId: string) => void;
}

const THUMBNAIL_BUCKET = 'offer-product-pages';

const normalizeThumbnailPath = (value: unknown) => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^(?:https?:|data:|blob:)/i.test(trimmed)) return trimmed;

  return trimmed
    .replace(/^\/+/, '')
    .replace(new RegExp(`^(?:public/)?${THUMBNAIL_BUCKET}/`), '');
};

const formatMoney = (value: number) =>
  Number(value || 0).toLocaleString('pl-PL', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

function ProductThumbnail({
  product,
  size = 'large',
  priceNet,
  priceGross,
  pricePrefix = '',
}: {
  product?: IProduct | null;
  size?: 'small' | 'large';
  priceNet?: number;
  priceGross?: number;
  pricePrefix?: string;
}) {
  const [thumbnailUrls, setThumbnailUrls] = useState<string[]>([]);
  const [thumbnailIndex, setThumbnailIndex] = useState(0);
  const sizeClass = size === 'small' ? 'h-10 w-12' : 'h-20 w-28';
  const thumbnailUrl = thumbnailUrls[thumbnailIndex] || '';
  const resolvedNetPrice = Number(priceNet ?? product?.price_net ?? product?.base_price ?? 0);
  const vatRate = Number(product?.vat_rate ?? 23);
  const resolvedGrossPrice = Number(
    priceGross ??
      (priceNet !== undefined
        ? resolvedNetPrice * (1 + vatRate / 100)
        : product?.price_gross ?? resolvedNetPrice * (1 + vatRate / 100)),
  );
  const fullDescription = product?.offer_description || product?.description || '';

  useEffect(() => {
    let cancelled = false;

    const resolveUrls = async () => {
      const candidates = [product?.pdf_thumbnail_url, product?.offer_image_path]
        .map(normalizeThumbnailPath)
        .filter(Boolean);
      const bucket = supabase.storage.from(THUMBNAIL_BUCKET);
      const resolved = await Promise.all(
        candidates.map(async (candidate) => {
          if (/^(?:https?:|data:|blob:)/i.test(candidate)) return candidate;
          const { data, error } = await bucket.createSignedUrl(candidate, 3600);
          if (!error && data?.signedUrl) return data.signedUrl;
          return bucket.getPublicUrl(candidate).data.publicUrl;
        }),
      );

      if (!cancelled) {
        setThumbnailUrls([...new Set(resolved.filter(Boolean))]);
        setThumbnailIndex(0);
      }
    };

    void resolveUrls();
    return () => {
      cancelled = true;
    };
  }, [product?.id, product?.pdf_thumbnail_url, product?.offer_image_path]);

  const thumbnail = (
    <div
      className={`${sizeClass} relative shrink-0 overflow-hidden rounded-lg border border-[#d3bb73]/15 bg-[#0d0f1a]`}
    >
      {thumbnailUrl ? (
        <Image
          src={thumbnailUrl}
          alt={product?.name || 'Miniatura produktu'}
          fill
          unoptimized
          sizes={size === 'small' ? '48px' : '112px'}
          className="object-cover"
          onError={() => setThumbnailIndex((current) => current + 1)}
        />
      ) : (
        <Package className="absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 text-[#e5e4e2]/25" />
      )}
    </div>
  );

  return (
    <Popover
      trigger={thumbnail}
      openOn="auto"
      placement="bottom"
      offset={8}
      className="box-border w-[320px] max-w-[calc(100vw-24px)]"
      content={
        <div className="space-y-3">
          <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-[#d3bb73]/15 bg-[#090b12]">
            {thumbnailUrl ? (
              <Image
                src={thumbnailUrl}
                alt={product?.name || 'Podgląd produktu'}
                fill
                unoptimized
                sizes="300px"
                className="object-contain"
                onError={() => setThumbnailIndex((current) => current + 1)}
              />
            ) : (
              <Package className="absolute left-1/2 top-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 text-[#e5e4e2]/20" />
            )}
          </div>
          <div>
            <h5 className="text-base font-semibold leading-snug text-[#e5e4e2]">
              {product?.name || 'Produkt'}
            </h5>
            {product?.category?.name && (
              <div className="mt-1 text-xs text-[#d3bb73]">{product.category.name}</div>
            )}
          </div>
          {fullDescription && (
            <p className="max-h-40 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-[#e5e4e2]/70">
              {fullDescription}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2 border-t border-[#d3bb73]/15 pt-3 text-xs">
            <div className="rounded-lg bg-white/[0.03] p-2">
              <div className="text-[#e5e4e2]/45">Cena netto</div>
              <div className="mt-1 font-semibold text-[#d3bb73]">
                {pricePrefix}{formatMoney(resolvedNetPrice)} zł
              </div>
            </div>
            <div className="rounded-lg bg-white/[0.03] p-2">
              <div className="text-[#e5e4e2]/45">Cena brutto</div>
              <div className="mt-1 font-semibold text-[#e5e4e2]">
                {pricePrefix}{formatMoney(resolvedGrossPrice)} zł
              </div>
            </div>
          </div>
        </div>
      }
    />
  );
}

export default function OfferStep3({
  offerItems,
  products,
  searchQuery,
  setSearchQuery,
  selectedCategory,
  setSelectedCategory,
  categories,
  filteredProducts,
  addProductToOffer,
  updateOfferItem,
  removeOfferItem,
}: OfferStep3Props) {
  const { employeeId, preferences, setPreference } = useUserPreferences();
  const savedPreference = preferences.offerWizard?.catalogViewMode;
  const storageKey = `crm:offer-wizard:catalog-view:${employeeId}`;
  const [viewMode, setViewMode] = useState<CatalogViewMode>(savedPreference || 'list');
  const [variantSelections, setVariantSelections] = useState<Record<string, string>>({});

  useEffect(() => {
    const locallySaved = window.localStorage.getItem(storageKey);
    if (locallySaved === 'list' || locallySaved === 'table') {
      setViewMode(locallySaved);
      return;
    }
    if (savedPreference === 'list' || savedPreference === 'table') {
      setViewMode(savedPreference);
    }
  }, [savedPreference, storageKey]);

  const changeViewMode = (mode: CatalogViewMode) => {
    setViewMode(mode);
    window.localStorage.setItem(storageKey, mode);
    setPreference('offerWizard', {
      ...preferences.offerWizard,
      catalogViewMode: mode,
    });
  };

  const productById = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  );
  const selectedProductIds = useMemo(
    () => new Set(offerItems.map((item) => item.product_id).filter(Boolean)),
    [offerItems],
  );
  const availableProducts = useMemo(
    () => filteredProducts.filter((product) => !selectedProductIds.has(product.id)),
    [filteredProducts, selectedProductIds],
  );
  const addedCatalogItems = useMemo(
    () => offerItems.filter((item) => item.product_id && productById.has(item.product_id)),
    [offerItems, productById],
  );

  const getVariants = (product: IProduct) =>
    (product.variants || product.offer_product_variants || []).filter(
      (variant) => variant.is_active !== false,
    );

  const getSelectedVariant = (product: IProduct) => {
    const variants = getVariants(product);
    return (
      variants.find((variant) => variant.id === variantSelections[product.id]) ||
      variants.find((variant) => variant.is_recommended) ||
      variants[0]
    );
  };

  const renderVariantPdfSettings = (item: IOfferItem, product?: IProduct) => {
    if (!product || getVariants(product).length === 0) return null;

    return (
      <div className="flex items-center gap-3 whitespace-nowrap text-[11px] text-[#e5e4e2]/70">
        <label className="flex cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            checked={item.show_product_variants_in_pdf !== false}
            onChange={(event) =>
              updateOfferItem(item.id, { show_product_variants_in_pdf: event.target.checked })
            }
            className="h-4 w-4 accent-[#d3bb73]"
          />
          Warianty
        </label>
        <label
          className={`flex items-center gap-1.5 ${
            item.show_product_variants_in_pdf === false
              ? 'cursor-not-allowed opacity-40'
              : 'cursor-pointer'
          }`}
        >
          <input
            type="checkbox"
            checked={item.show_variant_prices_in_pdf !== false}
            disabled={item.show_product_variants_in_pdf === false}
            onChange={(event) =>
              updateOfferItem(item.id, { show_variant_prices_in_pdf: event.target.checked })
            }
            className="h-4 w-4 accent-[#d3bb73]"
          />
          Ceny wariantów
        </label>
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-lg font-medium text-[#e5e4e2]">Wybierz produkty z katalogu</h3>
        <div className="flex items-center gap-2 text-sm text-[#e5e4e2]/60">
          <ShoppingCart className="h-4 w-4" />
          <span>{offerItems.length} pozycji w ofercie</span>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-2">
        <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-[#d3bb73]/20 bg-[#151827]">
          <div className="flex items-center justify-between border-b border-[#d3bb73]/15 px-3 py-2">
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-[#d3bb73]" />
              <h4 className="text-sm font-medium text-[#e5e4e2]">Dostępne produkty</h4>
            </div>
            <span className="rounded-full bg-[#d3bb73]/10 px-2 py-0.5 text-[11px] text-[#d3bb73]">
              {availableProducts.length}
            </span>
          </div>
          <div className="space-y-2 border-b border-[#d3bb73]/15 p-3">
            <div className="relative w-full">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#e5e4e2]/40" />
              <input
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Szukaj produktu do dodania..."
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0d0f1a] py-2 pl-9 pr-3 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              />
            </div>
            <div className="flex min-w-0 gap-2">
              <select
                value={selectedCategory}
                onChange={(event) => setSelectedCategory(event.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-[#d3bb73]/20 bg-[#0d0f1a] px-3 py-1.5 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              >
                <option value="all">Wszystkie kategorie</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
              <div className="flex shrink-0 rounded-lg border border-[#d3bb73]/20 bg-[#0d0f1a] p-1">
                <button
                  type="button"
                  onClick={() => changeViewMode('list')}
                  title="Widok listy"
                  className={`rounded p-1.5 ${
                    viewMode === 'list'
                      ? 'bg-[#d3bb73] text-[#1c1f33]'
                      : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
                  }`}
                >
                  <LayoutList className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => changeViewMode('table')}
                  title="Widok tabeli"
                  className={`rounded p-1.5 ${
                    viewMode === 'table'
                      ? 'bg-[#d3bb73] text-[#1c1f33]'
                      : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
                  }`}
                >
                  <Table2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-3">
            {availableProducts.length > 0 && viewMode === 'list' && (
              <div className="space-y-3">
          {availableProducts.map((product) => {
            const variants = getVariants(product);
            const lowestVariant = variants.reduce<IProductVariant | undefined>(
              (lowest, variant) =>
                !lowest || Number(variant.price_net || 0) < Number(lowest.price_net || 0)
                  ? variant
                  : lowest,
              undefined,
            );
            const lowestPrice = Number(lowestVariant?.price_net ?? product.base_price ?? 0);

            return (
              <article
                key={product.id}
                className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-4 hover:border-[#d3bb73]/30"
              >
                <div className="flex flex-col gap-4 sm:flex-row">
                  <ProductThumbnail
                    product={product}
                    priceNet={lowestPrice}
                    priceGross={lowestVariant?.price_gross}
                    pricePrefix={variants.length > 0 ? 'od ' : ''}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <h4 className="font-medium text-[#e5e4e2]">{product.name}</h4>
                        {product.category?.name && (
                          <p className="mt-0.5 text-xs text-[#d3bb73]">{product.category.name}</p>
                        )}
                      </div>
                      <span className="whitespace-nowrap font-medium text-[#d3bb73]">
                        {variants.length > 0 && 'od '}
                        {formatMoney(lowestPrice)} zł
                      </span>
                    </div>
                    {product.description && (
                      <p className="mt-2 line-clamp-2 text-sm text-[#e5e4e2]/60">
                        {product.description}
                      </p>
                    )}

                    {variants.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {variants.map((variant) => (
                          <button
                            key={variant.id}
                            type="button"
                            onClick={() => addProductToOffer(product, variant)}
                            className="rounded-lg border border-[#d3bb73]/20 bg-[#0d0f1a]/60 px-3 py-2 text-left text-sm text-[#e5e4e2] hover:border-[#d3bb73] hover:bg-[#d3bb73]/10"
                          >
                            <span className="font-medium">{variant.name}</span>
                            <span className="ml-2 text-[#d3bb73]">
                              {formatMoney(variant.price_net)} zł
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => addProductToOffer(product)}
                        className="mt-3 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
                      >
                        Dodaj do oferty
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
              </div>
            )}

            {availableProducts.length > 0 && viewMode === 'table' && (
              <div className="overflow-hidden rounded-lg border border-[#d3bb73]/15">
                <table className="w-full table-fixed text-left text-xs">
            <thead className="sticky top-0 z-10 bg-[#1c1f33] uppercase text-[#e5e4e2]/50">
              <tr>
                <th className="w-[64px] px-2 py-2">Miniatura</th>
                <th className="w-[25%] px-2 py-2">Produkt</th>
                <th className="w-[14%] px-2 py-2">Kategoria</th>
                <th className="w-[15%] px-2 py-2">Cena netto</th>
                <th className="px-2 py-2 text-right">Wariant / dodaj</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#d3bb73]/10 bg-[#151827]">
              {availableProducts.map((product) => {
                const variants = getVariants(product);
                const selectedVariant = getSelectedVariant(product);
                return (
                  <tr key={product.id} className="hover:bg-[#1c1f33]/80">
                    <td className="px-2 py-2">
                      <ProductThumbnail
                        product={product}
                        size="small"
                        priceNet={selectedVariant?.price_net}
                        priceGross={selectedVariant?.price_gross}
                      />
                    </td>
                    <td className="min-w-0 px-2 py-2">
                      <div className="truncate font-medium text-[#e5e4e2]" title={product.name}>
                        {product.name}
                      </div>
                      {product.description && (
                        <div className="mt-1 truncate text-[11px] text-[#e5e4e2]/45" title={product.description}>
                          {product.description}
                        </div>
                      )}
                    </td>
                    <td className="truncate px-2 py-2 text-[#e5e4e2]/60" title={product.category?.name || ''}>
                      {product.category?.name || '—'}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 font-medium text-[#d3bb73]">
                      {formatMoney(selectedVariant?.price_net ?? product.base_price)} zł
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex min-w-0 items-center justify-end gap-1.5">
                        {variants.length > 0 && (
                          <select
                            value={selectedVariant?.id || ''}
                            onChange={(event) =>
                              setVariantSelections((current) => ({
                                ...current,
                                [product.id]: event.target.value,
                              }))
                            }
                            className="min-w-0 flex-1 rounded-md border border-[#d3bb73]/20 bg-[#0d0f1a] px-2 py-1.5 text-xs text-[#e5e4e2]"
                          >
                            {variants.map((variant) => (
                              <option key={variant.id} value={variant.id}>
                                {variant.name}
                              </option>
                            ))}
                          </select>
                        )}
                        <button
                          type="button"
                          onClick={() => addProductToOffer(product, selectedVariant)}
                          className="shrink-0 whitespace-nowrap rounded-md bg-[#d3bb73] px-2.5 py-1.5 font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
                        >
                          Dodaj
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
                </table>
              </div>
            )}

            {availableProducts.length === 0 && (
              <div className="flex h-full min-h-48 items-center justify-center py-10 text-center">
                <div>
                  <Package className="mx-auto mb-3 h-10 w-10 text-[#e5e4e2]/20" />
                  <p className="text-[#e5e4e2]/60">
                    {filteredProducts.length > 0
                      ? 'Wszystkie pasujące produkty są już dodane do oferty.'
                      : 'Brak produktów spełniających wybrane kryteria.'}
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-[#d3bb73]/20 bg-[#151827]">
          <div className="flex items-center gap-2 border-b border-[#d3bb73]/15 px-3 py-2">
            <CheckCircle2 className="h-4 w-4 text-[#d3bb73]" />
            <h4 className="text-sm font-medium text-[#e5e4e2]">Dodane produkty</h4>
            <span className="rounded-full bg-[#d3bb73]/15 px-2 py-0.5 text-[11px] text-[#d3bb73]">
              {addedCatalogItems.length}
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {addedCatalogItems.length > 0 ? (
            <table className="w-full min-w-[680px] table-fixed text-left text-xs">
              <thead className="sticky top-0 z-10 bg-[#1c1f33] uppercase text-[#e5e4e2]/45">
                <tr className="h-9">
                  <th className="w-[31%] px-3 font-medium">Produkt</th>
                  <th className="w-[8%] px-3 font-medium">Ilość</th>
                  <th className="w-[14%] px-3 font-medium">Cena netto</th>
                  <th className="w-[14%] px-3 font-medium">Wartość</th>
                  <th className="w-[28%] px-3 font-medium">Ustawienia PDF</th>
                  <th className="w-[5%] px-2" aria-label="Akcje" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[#d3bb73]/10">
                {addedCatalogItems.map((item) => {
                  const product = productById.get(item.product_id);
                  return (
                    <tr key={item.id} className="h-[51px] hover:bg-[#1c1f33]/70">
                      <td className="truncate px-3 font-medium text-[#e5e4e2]" title={item.name}>
                        {item.name}
                      </td>
                      <td className="whitespace-nowrap px-3 text-[#e5e4e2]/65">
                        {item.quantity} {item.unit || 'szt.'}
                      </td>
                      <td className="whitespace-nowrap px-3 text-[#e5e4e2]/65">
                        {formatMoney(item.unit_price)} zł
                      </td>
                      <td className="whitespace-nowrap px-3 font-medium text-[#d3bb73]">
                        {formatMoney(item.subtotal)} zł
                      </td>
                      <td className="px-3">{renderVariantPdfSettings(item, product)}</td>
                      <td className="px-2 text-right">
                        <button
                          type="button"
                          onClick={() => removeOfferItem(item.id)}
                          className="rounded p-1.5 text-red-300 hover:bg-red-500/10"
                          title="Usuń z oferty"
                          aria-label={`Usuń ${item.name}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            ) : (
              <div className="flex h-full min-h-48 items-center justify-center p-6 text-center">
                <div>
                  <ShoppingCart className="mx-auto mb-3 h-10 w-10 text-[#e5e4e2]/20" />
                  <p className="text-sm text-[#e5e4e2]/55">Dodane produkty pojawią się tutaj.</p>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
