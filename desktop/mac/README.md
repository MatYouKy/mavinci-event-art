# Mavinci na macOS

Aktualna wersja: numer w pliku `VERSION` — ostatnie opublikowane wydanie; każde `yarn release` podnosi go o jeden, kluczowa zmiana — `yarn release minor` (instalator i aktualizacje w aplikacji — sekcja „Instalator i aktualizacje”). Bieżący zakres natywny i aktualna lista tego, co zostaje w CRM — sekcja „Aktualizacja 0.19 — aktualny zakres natywny” poniżej, uzupełniona o „Aktualizację 0.20” (Flota, Czas pracy, Bazy danych, Lokalizacje, Strona, Kampanie e-mail), „Aktualizację 0.21” (Finanse) i „Aktualizację 0.22” (Finanse: wyciągi, uzgodnienie, deklaracje, przekazanie księgowej, faktury, KSeF, koszty i wypłaty; rozliczenie i prowizje wydarzenia w panelu bocznym karty; prowizje i rozliczenie przy wypłacie na karcie pracownika). Pozostałe sekcje „Aktualizacja …” opisują kolejne etapy jako historię zakresu (to, co w starszej sekcji było „w CRM”, mogło już przejść na Maca). Szczegóły techniczne każdej zmiany: wpisy „Mac: …” w `docs/mobile-parity.md`.

Natywna aplikacja SwiftUI, macOS 14 lub nowszy, Swift 5.9+. Katalog `desktop/mac` jest równorzędny z `mobile`. Bez osadzonego panelu WWW i zewnętrznych bibliotek Swift.

## Uruchomienie

Z katalogu projektu:

```sh
node desktop/mac/scripts/import-env.cjs
cd desktop/mac
./scripts/build-app.sh
open build/Mavinci.app
```

Import czyta `.env`, `mobile/.env` i `mobile/.env.local`, ostatnie wartości mają pierwszeństwo. Zapisuje **wyłącznie publiczny adres i klucz anon/publishable Supabase** w ignorowanym `Resources/Configuration.json`. Nie kopiuje żadnego pliku `.env`, klucza `service_role`, haseł SMTP ani sekretów integracji. Nie wypisuje wartości do terminala.

**Połączenie wbudowane w program.** `scripts/build-app.sh` (także `yarn build:mac` i `yarn release`) przed kompilacją uruchamia `scripts/embed-connection.cjs`: z `Resources/Configuration.json` bierze tylko źródło danych, adres serwera, publiczny klucz aplikacji i (opcjonalnie) adres CRM, sprawdza je (HTTPS, wyłącznie klucz anon/publishable) i zapisuje do ignorowanego `Sources/Mavinci/EmbeddedConnection.generated.swift` jako bajty zamaskowane losowym kluczem (flaga kompilacji `MAVINCI_EMBEDDED_CONNECTION`, `EmbeddedConnection.swift`). W pakiecie `.app` nie ma już pliku konfiguracji. Zainstalowana aplikacja (kompilacja release) łączy się wyłącznie z wbudowanym połączeniem — nie ma zakładki „Połączenie”, a połączenie zapisane dawniej w pęku kluczy usuwa przy uruchomieniu; bez `Resources/Configuration.json` kompilacja release (i `yarn release`) się nie wykona. Zmiana serwera = nowe `Configuration.json` (`import-env.cjs`) i nowe wydanie. Klucz publiczny jest z natury jawny dla aplikacji (dane chronią logowanie pracownika i uprawnienia w bazie) — maskowanie tylko nie wystawia go na widok w programie i pakiecie.

Kompilacja deweloperska (`CONFIGURATION=debug`, `scripts/dev-app.sh` → Mavinci-Dev.app) ma w Ustawieniach zakładkę „Połączenie” do testów z innym serwerem: połączenie zapisane tam w pęku kluczy → wbudowane → `MAVINCI_CONFIGURATION_FILE` (pełna ścieżka do pliku JSON, np. przy `swift run`) → zmienne `SUPABASE_URL` / `SUPABASE_ANON_KEY`. Xcode (`Package.swift` → schemat Mavinci → My Mac) buduje bez wbudowanego połączenia — wtedy `MAVINCI_CONFIGURATION_FILE` albo zakładka „Połączenie”.

Logowanie: konto pracownika z CRM, e-mail i hasło. Nie wpisano na stałe identyfikatora sprzedawcy ani jego sesji. Profil jest potwierdzany przez `auth_user_id` i `is_active`, analogicznie do aplikacji mobilnej.

## Działający zakres pierwszego etapu

| Sekcja | Zakres |
| --- | --- |
| Mój dzień | Istniejące `get_my_sales_day`: kontakty na dziś, oferty bez odpowiedzi, przetargi, lejek i własne zadania; przejścia do natywnych szczegółów. |
| Zapytania | Lista i podgląd, wyszukiwanie, filtr „Tylko moje” / „Otwarte”, przejęcie, potwierdzenie kontaktu z opcjonalnym kolejnym terminem, odroczenie o godzinę. Istniejące RPC z CRM. |
| Moje zadania | Zadania prywatne i przypisane jak `mobile/src/services/employeeTasks.ts`; tworzenie prywatnego zadania, edycja tytułu, opisu, priorytetu, terminu i etapu. Aktualizacja z kontrolą `updated_at`. |
| Kontakty | Lista aktywnych kontaktów i podstawowe dane, uruchomienie systemowej obsługi telefonu i e-maila. |
| Wydarzenia | Lista i podgląd podstawowych danych dostępnych według RLS; bez danych finansowych. |
| Oferty | Lista i podstawowe metadane oferty, powiązanie z zapytaniem / wydarzeniem. Nie ma jeszcze edytora ani kwot i kalkulacji. |
| Przetargi | Lista, termin, stan i powiązanie z zapytaniem; konfiguracja filtrów i przeliczenie ocen. |
| Powiadomienia | Lista, filtr nieprzeczytanych, odczyt treści, indywidualne oznaczenie przeczytania, obsługiwane powiązania natywne. |

Tabele ze zmianą zaznaczenia, sortowaniem nagłówkami, wyszukiwaniem, menu kontekstowym i szczegółami obok listy. SF Symbols, systemowe menu, pola i formularze; interfejs po polsku. ⌘R — odśwież, ⌘1–3 — główne sekcje, ⌘N / ⌘E — nowe zadanie / edycja, ⇧⌘N / ⇧⌘T — nowe okno / nowa karta. Instrukcja jest dostępna pod znakiem zapytania w pasku bocznym.

## Uprawnienia, dane lokalne i synchronizacja

- Backend pozostaje źródłem prawdy. Używany jest publiczny klucz z tokenem zalogowanego użytkownika. RLS i istniejące funkcje wyznaczają dostęp, firmy i odpowiedzialność. Nie używamy `service_role` w aplikacji.
- Menu i czynności są dodatkowo filtrowane po uprawnieniach. Przed zapisem aplikacja potwierdza profil na serwerze. Nie implementuje własnych reguł finansowych.
- Sesje, token odświeżania, ustawienia połączenia i klucz szyfrowania są w Keychain. Kopia danych jest szyfrowana AES-GCM w Application Support/Mavinci/Desktop/v1 i oddzielona według źródła danych i konta.
- Start bez czekania: po uruchomieniu aplikacja od razu pokazuje kopię z dysku (zbiory, dashboard, plan dnia, menu, Wiadomości — kopia do 30 dni), a w tle dociąga tylko zmiany w kolejności ekranu: dashboard i menu → plan dnia → zbiory (skróty koszyków) → Wiadomości. Zapis jest możliwy dopiero po potwierdzeniu profilu na serwerze. Bez połączenia dane są wyłącznie do odczytu, a kopia starsza niż 24 godziny od kompletnego udanego odświeżenia jest ukrywana. Zmiana efektywnego profilu usuwa stare dane; wylogowanie usuwa klucz kopii, plik i lokalną sesję. Cofnięcia uprawnień nie da się wykryć bez połączenia — to ograniczenie każdej kopii offline.
- Odświeżanie co 60 s, tylko gdy aplikacja jest aktywna, oraz przy powrocie i ⌘R — jedno niezależnie od liczby otwartych okien. Edycja formularza wstrzymuje automatyczne odświeżanie. Błąd jednego modułu nie przerywa pozostałych. Błędy dostępu / schematu usuwają dane tego modułu; awaria transportu zachowuje ostatnią poprawną kopię.
- Wynik zapisu musi być potwierdzony. Nie ma automatycznych ponowień operacji tworzenia. Po przerwaniu połączenia należy odświeżyć dane przed ponowną próbą.

### Synchronizacja przyrostowa — osobna migracja do wdrożenia

Plik `supabase/migrations/20261101160000_native_workspace_sync.sql` tworzy **wyłącznie odczytową** funkcję `native_workspace_sync(p_set,p_hashes)` działającą jako `SECURITY INVOKER`. Nie zmienia rekordów biznesowych, istniejących polityk ani uprawnień pracowników.

Rejestr zbiorów: `tasks`, `inquiries`, `contacts`, `events`, `offers`, `tenders`, `notifications`. 16 kubełków według pierwszego znaku `md5(id)`; skrót każdego kubełka obejmuje całą jego treść. Odpowiedź ma `hashes` i `changed`. Zmienione i opróżnione kubełki zastępują lokalną zawartość — uwzględnia to usunięcia, zmiany przypisań i widoczności, a nie tylko `updated_at`. Backend nie utrzymuje trwałej migawki: każdy zapis jest widoczny przy następnym odczycie, bez `invalidateSync` i ryzyka starego cache serwera. To odrębne rozwiązanie od Piastpol, dostosowane do obecnego Supabase.

**Migracja nie jest uruchamiana przez skrypty aplikacji ani import konfiguracji.** Do jej wdrożenia aplikacja używa pełnego odczytu stronicowanego po 200 rekordów, wyraźnie oznaczonego w interfejsie. Błąd inny niż brak RPC nie uruchamia tej ścieżki awaryjnej. Mój dzień korzysta z istniejącego RPC i jest odświeżany w całości jako małe podsumowanie.

## Kolejne etapy i parytet

Plan z pierwszego etapu (historia). Aktualny stan i to, co zostaje w CRM — sekcja „Aktualizacja 0.19”. Ostatnim etapem są poprawki sekcji finansów.

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

Wynik: `build/Mavinci.dmg` z ostatniego `build-app.sh` (bez publikacji). Instalator do rozdania i aktualizacje w aplikacji — `yarn release` (sekcja niżej).

## Instalator i aktualizacje (0.23)

**`yarn release`** (z głównego katalogu projektu, `scripts/release.sh`):

0. Numer wersji o jeden wyżej niż ostatnie wydanie (plik `VERSION`): `yarn release` — drobna zmiana, `0.23.0 → 0.23.1`; `yarn release minor` (albo `yarn release kluczowa`) — kluczowa zmiana, `0.23.4 → 0.24.0`; `yarn release major` — `0.24.0 → 1.0.0`; `yarn release none` — bez zmiany numeru; `VERSION=1.2.0 yarn release` — numer podany wprost. Po publikacji plik `VERSION` dostaje nowy numer (dołącz go do commita); `PUBLISH=0` (bez publikacji) pliku nie zmienia.
1. Kompilacja release z podpisem zespołu Mavinci (Team ID 5DC8P5M489). Numer kompilacji to data i godzina (`RRRRMMDDGGMM`), więc każda kolejna kompilacja jest nowsza. Wersję pokazywaną pracownikom ustawia plik `VERSION` (albo zmienna `VERSION`).
2. Notaryzacja Apple — tylko z certyfikatem „Developer ID Application” i profilem notarytool w pęku kluczy. Profil zakłada się raz, w Terminalu: `xcrun notarytool store-credentials mavinci-notary --apple-id <Apple ID> --team-id 5DC8P5M489` (hasło aplikacji z appleid.apple.com wpisujesz sam, w Terminalu). Bez notaryzacji instalator działa, ale pierwsze otwarcie pobranego z sieci pliku wymaga zgody w macOS (prawy przycisk → Otwórz).
3. W `build/release/`: instalator `Mavinci-<wersja>-<kompilacja>.dmg`, paczka aktualizacji `….zip` (podpisana aplikacja) i opis wydania `latest.json` (wersja, sumy SHA-256, rozmiary, „Co nowego” ze zmiennej `NOTES`).
4. Publikacja przez ssh (ten sam serwer co `yarn deploy`) do `/var/www/mavinci/desktop-releases/mac/` (poza katalogiem aplikacji Next — `yarn deploy` jej nie usuwa). Opis wydania podmieniany jest na końcu, zostaje 5 najnowszych wersji. `PUBLISH=0 yarn release` — tylko pliki lokalnie.

Przykład: `NOTES="Finanse w Dysku, czas pracy zespołu w telefonie." yarn release`.

### Instalator dla innych Maców — certyfikat Developer ID

Kompilacja z podpisem **„Apple Development”** (tak podpisane jest wydanie, gdy w pęku kluczy nie ma „Developer ID Application”) działa w pełni na Macu, na którym ją zbudowano. Na innych Macach macOS może nie uruchomić z niej rozszerzenia Findera — aplikacja działa, ale **„Mavinci” nie pojawia się w pasku bocznym Findera**. `yarn release` ostrzega przed publikacją takiego wydania i pyta o zgodę (`ALLOW_DEVELOPMENT_RELEASE=1` — bez pytania), a pasek menu aplikacji pokazuje przy wersji „kompilacja deweloperska”. Instalator dla zespołu:

1. **Certyfikat** (raz; zakłada właściciel konta Apple Developer): Dostęp do pęku kluczy → Asystent certyfikatów → „Poproś o certyfikat w urzędzie certyfikacji…” → zapisz na dysku; developer.apple.com → Certificates, IDs & Profiles → Certificates → „+” → **Developer ID Application** → wgraj plik prośby → pobierz certyfikat i otwórz go dwuklikiem (pęk „Logowanie”). `security find-identity -v -p codesigning` pokazuje „Developer ID Application: … (5DC8P5M489)”.
2. **Notaryzacja** (raz): `xcrun notarytool store-credentials mavinci-notary --apple-id <Apple ID> --team-id 5DC8P5M489` — hasło aplikacji z appleid.apple.com wpisujesz sam, w Terminalu.
3. `yarn release` — skrypt sam wybierze „Developer ID Application”, podpisze rozszerzenie Findera, wyśle aplikację i instalator do notaryzacji Apple i opublikuje wydanie. Na innych Macach instalator otwiera się bez ostrzeżeń, a „Mavinci” pojawia się w Finderze po zalogowaniu w aplikacji.

Gdy na którymś Macu „Mavinci” nie ma w Finderze: aplikacja powinna być w folderze **Aplikacje** (nie uruchomiona prosto z instalatora); po zalogowaniu aplikacja rejestruje „Mavinci” w Finderze, a gdy macOS nie zna jeszcze rozszerzenia — zgłasza je sama (`pluginkit -a`) i próbuje drugi raz. Nieudana rejestracja: pasek menu → „Dlaczego nie ma „Mavinci” w Finderze?…” (przyczyna: uruchomienie z instalatora, kompilacja deweloperska albo komunikat systemu) i „Spróbuj ponownie dodać „Mavinci” do Findera”. Rozszerzenie musi być włączone: Ustawienia systemowe → Ogólne → Rzeczy otwierane podczas logowania i rozszerzenia → Dostawcy plików; w Finderze: Ustawienia → Pasek boczny → „Mavinci”.

### Pełny ekran przy uruchomieniu

Pierwsze okno po uruchomieniu aplikacji przechodzi od razu na pełny ekran (osobne biurko macOS); kolejne okna i karty otwierają się normalnie, a okno odtworzone przez macOS na pełnym ekranie na nim zostaje. Wyłączenie: Ustawienia (⌘,) → Wygląd → „Otwieraj na pełnym ekranie”. Kod: `LaunchFullScreen.swift` (wywołanie przy podpięciu okna w `Workspace.attach`).

### Okna i karty — jak w VS Code

Mavinci to jedna aplikacja z **jedną ikoną w Docku** — okna są w menu jej ikony (z pozycją **„Nowe okno”**), w menu Okno i pod ⌘\`. Każde okno i każda karta okna ma **własny obszar roboczy** (`WindowWorkspaces.swift`): dane w pamięci, stan sekcji (np. podsekcja Finansów — „Zamknięcie miesięcy” w jednym oknie, „Terminy i monity” w drugim; otwarta karta pracownika, oferty, pojazdu; filtry), zapisy i odświeżanie. Praca w jednym oknie nie zmienia drugiego i go nie przelicza: widoki okna obserwują tylko swój obszar, a scena aplikacji (`MavinciApp`) nie obserwuje żadnego — pierwszy obszar jest w uchwycie `WorkspaceHub`, który niczego nie publikuje. Wcześniej wszystkie okna miały jeden obszar (każda zmiana danych przerysowywała wszystkie okna, stan sekcji był wspólny), a krótko — osobne procesy z drugą ikoną w Docku; oba podejścia zastąpił ten model.

- **Otwieranie**: Plik → Nowe okno (⇧⌘N) / Nowa karta (⇧⌘T), prawy przycisk na pozycji paska bocznego i na evencie w liście („Otwórz w nowym oknie / w nowej karcie”), „W nowym oknie / W nowej karcie” przy przeciąganiu pozycji paska bocznego, menu ikony w Docku → „Nowe okno”, „+” na pasku kart. Nowe okno pokazuje się od razu z danymi okna, z którego je otwarto (`Workspace.adopt` — wspólna sesja, kopia danych z pamięci, stan sekcji z kopii na dysku), potem odświeża się samo; „bieżąca sekcja” zabiera też podsekcję i listę Finansów. Na pełnym ekranie nowe okno dostaje własne biurko (automatyczne karty macOS są na ten czas wyłączone — inaczej dołączyłby je jako kartę), w zwykłym oknie pojawia się obok.
- **Karty**: każda karta ma własny obszar, więc karta przeciągnięta z paska kart do osobnego okna (albo Okno → Przenieś kartę do nowego okna) po prostu staje się oknem — ze swoim stanem, bez przenoszenia.
- **Pierwszy obszar** (pierwsze okno po uruchomieniu) prowadzi logowanie i usługi wspólne: sesję (jeden `HTTPBackend` — token odświeża jedno miejsce), komunikator (jedno połączenie na żywo, powiadomienia, dźwięk i licznik na ikonie w Docku; rozmowy i odnośniki otwierają się w oknie na pierwszym planie), sygnet na pasku menu, Mavinci w Finderze, Kalendarz Apple, aktualizacje, Ustawienia i tryb testowy. Kopię danych na dysku zapisuje pierwszy obszar. Motyw z Ustawień zmienia się we wszystkich oknach.
- **Menu aplikacji** (Mavinci → Odśwież, ⌘1–9, Wyloguj; Plik → Nowe okno) działa na oknie na pierwszym planie (`MavinciCommands`, `focusedSceneObject`). Okna wiadomości i formularzy (e-mail, faktura) działają w obszarze okna, z którego je otwarto — zapis odświeża sekcję tamtego okna.
- **Zamykanie**: okno pierwszego obszaru po zamknięciu wraca z tym samym widokiem przy następnym otwarciu (Dock, pasek menu); zamknięcie okna kolejnego obszaru kończy jego pracę (`Workspace.shutdown`). Wylogowanie w dowolnym oknie zamyka okna kolejnych obszarów i pokazuje logowanie (nowe okno, gdy okno pierwszego obszaru było zamknięte). Tryb testowy działa w jednym oknie — przy wejściu pozostałe okna się zamykają, a nowe okna są niedostępne do wyjścia z trybu. Okna kolejnych obszarów nie wracają po ponownym uruchomieniu (`isRestorable = false`).
- Zapis w jednym oknie widać w drugim po jego odświeżeniu (co minutę, po przejściu do okna, ⌘R). Ustawienia widoku zapamiętywane na tym Macu (np. lista / kafelki, kolejność zakładek karty wydarzenia) są wspólne dla okien — jak preferencje.

**Serwer** (`src/app/bridge/native/v1/desktop/route.ts`, `src/lib/native/desktopRelease.ts`): `op=latest` (wydanie i czy jest nowsze od kompilacji aplikacji), `op=download&kind=zip|dmg` (strumień pliku). Tylko zalogowani pracownicy (token sesji) — albo `op=file` z podpisanym adresem (HMAC, ważny godzinę, tylko dla bieżącego wydania), który Dysk wydaje zalogowanemu pracownikowi. Katalog wydań można zmienić zmienną `DESKTOP_RELEASES_DIR`.

**Dysk → Programy** (CRM, Mac, Finder — dział na poziomie Eventów, Materiałów i Pracowników, dla każdego pracownika; w aplikacji na telefon i tablet ukryty): plik `Mavinci <wersja> — macOS.dmg`, zawsze najnowsze wydanie z `yarn release`. W przeglądarce pobiera się zwykłym linkiem, na Macu dwuklik zapisuje instalator w „Pobranych”, w Finderze (Mavinci → Programy) plik otwiera się jak każdy inny. Nowe wydanie zmienia wersję pliku, więc Finder i Mac pobierają je od nowa.

**Pierwsza instalacja**: CRM → Dysk → Programy albo Ustawienia → Ogólne → „Aplikacja Mavinci na Maca” → „Pobierz instalator (DMG)”, albo plik z `build/release/`. Otwórz instalator, przeciągnij Mavinci do folderu Aplikacje i uruchom stamtąd.

**Aktualizacje w aplikacji** (`Sources/Mavinci/Updates/`):

- Sprawdzenie po zalogowaniu i co godzinę, przy otwarciu Ustawienia → Oprogramowanie (gdy ostatnie było ponad 10 minut temu); od razu — „Sprawdź teraz” w tej zakładce, Mavinci → „Sprawdź aktualizacje…” albo pasek menu (oba otwierają zakładkę „Oprogramowanie”).
- Nowsza kompilacja → w stopce paska bocznego, pod nazwiskiem pracownika (przy „Połączono” / „Odświeżanie…”), „Nowa wersja …” — „Zobacz i zainstaluj” (w trakcie: „Pobieranie… %”, „Aktualizacja gotowa — Zainstaluj i uruchom ponownie”) — oraz pozycja na pasku menu. Kliknięcie otwiera okno Ustawień na zakładce **„Oprogramowanie”** (`Updates/AppUpdateViews.swift`, `SettingsWindow.swift`). Dawny pasek nad treścią okna nachodził na nagłówki sekcji (np. przełącznik widoku Spotkań) — usunięty.
- **Ustawienia → Oprogramowanie**: wersja zainstalowana (i numer kompilacji), nowa wersja z datą wydania i rozmiarem, „Co nowego” (`NOTES` z `yarn release`), instalacja z postępem i kroki instalacji — w aplikacji (zalecane) oraz z instalatora DMG (pobierz, zamknij Mavinci, przeciągnij do Aplikacji → „Zastąp”, uruchom, wysuń instalator). Bez nowej wersji: „Masz najnowszą wersję · sprawdzono …”.
- „Pobierz aktualizację” pobiera paczkę (postęp), sprawdza sumę SHA-256, rozpakowuje ją (`ditto`) i sprawdza podpis zespołu Mavinci, identyfikator pakietu i numer kompilacji.
- „Zainstaluj i uruchom ponownie”: aplikacja się zamyka, skrypt podmienia pakiet w miejscu bieżącego (przy błędzie przywraca poprzedni) i uruchamia nową wersję. Po uruchomieniu komunikat „Zainstalowano Mavinci …”, a katalog aktualizacji (`~/Library/Caches/pl.mavinci.desktop/Updates`) jest sprzątany.
- Pliki pobrane przez aplikację nie mają kwarantanny, więc po aktualizacji macOS nie pyta ponownie o zgodę.
- Kopia z folderu budowania (`yarn build:mac`), z obrazu dysku, bez podpisu zespołu albo w folderze bez prawa zapisu pokazuje nową wersję, ale się nie podmienia. Pokazuje wtedy powód i przycisk „Pobierz instalator (DMG)”.

## Widżety na pulpit: „Moje zadania”, „Zadania prywatne”, „Kalendarz”, „Spotkania” i „Wydarzenia”

Rozszerzenie `MavinciWidgets.appex` (`Sources/MavinciWidgets`) — widżety WidgetKit na pulpit i do Centrum powiadomień (macOS 14). Ten sam
kod buduje widżety na iPhonie i iPadzie (`mobile/plugins/withMavinciWidgets.js`, różnice w `#if os(iOS)` — także ekran blokady).

- **„Moje zadania”** — otwarte zadania z tablicy „Moje zadania” (prywatne i przypisane do Ciebie), **„Zadania prywatne”** — tylko prywatne.
  Kropka — priorytet, termin („Dziś, 18:00”, „Jutro”; po terminie na czerwono), „W trakcie” / „Do sprawdzenia”, kłódka przy prywatnych,
  działający licznik czasu.
- **„Kalendarz”** — Twój plan na 7 dni, te same dane co „Mój plan” (`get_employee_schedule`): eventy i fazy, spotkania, zadania z terminem,
  kontakty w zapytaniach, oddzwonienia i nieobecności; w nagłówku dzisiejsza data, „Do potwierdzenia” przy zaproszeniu do eventu.
- **„Spotkania”** — Twoje spotkania na 14 dni (autor albo uczestnik, bez odwołanych i odrzuconych) z miejscem, liczbą osób i organizatorem;
  zaproszenie bez odpowiedzi — złote „Odpowiedz” i „… do odpowiedzi” w nagłówku, „Może” i „Wstępne” jak w CRM.
- **Przypomnienie** („Spotkania” i „Kalendarz”): pozycja zaczynająca się w ciągu godziny ma pod godziną złote „za 25 min”; mały widżet
  i ekran blokady — „Za 1 h 10 min · 14:00” do 2 godzin przed. Oś czasu ma wtedy wpis co minutę, więc odliczanie działa bez sieci.
- **„Wydarzenia”** — najbliższe eventy (trwające i na 30 dni, bez anulowanych): widoczne jak na liście Eventów (RLS) i Twoje realizacje;
  godzina, miejsce, klient, kolor kategorii, w nagłówku liczba eventów. Etap sprzedaży niepotwierdzonych („Zapytanie”, „Oferta do wysłania”,
  „Oferta wysłana”) — tylko dla osób widzących etapy sprzedaży; zapytanie albo oferta do wysłania na 72 godziny przed eventem —
  „… do potwierdzenia” w nagłówku.
- Rozmiary: mały (najbliższa pozycja / liczba zadań), średni (najbliższe pozycje z godziną i dniem), duży (terminarz z nagłówkami dni)
  i bardzo duży (dwie kolumny). Listy pokazują tylko pozycje mieszczące się w całości — stałe wysokości wierszy (`WidgetLayout`), miejsce
  mierzone w widżecie — z linią podziału między pozycjami; resztę opisuje „i 3 więcej…” (średni — licznik w nagłówku). Trwające pozycje
  mają „Teraz”, zakończone znikają same (wpisy osi czasu na początek i koniec każdej pozycji).
- Kliknięcie pozycji otwiera ją w aplikacji: `mavinci://task|event|meeting|inquiry|contact/<id>`; kliknięcie widżetu — sekcję:
  `mavinci://tasks`, `mavinci://calendar`, `mavinci://meetings`, `mavinci://events` (`MavinciApp.onOpenURL`, `Widgets/WidgetBridge.swift`).
- Dane: `GET /bridge/native/v1/tasks?op=widget` (`tasksWidget` w `src/lib/native/tasks.ts`) oraz `GET /bridge/native/v1/widgets?op=calendar|meetings|events`
  (`src/lib/native/widgets.ts`) z sesją z kontenera grupy (jak Finder), więc widżety działają też przy zamkniętej aplikacji; bez internetu —
  ostatnie dane z dopiskiem „bez połączenia” (`WidgetSupport.swift`).
- Odświeżanie co 15 minut i od razu po zmianach w aplikacji (`WidgetBridge.reload`): zadania i licznik czasu, spotkania i lista eventów
  (także zmiany z CRM po synchronizacji), plan dnia i wylogowanie; po wylogowaniu widżety proszą o zalogowanie.
- Budowanie: `scripts/build-app.sh` razem z rozszerzeniem Findera (tylko z podpisem zespołu Mavinci); `WIDGETS=0` — bez widżetów.

**Dodanie na pulpit:** kliknij pulpit prawym przyciskiem → „Edytuj widżety…” → wyszukaj „Mavinci” → przeciągnij wybrany widżet na pulpit
(albo do Centrum powiadomień). Aplikacja po zalogowaniu sama zgłasza widżety systemowi.

**Galeria bez nowych widżetów** (np. brak „Kalendarza”, „Spotkań” albo „Wydarzeń”): macOS pokazuje widżety jednej zarejestrowanej kopii rozszerzenia
i pamięta ich listę — przy kilku kopiach aplikacji (folder Aplikacje, `desktop/mac/build`, instalator) galeria mogła pokazywać starszą.
Działająca kopia przy pierwszym uruchomieniu nowej wersji sama zgłasza swoje widżety, wyrejestrowuje inne kopie (`pluginkit -r`)
i uruchamia ponownie usługę widżetów `chronod` (widżety na pulpicie zostają). Ręcznie: pasek menu → **„Odśwież widżety na pulpicie”**
(także Centrum powiadomień), potem galeria od nowa. Kod: `Widgets/WidgetBridge.swift` (`WidgetRegistration`).

## Dysk: schowek jak w Finderze, kopie i miejsce na Dysku (0.23)

- **Materiały** (`Materials/`): kliknięcie elementu na liście i w siatce zaznacza go i daje fokus klawiatury (lista: `itemProvider` zamiast `onDrag`, który blokował zaznaczanie wiersza). ⌘C kopiuj, ⌘X wytnij, ⌘V wklej (kopia albo przeniesienie; pliki skopiowane w Finderze — wysyłka do folderu), Delete — do kosza. Menu pod prawym przyciskiem: na elemencie — kopiuj, wytnij, duplikuj, „Kopiuj do…”, „Wklej do folderu”, zmiana nazwy, przeniesienie, usunięcie; na pustym miejscu — nowy folder, dodaj pliki, wklej, zaznacz wszystko. Przeciąganie z ⌥ — kopia. Kopie plików i całych folderów robi serwer (`op=copy`: kopia obiektów w magazynie, obok oryginału „… kopia”, najwyżej 300 plików i 200 folderów naraz).
- **Miejsce na Dysku** (`Drive/DriveStorageViews.swift`, tylko administrator): na dole paska bocznego Dysku (także w Materiałach) zajętość plików względem pakietu; kliknięcie — pakiet, pliki według rodzaju, baza danych i „Zmień pakiet…” (`op=storage`, `op=storagePlan`, migracja `20261126120000_drive_storage_usage.sql`). Domyślnie Supabase Pro: 100 GB plików, 8 GB bazy.
- **Paski edytorów Prezentacji i Realizacji** (`AdaptiveToolbar.swift`): pełne etykiety → same ikony (opis w podpowiedzi) → tytuł w osobnym wierszu, zależnie od szerokości okna; etykiety się nie łamią, ⌘S działa w każdym wariancie.


## Formularze w arkuszach: płynne pisanie i przewijanie

Duży arkusz (nowy event, spotkanie, zadanie, „Edytuj klienta” eventu) po każdej literze przeliczał się w całości, gdy jego treść
czytała wpisywany tekst — filtr listy wyboru, podpowiedź w pustym opisie, `.task(id:)` wyszukiwania, warunek przycisku zapisu.
SwiftUI odświeżał wtedy wszystkie pola, listy, wybory dat i menu (w formularzu `.grouped` — każdy wiersz), więc litery pojawiały się
z opóźnieniem. Zasada: **treść arkusza nie czyta pól, w które się pisze** — czytają je małe widoki, którym arkusz przekazuje
`Binding` (`$tekst`): `FormPickList` / `FormPickRows` i `PlaceholderTextEditor` (`FormPickList.swift`), `EventNewContactForm`,
`MeetingPlaceField`, `MeetingContactSearch`, `MeetingSaveButton`, `TaskAssigneeSearch`, `TaskSaveButton`. Po literze przelicza się
tylko taki widok.

Listy wyboru (organizacja, osoba kontaktowa, lokalizacja) nie przewijają się wewnątrz przewijanego formularza: zagnieżdżona lista
przejmowała przewijanie, gdy kursor znalazł się nad nią, i arkusz „stawał”. Pokazują pierwsze wyniki (8, lokalizacje 5)
i „Pokaż więcej”; wyszukiwanie bez rozróżniania wielkości liter i znaków diakrytycznych.


## Okna formularzy: wiadomość e-mail i faktura

Nowa wiadomość, odpowiedź i przekazanie (Wiadomości, „Napisz e-mail” w Kontaktach) oraz wystawianie faktury (Finanse, rozliczenie
eventu, faktura końcowa) otwierają się w **osobnych oknach** zamiast arkusza przyklejonego do okna: okno można skalować i przesuwać,
otworzyć kilka naraz i pracować obok — np. przewijać skrzynkę przy pisaniu odpowiedzi. Okno wiadomości otwiera się zawsze w rozmiarze
okna modalnego (920 × 780, w granicach ekranu) na środku okna CRM (`FormWindowKind.openSize`, `FormWindowSizer`) — nie na cały ekran
po powiększeniu poprzedniego okna; okno faktury pamięta ostatni rozmiar i położenie.
Mechanizm: `FormWindows.swift` (`.formWindow(item:kind:)` zamiast `.sheet(item:)`, sceny `form-compose` i `form-invoice`
w `MavinciApp`); `dismiss()` w formularzu zamyka okno. Okno przywrócone po ponownym uruchomieniu aplikacji pokazuje tylko „Zamknij okno”.

Okno wiadomości (`ComposeSheet` w `Messages/MessageSheets.swift`): u góry nadawca, adresy i temat, niżej treść, a w odpowiedzi pod
treścią **cała wiadomość, na którą odpowiadasz** (z jej wcześniejszą korespondencją — jak w Thunderbirdzie; podział przesuwany).
Cytat do wysyłanej wiadomości dołącza serwer, jak dotąd. **Przeciąganie plików**: pliki upuszczone w oknie — także na treść
— trafiają do załączników (foldery są pomijane z informacją).

**Treść z formatowaniem jak w Thunderbirdzie** (`Messages/MailRichEditor.swift`): edytor HTML w WebKit (skrypt edytora w osobnym
świecie skryptów, treść i stopka nie uruchamiają własnych) z paskiem: pogrubienie, kursywa, podkreślenie (⌘B, ⌘I, ⌘U), przekreślenie,
rozmiar (mały, zwykły, duży, bardzo duży) i kolor tekstu, wypunktowanie, numeracja, wcięcia (Tab / ⇧Tab w listach), wyrównanie
(do lewej, środek, do prawej, wyjustowanie), link (⌘K — zaznaczenie albo sam adres; „mavinci.pl” → https, adres e-mail → mailto)
i „Wyczyść formatowanie”. Treść ma krój, rozmiar i odstępy jak wiadomość u odbiorcy (Arial 14 px, interlinia 1,6, białe tło, wiersze
bez dodatkowych odstępów), a **na końcu treści jest stopka wybranej skrzynki** (`op=signature`) — tak jak w Thunderbirdzie widać od
razu wynik; stopki nie edytuje się w oknie. Wklejanie zachowuje pogrubienia, kursywę, podkreślenia, listy, wyrównanie i linki
(bez obcych krojów, kolorów tła i obrazów). Do wysyłki idzie HTML z odstępami zapisanymi w stylach (`html`; serwer zostawia tylko
znaczniki i style treści — `sanitizeMailContentHtml` w `src/lib/native/messages.ts`) i zwykły tekst (`text`, sprawdzenie pustej
treści). „Podgląd” i odbiorca widzą tę samą treść co okno — wcześniej każdy wiersz był osobnym akapitem z domyślnym odstępem.
Zwykły tekst z innych okien (np. wiadomość z zapytania) też trafia do wiadomości jako wiersze bez dodatkowych odstępów.

Faktura (`Finance/InvoiceFormParts.swift`): kolumny pozycji rozdzielone pionowymi liniami, nazwa pozycji od lewej (ze spacjami).

## Zapisy podczas odświeżania w tle

Odświeżanie danych (co minutę, po powrocie do aplikacji, ⌘R) nie blokuje już zapisów — wcześniej przez cały czas odświeżania
przyciski zapisu odpowiadały „Zapis wymaga połączenia z serwerem CRM.”. `Workspace.canWrite` = zalogowany pracownik i połączenie
potwierdzone profilem; serwer sprawdza sesję i uprawnienia przy każdym zapisie. Odświeżenie zamówione po zapisie w trakcie trwającego
wykonuje się zaraz po nim. Przekroczony czas odpowiedzi jednej sekcji nie wyłącza zapisów (tylko brak sieci), a po powrocie sieci
połączenie jest potwierdzane od razu, bez czekania na kolejne odświeżenie.

## Cenniki sezonowe w ofertach (oferta weselna, etap 1)

Cena zależy od roku eventu: marka realizująca ma cenniki na sezony (np. „Wesela 2027”, „Wesela 2028”), a kreator oferty
(`OfferWizardCatalog.swift`) i okno pozycji (`OfferItemSheet.swift`) dostają z serwera katalog z cenami z cennika marki eventu
na sezon daty eventu — pasek „Cennik: …” mówi, skąd są ceny. Nowa oferta zapamiętuje cennik (gwarancja ceny: zapisane pozycje
nie zmieniają cen same). Na stronie oferty (`OfferSeasonPrices.swift`, nad pozycjami) — opis cennika, ostrzeżenie, gdy event
przeniesiono na inny sezon, i „Przelicz według cennika…”: podgląd różnic (`op=priceListPreview`), potem świadome zastosowanie
(`op=priceListApply`; zmienia się cena bazowa pozycji, dodatki, ilości i rabaty zostają). Wesele zawsze realizuje Event Rulers
(kategoria z marką obowiązkową — baza ustawia markę nowego eventu). Logika i teksty wspólne z CRM: `src/lib/CRM/Offers/seasonPrices.ts`.

## Cenniki (Oferty → Cenniki)

Ekran natywny `PriceLists/` (`/crm/offers?tab=pricelists`, serwer `src/lib/native/priceLists.ts`, trasa `/bridge/native/v1/price-lists`):
lista cenników według marek (szkic, aktywny, archiwum; liczba cen i ofert), edytor cen produktów i wariantów (cena katalogowa obok ceny
w cenniku, różnica w %, filtr kategorii, „Tylko pozycje w cenniku”; pole ceny zatwierdza Enter albo wyjście z pola, puste pole usuwa
produkt z cennika), nowy cennik z cenami z katalogu, „Kopiuj na kolejny sezon…” (np. +8%, zaokrąglenie do 10 zł), „Uzupełnij z katalogu…”,
„Zmień ceny o %…”, aktywacja (aktywne cenniki jednej marki nie mogą obejmować tych samych dat), archiwum i usunięcie nieużytego cennika.
Zmiany — admin albo `offers_manage` (jak w CRM). Karta produktu ma sekcję „Ceny w cennikach sezonowych” (`ProductSeasonPricesSection`),
a „Nowy event” po wyborze kategorii z marką ustawia firmę realizującą (Wesele — Event Rulers, wybór zablokowany); w edytorze kategorii
eventów: „Marka realizująca nowych eventów” i „Zawsze ta marka”.

## Szablon oferty weselnej (oferta weselna, etap 2)

PDF liczy serwer, więc Mac, CRM i telefon dostają ten sam dokument. Kategoria szablonu (Oferty → Szablony → kategoria,
`OfferTemplateCategorySheet`) ma dwie nowe opcje: „Kolory z księgi znaku marki wydarzenia” (`brand_colors` — kolor główny, dodatkowy
i akcent stron generowanych z księgi znaku marki realizującej, np. Event Rulers) i kartę wyceny „Weselna — „Wasza wycena”…”
(`pricing_style = wedding`, z polami „Zadatek (% kwoty do zapłaty)” i „Warunki”) z podglądem strony. Zamiast tabeli kalkulacji PDF
ma stronę „WASZA WYCENA” (`src/lib/offer-pdf/weddingPricing.ts`): pozycje oferty z kwotami (dodatki pakietu pod pozycją, ilość × cena,
rabat pozycji), rabat i VAT w podsumowaniu, razem do zapłaty, zadatek z pozostałą kwotą, warunki, sezon cennika i ważność oferty;
przy wielu pozycjach kolejne strony. Oferty z pakietami do wyboru i oferty sprzedawców zostają w zwykłym układzie. Migracja
`20261129110000_wedding_offer_template.sql` włącza oba ustawienia w kategorii szablonu wesel (Wesela-PDF).

„Rozdziały z Prezentacji” w tym samym oknie kategorii (`chapter_item_ids`; lista kart z serwera — `showcaseCards` w stanie szablonów):
wybrane karty Prezentacji (np. „Jak to robimy?”, „Zespół”) w ustalonej kolejności (strzałki, usuwanie, „Dodaj kartę z Prezentacji”
według działów). PDF dostaje je po stronie „O nas”, przed produktami — strony generowane z treści karty (zdjęcie główne, tytuł,
wstęp, tekst, punkty, zdjęcia, specyfikacja, pytania; `src/lib/offer-pdf/chapterHtml.ts`, Chromium jak przy broszurach —
`chapterPages.server.ts`), więc podmiana zdjęcia lub osoby w karcie zmienia kolejne oferty. Bez wersji EN i ofert sprzedawców.

## Produkt w kilku kategoriach eventów (oferta weselna, etap 3)

Karta produktu → „Podstawowe informacje” → „Także w kategoriach eventów” (`extra_category_ids`, migracja
`20261129120000_product_extra_categories.sql`): ten sam produkt (cena, zdjęcia, sprzęt, obsada, strona PDF) pokazuje się w kilku
kategoriach — np. Fotolustro w „Dodatki”, „Wesele” i „EVENT” — zamiast kopii. Filtry kategorii na liście produktów, w kreatorze
oferty i w edytorze cennika (oraz „Uzupełnij z katalogu”) biorą kategorię główną i dodatkowe (`categoryIds` z serwera; starszy
serwer — sama główna). Przed migracją pola nie ma i nic się nie zmienia.

## Zdjęcie produktu z Dysku i WebP w ofertach

Karta produktu → „Edytuj grafikę” (`ProductImageSheet`) → „Z Dysku…” (`Materials/MaterialPhotoPicker.swift`): marka, foldery jak
w Dysku (start — „Zdjęcia”), wyszukiwanie, miniatury; tylko JPG, PNG i WebP. Oryginał zostaje w Dysku, a przy zapisie serwer
(`op=imageFromMaterial`, `src/lib/native/products.ts`) robi z niego lekką wersję WebP (do 1800 px, orientacja jak w przeglądarce)
w magazynie zdjęć produktów: `assets/<produkt>/material-<plik>-v<wersja>.webp` — ścieżka wskazuje plik i wersję treści
(`src/lib/CRM/Offers/productImageSource.ts`), ta sama wersja drugi raz się nie zapisuje. Pod zdjęciem na karcie (`ProductHeroSection`)
„Z Dysku: Marka / Zdjęcia / … / plik.jpg”, a gdy w Dysku podmieniono treść pliku — „Zaktualizuj z Dysku” (kadr i opis bez zmian).
PDF oferty nie może zawierać WebP, więc przy generowaniu zdjęcia WebP (także wgrane wcześniej), GIF, AVIF i BMP zamieniają się
w JPEG, a z przezroczystością — w PNG (`src/lib/images/imageConvert.server.ts`); wcześniej takie zdjęcia znikały z PDF.

## Zdjęcia produktów, wariantów, pakietów i broszur zawsze w WebP

Wszystko, co trafia do magazynu zdjęć produktów (`offer-product-pages`), serwer zapisuje jako lekkie WebP (`src/lib/native/productImages.ts`
— `storeOfferWebp`, `materialWebp`): zdjęcie główne (`op=image`, do 1800 px), wariant/element (`variantsSave` → `image.data` albo
`image.materialId`, 1800 px), pakiet (`packagesSave` → `images[].data` albo `images[].materialId`, 1400 px) i własne zdjęcie broszury
(`/brochures op=imageUpload`, 2200 px). Mac zmniejsza plik z komputera do 1800 px w jakości 0,92 (`ProductImageEncoder.forWebP`), żeby
nie tracić jakości drugi raz; CRM wysyła plik przez ten sam serwer (`productImageUpload`, `brochureImageUpload` w `materialsApi.ts`).
„Z Dysku…” jest też w oknie wariantu (`ProductVariantSheet`) i pakietu (`ProductPackageSheet`) — wspólna wersja WebP pliku z Dysku
(`assets/<produkt>/material-<plik>-v<wersja>.webp`) nie jest usuwana przy wycofaniu zapisu, bo może jej używać inne zdjęcie produktu.

Katalog (`ProductsView`) pokazuje osobom, które mogą zmieniać produkty, pasek „W katalogu jest N zdjęć w formacie JPG/PNG” z przyciskiem
„Zamień na WebP” (`ProductsStore.convertImages`, `op=imagesPending` i porcje `op=imagesConvert` po 4 zdjęcia): nowy plik WebP obok
starego (ta sama nazwa, a zdjęcie spoza folderu produktu — kopia w folderze produktu), nowa ścieżka w produkcie, wariancie lub pakiecie
i przeniesienie kadrów (`offer_image_crops` są zapisane po ścieżce). Stare pliki zostają w magazynie (wcześniejsze broszury). Zdjęcia,
których nie udało się zamienić, są wypisane pod paskiem. CRM — ten sam pasek w katalogu (`ProductImagesWebpBanner`).

## Duplikowanie produktu i powrót do katalogu

„Duplikuj…” w menu produktu w katalogu (prawy klik), przycisk „Duplikuj” na pasku katalogu (zaznaczony produkt) i w menu „…” karty
produktu (`ProductsStore.duplicate`, `op=duplicate`, `src/lib/native/productDuplicate.ts`): po potwierdzeniu powstaje nowy produkt
„Nazwa (kopia)” z nowym identyfikatorem i kopią całej karty — warianty (nowe identyfikatory, także w pakietach, tekstach EN
i konfiguracjach), pakiety, dodatki, wymagania, klauzule, powiązane usługi, tagi, sprzęt i obsada produktu i wariantów, Mavinci LIVE,
przygotowanie i zamówienia, ceny w cennikach sezonów (bez archiwalnych), zdjęcia (kopie plików w folderze nowego produktu) z kadrami.
Kopia jest nieaktywna i od razu otwiera się jej karta. Bez uprawnień do Mavinci LIVE, przygotowania lub cenników ta część jest
pomijana (komunikat mówi, której zabrakło); błąd w części podstawowej usuwa kopię i skopiowane pliki. Ceny sprzedawców nie są kopiowane.
CRM — ikona „Duplikuj” przy produkcie w katalogu i „Duplikuj” na karcie produktu (`useDuplicateProduct`).

Na karcie produktu powrót do katalogu to wyraźny przycisk „Katalog produktów” na początku paska (duży, z ramką) i skrót ⌘[.

## Opiekun nowego zapytania — osoba dodająca

Zapytanie dodane ręcznie (okno „Nowe zapytanie” w lejku, kalendarzu i karcie kontaktu; w CRM i w telefonie także) ma od razu
opiekuna — osobę, która je dodaje, jeśli prowadzi zapytania (administrator, `inquiries_assign`, `inquiries_manage`,
`inquiries_manage_own`, `inquiries_manage_all`). Ustawia to baza (`prepare_inquiry_sales_automation`, migracja
`20261130110000_inquiry_creator_owner.sql`), więc dotyczy też zapytań z wiadomości, przetargów i karty klienta; osoba, która sama
zostaje opiekunem, nie dostaje powiadomienia o przypisaniu. W oknie (`NewInquiryForm`) lista „Opiekun” zaczyna się od „Ja” — domyślnie
(`NewInquiryModel.creatorOwns`), bez pozycji „Wspólna kolejka”; przy przydziale można wybrać inną osobę. Pod listą — opis, kto
zostanie opiekunem; bez prawa prowadzenia zapytań: „Zapytanie trafi do wspólnej kolejki „Nieprzypisane”…”. Po zapisie lejek
przechodzi do „Moje” („Zapytanie zostało dodane i przypisane do Ciebie”). Do wspólnej puli zapytanie oddaje się w karcie zapytania.
CRM — opis w oknie i ten sam komunikat (`src/lib/CRM/inquiries/inquiryCreatorOwner.ts`).

## Telefon klienta z kierunkowym

„Telefon klienta” w informacjach podstawowych oferty pokazuje numer z kierunkowym („+48 510 233 670”, stacjonarny „+48 22 123 45 67”)
— także numer zapisany wcześniej jako same cyfry (`formatPhone`, `src/lib/CRM/client/phoneFormat.ts`; serwer formatuje `contactPhone`).
Nowy kontakt (`createEntity`, CRM `/crm/contacts/new`) zapisuje telefony z kierunkowym zamiast samych cyfr (wcześniej „+48 510 233 670”
zapisywał się jako „48510233670”), a duplikat kontaktu rozpoznaje po numerze w każdym zapisie. Migracja
`20261130111000_contact_phone_plus.sql` poprawia zapisane tak numery w bazie. CRM — wiersz telefonu z ikoną, wyrównany z resztą.

## Nowe zadanie: przeciąganie załączników

W oknie „Nowe zadanie” / „Edytuj zadanie” sekcja „Załączniki” ma strefę „Przeciągnij pliki tutaj” (`TaskAttachmentDropZone`
w `Tasks/TaskEditorSheet.swift`): pliki z Findera upuszczone na strefę (podświetla się przy przeciąganiu) trafiają na listę
załączników, jak z „Dodaj pliki”; foldery są pomijane z informacją, ten sam plik nie dodaje się dwa razy. Pliki przesyłają się
po zapisaniu zadania (jak dotąd). W CRM ta sama strefa — `TaskAttachmentDropzone` w formularzu zadania.

## Nowa wiadomość: podpowiedzi adresatów („Do”, „DW”, „UDW”)

Jak w Thunderbirdzie: przy wpisywaniu imienia, nazwiska, fragmentu adresu albo nazwy firmy pod polem pojawia się lista
adresów — kontakty, organizacje, pracownicy i osoby, z którymi była korespondencja (nadawcy odebranych i adresaci wysłanych
wiadomości z 3 lat, bez adresów no-reply). Każda podpowiedź ma powiązanie: kontakt / organizacja / pracownik / korespondencja,
organizację (bieżącą kontaktu albo po domenie adresu) i liczbę wiadomości, np. „Omega Hotel · 3 wysłane, 5 odebranych · ostatnio
03.11.2026”. Kolejność: trafność (początek słowa przed fragmentem), częstość i świeżość korespondencji, znany kontakt.
↑ / ↓ — wybór, ↩ lub ⇥ — wstawienie adresu (z „, ” na następny; adres już wpisany nie dubluje się), Esc — zamknięcie listy,
kliknięcie też wstawia. Gdy lista jest otwarta, ↩ nie wysyła wiadomości, a Esc nie zamyka okna.

Pola z podpowiedziami (`Messages/RecipientField.swift`): Nowa wiadomość / odpowiedź / przekazanie, wysyłka oferty, wiadomość
z zapytania, faktura i przypomnienie o płatności, kalkulacja, umowa. Dane: `GET /bridge/native/v1/recipients?q=` → funkcja bazy
`email_recipient_suggestions` (migracja `20261130140000_email_recipient_suggestions.sql`) z uprawnieniami pracownika — podpowiada
tylko kontakty, organizacje i korespondencję ze skrzynek, które ta osoba widzi w CRM. CRM — `RecipientInput` w `UnifiedEmailComposer`,
telefon — `mobile/src/components/RecipientInput.tsx`.

## Social media → Statystyki: „Zainteresowanie marką”

Na górze „Statystyk” social media (CRM, Mac, telefon) jest karta „Zainteresowanie marką” — jak często ktoś szuka marki z nazwy
i wchodzi na jej profile, w wybranym okresie (7 / 28 / 90 dni) wobec poprzedniego:
- „Wyszukiwania nazwy w Google” — ile razy strona marki pokazała się w Google na frazy zawierające nazwę (praktycznie tyle, ile razy
  ktoś wpisał nazwę) i ile było kliknięć; lista „Jak nas szukają w Google” — 10 najczęstszych fraz (Search Console, opóźnienie 1–3 dni,
  bardzo rzadkie frazy Google pomija),
- „Wejścia na stronę Facebook” — wyświetlenia strony (`page_views_total`),
- „Wejścia na profil Instagram” — wejścia na profil konta (`profile_views`); gdy Meta ich nie podaje — wejścia na profil z postów
  opublikowanych z CRM (opis pod kafelkiem).
Wykres dzień po dniu pokazuje, po którym poście, evencie albo kampanii rośnie zainteresowanie. Wyłącznie liczby: Google i Meta nie
podają, kto szukał marki ani kto odwiedził profil (nazwiska widać tylko przy osobach, które same zareagowały — komentarze, wiadomości,
obserwacje).

Frazy marki: domyślnie z nazwy marki i adresu jej strony (np. „mavinci”); „Frazy marki” — do 10 fraz, każda liczy wszystkie wyszukiwania,
które ją zawierają („event rulers” obejmuje też „eventrulers”). Zmienia je zarządzający marketingiem albo akceptujący social media marki;
po zmianie wyniki Google z 90 dni pobierają się od nowa. „Odśwież” — każdy z dostępem do statystyk (kanały pobrane ponad 5 minut temu).
Dane pobiera synchronizacja marketingu co 6 godzin (`src/lib/marketing/brandInterest.server.ts`); stan kanałów (niepołączone, czeka,
niedostępne, błąd) jest w karcie. Migracja `20261130130000_brand_interest.sql`; serwer `src/lib/social/socialBrand.server.ts`
(`op=stats` → `brand`, `op=brandRefresh`, `op=brandTerms`).

## Przetargi: konfiguracja filtrów i płynna lista

„Konfiguracja” na pasku Przetargów otwiera stronę „Konfiguracja filtrów” (`TenderFilterConfigView.swift`) — jak `/crm/tenders/config`
w CRM i „Konfiguracja” w telefonie: lista konfiguracji (aktywna oznaczona), nazwa, minimalna ocena trafności, maks. dni do terminu,
„Powiadom od oceny”, „Konfiguracja aktywna” oraz listy: słowa kluczowe, słowa wykluczające, kody CPV i lokalizacje. Pozycje dodaje ↩
albo „Dodaj” (kilka naraz — rozdzielone nowymi liniami, przecinkami, średnikami albo kropkami), wklejenie kilku linii (⌘V) albo
„Wklej listę” ze schowka; powtórzenia są pomijane (pole na chwilę podświetla się na czerwono), × przy pozycji ją usuwa. ⌘S — „Zapisz
konfigurację”; przy przejściu do innej konfiguracji albo powrocie do listy z niezapisanymi zmianami aplikacja pyta, czy je odrzucić.
Aktywna może być jedna konfiguracja (pobieranie przetargów i przeliczenie ocen używają jednej) — zapis aktywnej wyłącza pozostałe;
aktywnej nie można usunąć. „Przelicz przetargi” przelicza ocenę trafności (0–100) i dopasowanie wszystkich przetargów według aktywnej
konfiguracji, po czym lista odświeża oceny. Zmiany i przeliczenie — administrator CRM; pozostali pracownicy z dostępem do przetargów
widzą konfigurację do odczytu. Serwer: `/bridge/native/v1/tenders` (`src/lib/tenders/tenderFilterConfig.server.ts`,
`src/lib/tenders/tenderRelevance.server.ts`; reguły list wspólne z CRM i telefonem — `src/lib/tenders/tenderFilterConfig.ts`).
Przeliczenie czyta wszystkie przetargi (wcześniej najwyżej 1000) i zapisuje tylko te ze zmienioną oceną. Migracja
`20261130150000_tender_filter_config_policies.sql` usuwa politykę, która pozwalała każdemu z dostępem do przetargów usuwać konfiguracje.

Zawieszanie się Przetargów (kilka tysięcy przetargów z opisami): lista po filtrach liczy się raz na zmianę danych, filtrów albo minuty
(wcześniej trzy razy przy każdej publikacji stanu aplikacji, także kilkanaście razy w trakcie synchronizacji); daty z list są pamiętane
razem z nieczytelnymi, bez tworzenia formaterów przy każdym odświeżeniu (`CalendarDates`); otwarcie szczegółów przetargu bez zmian na
serwerze niczego nie zapisuje. Lokalna kopia zbiorów zapisuje się i odczytuje w tle (`LocalCacheWriter` w `Configuration.swift`):
szyfrowanie i zapis poza wątkiem głównym, kolejne zmiany w ciągu 0,4 s jednym zapisem; wylogowanie i zmiana pracownika czekają
na trwający zapis i unieważniają zaplanowane, więc kopia poprzedniej sesji nie wraca na dysk.

## Oferta: akceptacja rabatu ponad limit w „Informacjach”

Gdy rabat oferty przekracza limit (CRM: Ustawienia → „Progi akceptacji ofert”, obecnie 10%) albo marża spada poniżej progu, sekcja „Informacje”
na stronie oferty — pod podsumowaniem i „Edytuj rabat” — pokazuje stan akceptacji (`OfferApprovalPanel` w `Offers/OfferPageView.swift`):
- sprzedawca: „Rabat 30,07% przekracza limit 10%”, pole uzasadnienia i „Wyślij do akceptacji” — administratorzy dostają powiadomienie;
  potem „Czeka na akceptację administratora” (z uzasadnieniem i datą prośby), a po decyzji — „zaakceptowany” albo powód odrzucenia
  i ponowne „Wyślij do akceptacji”. Do akceptacji przycisk „Wyślij ofertę” jest wyłączony z podpowiedzią (serwer też blokuje wysyłkę);
- administrator (albo zarządzający finansami): bez prośby — „jako administrator możesz wysłać ofertę od razu”; przy prośbie
  sprzedawcy „Zaakceptuj” albo „Odrzuć” — powód odrzucenia jest wymagany, sprzedawca dostaje powiadomienie i widzi go przy ofercie.
Akceptacja obowiązuje dla zaakceptowanych kwot — wyższy rabat albo inna wartość pozycji wymaga ponownej akceptacji. Teksty stanu
liczy serwer (`src/lib/CRM/Offers/offerApproval.ts`, pole `approval` strony oferty; `op=approvalRequest`, `op=approvalDecide`),
decyzje — baza (`request_offer_approval`, `decide_offer_approval`). CRM ma tę samą sekcję w karcie „Informacje” oferty.

## Faktura z KSeF: zaznaczanie tekstu i „Kopiuj”

Podgląd faktury KSeF (Finanse → KSeF, wyciągi, dokumenty miesiąca — `KsefPreviewSheet` w `Finance/FinanceReconciliationSheets.swift`):
każdy tekst da się zaznaczyć i skopiować (⌘C), a przy kluczowych wartościach jest ikona kopiowania (`CopyValueButton.swift`, na 1,5 s
„✓”): numer faktury, numer KSeF, nazwa i NIP sprzedawcy oraz nabywcy (NIP bez kresek), rachunek (bez spacji — do wklejenia
w banku) i kwota do zapłaty („533,82” — bez waluty). Sposób płatności i stan płatności po polsku („Przelew”, „Nieopłacona”) zamiast
kodu z XML („6”, „unpaid”); kolumna „Brutto” pozycji tylko wtedy, gdy XML podaje brutto pozycji. CRM — te same ikony w wizualizacji
faktury (`InvoiceDetailsModal`, `src/components/crm/CopyValueButton.tsx`; na wydruku ukryte).

## Wydarzenie → „Zarządzaj sprzętem”: drzewo kategorii i szerokość paska

Pasek po lewej okna „Zarządzaj sprzętem” (`Events/EventEquipmentManager.swift`) pokazuje kategorie magazynu jak drzewo:
kategoria główna (np. „Oświetlenie”) z rozwijanymi podkategoriami („Ruchome Głowy”, „Dekoracyjne”, „PAR LED”…), w kolejności
z Magazynu. Kliknięcie kategorii głównej pokazuje cały jej sprzęt i zestawy (ze wszystkich podkategorii) i rozwija ją;
podkategoria — tylko swoje pozycje; „Bez podkategorii” — pozycje leżące bezpośrednio w kategorii głównej. Liczniki obejmują
podkategorie; „Zwiń” / „Rozwiń” przy nagłówku „Kategorie”; rozwinięte kategorie są zapamiętywane. Zestawy z kategorią są też
w jej drzewie (oraz jak dotąd w „Zestawy”). Kolumna „Kategoria” pokazuje ścieżkę („Oświetlenie › Ruchome Głowy”), wyszukiwanie
obejmuje też kategorię główną. Szerokość paska zmienia uchwyt między paskiem a listą (przeciągnięcie, 180–520 pt, zapamiętywana;
dwuklik — domyślna), pełna nazwa kategorii jest w podpowiedzi. Serwer: katalog `op=equipmentCatalog` podaje kategorię główną
i kolejność (`categoryPlacement` w `src/lib/native/eventEquipment.ts`); kopia katalogu sprzed aktualizacji pokazuje płaską listę
do pierwszej synchronizacji.

## Harmonogram wydarzenia: płynne przeciąganie faz

Przesuwanie fazy i zmiana jej długości krawędziami (`Events/EventPhasesTab.swift`) działa jak w CRM (`useTimelineDrag`): przesunięcie
liczy się od zakresu fazy sprzed przeciągnięcia o odległość kursora w układzie okna. Wcześniej odległość była liczona w układzie
samego paska, który w trakcie przeciągania przesuwał się i zmieniał szerokość — faza „uciekała” i skakała. Przyciąganie do siatki
(5 / 15 / 60 min zależnie od widoku), najkrótszy czas fazy i granice osi bez zmian; przesuwana faza dosuwa się do końca osi zamiast
wychodzić poza nią. Uchwyty krawędzi są szersze (10 pt), widoczne także w trakcie przeciągania, a kursor zmiany szerokości nie zostaje
po zniknięciu uchwytu. Tak samo przesuwanie przypisań w „Zasobach eventu” — także kolejne przeciągnięcie już zmienionego przypisania
(od jego nowego czasu, nie od zapisanego).

## Wysyłka e-maili: domyślnie od osoby wysyłającej

Okna wysyłki (nowa wiadomość, odpowiedź, przekazanie, oferta, kalkulacja, umowa, faktura i monit, zapytanie, broszura) wybierają
na start skrzynkę osoby wysyłającej: jej własną skrzynkę osobistą (domyślną przed innymi), potem osobiste przypisane i wspólne
(np. biuro@); skrzynka systemowa (system@) — tylko gdy nie ma innej. Wcześniej w Wiadomościach przy „Wszystkie konta” pierwsza była
skrzynka systemowa (lista skrzynek zaczyna się od systemowych), a w części okien wspólna skrzynka wygrywała alfabetycznie.
Odpowiedź wychodzi ze skrzynki, na którą przyszła wiadomość, chyba że to skrzynka systemowa — wtedy od osoby wysyłającej.
Inną skrzynkę nadal można wybrać w polu „Od:”. Mac: `MailAccount.preferredSender` (`Messages/MessageModels.swift`); serwer i CRM:
`src/lib/CRM/messages/sendingAccount.ts` (kolejność skrzynek z `sendingAccounts` — pierwsza jest domyślna w oknach na Macu i telefonie).

## Event → Agenda: „Wyślij e-mailem” (agenda i Karta Weselna) i wątek korespondencji eventu

Zakładka „Agenda” ma przycisk „Wyślij e-mailem”, gdy zapisany PDF jest aktualny (osoba zarządzająca eventem — jak „Generuj PDF”);
w wydarzeniu weselnym ten sam przycisk ma Karta Weselna (przy „Otwórz PDF”). Okno (`EventDocumentEmailSheet`, w CRM
`SendEventDocumentEmailModal`): skrzynka osoby wysyłającej (pierwsza — własna), adresat z eventu (Karta Weselna — para młoda,
inaczej osoba kontaktowa albo organizacja), temat i treść, stopka i szablon firmy („Podgląd”), PDF dokumentu zawsze w załączniku,
dodatkowe pliki eventu (do 25 MB), wysyłka teraz albo zaplanowana. Dane okna: `loadEventDocumentEmailContext`
(`src/lib/CRM/events/eventDocumentEmail.ts`), serwer: `src/lib/native/eventDocumentEmail.ts` (`emailSetup`, `emailPreview`,
`op=documentEmail` w `/bridge/native/v1/events/card`).

Każda wiadomość wysłana z eventu trafia do jego wątku (`event_email_links`, migracja `20261130160000_event_correspondence.sql`):
agenda, Karta Weselna, kalkulacja, umowa oraz oferta i faktura (także monit) należące do eventu — w CRM i na Macu, wysłane od razu
(`sentEmailId` funkcji poczty) albo zaplanowane (zlecenie; po wysyłce dochodzi wysłana wiadomość). Odpowiedzi klienta dochodzą
same (wątek liczony przy odczycie). Wcześniejsze wysyłki migracja dołącza jednorazowo, gdy powiązanie jest jednoznaczne
(załącznik z folderu eventu, numer oferty albo faktury jednego eventu w temacie, zaplanowana wysyłka z oznaczeniem eventu).
Wspólne: `linkEventEmail` / `linkDocumentEmailToEvent` (`src/lib/CRM/events/eventCorrespondence.ts`). Wątek pokazuje zakładka „Korespondencja” (niżej).

## Event → „Korespondencja”: wątek e-mailowy eventu z filtrem wiadomości systemowych

Nowa zakładka karty eventu (obszar „Oferta, umowa i formalności” — `commercial_docs`, jak Oferta i Umowa; zawężana w uprawnieniach
pracownika jak inne zakładki). Pokazuje wiadomości z klientem o evencie: wysłane z eventu (agenda, Karta Weselna, kalkulacja,
umowa, oferta i faktura eventu — także zaplanowane), odpowiedzi w tych wątkach (In-Reply-To / References albo ten sam temat
z tym samym rozmówcą), korespondencję zapytania, z którego powstał event, i wiadomości dołączone ręcznie — razem z wiadomościami
systemowymi (np. „Potwierdzenie realizacji”). Filtry: „Ukryj systemowe” (zapamiętane), Wszystkie / Odebrane / Wysłane,
wyszukiwanie w temacie, adresach, treści i nazwach załączników. Lista od najnowszej, obok treść (tekst, załączniki), „Odpowiedz”
i „Otwórz w Wiadomościach” (wiadomości z własnych skrzynek), „Wyklucz z eventu” / „Przywróć” oraz „Dołącz…” (wyszukiwanie po
temacie, z całą konwersacją) — osoba zarządzająca eventem. „Inne wiadomości z klientem” — niepowiązane wiadomości z adresami
klienta (osoba kontaktowa, organizacja i jej osoby, domeny korespondencji) z okresu eventu, do dołączenia jednym kliknięciem.
„Napisz do klienta” / „Odpowiedz” — od osoby wysyłającej (pierwsza skrzynka — własna), stopka i szablon firmy, cytat oryginału
przy odpowiedzi; wysłana wiadomość trafia do wątku eventu. Zaplanowane wysyłki widać na górze listy (status i termin).

Prywatność jak w Wiadomościach: wiadomości ze skrzynek osobistych i wspólnych widzi osoba z dostępem do skrzynki; wiadomości
systemowe o evencie — każdy, kto widzi zakładkę. Baza: `get_event_correspondence`, `get_event_correspondence_suggestions`,
`link_event_email`, `exclude_event_email` (migracja `20261130160000_event_correspondence.sql`). CRM:
`src/components/crm/events/correspondence/EventCorrespondenceTab.tsx`; Mac: `Events/EventCorrespondenceTab.swift`, serwer
`src/lib/native/eventCorrespondence.ts` (zakładka `correspondence`, `suggestions`, `search`, `composeSetup`, `link`, `exclude`,
`preview`, `op=correspondenceEmail`); wspólne: `src/lib/CRM/events/eventCorrespondence.ts`. Telefon otwiera zakładkę w CRM
(jak pozostałe zakładki handlowe).

## Kontakty → karta: „Szybkie akcje”

W nagłówku karty kontaktu i organizacji przycisk-menu „Szybkie akcje” (`ContactQuickActionsMenu`) — jak `ContactQuickActions`
w CRM, z tymi samymi uprawnieniami: „Dodaj zapytanie” (zapytania albo `tasks_create`), „Wyślij broszurę…” (`offers_manage`
i broszury), „Wyślij ofertę…” (`offers_manage`: do 100 najnowszych ofert odbiorcy — organizacji albo osoby i eventów, w których jest
osobą kontaktową; bez aktualnego PDF tylko „Otwórz ofertę”; dalej `OfferEmailSheet`), „Utwórz event…” (`events_create` /
`events_manage`: kreator `EventCreateSheet` z organizacją i osobą kontaktową; osoba w kilku organizacjach — najpierw wybór
organizacji albo klient indywidualny), „Broszury klienta…” i „Historia wysyłek broszur…”. Wcześniej osobny przycisk
„Dodaj zapytanie”. Oferty: `offersToSend` (`src/lib/native/contactCustomer360.ts`, `/bridge/native/v1/contacts`).

## Kalendarz: miesiąc bez przewijania

Siatka miesiąca wypełnia wysokość okna (5 albo 6 tygodni) — wysokość dnia liczona z wolnego miejsca, nie mniej niż 96 pkt;
przewijanie pojawia się dopiero w bardzo niskim oknie. W wyższym dniu mieści się więcej wpisów (reszta pod „+N”). Miniatury
kolejnych miesięcy są teraz pod listą wybranego dnia (dwie w wysokim oknie, jedna w typowym) — wcześniej pod siatką wydłużały
stronę i wymuszały przewijanie (`NativeCalendarView`).

## Rental w menu (wynajem od podwykonawców)

Menu CRM ma nową grupę **Rental**: „Wypożyczenia klientom” (`/crm/rental`, `docs/rental.md`) i „Wynajem od podwykonawców”
(`/crm/rental/subcontractors` — dawniej Magazyn → Rental). Na Macu „Wynajem od podwykonawców” otwiera dotychczasowy ekran
natywny (`RentalView`, także stary adres `/crm/equipment/rental`; tytuł „Wynajem od podwykonawców”, podtytuł „Rental”, przycisk
wstecz — do „Wypożyczeń klientom”), a karta podwykonawcy otwiera wynajem pod nowym adresem. „Wypożyczenia klientom” — ekran
natywny (sekcja niżej).

## Rental → Wypożyczenia klientom (ekran natywny)

`ClientRentals/` — 1:1 z `/crm/rental` i kartą `/crm/rental/[id]` (`docs/rental.md`), dane i zapisy przez
`/bridge/native/v1/rental` (`src/lib/native/rental.ts` — te same funkcje bazy `rental_*` co CRM, uprawnienia z `rental_access`).
- **Lista** (`ClientRentalsView`): zakładki W toku / Szkice / Do rozliczenia / Archiwum / Wszystkie (z licznikami), wyszukiwanie
  (numer, nazwa, klient), „Tylko moje” (sprzedaż), „Nowe wypożyczenie” (⌘N), wiersze z terminem, statusem, „Po terminie”,
  rozbieżnościami, sprzętem u klienta i kwotą brutto (tylko sprzedaż). Odświeżanie co minutę i przyciskiem.
- **Karta** (`ClientRentalDetailView`): pozycje (ceny tylko dla sprzedaży), rozbieżności po zwrocie, protokoły wydania i odbioru
  (linie, zdjęcia, skan podpisanego protokołu, „PDF do podpisu” — druk przez `/bridge/rental/[id]/protocols/[protocolId]`, na Macu
  w Chrome albo z serwera, otwierany w Podglądzie), rozliczenie, klient i termin, dostawa i odbiór, uwagi magazynu, pliki, historia.
  Pasek: „Protokół wydania” / „Dowydanie”, „Protokół odbioru” (magazyn), menu „Sprzedaż” (Zarezerwuj, Cofnij rezerwację, Rozlicz,
  Edytuj dane, Anuluj — z rezerwacji z powodem), „Cofnij rozliczenie” (administrator), „Otwórz w CRM”.
- **Okna** (`ClientRentalSheets.swift`): dane wypożyczenia (klient z bazy albo spoza niej, termin, odbierający, odbiór własny
  lub dostawa z adresem, firma, opiekun, kaucja, rabat, VAT, uwagi), pozycje — zakładki „Katalog magazynu” (cały sprzęt i zestawy
  z miniaturami, kategorie, wyszukiwanie, „Dostępne X z Y” w oknie zajęcia: od wyjazdu sprzętu — wydanie lub dostawa — do powrotu
  — zwrot lub odbiór; −/+ albo wpisana ilość wielu pozycji naraz, nie więcej niż wolne; `op=stock` → `rental_catalog`) i „Wybrane
  pozycje” (usługi, cena za dobę albo ryczałt, doby, rabat, wartość odtworzeniowa, dostępność z konfliktami — zarezerwowane
  z brakiem nie zapisze się); po utworzeniu wypożyczenia karta otwiera od razu katalog,
  protokół wydania / odbioru (sprawne, uszkodzone, brak, opis, zdjęcia), rozstrzygnięcie rozbieżności (wraca na stan, serwis,
  spisanie — z wyborem egzemplarzy), dostawa i odbiór (pojazd z Floty, kierowca, godziny, zajętość pojazdu), powód anulowania.
- **Rozliczenie** (`ClientRentalSettlementSection`): netto / rabat / naliczenia / VAT / brutto, naliczenia („Z rozbieżności” —
  sztuki × wartość odtworzeniowa), kaucja (wpłata, zwrot, rozliczenie), faktury (dołącz po numerze, odłącz, karta w Finansach;
  „Wystaw fakturę” otwiera okno faktury, a wystawiona dołącza się do wypożyczenia jako wybrany rodzaj).
- Powiadomienia `/crm/rental/<id>` otwierają kartę; `/crm/rental` — listę (bez dostępu do ekranu — CRM w przeglądarce).

## Zadania: panel zadania — osoby, pliki, edycja

Panel szczegółów zadania (tablice „Zadania firmowe”, „Moje zadania” i zadania wydarzenia, `TaskInspector` w `Tasks/TasksBoardView.swift`)
działa jak karta zadania w CRM (`TaskDetailClient`):
- **Osoby**: lista przypisanych, „Przypisz się” / „Wypisz się”, „Dodaj osobę” (wyszukiwanie wśród pracowników, zapis od razu —
  powiadomienie dostaje tylko dodana osoba), usunięcie osoby — siebie zawsze, inne osoby: autor zadania, administrator,
  „Zadania — zarządzanie” (na tablicy wydarzenia — zarządzający zadaniami). Zadania prywatne mają tylko właściciela.
- **Pliki**: „Dodaj plik…” (kilka naraz, do 50 MB), usunięcie pliku (autor pliku i zarządzający), plik wydarzenia — „Odlinkuj”.
- **Komentarze**: usuwa autor komentarza, autor zadania i zarządzający.
- **Edycja**: zarządzający tablicą albo właściciel zadania (resztę sprawdza baza).
Serwer: `/bridge/native/v1/tasks` — `assign`, `unassign`, `deleteAttachment`; wypisanie innej osoby po sprawdzeniu uprawnień
(RLS pozwala usunąć tylko własne przypisanie). Telefon: „Przypisz się” / „Wypisz się” na karcie zadania.

## Komunikator: przycisk w rogu — zminimalizuj, ukryj

Okrągły przycisk komunikatora w prawym dolnym rogu okna (`Chat/ChatViews.swift`, jak `ChatWidget` w CRM) ma po najechaniu
„–” (mała ikona w rogu; kliknięcie ją przywraca, kropka — nieprzeczytane) i „×” (przycisk ukryty — komunikator otwiera ikona
obok dzwonka na pasku narzędzi albo ⌥⌘K). Pinezka w nagłówku panelu przywraca przycisk w rogu. Wybór jest wspólny dla okien
i zapamiętany (`chat.launcher`). W CRM tak samo, a ikona komunikatora z licznikiem stoi obok dzwonka (`ChatHeaderButton`).

## Faktura KSeF: kopiowanie kwoty VAT

Podgląd faktury z XML KSeF (`FinanceReconciliationSheets.swift`) ma wiersz „Kwota VAT” z ikoną kopiowania — do przelewu
podzielonego (split payment: kwota brutto i kwota VAT). W CRM ikona kopiowania przy VAT w wierszu „RAZEM” (`InvoiceDetailsModal`).

## KSeF: korekta „in minus” — rozliczenie zwrotu z fakturą korygowaną

Faktura korygująca z ujemną kwotą (zwrot, np. FK do FV kosztowej) nie jest już „Nieopłacona”: na liście KSeF ma stan
„Korekta do rozliczenia” / „Częściowo rozliczona” / „Korekta rozliczona” (`FinKsefText.payment`), a w menu i pod listą —
„Rozlicz korektę / zwrot…” (`Finance/FinanceKsefCorrectionSheet.swift`, jak okno CRM `KsefCorrectionSettlementModal`):
- **Faktura korygowana** z XML korekty (`NrKSeFFaKorygowanej`, a bez niego numer faktury i NIP kontrahenta) — stan, kwota,
  operacje z wyciągu, które ją opłaciły, i operacje do powiązania (kierunek płatności, ±60/180 dni od wystawienia, pozostała
  kwota; najpierw zgodna kwota, numer faktury lub NIP w opisie, kontrahent, bliska data; wyszukiwanie i „Pokaż wszystkie
  z okresu”). Faktura oznaczona jako opłacona bez operacji (np. kartą przy zakupie — „Zapłacono” w XML) też dostaje operację:
  oznaczenie zamienia się na powiązanie z wyciągiem.
- **Zwrot** — operacja przeciwnego kierunku (dla faktury kosztowej: wpływ) powiązana z korektą. Płatność i zwrot rozliczają
  obie faktury i obie operacje (bez pary „płatność + zwrot”, która dotyczy zwrotów bez faktury).
- **Kompensata** — gdy faktura korygowana nie była jeszcze opłacona: korekta pomniejsza kwotę do zapłaty, wpłata „Kompensata …”
  w rejestrze obu faktur (kwota i data do zmiany), „Cofnij kompensatę” usuwa obie.
- „Odepnij” cofa powiązanie (automat nie przypisze ponownie), strzałka przy operacji otwiera ją w uzgodnieniu wyciągu.
Serwer: `GET /bridge/native/v1/finance?op=ksefCorrection&id=…`, `POST op=ksefCorrectionLink|ksefCorrectionUnlink|
ksefCorrectionOffset|ksefCorrectionOffsetUndo` (`src/lib/native/financeKsef.ts`), logika wspólna z CRM:
`src/lib/invoices/ksefCorrectionSettlement.ts` (dopasowania — `match_bank_transaction_to_documents`, `undo_bank_match`).

## Zakupy — „Moje wydatki” i rozliczenia pracowników (ekran natywny)

`Purchases/` — 1:1 z `/crm/purchases` (`docs/purchases.md`), dane i zapisy przez `/bridge/native/v1/purchases`
(`src/lib/purchases/purchaseRoute.server.ts` — te same funkcje bazy `purchase_*` co CRM). Menu „Zakupy” (ikona koszyka) widzi
pracownik z uprawnieniem „Zakupy — własne wydatki” (`finances_purchases`) i osoba z „Finanse — zarządzanie” w działalności.
- **Moje wydatki** (`PurchasesView`): miesiąc (strzałki, menu miesięcy i lat, „Bieżący miesiąc”; dalej niż bieżący miesiąc się
  nie da — zakup nie ma daty z przyszłości), „Razem”, „Nierozliczone miesiące” (inne miesiące z dokumentami, niewysłane albo do
  poprawy — kliknięcie przechodzi do miesiąca), dla każdej działalności: stan rozliczenia (Otwarte / Wysłane do zatwierdzenia /
  Zatwierdzone / Do poprawy), liczba dokumentów i suma, uwagi, „Wyślij rozliczenie” / „Wyślij ponownie” (każdy dokument z plikiem)
  i dokumenty: data, rodzaj i numer, co kupiono, kategoria, sprzedawca z NIP, event (kwota, kategoria, stan kosztu), zapłata
  (karta firmowa, gotówka, BLIK, przelew) i „Powiązany z wyciągiem” / „Czeka na wyciąg”, brutto; plik, „Popraw”, „Usuń” (także
  w menu prawym przyciskiem; po wysłaniu miesiąca i dla dokumentów powiązanych z wyciągiem — bez zmian).
- **Dodaj zakup / Popraw zakup** (`PurchaseFormSheet`, ⌘N): plik — zdjęcie paragonu, kilka zdjęć stron (do 10, serwer składa
  PDF) albo PDF, z okna wyboru albo przeciągnięty z Findera; zdjęcia HEIC / TIFF / WebP (np. z iPhone'a) idą jako JPEG, za duże
  zdjęcie jest pomniejszane. Serwer zapisuje plik i odczytuje go AI — pola uzupełniają się same (przy poprawce: „Wstaw odczytane
  dane”), ostrzeżenia (np. brak NIP-u firmy na paragonie) są w oknie. Pola jak w CRM, kategoria kosztów firmy; **Koszt eventu**:
  wyszukiwanie eventów działalności, które pracownik widzi (najbliższe dziś), kwota dla eventu (puste — cały dokument), kategoria
  kosztu (podpowiedź z kategorii kosztów) i wszystkie koszty tego eventu z sumą (własne — w kolorze akcentu). Plik wysłany bez
  zapisu zakupu znika z serwera po zamknięciu okna.
- **Rozliczenia pracowników** (zatwierdzający; zakładka z liczbą wysłanych): tabela pracownik / miesiąc / działalność / stan /
  dokumenty / suma przy wysłaniu; dwuklik (albo menu) otwiera okno rozliczenia pracownika z dokumentami i plikami, „Zatwierdź”,
  „Zwróć do poprawy” (uwaga wymagana) i „Cofnij zatwierdzenie”. Ktoś bez własnych zakupów widzi tylko tę zakładkę.
- **Powiadomienia**: `/crm/purchases?employee=…&year=…&month=…` otwiera rozliczenie pracownika, `?year=…&month=…` — własny miesiąc
  (`Workspace.showPurchases`); bez ekranu Zakupów w menu — strona CRM.

## Spotkania: „Pracownicy”, zajętość uczestników i e-maile do osób spoza firmy

Jak w CRM (`docs/team-availability.md`), dane z `/bridge/native/v1/meetings` (`people`, `availability`, `notify`):
- **Spotkania → „Pracownicy”** (`Meetings/TeamAvailabilityView.swift`): wybrany dzień, kolumna dla każdej wybranej osoby
  z zakresu planu — spotkania, eventy, fazy i nieobecności; spotkania prywatne innych osób i osoby spoza zakresu — „Zajęty”.
  „Osoby (n)”: wybór pogrupowany działami, „Cały dział”, „Tylko ja” (najwyżej 20 osób, zapamiętane na Macu; na początek —
  ja i mój dział). Kliknięcie spotkania otwiera szczegóły, eventu — kartę eventu; zaznaczenie wolnego czasu w kolumnie osoby
  zakłada spotkanie z nią; chwyt kolumny godzin przewija dzień.
- **Formularz spotkania** (`MeetingEditorSheet`): pod uczestnikami — kto z firmy (także Ty) ma już coś w planie w tym terminie
  (`MeetingConflictsRow`, nie blokuje zapisu) i przełącznik „Wyślij zaproszenie e-mailem osobom spoza firmy” / „Powiadom
  e-mailem osoby spoza firmy o zmianach” (domyślnie włączony, gdy są kontakty) — zaproszenie, zmiana albo „zaproszenie
  nieaktualne” z plikiem .ics, z Twojej skrzynki.
- **Przeciągnięcie terminu, zmiana statusu (odwołanie, przywrócenie, potwierdzenie) i usunięcie** spotkania z kontaktami —
  pytanie „E-mail do osób spoza firmy” (`MeetingsStore.mailOffer`).
- **Zespół → pracownik → „Dział i przełożony”**: dział (Zarząd, Sprzedaż, Biuro, Magazyn) i przełożony; zmienia administrator
  albo „Zarządzanie pracownikami” (`EmployeeStructureSheet`, `op=structure`).

## Osie czasu: „chwyć i przesuń”

Na osiach czasu czas przesuwa się chwytem myszy: nad wolnym miejscem osi kursor otwartej dłoni, przeciągnięcie przesuwa czas
(dłoń zaciśnięta). Pozycje osi zachowują swoje działanie — kliknięcie otwiera, przeciąganie faz, spotkań i przypisań działa jak
dotąd. Wspólny kod: `GrabPan.swift` (`grabScroll` przewija najbliższy `NSScrollView`, `grabCursor` — kursor dłoni).
- **Spotkania → Timeline** (dzień / tydzień): chwyt za kolumnę godzin przewija godziny w górę i w dół (przeciągnięcie w wolnym
  miejscu dnia nadal zaznacza czas nowego spotkania, jak w CRM).
- **Pracownicy → Timeline** (oś zespołu): przeciągnięcie w bok w dowolnym miejscu przesuwa zakres czasu płynnie, także poza
  dzień / tydzień / miesiąc (np. 18:00–18:00) — tytuł pokazuje widoczny zakres, oś staje na pełnych 15 minutach (dzień),
  godzinach (tydzień) albo 6 godzinach (miesiąc), plan dociąga się z zapasem pół okresu z każdej strony. „Dziś” i zmiana
  powiększenia wracają do pełnego okresu. Koniec przeciągania nie otwiera pozycji, nad którą puszczono przycisk.
- **Plan pracownika** (siatka godzin): chwyt tła przewija godziny.
- **Flota → Oś czasu**: chwyt tła przesuwa dni w bok.
- **Wydarzenie → Harmonogram**: chwyt tła przesuwa oś w bok i w pionie (fazy i przypisania — własne przeciąganie i krawędzie).

## Dysk → Materiały: link do pobrania („Udostępnij link”)

Folder (z podfolderami — „na żywo”, pliki dodane później też są do pobrania), album albo zaznaczone pliki można udostępnić
osobie spoza firmy linkiem ważnym 1, 3, 7, 14 albo 30 dni — np. zdjęcia z fotobudki dla pary młodej zamiast WeTransfer.
„Udostępnij link…” jest w menu prawym przyciskiem (plik, folder, kilka zaznaczonych, puste miejsce w folderze — „Udostępnij link
do „Folder”…”), w czynnościach zaznaczenia i w albumie („Udostępnij album”); „Linki” w nagłówku — lista linków marki
(`MaterialSharing.swift`: `MaterialShareSheet`, `MaterialSharesSheet`). W oknie: tytuł i wiadomość na stronie, ważność, dostęp —
„Każdy, kto ma link” albo „Po podaniu e-maila i hasła” (adresy odbiorców; puste hasło — serwer generuje bezpieczne, np.
„Kx7pm-2Qa9T”). Po zapisie: link, hasło (pokazane tylko raz — w bazie jest skrót) i gotowa wiadomość dla odbiorcy („Kopiuj
wiadomość”, „Wyślij e-mailem”). Na liście: kopiuj link i wiadomość, otwórz stronę, przedłuż (od teraz o 1–30 dni; wyłączony
lub wygasły — „Włącz ponownie”), zmień (tytuł, wiadomość, dostęp, adresy), nowe hasło, wyłącz, usuń; otwarcia, pobrania i adresy,
którymi otwarto link z hasłem. Linki tworzy „Materiały — zarządzanie” marki (administrator).

Odbiorca otwiera `https://mavinci.pl/pobierz/<token>` — stronę w barwach marki z księgi znaku (logo, kolor, font nagłówków, bez menu
strony i Google Analytics, poza wyszukiwarkami): miniatury w częściach (folder, podfoldery, album), podgląd na całym ekranie
(strzałki, Esc), pobieranie pojedynczo i „Pobierz wszystkie (ZIP)” — archiwum składane w locie przez serwer (pliki strumieniem
z magazynu, bez kompresji, do 4 GB; większe — „Pobierz folder (ZIP)” w częściach albo pojedynczo). Link z hasłem — najpierw e-mail
z listy i hasło (ciasteczko sesji do końca ważności, najwyżej 7 dni; po 8 błędnych próbach z jednego adresu albo 30 łącznie — 15 minut
przerwy). Wygasły albo wyłączony link pokazuje informację z kontaktem do firmy.
Serwer: `src/lib/materials/materialShares.server.ts` (zarządzanie, `op=shares|shareCreate|shareUpdate|shareDelete`),
`materialSharePublic.server.ts` i `materialShareContents.server.ts` (strona i pliki), `zipStream.ts` (ZIP), trasy
`/bridge/public/material-share/{unlock,file,zip}`, strona `src/app/(share)/pobierz/[token]`. Migracja `20261130120000_material_share_links.sql`.
CRM — `MaterialShareDialog`, `MaterialSharesPanel`; telefon — `MaterialShareModal`, `MaterialSharesModal` (wiadomość przez „Udostępnij…”).

## Broszura z cennikiem sezonu (oferta weselna, etap 3)

Edytor broszury → ustawienia → „Cennik” (`price_list_id`, migracja `20261129130000_brochure_price_list.sql`; cenniki marki broszury
bez archiwum): PDF dostaje przed zakończeniem stronę „Cennik” ze wszystkimi widocznymi usługami — warianty w jednym wierszu
(„2 szt. 500 zł · 4 szt. 800 zł”), bez ceny w cenniku cena z katalogu, konfigurator albo cena 0 — „wycena indywidualna”
(`src/lib/brochures/brochurePriceList.ts`). Podgląd na Macu (serwer) i w CRM pokazuje tę samą stronę.

## Marka działu Prezentacji i ceny sezonu w ofercie ze spotkania (oferta weselna, etap 3)

Dział Prezentacji → „Marka działu” (`ShowcaseSectionSheet`, `companyId`; migracja `20261129140000_showcase_section_company.sql`):
oferta ze spotkania z kart działu z marką (np. Wesela → Event Rulers) dostaje tę markę i ceny z jej aktywnego cennika sezonu
dla terminu z rozmowy (bez terminu — cennik na dziś); oferta pamięta cennik, pozycje — ceny wariantów. Pod wyceną w „Ofercie ze
spotkania” opis „Ceny z cennika „…” (marka) — termin …” (`ShowcaseOfferPreview.priceList`). Ta sama migracja dokłada termin
z zapytania (`inquiry_details.termin`) do wyboru sezonu ofert bez eventu.

## „Do sprawdzenia” w cennikach (oferta weselna, etap 4)

Pod listą cenników (`PriceListsView`, pole `attention` w `op=state`; migracja `20261129150000_price_list_attention.sql`, funkcja
`price_list_attention`, opisy wspólne z CRM w `src/lib/CRM/Offers/priceListAttention.ts`): lata, w których marka z cennikami ma przyszłe
eventy bez aktywnego cennika (np. „Event Rulers — 2028: 3 eventy bez aktywnego cennika”), oraz oferty w toku (szkic, wysłana) do
sprawdzenia — cennik oferty inny niż cennik sezonu jej terminu (event przeniesiony na inny rok) albo szkic bez cennika, choć sezon
terminu ma już cennik. Kliknięcie otwiera ofertę na ekranie Ofert, gdzie „Przelicz według cennika…” pokazuje różnice przed zmianą —
ceny nie zmieniają się same. Lista odświeża się z listą cenników (nowy, skopiowany, aktywowany cennik). Starszy serwer albo baza
bez migracji — sekcji nie ma.

## Tryb testowy „widok jako” (Ustawienia → „Tryb testowy”)

Administrator sprawdza, co widzi wybrany pracownik i jakie ma funkcje (`docs/test-mode.md`). Ustawienia (⌘,) → zakładka
**„Tryb testowy”** (tylko administrator): pracownicy wg działów (Zarząd, Sprzedaż, Biuro, Magazyn) z wyszukiwarką, poziomem
dostępu i liczbą uprawnień, „Wejdź jako”, dziennik wejść; sprzedawców zewnętrznych (portal) — „Otwórz w przeglądarce”.
- Wejście (`Workspace.enterTestMode`, `TestMode/TestMode.swift`): `POST /bridge/test-mode/start` kluczem administratora →
  sesja zastępcza; aplikacja łączy się z bazą przez serwer CRM (`/bridge/test-mode/sb`) jako ta osoba — dane, menu, sekcje
  i przyciski jak u niej. Profil osoby jest sprawdzany przed przełączeniem (przy błędzie widok administratora zostaje).
- Zapis do bazy jest sprawdzany i wycofywany („Tryb testowy: zapis sprawdzony i wycofany”); pliki, funkcje serwera (e-mail),
  zmiany konta i operacje zapisujące natywnego API — „Tryb testowy: ta operacja jest wyłączona” (423, `AppError.testMode`).
  Odczyty natywnego API wysyłane metodą POST (synchronizacja, `op=items` itd.) działają. Komunikator bez połączenia na żywo
  i bez powiadomień push; Kalendarz Apple — kopiowanie wyłączone.
- Kliknięcie zdjęcia albo nazwiska na liście — karta pracownika (`TestModePersonCard`, popover): większe zdjęcie, dział, poziom
  dostępu, rola, przełożony, e-mail i telefon służbowy, ostatnia aktywność, uprawnienia w grupach (nazwy jak w CRM —
  `GET /bridge/native/v1/permission-labels`), „Otwórz kartę pracownika” (nowa karta okna — `WindowDestination.employee`)
  i „Wejdź jako”.
- Na górze każdego okna, na środku: pasek „Tryb testowy · widok: … · zmiany nie są zapisywane” z **„Wyjdź z trybu”**
  (`TestModeBanner`); „Wyloguj” w trybie testowym też kończy tryb.
- Sesja administratora zostaje w pęku kluczy (sesja testowa tylko w pamięci — `HTTPBackend(ephemeral:)`), jego kopie danych
  na dysku i Finder bez zmian. Wyjście (`Workspace.exitTestMode`): sesja zakończona na serwerze (`/bridge/test-mode/exit`),
  kopie danych oglądanej osoby usunięte z dysku i z pęku kluczy (`TestModeStorage.purge`), powrót administratora.
- Jedna sesja testowa administratora naraz — wejście na Macu kończy tryb testowy w przeglądarce i odwrotnie. Strony CRM bez
  ekranu natywnego otwierają się w przeglądarce w widoku administratora (tam — tryb testowy przeglądarki).

## Weryfikacja pierwszej wersji

Wykonano kompilację debug oraz release i weryfikację podpisu lokalnego pakietu `.app`; aplikacja została uruchomiona i pokazuje ekran logowania z publiczną konfiguracją Supabase. Nie przeprowadzono jeszcze testu po zalogowaniu na koncie sprzedawcy, testów zapisu w produkcji ani wykonania przygotowanej migracji. Nie budowano i nie wdrażano Next.js ani mobile.

## Aktualizacja 0.2 — nawigacja, kalendarz i strona wydarzenia

Dzwonek z licznikiem jest w prawym górnym pasku, obok odświeżania i wskaźnika pobierania. Usunięto go z bocznej listy. Tabele wypełniają wysokość od pierwszego wejścia, również przed zaznaczeniem. Wydarzenie otwiera się na osobnej stronie; przycisk Wróć przywraca poprzednią sekcję.

### Kalendarz i Apple Calendar

Natywny miesiąc, wybór dnia, wydarzenia wielodniowe, własne i zaproszone spotkania oraz terminy otwartych zapytań. Spotkania cykliczne używają wystąpień zapisanych przez CRM; klient nie tworzy drugiej serii. Kliknięcie wydarzenia otwiera jego natywną stronę. Wybór kalendarza jest filtrowany uprawnieniami `calendar_view` / `calendar_manage`; dane dodatkowo podlegają RLS.

Przycisk „Połącz z Kalendarzem Apple…” otwiera wybór zapisywalnego kalendarza lub utworzenie osobnego „Mavinci CRM”. System pyta o uprawnienie dopiero po świadomym użyciu przycisku. „Synchronizuj teraz” kopiuje **nazwę, termin i miejsce** wydarzeń oraz spotkań do wskazanego kalendarza. Jeśli to kalendarz iCloud lub innego konta, dane trafią do tego konta — interfejs uprzedza o tym przed zapisem. Prywatne wpisy nie są importowane do CRM. Zapytania są widoczne wewnątrz aplikacji, ale nie są eksportowane do Apple.

Powiązanie jest jednostronne: CRM → Apple (ręcznie albo automatycznie po odświeżeniu danych — zob. „Aktualizacja — Kalendarz Apple bez podwójnych wpisów”). Każdy wpis CRM ma w kalendarzu najwyżej jedną kopię, rozpoznawaną po adresie `mavinci://event|meeting/<id>` i znaczniku w notatce. Usuwane są wyłącznie wpisy utworzone przez Mavinci; prywatne wpisy użytkownika są pomijane. Zmiany są zatwierdzane razem (wszystko albo nic). Link wydarzenia pozwala wrócić z Apple do Mavinci. **Wylogowanie z CRM nie usuwa kopii zapisanej w kalendarzu Apple** — służy do tego „Usuń kopię z kalendarza…”. Synchronizacja dwukierunkowa nie jest wdrożona.

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
7. **Przetargi:** domyślnie aktywne, przed terminem i nieukryte. Lista pokazuje tytuł, zamawiającego, dopasowanie /100, termin i odliczanie, lokalizację, stan i obserwowanie. Filtry: zakres aktywne / moje / obserwowane / dopasowane, stan, tekst, przeszłe i ukryte. Szczegóły zawierają dane modalu CRM: opis, CPV, publikację, termin, wartość / walutę, opiekuna, źródło, notatki, status i ocenę manualną. Można obserwować, ukryć, przypisać do siebie / zwolnić oraz utworzyć zapytanie przez te same RPC assign_tender / create_inquiry_from_tender. Zapytanie istniejące otwiera się bez tworzenia drugiego. Po terminie przycisk tworzenia jest zablokowany; baza ponownie sprawdza warunki. Gdy przetarg jest prowadzony w zapytaniu, jego status wynika z etapu zapytania. „Konfiguracja” na pasku listy otwiera stronę „Konfiguracja filtrów” (słowa kluczowe, słowa wykluczające, kody CPV, lokalizacje, progi oceny, „Przelicz przetargi”) — opis niżej, „Przetargi: konfiguracja filtrów i płynna lista”.
8. **Powiadomienia:** dzwonek otwiera drawer po prawej, bez opuszczania bieżącej sekcji. Są filtr nieprzeczytanych, pojedyncze i zbiorcze przeczytanie. Obsługiwane cele: zadanie, zapytanie, kontakt, wydarzenie / istniejąca zakładka, oferta, przetarg i spotkanie. Rekord spoza obecnych filtrów jest doczytywany autoryzowanym zapytaniem, a filtr ustawiany tak, żeby go pokazać. Nieobsługiwana sekcja ma komunikat, bez losowego przekierowania do strony głównej ani panelu WWW.

### Transport i uprawnienia 0.3

Nowa, niewykonana migracja `20261101213000_native_workspace_v3.sql` tworzy osobną odczytową funkcję `native_workspace_sync_v3`. Nazwa wersjonowana zapobiega korzystaniu ze starszej, zbyt ubogiej migawki. Funkcja ma SECURITY INVOKER, istniejące RLS i wąską projekcję pól. Zawiera kolory kategorii kalendarza, daty wydarzeń przy ofertach, pełne dane prezentacyjne przetargu, edytowalne pola kontaktu i metadata powiadomień. Bez migracji klient używa jawnie pełnych odczytów tych samych tabel — nie trzeba wykonywać migracji do samego uruchomienia nowej wersji. Migracja nie aktualizuje rekordów biznesowych, istniejących polityk, ról ani zakresów przypisanych pracownikom.

Nie zmieniano klientów CRM/mobile ani ich katalogu uprawnień. Ujednolicenie dotyczy nawigacji i prezentacji klienta macOS, a zakres rekordów nadal wymusza baza. Rozszerzony kontrakt przyszłego własnego serwera opisano w docs/desktop-native-api.md.

Przy zmianie sekcji powiadomienie o błędzie nie zwęża list. Skróty: ⌘1 Mój dzień, ⌘2 Zapytania, ⌘3 Kanban, ⌘4 Wydarzenia, ⌘5 Kalendarz, ⌘6 Kontakty, ⌘7 Oferty, ⌘8 Przetargi, ⌘9 panel powiadomień.


Powiadomienia procesu wydarzeń: dzienny digest trafia wyłącznie do autora wydarzenia. Drawer udostępnia bezpośrednie przyciski do wydarzeń ujętych w podsumowaniu. Odroczenie przypomnienia i pełna kolejka kolejnych kroków są obecnie dostępne w CRM.

**Aktualizacja — każde powiadomienie otwiera sprawę na Macu, „Stan systemu” natywnie.** Przegląd powiadomień z 45 dni: komunikat „brak sekcji natywnej” dawały e-maile (najczęściej), flota, nieobecności, broszury, KSeF i faktury oraz awarie integracji. Teraz:
1. **Wiadomości** (`/crm/messages/<id>?type=received|sent|contact_form`) — Wiadomości z otwartą treścią, także spoza bieżącej skrzynki (usunięta albo bez dostępu — komunikat); bez id — skrzynka.
2. **Finanse** — `/crm/invoices/<id>` otwiera fakturę; zakładki Centrum, KSeF, Faktury, Koszty i wypłaty oraz sekcje „Dokumenty i rozliczenia” (wyciągi, uzgodnienie, terminy i monity, deklaracje, przekazanie księgowej, zamknięcie miesięcy) — właściwą część Finansów.
3. **Flota** — karta pojazdu; przypomnienie o przeglądzie otwiera „Serwis i naprawy”, o polisie — „Ubezpieczenia”.
4. **Pracownicy** (`/crm/employees/<id>?tab=…`) — karta pracownika na wskazanej zakładce (nieobecności i nadgodziny — oś czasu).
5. **Broszury** — broszura (np. raport pokazu portalu); bez id — lista broszur.
6. **Stan systemu i jakość danych** (`/crm/settings/system-health`, administrator) — okno jak strona CRM: podsumowanie, integracje z 24 godzin (błędy, zablokowane, ostatni błąd), jakość danych i bezpieczeństwo z rozwijanymi szczegółami (odnośniki otwierają rekordy na Macu, „Kopiuj SQL”), automatyczne alerty operacyjne; bez migracji kontroli operacyjnej albo drill-down — informacja, którą wykonać.
7. **Pozostałe adresy CRM** — sekcja z paska bocznego, jeśli ma ekran na Macu, inaczej strona CRM (zamiast komunikatu bez akcji).

Dane: te same funkcje bazy i uprawnienia co CRM (`get_crm_system_health`, `get_crm_data_quality`, `get_crm_security_health`, `get_crm_health_details`, `event_operational_alert_settings`). Bez zmian serwera i migracji.


## Aktualizacja 0.4 — CRM 1:1: menu, dashboard i motywy

Kierunek: aplikacja jest **odpowiednikiem 1:1 CRM w przeglądarce** (te same sekcje, ekrany, zakładki i kolejność), zbudowanym z natywnych elementów macOS: tabele natywne zamiast tabel HTML, arkusze zamiast modali, menu natywne zamiast „⋯”, systemowe potwierdzenia, wykresy Swift Charts, oś czasu i tablice kanban.

1. **Pasek boczny jak w CRM** — `GET /bridge/native/v1/navigation` zwraca menu pracownika liczone tą samą funkcją co pasek w przeglądarce (`navigationForUser` w `src/lib/CRM/navigation/getNavigationForUser.server.ts`: uprawnienia, realizacje, `navigation_order`). Pozycje z ekranem natywnym otwierają go w aplikacji; pozostałe (oznaczone ↗) tymczasowo otwierają stronę CRM w przeglądarce. Ostatnie menu jest zapamiętane na Macu do pierwszego odczytu.
2. **Dashboard jak `/crm`** — `GET /bridge/native/v1/dashboard` liczy dane funkcjami `dashboardData.ts` (te same co strona), tokenem pracownika. Kafelki, szybkie akcje, podsumowanie i aktywność są filtrowane na serwerze (`canView` / `canCreate`). Widok: „Mój plan” (oś czasu dziś / 3 dni z `get_employee_schedule`), trend sprzedażowy i lejek (Swift Charts), wpływy / wydatki / wynik kasowy, „Wymaga działania”, ostatnia aktywność, szybkie akcje i „Pozostałe wskaźniki”. Sprzedawca: oś czasu i „Mój dzień” jak w CRM. Dashboard odświeża się co 5 minut i na ⌘R.
3. **Motywy** — burgund, granat, ciemny i jasny jak w CRM (`employees.crm_theme`); Ustawienia → Wygląd. Zmiana zapisuje się w profilu i obowiązuje także w przeglądarce.

Budowanie z głównego katalogu projektu: `yarn build:mac` (→ `desktop/mac/build/Mavinci.app`), instalator do rozdania z publikacją aktualizacji: `yarn release` (sekcja „Instalator i aktualizacje”), sam DMG z ostatniego budowania: `yarn dmg:mac` (→ `desktop/mac/build/Mavinci.dmg`), uruchomienie: `yarn open mac` (zamyka działającą wersję i otwiera nowo zbudowaną).

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

„Dodaj zapytanie” i ustawienia SLA — natywnie (zob. „Aktualizacja — Zapytania: nowe zapytanie i SLA natywnie”); przekazanie zapytania i karta zapytania — natywnie od kolejnych wersji.

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
2. **Kafelek** jak na stronie: zdjęcie albo ikona typu, nazwa, oznaczenie sprzedawcy (status profilu; organizacja — „Sprzedawcy”), typ, e-mail, telefon, miasto, ocena, tagi, data dodania i liczba powiązanych osób / organizacji. **Lista** — natywna tabela z tymi samymi kolumnami. Prawy przycisk — karta, szczegóły, karta w CRM, Zadzwoń, Napisz e-mail, Nowe spotkanie, Edytuj, Usuń; dwuklik — karta rekordu.
3. **Szczegóły** w panelu bocznym: dane kontaktowe (telefony opisane jak na karcie kontaktu, strona WWW, adres z mapą), dane firmy (NIP, REGON, KRS, forma prawna, profil, status) albo stanowisko / uroczystość, osoby kontaktowe lub organizacje (kliknięcie pokazuje powiązaną kartę; „Główny”, „Decydent”), zapytania klienta (otwierają lejek), tagi, notatki, „Pełna karta w CRM” (Klient 360°, oferty, faktury, historia — w przeglądarce).
4. **Czynności**: Zadzwoń (telefon główny osoby prywatnej, komórkowy pozostałych), Napisz e-mail (okno nowej wiadomości ze skrzynką firmową, tematem „Wiadomość od Mavinci dla …” i powitaniem, jak w CRM), Nowe spotkanie (kontakt — a dla organizacji osoba główna — od razu jako uczestnik).
5. **Karta, dodawanie i edycja** — natywnie, zob. „Kontakty: karta organizacji i kontaktu, dodawanie i pełna edycja” niżej. **Usuwanie** (`contacts_manage`) z potwierdzeniem; baza nie pozwoli usunąć klienta z powiązanymi dokumentami. Podwykonawcy — natywnie (zob. „Kontakty: podwykonawcy natywnie”).
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

## Aktualizacja — Okna i karty: kilka sekcji jednocześnie

Każde okno Mavinci ma własną nawigację — w jednym oknie mogą być otwarte Wiadomości, w drugim karta wydarzenia, w trzecim Finanse, i wszystkie działają jednocześnie na wspólnych danych (jedna sesja, jedna kopia na dysku, jedna synchronizacja).

1. **Plik → Nowe okno (⇧⌘N)** i **Plik → Nowa karta (⇧⌘T)** — ta sama sekcja co w bieżącym oknie (bez otwartej karty wydarzenia i panelu powiadomień) w nowym oknie albo jako karta bieżącego okna. ⌘N zostaje w sekcjach dla „Nowe zadanie / spotkanie / wiadomość”.
2. **Prawy przycisk** na pozycji paska bocznego (sekcje natywne) → „Otwórz w nowym oknie” / „Otwórz w nowej karcie”; na wydarzeniu w liście Wydarzeń — karta tego wydarzenia w nowym oknie lub karcie („Wróć” pokazuje tam listę Wydarzeń), a lista zostaje.
3. Karty to karty okien macOS: pasek kart (Widok → Pokaż pasek kart), przeciągnięcie karty do osobnego okna, Okno → Scal wszystkie okna, przełączanie ⌃⇥ / ⇧⌘] — w karcie wydarzenia te skróty przełączają zakładki wydarzenia. Tytuł karty to nazwa sekcji albo wydarzenia.
4. Czynności trafiają do okna, w którym pracujesz: pasek boczny, przyciski i adresy `mavinci://` — do swojego okna; menu Mavinci (⌘1–9, ⌘R), pasek menu i odnośniki z osobnego okna wiadomości — do ostatnio aktywnego okna. Wskaźnik „Zapisywanie…” i komunikaty są widoczne w oknie, w którym zaczęła się czynność — pozostałe okna działają dalej (zapisy nadal wykonują się po jednym).
5. Odświeżanie w tle (co 60 s i przy powrocie do aplikacji) jest jedno niezależnie od liczby okien — pomijane, gdy poprzednie zaczęło się przed chwilą; licznik Wiadomości synchronizuje się raz na 30 s, choć każde okno ma swój pasek boczny.
6. Zamknięcie okna nie przerywa pracy pozostałych; po zamknięciu ostatniego okna i ponownym otwarciu (Dock, „Otwórz Mavinci” na pasku menu) wraca ostatni widok. Zmiana konta przywraca w każdym oknie dostępne sekcje; wylogowanie zostawia jedno okno (logowanie) i zamyka pozostałe okna i karty.
7. **Przeciągnięcie pozycji paska bocznego** (sekcje natywne) — jak w Finderze: za kursorem idzie obraz wiersza (ikona i nazwa), a pozycja na pasku przygasa. Kliknięcie i przeciągnięcie są rozróżniane: przeciąganie zaczyna się dopiero po ruchu myszy (przeciąganie listy systemowej, `itemProvider`), a kliknięcie podświetla pozycję od razu i otwiera sekcję po puszczeniu przycisku — za pierwszym razem, także przy drobnym drgnięciu myszy. Jeśli w trakcie wciśnięcia zaczęło się przeciąganie, bieżąca karta zostaje bez zmian (sekcja otworzy się tam, gdzie ją upuścisz). Wcześniej przeciąganie przechwytywało kliknięcie w nazwę pozycji — przejście następowało dopiero przy kolejnym kliknięciu. Tuż pod kartami każdego okna wysuwa się pasek (akcesorium paska tytułu macOS, widoczny także na pełnym ekranie) z polami **„W tej karcie”**, **„W nowej karcie”** i **„W nowym oknie”** — pole pod kursorem podświetla się, kursor dostaje zielony „+”; upuszczenie otwiera sekcję w tej karcie albo jak „Otwórz w nowej karcie / w nowym oknie” (karta dołącza do okna, nad którym upuszczono). Systemowy pasek kart nie przyjmuje upuszczania z aplikacji (brak publicznego API — Finder robi to po swojej stronie), stąd pasek tuż pod nim. Upuszczenie poza polami niczego nie otwiera (etykieta wraca na miejsce) i nie wkleja tekstu do pól w treści okna; pasek chowa się po puszczeniu przycisku myszy albo Esc. Kod: `NavigationDrag.swift`.

**Ograniczenie** (zniesione — „Okna i karty — jak w VS Code” wyżej: każde okno i karta ma własny obszar roboczy): stan wewnątrz sekcji przechowywany w jej danych był wspólny — ta sama sekcja otwarta w dwóch oknach pokazywała ten sam otwarty rekord i wybór (np. karta pracownika, pojazdu, oferty, folder i zaznaczona wiadomość).

Kod: `WindowNavigation.swift` (nawigacja okna, rejestr okien w `Workspace`, „Nowe okno / Nowa karta”, „Otwórz w nowym oknie”); `Workspace` zachowuje dotychczasowe czynności (`switchSection`, `showEvent`, `openHref`…) — działają w aktywnym oknie, a widoki okna czytają własną `WindowNavigation`.

## Aktualizacja — Kalendarz Apple bez podwójnych wpisów

Przyczyna podwójnych wydarzeń na iPhonie i w Apple Watch: kopia z aplikacji zapisana w kalendarzu **iCloud** trafia na wszystkie urządzenia, a na iPhonie bywa też **subskrypcja kalendarza CRM** (link webcal z CRM → Ustawienia → Kalendarz). To dwa niezależne źródła tych samych wydarzeń — iOS ich nie scala.

Okno **„Połącz z Kalendarzem Apple…”** (`AppleCalendarSync.swift`):
1. Przy wybranym kalendarzu widać, gdzie trafi kopia: „tylko ten Mac” albo konto (iCloud → także iPhone i Apple Watch). Kalendarze „Na moim Macu” są na początku listy; przycisk tworzy „Mavinci CRM” na tym Macu, jeśli macOS na to pozwala (przy włączonym iCloud systemowe miejsce „Na moim Macu” bywa niedostępne — wtedy tworzony jest w domyślnym koncie). Istniejący kalendarz o tej nazwie jest wybierany ponownie, a nie tworzony drugi raz.
2. **Ostrzeżenie o podwójnych wpisach**, gdy kopia jest w kalendarzu synchronizowanym z telefonem, a jednocześnie na Macu jest subskrypcja kalendarza CRM albo pracownik ma link subskrypcji (`calendar_feed_tokens`, własny wiersz, RLS). Gdy link był pobierany w ostatnich 3 dniach, okno mówi, że subskrypcja działa na którymś urządzeniu.
3. **„Przenieś kopię do …”** — po wybraniu innego kalendarza: kopia znika z poprzedniego i powstaje w nowym (np. z iCloud do kalendarza tylko na tym Macu).
4. **„Usuń kopię z kalendarza…”** — z potwierdzeniem i liczbą wpisów; usuwa wyłącznie wpisy utworzone przez Mavinci i wyłącza automatyczną aktualizację.
5. **Jedna kopia na wpis**: kopie są rozpoznawane po adresie wpisu niezależnie od połączenia (wcześniej klucz zawierał adres serwera i klucz publiczny, więc po zmianie połączenia — np. przeniesieniu bazy — kolejna synchronizacja tworzyłaby drugą kopię). Nadmiarowe kopie tego samego wpisu oraz wpisy, których nie ma już w CRM, są usuwane; zapis tylko przy zmianie pól (bez zbędnego ruchu w iCloud); pusta odpowiedź CRM nie czyści kalendarza. Powiązanie w pęku kluczy jest teraz per pracownik (`apple-calendar-v2-…`, dawny zapis przenoszony automatycznie); jeden kalendarz Apple należy do jednego konta Mavinci na tym Macu.
6. **„Aktualizuj kopię automatycznie po każdym odświeżeniu danych”** — po odświeżeniu kalendarza CRM kopia zmienia się sama (tylko gdy wpisy się zmieniły). Domyślnie włączone dla nowego powiązania, dla dawnego wyłączone.

Serwer CRM: link subskrypcji (`/bridge/events/calendar/ical/[token]`) zapisuje datę ostatniego pobrania (wcześniej zapytanie bez `await` nigdy się nie wykonywało). Strona CRM → Ustawienia → Kalendarz uprzedza w instrukcji dla iPhone'a, żeby nie łączyć subskrypcji z kopią z Maca w iCloud. Bez migracji.

Doraźnie, bez aktualizacji: na iPhonie w Kalendarz → Kalendarze odznacz kopię z Maca (kalendarz iCloud) albo subskrypcję CRM — Apple Watch pokazuje te same kalendarze co iPhone.

## Aktualizacja — Komunikator (czat pracowników) natywnie

Komunikator działa jak widżet czatu w CRM i w telefonie — te same rozmowy, liczniki i zasady odczytu, bez przeglądarki:
1. **Widżet**: okrągły przycisk z licznikiem w prawym dolnym rogu okna (i przycisk na pasku narzędzi obok powiadomień, menu Mavinci → Komunikator, ⌥⌘K) otwiera panel „Komunikator” ze zwijaniem i zamykaniem. Każde okno ma własny panel; licznik nieprzeczytanych jest też na ikonie w Docku.
2. **Lista rozmów**: wyszukiwanie, awatar z zieloną kropką „online” (obecność jak w CRM — Mac także pokazuje Cię jako dostępnego), nazwa (pogrubiona przy nieprzeczytanych), czas („Wczoraj”, dzień tygodnia, data), podgląd z „Ty: …” / „Anna: …” w grupie, status własnej wiadomości (✓ wysłano, ✓✓ dostarczono, złote ✓✓ wyświetlono) i licznik.
3. **Rozmowa**: 20 ostatnich wiadomości, starsze po przewinięciu do góry („Pokaż starsze wiadomości”), separatory dni, dymki (w grupie z nadawcą i awatarem), „pisze…” w nagłówku i w rozmowie, Online/Offline albo liczba uczestników, pod ostatnią własną wiadomością „Wysłano / Dostarczono / Wyświetlono” (podpowiedź: godzina albo kto wyświetlił), miniatury osób pod ostatnią przeczytaną wiadomością. **Reakcje** (❤️ 😂 😮 😢 😡 👍) przyciskiem przy dymku albo prawym przyciskiem — także na cudze wiadomości, usuwanie własnej. Prawy przycisk: kopiuj tekst, otwórz / pobierz / kopiuj link załącznika, zaznacz, **usuń u mnie** (jak w CRM — tylko na tym Macu, pozostali dalej widzą). Menu „⋯” → Zaznacz wiadomości i usunięcie zaznaczonych.
4. **Wysyłanie**: Enter wysyła (⇧↩ / ⌥↩ — nowa linia), spinacz albo przeciągnięty plik dodaje załącznik do 20 MB (zdjęcie, film, PDF, dokument; podgląd przed wysłaniem i komentarz). Zdjęcia w rozmowie z powiększeniem i „Pobierz zdjęcie”, filmy i PDF w oknie podglądu (Pobierz…, Otwórz w przeglądarce), pozostałe pliki otwierają się w domyślnej aplikacji. Po wysłaniu uczestnicy dostają push w telefonie (`send-chat-push`, jak z CRM).
5. **Nowa rozmowa**: lista aktywnych pracowników z wyszukiwaniem i rolą; jedna osoba — istniejąca rozmowa 1:1 otwiera się zamiast tworzenia nowej, kilka — grupa z opcjonalną nazwą. Na karcie pracownika (Zespół) link **Czat** otwiera rozmowę z tą osobą.
6. **Odczyt jak w Messengerze**: licznik liczy tylko wiadomości innych osób nowsze niż Twój znacznik odczytu (serwer); „wyświetlono” zapisuje się tylko, gdy rozmowa jest na ekranie, a aplikacja aktywna (także po powrocie do aplikacji), w tle — „dostarczono”. Odczyt w CRM albo w telefonie zeruje licznik na Macu.
7. **Na żywo**: Supabase Realtime (nowe wiadomości, reakcje, odczyty, „pisze…”, obecność); bez połączenia na żywo (ikona odświeżania w nagłówku panelu) komunikator odpytuje serwer — lista co 8 s, otwarta rozmowa co 4 s. Nowa wiadomość poza otwartą rozmową: dźwięk (aplikacja na wierzchu) i powiadomienie macOS (kliknięcie otwiera rozmowę; jedno na rozmowę, znika po przeczytaniu). Przy pierwszym uruchomieniu macOS pyta o zgodę na powiadomienia.

Dane: te same tabele i funkcje co CRM i telefon (`employee_conversations`, `employee_conversation_participants`, `employee_messages`, `get_chat_unread_counts`, `mark_chat_read`, `mark_chat_delivered`, `set_chat_message_reaction`, koszyk `chat-attachments`) — tokenem pracownika, RLS jak w przeglądarce. Wymaga połączenia „Supabase” w ustawieniach aplikacji. Bez zmian na serwerze i bez migracji. Kod: `Chat/ChatModels.swift` (modele, reguły odczytu — `chatReadState.ts`), `Chat/ChatRealtime.swift` (Realtime), `Chat/ChatStore.swift` (stan, odpytywanie, powiadomienia), `Chat/ChatViews.swift` (widżet, lista, nowa rozmowa), `Chat/ChatThreadView.swift` (rozmowa, załączniki), `WindowNavigation.swift` (panel w oknie), `MavinciApp.swift`, `Team/EmployeeProfileView.swift`.

## Aktualizacja — Kontakty: karta organizacji i kontaktu, dodawanie i pełna edycja

Organizacje, kontakty i osoby prywatne mają w aplikacji pełną kartę i formularze jak `/crm/contacts/[id]` i `/crm/contacts/new` — bez przechodzenia do przeglądarki.

1. **Karta rekordu** — dwuklik na kafelku lub wierszu listy, „Otwórz kartę” w szczegółach i w menu kontekstowym, odnośniki z Zapytań, Spotkań i umowy wydarzenia; „Kontakty” na pasku narzędzi wraca do listy. Nagłówek: typ, status, sprzedawca, organizacje kontaktu, Zadzwoń / Napisz e-mail / Spotkanie. Zakładki organizacji według uprawnień do zakładek (`organization_tabs`, jak w CRM):
   - **Szczegóły** — informacje podstawowe; dane do faktury (nabywca, rola na fakturze, jednostki rozliczane na tę organizację); lokalizacja (otwiera Lokalizacje); reprezentanci i osoby decyzyjne (osoba kontaktowa, reprezentant ze stanowiskiem, sposób, zasada, podstawa i data sprawdzenia reprezentacji, ostrzeżenie przy reprezentacji łącznej z mniej niż dwiema osobami do podpisu, dodawanie i usuwanie osób decyzyjnych, „Uprawniony do podpisu / współreprezentacji”);
   - **Osoby kontaktowe** — dodanie z listy kontaktów (ze stanowiskiem) albo nowej osoby („Główny kontakt”), usunięcie powiązania, przejście do karty osoby;
   - **Notatki** — szybkie notatki z autorem i datą (usuwa autor albo administrator);
   - **Faktury** — liczba, suma brutto i netto, faktura otwiera się w Finansach (karta faktury); **Realizacje** — otwierają kartę wydarzenia;
   - **Relacja i segmentacja** — opiekun i etap relacji (reguły CRM: administrator przypisuje dowolnie, opiekun przekazuje lub zwalnia, klienta bez opiekuna można przypisać sobie; etap — `contacts_manage`), segmentacja i komunikacja (segmenty, nowy segment, status, podstawa prawna, dostarczalność, częstotliwość, zainteresowania, typy wydarzeń, regiony, budżet, zgoda z datą, źródłem i dowodem; „Mailing dozwolony”), domeny organizacji, zapytania klienta, broszury.
   Kontakt i osoba prywatna: **Dane kontaktowe** (osoba prywatna — także PESEL i numer dowodu, tylko w pamięci), **Organizacje** (powiązanie z organizacją ze stanowiskiem, usunięcie powiązania), **Relacja i segmentacja** z możliwymi duplikatami (ten sam e-mail lub telefon; administrator porównuje liczby powiązań i scala). Klient 360°, zapytania, oferty, sprzedaż sprzedawcy, usługi podwykonawcy i „Dodaj zapytanie” — natywnie (zob. „Kontakty: Klient 360°, zapytania, oferty i sprzedawca natywnie”); branding ofert oraz sale i przestrzenie hotelu — „Karta w CRM”.
2. **Nowy kontakt** (pasek narzędzi): Organizacja, Kontakt, Osoba prywatna, Podwykonawca (natywnie).
   - **Organizacja**: NIP i „GUS / rejestry” (GUS, KRS, CEIDG, biała lista VAT — dane firmy, forma prawna, sposób reprezentacji i osoby z KRS; jedna osoba uprawniona i dokładnie jeden kontakt o tym imieniu i nazwisku — od razu reprezentant), profil działalności, forma prawna (KRS tylko dla form wpisywanych do KRS), REGON, numer identyfikacji wewnętrznej KSeF, adres i kontakt, ocena, status, dane do faktury (nabywca, np. gmina, i rola: jednostka JST 8 / oddział 2), lokalizacja (wyszukiwanie albo nowa lokalizacja z formularza; wymagana dla hotelu), reprezentacja (sposób, główny reprezentant, osoby do podpisu przy reprezentacji łącznej, osoby z rejestru — „Dodaj kontakt i wybierz”, zasada, podstawa, data sprawdzenia), osoby kontaktowe (z listy albo nowa osoba).
   - **Kontakt** i **osoba prywatna**: pola jak w CRM, kontakt — opcjonalnie od razu z organizacją; serwer sprawdza duplikat (e-mail, telefon, NIP) — „Otwórz istniejący kontakt”.
   Po zapisie otwiera się karta nowego rekordu.
3. **Edycja** (Edytuj ⌘E na karcie i w szczegółach; dla każdego z dostępem do kontaktów, jak „Edytuj” w CRM — zapis rozstrzyga baza): organizacja — wszystkie pola formularza, dane do faktury, lokalizacja, osoba kontaktowa, reprezentant („Osoba kontaktowa jest też osobą uprawnioną do zawarcia umowy”), sposób, zasada, podstawa i data sprawdzenia reprezentacji, „GUS / rejestry”; kontakt i osoba prywatna — wszystkie pola karty. Zapisywane są tylko zmienione pola; walidacja na serwerze ta sama co w przeglądarce (`validateOrganizationForm`, `personContactSchema`), błędy przy polach. Usuwanie, etap relacji i segmentacja — `contacts_manage`; scalanie — administrator.
4. **Ograniczenia**: otwarta karta jest wspólna dla okien (jak inne sekcje); „Kontakty” wraca do listy (bez historii kolejnych kart); nowa lokalizacja z formularza organizacji ma nazwę, adres i dane kontaktowe obiektu — mapę, sale i informacje techniczne uzupełnia się w Lokalizacjach.

Serwer: `src/lib/native/contactCard.ts` i `/bridge/native/v1/contacts` (`op=card|buyers|locations`; `create|update|quickContact|link|linkNew|unlink|decisionMaker|note|ownership|domains|segmentation|segmentCreate|mergePreview|merge`) — tokenem pracownika, RLS i wyzwalacze jak w przeglądarce (`require_hotel_location`, `guard_organization_invoice_buyer`, `protect_customer360_responsibility`); bez migracji. Kod: `Contacts/ContactCardView.swift`, `ContactCardSheets.swift`, `ContactCardModels.swift`, `OrganizationEditorSheet.swift`, `ContactSheets.swift`.

## Aktualizacja — Kontakty: Klient 360°, zapytania, oferty i sprzedawca natywnie

1. **Klient 360°** (pierwsza zakładka karty, jak `Customer360Panel` / `Organization360Panel`): wskaźniki — otwarte zapytania, wartość szans, nadchodzące wydarzenia, zaległe działania. Osoba: **oś aktywności** we wszystkich kanałach (połączenia z notatką, odebrane i wysłane e-maile, zapytania — także dopasowane po e-mailu lub telefonie, spotkania, oferty z datą ważności, wydarzenia z terminem), **następne najlepsze działanie**, powiązane organizacje, **jakość danych** (e-mail, telefon, organizacja — „uzupełnij”); u sprzedawcy z dostępem do finansów — „Zobacz rozliczenia prowizji…” (w CRM). Organizacja: **historia** (połączenia, zapytania, oferty, wydarzenia, faktury z płatnikiem — „płatnik: hotel”, „opłacana przez hotel”, „inny płatnik” — i Twoja korespondencja z organizacją, „Pokaż starszą korespondencję” po 100), następne działanie, kontakty, **Sprzedawcy w tej organizacji** (status i portal; kliknięcie — karta sprzedawcy na Macu; pozostałe osoby z „Mianuj sprzedawcą” i „Pokaż portal hotelowi” — w CRM). Kliknięcie elementu osi otwiera zapytanie, ofertę, wydarzenie, fakturę albo spotkanie natywnie, wiadomość — w Wiadomościach CRM. Opiekun, etap relacji, segmentacja, domeny i duplikaty — zakładka „Relacja i segmentacja”.
2. **Zapytania** (jak `CustomerInquiryHistory`): zapytania osoby albo organizacji i osób w niej zatrudnionych (organizacja wskazana wprost ma pierwszeństwo), data, etap, „Zarchiwizowane”, po 25 z „Pokaż starsze zapytania”; tytuł otwiera zapytanie w lejku (tam notatki i rozmowy).
3. **Oferty** (jak `CustomerOffersPanel`): numer, status, data utworzenia i ważności, po 25 z „Pokaż starsze oferty”, „Odśwież”; kliknięcie otwiera ofertę.
4. **Usługi** (organizacja-podwykonawca) — ten sam panel „Zakres i usługi” co na karcie podwykonawcy. **Sprzedaż sprzedawcy** (kontakt-sprzedawca) — status i „Otwórz kartę sprzedawcy” (sekcja Sprzedawcy na Macu, z zaznaczoną kartą; spoza listy opiekuna — karta w CRM).
5. **Dodaj zapytanie** (nagłówek karty; administrator, `inquiries_manage`, `inquiries_manage_all` albo `tasks_create`, jak „Szybkie akcje” w CRM) — okno „Nowe zapytanie” z danymi klienta (organizacja; osoba — z jedyną obecną organizacją); po zapisie lejek z nowym zapytaniem.

Serwer: `src/lib/native/contactCustomer360.ts`, trasa `/bridge/native/v1/contacts` (`GET op=customer360|customer360Mail|customerOffers|customerInquiries|inquiryClient`) — te same zapytania co karta CRM, tokenem pracownika (RLS). Bez migracji. Kod: `Contacts/ContactCustomer360View.swift`, `Contacts/ContactCardView.swift`; sprzedawca — `Sellers/SellersStore.swift`, `Sellers/SellersView.swift`. **Zostaje w CRM**: branding ofert (podgląd z portalu sprzedawcy) oraz sale i przestrzenie hotelu, rozliczenia prowizji sprzedawcy, konto prowizji organizacji.

## Aktualizacja — Dashboard: magazyn, „Moja sprzedaż” i „Dostosuj dashboard” natywnie

1. **Dashboard magazynu i logistyki** (pracownik magazynu z etapami operacyjnymi, jak `WarehouseDashboard`): „Magazyn i logistyka”, plan dnia, skróty Sprzęt / Wydarzenia / Moje zadania; **Uszkodzony sprzęt** (do 20 ostatnio aktualizowanych egzemplarzy z liczbą wszystkich, numer seryjny, uwagi — kliknięcie otwiera kartę sprzętu), **Wydarzenia do przygotowania** (termin i etap operacyjny — karta wydarzenia), **Moje zadania do wykonania** (otwarte przypisane zadania z terminem — zadanie na tablicy). Sekcja, której nie udało się pobrać, pokazuje własny komunikat.
2. **Moja sprzedaż** (sprzedawca, jak `SellerFinancialDashboard`): rok wydarzenia (poprzedni / następny, odśwież), sprzedane i zafakturowane wydarzenia, waluta (gdy jest kilka), kafelki: zafakturowana sprzedaż, potwierdzone płatności, pozostało do zapłaty, po terminie; wykres miesięczny (zafakturowano / opłacono) i tabela sprzedanych wydarzeń (karta wydarzenia, data i status, kwoty); „Moje faktury” — Finanse na Macu. Raport bieżącego roku przychodzi z dashboardem, kolejne lata z funkcji bazy `get_my_sales_financial_report` (sama rozstrzyga, czyja to sprzedaż).
3. **Dostosuj dashboard** (jak zakładka „Dashboard” w Ustawieniach CRM): domyślny zakres wykresów (6 / 12 miesięcy) i widoczne sekcje (Pozostałe wskaźniki, Trend sprzedażowy, Lejek sprzedaży, Wpływy, wydatki i wynik kasowy, Wymaga działania, Ostatnia aktywność, Szybkie akcje) z opisami; „Ustaw domyślny widok”, „Zapisz dashboard” — zapis w ustawieniach konta (działa też w przeglądarce), dashboard odświeża się od razu. **Szybkie akcje** otwierają sekcje natywnie (jak linki w CRM).

Serwer: `src/lib/native/dashboardExtras.ts`, trasa `/bridge/native/v1/dashboard` — dashboard magazynu z danymi (`warehouse`), `GET op=sales&year=…`, `GET op=preferences`, `POST op=preferences` (zmienia tylko część `dashboard` preferencji pracownika). Tokenem pracownika (RLS). Bez migracji. Kod: `DashboardExtras.swift`, `DashboardView.swift`.

## Aktualizacja — Kategorie wydarzeń i lokalizacje magazynowe natywnie

1. **Kategorie wydarzeń** (Wydarzenia → „Kategorie”, jak `/crm/event-categories`; jak w CRM — z uprawnieniem `event_categories_manage`, bez niego „Brak uprawnień”): kafelki kategorii — kolor z ikoną, nazwa, zapis koloru, opis, Aktywna / Nieaktywna; **Nowa kategoria** i edycja: nazwa *, ikona z biblioteki (lista do wyboru, „Bez ikony”), kolor * (próbnik, zapis #RRGGBB i paleta 10 kolorów), opis, szablon oferty (domyślny albo kategoria szablonów ofert), szablon umowy (aktywne szablony), „Kategoria aktywna”; usuwanie z potwierdzeniem (wydarzenia i produkty zostają bez kategorii — jak w bazie). **Zarządzaj ikonami**: dodawanie i edycja ikony (nazwa *, kod SVG *, podgląd na kolorze podglądu), lista dostępnych ikon z edycją i usuwaniem (kategorie z usuniętą ikoną zostają bez ikony). Ikony SVG rysowane natywnie (`currentColor` w kolorze tekstu, jak w CRM). Po zmianie lista wydarzeń odświeża kategorie (filtr i karta).
2. **Lokalizacje magazynowe** (Magazyn → „Lokalizacje”, jak `/crm/equipment/locations`): kafelki — nazwa, aktywna / nieaktywna (nieaktywne przygaszone), adres, „Dostęp:”, „Otwórz w Google Maps”, notatki; z uprawnieniem do zarządzania magazynem — **Dodaj lokalizację**, **Edytuj** (nazwa *, adres, URL Google Maps z przyciskiem „Test” — współrzędne jak w CRM, skrócone linki odrzucone; informacje o dostępie, notatki, „Lokalizacja aktywna”) i usuwanie z potwierdzeniem. Lokalizacji z przypisanymi jednostkami sprzętu baza nie pozwala usunąć — komunikat podpowiada przeniesienie jednostek. Po zmianie magazyn odświeża słownik lokalizacji i karty sprzętu.

Serwer: `src/lib/native/eventCategories.ts` i trasa `/bridge/native/v1/event-categories` (`GET op=list`, `POST op=save|delete|iconSave|iconDelete`), `src/lib/native/storageLocations.ts` i trasa `/bridge/native/v1/storage-locations` (`GET op=list`, `POST op=save|delete`) — tokenem pracownika, zapis rozstrzyga RLS (brak zmienionego wiersza — komunikat o braku uprawnień). Bez migracji. Kod: `Events/EventCategoriesView.swift`, `Warehouse/StorageLocationsView.swift`; wejścia — `Events/EventsListView.swift`, `Warehouse/WarehouseView.swift`. Różnice względem CRM: komunikaty błędów bazy po polsku (np. zajęta nazwa kategorii, lokalizacja z jednostkami) zamiast „Błąd: … Kod: …”; administrator bez osobnego uprawnienia `event_categories_manage` może zapisywać, jeśli pozwala na to baza (CRM blokował zapis już w przeglądarce).

## Aktualizacja — Kontakty: podwykonawcy natywnie

1. **Lista** (Kontakty → „Podwykonawcy”, jak `/crm/subcontractors`): kafelki — nazwa, usługi z katalogu („Usługi do uzupełnienia”), telefon albo e-mail, forma rozliczenia („Rozliczenie do ustalenia”), „Nieaktywny · do uzupełnienia”; wyszukiwanie po nazwie, telefonie, e-mailu i usługach; „Kontakty” wraca do listy kontaktów.
2. **Nowy podwykonawca** („Dodaj podwykonawcę” albo Nowy kontakt → Podwykonawca) i **Edytuj** na karcie — formularz jak `SubcontractorProfileForm`: forma rozliczenia (Faktura VAT, Faktura bez VAT, Gotówka, Umowa zlecenie), nazwa firmy albo imię i nazwisko, telefon, e-mail, przy fakturze NIP (z sumą kontrolną) i adres firmy, notatki; przy umowie zlecenia — dane do umowy (PESEL, numer konta NRB / IBAN, adres zamieszkania z części: typ, ulica / plac / wieś, numer domu i mieszkania, kod pocztowy, miejscowość, kraj; dotychczasowy adres zostaje, dopóki nie uzupełnisz pól) — tylko z uprawnieniami do umów i wynagrodzeń, jak w CRM. Komunikaty pól jak w CRM, po pierwszej próbie zapisu sprawdzane na bieżąco. Po dodaniu: karta na zakładce „Zakres i usługi”, a przy umowie zlecenia — zakładka „Umowy” i kreator umowy zlecenia w CRM.
3. **Karta** (jak `/crm/subcontractors/[id]`): nazwa, status, ocena, stawka godzinowa, forma rozliczenia; zakładki **Szczegóły** (informacje kontaktowe, dane finansowe: NIP, stawka, warunki płatności, numer konta; usługi i cennik; statystyki: liczba zadań i umów, koszt zadań, wartość umów; notatki), **Zadania** (wydarzenie z przejściem do jego podwykonawców, status i płatność, typ rozliczenia, godziny, stawka lub cena, koszt, faktura i data zapłaty), **Umowy** (umowy ramowe i projektowe: typ, wartość, daty, status, plik). Karta otwiera się także z zakładki Podwykonawcy wydarzenia („Karta podwykonawcy”).
4. **Zakres i usługi** (jak `SubcontractorServicesPanel`): „Świadczone usługi” — typy Usługi, Wynajem sprzętu, Transport („Dodaj typ usługi” z notatką; zakładka typu z oznaczeniem „Nieaktywny”, Aktywuj / Dezaktywuj, usuwanie z potwierdzeniem). Katalog typu w kafelkach: miniatura, nazwa, opis, kategoria, przy usługach warunki (czas w cenie, przedłużenie, dojazd, warunki realizacji) i cena („Cena do ustalenia”, cena za jednostkę, netto, za dzień, „Gotówka poza KUP · koszt ekonomiczny”), „Nieaktywny”; usuwanie pozycji z potwierdzeniem. **Dodaj pozycję do katalogu**: nazwa, opis; usługa — zdjęcia (do 10 MB, zmniejszane do 1920 px, gwiazdka ustawia miniaturę, usunięcie zdjęcia przed zapisem kasuje plik), kategoria, sposób rozliczenia (faktura: stawka VAT i ceny netto ↔ brutto; gotówka z dokumentem; gotówka poza KUP: kwota „do ręki”, CIT i podatek od dywidendy z kalkulacją kosztu ekonomicznego, efektywnego opodatkowania i narzutu — jak `calculateSubcontractorSettlementCost`), sposób wyceny (za realizację / za godzinę), warunki; wynajem — kategoria, VAT, cena dzienna netto ↔ brutto, ilość, wymagane umiejętności (oddzielone przecinkami). Kliknięcie usługi otwiera **kartę usługi** (jak `/crm/subcontractors/service/[id]`): podwykonawca z organizacją, podstawowe informacje, warunki, sposób wyceny, status, cennik (forma rozliczenia, VAT, netto / brutto albo kwota „do ręki” z kalkulacją poza KUP, cena za jednostkę), galeria z podglądem (poprzednie / następne); **Edytuj** (z `contacts_manage` albo `equipment_manage`): te same pola, przeliczenia jak w CRM, zdjęcia z dysku lub przeciągnięte (pierwsze w pustej galerii — główne), główne zdjęcie, usuwanie zdjęć; **Usuń** z potwierdzeniem. Kliknięcie pozycji wynajmu otwiera jej kartę w Magazynie → Rental (bez dostępu do Rentalu — w CRM).

Serwer: `src/lib/native/subcontractors.ts` i nowa trasa `/bridge/native/v1/subcontractors` (`GET op=list|card|personnel`, `POST op=save`) — dostęp jak moduł Kontakty w CRM, tokenem pracownika (RLS); walidacja tym samym schematem co formularz CRM (`subcontractorProfileSchema`); umowa zlecenia — funkcja bazy `save_subcontractor_personnel_profile` (uprawnienie do umów i wynagrodzeń), pozostałe formy — zapis w `subcontractors`. Usługi: `src/lib/native/subcontractorServices.ts` (`GET op=services|service`, `POST op=serviceTypeAdd|serviceTypeToggle|serviceTypeRemove|catalogAdd|catalogDelete|serviceSave|serviceDelete|serviceImageRemove`, zdjęcie — multipart `?op=serviceImage&folder=…` do `service-catalog-images`; folder tylko usługi albo `temp-…` nowej pozycji) — te same pola i wyliczenia co w CRM (moduł `settlementCosts`). Bez migracji. Kod: `Contacts/SubcontractorsView.swift`, `Contacts/SubcontractorServicesView.swift`; wejścia — `Contacts/ContactsView.swift`, `Contacts/ContactsStore.swift`, `Events/EventSubcontractorsTab.swift`. Różnice względem CRM: zmiana stawki VAT przy wpisanej cenie netto przelicza też cenę za jednostkę (w CRM zostawała poprzednia kwota brutto); zdjęcie usunięte w edycji karty usługi znika z magazynu dopiero po „Zapisz” (w CRM od razu — „Anuluj” zostawiał w galerii nieistniejący plik); okno nowej pozycji wynajmu nie ma sekcji zdjęć (CRM przesyłał je, ale nie zapisywał przy pozycji). **Zostaje w CRM** (przycisk otwiera właściwą zakładkę): rejestr umów zlecenia — etap „Umowy personelu”. Przyciski „Dodaj zadanie” i „Dodaj umowę” z karty CRM nie mają tam jeszcze formularza — na Macu ich nie ma.

## Aktualizacja — Zapytania: nowe zapytanie i SLA natywnie

1. **Nowe zapytanie** — okno jak „Nowe zapytanie” w CRM (`NewInquiryModal`): temat zapytania *, źródło (Telefon, Rozmowa / spotkanie, Polecenie, Social media, Inne źródło), termin (data i godzina, opcjonalnie; przy nietypowym dniu — informacja jak w CRM: święto, niedziela, długi weekend, Sylwester), klient z podpowiedziami (organizacje i osoby kontaktowe — wybór osoby uzupełnia telefon i e-mail; wpisanie tekstu odpina wybór), telefon, e-mail, lokalizacja z podpowiedziami z bazy albo wpisana, liczba osób (opcjonalnie, 1–100 000), zakres, budżet, oczekiwania. Wymagane: temat oraz nazwa, telefon albo e-mail klienta (komunikaty jak w CRM). Zapis jak w CRM: zapytanie na początku listy zadań, pilne, etap „Nowe”, bez opiekuna (wspólna kolejka), szansa 10%, wartość z budżetu, opis i szczegóły źródła; identyfikator nadany przy otwarciu okna — ponowne kliknięcie nie tworzy duplikatu. **Skąd**: Zapytania → „Dodaj zapytanie” (po zapisie: otwarte zapytania we wspólnej kolejce, „Zapytanie zostało dodane do wspólnej kolejki”); Kalendarz → „Co chcesz dodać?” → Zapytanie albo „Nowe zapytanie…” w menu dnia (termin tego dnia).
2. **SLA** (administrator) — „Automatyzacja SLA” jak w CRM: automatyczne przypomnienia, przydzielanie nowych zapytań (dotychczasowe / rotacyjne), wymagaj kolejnego działania po kontakcie z domyślnym czasem (godz.), automatyczna aktualizacja etapu klienta, czasy: nieprzypisane po, pierwszy kontakt w, powtórz przypomnienie po, eskaluj do managera po (min), liczba przypomnień opiekuna, follow-up po ofercie (dni, np. „1, 3, 7”). Liczby — co najmniej 1 (jak w CRM); zakresy sprawdza baza.

Serwer: `src/lib/native/inquiryCreate.ts` i `/bridge/native/v1/inquiries` (`GET op=newSetup|specialDays|slaSettings`, `POST op=create|slaSave`) — tokenem pracownika; zapis zapytania i ustawień rozstrzyga RLS jak w przeglądarce (SLA — `is_inquiry_admin()`), nietypowe dni — ta sama funkcja co w kreatorze wydarzenia. Bez migracji. Kod: `Inquiries/NewInquiryForm.swift` (nowe zapytanie), `Inquiries/InquiryCreateSheets.swift` (SLA); wejścia — `Inquiries/InquiriesView.swift`, `NativeCalendarView.swift`, `CalendarCreate.swift`.

**Aktualizacja — Nowe zapytanie: klient z osobą kontaktową, prowadzenie i zapis bez blokady.** Audyt okna wykazał: zapis odmawiał („Zapis wymaga połączenia z serwerem CRM.”), gdy w tle trwało zwykłe odświeżanie danych (co minutę i po powrocie do aplikacji); lista klientów obejmowała tylko pierwsze 200 kontaktów (w bazie jest więcej — część osób nie dawała się znaleźć); organizację i osobę można było wybrać tylko osobno (wybór organizacji nie podpowiadał jej osób), a organizacja z wpisanym telefonem lub e-mailem tworzyła w bazie kontakt o nazwie organizacji; nowe zapytanie zawsze trafiało do „Nowe” bez opiekuna, także po odbytej rozmowie (przypomnienia SLA o pierwszym kontakcie). Teraz:
1. **Zapis** czeka na koniec odświeżania w tle (do 20 s) i od razu sprawdza niepotwierdzone połączenie (`Workspace.prepareWrite`) — także w formularzach Kontaktów (nowa osoba, organizacja).
2. **Klient** — wyszukiwanie w pełnej liście (kopia Kontaktów na Macu; bez dostępu do Kontaktów — pełna lista z serwera): każde słowo w nazwie, e-mailu, stanowisku, mieście i nazwach powiązanych organizacji, telefon także wpisany ze spacjami i bez kierunkowego, bez polskich znaków („lodz”). Po wyborze **organizacji** — jej osoby (główny kontakt i osoby decyzyjne najpierw, filtr przy wielu osobach) z wyborem jednym kliknięciem, „Dodaj osobę do …”, „Bez osoby kontaktowej”; po wyborze **osoby** — jej organizacja (jedna albo główna od razu, kilka — „Pracuje w” z wyborem). Telefon i e-mail z wybranej osoby (wpisane ręcznie zostają), „Zmień klienta”. Zapis: osoba w `client_text`, organizacja w `client_company`, oba identyfikatory.
3. **Dodaj klienta** — formularze Kontaktów w oknie (organizacja, osoba kontaktowa, osoba prywatna) wypełnione z wpisanej frazy, telefonu i e-maila; nowy rekord jest od razu wybrany (duplikat — „Użyj istniejącego kontaktu”).
4. **Podpowiedzi** — rozpoznanie kontaktu po wpisanym telefonie lub e-mailu („Wybierz”), ostrzeżenie, że organizacja bez osoby z telefonem/e-mailem utworzy kontakt o nazwie organizacji, otwarte zapytania tego klienta z lejka (osoba, organizacja, e-mail, telefon) z „Otwórz”, podgląd wartości szacunkowej z budżetu.
5. **Prowadzenie** — opiekun od razu: „Ja” (osoba dodająca, gdy prowadzi zapytania — zob. „Opiekun nowego zapytania”), osoba z listy „Osoba odpowiedzialna” (przydział); „Rozmowa z klientem już się odbyła” (domyślnie przy źródle Telefon i Rozmowa / spotkanie) — etap „Kontakt podjęty” z datą kontaktu, bez przypomnienia o pierwszym kontakcie; „Następne działanie” z przyciskami Za 2 godz., Jutro 10:00, Za 3 dni, Za tydzień (bez terminu — automatycznie jak dotąd). Po zapisie komunikat z opiekunem (także z przydziału automatycznego), lejek przełącza zakres na ten z nowym zapytaniem; opcja „Po zapisie otwórz kartę zapytania”.

Serwer: `newSetup` zwraca pełne listy stronami (organizacje z e-mailem, telefonem i miastem, osoby ze stanowiskiem, obecne powiązania), `create` przyjmuje `clientCompany`, `ownerId` (siebie — przejmowanie lub przydział, inną osobę — przydział w zakresie zespołu), `contacted` i `nextActionAt`, zwraca opiekuna po zapisie. Starszy serwer — okno wykonuje „Przejmij” i „Kontakt wykonany” osobno albo informuje, co dokończyć w lejku. Bez migracji. Wymaga wdrożenia CRM.

## Aktualizacja — Finanse: wystawianie faktur natywnie

Faktury wystawia się w aplikacji — formularz w arkuszu odpowiada `/crm/invoices/new` (kolejność pól, teksty, podpowiedzi i reguły jak w CRM), bez przechodzenia do przeglądarki.

1. **Skąd**: Finanse → Faktury, przycisk „Wystaw fakturę” (Faktura VAT, Proforma, Faktura zaliczkowa, Faktura korygująca); karta faktury → „Więcej” — **Faktura korygująca** (faktura VAT, zaliczkowa i końcowa w stanie wystawiona / wysłana / opłacona / po terminie) i **Kolejna faktura zaliczkowa** (do wystawionej faktury zaliczkowej); karta wydarzenia → Rozliczenie → „Wystaw fakturę” (faktura dla wydarzenia). Faktura końcowa — osobne okno (zob. „Faktura końcowa”). Po wystawieniu otwiera się karta nowej faktury w Finansach → Faktury.
2. **Formularz**: faktura dla osoby prywatnej (wyszukiwanie osób prywatnych, imię, nazwisko, adres); firma wystawiająca (tylko działalności z poziomem co najmniej „Wystawianie faktur”, domyślna; przy wydarzeniu — działalność wydarzenia z komunikatem, gdy jest nieaktywna lub bez uprawnień, i informacją o zmianie firmy wydarzenia po wystawieniu); typ i numer (następny numer z serii działalności, „Wygeneruj następny numer”, własny numer z kontrolą, czy nie jest już użyty w tej działalności); **rozliczenie wydarzenia** („Kto opłaca wydarzenie?” — klient, hotel, agencja, inna organizacja; klient rozliczany na JST, np. szkoła → gmina); **faktura wspólna** grupy rozliczeń z listą wydarzeń; nabywca (wyszukiwanie po nazwie, NIP, mieście; „Dodaj nowego nabywcę” — formularz nowej organizacji z „GUS / rejestry”, po zapisie od razu wybrany; podpowiedź „Ustaw … jako nabywcę”, gdy organizacja ma na karcie nabywcę faktur); **odbiorca na fakturze i w KSeF** (ten sam co nabywca albo osobny: z organizacji CRM lub ręcznie, rola 2 — oddział / jednostka wewnętrzna z IDWew, rola 8 — jednostka podrzędna JST z własnym NIP-em; „Pobierz aktualne dane z CRM”) i podgląd stron „Nabywca / Odbiorca na fakturze i w KSeF”; potwierdzenie, gdy nabywca różni się od zapisanego w rozliczeniu wydarzenia; powiązane wydarzenie nabywcy; daty, sposób płatności, „Faktura opłacona” z datą, termin w dniach z datą płatności; adnotacje (domyślna nota działalności); procent pro formy i zaliczki.
3. **Pozycje**: podstawa pozycji i kwot z wydarzenia — zaakceptowana kalkulacja albo oferta po rabatach (z podsumowaniem netto / brutto przy każdej opcji, źródło finansowe wydarzenia domyślnie, ostrzeżenie przy innym źródle) albo pozycje ręczne; nazwa, j.m., ilość, cena netto i brutto (zmiana brutto przelicza netto, zmiana stawki zachowuje brutto), stawki VAT jak w CRM (0% i „np.” trzeba doprecyzować, „zw.” z podstawą prawną zwolnienia); **własna pozycja zbiorcza** (jedna nazwa na fakturze, kontrola różnych stawek i różnic VAT z zaokrągleń); podsumowanie z pełną wartością zamówienia i kwotą pro formy / zaliczki. Kwoty liczone jak w przeglądarce (zaokrąglenia `toFixed` i `Math.round`).
4. **Kolejna zaliczka**: zamówienie, nabywca, odbiorca, waluta i firma z poprzedniej zaliczki, wcześniejsze zaliczki i szkice oraz pozostała kwota; serwer przelicza saldo ponownie przy zapisie i odrzuca fakturę, jeśli zamówienie zmieniło się w międzyczasie albo kwota przekracza pozostałą wartość.
5. **Korekta**: wybór faktury do korekty (albo z karty), numer i data faktury pierwotnej, numer KSeF; **korekta kwot** (zakres całość / część, skutek w ewidencji VAT 1–3, przyczyna; pozycje „Przed korektą” z faktury pierwotnej, „Po korekcie” do edycji, „Skoryguj pozycję do zera”, różnica i podsumowanie przed / korekta / po) albo **korekta danych nabywcy / odbiorcy** bez zmiany kwot (organizacja z tym samym NIP-em albo dane ręczne, NIP bez zmiany podatnika, porównanie przed / po z potwierdzeniem, kwoty bez zmian).

Serwer sprawdza formularz tak jak przeglądarka (te same komunikaty) i sam ustala z bazy dane, których nie wolno brać z formularza: firmę korekty i kolejnej zaliczki, wydarzenie, grupę rozliczeń, odbiorcę usługi, wartości „przed korektą”, saldo zamówienia i dane sprzedawcy; zapis — ta sama funkcja bazy co w CRM (`create_invoice_atomic`: uprawnienie do działalności, numer rezerwowany atomowo, autor faktury), potem przypisanie do wydarzeń grupy rozliczeń (`link_invoice_to_event_settlement`). Organizacja i kontakt — faktura z karty kontaktu, odnośniki z Rozliczenia wydarzenia i z Centrum finansów otwierają kartę faktury w Finansach.

### Karta faktury: PDF, e-mail, KSeF i UPO

Na karcie faktury (Finanse → Faktury) czynności z karty CRM działają w aplikacji:

1. **Podgląd PDF** — zapisany PDF faktury (ten sam plik co w dokumentach), a gdy go jeszcze nie ma — wydruk z bieżących danych; podgląd z drukowaniem i zapisem. **Generuj PDF / Regeneruj PDF** — wydruk z aktualnych danych faktury zapisany w plikach (faktura wydarzenia — folder „Faktury” w dokumentach wydarzenia, widoczny według poziomu finansów), poprzedni plik jest zastępowany; nieczytelne dane odbiorcy zapisane na fakturze blokują zapis (komunikat jak w CRM, także w danych karty). „Więcej” → **Pobierz PDF** (do Pobranych).
2. **Wyślij email / Wyślij email ponownie** — okno jak „Wyślij fakturę przez email” w CRM: skrzynka pracownika, adresaci z organizacji nabywcy (płatnik wydarzenia oznaczony „opiekun”, ogólny adres organizacji, adres z faktury), DW / UDW, temat „Faktura …” i treść, podgląd ze stopką i szablonem firmy faktury, PDF w załączniku (bez zapisanego PDF — wygenerowany i zapisany, jak w CRM; gdy się nie da — wysyłka bez załącznika z ostrzeżeniem), wysyłka teraz albo zaplanowana. Licznik „Wysłano e-mail: N×” w danych karty (w tej sesji, jak w CRM).
3. **Wyślij do KSeF / Wyślij ponownie do KSeF** (poziom „Wystawianie faktur” działalności; nie pro forma, nie anulowana, nie osoba prywatna, bez wysyłki w toku ani numeru KSeF) — potwierdzenie „Tej operacji nie można cofnąć”, potem okno postępu jak w CRM: walidacja, XML FA(3), autoryzacja, sesja szyfrowana, wysyłka, oczekiwanie na numer (próby), zapis wyniku, czas; numer referencyjny KSeF albo szczegóły błędu. Okno zamyka się dopiero po wyniku. Po przyjęciu — świeża karta i PDF z numerem i kodem KSeF (jak w CRM).
4. **Pobierz UPO (XML)** — dla faktury przyjętej przez KSeF: zapisane UPO albo pobrane teraz z KSeF, plik w Pobranych.
5. Pro forma: „Pro forma nie jest wysyłana do KSeF.” i „Zobacz wystawioną fakturę” po przekształceniu.
6. **Faktura z pro formy…** (menu „Więcej” pro formy nieanulowanej i nieprzekształconej) — okno jak „Wystaw fakturę na podstawie proformy” w CRM: pozycje i kwoty z pro formy bez zmian; **Faktura VAT** (powstaje jako szkic, termin płatności w dniach z datą) albo **Faktura zaliczkowa** na 100% pro formy (wpłata zapisana przy pro formie z jej datą albo potwierdzenie „Potwierdzam otrzymanie całej kwoty tej pro formy” z rzeczywistą datą wpłaty — nie późniejszą niż dzisiaj i niż data wystawienia; zaliczka powstaje jako wystawiona i opłacona, pro forma — opłacona); numer automatyczny (podgląd następnego, odświeżenie) albo własny; daty wystawienia i sprzedaży; poprawione dane nabywcy; odbiorca KSeF z pro formy (do poprawy, z kontrolą IDWew i NIP nabywcy). Potem podgląd: podsumowanie, sprzedawca, nabywca, odbiorca, pozycje i kwoty, „Wróć do edycji” albo „Wystaw fakturę” — otwiera się karta nowej faktury. Zapis — funkcja bazy `convert_proforma_with_payment_atomic` (jak w CRM: uprawnienie, jedna faktura na pro formę, zachowanie sprzedawcy, płatnika, wydarzenia i waluty, przeniesienie przypisań do wydarzeń, historia).

7. **Edytuj…** (menu „Więcej”) — edytor jak `/crm/invoices/[id]/edit` dla szkicu i pro formy: status dokumentu, stan KSeF, firma wystawiająca (zmiana ustawia miejsce wystawienia i stronę www firmy), typ i numer, korekta (faktura źródłowa z danymi i numerem KSeF, zakres, skutek w ewidencji VAT, przyczyna, nota korekty), osoba prywatna (wyszukiwanie, dane z e-mailem i telefonem) albo organizacja (wyszukiwanie, „Dodaj nowego nabywcę”), rozliczenie wydarzenia i powiązane wydarzenie, daty i termin płatności, nota płatnicza, metoda płatności i miejsce wystawienia, status płatności (do zapłaty / częściowo / zapłacono z datą i kwotą), procent zaliczki, pozycje (przed korektą — wartości „przed”) i podsumowanie. Faktura końcowa, dokument wystawiony albo w toku / po przyjęciu w KSeF — „Dokument jest chroniony przed edycją” z przejściem „Wystaw korektę”. Zapis — funkcja bazy `update_invoice_draft_atomic` (uprawnienia, blokada wystawionych dokumentów), potem przypisanie do wydarzeń grupy rozliczeń.

Serwer: `GET /bridge/native/v1/finance?op=invoicePdfFile|proformaSetup|proformaNumber|invoiceEdit|invoiceEditEvents`, `POST op=invoicePdf|invoiceUpo|proformaConvert|invoiceEdit` (pro forma — `src/lib/native/financeProforma.ts`, edycja — `src/lib/native/financeInvoiceEdit.ts`), okno e-mail — `op=reminder|reminderPreview|reminderSend` z `mode=invoice` (`src/lib/native/finance.ts`); zapis PDF — wspólny moduł `src/lib/invoices/print/storeInvoicePdf.server.ts` (ten sam co trasa CRM `/bridge/invoices/invoice-pdf`); wysyłka do KSeF — trasa CRM `/bridge/ksef/invoices/send`, która przyjmuje teraz także token aplikacji (`requestSupabaseClient`, te same uprawnienia konta). Kod: `Finance/FinanceInvoicesView.swift` (karta), `Finance/InvoiceKsefSendSheet.swift`, `Finance/FinanceReminderSheet.swift` (tryby monitu i faktury), `Finance/FinanceBankStore.swift`, `Finance/ProformaConvertSheet.swift` (odbiorca — wspólny `InvoiceRecipientEditorView`), `Finance/InvoiceEditSheet.swift`.

### Faktura końcowa

Okno jak „Wystaw fakturę końcową (rozliczenie zaliczek)” w CRM (`FinalInvoiceWizardModal`) — faktura na całe zamówienie, pomniejszona o zaliczki:

1. **Skąd**: Finanse → Faktury → „Wystaw fakturę” → **Faktura końcowa…** (bez kontekstu: „Według eventu” albo „Według podmiotu”, wyszukiwanie 50 wyników); karta wystawionej faktury zaliczkowej → „Więcej” → **Faktura końcowa…** (zaliczki tego samego zamówienia — także zaliczki kolejne i pro forma źródłowa, ten sam nabywca, sprzedawca, waluta, płatnik i odbiorca; firma zaliczki); karta wydarzenia → Rozliczenie → **Wystaw fakturę końcową** (gdy wydarzenie ma fakturę zaliczkową; zaliczki przypisane do wydarzenia i jego grupy rozliczeń). Przy kontekście z góry wszystkie nierozliczone zaliczki są zaznaczone; wybór można zmienić.
2. **Zaliczki do rozliczenia**: wystawione / wysłane / opłacone / po terminie, jeszcze nierozliczone i o dodatniej kwocie — numer (z uwagą „Wpłata zostanie zweryfikowana przy wystawieniu”, gdy nie jest w pełni opłacona), status, data, brutto.
3. **Pełna wartość zamówienia**: z powiązanego wydarzenia (zaakceptowana kalkulacja albo oferta po rabatach; we wspólnym rozliczeniu — wszystkie wydarzenia grupy, z kontrolą płatnika, waluty, firmy i zgodności kwot z podsumowaniem źródła) albo z zamówienia zapisanego przy zaliczkach; błędy źródła, różna waluta lub firma zaliczek i wydarzenia blokują wystawienie (komunikaty jak w CRM). **Pozycje**: nazwy, jednostki i układ odziedziczone z zaliczki z kwotami pełnego zamówienia (gdy podział VAT na to pozwala) albo — jawnie — pozycje pełnego zamówienia / wydarzenia; edycja (nazwa, j.m., ilość, cena netto, stawka, brutto przeliczające netto, dodawanie i usuwanie), „Przywróć pozycje…” i zmiana podstawy z potwierdzeniem, gdy wpisano zmiany.
4. **Podsumowanie**: pełna wartość zamówienia, wybrane zaliczki, pozostało do zapłaty (netto / VAT / brutto) z informacją o dopłacie albo przekroczeniu; firma wystawiająca (przy zaliczce z karty — firma zaliczki); numer „Auto” (przewidywany, „(zajęte)”) albo własny; daty wystawienia i sprzedaży, termin płatności w dniach z datą; nabywca z zaliczek i odbiorca na fakturze i w KSeF (z zaliczki, do poprawy — wspólny edytor odbiorcy).
5. **Podgląd faktury końcowej**: numer, sprzedawca, nabywca, daty, pozycje z wartościami netto / VAT / brutto i stawkami (zw., np., odwrotne obciążenie), rozliczenie zaliczek (odliczenie każdej zaliczki, razem, pozostało do zapłaty) — te same wyliczenia co przy zapisie.

Serwer (`src/lib/native/financeFinalInvoice.ts`) ponownie wczytuje zaliczki kontekstu i sprawdza, że wybrane są wśród nich, odtwarza zamówienie wydarzenia, sprawdza formularz jak okno CRM i `createFinalInvoice` (te same komunikaty), liczy kwoty wspólnym `calculateFinalInvoice`, wystawcę bierze z konta pracownika, zapisuje funkcją bazy `create_paid_final_invoice_atomic` (uprawnienie do działalności, numer, zgodność zaliczek, kwota rozliczenia), potem przypisuje fakturę do wydarzeń grupy rozliczeń (`link_invoice_to_event_settlement`, ostrzeżenie jak w CRM, gdy się nie uda). Po wystawieniu otwiera się karta nowej faktury. `GET /bridge/native/v1/finance?op=finalSetup|finalSearch|finalCandidates|finalItems|finalNumber`, `POST op=finalCreate`. Kod: `Finance/FinalInvoiceSheet.swift`; wejścia — `FinanceInvoicesView.swift`, `Events/EventFinancesTab.swift`.

**Zostaje w CRM** (kolejny etap): konfiguracja KSeF.

Serwer: `src/lib/native/financeInvoiceForm.ts` i `/bridge/native/v1/finance` (`GET op=invoiceForm|invoiceEvent|invoiceOrgEvents|invoiceBuyerLink|invoiceRecipientOrgs|invoiceRecipientOrg|invoiceOriginal|invoiceNumber|invoiceNumberCheck`, `POST op=invoiceCreate`) — tokenem pracownika, RLS i funkcje bazy jak w przeglądarce; bez migracji. Kod: `Finance/InvoiceFormSheet.swift`, `InvoiceFormModel.swift`, `InvoiceFormParts.swift`, `InvoiceFormModels.swift`; wejścia — `FinanceInvoicesView.swift`, `Events/EventFinancesTab.swift`, `Contacts/ContactCardView.swift`; „Dodaj nowego nabywcę” — `Contacts/OrganizationEditorSheet.swift` (`onCreated`).

## Aktualizacja — Marketing: Social media natywnie

Marketing → **Social media** (`/crm/marketing/social`) — ten sam zakres, te same dane i uprawnienia co CRM: podgląd, tworzenie szkiców, akceptacja i publikacja (`marketing_social_view` / `_create` / `_approve` / `_publish`, marki z „Moich firm” pracownika; administrator — wszystko). Statusy, zgody klienta i powiadomienia pilnuje baza, więc Mac nie może zrobić więcej niż przeglądarka.

1. **Kalendarz** miesiąca: posty z miniaturą, statusem i kanałami; przeciągnięcie posta na inny dzień zmienia termin (godzina zostaje), dwuklik w dzień — nowy post na ten dzień; obok listy „Szkice bez terminu” i „Czeka na akceptację i poprawę”. Zakładka **Do akceptacji** — siatka postów czekających na decyzję.
2. **Biblioteka** zdjęć marki: dodawanie z dysku (przeciągnij z Findera albo „Wgraj z dysku”; HEIC i duże pliki Mac zapisuje jako JPEG), „Z plików wydarzenia” i „Z realizacji” (portfolio); propozycje członków zespołu („Przyjmij do biblioteki”); zgoda klienta na publikację — na zdjęciu, na wydarzeniu albo dla klienta (kanały, notatka); filtry: wydarzenie, zgoda, użycie, archiwum. Kadry 4:5, 1:1, 9:16 i 1,91:1 proponuje serwer z analizy zdjęcia.
3. **Kreator posta** na całą szerokość okna (w szerokim oknie trzy kolumny, w węższym podglądy pod grafiką): zdjęcie i wydarzenie, kanały (Instagram — post, Instagram — relacja, Facebook), formaty z natywnym **edytorem kadru** (przeciąganie, powiększanie gestem na gładziku i przyciskami, linie bezpiecznego pola szablonu), tytuł i podpis grafiki (wersaliki MBF Atom z szablonu marki), opis i hashtagi z licznikami limitów, termin oraz **asystent AI** (`SocialAssistantView.swift`): „Napisz” — 3 wersje opisu z hashtagami, tytułem i podpisem grafiki (temat, cel, ton, długość, opcjonalnie zdjęcie ze zgodą klienta), „Popraw opis” — Krócej, Bardziej elegancko, Dodaj zaproszenie do kontaktu, Jak krótka historia, Popraw język, Po angielsku albo własne polecenie, „Hashtagi” — propozycje w grupach (Marka, Branża, Lokalne, Temat posta) do zaznaczania z licznikiem (zalecane 3–12); asystent bierze niezapisane wartości z kreatora (`POST /social` `op=assist`), a wynik nie zmienia posta, dopóki nie wybierzesz propozycji („Użyj opisu i hashtagów” albo „Użyj z tytułem na grafice”). Wyłączonego asystenta osoba akceptująca włącza z kreatora („Włącz asystenta AI”, zgoda zapisana z nazwiskiem i datą), pozostali widzą informację. Podglądy: feed Instagram, siatka profilu, relacja i post Facebook — z gotowych grafik, a przy niezapisanych zmianach (albo grafice nieaktualnej) **na żywo**: zdjęcie w bieżącym kadrze przesuwa się razem z kadrem, a na nim leży warstwa szablonu (przyciemnienia, logo, tytuł, kreska, podpis) wygenerowana przez serwer tym samym HTML i Chromium co grafika (`POST /social` `op=overlay`, przezroczysty PNG). Kadr zmienia podgląd od razu; nowy tytuł, podpis albo szablon — po chwili (nowa warstwa). Po zapisie serwer generuje taki sam plik.
4. **Grafiki** generuje serwer CRM (Chromium) z szablonu marki: logo, kolory i fonty wyłącznie z księgi znaku. Ten sam plik JPEG widzą CRM, Mac i telefon — Mac nie generuje grafik, więc wynik jest identyczny 1:1 (podgląd na żywo nakłada tylko zdjęcie w kadrze pod warstwę szablonu z serwera). Po zmianie kadru lub tekstu grafika odświeża się przy zapisie.
   **Style grafik** (karta „Styl grafiki” w kreatorze, `SocialGraphicStyle`): Klasyczny (dotychczasowy układ), Rama (cienka ramka w kolorze akcentu i miękki cień przy krawędziach), Passe-partout (zdjęcie w passe-partout w kolorze marki z linią akcentu, tytuł i podpis na pasie pod zdjęciem), Kino (kinowe pasy: logo na górnym, teksty na dolnym), Winieta (ciemna winieta wokół kadru) i Okładka (logo w rogu, duży tytuł do lewej). Miniatury pokazują wszystkie style z bieżącym zdjęciem, kadrem i tekstami — każda to zdjęcie w kadrze i warstwa stylu z serwera (`op=overlay` ze `style` i `kicker`), więc wygląda jak grafika po zapisie; gwiazdka — domyślny styl marki (ustawiany w „Szablony i AI”, nowe posty dostają go automatycznie). **Napis nad tytułem** (np. „Realizacja”, „Za kulisami”; podpowiedzi do kliknięcia) w kolorze akcentu. W edytorze kadru przy passe-partout i kinie część zdjęcia poza jasnym polem jest przyciemniona (zasłaniają ją passe-partout albo pasy). Styl i napis są wspólne dla formatów posta; ich zmiana to zmiana treści (zatwierdzony post wraca do szkicu). Kolory, fonty i logo zawsze z księgi znaku.
5. **Akceptacja**: „Wyślij do akceptacji”, „Zatwierdź”, „Do poprawy” (z uwagą), „Przywróć do szkicu”, „Anuluj post”, „Oznacz jako opublikowany” (z linkiem do posta); zmiana treści po zatwierdzeniu cofa post do szkicu. „Pobierz paczkę” — ZIP z grafikami i opisem; „Kopiuj opis”; „Historia”; „Kopia posta”, „Usuń post”.
6. **Dane lokalnie**: kalendarz i otwarte posty w zaszyfrowanej kopii na dysku (otwierają się od razu, odświeżane w tle), miniatury i grafiki w pamięci podręcznej `~/Library/Caches/Mavinci/social`. Powiadomienia („Post do akceptacji”, „Post zatwierdzony”, „Post do poprawy”; od Etapu 2 także „Publikacja posta nie powiodła się” i „Nowe komentarze”) otwierają kartę posta w aplikacji; nikt nie dostaje powiadomienia o własnej akcji.

Serwer: `GET/POST /bridge/native/v1/social` (`src/lib/social/*.server.ts`; zdjęcia z Maca wysyłane przez `POST ?op=upload&id=`). Publikacja przez Meta Graph API — „Aktualizacja — Social media: publikacja w Meta i komentarze” poniżej; statystyki — kolejny etap.

## Aktualizacja — Social media: statystyki i raport tygodniowy „Trendy i rekomendacje”

Etap 3 social media — ten sam zakres co CRM (`/crm/marketing/social?tab=stats`) i telefon. Wyniki pobiera wyłącznie serwer CRM z Meta (token strony zapisany zaszyfrowany w integracji Meta marki); metryki zgodne z aktualnym Graph API (wycofane „impressions” nie są używane).

1. **Zakładka „Statystyki”** (każdy z dostępem do social media marki): zakres 7 / 28 / 90 dni, kafelki — opublikowane posty, wyświetlenia, zasięg, interakcje, zapisania, wejścia na profil — ze zmianą wobec poprzedniego okresu (wyniki postów opublikowanych w okresie, stan na dziś), przyrost dzienny (wyświetlenia albo interakcje, z dziennych zrzutów), tabela kanałów ze wskaźnikiem zaangażowania (interakcje / zasięg), najlepsze posty okresu (kliknięcie otwiera post) i **najlepsze pory publikacji** z własnych wyników z 6 miesięcy (trzy najlepsze pory i mapa dzień × pora; najmniej 5 postów z wynikami i 2 posty w porze). Ostrzeżenie, gdy Meta nie jest połączona albo brakuje uprawnień do statystyk (`read_insights`, `instagram_manage_insights`) — wtedy Facebook podaje tylko reakcje, komentarze i udostępnienia, Instagram — polubienia i komentarze. „Odśwież z Meta” pobiera wyniki publikacji z 90 dni (harmonogram robi to sam: relacje co godzinę przez 24 h, posty co 3–24 h do 90 dni). Kopia ostatnich statystyk zapisuje się na dysku (zaszyfrowana) — zakładka otwiera się od razu.
2. **Raport tygodniowy „Trendy i rekomendacje”** — przygotowuje się sam w poniedziałek rano za poprzedni tydzień (marki publikujące w ostatnich 5 tygodniach); „Raport za poprzedni tydzień” (twórca treści) przygotowuje go od razu. W raporcie: podsumowanie, wyniki tygodnia wobec poprzedniego, trendy, rekomendacje z priorytetem, ryzyka, szanse, najlepsze posty tygodnia, najlepsze pory, komentarze i zaplanowane posty. Lista „Tydzień” przełącza wcześniejsze raporty (12 ostatnich). Analiza AI tylko po zgodzie akceptującego w „Szablony i AI” („Analiza AI w raporcie tygodniowym”) — do AI trafiają wyłącznie zagregowane wyniki; bez zgody raport zawiera liczby i wnioski z danych. Powiadomienie „Raport tygodniowy social media” (osoby z dostępem do social media marki, bez osoby, która przygotowała raport ręcznie) otwiera zakładkę z tym raportem.
3. **Wyniki posta** w karcie „Publikacja w Meta” kreatora — przy każdym opublikowanym kanale metryki z Meta, wskaźnik zaangażowania, czas pobrania i powód braku wyników (np. za mało odbiorców relacji); „Wyniki” pobiera je od razu.
4. **Zdjęcie z Maca w kreatorze posta** — okno „Zdjęcie — …” ma „Wgraj z dysku”, import z plików wydarzenia i z realizacji oraz przyjmuje zdjęcia przeciągnięte z Findera; zdjęcie trafia do biblioteki marki, a gdy jest jedno — od razu do posta (także zdjęcie, które już było w bibliotece).

Serwer: `GET /bridge/native/v1/social?op=stats&company&days&report`, `POST op=metricsRefresh {postId | companyId, days, report}`, `op=reportGenerate {companyId, weekStart?, days}`; harmonogram: `/bridge/social/worker` (`metrics`, `report`). Migracja: `supabase/migrations/20261119230000_social_media_insights.sql`.

## Aktualizacja — Social media: publikacja w Meta i komentarze

Etap 2 social media — ten sam zakres co CRM (`/crm/marketing/social`) i telefon; publikację wykonuje wyłącznie serwer CRM tokenem strony zapisanym zaszyfrowanym w integracji Meta marki (Mac nie widzi tokenów).

1. **Publikacja w Meta** (osoba z uprawnieniem „Publikacja”, zatwierdzona wersja posta): „Opublikuj teraz” (wynik od razu: link do posta albo błąd), „Zaplanuj publikację” (termin w arkuszu z kalendarzem; serwer publikuje sam w terminie), „Zmień termin publikacji”, „Wstrzymaj publikację” (post wraca do zatwierdzonych), „Ponów publikację” po błędzie — kanały już opublikowane są pomijane, nic nie trafia do Meta dwa razy. Kanały: Facebook — post ze zdjęciem i opisem, Instagram — post (opis z hashtagami) i relacja. „Oznacz jako opublikowany…” (menu „Więcej”) zostaje do publikacji ręcznej.
2. **Karta „Publikacja w Meta”** w kreatorze: termin i osoba planująca, „Trwa publikacja…” (karta odświeża się co 5 s), błąd publikacji, wynik każdego kanału (link „Otwórz” albo błąd) i braki konta (strona, Instagram, uprawnienia Meta). Zmiana treści zaplanowanego posta cofa go do szkicu; po opublikowaniu części kanałów treści nie można zmienić (kopia posta).
3. **Pasek „Publikacja w Meta”** nad kalendarzem: strona Facebook, konto Instagram, gotowość kanałów, brakujące uprawnienia i „Ustawienia Meta” (strona ustawień marketingu marki w CRM — połączenie i „Odśwież dostęp”). Lista „Wymaga uwagi” i zakładka „Do akceptacji” pokazują też posty z błędem publikacji; zaplanowany post przenosi w kalendarzu tylko osoba z uprawnieniem „Publikacja”.
4. **Komentarze** — nowa zakładka (skrzynka marki: „Bez odpowiedzi” / „Wszystkie”, wątki z miniaturą posta) i sekcja w kreatorze opublikowanego posta: komentarze Facebook i Instagram z odpowiedziami, „Odpowiedz” (odpowiedź publikuje się jako strona / profil marki; twórca treści), link do posta, „Odśwież” (pobranie z Meta; serwer odświeża też co 15 minut i po webhooku). Powiadomienie „Nowe komentarze” otwiera post na komentarzach.
5. **Siatka profilu** w podglądzie: zaplanowane posty z CRM i ostatnie prawdziwe posty z profilu Instagram.

Serwer: `POST /bridge/native/v1/social` `op=publishNow | schedulePublication | commentsRefresh | reply`, `GET op=comments`; harmonogram: `/bridge/social/worker` (pg_cron). Migracja: `supabase/migrations/20261119220000_social_media_publishing.sql`.

## Aktualizacja — Social media: karuzele i „Utwórz post” z realizacji

Ten sam zakres co CRM i telefon (`/crm/marketing/social`, Marketing → Realizacje).

1. **Karuzela w kreatorze posta** (formaty feedu 4:5, 1:1 i 1,91:1): pasek miniatur pod formatami — okładka (grafika z tytułem) i do 9 kolejnych zdjęć z biblioteki marki („Dodaj zdjęcia” — okno biblioteki zostaje otwarte, żeby dodać kilka zdjęć po kolei). Kliknięcie miniatury otwiera natywny edytor kadru tego zdjęcia w aktywnym formacie (przybliżanie, propozycja, kolejność strzałkami, inne zdjęcie, usunięcie); kolejność także przeciąganiem miniatur. Kolejne zdjęcia mają ten sam szablon i styl co okładka, bez tytułu, podpisu i napisu — podgląd na żywo to zdjęcie w kadrze z warstwą stylu z serwera (bez tekstów), po zapisie serwer generuje taki sam plik (`slide-<n>-<format>-<skrót>.jpg`). Relacja (9:16) — zawsze tylko okładka.
2. **Podglądy**: feed Instagram jako karuzela (strzałki, licznik, kropki), Facebook — pierwsze zdjęcie duże, pod nim do trzech mniejszych („+N”). Zgoda klienta obejmuje także zdjęcia karuzeli; paczka do ręcznej publikacji zawiera wszystkie zdjęcia z numerami.
3. **Publikacja w Meta**: Instagram — karuzela (kontenery zdjęć i kontener karuzeli z opisem), Facebook — jeden post z kilkoma zdjęciami. Brak grafiki któregoś zdjęcia blokuje wysłanie niepełnej karuzeli (komunikat „zapisz post”).
4. **Realizacje → „Utwórz post”**: wybór zdjęć realizacji (pierwsze — okładka, najwyżej 10, kolejność jak w realizacji) i kanałów; zdjęcia trafiają do biblioteki social media marki (już obecne — bez kopii), powstaje szkic posta z tytułem realizacji, napisem „Realizacja”, opisem z krótkiego opisu (z linkiem, gdy realizacja jest na stronie) i hashtagami ze słów kluczowych — otwiera się w kreatorze Social media. Wymaga uprawnienia „Social media — tworzenie”.

Serwer: `POST /bridge/native/v1/social` `op=savePost` z `slides: [{assetId, crops?}]`, `op=createPost` z `slides`; `POST /bridge/native/v1/portfolio` `op=socialPost`. Migracja: `supabase/migrations/20261121120000_social_carousels.sql`. Kod: `Social/SocialPostEditorView.swift`, `Social/SocialModels.swift`, `Portfolio/PortfolioEditorView.swift`, `Portfolio/PortfolioStore.swift`.

## Aktualizacja — Social media: LinkedIn (strona firmowa marki)

Ten sam zakres co CRM i telefon (`/crm/marketing/social`). Nowy kanał **„LinkedIn — post”** obok Instagrama i Facebooka; publikację i komentarze wykonuje wyłącznie serwer CRM tokenem LinkedIn zapisanym zaszyfrowanym w integracji marketingu marki (Mac nie widzi tokenów). Konfiguracja aplikacji LinkedIn — później; do tego czasu post z kanałem LinkedIn publikuje się ręcznie („Więcej” → „Pobierz paczkę”, potem „Oznacz jako opublikowany”).

1. **Kanał w kreatorze**: „LinkedIn — post” na liście kanałów (grafika 1,91:1, 4:5 albo 1:1 — jak Facebook; karuzela trafia na LinkedIn jako post z kilkoma zdjęciami, opis z hashtagami do 3000 znaków). To samo w „Utwórz post” z realizacji i w zgodzie klienta (platforma „LinkedIn” przy zdjęciu i wydarzeniu).
2. **Podgląd LinkedIn** — nowa zakładka podglądów (zakładki zawijane jak w CRM): strona firmowa z logo, opis z „…więcej”, grafika albo kilka zdjęć („+N”), pasek akcji.
3. **Publikacja**: „Opublikuj teraz” / „Zaplanuj publikację” publikują także na LinkedIn, gdy strona marki jest połączona (zdjęcia wysyłane z serwera CRM, potem jeden post strony; przerwana wysyłka — przy kolejnej próbie serwer najpierw sprawdza ostatnie posty strony, bez podwójnej publikacji). Bez połączenia kanał ma stan „publikacja ręczna” (szare kółko, bez ostrzeżenia), a „Zaplanuj publikację” podpowiada ręczną publikację albo usunięcie kanału. Wyniki postów LinkedIn — osobny etap.
4. **Pasek „Publikacja”** nad kalendarzem: strona Facebook, Instagram i strona LinkedIn (albo „ręcznie”), gotowość kanałów, „Ustawienia kont” (ustawienia marketingu marki w CRM — „Połącz LinkedIn”, wybór strony, „Odśwież dostęp”).
5. **Komentarze** LinkedIn w skrzynce i w kreatorze (ikona strony, link „LinkedIn”), odpowiedź jako strona firmowa marki — gdy LinkedIn przyznał uprawnienia `r_organization_social` i `w_organization_social`.

Serwer: `src/lib/social/socialLinkedIn.server.ts` (Community Management API), integracja `linkedin` w `/bridge/marketing/oauth/linkedin/*` i `/bridge/marketing/integrations/linkedin`; zmienne serwera `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` (opcjonalnie `LINKEDIN_API_VERSION`). Migracja: `supabase/migrations/20261121140000_social_linkedin.sql`. Kod: `Social/SocialModels.swift`, `Social/SocialPostEditorView.swift`, `Social/SocialMediaView.swift`, `Social/SocialCommentsView.swift`, `Social/SocialStore.swift`.

## Aktualizacja — Social media: układy grafik jako dane, kolaże i edytor układów

Ten sam zakres co CRM i telefon (`/crm/marketing/social`). Układ grafiki to dane (definicja JSON: tło, miejsca na zdjęcia, przyciemnienia, prostokąty i ramki, logo, teksty — z położeniem w każdym formacie), a nie kod — ten sam układ renderuje serwer Next (ten sam HTML i Chromium co dotąd), pokazuje podgląd w CRM i warstwa podglądu na Macu. Kolory, fonty i logo nadal wyłącznie z księgi znaku przez szablon marki (układ wskazuje tylko role: przyciemnienie, akcent, tekst; font tytułu i podpisu).

1. **Układ grafiki** w kreatorze posta (nad stylem): „Styl grafiki” (jak dotąd — bez układu), układy marki i gotowe układy: kolaż 2 zdjęć obok siebie, 2 zdjęć jedno pod drugim, 3 zdjęć, 4 zdjęć (siatka) i zdjęcie z pasem tekstu. Miniatura to schemat z definicji (miejsca na zdjęcia z numerami, przyciemnienia, logo, linie tekstów) w kolorach szablonu marki. W relacji 9:16 gotowe układy trzymają logo i teksty poza strefami zasłanianymi przez Instagram.
2. **Kolaż**: pasek „Kolaż” nad edytorem kadru — zdjęcie 1 (zdjęcie formatu) i kolejne miejsca (puste — wybór z biblioteki marki). Natywny edytor kadru każdego zdjęcia w każdym formacie w proporcjach jego miejsca (przeciąganie, gest i przyciski powiększenia, propozycja, środek); „Inne zdjęcie”, „Usuń z kolażu”. Zmiana układu: kadry niepasujące do nowych proporcji wracają do propozycji.
3. **Podgląd na żywo**: zdjęcia w prostokątach miejsc i warstwa układu z serwera (tło z otworami na zdjęcia, przyciemnienia, logo, teksty) — wygląda jak grafika po zapisie; puste miejsce jest szare. Podglądy feed / siatka / relacja / Facebook / LinkedIn korzystają z tego samego źródła.
4. **Zatwierdzony wygląd się nie zmienia**: post zapisuje migawkę definicji układu — późniejsza edycja układu marki nie zmienia zapisanych postów. Slajdy karuzeli renderują się wybranym stylem (bez układu). Zgoda klienta obejmuje zdjęcia kolażu; kolaż bez zdjęcia w którymś miejscu blokuje wysłanie do akceptacji.

5. **Edytor układów grafik** (akceptujący w marce — jak szablony): przycisk „Układy grafik” w nagłówku Social media i „Edytuj układy” przy wyborze układu w kreatorze posta (kreator zostaje z niezapisanymi zmianami). Na całej szerokości okna: po lewej układy marki (także w archiwum, z liczbą postów) i gotowe układy jako punkt wyjścia („Pusty (jedno zdjęcie)” albo miniatura gotowego układu); pośrodku natywne płótno w proporcjach wybranego formatu — warstwa z serwera (ten sam HTML i Chromium co render: logo, fonty i kolory z szablonu marki) nad zdjęciami zastępczymi z numerami miejsc, czerwone strefy relacji zasłaniane przez Instagram, ramki elementów do przeciągania i narożnik do zmiany rozmiaru (siatka 0,5%), strzałki — przesunięcie o 0,5% (z Shift — 2%), Delete — usunięcie; przykładowe teksty do podglądu. Po prawej: nazwa, tło (rola koloru), „Dodaj element” (zdjęcie — kolejne miejsce kolażu, najwyżej 4; przyciemnienie; prostokąt / ramka; logo; tekst), lista elementów z kolejnością rysowania (przeciąganie wiersza albo strzałki) i usuwaniem, właściwości zaznaczonego elementu (położenie w % — wspólne albo „Osobne położenie w tym formacie”, numer zdjęcia i zaokrąglenie, rola koloru, kierunek i krycie przyciemnienia, wypełnienie i ramka, wyrównanie logo, treść / font / kolor / wyrównanie / wielkość / odstęp liter tekstu). Na pasku: „Zapisz układ” (⌘S), „Kopia” (nowy układ z bieżącego — oryginał bez zmian), „Do archiwum” / „Przywróć” i „Usuń” (tylko nieużywany). Błędny układ (np. zdjęcia nie po kolei) — komunikat i blokada zapisu. Lista układów w zaszyfrowanej kopii na dysku.
6. **Nowa wersja układu w poście**: gdy układ marki zmieniono po zapisaniu posta, kreator pokazuje „Układ … zmieniono po zapisaniu tego posta” z „Wczytaj nową wersję” (podgląd od razu, zapis posta = nowa wersja posta) albo „Zostaw dotychczasową”.

Serwer: `GET /bridge/native/v1/social?op=layouts&company=…&template=…`, `POST` `op=saveLayout` (`id?`, `companyId`, `name`, `definition`, `updatedAt` — ochrona przed nadpisaniem zmian z innego okna), `op=archiveLayout`, `op=deleteLayout`; `op=savePost` z `layout: {id}|{key}|null` (+ `refresh: true` — aktualna wersja tego samego układu) i `slots: [{slot, assetId, crops?}]`; `op=overlay` z `layout` (definicja); karta posta: `layout.outdated`. Migracja: `supabase/migrations/20261121160000_social_layouts.sql`. Kod: `Social/SocialLayoutEditorView.swift`, `Social/SocialLayoutViews.swift`, `Social/SocialPostEditorView.swift`, `Social/SocialMediaView.swift`, `Social/SocialModels.swift`, `Social/SocialStore.swift`.

## Aktualizacja — Social media: siatka profilu i panorama (jedna duża grafika pocięta na kafelki)

Jedna duża grafika (zdjęcie z napisami i logo z księgi znaku marki) pocięta przez serwer CRM na kafelki — ten sam zakres i te same uprawnienia co w CRM i w telefonie.

1. **Nowa siatka**: przycisk „Siatka / panorama” w nagłówku Social media (tworzenie postów) — szkic „Siatka profilu” z banerem z 3 kafelków; kształt i układ zmienisz w kreatorze. Zwykłego posta nie da się zamienić w siatkę (i odwrotnie).
2. **Kreator posta**: karta „Siatka profilu / panorama” zamiast „Układ grafiki” — kształt (siatka 3 / 6 / 9 kafelków, panorama 2–5 slajdów) i gotowe układy kształtu (zdjęcie przez wszystkie kafelki, zdjęcie z polem albo kolumną marki, pole marki w środku siatki 9; teksty z karty „Tekst na grafice”). Bez stylu grafiki i bez formatów — kafelki zawsze 1080 × 1350 px (4:5). Kanały: siatka — tylko feed Instagram (każdy kafelek to osobny post), panorama — karuzela na Instagramie, Facebooku i LinkedIn (bez relacji).
3. **Grafika**: natywny edytor kadru w proporcjach miejsca zdjęcia na całej grafice i pod nim cała grafika na żywo (zdjęcia pod warstwą z serwera — ten sam HTML i Chromium co render) z liniami cięcia: styki kafelków, przyciemnione pasy obcinane w siatce profilu (kafelki zachodzą na siebie o 33,75 px, więc w profilu linie łączą się bez przesunięć), numery kafelków i kolejność publikacji. Ostrzeżenie, gdy logo albo tekst wypada na styku kafelków. „Odśwież kafelki” — gdy pliki są nieaktualne (np. nowa księga znaku).
4. **Podglądy**: siatka — „Siatka profilu” (kafelki przycięte do 3:4 jak w profilu, potem dotychczasowe posty marki, także kafelki innych siatek) i „Feed Instagram” (kafelek 1); panorama — karuzela w feedzie Instagram, Facebook (kilka zdjęć) i LinkedIn.
5. **Publikacja**: siatka publikuje się jako osobne posty od ostatniego kafelka do pierwszego (żeby w profilu ułożyły się we właściwej kolejności); opis z hashtagami trafia do kafelka 1, pozostałe kafelki dostają same hashtagi. W karcie „Publikacja” — stan zbiorczy („2/3 kafelków”) i lista kafelków z linkami albo błędem. Panorama — jedna karuzela.
6. **Kalendarz i lista „Wymaga uwagi”**: przy poście rodzaj i liczba kafelków („Siatka · 6 kafelków”, „Panorama · 3 slajdy”).

Serwer: `op=createPost` z `layout: {key: "preset-grid-…"|"preset-pano-…"}`; karta posta: `canvas` (kształt), `tiles` (pliki kafelków z `upToDate`), `canvasLayouts` (gotowe układy dużej grafiki), `publications[].tile`; lista postów: `canvas`. Migracja: `supabase/migrations/20261121180000_social_canvas.sql` (po `20261121160000`). Kod: `Social/SocialPostEditorView.swift`, `Social/SocialLayoutViews.swift`, `Social/SocialModels.swift`, `Social/SocialMediaView.swift`, `Social/SocialStore.swift`.

## Aktualizacja — Prezentacje: oferta ze spotkania (klient mówi „chcę ofertę”)

W podglądzie prezentacji (pokaz jak na iPadzie) sprzedawca od razu przygotowuje ofertę — to samo w CRM (także na iPadzie w przeglądarce) i w aplikacji na telefonie / iPadzie. Ofertę z pokazu tworzy osoba z podglądem prezentacji, która prowadzi zapytania (uprawnienia do zapytań; administrator — wszystko); bez uprawnienia przyciski się nie pokazują.

1. **„Do oferty”** przy wariancie, przy pakiecie i w nagłówku karty (domyślny wybór jak w CRM: pierwszy pakiet, polecany wariant); dodana pozycja — „W ofercie”, komunikat z „Pokaż ofertę”. Produkty z konfiguratorem (scena, ekran LED) dodasz w edytorze oferty po jej utworzeniu.
2. **„Oferta · n”** w pasku pokazu otwiera panel obok pokazu (natywne pola, poza ramką iPada):
   - **Klient**: wyszukiwanie w CRM (firma, NIP, osoba, e-mail, telefon) albo „Nowy klient” (firma, NIP, osoba) — bez duplikatów: istniejąca firma (NIP, nazwa) i osoba (e-mail, telefon) zostają użyte zamiast nowych. Dla firmy — wybór osoby kontaktowej albo nowa osoba.
   - **Zapytanie**: otwarte zapytanie klienta, które prowadzisz (oferta trafia do niego jako kolejny wariant), albo nowe zapytanie — źródło „Rozmowa / spotkanie”, etap „Zakwalifikowane”, opiekun — Ty. Wydarzenie powstaje po akceptacji oferty, jak dziś w zapytaniach.
   - **Wydarzenie**: nazwa, termin (opcjonalnie godzina), miejsce, **liczba osób** (ceny „na osobę” i „na stół”).
   - **Pozycje**: kolejność przeciąganiem za uchwyt, ilość i dni, uzgodniona cena przy pakiecie „wycena indywidualna”, usunięcie; ceny z katalogu liczy serwer CRM (te same funkcje co kreator ofert).
   - **Rabat**: 0 / 5 / 10 / 15% albo własny; powyżej progu rabatu z CRM (domyślnie 10%) — podpowiedź, że ofertę pokażesz od razu, a wyślesz po akceptacji.
   - **Notatka ze spotkania** (zostaje w CRM, nie trafia do PDF), podsumowanie netto / VAT / brutto, „Utwórz ofertę i PDF” (⌘↩).
3. **Po utworzeniu**: PDF generuje się od razu (postęp etapów); „Pokaż PDF klientowi” (podgląd PDF w aplikacji: powiększenie, druk, Pobrane), „Wyślij e-mailem” (skrzynka pracownika, adresat, temat i treść jak w CRM, stopka firmy, PDF w załączniku — po akceptacji rabatu), „Poproś o akceptację” z uzasadnieniem i „Sprawdź decyzję” (powiadomienie dostają osoby akceptujące, nie autor), „Otwórz w CRM” (oferta albo — bez dostępu do ofert — zapytanie), „Nowa oferta”. Modal w trakcie czynności i komunikaty w oknie pokazu.
4. **Dane lokalnie**: szkic oferty (pozycje i formularz) w zaszyfrowanym pliku na dysku, osobno dla konta; po utworzeniu oferty — nowy, pusty szkic. Ponowne „Utwórz ofertę” po zerwanym połączeniu nie tworzy drugiej oferty ani drugiego zapytania.

Serwer: `GET/POST /bridge/native/v1/showcase` `op=offerSetup | offerClients | offerClient | offerPreview | offerCreate | offerStatus | offerApproval | offerPdf | offerEmail | offerEmailSend` (`src/lib/showcase/showcaseOffer.server.ts`), PDF — `/bridge/offers/generate-pdf`. Kod: `Showcase/ShowcaseOffer.swift` (modele, szkic, panel), `ShowcasePreviewView.swift` (przyciski, pasek, komunikaty), `ShowcaseStore.swift`, `ShowcaseModels.swift`. Migracja: `supabase/migrations/20261122120000_sales_showcase_offer.sql` (po `20261122100000_sales_showcase.sql`).

## Aktualizacja — Strefa sprzedawcy: Prezentacje (materiały na spotkania z klientami)

W pasku bocznym „Sprzedawcy” zmienia się w grupę **Strefa sprzedawcy**: **Sprzedawcy** (jak dotąd — sprzedawcy zewnętrzni, kokpit opiekuna) i nowe **Prezentacje** (`/crm/presentations`) — produkty pokazane graficznie i uporządkowane na spotkania: jak to wygląda, korzyści, galeria, warianty i ceny, przygotowanie, pytania klientów, realizacje. Te same dane i uprawnienia co CRM i telefon: podgląd — dostęp do ofert albo „Prezentacje — podgląd”, przygotowanie — „Prezentacje — przygotowanie” albo „Zarządzanie ofertami” (administrator — wszystko; sprzedawca z portalu — nic). Reguły pilnuje baza (RLS), osoby bez przygotowania widzą tylko widoczne działy i karty.

1. **Działy** (lewa kolumna): nazwa, liczba kart, ukryte; kolejność przeciąganiem; karta przeciągnięta na dział przechodzi do niego; edycja działu (nazwa, opis na kafelku, ikona, okładka — z Findera, „Z dysku” albo z wyboru zdjęć, widoczność, usunięcie razem z kartami).
2. **Karty działu** (środkowa kolumna): miniatura, hasło, produkty, braki, niezapisane zmiany; kolejność przeciąganiem; wyszukiwanie we wszystkich kartach; menu kontekstowe (podgląd, kopia). „Nowa karta” — **z produktu z katalogu** (zdjęcia produktu, wariantów i pakietów, wstęp, bloki: korzyści, warianty z cenami, pakiety, przygotowanie i wymagania — dane na bieżąco z Oferty → Produkty) albo pusta (szkielet: jak to wygląda, korzyści, galeria, jak przygotowujemy, pytania klientów).
3. **Edytor karty** (prawa część, cała szerokość okna): tytuł, widoczność na spotkaniach, ekran startowy (hasło, wstęp, zdjęcie główne — przeciągnięcie z Findera, Zdjęć, Safari, Poczty; HEIC i TIFF zamieniane na JPEG), **bloki w kolejności pokazu** (przeciąganie za uchwyt): zdjęcia (duże albo siatka; podpisy, kolejność przeciąganiem, z Findera, z dysku albo „Wybierz…” — zdjęcia produktów i realizacji ze strony bez kopiowania, Materiały, pliki wydarzenia, social media — kopia WebP 2560 px i miniatura na serwerze), punkty (kafelki, kroki z numerami, lista z ✓), z katalogu produktów (warianty i ceny, korzyści, przygotowanie i wymagania, pakiety — z podsumowaniem, co produkt ma w katalogu), specyfikacja, pytania klientów, tekst, realizacje ze strony; ukrywanie bloku (oko) i usuwanie. Panel boczny: produkty karty (kolejność przeciąganiem, karta produktu w CRM) i **lista kontrolna** z przejściem do bloku (puste bloki nie pokazują się na spotkaniu). „Zapisz” (⌘S) — wersja chroni przed nadpisaniem zmian z innego okna (pasek: odrzuć / zachowaj moje zmiany); modal w trakcie czynności, snackbar po sukcesie albo błędzie.
4. **Podgląd na iPadzie** (natywnie, iPad Pro 13″ albo iPad Air 11″ poziomo, skalowany do okna): strona startowa z działami, karty działu, karta (zdjęcie główne, hasło, wstęp, nawigacja po blokach przypięta u góry, bloki), galeria na pełnym ekranie ze strzałkami, **ceny ukryte z przełącznikiem**. Marka z księgi znaku domyślnej firmy: logo, sygnet, kolory według ról i font nagłówków (plik z księgi znaku pobrany i zarejestrowany w aplikacji). Z edytora — także niezapisana karta. Osoby z samym podglądem otwierają karty od razu w podglądzie.
5. **Dane lokalnie**: lista i otwarte karty w zaszyfrowanej kopii na dysku (otwierają się od razu, odświeżane w tle), zdjęcia w pamięci podręcznej obrazów; niezapisane zmiany zostają w pamięci przy przejściu do innej karty lub sekcji.

Kolejne etapy: tryb prezentacji na iPadzie (poziomo, pełny ekran, pobieranie offline, pokaz na spotkanie z wybranych kart), prezentowanie z Maca na drugim ekranie / AirPlay, po spotkaniu — notatka, wstępna blokada terminu, zapytanie i broszura z pokazanych pozycji.

Serwer: `GET/POST /bridge/native/v1/showcase` (`src/lib/showcase/*.ts`; zdjęcia z Maca — `POST ?op=upload&item=` / `&section=`). Kod: `Showcase/ShowcaseModels.swift`, `ShowcaseStore.swift`, `ShowcaseView.swift`, `ShowcaseEditorView.swift`, `ShowcaseSheets.swift`, `ShowcasePreviewView.swift`. Migracja: `supabase/migrations/20261122100000_sales_showcase.sql`.

## Aktualizacja — Realizacje: lista kontrolna z przejściem do pola, upuszczanie zdjęć i asystent AI przy sekcjach

Karta realizacji (Marketing → Realizacje) — to samo w CRM i w telefonie.

1. **Lista kontrolna**: kliknięcie punktu przewija kartę do pola, podświetla je złotą ramką i ustawia kursor w polu (tytuł, adres, krótki i szczegółowy opis, opis w Google; opisy alt — pierwsze zdjęcie bez opisu). Niespełnione punkty są podkreślone.
2. **Zdjęcia — upuszczanie**: przeciągnij zdjęcia z Findera, ze Zdjęć, z Safari, z Poczty albo miniaturę zrzutu ekranu — na sekcję (na koniec galerii), na zdjęcie główne (zastąpi je; dotychczasowe trafia na początek galerii) albo na kafelek galerii (wstawi w to miejsce). Widoczna strefa „Upuść zdjęcia tutaj” na końcu galerii i przy pustym zdjęciu głównym (kliknięcie — wybór z dysku), podświetlenie sekcji w trakcie przeciągania. Obrazy bez pliku (Zdjęcia, Safari) i adresy obrazów aplikacja zapisuje tymczasowo i wysyła jak pliki (HEIC, TIFF → JPEG); kafelek galerii upuszczony na zdjęcie główne = „Ustaw jako główne”.
3. **Asystent AI przy sekcjach** (propozycje do bieżącej, także niezapisanej treści — nic się nie zmienia, dopóki ich nie użyjesz; zapis — „Zapisz”):
   - **Podstawy**: „Zaproponuj tytuł” — 3–5 tytułów do wyboru (kliknięcie wstawia; adres strony idzie za tytułem, jeśli realizacji nie ma na stronie, a adresu nie zmieniano ręcznie) i **notatka dla asystenta AI** (motyw, dla kogo, co przygotowaliśmy) — wspólna dla wszystkich przycisków AI i panelu „Asystent AI”.
   - **Opisy**: „Napisz opisy” — krótki i szczegółowy opis (istniejący tekst jest źródłem faktów, propozycja go poprawia), „Użyj” / „Użyj obu”.
   - **Elementy realizacji**: „Zaproponuj elementy” — 3–6 elementów z ikonami; „Dodaj” przy elemencie, „Dodaj nowe” (bez powtórzeń), „Zastąp listę”.
   - **SEO i miasta**: „Uzupełnij SEO” — opis w Google (licznik 120–160), słowa kluczowe (rodzaj wydarzenia + miasto, usługa + miasto; „Dodaj brakujące” / „Zastąp”), tagi (z tagów innych realizacji), miasto realizacji i priorytetowe miasta (tylko z listy miast strony); „Użyj wszystkich” dopisuje do obecnych.
   - **Zdjęcia**: „Opisz zdjęcia (N bez opisu)” — opisy alt dla wszystkich zdjęć bez opisu (do 24 naraz) trafiają od razu do pustych pól; gdy każde zdjęcie ma opis — „Nowe opisy zdjęć”.
   Przyciski „Inne propozycje” i zamknięcie panelu przy każdej sekcji. Panel „Asystent AI” z boku zostaje (kilka pól naraz).

Serwer: `POST /bridge/native/v1/portfolio` `op=assist` z polami `titles`, `tags`, `city`, `referenceCities` (obok dotychczasowych); `alts` — zdjęcia bez opisu. Bez migracji. Kod: `Portfolio/PortfolioEditorView.swift`, `Portfolio/PortfolioModels.swift`, `Portfolio/PortfolioStore.swift`.

## Aktualizacja — Marketing: Realizacje (portfolio strony) natywnie

Marketing → **Realizacje** (`/crm/marketing/portfolio`) — jedno miejsce na realizacje do portfolio na stronie mavinci.pl: kopie robocze, zdjęcia, opisy, SEO i publikacja. Ten sam zakres, te same dane i uprawnienia co CRM i telefon: dostęp ma osoba z edycją strony (`website_edit` albo `page_manage`; administrator — wszystko); reguły pilnuje baza (RLS i funkcje publikacji), więc Mac nie może zrobić więcej niż przeglądarka.

1. **Lista** (lewa kolumna): realizacje ze stanem — Szkic, Na stronie, Niepublikowane zmiany, Zmieniono na stronie (ktoś edytował realizację w trybie edycji strony) — wyszukiwanie, filtry (Wszystkie, Szkic, Na stronie, Do opublikowania), liczba braków przed publikacją, gwiazdka wyróżnionych i znacznik niezapisanych zmian. Realizacje, które już są na stronie, pojawiają się na liście same (kopia robocza tworzona przy pierwszym otwarciu). „Nowa realizacja” — z wydarzenia w CRM (tytuł, data, miejsce, rodzaj) albo od zera z tytułem.
2. **Karta realizacji** obok listy, na całą szerokość okna (szeroki ekran — panel boczny obok, MacBook Air 13" — pod treścią): podstawy (tytuł, adres strony z podpowiedzią z tytułu — po publikacji adres się nie zmienia, kategoria z podpowiedziami, data, miejsce, klient, powiązane wydarzenie, wyróżnienie, kolejność), **zdjęcia** — zdjęcie główne i galeria: z Findera (przeciągnięcie albo „Z dysku”; HEIC i TIFF zamieniane na JPEG), z plików wydarzenia, z Materiałów i z biblioteki social media; serwer CRM zapisuje trzy wersje WebP strony (komputer 2200 px, telefon 800 px, miniatura); kolejność przeciąganiem (albo menu kontekstowe), „Ustaw jako główne”, opisy alt (brak — pomarańczowa ramka). Opisy (krótki i szczegółowy z licznikami), **elementy realizacji** (ikona, tytuł, opis; kolejność przeciąganiem za uchwyt albo strzałkami), **SEO i miasta** (opis w Google z licznikiem 120–160 znaków, słowa kluczowe i tagi jako etykiety, miasto realizacji, pokazywanie na stronach konferencji, priorytetowe miasta, film).
3. **Panel boczny**: lista kontrolna (wymagane: tytuł, adres, zdjęcie główne, krótki opis; zalecenia SEO: opis w Google, szczegółowy opis, galeria, alt, słowa kluczowe, miasto, elementy), podgląd wyniku w Google i **asystent AI** — z kilku zdań o realizacji przygotowuje tytuł, krótki i szczegółowy opis, opis w Google, słowa kluczowe, elementy realizacji i opisy zdjęć (opcjonalnie patrząc na zdjęcia); propozycje nie zmieniają realizacji, dopóki nie klikniesz „Użyj” / „Użyj wszystkich”.
4. **Zapis i publikacja**: „Zapisz” (⌘S) — kopia robocza (wersja chroni przed nadpisaniem zmian z innego okna albo urządzenia — wtedy pasek z wyborem: odrzuć moje zmiany / zachowaj i zapisz moją wersję), „Opublikuj na stronie” / „Opublikuj zmiany” — zapis i publikacja (strona odczytuje realizację od razu), „Wersja ze strony” — kopia robocza = to, co jest na stronie, „Usuń ze strony” (kopia zostaje jako szkic), „Usuń realizację”. Gdy realizację zmieniono także na stronie — wybór: pobierz wersję ze strony albo opublikuj swoją (zastępuje tamte zmiany). Modal w trakcie czynności, snackbar po sukcesie albo błędzie.
5. **Dane lokalnie**: lista i otwarte realizacje w zaszyfrowanej kopii na dysku (otwierają się od razu, odświeżane w tle), miniatury w pamięci podręcznej; niezapisane zmiany zostają w pamięci przy przejściu do innej realizacji lub sekcji.

Serwer: `GET/POST /bridge/native/v1/portfolio` (`src/lib/portfolio/*.server.ts`; zdjęcia z Maca — `POST ?op=upload&id=`). Kod: `Portfolio/PortfolioModels.swift`, `PortfolioStore.swift`, `PortfolioView.swift`, `PortfolioEditorView.swift`. Migracja: `supabase/migrations/20261121100000_marketing_portfolio.sql` (zdjęcia z Materiałów — po migracji Materiałów `20261120120000`).

## Aktualizacja — Jeden motyw w CRM, na Macu i w telefonie; pokaz prezentacji w kolorach motywu

- **Motyw pracownika** (`employees.crm_theme`: Burgund, Granat, Ciemny, Jasny) obowiązuje w CRM, na Macu i teraz także w telefonie (Ustawienia → Wygląd w każdej z aplikacji). Paleta poziomów tła jest wspólna: `src/lib/CRM/theme/crmThemePalette.ts` (kopia w telefonie), Mac — `Theme.swift` (te same wartości).
- **Podgląd jak na iPadzie** (Prezentacje) ma kolory motywu: tło — powierzchnia motywu (`theme.card`, jak `--brand-burgundy-800` w CRM), akcent — z księgi znaku (w jasnym motywie — akcent motywu), w jasnym motywie tekst ciemny, a przyciemnienia jasne (jak odwrócony CRM). Przeglądarka zdjęć zostaje czarna. Tak samo pokaz w CRM i na tablecie.
- **Font nagłówków z księgi znaku** — w CRM bez sztucznego pogrubienia (`font-synthesis: none` w `src/index.css`), w telefonie wszystkie nagłówki krojem regularnym, wersalikami.

Kod: `ShowcasePreviewView.swift` (`surface`, `ink`, `scrim`, schemat kolorów z motywu).

## Aktualizacja — Prezentacje: instrukcja z przykładem, asystent AI, pozycje i miejsce w ofercie, czytelne nagłówki

- **„?” obok tytułu „Prezentacje”** — instrukcja (te same rozdziały co „?” w CRM i w telefonie, z serwera: `GET /bridge/native/v1/showcase?op=help`, treść w `src/lib/help/presentationsHelp.ts`): jak działa pokaz, treściwa karta w 7 krokach, przykład, zdjęcia, asystent AI, pokaz, oferta. Wyszukiwanie bez polskich znaków. **„Utwórz kartę z przykładu w „dział””** dodaje do wybranego działu ukrytą kartę „Ciężki dym — pierwszy taniec w chmurach” z pełną treścią — do obejrzenia w „Podgląd na iPadzie” i przerobienia (podmień zdjęcia z bazy i produkt).
- **Asystent AI** w pasku edytora karty: z danych produktów karty (Oferty → Produkty) i opisu („Co podkreślić?”) proponuje hasło, wstęp, korzyści, kroki przygotowania, specyfikację i pytania klientów. Nie wymyśla cen ani wymiarów. Propozycje zaznaczasz i wstawiasz do kopii roboczej (hasło i wstęp zastępują obecne, wiersze trafiają do pierwszego bloku danego rodzaju, brakujący blok powstaje na końcu) — zapisujesz jak zwykle. Treść pisze serwer Next (`op=assist`, klucz `OPENAI_API_KEY` tylko na serwerze, model `OPENAI_MARKETING_MODEL` albo domyślny).
- **Oferta ze spotkania**: **„Dodaj pozycję”** w sekcji „Pozycje” — produkt z katalogu (wyszukiwanie z miniaturą), potem wariant, pakiet albo sam produkt (bez wariantów i pakietów — od razu); produkt z konfiguratorem dodasz w edytorze oferty. **Miejsce** podpowiada obiekty z bazy lokalizacji CRM („Nazwa, miasto”, adres); wybrany obiekt wiąże zapytanie z lokalizacją, a wpisany tekst zapisuje się jak dotąd. Migracja `20261122160000_sales_showcase_offer_location.sql` (bez niej miejsce zapisuje się tylko jako tekst).
- **Nagłówki pokazu** (podgląd jak na iPadzie): wersaliki, wyłącznie krój regularny fontu nagłówków z księgi znaku (pogrubienie ucina części liter), cyfry fontem tekstu (w foncie nagłówków „0” wygląda jak „O”) — tak samo w CRM i w telefonie.

Kod: `Showcase/ShowcaseHelp.swift`, `Showcase/ShowcaseAssistant.swift`, `ShowcaseOffer.swift` (`ShowcaseOfferAddLineSheet`, pole miejsca), `ShowcasePreviewView.swift` (`ShowcaseHeadingText`).

## Aktualizacja — Prezentacje na stronie produktu dla klienta (`/produkty/[id]`)

Jedna praca, dwa miejsca: aktywna karta prezentacji pokazuje się też na stronie produktu dla klienta każdego powiązanego produktu
(„Produkty z katalogu” w karcie) — pod opisem produktu, sekcja „Zobacz w praktyce”: hasło, wstęp, zdjęcie główne i bloki widoczne
na spotkaniu (zdjęcia, korzyści, kroki, „co obejmuje”, specyfikacja, pytania klientów, tekst, realizacje ze strony). Bloki „Z katalogu
produktów” tego produktu strona pomija (warianty, pakiety i wymagania pokazuje sama), innego produktu — jako odnośnik „Zobacz też”.
Bez cen, ukrytych bloków i szkiców; zdjęcia produktu z góry strony się nie powtarzają. W wersji angielskiej strony — same zdjęcia
(treść prezentacji jest po polsku). Serwer: `src/lib/showcase/showcaseProductPage.server.ts`; w edytorze karty (CRM i Mac) globus przy
produkcie otwiera jego stronę, a pod listą produktów jest informacja, gdzie karta się pokazuje.

**Przełącznik „Pokazuj na stronie produktu dla klienta”** (edytor karty, pod produktami; CRM i Mac): wyłączony — karta zostaje tylko
na spotkaniach. Domyślnie włączony (dotychczasowe karty bez zmian), zmiana podnosi wersję karty jak każda edycja, kopia karty go dziedziczy.
Kolumna `sales_showcase_items.show_on_product_page` — migracja `20261128100000_sales_showcase_product_page.sql`; bez niej przełącznika
nie widać, a strona produktu pokazuje wszystkie aktywne karty (serwer czyta kolumnę tylko, gdy istnieje — kolejność migracji i wdrożenia
dowolna).

## Aktualizacja — Prezentacje: baza zdjęć z albumami i okładki działów

Główna baza zdjęć to **Materiały → marka → Zdjęcia** z **albumami**. Album to odnośniki do plików (bez kopiowania) — ten sam plik może być w wielu albumach, usunięcie z albumu nie usuwa pliku. Migracja `20261122140000_material_albums.sql` (bez niej albumy są puste, reszta działa).
- **Materiały → Albumy** (pasek boczny pod folderami): przeciągnij pliki na album (odnośniki), przeciągnij album na inny (kolejność), kliknij — widok albumu: kolejność plików przeciąganiem, „Ustaw jako okładkę albumu”, „Pokaż w folderze”, „Usuń z albumu (plik zostanie)”, edycja i usunięcie albumu. W menu pliku i zaznaczenia — „Dodaj do albumu” / „Nowy album…”.
- **Prezentacje → okno wyboru zdjęć** (zdjęcie główne, blok zdjęć, okładka działu): Baza zdjęć (wszystkie zdjęcia i albumy, „Wgraj z dysku”, przeciąganie z Findera, przeciągnięcie kafelka na album, nowy album z zaznaczonych), Produkty i Realizacje (lista z miniaturą zdjęcia głównego, potem zdjęcia — bez kopiowania), Social media. Zdjęcie z dysku albo z Findera trafia do bazy zdjęć — ten sam plik drugi raz się nie zapisze — a karta trzyma odnośnik; do pokazu serwer przygotowuje jedną wspólną wersję WebP. Bez prawa „Materiały — zarządzanie” zdjęcie zostaje (jak dotąd) tylko w prezentacji.
- **Okładka działu** od razu przy tworzeniu działu: „Z dysku”, przeciągnięcie zdjęcia na pole okładki albo „Z bazy zdjęć…”.

## Aktualizacja — Materiały natywnie i w Finderze (Mavinci → Materiały)

W CRM działa **Materiały** (`/crm/materials`; uprawnienia „Materiały — podgląd” i „Materiały — zarządzanie”, marki z „Moich firm” pracownika, administrator — wszystko): foldery marki z domyślnymi (Logotypy i księga znaku, Zdjęcia, Wideo, Prezentacje i oferty, Dokumenty, Social media), podgląd zdjęć, PDF-ów i wideo, wysyłka plików i całych folderów do 2 GB na plik, poprzednie wersje, kosz na 30 dni i wyszukiwanie także w plikach wydarzeń.

Teraz Materiały są też folderami w Finderze — obok Eventy: **Mavinci → Materiały → marka → foldery i pliki** (folder „Materiały” widzą tylko osoby z dostępem do Materiałów, każda marka osobno):

1. **Cała struktura od razu**: Finder pokazuje wszystkie foldery i pliki z bazy (odnośniki z nazwą, rozmiarem i datą — zajmują miejsce dopiero po pobraniu). Treść pliku pobiera się przy pierwszym otwarciu, podglądzie Quick Look albo „Pobierz teraz” w menu Findera; macOS może zwolnić miejsce, gdy go brakuje (plik pobierze się znowu przy otwarciu).
2. **Przeciąganie**: pliki i całe foldery przeciągnięte (albo skopiowane) do folderu marki trafiają do Materiałów — z miniaturą zdjęcia, klatką wideo i pierwszą stroną PDF jak w CRM; przeciągnięcie z Materiałów na biurko albo do innej aplikacji kopiuje plik. Plik przeciągnięty z Eventy do Materiałów zostaje skopiowany do Materiałów (jak „Zapisz w Materiałach” w CRM), oryginał zostaje w wydarzeniu. Przenoszenie w obrębie marki — między folderami; do innej marki albo do Eventy — element wraca na miejsce.
3. **Zmiany z Findera** (marki z „Materiały — zarządzanie”): nowy folder, zmiana nazwy, przenoszenie, edycja pliku (nowa wersja; poprzednia zostaje na 30 dni; gdy w międzyczasie ktoś zmienił plik — Twoja wersja zapisuje się obok jako „(konflikt …)”), **kosz** — usunięty element trafia do kosza Materiałów na 30 dni i jest w Koszu Findera („Odłóż” przywraca, „Usuń natychmiast” — usuwa na zawsze). Foldery domyślne marki można przemianować, ale nie przenieść ani usunąć. Z samym podglądem — Finder pokazuje pliki tylko do odczytu.
4. **Synchronizacja**: zmiany z CRM, aplikacji i telefonu docierają do Findera co minutę, gdy aplikacja jest otwarta (zamknięta — przy otwarciu folderu); nadanie albo odebranie dostępu do marki i zmiana zakresu „zarządzania” — też. Wylogowanie usuwa „Mavinci” z Findera razem z pobranymi kopiami.

Serwer: `GET /bridge/native/v1/materials` `op=sync | changes&since= | item | download | finderTrash`, `POST` `op=update | finderRemove`, `restore` / `deleteForever` z `itemIds` (`src/lib/materials/materials.server.ts`, sekcja „Finder”); wysyłka jak w CRM (`prepareUpload` → magazyn → `completeUpload`). Kod: `Sources/MavinciFileProvider/MaterialsCatalog.swift` (kopia drzewa i zapisy), `FileProviderExtension.swift` (Eventy i Materiały razem, wspólny punkt synchronizacji), `FinderModels.swift`, `FinderAPI.swift`; miniatury i skróty plików — `Sources/Mavinci/Finder/MaterialMedia.swift` (wspólne z aplikacją). Bez migracji (`20261120120000_materials_library.sql` jest w bazie).

**Ekran natywny „Materiały”** (pozycja w pasku bocznym — już nie otwiera przeglądarki), 1:1 z CRM, te same uprawnienia i zakres marek:

1. **Marka i drzewo folderów** (domyślne foldery marki z ikonami: Logotypy i księga znaku, Zdjęcia, Wideo, Prezentacje i oferty, Dokumenty, Social media), okruszki, „Pokaż w Finderze” (ten sam folder w Mavinci → Materiały).
2. **Zawartość folderu** — siatka miniatur (zdjęcia, klatka wideo z czasem trwania, pierwsza strona PDF) albo lista; sortowanie: nazwa, data zmiany, rozmiar, rodzaj; zaznaczanie jak w Finderze (⌘ i ⇧, ⌘A, Esc; przy co najmniej dwóch elementach plakietka na dole: liczba, „10 plików · 2 foldery · 24,3 MB”, „Czynności” jak pod prawym przyciskiem i odznaczenie), **spacja / dwuklik — Quick Look**, Enter — otwórz, Delete — do kosza; menu kontekstowe (podgląd, otwórz w domyślnej aplikacji, pobierz do „Pobrane”, zmień nazwę, przenieś, podmień treść, usuń).
3. **Przeciąganie**: pliki i całe foldery z Findera (oraz zdjęcia ze Zdjęć, Safari, Poczty) na folder w siatce, na liście, w drzewie albo do bieżącego folderu — wysyłka z oknem postępu (najwyżej 2000 plików naraz — idą po kolei, każdy osobno — do 2 GB na plik; plik, który już jest w Materiałach marki — ta sama treść, SHA-256 — jest pomijany, a okno pokazuje, gdzie już leży; foldery powstają jak na dysku; „Przerwij wysyłkę”); elementy przeciągnięte w aplikacji na inny folder — przeniesienie (także kilka zaznaczonych); plik przeciągnięty z aplikacji do Findera, na biurko albo do innej aplikacji — kopia pliku.
4. **Karta pliku** z boku: duży podgląd, rodzaj, rozmiar, wymiary, czas, folder, kto i kiedy dodał / zmienił, powiązane wydarzenie; opis i tagi (zarządzanie), poprzednie wersje z pobraniem (30 dni), „Podmień treść”.
5. **Wyszukiwanie** w Materiałach wszystkich marek (nazwa, opis, tagi — „Pokaż w folderze”) albo w plikach wydarzeń (wg dostępu do wydarzeń) z **„Zapisz w Materiałach”** do wybranego folderu (ten sam plik w marce — bez duplikatu).
6. **Kosz** (zarządzanie): elementy z ostatnich 30 dni (folder razem z zawartością), kto i kiedy usunął, ile dni zostało, „Przywróć”, „Usuń na zawsze”, „Opróżnij kosz”; sprzątanie kosza i starych wersji co 6 godzin (jak w CRM).
7. **Dane lokalnie**: marki, drzewo i ostatnio oglądane foldery w zaszyfrowanej kopii na dysku, miniatury w `~/Library/Application Support/Mavinci/Desktop/v1/materials-thumbs/` (osobno dla konta, usuwane przy wylogowaniu) — ekran otwiera się od razu, także bez internetu; odświeżanie co minutę i po powrocie do aplikacji. Zmiany z ekranu od razu sygnalizują Finderowi.

**Telefon**: pozycja „Materiały” w menu — marki, foldery, siatka miniatur, podgląd zdjęć, filmów i PDF-ów, udostępnianie i „Zapisz w Zdjęciach”, wyszukiwanie (także w plikach wydarzeń z „Zapisz w Materiałach”); z zarządzaniem — wgrywanie z aparatu, galerii i Plików z postępem, nowy folder, zmiana nazwy, przenoszenie, kosz.

## Aktualizacja — „Mavinci” w aplikacji Pliki na iPhonie i iPadzie (to samo rozszerzenie co w Finderze)

1. **Jedno źródło.** Rozszerzenie Findera (`Sources/MavinciFileProvider/*.swift` oraz `Mavinci/Finder/FinderShared.swift` i `MaterialMedia.swift`) buduje się także na iOS 16+: plugin `mobile/plugins/withMavinciFiles.js` kopiuje te pliki przy `expo prebuild` (EAS Build) do celu `MavinciFiles` (`com.mavinci.crm.Files`, grupa aplikacji `group.com.mavinci.crm`). Eventy, Materiały i Dysk w aplikacji Pliki wyglądają i działają jak w Finderze; zmiana w rozszerzeniu trafia na iPhone'a i iPada z kolejną wersją aplikacji mobilnej (nie przez OTA). Nowy plik `.swift` w `MavinciFileProvider` trafia do celu iOS sam.
2. **Różnice iOS** — tylko w `#if os(iOS)`: grupa aplikacji, nagłówki `X-Mavinci-Client: phone` i `User-Agent: MavinciPhone/1.0 (Pliki)` (stałe `FinderShared.client` / `userAgent` — na Macu bez zmian), unieważniona sesja usuwana z kontenera (aplikacja tworzy nową przy otwarciu), przeglądanie folderu w Plikach samo prosi o zmiany (najwyżej co 2 minuty — aplikacja na telefonie robi to tylko, gdy jest otwarta).
3. **Sesja rozszerzenia.** Telefon odświeża swoją sesję sam, a token odświeżania działa raz — dlatego rozszerzenie dostaje osobną sesję tego samego konta: `POST /bridge/native/v1/device-session` (`src/lib/native/deviceSession.server.ts`, jednorazowy link logowania bez e-maila, wymieniany od razu na sesję). Zapisuje ją moduł `mobile/modules/mavinci-files` (pod tą samą blokadą `session.lock` co odświeżanie w rozszerzeniu); wylogowanie w aplikacji unieważnia ją na serwerze i usuwa lokalizację razem z pobranymi kopiami.
4. **Przy zmianach w rozszerzeniu** kod musi kompilować się na iOS: bez AppKit (Foundation, FileProvider, UniformTypeIdentifiers, CryptoKit, AVFoundation, ImageIO), API dostępne w iOS 16.

## Aktualizacja — Dysk → Pracownicy i zakładka „Dokumenty” w profilu pracownika

Nowy dział **Pracownicy** (z prawem „Pracownicy — podgląd / zarządzanie” albo „Umowy personelu — podgląd / zarządzanie”) — pracownik → foldery według uprawnień, jak zakładki profilu w CRM:

1. **Zdjęcia** — zdjęcie profilowe i zdjęcie w tle (Quick Look, pobranie, przeciągnięcie do Findera).
2. **Dokumenty** — skany i pliki pracownika (umowa, certyfikat, dokument tożsamości, badania lekarskie, szkolenie BHP, inne) z rodzajem i terminem ważności pod nazwą (po terminie — na czerwono w profilu). Widzi i dodaje sam pracownik, administrator i „Pracownicy — zarządzanie”; „Dodaj pliki” i przeciąganie z Findera (do 50 MB, nazwa z nazwy pliku).
3. **Umowy** — najnowszy dokument każdej umowy z „Umowy i rozliczenia” jako PDF (własne albo z prawem „Umowy personelu — podgląd”; zakres finansów „sprzedaż” — bez umów). PDF składa serwer Next z treści zapisanej w CRM, raz na wersję dokumentu.

**Profil pracownika → Dokumenty** (Zespół) działa jak w CRM: lista dokumentów z Dysku, **Dodaj dokument** (plik, nazwa, rodzaj, termin ważności, opis), Quick Look, pobranie, **Usuń** (administrator, „Pracownicy — zarządzanie”, autor dokumentu). Ten sam folder w Dysku, w Finderze i w telefonie.

**Finder** (Mavinci → Pracownicy): ta sama struktura; do „Dokumenty” można dodawać pliki (folder widzą tylko osoby, które mogą tam dodawać), reszta tylko do odczytu.

Serwer: `/bridge/native/v1/drive` — węzły `employees`, `employees:<id>`, `employees:<id>:photos|documents|contracts`, `POST` `deleteFile` (dokument pracownika); `completeUpload` przyjmuje `title`, `documentType`, `description`, `expiryDate`. Kod: `Sources/Mavinci/Team/EmployeeDocumentsView.swift`, `Drive/*`, `MavinciFileProvider/DriveCatalog.swift`. **Migracja** `20261123100000_employee_documents.sql` (tabela `employee_documents`, prywatny bucket `employee-documents`, RLS).

## Aktualizacja — Dysk: Eventy, Materiały, Oferty, Kalkulacje, Umowy i Magazyn (aplikacja i Finder)

Pozycja **„Dysk”** (dawniej „Materiały”, adres CRM `/crm/materials` bez zmian) to ta sama chmura co w Finderze, w CRM i w telefonie — jedno drzewo z działami, tylko tymi, do których pracownik ma prawa:

1. **Eventy** — rok → wydarzenie („2026-11-21 Nazwa”) → pliki z zakładki Pliki (pełna obsługa jak w karcie wydarzenia: foldery, wysyłka, przeciąganie, Quick Look), „Otwórz wydarzenie”.
2. **Materiały** — dotychczasowy ekran; jego drzewo folderów i albumów jest w pasku Dysku pod pozycją „Materiały”. W folderze **„Logotypy i księga znaku”** na górze: logotypy (na szachownicy, podgląd i pobieranie), fonty (pobieranie) i kolory (kliknięcie kopiuje HEX) z **Ustawienia → Moje firmy → Księga znaku** — odnośniki, bez kopii; „Edytuj księgę znaku” otwiera CRM.
3. **Oferty, Kalkulacje, Umowy** — rok → miesiąc (czas w Warszawie; oferty i kalkulacje wg daty utworzenia, umowy wg daty wystawienia) → PDF z CRM, np. „OF-2026-11-020 — Hotel Omega — Gala firmowa.pdf”. Lista albo siatka, filtr, Quick Look (spacja / dwuklik), „Otwórz w domyślnej aplikacji”, „Pobierz” (do „Pobrane”), przejście do oferty / wydarzenia / zapytania / umowy, przeciągnięcie pliku do Findera albo innej aplikacji. Tylko do odczytu — PDF-y powstają w CRM.
4. **Magazyn** — kategoria → sprzęt → zdjęcia, pliki i instrukcja (puste kategorie ukryte, „Bez kategorii”). Z prawem „Zarządzanie magazynem” — „Dodaj pliki” i przeciąganie z Findera: zdjęcie JPG/PNG/WebP/GIF do 10 MB trafia do galerii sprzętu, inne pliki do 50 MB — do plików sprzętu (jak w CRM).
5. **Dane lokalnie**: działy, ostatnio oglądane foldery i lista wydarzeń w zaszyfrowanej kopii na dysku; pliki do podglądu — kopie w katalogu tymczasowym (raz na wersję pliku). Odświeżanie co 2 minuty i po powrocie do aplikacji.

**Finder** (Mavinci): obok Eventy i Materiały — **Oferty**, **Kalkulacje**, **Umowy** (rok → miesiąc → PDF) i **Magazyn** (kategoria → sprzęt → pliki), a w Materiałach → marka → „Logotypy i księga znaku” folder **„Z księgi znaku”** (logotypy, fonty, „Kolory marki.txt”). Cała struktura od razu, treść pobiera się przy otwarciu. Dodawanie plików do folderu sprzętu z prawem „Zarządzanie magazynem” (przeciągnięcie albo kopiowanie); poza tym Dysk w Finderze jest tylko do odczytu — przeniesienie pliku z Eventy albo Materiałów do Dysku cofa się. Kopia Dysku w Finderze odświeża się co 10 minut przy sprawdzaniu zmian i od razu po dodaniu pliku w aplikacji.

Serwer: `GET /bridge/native/v1/drive` `op=root | list&node= | download&id&mode=preview|download | sync` (z księgą znaku marek), `POST` `prepareUpload | completeUpload | cancelUpload` (`src/lib/drive/drive.server.ts`, typy `src/lib/drive/driveShared.ts`). Kod: `Sources/Mavinci/Drive/*` (ekran, kopia, księga znaku), `Materials/MaterialsView.swift` (działy Dysku w pasku, księga znaku), `Sources/MavinciFileProvider/DriveCatalog.swift` (Finder), `FileProviderExtension.swift` (wspólny punkt synchronizacji: wydarzenia, Materiały, Dysk). Bez migracji.

Kod ekranu: `Sources/Mavinci/Materials/MaterialsModels.swift`, `MaterialsStore.swift` (dane, kopia na dysku, wysyłka z postępem, przeciąganie), `MaterialsView.swift`, `MaterialsSheets.swift` (wybór folderu, panel wysyłki, karta pliku, wyszukiwanie, kosz).

**Wysyłka w tle.** Wysyłka plików na Dysk nie blokuje aplikacji: zamiast okna modalnego jest panel w prawym dolnym rogu okna
(`MaterialsUploadPanel`, obok przycisku komunikatora) — liczba plików, postęp, bieżący plik i „Przerwij wysyłkę”, a po rozwinięciu
lista plików z miejscem docelowym, błędami i pominiętymi duplikatami. W tym czasie można przeglądać Dysk, pracować w innych sekcjach
i dodawać kolejne pliki — dołączają do kolejki (`MaterialsStore.enqueue`). Postęp jest w osobnym obiekcie (`MaterialsUploads`) i przychodzi
najwyżej 4 razy na sekundę — wcześniej każda porcja wysłanych bajtów przeliczała cały widok Dysku, co przy setkach zdjęć zatrzymywało
aplikację. Przeglądanie przeciągniętych folderów odbywa się poza wątkiem interfejsu, nowe pliki pojawiają się w otwartym folderze
co kilka sekund, a podfoldery powstają w marce pliku (także gdy w trakcie wysyłki na ekranie otwarto inną markę). Po udanej wysyłce
panel znika sam; z błędami albo duplikatami zostaje do „Zamknij”.

## Aktualizacja 0.22 — Finanse: Wyciągi, Uzgodnienie wyciągów i Deklaracje ZUS i podatki natywnie

Lewa kolumna Finansów jest teraz pogrupowana: **Przegląd** (Centrum finansów), **Bank** (Wyciągi, Uzgodnienie wyciągów), **Podatki i terminy** (Terminy i monity, Deklaracje ZUS i podatki, Przekazanie księgowej, Zamknięcie miesięcy), **Koszty i dokumenty** (Faktury, KSeF, Koszty i wypłaty). Ekrany banku dotyczą jednej działalności (wybór u góry ekranu spośród działalności z filtra Finansów). Te same funkcje bazy, uprawnienia i komunikaty co w CRM; zmiany — poziom „Zarządzanie finansami” działalności. Zamiast długich stron z przyciskami przy każdej pozycji — lista z lewej i panel wybranej pozycji z prawej.

1. **Wyciągi** — rok w miesiącach: przy każdym miesiącu stan plików rachunku bieżącego i VAT (komplet PDF + MT940, tylko jeden format, brak, błąd importu). Z prawej pliki miesiąca: format, rachunek, liczba operacji, saldo otwarcia i zamknięcia, data dodania; podgląd PDF w aplikacji (MT940 — do Pobranych), pobranie, zmiana nazwy, usunięcie pliku (najpierw kontrola powiązań jak w CRM, potem pytanie z dokładnym opisem pliku). **Wgraj wyciąg** — miesiąc, rok, rachunek (bieżący / VAT) i plik w strefie na całą wysokość okna: przeciągnij i upuść albo kliknij (sprawdzenie typu, rozmiaru do 10 MB i folderu, „Zmień plik” / „Usuń”); format (PDF / MT940: .txt, .sta, .mt940) rozpoznawany po rozszerzeniu, bez wyboru przed dodaniem pliku; serwer sprawdza okres i ciągłość salda (PDF), numer rachunku (z pytaniem, gdy wymaga potwierdzenia) i drugi plik tego samego formatu, zapisuje operacje, łączy transfery bieżący ↔ VAT i uzgadnia miesiąc — wynik w komunikacie. Przycisk „Uzgodnienie miesiąca” przechodzi do uzgodnienia.
2. **Uzgodnienie wyciągów** — miesiąc (strzałki i lista miesięcy z wyciągami), „Uzgodnij automatycznie”, „Braki (CSV)” (lista dla księgowej w Pobranych), „?” — reguły uzgadniania. Stan obu rachunków (potwierdzenie listy operacji w obu plikach), stany operacji z liczbami (filtr jednym kliknięciem), „Do zrobienia / Wszystkie”, rachunek, wyszukiwanie, rozwijane podsumowanie ZUS i podatków oraz umów stałych miesiąca. Z lewej operacje (data, kontrahent, tytuł, stan, kwota), z prawej wybrana operacja: dane z wyciągu, **rozliczenie** (faktury z podglądem, wypłaty, deklaracje, umowy stałe, pary zwrotu — każde z cofnięciem), **wyjaśnienie** bez faktury (z cofnięciem i „Przypisz do deklaracji”), **propozycja** systemu (powód, dokumenty z opisem stanu płatności i podpowiedzią, wybór przy „do wyboru”, „Zatwierdź”, „Odrzuć”, „Odrzuć i wybierz inny”) i **Rozlicz ręcznie**: wybór dokumentu (filtry, sortowanie po kwocie, płatność częściowa, wyjątek gotówki na fakturze KSeF z uzasadnieniem), wyjaśnienie bez faktury (rodzaje jak w CRM, transfer VAT z wyborem drugiej operacji, dokument źródłowy — PDF lub obraz), wpłata własna, umowa stała (najlepiej pasująca, okres i kwota; nowa umowa z płatności), para „płatność + zwrot” (zwrot częściowy), deklaracja (także nowa). „Szczegóły płatności” — pełne dane operacji, wyciąg, dokumenty wyjaśnienia, druga strona transferu VAT. Przełącznik „Faktury bez płatności” — opłacone ręcznie bez wyciągu, nieopłacone z terminem, robocze kopie KSeF. Podgląd dokumentu: faktura CRM — wydruk PDF, spoza KSeF — wgrany plik, KSeF — dane z XML.
3. **Deklaracje ZUS i podatki** — rok i rodzaj, kafle (do zapłaty wg deklaracji, zapłacono z wyciągów, do sprawdzenia), z lewej deklaracje ze stanem, z prawej wybrana: zdanie o stanie, przelewy z wyciągów (z przejściem do uzgodnienia tego miesiąca i odpięciem), pliki (podgląd, dodanie, usunięcie), rozbicie na pracowników (ZUS: składki z RCA, PIT: zaliczki; „Dodaj osoby z umów”, pozycja, suma i zgodność z deklaracją). „Dodaj deklarację” i „Kwota i dane” — symbol (z listą typowych: DRA, PIT-4R, PIT-8AR, VAT-7, VAT-7K, CIT-8), rodzaj, okres (miesiąc / kwartał / rok), kwota, termin, notatka.

4. **Faktury** — rejestr sprzedaży wybranych działalności (faktury lokalne i wystawione w KSeF, pro formy, szkice): wyszukiwanie (numer, nabywca, NIP), filtr typu i statusu, kafle (liczba, netto i brutto bez pro form i zaliczek, opłacone), tabela z sortowaniem; z prawej karta faktury — sprzedawca i nabywca, daty, kwoty (dla końcowej — do zapłaty po zaliczkach), płatność z datą zapłaty i zapłatą z wyciągu przez dokument KSeF, stan KSeF z numerem i błędem, powód korekty / anulowania, pozycje, powiązane dokumenty (kliknięcie otwiera ich kartę). Czynności z karty jak w CRM: podgląd PDF (wydruk z danych faktury w aplikacji, z drukowaniem i zapisem), „Oznacz jako wysłaną”, „Oznacz jako opłaconą…” (data pełnej zapłaty, kwota po zaliczkach; zapis tylko, gdy faktura się w międzyczasie nie zmieniła), „Anuluj fakturę…” (powód, potwierdzenie, że nie trafiła do nabywcy) i usunięcie szkicu / pro formy z uporządkowaniem numeracji; „Więcej” — faktura korygująca, kolejna faktura zaliczkowa i faktura końcowa (natywnie, „Aktualizacja — Finanse: wystawianie faktur natywnie”), karta w CRM. Edycja, PDF, e-mail, KSeF i UPO — natywnie (zob. „Karta faktury: PDF, e-mail, KSeF i UPO”). Odnośniki `/crm/invoices/<id>` z Centrum finansów otwierają kartę na Macu.
5. **KSeF** — faktury pobrane z KSeF jednej działalności (wybór u góry spośród działalności z filtra, które mają aktywną konfigurację KSeF): wiersz stanu (NIP, środowisko testowe, ostatnie logowanie do KSeF, automatyczna synchronizacja z datą ostatniej udanej i błędem), **Synchronizuj z KSeF** za zakres dat (domyślnie od początku miesiąca do dziś; logowanie do KSeF danymi działalności, potem wystawione i otrzymane — komunikat „Nowe / Pominięte (już istnieją)” jak w CRM), dziennik synchronizacji (rodzaj, data, liczba faktur, błąd). „Wystawione / Otrzymane” z liczbami, filtr zapłaty (wszystkie, nieopłacone, opłacone, z uwagą do płatności), wyszukiwanie (numer, numer KSeF, kontrahent, NIP, kwota), sumy brutto i do zapłaty, tabela z sortowaniem (numer z numerem KSeF, data, kontrahent, brutto, stan zapłaty jak w CRM z terminem i znacznikiem uwagi); pod tabelą wybrana faktura — kwoty, forma płatności, rachunek, wpłaty (z wyciągu oznaczone) i uwaga. Podwójne kliknięcie — podgląd faktury z XML. Czynności (menu, „Zarządzanie finansami”): „Oznacz jako opłaconą” (wpłata pozostałej kwoty z dzisiejszą datą), „Oznacz jako nieopłaconą” (usuwa ręczne wpłaty, dopasowania z wyciągów zostają), „Płatność i termin…” (wpłaty częściowe z datą i uwagą, usuwanie ręcznych wpłat, termin; bez wpłat — data pełnej zapłaty albo status nieopłacona / po terminie), „Oznacz uwagę jako wyjaśnioną”, „Faktura w rejestrze sprzedaży”; administrator — „Usuń z lokalnej bazy” (nie z KSeF). Odnośniki `/crm/invoices?tab=ksef` otwierają ten ekran.
6. **Koszty i wypłaty** — ręczne zapisy wynagrodzeń, gotówki i kosztów spoza KSeF i faktur (200 najnowszych, jak w CRM): kafle (zapłacono, poniesione do zapłaty, planowane), filtr rodzaju i statusu, wyszukiwanie, tabela z sortowaniem (data, opis z pracownikiem, kategoria w kolorze, działalność, forma i status płatności, kwota), „Dodaj koszt lub wypłatę” (rodzaj, działalność, pracownik przy wypłacie, kategoria, opis, kwota, forma płatności, daty, status, uwagi) i usuwanie (menu, klawisz Delete) — dla działalności z „Zarządzaniem finansami”.
7. **Przekazanie księgowej** (Saldeo, jak „Dla księgowej” w CRM) — działalność i miesiąc (strzałki, lista miesięcy i lat), kafle (nowe pliki do Saldeo, oryginalne wyciągi, płatności zbiorcze, pomijane faktury KSeF) i trzy listy zamiast jednej długiej strony: **Dokumenty spoza KSeF** (stan „Do Saldeo / E-mail wysłany”, powiązane płatności z numerem przelewu i płatnością zbiorczą albo opis z analizy, „Zobacz więcej”, „Edytuj istniejący opis”, „Przejdź do analizy”), **Płatności zbiorcze** (przelew za kilka faktur z podziałem kwot) i **Braki i do dosłania** (ostrzeżenia, operacje VAT / ZUS / PIT tylko na wyciągach, płatności bez dokumentu ze świadomym zaznaczeniem „doślę później”, lista „Dokumenty do dosłania” z „Usuń z listy” i CSV). Okno szczegółów jak w CRM: dane dokumentu lub płatności, powiązane płatności i dokumenty rozliczone tym przelewem, poprawa istniejącego opisu z analizy (zapis tylko, gdy opis i powiązania nie zmieniły się w międzyczasie), podgląd pliku źródłowego lub wyciągu. Z prawej kontrola pakietu: konto nadawcze CRM, adres dokumentów Saldeo (@dok.saldeo.pl), stan automatycznego PIN-u (tylko na serwerze), e-mail księgowej, blokady; **1. Pobierz plik kontrolny** (plik HTML w Pobranych, otwierany w przeglądarce — plan wysyłki i dokładne załączniki, w tym kopie PDF z opisem), akceptacja, **Zapisz sprawdzoną paczkę ZIP** (foldery „saldeo” i „ksiegowa”, bez wysyłki) i **2. Wyślij sprawdzony pakiet** (z potwierdzeniem): kontrola niezmienności danych i plików, rezerwacja, dokumenty do Saldeo przez trasę CRM, wyciągi i opisy płatności zbiorczych do księgowej, zapis w historii — dokładnie te bajty, które były w pliku kontrolnym; wynik niepewny zatrzymuje kolejne wysyłki. „Pobierz rejestr transakcji CSV”, ostatnie przekazanie raportu. Plik kontrolny i wysyłkę przygotowuje aktywny administrator CRM (jak w CRM).

8. **Terminy i monity — „Co z tym zrobić?”** — obok tabeli panel dla zaznaczonej pozycji (przełącznik „Co z tym zrobić?” nad listą, zapamiętany na tym Macu): co to jest, skąd się wzięła, stan w zrozumiałych słowach (np. „CRM nie zna kwoty i nie widzi przelewu w wyciągach do …”) i kroki z przyciskami. **ZUS i podatki**: „Wpisz kwotę z deklaracji…” (okno deklaracji z okresem i terminem; 0 zł, gdy nic nie było do zapłaty), „Uzgodnienie — miesiąc terminu” (przypisanie przelewu: „Rozlicz ręcznie” → „Przypisz do deklaracji”), „Wyciągi — miesiąc” przy braku wyciągu, „Deklaracje ZUS i podatki”, „Obowiązki działalności”. **Należności**: uzgodnienie miesiąca terminu albo wyciągi (gdy wpłata może być po ostatnim wyciągu), „Oznacz zapłatę…” (data; faktura CRM — jak „Oznacz jako opłaconą”, faktura tylko z KSeF — wpłata ze sposobem), „Wyślij przypomnienie…”, karta faktury. **Do zapłaty**: „Oznacz jako zapłaconą…” (karta, gotówka, polecenie zapłaty, środki prywatne, przelew spoza wyciągów — data i notatka w rejestrze wpłat KSeF), uzgodnienie miesiąca, „Ustaw termin…”, sprawdzenie na białej liście, kopiowanie rachunku; biała lista przy fakturze do 15 000 zł pokazuje „nieobowiązkowe — do 15 000 zł” zamiast „niesprawdzone”. **Przelewy ponad 15 000 zł**: po co jest biała lista (koszt podatkowy, odpowiedzialność za VAT dostawcy, ZAW-NR w 7 dni), wynik sprawdzenia i co dalej, „Sprawdź ten przelew”, uzgodnienie miesiąca przelewu. Bez zaznaczenia — opis listy i kiedy pozycja jest załatwiona. Przejścia ustawiają działalność pozycji i właściwy miesiąc (bez wyciągu za miesiąc — ekran wyciągów z komunikatem).

9. **Wszystkie dokumenty** (Koszty i dokumenty → pierwsza pozycja) — jeden rejestr faktur i dokumentów kosztowych jednej działalności za zakres dat wystawienia (domyślnie od początku miesiąca sprzed dwóch miesięcy do dziś): faktury z KSeF (wystawione i otrzymane), faktury CRM i **dokumenty spoza KSeF** (faktury zagraniczne, np. Adobe, OpenAI, paragony, polisy, noty) — wcześniej na Macu były widoczne tylko w oknie „Dopasuj dokument do płatności”. Przełącznik „Źródło” (Wszystkie / KSeF / CRM / Spoza KSeF, z liczbą dokumentów), rodzaj (kosztowe / sprzedażowe), stan zapłaty i wyszukiwanie; wiersz stanu pod filtrami (`FinFilterSummary`) pokazuje „Pokazano X z Y”, włączone filtry (× wyłącza jeden) i „Wyczyść filtry”, a zmieniony filtr ma złotą obwódkę. Tabela z sortowaniem (źródło, dokument, kontrahent z NIP, data i termin, brutto z oznaczeniem koszt / sprzedaż, zapłata), dwuklik — podgląd dokumentu, menu: podgląd, „Otwórz w CRM”, „Kopiuj numer”; „Dodaj dokument spoza KSeF” otwiera CRM (wgranie pliku z odczytem danych). Kod: `Finance/FinanceDocumentsView.swift`, serwer `documentRegister` (`/bridge/native/v1/finance/bank?op=documents`). Część „Faktury” nazywa się teraz **„Faktury sprzedaży”** (to rejestr sprzedaży, nie wszystkie faktury). Ten sam wiersz stanu filtrów ma okno „Dopasuj dokument do płatności” (z liczbą dokumentów każdego typu na liście typów) — opis: `docs/bank-reconciliation.md`, sekcja 12.

Powiadomienia i odnośniki z danych CRM do „Uzgodnienia wyciągów”, „Wyciągów”, „ZUS i podatki”, „Przekazania księgowej” i „Kosztów i wypłat” otwierają te ekrany na Macu (także przyciski w „Terminach i monitach”, „Zamknięciu miesięcy” i liście kontrolnej Centrum finansów).

**Zostaje w CRM**: konfiguracja KSeF (certyfikat, token, automatyczna synchronizacja — przycisk z ekranu KSeF), analiza miesiąca z AI i rejestr umów stałych — w CRM (wystawianie faktur i korekt, faktura końcowa, edycja, faktura z pro formy, PDF, e-mail, wysyłka do KSeF i UPO — natywnie, zob. „Aktualizacja — Finanse: wystawianie faktur natywnie”).

Serwer: `GET /bridge/native/v1/finance/bank?op=periods|month|picker|explain|details|contracts|refunds|declarations|statements|file|document`, `POST` (JSON) `op=run|accept|reject|undo|match|explain|linkDeclaration|linkContract|saveContract|linkRefund|declarationSave|declarationDelete|lineSave|lineDelete|linesPrefill|declarationFileRemove|statementRename|statementCheck|statementDelete`, `POST ?op=statementImport|declarationFile|explainFile` (multipart) — `src/lib/native/financeBank.ts`; koszty i wypłaty — `GET /bridge/native/v1/finance?op=entries`, `POST op=entrySave|entryDelete` (`src/lib/native/financeEntries.ts`); faktury — `GET op=invoices|invoice`, `POST op=invoiceStatus|invoiceCancel|invoiceDelete` (`src/lib/native/financeInvoices.ts`); KSeF — `GET op=ksef|ksefInvoices`, `POST op=ksefPaid|ksefUnpaid|ksefPaymentAdd|ksefPaymentRemove|ksefPaymentSave|ksefReviewResolve|ksefDelete` (`src/lib/native/financeKsef.ts`); przekazanie księgowej — `GET /bridge/native/v1/finance/saldeo?op=setup|pin|month|details|file|csv`, `POST op=note|followup|review|sendCheck|claim|complete` (`src/lib/native/financeSaldeo.ts` — logika `SaldeoDeliveryPanel`), dokumenty do Saldeo — trasa CRM `/bridge/integrations/saldeo`, wyciągi do księgowej — `send-email`, synchronizacja — trasy CRM `/bridge/ksef/auth/token` i `/bridge/ksef/invoices/issued|received`, które przyjmują teraz także token aplikacji (`Authorization: Bearer`, `src/lib/supabase/requestClient.server.ts`) z tymi samymi uprawnieniami. Parser wyciągu PDF przeniesiony do `src/lib/bank/pdfStatementParser.server.ts` (wspólny z trasą CRM `/bridge/ksef/bank/parse-pdf`); dopasowania — `src/lib/bankTransactionMatching.ts`, import — te same moduły co w przeglądarce.

### Karta wydarzenia: Rozliczenie i prowizje w panelu bocznym

Zamiast odesłania do CRM w Szczegółach — panel boczny karty (przycisk „Przegląd”, ⌥⌘I) ma u góry przełącznik **Przegląd | Rozliczenie** (zapamiętany na tym Macu), więc rozliczenie jest pod ręką przy każdej zakładce. Przełącznik widzą osoby z dostępem do rozliczenia — jak karta w Szczegółach CRM (obszar rozliczenia albo wartości finansowe). Szczegóły nie powtarzają rozliczenia — jest tylko w panelu bocznym. Panel to „Rozliczenie wydarzenia” i „Sprzedawcy i prowizje” z CRM — edycja w osobnych oknach, żeby wąski panel został czytelny; te same zapisy, warunki i komunikaty:

1. **Rozliczenie wydarzenia** — kto rozlicza (klient, hotel, agencja, inna organizacja) z nabywcą faktury z karty klienta (JST), opiekunowie rozliczenia, sprzedawca pozyskujący wydarzenie, numer PO / zamówienia klienta. „Edytuj…” (administrator, autor albo zarządzanie wydarzeniami): sposób rozliczenia, numer PO (do 200 znaków, zmienna w umowie), organizacja będąca nabywcą z wyszukiwaniem, opiekunowie rozliczenia z jej osób kontaktowych (pierwsza zaznaczona — główna), „Wydarzenie pozyskane przez sprzedawcę” z wyszukiwaniem w kartotece sprzedawców, opisem warunków dla marki i ostrzeżeniami; zapis tylko, gdy przypisanie sprzedawcy nie zmieniło się w innej karcie.
2. **Wspólne rozliczenie** — nazwa, wydarzenia (kliknięcie otwiera wydarzenie) i wydarzenie główne dla faktury; „Połącz wydarzenia… / Edytuj powiązanie…”: wydarzenia tego samego klienta, kontaktu albo płatnika z wyszukiwaniem po nazwie lub dacie, „Rozłącz grupę…” (historia faktur zostaje).
3. **Sprzedawcy i prowizje** — przy otwarciu (finanse / administrator) baza uzupełnia prowizje automatyczne jak w CRM (komunikat i „Odśwież”); sumy (do wypłaty osobom, koszt dla spółki, narzut wypłat gotówkowych) i pozycje: rodzaj beneficjenta i sposób wypłaty, „Z podsumowania” ze źródłem i rodzajem wpisu, powód stawki i anulowania, prowizja opiekuna od zysku (przejście do kalkulacji w Ustaleniach), kwota dla osoby / brutto pracownika / „oczekuje na ofertę”, koszt spółki, status, stawka od podstawy, termin, notatka, „Wyliczenie: zakładka Podsumowanie”. Czynności (menu „…”, „Zarządzanie finansami” albo administrator): prowizja z podsumowania — „Termin i notatka…”, „Anuluj prowizję…” z powodem, „Przywróć”; wpis ręczny — status, „Edytuj…”, „Anuluj prowizję…”. **Dodaj osobę…** — sprzedawca z kartoteki z warunkami marki (kwotę liczy podsumowanie; stawka z oferty prowizyjnej, gdy dotyczy tej osoby; sprzedawca wskazany jako kontakt lub pracownik też przenosi warunki) albo „Inna osoba lub własne warunki”: rodzaj beneficjenta, kartoteka / kontakt / pracownik / osoba spoza bazy, powiązany hotel lub firma, procent od podstawy netto albo stała kwota, sposób wypłaty, modelowy podatek od dywidendy, opis podstawy, termin, notatka i podgląd kwot (osoba otrzyma, koszt dla spółki, narzut podatkowy).

Zakładka „Rozliczenie”: wczytywanie i błędy na środku obszaru treści; gdy nie wczyta się żadna część (finanse ani podsumowanie) — jeden komunikat z „Spróbuj ponownie” zamiast osobnego przy każdej części.

**Zostaje w CRM**: rozliczenia prowizji sprzedawców z kartoteki i kontaktów (hoteli, agencji) — wypłaty częściowe, daty i numery przelewów (odnośnik „Rozliczenia prowizji i historia wypłat”; status „wypłacona” dla osoby z kartoteki otwiera je w CRM, jak w przeglądarce). Prowizje pracowników — zakładka „Prowizje” na karcie pracownika (niżej).

### Karta pracownika: Prowizje — cały dorobek i rozliczenie przy wypłacie

Nowa zakładka **Prowizje** na karcie pracownika (Zespół → pracownik) — wszystkie prowizje pracownika ze wszystkich wydarzeń w jednym miejscu: udział w sprzedaży (z podsumowania wydarzenia), wpisy ręczne dla pracownika (także typu „Sprzedawca”) i prowizje z profilu sprzedawcy powiązanego z pracownikiem — to samo konto co „Rozliczenia prowizji” pracownika w CRM. Zakładkę widzi sam pracownik (własne konto), administrator i osoby z dostępem do finansów (decyduje baza); zapisy — „Zarządzanie finansami” wydarzenia.

1. **Sumy całej historii** (jak w CRM): zarobione / zatwierdzone, wypłacone (przelewy i wypłaty, bez potrąceń), pozostało do wypłaty, planowane (prognoza — przed zatwierdzeniem podsumowania wydarzenia), do potrącenia (nadpłaty z ponownych rozliczeń); wybór marki, gdy prowizje są w kilku; uwagi o wpisach bez dat, rozbieżnościach i nadpłatach. **Wykres miesięczny** — zarobione według daty wydarzenia, wypłacone według daty płatności; rok albo cała historia.
2. **Prowizja od sprzedaży** — status, stawka podstawowa i przy kliencie własnym (własna albo globalna), sposób wypłaty, składki pracodawcy przy wynagrodzeniu; informacja, że bez włączenia prowizja się nie nalicza, nawet gdy pracownik jest sprzedawcą wydarzenia. Administrator: **Zmień warunki…** (jak „Prowizja od sprzedaży” w CRM; po zapisie prognozy otwartych wydarzeń się przeliczają, zatwierdzone rozliczenia zachowują stawki).
3. **Naliczenia i wypłaty** — „Do rozliczenia”, „Wszystkie naliczenia”, „Historia wypłat” z wyszukiwaniem: wydarzenie (kliknięcie otwiera kartę), data i marka, rodzaj wpisu i źródło, podstawa, stawka, udział i powód stawki, termin, „Wyliczenie: rozliczenie wydarzenia”; status (planowana, zatwierdzona, częściowo wypłacona, wypłacona, do potrącenia), sposób wypłaty, kwoty (naliczone, wypłacone z potrąceniami, pozostało). Czynności jak w CRM: **Zatwierdź do wypłaty** (wpis ręczny, z potwierdzeniem), **Zapisz wypłatę…** (kwota, także częściowa, data faktycznej wypłaty, numer przelewu, opis, potwierdzenie wykonania), **Potrąć z prowizji…** (nadpłata z innej prowizji tej samej osoby i marki). Prowizja z podsumowania staje się do wypłaty po zatwierdzeniu podsumowania wydarzenia.
4. **Rozlicz przy wypłacie…** — gdy są prowizje do wypłaty: lista zatwierdzonych prowizji z kwotą do wypłaty (domyślnie z wynagrodzeniem pracowniczym — „lista płac”, do zmiany na inny sposób albo wszystkie), zaznaczanie, **najpierw potrącenia otwartych nadpłat** (podgląd: z której prowizji i ile), suma prowizji, potrącenia i kwota do wypłaty, jedna data wypłaty, numer listy płac (domyślnie „Lista płac MM/RRRR”) i opis, potwierdzenie wykonania. Zapis: potrącenia, potem wypłata pozostałej kwoty każdej prowizji (status „Wypłacona”); wynik dla każdej prowizji. Po niepewnej odpowiedzi „Ponów bezpiecznie” nie zapisze niczego drugi raz.

„Przegląd” karty pracownika: karta „Wynagrodzenie i prowizje” pokazuje stawki prowizji i sumy (zarobione, wypłacone, do wypłaty, prognoza, do potrącenia) z przejściem do zakładki; warunki wynagrodzenia (umowy, stawki) — nadal w CRM. Pulpit sprzedawcy: „Moje prowizje” otwiera własną zakładkę Prowizje.

Serwer: `GET /bridge/native/v1/employees/profile?op=commissions&id=…`, `POST op=commissionApprove|commissionPayout|commissionDeduct|commissionPayroll|commissionTerms` (`src/lib/native/teamCommissions.ts` — `get_commission_settlements`, `record_commission_settlement`, `settle_commission_deduction`, `set_employee_sales_commission_terms`, `get_sales_commission_settings`, `get_my_commissions`; sumy — `buildCommissionSettlementStats` z CRM).

### Prowizje sprzedawców: osoby z hotelu, narzuty i konto sprzedawcy

1. **Dodaj osobę… → Inna osoba lub własne warunki** (panel „Rozliczenie” karty wydarzenia): wybrany „Powiązany hotel / firma” zawęża listę osób do osób tej organizacji (bieżące powiązania kontaktu albo organizacja profilu sprzedawcy; podpowiedź z liczbą osób, osoba spoza organizacji zostaje odznaczona). Po wyborze osoby — **Sprawdzenie w rozliczeniu wydarzenia**: „% od naszego zysku” ze źródłem (stawka ustalona dla wydarzenia, oferta prowizyjna albo kartoteka sprzedawców — marka wydarzenia), ile podsumowanie już jej liczy albo szacunek przy obecnym rozliczeniu (zysk przed prowizjami sprzedawców → podstawa po koszcie prowizji → kwota), brak warunków w kartotece, narzut z jej oferty, wcześniejsze wpisy tej osoby w wydarzeniu. Osoba z kartoteki z warunkami marki — kwotę liczy podsumowanie; bez warunków — wpis ręczny, a podstawą jest domyślnie **zysk z rozliczenia** (przyciski „Zysk z rozliczenia” / „Wartość oferty netto”), nie wartość oferty.
   Podpowiedzi osób — **„Sprzedawcy (zespół i kartoteka)”** (domyślne źródło przy własnych warunkach i przy kwocie dla sprzedawcy): pracownicy z włączoną „Prowizją od sprzedaży” ze stawką z ich karty (np. „5% zysku netto (klient własny 10%) · Wynagrodzenie pracownicze”) i sprzedawcy z kartoteki ze stawką marki. „Pracownik CRM” pokazuje domyślnie tylko pracowników-sprzedawców („Pokaż wszystkich” — pozostali). Wybór pracownika-sprzedawcy ustawia warunki z jego karty: stawkę (klient własny, gdy tak liczy go podsumowanie), sposób wypłaty i podstawę jak w podsumowaniu — zysk netto wydarzenia × jego udział; jeśli jest sprzedawcą wydarzenia, okno pokazuje, ile podsumowanie już mu liczy (zwykle wystarczy zmienić udział w podsumowaniu). Sprzedawca z kartoteki przy kwocie dla sprzedawcy — % od zysku z jego warunków, podstawa jak w podsumowaniu (zysk po koszcie prowizji).
2. **Podsumowanie → Dodaj pozycję → Prowizja / narzut sprzedawcy**: zamiast pozycji kosztu bez osoby — „Wybierz osobę i kwotę…” (okno prowizji ze stałą kwotą, sposobem wypłaty i notatką). Kwota trafia na konto prowizji tej osoby (rejestr wypłat) i jako koszt do podsumowania. Dawna pozycja bez osoby ma ostrzeżenie.
3. **Bez podwójnych wypłat**: druga ręczna prowizja tej samej osoby w wydarzeniu — tylko po zaznaczeniu „To inna należność”; ręczny wpis obok narzutu z jej oferty — odrzucany (aplikacja i serwer). Prowizja z podsumowania nie blokuje: zatwierdzony wpis ręczny ją zastępuje.
4. **Narzut sprzedawcy do wypłaty** (migracja `20261117170000_seller_markup_payouts.sql`): oferta z narzutem w naszej fakturze tworzy wpis „Narzut sprzedawcy (oferta z narzutem)” na koncie sprzedawcy — planowany przed zatwierdzeniem podsumowania, do wypłaty po zatwierdzeniu, z rejestrem wypłat, dopłatą lub potrąceniem przy ponownym rozliczeniu. Kosztem w podsumowaniu pozostaje pozycja narzutu (bez drugiego odjęcia od zysku). Narzut poza naszą fakturą (przez hotel / agencję) — bez wpisu.
5. **Karta sprzedawcy → Prowizje i narzuty**: całe konto sprzedawcy jak zakładka „Prowizje” pracownika — sumy, wykres, rejestr z wyszukiwaniem, zatwierdzenie, wypłata, potrącenie i **Rozlicz wypłatę…** (kilka należności jednym zapisem, najpierw potrącenia nadpłat). Widoczne dla osób z dostępem do finansów (opiekun — dla swoich sprzedawców).

Serwer: `commissionOptions` (karta wydarzenia) zwraca też `settlement` (`get_event_settlement`), `existing`, organizacje osób i stawki ustalone dla wydarzenia; `commissionSave` pilnuje drugiej należności (`allowSecond`). Konto sprzedawcy — `GET /bridge/native/v1/sellers?op=commissions&id=…`, `POST op=commissionApprove|commissionPayout|commissionDeduct|commissionPayroll` (`teamCommissions.ts`, konto `partner`).

Serwer: zakładka `billing` karty wydarzenia — `GET /bridge/native/v1/events/card?op=tab&tab=billing`, odczyty `op=tabQuery&tab=billing&query=organizations|contacts|sellers|settlementEvents|commissionOptions`, czynności `POST op=tabAction`, `tab=billing`, `action=saveBilling|saveSettlement|dissolve|commissionPartner|commissionSave|commissionSchedule|commissionStatus|commissionCancel|commissionRestore` (`src/lib/native/eventBilling.ts`); uzupełnianie prowizji automatycznych wspólne z trasą CRM `/bridge/events/commissions/automatic` (`src/lib/events/automaticCommissions.server.ts`).

**Przed użyciem** — wdrożony CRM z trasami `/bridge/native/v1/finance/bank`, `/bridge/native/v1/finance/saldeo` i nowymi wersjami tras `/bridge/native/v1/finance`, `/bridge/native/v1/events/card`, `/bridge/native/v1/employees/profile`, `/bridge/events/commissions/automatic` oraz `/bridge/ksef/auth/token`, `/bridge/ksef/invoices/issued|received`. Migracje: `supabase/migrations/20261117160000_employee_own_commissions_visibility.sql` — pracownik widzi na własnej karcie (i w „Moich prowizjach” w CRM) także swoje wpisy ręczne typu „Sprzedawca” i prowizje z powiązanego profilu sprzedawcy; `20261117170000_seller_markup_payouts.sql` — narzut sprzedawcy jako należność do wypłaty na jego koncie. Bez nich działa wszystko poza tymi dwiema rzeczami. Kompilacja: `./scripts/build-app.sh` (wersja 0.22.0).

## Aktualizacja 0.21 — Finanse natywnie: Centrum finansów, Terminy i monity, Zamknięcie miesięcy

**Finanse** (`/crm/invoices`) — pozycja menu otwiera ekran natywny zamiast przeglądarki (dla osób z „Podglądem finansów” działalności; bez niego — przycisk do Finansów w CRM). Finanse prowadzi się dla działalności, czyli firm z NIP — marki bez NIP (np. Event Rulers) są pomijane, także w filtrze firm i panelach Finansów w CRM. U góry filtr działalności (jak „Wszystkie firmy” w CRM: na początek domyślna działalność; można zaznaczyć jedną, kilka albo wszystkie — wtedy gotówka, należności, zobowiązania, ZUS i podatki, prognoza i listy terminów są łączone, a przy pozycjach widać działalność; VAT, CIT i zamknięcia miesięcy — osobno dla każdej) i „Odśwież”, z lewej trzy części z „?” (co w niej jest i po co) i liczbą spraw wymagających uwagi oraz skróty do części, które zostają w CRM. Stan każdej działalności jest na dysku (zaszyfrowany, jak pozostałe dane) — ekran pokazuje się od razu, a w tle dociąga świeży stan (najwyżej co 5 minut; ⌘R i „Odśwież” — od razu). Te same funkcje bazy i uprawnienia co CRM.

1. **Centrum finansów** — jak w CRM: kompletność danych (z „Pobierz UPO” — brakujące UPO z KSeF, do 10 na kliknięcie — i przejściami do sekcji), kafle (gotówka z wyciągów, należności, zobowiązania, szacunek VAT, rezerwa CIT), rachunki, zamknięcie poprzedniego miesiąca (lista kontrolna), wiekowanie należności i zobowiązań z największymi pozycjami, ZUS i podatki (najbliższe 45 dni, VAT z przeniesieniem nadwyżki, CIT ze stawką 9% / 19% do wyboru dla „Zarządzania finansami”), prognoza 13 tygodni — wykres salda, tygodnie z wpływami, wydatkami i paskami, rozwijane pozycje z przejściami, przełączniki „Licz zaległe wpływy” i „Licz ZUS i podatki bez przypisanej zapłaty”.
2. **Terminy i monity** — kafle spraw po terminie (kliknięcie otwiera listę), ostrzeżenie o nieaktualnych wyciągach i natywne tabele z sortowaniem w nagłówkach: **ZUS i podatki** (kwota z deklaracji, zapłata, stan; „Pokaż zapłacone z ostatniego roku”; „Obowiązki działalności” — włączanie obowiązków, dzień terminu, przesunięcie), **Należności** (monity; „Wyślij przypomnienie” — e-mail jak w CRM: skrzynka, adresaci z organizacji nabywcy, podgląd ze stopką, PDF faktury w załączniku, planowanie, wpis w historii monitów), **Do zapłaty** (termin z faktury, dostawcy albo wpisany; „Ustaw termin…” z zapamiętaniem dla dostawcy; domyślne terminy dostawców; biała lista VAT — „Sprawdź na białej liście”, z menu także jedna faktura; kopiowanie rachunku), **Przelewy ponad 15 000 zł** (biała lista na dzień przelewu, przypomnienie o ZAW-NR).
3. **Zamknięcie miesięcy** — rok, kafle miesięcy (zamknięty / przekazany i otwarty / otwarty / przyszły, przekazanie księgowej, notatka, historia ponownych otwarć), „Zamknij miesiąc” z notatką i „Otwórz ponownie” z uzasadnieniem (blokadę pilnuje baza).

Powiadomienia o terminach finansowych (`/crm/invoices?tab=external&section=deadlines`) i kafel „Faktury po terminie” na pulpicie otwierają tę sekcję na Macu.

**Zostaje w CRM** (skróty w lewej kolumnie): wystawianie i karta faktury (z pobraniem UPO jednej faktury), KSeF (konfiguracja, synchronizacja), wyciągi i uzgadnianie, deklaracje ZUS i podatków, przekazanie księgowej (Saldeo), koszty i wypłaty, sprzedawcy i prowizje, ustawienia faktur.

Serwer: `GET /bridge/native/v1/finance?op=state|periods|reminder`, `POST op=taxRate|obligations|paymentDue|supplierTermDelete|lock|unlock|whitelist|upoMissing|reminderPreview|reminderSend` (`src/lib/native/finance.ts`) — funkcje bazy tokenem pracownika; biała lista i UPO — wspólna logika z trasami CRM (`src/lib/invoices/vatWhitelist.server.ts`, `src/app/bridge/ksef/upoRequests.ts`).

**Przed użyciem** — wdrożony CRM z trasą `/bridge/native/v1/finance` i migracje finansów z 17.11 (`20261117130000_finance_deadlines.sql` … `20261117150000_vat_whitelist_and_upo.sql`). Kompilacja: `./scripts/build-app.sh` (wersja 0.21.0).

## Aktualizacja 0.20 — Flota, Czas pracy, Bazy danych, Lokalizacje, Strona i Kampanie e-mail natywnie

Kolejne sekcje menu CRM działają na Macu bez przeglądarki — te same tabele, funkcje bazy, reguły dostępu i komunikaty co w CRM. Szczegóły zmian (także poprawione błędy CRM) — `docs/mobile-parity.md`.

**Flota** (`/crm/fleet`) — lista (Kafelki, Lista, Timeline), statystyki, filtry, szybkie tankowanie; karta pojazdu: użytkowanie z „Zakończ użytkowanie”, alerty, Informacje z właściwościami i wymaganym prawem jazdy, Timeline, Tankowania, Serwis i naprawy, Ubezpieczenia, Historia użytkowania, Galeria; dodawanie i edycja pojazdu tym samym pełnym formularzem. Karta pojazdu z logistyki wydarzenia otwiera się w aplikacji.

**Czas pracy** (`/crm/time-tracking`) — wymiar czasu pracy miesiąca, licznik (start/stop z zadaniem albo własnym tytułem i umową), moje wpisy z edycją (kontrola wersji), historią zmian, rozmowami „do wyjaśnienia” i usuwaniem; rozliczenie czasu pracy (zastosowanie, historia, cofnięcie) i wynagrodzenie z umów (naliczenia, salda, przypisanie umowy); dla administratora raport zespołu (okresy, filtr pracownika, CSV, aktywne liczniki, aktywność dzienna) i strona pracownika (lista dniami albo tabela, historia zmian i usunięć). Powiadomienie o rozmowie otwiera wątek.

**Bazy Danych** (`/crm/databases`) — lista z wyszukiwaniem, tworzenie, udostępnianie pracownikom, usuwanie; arkusz z edycją komórek w miejscu, kolumnami (typ, nazwa, szerokość, kolejność, usuwanie), rekordami, eksportem CSV, PDF i wydrukiem. Arkusz zajmuje całe okno (pasek boczny chowa się na czas pracy z bazą i wraca po wyjściu), tabela wypełnia szerokość jak w CRM, „Pełny ekran” przełącza pełny ekran okna. Bazy danych to tabele w CRM — nie mają plików ani folderu w Finderze („Mavinci” w Finderze obejmuje pliki wydarzeń).

**Lokalizacje** (`/crm/locations`) — lista (Siatka, Lista, Tabela; wyszukiwanie, miasto, sortowanie) i — tylko w aplikacji — **Mapa** z pinezkami obiektów (te same filtry; karta obiektu po kliknięciu pinezki, mapa / satelita, „Pokaż wszystkie”, lista obiektów bez punktu na mapie), pełny formularz obiektu z wyszukiwarką miejsc Google i mapą, szczegóły obiektu z mapą, salami i przestrzeniami zewnętrznymi oraz informacjami technicznymi (wymiary, prąd i przyłącza 230/400 V, opisy, rzuty i zdjęcia). Lokalizacja i „Zarządzaj salami obiektu” na karcie wydarzenia otwierają szczegóły w aplikacji.

**Aktualizacja — Lokalizacje: „Tło ofert”.** Obiekt (np. hotel) może mieć zdjęcie w tle dla ofert — sekcja **„Tło ofert”** w szczegółach lokalizacji i w „Sale i przestrzenie” na karcie organizacji-hotelu (z uprawnieniem do zarządzania lokalizacjami): **Wgraj zdjęcie…** (JPG, PNG, WebP do 20 MB — do materiałów lokalizacji), **Wybierz z galerii** (zdjęcia obiektu i sal z informacji technicznych), **Usuń tło** (zdjęcie zostaje w materiałach). Okładka oferty bez własnej grafiki hero bierze tło miejsca wydarzenia — także gdy klientem jest inna firma (impreza firmowa klienta w hotelu Marina: oferta dla firmy, w tle Marina). Miejscem jest pierwsza ustawiona lokalizacja: wydarzenia, z zapytania, organizacji klienta; gdy ta lokalizacja nie ma tła — grafika szablonu jak dotąd. Kolejność okładki: własna grafika oferty → tło miejsca → grafika kategorii szablonu; oferty sprzedawców i pokazowe — okładka z profilu sprzedawcy, bez zmian. Karta oferty pokazuje źródło grafiki („Tło lokalizacji „…” (miejsce wydarzenia)”) z podglądem. Nowe PDF ofert dostają tło przy następnym generowaniu; PDF wygenerowany przed zmianą tła (dodanie, zmiana, usunięcie) jest oznaczony jako nieaktualny („Po wygenerowaniu PDF zmieniono „Tło ofert” lokalizacji „…””) — wysyłka po ponownym wygenerowaniu, jak przy zmianach oferty. Zdjęcie wgrane jako tło trafia też do galerii obiektu (najwyżej 30 materiałów — przy pełnej galerii komunikat przed przesłaniem). Miejsce wybrane w ofercie z listy lokalizacji („Miejsce wydarzenia”) jest pierwsze w kolejności miejsc okładki. Gdy okładka nie ma tła miejsca, karta oferty podpowiada, co zrobić: lokalizacja bez tła — „Otwórz lokalizację”; miejsce wpisane ręcznie, ale zgodne z lokalizacją z bazy — „Powiąż z lokalizacją „…””. Wymaga migracji `20261119150000_location_offer_background.sql` (do tego czasu sekcja informuje o aktualizacji bazy, a oferty działają jak dotąd) i wdrożenia CRM. Kod: `Locations/LocationOfferBackgroundPanel.swift`.

**Strona** (`/crm/page?tab=website`) — Struktura strony (odwiedziny podstron), Marketing i ADS (marka, synchronizacja, przegląd, kampanie, wiadomości, analiza AI), Analityka (okresy, „Online teraz”, wykresy, top 10, reset statystyk z hasłem) i Schema.org (dane globalne, obszary obsługi, miasta, wyjątki odmiany).

**Kampanie e-mail** (`/crm/campaigns`, Marketing → Kampanie e-mail) — Centrum Kampanii: lista kampanii, nowa wersja robocza, dane wiadomości (konto nadawcze, szablon, tekst podglądu, temat, treść HTML, pomiar otwarć i kliknięć), odbiorcy (segmenty, rodzaj klienta, typy wydarzeń, regiony, budżet, „Przelicz”), pełny podgląd kwalifikacji (wszyscy odbiorcy, także ponad 1000), wysyłka testowa, przekazanie do zatwierdzenia i zatwierdzenie, kontrolowana kolejka (termin, partie, odstęp), wstrzymanie, wznowienie, anulowanie, liczniki wysyłki odświeżane co 15 s, podgląd wiadomości oraz demo kampanii z broszury (statystyki, PDF przypisany do kampanii). Zapis tylko, gdy kampania nie zmieniła się w międzyczasie; niezapisane zmiany nie giną przy przejściu do innej kampanii. Szkic kampanii utworzony z broszury otwiera się w aplikacji. Układ: opis w nagłówku najwyżej w dwóch wierszach, pole „Treść HTML” o stałej wysokości (jak 14 wierszy w CRM, dłuższa treść przewija się w polu); wysokość ekranu sekcji nie wymusza już wysokości okna — wcześniej Centrum Kampanii powiększało okno ponad ekran i cała zawartość razem z paskiem bocznym przesuwała się w górę.

**Zapytania — kalkulacje i kalendarz** — zakładka „Kalkulacje” karty zapytania jak w CRM: lista („Utwórz kalkulację”, „Wybierz kalkulację”, Otwórz, Duplikuj, Generuj PDF, Pokaż PDF, Pobierz PDF; liczba pozycji, suma netto, „PDF gotowy” / „Robocza”) i ten sam edytor co w wydarzeniu (pozycje z magazynu, produkty, pojazdy z kalkulatorem trasy, import z ofert zapytania, kolejność, PDF, wydruk, wysyłka e-mailem) z kontekstem zapytania po lewej (klient, termin, miejsce, zakres, treść wiadomości). Nowa kalkulacja (także przycisk „Kalkulacja” w nagłówku) otwiera się od razu w edytorze; bez prawa prowadzenia zapytania edytor jest tylko do podglądu. PDF kalkulacji zapytania bez wydarzenia zapisuje się przy zapytaniu, z wydarzeniem — w Plikach wydarzenia (Kalkulacje). Kalendarz: dodawanie jak w CRM — „Dodaj” (⌘N), „+” w dniu po najechaniu, dwuklik w dzień albo menu pod prawym przyciskiem otwiera „Co chcesz dodać?” (wydarzenie biznesowe / indywidualne — kreator z terminem tego dnia, spotkanie — formularz 9:00–10:00, zapytanie — formularz „Nowe zapytanie” z terminem tego dnia, natywnie); pod siatką miniatury dwóch kolejnych miesięcy (kropka — dzień z wpisami, klik — przejście do dnia, dwuklik — dodawanie). Kalendarz pokazuje potencjalne zapytania jak w CRM (termin z zapytania, bez wydarzenia, bez wygranych i przegranych; przełącznik „Potencjalne zapytania”), kliknięcie otwiera kartę zapytania; dwuklik na zapytaniu w lejku też otwiera kartę.

**Także w tej wersji** — Flota: rodzaj polisy „OC + AC” (jedna polisa z obiema ochronami; zalicza się do obowiązkowego OC w alertach i statusie pojazdu). Lokalizacje: stabilna mapa (bez drżenia pinezek przy ruchu myszy — płaska mapa, stały kadr do czasu zmiany listy). Kalkulacje: „Drukuj” w edytorze drukuje zapisaną treść bez dodawania pliku; okno „Dodaj pozycję” (wydarzenie i zapytanie) otwiera się dużo szersze (do 1440 pkt, nie więcej niż ekran) — cała tabela sprzętu bez przewijania w bok, okno można powiększać (tak samo „Importuj z oferty”); w tabeli „Z magazynu” cenę netto wpiszesz przy każdym sprzęcie (domyślnie cena rentalna; także gdy sprzęt jej nie ma); kolejność pozycji w edytorze zmienia się jak w CRM — uchwytem ≡ (przeciągnij na inną pozycję sekcji) albo „Przesuń wyżej / niżej” w menu pozycji; sprzęt, który już jest w kalkulacji, ma zieloną kropkę („Już w kalkulacji: N szt.”), a jego dodanie zwiększa ilość istniejącej pozycji zamiast tworzyć drugą linię z tym samym sprzętem (nazwa, cena, dni i VAT bez zmian; tak samo w CRM); lista „Z magazynu” pokazuje cały sprzęt z dostępnym stanem (wcześniej stan liczony z pierwszych 1000 egzemplarzy — część sprzętu miała stan 0 i znikała; poprawione też w CRM). Kalendarz: wydarzenie kończące się po północy najpóźniej o 5:00 zajmuje tylko dzień rozpoczęcia (w widoku miesiąca nie wygląda jak dwa zarezerwowane terminy) — ta sama reguła w CRM, aplikacji mobilnej i na Macu (`src/lib/CRM/calendar/calendarDays.ts`). Magazyn: kategorie po lewej, wyraźne przyciski dodawania w każdej sekcji, nowy sprzęt w tej samej pełnej karcie co edycja (jednostki, stan, galeria i pliki od razu); naprawiony zapis karty sprzętu. Kalkulacje wydarzenia: dodawanie wielu pozycji naraz z magazynu (jak sprzęt w checkliście). Karta wydarzenia: naprawione usuwanie kalkulacji i innych pozycji zakładek (identyfikator wydarzenia przekazywany osobno).

**Zostaje w CRM** (przycisk otwiera właściwe miejsce w przeglądarce), m.in.: sekcja Finanse (faktury, rozliczenia — kolejny etap); połączenia kont marketingowych i ustawienia marki (logowanie u dostawcy); baza sal i kontaktów hotelu (ustawienia organizacji); karta i nowy podwykonawca, kategorie wydarzeń, lokalizacje magazynu; rozmowa, ustawienia, ceny indywidualne, rozliczenia i tryb pokazowy w „Sprzedawcach”; nowe zapytanie i SLA, nowy kontakt, pełne szczegóły zadania; ustawienia CRM; Mavinci LIVE (ukryte na Macu); pliki wydarzeń w Finderze — w przygotowaniu.

**Przed użyciem** — wdrożony CRM z nowymi trasami natywnymi: `/bridge/native/v1/fleet`, `/time`, `/databases`, `/locations`, `/website`, `/campaigns` oraz zmianami w `/warehouse` (zapis i tworzenie sprzętu), `/events/card` (identyfikator wydarzenia), `/inquiries` (kalkulacje zapytania: `calcQuery`, `calcAction`, `calcEmail`; termin i klient w lejku dla kalendarza), `/bridge/events/calculation-pdf` (kalkulacje zapytań, `GET` — wydruk bez zapisu) i kalkulacjach (`addItems`); analiza AI marketingu korzysta ze wspólnej funkcji `src/lib/marketing/insight.server.ts`. Nowa migracja: `supabase/migrations/20261117100000_insurance_oc_ac_policy.sql` (rodzaj polisy „OC + AC” — bez niej zapis takiej polisy odrzuci baza); nadal wymagane migracje z 0.19. Kompilacja: `./scripts/build-app.sh` (wersja 0.20.0).

## Aktualizacja 0.19 — aktualny zakres natywny

Od 0.18 na Macu natywnie działają także umowa wydarzenia, nowe wydarzenie i jego edycja, ustalenia sprzedawcy z kreatorem przygotowań, kalkulator trasy w logistyce oferty, karta zapytania, a wcześniej (bez opisu w tym pliku) — Oferty, Produkty, Szablony ofert i Broszury. Te same funkcje bazy, reguły i uprawnienia co w CRM; zapis z kontrolą wersji tam, gdzie ma ją CRM.

**Oferty** — lista z kopii na dysku i strona oferty: informacje podstawowe, założenia (z „Zaproponuj z AI”), rabat całej oferty, kolejność pozycji (przeciąganie), dodawanie i edycja pozycji z cenami wariantów, pakiety (sprzęt, obsada i koszty realizacji, ceny tylko w tej ofercie), konfigurator sceny i LED, wymagania techniczne, propozycje dodatkowe, logistyka (kwota ręczna albo kalkulator szacunkowy; wiersz „Paliwo” z kalkulatorem trasy: miejsce startu, cel z wydarzenia / oferty albo z katalogu lokalizacji, trasa Google Maps tam i z powrotem, średnia cena paliwa AutoCentrum albo ręczna, spalanie), PDF PL / EN z postępem i podglądem w oknie aplikacji, wysyłka e-mailem (skrzynki, podgląd, „Redaguj AI”, planowanie), powiązanie z wydarzeniem lub zapytaniem, aktualizacja zaakceptowanej oferty, rezerwacja sprzętu i akceptacja (także bez rezerwacji), kreator „Nowa oferta” z gotowością produktów. **Szablony ofert** — kategorie, kreator wyglądu, tła PDF, pola danych i tabela wyceny.

**Produkty** — karta produktu z kolumną boczną gotowości: warianty, przygotowanie i zamówienia, wymagania, powiązane usługi, dodatki, pakiety sprzedaży, sprzęt i obsada, wersja angielska, kadrowanie zdjęć w PDF, opisy AI. **Broszury** — lista, edytor ze Studiem stron, podgląd i PDF, wysyłka mailem z historią, demo i statystyki, broszury w karcie klienta.

**Zapytania** — karta zapytania jak `/crm/inquiries/[id]`: treść bez stopek i cytatów, ustalenia, klient, prowadzenie sprzedaży, korespondencja (dołączanie wiadomości i wątków), e-mail ze skrzynki firmy, AI, zespół, utworzenie wydarzenia.

**Wydarzenia** — „Nowy event” (kreator: szczegóły z walidacją jak w CRM, nowa osoba kontaktowa i lokalizacja, nietypowe dni, oferta w kreatorze oferty Maca z budżetem z oferty, przejście do sprzętu) i „Edytuj” — zmiana nazwy eventu (jak w CRM: zapisuje tylko nazwę, termin, lokalizację, klienta, firmę, kategorię i status zmienia się przy polach w Szczegółach). Zakładka „Oferta”: wysyłka i rezerwacja sprzętu; „Kalkulacje”: wysyłka e-mailem z PDF i plikami wydarzenia.

**Umowa wydarzenia** — umowę składa ten sam kod co CRM (silnik dokumentów w Chrome na Macu): podgląd stron i PDF na Macu, pola i warunki (także z formatowaniem), depozyt, uwagi przed wystawieniem i wystawienie, klauzule tej umowy (wyłączanie, zmiana treści, „Przywróć oryginał”, ustalenia dla wydarzenia, rozbieżne wersje), zmiana szablonu, wysyłka e-mailem, edycja treści (edytor w WebKit: formatowanie, listy, wcięcia, nowy paragraf, wklejanie jako tekst), audyt AI umowy i klauzul z przeglądem zmian, anulowanie hasłem administratora (hasło tylko do weryfikacji na serwerze, nie jest zapisywane). **Szablony umów** — przekształcanie starszego formatu i scalanie szablonów.

**Ustalenia sprzedawcy** (zakładka „Ustalenia”) — dla oferty sprzedawcy: przygotowanie wydarzenia z przejściami do sekcji karty i okno „Potwierdź realizację” (dane wydarzenia, terminy, miejsce z bazy lokalizacji, kategoria, opis, osobne potwierdzenie); kreator przygotowań krok po kroku (kontakt na miejscu, miejsce i organizacja, materiały i wymagania, plan realizacji, zatwierdzenie przygotowań — szkic, przekazanie, zatwierdzenie, prośba o poprawki, historia kroku; ponowienie zapisu nie dubluje); dodatkowe ustalenia realizacji (sala z bazy hotelu lub wpis ręczny z planami przestrzeni, uczestnicy, dni i godziny także przez północ, montaż i demontaż, termin materiałów, wymagania, kontakty organizacyjne i z bazy hotelu, klient i zespół) oraz rozmowa o realizacji. Zmiana oferty i zwinięcie ustaleń nie gubią niezapisanych danych; powiadomienia otwierają wskazaną ofertę i krok, a w „Sprzedawcach” „Potwierdź realizację” prowadzi do tej zakładki.

**Spotkania** — po odpowiedzi na zaproszenie zostaje „Twoja odpowiedź” z „Zmień odpowiedź”.

**Zostaje w CRM** (przycisk otwiera właściwe miejsce w przeglądarce), m.in.: konfiguracja KSeF (wystawianie faktur, pro form, zaliczek, korekt i faktury końcowej, edycja, faktura z pro formy, PDF, e-mail, KSeF i UPO — natywnie); umowy zlecenia podwykonawcy („Sprzedawcy” — w całości natywnie: kokpit, karta, rozmowa, historia zmian, ustawienia, indywidualne ceny, branding i wizytówka, rozliczenia, tryb pokazowy i „Mianuj sprzedawcą” z karty kontaktu; branding ofert i sale hotelu na karcie organizacji — także); pełne szczegóły zadania; ustawienia CRM (konta e-mail, poziomy dostępu; „Dostosuj dashboard” — natywnie); Mavinci LIVE (ukryte na Macu); pliki wydarzeń w Finderze — w przygotowaniu. Ostatni etap: poprawki sekcji finansów (Rozliczenie).

**Przed użyciem** — wdrożony CRM z bieżącymi trasami natywnymi (`/bridge/native/v1/…`, `src/lib/native/*`) i silnikiem dokumentów (`/native-engine/contracts`); starszy CRM nie zna nowych operacji (komunikat o nieznanej operacji albo „zaktualizuj CRM”) — wtedy najpierw wdrożenie CRM. Migracje uruchamia administrator, m.in. `supabase/migrations/20261116170000_meeting_first_answer_notifies_organizer.sql` (odpowiedzi na zaproszenia) i `supabase/migrations/20261116190000_contract_clause_cleanup_backups.sql` (porządkowanie klauzul). Kompilacja: `./scripts/build-app.sh` (wersja 0.19.0).

## Aktualizacja 0.18 — Karta wydarzenia (etap 4): wszystkie zakładki natywnie

Wszystkie zakładki karty (poza Mavinci LIVE) działają na Macu natywnie — te same zapytania, funkcje bazy i reguły co CRM, kopia na dysku ze skrótem, zapisy z paskiem postępu i komunikatem.

- **Sprzęt, Logistyka, Harmonogram** — jak w poprzednich etapach (lista z dostępnością, checklista, pojazdy z trasą i kosztem paliwa, przekazania, oś faz z obsadą).
- **Agenda / Karta weselna** — edycja, PDF **na Macu** (Chrome), zapis w Plikach; karta weselna: sekcje, odpowiedzi, osoby i harmonogram.
- **Podwykonawcy** — zadania z walidacją, umowy (plik prosto do magazynu), wytyczne (generowanie i wysyłka).
- **Pliki** — drzewo folderów, lista / siatka / miniatury, przeciąganie z Findera, kopiuj / wytnij / wklej, zmiana nazwy, usuwanie, Quick Look, pobieranie.
- **Zadania** — tablica zadań wydarzenia (kolumny, przypisania z dopisaniem do zespołu, timer).
- **Oferta** (lista, usuwanie), **Historia** (oś czasu i widok po dacie), **Podsumowanie** (rozliczenie wydarzenia), **Finanse** (koszty, prowizje, plan płatności i raty, zamknięcie, faktury, gotówka), **Ustalenia** (rozmowa ze sprzedawcą).
- **Kalkulacje** — lista (suma, PDF, akceptacja), edytor z sekcjami, sumami, mocą i wagą, kolejnością (przeciąganie), pozycje z magazynu (stan), usługi personelu, pojazdy z kalkulatorem trasy i stawki paliwa, import z oferty; **PDF na Macu** do Plików → Kalkulacje, podgląd / pobierz / drukuj.
- **Umowa** — status z datami, podpis firmy, PDF bieżący i archiwalne, podpisane dokumenty (dodawanie PDF / JPG / PNG). Edytor treści umowy (dane, klauzule, szablon, depozyt, audyt AI, wystawienie, PDF, wysyłka, anulowanie) zostaje w CRM — treść składa edytor przeglądarki z bieżących danych. **Od 0.19 — natywnie na Macu** (zob. „Aktualizacja 0.19”).
- **Szczegóły** — zmiana klienta (indywidualny / firma, osoby kontaktowe) i nowa lokalizacja (wyszukiwanie Google, punkt na mapie).

**Lista wydarzeń** — natywna tabela narzędziowa jak w Wodawo: piktogram kategorii zamiast kolorowych odznak, Lp., sortowanie w nagłówkach kolumn (nazwa, termin, klient, miejsce, kategoria, status, rozliczenie, budżet), status jako kropka z opisem, zaległe płatności — czerwona etykieta z wykrzyknikiem, wyszukiwanie i „Pokaż” (Aktywne / Wszystkie / status) nad tabelą, karta zaznaczonego wydarzenia z boku (⌥⌘I); dwuklik albo ↩ otwiera kartę wydarzenia. Zespół realizacji widzi etapy operacyjne bez kwot.

**Karta wydarzenia na całą szerokość** — pierwsza zakładka to Szczegóły (informacje podstawowe, opis i notatki po lewej, akcje i budżet w środkowej kolumnie obok panelu Przeglądu), Przegląd (najważniejsze, kroki realizacji, kontrola przed wydarzeniem) to panel z boku przy każdej zakładce (przycisk „Przegląd”, ⌥⌘I). Zakładki w kolejności pracy sprzedawcy, pokrewne połączone z przełącznikiem: Szczegóły · Oferta i kalkulacje · Umowa · Sprzęt · Zespół i podwykonawcy · Harmonogram · Logistyka · Agenda · Ustalenia · Finanse i rozliczenie · Zadania · Pliki · Historia.

**Sprzęt** — zwarte wiersze z miniaturami; kliknięcie miniatury otwiera okienko z powiększonym zdjęciem i szczegółami (status, ilość w wydarzeniu, magazyn i rezerwacje, ile można dodać, zawartość zestawu, długość przewodu, przejście do karty sprzętu). Status jako kropka z opisem. Okno „Dodaj sprzęt” otwiera się od razu z kopii na dysku: katalog z dostępnością w terminie wydarzenia jest zbiorem synchronizowanym koszykami — w tle sprawdzany jest skrót i pobierane tylko zmienione koszyki (także po wejściu w zakładkę Sprzęt i po każdym dodaniu).

**Zespół i podwykonawcy jako natywne listy** — Zespół: tabela ze zdjęciem, Lp., osobą (korona przy kierowniku realizacji), rolą, zakresem obowiązków, statusem (kropka) i zaproszeniem; czynności w menu „…” i pod prawym przyciskiem (karta pracownika, kierownik realizacji, zaproszenie, timeline, rola i obowiązki w osobnym oknie, uprawnienia, usuwanie), dwuklik otwiera kartę pracownika. Podwykonawcy: przełącznik Zlecenia / Umowy; zlecenia w tabeli (miniatura sprzętu albo inicjały podwykonawcy, Lp., podwykonawca, zlecenie, termin, koszt, status, wytyczne, płatność) ze szczegółami zaznaczonego zlecenia pod spodem (regulowany podział), dwuklik — edycja; umowy w tabeli z podglądem pliku (dwuklik). Wynajem bez podwykonawcy oznaczony na pomarańczowo.

**Zarządzanie sprzętem** — przycisk „Zarządzaj sprzętem” otwiera jedno okno zamiast „Dodaj sprzęt”: z lewej Cały katalog / W wydarzeniu / Zestawy / kategorie, w środku tabela z miniaturami (podgląd zdjęcia, stanów i zawartości zestawu po kliknięciu), dostępnością w terminie (kropka) i kolumną „W wydarzeniu” z − / + i polem do wpisania liczby. Dodawanie, zmiana ilości i usuwanie (0) w jednym miejscu; dwuklik albo ↩ dodaje 1 szt., klawisze + / − zmieniają zaznaczoną pozycję, „Dodaj z notatką…” pod prawym przyciskiem. Zmiany zapisują się od razu (seria kliknięć to jeden zapis po 0,6 s, zapisy po kolei), komunikat na dole ma „Cofnij”. Na liście sprzętu wydarzenia: ilość z − / + bezpośrednio w wierszu, zaznaczanie klikiem / ⌘-klikiem / ⇧-klikiem, ⌫ usuwa zaznaczone, ⌘A zaznacza wszystko, Esc czyści; menu „…” i prawy przycisk: podgląd, karta sprzętu, zamiana, wynajem, komponenty, zawartość zestawu na checkliście, usuń / przywróć. Usuwanie bez pytania — z „Cofnij” (pozycja z oferty wraca przez przywrócenie, dodana ręcznie — ponownym dodaniem, bez notatki).

Okno „Zarządzaj sprzętem” zajmuje prawie całe okno aplikacji; pozycje dodane do wydarzenia są na górze listy; kolumny „W terminie” i „Inne wydarzenia”. Pod tabelą szczegóły zaznaczonej pozycji (zdjęcie, opis, zawartość zestawu, stany) i „Kto rezerwuje w tym terminie”: wydarzenia nakładające się z terminem, ilość, autor wydarzenia z e-mailem (gotowy temat) i telefonem, przejście do karty tamtego wydarzenia. Wydarzenia poza zakresem widoczności użytkownika liczone są bez nazwy. Na liście sprzętu: „Kto ma?” przy brakach i „Kto rezerwuje w tym terminie?” w menu otwierają okno na tej pozycji. Serwer: `tabQuery equipment/reservations` (`equipment_bookings` dla sprzętu, `event_equipment` dla zestawów — te same źródła co `check_equipment_inventory_for_event`).

**Ustalenia sprzedawcy w pracy realizacji** — ustalenia ofert powiązanych z wydarzeniem (`seller_offer_arrangements`: montaż, start, koniec, demontaż, dni wydarzenia, sala, liczba osób, wymagania techniczne i logistyczne, kontakty na miejscu, termin materiałów) są widoczne bez kwot dla każdego, kto widzi wydarzenie: karta „Ustalenia sprzedawcy” na górze Przeglądu (fakty, kontakty z telefonem i e-mailem, wersja i autor zmian, stan potwierdzenia kierownika realizacji, przycisk „Zapoznałem się z ustaleniami” / „…ze zmianami”) oraz zwijany pasek „Ustalenia sprzedawcy” w zakładkach Harmonogram (terminy), Agenda (godziny, dni, sala, osoby), Sprzęt (wymagania techniczne), Logistyka (wymagania logistyczne, miejsce, materiały) i Zespół (kontakty na miejscu). Zmiana ustaleń po potwierdzeniu — oznaczenie „zmienione po potwierdzeniu”. Wymaga migracji `supabase/migrations/20261111220000_event_arrangements_handoff.sql` (tabela potwierdzeń, `get_event_arrangements`, `acknowledge_event_arrangements`); bez niej karta pokazuje komunikat o migracji.

**Harmonogram krok po kroku** — nad osią pasek „Przygotowanie harmonogramu” (zwijany) z pięcioma krokami i stanem każdego: ① Fazy — „Utwórz z umowy i ustaleń” tworzy brakujące fazy Montaż / Realizacja / Demontaż (montaż od terminu z ustaleń sprzedawcy albo umowy do startu wydarzenia, realizacja w terminie wydarzenia, demontaż od końca lub terminu demontażu przez domyślny czas typu fazy; bez nakładania na istniejące fazy, z podglądem godzin przed zapisem); ② Zespół na fazach — „Dopasuj do faz” przypisuje osoby bez godzin do faz pracy (bez załadunku i rozładunku), osoby z konfliktem lub nieobecnością pomija i wymienia; ③ Auta — liczba aut bez fazy, „Czasy przejazdu” i przejście do Logistyki; ④ Kontrola — nakładające się fazy, osoby bez godzin, auta bez fazy; ⑤ Wysyłka — „Wyślij zespołowi” wysyła aktualny harmonogram każdej osobie przypisanej do faz (zablokowane przy nakładaniu się faz). Te same zapisy co ręcznie.

**Pasek zakładek zawsze w oknie** — gdy pełne nazwy się nie mieszczą (np. z panelem Przegląd), nazwę ma tylko aktywna zakładka, a pozostałe są ikonami z podpowiedzią; przy jeszcze węższym oknie same ikony, w ostateczności przewijanie z widocznym paskiem. Skróty: ⌘⇧[ / ⌘⇧] oraz ⌃⇧⇥ / ⌃⇥ — poprzednia / następna zakładka.

**Pasek boczny zawsze widoczny** — karta wydarzenia nie wymusza minimalnej szerokości (`frame(minWidth: 0)` przed panelem Przegląd), więc szerokie zakładki (Agenda, Sprzęt) nie chowają paska bocznego aplikacji; Agenda: węższe minimum programu i uwag, zaznaczenie punktu w kolorze motywu zamiast systemowego niebieskiego, bez pustych pasków pod listą.

**Pomoc przy etapach** — przy każdym kroku „Przygotowania harmonogramu” i przy każdej sekcji Rozliczenia jest przycisk „?” z opisem, co robi dany etap i po co (okienko obok przycisku).

**Mavinci LIVE wyłączone na Macu** — pozycja menu i zakładka karty wydarzenia są ukryte w aplikacji (`Workspace.hiddenModules`, filtr zakładek karty); CRM w przeglądarce bez zmian.

**Instrukcja dla użytkowników** — dokument „Mavinci na Maca — instrukcja” (Claude Docs) opisuje każdą część aplikacji: co robi i po co.

**Ustalenia (zakładka)** — oferty sprzedawców jako natywna lista z boku (wyszukiwanie, nieprzeczytane), po prawej karta ustaleń z potwierdzeniem i rozmowa. Prowizje w Rozliczeniu: rodzaj beneficjenta i status jako kropka.

**Rozliczenie** — Finanse i Podsumowanie to jedna zakładka „Rozliczenie”. U góry pasek wyników: przychód netto, koszty, marża (kwota i %), prowizje i zysk po prowizjach — wykonanie z podsumowania wydarzenia, plan z finansów (zaakceptowana oferta / kalkulacja); kliknięcie przenosi do sekcji. Z lewej sekcje w kolejności przepływu pieniędzy: Przychody (klient, sposób rozliczenia i terminy płatności, faktury, przychody netto podsumowania), Koszty (koszty wydarzenia, budżet gotówkowy dla admina, koszty netto podsumowania: wykonawcy, koszty bezpośrednie, ekipa), Marża i wynik (strata, kafle, rentowność plan / wykonanie, wynik podsumowania), Prowizje (rejestr prowizji i poleceń, wyliczenie prowizji pracowników i sprzedawców, podział udziałów, narzuty zewnętrzne), Zamknięcie (stan i obieg podsumowania, zamknięcie wydarzenia, historia). Te same czynności i uprawnienia co wcześniej, bez powtórzeń między sekcjami.

**Agenda jako scenariusz** — punkty programu w kolejności z godziną, czasem trwania (w godzinach; − / + co 5 min albo gotowe wartości) i godziną końca; edycja w miejscu bez trybu „Edytuj”, zapis od razu (po chwili bez zmian, stan zapisu w nagłówku; puste pola wstrzymują zapis). Przeciągnięcie punktu albo „Przenieś wyżej / niżej” zmienia kolejność i przelicza godziny kolejnych punktów; godzina pierwszego punktu przesuwa cały program, godzina dalszego punktu zmienia czas trwania poprzedniego; „Wstaw punkt poniżej”, „Duplikuj”, ⌘↩ — nowy punkt, ⌫ — usunięcie z „Cofnij”. Godzinę można wpisać jako „19”, „1930” albo „19:30”. Uwagi w panelu obok, PDF w menu „PDF”. Baza bez zmian: kolejność w `order_index`, godziny w `time`, koniec programu w `event_agendas.end_time`.

**Harmonogram** — oś faz zaczyna się od góry (przewijanie w dwóch osiach nie centruje już mniejszej treści, bez pustego pasa nad fazami); czasy trwania w godzinach — „2 h (120 min)” w oknie fazy i przy typach faz, „4 h” / „3 h 15 min” na osi.

**Pozostałe listy karty jako natywne tabele** — Oferty (Lp., numer, klient, status-kropka, brutto, netto, ważność; dwuklik otwiera ofertę), Kalkulacje (status, PDF, pozycje, suma; dwuklik — edytor), Historia zmian (autor, kiedy, czynność, dotyczy, opis, przed → po; filtr rodzaju, szczegóły zaznaczonej zmiany pod tabelą, dwuklik — karta osoby), a w panelach Finansów i Logistyki — wiersze z wyrównanymi kolumnami i nagłówkiem: faktury, koszty (kropka statusu, czynności w „…” i pod prawym przyciskiem), pojazdy (miniatura, kierowca, wyjazd, dystans, koszt, status, konflikt na czerwono; dwuklik — edycja) i harmonogram logistyczny. Pliki — do omówienia osobno.

W CRM pozostają: kreator i wysyłka oferty, wysyłka kalkulacji e-mailem, edytor umowy, faktury z wydarzenia, sposób rozliczenia i panel prowizji w Szczegółach, folder Mac / iCloud, Mavinci LIVE. (Stan wersji 0.18 — aktualna lista w „Aktualizacji 0.19”; kreator i wysyłka oferty, wysyłka kalkulacji i edytor umowy działają już natywnie.)

## Aktualizacja — Sprzedawcy: kokpit opiekuna i karta sprzedawcy

**Sprzedawcy** (`/crm/salespeople`) — natywnie zamiast przeglądarki:
1. **Kokpit opiekuna**: kafelki (sprawy na dziś, sprzedawcy, oferty w toku, wydarzenia w 14 dni, do wypłaty), **Dziś** w tych samych grupach co CRM (ceny do zgody, oferty do sprawdzenia, kroki realizacji, wydarzenia do potwierdzenia, rozmowy, zapytania klientów — **Odpowiedz** i **Utwórz zapytanie CRM**, akceptacje klientów), **oferty na osi** w 5 etapach (Oferta → U klienta → U opiekuna → Wydarzenie → Rozliczenie — te same nazwy widzi hotel), najbliższe wydarzenia, ostrzeżenia. Administrator wybiera opiekuna.
2. **Lista sprzedawców i karta**: **Gotowość do pracy** (te same kroki co CRM; **Wyślij zaproszenie ponownie**), opiekun i konto w portalu, marki i widoczność prowizji, **oferty na osi** w widoku opiekuna (z filtrem etapów i zdaniem „Teraz”), realizacje. Oferta otwiera się w karcie oferty, wydarzenie — w karcie wydarzenia.
3. **Instrukcja opiekuna** (znak „?”) — ta sama treść co w CRM.
4. **Ocena oferty z portalu** w karcie oferty: oś, **zgoda na cenę** (Zatwierdź ceny / Poproś o zmianę ceny), PDF z wysłania w podglądzie, potwierdzenia terminu i zespołu, **kontrola sprzętu** (z wyjątkiem i uzasadnieniem), wiadomość dla sprzedawcy i decyzja: **Zaakceptuj ofertę** (tworzy wydarzenie), **Poproś o zmiany**, **Nie przyjmuj**. Potwierdzenie realizacji — od 0.19 natywnie w zakładce „Ustalenia” wydarzenia („Potwierdź realizację” otwiera ją na tej ofercie).
5. **Kreator „Nowy sprzedawca”** („Dodaj sprzedawcę”): osoba, hotel i sale, warunki marek, opiekun i zastępca (administrator), zaproszenie do portalu. Lista **Gotowość** od pierwszego kroku, zapis przy komplecie; warunki zapisu te same co w CRM. Osoba: **jedno pole wyszukiwania** (imię, nazwisko, e-mail, telefon, stanowisko albo nazwa organizacji — kilka słów w dowolnej kolejności) z osobami (obecne organizacje jako etykiety) i organizacjami (kliknięcie — osoby organizacji), **„Nowy kontakt”** / **„Dodaj osobę do …”** i **„Nowa organizacja”** bez wychodzenia z kreatora, albo **Pracownik Mavinci** (administrator); organizacja osoby przechodzi do kroku „Hotel i sale” (zob. „Aktualizacja — Sprzedawcy: wyszukiwanie i dodawanie osoby w kreatorze”).
6. Rozmowy ze sprzedawcą, historia zmian, ustawienia istniejącego sprzedawcy, indywidualne ceny, podgląd brandingu i wizytówki oraz tryb pokazowy „Pokaż portal hotelowi” — natywnie (zob. niżej). Potwierdzenie realizacji — od 0.19 na Macu (zakładka „Ustalenia” wydarzenia).

**Aktualizacja — rozmowy ze sprzedawcą i historia zmian natywnie.** Na karcie sprzedawcy: **Rozmowa** — okno jak „Rozmowy ze sprzedawcą” w CRM (`SellerChatPanel`): „Rozmowa ogólna” (jedna z każdą marką) i „Oferty i realizacje” (osobny wątek każdej oferty) z liczbą nowych wiadomości, otwieranie rozmowy ogólnej albo ustaleń wybranej oferty w marce z prawem pisania, wyszukiwanie, lista wątków (marka, oferta / realizacja, ostatnia wiadomość), rozmowa z 50 ostatnimi wiadomościami i starszymi na żądanie, wysyłka (Enter, ponowienie nie dubluje), odczyt po wyświetleniu, „Otwórz ofertę” i „Ustalenia realizacji” (karta wydarzenia), odświeżanie co 15 s; w marce bez prawa pisania — „Masz dostęp do odczytu tej rozmowy.”. **Historia zmian** (`SellerAuditHistory`): kto i kiedy zmienił profil, opiekuna, warunki marek, widoczność wynagrodzenia lub konto portalu — zmienione pola „przed → po”, powód, po 50 wpisów. **Rozliczenia** przewijają do konta prowizji i narzutów na karcie (bez dostępu do konta — rozliczenia w CRM). Serwer: `src/lib/native/sellerChat.ts`, `GET op=conversations|messages|audit`, `POST op=chatOpen|chatSend|chatRead` (`list_seller_conversations`, `get_crm_seller_workspace`, `open_seller_conversation`, `get_seller_messages`, `send_seller_message`, `mark_seller_conversation_read`, `get_seller_audit`). Kod: `Sellers/SellerChatView.swift`, `Sellers/SellerDetailView.swift`.

**Aktualizacja — ustawienia sprzedawcy natywnie.** Przycisk **Ustawienia** na karcie sprzedawcy i akcje „Gotowości do pracy” (Wskaż hotel, Ustaw marki, Przypisz opiekuna, Nadaj dostęp / Wyślij zaproszenie) otwierają okno jak zakładka „Ustawienia” karty sprzedawcy w CRM, przewinięte do właściwej sekcji. **Opiekun i zastępca** (`SellerManagerAssignment`): administrator wybiera opiekuna i zastępcę (osoby bez uprawnień do ofert oznaczone i niedozwolone, zastępca inny niż opiekun i tylko z opiekunem), powód zmiany do historii, potwierdzenie przy usunięciu opiekuna; pozostali widzą opiekuna i zastępcę. **Wynagrodzenie w portalu** (`CommissionVisibilityToggle`): przełącznik każdej aktywnej marki z prowizją — okno z powodem i (przy odsłonięciu) powiadomieniem sprzedawcy. **Profil sprzedawcy** (`CrmSellerProfileSettings` w trybie edycji): osoba (tylko do odczytu), rodzaj współpracy, status, hotel / organizacja nowych ofert (wyszukiwanie, lokalizacja i sale), notatka; **Cennik i zasady prowizji** — wszystkie marki z rozliczeniem prowizyjnym, stawką, sposobem wypłaty i podatkiem, domyślny cennik nowych ofert; **Dostęp do portalu** (zapis łączy konto i wysyła zaproszenie; wyłączenie dostępu odłącza konto — jak w CRM). Braki przed zapisem liczone tymi samymi warunkami co w CRM (`sellerProfileProblems`), kliknięcie przenosi do sekcji; **Zapisz ustawienia** (⌘S) i **Odrzuć niezapisane zmiany**, pytanie przy zamknięciu z niezapisanymi zmianami. Po każdej zmianie odświeżają się karta i kokpit. „Indywidualne ceny produktów i rozszerzeń” otwiera cennik sprzedawcy (niżej); „Branding i wizytówka — podgląd” — niżej. Serwer: `src/lib/native/sellerSettings.ts` (wspólne części z kreatorem — `sellerCreate.ts`), `GET op=management|settings`, `POST op=manager|visibility|settingsValidate|settingsSave` (`get_my_seller_cockpit`, `get_crm_seller_directory`, `set_seller_manager`, `set_seller_commission_visibility`, zapis `sales_partner_profiles` i `sales_partner_brand_terms` tokenem pracownika, zaproszenie `/bridge/seller/invite`). Kod: `Sellers/SellerSettingsView.swift`, `Sellers/SellerDetailView.swift`.

**Aktualizacja — indywidualny cennik sprzedawcy natywnie.** **Indywidualne ceny** na karcie sprzedawcy (i przycisk w ustawieniach) otwierają okno jak strona CRM `/crm/salespeople/[id]/pricing`: marka (tylko z aktywnymi warunkami), wyszukiwanie produktu, wariantu lub kategorii, produkty z miniaturą i kategorią, a przy każdej pozycji (cena podstawowa / wariant) stawka wewnętrzna i automatyczna (+20%), **cena wynikowa**, **cena indywidualna netto** (puste — automatyczna; przycisk przywraca automatyczną), **Dostępny** (nowe pozycje startują bez dostępu; sama zmiana ceny go nie przyznaje) i **Warunki**: wymagany nocleg z notatką, szacowany koszt logistyki (tylko CRM), warunek logistyczny i dodatkowe wymagania widoczne dla sprzedawcy. **Zapisz cennik** (⌘S) zapisuje całą markę; zmiana marki lub zamknięcie z niezapisanymi zmianami pyta o potwierdzenie. Pod produktem **Ceny konfiguracji i rozszerzeń dla tego sprzedawcy** — wczytanie po rozwinięciu, stawki (puste — „do wyceny”, 0 — wliczone), wskazówka dla pakietu LED, zapis chroniony wersją jak w CRM. Serwer: `src/lib/native/sellerPricing.ts`, `GET op=pricing|priceList|componentPrices`, `POST op=priceSave|componentSave` (`get_sales_partner_price_list`, `save_sales_partner_price_list`; stawki konfiguracji — ta sama trasa co CRM, `/bridge/seller/catalog/[id]/configuration?partner=…`). Kod: `Sellers/SellerPricingView.swift`.

**Aktualizacja — branding ofert, wizytówka i sale hotelu natywnie.** W ustawieniach sprzedawcy **Branding i wizytówka — podgląd** (rozwinięcie; akcja „Ustaw wygląd” z „Gotowości do pracy” otwiera ustawienia z rozwiniętym podglądem) i na karcie organizacji zakładka **Branding ofert** (administrator, zarządzanie kontaktami lub finansami) — jak `CrmOfferBrandingPanel`: marki, przy kilku organizacjach sprzedawcy wybór organizacji, informacja o brandingu wspólnym organizacji albo sprzedawcy niezależnym, **wizytówka sprzedawcy** (imię i nazwisko, stanowisko, e-mail, telefon, zdjęcie), **branding** (logo, zdjęcie okładkowe, galeria, czcionka nagłówków, kolory, plik czcionki i brandbook, zasady marki, teksty w ofercie). CRM tylko pokazuje — edycję ma sprzedawca w portalu. Pod podglądem **Przestrzenie i kontakty hotelu** (`HotelVenueSettings`): sale i informacje techniczne lokalizacji (z uprawnieniem do lokalizacji — edycja tymi samymi arkuszami co karta lokalizacji, bez — podgląd), brak lokalizacji z odnośnikiem do powiązania i aktualne kontakty hotelu. Na karcie hotelu nowa zakładka **Sale i przestrzenie** (`OrganizationHotelSpaces`): powiązana lokalizacja, „Zmień powiązaną lokalizację” (edycja organizacji), sale i informacje techniczne do edycji albo w podglądzie. Serwer: `src/lib/native/offerBranding.ts`, `GET /bridge/native/v1/sellers?op=branding|hotelVenue` (`get_crm_offer_branding`, `get_seller_hotel_context`, pliki `seller-brand-assets` i `location-materials` jako podpisane adresy). Kod: `Contacts/OfferBrandingView.swift`, `Locations/LocationSpacesPanel.swift`, `Contacts/ContactCardView.swift`, `Sellers/SellerSettingsView.swift`.

**Aktualizacja — tryb pokazowy „Pokaż portal hotelowi” natywnie.** Przycisk w kokpicie opiekuna (i w pustym kokpicie), na karcie organizacji („Sprzedawcy w tej organizacji” i menu „Więcej” organizacji-klienta) oraz w menu „Więcej” osoby kontaktowej otwiera na ekranie Sprzedawców tryb pokazowy jak `/crm/salespeople/demo`. **Przygotowanie**: marka (marki dostępne dla pracownika), nazwa hotelu (z organizacji albo obecnej organizacji kontaktu), logo z dysku (tylko w aplikacji — nie jest wysyłane ani zapisywane), kolor akcentu (8 kolorów i własny), „Pokaż wynagrodzenie”, opiekun widoczny w portalu (zalogowany pracownik) i podgląd portalu. **Pokaz** w barwach hotelu, wyraźnie oznaczony: **Pulpit** (przykładowe kafelki, oferty, opiekun, dekoracyjny kod QR, wydarzenia), **Kreator oferty** w 3 krokach (wydarzenie, usługi z aktualnego katalogu lub przykładowe, narzut hotelu i cena dla klienta), **Oferta dla klienta** (dokument w barwach hotelu z akceptacją), **Wynagrodzenie** (kalkulator i rozkład w roku — tylko gdy włączone) i **Jak to działa** (6 etapów współpracy). Pełny ekran przyciskiem w nagłówku, „Zakończ pokaz” (Esc), „Zaproś hotel do portalu” otwiera kreator „Nowy sprzedawca”. Pokaz niczego nie zapisuje ani nie wysyła. Serwer: `src/lib/native/sellerDemo.ts`, `GET /bridge/native/v1/sellers?op=demo&organization=…&contact=…&hotel=…` (`get_my_accessible_companies`, katalog `offer_products` widocznych w portalu, przykładowe usługi z `demoData.ts`). Kod: `Sellers/SellerDemoView.swift`, `Sellers/SellerDemoScreens.swift`.

**Aktualizacja — Sprzedawcy: wyszukiwanie i dodawanie osoby w kreatorze.**
Audyt kroku „Osoba”: tryb „Bez organizacji” ukrywał każdego, kto ma obecną organizację (prawie połowa kontaktów — np. pracownik hotelu wpisany po nazwisku dawał „Nic nie znaleziono”), tryb organizacji wymagał znajomości organizacji, pracownik bez roli administratora nie widział kontaktów innych opiekunów bez wyjaśnienia, a brakującej osoby ani organizacji nie dało się dodać z kreatora. Teraz:
1. **Jedno pole**: „Szukaj osoby lub organizacji — imię, nazwisko, e-mail, telefon, nazwa hotelu”. Każde słowo (dowolna kolejność) w imieniu i nazwisku, e-mailu, telefonie (także zapisanym ze spacjami), stanowisku albo nazwie obecnej organizacji — „jurgin”, „monika aries”, „600 123”. Wyniki: **Osoby** (dane, etykiety obecnych organizacji, „już sprzedawca” z przyciskiem karty, powód blokady) i **Organizacje** (lokalizacja i sale, liczba osób; kliknięcie — lista osób tej organizacji z wyszukiwaniem). Bez frazy — ostatnio dodane kontakty. Nazwy zapisane jak nagłówek e-maila (`"Jan Kowalski" <…>`) są pokazywane czysto.
2. **Kontakty innych opiekunów** (pracownik bez roli administratora) są widoczne z wyjaśnieniem „Kontakt innego opiekuna — sprzedawcą może go mianować administrator albo opiekun kontaktu” zamiast znikać; zasada zapisu bez zmian (jak w CRM).
3. **Dodawanie bez wychodzenia z kreatora**: „Nowy kontakt” (formularz Kontaktów wypełniony z frazy — imię i nazwisko, e-mail albo telefon), „Dodaj osobę do …” (od razu z organizacją) i „Nowa organizacja” (nazwa z frazy; potem lista jej osób). Nowa osoba jest od razu wybrana; przy duplikacie formularz proponuje **„Użyj istniejącego kontaktu”**. Twórca kontaktu zostaje jego opiekunem (baza), więc pracownik może go od razu mianować.
4. **Karta wybranej osoby**: e-mail (bez niego — ostrzeżenie i **„Uzupełnij e-mail”** w formularzu kontaktu z ponownym wczytaniem), telefon, organizacja (jedyna obecna — automatycznie; kilka — wybór; brak — wskazówka do kroku „Hotel i sale”), „Zmień osobę”. „Mianuj sprzedawcą” trafia na tę samą kartę.

Serwer: `GET /bridge/native/v1/sellers?op=lookup&q=…` (`newSellerLookup` w `src/lib/native/sellerCreate.ts`); osoby organizacji (`people&organization=…`) — wszyscy obecni pracownicy z powodem blokady; osoby mają `phone`, `kind`, `blocked`, organizacje — `city`, `peopleCount`. Kod: `Sellers/NewSellerWizard.swift`, `Contacts/ContactSheets.swift` (`initialValues`, `initialOrganizationID`, `onSaved`), `Contacts/OrganizationEditorSheet.swift` (`initialValues`). Bez migracji. Wymaga wdrożenia CRM.

**Aktualizacja — przełącznik „Wynagrodzenie w portalu sprzedawcy” na karcie sprzedawcy.** Nad kontem „Prowizje i narzuty” karta pokazuje, czy sprzedawca widzi w portalu zakładkę **„Moje wynagrodzenie”** (z nią prognozę wynagrodzenia na pulpicie i kwoty prowizji przy ofertach), i ma jeden przełącznik **Pokaż w portalu**: wyłączenie ukrywa wynagrodzenie wszystkich marek naraz (zakładka znika z portalu), włączenie pokazuje je we wszystkich aktywnych markach z prowizją. Przy kilku markach — także przełącznik każdej marki ze stanem „widoczne / ukryte” i opisem „Widoczne tylko dla marek: …”. Każda zmiana przechodzi przez okno jak `CommissionVisibilityToggle` w CRM: co zobaczy albo przestanie widzieć sprzedawca, powód do historii zmian, przy pokazaniu powiadomienie w portalu (zalecane; przy kilku markach — osobne dla każdej). Prowizje naliczają się i są widoczne w CRM niezależnie od przełącznika; narzut sprzedawca widzi zawsze. Przełącznik jest także wtedy, gdy użytkownik nie ma dostępu do konta prowizji (opiekun sprzedawcy); uprawnienia sprawdza baza (opiekun, finanse, administrator). Ustawienia sprzedawcy („Wynagrodzenie w portalu”) korzystają z tego samego okna i informują, kiedy zmiana jednej marki chowa albo pokazuje całą zakładkę.

Serwer: bez zmian — `POST /bridge/native/v1/sellers` `op=visibility` (`set_seller_commission_visibility`, po jednej marce). Bez migracji.

**Aktualizacja — rozmowy w aplikacji, „Mianuj sprzedawcą” i zaproszenie z instrukcją.**
1. **Rozmowy ze sprzedawcą tylko w aplikacji**: pozycje „Rozmowy czekające na odpowiedź” w kokpicie, powiadomienia o nowej wiadomości sprzedawcy (`seller_chat`), odnośniki CRM do rozmowy (`…?tab=seller&conversation=…`, `/crm/salespeople?seller=…&conversation=…`) i przycisk **Rozmowa** na karcie osoby-sprzedawcy otwierają na ekranie Sprzedawców okno rozmów z właściwą zakładką („Rozmowa ogólna” / „Oferty i realizacje”) i wybraną rozmową — bez przeglądarki. Serwer oznacza takie pozycje jako `kind: 'chat'` (rozmowa i profil sprzedawcy); starsze odnośniki aplikacja rozpoznaje sama.
2. **Mianuj sprzedawcą**: przycisk w nagłówku karty osoby (kontakt lub osoba prywatna; administrator, zarządzanie kontaktami lub finansami), w menu „Więcej” karty, w menu prawego przycisku na liście Kontaktów i przy osobach w „Sprzedawcy w tej organizacji” otwiera kreator „Nowy sprzedawca” z tą osobą i jej organizacją (wskazaną albo jedyną obecną; przy kilku — wybór). Istniejący sprzedawca ma w tych miejscach **Kartę sprzedawcy** (i **Rozmowę**). Po zapisie lista kontaktów i kokpit odświeżają się, a komunikat prowadzi do karty sprzedawcy.
3. **Zaproszenie z instrukcją**: krok „Zaproszenie” pokazuje, co otrzyma sprzedawca, i przyjmuje **osobistą wiadomość**. E-mail (także z CRM) zawiera: przycisk do ustawienia hasła (jednorazowy link), **adres logowania** (mavinci.pl/login) z loginem, sekcję **„Jak zacząć”** (hasło, logowanie, przewodnik „Witaj w portalu MAVINCI” i instrukcja mavinci.pl/seller/help, marki w portalu), **kontakt do opiekuna** (bez opiekuna — zapraszającego pracownika: e-mail, telefon) i wiadomość podpisaną przez zapraszającego. „Wyślij zaproszenie ponownie” w „Gotowości do pracy” otwiera to samo okno z wiadomością.
4. **Kopiowanie do schowka**: „Kopiuj adres e-mail” w menu prawego przycisku wiadomości (nadawca odebranej, odbiorcy wysłanej i wersji roboczej; kilka adresów — „Kopiuj adresy e-mail”) i kontaktu na liście; na liście i w menu „Więcej” karty kontaktu także „Kopiuj numer telefonu”.

Serwer: `src/lib/native/sellers.ts` (cel `chat`), `src/lib/native/sellerCreate.ts` (`people&organization=…`, `unaffiliated=1`, `id=…`; `organizations&id=…`; `form.inviteMessage`), `src/app/bridge/seller/invite/route.ts` (`message`, opiekun i marki do instrukcji), `src/lib/seller/accessEmail.server.ts` (sekcje „Wiadomość”, „Jak zacząć”, opiekun). Kod: `Sellers/SellerChatView.swift` (`SellerChatRequest`, `showSellerChat`), `Sellers/SellersView.swift`, `NotificationsDrawer.swift`, `Sellers/NewSellerWizard.swift` (`NewSellerPreset`, `appointSeller`), `Sellers/SellerInviteView.swift`, `WindowNavigation.swift` (`sellerAppointment`), `Contacts/ContactCardView.swift`, `Contacts/ContactsView.swift`, `Messages/MessagesView.swift`.

Serwer: `GET /bridge/native/v1/sellers?op=cockpit|seller|help|offer|newSeller|lookup|people|organizations`, `POST op=inquiryRespond|inquiryConvert|priceDecide|validate|create` (`src/lib/native/sellers.ts`, `src/lib/native/sellerOffer.ts`, `src/lib/native/sellerCreate.ts`); zaproszenie — `/bridge/seller/invite`; ocena, PDF i analiza sprzętu — `/bridge/seller/offers/[id]` (jak w CRM).

## W przygotowaniu — Pliki wydarzeń w Finderze

Docelowo: „Mavinci” w pasku bocznym Findera (File Provider, jak Dropbox) → Eventy → rok → „RRRR-MM-DD Nazwa” → foldery i pliki
z zakładki Pliki, z tymi samymi uprawnieniami co w CRM; zmiany w Finderze trafiają do CRM i odwrotnie.

- **Etap 1 — serwer (gotowy):** migracja `20261112120000_finder_files_sync.sql` (wersje plików, ślady usunięć, kosz na 30 dni
  z przywracaniem) i API `/bridge/native/v1/files` (`src/lib/native/finderFiles.ts`):
  `GET ?op=events | list&event= | changes&since= | item&kind=&id= | download&id= | trash[&event=]`,
  `POST {op: prepareUpload | createFolder | createFile | update | remove | restore | deleteForever | purge}`.
  Kursor zmian z zakładką 5 min; starszy niż 25 dni → `reset`. Podmiana treści z `baseContentVersion` → 409 `conflict`,
  gdy na serwerze jest nowsza wersja.
- **Etap 2 — rozszerzenie File Provider, tylko odczyt (gotowe do testów):** `Sources/MavinciFileProvider/` (osobny program
  w `Contents/PlugIns/MavinciFileProvider.appex`, piaskownica, sieć, grupa aplikacji `5DC8P5M489.pl.mavinci`) i
  `Sources/Mavinci/Finder/` (`FinderShared` — wspólny z rozszerzeniem, `FinderDomain` — rejestracja „Mavinci” po
  zalogowaniu, usunięcie po wylogowaniu, sygnał zmian co minutę). Rozszerzenie ma własną kopię struktury (wydarzenia
  i otwarte w Finderze wydarzenia), treść pliku pobiera przy otwarciu. Nazwy jak w CRM, tylko „/” → „∕” i „:” → „∶”;
  powtórzenia w folderze dostają „ (2)”.
  - **Logowanie:** sesja Supabase w kontenerze grupy (`session.json`, tylko dla właściciela) — aplikacja i rozszerzenie
    odświeżają token po kolei (blokada `session.lock`) i zawsze biorą nowszą sesję, więc działa też przy zamkniętej aplikacji.
  - **Budowanie:** `yarn build:mac` sam wybiera podpis zespołu (Developer ID Application, a bez niego Apple Development
    z OU=5DC8P5M489) i tylko wtedy dokłada rozszerzenie (wersja release; `FINDER=0` — bez). Po zmianie podpisu macOS raz
    zapyta o pęk kluczy („Zawsze pozwalaj”).
  - **Gdy „Mavinci” nie ma w Finderze:** Ustawienia systemowe → Ogólne → Rzeczy otwierane podczas logowania i rozszerzenia
    → Rozszerzenia / Dostawcy plików → włącz Mavinci. Diagnostyka w Terminalu:
    `pluginkit -m -v -p com.apple.fileprovider-nonui | grep -i mavinci` oraz
    `log stream --predicate 'process == "MavinciFileProvider" OR eventMessage CONTAINS "Mavinci Finder"'`.
- **Etap 3 — zapis z Findera (gotowe do testów):** dodawanie plików i folderów w folderach wydarzeń (wysyłka prosto do
  magazynu przez podpisany adres, potem `createFile`), edycja treści (`update` z `baseContentVersion`; gdy ktoś zmienił plik
  w międzyczasie — wersja z CRM zostaje, nasza trafia obok jako „Nazwa (konflikt RRRR-MM-DD GG.MM)”), zmiana nazwy,
  przenoszenie (pliki także między wydarzeniami, foldery w obrębie wydarzenia), Kosz Findera = kosz CRM na 30 dni
  („Odłóż” przywraca, „Opróżnij kosz” usuwa na zawsze; w Koszu widać elementy usunięte przez siebie). Odmowa serwera
  (uprawnienia, zajęta nazwa, nazwa zastrzeżona dla dokumentów handlowych) przywraca w Finderze stan z CRM. Pliki systemowe
  i tymczasowe (`.DS_Store`, `~$…`, `.tmp`) zostają tylko na Macu. Pracę offline obsługuje macOS — zmiany wysyłają się
  po powrocie sieci.
- **Pasek menu:** sygnet Mavinci (jak w dawnej aplikacji „Mavinci Reminders”, którą zastępuje) — stan połączenia i plików
  w Finderze, wersja, „Otwórz Mavinci”, „Pliki w Finderze”, „Synchronizuj teraz”, CRM w przeglądarce, uruchamianie przy
  logowaniu. Sygnet jest też ikoną „Mavinci” w pasku bocznym Findera (symbol w `Resources/FinderSymbol.xcassets`).
- **Etap 4:** „Pokaż w Finderze” w zakładce Pliki karty wydarzenia (gotowe), instrukcja dla ról. Katalog „Realizacje” na iCloud zostaje
  archiwum — bez importu do CRM.

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

## Aktualizacja — Finanse → Umowy stałe i skaner dokumentów

**Umowy stałe** (Finanse → „Podatki i terminy” → **Umowy stałe**, jak „Dokumenty i rozliczenia → Umowy stałe” w CRM — `RecurringContractsPanel`; kod: `Finance/FinanceContractsView.swift`):

1. Rejestr umów działalności — najem, leasing, abonamenty, raty, kredyty: aktywne / zakończone / wszystkie, kafelki „Aktywne umowy”, „Miesięcznie (PLN)” (kwartał i rok przeliczone na miesiąc) i „Po terminie”. Wiersz: tytuł, rodzaj, „otrzymujemy”, „zakończona”, „z fakturami”, liczba plików, kontrahent z rachunkiem, zdanie podsumowania i kratki 12 ostatnich okresów (kolor: opłacony, brak, po terminie, przyszły; podpowiedź — należne, zapłacono, termin). Licznik w pasku Finansów — okresy po terminie.
2. Umowa: okresy, **przelewy z wyciągów** (odpięcie, przejście do uzgodnienia miesiąca), **pliki umowy i aneksów** (podgląd, usunięcie, **„Dodaj plik”** i **„Skanuj”** — kilka stron w jeden PDF), „Edytuj” i „Usuń” (umowa z płatnościami jest kończona i zostaje w historii).
3. **Formularz** (nowa umowa, edycja ze statusem, „Nowa umowa z tej płatności” w uzgodnieniu — jeden `ContractFormSheet`): pola jak w CRM, sekcja „Skan lub plik umowy” — **„Skanuj umowę”** i **„Dodaj plik”** (kilka plików); pliki czekają na liście (podgląd, usuń) i wgrywają się po zapisaniu umowy; skan dostaje nazwę „<tytuł umowy> — skan RRRR-MM-DD.pdf”. Błąd pliku nie cofa zapisanej umowy (komunikat, ile plików nie weszło). Limit pliku 20 MB.
4. Uzgodnienie wyciągów → podsumowanie miesiąca „Umowy stałe…” ma odnośnik „Umowy stałe →”; adres CRM `section=recurring` (Centrum finansów, powiadomienia) otwiera tę część.

Serwer: `/bridge/native/v1/finance/bank` (`src/lib/native/financeBank.ts`) — `GET op=recurring&company`, `POST saveContract` (nowa albo `id` + `status`), `contractDelete`, `contractFileRemove`, multipart `contractFile` (`contractId`, `fileName`), `undo` z `kind=contract`, `GET op=file&kind=contract`. Te same funkcje bazy co CRM (`get_finance_recurring_contracts`, `save_…`, `delete_…`, `add_/remove_finance_recurring_contract_file`, `undo_bank_recurring_contract_payment`), token pracownika, poziom „Zarządzanie finansami” działalności.

**Skaner dokumentów** (`Scanner/DocumentScanner.swift`) — natywnie przez ImageCaptureCore (jak „Pobieranie obrazów” i Ustawienia systemowe → Drukarki i skanery): skanery na kablu, udostępnione i sieciowe (AirScan / eSCL, np. Brother MFC-T920) — bez modułu NAPS2, którego używa przeglądarka.

1. Okno: wybór skanera (zapamiętany; domyślnie Brother), źródło (szyba, podajnik, podajnik dwustronny — według możliwości skanera), jakość (150–600 DPI, 300 zalecane), kolor (kolor, skala szarości, czarno-biały).
2. „Skanuj pierwszą stronę”, potem **„Dodaj stronę”** dla kolejnych (z podajnika kilka stron naraz). Strony jako miniatury: podgląd (dwuklik), przestawienie, usunięcie. **„Zakończ — połącz w PDF”** łączy je w kolejności z listy (PDFKit, JPEG ~72%, wymiar strony z rozdzielczości skanu). Przy limicie (umowy: 20 MB) „Zakończ” jest zablokowane z podpowiedzią (niższa jakość albo skala szarości).
3. Zamknięcie z niepołączonymi stronami pyta o potwierdzenie; strony leżą w katalogu tymczasowym do zamknięcia okna.
4. Użycie: umowy stałe (formularz i „Pliki umowy”) oraz **Mavinci → „Skanuj dokument do PDF…”** — PDF zapisany w wybranym miejscu (domyślnie Pobrane).
