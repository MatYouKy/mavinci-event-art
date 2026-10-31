# Widok Timeline w Kalendarzu

## Przegląd

Dodano nowy widok **Timeline** do kalendarza, który pozwala na wizualizację wykorzystania zasobów (pojazdy, pracownicy, sprzęt) w czasie. Widok ten jest dostępny tylko dla administratorów.

## Nowe funkcjonalności

### 1. **Widok Timeline**
- Wizualizacja wykorzystania zasobów na osi czasu (tydzień)
- Paski kolorowe reprezentujące przypisania do wydarzeń
- Interaktywne kliknięcie w wydarzenie prowadzi do szczegółów

### 2. **Filtry zasobów**
Checkboxy do pokazywania/ukrywania typów zasobów:
- **Pojazdy** (Truck icon) - niebieski
- **Pracownicy** (User icon) - zielony
- **Sprzęt** (Box icon) - cyjan

### 3. **Kolorystyka statusów**
Każdy status wydarzenia ma unikalny kolor:
- **Oczekujące** - szary (pending)
- **Potwierdzone** - niebieski (confirmed)
- **W trakcie** - żółty (in_progress)
- **Zakończone** - zielony (completed)
- **Anulowane** - czerwony (cancelled)
- **Planowanie** - fioletowy (planning)

### 4. **Informacje o zasobach**
Dla każdego typu zasobu wyświetlane są dodatkowe informacje:
- **Pojazdy**: numer rejestracyjny
- **Pracownicy**: nickname
- **Sprzęt**: kategoria

## Struktura techniczna

### Nowe komponenty

#### `TimelineView.tsx`
Główny komponent widoku timeline:
- Props:
  - `currentDate` - aktualna data do wyświetlenia tygodnia
  - `events` - lista wydarzeń z przypisaniami
  - `vehicles` - lista pojazdów
  - `employees` - lista pracowników
  - `equipment` - lista sprzętu
  - `onEventClick` - callback kliknięcia w wydarzenie

### Rozszerzone API

#### `calendarApi.ts`
Dodano nowy endpoint:
```typescript
getTimelineResources: builder.query<
  {
    vehicles: any[];
    employees: any[];
    equipment: any[];
  },
  void
>
```

Pobiera:
- Pojazdy ze statusem `active`
- Pracowników aktywnych (`is_active = true`)
- Sprzęt ze statusem `available` lub `in_use` (limit 100)

#### Rozszerzone zapytanie o wydarzenia
Dodano relacje:
- `event_vehicles` - przypisania pojazdów
- `event_equipment` - przypisania sprzętu
- `employee_assignments` - przypisania pracowników

## Użycie

### Dostęp do widoku
1. Zaloguj się jako administrator
2. Przejdź do kalendarza (`/crm/calendar`)
3. Wybierz widok **Timeline** z przycisków widoku

### Filtrowanie zasobów
1. Użyj checkboxów na górze widoku:
   - Kliknij "Pojazdy" aby pokazać/ukryć pojazdy
   - Kliknij "Pracownicy" aby pokazać/ukryć pracowników
   - Kliknij "Sprzęt" aby pokazać/ukryć sprzęt
2. Przycisk "Pokaż wszystkie" przywraca wszystkie filtry

### Nawigacja
- Użyj strzałek ◄ ► aby przesunąć tydzień
- Kliknij "Dziś" aby wrócić do bieżącego tygodnia
- Kliknij na pasek wydarzenia aby przejść do szczegółów

## Przykład wizualizacji

```
Pojazdy     |  Pon  |  Wt   |  Śr   |  Czw  |  Pt   |  Sob  |  Nie  |
------------|-------|-------|-------|-------|-------|-------|-------|
Mercedes    | [=========Wesele Kowalskich=========]       |
Volvo       |       |       | [===Event X===]             |
ROBUR       |                                     [Event Y]|

Pracownicy  |  Pon  |  Wt   |  Śr   |  Czw  |  Pt   |  Sob  |  Nie  |
------------|-------|-------|-------|-------|-------|-------|-------|
Jan Nowak   | [=========Wesele Kowalskich=========]       |
Anna Kowal  |       | [==========Konferencja==========]    |
```

