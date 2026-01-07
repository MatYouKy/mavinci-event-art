import { notFound } from 'next/navigation';
import { unstable_noStore as noStore } from 'next/cache';
import { Metadata } from 'next';
import PageLayout from '@/components/Layout/PageLayout';
import { CategoryBreadcrumb } from '@/components/CategoryBreadcrumb';
import CityConferenceClient from './CityConferenceClient';
import { getSupabaseClient } from '@/lib/supabase';
import { getUserPermissions } from '@/lib/serverAuth';
import EditableHeroSectionServer from '@/components/EditableHeroSectionServer';
import { getPolishCityCasesSmart } from '@/lib/polishCityCases';

async function loadCityData(citySlug: string) {
  noStore();

  const supabase = getSupabaseClient();

  const { data: cityData, error: cityError } = await supabase
    .from('schema_org_places')
    .select('*')
    .eq('locality', citySlug)
    .eq('is_global', true)
    .eq('is_active', true)
    .maybeSingle();

  if (!cityData || cityError) {
    return null;
  }
  const { data: cityPageImage, error } = await supabase
    .from('konferencje_page_images')
    .select(
      'image_url',
    )
    .eq('is_active', true)
    .eq('section', 'hero')
    .maybeSingle();

  const { hasWebsiteEdit } = await getUserPermissions();

  const { data: globalConfig } = await supabase.from('schema_org_global').select('*').single();

  const { data: cityPageSeo } = await supabase
    .from('city_pages_seo')
    .select('*')
    .eq('page_type', 'konferencje')
    .eq('city_slug', citySlug)
    .maybeSingle();

  return {
    city: cityData,
    globalConfig,
    cityPageSeo,
    hasWebsiteEdit,
    heroImage: cityPageImage,
  };
}

export async function generateMetadata({
  params,
}: {
  params: { miasto: string };
}): Promise<Metadata> {
  const data = await loadCityData(params.miasto);

  if (!data) {
    return {
      title: 'Miasto nie znalezione - MAVINCI Event & ART',
    };
  }

  const { city, cityPageSeo } = data;
  const cityCases = getPolishCityCasesSmart(city.name);

  const ogImage =
    cityPageSeo?.og_image ||
    data.heroImage?.image_url ||
    'https://mavinci.pl/logo-mavinci-crm.png';

  const canonicalUrl = `https://mavinci.pl/oferta/konferencje/${city.locality}`;

  const defaultTitle = `Obsługa Konferencji w ${cityCases.locative} - Profesjonalne Nagłośnienie i Multimedia | MAVINCI`;
  const defaultDescription = `Profesjonalna obsługa konferencji w ${cityCases.locative}: nagłośnienie, multimedia, streaming live, realizacja wideo. Kompleksowe wsparcie techniczne dla wydarzeń biznesowych w ${cityCases.locative} i okolicach.`;

  const title = cityPageSeo?.custom_title || defaultTitle;
  const description = cityPageSeo?.custom_description || defaultDescription;
  const keywords =
    cityPageSeo?.custom_keywords ||
    `obsługa konferencji ${cityCases.nominative}, nagłośnienie konferencyjne w ${cityCases.locative}, technika av ${cityCases.locative}, streaming konferencji w ${cityCases.locative}`;


  return {
    title,
    description,
    keywords,
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      type: 'website',
      url: canonicalUrl,
      title,
      description,
      images: [
        {
          url: ogImage,
          alt: `Obsługa konferencji w ${cityCases.locative}`,
        },
      ],
      siteName: 'MAVINCI Event & ART',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogImage],
    },
  };
}

export default async function CityConferencePage({ params }: { params: { miasto: string } }) {
  const data = await loadCityData(params.miasto);

  if (!data) {
    notFound();
  }

  const { city, globalConfig, cityPageSeo, hasWebsiteEdit, heroImage } = data;
  const cityName = city.name;
  const cityCases = getPolishCityCasesSmart(city.name);
  const canonicalUrl = `https://mavinci.pl/oferta/konferencje/${city.locality}`;

  const defaultTitle = `Obsługa Konferencji w ${cityCases.locative} - Profesjonalne Nagłośnienie i Multimedia | MAVINCI`;
  const defaultDescription = `Profesjonalna obsługa konferencji w ${cityCases.locative}: nagłośnienie, multimedia, streaming live, realizacja wideo. Kompleksowe wsparcie techniczne dla wydarzeń biznesowych w ${cityCases.locative} i okolicach.`;

  const customSchema = globalConfig
    ? {
        '@context': 'http://schema.org',
        '@type': 'Service',
        name: `Obsługa Konferencji w ${cityCases.locative}`,
        description: `Kompleksowa obsługa techniczna konferencji w ${cityCases.locative}. Nagłośnienie, multimedia, streaming live, realizacja wideo.`,
        url: canonicalUrl,
        image: heroImage?.image_url || 'https://mavinci.pl/logo-mavinci-crm.png',
        provider: {
          '@type': 'LocalBusiness',
          name: globalConfig.organization_name,
          telephone: globalConfig.telephone,
          email: globalConfig.email,
          url: globalConfig.organization_url,
          logo: globalConfig.organization_logo,
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
          name: cityName,
          address: {
            '@type': 'PostalAddress',
            addressLocality: cityCases.locative,
            postalCode: city.postal_code,
            addressRegion: city.region,
            addressCountry: 'PL',
          },
        },
        serviceType: 'Obsługa Techniczna Konferencji',
        offers: {
          '@type': 'Offer',
          availability: 'https://schema.org/InStock',
          priceRange: '$$-$$$',
        },
      }
    : undefined;

  const breadcrumbItems = [
    { name: 'Start', url: 'https://mavinci.pl/' },
    { name: 'Oferta', url: 'https://mavinci.pl/oferta' },
    { name: 'Konferencje', url: 'https://mavinci.pl/oferta/konferencje' },
    { name: `Konferencje w ${cityCases.locative}`, url: canonicalUrl },
  ];

  const pageSlug = `oferta/konferencje/${city.locality}`;

  return (
    <PageLayout pageSlug={pageSlug} customSchema={customSchema}>
      <EditableHeroSectionServer
        whiteWordsCount={3}
        section={`konferencje-hero`}
        pageSlug={pageSlug}
        initialImageUrl={heroImage?.image_url}
        initialTitle={`Obsługa Konferencji w ${cityCases.locative}`}
        initialDescription={`Profesjonalna obsługa konferencji w ${cityCases.locative}. Nagłośnienie, multimedia, streaming live, realizacja wideo. Kompleksowe wsparcie techniczne dla wydarzeń biznesowych w ${cityCases.locative} i okolicach.`}
      />
      <div className="min-h-screen bg-[#0f1119] pt-2">
        <section className="min-h-[50px] px-6">
          <div className="mx-auto min-h-[50px] max-w-7xl">
            <CategoryBreadcrumb
              pageSlug={`oferta/konferencje/${city.locality}`}
                productName={`Obsługa Konferencji w ${cityCases.locative}`}
              hideMetadataButton={false}
            />
          </div>
        </section>

        <CityConferenceClient
          city={city}
          cityPageSeo={cityPageSeo}
          defaultTitle={defaultTitle}
          defaultDescription={defaultDescription}
          isAdmin={hasWebsiteEdit}
        />
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

  return cities.map((city) => ({
    miasto: city.locality,
  }));
}
