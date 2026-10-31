import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import PageLayout from '@/components/Layout/PageLayout';
import { ServerBreadcrumb } from '@/components/Layout/ServerBreadcrumb';
import { getUserPermissions } from '@/lib/serverAuth';
import { getThemedPartyCityData } from '@/lib/SEO/themedPartyData.server';
import { ORGANIZATION_ID, WEBSITE_ID } from '@/lib/SEO/site';
import ThemedPartyCityHero from './ThemedPartyCityHero';
import ThemedPartyCityAdminClient from './ThemedPartyCityAdminClient';
import ThemedPartyCityContentEditor from './ThemedPartyCityContentEditor';
import ThemedPartyCityThemes from './ThemedPartyCityThemes';
import ThemedPartyCitySharedGallery from './ThemedPartyCitySharedGallery';
import { ThemedPartyIntro, ThemedPartyPlanning, ThemedPartyPortfolio, ThemedPartyTechnical, ThemedPartyQuestions, ThemedPartyRelated } from './ThemedPartyCitySections';
import ThemedPartyCityCTA from './ThemedPartyCityCTA';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function generateMetadata({ params }: { params: { miasto: string } }): Promise<Metadata> {
  const data = await getThemedPartyCityData(params.miasto);
  if (!data) return { title: 'Nie znaleziono lokalizacji | MAVINCI', robots: { index: false } };
  return {
    title: { absolute: data.metaTitle }, description: data.description, keywords: data.keywords,
    alternates: { canonical: data.canonicalUrl },
    robots: { index: true, follow: true, googleBot: { index: true, follow: true, 'max-image-preview': 'large' } },
    openGraph: { type: 'website', url: data.canonicalUrl, title: data.metaTitle, description: data.description,
      locale: 'pl_PL', siteName: 'MAVINCI Event & ART', images: [{ url: data.ogImage, alt: data.heroSettings.alt_text || data.title }] },
    twitter: { card: 'summary_large_image', title: data.metaTitle, description: data.description, images: [data.ogImage] },
  };
}

export default async function ThemedPartyCityPage({ params }: { params: { miasto: string } }) {
  const data = await getThemedPartyCityData(params.miasto);
  if (!data) notFound();
  const { hasWebsiteEdit } = await getUserPermissions();
  const { canonicalUrl: url, city, cityCases, title, description, faq, themes } = data;
  const schema = {
    '@context': 'https://schema.org', '@graph': [
      { '@type': 'WebPage', '@id': `${url}#webpage`, url, name: data.metaTitle, description, inLanguage: 'pl-PL',
        isPartOf: { '@id': WEBSITE_ID }, mainEntity: { '@id': `${url}#service` },
        primaryImageOfPage: { '@type': 'ImageObject', url: data.image, caption: data.heroSettings.alt_text } },
      { '@type': 'Service', '@id': `${url}#service`, url, name: title, description: data.lead,
        image: data.image, serviceType: 'Organizacja imprez i wieczorów tematycznych dla firm',
        provider: { '@id': ORGANIZATION_ID }, areaServed: { '@type': city.locality === 'warchaly' ? 'Place' : 'City', name: city.name },
        audience: { '@type': 'BusinessAudience', audienceType: 'Firmy, działy HR, agencje eventowe i organizatorzy konferencji' },
        ...(themes.length > 0 && { hasOfferCatalog: { '@type': 'OfferCatalog', name: 'Motywy wieczorów tematycznych',
          itemListElement: themes.map(theme => ({ '@type': 'Offer', itemOffered: { '@type': 'Service', name: theme.title, description: theme.description, ...(theme.scenarioHref && { url: `https://mavinci.pl${theme.scenarioHref}` }), provider: { '@id': ORGANIZATION_ID } } })) } }),
      },
      ...(faq.length > 0 ? [{ '@type': 'FAQPage', '@id': `${url}#faq`, isPartOf: { '@id': `${url}#webpage` },
        mainEntity: faq.map(item => ({ '@type': 'Question', name: item.question, acceptedAnswer: { '@type': 'Answer', text: item.answer } })) }] : []),
    ],
  };
  const labels = { [city.locality]: city.name };
  return <PageLayout pageSlug={data.pageSlug} customSchema={schema} breadcrumbLabels={labels}>
    <ThemedPartyCityHero pageSlug={data.pageSlug} cityName={city.name} cityForms={[cityCases.locative, cityCases.genitive]}
      title={title} lead={data.lead} image={data.image} canEdit={hasWebsiteEdit} settings={data.heroSettings} localSettings={data.localHero} />
    <div className="bg-[#190f1b] text-[#e5e4e2]">
      <div className="mx-auto max-w-7xl px-5 pt-6 sm:px-6"><ServerBreadcrumb pageSlug={data.pageSlug} labels={labels} /></div>
      {hasWebsiteEdit && <>
        <ThemedPartyCityAdminClient isAdmin cityLocality={city.locality} cityName={city.name} defaultTitle={data.metaTitle} defaultDescription={description} />
        <ThemedPartyCityContentEditor citySlug={city.locality} cityName={city.name} content={data.content} recordId={data.recordId} />
      </>}
      <ThemedPartyIntro data={data} />
      <ThemedPartyCityThemes themes={themes} cityCases={cityCases} />
      <ThemedPartyPortfolio data={data} />
      <ThemedPartyTechnical data={data} />
      <ThemedPartyPlanning data={data} />
      <ThemedPartyCitySharedGallery images={data.gallery} />
      <ThemedPartyQuestions data={data} />
      <ThemedPartyCityCTA cityCases={cityCases} citySlug={city.locality} />
      <ThemedPartyRelated data={data} />
    </div>
  </PageLayout>;
}
