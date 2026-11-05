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
- Wpis ręczny prowizji dla tej samej osoby ma pierwszeństwo tylko wtedy, gdy jest zatwierdzony / wypłacony albo dodał go administrator. Autora wpisu (`created_by`) ustawia baza z sesji — nie da się go podać ani zmienić z aplikacji. Ręczny wpis sprzedawcy w stanie „planowana” czeka na finanse — do tego czasu liczy się prowizja z podsumowania, a wpis ręczny nie pomniejsza zysku (nie da się w ten sposób „wyłączyć” prowizji partnera). Cudzy wpis ręczny zmienia jego autor, finanse albo administrator.
- Zatwierdzenie wpisu ręcznego, gdy ta sama osoba ma już zatwierdzoną prowizję z zatwierdzonego podsumowania, wymaga ponownego otwarcia podsumowania (inaczej byłyby dwie wypłaty); ponowne zatwierdzenie rozlicza różnicę. Do tego czasu wstrzymane są wypłaty obu wpisów tej osoby w wydarzeniu. Nadpłata z prowizji z podsumowania (potrącenie) najpierw zmniejsza niewypłacony wpis ręczny tej osoby w tym wydarzeniu (bez przelewu, także przy innym sposobie wypłaty); wpisu ręcznego z otwartym potrąceniem z tego wydarzenia nie wypłaca się przed potrąceniem.
- Prowizja już zatwierdzona zachowuje swoją stawkę (z ostatniego zatwierdzenia, także dopłaty / potrącenia) i sposób wypłaty przy ponownym rozliczeniu — późniejsza zmiana warunków w kartotece lub przy pracowniku nie działa wstecz. Wyjątki: administrator zmienił „klient własny” albo otworzył podsumowanie z opcją „Przelicz stawki według aktualnych warunków” (`reopen_event_settlement(..., p_refresh_rates => true)`, np. korekta błędnie ustawionej stawki — dotyczy wszystkich osób w wydarzeniu, ostrzeżenia podsumowania pokazują „stawka X% → Y%” dla każdej zmienianej osoby; różnica jako dopłata albo potrącenie; flaga kasuje się przy zatwierdzeniu).
- Prowizję z podsumowania anuluje (zawsze z powodem, `event_commissions.cancel_reason`) i przywraca tylko finanse albo administrator — `set_event_commission_cancelled`. Anulowana zostaje anulowana (zatwierdzenie jej nie przywraca), nie pomniejsza zysku, a powód widać w podsumowaniu; można ją przywrócić, dopóki nie ma wypłat.
- Koszt firmy: gotówka z zysku = kwota / (1 − podatek), wynagrodzenie pracownicze = brutto × (1 + składki pracodawcy), faktura / inne = kwota. Stawka składek zapisuje się przy naliczeniu (`event_commissions.employer_social_rate`; przy ręcznym wpisie dla pracownika z wypłatą jako wynagrodzenie ustawia ją baza z ustawień — innym odbiorcom bez składek) — późniejsza zmiana ustawień wynagrodzeń nie zmienia kosztu ani nie blokuje wypłat. Starsze wpisy bez zapisanej stawki: koszt = kwota (jak dotąd).

## Podsumowanie (zakładka „Podsumowanie”, obszar „kwoty”)

Pozycje uzupełniają się same (`private.event_settlement_auto_lines`):

- **Przychody**: faktury sprzedaży (VAT, końcowa = pełna wartość, korekty; zaliczka rozliczona w fakturze końcowej się nie dubluje; faktura na kilka wydarzeń — udział z `invoice_event_allocations`), przychód gotówkowy (do potwierdzenia netto), prognoza z oferty lub kalkulacji do czasu faktury.
- **Koszty**: koszty wydarzenia (przy fakturze KSeF / spoza KSeF netto z faktury, wpisane ręcznie — do potwierdzenia netto), zlecenia podwykonawców (kwota uzgodniona minus koszty tego podwykonawcy już wpisane, np. jego faktura — liczone raz na podwykonawcę: Σ zleceń − Σ jego kosztów, rozdzielone po kolei na zlecenia; bez dublowania, ale też bez gubienia reszty), ekipa z ewidencji czasu (stawka × godziny), narzut sprzedawcy, ręczne prowizje.
- Sprzedawca potwierdza netto, zmienia rodzaj kosztu (wykonawca zewnętrzny ↔ koszt bezpośredni — z powodem), wyłącza pozycję (zawsze z powodem), włącza pozycję pominiętą przez system (z powodem; zaliczki rozliczonej w fakturze końcowej nie da się wliczyć), dopisuje pozycje ręczne (kwoty ≥ 0). Kwota kosztu niższa niż w dokumentach albo przychodu wyższa — z powodem (przy pozycji do potwierdzenia netto bez powodu można przeliczyć brutto na netto, VAT do 23%, z tolerancją kilku groszy na zaokrąglenia). Korekta kwoty i potwierdzenie obowiązują, dopóki kwota źródła się nie zmieni — po zmianie pozycja wraca do potwierdzenia (`source_changed`).
- Faktury kosztowe z listy przypisuje osoba z dostępem do finansów wydarzenia (`link_event_cost_invoice` tworzy koszt wydarzenia powiązany z fakturą; nie da się przypisać więcej niż 100% faktury). Sprzedawca bez finansów nie przegląda rejestru zakupów firmy.

