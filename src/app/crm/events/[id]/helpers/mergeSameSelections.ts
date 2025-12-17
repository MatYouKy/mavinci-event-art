import { SelectedItem } from '../../type';
import { keyOf } from './getKeyForEventRow';

export function mergeSameSelections(selected: SelectedItem[]) {
  const map = new Map<string, SelectedItem>();
  for (const s of selected) {
    const k = keyOf(s.type, s.id);
    const prev = map.get(k);
    if (!prev) map.set(k, { ...s });
    else map.set(k, { ...prev, quantity: prev.quantity + s.quantity });
  }
  return [...map.values()];
}