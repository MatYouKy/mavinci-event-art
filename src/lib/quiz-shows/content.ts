export const QUIZ_PATH = '/oferta/quizy-teleturnieje';
export const QUIZ_TITLE = 'Quizy i teleturnieje na imprezy firmowe';
export const QUIZ_DESCRIPTION = 'Quizy i teleturnieje na integracje, kolacje firmowe i wieczory po konferencji. MAVINCI: prowadzenie, personalizacja i własna technika. Olsztyn, Warmia i Mazury.';
export const QUIZ_INTRO = 'Zamień firmowy wieczór we wspólną rozgrywkę. Łączymy zespołową rywalizację, humor i multimedia. Dobieramy formułę do uczestników oraz programu wydarzenia — od integracji przy kolacji po teleturniej na scenie.';

export const quizFaq = [
  { question: 'Czy teleturniej pasuje do kolacji firmowej lub wieczoru po konferencji?', answer: 'Tak. Dobieramy formułę do planu wieczoru, układu sali i obsługi gastronomicznej. Ustalamy, czy uczestnicy grają przy stolikach, czy wybrane zespoły spotykają się na scenie. Rundy można rozdzielić przerwami przewidzianymi w programie.' },
  { question: 'Czy pytania mogą dotyczyć naszej firmy?', answer: 'Możemy przygotować pytania o historię firmy, jej produkty, zespół lub temat wydarzenia. Materiały i scenariusz uzgadniamy z organizatorem. Poziom pytań powinien dawać szansę na udział również nowym pracownikom.' },
  { question: 'Ile trwa rozgrywka i ile osób może w niej uczestniczyć?', answer: 'Czas, liczbę rund i sposób udziału ustalamy dla konkretnego formatu. Przy zapytaniu podaj liczbę gości oraz czas dostępny w harmonogramie. Na tej podstawie dobierzemy grę, podział na drużyny i potrzebny sprzęt.' },
  { question: 'Czy potrzebujemy własnego ekranu i nagłośnienia?', answer: 'MAVINCI dysponuje własnym nagłośnieniem, ekranami LED, oświetleniem i zapleczem do realizacji multimediów. Możemy również uzgodnić wykorzystanie wyposażenia obiektu. W ofercie określamy, jakie urządzenia i obsługa będą potrzebne.' },
  { question: 'Co wpływa na cenę teleturnieju?', answer: 'Znaczenie mają format, czas realizacji, liczba uczestników, personalizacja pytań, zakres techniki i lokalizacja. Nagrody, dodatkowa scenografia, nagranie czy streaming są ustalane osobno. Przesłanie terminu, miejsca i liczby gości pozwala przygotować konkretną propozycję.' },
  { question: 'Gdzie realizujecie quizy i teleturnieje?', answer: 'Nasze biuro i magazyn znajdują się w Olsztynie. Obsługujemy Warmię i Mazury oraz wydarzenia w innych regionach Polski. Transport, montaż i wymagania obiektu ustalamy przy wycenie.' },
];

export interface QuizCity {
  slug: string;
  name: string;
  location: string;
  published: boolean;
  updatedAt: string;
  intro: string;
  planning: string;
  checks: string[];
  faq: { question: string; answer: string }[];
}

/** Add a city only with its own planning content. Drafts never enter routes, links or sitemap. */
const cities: QuizCity[] = [{
  slug: 'olsztyn', name: 'Olsztyn', location: 'w Olsztynie', published: true, updatedAt: '2026-10-05',
  intro: 'Organizujesz integrację zespołu w Olsztynie, kolację firmową lub wieczór po konferencji? Dobierzemy quiz do układu sali i planu spotkania. Rozgrywka może połączyć osoby z różnych działów, a pytania o firmę nadać wydarzeniu własny charakter.',
  planning: 'Biuro i magazyn MAVINCI znajdują się przy ul. Towarowej 20B w Olsztynie. Stąd przygotowujemy technikę na wydarzenia w mieście i okolicach. Przy ustaleniach z obiektem określamy godzinę rozładunku, czas montażu oraz próbę dźwięku przed wejściem gości. Wykorzystanie hotelowego ekranu lub nagłośnienia uzgadniamy wcześniej z obsługą techniczną.',
  checks: ['Przy kolacji: widoczność pytań ze wszystkich stolików i przerwy zgodne z serwisem dań.', 'Po konferencji: czas na zmianę ustawienia sali oraz przejście od prezentacji do rozrywki.', 'W siedzibie firmy: miejsce dla prowadzącego, zasilanie oraz bezpieczne poprowadzenie przewodów.'],
  faq: [
    { question: 'Czy realizujecie teleturnieje również w okolicach Olsztyna?', answer: 'Tak. Przy zapytaniu podaj dokładny adres obiektu, liczbę uczestników i termin. Dojazd, transport techniki i godziny montażu uwzględnimy w propozycji dla tego wydarzenia.' },
    { question: 'Czy można uzgodnić przygotowania w Waszym biurze w Olsztynie?', answer: 'Nasze biuro i magazyn znajdują się przy ul. Towarowej 20B. Termin spotkania ustal wcześniej telefonicznie lub mailowo, abyśmy mogli przygotować rozmowę o formacie i technice.' },
  ],
}];

export function getPublishedQuizCities(): QuizCity[] {
  return cities.filter(city => city.published && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(city.slug) &&
    city.intro.trim() && city.planning.trim() && city.checks.length && city.faq.length);
}
export function getQuizCity(slug: string): QuizCity | undefined {
  return getPublishedQuizCities().find(city => city.slug === slug);
}
