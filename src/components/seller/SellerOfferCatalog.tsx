'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Check, ChevronDown, Package, Plus, Search, ZoomIn } from 'lucide-react';
import Popover from '@/components/UI/Tooltip';
import { supabase } from '@/lib/supabase/browser';
import { sellerMoney } from '@/lib/seller/portal';

type PricingRequirements = {
  requires_accommodation: boolean;
  accommodation_note: string | null;
  logistics_note: string | null;
  additional_requirements: string | null;
};

export type ProductVariant = {
  id: string;
  name: string;
  description: string | null;
  short_description: string | null;
  price_net: number;
  offer_image_path: string | null;
  pricing_requirements?: PricingRequirements | null;
};

export type CatalogProduct = {
  id: string;
  name: string;
  description: string | null;
  offer_short_description: string | null;
  offer_description: string | null;
  offer_image_path: string | null;
  base_price: number | null;
  unit: string;
  category_id: string | null;
  category?: { id: string; name: string } | null;
  variants: ProductVariant[];
  pricing_requirements?: PricingRequirements | null;
};

export const catalogItemKey = (productId: string, variantId?: string | null) => `${productId}:${variantId || 'base'}`;

function ProductImage({ url, alt }: { url?: string; alt: string }) {
  const [failedUrl, setFailedUrl] = useState('');
  if (!url || failedUrl === url) return <div className="flex h-32 w-full items-center justify-center rounded-lg bg-[#0b0d15]"><Package aria-label="Brak zdjęcia" className="h-8 w-8 text-white/15" /></div>;

  return <Popover openOn="auto" maxWidth={480} triggerClassName="w-full cursor-zoom-in rounded-lg outline-none focus-visible:ring-1 focus-visible:ring-[#d3bb73]/30" className="!border-white/5 !p-2" ariaLabel={`Powiększone zdjęcie: ${alt}`}
    trigger={<div className="group relative h-32 w-full overflow-hidden rounded-lg bg-[#0b0d15]">
      <Image src={url} alt={alt} fill sizes="150px" unoptimized className="object-cover" onError={() => setFailedUrl(url)} />
      <span className="pointer-events-none absolute bottom-2 right-2 rounded-md bg-black/55 p-1.5 text-white/75"><ZoomIn aria-hidden="true" className="h-3.5 w-3.5" /></span>
    </div>}
    content={<figure className="w-[min(440px,calc(100vw-48px))]">
      <div className="relative h-[min(330px,60vh)] w-full rounded-lg bg-black/20"><Image src={url} alt={alt} fill unoptimized sizes="440px" className="object-contain" onError={() => setFailedUrl(url)} /></div>
      <figcaption className="px-1 pb-1 pt-2 text-xs leading-5 text-white/65">{alt}</figcaption>
    </figure>}
  />;
}

