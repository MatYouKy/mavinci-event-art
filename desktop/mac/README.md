# Mavinci na macOS

Aktualna wersja: **0.2.0**. Bieżący zakres wydarzeń i kalendarza oraz dokładna macierz brakujących operacji znajdują się w sekcji „Aktualizacja 0.2” poniżej. Opis pierwszego etapu pozostawiono jako historię zakresu.

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
- Bez połączenia dane są wyłącznie do odczytu. Kopia jest dostępna maksymalnie 24 godziny od kompletnego udanego odświeżenia. Zmiana efektywnego profilu usuwa stare dane; wylogowanie usuwa klucz kopii, plik i lokalną sesję. Cofnięcia uprawnień nie da się wykryć bez połączenia — to ograniczenie każdej kopii offline.
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
