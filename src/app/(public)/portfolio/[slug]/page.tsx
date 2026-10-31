import { Metadata } from 'next';
import { cache } from 'react';
import { notFound, permanentRedirect } from 'next/navigation';
import PageLayout from '@/components/Layout/PageLayout';
import PortfolioDetailClient from './PortfolioDetailClient';
import { publicSupabase, getPublicPageMetadata, getPublishedConferenceCities } from '@/lib/SEO/publicData';
import { SITE, ORGANIZATION_ID } from '@/lib/SEO/site';
import ConferenceCityLinks from '@/components/ConferenceCityLinks';
import { isConferenceReference } from '@/lib/SEO/conferencePortfolio';
import { OLSZTYN_CONFERENCE_PATH, PSRWN_PROJECT_ID } from '@/lib/SEO/conferenceOverview';
import { isThemedPartyReference } from '@/lib/SEO/themedPartyContent';
import ThemedPartyOlsztynLink from '@/components/ThemedPartyOlsztynLink';
import ThemedPartyScenarioLinks from '@/components/ThemedPartyScenarioLinks';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

const loadProjectData = cache(async (slug: string) => {
  const byId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slug);
  const { data: project, error } = await publicSupabase().from('portfolio_projects').select('*')
    .eq(byId ? 'id' : 'slug', slug).maybeSingle();
  if (error) throw new Error('Nie udało się pobrać realizacji.');
  if (!project) return null;
  if (project.slug && slug !== project.slug) permanentRedirect(`/portfolio/${encodeURIComponent(project.slug)}`);
  if (project.event_city_slug && (!project.location || project.location === 'Polska')) {
    const { data: eventCity } = await publicSupabase().from('schema_org_places').select('name')
      .eq('is_global', true).eq('locality', project.event_city_slug).limit(1).maybeSingle();
    if (eventCity?.name) project.location = eventCity.name;
  }
  const metadata = await getPublicPageMetadata(`portfolio/${project.slug}`);
  return { project, metadata };
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
  const publishedCities = isConferenceReference(project) ? await getPublishedConferenceCities() : [];
  const relevantSlugs = new Set([project.event_city_slug, ...(project.reference_city_slugs || [])]);
  const referenceCities = publishedCities.filter(city => relevantSlugs.has(city.locality));
  const schema = {
    '@context': 'https://schema.org', '@type': 'Article', '@id': `${url}#article`,
    headline: project.title, description: metadata?.description || project.meta_description || project.description,
    url, mainEntityOfPage: url, inLanguage: 'pl-PL',
    image: project.image_metadata?.desktop?.src || project.image,
    datePublished: project.created_at, dateModified: project.updated_at,
    author: { '@id': ORGANIZATION_ID }, publisher: { '@id': ORGANIZATION_ID },
    ...(project.id === PSRWN_PROJECT_ID && {
      about: { '@id': `${SITE.url}${OLSZTYN_CONFERENCE_PATH}#service` },
    }),
    ...(project.location && project.location !== 'Polska' && {
      contentLocation: { '@type': 'Place', name: project.location },
    }),
  };
  return <PageLayout pageSlug={`portfolio/${params.slug}`} customSchema={schema}>
    <PortfolioDetailClient key={project.id} initialProject={project} />
    <ConferenceCityLinks cities={referenceCities} portfolio />
    {isThemedPartyReference(project) && <ThemedPartyOlsztynLink portfolio />}
    {isThemedPartyReference(project) && <ThemedPartyScenarioLinks projectId={project.id} />}
  </PageLayout>;
}
