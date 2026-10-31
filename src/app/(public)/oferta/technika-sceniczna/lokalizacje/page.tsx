import type { Metadata } from 'next';
import { cache } from 'react';
import Link from 'next/link';
import PageLayout from '@/components/Layout/PageLayout';
import { ServerBreadcrumb } from '@/components/Layout/ServerBreadcrumb';
import { getPublishedTechnicalStageCities } from '@/lib/SEO/technicalStageData.server';
import { getPublicPageMetadata } from '@/lib/SEO/publicData';
import { SITE, WEBSITE_ID } from '@/lib/SEO/site';
import TechnicalStageLocationsClient from './TechnicalStageLocationsClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
const pageSlug = 'oferta/technika-sceniczna/lokalizacje';
const canonicalUrl = `${SITE.url}/${pageSlug}`;
const getDirectoryMetadata = cache(async () => {
  const [current, legacy] = await Promise.all([getPublicPageMetadata(pageSlug), getPublicPageMetadata('technika-sceniczna-lokalizacje')]);
  const metadata = current || legacy;
  return {
    title: metadata?.title || 'Technika sceniczna i eventowa — miasta | MAVINCI',
    description: metadata?.description || 'Nagłośnienie Meyer Sound, oświetlenie, LED wewnętrzny i zewnętrzny, totemy, telewizory i realizatorzy. Sprawdź ofertę MAVINCI dla swojego miasta.',
    image: metadata?.og_image || `${SITE.url}/logo-mavinci-crm.png`,
  };
});
export async function generateMetadata(): Promise<Metadata> {
  const { title, description, image } = await getDirectoryMetadata();
  return { title: { absolute: title }, description, alternates: { canonical: canonicalUrl },
    openGraph: { type: 'website', title, description, url: canonicalUrl, locale: 'pl_PL', siteName: SITE.name, images: [image] },
    twitter: { card: 'summary_large_image', title, description, images: [image] } };
}
export default async function TechnicalStageLocationsPage() {
  const [cities, metadata] = await Promise.all([getPublishedTechnicalStageCities(), getDirectoryMetadata()]);
  const schema = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'CollectionPage', '@id': `${canonicalUrl}#webpage`, url: canonicalUrl, name: metadata.title,
      description: metadata.description, inLanguage: 'pl-PL', isPartOf: { '@id': WEBSITE_ID }, mainEntity: { '@id': `${canonicalUrl}#miasta` } },
    { '@type': 'ItemList', '@id': `${canonicalUrl}#miasta`, numberOfItems: cities.length,
      itemListElement: cities.map((city, i) => ({ '@type': 'ListItem', position: i + 1, name: city.name, url: `${SITE.url}/oferta/technika-sceniczna/${city.locality}` })) },
  ] };
  return <PageLayout pageSlug={pageSlug} customSchema={schema} breadcrumbLabels={{ lokalizacje: 'Lokalizacje', 'technika-sceniczna': 'Technika sceniczna i eventowa' }}>
    <main className="min-h-screen bg-[#190f1b] pt-28 text-[#e5e4e2]">
      <div className="mx-auto max-w-7xl px-5 sm:px-6"><ServerBreadcrumb pageSlug={pageSlug} labels={{ lokalizacje: 'Lokalizacje', 'technika-sceniczna': 'Technika sceniczna i eventowa' }} /></div>
      <header className="px-5 py-12 sm:px-6 md:py-16"><div className="mx-auto max-w-4xl text-center">
        <p className="mb-4 text-sm text-[#d3bb73]">MAVINCI · nagłośnienie, światło, obraz</p>
        <h1 className="text-3xl font-light uppercase leading-tight sm:text-4xl md:text-5xl">Technika sceniczna i eventowa <span className="text-[#d3bb73]">w Twoim mieście</span></h1>
        <p className="mt-6 text-lg leading-8 text-white/75">Obsługa imprez firmowych, gal, koncertów i plenerów. Własny system Meyer Sound LINA, oświetlenie, ekrany LED wewnętrzne i zewnętrzne, totemy, telewizory oraz streaming. Wybierz lokalizację, poznaj zakres i zapytaj o termin.</p>
        <p className="mt-4 leading-7 text-white/60">Nasze biuro i magazyn znajdują się w Olsztynie. Transport, montaż i obsługę w wybranym mieście uwzględniamy w indywidualnej ofercie.</p>
        <Link href="/oferta/technika-sceniczna" className="mt-5 inline-flex min-h-11 items-center text-[#d3bb73] underline underline-offset-4">Poznaj pełną ofertę techniczną</Link>
      </div></header>
      <TechnicalStageLocationsClient cities={cities.map(city => ({ id: city.id, locality: city.locality, name: city.name, region: city.region ? city.region.toLocaleLowerCase('pl-PL').replace(/^województwo /, '') : 'Pozostałe lokalizacje' }))} />
      <section className="px-5 py-16 sm:px-6"><div className="mx-auto max-w-3xl text-center">
        <h2 className="text-2xl font-light uppercase sm:text-3xl">Wydarzenie w innej miejscowości?</h2>
        <p className="mt-5 text-lg leading-8 text-white/70">Obsługujemy wydarzenia w całej Polsce. Podaj adres, datę, liczbę uczestników i program — ustalimy sprzęt, realizatorów oraz logistykę.</p>
        <Link href="/#kontakt" className="mt-7 inline-flex min-h-12 items-center rounded-full bg-[#d3bb73] px-7 py-3 text-[#190f1b]">Zapytaj o obsługę wydarzenia</Link>
      </div></section>
    </main>
  </PageLayout>;
}
