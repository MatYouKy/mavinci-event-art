# Zasady projektu Mavinci

## Polskie etykiety wartości systemowych

- Nie wyświetlaj kodów z bazy/API jako treści badge, statusów, ról ani kategorii.
- Używaj słownika `src/lib/ui/systemLabels.ts` i komponentu `SystemBadge`; istniejące słowniki domenowe z poprawnymi polskimi etykietami mogą pozostać.
- Nowy kod systemowy musi otrzymać polską etykietę. Nie zastępuj tłumaczenia usunięciem podkreśleń ani wyświetleniem surowego kodu jako wartości awaryjnej.
- Tłumaczenia są warstwą prezentacji: nie zmieniaj wartości enum w bazie, kluczy API, filtrów ani uprawnień. Zachowuj własne nazwy i opisy użytkowników. Kody integracyjne pozostają dostępne w technicznych formularzach konfiguracji.

## Typografia marki

- Czcionka Atom zawsze musi być stosowana z tekstem UPPERCASE (wielkie litery).
- Reguła dotyczy interfejsu, podglądów, ofert PDF i wszystkich nowych materiałów marki.
- W CSS stosuj `text-transform: uppercase`. W PDF konwertuj tekst przez `toLocaleUpperCase('pl-PL')` przed pomiarem szerokości i łamaniem wierszy.
- Zmieniaj sposób wyświetlania, nie treść nazw zapisaną w bazie. Pozostałe czcionki nie wymagają uppercase.

## Obramowania w interfejsie

- Nie stosuj ciężkich, jasnych ani mocno kontrastowych borderów wokół kart, formularzy, sekcji, przycisków i elementów klikalnych.
- Elementy oddzielaj przede wszystkim kolorem tła, odstępami, typografią i delikatnym cieniem.
- Jeżeli obramowanie jest potrzebne dla czytelności, używaj wyłącznie bardzo subtelnej linii o niskiej przezroczystości, spójnej z tłem i kolorystyką marki.
- Stany `hover`, `focus`, zaznaczenia i aktywności pokazuj zmianą tła, koloru lub dyskretną poświatą zamiast grubego obramowania.
- Zasada obowiązuje w całym CRM, portalu sprzedawcy, stronie WWW, modalach, drawerach, ustawieniach i wszystkich nowych komponentach.
- Inputy, selecty, textarea i datepickery mają najwyżej jedną delikatną linię 1 px, bez podwójnej ramki i grubych złotych ringów. Nie ustawiaj globalnie `outline-color`: ujawnia przezroczyste obrysy `outline-none` także poza fokusem.
- Kalendarze korzystają z kolorów aktualnego motywu, nie z osobnej granatowej palety. Dni nie mają osobnych ramek; zaznaczenie pokazuj tłem, a fokus klawiatury subtelnym, widocznym wyróżnieniem.
- Pola dat muszą umożliwiać zarówno wybór z kalendarza, jak i ręczne wpisanie daty w formacie `DD.MM.RRRR`, z walidacją rzeczywistej daty przed zapisem.

## Aplikacja mobilna nadąża za CRM

- Zmiana modułu CRM, który ma odpowiednik w aplikacji mobilnej (`mobile/`), obejmuje aplikację w tym samym commicie lub PR: te same reguły biznesowe, uprawnienia, filtry, etykiety i powiadomienia. Mapa modułów: `docs/mobile-parity.md`.
- Logikę używaną w obu miejscach trzymaj w identycznych kopiach wymienionych w `scripts/ci/check-shared-copies.mjs` (Metro nie importuje plików spoza `mobile/`). CI zatrzymuje się przy rozbieżności.
- Aplikacja mobilna nie może zostawać w tyle za ustawieniami projektu. Każde ustawienie pracownika i firmy — uprawnienia do modułów, zasięg danych (np. „tylko przypisane” / „wszystkie”, firmy, oddziały), widoczność finansów i danych osobowych, godziny pracy i reguły ewidencji — działa w aplikacji tak samo jak w CRM. Nowe lub zmienione ustawienie = ta sama reguła w bazie i obsługa w `mobile/` w tej samej zmianie; jeśli ekran w aplikacji nie obsługuje ustawienia, ma go ukryć, a nie pokazać więcej danych.
- Aplikacja mobilna nie może zostawać w tyle za zmianami architektonicznymi. Nowy lub zmieniony proces, maszyna stanów, krok i zakres odpowiedzialności, RPC, uprawnienie albo typ powiadomienia trafia do `mobile/` w tej samej zmianie: te same RPC i stany, te same blokady i komunikaty, ta sama pomoc. Aplikacja nie może zostać na starym przepływie (np. bezpośredni UPDATE tabeli, gdy CRM przeszedł na RPC) ani pokazywać przycisków, których baza już nie przyjmie. Typy, etykiety, reguły przycisków i treść pomocy trzymaj we wspólnej kopii (np. `src/lib/events/steps/eventSteps.ts` ↔ `mobile/src/lib/eventSteps.ts`). Jeśli ekranu mobilnego nie da się zmienić od razu, ukryj w nim starą czynność i opisz brak w `docs/mobile-parity.md` — zmiana bez tego nie jest gotowa.
- Dane wydarzenia dzielą się na obszary (`docs/event-access.md`): realizacja, kontakt na miejscu, dane klienta, kwoty, oferta / umowa / formalności, faktury. Nowa tabela, kolumna, RPC, zakładka lub plik z danymi wydarzenia musi mieć przypisany obszar i regułę w bazie (`can_view_event_area`, `get_event_access`); kwoty trzymaj poza tabelą `events` (np. `event_financials`), a dokumentację w folderach `visibility = 'formal'`. Interfejs CRM i aplikacji ukrywa sekcje według tego samego `get_event_access`.
- Reguły dostępu wymuszaj w bazie (RLS, funkcje), nie tylko w interfejsie — aplikacja mobilna czyta bazę bezpośrednio, więc filtr dodany tylko w CRM jej nie obejmuje.
- Moduły dostępne tylko w CRM (oferty, faktury, finanse, ustawienia administracyjne) aplikacja otwiera w przeglądarce (`openInCrmWeb`). Nowy link w powiadomieniu musi mieć obsługę w `mobile/src/navigation/navigationRef.ts` (`routeNotification`, `routeSalesUrl`).
- Jeśli zmiana świadomie nie dotyczy aplikacji, wpisz w opisie PR „Mobile: nie dotyczy — powód”. Bez tego kontrola parytetu w CI zatrzymuje PR.
- Zmiany w aplikacji wymagają nowej wersji: podnieś `version` w `mobile/app.json` i `mobile/package.json`, a następnie `cd mobile && yarn deploy`.


