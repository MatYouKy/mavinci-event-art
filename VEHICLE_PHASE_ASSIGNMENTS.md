# Automatyczne Przypisywanie Pojazdów do Faz Logistycznych

## Przegląd

Przy dodawaniu pojazdu do wydarzenia w zakładce **Logistyka**, system automatycznie:

1. **Sprawdza** czy istnieją fazy logistyczne (Załadunek, Dojazd, Powrót, Rozładunek)
2. **Tworzy** brakujące fazy jeśli nie istnieją
3. **Przypisuje** pojazd do każdej z tych faz w odpowiednich przedziałach czasowych
4. **Wyświetla** pojazd w timeline na zakładce "Fazy"

## Fazy Logistyczne

### 1. Załadunek
- **Czas trwania**: `loading_time_minutes` (domyślnie 60 min)
- **Kiedy**: Przed wyjazdem
- **Obliczenie**: `departureTime - loading_time_minutes`

### 2. Dojazd
- **Czas trwania**: `travel_time_minutes` (domyślnie 60 min)
- **Kiedy**: Od wyjazdu do rozpoczęcia wydarzenia
- **Obliczenie**: `departureTime → eventDateTime`

### 3. Powrót
- **Czas trwania**: `travel_time_minutes`
- **Kiedy**: Po zakończeniu wydarzenia
- **Obliczenie**: `eventEnd → eventEnd + travel_time_minutes`
- **Uwaga**: Jeśli istnieją inne fazy (np. Realizacja, Demontaż), system użyje czasu końcowego ostatniej fazy

### 4. Rozładunek
- **Czas trwania**: `loading_time_minutes`
- **Kiedy**: Po powrocie
- **Obliczenie**: `returnEnd → returnEnd + loading_time_minutes`

## Jak to działa?

### Scenariusz 1: Brak faz logistycznych

```
1. Użytkownik dodaje pojazd w zakładce "Logistyka"
2. System sprawdza: czy są fazy Załadunek/Dojazd/Powrót/Rozładunek?
3. NIE → System tworzy wszystkie 4 fazy automatycznie
4. System przypisuje pojazd do każdej fazy
5. Pojazd pojawia się w timeline w zakładce "Fazy"
```

**Timeline wygląda tak:**
```
[Załadunek] → [Dojazd] → [Realizacja] → [Powrót] → [Rozładunek]
  Pojazd       Pojazd                      Pojazd     Pojazd
```

### Scenariusz 2: Fazy już istnieją

```
1. Użytkownik dodaje pojazd w zakładce "Logistyka"
2. System sprawdza: czy są fazy Załadunek/Dojazd/Powrót/Rozładunek?
3. TAK → System używa istniejących czasów faz
4. System przypisuje pojazd do każdej istniejącej fazy
5. Pojazd pojawia się w timeline w istniejących blokach
```

**Timeline wygląda tak:**
```
[Załadunek] → [Dojazd] → [Realizacja] → [Powrót] → [Rozładunek]
  Pojazd       Pojazd                      Pojazd     Pojazd
  (istn.)      (istn.)                     (istn.)    (istn.)
```

### Scenariusz 3: Częściowo istnieją fazy

```
1. Użytkownik dodaje pojazd w zakładce "Logistyka"
2. System sprawdza: Załadunek ✓, Dojazd ✓, Powrót ✗, Rozładunek ✗
3. System używa istniejących czasów dla Załadunek i Dojazd
4. System tworzy Powrót i Rozładunek z obliczonych czasów
5. Pojazd jest przypisany do wszystkich 4 faz
```

## Implementacja

### AddEventVehicleModal.tsx

Funkcja `assignVehicleToLogisticPhases()`:

1. Pobiera typy faz (Załadunek, Dojazd, Powrót, Rozładunek) z `event_phase_types`
2. Pobiera istniejące fazy dla wydarzenia
3. Pobiera wszystkie fazy aby znaleźć rzeczywisty koniec wydarzenia
4. Dla każdego typu fazy:
   - Jeśli faza istnieje → użyj jej czasów
   - Jeśli nie istnieje → oblicz czasy i utwórz fazę
5. Tworzy przypisania w `event_phase_vehicles` dla każdej fazy

### ResourceTimeline.tsx

Timeline automatycznie:
1. Pobiera `vehicleAssignments` dla każdej fazy (przez `PhaseAssignmentsLoader`)
2. Wyświetla pojazdy w odpowiednich blokach czasowych
3. Umożliwia edycję czasu przypisania (drag & drop)
4. Pokazuje konflikty gdy pojazd jest zajęty w tym samym czasie

## Zalety

✅ **Automatyzacja** - Użytkownik nie musi ręcznie przypisywać pojazdu do każdej fazy
✅ **Spójność** - Wszystkie pojazdy logistyczne są widoczne w timeline
✅ **Elastyczność** - System radzi sobie zarówno z nowymi jak i istniejącymi fazami
✅ **Bezpieczeństwo** - Konflikty są wykrywane i pokazywane w timeline
✅ **Edycja** - Czasy przypisań można modyfikować w timeline

## Dostęp do danych

### Z poziomu bazy danych

```sql
-- Pobierz wszystkie przypisania pojazdów do faz
SELECT
  ep.name as phase_name,
  v.name as vehicle_name,
  v.registration_number,
  epv.assigned_start,
  epv.assigned_end,
  epv.purpose
FROM event_phase_vehicles epv
JOIN event_phases ep ON ep.id = epv.phase_id
JOIN vehicles v ON v.id = epv.vehicle_id
WHERE ep.event_id = '<event_id>'
ORDER BY epv.assigned_start;
```

### Z poziomu API (RTK Query)

```typescript
import { useGetPhaseVehiclesQuery } from '@/store/api/eventPhasesApi';

const { data: vehicleAssignments } = useGetPhaseVehiclesQuery(phaseId);
```

## Uwagi

⚠️ **Pojazdy zewnętrzne** - Tylko pojazdy z floty (`is_external = false`) są automatycznie przypisywane do faz

⚠️ **Edycja** - Jeśli użytkownik edytuje pojazd w "Logistyce", przypisania do faz NIE są aktualizowane automatycznie

⚠️ **Usuwanie** - Usunięcie pojazdu z "Logistyki" NIE usuwa automatycznie przypisań do faz (może być to feature w przyszłości)

## Przyszłe ulepszenia

🔄 **Synchronizacja** - Aktualizacja czasów pojazdu w "Logistyce" mogłaby automatycznie aktualizować przypisania do faz

🗑️ **Kaskadowe usuwanie** - Usunięcie pojazdu z "Logistyki" mogłoby opcjonalnie usuwać wszystkie przypisania do faz

🎯 **Inteligentne wykrywanie** - System mógłby automatycznie wykrywać inne fazy (np. Montaż, Demontaż) i przypisywać pojazdy zgodnie z ich rolą
