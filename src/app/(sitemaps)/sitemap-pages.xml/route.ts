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
  const nowIso = new Date().toISOString();

  const urls: SitemapUrl[] = [
    { loc: `${BASE_URL}/`, lastmod: nowIso, changefreq: 'weekly', priority: 1.0 },

    { loc: `${BASE_URL}/o-nas`, lastmod: nowIso, changefreq: 'monthly', priority: 0.8 },
    { loc: `${BASE_URL}/zespol`, lastmod: nowIso, changefreq: 'monthly', priority: 0.8 },

    { loc: `${BASE_URL}/oferta`, lastmod: nowIso, changefreq: 'weekly', priority: 0.9 },
    { loc: `${BASE_URL}/oferta/konferencje`, lastmod: nowIso, changefreq: 'weekly', priority: 0.9 },

    { loc: `${BASE_URL}/oferta/kasyno`, lastmod: nowIso, changefreq: 'weekly', priority: 0.8 },
    { loc: `${BASE_URL}/oferta/kasyno/zasady/blackjack`, lastmod: nowIso, changefreq: 'yearly', priority: 0.5 },
    { loc: `${BASE_URL}/oferta/kasyno/zasady/ruletka`, lastmod: nowIso, changefreq: 'yearly', priority: 0.5 },
    { loc: `${BASE_URL}/oferta/kasyno/zasady/poker`, lastmod: nowIso, changefreq: 'yearly', priority: 0.5 },

    { loc: `${BASE_URL}/oferta/streaming`, lastmod: nowIso, changefreq: 'weekly', priority: 0.8 },
    { loc: `${BASE_URL}/oferta/integracje`, lastmod: nowIso, changefreq: 'weekly', priority: 0.8 },
    { loc: `${BASE_URL}/oferta/dj-eventowy`, lastmod: nowIso, changefreq: 'weekly', priority: 0.8 },
    { loc: `${BASE_URL}/oferta/technika-sceniczna`, lastmod: nowIso, changefreq: 'weekly', priority: 0.8 },
    { loc: `${BASE_URL}/oferta/quizy-teleturnieje`, lastmod: nowIso, changefreq: 'weekly', priority: 0.8 },
    { loc: `${BASE_URL}/oferta/wieczory-tematyczne`, lastmod: nowIso, changefreq: 'weekly', priority: 0.8 },
    { loc: `${BASE_URL}/oferta/symulatory-vr`, lastmod: nowIso, changefreq: 'weekly', priority: 0.8 },

    // opcjonalnie huby:
    { loc: `${BASE_URL}/portfolio`, lastmod: nowIso, changefreq: 'weekly', priority: 0.7 },
    { loc: `${BASE_URL}/uslugi`, lastmod: nowIso, changefreq: 'weekly', priority: 0.7 },
  ];

  return new Response(generateSitemapXml(urls), {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=0, must-revalidate',
    },
  });
}