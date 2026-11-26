# Uzgadnianie wyciągów bankowych

Ekran: **Faktury → Dokumenty i rozliczenia → Uzgodnienie wyciągów** (`BankReconciliationPanel`),
**ZUS i podatki** (`FinanceDeclarationsPanel`) oraz **Umowy stałe** (`RecurringContractsPanel`); okno **Powiąż ze zwrotem**
(`BankRefundPairModal`). Logika jest w bazie (migracje `20261101120000_bank_reconciliation_engine.sql`,
`20261101130000_finance_declarations_payroll_fx.sql`, `20261101210000_finance_recurring_contracts.sql`
i `20261103220000_bank_refund_pairs.sql`); ekrany tylko ją pokazują.

## 1. Dwa wyciągi → jedna potwierdzona lista operacji

Każdy miesiąc rachunku wgrywamy dwa razy (PDF i MT940) — kontrolnie. `confirm_bank_statement_sources`
paruje operacje obu plików:

1. po saldzie po operacji (kwota, kierunek, saldo — jednoznaczne, daty ±7 dni),
2. gdy bank inaczej ułożył operacje z jednego dnia — po kwocie, kierunku i kolejności (daty ±3 dni).

Operacją główną jest wiersz z MT940 (pełne tytuły, rachunek kontrahenta). Wiersz z PDF dostaje
`canonical_transaction_id` (kopia) i zostaje jako potwierdzenie; jego opis jest widoczny przy operacji.
Rozliczenia, wypłaty, płatności deklaracji i umów stałych, pary „płatność + zwrot” oraz wyjaśnienia zapisane na kopii
przechodzą na operację główną.
`source_confirmation`: `confirmed` (jest w obu plikach), `unconfirmed` (brak w drugim pliku — do
sprawdzenia), `single_source`. Usunięcie pliku z operacjami głównymi przenosi wszystko na kopię z drugiego pliku.

## 2. Blokady podwójnego rozliczenia (wyzwalacze, niezależnie od ekranu)

- operacja nie może być rozliczona ponad swoją kwotę — **faktury, wypłaty, deklaracje, umowy stałe i pary zwrotu liczą
  się razem** (`private.bank_transaction_allocated`; kwota pary — po obu stronach),
- faktura nie może być opłacona z wyciągu ponad należność — razem z jej kopiami w innych źródłach
  (KSeF ↔ faktura CRM, ten sam numer, strona, NIP i kwota w KSeF / CRM / spoza KSeF); dla dokumentów
  w walucie liczy się kwota w walucie dokumentu,
- nie można rozliczać kopii operacji, transferu bieżący ↔ VAT ani roboczej kopii faktury
  (wpis KSeF bez numeru KSeF obok tej samej faktury z numerem),
- płatność deklaracji musi być przelewem wychodzącym tej samej firmy,
- płatność umowy stałej: ta sama działalność, kierunek jak w umowie (koszt — przelew wychodzący, przychód — wpływ),
  waluta umowy, okres należący do umowy (cykl, początek, koniec, „rozliczaj od”); umowy, przy których kontrahent
  wystawia faktury, nie przyjmują płatności (rozlicza się fakturę),
- para „płatność + zwrot”: dwie różne operacje główne (nie kopie z drugiego wyciągu, nie przeniesienia własne) tej samej
  działalności i waluty, o przeciwnych kierunkach; jedna para na dwie operacje.

## 3. Reguły (`reconcile_bank_month`) — po imporcie wyciągu i przyciskiem „Uzgodnij automatycznie”

| Kolejność | Reguła | Skutek |
| --- | --- | --- |
| 1 | numer faktury w tytule + kwota = do zapłaty, jeden kandydat | rozliczenie automatyczne |
| 1 | kilka numerów w tytule, suma = przelew | rozliczenie automatyczne |
| 1 | dokument KSeF lub spoza KSeF oznaczony ręcznie jako opłacony + przelew z jego numerem i kwotą | ręczny wpis zamieniony na powiązanie z wyciągiem |
| 1 | numer w tytule, mniejsza kwota | propozycja (zaliczka / płatność częściowa) |
| 2 | płatność kartą w walucie: kwota oryginalna z wyciągu = faktura spoza KSeF w tej walucie, sprzedawca rozpoznany, data ±7 dni | rozliczenie automatyczne z kursem banku |
| 2 | jw., ale sprzedawca nierozpoznany / data dalej / kilka faktur | propozycja albo wybór |
| 2 | płatność kartą w walucie bez faktury | wskazówka „dodaj dokument” |
| 3 | przelew do ZUS lub na mikrorachunek podatkowy z okresem w tytule | przypisanie do deklaracji za okres (zakładana, gdy jej nie ma) |
| 3 | okres w tytule nie pasuje do daty przelewu (np. „DRA 02.2025” w marcu 2026) | wybór okresu |
| 3 | deklaracja ma kwotę, a przelew przekracza pozostałą do zapłaty | propozycja (nadpłata / korekta) |
| 4 | opłata bankowa, przelew podatkowy bez symbolu | wyjaśnione bez faktury (`accounting_explained_by = rule:…`) |
| 5 | wypłata z umowy: kwota + nazwisko lub rachunek odbiorcy + data ±10 dni, netto potwierdzone | powiązanie automatyczne |
| 5 | jw., netto niepotwierdzone (albo brak uprawnień kadrowych) | propozycja „Potwierdź netto i powiąż” |
| 5 | „WYNAGRODZENIE…” bez zapisanej wypłaty | wskazówka |
| 6 | umowa stała: rachunek kontrahenta = rachunek z umowy i kwota = kwota okresu (kierunek i waluta jak w umowie, umowa obowiązuje w dniu operacji) | przypięcie automatyczne do najwcześniejszego nieopłaconego okresu |
| 6 | umowa stała: rachunek zgodny, kwota inna (np. dwa miesiące w jednym przelewie) | propozycja z podziałem na okresy i różnicą |
| 6 | umowa stała: nazwa kontrahenta (albo NIP) w przelewie i kwota okresu | propozycja (zatwierdzenie dopisuje rachunek do umowy bez rachunku) |
| 6 | kilka umów z tym samym rachunkiem / kontrahentem i kwotą | wybór |
| 7 | zwrot płatności: jedna operacja przeciwnego kierunku tej działalności (także z sąsiedniego miesiąca) z równą pozostałą kwotą (co do grosza), datą ±45 dni i wspólnym wyróżniającym słowem w opisie albo tym samym rachunkiem kontrahenta | propozycja pary „płatność + zwrot” (bez faktury) |
| 7 | jw., kilka takich operacji | wybór |
| 8 | kwota = do zapłaty i kontrahent (NIP, rachunek znany z wcześniejszych płatności, nazwa) | propozycja |
| — | po ręcznym powiązaniu części faktury: płatność tego kontrahenta (ten sam rachunek, NIP albo nazwa) na dokładnie brakującą kwotę, data od 120 dni przed wystawieniem do 180 dni po terminie | propozycja „Druga część płatności” (sekcja 17) |
| 8 | kilka dokumentów z tą kwotą | wybór |
| 9 | przelew PLN za dokument w walucie: zapisana kwota obciążenia PLN albo kurs ±4% od średniej | automatycznie (kwota PLN) / propozycja (kurs) |
| 10 | płatność zbiorcza (Allegro, PayU…) = suma 2–6 faktur z okolic daty | propozycja |
| — | tytuł wskazuje fakturę, której nie ma | wskazówka |

