# Automatyczne Odświeżanie Timeline Po Dodaniu/Usunięciu Pojazdu

## Przegląd

System został zaktualizowany aby **automatycznie odświeżać timeline i sekcję logistyki** po każdej operacji na pojazdach (dodanie/usunięcie).

## Implementacja

### 1. Dodanie Pojazdu (`AddEventVehicleModal.tsx`)

Po dodaniu pojazdu system automatycznie:

```typescript
// Invaliduj cache pojazdów i logistyki dla wydarzenia
dispatch(eventsApi.util.invalidateTags([
  { type: 'EventVehicles', id: eventId },
  { type: 'EventLogistics', id: eventId },
]));

// Invaliduj cache faz logistycznych
dispatch(
  eventPhasesApi.util.invalidateTags(
    logisticPhases.map((p) => ({ type: 'PhaseVehicles', id: p.id }))
  )
);
```

**Efekt:**
- ✅ Timeline natychmiast pokazuje nowy pojazd
- ✅ Sekcja "Pojazdy" w logistyce odświeża listę
- ✅ Pojazd jest wyświetlany jako jedna ciągła linia od załadunku do rozładunku

### 2. Usunięcie Pojazdu (`EventLogisticsPanel.tsx`)

Po usunięciu pojazdu system automatycznie:

```typescript
// Invaliduj cache dla pojazdów i logistyki
dispatch(eventsApi.util.invalidateTags([
  { type: 'EventVehicles', id: eventId },
  { type: 'EventLogistics', id: eventId },
]));

// Invaliduj cache dla faz logistycznych
if (vehicleData?.vehicle_id) {
  dispatch(
    eventPhasesApi.util.invalidateTags(
      logisticPhases.map((p) => ({ type: 'PhaseVehicles', id: p.id }))
    )
  );
}
```

**Efekt:**
- ✅ Timeline natychmiast usuwa pojazd
- ✅ Sekcja "Pojazdy" w logistyce odświeża listę
- ✅ Przypisania do faz są usuwane

## Realtime Subscriptions

### Timeline (`EventPhasesTimeline.tsx`)

```typescript
// Nasłuchuje zmian w event_phase_vehicles
useEffect(() => {
  const channel = supabase
    .channel(`event_phase_vehicles_${eventId}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'event_phase_vehicles',
    }, (payload) => {
      // Invaliduj cache dla wszystkich faz
      phases.forEach((phase) => {
        dispatch(
          eventPhasesApi.util.invalidateTags([
            { type: 'PhaseVehicles', id: phase.id }
          ])
        );
      });
    })
    .subscribe();

  return () => supabase.removeChannel(channel);
}, [eventId, phases]);
```

### Logistyka (`EventLogisticsPanel.tsx`)

```typescript
// Nasłuchuje zmian w event_vehicles
useEffect(() => {
  const channel = supabase
    .channel(`event_vehicles_changes_${eventId}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'event_vehicles',
      filter: `event_id=eq.${eventId}`
    }, () => {
      console.log('event_vehicles changed - refreshing logistics');
      fetchLogistics(args);
    })
    .subscribe();

  return () => supabase.removeChannel(channel);
}, [eventId]);
```

## RTK Query Cache Tags

System używa następujących tagów do automatycznej invalidacji:

| Tag | Zakres | Kiedy invalidowane |
|-----|--------|-------------------|
| `EventVehicles` | Lista pojazdów wydarzenia | Dodanie/usunięcie pojazdu |
| `EventLogistics` | Dane logistyczne (pojazdy + timeline + ładunek) | Dodanie/usunięcie pojazdu |
| `PhaseVehicles` | Przypisania pojazdów do konkretnej fazy | Dodanie/usunięcie/zmiana przypisania |

## Przepływ Danych

```
┌─────────────────────────────────────────────────────────┐
│ 1. DODANIE POJAZDU                                      │
├─────────────────────────────────────────────────────────┤
│ AddEventVehicleModal                                    │
│   ↓ INSERT do event_vehicles                           │
│   ↓ INSERT do event_phase_vehicles (Załadunek)         │
│   ↓ dispatch(invalidateTags)                           │
├─────────────────────────────────────────────────────────┤
│ 2. INVALIDACJA CACHE                                    │
│   → EventVehicles (lista pojazdów)                     │
│   → EventLogistics (sekcja logistyki)                  │
│   → PhaseVehicles (przypisania do faz)                 │
├─────────────────────────────────────────────────────────┤
│ 3. AUTOMATYCZNE ODŚWIEŻENIE                            │
│   → EventPhasesTimeline (timeline się przeładowuje)    │
│   → EventLogisticsPanel (sekcja się przeładowuje)      │
│   → ResourceTimeline (pojazd pojawia się jako linia)   │
└─────────────────────────────────────────────────────────┘
```

## Wytyczne Rozwoju

### Przy dodawaniu nowych operacji na pojazdach:

1. **Zawsze invaliduj odpowiednie tagi:**
   ```typescript
   dispatch(eventsApi.util.invalidateTags([
     { type: 'EventVehicles', id: eventId },
     { type: 'EventLogistics', id: eventId },
   ]));
   ```

2. **Jeśli operacja dotyczy przypisań do faz:**
   ```typescript
   dispatch(
     eventPhasesApi.util.invalidateTags(
       phases.map((p) => ({ type: 'PhaseVehicles', id: p.id }))
     )
   );
   ```

3. **Realtime subscription już obsługuje:**
   - Zmiany w `event_vehicles`
   - Zmiany w `event_phase_vehicles`
   - Nie trzeba dodawać dodatkowych subskrypcji

## Zalety

✅ **Natychmiastowa aktualizacja** - użytkownik widzi zmiany od razu
✅ **Automatyczna synchronizacja** - timeline i logistyka zawsze spójne
✅ **Bez duplikatów** - `ResourceTimeline` deduplikuje przypisania
✅ **Jedna ciągła linia** - pojazd wyświetlany od załadunku do rozładunku
✅ **Realtime** - zmiany od innych użytkowników też są widoczne

## Testowanie

### Scenariusz 1: Dodanie pojazdu
1. Otwórz wydarzenie
2. Przejdź do zakładki "Fazy" (timeline)
3. Kliknij "Dodaj pojazd" w sekcji "Pojazdy"
4. Wybierz pojazd i zapisz
5. ✅ Timeline natychmiast pokazuje pojazd jako jedną linię

### Scenariusz 2: Usunięcie pojazdu
1. Otwórz wydarzenie z przypisanym pojazdem
2. W sekcji "Pojazdy" kliknij "Usuń"
3. Potwierdź usunięcie
4. ✅ Timeline natychmiast usuwa pojazd
5. ✅ Lista pojazdów się odświeża

### Scenariusz 3: Realtime (wielu użytkowników)
1. Otwórz to samo wydarzenie w dwóch przeglądarkach
2. W jednej przeglądarce dodaj pojazd
3. ✅ W drugiej przeglądarce pojazd pojawia się automatycznie

## Pliki Zmodyfikowane

- ✅ `src/components/crm/AddEventVehicleModal.tsx` - invalidacja po dodaniu
- ✅ `src/app/(crm)/crm/events/[id]/components/tabs/EventLogisticsPanel.tsx` - invalidacja po usunięciu
- ✅ `src/app/(crm)/crm/events/[id]/components/tabs/EventPhasesTimeline.tsx` - realtime subscription (już było)
- ✅ `src/app/(crm)/crm/events/[id]/components/tabs/ResourceTimeline.tsx` - deduplikacja (już zrobione wcześniej)
