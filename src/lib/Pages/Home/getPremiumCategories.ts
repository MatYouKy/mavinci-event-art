import { createClient } from '@supabase/supabase-js';

type CategoryRow = {
  id: string;
  name: string;
  slug: string;
  display_order: number;
  is_active: boolean;
  icon: string;
};

type ServiceRow = {
  id: string;
  name: string;
  slug: string;
  thumbnail_url: string | null;
  category_id: string;
  display_order: number;
  icon: string;
  description: string;
};

export type CategoryWithFirstService = CategoryRow & {
  first_service?: Pick<ServiceRow, 'id' | 'name' | 'slug' | 'thumbnail_url'>;
  icon: string;
  description: string;
  display_order: number;
  is_active: boolean;
};

function getServerSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!; // tylko na serwerze
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Pobiera aktywne kategorie, a do każdej dobiera pierwszy (display_order) premium service.
 * Zwraca tylko kategorie, które mają premium service.
 */
export async function getPremiumConferenceCategories(): Promise<CategoryWithFirstService[]> {
  const supabase = getServerSupabase();

  // 1) kategorie
  const { data: categories, error: catError } = await supabase
    .from('conferences_service_categories')
    .select('id, name, slug, display_order, is_active, icon, description')
    .eq('is_active', true)
    .order('display_order');

  if (catError) throw catError;
  if (!categories?.length) return [];

  // 2) wszystkie premium service dla tych kategorii (jedno zapytanie)
  const categoryIds = categories.map((c) => c.id);

  const { data: services, error: svcError } = await supabase
    .from('conferences_service_items')
    .select('id, name, slug, thumbnail_url, category_id, display_order, icon, description')
    .in('category_id', categoryIds)
    .eq('is_active', true)
    .eq('is_premium', true)
    .order('display_order');

  if (svcError) throw svcError;

  // 3) mapowanie: pierwszy premium service per kategoria
  const firstServiceByCategory = new Map<string, ServiceRow>();

  for (const svc of services ?? []) {
    if (!firstServiceByCategory.has(svc.category_id)) {
      firstServiceByCategory.set(svc.category_id, svc);
    }
  }

  // 4) tylko te kategorie, które mają premium service
  return categories
    .map((cat) => {
      const svc = firstServiceByCategory.get(cat.id);
      return svc
        ? {
            ...cat,
            first_service: {
              id: svc.id,
              name: svc.name,
              slug: svc.slug,
              thumbnail_url: svc.thumbnail_url,
            },
          }
        : null;
    })
    .filter(Boolean) as CategoryWithFirstService[];
}