Obieg (`event_settlements`, wersje w `event_settlement_versions` — niezmienne):

1. **Wersja robocza** — prognoza prowizji aktualizuje się sama po każdej zmianie faktur (także udziałów faktury w kilku wydarzeniach), kosztów, oferty, podwykonawców, ewidencji czasu, ustaleń, warunków i profili sprzedawców (wyzwalacze raz na polecenie, nie na każdy wiersz; błąd prognozy nigdy nie blokuje zapisu źródła). Wydarzenia rozliczone przed wdrożeniem (bez podsumowania) zostają bez zmian.
2. **Wysłanie** (`submit_event_settlement`) — sprzedawca wydarzenia, finanse albo administrator, po zakończeniu wydarzenia. Blokują: brak przychodu, przychód tylko z prognozy (potrzebna faktura, potwierdzona gotówka albo pozycja ręczna), niepotwierdzone netto, udziały ≠ 100%.
3. **Zatwierdzenie** (`approve_event_settlement`, administrator) — tylko gdy dane nie zmieniły się od wysłania (`source_key`). Prowizje stają się „do wypłaty” z zamrożoną podstawą. **Zwrot do poprawy** (`return_event_settlement`) z uwagą.
4. **Ponowne otwarcie** (`reopen_event_settlement`, z powodem) → ponowne zatwierdzenie. Wpis bez wypłat przyjmuje nową kwotę (historia zmian zostaje); po wypłacie powstaje **dopłata** albo **potrącenie**. Potrącenie najpierw zmniejsza niewypłaconą resztę tej samej prowizji (od razu, w rejestrze jako „Potrącenie”, bez przelewu); „do potrącenia” zostaje tylko faktyczna nadpłata — rozliczana `settle_commission_deduction` z inną prowizją tej osoby (ta sama marka i sposób wypłaty, także częściowo). Późniejsza dopłata najpierw spłaca otwarte potrącenie tej prowizji — gotówką wypłaca się tylko to, co faktycznie się należy.
5. Wydarzenie anulowane po zatwierdzeniu: podsumowanie można otworzyć i zatwierdzić ponownie — prowizje spadają do zera (niewypłacone się anulują, wypłacone stają się potrąceniami).

Kroki realizacji (etap „Rozliczenie”): „Wyślij podsumowanie wydarzenia” (sprzedaż) i „Zatwierdź podsumowanie wydarzenia” (administrator) zamykają się same.

## Ochrona i historia

- Prowizji z podsumowania nie zmienia się ręcznie (kwota, podstawa, odbiorca, zatwierdzenie, status „wypłacona”) — tylko anulowanie / przywrócenie, notatka i termin; wypłaty w rejestrze wypłat (`record_commission_settlement`, potrącenia nie wypłaca się).
- Po wysłaniu podsumowania ręczne prowizje wydarzenia zmienia tylko finanse lub administrator.
- Zapis pozycji i wysłanie podsumowania blokują stan podsumowania przed sprawdzeniem uprawnień (zapis nie wyprzedzi wysłania). Wszystkie operacje obiegu blokują najpierw stan podsumowania, potem blokady silnika (ta sama kolejność — bez zakleszczeń).
- Klucz danych (`source_key`) porównuje liczby w jednej skali (stawka „15” z ustawień = „15.000” w ewidencji) — zatwierdzone podsumowanie nie staje się „nieaktualne” bez zmiany danych.
- Każda zmiana prowizji (także ręcznej) trafia do `event_commission_history` (bez każdego przeliczenia prognozy).
- Wydarzenia z historią podsumowania nie da się usunąć (anuluj je).
- Stary panel „Rentowność i prowizja opiekuna” jest wyłączony — opiekuna sprzedawcy z portalu nalicza podsumowanie (udział sprzedawcy wydarzenia).

## Kto widzi

- Podsumowanie: obszar „kwoty” wydarzenia (sprzedawca / prowadzący, biuro, finanse, administrator). Magazyn, kierownik, ekipa, inny sprzedawca — nie.
- Pracownik widzi swoje prowizje (`get_my_commissions`, konto prowizji pracownika) w CRM i w aplikacji. Administrator i finanse — wszystkie.
- Sprzedawca zewnętrzny w portalu widzi swoje prowizje z podstawą („przychód netto − wykonawcy zewnętrzni”) i stawką.

## Start

Migracja: tylko po migracjach `20261105090000`, `20261105100000`, `20261105110000`. Dla trwających wydarzeń z zaakceptowaną ofertą zapisuje sprzedawcę i prognozę; rozliczone wydarzenia i istniejące wpisy ręczne zostają bez zmian. Migrację można uruchomić ponownie.
