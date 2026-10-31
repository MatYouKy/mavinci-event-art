import 'server-only';
import { cache } from 'react';
import { publicSupabase } from './publicData';
import { SITE } from './site';
import { getPublishedThemedPartyScenarios } from './themedPartyScenarios.server';
import { scenarioForTheme } from './themedPartyScenarios';
import { loadCityCasesFromDb } from '@/lib/Pages/polishCityCases.server';
import { getPolishCityCasesSmart } from '@/lib/polishCityCases';
import { getThemedPartyDefaults, getThemedPartyLocalProfile, isThemedPartyReference, readThemedFaq, themedText, type ThemedPartyEditorial, type ThemedPartyHeroSettings } from './themedPartyContent';

/** Pages, the directory and the sitemap all use the same publication rules. */
export const getPublishedThemedPartyCities = cache(async () => {
  const { data, error } = await publicSupabase().from('schema_org_places')
    .select('id,locality,name,region,created_at').eq('is_global', true).eq('is_active', true).order('name');
  if (error) throw new Error('Nie udało się pobrać lokalizacji wieczorów tematycznych.');
  return (data || []).filter(city => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(city.locality || '') && !['lokalizacje', 'motywy'].includes(city.locality));
});
const getSharedData = cache(async () => {
  const db = publicSupabase();
  const [hero, sections, projects, scenarios] = await Promise.all([
    db.from('wieczory-tematyczne_page_images').select('*').eq('section', 'hero').eq('is_active', true).order('order_index').limit(1).maybeSingle(),
    db.from('site_images').select('*').eq('section', 'themed-party').eq('is_active', true).order('order_index'),
    db.from('portfolio_projects').select('id,slug,title,description,location,tags,event_city_slug,reference_city_slugs,image,image_metadata,alt,order_index').order('order_index'),
    getPublishedThemedPartyScenarios(),
  ]);
  if ([hero, sections, projects].some(result => result.error)) throw new Error('Nie udało się pobrać oferty wieczorów tematycznych.');
  const rows = sections.data || [];
  const items = rows.find(row => row.name === 'themes')?.image_metadata?.items;
  const storageOrigin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin;
  return {
    hero: hero.data,
    themes: (Array.isArray(items) ? items : []).filter(item => themedText(item?.title) && themedText(item?.description)).map(item => ({
      ...item, scenarioHref: scenarios.find(scenario => scenario.slug === scenarioForTheme(item)?.slug)?.href,
    })) as { title: string; description: string; image?: string; keywords?: string; scenarioHref?: string }[],
    // Stock examples must not be presented as photographs of MAVINCI work.
    gallery: rows.filter(row => row.name?.startsWith('gallery-') && row.desktop_url?.startsWith(`${storageOrigin}/storage/v1/object/public/`)).map(row => ({
      id: row.id, image_url: row.desktop_url, alt_text: row.alt_text || 'Oprawa wieczoru tematycznego MAVINCI', caption: row.image_metadata?.caption || '',
    })),
    projects: (projects.data || []).filter(project => project.slug && isThemedPartyReference(project)),
  };
});

