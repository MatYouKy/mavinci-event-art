import { CONTRACT_CONDITION_ATTRIBUTE, negateContractCondition } from './contractConditions';

/**
 * Scalanie wariantów szablonu umowy w jeden szablon z sekcjami warunkowymi.
 *
 * Bierzemy szablon bazowy (otwarty w edytorze) i wariant (np. „Wesela — bez noclegu”). Akapity wspólne zostają bez
 * warunku, akapity tylko z wariantu dostają warunek wariantu (np. `kategoria=Wesele`), a akapity tylko z bazy —
 * warunek odwrotny. Porównanie idzie po kolejnych blokach (najdłuższy wspólny podciąg), a w listach — po punktach,
 * także w punktach zagnieżdżonych pod tym samym nagłówkiem sekcji. Numery „§ 3” porównujemy jako „§n”.
 */

export interface ContractMergeStats {
  common: number;
  onlyBase: number;
  onlyOther: number;
  /** Udział wspólnych bloków (0–1) — przy małym podobieństwie lepiej dołączyć wariant jako całą sekcję. */
  similarity: number;
}

export interface ContractMergeResult {
  html: string;
  stats: ContractMergeStats;
}

export interface ContractMergeOptions {
  /** Warunek dla treści tylko z bazy (domyślnie odwrotność warunku wariantu). */
  baseCondition?: string;
}

const LIST_TAGS = new Set(['OL', 'UL']);

const blockKey = (node: Element) =>
  (node.textContent || '')
    .replace(/\u00a0/g, ' ')
    .replace(/§\s*(?:\d+|n)\b/giu, '§n')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('pl-PL');

/** Tekst punktu bez punktów zagnieżdżonych — „nagłówek” punktu do parowania sekcji. */
const itemHeadKey = (item: Element) => {
  const clone = item.cloneNode(true) as Element;
  clone.querySelectorAll('ol, ul').forEach((list) => list.remove());
  return blockKey(clone);
};

type Op = { type: 'equal'; base: Element; other: Element } | { type: 'base'; node: Element } | { type: 'other'; node: Element };

/** Najdłuższy wspólny podciąg kluczy → sekwencja: wspólne / tylko w bazie / tylko w wariancie. */
const diff = (base: Element[], other: Element[], key: (node: Element) => string): Op[] => {
  const a = base.map(key);
  const b = other.map(key);
  const n = a.length;
  const m = b.length;
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: 'equal', base: base[i], other: other[j] });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) ops.push({ type: 'base', node: base[i++] });
    else ops.push({ type: 'other', node: other[j++] });
  }
  while (i < n) ops.push({ type: 'base', node: base[i++] });
  while (j < m) ops.push({ type: 'other', node: other[j++] });
  return ops;
};

const elementChildren = (element: Element) => Array.from(element.children);

/** Warunek na bloku; blok, który już ma warunek, trafia do sekcji (oba warunki muszą być spełnione). */
const conditioned = (doc: Document, nodes: Element[], condition: string): Element[] => {
  if (nodes.length === 1 && !LIST_TAGS.has(nodes[0].tagName) && nodes[0].tagName !== 'TABLE' &&
    !nodes[0].hasAttribute(CONTRACT_CONDITION_ATTRIBUTE)) {
    const clone = nodes[0].cloneNode(true) as Element;
    clone.setAttribute(CONTRACT_CONDITION_ATTRIBUTE, condition);
    return [clone];
  }
  const section = doc.createElement('div');
  section.setAttribute(CONTRACT_CONDITION_ATTRIBUTE, condition);
  nodes.forEach((node) => section.appendChild(node.cloneNode(true)));
  return [section];
};

/** Punkt listy z warunkiem (punkt z własnym warunkiem dostaje go na wewnętrznej sekcji). */
const conditionedItem = (doc: Document, item: Element, condition: string) => {
  const clone = item.cloneNode(true) as Element;
  const existing = clone.getAttribute(CONTRACT_CONDITION_ATTRIBUTE);
  if (existing) {
    const inner = doc.createElement('div');
    inner.setAttribute(CONTRACT_CONDITION_ATTRIBUTE, existing);
    while (clone.firstChild) inner.appendChild(clone.firstChild);
    clone.appendChild(inner);
  }
  clone.setAttribute(CONTRACT_CONDITION_ATTRIBUTE, condition);
  return clone;
};

interface Context {
  doc: Document;
  baseCondition: string;
  otherCondition: string;
  stats: ContractMergeStats;
}

