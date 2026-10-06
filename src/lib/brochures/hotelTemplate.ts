import { pageDefaults, parseComposer, type BrochureDecorativePage, type BrochureLayout, type BrochurePageDesign } from './decorativePages';
import type { BrochureIcon } from './brochureIcons';

// Product IDs are stable; uploaded image filenames change when an image is replaced.
export const HOTEL_TEMPLATE_PRODUCT_IDS = {
  audio: '19845058-0541-43c9-a222-f46fe0f327e7',
  led: '137230df-baf9-41af-8ee8-ff6b18148668',
  lighting: 'c72a5567-18a1-40c8-b1ee-858ff6ce20f6',
  stage: 'be81ab60-9ca7-4429-af94-b7068f8e9530',
  photo: '9233cd77-6da4-4990-b914-f3c0a924f3e0',
  film: '2c595604-4691-4a5f-bc08-842ae3db9423',
  decor: '01fc20bf-22cf-4fd5-85e2-c72459e42d09',
} as const;

const publicImages = {
  "cover": {
    "imagePath": "https://fuuljhhuhfojtmmfmskq.supabase.co/storage/v1/object/public/site-images/hero/1783012675339-nqz2s.jpg",
    "imageBucket": "offer-product-pages"
  },
  "conference": {
    "imagePath": "https://fuuljhhuhfojtmmfmskq.supabase.co/storage/v1/object/public/site-images/portfolio/1760445471262-s56khr.jpg",
    "imageBucket": "offer-product-pages"
  },
  "streaming": {
    "imagePath": "https://fuuljhhuhfojtmmfmskq.supabase.co/storage/v1/object/public/site-images/hero/1763729448600-s1wnyp.jpg",
    "imageBucket": "offer-product-pages"
  },
  "gala": {
    "imagePath": "https://fuuljhhuhfojtmmfmskq.supabase.co/storage/v1/object/public/site-images/portfolio/1760444737392-8anr9.jpg",
    "imageBucket": "offer-product-pages"
  },
  "dj": {
    "imagePath": "https://fuuljhhuhfojtmmfmskq.supabase.co/storage/v1/object/public/site-images/hero/1767628847854-qs8kik.jpg",
    "imageBucket": "offer-product-pages"
  },
  "theme": {
    "imagePath": "https://fuuljhhuhfojtmmfmskq.supabase.co/storage/v1/object/public/site-images/hero/1783086890397-t21x1.jpg",
    "imageBucket": "offer-product-pages"
  },
  "casino": {
    "imagePath": "https://fuuljhhuhfojtmmfmskq.supabase.co/storage/v1/object/public/site-images/hero/1763644219657-cqp939.jpg",
    "imageBucket": "offer-product-pages"
  },
  "integration": {
    "imagePath": "https://fuuljhhuhfojtmmfmskq.supabase.co/storage/v1/object/public/site-images/hero/1764184701335-zi74w9.jpg",
    "imageBucket": "offer-product-pages"
  },
  "quiz": {
    "imagePath": "https://fuuljhhuhfojtmmfmskq.supabase.co/storage/v1/object/public/site-images/hero/1763727772725-aqg8pu.jpg",
    "imageBucket": "offer-product-pages"
  },
} as const;
export const HOTEL_TEMPLATE_PAGE_COUNT = 24;

