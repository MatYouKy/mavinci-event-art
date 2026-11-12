import type { ContractClauseTextStyle, ContractClauseTypography } from './contractPagination';

/**
 * Style dokumentu umowy — jak style akapitu w programie Word.
 *
 * Szablon w nowym formacie (`page_settings.documentStyles`) zapisuje wygląd raz dla całego dokumentu: „Tytuł”,
 * „Nagłówek sekcji”, „Punkt”, „Podpunkt”… Treść ma tylko znaczniki stylu (`data-style`) i bezpośrednie wyjątki
 * (np. wyśrodkowany akapit, kolor fragmentu), a nie powtarzane przy każdym akapicie czcionki, rozmiary i odstępy.
 * Przy przygotowaniu stron (podgląd, PDF) style są nakładane na elementy (`applyContractDocumentStyles`), więc
 * podział na strony A4 i generator PDF działają bez zmian. Klauzule produktów dostają typografię wyliczoną z tych
 * samych stylów — jeden wygląd umowy zamiast dwóch osobnych ustawień.
 */

export const CONTRACT_STYLE_IDS = ['title', 'heading', 'point', 'subpoint', 'subsubpoint', 'body', 'table'] as const;
export type ContractStyleId = (typeof CONTRACT_STYLE_IDS)[number];

export type ContractTextAlign = 'left' | 'center' | 'right' | 'justify';

export interface ContractDocumentStyle {
  fontFamily: string;
  fontSizePt: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  color: string;
  textAlign: ContractTextAlign;
  lineHeight: number;
  spaceBeforePt: number;
  spaceAfterPt: number;
  /** Punkty i podpunkty: odstęp numeru od tekstu nadrzędnego (wcięcie listy). Pozostałe style: wcięcie z lewej. */
  indentPt: number;
  /** Nie zostawiaj samotnie na dole strony — razem z następnym wierszem (nagłówki). */
  keepWithNext: boolean;
}

export interface ContractDocumentStyles {
  version: 1;
  styles: Record<ContractStyleId, ContractDocumentStyle>;
}

export const CONTRACT_STYLE_LABELS: Record<ContractStyleId, string> = {
  title: 'Tytuł',
  heading: 'Nagłówek sekcji',
  point: 'Punkt',
  subpoint: 'Podpunkt',
  subsubpoint: 'Podpunkt 2. stopnia',
  body: 'Zwykły',
  table: 'Tabela',
};

/** Przykład numeracji pokazywany obok nazwy stylu (galeria stylów w edytorze). */
export const CONTRACT_STYLE_HINTS: Record<ContractStyleId, string> = {
  title: 'UMOWA',
  heading: '1. / § 1',
  point: '1.1',
  subpoint: '1.1.1',
  subsubpoint: 'a)',
  body: 'Tekst',
  table: 'Tabela, podpisy',
};

export const CONTRACT_STYLE_ATTRIBUTE = 'data-style';

const DEFAULT_FONT = 'Arial, sans-serif';

const style = (overrides: Partial<ContractDocumentStyle>): ContractDocumentStyle => ({
  fontFamily: DEFAULT_FONT,
  fontSizePt: 8.5,
  bold: false,
  italic: false,
  underline: false,
  color: '#000000',
  textAlign: 'justify',
  lineHeight: 1.45,
  spaceBeforePt: 0,
  spaceAfterPt: 4,
  indentPt: 0,
  keepWithNext: false,
  ...overrides,
});

/** Domyślny zestaw stylów nowego szablonu (wygląd szablonu „UNIWERSALNA”). */
export const createDefaultContractDocumentStyles = (fontFamily = DEFAULT_FONT): ContractDocumentStyles => ({
  version: 1,
  styles: {
    title: style({ fontFamily, fontSizePt: 11, bold: true, textAlign: 'center', lineHeight: 1.2, spaceAfterPt: 10, keepWithNext: true }),
    heading: style({ fontFamily, bold: true, textAlign: 'left', spaceBeforePt: 7, spaceAfterPt: 4, keepWithNext: true }),
    point: style({ fontFamily, spaceAfterPt: 3, indentPt: 22 }),
    subpoint: style({ fontFamily, spaceAfterPt: 2, indentPt: 22 }),
    subsubpoint: style({ fontFamily, spaceAfterPt: 2, indentPt: 22 }),
    body: style({ fontFamily }),
    table: style({ fontFamily, textAlign: 'center', spaceAfterPt: 0 }),
  },
});

