import { CONTRACT_STYLE_ATTRIBUTE } from './contractDocumentStyles';

/**
 * Czyste wklejanie do edytora umów (jak „Zachowaj tylko tekst” + podstawowe formatowanie w Wordzie).
 *
 * Z Worda, Dokumentów Google, stron WWW i starych szablonów CRM zostaje: akapity, nagłówki (jako styl „Nagłówek
 * sekcji”), listy numerowane i punktowane z poziomami, tabele, pogrubienie, kursywa, podkreślenie, przekreślenie,
 * linki oraz wyrównanie do środka/prawej. Czcionki, rozmiary, kolory, interlinie i odstępy z wklejki są pomijane —
 * wygląd nadają style dokumentu. Placeholdery `{{…}}` pozostają tekstem (Word potrafi je pociąć na kilka fragmentów).
 */

export type ContractPasteSource = 'word' | 'google-docs' | 'html' | 'editor';

type Marks = { bold: boolean; italic: boolean; underline: boolean; strike: boolean; href: string | null };
type Run = { text: string; marks: Marks } | { br: true };

const NO_MARKS: Marks = { bold: false, italic: false, underline: false, strike: false, href: null };

const REMOVED_TAGS = new Set(['STYLE', 'SCRIPT', 'META', 'LINK', 'TITLE', 'XML', 'TEMPLATE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'CANVAS', 'VIDEO', 'AUDIO', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'HEAD']);
const BLOCK_TAGS = new Set([
  'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE', 'BLOCKQUOTE', 'CENTER', 'ADDRESS', 'SECTION', 'ARTICLE',
  'HEADER', 'FOOTER', 'MAIN', 'ASIDE', 'NAV', 'FIGURE', 'FIGCAPTION', 'DL', 'DT', 'DD', 'OL', 'UL', 'LI', 'TABLE',
  'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'CAPTION', 'HR', 'FORM', 'FIELDSET', 'BODY', 'HTML',
]);

export const detectContractPasteSource = (html: string): ContractPasteSource => {
  // Kopiowanie wewnątrz edytora umowy (ProseMirror) — zostawiamy bez zmian, ze stylami akapitów.
  if (/data-pm-slice=/.test(html)) return 'editor';
  if (/urn:schemas-microsoft-com:office|class="?Mso|mso-[a-z-]+\s*:/i.test(html)) return 'word';
  if (/id="docs-internal-guid-/i.test(html)) return 'google-docs';
  return 'html';
};

const styleValue = (element: Element, property: string) => {
  const raw = element.getAttribute('style') || '';
  const match = raw.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, 'i'));
  return match ? match[1].trim().replace(/\s*!important$/i, '').toLowerCase() : '';
};

const isHidden = (element: Element) =>
  /^none$/.test(styleValue(element, 'display')) || /^hidden$/.test(styleValue(element, 'visibility')) ||
  /mso-hide\s*:\s*all/i.test(element.getAttribute('style') || '');

const weightIsBold = (value: string): boolean | null => {
  if (!value) return null;
  if (value === 'bold' || value === 'bolder') return true;
  if (value === 'normal' || value === 'lighter') return false;
  const number = Number(value);
  return Number.isFinite(number) ? number >= 600 : null;
};

const safeHref = (value: string | null) => {
  const href = (value || '').trim();
  return /^(https?:|mailto:|tel:)/i.test(href) ? href : null;
};

/** Formatowanie znaku wynikające z jednego elementu (znacznik lub styl). */
const applyElementMarks = (element: Element, marks: Marks): Marks => {
  const next = { ...marks };
  const tag = element.tagName;
  if (tag === 'B' || tag === 'STRONG') next.bold = true;
  if (tag === 'I' || tag === 'EM' || tag === 'CITE' || tag === 'DFN' || tag === 'VAR') next.italic = true;
  if (tag === 'U' || tag === 'INS') next.underline = true;
  if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') next.strike = true;
  if (tag === 'A') next.href = safeHref(element.getAttribute('href')) ?? next.href;

  const weight = weightIsBold(styleValue(element, 'font-weight'));
  if (weight !== null) next.bold = weight;
  const fontStyle = styleValue(element, 'font-style');
  if (fontStyle) next.italic = fontStyle === 'italic' || fontStyle === 'oblique';
  const decoration = styleValue(element, 'text-decoration-line') || styleValue(element, 'text-decoration');
  if (decoration) {
    next.underline = decoration.includes('underline') || (tag === 'U' || tag === 'INS');
    next.strike = decoration.includes('line-through') || (tag === 'S' || tag === 'STRIKE' || tag === 'DEL');
  }
  return next;
};

const sameMarks = (a: Marks, b: Marks) =>
  a.bold === b.bold && a.italic === b.italic && a.underline === b.underline && a.strike === b.strike && a.href === b.href;

// MARK: Listy z Worda (akapity z `mso-list`)

const wordListInfo = (element: Element) => {
  const match = (element.getAttribute('style') || '').match(/mso-list\s*:\s*(l\d+)\s+level(\d+)/i);
  if (!match || /mso-list\s*:\s*ignore/i.test(element.getAttribute('style') || '')) return null;
  return { list: match[1], level: Math.max(1, Math.min(9, Number(match[2]) || 1)) };
};

const isWordListMarker = (element: Element) => /mso-list\s*:\s*ignore/i.test(element.getAttribute('style') || '');

/** Typ listy z tekstu numeru, który Word wkleja przed treścią („1.”, „1.1.”, „a)”, „·”, „o”, „§”). */
const listKindFromMarker = (marker: string): { ordered: boolean; type: string | null } => {
  // „§ 1.”, „Art. 2”, „Rozdział 3” — numeracja z przedrostkiem to też lista numerowana.
  const text = marker.replace(/\s+/g, '').trim().replace(/^(?:§|art\.?|rozdzia[łl]|pkt\.?)/i, '');
  if (/^\(?\d+(?:\.\d+)*[.)]?$/.test(text)) return { ordered: true, type: null };
  if (/^\(?[ivxlcdm]+[.)]$/.test(text)) return { ordered: true, type: 'i' };
  if (/^\(?[IVXLCDM]+[.)]$/.test(text)) return { ordered: true, type: 'I' };
  if (/^\(?[a-z][.)]$/.test(text)) return { ordered: true, type: 'a' };
  if (/^\(?[A-Z][.)]$/.test(text)) return { ordered: true, type: 'A' };
  return { ordered: false, type: null };
};

/**
 * Zamienia kolejne akapity list Worda na prawdziwe listy zagnieżdżone według poziomu. Numer wklejony jako tekst
 * (`mso-list:Ignore`, również z komentarzy warunkowych `<![if !supportLists]>`) jest usuwany — numerację nadaje edytor.
 */
const convertWordLists = (root: Element) => {
  const doc = root.ownerDocument;
  const paragraphs = Array.from(root.querySelectorAll('p, h1, h2, h3, h4, h5, h6, div')).filter((element) => wordListInfo(element));
  const handled = new Set<Element>();

  paragraphs.forEach((first) => {
    if (handled.has(first)) return;
    const run: Element[] = [];
    let cursor: Element | null = first;
    while (cursor && wordListInfo(cursor)) {
      run.push(cursor);
      handled.add(cursor);
      let next = cursor.nextSibling;
      while (next && next.nodeType !== Node.ELEMENT_NODE && !(next.textContent || '').trim()) next = next.nextSibling;
      cursor = next && next.nodeType === Node.ELEMENT_NODE ? (next as Element) : null;
    }

    const anchor = doc.createElement('div');
    first.before(anchor);
    const stack: Array<{ list: HTMLElement; ordered: boolean; last: HTMLElement | null }> = [];

    run.forEach((paragraph) => {
      const info = wordListInfo(paragraph)!;
      const markerText = Array.from(paragraph.querySelectorAll('*')).filter(isWordListMarker)
        .map((marker) => marker.textContent || '').join('');
      paragraph.querySelectorAll('*').forEach((element) => { if (isWordListMarker(element)) element.remove(); });
      const kind = listKindFromMarker(markerText);

      while (stack.length > info.level) stack.pop();
      // Inny rodzaj listy na tym samym poziomie (numerowana ↔ punktowana) zaczyna nową listę.
      if (stack.length === info.level && stack[stack.length - 1].ordered !== kind.ordered) stack.pop();
      while (stack.length < info.level) {
        const list = doc.createElement(kind.ordered ? 'ol' : 'ul');
        if (kind.ordered && kind.type && stack.length + 1 === info.level) list.setAttribute('type', kind.type);
        if (!stack.length) anchor.appendChild(list);
        else {
          const parent = stack[stack.length - 1];
          if (!parent.last) {
            parent.last = doc.createElement('li');
            parent.list.appendChild(parent.last);
          }
          parent.last.appendChild(list);
        }
        stack.push({ list, ordered: kind.ordered, last: null });
      }

      const item = doc.createElement('li');
      const body = doc.createElement(/^H[1-6]$/.test(paragraph.tagName) ? paragraph.tagName.toLowerCase() : 'p');
      const align = paragraph.getAttribute('align') || styleValue(paragraph, 'text-align');
      if (align) body.setAttribute('style', `text-align:${align}`);
      while (paragraph.firstChild) body.appendChild(paragraph.firstChild);
      item.appendChild(body);
      stack[stack.length - 1].list.appendChild(item);
      stack[stack.length - 1].last = item;
      paragraph.remove();
    });

    anchor.replaceWith(...Array.from(anchor.childNodes));
  });
};

// MARK: Usuwanie śmieci

const stripJunk = (root: Element) => {
  let removedImages = 0;
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_COMMENT | NodeFilter.SHOW_ELEMENT);
  const remove: Node[] = [];
  const unwrap: Element[] = [];
  let node = walker.nextNode();
  while (node) {
    if (node.nodeType === Node.COMMENT_NODE) remove.push(node);
    else {
      const element = node as Element;
      const tag = element.tagName.toUpperCase();
      if (REMOVED_TAGS.has(tag) || isHidden(element)) remove.push(element);
      else if (tag === 'O:P') {
        // `<o:p>&nbsp;</o:p>` — wypełniacz pustego akapitu w Wordzie.
        remove.push(element);
      } else if (tag.includes(':')) {
        // Kształty i pola Worda: `v:shape` (rysunki) usuwamy, kontenery `w:sdt` itp. rozwijamy.
        if (tag.startsWith('V:')) {
          remove.push(element);
          // Obrazek w Wordzie to para `v:shape` + `img` — liczymy tylko `img`.
        }
        else unwrap.push(element);
      } else if (tag === 'IMG') {
        // Obrazki z Worda wskazują pliki tymczasowe na dysku — w umowie ich nie będzie.
        const src = element.getAttribute('src') || '';
        if (!/^https?:/i.test(src)) {
          remove.push(element);
          removedImages += 1;
        }
      }
    }
    node = walker.nextNode();
  }
  remove.forEach((item) => item.parentNode?.removeChild(item));
  unwrap.reverse().forEach((element) => element.replaceWith(...Array.from(element.childNodes)));
  // Dokumenty Google: całość w `<b style="font-weight:normal" id="docs-internal-guid-…">` — to nie pogrubienie.
  root.querySelectorAll('b[id^="docs-internal-guid"]').forEach((wrapper) => wrapper.replaceWith(...Array.from(wrapper.childNodes)));
  // Ręczny podział strony z Worda.
  root.querySelectorAll('br').forEach((br) => {
    if (/page-break-before\s*:\s*always/i.test(br.getAttribute('style') || '') || br.getAttribute('clear') === 'all') br.remove();
  });
  return { removedImages };
};

// MARK: Budowanie czystego HTML

const normalizeText = (text: string) => text.replace(/[\t\n\r\f ]+/g, ' ').replace(/[\u00a0 ]{2,}/g, ' ');

const hasBlockChild = (element: Element) =>
  Array.from(element.children).some((child) => BLOCK_TAGS.has(child.tagName) || (child.tagName === 'IMG'));

const collectRuns = (node: Node, marks: Marks, runs: Run[]) => {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = normalizeText(node.textContent || '');
    if (text) runs.push({ text, marks });
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const element = node as Element;
  if (element.tagName === 'BR') {
    runs.push({ br: true });
    return;
  }
  if (BLOCK_TAGS.has(element.tagName)) {
    // Blok wewnątrz wiersza (np. `<div>` w `<span>`) — traktujemy jak przejście do nowej linii.
    if (runs.length && !('br' in runs[runs.length - 1])) runs.push({ br: true });
  }
  const next = applyElementMarks(element, marks);
  element.childNodes.forEach((child) => collectRuns(child, next, runs));
};

/** Przycina białe znaki na początku i końcu akapitu oraz wokół złamań wiersza; scala sąsiednie fragmenty. */
const tidyRuns = (runs: Run[]): Run[] => {
  const merged: Run[] = [];
  runs.forEach((run) => {
    const previous = merged[merged.length - 1];
    if (!('br' in run) && previous && !('br' in previous) && sameMarks(previous.marks, run.marks)) {
      previous.text = (previous.text + run.text).replace(/[ \u00a0]{2,}/g, ' ');
    } else merged.push('br' in run ? run : { text: run.text, marks: run.marks });
  });
  // Podwójne spacje na styku fragmentów o różnym formatowaniu.
  for (let index = 1; index < merged.length; index += 1) {
    const previous = merged[index - 1];
    const current = merged[index];
    if (!('br' in previous) && !('br' in current) && /[ \u00a0]$/.test(previous.text) && /^[ \u00a0]/.test(current.text)) {
      current.text = current.text.replace(/^[ \u00a0]+/, '');
    }
  }
  const trimEdge = (list: Run[], fromStart: boolean) => {
    while (list.length) {
      const edge = fromStart ? list[0] : list[list.length - 1];
      if ('br' in edge) {
        if (fromStart) list.shift(); else list.pop();
        continue;
      }
      edge.text = fromStart ? edge.text.replace(/^[ \u00a0]+/, '') : edge.text.replace(/[ \u00a0]+$/, '');
      if (edge.text) break;
      if (fromStart) list.shift(); else list.pop();
    }
  };
  trimEdge(merged, true);
  trimEdge(merged, false);
  // Spacje przy złamaniu wiersza.
  merged.forEach((run, index) => {
    if ('br' in run) return;
    if ('br' in (merged[index + 1] || {})) run.text = run.text.replace(/[ \u00a0]+$/, '');
    if ('br' in (merged[index - 1] || {})) run.text = run.text.replace(/^[ \u00a0]+/, '');
  });
  return merged.filter((run) => 'br' in run || run.text);
};

const appendRuns = (target: Element, runs: Run[]) => {
  const doc = target.ownerDocument;
  runs.forEach((run) => {
    if ('br' in run) {
      target.appendChild(doc.createElement('br'));
      return;
    }
    let node: Node = doc.createTextNode(run.text);
    const wrap = (tag: string) => {
      const element = doc.createElement(tag);
      element.appendChild(node);
      node = element;
    };
    if (run.marks.strike) wrap('s');
    if (run.marks.underline) wrap('u');
    if (run.marks.italic) wrap('em');
    if (run.marks.bold) wrap('strong');
    if (run.marks.href) {
      const link = doc.createElement('a');
      link.setAttribute('href', run.marks.href);
      link.appendChild(node);
      node = link;
    }
    target.appendChild(node);
  });
};

const blockAlignment = (element: Element, inherited: string | null) => {
  if (element.tagName === 'CENTER') return 'center';
  const value = (element.getAttribute('align') || styleValue(element, 'text-align')).toLowerCase();
  if (value === 'center' || value === 'middle') return 'center';
  if (value === 'right' || value === 'end') return 'right';
  if (value === 'left' || value === 'start' || value === 'justify') return null;
  return inherited;
};

const paragraphStyleFor = (element: Element, text: string): string | null => {
  const className = element.getAttribute('class') || '';
  if (/MsoTitle/i.test(className)) return 'title';
  if (/^H[1-6]$/.test(element.tagName)) return 'heading';
  if (/MsoHeading|Nag[łl][oó]wek/i.test(className)) return 'heading';
  // „§ 1” w osobnym akapicie — nagłówek paragrafu umowy.
  if (/^§\s*(?:\d+|n)\.?$/u.test(text.trim())) return 'heading';
  return null;
};

type Context = { align: string | null; marks: Marks; inCell: boolean };

/** Dokumenty Google zapisują rodzaj numeracji w CSS punktu, nie w atrybucie listy. */
const LIST_STYLE_TYPES: Record<string, string> = {
  'lower-alpha': 'a', 'lower-latin': 'a', 'upper-alpha': 'A', 'upper-latin': 'A', 'lower-roman': 'i', 'upper-roman': 'I',
};

const isEmptyParagraph = (element: Element) =>
  element.tagName === 'P' && !element.querySelector('br, img') && !(element.textContent || '').replace(/[\s\u00a0]/g, '');

/** Zamienia zawartość kontenera na bloki edytora: akapity, listy, tabele, obrazki. */
const convertBlocks = (source: Element, target: Element, context: Context) => {
  const doc = target.ownerDocument;
  let pending: Node[] = [];

  const flush = (origin: Element | null = null) => {
    if (!pending.length) return;
    const runs: Run[] = [];
    pending.forEach((node) => collectRuns(node, context.marks, runs));
    pending = [];
    const tidy = tidyRuns(runs);
    if (!tidy.length) return;
    const paragraph = doc.createElement('p');
    if (context.align) paragraph.setAttribute('style', `text-align:${context.align}`);
    appendRuns(paragraph, tidy);
    if (origin) {
      const style = paragraphStyleFor(origin, paragraph.textContent || '');
      if (style && !context.inCell) paragraph.setAttribute(CONTRACT_STYLE_ATTRIBUTE, style);
    }
    target.appendChild(paragraph);
  };

  Array.from(source.childNodes).forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE || (node.nodeType === Node.ELEMENT_NODE && !BLOCK_TAGS.has((node as Element).tagName) && (node as Element).tagName !== 'IMG' && !hasBlockChild(node as Element))) {
      pending.push(node);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    flush();
    const element = node as Element;
    const tag = element.tagName;

    if (tag === 'IMG') {
      const image = doc.createElement('img');
      image.setAttribute('src', element.getAttribute('src') || '');
      const alt = element.getAttribute('alt');
      if (alt) image.setAttribute('alt', alt);
      target.appendChild(image);
      return;
    }
    if (tag === 'HR') return;

    if (tag === 'OL' || tag === 'UL') {
      const list = doc.createElement(tag.toLowerCase());
      const firstItem = Array.from(element.children).find((child) => child.tagName === 'LI');
      const cssType = styleValue(element, 'list-style-type') || (firstItem ? styleValue(firstItem, 'list-style-type') : '');
      const type = element.getAttribute('type') || LIST_STYLE_TYPES[cssType] || null;
      if (tag === 'OL' && type && /^[aAiI1]$/.test(type) && type !== '1') list.setAttribute('type', type);
      const start = Number(element.getAttribute('start'));
      if (tag === 'OL' && Number.isInteger(start) && start > 1) list.setAttribute('start', String(start));
      Array.from(element.childNodes).forEach((child) => {
        const item = doc.createElement('li');
        if (child.nodeType === Node.ELEMENT_NODE && (child as Element).tagName === 'LI') {
          convertBlocks(child as Element, item, { ...context, align: blockAlignment(child as Element, null), marks: applyElementMarks(element, context.marks) });
        } else if (child.nodeType === Node.ELEMENT_NODE && /^(OL|UL)$/.test((child as Element).tagName)) {
          // Lista zagnieżdżona bez punktu-rodzica (częste w HTML z przeglądarki) — dołączamy do poprzedniego punktu.
          const previous = list.lastElementChild;
          const holder = doc.createElement('div');
          holder.appendChild(child.cloneNode(true));
          if (previous) convertBlocks(holder, previous, context);
          return;
        } else if ((child.textContent || '').trim()) {
          const holder = doc.createElement('div');
          holder.appendChild(child.cloneNode(true));
          convertBlocks(holder, item, context);
        } else return;
        if (!item.firstElementChild || item.firstElementChild.tagName !== 'P') item.insertBefore(doc.createElement('p'), item.firstChild);
        list.appendChild(item);
      });
      if (list.children.length) target.appendChild(list);
      return;
    }

    if (tag === 'TABLE') {
      const table = doc.createElement('table');
      const body = doc.createElement('tbody');
      table.appendChild(body);
      Array.from(element.querySelectorAll('tr')).filter((row) => row.closest('table') === element).forEach((row) => {
        const outRow = doc.createElement('tr');
        Array.from(row.children).filter((cell) => cell.tagName === 'TD' || cell.tagName === 'TH').forEach((cell) => {
          const outCell = doc.createElement(cell.tagName.toLowerCase());
          ['colspan', 'rowspan'].forEach((name) => {
            const value = Number(cell.getAttribute(name));
            if (Number.isInteger(value) && value > 1) outCell.setAttribute(name, String(value));
          });
          convertBlocks(cell, outCell, { align: blockAlignment(cell, null), marks: applyElementMarks(cell, NO_MARKS), inCell: true });
          if (!outCell.firstElementChild) outCell.appendChild(doc.createElement('p'));
          outRow.appendChild(outCell);
        });
        if (outRow.children.length) body.appendChild(outRow);
      });
      if (body.children.length) target.appendChild(table);
      return;
    }

    const align = blockAlignment(element, context.align);
    const marks = /^H[1-6]$/.test(tag) ? context.marks : applyElementMarks(element, context.marks);
    if (hasBlockChild(element)) {
      // Kontener (np. `<div>` z akapitami, `<blockquote>`) — rozwijamy, przekazując wyrównanie i formatowanie.
      convertBlocks(element, target, { ...context, align, marks });
      return;
    }
    // Akapit, nagłówek, `<pre>`, komórka definicji… — jeden akapit edytora.
    const saved = context;
    context = { ...context, align, marks };
    pending = Array.from(element.childNodes);
    const before = target.childNodes.length;
    flush(element);
    if (target.childNodes.length === before && !context.inCell) {
      // Pusty akapit (odstęp w Wordzie) — zostawiamy znacznik, scalimy później.
      const empty = doc.createElement('p');
      target.appendChild(empty);
    }
    context = saved;
  });
  flush();
};

