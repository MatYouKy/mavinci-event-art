import { notFound } from 'next/navigation';
import { unstable_noStore as noStore } from 'next/cache';
import { Metadata } from 'next';
import PageLayout from '@/components/Layout/PageLayout';
import { CategoryBreadcrumb } from '@/components/CategoryBreadcrumb';
import { getSupabaseClient } from '@/lib/supabase';
import { getUserPermissions } from '@/lib/serverAuth';
import EditableHeroSectionServer from '@/components/EditableHeroSectionServer';
import { getPolishCityCasesSmart } from '@/lib/polishCityCases';

import CityConferenceAdminClient from './CityConferenceClient';
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

async function loadCityData(city: string) {
  noStore();

  const supabase = getSupabaseClient();

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

  const cityCases = getPolishCityCasesSmart(city);

  const image =
    cityPageSeo?.og_image || cityPageImage?.image_url || 'https://mavinci.pl/logo-mavinci-crm.png';

  const canonicalUrl = `https://mavinci.pl/oferta/konferencje/${city}`;

  const defaultTitle = `Obsługa Konferencji w ${cityCases.locative} - Profesjonalne Nagłośnienie i Multimedia | MAVINCI`;
  const defaultDescription = `Profesjonalna obsługa konferencji w ${cityCases.locative}: nagłośnienie, multimedia, streaming live, realizacja wideo. Kompleksowe wsparcie techniczne dla wydarzeń biznesowych w ${cityCases.locative} i okolicach.`;

  const title = defaultTitle || cityPageSeo?.title;
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
  };
}

export async function generateMetadata({
  params,
}: {
  params: { miasto: string };
}): Promise<Metadata> {
  const data = await loadCityData(params.miasto);

  if (!data) {
    return { title: 'Miasto nie znalezione - MAVINCI Event & ART' };
  }

  const { title, description, keywords, canonicalUrl, image, cityCases } = data;

  return {
    title,
    description,
    keywords,
    alternates: { canonical: canonicalUrl },
    openGraph: {
      type: 'website',
      url: canonicalUrl,
      title,
      description,
      images: [{ url: image, alt: `Obsługa konferencji w ${cityCases.locative}` }],
      siteName: 'MAVINCI Event & ART',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [image],
    },
  };
}

