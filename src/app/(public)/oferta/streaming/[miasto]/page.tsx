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

import StreamingCityAdminClient from './StreamingCityAdminClient';
import StreamingCityServices from './StreamingCityServices';
import StreamingCityEquipment from './StreamingCityEquipment';
import StreamingCityBenefits from './StreamingCityBenefits';
import StreamingCityGallery from './StreamingCityGallery';
import StreamingCityProcess from './StreamingCityProcess';
import StreamingCityFAQ from './StreamingCityFAQ';
import StreamingCityCTA from './StreamingCityCTA';
import StreamingCityIntro from './StreamingCityIntro';

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
      .from('streaming_page_images')
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
    .eq('page_slug', `oferta/streaming/${city}`)
    .maybeSingle();

  let cityContent: any = null;
  let gallery: any[] = [];

  try {
    const { data: cc } = await supabase
      .from('streaming_city_content')
      .select('*')
      .eq('city_slug', city)
      .eq('is_active', true)
      .maybeSingle();
    cityContent = cc;
  } catch { /* table may not exist yet */ }

  try {
    const { data: gal } = await supabase
      .from('streaming_city_gallery')
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

  const canonicalUrl = `https://mavinci.pl/oferta/streaming/${city}`;
  const prep = cityCases.locative_preposition || 'w';

  const defaultTitle = `Streaming i transmisje live ${prep} ${capitalize(cityCases.locative)}`;
  const defaultDescription = `Profesjonalny streaming eventów, konferencji i transmisji live ${prep} ${capitalize(cityCases.locative)}. Realizacja wielokamerowa 4K, ściany LED, telebimy, transmisje YouTube, Vimeo, Teams. Kamery, reżyserka, oprawa graficzna.`;

  const metaTitle =
    cityContent?.seo_title ||
    cityPageSeo?.title ||
    `${defaultTitle} - Realizacja Video i Transmisje | MAVINCI`;

  const description =
    cityContent?.seo_description || cityPageSeo?.description || defaultDescription;

  const keywords =
    cityContent?.seo_keywords?.join(', ') ||
    (cityPageSeo?.keywords as string[] | null)?.join(', ') ||
    `streaming ${cityCases.nominative}, transmisja live ${cityCases.locative}, realizacja wideo ${cityCases.locative}, kamery eventowe ${cityCases.locative}, telebimy ${cityCases.locative}, ściana LED ${cityCases.locative}, YouTube live ${cityCases.locative}`;

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
  };
}

export async function generateMetadata({
  params,
}: {
  params: { miasto: string };
}): Promise<Metadata> {
  const data = await loadCityData(params.miasto);

  if (!data) {
    return { title: 'Streaming i Transmisje Live - MAVINCI Event & ART' };
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
      images: [{ url: image, alt: `Streaming i transmisje live ${cityCases.locative}` }],
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

export default async function StreamingCityPage({ params }: { params: { miasto: string } }) {
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
  } = data;

  const canonicalUrl = `https://mavinci.pl/oferta/streaming/${city.locality}`;
  const pageSlug = `oferta/streaming/${city.locality}`;
  const prep = cityCases.locative_preposition || 'w';

  const customSchema = cityContent?.custom_schema || (globalConfig
    ? {
        '@context': 'https://schema.org',
        '@type': 'Service',
        name: `Streaming i transmisje live ${prep} ${capitalize(cityCases.locative)}`,
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
        serviceType: 'Streaming i realizacja transmisji live',
        audience: {
          '@type': 'BusinessAudience',
          audienceType: `Firmy, agencje eventowe, organizatorzy konferencji ${prep} ${capitalize(cityCases.locative)}`,
        },
        hasOfferCatalog: {
          '@type': 'OfferCatalog',
          name: `Usługi streamingowe ${prep} ${capitalize(cityCases.locative)}`,
          itemListElement: [
            {
              '@type': 'Offer',
              itemOffered: {
                '@type': 'Service',
                name: 'Realizacja wielokamerowa 4K',
                description:
                  'Profesjonalna realizacja wielokamerowa w rozdzielczości 4K. Kamery Sony, Blackmagic, gimble, ' +
                  'steadicam. Reżyserka wizji na żywo z miksowaniem obrazu.',
              },
              availability: 'https://schema.org/InStock',
            },
            {
              '@type': 'Offer',
              itemOffered: {
                '@type': 'Service',
                name: 'Transmisje live na platformy streamingowe',
                description:
                  'Transmisja na żywo na YouTube, Vimeo, Teams, Zoom, dedykowane platformy. ' +
                  'Enkodery sprzętowe, backup łącza, monitoring jakości streamu.',
              },
              availability: 'https://schema.org/InStock',
            },
            {
              '@type': 'Offer',
              itemOffered: {
                '@type': 'Service',
                name: 'Ściany LED i telebimy eventowe',
                description:
                  'Wynajem i montaż ścian LED, telebimów, ekranów projekcyjnych. ' +
                  'Dowolne rozmiary, piksel pitch od 1.9mm do 5.9mm, wewnętrzne i zewnętrzne.',
              },
              availability: 'https://schema.org/InStock',
            },
            {
              '@type': 'Offer',
              itemOffered: {
                '@type': 'Service',
                name: 'Oprawa graficzna transmisji',
                description:
                  'Grafika live: belki, thirds, animowane przejścia, logotypy, plansza oczekiwania, ' +
                  'countdown, CG w czasie rzeczywistym.',
              },
              availability: 'https://schema.org/InStock',
            },
            {
              '@type': 'Offer',
              itemOffered: {
                '@type': 'Service',
                name: 'Nagrywanie i postprodukcja',
                description:
                  'Nagranie ISO każdej kamery, nagranie miksu programowego, postprodukcja, ' +
                  'koloryzacja, montaż highlightów i relacji.',
              },
              availability: 'https://schema.org/InStock',
            },
            {
              '@type': 'Offer',
              itemOffered: {
                '@type': 'Service',
                name: 'Infrastruktura sieciowa i łącza',
                description:
                  'Dedykowane łącza internetowe, bonding 4G/5G, enkodery NDI/SDI, ' +
                  'sieć produkcyjna z redundancją i monitoringiem bitrate.',
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
        section="streaming-hero"
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

        <StreamingCityAdminClient
          isAdmin={hasWebsiteEdit}
          cityLocality={city.locality}
          cityName={cityCases.nominative}
          defaultTitle={title}
          defaultDescription={description}
        />

        <StreamingCityIntro cityCases={cityCases} content={cityContent} />

        <StreamingCityServices cityCases={cityCases} content={cityContent} />

        <StreamingCityEquipment cityCases={cityCases} content={cityContent} />

        <StreamingCityBenefits cityCases={cityCases} content={cityContent} />

        {gallery.length > 0 && <StreamingCityGallery images={gallery} cityCases={cityCases} />}

        <StreamingCityProcess cityCases={cityCases} content={cityContent} />

        <StreamingCityFAQ cityCases={cityCases} content={cityContent} />

        <CityMapEmbed query={`${cityCases.nominative}, Polska`} />

        <StreamingCityCTA cityCases={cityCases} content={cityContent} />
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
