export type AgencyFaq = { question: string; answer: string };
export type AgencyScenario = { title: string; description: string };
export type AgencyContent = {
  title: string; description: string; heading: string; lead: string;
  localHeading: string; localText: string; checks: string[];
  scenarios: AgencyScenario[]; faq: AgencyFaq[];
};
export type AgencyCity = { slug: string; name: string; location: string; region: string; content: AgencyContent };

function questions(location?: string): AgencyFaq[] {
  return [
    { question: `Co obejmuje współpraca z agencją eventową MAVINCI${location ? ` ${location}` : ''}?`, answer: 'Zakres może obejmować koncepcję, scenariusz, program, koordynację, oprawę artystyczną i techniczną oraz realizację na miejscu. Ustalamy, które zadania przejmuje MAVINCI, co zapewnia obiekt, a co pozostaje po stronie organizatora. Potwierdzamy to w ofercie.' },
    { question: 'Czy możecie przygotować cały event od pomysłu do realizacji?', answer: 'Tak. Możemy rozpocząć od celu spotkania i pomysłu na program, a następnie połączyć organizację, technikę i rozrywkę. Jeśli część wydarzenia jest już przygotowana, ustalimy brakujące elementy i dopasujemy do nich nasz zakres.' },
    { question: 'Czy organizujecie konferencję połączoną z integracją lub galą?', answer: 'Tak. Łączymy część biznesową z programem wieczornym: galą, muzyką, motywem tematycznym, quizami i teleturniejami albo strefą kasyna eventowego. Scenariusz, czas i atrakcje dobieramy do uczestników oraz celu wydarzenia.' },
    { question: 'Co daje Wasze własne zaplecze techniczne?', answer: 'Program i oprawę możemy planować wspólnie z realizatorami. Dysponujemy nagłośnieniem Meyer Sound LINA, oświetleniem, ekranami LED wewnętrznymi i zewnętrznymi, totemami i telewizorami; zapewniamy również streaming. Konfigurację i dostępność uzgadniamy dla konkretnego wydarzenia.' },
    { question: 'Od czego zależy koszt organizacji eventu?', answer: 'Od liczby uczestników, programu, czasu, miejsca, atrakcji, obsady i potrzebnej techniki. Osobno ustalamy transport, warunki montażu oraz zadania związane z obiektem, cateringiem czy noclegami. Orientacyjny budżet pomaga zaproponować właściwy zakres, a nie przypadkowy zestaw atrakcji.' },
    { question: 'Czy trzeba mieć wybrane miejsce i gotowy scenariusz?', answer: 'Nie. Na początek wystarczy cel wydarzenia, miasto, orientacyjny termin i liczba gości. Ustalimy potrzeby, układ programu i wymagania wobec miejsca. Zakres wsparcia przy wyborze obiektu oraz pozostałych dostawców potwierdzimy podczas przygotowania oferty.' },
    { question: 'Gdzie znajduje się biuro MAVINCI?', answer: 'Biuro i magazyn znajdują się przy ul. Towarowej 20B w Olsztynie. Przyjmujemy zapytania o realizacje w całej Polsce; dojazd, pracę ekipy i warunki przygotowania wydarzenia ustalamy dla wybranej lokalizacji.' },
  ];
}

