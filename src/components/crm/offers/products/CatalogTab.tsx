import { Grid3x3, LayoutList, Package, Plus, Search, Table2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import Popover from '@/components/UI/Tooltip';
import { useUserPreferences } from '@/app/(crm)/crm/PreferencesClientProvider';
import { productReadiness, READINESS_GROUPS, type ProductReadiness, type ReadinessGroupKey } from '@/lib/CRM/Offers/productReadiness';
import { ReadinessDots, readinessSummary } from '@/components/crm/offers/ProductReadiness';

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

/** Marża z kosztu netto produktu; bez kosztu — `null` (marża byłaby zawyżona do 100%). */
const getMarginPercent = (product: any, netPrice: number): number | null => {
  const cost = Number(product?.cost_net ?? product?.cost_price ?? 0);
  if (!(cost > 0) || !(netPrice > 0)) return null;
  return (netPrice - cost) / netPrice * 100;
};
const marginText = (margin: number | null) => (margin == null ? '—' : `${margin.toFixed(0)}%`);
const marginClass = (margin: number | null) => (margin == null ? 'text-[#e5e4e2]/35' : margin >= 0 ? 'text-green-400' : 'text-red-400');
const MARGIN_UNKNOWN = 'Brak kosztu produktu — uzupełnij koszt, aby policzyć marżę.';

type ReadinessFilter = 'all' | 'missing' | 'ready';

/** Sprzęt i obsada z katalogu (`equipment`, `staff`); bez nich — nie sprawdzono. */
const readinessOf = (product: any): ProductReadiness => productReadiness(
  product,
  Array.isArray(product?.equipment) ? { equipmentCount: product.equipment.length, staff: Array.isArray(product?.staff) ? product.staff : [] } : null,
);

function ReadinessInline({ readiness, className = '' }: { readiness: ProductReadiness; className?: string }) {
  const summary = readinessSummary(readiness);
  return (
    <span className={`flex min-w-0 items-center gap-2 text-xs ${className}`}>
      <ReadinessDots readiness={readiness} />
      <span className={`truncate ${readiness.ready ? 'text-emerald-300/80' : 'text-amber-200/80'}`} title={summary}>{summary}</span>
    </span>
  );
}

function ProductThumbnail({
  product,
  size = 'list',
}: {
  product: any;
  size?: 'grid' | 'list' | 'table';
}) {
  const sourceVersion = `${product?.offer_image_path || ''}|${product?.pdf_thumbnail_url || ''}|${product?.updated_at || ''}`;
  const version = Array.from(sourceVersion).reduce((hash, character) => Math.imul(hash, 31) + character.charCodeAt(0) | 0, 0).toString(36);
  const width = size === 'grid' ? 640 : size === 'table' ? 128 : 192;
  const imageUrl = (width: number) => `/bridge/products/thumbnail?id=${encodeURIComponent(product.id)}&w=${width}&v=${encodeURIComponent(version)}`;
  const thumbnailUrl = product?.offer_image_path || product?.pdf_thumbnail_url ? imageUrl(width) : '';
  const previewUrl = thumbnailUrl ? imageUrl(680) : '';
  const [failedThumbnail, setFailedThumbnail] = useState('');
  const [failedPreview, setFailedPreview] = useState('');
  const prices = getProductPrices(product);
  const sizeClass = size === 'grid'
    ? 'aspect-video w-full'
    : size === 'table'
      ? 'h-11 w-16'
      : 'h-16 w-24';

  const thumbnail = (
    <div className={`${sizeClass} relative shrink-0 overflow-hidden rounded-lg border border-[#d3bb73]/15 bg-[#0a0d1a]`}>
      {thumbnailUrl && failedThumbnail !== thumbnailUrl ? (
        <Image
          src={thumbnailUrl}
          alt={product?.name || 'Miniatura produktu'}
          fill
          unoptimized
          loading="lazy"
          decoding="async"
          sizes={size === 'grid' ? '(max-width: 768px) 100vw, 33vw' : '96px'}
          className={size === 'grid' ? 'object-cover' : 'object-contain'}
          onError={() => setFailedThumbnail(thumbnailUrl)}
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
            {previewUrl && failedPreview !== previewUrl ? (
              <Image
                src={previewUrl}
                alt={product?.name || 'Podgląd produktu'}
                fill
                unoptimized
                loading="lazy"
                decoding="async"
                sizes="340px"
                className="object-contain"
                onError={() => setFailedPreview(previewUrl)}
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
  const [readinessFilter, setReadinessFilter] = useState<ReadinessFilter>('all');
  const [groupFilter, setGroupFilter] = useState<ReadinessGroupKey | null>(null);

  // Gotowość do oferty (`productReadiness.ts`) — liczniki dla bieżącego wyszukiwania i kategorii, tylko aktywne produkty.
  const readinessById = useMemo(() => new Map<string, ProductReadiness>(products.map((product: any) => [product.id, readinessOf(product)])), [products]);
  const activeProducts = products.filter((product: any) => product.is_active !== false);
  const readyCount = activeProducts.filter((product: any) => readinessById.get(product.id)?.ready).length;
  const groupMissing = (key: ReadinessGroupKey) =>
    activeProducts.filter((product: any) => readinessById.get(product.id)?.groups.some((group) => group.key === key && !group.ok)).length;
  const visibleProducts = products.filter((product: any) => {
    const readiness = readinessById.get(product.id);
    if (!readiness) return true;
    if (readinessFilter === 'ready') return product.is_active !== false && readiness.ready;
    if (readinessFilter === 'missing' && (product.is_active === false || readiness.ready)) return false;
    if (groupFilter) return product.is_active !== false && readiness.groups.some((group) => group.key === groupFilter && !group.ok);
    return true;
  });
  const chooseReadiness = (filter: ReadinessFilter) => {
    setReadinessFilter(filter);
    if (filter === 'ready') setGroupFilter(null);
  };
  const chooseGroup = (key: ReadinessGroupKey) => {
    const next = groupFilter === key ? null : key;
    setGroupFilter(next);
    if (next) setReadinessFilter('missing');
  };

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

        {products.length > 0 && (
          <div className="mb-5 flex flex-wrap items-center gap-2 text-xs" aria-label="Gotowość produktów do oferty">
            <span className="mr-1 text-[#e5e4e2]/60">
              Gotowe do oferty: <strong className="font-semibold text-[#e5e4e2]">{readyCount}</strong> z {activeProducts.length} aktywnych
            </span>
            <div role="group" aria-label="Filtr gotowości" className="flex items-center rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] p-0.5">
              {([['all', 'Wszystkie'], ['missing', `Do uzupełnienia (${activeProducts.length - readyCount})`], ['ready', `Gotowe (${readyCount})`]] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={readinessFilter === value}
                  onClick={() => chooseReadiness(value)}
                  className={`rounded-md px-2.5 py-1 transition-colors ${readinessFilter === value ? 'bg-[#d3bb73] font-medium text-[#1c1f33]' : 'text-[#e5e4e2]/65 hover:text-[#e5e4e2]'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <span aria-hidden="true" className="mx-1 hidden h-4 w-px bg-white/10 sm:block" />
            <span className="text-[#e5e4e2]/45">Braki:</span>
            {READINESS_GROUPS.map((group) => {
              const count = groupMissing(group.key);
              return (
                <button
                  key={group.key}
                  type="button"
                  aria-pressed={groupFilter === group.key}
                  disabled={!count && groupFilter !== group.key}
                  onClick={() => chooseGroup(group.key)}
                  title={`Produkty z brakami: ${group.label.toLocaleLowerCase('pl-PL')}`}
                  className={`rounded-full border px-2.5 py-1 transition-colors disabled:opacity-40 ${groupFilter === group.key ? 'border-amber-300/60 bg-amber-400/15 text-amber-100' : 'border-white/10 text-[#e5e4e2]/65 hover:border-amber-300/40 hover:text-[#e5e4e2]'}`}
                >
                  {group.short} {count}
                </button>
              );
            })}
          </div>
        )}

        {products.length === 0 ? (
          <div className="py-12 text-center">
            <Package className="mx-auto mb-4 h-12 w-12 text-[#e5e4e2]/20" />
            <p className="text-[#e5e4e2]/60">Brak produktów w katalogu</p>
          </div>
        ) : visibleProducts.length === 0 ? (
          <div className="py-12 text-center">
            <Package className="mx-auto mb-4 h-12 w-12 text-[#e5e4e2]/20" />
            <p className="text-[#e5e4e2]/60">{readinessFilter === 'ready' ? 'Żaden produkt w tym widoku nie jest jeszcze gotowy do oferty.' : 'Brak produktów z takimi brakami.'}</p>
            <button type="button" onClick={() => { setReadinessFilter('all'); setGroupFilter(null); }} className="mt-3 text-sm text-[#d3bb73] hover:underline">Pokaż wszystkie</button>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {visibleProducts.map((product: any) => {
              const prices = getProductPrices(product);
              const margin = getMarginPercent(product, prices.net);
              const readiness = readinessById.get(product.id) || readinessOf(product);
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
                      <span className={marginClass(margin)} title={margin == null ? MARGIN_UNKNOWN : undefined}>Marża {marginText(margin)}</span>
                    </div>
                    <ReadinessInline readiness={readiness} className="mt-2 border-t border-[#d3bb73]/10 pt-2" />
                  </div>
                </article>
              );
            })}
          </div>
        ) : viewMode === 'list' ? (
          <div className="space-y-2">
            {visibleProducts.map((product: any) => {
              const prices = getProductPrices(product);
              const margin = getMarginPercent(product, prices.net);
              const readiness = readinessById.get(product.id) || readinessOf(product);
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
                    <ReadinessInline readiness={readiness} className="hidden w-52 shrink-0 md:flex" />
                    <div className="hidden w-24 text-center text-xs text-[#e5e4e2]/55 lg:block">{prices.variants.length > 0 ? `${prices.variants.length} wariantów` : product.unit || 'szt.'}</div>
                    <div className="w-32 shrink-0 text-right">
                      <div className="text-[10px] text-[#e5e4e2]/40">Netto</div>
                      <div className="text-sm font-semibold text-[#d3bb73]">{prices.hasVariantPrice && 'od '}{formatMoney(prices.net)} zł</div>
                    </div>
                    <div className="hidden w-32 shrink-0 text-right sm:block">
                      <div className="text-[10px] text-[#e5e4e2]/40">Brutto</div>
                      <div className="text-sm text-[#e5e4e2]/80">{formatMoney(prices.gross)} zł</div>
                    </div>
                    <div className={`hidden w-20 shrink-0 text-right text-xs font-medium xl:block ${marginClass(margin)}`} title={margin == null ? MARGIN_UNKNOWN : undefined}>{marginText(margin)}</div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[#d3bb73]/15">
            <table className="w-full min-w-[1100px] table-fixed text-left text-xs">
              <thead className="sticky top-0 z-10 bg-[#151827] uppercase text-[#e5e4e2]/45">
                <tr className="h-10">
                  <th className="w-[84px] px-3 font-medium">Zdjęcie</th>
                  <th className="w-[26%] px-3 font-medium">Produkt</th>
                  <th className="w-[15%] px-3 font-medium">Kategoria</th>
                  <th className="w-[10%] px-3 text-center font-medium">Warianty</th>
                  <th className="w-[13%] px-3 text-right font-medium">Netto</th>
                  <th className="w-[13%] px-3 text-right font-medium">Brutto</th>
                  <th className="w-[9%] px-3 text-right font-medium">Marża</th>
                  <th className="w-[200px] px-3 font-medium">Gotowość do oferty</th>
                  <th className="w-[90px] px-3 text-center font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#d3bb73]/10 bg-[#0f1119]">
                {visibleProducts.map((product: any) => {
                  const prices = getProductPrices(product);
                  const margin = getMarginPercent(product, prices.net);
                  const readiness = readinessById.get(product.id) || readinessOf(product);
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
                      <td className={`whitespace-nowrap px-3 py-2 text-right font-medium ${marginClass(margin)}`} title={margin == null ? MARGIN_UNKNOWN : undefined}>{marginText(margin)}</td>
                      <td className="px-3 py-2"><ReadinessInline readiness={readiness} /></td>
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
