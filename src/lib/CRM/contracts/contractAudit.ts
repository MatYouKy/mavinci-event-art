import { resolveContractClausePointNumbersInElement } from './contractClauseContent';

export type ContractAuditSeverity = 'error' | 'warning' | 'info';

export type ContractAuditCategory =
  | 'conflict'
  | 'incomplete_sentence'
  | 'numbering'
  | 'missing_information'
  | 'unclear_wording'
  | 'legal_risk'
  | 'other';

export type ContractAuditBlock = {
  id: string;
  tag: string;
  text: string;
  section: string;
  hasChildren: boolean;
  protected: boolean;
};

export type ContractAuditDuplicate = {
  id: string;
  keepBlockId: string;
  removeBlockIds: string[];
  reason: string;
};

export type ContractAuditOperation = {
  blockId: string;
  action: 'replace' | 'remove';
  replacementText: string;
};

export type ContractAuditOption = {
  id: string;
  label: string;
  explanation: string;
  operations: ContractAuditOperation[];
};

export type ContractAuditIssue = {
  id: string;
  severity: ContractAuditSeverity;
  category: ContractAuditCategory;
  title: string;
  description: string;
  relatedBlockIds: string[];
  options: ContractAuditOption[];
  recommendedOptionId: string;
};

export type ContractAuditResult = {
  summary: string;
  duplicates: ContractAuditDuplicate[];
  issues: ContractAuditIssue[];
  model?: string;
  generatedAt?: string;
};

type ContractAuditCandidate = {
  element: HTMLElement;
  text: string;
};

const BLOCK_SELECTOR = 'h1, h2, h3, h4, h5, h6, p, li, blockquote';

const normalizeText = (value: string) => value.replace(/\s+/g, ' ').trim();

const getElementOwnText = (element: HTMLElement) => {
  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('ol, ul').forEach((list) => list.remove());
  return normalizeText(clone.textContent || '');
};

const collectCandidates = (container: HTMLElement): ContractAuditCandidate[] =>
  Array.from(container.querySelectorAll<HTMLElement>(BLOCK_SELECTOR))
    .filter((element) => {
      if (element.tagName !== 'LI') return true;
      return !element.querySelector(':scope > p, :scope > h1, :scope > h2, :scope > h3');
    })
    .map((element) => ({ element, text: getElementOwnText(element) }))
    .filter((candidate) => candidate.text.length > 0);

const normalizeSensitiveValue = (value: string) => normalizeText(
  value.replace(/<[^>]+>/g, ' '),
).toLocaleLowerCase('pl-PL');

const containsSensitiveValue = (text: string, sensitiveValues: string[]) => {
  const normalized = normalizeText(text).toLocaleLowerCase('pl-PL');
  return sensitiveValues.some((value) => {
    const sensitive = normalizeSensitiveValue(value);
    return sensitive.length >= 4 && normalized.includes(sensitive);
  });
};

const containsDirectPersonalData = (text: string) =>
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text) ||
  /\b(?:PESEL|NIP|REGON|KRS|numer rachunku|rachunek bankowy|IBAN)\b/i.test(text) ||
  /(?:\+?48[\s-]?)?(?:\d[\s-]?){9}\b/.test(text) ||
  /\breprezentowan(?:a|e|y|ego|ej)?\b/i.test(text) ||
  /\bz siedzibą\b/i.test(text);

const startsSignatureZone = (text: string, isNearDocumentEnd: boolean) => {
  const normalized = normalizeText(text).toLocaleLowerCase('pl-PL');
  if (normalized.length > 160) return false;
  return (
    /\bpodpisy?\s+(?:stron|zamawiającego|wykonawcy)\b/.test(normalized) ||
    /\bmiejsce\s+na\s+podpis\b/.test(normalized) ||
    (/\bzamawiający\b/.test(normalized) && /\bwykonawca\b/.test(normalized)) ||
    (isNearDocumentEnd && /^(?:zamawiający|wykonawca)$/.test(normalized))
  );
};

export const getContractDocumentParts = (content: string) => {
  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const pages = Array.isArray(parsed.pages) ? parsed.pages : [];
      return {
        parsed,
        flowContent: String(parsed.flowContent || pages.join('') || ''),
        settings: parsed.settings || {},
      };
    }
    if (Array.isArray(parsed)) {
      return { parsed: { pages: parsed }, flowContent: parsed.join(''), settings: {} };
    }
  } catch {
    // Starsze umowy mogą przechowywać bezpośrednio HTML.
  }

  return {
    parsed: { flowContent: content, pages: [content], settings: {} },
    flowContent: content,
    settings: {},
  };
};

