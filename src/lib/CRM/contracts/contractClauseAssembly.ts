import {
  normalizeContractClausePointListHtml,
  type ContractClauseCategory,
  type ContractClausePrimaryCategory,
} from './contractClauseContent';
import type { EventContractClauseItem } from './eventContractClauseOverrides';
import { getSharedContractClause, SHARED_CONTRACT_CLAUSES } from './sharedContractClauses';

const categories: ContractClauseCategory[] = [
  'conditions', 'requirements', 'obligations', 'risks', 'additional_requirements', 'general',
];
const escapeHtml = (value: string) => value.replace(/&/g, '&amp;')
  .replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const htmlContainer = (html: string) => {
  const node = document.createElement('div');
  node.innerHTML = html;
  return node;
};
// Porównujemy całą treść, zachowując liczby, jednostki i interpunkcję.
export const contractClauseIdentity = (html: string) => {
  const text = typeof document === 'undefined' ? html : htmlContainer(html).textContent || '';
  return text.replace(/\s+/g, ' ').trim().toLocaleLowerCase('pl-PL');
};
export const contractClauseSourceFingerprint = (items: Array<{
  id: string; html: string; category: string; topic: string; sharedKey?: string;
}>) => JSON.stringify({ sharedClauses: SHARED_CONTRACT_CLAUSES, items: items.map((item) => [
  item.id, item.category, item.topic, item.sharedKey || '', item.html,
]).sort((left, right) => String(left[0]).localeCompare(String(right[0]))) });

export type SharedClauseConflict = {
  key: string;
  category: ContractClausePrimaryCategory;
  topic: string;
  candidates: EventContractClauseItem[];
};

export const getSharedClauseConflicts = (items: EventContractClauseItem[]): SharedClauseConflict[] => {
  const byKey = new Map<string, EventContractClauseItem[]>();
  items.filter((item) => item.enabled && item.sharedKey).forEach((item) => {
    const key = `shared:${item.sharedKey}`;
    const group = byKey.get(key) || [];
    if (!group.some((other) => contractClauseIdentity(other.html) === contractClauseIdentity(item.html))) {
      group.push(item);
    }
    byKey.set(key, group);
  });
  return [...byKey.entries()].filter(([, group]) => group.length > 1).map(([key, candidates]) => ({
    key,
    category: candidates[0].category as ContractClausePrimaryCategory,
    topic: candidates[0].topic,
    candidates,
  }));
};

const clausePoints = (html: string) => {
  const root = htmlContainer(normalizeContractClausePointListHtml(html));
  const points = Array.from(root.querySelectorAll('li')).filter((item) => !item.parentElement?.closest('li'));
  return points.length ? points.map((item) => item.innerHTML) : [root.innerHTML].filter(Boolean);
};

/** Jedna ścieżka składania sekcji dla podglądu, edycji zmiennych i PDF. */
export const assembleContractClauses = (
  sourceItems: EventContractClauseItem[],
  templateFlow: string,
  selections: Record<string, string> = {},
) => {
  const sections: Record<string, string> = {};
  if (typeof document === 'undefined') return { flowContent: templateFlow, sections };
  const template = htmlContainer(templateFlow);
  const conflicts = getSharedClauseConflicts(sourceItems);
  const conflictingKeys = new Set(conflicts.map((conflict) => conflict.key));
  const selectedIdentities = new Map(conflicts.flatMap((conflict) => {
    const selected = conflict.candidates.find((item) => item.id === selections[conflict.key]);
    return selected ? [[conflict.key, contractClauseIdentity(selected.html)] as const] : [];
  }));
  const items = sourceItems.filter((item) => {
    if (!item.enabled) return false;
    const selected = item.sharedKey && selectedIdentities.get(`shared:${item.sharedKey}`);
    return !selected || contractClauseIdentity(item.html) === selected;
  });
  const coveredSharedKeys = new Set<string>();
  template.querySelectorAll<HTMLElement>('[data-contract-shared-clause]').forEach((block) => {
    const key = block.dataset.contractSharedClause || '';
    const matches = items.filter((item) => item.sharedKey === key);
    if (conflictingKeys.has(`shared:${key}`) && !selectedIdentities.has(`shared:${key}`)) {
      // Rozbieżne wersje pozostają widoczne do rozstrzygnięcia; nie wybieramy losowej.
      block.remove();
      return;
    }
    const content = matches[0]?.html || getSharedContractClause(key)?.content;
    if (content) block.innerHTML = clausePoints(content).join('<br>');
    coveredSharedKeys.add(key);
  });

  const existingText = new Set(Array.from(template.querySelectorAll('p, li'))
    .filter((node) => !node.querySelector('li, [data-contract-clause-slot]'))
    .map((node) => contractClauseIdentity(node.innerHTML))
    .filter(Boolean));
  type Point = { html: string; item: EventContractClauseItem; products: Set<string> };
  const pointsByCategory = new Map(categories.map((category) => [category, [] as Point[]]));
  const seen = new Map<string, Point>();
  const commonOrder = new Map(SHARED_CONTRACT_CLAUSES.map((clause, index) => [clause.key, index]));
  const ordered = items.map((item, index) => ({ item, index })).sort((a, b) => {
    if (Boolean(a.item.sharedKey) !== Boolean(b.item.sharedKey)) return a.item.sharedKey ? -1 : 1;
    if (a.item.sharedKey && b.item.sharedKey) {
      return (commonOrder.get(a.item.sharedKey) ?? 999) - (commonOrder.get(b.item.sharedKey) ?? 999) || a.index - b.index;
    }
    return a.index - b.index;
  });
  ordered.forEach(({ item }) => {
    if (item.sharedKey && coveredSharedKeys.has(item.sharedKey)) return;
    clausePoints(item.html).forEach((html) => {
      const identity = contractClauseIdentity(html);
      if (!identity || existingText.has(identity)) return;
      const prior = seen.get(identity);
      if (prior) {
        if (!item.sharedKey && item.productName) prior.products.add(item.productName);
        return;
      }
      const point = { html, item, products: new Set(item.sharedKey ? [] : [item.productName].filter(Boolean)) };
      seen.set(identity, point);
      pointsByCategory.get(item.category)?.push(point);
    });
  });
  categories.forEach((category) => {
    const points = pointsByCategory.get(category) || [];
    const labelled = new Set<string>();
    const html = points.map((point) => {
      const product = [...point.products].join(' · ');
      const needsLabel = point.item.source === 'automatic' && product && !labelled.has(product) && !point.item.sharedKey;
      if (product) labelled.add(product);
      const alreadyLabelled = product && contractClauseIdentity(point.html).startsWith(product.toLocaleLowerCase('pl-PL'));
      const label = needsLabel && !alreadyLabelled ? `<strong>${escapeHtml(product)}.</strong> ` : '';
      return `<div class="product-contract-clause" data-clause-category="${category}" data-clause-topic="${escapeHtml(point.item.topic)}" data-clause-candidate="${escapeHtml(point.item.id)}" data-product-name="${escapeHtml(product)}"><ol><li>${label}${point.html}</li></ol></div>`;
    }).join('');
    sections[`contract_clauses_${category}`] = html
      ? `<div class="contract-product-clauses" data-clause-category="${category}">${html}</div>` : '';
  });
  return { flowContent: template.innerHTML, sections };
};
