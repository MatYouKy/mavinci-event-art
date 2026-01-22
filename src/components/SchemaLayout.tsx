'use client';

import { ReactNode, useEffect, useState } from 'react';
import Head from 'next/head';
import { supabase } from '@/lib/supabase/browser';

interface BreadcrumbItem {
  name: string;
  url: string;
}

interface SchemaLayoutProps {
  children: ReactNode;
  pageSlug: string;
  defaultTitle?: string;
  defaultDescription?: string;
  breadcrumb?: BreadcrumbItem[];
  customSchemaData?: Record<string, any>;
  cityPageType?: string;
  citySlug?: string;
}

interface PageMetadata {
  title: string | null;
  description: string | null;
  keywords: string[];
  og_image: string | null;
  schema_type: string;
  custom_schema: any;
}

interface GlobalConfig {
  organization_name: string;
  organization_url: string;
  organization_logo: string | null;
  telephone: string | null;
  email: string | null;
  facebook_url: string | null;
  instagram_url: string | null;
  linkedin_url: string | null;
  youtube_url: string | null;
  twitter_url: string | null;
  street_address: string | null;
  locality: string | null;
  postal_code: string | null;
  region: string | null;
  country: string;
}

export default function SchemaLayout({
  children,
  pageSlug,
  defaultTitle,
  defaultDescription,
  breadcrumb = [],
  customSchemaData = {},
  cityPageType,
  citySlug,
}: SchemaLayoutProps) {
  const [globalConfig, setGlobalConfig] = useState<GlobalConfig | null>(null);
  const [pageMetadata, setPageMetadata] = useState<PageMetadata | null>(null);
  const [cityPageSEO, setCityPageSEO] = useState<any>(null);
  const [places, setPlaces] = useState<any[]>([]);
  const [offers, setOffers] = useState<any[]>([]);

  useEffect(() => {
    loadData();
  }, [pageSlug, cityPageType, citySlug]);

  const loadData = async () => {
    const promises: any[] = [
      supabase.from('schema_org_global').select('*').single(),
      supabase
        .from('schema_org_page_metadata')
        .select('*')
        .eq('page_slug', pageSlug)
        .eq('is_active', true)
        .maybeSingle(),
      supabase
        .from('schema_org_places')
        .select('*')
        .eq('is_global', true)
        .eq('is_active', true)
        .order('display_order'),
      supabase
        .from('schema_org_page_offers')
        .select('*')
        .eq('page_slug', pageSlug)
        .eq('is_active', true)
        .order('display_order'),
    ];

    // Load city page SEO if applicable
    if (cityPageType && citySlug) {
      promises.push(
        supabase
          .from('city_pages_seo')
          .select('*')
          .eq('page_type', cityPageType)
          .eq('city_slug', citySlug)
          .eq('is_active', true)
          .maybeSingle(),
      );
    }

    const results = await Promise.all(promises);
    const [globalRes, metadataRes, placesRes, offersRes, cityPageSEORes] = results;

    if (globalRes.data) setGlobalConfig(globalRes.data);
    if (metadataRes.data) setPageMetadata(metadataRes.data);
    if (placesRes.data) setPlaces(placesRes.data);
    if (offersRes.data) setOffers(offersRes.data);
    if (cityPageSEORes?.data) setCityPageSEO(cityPageSEORes.data);
  };

  if (!globalConfig) {
    return <>{children}</>;
  }

  // Priority: cityPageSEO > pageMetadata > default
  const cleanedPageTitle = pageMetadata?.title?.trim();
  const cleanedCityTitle = cityPageSEO?.seo_title?.trim();
  const cleanedDefault = defaultTitle?.trim();

  const title = cleanedCityTitle
    ? cleanedCityTitle
    : cleanedPageTitle
      ? cleanedPageTitle
      : cleanedDefault
        ? cleanedDefault
        : globalConfig.organization_name;

  const description =
    cityPageSEO?.seo_description || pageMetadata?.description || defaultDescription || '';
  const ogImage = pageMetadata?.og_image || globalConfig.organization_logo || '/og-default.jpg';

  // Keywords: city page SEO keywords or regular page keywords
  const keywordsArray = cityPageSEO?.seo_keywords
    ? cityPageSEO.seo_keywords
        .split(',')
        .map((k: string) => k.trim())
        .filter(Boolean)
    : pageMetadata?.keywords || [];
  const keywords = keywordsArray;

  const sameAs = [
    globalConfig.facebook_url,
    globalConfig.instagram_url,
    globalConfig.linkedin_url,
    globalConfig.youtube_url,
    globalConfig.twitter_url,
  ].filter(Boolean);

  const areaServed = places.map((place) => ({
    '@type': 'Place',
    name: place.name,
    address: {
      '@type': 'PostalAddress',
      addressLocality: place.locality,
      postalCode: place.postal_code,
      addressRegion: place.region,
      addressCountry: {
        '@type': 'Country',
        name: place.country,
      },
    },
  }));

  const schemaOffers = offers.map((offer) => ({
    '@type': 'Offer',
    name: offer.offer_name,
    description: offer.description,
    priceRange: offer.price_range,
    priceCurrency: offer.currency,
    availability: `https://schema.org/${offer.availability}`,
  }));

  const structuredData = {
    '@context': 'http://schema.org',
    '@type': pageMetadata?.schema_type || 'LocalBusiness',
    name: title,
    description,
    url: `${globalConfig.organization_url}/${pageSlug}`,
    image: ogImage,
    telephone: globalConfig.telephone,
    email: globalConfig.email,
    address: {
      '@type': 'PostalAddress',
      streetAddress: globalConfig.street_address,
      addressLocality: globalConfig.locality,
      postalCode: globalConfig.postal_code,
      addressRegion: globalConfig.region,
      addressCountry: globalConfig.country,
    },
    areaServed,
    sameAs,
    ...(schemaOffers.length > 0 && { offers: schemaOffers }),
    ...customSchemaData,
    ...(pageMetadata?.custom_schema || {}),
  };

  const breadcrumbLd =
    breadcrumb.length > 0
      ? {
          '@context': 'http://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: breadcrumb.map((item, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            name: item.name,
            item: item.url,
          })),
        }
      : null;

  return (
    <>
      <Head>
        <title>{title}</title>
        <meta name="description" content={description} />
        {keywords.length > 0 && <meta name="keywords" content={keywords.join(', ')} />}

        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:image" content={ogImage} />
        <meta property="og:url" content={`${globalConfig.organization_url}/${pageSlug}`} />
        <meta property="og:type" content="website" />

        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={description} />
        <meta name="twitter:image" content={ogImage} />

        <link rel="canonical" content={`${globalConfig.organization_url}/${pageSlug}`} />

        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />

        {breadcrumbLd && (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
          />
        )}
      </Head>
      {children}
    </>
  );
}
