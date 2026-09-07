const PARAGRAPH_BLOCK_SELECTOR = 'p, pre, div, h1, h2, h3, h4';

const firstTextNode = (element: Element) => {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node && !node.textContent?.trim()) node = walker.nextNode();
  return node as Text | null;
};

const isOutlineOrderedList = (list: Element): list is HTMLOListElement => {
  if (list.tagName !== 'OL') return false;
  const marker = (list as HTMLElement).dataset.clauseMarker?.replace(/-paren$/, '') || '';
  return !marker || marker === 'decimal' || marker === 'outline-decimal';
};

export const normalizeContractListStructureInElement = (container: HTMLElement) => {
  container.querySelectorAll<HTMLOListElement | HTMLUListElement>('ol, ul').forEach((list) => {
    Array.from(list.childNodes).forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent?.trim() || '';
        if (!text) {
          node.remove();
          return;
        }
        const item = document.createElement('li');
        item.textContent = text;
        node.replaceWith(item);
        return;
      }

      if (node instanceof HTMLElement && node.matches('ol, ul')) {
        const previousItem = node.previousElementSibling;
        if (previousItem?.tagName === 'LI') {
          if (node.tagName === 'OL') {
            node.removeAttribute('start');
            Array.from(node.children).forEach((child) => child.removeAttribute('value'));
          }
          previousItem.appendChild(node);
          return;
        }

        const item = document.createElement('li');
        node.before(item);
        item.appendChild(node);
        return;
      }

      if (node instanceof HTMLElement && node.tagName !== 'LI') {
        const item = document.createElement('li');
        item.append(...Array.from(node.childNodes));
        node.replaceWith(item);
      }
    });
  });

  container.querySelectorAll<HTMLOListElement>('ol').forEach((list) => {
    if (list.hasAttribute('start') || list.dataset.contractListContinuation === 'true') return;
    const previousList = list.previousElementSibling;
    if (!(previousList instanceof HTMLElement) || previousList.tagName !== 'OL') return;
    const previousStart = Number(previousList.getAttribute('start') || 1);
    const previousItems = Array.from(previousList.children).filter(
      (child) => child.tagName === 'LI',
    ).length;
    list.setAttribute('start', String(previousStart + previousItems));
  });

  container
    .querySelectorAll<HTMLLIElement>('li[data-contract-outline-number]')
    .forEach((item) => delete item.dataset.contractOutlineNumber);

  container
    .querySelectorAll<HTMLLIElement>('li[data-contract-outline-suppressed]')
    .forEach((item) => delete item.dataset.contractOutlineSuppressed);

  container.querySelectorAll<HTMLLIElement>('li').forEach((item) => {
    const ownContentNodes = Array.from(item.childNodes).filter(
      (node) => !(node instanceof HTMLElement && node.matches('ol, ul')),
    );
    const ownText = ownContentNodes.map((node) => node.textContent || '').join('').trim();
    const containsGeneratedPlaceholderList = ownContentNodes.some(
      (node) =>
        node instanceof HTMLElement &&
        (node.matches(
          '[data-contract-offer-items="true"], [data-contract-decision-makers="true"]',
        ) ||
          Boolean(node.querySelector(
            '[data-contract-offer-items="true"], [data-contract-decision-makers="true"]',
          ))),
    );

    if (
      /^\{\{\s*(?:OFFER_ITEMS_TABLE|offer_items|decision_makers_list)\s*\}\}$/u.test(ownText) ||
      containsGeneratedPlaceholderList
    ) {
      item.dataset.contractOutlineSuppressed = 'true';
    }
  });

  const numberList = (list: HTMLOListElement, parentNumber = '') => {
    let nextNumber = Number(list.getAttribute('start') || 1);
    Array.from(list.children)
      .filter((child): child is HTMLLIElement => child.tagName === 'LI')
      .forEach((item) => {
        if (item.dataset.contractOutlineSuppressed === 'true') {
          Array.from(item.children)
            .filter(isOutlineOrderedList)
            .forEach((nestedList) => numberList(nestedList, parentNumber));
          return;
        }

        const explicitValue = Number(item.getAttribute('value'));
        const itemNumber = Number.isFinite(explicitValue) && explicitValue > 0
          ? explicitValue
          : nextNumber;
        const fullNumber = parentNumber ? `${parentNumber}.${itemNumber}` : String(itemNumber);
        item.dataset.contractOutlineNumber = parentNumber ? fullNumber : `${fullNumber}.`;
        nextNumber = itemNumber + 1;

        Array.from(item.children)
          .filter(isOutlineOrderedList)
          .forEach((nestedList) => numberList(nestedList, fullNumber));
      });
  };

  container.querySelectorAll<HTMLOListElement>('ol').forEach((list) => {
    if (!isOutlineOrderedList(list) || list.parentElement?.closest('ol')) return;
    numberList(list);
  });
};

/** Zamienia stare, ręcznie wpisane nagłówki „§ 12” na placeholder „§n”. */
export const normalizeContractParagraphPlaceholders = (html: string) => {
  if (typeof document === 'undefined' || !html) return html;
  const container = document.createElement('div');
  container.innerHTML = html;
  normalizeContractListStructureInElement(container);
  Array.from(container.querySelectorAll<HTMLElement>(PARAGRAPH_BLOCK_SELECTOR)).forEach((element) => {
    const textNode = firstTextNode(element);
    const nearestBlock = textNode?.parentElement?.closest(PARAGRAPH_BLOCK_SELECTOR);
    if (nearestBlock !== element || !textNode) return;
    textNode.textContent = (textNode.textContent || '').replace(/^(\s*)§\s*\d+/u, '$1§n');
  });
  return container.innerHTML;
};

/** Wylicza §1, §2… dopiero po wstrzyknięciu dynamicznych klauzul. */
export const resolveContractParagraphPlaceholders = (html: string) => {
  if (typeof document === 'undefined' || !html) return html;
  const container = document.createElement('div');
  container.innerHTML = normalizeContractParagraphPlaceholders(html);
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let paragraphNumber = 0;
  let node = walker.nextNode() as Text | null;
  while (node) {
    node.textContent = (node.textContent || '').replace(/§\s*n\b/giu, () => {
      paragraphNumber += 1;
      return `§ ${paragraphNumber}`;
    });
    node = walker.nextNode() as Text | null;
  }
  return container.innerHTML;
};
