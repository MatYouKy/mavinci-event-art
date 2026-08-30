const HTML_TAG_PATTERN = /<\/?[a-z][\s\S]*?>/i;
const ESCAPED_HTML_PATTERN = /&lt;\/?(?:p|div|h[1-6]|ol|ul|li|strong|em|blockquote)\b/i;

const ALLOWED_TAGS = new Set([
  'P',
  'H1',
  'H2',
  'H3',
  'STRONG',
  'B',
  'EM',
  'I',
  'U',
  'S',
  'DEL',
  'BLOCKQUOTE',
  'OL',
  'UL',
  'LI',
  'BR',
]);

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const plainTextToHtml = (value: string) => {
  const lines = value.replace(/\r\n?/g, '\n').split('\n');
  const html: string[] = [];
  let listType: 'ol' | 'ul' | null = null;
  let listMarker = '';

  const closeList = () => {
    if (!listType) return;
    html.push(`</${listType}>`);
    listType = null;
    listMarker = '';
  };

  lines.forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) {
      closeList();
      return;
    }

    const bullet = line.match(/^[-*•]\s+(.+)$/u);
    const numbered = line.match(/^(\d+)([.)])\s+(.+)$/u);
    const lettered = line.match(/^([a-z])([.)])\s+(.+)$/iu);
    const nextType = bullet ? 'ul' : numbered || lettered ? 'ol' : null;
    const nextMarker = numbered?.[2] === ')'
      ? 'decimal-paren'
      : lettered?.[2] === ')'
        ? 'lower-alpha-paren'
        : lettered
          ? 'lower-alpha'
          : '';

    if (nextType) {
      if (listType !== nextType || listMarker !== nextMarker) {
        closeList();
        const markerAttribute = nextMarker ? ` data-clause-marker="${nextMarker}"` : '';
        html.push(`<${nextType}${markerAttribute}>`);
        listType = nextType;
        listMarker = nextMarker;
      }
      html.push(`<li>${escapeHtml(bullet?.[1] || numbered?.[3] || lettered?.[3] || '')}</li>`);
      return;
    }

    closeList();
    const isParagraphHeading = /^§\s*(?:n|\d+)\b/iu.test(line);
    html.push(
      isParagraphHeading
        ? `<p data-contract-paragraph="true" data-clause-role="paragraphHeading">${escapeHtml(line)}</p>`
        : `<p>${escapeHtml(line)}</p>`,
    );
  });

  closeList();
  return html.join('');
};

const decodeEscapedHtml = (value: string) => {
  if (typeof document === 'undefined' || !ESCAPED_HTML_PATTERN.test(value)) return value;
  const textarea = document.createElement('textarea');
  textarea.innerHTML = value;
  const decoded = textarea.value;
  return HTML_TAG_PATTERN.test(decoded) ? decoded : value;
};

type QuillListItem = {
  node: HTMLLIElement;
  type: 'ordered' | 'bullet';
  indent: number;
};

const normalizeQuillList = (source: HTMLOListElement | HTMLUListElement) => {
  const sourceItems = Array.from(source.children).filter(
    (child): child is HTMLLIElement => child.tagName === 'LI',
  );
  if (!sourceItems.length) return;

  const hasQuillSemantics = sourceItems.some(
    (item) => item.hasAttribute('data-list') || /(?:^|\s)ql-indent-\d+(?:\s|$)/.test(item.className),
  );
  if (!hasQuillSemantics) return;

  const items: QuillListItem[] = sourceItems.map((item) => {
    const indentMatch = item.className.match(/(?:^|\s)ql-indent-(\d+)(?:\s|$)/);
    return {
      node: item,
      type: item.dataset.list === 'bullet' ? 'bullet' : 'ordered',
      indent: indentMatch ? Number(indentMatch[1]) : 0,
    };
  });

  const buildLevel = (
    startIndex: number,
    level: number,
  ): { fragment: DocumentFragment; index: number } => {
    const fragment = document.createDocumentFragment();
    let currentList: HTMLOListElement | HTMLUListElement | null = null;
    let currentType: QuillListItem['type'] | null = null;
    let lastItem: HTMLLIElement | null = null;
    let index = startIndex;

    while (index < items.length) {
      const item = items[index];
      if (item.indent < level) break;

      if (item.indent > level && lastItem) {
        const nested = buildLevel(index, level + 1);
        lastItem.appendChild(nested.fragment);
        index = nested.index;
        continue;
      }

      if (item.indent > level) item.indent = level;
      const effectiveType = item.type === 'bullet' || level >= 2 ? 'bullet' : 'ordered';
      if (!currentList || currentType !== effectiveType) {
        currentList = document.createElement(effectiveType === 'bullet' ? 'ul' : 'ol');
        if (effectiveType === 'ordered') {
          currentList.dataset.clauseMarker = level === 0 ? 'decimal-paren' : 'lower-alpha-paren';
        }
        fragment.appendChild(currentList);
        currentType = effectiveType;
      }

      const cleanItem = document.createElement('li');
      if (item.node.dataset.clauseAlign) {
        cleanItem.dataset.clauseAlign = item.node.dataset.clauseAlign;
      }
      while (item.node.firstChild) cleanItem.appendChild(item.node.firstChild);
      currentList.appendChild(cleanItem);
      lastItem = cleanItem;
      index += 1;
    }

    return { fragment, index };
  };

  source.replaceWith(buildLevel(0, 0).fragment);
};

