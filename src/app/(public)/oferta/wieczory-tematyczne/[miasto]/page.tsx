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

import ThemedPartyCityAdminClient from './ThemedPartyCityAdminClient';
import ThemedPartyCityIntro from './ThemedPartyCityIntro';
import ThemedPartyCityServices from './ThemedPartyCityServices';
import ThemedPartyCityEquipment from './ThemedPartyCityEquipment';
import ThemedPartyCityBenefits from './ThemedPartyCityBenefits';
import ThemedPartyCityGallery from './ThemedPartyCityGallery';
import ThemedPartyCityProcess from './ThemedPartyCityProcess';
import ThemedPartyCityFAQ from './ThemedPartyCityFAQ';
import ThemedPartyCityCTA from './ThemedPartyCityCTA';
import ThemedPartyCityThemes from './ThemedPartyCityThemes';
import ThemedPartyCitySharedGallery from './ThemedPartyCitySharedGallery';

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
      .from('themed_party_page_images')
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
    .eq('page_slug', `oferta/wieczory-tematyczne/${city}`)
    .maybeSingle();

  let cityContent: any = null;
  let gallery: any[] = [];

  try {
    const { data: cc } = await supabase
      .from('themed_party_city_content')
      .select('*')
      .eq('city_slug', city)
      .eq('is_active', true)
      .maybeSingle();
    cityContent = cc;
  } catch { /* table may not exist yet */ }

  try {
    const { data: gal } = await supabase
      .from('themed_party_city_gallery')
      .select('*')
      .eq('city_slug', city)
      .eq('is_active', true)
      .order('display_order');
    gallery = gal || [];
  } catch { /* table may not exist yet */ }

  const EXCEPTIONS: Record<string, PolishCityCases> = await loadCityCasesFromDb();
  const cityCases = getPolishCityCasesSmart(city, EXCEPTIONS);

  // Fetch shared themed-party data (themes + gallery from main page)
  let sharedThemes: any[] = [];
  let sharedGallery: any[] = [];
  try {
    const { data: sharedData } = await supabase
      .from('site_images')
      .select('*')
      .eq('section', 'themed-party')
      .eq('is_active', true)
      .order('order_index');

    if (sharedData && sharedData.length > 0) {
      const themesRow = sharedData.find((r: any) => r.name === 'themes');
      if (themesRow?.image_metadata?.items && Array.isArray(themesRow.image_metadata.items)) {
        sharedThemes = themesRow.image_metadata.items;
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
  } catch { /* site_images may not have themed-party data yet */ }

  const image =
    cityContent?.hero_image_url ||
    cityPageSeo?.og_image ||
    heroImage?.image_url ||
    'https://mavinci.pl/logo-mavinci-crm.png';

  const canonicalUrl = `https://mavinci.pl/oferta/wieczory-tematyczne/${city}`;
  const prep = cityCases.locative_preposition || 'w';

  const defaultTitle = `Wieczory tematyczne ${prep} ${capitalize(cityCases.locative)}`;
  const defaultDescription = `Organizacja wieczorów tematycznych ${prep} ${capitalize(cityCases.locative)}. Imprezy w klimacie Casino Night, Hollywood, PRL, Dzikiego Zachodu, lat 20-tych i wiele więcej. Dekoracje, aktorzy, scenografia, muzyka - kompleksowa realizacja eventów firmowych.`;

  const metaTitle =
    cityContent?.seo_title ||
    cityPageSeo?.title ||
    `${defaultTitle} - Imprezy Tematyczne dla Firm | MAVINCI`;

  const description =
    cityContent?.seo_description || cityPageSeo?.description || defaultDescription;

  const keywords =
    cityContent?.seo_keywords?.join(', ') ||
    (cityPageSeo?.keywords as string[] | null)?.join(', ') ||
    `wieczory tematyczne ${cityCases.nominative}, imprezy tematyczne ${cityCases.locative}, event tematyczny ${cityCases.locative}, impreza firmowa ${cityCases.locative}, casino night ${cityCases.locative}, impreza w stylu PRL ${cityCases.locative}`;

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
    gallery: gallery || [],
    sharedThemes,
    sharedGallery,
  };
}

