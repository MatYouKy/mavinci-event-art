import { getPublishedConferenceCities, publicSupabase } from '@/lib/SEO/publicData';
import { SITE } from '@/lib/SEO/site';
import { getConferenceCitySourceData } from '@/lib/conferences-data';
import { selectConferenceReferences } from '@/lib/SEO/conferencePortfolio';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Date of the shared, visible copy revision. Never replace this with the request time.
const CONTENT_REVISION = '2026-10-09T00:00:00+02:00';
type DatedRow = { updated_at?: string | null; created_at?: string | null };
function lastModified(rows: DatedRow[]) {
  const dates = [Date.parse(CONTENT_REVISION), ...rows.map(row => Date.parse(row.updated_at || row.created_at || ''))]
    .filter(date => Number.isFinite(date) && date <= Date.now());
  return dates.length ? new Date(Math.max(...dates)).toISOString() : null;
}

export async function GET() {
  try {
    const client = publicSupabase();
    const [cities, source, metadata, localHeroes, sharedHero, cases] = await Promise.all([
      getPublishedConferenceCities(), getConferenceCitySourceData(client),
      client.from('schema_org_page_metadata').select('page_slug,updated_at,created_at').eq('is_active', true).like('page_slug', 'oferta/konferencje/%'),
      client.from('service_hero_images').select('*').eq('is_active', true).like('page_slug', 'oferta/konferencje/%'),
      client.from('konferencje_page_images').select('*').eq('is_active', true).eq('section', 'hero'),
      client.from('polish_city_cases').select('*').eq('is_active', true),
    ]);
    if ([metadata, localHeroes, sharedHero, cases].some(result => result.error)) throw new Error('Sitemap source unavailable');
    const commonRows = [...source.services, ...source.caseStudies, ...source.advantages, ...source.process, ...source.faq];
    const urls = cities.map(city => {
      const slug = `oferta/konferencje/${city.locality}`;
      const localHero = (localHeroes.data || []).find(row => row.page_slug === slug);
      const rows = [city, ...commonRows,
        ...(metadata.data || []).filter(row => row.page_slug === slug),
        ...(cases.data || []).filter(row => row.city_key === city.locality),
        ...(localHero ? [localHero] : []),
        ...(!localHero?.image_url ? sharedHero.data || [] : []),
        ...selectConferenceReferences(source.portfolio, city.locality),
      ];
      const modified = lastModified(rows);
      return `  <url><loc>${SITE.url}/${slug}</loc>${modified ? `<lastmod>${modified}</lastmod>` : ''}</url>`;
    }).join('\n');
    return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=0, must-revalidate' } });
  } catch {
    return new Response('Mapa witryny chwilowo niedostępna.', {
      status: 503, headers: { 'Retry-After': '300', 'Cache-Control': 'no-store' },
    });
  }
}
