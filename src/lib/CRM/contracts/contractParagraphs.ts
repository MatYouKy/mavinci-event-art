const PARAGRAPH_BLOCK_SELECTOR = 'p, pre, div, h1, h2, h3, h4';

const firstTextNode = (element: Element) => {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node && !node.textContent?.trim()) node = walker.nextNode();
  return node as Text | null;
};

/** Zamienia stare, ręcznie wpisane nagłówki „§ 12” na placeholder „§n”. */
export const normalizeContractParagraphPlaceholders = (html: string) => {
  if (typeof document === 'undefined' || !html) return html;
  const container = document.createElement('div');
  container.innerHTML = html;
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
