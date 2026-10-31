# System Braków Sprzętowych - Finalna Implementacja

## Przegląd

System zarządzania brakami sprzętowymi przy tworzeniu ofert z konfliktami dostępności.

## Jak Działa

### 1. Tworzenie Oferty z Konfliktami

**Plik:** `useOfferWizzard.ts`

```typescript
const rows = await conflicts.checkCartConflicts(items.offerItems);
let hasEquipmentShortage = false;

if (rows.length > 0) {
  const confirmed = await showConfirm({
    title: 'Wykryto konflikty sprzętowe',
    message: `Brakuje ${rows.length} pozycji sprzętu w terminie eventu.\n\nCzy chcesz utworzyć ofertę mimo to?\n\nEvent zostanie oznaczony jako mający braki sprzętowe.`,
    confirmText: 'Utwórz mimo to',
    cancelText: 'Anuluj',
  });

  if (!confirmed) return; // ✅ Użytkownik anulował
  hasEquipmentShortage = true; // ✅ Użytkownik zaakceptował
}
```

**UWAGA:** Używamy `showConfirm()` zamiast `showDialog()` - `showConfirm` zwraca `Promise<boolean>`.

### 2. Synchronizacja Sprzętu do Eventu

**Plik migracji:** `fix_equipment_sync_skip_unresolved_conflicts`

**Funkcja:** `get_offer_equipment_final(offer_id)`

**Logika:**
1. **Sprzęt z substytucją** → dodany (item zamieniony na alternatywny)
2. **Sprzęt z konfliktem BEZ substytucji** → **NIE dodany** (brak w event_equipment)
3. **Sprzęt bez konfliktu** → dodany normalnie

```sql
-- Kity: zawsze dodawane
WHEN a.equipment_kit_id IS NOT NULL THEN a.qty

-- Item z substytucją: usuwamy oryginał, dodajemy zamiennik
WHEN sf.equipment_item_id IS NOT NULL THEN
  COALESCE(a.qty, 0) - COALESCE(sf.qty, 0) + COALESCE(st.qty, 0)

-- Item bez substytucji: dodajemy normalnie
ELSE COALESCE(a.qty, 0) + COALESCE(st.qty, 0)
```

**Efekt:**
- **Sprzęt dostępny** → dodany do zakładki "Sprzęt"
- **Sprzęt z konfliktem** → **NIE dodany** do zakładki "Sprzęt"

### 3. Oznaczenie Eventu

**Plik:** `useOfferWizzardSubmit.ts`

```typescript
if (params.hasEquipmentShortage) {
  await supabase
    .from('events')
    .update({ has_equipment_shortage: true })
    .eq('id', params.eventId);
}
```

**Flaga:** `events.has_equipment_shortage = true`

### 4. Alert w Zakładce "Sprzęt"

**Plik:** `EventEquipmentTab.tsx`

**Wyświetlanie:**
```tsx
{event?.has_equipment_shortage && (
  <div className="mb-6 flex items-start justify-between gap-4 rounded-lg border border-red-500/20 bg-red-500/10 p-4">
    <div className="flex items-start gap-3">
      <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-400" />
      <div>
        <h3 className="mb-1 font-medium text-red-300">Braki sprzętowe</h3>
        <p className="text-sm text-red-300/80">
          Event ma braki sprzętowe w terminie. Część sprzętu z oferty nie została dodana do eventu, ponieważ nie jest dostępna.
        </p>
      </div>
    </div>
    <button className="...">Rozwiąż konflikty</button>
  </div>
)}
```

**Lokalizacja:** Zakładka "Sprzęt" (NIE w "Szczegółach")

### 5. Automatyczne Czyszczenie Flagi i Reset Statusu

**Plik migracji:** `auto_reset_event_status_when_offers_deleted`

**Trigger:** `trigger_clear_equipment_shortage_on_offer_delete`

```sql
-- Gdy oferta jest usuwana
-- Jeśli nie ma już żadnych ofert dla eventu
UPDATE events SET
  has_equipment_shortage = false,
  status = 'offer_to_send'
WHERE id = event_id;
```

**Efekt:**
- Usunięcie ostatniej oferty → flaga znika
- Alert przestaje się wyświetlać
- **Status eventu wraca do "Oferta do wysłania"**

