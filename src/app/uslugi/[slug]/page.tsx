import { notFound } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import { Metadata } from 'next';
import PageLayout from '@/components/Layout/PageLayout';
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

// Generate metadata for SEO
// export async function generateMetadata({
//   params,
// }: {
//   params: { slug: string };
// }): Promise<Metadata> {
//   const data = await loadServiceData(params.slug);

//   if (!data) {
//     return {
//       title: 'Usługa nie znaleziona - MAVINCI Event & ART',
//     };
//   }

//   const { service } = data;
//   const canonicalUrl = `https://mavinci.pl/uslugi/${service.slug}`;

//   return {
//     title: service.seo_title || `${service.name} - MAVINCI Event & ART`,
//     description: service.seo_description || service.description,
//     keywords: service.seo_keywords,
//     alternates: {
//       canonical: canonicalUrl,
//     },
//     openGraph: {
//       type: 'website',
//       url: canonicalUrl,
//       title: service.seo_title || service.name,
//       description: service.seo_description || service.description,
//       images: service.thumbnail_url ? [{ url: service.thumbnail_url }] : [],
//       siteName: 'MAVINCI Event & ART',
//     },
//     twitter: {
//       card: 'summary_large_image',
//       title: service.seo_title || service.name,
//       description: service.seo_description || service.description,
//       images: service.thumbnail_url ? [service.thumbnail_url] : [],
//     },
//   };
// }

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

  // PageLayout handles SEO metadata and breadcrumbs automatically

  return (
    <PageLayout pageSlug={`uslugi/${service.slug}`}>
      <ServiceDetailClient
        pageSlug={`uslugi/${service.slug}`}
        service={service}
        category={category}
        relatedServices={relatedServices}
      />
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
