import type { Metadata } from 'next';
import { AuthProvider } from '@/contexts/AuthContext';
import { EditModeProvider } from '@/contexts/EditModeContext';
import { Providers } from './providers';
import '@/index.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://mavinci.pl'),
  title: {
    default: 'MAVINCI Event & ART - Profesjonalna obsługa eventów | DJ, Nagłośnienie, Oświetlenie',
    template: '%s | MAVINCI Event & ART',
  },
  description:
    'MAVINCI Event & ART - kompleksowa obsługa wydarzeń firmowych i prywatnych. DJ, nagłośnienie, oświetlenie sceniczne, streaming, atrakcje eventowe. Działamy w całej Polsce.',
  keywords: [
    'event',
    'eventy firmowe',
    'obsługa eventów',
    'DJ na event',
    'nagłośnienie',
    'oświetlenie sceniczne',
    'streaming eventów',
    'atrakcje eventowe',
    'technika sceniczna',
    'mavinci',
    'organizacja eventów',
    'imprezy firmowe',
    'konferencje',
    'wesela',
  ],
  authors: [{ name: 'MAVINCI Event & ART' }],
  creator: 'MAVINCI Event & ART',
  publisher: 'MAVINCI Event & ART',
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
    url: 'https://mavinci.pl',
    siteName: 'MAVINCI Event & ART',
    title: 'MAVINCI Event & ART - Profesjonalna obsługa eventów',
    description:
      'Kompleksowa obsługa wydarzeń firmowych i prywatnych. DJ, nagłośnienie, oświetlenie, streaming, atrakcje eventowe.',
    images: [
      {
        url: '/logo-mavinci-crm.png',
        width: 1200,
        height: 630,
        alt: 'MAVINCI Event & ART Logo',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'MAVINCI Event & ART - Profesjonalna obsługa eventów',
    description:
      'Kompleksowa obsługa wydarzeń firmowych i prywatnych. DJ, nagłośnienie, oświetlenie, streaming.',
    images: ['/logo-mavinci-crm.png'],
  },
  alternates: {
    canonical: 'https://mavinci.pl',
  },
  verification: {
    google: 'verification_token',
  },
  icons: {
    icon: [{ url: '/shape-mavinci.svg', type: 'image/svg+xml' }],
    shortcut: '/shape-mavinci.svg',
    apple: '/shape-mavinci.svg',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'MAVINCI Event & ART',
    url: 'https://mavinci.pl',
    logo: 'https://mavinci.pl/logo-mavinci-crm.png',
    description:
      'Profesjonalna obsługa eventów firmowych i prywatnych. DJ, nagłośnienie, oświetlenie sceniczne, streaming, atrakcje eventowe.',
    address: {
      '@type': 'PostalAddress',
      addressCountry: 'PL',
    },
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'customer service',
      availableLanguage: ['Polish', 'English'],
    },
    sameAs: ['https://www.facebook.com/mavinci.pl', 'https://www.instagram.com/mavinci.pl'],
    areaServed: {
      '@type': 'Country',
      name: 'Poland',
    },
    serviceType: [
      'Obsługa eventów',
      'DJ na eventy',
      'Nagłośnienie',
      'Oświetlenie sceniczne',
      'Streaming wydarzeń',
      'Technika sceniczna',
      'Atrakcje eventowe',
      'Organizacja konferencji',
      'Imprezy firmowe',
    ],
  };

  return (
    <html lang="pl">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#d3bb73" />
        <link rel="icon" type="image/svg+xml" href="/shape-mavinci.svg" />
        <link rel="canonical" href="https://mavinci.pl" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body>
        <Providers>
          <AuthProvider>
            <EditModeProvider>{children}</EditModeProvider>
          </AuthProvider>
        </Providers>
      </body>
    </html>
  );
}
