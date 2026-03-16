# Obsługa Usunięcia Zaakceptowanej Oferty

## 🎯 Cel

Zapewnienie spójności danych gdy zaakceptowana oferta jest usuwana lub jej status jest zmieniany z `accepted` na inny.

## 🔄 Automatyczne Akcje

### 1. Usunięcie Oferty (DELETE)

Gdy oferta o statusie `accepted` jest usuwana:

**Trigger:** `trigger_handle_accepted_offer_deletion`
**Funkcja:** `handle_accepted_offer_deletion()`

Automatycznie wykonuje:
- ✅ Usuwa **cały sprzęt** z `event_equipment` powiązany z tą ofertą
- ✅ Sprawdza czy są inne zaakceptowane oferty dla tego eventu
- ✅ Jeśli nie ma innych zaakceptowanych ofert:
  - Ustawia `has_equipment_shortage = false`
  - Zmienia status eventu z `confirmed` → `pending`

### 2. Zmiana Statusu Oferty (UPDATE)

Gdy status oferty zmienia się z `accepted` na inny (np. `rejected`, `draft`):

**Trigger:** `trigger_handle_offer_status_change`
**Funkcja:** `handle_offer_status_change()`

Automatycznie wykonuje:
- ✅ Usuwa **cały sprzęt** z `event_equipment` powiązany z tą ofertą
- ✅ Sprawdza czy są inne zaakceptowane oferty dla tego eventu
- ✅ Jeśli nie ma innych zaakceptowanych ofert:
  - Ustawia `has_equipment_shortage = false`
  - Zmienia status eventu z `confirmed` → `pending`

## 📊 Przepływ Danych

```
┌─────────────────────────────────┐
│  DELETE/UPDATE Oferty           │
│  status: 'accepted'             │
└────────────┬────────────────────┘
             │
             v
┌─────────────────────────────────┐
│  Trigger BEFORE DELETE/UPDATE   │
│  - Usuwa sprzęt z tej oferty    │
└────────────┬────────────────────┘
             │
             v
┌─────────────────────────────────┐
│  Sprawdza inne oferty           │
│  COUNT(*) WHERE status='accepted'│
└────────────┬────────────────────┘
             │
             v
        ┌────┴────┐
        │         │
    Są inne?   Nie ma innych?
        │         │
        v         v
    Nic więcej   Reset eventu:
                 - has_equipment_shortage = false
                 - status: confirmed → pending
```

## 🔧 RTK Query Integration

### Frontend Automatycznie Odświeża:

**Po usunięciu oferty (`deleteEventOffer`):**
```typescript
invalidatesTags: [
  { type: 'EventOffers', id: eventId_LIST },
  { type: 'EventOffers', id: offerId },
  { type: 'EventDetails', id: eventId },
  { type: 'Events', id: eventId },
  { type: 'EventEquipment', id: eventId }, // ✅ Zakładka Sprzęt
]
```

**Po aktualizacji statusu oferty (`updateEventOffer`):**
```typescript
invalidatesTags: [
  { type: 'EventOffers', id: eventId_LIST },
  { type: 'EventOffers', id: offerId },
  { type: 'EventDetails', id: eventId },
  { type: 'Events', id: eventId },
  { type: 'EventEquipment', id: eventId }, // ✅ Zakładka Sprzęt
]
```

## 💡 Przykłady Użycia

### Scenariusz 1: Usunięcie Jedynej Zaakceptowanej Oferty

```sql
-- Stan początkowy
Event: status = 'confirmed', has_equipment_shortage = true
Oferta A: status = 'accepted'
Event Equipment: 5 pozycji z offer_id = A

-- Akcja: DELETE FROM offers WHERE id = A

-- Stan końcowy (automatyczny)
Event: status = 'pending', has_equipment_shortage = false
Event Equipment: 0 pozycji (wszystko usunięte)
```

### Scenariusz 2: Usunięcie Jednej z Wielu Zaakceptowanych Ofert

```sql
-- Stan początkowy
Event: status = 'confirmed'
Oferta A: status = 'accepted'
Oferta B: status = 'accepted'
Event Equipment: 5 pozycji (offer_id = A), 3 pozycje (offer_id = B)

-- Akcja: DELETE FROM offers WHERE id = A

-- Stan końcowy (automatyczny)
Event: status = 'confirmed' (nie zmienia się)
Oferta B: status = 'accepted' (dalej zaakceptowana)
Event Equipment: 3 pozycje (tylko z offer_id = B)
```

### Scenariusz 3: Odrzucenie Wcześniej Zaakceptowanej Oferty

