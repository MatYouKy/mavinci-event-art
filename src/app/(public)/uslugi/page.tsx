import type { Metadata } from 'next';
import PageLayout from '@/components/Layout/PageLayout';
import { UslugiPageClient } from './UslugiPageClient';
import { publicSupabase } from '@/lib/SEO/publicData';
import { SITE, WEBSITE_ID } from '@/lib/SEO/site';
import { servicePath } from '@/lib/SEO/serviceUrls';

export const dynamic = 'force-dynamic';
type Search = { q?: string | string[] };
const title = 'Usługi eventowe i technika wydarzeń | MAVINCI';
const description = 'Nagłośnienie, ekrany LED, oświetlenie, streaming, teleturnieje i atrakcje firmowe. Poznaj usługi MAVINCI w Olsztynie, na Warmii i Mazurach oraz w całej Polsce.';
const url = `${SITE.url}/uslugi`;

export function generateMetadata({ searchParams }: { searchParams: Search }): Metadata {
  return { title: { absolute: title }, description, alternates: { canonical: url },
    ...(searchParams.q !== undefined && { robots: { index: false, follow: true } }),
    openGraph: { type: 'website', title, description, url, siteName: SITE.name, locale: 'pl_PL', images: [{ url: `${SITE.url}/logo-mavinci-crm.png`, alt: SITE.name }] },
    twitter: { card: 'summary_large_image', title, description, images: [`${SITE.url}/logo-mavinci-crm.png`] } };
}

export default async function UslugiPage({ searchParams }: { searchParams: Search }) {
  const { data, error } = await publicSupabase().from('conferences_service_categories')
    .select('*, items:conferences_service_items(*)').eq('is_active', true).order('display_order');
  if (error) throw new Error('Nie udało się pobrać katalogu usług.');
  const categories = (data || []).map(category => ({ ...category,
    items: (category.items || []).filter((item: any) => item.is_active).sort((a: any, b: any) => a.display_order - b.display_order) }));
  const query = typeof searchParams.q === 'string' ? searchParams.q.slice(0, 200) : '';
  const services = categories.flatMap(category => category.items).filter((item: any) =>
    !query || `${item.name} ${item.description || ''}`.toLocaleLowerCase('pl-PL').includes(query.toLocaleLowerCase('pl-PL')));
  const schema = { '@context': 'https://schema.org', '@type': 'CollectionPage', '@id': `${url}#webpage`,
    name: title, description, url, isPartOf: { '@id': WEBSITE_ID },
    mainEntity: { '@type': 'ItemList', numberOfItems: services.length, itemListElement: services.map((item: any, index: number) => ({
      '@type': 'ListItem', position: index + 1, name: item.name, url: `${SITE.url}${servicePath(item)}`,
    })) } };
  return <PageLayout pageSlug="uslugi" customSchema={schema}><UslugiPageClient initialCategories={categories} initialSearch={query} /></PageLayout>;
}
