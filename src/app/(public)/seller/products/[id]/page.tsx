'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ArrowLeft,
  BedDouble,
  CheckCircle2,
  ExternalLink,
  FileCheck2,
  ImageIcon,
  Info,
  Loader2,
  Package,
  Truck,
} from 'lucide-react';
import { parseContractClauseEntries } from '@/lib/CRM/contracts/contractClauseContent';
import { sellerMoney, useSellerPortalContext } from '@/lib/seller/portal';
import { supabase } from '@/lib/supabase/browser';

type PricingRequirements = {
  requires_accommodation: boolean;
  accommodation_note: string | null;
  logistics_note: string | null;
  additional_requirements: string | null;
};

type ProductVariant = {
  id: string;
  name: string;
  short_description: string | null;
  description: string | null;
  benefits: unknown;
  offer_image_path: string | null;
  offer_image_alt: string | null;
  price_net: number;
  recommended_contract_clauses: string | null;
  recommended_contract_clause_category: string | null;
  pricing_requirements: PricingRequirements | null;
};

type SellerProduct = {
  id: string;
  name: string;
  unit: string;
  category: { id: string; name: string } | null;
  description: string | null;
  offer_short_description: string | null;
  offer_description: string | null;
  offer_benefits: unknown;
  offer_requirements: unknown;
  offer_additional_requirements: unknown;
  recommended_contract_clauses: string | null;
  recommended_contract_clause_category: string | null;
  product_page_url: string | null;
  offer_image_path: string | null;
  offer_image_alt: string | null;
  base_price: number | null;
  pricing_requirements: PricingRequirements | null;
  gallery_paths: string[];
  variants: ProductVariant[];
};

type NamedText = { title: string; text: string };

const asNamedTexts = (value: unknown): NamedText[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index) => {
    if (typeof entry === 'string' && entry.trim()) return [{ title: '', text: entry.trim() }];
    if (!entry || typeof entry !== 'object') return [];
    const item = entry as Record<string, unknown>;
    const text = String(item.description || item.text || item.content || '').trim();
    if (!text) return [];
    return [{ title: String(item.title || item.name || `Wymaganie ${index + 1}`).trim(), text }];
  });
};

const htmlToPlainText = (value: string) => {
  if (typeof document === 'undefined') return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const container = document.createElement('div');
  container.innerHTML = value;
  return (container.textContent || '').replace(/\s+/g, ' ').trim();
};

