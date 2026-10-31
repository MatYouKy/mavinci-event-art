import localProfiles from './conferenceLocalProfiles.json';

export type ConferenceCityContent = {
  version: 1 | 2;
  heading: string;
  intro: string;
  planning: string;
  checks: string[];
  venue: { name: string; fact: string; url: string };
  researchedAt: string;
  scenarios?: { title: string; description: string }[];
  logistics?: string;
  recording?: string;
  costFactors?: string[];
  partnership?: string;
  planningHeading?: string;
  formatsHeading?: string;
  benefitsHeading?: string;
  benefits?: { title: string; description: string }[];
  serviceArea?: { heading: string; description: string; locations: string[] };
};

type ConferenceLocalProfile = {
  nearbyCitySlugs: string[];
  content: Omit<ConferenceCityContent, 'version' | 'venue' | 'researchedAt'>;
  faq: { question: string; answer: string }[];
};
const profiles: Record<string, ConferenceLocalProfile> = localProfiles;

export function getConferenceLocalProfile(citySlug: string): ConferenceLocalProfile | undefined {
  return Object.prototype.hasOwnProperty.call(profiles, citySlug) ? profiles[citySlug] : undefined;
}

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
  if ((value.version !== 1 && value.version !== 2) || !text(value.heading) || !text(value.intro) ||
      !text(value.planning) || !Array.isArray(value.checks) || !value.checks.length ||
      !value.checks.every(text) || !record(venue)) return null;
  const hasVenue = Boolean(venue.name || venue.fact || venue.url);
  if (hasVenue && (!text(venue.name) || !text(venue.fact) || !text(venue.url) || !isConferenceSourceUrl(venue.url))) return null;
  if (value.version === 2 && (!Array.isArray(value.scenarios) || !value.scenarios.length ||
      !value.scenarios.every(item => record(item) && text(item.title) && text(item.description)) ||
      !text(value.logistics) || !text(value.recording) || !text(value.partnership) ||
      !Array.isArray(value.costFactors) || !value.costFactors.length || !value.costFactors.every(text))) return null;
  if (value.benefits !== undefined && (!Array.isArray(value.benefits) ||
      !value.benefits.every(item => record(item) && text(item.title) && text(item.description)))) return null;
  const serviceArea = value.serviceArea;
  if (serviceArea !== undefined && (!record(serviceArea) || !text(serviceArea.heading) ||
      !text(serviceArea.description) || !Array.isArray(serviceArea.locations) || !serviceArea.locations.every(text))) return null;
  return {
    version: value.version, heading: value.heading, intro: value.intro, planning: value.planning,
    checks: value.checks, venue: { name: typeof venue.name === 'string' ? venue.name : '', fact: typeof venue.fact === 'string' ? venue.fact : '', url: typeof venue.url === 'string' ? venue.url : '' },
    researchedAt: typeof value.researchedAt === 'string' ? value.researchedAt : '',
    ...(text(value.planningHeading) ? { planningHeading: value.planningHeading } : {}),
    ...(text(value.formatsHeading) ? { formatsHeading: value.formatsHeading } : {}),
    ...(text(value.benefitsHeading) ? { benefitsHeading: value.benefitsHeading } : {}),
    ...(Array.isArray(value.benefits) ? { benefits: value.benefits as { title: string; description: string }[] } : {}),
    ...(record(serviceArea) ? { serviceArea: serviceArea as ConferenceCityContent['serviceArea'] } : {}),
    ...(value.version === 2 ? {
      scenarios: value.scenarios as { title: string; description: string }[],
      logistics: value.logistics as string, recording: value.recording as string,
      costFactors: value.costFactors as string[], partnership: value.partnership as string,
    } : {}),
  };
}

export function readConferenceCityFaqs(schema: unknown): { question: string; answer: string }[] {
  if (!record(schema) || !Array.isArray(schema.faq)) return [];
  return schema.faq.flatMap((item: unknown) => record(item) && text(item.question) && text(item.answer)
    ? [{ question: item.question, answer: item.answer }] : []);
}


/** Defaults describe capabilities, not an invented local office or completed project. */
export function resolveConferenceCityContent(schema: unknown, cityName: string, citySlug = ''): ConferenceCityContent {
  return {
    heading: `${cityName}: technika konferencji od przygotowania do realizacji`,
    intro: 'Zapewniamy nagłośnienie Meyer Sound, ekrany LED, multimedia, oświetlenie i streaming konferencji. Dobieramy zestaw do programu, sali i liczby uczestników. Możesz powierzyć nam pełną oprawę techniczną albo wybraną część wydarzenia.',
    planning: 'Zaczynamy od scenariusza oraz warunków obiektu. Ustalamy ustawienie sceny i publiczności, liczbę mikrofonów, format prezentacji oraz potrzeby prelegentów. Harmonogram obejmuje dostawę, montaż, próby i demontaż.',
    checks: ['Termin, obiekt i godziny dostępu do sali.', 'Liczba uczestników, sal i osób występujących jednocześnie.', 'Prezentacje, wideo, udział zdalny i plan wieczornej części wydarzenia.'],
    venue: { name: '', fact: '', url: '' }, researchedAt: '',
    scenarios: [
      { title: 'Konferencja i panele dyskusyjne', description: 'Czytelny głos, mikrofony dla prelegentów i moderatora, prezentacje na ekranie oraz oświetlenie sceny. Przed rozpoczęciem sprawdzamy materiały i przebieg wystąpień.' },
      { title: 'Konferencja hybrydowa i transmisja', description: 'Łączymy przekaz z sali z udziałem odbiorców online. Ustalamy obraz z kamer, dźwięk do transmisji, wyświetlanie prezentacji i połączenia z prelegentami zdalnymi.' },
      { title: 'Konferencja z galą lub bankietem', description: 'Planujemy zmianę z części merytorycznej na wieczorną: światło, oprawę multimedialną, nagłośnienie prowadzącego i wykonawców. Możemy połączyć technikę z programem integracyjnym.' },
    ],
    logistics: 'Przyjeżdżamy z własnym sprzętem i zespołem z Olsztyna. Zakres oraz koszt transportu ustalamy dla konkretnego miejsca. Z obiektem uzgadniamy dojazd, rozładunek, zasilanie, możliwości instalacji i godziny pracy. Przy kilku salach planujemy obsadę i technikę osobno dla każdej części programu.',
    recording: 'Streaming i nagranie to dwa zakresy do ustalenia w briefie. Omawiamy liczbę kamer, platformę transmisji, połączenia zdalne oraz warunki internetowe obiektu. Jeśli potrzebujesz materiałów po wydarzeniu, uzgadniamy sposób rejestracji, montaż i format przekazania nagrań.',
    costFactors: ['Liczba sal, uczestników i dni wydarzenia.', 'Liczba mikrofonów oraz wymagania sceny i wykonawców.', 'Wymiary ekranów LED, format prezentacji i zakres oświetlenia.', 'Kamery, streaming, połączenia zdalne i materiały po wydarzeniu.', 'Czas pracy realizatorów, transport, dostęp do obiektu i harmonogram montażu.'],
    partnership: 'Współpracujemy z organizatorami, agencjami eventowymi i hotelami. Możemy odpowiadać za całą technikę lub uzupełnić wyposażenie obiektu. Uzgadniamy podział zadań, osobę do kontaktu i harmonogram, aby program na scenie oraz praca zaplecza były skoordynowane.',
    ...getConferenceLocalProfile(citySlug)?.content,
    ...readConferenceCityContent(schema),
    version: 2,
  };
}
