import { notFound } from 'next/navigation';
import { cache } from 'react';
import { getPublishedConferenceCities, getPublicPageMetadata, publicSupabase } from '@/lib/SEO/publicData';
import { SITE, ORGANIZATION_ID, WEBSITE_ID } from '@/lib/SEO/site';
import RegionalConferenceIntro from './RegionalConferenceIntro';
import { readConferenceCityContent, readConferenceCityFaqs } from '@/lib/SEO/conferenceCityContent';
import { Metadata } from 'next';
import PageLayout from '@/components/Layout/PageLayout';
import { CategoryBreadcrumb } from '@/components/CategoryBreadcrumb';
import { getUserPermissions } from '@/lib/serverAuth';
import EditableHeroSectionServer from '@/components/EditableHeroSectionServer';
import { getPolishCityCasesSmart } from '@/lib/polishCityCases';

import CityConferenceAdminClient from './CityConferenceAdminClient';
import CityConferenceContent from './CityConferenceContent';
import { TechnicalServices } from '../sections/TechnicalServices';
import { getConferencesData } from '@/lib/conferences-data';
import { AdvantagesSection } from '../sections/AdvantagesSection';
import { PortfolioProjects } from '../sections/PortfolioProjects';
import { ProcessSection } from '../sections/ProcessSection';
import { CaseStudiesSection } from '../sections/CaseStudiesSection';
import { cookies } from 'next/headers';
import { FAQSection } from '../sections/FAQ/FAQSection';
import Stats from '@/components/Stats';
import { loadCityCasesFromDb } from '@/lib/Pages/polishCityCases.server';

export const dynamic = 'force-dynamic';

const loadCityData = cache(async (slug: string) => {
  const published = await getPublishedConferenceCities();
  const city = published.find((place) => place.locality === slug);
  if (!city) return null;
  const [cityPageSeo, exceptions, { data: heroImage }] = await Promise.all([
    getPublicPageMetadata(`oferta/konferencje/${slug}`), loadCityCasesFromDb(),
    publicSupabase().from('konferencje_page_images').select('image_url')
      .eq('is_active', true).eq('section', 'hero').limit(1).maybeSingle(),
  ]);
  const cityCases = exceptions[slug] || getPolishCityCasesSmart(city.name, exceptions);
  const title = `Obsługa techniczna konferencji ${cityCases.locative_preposition || 'w'} ${cityCases.locative}`;
  const description = cityPageSeo?.description || `MAVINCI: obsługa techniczna konferencji ${cityCases.locative_preposition || 'w'} ${cityCases.locative}. Nagłośnienie Meyer Sound, LED, oświetlenie i streaming. Własne zaplecze w Olsztynie.`;
  return { city, cityCases, title, description, cityPageSeo,
    content: readConferenceCityContent(cityPageSeo?.custom_schema),
    localFaq: readConferenceCityFaqs(cityPageSeo?.custom_schema),
    metaTitle: cityPageSeo?.title || `Obsługa techniczna konferencji ${cityCases.nominative} | MAVINCI`,
    image: cityPageSeo?.og_image || heroImage?.image_url || `${SITE.url}/logo-mavinci-crm.png`,
    canonicalUrl: `${SITE.url}/oferta/konferencje/${slug}`,
    nearbyCities: published.filter(place => place.locality !== slug &&
      place.region?.toLocaleLowerCase('pl-PL') === city.region?.toLocaleLowerCase('pl-PL')).slice(0, 6)
      .map(place => ({ locality: place.locality, name: place.name })) };
});

export async function generateMetadata({ params }: { params: { miasto: string } }): Promise<Metadata> {
  const data = await loadCityData(params.miasto);
  if (!data) return { title: 'Nie znaleziono strony | MAVINCI', robots: { index: false } };
  const { metaTitle: title, description, canonicalUrl: url, image } = data;
  return { title: { absolute: title }, description, alternates: { canonical: url },
    openGraph: { type: 'website', title, description, url, siteName: SITE.name, locale: 'pl_PL',
      images: [{ url: image, alt: data.title }] },
    twitter: { card: 'summary_large_image', title, description, images: [image] } };
}

export default async function CityConferencePage({ params }: { params: { miasto: string } }) {
  const data = await loadCityData(params.miasto);
  if (!data) notFound();
  const { cityCases, image, description, title, city, canonicalUrl, nearbyCities, content, localFaq } = data;
  const pageSlug = `oferta/konferencje/${city.locality}`;
  const [{ hasWebsiteEdit }, conferenceData] = await Promise.all([
    getUserPermissions(), getConferencesData(publicSupabase()),
  ]);
  const { services, caseStudies, advantages, process, faq, portfolio } = conferenceData;
  const localQuestions = new Set(localFaq.map(item => item.question.trim().toLocaleLowerCase('pl-PL')));
  const visibleFaq = [
    ...localFaq.map((item, index) => ({ ...item, id: `city-${city.locality}-${index}` })),
    ...faq.filter((item: { id: string; question: string; answer: string }) => !localQuestions.has(item.question.trim().toLocaleLowerCase('pl-PL'))),
  ];
  const customSchema = {
    '@context': 'https://schema.org', '@graph': [
      { '@type': 'WebPage', '@id': `${canonicalUrl}#webpage`, url: canonicalUrl,
        name: title, description, inLanguage: 'pl-PL', isPartOf: { '@id': WEBSITE_ID },
        about: { '@id': `${canonicalUrl}#service` } },
      { '@type': 'Service', '@id': `${canonicalUrl}#service`, name: title,
        url: canonicalUrl, description, image, provider: { '@id': ORGANIZATION_ID },
        serviceType: 'Techniczna obsługa konferencji',
        areaServed: { '@type': 'City', name: cityCases.nominative } },
    ],
  };
  return (
    <PageLayout pageSlug={pageSlug} customSchema={customSchema} cookieStore={cookies()}>
      <main>
      <EditableHeroSectionServer
        whiteWordsCount={4}
        section="konferencje-hero"
        pageSlug={pageSlug}
        initialImageUrl={image}
        initialTitle={title}
        initialDescription={description}
      />

      <div className="left-0 top-0 min-h-screen w-full bg-[transparent]">
        <div className="mx-auto max-w-7xl px-5 pt-4 sm:px-6">
          <CategoryBreadcrumb pageSlug={pageSlug} productName={title} hideMetadataButton />
        </div>
        <CityConferenceAdminClient isAdmin={hasWebsiteEdit} pageSlug={pageSlug} cityName={cityCases.nominative} />
        <RegionalConferenceIntro citySlug={city.locality} cityName={cityCases.nominative} content={content} />
        <TechnicalServices services={services} cityCases={cityCases} />
        <AdvantagesSection advantages={advantages} />


        {portfolio.length > 0 && (
          <PortfolioProjects isEditMode={false} portfolioProjects={portfolio} />
        )}

        <Stats />
        <ProcessSection process={process} isEditingProcess={false} />

        <CaseStudiesSection caseStudies={caseStudies} />
        <FAQSection faq={visibleFaq} />

        <CityConferenceContent cityName={city.name} nearbyCities={nearbyCities} />
      </div>
      </main>
    </PageLayout>
  );
}

export async function generateStaticParams() {
  return (await getPublishedConferenceCities()).map((city) => ({ miasto: city.locality }));
}
