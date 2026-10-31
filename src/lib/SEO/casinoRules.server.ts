import 'server-only';
import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { publicSupabase } from './publicData';
import { SITE } from './site';

export const CASINO_RULE_ROUTES = {
  poker: 'poker-texas-holdem',
  blackjack: 'blackjack',
  ruletka: 'ruletka',
} as const;
export type CasinoRuleRoute = keyof typeof CASINO_RULE_ROUTES;
type RuleRow = {
  slug: string; game_name: string; short_description: string | null;
  rules_content: string; updated_at: string | null;
};

/** Pages and sitemap use the same published records; a failed read is never an empty 200 page. */
export const getPublishedCasinoRules = cache(async () => {
  const { data, error } = await publicSupabase().from('casino_game_rules')
    .select('slug,game_name,short_description,rules_content,updated_at')
    .eq('is_visible', true).in('slug', Object.values(CASINO_RULE_ROUTES)).order('order_index');
  if (error) throw new Error('Nie udało się pobrać zasad kasyna eventowego.');
  return ((data || []) as RuleRow[]).flatMap(row => {
    const route = (Object.keys(CASINO_RULE_ROUTES) as CasinoRuleRoute[])
      .find(key => CASINO_RULE_ROUTES[key] === row.slug);
    if (!route || !row.game_name?.trim() || !row.rules_content?.trim()) return [];
    return [{ ...row, route, path: `/oferta/kasyno/zasady/${route}` }];
  });
});

export type PublishedCasinoRule = Awaited<ReturnType<typeof getPublishedCasinoRules>>[number];

export const getCasinoRule = cache(async (route: CasinoRuleRoute) => {
  const rule = (await getPublishedCasinoRules()).find(item => item.route === route);
  if (!rule) notFound();
  return rule;
});

export async function casinoRuleMetadata(route: CasinoRuleRoute): Promise<Metadata> {
  const rule = await getCasinoRule(route);
  const title = `${rule.game_name} — zasady kasyna eventowego | MAVINCI`;
  const description = `${rule.short_description?.trim() || `Poznaj zasady gry: ${rule.game_name}.`} Kasyno eventowe MAVINCI to zabawa integracyjna bez zakładów pieniężnych.`;
  const url = `${SITE.url}${rule.path}`;
  return { title: { absolute: title }, description, alternates: { canonical: url },
    robots: { index: true, follow: true },
    openGraph: { type: 'website', title, description, url, locale: 'pl_PL', siteName: SITE.name } };
}
