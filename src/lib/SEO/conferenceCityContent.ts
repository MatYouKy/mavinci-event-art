export type ConferenceCityContent = {
  version: 1;
  heading: string;
  intro: string;
  planning: string;
  checks: string[];
  venue: { name: string; fact: string; url: string };
  researchedAt: string;
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
export function isConferenceSourceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** Optional CMS content: an incomplete entry must not break a public city page. */
export function readConferenceCityContent(schema: unknown): ConferenceCityContent | null {
  if (!record(schema) || !record(schema.conferenceContent)) return null;
  const value = schema.conferenceContent;
  const venue = value.venue;
  if (value.version !== 1 || !text(value.heading) || !text(value.intro) ||
      !text(value.planning) || !Array.isArray(value.checks) || !value.checks.length ||
      !value.checks.every(text) || !record(venue) || !text(venue.name) ||
      !text(venue.fact) || !text(venue.url) || !isConferenceSourceUrl(venue.url)) return null;
  return {
    version: 1, heading: value.heading, intro: value.intro, planning: value.planning,
    checks: value.checks, venue: { name: venue.name, fact: venue.fact, url: venue.url },
    researchedAt: typeof value.researchedAt === 'string' ? value.researchedAt : '',
  };
}

export function readConferenceCityFaqs(schema: unknown): { question: string; answer: string }[] {
  if (!record(schema) || !Array.isArray(schema.faq)) return [];
  return schema.faq.flatMap((item: unknown) => record(item) && text(item.question) && text(item.answer)
    ? [{ question: item.question, answer: item.answer }] : []);
}
