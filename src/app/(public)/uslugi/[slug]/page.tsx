import { notFound, permanentRedirect } from 'next/navigation';
import { cache } from 'react';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import PageLayout from '@/components/Layout/PageLayout';
import ServiceDetailClient from './ServiceDetailClient';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';
import { getCurrentEmployeeServerCached } from '@/lib/CRM/auth/getCurrentEmployeeServer';
import { canEditWebsite } from '@/lib/permissions';
import { publicSupabase } from '@/lib/SEO/publicData';
import { SITE, ORGANIZATION_ID } from '@/lib/SEO/site';
import { canonicalServiceSlug, serviceCorrection, servicePath, SERVICE_OFFER_PATHS } from '@/lib/SEO/serviceUrls';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const loadServiceData = cache(async (slug: string) => {
  if (SERVICE_OFFER_PATHS[slug]) permanentRedirect(SERVICE_OFFER_PATHS[slug]);
  const db = createSupabaseServerClient(cookies());
  const employee = await getCurrentEmployeeServerCached();
  const hasWebsiteEdit = employee?.is_active !== false && canEditWebsite(employee);
  let result = await db.from('conferences_service_items').select('*').eq('slug', slug).maybeSingle();
  if (result.error) throw new Error('Nie udało się wczytać usługi.');
  if (!result.data) {
    // Known damaged URLs work both before and after the migration is applied.
    let serviceId = serviceCorrection(slug)?.id;
    if (!serviceId) {
      const alias = await db.from('service_slug_aliases').select('service_id').eq('old_slug', slug).maybeSingle();
      if (alias.error && !['42P01', 'PGRST205'].includes(alias.error.code)) throw new Error('Nie udało się odczytać adresu usługi.');
      serviceId = alias.data?.service_id;
    }
    if (serviceId) {
      result = await db.from('conferences_service_items').select('*').eq('id', serviceId).maybeSingle();
      if (result.error) throw new Error('Nie udało się wczytać usługi.');
    }
  }
  const stored = result.data;
  if (!stored || (!stored.is_active && !hasWebsiteEdit)) return null;
  const service = { ...stored, slug: canonicalServiceSlug(stored) };
  if (slug !== service.slug) permanentRedirect(servicePath(service));
  const previous = serviceCorrection(slug)?.oldSlug;
  const heroSlugs = Array.from(new Set([`uslugi/${service.slug}`, `uslugi/${stored.slug}`, ...(previous ? [`uslugi/${previous}`] : [])]));
  const [categoryRes, relatedRes, heroRes, galleryRes] = await Promise.all([
    db.from('conferences_service_categories').select('*').eq('id', service.category_id).eq('is_active', true).maybeSingle(),
    db.from('conferences_service_items').select('*').eq('category_id', service.category_id).eq('is_active', true).neq('id', service.id).order('display_order').limit(10),
    db.from('service_hero_images').select('page_slug,image_url,alt_text').in('page_slug', heroSlugs).eq('is_active', true),
    db.from('conferences_service_gallery').select('*').eq('service_id', service.id).eq('is_active', true).order('display_order'),
  ]);
  const heroImage = heroSlugs.map(path => heroRes.data?.find(image => image.page_slug === path)).find(Boolean);
  return { service, category: categoryRes.data, relatedServices: relatedRes.data || [], heroImage,
    gallery: galleryRes.data || [], hasWebsiteEdit };
});

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const data = await loadServiceData(params.slug);
  if (!data) return { title: 'Nie znaleziono usługi | MAVINCI', robots: { index: false } };
  const { service, heroImage } = data;
  const url = `${SITE.url}${servicePath(service)}`;
  const title = service.seo_title || `${service.name} | MAVINCI`;
  const description = service.seo_description || service.description;
  const image = heroImage?.image_url || service.hero_image_url || service.thumbnail_url || `${SITE.url}/logo-mavinci-crm.png`;
  return { title: { absolute: title }, description, keywords: service.seo_keywords,
    alternates: { canonical: url },
    ...(!service.is_active && { robots: { index: false, follow: false } }),
    openGraph: { type: 'website', url, title, description, siteName: SITE.name, locale: 'pl_PL', images: [{ url: image, alt: heroImage?.alt_text || service.name }] },
    twitter: { card: 'summary_large_image', title, description, images: [image] } };
}

export default async function ServiceDetailPage({ params }: { params: { slug: string } }) {
  const data = await loadServiceData(params.slug);
  if (!data) notFound();
  const { service, category, relatedServices, heroImage, gallery, hasWebsiteEdit } = data;
  const url = `${SITE.url}${servicePath(service)}`;
  const image = heroImage?.image_url || service.hero_image_url || service.thumbnail_url || `${SITE.url}/logo-mavinci-crm.png`;
  const schema = { '@context': 'https://schema.org', '@type': 'Service', '@id': `${url}#service`,
    name: service.name, description: service.seo_description || service.description, url, image,
    provider: { '@id': ORGANIZATION_ID },
    areaServed: [{ '@type': 'City', name: 'Olsztyn' }, { '@type': 'AdministrativeArea', name: 'województwo warmińsko-mazurskie' }, { '@type': 'Country', name: 'Polska' }],
    ...(category && { category: category.name, serviceType: category.name }) };
  return <PageLayout pageSlug={`uslugi/${service.slug}`} customSchema={schema} cookieStore={cookies()}>
    <main className="mt-28 min-h-screen bg-[#0f1119]"><ServiceDetailClient service={service} category={category}
      relatedServices={relatedServices} ogImage={image} gallery={gallery} isAdmin={hasWebsiteEdit} /></main>
  </PageLayout>;
}

export async function generateStaticParams() {
  const { data, error } = await publicSupabase().from('conferences_service_items').select('id,slug').eq('is_active', true);
  if (error) throw new Error('Nie udało się wczytać adresów usług.');
  return (data || []).filter(service => service.slug && !SERVICE_OFFER_PATHS[service.slug]).map(service => ({ slug: canonicalServiceSlug(service) }));
}
