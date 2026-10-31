import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { getSeoForPage } from './seo';
import { getPublicGlobalConfig, getPublicPageMetadata } from '@/lib/SEO/publicData';
import { SITE } from '@/lib/SEO/site';
import { resolveConferenceOverviewSeo } from '@/lib/SEO/conferenceOverview';

type CookieStoreLike = {
  getAll: () => Array<{ name: string; value: string }>;
  set: (name: string, value: string, options?: any) => void;
};
const FALLBACK_DESCRIPTION = SITE.description;
const PAGE_LABELS: Record<string, string> = {
  home: SITE.name, oferta: 'Oferta eventowa', uslugi: 'Usługi eventowe',
  konferencje: 'Obsługa techniczna konferencji', integracje: 'Integracje firmowe',
  kasyno: 'Kasyno eventowe', streaming: 'Streaming wydarzeń',
  'quizy-teleturnieje': 'Quizy i teleturnieje firmowe', 'dj-eventowy': 'DJ na event',
  'technika-sceniczna': 'Technika sceniczna', 'wieczory-tematyczne': 'Wieczory tematyczne',
  'symulatory-vr': 'Symulatory VR', portfolio: 'Portfolio', 'o-nas': 'O MAVINCI', zespol: 'Nasz zespół',
};
function cleanSlug(value: string) { return value.replace(/^\/+|\/+$/g, '') || 'home'; }
function canonicalUrl(slug: string) { const clean = cleanSlug(slug); return clean === 'home' ? SITE.url : `${SITE.url}/${clean}`; }

/** Metadata is public and independent of the editor's session or global configuration row. */
export async function buildMetadataForSlug(pageSlug: string, _cookieStore?: CookieStoreLike): Promise<Metadata> {
  const slug = cleanSlug(pageSlug);
  const [seo, global] = await Promise.all([getPublicPageMetadata(slug), getPublicGlobalConfig()]);
  const label = PAGE_LABELS[slug.split('/').pop() || 'home'] || 'Wydarzenia i usługi eventowe';
  const copy = slug === 'oferta/konferencje' ? resolveConferenceOverviewSeo(seo) : seo;
  const title = copy?.title?.trim() || (slug === 'home' ? SITE.title : `${label} | MAVINCI`);
  const description = copy?.description?.trim() || FALLBACK_DESCRIPTION;
  const url = canonicalUrl(slug);
  const rawOg = seo?.og_image || global?.organization_logo || '/logo-mavinci-crm.png';
  const image = /^https?:\/\//.test(rawOg) ? rawOg : `${SITE.url}/${rawOg.replace(/^\/+/, '')}`;
  return { title: { absolute: title }, description, keywords: seo?.keywords || [], alternates: { canonical: url },
    openGraph: { title, description, url, type: 'website', siteName: SITE.name, locale: 'pl_PL', images: [{ url: image, alt: title }] },
    twitter: { card: 'summary_large_image', title, description, images: [image] } };
}

export async function buildSchemaJsonLdForSlug(
  pageSlug: string,
  cookieStore?: CookieStoreLike
) {
  const seo = await getSeoForPage(pageSlug, cookieStore ?? cookies());
  if (!seo) return null;

  const global = seo.globalConfig;
  const title =
    seo.title?.trim() && seo.title.trim().length > 0
      ? seo.title.trim()
      : global.organization_name;

  const description = seo.description || FALLBACK_DESCRIPTION;

  const rawOg = seo.ogImage || global.organization_logo || '/og-default.jpg';
  const ogImage = rawOg.startsWith('http')
    ? rawOg
    : `${global.organization_url}${rawOg.startsWith('/') ? rawOg : `/${rawOg}`}`;

  const pageUrl = canonicalUrl(pageSlug);

  const areaServed = seo.places.map((place) => ({
    '@type': 'Place',
    name: place.name,
    address: {
      '@type': 'PostalAddress',
      addressLocality: place.name,
      postalCode: place.postal_code,
      addressRegion: place.region,
      addressCountry: { '@type': 'Country', name: place.country },
    },
  }));

  const schemaOffers = seo.offers.map((offer) => ({
    '@type': 'Offer',
    name: offer.offer_name,
    description: offer.description,
    priceRange: offer.price_range,
    priceCurrency: offer.currency,
    availability: `https://schema.org/${offer.availability}`,
  }));

  return {
    '@context': 'https://schema.org',
    '@type': seo.schemaType || 'LocalBusiness',
    name: title,
    description,
    url: pageUrl,
    image: ogImage,
    telephone: global.telephone,
    email: global.email,
    address: {
      '@type': 'PostalAddress',
      streetAddress: global.street_address,
      addressLocality: global.locality,
      postalCode: global.postal_code,
      addressRegion: global.region,
      addressCountry: global.country,
    },
    areaServed,
    sameAs: [
      global.facebook_url,
      global.instagram_url,
      global.linkedin_url,
      global.youtube_url,
      global.twitter_url,
    ].filter(Boolean),
    ...(schemaOffers.length > 0 && { offers: schemaOffers }),
    ...seo.customSchema,
  };
}
