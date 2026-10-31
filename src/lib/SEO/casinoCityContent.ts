export type CasinoService = {
  title: string; description: string; icon?: string; slug?: string;
  href?: string; image?: string; mobileImage?: string; alt?: string;
};
export type CasinoFaq = { question: string; answer: string };

export const casinoDefaultFaq: CasinoFaq[] = [
  { question: 'Czy podczas atrakcji gra się na prawdziwe pieniądze?', answer: 'Nie. Oferujemy kasyno eventowe jako rozrywkę podczas wydarzenia. Uczestnicy korzystają z żetonów bez wartości pieniężnej, a krupierzy objaśniają zasady i prowadzą zabawę.' },
  { question: 'Ile stołów potrzebuję na event?', answer: 'Liczbę i rodzaje stołów dobieramy do liczby uczestników, dostępnej przestrzeni oraz długości programu. W zapytaniu podaj liczbę gości i informację, czy kasyno będzie główną atrakcją, czy częścią większego wydarzenia.' },
  { question: 'Czy goście muszą znać zasady gier?', answer: 'Nie. Krupierzy tłumaczą zasady i pomagają uczestnikom przy stołach. Program można przygotować dla osób, które pierwszy raz korzystają z takiej atrakcji.' },
  { question: 'Jak dużo miejsca potrzebujemy?', answer: 'Przed realizacją ustalamy rozmiar sali, ustawienie stołów i przejścia dla uczestników. Warto przesłać rzut sali lub zdjęcia miejsca, aby dopasować układ do obiektu.' },
  { question: 'Czy kasyno można połączyć z integracją lub galą?', answer: 'Tak. Kasyno eventowe może być częścią wieczoru integracyjnego, bankietu, gali lub wydarzenia w stylu Las Vegas. Zakres dekoracji, oprawy muzycznej i technicznej ustalamy w ofercie.' },
  { question: 'Jak długo trwa wieczór kasynowy?', answer: 'Czas zabawy dopasowujemy do programu imprezy. Przy ustalaniu harmonogramu uwzględniamy również transport, dostęp do sali, montaż i demontaż stołów.' },
  { question: 'Co podać do wyceny?', answer: 'Podaj miasto, termin, obiekt, liczbę uczestników i planowane godziny atrakcji. Na tej podstawie ustalimy zestaw stołów, obsadę krupierską, transport oraz dodatkową oprawę.' },
];

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function getCasinoCityServices(content: Record<string, unknown>, tables: Record<string, any>[]): CasinoService[] {
  const custom = Array.isArray(content.services_json) ? content.services_json.flatMap(item =>
    object(item) && nonempty(item.title) && nonempty(item.description)
      ? [{ title: item.title.trim(), description: item.description.trim(), icon: typeof item.icon === 'string' ? item.icon : undefined }] : []) : [];
  if (custom.length) return custom;
  const icons: Record<string, string> = { ruletka: 'Dice1', blackjack: 'Crown', poker: 'Users' };
  return tables.filter(table => nonempty(table.name)).map(table => ({
    title: table.name.trim(),
    description: typeof table.description === 'string' ? table.description.trim().split(/\r?\n/)[0] : '',
    slug: table.slug, icon: icons[table.slug] || 'Dice1',
  }));
}

