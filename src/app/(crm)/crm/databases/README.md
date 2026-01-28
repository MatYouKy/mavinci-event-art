# Bazy Danych - Dokumentacja

## Opis
System baz danych pozwala na tworzenie i zarządzanie własnymi bazami danych w formie uproszczonego arkusza kalkulacyjnego (Excel-like). Każda baza może mieć dowolną liczbę kolumn i rekordów.

## Dostęp
Aby uzyskać dostęp do modułu Baz Danych, użytkownik musi mieć jedno z następujących uprawnień:
- `admin` - pełny dostęp (edycja, usuwanie baz)
- `databases_manage` - zarządzanie bazami (tworzenie, edycja, usuwanie kolumn i rekordów)
- `databases_view` - tylko odczyt

## Funkcje

### 1. Lista Baz Danych (`/crm/databases`)

**Możliwości:**
- Przeglądanie wszystkich baz danych
- Wyszukiwanie po nazwie lub opisie
- Tworzenie nowej bazy (wymaga `databases_manage`)
- Usuwanie bazy (wymaga `admin`)

**Jak utworzyć bazę:**
1. Kliknij "Nowa Baza Danych"
2. Wprowadź nazwę (wymagane)
3. Opcjonalnie dodaj opis
4. Kliknij "Utwórz"

### 2. Szczegóły Bazy (`/crm/databases/[id]`)

**Widok typu Excel:**
- Kolumny poziome z nagłówkami
- Rekordy w wierszach
- Numeracja wierszy (#)
- Możliwość edycji inline (kliknięcie w komórkę)

**Zarządzanie kolumnami:**
- Dodawanie nowej kolumny (przycisk "+ Kolumna")
- Typy kolumn:
  - `text` - Tekst
  - `number` - Liczba
  - `date` - Data
  - `boolean` - Tak/Nie
- Edycja nazwy kolumny (ikona ołówka)
- Usuwanie kolumny (ikona kosza) - **UWAGA: usuwa wszystkie dane w kolumnie!**

**Zarządzanie rekordami:**
- Dodawanie nowego rekordu (przycisk "+ Dodaj rekord")
- Edycja komórki - kliknij w komórkę, wpisz wartość, wciśnij Enter lub kliknij poza
- Usuwanie rekordu (ikona kosza w ostatniej kolumnie)

**ResponsiveActionBar - Akcje:**
- **Zmień nazwę** - edycja nazwy bazy danych (wymaga `databases_manage`)
- **Eksportuj CSV** - pobiera plik CSV z danymi
- **Eksportuj PDF** - otwiera okno wydruku/zapisu jako PDF
- **Usuń bazę** - usuwa całą bazę danych (wymaga `admin`)

## Eksport

### CSV
Eksportuje bazę do formatu CSV:
- Pierwszy wiersz = nazwy kolumn
- Kolejne wiersze = dane
- Format kompatybilny z Excel, Google Sheets, LibreOffice Calc

### PDF
Otwiera okno przeglądarki z widokiem do druku:
- Użytkownik może zapisać jako PDF
- Lub wydrukować fizycznie
- Zawiera nazwę bazy, opis i tabelę z danymi

## Przykłady użycia

### Przykład 1: Baza kontaktów
```
Kolumny:
- Imię i nazwisko (text)
- Email (text)
- Telefon (text)
- Status (text)
- Data kontaktu (date)
```

### Przykład 2: Inwentaryzacja
```
Kolumny:
- Nazwa przedmiotu (text)
- Ilość (number)
- Lokalizacja (text)
- W użyciu (boolean)
- Data zakupu (date)
```

### Przykład 3: Lista zadań
```
Kolumny:
- Zadanie (text)
- Priorytet (text)
- Wykonane (boolean)
- Termin (date)
```

## Bezpieczeństwo

### RLS (Row Level Security)
Wszystkie tabele mają włączone RLS:
- `custom_databases` - dostęp tylko dla uprawnionych użytkowników
- `custom_database_columns` - dostęp tylko dla uprawnionych
- `custom_database_records` - dostęp tylko dla uprawnionych

### Uprawnienia
- **Czytanie**: `databases_view`, `databases_manage`, `admin`
- **Tworzenie/Edycja**: `databases_manage`, `admin`
- **Usuwanie baz**: tylko `admin`

## Wskazówki

1. **Zaplanuj strukturę** - przed utworzeniem bazy pomyśl jakie kolumny będą potrzebne
2. **Używaj odpowiednich typów** - `number` dla liczb, `date` dla dat, itd.
3. **Nazwy kolumn** - używaj krótkich, opisowych nazw
4. **Regularne kopie zapasowe** - eksportuj do CSV regularnie
5. **Testuj na małych danych** - przed dodaniem wielu rekordów przetestuj strukturę

## Technologia

- **Backend**: Supabase PostgreSQL
- **Frontend**: React + Next.js
- **State Management**: Redux Toolkit Query (RTK Query)
- **RLS**: Automatyczne zabezpieczenie na poziomie bazy danych
- **Realtime**: Automatyczna synchronizacja zmian (Supabase Realtime)

## Troubleshooting

### Nie widzę opcji "Nowa Baza Danych"
→ Sprawdź uprawnienia, potrzebujesz `databases_manage` lub `admin`

### Nie mogę usunąć bazy
→ Tylko administratorzy (`admin`) mogą usuwać bazy danych

### Nie mogę edytować komórek
→ Sprawdź uprawnienia, potrzebujesz `databases_manage` lub `admin`

### Kolumna nie zapisuje się
→ Sprawdź czy nazwa kolumny nie jest pusta

### Eksport PDF nie działa
→ Sprawdź czy przeglądarka nie blokuje okien popup