Numery faktur są szukane jako osobne słowa (lub, gdy długie, bez separatorów); daty z opisów operacji są
usuwane, a numery wyglądające jak data („04-2026”) pomijane.

Decyzja człowieka jest ostateczna: odrzucona propozycja (`reject_bank_reconciliation_proposal`), cofnięte
dopasowanie (`undo_bank_match`), odpięta wypłata (`undo_bank_personnel_payment`), odpięta deklaracja
(`undo_bank_declaration_payment`), odpięta płatność umowy stałej (`undo_bank_recurring_contract_payment`), cofnięta para
„płatność + zwrot” (`undo_bank_refund_pair`) i cofnięte wyjaśnienie (`clear_bank_transaction_explanation`, zapis
`rejected:…`) nie wracają przy kolejnym uzgodnieniu. Każde uruchomienie zapisuje podsumowanie w
`bank_reconciliation_runs`. AI (panel miesiąca) może tylko podpowiadać — nie rozlicza samo.

## 4. Płatności w walutach

Faktury spoza KSeF (OpenAI, Cursor, Supabase, StackBlitz…) mają kwotę w walucie (`external_invoices.currency`).
Bank obciąża rachunek w PLN; przy płatności kartą wyciąg podaje kwotę oryginalną:

- MT940 (PKO): `0000000004403840169065 0706 <karta> SINGAPORE SG SUPABASE …` = 44,03 (13 cyfr) + kod waluty ISO
  840 (USD) + 6 cyfr referencji,
- PDF: `Lokalizacja: SUPABASE SINGAPORE SG … Kwota oryg.: 44,03 USD`.

Powiązanie zapisuje kwotę operacji w PLN (`amount`), kwotę dokumentu w walucie (`document_amount`,
`document_currency`) i kurs banku (`exchange_rate`). Sprzedawcę z opisu karty („BOLT”, „SINGAPORE”)
system uczy się z wcześniejszych powiązań.

## 5. Deklaracje ZUS i podatkowe (`finance_declarations`)

- jedna deklaracja = firma + symbol (DRA, PIT-4R, PIT-8AR, VAT-7, VAT-7K, CIT-8…) + okres (miesiąc, kwartał, rok),
- `amount_due` — kwota do zapłaty z deklaracji (NULL = jeszcze nie wpisana; deklaracja założona z przelewu),
- `finance_declaration_files` — pliki (PDF/XML z Płatnika, PUE, e-Deklaracji) w magazynie `finance-declarations`,
- `finance_declaration_lines` — rozbicie na osoby (składki społeczne ubezpieczonego i płatnika, zdrowotna,
  FP/FS/FGŚP, zaliczka PIT) z odwołaniem do umowy kadrowej; „Dodaj osoby z umów” podpowiada osoby z umowami
  w okresie,
- `finance_declaration_payments` — przelewy z wyciągów; status: zapłacona / niedopłata / nadpłata /
  brak płatności / brak kwoty z deklaracji.

Rozpoznanie przelewu: odbiorca ZUS (rachunek `xx 6000 0002 …`) albo mikrorachunek podatkowy
(`xx 1010 0071 2222 …`, „URZĄD SKARBOWY”), okres z tytułu (`DRA 03.2026`, `26M03`, `26K1`, `25R`),
symbol formularza także rozcięty przez MT940 (`PI T 4R`, `VA T 7`). Przelew na własny rachunek
(rachunek VAT → bieżący z tytułem „ZUS DRA…”) nie jest płatnością deklaracji.

## Szczegóły dokumentów, płatności częściowe i podgląd (01.11.2026)

- **Kilka dokumentów z tą samą kwotą** (np. faktura zaliczkowa 50% i końcowa na tę samą kwotę): przy każdym dokumencie
  widać rodzaj (zaliczkowa / rozliczeniowa / korekta — z XML KSeF, typu faktury CRM lub rodzaju dokumentu spoza KSeF),
  datę wystawienia, termin płatności i stan płatności. Jeśli dokładnie jeden dokument jest oznaczony ręcznie jako
  opłacony w dniu przelewu na tę samą kwotę, jest wskazany jako sugerowany i zaznaczony; dokument wystawiony po dacie
  przelewu ma o tym informację. Wybór nadal zatwierdza użytkownik (`get_bank_reconciliation_month`, migracja
  `20261101200000`).
- **Płatność częściowa (rata)**: „Wybierz dokument” rozlicza najwyżej tyle, ile zostało z płatności i z faktury.
  Gdy płatność jest mniejsza niż pozostała należność, przycisk ma nazwę „Dopasuj część” i pokazuje, ile zostanie do
  zapłaty. Kolejna płatność do tej samej faktury (druga rata) — sekcja 17. Faktura dostaje status „częściowo opłacona” i czeka na kolejną płatność (historia wpłat KSeF:
  `ksef_invoice_payments`, status liczony przez `recalculate_ksef_invoice_payment_status`). Przy rozliczonej operacji
  chip dokumentu pokazuje „faktura częściowo opłacona, pozostało …”.
- **Szczegóły płatności**: przy każdej operacji przycisk „Szczegóły płatności” otwiera pełne dane z wyciągu
  (rachunek kontrahenta, opisy z obu plików, wyciąg, powiązania).
- **Podgląd dokumentu**: „Podgląd” przy propozycji, w wyborze dokumentu i przy rozliczeniu — faktura KSeF jako
  wizualizacja XML, faktura CRM jako zapisany PDF lub wizualizacja, dokument spoza KSeF jako wgrany plik. Dostęp
  według uprawnień do finansów działalności (RLS faktur i magazynu plików).
- **Odrzucenie propozycji**: dokument nie wraca do tej płatności (także przy kolejnych uzgodnieniach), ale dla innych
  płatności — w tym i w kolejnych miesiącach — nadal czeka na dopasowanie; sam dokument niczego nie traci. Płatność
  wraca do „Brak dokumentu”. „Odrzuć i wybierz inny” od razu otwiera wybór dokumentu dla tej płatności.
