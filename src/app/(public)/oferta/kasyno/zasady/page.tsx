import type { Metadata } from 'next';
import Link from 'next/link';
import PageLayout from '@/components/Layout/PageLayout';
import { ServerBreadcrumb } from '@/components/Layout/ServerBreadcrumb';
import { getPublishedCasinoRules } from '@/lib/SEO/casinoRules.server';
import { SITE, WEBSITE_ID } from '@/lib/SEO/site';

export const dynamic = 'force-dynamic';
const pageSlug = 'oferta/kasyno/zasady';
const url = `${SITE.url}/${pageSlug}`;
const title = 'Zasady kasyna eventowego: poker, blackjack i ruletka | MAVINCI';
const description = 'Poznaj zasady gier w kasynie rozrywkowym MAVINCI. Przygotowanie do integracji przy stołach, bez zakładów pieniężnych.';
export const metadata: Metadata = { title: { absolute: title }, description, alternates: { canonical: url }, openGraph: { type: 'website', title, description, url } };

export default async function CasinoRulesIndexPage() {
  const rules = await getPublishedCasinoRules();
  const schema = { '@context': 'https://schema.org', '@type': 'CollectionPage', '@id': `${url}#webpage`, url, name: title, description, isPartOf: { '@id': WEBSITE_ID },
    mainEntity: { '@type': 'ItemList', itemListElement: rules.map((rule, index) => ({ '@type': 'ListItem', position: index + 1, name: rule.game_name, url: `${SITE.url}${rule.path}` })) } };
  return <PageLayout pageSlug={pageSlug} customSchema={schema}>
    <main className="min-h-screen bg-[#190f1b] px-5 pb-20 pt-28 text-[#e5e4e2] sm:px-6 md:pt-36"><div className="mx-auto max-w-5xl">
      <ServerBreadcrumb pageSlug={pageSlug} />
      <h1 className="mt-8 text-3xl font-light uppercase sm:text-4xl">Zasady <span className="text-[#d3bb73]">kasyna eventowego</span></h1>
      <p className="mt-6 max-w-3xl leading-7 text-white/75">Wybierz grę i poznaj jej przebieg przed spotkaniem. Kasyno MAVINCI jest atrakcją integracyjną bez zakładów pieniężnych. Podczas wydarzenia krupierzy objaśniają zasady uczestnikom.</p>
      <ul className="mt-8 grid gap-4 sm:grid-cols-3">{rules.map(rule => <li key={rule.route}><Link href={rule.path} className="block h-full rounded-2xl bg-white/[0.045] p-6 hover:bg-white/10"><h2 className="text-xl text-[#d3bb73]">{rule.game_name}</h2><p className="mt-3 text-sm leading-6 text-white/75">{rule.short_description}</p><span className="mt-5 inline-block text-sm text-[#d3bb73]">Poznaj zasady ↗</span></Link></li>)}</ul>
      <Link href="/oferta/kasyno" className="mt-8 inline-flex min-h-11 items-center text-[#d3bb73] underline underline-offset-4">Wróć do oferty kasyna eventowego</Link>
    </div></main>
  </PageLayout>;
}