export function getCasinoCityFaq(content: Record<string, unknown>, schema: Record<string, unknown>): CasinoFaq[] {
  const parse = (value: unknown): CasinoFaq[] => Array.isArray(value) ? value.flatMap(item =>
    object(item) && nonempty(item.question) && nonempty(item.answer)
      ? [{ question: item.question.trim(), answer: item.answer.trim() }] : []) : [];
  const local = parse(content.faq_json);
  const seo = parse(schema.faq);
  const selected = [...(local.length ? local : seo), ...casinoDefaultFaq].map(item =>
    item.question === 'Czy kasyno eventowe jest legalne?' ? casinoDefaultFaq[0] : item);
  const seen = new Set<string>();
  return selected.filter(item => {
    const key = item.question.toLocaleLowerCase('pl-PL');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Refresh only known legacy templates; a deliberately edited title/description stays intact. */
export function casinoCopyOrDefault(value: unknown, legacy: string[], fallback: string): string {
  if (!nonempty(value)) return fallback;
  return legacy.some(old => old.trim().toLocaleLowerCase('pl-PL') === value.trim().toLocaleLowerCase('pl-PL'))
    ? fallback : value.trim();
}

export const casinoProcess = [
  { title: 'Termin, miejsce i uczestnicy', description: 'Przekaż datę, nazwę obiektu, liczbę gości i harmonogram. Ustalimy, czy kasyno będzie główną atrakcją wieczoru, czy częścią bankietu lub integracji.' },
  { title: 'Stoły i zakres obsługi', description: 'Dobieramy gry oraz zestaw stołów do sali i programu. Liczbę krupierów, czas prowadzenia zabawy, dekorację i dodatkową oprawę potwierdzamy w ofercie.' },
  { title: 'Przygotowanie z obiektem', description: 'Uzgadniamy plan ustawienia, rozładunek, drogę wniesienia oraz godziny dostępu do sali. Sprawdzamy schody, windę, przejścia i potrzebne zasilanie.' },
  { title: 'Montaż, zabawa i odbiór sprzętu', description: 'Realizujemy uzgodniony program, a po zakończeniu demontujemy strefę w ustalonym z obiektem terminie. Obsługa montażowa i prowadzenie gier mają osobno określony zakres.' },
];

export const casinoBenefits = [
  { title: 'Stoły dopasowane do programu', description: 'Blackjack, poker i ruletka pozwalają przygotować strefę rozmów i wspólnej zabawy. Wybór gier i liczbę stołów dopasowujemy do wydarzenia.' },
  { title: 'Wsparcie dla uczestników', description: 'Krupierzy objaśniają zasady i prowadzą rozgrywkę. Zakres obsługi oraz godziny pracy ustalamy przed realizacją.' },
  { title: 'Możliwość rozbudowy wieczoru', description: 'Strefę kasyna można połączyć z muzyką, konferansjerem i oprawą techniczną MAVINCI. Dodatkowe elementy wskazujemy w indywidualnej ofercie.' },
];

export function getCasinoLocalCopy(slug: string, cityName: string, location: string) {
  const plans: Record<string, { heading: string; text: string; checklist: string[] }> = {
    olsztyn: {
      heading: 'Kasyno na firmowy wieczór w Olsztynie i okolicach',
      text: 'Nasze biuro i magazyn znajdują się przy ul. Towarowej 20B w Olsztynie. Strefę kasyna przygotowujemy w uzgodnionym miejscu wydarzenia — hotelu, sali bankietowej lub siedzibie firmy. Możesz zamówić same stoły z ustaloną obsługą albo rozszerzyć wieczór o muzykę i oprawę MAVINCI.',
      checklist: ['Adres sali i osoba kontaktowa w obiekcie', 'Liczba gości oraz rola kasyna w programie', 'Godziny montażu przed wejściem uczestników'],
    },
    gdansk: {
      heading: 'Strefa kasyna po konferencji w Gdańsku',
      text: 'Jeżeli planujesz w Gdańsku konferencję zakończoną bankietem, kasyno może działać w osobnej strefie lub w sali wieczornej. Ustalimy, czy stoły można przygotować wcześniej, czy potrzebna jest zmiana ustawienia po części oficjalnej. Obsługę konferencji i wieczoru możemy ująć w jednym uzgodnionym zakresie.',
      checklist: ['Czy konferencja i bankiet korzystają z tej samej sali?', 'Kiedy możliwy jest rozładunek i wniesienie stołów?', 'Jaki czas przewidziano na zmianę aranżacji?'],
    },
    bialystok: {
      heading: 'Kasyno jako część integracji w Białymstoku',
      text: 'Przy wydarzeniu firmowym w Białymstoku warto ustalić, czy uczestnicy będą korzystać z kasyna przez cały wieczór, czy w określonym bloku programu. Stoły mogą uzupełnić kolację, rozmowy i część muzyczną. Dobór gier, obsługi i ustawienia zaczynamy od liczby gości oraz planu sali.',
      checklist: ['Swobodne korzystanie ze strefy czy osobny blok programu?', 'Miejsce stołów względem kolacji i parkietu', 'Uzgodniony zakres dekoracji i prowadzenia zabawy'],
    },
    torun: {
      heading: 'Kasyno na galę i bankiet w Toruniu',
      text: 'Na gali w Toruniu strefa kasyna może otworzyć część nieformalną po przemówieniach i wręczeniu wyróżnień. Jeżeli planujesz wieczór tematyczny, dopasujemy propozycję stołów oraz oprawy do wybranej konwencji. Wspólnie z obiektem ustalimy aranżację i harmonogram wejścia ekipy.',
      checklist: ['Moment uruchomienia strefy po części oficjalnej', 'Wybrana konwencja oraz zakres oprawy', 'Dostęp do sali przed galą i po zakończeniu bankietu'],
    },
  };
  return plans[slug] || {
    heading: `Organizacja strefy kasyna ${location}`,
    text: `Planując kasyno na imprezę firmową ${location}, zacznij od programu i dostępnej przestrzeni. Strefa może uzupełnić kolację, integrację albo wieczór po konferencji. Dla lokalizacji ${cityName} ustalamy z organizatorem i obiektem transport, drogę wniesienia, ustawienie stołów oraz godziny obsługi.`,
    checklist: ['Termin, dokładny obiekt i liczba uczestników', 'Rozmiar sali, przejścia i możliwość rozładunku', 'Wybrane stoły, obsługa oraz czas zabawy'],
  };
}
