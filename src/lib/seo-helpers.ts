// src/lib/seo-helpers.ts
import type { Metadata } from 'next';
import { getSeoForPage } from './seo';

type CookieStoreLike = {
  getAll: () => Array<{ name: string; value: string }>;
  set: (name: string, value: string, options?: any) => void;
};

const FALLBACK_DESCRIPTION =
  'Kompleksowa obsługa techniczna konferencji: nagłośnienie, multimedia, streaming live, realizacja wideo.';

export async function buildMetadataForSlug(
  pageSlug: string,
  cookieStore: CookieStoreLike
): Promise<Metadata> {
  const seo = await getSeoForPage(pageSlug, cookieStore);

  if (!seo) {
    return {
      title: 'Obsługa Konferencji | MAVINCI',
      description: FALLBACK_DESCRIPTION,
    };
  }

  const global = seo.globalConfig;
  const cleanedTitle = seo.title?.trim();
  const title =
    cleanedTitle && cleanedTitle.length > 0 ? cleanedTitle : global.organization_name;

  const description = seo.description || FALLBACK_DESCRIPTION;

  const rawOg = seo.ogImage || global.organization_logo || '/og-default.jpg';
  const ogImage = rawOg.startsWith('http')
    ? rawOg
    : `${global.organization_url}${rawOg.startsWith('/') ? rawOg : `/${rawOg}`}`;

  const pageUrl = `${global.organization_url}/${pageSlug}`;

  return {
    title,
    description,
    keywords: seo.keywords,
    openGraph: {
      title,
      description,
      url: pageUrl,
      images: [{ url: ogImage, width: 1200, height: 630, alt: title }],
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogImage],
    },
    alternates: { canonical: pageUrl },
  };
}

export async function buildSchemaJsonLdForSlug(
  pageSlug: string,
  cookieStore: CookieStoreLike
) {
  const seo = await getSeoForPage(pageSlug, cookieStore);
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

  const pageUrl = `${global.organization_url}/${pageSlug}`;

  const areaServed = seo.places.map((place) => ({
    '@type': 'Place',
    name: place.name,
    address: {
      '@type': 'PostalAddress',
      addressLocality: place.locality,
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
    '@context': 'http://schema.org',
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