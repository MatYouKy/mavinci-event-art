import 'server-only';
import { cache } from 'react';
import { publicSupabase } from './publicData';
import { SITE } from './site';
import { canonicalServiceSlug, servicePath } from './serviceUrls';
import { loadCityCasesFromDb } from '@/lib/Pages/polishCityCases.server';
import { getPolishCityCasesSmart } from '@/lib/polishCityCases';
import { getStagePlanning, getStageFaq, readStageFaq, stageIntroHeading, stageIntroText, stageTemplate, stageText, type StageEditorial } from './technicalStageContent';

export const getPublishedTechnicalStageCities = cache(async () => {
  const { data, error } = await publicSupabase().from('schema_org_places')
    .select('id,locality,name,region').eq('is_global', true).eq('is_active', true).order('name');
  if (error) throw new Error('Nie udało się pobrać lokalizacji techniki scenicznej.');
  return (data || []).filter(city => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(city.locality || '') && city.locality !== 'lokalizacje');
});

function broadenTitle(title: string): string {
  return title.replace(/technika sceniczna(?! i eventowa)/gi, 'Technika sceniczna i eventowa');
}

// These public catalogue entries also back /uslugi/[slug]. Always use their canonical URL.
const featureServices: Record<string, string> = {
  '2abe58fe-8982-4258-a25e-aba0bcd193c4': 'systemy-line-array-meyer-sound-lina',
  '5a882f67-1a27-48ed-9efd-1d3533de85a2': 'monitory-sceniczne',
  '62098c34-f464-4c8c-b64d-97d74baf7e8f': 'oswietlenie-teatralne-i-sceniczne',
  'cb83aba4-f327-42ce-8d10-edebe924d79b': 'podesty-sceniczne-i-sceny-modulowe',
  '474d127f-87e9-4e84-9931-b7fe8868e8e2': 'miksery-audio-yamaha-i-allenheath',
  'af91af0e-31ec-4609-8e29-a4f1814c7987': 'efekty-specjalne-dym-haze-sparkular',
  'edaa8fff-93f3-4a3f-b0bd-94486ca400c0': 'konferansjerzy-i-prowadzacy',
  'eb9feea3-80b5-4daa-8c73-6b383f72d703': 'ekrany-led-do-konferencji-i-gal',
  'cb9d648b-d843-4fc2-9f2b-6e7671448776': 'realizacja-wielokamerowa',
  '9fe1da48-9699-4823-bd34-1982d73e0ba2': 'oprawa-muzyczna-eventow',
};
const getSharedData = cache(async () => {
  const db = publicSupabase();
  const [hero, features, gallery, projects, services] = await Promise.all([
    db.from('technika-sceniczna_page_images').select('*').eq('section', 'hero').eq('is_active', true).order('order_index').limit(1).maybeSingle(),
    db.from('technical_stage_features').select('id,title,description,image_url,order_index').eq('is_visible', true).order('order_index'),
    db.from('technical_stage_gallery').select('id,image_url,title,description,order_index').eq('is_visible', true).order('order_index'),
    db.from('portfolio_projects').select('id,slug,title,description,location,tags,event_city_slug,reference_city_slugs,image,image_metadata,alt,order_index').order('order_index'),
    db.from('conferences_service_items').select('id,slug,name').eq('is_active', true),
  ]);
  if ([hero, features, gallery, projects, services].some(result => result.error)) throw new Error('Nie udało się pobrać opublikowanej oferty techniki scenicznej.');
  const serviceList = services.data || [];
  const storageOrigin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin;
  return {
    hero: hero.data,
    features: (features.data || []).map(feature => {
      const service = serviceList.find(item => canonicalServiceSlug(item) === featureServices[feature.id]);
      return { ...feature, href: service ? servicePath(service) : null };
    }),
    // Seeded stock photographs are not evidence of MAVINCI projects.
    gallery: (gallery.data || []).filter(item => item.image_url?.startsWith(`${storageOrigin}/storage/v1/object/public/site-images/`)).slice(0, 6),
    projects: (projects.data || []).filter(project => project.slug &&
      (Array.isArray(project.tags) && project.tags.includes('audio-video') || /nagłośnieni|oświetleni|realizację techniczną|realizację wizji|obsług[aę] techniczn/i.test(project.description || ''))),
  };
});

