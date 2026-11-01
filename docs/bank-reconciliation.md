# Uzgadnianie wyciągów bankowych

Ekran: **Faktury → Dokumenty i rozliczenia → Uzgodnienie wyciągów** (`BankReconciliationPanel`) oraz
**ZUS i podatki** (`FinanceDeclarationsPanel`). Logika jest w bazie (migracje
`20261101120000_bank_reconciliation_engine.sql` i `20261101130000_finance_declarations_payroll_fx.sql`);
ekrany tylko ją pokazują.

## 1. Dwa wyciągi → jedna potwierdzona lista operacji

Każdy miesiąc rachunku wgrywamy dwa razy (PDF i MT940) — kontrolnie. `confirm_bank_statement_sources`
paruje operacje obu plików:

1. po saldzie po operacji (kwota, kierunek, saldo — jednoznaczne, daty ±7 dni),
2. gdy bank inaczej ułożył operacje z jednego dnia — po kwocie, kierunku i kolejności (daty ±3 dni).

Operacją główną jest wiersz z MT940 (pełne tytuły, rachunek kontrahenta). Wiersz z PDF dostaje
`canonical_transaction_id` (kopia) i zostaje jako potwierdzenie; jego opis jest widoczny przy operacji.
Rozliczenia, wypłaty, płatności deklaracji i wyjaśnienia zapisane na kopii przechodzą na operację główną.
`source_confirmation`: `confirmed` (jest w obu plikach), `unconfirmed` (brak w drugim pliku — do
sprawdzenia), `single_source`. Usunięcie pliku z operacjami głównymi przenosi wszystko na kopię z drugiego pliku.

## 2. Blokady podwójnego rozliczenia (wyzwalacze, niezależnie od ekranu)

- operacja nie może być rozliczona ponad swoją kwotę — **faktury, wypłaty i deklaracje liczą się razem**
  (`private.bank_transaction_allocated`),
- faktura nie może być opłacona z wyciągu ponad należność — razem z jej kopiami w innych źródłach
  (KSeF ↔ faktura CRM, ten sam numer, strona, NIP i kwota w KSeF / CRM / spoza KSeF); dla dokumentów
  w walucie liczy się kwota w walucie dokumentu,
- nie można rozliczać kopii operacji, transferu bieżący ↔ VAT ani roboczej kopii faktury
  (wpis KSeF bez numeru KSeF obok tej samej faktury z numerem),
- płatność deklaracji musi być przelewem wychodzącym tej samej firmy.

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
| 6 | kwota = do zapłaty i kontrahent (NIP, rachunek znany z wcześniejszych płatności, nazwa) | propozycja |
| 6 | kilka dokumentów z tą kwotą | wybór |
| 7 | przelew PLN za dokument w walucie: zapisana kwota obciążenia PLN albo kurs ±4% od średniej | automatycznie (kwota PLN) / propozycja (kurs) |
| 8 | płatność zbiorcza (Allegro, PayU…) = suma 2–6 faktur z okolic daty | propozycja |
| — | tytuł wskazuje fakturę, której nie ma | wskazówka |

Numery faktur są szukane jako osobne słowa (lub, gdy długie, bez separatorów); daty z opisów operacji są
usuwane, a numery wyglądające jak data („04-2026”) pomijane.

Decyzja człowieka jest ostateczna: odrzucona propozycja (`reject_bank_reconciliation_proposal`), cofnięte
dopasowanie (`undo_bank_match`), odpięta wypłata (`undo_bank_personnel_payment`), odpięta deklaracja
(`undo_bank_declaration_payment`) i cofnięte wyjaśnienie (`clear_bank_transaction_explanation`, zapis
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
