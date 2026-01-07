import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const revalidate = 3600;

const BASE_URL = 'https://mavinci.pl';

const getSupabaseClient = () => {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    '';

  if (!supabaseUrl || !supabaseKey) throw new Error('Missing Supabase env vars');
  return createClient(supabaseUrl, supabaseKey);
};

function escapeXml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function GET() {
  const supabase = getSupabaseClient();

  const { data: cities, error } = await supabase
    .from('polish_cities')
    .select('slug') // ✅ bez updated_at
    .order('population', { ascending: false }) // ✅ masz tę kolumnę
    .limit(5000);

  if (error) {
    // Jakby cokolwiek się wywaliło — zostaw pustą, ale możesz też dodać komentarz debug
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>`;
    return new Response(xml, { headers: { 'Content-Type': 'application/xml' }, status: 200 });
  }

  const urlsXml = (cities || [])
    .filter((c) => c?.slug)
    .map((c) => {
      const loc = `${BASE_URL}/oferta/konferencje/${c.slug}`;
      return `  <url>
    <loc>${escapeXml(loc)}</loc>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlsXml}
</urlset>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=0, must-revalidate',
    },
  });
}