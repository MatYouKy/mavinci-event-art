# Ulepszenia Formularza Wystawiania Faktur

## Nowe Funkcje

### 1. Search Input dla Nabywcy
**Lokalizacja:** `/crm/invoices/new`

**Funkcjonalność:**
- Zastąpiono standardowy `<select>` zaawansowanym polem wyszukiwania
- Wyszukiwanie w czasie rzeczywistym po:
  - Nazwie firmy/kontaktu
  - Numerze NIP
  - Mieście
- Dropdown z podglądem wyników
- Wyświetlanie wybranego kontaktu z możliwością czyszczenia

### 2. Modal Dodawania Nowego Nabywcy
**Komponent:** `AddBuyerModal.tsx`

**Funkcjonalność:**
- Wybór typu nabywcy: **Firma** lub **Osoba**
- Integracja z Białą Listą VAT (API Ministerstwa Finansów)
- Automatyczne pobieranie danych po NIP:
  - Nazwa firmy
  - Adres (ulica, kod pocztowy, miasto)
  - REGON

**Pola formularza:**

**Dla firm:**
- NIP * (z przyciskiem GUS)
- Nazwa firmy *
- Ulica i numer
- Kod pocztowy
- Miasto

**Dla osób:**
- Imię *
- Nazwisko *
- Ulica i numer
- Kod pocztowy
- Miasto

### 3. Automatyczne Generowanie Numeru Faktury
**Komponent:** `InvoiceNumberInput.tsx`

**Funkcjonalność:**
- Automatyczne wygenerowanie numeru przy otwarciu formularza
- Numer bazuje na ostatniej fakturze danego typu
- Możliwość ręcznej zmiany numeru
- Przycisk odświeżenia do ponownego wygenerowania
- Wizualna informacja o automatycznym generowaniu

**Typy faktur obsługiwane:**
- Faktura VAT (FV/XXX/YYYY)
- Proforma (PRO/XXX/YYYY)
- Zaliczkowa (ZAL/XXX/YYYY)
- Korygująca (KOR/XXX/YYYY)

## Struktura Plików

```
src/app/(crm)/crm/invoices/new/
├── page.tsx                           # Główny formularz (zaktualizowany)
└── components/
    ├── BuyerSearchInput.tsx          # Komponent wyszukiwania nabywcy
    ├── AddBuyerModal.tsx             # Modal dodawania nowego nabywcy
    └── InvoiceNumberInput.tsx        # Input z auto-generowaniem numeru
```

## Integracja z API

### Biała Lista VAT (GUS)
**Plik:** `src/lib/gus.ts`

Funkcja `fetchCompanyDataFromGUS(nip: string)` pobiera dane z:
```
https://wl-api.mf.gov.pl/api/search/nip/{NIP}?date={DATA}
```

**Zwracane dane:**
- Pełna nazwa firmy
- NIP
- REGON
- Adres działalności

**Funkcja bazodanowa:**
- `lookup_company_by_nip(p_nip text)` - funkcja placeholder (implementacja client-side)

## Workflow Użytkownika

### Scenariusz 1: Wybór Istniejącego Nabywcy
1. Wpisz nazwę, NIP lub miasto w pole wyszukiwania
2. Wybierz kontakt z listy wyników
3. Dane nabywcy wypełnią się automatycznie
4. Kontynuuj wypełnianie faktury

### Scenariusz 2: Dodanie Nowego Nabywcy (Firma)
1. Kliknij przycisk "Dodaj nowego nabywcę" w dropdownie
2. Wybierz typ: **Firma**
3. Wpisz NIP (np. 1234567890)
4. Kliknij przycisk **GUS**
5. System automatycznie pobierze i wypełni:
   - Nazwę firmy
   - Adres (ulica, kod, miasto)
6. Sprawdź/uzupełnij dane jeśli potrzeba
7. Kliknij "Dodaj nabywcę"
8. Nabywca zostanie wybrany automatycznie

### Scenariusz 3: Dodanie Nowego Nabywcy (Osoba)
1. Kliknij przycisk "Dodaj nowego nabywcę"
2. Wybierz typ: **Osoba**
3. Wprowadź imię i nazwisko
4. Opcjonalnie: uzupełnij adres
5. Kliknij "Dodaj nabywcę"

### Scenariusz 4: Numer Faktury
1. System automatycznie wygeneruje numer przy otwarciu formularza
2. Numer bazuje na typie faktury (VAT/Proforma/Zaliczkowa/Korygująca)
3. Możesz ręcznie zmienić numer w razie potrzeby
4. Przycisk odświeżenia pozwala ponownie wygenerować numer

## Walidacja

### Przed zapisem faktury system sprawdza:
- ✅ Czy wybrano firmę wystawiającą
- ✅ Czy wybrano nabywcę
- ✅ Czy wygenerowano numer faktury
- ✅ Czy wypełniono wszystkie pozycje faktury
- ✅ Czy ceny są większe od 0

## Bezpieczeństwo

### Dodawanie Nabywców
- Tylko zalogowani użytkownicy z uprawnieniami `invoices_manage` lub `finances_manage`
- RLS policies weryfikują uprawnienia przed zapisem

### Pobieranie z GUS
- API jest publiczne i nie wymaga autentykacji
- Dane pobierane bezpośrednio z Ministerstwa Finansów
- Sprawdzanie aktualnego statusu VAT firmy

## Testowanie

### Test 1: Wyszukiwanie Nabywcy
1. Przejdź do `/crm/invoices/new`
2. Wpisz część nazwy istniejącej firmy
3. Sprawdź czy wyniki filtrują się w czasie rzeczywistym
4. Wybierz kontakt i sprawdź czy się wyświetla poprawnie

### Test 2: Dodanie Firmy przez GUS
1. Kliknij "Dodaj nowego nabywcę"
2. Wybierz "Firma"
3. Wpisz NIP: `5252740143` (przykładowy NIP)
4. Kliknij przycisk GUS
5. Sprawdź czy dane się pobrały
6. Zapisz nabywcę

### Test 3: Generowanie Numeru Faktury
1. Otwórz formularz faktury
2. Sprawdź czy numer jest już wygenerowany
3. Zmień typ faktury z VAT na Proforma
4. Sprawdź czy numer się zaktualizował
5. Kliknij przycisk odświeżenia
6. Sprawdź czy numer został ponownie wygenerowany

## Znane Ograniczenia

1. **API GUS/Biała Lista VAT:**
   - Wymaga połączenia z internetem
   - Dane mogą być nieaktualne (sprawdzane raz dziennie)
   - Nie wszystkie firmy mają pełne adresy w bazie

2. **Parsowanie adresu:**
   - Format adresu z API może się różnić
   - Wzorzec regex może nie działać dla wszystkich przypadków
   - W razie problemu można ręcznie uzupełnić pola

## Przyszłe Usprawnienia

- [ ] Cache wyników wyszukiwania GUS
- [ ] Walidacja NIP po stronie klienta
- [ ] Historia ostatnio używanych nabywców
- [ ] Import kontaktów z CSV
- [ ] Eksport listy nabywców do Excel