export function createHotelBrochureTemplate(productImages: Record<string, string>) {
  const productImage = (id: string) => ({ imagePath: productImages[id] || '', imageBucket: 'offer-product-pages' as const });
  const images = {
    ...publicImages,
    audio: productImage(HOTEL_TEMPLATE_PRODUCT_IDS.audio),
    led: productImage(HOTEL_TEMPLATE_PRODUCT_IDS.led),
    lighting: productImage(HOTEL_TEMPLATE_PRODUCT_IDS.lighting),
    stage: productImage(HOTEL_TEMPLATE_PRODUCT_IDS.stage),
    photo: productImage(HOTEL_TEMPLATE_PRODUCT_IDS.photo),
    film: productImage(HOTEL_TEMPLATE_PRODUCT_IDS.film),
    decor: productImage(HOTEL_TEMPLATE_PRODUCT_IDS.decor),
  };
  const page = (layout: BrochureLayout, slogan: string, caption: string, options: Partial<BrochureDecorativePage> = {}, design: Partial<BrochurePageDesign> = {}): BrochureDecorativePage => ({
    id: crypto.randomUUID(), layout, slogan, caption, imagePath: '', imageBucket: 'offer-product-pages', imagePosition: 50,
    afterItemId: null, isVisible: true, ...options, design: { ...pageDefaults(layout), ...design },
  });
  const cards = (slogan: string, caption: string, points: string[], pointIcons: BrochureIcon[], eyebrow: string, dark = false) => page('features', slogan, caption, { points, pointIcons, eyebrow, icon: pointIcons[0] }, { showBrand: false, theme: dark ? 'dark' : 'light', ornament: dark ? 'arc' : 'grid', text: { x: 10, y: 10, width: 80, height: 27 }, details: { x: 10, y: 41, width: 80, height: 47 }, fontSize: 33 });
  const service = (slogan: string, caption: string, image: keyof typeof images, points: string[], pointIcons: BrochureIcon[], eyebrow: string, design: Partial<BrochurePageDesign> = {}) => page('showcase', slogan, caption, { ...images[image], points, pointIcons, eyebrow, icon: pointIcons[0] }, { ornament: 'arc', ...design });
  const timeline = (slogan: string, caption: string, points: string[], pointIcons: BrochureIcon[], eyebrow: string, dark = false) => page('timeline', slogan, caption, { points, pointIcons, eyebrow, icon: 'route' }, { theme: dark ? 'dark' : 'light', ornament: 'arc', text: { x: 10, y: 10, width: 80, height: 24 }, details: { x: 10, y: 38, width: 80, height: 51 }, fontSize: 34 });
  const pages = [
    // 01 - the cover remains freely editable in Studio stron.
    page('signature', 'Wasza przestrzeń.\nNasza scena.', 'Tworzymy wydarzenia, dla których goście chcą wracać.\nTechnika, oprawa i atrakcje dla hoteli.', { ...images.lighting, eyebrow: 'Partner hotelowych wydarzeń', points: ['Konferencje', 'Gale i bankiety', 'Integracje'], pointIcons: ['mic', 'sparkles', 'people'] }),
    // 02
    cards('Jedna przestrzeń. Więcej scenariuszy.', 'Pomagamy poszerzyć ofertę hotelu o wydarzenia, które łączą sprawną technikę, oprawę i angażujący program. Zakres dobieramy do obiektu, oczekiwań organizatora oraz budżetu.', [
      'Szersza oferta | Konferencje, bankiety i integracje jako uzupełnienie pobytu grup.',
      'Wsparcie handlowca | Czytelne propozycje usług i materiały do rozmowy z klientem.',
      'Spójna realizacja | Technika, oprawa i zespół dopasowane do uzgodnionego programu.',
      'Jasne ustalenia | Plan montażu, kontakt i odpowiedzialności ustalone przed wydarzeniem.',
    ], ['building','briefcase','check','chat'], 'Współpraca z hotelami'),
    // 03
    cards('Od konferencji po wieczorną galę.', 'Dobieramy rozwiązania do kolejnych części wydarzenia. Hotel może przedstawić organizatorowi zarówno obsługę spotkania, jak i propozycję wieczoru czy integracji.', [
      'Konferencje | Dźwięk, prezentacje, scena i obsługa prelegentów.',
      'Gale i bankiety | Światło, prowadzenie oraz oprawa muzyczna.',
      'Wieczory tematyczne | Motyw, scenografia i dobrane atrakcje.',
      'Integracje | Zadania drużynowe i wspólne doświadczenia.',
      'Rozrywka | Teleturnieje multimedialne, quizy i kasyno eventowe.',
      'Materiały i sprzedaż | Fotografia, film oraz strefa sprzedawcy.',
    ], ['mic','trophy','sparkles','people','game','file'], 'Mapa możliwości', true),
    // 04
    service('Konferencja, która działa.', 'Techniczna obsługa spotkań biznesowych, szkoleń i paneli. Łączymy dźwięk, obraz i wsparcie na sali, aby organizator mógł skupić się na programie.', 'conference', [
      'Mowa | Mikrofony i nagłośnienie dobrane do sali.',
      'Prezentacje | Ekrany, projekcja oraz obsługa materiałów.',
      'Realizacja | Bieżące wsparcie programu i występujących.',
    ], ['mic','screen','check'], 'Konferencje'),
    // 05
    service('Dźwięk, który dociera.', 'Od kameralnego szkolenia po większe wydarzenie. Dobieramy system nagłośnienia, mikrofony i realizację do układu sali, liczby uczestników oraz formatu spotkania.', 'audio', [
      'Systemy audio | Zestawy point source i rozwiązania line array.',
      'Mikrofony | Bezprzewodowe oraz konferencyjne z gęsią szyją.',
      'Realizator | Kontrola dźwięku podczas uzgodnionego programu.',
    ], ['sound','mic','people'], 'Nagłośnienie', { theme: 'dark' }),
    // 06
    service('Obraz w odpowiedniej skali.', 'Prezentacje, filmy i identyfikacja wydarzenia mogą stać się czytelnym elementem przestrzeni. Format ekranu dobieramy do treści, sali i widoczności dla gości.', 'led', [
      'Ekrany LED | Modułowe konfiguracje i format 2 × 3 m.',
      'Projekcja | Projektor Full HD i ekran o szerokości 3 m.',
      'Telewizory | Ekrany 65 i 85 cali oraz totem multimedialny.',
    ], ['screen','light','building'], 'Multimedia'),
    // 07
    service('Światło zmienia przestrzeń.', 'Oświetlenie podkreśla architekturę hotelu, buduje atmosferę i prowadzi uwagę uczestników. Dopasowujemy je do wystąpień, bankietu oraz części tanecznej.', 'lighting', [
      'Scena | Oświetlenie gal i konferencji z realizacją.',
      'Sala | Dekoracja światłem i oprawy Portman P1 Evo.',
      'Personalizacja | Projekcja logo lub motywu przez projektor Gobo.',
    ], ['light','sparkles','building'], 'Oświetlenie', { theme: 'dark' }),
    // 08
    service('Dobra scena dla programu.', 'Podest porządkuje przestrzeń wystąpień i poprawia widoczność mówców. Układ sceny oraz zaplecze techniczne planujemy w odniesieniu do sali i harmonogramu.', 'stage', [
      'Podesty | Modułowe rozwiązania dopasowane do przestrzeni.',
      'Ustawienie | Widoczność, miejsce dla prelegentów i ekranu.',
      'Przygotowanie | Montaż oraz ustalenia z zespołem obiektu.',
    ], ['stage','people','clock'], 'Technika sceniczna', { imageFit: 'contain' }),
    // 09
    service('Wydarzenie także online.', 'Streaming pozwala włączyć osoby, które uczestniczą zdalnie. Łączymy obraz z kamer, prezentacje i dźwięk w transmisję dopasowaną do formatu wydarzenia.', 'streaming', [
      'Kamery | Obraz pokazujący prelegentów i przebieg spotkania.',
      'Multimedia | Prezentacje i plansze w programie transmisji.',
      'Obsługa | Uzgodnienie warunków i realizacja techniczna.',
    ], ['camera','screen','check'], 'Streaming'),
    // 10
    timeline('Dzień konferencji. Krok po kroku.', 'Przykładowa ścieżka pracy. Godziny i zakres każdorazowo uzgadniamy z organizatorem oraz hotelem.', [
      'Przygotowanie sali | Montaż sprzętu i sprawdzenie ustawienia sceny oraz ekranów.',
      'Próba techniczna | Kontrola mikrofonów, prezentacji i kolejności materiałów.',
      'Program wydarzenia | Bieżąca realizacja dźwięku i obrazu oraz wsparcie występujących.',
      'Zakończenie | Uzgodniony demontaż i przekazanie przestrzeni zespołowi hotelu.',
    ], ['stage','mic','screen','check'], 'Przykładowy harmonogram', true),
    // 11
    page('photo', 'Gala z odpowiednią oprawą.', 'Jubileusz, bankiet lub wręczenie nagród. Łączymy światło, multimedia, prowadzenie i muzykę w spójny przebieg wieczoru.', { ...images.gala, eyebrow: 'Gale i bankiety', icon: 'trophy' },
      { showBrand: false, image: { x: 0, y: 0, width: 100, height: 58 }, text: { x: 10, y: 64, width: 80, height: 25 }, fontSize: 37, overlay: 10 }),
    // 12
    service('Muzyka i prowadzenie.', 'Od tła podczas przyjęcia po dynamiczny finał na parkiecie. Dobieramy oprawę muzyczną i sposób prowadzenia do charakteru wydarzenia oraz uczestników.', 'dj', [
      'DJ eventowy | Repertuar i oprawa dopasowane do formuły wieczoru.',
      'Na żywo | Saksofonista, Warmia Swing lub występ szantowy.',
      'Na scenie | Konferansjer, stand-up lub pokaz iluzji.',
    ], ['music','sound','mic'], 'Oprawa artystyczna'),
    // 13
    service('Wieczór z własną historią.', 'Motyw przewodni łączy scenografię, muzykę i atrakcje. Tworzymy propozycję wieczoru, którą hotel może przedstawić jako rozwinięcie pobytu grupy.', 'theme', [
      'Gatsby | Inspiracje latami 20. i elegancką oprawą.',
      'Las Vegas | Klimat kasyna i towarzyska rozrywka.',
      'Hollywood | Filmowa scenografia i oprawa gali.',
    ], ['sparkles','casino','trophy'], 'Wieczory tematyczne', { theme: 'dark' }),
    // 14
    service('Kasyno jako atrakcja wieczoru.', 'Strefa kasynowa uzupełnia bankiet, galę lub imprezę firmową. Stoły, krupierzy i scenografia tworzą miejsce spotkań oraz towarzyskich emocji.', 'casino', [
      'Stoły | Ruletka, blackjack i poker w formule eventowej.',
      'Obsługa | Krupierzy wspierający uczestników przy stołach.',
      'Aranżacja | Zakres strefy dobrany do przestrzeni i programu.',
    ], ['casino','people','building'], 'Atrakcje eventowe'),
    // 15
    service('Integracja przez działanie.', 'Wspólne zadania pomagają zaangażować grupę poza salą konferencyjną. Dobieramy scenariusz do przestrzeni hotelu, czasu oraz charakteru uczestników.', 'integration', [
      'Współpraca | Megaklucz, Zębate Koła i Operacja Kaczka.',
      'Komunikacja | Ślepe Abecadło, Memo i Zagadka Einsteina.',
      'Przygoda | Scenariusz Indiana Jones lub gra Tic Tac Toe.',
    ], ['people','chat','game'], 'Integracje i teambuilding'),
    // 16
    service('Teleturniej, który łączy gości.', 'Interaktywne quizy i zadania drużynowe wprowadzają energię do programu. Formułę oraz sposób prowadzenia dopasowujemy do uczestników i wydarzenia.', 'quiz', [
      'Rywalizacja | Drużyny, punkty i wspólny cel.',
      'Mavimbury | Autorski teleturniej zespołowy z humorem.',
      'Realizacja | Prowadzenie i uzgodnione zaplecze techniczne.',
    ], ['game','trophy','mic'], 'Quizy i teleturnieje', { theme: 'dark' }),
    // 17
    cards('Naciśnij. Odpowiedz. Wygraj.', 'Teleturnieje multimedialne zmieniają hotelową salę w przestrzeń wspólnej rywalizacji. Dobieramy sposób odpowiadania i tempo gry do grupy, scenariusza oraz programu wydarzenia.', [
      'Buzzery | Dynamiczne zgłoszenia do odpowiedzi i emocje przy stanowiskach.',
      'Piloty do głosowania | Quiz angażujący większą grupę i wspólne odpowiedzi.',
      'Stanowiska drużynowe | Rozgrywki w formule inspirowanej Familiadą.',
      'Rywalizacja indywidualna | Stanowiska do formuły inspirowanej „1 z 10”.',
    ], ['game','people','chat','trophy'], 'Quizy i teleturnieje multimedialne'),
    // 18
    service('Fotostrefa pełna wspomnień.', 'Dodatkowe miejsce do zdjęć daje gościom pretekst do wspólnej zabawy. Dobieramy formę atrakcji i oprawę do charakteru wydarzenia oraz hotelowej przestrzeni.', 'photo', [
      'Fotolustro | Interaktywna atrakcja fotograficzna dla gości.',
      'Fotobox Magazine | Personalizowana przestrzeń w stylu okładki.',
      'Scenografia | Ścianka i dekoracje dopasowane do motywu.',
    ], ['camera','file','sparkles'], 'Atrakcje fotograficzne'),
    // 19
    page('editorial', 'Materiały, które zostają.', 'Fotoreportaż dokumentuje najważniejsze momenty wydarzenia. Krótka rolka wideo pozwala wrócić do atmosfery spotkania.\n\nPrzed realizacją uzgadniamy zakres materiału, kluczowe ujęcia i sposób przekazania.', { ...images.film, eyebrow: 'Fotografia i film', icon: 'camera' },
      { showBrand: false, ornament: 'arc', image: { x: 10, y: 43, width: 80, height: 38 }, text: { x: 10, y: 11, width: 80, height: 28 }, imageFit: 'contain', fontSize: 34 }),
    // 20
    service('Spójna aranżacja wydarzenia.', 'Dekoracje porządkują wizualnie przestrzeń i podkreślają motyw spotkania. Zakres dobieramy do wnętrza hotelu oraz pozostałych elementów oprawy.', 'decor', [
      'Sala i stoły | Dekoracje, aranżacje stołów i dobrane detale.',
      'Strefy zdjęć | Ścianki oraz elementy tematyczne.',
      'Świetlne akcenty | Neony, dekoracja światłem i projekcja Gobo.',
    ], ['building','camera','light'], 'Dekoracje i scenografia'),
    // Two early pages explain the sales tool before the service catalogue.
    { ...cards('Twoja marka. Większa oferta. Jeden partner.', 'Klient pyta o konferencję, galę lub integrację? Połącz ofertę swojego hotelu lub agencji z usługami Mavinci. Pokaż klientowi gotowy PDF z własnym logo i kolorami, a szczegóły realizacji uzgodnij ze swoim opiekunem.', [
      'Twoja marka | Logo, kolory organizacji i wizytówka sprzedawcy na dokumencie dla klienta.',
      'Katalog pod ręką | Usługi i warianty udostępnione Twojej organizacji w jednym miejscu.',
      'Mniej przepisywania | Zebrany zakres zamieniasz w ofertę PDF bez składania dokumentu od początku.',
      'Wsparcie realizacji | Ustalenia z opiekunem Mavinci pomagają przejść od propozycji do wydarzenia.',
    ], ['building','briefcase','file','chat'], 'Strefa sprzedawcy'), linkLabel: 'Wypróbuj demo — stwórz własną ofertę', linkUrl: 'https://mavinci.pl/demo-sprzedawcy/{{broszura}}', linkHint: 'Bez logowania. Twoje logo i kolory. Przykładowy PDF do pobrania.', design: { ...pageDefaults('features'), showBrand: false, fontSize: 33, ornament: 'arc', text: { x: 10, y: 9, width: 80, height: 25 }, details: { x: 10, y: 37, width: 80, height: 54 } } },
    { ...timeline('Twoja pierwsza oferta. Wypróbuj na żywo.', 'Bez logowania i bez obowiązkowych danych. Podgląd reaguje na wpisywany tekst, logo oraz kolory. Demo zawiera 3 stałe usługi bez cen; szerszy katalog otrzymasz po rozpoczęciu współpracy.', [
      'Wizytówka | Opcjonalnie wpisz swoje imię, nazwę organizacji i kontakt.',
      'Twoja identyfikacja | Dodaj logo i ustaw kolory. Od razu zobaczysz efekt personalizacji.',
      'Przykładowy zakres | DJ eventowy, konferencja i ekran LED pokazują sposób prezentacji usług.',
      'Gotowy PDF | „Sprawdź ofertę” pobiera dokument bez przechodzenia do innej strony.',
    ], ['chat','sparkles','briefcase','file'], 'Sprawdź, jak działa'), linkLabel: 'Otwórz demo i pobierz przykładową ofertę', linkUrl: 'https://mavinci.pl/demo-sprzedawcy/{{broszura}}', linkHint: 'Zobacz swoją markę na gotowej ofercie. Wypróbuj bez logowania.', design: { ...pageDefaults('timeline'), showBrand: false, fontSize: 32, text: { x: 10, y: 9, width: 80, height: 26 }, details: { x: 10, y: 39, width: 80, height: 51 }, ornament: 'arc' } },
    // 23
    timeline('Współpraca w czterech krokach.', 'Możemy zacząć od jednego wydarzenia i wspólnie opracować sposób obsługi kolejnych zapytań. Najpierw poznajemy potrzeby obiektu.', [
      'Rozmowa o hotelu | Omawiamy przestrzenie, typy wydarzeń i potrzeby działu sprzedaży.',
      'Propozycja zakresu | Dobieramy technikę, atrakcje oraz sposób przygotowania ofert.',
      'Plan wydarzenia | Ustalamy harmonogram, montaż i osoby kontaktowe.',
      'Realizacja i wnioski | Prowadzimy uzgodnioną obsługę i omawiamy kolejne potrzeby.',
    ], ['building','file','clock','check'], 'Następny krok', true),
  ];
  const orderedPages = [pages[0], pages[20], pages[21], ...pages.slice(1,20), pages[22]];
  return {
    name: 'Hotele — możliwości i współpraca z Mavinci', title: 'Więcej możliwości dla Twojego hotelu', subtitle: 'Technika · oprawa · atrakcje · wsparcie sprzedaży',
    audience_type: 'hotel', organization_id: null, introduction: null,
    closing_text: 'Opowiedz nam o swoim obiekcie i wydarzeniach, które chcesz oferować. Przygotujemy propozycję współpracy oraz omówimy dostęp do strefy sprzedawcy.\n\nMavinci · technika, oprawa i atrakcje dla hotelowych wydarzeń.',
    brand_config: {
      template_id: 'hotels-v3', seller_demo_enabled: true, decorative_pages: orderedPages,
      composer: { ...parseComposer(null), brandColor: '#650026', accentColor: '#d3bb73', hiddenPages: ['cover', 'intro'], pageOrder: [...orderedPages.map((p) => `decorative:${p.id}`), 'closing', 'cover', 'intro'] },
    },
  };
}
