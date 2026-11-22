import type { HelpManual } from './helpTypes';

/**
 * Instrukcja „Prezentacji” (Strefa sprzedawcy) — znak „?” w CRM, „Instrukcja” na Macu i w aplikacji mobilnej.
 * Kopia 1:1: src/lib/help/presentationsHelp.ts ↔ mobile/src/lib/presentationsHelp.ts (scripts/ci/check-shared-copies.mjs).
 * Przykładowa karta z rozdziału „Przykład” to `SHOWCASE_EXAMPLE` w `src/lib/showcase/showcaseShared.ts`
 * („Utwórz kartę z przykładu” w CRM i na Macu).
 */
export const PRESENTATIONS_HELP: HelpManual = {
  audience: 'presentations',
  title: 'Prezentacje — instrukcja',
  chapters: [
    {
      id: 'start',
      title: 'Jak działa pokaz',
      summary: 'Prezentacje to materiały na spotkanie z klientem: działy, w nich karty produktów. Klient ogląda je na iPadzie jak katalog.',
      steps: [
        'Utwórz dział, np. „Atrakcje weselne”, i dodaj okładkę z bazy zdjęć.',
        'W dziale dodaj karty — najlepiej „Z produktu z katalogu”.',
        'Uzupełnij kartę według listy kontrolnej w edytorze.',
        'Sprawdź ją przyciskiem „Podgląd na iPadzie”.',
        'Pokaż kartę, gdy jest gotowa — przełącznik „Widoczna na spotkaniach”.',
      ],
      notes: [
        'Opis, warianty, ceny i pakiety karta czyta na bieżąco z Oferty → Produkty. Zmiana w katalogu od razu zmienia pokaz.',
        'Puste i ukryte bloki nie pokazują się klientowi.',
      ],
    },
    {
      id: 'karta',
      title: 'Treściwa karta w 7 krokach',
      summary: 'Jedna karta to jeden produkt albo usługa. Klient ma w minutę zrozumieć, co dostaje, jak to wygląda i ile kosztuje.',
      steps: [
        'Tytuł: nazwa, którą klient zrozumie bez wyjaśnień, np. „Ciężki dym na pierwszy taniec”.',
        'Hasło: jedno zdanie z najważniejszą korzyścią, nie opis techniczny.',
        'Wstęp: 1–3 zdania — co klient dostaje i dlaczego warto.',
        'Zdjęcie główne i blok „Jak to wygląda”: 2–3 duże zdjęcia z prawdziwych realizacji.',
        'Korzyści: 3–5 punktów z konkretem — czas, wymiar, bezpieczeństwo, efekt dla gości.',
        'Warianty i ceny z katalogu, potem „Jak przygotowujemy” i wymagania obiektu.',
        'Pytania klientów: 3–6 pytań, które słyszysz najczęściej, z krótkimi odpowiedziami.',
      ],
      notes: [
        'Pisz językiem klienta: „para tańczy na chmurze”, a nie „wytwornica CO₂ o mocy…”.',
        'Konkret przekonuje: „gotowe w 15 minut”, „do 40 cm nad parkietem”.',
        'Galeria na końcu: 6–12 zdjęć z różnych sal — klient znajdzie podobne miejsce.',
      ],
    },
    {
      id: 'przyklad',
      title: 'Przykład: „Ciężki dym — pierwszy taniec w chmurach”',
      summary: 'Gotowa karta do obejrzenia i przerobienia. „Utwórz kartę z przykładu” dodaje ją jako ukrytą — uzupełnij zdjęcia i produkt.',
      steps: [
        'Hasło: „Gęsta, nisko ścieląca się chmura, która nie unosi się i nie uruchamia czujek”.',
        'Wstęp: para tańczy na chmurze, goście robią zdjęcia, efekt trwa 3–4 minuty i nie zostawia śladów.',
        'Korzyści: zdjęcia, które goście udostępniają; bezpieczny dla sali i czujek; gotowe w 15 minut.',
        'Warianty i ceny: z produktu w katalogu — wybierz produkt w bloku „Z katalogu produktów”.',
        'Jak przygotowujemy: ustalamy moment z DJ-em, przygotowujemy urządzenie, efekt na sygnał.',
        'Specyfikacja: czas efektu, wysokość chmury, zasilanie, czas przygotowania.',
        'Pytania klientów: czujki, śliski parkiet, pokaz na zewnątrz.',
      ],
      notes: [
        'Karta z przykładu jest ukryta do czasu, aż dodasz zdjęcia i włączysz ją przełącznikiem.',
        'Tę samą strukturę zastosuj do każdego produktu — klient szybko uczy się, gdzie czego szukać.',
      ],
    },
    {
      id: 'zdjecia',
      title: 'Zdjęcia: baza zdjęć i albumy',
      summary: 'Główna baza zdjęć to Materiały → marka → Zdjęcia. Karta trzyma odnośnik do zdjęcia, bez kopii pliku.',
      steps: [
        'Kliknij „Wybierz…” przy zdjęciu głównym albo w bloku zdjęć.',
        'Baza zdjęć: wybierz z wszystkich zdjęć albo z albumu.',
        '„Wgraj z dysku” albo przeciągnij pliki z Findera — trafią do Materiałów → Zdjęcia.',
        'Produkty i Realizacje: wybierz z listy, potem zdjęcia produktu albo realizacji.',
        'Album utworzysz w Materiałach albo w oknie wyboru („+”) — przeciągaj na niego zdjęcia.',
      ],
      notes: [
        'Ten sam plik wgrany drugi raz nie tworzy duplikatu.',
        'Album to odnośniki: usunięcie z albumu nie usuwa pliku z Materiałów.',
        'Do pokazu serwer przygotowuje lekką wersję zdjęcia — iPad ładuje je szybko.',
      ],
    },
    {
      id: 'ai',
      title: 'Asystent AI',
      summary: 'Po dodaniu produktu asystent proponuje hasło, wstęp, korzyści, kroki, specyfikację i pytania klientów.',
      steps: [
        'W edytorze karty kliknij „Asystent AI”.',
        'Zaznacz, co ma przygotować, i dopisz, co chcesz podkreślić.',
        'Przejrzyj propozycje i wybierz, które wstawić.',
        'Popraw tekst po swojemu i zapisz kartę.',
      ],
      notes: [
        'Asystent pisze tylko z danych produktu w katalogu i Twojego opisu — nie wymyśla cen ani wymiarów.',
        'Im lepszy opis produktu w Oferty → Produkty, tym lepsze propozycje.',
      ],
    },
    {
      id: 'pokaz',
      title: 'Na spotkaniu',
      summary: 'Pokaz działa w CRM na iPadzie (Safari), w aplikacji na Macu i w aplikacji mobilnej. Ceny są ukryte do odsłonięcia.',
      steps: [
        'Przesunięcie w bok: sąsiedni dział, karta albo zdjęcie.',
        'Dotknięcie: wejście głębiej; „Wróć”: poziom wyżej.',
        'Przełącznik cen odsłania ceny jednym dotknięciem.',
        'Galeria otwiera zdjęcia na pełnym ekranie.',
      ],
    },
    {
      id: 'oferta',
      title: 'Oferta ze spotkania',
      summary: 'Klient mówi „chcę ofertę”: dodajesz pozycje, wybierasz klienta i od razu tworzysz ofertę z PDF.',
      steps: [
        '„Do oferty” przy wariancie albo pakiecie dodaje pozycję.',
        'W arkuszu „Oferta dla klienta” możesz też „Dodaj pozycję” z katalogu.',
        'Wybierz klienta z CRM albo wpisz nowego.',
        'Miejsce: wybierz z podpowiedzi z bazy lokalizacji albo wpisz własne.',
        'Ustaw rabat i kliknij „Utwórz ofertę i PDF”.',
      ],
      notes: [
        'Rabat powyżej progu: ofertę pokażesz od razu, a wyślesz po akceptacji.',
        'Szkic oferty zapisuje się na tym urządzeniu.',
      ],
    },
    {
      id: 'gdzie',
      title: 'Gdzie co jest: CRM, Mac, telefon',
      summary: 'Przygotowanie kart — w CRM i na Macu. Pokaz i oferta ze spotkania — wszędzie, także w telefonie.',
      steps: [
        'CRM: działy, karty, edytor z asystentem AI, baza zdjęć, podgląd iPada, oferta.',
        'Mac: to samo natywnie, z przeciąganiem zdjęć z Findera.',
        'Telefon i iPad: przegląd działów i kart, ceny, galeria, oferta ze spotkania, ta instrukcja.',
      ],
    },
  ],
  tips: {},
  chapterFor() {
    return 'start';
  },
};