export const extractContractAuditBlocks = (
  content: string,
  sensitiveValues: string[] = [],
): ContractAuditBlock[] => {
  if (typeof document === 'undefined') return [];

  const { flowContent } = getContractDocumentParts(content);
  const container = document.createElement('div');
  container.innerHTML = flowContent;
  const candidates = collectCandidates(container);
  let section = 'Treść umowy';
  let contractBodyStarted = false;
  let signatureZoneStarted = false;

  return candidates.map(({ element, text }, index) => {
    const tag = element.tagName.toLowerCase();
    const isParagraphHeading = /^§\s*\d+/i.test(text);
    const isHeading = /^h[1-6]$/.test(tag) || isParagraphHeading;
    if (isParagraphHeading) contractBodyStarted = true;
    if (startsSignatureZone(text, index >= Math.floor(candidates.length * 0.7))) {
      signatureZoneStarted = true;
    }
    if (isHeading) section = text.slice(0, 180);

    return {
      id: `contract-block-${index + 1}`,
      tag,
      text: text.slice(0, 2500),
      section,
      hasChildren: Boolean(element.querySelector('ol, ul')),
      protected:
        !contractBodyStarted ||
        signatureZoneStarted ||
        containsDirectPersonalData(text) ||
        containsSensitiveValue(text, sensitiveValues),
    };
  });
};

const replaceElementText = (element: HTMLElement, replacementText: string) => {
  const childLists = Array.from(element.children).filter((child) =>
    ['OL', 'UL'].includes(child.tagName),
  );
  const nonListChildren = Array.from(element.children).filter(
    (child) => !['OL', 'UL'].includes(child.tagName),
  );
  const singleWrapper = nonListChildren.length === 1
    ? nonListChildren[0].cloneNode(false) as HTMLElement
    : null;

  childLists.forEach((list) => list.remove());
  element.replaceChildren();
  if (singleWrapper) {
    singleWrapper.textContent = replacementText.trim();
    element.appendChild(singleWrapper);
  } else {
    element.textContent = replacementText.trim();
  }
  childLists.forEach((list) => element.appendChild(list));
};

export const applyContractAuditDecisions = (
  content: string,
  audit: ContractAuditResult,
  selections: Record<string, string>,
  sensitiveValues: string[] = [],
) => {
  if (typeof document === 'undefined') {
    return {
      flowContent: getContractDocumentParts(content).flowContent,
      removed: 0,
      changed: 0,
      skipped: 0,
    };
  }

  const { flowContent } = getContractDocumentParts(content);
  const container = document.createElement('div');
  container.innerHTML = flowContent;
  const candidates = collectCandidates(container);
  const blocks = extractContractAuditBlocks(content, sensitiveValues);
  const elements = new Map<string, HTMLElement>();
  const protectedIds = new Set(blocks.filter((block) => block.protected).map((block) => block.id));
  candidates.forEach((candidate, index) => {
    elements.set(`contract-block-${index + 1}`, candidate.element);
  });

  let removed = 0;
  let changed = 0;
  let skipped = 0;
  const removedIds = new Set<string>();

  const removeBlock = (blockId: string) => {
    const element = elements.get(blockId);
    if (!element || removedIds.has(blockId) || protectedIds.has(blockId)) {
      skipped += 1;
      return;
    }
    element.remove();
    removedIds.add(blockId);
    removed += 1;
  };

  audit.duplicates.forEach((duplicate) => {
    duplicate.removeBlockIds
      .filter((blockId) => blockId !== duplicate.keepBlockId)
      .forEach(removeBlock);
  });

  audit.issues.forEach((issue) => {
    const selectedOptionId = selections[issue.id];
    if (!selectedOptionId || selectedOptionId === '__keep_original__') return;
    const option = issue.options.find((candidate) => candidate.id === selectedOptionId);
    if (!option) {
      skipped += 1;
      return;
    }

    option.operations.forEach((operation) => {
      if (operation.action === 'remove') {
        removeBlock(operation.blockId);
        return;
      }

      const element = elements.get(operation.blockId);
      if (!element || removedIds.has(operation.blockId) || protectedIds.has(operation.blockId)) {
        skipped += 1;
        return;
      }
      replaceElementText(element, operation.replacementText);
      changed += 1;
    });
  });

  container.querySelectorAll('ol, ul').forEach((list) => {
    if (!list.querySelector(':scope > li')) list.remove();
  });
  resolveContractClausePointNumbersInElement(container);

  return { flowContent: container.innerHTML, removed, changed, skipped };
};
