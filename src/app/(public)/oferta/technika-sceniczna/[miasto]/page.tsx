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

import TechStageCityAdminClient from './TechStageCityAdminClient';
import TechStageCityEquipment from './TechStageCityEquipment';
import TechStageCityBenefits from './TechStageCityBenefits';
import TechStageCityGallery from './TechStageCityGallery';
import TechStageCityProcess from './TechStageCityProcess';
import TechStageCityFAQ from './TechStageCityFAQ';
import TechStageCityCTA from './TechStageCityCTA';
import TechStageCityIntro from './TechStageCityIntro';
import TechnicalStageFeatures from '../sections/TechnicalStageFeatures';
import TechnicalStagePackages from '../sections/TechnicalStagePackages';
import TechnicalStageGallery from '../sections/TechnicalStageGallery';

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
      .from('techstage_page_images')
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
    .eq('page_slug', `oferta/technika-sceniczna/${city}`)
    .maybeSingle();

  let cityContent: any = null;
  let gallery: any[] = [];

  try {
    const { data: cc } = await supabase
      .from('techstage_city_content')
      .select('*')
      .eq('city_slug', city)
      .eq('is_active', true)
      .maybeSingle();
    cityContent = cc;
  } catch { /* table may not exist yet */ }

  try {
    const { data: gal } = await supabase
      .from('techstage_city_gallery')
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

  const canonicalUrl = `https://mavinci.pl/oferta/technika-sceniczna/${city}`;
  const prep = cityCases.locative_preposition || 'w';

  const defaultTitle = `Technika sceniczna ${prep} ${capitalize(cityCases.locative)}`;
  const defaultDescription = `Profesjonalna technika sceniczna ${prep} ${capitalize(cityCases.locative)}. Nagłośnienie, oświetlenie sceniczne, multimedia, ekrany LED, konstrukcje sceniczne, rigging. Kompleksowa obsługa techniczna eventów, konferencji i koncertów.`;

  const metaTitle =
    cityContent?.seo_title ||
    cityPageSeo?.title ||
    `${defaultTitle} - Nagłośnienie, Oświetlenie, Multimedia | MAVINCI`;

  const description =
    cityContent?.seo_description || cityPageSeo?.description || defaultDescription;

  const keywords =
    cityContent?.seo_keywords?.join(', ') ||
    (cityPageSeo?.keywords as string[] | null)?.join(', ') ||
    `technika sceniczna ${cityCases.nominative}, nagłośnienie ${cityCases.locative}, oświetlenie eventowe ${cityCases.locative}, ekrany LED ${cityCases.locative}, scena ${cityCases.locative}, rigging ${cityCases.locative}, multimedia ${cityCases.locative}`;

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
    return { title: 'Technika Sceniczna - MAVINCI Event & ART' };
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
      images: [{ url: image, alt: `Technika sceniczna ${cityCases.locative}` }],
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

export default async function TechStageCityPage({ params }: { params: { miasto: string } }) {
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

  const canonicalUrl = `https://mavinci.pl/oferta/technika-sceniczna/${city.locality}`;
  const pageSlug = `oferta/technika-sceniczna/${city.locality}`;
  const prep = cityCases.locative_preposition || 'w';

  const customSchema = cityContent?.custom_schema || (globalConfig
    ? {
        '@context': 'https://schema.org',
        '@type': 'Service',
        name: `Technika sceniczna ${prep} ${capitalize(cityCases.locative)}`,
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
        serviceType: 'Technika sceniczna i obsługa techniczna eventów',
        audience: {
          '@type': 'BusinessAudience',
          audienceType: `Firmy, agencje eventowe, organizatorzy konferencji i koncertów ${prep} ${capitalize(cityCases.locative)}`,
        },
        hasOfferCatalog: {
          '@type': 'OfferCatalog',
          name: `Usługi techniki scenicznej ${prep} ${capitalize(cityCases.locative)}`,
          itemListElement: [
            {
              '@type': 'Offer',
              itemOffered: {
                '@type': 'Service',
                name: 'Nagłośnienie eventowe i koncertowe',
                description:
                  'Profesjonalne systemy nagłośnienia liniowego i punktowego. Systemy L-Acoustics, d&b audiotechnik, JBL. ' +
                  'Realizacja dźwięku FOH i monitorów scenicznych.',
              },
              availability: 'https://schema.org/InStock',
            },
            {
              '@type': 'Offer',
              itemOffered: {
                '@type': 'Service',
                name: 'Oświetlenie sceniczne i architekturalne',
                description:
                  'Projektowanie i realizacja oświetlenia eventowego. Moving heady, wash, spot, blinder, LED bar. ' +
                  'Konsolety MA Lighting, Avolites. Efekty specjalne.',
              },
              availability: 'https://schema.org/InStock',
            },
            {
              '@type': 'Offer',
              itemOffered: {
                '@type': 'Service',
                name: 'Ekrany LED i multimedia',
                description:
                  'Ściany LED indoor/outdoor, projektory laserowe, mapping 3D, content wideo. ' +
                  'Serwery Disguise, Resolume. Interaktywne instalacje multimedialne.',
              },
              availability: 'https://schema.org/InStock',
            },
            {
              '@type': 'Offer',
              itemOffered: {
                '@type': 'Service',
                name: 'Konstrukcje sceniczne i rigging',
                description:
                  'Sceny mobilne, podesty, konstrukcje aluminiowe, ground support, rigging punktowy i liniowy. ' +
                  'Certyfikowane systemy zawieszenia do 2 ton na punkt.',
              },
              availability: 'https://schema.org/InStock',
            },
            {
              '@type': 'Offer',
              itemOffered: {
                '@type': 'Service',
                name: 'Zasilanie i infrastruktura',
                description:
                  'Agregaty prądotwórcze, rozdzielnice, okablowanie siłowe i sygnałowe. ' +
                  'Kompleksowa infrastruktura techniczna dla eventów plenerowych i halowych.',
              },
              availability: 'https://schema.org/InStock',
            },
            {
              '@type': 'Offer',
              itemOffered: {
                '@type': 'Service',
                name: 'Realizacja techniczna eventów',
                description:
                  'Koordynacja techniczna wydarzeń, kierownik techniczny, operatorzy dźwięku i światła. ' +
                  'Pełna obsługa techniczna od briefu po demontaż.',
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
        section="techstage-hero"
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

        <TechStageCityAdminClient
          isAdmin={hasWebsiteEdit}
          cityLocality={city.locality}
          cityName={cityCases.nominative}
          defaultTitle={title}
          defaultDescription={description}
        />

        <TechStageCityIntro cityCases={cityCases} content={cityContent} />

        <TechnicalStageFeatures />

        {/* <TechnicalStagePackages /> */}
{/* 
        <TechStageCityEquipment cityCases={cityCases} content={cityContent} /> */}

        <TechStageCityBenefits cityCases={cityCases} content={cityContent} />

        <TechnicalStageGallery />

        {gallery.length > 0 && <TechStageCityGallery images={gallery} cityCases={cityCases} />}

        <TechStageCityProcess cityCases={cityCases} content={cityContent} />

        <TechStageCityFAQ cityCases={cityCases} content={cityContent} />

        <CityMapEmbed query={`${cityCases.nominative}, Polska`} />

        <TechStageCityCTA cityCases={cityCases} content={cityContent} />
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
