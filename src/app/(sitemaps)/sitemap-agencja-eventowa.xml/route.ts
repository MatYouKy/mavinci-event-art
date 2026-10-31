import { getPublishedAgencyCities } from '@/lib/SEO/eventAgencyData.server';
import { SITE } from '@/lib/SEO/site';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    // Ta sama lista redakcyjna i status publikacji co na stronach agencji.
    const cities = await getPublishedAgencyCities();
    const urls = cities.map((city) =>
      `  <url><loc>${SITE.url}/agencja-eventowa/${encodeURIComponent(city.slug)}</loc></url>`
    ).join('\n');

    return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=0, must-revalidate',
      },
    });
  } catch {
    return new Response('Mapa witryny jest chwilowo niedostępna.', {
      status: 503,
      headers: { 'Retry-After': '300', 'Cache-Control': 'no-store' },
    });
  }
}
