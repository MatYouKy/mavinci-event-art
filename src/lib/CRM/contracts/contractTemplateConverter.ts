import { syncBlockFallbackFontSize } from './contractPagination';
import {
  CONTRACT_STYLE_ATTRIBUTE,
  CONTRACT_STYLE_IDS,
  contractHeadingLine,
  createDefaultContractDocumentStyles,
  inferContractStyle,
  resolveContractDocumentStyles,
  type ContractDocumentStyle,
  type ContractDocumentStyles,
  type ContractStyleId,
  type ContractTextAlign,
} from './contractDocumentStyles';

/**
 * Konwersja szablonu umowy ze starego formatu (style wpisane przy każdym akapicie i fragmencie, często z kopii
 * strony WWW) do formatu ze stylami dokumentu (`contractDocumentStyles.ts`).
 *
 * Konwerter działa w przeglądarce: wstawia treść do ukrytej strony A4 z tymi samymi regułami CSS co podgląd umowy,
 * odczytuje wygląd, który użytkownik faktycznie widzi (rozmiar tekstu, pogrubienie, odstępy między punktami, wcięcia,
 * odstęp między wierszami), i z najczęstszych wartości buduje style „Tytuł”, „Nagłówek sekcji”, „Punkt”… Każdy akapit
 * dostaje znacznik stylu; zostają tylko faktyczne wyjątki (np. wyśrodkowany akapit, pogrubiony fragment, kolor).
 * Pola `{{…}}`, miejsca na klauzule, sekcje warunkowe, wspólne zasady i numeracja pozostają bez zmian.
 */

export interface ContractTemplateConversionReport {
  sizeBefore: number;
  sizeAfter: number;
  /** Liczba akapitów i punktów w każdym stylu. */
  styleCounts: Record<ContractStyleId, number>;
  /** Akapity, które zachowały formatowanie bezpośrednie (wyrównanie, rozmiar, kolor…). */
  directFormatting: number;
  /** Usunięte zbędne deklaracje stylów (zmienne Tailwind, ustawienia czcionek przeglądarki, powtórzenia). */
  removedDeclarations: number;
  warnings: string[];
}

export interface ContractTemplateConversion {
  html: string;
  documentStyles: ContractDocumentStyles;
  report: ContractTemplateConversionReport;
}

export interface ConvertContractTemplateOptions {
  /** Czcionka i odstęp między wierszami ze starych ustawień strony (`selectedFont`, `lineHeight`). */
  selectedFont?: string;
  lineHeight?: number;
  /** Arkusz bazowy umowy (`getContractDocumentCss()`), aby pomiar odpowiadał podglądowi. */
  baseCss: string;
}

const PX_TO_PT = 0.75;
const round = (value: number, step: number) => Number((Math.round(value / step) * step).toFixed(2));
const toPt = (px: number) => round(px * PX_TO_PT, 0.5);

const INLINE_TAGS = new Set(['SPAN', 'FONT', 'B', 'STRONG', 'EM', 'I', 'U', 'S', 'STRIKE', 'DEL', 'A', 'SUP', 'SUB', 'MARK', 'SMALL', 'BIG', 'CODE']);
const BLOCKISH = 'p, div, pre, h1, h2, h3, h4, h5, h6, li, td, th, blockquote, ol, ul, table, tr, tbody, thead';
const KEPT_CLASSES = /^(?:contract-paragraph-heading|product-contract-clause|contract-product-clauses|ql-indent-\d+)$/;
const TABLE_PROPERTIES = new Set([
  'width', 'min-width', 'max-width', 'border-collapse', 'table-layout', 'vertical-align', 'padding', 'padding-top',
  'padding-bottom', 'padding-left', 'padding-right', 'border', 'border-top', 'border-bottom', 'border-left', 'border-right',
  'break-inside', 'page-break-inside', 'margin-top',
]);
const RUNTIME_ATTRIBUTES = [
  'data-contract-pagination-item-id', 'data-contract-source-list-depth', 'data-contract-pagination-base-margin',
  'data-contract-pagination-missing-depth', 'data-contract-list-item-continuation', 'data-contract-list-continuation',
];

