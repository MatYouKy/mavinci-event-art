import type { Metadata } from 'next';
import Link from 'next/link';
import PageLayout from '@/components/Layout/PageLayout';
import { ServerBreadcrumb } from '@/components/Layout/ServerBreadcrumb';
import { getPublishedThemedPartyCities } from '@/lib/SEO/themedPartyData.server';
import { THEMED_PARTY_PATH } from '@/lib/SEO/themedPartyContent';
import { SITE, WEBSITE_ID } from '@/lib/SEO/site';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
const pageSlug = 'oferta/wieczory-tematyczne/lokalizacje';
const url = `${SITE.url}/${pageSlug}`;
const title = 'Imprezy tematyczne dla firm — lokalizacje obsługi | MAVINCI';
const description = 'Wybierz miasto i poznaj ofertę wieczorów tematycznych MAVINCI. Organizacja imprez firmowych, muzyka, dekoracje i technika z dojazdem z Olsztyna.';
export const metadata: Metadata = { title: { absolute: title }, description, alternates: { canonical: url }, openGraph: { type: 'website', title, description, url } };

export default async function ThemedPartyLocationsPage() {
  const cities = await getPublishedThemedPartyCities();
  const regions = [...new Set(cities.map(city => city.region || 'Pozostałe lokalizacje'))];
  const schema = { '@context': 'https://schema.org', '@type': 'CollectionPage', '@id': `${url}#webpage`, url, name: title, description, isPartOf: { '@id': WEBSITE_ID },
    mainEntity: { '@type': 'ItemList', itemListElement: cities.map((city, index) => ({ '@type': 'ListItem', position: index + 1, name: city.name, url: `${SITE.url}${THEMED_PARTY_PATH}/${city.locality}` })) } };
  return <PageLayout pageSlug={pageSlug} customSchema={schema}>
    <div className="bg-[#190f1b] px-5 pb-20 pt-28 text-[#e5e4e2] sm:px-6 md:pt-36"><div className="mx-auto max-w-7xl">
      <ServerBreadcrumb pageSlug={pageSlug} />
      <h1 className="mt-5 max-w-4xl text-3xl font-light uppercase sm:text-4xl">Imprezy tematyczne dla firm — <span className="text-[#d3bb73]">lokalizacje obsługi</span></h1>
      <p className="mt-6 max-w-3xl leading-7 text-white/75">Przygotowujemy wieczory po konferencjach, integracje i gale w wybranym przez Ciebie miejscu. Biuro i magazyn MAVINCI znajdują się w Olsztynie; pozostałe lokalizacje oznaczają obszar obsługi z dojazdem. Warunki transportu i montażu uzgadniamy przed wyceną.</p>
      {regions.map(region => <section key={region} className="mt-12"><h2 className="text-xl text-[#d3bb73]">{region}</h2><ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{cities.filter(city => (city.region || 'Pozostałe lokalizacje') === region).map(city => <li key={city.id}><Link className="flex min-h-14 items-center justify-between rounded-xl bg-white/[0.045] px-5 py-4 hover:bg-white/10" href={`${THEMED_PARTY_PATH}/${city.locality}`}>{city.name}<span aria-hidden="true" className="text-[#d3bb73]">↗</span></Link></li>)}</ul></section>)}
      <Link href={THEMED_PARTY_PATH} className="mt-10 inline-flex min-h-11 items-center text-[#d3bb73] underline underline-offset-4">Poznaj motywy wieczorów tematycznych</Link>
    </div></div>
  </PageLayout>;
}
