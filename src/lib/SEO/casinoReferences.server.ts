import 'server-only';
import { cache } from 'react';
import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';
import { publicSupabase } from './publicData';

export const CASINO_PRODUCT_ID = '32072a07-439e-4942-9b97-5ea2b60e4f89';
export const CASINO_PRODUCT_PATH = `/produkty/${CASINO_PRODUCT_ID}`;
export type PublicCasinoEntry = { title: string; text: string };
export type CasinoOfferProduct = {
  name: string; lead: string; href: string;
  benefits: PublicCasinoEntry[]; requirements: PublicCasinoEntry[];
  packages: { id: string; name: string; description: string; scope: string; bonus: string; href: string }[];
  variants: { id: string; name: string; description: string; href: string }[];
};
export type CasinoReference = {
  id: string; title: string; description: string; href: string;
  image: string; mobileImage: string; alt: string;
  location: string; eventCitySlug: string; order: number; corporate: boolean;
};

function plain(value: unknown): string {
  return typeof value === 'string' ? value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim() : '';
}
function entries(value: unknown): PublicCasinoEntry[] {
  return Array.isArray(value) ? value.flatMap(item => {
    if (typeof item === 'string') return plain(item) ? [{ title: '', text: plain(item) }] : [];
    if (!item || typeof item !== 'object') return [];
    const title = plain(item.title || item.name);
    const text = plain(item.description || item.text || item.content)
      .replace(/; nie utożsamiaj obsady montażowej z krupierami\./i, '.');
    return title || text ? [{ title, text }] : [];
  }) : [];
}

/** Same deliberately public copy as /produkty/[id]. Never return raw CRM rows,
 * package pricing/configuration, costs, supplier data or signed private assets. */
export const getCasinoOfferProduct = cache(async (): Promise<CasinoOfferProduct | null> => {
  try {
    const db = createSupabaseAdminClient();
    const [product, variants] = await Promise.all([
      db.from('offer_products')
        .select('id,name,offer_short_description,offer_benefits,offer_additional_requirements,offer_requirements,sales_packages_enabled,sales_packages')
        .eq('id', CASINO_PRODUCT_ID).eq('is_active', true).maybeSingle(),
      db.from('offer_product_variants').select('id,name,short_description,description')
        .eq('product_id', CASINO_PRODUCT_ID).eq('is_active', true).order('display_order'),
    ]);
    if (product.error || variants.error) throw new Error('Casino product unavailable');
    if (!product.data) return null;
    const row = product.data;
    const requirements = entries(row.offer_additional_requirements);
    return {
      name: plain(row.name), lead: plain(row.offer_short_description), href: CASINO_PRODUCT_PATH,
      benefits: entries(row.offer_benefits),
      requirements: requirements.length ? requirements : entries(row.offer_requirements),
      variants: (variants.data || []).map(variant => ({
        id: variant.id, name: plain(variant.name),
        description: plain(variant.description) || plain(variant.short_description),
        href: `${CASINO_PRODUCT_PATH}#element-${variant.id}`,
      })),
      packages: row.sales_packages_enabled && Array.isArray(row.sales_packages)
        ? row.sales_packages.flatMap((value: unknown) => {
          if (!value || typeof value !== 'object') return [];
          const item = value as Record<string, unknown>;
          const name = plain(item.name);
          return name ? [{ id: plain(item.id) || name, name,
            description: plain(item.description), scope: plain(item.included_label), bonus: plain(item.bonus),
            href: `${CASINO_PRODUCT_PATH}#pakiety`,
          }] : [];
        }) : [],
    };
  } catch {
    // An optional CRM description must not turn a public service page into an error.
    console.error('Nie udało się pobrać publicznego opisu strefy kasynowej.');
    return null;
  }
});

// Existing published descriptions explicitly confirm a casino in these events.
// Future references can be selected through an explicit casino tag in the portfolio editor.
const confirmedReferences = new Set([
  '7612c319-a402-4981-a5dd-f79502c9cf01',
  '2d67e231-5714-479d-b666-d9e6394c1f2c',
  '44c3e755-dd64-4214-a000-8b2bbb07894e',
]);
export const getCasinoReferences = cache(async (): Promise<CasinoReference[]> => {
  const { data, error } = await publicSupabase().from('portfolio_projects')
    .select('id,slug,title,description,location,tags,event_city_slug,image,image_metadata,alt,order_index')
    .order('order_index');
  if (error) {
    console.error('Nie udało się pobrać realizacji kasynowych.');
    return [];
  }
  return (data || []).filter(project => {
    const tags = Array.isArray(project.tags) ? project.tags.map(tag => plain(tag).toLocaleLowerCase('pl-PL')) : [];
    return confirmedReferences.has(project.id) || tags.some(tag => ['kasyno', 'kasyno eventowe', 'kasyno-eventowe', 'casino'].includes(tag));
  }).filter(project => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(project.slug || '')).map(project => ({
    id: project.id, title: plain(project.title), description: plain(project.description),
    href: `/portfolio/${project.slug}`, image: project.image_metadata?.desktop?.src || project.image || '',
    mobileImage: project.image_metadata?.mobile?.src || '', alt: plain(project.alt) || plain(project.title),
    location: plain(project.location) === 'Polska' ? '' : plain(project.location),
    eventCitySlug: plain(project.event_city_slug), order: project.order_index ?? 0,
    corporate: Array.isArray(project.tags) && project.tags.includes('konferencje'),
  }));
});

export function selectCasinoReferences(projects: CasinoReference[], citySlug: string) {
  // Prioritize real local work, then corporate references. Targeting a city is not proof of location.
  return [...projects].sort((a, b) => Number(b.eventCitySlug === citySlug) - Number(a.eventCitySlug === citySlug)
    || Number(b.corporate) - Number(a.corporate) || a.order - b.order).slice(0, 3);
}