## Mavinci: natywna aplikacja macOS

- `desktop/mac/` jest aplikacją SwiftUI macOS 14+, na tym samym poziomie co `mobile/`; zastąpiła usunięte `macos-sync-app/` (pliki wydarzeń w Finderze — rozszerzenie `Sources/MavinciFileProvider/`, ikona na pasku menu; synchronizacji Przypomnień Apple jeszcze nie przeniesiono, serwer `/bridge/tasks/sync` zostaje). Instrukcja i jawne braki: `desktop/mac/README.md`; kontrakt przyszłego własnego serwera: `docs/desktop-native-api.md`.
- Każdy nowy moduł wykorzystuje istniejące reguły, zakres konta, RLS i RPC; nie przenoś uprawnień ani kalkulacji finansowych do Swift. Odwzoruj działanie CRM i mobile, a odłożone funkcje wpisuj do instrukcji.
- Widoki macOS są natywne: tabele, zaznaczenie, menu kontekstowe, skróty i SF Symbols. Nie zastępuj czynności panelem WWW.
- Backend jest źródłem prawdy. Lokalna kopia jest szyfrowana i oddzielona per konto / połączenie; offline tylko odczyt. Wylogowanie i zmiana zakresu usuwają starą kopię. Zapis wymaga potwierdzenia; nie ponawiaj automatycznie niepotwierdzonej operacji.
- Rejestr synchronizacji przyrostowej: `native_workspace_sync` w migracjach `20261101160000_native_workspace_sync.sql` i `20261101170000_native_calendar_sync.sql`; nowy zbiór wymaga dopisania tam oraz w `Module` i `HTTPBackend`. Funkcja działa jako SECURITY INVOKER z istniejącymi RLS; nie utrzymuje starej migawki serwera. Przed wdrożeniem migracji klient jawnie korzysta z pełnych odczytów.
- Do pakietu aplikacji trafiają wyłącznie publiczny adres i klucz Supabase anon/publishable. Nigdy service_role ani sekrety integracji. Sesje i konfiguracja zmienna lokalnie są w Keychain; po konfiguracji początkowej ustawienia połączenia zmienia administrator.
- Aktualizacja instrukcji w aplikacji i README jest częścią zmiany zachowania. Nie wdrażaj migracji, CRM ani mobile jako skutku samego budowania aplikacji desktopowej.

- Wydarzenia otwieramy na osobnej natywnej stronie z zakładkami (`EventPageView`), nigdy w zastępczym podglądzie ogólnym. Błędy układu pustego podglądu nie mogą zmniejszać wysokości tabel. Dzwonek i licznik powiadomień należą do prawego górnego paska narzędzi.
- Kalendarz natywny korzysta z tych samych wydarzeń i wystąpień spotkań co CRM. Integracja EventKit jest włączana świadomie, kopiuje CRM → wskazany kalendarz Apple i nie importuje prywatnych wpisów. Nigdy nie proś o dostęp przy starcie ani nie usuwaj cudzych wpisów. Informuj o rzeczywistym zakresie synchronizacji.
- Nowa czynność wydarzenia ma używać istniejącej reguły / RPC / pełnego procesu CRM. Samo dodanie zakładki i odczytu nie oznacza wdrożenia wszystkich czynności; utrzymuj dokładną macierz w README i ograniczenia w interfejsie. Zmiana agendy oznacza jej PDF jako nieaktualny przed zapisem. Finansów nie pobieraj przed serwerową kontrolą dostępu.
- Developerska wersja z obsługą uprawnień systemowych to `desktop/mac/scripts/dev-app.sh` (debug `.app`, ten sam pęk kluczy); nie zastępuj jej samym `swift run` przy pracy nad EventKit.

- macOS 0.3: Moje zadania są Kanbanem; szczegóły mają układ adaptacyjny. Listy dostają dokładną wysokość w układzie HStack, bez zależności od pustego podglądu HSplitView. Powiadomienia są drawerem; link doczytuje tylko rekord z RLS i otwiera konkretny natywny cel.
- Kalendarz i lista wydarzeń w macOS używają tego samego zbioru calendar; domyślny filtr historii nie zmienia danych ani uprawnień. Kolor wpisu pochodzi z kategorii CRM. Kontakty są wyłącznie z CRM — bez automatycznego odczytu lub łączenia prywatnej książki adresowej.
- Aktualny transport desktopu: native_workspace_sync_v3 (migracja 20261101213000_native_workspace_v3.sql, SECURITY INVOKER). Nie zastępuj go starszymi migawkami bez rozszerzonych pól; bez RPC używaj kontrolowanego pełnego odczytu. Dane kontaktów / przetargów aktualizuj wyłącznie dozwolonymi polami z updated_at lub istniejącym RPC.