export default function SellerProductPage() {
  const params = useParams<{ id: string }>();
  const productId = params.id;
  const { context, loading: contextLoading } = useSellerPortalContext();
  const [brandId, setBrandId] = useState('');
  const [product, setProduct] = useState<SellerProduct | null>(null);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [activeImage, setActiveImage] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!context) return;
    const requestedBrand = new URLSearchParams(window.location.search).get('brand');
    const allowedBrand = context.brands.find((brand) => brand.my_company_id === requestedBrand);
    setBrandId(allowedBrand?.my_company_id || context.brands[0]?.my_company_id || '');
  }, [context]);

  useEffect(() => {
    if (!productId || !brandId) { setLoading(false); return; }
    void (async () => {
      setLoading(true);
      setError(null);
      const { data, error: productError } = await supabase.rpc('get_seller_portal_product', {
        p_product_id: productId,
        p_company_id: brandId,
      });
      if (productError || !data) {
        setProduct(null);
        setError(productError?.message || 'Produkt nie jest dostępny w Twoim katalogu.');
      } else {
        const next = data as SellerProduct;
        next.variants = next.variants || [];
        next.gallery_paths = next.gallery_paths || [];
        setProduct(next);
      }
      setLoading(false);
    })();
  }, [brandId, productId]);

  useEffect(() => {
    if (!product) return;
    const paths = Array.from(new Set([
      product.offer_image_path,
      ...(product.gallery_paths || []),
      ...product.variants.map((variant) => variant.offer_image_path),
    ].filter((path): path is string => Boolean(path))));

    let cancelled = false;
    void (async () => {
      const entries = await Promise.all(paths.map(async (path) => {
        if (/^(?:https?:|data:|blob:)/i.test(path)) return [path, path] as const;
        const { data } = await supabase.storage.from('offer-product-pages').createSignedUrl(path, 3600);
        return [path, data?.signedUrl || ''] as const;
      }));
      if (cancelled) return;
      const resolved = Object.fromEntries(entries.filter((entry) => Boolean(entry[1])));
      setImageUrls(resolved);
      setActiveImage((current) => current || resolved[product.offer_image_path || ''] || Object.values(resolved)[0] || '');
    })();
    return () => { cancelled = true; };
  }, [product]);

  const benefits = useMemo(() => asNamedTexts(product?.offer_benefits), [product?.offer_benefits]);
  const requirements = useMemo(() => [
    ...asNamedTexts(product?.offer_requirements),
    ...asNamedTexts(product?.offer_additional_requirements),
  ], [product?.offer_additional_requirements, product?.offer_requirements]);
  const clauses = useMemo(() => {
    if (!product) return [];
    const entries = [
      ...parseContractClauseEntries(product.recommended_contract_clauses, (product.recommended_contract_clause_category as any) || 'requirements'),
      ...product.variants.flatMap((variant) => parseContractClauseEntries(variant.recommended_contract_clauses, (variant.recommended_contract_clause_category as any) || 'requirements')),
    ];
    const seen = new Set<string>();
    return entries.flatMap((entry) => {
      const text = htmlToPlainText(entry.content);
      const key = text.toLocaleLowerCase('pl-PL');
      if (!text || seen.has(key)) return [];
      seen.add(key);
      return [{ ...entry, text }];
    });
  }, [product]);

  if (contextLoading || loading) return <div className="flex min-h-[50vh] items-center justify-center text-[#d3bb73]"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  if (error || !product) return (
    <div className="mx-auto max-w-3xl p-6 text-[#e5e4e2]">
      <Link href="/seller/offers/new" className="inline-flex items-center gap-2 text-sm text-[#d3bb73]"><ArrowLeft className="h-4 w-4" /> Wróć do katalogu</Link>
      <div className="mt-6 rounded-xl bg-red-300/10 p-6 text-sm text-red-100">{error || 'Produkt nie jest dostępny.'}</div>
    </div>
  );

  const sellerRequirements = product.pricing_requirements;
  const startingPrice = product.base_price ?? product.variants[0]?.price_net ?? 0;

  return (
    <div className="min-h-screen p-4 text-[#e5e4e2] md:p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <Link href={`/seller/offers/new${brandId ? `?brand=${brandId}` : ''}`} className="inline-flex items-center gap-2 text-xs text-[#e5e4e2]/45 hover:text-[#d3bb73]"><ArrowLeft className="h-4 w-4" /> Wróć do katalogu</Link>

        <section className="grid overflow-hidden rounded-2xl bg-[#1c1f33] shadow-lg lg:grid-cols-[minmax(0,1.05fr)_minmax(360px,.95fr)]">
          <div className="relative min-h-[320px] bg-[#0b0d15] lg:min-h-[500px]">
            {activeImage ? <Image src={activeImage} alt={product.offer_image_alt || product.name} fill priority unoptimized className="object-cover" /> : <ImageIcon className="absolute left-1/2 top-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 text-white/15" />}
          </div>
          <div className="flex flex-col justify-center p-6 md:p-9">
            {product.category?.name && <p className="text-xs uppercase tracking-[0.16em] text-[#d3bb73]">{product.category.name}</p>}
            <h1 className="mt-3 text-3xl font-light leading-tight">{product.name}</h1>
            <p className="mt-4 text-sm leading-6 text-[#e5e4e2]/60">{product.offer_short_description || product.offer_description || product.description}</p>
            <div className="mt-6 rounded-xl bg-[#d3bb73]/10 px-4 py-3"><p className="text-xs text-[#e5e4e2]/45">Twoja stawka MAVINCI</p><p className="mt-1 text-2xl text-[#d3bb73]">od {sellerMoney(startingPrice)} <span className="text-xs text-[#e5e4e2]/45">netto / {product.unit || 'szt.'}</span></p></div>
            <div className="mt-5 flex flex-wrap gap-2">
              {sellerRequirements?.requires_accommodation && <span className="flex items-center gap-2 rounded-full bg-amber-300/10 px-3 py-1.5 text-xs text-amber-100"><BedDouble className="h-3.5 w-3.5" /> Wymagany nocleg</span>}
              {sellerRequirements?.logistics_note && <span className="flex items-center gap-2 rounded-full bg-sky-300/10 px-3 py-1.5 text-xs text-sky-100"><Truck className="h-3.5 w-3.5" /> Logistyka do uzgodnienia</span>}
            </div>
            {product.product_page_url && <a href={product.product_page_url} target="_blank" rel="noreferrer" className="mt-5 inline-flex items-center gap-2 text-xs text-[#d3bb73] hover:text-[#e2cd8d]">Zobacz stronę produktu <ExternalLink className="h-3.5 w-3.5" /></a>}
          </div>
        </section>

        {Object.keys(imageUrls).length > 1 && <section className="flex gap-3 overflow-x-auto rounded-xl bg-[#1c1f33] p-3 shadow-sm">{Object.entries(imageUrls).map(([path, url]) => <button type="button" key={path} onClick={() => setActiveImage(url)} className={`relative h-20 w-28 shrink-0 overflow-hidden rounded-lg opacity-70 transition hover:opacity-100 ${activeImage === url ? 'shadow-[0_0_0_2px_rgba(211,187,115,0.45)] opacity-100' : ''}`}><Image src={url} alt="Zdjęcie produktu" fill unoptimized className="object-cover" /></button>)}</section>}

        {product.offer_description && product.offer_description !== product.offer_short_description && <section className="rounded-xl bg-[#1c1f33] p-6 shadow-sm"><div className="flex items-center gap-2 text-[#d3bb73]"><Info className="h-4 w-4" /><h2 className="text-sm font-medium">Opis produktu</h2></div><p className="mt-4 whitespace-pre-line text-sm leading-7 text-[#e5e4e2]/65">{product.offer_description}</p></section>}

        {product.variants.length > 0 && <section className="rounded-xl bg-[#1c1f33] p-6 shadow-sm"><h2 className="text-lg font-light">Dostępne warianty</h2><div className="mt-4 grid gap-3 md:grid-cols-2">{product.variants.map((variant) => <article key={variant.id} className="rounded-xl bg-[#111522] p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-medium">{variant.name}</h3><p className="mt-2 text-xs leading-5 text-white/45">{variant.short_description || variant.description}</p></div><p className="shrink-0 text-sm text-[#d3bb73]">{sellerMoney(variant.price_net)}</p></div>{variant.pricing_requirements?.requires_accommodation && <p className="mt-3 flex items-center gap-2 text-xs text-amber-100"><BedDouble className="h-3.5 w-3.5" /> Wymagany nocleg{variant.pricing_requirements.accommodation_note ? `: ${variant.pricing_requirements.accommodation_note}` : ''}</p>}{variant.pricing_requirements?.logistics_note && <p className="mt-2 flex items-start gap-2 text-xs leading-5 text-sky-100"><Truck className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {variant.pricing_requirements.logistics_note}</p>}{variant.pricing_requirements?.additional_requirements && <p className="mt-2 text-xs leading-5 text-white/50">{variant.pricing_requirements.additional_requirements}</p>}</article>)}</div></section>}

        {(benefits.length > 0 || requirements.length > 0) && <div className="grid gap-5 lg:grid-cols-2">
          {benefits.length > 0 && <section className="rounded-xl bg-[#1c1f33] p-6 shadow-sm"><h2 className="text-lg font-light">Co obejmuje produkt</h2><div className="mt-4 space-y-3">{benefits.map((benefit, index) => <div key={`${benefit.title}-${index}`} className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#d3bb73]" /><div>{benefit.title && <p className="text-sm">{benefit.title}</p>}<p className="text-sm leading-6 text-white/50">{benefit.text}</p></div></div>)}</div></section>}
          {requirements.length > 0 && <section className="rounded-xl bg-[#1c1f33] p-6 shadow-sm"><h2 className="text-lg font-light">Wymagania realizacyjne</h2><div className="mt-4 space-y-3">{requirements.map((requirement, index) => <div key={`${requirement.title}-${index}`} className="rounded-lg bg-white/[0.035] px-4 py-3">{requirement.title && <p className="text-xs font-medium text-[#d3bb73]">{requirement.title}</p>}<p className="mt-1 text-sm leading-6 text-white/55">{requirement.text}</p></div>)}</div></section>}
        </div>}

        {(sellerRequirements?.requires_accommodation || sellerRequirements?.logistics_note || sellerRequirements?.additional_requirements) && <section className="rounded-xl bg-[#1c1f33] p-6 shadow-sm"><h2 className="text-lg font-light">Ustalenia dla Twojej realizacji</h2><div className="mt-4 grid gap-3 md:grid-cols-2">{sellerRequirements.requires_accommodation && <div className="flex items-start gap-3 rounded-lg bg-amber-300/8 px-4 py-3"><BedDouble className="mt-0.5 h-4 w-4 shrink-0 text-amber-200" /><div><p className="text-sm">Nocleg</p><p className="mt-1 text-xs leading-5 text-white/50">{sellerRequirements.accommodation_note || 'Szczegóły noclegu należy uzgodnić przed potwierdzeniem realizacji.'}</p></div></div>}{sellerRequirements.logistics_note && <div className="flex items-start gap-3 rounded-lg bg-sky-300/8 px-4 py-3"><Truck className="mt-0.5 h-4 w-4 shrink-0 text-sky-200" /><div><p className="text-sm">Logistyka</p><p className="mt-1 text-xs leading-5 text-white/50">{sellerRequirements.logistics_note}</p></div></div>}{sellerRequirements.additional_requirements && <div className="rounded-lg bg-white/[0.035] px-4 py-3 md:col-span-2"><p className="text-sm">Dodatkowe ustalenia</p><p className="mt-1 whitespace-pre-line text-xs leading-5 text-white/50">{sellerRequirements.additional_requirements}</p></div>}</div></section>}

        {clauses.length > 0 && <section className="rounded-xl bg-[#1c1f33] p-6 shadow-sm"><div className="flex items-center gap-2 text-[#d3bb73]"><FileCheck2 className="h-4 w-4" /><h2 className="text-lg font-light text-[#e5e4e2]">Klauzule i ważne warunki</h2></div><p className="mt-2 text-xs text-white/35">Informacje pomocnicze do rozmowy z klientem. Ostateczne brzmienie znajduje się w wygenerowanej umowie.</p><div className="mt-4 space-y-3">{clauses.map((clause) => <article key={clause.id} className="rounded-lg bg-[#111522] px-4 py-3"><h3 className="text-xs font-medium text-[#d3bb73]">{clause.title}</h3><p className="mt-2 text-sm leading-6 text-white/55">{clause.text}</p></article>)}</div></section>}

        <div className="flex justify-end"><Link href={`/seller/offers/new${brandId ? `?brand=${brandId}` : ''}`} className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2.5 text-sm font-medium text-[#111522]"><Package className="h-4 w-4" /> Wróć do tworzenia oferty</Link></div>
      </div>
    </div>
  );
}
