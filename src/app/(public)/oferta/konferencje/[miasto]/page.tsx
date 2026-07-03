import { notFound } from 'next/navigation';
import { unstable_noStore as noStore } from 'next/cache';
import { Metadata } from 'next';
import PageLayout from '@/components/Layout/PageLayout';
import { CategoryBreadcrumb } from '@/components/CategoryBreadcrumb';
import { getUserPermissions } from '@/lib/serverAuth';
import EditableHeroSectionServer from '@/components/EditableHeroSectionServer';
import { getPolishCityCasesSmart, PolishCityCases } from '@/lib/polishCityCases';

import CityConferenceAdminClient from './CityConferenceAdminClient';
import CityConferenceContent from './CityConferenceContent';
// import CityLocalIntroServer from './CityLocalIntroServer';
import CityMapEmbed from '@/components/CityMapEmbed/CityMapEmbed';
import { TechnicalServices } from '../sections/TechnicalServices';
import { getConferencesData } from '@/lib/conferences-data';
import { createSupabaseServerClient } from '@/lib/server';
import { AdvantagesSection } from '../sections/AdvantagesSection';
import { DetailedServices } from '../sections/DetailedServices';
import { PortfolioProjects } from '../sections/PortfolioProjects';
import { ProcessSection } from '../sections/ProcessSection';
import { CaseStudiesSection } from '../sections/CaseStudiesSection';
import { RelatedServicesSection } from '../sections/RelatedServicesSection';
import { cookies } from 'next/headers';
import { FAQSection } from '../sections/FAQ/FAQSection';
import Stats from '@/components/Stats';
import { loadCityCasesFromDb } from '@/lib/Pages/polishCityCases.server';

function capitalize(value: string) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

async function loadCityData(city: string) {
  noStore();

  const supabase = createSupabaseServerClient();

  const { data: cityData, error: cityError } = await supabase
    .from('schema_org_places')
    .select('*')
    .eq('locality', city)
    .eq('is_global', true)
    .eq('is_active', true)
    .maybeSingle();

  if (!cityData || cityError) return null;

  const { data: cityPageImage } = await supabase
    .from('konferencje_page_images')
    .select('image_url')
    .eq('is_active', true)
    .eq('section', 'hero')
    .maybeSingle();

  const { hasWebsiteEdit } = await getUserPermissions();

  const { data: globalConfig } = await supabase.from('schema_org_global').select('*').single();

  const { data: cityPageSeo, error: cityPageSeoError } = await supabase
    .from('schema_org_page_metadata')
    .select('*')
    .eq('page_slug', `oferta/konferencje/${city}`)
    .maybeSingle();

  if (cityPageSeoError) console.error('SSR SEO error:', cityPageSeoError);

  const EXCEPTIONS: Record<string, PolishCityCases> = await loadCityCasesFromDb();

  const cityCases = getPolishCityCasesSmart(city, EXCEPTIONS);

  const image =
    cityPageSeo?.og_image || cityPageImage?.image_url || 'https://mavinci.pl/logo-mavinci-crm.png';

  const canonicalUrl = `https://mavinci.pl/oferta/konferencje/${city}`;

  const defaultTitle = `Obsługa Konferencji ${cityCases.locative_preposition ? cityCases.locative_preposition : 'w'} ${capitalize(cityCases.locative)}`;

  const defaultDescription = `Profesjonalna obsługa konferencji ${cityCases.locative_preposition ? cityCases.locative_preposition : 'w'} ${capitalize(cityCases.locative)}: nagłośnienie, multimedia, streaming live, realizacja wideo. Kompleksowe wsparcie techniczne dla wydarzeń biznesowych ${cityCases.locative_preposition ? cityCases.locative_preposition : 'w'} ${capitalize(cityCases.locative)} i okolicach.`;

  const title = defaultTitle;
  const metaTitle =
    cityPageSeo?.title || `${title} - Profesjonalne Nagłośnienie i Multimedia | MAVINCI`;

  const description = defaultDescription || cityPageSeo?.seo_description;
  const keywords =
    cityPageSeo?.seo_keywords ||
    `obsługa konferencji ${cityCases.nominative}, nagłośnienie konferencyjne w ${cityCases.locative}, technika av ${cityCases.locative}, streaming konferencji w ${cityCases.locative}`;

  return {
    city: cityData,
    globalConfig,
    hasWebsiteEdit,
    image,
    canonicalUrl,
    title,
    description,
    keywords,
    cityCases,
    metaTitle,
    cityPageSeo,
    customSchema: cityPageSeo?.custom_schema || {},
  };
}

