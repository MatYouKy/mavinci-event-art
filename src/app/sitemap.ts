import { MetadataRoute } from 'next';
import { createClient } from '@supabase/supabase-js';

const getSupabaseClient = () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables');
  }

  return createClient(supabaseUrl, supabaseKey);
};

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = 'https://mavinci.pl';
  const supabase = getSupabaseClient();

  const mainPages: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1.0,
    },
  ];

  try {
    const { data: metadataPages } = await supabase
      .from('schema_org_page_metadata')
      .select('page_slug, updated_at, priority, change_frequency')
      .eq('is_active', true)
      .order('priority', { ascending: false });

    if (metadataPages && metadataPages.length > 0) {
      const dynamicPages = metadataPages.map((page) => ({
        url: `${baseUrl}/${page.page_slug === 'home' ? '' : page.page_slug}`,
        lastModified: page.updated_at ? new Date(page.updated_at) : new Date(),
        changeFrequency: (page.change_frequency || 'weekly') as
          | 'always'
          | 'hourly'
          | 'daily'
          | 'weekly'
          | 'monthly'
          | 'yearly'
          | 'never',
        priority: page.priority || 0.8,
      }));

      mainPages.push(...dynamicPages.filter(p => p.url !== baseUrl));
    }
  } catch (error) {
    console.error('Error fetching metadata pages for sitemap:', error);
  }

  // Fetch dynamic service detail pages from conferences_service_items
  let serviceDetailPages: MetadataRoute.Sitemap = [];
  try {
    const { data: services } = await supabase
      .from('conferences_service_items')
      .select('slug, updated_at')
      .eq('is_active', true);

    if (services && services.length > 0) {
      serviceDetailPages = services.map((service) => ({
        url: `${baseUrl}/uslugi/${service.slug}`,
        lastModified: service.updated_at ? new Date(service.updated_at) : new Date(),
        changeFrequency: 'monthly' as const,
        priority: 0.7,
      }));
    }
  } catch (error) {
    console.error('Error fetching service detail pages for sitemap:', error);
  }

  const casinoSubpages: MetadataRoute.Sitemap = [
    {
      url: `${baseUrl}/oferta/kasyno/zasady/blackjack`,
      lastModified: new Date(),
      changeFrequency: 'yearly',
      priority: 0.5,
    },
    {
      url: `${baseUrl}/oferta/kasyno/zasady/ruletka`,
      lastModified: new Date(),
      changeFrequency: 'yearly',
      priority: 0.5,
    },
    {
      url: `${baseUrl}/oferta/kasyno/zasady/poker`,
      lastModified: new Date(),
      changeFrequency: 'yearly',
      priority: 0.5,
    },
  ];

  let portfolioPages: MetadataRoute.Sitemap = [];
  try {
    const { data: projects } = await supabase
      .from('portfolio_projects')
      .select('slug, updated_at')
      .order('order_index');

    if (projects && projects.length > 0) {
      portfolioPages = projects.map((project) => ({
        url: `${baseUrl}/portfolio/${project.slug}`,
        lastModified: project.updated_at ? new Date(project.updated_at) : new Date(),
        changeFrequency: 'monthly' as const,
        priority: 0.7,
      }));
    }
  } catch (error) {
    console.error('Error fetching portfolio projects for sitemap:', error);
  }

  let cityPages: MetadataRoute.Sitemap = [];
  try {
    const { data: cities } = await supabase
      .from('conferences_cities')
      .select('slug, updated_at')
      .eq('is_active', true)
      .order('name');

    if (cities && cities.length > 0) {
      cityPages = cities.map((city) => ({
        url: `${baseUrl}/oferta/konferencje/${city.slug}`,
        lastModified: city.updated_at ? new Date(city.updated_at) : new Date(),
        changeFrequency: 'monthly' as const,
        priority: 0.6,
      }));
    }
  } catch (error) {
    console.error('Error fetching city pages for sitemap:', error);
  }

  const allPages = [
    ...mainPages,
    ...serviceDetailPages,
    ...casinoSubpages,
    ...portfolioPages,
    ...cityPages,
  ];

  const uniquePages = allPages.filter(
    (page, index, self) => index === self.findIndex((p) => p.url === page.url)
  );

  return uniquePages;
}
