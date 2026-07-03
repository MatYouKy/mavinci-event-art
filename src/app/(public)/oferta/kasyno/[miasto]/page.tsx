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

import CasinoCityAdminClient from './CasinoCityAdminClient';
import CasinoCityServices from './CasinoCityServices';
import CasinoCityEquipment from './CasinoCityEquipment';
import CasinoCityBenefits from './CasinoCityBenefits';
import CasinoCityGallery from './CasinoCityGallery';
import CasinoCityProcess from './CasinoCityProcess';
import CasinoCityFAQ from './CasinoCityFAQ';
import CasinoCityCTA from './CasinoCityCTA';
import CasinoCityIntro from './CasinoCityIntro';

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
      .from('casino_page_images')
      .select('image_url')
      .eq('is_active', true)
      .eq('section', 'hero')
      .maybeSingle();
    heroImage = data;
  } catch { /* table may not exist yet */ }

  const { hasWebsiteEdit } = await getUserPermissions();

  const { data: globalConfig } = await supabase.from('schema_org_global').select('*').single();

  const { data: cityPageSeo } = await supabase
    .from('schema_org_page_metadata')
    .select('*')
    .eq('page_slug', `oferta/kasyno/${city}`)
    .maybeSingle();

  let cityContent: any = null;
  let gallery: any[] = [];

  try {
    const { data: cc } = await supabase
      .from('casino_city_content')
      .select('*')
      .eq('city_slug', city)
      .eq('is_active', true)
      .maybeSingle();
    cityContent = cc;
  } catch { /* table may not exist yet */ }

  try {
    const { data: gal } = await supabase
      .from('casino_city_gallery')
      .select('*')
      .eq('city_slug', city)
      .eq('is_active', true)
      .order('display_order');
    gallery = gal || [];
  } catch { /* table may not exist yet */ }

  const EXCEPTIONS: Record<string, PolishCityCases> = await loadCityCasesFromDb();
  const cityCases = getPolishCityCasesSmart(city, EXCEPTIONS);

  const image =
    cityContent?.hero_image_url ||
    cityPageSeo?.og_image ||
    heroImage?.image_url ||
    'https://mavinci.pl/logo-mavinci-crm.png';

  const canonicalUrl = `https://mavinci.pl/oferta/kasyno/${city}`;
  const prep = cityCases.locative_preposition || 'w';

  const defaultTitle = `Kasyno rozrywkowe ${prep} ${capitalize(cityCases.locative)}`;
  const defaultDescription = `Profesjonalne kasyno rozrywkowe na eventy ${prep} ${capitalize(cityCases.locative)}. Stoły do ruletki, blackjacka, pokera, koło fortuny. Doświadczeni krupierzy, kompletna oprawa Las Vegas, personalizacja pod firmę.`;

  const metaTitle =
    cityContent?.seo_title ||
    cityPageSeo?.title ||
    `${defaultTitle} - Eventy Kasynowe | MAVINCI`;

  const description =
    cityContent?.seo_description || cityPageSeo?.description || defaultDescription;

  const keywords =
    cityContent?.seo_keywords?.join(', ') ||
    (cityPageSeo?.keywords as string[] | null)?.join(', ') ||
    `kasyno rozrywkowe ${cityCases.nominative}, kasyno na event ${cityCases.locative}, ruletka ${cityCases.locative}, blackjack ${cityCases.locative}, poker ${cityCases.locative}, krupier ${cityCases.locative}, impreza kasynowa ${cityCases.locative}`;

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
    cityPageSeo,
    gallery: gallery || [],
  };
}

export async function generateMetadata({
  params,
}: {
  params: { miasto: string };
}): Promise<Metadata> {
  const data = await loadCityData(params.miasto);

  if (!data) {
    return { title: 'Kasyno Rozrywkowe - MAVINCI Event & ART' };
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
      images: [{ url: image, alt: `Kasyno rozrywkowe ${cityCases.locative}` }],
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

export default async function CasinoCityPage({ params }: { params: { miasto: string } }) {
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
    gallery,
    cityPageSeo,
  } = data;

  const canonicalUrl = `https://mavinci.pl/oferta/kasyno/${city.locality}`;
  const pageSlug = `oferta/kasyno/${city.locality}`;
  const prep = cityCases.locative_preposition || 'w';

  const schemaConfig = cityPageSeo?.custom_schema || {};

const schemaOffers =
  Array.isArray(schemaConfig.offers) && schemaConfig.offers.length > 0
    ? schemaConfig.offers
    : [
        {
          name: 'Ruletka eventowa',
          description:
            'Profesjonalny stół do ruletki z obsługą krupiera, żetonami i nauką zasad dla uczestników wydarzenia.',
        },
        {
          name: 'Blackjack',
          description:
            'Stół do blackjacka z profesjonalnym wyposażeniem i krupierem prowadzącym grę w formule rozrywkowej.',
        },
        {
          name: "Poker Texas Hold'em",
          description:
            'Organizacja rozrywkowych turniejów pokerowych z profesjonalnymi kartami, żetonami i obsługą dealerską.',
        },
        {
          name: 'Koło fortuny',
          description:
            'Eventowe koło fortuny z możliwością personalizacji pól, nagród i brandingu firmowego.',
        },
        {
          name: 'Event w stylu Las Vegas',
          description:
            'Kompleksowa oprawa imprezy tematycznej Las Vegas z dekoracjami, stołami kasynowymi i obsługą krupierską.',
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
            name: `Kasyno rozrywkowe ${prep} ${capitalize(cityCases.locative)}`,
            description,
            url: canonicalUrl,
            image,
            serviceType: schemaConfig.serviceType || 'Kasyno rozrywkowe na eventy',
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
                `Firmy, agencje eventowe i organizatorzy imprez ${prep} ${capitalize(
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
            name: `Atrakcje kasynowe ${prep} ${capitalize(cityCases.locative)}`,
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
        section="kasyno-hero"
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

        <CasinoCityAdminClient
          isAdmin={hasWebsiteEdit}
          cityLocality={city.locality}
          cityName={cityCases.nominative}
          defaultTitle={title}
          defaultDescription={description}
        />

        <CasinoCityIntro cityCases={cityCases} content={cityContent} />

        <CasinoCityServices cityCases={cityCases} content={cityContent} />

        <CasinoCityEquipment cityCases={cityCases} content={cityContent} />

        <CasinoCityBenefits cityCases={cityCases} content={cityContent} />

        {gallery.length > 0 && <CasinoCityGallery images={gallery} cityCases={cityCases} />}

        <CasinoCityProcess cityCases={cityCases} content={cityContent} />

        <CasinoCityFAQ cityCases={cityCases} content={cityContent} />

        <CityMapEmbed query={`${cityCases.nominative}, Polska`} />

        <CasinoCityCTA cityCases={cityCases} content={cityContent} />
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
