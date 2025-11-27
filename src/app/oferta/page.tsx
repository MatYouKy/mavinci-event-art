import { Metadata } from 'next';
import { createClient } from '@supabase/supabase-js';
import OfertaPageClient from './OfertaPageClient';
import PageLayout from '@/components/Layout/PageLayout';
import { getSeoForPage } from '@/lib/seo';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const getSupabaseClient = () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables');
  }

  return createClient(supabaseUrl, supabaseKey);
};

async function loadPageMetadata() {
  const supabase = getSupabaseClient();

  const { data: metadata } = await supabase
    .from('schema_org_page_metadata')
    .select('*')
    .eq('page_slug', 'oferta')
    .eq('is_active', true)
    .maybeSingle();

  const { data: globalConfig } = await supabase
    .from('schema_org_global')
    .select('*')
    .single();

  return { metadata, globalConfig };
}

export async function generateMetadata(): Promise<Metadata> {
  const { metadata } = await loadPageMetadata();

  const title = metadata?.title || 'Oferta | MAVINCI Event & ART';
  const description = metadata?.description || 'Kompleksowa oferta organizacji wydarzeń.';
  const keywords = metadata?.keywords || [];
  const ogImage = metadata?.og_image || 'https://mavinci.pl/logo-mavinci-crm.png';

  return {
    title,
    description,
    keywords: keywords.join(', '),
    alternates: {
      canonical: 'https://mavinci.pl/oferta',
    },
    openGraph: {
      type: 'website',
      url: 'https://mavinci.pl/oferta',
      title,
      description,
      images: [{
        url: ogImage,
        alt: title,
      }],
      siteName: 'MAVINCI Event & ART',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogImage],
    },
  };
}

export default async function OfertaPage() {
  const { metadata, globalConfig } = await loadPageMetadata();
  const seo = await getSeoForPage('oferta');

  const areaServed = seo?.places.map((place) => ({
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
  })) || [];

  const customSchema = globalConfig ? {
    '@context': 'http://schema.org',
    '@type': 'Service',
    name: metadata?.title || 'Oferta Eventowa MAVINCI',
    description: metadata?.description,
    url: 'https://mavinci.pl/oferta',
    provider: {
      '@type': 'LocalBusiness',
      name: globalConfig.organization_name,
      telephone: globalConfig.telephone,
      email: globalConfig.email,
      url: globalConfig.organization_url,
      logo: globalConfig.organization_logo,
      address: {
        '@type': 'PostalAddress',
        streetAddress: globalConfig.street_address,
        addressLocality: globalConfig.locality,
        postalCode: globalConfig.postal_code,
        addressRegion: globalConfig.region,
        addressCountry: globalConfig.country,
      },
      sameAs: [
        globalConfig.facebook_url,
        globalConfig.instagram_url,
        globalConfig.linkedin_url,
        globalConfig.youtube_url,
        globalConfig.twitter_url,
      ].filter(Boolean),
    },
    areaServed,
  } : undefined;

  return (
    <PageLayout pageSlug="oferta" customSchema={customSchema}>
      <OfertaPageClient />
    </PageLayout>
  );
}
