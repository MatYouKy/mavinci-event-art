import 'server-only';
import { cache } from 'react';
import { publicSupabase } from './publicData';
import { SITE } from './site';
import { agencyCities, agencyOverview, resolveAgencyContent } from './eventAgencyContent';

/** City publishing requires both an active place and a dedicated editorial brief. */
export const getPublishedAgencyCities = cache(async () => {
  const { data, error } = await publicSupabase().from('schema_org_places').select('locality')
    .eq('is_global', true).eq('is_active', true).in('locality', agencyCities.map(city => city.slug));
  if (error) throw new Error('Nie udało się pobrać lokalizacji agencji eventowej.');
  const published = new Set((data || []).map(city => city.locality));
  return agencyCities.filter(city => published.has(city.slug));
});

const getAgencyProjects = cache(async () => {
  const { data, error } = await publicSupabase().from('portfolio_projects')
    .select('id,slug,title,description,image,image_metadata,alt,location,event_city_slug,reference_city_slugs,tags,order_index').order('order_index');
  if (error) throw new Error('Nie udało się pobrać portfolio agencji.');
  // Corporate references before private celebrations; source descriptions keep the actual scope.
  const preferred = ['latino-night-castorama', 'gala-oskary-sprzedazy-2023', 'jubileusz-30-lat-tymbark', 'summit-rarity-2024', 'konferencja-psrwn', 'miejska-by-night'];
  return (data || []).filter(project => project.slug && (preferred.includes(project.slug) || project.tags?.includes('konferencje')))
    .map(project => ({ ...project, preference: preferred.includes(project.slug) ? preferred.indexOf(project.slug) : 100,
      href: `/portfolio/${encodeURIComponent(project.slug)}` }));
});

export const getAgencyData = cache(async (slug?: string) => {
  const cities = await getPublishedAgencyCities();
  const city = slug ? cities.find(item => item.slug === slug) : null;
  if (slug && !city) return null;
  const pageSlug = city ? `agencja-eventowa/${city.slug}` : 'agencja-eventowa';
  const db = publicSupabase();
  const [metadata, projects] = await Promise.all([
    db.from('schema_org_page_metadata').select('id,title,description,og_image,custom_schema').eq('page_slug', pageSlug).eq('is_active', true).maybeSingle(),
    getAgencyProjects(),
  ]);
  if (metadata.error) throw new Error('Nie udało się pobrać strony agencji eventowej.');
  const content = resolveAgencyContent(city?.content || agencyOverview, metadata.data?.custom_schema?.agencyContent);
  const score = (project: (typeof projects)[number]) => !city ? 0 : project.event_city_slug === city.slug ? 2 : project.reference_city_slugs?.includes(city.slug) ? 1 : 0;
  const portfolio = [...projects].sort((a, b) => score(b) - score(a) || a.preference - b.preference || (a.order_index ?? 0) - (b.order_index ?? 0)).slice(0, 6).map(project => ({
    ...project,
    location: project.event_city_slug ? agencyCities.find(item => item.slug === project.event_city_slug)?.name || project.location : project.location,
  }));
  const storedHero = metadata.data?.custom_schema?.agencyHero;
  const hero = storedHero && typeof storedHero === 'object' && typeof storedHero.desktop === 'string' && storedHero.desktop.startsWith('https://') ? storedHero : null;
  const image = hero?.desktop || '/images/expertise/eventy-1280.webp';
  const mobileImage = hero ? hero.mobile : '/images/expertise/eventy-768.webp';
  return { pageSlug, canonicalUrl: `${SITE.url}/${pageSlug}`, city: city || null, cities, content, portfolio,
    metaTitle: metadata.data?.title || content.title, description: metadata.data?.description || content.description,
    image, mobileImage, imageAlt: hero?.alt || 'Uczestnicy wydarzenia Latino Night Castorama w oprawie MAVINCI',
    ogImage: metadata.data?.og_image || (image.startsWith('/') ? `${SITE.url}${image}` : image),
    localHero: hero,
  };
});
export type AgencyData = NonNullable<Awaited<ReturnType<typeof getAgencyData>>>;
