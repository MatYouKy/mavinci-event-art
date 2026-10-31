import { notFound } from 'next/navigation';
import { cache } from 'react';
import { getPublishedConferenceCities, getPublicPageMetadata, publicSupabase } from '@/lib/SEO/publicData';
import { SITE, ORGANIZATION_ID, WEBSITE_ID } from '@/lib/SEO/site';
import ConferenceCityDetails from './ConferenceCityDetails';
import ConferenceCityHero from './ConferenceCityHero';
import ConferenceServiceArea from './ConferenceServiceArea';
import RegionalConferenceIntro from './RegionalConferenceIntro';
import { resolveConferenceCityContent, readConferenceCityFaqs, getConferenceLocalProfile } from '@/lib/SEO/conferenceCityContent';
import { Metadata } from 'next';
import PageLayout from '@/components/Layout/PageLayout';
import { ServerBreadcrumb } from '@/components/Layout/ServerBreadcrumb';
import { getUserPermissions } from '@/lib/serverAuth';
import { getPolishCityCasesSmart } from '@/lib/polishCityCases';

import CityConferenceAdminClient from './CityConferenceAdminClient';
import CityConferenceContent from './CityConferenceContent';
import { TechnicalServices } from '../sections/TechnicalServices';
import { getConferenceCityData } from '@/lib/conferences-data';
import { AdvantagesSection } from '../sections/AdvantagesSection';
import { PortfolioProjects } from '../sections/PortfolioProjects';
import { ConferenceProcessSection } from '../sections/ConferenceProcessSection';
import { CaseStudiesSection } from '../sections/CaseStudiesSection';
import { cookies } from 'next/headers';
import { FAQSection } from '../sections/FAQ/FAQSection';
import Stats from '@/components/Stats';
import { loadCityCasesFromDb } from '@/lib/Pages/polishCityCases.server';

export const dynamic = 'force-dynamic';

// The head, schema and visible offer share one request-scoped server snapshot.
const loadCityData = cache(async (slug: string) => {
  const published = await getPublishedConferenceCities();
  const city = published.find((place) => place.locality === slug);
  if (!city) return null;
  const [cityPageSeo, exceptions, { data: heroImage }, { data: cityHero }, conferenceData] = await Promise.all([
    getPublicPageMetadata(`oferta/konferencje/${slug}`), loadCityCasesFromDb(),
    publicSupabase().from('konferencje_page_images').select('*')
      .eq('is_active', true).eq('section', 'hero').limit(1).maybeSingle(),
    publicSupabase().from('service_hero_images').select('*')
      .eq('page_slug', `oferta/konferencje/${slug}`).eq('is_active', true).maybeSingle(),
    getConferenceCityData(publicSupabase(), slug),
  ]);
  const cityCases = exceptions[slug] || getPolishCityCasesSmart(city.name, exceptions);
  const title = cityHero?.title?.trim() || `Obsługa techniczna konferencji ${cityCases.locative_preposition || 'w'} ${cityCases.locative}`;
  const description = cityPageSeo?.description || `MAVINCI: obsługa techniczna konferencji ${cityCases.locative_preposition || 'w'} ${cityCases.locative}. Nagłośnienie Meyer Sound, LED, oświetlenie i streaming. Własne zaplecze w Olsztynie.`;
  const preferredCities = getConferenceLocalProfile(slug)?.nearbyCitySlugs || [];
  const regionalCities = published.filter(place => place.locality !== slug &&
    place.region?.toLocaleLowerCase('pl-PL') === city.region?.toLocaleLowerCase('pl-PL'));
  const nearbyCities = [...regionalCities].sort((a, b) => {
    const aIndex = preferredCities.indexOf(a.locality);
    const bIndex = preferredCities.indexOf(b.locality);
    return (aIndex < 0 ? preferredCities.length : aIndex) - (bIndex < 0 ? preferredCities.length : bIndex);
  }).slice(0, 6).map(place => ({ locality: place.locality, name: place.name }));
  return { city, cityCases, title, description, cityPageSeo, conferenceData,
    cityNames: Object.fromEntries(published.map(place => [place.locality, place.name])),
    content: resolveConferenceCityContent(cityPageSeo?.custom_schema, city.name, slug),
    heroSettings: cityHero || {},
    lead: cityHero?.description?.trim() || `Nagłośnienie Meyer Sound, ekrany LED, światło i streaming konferencji ${cityCases.locative_preposition || 'w'} ${cityCases.locative}. Dobieramy technikę do programu i sali, organizujemy transport, montaż oraz pracę realizatorów. Obsługujemy konferencje stacjonarne, hybrydowe i połączone z galą.`,
    localFaq: readConferenceCityFaqs(cityPageSeo?.custom_schema),
    metaTitle: cityPageSeo?.title || `Obsługa techniczna konferencji ${cityCases.nominative} | MAVINCI`,
    image: cityHero?.image_url || heroImage?.image_url || `${SITE.url}/logo-mavinci-crm.png`,
    canonicalUrl: `${SITE.url}/oferta/konferencje/${slug}`,
    nearbyCities };
});