/** Puste akapity: najwyżej jeden pod rząd, bez pustych na początku i końcu. */
const collapseEmptyParagraphs = (root: Element) => {
  const containers = [root, ...Array.from(root.querySelectorAll('li, td, th'))];
  containers.forEach((container) => {
    let previousEmpty = true;
    Array.from(container.children).forEach((child) => {
      const empty = isEmptyParagraph(child);
      if (empty && previousEmpty) child.remove();
      else previousEmpty = empty;
    });
    let last = container.lastElementChild;
    while (last && isEmptyParagraph(last) && container.children.length > 1) {
      last.remove();
      last = container.lastElementChild;
    }
    if (container !== root && !container.firstElementChild) container.appendChild(root.ownerDocument.createElement('p'));
  });
};

const isHeadlineItem = (item: Element) => {
  const first = item.firstElementChild;
  const text = (first?.textContent || '').replace(/\s+/g, ' ').trim();
  return first?.tagName === 'P' && Boolean(text) && text.length <= 120 && !/[.;:,]$/.test(text);
};

/**
 * Sekcje z listy: lista pierwszego poziomu, której punkty są krótkimi tytułami („1. Przedmiot umowy”,
 * „2. Wynagrodzenie”), a co najmniej jeden ma pod sobą punkty (1.1, 1.2…), dostaje styl „Nagłówek sekcji” — jak
 * w szablonach umów CRM. Zwykłe listy (zdania zakończone kropką lub przecinkiem) zostają punktami.
 */
