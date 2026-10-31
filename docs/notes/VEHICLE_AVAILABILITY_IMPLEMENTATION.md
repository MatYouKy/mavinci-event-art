# Implementacja sprawdzania dostępności pojazdów

## Dodane funkcje bazodanowe

### 1. `is_vehicle_available()`

Sprawdza czy pojazd jest dostępny w podanym terminie.

**Parametry:**
- `p_vehicle_id` (uuid) - ID pojazdu
- `p_start_date` (timestamptz) - Data rozpoczęcia
- `p_end_date` (timestamptz) - Data zakończenia
- `p_exclude_event_vehicle_id` (uuid, opcjonalny) - ID przypisania pojazdu do pominięcia (używane przy edycji)

**Zwraca:** `boolean` - `true` jeśli dostępny, `false` jeśli zajęty

**Przykład użycia:**
```sql
SELECT is_vehicle_available(
  '123e4567-e89b-12d3-a456-426614174000',
  '2026-02-28 00:00:00+00',
  '2026-03-01 23:59:59+00'
);
```

### 2. `get_available_vehicles_for_event()`

Zwraca listę wszystkich aktywnych pojazdów z informacją o dostępności.

**Parametry:**
- `p_start_date` (timestamptz) - Data rozpoczęcia wydarzenia
- `p_end_date` (timestamptz) - Data zakończenia wydarzenia
- `p_exclude_event_vehicle_id` (uuid, opcjonalny) - ID przypisania do pominięcia
- `p_vehicle_type` (text, opcjonalny) - Filtr typu pojazdu (car, truck, van, trailer)

**Zwraca tabelę z kolumnami:**
- `id` - ID pojazdu
- `name` - Nazwa pojazdu
- `brand` - Marka
- `model` - Model
- `registration_number` - Numer rejestracyjny
- `status` - Status pojazdu
- `vehicle_type` - Typ pojazdu
- `number_of_seats` - Liczba miejsc
- `year` - Rok produkcji
- `notes` - Notatki
- `is_available` - Czy pojazd jest dostępny (boolean)
- `conflicting_events_count` - Liczba konfliktujących wydarzeń

**Sortowanie:** Dostępne pojazdy są wyświetlane jako pierwsze, następnie alfabetycznie po nazwie.

**Przykład użycia:**
```sql
SELECT * FROM get_available_vehicles_for_event(
  '2026-02-28 00:00:00+00',
  '2026-03-01 23:59:59+00',
  NULL,
  'car'
);
```

## Logika sprawdzania dostępności

Funkcja sprawdza konflikty z:

1. **Innymi wydarzeniami** (`event_vehicles` + `events`)
   - Tylko aktywne przypisania (status != 'cancelled')
   - Tylko aktywne wydarzenia (status != 'cancelled')
   - Uwzględnia czasy z `event_phases` jeśli istnieją
   - Sprawdza nakładanie się terminów

2. **Serwisami i naprawami** (`maintenance_records`)
   - Tylko serwisy w trakcie lub zaplanowane
   - Sprawdza nakładanie się dat

3. **Statusem pojazdu**
   - Tylko pojazdy ze statusem 'active' są dostępne

## Integracja z frontendem

### Hook React

Skopiuj plik `useVehicleAvailability-example.ts` jako `useVehicleAvailability.ts` do folderu hooks:

```typescript
import { useVehicleAvailability } from '@/hooks/useVehicleAvailability';

const { availableVehicles, unavailableVehicles, isLoading } = useVehicleAvailability({
  startDate: eventStartDate,
  endDate: eventEndDate,
  enabled: true,
});
```

### Użycie w AddEventVehicleModal

```typescript
export default function AddEventVehicleModal({ eventStartDate, eventEndDate }) {
  const { availableVehicles, unavailableVehicles, isLoading } = useVehicleAvailability({
    startDate: eventStartDate,
    endDate: eventEndDate,
  });

  return (
    <div>
      {/* Sekcja dostępnych pojazdów */}
      <div className="available-section">
        <h3>Dostępne pojazdy ({availableVehicles.length})</h3>
        {availableVehicles.map(vehicle => (
          <VehicleCard
            key={vehicle.id}
            vehicle={vehicle}
            available={true}
          />
        ))}
      </div>

      {/* Sekcja niedostępnych pojazdów */}
      <div className="unavailable-section">
        <h3>Niedostępne pojazdy ({unavailableVehicles.length})</h3>
        {unavailableVehicles.map(vehicle => (
          <VehicleCard
            key={vehicle.id}
            vehicle={vehicle}
            available={false}
            conflictsCount={vehicle.conflicting_events_count}
          />
        ))}
      </div>
    </div>
  );
}
```

## Wskazówki UI/UX

1. **Wizualne rozróżnienie:**
   - Dostępne pojazdy: zielona ramka/badge
   - Niedostępne pojazdy: czerwona ramka/badge z licznikiem konfliktów

2. **Sortowanie:**
   - Dostępne pojazdy zawsze na górze
   - Opcjonalnie: możliwość ukrycia niedostępnych

3. **Informacje o konflikcie:**
   - Pokaż tooltip z informacją "Niedostępny (X konfliktów)"
   - Opcjonalnie: link do szczegółów konfliktujących wydarzeń

4. **Filtrowanie:**
   - Dodaj możliwość filtrowania po typie pojazdu
   - Checkbox "Pokaż tylko dostępne"

## Testowanie

```sql
-- Test 1: Sprawdź dostępność dla terminu z konfliktem
SELECT * FROM get_available_vehicles_for_event(
  '2026-02-28 00:00:00+00',
  '2026-03-01 23:59:59+00'
);

-- Test 2: Sprawdź dostępność dla wolnego terminu
SELECT * FROM get_available_vehicles_for_event(
  '2026-01-01 00:00:00+00',
  '2026-01-02 23:59:59+00'
);

-- Test 3: Sprawdź konkretny pojazd
SELECT is_vehicle_available(
  (SELECT id FROM vehicles WHERE name = 'PASERATTI' LIMIT 1),
  '2026-02-28 00:00:00+00',
  '2026-03-01 23:59:59+00'
);
```

## Wydajność

- Funkcje używają indeksów na `event_vehicles.vehicle_id` i `events.event_date`
- Zapytania są zoptymalizowane pod kątem wydajności
- Używają SECURITY DEFINER dla spójności uprawnień

## Uprawnienia

Funkcje są dostępne dla:
- `authenticated` - zalogowani użytkownicy
- `anon` - użytkownicy anonimowi (jeśli potrzebne)

## Gotowe do użycia

✅ Funkcje bazodanowe utworzone i przetestowane
✅ Hook React przygotowany w pliku przykładowym
✅ Dokumentacja implementacji gotowa

**Następny krok:** Zintegruj hook z istniejącym modalem dodawania pojazdów do wydarzeń.
