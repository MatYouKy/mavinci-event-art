export const dynamic = 'force-dynamic';
export const revalidate = 0;

import OfferLayout from '../OfferLayout';
import { buildMetadataForSlug } from '@/lib/seo-helpers';
import ConferencesPageClient from './ConferencesPage';

import { createSupabaseServerClient } from '@/lib/server';
import { getConferencesData } from '@/lib/conferences-data';
import CityMapEmbed from '@/components/CityMapEmbed/CityMapEmbed';
import { cookies } from 'next/headers';
import { getPublishedConferenceCities, getPublicPageMetadata } from '@/lib/SEO/publicData';
import { resolveConferenceOverviewSeo } from '@/lib/SEO/conferenceOverview';
import { SITE, ORGANIZATION_ID, WEBSITE_ID } from '@/lib/SEO/site';
import ConferenceCityLinks from '@/components/ConferenceCityLinks';
import ConferenceOverviewIntro from './sections/ConferenceOverviewIntro';

const pageSlug = 'oferta/konferencje';

export async function generateMetadata() {
  return buildMetadataForSlug(pageSlug, cookies());
}

export default async function Page() {
  const supabase = createSupabaseServerClient();
  const [conferenceData, publishedCities, metadata] = await Promise.all([
    getConferencesData(supabase), getPublishedConferenceCities(), getPublicPageMetadata(pageSlug),
  ]);
  const { hero, services, caseStudies, advantages, process, pricing, faq, gallery, portfolio, cities, serviceCategories, relatedServices, allServiceItems } = conferenceData;
  const heroData = hero ?? null;
  const publishedSlugs = new Set(publishedCities.map(city => city.locality));
  const copy = resolveConferenceOverviewSeo(metadata);
  const url = `${SITE.url}/${pageSlug}`;
  const customSchema = {
    '@context': 'https://schema.org', '@graph': [
      { '@type': 'WebPage', '@id': `${url}#webpage`, url, name: copy.title,
        description: copy.description, inLanguage: 'pl-PL', isPartOf: { '@id': WEBSITE_ID },
        about: { '@id': `${url}#service` } },
      { '@type': 'Service', '@id': `${url}#service`, url,
        name: 'Obsługa techniczna konferencji', description: copy.description,
        serviceType: 'Techniczna obsługa konferencji', provider: { '@id': ORGANIZATION_ID },
        areaServed: { '@type': 'Country', name: 'Polska' } },
    ],
  };

  return (
    <OfferLayout pageSlug={pageSlug} section="konferencje-hero" customSchema={customSchema}>
      <ConferencesPageClient
        localIntro={<ConferenceOverviewIntro showOlsztyn={publishedSlugs.has('olsztyn')} />}
        initialHeroData={heroData}
        initialServices={services ?? []}
        initialCaseStudies={caseStudies ?? []}
        initialAdvantages={advantages ?? []}
        initialProcess={process ?? []}
        initialPricing={pricing ?? []}
        initialFaq={faq ?? []}
        initialGallery={gallery ?? []}
        initialPortfolioProjects={portfolio ?? []}
        initialCities={(cities ?? []).filter((city: { slug: string }) => publishedSlugs.has(city.slug))}
        initialServiceCategories={serviceCategories ?? []}
        initialRelatedServices={relatedServices}
        initialAllServiceItems={allServiceItems ?? []}
        initialSelectedServiceIds={[...relatedServices]}
      />
      <ConferenceCityLinks cities={publishedCities} />
       <CityMapEmbed query={`Olsztyn, Polska`} />
    </OfferLayout>
  );
}   
