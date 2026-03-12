# Umożliwienie Tworzenia Ofert z Konfliktami Sprzętowymi

## Problem

1. **Kreator oferty blokował tworzenie** gdy wykrywał konflikty sprzętowe
2. Użytkownik nie mógł utworzyć oferty mimo wyboru "dodaj mimo to"
3. Brak informacji że event ma braki sprzętowe

## Rozwiązanie

### 1. Migracja Bazy Danych

**Plik**: `supabase/migrations/add_equipment_shortage_flag_to_events.sql`

Dodano pole `has_equipment_shortage` do tabeli `events`:

```sql
ALTER TABLE events
ADD COLUMN IF NOT EXISTS has_equipment_shortage boolean DEFAULT false;
```

### 2. Zmiana Logiki Kreatora Oferty

**Plik**: `useOfferWizzard.ts`

**PRZED:**
```typescript
const rows = await conflicts.checkCartConflicts(items.offerItems);
if (rows.length > 0) {
  showDialog({
    title: 'Nie możesz utworzyć oferty – brakuje sprzętu',
    type: 'warning',
  });
  return; // ❌ BLOKADA
}
```

**PO:**
```typescript
const rows = await conflicts.checkCartConflicts(items.offerItems);
let hasEquipmentShortage = false;

if (rows.length > 0) {
  const confirmed = await showDialog({
    title: 'Wykryto konflikty sprzętowe',
    message: `Brakuje ${rows.length} pozycji sprzętu.\n\nCzy chcesz utworzyć ofertę mimo to?\n\nEvent zostanie oznaczony jako mający braki sprzętowe.`,
    type: 'warning',
    confirmText: 'Utwórz mimo to',
    cancelText: 'Anuluj',
  });

  if (!confirmed) return; // ✅ Użytkownik decyduje
  hasEquipmentShortage = true;
}
```

### 3. Aktualizacja Flagi w Evencie

**Plik**: `useOfferWizzardSubmit.ts`

Po utworzeniu oferty, jeśli były konflikty:

```typescript
// Jeśli oferta ma braki sprzętowe, oznacz event
if (params.hasEquipmentShortage) {
  const { error: eventError } = await supabase
    .from('events')
    .update({ has_equipment_shortage: true })
    .eq('id', params.eventId);
}
```

### 4. Wizualizacja w UI

**Plik**: `EventDetailsAction.tsx`

Dodano sekcję pokazującą status ofert i ostrzeżenie o brakach:

```tsx
<div>
  <label>Oferty</label>
  <div className={hasOffers ? 'green' : 'orange'}>
    {hasOffers ? `${offersCount} ofert` : 'Brak oferty'}
  </div>

  {/* ✅ NOWE: Ostrzeżenie o brakach */}
  {event?.has_equipment_shortage && (
    <div className="red-alert">
      <AlertTriangle />
      Event ma braki sprzętowe w terminie. Sprawdź konflikty w zakładce Sprzęt.
    </div>
  )}
</div>
```

## Przepływ Użytkownika

### Scenariusz 1: Tworzenie oferty BEZ konfliktów

1. Użytkownik dodaje produkty do oferty
2. Klikuje "Utwórz ofertę"
3. System sprawdza konflikty → brak
4. Oferta tworzona natychmiast ✅
5. `has_equipment_shortage = false`

### Scenariusz 2: Tworzenie oferty Z konfliktami

1. Użytkownik dodaje produkty do oferty
2. Klikają "Utwórz ofertę"
3. System wykrywa 3 konflikty sprzętowe
4. **Dialog**: "Brakuje 3 pozycji sprzętu. Czy chcesz utworzyć mimo to?"
5. Użytkownik klika **"Utwórz mimo to"**
6. Oferta tworzona ✅
7. `has_equipment_shortage = true`
8. W zakładce szczegółów eventu pokazuje się:
   ```
   ⚠️ Event ma braki sprzętowe w terminie. Sprawdź konflikty w zakładce Sprzęt.
   ```

### Scenariusz 3: Użytkownik rezygnuje

1. System wykrywa konflikty
2. Dialog: "Czy chcesz utworzyć mimo to?"
3. Użytkownik klika **"Anuluj"**
4. Oferta NIE jest tworzona
5. Użytkownik może wrócić i zmienić wybór sprzętu

## Co Zostało Dodane/Zmienione

### Baza Danych
- ✅ Kolumna `events.has_equipment_shortage` (boolean, default false)
- ✅ Indeks dla szybkiego filtrowania

### Frontend
- ✅ Dialog potwierdzenia z konfliktami
- ✅ Przekazywanie flagi `hasEquipmentShortage` do submit
- ✅ Aktualizacja eventu po utworzeniu oferty z konfliktami
- ✅ Wizualne ostrzeżenie w `EventDetailsAction`
- ✅ Sekcja "Oferty" z liczbą ofert
- ✅ Sekcja "Brak oferty" gdy nie ma żadnej

### Typy TypeScript
- ✅ `IEvent.has_equipment_shortage?: boolean`
- ✅ `submitOfferWizard` param `hasEquipmentShortage`

## Korzyści

1. **Elastyczność** - użytkownik decyduje czy kontynuować mimo konfliktów
2. **Przejrzystość** - jasna informacja o brakach sprzętowych
3. **Świadomość** - ostrzeżenie widoczne w szczegółach eventu
4. **Kontrola** - możliwość anulowania przed utworzeniem

## Testowanie

### Test 1: Oferta bez konfliktów
- [ ] Dodaj produkty które są dostępne
- [ ] Utwórz ofertę
- [ ] Sprawdź że `has_equipment_shortage = false`
- [ ] Sprawdź że brak ostrzeżenia w UI

### Test 2: Oferta z konfliktami - akceptacja
- [ ] Dodaj produkty z konfliktami
- [ ] Kliknij "Utwórz ofertę"
- [ ] Dialog pokazuje liczbę konfliktów
- [ ] Kliknij "Utwórz mimo to"
- [ ] Oferta utworzona ✅
- [ ] `has_equipment_shortage = true`
- [ ] Ostrzeżenie widoczne w EventDetailsAction

### Test 3: Oferta z konfliktami - anulowanie
- [ ] Dodaj produkty z konfliktami
- [ ] Kliknij "Utwórz ofertę"
- [ ] Kliknij "Anuluj" w dialogu
- [ ] Oferta NIE utworzona
- [ ] Brak zmian w evencie

### Test 4: Sekcja Oferty w UI
- [ ] Event bez ofert → "Brak oferty" (pomarańczowy)
- [ ] Event z 1 ofertą → "1 oferta" (zielony)
- [ ] Event z 3 ofertami → "3 oferty" (zielony)
- [ ] Event z brakami → ostrzeżenie czerwone widoczne

## Pliki Zmodyfikowane

1. **Migracja**
   - `supabase/migrations/add_equipment_shortage_flag_to_events.sql`

2. **Frontend Logic**
   - `useOfferWizzard.ts` - dialog potwierdzenia
   - `useOfferWizzardSubmit.ts` - aktualizacja flagi eventu
   - `EventDetailsAction.tsx` - wizualizacja statusu i ostrzeżeń
   - `EventDetailPageClient.tsx` - przekazanie danych o ofertach

3. **Typy**
   - `src/app/(crm)/crm/events/type.ts` - dodano `has_equipment_shortage`

## Notes

- Flaga `has_equipment_shortage` NIE jest resetowana automatycznie przy usunięciu oferty
- To pozwala zachować informację historyczną o brakach
- Użytkownik może ręcznie zmienić flagę edytując event (jeśli będzie taka potrzeba)
