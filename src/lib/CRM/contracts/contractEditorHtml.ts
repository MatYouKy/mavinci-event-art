import { CONTRACT_STYLE_ATTRIBUTE } from './contractDocumentStyles';

/**
 * Most między zapisanym HTML szablonu umowy a edytorem (TipTap / ProseMirror).
 *
 * Edytor zna tylko akapity (ze stylem `data-style`), listy, tabele, obrazki i miejsca na klauzule. Zapisany szablon
 * ma też formy historyczne: tekst wprost w punkcie listy, linię nagłówka sekcji jako `<span>`, akapity jako `<div>`,
 * tytuł jako `<h1>`. `prepareContractHtmlForEditor` zamienia je na formę edytora bez utraty atrybutów (warunki,
 * klauzule wspólne, numery paragrafów), a `finalizeContractEditorHtml` przywraca formę, na której działa podział na
 * strony i PDF — dzięki temu umowa po zapisie w edytorze wygląda i dzieli się na strony tak samo jak przed nim.
 */

const BLOCK_SELECTOR = 'p, div, ol, ul, table, h1, h2, h3, h4, h5, h6, pre, blockquote, img, hr';
const INLINE_BREAKERS = new Set(['P', 'DIV', 'OL', 'UL', 'TABLE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE', 'BLOCKQUOTE', 'IMG', 'HR']);
const KEEP_WITH_NEXT = 'data-contract-keep-with-next';
const CLAUSE_SLOT = 'data-contract-clause-slot';

const isBlank = (node: Node) => node.nodeType === Node.TEXT_NODE && !(node.textContent || '').trim();
const isClauseSlot = (element: Element) => element.hasAttribute(CLAUSE_SLOT) || element.classList.contains('product-contract-clause');

const copyAttributes = (from: Element, to: Element, skip: string[] = []) => {
  Array.from(from.attributes).forEach((attribute) => {
    if (!skip.includes(attribute.name)) to.setAttribute(attribute.name, attribute.value);
  });
};

const rename = (element: Element, tag: string, skip: string[] = []) => {
  const next = element.ownerDocument.createElement(tag);
  copyAttributes(element, next, skip);
  while (element.firstChild) next.appendChild(element.firstChild);
  element.replaceWith(next);
  return next;
};

/** Ciągi treści w wierszu (tekst, `<strong>`, `<span>`…) wewnątrz punktu/komórki zamienia na osobne akapity. */
const wrapInlineRuns = (container: Element) => {
  const doc = container.ownerDocument;
  let run: Node[] = [];
  const flush = (before: Node | null) => {
    const meaningful = run.some((node) => !isBlank(node));
    if (meaningful) {
      const paragraph = doc.createElement('p');
      // Linia nagłówka sekcji (`<span data-contract-keep-with-next>`) zostaje znacznikiem akapitu.
      const only = run.filter((node) => !isBlank(node));
      if (only.length === 1 && only[0].nodeType === Node.ELEMENT_NODE && (only[0] as Element).hasAttribute(KEEP_WITH_NEXT)) {
        const span = only[0] as Element;
        paragraph.setAttribute(KEEP_WITH_NEXT, 'true');
        while (span.firstChild) paragraph.appendChild(span.firstChild);
        run.forEach((node) => node.parentNode?.removeChild(node));
      } else run.forEach((node) => paragraph.appendChild(node));
      container.insertBefore(paragraph, before);
    } else run.forEach((node) => node.parentNode?.removeChild(node));
    run = [];
  };
  Array.from(container.childNodes).forEach((node) => {
    if (node.nodeType === Node.ELEMENT_NODE && INLINE_BREAKERS.has((node as Element).tagName)) flush(node);
    else if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.ELEMENT_NODE) run.push(node);
    else node.parentNode?.removeChild(node);
  });
  flush(null);
};

const hasBlockChild = (element: Element) => Array.from(element.children).some((child) => child.matches(BLOCK_SELECTOR));

