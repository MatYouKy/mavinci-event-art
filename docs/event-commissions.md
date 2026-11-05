# Podsumowanie wydarzenia i ewidencja prowizji

Migracja: `supabase/migrations/20261105130000_event_settlement_commissions.sql`. Wspólny kod CRM ↔ aplikacja: `src/lib/events/settlement/eventSettlement.ts` ↔ `mobile/src/lib/eventSettlement.ts` (typy, odczyt wyników RPC, etykiety, `formatPln`). Wszystko liczy baza — interfejs tylko wyświetla i wysyła zmiany.

## Zasady

| Kto | Stawka | Podstawa |
|---|---|---|
| Pracownik CRM, który sprzedał wydarzenie | 5% (ustawienia globalne), **10% gdy w dniu akceptacji oferty był opiekunem klienta** (organizacja, a bez niej osoba kontaktowa) | Zysk netto = przychód netto − wykonawcy zewnętrzni − koszty bezpośrednie − ekipa − prowizje i narzuty sprzedawców zewnętrznych (koszt firmy) |
| Sprzedawca zewnętrzny (hotel, agencja) z włączoną prowizją w kartotece sprzedawców | stawka z kartoteki dla marki wydarzenia (albo uzgodniona w ofercie z portalu) | Przychód netto (faktury) − wykonawcy zewnętrzni |

- **Sprzedawca wydarzenia** = autor zaakceptowanej oferty (oferta z portalu → opiekun sprzedawcy; dalej prowadzący zapytanie, twórca wydarzenia). Zapisuje się raz przy akceptacji (`event_sales_shares`, z oceną „klient własny” i datą). Administrator może zmienić osobę albo podzielić udziały (razem 100%), z historią (`event_sales_share_audit`).
- **Stawki pracowników**: `compensation_settings.sales_commission_standard_rate` (5) i `sales_commission_own_client_rate` (10); przy pracowniku przełącznik „prowizja od sprzedaży”, własne stawki i sposób wypłaty (`employee_sales_commission_terms`, historia w `employee_sales_commission_terms_audit`). Administrator domyślnie bez prowizji. Na start włączone dla aktywnych pracowników z uprawnieniami ofert.
- **Sprzedawca zewnętrzny** dostaje prowizję, gdy: sprzedał przez portal (model prowizyjny), polecił wydarzenie (`referring_sales_partner_id`), jest kontaktem rozliczeniowym hotelu/agencji, jest pośrednikiem w „Ustaleniach ze sprzedawcą” albo został dodany do wydarzenia (`add_event_partner_commission`). Rozliczany narzutem nie dostaje dodatkowej prowizji — narzut jest kosztem w podsumowaniu.
- Wpis ręczny prowizji dla tej samej osoby ma pierwszeństwo — podsumowanie nie nalicza drugiej.
- Koszt firmy: gotówka z zysku = kwota / (1 − podatek), wynagrodzenie pracownicze = brutto × (1 + składki pracodawcy z ustawień wynagrodzeń), faktura / inne = kwota.

## Podsumowanie (zakładka „Podsumowanie”, obszar „kwoty”)

Pozycje uzupełniają się same (`private.event_settlement_auto_lines`):

- **Przychody**: faktury sprzedaży (VAT, końcowa = pełna wartość, korekty; zaliczka rozliczona w fakturze końcowej się nie dubluje; faktura na kilka wydarzeń — udział z `invoice_event_allocations`), przychód gotówkowy (do potwierdzenia netto), prognoza z oferty lub kalkulacji do czasu faktury.
- **Koszty**: koszty wydarzenia (przy fakturze KSeF / spoza KSeF netto z faktury, wpisane ręcznie — do potwierdzenia netto), zlecenia podwykonawców (bez dublowania z kosztem tego samego podwykonawcy), ekipa z ewidencji czasu (stawka × godziny), narzut sprzedawcy, ręczne prowizje.
- Sprzedawca potwierdza netto, zmienia rodzaj kosztu (wykonawca zewnętrzny ↔ koszt bezpośredni), wyłącza pozycję (fakturę, ofertę, prowizję — z powodem), dopisuje pozycje ręczne i przypisuje faktury kosztowe z listy (`link_event_cost_invoice` tworzy koszt wydarzenia powiązany z fakturą; nie da się przypisać więcej niż 100% faktury).

Obieg (`event_settlements`, wersje w `event_settlement_versions` — niezmienne):

1. **Wersja robocza** — prognoza prowizji aktualizuje się sama po każdej zmianie faktur, kosztów, oferty, podwykonawców, ewidencji czasu, ustaleń i warunków sprzedawców (wyzwalacze; błąd prognozy nigdy nie blokuje zapisu źródła).
2. **Wysłanie** (`submit_event_settlement`) — sprzedawca wydarzenia, finanse albo administrator, po zakończeniu wydarzenia. Blokują: brak przychodu, przychód tylko z prognozy (potrzebna faktura, potwierdzona gotówka albo pozycja ręczna), niepotwierdzone netto, udziały ≠ 100%.
3. **Zatwierdzenie** (`approve_event_settlement`, administrator) — tylko gdy dane nie zmieniły się od wysłania (`source_key`). Prowizje stają się „do wypłaty” z zamrożoną podstawą. **Zwrot do poprawy** (`return_event_settlement`) z uwagą.
4. **Ponowne otwarcie** (`reopen_event_settlement`, z powodem) → ponowne zatwierdzenie. Wpis bez wypłat przyjmuje nową kwotę (historia zmian zostaje); po wypłacie powstaje **dopłata** albo **potrącenie** (rozliczane `settle_commission_deduction` z inną prowizją tej osoby — w rejestrze wypłat obu wpisów).

Kroki realizacji (etap „Rozliczenie”): „Wyślij podsumowanie wydarzenia” (sprzedaż) i „Zatwierdź podsumowanie wydarzenia” (administrator) zamykają się same.

## Ochrona i historia

- Prowizji z podsumowania nie zmienia się ręcznie (kwota, podstawa, odbiorca, zatwierdzenie) — tylko anulowanie, notatka i termin; wypłaty w rejestrze wypłat (`record_commission_settlement`, potrącenia nie wypłaca się).
- Każda zmiana prowizji (także ręcznej) trafia do `event_commission_history` (bez każdego przeliczenia prognozy).
- Wydarzenia z historią podsumowania nie da się usunąć (anuluj je).
- Stary panel „Rentowność i prowizja opiekuna” jest wyłączony — opiekuna sprzedawcy z portalu nalicza podsumowanie (udział sprzedawcy wydarzenia).

## Kto widzi

- Podsumowanie: obszar „kwoty” wydarzenia (sprzedawca / prowadzący, biuro, finanse, administrator). Magazyn, kierownik, ekipa, inny sprzedawca — nie.
- Pracownik widzi swoje prowizje (`get_my_commissions`, konto prowizji pracownika) w CRM i w aplikacji. Administrator i finanse — wszystkie.
- Sprzedawca zewnętrzny w portalu widzi swoje prowizje z podstawą („przychód netto − wykonawcy zewnętrzni”) i stawką.

## Start

Migracja: tylko po migracjach `20261105090000`, `20261105100000`, `20261105110000`. Dla trwających wydarzeń z zaakceptowaną ofertą zapisuje sprzedawcę i prognozę; rozliczone wydarzenia i istniejące wpisy ręczne zostają bez zmian. Migrację można uruchomić ponownie.
