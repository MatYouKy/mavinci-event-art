export async function getConferencesData(supabase: any) {
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
    supabase.from('conferences_service_categories').select(`*, items:conferences_service_items(*)`).eq('is_active', true).order('display_order'),
    supabase.from('conferences_related_services').select(`*, service_item:conferences_service_items(*)`).eq('is_active', true).order('display_order'),
    supabase.from('conferences_service_items').select('*').eq('is_active', true).order('name'),
    supabase.from('conferences_gallery').select('*').eq('is_active', true).order('display_order'),
  ]);

  const relatedServices = (relatedServicesRes.data ?? [])
    .map((r: any) => r.service_item)
    .filter(Boolean);

  return {
    hero: heroRes.data ?? [],
    services: servicesRes.data ?? [],
    caseStudies: caseStudiesRes.data ?? [],
    advantages: advantagesRes.data ?? [],
    process: processRes.data ?? [],
    pricing: pricingRes.data ?? [],
    faq: faqRes.data ?? [],
    gallery: galleryRes.data ?? [],
    portfolio: portfolioRes.data ?? [],
    cities: citiesRes.data ?? [],
    serviceCategories: serviceCategoriesRes.data ?? [],
    relatedServices,
    allServiceItems: allServiceItemsRes.data ?? [],
  };
}