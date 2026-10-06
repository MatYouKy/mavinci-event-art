import { publicSupabase, getPublishedConferenceCities } from '@/lib/SEO/publicData';
import { SITE } from '@/lib/SEO/site';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function escapeXml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function imageUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  try { const url = new URL(value, SITE.url); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; }
  catch { return null; }
}

export async function GET() {
  try {
    const db = publicSupabase();
    const [metadata, services, heroes, gallery, portfolio, cities] = await Promise.all([
      db.from('schema_org_page_metadata').select('page_slug, og_image').eq('is_active', true),
      db.from('conferences_service_items').select('id, slug, thumbnail_url, hero_image_url').eq('is_active', true),
      db.from('service_hero_images').select('page_slug, image_url').eq('is_active', true),
      db.from('conferences_service_gallery').select('service_id, image_url').eq('is_active', true),
      db.from('portfolio_projects').select('slug, image, image_metadata, gallery'),
      getPublishedConferenceCities(),
    ]);
    for (const result of [metadata, services, heroes, gallery, portfolio]) {
      if (result.error) throw new Error('Nie udało się pobrać zdjęć.');
    }
    const redirects = new Set(['konferencje', 'kasyno', 'naglosnienie', 'dj-eventowy', 'streaming',
      'symulatory-vr', 'quizy-teleturnieje', 'wieczory-tematyczne', 'integracje', 'technika-sceniczna']);
    const serviceRows = (services.data || []).filter((row) => row.slug && !redirects.has(row.slug));
    const validPages = new Set(['home', 'o-nas', 'zespol', 'oferta', 'portfolio', 'uslugi', 'dla-agencji-i-hoteli',
      ...['konferencje', 'kasyno', 'streaming', 'integracje', 'dj-eventowy', 'technika-sceniczna',
        'quizy-teleturnieje', 'wieczory-tematyczne', 'symulatory-vr'].map((slug) => `oferta/${slug}`),
      ...['blackjack', 'ruletka', 'poker'].map((slug) => `oferta/kasyno/zasady/${slug}`),
      ...cities.map((city) => `oferta/konferencje/${city.locality}`),
      ...serviceRows.map((row) => `uslugi/${row.slug}`),
      ...(portfolio.data || []).filter((row) => row.slug).map((row) => `portfolio/${row.slug}`),
    ]);
    const pages = new Map<string, Set<string>>();
    function add(slug: string, value: unknown) {
      const url = imageUrl(value);
      if (!url || !validPages.has(slug)) return;
      if (!pages.has(slug)) pages.set(slug, new Set());
      pages.get(slug)!.add(url);
    }
    for (const row of metadata.data || []) add(row.page_slug, row.og_image);
    for (const row of serviceRows) {
      const slug = `uslugi/${row.slug}`;
      add(slug, row.hero_image_url || row.thumbnail_url);
      for (const hero of heroes.data || []) if (hero.page_slug === slug) add(slug, hero.image_url);
      for (const photo of gallery.data || []) if (photo.service_id === row.id) add(slug, photo.image_url);
    }
    for (const row of portfolio.data || []) {
      const slug = `portfolio/${row.slug}`;
      add(slug, row.image_metadata?.desktop?.src || row.image);
      for (const photo of Array.isArray(row.gallery) ? row.gallery : []) {
        add(slug, photo.image_metadata?.desktop?.src || photo.src || photo.url || photo.image_url || photo.image);
      }
    }
    const body = Array.from(pages, ([slug, images]) => `<url><loc>${escapeXml(slug === 'home' ? SITE.url : `${SITE.url}/${slug}`)}</loc>${Array.from(images, (url) => `<image:image><image:loc>${escapeXml(url)}</image:loc></image:image>`).join('')}</url>`).join('\n');
    return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">${body}</urlset>`,
      { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=0, must-revalidate' } });
  } catch {
    return new Response('Mapa zdjęć chwilowo niedostępna.', {
      status: 503, headers: { 'Retry-After': '300', 'Cache-Control': 'no-store' },
    });
  }
}
