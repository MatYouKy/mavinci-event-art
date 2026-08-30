import { normalizeContractClauseHtml } from './contractClauseContent';
import {
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

export const createDefaultContractClauseTypography = (
  fontFamily = 'Georgia, serif',
  lineHeight = 1.6,
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
    settings.lineHeight ?? 1.6,
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

const splitTextElement = (source: HTMLElement, content: HTMLElement) => {
  const words = (source.textContent || '').split(/(\s+)/).filter(Boolean);
  if (words.length < 2) return null;
  let low = 1;
  let high = words.length;
  let fitting = 0;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const probe = source.cloneNode(false) as HTMLElement;
    probe.textContent = words.slice(0, middle).join('');
    content.appendChild(probe);
    const fits = content.scrollHeight <= content.clientHeight + 1;
    probe.remove();
    if (fits) {
      fitting = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  if (!fitting || fitting >= words.length) return null;
  const first = source.cloneNode(false) as HTMLElement;
  first.textContent = words.slice(0, fitting).join('');
  const rest = source.cloneNode(false) as HTMLElement;
  rest.textContent = words.slice(fitting).join('').trimStart();
  return [first, rest] as const;
};

const splitElementByChildren = (source: HTMLElement, content: HTMLElement) => {
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
        content.appendChild(first.table);
        const fits = content.scrollHeight <= content.clientHeight + 1;
        first.table.remove();
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

  const children = Array.from(source.childNodes);
  if (children.length === 1 && children[0] instanceof HTMLElement) {
    const nestedSource = children[0];
    const nestedChildren = Array.from(nestedSource.childNodes);
    if (nestedChildren.length > 1) {
      const firstOuter = source.cloneNode(false) as HTMLElement;
      const firstNested = nestedSource.cloneNode(false) as HTMLElement;
      firstOuter.appendChild(firstNested);
      let acceptedNested = 0;
      for (const child of nestedChildren) {
        firstNested.appendChild(child.cloneNode(true));
        content.appendChild(firstOuter);
        const fits = content.scrollHeight <= content.clientHeight + 1;
        firstOuter.remove();
        if (!fits) {
          firstNested.lastChild?.remove();
          break;
        }
        acceptedNested += 1;
      }
      if (acceptedNested > 0 && acceptedNested < nestedChildren.length) {
        const restOuter = source.cloneNode(false) as HTMLElement;
        const restNested = nestedSource.cloneNode(false) as HTMLElement;
        nestedChildren
          .slice(acceptedNested)
          .forEach((child) => restNested.appendChild(child.cloneNode(true)));
        restOuter.appendChild(restNested);
        return [firstOuter, restOuter] as const;
      }
    }
  }
  if (children.length < 2) return splitTextElement(source, content);
  const first = source.cloneNode(false) as HTMLElement;
  let accepted = 0;
  for (const child of children) {
    first.appendChild(child.cloneNode(true));
    content.appendChild(first);
    const fits = content.scrollHeight <= content.clientHeight + 1;
    first.remove();
    if (!fits) {
      first.lastChild?.remove();
      break;
    }
    accepted += 1;
  }
  if (!accepted || accepted >= children.length) return splitTextElement(source, content);
  if (
    accepted === 1 &&
    first.firstElementChild?.classList.contains('contract-paragraph-heading')
  ) {
    return null;
  }
  const rest = source.cloneNode(false) as HTMLElement;
  children.slice(accepted).forEach((child) => rest.appendChild(child.cloneNode(true)));
  return [first, rest] as const;
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
    clause.innerHTML = normalizeContractClauseHtml(clause.innerHTML);
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
        element.style.setProperty('margin-left', `${indentLevel * 1.5}em`, 'important');
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

  parser.querySelectorAll('.contract-product-clauses').forEach((section) => {
    section.replaceWith(...Array.from(section.childNodes));
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

  const shouldKeepWithNext = (element: HTMLElement) =>
    element.matches(
      '.contract-paragraph-heading, [data-contract-paragraph="true"], h1, h2, h3, h4, h5, h6',
    ) || element.dataset.contractKeepWithNext === 'true';

  // Nagłówek paragrafu musi zmieścić się razem z początkiem jego treści.
  // Wymagamy miejsca na maksymalnie dwie pierwsze linie następnego bloku,
  // zamiast wymagać, aby cały (czasem bardzo długi) akapit zmieścił się na stronie.
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
    const requiredHeight = Math.min(visibleHeight, lineHeight * 2);
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
    content.style.lineHeight = String(settings.lineHeight ?? 1.6);
    content.style.fontFamily = settings.selectedFont || 'Georgia, serif';
    content.style.minHeight = '0';
    content.style.flex = '1 1 0';
    content.style.overflow = 'hidden';
    content.style.boxSizing = 'border-box';
    content.style.paddingBottom = '2mm';
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

      if (node instanceof HTMLElement && shouldKeepWithNext(node) && pageAlreadyHasContent) {
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
        const split = splitElementByChildren(node, measurement.content);
        if (split) {
          measurement.content.appendChild(split[0]);
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
    return result;
  } finally {
    host.remove();
  }
}
