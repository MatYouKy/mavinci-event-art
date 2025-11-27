import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

interface SchemaOrgGlobal {
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

interface SchemaOrgPlace {
  name: string;
  locality: string;
  postal_code: string | null;
  region: string | null;
  country: string;
}

interface SchemaOrgOptions {
  type?: string;
  name?: string;
  description?: string;
  url?: string;
  image?: string;
  breadcrumb?: Array<{
    name: string;
    url: string;
  }>;
  additionalData?: Record<string, any>;
}

export function useSchemaOrg(options: SchemaOrgOptions = {}) {
  const [globalConfig, setGlobalConfig] = useState<SchemaOrgGlobal | null>(null);
  const [places, setPlaces] = useState<SchemaOrgPlace[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const [globalRes, placesRes] = await Promise.all([
      supabase.from('schema_org_global').select('*').single(),
      supabase.from('schema_org_places').select('*').eq('is_global', true).eq('is_active', true).order('display_order'),
    ]);

    if (globalRes.data) setGlobalConfig(globalRes.data);
    if (placesRes.data) setPlaces(placesRes.data);
    setLoading(false);
  };

  const generateSchemaOrg = () => {
    if (!globalConfig) return null;

    const sameAs = [
      globalConfig.facebook_url,
      globalConfig.instagram_url,
      globalConfig.linkedin_url,
      globalConfig.youtube_url,
      globalConfig.twitter_url,
    ].filter(Boolean);

    const areaServed = places.map(place => ({
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

    const baseData = {
      '@context': 'http://schema.org',
      '@type': options.type || 'LocalBusiness',
      name: options.name || globalConfig.organization_name,
      description: options.description,
      url: options.url || globalConfig.organization_url,
      image: options.image || globalConfig.organization_logo,
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
    };

    return { ...baseData, ...options.additionalData };
  };

  const generateBreadcrumb = () => {
    if (!options.breadcrumb) return null;

    return {
      '@context': 'http://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: options.breadcrumb.map((item, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name: item.name,
        item: item.url,
      })),
    };
  };

  return {
    globalConfig,
    places,
    loading,
    schemaOrg: generateSchemaOrg(),
    breadcrumb: generateBreadcrumb(),
    areaServed: places,
    sameAs: globalConfig ? [
      globalConfig.facebook_url,
      globalConfig.instagram_url,
      globalConfig.linkedin_url,
      globalConfig.youtube_url,
      globalConfig.twitter_url,
    ].filter(Boolean) : [],
  };
}
