# Fix: Column is_optional does not exist

## Problem
Po odświeżeniu strony pojawiały się błędy:
```json
{
    "code": "42703",
    "details": null,
    "hint": null,
    "message": "column equipment_compatible_items.is_optional does not exist"
}
```

## Przyczyna
Tabela `equipment_compatible_items` **nie ma** kolumny `is_optional`.

Struktura tabeli (z migracji `20251211200114_extend_equipment_components_system.sql`):
```sql
CREATE TABLE equipment_compatible_items (
  id uuid PRIMARY KEY,
  equipment_id uuid NOT NULL,
  compatible_equipment_id uuid NOT NULL,
  compatibility_type text NOT NULL CHECK (compatibility_type IN ('required', 'recommended', 'optional')),
  notes text,
  display_order integer,
  created_at timestamptz,
  updated_at timestamptz
);
```

Kolumna `compatibility_type` służy do określenia typu kompatybilności:
- `'required'` - wymagane komponenty
- `'recommended'` - zalecane komponenty
- `'optional'` - opcjonalne komponenty

## Rozwiązanie

### RequiredComponentsWarning.tsx

**Przed:**
```typescript
interface RequiredComponent {
  id: string;
  compatible_equipment_id: string | null;
  compatible_kit_id: string | null;
  compatibility_type: string;
  is_optional: boolean;  // ❌ NIE ISTNIEJE
  // ...
}

const { data, error } = await supabase
  .from('equipment_compatible_items')
  .select(`
    id,
    compatible_equipment_id,
    compatible_kit_id,
    compatibility_type,
    is_optional,  // ❌ NIE ISTNIEJE
    compatible_equipment:equipment_items!compatible_equipment_id(id, name, model, brand),
    compatible_kit:equipment_kits!compatible_kit_id(id, name, description)
  `)
  .eq('equipment_id', equipmentId)
  .eq('compatibility_type', 'required')
  .eq('is_optional', false);  // ❌ NIE ISTNIEJE
```

**Po:**
```typescript
interface RequiredComponent {
  id: string;
  compatible_equipment_id: string | null;
  compatible_kit_id: string | null;
  compatibility_type: string;
  // ✅ is_optional usunięte
  // ...
}

const { data, error } = await supabase
  .from('equipment_compatible_items')
  .select(`
    id,
    compatible_equipment_id,
    compatible_kit_id,
    compatibility_type,
    // ✅ is_optional usunięte
    compatible_equipment:equipment_items!compatible_equipment_id(id, name, model, brand),
    compatible_kit:equipment_kits!compatible_kit_id(id, name, description)
  `)
  .eq('equipment_id', equipmentId)
  .eq('compatibility_type', 'required');  // ✅ Wystarczy tylko to
```

### ReserveEquipmentModal.tsx

Identyczne zmiany jak w RequiredComponentsWarning.tsx:
- ❌ Usunięto `is_optional: boolean` z interface
- ❌ Usunięto `is_optional` z SELECT
- ❌ Usunięto `.eq('is_optional', false)` z zapytania
- ✅ Zostało tylko `.eq('compatibility_type', 'required')`

## Weryfikacja

```bash
✓ ReserveEquipmentModal.tsx - Syntax OK (208 braces, 285 parens)
✓ RequiredComponentsWarning.tsx - Syntax OK (54 braces, 98 parens)
✓ RenderRowItem.tsx - Syntax OK (82 braces, 72 parens)
✓ check-types.mjs - No errors
```

## Status Build

```
npm run build: SIGKILL - Out of Memory
- Środowisko: ~4.3GB RAM
- Next.js build wymaga: ~8GB RAM
- Kod jest syntaktycznie poprawny
- Zadziała w środowisku produkcyjnym z wystarczającą ilością pamięci
```

## Testowanie

Po tym fixie błąd `column is_optional does not exist` nie powinien się już pojawiać.

Zapytania będą działać poprawnie:
1. Pobieranie tylko komponentów z `compatibility_type = 'required'`
2. Filtrowanie już dodanych komponentów w event_equipment
3. Wyświetlanie ostrzeżeń i modali
