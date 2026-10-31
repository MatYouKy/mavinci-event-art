import type { PolishCityCases } from '@/lib/polishCityCases';

export type StageFaq = { question: string; answer: string };
export type StagePlanning = { heading: string; text: string; checks: string[] };
export type StageEditorial = {
  intro_heading: string;
  intro_text: string;
  planning_heading: string;
  planning_text: string;
  planning_checks: string[];
  faq: StageFaq[];
};

export const stageIntroHeading = 'Nagłośnienie, światło i multimedia {{prep}} {{locative}}';
export const stageIntroText = 'MAVINCI łączy własne zaplecze techniczne z realizacją wydarzenia. Korzystamy z systemu liniowego Meyer Sound LINA, zapewniamy oświetlenie sceniczne, ekrany LED wewnętrzne i zewnętrzne, totemy, telewizory oraz streaming. Dobieramy technikę do programu, przestrzeni i potrzeb wykonawców.\nMożesz zlecić nam całą oprawę techniczną lub wybrany zakres: dźwięk, światło, obraz albo scenę i podesty. W ofercie ustalamy sprzęt, obsadę realizatorów, transport, montaż, próby i demontaż. Dostępność oraz konfigurację potwierdzamy dla konkretnego terminu.';

export function stageTemplate(value: string, city: PolishCityCases): string {
  return value.replace(/\{\{(prep|locative|genitive|nominative)\}\}/g, (_, key: string) => {
    if (key === 'prep') return city.locative_preposition || 'w';
    return city[key as 'locative' | 'genitive' | 'nominative'];
  });
}
export function stageText(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}
export function readStageFaq(value: unknown): StageFaq[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => item && typeof item === 'object' && stageText(item.question) && stageText(item.answer)
    ? [{ question: stageText(item.question), answer: stageText(item.answer) }] : []);
}

/** Local planning advice describes possible briefs, never invented local projects or branches. */
const localPlanning: Record<string, StagePlanning> = {
  olsztyn: {
    heading: 'Olsztyn: zaplecze na miejscu, technika dobrana do wydarzenia',
    text: 'Nasze biuro i magazyn znajdują się przy ul. Towarowej 20B w Olsztynie. Przy wydarzeniu w mieście lub okolicy możemy zacząć od ustalenia warunków sali albo pleneru. Dla gali ważne będą widoczność sceny i światło podczas wręczania nagród; dla imprezy nad jeziorem — rozmieszczenie publiczności, zasilanie i warunki pracy na zewnątrz. W portfolio znajdziesz m.in. Miejską by Night na Plaży Miejskiej oraz konferencję PSRWN w Hotelu Przystań.',
    checks: ['Nazwa obiektu lub dokładna lokalizacja pleneru i dojazd do rozładunku.', 'Czy program łączy wystąpienia, koncert lub set DJ-a i wieczorną integrację?', 'Plan publiczności, wymagania wykonawców i czas na próbę dźwięku.'],
  },
  gdansk: {
    heading: 'Gdańsk i Trójmiasto: jeden plan dla sceny, obrazu i zaplecza',
    text: 'Przygotowując technikę na wydarzenie w Gdańsku, ustalamy najpierw obiekt i przebieg programu: gala w sali, premiera z ekranem LED czy impreza plenerowa wymagają innego zestawu. Jeśli produkcja obejmuje także Gdynię lub Sopot, podaj kolejność lokalizacji i godziny dostępu. Pozwoli to zaplanować transport oraz próby bez opierania harmonogramu wyłącznie na godzinie rozpoczęcia imprezy. Zaplecze MAVINCI mieści się w Olsztynie; dojazd i pracę zespołu uwzględniamy w ofercie.',
    checks: ['Dokładny adres, rezerwacja rozładunku i godziny wejścia ekipy do obiektu.', 'Czy ekran ma pokazywać scenę, materiały marki, prezentacje czy kilka źródeł obrazu?', 'Dla pleneru: zasilanie, ochrona urządzeń i uzgodniony z obiektem wariant na zmianę pogody.'],
  },
  bialystok: {
    heading: 'Białystok: przygotowanie sceny pod program i wykonawców',
    text: 'Do wyceny wydarzenia w Białymstoku potrzebujemy informacji, czy technika ma obsługiwać koncert, firmową galę, piknik czy program łączący kilka formatów. Przy występach na żywo punktem wyjścia jest rider i plan sceny; przy premierze lub gali — scenariusz, mikrofony, światło i materiały na ekran LED. Jeśli część programu odbywa się poza miastem, wskaż dokładny adres na Podlasiu. Transport sprzętu z naszego zaplecza w Olsztynie, dostęp do miejsca i obsadę uzgadniamy przed realizacją.',
    checks: ['Aktualny rider, lista wykonawców i plan zmian na scenie.', 'Liczba mikrofonów oraz wymagania odsłuchu dla prowadzących i artystów.', 'Harmonogram montażu, prób i demontażu, także gdy wydarzenie ma kilka lokalizacji.'],
  },
  torun: {
    heading: 'Toruń: od warunków obiektu do próby całego programu',
    text: 'Dla wydarzenia w Toruniu przygotowujemy zakres nagłośnienia, oświetlenia i multimediów na podstawie planu sali lub terenu. Jeżeli obiekt leży w historycznym centrum, warto od razu ustalić zasady wjazdu i wniesienia sprzętu z administratorem. Przy gali z koncertem planujemy przejście od wystąpień do muzyki: ustawienie mikrofonów, odsłuch, sceny świetlne i obraz. Produkcję obsługujemy z zaplecza w Olsztynie, z transportem i czasem pracy określonymi w wycenie.',
    checks: ['Zasady dostępu do obiektu, miejsce postoju i droga transportu urządzeń.', 'Możliwości ustawienia ekranu, sceny oraz stanowiska realizatorów.', 'Czas na próbę występu i sprawdzenie materiałów przed wpuszczeniem publiczności.'],
  },
};

