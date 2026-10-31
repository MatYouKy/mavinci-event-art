import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import PageLayout from '@/components/Layout/PageLayout';
import { ServerBreadcrumb } from '@/components/Layout/ServerBreadcrumb';
import { getUserPermissions } from '@/lib/serverAuth';
import { getTechnicalStageCityData } from '@/lib/SEO/technicalStageData.server';
import { SITE, ORGANIZATION_ID, WEBSITE_ID } from '@/lib/SEO/site';
import TechnicalStageCityHero from './TechnicalStageCityHero';
import TechnicalStageCitySections from './TechnicalStageCitySections';
import TechnicalStageCityContentEditor from './TechnicalStageCityContentEditor';
import TechStageCityAdminClient from './TechStageCityAdminClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
type Props = { params: { miasto: string } };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const data = await getTechnicalStageCityData(params.miasto);
  if (!data) return { title: 'Nie znaleziono strony | MAVINCI', robots: { index: false, follow: true } };
  const { metaTitle, description, canonicalUrl, ogImage, keywords } = data;
  return {
    title: { absolute: metaTitle }, description, keywords, alternates: { canonical: canonicalUrl },
    openGraph: { type: 'website', locale: 'pl_PL', url: canonicalUrl, title: metaTitle, description,
      siteName: SITE.name, images: [{ url: ogImage, alt: 'Technika sceniczna i eventowa MAVINCI' }] },
    twitter: { card: 'summary_large_image', title: metaTitle, description, images: [ogImage] },
  };
}

export default async function TechnicalStageCityPage({ params }: Props) {
  const [data, { hasWebsiteEdit }] = await Promise.all([getTechnicalStageCityData(params.miasto), getUserPermissions()]);
  if (!data) notFound();
  const { city, cityCases, pageSlug, canonicalUrl, title, lead, metaTitle, description, image,
    heroSettings, localHero, features, portfolio, faq, nearbyCities, content, introRecord } = data;
  const areaServed = { '@type': 'City', name: city.name };
  const schema = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebPage', '@id': `${canonicalUrl}#webpage`, url: canonicalUrl, name: metaTitle,
        description, inLanguage: 'pl-PL', isPartOf: { '@id': WEBSITE_ID }, mainEntity: { '@id': `${canonicalUrl}#service` },
        relatedLink: portfolio.map(project => `${SITE.url}${project.href}`) },
      { '@type': 'Service', '@id': `${canonicalUrl}#service`, url: canonicalUrl, name: title, description: lead, image,
        serviceType: 'Technika sceniczna i eventowa: nagłośnienie, oświetlenie, LED indoor i outdoor, totemy, telewizory i realizacja',
        provider: { '@id': ORGANIZATION_ID }, areaServed, hasOfferCatalog: { '@id': `${canonicalUrl}#zakres` },
        ...(portfolio.length > 0 && { subjectOf: portfolio.map(project => ({ '@type': 'CreativeWork', name: project.title, url: `${SITE.url}${project.href}` })) }) },
      { '@type': 'OfferCatalog', '@id': `${canonicalUrl}#zakres`, name: `Zakres techniki scenicznej i eventowej — ${city.name}`,
        itemListElement: [
          ...features.map(feature => ({ '@type': 'Offer', itemOffered: {
            '@type': 'Service', name: feature.title, description: feature.description, provider: { '@id': ORGANIZATION_ID }, areaServed,
            ...(feature.href && { url: `${SITE.url}${feature.href}` }),
          } })),
          ...['Ekrany LED wewnętrzne', 'Ekrany LED zewnętrzne', 'Totemy i telewizory'].map(name => ({
            '@type': 'Offer', itemOffered: { '@type': 'Service', name, url: `${canonicalUrl}#multimedia`, areaServed, provider: { '@id': ORGANIZATION_ID } },
          })),
        ] },
      ...(faq.length ? [{ '@type': 'FAQPage', '@id': `${canonicalUrl}#faq`, isPartOf: { '@id': `${canonicalUrl}#webpage` },
        mainEntity: faq.map(item => ({ '@type': 'Question', name: item.question, acceptedAnswer: { '@type': 'Answer', text: item.answer } })) }] : []),
    ],
  };
  return <PageLayout pageSlug={pageSlug} customSchema={schema} breadcrumbLabels={{ 'technika-sceniczna': 'Technika sceniczna i eventowa', [city.locality]: city.name }}>
    <main className="bg-[#190f1b] text-[#e5e4e2]">
      <TechnicalStageCityHero pageSlug={pageSlug} cityName={city.name} cityForms={[cityCases.nominative, cityCases.locative, cityCases.genitive]}
        title={title} lead={lead} image={image} settings={heroSettings} localSettings={localHero} canEdit={hasWebsiteEdit} />
      <div className="mx-auto max-w-7xl px-5 sm:px-6"><ServerBreadcrumb pageSlug={pageSlug} labels={{ 'technika-sceniczna': 'Technika sceniczna i eventowa', [city.locality]: city.name }} /></div>
      <nav aria-label="Na tej stronie" className="mx-auto flex max-w-7xl flex-wrap gap-x-6 gap-y-2 px-5 pb-5 text-sm text-[#d3bb73] sm:px-6">
        {[
          ['#multimedia', 'LED, totemy i telewizory'], ['#zakres-techniki', 'Sprzęt i zakres usług'],
          ['#plan-realizacji', 'Plan realizacji'], ...(portfolio.length ? [['#realizacje-techniczne', 'Portfolio']] : []),
          ['#pytania', 'Pytania i odpowiedzi'], ['#wycena-techniki', 'Wycena'],
        ].map(([href, label]) => <a key={href} href={href} className="inline-flex min-h-11 items-center underline underline-offset-4">{label}</a>)}
      </nav>
      {hasWebsiteEdit && <>
        <TechStageCityAdminClient isAdmin cityLocality={city.locality} cityName={city.name} defaultTitle={metaTitle} defaultDescription={description} />
        <TechnicalStageCityContentEditor citySlug={city.locality} cityName={city.name} content={content} recordId={introRecord.id} />
      </>}
      <TechnicalStageCitySections data={data} />
      <nav aria-label="Technika w innych miastach" className="mx-auto max-w-7xl px-5 pb-16 sm:px-6">
        <h2 className="text-xl uppercase">Technika sceniczna i eventowa w innych lokalizacjach</h2>
        <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2">{nearbyCities.map(nearby => <Link key={nearby.locality} href={`/oferta/technika-sceniczna/${nearby.locality}`} className="inline-flex min-h-11 items-center text-[#d3bb73] underline underline-offset-4">{nearby.name}</Link>)}
          <Link href="/oferta/technika-sceniczna/lokalizacje" className="inline-flex min-h-11 items-center text-[#d3bb73] underline underline-offset-4">Wszystkie miasta</Link>
        </div>
      </nav>
    </main>
  </PageLayout>;
}