export const agencyOverview: AgencyContent = {
  title: 'MAVINCI — agencja eventowa z własnym zapleczem technicznym',
  description: 'MAVINCI Event & ART: agencja eventowa dla firm. Koncepcja, scenariusz, koordynacja, oprawa artystyczna i własna technika. Poznaj realizacje i zaplanuj wydarzenie.',
  heading: 'MAVINCI. Agencja eventowa',
  lead: 'Zaczynamy od tego, co Twoje wydarzenie ma osiągnąć. Łączymy pomysł, scenariusz, ludzi i własną technikę w spójny program — od firmowej integracji po konferencję z galą i wieczorną częścią rozrywkową.',
  localHeading: 'Pomysł, który ma swój plan realizacji',
  localText: 'Dobre wydarzenie zaczyna się od celu: spotkania zespołu, podziękowania klientom, premiery albo świętowania ważnego momentu firmy. Na tej podstawie dobieramy format, rytm spotkania, prowadzenie i oprawę.\nMAVINCI Event & ART łączy organizację z zapleczem wykonawczym. Scenariusz, multimedia, muzykę i technikę uzgadniamy razem. Wspólnie określamy budżet, zakres odpowiedzialności i harmonogram, żeby każdy element programu miał swoje miejsce. Nasze biuro i magazyn znajdują się w Olsztynie; pracujemy także przy wydarzeniach w innych regionach Polski.',
  checks: ['Po co organizujesz spotkanie i kogo zapraszasz?', 'Jaki nastrój, tempo i stopień udziału gości chcesz uzyskać?', 'Co ma objąć agencja: całą realizację czy uzgodnioną część produkcji?'],
  scenarios: [
    { title: 'Integracje i wydarzenia dla zespołów', description: 'Program, w którym goście uczestniczą: quizy, teleturnieje, muzyka i atrakcje dopasowane do grupy. Ustalamy wspólny motyw, prowadzenie i rytm spotkania.' },
    { title: 'Konferencje i spotkania biznesowe', description: 'Przebieg wystąpień, prowadzący, prezentacje i technika tworzą jeden plan. Konferencję możemy połączyć z networkingiem, galą lub wieczorem firmowym.' },
    { title: 'Gale, jubileusze i premiery', description: 'Scenariusz ważnych momentów, oprawa sceny, muzyka i obraz. Dbamy o spójność prezentacji marki z programem dla zaproszonych gości.' },
  ],
  faq: questions(),
};

