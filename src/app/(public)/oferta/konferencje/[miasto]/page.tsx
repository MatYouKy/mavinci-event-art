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
  const metaTitle = cityPageSeo?.title || `${title} - Profesjonalne Nagłośnienie i Multimedia | MAVINCI`;

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

  const { title, description, keywords, canonicalUrl, image, cityCases, metaTitle } = data;
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

  const { cityCases, globalConfig, hasWebsiteEdit, image, description, title, city } = data;

  const canonicalUrl = `https://mavinci.pl/oferta/konferencje/${city.locality}`;

  const defaultTitle = `Profesjonalna obsługa techniczna konferencji w ${cityCases.locative} – nagłośnienie, multimedia, streaming, oświetlenie i realizacja wydarzeń biznesowych. Zapytaj o ofertę!`;

  const pageSlug = `oferta/konferencje/${city.locality}`;

  // ✅ Naprawione schema: priceRange NIE w Offer
  const customSchema = globalConfig
    ? {
        '@context': 'https://schema.org',
        '@type': 'Service',

        name: `Obsługa Konferencji ${cityCases.locative_preposition ? cityCases.locative_preposition : 'w'} ${capitalize(cityCases.locative)}`,
        description,

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
          audienceType: `Firmy, instytucje, organizatorzy konferencji ${cityCases.locative_preposition ? cityCases.locative_preposition : 'w'} ${capitalize(cityCases.locative)}`,
        },

        hasOfferCatalog: {
          '@type': 'OfferCatalog',
          name: `Zakres obsługi technicznej konferencji ${cityCases.locative_preposition ? cityCases.locative_preposition : 'w'} ${capitalize(cityCases.locative)}`,
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
