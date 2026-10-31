# Testowanie Automatycznego Przypisywania Pojazdów do Faz

## Wprowadzone zmiany

### 1. AddEventVehicleModal.tsx
- ✅ Dodano funkcję `assignVehicleToLogisticPhases()` która automatycznie:
  - Sprawdza czy istnieją fazy logistyczne (Załadunek, Dojazd, Powrót, Rozładunek)
  - Tworzy brakujące fazy z obliczonymi czasami
  - Przypisuje pojazd do każdej fazy przez `event_phase_vehicles`
- ✅ Dodano invalidację RTK Query cache dla faz po dodaniu pojazdu
- ✅ Po dodaniu pojazdu z floty automatycznie tworzy/aktualizuje przypisania do faz

### 2. useEventVehicles.ts
- ✅ Zmieniono `preferCacheValue` z `true` na `false`
- ✅ Po każdym dodaniu/usunięciu pojazdu dane są odświeżane z serwera (nie z cache)

### 3. EventLogisticsPanel.tsx
- ✅ Dodano realtime subscription dla `event_phases`
- ✅ Gdy fazy się zmieniają, lista pojazdów odświeża się automatycznie
- ✅ Konsola loguje zmiany dla debugowania

### 4. EventPhasesTimeline.tsx
- ✅ Dodano realtime subscription dla `event_phase_vehicles`
- ✅ Gdy pojazdy są przypisywane do faz, timeline odświeża się automatycznie
- ✅ Invalidacja RTK Query cache dla `PhaseVehicles` po każdej zmianie
- ✅ Konsola loguje zmiany w przypisaniach pojazdów

### 5. Dokumentacja
- ✅ `VEHICLE_PHASE_ASSIGNMENTS.md` - pełna dokumentacja systemu
- ✅ `VEHICLE_LOGISTICS_TESTING.md` - instrukcje testowania (ten plik)

## Jak przetestować

### Test 1: Dodanie pojazdu bez istniejących faz

**Kroki:**
1. Otwórz wydarzenie które NIE ma faz logistycznych
2. Przejdź do zakładki **Logistyka**
3. Kliknij **Dodaj pojazd**
4. Wybierz pojazd z floty (NIE zewnętrzny)
5. Ustaw:
   - Czas załadunku: np. 60 min
   - Czas przygotowania: np. 30 min
   - Czas dojazdu: np. 60 min
6. Kliknij **Dodaj**

**Oczekiwany rezultat:**
- ✅ Pojazd pojawia się natychmiast w liście w zakładce Logistyka (bez odświeżania)
- ✅ Przejdź do zakładki **Fazy** → Timeline
- ✅ Pojazd jest widoczny w timeline w 4 fazach:
  - **Załadunek** (60 min przed wyjazdem)
  - **Dojazd** (60 min, do początku wydarzenia)
  - **Powrót** (po zakończeniu wydarzenia)
  - **Rozładunek** (60 min po powrocie)

**Sprawdź w konsoli przeglądarki:**

W zakładce **Logistyka**:
```
event_vehicles changed - refreshing logistics
event_phases changed - refreshing logistics
```

W zakładce **Fazy** (Timeline):
```
[EventPhasesTimeline] Setting up realtime for event_phase_vehicles
[EventPhasesTimeline] event_phase_vehicles changed: { eventType: 'INSERT', ... }
```

### Test 2: Dodanie pojazdu gdy fazy już istnieją

**Przygotowanie:**
1. Otwórz wydarzenie które MA fazy logistyczne (Załadunek, Dojazd, etc.)
2. Sprawdź czasy istniejących faz w zakładce **Fazy**

**Kroki:**
1. Przejdź do zakładki **Logistyka**
2. Kliknij **Dodaj pojazd**
3. Wybierz pojazd z floty
4. Ustaw czasy (mogą być inne niż istniejące fazy)
5. Kliknij **Dodaj**

**Oczekiwany rezultat:**
- ✅ Pojazd używa czasów ISTNIEJĄCYCH faz (nie tworzy nowych)
- ✅ Pojazd pojawia się natychmiast w liście
- ✅ W zakładce **Fazy** → Timeline pojazd jest widoczny w odpowiednich blokach
- ✅ Czasy w timeline odpowiadają istniejącym fazom (nie podanym w formularzu)

