import { publicSupabase } from '@/lib/SEO/publicData';
import { servicePath, canonicalServiceSlug, SERVICE_OFFER_PATHS } from '@/lib/SEO/serviceUrls';
import { SITE } from '@/lib/SEO/site';

export const dynamic = 'force-dynamic';
function escapeXml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
export async function GET() {
  const { data, error } = await publicSupabase().from('conferences_service_items').select('id,slug,updated_at').eq('is_active', true).order('slug');
  if (error) return new Response('Mapa witryny chwilowo niedostępna.', { status: 503, headers: { 'Retry-After': '300', 'Cache-Control': 'no-store' } });
  const entries = new Map<string, string>();
  for (const service of data || []) {
    const slug = canonicalServiceSlug(service);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || SERVICE_OFFER_PATHS[slug]) continue;
    const loc = `${SITE.url}${servicePath(service)}`;
    const timestamp = Date.parse(service.updated_at || '');
    const lastmod = Number.isFinite(timestamp) ? `<lastmod>${new Date(timestamp).toISOString()}</lastmod>` : '';
    entries.set(loc, `  <url><loc>${escapeXml(loc)}</loc>${lastmod}</url>`);
  }
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...entries.values()].join('\n')}\n</urlset>`, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=0, must-revalidate' },
  });
}