const convertElement = (element: HTMLElement, targetTag: string) => {
  const replacement = document.createElement(targetTag);
  Array.from(element.attributes).forEach((attribute) => {
    replacement.setAttribute(attribute.name, attribute.value);
  });
  while (element.firstChild) replacement.appendChild(element.firstChild);
  element.replaceWith(replacement);
  return replacement;
};

const normalizeMarkedParagraphLists = (container: HTMLElement) => {
  const parents = [container, ...Array.from(container.querySelectorAll<HTMLElement>('blockquote'))];
  parents.forEach((parent) => {
    let currentList: HTMLOListElement | HTMLUListElement | null = null;
    let currentMarker = '';

    Array.from(parent.children).forEach((child) => {
      if (!['P', 'DIV'].includes(child.tagName)) {
        currentList = null;
        currentMarker = '';
        return;
      }

      const text = child.textContent?.trim() || '';
      const bullet = text.match(/^[-*•]\s+(.+)$/u);
      const numbered = text.match(/^(\d+)([.)])\s+(.+)$/u);
      const lettered = text.match(/^([a-z])([.)])\s+(.+)$/iu);
      if (!bullet && !numbered && !lettered) {
        currentList = null;
        currentMarker = '';
        return;
      }

      const type = bullet ? 'ul' : 'ol';
      const marker = numbered?.[2] === ')'
        ? 'decimal-paren'
        : lettered?.[2] === ')'
          ? 'lower-alpha-paren'
          : lettered
            ? 'lower-alpha'
            : '';
      if (!currentList || currentList.tagName.toLowerCase() !== type || currentMarker !== marker) {
        currentList = document.createElement(type) as HTMLOListElement | HTMLUListElement;
        if (marker) currentList.dataset.clauseMarker = marker;
        child.before(currentList);
        currentMarker = marker;
      }

      const item = document.createElement('li');
      item.textContent = bullet?.[1] || numbered?.[3] || lettered?.[3] || '';
      currentList.appendChild(item);
      child.remove();
    });
  });
};

const preserveStructuralFormatting = (container: HTMLElement) => {
  container.querySelectorAll<HTMLElement>('*').forEach((element) => {
    const classNames = element.getAttribute('class') || '';
    const classAlignment = classNames.match(/(?:^|\s)ql-align-(left|center|right|justify)(?:\s|$)/i)?.[1];
    const inlineAlignment = element.style?.textAlign;
    const alignment = (classAlignment || inlineAlignment || '').toLowerCase();
    if (['left', 'center', 'right', 'justify'].includes(alignment)) {
      element.dataset.clauseAlign = alignment;
    }

    const classIndent = classNames.match(/(?:^|\s)ql-indent-(\d+)(?:\s|$)/)?.[1];
    if (classIndent && element.tagName !== 'LI') {
      element.dataset.clauseIndent = String(Math.min(8, Number(classIndent)));
    }
  });
};

const applyListHierarchy = (container: HTMLElement) => {
  container.querySelectorAll<HTMLOListElement>('ol').forEach((list) => {
    if (list.dataset.clauseMarker) return;
    let depth = 0;
    let ancestor = list.parentElement?.closest('ol, ul');
    while (ancestor) {
      depth += 1;
      ancestor = ancestor.parentElement?.closest('ol, ul');
    }

    list.dataset.clauseMarker = depth === 0
      ? 'decimal-paren'
      : depth === 1
        ? 'lower-alpha-paren'
        : 'bullet';
  });
};

/**
 * Zamienia treść z edytora klauzul na przewidywalny, semantyczny HTML.
 * Font, rozmiar, kolor, interlinia i odstępy należą wyłącznie do szablonu umowy.
 */
