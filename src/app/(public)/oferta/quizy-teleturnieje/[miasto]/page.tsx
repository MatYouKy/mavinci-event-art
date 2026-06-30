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

import QuizCityAdminClient from './QuizCityAdminClient';
import QuizCityServices from './QuizCityServices';
import QuizCityEquipment from './QuizCityEquipment';
import QuizCityBenefits from './QuizCityBenefits';
import QuizCityGallery from './QuizCityGallery';
import QuizCityProcess from './QuizCityProcess';
import QuizCityFAQ from './QuizCityFAQ';
import QuizCityCTA from './QuizCityCTA';
import QuizCityIntro from './QuizCityIntro';

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
      .from('quiz_page_images')
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
    .eq('page_slug', `oferta/quizy-teleturnieje/${city}`)
    .maybeSingle();

  let cityContent: any = null;
  let gallery: any[] = [];

  try {
    const { data: cc } = await supabase
      .from('quiz_city_content')
      .select('*')
      .eq('city_slug', city)
      .eq('is_active', true)
      .maybeSingle();
    cityContent = cc;
  } catch { /* table may not exist yet */ }

  try {
    const { data: gal } = await supabase
      .from('quiz_city_gallery')
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

  const canonicalUrl = `https://mavinci.pl/oferta/quizy-teleturnieje/${city}`;
  const prep = cityCases.locative_preposition || 'w';

  const defaultTitle = `Quizy i teleturnieje ${prep} ${capitalize(cityCases.locative)}`;
  const defaultDescription = `Profesjonalne quizy, teleturnieje i gry zespołowe ${prep} ${capitalize(cityCases.locative)}. Integracje firmowe, eventy tematyczne, teleturnieje telewizyjne na żywo. Autorskie formaty, profesjonalne nagłośnienie i oświetlenie, prowadzący z doświadczeniem TV.`;

  const metaTitle =
    cityContent?.seo_title ||
    cityPageSeo?.title ||
    `${defaultTitle} - Gry Integracyjne i Eventy | MAVINCI`;

  const description =
    cityContent?.seo_description || cityPageSeo?.description || defaultDescription;

  const keywords =
    cityContent?.seo_keywords?.join(', ') ||
    (cityPageSeo?.keywords as string[] | null)?.join(', ') ||
    `quizy ${cityCases.nominative}, teleturnieje ${cityCases.locative}, gry integracyjne ${cityCases.locative}, eventy firmowe ${cityCases.locative}, team building ${cityCases.locative}, quiz show ${cityCases.locative}, integracja ${cityCases.locative}`;

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
    return { title: 'Quizy i Teleturnieje - MAVINCI Event & ART' };
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
      images: [{ url: image, alt: `Quizy i teleturnieje ${cityCases.locative}` }],
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

export default async function QuizCityPage({ params }: { params: { miasto: string } }) {
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

  const canonicalUrl = `https://mavinci.pl/oferta/quizy-teleturnieje/${city.locality}`;
  const pageSlug = `oferta/quizy-teleturnieje/${city.locality}`;
  const prep = cityCases.locative_preposition || 'w';

  const customSchema = cityContent?.custom_schema || (globalConfig
    ? {
        '@context': 'https://schema.org',
        '@type': 'Service',
        name: `Quizy i teleturnieje ${prep} ${capitalize(cityCases.locative)}`,
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
        serviceType: 'Quizy, teleturnieje i gry integracyjne',
        audience: {
          '@type': 'BusinessAudience',
          audienceType: `Firmy, agencje eventowe, działy HR i organizatorzy integracji ${prep} ${capitalize(cityCases.locative)}`,
        },
        hasOfferCatalog: {
          '@type': 'OfferCatalog',
          name: `Formaty quizowe i teleturnieje ${prep} ${capitalize(cityCases.locative)}`,
          itemListElement: [
            {
              '@type': 'Offer',
              itemOffered: {
                '@type': 'Service',
                name: 'Teleturniej telewizyjny na żywo',
                description:
                  'Profesjonalny teleturniej w stylu programów TV. Scenografia, oświetlenie, nagłośnienie, ' +
                  'prowadzący z doświadczeniem telewizyjnym. Formaty: Familiada, Milionerzy, Jeopardy.',
              },
              availability: 'https://schema.org/InStock',
            },
            {
              '@type': 'Offer',
              itemOffered: {
                '@type': 'Service',
                name: 'Quiz firmowy i integracyjny',
                description:
                  'Quizy tematyczne dopasowane do firmy i branży. Pytania o firmie, branży, pop-kulturze. ' +
                  'System buzzers, tablice wyników, rywalizacja drużynowa.',
              },
              availability: 'https://schema.org/InStock',
            },
            {
              '@type': 'Offer',
              itemOffered: {
                '@type': 'Service',
                name: 'Gry zespołowe i team building',
                description:
                  'Gry kooperacyjne i rywalizacyjne dla zespołów. Escape room live, gry planszowe XXL, ' +
                  'challenge technologiczne, gry miejskie.',
              },
              availability: 'https://schema.org/InStock',
            },
            {
              '@type': 'Offer',
              itemOffered: {
                '@type': 'Service',
                name: 'Karaoke show i muzyczne gry',
                description:
                  'Karaoke z profesjonalnym nagłośnieniem, Name That Tune, muzyczne quizy, ' +
                  'lip sync battle. Prowadzący DJ z animacją.',
              },
              availability: 'https://schema.org/InStock',
            },
            {
              '@type': 'Offer',
              itemOffered: {
                '@type': 'Service',
                name: 'Quizy multimedialne z aplikacją',
                description:
                  'Interaktywne quizy na smartfonach uczestników. System głosowania w czasie rzeczywistym, ' +
                  'ranking live na ekranie, pytania z multimediami.',
              },
              availability: 'https://schema.org/InStock',
            },
            {
              '@type': 'Offer',
              itemOffered: {
                '@type': 'Service',
                name: 'Eventy tematyczne i wieczory quizowe',
                description:
                  'Wieczory tematyczne: kryminalne, PRL, lata 80., filmowe. Kompletna oprawa: ' +
                  'scenografia, kostiumy, rekwizyty, catering tematyczny.',
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
        section="quiz-hero"
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

        <QuizCityAdminClient
          isAdmin={hasWebsiteEdit}
          cityLocality={city.locality}
          cityName={cityCases.nominative}
          defaultTitle={title}
          defaultDescription={description}
        />

        <QuizCityIntro cityCases={cityCases} content={cityContent} />

        <QuizCityServices cityCases={cityCases} content={cityContent} />

        <QuizCityEquipment cityCases={cityCases} content={cityContent} />

        <QuizCityBenefits cityCases={cityCases} content={cityContent} />

        {gallery.length > 0 && <QuizCityGallery images={gallery} cityCases={cityCases} />}

        <QuizCityProcess cityCases={cityCases} content={cityContent} />

        <QuizCityFAQ cityCases={cityCases} content={cityContent} />

        <CityMapEmbed query={`${cityCases.nominative}, Polska`} />

        <QuizCityCTA cityCases={cityCases} content={cityContent} />
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
