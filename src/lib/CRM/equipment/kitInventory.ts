export type KitComponent = { equipment_id: string | null; cable_id: string | null; quantity: number };
export type PhysicalKit = { id: string; quantity: number; is_active?: boolean; deleted_at?: string | null; equipment_kit_items: KitComponent[] };
export type StockItem = { id: string; name: string; is_active?: boolean; total_quantity?: number; equipment_units?: { status: string }[] };
export type StockCable = { id: string; name: string; stock_quantity: number; is_active?: boolean; deleted_at?: string | null };
export const componentKey = (i: KitComponent) => i.equipment_id ? `item-${i.equipment_id}` : `cable-${i.cable_id}`;
export function usableEquipmentStock(item: StockItem): number {
  if (item.is_active === false) return 0;
  if (item.equipment_units?.length) return item.equipment_units.filter(u => ['available','reserved','in_use'].includes(u.status)).length;
  return Math.max(0, Number(item.total_quantity) || 0);
}
export function checkKitInventory(id: string | null, quantity: number, items: KitComponent[], kits: PhysicalKit[], equipment: StockItem[], cables: StockCable[]) {
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error('Podaj dodatnią, całkowitą liczbę zestawów.');
  if (!items.length) throw new Error('Dodaj przynajmniej jeden składnik zestawu.');
  const perKit = new Map<string, number>();
  for (const item of items) {
    if (!!item.equipment_id === !!item.cable_id || !Number.isInteger(item.quantity) || item.quantity < 1) throw new Error('Każdy składnik musi mieć dodatnią, całkowitą ilość.');
    const key = componentKey(item);
    perKit.set(key, (perKit.get(key) || 0) + item.quantity);
  }
  const allocated = new Map<string, number>();
  for (const kit of kits) {
    if (kit.id === id || kit.is_active === false || kit.deleted_at) continue;
    for (const item of kit.equipment_kit_items) {
      const key = componentKey(item);
      allocated.set(key, (allocated.get(key) || 0) + kit.quantity * item.quantity);
    }
  }
  const stock = new Map<string, { name: string; quantity: number }>();
  for (const e of equipment) stock.set(`item-${e.id}`, { name: e.name, quantity: usableEquipmentStock(e) });
  for (const c of cables) stock.set(`cable-${c.id}`, { name: c.name, quantity: c.is_active === false || c.deleted_at ? 0 : Math.max(0, Number(c.stock_quantity) || 0) });
  let max = Infinity;
  const shortages: string[] = [];
  for (const [key, required] of Array.from(perKit.entries())) {
    const available = stock.get(key) || { name: 'Składnik', quantity: 0 };
    const other = allocated.get(key) || 0;
    const free = Math.max(0, available.quantity - other);
    max = Math.min(max, Math.floor(free / required));
    if (quantity * required > free) shortages.push(`${available.name}: potrzeba ${quantity * required}, sprawnych ${available.quantity}, w innych zestawach ${other}, brakuje ${quantity * required - free}.`);
  }
  return { maxQuantity: max === Infinity ? 0 : max, shortages };
}

// Existing reservations never increase the physical capacity after damage.
export function kitEventLimits(kit: PhysicalKit, byKey: Record<string, { available_in_term: number; used_by_this_event: number }>, used: number, reservedElsewhere: number) {
  const requirements = new Map<string, number>();
  for (const item of kit.equipment_kit_items || []) {
    if (item.quantity > 0) requirements.set(componentKey(item), (requirements.get(componentKey(item)) || 0) + item.quantity);
  }
  let maxSet = Math.max(0, Number(kit.quantity) - reservedElsewhere);
  if (kit.is_active === false || kit.deleted_at || !requirements.size) maxSet = 0;
  for (const [key, quantity] of Array.from(requirements.entries())) {
    const a = byKey[key];
    // Reclaim only this kit's components; keep other kits/direct items deducted.
    const otherUse = Math.max(0, (a?.used_by_this_event || 0) - used * quantity);
    maxSet = Math.min(maxSet, Math.floor(Math.max(0, (a?.available_in_term || 0) - otherUse) / quantity));
  }
  return { maxSet, maxAdd: Math.max(0, maxSet - used) };
}
