/**
 * Stan magazynu w kalkulacjach: dostępne egzemplarze (`equipment_units.status = 'available'`) i pozycje magazynu — wszystkie
 * strony. Jedno zapytanie API zwraca najwyżej 1000 wierszy: przy ok. 2000 egzemplarzy część sprzętu dostawała stan 0
 * i znikała z listy „Z magazynu” w oknie „Dodaj pozycję” (CRM i aplikacja na Maca). Używane w przeglądarce
 * (`AddCalculationItemModal`, `CalculationEditor`) i na serwerze (`src/lib/native/eventCalculations.ts`).
 */

/** Klient Supabase (przeglądarka albo serwer) — wystarczy `from`. */
type QueryClient = { from: (...args: any[]) => any };

/** Strona odczytu — mniejsza niż limit wierszy API, żeby żadna strona nie została ucięta. */
const PAGE = 500;
/** Liczba pozycji w jednym filtrze `in` (długość adresu zapytania). */
const CHUNK = 150;

/** Liczba dostępnych egzemplarzy na pozycję magazynu (brak klucza = 0). */
export async function availableUnitCounts(client: QueryClient, equipmentIds: string[]): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const ids = Array.from(new Set(equipmentIds.filter(Boolean)));
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await client
        .from('equipment_units')
        .select('id,equipment_id')
        .in('equipment_id', chunk)
        .eq('status', 'available')
        .order('id')
        .range(from, from + PAGE - 1);
      if (error) throw error;
      const rows = (data ?? []) as Array<{ equipment_id: string }>;
      for (const unit of rows) counts[unit.equipment_id] = (counts[unit.equipment_id] ?? 0) + 1;
      if (rows.length < PAGE) break;
    }
  }
  return counts;
}

/** Aktywne pozycje magazynu (wszystkie strony), posortowane po nazwie; `columns` — lista kolumn `select`. */
export async function activeEquipmentItems<T = any>(client: QueryClient, columns: string): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from('equipment_items')
      .select(columns)
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('name')
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows;
}