- **Reguła „zgodna kwota” bez potwierdzenia kontrahenta** (migracja `20261101201000`): jedyny dokument o tej samej
  kwocie jest proponowany tylko przy kwocie co do grosza i zbliżonej dacie (karta: dokument od 3 dni przed do 14 dni
  po zakupie; przelew: wystawiony od 60 dni przed do 7 dni po albo termin od 30 dni przed do 14 dni po), i gdy
  przelew nie ma wyraźnie innego kontrahenta (pośrednicy płatności — Allegro, PayU, Przelewy24… — się nie liczą).

## 6. Umowy stałe — najem, leasing, abonament, raty (`finance_recurring_contracts`, migracja `20261101210000`)

Przykład: co miesiąc 450 zł do osoby prywatnej „MARIUSZ SKARUL”, tytuł „CZYNSZ GARAŻ NR 6, PRZY ULICY MARCINA KASPRZAKA 11…”,
rachunek 62 1140 2004 0000 3902 7077 4694 — najem na czas nieokreślony, bez faktur. Dokument spoza KSeF tego nie opisze
(jeden dokument = jedna kwota), dlatego umowa jest osobnym rejestrem, a przelewy przypisuje się do jej **okresów**.

- **Umowa**: działalność, rodzaj (najem, leasing, abonament, raty ubezpieczenia, kredyt / pożyczka, inna), kierunek
  (`cost` — płacimy, `income` — otrzymujemy), tytuł, kontrahent (nazwa, opcjonalnie NIP — **bez PESEL**), rachunek
  kontrahenta (same cyfry), kwota brutto na okres, waluta, cykl (miesiąc / kwartał / rok — okresy liczone od miesiąca
  początku umowy), dzień płatności (po nim nieopłacony okres jest „po terminie”; bez dnia — koniec pierwszego miesiąca
  okresu), początek, koniec (puste = czas nieokreślony), **„rozliczaj płatności od”** (umowa zawarta dawno: wcześniejsze
  okresy nie są pokazywane jako brak), status, „kontrahent wystawia faktury” (wtedy płatność rozlicza się z fakturą,
  a umowa tylko informuje — automat i ręczne przypięcie jej nie używają), notatki.
- **Pliki** umowy i aneksów: `finance_recurring_contract_files`, prywatny magazyn `finance-contracts`, ścieżka
  `{działalność}/{umowa}/{plik}`.
- **Płatności**: `finance_recurring_contract_payments` — umowa, okres (pierwszy dzień), operacja, kwota, `automatic` / `manual`,
  powody, kto, kiedy; jedna pozycja na (umowa, okres, operacja) — ponowne przypięcie do tego samego okresu sumuje kwotę.
- **Okresy** (`get_finance_recurring_contracts`): od pierwszego rozliczanego okresu do następnego miesiąca (i dalej, jeśli są
  przedpłaty), najwyżej do końca umowy. Status okresu: opłacony / nadpłata / brak płatności (termin jeszcze nie minął) /
  po terminie / przyszły / rozliczana fakturami.
- **Automat** (reguła 6 w tabeli wyżej): domyślny okres = najwcześniejszy nieopłacony, nie późniejszy niż miesiąc po dacie
  operacji. Nazwa kontrahenta pasuje, gdy pierwsze dwa znaczące słowa nazwy (bez form prawnych) są w treści przelewu
  („Mariusz Skarul” → MARIUSZ i SKARUL; samo imię nie wystarcza). Zatwierdzenie propozycji albo ręczne przypięcie do umowy
  bez rachunku dopisuje rachunek z przelewu — kolejne miesiące wiążą się już automatycznie. Podsumowanie przebiegu:
  `auto_contracts`.
- **Ręcznie**: „Przypisz do umowy (najem / abonament)” przy otwartej operacji (oba kierunki) —
  `link_bank_transaction_to_recurring_contract(operacja, umowa, okres = NULL, kwota = NULL)`; kwota domyślna = pozostała kwota
  operacji, najwyżej to, co zostało do zapłaty za okres. Okno podpowiada najlepiej pasującą umowę (rachunek, nazwa, kwota)
  i pozwala utworzyć „Nową umowę z tej płatności” (kontrahent, rachunek, kwota, początek = data operacji, cykl miesięczny,
  kierunek z operacji).
- **Odpięcie** (`undo_bank_recurring_contract_payment`) zapisuje odrzucenie — automat nie przypnie tej operacji ponownie do tej
  umowy; odrzucona propozycja działa tak samo.
- **Edycja**: przy umowie z płatnościami nie można zmienić kierunku ani waluty, a zmiana początku, cyklu, końca lub „rozliczaj od”
  nie może osierocić opłaconych okresów. Zmiana kwoty dotyczy wszystkich okresów — przy waloryzacji od danego miesiąca zakończ
  umowę datą i dodaj nową od kolejnego okresu. „Usuń” przy umowie z płatnościami kończy ją (zostaje w historii).
- **Widok miesiąca** (`get_bank_reconciliation_month`): przy operacji `contracts` (płatności umów, jak `declarations`);
  operacja przypisana w całości ma status „Rozliczona”. Na poziomie miesiąca `contracts` — umowy obowiązujące w miesiącu:
  należne za okresy zaczynające się w tym miesiącu, zapłacone w tym miesiącu, brak (karta „Umowy stałe: X opłacone,
  Y bez płatności”).
- **Uprawnienia**: odczyt — poziom finansów działalności ≥ `finance_view`; zmiany — `finance_manage` tej działalności,
  wyłącznie przez RPC (tabele bez INSERT/UPDATE/DELETE dla zalogowanych). Zwykły pracownik, inna działalność, konto portalu
  sprzedawcy i anon — brak dostępu (także do plików w magazynie).

## 7. Zwrot płatności bez faktury — para „płatność + zwrot” (`bank_transaction_refund_pairs`, migracja `20261103220000`)

Przykład: 12.08.2026 z rachunku bieżącego wyszło −107,00 zł (BLIK, w MT940 „…www.musicce nter.com.pl…”, w PDF „Lokalizacja:
www.musiccenter.com.pl”), a sklep — bez towaru i bez faktury — od razu oddał +107,00 zł. Obie operacje czekały na dokument,
choć faktury nie będzie. Ten sam mechanizm działa w drugą stronę: klient zapłacił, my zwróciliśmy.