const ALIGNMENTS: ContractTextAlign[] = ['left', 'center', 'right', 'justify'];
const finite = (value: unknown, fallback: number, min: number, max: number) => {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};

/** Uzupełnia zapisane style brakującymi wartościami i odrzuca błędne (stare zapisy, ręczne zmiany w bazie). */
export const resolveContractDocumentStyles = (saved?: Partial<ContractDocumentStyles> | null): ContractDocumentStyles => {
  const defaults = createDefaultContractDocumentStyles();
  const styles = {} as Record<ContractStyleId, ContractDocumentStyle>;
  CONTRACT_STYLE_IDS.forEach((id) => {
    const base = defaults.styles[id];
    const value = (saved?.styles?.[id] || {}) as Partial<ContractDocumentStyle>;
    styles[id] = {
      fontFamily: typeof value.fontFamily === 'string' && value.fontFamily.trim() ? value.fontFamily : base.fontFamily,
      fontSizePt: finite(value.fontSizePt, base.fontSizePt, 5, 48),
      bold: typeof value.bold === 'boolean' ? value.bold : base.bold,
      italic: typeof value.italic === 'boolean' ? value.italic : base.italic,
      underline: typeof value.underline === 'boolean' ? value.underline : base.underline,
      color: typeof value.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(value.color) ? value.color : base.color,
      textAlign: ALIGNMENTS.includes(value.textAlign as ContractTextAlign) ? (value.textAlign as ContractTextAlign) : base.textAlign,
      lineHeight: finite(value.lineHeight, base.lineHeight, 0.7, 3),
      spaceBeforePt: finite(value.spaceBeforePt, base.spaceBeforePt, 0, 72),
      spaceAfterPt: finite(value.spaceAfterPt, base.spaceAfterPt, 0, 72),
      indentPt: finite(value.indentPt, base.indentPt, 0, 144),
      keepWithNext: typeof value.keepWithNext === 'boolean' ? value.keepWithNext : base.keepWithNext,
    };
  });
  return { version: 1, styles };
};

export const isContractDocumentStylesTemplate = (settings: { documentStyles?: unknown } | null | undefined) =>
  Boolean(settings && typeof settings.documentStyles === 'object' && settings.documentStyles &&
    typeof (settings.documentStyles as ContractDocumentStyles).styles === 'object');

// MARK: Klauzule produktów — typografia z tych samych stylów

const clauseStyle = (source: ContractDocumentStyle, overrides: Partial<ContractClauseTextStyle> = {}): ContractClauseTextStyle => ({
  fontFamily: source.fontFamily,
  fontSizePt: source.fontSizePt,
  fontWeight: source.bold ? 700 : 400,
  lineHeight: source.lineHeight,
  spaceBeforePt: source.spaceBeforePt,
  spaceAfterPt: source.spaceAfterPt,
  textAlign: source.textAlign,
  ...overrides,
});

/** Typografia klauzul produktów wyliczona ze stylów dokumentu (zastępuje osobne ustawienie „Typografia klauzul”). */
export const contractClauseTypographyFromStyles = (documentStyles: ContractDocumentStyles): ContractClauseTypography => {
  const { styles } = documentStyles;
  return {
    paragraphHeading: clauseStyle(styles.heading),
    title: clauseStyle(styles.point, { fontWeight: 700 }),
    body: clauseStyle(styles.body),
    list: clauseStyle(styles.point),
    subpoint: clauseStyle(styles.subpoint),
    emphasisWeight: 700,
    italicEnabled: true,
    underlineEnabled: true,
  };
};