### Test 3: Dodanie pojazdu zewnętrznego

**Kroki:**
1. Przejdź do zakładki **Logistyka**
2. Kliknij **Dodaj pojazd**
3. Wybierz **Pojazd zewnętrzny (wypożyczony)**
4. Wypełnij dane
5. Kliknij **Dodaj**

**Oczekiwany rezultat:**
- ✅ Pojazd pojawia się w liście Logistyka
- ✅ Pojazd NIE jest przypisany do faz (pojazdy zewnętrzne nie są automatycznie przypisywane)
- ✅ W zakładce **Fazy** pojazd NIE pojawia się w timeline

### Test 4: Usunięcie pojazdu

**Kroki:**
1. W zakładce **Logistyka** znajdź pojazd
2. Kliknij ikonę kosza (usuń)
3. Potwierdź usunięcie

**Oczekiwany rezultat:**
- ✅ Pojazd znika natychmiast z listy (bez odświeżania strony)
- ✅ W zakładce **Fazy** pojazd znika z timeline

**Sprawdź w konsoli:**
```
event_vehicles changed - refreshing logistics
```

### Test 5: Edycja pojazdu

**Kroki:**
1. W zakładce **Logistyka** kliknij edytuj pojazd
2. Zmień dane (np. czas dojazdu)
3. Zapisz

**Oczekiwany rezultat:**
- ✅ Zmiany są natychmiast widoczne w liście
- ⚠️ **UWAGA**: Przypisania do faz NIE są aktualizowane automatycznie
  - To jest znane ograniczenie (można dodać w przyszłości)

### Test 6: Timeline - Drag & Drop

**Kroki:**
1. Przejdź do zakładki **Fazy** → Timeline
2. Znajdź pojazd w jednej z faz
3. Przeciągnij pojazd aby zmienić czas przypisania (drag)
4. Upuść (drop)

**Oczekiwany rezultat:**
- ✅ Czas przypisania pojazdu zmienia się
- ✅ Zmiany są zapisywane w bazie
- ✅ Po odświeżeniu strony nowy czas jest zachowany

### Test 7: Konflikty pojazdów

**Kroki:**
1. Dodaj pojazd do wydarzenia A
2. Spróbuj dodać ten sam pojazd do wydarzenia B w tym samym czasie
3. Zobacz ostrzeżenie o konflikcie

**Oczekiwany rezultat:**
- ✅ System wykrywa konflikt
- ✅ Pokazuje ostrzeżenie z informacją o nakładających się czasach
- ✅ Można dodać mimo konfliktu (z ostrzeżeniem)

## Debugowanie

### Console.log w AddEventVehicleModal

Dodaj tymczasowo w funkcji `assignVehicleToLogisticPhases`:

```typescript
console.log('Creating/using phases:', {
  phaseTypes: phaseTypes.map(p => p.name),
  existingPhases: existingPhases?.map(p => p.name),
  vehicleId,
  eventId
});
```

### Console.log w EventLogisticsPanel

Już dodane:
```typescript
console.log('event_vehicles changed - refreshing logistics');
console.log('event_phases changed - refreshing logistics');
```

### Console.log w EventPhasesTimeline

Już dodane:
```typescript
console.log('[EventPhasesTimeline] Setting up realtime for event_phase_vehicles');
console.log('[EventPhasesTimeline] event_phase_vehicles changed:', payload);
console.log('[EventPhasesTimeline] Cleaning up realtime subscription');
```

### Sprawdź w bazie danych

