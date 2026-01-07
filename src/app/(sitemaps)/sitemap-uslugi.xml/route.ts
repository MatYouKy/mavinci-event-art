import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const revalidate = 3600;

const baseUrl = 'https://mavinci.pl';

const getSupabaseClient = () => {
  const supabaseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    '';

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables');
  }

  return createClient(supabaseUrl, supabaseKey);
};

type ChangeFreq =
  | 'always'
  | 'hourly'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'yearly'
  | 'never';

interface SitemapUrl {
  loc: string;
  lastmod?: string;
  changefreq?: ChangeFreq;
  priority?: number;
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function generateSitemapXml(urls: SitemapUrl[]): string {
  const urlsXml = urls
    .map((u) => {
      return `
  <url>
    <loc>${escapeXml(u.loc)}</loc>${u.lastmod ? `
    <lastmod>${u.lastmod}</lastmod>` : ''}${u.changefreq ? `
    <changefreq>${u.changefreq}</changefreq>` : ''}${u.priority !== undefined ? `
    <priority>${u.priority}</priority>` : ''}
  </url>`;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urlsXml}
</urlset>`;
}

export async function GET() {
  const supabase = getSupabaseClient();
  const urls: SitemapUrl[] = [];

  // ✅ Usługi (uslugi/:slug)
  try {
    const { data: services, error } = await supabase
      .from('conferences_service_items')
      .select('slug, updated_at')
      .eq('is_active', true);

    if (error) throw error;

    if (services?.length) {
      services.forEach((service) => {
        urls.push({
          loc: `${baseUrl}/uslugi/${service.slug}`,
          lastmod: service.updated_at || new Date().toISOString(),
          changefreq: 'monthly',
          priority: 0.7,
        });
      });
    }
  } catch (e) {
    console.error('Error fetching conferences_service_items:', e);
  }

  const xml = generateSitemapXml(urls);

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml',
      // przy sitemapach często lepiej nie trzymać agresywnego cache
      'Cache-Control': 'public, max-age=0, must-revalidate',
    },
  });
}