import { createClient } from '@supabase/supabase-js';

export interface Service {
  id: string;
  slug: string;
  title: string;
  description: string;
  icon_name: string;
  color_from: string;
  color_to: string;
  border_color: string;
  hero_image_url: string | null;
  hero_opacity: number;
  order_index: number;
  image_metadata?: any;
}

type ServicePage = {
  table: string;
  slug: string;
  icon: string;
  order: number;
  color_from?: string;
  color_to?: string;
  border_color?: string;
};

function getServerSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!; // tylko serwer
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Pobiera "hero" z wielu tabel (servicePages) i mapuje do wspólnego typu Service.
 * Zapytania lecą równolegle.
 */
export async function getHeroServices(servicePages: ServicePage[]): Promise<Service[]> {
  const supabase = getServerSupabase();

  const results = await Promise.all(
    servicePages.map(async (page) => {
      try {
        const { data, error } = await supabase
          .from(page.table)
          .select('*')
          .eq('section', 'hero')
          .eq('is_active', true)
          .maybeSingle();

        if (error || !data) return null; 

        const opacityRaw = (data as any).opacity;
        const opacity = typeof opacityRaw === 'number'
          ? opacityRaw
          : parseFloat(opacityRaw ?? '');

        return {
          id: (data as any).id,
          slug: page.slug,
          title: (data as any).title || page.slug,
          description: (data as any).description || '',
          icon_name: page.icon,

          // możesz tu robić per-page kolory
          color_from: page.color_from ?? 'blue-500/20',
          color_to: page.color_to ?? 'blue-600/20',
          border_color: page.border_color ?? 'border-blue-500/30',

          hero_image_url: (data as any).image_url ?? null,
          hero_opacity: Number.isFinite(opacity) ? opacity : 1,

          order_index: page.order,
          image_metadata: (data as any).image_metadata,
        } satisfies Service;
      } catch {
        return null;
      }
    })
  );

  return results
    .filter(Boolean)
    .sort((a, b) => (a!.order_index - b!.order_index)) as Service[];
}