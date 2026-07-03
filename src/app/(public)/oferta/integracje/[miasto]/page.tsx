import { notFound } from 'next/navigation';
import { unstable_noStore as noStore } from 'next/cache';
import { Metadata } from 'next';
import PageLayout from '@/components/Layout/PageLayout';
import { CategoryBreadcrumb } from '@/components/CategoryBreadcrumb';
import { getUserPermissions } from '@/lib/serverAuth';
import EditableHeroSectionServer from '@/components/EditableHeroSectionServer';
import { getPolishCityCasesSmart, PolishCityCases } from '@/lib/polishCityCases';
import { loadCityCasesFromDb } from '@/lib/Pages/polishCityCases.server';
import { createSupabaseServerClient } from '@/lib/server';
import { cookies } from 'next/headers';
import Stats from '@/components/Stats';
import CityMapEmbed from '@/components/CityMapEmbed/CityMapEmbed';

import IntegrationsCityAdminClient from './IntegrationsCityAdminClient';
import IntegrationsCityIntro from './IntegrationsCityIntro';
import IntegrationsCityServices from './IntegrationsCityServices';
import IntegrationsCityBenefits from './IntegrationsCityBenefits';
import IntegrationsCityTypes from './IntegrationsCityTypes';
import IntegrationsCityGallery from './IntegrationsCityGallery';
import IntegrationsCityProcess from './IntegrationsCityProcess';
import IntegrationsCityFAQ from './IntegrationsCityFAQ';
import IntegrationsCityCTA from './IntegrationsCityCTA';

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

  let heroImage: { image_url: string } | null = null;
  try {
    const { data } = await supabase
      .from('integracje_page_images')
      .select('image_url')
      .eq('is_active', true)
      .eq('section', 'hero')
      .maybeSingle();
    heroImage = data;
  } catch {
    /* table may not exist yet */
  }

  const { hasWebsiteEdit } = await getUserPermissions();

  const { data: globalConfig } = await supabase.from('schema_org_global').select('*').single();

  const { data: cityPageSeo } = await supabase
    .from('schema_org_page_metadata')
    .select('*')
    .eq('page_slug', `oferta/integracje/${city}`)
    .maybeSingle();

  let cityContent: any = null;

  try {
    const { data: cc } = await supabase
      .from('integrations_city_content')
      .select('*')
      .eq('city_slug', city)
      .eq('is_active', true)
      .maybeSingle();
    cityContent = cc;
  } catch {
    /* table may not exist yet */
  }

  const EXCEPTIONS: Record<string, PolishCityCases> = await loadCityCasesFromDb();
  const cityCases = getPolishCityCasesSmart(city, EXCEPTIONS);

  // Fetch shared integrations data (types + gallery from main page)
  let sharedTypes: any[] = [];
  let sharedGallery: any[] = [];
  try {
    const { data: sharedData } = await supabase
      .from('site_images')
      .select('*')
      .eq('section', 'integrations')
      .eq('is_active', true)
      .order('order_index');

    if (sharedData && sharedData.length > 0) {
      const typesRow = sharedData.find((r: any) => r.name === 'types');
      if (typesRow?.image_metadata?.items && Array.isArray(typesRow.image_metadata.items)) {
        sharedTypes = typesRow.image_metadata.items;
      }

      const galleryRows = sharedData
        .filter((r: any) => r.name?.startsWith('gallery-'))
        .sort((a: any, b: any) => (a.order_index || 0) - (b.order_index || 0));

      if (galleryRows.length > 0) {
        sharedGallery = galleryRows.map((r: any) => ({
          id: r.id,
          image_url: r.desktop_url || '',
          alt_text: r.alt_text || '',
          caption: r.image_metadata?.caption || '',
        }));
      }
    }
  } catch {
    /* site_images may not have integrations data yet */
  }

  const image =
    cityContent?.hero_image_url ||
    cityPageSeo?.og_image ||
    heroImage?.image_url ||
    'https://mavinci.pl/logo-mavinci-crm.png';

  const canonicalUrl = `https://mavinci.pl/oferta/integracje/${city}`;
  const prep = cityCases.locative_preposition || 'w';

  const defaultTitle = `Integracje firmowe ${prep} ${capitalize(cityCases.locative)}`;
  const defaultDescription = `Organizacja integracji firmowych ${prep} ${capitalize(cityCases.locative)}. Team building, gry terenowe, integracje outdoor i indoor, scenariusze fabularne. Profesjonalni animatorzy, kompleksowa obsluga eventow dla zespolow 10-500+ osob.`;

  const metaTitle =
    cityContent?.seo_title ||
    cityPageSeo?.title ||
    `${defaultTitle} - Team Building dla Firm | MAVINCI`;

  const description =
    cityContent?.seo_description || cityPageSeo?.description || defaultDescription;

  const keywords =
    cityContent?.seo_keywords?.join(', ') ||
    (cityPageSeo?.keywords as string[] | null)?.join(', ') ||
    `integracje firmowe ${cityCases.nominative}, team building ${cityCases.locative}, gry terenowe ${cityCases.locative}, integracja outdoor ${cityCases.locative}, event integracyjny ${cityCases.locative}`;

  return {
    city: cityData,
    globalConfig,
    hasWebsiteEdit,
    image,
    canonicalUrl,
    title: defaultTitle,
    description,
    keywords,
    cityCases,
    metaTitle,
    cityContent,
    sharedTypes,
    sharedGallery,
    cityPageSeo,
  };
}

