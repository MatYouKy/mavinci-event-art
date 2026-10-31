# Debug: Problem z Usuwaniem Ofert

## 🔴 Problem
- Snackbar pokazuje "success"
- Oferta NIE jest usuwana z bazy
- Po odświeżeniu oferta dalej istnieje

## 🔍 Co Sprawdziliśmy

### 1. RLS Policy ✅
```sql
CREATE POLICY "Admins and offers_manage can delete draft and sent offers"
  ON offers FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (employees.role = 'admin' OR 'offers_manage' = ANY(permissions))
    )
    AND status IN ('draft', 'sent')
  );
```

### 2. API Endpoint ✅
```typescript
deleteEventOffer: builder.mutation({
  async queryFn({ offerId }) {
    const { data, error } = await supabase
      .from('offers')
      .delete()
      .eq('id', offerId)
      .select();

    if (error) throw error;

    // Sprawdzamy czy coś usunięto
    if (!data || data.length === 0) {
      throw new Error('Nie można usunąć tej oferty...');
    }

    return { data: { success: true } };
  },
  invalidatesTags: [
    { type: 'EventOffers', id: `${eventId}_LIST` },
    { type: 'EventOffers', id: offerId },
    ...
  ],
})
```

### 3. Cache Invalidation ✅
- `EventOffers` - LIST i pojedyncza oferta
- `EventDetails` - szczegóły eventu
- `EventEquipment` - sprzęt eventu

## 🧪 Kroki Debugowania

### Krok 1: Sprawdź czy użytkownik ma uprawnienia

Uruchom w Supabase SQL Editor:

```sql
-- Sprawdź swoje uprawnienia
SELECT
  e.id,
  e.email,
  e.role,
  e.permissions,
  CASE
    WHEN e.role = 'admin' THEN 'TAK - admin'
    WHEN 'offers_manage' = ANY(e.permissions) THEN 'TAK - offers_manage'
    ELSE 'NIE'
  END as can_delete_offers
FROM employees e
WHERE e.id = auth.uid();
```

**Oczekiwany wynik:**
- `can_delete_offers` = "TAK - admin" LUB "TAK - offers_manage"

### Krok 2: Sprawdź status oferty

```sql
-- Sprawdź status oferty którą próbujesz usunąć
SELECT
  id,
  offer_number,
  status,
  event_id,
  CASE
    WHEN status IN ('draft', 'sent') THEN 'MOŻNA USUNĄĆ'
    ELSE 'CHRONIONA - zmień status'
  END as deletable
FROM offers
WHERE event_id = 'TWOJE_EVENT_ID'
ORDER BY created_at DESC;
```

**Oczekiwany wynik:**
- `deletable` = "MOŻNA USUNĄĆ" dla oferty którą usuwasz

### Krok 3: Test DELETE bezpośrednio w SQL

```sql
-- Test czy DELETE działa
DELETE FROM offers
WHERE id = 'OFFER_ID_DO_USUNIECIA'
RETURNING *;
```

**Możliwe wyniki:**
- ✅ Zwraca usuniętą ofertę → DELETE działa, problem w froncie
- ❌ Zwraca pusty wynik → RLS blokuje DELETE
- ❌ Błąd → Problem z bazą danych

### Krok 4: Sprawdź logi Supabase

1. Otwórz Supabase Dashboard
2. Idź do **Logs** → **API Logs**
3. Poszukaj DELETE na `offers`
4. Sprawdź:
   - Czy request dotarł do bazy?
   - Jaki był status odpowiedzi?
   - Czy był błąd RLS?

## 🐛 Możliwe Przyczyny

### A. Użytkownik nie ma uprawnień
**Objawy:**
- SQL Test (Krok 3) zwraca pusty wynik
- Krok 1 pokazuje `can_delete_offers` = "NIE"

**Rozwiązanie:**
```sql
-- Dodaj uprawnienie offers_manage
UPDATE employees
SET permissions = array_append(permissions, 'offers_manage')
WHERE id = auth.uid();
```

### B. Oferta ma chroniony status
**Objawy:**
- SQL Test (Krok 3) zwraca pusty wynik
- Krok 2 pokazuje `deletable` = "CHRONIONA"

**Rozwiązanie:**
```sql
-- Zmień status na draft
UPDATE offers
SET status = 'draft'
WHERE id = 'OFFER_ID';
```

### C. Bug w froncie - nie obsługuje błędu
**Objawy:**
- SQL Test (Krok 3) zwraca pusty wynik
- Snackbar pokazuje "success" mimo że nic nie usunięto

**Problem:**
API nie sprawdza czy `data.length === 0` (RLS zablokował)

**Fix:** (JUŻ ZAIMPLEMENTOWANY)
```typescript
if (!data || data.length === 0) {
  throw new Error('Nie można usunąć tej oferty...');
}
```

### D. Cache nie jest odświeżany
**Objawy:**
- SQL Test (Krok 3) usuwa ofertę
- Po odświeżeniu strony (F5) oferta znika
- Ale bez odświeżenia - dalej widoczna

**Rozwiązanie:**
Sprawdź czy RTK Query invalidation działa:
```typescript
// W Redux DevTools sprawdź:
// - Czy wywołano invalidatesTags?
// - Czy useGetEventOffersQuery wykonał refetch?
```

## 💡 Szybki Fix

Jeśli nic nie pomaga, dodaj wymuszony refetch:

```typescript
const handleDeleteOffer = async (offerId: string) => {
  // ... istniejący kod ...

  try {
    await deleteOfferMutation({ eventId, offerId }).unwrap();

    // DODAJ: Wymuś refetch ofert
    await refetch(); // z useGetEventOffersQuery

    showSnackbar('Oferta została usunięta', 'success');
  } catch (error) {
    // ...
  }
};
```

## 📋 Checklist Przed Kontaktem

Przed zgłoszeniem problemu sprawdź:

- [ ] Krok 1: Mam uprawnienia? (admin lub offers_manage)
- [ ] Krok 2: Status oferty to 'draft' lub 'sent'?
- [ ] Krok 3: DELETE w SQL działa?
- [ ] Krok 4: Sprawdziłem logi Supabase?
- [ ] Cache: Po F5 oferta znika czy dalej jest?
- [ ] Błędy: Console pokazuje jakieś błędy?
- [ ] Network: DELETE request dotarł do API?

## 🎯 Następne Kroki

1. **Wykonaj Krok 1** - to najczęstsza przyczyna
2. Jeśli nie masz uprawnień - dodaj je
3. Jeśli masz uprawnienia - wykonaj Krok 3
4. Prześlij wyniki tutaj
