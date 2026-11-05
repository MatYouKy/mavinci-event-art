# Kroki realizacji wydarzenia

Każde wydarzenie od akceptacji oferty do rozliczenia ma listę kroków: **kto, co i do kiedy**. Kroki pokazują odpowiedzialność (rola + osoba), terminy i to, na czyje potwierdzenie czekamy. Migracja: `supabase/migrations/20261104200000_event_realization_steps.sql`. Wspólne typy, etykiety, reguły przycisków i treść pomocy: `src/lib/events/steps/eventSteps.ts` ↔ `mobile/src/lib/eventSteps.ts` (identyczne kopie, `scripts/ci/check-shared-copies.mjs`).

## Zasady

- Stan kroku zmienia **tylko baza**: RPC `update_event_step` (przycisk właściciela kroku) albo prawda z procesu (przyjęcie przez magazyn, gotowość, kierownik, załadunek, start i koniec realizacji, odbiór auta, faktura, wpłata). Przeglądarka i aplikacja nie zapisują `event_steps` wprost (RLS: tylko odczyt).
- Każda zmiana trafia do historii `event_step_activity` (kto, kiedy, notatka). Zmiany wynikające z procesu mają wpis „System”.
- Kroki liczy `sync_event_steps(event)` z wyzwalaczy na: wydarzeniu (status, daty, załadunek), przekazaniu do magazynu, realizacji, ofercie i jej pozycjach, sprzęcie wydarzenia, autach, etapach, fakturach, konfiguracji usług i sprzętu. Błąd synchronizacji nigdy nie blokuje operacji (ostrzeżenie w logu); co 15 minut `run_event_steps_maintenance()` (pg_cron `event-steps-maintenance`) synchronizuje ponownie i wysyła przypomnienia.
- Pominąć krok może administrator albo osoba z `events_manage` — zawsze z powodem. Otworzyć ponownie: ta sama osoba, która zamknęła krok, albo administrator / `events_manage`. Kroków z procesu nie otwiera się z listy — cofa się je tam, gdzie zostały potwierdzone.
- Rozdział odpowiedzialności: kroki magazynu wykonuje osoba z `equipment_manage`, która nie sprzedała i nie prowadzi wydarzenia (`employee_can_prepare_event`). Sprzedawca nie przyjmuje realizacji za magazyn i nie potwierdza załadunku — za to daje zgodę na braki w wydaniu i przyjmuje rozbieżności zwrotu (`docs/equipment-checklist.md`). Wydanie, załadunek powrotny i zwrot zamyka checklista sprzętu, nie przycisk w krokach.
- Anulowanie wydarzenia archiwizuje otwarte kroki; rozliczenie — zamyka kroki rozliczenia i archiwizuje pozostałe otwarte (opis problemu zostaje w notatce).

## Kroki

| Krok | Właściciel | Termin | Zamyka się |
|---|---|---|---|
| Uzupełnij kluczowe dane wydarzenia (Formalności) | Sprzedawca | akceptacja + 1 dzień | data, miejsce i klient uzupełnione |
| Podpisana umowa z klientem (Formalności) | Sprzedawca | ok. 14 dni przed | umowa podpisana albo ustalenia z partnerem bez umowy |
| Zaliczka lub zadatek wpłacone (Formalności) | Sprzedawca | termin zaliczki z harmonogramu | wszystkie zaliczki opłacone (tylko gdy są w harmonogramie) |
| Przekaż realizację do magazynu | Sprzedawca (autor zaakceptowanej oferty) | akceptacja + 1 dzień | przycisk albo przyjęcie przez magazyn |
| Przyjmij realizację do przygotowania | Magazyn (pula; przyjmujący zostaje opiekunem) | akceptacja + 2 dni, najpóźniej dzień przed | `accept_warehouse_event` |
| Wyznacz kierownika realizacji | Prowadzący wydarzenie | ok. 14 dni przed, najpóźniej dzień przed | zakładka Zespół |
| Potwierdź z klientem i obiektem wymagania usług | Sprzedawca | 7 dni przed | przycisk; tylko gdy usługi mają wymagania |
| Zamówienia / sprawdzenia / potwierdzenia z usług | rola z konfiguracji usługi | N dni przed wydarzeniem albo załadunkiem | „Zamówione” → „Dostarczone” / „Sprawdzone — OK” |
| Zapewnij brakujący sprzęt | Magazyn | 2 dni przed załadunkiem | przycisk albo rozwiązanie braku w rezerwacji |
| Potwierdź wynajem zewnętrzny | Magazyn | 2 dni przed załadunkiem | przycisk |
| Sprawdź stan: sprzęt z flagą „Sprawdzić stan przed wydaniem” (także w zestawach) | Magazyn | 2 dni przed załadunkiem | „Sprawdzone — OK” |
| Karta weselna wysłana do akceptacji | Sprzedawca | 21 dni przed | karta wysłana albo zaakceptowana (tylko wesela) |
| Zespół przypisany i potwierdzony | Prowadzący | 7 dni przed | są przyjęte zaproszenia i żadne nie czeka |
| Agenda realizacji gotowa | Prowadzący | 5 dni przed | agenda zapisana |
| Transport zaplanowany | Prowadzący | 2 dni przed załadunkiem | każde auto (poza zewnętrznymi) ma kierowcę |
| Oznacz przygotowanie jako gotowe | Magazyn | dzień przed załadunkiem | `advance_warehouse_event('ready')` — **tylko gdy wszystkie kroki „wymagane przed gotowością” są zamknięte** |
| Wydaj sprzęt — załadunek zgodny z listą | Magazyn | załadunek | checklista sprzętu → Wydanie: ilości spakowane, braki z powodem i zgodą sprzedawcy / administratora, potwierdzenie blokuje listę (`confirm_event_equipment_dispatch`, `docs/equipment-checklist.md`) |
| Odbierz sprzęt i auto | Kierowca (gdy jest), inaczej kierownik | załadunek | przycisk albo odbiór auta z licznikiem |
| Przejmij realizację na miejscu | Kierownik realizacji | start wydarzenia | `advance_realization('start')` |
| Zakończ realizację z raportem | Kierownik realizacji | koniec + 12 h | `advance_realization('complete')`, raport wymagany |
| Oddaj sprzęt do magazynu | Kierownik realizacji | koniec + 1 dzień | checklista sprzętu → Załadunek powrotny zatwierdzony przez kierownika (`confirm_event_equipment_loadback`) |
| Przyjmij zwrot i sprawdź sprzęt | Magazyn | koniec + 2 dni | checklista sprzętu → Zwrot zatwierdzony bez rozbieżności; z rozbieżnościami krok ma status „problem”, dopóki sprzedawca / administrator ich nie przyjmie (`acknowledge_event_equipment_return_issues`) |
| Wystaw fakturę za wydarzenie | Administrator | koniec + 7 dni | faktura VAT / końcowa / zaliczkowa (nie szkic, nie proforma) |
| Potwierdź wpłatę | Administrator | termin płatności albo koniec + 21 dni | wszystkie faktury opłacone albo „Rozliczone” |
| Wyślij podsumowanie wydarzenia | Sprzedawca | koniec + 5 dni | podsumowanie wysłane do zatwierdzenia (`submit_event_settlement`, zakładka Podsumowanie — `docs/event-commissions.md`) |
| Zatwierdź podsumowanie wydarzenia | Administrator | koniec + 10 dni | podsumowanie zatwierdzone — prowizje do wypłaty (`approve_event_settlement`) |

