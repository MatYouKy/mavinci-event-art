# Fix: Blokada Usuwania Ofert Zaakceptowanych i Odrzuconych

## 🎯 Problem

Użytkownik nie mógł usunąć ofert w statusach:
- ❌ `accepted` (zaakceptowane)
- ❌ `rejected` (odrzucone)

## ✅ Rozwiązanie

### 1. **RLS Policy - Warstwa Bazy Danych**

**Migracja:** `restrict_offer_deletion_by_status`

```sql
CREATE POLICY "Admins can delete draft and sent offers"
  ON offers FOR DELETE
  USING (
    employees.role = 'admin'
    AND status IN ('draft', 'sent')
  );
```

**Efekt:**
- ✅ Tylko oferty `draft` i `sent` mogą być usunięte
- ❌ Oferty `accepted` i `rejected` są chronione na poziomie bazy danych

### 2. **UI - Warstwa Frontendowa**

**EventTabOffer.tsx:**
```typescript
const canDelete = offer.status === 'draft' || offer.status === 'sent';

{canDelete ? (
  <button>Usuń</button>
) : (
  <div title="Nie można usunąć zaakceptowanej oferty">
    <Trash2 /> {/* Szary, nieaktywny */}
  </div>
)}
```

**EventDetailPageClient.tsx:**
```typescript
if (offer?.status === 'accepted') {
  showSnackbar('Nie można usunąć zaakceptowanej oferty', 'error');
  return;
}
```

## 📋 Co Zostało Zmienione

### Pliki Zmodyfikowane:
1. ✅ `EventTabOffer.tsx` - ukrycie/wyłączenie przycisku usuwania
2. ✅ `EventDetailPageClient.tsx` - walidacja przed usunięciem
3. ✅ `ACCEPTED_OFFER_DELETION.md` - aktualizacja dokumentacji

### Migracje:
1. ✅ `restrict_offer_deletion_by_status` - RLS policy z walidacją statusu

## 🔐 Poziomy Ochrony

### Poziom 1: UI (Frontendowa Walidacja)
- Przycisk usuwania jest szary/nieaktywny dla `accepted` i `rejected`
- Tooltip wyjaśnia dlaczego nie można usunąć

### Poziom 2: Handler (Logika Biznesowa)
- `handleDeleteOffer` sprawdza status przed wywołaniem API
- Wyświetla czytelne komunikaty błędów

### Poziom 3: RLS (Baza Danych)
- Policy blokuje DELETE dla `accepted` i `rejected`
- Nawet jeśli ktoś ominąłby frontend - baza ochroni dane

## 💡 Jak Usunąć Zaakceptowaną Ofertę?

Jeśli naprawdę trzeba usunąć ofertę `accepted`:

1. **Najpierw zmień status:**
   ```sql
   UPDATE offers SET status = 'draft' WHERE id = '...';
   ```

2. **Trigger automatycznie:**
   - Usuwa sprzęt z `event_equipment`
   - Resetuje status eventu do `pending`
   - Czyści flagę `has_equipment_shortage`

3. **Teraz możesz usunąć:**
   ```sql
   DELETE FROM offers WHERE id = '...';
   ```

## 🎨 Wizualna Zmiana w UI

### Przed:
```
[🗑️ Czerwony przycisk] - zawsze widoczny, kliknięcie nie działa
```

### Po:
```
Oferta Draft:     [🗑️ Czerwony przycisk] - aktywny, można usunąć
Oferta Sent:      [🗑️ Czerwony przycisk] - aktywny, można usunąć
Oferta Accepted:  [🗑️ Szary przycisk] - nieaktywny, tooltip: "Nie można usunąć zaakceptowanej oferty"
Oferta Rejected:  [🗑️ Szary przycisk] - nieaktywny, tooltip: "Nie można usunąć odrzuconej oferty"
```

## ✅ Status

- ✅ RLS Policy zaimplementowana
- ✅ UI zaktualizowane
- ✅ Walidacja w handlerze dodana
- ✅ Dokumentacja zaktualizowana
- ✅ Testy manualne zalecane

## 📚 Zobacz Też

- `ACCEPTED_OFFER_DELETION.md` - pełna dokumentacja systemu
- `handle_accepted_offer_deletion` - trigger DELETE
- `handle_offer_status_change_from_accepted` - trigger UPDATE
