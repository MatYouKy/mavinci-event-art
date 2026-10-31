import type { Metadata } from 'next';
import Link from 'next/link';
import PageLayout from '@/components/Layout/PageLayout';
import { ServerBreadcrumb } from '@/components/Layout/ServerBreadcrumb';
import { getPublishedThemedPartyScenarios } from '@/lib/SEO/themedPartyScenarios.server';
import { SCENARIO_PATH } from '@/lib/SEO/themedPartyScenarios';
import { OLSZTYN_THEMED_PARTY_PATH } from '@/lib/SEO/themedPartyContent';
import { SITE, WEBSITE_ID } from '@/lib/SEO/site';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
const pageSlug = SCENARIO_PATH.slice(1);
const title = 'Motywy imprez firmowych — Gatsby, Las Vegas, Hollywood | MAVINCI';
const description = 'Porównaj scenariusze wieczorów tematycznych dla firm. Program, muzyka, dekoracje, technika i rzeczywiste realizacje MAVINCI.';
const labels = { motywy: 'Motywy wieczorów' };
export const metadata: Metadata = { title: { absolute: title }, description, alternates: { canonical: `${SITE.url}${SCENARIO_PATH}` } };

export default async function ThemedPartyScenariosPage() {
  const scenarios = await getPublishedThemedPartyScenarios();
  const url = `${SITE.url}${SCENARIO_PATH}`;
  const schema = { '@context': 'https://schema.org', '@type': 'CollectionPage', '@id': `${url}#webpage`, url, name: title, description, inLanguage: 'pl-PL', isPartOf: { '@id': WEBSITE_ID },
    mainEntity: { '@type': 'ItemList', itemListElement: scenarios.map((item, index) => ({ '@type': 'ListItem', position: index + 1, name: item.label, url: `${SITE.url}${item.href}` })) } };
  return <PageLayout pageSlug={pageSlug} customSchema={schema} breadcrumbLabels={labels}>
    <div className="bg-[#190f1b] px-5 pb-20 pt-28 text-[#e5e4e2] sm:px-6 md:pt-36"><div className="mx-auto max-w-7xl">
      <ServerBreadcrumb pageSlug={pageSlug} labels={labels} />
      <h1 className="mt-6 max-w-4xl text-3xl font-light uppercase leading-tight sm:text-4xl">Jaki motyw wybrać na <span className="text-[#d3bb73]">imprezę firmową?</span></h1>
      <p className="mt-6 max-w-3xl leading-7 text-white/75">Zacznij od celu spotkania. Elegancki bankiet potrzebuje innego rytmu niż swobodna integracja przy stołach kasynowych czy gala z wręczaniem nagród. Zobacz propozycje programu i wybierz kierunek, który pasuje do Twojego zespołu.</p>
      <div className="mt-10 grid gap-6 lg:grid-cols-3">{scenarios.map(item => <article key={item.slug} className="overflow-hidden rounded-2xl bg-white/[0.045]">
        {item.image && <picture>{item.mobileImage && <source media="(max-width: 767px)" srcSet={item.mobileImage} />}<img src={item.thumbnail || item.image} width={800} height={500} alt={item.alt} loading="lazy" decoding="async" className="aspect-[16/10] w-full object-cover" /></picture>}
        <div className="p-6"><h2 className="text-xl text-[#d3bb73]"><Link href={item.href}>{item.label}</Link></h2><p className="mt-4 text-sm leading-6 text-white/75">{item.content.occasion}</p><Link href={item.href} className="mt-5 inline-flex min-h-11 items-center text-sm text-[#d3bb73] underline underline-offset-4">Zobacz program i zakres realizacji ↗</Link></div>
      </article>)}</div>
      <section className="mt-14 rounded-2xl bg-[#341624] p-6 sm:p-9"><h2 className="text-2xl font-light uppercase">Organizacja w Olsztynie i okolicach</h2><p className="mt-4 max-w-3xl leading-7 text-white/75">Biuro i magazyn przy Towarowej 20B to nasza baza przygotowania realizacji. Obsługujemy wydarzenia w wybranych przez klientów obiektach oraz wyjazdowo w innych regionach Polski.</p><Link href={OLSZTYN_THEMED_PARTY_PATH} className="mt-5 inline-flex min-h-11 items-center text-[#d3bb73] underline underline-offset-4">Imprezy tematyczne dla firm w Olsztynie</Link></section>
    </div></div>
  </PageLayout>;
}
