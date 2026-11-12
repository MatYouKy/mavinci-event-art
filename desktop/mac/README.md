# Mavinci na macOS

Aktualna wersja: **0.5.0** (zakres — sekcje „Aktualizacja 0.4” i „Aktualizacja 0.5” na końcu). Bieżący zakres wydarzeń i kalendarza oraz dokładna macierz brakujących operacji znajdują się w sekcji „Aktualizacja 0.2” poniżej. Opis pierwszego etapu pozostawiono jako historię zakresu.

Natywna aplikacja SwiftUI, macOS 14 lub nowszy, Swift 5.9+. Katalog `desktop/mac` jest równorzędny z `mobile`. Bez osadzonego panelu WWW i zewnętrznych bibliotek Swift.

## Uruchomienie

Z katalogu projektu:

```sh
node desktop/mac/scripts/import-env.cjs
cd desktop/mac
./scripts/build-app.sh
open build/Mavinci.app
```

Import czyta `.env`, `mobile/.env` i `mobile/.env.local`, ostatnie wartości mają pierwszeństwo. Zapisuje **wyłącznie publiczny adres i klucz anon/publishable Supabase** w ignorowanym `Resources/Configuration.json`. Nie kopiuje żadnego pliku `.env`, klucza `service_role`, haseł SMTP ani sekretów integracji. Nie wypisuje wartości do terminala. Konfiguracja publiczna trafia do pakietu `.app`.

Alternatywnie otwórz `Package.swift` w Xcode i wybierz schemat Mavinci → My Mac. Do uruchomienia przez `swift run` ustaw `MAVINCI_CONFIGURATION_FILE` na pełną ścieżkę do `Resources/Configuration.json`, albo wpisz publiczną konfigurację w ekranie pierwszego uruchomienia. Ustawienia zapisane wcześniej w pęku kluczy mają pierwszeństwo przed konfiguracją pakietu.

Logowanie: konto pracownika z CRM, e-mail i hasło. Nie wpisano na stałe identyfikatora sprzedawcy ani jego sesji. Profil jest potwierdzany przez `auth_user_id` i `is_active`, analogicznie do aplikacji mobilnej. Ustawienia połączenia po konfiguracji początkowej może zmieniać zalogowany administrator; są to ustawienia **danego Maca**, nie globalny panel sekretów serwera.

## Działający zakres pierwszego etapu

| Sekcja | Zakres |
| --- | --- |
| Mój dzień | Istniejące `get_my_sales_day`: kontakty na dziś, oferty bez odpowiedzi, przetargi, lejek i własne zadania; przejścia do natywnych szczegółów. |
| Zapytania | Lista i podgląd, wyszukiwanie, filtr „Tylko moje” / „Otwarte”, przejęcie, potwierdzenie kontaktu z opcjonalnym kolejnym terminem, odroczenie o godzinę. Istniejące RPC z CRM. |
| Moje zadania | Zadania prywatne i przypisane jak `mobile/src/services/employeeTasks.ts`; tworzenie prywatnego zadania, edycja tytułu, opisu, priorytetu, terminu i etapu. Aktualizacja z kontrolą `updated_at`. |
| Kontakty | Lista aktywnych kontaktów i podstawowe dane, uruchomienie systemowej obsługi telefonu i e-maila. |
| Wydarzenia | Lista i podgląd podstawowych danych dostępnych według RLS; bez danych finansowych. |
| Oferty | Lista i podstawowe metadane oferty, powiązanie z zapytaniem / wydarzeniem. Nie ma jeszcze edytora ani kwot i kalkulacji. |
| Przetargi | Lista, termin, stan i powiązanie z zapytaniem. |
| Powiadomienia | Lista, filtr nieprzeczytanych, odczyt treści, indywidualne oznaczenie przeczytania, obsługiwane powiązania natywne. |

Tabele ze zmianą zaznaczenia, sortowaniem nagłówkami, wyszukiwaniem, menu kontekstowym i szczegółami obok listy. SF Symbols, systemowe menu, pola i formularze; interfejs po polsku. ⌘R — odśwież, ⌘1–3 — główne sekcje, ⌘N / ⌘E — nowe zadanie / edycja. Instrukcja jest dostępna pod znakiem zapytania w pasku bocznym.

## Uprawnienia, dane lokalne i synchronizacja

- Backend pozostaje źródłem prawdy. Używany jest publiczny klucz z tokenem zalogowanego użytkownika. RLS i istniejące funkcje wyznaczają dostęp, firmy i odpowiedzialność. Nie używamy `service_role` w aplikacji.
- Menu i czynności są dodatkowo filtrowane po uprawnieniach. Przed zapisem aplikacja potwierdza profil na serwerze. Nie implementuje własnych reguł finansowych.
- Sesje, token odświeżania, ustawienia połączenia i klucz szyfrowania są w Keychain. Kopia danych jest szyfrowana AES-GCM w Application Support/Mavinci/Desktop/v1 i oddzielona według źródła danych i konta.
- Start bez czekania: po uruchomieniu aplikacja od razu pokazuje kopię z dysku (zbiory, dashboard, plan dnia, menu, Wiadomości — kopia do 30 dni), a w tle dociąga tylko zmiany w kolejności ekranu: dashboard i menu → plan dnia → zbiory (skróty koszyków) → Wiadomości. Zapis jest możliwy dopiero po potwierdzeniu profilu na serwerze. Bez połączenia dane są wyłącznie do odczytu, a kopia starsza niż 24 godziny od kompletnego udanego odświeżenia jest ukrywana. Zmiana efektywnego profilu usuwa stare dane; wylogowanie usuwa klucz kopii, plik i lokalną sesję. Cofnięcia uprawnień nie da się wykryć bez połączenia — to ograniczenie każdej kopii offline.
- Odświeżanie co 60 s, tylko gdy aplikacja jest aktywna, oraz przy powrocie i ⌘R. Edycja formularza wstrzymuje automatyczne odświeżanie. Błąd jednego modułu nie przerywa pozostałych. Błędy dostępu / schematu usuwają dane tego modułu; awaria transportu zachowuje ostatnią poprawną kopię.
- Wynik zapisu musi być potwierdzony. Nie ma automatycznych ponowień operacji tworzenia. Po przerwaniu połączenia należy odświeżyć dane przed ponowną próbą.

### Synchronizacja przyrostowa — osobna migracja do wdrożenia

Plik `supabase/migrations/20261101160000_native_workspace_sync.sql` tworzy **wyłącznie odczytową** funkcję `native_workspace_sync(p_set,p_hashes)` działającą jako `SECURITY INVOKER`. Nie zmienia rekordów biznesowych, istniejących polityk ani uprawnień pracowników.

Rejestr zbiorów: `tasks`, `inquiries`, `contacts`, `events`, `offers`, `tenders`, `notifications`. 16 kubełków według pierwszego znaku `md5(id)`; skrót każdego kubełka obejmuje całą jego treść. Odpowiedź ma `hashes` i `changed`. Zmienione i opróżnione kubełki zastępują lokalną zawartość — uwzględnia to usunięcia, zmiany przypisań i widoczności, a nie tylko `updated_at`. Backend nie utrzymuje trwałej migawki: każdy zapis jest widoczny przy następnym odczycie, bez `invalidateSync` i ryzyka starego cache serwera. To odrębne rozwiązanie od Piastpol, dostosowane do obecnego Supabase.

**Migracja nie jest uruchamiana przez skrypty aplikacji ani import konfiguracji.** Do jej wdrożenia aplikacja używa pełnego odczytu stronicowanego po 200 rekordów, wyraźnie oznaczonego w interfejsie. Błąd inny niż brak RPC nie uruchamia tej ścieżki awaryjnej. Mój dzień korzysta z istniejącego RPC i jest odświeżany w całości jako małe podsumowanie.

## Kolejne etapy i parytet

Nie jest to jeszcze kompletne zastępstwo panelu sprzedawcy. Do wdrożenia:

1. Tworzenie i pełna edycja zapytań, brief, historia, zespół, załączniki, kalkulacje, przejście do oferty i wydarzenia.
2. Pełny edytor oferty, warianty, ceny, akceptacje, generowanie i wysyłka PDF; umowy i podpisy.
3. Rozszerzona karta kontaktu, edycja kontaktów i organizacji, historia rozmów oraz przypisania.
4. Pełne wydarzenie: edycja, agenda, sprzęt, zespół, logistyka, koszty zgodnie z `sales_lead`.
5. Poczta, komunikator, kalendarz i spotkania, rejestr czasu, faktury i rozrachunki.
6. Akcje przetargów, odpowiedzi na zaproszenia i pełny routing wszystkich typów powiadomień, powiadomienia systemowe macOS, katalog załączników.
7. Ujednolicony protokół formularzy czynności dla wszystkich trzech klientów; integracja transportu przyrostowego z istniejącą aplikacją mobilną i WWW. Obecnie nowe RPC może być użyte przez nie, ale ich transport nie został zmieniony.
8. Własny serwer, autoryzacja, baza danych, migracja i testy zgodności; konfiguracja adresu w aplikacji sama tego nie dostarcza.

Istniejące zachowanie CRM i mobile nie zostało zmienione. Funkcje pierwszego etapu używają ich tabel, RLS i RPC. Oferty mają w desktopie jedynie podgląd; mobile nadal używa dotychczasowego przejścia do CRM. Braki są jawne w aplikacji i dokumentacji, bez osadzonej strony jako substytutu widoku natywnego.

## Własny serwer

Warstwa `WorkspaceBackend` oddziela UI i lokalną kopię od dostawcy. W ustawieniach można przełączyć tryb Supabase / własny serwer. Kontrakt własnego serwera: `docs/desktop-native-api.md`. Obejmuje logowanie, odświeżanie, profil, synchronizację, Mój dzień i polecenia. **Implementacja serwera nie jest częścią tego etapu.** Nie przenosimy publicznego klucza Supabase w żądaniach do własnego serwera.

## Dystrybucja

```sh
./scripts/make-dmg.sh
```

Wynik: `build/Mavinci.dmg`. Domyślny podpis jest ad-hoc, do lokalnego uruchamiania. Dystrybucja do zespołu wymaga certyfikatu Developer ID i notaryzacji Apple, np. `SIGN_IDENTITY="Developer ID Application: …" ./scripts/build-app.sh`, następnie notaryzacja i staplowanie. Skrypty nie wysyłają aplikacji ani nie wdrażają CRM / mobile.


## Weryfikacja pierwszej wersji

Wykonano kompilację debug oraz release i weryfikację podpisu lokalnego pakietu `.app`; aplikacja została uruchomiona i pokazuje ekran logowania z publiczną konfiguracją Supabase. Nie przeprowadzono jeszcze testu po zalogowaniu na koncie sprzedawcy, testów zapisu w produkcji ani wykonania przygotowanej migracji. Nie budowano i nie wdrażano Next.js ani mobile.

## Aktualizacja 0.2 — nawigacja, kalendarz i strona wydarzenia

Dzwonek z licznikiem jest w prawym górnym pasku, obok odświeżania i wskaźnika pobierania. Usunięto go z bocznej listy. Tabele wypełniają wysokość od pierwszego wejścia, również przed zaznaczeniem. Wydarzenie otwiera się na osobnej stronie; przycisk Wróć przywraca poprzednią sekcję.

