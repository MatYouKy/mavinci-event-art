import { servicePagePath, relatedServicePagePath } from '@/lib/CRM/Offers/relatedServices';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';
import PublicProductContentView, { type PublicProductContent } from './PublicProductContent';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Poznaj produkt / Explore the product — MAVINCI', robots: { index: false, follow: false } };
const plain = (value: unknown) => typeof value === 'string'
  ? value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim() : '';
const rows = (value: unknown): Record<string, any>[] => Array.isArray(value) ? value.filter(row => row && typeof row === 'object') : [];

export default async function PublicProductPage({ params, searchParams }: {
  params: { id: string }; searchParams?: { lang?: string | string[] };
}) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.id)) notFound();
  const supabase = createSupabaseAdminClient();
  // Translation storage and package configuration stay on the server. Only the
  // explicit public view below is passed to the browser, in either language.
  const { data: product, error } = await supabase.from('offer_products')
    .select('id, name, is_active, description, offer_short_description, offer_description, public_description, pricing_addons, offer_additional_requirements, offer_benefits, offer_requirements, offer_image_path, offer_image_alt, sales_packages_enabled, sales_packages, related_service_ids, related_service_url, related_service_label, english_content')
    .eq('id', params.id).maybeSingle();
  if (error) throw new Error('Nie udało się wczytać opisu produktu.');
  if (!product) notFound();
  const { data: variants, error: variantsError } = await supabase.from('offer_product_variants')
    .select('id, name, short_description, description, benefits, offer_image_path, offer_image_alt')
    .eq('product_id', product.id).eq('is_active', true).order('display_order');
  if (variantsError) throw new Error('Nie udało się wczytać wariantów produktu.');
  const rawPackages = product.sales_packages_enabled ? rows(product.sales_packages) : [];
  const paths = [...new Set([product.offer_image_path, ...(variants || []).map(v => v.offer_image_path), ...rawPackages.map(p => p.image_path)]
    .filter((path): path is string => typeof path === 'string' && Boolean(path) && !/^(?:[a-z]+:|\/\/)/i.test(path)))];
  const { data: signedImages } = paths.length
    ? await supabase.storage.from('offer-product-pages').createSignedUrls(paths, 3600) : { data: [] };
  const imageUrls: Record<string,string> = Object.fromEntries((signedImages || []).filter(image => image.path && image.signedUrl && !image.error).map(image => [image.path!, image.signedUrl!]));
  const serviceIds: string[] = Array.isArray(product.related_service_ids) ? product.related_service_ids : [];
  const { data: linkedServices } = serviceIds.length
    ? await supabase.from('services_catalog').select('id,title,slug').in('id',serviceIds).eq('is_active',true) : { data: [] };
  const customServiceUrl = relatedServicePagePath(product.related_service_url);
  const stored = (product.english_content || {}) as Record<string,{ source: string; target: string }>;
  let englishReady = true;
  const project = (language: 'pl' | 'en'): PublicProductContent => {
    const copy = (key: string, value: unknown): string => {
      if (typeof value !== 'string' || !plain(value)) return '';
      if (language === 'pl') return plain(value);
      const entry = stored[key];
      if (entry?.source === value && typeof entry.target === 'string' && plain(entry.target)) return plain(entry.target);
      englishReady = false;
      return '';
    };
    const list = (value: unknown, group: string): {title:string;text:string}[] => !Array.isArray(value) ? [] : value.flatMap((item,index) => {
      if (typeof item === 'string') return plain(item) ? [{ title:'', text:copy(`${group}/${index}`,item) }] : [];
      if (!item || typeof item !== 'object') return [];
      const id = item.id || String(index);
      const titleKey = item.title ? 'title' : 'name';
      const textKey = item.description ? 'description' : item.text ? 'text' : 'content';
      if (!plain(item[titleKey]) && !plain(item[textKey])) return [];
      return [{ title:copy(`${group}/${id}/${titleKey}`,item[titleKey]), text:copy(`${group}/${id}/${textKey}`,item[textKey]) }];
    });
    const descriptionKey = product.public_description ? 'public_description' : product.offer_description ? 'offer_description' : 'description';
    const catalogServices = serviceIds.flatMap((id,index) => {
      const service = linkedServices?.find(service => service.id === id);
      const href = servicePagePath(service?.slug);
      return service && href ? [{ id:service.id, title:language === 'pl' ? `Zobacz usługę: ${plain(service.title)}` : `Explore related service${serviceIds.length > 1 ? ` ${index + 1}` : ''}`, href }] : [];
    });
    return {
      product: {
        name:copy('name',product.name), is_active:product.is_active !== false,
        offer_image_alt:copy('offer_image_alt',product.offer_image_alt),
        offer_short_description:copy('offer_short_description',product.offer_short_description),
        sales_packages_enabled:Boolean(product.sales_packages_enabled),
      },
      description:copy(descriptionKey,product[descriptionKey]), imageUrl:imageUrls[product.offer_image_path || ''] || '',
      variants:(variants || []).map(variant => ({
        id:variant.id, name:copy(`variants/${variant.id}/name`,variant.name),
        short_description:copy(`variants/${variant.id}/short_description`,variant.short_description),
        description:copy(`variants/${variant.id}/description`,variant.description),
        benefits:list(variant.benefits,`variants/${variant.id}/benefits`),
        offer_image_path:variant.offer_image_path || '', offer_image_alt:copy(`variants/${variant.id}/offer_image_alt`,variant.offer_image_alt),
      })),
      packages:rawPackages.flatMap((p,index) => {
        if (!plain(p.name)) return [];
        const id=p.id || String(index);
        return [{ id, name:copy(`sales_packages/${id}/name`,p.name), description:copy(`sales_packages/${id}/description`,p.description),
          scope:copy(`sales_packages/${id}/included_label`,p.included_label), bonus:copy(`sales_packages/${id}/bonus`,p.bonus),
          image_path:typeof p.image_path === 'string' ? p.image_path : '', image_alt:copy(`sales_packages/${id}/image_alt`,p.image_alt) }];
      }),
      benefits:list(product.offer_benefits,'offer_benefits'),
      requirements:product.offer_additional_requirements?.length ? list(product.offer_additional_requirements,'offer_additional_requirements') : list(product.offer_requirements,'offer_requirements'),
      extras:list(product.pricing_addons,'pricing_addons'),
      relatedServices:[
        ...(customServiceUrl ? [{ id:'custom-service', title:copy('related_service_label',product.related_service_label) || (language === 'pl' ? 'Poznaj pełną usługę' : 'Explore the full service'), href:customServiceUrl }] : []),
        ...catalogServices.filter(service => !customServiceUrl || service.href !== customServiceUrl.split(/[?#]/)[0]),
      ],
    };
  };
  const polish = project('pl');
  const english = project('en');
  return <PublicProductContentView key={product.id} polish={polish} english={englishReady ? english : null}
    initialLanguage={searchParams?.lang === 'en' && englishReady ? 'en' : 'pl'} imageUrls={imageUrls} />;
}
