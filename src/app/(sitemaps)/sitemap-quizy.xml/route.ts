import { getPublishedQuizCities, QUIZ_PATH } from '@/lib/quiz-shows/content';
import { getQuizData } from '@/lib/quiz-shows/server';
import { SITE } from '@/lib/SEO/site';

export const dynamic = 'force-dynamic';
export async function GET() {
  const { formats, gallery } = await getQuizData();
  const sharedDates = [...formats, ...gallery].map(row => Date.parse(row.updated_at || '')).filter(Number.isFinite);
  const body = getPublishedQuizCities().map(city => {
    const lastmod = new Date(Math.max(Date.parse(city.updatedAt), ...sharedDates)).toISOString();
    return `  <url><loc>${SITE.url}${QUIZ_PATH}/${city.slug}</loc><lastmod>${lastmod}</lastmod></url>`;
  }).join('\n');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>`, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=0, must-revalidate' },
  });
}