/** Scala dwie listy punkt po punkcie; punkty z tym samym nagłówkiem scala w głąb (punkty 1.1, 1.2 pod sekcją). */
const mergeLists = (base: Element, other: Element, context: Context): Element => {
  const { doc } = context;
  const merged = base.cloneNode(false) as Element;
  const ops = diff(elementChildren(base), elementChildren(other), blockKey);
  let index = 0;
  while (index < ops.length) {
    const op = ops[index];
    if (op.type === 'equal') {
      merged.appendChild(op.base.cloneNode(true));
      context.stats.common += 1;
      index += 1;
      continue;
    }
    // Ciąg zmian: punkty tylko w bazie i tylko w wariancie, parowane po nagłówku.
    const baseRun: Element[] = [];
    const otherRun: Element[] = [];
    while (index < ops.length && ops[index].type !== 'equal') {
      const change = ops[index] as { type: 'base' | 'other'; node: Element };
      (change.type === 'base' ? baseRun : otherRun).push(change.node);
      index += 1;
    }
    const usedOther = new Set<Element>();
    baseRun.forEach((item) => {
      const partner = otherRun.find((candidate) => !usedOther.has(candidate) && itemHeadKey(candidate) === itemHeadKey(item) && itemHeadKey(item));
      const baseLists = elementChildren(item).filter((child) => LIST_TAGS.has(child.tagName));
      const otherLists = partner ? elementChildren(partner).filter((child) => LIST_TAGS.has(child.tagName)) : [];
      if (partner && baseLists.length === 1 && otherLists.length === 1) {
        usedOther.add(partner);
        const combined = item.cloneNode(true) as Element;
        const target = elementChildren(combined).find((child) => LIST_TAGS.has(child.tagName))!;
        target.replaceWith(mergeLists(baseLists[0], otherLists[0], context));
        merged.appendChild(combined);
        context.stats.common += 1;
        return;
      }
      merged.appendChild(conditionedItem(doc, item, context.baseCondition));
      context.stats.onlyBase += 1;
    });
    otherRun.filter((item) => !usedOther.has(item)).forEach((item) => {
      merged.appendChild(conditionedItem(doc, item, context.otherCondition));
      context.stats.onlyOther += 1;
    });
  }
  return merged;
};

const mergeBlocks = (base: Element[], other: Element[], target: Element, context: Context) => {
  const { doc } = context;
  const ops = diff(base, other, blockKey);
  let index = 0;
  while (index < ops.length) {
    const op = ops[index];
    if (op.type === 'equal') {
      target.appendChild(op.base.cloneNode(true));
      context.stats.common += 1;
      index += 1;
      continue;
    }
    const baseRun: Element[] = [];
    const otherRun: Element[] = [];
    while (index < ops.length && ops[index].type !== 'equal') {
      const change = ops[index] as { type: 'base' | 'other'; node: Element };
      (change.type === 'base' ? baseRun : otherRun).push(change.node);
      index += 1;
    }
    // Ta sama lista z innymi punktami — scalamy punkty zamiast powielać całą listę. Listy w ciągu zmian parujemy
    // po kolei według rodzaju (numerowana / punktowana); bloki między nimi dostają warunki.
    const flush = (baseNodes: Element[], otherNodes: Element[]) => {
      if (baseNodes.length) {
        conditioned(doc, baseNodes, context.baseCondition).forEach((node) => target.appendChild(node));
        context.stats.onlyBase += baseNodes.length;
      }
      if (otherNodes.length) {
        conditioned(doc, otherNodes, context.otherCondition).forEach((node) => target.appendChild(node));
        context.stats.onlyOther += otherNodes.length;
      }
    };
    let b = 0;
    let o = 0;
    while (b < baseRun.length || o < otherRun.length) {
      const nextBaseList = baseRun.findIndex((node, position) => position >= b && LIST_TAGS.has(node.tagName));
      const nextOtherList = nextBaseList < 0 ? -1
        : otherRun.findIndex((node, position) => position >= o && node.tagName === baseRun[nextBaseList].tagName);
      if (nextBaseList < 0 || nextOtherList < 0) {
        flush(baseRun.slice(b), otherRun.slice(o));
        break;
      }
      flush(baseRun.slice(b, nextBaseList), otherRun.slice(o, nextOtherList));
      target.appendChild(mergeLists(baseRun[nextBaseList], otherRun[nextOtherList], context));
      b = nextBaseList + 1;
      o = nextOtherList + 1;
    }
  }
};

const topLevelBlocks = (doc: Document, html: string) => {
  const container = doc.createElement('div');
  container.innerHTML = html || '';
  // Tekst luzem na najwyższym poziomie — jako akapit, żeby dało się go porównać.
  Array.from(container.childNodes).forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE && (node.textContent || '').trim()) {
      const paragraph = doc.createElement('p');
      node.replaceWith(paragraph);
      paragraph.appendChild(node);
    } else if (node.nodeType !== Node.ELEMENT_NODE) node.parentNode?.removeChild(node);
  });
  return elementChildren(container);
};

/** Scala szablon bazowy z wariantem; `otherCondition` — kiedy obowiązuje treść wariantu. */
export const mergeContractTemplates = (
  baseHtml: string,
  otherHtml: string,
  otherCondition: string,
  options: ContractMergeOptions = {},
): ContractMergeResult => {
  const doc = document;
  const stats: ContractMergeStats = { common: 0, onlyBase: 0, onlyOther: 0, similarity: 0 };
  const context: Context = {
    doc,
    otherCondition,
    baseCondition: options.baseCondition || negateContractCondition(otherCondition),
    stats,
  };
  const output = doc.createElement('div');
  mergeBlocks(topLevelBlocks(doc, baseHtml), topLevelBlocks(doc, otherHtml), output, context);
  const total = stats.common + Math.max(stats.onlyBase, stats.onlyOther);
  stats.similarity = total ? stats.common / total : 1;
  return { html: output.innerHTML, stats };
};

/** Wariant dołączony w całości jako jedna sekcja (gdy szablony są zbyt różne, by scalać akapity). */
export const appendContractVariant = (baseHtml: string, otherHtml: string, otherCondition: string, baseCondition?: string) => {
  const doc = document;
  const base = doc.createElement('div');
  base.setAttribute(CONTRACT_CONDITION_ATTRIBUTE, baseCondition || negateContractCondition(otherCondition));
  base.innerHTML = baseHtml;
  const other = doc.createElement('div');
  other.setAttribute(CONTRACT_CONDITION_ATTRIBUTE, otherCondition);
  other.innerHTML = otherHtml;
  return base.outerHTML + other.outerHTML;
};
