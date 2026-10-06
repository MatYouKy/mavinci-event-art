import { Metadata } from 'next';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import PageLayout from '@/components/Layout/PageLayout';
import PortfolioDetailClient from './PortfolioDetailClient';
import { publicSupabase, getPublicPageMetadata } from '@/lib/SEO/publicData';
import { SITE, ORGANIZATION_ID } from '@/lib/SEO/site';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

const loadProjectData = cache(async (slug: string) => {
  const [{ data: project, error }, metadata] = await Promise.all([
    publicSupabase().from('portfolio_projects').select('*').eq('slug', slug).maybeSingle(),
    getPublicPageMetadata(`portfolio/${slug}`),
  ]);
  if (error) throw new Error('Nie udało się pobrać realizacji.');
  return project ? { project, metadata } : null;
});

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const data = await loadProjectData(params.slug);
  if (!data) return { title: 'Nie znaleziono realizacji | MAVINCI', robots: { index: false } };
  const { project, metadata } = data;
  const url = `${SITE.url}/portfolio/${project.slug}`;
  const title = metadata?.title || `${project.title} | Portfolio MAVINCI`;
  const description = metadata?.description || project.meta_description || project.description;
  const image = metadata?.og_image || project.image_metadata?.desktop?.src || project.image || `${SITE.url}/logo-mavinci-crm.png`;
  return { title: { absolute: title }, description, alternates: { canonical: url },
    openGraph: { type: 'article', url, title, description, siteName: SITE.name,
      images: [{ url: image, alt: project.alt || project.title }] },
    twitter: { card: 'summary_large_image', title, description, images: [image] } };
}

export default async function PortfolioDetailPage({ params }: { params: { slug: string } }) {
  const data = await loadProjectData(params.slug);
  if (!data) notFound();
  const { project, metadata } = data;
  const url = `${SITE.url}/portfolio/${project.slug}`;
  const schema = {
    '@context': 'https://schema.org', '@type': 'Article', '@id': `${url}#article`,
    headline: project.title, description: metadata?.description || project.meta_description || project.description,
    url, mainEntityOfPage: url, inLanguage: 'pl-PL',
    image: project.image_metadata?.desktop?.src || project.image,
    datePublished: project.created_at, dateModified: project.updated_at,
    author: { '@id': ORGANIZATION_ID }, publisher: { '@id': ORGANIZATION_ID },
    ...(project.location && project.location !== 'Polska' && {
      contentLocation: { '@type': 'Place', name: project.location },
    }),
  };
  return <PageLayout pageSlug={`portfolio/${params.slug}`} customSchema={schema}>
    <PortfolioDetailClient key={project.id} initialProject={project} />
  </PageLayout>;
}