export const normalizeContractClauseHtml = (input: string | null | undefined) => {
  const trimmed = String(input || '').trim();
  if (!trimmed) return '';

  const decoded = decodeEscapedHtml(trimmed);
  const source = HTML_TAG_PATTERN.test(decoded) ? decoded : plainTextToHtml(decoded);
  if (typeof document === 'undefined') return source;

  const container = document.createElement('div');
  container.innerHTML = source;
  container.querySelectorAll('style, script, link, meta, iframe, object, embed').forEach((node) => node.remove());
  preserveStructuralFormatting(container);

  Array.from(container.querySelectorAll<HTMLOListElement | HTMLUListElement>('ol, ul'))
    .reverse()
    .forEach(normalizeQuillList);

  container.querySelectorAll<HTMLElement>('font, span').forEach((element) => {
    element.replaceWith(...Array.from(element.childNodes));
  });

  container.querySelectorAll<HTMLElement>('h4, h5, h6').forEach((element) => {
    convertElement(element, 'h3');
  });

  container.querySelectorAll<HTMLElement>('div').forEach((element) => {
    const hasBlockChildren = Boolean(element.querySelector(':scope > p, :scope > h1, :scope > h2, :scope > h3, :scope > ol, :scope > ul, :scope > blockquote'));
    if (hasBlockChildren) element.replaceWith(...Array.from(element.childNodes));
    else convertElement(element, 'p');
  });

  Array.from(container.childNodes).forEach((node) => {
    if (node.nodeType !== Node.TEXT_NODE || !node.textContent?.trim()) return;
    const paragraph = document.createElement('p');
    paragraph.textContent = node.textContent;
    node.replaceWith(paragraph);
  });

  normalizeMarkedParagraphLists(container);
  applyListHierarchy(container);

  container.querySelectorAll<HTMLElement>('p, h1, h2, h3').forEach((element) => {
    const text = element.textContent?.trim() || '';
    // Separator między pełnym numerem paragrafu a tytułem jest obowiązkowy.
    // Bez niego sam nagłówek „§ 11” mógł zostać przez backtracking regexu
    // rozcięty na „§ 1” oraz osobny tytuł „1”.
    const combinedHeading = text.match(
      /^(§\s*(?:n|\d+))(?:(?:[.\-–—:]\s*)|\s+)(\S[\s\S]*)$/iu,
    );
    if (!combinedHeading) return;

    const paragraphHeading = document.createElement('p');
    paragraphHeading.dataset.contractParagraph = 'true';
    paragraphHeading.dataset.clauseRole = 'paragraphHeading';
    if (element.dataset.clauseAlign) {
      paragraphHeading.dataset.clauseAlign = element.dataset.clauseAlign;
    }
    paragraphHeading.textContent = combinedHeading[1];

    const title = document.createElement('p');
    title.dataset.clauseRole = 'title';
    if (element.dataset.clauseAlign) title.dataset.clauseAlign = element.dataset.clauseAlign;
    title.textContent = combinedHeading[2];
    element.replaceWith(paragraphHeading, title);
  });

  container.querySelectorAll<HTMLElement>('p, h1, h2, h3').forEach((element) => {
    const text = element.textContent?.trim() || '';
    if (/^§\s*(?:n|\d+)\s*$/iu.test(text)) {
      element.dataset.contractParagraph = 'true';
      element.dataset.clauseRole = 'paragraphHeading';
    } else if (/^H[1-3]$/.test(element.tagName)) {
      element.dataset.clauseRole = 'title';
    }
  });

  Array.from(container.querySelectorAll<HTMLElement>('*')).reverse().forEach((element) => {
    if (!ALLOWED_TAGS.has(element.tagName)) {
      element.replaceWith(...Array.from(element.childNodes));
      return;
    }

    Array.from(element.attributes).forEach((attribute) => {
      const keep =
        (attribute.name === 'data-contract-paragraph' && element.matches('p, h1, h2, h3')) ||
        (attribute.name === 'data-clause-role' && element.matches('p, h1, h2, h3, li')) ||
        (attribute.name === 'data-clause-align' && element.matches('p, h1, h2, h3, li, blockquote')) ||
        (attribute.name === 'data-clause-indent' && element.matches('p, h1, h2, h3, blockquote')) ||
        (attribute.name === 'data-clause-marker' && element.matches('ol')) ||
        (attribute.name === 'start' && element.matches('ol'));
      if (!keep) element.removeAttribute(attribute.name);
    });
  });

  container.querySelectorAll<HTMLElement>('p, h1, h2, h3, li, blockquote').forEach((element) => {
    if (!element.textContent?.trim() && !element.querySelector('br, ol, ul')) element.remove();
  });

  return container.innerHTML.trim();
};

export const hasContractClauseContent = (input: string | null | undefined) => {
  const normalized = normalizeContractClauseHtml(input);
  if (!normalized) return false;
  if (typeof document === 'undefined') return Boolean(normalized.replace(/<[^>]+>/g, '').trim());
  const container = document.createElement('div');
  container.innerHTML = normalized;
  return Boolean(container.textContent?.trim() || container.querySelector('ol, ul, blockquote'));
};
