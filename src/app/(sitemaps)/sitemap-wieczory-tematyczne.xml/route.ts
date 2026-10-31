import { getPublishedThemedPartyCities } from '@/lib/SEO/themedPartyData.server';
import { SITE } from '@/lib/SEO/site';
import { getPublishedThemedPartyScenarios } from '@/lib/SEO/themedPartyScenarios.server';
import { publicSupabase } from '@/lib/SEO/publicData';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const [cities, scenarios, editorial] = await Promise.all([
      getPublishedThemedPartyCities(), getPublishedThemedPartyScenarios(),
      publicSupabase().from('seo_city_content').select('city,updated_at').eq('page_slug', 'wieczory-tematyczne').eq('is_active', true),
    ]);
    if (editorial.error) throw new Error('Nie udało się pobrać dat aktualizacji treści lokalnych.');
    // Slugs are validated by the shared publication predicate. No artificial daily lastmod.
    const cityUrls = cities.map(city => {
      const changed = (editorial.data || []).find(row => row.city === city.locality)?.updated_at;
      const dates = [Date.parse(city.created_at || ''), Date.parse(changed || '')].filter(value => Number.isFinite(value) && value <= Date.now());
      const lastmod = dates.length ? `<lastmod>${new Date(Math.max(...dates)).toISOString()}</lastmod>` : '';
      return `  <url><loc>${SITE.url}/oferta/wieczory-tematyczne/${city.locality}</loc>${lastmod}</url>`;
    });
    const scenarioUrls = scenarios.map(item => {
      const timestamp = item.updatedAt ? Date.parse(item.updatedAt) : NaN;
      const lastmod = Number.isFinite(timestamp) ? `<lastmod>${new Date(timestamp).toISOString()}</lastmod>` : '';
      return `  <url><loc>${SITE.url}${item.href}</loc>${lastmod}</url>`;
    });
    const urls = [...cityUrls, ...scenarioUrls].join('\n');
    return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=0, must-revalidate' } });
  } catch {
    return new Response('Mapa witryny chwilowo niedostępna.', { status: 503, headers: { 'Retry-After': '300', 'Cache-Control': 'no-store' } });
  }
}
