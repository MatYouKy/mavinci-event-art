type ItemType = 'item' | 'kit' | 'cable';
type AvailKey = `${ItemType}-${string}`;

export const keyOf = (type: ItemType, id: string) => `${type}-${id}` as AvailKey;

export function getKeyForEventRow(row: any): AvailKey | null {
  const eqId = row?.equipment_id ?? row?.equipment?.id ?? row?.equipment?.equipment_id;
  if (eqId) return keyOf('item', eqId);

  const kitId = row?.kit_id ?? row?.kit?.id ?? row?.kit?.kit_id;
  if (kitId) return keyOf('kit', kitId);

  const cableId = row?.cable_id ?? row?.cable?.id ?? row?.cables?.id;
  if (cableId) return keyOf('cable', cableId);

  return null;
}