export default async function CityConferencePage({ params }: { params: { miasto: string } }) {
  const data = await loadCityData(params.miasto);
  if (!data) notFound();

  const { city, globalConfig, hasWebsiteEdit, image } = data;

  const cityCases = getPolishCityCasesSmart(city.name);
  const canonicalUrl = `https://mavinci.pl/oferta/konferencje/${city.locality}`;

  const defaultTitle = `Obsługa Konferencji w ${cityCases.locative} - Profesjonalne Nagłośnienie i Multimedia | MAVINCI`;
  const defaultDescription = `Profesjonalna obsługa konferencji w ${cityCases.locative}: nagłośnienie, multimedia, streaming live, realizacja wideo. Kompleksowe wsparcie techniczne dla wydarzeń biznesowych w ${cityCases.locative} i okolicach.`;

  const pageSlug = `oferta/konferencje/${city.locality}`;

  // ✅ Naprawione schema: priceRange NIE w Offer
  const customSchema = globalConfig
    ? {
        '@context': 'https://schema.org',
        '@type': 'Service',

        name: `Obsługa Konferencji w ${cityCases.locative}`,
        description:
          `Kompleksowa obsługa techniczna konferencji biznesowych w ${cityCases.locative}. ` +
          `Nagłośnienie, multimedia, streaming live, realizacja wideo oraz pełna koordynacja techniczna wydarzeń.`,

        url: canonicalUrl,
        image: image,

        provider: {
          '@type': 'LocalBusiness',
          name: globalConfig.organization_name,
          telephone: globalConfig.telephone,
          email: globalConfig.email,
          url: globalConfig.organization_url,
          logo: globalConfig.organization_logo,
          priceRange: globalConfig.price_range || '$$-$$$',

          address: {
            '@type': 'PostalAddress',
            streetAddress: globalConfig.street_address,
            addressLocality: globalConfig.locality,
            postalCode: globalConfig.postal_code,
            addressRegion: globalConfig.region,
            addressCountry: globalConfig.country,
          },

          sameAs: [
            globalConfig.facebook_url,
            globalConfig.instagram_url,
            globalConfig.linkedin_url,
            globalConfig.youtube_url,
            globalConfig.twitter_url,
          ].filter(Boolean),
        },

        areaServed: {
          '@type': 'Place',
          name: city.name,
          address: {
            '@type': 'PostalAddress',
            addressLocality: cityCases.nominative, // ✅ poprawnie
            postalCode: city.postal_code,
            addressRegion: city.region,
            addressCountry: 'PL',
          },
        },

        serviceType: 'Techniczna obsługa konferencji',

        audience: {
          '@type': 'BusinessAudience',
          audienceType: 'Firmy, instytucje, organizatorzy konferencji',
        },

        hasOfferCatalog: {
          '@type': 'OfferCatalog',
          name: 'Zakres obsługi technicznej konferencji',
          itemListElement: [
            {
              '@type': 'Offer',
              itemOffered: {
                '@type': 'Service',
                name: 'Audio i nagłośnienie konferencyjne',
                description:
                  'Profesjonalne systemy nagłośnienia dostosowane do wielkości i akustyki sali. ' +
                  'Mikrofony bezprzewodowe, miksery cyfrowe, realizator dźwięku oraz nagranie ścieżki audio eventu.',
              },
              availability: 'https://schema.org/InStock',
            },
            {
              '@type': 'Offer',
              itemOffered: {
                '@type': 'Service',
                name: 'Wideo i obraz',
                description:
                  'Wielokamerowa realizacja konferencji, projektory Full HD i 4K, ekrany projekcyjne oraz ściany LED. ' +
                  'Pełna reżyserka wideo i miks wizji na żywo.',
              },
              availability: 'https://schema.org/InStock',
            },
            {
              '@type': 'Offer',
              itemOffered: {
                '@type': 'Service',
                name: 'Oświetlenie sceniczne i konferencyjne',
                description:
                  'Profesjonalne oświetlenie LED sceny, prelegentów i publiczności. ' +
                  'Sterowanie DMX, oświetlenie dekoracyjne oraz mapping świetlny.',
              },
              availability: 'https://schema.org/InStock',
            },
            {
              '@type': 'Offer',
              itemOffered: {
                '@type': 'Service',
                name: 'Prezentacje i multimedia',
                description:
                  'Obsługa prezentacji multimedialnych, playout slajdów, przełączanie źródeł, grafika live ' +
                  'oraz wsparcie techniczne prelegentów podczas wystąpień.',
              },
              availability: 'https://schema.org/InStock',
            },
            {
              '@type': 'Offer',
              itemOffered: {
                '@type': 'Service',
                name: 'Streaming i transmisje online',
                description:
                  'Transmisje konferencji na żywo (YouTube, Zoom, Teams, Vimeo), realizacja wielokamerowa, ' +
                  'enkodery sprzętowe, backup internetu oraz postprodukcja nagrań.',
              },
              availability: 'https://schema.org/InStock',
            },
            {
              '@type': 'Offer',
              itemOffered: {
                '@type': 'Service',
                name: 'Logistyka i koordynacja techniczna',
                description:
                  'Kierownik techniczny wydarzenia, audyt i wizja lokalna sali, transport, montaż sprzętu, ' +
                  'próby techniczne, obsługa w trakcie eventu oraz demontaż.',
              },
              availability: 'https://schema.org/InStock',
            },
          ],
        },

        offers: {
          '@type': 'Offer',
          availability: 'https://schema.org/InStock',
        },
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
    <PageLayout pageSlug={pageSlug} customSchema={customSchema}>
      <EditableHeroSectionServer
        whiteWordsCount={3}
        section="konferencje-hero"
        pageSlug={pageSlug}
        initialImageUrl={image}
        initialTitle={`Obsługa Konferencji w ${cityCases.locative}`}
        initialDescription={defaultDescription}
      />

      <div className="min-h-screen bg-[#0f1119] pt-2">
        <section className="min-h-[50px] px-6">
          <div className="mx-auto min-h-[50px] max-w-7xl">
            <CategoryBreadcrumb
              pageSlug={pageSlug}
              productName={`Obsługa Konferencji w ${cityCases.locative}`}
              hideMetadataButton={false}
            />
          </div>
        </section>

        {/* ✅ tylko admin UI w kliencie */}
        <CityConferenceAdminClient
          isAdmin={hasWebsiteEdit}
          cityLocality={city.locality}
          cityName={city.name}
          defaultTitle={defaultTitle}
          defaultDescription={defaultDescription}
        />
        <TechnicalServices services={services} />
        <AdvantagesSection advantages={advantages} />

        {/* {serviceCategories.length > 0 && <DetailedServices setIsContactFormOpen={() => {}} />} */}

        {portfolio.length > 0 && (
          <PortfolioProjects isEditMode={false} portfolioProjects={portfolio} />
        )}

        {/* <ProcessSection
          process={process}
          setIsEditingProcess={() => {}}
          isEditingProcess={false}
        /> */}

        {faq.length > 0 && <CaseStudiesSection caseStudies={caseStudies} />}

        {/* {relatedServices.length > 0 && (
          <RelatedServicesSection
            isEditMode={false}
            selectedServiceIds={new Set(relatedServices.map((service) => service.id))}
            setSelectedServiceIds={() => {}}
            allServiceItems={allServiceItems}
            relatedServices={relatedServices}
          />
        )} */}

        {/* ✅ CAŁA TREŚĆ jako SERVER (Google widzi 100%) */}
        <CityConferenceContent cityName={city.name} />
        <CityMapEmbed query={`${city.name}, Polska`} />
      </div>
    </PageLayout>
  );
}

export async function generateStaticParams() {
  const supabase = getSupabaseClient();

  const { data: cities } = await supabase
    .from('schema_org_places')
    .select('locality')
    .eq('is_global', true)
    .eq('is_active', true);

  if (!cities) return [];

  return cities.map((city) => ({ miasto: city.locality }));
}
