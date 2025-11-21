import { notFound } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import Head from 'next/head';
import ServiceLayout from '@/app/uslugi/ServiceLayout';
import ServiceDetailClient from './ServiceDetailClient';

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
  const supabase = getSupabaseClient();

  const { data: serviceData, error: serviceError } = await supabase
    .from('conferences_service_items')
    .select('*')
    .eq('slug', slug)
    .eq('is_active', true)
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

  return {
    service: serviceData,
    category: categoryData,
    relatedServices,
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

  const { service, category, relatedServices } = data;

  const canonicalUrl = `https://mavinci.pl/uslugi/${service.slug}`;

  const serviceJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: service.name,
    description: service.description,
    provider: {
      '@type': 'Organization',
      name: 'MAVINCI Event & ART',
    },
    url: canonicalUrl,
    ...(service.thumbnail_url && { image: service.thumbnail_url }),
  };

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Strona główna',
        item: 'https://mavinci.pl/',
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Usługi',
        item: 'https://mavinci.pl/uslugi',
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: service.name,
        item: canonicalUrl,
      },
    ],
  };

  return (
    <>
      <Head>
        <title>{service.seo_title || `${service.name} - MAVINCI Event & ART`}</title>
        <meta name="description" content={service.seo_description || service.description} />
        {service.seo_keywords && <meta name="keywords" content={service.seo_keywords} />}

        <meta property="og:type" content="product" />
        <meta property="og:title" content={service.seo_title || service.name} />
        <meta property="og:description" content={service.seo_description || service.description} />
        <meta property="og:url" content={canonicalUrl} />
        <meta property="og:image" content={service.thumbnail_url} />
        <meta property="og:site_name" content="MAVINCI Event & ART" />

        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={service.seo_title || service.name} />
        <meta name="twitter:description" content={service.seo_description || service.description} />
        <meta name="twitter:image" content={service.thumbnail_url} />

        <link rel="canonical" href={canonicalUrl} />

        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@graph': [serviceJsonLd, breadcrumbJsonLd],
            }),
          }}
        />
      </Head>

      <ServiceLayout
        pageSlug={`uslugi/${service.slug}`}
        section={`${service.slug}-hero`}
      >
        <ServiceDetailClient
          service={service}
          category={category}
          relatedServices={relatedServices}
          onServiceUpdate={() => {
            // Refresh handled by client navigation
          }}
        />
      </ServiceLayout>
    </>
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