- **Para**: działalność, operacja pierwotna (wcześniejsza — płatność), operacja zwrotu (późniejsza, przeciwny kierunek), kwota
  pary, `automatic` / `manual`, powody, kto, kiedy. Kwota pary liczy się do limitu kwoty **obu** operacji razem z fakturami,
  wypłatami, deklaracjami i umowami; operacja rozliczona w całości ma status „Rozliczona”. Jedna operacja może mieć kilka par
  (np. dwa zwroty częściowe jednej płatności albo jeden zwrot dwóch płatności).
- **Reguła automatu** (7 w tabeli wyżej, przed „zgodną kwotą”): operacja otwarta (bez wyjaśnienia, nie przeniesienie własne)
  i **dokładnie jedna** operacja przeciwnego kierunku z tej samej działalności i waluty — także z sąsiedniego miesiąca — która:
  ma pozostałą kwotę równą co do grosza, datę ±45 dni i
  * wspólne wyróżniające słowo w opisie (z tytułu, opisu i kontrahenta obu wyciągów, PDF i MT940). Porównanie także po
    usunięciu spacji, bo MT940 łamie słowa („MUSICCE NTER” = „MUSICCENTER”); kody pól MT940 („~32…”) są pomijane. Nie liczą
    się: słowa ogólne (PRZELEW, PŁATNOŚĆ, ZAKUP, ZWROT, KARTA, BLIK, GODZ, LOKALIZACJA, WWW, COM, POLSKA, WŁASNA, formy prawne,
    stopki wyciągów, duże miasta, nazwy miesięcy…), liczby, słowa z nazwy i adresu własnej działalności oraz słowa częste po obu
    stronach rachunku (≥ 5 wydatków i ≥ 5 wpływów w ±120 dniach — np. nazwisko właściciela, kontrahent z obrotami w obie strony),
  * albo ten sam rachunek kontrahenta (nie własny),

  → propozycja do zatwierdzenia (źródło dokumentu `refund`: druga operacja — data, kwota, kierunek, sprzedawca / kontrahent,
  tytuł, dowód). Kilka takich operacji → wybór (do 5). **Nigdy automatycznie** — parę zatwierdza człowiek. Propozycja powstaje
  po obu stronach; zatwierdzenie jednej tworzy parę i zamyka propozycję tej samej pary po drugiej stronie (oraz propozycje
  innych operacji wskazujące operację rozliczoną teraz w całości). Odrzucenie po jednej stronie zamyka propozycję po drugiej,
  a para nie wraca przy kolejnych uzgodnieniach **po żadnej ze stron**. Podsumowanie przebiegu: `refund_proposals`
  (liczba operacji z propozycją pary). Płatność kartą w obcej walucie bez faktury kończy się wcześniej wskazówką reguły
  „karta w walucie” — taki zwrot łączy się ręcznie.
- **Ręcznie**: „Powiąż ze zwrotem” przy otwartej operacji (oba kierunki) — okno z operacjami przeciwnego kierunku tej
  działalności z ±90 dni, które mają jeszcze kwotę do rozliczenia (`get_bank_refund_candidates`): najpierw ta sama kwota,
  potem wspólne słowo / rachunek, potem bliskość daty; przy każdej powody po polsku, wyszukiwanie (sklep, opis, kwota, data)
  i „Szczegóły płatności”. `link_bank_refund_pair(operacja, druga operacja, kwota = NULL)` — kwota domyślna = mniejsza
  z pozostałych kwot obu operacji; kontrola: przeciwny kierunek, ta sama działalność i waluta, kwota ≤ pozostałej po obu
  stronach. Która operacja jest płatnością, wynika z daty (wcześniejsza; ten sam dzień — kolejność w wyciągu). Para odrzucona
  albo cofnięta wcześniej jest w oknie oznaczona, ale ręcznie można ją powiązać (decyzja człowieka).
- **Zwrot częściowy** (np. sklep oddał część zamówienia): wpisz kwotę zwrotu — płatność zostaje „Częściowo rozliczona”,
  a reszta czeka na fakturę (dopasujesz ją jak zwykle; limit kwoty operacji obejmuje parę i fakturę). Zwrot w kolejnym
  miesiącu: para łączy operacje z różnych wyciągów; przy każdej widać drugą stronę z datą.
- **Widok miesiąca** (`get_bank_reconciliation_month`): przy operacji `refunds` — para (`pair_id`, rola tej operacji:
  `payment` / `refund`, kwota pary, metoda, powody) i druga operacja (`other`: id, data, kwota, kierunek, sprzedawca / kontrahent,
  tytuł, wyciąg). Chip „Zwrot: +107,00 zł z 12.08 · www.musiccenter.com.pl” przy płatności i „Zwrócona płatność: −107,00 zł z
  12.08 · …” przy zwrocie, z „Cofnij”.
- **Cofnięcie** (`undo_bank_refund_pair`): obie operacje wracają do rozliczenia, a odrzucenie zapisane po obu stronach blokuje
  ponowne automatyczne zaproponowanie tej pary.
- **Księgowo**: para płatność + zwrot bez faktury jest udokumentowana wyciągiem — dwie operacje się znoszą, nie ma kosztu ani
  przychodu. Przy zwrocie częściowym reszta płatności nadal wymaga faktury (albo innego wyjaśnienia).
- **Uprawnienia**: jak umowy stałe — odczyt poziom finansów działalności ≥ `finance_view`, zmiany `finance_manage` tej
  działalności, wyłącznie przez RPC (tabela bez INSERT/UPDATE/DELETE dla zalogowanych). Zwykły pracownik, inna działalność,
  konto portalu sprzedawcy i anon — brak dostępu.
- **safeupdate**: Supabase odrzuca w wywołaniach z API każde UPDATE / DELETE bez WHERE (także w funkcjach). Migracja kończy się
  kontrolą treści wszystkich funkcji plpgsql / sql w `public` i `private` i przerywa się, jeśli któraś ma takie polecenie
  (SQL dynamiczny w `EXECUTE '…'` nie jest sprawdzany).

## 8. Faktura korygująca „in minus” — zwrot, płatność faktury korygowanej i kompensata (25.11.2026)

Przykład: FV 45622/2026 (109,90 zł) opłacona kartą przy zakupie („Zapłacono” w XML), potem korekta FK 2490/2026 na −109,90 zł
i zwrot na konto. Korekta była „Nieopłacona”, a zwykłe „Dopasuj płatność” szukało wypłat (zwrot jest wpływem).

- **Stan**: dokument KSeF z ujemną kwotą do zapłaty ma w zakładce KSeF (CRM i Mac) stan „Korekta do rozliczenia” /
  „Częściowo rozliczona” / „Korekta rozliczona” / „Korekta po terminie”, „Oznacz jako rozliczoną” zamiast „…opłaconą”.
