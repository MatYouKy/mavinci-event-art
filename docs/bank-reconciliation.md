# Uzgadnianie wyciągów bankowych

Ekran: **Faktury → Dokumenty i rozliczenia → Uzgodnienie wyciągów** (`BankReconciliationPanel`).
Logika jest w bazie (migracja `20261101120000_bank_reconciliation_engine.sql`); ekran tylko ją pokazuje.

## 1. Dwa wyciągi → jedna potwierdzona lista operacji

Każdy miesiąc rachunku wgrywamy dwa razy (PDF i MT940) — kontrolnie. `confirm_bank_statement_sources`
paruje operacje obu plików:

1. po saldzie po operacji (kwota, kierunek, saldo — jednoznaczne),
2. gdy bank inaczej ułożył operacje z jednego dnia — po kwocie, kierunku i kolejności (daty ±3 dni).

Operacją główną jest wiersz z MT940 (pełne tytuły, rachunek kontrahenta). Wiersz z PDF dostaje
`canonical_transaction_id` (kopia) i zostaje jako potwierdzenie; jego opis jest widoczny przy operacji.
Rozliczenia i wyjaśnienia zapisane na kopii przechodzą na operację główną. `source_confirmation`:
`confirmed` (jest w obu plikach), `unconfirmed` (brak w drugim pliku — do sprawdzenia), `single_source`.
Usunięcie pliku z operacjami głównymi przenosi rozliczenia na kopię z drugiego pliku.

## 2. Blokady podwójnego rozliczenia (wyzwalacze, niezależnie od ekranu)

- operacja nie może być rozliczona ponad swoją kwotę (faktury + wypłaty),
- faktura nie może być opłacona z wyciągu ponad należność — razem z jej kopiami w innych źródłach
  (KSeF ↔ faktura CRM, ten sam numer, strona, NIP i kwota w KSeF / CRM / spoza KSeF),
- nie można rozliczać kopii operacji, transferu bieżący ↔ VAT ani roboczej kopii faktury
  (wpis KSeF bez numeru KSeF obok tej samej faktury z numerem).

## 3. Reguły (`reconcile_bank_month`) — po imporcie wyciągu i przyciskiem „Uzgodnij automatycznie”

| Kolejność | Reguła | Skutek |
| --- | --- | --- |
| 1 | numer faktury w tytule + kwota = do zapłaty, jeden kandydat | rozliczenie automatyczne |
| 1 | kilka numerów w tytule, suma = przelew | rozliczenie automatyczne |
| 1 | faktura KSeF oznaczona ręcznie jako opłacona + przelew z jej numerem i kwotą | ręczny wpis zamieniony na powiązanie z wyciągiem |
| 1 | numer w tytule, mniejsza kwota | propozycja (zaliczka / płatność częściowa) |
| 2 | ZUS, przelew podatkowy (US, PIT-4R, VAT-7), opłata bankowa | wyjaśnione bez faktury (`accounting_explained_by = rule:…`) |
| 3 | kwota = do zapłaty i kontrahent (NIP, rachunek znany z wcześniejszych płatności, nazwa) | propozycja |
| 3 | kilka dokumentów z tą kwotą | wybór |
| 4 | płatność zbiorcza (Allegro, PayU…) = suma 2–6 faktur z okolic daty | propozycja |
| — | tytuł wskazuje fakturę, której nie ma | wskazówka |

Numery faktur są szukane jako osobne słowa (lub, gdy długie, bez separatorów); daty z opisów operacji są
usuwane, a numery wyglądające jak data („04-2026”) pomijane.

Decyzja człowieka jest ostateczna: odrzucona propozycja (`reject_bank_reconciliation_proposal`), cofnięte
dopasowanie (`undo_bank_match`) i cofnięte wyjaśnienie (`clear_bank_transaction_explanation`, zapis
`rejected:…`) nie wracają przy kolejnym uzgodnieniu. Każde uruchomienie zapisuje podsumowanie w
`bank_reconciliation_runs`. AI (panel miesiąca) może tylko podpowiadać — nie rozlicza samo.