/** Metadata, visible content and JSON-LD share one request-scoped snapshot. */
export const getThemedPartyCityData = cache(async (slug: string) => {
  const cities = await getPublishedThemedPartyCities();
  const city = cities.find(item => item.locality === slug);
  if (!city) return null;
  const db = publicSupabase();
  const pageSlug = `oferta/wieczory-tematyczne/${slug}`;
  const [shared, cases, metadata, seo, localHero, editorial] = await Promise.all([
    getSharedData(), loadCityCasesFromDb(),
    db.from('schema_org_page_metadata').select('*').eq('page_slug', pageSlug).eq('is_active', true).maybeSingle(),
    db.from('city_pages_seo').select('*').eq('page_type', 'wieczory-tematyczne').eq('city_slug', slug).eq('is_active', true).maybeSingle(),
    db.from('service_hero_images').select('*').eq('page_slug', pageSlug).eq('is_active', true).maybeSingle(),
    db.from('seo_city_content').select('id,local_features,custom_title,custom_description,custom_h1').eq('page_slug', 'wieczory-tematyczne').eq('city', slug).eq('is_active', true).maybeSingle(),
  ]);
  if ([metadata, seo, localHero, editorial].some(result => result.error)) throw new Error('Nie udało się pobrać treści tej lokalizacji.');
  const cityCases = cases[slug] || getPolishCityCasesSmart(city.name, cases);
  const location = `${cityCases.locative_preposition || 'w'} ${cityCases.locative}`;
  const defaults = getThemedPartyDefaults(slug, city.name, location);
  const fields = editorial.data?.local_features && typeof editorial.data.local_features === 'object' && !Array.isArray(editorial.data.local_features) ? editorial.data.local_features : {};
  const faq = Array.isArray(fields.faq) ? readThemedFaq(fields.faq) : [...readThemedFaq(metadata.data?.custom_schema?.faq), ...defaults.content.faq]
    .filter((row, index, all) => all.findIndex(item => item.question.toLocaleLowerCase('pl-PL') === row.question.toLocaleLowerCase('pl-PL')) === index);
  const content: ThemedPartyEditorial = {
    intro_heading: themedText(fields.intro_heading, defaults.content.intro_heading),
    intro_text: themedText(fields.intro_text, defaults.content.intro_text),
    planning_heading: themedText(fields.planning_heading, defaults.content.planning_heading),
    planning_text: themedText(fields.planning_text, defaults.content.planning_text),
    planning_checks: Array.isArray(fields.planning_checks) ? fields.planning_checks.filter((line: unknown) => themedText(line)) : defaults.content.planning_checks,
    faq,
  };
  const imageOwner = localHero.data?.image_url ? localHero.data : shared.hero;
  const image = imageOwner?.image_metadata?.desktop?.src || imageOwner?.image_url || metadata.data?.og_image || `${SITE.url}/logo-mavinci-crm.png`;
  const heroSettings: ThemedPartyHeroSettings = {
    image_url: image,
    image_metadata: { ...imageOwner?.image_metadata, object_position: localHero.data?.image_metadata?.object_position || imageOwner?.image_metadata?.object_position || 'center' },
    alt_text: localHero.data?.alt_text || imageOwner?.alt_text || 'Oprawa wieczoru tematycznego MAVINCI',
    opacity: Math.min(0.65, Math.max(0, localHero.data?.opacity ?? 0.25)),
  };
  const priority = (project: (typeof shared.projects)[number]) => project.event_city_slug === slug ? 2 : project.reference_city_slugs?.includes(slug) ? 1 : 0;
  const relatedSlugs = getThemedPartyLocalProfile(slug)?.nearbyCitySlugs || [];
  const relatedPriority = (locality: string) => {
    const index = relatedSlugs.indexOf(locality);
    return index < 0 ? relatedSlugs.length : index;
  };
  const portfolio = [...shared.projects].sort((a, b) => priority(b) - priority(a) || (a.order_index ?? 0) - (b.order_index ?? 0) || a.id.localeCompare(b.id)).slice(0, 4).map(project => ({
    ...project, href: `/portfolio/${encodeURIComponent(project.slug)}`,
    // Reference-city tags express relevance, never the actual event location.
    location: project.event_city_slug ? cities.find(place => place.locality === project.event_city_slug)?.name || project.location : project.location,
  }));
  return {
    city, cityCases, location, pageSlug, canonicalUrl: `${SITE.url}/${pageSlug}`,
    title: themedText(localHero.data?.title, themedText(editorial.data?.custom_h1, defaults.title)),
    lead: themedText(localHero.data?.description, themedText(fields.lead, defaults.lead)),
    metaTitle: themedText(seo.data?.seo_title, themedText(metadata.data?.title, themedText(editorial.data?.custom_title, defaults.metaTitle))),
    description: themedText(seo.data?.seo_description, themedText(metadata.data?.description, themedText(editorial.data?.custom_description, defaults.description))),
    keywords: seo.data?.seo_keywords || metadata.data?.keywords,
    image, ogImage: metadata.data?.og_image || image, heroSettings, localHero: localHero.data || {},
    content, faq, recordId: editorial.data?.id || null, themes: shared.themes, gallery: shared.gallery, portfolio,
    nearbyCities: cities.filter(item => item.locality !== slug && city.region && item.region === city.region)
      .sort((a, b) => relatedPriority(a.locality) - relatedPriority(b.locality) || a.name.localeCompare(b.name, 'pl')).slice(0, 6),
  };
});
export type ThemedPartyCityData = NonNullable<Awaited<ReturnType<typeof getThemedPartyCityData>>>;
