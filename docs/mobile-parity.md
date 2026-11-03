# Parytet CRM ↔ aplikacja mobilna

Zasada (AGENTS.md): moduł CRM dostępny w aplikacji mobilnej zmieniamy w obu miejscach naraz. CI (`scripts/ci/check-mobile-parity.mjs`) zatrzymuje PR, który zmienia taki moduł bez zmian w `mobile/`, chyba że opis zawiera „Mobile: nie dotyczy — powód”.

## Mapa modułów

| Moduł | CRM | Aplikacja mobilna |
| --- | --- | --- |
| Wiadomości e-mail | `crm/messages`, `store/api/messagesApi.ts`, `lib/CRM/messages` | `MessagesScreen`, `EmailMessageDetailScreen`, `ContactMessageDetailScreen` |
| Wybór skrzynek (ukryj / wycisz) | Ustawienia → Powiadomienia → Skrzynki pocztowe | Ustawienia → Skrzynki pocztowe (`MailboxPreferencesSection`) |
| Zapytania | `crm/inquiries` | `InquiriesScreen`, `NewInquiryModal`, `TaskDetailScreen` |
| Przetargi | `crm/tenders` | `TendersScreen` (lista, Przypisz do mnie, Utwórz zapytanie) |
| Mój dzień (sprzedaż) | `components/crm/dashboard/SalesDayPanel` | `SalesDaySection` na Dashboardzie |
| Wydarzenia | `crm/events` | `EventsScreen`, `EventDetailScreen`, `components/Events` |
| Zadania | `crm/tasks` | `TasksScreen`, `TaskDetailScreen` |
| Kalendarz i spotkania | `crm/calendar`, `crm/meetings` | `CalendarScreen`, `MeetingsScreen` |
| Dni ustawowo wolne, wymiar czasu pracy | `PublicHolidaysPanel`, `SpecialDayNotice`, kalendarz, `NewInquiryModal`, `EventWizard`, `crm/time-tracking` | `CalendarScreen`, `NewInquiryModal`, `TimeTrackingScreen`, `components/SpecialDayNotice` |
| Czas pracy | `crm/time-tracking` | `TimeTrackingScreen` |
| Sprzęt, flota | `crm/equipment`, `crm/fleet` | `EquipmentScreen`, `FleetScreen` |
| Kontakty | `crm/contacts`, `crm/clients` | `ClientsScreen`, `Client360Modal` |
| Pracownicy | `crm/employees` | `EmployeesScreen` |
| Komunikator | `components/crm/chat`, `lib/CRM/chat` | `ChatListScreen`, `ChatScreen`, `SellerChatScreen`, `services/unreadChat`, `services/chatNotifications` |
| Uprawnienia | `lib/permissions.ts` | `mobile/src/lib/permissions.ts` (`isAdmin` uwzględnia uprawnienie „admin” jak w CRM) |
| Opiekun kontaktu | `CustomerOwnerField` (karta klienta i organizacji), reguły w bazie (`protect_customer360_responsibility`) | Aplikacja nie zmienia opiekuna; kontakt dodany w aplikacji dostaje twórcę jako opiekuna z tego samego wyzwalacza w bazie |
| Powiadomienia | wyzwalacze i `enqueue_crm_business_notification`; od `20261101190000_security_p0` baza zwraca tylko powiadomienia odbiorcy, odbiorca zmienia wyłącznie `is_read`/`read_at`, tworzą je tylko funkcje serwera | `NotificationsScreen`, `navigationRef.routeNotification` / `routeSalesUrl` (te same reguły RLS; aplikacja nie wstawia powiadomień) |
| Finanse według działalności | `employees.finance_company_access`, karta „Finanse według działalności” w `EmployeePermissionsTab`, `lib/financeCompanyAccess.ts`, `get_invoice_finance_access`, `crm/invoices`, menu „Finanse” (migracje 20261101165000, 20261101171000) | Aplikacja nie ma modułu finansów działalności (faktury, KSeF, bank, deklaracje otwiera w CRM przez `openInCrmWeb`); dane chroni RLS — aplikacja nie widzi więcej niż CRM |
| Wartości finansowe wydarzeń | `can_view_event_commercials` (baza), `EventDetailPageClient` (budżet, płatnicy, zakładka Finanse — wynik RPC per wydarzenie) | `lib/eventCommercialsAccess.ts` (`useEventCommercialsAccess` → RPC `can_view_event_commercials`), `EventDetailScreen`, `DetailsTab` |