export async function generateMetadata({ params }: { params: { miasto: string } }): Promise<Metadata> {
  const data = await loadCityData(params.miasto);
  if (!data) return { title: 'Nie znaleziono strony | MAVINCI', robots: { index: false } };
  const { metaTitle: title, description, canonicalUrl: url } = data;
  const image = data.cityPageSeo?.og_image || data.image;
  return { title: { absolute: title }, description, alternates: { canonical: url },
    openGraph: { type: 'website', title, description, url, siteName: SITE.name, locale: 'pl_PL',
      images: [{ url: image, alt: data.title }] },
    twitter: { card: 'summary_large_image', title, description, images: [image] } };
}

export default async function CityConferencePage({ params }: { params: { miasto: string } }) {
  const [data, { hasWebsiteEdit }] = await Promise.all([
    loadCityData(params.miasto), getUserPermissions(),
  ]);
  if (!data) notFound();
  const { cityCases, image, description, title, city, canonicalUrl, nearbyCities, content, localFaq, heroSettings, lead } = data;
  const pageSlug = `oferta/konferencje/${city.locality}`;
  const { services, caseStudies, advantages, process, faq, portfolio } = data.conferenceData;
  const localQuestions = new Set(localFaq.map(item => item.question.trim().toLocaleLowerCase('pl-PL')));
  const commonFaq = faq.filter((item: { question: string }) => !localQuestions.has(item.question.trim().toLocaleLowerCase('pl-PL')));
  const visibleFaq = [
    ...localFaq.map((item, index) => ({ ...item, id: `city-${city.locality}-${index}` })),
    // The local offer already explains pricing, equipment and logistics in detail.
    ...(content.benefits?.length && localFaq.length >= 4 ? commonFaq.slice(0, 3) : commonFaq),
  ];
  const customSchema = {
    '@context': 'https://schema.org', '@graph': [
      { '@type': 'WebPage', '@id': `${canonicalUrl}#webpage`, url: canonicalUrl,
        name: title, description, inLanguage: 'pl-PL', isPartOf: { '@id': WEBSITE_ID },
        about: { '@id': `${canonicalUrl}#service` } },
      { '@type': 'Service', '@id': `${canonicalUrl}#service`, name: title,
        url: canonicalUrl, description, image, provider: { '@id': ORGANIZATION_ID },
        serviceType: 'Techniczna obsługa konferencji',
        areaServed: { '@type': 'City', name: cityCases.nominative },
        ...(portfolio.length > 0 && { subjectOf: portfolio.filter((project: { slug?: string }) => project.slug).map((project: { slug?: string }) => ({ '@id': `${SITE.url}/portfolio/${project.slug}#article` })) }) },
    ],
  };
  return (
    <PageLayout pageSlug={pageSlug} customSchema={customSchema} cookieStore={cookies()} breadcrumbLabels={{ [city.locality]: city.name }}>
      <main>
      <ConferenceCityHero pageSlug={pageSlug} cityName={city.name} title={title} lead={lead}
        cityForms={[cityCases.nominative, cityCases.genitive, cityCases.locative]}
        image={image} settings={heroSettings} canEdit={hasWebsiteEdit} />

      <div className="left-0 top-0 min-h-screen w-full bg-[transparent]">
        <div className="mx-auto max-w-7xl px-5 pt-4 sm:px-6">
          <ServerBreadcrumb pageSlug={pageSlug} labels={{ [city.locality]: city.name }} />
        </div>
        {hasWebsiteEdit && <CityConferenceAdminClient isAdmin pageSlug={pageSlug} cityName={cityCases.nominative} />}
        <RegionalConferenceIntro citySlug={city.locality} cityName={cityCases.nominative} content={content} />
        <ConferenceCityDetails content={content} cityName={city.name} />
        <TechnicalServices services={services} cityCases={cityCases} showEditor={hasWebsiteEdit} />
        {!content.benefits?.length && <AdvantagesSection advantages={advantages} />}


        {portfolio.length > 0 && (
          <PortfolioProjects isEditMode={false} portfolioProjects={portfolio} cityName={city.name} cityNames={data.cityNames} />
        )}

        <ConferenceServiceArea citySlug={city.locality} cityName={city.name} region={city.region} content={content} nearbyCities={nearbyCities} />

        <Stats />
        <ConferenceProcessSection process={process} />

        <CaseStudiesSection caseStudies={caseStudies} />
        <FAQSection faq={visibleFaq} title={`${city.name} — pytania o obsługę konferencji`} />

        <CityConferenceContent citySlug={city.locality} cityName={city.name} nearbyCities={[]} />
      </div>
      </main>
    </PageLayout>
  );
}

export async function generateStaticParams() {
  return (await getPublishedConferenceCities()).map((city) => ({ miasto: city.locality }));
}
