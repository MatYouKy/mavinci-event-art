import { Metadata } from 'next';
import { createClient } from '@supabase/supabase-js';
import Hero from '@/components/Hero';
import Stats from '@/components/Stats';
import Divider from '@/components/Divider';
import Services from '@/components/Services';
import OfertaSection from '@/components/OfertaSection';
import Portfolio from '@/components/Portfolio';
import DividerTwo from '@/components/DividerTwo';
import Team from '@/components/Team';
import DividerThree from '@/components/DividerThree';
import Process from '@/components/Process';
import DividerFour from '@/components/DividerFour';
import Contact from '@/components/Contact';
import WebsiteEditPanel from '@/components/WebsiteEditPanel';
import PageLayout from '@/components/Layout/PageLayout';
import { getSeoForPage } from '@/lib/seo';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const SITE_URL = 'https://mavinci.pl';
const DEFAULT_OG = `${SITE_URL}/logo-mavinci-crm.png`;

// (Fallback) – jeśli w Supabase nie masz listy miejsc lub chcesz “dopalić” frazy miast
const FALLBACK_CITIES_250KM = [
  'Olsztyn',
  'Elbląg',
  'Ostróda',
  'Iława',
  'Mrągowo',
  'Giżycko',
  'Ełk',
  'Szczytno',
  'Kętrzyn',
  'Lidzbark Warmiński',
  'Bartoszyce',
  'Braniewo',
  'Malbork',
  'Tczew',
  'Kwidzyn',
  'Grudziądz',
  'Gdańsk',
  'Gdynia',
  'Sopot',
  'Toruń',
  'Bydgoszcz',
  'Warszawa',
  'Płock',
  'Ciechanów',
  'Ostrołęka',
];

// Frazy usług (high intent)
const SERVICE_KEYWORDS = [
  'agencja eventowa',
  'organizacja eventów',
  'eventy firmowe',
  'integracje firmowe',
  'teambuilding',
  'wieczór tematyczny',
  'casino night',
  'wieczór kasyno',
  'technika sceniczna',
  'nagłośnienie riderowe',
  'nagłośnienie koncertowe',
  'oświetlenie sceniczne',
  'realizacja dźwięku',
  'streaming konferencji',
  'streaming wydarzeń',
  'realizacja wideo',
  'obsługa konferencji',
  'multimedia na event',
];

const getSupabaseClient = () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  if (!supabaseUrl || !supabaseKey) throw new Error('Missing Supabase environment variables');
  return createClient(supabaseUrl, supabaseKey);
};

async function loadPageMetadata() {
  const supabase = getSupabaseClient();

  const { data: metadata } = await supabase
    .from('schema_org_page_metadata')
    .select('*')
    .eq('page_slug', 'home')
    .eq('is_active', true)
    .maybeSingle();

  const { data: globalConfig } = await supabase.from('schema_org_global').select('*').single();

  return { metadata, globalConfig };
}

function toKeywordsArray(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (typeof value === 'string') {
    // obsłuż przypadek gdy w bazie trzymasz "a,b,c"
    return value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function uniq(arr: string[]) {
  return Array.from(new Set(arr.map((s) => s.trim()).filter(Boolean)));
}

function cityKeywordPack(city: string) {
  // zestaw “najbardziej sprzedający”
  return [
    `agencja eventowa ${city}`,
    `organizacja eventów ${city}`,
    `eventy firmowe ${city}`,
    `teambuilding ${city}`,
    `integracje firmowe ${city}`,
    `technika sceniczna ${city}`,
    `nagłośnienie ${city}`,
    `oświetlenie ${city}`,
    `streaming ${city}`,
    `obsługa konferencji ${city}`,
    `wieczór kasyno ${city}`,
  ];
}

export async function generateMetadata(): Promise<Metadata> {
  const { metadata } = await loadPageMetadata();
  const seo = await getSeoForPage('home');

  const dbTitle = metadata?.title as string | undefined;
  const dbDesc = metadata?.description as string | undefined;

  // Title/desc mocno pod agencję eventową w Olsztynie (fallback, jeśli DB puste lub “za ogólne”)
  const title =
    dbTitle ||
    'Agencja eventowa Olsztyn – MAVINCI Event & ART | Eventy, technika sceniczna, streaming';
  const description =
    dbDesc ||
    'MAVINCI Event & ART – agencja eventowa z Olsztyna. Organizacja eventów firmowych, teambuildingi i integracje, wieczory tematyczne (kasyno), streaming konferencji, riderowe nagłośnienie, oświetlenie i technika sceniczna. Obsługujemy Olsztyn i miasta w promieniu ok. 250 km.';

  const ogImage = (metadata?.og_image as string | undefined) || DEFAULT_OG;

  const dbKeywords = toKeywordsArray(metadata?.keywords);
  const seoCities =
    seo?.places?.map((p) => p?.name).filter(Boolean).map(String) || [];

  const cities = uniq([...seoCities, ...FALLBACK_CITIES_250KM]);

  const boostedKeywords = uniq([
    // core: Olsztyn + usługi
    ...SERVICE_KEYWORDS.map((k) => `${k} Olsztyn`),
    'agencja eventowa Olsztyn',
    'organizacja eventów Olsztyn',
    // miasta z okolicy
    ...cities.flatMap((c) => cityKeywordPack(c)),
    // z DB (na końcu, ale też wchodzi)
    ...dbKeywords,
  ]);

  return {
    metadataBase: new URL(SITE_URL),
    title,
    description,
    keywords: boostedKeywords.join(', '),

    alternates: {
      canonical: SITE_URL,
    },

    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        'max-video-preview': -1,
        'max-image-preview': 'large',
        'max-snippet': -1,
      },
    },

    openGraph: {
      type: 'website',
      url: SITE_URL,
      title,
      description,
      siteName: 'MAVINCI Event & ART',
      locale: 'pl_PL',
      images: [
        {
          url: ogImage,
          alt: title,
        },
      ],
    },

    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogImage],
    },
  };
}

