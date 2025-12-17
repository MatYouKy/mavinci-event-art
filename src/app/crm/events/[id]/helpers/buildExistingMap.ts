import { keyOf } from './getKeyForEventRow';

export function buildExistingMap(equipmentRows: any[]) {
  const map = new Map<string, any>();
  for (const row of equipmentRows || []) {
    const eqId = row?.equipment_id ?? row?.equipment?.id ?? row?.equipment?.equipment_id;
    const kitId = row?.kit_id ?? row?.kit?.id ?? row?.kit?.kit_id;

    if (eqId) map.set(keyOf('item', eqId), row);
    if (kitId) map.set(keyOf('kit', kitId), row);
  }
  return map;
}