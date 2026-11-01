# Finanse spółki w CRM — kierunek do pełnego rozliczania (KSeF 2027)

Cel: system, w którym każdy dokument, płatność i zobowiązanie publicznoprawne ma jedno źródło prawdy,
jawny powód powiązania i ślad decyzji — tak, żeby z czasem ograniczać pracę biura rachunkowego do
weryfikacji, a nie przepisywania danych.

## Kontekst prawny (stan na 1.11.2026)

- Od 1.01.2027 r. KSeF jest obowiązkowy dla wszystkich, także dla najmniejszych podatników (koniec
  okresu przejściowego dla sprzedaży do 10 000 zł brutto miesięcznie).
- Rada Ministrów 22.10.2026 r. przyjęła projekt przedłużający odroczenie kar za błędy w KSeF do
  31.12.2027 r. (projekt w parlamencie). Odroczenie kar nie znosi obowiązku.
  Źródło: podatki.gov.pl, „Rada Ministrów za odroczeniem kar za błędy w KSeF…”.

## Co już jest (listopad 2026)

| Obszar | Stan |
| --- | --- |
| Faktury sprzedaży i zakupu z KSeF | import, płatności, robocze kopie wykrywane i pomijane |
| Dokumenty spoza KSeF (zagraniczne, paragony, polisy, umowy) | rejestr z walutą, plikiem i statusem płatności |
| Wyciągi PDF + MT940 | jedna potwierdzona lista operacji, para bieżący ↔ VAT |
| Uzgadnianie | reguły z powodem, propozycje, blokady podwójnego rozliczenia, decyzja człowieka ostateczna |
| Waluty | kurs banku z płatności kartą zapisany przy powiązaniu |
| Wynagrodzenia | wypłata z umowy ↔ przelew, potwierdzenie netto |
| ZUS i podatki | rejestr deklaracji (DRA, PIT-4R, VAT-7, CIT-8) z plikami, rozbiciem na osoby i statusem zapłaty |

## Kolejne kroki (proponowana kolejność)

1. **Import DRA/RCA z pliku KEDU (XML z Płatnika / PUE)** — kwota do zapłaty i składki każdej osoby
   wczytane z pliku zamiast przepisywania. Potrzebny przykładowy plik (z zamazanymi PESEL-ami), żeby
   zbudować dokładny parser.
2. **Kursy NBP i różnice kursowe** — tabela kursów średnich NBP (tabela A, dzień roboczy przed datą
   obowiązku podatkowego / poniesienia kosztu). Dla każdej faktury w walucie: kwota PLN wg NBP (do
   VAT i kosztów), kwota PLN z banku (zapłata) i zrealizowana różnica kursowa. Dziś zapisujemy tylko
   kurs banku.
3. **Import usług i odwrotne obciążenie** — faktury od zagranicznych dostawców usług (OpenAI, Cursor,
   Supabase…) wymagają VAT należnego i naliczonego w JPK_V7 po kursie NBP. Oznaczenie dokumentu jako
   import usług + automatyczne wyliczenie VAT.
4. **Rejestr VAT z KSeF i dokumentów spoza KSeF** → kontrola kwoty VAT-7 przed złożeniem; potem
   generowanie pliku JPK_V7M z danych systemu (biuro tylko weryfikuje).
5. **Lista płac** — z umów i ewidencji czasu: brutto → składki → zaliczka PIT → netto. Z tego
   automatycznie: kwoty netto do wypłaty (koniec ręcznego potwierdzania netto), linie DRA i PIT-4R.
6. **Dekretacja i plan kont** — każdy dokument i każda operacja dostaje konto Wn/Ma według reguł
   (kategoria kosztu, kontrahent, rodzaj operacji); z tego zestawienie obrotów i sald, a docelowo
   księga główna.
7. **Zamknięcie miesiąca** — lista kontrolna: wszystkie operacje rozliczone lub wyjaśnione, deklaracje
   zapłacone, różnice kursowe zaksięgowane, brakujące dokumenty wskazane; eksport dla biura do czasu
   pełnego przejęcia księgowości.

Zasada dla każdego kroku: automat robi tylko to, co wynika jednoznacznie z danych (numer, kwota,
okres, rachunek); wszystko inne jest propozycją z powodem, a decyzja człowieka jest zapisywana i nie
jest nadpisywana przez kolejne uruchomienie.
