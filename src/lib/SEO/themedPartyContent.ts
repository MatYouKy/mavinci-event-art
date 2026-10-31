import editorial from './themedPartyEditorial.json';

export const THEMED_PARTY_PATH = '/oferta/wieczory-tematyczne';
export const OLSZTYN_THEMED_PARTY_PATH = `${THEMED_PARTY_PATH}/olsztyn`;
export type ThemedPartyFAQ = { question: string; answer: string };
export type ThemedPartyEditorial = {
  intro_heading: string; intro_text: string;
  planning_heading: string; planning_text: string; planning_checks: string[];
  faq: ThemedPartyFAQ[];
};
type ThemedPartyLocalProfile = {
  title: string; metaTitle: string; description: string; lead: string;
  nearbyCitySlugs?: string[];
  content: Omit<ThemedPartyEditorial, 'faq'> & { faq?: ThemedPartyFAQ[] };
};
const localProfiles: Record<string, ThemedPartyLocalProfile> = {
  olsztyn: { ...editorial.olsztyn, nearbyCitySlugs: ['warchaly', 'szczytno', 'ryn', 'gizycko', 'elk', 'mikolajki'] },
  ...editorial.localCities,
};
export function getThemedPartyLocalProfile(slug: string): ThemedPartyLocalProfile | undefined {
  return Object.prototype.hasOwnProperty.call(localProfiles, slug) ? localProfiles[slug] : undefined;
}
export type ThemedPartyHeroSettings = {
  image_url?: string | null; alt_text?: string | null; opacity?: number | null;
  image_metadata?: { desktop?: { src?: string }; mobile?: { src?: string }; object_position?: string; [key: string]: unknown } | null;
};
export const themedText = (value: unknown, fallback = ''): string => typeof value === 'string' && value.trim() ? value.trim() : fallback;
export function readThemedFaq(value: unknown): ThemedPartyFAQ[] {
  return Array.isArray(value) ? value.filter((row): row is ThemedPartyFAQ => !!row && typeof row === 'object' && !!themedText(row.question) && !!themedText(row.answer)) : [];
}

export function getThemedPartyDefaults(slug: string, name: string, location: string) {
  const local = getThemedPartyLocalProfile(slug);
  const faq: ThemedPartyFAQ[] = [
    { question: `Jak zorganizować imprezę tematyczną dla firmy ${location}?`, answer: 'Zacznij od terminu, liczby uczestników, miejsca i celu spotkania. Na tej podstawie dobieramy motyw oraz program, a następnie uzgadniamy muzykę, prowadzenie, dekoracje, technikę i harmonogram. W ofercie wskazujemy konkretny zakres realizacji.' },
    { question: 'Czy wieczór tematyczny można połączyć z konferencją?', answer: 'Tak. Część wieczorna może odbyć się po konferencji lub szkoleniu. Ustalamy z obiektem czas na przygotowanie sali, próby i zmianę oprawy. Możemy obsłużyć również technikę konferencji, żeby oba programy miały spójny harmonogram.' },
    { question: 'Jak może wyglądać integracja tematyczna pracowników?', answer: 'Może rozpocząć się krótkim quizem lub teleturniejem, przejść w rozmowy przy kasynie rozrywkowym, a zakończyć tańcami. Wybieramy aktywności odpowiednie dla uczestników i czasu spotkania; nie każdy wieczór musi zawierać wszystkie te elementy.' },
    { question: 'Co obejmuje organizacja wieczoru, a co wymaga dodatkowego ustalenia?', answer: 'Zakres może obejmować scenariusz, koordynację, DJ-a, prowadzenie, dekoracje, nagłośnienie, światło i multimedia. Występy, atrakcje, wynajem sali, catering i noclegi uzgadniamy oddzielnie. Obecność motywu w katalogu nie oznacza, że wszystkie dodatki są w jednym pakiecie.' },
    { question: 'Ile kosztuje impreza tematyczna dla firmy?', answer: 'Wycenę przygotowujemy na podstawie miejsca, terminu, liczby gości, długości programu, motywu i wybranych atrakcji. Znaczenie mają też czas montażu, transport i dostęp do sali. Prześlij te informacje oraz założony budżet, a dopasujemy zakres oferty.' },
    { question: 'Czy uczestnicy muszą się przebierać?', answer: 'Nie. Motyw można zbudować muzyką, światłem, dekoracją i programem bez obowiązkowych kostiumów. Jeżeli firma chce wprowadzić dress code, ustalamy go wcześniej i proponujemy prostą informację dla gości.' },
    { question: 'Czy kasyno na imprezie firmowej oznacza grę na pieniądze?', answer: 'Nie. Kasyno eventowe służy rozrywce i integracji, bez zakładów pieniężnych. Zasady udziału i przebieg zabawy ustalamy z organizatorem.' },
  ];
  return {
    title: local?.title || `Imprezy i wieczory tematyczne dla firm ${location}`,
    metaTitle: local?.metaTitle || `Imprezy tematyczne dla firm ${name} | MAVINCI`,
    description: local?.description || `Wieczory i imprezy tematyczne dla firm ${location}: Gatsby, Las Vegas, PRL i Hollywood. Scenariusz, DJ, dekoracje i własna technika MAVINCI.`,
    lead: local?.lead || `Przygotowujemy wieczory po konferencjach, integracje pracowników i gale ${location}. Łączymy motyw wydarzenia z programem dla gości, muzyką, dekoracjami i własną techniką. Zakres oraz dojazd ustalamy dla konkretnej realizacji.`,
    content: {
      ...(local?.content || {
        intro_heading: 'Motyw wieczoru i program dla Twojego zespołu',
        intro_text: 'Temat imprezy porządkuje muzykę, oprawę sali i aktywności uczestników. W MAVINCI dobieramy scenariusz do celu spotkania: integracji pracowników, rozmów po konferencji lub wspólnego świętowania. Możemy połączyć DJ-a i prowadzenie z quizem, teleturniejem, kasynem rozrywkowym oraz uzgodnionym programem artystycznym.',
        planning_heading: `Planowanie wydarzenia ${location}`,
        planning_text: `Obsługę wydarzenia ${location} przygotowujemy z naszej bazy w Olsztynie. Nie wymaga to wyboru konkretnego hotelu: zakres dostosowujemy do obiektu wskazanego przez organizatora. Przed wyceną ustalamy transport, dostęp do sali, zasilanie i czas montażu. Gdy spotkanie łączy konferencję z wieczorem, uzgadniamy również moment przebudowy sali i próby.`,
        planning_checks: ['Termin, adres i godziny dostępu do obiektu.', 'Liczba uczestników oraz miejsca na parkiet i atrakcje.', 'Godziny konferencji, kolacji i części wieczornej.', 'Warunki montażu, zasilanie i zasady obiektu.'],
      }), faq: local?.content.faq || faq,
    } satisfies ThemedPartyEditorial,
  };
}

/** These published projects contain relevant descriptions, even without marketing tags. */
const referenceIds = new Set(['7612c319-a402-4981-a5dd-f79502c9cf01', 'b847903d-4e63-46a9-bcf7-64dce2584dab', '44c3e755-dd64-4214-a000-8b2bbb07894e']);
export function isThemedPartyReference(project: { id?: string; tags?: unknown }): boolean {
  return referenceIds.has(project.id || '') || (Array.isArray(project.tags) && project.tags.some(tag => ['imprezy-tematyczne', 'wieczory-tematyczne'].includes(tag)));
}
