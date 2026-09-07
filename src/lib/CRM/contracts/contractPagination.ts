import {
  normalizeContractClauseHtml,
  normalizeContractClausePointListHtml,
  resolveContractClausePointNumbersInElement,
  stripProductNameHeadingFromClauseHtml,
  getContractClauseSlotIndentLevel,
} from './contractClauseContent';
import {
  normalizeContractListStructureInElement,
  normalizeContractParagraphPlaceholders,
  resolveContractParagraphPlaceholders,
} from './contractParagraphs';

export type ContractClauseTypographyRole =
  | 'paragraphHeading'
  | 'title'
  | 'body'
  | 'list'
  | 'subpoint';

export interface ContractClauseTextStyle {
  fontFamily: string;
  fontSizePt: number;
  fontWeight: number;
  lineHeight: number;
  spaceBeforePt: number;
  spaceAfterPt: number;
  textAlign: 'left' | 'center' | 'right' | 'justify';
}

export interface ContractClauseTypography {
  paragraphHeading: ContractClauseTextStyle;
  title: ContractClauseTextStyle;
  body: ContractClauseTextStyle;
  list: ContractClauseTextStyle;
  subpoint: ContractClauseTextStyle;
  emphasisWeight: number;
  italicEnabled: boolean;
  underlineEnabled: boolean;
}

export const CONTRACT_LINE_HEIGHT_MIN = 0.7;
export const CONTRACT_LINE_HEIGHT_MAX = 3;
export const CONTRACT_LINE_HEIGHT_STEP = 0.05;
export const CONTRACT_DEFAULT_LINE_HEIGHT = 1.6;

export const createDefaultContractClauseTypography = (
  fontFamily = 'Georgia, serif',
  lineHeight = CONTRACT_DEFAULT_LINE_HEIGHT,
): ContractClauseTypography => ({
  paragraphHeading: {
    fontFamily,
    fontSizePt: 12,
    fontWeight: 700,
    lineHeight,
    spaceBeforePt: 8,
    spaceAfterPt: 4,
    textAlign: 'center',
  },
  title: {
    fontFamily,
    fontSizePt: 12,
    fontWeight: 700,
    lineHeight,
    spaceBeforePt: 4,
    spaceAfterPt: 3,
    textAlign: 'left',
  },
  body: {
    fontFamily,
    fontSizePt: 12,
    fontWeight: 400,
    lineHeight,
    spaceBeforePt: 0,
    spaceAfterPt: 6,
    textAlign: 'justify',
  },
  list: {
    fontFamily,
    fontSizePt: 12,
    fontWeight: 400,
    lineHeight,
    spaceBeforePt: 0,
    spaceAfterPt: 3,
    textAlign: 'left',
  },
  subpoint: {
    fontFamily,
    fontSizePt: 12,
    fontWeight: 400,
    lineHeight,
    spaceBeforePt: 0,
    spaceAfterPt: 2,
    textAlign: 'left',
  },
  emphasisWeight: 700,
  italicEnabled: true,
  underlineEnabled: true,
});

export interface ContractPageSettings {
  logoScale?: number;
  logoPositionX?: number;
  logoPositionY?: number;
  lineHeight?: number;
  selectedFont?: string;
  selectedLogo?: string;
  selectedFooter?: 'default' | 'minimal' | 'none';
  selectedFooterTemplateId?: string | null;
  footerContent?: {
    companyName?: string;
    tagline?: string;
    website?: string;
    email?: string;
    phone?: string;
    logoUrl?: string;
  };
  footerLogoScale?: number;
  clauseTypography?: Partial<ContractClauseTypography>;
}

export const resolveContractClauseTypography = (
  settings: ContractPageSettings,
): ContractClauseTypography => {
  const defaults = createDefaultContractClauseTypography(
    settings.selectedFont || 'Georgia, serif',
    settings.lineHeight ?? CONTRACT_DEFAULT_LINE_HEIGHT,
  );
  const saved = settings.clauseTypography || {};
  return {
    paragraphHeading: { ...defaults.paragraphHeading, ...saved.paragraphHeading },
    title: { ...defaults.title, ...saved.title },
    body: { ...defaults.body, ...saved.body },
    list: { ...defaults.list, ...saved.list },
    subpoint: { ...defaults.subpoint, ...saved.subpoint },
    emphasisWeight: saved.emphasisWeight ?? defaults.emphasisWeight,
    italicEnabled: saved.italicEnabled ?? defaults.italicEnabled,
    underlineEnabled: saved.underlineEnabled ?? defaults.underlineEnabled,
  };
};

export interface RenderContractDocumentOptions {
  resolveParagraphNumbers?: boolean;
}

/**
 * Jedyna ścieżka przygotowania treści umowy dla edytora, podglądu i PDF.
 * Zwraca pełny profil typografii klauzul oraz strony wyliczone z tego samego HTML.
 */
export async function renderContractDocument<T extends ContractPageSettings>(
  flowContent: string,
  settings: T,
  options: RenderContractDocumentOptions = {},
) {
  const normalizedSettings = {
    ...settings,
    clauseTypography: resolveContractClauseTypography(settings),
  } as T & { clauseTypography: ContractClauseTypography };
  const normalizedFlow = normalizeContractParagraphPlaceholders(flowContent || '');
  const resolvedFlow = options.resolveParagraphNumbers === false
    ? normalizedFlow
    : resolveContractParagraphPlaceholders(normalizedFlow);
  const pages = await paginateContractHtml(resolvedFlow, normalizedSettings);

  return {
    flowContent: resolvedFlow,
    pages,
    settings: normalizedSettings,
  };
}

