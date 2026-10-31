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
| Czas pracy | `crm/time-tracking` | `TimeTrackingScreen` |
| Sprzęt, flota | `crm/equipment`, `crm/fleet` | `EquipmentScreen`, `FleetScreen` |
| Kontakty | `crm/contacts`, `crm/clients` | `ClientsScreen`, `Client360Modal` |
| Pracownicy | `crm/employees` | `EmployeesScreen` |
| Komunikator | `components/crm/chat` | `ChatListScreen`, `ChatScreen`, `SellerChatScreen` |
| Uprawnienia | `lib/permissions.ts` | `mobile/src/lib/permissions.ts` (`isAdmin` uwzględnia uprawnienie „admin” jak w CRM) |
| Powiadomienia | wyzwalacze i `enqueue_crm_business_notification` | `NotificationsScreen`, `navigationRef.routeNotification` / `routeSalesUrl` |

## Tylko w CRM (otwierane w przeglądarce)

Oferty (w tym akceptacja rabatu i marży), faktury, finanse wydarzeń, sprzedawcy zewnętrzni, ustawienia administracyjne i kontrola korespondencji. Powiadomienia prowadzące do tych modułów aplikacja otwiera w przeglądarce (`openInCrmWeb`, adres z `EXPO_PUBLIC_CRM_URL`, domyślnie https://mavinci.pl).

## Kod współdzielony

Identyczne kopie pilnowane przez `scripts/ci/check-shared-copies.mjs`:

- `src/lib/CRM/messages/mailboxPreferences.ts` ↔ `mobile/src/lib/mailboxPreferences.ts`

## Lista kontrolna zmiany w module

1. Reguła dostępu w bazie (RLS lub funkcja), nie tylko w interfejsie.
2. Ten sam filtr, etykieta i komunikat w CRM i w aplikacji.
3. Nowy typ powiadomienia lub link → obsługa w `routeNotification` / `routeSalesUrl`.
4. Nowa wersja aplikacji (`version` w `mobile/app.json` i `mobile/package.json`, `cd mobile && yarn deploy`).

## Stan na 31.10.2026 (wersja 1.1.0)

Dodano w aplikacji: Wiadomości tylko z własnych i przypisanych skrzynek (wcześniej wszystko, co pozwalała baza — u administratora wszystkie skrzynki), filtr skrzynek, załączniki, ustawienia skrzynek, przetargi, Mój dzień, obsługa linków z powiadomień o przetargach i ofertach, `isAdmin` zgodny z CRM. Otwarcie cudzej wiadomości nie zmienia jej statusu „przeczytana”.
