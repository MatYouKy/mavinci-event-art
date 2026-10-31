import type { Metadata } from 'next';
import { cache } from 'react';
import Link from 'next/link';
import { Dice1 } from 'lucide-react';
import PageLayout from '@/components/Layout/PageLayout';
import { ServerBreadcrumb } from '@/components/Layout/ServerBreadcrumb';
import { getPublishedCasinoCities } from '@/lib/SEO/casinoCityData.server';
import { getPublicPageMetadata } from '@/lib/SEO/publicData';
import { SITE, WEBSITE_ID } from '@/lib/SEO/site';
import CasinoLocationsClient from './CasinoLocationsClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
const pageSlug = 'oferta/kasyno/lokalizacje';
const canonicalUrl = `${SITE.url}/${pageSlug}`;
const getDirectoryMetadata = cache(async () => {
  const [current, legacy] = await Promise.all([
    getPublicPageMetadata(pageSlug), getPublicPageMetadata('kasyno-lokalizacje'),
  ]);
  const metadata = current || legacy;
  return {
    title: metadata?.title || 'Kasyno na eventy firmowe — miasta i lokalizacje | MAVINCI',
    description: metadata?.description || 'Kasyno rozrywkowe na imprezy firmowe, integracje i gale. Sprawdź obsługiwane miasta i zapytaj o stoły do ruletki, blackjacka i pokera z krupierami MAVINCI.',
    image: metadata?.og_image || `${SITE.url}/logo-mavinci-crm.png`,
  };
});

export async function generateMetadata(): Promise<Metadata> {
  const { title, description, image } = await getDirectoryMetadata();
  return {
    title: { absolute: title }, description, alternates: { canonical: canonicalUrl },
    openGraph: { type: 'website', title, description, url: canonicalUrl, locale: 'pl_PL', siteName: SITE.name, images: [image] },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
  };
}

export default async function CasinoLokalizacjePage() {
  const [cities, metadata] = await Promise.all([getPublishedCasinoCities(), getDirectoryMetadata()]);
  const schema = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage', '@id': `${canonicalUrl}#webpage`, url: canonicalUrl,
        name: metadata.title, description: metadata.description, inLanguage: 'pl-PL',
        isPartOf: { '@id': WEBSITE_ID }, mainEntity: { '@id': `${canonicalUrl}#miasta` },
      },
      {
        '@type': 'ItemList', '@id': `${canonicalUrl}#miasta`, numberOfItems: cities.length,
        itemListElement: cities.map((city, index) => ({
          '@type': 'ListItem', position: index + 1, name: city.name,
          url: `${SITE.url}/oferta/kasyno/${city.locality}`,
        })),
      },
    ],
  };
  return (
    <PageLayout pageSlug={pageSlug} customSchema={schema} breadcrumbLabels={{ lokalizacje: 'Lokalizacje' }}>
      <main className="min-h-screen bg-[#190f1b] pt-28 text-[#e5e4e2]">
        <div className="mx-auto max-w-7xl px-5 sm:px-6">
          <ServerBreadcrumb pageSlug={pageSlug} labels={{ lokalizacje: 'Lokalizacje' }} />
        </div>
        <header className="px-5 py-12 sm:px-6 md:py-16">
          <div className="mx-auto max-w-4xl text-center">
            <Dice1 className="mx-auto mb-6 h-12 w-12 text-[#d3bb73]" aria-hidden="true" />
            <h1 className="text-3xl font-light uppercase leading-tight sm:text-4xl md:text-5xl">
              Kasyno na eventy <span className="text-[#d3bb73]">w całej Polsce</span>
            </h1>
            <p className="mt-6 text-lg leading-8 text-white/75">
              Ruletka, blackjack i poker z obsługą krupierską na imprezy firmowe,
              integracje i wieczory po konferencji. Wybierz miasto i poznaj ofertę.
              Transport, montaż oraz zakres ustalimy dla Twojego wydarzenia.
            </p>
            <Link href="/oferta/kasyno" className="mt-5 inline-flex min-h-11 items-center text-[#d3bb73] underline underline-offset-4">Poznaj ofertę kasyna eventowego</Link>
          </div>
        </header>
        <CasinoLocationsClient cities={cities.map(city => ({
          id: city.id, locality: city.locality, name: city.name, region: city.region || 'Pozostałe lokalizacje',
        }))} />
        <section className="border-t border-white/10 px-5 py-16 sm:px-6">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-2xl font-light uppercase sm:text-3xl">Nie widzisz swojej lokalizacji?</h2>
            <p className="mt-5 text-lg leading-8 text-white/70">
              Obsługujemy wydarzenia w całej Polsce. Podaj miejscowość, termin,
              liczbę gości i planowany czas zabawy — przygotujemy indywidualną ofertę.
            </p>
            <Link href="/#kontakt" className="mt-7 inline-flex min-h-12 items-center rounded-full bg-[#d3bb73] px-7 py-3 text-[#190f1b]">Zapytaj o swoje wydarzenie</Link>
          </div>
        </section>
      </main>
    </PageLayout>
  );
}