```sql
-- Stan początkowy
Event: status = 'confirmed'
Oferta A: status = 'accepted'
Event Equipment: 5 pozycji z offer_id = A

-- Akcja: UPDATE offers SET status = 'rejected' WHERE id = A

-- Stan końcowy (automatyczny)
Event: status = 'pending', has_equipment_shortage = false
Oferta A: status = 'rejected'
Event Equipment: 0 pozycji (wszystko usunięte)
```

## 🛡️ Bezpieczeństwo

### RLS Policy - Ochrona Przed Usunięciem

**Policy:** `Admins can delete draft and sent offers`

```sql
CREATE POLICY "Admins can delete draft and sent offers"
  ON offers FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND employees.role = 'admin'
    )
    AND status IN ('draft', 'sent')
  );
```

**Blokada usuwania:**
- ❌ Oferty `accepted` - CHRONIONE
- ❌ Oferty `rejected` - CHRONIONE
- ✅ Oferty `draft` - mogą być usunięte (tylko przez adminów)
- ✅ Oferty `sent` - mogą być usunięte (tylko przez adminów)

### Triggery

- ✅ Używa `SECURITY DEFINER` - trigger działa z uprawnieniami właściciela
- ✅ `SET search_path = public` - zapobiega SQL injection
- ✅ Sprawdza tylko oferty o statusie `accepted`
- ✅ Nie dotyka innych ofert ani eventów

### UI - Walidacja Frontendowa

**EventTabOffer.tsx:**
- ✅ Przycisk usuwania widoczny tylko dla statusów `draft` i `sent`
- ✅ Szary, nieaktywny przycisk dla statusów `accepted` i `rejected`
- ✅ Tooltip wyjaśniający dlaczego nie można usunąć

**EventDetailPageClient.tsx:**
- ✅ Walidacja statusu przed wywołaniem API
- ✅ Komunikat błędu: "Nie można usunąć zaakceptowanej oferty"
- ✅ Komunikat błędu: "Nie można usunąć odrzuconej oferty"
- ✅ Lepsze obsługa błędów z API (policy, status)

## 📝 Migracje

1. `handle_accepted_offer_deletion` - trigger DELETE
2. `handle_offer_status_change_from_accepted` - trigger UPDATE
3. `restrict_offer_deletion_by_status` - RLS policy DELETE z walidacją statusu

## ✅ Co Jest Automatyczne

- ✅ Usunięcie sprzętu z `event_equipment`
- ✅ Reset flagi `has_equipment_shortage`
- ✅ Zmiana statusu eventu (jeśli potrzebna)
- ✅ Odświeżenie cache RTK Query
- ✅ Aktualizacja UI w zakładce Sprzęt
- ✅ Aktualizacja listy ofert

## ❌ Co NIE Jest Automatyczne

- ❌ Usunięcie pól budżetu (`total_budget`, `deposit_amount`, `final_price`)
  - Te pola są zakomentowane w triggerze
  - Możesz je odkomentować jeśli chcesz je czyścić

## 🔍 Debugging

### Problem: Nie mogę usunąć oferty

**Sprawdź status oferty:**
- ❌ Oferty `accepted` i `rejected` są chronione przed usunięciem
- ✅ Tylko oferty `draft` i `sent` mogą być usunięte

**Komunikaty błędów:**
- "Nie można usunąć zaakceptowanej oferty" → Oferta ma status `accepted`
- "Nie można usunąć odrzuconej oferty" → Oferta ma status `rejected`
- "Nie masz uprawnień do usunięcia tej oferty" → Nie jesteś adminem
- "new row violates row-level security policy" → RLS blokuje DELETE

**Rozwiązanie:**
- Jeśli chcesz usunąć zaakceptowaną ofertę:
  1. Najpierw zmień status na `draft` lub `sent`
  2. Sprzęt zostanie automatycznie usunięty (trigger)
  3. Następnie usuń ofertę

### Problem: Sprzęt nie znika po usunięciu oferty

1. Sprawdź logi Supabase
2. Zweryfikuj czy trigger jest aktywny:
   ```sql
   SELECT * FROM pg_trigger
   WHERE tgname IN ('trigger_handle_accepted_offer_deletion', 'trigger_handle_offer_status_change');
   ```
3. Sprawdź czy oferta miała status `accepted` przed usunięciem
4. Zweryfikuj cache RTK Query w Redux DevTools

### Problem: Przycisk usuwania jest nieaktywny

- To prawidłowe zachowanie dla ofert `accepted` i `rejected`
- Najedź kursorem na przycisk aby zobaczyć tooltip z wyjaśnieniem
- Jeśli chcesz usunąć - najpierw zmień status oferty
