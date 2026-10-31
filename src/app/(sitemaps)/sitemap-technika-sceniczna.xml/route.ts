import { getPublishedTechnicalStageCities } from '@/lib/SEO/technicalStageData.server';
import { SITE } from '@/lib/SEO/site';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    // Share the publication and slug rules with the pages and city directory.
    const cities = await getPublishedTechnicalStageCities();
    const urls = cities.map(city => `  <url><loc>${SITE.url}/oferta/technika-sceniczna/${city.locality}</loc></url>`).join('\n');
    return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`, {
      headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=0, must-revalidate' },
    });
  } catch {
    return new Response('Mapa witryny chwilowo niedostępna.', {
      status: 503, headers: { 'Retry-After': '300', 'Cache-Control': 'no-store' },
    });
  }
}