## Kolory i ikonki

### Kolory zasobów
- Pojazdy: `blue-500` (rgb(59, 130, 246))
- Pracownicy: `green-500` (rgb(34, 197, 94))
- Sprzęt: `teal-500` (rgb(20, 184, 166))

### Kolory statusów
- Pending: `gray-500` (rgb(107, 114, 128))
- Confirmed: `blue-500` (rgb(59, 130, 246))
- In Progress: `yellow-500` (rgb(234, 179, 8))
- Completed: `green-500` (rgb(34, 197, 94))
- Cancelled: `red-500` (rgb(239, 68, 68))
- Planning: `purple-500` (rgb(168, 85, 247))

### Ikony (Lucide React)
- Pojazdy: `Truck`
- Pracownicy: `User`
- Sprzęt: `Box`
- Lokalizacja: `MapPin`
- Zegar: `Clock`

## Obsługa zdarzeń

### Hover
- Hover nad paskiem wydarzenia pokazuje tooltip z:
  - Nazwą wydarzenia
  - Zakresem dat
  - Lokalizacją

### Kliknięcie
- Kliknięcie w pasek wydarzenia wywołuje `onEventClick(event)`
- Przekierowuje do szczegółów wydarzenia (`/crm/events/{id}`)

## Wydajność

### Optymalizacje
1. Hook `useGetTimelineResourcesQuery` ładuje dane tylko gdy widok = 'timeline' (`skip: view !== 'timeline'`)
2. Memo w `useMemo` dla obliczania przypisań zasobów
3. Limit 100 elementów sprzętu (można dostosować)

### Cache
- RTK Query cache: 30 sekund
- `keepUnusedDataFor: 30`
- `refetchOnMountOrArgChange: 30`

## Responsywność

Widok Timeline jest dostępny tylko na desktopie (szerokość >= 768px).
Na urządzeniach mobilnych używany jest standardowy widok kalendarza.

## Uprawnienia

Widok Timeline jest dostępny tylko dla:
- Administratorów (`role === 'admin'`)
- Użytkowników z uprawnieniem `admin` w `permissions`

Sprawdzenie w kodzie:
```typescript
const isAdmin = () => {
  if (!currentEmployee) return false;
  return currentEmployee.role === 'admin' || currentEmployee.permissions?.includes('admin');
};
```

## Przyszłe ulepszenia

Potencjalne rozszerzenia:
1. Dodanie widoku miesięcznego timeline
2. Export timeline do PDF/Excel
3. Drag & drop przypisań na timeline
4. Widok konfliktów zasobów
5. Filtrowanie po statusie wydarzenia
6. Grupowanie zasobów po kategorii/lokalizacji
7. Zoom in/out na osi czasu
8. Wyświetlanie dostępności w czasie rzeczywistym
9. Powiadomienia o konfliktach zasobów
10. Historia wykorzystania zasobów

## Testy

Aby przetestować:
1. Zaloguj się jako admin
2. Utwórz kilka wydarzeń z przypisanymi zasobami
3. Otwórz widok Timeline
4. Sprawdź czy paski wydarzeń są wyświetlane poprawnie
5. Przetestuj filtry zasobów
6. Sprawdź hover i kliknięcie w wydarzenie
7. Przetestuj nawigację tygodniową

## Znane ograniczenia

1. Sprzęt ograniczony do 100 elementów (ze względu na wydajność)
2. Brak widoku konfliktów (nakładających się przypisań)
3. Brak oznaczenia dostępności zasobów w czasie rzeczywistym
4. Tylko widok tygodniowy (brak miesiąca/dnia)

## Zgodność z systemem dostępności pojazdów

Timeline integruje się z systemem dostępności pojazdów:
- Funkcja `is_vehicle_available()` może być użyta do walidacji
- Funkcja `get_available_vehicles_for_event()` może filtrować dostępne pojazdy
- Kolorystyka może być rozszerzona o status dostępności