### Kalendarz i Apple Calendar

Natywny miesiąc, wybór dnia, wydarzenia wielodniowe, własne i zaproszone spotkania oraz terminy otwartych zapytań. Spotkania cykliczne używają wystąpień zapisanych przez CRM; klient nie tworzy drugiej serii. Kliknięcie wydarzenia otwiera jego natywną stronę. Wybór kalendarza jest filtrowany uprawnieniami `calendar_view` / `calendar_manage`; dane dodatkowo podlegają RLS.

Przycisk „Połącz z Kalendarzem Apple…” otwiera wybór zapisywalnego kalendarza lub utworzenie osobnego „Mavinci CRM”. System pyta o uprawnienie dopiero po świadomym użyciu przycisku. „Synchronizuj teraz” kopiuje **nazwę, termin i miejsce** wydarzeń oraz spotkań do wskazanego kalendarza. Jeśli to kalendarz iCloud lub innego konta, dane trafią do tego konta — interfejs uprzedza o tym przed zapisem. Prywatne wpisy nie są importowane do CRM. Zapytania są widoczne wewnątrz aplikacji, ale nie są eksportowane do Apple.

Powiązanie jest jednostronne i ręczne: CRM → Apple. Zapisany identyfikator i znacznik źródła chronią przed tworzeniem nowej kopii podczas zwykłego ponowienia. Usuwane są wyłącznie wpisy utworzone przez dane powiązanie dla spraw znikających / anulowanych; prywatne wpisy użytkownika są pomijane. Po niepotwierdzonym zapisie pozostają punkty kontrolne w Keychain. Link wydarzenia pozwala wrócić z Apple do Mavinci. **Wylogowanie z CRM nie usuwa kopii zapisanej w kalendarzu Apple**; użytkownik zarządza nią również w aplikacji Kalendarz. Dwukierunkowa i automatyczna synchronizacja nie są wdrożone.

