# Zakupy — „Moje wydatki” i rozliczenia pracowników

Pracownik, który robi zakupy firmową kartą (np. magazynier kupujący gadżety, materiały, baterie), prowadzi w CRM ewidencję
swoich zakupów: wprowadza dokumenty spoza KSeF (paragony z NIP firmy, faktury, inne dowody zakupu), może przypisać zakup do
eventu jako koszt i co miesiąc wysyła rozliczenie do zatwierdzenia.

Decyzje właściciela (25.11.2026): płaci wspólna firmowa karta (później może być osobna karta z subkontem, żeby pracownik nie
miał dostępu do całego konta); rozliczenie miesiąca zatwierdza osoba z finansów; przypisując zakup do eventu pracownik widzi
wszystkie koszty tego eventu (bez budżetu i przychodów); do wyboru są eventy, które pracownik widzi.

## Uprawnienia

- **Zakupy — własne wydatki** (`finances_purchases`, Uprawnienia pracownika → „Finanse i dane”; w „Dostępie według sekcji”
  — sekcja „Wartości finansowe eventów”): menu **Zakupy** → „Moje wydatki”. Zakupy tylko w działalnościach z NIP, do których
  pracownik ma dostęp (`purchase_can_record`). Administrator ma to zawsze.
- **Zatwierdzanie**: „Finanse — zarządzanie” w działalności (administrator — wszędzie) → Zakupy → „Rozliczenia pracowników”.
  Własnego rozliczenia nie zatwierdza się samemu (wyjątek: administrator).
- Pracownik nie czyta tabel bezpośrednio — wszystko idzie przez funkcje bazy `purchase_*` (SECURITY DEFINER, kontrola dostępu).
  Finanse widzą dokumenty zakupów jak każdy dokument spoza KSeF (Koszty miesiąca, Dysk → Finanse, uzgodnienie wyciągów).

## Dokument zakupu

1. **Plik**: zdjęcie paragonu, kilka zdjęć stron (do 10 — serwer składa z nich PDF, orientacja z EXIF) albo PDF / zdjęcie do
   10 MB. Plik zapisuje serwer CRM w `external-invoices/purchases/<pracownik>/<uuid>.<pdf|jpg|png|webp>` po sprawdzeniu prawa.
2. **Odczyt AI** na serwerze CRM (`src/lib/purchases/purchaseScan.server.ts`, `OPENAI_API_KEY`, model
   `OPENAI_INVOICE_SCAN_MODEL`) — te same zasady co „Odczytaj z pliku” w Finansach: sprzedawca, NIP, numer, data, opis, netto,
   brutto, waluta, sposób zapłaty; ostrzeżenia (np. brak NIP-u firmy na paragonie, NIP nabywcy inny niż działalności, suma
   kontrolna NIP-u, netto + VAT ≠ brutto). Błąd odczytu nie przerywa — dane wpisuje się ręcznie.
3. **Dane** do sprawdzenia: rodzaj (paragon / faktura / inny dowód), sprzedawca, NIP sprzedawcy, numer, data (nie z przyszłości),
   co kupiono, brutto (wymagane), netto (jeśli jest), waluta, **zapłacono** (domyślnie karta firmowa; gotówka, BLIK, przelew —
   faktura do zapłaty przez firmę), kategoria kosztów firmy, uwagi.
4. **Koszt eventu** (opcjonalnie): event tej działalności, nieanulowany, który pracownik widzi (najbliższe dziś, wyszukiwanie);
   kwota brutto dla eventu (puste — cały dokument, mniej — część), kategoria kosztu eventu (podpowiedź z kategorii kosztów).
   W oknie widać wszystkie koszty tego eventu i ich sumę. Tylko PLN i tylko do podsumowania eventu w wersji roboczej.

Zapis (`purchase_save`): wiersz `external_invoices` z `purchased_by`; karta / gotówka / BLIK — „opłacony” z datą zakupu (operację
karty z wyciągu dopasowuje uzgodnienie, a zakup pokazuje „Powiązany z wyciągiem”), przelew — „nieopłacony”. Koszt eventu =
`event_costs` z `external_invoice_id` i `from_purchase` (kwota brutto części dokumentu, jak „Przypisz fakturę kosztową”
w podsumowaniu eventu; netto liczy podsumowanie z proporcji dokumentu), stan „czeka na rozliczenie”. Dokument powiązany
z wyciągiem: działalność, kwotę, walutę i sposób zapłaty zmienia już osoba z finansów; usunięcia też. Dokument usunięty
w Finansach zabiera swój koszt eventu (wyzwalacz `purchase_document_deleted`).

## Rozliczenie miesiąca