- **Okno „Rozlicz korektę / zwrot”** (CRM `KsefCorrectionSettlementModal`, Mac `FinKsefCorrectionSheet`, logika
  `src/lib/invoices/ksefCorrectionSettlement.ts`, bez migracji):
  * faktura korygowana z XML korekty (`DaneFaKorygowanej`: `NrKSeFFaKorygowanej`, a bez niego `NrFaKorygowanej` + ten sam NIP
    kontrahenta; ta sama działalność i strona). Brak w CRM — ostrzeżenie (zsynchronizuj KSeF za miesiąc jej wystawienia);
  * **płatność faktury korygowanej**: powiązane operacje (z „Odepnij” — `undo_bank_match`) i operacje do powiązania: operacje
    główne działalności (bez kopii z drugiego wyciągu, przeniesień własnych i par VAT) w kierunku płatności dokumentu, w walucie
    dokumentu, od −60 do +180 dni od wystawienia, z pozostałą kwotą. Kolejność: zgodna pozostała kwota (+5) albo kwota jak na
    fakturze (+3), numer faktury / KSeF w opisie (+4), NIP (+2), słowo z nazwy kontrahenta bez formy prawnej (+2), data ≤ 7 dni
    (+2) / ≤ 30 dni (+1). Domyślnie do 10 z oceną ≥ 3, „Pokaż wszystkie z okresu” (do 100), wyszukiwanie (do 50);
  * **zwrot korekty**: to samo w kierunku przeciwnym (kosztowa — wpływ), od 14 dni przed wcześniejszą z dat faktur do +180 dni
    od korekty; numer faktury korygowanej w opisie też się liczy;
  * „Powiąż” = `match_bank_transaction_to_documents` z kwotą = mniejsza z pozostałej operacji i pozostałej faktury. Faktura
    o statusie „opłacona” (także z XML, bez wpisów w rejestrze) idzie przez `reconcile_paid_ksef_invoice_with_bank_transaction`:
    oznaczenie zamienia się na powiązanie z wyciągiem. Kierunek, działalność, waluta, limit kwot i okresy zamknięte — jak przy
    każdym dopasowaniu (baza);
  * **kompensata** (korekta ujemna, faktura korygowana dodatnia, ta sama waluta, faktura korygowana nie jest „opłacona”):
    wpłata w rejestrze korekty „Kompensata z fakturą korygowaną <numer>” i faktury korygowanej „Kompensata korektą <numer>”
    (ta sama kwota ≤ mniejszej z pozostałych, data), bez operacji bankowej; gdy druga wpłata się nie zapisze — pierwsza jest
    usuwana. „Cofnij kompensatę” usuwa obie. Faktura korygowana „opłacona” kompensatą i inną wpłatą ręczną nie przyjmie
    operacji z wyciągu, dopóki nie usuniesz tej wpłaty ręcznej (zamiana oznaczenia usuwa najnowsze wpłaty ręczne — mogłaby
    zabrać wpłatę kompensaty bez drugiej strony).
- **Para „płatność + zwrot”** (sekcja 7) pozostaje dla zwrotów bez faktury: gdy jest faktura i korekta, obie operacje
  rozliczają faktury (para zajęłaby kwoty operacji).
- **Uprawnienia**: odczyt — dostęp do faktur działalności; zmiany — „Zarządzanie finansami” działalności (RPC dopasowań, RLS
  rejestru wpłat; trasa Maca sprawdza to przed zapisem).

## 9. Zakupy pracowników firmową kartą (25.11.2026)

Pracownik z uprawnieniem „Zakupy — własne wydatki” wprowadza paragony i faktury swoich zakupów (`docs/purchases.md`). Dokument
zakupu to zwykły dokument spoza KSeF z `purchased_by` — kartą, gotówką albo BLIK-iem „opłacony” w dniu zakupu, więc operację
karty z wyciągu dopasowuje się do niego jak do każdego opłaconego dokumentu (zamiana oznaczenia na powiązanie z wyciągiem).
W „Moich wydatkach” zakup pokazuje wtedy „Powiązany z wyciągiem”. Dokumentu powiązanego z wyciągiem pracownik nie usunie ani
nie zmieni mu kwoty, waluty, działalności i sposobu zapłaty.

## 10. „Co do czego pasuje” przy propozycji i import wyciągu na Macu (26.11.2026)

- **Porównanie przy propozycji** (`src/lib/invoices/proposalComparison.ts`, CRM `ProposalComparisonTable`, Mac
  `ReconciliationInspector`): pod dokumentem z propozycji (przy wyborze — pod zaznaczonym) tabela „Co do czego pasuje”:
  płatność z wyciągu obok dokumentu, wiersz po wierszu, z zaznaczonym fragmentem, który się zgadza, i oceną
  (zgadza się / do sprawdzenia / nie zgadza się / bez porównania):
  - **Kwota** — pozostała kwota płatności (przy przelewie na kilka dokumentów: część na ten dokument) wobec kwoty do
    zapłaty, pozostałej należności albo kwoty oznaczonej ręcznie; różnica jako „płatność częściowa — brakuje …” albo
    „przelew większy o …”; dokument w walucie — przeliczenie kursem.
  - **Kontrahent** — NIP z dokumentu w treści przelewu, ten sam rachunek kontrahenta co we wcześniejszych płatnościach
    albo słowa z nazwy kontrahenta w nazwie / tytule / opisie operacji (dowód zapisany przez regułę; bez dowodu — pierwsze
    znaczące słowa nazwy, jak w regule). Przy regule „zgodna kwota” bez potwierdzonego kontrahenta — „nie zgadza się”.
  - **Numer dokumentu** — numer w tytule lub opisie (także bez spacji i ukośników); przy płatności kartą brak numeru jest
    normalny.
  - **Data** — data operacji wobec daty wystawienia i terminu, w tych samych oknach co reguła (karta: od 3 dni przed do
    14 dni po wystawieniu; przelew: wystawiony od 60 dni przed do 7 dni po albo termin od 30 dni przed do 14 dni po).
  - **Oznaczenie ręczne** — gdy dokument jest już oznaczony jako opłacony: data oznaczenia wobec daty operacji
    (zatwierdzenie zamienia oznaczenie na powiązanie z wyciągiem, bez podwójnej zapłaty).
  Porównanie liczy serwer CRM z danych propozycji (bez zmian w bazie); dotyczy faktur KSeF, CRM i dokumentów spoza KSeF
  (deklaracje, umowy stałe i zwroty mają własne opisy). Nagłówek podsumowuje: „Zgadza się: … · Sprawdź: …”.
