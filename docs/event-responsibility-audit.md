# Wydarzenie: odpowiedzialność od oferty do rozliczenia (audyt 2026-11-04)

Stan na bazie produkcyjnej i kodzie po commicie „Karta imprezy”. Nazwy tabel i funkcji — jak w bazie.

## Stan wdrożenia (2026-11-04)

Etap 1 wdrożony jako **kroki realizacji** (`docs/event-steps.md`, migracja `20261104200000_event_realization_steps.sql`): zamówienia z wyprzedzeniem i sprawdzenia stanu z konfiguracji usług i sprzętu, dwustronne przekazanie sprzedaż → magazyn, właściciel i termin każdego kroku, „Czekamy na”, „Moje kroki”, przypomnienia i eskalacja, pomoc dla każdej roli (CRM i aplikacja). Zamknięte luki: 1 (zamówienia z wyprzedzeniem), 3 (część: „Gotowe” wymaga zamknięcia kroków przygotowania i kierownika), 4 (część: potwierdzenie wydania przez RPC z rolą magazynu), 5 (termin i eskalacja przyjęcia przez magazyn), 7 (role w krokach zamiast tylko autora; stary proces zamknięty dla rozliczonych wydarzeń). Do zrobienia: etap 2 (ręczne statusy, odblokowanie załadunku przez RPC, faktury opłacane tylko w finansach, `validate_event_status_change`) i etap 3 (zwrot po pozycjach, pasażerowie aut).

## Przepływ dziś

| # | Krok | Gdzie jest stan | Kto może zmienić | Potwierdzenie / blokada |
|---|---|---|---|---|
| 1 | Akceptacja oferty i rezerwacja sprzętu | `offers.status`, `event_equipment.reservation_status` (`reserved_pending`, braki: `planned` + `is_optional`) | sprzedawca (`reserve_selected_equipment`, `sales_can_manage_offer`) | okno potwierdzenia rezerwacji |
| 2 | Wydarzenie „Oferta zaakceptowana” | `events.status` | wyzwalacz `sync_event_status_from_offer` | — |
| 3 | Magazyn dostaje informację | `event_warehouse_handoffs.requested_at` + powiadomienie | wyzwalacz `queue_event_for_warehouse` (osoby z `equipment_manage`, poza autorem i sprzedawcą) | brak terminu i eskalacji |
| 4 | Magazyn przyjmuje przygotowanie | `handoffs.accepted_*` → `events.status='in_preparation'` | `accept_warehouse_event` | `guard_warehouse_event_status` — tylko magazyn ustawia stany magazynowe |
| 5 | Kierownik realizacji | `event_realizations.manager_id` | `appoint_realization_manager` (admin, autor, `events_manage`) | powiadomienie kierownika |
| 6 | Magazyn: gotowe | `handoffs.ready_*` | `advance_warehouse_event('ready')` | nie sprawdza braków, załadunku ani wynajmów |
| 7 | Załadunek pozycji | `event_equipment.is_loaded/loaded_by` | `set_event_equipment_loaded` | po zablokowaniu nie da się odznaczyć |
| 8 | Potwierdzenie / blokada załadunku | `events.loading_confirmed*`, `loading_locked`, `loading_unlock_*` | **bezpośredni UPDATE** — autor, `events_manage`, członek zespołu | zasady tylko w interfejsie (notatka przy brakach, odblokowanie „admina”) |
| 9 | Wydanie auta kierowcy / zwrot | `event_vehicles.pickup_*`, `return_*`, `vehicle_handovers` | kierowca (`record_assigned_vehicle_handover`) | licznik wymagany; brak powiązania z „gotowe” i załadunkiem |
| 10 | Start / koniec realizacji | `event_realizations.started_at/completed_at` | kierownik realizacji (`advance_realization`) | start wymaga „gotowe”; koniec — notatki |
| 11 | Rozładunek, zwroty, szkody | `event_closeouts` (pola tak/nie) | `can_manage_event_workflows` | samodzielna deklaracja, brak listy zwrotu |
| 12 | Rozliczenie, „następny krok” | `event_workflow_*` | właścicielem wszystkich kroków jest **autor** | kroki `manual` może zamknąć `can_manage_event_workflows` |
| 13 | Ręczna zmiana statusu | `events.status` | autor, `events_manage`, członek zespołu | blokowane tylko stany magazynowe |

## Luki

