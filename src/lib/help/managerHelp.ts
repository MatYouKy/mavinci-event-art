import type { HelpManual } from './helpTypes';

/**
 * Instrukcja opiekuna sprzedawców (pracownik MAVINCI) — panel „?” w CRM na ekranach sprzedawców.
 * W etapie 4 wdrożenia ta sama treść trafi do aplikacji na Maca i mobilnej.
 */
export const MANAGER_HELP: HelpManual = {
  audience: 'manager',
  title: 'Instrukcja opiekuna sprzedawców',
  chapters: [
    {
      id: 'rola',
      title: 'Rola opiekuna i zastępcy',
      summary: 'Opiekun prowadzi hotel od zaproszenia do rozliczenia. Zastępca widzi te same sprawy, gdy opiekun jest niedostępny.',
      steps: [
        'Odpowiadasz na rozmowy i zapytania hotelu.',
        'Zatwierdzasz ceny spoza cennika i oceniasz oferty.',
        'Potwierdzasz termin i prowadzisz przygotowanie wydarzenia.',
        'Decydujesz, kiedy hotel zobaczy swoje wynagrodzenie.',
      ],
      notes: [
        'Hotel widzi Twoje imię, zdjęcie i telefon w portalu. Uzupełnij je w profilu pracownika.',
        'Opiekuna i zastępcę przypisuje administrator w karcie sprzedawcy.',
      ],
    },
    {
      id: 'os',
      title: 'Oś oferty w pięciu etapach',
      summary: 'Hotel i Ty widzicie tę samą oś: Oferta, U klienta, U opiekuna, Wydarzenie, Rozliczenie. Pod osią jest zdanie „Teraz”.',
      steps: [
        'Oferta — hotel przygotowuje ofertę w kreatorze.',
        'U klienta — hotel przekazuje PDF (zwykle jako wkładkę do swojej oferty) albo link.',
        'U opiekuna — hotel wysłał ofertę po zgodzie klienta. Teraz Twoja ocena.',
        'Wydarzenie — po przyjęciu oferty potwierdzasz termin i przygotowujecie realizację.',
        'Rozliczenie — po wydarzeniu rozliczasz wydarzenie i wynagrodzenie hotelu.',
      ],
      notes: ['W rozmowie z hotelem używaj nazw etapów z osi — hotel widzi dokładnie te same.'],
    },
    {
      id: 'nowy-sprzedawca',
      title: 'Nowy sprzedawca',
      summary: 'Formularz pokazuje w czterech krokach, czego brakuje do zapisu. Po zapisie „Gotowość do pracy” prowadzi przez resztę: sale, opiekuna, pierwsze logowanie.',
      steps: [
        'W karcie kontaktu lub organizacji wybierz „Mianuj sprzedawcą” (albo „Dodaj sprzedawcę” w Sprzedawcach).',
        'Krok 1: osoba i hotel — rodzaj współpracy, status aktywny i organizacja, w imieniu której hotel składa oferty.',
        'Krok 2: marki i prowizja — aktywne marki, sposób rozliczenia, prowizja i domyślny cennik nowych ofert.',
        'Krok 3: dostęp do portalu — zaznacz, aby po zapisie wysłać zaproszenie na e-mail kontaktu.',
        'Lista „Do uzupełnienia” nad przyciskiem zapisu pokazuje od razu wszystkie braki.',
        'Po zapisie sprawdź „Gotowość do pracy” w sprzedaży sprzedawcy: sale w lokalizacji, opiekun, logowanie, wygląd ofert, pierwsza oferta.',
      ],
      notes: [
        'Na Macu „Dodaj sprzedawcę” w „Sprzedawcach” otwiera kreator: osoba, hotel i sale, warunki, opiekun, zaproszenie. Braki widać od pierwszego kroku, a zapis jest możliwy przy komplecie — warunki są te same co w CRM.',
        'Kontakt musi mieć adres e-mail, który nie należy do pracownika CRM ani innego sprzedawcy.',
        'Bez sal w lokalizacji hotel nie wybierze przestrzeni w kreatorze. Dodaj je w kartotece lokalizacji.',
        'Zaproszenie zawiera jednorazowy link do ustawienia hasła. Wygasły link wyślij ponownie z „Gotowości do pracy”.',
        'W „Gotowości” widzisz też, czy hotel przeszedł przewodnik w portalu.',
      ],
    },
    {
      id: 'prezentacja',
      title: 'Prezentacja hotelowi',
      summary: 'Tryb pokazowy pokazuje portal z logo hotelu bez tworzenia konta. Demo z broszury hotel może przejść sam.',
      steps: [
        'W „Sprzedawcach” kliknij „Pokaż portal hotelowi”.',
        'Wpisz nazwę i logo hotelu. Przejdź przez kreator, ofertę dla klienta i „Jak to działa”.',
        'Opowiadaj według osi w pięciu etapach — hotel zobaczy ją potem w portalu.',
      ],
      notes: [
        'W demo z broszury hotel może kliknąć „Chcę dołączyć”. Powstaje zapytanie w CRM dla osoby, która wysłała broszurę, z powiadomieniem.',
        'Zgłoszenia widać też w wynikach broszury: licznik „Chcą dołączyć” i link do zapytania przy osobie.',
        'Po rozmowie użyj „Mianuj sprzedawcą” w karcie kontaktu utworzonego z zapytania.',
      ],
    },
    {
      id: 'kokpit',
      title: 'Kokpit „Dziś”',
      summary: 'Kokpit zbiera sprawy wszystkich Twoich sprzedawców. Obsługuj grupy od góry.',
      steps: [
        'Ceny do zgody — hotel dodał pozycję własną albo cenę poniżej stawki. Zatwierdź albo poproś o zmianę.',
        'Oferty do sprawdzenia — hotel wysłał ofertę po zgodzie klienta albo klient zaakceptował ją pod linkiem.',
        'Kroki realizacji — hotel uzupełnił krok przygotowania; zatwierdź go albo przekaż uwagi.',
        'Wydarzenia do potwierdzenia — oferta przyjęta, termin czeka na potwierdzenie.',
        'Rozmowy bez odpowiedzi — hotel czeka na Twoją odpowiedź.',
        'Zapytania klientów — z portalu i z kodów QR.',
        'Akceptacje klientów — klient zaakceptował ofertę online.',
      ],
      notes: [
        'Ostrzeżenia: brak opiekuna, opiekun bez uprawnień, brak aktywnych warunków marki, nieprzyjęte zaproszenie, brak aktywności 30 lub 60 dni.',
        'Akceptacja online klienta sama trafia do „Ofert do sprawdzenia”. Gdy klient zaakceptował starszą wersję PDF, hotel wysyła ofertę ręcznie.',
      ],
    },
    {
      id: 'ocena',
      title: 'Zgoda na cenę i ocena oferty',
      summary: 'Najpierw, przed pokazaniem oferty klientowi, zatwierdzasz ceny spoza cennika. Potem oceniasz zapisany PDF, który hotel wysłał po zgodzie klienta.',
      steps: [
        'Zgoda na cenę: otwórz ofertę z grupy „Ceny do zgody”. Widzisz pozycje, cennik MAVINCI, cenę dla klienta i różnicę.',
        'Kliknij „Zatwierdź ceny” albo „Poproś o zmianę ceny” z krótkim uzasadnieniem.',
        'Otwórz ofertę z kokpitu. PDF z wysłania wczyta się sam.',
        'Sprawdź termin w kalendarzu i dostępność zespołu. Zaznacz oba pola.',
        'Sprawdź wynik analizy sprzętu. Braki wyjaśnij albo potwierdź osobną weryfikację z uzasadnieniem.',
        'Zaakceptuj ofertę, poproś o zmiany albo jej nie przyjmuj. Przy zmianach i odmowie napisz uzasadnienie.',
      ],
      notes: [
        'Akceptacja tworzy wydarzenie w CRM do przygotowania. Nie rezerwuje sprzętu i nie potwierdza terminu.',
        'Nie zmieniasz ceny klienta, treści ani brandingu hotelu. Poprawki robi hotel.',
        'Do zgody na cenę hotel nie pobierze PDF dla klienta ani nie wyśle linku. Zgoda dotyczy tych pozycji i cen.',
        'Lista „Do odblokowania akceptacji” pokazuje wszystkie brakujące warunki naraz.',
      ],
    },
    {
      id: 'potwierdzenie',
      title: 'Potwierdzenie wydarzenia i przygotowanie',
      summary: 'Po przyjęciu oferty potwierdź termin. Hotel zobaczy wtedy „Potwierdzone” i swoje kroki przygotowania.',
      steps: [
        'W ofercie kliknij „Sprawdź dane i potwierdź realizację”.',
        'Hotel uzupełnia: osobę na miejscu, salę i dostęp, materiały.',
        'Zatwierdzasz kroki albo przekazujesz uwagi. Potem przygotowujesz plan do potwierdzenia przez hotel.',
        'Timeline, zespół, agendę i logistykę prowadzisz w wydarzeniu CRM.',
      ],
    },
    {
      id: 'zapytania',
      title: 'Zapytania klientów i z kodów QR',
      summary: 'Hotel pyta o termin z portalu, a goście hotelu — przez kod QR. Odpowiedz albo przekaż zapytanie do zapytań CRM.',
      steps: [
        'Sprawdź termin i odpowiedz w zapytaniu — hotel dostanie powiadomienie.',
        'Gdy sprawa jest poważna, przekaż ją do zapytań CRM.',
        'Zamknij zapytanie, gdy nie wymaga działania.',
      ],
    },
    {
      id: 'wynagrodzenie',
      title: 'Wynagrodzenie hotelu',
      summary: 'Prowizja to procent zysku z wydarzenia po kosztach. Hotel widzi kwoty dopiero po odsłonięciu dla marki.',
      steps: [
        'Stawkę ustawiasz w warunkach marki sprzedawcy.',
        'Prowizję przypisujesz do wydarzenia w jego podsumowaniu.',
        'Naliczenie jest wypłacalne po rozliczeniu wydarzenia, bez czekania na płatność klienta.',
        'W karcie sprzedawcy włącz „Pokaż wynagrodzenie w portalu” dla marki.',
      ],
      notes: ['Dobry moment na odsłonięcie to pierwsze potwierdzone wydarzenie hotelu.'],
    },
    {
      id: 'gdzie',
      title: 'Gdzie co jest: CRM, Mac, telefon',
      summary: 'Kokpit, karty sprzedawców, nowego sprzedawcę, zgodę na cenę i ocenę oferty masz w CRM i na Macu. Ustawienia istniejącego sprzedawcy, potwierdzenie realizacji i wynagrodzenie prowadzisz w CRM w przeglądarce.',
      steps: [
        'CRM — kokpit, ocena oferty, potwierdzenie wydarzenia, ustawienia sprzedawcy, „Gotowość do pracy”, wynagrodzenie.',
        'Aplikacja na Maca — „Sprzedawcy”: kokpit „Dziś”, oferty na osi, karta sprzedawcy z „Gotowością do pracy”, kreator „Nowy sprzedawca”, odpowiedzi na zapytania klientów i ta instrukcja.',
        'Na Macu karta oferty z portalu ma oś, zgodę na cenę i ocenę: PDF z wysłania, termin, zespół, analizę sprzętu i decyzję. Potwierdzenie realizacji — w CRM.',
        'Aplikacja mobilna — podgląd kokpitu i karta „Sprzedawcy — do zrobienia” w „Moim dniu”.',
      ],
    },
  ],
  tips: {
    review: { text: 'Oceniasz zapisany PDF z wysłania. Akceptacja tworzy wydarzenie do przygotowania, ale nie potwierdza terminu.', chapter: 'ocena' },
    approval: { text: 'Pozycja własna albo cena poniżej stawki. Do Twojej zgody hotel nie pobierze PDF dla klienta ani nie wyśle linku.', chapter: 'ocena' },
  },
  chapterFor(pathname) {
    if (pathname.startsWith('/crm/offers/')) return 'ocena';
    if (pathname.startsWith('/crm/salespeople/demo')) return 'prezentacja';
    if (pathname.startsWith('/crm/salespeople')) return 'kokpit';
    return 'rola';
  },
};