Ręczne kroki dodaje magazyn, kierownik realizacji, sprzedawca albo prowadzący (`add_event_step`) — z właścicielem, terminem i opcją „Wymagane przed gotowością magazynu”.

Terminy liczone są od daty wydarzenia; „przed załadunkiem” — od początku etapu „Załadunek” (bez etapu: 6 godzin przed startem). Zmiana dat, etapów lub oferty przelicza terminy otwartych kroków.

Etapy „Formalności” i „Rozliczenie” widzą tylko osoby z obszarem handlowym (`docs/event-access.md`). Kroki formalności, zespołu, agendy, transportu i karty weselnej zastępują stary proces „Gotowość realizacji” — jego przypomnienia są wyłączone (`notify_overdue_event_workflows`).

## Konfiguracja

- **Usługa** (`offer_product_preparation_items`, w CRM: produkt oferty → „Przygotowanie i zamówienia”): rodzaj (zamówienie, sprawdzenie stanu, potwierdzenie z klientem / obiektem, zadanie), nazwa, ile dni przed wydarzeniem / załadunkiem (0–90), kto odpowiada (magazyn, sprzedawca, kierownik), dostawca, ilość na sztukę usługi, „wymagane przed gotowością”. Przykład: „Taniec w Chmurach” → „Zamów suchy lód”, 4 dni przed wydarzeniem, magazyn, 10 kg na sztukę. Edytują: administrator, `offers_manage`, `equipment_manage`.
- **Sprzęt** (`equipment_items.requires_pre_check`, `pre_check_instructions`): „Sprawdzić stan przed każdym wydaniem” + instrukcja testu.

## Odczyt

- `get_event_steps(event)` — kroki, `waiting_for` (kroki do wykonania teraz, według terminu), postęp etapów, `my_roles`, `can_override`, `can_add`.
- `get_my_event_steps()` — „Moje kroki”: kroki przypisane do mnie albo nieprzypisane w mojej puli (magazyn, administrator), bez kroków czekających na poprzedników, do 60 dni naprzód.
- Panel „Kroki realizacji” na wydarzeniu (CRM i aplikacja), „Moje kroki” (CRM: `/crm/events/actions`, aplikacja: pulpit), ikona pomocy z zakresem odpowiedzialności dla każdej roli, Karta imprezy („Do przygotowania i zamówienia”).

## Powiadomienia

Jeden poziom naraz, każdy wysyłany raz (`notifications.metadata.event_step_key`): nowy krok (najwcześniej tydzień przed terminem), termin w ciągu doby, po terminie (właściciel + kierownik + prowadzący), 2 dni po terminie (także administratorzy; tylko kroki, które powstały przed swoim terminem), problem (kierownik + prowadzący). Bez powiadomień 20:00–7:00. Kroki aktywne w chwili wdrożenia nie wysyłają „Nowy krok”.

## Wdrożenie

1. SQL Editor: `20261104200000_event_realization_steps.sql` (idempotentna; tworzy kroki dla bieżących wydarzeń, zamyka stary proces przypomnień dla rozliczonych ponad tydzień temu, planuje zadanie pg_cron).
2. `yarn deploy` (CRM), `cd mobile && yarn deploy` (aplikacja 1.3.10).