export function getStagePlanning(slug: string, name: string, region: string): StagePlanning {
  if (localPlanning[slug]) return localPlanning[slug];
  const regional = region.toLocaleLowerCase('pl-PL');
  const text = regional.includes('warmińsko')
    ? 'Przy wydarzeniach na Warmii i Mazurach często trzeba połączyć technikę w sali z częścią programu na zewnątrz. Jeżeli planujesz taki format, podaj odległość między strefami, godziny zmian programu i dostępne zasilanie. Dla imprezy nad jeziorem ustalamy również drogę transportu sprzętu, miejsce publiczności oraz ochronę urządzeń.'
    : regional.includes('pomorskie') && !regional.includes('kujawsko')
      ? 'Przy produkcji na Pomorzu ustalamy, czy sprzęt pracuje w sali, pod zadaszeniem czy na otwartym terenie. Te warunki wpływają na ekran, ustawienie nagłośnienia, światło i harmonogram. Dla programu odbywającego się w kilku obiektach potrzebne są osobne informacje o rozładunku, zasilaniu i dostępie ekipy.'
      : regional.includes('mazowieckie')
        ? 'Jeżeli wydarzenie łączy część biznesową z bankietem lub koncertem, zaplanujmy technikę dla obu etapów. W briefie wskaż liczbę sal, godziny zmiany ustawienia i materiały na ekrany. Przy produkcji kilkudniowej ustalamy osobno dostęp do obiektu, próby i pracę realizatorów każdego dnia.'
        : regional.includes('kujawsko')
          ? 'Dla programu z występami na żywo punktem wyjścia są wymagania artystów i plan sceny. Dla gali lub prezentacji równie ważne będą czytelność mowy, światło na prowadzących i widoczność ekranu. Wskaż, które elementy są już w obiekcie, a które MAVINCI ma dostarczyć wraz z obsługą.'
          : 'Zestaw techniki ustalamy dla konkretnego obiektu i programu. Wyślij plan sali lub terenu, liczbę odbiorców i potrzeby osób występujących na scenie. Pozwoli to dobrać dźwięk, światło i obraz oraz rozdzielić obowiązki pomiędzy naszą ekipę, organizatora i obsługę miejsca.';
  return {
    heading: `${name}: jak przygotować miejsce i zakres techniki`,
    text: `${text} Nasze biuro i magazyn znajdują się w Olsztynie. Transport do wskazanej lokalizacji, montaż i obsługę uwzględniamy w indywidualnej ofercie.`,
    checks: ['Adres i plan miejsca wydarzenia, godziny dostępu oraz warunki rozładunku.', 'Scenariusz, wymagania wykonawców i materiały wyświetlane na ekranach.', 'Zakres wyposażenia obiektu, dostępne zasilanie i czas na wspólną próbę.'],
  };
}

