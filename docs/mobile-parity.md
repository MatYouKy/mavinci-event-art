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
| Powiadomienia | wyzwalacze i `enqueue_crm_business_notification` | `NotificationsScreen`, `navigationRef.routeNotification` / `routeSalesUrl` |
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
