# Automatyczne Usuwanie Sprzętu przy Usuwaniu Oferty

## Jak to działa

Gdy oferta jest usuwana, automatycznie usuwany jest również sprzęt, który został z niej zaimportowany do eventu.

## Implementacja

### 1. Trigger w Bazie Danych

**Plik**: `supabase/migrations/20260104142312_add_trigger_delete_equipment_on_offer_delete.sql`

Trigger `trigger_delete_equipment_on_offer_delete` działa **PRZED** usunięciem oferty (`BEFORE DELETE`) i:

1. Znajduje wszystkie pozycje sprzętu w `event_equipment` powiązane z usuwaną ofertą
2. Usuwa TYLKO sprzęt z flagą `auto_added = true` (dodany automatycznie)
3. Nie usuwa sprzętu dodanego ręcznie przez użytkownika

```sql
CREATE OR REPLACE FUNCTION delete_equipment_on_offer_delete()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  -- Usuń wszystkie sprzęty automatycznie dodane z tej oferty
  DELETE FROM event_equipment
  WHERE offer_id = OLD.id
    AND auto_added = true;

  RAISE NOTICE 'Usunięto sprzęty automatycznie dodane z oferty: %', OLD.id;

  RETURN OLD;
END;
$$;
```

### 2. ON DELETE CASCADE

Dodatkowo tabela `offer_items` ma zdefiniowany `ON DELETE CASCADE`:

```sql
CREATE TABLE offer_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id uuid REFERENCES offers(id) ON DELETE CASCADE NOT NULL,
  -- ... inne kolumny
);
```

Dzięki temu usunięcie oferty automatycznie usuwa wszystkie jej pozycje (`offer_items`).

## Frontend - Informowanie Użytkownika

### 1. Strona Szczegółów Oferty

**Plik**: `src/app/(crm)/crm/offers/[id]/page.tsx`

```typescript
const confirmMessage = offer.event_id
  ? 'Czy na pewno chcesz usunąć tę ofertę?\n\nSprzęt automatycznie dodany z tej oferty zostanie usunięty z eventu.'
  : 'Czy na pewno chcesz usunąć tę ofertę?';

const confirmed = await showConfirm(confirmMessage, 'Tej operacji nie można cofnąć.');
```

Gdy oferta jest powiązana z eventem (`offer.event_id` istnieje), użytkownik otrzymuje ostrzeżenie o tym, że sprzęt zostanie usunięty.

### 2. Lista Ofert

**Plik**: `src/app/(crm)/crm/offers/OfferPage.tsx`

Identyczny mechanizm ostrzeżenia:

```typescript
const offer = offers.find((o) => o.id === offerId);
const confirmMessage = offer?.event_id
  ? 'Czy na pewno chcesz usunąć tę ofertę?\n\nSprzęt automatycznie dodany z tej oferty zostanie usunięty z eventu.\n\nTej operacji nie można cofnąć.'
  : 'Czy na pewno chcesz usunąć tę ofertę? Tej operacji nie można cofnąć.';
```

### 3. RTK Query API

**Plik**: `src/app/(crm)/crm/offers/api/OfferWizzardApi.ts`

Uproszczona mutacja DELETE - cascade dzieje się automatycznie w bazie:

```typescript
deleteOffer: builder.mutation<{ success: boolean }, { offerId: string }>({
  queryFn: async ({ offerId }) => {
    try {
      // ON DELETE CASCADE automatycznie usuwa offer_items i event_equipment (auto_added)
      const { error } = await supabase.from('offers').delete().eq('id', offerId);
      if (error) return { error: toRtkError(error) };

      return { data: { success: true } };
    } catch (e) {
      return { error: toRtkError(e) };
    }
  },
}),
```

## Co jest Usuwane

### ✅ Automatycznie Usuwane:
1. **Oferta** (`offers`)
2. **Pozycje oferty** (`offer_items`) - przez CASCADE
3. **Sprzęt auto-dodany** (`event_equipment` gdzie `auto_added = true`) - przez trigger
4. **Historia zmian oferty** (`offer_history`) - przez CASCADE
5. **Audyt cen** (`offer_price_audit`) - przez CASCADE

### ❌ NIE Usuwane:
1. **Event** - pozostaje niezmieniony
2. **Sprzęt dodany ręcznie** (`event_equipment` gdzie `auto_added = false`)
3. **Klient/Organizacja** - pozostaje w systemie
4. **Produkty katalogowe** - pozostają w katalogu

## Przepływ Usuwania

```
1. Użytkownik klika "Usuń ofertę"
   ↓
2. System pokazuje ostrzeżenie (jeśli oferta ma event_id)
   ↓
3. Użytkownik potwierdza
   ↓
4. Frontend wywołuje: DELETE FROM offers WHERE id = ?
   ↓
5. TRIGGER: delete_equipment_on_offer_delete()
   - DELETE FROM event_equipment WHERE offer_id = ? AND auto_added = true
   ↓
6. CASCADE: Automatyczne usunięcie offer_items
   ↓
7. Oferta usunięta, sprzęt auto-dodany usunięty
   ↓
8. Success message dla użytkownika
```

## Bezpieczeństwo

1. **Flaga `auto_added`** - tylko sprzęt automatyczny jest usuwany
2. **SECURITY DEFINER** - trigger ma uprawnienia do usuwania bez względu na RLS
3. **Potwierdzenie użytkownika** - wymagane przed usunięciem
4. **Informacja o konsekwencjach** - użytkownik wie, że sprzęt zostanie usunięty

## Use Case

### Scenariusz: Klient otrzymuje 3 oferty

1. **Tworzenie ofert:**
   - Pracownik tworzy ofertę A (100 krzesła, 2 mikrofony)
   - Pracownik tworzy ofertę B (150 krzesła, 3 mikrofony, scena)
   - Pracownik tworzy ofertę C (80 krzesła, 1 mikrofon)

2. **Automatyczny import sprzętu:**
   - Z każdej oferty sprzęt jest dodawany do eventu z `auto_added = true`
   - W evencie jest teraz sprzęt ze wszystkich 3 ofert

3. **Klient wybiera ofertę B:**
   - Pracownik usuwa ofertę A → sprzęt z oferty A znika z eventu
   - Pracownik usuwa ofertę C → sprzęt z oferty C znika z eventu
   - W evencie pozostaje tylko sprzęt z oferty B

4. **Ręczne dodanie sprzętu:**
   - Pracownik ręcznie dodaje 5 dodatkowych krzeseł
   - Te krzesła mają `auto_added = false`
   - Gdy oferta B zostanie usunięta, te 5 krzeseł pozostanie

## Pliki Zmodyfikowane

1. `supabase/migrations/20260104142312_add_trigger_delete_equipment_on_offer_delete.sql` - trigger
2. `src/app/(crm)/crm/offers/[id]/page.tsx` - ostrzeżenie w szczegółach
3. `src/app/(crm)/crm/offers/OfferPage.tsx` - ostrzeżenie w liście
4. `src/app/(crm)/crm/offers/api/OfferWizzardApi.ts` - uproszczona mutacja

## Testing Checklist

- [x] Usunięcie oferty usuwa sprzęt z `auto_added = true`
- [x] Usunięcie oferty NIE usuwa sprzętu z `auto_added = false`
- [x] Użytkownik widzi ostrzeżenie przed usunięciem (gdy oferta ma event_id)
- [x] CASCADE usuwa offer_items
- [x] Trigger działa przed DELETE (BEFORE DELETE)
- [x] Brak błędów RLS podczas usuwania
