import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import PageLayout from '@/components/Layout/PageLayout';
import PortfolioDetailClient from './PortfolioDetailClient';
import { getSeoForPage } from '@/lib/seo';

const getSupabaseClient = () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables');
  }

  return createClient(supabaseUrl, supabaseKey);
};

async function loadProjectData(slug: string) {
  const supabase = getSupabaseClient();

  const { data: project, error } = await supabase
    .from('portfolio_projects')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();

  if (error || !project) {
    return null;
  }

  const { data: metadata } = await supabase
    .from('schema_org_page_metadata')
    .select('*')
    .eq('page_slug', `portfolio/${slug}`)
    .eq('is_active', true)
    .maybeSingle();

  const { data: globalConfig } = await supabase
    .from('schema_org_global')
    .select('*')
    .single();

  return { project, metadata, globalConfig };
}

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const data = await loadProjectData(params.slug);

  if (!data) {
    return {
      title: 'Projekt nie znaleziony - MAVINCI Event & ART',
    };
  }

  const { project, metadata } = data;
  const canonicalUrl = `https://mavinci.pl/portfolio/${project.slug}`;

  const title = metadata?.title || `${project.title} | Portfolio MAVINCI`;
  const description = metadata?.description || project.meta_description || project.description;
  const keywords = metadata?.keywords || project.keywords || [];
  const ogImage = metadata?.og_image || project.image_metadata?.desktop?.src || project.image || 'https://mavinci.pl/logo-mavinci-crm.png';

  return {
    title,
    description,
    keywords: keywords.join(', '),
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      type: 'website',
      url: canonicalUrl,
      title,
      description,
      images: [{
        url: ogImage,
        alt: project.alt || project.title,
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

export default async function PortfolioDetailPage({
  params,
}: {
  params: { slug: string };
}) {
  const data = await loadProjectData(params.slug);

  if (!data) {
    notFound();
  }

  const { project, metadata, globalConfig } = data;
  const seo = await getSeoForPage(`portfolio/${params.slug}`);

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

  const keywords = metadata?.keywords || project.keywords || [];
  const metaDescription = metadata?.description || project.meta_description || project.description;
  const previewImage = project.image_metadata?.desktop?.src || project.image;

  const customSchema = globalConfig ? {
    '@context': 'http://schema.org',
    '@type': 'Event',
    name: project.title,
    description: metaDescription,
    startDate: project.event_date,
    location: {
      '@type': 'Place',
      name: project.location || 'Polska',
      address: {
        '@type': 'PostalAddress',
        addressLocality: project.location || 'Polska',
        addressCountry: 'PL',
      },
    },
    image: previewImage,
    organizer: {
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
    keywords: keywords.join(', '),
    areaServed,
  } : undefined;

  return (
    <PageLayout pageSlug={`portfolio/${params.slug}`} customSchema={customSchema}>
      <PortfolioDetailClient />
    </PageLayout>
  );
}

export async function generateStaticParams() {
  const supabase = getSupabaseClient();

  const { data: projects } = await supabase
    .from('portfolio_projects')
    .select('slug');

  if (!projects) return [];

  return projects
    .filter(p => p.slug)
    .map((project) => ({
      slug: project.slug,
    }));
}
