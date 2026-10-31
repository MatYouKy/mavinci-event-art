# Sortowanie w tabeli eventów - kliknij nagłówek

## Dodane funkcjonalności

### ✅ 1. Sortowanie po kliknięciu w nagłówek kolumny
Kliknięcie w nagłówek sortuje dane według tej kolumny:
- **Pierwsze kliknięcie** → sortowanie rosnące (ASC)
- **Drugie kliknięcie** → sortowanie malejące (DESC)
- **Trzecie kliknięcie** → przełączenie na ASC

### ✅ 2. Wizualna informacja o sortowaniu
- Nagłówki z możliwością sortowania mają efekt `hover` (kolor złoty)
- Aktywna kolumna sortowania ma ikonę strzałki:
  - ↑ dla rosnącego (ASC)
  - ↓ dla malejącego (DESC)

### ✅ 3. Zachowanie szerokości kolumn
- Szerokości kolumn są zapisywane w `employee preferences` w bazie Supabase
- Po przeładowaniu strony szerokości są przywracane
- Przycisk "Reset układu" przywraca domyślne szerokości i kolejność

## Kolumny z możliwością sortowania

| Kolumna | Pole sortowania | Opis |
|---------|----------------|------|
| **Nazwa** | `name` | Sortowanie alfabetyczne po nazwie eventu |
| **Data** | `event_date` | Sortowanie po dacie eventu |
| **Budżet** | `budget` | Sortowanie numeryczne po kwocie |

Kolumny **bez sortowania**:
- Klient
- Lokalizacja
- Status
- Kategoria
- Akcje

## Implementacja techniczna

### Zmiany w `ResizableTh`:
```typescript
// Dodano nowe propsy
sortable?: boolean;           // czy kolumna może być sortowana
sortField?: SortField;        // pole po którym sortować
currentSortField?: SortField; // aktualnie wybrane pole sortowania
sortDirection?: SortDirection; // kierunek (asc/desc)
onSort?: (field: SortField) => void; // callback do sortowania
```

### Mapowanie kolumn na pola sortowania:
```typescript
const sortFieldMap: Partial<Record<EventsTableColKey, SortField>> = {
  name: 'name',           // Nazwa eventu
  date: 'event_date',     // Data eventu
  budget: 'budget',       // Budżet
};
```

### Funkcja `toggleSort`:
```typescript
const toggleSort = (field: SortField) => {
  if (sortField === field) {
    // Ta sama kolumna - zmień kierunek
    setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
  } else {
    // Nowa kolumna - ustaw ASC
    setSortField(field);
    setSortDirection('asc');
  }
};
```

## Jak to działa

### Krok po kroku:

1. **Użytkownik klika w nagłówek "Nazwa"**
   ```
   Stan: sortField='event_date', sortDirection='asc'
   Akcja: kliknięcie w kolumnę "name"
   Rezultat: sortField='name', sortDirection='asc'
   ```

2. **Użytkownik klika ponownie w "Nazwa"**
   ```
   Stan: sortField='name', sortDirection='asc'
   Akcja: ponowne kliknięcie w "name"
   Rezultat: sortField='name', sortDirection='desc'
   ```

3. **Użytkownik klika w "Data"**
   ```
   Stan: sortField='name', sortDirection='desc'
   Akcja: kliknięcie w kolumnę "date"
   Rezultat: sortField='event_date', sortDirection='asc'
   ```

### Wizualna informacja:
```
┌────────────────┬───────────────┬──────────────┐
│ Nazwa ↑        │ Data          │ Budżet       │  ← Sortowanie ASC po nazwie
├────────────────┼───────────────┼──────────────┤
│ Event A        │ 2024-03-20    │ 5000 zł      │
│ Event B        │ 2024-03-18    │ 8000 zł      │
│ Event C        │ 2024-03-22    │ 3000 zł      │
└────────────────┴───────────────┴──────────────┘

Po kliknięciu ponownie w "Nazwa":

┌────────────────┬───────────────┬──────────────┐
│ Nazwa ↓        │ Data          │ Budżet       │  ← Sortowanie DESC po nazwie
├────────────────┼───────────────┼──────────────┤
│ Event C        │ 2024-03-22    │ 3000 zł      │
│ Event B        │ 2024-03-18    │ 8000 zł      │
│ Event A        │ 2024-03-20    │ 5000 zł      │
└────────────────┴───────────────┴──────────────┘
```

## Zapis stanu

### Co jest zapisywane:
- ✅ **Szerokości kolumn** → `employees.preferences.events.table.colWidths`
- ✅ **Kolejność kolumn** → `employees.preferences.events.table.colOrder`
- ❌ **Pole sortowania** → NIE jest zapisywane (zawsze domyślnie `event_date ASC`)
- ❌ **Kierunek sortowania** → NIE jest zapisywany

### Struktura w bazie:
```json
{
  "events": {
    "table": {
      "colWidths": {
        "name": 320,
        "client": 240,
        "date": 150,
        "location": 350,
        "status": 180,
        "category": 200,
        "budget": 160,
        "actions": 120
      },
      "colOrder": [
        "name",
        "date",
        "client",
        "location",
        "status",
        "category",
        "budget",
        "actions"
      ]
    }
  }
}
```

## Dodatki

### Przycisk "Reset układu":
- Przywraca domyślne szerokości kolumn
- Przywraca domyślną kolejność kolumn
- Zapisuje zmiany w bazie danych

### Drag & Drop kolumn:
- Można przeciągnąć nagłówek aby zmienić kolejność kolumn
- Kolejność jest zapisywana automatycznie

### Resize kolumn:
- Można przeciągnąć prawą krawędź nagłówka aby zmienić szerokość
- Szerokość jest zapisywana po zakończeniu przeciągania

## Przykłady użycia

### Sortowanie po nazwie:
1. Kliknij "Nazwa" → eventy posortowane A-Z
2. Kliknij ponownie → eventy posortowane Z-A

### Sortowanie po dacie:
1. Kliknij "Data" → najstarsze eventy na górze
2. Kliknij ponownie → najnowsze eventy na górze

### Sortowanie po budżecie:
1. Kliknij "Budżet" → najtańsze eventy na górze
2. Kliknij ponownie → najdroższe eventy na górze

## Uwagi

- Sortowanie działa w czasie rzeczywistym (bez przeładowania strony)
- Sortowanie uwzględnia filtry (status, kategoria, wyszukiwanie)
- Sortowanie uwzględnia opcję "Pokaż przeszłe eventy"
- Kolumna "Budżet" jest widoczna tylko dla użytkowników z uprawnieniami finansowymi
