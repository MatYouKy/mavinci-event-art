/** A target city is a presentation preference, never evidence of an event location. */
export type ConferenceReference = {
  id?: string;
  slug?: string;
  tags?: unknown;
  order_index?: number | null;
  event_city_slug?: string | null;
  reference_city_slugs?: string[] | null;
  conference_reference_enabled?: boolean | null;
  updated_at?: string | null;
};

export function isConferenceReference(project: ConferenceReference): boolean {
  if (typeof project.conference_reference_enabled === 'boolean') return project.conference_reference_enabled;
  // Existing New Year's Eve entry is not a conference reference. Editors may opt it in explicitly.
  if (project.id === 'dafd2556-a094-4eff-a934-37cfa51272e9') return false;
  return Array.isArray(project.tags) && project.tags.includes('konferencje');
}

export function selectConferenceReferences<T extends ConferenceReference>(projects: T[], citySlug?: string, limit = 6): T[] {
  const priority = (project: T) => !citySlug ? 0
    : project.reference_city_slugs?.includes(citySlug) ? 2
    : project.event_city_slug === citySlug ? 1 : 0;
  return projects.filter(isConferenceReference).sort((a, b) =>
    priority(b) - priority(a) || (a.order_index ?? 0) - (b.order_index ?? 0) ||
    (a.slug || a.id || '').localeCompare(b.slug || b.id || '')
  ).slice(0, limit);
}

export type PortfolioCitySettings = {
  event_city_slug: string | null;
  reference_city_slugs: string[];
  conference_reference_enabled: boolean | null;
};

export function portfolioCitySettings(project: ConferenceReference): PortfolioCitySettings {
  return {
    event_city_slug: project.event_city_slug || null,
    reference_city_slugs: project.reference_city_slugs || [],
    conference_reference_enabled: project.conference_reference_enabled ?? null,
  };
}
