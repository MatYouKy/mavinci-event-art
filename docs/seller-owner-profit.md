# Prowizja opiekuna od zysku

## Zakres

Dotyczy opiekuna prowadzącego ofertę z portalu sprzedawcy. Opiekun pochodzi z odpowiedzialności za kontakt sprzedawcy; dla profili bez kontaktu pozostaje dotychczasowe przypisanie dla marki. Autorstwo oferty i wydarzenia nie jest nadpisywane. Procent i sposób wypłaty pochodzą z aktywnych warunków profilu pracownika w kartotece sprzedawców dla tej samej marki. Nie tworzymy domyślnej stawki ani dodatkowego profilu automatycznie.

## Podstawa

Podstawa = max(0, przychód firmy netto − koszty realizacji netto − koszt sprzedawcy zewnętrznego − pozostałe prowizje).

Prowizja nominalna = podstawa × procent opiekuna.

Przy sprzedaży z narzutem przychodem firmy jest `partner_base_net`. Narzut sprzedawcy nie jest naszym przychodem i nie odejmujemy go drugi raz. Dla modelu prowizyjnego stosujemy netto oferty zgodnie z `getOfferTotals`. Dodatnia prowizja zewnętrzna musi mieć zapisane naliczenie, zanim naliczymy opiekuna. Podgląd wcześniejszy jest oznaczony jako szacunek.

Przykład: 10 000 zł przychodu firmy, 8 000 zł kosztów realizacji i 1 000 zł kosztu sprzedawcy daje 1 000 zł podstawy. Stawka opiekuna 10% daje 100 zł, a nie 1 000 zł. Przy braku zysku prowizja procentowa to zero.

Dla `payroll` kwota nominalna to brutto pracownika, nie wynagrodzenie netto. Koszt firmy uwzględnia skonfigurowany `compensation_settings.employer_social_rate`. Dla `cash_dividend` zachowujemy dotychczasowy model kosztu gotówki z warunków prowizyjnych (kwota / (1 − stawka modelowa)). Nie zmieniamy globalnie sposobu podatkowego rozliczania gotówki. To kalkulacja zarządcza, nie naliczenie listy płac ani deklaracja podatkowa.

## Kolejność w CRM

1. Opiekun sprawdza zakres, cenę i koszty realizacji. Istniejący `event_costs.amount` nie deklaruje jednoznacznie netto/brutto, dlatego zatwierdza koszt netto bez prowizji i opisuje jego zakres. Zero również wymaga świadomego potwierdzenia.
2. Zapisuje wersję kalkulacji. Poprzednie wersje, autor, kwoty i uzasadnienie pozostają w historii.
3. Oferta jest akceptowana, a wydarzenie tworzone osobno — kalkulacja nie zastępuje tych decyzji.
4. Po zapisaniu zewnętrznych prowizji i odświeżeniu kalkulacji opiekun nalicza własną planowaną prowizję. Powtórzenie akcji nie tworzy drugiej pozycji.
5. Zatwierdzenie i faktyczne wypłaty pozostają w dotychczasowych rozliczeniach prowizji. Samo naliczenie nie wykonuje przelewu.

Zmiana finansowych danych źródłowych, opiekuna lub warunków oznacza poprzednią kalkulację jako nieaktualną. Nieaktualna podstawa nie może służyć do zatwierdzenia ani nowej wypłaty. Zmiana samego statusu przygotowania wydarzenia lub odnotowanie wypłaty zewnętrznej, bez zmiany jej kosztu, nie zmienia podstawy. Wiele zaakceptowanych ofert w jednym wydarzeniu i alternatywne źródło przychodu z kalkulacji wymagają uzgodnienia, a nie automatycznej alokacji kosztów.

## Historia i uprawnienia

- Nie ma backfillu ani przeliczenia starszych prowizji. Starsze naliczenie dla tej samej osoby blokuje utworzenie drugiego.
- Aktualizowane może być tylko nowe, planowane naliczenie bez wypłat i bez zmiany beneficjenta. Zatwierdzone, wypłacone i anulowane wpisy nie są automatycznie zastępowane. Zmiany wymagające korekty rozliczenia nie są wykonywane przez panel kalkulacji.
- Nowe naliczenie dla opiekuna nie może ominąć podstawy od zysku przez stary formularz lub automat od przychodu. Pozostali sprzedawcy zachowują istniejące zasady.
- Dostęp wymaga praw CRM do konkretnej oferty, marki i finansów wydarzenia. Bez wydarzenia nadal wymagane są uprawnienia finansowe i dostęp do oferty. Portal sprzedawcy nie ma dostępu do wewnętrznych kalkulacji, zysku ani prowizji opiekuna; dane nie trafiają do PDF.

## Uruchomienie

Wymagana migracja `20260918120000_seller_owner_profit_commission.sql`, po migracjach opiekuna, rozliczeń prowizji i wynagrodzeń pracowników. Migracja nie została uruchomiona w ramach tej zmiany. Zgodnie z `.build-policy.md` nie uruchamiano testów, kompilacji ani walidacji.
