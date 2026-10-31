import definitions from './themedPartyScenarios.json';

export const SCENARIO_SECTION = 'themed-party-scenarios';
export const SCENARIO_PATH = '/oferta/wieczory-tematyczne/motywy';
export type ScenarioBlock = { heading: string; text: string };
export type ScenarioFAQ = { question: string; answer: string };
export type ScenarioContent = {
  title: string; metaTitle: string; description: string; lead: string; summary: string; occasion: string;
  program: ScenarioBlock[]; scope: ScenarioBlock[]; planning: string[]; evidenceIntro: string; faq: ScenarioFAQ[];
};
export type ScenarioDefinition = { slug: string; label: string; themeTitles: string[]; projectIds: string[]; content: ScenarioContent };
export const THEMED_SCENARIOS: ScenarioDefinition[] = definitions;
export function scenarioPath(slug: string) { return `${SCENARIO_PATH}/${slug}`; }
export function scenarioForTheme(theme: { title: string; scenario_slug?: string }) {
  return THEMED_SCENARIOS.find(item => item.slug === theme.scenario_slug || item.themeTitles.includes(theme.title));
}

/** A partial CMS record must not erase required visible content or produce invalid JSON-LD. */
export function readScenarioContent(value: unknown, fallback: ScenarioContent): ScenarioContent {
  const row = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const text = (key: keyof ScenarioContent) => typeof row[key] === 'string' && (row[key] as string).trim() ? (row[key] as string).trim() : fallback[key] as string;
  const blocks = (key: 'program' | 'scope') => Array.isArray(row[key]) && (row[key] as unknown[]).length > 0 && (row[key] as ScenarioBlock[]).every(item => typeof item?.heading === 'string' && item.heading.trim() && typeof item?.text === 'string' && item.text.trim()) ? row[key] as ScenarioBlock[] : fallback[key];
  const planning = Array.isArray(row.planning) && row.planning.length > 0 && row.planning.every(item => typeof item === 'string' && item.trim()) ? row.planning as string[] : fallback.planning;
  const faq = Array.isArray(row.faq) && row.faq.every(item => typeof item?.question === 'string' && item.question.trim() && typeof item?.answer === 'string' && item.answer.trim()) ? row.faq as ScenarioFAQ[] : fallback.faq;
  return { title: text('title'), metaTitle: text('metaTitle'), description: text('description'), lead: text('lead'), summary: text('summary'), occasion: text('occasion'), evidenceIntro: text('evidenceIntro'), program: blocks('program'), scope: blocks('scope'), planning, faq };
}