export async function generateMetadata({
  params,
}: {
  params: { miasto: string };
}): Promise<Metadata> {
  const data = await loadCityData(params.miasto);

  if (!data) {
    return { title: 'Obsługa Konferencji - MAVINCI Event & ART' };
  }

  const { title, description, keywords, canonicalUrl, image, cityCases, metaTitle, cityPageSeo } =
    data;
  // const metaTitle = `${title} - Profesjonalne Nagłośnienie i Multimedia | MAVINCI`;

  return {
    title: metaTitle,
    description,
    keywords,
    alternates: { canonical: canonicalUrl },
    openGraph: {
      type: 'website',
      url: canonicalUrl,
      title: metaTitle,
      description,
      images: [{ url: image, alt: `Obsługa konferencji   ${cityCases.locative}` }],
      siteName: 'MAVINCI Event & ART',
    },
    twitter: {
      card: 'summary_large_image',
      title: metaTitle,
      description,
      images: [image],
    },
  };
}

export default async function CityConferencePage({ params }: { params: { miasto: string } }) {
  const data = await loadCityData(params.miasto);
  if (!data) notFound();

  const { cityCases, globalConfig, hasWebsiteEdit, image, description, title, city, cityPageSeo } =
    data;

  const canonicalUrl = `https://mavinci.pl/oferta/konferencje/${city.locality}`;

  const defaultTitle = `Profesjonalna obsługa techniczna konferencji w ${cityCases.locative} – nagłośnienie, multimedia, streaming, oświetlenie i realizacja wydarzeń biznesowych. Zapytaj o ofertę!`;

  const pageSlug = `oferta/konferencje/${city.locality}`;

  const schemaConfig = cityPageSeo?.custom_schema || {};

  const schemaOffers =
    Array.isArray(schemaConfig.offers) && schemaConfig.offers.length > 0
      ? schemaConfig.offers
      : [
          {
            name: 'Nagłośnienie konferencyjne',
            description:
              'Profesjonalne systemy nagłośnienia konferencyjnego, mikrofony bezprzewodowe, mikrofony nagłowne, miksery cyfrowe oraz realizacja dźwięku podczas wydarzeń biznesowych.',
          },
          {
            name: 'Multimedia i prezentacje',
            description:
              'Obsługa prezentacji, ekranów, projektorów, telewizorów, przełączanie źródeł obrazu oraz wsparcie techniczne dla prelegentów.',
          },
          {
            name: 'Streaming i transmisje online',
            description:
              'Realizacja transmisji konferencji na żywo, streaming na YouTube, Zoom, Teams lub Vimeo, realizacja wielokamerowa i nagrywanie wydarzenia.',
          },
          {
            name: 'Realizacja wideo',
            description:
              'Obsługa kamer, reżyserka wizji, miks obrazu na żywo, nagrania konferencji oraz przygotowanie materiałów po wydarzeniu.',
          },
          {
            name: 'Oświetlenie konferencyjne',
            description:
              'Oświetlenie sceny, prelegentów, strefy wystąpień oraz dekoracyjne oświetlenie przestrzeni konferencyjnej.',
          },
          {
            name: 'Koordynacja techniczna konferencji',
            description:
              'Pełna obsługa techniczna wydarzenia: planowanie, montaż, próby techniczne, realizacja, nadzór techniczny i demontaż.',
          },
        ];

  const schemaFaq =
    Array.isArray(schemaConfig.faq) && schemaConfig.faq.length > 0
      ? schemaConfig.faq.filter((item: any) => item.question && item.answer)
      : [];

  const customSchema = globalConfig
    ? {
        '@context': 'https://schema.org',
        '@graph': [
          {
            '@type': 'WebPage',
            '@id': `${canonicalUrl}#webpage`,
            url: canonicalUrl,
            name: cityPageSeo?.title || title,
            description,
            inLanguage: 'pl-PL',
            isPartOf: {
              '@type': 'WebSite',
              '@id': 'https://mavinci.pl/#website',
              name: 'MAVINCI Event & ART',
              url: 'https://mavinci.pl',
            },
            about: {
              '@id': `${canonicalUrl}#service`,
            },
          },
          {
            '@type': 'LocalBusiness',
            '@id': 'https://mavinci.pl/#organization',
            name: globalConfig.organization_name,
            url: globalConfig.organization_url,
            logo: globalConfig.organization_logo,
            image,
            telephone: globalConfig.telephone,
            email: globalConfig.email,
            priceRange: schemaConfig.priceRange || globalConfig.price_range || '$$-$$$',
            address: {
              '@type': 'PostalAddress',
              streetAddress: globalConfig.street_address,
              addressLocality: globalConfig.locality,
              postalCode: globalConfig.postal_code,
              addressRegion: globalConfig.region,
              addressCountry: globalConfig.country || 'PL',
            },
            sameAs: [
              globalConfig.facebook_url,
              globalConfig.instagram_url,
              globalConfig.linkedin_url,
              globalConfig.youtube_url,
              globalConfig.twitter_url,
            ].filter(Boolean),
          },
          {
            '@type': 'Service',
            '@id': `${canonicalUrl}#service`,
            name: `Obsługa konferencji ${
              cityCases.locative_preposition || 'w'
            } ${capitalize(cityCases.locative)}`,
            description,
            url: canonicalUrl,
            image,
            serviceType:
              schemaConfig.serviceType || 'Techniczna obsługa konferencji i wydarzeń biznesowych',
            provider: {
              '@id': 'https://mavinci.pl/#organization',
            },
            areaServed: {
              '@type': 'Place',
              name: cityCases.nominative,
              address: {
                '@type': 'PostalAddress',
                addressLocality: cityCases.nominative,
                postalCode: city.postal_code,
                addressRegion: city.region,
                addressCountry: 'PL',
              },
            },
            audience: {
              '@type': 'BusinessAudience',
              audienceType:
                schemaConfig.audienceType ||
                `Firmy, instytucje, agencje eventowe i organizatorzy konferencji ${
                  cityCases.locative_preposition || 'w'
                } ${capitalize(cityCases.locative)}`,
            },
            hasOfferCatalog: {
              '@id': `${canonicalUrl}#offer-catalog`,
            },
            offers: {
              '@type': 'Offer',
              availability: 'https://schema.org/InStock',
            },
          },
          {
            '@type': 'OfferCatalog',
            '@id': `${canonicalUrl}#offer-catalog`,
            name: `Zakres obsługi konferencji ${
              cityCases.locative_preposition || 'w'
            } ${capitalize(cityCases.locative)}`,
            itemListElement: schemaOffers.map((offer: any) => ({
              '@type': 'Offer',
              availability: 'https://schema.org/InStock',
              itemOffered: {
                '@type': 'Service',
                name: offer.name,
                description: offer.description,
                areaServed: {
                  '@type': 'Place',
                  name: cityCases.nominative,
                },
                provider: {
                  '@id': 'https://mavinci.pl/#organization',
                },
              },
            })),
          },
          ...(schemaFaq.length > 0
            ? [
                {
                  '@type': 'FAQPage',
                  '@id': `${canonicalUrl}#faq`,
                  mainEntity: schemaFaq.map((item: any) => ({
                    '@type': 'Question',
                    name: item.question,
                    acceptedAnswer: {
                      '@type': 'Answer',
                      text: item.answer,
                    },
                  })),
                },
              ]
            : []),
        ],
      }
    : undefined;

  const supabase = createSupabaseServerClient();

  const {
    hero,
    services,
    caseStudies,
    advantages,
    process,
    pricing,
    faq,
    gallery,
    portfolio,
    cities,
    serviceCategories,
    relatedServices,
    allServiceItems,
  } = await getConferencesData(supabase);

  return (
    <PageLayout pageSlug={pageSlug} customSchema={customSchema} cookieStore={cookies()}>
      <EditableHeroSectionServer
        whiteWordsCount={3}
        section="konferencje-hero"
        pageSlug={pageSlug}
        initialImageUrl={image}
        initialTitle={title}
        initialDescription={description}
      />

      <div className="left-0 top-0 min-h-screen w-full bg-[transparent]">
        <section className="relative min-h-[50px]">
          <div className="absolute left-0 top-0 z-10 w-full border-b border-[#d3bb73]/20">
            <div className="mx-auto min-h-[50px] max-w-7xl px-6">
              <CategoryBreadcrumb
                pageSlug={pageSlug}
                productName={title}
                hideMetadataButton={false}
              />
            </div>
          </div>
          <Stats />
        </section>

        {/* ✅ tylko admin UI w kliencie */}
        <CityConferenceAdminClient
          isAdmin={hasWebsiteEdit}
          cityLocality={cityCases.locative}
          cityName={cityCases.nominative}
          defaultTitle={title}
          defaultDescription={description}
        />
        <TechnicalServices services={services} cityCases={cityCases} />
        <AdvantagesSection advantages={advantages} />

        {serviceCategories.length > 0 && <DetailedServices />}

        {portfolio.length > 0 && (
          <PortfolioProjects isEditMode={false} portfolioProjects={portfolio} />
        )}

        <ProcessSection process={process} isEditingProcess={false} />

        <CaseStudiesSection caseStudies={caseStudies} />
        <FAQSection faq={faq} />

        {relatedServices.length > 0 && (
          <RelatedServicesSection
            isEditMode={false}
            allServiceItems={allServiceItems}
            relatedServices={relatedServices}
            cityCases={cityCases}
          />
        )}

        {/* ✅ CAŁA TREŚĆ jako SERVER (Google widzi 100%) */}
        <CityMapEmbed query={`${cityCases.nominative}, Polska`} />
        <CityConferenceContent cityName={city.name} />
      </div>
    </PageLayout>
  );
}

export async function generateStaticParams() {
  // Use admin client for build-time static generation (no cookies available)
  const { createSupabaseAdminClient } = await import('@/lib/supabase/admin.server');
  const supabase = createSupabaseAdminClient();

  const { data: cities } = await supabase
    .from('schema_org_places')
    .select('locality')
    .eq('is_global', true)
    .eq('is_active', true);

  if (!cities) return [];

  return cities.map((city) => ({ miasto: city.locality }));
}