export default async function HomePage() {
  const { metadata, globalConfig } = await loadPageMetadata();
  const seo = await getSeoForPage('home');

  // areaServed – bierzemy Twoje miejsca z SEO (najlepsze, bo realne)
  const areaServed =
    seo?.places?.map((place) => ({
      '@type': 'City',
      name: place.name,
      address: {
        '@type': 'PostalAddress',
        addressLocality: place.locality,
        postalCode: place.postal_code,
        addressRegion: place.region,
        addressCountry: {
          '@type': 'Country',
          name: place.country,
        },
      },
    })) || [];

  // Katalog usług – mocne schema pod “agencja eventowa”
  const offerCatalog = {
    '@type': 'OfferCatalog',
    name: 'Oferta – Agencja eventowa Olsztyn',
    itemListElement: [
      {
        '@type': 'OfferCatalog',
        name: 'Eventy firmowe, integracje i teambuilding',
        itemListElement: [
          {
            '@type': 'Offer',
            itemOffered: {
              '@type': 'Service',
              name: 'Organizacja eventów firmowych',
              serviceType: ['Agencja eventowa', 'Event management'],
              areaServed,
            },
          },
          {
            '@type': 'Offer',
            itemOffered: {
              '@type': 'Service',
              name: 'Teambuildingi i integracje firmowe',
              serviceType: ['Teambuilding', 'Integracje firmowe'],
              areaServed,
            },
          },
          {
            '@type': 'Offer',
            itemOffered: {
              '@type': 'Service',
              name: 'Wieczory tematyczne – Casino Night (kasyno)',
              serviceType: ['Wieczór tematyczny', 'Casino night'],
              areaServed,
            },
          },
        ],
      },
      {
        '@type': 'OfferCatalog',
        name: 'Technika sceniczna i produkcja',
        itemListElement: [
          {
            '@type': 'Offer',
            itemOffered: {
              '@type': 'Service',
              name: 'Technika sceniczna',
              serviceType: ['Technika sceniczna', 'Stage production'],
              areaServed,
            },
          },
          {
            '@type': 'Offer',
            itemOffered: {
              '@type': 'Service',
              name: 'Riderowe nagłośnienie i realizacja dźwięku',
              serviceType: ['Nagłośnienie riderowe', 'Realizacja dźwięku'],
              areaServed,
            },
          },
          {
            '@type': 'Offer',
            itemOffered: {
              '@type': 'Service',
              name: 'Oświetlenie sceniczne',
              serviceType: ['Oświetlenie sceniczne', 'Lighting'],
              areaServed,
            },
          },
        ],
      },
      {
        '@type': 'OfferCatalog',
        name: 'Streaming i multimedia',
        itemListElement: [
          {
            '@type': 'Offer',
            itemOffered: {
              '@type': 'Service',
              name: 'Streaming konferencji i wydarzeń',
              serviceType: ['Streaming', 'Realizacja wideo'],
              areaServed,
            },
          },
          {
            '@type': 'Offer',
            itemOffered: {
              '@type': 'Service',
              name: 'Obsługa multimediów i prezentacji',
              serviceType: ['Multimedia', 'Konferencje'],
              areaServed,
            },
          },
        ],
      },
    ],
  };

  // Schema: zamiast samego Organization -> LocalBusiness + EventPlanner (lokalna intencja)
  const customSchema = globalConfig
  ? {
      '@context': 'https://schema.org',
      '@type': 'LocalBusiness',
      name: globalConfig.organization_name,
      description: metadata?.description,
      url: globalConfig.organization_url,
      logo: globalConfig.organization_logo,
      image: [globalConfig.organization_logo].filter(Boolean),
      telephone: globalConfig.telephone,
      email: globalConfig.email,

      address: {
        '@type': 'PostalAddress',
        streetAddress: globalConfig.street_address,
        addressLocality: globalConfig.locality || 'Olsztyn',
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

      areaServed,

      // ✅ zamiast serviceType na LocalBusiness:
      keywords: [
        'agencja eventowa Olsztyn',
        'organizacja eventów',
        'teambuilding',
        'integracje firmowe',
        'technika sceniczna',
        'nagłośnienie riderowe',
        'oświetlenie sceniczne',
        'streaming konferencji',
        'wieczór kasyno',
        'casino night',
      ],

      knowsAbout: [
        'Organizacja eventów firmowych',
        'Teambuilding i integracje',
        'Wieczory tematyczne (Casino Night)',
        'Technika sceniczna',
        'Nagłośnienie riderowe',
        'Oświetlenie sceniczne',
        'Streaming konferencji i wydarzeń',
        'Realizacja wideo i multimedia',
      ],

      // ✅ usługi opisujemy jako katalog ofert (Service + serviceType jest OK)
      hasOfferCatalog: {
        '@type': 'OfferCatalog',
        name: 'Oferta – Agencja eventowa Olsztyn',
        itemListElement: [
          {
            '@type': 'OfferCatalog',
            name: 'Eventy firmowe, integracje i teambuilding',
            itemListElement: [
              {
                '@type': 'Offer',
                itemOffered: {
                  '@type': 'Service',
                  name: 'Organizacja eventów firmowych',
                  serviceType: 'Event management',
                  areaServed,
                },
              },
              {
                '@type': 'Offer',
                itemOffered: {
                  '@type': 'Service',
                  name: 'Teambuildingi i integracje firmowe',
                  serviceType: 'Teambuilding',
                  areaServed,
                },
              },
              {
                '@type': 'Offer',
                itemOffered: {
                  '@type': 'Service',
                  name: 'Wieczory tematyczne – Casino Night (kasyno)',
                  serviceType: 'Themed event',
                  areaServed,
                },
              },
            ],
          },
          {
            '@type': 'OfferCatalog',
            name: 'Technika sceniczna i produkcja',
            itemListElement: [
              {
                '@type': 'Offer',
                itemOffered: {
                  '@type': 'Service',
                  name: 'Technika sceniczna',
                  serviceType: 'Stage production',
                  areaServed,
                },
              },
              {
                '@type': 'Offer',
                itemOffered: {
                  '@type': 'Service',
                  name: 'Riderowe nagłośnienie i realizacja dźwięku',
                  serviceType: 'Sound reinforcement',
                  areaServed,
                },
              },
              {
                '@type': 'Offer',
                itemOffered: {
                  '@type': 'Service',
                  name: 'Oświetlenie sceniczne',
                  serviceType: 'Event lighting',
                  areaServed,
                },
              },
            ],
          },
          {
            '@type': 'OfferCatalog',
            name: 'Streaming i multimedia',
            itemListElement: [
              {
                '@type': 'Offer',
                itemOffered: {
                  '@type': 'Service',
                  name: 'Streaming konferencji i wydarzeń',
                  serviceType: 'Live streaming',
                  areaServed,
                },
              },
              {
                '@type': 'Offer',
                itemOffered: {
                  '@type': 'Service',
                  name: 'Obsługa multimediów i prezentacji',
                  serviceType: 'AV production',
                  areaServed,
                },
              },
            ],
          },
        ],
      },
    }
  : undefined;

  return (
    <PageLayout pageSlug="home" customSchema={customSchema}>
      <div className="min-h-screen">
        <Hero />
        <Stats />
        <Divider />
        <Services />
        <OfertaSection />
        <Portfolio />
        <DividerTwo />
        <Team />
        <DividerThree />
        <Process />
        <DividerFour />
        <Contact />
        <WebsiteEditPanel />
      </div>
    </PageLayout>
  );
}