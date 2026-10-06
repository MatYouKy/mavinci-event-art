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

  const urls: SitemapUrl[] = [
    { loc: `${BASE_URL}/`, changefreq: 'weekly', priority: 1.0 },

    { loc: `${BASE_URL}/o-nas`, changefreq: 'monthly', priority: 0.8 },
    { loc: `${BASE_URL}/zespol`, changefreq: 'monthly', priority: 0.8 },

    { loc: `${BASE_URL}/oferta`, changefreq: 'weekly', priority: 0.9 },
    { loc: `${BASE_URL}/oferta/konferencje`, changefreq: 'weekly', priority: 0.9 },

    { loc: `${BASE_URL}/oferta/kasyno`, changefreq: 'weekly', priority: 0.8 },
    { loc: `${BASE_URL}/oferta/kasyno/zasady/blackjack`, changefreq: 'yearly', priority: 0.5 },
    { loc: `${BASE_URL}/oferta/kasyno/zasady/ruletka`, changefreq: 'yearly', priority: 0.5 },
    { loc: `${BASE_URL}/oferta/kasyno/zasady/poker`, changefreq: 'yearly', priority: 0.5 },

    { loc: `${BASE_URL}/oferta/streaming`, changefreq: 'weekly', priority: 0.8 },
    { loc: `${BASE_URL}/oferta/integracje`, changefreq: 'weekly', priority: 0.8 },
    { loc: `${BASE_URL}/oferta/dj-eventowy`, changefreq: 'weekly', priority: 0.8 },
    { loc: `${BASE_URL}/oferta/technika-sceniczna`, changefreq: 'weekly', priority: 0.8 },
    { loc: `${BASE_URL}/oferta/quizy-teleturnieje`, changefreq: 'weekly', priority: 0.8 },
    { loc: `${BASE_URL}/oferta/wieczory-tematyczne`, changefreq: 'weekly', priority: 0.8 },
    { loc: `${BASE_URL}/oferta/symulatory-vr`, changefreq: 'weekly', priority: 0.8 },

    { loc: `${BASE_URL}/dla-agencji-i-hoteli`, changefreq: 'monthly', priority: 0.8 },

    // Public hubs:
    { loc: `${BASE_URL}/portfolio`, changefreq: 'weekly', priority: 0.7 },
    { loc: `${BASE_URL}/uslugi`, changefreq: 'weekly', priority: 0.7 },
  ];

  return new Response(generateSitemapXml(urls), {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=0, must-revalidate',
    },
  });
}