# Zapytania → warianty ofert → realizacja

Zmiany przygotowane 26.09.2026. Stan: kod i migracje przygotowane lokalnie; środowisko produkcyjne nie zostało zmienione.

## Obsługa przez sprzedaż

1. Nowe formularze tworzą wiadomość i zapytanie w jednej transakcji. Ponowienie tego samego zgłoszenia z otwartego formularza zachowuje identyfikator. Webhook zachowuje deduplikację po identyfikatorze nadawcy. Dane miasta, rodzaju wydarzenia i źródła są zachowane w briefie.
2. Z obszaru zapytania można przejść bezpośrednio do edycji opiekuna, etapu i terminu działania. Założenia edytuje się w jednym miejscu — w obszarze zapytania.
3. Analiza AI zapisuje wynik i wersję briefu. Brakujące informacje są listą pytań z odpowiedzią, statusem, źródłem i czasem zmiany. Można dodać własne pytanie i notatkę z rozmowy. Przed ponowną analizą zapisywane są zmiany. Nowe założenia i widełki zastępują robocze dane dopiero po użyciu „Zastosuj proponowane założenia i kosztorys” oraz zapisaniu.
4. „Nowa oferta” tworzy następny wariant. „Duplikuj” kopiuje pozycje, pakiety i zamienniki w jednej transakcji; zachowuje kontakt oraz powiązania z zapytaniem i wydarzeniem. Kopia jest szkicem i nie dziedziczy akceptacji ani wygenerowanego PDF.
5. Każda oferta wybiera własną kalkulację i zachowuje jej wersję. Edycja kalkulacji źródłowej nie zmienia istniejących ofert. Aktualizację wyceny można wyraźnie zlecić w informacjach podstawowych oferty. Kopia kalkulacji zachowuje wszystkie pola pozycji, a import z oferty działa także przed założeniem wydarzenia.
6. Akceptacja w zapytaniu wymaga potwierdzenia klienta i wyboru pakietu, jeżeli oferta ma pakiety. Zapis blokuje równoczesną akceptację innego wariantu. Wariant zaakceptowany jest chroniony przed zmianą zakresu; do korekty służy kopia albo ponowne otwarcie negocjacji z powodem. Dla oferty z wydarzeniem pozostaje etap sprawdzenia i rezerwacji zasobów.
7. Wysyłka PDF zapisuje kontakt i historię. Ponowne wysłanie nie cofa akceptacji ani wygranej. Zmiana treści unieważnia bieżący PDF. Pliki mają osobne ścieżki i historię wersji. Generowanie odrzuca wynik, jeżeli dokument zmieniono w jego trakcie. Zaplanowana wiadomość wysyła wybraną przy planowaniu wersję i ponownie sprawdza uprawnienia nadawcy.
8. „Utwórz wydarzenie” bez akceptacji tworzy robocze wydarzenie i pozostawia sprzedaż otwartą. „Przygotuj realizację” wymaga zaakceptowanej oferty: przenosi wycenę, plan zasobów oraz zadanie sprawdzenia dostępności i przygotowania realizacji. Planowane zasoby wymagają potwierdzenia dostępności w istniejącym procesie rezerwacji. Powtórzenie operacji nie tworzy drugiego wydarzenia ani zadania.
9. Zapytania są archiwizowane z powodem, dzięki czemu źródło i dokumenty pozostają powiązane. Historyczne braki oraz wiadomości Meta są widoczne w „Kontroli źródeł” dla administratora/osoby zarządzającej całym lejkiem. Można utworzyć zapytanie, powiązać istniejące lub wykluczyć zgłoszenie z uzasadnieniem. Rekrutacja `team_join` pozostaje w wiadomościach i nie tworzy automatycznie szansy sprzedaży.

## Wdrożenie

Najpierw zastosować, w tej kolejności, migracje:

- `20260926120000_inquiry_sales_workflow.sql`
- `20260926123000_inquiry_intake_reconciliation.sql`

Wymagają wcześniejszych migracji lejka, routingu z 18.09, pakietów ofert, uprawnień marek i kalkulacji obecnych w repozytorium. Repozytorium zawiera także wcześniejsze lokalne zmiany migracji, dlatego przed wdrożeniem należy porównać historię migracji docelowej bazy.

Następnie wdrożyć funkcje Supabase wraz z katalogiem `_shared`:

- `assist-inquiry`
- `generate-offer-pdf`
- `send-offer-email`
- `send-email`
- `schedule-email`
- `process-scheduled-emails`

Funkcje `send-offer-email` i `send-email` są samodzielne: przy wdrożeniu przez edytor Supabase należy wkleić cały aktualny plik `index.ts` odpowiedniej funkcji. Nie importują lokalnych plików z `_shared`; pomocnicza obsługa uprawnień i obrazów jest zawarta w każdym pliku. Ich kopie należy aktualizować razem przy zmianach tej logiki. Pozostałe funkcje nadal należy wdrażać z ich zależnościami.

