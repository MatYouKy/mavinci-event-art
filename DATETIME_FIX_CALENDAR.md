# Poprawka timezone dla spotkań w kalendarzu - 2026-02-02

## Problem
Godziny w spotkaniach były zapisywane i wyświetlane niepoprawnie z powodu błędnej konwersji stref czasowych.

**Przykład:**
- Użytkownik wybiera: 14:00 (czas lokalny)
- System zapisywał: `2024-01-27T14:00:00Z` (traktując lokalny czas jako UTC)
- Przy odczycie przeglądarki: 15:00 (bo UTC+1)

**Przesunięcie:** +1 godzina w Polsce (UTC+1)

## Przyczyna
W formularzach używane były inputy `type="datetime-local"`, które zwracają czas lokalny (np. `"2024-01-27T14:00"`), ale kod zapisywał go do bazy **bez konwersji** lub dodawał suffix `Z` bezpośrednio, co oznacza UTC.

## Rozwiązanie
Użycie istniejących funkcji pomocniczych z `/src/lib/utils/dateTimeUtils.ts`:

### 1. Przy zapisie do bazy (lokalny → UTC):
```typescript
import { localDatetimeStringToUTC } from '@/lib/utils/dateTimeUtils';

// Przed (błędne):
datetime_start: `${dateStart}T${timeStart}:00Z`

// Po (poprawne):
datetime_start: localDatetimeStringToUTC(`${dateStart}T${timeStart}`)
```

### 2. Przy wczytywaniu z bazy (UTC → lokalny):
```typescript
import { utcToLocalDatetimeString } from '@/lib/utils/dateTimeUtils';

// Przed (błędne):
value={formData.datetime_start.slice(0, 16)}

// Po (poprawne):
datetime_start: utcToLocalDatetimeString(data.datetime_start)
```

## Zmodyfikowane pliki

### 1. `/src/components/crm/NewMeetingModal.tsx`
**Tworzenie nowego spotkania z kalendarza**

Zmiany:
- Dodano import funkcji konwersji
- Linia 129: `localDatetimeStringToUTC()` dla datetime_start
- Linia 133: `localDatetimeStringToUTC()` dla datetime_end

### 2. `/src/app/(crm)/crm/calendar/meeting/[id]/page.tsx`
**Edycja istniejącego spotkania**

Zmiany:
- Dodano import funkcji konwersji
- Linia 113: `utcToLocalDatetimeString()` przy wczytywaniu datetime_start
- Linia 114: `utcToLocalDatetimeString()` przy wczytywaniu datetime_end
- Linia 144: `localDatetimeStringToUTC()` przy zapisie datetime_start
- Linia 145: `localDatetimeStringToUTC()` przy zapisie datetime_end
- Usunięto `.slice(0, 16)` z inputów (funkcja już zwraca prawidłowy format)

### 3. `/src/components/crm/AddEventVehicleModal.tsx`
**Data zwrotu zewnętrznej przyczepy**

Zmiany:
- Dodano import funkcji konwersji
- Linia 197: `utcToLocalDatetimeString()` przy wczytywaniu external_trailer_return_date
- Linia 397-399: `localDatetimeStringToUTC()` przy zapisie external_trailer_return_date

## Funkcje pomocnicze (już istniejące)

### `localDatetimeStringToUTC(localDatetime: string)`
Konwertuje lokalny string datetime-local na UTC ISO string dla bazy danych.
```typescript
// Input:  "2024-01-27T14:00" (lokalny czas użytkownika)
// Output: "2024-01-27T13:00:00.000Z" (UTC dla Polski UTC+1)
```

### `utcToLocalDatetimeString(utcDate: string)`
Konwertuje UTC string z bazy na lokalny string dla datetime-local input.
```typescript
// Input:  "2024-01-27T13:00:00Z" (UTC z bazy)
// Output: "2024-01-27T14:00" (lokalny dla Polski UTC+1)
```

## Pliki już poprawnie obsługujące timezone
Te pliki **NIE wymagały zmian** - już używają funkcji konwersji:
- `/src/components/crm/EventWizard.tsx`
- `/src/components/crm/NewEventModal.tsx`
- `/src/app/(crm)/crm/events/[id]/components/Modals/EditEventModa.tsx`
- `/src/components/crm/EditEventModalNew.tsx` (używa równoważnej metody `new Date().toISOString()`)

## Testowanie

### Test 1: Nowe spotkanie
1. Otwórz `/crm/calendar`
2. Kliknij "Nowe spotkanie"
3. Wybierz datę: 2024-01-27
4. Wybierz godzinę: 14:00
5. Zapisz spotkanie
6. **Oczekiwany rezultat:** Spotkanie wyświetla się o 14:00 (nie 15:00)

### Test 2: Edycja spotkania
1. Otwórz istniejące spotkanie
2. Kliknij "Edytuj"
3. Sprawdź czy godzina wyświetla się poprawnie
4. Zmień godzinę na 16:30
5. Zapisz
6. **Oczekiwany rezultat:** Spotkanie zapisuje się i wyświetla jako 16:30

### Test 3: Pojazd z przyczepą
1. Otwórz wydarzenie w `/crm/events/[id]`
2. Dodaj pojazd z zewnętrzną przyczepą
3. Ustaw datę zwrotu: 2024-01-30 18:00
4. Zapisz
5. Edytuj pojazd
6. **Oczekiwany rezultat:** Data zwrotu wyświetla się jako 18:00 (nie 19:00)

## Zalety tego rozwiązania
✅ Używa istniejących, przetestowanych funkcji
✅ Spójna obsługa timezone w całej aplikacji
✅ Działa poprawnie w każdej strefie czasowej
✅ Automatyczna konwersja DST (czas letni/zimowy)
✅ Przeglądarki automatycznie wyświetlają w lokalnym czasie użytkownika

## Dokumentacja funkcji
Pełna dokumentacja w `/src/lib/utils/DATETIME_USAGE.md`

## Wersja
Data: 2026-02-02
Status: Zaimplementowano i przetestowano
