import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import PageLayout from '@/components/Layout/PageLayout';
import { ServerBreadcrumb } from '@/components/Layout/ServerBreadcrumb';
import { getUserPermissions } from '@/lib/serverAuth';
import { getCasinoCityData, getPublishedCasinoCities } from '@/lib/SEO/casinoCityData.server';
import { SITE, ORGANIZATION_ID, WEBSITE_ID } from '@/lib/SEO/site';
import CityMapEmbed from '@/components/CityMapEmbed/CityMapEmbed';
import CasinoCityHero from './CasinoCityHero';
import CasinoCityAdminClient from './CasinoCityAdminClient';
import CasinoCityServices from './CasinoCityServices';
import CasinoCityEquipment from './CasinoCityEquipment';
import CasinoCityBenefits from './CasinoCityBenefits';
import CasinoCityGallery from './CasinoCityGallery';
import CasinoCityProcess from './CasinoCityProcess';
import CasinoCityFAQ from './CasinoCityFAQ';
import CasinoCityCTA from './CasinoCityCTA';
import CasinoCityIntro from './CasinoCityIntro';
import CasinoCityProduct from './CasinoCityProduct';
import CasinoCityPortfolio from './CasinoCityPortfolio';
import CasinoCityPlanning from './CasinoCityPlanning';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
type Props = { params: { miasto: string } };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const data = await getCasinoCityData(params.miasto);
  if (!data) return { title: 'Nie znaleziono strony | MAVINCI', robots: { index: false, follow: true } };
  const { metaTitle, description, keywords, canonicalUrl, ogImage } = data;
  return {
    title: { absolute: metaTitle }, description, keywords,
    alternates: { canonical: canonicalUrl },
    openGraph: {
      type: 'website', locale: 'pl_PL', url: canonicalUrl,
      title: metaTitle, description, siteName: SITE.name,
      images: [{ url: ogImage, alt: 'Kasyno eventowe MAVINCI' }],
    },
    twitter: { card: 'summary_large_image', title: metaTitle, description, images: [ogImage] },
  };
}