export async function generateMetadata({
  params,
}: {
  params: { miasto: string };
}): Promise<Metadata> {
  const data = await loadCityData(params.miasto);

  if (!data) {
    return { title: 'Wieczory Tematyczne - MAVINCI Event & ART' };
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
      images: [{ url: image, alt: `Wieczory tematyczne ${cityCases.locative}` }],
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

export default async function ThemedPartyCityPage({ params }: { params: { miasto: string } }) {
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
    sharedThemes,
    sharedGallery,
  } = data;

  const canonicalUrl = `https://mavinci.pl/oferta/wieczory-tematyczne/${city.locality}`;
  const pageSlug = `oferta/wieczory-tematyczne/${city.locality}`;
  const prep = cityCases.locative_preposition || 'w';

  const customSchema = cityContent?.custom_schema || (globalConfig
    ? {
        '@context': 'https://schema.org',
        '@type': 'Service',
        name: `Wieczory tematyczne ${prep} ${capitalize(cityCases.locative)}`,
        description,
        url: canonicalUrl,
        image,
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
            addressLocality: cityCases.nominative,
            postalCode: city.postal_code,
            addressRegion: city.region,
            addressCountry: 'PL',
          },
        },
        serviceType: 'Wieczory tematyczne i imprezy firmowe',
        audience: {
          '@type': 'BusinessAudience',
          audienceType: `Firmy, agencje eventowe, organizatorzy imprez ${prep} ${capitalize(cityCases.locative)}`,
        },
        hasOfferCatalog: {
          '@type': 'OfferCatalog',
          name: `Wieczory tematyczne ${prep} ${capitalize(cityCases.locative)}`,
          itemListElement: [
            {
              '@type': 'Offer',
              itemOffered: {
                '@type': 'Service',
                name: 'Casino Night',
                description: 'Wieczór w klimacie kasyna - stoły do ruletki, blackjacka, pokera. Profesjonalni krupierzy, dekoracje, oświetlenie.',
              },
              availability: 'https://schema.org/InStock',
            },
            {
              '@type': 'Offer',
              itemOffered: {
                '@type': 'Service',
                name: 'Impreza w stylu Hollywood',
                description: 'Gala w stylu Hollywood - czerwony dywan, Oscar ceremony, paparazzi, scenografia filmowa.',
              },
              availability: 'https://schema.org/InStock',
            },
            {
              '@type': 'Offer',
              itemOffered: {
                '@type': 'Service',
                name: 'Wieczór w stylu PRL',
                description: 'Impreza w klimacie PRL - dekoracje z epoki, bar mleczny, muzyka lat 70/80, quizy tematyczne.',
              },
              availability: 'https://schema.org/InStock',
            },
            {
              '@type': 'Offer',
              itemOffered: {
                '@type': 'Service',
                name: 'Dziki Zachód / Western',
                description: 'Wieczór w klimacie Dzikiego Zachodu - saloon, rodeo mechaniczne, pokazy lasso, country music.',
              },
              availability: 'https://schema.org/InStock',
            },
            {
              '@type': 'Offer',
              itemOffered: {
                '@type': 'Service',
                name: 'Lata 20-te / Great Gatsby',
                description: 'Elegancki wieczór w stylu lat 20-tych - jazz band, charleston, art deco, cocktail bar.',
              },
              availability: 'https://schema.org/InStock',
            },
            {
              '@type': 'Offer',
              itemOffered: {
                '@type': 'Service',
                name: 'Impreza tropikalna / Hawajska',
                description: 'Tropikalna atmosfera - dekoracje egzotyczne, bary tiki, pokazy ognia, muzyka na żywo.',
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
    : undefined);

  return (
    <PageLayout pageSlug={pageSlug} customSchema={customSchema} cookieStore={cookies()}>
      <EditableHeroSectionServer
        whiteWordsCount={2}
        section="wieczory-tematyczne-hero"
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

        <ThemedPartyCityAdminClient
          isAdmin={hasWebsiteEdit}
          cityLocality={city.locality}
          cityName={cityCases.nominative}
          defaultTitle={title}
          defaultDescription={description}
        />

        <ThemedPartyCityIntro cityCases={cityCases} content={cityContent} />

        <ThemedPartyCityServices cityCases={cityCases} content={cityContent} />

        <ThemedPartyCityEquipment cityCases={cityCases} content={cityContent} />

        <ThemedPartyCityBenefits cityCases={cityCases} content={cityContent} />

        {sharedThemes.length > 0 && (
          <ThemedPartyCityThemes themes={sharedThemes} cityCases={cityCases} />
        )}

        {sharedGallery.length > 0 && (
          <ThemedPartyCitySharedGallery images={sharedGallery} cityCases={cityCases} />
        )}

        {gallery.length > 0 && <ThemedPartyCityGallery images={gallery} cityCases={cityCases} />}

        <ThemedPartyCityProcess cityCases={cityCases} content={cityContent} />

        <ThemedPartyCityFAQ cityCases={cityCases} content={cityContent} />

        <CityMapEmbed query={`${cityCases.nominative}, Polska`} />

        <ThemedPartyCityCTA cityCases={cityCases} content={cityContent} />
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
