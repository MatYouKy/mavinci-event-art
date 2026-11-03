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
  zapłaty. Faktura dostaje status „częściowo opłacona” i czeka na kolejną płatność (historia wpłat KSeF:
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