Na końcu wdrożyć aplikację Next.js. Poprzednie pliki ofert i kalkulacji pozostają zachowane; przed kolejną nową wysyłką wymagają wygenerowania wersji zgodnej z nowym mechanizmem. Historyczne braki źródeł nie są automatycznie otwierane jako nowe sprzedaże.

## Sprawdzenia wykonane lokalnie

Testy SQL uruchomiono w pamięci w PGlite, na izolowanym schemacie kontraktowym opisanym w `supabase/tests/inquiry-sales-workflow/fixture.sql`. Obie nowe migracje wykonują się na tym schemacie. Siedem grup scenariuszy przeszło:

- niezależność zapisanej kalkulacji, kopie dokumentów, kopie pakietów i powtarzalny identyfikator operacji;
- unieważnienie PDF po zmianie pozycji i odrzucenie publikacji starej wersji;
- zapis pytań i historii, odrzucenie nieaktualnego briefu oraz analizy;
- odmowa zapisu osobie bez uprawnień, odrzucenie drugiej akceptacji, blokada edycji wybranego wariantu oraz bezpieczna ponowna wysyłka;
- przekazanie zaakceptowanej wyceny, planu zasobów i zadania bez duplikatów;
- robocze wydarzenie pozostawiające otwartą sprzedaż oraz archiwizacja zachowująca źródło;
- formularz zapisany transakcyjnie, zachowanie miasta, deduplikacja i trwałe powiązanie rozstrzygniętego źródła.

Sprawdzono składnię zmienionych plików TypeScript/TSX. Nie uruchamiano pełnego builda, globalnego typechecka ani lintowania projektu.

Testy kontraktowe nie odtwarzają całej historycznej bazy, wszystkich istniejących triggerów ani polityk RLS. Nie zastępują odbioru na środowisku testowym z rzeczywistym schematem i uprawnieniami.

## Odbiór po wdrożeniu na środowisku testowym

| Scenariusz | Oczekiwany wynik |
| --- | --- |
| Oba formularze WWW, ponowienie żądania i webhook z tym samym kluczem | Jedna wiadomość/zdarzenie i jedno zapytanie; miasto, typ i źródło zachowane |
| Historyczne braki i webhook Meta | Widoczna pozycja kontroli źródeł, rozstrzygnięcie z powodem, brak samoczynnego odtworzenia przy ponowieniu |
| Przejęcie i przekazanie zapytania między handlowcami | Nowy opiekun może pracować z dokumentami; osoba tylko z podglądem nie zapisuje ani nie wysyła |
| Odpowiedzi po rozmowie, odświeżenie i kolejna analiza | Odpowiedzi zostają, AI dostaje bieżące dane; ręczne założenia nie są automatycznie nadpisane |
| Dwie oferty i dwie kalkulacje oraz ich kopie | Osobne identyfikatory/numeracja, kompletne pozycje, pakiety i powiązania; brak zmian katalogu sprzętu |
| Oferta A z kalkulacją A, oferta B z kalkulacją B, późniejsza edycja kalkulacji | Cena A i B oraz ich PDF pozostają zgodne z zapisaną wersją |
| Akceptacja dwóch wariantów w dwóch sesjach | Jedna wybrana oferta; druga sesja otrzymuje informację o zmianie wyboru |
| Edycja ilości/ceny/notatki i generowanie PDF podczas drugiej edycji | Stary PDF nie jest wysyłany; spóźniona generacja nie zastępuje aktualnej wersji |
| Wysyłka natychmiastowa, zaplanowana i ponowne wysłanie zaakceptowanej oferty | Poprawny dokument i historia kontaktu; akceptacja, etap wygranej i rezerwacje zachowane |
| Wydarzenie robocze, a następnie przygotowanie zaakceptowanej realizacji | Jeden event, właściwy budżet i zakres, zadanie weryfikacji zasobów; roboczy event sam nie oznacza wygranej |

Nie wysyłano rzeczywistych wiadomości i nie zmieniano danych produkcyjnych. Integracja Meta zapisuje powiadomienia Lead Ads do kwalifikacji; pobieranie pełnych danych kontaktowych z Graph API nie zostało dodane — zgłoszenie wymaga uzupełnienia danych z panelu reklamowego. Jakość odpowiedzi AI, renderowanie PDF, rzeczywisty transport SMTP oraz współdziałanie RLS i istniejących triggerów wymagają powyższego odbioru na środowisku testowym.


## Tablica zadań zapytania — 26.09.2026