// MARK: Rozpoznanie stylu elementu

const CONTAINER_DESCENDANTS = 'p, div, ol, ul, table, h1, h2, h3, h4, h5, h6, pre, blockquote';
const BLOCK_TAGS = new Set(['P', 'DIV', 'PRE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'TD', 'TH', 'BLOCKQUOTE']);
const HEADING_LINE_SELECTOR = '[data-contract-keep-with-next="true"]';

const isStyleId = (value: string | null | undefined): value is ContractStyleId =>
  Boolean(value && (CONTRACT_STYLE_IDS as readonly string[]).includes(value));

/** Pierwszy element dziecka punktu jest linią nagłówka sekcji (np. „1. Przedmiot umowy” nad listą 1.1, 1.2…). */
export const contractHeadingLine = (item: Element): HTMLElement | null => {
  const first = Array.from(item.children).find((child) => child.tagName !== 'BR') as HTMLElement | undefined;
  return first && first.matches(HEADING_LINE_SELECTOR) ? first : null;
};

/** Punkt listy będący sekcją umowy: linia nagłówka i lista punktów pod nią. */
export const isContractSectionItem = (item: Element) => {
  if (item.tagName !== 'LI') return false;
  if (item.getAttribute(CONTRACT_STYLE_ATTRIBUTE) === 'heading') return true;
  return Boolean(contractHeadingLine(item)) && Array.from(item.children).some((child) => child.matches('ol, ul'));
};

const listLevel = (item: Element, boundary: Element | null) => {
  let level = 1;
  let parent = item.parentElement?.closest('li');
  while (parent && parent !== boundary && (!boundary || boundary.contains(parent))) {
    if (!isContractSectionItem(parent)) level += 1;
    parent = parent.parentElement?.closest('li');
  }
  return level;
};

const styleForListLevel = (level: number): ContractStyleId =>
  level <= 1 ? 'point' : level === 2 ? 'subpoint' : 'subsubpoint';

/**
 * Styl elementu: zapisany znacznik `data-style` albo rozpoznany ze struktury (dla starych treści i klauzul).
 * Zwraca `null` dla elementów bez własnego stylu (tekst w punkcie, fragmenty wiersza) — dziedziczą po bloku nadrzędnym.
 */
export const inferContractStyle = (element: Element, boundary: Element | null = null): ContractStyleId | null => {
  const explicit = element.getAttribute(CONTRACT_STYLE_ATTRIBUTE);
  if (isStyleId(explicit)) return explicit;
  const tag = element.tagName;
  if (!BLOCK_TAGS.has(tag)) return null;
  if (tag === 'H1') return 'title';
  if (/^H[2-6]$/.test(tag)) return 'heading';
  if (element.classList.contains('contract-paragraph-heading') || element.getAttribute('data-contract-paragraph') === 'true') return 'heading';
  if (tag === 'LI') return isContractSectionItem(element) ? 'heading' : styleForListLevel(listLevel(element, boundary));
  if (tag === 'TD' || tag === 'TH') return 'table';
  // Kontenery (owinięcie całej treści, miejsca na klauzule) nie są akapitami.
  if (element.matches('[data-contract-clause-slot], .contract-product-clauses, .product-contract-clause')) return null;
  if ((tag === 'DIV' || tag === 'BLOCKQUOTE') && element.querySelector(CONTAINER_DESCENDANTS)) return null;
  // Akapit wewnątrz punktu lub komórki należy do nich (np. wspólna zasada w <li><p>…</p></li>).
  const owner = element.parentElement?.closest('li, td, th');
  if (owner && (!boundary || boundary.contains(owner))) return null;
  // Akapit z samym „§ 1” (lub „§n”) to nagłówek paragrafu.
  const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
  if (/^§\s*(?:\d+|n)\b/u.test(text) && text.length <= 80) return 'heading';
  return 'body';
};

// MARK: Nakładanie stylów (podgląd, podział na strony, PDF)

type Declarations = Map<string, string>;

const parseStyleAttribute = (value: string | null): Declarations => {
  const result: Declarations = new Map();
  (value || '').split(';').forEach((part) => {
    const index = part.indexOf(':');
    if (index <= 0) return;
    const property = part.slice(0, index).trim().toLowerCase();
    const raw = part.slice(index + 1).trim().replace(/\s*!important\s*$/i, '');
    if (property && raw) result.set(property, raw);
  });
  return result;
};

const fontDeclarations = (source: ContractDocumentStyle): Declarations => new Map([
  ['font-family', source.fontFamily],
  ['font-size', `${source.fontSizePt}pt`],
  ['font-weight', source.bold ? '700' : '400'],
  ['font-style', source.italic ? 'italic' : 'normal'],
  ['text-decoration', source.underline ? 'underline' : 'none'],
  ['color', source.color],
  ['line-height', String(source.lineHeight)],
  ['text-align', source.textAlign],
]);

const setAll = (element: HTMLElement, declarations: Declarations, own: Declarations) => {
  declarations.forEach((value, property) => {
    // Formatowanie bezpośrednie elementu (jak w Wordzie) ma pierwszeństwo przed stylem.
    const direct = own.get(property);
    element.style.setProperty(property, direct ?? value, 'important');
  });
  own.forEach((value, property) => {
    if (!declarations.has(property)) element.style.setProperty(property, value, 'important');
  });
};

const INHERIT_TEXT: Declarations = new Map([
  ['font-family', 'inherit'],
  ['font-size', 'inherit'],
  ['font-weight', 'inherit'],
  ['font-style', 'inherit'],
  ['color', 'inherit'],
  ['line-height', 'inherit'],
  ['text-align', 'inherit'],
  ['margin-top', '0'],
  ['margin-bottom', '0'],
]);

/**
 * Nakłada style dokumentu na treść szablonu (poza klauzulami produktów, które mają własną, wyliczoną z tych samych
 * stylów typografię). Wynik ma style w atrybutach elementów — tak jak dotychczasowe szablony — więc podział na strony
 * i PDF liczą wysokości dokładnie tak samo jak dla starego formatu.
 */
export const applyContractDocumentStyles = (root: HTMLElement, documentStyles: ContractDocumentStyles) => {
  const { styles } = documentStyles;
  const elements = Array.from(root.querySelectorAll<HTMLElement>('*'));
  elements.forEach((element) => {
    if (element.closest('.product-contract-clause')) return;
    const own = parseStyleAttribute(element.getAttribute('style'));
    const tag = element.tagName;
    // Arkusz umowy wyświetla elementy najwyższego poziomu jako bloki; tabela (np. podpisy) musi zostać tabelą.
    if (tag === 'TABLE') element.style.setProperty('display', own.get('display') || 'table', 'important');
    const id = inferContractStyle(element, root);

    if (!id) {
      if ((tag === 'P' || tag === 'DIV' || tag === 'PRE') && element.parentElement?.closest('li, td, th')) {
        setAll(element, INHERIT_TEXT, own);
      }
      return;
    }

    const source = styles[id];
    const declarations = fontDeclarations(source);

    if (tag === 'LI' && id === 'heading') {
      // Sekcja: numer i linia nagłówka w stylu nagłówka, odstęp po nagłówku pod linią, lista punktów bez marginesów.
      declarations.set('margin-top', `${source.spaceBeforePt}pt`);
      declarations.set('margin-bottom', '0');
      setAll(element, declarations, own);
      const line = contractHeadingLine(element);
      if (line) {
        const lineOwn = parseStyleAttribute(line.getAttribute('style'));
        setAll(line, new Map([['display', 'block'], ['margin-bottom', `${source.spaceAfterPt}pt`]]), lineOwn);
      }
      Array.from(element.children).filter((child): child is HTMLElement => child.matches('ol, ul')).forEach((list) => {
        list.style.setProperty('margin-top', '0', 'important');
        list.style.setProperty('margin-bottom', '0', 'important');
      });
    } else if (tag === 'LI') {
      declarations.set('margin-top', `${source.spaceBeforePt}pt`);
      declarations.set('margin-bottom', `${source.spaceAfterPt}pt`);
      setAll(element, declarations, own);
      const list = element.parentElement;
      if (list && (list.tagName === 'OL' || list.tagName === 'UL')) {
        const listOwn = parseStyleAttribute(list.getAttribute('style'));
        if (!listOwn.has('padding-left')) list.style.setProperty('padding-left', `${source.indentPt}pt`, 'important');
        if (!list.parentElement?.closest('li')) {
          list.style.setProperty('margin-top', '0', 'important');
          list.style.setProperty('margin-bottom', '0', 'important');
        }
      }
    } else if (tag === 'TD' || tag === 'TH') {
      setAll(element, declarations, own);
    } else {
      declarations.set('margin-top', `${source.spaceBeforePt}pt`);
      declarations.set('margin-bottom', `${source.spaceAfterPt}pt`);
      if (source.indentPt > 0) declarations.set('margin-left', `${source.indentPt}pt`);
      setAll(element, declarations, own);
    }

    if (source.keepWithNext && tag !== 'LI') element.setAttribute('data-contract-keep-with-next', 'true');
  });
};

// MARK: Arkusz stylów (edytor)

const cssDeclarations = (source: ContractDocumentStyle) =>
  `font-family:${source.fontFamily};font-size:${source.fontSizePt}pt;font-weight:${source.bold ? 700 : 400};` +
  `font-style:${source.italic ? 'italic' : 'normal'};text-decoration:${source.underline ? 'underline' : 'none'};` +
  `color:${source.color};line-height:${source.lineHeight};text-align:${source.textAlign};`;

/**
 * Arkusz stylów dla edytora szablonu: te same style co w podglądzie i PDF, ale jako reguły CSS (treść w edytorze
 * pozostaje czysta). `scope` — selektor kontenera edytora.
 */
export const buildContractDocumentStylesCss = (documentStyles: ContractDocumentStyles, scope: string) => {
  const { styles } = documentStyles;
  const rules: string[] = [];
  const block = (selector: string, source: ContractDocumentStyle, extra = '') =>
    rules.push(`${selector}{${cssDeclarations(source)}margin-top:${source.spaceBeforePt}pt;margin-bottom:${source.spaceAfterPt}pt;${extra}}`);
  block(`${scope} [data-style="title"]`, styles.title);
  block(`${scope} [data-style="body"]`, styles.body, styles.body.indentPt ? `margin-left:${styles.body.indentPt}pt;` : '');
  block(`${scope} p[data-style="heading"], ${scope} h2[data-style="heading"], ${scope} h3[data-style="heading"]`, styles.heading);
  rules.push(`${scope} li[data-style="heading"]{${cssDeclarations(styles.heading)}margin-top:${styles.heading.spaceBeforePt}pt;margin-bottom:0;}`);
  rules.push(`${scope} li[data-style="heading"] > [data-contract-keep-with-next="true"]{display:block;margin-bottom:${styles.heading.spaceAfterPt}pt;}`);
  rules.push(`${scope} li[data-style="heading"] > ol, ${scope} li[data-style="heading"] > ul{margin-top:0;margin-bottom:0;}`);
  (['point', 'subpoint', 'subsubpoint'] as const).forEach((id) => {
    block(`${scope} li[data-style="${id}"]`, styles[id]);
    rules.push(`${scope} ol:has(> li[data-style="${id}"]), ${scope} ul:has(> li[data-style="${id}"]){padding-left:${styles[id].indentPt}pt;}`);
  });
  rules.push(`${scope} td[data-style="table"], ${scope} th[data-style="table"]{${cssDeclarations(styles.table)}}`);
  rules.push(`${scope} li > p, ${scope} li > div, ${scope} td > p, ${scope} td > div{font:inherit;color:inherit;line-height:inherit;text-align:inherit;margin-top:0;margin-bottom:0;}`);
  return rules.join('\n');
};
