import type { Metadata } from 'next';
import Script from 'next/script';
import { AuthProvider } from '@/contexts/AuthContext';
import { EditModeProvider } from '@/contexts/EditModeContext';
import { SessionTracker } from '@/components/SessionTracker';
import { Providers } from './providers';
import '@/index.css';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { SITE, buildSiteGraph, officialProfiles } from '@/lib/SEO/site';
import { getPublicGlobalConfig } from '@/lib/SEO/publicData';
import { JsonLd } from '@/components/Layout/JsonLd';
import { fetchNotificationsServer } from '@/lib/CRM/notifications/fetchNotificationsServer';
import { getCurrentEmployeeServerCached } from '@/lib/CRM/auth/getCurrentEmployeeServer';
import { IEmployee } from '@/app/(crm)/crm/employees/type';
import { cookies } from 'next/headers';
import BrandThemeProvider from '@/components/BrandThemeProvider';

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  // Existing CMS page titles already contain the brand.
  title: { default: SITE.title, template: '%s' },
  description: SITE.description,
  authors: [{ name: SITE.name }], creator: SITE.name, publisher: SITE.name,
  robots: { index: true, follow: true, googleBot: {
    index: true, follow: true, 'max-video-preview': -1,
    'max-image-preview': 'large', 'max-snippet': -1,
  } },
  openGraph: { type: 'website', locale: 'pl_PL', siteName: SITE.name,
    title: SITE.title, description: SITE.description,
    images: [{ url: '/logo-mavinci-crm.png', alt: SITE.name }] },
  twitter: { card: 'summary_large_image', title: SITE.title,
    description: SITE.description, images: ['/logo-mavinci-crm.png'] },
  verification: { google: process.env.GOOGLE_SITE_VERIFICATION || 'qIraUGTmchH_bL3HeOYo_16-6U7R1os1yMel7' },
  icons: { icon: [{ url: '/signature.png', type: 'image/png' }],
    shortcut: '/signature.png', apple: '/signature.png' },
};
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = cookies();
  const [{ notifications }, employee, globalConfig] = await Promise.all([
    fetchNotificationsServer(cookieStore, 100), getCurrentEmployeeServerCached(), getPublicGlobalConfig(),
  ]);
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

        <JsonLd data={buildSiteGraph(globalConfig)} />
      </head>
      <body className="brand-theme" data-brand-theme="mavinci">
        <BrandThemeProvider />
        <Providers>
          <AuthProvider>
            <EditModeProvider>
              <SessionTracker />
              <Navbar initialNotifications={notifications} initialEmployee={employee as IEmployee} />
              {children as React.ReactNode}
              <Footer profiles={officialProfiles(globalConfig)} />
            </EditModeProvider>
          </AuthProvider>
        </Providers>
      </body>
    </html>
  );
}