/** Zapisany HTML szablonu → treść dla edytora. */
export const prepareContractHtmlForEditor = (html: string): string => {
  const container = document.createElement('div');
  container.innerHTML = html || '';
  container.querySelectorAll('style, script, meta, link').forEach((element) => element.remove());

  // Tytuł i nagłówki jako akapity ze stylem — w edytorze styl wybiera się jak w Wordzie, nie znacznikiem.
  container.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((heading) => {
    const fallback = heading.tagName === 'H1' ? 'title' : 'heading';
    const paragraph = rename(heading, 'p');
    if (!paragraph.getAttribute(CONTRACT_STYLE_ATTRIBUTE)) paragraph.setAttribute(CONTRACT_STYLE_ATTRIBUTE, fallback);
  });
  container.querySelectorAll('pre').forEach((pre) => rename(pre, 'p'));

  // `<div>` jako akapit (stare szablony) → `<p>`; kontener bez atrybutów → rozwinięty.
  Array.from(container.querySelectorAll('div')).reverse().forEach((div) => {
    if (!div.parentNode || isClauseSlot(div) || div.parentElement?.closest(`[${CLAUSE_SLOT}], .product-contract-clause`)) return;
    if (hasBlockChild(div)) {
      if (!div.attributes.length) div.replaceWith(...Array.from(div.childNodes));
      return;
    }
    rename(div, 'p');
  });

  // Punkty list i komórki tabel: treść w akapitach (ProseMirror wymaga bloku na początku punktu).
  container.querySelectorAll('li, td, th').forEach((cell) => {
    if (cell.closest(`[${CLAUSE_SLOT}], .product-contract-clause`)) return;
    wrapInlineRuns(cell);
    if (!cell.firstElementChild || cell.firstElementChild.tagName !== 'P') cell.insertBefore(document.createElement('p'), cell.firstChild);
  });

  // Tekst luzem na najwyższym poziomie.
  wrapInlineRuns(container);

  // Miejsca na klauzule: w edytorze to nieedytowalny znacznik — treść odtwarza się przy generowaniu umowy.
  container.querySelectorAll(`[${CLAUSE_SLOT}]`).forEach((slot) => { slot.innerHTML = ''; });
  return container.innerHTML;
};

const isEmptyParagraph = (element: Element) =>
  element.tagName === 'P' && !element.querySelector('br, img') && !(element.textContent || '').replace(/[\s\u00a0]/g, '');

/** Treść z edytora → HTML zapisywany w szablonie (forma, na której działa podział na strony i PDF). */
export const finalizeContractEditorHtml = (html: string): string => {
  const container = document.createElement('div');
  container.innerHTML = html || '';

  container.querySelectorAll('li').forEach((item) => {
    const first = item.firstElementChild;
    const heading = item.getAttribute(CONTRACT_STYLE_ATTRIBUTE) === 'heading';
    item.querySelectorAll(`:scope > p[${KEEP_WITH_NEXT}]`).forEach((paragraph) => {
      if (paragraph !== first || !heading) paragraph.removeAttribute(KEEP_WITH_NEXT);
    });
    if (!first || first.tagName !== 'P') return;
    if (heading) {
      // Linia nagłówka sekcji — jak w szablonach sprzed edytora (nie dzieli się od listy pod nią).
      const span = rename(first, 'span', [KEEP_WITH_NEXT, CONTRACT_STYLE_ATTRIBUTE]);
      span.setAttribute(KEEP_WITH_NEXT, 'true');
      return;
    }
    // Pierwszy akapit bez własnych atrybutów → tekst wprost w punkcie (bez dodatkowego marginesu akapitu).
    if (!first.attributes.length) first.replaceWith(...Array.from(first.childNodes));
  });

  container.querySelectorAll('td, th').forEach((cell) => {
    const first = cell.firstElementChild;
    if (first?.tagName === 'P' && !first.attributes.length) first.replaceWith(...Array.from(first.childNodes));
    // Pusty akapit na końcu komórki dodany przez edytor.
    const last = cell.lastElementChild;
    if (last && isEmptyParagraph(last) && !last.attributes.length && cell.childNodes.length > 1) last.remove();
  });

  // Tabele: kolumny i minimalne szerokości dodawane przez edytor (podział na strony liczy szerokość z atrybutów tabeli).
  container.querySelectorAll('table colgroup').forEach((group) => group.remove());
  container.querySelectorAll<HTMLElement>('table, td, th').forEach((element) => {
    element.style.removeProperty('min-width');
    if (!element.getAttribute('style')?.trim()) element.removeAttribute('style');
  });

  // Puste akapity na końcu dokumentu (edytor dodaje jeden za tabelą, żeby dało się pisać dalej) — nie zapisujemy,
  // bo dodałyby pustą linię pod podpisami.
  let last = container.lastElementChild;
  while (last && isEmptyParagraph(last) && !last.hasAttribute('data-contract-if')) {
    last.remove();
    last = container.lastElementChild;
  }

  // Pusta linia (Enter bez tekstu) ma wysokość wiersza w podglądzie i PDF.
  container.querySelectorAll('p').forEach((paragraph) => {
    if (isEmptyParagraph(paragraph) && !paragraph.closest('li, td, th')) paragraph.innerHTML = '<br>';
  });

  // Miejsca na klauzule z placeholderem (jak przed edytorem) — generator umowy wstawia w nie klauzule produktów.
  container.querySelectorAll(`[${CLAUSE_SLOT}]`).forEach((slot) => {
    const name = slot.getAttribute(CLAUSE_SLOT);
    if (name && !(slot.textContent || '').trim()) slot.textContent = `{{${name}}}`;
  });

  // Tytuł dokumentu jako `<h1>` (zakładki PDF, czytniki ekranu).
  container.querySelectorAll(`p[${CONTRACT_STYLE_ATTRIBUTE}="title"]`).forEach((paragraph) => {
    if (!paragraph.closest('li, td, th')) rename(paragraph, 'h1');
  });
  return container.innerHTML;
};