export async function generateMetadata({
  params,
}: {
  params: { miasto: string };
}): Promise<Metadata> {
  const data = await loadCityData(params.miasto);

  if (!data) {
    return { title: 'Integracje Firmowe - MAVINCI Event & ART' };
  }

  const { description, keywords, canonicalUrl, image, cityCases, metaTitle } = data;

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
      images: [{ url: image, alt: `Integracje firmowe ${cityCases.locative}` }],
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

export default async function IntegrationsCityPage({ params }: { params: { miasto: string } }) {
  const data = await loadCityData(params.miasto);
  if (!data) notFound();

  const {
    cityCases,
    globalConfig,
    hasWebsiteEdit,
    image,
    description,
    title,
    city,
    cityContent,
    sharedTypes,
    sharedGallery,
    cityPageSeo,
  } = data;

  const canonicalUrl = `https://mavinci.pl/oferta/integracje/${city.locality}`;
  const pageSlug = `oferta/integracje/${city.locality}`;
  const prep = cityCases.locative_preposition || 'w';

  const schemaConfig = cityPageSeo?.custom_schema || {};

  const schemaOffers =
    Array.isArray(schemaConfig.offers) && schemaConfig.offers.length > 0
      ? schemaConfig.offers
      : [
          {
            name: 'Gry terenowe i fabularne',
            description:
              'Scenariusze integracyjne z fabułą, zadaniami zespołowymi, zagadkami i rywalizacją w terenie.',
          },
          {
            name: 'Integracje outdoor',
            description:
              'Plenerowe integracje firmowe, olimpiady zespołowe, aktywności terenowe i programy team buildingowe.',
          },
          {
            name: 'Integracje indoor',
            description:
              'Integracje w hotelach, salach konferencyjnych i przestrzeniach eventowych: quizy, gry zespołowe, warsztaty i animacje.',
          },
          {
            name: 'Team building dla firm',
            description:
              'Programy wzmacniające współpracę, komunikację, zaangażowanie i relacje w zespole.',
          },
          {
            name: 'Wieczory firmowe z programem',
            description:
              'Kompleksowa organizacja wieczorów integracyjnych z prowadzeniem, konkursami, oprawą techniczną i atrakcjami.',
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
            name: `Integracje firmowe ${prep} ${capitalize(cityCases.locative)}`,
            description,
            url: canonicalUrl,
            image,
            serviceType:
              schemaConfig.serviceType || 'Integracje firmowe, team building i eventy integracyjne',
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
                `Firmy, działy HR, korporacje, agencje eventowe i organizatorzy integracji ${prep} ${capitalize(
                  cityCases.locative,
                )}`,
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
            name: `Integracje firmowe i team building ${prep} ${capitalize(cityCases.locative)}`,
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

  return (
    <PageLayout pageSlug={pageSlug} customSchema={customSchema} cookieStore={cookies()}>
      <EditableHeroSectionServer
        whiteWordsCount={2}
        section="integracje-hero"
        pageSlug={pageSlug}
        initialImageUrl={image}
        initialTitle={cityContent?.hero_title || title}
        initialDescription={cityContent?.hero_description || description}
      />

      <div className="left-0 top-0 min-h-screen w-full bg-transparent">
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

        <IntegrationsCityAdminClient
          isAdmin={hasWebsiteEdit}
          cityLocality={city.locality}
          cityName={cityCases.nominative}
          defaultTitle={title}
          defaultDescription={description}
        />

        <IntegrationsCityIntro cityCases={cityCases} content={cityContent} />

        <IntegrationsCityServices cityCases={cityCases} content={cityContent} />

        <IntegrationsCityBenefits cityCases={cityCases} content={cityContent} />

        {sharedTypes.length > 0 && (
          <IntegrationsCityTypes types={sharedTypes} cityCases={cityCases} />
        )}

        {sharedGallery.length > 0 && (
          <IntegrationsCityGallery images={sharedGallery} cityCases={cityCases} />
        )}

        <IntegrationsCityProcess cityCases={cityCases} content={cityContent} />

        <IntegrationsCityFAQ cityCases={cityCases} content={cityContent} />

        <CityMapEmbed query={`${cityCases.nominative}, Polska`} />

        <IntegrationsCityCTA cityCases={cityCases} content={cityContent} />
      </div>
    </PageLayout>
  );
}

export async function generateStaticParams() {
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
