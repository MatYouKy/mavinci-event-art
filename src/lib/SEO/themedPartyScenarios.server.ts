import 'server-only';
import { cache } from 'react';
import { publicSupabase } from './publicData';
import { SITE } from './site';
import { THEMED_SCENARIOS, SCENARIO_SECTION, scenarioPath, readScenarioContent } from './themedPartyScenarios';

/** Only explicitly published CMS rows get pages, links and sitemap entries. */
export const getPublishedThemedPartyScenarios = cache(async () => {
  const { data, error } = await publicSupabase().from('site_images').select('*')
    .eq('section', SCENARIO_SECTION).eq('is_active', true).order('order_index');
  if (error) throw new Error('Nie udało się pobrać scenariuszy wieczorów tematycznych.');
  return THEMED_SCENARIOS.flatMap(definition => {
    const row = data?.find(item => item.name === definition.slug);
    if (!row) return [];
    return [{ ...definition, content: readScenarioContent(row.image_metadata?.content, definition.content),
      recordId: row.id, updatedAt: row.updated_at as string | null,
      image: row.desktop_url || '', mobileImage: row.mobile_url || '', alt: row.alt_text || definition.label,
      thumbnail: typeof row.image_metadata?.thumbnail === 'string' ? row.image_metadata.thumbnail : '',
      href: scenarioPath(definition.slug),
    }];
  });
});

export const getThemedPartyScenario = cache(async (slug: string) => {
  if (!THEMED_SCENARIOS.some(item => item.slug === slug)) return null;
  const published = await getPublishedThemedPartyScenarios();
  const scenario = published.find(item => item.slug === slug);
  if (!scenario) return null;
  const { data, error } = await publicSupabase().from('portfolio_projects')
    .select('id,slug,title,description,image,image_metadata,alt,location')
    .in('id', scenario.projectIds);
  if (error) throw new Error('Nie udało się pobrać realizacji tego motywu.');
  const projects = (data || []).filter(project => project.slug).sort((a, b) => scenario.projectIds.indexOf(a.id) - scenario.projectIds.indexOf(b.id)).map(project => ({
    ...project, href: `/portfolio/${encodeURIComponent(project.slug)}`,
  }));
  return { ...scenario, projects, pageSlug: scenario.href.slice(1), canonicalUrl: `${SITE.url}${scenario.href}`, related: published.filter(item => item.slug !== slug) };
});
export type ThemedPartyScenario = NonNullable<Awaited<ReturnType<typeof getThemedPartyScenario>>>;
