// helpers/category.ts

import { EquipmentCategories, EquipmentMainCategory } from '../types/equipment.types';

export function getMainCategoryKey(
  all: {
    id: string;
    parent_id: string | null;
    level: number;
    system_key?: EquipmentMainCategory | null;
  }[],
  chosenId: string | null,
): EquipmentMainCategory | null {
  if (!chosenId) return null;
  const byId = new Map(all.map((c) => [c.id, c]));
  let node = byId.get(chosenId);
  if (!node) return null;

  // jeśli wybrano podkategorię (level 2), idziemy do parenta
  if (node.level === 2 && node.parent_id) node = byId.get(node.parent_id) ?? node;

  // oczekujemy, że kategorie poziomu 1 mają system_key
  return (node.system_key as EquipmentMainCategory) ?? null;
}


export  const normalizeSubcategories = (
  main?: EquipmentMainCategory | ''
): EquipmentMainCategory[] => {
  if (!main) return [];
  const raw = EquipmentCategories?.[main] ?? [];
  return raw.map((item) => item as EquipmentMainCategory);
};