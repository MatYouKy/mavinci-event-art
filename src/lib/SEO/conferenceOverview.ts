/** The overview describes the service nationally; the Olsztyn page owns the local offer. */
export const CONFERENCE_OVERVIEW_SEO = {
  title: 'Obsługa techniczna konferencji – LED i streaming | MAVINCI',
  description: 'Techniczna obsługa konferencji w całej Polsce: nagłośnienie Meyer Sound, ekrany LED, oświetlenie i streaming. Własny sprzęt, realizatorzy i przygotowanie wydarzenia.',
} as const;

const previousTitles = new Set([
  'Obsługa konferencji Olsztyn – LED, streaming | MAVINCI',
  'MAVINCI Event & ART | Techniczna Obsługa Konferencji | Ekran Led | Streaming',
]);
const previousDescriptions = new Set([
  'Obsługa techniczna konferencji w Olsztynie i na Warmii i Mazurach. Własne nagłośnienie Meyer Sound, ekrany LED, oświetlenie, multimedia i streaming.',
  'Kompleksowa obsługa techniczna konferencji: nagłośnienie, projekcja, streaming, rejestracja wideo. Doświadczenie, profesjonalizm, nowoczesny sprzęt.',
]);

/** Works before the companion migration and preserves subsequent CMS edits. */
export function resolveConferenceOverviewSeo(seo?: { title?: string | null; description?: string | null } | null) {
  const title = seo?.title?.trim();
  const description = seo?.description?.trim();
  return {
    title: !title || previousTitles.has(title) ? CONFERENCE_OVERVIEW_SEO.title : title,
    description: !description || previousDescriptions.has(description) ? CONFERENCE_OVERVIEW_SEO.description : description,
  };
}

export const OLSZTYN_CONFERENCE_PATH = '/oferta/konferencje/olsztyn';
export const PSRWN_PROJECT_ID = '3b3bb671-c81f-4033-a71e-8012c1f9f88c';
export const PSRWN_PROJECT_PATH = '/portfolio/konferencja-psrwn';

/** Only directly relevant technical services get the contextual conference link. */
export const CONFERENCE_TECHNICAL_SLUGS = new Set([
  'systemy-line-array-meyer-sound-lina',
  'systemy-point-source',
  'ekrany-led-do-konferencji-i-gal',
  'realizacja-wielokamerowa',
  'kamery-4k-blackmagic',
  'operatorzy-kamer',
  'nagrania-montaze-realizacja-hybrydowa',
  'promptery-i-comfort-monitory',
  'kompleksowa-obsluga-techniczna',
]);
