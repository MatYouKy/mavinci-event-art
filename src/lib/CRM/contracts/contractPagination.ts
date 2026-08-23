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
  const logo = settings.selectedFooter !== 'minimal'
    ? `<div class="footer-logo"><img src="${absoluteLogoUrl(footer.logoUrl || settings.selectedLogo)}" alt="Logo" style="max-width:${settings.footerLogoScale ?? 80}%;height:auto" /></div>`
    : '';
  return `<div class="contract-footer">${logo}<div class="footer-info"><p><strong>${escapeHtml(footer.companyName || 'EVENT RULERS')}</strong>${footer.tagline ? ` – <em>${escapeHtml(footer.tagline)}</em>` : ''}</p><p>${escapeHtml(footer.website || 'www.eventrulers.pl')} | ${escapeHtml(footer.email || 'biuro@eventrulers.pl')}</p><p>tel: ${escapeHtml(footer.phone || '698-212-279')}</p></div></div>`;
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

  const parser = document.createElement('div');
  parser.innerHTML = html;
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

      measurement.content.appendChild(node);
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
