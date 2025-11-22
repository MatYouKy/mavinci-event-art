import { notFound } from 'next/navigation';
import { unstable_noStore as noStore } from 'next/cache';
import { createClient } from '@supabase/supabase-js';
import { Metadata } from 'next';
import PageLayout from '@/components/Layout/PageLayout';
import { CategoryBreadcrumb } from '@/components/CategoryBreadcrumb';
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

  return {
    service: serviceData,
    category: categoryData,
    relatedServices,
    heroImage,
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

//   const { service, heroImage } = data;
//   const canonicalUrl = `https://mavinci.pl/uslugi/${service.slug}`;

//   // Use hero image for OG, fallback to thumbnail, then default
//   const ogImageUrl = heroImage?.image_url || service.thumbnail_url || 'https://mavinci.pl/logo-mavinci-crm.png';

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
//       images: [{
//         url: ogImageUrl,
//         alt: heroImage?.alt_text || service.name,
//       }],
//       siteName: 'MAVINCI Event & ART',
//     },
//     twitter: {
//       card: 'summary_large_image',
//       title: service.seo_title || service.name,
//       description: service.seo_description || service.description,
//       images: [ogImageUrl],
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

  console.log('data', data);

  const { service, category, relatedServices, heroImage } = data;

  // Calculate OG image URL
  const ogImageUrl = heroImage?.image_url || service.thumbnail_url || 'https://mavinci.pl/logo-mavinci-crm.png';

  return (
    <PageLayout pageSlug={`uslugi/${service.slug}`}>
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