- **Import wyciągu na Macu**: okno „Wgraj wyciąg” w czasie odczytu i zapisu pokazuje nakładkę z postępem i blokuje przyciski
  oraz zamknięcie okna — drugie kliknięcie „Importuj” nie wyśle pliku ponownie (wcześniej postęp był w oknie głównym, pod
  arkuszem, a powtórne wysłanie kończyło się komunikatem „MT940 … jest już zapisany”). Tak samo pozostałe okna Finansów
  oparte na `BankSheetFrame` (wybór dokumentu, wyjaśnienie, deklaracje, umowy stałe, zwroty, wpisy, zapłaty i korekty).

## 11. Okno postępu, „Dopasowane faktury (PDF)” i operacje zaksięgowane w następnym miesiącu (26.11.2026)

- **Okno postępu** (CRM `PendingOverlay`, Mac `FinanceBankStore.reconcileAction`): „Zatwierdź”, „Odrzuć”, „Cofnij”,
  „Uzgodnij automatycznie” i zapis w oknach (wybór dokumentu, wyjaśnienie, deklaracja, umowa stała, zwrot) pokazują okno
  postępu od kliknięcia do odświeżonej listy — wcześniej znikało po zapisie, a przez kilka sekund lista pokazywała starą
  propozycję, jakby nic się nie stało. Okno blokuje drugie kliknięcie; w CRM lista nie znika przy odświeżeniu.
- **„Dopasowane faktury (PDF)”** (przycisk obok „Braki (CSV)”, CRM i Mac): jeden PDF dla księgowej — zestawienie płatności
  z wyciągów miesiąca z przypisanymi dokumentami (data, rachunek, kontrahent, kwota, dokumenty, „str.” — strona, na której
  zaczyna się dokument) i za nim same dokumenty: faktury z KSeF (wizualizacja jak w Dysku), faktury CRM (wydruk) i dokumenty
  spoza KSeF (wgrany PDF albo zdjęcie JPG / PNG — strona A4). Dokument opłacony kilkoma przelewami jest w pliku raz. Dokument
  bez pliku, w innym formacie (HEIC, WebP) albo z uszkodzonym PDF — na liście „Bez pliku w zestawieniu” z powodem.
  Liczy serwer CRM (`financeMatchedDocumentsPdf` w `drive.server.ts`, szablon `matchedDocumentsPdf.server.ts`; dostęp
  i pliki jak w Dysku → Finanse, „Podgląd finansów” działalności); plik trafia do magazynu Finansów (jeden na działalność
  i miesiąc) i pobiera się przez podpisany adres. Mac — plik w Pobranych, zaznaczony w Finderze (do przeciągnięcia
  do wiadomości). Natywne API: `GET …/finance/bank?op=matchedPdf&company&year&month` albo `POST { op: 'matchedPdf' }`.
- **Operacja z innego miesiąca niż wyciąg** (`bankBookingDate.ts`): MT940 podaje datę operacji, a bank księguje ją
  później — np. płatność kartą albo wpływ z 29.09 zaksięgowany 01.10 jest na wyciągu za październik (wyciąg za wrzesień jej
  nie ma). Taka operacja należy do miesiąca wyciągu: tam się ją rozlicza i tam widzi ją księgowa. Uzgodnienie wyciągów
  pokazuje pod datą operacji „księg. 01.10”, a Przekazanie księgowej („Braki i do dosłania”) — datę księgowania
  z wyjaśnieniem i kolejność listy po dacie księgowania. Dopasowanie (np. karta w dniu wystawienia faktury) nadal liczy się
  od daty operacji.

## 12. Stan filtrów, „Wszystkie dokumenty” i drzewo sekcji Finansów (26.11.2026)

- **Stan filtrów w oknie „Dopasuj dokument do płatności”** (CRM `BankTransactionDocumentPickerModal`, Mac
  `BankDocumentPickerSheet`): filtry działają od razu po zmianie, a pod nimi jest wiersz stanu (`FilterSummaryBar`,
  na Macu `FinFilterSummary`) — „Pokazano 14 z 212”, etykieta każdego włączonego filtra (typ, status, wystawione od / do,
  wyszukiwanie; × wyłącza jeden) i „Wyczyść filtry”; bez filtrów — „Bez filtrów · 212 dokumentów”. Zmienione pole filtra
  ma złotą obwódkę i tło; lista typów pokazuje liczbę dokumentów każdego typu. Pusta lista przy włączonych filtrach — ich
  lista i „Wyczyść filtry”. Na Macu zakres „od” / „do” po włączeniu zaczyna od trzech miesięcy przed płatnością do dnia płatności.
- **„Wszystkie dokumenty”** (CRM: Finanse → Dokumenty → Wszystkie dokumenty; Mac: Finanse → Koszty i dokumenty →
  Wszystkie dokumenty): jeden rejestr faktur z KSeF (wystawione i otrzymane), faktur CRM (bez tych, które są już w KSeF pod
  tym samym numerem) i dokumentów spoza KSeF (faktury zagraniczne, paragony, polisy, noty). Filtry: źródło (Wszystkie /
  KSeF / CRM / Spoza KSeF — z liczbą dokumentów), rodzaj (kosztowe / sprzedażowe), stan zapłaty (nieopłacone — także częściowo
  i po terminie, po terminie, opłacone) i wyszukiwanie, z tym samym wierszem stanu. Jeden stan zapłaty dla wszystkich źródeł
  liczy `src/lib/invoices/documentRegister.ts` (status zapłaty, szkic / anulowana, termin wobec dnia w Polsce). Mac: zakres
  dat wystawienia (domyślnie od początku miesiąca sprzed dwóch miesięcy), dwuklik — podgląd (KSeF z XML, faktura CRM — PDF,
  spoza KSeF — wgrany plik), „Otwórz w CRM”, „Dodaj dokument spoza KSeF” (CRM — wgranie pliku z odczytem danych). Natywne
  API: `GET …/finance/bank?op=documents&company&from&to` (`documentRegister`, „Podgląd finansów” działalności, RLS).
- **Drzewo sekcji Finansów w CRM** (`FinanceNavTree`): sekcje są w drzewie po lewej, pogrupowane jak na Macu — Przegląd
  (Centrum finansów, Przegląd finansowy), Bank (Wyciągi i płatności, Uzgodnienie wyciągów), Podatki i terminy (Terminy i monity,
  ZUS i podatki, Umowy stałe, Dla księgowej), Dokumenty (Wszystkie dokumenty, Faktury sprzedaży, KSeF, Dokumenty spoza KSeF,
  Umowy personelu), Koszty i rozliczenia (Koszty i wypłaty, Sprzedawcy i prowizje), Ustawienia (Ustawienia faktur). Zastępuje
  zakładki strony i drugi rząd zakładek „Dokumentów i rozliczeń”; adresy bez zmian (`?tab=…&section=…`), więc linki
  i powiadomienia prowadzą w to samo miejsce. Sprzedawca widzi jak dotąd: Przegląd finansowy, Moje faktury, Sprzedawcy
  i prowizje. Poniżej szerokości `xl` (laptop z paskiem bocznym CRM) — lista wyboru z grupami, żeby tabele miały całą szerokość.