const markListSections = (root: Element) => {
  Array.from(root.children).filter((list) => list.tagName === 'OL' || list.tagName === 'UL').forEach((list) => {
    const items = Array.from(list.children).filter((child) => child.tagName === 'LI');
    const nested = items.some((item) => Array.from(item.children).some((child) => child.tagName === 'OL' || child.tagName === 'UL'));
    if (!nested || !items.every(isHeadlineItem)) return;
    items.forEach((item) => {
      item.setAttribute(CONTRACT_STYLE_ATTRIBUTE, 'heading');
      item.firstElementChild!.setAttribute('data-contract-keep-with-next', 'true');
    });
  });
  // Nagłówek (`h1`…`h6`) jako punkt listy — to linia sekcji, nie osobny akapit.
  root.querySelectorAll('li > p[data-style="heading"]').forEach((paragraph) => {
    paragraph.removeAttribute(CONTRACT_STYLE_ATTRIBUTE);
    const item = paragraph.parentElement!;
    if (item.firstElementChild === paragraph) {
      item.setAttribute(CONTRACT_STYLE_ATTRIBUTE, 'heading');
      paragraph.setAttribute('data-contract-keep-with-next', 'true');
    }
  });
};

export interface ContractPasteResult {
  html: string;
  source: ContractPasteSource;
  /** Obrazki pominięte przy wklejaniu (pliki tymczasowe Worda) — edytor informuje, że trzeba je wstawić osobno. */
  removedImages: number;
}

/** Czyści HTML ze schowka przed wklejeniem do edytora umowy. */
export const cleanContractPasteHtml = (html: string): ContractPasteResult => {
  const source = detectContractPasteSource(html);
  if (source === 'editor') return { html, source, removedImages: 0 };
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const root = parsed.body;
  const { removedImages } = stripJunk(root);
  if (source === 'word') convertWordLists(root);
  // Pierwsze wyrównanie Worda bywa w `align` na `<div class=WordSection1>` — kontener nie wyznacza wyrównania akapitów.
  const output = parsed.createElement('div');
  convertBlocks(root, output, { align: null, marks: NO_MARKS, inCell: false });
  markListSections(output);
  collapseEmptyParagraphs(output);
  return { html: output.innerHTML, source, removedImages };
};
