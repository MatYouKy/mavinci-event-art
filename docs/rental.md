# Rental — wypożyczenia klientom

Sekcja **Rental** (CRM, Mac, telefon) ma dwie podstrony:

1. **Wypożyczenia klientom** (`/crm/rental`) — sprzęt i dekoracje z magazynu wypożyczane klientowi bez eventu.
2. **Wynajem od podwykonawców** (`/crm/rental/subcontractors`, wcześniej Magazyn → Rental) — sprzęt, który wynajmujemy od innych.

Baza: migracje `20261130170000_client_rentals.sql` i `20261202090000_rental_catalog_window.sql` (katalog magazynu, okno zajęcia
sprzętu od wyjazdu do powrotu). Decyzje właściciela (25.11.2026): własny cennik wypożyczenia + faktura
z Finansów, odbiór własny albo dostawa (pojazd z floty i kierowca), protokoły jako PDF do wydruku i podpisu (skan dołączany do
wypożyczenia), sprzedaż widzi sprzedawca, wydanie i protokoły — magazyn.

## Przebieg

| Status | Co się dzieje | Kto |
| --- | --- | --- |
| Szkic | klient, termin wydania i zwrotu, pozycje z katalogu magazynu z wolnymi sztukami w terminie (zestaw rozpisuje się na składniki), usługi (transport, montaż), ceny za dobę albo ryczałt, rabaty, kaucja; po utworzeniu wypożyczenia od razu otwiera się katalog | sprzedaż |
| Zarezerwowane | sprzęt blokuje stan w oknie zajęcia — od wyjazdu do powrotu na magazyn (wspólne liczenie z eventami); magazyn dostaje powiadomienie | sprzedaż (rezerwacja), magazyn (przygotowanie) |
| Wydane | protokół wydania (WZ): ilości, braki przy wydaniu z opisem, zdjęcia, odbierający; PDF do podpisu, skan podpisanego protokołu; dowydanie — kolejny protokół | magazyn |
| Zwrócone | protokół odbioru (PZ): sprawne / uszkodzone / brak z opisem i zdjęciami; zwrot częściowy — kolejny protokół | magazyn |
| Rozliczone | naliczenia (uszkodzenia, braki, opóźnienie, czyszczenie), kaucja (wpłata, zwrot), faktury z Finansów | sprzedaż |
| Anulowane | tylko przed wydaniem; po rezerwacji z powodem | sprzedaż |

## Stan magazynu

Wypożyczenie od rezerwacji zajmuje sprzęt w funkcjach dostępności eventów i ofert (zakładka Sprzęt eventu, dostępność
pojedynczego sprzętu, kreator oferty, rezerwacja po akceptacji oferty, walidacja zestawów) przez **okno zajęcia magazynu** —
od wyjazdu sprzętu do jego powrotu (decyzja właściciela 26.11.2026):

- **od** — najwcześniejsze z: termin wydania, faktyczne wydanie (protokół wcześniej niż termin), wyjazd dostawy,
- **do** — późniejsze z: planowany zwrot, koniec przejazdu odbioru od klienta (sprzęt wraca na magazyn z odbiorem).

W tym oknie:

- zarezerwowane, jeszcze niewydane — przez całe okno,
- wydane i jeszcze u klienta — do końca okna, a po nim bez końca (aż wrócą),
- zwrócone uszkodzone albo brakujące — bez końca, aż magazyn rozstrzygnie: **Sprawne** (wraca na stan), **Do serwisu**
  (wskazane egzemplarze → „Uszkodzony”), **Spisz ze stanu** (egzemplarze → „Wycofany”, sprzęt bez egzemplarzy — mniejsza ilość),
  **Oddane później** (brak wrócił).

Dostępność w oknie = stan sprawny − największa liczba sztuk zajętych **naraz** przez eventy i inne wypożyczenia (szczyt
jednoczesnej zajętości, nie suma wszystkich rezerwacji z okna — sztuki wracające z jednego eventu mogą jechać na następny).
Rezerwacja i zmiana terminu / pozycji / godzin dostawy i odbioru sprawdzają rezerwacje eventów (jak walidacja zestawów: eventy nieanulowane, bez wynajmu
zewnętrznego i pozycji usuniętych z oferty) i innych wypożyczeń — przy braku zapis się nie uda, a lista pozycji pokazuje,
co i kiedy zajmuje sprzęt. Przewody — poza wypożyczeniami.

## Katalog magazynu

Okno pozycji (CRM, Mac, telefon) ma zakładkę **„Katalog magazynu”** (`rental_catalog(od, do, wypożyczenie)`): cały aktywny sprzęt
i zestawy z kategoriami, wyszukiwaniem (nazwa, marka, model, kategoria) i liczbą wolnych sztuk w oknie zajęcia tego
wypożyczenia (bez jego własnych pozycji). Ilości wielu pozycji wybiera się naraz (−/+ albo wpisana liczba) — nie więcej, niż
jest wolne (zestaw: tyle kompletów, ile pozwalają wolne składniki; składniki zestawów liczą się do sprzętu). „Wybrane pozycje” —
ceny, doby, rabaty, wartość odtworzeniowa, usługi i konflikty terminu. Cena za dobę z katalogu — tylko sprzedaż. Mac — przez
serwer (`/bridge/native/v1/rental?op=stock&start=…&end=…&id=…`), telefon i CRM — wprost z bazy (`rentalCatalog` we wspólnym `rental.ts`).