## 13. Zatwierdzenie propozycji przy różnicy 1 grosza z ręcznym oznaczeniem zapłaty (26.11.2026)

Faktura KSeF oznaczona wcześniej ręcznie jako opłacona (np. FKO/8/2026: do zapłaty 11 515,87 zł) i przelew klienta
o grosz wyższy (11 515,88 zł). Propozycja „Zgodna kwota i kontrahent” traktuje taki grosz jako zaokrąglenie, ale
zatwierdzenie kończyło się w bazie błędem „Nie udalo sie przygotowac platnosci recznej do zamiany” —
`reconcile_paid_ksef_invoice_with_bank_transaction` po zastąpieniu ręcznej wpłaty zostawała z 0,01 zł i przerywała zapis.
Nic się nie zapisywało, a po odświeżeniu propozycja wracała (CRM i Mac — ta sama funkcja bazy). Migracja
`20261202160000_ksef_manual_payment_grosz_tolerance.sql` przyjmuje resztę do 1 grosza jako zaokrąglenie, tak jak pozostałe
warunki tej funkcji i `match_bank_transaction_to_document`; większa różnica nadal zatrzymuje zapis. Funkcja jest poprawiana
w miejscu (aktualna treść z bazy, jedna zmiana warunku, uprawnienia bez zmian). Po zatwierdzeniu płatność jest rozliczona
w całości, a faktura opłacona z wyciągu (ręczne oznaczenie zastąpione powiązaniem bankowym, bez podwójnej zapłaty).

## 14. Działalności, a nie marki; dokument spoza KSeF — domyślna działalność i rozpoznanie po NIP-ie (26.11.2026)

- **Działalność a marka** (`src/lib/invoices/financeEntities.ts`): finanse prowadzi się dla działalności — podmiotu z NIP
  (Mavinci, NASTROJOWO). Marka bez NIP (Event Rulers) realizuje wydarzenia, ale nie ma własnych finansów, więc nie ma jej
  w listach działalności: dokument spoza KSeF, koszty i wypłaty, przegląd finansowy, konfiguracja i ustawienia KSeF,
  numeracja faktur, wystawianie faktury (nowa, edycja, z wydarzenia, końcowa), deklaracje, umowy stałe, Saldeo, wybór firmy
  na ekranach finansów (`CompanySelector` z poziomem dostępu), „Finanse według działalności” w uprawnieniach pracownika
  (CRM i Mac — zapis nie zostawia poziomów dla marek), umowy personelu (migracja
  `20261202170000_personnel_companies_without_brands.sql`) i listy na Macu (faktura, edycja, faktura końcowa). Wcześniej
  pomijały ją już Centrum finansów, terminy, zamknięcia, zakupy i serwer Finansów na Macu. Bez zmian: wybór marki
  realizującej wydarzenie i „Marki i spółki” w uprawnieniach. Formularz edycji zachowuje firmę zapisaną w dokumencie.
- **Dodaj dokument spoza KSeF** (`InvoiceFormModal`): nowy dokument ma od razu domyślną działalność (Mavinci), więc „Odczytaj
  AI” działa bez wybierania. Po odczycie NIP nabywcy z dokumentu wskazuje działalność (`financeEntityByNip` — NIP bez
  „PL”, myślników i spacji): inna niż wybrana — formularz sam się na nią przełącza („Dokument jest wystawiony na
  NASTROJOWO… — ustawiono tę działalność”); zgodna — potwierdzenie; NIP spoza działalności — ostrzeżenie. Z rozliczenia
  miesiąca (działalność ustalona z góry) tylko ostrzeżenie. Bez wybranej działalności odczyt idzie z domyślną (uprawnienia
  funkcji odczytu `extract-external-invoice` — bez zmian), a działalność ustala NIP nabywcy.

## 15. Umowy stałe — skan wielostronicowy łączony w jeden PDF (26.11.2026)

- **Skaner w trybie wielostronicowym** (`ScannerCaptureModal`, `multiPage`): pierwszy skan („Skanuj pierwszą stronę”)
  nie zamyka okna — strony trafiają na listę „Zeskanowano: N stron · rozmiar”. „Dodaj stronę” skanuje kolejną (z podajnika
  może przyjść kilka stron naraz), każdy skan można obejrzeć, przestawić (↑/↓) i usunąć. „Zakończ — połącz w PDF” łączy
  skany w kolejności z listy w jeden plik (`pdf-lib` w przeglądarce, `copyPages` — bez ponownej kompresji obrazów).
  Zamknięcie z niepołączonymi stronami pyta o potwierdzenie. Przy limicie rozmiaru (`maxBytes`) „Zakończ” jest zablokowane
  z podpowiedzią (niższa jakość, np. 200 DPI, albo skala szarości). Faktury — bez zmian: jeden skan to jeden plik.
- **Formularz umowy** (`RecurringContractFormModal` — „Nowa umowa stała”, edycja, „Nowa umowa z tej płatności”): sekcja
  „Skan lub plik umowy” z przyciskami „Skanuj umowę” i „Dodaj plik” (kilka plików). Pliki czekają na liście (podgląd,
  usuń) i wgrywają się po zapisaniu umowy („Wgrywanie plików 1/2…”); skan dostaje nazwę „<tytuł umowy> — skan RRRR-MM-DD.pdf”.
  Błąd pliku nie cofa zapisanej umowy — komunikat mówi, ile plików nie weszło, i odsyła do szczegółów umowy. Zamknięcie
  formularza z niezapisanymi plikami pyta o potwierdzenie. Skaner otwiera się nad formularzem (`Modal.layerClassName`).
- **Szczegóły umowy** → „Pliki umowy i aneksów”: obok „Dodaj plik” przycisk „Skanuj” — połączony PDF od razu trafia do plików
  umowy. Wgrywanie w obu miejscach to ta sama funkcja (`uploadContractFile`: magazyn `finance-contracts`
  `firma/umowa/…`, rejestr `add_finance_recurring_contract_file`, przy błędzie rejestru plik jest usuwany z magazynu).
  Limit pliku 20 MB (jak w magazynie).

## 16. Umowy stałe na Macu i natywny skaner (26.11.2026)