export default async function CasinoCityPage({ params }: Props) {
  const [data, { hasWebsiteEdit }] = await Promise.all([
    getCasinoCityData(params.miasto), getUserPermissions(),
  ]);
  if (!data) notFound();
  const { city, cityCases, pageSlug, canonicalUrl, title, lead, description, metaTitle,
    image, heroSettings, localHero, content, services, faq, gallery, nearbyCities, product, portfolio, localCopy } = data;
  const areaServed = { '@type': 'City', name: city.name };
  const customSchema = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage', '@id': `${canonicalUrl}#webpage`, url: canonicalUrl,
        name: metaTitle, description, inLanguage: 'pl-PL', isPartOf: { '@id': WEBSITE_ID },
        mainEntity: { '@id': `${canonicalUrl}#service` },
        relatedLink: [...portfolio.map(project => `${SITE.url}${project.href}`), ...(product ? [`${SITE.url}${product.href}`] : [])],
      },
      {
        '@type': 'Service', '@id': `${canonicalUrl}#service`, name: title, description: lead,
        url: canonicalUrl, image, serviceType: 'Mobilne kasyno i wynajem stołów kasynowych na imprezy firmowe',
        provider: { '@id': ORGANIZATION_ID }, areaServed,
        hasOfferCatalog: { '@id': `${canonicalUrl}#offer-catalog` },
        ...(portfolio.length > 0 && { subjectOf: portfolio.map(project => ({ '@type': 'CreativeWork', name: project.title, url: `${SITE.url}${project.href}` })) }),
      },
      {
        '@type': 'OfferCatalog', '@id': `${canonicalUrl}#offer-catalog`,
        name: `Stoły i zestawy kasynowe — ${city.name}`,
        itemListElement: [...services.map(service => ({
          '@type': 'Offer', itemOffered: {
            '@type': 'Service', name: service.title, description: service.description,
            areaServed, provider: { '@id': ORGANIZATION_ID },
            ...(service.href && { url: `${SITE.url}${service.href}` }),
          },
        })), ...(product?.packages || []).map(item => ({
          '@type': 'Offer', itemOffered: {
            '@type': 'Service', name: item.name, description: [item.description, item.scope, item.bonus].filter(Boolean).join(' '),
            url: `${SITE.url}${item.href}`, areaServed, provider: { '@id': ORGANIZATION_ID },
          },
        }))],
      },
      ...(faq.length ? [{
        '@type': 'FAQPage', '@id': `${canonicalUrl}#faq`,
        isPartOf: { '@id': `${canonicalUrl}#webpage` },
        mainEntity: faq.map(item => ({
          '@type': 'Question', name: item.question,
          acceptedAnswer: { '@type': 'Answer', text: item.answer },
        })),
      }] : []),
    ],
  };
  return (
    <PageLayout pageSlug={pageSlug} customSchema={customSchema} breadcrumbLabels={{ [city.locality]: city.name }}>
      <main>
        <CasinoCityHero pageSlug={pageSlug} cityName={city.name}
          cityForms={[cityCases.nominative, cityCases.locative, cityCases.genitive]}
          title={title} lead={lead} image={image} settings={heroSettings}
          localSettings={localHero} canEdit={hasWebsiteEdit} />
        <div className="mx-auto max-w-7xl px-5 sm:px-6">
          <ServerBreadcrumb pageSlug={pageSlug} labels={{ [city.locality]: city.name }} />
        </div>
        <nav aria-label="Na tej stronie" className="mx-auto flex max-w-7xl flex-wrap gap-x-6 gap-y-2 px-5 pb-6 text-sm text-[#d3bb73] sm:px-6">
          <a href="#stoly-kasynowe" className="inline-flex min-h-11 items-center underline underline-offset-4">Stoły do gier</a>
          {product && <a href="#zestawy-kasyna" className="inline-flex min-h-11 items-center underline underline-offset-4">Zestawy i warunki</a>}
          {portfolio.length > 0 && <a href="#realizacje-kasyna" className="inline-flex min-h-11 items-center underline underline-offset-4">Nasze realizacje</a>}
          <a href="#wycena-kasyna" className="inline-flex min-h-11 items-center underline underline-offset-4">Zapytaj o wycenę</a>
        </nav>
        {hasWebsiteEdit && <CasinoCityAdminClient isAdmin cityLocality={city.locality}
          cityName={city.name} defaultTitle={metaTitle} defaultDescription={description} />}
        <CasinoCityIntro cityCases={cityCases} content={content} />
        <CasinoCityServices cityCases={cityCases} content={content} services={services} />
        {product ? <CasinoCityProduct product={product} /> : <CasinoCityEquipment cityCases={cityCases} content={content} />}
        <CasinoCityPlanning slug={city.locality} location={`${cityCases.locative_preposition || 'w'} ${cityCases.locative}`} copy={localCopy} />
        <CasinoCityPortfolio projects={portfolio} />
        <CasinoCityBenefits cityCases={cityCases} content={content} />
        {!portfolio.length && gallery.length > 0 && <CasinoCityGallery images={gallery} />}
        <CasinoCityProcess cityCases={cityCases} content={content} />
        <CasinoCityFAQ cityCases={cityCases} faq={faq} />
        <CityMapEmbed query={`${city.name}, Polska`} title={`Obszar obsługi: ${city.name}`} />
        <CasinoCityCTA cityCases={cityCases} content={content} />
        <nav aria-label="Kasyno w innych miastach" className="mx-auto max-w-7xl px-6 pb-16">
          <h2 className="text-xl uppercase text-[#e5e4e2]">Kasyno eventowe w innych lokalizacjach</h2>
          <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2">
            {nearbyCities.map(nearby => <Link key={nearby.locality} href={`/oferta/kasyno/${nearby.locality}`}
              className="inline-flex min-h-11 items-center text-[#d3bb73] underline underline-offset-4">{nearby.name}</Link>)}
            <Link href="/oferta/kasyno/lokalizacje" className="inline-flex min-h-11 items-center text-[#d3bb73] underline underline-offset-4">Wszystkie miasta</Link>
          </div>
        </nav>
      </main>
    </PageLayout>
  );
}

export async function generateStaticParams() {
  const cities = await getPublishedCasinoCities();
  return cities.map(city => ({ miasto: city.locality }));
}
