import 'server-only';
import { cache } from 'react';
import type { Metadata } from 'next';
import { getPublicPageMetadata, publicSupabase } from '@/lib/SEO/publicData';
import { ORGANIZATION_ID, SITE, WEBSITE_ID } from '@/lib/SEO/site';
import { QUIZ_DESCRIPTION, QUIZ_INTRO, QUIZ_PATH, QUIZ_TITLE, type QuizCity } from './content';
import type { QuizGalleryImage, QuizShowFormat } from './types';

export const getQuizData = cache(async () => {
  const db = publicSupabase();
  const [formats, gallery] = await Promise.all([
    db.from('quiz_show_formats').select('*').eq('is_visible', true).order('order_index'),
    db.from('quiz_show_gallery').select('*').eq('is_visible', true).order('is_primary', { ascending: false }).order('order_index'),
  ]);
  // Do not turn a transient backend failure into an indexable, empty offer.
  if (formats.error) throw new Error('Nie udało się wczytać formatów teleturniejów.');
  if (gallery.error) throw new Error('Nie udało się wczytać galerii teleturniejów.');
  return { formats: (formats.data || []) as QuizShowFormat[], gallery: (gallery.data || []) as QuizGalleryImage[] };
});

export const getQuizHero = cache(async (city?: QuizCity) => {
  const db = publicSupabase();
  const { data: base } = await db.from('quizy-teleturnieje_page_images').select('title, description, image_url').eq('is_active', true).eq('section', 'hero').maybeSingle();
  const local = city ? (await db.from('service_hero_images').select('title, description, image_url').eq('page_slug', `${QUIZ_PATH.slice(1)}/${city.slug}`).eq('is_active', true).maybeSingle()).data : base;
  return {
    title: local?.title?.trim() || (city ? `${QUIZ_TITLE} ${city.location}` : QUIZ_TITLE),
    description: local?.description?.trim() || city?.intro || QUIZ_INTRO,
    image: local?.image_url || base?.image_url || '',
  };
});

export async function quizMetadata(city?: QuizCity): Promise<Metadata> {
  const stored = await getPublicPageMetadata(`${QUIZ_PATH.slice(1)}${city ? `/${city.slug}` : ''}`);
  const hero = await getQuizHero(city);
  const fallbackTitle = city ? `Quizy i teleturnieje firmowe ${city.name} | MAVINCI` : `${QUIZ_TITLE} | MAVINCI`;
  const title = stored?.title?.trim() && !/obsługa konferencji/i.test(stored.title) ? stored.title.trim() : fallbackTitle;
  const fallbackDescription = city ? `Quizy i teleturnieje na integracje i wieczory firmowe ${city.location}. Prowadzący, pytania o firmę, buzzery i multimedia. Ustal format z MAVINCI.` : QUIZ_DESCRIPTION;
  const description = stored?.description?.trim() && !stored.description.startsWith('Kompleksowa obsługa techniczna konferencji:') ? stored.description.trim() : fallbackDescription;
  const url = `${SITE.url}${QUIZ_PATH}${city ? `/${city.slug}` : ''}`;
  const rawImage = stored?.og_image || hero.image || '/logo-mavinci-crm.png';
  const image = rawImage.startsWith('https://') ? rawImage : `${SITE.url}${rawImage.startsWith('/') ? '' : '/'}${rawImage}`;
  return { title: { absolute: title }, description, alternates: { canonical: url },
    openGraph: { type: 'website', title, description, url, siteName: SITE.name, locale: 'pl_PL', images: [{ url: image, alt: SITE.name }] },
    twitter: { card: 'summary_large_image', title, description, images: [image] } };
}

export function quizSchema(city?: QuizCity) {
  const url = `${SITE.url}${QUIZ_PATH}${city ? `/${city.slug}` : ''}`;
  const name = city ? `${QUIZ_TITLE} ${city.location}` : QUIZ_TITLE;
  return { '@context': 'https://schema.org', '@graph': [
    { '@type': 'WebPage', '@id': `${url}#webpage`, url, name, inLanguage: 'pl-PL',
      isPartOf: { '@id': WEBSITE_ID }, about: { '@id': `${url}#service` } },
    { '@type': 'Service', '@id': `${url}#service`, url, name,
      description: city?.intro || QUIZ_DESCRIPTION, serviceType: 'Quizy i teleturnieje na wydarzenia firmowe',
      provider: { '@id': ORGANIZATION_ID },
      areaServed: city ? { '@type': 'City', name: city.name } : [
        { '@type': 'City', name: 'Olsztyn' }, { '@type': 'AdministrativeArea', name: 'województwo warmińsko-mazurskie' },
        { '@type': 'Country', name: 'Polska' },
      ] },
  ] };
}