## Scenariusze

### Scenariusz 1: Konflikt z Wyborem Alternatywy

1. Użytkownik dodaje produkt do oferty
2. System wykrywa konflikt: Brak mikrofonu Shure SM58
3. Dialog: "Brakuje 2 pozycji sprzętu. Czy chcesz utworzyć ofertę mimo to?"
4. Użytkownik wybiera **alternatywę**: Shure Beta 58A (dostępny)
5. Oferta utworzona
6. `has_equipment_shortage = false` (konflikt rozwiązany)
7. **Sprzęt dodany:** Shure Beta 58A w zakładce "Sprzęt" ✅
8. **Alert:** Nie wyświetla się ✅

### Scenariusz 2: Konflikt BEZ Alternatywy

1. Użytkownik dodaje produkt do oferty
2. System wykrywa konflikt: Brak mikrofonu Shure SM58
3. Dialog: "Brakuje 2 pozycji sprzętu. Czy chcesz utworzyć ofertę mimo to?"
4. Użytkownik klika **"Utwórz mimo to"** (bez wyboru alternatywy)
5. Oferta utworzona
6. `has_equipment_shortage = true` ✅
7. **Sprzęt NIE dodany:** Shure SM58 **brak** w zakładce "Sprzęt" ❌
8. **Alert:** Wyświetla się w zakładce "Sprzęt" z przyciskiem "Rozwiąż konflikty" ✅

### Scenariusz 3: Usunięcie Oferty

1. Event ma ofertę z konfliktami
2. `has_equipment_shortage = true`, `status = 'offer_sent'`
3. Alert widoczny w zakładce "Sprzęt"
4. Użytkownik usuwa ofertę
5. **Trigger:** `trigger_clear_equipment_shortage_on_offer_delete`
6. `has_equipment_shortage = false` ✅
7. `status = 'offer_to_send'` ✅
8. **Alert:** Znika ✅
9. **Status:** Zmieniony na "Oferta do wysłania" ✅

## Pliki Zmodyfikowane

### Frontend

1. **`useOfferWizzard.ts`**
   - Dialog potwierdzenia z `showConfirm()` (zwraca Promise<boolean>)
   - Przekazuje `hasEquipmentShortage` do submita

2. **`useOfferWizzardSubmit.ts`**
   - Ustawia `has_equipment_shortage = true` przy tworzeniu oferty z konfliktami

3. **`EventEquipmentTab.tsx`**
   - Alert o brakach sprzętowych z przyciskiem "Rozwiąż konflikty"
   - Wyświetla się gdy `event.has_equipment_shortage = true`

4. **`EventDetailsAction.tsx`**
   - Usunięto alert (był w "Szczegółach")

5. **`type.ts`**
   - Dodano `has_equipment_shortage?: boolean` do `IEvent`

### Backend (Migracje)

1. **`fix_equipment_sync_skip_unresolved_conflicts.sql`**
   - Funkcja `get_offer_equipment_final()` - NIE dodaje sprzętu z nierozwiązanymi konfliktami
   - Tylko sprzęt z substytucjami lub bez konfliktów jest synchronizowany

2. **`auto_reset_event_status_when_offers_deleted.sql`**
   - Trigger automatycznie czyszczący flagę gdy ostatnia oferta jest usunięta
   - Resetuje status eventu do `offer_to_send` (Oferta do wysłania)

## Walidacja

✅ ESLint: 0 errors
✅ Kod syntaktycznie poprawny
✅ TypeScript types zaktualizowane
✅ Migracje zastosowane
✅ `showConfirm()` używany poprawnie

## Przyszłe Usprawnienia

1. **Przycisk "Rozwiąż konflikty"**
   - Otworzyć wizard oferty z listą konfliktów
   - Pozwolić wybrać alternatywy dla brakującego sprzętu
   - Po zapisie: usunąć flagę `has_equipment_shortage`

2. **Lista Konfliktów**
   - Pokazać dokładnie który sprzęt brakuje
   - Ile jednostek brakuje
   - Sugerowane alternatywy

3. **Notyfikacje**
   - Powiadomienie email/system o brakach sprzętowych
   - Alert dla managera eventu
