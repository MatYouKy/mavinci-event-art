import { getPublishedCasinoRules } from '@/lib/SEO/casinoRules.server';

export const dynamic = 'force-dynamic';

type ChangeFreq = 'always'|'hourly'|'daily'|'weekly'|'monthly'|'yearly'|'never';

interface SitemapUrl {
  loc: string;
  lastmod?: string;
  changefreq?: ChangeFreq;
  priority?: number;
}

const BASE_URL = 'https://mavinci.pl';

function escapeXml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function generateSitemapXml(urls: SitemapUrl[]): string {
  const urlsXml = urls.map((u) => {
    const lastmod = u.lastmod ? `\n    <lastmod>${escapeXml(u.lastmod)}</lastmod>` : '';
    const changefreq = u.changefreq ? `\n    <changefreq>${u.changefreq}</changefreq>` : '';
    const priority = u.priority !== undefined ? `\n    <priority>${u.priority}</priority>` : '';
    return `  <url>
    <loc>${escapeXml(u.loc)}</loc>${lastmod}${changefreq}${priority}
  </url>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlsXml}
</urlset>`;
}

export async function GET() {
  try {
  const rules = await getPublishedCasinoRules();

  const urls: SitemapUrl[] = [
    { loc: `${BASE_URL}/`, changefreq: 'weekly', priority: 1.0 },

    { loc: `${BASE_URL}/o-nas`, changefreq: 'monthly', priority: 0.8 },
    { loc: `${BASE_URL}/agencja-eventowa`, changefreq: 'weekly', priority: 0.9 },
    { loc: `${BASE_URL}/zespol`, changefreq: 'monthly', priority: 0.8 },

    { loc: `${BASE_URL}/oferta`, changefreq: 'weekly', priority: 0.9 },
    { loc: `${BASE_URL}/oferta/konferencje`, changefreq: 'weekly', priority: 0.9 },
    { loc: `${BASE_URL}/oferta/konferencje/lokalizacje`, lastmod: '2026-10-15', changefreq: 'monthly', priority: 0.7 },

    { loc: `${BASE_URL}/oferta/kasyno`, changefreq: 'weekly', priority: 0.8 },
    { loc: `${BASE_URL}/oferta/kasyno/lokalizacje`, changefreq: 'weekly', priority: 0.7 },

    { loc: `${BASE_URL}/oferta/streaming`, changefreq: 'weekly', priority: 0.8 },
    { loc: `${BASE_URL}/oferta/streaming/lokalizacje`, lastmod: '2026-10-15', changefreq: 'monthly', priority: 0.7 },
    { loc: `${BASE_URL}/oferta/integracje`, changefreq: 'weekly', priority: 0.8 },
    { loc: `${BASE_URL}/oferta/dj-eventowy`, changefreq: 'weekly', priority: 0.8 },
    { loc: `${BASE_URL}/oferta/technika-sceniczna`, changefreq: 'weekly', priority: 0.8 },
    { loc: `${BASE_URL}/oferta/technika-sceniczna/lokalizacje`, changefreq: 'weekly', priority: 0.7 },
    { loc: `${BASE_URL}/oferta/quizy-teleturnieje`, changefreq: 'weekly', priority: 0.8 },
    { loc: `${BASE_URL}/oferta/quizy-teleturnieje/lokalizacje`, lastmod: '2026-10-15', changefreq: 'monthly', priority: 0.7 },
    { loc: `${BASE_URL}/oferta/wieczory-tematyczne`, changefreq: 'weekly', priority: 0.8 },
    { loc: `${BASE_URL}/oferta/wieczory-tematyczne/lokalizacje`, changefreq: 'weekly', priority: 0.7 },
    { loc: `${BASE_URL}/oferta/wieczory-tematyczne/motywy`, changefreq: 'monthly', priority: 0.7 },
    { loc: `${BASE_URL}/oferta/symulatory-vr`, changefreq: 'weekly', priority: 0.8 },

    { loc: `${BASE_URL}/dla-agencji-i-hoteli`, changefreq: 'monthly', priority: 0.8 },

    // Public hubs:
    { loc: `${BASE_URL}/portfolio`, changefreq: 'weekly', priority: 0.7 },
    { loc: `${BASE_URL}/uslugi`, changefreq: 'weekly', priority: 0.7 },
    { loc: `${BASE_URL}/oferta/kasyno/zasady`, lastmod: '2026-10-15', changefreq: 'monthly', priority: 0.6 },
    ...rules.map(rule => {
      const updatedAt = Date.parse(rule.updated_at || '');
      // Date of the substantive server-rendered content change, not the request date.
      const lastmod = new Date(Math.max(Date.parse('2026-10-15'), Number.isFinite(updatedAt) ? updatedAt : 0)).toISOString();
      return { loc: `${BASE_URL}${rule.path}`, lastmod, changefreq: 'monthly' as const, priority: 0.5 };
    }),
  ];

  return new Response(generateSitemapXml(urls), {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=0, must-revalidate',
    },
  });
  } catch {
    return new Response('Mapa witryny chwilowo niedostępna.', { status: 503, headers: { 'Retry-After': '300', 'Cache-Control': 'no-store' } });
  }
}
