import { notFound } from 'next/navigation';
import { unstable_noStore as noStore } from 'next/cache';
import { createClient } from '@supabase/supabase-js';
import { Metadata } from 'next';
import PageLayout from '@/components/Layout/PageLayout';
import { CategoryBreadcrumb } from '@/components/CategoryBreadcrumb';
import ServiceDetailClient from './ServiceDetailClient';
import { getSeoForPage } from '@/lib/seo';

// Create supabase client for server-side
const getSupabaseClient = () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables');
  }

  return createClient(supabaseUrl, supabaseKey);
};

async function loadServiceData(slug: string) {
  noStore(); // Prevent caching for dynamic data
  const supabase = getSupabaseClient();

  const { data: serviceData, error: serviceError } = await supabase
    .from('conferences_service_items')
    .select('*')
    .eq('slug', slug)
    // .eq('is_active', true)
    .maybeSingle();

  if (!serviceData || serviceError) {
    return null;
  }

  const { data: categoryData } = await supabase
    .from('conferences_service_categories')
    .select('*')
    .eq('id', serviceData.category_id)
    .eq('is_active', true)
    .maybeSingle();

  let relatedServices: any[] = [];
  if (categoryData) {
    const { data: related } = await supabase
      .from('conferences_service_items')
      .select('*')
      .eq('category_id', categoryData.id)
      .eq('is_active', true)
      .neq('id', serviceData.id)
      .limit(10);

    if (related) {
      relatedServices = related;
    }
  }

  // Load hero image for OG image
  const { data: heroImage } = await supabase
    .from('service_hero_images')
    .select('image_url, alt_text')
    .eq('page_slug', `uslugi/${slug}`)
    .eq('is_active', true)
    .maybeSingle();

  // Load global config for schema.org
  const { data: globalConfig } = await supabase
    .from('schema_org_global')
    .select('*')
    .single();

  return {
    service: serviceData,
    category: categoryData,
    relatedServices,
    heroImage,
    globalConfig,
  };
}

// Generate metadata for SEO (SERVER SIDE)
export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const data = await loadServiceData(params.slug);

  if (!data) {
    return {
      title: 'Usługa nie znaleziona - MAVINCI Event & ART',
    };
  }

  const { service, heroImage } = data;
  const canonicalUrl = `https://mavinci.pl/uslugi/${service.slug}`;

  // Use hero image for OG, fallback to thumbnail, then default
  const ogImageUrl = heroImage?.image_url || service.thumbnail_url || 'https://mavinci.pl/logo-mavinci-crm.png';

  return {
    title: service.seo_title || `${service.name} - MAVINCI Event & ART`,
    description: service.seo_description || service.description,
    keywords: service.seo_keywords,
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      type: 'website',
      url: canonicalUrl,
      title: service.seo_title || service.name,
      description: service.seo_description || service.description,
      images: [{
        url: ogImageUrl,
        alt: heroImage?.alt_text || service.name,
      }],
      siteName: 'MAVINCI Event & ART',
    },
    twitter: {
      card: 'summary_large_image',
      title: service.seo_title || service.name,
      description: service.seo_description || service.description,
      images: [ogImageUrl],
    },
  };
}

export default async function ServiceDetailPage({
  params,
}: {
  params: { slug: string };
}) {
  const data = await loadServiceData(params.slug);

  if (!data) {
    notFound();
  }

  const seo = await getSeoForPage(`uslugi/${params.slug}`);
  if (!seo) return null;

  const { service, category, relatedServices, heroImage, globalConfig } = data;

  // Calculate OG image URL
  const ogImageUrl = heroImage?.image_url || service.thumbnail_url || 'https://mavinci.pl/logo-mavinci-crm.png';

  // Build Schema.org using SERVICE data (server-side)
  const pageUrl = `https://mavinci.pl/uslugi/${service.slug}`;
  const serviceName = service.seo_title || service.name;
  const description = service.seo_description || service.description;
  const areaServed = seo.places.map((place) => ({
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

  const customSchema = globalConfig ? {
    '@context': 'http://schema.org',
    '@type': 'Service',
    name: serviceName,
    description: description,
    url: pageUrl,
    image: ogImageUrl,
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
    areaServed: areaServed,
    ...(category && {
      category: category.name,
      serviceType: category.name,
    }),
  } : undefined;

  return (
    <PageLayout pageSlug={`uslugi/${service.slug}`} customSchema={customSchema}>
      <div className="min-h-screen bg-[#0f1119]">
        <section className="px-6 pt-24">
          <div className="mx-auto max-w-7xl">
            <CategoryBreadcrumb
              pageSlug={`uslugi/${service.slug}`}
              productName={service.name}
              hideMetadataButton={true}
            />
          </div>
        </section>
        <ServiceDetailClient
          service={service}
          category={category}
          relatedServices={relatedServices}
          ogImage={ogImageUrl}
        />
      </div>
    </PageLayout>
  );
}

// Generate static params for known services at build time
export async function generateStaticParams() {
  const supabase = getSupabaseClient();

  const { data: services } = await supabase
    .from('conferences_service_items')
    .select('slug')
    .eq('is_active', true);

  if (!services) return [];

  return services.map((service) => ({
    slug: service.slug,
  }));
}