export function getStageFaq(location: string): StageFaq[] {
  return [
    { question: 'Czy macie ekrany LED do wnętrz i na zewnątrz, totemy oraz telewizory?', answer: 'Tak. MAVINCI oferuje ekrany LED wewnętrzne i zewnętrzne, totemy oraz telewizory. Dobieramy rozwiązanie do miejsca, odległości odbiorców, treści i sposobu montażu. Rozmiar, konfigurację, obsługę i dostępność określamy w ofercie na konkretny termin.' },
    { question: `Co obejmuje obsługa techniczna imprez ${location}?`, answer: 'Zakres może łączyć nagłośnienie, oświetlenie, scenę i podesty, ekrany LED, multimedia oraz realizatorów. Możesz zamówić całość lub wybrane elementy. Sprzęt, transport, montaż, próby, czas pracy i demontaż wyszczególniamy w ofercie.' },
    { question: 'Jakie nagłośnienie oferuje MAVINCI?', answer: 'Nasze zaplecze obejmuje własny system line array Meyer Sound LINA. W opublikowanej ofercie znajdziesz też monitory sceniczne Meyer Sound MJF210, mikrofony i realizację audio. Konfigurację dobieramy do sceny, publiczności i programu; dostępność potwierdzamy na wskazany termin.' },
    { question: 'Czy można zlecić tylko nagłośnienie, oświetlenie lub ekran LED?', answer: 'Tak, ustalamy również wybrany zakres techniczny. W zapytaniu podaj, co zapewnia już obiekt lub inny wykonawca. Pozwoli to uzgodnić połączenia systemów, odpowiedzialność za obsługę i harmonogram. Wynajem bez realizatora wymaga osobnego potwierdzenia.' },
    { question: 'Czy możecie przygotować ofertę na podstawie ridera artysty?', answer: 'Tak. Prześlij aktualny rider, plan sceny i harmonogram występów. Sprawdzimy wymagania dotyczące nagłośnienia, odsłuchu, mikrofonów, światła i obsługi. Ewentualne zamienniki oraz elementy wymagające dodatkowego dostawcy uzgadniamy przed potwierdzeniem zakresu.' },
    { question: 'Czy realizujecie technikę w plenerze i streaming wydarzenia?', answer: 'Tak, takie zakresy są częścią naszej oferty. Dla pleneru ustalamy warunki terenu, zasilanie, ochronę sprzętu i sceny. Dla transmisji planujemy kamery, dźwięk do streamingu, materiały oraz połączenie internetowe. Rozmiar ekranu i zestaw urządzeń dobieramy indywidualnie.' },
    { question: `Ile kosztuje technika sceniczna i eventowa ${location}?`, answer: 'Wycena zależy od programu, liczby uczestników, miejsca, czasu pracy i konfiguracji sprzętu. Znaczenie mają również transport, montaż, próby, liczba realizatorów, wymagania artystów i zakres transmisji. Wyślij datę, adres, orientacyjną liczbę gości i listę potrzeb; na tej podstawie ustalimy zakres oferty.' },
    { question: 'Czy współpracujecie z agencjami eventowymi i hotelami?', answer: 'Tak. Możemy przejąć technikę całej produkcji albo uzupełnić wyposażenie obiektu. Ustalamy podział obowiązków, kontakt do koordynatora i harmonogram. Nasze biuro i magazyn znajdują się w Olsztynie, a realizacje obsługujemy również w innych miastach.' },
  ];
}

export const stageProcess = [
  { title: 'Brief i uzgodnienie zakresu', description: 'Ustalamy termin, miejsce, program, widownię i wymagania artystów. Rozdzielamy wyposażenie obiektu od sprzętu, który przywieziemy.' },
  { title: 'Plan i wycena', description: 'Dobieramy dźwięk, światło, obraz oraz obsadę. Uzgadniamy transport, ustawienie sceny, warunki montażu i koszt poszczególnych zakresów.' },
  { title: 'Montaż i próby', description: 'Przygotowujemy uzgodnione systemy. Sprawdzamy mikrofony, odsłuch, materiały na ekranie, sceny świetlne i kolejność punktów programu.' },
  { title: 'Realizacja i demontaż', description: 'Obsługujemy wydarzenie zgodnie ze scenariuszem i ustalonym zakresem. Po zakończeniu demontujemy sprzęt w uzgodnionych godzinach.' },
];