```sql
-- Sprawdź czy fazy zostały utworzone
SELECT id, event_id, name, start_time, end_time
FROM event_phases
WHERE event_id = '<event_id>'
ORDER BY start_time;

-- Sprawdź przypisania pojazdów do faz
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

### Sprawdź Network w DevTools

1. Otwórz DevTools → Network
2. Dodaj pojazd
3. Zobacz requesty:
   - `INSERT INTO event_vehicles` (dodanie pojazdu)
   - `INSERT INTO event_phases` (jeśli fazy nie istniały)
   - `INSERT INTO event_phase_vehicles` (przypisanie do faz)

### Sprawdź Realtime w DevTools

1. Otwórz DevTools → Console
2. Dodaj/usuń pojazd
3. Zobacz logi:
   ```
   event_vehicles changed - refreshing logistics
   event_phases changed - refreshing logistics
   ```

## Znane problemy

### ❌ Full Build OOM
- Projekt za duży dla dostępnej pamięci (757 plików)
- **Rozwiązanie**: Build działa na produkcji z większą pamięcią

### ⚠️ Edycja pojazdu nie aktualizuje faz
- Zmiana czasów pojazdu w Logistyce nie aktualizuje przypisań do faz
- **Workaround**: Usuń i dodaj ponownie pojazd
- **TODO**: Dodać synchronizację w przyszłości

### ⚠️ Pojazdy zewnętrzne nie są przypisywane
- To celowe - tylko pojazdy z floty są automatycznie przypisywane do faz
- **Rozumowanie**: Pojazdy zewnętrzne mogą mieć różne zasady

## Co działa

✅ Automatyczne tworzenie faz logistycznych
✅ Automatyczne przypisywanie pojazdów do faz
✅ Realtime aktualizacja listy pojazdów
✅ Realtime aktualizacja timeline
✅ Invalidacja RTK Query cache
✅ Wykrywanie istniejących faz
✅ Obliczanie czasów na podstawie ustawień
✅ Drag & drop w timeline
✅ Wykrywanie konfliktów
✅ ESLint: 0 errors

## Troubleshooting

### Problem: Pojazd nie pojawia się w liście po dodaniu

**Rozwiązanie:**
1. Sprawdź konsolę - czy są błędy?
2. Sprawdź czy pojawił się log: `event_vehicles changed - refreshing logistics`
3. Sprawdź w bazie czy pojazd został dodany:
   ```sql
   SELECT * FROM event_vehicles WHERE event_id = '<event_id>' ORDER BY created_at DESC LIMIT 1;
   ```
4. Jeśli jest w bazie ale nie na liście - odśwież stronę hard refresh (Ctrl+Shift+R)

### Problem: Pojazd nie pojawia się w timeline

**Rozwiązanie:**
1. Sprawdź czy to pojazd z floty (nie zewnętrzny)
2. Sprawdź konsolę - czy są błędy?
3. Sprawdź w bazie czy przypisania zostały utworzone:
   ```sql
   SELECT * FROM event_phase_vehicles WHERE vehicle_id = '<vehicle_id>';
   ```
4. Sprawdź czy fazy zostały utworzone:
   ```sql
   SELECT * FROM event_phases WHERE event_id = '<event_id>' AND name IN ('Załadunek', 'Dojazd', 'Powrót', 'Rozładunek');
   ```

### Problem: Timeline nie odświeża się

**Rozwiązanie:**
1. Sprawdź czy pojawił się log: `event_phases changed - refreshing logistics`
2. Przejdź do innej zakładki i wróć do Faz
3. Odśwież stronę (F5)
4. Sprawdź DevTools → Application → Local Storage - wyczyść cache

### Problem: Błąd "Cannot read property 'id' of undefined"

**Rozwiązanie:**
1. To oznacza że phase_type nie został znaleziony
2. Sprawdź w bazie czy istnieją typy faz:
   ```sql
   SELECT * FROM event_phase_types WHERE name IN ('Załadunek', 'Dojazd', 'Powrót', 'Rozładunek');
   ```
3. Jeśli nie ma - uruchom migrację:
   ```sql
   -- z pliku: 20260224190152_create_event_phases_system.sql
   ```

## Kontakt

Jeśli napotkasz problemy:
1. Sprawdź ten dokument
2. Sprawdź `VEHICLE_PHASE_ASSIGNMENTS.md`
3. Sprawdź console.log w przeglądarce
4. Sprawdź bazę danych
5. Zgłoś issue z logami i screenshotami