/** New cities require their own editorial brief; a place in the database alone does not publish a page. */
export const agencyCities: AgencyCity[] = [
  { slug: 'olsztyn', name: 'Olsztyn', location: 'w Olsztynie', region: 'Warmia i Mazury', content: {
    title: 'Agencja eventowa Olsztyn — organizacja eventów | MAVINCI',
    description: 'Agencja eventowa MAVINCI w Olsztynie. Organizacja imprez firmowych, integracji, konferencji i gal. Koncepcja, koordynacja, rozrywka i własna technika.',
    heading: 'Agencja eventowa Olsztyn',
    lead: 'Organizujesz spotkanie firmy, integrację lub jubileusz w Olsztynie? W MAVINCI łączymy koncepcję, scenariusz i koordynację z programem artystycznym oraz własnym zapleczem technicznym. Przygotujmy wydarzenie, które odpowie na cel Twojego zespołu.',
    localHeading: 'Agencja z Olsztyna, jeden plan dla Twojego wydarzenia',
    localText: 'Nasze biuro i magazyn znajdują się przy ul. Towarowej 20B w Olsztynie. Możemy zaplanować wydarzenie w mieście albo wyjazdowy program na Warmii i Mazurach. Zaczynamy od uczestników, celu i dostępnego czasu — wybór atrakcji jest kolejnym krokiem.\nDla konferencji z wieczorną integracją ustalamy przejście od wystąpień do swobodnej części spotkania. Dla jubileuszu najważniejsze mogą być prowadzenie, wręczenie nagród i oprawa artystyczna. Jeśli program ma wyjść w plener, omawiamy warunki miejsca i wariant programu na zmianę pogody. W Olsztynie nasze portfolio obejmuje m.in. konferencję PSRWN w Hotelu Przystań i technikę wydarzenia Miejska by Night na Plaży Miejskiej.',
    checks: ['Olsztyn czy obiekt wyjazdowy na Warmii i Mazurach? Ustalmy czas uczestników i dojazd.', 'Czy plan obejmuje spotkanie biznesowe, wspólną zabawę czy oba etapy?', 'Co zapewnia miejsce wydarzenia, a co ma przygotować zespół MAVINCI?'],
    scenarios: [
      { title: 'Spotkanie firmowe z wieczorną integracją', description: 'Połącz część podsumowującą lub szkoleniową z luźniejszym programem. Quiz, teleturniej, muzyka i prowadzenie pomagają płynnie przejść do wspólnego wieczoru.' },
      { title: 'Jubileusz firmy i gala w Olsztynie', description: 'Ułóżmy momenty, które mają wybrzmieć: historia firmy, wyróżnienia i podziękowania. Dopasujemy do nich scenariusz, multimedia, światło oraz oprawę muzyczną.' },
      { title: 'Event na Warmii i Mazurach', description: 'Dla programu w hotelu lub plenerze ustalamy strefy, czas atrakcji i logistykę ekipy. Część dzienną oraz wieczorną planujemy z uwzględnieniem obiektu i dostępnego budżetu.' },
    ], faq: questions('w Olsztynie'),
  } },
  { slug: 'gdansk', name: 'Gdańsk', location: 'w Gdańsku', region: 'Gdańsk i Trójmiasto', content: {
    title: 'Agencja eventowa Gdańsk — eventy firmowe | MAVINCI',
    description: 'MAVINCI: organizacja eventów firmowych w Gdańsku i Trójmieście. Koncepcja, integracje, konferencje, gale oraz oprawa artystyczna i techniczna.',
    heading: 'Agencja eventowa Gdańsk',
    lead: 'Zaplanuj z MAVINCI wydarzenie firmowe w Gdańsku: od pomysłu i programu po koordynację, scenę i oprawę wieczoru. Łączymy organizację eventów, konferencji i integracji z własną techniką oraz rozrywką dopasowaną do uczestników.',
    localHeading: 'Event w Gdańsku i Trójmieście — od celu do planu produkcji',
    localText: 'Spotkanie z klientami, konferencja i integracja zespołu potrzebują innego programu. Dla wydarzenia w Gdańsku ustalamy najpierw odbiorców i cel, a potem scenariusz, prowadzenie oraz zakres oprawy. Wybór przestrzeni ma wspierać ten plan: prezentację marki, wystąpienia albo swobodne rozmowy.\nJeżeli goście lub punkty programu są rozdzieleni między Gdańsk, Gdynię i Sopot, uwzględnijmy czas przejazdów i godziny dostępu do obiektów. Przy części plenerowej potrzebny jest uzgodniony wariant na zmianę pogody. Zespół i technikę przygotowujemy z naszego zaplecza w Olsztynie; transport, montaż oraz obsadę opisujemy w ofercie. Portfolio poniżej pokazuje rzeczywiste projekty MAVINCI i nasz zakres pracy.',
    checks: ['Jedno miejsce czy program w kilku punktach Trójmiasta?', 'Goście lokalni czy uczestnicy przyjeżdżający na kilka dni?', 'Czy motyw wieczoru ma nawiązywać do marki, jubileuszu lub części konferencyjnej?'],
    scenarios: [
      { title: 'Konferencja z networkingiem i wieczorem firmowym', description: 'Uzgadniamy rytm wystąpień, przerw i spotkań gości. Wieczorny program może kontynuować temat wydarzenia poprzez muzykę, teleturniej lub wspólny motyw scenograficzny.' },
      { title: 'Gala i prezentacja marki w Gdańsku', description: 'Przygotowujemy scenariusz ważnych momentów, multimedia, prowadzenie i oprawę artystyczną. Ekrany i światło wspierają przekaz marki oraz pracę osób na scenie.' },
      { title: 'Integracja w Trójmieście', description: 'Dopasowujemy czas i formę zabawy do grupy. Możemy połączyć wieczór tematyczny, quizy, muzykę i strefę kasyna eventowego; lokalizacje i transport ustalamy dla wybranego programu.' },
    ], faq: [
      { question: 'Czy MAVINCI ma biuro w Gdańsku?', answer: 'Nasze biuro i magazyn znajdują się w Olsztynie. Obsługujemy również wydarzenia w Gdańsku i Trójmieście; dojazd, przygotowanie miejsca i pracę zespołu określamy w indywidualnej ofercie.' },
      ...questions('w Gdańsku').filter(item => item.question !== 'Gdzie znajduje się biuro MAVINCI?'),
    ],
  } },
  { slug: 'wroclaw', name: 'Wrocław', location: 'we Wrocławiu', region: 'Wrocław i Dolny Śląsk', content: {
    title: 'Agencja eventowa Wrocław — organizacja imprez | MAVINCI',
    description: 'Organizacja eventów firmowych we Wrocławiu z MAVINCI. Scenariusz, integracje, gale, konferencje, koordynacja oraz własna oprawa techniczna.',
    heading: 'Agencja eventowa Wrocław',
    lead: 'Szukasz agencji do wydarzenia firmowego we Wrocławiu? MAVINCI przygotuje koncepcję, program i zakres realizacji, łącząc koordynację z oprawą artystyczną oraz własnym zapleczem technicznym. Zacznijmy od celu spotkania i oczekiwań Twoich gości.',
    localHeading: 'Wrocław — spójna produkcja dla firmy i jej gości',
    localText: 'Przy wydarzeniu we Wrocławiu warto na początku rozdzielić potrzeby organizatora i uczestników: prezentację wyników, rozmowy z klientami, wspólne świętowanie albo integrację zespołów z różnych oddziałów. Na tej podstawie dobieramy format, prowadzenie i czas poszczególnych części.\nJeśli program jest kilkudniowy, planujemy osobno dzień biznesowy i wieczór. Ustalamy z obiektem dostęp ekipy, przechowanie sprzętu, próby oraz przejścia między strefami. Logistykę zespołu z Olsztyna, transport techniki i ewentualne dodatkowe potrzeby wyjazdowe uwzględniamy w ofercie. Dzięki temu przed decyzją znasz zakres produkcji i podział zadań.',
    checks: ['Wydarzenie dla jednego zespołu czy spotkanie oddziałów i zaproszonych klientów?', 'Program jednodniowy czy kilka etapów z noclegami i zmianami sal?', 'Jaki efekt ma zostać po evencie: relacje, wiedza, prezentacja marki czy wspólne świętowanie?'],
    scenarios: [
      { title: 'Spotkanie zespołów i integracja we Wrocławiu', description: 'Program dobieramy do osób, które znają się z codziennej pracy albo dopiero się spotykają. Teleturniej, prowadzenie i muzyka mogą łączyć gości w angażujący, wspólny wieczór.' },
      { title: 'Konferencja z finałową galą', description: 'Łączymy scenariusz części merytorycznej z wyróżnieniami i wieczorną oprawą. Uzgadniamy technikę, materiały, kolejność wystąpień oraz pracę realizatorów.' },
      { title: 'Jubileusz lub premiera dla klientów', description: 'Budujemy program wokół komunikatu firmy. Oprawa sceny, obraz, prowadzący i elementy artystyczne mają wspierać moment prezentacji oraz dalsze spotkanie gości.' },
    ], faq: [
      { question: 'Czy realizujecie wydarzenia we Wrocławiu mimo bazy w Olsztynie?', answer: 'Tak, przyjmujemy zapytania o wydarzenia we Wrocławiu i innych regionach Polski. Dostępność zespołu, zakres, transport, montaż oraz warunki pracy ustalamy dla daty i obiektu. Nie prowadzimy biura we Wrocławiu.' },
      ...questions('we Wrocławiu').filter(item => item.question !== 'Gdzie znajduje się biuro MAVINCI?'),
    ],
  } },
];