/** Metadata and HTML share one request-scoped snapshot of public data. */
export const getTechnicalStageCityData = cache(async (slug: string) => {
  const cities = await getPublishedTechnicalStageCities();
  const city = cities.find(item => item.locality === slug);
  if (!city) return null;
  const db = publicSupabase();
  const pageSlug = `oferta/technika-sceniczna/${slug}`;
  const [shared, cases, metadata, seo, hero, intro] = await Promise.all([
    getSharedData(), loadCityCasesFromDb(),
    db.from('schema_org_page_metadata').select('*').eq('page_slug', pageSlug).eq('is_active', true).maybeSingle(),
    db.from('city_pages_seo').select('*').eq('page_type', 'technika-sceniczna').eq('city_slug', slug).eq('is_active', true).maybeSingle(),
    db.from('service_hero_images').select('*').eq('page_slug', pageSlug).eq('is_active', true).maybeSingle(),
    db.from('seo_city_content').select('id,local_features,custom_title,custom_description,custom_h1').eq('page_slug', 'technika-sceniczna').eq('city', slug).eq('is_active', true).maybeSingle(),
  ]);
  if ([metadata, seo, hero, intro].some(result => result.error)) throw new Error('Nie udało się pobrać danych strony techniki scenicznej.');
  const cityCases = cases[slug] || getPolishCityCasesSmart(city.name, cases);
  const location = `${cityCases.locative_preposition || 'w'} ${cityCases.locative}`;
  const fields = intro.data?.local_features && typeof intro.data.local_features === 'object' && !Array.isArray(intro.data.local_features) ? intro.data.local_features : {};
  const planning = getStagePlanning(slug, city.name, city.region || '');
  const customFaq = readStageFaq(fields.faq);
  const schemaFaq = readStageFaq(metadata.data?.custom_schema?.faq);
  const defaults = getStageFaq(location);
  // A local FAQ is a full editorial override. Existing schema FAQ becomes visible as well.
  const faq = (Array.isArray(fields.faq) ? customFaq : [...schemaFaq, ...defaults]).filter((item, i, all) => all.findIndex(other => other.question.toLocaleLowerCase('pl-PL') === item.question.toLocaleLowerCase('pl-PL')) === i);
  const content: StageEditorial = {
    intro_heading: stageText(fields.intro_heading, stageIntroHeading),
    intro_text: stageText(fields.intro_text, stageIntroText),
    planning_heading: stageText(fields.planning_heading, planning.heading),
    planning_text: stageText(fields.planning_text, planning.text),
    planning_checks: Array.isArray(fields.planning_checks) && fields.planning_checks.some((item: unknown) => stageText(item)) ? fields.planning_checks.filter((item: unknown) => stageText(item)) : planning.checks,
    faq,
  };
  const title = broadenTitle(stageText(hero.data?.title, stageText(intro.data?.custom_h1, `Technika sceniczna i eventowa ${location}`)));
  const lead = stageText(hero.data?.description, `Nagłośnienie Meyer Sound LINA, oświetlenie, ekrany LED wewnętrzne i zewnętrzne, totemy, telewizory i realizatorzy na Twoje wydarzenie ${location}. Przygotowujemy technikę na imprezy firmowe, gale, koncerty i wydarzenia plenerowe — od ustalenia zakresu po montaż, próby i obsługę programu.`);
  const metaTitle = broadenTitle(stageText(seo.data?.seo_title, stageText(metadata.data?.title === 'Technika Sceniczna Olsztyn | Nagłośnienie, Oświetlenie, Sceny | Mavinci' ? '' : metadata.data?.title, stageText(intro.data?.custom_title, `Technika sceniczna i eventowa ${city.name} | MAVINCI`))));
  const description = stageText(seo.data?.seo_description, stageText(metadata.data?.description, stageText(intro.data?.custom_description, `Technika eventowa ${location}: Meyer Sound, oświetlenie, LED wewnętrzny i zewnętrzny, totemy, telewizory, scena i realizatorzy. Poznaj ofertę MAVINCI.`)));
  const imageOwner = hero.data?.image_url ? hero.data : shared.hero;
  const image = imageOwner?.image_url || `${SITE.url}/logo-mavinci-crm.png`;
  const heroSettings = {
    image_url: image,
    image_metadata: { ...imageOwner?.image_metadata, object_position: hero.data?.image_metadata?.object_position || imageOwner?.image_metadata?.object_position || 'center' },
    alt_text: hero.data?.alt_text || imageOwner?.alt_text || 'Technika sceniczna MAVINCI — nagłośnienie, światło i multimedia',
    opacity: Math.min(0.65, Math.max(0, hero.data?.opacity ?? 0.22)),
  };
  const priority = (project: (typeof shared.projects)[number]) => project.event_city_slug === slug ? 2 : project.reference_city_slugs?.includes(slug) ? 1 : 0;
  const portfolio = [...shared.projects].sort((a, b) => priority(b) - priority(a) || (a.order_index ?? 0) - (b.order_index ?? 0) || a.id.localeCompare(b.id)).slice(0, 6).map(project => ({
    ...project, href: `/portfolio/${encodeURIComponent(project.slug)}`,
    // A reference-city tag never changes the actual event location.
    location: project.event_city_slug ? cities.find(place => place.locality === project.event_city_slug)?.name || project.location : project.location,
  }));
  return { city, cityCases, location, pageSlug, canonicalUrl: `${SITE.url}/${pageSlug}`, title, lead, metaTitle, description,
    keywords: seo.data?.seo_keywords || metadata.data?.keywords,
    image, ogImage: metadata.data?.og_image || image, heroSettings, localHero: hero.data || {},
    content, introRecord: { id: intro.data?.id || null, localFeatures: fields }, faq,
    displayIntro: { heading: stageTemplate(content.intro_heading, cityCases), text: stageTemplate(content.intro_text, cityCases) },
    features: shared.features, gallery: shared.gallery, portfolio,
    nearbyCities: cities.filter(item => item.locality !== slug && city.region && item.region?.toLocaleLowerCase('pl-PL') === city.region.toLocaleLowerCase('pl-PL')).slice(0, 6),
  };
});
export type TechnicalStageCityData = NonNullable<Awaited<ReturnType<typeof getTechnicalStageCityData>>>;