Obsługa systemowa używa EventKit zgodnie z [dokumentacją dostępu Apple](https://developer.apple.com/documentation/eventkit/accessing-the-event-store). Wymaga pakietu `.app` z opisem uprawnienia w Info.plist. Do pracy developerskiej użyj:

```sh
cd desktop/mac
./scripts/dev-app.sh
```

Skrypt tworzy `build/Mavinci-Dev.app` w wariancie debug i uruchamia go z komunikatami w terminalu. Wcześniej zamknij drugą instancję Mavinci: obie używają tego samego konta i pęku kluczy. Nie używaj gołego `swift run` do sprawdzania uprawnień Kalendarza.

Transport przyrostowy kalendarza przygotowano w dodatkowej, niewykonanej migracji `20261101170000_native_calendar_sync.sql` (po `20261101160000_native_workspace_sync.sql`). Starsza funkcja bez zbioru calendar oraz brak RPC uruchamiają pełny odczyt kalendarza jako zgodną ścieżkę przejściową. Migracje nie są wykonywane podczas budowania aplikacji.

### Zakładki wydarzenia i rzeczywisty zakres operacji

Uprawnienia do wydarzenia oraz jego zarządzania są potwierdzane istniejącymi RPC bazy. Zakres finansowy pochodzi z `get_event_finance_access`, a dostęp do kart z ustawień pracownika / poziomu dostępu i przypisania, analogicznie do CRM. Brak uprawnienia nie uruchamia odczytu finansów. Dane zakładek są pobierane dopiero po ich otwarciu, zapisywane w szyfrowanej kopii konta, a błędy poszczególnych zbiorów są pokazane osobno. Bez internetu niedostępna wcześniej zakładka nie udaje pustego zbioru.

| Zakładka | Wdrożone natywnie | Pozostałe operacje |
| --- | --- | --- |
| Informacje | Dane, klient, organizacja, lokalizacja, terminy; edycja podstawowych pól; zaproszenie; wyznaczanie kierownika, przejęcie i zakończenie realizacji z notatką; przejęcie przygotowania i gotowość magazynu przez istniejące RPC | Złożony status handlowy, źródło przychodu, potwierdzenia e-mail i część reguł gotowości prezentowanych jako panele CRM |
| Etapy | Wszystkie etapy, przypisania osób, sprzętu i pojazdów; edycja istniejącego etapu | Dodawanie etapów i przydziałów, interaktywna oś czasu, konflikty i planowanie transportu |
| Agenda | Nagłówek, punkty i notatki; tworzenie agendy; dodawanie i edycja punktów / notatek; oznaczanie istniejącego PDF jako nieaktualny przed zmianą | Generowanie PDF, reorganizacja drzewa notatek, usuwanie i pełny układ do druku |
| Karta wesela | Odpowiedzi, osoby, harmonogram, muzyka, atrakcje | Edycja, formularz dla klienta, generowanie karty |
| Oferty | Oferty, pozycje, metadane, istniejące PDF | Pełny edytor ofert i wariantów, rabaty, marże, akceptacja, odrzucenie, wysyłka, generowanie PDF |
| Finanse | Podsumowanie obliczane przez serwer, koszty, faktury / rozrachunki, prowizje, gotówka; dodawanie i edycja oczekujących kosztów według zakresu | Wystawianie faktur, płatności, KSeF, zatwierdzanie kosztów i prowizji |
| Kalkulacje | Kalkulacje i pozycje | Pełny edytor z zasobami, obliczenia i zatwierdzanie |
| Umowy | Ustalenia z partnerem, umowy, natywna treść dokumentu i istniejące PDF | Generowanie, redakcja, podpisy, aneksy i pełne operacje umowy |
| Sprzęt i magazyn | Aktualny sprzęt i zestawy, lista załadunku, oznaczanie załadunku przez RPC z blokadami bazy | Dobór i rezerwacje, konflikty, egzemplarze, dokumenty, przegląd i zdjęcia |
| Zespół | Pełny zespół odpowiedzialności oraz przypisania; zapraszanie osoby, edycja obowiązków, odpowiedź na własne zaproszenie | Edycja uprawnień przypisania, wycofanie zaproszenia, rozmowy |
| Logistyka | Pojazdy, kierowcy i plan | Edycja przydziałów, trasy, przebiegi i zwroty |
| Podwykonawcy | Zlecenia, dane kontaktowe i dokumenty | Zamawianie, katalog, wytyczne, potwierdzenia i rozliczenie |
| Pliki | Foldery i pliki, dodawanie pliku do wybranego folderu (do 25 MB), autoryzowane pobieranie, natywny PDF / obraz i Zapisz jako | Tworzenie / przenoszenie / usuwanie folderów, nazwy i usuwanie plików |
| Zadania | Zadania wydarzenia; tworzenie i edycja tytułu, opisu, priorytetu, etapu i terminu | Pełne przypisania, komentarze, załączniki, usuwanie |
| Historia | Historia zmian według zakresu; bez uprawnienia finansowego nie są pobierane szczegóły dawnych wartości | Rozszerzone formatowanie wszystkich typów zmian |
| Ustalenia sprzedawcy | Oferty i dane z istniejącego RPC korespondencji | Rozmowy, kreator realizacji, kalkulacja prowizji i edytor ustaleń |
| Mavinci LIVE | Projekt, moduły i dostępy | Edycja manifestu, gry, generowanie, publikowanie i nadawanie uprawnień |

**Pełna strona z zakładkami nie oznacza jeszcze pełnej zgodności wszystkich czynności z CRM.** Pozostałe operacje są jawne również w stopkach odpowiednich zakładek. Żadna z tych czynności nie jest zastąpiona osadzoną stroną WWW. Pełne generatory ofert, umów i kalkulacji wymagają dalszego przenoszenia logiki, a nie prostych zapisów w tabelach.

Nie wdrażano migracji ani nie zmieniano reguł CRM/mobile. Mobile: nie dotyczy — zmiany dotyczą natywnego klienta i opcjonalnego transportu odczytu. Listy i karty używają istniejących źródeł; reguły realizacji i finansów pozostają w bazie.


### Sprawdzenie aktualizacji 0.2

Zakończono kompilację release i debug oraz sprawdzenie podpisów obu pakietów. Otworzono `Mavinci-Dev.app` z odtworzoną sesją konta CRM; odczyt interfejsu potwierdził nowe menu kalendarza i dzwonek obok odświeżania. Oględziny ujawniły potrzebę jawnego przekazania wysokości do HSplitView — wprowadzono GeometryReader i ponownie zbudowano oba pakiety. Nie wykonano zapisów w wydarzeniach ani Kalendarzu Apple. Nie potwierdzono jeszcze wszystkich zakładek na rzeczywistych wydarzeniach ani wszystkich typów danych. Problemy narzędzia odczytującego okna ograniczyły końcowe sprawdzenie wizualne; odczyt próbki procesu nie wykazał blokady głównego wątku aplikacji.

Pakowanie aplikacji odbywa się przez nowy podpisany katalog i jego podmianę; nie jest nadpisywany plik wykonywalny działającej instancji. Po kompilacji uruchom nowy pakiet, aby korzystać z aktualnego interfejsu. Skróty ⌘4 i ⌘5 prowadzą odpowiednio do Wydarzeń i Kalendarza.


Aktualny profil macOS uwzględnia `employees.finance_company_access` (model z wdrożonej migracji `20261101165000`). Pobieranie budżetu / przychodu używa serwerowego `canViewCommercials`, a koszty osobnego `canViewCosts`; uprawnienia te nie są utożsamiane. Zmiana poziomów finansowych w profilu unieważnia starą kopię.


## Aktualizacja 0.3 — codzienna praca sprzedawcy

1. **Kalendarz:** każdy wpis ma delikatne obramowanie i tło w kolorze kategorii z CRM (taki sam kolor w siatce i liście dnia). Brak kategorii używa firmowego złotego. Zapytania mają przerywaną linię. Nie dodano ramek wokół wszystkich dni. Źródło koloru jest pobierane z bazy, a nie wyliczane z tytułu wydarzenia.
2. **Moje zadania:** Kanban Do zrobienia / W trakcie / Do sprawdzenia / Zakończone, wyszukiwanie i opcjonalne ukrycie zakończonych. Przeciąganie między kolumnami lub menu Przenieś do zapisuje status i board_column istniejącą ścieżką z RLS i kontrolą updated_at. Nie ma optymistycznego przenoszenia ani kolejki offline. Priorytet i termin są na karcie. Szerokie okno pokazuje szczegóły obok tablicy; mniejsze otwiera modal. Tworzenie i edycja pozostają w formularzu natywnym.
3. **Wysokość list:** usunięto HSplitView z list i zbiorów karty wydarzenia. Układ HStack dostaje dokładny rozmiar z GeometryReader, a tabela wysokość niezależną od zaznaczenia i pustego podglądu. Na listach podgląd pojawia się dopiero przy zaznaczeniu i odpowiedniej szerokości; w mniejszym oknie są szczegóły modalne.
4. **Kontakty:** wyłącznie tabele CRM, bez frameworku Contacts, książki adresowej urządzenia, automatycznego importowania czy scalania prywatnych osób. Dotychczasowe dane już zapisane w CRM pozostają kartoteką CRM. Edytor zmienia imię, nazwisko, e-mail, telefon, komórkę, stanowisko, adres i notatki; wysyła wyłącznie zmienione pola i wymaga contacts_manage, aktualnej wersji oraz RLS. Nie udostępnia numerów dokumentów, PESEL ani rachunków bankowych.
5. **Kalendarz i Wydarzenia:** jeden predykat dostępu w kliencie macOS i ten sam zbiór wydarzeń z calendar; lista nie odczytuje innej, osobno zawężonej kopii. Uwzględniane są istniejące uprawnienia do wydarzeń / kalendarza / realizacji. Nie zmieniono uprawnień zapisanych pracownikom ani RLS. Domyślnie są ukryte wydarzenia przeszłe (według końca, a gdy go nie ma początku), anulowane, zakończone i rozliczone; przyszłe wydarzenie ze statusem samego zafakturowania nie jest uznawane za zakończone. Status wybierzesz filtrem. Pokaż również ukryte / Szukaj również w ukrytych poszerza filtr, a nie uprawnienia.
6. **Oferty:** analogiczny filtr domyślny: odrzucone, anulowane, wygasłe oraz związane z dawnym / zamkniętym wydarzeniem. Dla niezaakceptowanej oferty uwzględniany jest koniec ważności; historyczna data ważności zaakceptowanej oferty sama jej nie ukrywa. Wyszukiwanie i filtr statusu współpracują z włącznikiem ukrytych. To wyłącznie filtr widoku, bez masowej zmiany danych historycznych.
7. **Przetargi:** domyślnie aktywne, przed terminem i nieukryte. Lista pokazuje tytuł, zamawiającego, dopasowanie /100, termin i odliczanie, lokalizację, stan i obserwowanie. Filtry: zakres aktywne / moje / obserwowane / dopasowane, stan, tekst, przeszłe i ukryte. Szczegóły zawierają dane modalu CRM: opis, CPV, publikację, termin, wartość / walutę, opiekuna, źródło, notatki, status i ocenę manualną. Można obserwować, ukryć, przypisać do siebie / zwolnić oraz utworzyć zapytanie przez te same RPC assign_tender / create_inquiry_from_tender. Zapytanie istniejące otwiera się bez tworzenia drugiego. Po terminie przycisk tworzenia jest zablokowany; baza ponownie sprawdza warunki. Gdy przetarg jest prowadzony w zapytaniu, jego status wynika z etapu zapytania.
8. **Powiadomienia:** dzwonek otwiera drawer po prawej, bez opuszczania bieżącej sekcji. Są filtr nieprzeczytanych, pojedyncze i zbiorcze przeczytanie. Obsługiwane cele: zadanie, zapytanie, kontakt, wydarzenie / istniejąca zakładka, oferta, przetarg i spotkanie. Rekord spoza obecnych filtrów jest doczytywany autoryzowanym zapytaniem, a filtr ustawiany tak, żeby go pokazać. Nieobsługiwana sekcja ma komunikat, bez losowego przekierowania do strony głównej ani panelu WWW.

### Transport i uprawnienia 0.3

Nowa, niewykonana migracja `20261101213000_native_workspace_v3.sql` tworzy osobną odczytową funkcję `native_workspace_sync_v3`. Nazwa wersjonowana zapobiega korzystaniu ze starszej, zbyt ubogiej migawki. Funkcja ma SECURITY INVOKER, istniejące RLS i wąską projekcję pól. Zawiera kolory kategorii kalendarza, daty wydarzeń przy ofertach, pełne dane prezentacyjne przetargu, edytowalne pola kontaktu i metadata powiadomień. Bez migracji klient używa jawnie pełnych odczytów tych samych tabel — nie trzeba wykonywać migracji do samego uruchomienia nowej wersji. Migracja nie aktualizuje rekordów biznesowych, istniejących polityk, ról ani zakresów przypisanych pracownikom.

Nie zmieniano klientów CRM/mobile ani ich katalogu uprawnień. Ujednolicenie dotyczy nawigacji i prezentacji klienta macOS, a zakres rekordów nadal wymusza baza. Rozszerzony kontrakt przyszłego własnego serwera opisano w docs/desktop-native-api.md.

Przy zmianie sekcji powiadomienie o błędzie nie zwęża list. Skróty: ⌘1 Mój dzień, ⌘2 Zapytania, ⌘3 Kanban, ⌘4 Wydarzenia, ⌘5 Kalendarz, ⌘6 Kontakty, ⌘7 Oferty, ⌘8 Przetargi, ⌘9 panel powiadomień.


Powiadomienia procesu wydarzeń: dzienny digest trafia wyłącznie do autora wydarzenia. Drawer udostępnia bezpośrednie przyciski do wydarzeń ujętych w podsumowaniu. Odroczenie przypomnienia i pełna kolejka kolejnych kroków są obecnie dostępne w CRM.


## Aktualizacja 0.4 — CRM 1:1: menu, dashboard i motywy

Kierunek: aplikacja jest **odpowiednikiem 1:1 CRM w przeglądarce** (te same sekcje, ekrany, zakładki i kolejność), zbudowanym z natywnych elementów macOS: tabele natywne zamiast tabel HTML, arkusze zamiast modali, menu natywne zamiast „⋯”, systemowe potwierdzenia, wykresy Swift Charts, oś czasu i tablice kanban.

1. **Pasek boczny jak w CRM** — `GET /bridge/native/v1/navigation` zwraca menu pracownika liczone tą samą funkcją co pasek w przeglądarce (`navigationForUser` w `src/lib/CRM/navigation/getNavigationForUser.server.ts`: uprawnienia, realizacje, `navigation_order`). Pozycje z ekranem natywnym otwierają go w aplikacji; pozostałe (oznaczone ↗) tymczasowo otwierają stronę CRM w przeglądarce. Ostatnie menu jest zapamiętane na Macu do pierwszego odczytu.
2. **Dashboard jak `/crm`** — `GET /bridge/native/v1/dashboard` liczy dane funkcjami `dashboardData.ts` (te same co strona), tokenem pracownika. Kafelki, szybkie akcje, podsumowanie i aktywność są filtrowane na serwerze (`canView` / `canCreate`). Widok: „Mój plan” (oś czasu dziś / 3 dni z `get_employee_schedule`), trend sprzedażowy i lejek (Swift Charts), wpływy / wydatki / wynik kasowy, „Wymaga działania”, ostatnia aktywność, szybkie akcje i „Pozostałe wskaźniki”. Sprzedawca: oś czasu i „Mój dzień” jak w CRM. Dashboard odświeża się co 5 minut i na ⌘R.
3. **Motywy** — burgund, granat, ciemny i jasny jak w CRM (`employees.crm_theme`); Ustawienia → Wygląd. Zmiana zapisuje się w profilu i obowiązuje także w przeglądarce.

Budowanie z głównego katalogu projektu: `yarn build:mac` (→ `desktop/mac/build/Mavinci.app`), instalator: `yarn dmg:mac` (→ `desktop/mac/build/Mavinci.dmg`), uruchomienie: `yarn open mac` (zamyka działającą wersję i otwiera nowo zbudowaną).

Serwer: `src/app/bridge/native/v1/*` (Bearer — token Supabase z aplikacji, `src/lib/native/auth.ts`); bez klucza serwisowego. `dashboardData.ts` przyjmuje klienta z tokenem przez `withNativeDashboardClient` (AsyncLocalStorage, tylko na czas żądania). Mobile: nie dotyczy — zmiany dotyczą aplikacji na Maca i jej API.

## Aktualizacja 0.5 — Wiadomości 1:1

Pozycja „Wiadomości” w pasku bocznym otwiera ekran natywny odpowiadający `/crm/messages` (licznik nieprzeczytanych przy pozycji, odświeżany co minutę):

1. **Skrzynki** — „Wszystkie wiadomości”, „Formularz kontaktowy” i każda skrzynka z folderami Odebrane / Wysłane / Wersje robocze / Kosz oraz licznikami (wyciszone skrzynki szarym licznikiem, poza sumą). Kolejność skrzynek zmienia się przeciąganiem i zapisuje w CRM (`preferences.messages.mailboxOrder`). Prawy przycisk na „Odebrane” → „Oznacz wszystkie jako odczytane” (`/bridge/messages/mark-all-read`).
2. **Lista** — nadawca/odbiorca, temat, data jak w CRM („wczoraj o…”), typ, opiekun, „W lejku”, zajawka; strony po 50 przy przewijaniu; pamięć listy per skrzynka i folder. Wyszukiwanie (pole w pasku narzędzi, Enter — wyszukiwanie na serwerze; zakres dat pod ikoną kalendarza). Prawy przycisk — menu czynności (`MessageActionsMenu`); dwuklik — wiadomość w osobnym oknie.
3. **Podgląd** — temat, data, Od/Do/DW, czynności (Odpowiedz, Przekaż, Przypisz, Dodaj do zapytań, Utwórz zadanie, menu „⋯”), lejek sprzedaży i AI, treść HTML w `WKWebView` (bez JavaScriptu; obrazy historycznej stopki `cid:` odtworzone na serwerze; obrazy z adresów `http://` podnoszone do `https://` jak w przeglądarce; wiadomości bez własnych kolorów — formularz, zwykłe maile — w ciemnym motywie na ciemnym tle, newslettery na białym), załączniki: podgląd Quick Look i zapis na dysk; informacja o kopii wysłanej wiadomości.
4. **Arkusze** — nowa wiadomość / odpowiedź (z „Odpowiedz wszystkim”) / przekazanie: skrzynka nadawcza, Do/DW/UDW, temat, treść, załączniki, wysyłka teraz lub zaplanowana, podgląd ze stopką i szablonem firmy. Przypisanie pracownika, zapytanie z wiadomości (nowe lub dołączenie konwersacji), zadanie z wiadomości. Kosz i przywracanie z systemowym potwierdzeniem (poczta — synchronizacja z serwerem pocztowym).

5. **Kopia na dysku (local-first)** — wszystkie widoczne wiadomości (metadane) i ich treść są na dysku Maca, szyfrowane AES-GCM kluczem z pęku kluczy (`Application Support/Mavinci/Desktop/v1/mail-…`: `index.sealed` + osobny plik treści każdej wiadomości + otwarte załączniki). Ekran czyta wyłącznie z kopii — przełączanie skrzynek, folderów, filtr i podgląd działają natychmiast, także bez internetu (wtedy tylko do odczytu). Synchronizacja co 30 s w tle (i po każdej czynności): serwer porównuje skróty koszyków (`src/lib/native/sync.ts`, ten sam mechanizm co karty) i wysyła tylko zmienione koszyki — wychwytuje odczytania, gwiazdki, przypisania, kosz, usunięcia i zmiany z przeglądarki. Treść nowych wiadomości pobiera się od razu, starszych — w tle od najnowszych (postęp pod listą skrzynek). Liczniki nieprzeczytanych liczone z kopii (te same reguły co `crm_mailbox_unread_counts`). Lejek: zmienione wiadomości od razu, najnowsze 200 co 5 minut, otwierana — przy wyborze. Zmiany lokalne są widoczne od razu i chronione przed cofnięciem przez 20 s, zanim serwer je potwierdzi. Wylogowanie usuwa klucz i całą kopię.

Serwer: `GET/POST /bridge/native/v1/messages` (kopia: `op=mirror` / `mirrorItems` / `bodies` / `sales` / `touch`, `src/lib/native/mail.ts`) (`op=accounts|unread|list|search|details|employees|inquiries|attachment` oraz `read|star|trash|restore|assign|inquiry|link|task|fetch|preview|compose|send|order`) — te same zapytania co strona (`src/lib/CRM/messages/messagesQueries.ts`, wspólne z `messagesApi.ts`), tokenem pracownika. HTML wysyłki, cytatu i podglądu: `src/lib/native/messages.ts` (`buildCompanySignature.ts` przyjmuje klienta z tokenem). Załączniki wysyłki trafiają bezpośrednio do funkcji poczty (`send-email` / `schedule-email`), jak w przeglądarce. Kosz poczty, „oznacz wszystkie” i załączniki odebrane/wysłane — istniejące trasy `/bridge/messages/*` (przyjmują Bearer). Mobile: nie dotyczy — zmiany dotyczą aplikacji na Maca i jej API; strona w przeglądarce korzysta z tych samych funkcji (`messagesQueries.ts`).

### Ikona z brandbooka, potwierdzenia i postęp czynności

- **Ikona aplikacji** powstaje z sygnetu i kolorów brandbooka domyślnej firmy (Ustawienia → Moje firmy → Brandbook — jedyne źródło prawdy): sygnet (logo w wariancie „icon”) na zaokrąglonym kwadracie w kolorach marki (główny → drugoplanowy), poświata i obwódka w kolorze akcentu. Po zalogowaniu aplikacja pobiera brandbook (`GET /bridge/native/v1/brand`), ustawia ikonę w Docku, ⌘Tab i oknie „O programie” i zapisuje markę w `~/Library/Application Support/Mavinci/Desktop/v1/brand/`. `yarn build:mac` buduje z niej ikonę pakietu (Finder, Launchpad, instalator DMG) — `scripts/make-icon` + `iconutil`; do pierwszego logowania używa kopii `Resources/Brand/brand.json`. Zmiana sygnetu w brandbooku: od razu w Docku, w pakiecie — przy następnym budowaniu. Ten sam kod rysowania: `Sources/Mavinci/Brand/BrandIcon.swift`.
- **Potwierdzenia (snackbar)** na dole okna: zielony — czynność się powiodła, czerwony — błąd (z treścią z serwera), ciemny — informacja. Znikają same (sukces 4 s, błąd 9 s) albo po kliknięciu ×.
- **Postęp czynności**: podczas zapisu (kosz z synchronizacją serwera pocztowego, oznaczanie wszystkich, pobieranie poczty, wysyłka, przypisanie, zapytanie, zadanie, zapisy kart) okno pokazuje modalny wskaźnik z opisem i blokuje ponowne kliknięcia do odpowiedzi serwera.
- **Szerokości paneli** (lista skrzynek, lista wiadomości, podgląd) ustawia się przeciągając granice; zapisują się ok. 1 s po zmianie (od razu przy wyjściu z sekcji lub zamknięciu aplikacji) i wracają po ponownym otwarciu — `PersistentSplitView` (natywny `NSSplitView`), ustawienie tego Maca.

## Aktualizacja 0.6 — Spotkania (oś czasu jak w Teams)

Pozycja „Spotkania” w pasku bocznym otwiera ekran natywny odpowiadający `/crm/meetings` (licznik zaproszeń czekających na odpowiedź przy pozycji):

1. **Oś czasu** — widoki Dzień / Tydzień roboczy / Tydzień (siatka 24 h, godziny pracy 8–18 jaśniejsze, linia „teraz”, dziś wyróżnione, dni ustawowo wolne w nagłówku) oraz Lista (Nadchodzące / Zakończone). „Dziś” (⌘T), poprzedni/następny zakres (⌘← / ⌘→), wybór dnia. Nachodzące się spotkania dzielą szerokość kolumny.
2. **Edycja na osi** — przeciągnięcie spotkania zmienia termin (co 15 min, także na inny dzień), dolna krawędź — długość; zaznaczenie wolnego czasu (albo kliknięcie) otwiera nowe spotkanie z tym terminem. W cyklu zmiana dotyczy tylko tego terminu. Zmiana terminu prosi uczestników o ponowną odpowiedź.
3. **Firmowe i prywatne** — spotkanie prywatne (kłódka) widzą wyłącznie autor i uczestnicy, także administrator go nie widzi (RLS w bazie, plan dnia, kalendarz iCal). Filtry: Moje / Wszystkie, Firmowe / Prywatne, status, „Odrzucone przeze mnie”, „Czeka na moją odpowiedź”, wyszukiwanie.
4. **Statusy i odpowiedzi** — spotkanie: Wstępne (paski), Potwierdzone, Odwołane (przekreślone, bez przypomnień); uczestnik: Czeka na odpowiedź (znak zapytania) / Przyjmuję / Może / Odrzucam. Odpowiedź uczestnika trafia do organizatora jako powiadomienie.
5. **Szczegóły** w panelu bocznym (inspektor): termin, cykl, miejsce, organizator, uczestnicy z odpowiedziami, przypomnienia, notatki, odpowiedź na zaproszenie, status, Edytuj / Usuń (systemowe potwierdzenie, w cyklu „tylko ten” albo „ten i kolejne”). Prawy przycisk na spotkaniu — te same czynności.
6. **Formularz** nowego spotkania i edycji — jak w CRM: tytuł, rodzaj, status, cały dzień, początek i koniec, powtarzanie (zakres zmian w cyklu), lokalizacja z bazy lub tekst, kolor, uczestnicy (pracownicy i kontakty), trzy przypomnienia, notatki.
7. **Kopia na dysku** — wszystkie widoczne spotkania w `Application Support/Mavinci/Desktop/v1/meetings-….sealed` (AES-GCM, klucz w pęku kluczy). Ekran czyta z kopii od razu; synchronizacja przy starcie i co minutę pobiera tylko zmienione koszyki (`src/lib/native/sync.ts`) — także odpowiedzi uczestników i zmiany z przeglądarki. Zmiany z Maca widać od razu, a serwer je potwierdza.

Serwer: `GET/POST /bridge/native/v1/meetings` (`op=state|employees|contacts|locations|holidays`, `items|save|respond|delete`, `src/lib/native/meetings.ts`) — `save_meeting` z pełną listą uczestników, `respond_to_meeting`, `delete_meeting_occurrences`, tokenem pracownika (RLS). Baza: migracja `20261111120000_meeting_privacy_status.sql` (prywatność, status, odpowiedzi; uruchomić przed wdrożeniem). Powiadomienia i „Mój plan” otwierają spotkanie na tym ekranie (`mavinci://meeting/<id>` też).

## Aktualizacja 0.7 — Zapytania: lejek sprzedaży

Pozycja „Zapytania” otwiera natywny lejek 1:1 ze stroną `/crm/inquiries` (zamiast tabeli):

1. **Zwarty nagłówek** (dwa niskie wiersze, jak w CRM): zakres Moje / Współpracuję / Nieprzypisane / Zespół / Wszystkie z licznikami, widok Lejek / Lista, status Aktywne / Zamknięte / Wszystkie, ważona wartość lejka i — tylko gdy są — sprawy wymagające uwagi jako przełączniki-filtry (Bez opiekuna, SLA pierwszego kontaktu, Zaległe działania, Brak następnego działania). Opis kolejki w podpowiedzi ikony „i”. Wyszukiwanie w pasku narzędzi.
2. **Lejek** — kolumny etapów (Nowe → Przegrane) z liczbą i wartością; karta: tytuł, źródło, rodzaj, etap, szansa, telefon, e-mail, opiekun, wartość, następny kontakt (zaległy na czerwono), braki. Przeciągnięcie karty do innej kolumny zmienia etap (do „Przegrane” — przez formularz z powodem utraty). Na karcie: Przejmij, Odłóż 1h, Kontakt wykonany; prawy przycisk — pełne menu (także „Przenieś do etapu”).
3. **Lista** — tabela z etapem, opiekunem, wartością, szansą, następnym kontaktem i brakami.
4. **Szczegóły** w panelu bocznym: klient (Zadzwoń / Napisz), sprzedaż, wydarzenie, oferta i wydarzenie powiązane, „Pełne szczegóły w CRM”. **Obsługa zapytania** (arkusz): tytuł, etap, opiekun (z uprawnieniem do przydzielania), następne działanie, ostatni kontakt, wartość, prawdopodobieństwo, kategoria i powód utraty. Usuwanie: baza sprawdza powiązania — trwałe usunięcie z potwierdzeniem albo archiwizacja z powodem.
5. **Kopia na dysku** (`inquiries-….sealed`, AES-GCM) — lejek otwiera się od razu; synchronizacja co 30 s i po każdej czynności pobiera tylko zmienione koszyki.

W przeglądarce zostają (przyciski otwierają je w CRM): „Dodaj zapytanie” (`/crm/inquiries?new=1`), ustawienia SLA (`?sla=1`), przekazanie zapytania i pełna strona zapytania.

Serwer: `GET/POST /bridge/native/v1/inquiries` (`op=state|employees`, `items|move|update|claim|contact|snooze|remove`, `src/lib/native/inquiries.ts`) — te same zapytania i funkcje bazy co strona, tokenem pracownika.

## Aktualizacja 0.8 — Zadania: tablice jak w CRM

„Zadania firmowe” (`/crm/tasks`) i „Moje zadania” (`/crm/tasks/mine`) to natywne tablice 1:1 z CRM (zamiast dawnej tablicy z kopii kart):

1. **Kolumny** Do zrobienia / W trakcie / Sprawdzenie (na tablicy prywatnej: Do sprawdzenia) / Zakończone (Ukończone), licznik i „+” (nowe zadanie w tej kolumnie). Karty w kolejności z CRM: priorytet, termin, kolejność.
2. **Karta** jak `TaskCard`: tytuł, opis, priorytet, kto teraz pracuje (zielony), termin, komentarze, załączniki, przypisani (inicjały, Ty pierwszy), przycisk „Rozpocznij” / „Aktywny” (licznik czasu). Po najechaniu — Edytuj i Usuń; prawy przycisk — pełne menu („Przenieś do”, licznik, CRM).
3. **Przeciąganie** jak w CRM: do „W trakcie” — zadanie przypisuje Ciebie jako pracującego i uruchamia licznik (gdy działa licznik innego zadania — komunikat); z „W trakcie” do sprawdzenia lub zakończenia — pytanie „Zatrzymać czas pracy?”. Administrator może wyłączyć automatyczny licznik w ustawieniach CRM. Gdy licznik działa, nad tablicą widać zadanie i czas startu z przyciskiem „Zatrzymaj”; „Rozpocznij” przy działającym liczniku pyta o zatrzymanie poprzedniego.
4. **Wyszukiwanie** po tytule (pasek narzędzi) z liczbą wyników we wszystkich kolumnach.
5. **Formularz** nowego zadania i edycji: tytuł, opis, priorytet, kolumna, termin wykonania; na tablicy firmowej także załączniki (kilka plików, przesyłane po zapisie z ponowieniem bez duplikatów) i przypisani pracownicy (powiadomienie push jak w CRM). Na tablicy prywatnej nowe zadanie jest prywatne, a ponowienie zapisu nie tworzy drugiego.
6. **Szczegóły** w panelu bocznym: opis, termin, kto pracuje, autor, przypisani, powiązane zapytanie lub wydarzenie, załączniki (otwieranie), komentarze (dodawanie ⌘↩, usuwanie własnych), licznik, przeniesienie, Edytuj / Usuń, „Pełne szczegóły w CRM”.
7. **Kopie na dysku** (`tasks-company-…`, `tasks-mine-…`, AES-GCM): tablice otwierają się od razu, synchronizacja co 30 s i po każdej czynności pobiera tylko zmienione koszyki; zmiana na jednej tablicy odświeża drugą. „Moje zadania” działają także bez uprawnienia do modułu zadań (jak w CRM).

Pulpit, „Mój plan” i powiadomienia otwierają zadanie na jego tablicy (najpierw „Moje zadania”, potem „Zadania firmowe”).

Awatary przypisanych osób to zdjęcia z CRM z tym samym kadrem (`avatar_metadata`: przesunięcie, skala), pobierane raz do `~/Library/Caches/Mavinci/avatars` (usuwane przy wylogowaniu); bez zdjęcia — pierwsza litera imienia. Pasek boczny: grupa (np. „Zadania”, „Oferty”) ma własny znacznik wyboru, więc świeci tylko wybrana pozycja; kliknięcie grupy rozwija ją i otwiera pierwszą pozycję, a grupa z wybraną pozycją rozwija się sama.

Serwer: `GET/POST /bridge/native/v1/tasks` (`op=state|timer|detail|employees`, `items|save|move|delete|timer|comment|deleteComment`, załączniki `?op=attach` multipart; `src/lib/native/tasks.ts`) — te same zapytania i zapisy co CRM, tokenem pracownika.

## Aktualizacja 0.9 — Kontakty 1:1 z CRM

„Kontakty” (`/crm/contacts`) to natywny ekran zamiast dawnej listy z kopii kart:

1. **Lista jak w CRM** — organizacje (bez podwykonawców), kontakty firmowe i osoby prywatne w tej samej kolejności (organizacje, potem kontakty, od najnowszych). Zwarty nagłówek: typ z licznikami (Wszystkie / Organizacje / Kontakty / Osoby prywatne), „Tylko sprzedawcy”, przełącznik Kafelki / Lista. Wyszukiwanie po nazwie, e-mailu i telefonie (pasek narzędzi), pod listą „Wyświetlono N kontaktów”.
2. **Kafelek** jak na stronie: zdjęcie albo ikona typu, nazwa, oznaczenie sprzedawcy (status profilu; organizacja — „Sprzedawcy”), typ, e-mail, telefon, miasto, ocena, tagi, data dodania i liczba powiązanych osób / organizacji. **Lista** — natywna tabela z tymi samymi kolumnami. Prawy przycisk — szczegóły, karta w CRM, Zadzwoń, Napisz e-mail, Nowe spotkanie, Edytuj, Usuń.
3. **Szczegóły** w panelu bocznym: dane kontaktowe (telefony opisane jak na karcie kontaktu, strona WWW, adres z mapą), dane firmy (NIP, REGON, KRS, forma prawna, profil, status) albo stanowisko / uroczystość, osoby kontaktowe lub organizacje (kliknięcie pokazuje powiązaną kartę; „Główny”, „Decydent”), zapytania klienta (otwierają lejek), tagi, notatki, „Pełna karta w CRM” (Klient 360°, oferty, faktury, historia — w przeglądarce).
4. **Czynności**: Zadzwoń (telefon główny osoby prywatnej, komórkowy pozostałych), Napisz e-mail (okno nowej wiadomości ze skrzynką firmową, tematem „Wiadomość od Mavinci dla …” i powitaniem, jak w CRM), Nowe spotkanie (kontakt — a dla organizacji osoba główna — od razu jako uczestnik).
5. **Edycja** (`contacts_manage`): kontakt — imię, nazwisko, e-mail, telefony, stanowisko, NIP, adres, uroczystość, notatki (reguły osoby prywatnej jak w CRM); organizacja — nazwa, alias, profil, forma prawna, NIP, KRS, REGON, kontakt, adres, ocena, status, sprawdzane na serwerze tą samą walidacją co formularz w przeglądarce (błędy przy polach). **Usuwanie** z potwierdzeniem; baza nie pozwoli usunąć klienta z powiązanymi dokumentami. Nowy kontakt i podwykonawcy — formularz CRM (wyszukiwanie w GUS i CEIDG).
6. **Kopia na dysku** (`contacts-…`, AES-GCM): lista otwiera się od razu, synchronizacja co 60 s i po każdej zmianie pobiera tylko zmienione koszyki. PESEL i numer dowodu nie trafiają do kopii.

Zapytania (organizacja / kontakt w szczegółach), Spotkania (uczestnik-kontakt) i odnośniki do kontaktów otwierają kartę na ekranie Kontaktów.

Serwer: `GET/POST /bridge/native/v1/contacts` (`op=state`, `items|update|delete`; `src/lib/native/contacts.ts`) — te same zapytania co `clientsApi.getClientsList` i karta kontaktu, tokenem pracownika (RLS).

## Aktualizacja 0.10 — Zespół: pracownicy i karta pracownika (etap 1)

„Pracownicy CRM” (`/crm/employees`) to natywny ekran 1:1 z CRM:

1. **Lista** z wyszukiwaniem (imię, nazwisko, pseudonim, e-mail, stanowisko) i czterema widokami jak w przeglądarce: **Kafelki** (zdjęcie z kropką aktywności, pseudonim / imię, stanowisko lub rola, „Aktywny”, poziom dostępu, e-mail, telefon), **Lista**, **Szczegółowy** (natywna tabela: region, poziom dostępu, kolejność) i — dla administratora — **Oś czasu** zespołu (wiersze pracowników, dzień / tydzień / miesiąc, filtry: wydarzenia i fazy, spotkania, lejek i zadania, nieobecności; kliknięcie pozycji otwiera ją, kliknięcie osoby — jej plan). Menu „…” i prawy przycisk: Szczegóły, Resetuj hasło, Usuń (administrator). „Dodaj pracownika” (dane, hasło z „Generuj”, rola firmowa, dostęp do marek; po utworzeniu dane logowania do skopiowania) i „Poziomy dostępu” (CRM).
2. **Karta pracownika**: tło i zdjęcie z kadrem z CRM, odznaki (aktywny, poziom dostępu, rola), e-mail, telefon, region; zakładki według uprawnień jak w CRM.
   - **Przegląd** — Informacje podstawowe, Adres, Umiejętności, Widoczność na stronie (administrator), Notatki, Konta Email; **Edytuj / Zapisz / Anuluj** (własny profil albo `employees_manage`; e-mail prywatny, powiadomienia, rola firmowa i strona — administrator), **Usuń** trwale (administrator, nie własne konto).
   - **Wydarzenia** — przypisania z rolą, datą, godzinami i statusem (otwierają stronę wydarzenia).
   - **Oś czasu** — plan jak w Teams (Dzień / Tydzień, pasek „cały dzień”, linia „teraz”, filtry grup; własny profil — tydzień, cudzy — dzień) i **Nieobecności**: dodawanie wniosku, rozpatrywanie (zatwierdź / odrzuć z notatką), usuwanie.
   - **Zadania** (własny profil) — tablica „Moje zadania”; **Dokumenty** — jak w CRM (funkcja jeszcze niedostępna).
   - **Umowy i rozliczenia, Kwalifikacje, Konta Email, Uprawnienia** oraz wynagrodzenie i prowizje — kolejny etap (do tego czasu przycisk otwiera kartę w CRM).
3. **Kopia na dysku** (`team-…`, AES-GCM): lista otwiera się od razu, synchronizacja co 60 s pobiera tylko zmienione koszyki; dane karty (wydarzenia, konta e-mail bez haseł, nieobecności, plan) pobierane przy otwarciu.

Powiadomienia z pracownikiem i skróty pulpitu („Pracownicy”, „+ Nowy pracownik”) otwierają ekran Zespołu zamiast przeglądarki.

Serwer: `GET/POST /bridge/native/v1/employees` (`op=state|detail|schedule|createOptions`, `items|update|delete|resetPassword|create|absence|absenceDecision|absenceDelete`; `src/lib/native/team.ts`) — tokenem pracownika (RLS); zmiana hasła wspólna z CRM (`src/lib/employees/resetEmployeePassword.server.ts`), nowy pracownik przez tę samą funkcję `create-employee` co formularz w przeglądarce.

## Aktualizacja 0.11 — Zespół: Kwalifikacje, Konta Email, Uprawnienia (etap 2)

Zakładki administratora na karcie pracownika są natywne (1:1 z CRM):

1. **Kwalifikacje** — certyfikaty i uprawnienia (Aktywny / Wkrótce wygaśnie — 3 miesiące / Wygasło), umiejętności z poziomem, kategorią i latami doświadczenia, **prawa jazdy** (jedyne źródło kategorii dla floty; „Wygasa wkrótce” — 30 dni) z historią dawnych wpisów z certyfikatów i przeniesieniem brakującej kategorii. Dodawanie, edycja i usuwanie (`employees_manage`).
2. **Konta Email** — email osobisty i preferencja powiadomień, miniatura do stopki (wybór pliku lub przeciągnięcie; zdjęcie zmniejszane do JPEG), konto osobiste z IMAP/SMTP (zapisanych haseł aplikacja nie pobiera — puste pole = bez zmiany), „Zarządzaj dostępem” do kont wspólnych i systemowych, formularz kontaktowy, „Jak to działa?”.
3. **Uprawnienia** — pakiet roli firmowej (przywracanie), Zaznacz / Odznacz wszystko, marki i spółki, finanse według działalności, subskrypcje powiadomień i źródła webhooków, sekcje CRM (poziom dostępu, zakres danych „tylko własne”, zakładki wydarzeń / kontaktów / organizacji, zespół sprzedaży i menedżer, dodatkowe uprawnienia, sekcje Mavinci LIVE). Zapis po potwierdzeniu, z kontrolą zmiany w innym oknie; zmiana własnych uprawnień odświeża aplikację.

Serwer: `GET/POST /bridge/native/v1/employees/profile` (`op=qualifications|emails|permissions`, zapisy `certification|skill|license(+Delete)`, `emailAssignment|contactForms|personalEmail|personalAccount|signatureRemove`, `permissions`, miniatura `?op=signature` multipart; `src/lib/native/teamProfile.ts`). Katalog uprawnień i zakładek wspólny z CRM (`src/lib/accessSections.ts`, `src/lib/employees/permissionTabs.ts`).

Następny etap: **Umowy i rozliczenia** oraz wynagrodzenie i prowizje w „Przeglądzie”.

## Aktualizacja 0.11.1 — jedno pytanie o pęk kluczy zamiast kilkunastu

Aplikacja trzyma sekrety (połączenie, sesję, klucze szyfrujące kopie na dysku, powiązanie z Kalendarzem Apple) w **jednej** pozycji pęku kluczy `pl.mavinci.desktop` / `vault-v2`, odczytywanej raz na uruchomienie i trzymanej w pamięci. Wcześniej każda kopia (pulpit, plan, spotkania, zapytania, zadania, kontakty, zespół, wiadomości…) miała własną pozycję, więc po nowym budowaniu macOS pytał o hasło kilkanaście razy. Przy pierwszym uruchomieniu nowej wersji przenoszone są tylko połączenie, sesja i Kalendarz Apple (najwyżej kilka pytań, jednorazowo); kopie danych zaszyfrowane dawnymi kluczami są usuwane i pobierają się od nowa.

### Podpis i pęk kluczy

macOS pamięta zgodę „Zawsze pozwalaj” dla podpisu aplikacji. Podpis ad hoc (domyślny) jest inny po każdym budowaniu, więc po każdym `yarn build:mac` pojawi się jedno pytanie. Aby nie pojawiało się wcale, utwórz raz stały certyfikat do podpisu (skrypt użyje go automatycznie):

1. Otwórz **Dostęp do pęku kluczy** (Keychain Access) → menu **Dostęp do pęku kluczy → Asystent certyfikatów → Utwórz certyfikat…**
2. Nazwa: `Mavinci Development`, Typ tożsamości: **Samopodpisany główny**, Typ certyfikatu: **Podpisywanie kodu** → **Utwórz**.
3. W pęku „Logowanie” kliknij dwukrotnie certyfikat `Mavinci Development` → **Zaufanie** → „Podpisywanie kodu”: **Zawsze ufaj** → zamknij okno (macOS poprosi o hasło użytkownika).
4. `yarn build:mac` — w wyniku zobaczysz podpis certyfikatem. Przy pierwszym podpisie `codesign` może zapytać o dostęp do klucza — **Zawsze pozwalaj**. Przy pierwszym uruchomieniu aplikacji kliknij **Zawsze pozwalaj** w pytaniu o pęk kluczy; kolejne budowania już nie pytają.

Inny certyfikat (np. Developer ID do dystrybucji) wskazuje zmienna `SIGN_IDENTITY`.

## Aktualizacja 0.12 — Magazyn: Sprzęt (etap 1)

„Magazyn → Sprzęt” (`/crm/equipment`) to natywny ekran 1:1 z CRM:

1. **Lista** sprzętu i zestawów razem (od najnowszych), filtr Wszystko / Tylko sprzęt / Tylko zestawy, wyszukiwanie po nazwie, marce i modelu, widoki **Kafelki / Lista / Tabela**: miniatura, nazwa, ZESTAW / NIEAKTYWNY, ścieżka kategorii, stan „dostępne/wszystkie” (kolor jak w CRM), marka. Menu: Otwórz, Duplikuj, Usuń (`equipment_manage`). Pasek: Kategorie, Zestawy, Lokalizacje, Przewody, **Dodaj** (nowy sprzęt z kategorią, lokalizacją, miniaturą i pierwszymi jednostkami).
2. **Karta sprzętu**: nazwa ze stanem, marka i model, ścieżka kategorii; zakładki **Podstawowe** (z „Sprawdzeniem przed wydaniem”), **Parametry techniczne** (waga, wymiary, numer seryjny, kod kreskowy, instrukcja; dla przewodów długość i wtyki; specyfikacja prądowa z wtykami zasilania), **Informacje zakupowe** (z amortyzacją i wartością bieżącą), **Jednostki** (statystyki, sztuki z numerem, statusem, lokalizacją, datami, notatkami i zdjęciem; dodawanie kilku naraz, edycja, duplikowanie i usuwanie — także zaznaczonych; **historia zdarzeń**: notatka, inspekcja, serwis, naprawa, uszkodzenie, sprzedaż — ze zdjęciem i skutkami jak w CRM; dla przewodów i kategorii „ilościowych” — ilość na stanie), **Historia** zmian. **Edytuj / Zapisz / Usuń** z zapisem historii zmian jak w CRM.
3. **Kopia na dysku** (`warehouse-…`, AES-GCM): katalog i słowniki (kategorie, lokalizacje, wtyki) od razu, synchronizacja co 60 s tylko zmienionych koszyków; karta pobierana przy otwarciu.

Kolejne etapy: zakładki „Skład zestawu”, „Galeria”, „Pliki”, ekrany Zestawy, Przewody, Rental, Wtyki i Kategorie (do tego czasu — CRM w przeglądarce).

Serwer: `GET/POST /bridge/native/v1/warehouse` (`op=state|detail|unitEvents`, `items|create|update|delete|duplicate|unitSave|unitDelete|unitDuplicate|unitEvent|cableQuantity`, zdjęcia `?op=image` multipart; `src/lib/native/warehouse.ts`).

## Aktualizacja 0.13 — Magazyn: wszystkie sekcje (etapy 2 i 3), cały magazyn na dysku

Cały Magazyn działa natywnie i **z kopii na dysku** (`warehouse-v2-…`, AES-GCM): katalog, pełne karty sprzętu (dane, jednostki, skład, galeria, pliki, historia), zestawy, przewody z historią stanu, sprzęt wynajmu i słowniki. Ekrany otwierają się od razu (także bez sieci), a synchronizacja co 60 s (i przy wejściu na ekran) porównuje skróty zbiorów i pobiera tylko zmienione koszyki (`warehouse-catalog`, `warehouse-details`, `warehouse-kits`, `warehouse-cables`, `warehouse-rental`).

1. **Karta sprzętu → Skład zestawu** (`ComponentsTab`): komponenty wliczone i opcjonalne (z magazynu albo własna nazwa — „Integralny”, ze zdjęciem i parametrami technicznymi), podgląd komponentu; **Elementy wymagane i powiązane** — sprzęt, zestawy i przewody wymagane / zalecane / opcjonalne, ilość „na sztukę” albo „łącznie”, grupy alternatyw („Wybierz JEDEN”), dostępność; dodawanie z wyszukiwarką (Wszystko / Sprzęt / Zestawy / Przewody), edycja („Edytuj element zestawu”) i usuwanie w trybie edycji karty. Kliknięcie otwiera powiązany sprzęt, zestaw lub przewód.
2. **Galeria**: siatka zdjęć ze zdjęciem głównym, podgląd z przechodzeniem strzałkami, „Ustaw jako główne”, usuwanie, dodawanie wielu zdjęć naraz i **przeciąganiem z Findera** (`equipment-images`; zdjęcia ponad 10 MB zmniejszane).
3. **Pliki**: lista z rozmiarem i datą, otwieranie, **Pobierz** (do „Pobrane”, pokazuje w Finderze), zmiana nazwy (rozszerzenie zostaje), usuwanie, dodawanie i przeciąganie (`equipment-files`, do 50 MB).
4. **Zestawy** (`/crm/equipment/kits`): Kafelki / Lista / Tabela z wyszukiwaniem; podgląd zestawu (pozycje z dostępnością, przejście do sprzętu / przewodu), **Drukuj checklistę** (jak w CRM — z datą i osobą drukującą); tworzenie i edycja: miniatura (kliknięcie lub przeciągnięcie), nazwa, opis, kategoria główna, liczba kompletów z **kontrolą stanów** („Maksymalnie N kompletów…”, braki na czerwono — jak `checkKitInventory`), pozycje: sprzęt i przewody z ilością i notatką. Zapis przez `save_equipment_kit_checked` (blokada jak w CRM).
5. **Przewody** (`/crm/equipment/cables`): Lista / Kafelki / Tabela, wyszukiwanie (nazwa, wtyki, przeznaczenie), filtr przeznaczenia, „Niski stan”; **karta przewodu** (przeznaczenie techniczne, sposób ewidencji, wtyki IN/OUT ze zdjęciami, stan, jednostka, minimalny zapas, kierunkowy, lokalizacja, zakup, notatki) z edycją — zmiana stanu przez `adjust_cable_stock`, więc trafia do **Historii stanu**; **Dodaj przewód**; usuwanie; **Kategorie przewodów** (grupy i podkategorie, kolor, kolejność, aktywność — te same reguły co w CRM).
6. **Rental** (`/crm/equipment/rental`): sprzęt wynajmu od podwykonawców — wyszukiwanie, filtr kategorii, kafelki; karta (`/crm/subcontractors/rental/[id]`): podstawowe informacje, cennik netto/brutto z VAT, podwykonawca (e-mail, telefon), wymagane umiejętności, notatki, galeria (`rental-equipment-images`) — edycja i usuwanie.
7. **Wtyki** (`/crm/equipment/connectors`): Siatka / Lista / Kompaktowy, wyszukiwanie, dodawanie i edycja ze zdjęciem (`connector-thumbnails`), usuwanie.
8. **Kategorie** (`/crm/equipment/categories`): kategorie główne i podkategorie z właściwościami specjalnymi (np. `simple_quantity`, `requires_serial`), dodawanie, edycja, usuwanie.

Pozycje Zestawy, Przewody, Rental, Wtyki i Kategorie w pasku bocznym otwierają ekrany natywne; „Lokalizacje” nadal w CRM w przeglądarce.

Serwer: `GET /bridge/native/v1/warehouse?op=state` zwraca też stany zbiorów (`h_details`, `h_kits`, `h_cables`, `h_rental`) i słownik przeznaczeń przewodów; `POST op=items` z `set`; nowe operacje `componentAdd|componentUpdate|componentDelete|compatibleAdd|compatibleUpdate|compatibleDelete|imagePrimary|imageDelete|fileRename|fileDelete|kitSave|cableCreate|cableUpdate|cableDelete|cableCategorySave|connectorSave|connectorDelete|categorySave|categoryDelete|rentalUpdate|rentalDelete`, pliki multipart `?op=gallery|file|connectorThumb|rentalImage` (`src/lib/native/warehouse.ts`, `src/lib/native/warehouseOps.ts`).

## Aktualizacja 0.14 — Wydarzenia: lista 1:1 z CRM (etap 1)

„Wydarzenia” to natywna lista 1:1 z `/crm/events`, **z kopii na dysku** (`events-…`, AES-GCM; zbiór `events-list` synchronizowany przyrostowo co 60 s):

1. Te same wydarzenia co w CRM: widoczne przez RLS, **moje realizacje**, budżety z faktur (z korektami) albo planowany budżet, stan rozliczeń i płatności („Płatność po terminie · N dni”, „Oczekuje na przelew”, „Do rozliczenia”…) z wyróżnieniem pilnych, etapy operacyjne dla osób bez wglądu w sprzedaż, **podgląd sprzedaży kolegów** (tylko do odczytu).
2. Wyszukiwanie po nazwie, opisie, miejscu i kliencie (bez polskich znaków), filtry **statusu** i **kategorii**, **Pokaż / Ukryj rozliczone** (z liczbą ukrytych), sortowanie (data, nazwa, budżet, utworzenie; rosnąco / malejąco), widoki **Lista / Kafelki / Tabela**.
3. Menu wydarzenia: Otwórz (karta wydarzenia), **Zmień status**, Pokaż na mapie, Otwórz w CRM, **Usuń** (bezpieczne usuwanie jak w CRM — `delete-event-safe`). „Nowy event” otwiera kreator w CRM (`/crm/events?new=1`), „Kategorie” — słownik w CRM.

Karta wydarzenia na razie jak dotąd (zakładki z danymi, zapis do pracy bez internetu); natywna karta 1:1 z CRM — kolejne etapy.

Serwer: `GET/POST /bridge/native/v1/events` (`op=state`, `items|status|delete`; `src/lib/native/events.ts`).

## Aktualizacja 0.18 — Karta wydarzenia (etap 4): wszystkie zakładki natywnie

Wszystkie zakładki karty (poza Mavinci LIVE) działają na Macu natywnie — te same zapytania, funkcje bazy i reguły co CRM, kopia na dysku ze skrótem, zapisy z paskiem postępu i komunikatem.

- **Sprzęt, Logistyka, Harmonogram** — jak w poprzednich etapach (lista z dostępnością, checklista, pojazdy z trasą i kosztem paliwa, przekazania, oś faz z obsadą).
- **Agenda / Karta weselna** — edycja, PDF **na Macu** (Chrome), zapis w Plikach; karta weselna: sekcje, odpowiedzi, osoby i harmonogram.
- **Podwykonawcy** — zadania z walidacją, umowy (plik prosto do magazynu), wytyczne (generowanie i wysyłka).
- **Pliki** — drzewo folderów, lista / siatka / miniatury, przeciąganie z Findera, kopiuj / wytnij / wklej, zmiana nazwy, usuwanie, Quick Look, pobieranie.
- **Zadania** — tablica zadań wydarzenia (kolumny, przypisania z dopisaniem do zespołu, timer).
- **Oferta** (lista, usuwanie), **Historia** (oś czasu i widok po dacie), **Podsumowanie** (rozliczenie wydarzenia), **Finanse** (koszty, prowizje, plan płatności i raty, zamknięcie, faktury, gotówka), **Ustalenia** (rozmowa ze sprzedawcą).
- **Kalkulacje** — lista (suma, PDF, akceptacja), edytor z sekcjami, sumami, mocą i wagą, kolejnością (przeciąganie), pozycje z magazynu (stan), usługi personelu, pojazdy z kalkulatorem trasy i stawki paliwa, import z oferty; **PDF na Macu** do Plików → Kalkulacje, podgląd / pobierz / drukuj.
- **Umowa** — status z datami, podpis firmy, PDF bieżący i archiwalne, podpisane dokumenty (dodawanie PDF / JPG / PNG). Edytor treści umowy (dane, klauzule, szablon, depozyt, audyt AI, wystawienie, PDF, wysyłka, anulowanie) zostaje w CRM — treść składa edytor przeglądarki z bieżących danych.
- **Szczegóły** — zmiana klienta (indywidualny / firma, osoby kontaktowe) i nowa lokalizacja (wyszukiwanie Google, punkt na mapie).

**Lista wydarzeń** — natywna tabela narzędziowa jak w Wodawo: piktogram kategorii zamiast kolorowych odznak, Lp., sortowanie w nagłówkach kolumn (nazwa, termin, klient, miejsce, kategoria, status, rozliczenie, budżet), status jako kropka z opisem, zaległe płatności — czerwona etykieta z wykrzyknikiem, wyszukiwanie i „Pokaż” (Aktywne / Wszystkie / status) nad tabelą, karta zaznaczonego wydarzenia z boku (⌥⌘I); dwuklik albo ↩ otwiera kartę wydarzenia. Zespół realizacji widzi etapy operacyjne bez kwot.

**Karta wydarzenia na całą szerokość** — pierwsza zakładka to Szczegóły (informacje podstawowe, opis i notatki po lewej, akcje i budżet w środkowej kolumnie obok panelu Przeglądu), Przegląd (najważniejsze, kroki realizacji, kontrola przed wydarzeniem) to panel z boku przy każdej zakładce (przycisk „Przegląd”, ⌥⌘I). Zakładki w kolejności pracy sprzedawcy, pokrewne połączone z przełącznikiem: Szczegóły · Oferta i kalkulacje · Umowa · Sprzęt · Zespół i podwykonawcy · Harmonogram · Logistyka · Agenda · Ustalenia · Finanse i rozliczenie · Zadania · Pliki · Historia.

**Sprzęt** — zwarte wiersze z miniaturami; kliknięcie miniatury otwiera okienko z powiększonym zdjęciem i szczegółami (status, ilość w wydarzeniu, magazyn i rezerwacje, ile można dodać, zawartość zestawu, długość przewodu, przejście do karty sprzętu). Status jako kropka z opisem. Okno „Dodaj sprzęt” otwiera się od razu z kopii na dysku: katalog z dostępnością w terminie wydarzenia jest zbiorem synchronizowanym koszykami — w tle sprawdzany jest skrót i pobierane tylko zmienione koszyki (także po wejściu w zakładkę Sprzęt i po każdym dodaniu).

**Zespół i podwykonawcy jako natywne listy** — Zespół: tabela ze zdjęciem, Lp., osobą (korona przy kierowniku realizacji), rolą, zakresem obowiązków, statusem (kropka) i zaproszeniem; czynności w menu „…” i pod prawym przyciskiem (karta pracownika, kierownik realizacji, zaproszenie, timeline, rola i obowiązki w osobnym oknie, uprawnienia, usuwanie), dwuklik otwiera kartę pracownika. Podwykonawcy: przełącznik Zlecenia / Umowy; zlecenia w tabeli (miniatura sprzętu albo inicjały podwykonawcy, Lp., podwykonawca, zlecenie, termin, koszt, status, wytyczne, płatność) ze szczegółami zaznaczonego zlecenia pod spodem (regulowany podział), dwuklik — edycja; umowy w tabeli z podglądem pliku (dwuklik). Wynajem bez podwykonawcy oznaczony na pomarańczowo.

**Zarządzanie sprzętem** — przycisk „Zarządzaj sprzętem” otwiera jedno okno zamiast „Dodaj sprzęt”: z lewej Cały katalog / W wydarzeniu / Zestawy / kategorie, w środku tabela z miniaturami (podgląd zdjęcia, stanów i zawartości zestawu po kliknięciu), dostępnością w terminie (kropka) i kolumną „W wydarzeniu” z − / + i polem do wpisania liczby. Dodawanie, zmiana ilości i usuwanie (0) w jednym miejscu; dwuklik albo ↩ dodaje 1 szt., klawisze + / − zmieniają zaznaczoną pozycję, „Dodaj z notatką…” pod prawym przyciskiem. Zmiany zapisują się od razu (seria kliknięć to jeden zapis po 0,6 s, zapisy po kolei), komunikat na dole ma „Cofnij”. Na liście sprzętu wydarzenia: ilość z − / + bezpośrednio w wierszu, zaznaczanie klikiem / ⌘-klikiem / ⇧-klikiem, ⌫ usuwa zaznaczone, ⌘A zaznacza wszystko, Esc czyści; menu „…” i prawy przycisk: podgląd, karta sprzętu, zamiana, wynajem, komponenty, zawartość zestawu na checkliście, usuń / przywróć. Usuwanie bez pytania — z „Cofnij” (pozycja z oferty wraca przez przywrócenie, dodana ręcznie — ponownym dodaniem, bez notatki).

Okno „Zarządzaj sprzętem” zajmuje prawie całe okno aplikacji; pozycje dodane do wydarzenia są na górze listy; kolumny „W terminie” i „Inne wydarzenia”. Pod tabelą szczegóły zaznaczonej pozycji (zdjęcie, opis, zawartość zestawu, stany) i „Kto rezerwuje w tym terminie”: wydarzenia nakładające się z terminem, ilość, autor wydarzenia z e-mailem (gotowy temat) i telefonem, przejście do karty tamtego wydarzenia. Wydarzenia poza zakresem widoczności użytkownika liczone są bez nazwy. Na liście sprzętu: „Kto ma?” przy brakach i „Kto rezerwuje w tym terminie?” w menu otwierają okno na tej pozycji. Serwer: `tabQuery equipment/reservations` (`equipment_bookings` dla sprzętu, `event_equipment` dla zestawów — te same źródła co `check_equipment_inventory_for_event`).

**Ustalenia sprzedawcy w pracy realizacji** — ustalenia ofert powiązanych z wydarzeniem (`seller_offer_arrangements`: montaż, start, koniec, demontaż, dni wydarzenia, sala, liczba osób, wymagania techniczne i logistyczne, kontakty na miejscu, termin materiałów) są widoczne bez kwot dla każdego, kto widzi wydarzenie: karta „Ustalenia sprzedawcy” na górze Przeglądu (fakty, kontakty z telefonem i e-mailem, wersja i autor zmian, stan potwierdzenia kierownika realizacji, przycisk „Zapoznałem się z ustaleniami” / „…ze zmianami”) oraz zwijany pasek „Ustalenia sprzedawcy” w zakładkach Harmonogram (terminy), Agenda (godziny, dni, sala, osoby), Sprzęt (wymagania techniczne), Logistyka (wymagania logistyczne, miejsce, materiały) i Zespół (kontakty na miejscu). Zmiana ustaleń po potwierdzeniu — oznaczenie „zmienione po potwierdzeniu”. Wymaga migracji `supabase/migrations/20261111220000_event_arrangements_handoff.sql` (tabela potwierdzeń, `get_event_arrangements`, `acknowledge_event_arrangements`); bez niej karta pokazuje komunikat o migracji.

**Harmonogram krok po kroku** — nad osią pasek „Przygotowanie harmonogramu” (zwijany) z pięcioma krokami i stanem każdego: ① Fazy — „Utwórz z umowy i ustaleń” tworzy brakujące fazy Montaż / Realizacja / Demontaż (montaż od terminu z ustaleń sprzedawcy albo umowy do startu wydarzenia, realizacja w terminie wydarzenia, demontaż od końca lub terminu demontażu przez domyślny czas typu fazy; bez nakładania na istniejące fazy, z podglądem godzin przed zapisem); ② Zespół na fazach — „Dopasuj do faz” przypisuje osoby bez godzin do faz pracy (bez załadunku i rozładunku), osoby z konfliktem lub nieobecnością pomija i wymienia; ③ Auta — liczba aut bez fazy, „Czasy przejazdu” i przejście do Logistyki; ④ Kontrola — nakładające się fazy, osoby bez godzin, auta bez fazy; ⑤ Wysyłka — „Wyślij zespołowi” wysyła aktualny harmonogram każdej osobie przypisanej do faz (zablokowane przy nakładaniu się faz). Te same zapisy co ręcznie.

**Pomoc przy etapach** — przy każdym kroku „Przygotowania harmonogramu” i przy każdej sekcji Rozliczenia jest przycisk „?” z opisem, co robi dany etap i po co (okienko obok przycisku).

**Mavinci LIVE wyłączone na Macu** — pozycja menu i zakładka karty wydarzenia są ukryte w aplikacji (`Workspace.hiddenModules`, filtr zakładek karty); CRM w przeglądarce bez zmian.

**Instrukcja dla użytkowników** — dokument „Mavinci na Maca — instrukcja” (Claude Docs) opisuje każdą część aplikacji: co robi i po co.

**Ustalenia (zakładka)** — oferty sprzedawców jako natywna lista z boku (wyszukiwanie, nieprzeczytane), po prawej karta ustaleń z potwierdzeniem i rozmowa. Prowizje w Rozliczeniu: rodzaj beneficjenta i status jako kropka.

**Rozliczenie** — Finanse i Podsumowanie to jedna zakładka „Rozliczenie”. U góry pasek wyników: przychód netto, koszty, marża (kwota i %), prowizje i zysk po prowizjach — wykonanie z podsumowania wydarzenia, plan z finansów (zaakceptowana oferta / kalkulacja); kliknięcie przenosi do sekcji. Z lewej sekcje w kolejności przepływu pieniędzy: Przychody (klient, sposób rozliczenia i terminy płatności, faktury, przychody netto podsumowania), Koszty (koszty wydarzenia, budżet gotówkowy dla admina, koszty netto podsumowania: wykonawcy, koszty bezpośrednie, ekipa), Marża i wynik (strata, kafle, rentowność plan / wykonanie, wynik podsumowania), Prowizje (rejestr prowizji i poleceń, wyliczenie prowizji pracowników i sprzedawców, podział udziałów, narzuty zewnętrzne), Zamknięcie (stan i obieg podsumowania, zamknięcie wydarzenia, historia). Te same czynności i uprawnienia co wcześniej, bez powtórzeń między sekcjami.

**Agenda jako scenariusz** — punkty programu w kolejności z godziną, czasem trwania (w godzinach; − / + co 5 min albo gotowe wartości) i godziną końca; edycja w miejscu bez trybu „Edytuj”, zapis od razu (po chwili bez zmian, stan zapisu w nagłówku; puste pola wstrzymują zapis). Przeciągnięcie punktu albo „Przenieś wyżej / niżej” zmienia kolejność i przelicza godziny kolejnych punktów; godzina pierwszego punktu przesuwa cały program, godzina dalszego punktu zmienia czas trwania poprzedniego; „Wstaw punkt poniżej”, „Duplikuj”, ⌘↩ — nowy punkt, ⌫ — usunięcie z „Cofnij”. Godzinę można wpisać jako „19”, „1930” albo „19:30”. Uwagi w panelu obok, PDF w menu „PDF”. Baza bez zmian: kolejność w `order_index`, godziny w `time`, koniec programu w `event_agendas.end_time`.

**Harmonogram** — oś faz zaczyna się od góry (przewijanie w dwóch osiach nie centruje już mniejszej treści, bez pustego pasa nad fazami); czasy trwania w godzinach — „2 h (120 min)” w oknie fazy i przy typach faz, „4 h” / „3 h 15 min” na osi.

**Pozostałe listy karty jako natywne tabele** — Oferty (Lp., numer, klient, status-kropka, brutto, netto, ważność; dwuklik otwiera ofertę), Kalkulacje (status, PDF, pozycje, suma; dwuklik — edytor), Historia zmian (autor, kiedy, czynność, dotyczy, opis, przed → po; filtr rodzaju, szczegóły zaznaczonej zmiany pod tabelą, dwuklik — karta osoby), a w panelach Finansów i Logistyki — wiersze z wyrównanymi kolumnami i nagłówkiem: faktury, koszty (kropka statusu, czynności w „…” i pod prawym przyciskiem), pojazdy (miniatura, kierowca, wyjazd, dystans, koszt, status, konflikt na czerwono; dwuklik — edycja) i harmonogram logistyczny. Pliki — do omówienia osobno.

W CRM pozostają: kreator i wysyłka oferty, wysyłka kalkulacji e-mailem, edytor umowy, faktury z wydarzenia, sposób rozliczenia i panel prowizji w Szczegółach, folder Mac / iCloud, Mavinci LIVE.

## Aktualizacja 0.17 — Karta wydarzenia (etap 3): przegląd przepływu, przestrzeń realizacji, Zespół

**Poprawki przepływu karty** (sprawdzone z kodem CRM):
1. Nagłówek jak w CRM: klient według typu (firma / „Klient:” dla osoby prywatnej), „Kontakt:”, „Autor:”, **stan sprzętu** (do wydania / wydany / czeka na zwrot / rozbieżności / zwrócony — kliknięcie otwiera Sprzęt).
2. Baner **„Oferta sprzedawcy przyjęta — wydarzenie do przygotowania”** z przejściem do Ustaleń; bez żadnej zakładki — komunikat „Brak dostępu do danych tego wydarzenia”.
3. Akcje jak w CRM: **Edytuj** i **Duplikuj** tylko z zarządzaniem wydarzeniem, **Usuń** tylko dla administratora; „Zmień status” prowadzi do Szczegółów → Akcje (z regułami statusów magazynu, zamiast uproszczonego okna).
4. Powiadomienia i linki otwierają właściwą zakładkę (np. Szczegóły, Podsumowanie — wcześniej trafiały na Przegląd).
5. Podgląd sprzedaży kolegi: poprawne pola (kategoria, klient), sprzedane usługi, zakres dostępu.

**Przestrzeń realizacji** (ekipa i kierownik realizacji bez danych handlowych) — natywnie zamiast przejścia do CRM: kroki, zakres, lokalizacja z wymiarami, prądem i przyłączami, rzutami i zdjęciami, wybrane sale ze sceną / DJ, kontakt; **kierownik realizacji** (Przejmij realizację / Zrealizowane z notatką); Timeline, Agenda, Sprzęt, Zespół (Zadzwoń / SMS / E-mail), Logistyka, Podwykonawcy, Pliki (podgląd w aplikacji).

**Zespół**: osoby z przypisań i z odpowiedzialności (autor, sprzedawca, magazyn, kierowca…), status zaproszenia, **kierownik realizacji** (mianuj / odbierz), **Wyślij zaproszenie**, **Wyślij aktualny timeline**, rola i obowiązki, **uprawnienia w wydarzeniu**, usuwanie; **Dodaj osobę** (fazy osoby, poziom dostępu, uprawnienia, zaproszenie z timeline). Zespół na dysku.

## Aktualizacja 0.16 — Karta wydarzenia (etap 2): Przegląd i Szczegóły natywnie

**Przegląd** 1:1 z CRM, z kopii na dysku (osobny skrót przeglądu — odświeżanie po powrocie do aplikacji, po zmianie karty i przyciskiem):
1. **Kroki realizacji**: postęp, „Czekamy na” (z telefonem do osoby), etapy zwijane, wiersz kroku (status, termin, ilość, dostawca, zamówienie, dostawa, notatka, blokady, historia), czynności (Biorę to, Rozpoczynam / Zamówione, Gotowe, Zgłoś problem, Pomiń, Otwórz ponownie) z oknem notatki i pól zamówienia tam, gdzie CRM go wymaga, **Dodaj krok**, **Pomoc** (ta sama treść co w CRM), link do zakładki, w której krok się zamyka.
2. **Kontrola przed wydarzeniem** (gdy możesz zarządzać wydarzeniem; bez pozycji umowy i płatności bez obszaru dokumentów), zaakceptowane nakładanie pracy.
3. **Najważniejsze**: Twoja rola, kolejność według roli (kierownik / kierowca / magazyn), termin, załadunek, miejsce z mapą, kierownik realizacji, magazyn (**Poproś o przyjęcie**, **Napisz do magazynu**), sprzęt, transport, kontakt na miejscu z telefonem.
4. Bez kroków w bazie — dotychczasowe panele realizacji i magazynu (jak w CRM).

**Szczegóły**: firma realizująca (logo z brandbooka, **zmiana firmy**), termin, **zmiana lokalizacji** z listy, **sale i scena / DJ**, klient (przejście do kontaktu) albo kontakt na miejscu, opis, notatki; kolumna **Akcje**: kategoria, liczba ofert, **status eventu** (statusy magazynu ustawia magazyn; „Rozliczony” oznacza faktury jako zapłacone), **potwierdzenie e-mail dla klienta** (podgląd odbiorcy, historia wysyłki), **checklista sprzętu** (podgląd PDF); **Budżet** liczony jak w CRM (oferta: rabat, netto, VAT, brutto, logistyka, koszty i wynik; przychód faktyczny, realizacja). Pod spodem — zakres Twojego dostępu. Sposób rozliczenia i prowizje — na razie w CRM.

Serwer: `GET /bridge/native/v1/events/card?op=overview|details|companies|locations|confirmationPreview|checklist|stepsHelp`, `POST` `op=rpc` (lista dozwolonych funkcji karty), `detailsStatus`, `category`, `company`, `rooms`, `sendConfirmation` (`src/lib/native/eventCard.ts`).

## Aktualizacja 0.15 — Karta wydarzenia (etap 1) i lokalny silnik PDF

**Lokalny silnik PDF.** Wydruki CRM składane z HTML przez Chromium powstają na Macu: serwer zwraca zadanie wydruku (`?render=local` — dokładnie ten HTML i te ustawienia, które dostaje Playwright), a aplikacja drukuje je w Chrome zainstalowanym na komputerze (bez okna, przez DevTools Protocol, `Page.printToPDF` z parametrami przeliczonymi jak w Playwright; fonty Inter z paczki aplikacji — te same pliki i ten sam CSS co na serwerze). Przeglądarka zostaje w tle 10 minut, więc kolejne wydruki są natychmiastowe; zamyka się razem z aplikacją. Bez Chrome (ani Chromium / Edge / Brave) — PDF z serwera jak dotąd. Pierwszy wydruk: **Karta imprezy**. Kolejne (agenda, kalkulacje, karta wesela, umowy, checklista sprzętu) dochodzą razem z ich zakładkami — dokumenty zapisywane w CRM Mac odsyła do serwera (`?finalize=1`), który robi resztę tym samym kodem.

**Karta wydarzenia** (`/crm/events/[id]`) — nowa, natywna, **z kopii na dysku** (`event-cards-…`; ostatnio otwierane i wydarzenia z najbliższych 2 tygodni pobierane w tle, odświeżanie tylko po zmianie skrótu):
1. Dane i uprawnienia dokładnie jak strona CRM (ten sam kod serwera `fetchEventByIdWith`; zakładki według obszarów dostępu, zawężeń pracownika, Finansów i Ustaleń).
2. Nagłówek: nazwa, status, kategoria, termin, miejsce, klient; **Karta imprezy** (PDF lokalnie, podgląd z zapisem), **Zmień status**, **Usuń wydarzenie**, Odśwież, Otwórz w CRM.
3. **Przegląd**: zaproszenie do zespołu (Akceptuj / Odrzuć), najważniejsze informacje, realizacja i przygotowanie magazynowe (kierownik, przejęcie, gotowość).
4. **Szczegóły**: firma realizująca, **termin z edycją**, lokalizacja z mapą, informacje o kliencie (e-mail, telefon), budżet, **opis i notatki z edycją**.
5. Podgląd sprzedaży kolegi (tylko odczyt). Pozostałe zakładki — na razie widok danych wydarzenia i przycisk „Otwórz w CRM”; przenoszone kolejno według listy kontrolnej `docs/mac-event-card-parity.md`.

Serwer: `GET/POST /bridge/native/v1/events/card` (`src/lib/native/eventCard.ts`); wydruki: `src/lib/print/printJob.server.ts`, `?render=local` w `/bridge/events/[id]/card`.
