import { servicePagePath, relatedServicePagePath } from '@/lib/CRM/Offers/relatedServices';
import { ArrowUpRight } from 'lucide-react';
import ProductPhoto from './ProductPhoto';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { CheckCircle2, Info } from 'lucide-react';
import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Poznaj produkt — MAVINCI',
  robots: { index: false, follow: false },
};

const plain = (value: unknown) => typeof value === 'string'
  ? value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim() : '';
const entries = (value: unknown): { title: string; text: string }[] => !Array.isArray(value) ? [] : value.flatMap((item) => {
  if (typeof item === 'string') return plain(item) ? [{ title: '', text: plain(item) }] : [];
  if (!item || typeof item !== 'object') return [];
  const title = plain(item.title || item.name);
  const text = plain(item.description || item.text || item.content);
  return title || text ? [{ title, text }] : [];
});

export default async function PublicProductPage({ params }: { params: { id: string } }) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.id)) notFound();
  const supabase = createSupabaseAdminClient();
  // Public fields are explicitly selected. Package JSON is projected on the server
  // to public copy and images only; prices and internal configuration never reach client props.
  const { data: product, error } = await supabase.from('offer_products')
    .select('id, name, is_active, description, offer_short_description, offer_description, offer_benefits, offer_requirements, offer_image_path, offer_image_alt, sales_packages_enabled, sales_packages, related_service_ids, related_service_url, related_service_label')
    .eq('id', params.id).maybeSingle();
  if (error) throw new Error('Nie udało się wczytać opisu produktu.');
  if (!product) notFound();
  const { data: variants, error: variantsError } = await supabase.from('offer_product_variants')
    .select('id, name, short_description, description, benefits, offer_image_path, offer_image_alt')
    .eq('product_id', product.id).eq('is_active', true).order('display_order');
  if (variantsError) throw new Error('Nie udało się wczytać wariantów produktu.');
  const packages = product.sales_packages_enabled && Array.isArray(product.sales_packages)
    ? product.sales_packages.flatMap((item: unknown) => {
      if (!item || typeof item !== 'object') return [];
      const p = item as Record<string, unknown>;
      const name = plain(p.name);
      if (!name) return [];
      return [{ id: typeof p.id === 'string' ? p.id : name, name,
        description: plain(p.description), scope: plain(p.included_label), bonus: plain(p.bonus),
        image_path: typeof p.image_path === 'string' ? p.image_path : '', image_alt: plain(p.image_alt),
      }];
    }) : [];
  const paths = [...new Set([product.offer_image_path, ...(variants || []).map(v=>v.offer_image_path), ...packages.map(p=>p.image_path)]
    .filter((path): path is string => typeof path === 'string' && Boolean(path) && !/^(?:[a-z]+:|\/\/)/i.test(path)))];
  const { data: signedImages } = paths.length
    ? await supabase.storage.from('offer-product-pages').createSignedUrls(paths, 3600)
    : { data: [] };
  const imageUrls = new Map((signedImages || []).filter(image=>image.path && image.signedUrl && !image.error).map(image=>[image.path!, image.signedUrl]));
  const imageUrl = imageUrls.get(product.offer_image_path || '') || '';
  const serviceIds: string[] = Array.isArray(product.related_service_ids) ? product.related_service_ids : [];
  const { data: linkedServices } = serviceIds.length
    ? await supabase.from('services_catalog').select('id,title,slug').in('id',serviceIds).eq('is_active',true)
    : { data: [] };
  const catalogServices = serviceIds.flatMap(id=>{
    const service=linkedServices?.find(service=>service.id===id);
    const href=servicePagePath(service?.slug);
    return service&&href?[{id:service.id,title:`Zobacz usługę: ${plain(service.title)}`,href}]:[];
  });
  const customServiceUrl = relatedServicePagePath(product.related_service_url);
  const relatedServices = [
    ...(customServiceUrl ? [{id:'custom-service',title:plain(product.related_service_label)||'Poznaj pełną usługę',href:customServiceUrl}] : []),
    ...catalogServices.filter(service=>!customServiceUrl || service.href !== customServiceUrl.split(/[?#]/)[0]),
  ];
  const benefits = entries(product.offer_benefits);
  const requirements = entries(product.offer_requirements);
  const description = plain(product.offer_description || product.description);
  return <main className="min-h-screen bg-[#250914] px-4 pb-16 pt-32 text-[#e5e4e2] md:px-8">
    <div className="mx-auto max-w-6xl space-y-6">
      <section className={`overflow-hidden rounded-2xl bg-[#401525] shadow-lg ${imageUrl ? 'grid lg:grid-cols-2' : ''}`}>
        {imageUrl && <ProductPhoto src={imageUrl} alt={product.offer_image_alt || product.name} className="h-full max-h-[560px] min-h-[280px]" />}
        <div className="flex flex-col justify-center p-7 md:p-10">
          <p className="text-xs uppercase tracking-[0.18em] text-[#d3bb73]">MAVINCI · Poznaj możliwości</p>
          {product.is_active === false && <p className="mt-4 text-sm text-[#d3bb73]">Produkt archiwalny — aktualną dostępność potwierdź z opiekunem oferty.</p>}
          <h1 className="mt-4 text-3xl font-light uppercase leading-tight">{product.name}</h1>
          <p className="mt-5 whitespace-pre-line text-base leading-7 text-[#e5e4e2]/75">{plain(product.offer_short_description) || description}</p>
          {relatedServices.length>0&&<nav aria-label="Powiązane usługi" className="mt-6 rounded-xl bg-[#d3bb73]/10 p-5">
            <p className="text-sm font-medium text-[#d3bb73]">{relatedServices.length===1?'Ten produkt jest częścią naszej usługi':'Poznaj usługi powiązane z tym produktem'}</p>
            <p className="mt-2 text-sm leading-6 text-[#e5e4e2]/65">Przejdź do pełnego opisu i poznaj możliwości realizacji.</p>
            <div className="mt-4 flex flex-col gap-2">{relatedServices.map(service=><a key={service.id} href={service.href} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between gap-3 rounded-lg bg-[#d3bb73] px-4 py-3 text-sm font-semibold text-[#250914] transition-colors hover:bg-[#e1ca87]">{service.title}<ArrowUpRight aria-hidden="true" className="h-5 w-5 shrink-0"/></a>)}</div>
          </nav>}
          <p className="mt-7 rounded-xl bg-black/15 p-4 text-sm leading-6 text-[#e5e4e2]/60">Dokładny zakres, ilości i warunki realizacji znajdziesz w otrzymanej ofercie. Opis przedstawia możliwości produktu.</p>
        </div>
      </section>
      {description && description !== plain(product.offer_short_description) && <section className="rounded-2xl bg-[#401525] p-7 md:p-9">
        <h2 className="flex items-center gap-2 text-lg uppercase text-[#d3bb73]"><Info size={20} />Opis produktu</h2>
        <p className="mt-5 whitespace-pre-line leading-7 text-[#e5e4e2]/75">{description}</p>
      </section>}
      {!!requirements.length && <section className="rounded-2xl bg-[#401525] p-7">
        <h2 className="text-lg uppercase text-[#d3bb73]">Wymagania realizacyjne</h2>
        <ul className="mt-5 space-y-4">{requirements.map((item, index) => <li key={index} className="flex gap-3"><CheckCircle2 className="mt-1 h-5 w-5 shrink-0 text-[#d3bb73]" /><div>{item.title && <p className="font-medium">{item.title}</p>}<p className="whitespace-pre-line text-sm leading-6 text-[#e5e4e2]/70">{item.text}</p></div></li>)}</ul>
      </section>}
      {!!variants?.length && <section id="elementy" className="scroll-mt-28 rounded-2xl bg-[#401525] p-7">
        <h2 className="text-lg uppercase text-[#d3bb73]">{product.sales_packages_enabled ? 'Poznaj elementy produktu' : 'Dostępne warianty'}</h2>
        <div className="mt-5 grid gap-5 md:grid-cols-2 lg:grid-cols-3">{variants.map(variant => {
          const photo = imageUrls.get(variant.offer_image_path || '');
          return <article key={variant.id} id={`element-${variant.id}`} className="scroll-mt-28 overflow-hidden rounded-xl bg-black/15">
            {photo && <ProductPhoto src={photo} alt={variant.offer_image_alt || variant.name} className="aspect-[118/100]"/>}
            <div className="p-5"><h3 className="uppercase text-[#d3bb73]">{variant.name}</h3>
              {plain(variant.short_description)&&<p className="mt-3 text-sm leading-6 text-[#e5e4e2]/85">{plain(variant.short_description)}</p>}
              {plain(variant.description)!==plain(variant.short_description)&&<p className="mt-3 whitespace-pre-line text-sm leading-6 text-[#e5e4e2]/70">{plain(variant.description)}</p>}
              {!!entries(variant.benefits).length&&<ul className="mt-4 space-y-2 text-sm text-[#e5e4e2]/70">{entries(variant.benefits).map((benefit,index)=><li key={index} className="flex gap-2"><CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-[#d3bb73]"/><span>{benefit.title} {benefit.text}</span></li>)}</ul>}
            </div>
          </article>;
        })}</div>
      </section>}
      {!!packages.length && <section id="pakiety" className="scroll-mt-28 rounded-2xl bg-[#401525] p-7">
        <h2 className="text-lg uppercase text-[#d3bb73]">Wybierz zakres dla swojego wydarzenia</h2>
        <p className="mt-3 text-sm leading-6 text-[#e5e4e2]/60">Poznaj możliwe zestawy. Wybrany zakres i uzgodnione ceny znajdziesz w swojej ofercie.</p>
        <div className="mt-5 space-y-5">{packages.map(p=>{
          const photo=imageUrls.get(p.image_path);
          return <article key={p.id} className={`overflow-hidden rounded-xl bg-black/15 ${photo?'grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]':''}`}>
            {photo&&<ProductPhoto src={photo} alt={p.image_alt||p.name} className="aspect-[4/3] h-full"/>}
            <div className="flex flex-col justify-center p-6"><h3 className="uppercase text-[#d3bb73]">{p.name}</h3><p className="mt-3 text-sm leading-6 text-[#e5e4e2]/75">{p.description}</p><p className="mt-4 text-sm leading-6 text-[#e5e4e2]">{p.scope}</p>{p.bonus&&<p className="mt-4 rounded-lg bg-[#d3bb73]/10 px-4 py-3 text-sm text-[#d3bb73]">{p.bonus}</p>}</div>
          </article>;
        })}</div>
      </section>}
      {!!benefits.length && <section id="korzysci" className="scroll-mt-28 rounded-2xl bg-[#401525] p-7 md:p-9">
        <h2 className="text-lg uppercase text-[#d3bb73]">Co zyskujesz</h2>
        <ul className={`mt-5 grid gap-6 ${benefits.length > 1 ? 'md:grid-cols-2' : ''}`}>{benefits.map((item, index) => <li key={index} className="flex gap-3"><CheckCircle2 className="mt-1 h-5 w-5 shrink-0 text-[#d3bb73]" /><div>{item.title && <p className="font-medium">{item.title}</p>}<p className="whitespace-pre-line text-sm leading-6 text-[#e5e4e2]/70">{item.text}</p></div></li>)}</ul>
      </section>}
    </div>
  </main>;
}
