import type { HelpManual } from './helpTypes';

/**
 * Instrukcja sprzedawcy (hotelu) — panel „?” w portalu i strona „Pomoc”.
 * Opisuje proces po etapie 2 wdrożenia audytu: zgoda na cenę przed pokazaniem klientowi, akceptacja online trafia sama do opiekuna.
 */
export const SELLER_HELP: HelpManual = {
  audience: 'seller',
  title: 'Instrukcja sprzedawcy',
  chapters: [
    {
      id: 'jak-to-dziala',
      title: 'Jak działa współpraca z MAVINCI',
      summary: 'Każda oferta przechodzi przez pięć etapów. Na ekranie zawsze widzisz, na jakim etapie jest oferta i kto teraz działa.',
      steps: [
        'Oferta — przygotowujesz ofertę w kreatorze i generujesz PDF.',
        'U klienta — przekazujesz PDF klientowi, najczęściej razem z ofertą hotelu. Możesz też wysłać link.',
        'U opiekuna — po zgodzie klienta wysyłasz ofertę do opiekuna. Opiekun sprawdza termin, zespół i sprzęt.',
        'Wydarzenie — opiekun przyjmuje ofertę i potwierdza termin. Razem przygotowujecie realizację.',
        'Rozliczenie — po wydarzeniu widzisz podsumowanie i, jeśli dotyczy, swoje wynagrodzenie.',
      ],
      notes: [
        'Pod osią zawsze jest jedno zdanie „Teraz” — mówi, kto działa i co trzeba zrobić.',
        'Etap zmienia się tylko po decyzji: Twojej, klienta albo opiekuna. Sama data niczego nie przesuwa.',
        'Pytania zadawaj w rozmowie przy ofercie. Opiekun widzi tę samą ofertę i ten sam PDF.',
      ],
      faq: [
        { q: 'Czym różni się przyjęcie oferty od potwierdzenia wydarzenia?', a: 'Opiekun najpierw przyjmuje ofertę (sprawdza możliwości). Potem osobno potwierdza termin i przygotowanie wydarzenia. Oba kroki widzisz na osi.' },
        { q: 'Czy muszę czekać na opiekuna, zanim pokażę ofertę klientowi?', a: 'Nie, jeśli ceny są z Twojego cennika. Gdy dodasz pozycję własną albo obniżysz cenę poniżej stawki, kreator sam poprosi opiekuna o zgodę. PDF dla klienta i link odblokują się po zgodzie.' },
      ],
    },
    {
      id: 'pulpit',
      title: 'Pulpit i pierwsze kroki',
      summary: 'Pulpit pokazuje, co wymaga Twojej reakcji, oraz liczbę ofert na każdym etapie.',
      steps: [
        'Ustaw wygląd ofert: logo, kolory i czcionkę hotelu (Ustawienia → Branding).',
        'Poznaj swojego opiekuna — jego dane są na pulpicie i w rozmowach.',
        'Przygotuj pierwszą ofertę albo wyślij szybkie zapytanie o termin.',
        'Wydrukuj kartę z kodem QR, aby goście hotelu sami pytali o wydarzenia.',
      ],
      notes: [
        '„Do zrobienia” pokazuje tylko sprawy, w których teraz działasz Ty.',
        'Kafelki z etapami otwierają listę ofert z ustawionym filtrem.',
      ],
    },
    {
      id: 'zapytania',
      title: 'Sprawdź termin i kody QR',
      summary: 'Szybkie zapytanie wysyła opiekunowi pytanie o termin bez przygotowywania oferty. Kod QR pozwala gościom hotelu zapytać o wydarzenie bez logowania.',
      steps: [
        'Wybierz „Sprawdź termin”, wpisz klienta, datę i liczbę gości.',
        'Opiekun sprawdzi dostępność i odpowie w tym samym zapytaniu.',
        'Gdy termin jest wolny, kliknij „Przygotuj ofertę dla tego klienta”.',
        'W „Materiałach dla hotelu” utwórz kod QR dla miejsca (recepcja, restauracja, pokoje) i wydrukuj kartę.',
      ],
      notes: [
        'Każde miejsce może mieć własny kod — zobaczysz, skąd przychodzą zapytania.',
        'Zapytania z kodu QR widzi też opiekun. Odpowiedź dostaniesz w portalu.',
      ],
    },
    {
      id: 'kreator',
      title: 'Kreator oferty krok po kroku',
      summary: 'Kreator ma trzy kroki: klient i termin, usługi, podsumowanie. Każdy krok pokazuje listę braków przed przejściem dalej.',
      steps: [
        'Klient i termin — wybierz zapisany kontakt albo wpisz nowego klienta. Dodaj dni wydarzenia, liczbę gości i salę.',
        'Usługi — dodaj usługi z katalogu MAVINCI. Możesz dodać własną pozycję hotelu.',
        'Do rozważenia przez klienta — opcjonalne propozycje. Są w PDF osobno, poza sumą oferty.',
        'Podsumowanie — sprawdź ceny, tytuł, ważność i wstęp dla klienta. Zapisz i wygeneruj PDF.',
        'Gotowe — co dalej? Po zapisie widzisz dwa wybory: pobierz PDF albo utwórz link dla klienta.',
      ],
      notes: [
        'Nową ofertę zaczniesz od zera, z zapytania klienta albo jako kopię poprzedniej oferty.',
        'Szkic zapiszesz bez terminu. PDF wymaga daty wydarzenia.',
        'Przy pozycji własnej albo cenie poniżej stawki kreator po zapisie sam poprosi opiekuna o zgodę na cenę.',
        'Gdy hotel nie ma sal w bazie, kliknij „Napisz do opiekuna” — wiadomość jest gotowa.',
        'Kreator pilnuje niezapisanych zmian. Przed wyjściem zapyta, czy je porzucić.',
      ],
      faq: [
        { q: 'Czym jest pozycja własna?', a: 'To usługa hotelu spoza katalogu MAVINCI, np. dekoracja sali. Cenę wpisujesz sam. Zatwierdza ją opiekun.' },
        { q: 'Czy mogę poprawić ofertę po wysłaniu PDF?', a: 'Tak. Po zmianach zaktualizuj PDF. Poprzednie wersje zostają w historii dokumentów.' },
      ],
    },
    {
      id: 'ceny',
      title: 'Ceny: marża czy prowizja',
      summary: 'Sposób rozliczenia decyduje, kto ustala cenę dla klienta. Widzisz go na górze kroku „Usługi”.',
      steps: [
        'Marża — cenę dla klienta ustalasz sam. Różnica względem cennika MAVINCI to marża hotelu.',
        'Prowizja — ceny dla klienta pochodzą z cennika MAVINCI. Hotel dostaje procent od zysku z wydarzenia.',
        'Sposób rozliczenia nowych ofert ustawisz w Ustawieniach. Zapisana oferta zachowuje swój sposób.',
      ],
      notes: [
        'Zgoda opiekuna jest potrzebna, gdy dodasz pozycję własną albo dasz cenę poniżej swojej stawki.',
        'Kreator po zapisie sam wysyła prośbę o zgodę. Możesz dopisać wiadomość do opiekuna.',
        'Do zgody PDF dla klienta i link są wstrzymane. Podgląd PDF działa od razu.',
        'Zgoda dotyczy tych pozycji i cen. Zmiana tytułu czy terminu jej nie kasuje, zmiana ceny wymaga nowej zgody.',
        'Gdy opiekun poprosi o zmianę ceny, zobaczysz jego wiadomość na górze oferty.',
        'Prowizja liczy się od zysku po kosztach wydarzenia, więc kwota w ofercie to tylko szacunek.',
      ],
    },
    {
      id: 'wysylka',
      title: 'Wysyłka do klienta i przekazanie opiekunowi',
      summary: 'Najczęściej pobierasz PDF i dołączasz go do własnej oferty hotelu jako wkładkę. Link dla klienta jest dodatkową możliwością.',
      steps: [
        'Pobierz PDF i wyślij go klientowi ze swojej skrzynki, razem z ofertą hotelu.',
        'Opcjonalnie utwórz link dla klienta — klient obejrzy ofertę na telefonie i zaakceptuje ją online.',
        'Akceptacja przez link trafia do opiekuna sama. Teraz nic nie musisz robić.',
        'Klient zgodził się mailem, telefonicznie albo osobiście? Kliknij „Klient zaakceptował — wyślij do opiekuna” i przejdź trzy krótkie kroki.',
      ],
      notes: [
        'Wysyłasz zawsze aktualny PDF. Gdy oferta zmieniła się po wygenerowaniu, kliknij „Zaktualizuj PDF”.',
        'Gdy klient zaakceptował starszą wersję PDF przez link, oferta nie trafi do opiekuna sama — wtedy wyślij ją ręcznie.',
        'Przy cenie do zgody PDF dla klienta i link odblokują się po zgodzie opiekuna.',
        'Wiadomość na czacie nie zastępuje wysłania oferty do opiekuna.',
      ],
      faq: [
        { q: 'Klient zgodził się telefonicznie. Co zrobić?', a: 'Kliknij „Klient zaakceptował — wyślij do opiekuna”, wybierz „Telefonicznie”, sprawdź PDF i wyślij. Możesz dopisać uwagi dla opiekuna.' },
        { q: 'Dlaczego nie mogę pobrać PDF?', a: 'Oferta ma pozycję własną albo cenę poniżej stawki i czeka na zgodę opiekuna. Po zgodzie dostaniesz powiadomienie.' },
      ],
    },
    {
      id: 'opiekun',
      title: 'Co się dzieje u opiekuna',
      summary: 'Opiekun sprawdza termin, dostępność zespołu i sprzętu. Potem przyjmuje ofertę, prosi o poprawki albo jej nie przyjmuje.',
      steps: [
        'Przyjęcie oferty — oferta przechodzi do „Wydarzeń”. Opiekun potwierdza termin osobno.',
        'Prośba o poprawki — popraw ofertę, zaktualizuj PDF i wyślij ją ponownie z krótką odpowiedzią.',
        'Brak zgody — przeczytaj uzasadnienie i ustal dalsze kroki w rozmowie.',
      ],
      notes: [
        'Wiadomość opiekuna jest na górze oferty, w ramce „Co trzeba poprawić”.',
        'Przyjęcie oferty nie rezerwuje jeszcze sprzętu. Potwierdzenie terminu przychodzi osobno.',
      ],
    },
    {
      id: 'wydarzenia',
      title: 'Wydarzenia: przygotowanie realizacji',
      summary: 'W „Wydarzeniach” są oferty przyjęte przez opiekuna: czekające na potwierdzenie terminu, potwierdzone i zakończone.',
      steps: [
        'Czeka na potwierdzenie — opiekun potwierdza termin. Możesz już przekazać potrzebne informacje.',
        'Potwierdzone — uzupełnij swoje kroki: osoba na miejscu, sala i dostęp, materiały.',
        'Opiekun zatwierdza każdy krok albo przekazuje uwagi. Potem przygotowuje plan wydarzenia do Twojego potwierdzenia.',
        'Po wydarzeniu możesz przekazać podsumowanie i uwagi klienta.',
      ],
      notes: ['Każdy krok pokazuje, na czyją akcję czekamy.', 'Harmonogram i kontakty do zespołu znajdziesz w realizacji.'],
    },
    {
      id: 'wynagrodzenie',
      title: 'Wynagrodzenie',
      summary: 'Przy marży zarabiasz różnicę cen — widzisz ją od razu w ofercie. Przy prowizji kwotę pokaże opiekun.',
      steps: [
        'Prowizja to procent od zysku z wydarzenia po jego kosztach.',
        'Naliczenie powstaje po rozliczeniu wydarzenia. Nie czeka na płatność klienta.',
        'W „Moim wynagrodzeniu” widzisz podsumowanie wydarzenia i skąd wzięła się kwota.',
      ],
      notes: ['Zakładka „Moje wynagrodzenie” pojawia się, gdy opiekun włączy widoczność dla Twojej marki.'],
    },
    {
      id: 'ustawienia',
      title: 'Ustawienia, kontakty i rozmowy',
      summary: 'Ustawienia decydują o wyglądzie ofert i sposobie rozliczenia nowych ofert. Kontakty i rozmowy przyspieszają codzienną pracę.',
      steps: [
        'Branding — logo, kolory i czcionka hotelu w PDF i na stronie oferty dla klienta.',
        'Wizytówka sprzedawcy — Twoje dane widoczne w ofercie.',
        'Przestrzenie i kontakty — sale hotelu i osoby kontaktowe. Brakującą salę doda opiekun.',
        'Ogólne — sposób rozliczenia nowych ofert.',
        'Kontakty — zapisani klienci do szybkiego wyboru w kreatorze.',
        'Rozmowy — rozmowa ogólna z opiekunem i osobny wątek każdej oferty.',
      ],
      faq: [{ q: 'Jak zmienić hasło?', a: 'Kliknij swoje imię na dole menu i wybierz „Zmień hasło”.' }],
    },
  ],
  tips: {
    model: { text: 'Marża: cenę dla klienta ustalasz sam. Prowizja: ceny z cennika MAVINCI, hotel dostaje procent od zysku.', chapter: 'ceny' },
    optional: { text: 'Propozycje do rozważenia są w PDF osobno, poza sumą oferty i bez rezerwacji sprzętu.', chapter: 'kreator' },
    approval: { text: 'Pozycja własna albo cena poniżej stawki wymaga zgody opiekuna. Do zgody PDF dla klienta i link są wstrzymane.', chapter: 'ceny' },
    pdfVersions: { text: 'Każde wygenerowanie tworzy nową wersję PDF. Do opiekuna wysyłasz zawsze aktualną.', chapter: 'wysylka' },
    clientLink: { text: 'Link to strona oferty z logo hotelu. Klient obejrzy ją na telefonie i zaakceptuje online.', chapter: 'wysylka' },
    commission: { text: 'Kwota prowizji pojawi się, gdy opiekun włączy jej widoczność. Liczy się od zysku po kosztach wydarzenia.', chapter: 'wynagrodzenie' },
  },
  chapterFor(pathname) {
    if (pathname === '/seller/offers/new' || pathname.startsWith('/seller/products/')) return 'kreator';
    if (/^\/seller\/offers\/[^/]+/.test(pathname)) return 'wysylka';
    if (pathname.startsWith('/seller/offers')) return 'jak-to-dziala';
    if (pathname.startsWith('/seller/inquiries') || pathname.startsWith('/seller/materials')) return 'zapytania';
    if (pathname.startsWith('/seller/realizations')) return 'wydarzenia';
    if (pathname.startsWith('/seller/commissions')) return 'wynagrodzenie';
    if (pathname.startsWith('/seller/profile') || pathname.startsWith('/seller/contacts') || pathname.startsWith('/seller/messages')) return 'ustawienia';
    if (pathname === '/seller') return 'pulpit';
    return 'jak-to-dziala';
  },
};