- Miesiąc = data dokumentu; rozliczenie osobno dla każdej działalności (`purchase_settlements`). Brak wiersza — „Otwarte”.
- **Wyślij rozliczenie** (`purchase_submit`): co najmniej jeden dokument, każdy z plikiem, miesiąc nie z przyszłości; zapisuje
  liczbę dokumentów i sumy według waluty; powiadomienie do zatwierdzających działalności (bez autora). Od wysłania dokumentów
  tego miesiąca nie można dodawać, zmieniać ani usuwać.
- **Zatwierdź** (`purchase_decide`, uwaga opcjonalna): koszty eventów z tych zakupów → „zatwierdzony”; powiadomienie do pracownika.
- **Zwróć do poprawy** (uwaga wymagana) — także „Cofnij zatwierdzenie”: koszty eventów → „czeka na rozliczenie”, pracownik
  poprawia i wysyła ponownie.
- „Nierozliczone miesiące” w „Moich wydatkach” — inne miesiące z dokumentami, które nie są wysłane ani zatwierdzone.
- „Rozliczenia pracowników” (`purchase_review`): wysłane, otwarte z dokumentami, zwrócone i zatwierdzone z ostatnich 120 dni.

Blokady podwójnej edycji: zmiana dokumentów miesiąca i wysłanie rozliczenia biorą tę samą blokadę miesiąca pracownika
(`private.purchase_lock_month`).

## Serwer i aplikacje

- Baza: migracja `20261130180000_employee_purchases.sql` (kolumny `external_invoices.purchased_by`, `event_costs.from_purchase`,
  tabela `purchase_settlements`, funkcje `purchases_access`, `purchase_can_record`, `purchase_month`, `purchase_event_options`,
  `purchase_event_costs`, `purchase_categories`, `purchase_document_file`, `purchase_save`, `purchase_delete`,
  `purchase_submit`, `purchase_decide`, `purchase_review`; zakres `finances_purchases` w `admin_set_employee_section_permissions`).
- Serwer CRM: `src/lib/purchases/purchases.server.ts` (pliki, odczyt AI, wywołania bazy), trasy `/bridge/purchases` (CRM —
  sesja z ciasteczek) i `/bridge/native/v1/purchases` (Mac, telefon) — `src/lib/purchases/purchaseRoute.server.ts`:
  GET `op=state&year=&month=[&employee=]` | `review` | `events&company=&q=` | `costs&event=` | `file&id=[&download=1]`;
  POST JSON `op=save {id?, data}` | `delete {id}` | `submit {companyId, year, month, note}` | `decide {settlementId, approve,
  note}` | `discard {path}` | `upload {company, files: [{name, mime, data}]}`; POST multipart `op=upload` (`company`, `files`).
- Wspólne typy i pomocnicze funkcje: `src/lib/purchases/purchaseShared.ts` (kopia w aplikacji mobilnej).
- CRM: `/crm/purchases` (`src/app/(crm)/crm/purchases/page.tsx`, `src/components/crm/purchases/*`), menu „Zakupy”
  (uprawnienie albo „Finanse — zarządzanie”). Linki z powiadomień: `/crm/purchases?employee=…&year=…&month=…` (rozliczenie
  pracownika), `/crm/purchases?year=…&month=…` (własny miesiąc).
- Mac: ekran natywny „Zakupy” (`desktop/mac/Sources/Mavinci/Purchases/`, `desktop/mac/README.md`) — to samo co w CRM; plik
  można przeciągnąć z Findera, zdjęcia HEIC / TIFF / WebP idą jako JPEG (za duże — pomniejszone). Linki z powiadomień
  otwierają ekran (`Workspace.showPurchases`).
- Telefon: menu „Zakupy” (`mobile/src/screens/PurchasesScreen.tsx`, `mobile/src/components/Purchases/*`, API
  `mobile/src/lib/purchasesApi.ts`, wspólne `mobile/src/lib/purchaseShared.ts`) — „Dodaj zakup — zdjęcie paragonu”: aparat
  (kolejne strony jednego dokumentu — „Dodaj stronę”), galeria albo PDF z „Plików”; zdjęcia idą multipartem prosto z dysku
  telefonu. Dokument z listy: plik, „Popraw”, „Usuń”. Rozliczenia pracowników i decyzje — jak w CRM. Menu: uprawnienie albo
  „Finanse — zarządzanie” w działalności (`canOpenPurchases`); linki z powiadomień — `routePurchasesUrl`.

## Na później

- Osobna karta z subkontem dla pracownika — operacje tej karty z wyciągu jako „wydatki do udokumentowania” w „Moich wydatkach”.