## Tylko w CRM (otwierane w przeglądarce)

Oferty (w tym akceptacja rabatu i marży), faktury, finanse wydarzeń, sprzedawcy zewnętrzni, ustawienia administracyjne i kontrola korespondencji. Powiadomienia prowadzące do tych modułów aplikacja otwiera w przeglądarce (`openInCrmWeb`, adres z `EXPO_PUBLIC_CRM_URL`, domyślnie https://mavinci.pl).

## Kod współdzielony

Identyczne kopie pilnowane przez `scripts/ci/check-shared-copies.mjs`:

- `src/lib/CRM/messages/mailboxPreferences.ts` ↔ `mobile/src/lib/mailboxPreferences.ts`
- `src/lib/CRM/chat/chatReadState.ts` ↔ `mobile/src/lib/chatReadState.ts` (liczniki, „przeczytane” / „dostarczone”, „pisze…”, reakcje)
- `src/lib/CRM/calendar/publicHolidays.ts` ↔ `mobile/src/lib/publicHolidays.ts` (święta, długie weekendy, dni „pomost”, wymiar czasu pracy)

## Lista kontrolna zmiany w module

1. Reguła dostępu w bazie (RLS lub funkcja), nie tylko w interfejsie.
1a. Ustawienia projektu (uprawnienia, zasięg i widoczność danych, reguły czasu pracy, dni wolne) obowiązują w aplikacji tak samo jak w CRM — aplikacja nigdy nie pokazuje więcej niż CRM tej samej osobie.
2. Ten sam filtr, etykieta i komunikat w CRM i w aplikacji.
3. Nowy typ powiadomienia lub link → obsługa w `routeNotification` / `routeSalesUrl`.
4. Nowa wersja aplikacji (`version` w `mobile/app.json` i `mobile/package.json`, `cd mobile && yarn deploy`).

## Stan na 31.10.2026 (wersja 1.1.0)

Dodano w aplikacji: Wiadomości tylko z własnych i przypisanych skrzynek (wcześniej wszystko, co pozwalała baza — u administratora wszystkie skrzynki), filtr skrzynek, załączniki, ustawienia skrzynek, przetargi, Mój dzień, obsługa linków z powiadomień o przetargach i ofertach, `isAdmin` zgodny z CRM. Otwarcie cudzej wiadomości nie zmienia jej statusu „przeczytana”.

## Stan na 31.10.2026 (wersja 1.2.0) — komunikator jak Messenger

W CRM i w aplikacji jednakowo:
- licznik nieprzeczytanych liczy serwer (`get_chat_unread_counts`): tylko wiadomości od innych osób — własna nieprzeczytana przez rozmówcę wiadomość nie zwiększa licznika,
- „wyświetlono” tylko, gdy rozmowa jest na ekranie, a okno lub aplikacja jest aktywna (`mark_chat_read`); w tle — „dostarczono” (`mark_chat_delivered`),
- wysłanie wiadomości oznacza przeczytanie rozmowy, także na innych urządzeniach,
- „pisze…” (Realtime broadcast `chat_typing:<id rozmowy>`), „Wyświetlono 23:10” / „Wyświetlili: …”, „Ty: …” na liście rozmów,
- reakcje na cudze wiadomości zapisywane przez `set_chat_message_reaction`,
- licznik na ikonie aplikacji przychodzi w powiadomieniu push (`send-chat-push`, `chat_unread_totals`).


## Stan na 1.11.2026 (wersja 1.3.0) — dni ustawowo wolne

W CRM i w aplikacji jednakowo: święta z tabeli `public_holidays` (ustawa + cotygodniowe porównanie ze źródłem zewnętrznym) zaznaczone w kalendarzu, wymiar czasu pracy pełnego etatu w miesiącu (kalendarz, czas pracy), ostrzeżenie przy dacie zapytania (i wydarzenia w CRM): święto, niedziela, długi weekend, dzień między świętem a weekendem, Sylwester. Data z kalendarza w aplikacji jest zapisywana jako data lokalna (wcześniej `toISOString` cofał ją o dzień).


## Natywna aplikacja macOS — pierwszy etap (01.11.2026)

Projekt `desktop/mac/` współdzieli z CRM i mobile Supabase Auth, tabele, RLS oraz istniejące RPC. Nie zmienia ich zachowania ani bieżących uprawnień. Natywne są: Mój dzień, listy i podglądy zapytań, własnych zadań, kontaktów, wydarzeń, ofert, przetargów oraz powiadomień. Akcje: prywatne zadanie i edycja, przejęcie zapytania, kontakt z kolejnym terminem, odroczenie, przeczytanie powiadomienia.

Oferty w desktopie mają na razie podstawowy podgląd; mobilna obsługa ofert pozostaje dotychczasowa. Pozostałe akcje, złożone karty i pełne moduły nie są deklarowane jako gotowe. Szczegółowa lista braków oraz instrukcja: `desktop/mac/README.md` i pomoc wewnątrz aplikacji. Nie dodano tras `/api/mobile/*`, ponieważ obecny backend używa bezpośredniego Supabase; docelowy własny serwer ma odrębny opis kontraktu w `docs/desktop-native-api.md`.

Migracja `20261101160000_native_workspace_sync.sql` przygotowuje wspólny transport przyrostowy, bez zmiany reguł biznesowych. Nie została zastosowana automatycznie. Mobile i przeglądarka zachowują istniejące pobieranie danych; przejście wszystkich klientów na ten transport pozostaje kolejnym etapem. Dopóki RPC nie jest wdrożone, desktop jawnie używa pełnych odczytów. Mobile: nie dotyczy — dodano klienta desktopowego i opcjonalny transport odczytu, bez zmian zachowania istniejących ekranów.


### macOS 0.2 — nawigacja i wydarzenia

Dzwonek przeniesiono na prawy górny pasek; poprawiono pełną wysokość tabel; wydarzenia otwierają osobną natywną stronę. Dodano natywny kalendarz z wydarzeniami, własnymi / zaproszonymi wystąpieniami spotkań i terminami zapytań oraz ręczne powiązanie CRM → Apple Calendar. Integracja jest lokalna dla Maca, bez importowania prywatnych wpisów do CRM. Moduł `calendar` ma opcjonalny transport przyrostowy w nowej migracji `20261101170000_native_calendar_sync.sql`, niewykonanej automatycznie.

Strona wydarzenia odczytuje obszary z mapy zakładek CRM, uwzględnia dane weselne, zespół odpowiedzialności, logistykę, magazyn, ofertę, kalkulacje, finanse, umowy, podwykonawców, pliki, historię i LIVE. Część czynności jest natywna (szczegółowa macierz w `desktop/mac/README.md`), a pozostałe są jawnie oznaczone jako niewdrożone. Nie deklarujemy pełnego parytetu czynności. Nie zmieniono kodu ani zachowania klientów CRM/mobile. Mobile: nie dotyczy — rozbudowa klienta macOS, bez nowych reguł biznesowych lub zakresów dostępu.


### macOS 0.3 — osiem poprawek interfejsu

Kanban zadań, kategorie kolorów w kalendarzu, układ list bez zależności od zaznaczenia, edycja kontaktów wyłącznie CRM, wspólny zbiór wydarzeń dla kalendarza i listy, filtry ukrytych wydarzeń / ofert, pełniejsze przetargi z istniejącymi RPC i drawer powiadomień z dokładnymi celami. Zmiany nie dodają odczytu prywatnych kontaktów urządzenia. Dotychczasowe reguły RLS, zapisu kontaktów i przetargów pozostają bez zmian. Nowy odczytowy transport native_workspace_sync_v3 jest w niewykonanej migracji 20261101213000. Mobile: nie dotyczy — poprawki klienta macOS i opcjonalnego transportu odczytu, bez zmian reguł biznesowych lub uprawnień zapisanych kontom. Ujednolicenie widoczności Kalendarza / Wydarzeń wykonano w kliencie macOS; nie zmieniano globalnego katalogu uprawnień CRM/mobile.

### Kosz pocztowy (02.11.2026)
CRM i mobile używają tej samej kontroli `can_trash_mailbox` i bridge `/bridge/messages/trash`: własna aktywna skrzynka lub aktywna skrzynka przypisana oraz dostęp do wiadomości. Sam podgląd kontrolny administratora nie daje prawa przenoszenia. Przeniesienie i przywrócenie wymagają potwierdzenia IMAP; timeout nie jest sukcesem. Mobile ma Kosz odebranych wiadomości i akcje w szczegółach. Wysłane pozostają w CRM. macOS nie ma modułu skrzynek pocztowych — zmiana nie rozszerza jego dostępu.


### Szybki podgląd załączników poczty (02.11.2026, wersja 1.3.2)
CRM: PDF i obrazy rastrowe otwierają się w oknie nad wiadomością, dla wysłanych i odebranych. Osobny przycisk pozwala pobrać każdy plik; pozostałe formaty są tylko pobierane. Dostęp nadal kontroluje Storage/RLS. Podgląd wymaga zgodnego nagłówka pliku, HTML i SVG nie są renderowane.
Mobile: te same reguły rozpoznawania formatów i uprawnienia; iOS otwiera natywny podgląd dokumentu, Android korzysta z systemowego czytnika (wymaga zainstalowanej aplikacji obsługującej format). Jest też osobny przycisk pobierania. Kopie podglądu są prywatne i usuwane przy opuszczeniu wiadomości; nie są przekazywane do zewnętrznych usług podglądu. Wysłane nadal obsługuje CRM. macOS: nie dotyczy — brak modułu skrzynek pocztowych.


### 2026-11-03 — ograniczenie obciążenia odczytów CRM / mobile 1.3.3

- Powiadomienia CRM i mobile: okna po 50 wpisów z doczytywaniem całej historii, liczniki poza oknem, te same RLS i reguły członkostwa w skrzynkach. Mobilny filtr zaproszeń fazowych zachowany.
- Liczniki skrzynek używają wspólnego SECURITY INVOKER RPC; przed migracją działa sekwencyjny fallback z identycznymi filtrami. Wyciszenia/ukrycia i kosz pozostają po stronie dotychczasowych reguł.
- Odczyty etapów operacyjnych są serializowane, przerywane po zamknięciu widoku i działają w aktywnej aplikacji/karcie. Kolejki zapisu, statusy i obliczenia nie są zmieniane.
- Oferty: tylko CRM (mobile otwiera CRM); lista zachowuje wszystkie pola potrzebne getOfferPricingTotals, a katalog ładuje się po wejściu w zakładkę.
- Migracja 20261103130000_crm_read_load.sql dodaje indeksy i zbiorcze liczniki; nie usuwa danych ani ograniczeń unikalności. Stały wynik kontroli portalu jest liczony raz na instrukcję, bez zmiany jej warunku.
- SQL tej poprawki zastosowano w produkcyjnym Supabase 2026-11-03: pięć indeksów utworzono CONCURRENTLY, funkcje liczników i optymalizację czterech polityk wdrożono po osobnym potwierdzeniu użytkownika. Migracja pozostaje idempotentna przy późniejszym uruchomieniu przez proces wydania.
- Wdrożenie CRM i publikacja mobile wymagają osobnego procesu wydania. Nie uruchomiono builda ani publikacji aplikacji, zgodnie z .build-policy.md.


### Poczta → lejek (2026-11-03)
CRM i mobile czytają `crm_message_sales_context` pod RLS; opiekun pochodzi z zapytania. Tworzenie z poczty korzysta z atomowego `crm_create_inquiry_from_message`. AI używa tego samego klucza źródła i dedykowanego RPC tylko dla service_role. Mobile 1.3.4: oznaczenia na liście odebranych i przycisk w szczegółach. Natywny macOS nie ma modułu skrzynki pocztowej; ochrona zapytań działa w bazie także dla tego klienta. Stan wdrożenia 2026-11-03: migracja 20261103160000 oraz qualify-incoming-email wdrożone przez Supabase CLI. CRM opublikowany przez yarn deploy (build zakończony, HTTP 200). Odczyt metadanych zweryfikowany dla 10 wiadomości; anon otrzymuje 401. Oznaczenia W lejku / Opiekun / AI potwierdzone w produkcyjnym interfejsie. Próba testowych wywołań mutującego RPC została odrzucona przez automatyczną kontrolę; nie wykonano testu równoległego zapisu. Mobile 1.3.4: kod zapisany, build EAS f09a820e-6528-4b32-bd09-6731ef569cb0 uruchomiony, auto-submit nie wykonał wysyłki z powodu braku ascAppId. Użytkownik przejął publikację aplikacji mobilnej — nie ponawiać deploy bez nowego polecenia.


### Widoczność oznaczeń poczty (2026-11-03, mobile 1.3.5)
Wspólna reguła `hasMessageInquiry`: oznaczenia lejka i AI pojawiają się tylko przy potwierdzonym powiązaniu z zapytaniem, również dla rozpoznanej kontynuacji. Brak powiązania lub niedostępność odczytu nie wyświetla komunikatu ani oznaczenia zastępczego. Rozpoznawanie wątków i zabezpieczenia zapisu w bazie pozostają bez zmian; sam podobny temat nie wystarcza do przypisania pracownika. Zmiana prezentacji nie wymaga migracji. Kod zapisany; publikacja pozostaje po stronie użytkownika.


### Komunikator: linki i kopiowanie (2026-11-03, mobile 1.3.6)
W rozmowach pracowników i ze sprzedawcami tekst oraz podpisy załączników korzystają z mobilnego komponentu ChatMessageText. Adresy HTTP(S) i www są podkreślone i otwierane po dotknięciu. Przytrzymanie wiadomości lub linku pokazuje „Kopiuj treść”; kopia zawiera oryginalny tekst, włącznie z podziałami wierszy. W komunikatorze pracowników zachowano opcję reakcji; tryb zaznaczania nie otwiera linków. Schowek korzysta z expo-clipboard zgodnego z Expo 54, bez odczytywania schowka użytkownika. CRM i natywny macOS: bez zmian — poprawka gestów i renderowania w React Native, bez zmian reguł danych, uprawnień ani API. Brak migracji. Kod zapisany; zgodnie z .build-policy.md bez builda, testów, typechecka i lintowania. Publikacja aplikacji pozostaje po stronie użytkownika.


### Opiekun zapytania z poczty (2026-11-03, mobile 1.3.7)
CRM i mobile umożliwiają przypisanie istniejącego, otwartego zapytania AI bez opiekuna bez tworzenia duplikatu. `crm_create_inquiry_from_message` wywołuje atomowe `claim_inquiry` przy przypisywaniu do siebie; istniejącego opiekuna nie zastępuje. `claim_inquiry` używa identyfikatora pracownika (`sales_employee_id`), blokady rekordu, dotychczasowych uprawnień do przejmowania oraz kontroli widoczności i zamknięcia. Przypisywanie innej osoby nadal podlega RLS i uprawnieniom przypisywania. Wynik zapisu komunikuje rzeczywiste przypisanie. Po zapisie CRM odświeża metadane wskazanej wiadomości bez oczekiwania na Realtime. Avatar opiekuna korzysta z tego samego komponentu co zadania (CRM i mobile), z nazwą, inicjałem zastępczym i kadrowaniem zdjęcia; dane trafiają przez dotychczasowy zbiorczy odczyt metadanych. macOS nie ma modułu poczty; kontrakt danych lejka nie zmienia się. Wymagana nowa migracja `20261103190000_message_inquiry_owner.sql`. Nie przypisujemy historycznych zapytań na podstawie domysłu o autorze kliknięcia. Kod i migracja zapisane, bez wdrożenia. Bez builda, testów, lintowania i typechecka zgodnie z .build-policy.md; publikacja po stronie użytkownika.
