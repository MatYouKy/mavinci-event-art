import { Grid3x3, LayoutList, Package, Plus, Search, Table2 } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useEffect, useState } from 'react';
import Image from 'next/image';
import Popover from '@/components/UI/Tooltip';
import { useUserPreferences } from '@/app/(crm)/crm/PreferencesClientProvider';

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

type CatalogViewMode = 'grid' | 'list' | 'table';

const formatMoney = (value: unknown) =>
  Number(value || 0).toLocaleString('pl-PL', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const getActiveVariants = (product: any) =>
  (product?.variants || product?.offer_product_variants || []).filter(
    (variant: any) => variant?.is_active !== false,
  );

const getProductPrices = (product: any) => {
  const variants = getActiveVariants(product);
  const lowestVariant = variants.reduce(
    (lowest: any, variant: any) =>
      !lowest || Number(variant.price_net || 0) < Number(lowest.price_net || 0)
        ? variant
        : lowest,
    null,
  );
  const net = Number(lowestVariant?.price_net ?? product?.price_net ?? product?.base_price ?? 0);
  const vatRate = Number(product?.vat_rate ?? 23);
  const gross = Number(
    lowestVariant?.price_gross ?? product?.price_gross ?? net * (1 + vatRate / 100),
  );

  return { net, gross, variants, hasVariantPrice: Boolean(lowestVariant) };
};

const getMarginPercent = (product: any, netPrice: number) => {
  const cost = Number(product?.cost_price || 0);
  return netPrice > 0 ? (netPrice - cost) / netPrice * 100 : 0;
};

function ProductThumbnail({
  product,
  size = 'list',
}: {
  product: any;
  size?: 'grid' | 'list' | 'table';
}) {
  const [thumbnailUrls, setThumbnailUrls] = useState<string[]>([]);
  const [thumbnailIndex, setThumbnailIndex] = useState(0);
  const thumbnailUrl = thumbnailUrls[thumbnailIndex] || '';
  const prices = getProductPrices(product);
  const sizeClass = size === 'grid'
    ? 'aspect-video w-full'
    : size === 'table'
      ? 'h-11 w-16'
      : 'h-16 w-24';

  useEffect(() => {
    let cancelled = false;

    const resolveUrls = async () => {
      const candidates = [product?.offer_image_path, product?.pdf_thumbnail_url]
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
  }, [product?.id, product?.offer_image_path, product?.pdf_thumbnail_url]);

  const thumbnail = (
    <div className={`${sizeClass} relative shrink-0 overflow-hidden rounded-lg border border-[#d3bb73]/15 bg-[#0a0d1a]`}>
      {thumbnailUrl ? (
        <Image
          src={thumbnailUrl}
          alt={product?.name || 'Miniatura produktu'}
          fill
          unoptimized
          sizes={size === 'grid' ? '(max-width: 768px) 100vw, 33vw' : '96px'}
          className={size === 'grid' ? 'object-cover' : 'object-contain'}
          onError={() => setThumbnailIndex((current) => current + 1)}
        />
      ) : (
        <Package className="absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 text-[#e5e4e2]/20" />
      )}
    </div>
  );

  return (
    <Popover
      trigger={thumbnail}
      openOn="auto"
      placement="bottom"
      offset={8}
      className="box-border w-[360px] max-w-[calc(100vw-24px)]"
      content={
        <div className="space-y-3">
          <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-[#d3bb73]/15 bg-[#090b12]">
            {thumbnailUrl ? (
              <Image
                src={thumbnailUrl}
                alt={product?.name || 'Podgląd produktu'}
                fill
                unoptimized
                sizes="340px"
                className="object-contain"
                onError={() => setThumbnailIndex((current) => current + 1)}
              />
            ) : (
              <Package className="absolute left-1/2 top-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 text-[#e5e4e2]/20" />
            )}
          </div>
          <div>
            <h4 className="text-base font-semibold leading-snug text-[#e5e4e2]">{product?.name}</h4>
            <div className="mt-1 text-xs text-[#d3bb73]">{product?.category?.name || 'Bez kategorii'}</div>
          </div>
          {(product?.offer_description || product?.description) && (
            <p className="max-h-44 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-[#e5e4e2]/70">
              {product.offer_description || product.description}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2 border-t border-[#d3bb73]/15 pt-3 text-xs">
            <div className="rounded-lg bg-white/[0.03] p-2">
              <div className="text-[#e5e4e2]/45">Cena netto</div>
              <div className="mt-1 font-semibold text-[#d3bb73]">
                {prices.hasVariantPrice && 'od '}{formatMoney(prices.net)} zł
              </div>
            </div>
            <div className="rounded-lg bg-white/[0.03] p-2">
              <div className="text-[#e5e4e2]/45">Cena brutto</div>
              <div className="mt-1 font-semibold text-[#e5e4e2]">
                {prices.hasVariantPrice && 'od '}{formatMoney(prices.gross)} zł
              </div>
            </div>
          </div>
        </div>
      }
    />
  );
}

export function CatalogTab({
  products,
  categories,
  productSearch,
  setProductSearch,
  categoryFilter,
  setCategoryFilter,
  viewMode,
  setViewMode,
  router,
}: any) {
  const { employeeId, preferences, setPreference } = useUserPreferences();
  const storageKey = `crm:offer-catalog:view:${employeeId}`;

  useEffect(() => {
    const localPreference = window.localStorage.getItem(storageKey);
    if (localPreference === 'grid' || localPreference === 'list' || localPreference === 'table') {
      setViewMode(localPreference);
      return;
    }

    const savedPreference = preferences.offerCatalog?.viewMode;
    if (savedPreference === 'grid' || savedPreference === 'list' || savedPreference === 'table') {
      setViewMode(savedPreference);
    }
  }, [preferences.offerCatalog?.viewMode, setViewMode, storageKey]);

  const changeViewMode = (mode: CatalogViewMode) => {
    setViewMode(mode);
    window.localStorage.setItem(storageKey, mode);
    setPreference('offerCatalog', {
      ...preferences.offerCatalog,
      viewMode: mode,
    });
  };

  return (
    <>
      <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
        <div className="mb-6 flex flex-col gap-4 xl:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#e5e4e2]/40" />
            <input
              type="text"
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              placeholder="Szukaj produktu po nazwie, opisie lub tagu..."
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] py-2 pl-10 pr-4 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
            />
          </div>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
          >
            <option value="all">Wszystkie kategorie</option>
            {categories.map((cat: any) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>

          <div className="flex items-center rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] p-1">
            <button
              type="button"
              onClick={() => changeViewMode('grid')}
              title="Widok kafelków"
              className={`rounded p-2 transition-colors ${
                viewMode === 'grid'
                  ? 'bg-[#d3bb73] text-[#1c1f33]'
                  : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
              }`}
            >
              <Grid3x3 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => changeViewMode('list')}
              title="Widok listy"
              className={`rounded p-2 transition-colors ${
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
              className={`rounded p-2 transition-colors ${
                viewMode === 'table'
                  ? 'bg-[#d3bb73] text-[#1c1f33]'
                  : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
              }`}
            >
              <Table2 className="h-4 w-4" />
            </button>
          </div>

          <button
            onClick={() => router.push('/crm/offers/products/new')}
            className="flex items-center space-x-2 whitespace-nowrap rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
          >
            <Plus className="h-5 w-5" />
            <span>Nowy produkt</span>
          </button>
        </div>

        {products.length === 0 ? (
          <div className="py-12 text-center">
            <Package className="mx-auto mb-4 h-12 w-12 text-[#e5e4e2]/20" />
            <p className="text-[#e5e4e2]/60">Brak produktów w katalogu</p>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {products.map((product: any) => {
              const prices = getProductPrices(product);
              const margin = getMarginPercent(product, prices.net);
              return (
                <article
                  key={product.id}
                  onClick={() => router.push(`/crm/offers/products/${product.id}`)}
                  className="cursor-pointer overflow-hidden rounded-xl border border-[#d3bb73]/10 bg-[#0f1119] transition-all hover:border-[#d3bb73]/35 hover:bg-[#121521]"
                >
                  <ProductThumbnail product={product} size="grid" />
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="line-clamp-2 font-semibold leading-snug text-[#e5e4e2]">{product.name}</h3>
                        <p className="mt-1 text-xs text-[#d3bb73]">{product.category?.name || 'Bez kategorii'}</p>
                      </div>
                      <span className={`shrink-0 rounded px-2 py-1 text-[10px] ${
                        product.is_active !== false ? 'bg-green-500/15 text-green-400' : 'bg-gray-500/20 text-gray-400'
                      }`}>
                        {product.is_active !== false ? 'Aktywny' : 'Nieaktywny'}
                      </span>
                    </div>
                    {product.description && (
                      <p className="mt-3 line-clamp-2 min-h-10 text-sm leading-5 text-[#e5e4e2]/55">{product.description}</p>
                    )}
                    <div className="mt-4 grid grid-cols-2 gap-3 border-t border-[#d3bb73]/10 pt-3 text-sm">
                      <div>
                        <div className="text-[11px] text-[#e5e4e2]/40">Netto</div>
                        <div className="font-semibold text-[#d3bb73]">{prices.hasVariantPrice && 'od '}{formatMoney(prices.net)} zł</div>
                      </div>
                      <div className="text-right">
                        <div className="text-[11px] text-[#e5e4e2]/40">Brutto</div>
                        <div className="font-medium text-[#e5e4e2]">{prices.hasVariantPrice && 'od '}{formatMoney(prices.gross)} zł</div>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between text-xs text-[#e5e4e2]/45">
                      <span>{prices.variants.length > 0 ? `${prices.variants.length} wariantów` : product.unit || 'szt.'}</span>
                      <span className={margin >= 0 ? 'text-green-400' : 'text-red-400'}>Marża {margin.toFixed(0)}%</span>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : viewMode === 'list' ? (
          <div className="space-y-2">
            {products.map((product: any) => {
              const prices = getProductPrices(product);
              const margin = getMarginPercent(product, prices.net);
              return (
                <article
                  key={product.id}
                  onClick={() => router.push(`/crm/offers/products/${product.id}`)}
                  className="cursor-pointer rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-3 py-2.5 transition-colors hover:border-[#d3bb73]/30 hover:bg-[#121521]"
                >
                  <div className="flex items-center gap-3">
                    <ProductThumbnail product={product} size="list" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate font-medium text-[#e5e4e2]" title={product.name}>{product.name}</h3>
                        {product.is_active === false && <span className="shrink-0 rounded bg-gray-500/20 px-2 py-0.5 text-[10px] text-gray-400">Nieaktywny</span>}
                      </div>
                      <div className="mt-1 flex min-w-0 items-center gap-3 text-xs text-[#e5e4e2]/45">
                        <span className="shrink-0 text-[#d3bb73]">{product.category?.name || 'Bez kategorii'}</span>
                        {product.description && <span className="truncate" title={product.description}>{product.description}</span>}
                      </div>
                    </div>
                    <div className="hidden w-24 text-center text-xs text-[#e5e4e2]/55 lg:block">{prices.variants.length > 0 ? `${prices.variants.length} wariantów` : product.unit || 'szt.'}</div>
                    <div className="w-32 shrink-0 text-right">
                      <div className="text-[10px] text-[#e5e4e2]/40">Netto</div>
                      <div className="text-sm font-semibold text-[#d3bb73]">{prices.hasVariantPrice && 'od '}{formatMoney(prices.net)} zł</div>
                    </div>
                    <div className="hidden w-32 shrink-0 text-right sm:block">
                      <div className="text-[10px] text-[#e5e4e2]/40">Brutto</div>
                      <div className="text-sm text-[#e5e4e2]/80">{formatMoney(prices.gross)} zł</div>
                    </div>
                    <div className={`hidden w-20 shrink-0 text-right text-xs font-medium xl:block ${margin >= 0 ? 'text-green-400' : 'text-red-400'}`}>{margin.toFixed(0)}%</div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[#d3bb73]/15">
            <table className="w-full min-w-[960px] table-fixed text-left text-xs">
              <thead className="sticky top-0 z-10 bg-[#151827] uppercase text-[#e5e4e2]/45">
                <tr className="h-10">
                  <th className="w-[84px] px-3 font-medium">Zdjęcie</th>
                  <th className="w-[30%] px-3 font-medium">Produkt</th>
                  <th className="w-[15%] px-3 font-medium">Kategoria</th>
                  <th className="w-[10%] px-3 text-center font-medium">Warianty</th>
                  <th className="w-[13%] px-3 text-right font-medium">Netto</th>
                  <th className="w-[13%] px-3 text-right font-medium">Brutto</th>
                  <th className="w-[9%] px-3 text-right font-medium">Marża</th>
                  <th className="w-[90px] px-3 text-center font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#d3bb73]/10 bg-[#0f1119]">
                {products.map((product: any) => {
                  const prices = getProductPrices(product);
                  const margin = getMarginPercent(product, prices.net);
                  return (
                    <tr key={product.id} onClick={() => router.push(`/crm/offers/products/${product.id}`)} className="h-[62px] cursor-pointer transition-colors hover:bg-[#171a29]">
                      <td className="px-3 py-2"><ProductThumbnail product={product} size="table" /></td>
                      <td className="min-w-0 px-3 py-2">
                        <div className="truncate font-medium text-[#e5e4e2]" title={product.name}>{product.name}</div>
                        {product.description && <div className="mt-1 truncate text-[11px] text-[#e5e4e2]/40" title={product.description}>{product.description}</div>}
                      </td>
                      <td className="truncate px-3 py-2 text-[#d3bb73]" title={product.category?.name || ''}>{product.category?.name || '—'}</td>
                      <td className="px-3 py-2 text-center text-[#e5e4e2]/55">{prices.variants.length || '—'}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-semibold text-[#d3bb73]">{prices.hasVariantPrice && 'od '}{formatMoney(prices.net)} zł</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right text-[#e5e4e2]/75">{formatMoney(prices.gross)} zł</td>
                      <td className={`whitespace-nowrap px-3 py-2 text-right font-medium ${margin >= 0 ? 'text-green-400' : 'text-red-400'}`}>{margin.toFixed(0)}%</td>
                      <td className="px-3 py-2 text-center">
                        <span className={`rounded px-2 py-1 text-[10px] ${product.is_active !== false ? 'bg-green-500/15 text-green-400' : 'bg-gray-500/20 text-gray-400'}`}>
                          {product.is_active !== false ? 'Aktywny' : 'Nieaktywny'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
