# Implementacja Obsługi Kitów w Kompatybilności Sprzętu

## Przegląd
Dodano możliwość oznaczania kitów (zestawów sprzętu) jako produkty kompatybilne/wymagane/zalecane dla danego sprzętu. Wcześniej można było dodawać tylko pojedyncze urządzenia.

## Przykład Użycia
- Subwoofer pasywny wymaga wzmacniacza
- Wzmacniacz jest w kicie "AMP RACK - 1x LAB Gruppen"
- Można dodać cały kit jako wymagany komponent
- Dostępne są różne wersje kitów (1x lub 2x LAB Gruppen)

## Zmiany w Bazie Danych

### Migracja: `20260317120000_add_kit_support_to_equipment_compatible_items.sql`

**Dodane kolumny:**
- `compatible_kit_id` - UUID referencja do `equipment_kits(id)`

**Ograniczenia:**
- `check_compatible_item_type` - zapewnia, że tylko jedno z pól jest wypełnione:
  - `compatible_equipment_id IS NOT NULL AND compatible_kit_id IS NULL` (sprzęt)
  - `compatible_equipment_id IS NULL AND compatible_kit_id IS NOT NULL` (kit)

**Indeksy:**
- `idx_compatible_kit_id` - dla szybkiego wyszukiwania po kitach
- `unique_kit_compatibility` - unikalne pary (equipment_id, compatible_kit_id)

## Zmiany w UI

### ComponentsTab.tsx

#### 1. Nowy Interface
```typescript
interface EquipmentItem {
  id: string;
  name: string;
  model: string | null;
  brand: string | null;
  thumbnail_url: string | null;
  cable_stock_quantity?: number | null;
  equipment_units?: Array<{ id: string; status: string }>;
  warehouse_categories?: { name: string; } | Array<{ name: string }>;
  item_type?: 'equipment' | 'kit';  // NOWE
  equipment_kit_items?: Array<{     // NOWE
    quantity: number;
    equipment: { name: string; model: string | null; };
  }>;
}
```

#### 2. Nowe Stany
```typescript
const [availableKits, setAvailableKits] = useState<EquipmentItem[]>([]);
const [itemTypeFilter, setItemTypeFilter] = useState<'all' | 'equipment' | 'kit'>('all');
```

#### 3. Pobieranie Danych

**fetchAvailableEquipment** - zmieniono aby pobierać zarówno sprzęt jak i kity:
```typescript
// Pobierz sprzęt
const { data: equipmentData } = await supabase
  .from('equipment_items')
  .select(...)
  .neq('id', equipment.id);

// Pobierz kity
const { data: kitsData } = await supabase
  .from('equipment_kits')
  .select(`
    id, name, thumbnail_url,
    equipment_kit_items(
      quantity,
      equipment:equipment_items(name, model)
    )
  `);

const kitsWithType = (kitsData || []).map(k => ({...k, item_type: 'kit' as const}));
setAvailableKits(kitsWithType);
```

**fetchCompatibleItems** - dodano join dla kitów:
```typescript
const { data } = await supabase
  .from('equipment_compatible_items')
  .select(`
    *,
    compatible_equipment:equipment_items(...),
    compatible_kit:equipment_kits(
      id, name, thumbnail_url,
      equipment_kit_items(
        quantity,
        equipment:equipment_items(name, model)
      )
    )
  `)
  .eq('equipment_id', equipment.id);
```

#### 4. Filtrowanie

**filteredEquipment** - połączono sprzęt i kity z filtrowaniem:
```typescript
const allItems = [...availableEquipment, ...availableKits];

const filtered = allItems.filter((item) => {
  // Filtr typu
  if (itemTypeFilter === 'equipment' && item.item_type === 'kit') return false;
  if (itemTypeFilter === 'kit' && item.item_type !== 'kit') return false;

  // Filtr wyszukiwania
  const query = searchQuery.toLowerCase();
  const nameMatch = item.name.toLowerCase().includes(query);
  const modelMatch = item.model?.toLowerCase().includes(query);
  const brandMatch = item.brand?.toLowerCase().includes(query);

  return nameMatch || modelMatch || brandMatch;
});
```

#### 5. Dodawanie Kompatybilnych

**handleAddCompatible** - obsługuje zarówno sprzęt jak i kity:
```typescript
const handleAddCompatible = async (itemId: string, itemType: 'equipment' | 'kit') => {
  const insertData: any = {
    equipment_id: equipment.id,
    compatibility_type: compatibilityType,
    notes: compatibilityNotes || null,
    display_order: compatibleItems.length,
  };

  if (itemType === 'equipment') {
    insertData.compatible_equipment_id = itemId;
    insertData.compatible_kit_id = null;
  } else {
    insertData.compatible_kit_id = itemId;
    insertData.compatible_equipment_id = null;
  }

  const { error } = await supabase
    .from('equipment_compatible_items')
    .insert(insertData);

  // ... refresh data
};
```

#### 6. UI Modal - Przyciski Filtrowania