const absoluteLogoUrl = (url?: string) => {
  const value = url || '/erulers_logo_vect.png';
  return value.startsWith('http') ? value : `https://mavinci.pl${value}`;
};

const escapeHtml = (value = '') =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const buildContractHeaderHtml = (settings: ContractPageSettings) => {
  const x = settings.logoPositionX ?? 50;
  const justify = x <= 33 ? 'justify-start' : x >= 67 ? 'justify-end' : 'justify-center';
  const date = new Date().toLocaleDateString('pl-PL', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  return `<div class="contract-header-logo ${justify}" style="margin-top:${settings.logoPositionY ?? 0}mm"><img src="${absoluteLogoUrl(settings.selectedLogo)}" alt="Logo" style="max-width:${settings.logoScale ?? 80}%;height:auto" /></div><div class="contract-current-date">Olsztyn, ${date}</div>`;
};

export const buildContractFooterHtml = (settings: ContractPageSettings) => {
  if (settings.selectedFooter === 'none') return '';
  const footer = settings.footerContent || {};
  const companyName = footer.companyName ?? 'EVENT RULERS';
  const website = footer.website ?? 'www.eventrulers.pl';
  const email = footer.email ?? 'biuro@eventrulers.pl';
  const phone = footer.phone ?? '698-212-279';
  const contactLine = [website, email].filter(Boolean).map(escapeHtml).join(' | ');
  const footerFont = escapeHtml(settings.selectedFont || 'Georgia, serif').replace(/"/g, '&quot;');
  const logo = settings.selectedFooter !== 'minimal'
    ? `<div class="footer-logo"><img src="${absoluteLogoUrl(footer.logoUrl || settings.selectedLogo)}" alt="Logo" style="max-width:${settings.footerLogoScale ?? 80}%;height:auto" /></div>`
    : '';
  return `<div class="contract-footer" style="font-family:${footerFont}">${logo}<div class="footer-info"><p><strong>${escapeHtml(companyName)}</strong>${footer.tagline ? ` – <em>${escapeHtml(footer.tagline)}</em>` : ''}</p>${contactLine ? `<p>${contactLine}</p>` : ''}${phone ? `<p>tel: ${escapeHtml(phone)}</p>` : ''}</div></div>`;
};

const hasVisibleContent = (element: HTMLElement) =>
  Boolean(element.textContent?.trim() || element.querySelector('img, table, hr, ul, ol'));

const getTextSplitOffsets = (source: HTMLElement) => {
  const text = source.textContent || '';
  const offsets: number[] = [];
  const words = /\S+/g;
  let match = words.exec(text);

  while (match) {
    offsets.push(match.index + match[0].length);
    match = words.exec(text);
  }

  return { text, offsets };
};

const findTextPosition = (source: HTMLElement, absoluteOffset: number) => {
  const showText = source.ownerDocument.defaultView?.NodeFilter.SHOW_TEXT ?? 4;
  const walker = source.ownerDocument.createTreeWalker(source, showText);
  let remaining = absoluteOffset;
  let current = walker.nextNode() as Text | null;
  let last: Text | null = null;

  while (current) {
    last = current;
    if (remaining <= current.data.length) {
      return { node: current, offset: remaining };
    }
    remaining -= current.data.length;
    current = walker.nextNode() as Text | null;
  }

  return last ? { node: last, offset: last.data.length } : null;
};

/**
 * Klonuje wybrany fragment tekstu razem z całą otaczającą go strukturą HTML.
 * Dzięki Range nie gubimy <font>, <span>, <strong> ani ich stylów, gdy akapit
 * trzeba przeciąć między dwiema stronami.
 */
const cloneTextRangePreservingMarkup = (
  source: HTMLElement,
  startOffset: number,
  endOffset: number,
) => {
  const clone = source.cloneNode(false) as HTMLElement;
  const range = source.ownerDocument.createRange();
  range.selectNodeContents(source);

  const start = findTextPosition(source, startOffset);
  const end = findTextPosition(source, endOffset);
  if (start) range.setStart(start.node, start.offset);
  if (end) range.setEnd(end.node, end.offset);

  clone.appendChild(range.cloneContents());
  return clone;
};

/**
 * Starsze treści z contentEditable potrafią mieć na <p> domyślne 16px, mimo że
 * cały widoczny tekst wewnątrz akapitu ma np. 8pt. Ustawiamy taki sam rozmiar
 * awaryjny na bloku, aby tekst nie powiększał się po podziale strony ani po
 * uproszczeniu zagnieżdżonych znaczników przez przeglądarkę.
 */
const syncBlockFallbackFontSize = (block: HTMLElement) => {
  const showText = block.ownerDocument.defaultView?.NodeFilter.SHOW_TEXT ?? 4;
  const walker = block.ownerDocument.createTreeWalker(block, showText);
  const explicitSizes = new Set<string>();
  let textNode = walker.nextNode() as Text | null;
  let visibleTextNodes = 0;

  while (textNode) {
    if (textNode.data.trim()) {
      visibleTextNodes += 1;
      let element = textNode.parentElement;
      let explicitSize = '';
      while (element && element !== block) {
        const candidate = element.style.fontSize.trim();
        if (candidate && !['inherit', 'initial', 'unset'].includes(candidate)) {
          explicitSize = candidate;
          break;
        }
        element = element.parentElement;
      }
      if (!explicitSize) return;
      explicitSizes.add(explicitSize);
      if (explicitSizes.size > 1) return;
    }
    textNode = walker.nextNode() as Text | null;
  }

  if (visibleTextNodes > 0 && explicitSizes.size === 1) {
    block.style.fontSize = Array.from(explicitSizes)[0];
  }
};

type ContractCandidateFits = (candidate: HTMLElement) => boolean;
const CONTRACT_KEEP_WITH_NEXT_SELECTOR =
  '.contract-paragraph-heading, [data-contract-paragraph="true"], h1, h2, h3, h4, h5, h6';
const shouldKeepContractElementWithNext = (element: HTMLElement) =>
  element.matches(CONTRACT_KEEP_WITH_NEXT_SELECTOR) ||
  element.dataset.contractKeepWithNext === 'true';

const markContractListItemContinuation = (item: HTMLElement) => {
  item.dataset.contractListItemContinuation = 'true';
  delete item.dataset.contractOutlineNumber;
  item.style.setProperty('list-style-type', 'none', 'important');
};

const getContractPaginationListItems = (root: HTMLElement) => [
  ...(root.tagName === 'LI' ? [root] : []),
  ...Array.from(
    root.querySelectorAll<HTMLElement>('li[data-contract-pagination-item-id]'),
  ),
];

const markRepeatedListItemsAsContinuations = (
  first: HTMLElement,
  rest: HTMLElement,
) => {
  const firstItemIds = new Set(
    getContractPaginationListItems(first)
      .map((item) => item.dataset.contractPaginationItemId)
      .filter((itemId): itemId is string => Boolean(itemId)),
  );

  getContractPaginationListItems(rest).forEach((item) => {
    const itemId = item.dataset.contractPaginationItemId;
    if (itemId && firstItemIds.has(itemId)) {
      markContractListItemContinuation(item);
    }
  });
};

const finalizePaginatedListContinuations = (pages: string[]) => {
  const seenItemIds = new Set<string>();

  return pages.map((pageHtml) => {
    const page = document.createElement('div');
    page.innerHTML = pageHtml;

    page
      .querySelectorAll<HTMLElement>('li[data-contract-pagination-item-id]')
      .forEach((item) => {
        const itemId = item.dataset.contractPaginationItemId;
        if (!itemId) return;
        if (seenItemIds.has(itemId)) markContractListItemContinuation(item);
        seenItemIds.add(itemId);
        delete item.dataset.contractPaginationItemId;
      });

    return page.innerHTML;
  });
};

const hasTooShortListContinuation = (
  source: HTMLElement,
  continuation: HTMLElement,
) =>
  source.tagName === 'LI' &&
  (continuation.textContent?.match(/\S+/g)?.length || 0) < 3;

const splitTextElement = (
  source: HTMLElement,
  candidateFits: ContractCandidateFits,
) => {
  const { text, offsets } = getTextSplitOffsets(source);
  if (offsets.length < 2) return null;
  let low = 0;
  let high = offsets.length - 2;
  let fittingOffset = 0;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const splitOffset = offsets[middle];
    const probe = cloneTextRangePreservingMarkup(source, 0, splitOffset);
    const fits = candidateFits(probe);
    if (fits) {
      fittingOffset = splitOffset;
      low = middle + 1;
    } else high = middle - 1;
  }
  if (!fittingOffset) return null;

  let restOffset = fittingOffset;
  while (restOffset < text.length && /\s/.test(text[restOffset])) restOffset += 1;

  const first = cloneTextRangePreservingMarkup(source, 0, fittingOffset);
  const rest = cloneTextRangePreservingMarkup(source, restOffset, text.length);
  if (!hasVisibleContent(first) || !hasVisibleContent(rest)) return null;
  return [first, rest] as const;
};

type ContractListElement = HTMLOListElement | HTMLUListElement;

/**
 * Dzieli pierwszy, zbyt długi punkt listy bez wyjmowania tekstu z <li>.
 * Zachowanie pełnej struktury listy jest istotne dla fontu, wcięcia i licznika.
 */
const splitFirstListItem = (
  list: ContractListElement,
  candidateFits: ContractCandidateFits,
) => {
  const items = Array.from(list.children).filter(
    (child): child is HTMLLIElement => child.tagName === 'LI',
  );
  const sourceItem = items[0];
  if (!sourceItem) return null;

  const { text, offsets } = getTextSplitOffsets(sourceItem);
  if (offsets.length < 2) return null;

  let low = 0;
  let high = offsets.length - 2;
  let fittingOffset = 0;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const splitOffset = offsets[middle];
    const probeList = list.cloneNode(false) as ContractListElement;
    probeList.appendChild(
      cloneTextRangePreservingMarkup(sourceItem, 0, splitOffset) as HTMLLIElement,
    );
    if (candidateFits(probeList)) {
      fittingOffset = splitOffset;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  if (!fittingOffset) return null;
  let restOffset = fittingOffset;
  while (restOffset < text.length && /\s/.test(text[restOffset])) restOffset += 1;

  const firstList = list.cloneNode(false) as ContractListElement;
  const firstItem = cloneTextRangePreservingMarkup(
    sourceItem,
    0,
    fittingOffset,
  ) as HTMLLIElement;
  firstList.appendChild(firstItem);

  const restList = list.cloneNode(false) as ContractListElement;
  const restItem = cloneTextRangePreservingMarkup(
    sourceItem,
    restOffset,
    text.length,
  ) as HTMLLIElement;
  if (!hasVisibleContent(firstItem) || !hasVisibleContent(restItem)) return null;
  if (hasTooShortListContinuation(sourceItem, restItem)) return null;
  markContractListItemContinuation(restItem);
  restList.appendChild(restItem);
  items.slice(1).forEach((item) => restList.appendChild(item.cloneNode(true)));

  if (list.tagName === 'OL') {
    const sourceStart = Number(list.getAttribute('start') || 1);
    firstList.setAttribute('start', String(sourceStart));
    restList.setAttribute('start', String(sourceStart));
  }

  return [firstList, restList] as const;
};

const splitElementByChildren = (
  source: HTMLElement,
  candidateFits: ContractCandidateFits,
  allowListItemSplit = true,
) => {
  if (source.tagName === 'TABLE') {
    const rows = Array.from(source.querySelectorAll('tbody > tr'));
    if (rows.length > 1) {
      const createTable = () => {
        const table = source.cloneNode(false) as HTMLTableElement;
        const head = source.querySelector('thead');
        if (head) table.appendChild(head.cloneNode(true));
        const body = document.createElement('tbody');
        table.appendChild(body);
        return { table, body };
      };
      const first = createTable();
      let accepted = 0;
      for (const row of rows) {
        first.body.appendChild(row.cloneNode(true));
        const fits = candidateFits(first.table);
        if (!fits) {
          first.body.lastChild?.remove();
          break;
        }
        accepted += 1;
      }
      if (accepted > 0 && accepted < rows.length) {
        const rest = createTable();
        rows.slice(accepted).forEach((row) => rest.body.appendChild(row.cloneNode(true)));
        return [first.table, rest.table] as const;
      }
    }
  }

  if (source.matches('ol, ul')) {
    const list = source as HTMLOListElement | HTMLUListElement;
    const items = Array.from(list.children).filter(
      (child): child is HTMLLIElement => child.tagName === 'LI',
    );

    // Długi pojedynczy punkt bez podpunktów dzielimy wewnątrz <li>. Jeżeli
    // zawiera zagnieżdżoną listę (np. cały punkt 2 z elementami 2.1–2.15),
    // musimy zejść niżej rekurencyjnie. Tekstowe przecięcie nadrzędnego <li>
    // usuwało na kolejnej stronie jeden poziom wcięcia.
    const onlyItemHasNestedList = Boolean(
      items[0]?.querySelector(':scope > ol, :scope > ul'),
    );
    if (items.length === 1 && !onlyItemHasNestedList) {
      if (!allowListItemSplit) return null;
      return splitFirstListItem(list, candidateFits);
    }
  }

  const children = Array.from(source.childNodes);
  if (children.length === 1 && children[0] instanceof HTMLElement) {
    const nestedSource = children[0];
    // Schodzimy rekurencyjnie do jedynego bloku potomnego. Pozwala to przeciąć
    // akapit wewnątrz opakowującego <div>, a listę nadal dzielić jako <ol>/<li>,
    // bez spłaszczania jej przez tekstowy Range.
    const nestedSplit = splitElementByChildren(
      nestedSource,
      (candidate) => {
        const probeOuter = source.cloneNode(false) as HTMLElement;
        probeOuter.appendChild(candidate);
        return candidateFits(probeOuter);
      },
      allowListItemSplit,
    );
    if (nestedSplit) {
      const splitFirstOuter = source.cloneNode(false) as HTMLElement;
      splitFirstOuter.appendChild(nestedSplit[0]);
      const splitRestOuter = source.cloneNode(false) as HTMLElement;
      splitRestOuter.appendChild(nestedSplit[1]);
      if (hasTooShortListContinuation(source, splitRestOuter)) return null;
      return [splitFirstOuter, splitRestOuter] as const;
    }
  }
  if (children.length < 2) {
    const split = splitTextElement(source, candidateFits);
    if (split && hasTooShortListContinuation(source, split[1])) return null;
    return split;
  }
  const first = source.cloneNode(false) as HTMLElement;
  let accepted = 0;
  for (const child of children) {
    first.appendChild(child.cloneNode(true));
    const fits = candidateFits(first);
    if (!fits) {
      first.lastChild?.remove();
      break;
    }
    accepted += 1;
  }
  if (!accepted) {
    if (source.matches('ol, ul')) {
      if (!allowListItemSplit) return null;
      return splitFirstListItem(source as ContractListElement, candidateFits);
    }
    return splitTextElement(source, candidateFits);
  }
  if (accepted >= children.length) return splitTextElement(source, candidateFits);

  // Jeżeli w kontenerze zmieściły się całe wcześniejsze akapity, próbujemy
  // wykorzystać pozostałe miejsce na początek kolejnego akapitu lub punktu.
  // Dzięki temu opakowujący <div> nie wymusza przenoszenia całego dużego bloku.
  const overflowingChild = children[accepted];
  const childMustStayWhole =
    overflowingChild instanceof HTMLElement &&
    shouldKeepContractElementWithNext(overflowingChild);
  if (overflowingChild instanceof HTMLElement && !childMustStayWhole) {
    const splitOverflowingChild = splitElementByChildren(
      overflowingChild,
      (candidate) => {
        const probe = first.cloneNode(true) as HTMLElement;
        probe.appendChild(candidate);
        return candidateFits(probe);
      },
      allowListItemSplit,
    );
    if (
      splitOverflowingChild &&
      !hasTooShortListContinuation(overflowingChild, splitOverflowingChild[1])
    ) {
      first.appendChild(splitOverflowingChild[0]);
      const rest = source.cloneNode(false) as HTMLElement;
      const continuedChild = splitOverflowingChild[1];
      if (overflowingChild.tagName === 'LI') {
        markContractListItemContinuation(continuedChild);
      }
      rest.appendChild(continuedChild);
      children
        .slice(accepted + 1)
        .forEach((child) => rest.appendChild(child.cloneNode(true)));
      if (source.tagName === 'OL') {
        const sourceStart = Number(source.getAttribute('start') || 1);
        rest.setAttribute('start', String(sourceStart + accepted));
      }
      return [first, rest] as const;
    }
  }

  const lastAcceptedChild = children[accepted - 1];
  if (
    lastAcceptedChild instanceof HTMLElement &&
    shouldKeepContractElementWithNext(lastAcceptedChild)
  ) {
    first.lastChild?.remove();
    if (!hasVisibleContent(first)) return null;
    const rest = source.cloneNode(false) as HTMLElement;
    children
      .slice(accepted - 1)
      .forEach((child) => rest.appendChild(child.cloneNode(true)));
    return [first, rest] as const;
  }
  const rest = source.cloneNode(false) as HTMLElement;
  children.slice(accepted).forEach((child) => rest.appendChild(child.cloneNode(true)));
  if (source.tagName === 'OL') {
    const sourceStart = Number(source.getAttribute('start') || 1);
    const acceptedListItems = Array.from(first.children).filter(
      (child) => child.tagName === 'LI',
    ).length;
    rest.setAttribute('start', String(sourceStart + acceptedListItems));
  }
  return [first, rest] as const;
};

const getContractListDepth = (
  item: HTMLElement,
  boundary: HTMLElement | null,
) => {
  let depth = 0;
  let parent = item.parentElement;
  while (parent && parent !== boundary) {
    if (parent.matches('ol, ul')) depth += 1;
    parent = parent.parentElement;
  }
  return depth;
};

/**
 * Wszystkie numerowane punkty zapamiętują swoją pierwotną głębokość listy.
 * Podczas dzielenia dużego <li> przeglądarka otrzymuje klon dalszej części
 * dokumentu i w skrajnym przypadku znika z niego jeden z pustych elementów
 * nadrzędnych. Numer zapisany w data-contract-outline-number pozostawał wtedy
 * poprawny (np. 4.2), ale ręczny podpunkt wizualnie przesuwał się poziom wyżej.
 * Korekta obejmuje zarówno tekst szablonu, jak i klauzule automatyczne.
 */
const preserveContractListIndent = (
  root: HTMLElement,
  boundary: HTMLElement | null,
) => {
  const numberedItems = [
    ...(root.matches('li[data-contract-source-list-depth]') ? [root] : []),
    ...Array.from(
      root.querySelectorAll<HTMLElement>('li[data-contract-source-list-depth]'),
    ),
  ];

  numberedItems.forEach((item) => {
    const expectedDepth = Number(item.dataset.contractSourceListDepth || 0);
    if (!expectedDepth) return;

    const actualDepth = getContractListDepth(item, boundary);
    const missingDepth = Math.max(0, expectedDepth - actualDepth);
    if (!item.hasAttribute('data-contract-pagination-base-margin')) {
      item.dataset.contractPaginationBaseMargin = item.style.marginLeft || '0px';
    }
    const baseMargin = item.dataset.contractPaginationBaseMargin || '0px';

    if (missingDepth > 0) {
      item.style.setProperty(
        'margin-left',
        `calc(${baseMargin} + ${missingDepth * 12.7}mm)`,
        'important',
      );
      item.dataset.contractPaginationMissingDepth = String(missingDepth);
      return;
    }

    if (item.dataset.contractPaginationMissingDepth) {
      item.style.setProperty('margin-left', baseMargin, 'important');
      delete item.dataset.contractPaginationMissingDepth;
    }
  });
};

/**
 * Dzieli ciągły HTML według faktycznej wysokości A4 w przeglądarce. Nagłówek
 * zmniejsza miejsce wyłącznie na pierwszej stronie, a stopka rezerwuje je na każdej.
 */
export async function paginateContractHtml(
  html: string,
  settings: ContractPageSettings,
): Promise<string[]> {
  if (typeof document === 'undefined') return [html];
  await document.fonts?.ready;

  // Wysokość nagłówka i stopki zależy od faktycznych wymiarów obrazów.
  // Bez preloadu pierwsze liczenie stron mogło odbyć się, gdy logo miało 0 px wysokości.
  const logoUrls = [
    settings.selectedLogo,
    settings.footerContent?.logoUrl || settings.selectedLogo,
  ]
    .filter(Boolean)
    .map((url) => absoluteLogoUrl(url));
  await Promise.all(
    Array.from(new Set(logoUrls)).map(
      (url) =>
        new Promise<void>((resolve) => {
          const image = new Image();
          image.onload = () => resolve();
          image.onerror = () => resolve();
          image.src = url;
          if (image.complete) resolve();
        }),
    ),
  );

  const parser = document.createElement('div');
  parser.innerHTML = html;
  // Style fontów należą do <head> dokumentu PDF. Starsze wersje generatora
  // zapisywały je w treści umowy, a reguła `.contract-content > *` powodowała,
  // że Chromium drukował tekst `@font-face` jak zwykły akapit.
  parser
    .querySelectorAll('style, script, link[rel="stylesheet"], meta')
    .forEach((element) => element.remove());

  parser
    .querySelectorAll<HTMLElement>('p, pre, li')
    .forEach(syncBlockFallbackFontSize);

  // Klauzule pochodzą z osobnego edytora. Jego dekoracje nie mogą wpływać na
  // umowę: usuwamy je i nakładamy wyłącznie profil typografii zapisany w szablonie.
  const clauseTypography = resolveContractClauseTypography(settings);
  const applyClauseTextStyle = (element: HTMLElement, style: ContractClauseTextStyle) => {
    element.style.setProperty('font-family', style.fontFamily, 'important');
    element.style.setProperty('font-size', `${style.fontSizePt}pt`, 'important');
    element.style.setProperty('font-weight', String(style.fontWeight), 'important');
    element.style.setProperty('line-height', String(style.lineHeight), 'important');
    element.style.setProperty('margin-top', `${style.spaceBeforePt}pt`, 'important');
    element.style.setProperty('margin-bottom', `${style.spaceAfterPt}pt`, 'important');
    element.style.setProperty('text-align', style.textAlign, 'important');
    element.style.setProperty('color', 'inherit', 'important');
  };
  const applyInlineInheritance = (element: HTMLElement) => {
    element.style.setProperty('font-family', 'inherit', 'important');
    element.style.setProperty('font-size', 'inherit', 'important');
    element.style.setProperty('line-height', 'inherit', 'important');
    element.style.setProperty('color', 'inherit', 'important');
  };

  parser.querySelectorAll<HTMLElement>('.product-contract-clause').forEach((clause) => {
    // Normalizacja jest wykonywana również tutaj, aby stare snapshoty umów oraz
    // klauzule zapisane przed wprowadzeniem modelu semantycznego drukowały się tak samo.
    clause.innerHTML = normalizeContractClausePointListHtml(
      stripProductNameHeadingFromClauseHtml(
        normalizeContractClauseHtml(clause.innerHTML),
        clause.dataset.productName,
      ),
    );
    [clause, ...Array.from(clause.querySelectorAll<HTMLElement>('*'))].forEach((element) => {
      const originalClasses = Array.from(element.classList);
      const indentClass = originalClasses.find((className) => /^ql-indent-\d+$/i.test(className));
      const indentLevel = Number(element.dataset.clauseIndent || 0) ||
        (indentClass ? Number(indentClass.split('-').pop()) || 0 : 0);
      const explicitAlignment = element.dataset.clauseAlign;
      const isParagraphHeading =
        element.classList.contains('contract-paragraph-heading') ||
        element.dataset.contractParagraph === 'true' ||
        element.dataset.clauseRole === 'paragraphHeading';
      const isTitle = /^H[1-6]$/.test(element.tagName) || element.dataset.clauseRole === 'title';
      const isListItem = element.tagName === 'LI';
      const isNestedListItem = isListItem && Boolean(element.parentElement?.closest('li'));
      const isSubpoint = isNestedListItem || indentLevel > 0 || element.dataset.clauseRole === 'subpoint';
      const isListContainer = element.tagName === 'OL' || element.tagName === 'UL';
      const isInline = ['SPAN', 'FONT', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'DEL'].includes(
        element.tagName,
      );

      element.removeAttribute('face');
      element.removeAttribute('size');
      element.removeAttribute('style');
      if (element === clause) element.className = 'product-contract-clause';
      else if (isParagraphHeading) element.className = 'contract-paragraph-heading';
      else element.removeAttribute('class');

      if (isInline) applyInlineInheritance(element);
      else if (isParagraphHeading) applyClauseTextStyle(element, clauseTypography.paragraphHeading);
      else if (isTitle) applyClauseTextStyle(element, clauseTypography.title);
      else if (isSubpoint) applyClauseTextStyle(element, clauseTypography.subpoint);
      else if (isListItem || isListContainer) applyClauseTextStyle(element, clauseTypography.list);
      else applyClauseTextStyle(element, clauseTypography.body);

      // Kontener klauzuli i kontenery list nie są osobnymi wierszami treści.
      // Zerujemy ich marginesy, aby odstępy akapitów i punktów się nie sumowały.
      if (element === clause || isListContainer) {
        element.style.setProperty('margin-top', '0', 'important');
        element.style.setProperty('margin-bottom', '0', 'important');
      }

      if (indentLevel > 0) {
        element.style.setProperty('margin-left', `${indentLevel * 12.7}mm`, 'important');
      }
      if (['left', 'center', 'right', 'justify'].includes(explicitAlignment || '')) {
        element.style.setProperty('text-align', explicitAlignment!, 'important');
      }
      if (element.tagName === 'STRONG' || element.tagName === 'B') {
        element.style.setProperty('font-weight', String(clauseTypography.emphasisWeight), 'important');
      }
      if (element.tagName === 'EM' || element.tagName === 'I') {
        element.style.setProperty(
          'font-style',
          clauseTypography.italicEnabled ? 'italic' : 'normal',
          'important',
        );
      }
      if (element.tagName === 'U') {
        element.style.setProperty(
          'text-decoration',
          clauseTypography.underlineEnabled ? 'underline' : 'none',
          'important',
        );
      }
    });
  });

  // Gdy slot klauzul został ustawiony Tabem jako kolejny podpunkt (np. 2.3),
  // wygenerowane klauzule nie mogą utworzyć listy wewnątrz pustego punktu-slotu.
  // Zastępujemy sam punkt jego elementami, aby kontynuowały listę jako
  // 2.3, 2.4, 2.5 zamiast tworzyć układ 2.3 -> 1., 1., 1.
  Array.from(parser.querySelectorAll<HTMLLIElement>('li')).forEach((placeholderItem) => {
    const ownerList = placeholderItem.parentElement;
    if (ownerList?.tagName !== 'OL') return;

    const clauseContainers = Array.from(
      placeholderItem.querySelectorAll<HTMLElement>('.product-contract-clause'),
    ).filter((clause) => clause.closest('li') === placeholderItem);
    if (clauseContainers.length === 0) return;

    const itemWithoutClauses = placeholderItem.cloneNode(true) as HTMLLIElement;
    itemWithoutClauses
      .querySelectorAll(
        '[data-contract-clause-slot], .contract-product-clauses, .product-contract-clause',
      )
      .forEach((node) => node.remove());
    const hasContentOutsideClauses = Boolean(
      itemWithoutClauses.textContent?.trim() ||
        itemWithoutClauses.querySelector('img, table, hr'),
    );
    if (hasContentOutsideClauses) return;

    const clauseLists = clauseContainers.flatMap((clause) => {
      const directLists = Array.from(clause.children).filter(
        (child): child is HTMLOListElement => child.tagName === 'OL',
      );
      if (directLists.length > 0) return directLists;

      return Array.from(clause.querySelectorAll<HTMLOListElement>('ol')).filter(
        (list) => !list.parentElement?.closest('ol, ul'),
      );
    });
    const generatedItems = clauseLists.flatMap((list) =>
      Array.from(list.children).filter(
        (child): child is HTMLLIElement => child.tagName === 'LI',
      ),
    );
    if (generatedItems.length === 0) return;

    generatedItems.forEach((item) => {
      item.dataset.contractGeneratedClause = 'true';
      placeholderItem.before(item);
    });
    placeholderItem.remove();
  });

  // Po spłaszczeniu odbudowujemy numery całej hierarchii. Dzięki temu nowe
  // elementy przejmują prefiks i kolejność listy, w której znajdował się slot.
  normalizeContractListStructureInElement(parser);
  resolveContractClausePointNumbersInElement(parser);
  parser
    .querySelectorAll<HTMLElement>('li[data-contract-outline-number]')
    .forEach((item) => {
      item.dataset.contractSourceListDepth = String(getContractListDepth(item, parser));
    });
  parser.querySelectorAll<HTMLElement>('li').forEach((item, index) => {
    item.dataset.contractPaginationItemId = String(index + 1);
  });

  parser.querySelectorAll('.contract-product-clauses').forEach((section) => {
    section.replaceWith(...Array.from(section.childNodes));
  });
  // W gotowym dokumencie obszar placeholdera nie może pozostać dodatkowym
  // kontenerem wokół klauzul. Przy podziale strony jego styl akapitu był
  // kopiowany na pierwszy fragment listy, przez co tylko pierwszy wiersz
  // otrzymywał większy font. Puste sloty w edytorze pozostają bez zmian.
  parser.querySelectorAll<HTMLElement>('[data-contract-clause-slot]').forEach((slot) => {
    if (slot.querySelector('.product-contract-clause')) {
      const indentLevel = getContractClauseSlotIndentLevel(slot);
      if (indentLevel > 0) {
        slot.querySelectorAll<HTMLElement>('.product-contract-clause').forEach((clause) => {
          clause.dataset.contractClauseIndent = String(indentLevel);
          clause.style.setProperty('margin-left', `${indentLevel * 12.7}mm`, 'important');
        });
      }
      slot.replaceWith(...Array.from(slot.childNodes));
    }
  });
  const queue = Array.from(parser.childNodes).map((node) => node.cloneNode(true));
  if (!queue.length) return [''];

  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  Object.assign(host.style, {
    position: 'fixed', left: '-10000px', top: '0', width: '210mm',
    visibility: 'hidden', pointerEvents: 'none', zIndex: '-1',
  });
  document.body.appendChild(host);

  const result: string[] = [];
  const isVisibleQueueNode = (node: Node) =>
    Boolean(
      node.textContent?.trim() ||
        (node instanceof HTMLElement && node.querySelector('img, table, hr, ul, ol')),
    );

  // Nagłówek paragrafu musi zmieścić się przynajmniej z pierwszą linią treści.
  // Pozostałą część akapitu lub listy można już swobodnie przenieść dalej.
  const hasRoomForNextLines = (content: HTMLElement, nextNode: Node) => {
    const probe = nextNode.cloneNode(true);
    content.appendChild(probe);

    if (!(probe instanceof HTMLElement)) {
      const fits = content.scrollHeight <= content.clientHeight + 1;
      probe.remove();
      return fits;
    }

    const contentBottom = content.getBoundingClientRect().bottom;
    const probeRect = probe.getBoundingClientRect();
    const computed = window.getComputedStyle(probe);
    const fontSize = Number.parseFloat(computed.fontSize) || 16;
    const parsedLineHeight = Number.parseFloat(computed.lineHeight);
    const lineHeight = Number.isFinite(parsedLineHeight) ? parsedLineHeight : fontSize * 1.2;
    const visibleHeight = Math.max(probeRect.height, probe.scrollHeight, lineHeight);
    const requiredHeight = Math.min(visibleHeight, lineHeight);
    const fits = probeRect.top + requiredHeight <= contentBottom + 1;
    probe.remove();
    return fits;
  };

  const contentFits = (content: HTMLElement) => {
    const contentBottom = content.getBoundingClientRect().bottom;
    const lastElementBottom = content.lastElementChild?.getBoundingClientRect().bottom;
    return (
      content.scrollHeight <= content.clientHeight + 1 &&
      (lastElementBottom === undefined || lastElementBottom <= contentBottom + 1)
    );
  };

  const createPage = (firstPage: boolean) => {
    const page = document.createElement('div');
    page.className = 'contract-a4-page';
    page.style.height = '297mm';
    page.style.minHeight = '297mm';
    page.style.overflow = 'hidden';
    page.style.margin = '0';
    if (firstPage) page.insertAdjacentHTML('beforeend', buildContractHeaderHtml(settings));
    const content = document.createElement('div');
    content.className = 'contract-content';
    content.style.lineHeight = String(settings.lineHeight ?? CONTRACT_DEFAULT_LINE_HEIGHT);
    content.style.fontFamily = settings.selectedFont || 'Georgia, serif';
    content.style.minHeight = '0';
    content.style.flex = '1 1 0';
    content.style.overflow = 'hidden';
    content.style.boxSizing = 'border-box';
    // Pomiar pozostawia większy zapas niż sam widok. Chroni to tekst przed
    // różnicą kilku pikseli między ukrytym pomiarem a finalnym renderem stopki.
    content.style.paddingBottom = '5mm';
    page.appendChild(content);
    page.insertAdjacentHTML('beforeend', buildContractFooterHtml(settings));
    host.appendChild(page);
    return { page, content };
  };

  try {
    let measurement = createPage(true);
    while (queue.length) {
      const node = queue.shift()!;
      if (node instanceof HTMLElement && node.dataset.contractPageBreak === 'true') {
        if (hasVisibleContent(measurement.content)) result.push(measurement.content.innerHTML);
        measurement.page.remove();
        measurement = createPage(false);
        continue;
      }

      const pageAlreadyHasContent = hasVisibleContent(measurement.content);
      measurement.content.appendChild(node);
      if (node instanceof HTMLElement) {
        preserveContractListIndent(node, measurement.content);
      }

      if (
        node instanceof HTMLElement &&
        shouldKeepContractElementWithNext(node) &&
        pageAlreadyHasContent
      ) {
        const nextVisibleNode = queue.find(isVisibleQueueNode);
        const nextIsManualBreak =
          nextVisibleNode instanceof HTMLElement &&
          nextVisibleNode.dataset.contractPageBreak === 'true';

        if (
          nextVisibleNode &&
          !nextIsManualBreak &&
          !hasRoomForNextLines(measurement.content, nextVisibleNode)
        ) {
          node.remove();
          result.push(measurement.content.innerHTML);
          measurement.page.remove();
          measurement = createPage(false);
          queue.unshift(node);
          continue;
        }
      }

      if (contentFits(measurement.content)) continue;
      node.remove();

      if (node instanceof HTMLElement) {
        const split = splitElementByChildren(
          node,
          (candidate) => {
            measurement.content.appendChild(candidate);
            preserveContractListIndent(candidate, measurement.content);
            const fits = contentFits(measurement.content);
            candidate.remove();
            return fits;
          },
        );
        if (split) {
          markRepeatedListItemsAsContinuations(split[0], split[1]);
          measurement.content.appendChild(split[0]);
          preserveContractListIndent(split[0], measurement.content);
          result.push(measurement.content.innerHTML);
          measurement.page.remove();
          measurement = createPage(false);
          queue.unshift(split[1]);
          continue;
        }
      }

      if (hasVisibleContent(measurement.content)) {
        result.push(measurement.content.innerHTML);
        measurement.page.remove();
        measurement = createPage(false);
        queue.unshift(node);
        continue;
      }

      // Element niepodzielny większy od strony (np. obraz): zachowujemy go,
      // zamiast bez końca próbować przenosić na kolejną kartkę.
      measurement.content.appendChild(node);
      result.push(measurement.content.innerHTML);
      measurement.page.remove();
      measurement = createPage(false);
    }
    if (hasVisibleContent(measurement.content) || result.length === 0) {
      result.push(measurement.content.innerHTML);
    }
    return finalizePaginatedListContinuations(result);
  } finally {
    host.remove();
  }
}
