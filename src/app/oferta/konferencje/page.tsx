export const dynamic = 'force-dynamic';
export const revalidate = 0;

import OfferLayout from '../OfferLayout';
import { buildMetadataForSlug } from '@/lib/seo-helpers';
import ConferencesPageClient from './ConferencesPage';

import { createSupabaseServerClient } from '@/lib/server';

const pageSlug = 'oferta/konferencje';

export async function generateMetadata() {
  return buildMetadataForSlug(pageSlug);
}

export default async function Page() {
  const supabase = createSupabaseServerClient();

  const [
    heroRes,
    servicesRes,
    caseStudiesRes,
    advantagesRes,
    processRes,
    pricingRes,
    faqRes,
    portfolioRes,
    citiesRes,
    serviceCategoriesRes,
    relatedServicesRes,
    allServiceItemsRes,
    galleryRes,
  ] = await Promise.all([
    supabase.from('conferences_hero').select('*').eq('is_active', true).single(),
    supabase.from('conferences_services').select('*').eq('is_active', true).order('display_order'),
    supabase.from('conferences_case_studies').select('*').eq('is_active', true).order('display_order'),
    supabase.from('conferences_advantages').select('*').eq('is_active', true).order('display_order'),
    supabase.from('conferences_process').select('*').eq('is_active', true).order('display_order'),
    supabase.from('conferences_pricing').select('*').eq('is_active', true).order('display_order'),
    supabase.from('conferences_faq').select('*').eq('is_active', true).order('display_order'),
    supabase.from('portfolio_projects').select('*').contains('tags', ['konferencje']).order('order_index'),
    supabase.from('conferences_cities').select('*').eq('is_active', true).order('display_order'),
    supabase
      .from('conferences_service_categories')
      .select(`*, items:conferences_service_items(*)`)
      .eq('is_active', true)
      .order('display_order'),
    supabase
      .from('conferences_related_services')
      .select(`*, service_item:conferences_service_items(*)`)
      .eq('is_active', true)
      .order('display_order'),
    supabase.from('conferences_service_items').select('*').eq('is_active', true).order('name'),
    supabase.from('conferences_gallery').select('*').eq('is_active', true).order('display_order'),
  ]);

  const heroData = heroRes.data ?? null;

  // relatedServices: u Ciebie to była mapa do samego service_item + Set(id)
  const relatedServiceItems = (relatedServicesRes.data ?? [])
    .map((r: any) => r.service_item)
    .filter(Boolean);

  const selectedServiceIds = new Set(
    (relatedServicesRes.data ?? []).map((r: any) => r.service_item_id).filter(Boolean)
  );

  return (
    <OfferLayout pageSlug={pageSlug} section="konferencje-hero">
      <ConferencesPageClient
        initialHeroData={heroData}
        initialServices={servicesRes.data ?? []}
        initialCaseStudies={caseStudiesRes.data ?? []}
        initialAdvantages={advantagesRes.data ?? []}
        initialProcess={processRes.data ?? []}
        initialPricing={pricingRes.data ?? []}
        initialFaq={faqRes.data ?? []}
        initialGallery={galleryRes.data ?? []}
        initialPortfolioProjects={portfolioRes.data ?? []}
        initialCities={citiesRes.data ?? []}
        initialServiceCategories={serviceCategoriesRes.data ?? []}
        initialRelatedServices={relatedServiceItems}
        initialAllServiceItems={allServiceItemsRes.data ?? []}
        initialSelectedServiceIds={[...selectedServiceIds]}
      />
    </OfferLayout>
  );
}   