1. **Brak zamówień z wyprzedzeniem i sprawdzania stanu.** Nie ma pojęcia „zamów N dni przed” ani „sprawdź stan przed wydarzeniem”. Przykład: „Taniec w Chmurach” mapuje się na wytwornicę dymu ciężkiego i termobox, ale **suchego lodu i reguły „min. 4 dni przed” nie ma nigdzie**. `offer_additional_requirements` to wymagania wobec klienta / obiektu (zgoda obiektu, czujki, zasilanie), nie zadania magazynu.
2. **Magazyn można pominąć.** Ręczny status pozwala przejść do „W trakcie / Zrealizowane / Rozliczone” bez przyjęcia przez magazyn (6 rozliczonych wydarzeń nie miało przyjęcia). „Rozliczone” w przeglądarce oznacza faktury jako opłacone (`EventDetailsAction.tsx`).
3. **„Gotowe” bez warunków.** `advance_warehouse_event('ready')` nie sprawdza braków (`has_equipment_shortage` — 27 wydarzeń), wynajmów zewnętrznych ani załadunku. `validate_event_status_change` sprawdza stan `ready_for_execution`, którego nie ma w enumie — jego kontrole nie działają.
4. **Załadunek bez zasad w bazie.** Potwierdzenie i odblokowanie to zwykły UPDATE `events`: sprzedawca w zespole może potwierdzić załadunek, prośba o odblokowanie nie wysyła powiadomienia.
5. **Brak terminu przyjęcia przez magazyn.** 19 z 24 przekazań nigdy nie przyjęto (najstarsze 38 dni), w tym 9 na przyszłe wydarzenia.
6. **Zwrot i szkody nie są zapisywane po pozycjach.** Stany rezerwacji `reserved_confirmed`, `in_use`, `returned` nie mają zapisu w kodzie.
7. **Jeden właściciel procesu.** Kroki i przypomnienia trafiają tylko do autora, także fakturowanie (wg ustaleń: faktury wystawia administrator). Magazyn, kierownik realizacji i kierowca nie mają swoich kroków. Po rozliczeniu 138 wydarzeń nadal ma otwarte kroki — przypomnienia to głównie szum.
8. **Kto jedzie z kim — nie zapisujemy.** Auto ma kierowcę, ale pasażerów nie; godziny powrotu aut są puste we wszystkich rekordach, kontakt w obiekcie ma telefon tylko w 1 lokalizacji, nie ma pola „Wytyczne dla kierownika imprezy”.

## Proponowany przepływ z odpowiedzialnością

**Zasada:** każdy stan zmienia funkcja w bazie (RPC), która zapisuje kto i kiedy; bez bezpośredniego UPDATE z przeglądarki. Każdy krok ma właściciela (rolę) i termin.

| Krok | Właściciel | Potwierdza | Termin |
|---|---|---|---|
| Sprzedaż: oferta zaakceptowana, sprzęt zarezerwowany, wymagania klienta wysłane | Sprzedawca | system (akceptacja) | — |
| Magazyn: przyjęcie przygotowania | Magazyn | osoba z magazynu | 2 dni robocze od akceptacji, potem eskalacja do kierownika i autora |
| **Zamówienia z wyprzedzeniem** (np. suchy lód) | Magazyn | „zamówione” → „dostarczone” | data wydarzenia − N dni z konfiguracji usługi |
| **Sprawdzenie stanu** (np. maszyna dymu, termobox) | Magazyn | „sprawdzone OK” / „problem” | np. 3 dni przed załadunkiem |
| Braki i wynajmy | Magazyn | „zapewnione” | przed „gotowe” |
| Magazyn: gotowe | Magazyn | tylko gdy powyższe zamknięte | przed etapem Załadunek |
| Załadunek | Magazyn + kierowca | potwierdzenie RPC (podpis na karcie imprezy) | etap Załadunek |
| Wydanie auta | Kierowca | odbiór (licznik) — dopiero po „gotowe” i załadunku | etap Dojazd |
| Realizacja | Kierownik realizacji | start / koniec z notatką | wydarzenie |
| Zwrot sprzętu | Magazyn | lista zwrotu: zwrócone / brak / uszkodzone | do 2 dni po |
| Rozliczenie | Administrator (faktury), sprzedawca (koszty) | kroki workflow | +7 dni |

### Etap 1 — „Do przygotowania i zamówienia” (zgłoszony przypadek suchego lodu)

- **Konfiguracja usługi** (`offer_products`): lista „Przygotowanie i zamówienia” — rodzaj (zamówienie / sprawdzenie stanu / potwierdzenie), nazwa (np. „Suchy lód 20 kg”), **ile dni przed**, kto odpowiada (magazyn / kierownik / sprzedawca), dostawca, uwagi.
- **Na wydarzeniu** (`event_preparation_items`): pozycje tworzą się przy akceptacji oferty (kopie z konfiguracji usługi, z terminem liczonym od daty wydarzenia lub etapu Załadunek). Magazyn i kierownik mogą dodać pozycję ręcznie.
- **Statusy przez RPC z historią** (kto, kiedy, notatka): do zrobienia → zamówione / sprawdzone → dostarczone / OK albo problem. Bez prawa edycji wprost.
- **Powiadomienia:** do magazynu przy przyjęciu i 1 dzień przed terminem; po terminie — kierownik realizacji i autor.
- **„Gotowe” w magazynie** wymaga zamknięcia wymaganych pozycji (albo nadpisania z powodem przez uprawnioną osobę).
- **Widoczne w:** panelu magazynu na wydarzeniu, Karcie imprezy (sekcja już jest) i w aplikacji mobilnej.

### Etap 2 — blokady stanów

- Potwierdzenie i odblokowanie załadunku przez RPC (magazyn / kierownik), z powiadomieniem.
- Ręczny status: „W trakcie”, „Zrealizowane”, „Rozliczone” tylko przez proces (RPC z warunkami); oznaczanie faktur jako opłaconych tylko w finansach.
- Wydanie auta kierowcy wymaga „gotowe” i potwierdzonego załadunku (albo nadpisania z powodem).
- Naprawa `validate_event_status_change` (nieistniejący stan).

### Etap 3 — zwroty i role w procesie

- Lista zwrotu po pozycjach (zwrócone / brak / uszkodzone → zgłoszenie sprzętu), automatyczne zamknięcie `event_closeouts`.
- Kroki workflow z właścicielem-rolą (magazyn, kierownik, administrator) zamiast tylko autora; wygaszenie kroków po rozliczeniu.
- Pasażerowie aut (`event_vehicle_passengers`), godziny powrotu, telefon w obiekcie i pole „Wytyczne dla kierownika imprezy”.