// Resolve once for both lists. The same signed URL also serves the full-size
// preview; hovering never performs an extra storage request.
export function useSellerCatalogImages(catalog: CatalogProduct[], brandId: string) {
  const [images, setImages] = useState<{ key: string; urls: Record<string, string> }>({ key: '', urls: {} });
  const paths = useMemo(() => [...new Set(catalog.map((product) => product.offer_image_path).filter((path): path is string => Boolean(path)))], [catalog]);
  const pathsKey = JSON.stringify(paths);
  const key = `${brandId}:${pathsKey}`;
  useEffect(() => {
    let cancelled = false;
    const imagePaths: string[] = JSON.parse(pathsKey);
    const direct = imagePaths.filter((path) => /^(?:https?:|data:|blob:|\/)/i.test(path));
    const stored = imagePaths.filter((path) => !direct.includes(path));
    const resolve = async () => {
      const urls: Record<string, string> = Object.fromEntries(direct.map((path) => [path, path]));
      if (stored.length) {
        const { data } = await supabase.storage.from('offer-product-pages').createSignedUrls(stored, 3600);
        for (const image of data || []) if (image.path && image.signedUrl && !image.error) urls[image.path] = image.signedUrl;
      }
      if (!cancelled) setImages({ key, urls });
    };
    void resolve();
    const timer = window.setInterval(() => void resolve(), 50 * 60 * 1000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [key, pathsKey]);
  return images.key === key ? images.urls : {};
}

type Props = {
  products: CatalogProduct[];
  brandId: string;
  imageUrls: Record<string, string>;
  selectedKeys: ReadonlySet<string>;
  mainOfferKeys?: ReadonlySet<string>;
  onAdd: (product: CatalogProduct, variant?: ProductVariant) => void;
  disabled?: boolean;
  actionLabel?: string;
  label: string;
};

export default function SellerOfferCatalog({ products, brandId, imageUrls, selectedKeys, mainOfferKeys, onAdd, disabled = false, actionLabel = 'Dodaj', label }: Props) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const id = useId();
  const categories = useMemo(() => Array.from(new Map(products.filter((product) => product.category).map((product) => [product.category!.id, product.category!])).values()), [products]);
  const isFullySelected = (product: CatalogProduct) => product.variants.length
    ? product.variants.every((variant) => selectedKeys.has(catalogItemKey(product.id, variant.id)))
    : selectedKeys.has(catalogItemKey(product.id));
  const filtered = products.filter((product) => {
    if (category !== 'all' && product.category_id !== category) return false;
    return `${product.name} ${product.description || ''} ${product.offer_short_description || ''} ${product.offer_description || ''} ${product.variants.map((variant) => variant.name).join(' ')}`.toLocaleLowerCase('pl-PL').includes(search.trim().toLocaleLowerCase('pl-PL'));
  }).sort((left, right) => Number(isFullySelected(left)) - Number(isFullySelected(right)));

  return <div className="mt-4">
    <label className="relative block"><span className="sr-only">{label}: szukaj produktu</span><Search aria-hidden="true" className="absolute left-3 top-3.5 h-4 w-4 text-white/25" /><input value={search} onChange={(event) => setSearch(event.target.value)} className="min-h-11 w-full rounded-lg border border-white/10 bg-[#0f1119] py-2.5 pl-9 pr-3 text-sm text-[#e5e4e2] outline-none placeholder:text-white/25 focus:border-[#d3bb73]/40" placeholder="Szukaj po nazwie, opisie lub wariancie…" /></label>
    <div className="mt-3 flex gap-2 overflow-x-auto pb-2" role="group" aria-label={`${label}: kategorie`}>
      {[{ id: 'all', name: 'Wszystkie' }, ...categories].map((item) => <button type="button" key={item.id} aria-pressed={category === item.id} onClick={() => setCategory(item.id)} className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs ${category === item.id ? 'bg-[#d3bb73]/20 text-[#d3bb73]' : 'bg-white/5 text-white/50'}`}>{item.name}</button>)}
    </div>
    <div className="mt-3 max-h-[720px] space-y-3 overflow-y-auto pr-1" role="region" aria-label={label}>
      {filtered.map((product) => {
        const hasVariants = product.variants.length > 0;
        const fullyAdded = isFullySelected(product);
        const inMainOffer = hasVariants ? product.variants.every((variant) => mainOfferKeys?.has(catalogItemKey(product.id, variant.id))) : mainOfferKeys?.has(catalogItemKey(product.id));
        const sortedVariants = [...product.variants].sort((left, right) => Number(selectedKeys.has(catalogItemKey(product.id, left.id))) - Number(selectedKeys.has(catalogItemKey(product.id, right.id))));
        const href = `/seller/products/${product.id}?brand=${encodeURIComponent(brandId)}`;
        return <article key={product.id} className={`rounded-xl bg-[#111522] p-3 ${fullyAdded ? 'bg-white/[0.02]' : ''}`}>
          <div className="grid gap-3 sm:grid-cols-[150px_minmax(0,1fr)_auto]">
            <ProductImage url={imageUrls[product.offer_image_path || '']} alt={product.name} />
            <div className="min-w-0"><Link href={href} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-[#e5e4e2] hover:text-[#d3bb73] hover:underline" title="Otwórz podgląd produktu w nowej karcie">{product.name}</Link>
              <p className="mt-1 line-clamp-3 text-xs leading-5 text-white/40">{product.offer_short_description || product.offer_description || product.description}</p>
              <p className="mt-2 text-sm text-[#d3bb73]">od {sellerMoney(hasVariants ? Math.min(...product.variants.map((variant) => Number(variant.price_net))) : product.base_price)} netto</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">{product.pricing_requirements?.requires_accommodation && <span className="rounded bg-amber-300/10 px-2 py-1 text-[10px] text-amber-100">Wymagany nocleg</span>}{product.pricing_requirements?.logistics_note && <span className="rounded bg-sky-300/10 px-2 py-1 text-[10px] text-sky-100">Logistyka do uzgodnienia</span>}<Link href={href} target="_blank" rel="noopener noreferrer" className="text-[11px] text-[#d3bb73] hover:underline">Szczegóły i wymagania</Link></div>
            </div>
            <button type="button" disabled={fullyAdded || (!hasVariants && disabled)} aria-label={`${fullyAdded ? (inMainOffer ? 'W głównej ofercie' : 'Dodano') : hasVariants ? 'Pokaż warianty' : actionLabel}: ${product.name}`} aria-expanded={hasVariants ? expanded === product.id : undefined} aria-controls={hasVariants ? `${id}-${product.id}` : undefined} onClick={() => hasVariants ? setExpanded(expanded === product.id ? null : product.id) : onAdd(product)} className="flex h-9 items-center justify-center gap-1 whitespace-nowrap rounded-lg bg-[#d3bb73] px-3 text-xs font-medium text-[#111522] disabled:cursor-not-allowed disabled:bg-white/5 disabled:text-white/40">
              {fullyAdded ? <><Check className="h-3.5 w-3.5" />{inMainOffer ? 'W ofercie' : 'Dodano'}</> : hasVariants ? <>Wariant<ChevronDown className={`h-3.5 w-3.5 ${expanded === product.id ? 'rotate-180' : ''}`} /></> : <><Plus className="h-3.5 w-3.5" />{actionLabel}</>}
            </button>
          </div>
          {expanded === product.id && hasVariants && <div id={`${id}-${product.id}`} className="mt-3 space-y-2 pt-2">{sortedVariants.map((variant) => {
            const variantKey = catalogItemKey(product.id, variant.id);
            const added = selectedKeys.has(variantKey);
            return <button type="button" key={variant.id} disabled={disabled || added} onClick={() => onAdd(product, variant)} className="flex w-full items-center justify-between gap-3 rounded-lg bg-white/[0.03] px-3 py-2 text-left text-xs hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-40"><span>{variant.name}</span><span className="shrink-0 text-[#d3bb73]">{sellerMoney(variant.price_net)} netto · {mainOfferKeys?.has(variantKey) ? 'w ofercie' : added ? 'dodano' : actionLabel.toLocaleLowerCase('pl-PL')}</span></button>;
          })}</div>}
        </article>;
      })}
      {!filtered.length && <p className="py-10 text-center text-sm text-white/35">Nie znaleziono produktu pasującego do wyszukiwania.</p>}
    </div>
  </div>;
}
