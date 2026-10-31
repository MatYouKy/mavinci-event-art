import 'server-only';
import type { Metadata } from 'next';
import Link from 'next/link';
import PageLayout from './PageLayout';
import { ServerBreadcrumb } from './ServerBreadcrumb';
import ServiceCityDirectory, { type ServiceCity } from './ServiceCityDirectory';
import { getPublishedConferenceCities, publicSupabase } from '@/lib/SEO/publicData';
import { getPublishedQuizCities } from '@/lib/quiz-shows/content';
import { SITE, WEBSITE_ID } from '@/lib/SEO/site';

const SERVICES = {
  konferencje: {
    name: 'Obsługa techniczna konferencji',
    description: 'Wybierz lokalizację obsługi konferencji MAVINCI: nagłośnienie, oświetlenie, ekrany LED, multimedia i streaming. Sprawdź warunki przygotowania wydarzenia.',
    intro: 'Wybierz miasto i poznaj zakres techniki oraz informacje potrzebne do przygotowania konferencji. Dobieramy nagłośnienie, światło, ekrany i obsługę do sali oraz programu spotkania.',
  },
  streaming: {
    name: 'Streaming i transmisje wydarzeń',
    description: 'Lokalizacje realizacji streamingu MAVINCI. Transmisje konferencji, wydarzeń hybrydowych i firmowych: obraz, dźwięk i obsługa realizatorów.',
    intro: 'Planujesz transmisję konferencji lub wydarzenie hybrydowe? Wybierz lokalizację i sprawdź ofertę realizacji obrazu oraz dźwięku. Połączenie internetowe, platformę emisji i pracę kamer ustalamy dla konkretnego obiektu.',
  },
  'quizy-teleturnieje': {
    name: 'Quizy i teleturnieje dla firm',
    description: 'Poznaj lokalną ofertę quizów i teleturniejów MAVINCI. Integracja pracowników, wieczory po konferencjach, prowadzenie i zaplecze techniczne.',
    intro: 'Wybierz opublikowaną ofertę lokalną i poznaj warunki przygotowania teleturnieju. Quiz możemy dopasować do integracji, kolacji firmowej lub wieczoru po konferencji. O realizację w innym mieście zapytaj bezpośrednio.',
  },
} as const;
type Service = keyof typeof SERVICES;

export function serviceLocationsMetadata(service: Service): Metadata {
  const config = SERVICES[service];
  const title = `${config.name} — lokalizacje | MAVINCI`;
  const url = `${SITE.url}/oferta/${service}/lokalizacje`;
  return { title: { absolute: title }, description: config.description, alternates: { canonical: url },
    robots: { index: true, follow: true }, openGraph: { type: 'website', title, description: config.description, url, locale: 'pl_PL' } };
}

async function getCities(service: Service): Promise<ServiceCity[]> {
  if (service === 'quizy-teleturnieje') return getPublishedQuizCities().map(city => ({ slug: city.slug, name: city.name, region: null }));
  if (service === 'konferencje') return (await getPublishedConferenceCities())
    .map(city => ({ slug: city.locality, name: city.name, region: city.region }));
  const { data, error } = await publicSupabase().from('schema_org_places').select('locality,name,region')
    .eq('is_active', true).eq('is_global', true).order('name');
  if (error) throw new Error('Nie udało się pobrać lokalizacji streamingu.');
  return (data || []).filter(city => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(city.locality || ''))
    .map(city => ({ slug: city.locality, name: city.name, region: city.region }));
}

export default async function ServiceLocationsPage({ service }: { service: Service }) {
  const config = SERVICES[service];
  const cities = (await getCities(service)).filter(city => city.slug !== 'lokalizacje').sort((a, b) => a.name.localeCompare(b.name, 'pl'));
  const basePath = `/oferta/${service}`;
  const pageSlug = `oferta/${service}/lokalizacje`;
  const url = `${SITE.url}/${pageSlug}`;
  const schema = { '@context': 'https://schema.org', '@type': 'CollectionPage', '@id': `${url}#webpage`, url,
    name: `${config.name} — lokalizacje`, description: config.description, inLanguage: 'pl-PL', isPartOf: { '@id': WEBSITE_ID },
    mainEntity: { '@type': 'ItemList', itemListElement: cities.map((city, index) => ({ '@type': 'ListItem', position: index + 1, name: city.name, url: `${SITE.url}${basePath}/${city.slug}` })) } };
  return <PageLayout pageSlug={pageSlug} customSchema={schema}>
    <main className="min-h-screen bg-[#190f1b] px-5 pb-20 pt-28 text-[#e5e4e2] sm:px-6 md:pt-36"><div className="mx-auto max-w-7xl">
      <ServerBreadcrumb pageSlug={pageSlug} />
      <h1 className="mt-8 max-w-4xl text-3xl font-light uppercase leading-tight sm:text-4xl">{config.name} — <span className="text-[#d3bb73]">lokalizacje</span></h1>
      <p className="mt-6 max-w-3xl leading-7 text-white/80">{config.intro}</p>
      <p className="mt-4 max-w-3xl text-sm leading-7 text-white/60">Biuro i magazyn MAVINCI znajdują się przy ul. Towarowej 20B w Olsztynie. Pozostałe miasta oznaczają obszar obsługi z dojazdem. Transport, montaż i dostępność zespołu potwierdzamy w indywidualnej ofercie.</p>
      <ServiceCityDirectory cities={cities} basePath={basePath} />
      <div className="mt-12 flex flex-wrap gap-x-7 gap-y-2"><Link href={basePath} className="inline-flex min-h-11 items-center text-[#d3bb73] underline underline-offset-4">Poznaj pełną ofertę</Link><Link href="/#kontakt" className="inline-flex min-h-11 items-center text-[#d3bb73] underline underline-offset-4">Zapytaj o inne miejsce realizacji</Link></div>
    </div></main>
  </PageLayout>;
}