Dostawa i odbiór pojazdem (`rental_trips`) rezerwują pojazd od rezerwacji wypożyczenia — event nie dostanie zajętego pojazdu
(`is_vehicle_available`), a `rental_vehicle_conflicts` pokazuje konflikty z eventami i innymi wypożyczeniami.

## Dostęp (`rental_access`)

- **Sprzedaż** (klient, ceny, rabat, kaucja, naliczenia, faktury, dokumenty handlowe, historia handlowa): administrator,
  `offers_manage`, finanse (wystawianie faktur — podgląd) oraz opiekun / autor wypożyczenia z `offers_view` / `offers_create`.
  Zmiany: administrator, `offers_manage`, opiekun / autor z `offers_create`. Nowe wypożyczenie: `offers_create` / `offers_manage`.
  Opiekuna zmienia administrator albo `offers_manage`.
- **Magazyn** (pozycje bez cen, termin, odbierający, dostawa, protokoły, zdjęcia, rozbieżności, uwagi magazynu):
  `equipment_view` / `equipment_manage` od rezerwacji (szkic widzi tylko sprzedaż). Wydanie, odbiór i rozbieżności —
  `equipment_manage`, jak w eventach nie opiekun ani autor wypożyczenia (administrator — wszystko).
- Tabele czyta bezpośrednio tylko sprzedaż (RLS); magazyn i wszystkie zapisy idą przez funkcje `rental_*`.
- Pliki: bucket `rental-files` (prywatny), ścieżki `<wypożyczenie>/sales/…` (sprzedaż) i `<wypożyczenie>/warehouse/…`
  (skany protokołów, zdjęcia — wszyscy z dostępem; zapis: magazyn i sprzedaż).

## Powiadomienia (tylko potrzebne, bez autora zmiany)

- rezerwacja, cofnięcie rezerwacji, anulowanie zarezerwowanego, zmiana terminu zarezerwowanego / wydanego → magazyn
  (`equipment_manage` bez opiekuna; bez magazynu — administratorzy),
- wydanie → opiekun / autor,
- rozbieżności w zwrocie → opiekun / autor (decyzja o naliczeniach).

## Funkcje

Odczyt: `rental_list(filter)`, `rental_get(id)`, `rental_catalog(od, do, wypożyczenie)`, `rental_availability(id)`,
`rental_check_availability(od, do, pozycje, wypożyczenie)` (z wypożyczeniem — w jego oknie zajęcia),
`rental_item_units(pozycja)`, `rental_vehicle_conflicts(pojazd, od, do, bez)`, `rental_access(id)`.
Sprzedaż: `rental_save(id, dane)`, `rental_set_items(id, pozycje)`, `rental_set_status(id, status, notatka)`,
`rental_set_charges(id, naliczenia)`, `rental_link_invoice(id, faktura, rodzaj, dołącz)`.
Magazyn: `rental_issue(id, linie, odbierający, uwagi)`, `rental_return(id, linie, zwracający, uwagi)`,
`rental_resolve(pozycja, czynność, ilość, egzemplarze, opis)`, `rental_set_warehouse_note(id, uwagi)`.
Wspólne: `rental_set_trips(id, przejazdy)`, `rental_add_file(...)`, `rental_remove_file(plik)`.
Dostępność dla eventów: `rental_equipment_demand(sprzęt, od, do)`, `rental_equipment_demands(od, do)`, `rental_vehicle_busy(...)`.
Wewnętrzne: `private.rental_demand` (zapotrzebowanie w oknie), `private.rental_block(wypożyczenie)` (okno),
`private.rental_busy` / `private.rental_peaks` (przedziały i szczyt zajętości), `private.rental_availability_json`.

## Ekrany

- **CRM**: menu Rental → „Wypożyczenia klientom” (`/crm/rental`, karta `/crm/rental/[id]`) i „Wynajem od podwykonawców”
  (`/crm/rental/subcontractors`). PDF protokołu do podpisu: `/bridge/rental/[id]/protocols/[protocolId]`.
- **Mac**: `desktop/mac/Sources/Mavinci/ClientRentals/` — lista, karta, okna (dane, pozycje z katalogiem magazynu, protokoły, rozbieżności,
  dostawa i odbiór, anulowanie), rozliczenie; dane i zapisy przez `/bridge/native/v1/rental` (`src/lib/native/rental.ts`).
- **Telefon**: menu „Rental” (`mobile/src/screens/RentalScreen.tsx`, `mobile/src/components/Rental/`) — ta sama lista i karta,
  pozycje z katalogiem magazynu (zakładki „Katalog magazynu” i „Wybrane”, po utworzeniu wypożyczenia katalog otwiera się od razu);
  magazyn wydaje i przyjmuje sprzęt na telefonie (zdjęcia z aparatu do linii protokołu, zdjęcie podpisanego protokołu jako skan),
  PDF do podpisu z serwera (`/bridge/native/v1/rental?op=protocolPdf` — kopia w `rental-files/<wypożyczenie>/warehouse/prints/`,
  adres na 10 minut). Wspólny kod: `src/lib/CRM/rental/rental.ts` = `mobile/src/lib/rental.ts` (`scripts/ci/check-shared-copies.mjs`).
- Powiadomienia `/crm/rental/<id>` otwierają kartę na Macu i w telefonie.