const SANS = /^(?:arial|helvetica|calibri|verdana|tahoma|segoe ui|open sans|roboto|inter|lato)$/i;

/** „Arial” → „Arial, sans-serif” — rodzina z zapasową czcionką systemową. */
const normalizeFontFamily = (value: string) => {
  const families = value.split(',').map((part) => part.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  const first = families[0] || 'Arial';
  const generic = families.find((family) => /^(?:sans-serif|serif|monospace)$/i.test(family));
  return `${first}, ${generic || (SANS.test(first) ? 'sans-serif' : 'serif')}`;
};

const rgbToHex = (value: string) => {
  const match = value.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (!match) return value.startsWith('#') ? value.toLowerCase() : '#000000';
  return `#${match.slice(1, 4).map((part) => Number(part).toString(16).padStart(2, '0')).join('')}`;
};

const alignOf = (value: string): ContractTextAlign => {
  if (value === 'center' || value === 'right' || value === 'justify') return value;
  if (value === 'end') return 'right';
  return 'left';
};

/** Najczęstsza wartość (ważona długością tekstu). */
class Tally<T extends string | number> {
  private weights = new Map<T, number>();
  add(value: T, weight = 1) { this.weights.set(value, (this.weights.get(value) || 0) + Math.max(weight, 0.0001)); }
  mode(except: T[] = []): T | undefined {
    let best: T | undefined;
    let bestWeight = -1;
    this.weights.forEach((weight, value) => {
      if (!except.includes(value) && weight > bestWeight) { best = value; bestWeight = weight; }
    });
    return best;
  }
}

interface Measured {
  role: ContractStyleId | null;
  fontFamily: string;
  fontSizePt: number;
  weight: number;
  /** Pogrubienie samego bloku (z jego stylu lub bloku nadrzędnego), niezależnie od fragmentów wewnątrz. */
  ownWeight: number;
  /** Udział tekstu o tym samym pogrubieniu co blok. */
  uniformWeight: number;
  /** Udział pogrubionego tekstu. */
  boldShare: number;
  italic: boolean;
  color: string;
  align: ContractTextAlign;
  textLength: number;
  lines: number;
  linePitchPx: number | null;
  runSizePx: number;
  indentPt: number | null;
  gapAfterPt: number | null;
  gapBeforePt: number | null;
  marginLeftPt: number;
}

const ownTextNodes = (block: Element) => {
  const result: Text[] = [];
  const walker = block.ownerDocument.createTreeWalker(block, 4 /* SHOW_TEXT */);
  let node = walker.nextNode() as Text | null;
  while (node) {
    if (node.data.trim() && node.parentElement?.closest(BLOCKISH) === block) result.push(node);
    node = walker.nextNode() as Text | null;
  }
  return result;
};

/**
 * Wiersze tekstu akapitu: liczba i odstęp między kolejnymi wierszami (w px) — faktyczna interlinia, także gdy wynika
 * z mieszanych rozmiarów (np. akapit 12 pt z tekstem 8 pt).
 */
const lineStats = (texts: Text[]) => {
  const tops: number[] = [];
  const range = texts[0]?.ownerDocument.createRange();
  if (!range) return { lines: 0, pitch: null as number | null };
  texts.forEach((text) => {
    range.selectNodeContents(text);
    Array.from(range.getClientRects()).forEach((rect) => { if (rect.width > 0.5) tops.push(rect.bottom); });
  });
  const lines = tops.sort((a, b) => a - b)
    .filter((top, index, all) => index === 0 || top - all[index - 1] > 2);
  if (lines.length < 2) return { lines: lines.length, pitch: null };
  const gaps = lines.slice(1).map((top, index) => top - lines[index]).sort((a, b) => a - b);
  return { lines: lines.length, pitch: gaps[Math.floor(gaps.length / 2)] };
};

const visibleRect = (element: Element | null) => {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return rect.height > 0 ? rect : null;
};

export async function convertLegacyContractTemplate(
  html: string,
  options: ConvertContractTemplateOptions,
): Promise<ContractTemplateConversion> {
  const doc = document;
  const warnings: string[] = [];
  const sizeBefore = html.length;

  // Ukryta strona A4 w osobnym drzewie (Shadow DOM) — style konwertera nie wpływają na CRM.
  const host = doc.createElement('div');
  Object.assign(host.style, { position: 'fixed', left: '-10000px', top: '0', width: '210mm', visibility: 'hidden', pointerEvents: 'none' });
  doc.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const css = doc.createElement('style');
  css.textContent = options.baseCss;
  shadow.appendChild(css);
  const page = doc.createElement('div');
  page.className = 'contract-a4-page';
  page.style.height = 'auto';
  page.style.minHeight = '0';
  const content = doc.createElement('div');
  content.className = 'contract-content';
  content.style.lineHeight = String(options.lineHeight ?? 1.6);
  content.style.fontFamily = options.selectedFont || 'Georgia, serif';
  content.innerHTML = html;
  page.appendChild(content);
  shadow.appendChild(page);

  try {
    await doc.fonts?.ready;
    content.querySelectorAll('style, script, link, meta').forEach((node) => node.remove());
    RUNTIME_ATTRIBUTES.forEach((attribute) => content.querySelectorAll(`[${attribute}]`).forEach((node) => node.removeAttribute(attribute)));
    // Tak jak przy podziale na strony starego szablonu: akapit z tekstem w jednym rozmiarze dostaje ten rozmiar.
    content.querySelectorAll<HTMLElement>('p, pre, li').forEach(syncBlockFallbackFontSize);

    // 1. Pomiar — wygląd, który widać w podglądzie starego szablonu.
    const measured = new Map<Element, Measured>();
    const blocks = Array.from(content.querySelectorAll<HTMLElement>('p, div, pre, h1, h2, h3, h4, h5, h6, li, td, th, blockquote'));
    blocks.forEach((block) => {
      const role = inferContractStyle(block, content);
      const computed = getComputedStyle(block);
      const texts = ownTextNodes(block);
      const sizes = new Tally<number>();
      const weights = new Tally<number>();
      const italics = new Tally<string>();
      const families = new Tally<string>();
      const colors = new Tally<string>();
      let textLength = 0;
      let sameWeight = 0;
      let boldLength = 0;
      const blockBold = (Number(computed.fontWeight) || 400) >= 600;
      texts.forEach((text) => {
        const style = getComputedStyle(text.parentElement!);
        const length = text.data.trim().length;
        textLength += length;
        sizes.add(Number.parseFloat(style.fontSize), length);
        weights.add(Number(style.fontWeight) || 400, length);
        if (((Number(style.fontWeight) || 400) >= 600) === blockBold) sameWeight += length;
        if ((Number(style.fontWeight) || 400) >= 600) boldLength += length;
        italics.add(style.fontStyle, length);
        families.add(style.fontFamily, length);
        colors.add(rgbToHex(style.color), length);
      });
      const runSizePx = sizes.mode() ?? Number.parseFloat(computed.fontSize);
      const stats = texts.length ? lineStats(texts) : { lines: 0, pitch: null };
      // Linia nagłówka sekcji ma tekst w <span>, ale wygląd należy do punktu-sekcji.
      const headingLine = block.tagName === 'LI' ? contractHeadingLine(block) : null;
      const lineStyle = headingLine ? getComputedStyle(headingLine) : null;
      let indentPt: number | null = null;
      const list = block.tagName === 'LI' ? block.parentElement : null;
      if (list && /^(?:OL|UL)$/.test(list.tagName)) {
        const listRect = list.getBoundingClientRect();
        const itemRect = block.getBoundingClientRect();
        indentPt = toPt(itemRect.left - listRect.left);
      }
      measured.set(block, {
        role,
        fontFamily: families.mode() ?? (lineStyle || computed).fontFamily,
        fontSizePt: round((headingLine && !texts.length ? Number.parseFloat(lineStyle!.fontSize) : runSizePx) * PX_TO_PT, 0.25),
        weight: weights.mode() ?? (Number((lineStyle || computed).fontWeight) || 400),
        ownWeight: Number(computed.fontWeight) || 400,
        uniformWeight: textLength ? sameWeight / textLength : 1,
        boldShare: textLength ? boldLength / textLength : 0,
        italic: (italics.mode() ?? computed.fontStyle) === 'italic',
        color: colors.mode() ?? rgbToHex(computed.color),
        align: alignOf(computed.textAlign),
        textLength,
        lines: stats.lines,
        linePitchPx: (() => {
          const blockSize = Number.parseFloat(computed.fontSize);
          const declared = Number.parseFloat(computed.lineHeight);
          // Interlinia zadeklarowana dla tego samego rozmiaru co tekst — dokładna wartość; inaczej pomiar wierszy.
          if (Number.isFinite(declared) && Math.abs(blockSize - runSizePx) < 0.5) return declared;
          if (computed.lineHeight === 'normal' && Math.abs(blockSize - runSizePx) < 0.5) return runSizePx * 1.15;
          return stats.pitch;
        })(),
        runSizePx,
        indentPt,
        gapAfterPt: null,
        gapBeforePt: null,
        marginLeftPt: block.tagName === 'LI' ? 0 : toPt(Number.parseFloat(computed.marginLeft) || 0),
      });
    });

    // Tytuł zapisany jako zwykły akapit: wyśrodkowany, cały pogrubiony i wyraźnie większy od tekstu.
    const bodySizes = new Tally<number>();
    measured.forEach((info) => { if (info.role === 'body') bodySizes.add(info.fontSizePt, info.textLength); });
    const bodySize = bodySizes.mode();
    if (bodySize !== undefined && !Array.from(measured.values()).some((info) => info.role === 'title')) {
      measured.forEach((info) => {
        if (info.role === 'body' && info.align === 'center' && info.boldShare >= 0.95 &&
          info.fontSizePt >= bodySize + 2) info.role = 'title';
      });
    }

    // Sąsiedni element w kolejności dokumentu — także poza owinięciem (np. tytuł w osobnym <div>).
    const adjacent = (element: Element, direction: 'next' | 'previous') => {
      let current: Element | null = element;
      while (current && current !== content) {
        const sibling = direction === 'next' ? current.nextElementSibling : current.previousElementSibling;
        if (sibling) return sibling;
        current = current.parentElement;
      }
      return null;
    };

    // Odstępy: między kolejnymi elementami tego samego rodzica (punkt → punkt, akapit → akapit),
    // dla nagłówka sekcji — od linii nagłówka do pierwszego punktu.
    blocks.forEach((block) => {
      const info = measured.get(block)!;
      if (!info.role) return;
      const headingLineBox = block.tagName === 'LI' && info.role === 'heading' ? contractHeadingLine(block) : null;
      const box = visibleRect(headingLineBox || block);
      if (!box) return;
      const headingLine = headingLineBox;
      if (headingLine) {
        const firstItem = block.querySelector(':scope > ol > li, :scope > ul > li');
        const lineBox = visibleRect(headingLine);
        const itemBox = firstItem ? visibleRect(firstItem) : null;
        if (lineBox && itemBox) info.gapAfterPt = toPt(itemBox.top - lineBox.bottom);
      } else {
        let next = block.tagName === 'LI' ? block.nextElementSibling : adjacent(block, 'next');
        while (next && !visibleRect(next)) next = next.nextElementSibling;
        const nextInfo = next ? measured.get(next) : undefined;
        if (next && (nextInfo?.role === info.role || (block.tagName !== 'LI' && nextInfo?.role !== 'heading' && nextInfo?.role !== 'title'))) {
          // Punkt z podpunktami: odstęp liczony od końca całego punktu.
          const nextBox = visibleRect(next);
          if (nextBox) info.gapAfterPt = toPt(nextBox.top - block.getBoundingClientRect().bottom);
        }
      }
      if (info.role === 'heading' || info.role === 'title') {
        let previous = block.tagName === 'LI' ? block.previousElementSibling : adjacent(block, 'previous');
        while (previous && !visibleRect(previous)) previous = previous.previousElementSibling;
        if (previous) info.gapBeforePt = toPt(box.top - previous.getBoundingClientRect().bottom);
      }
    });

    // Fragmenty wiersza (pomiar przed zmianami): pogrubienie, kursywa, podkreślenie, przekreślenie, kolor.
    const inlineFacts = new Map<Element, { weight: number; boldShare: number; italic: boolean; underline: boolean; strike: boolean; color: string }>();
    const inlines = Array.from(content.querySelectorAll<HTMLElement>('*')).filter((element) => INLINE_TAGS.has(element.tagName));
    inlines.forEach((element) => {
      const style = getComputedStyle(element);
      const decoration = `${style.textDecorationLine} ${element.getAttribute('style') || ''}`;
      let all = 0;
      let bold = 0;
      const walker = doc.createTreeWalker(element, 4 /* SHOW_TEXT */);
      for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
        const length = node.data.trim().length;
        if (!length) continue;
        all += length;
        if ((Number(getComputedStyle(node.parentElement!).fontWeight) || 400) >= 600) bold += length;
      }
      inlineFacts.set(element, {
        weight: Number(style.fontWeight) || 400,
        boldShare: all ? bold / all : (Number(style.fontWeight) || 400) >= 600 ? 1 : 0,
        italic: style.fontStyle === 'italic',
        underline: /underline/.test(decoration) || element.tagName === 'U',
        strike: /line-through/.test(decoration) || /^(?:S|STRIKE|DEL)$/.test(element.tagName),
        color: rgbToHex(style.color),
      });
    });

    // 2. Style dokumentu — najczęstsze wartości dla każdego stylu.
    const fallback = createDefaultContractDocumentStyles(normalizeFontFamily(options.selectedFont || 'Arial, sans-serif'));
    const derived: Partial<Record<ContractStyleId, ContractDocumentStyle>> = {};
    const styleCounts = Object.fromEntries(CONTRACT_STYLE_IDS.map((id) => [id, 0])) as Record<ContractStyleId, number>;
    CONTRACT_STYLE_IDS.forEach((id) => {
      const members = Array.from(measured.values()).filter((info) => info.role === id);
      styleCounts[id] = members.length;
      if (!members.length) return;
      const tallies = {
        family: new Tally<string>(), size: new Tally<number>(), weight: new Tally<number>(), italic: new Tally<string>(),
        color: new Tally<string>(), align: new Tally<string>(), pitch: new Tally<number>(), indent: new Tally<number>(),
        after: new Tally<number>(), before: new Tally<number>(),
      };
      members.forEach((info) => {
        const weight = Math.max(info.textLength, 1);
        tallies.family.add(normalizeFontFamily(info.fontFamily), weight);
        tallies.size.add(info.fontSizePt, weight);
        tallies.weight.add(info.weight >= 600 ? 700 : 400, weight);
        tallies.italic.add(info.italic ? 'italic' : 'normal', weight);
        tallies.color.add(info.color, weight);
        // Jednowierszowy akapit wygląda tak samo wyrównany do lewej i do obu stron — głosuje tylko „do krawędzi”.
        tallies.align.add(info.lines > 1 || info.align === 'center' || info.align === 'right' ? info.align : 'edge', weight);
        if (info.linePitchPx && info.runSizePx) tallies.pitch.add(round(info.linePitchPx / info.runSizePx, 0.05), weight);
        if (info.indentPt !== null) tallies.indent.add(info.indentPt, 1);
        if (info.gapAfterPt !== null) tallies.after.add(Math.max(0, info.gapAfterPt), 1);
        if (info.gapBeforePt !== null) tallies.before.add(Math.max(0, info.gapBeforePt), 1);
      });
      const base = fallback.styles[id];
      derived[id] = {
        ...base,
        fontFamily: tallies.family.mode() ?? base.fontFamily,
        fontSizePt: tallies.size.mode() ?? base.fontSizePt,
        bold: (tallies.weight.mode() ?? 400) >= 600,
        italic: tallies.italic.mode() === 'italic',
        color: tallies.color.mode() ?? base.color,
        textAlign: (() => {
          const align = tallies.align.mode();
          if (align && align !== 'edge') return align as ContractTextAlign;
          return (tallies.align.mode(['edge', 'center', 'right']) as ContractTextAlign | undefined) ?? (align === 'edge' ? 'justify' : base.textAlign);
        })(),
        lineHeight: tallies.pitch.mode() ?? options.lineHeight ?? base.lineHeight,
        spaceBeforePt: id === 'heading' || id === 'title' ? tallies.before.mode() ?? base.spaceBeforePt : 0,
        spaceAfterPt: tallies.after.mode() ?? base.spaceAfterPt,
        indentPt: id === 'point' || id === 'subpoint' || id === 'subsubpoint' ? tallies.indent.mode() ?? base.indentPt : 0,
        keepWithNext: id === 'heading' || id === 'title',
      };
    });
    // Brakujące style dziedziczą po pokrewnych (np. „Podpunkt 2. stopnia” po „Podpunkcie”).
    const body = derived.body ?? derived.point ?? fallback.styles.body;
    derived.body = derived.body ?? { ...body, textAlign: body.textAlign, spaceBeforePt: 0, indentPt: 0, keepWithNext: false };
    derived.point = derived.point ?? { ...derived.body, indentPt: fallback.styles.point.indentPt, spaceAfterPt: fallback.styles.point.spaceAfterPt };
    derived.subpoint = derived.subpoint ?? { ...derived.point };
    derived.subsubpoint = derived.subsubpoint ?? { ...derived.subpoint };
    derived.heading = derived.heading ?? { ...derived.body, bold: true, textAlign: 'center', spaceBeforePt: 7, spaceAfterPt: 4, keepWithNext: true };
    derived.title = derived.title ?? { ...derived.heading, fontSizePt: derived.heading.fontSizePt + 2.5, spaceBeforePt: 0, spaceAfterPt: 10 };
    derived.table = derived.table ?? { ...derived.body, textAlign: 'center', spaceAfterPt: 0 };
    const documentStyles = resolveContractDocumentStyles({ version: 1, styles: derived as Record<ContractStyleId, ContractDocumentStyle> });

    // 3. Przepisanie treści: znacznik stylu + tylko faktyczne wyjątki.
    let removedDeclarations = 0;
    let directFormatting = 0;
    const countDeclarations = (element: Element) => (element.getAttribute('style') || '').split(';').filter((part) => part.includes(':')).length;

    // Docelowe pogrubienie / kursywa / kolor bloku po konwersji — punkt odniesienia dla fragmentów wewnątrz.
    const target = new Map<Element, { weight: number; italic: boolean; color: string }>();

    blocks.forEach((block) => {
      const info = measured.get(block)!;
      const declared = countDeclarations(block);
      const keep: string[] = [];
      if (info.role) {
        const style = documentStyles.styles[info.role];
        block.setAttribute(CONTRACT_STYLE_ATTRIBUTE, info.role);
        const neutralAlign = info.lines <= 1 && (info.align === 'left' || info.align === 'justify') &&
          (style.textAlign === 'left' || style.textAlign === 'justify');
        if (info.role !== 'heading' && info.align !== style.textAlign && info.textLength > 0 && !neutralAlign) {
          keep.push(`text-align:${info.align}`);
        }
        if (info.textLength > 0 && Math.abs(info.fontSizePt - style.fontSizePt) >= 0.75) keep.push(`font-size:${round(info.fontSizePt, 0.5)}pt`);
        const bold = info.ownWeight >= 600;
        if (info.textLength > 0 && bold !== style.bold && info.uniformWeight >= 0.95 && block.tagName !== 'LI') {
          keep.push(`font-weight:${bold ? 700 : 400}`);
        }
        if (info.textLength > 0 && info.color !== style.color && info.color !== '#000000') keep.push(`color:${info.color}`);
        if (info.marginLeftPt > 1 && !block.closest('li')) keep.push(`margin-left:${info.marginLeftPt}pt`);
        target.set(block, {
          weight: keep.some((part) => part.startsWith('font-weight:7')) ? 700 : keep.some((part) => part.startsWith('font-weight:4')) ? 400 : style.bold ? 700 : 400,
          italic: style.italic,
          color: keep.find((part) => part.startsWith('color:'))?.slice(6) ?? style.color,
        });
      } else {
        block.removeAttribute(CONTRACT_STYLE_ATTRIBUTE);
      }
      if (block.closest('table') || block.tagName === 'TD' || block.tagName === 'TH') {
        (block.getAttribute('style') || '').split(';').forEach((part) => {
          const index = part.indexOf(':');
          if (index <= 0) return;
          const property = part.slice(0, index).trim().toLowerCase();
          if (TABLE_PROPERTIES.has(property) && property !== 'margin-top') keep.push(`${property}:${part.slice(index + 1).trim()}`);
        });
      }
      if (keep.length && info.role) directFormatting += 1;
      removedDeclarations += Math.max(0, declared - keep.length);
      if (keep.length) block.setAttribute('style', `${keep.join(';')};`); else block.removeAttribute('style');
    });

    content.querySelectorAll<HTMLElement>('ol, ul, table, tr, tbody, thead').forEach((element) => {
      const declared = countDeclarations(element);
      const keep: string[] = [];
      (element.getAttribute('style') || '').split(';').forEach((part) => {
        const index = part.indexOf(':');
        if (index <= 0) return;
        const property = part.slice(0, index).trim().toLowerCase();
        const value = part.slice(index + 1).trim();
        if (element.tagName === 'TABLE' && TABLE_PROPERTIES.has(property)) keep.push(`${property}:${value}`);
        if ((element.tagName === 'OL' || element.tagName === 'UL') && property === 'list-style-type' && /none/.test(value)) keep.push('list-style-type:none');
      });
      removedDeclarations += Math.max(0, declared - keep.length);
      if (keep.length) element.setAttribute('style', `${keep.join(';')};`); else element.removeAttribute('style');
    });

    const contextOf = (element: Element): { weight: number; italic: boolean; color: string } => {
      const parent = element.parentElement;
      if (!parent || parent === content) return { weight: 400, italic: false, color: '#000000' };
      if (target.has(parent)) return target.get(parent)!;
      const facts = inlineFacts.get(parent);
      if (facts) return facts;
      return contextOf(parent);
    };
    // Fragmenty wiersza: pogrubienie, kursywa, podkreślenie i przekreślenie jako znaczniki; kolor tylko gdy inny.
    // Od najgłębszych, żeby rozpakowanie elementu nie zmieniało kontekstu jeszcze nieprzetworzonych.
    inlines.reverse().forEach((element) => {
      const facts = inlineFacts.get(element)!;
      const context = contextOf(element);
      removedDeclarations += countDeclarations(element);
      const wrappers: string[] = [];
      const keep: string[] = [];
      // Fragment złożony wyłącznie z pogrubionego (albo wyłącznie zwykłego) tekstu — liczy się to, co widać.
      const bold = facts.boldShare >= 0.999 ? true : facts.boldShare <= 0.001 ? false : facts.weight >= 600;
      const contextBold = context.weight >= 600;
      if (bold && !contextBold) wrappers.push('strong');
      if (!bold && contextBold) keep.push('font-weight:400');
      if (facts.italic && !context.italic) wrappers.push('em');
      if (facts.underline) wrappers.push('u');
      if (facts.strike) wrappers.push('s');
      if (facts.color !== context.color && facts.color !== '#000000') keep.push(`color:${facts.color}`);
      // Kontekst dla rodzica po zmianie: ten element już nie dziedziczy niczego po swoim starym stylu.
      inlineFacts.set(element, { ...facts, weight: bold ? 700 : contextBold ? 400 : context.weight });

      const dataAttributes = Array.from(element.attributes).filter((attribute) => attribute.name.startsWith('data-'));
      const classes = Array.from(element.classList).filter((name) => KEPT_CLASSES.test(name));
      const isLink = element.tagName === 'A' && element.hasAttribute('href');
      const isScript = element.tagName === 'SUP' || element.tagName === 'SUB';
      const fragment = doc.createDocumentFragment();
      let innermost: Node = fragment;
      wrappers.forEach((tag) => {
        const wrapper = doc.createElement(tag);
        innermost.appendChild(wrapper);
        innermost = wrapper;
      });
      while (element.firstChild) innermost.appendChild(element.firstChild);

      if (dataAttributes.length || keep.length || isLink || isScript || classes.length) {
        // Element zostaje (pola, linia nagłówka, odnośnik, indeks górny) — bez zbędnych stylów.
        Array.from(element.attributes).forEach((attribute) => {
          if (!attribute.name.startsWith('data-') && !(isLink && attribute.name === 'href')) element.removeAttribute(attribute.name);
        });
        if (classes.length) element.className = classes.join(' ');
        if (keep.length) element.setAttribute('style', `${keep.join(';')};`);
        const tag = element.tagName;
        if (/^(?:B|STRONG|EM|I|U|S|STRIKE|DEL|FONT)$/.test(tag) && !dataAttributes.length) {
          const span = doc.createElement('span');
          Array.from(element.attributes).forEach((attribute) => span.setAttribute(attribute.name, attribute.value));
          span.appendChild(fragment);
          element.replaceWith(span);
        } else {
          element.appendChild(fragment);
        }
      } else {
        element.replaceWith(fragment);
      }
    });

    // Klasy techniczne edytora i przeglądarki, puste fragmenty, sąsiednie jednakowe znaczniki.
    content.querySelectorAll<HTMLElement>('[class]').forEach((element) => {
      const classes = Array.from(element.classList).filter((name) => KEPT_CLASSES.test(name));
      if (classes.length) element.className = classes.join(' '); else element.removeAttribute('class');
    });
    content.querySelectorAll('strong, em, u, s').forEach((element) => {
      if (!element.textContent && !element.querySelector('img, br')) element.remove();
    });
    let merged = true;
    while (merged) {
      merged = false;
      content.querySelectorAll('strong, em, u, s').forEach((element) => {
        const next = element.nextSibling;
        if (next instanceof HTMLElement && next.tagName === element.tagName && !next.attributes.length && !element.attributes.length) {
          while (next.firstChild) element.appendChild(next.firstChild);
          next.remove();
          merged = true;
        }
      });
    }
    // Pogrubienie w pogrubieniu, kursywa w kursywie — wewnętrzny znacznik jest zbędny.
    content.querySelectorAll('strong strong, em em, u u, s s').forEach((element) => {
      if (!element.attributes.length) element.replaceWith(...Array.from(element.childNodes));
    });
    // Owinięcia bez znaczenia (kopia strony, edytor) — zbędne po przeniesieniu wyglądu do stylów.
    let unwrapped = true;
    while (unwrapped) {
      unwrapped = false;
      content.querySelectorAll('div').forEach((wrapper) => {
        if (wrapper.attributes.length || wrapper.closest('li, td, th') || !wrapper.querySelector(':scope > p, :scope > div, :scope > ol, :scope > ul, :scope > table, :scope > h1, :scope > h2, :scope > h3, :scope > pre')) return;
        wrapper.replaceWith(...Array.from(wrapper.childNodes));
        unwrapped = true;
      });
    }
    content.normalize();

    const lostSizes = Array.from(measured.values()).filter((info) => info.role && info.textLength > 0 &&
      Math.abs(info.fontSizePt - documentStyles.styles[info.role].fontSizePt) >= 0.75).length;
    if (lostSizes) warnings.push(`${lostSizes} akapitów ma inny rozmiar tekstu niż ich styl — zostawiono go jako formatowanie bezpośrednie.`);

    const output = content.innerHTML;
    return {
      html: output,
      documentStyles,
      report: { sizeBefore, sizeAfter: output.length, styleCounts, directFormatting, removedDeclarations, warnings },
    };
  } finally {
    host.remove();
  }
}
