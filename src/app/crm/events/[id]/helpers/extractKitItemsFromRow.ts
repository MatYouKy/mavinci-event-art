export type KitItemLine = { name: string; brand: string; model: string; quantity: number };

export function extractKitItemsFromRow(row: any): KitItemLine[] {
  // obsługujemy: row.kit.items OR row.equipment_kits.equipment_kit_items
  const out: KitItemLine[] = [];

  const kitItemsA = row?.equipment_kits?.equipment_kit_items;
  if (Array.isArray(kitItemsA)) {
    for (const ki of kitItemsA) {
      out.push({
        name: ki?.equipment_items?.name || 'Nieznany',
        brand: ki?.equipment_items?.brand || '',
        model: ki?.equipment_items?.model || '',
        quantity: Number(ki?.quantity || 1),
      });
    }
    return out;
  }

  const kitItemsB = row?.kit?.items; // u Ciebie pojawia się row.kit.items
  if (Array.isArray(kitItemsB)) {
    for (const it of kitItemsB) {
      // typowo: it.equipment_items + it.quantity
      const eq = it?.equipment_items || it?.equipment || it;
      out.push({
        name: eq?.name || 'Nieznany',
        brand: eq?.brand || '',
        model: eq?.model || '',
        quantity: Number(it?.quantity || eq?.quantity || 1),
      });
    }
    return out;
  }

  return out;
}

export function isKitRow(row: any) {
  return !!(row?.kit_id || row?.equipment_kit_id || row?.kit || row?.equipment_kits);
}