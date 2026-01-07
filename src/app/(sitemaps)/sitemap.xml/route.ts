const BASE_URL = 'https://mavinci.pl';

function escapeXml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function GET() {
  // Możesz dać stały lastmod albo build-time/now.
  // Dla indexu spokojnie może być "now" — i tak sitemap-y niżej mają własne lastmod.
  const lastmod = new Date().toISOString();

  const sitemaps = [
    `${BASE_URL}/sitemap-pages.xml`,
    `${BASE_URL}/sitemap-portfolio.xml`,
    `${BASE_URL}/sitemap-uslugi.xml`,
    `${BASE_URL}/sitemap-konferencje.xml`,
    `${BASE_URL}/image-sitemap.xml`,
  ];

  const body = sitemaps
    .map(
      (loc) => `  <sitemap>
    <loc>${escapeXml(loc)}</loc>
    <lastmod>${escapeXml(lastmod)}</lastmod>
  </sitemap>`
    )
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</sitemapindex>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=0, must-revalidate',
    },
  });
}