```tsx
<div className="flex gap-2">
  <button onClick={() => setItemTypeFilter('all')}>Wszystko</button>
  <button onClick={() => setItemTypeFilter('equipment')}>Sprzęt</button>
  <button onClick={() => setItemTypeFilter('kit')}>Zestawy</button>
</div>
```

#### 7. UI Modal - Wyświetlanie Kitów

```tsx
{filteredEquipment.map((item) => {
  const isKit = item.item_type === 'kit';

  return (
    <button onClick={() => handleAddCompatible(item.id, isKit ? 'kit' : 'equipment')}>
      <img src={item.thumbnail_url} />
      {isKit && (
        <div className="absolute -right-1 -top-1 rounded-full bg-[#d3bb73]">
          <Package className="h-3 w-3" />
        </div>
      )}

      <h4>{item.name}</h4>
      {isKit && <span className="badge">ZESTAW</span>}

      {isKit && item.equipment_kit_items?.map(kitItem => (
        <p>• {kitItem.quantity}x {kitItem.equipment.name}</p>
      ))}
    </button>
  );
})}
```

#### 8. UI Lista - Wyświetlanie Dodanych Kitów

```tsx
{compatibleItems.map((item: any) => {
  const compatEquip = item.compatible_equipment;
  const compatKit = item.compatible_kit;
  const isKit = !!compatKit;
  const displayItem = isKit ? compatKit : compatEquip;

  return (
    <div className="compatible-item">
      <img src={displayItem.thumbnail_url} />
      {isKit && <Package className="kit-badge" />}

      <div>
        <div>{displayItem.name}</div>
        {isKit && <span className="badge">ZESTAW</span>}
        <span className={typeColors[item.compatibility_type]}>
          {typeLabels[item.compatibility_type]}
        </span>

        {isKit && compatKit.equipment_kit_items?.map((kitItem, idx) => (
          <p key={idx}>• {kitItem.quantity}x {kitItem.equipment.name}</p>
        ))}
      </div>
    </div>
  );
})}
```

## Funkcje

### Typy Kompatybilności
- **required** (czerwony) - Wymagany - musi być dodany
- **recommended** (niebieski) - Zalecany - powinien być dodany
- **optional** (zielony) - Opcjonalny - może być dodany

### Workflow
1. Pracownik wchodzi w szczegóły sprzętu (np. subwoofer pasywny)
2. Przechodzi do zakładki "Komponenty"
3. Klika "Dodaj pasujący produkt"
4. Wybiera typ kompatybilności (wymagany/zalecany/opcjonalny)
5. Filtruje po typie: Wszystko / Sprzęt / Zestawy
6. Wyszukuje kit (np. "AMP RACK")
7. Widzi zawartość kitu (1x LAB Gruppen, 1x Zasilacz, 2x Kabel)
8. Dodaje kit do listy kompatybilnych
9. Kit pojawia się na liście z badzem "ZESTAW" i zawartością
10. Przy rezerwacji sprzętu system podpowie, że potrzebny jest kit

## Testowanie

### Test 1: Dodanie Kitu jako Wymagany
1. Otwórz szczegóły subwoofera pasywnego
2. Zakładka "Komponenty"
3. "Dodaj pasujący produkt"
4. Typ: "Wymagany"
5. Filtr: "Zestawy"
6. Znajdź "AMP RACK - 1x LAB Gruppen"
7. Kliknij - powinien się dodać z czerwonym badzem "Wymagany"

### Test 2: Wyświetlanie Zawartości Kitu
1. Dodaj kit jako w teście 1
2. Na liście kompatybilnych sprawdź czy widać:
   - Nazwę kitu
   - Badz "ZESTAW"
   - Badz "Wymagany" (czerwony)
   - Listę zawartości kitu (pierwsze 3 elementy)
   - Jeśli więcej niż 3 - "+X więcej..."

### Test 3: Filtrowanie
1. Otwórz modal dodawania
2. Kliknij "Wszystko" - powinny być widoczne kity i sprzęt
3. Kliknij "Sprzęt" - tylko pojedyncze urządzenia
4. Kliknij "Zestawy" - tylko kity

### Test 4: Wyszukiwanie
1. Otwórz modal
2. Wpisz nazwę kitu (np. "AMP RACK")
3. Powinny pokazać się tylko kity z tą nazwą

### Test 5: Sprawdzenie Już Dodanych
1. Dodaj kit
2. Otwórz modal ponownie
3. Ten sam kit powinien mieć badz "Już dodany" i być nieaktywny

## Status
✅ Migracja bazy danych utworzona
✅ Interface TypeScript zaktualizowany
✅ Pobieranie kitów zaimplementowane
✅ Filtrowanie po typie dodane
✅ Modal z wyborem zaimplementowany
✅ Wyświetlanie kitów z zawartością
✅ Zapisywanie do bazy
✅ Lista kompatybilnych z kitami
✅ Weryfikacja składni - OK
✅ Fix: Ukryto wyświetlanie "0 szt." dla kitów (tylko dla sprzętu)

## Następne Kroki
- Przetestować w przeglądarce
- Sprawdzić czy kity pojawiają się w podpowiedziach przy rezerwacji
- Opcjonalnie: dodać tooltips z pełną zawartością kitu