Zakładka „Zadania” korzysta z tego samego komponentu tablicy i formularza co `/crm/tasks`, z filtrem `inquiry_id` bieżącego zapytania. Pokazuje tylko zwykłe, nieprywatne zadania; zapytania sprzedażowe i prywatne kopie nie są kartami tej tablicy. Zadania powiązane jednocześnie z wydarzeniem pozostają widoczne w zapytaniu.

Formularz pozwala tworzyć i edytować zadanie, wybierać wielu pracowników, priorytet, kolumnę, termin oraz zdjęcie. Przypisania są dodawane bez powielania automatycznego przypisania twórcy. Zapis formularza jest blokowany na czas trwającej operacji. Istniejące zadania nie są kopiowane ani usuwane.

Zmiana kolumny aktualizuje także status. Pamięć otwartych tablic aktualizuje się od razu, a błąd zapisu cofa zmianę. Subskrypcje Supabase Realtime odświeżają zakładkę zapytania, ogólną tablicę, szczegóły zadania i listę zadań wydarzenia. Tablica pracownika uwzględnia również przypisanie otrzymane po utworzeniu zadania. Ponowne połączenie Realtime i powrót do okna odświeżają dane widoków współdzielonych. Subskrypcje respektują istniejące uprawnienia bazy.

Wdrożenie: zastosować migrację `20260926180000_sync_task_status_and_board.sql`, a następnie wdrożyć aplikację. Migracja ujednolica kolumnę i status przy kolejnych zapisach zwykłych zadań, również z innych widoków. Istniejące triggery synchronizacji z prywatnymi kopiami pozostają aktywne; synchronizator kopii nie zapisuje już powiadomień do nieistniejących kolumn, ponieważ odpowiada za nie osobny trigger. Kolumna „Sprawdzenie” odpowiada statusowi `in_progress`, zgodnie z historycznym typem statusu w bazie. Etapy samych zapytań sprzedażowych zachowują osobny mechanizm.

Scenariusze odbioru po wdrożeniu:

1. Otworzyć dwa różne zapytania: każde pokazuje wyłącznie swoje zadania w czterech kolumnach.
2. Utworzyć zadanie, wybierając siebie i dwóch innych pracowników: jedno zadanie, pojedyncze przypisanie każdej osoby, brak błędu duplikatu.
3. Edytować zadanie i dopisać pracownika: zmiana widoczna na kartach i w jego tablicy bez odświeżania strony.
4. W dwóch oknach otworzyć zapytanie i `/crm/tasks`; przesunąć kartę do „W trakcie”, a następnie „Zakończone”. Oba widoki i szczegóły zadania mają ten sam status; przesunięcie w odwrotną stronę również dociera do zapytania.
5. Dla zadania powiązanego z wydarzeniem sprawdzić równoczesną aktualizację w wydarzeniu i w tablicy pracownika. Sprawdzić też zmianę z istniejącej prywatnej kopii i powrót do okna po utracie połączenia.
6. Osoba z samym podglądem zapytania nie widzi tworzenia/edycji i nie przesuwa kart. Odrzucony zapis przywraca kartę do poprzedniej kolumny.

Kod przygotowano lokalnie; nie wykonywano wdrożenia ani testów uruchomieniowych tej zmiany (zgodnie z `.build-policy.md`).


## Wyłączenie automatycznego pomiaru czasu dla administratora

W `Ustawienia → Powiadomienia` administrator może odznaczyć „Automatyczny pomiar czasu po przeniesieniu zadania do «W trakcie»” i zapisać zmiany. Domyślnie opcja jest włączona. Preferencja jest zapisywana w istniejącym `employees.preferences.notifications.autoStartTaskTimer`; migracja bazy nie jest potrzebna.

Wyłączenie dotyczy osoby przesuwającej kartę, a nie pracowników przypisanych do zadania. Obejmuje `/crm/tasks`, zadania zapytania, tablicę pracownika oraz zadania wydarzenia. Zmiana kolumny nadal zapisuje się i synchronizuje, lecz nie uruchamia licznika, nie blokuje się z powodu innego aktywnego pomiaru i nie pyta o zatrzymanie licznika przy przesunięciu do sprawdzenia lub zakończenia. Ręczne uruchomienie i zatrzymanie pomiaru pozostaje dostępne; zapis ustawienia nie zatrzymuje już działającego licznika.

Odbiór: po wyłączeniu i zapisaniu preferencji przesunąć kartę w każdym widoku, także przy innym aktywnym timerze oraz w drugim otwartym oknie. Status ma się zmienić bez nowego wpisu czasu i bez okna zatrzymywania. Po ponownym włączeniu sprawdzić dotychczasowy automatyczny start i blokadę drugiego pomiaru. Konto bez uprawnień administratora zachowuje dotychczasowe działanie. Kod przygotowano lokalnie; nie uruchamiano testów ani wdrożenia.
