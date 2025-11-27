import { notFound, redirect } from 'next/navigation';
import { unstable_noStore as noStore } from 'next/cache';
import { createClient } from '@supabase/supabase-js';
import { Metadata } from 'next';
import PageLayout from '@/components/Layout/PageLayout';
import { CategoryBreadcrumb } from '@/components/CategoryBreadcrumb';
import ServiceDetailClient from './ServiceDetailClient';
import { getSeoForPage } from '@/lib/seo';
import { getSupabaseClient } from '@/lib/supabase';
import { getUserPermissions } from '@/lib/serverAuth';


async function loadServiceData(slug: string) {
  noStore(); // Prevent caching for dynamic data

  // Redirect special cases that should be under /oferta instead of /uslugi
  const ofertaRedirects: Record<string, string> = {
    'konferencje': '/oferta/konferencje',
    'kasyno': '/oferta/kasyno',
    'naglosnienie': '/oferta/naglosnienie',
    'dj-eventowy': '/oferta/dj-eventowy',
    'streaming': '/oferta/streaming',
    'symulatory-vr': '/oferta/symulatory-vr',
    'quizy-teleturnieje': '/oferta/quizy-teleturnieje',
    'wieczory-tematyczne': '/oferta/wieczory-tematyczne',
    'integracje': '/oferta/integracje',
    'technika-sceniczna': '/oferta/technika-sceniczna',
  };

  if (ofertaRedirects[slug]) {
    redirect(ofertaRedirects[slug]);
  }

  const supabase = getSupabaseClient();

  const { data: serviceData, error: serviceError } = await supabase
    .from('conferences_service_items')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();

  if (!serviceData || serviceError) {
    return null;
  }

  // Sprawdź uprawnienia użytkownika
  const { hasWebsiteEdit } = await getUserPermissions();

  // Jeśli usługa nieaktywna i użytkownik nie ma uprawnień - przekieruj
  if (!serviceData.is_active && !hasWebsiteEdit) {
    redirect('/uslugi/inactive');
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

  // Load service gallery
  const { data: gallery } = await supabase
    .from('conferences_service_gallery')
    .select('*')
    .eq('service_id', serviceData.id)
    .eq('is_active', true)
    .order('display_order');

  return {
    service: serviceData,
    category: categoryData,
    relatedServices,
    heroImage,
    globalConfig,
    gallery: gallery || [],
    hasWebsiteEdit,
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
  if (!seo) {
    notFound();
  }

  const { service, category, relatedServices, heroImage, globalConfig, gallery, hasWebsiteEdit } = data;
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
      <div className="min-h-screen bg-[#0f1119] mt-28">

        <ServiceDetailClient
          service={service}
          category={category}
          relatedServices={relatedServices}
          ogImage={ogImageUrl}
          gallery={gallery}
          isAdmin={hasWebsiteEdit}
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
