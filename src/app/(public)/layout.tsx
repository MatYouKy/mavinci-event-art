import type { Metadata } from 'next';
import Script from 'next/script';
import { AuthProvider } from '@/contexts/AuthContext';
import { EditModeProvider } from '@/contexts/EditModeContext';
import { SessionTracker } from '@/components/SessionTracker';
import { Providers } from './providers';
import '@/index.css';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { buildBreadcrumbList } from '@/lib/SEO/breadcrumbs';
import { Notification } from '@/components/crm/NotificationCenter';
import { fetchNotificationsServer } from '@/lib/CRM/notifications/fetchNotificationsServer';
import { getCurrentEmployeeServerCached } from '@/lib/CRM/auth/getCurrentEmployeeServer';
import { IEmployee } from '@/app/(crm)/crm/employees/type';
import { cookies } from 'next/headers';

const SITE_URL = 'https://mavinci.pl';
const OG_IMAGE = '/logo-mavinci-crm.png';

// Miasta / obszar (ok. 250 km od Olsztyna) – możesz rozszerzać
const AREA_CITIES = [
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

const PRIMARY_TITLE =
  'Agencja eventowa Olsztyn – MAVINCI Event & ART | Eventy, technika sceniczna, streaming';
const PRIMARY_DESC =
  'MAVINCI Event & ART – agencja eventowa w Olsztynie. Organizacja eventów firmowych, teambuildingi i integracje, wieczory tematyczne (kasyno), streaming konferencji, riderowe nagłośnienie, oświetlenie i technika sceniczna. Obsługujemy Olsztyn i miasta w promieniu ok. 250 km.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),

  // Title template pomaga SEO na podstronach
  title: {
    default: PRIMARY_TITLE,
    template: '%s | MAVINCI Event & ART',
  },

  description: PRIMARY_DESC,

  // Nie każdy bot używa keywords, ale nadal potrafią pomóc (plus: wewnętrzne systemy/CMS)
  keywords: [
    'agencja eventowa Olsztyn',
    'organizacja eventów Olsztyn',
    'eventy firmowe Olsztyn',
    'teambuilding Olsztyn',
    'integracje firmowe Olsztyn',
    'wieczór kasyno Olsztyn',
    'casino night',
    'technika sceniczna Olsztyn',
    'nagłośnienie riderowe',
    'nagłośnienie koncertowe',
    'oświetlenie sceniczne',
    'scenografia eventowa',
    'streaming konferencji',
    'realizacja wideo event',
    'obsługa konferencji',
    'multimedia na event',
    // miasta
    ...AREA_CITIES.flatMap((city) => [
      `agencja eventowa ${city}`,
      `organizacja eventów ${city}`,
      `teambuilding ${city}`,
      `streaming ${city}`,
      `technika sceniczna ${city}`,
    ]),
  ],

  authors: [{ name: 'MAVINCI Event & ART' }],
  creator: 'MAVINCI Event & ART',
  publisher: 'MAVINCI Event & ART',
  category: 'Event Planning',

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
    locale: 'pl_PL',
    url: SITE_URL,
    siteName: 'MAVINCI Event & ART',
    title: PRIMARY_TITLE,
    description: PRIMARY_DESC,
    images: [
      {
        url: OG_IMAGE,
        width: 1200,
        height: 630,
        alt: 'MAVINCI Event & ART – Agencja eventowa Olsztyn',
      },
    ],
  },

  twitter: {
    card: 'summary_large_image',
    title: PRIMARY_TITLE,
    description: PRIMARY_DESC,
    images: [OG_IMAGE],
  },

  verification: {
    google: 'google-site-verification=qIraUGTmchH_bL3HeOYo_16-6U7R1os1yMel7',
  },

  icons: {
    icon: [{ url: '/shape-mavinci.svg', type: 'image/svg+xml' }],
    shortcut: '/shape-mavinci.svg',
    apple: '/shape-mavinci.svg',
  },

  // Dodatkowe meta pod lokalność (nie „czaruje” pozycji, ale wzmacnia sygnały)
  other: {
    'geo.region': 'PL-WN',
    'geo.placename': 'Olsztyn',
    ICBM: 'Olsztyn, Poland', // bez współrzędnych, bo ich nie podajesz
  },
};
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function RootLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { pathname: string };
}) {
  
  const breadcrumbSchema = buildBreadcrumbList(params.pathname);
  const cookieStore = cookies(); // ✅ w request scope
  const { notifications, unreadCount } = await fetchNotificationsServer(cookieStore, 100);
  
  const employee = await getCurrentEmployeeServerCached();

  const localBusiness = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: 'MAVINCI Event & ART',
    url: SITE_URL,
    potentialAction: {
      '@type': 'SearchAction',
      target: 'https://mavinci.pl/szukaj?q={search_term_string}',
      'query-input': 'required name=search_term_string',
    },
    logo: `${SITE_URL}${OG_IMAGE}`,
    image: [`${SITE_URL}${OG_IMAGE}`],
    description: PRIMARY_DESC,

    // Lokalizacja bez dokładnego adresu (nie wymyślam ulicy) – wystarczy na start
    address: {
      '@type': 'PostalAddress',
      addressLocality: 'Olsztyn',
      addressRegion: 'Warmińsko-Mazurskie',
      addressCountry: 'PL',
    },

    areaServed: [
      { '@type': 'City', name: 'Olsztyn' },
      ...AREA_CITIES.filter((c) => c !== 'Olsztyn').map((city) => ({
        '@type': 'City',
        name: city,
      })),
      { '@type': 'Country', name: 'Poland' },
    ],

    sameAs: ['https://www.facebook.com/mavinci.pl', 'https://www.instagram.com/mavinci.pl'],

    contactPoint: [
      {
        '@type': 'ContactPoint',
        contactType: 'sales',
        availableLanguage: ['pl', 'en'],
        areaServed: 'PL',
      },
    ],

    // Oferta w strukturze katalogu – Google lubi jasne kategorie usług
    hasOfferCatalog: {
      '@type': 'OfferCatalog',
      name: 'Oferta – Agencja eventowa Olsztyn',
      itemListElement: [
        {
          '@type': 'OfferCatalog',
          name: 'Eventy firmowe i integracje',
          itemListElement: [
            {
              '@type': 'Offer',
              itemOffered: {
                '@type': 'Service',
                name: 'Organizacja eventów firmowych',
                serviceType: ['Agencja eventowa', 'Event management'],
                areaServed: 'PL',
              },
            },
            {
              '@type': 'Offer',
              itemOffered: {
                '@type': 'Service',
                name: 'Teambuildingi i integracje firmowe',
                serviceType: ['Teambuilding', 'Integracje firmowe'],
                areaServed: 'PL',
              },
            },
            {
              '@type': 'Offer',
              itemOffered: {
                '@type': 'Service',
                name: 'Wieczory tematyczne – Casino Night (kasyno)',
                serviceType: ['Wieczór tematyczny', 'Casino night'],
                areaServed: 'PL',
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
                areaServed: 'PL',
              },
            },
            {
              '@type': 'Offer',
              itemOffered: {
                '@type': 'Service',
                name: 'Riderowe nagłośnienie i realizacja dźwięku',
                serviceType: ['Nagłośnienie riderowe', 'Realizacja dźwięku'],
                areaServed: 'PL',
              },
            },
            {
              '@type': 'Offer',
              itemOffered: {
                '@type': 'Service',
                name: 'Oświetlenie sceniczne',
                serviceType: ['Oświetlenie sceniczne', 'Lighting'],
                areaServed: 'PL',
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
                areaServed: 'PL',
              },
            },
            {
              '@type': 'Offer',
              itemOffered: {
                '@type': 'Service',
                name: 'Obsługa multimediów i prezentacji',
                serviceType: ['Multimedia', 'Konferencje'],
                areaServed: 'PL',
              },
            },
          ],
        },
      ],
    },
  };

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      localBusiness,
      breadcrumbSchema, // <- osobny typ BreadcrumbList
    ].filter(Boolean),
  };

  return (
    <html lang="pl">
      <head>
        {/* Google Tag */}
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-BHPZ5NSLQM"
          strategy="afterInteractive"
          async
        />
        <Script id="gtag-init" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-BHPZ5NSLQM', { page_path: window.location.pathname });
          `}
        </Script>

        {/* JSON-LD (WAŻNE): włączone */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body>
        <Providers>
          <AuthProvider>
            <EditModeProvider>
              <SessionTracker />
              <Navbar initialNotifications={notifications} initialEmployee={employee as IEmployee} />
              {children as React.ReactNode}
              <Footer />
            </EditModeProvider>
          </AuthProvider>
        </Providers>
      </body>
    </html>
  );
}
