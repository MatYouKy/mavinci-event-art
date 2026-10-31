import { stageLinkGroups, stageLinksFor, type StageLink, type WarehouseStageSnapshot } from './modularProduct';

// Use stored compatibility, never infer dimensions from equipment names or prices.
export const isHeightChoice = (group: ReturnType<typeof stageLinkGroups>[number]) =>
  group.choice && group.links.length > 0 && group.links.every(link => link.min_height != null || link.max_height != null);

const fits = (link: StageLink, height: number) => Number.isInteger(height) && height >= 1 && height <= 200
  && height >= (link.min_height ?? 1) && height <= (link.max_height ?? 200);

function resolveHeight(value: WarehouseStageSnapshot, height: number) {
  const choices = { ...value.selection.choices };
  let constrained = false, visits = 0;
  function visit(id: string, path: string, ancestors: string[], write: boolean): boolean {
    if (++visits > 2000 || ancestors.includes(id) || ancestors.length >= 8) return false;
    const node = value.equipment?.[id];
    if (!node) return false;
    let compatible = true;
    for (const group of stageLinkGroups(stageLinksFor(value, node))) {
      const key = path + '/' + group.key;
      const active = group.required || (group.choice ? Boolean(choices[key]) : value.selection.enabled[key]);
      if (!active) continue; // Height must not enable an optional extra.
      const check = (link: StageLink) => {
        constrained ||= link.min_height != null || link.max_height != null;
        return fits(link, height) && visit(link.equipment_id, path + '/' + link.id, [...ancestors, id], false);
      };
      let selected: StageLink[];
      if (isHeightChoice(group) && group.required) {
        constrained = true;
        const candidates = group.links.filter(check).sort((a, b) =>
          Number(b.id === choices[key]) - Number(a.id === choices[key])
          || ((a.max_height ?? 200) - (a.min_height ?? 1)) - ((b.max_height ?? 200) - (b.min_height ?? 1))
          || (a.max_height ?? 200) - (b.max_height ?? 200)
          || a.id.localeCompare(b.id));
        selected = candidates.slice(0, 1);
        if (write) choices[key] = selected[0]?.id || '';
        if (!selected.length) compatible = false;
      } else {
        selected = group.choice ? group.links.filter(link => link.id === choices[key]) : group.links;
      }
      for (const link of selected) {
        constrained ||= link.min_height != null || link.max_height != null;
        if (!fits(link, height) || !visit(link.equipment_id, path + '/' + link.id, [...ancestors, id], write)) compatible = false;
      }
    }
    return compatible;
  }
  let compatible = true;
  for (const root of value.catalog.roots) {
    if (root.required || value.selection.enabled['root:' + root.id]) {
      if (!visit(root.equipment_id, root.id, [], true)) compatible = false;
    }
  }
  return { choices, compatible, constrained };
}

export function selectStageHeight(value: WarehouseStageSnapshot): WarehouseStageSnapshot {
  if (!value.equipment) return value;
  const { choices } = resolveHeight(value, value.selection.height);
  return JSON.stringify(choices) === JSON.stringify(value.selection.choices)
    ? value : { ...value, selection: { ...value.selection, choices } };
}

export function stageHeightOptions(value: WarehouseStageSnapshot) {
  if (!value.equipment) return [];
  const ranges: { min: number; max: number }[] = [];
  for (let height = 1; height <= 200; height++) {
    const result = resolveHeight(value, height);
    if (!result.constrained || !result.compatible) continue;
    const last = ranges[ranges.length - 1];
    if (last?.max === height - 1) last.max = height;
    else ranges.push({ min: height, max: height });
  }
  return ranges;
}