- **Mac — Finanse → Umowy stałe** (`desktop/mac/Sources/Mavinci/Finance/FinanceContractsView.swift`): rejestr jak
  `RecurringContractsPanel` — lista z kratkami okresów i podsumowaniem, kafelki (aktywne, miesięcznie, po terminie),
  szczegóły (okresy, przelewy z odpięciem i przejściem do uzgodnienia, pliki z podglądem), dodawanie, edycja (status),
  usuwanie albo zakończenie umowy z płatnościami. Formularz wspólny z „Nowa umowa z tej płatności” w uzgodnieniu.
- **Serwer** (`src/lib/native/financeBank.ts`, trasa `/bridge/native/v1/finance/bank`): `op=recurring` (rejestr działalności,
  zdanie podsumowania z `recurringContractSummarySentence`), `saveContract` z `id` i `status` (zmiana; umowa musi należeć
  do działalności z formularza), `contractDelete` (pliki z magazynu po usunięciu), `contractFile` (multipart, nazwa pliku
  w osobnym polu `fileName` — polskie znaki), `contractFileRemove`, `file&kind=contract`. Odpięcie przelewu — `undo`
  z `kind=contract`. Uprawnienia: „Podgląd finansów” do odczytu, „Zarządzanie finansami” do zmian; funkcje bazy jak w CRM.
- **Skan umowy na Macu** (`Scanner/DocumentScanner.swift`): ImageCaptureCore (skanery na kablu, udostępnione i sieciowe —
  AirScan / eSCL), strony jako miniatury („Dodaj stronę”, przestawianie, usuwanie), „Zakończ” łączy je w PDF (PDFKit).
  W formularzu pliki wgrywają się po zapisie umowy; w szczegółach — od razu. Ten sam skaner: Mavinci → „Skanuj dokument
  do PDF…” (zapis w wybranym miejscu).

## 17. Płatność częściowa — kolejny przelew do tej samej faktury i propozycja brakującej części (26.11.2026)

Przykład: faktura kosztowa V/093/10/2026 na 15 185,58 zł płacona dwoma przelewami po 7 592,79 zł (08.10 i 19.10), do tego
ręczne oznaczenie zapłaty 7 592,79 zł z 22.10. Po dopasowaniu przelewu z 19.10 okno „Dopasuj dokument do płatności”
blokowało fakturę dla przelewu z 08.10 („Dokument ma już zapisane powiązanie z płatnością”), a faktura była „Opłacona”
(ręczny wpis + jeden przelew), choć wyciąg potwierdzał połowę. Migracja `20261202180000_bank_partial_payment_remainder.sql`:

- **Okno wyboru dokumentu** (`get_bank_transaction_document_picker_items`, CRM `BankTransactionDocumentPickerModal`, Mac
  `BankDocumentPickerSheet`, wspólna logika `src/lib/bankPickerAllocation.ts`): dokument z częściowym powiązaniem przyjmuje
  kolejną płatność, dopóki część kwoty nie jest potwierdzona przelewem — status „Częściowo opłacona”, pod nim „z wyciągu
  X · brakuje Y”, przycisk „Dopasuj resztę” (albo „Dopasuj część”, gdy płatność jest mniejsza niż brak). Nowe kolumny
  funkcji: `bank_matched_amount` (ile potwierdzają przelewy) i `manual_paid_amount` (ile oznaczono ręcznie bez przelewu —
  w oknie „oznaczono ręcznie X — do potwierdzenia przelewem”). Zablokowany jest tylko dokument w całości potwierdzony
  wyciągiem („Dokument jest już w całości potwierdzony płatnościami z wyciągu”).
- **Ręczne oznaczenie ustępuje przelewowi** (`match_bank_transaction_to_document`, faktura KSeF): do powiązania zostaje kwota
  do zapłaty minus przelewy z wyciągu; gdy przelew razem z ręcznymi wpisami przekroczyłby kwotę faktury, najnowsze ręczne
  wpisy są zmniejszane albo usuwane (powód powiązania: „Zastąpiono ręczne oznaczenie płatności powiązaniem z wyciągiem”).
  Stary status „opłacona” bez historii wpłat jest najpierw zachowany jako wpis ręczny. W przykładzie: przelew z 08.10
  zastępuje ręczny wpis z 22.10 — faktura „Opłacona” dwoma przelewami z wyciągu. Faktury CRM i dokumenty spoza KSeF
  przyjmowały już kolejne przelewy (`paid_amount`, `reconcile_external_invoice_with_bank_transaction`).
- **Propozycja brakującej części** (reguła `reszta_platnosci`, „Druga część płatności (brakująca kwota faktury)”): po ręcznym
  powiązaniu (okno wyboru, zatwierdzona propozycja, zamiana ręcznego oznaczenia) wyzwalacz
  `zzz_bank_match_remainder_proposal` → `private.propose_bank_payment_remainder` szuka płatności tej działalności na dokładnie
  brakującą kwotę (co do grosza; kierunek i waluta jak dokument), od tego samego kontrahenta — ten sam rachunek co płatność
  właśnie powiązana, NIP albo nazwa w treści przelewu — z datą od 120 dni przed wystawieniem do 180 dni po terminie. Pomija
  płatności rozliczone, wyjaśnione, przeniesienia własne, operacje z otwartą propozycją i te, przy których człowiek odrzucił
  ten dokument. Z kilku pasujących wybiera najbliższą terminowi (opis podaje, ile ich jest). Zatwierdza człowiek — jak każdą
  propozycję; część oznaczona ręcznie idzie przez zamianę ręcznego oznaczenia. Błąd propozycji nie zatrzymuje dopasowania.
  Komunikat po dopasowaniu części podaje proponowaną płatność („Proponowana druga część: płatność z 08.10.2026 na
  7 592,79 zł — zatwierdź ją w uzgodnieniu”). „Uzgodnij automatycznie” odtwarza taką propozycję regułą „zgodna kwota
  i kontrahent” (część otwarta albo oznaczona ręcznie).
- **Okno na Macu** (`Finance/BankMatchWindow.swift`): „Wybierz dokument” otwiera osobne, pływające okno w rozmiarze dawnego
  okna modalnego — przesuwanie, skalowanie (minimum 640 × 420), nad oknami Mavinci także na pełnym ekranie (to samo biurko,
  bez nowego okna pełnoekranowego), chowa się po przejściu do innej aplikacji. Jedno okno na płatność.
- **Sortowanie listy dokumentów** (CRM i Mac): najbliższa kwota (domyślnie), data — najnowsze / najstarsze, kontrahent A–Z,
  status — do zapłaty najpierw (np. po wyszukaniu kwoty — po dacie albo kontrahencie).