export const agencyProcess = [
  { title: 'Cel i brief', text: 'Poznajemy firmę, uczestników, termin i budżet. Ustalamy, co ma osiągnąć wydarzenie.' },
  { title: 'Koncepcja i oferta', text: 'Proponujemy format, program i oprawę. Rozpisujemy zakres, koszt i podział zadań.' },
  { title: 'Przygotowanie', text: 'Uzgadniamy scenariusz, zespół, materiały, wymagania miejsca oraz harmonogram prób.' },
  { title: 'Realizacja', text: 'Koordynujemy uzgodniony zakres na miejscu: pracę ekipy, program, technikę i część artystyczną.' },
];

/** Only supported editorial fields are accepted; arbitrary JSON-LD cannot override brand facts. */
export function resolveAgencyContent(defaults: AgencyContent, value: unknown): AgencyContent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults;
  const source = value as Record<string, unknown>;
  const text = (key: keyof AgencyContent): string => typeof source[key] === 'string' && (source[key] as string).trim() ? (source[key] as string).trim() : defaults[key] as string;
  const checks = Array.isArray(source.checks) ? source.checks.filter((item): item is string => typeof item === 'string' && !!item.trim()) : [];
  const scenarios = Array.isArray(source.scenarios) ? source.scenarios.flatMap(item => item && typeof item.title === 'string' && typeof item.description === 'string' && item.title.trim() && item.description.trim() ? [{ title: item.title.trim(), description: item.description.trim() }] : []) : [];
  const faq = Array.isArray(source.faq) ? source.faq.flatMap(item => item && typeof item.question === 'string' && typeof item.answer === 'string' && item.question.trim() && item.answer.trim() ? [{ question: item.question.trim(), answer: item.answer.trim() }] : []) : [];
  return { title: text('title'), description: text('description'), heading: text('heading'), lead: text('lead'),
    localHeading: text('localHeading'), localText: text('localText'), checks: checks.length ? checks : defaults.checks,
    scenarios: scenarios.length ? scenarios : defaults.scenarios, faq: faq.length ? faq : defaults.faq };
}
