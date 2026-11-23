import { degrees, rgb, type PDFDocument, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import { WEDDING_DEPOSIT_DEFAULT } from './shared/weddingPricingDefaults';

/*
 * Wycena w stylu weselnym (`design_config.pricing_style = 'wedding'` w kategorii szablonu, np. Wesela-PDF): strona
 * „WASZA WYCENA” zamiast tabeli kalkulacji. Oferta jest skrojona pod wydarzenie — tylko pozycje tej oferty (pełny cennik
 * sezonu należy do broszury): nazwa, ilość × cena, kwota, dodatki pakietu pod pozycją, rabat i VAT w podsumowaniu, razem do
 * zapłaty, zadatek (`deposit_percent`, liczony od kwoty do zapłaty) z pozostałą kwotą i warunki (`wedding_terms_text`,
 * wiersz = warunek). Dużo pozycji — kolejne strony „ciąg dalszy”. Stopkę i numer strony dokłada wspólna pętla dokumentu.
 *
 * Moduł nie zależy od reszty generatora (same dane, kroje i kolory), więc da się go sprawdzić osobno.
 */

/** Pozycja wyceny (wiersz z `pricingItems` generatora: po rozwinięciu dodatków i rabatach pozycji). */
export type WeddingPricingRow = {
  name: string;
  quantity: number;
  days: number;
  unit: string;
  unitPrice: number;
  /** Kwota wiersza (po rabacie pozycji, jeśli PDF pokazuje rabaty przy pozycjach albo tylko ceny po rabacie). */
  amount: number;
  /** Kwota przed rabatem pozycji — tylko gdy PDF pokazuje rabat przy pozycji. */
  listAmount: number | null;
  discountPercent: number;
  /** Dodatek pakietu (wiersz pod pozycją główną). */
  addon: boolean;
};

export type WeddingPricingSummary = {
  rowsTotal: number;
  discount: number;
  discountPercent: number;
  net: number;
  vat: number;
  vatLabel: string;
  total: number;
  depositPercent: number;
  deposit: number;
  balance: number;
};

export type WeddingPricingInput = {
  english: boolean;
  rows: WeddingPricingRow[];
  summary: WeddingPricingSummary;
  offerNumber: string;
  /** Wydarzenie, termin, miejsce. */
  subtitle: string;
  client: string;
  /** Wiersze informacji pod nagłówkiem (sezon cennika, ważność oferty, źródło wyceny). */
  notes: string[];
  terms: string[];
  fonts: { regular: PDFFont; bold: PDFFont; heading: PDFFont };
  colors: { primary: string; accent: string; surface: string };
};

const round = (value: number) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

/** Wiersze strony z wierszy wyceny generatora (`pricingItems`). */
export function weddingPricingRows(items: any[], showLineDiscounts: boolean): WeddingPricingRow[] {
  return items.map((item) => {
    const amount = round(Number(item.subtotal ?? 0));
    const list = item.list_subtotal == null ? null : round(Number(item.list_subtotal));
    const percent = Number(item.line_discount_percent || 0);
    const discounted = showLineDiscounts && percent > 0 && list !== null && list > amount;
    return {
      name: String(item.name || '').trim(),
      quantity: Number(item.quantity ?? 1),
      days: Math.max(1, Number(item.days ?? 1)),
      unit: String(item.unit || '').trim(),
      unitPrice: round(Number(item.unit_price ?? 0)),
      amount,
      listAmount: discounted ? list : null,
      discountPercent: discounted ? percent : 0,
      addon: Boolean(item.pricing_parent_id) && String(item.id) !== String(item.pricing_parent_id),
    };
  });
}

/**
 * Podsumowanie: rabat to różnica między sumą wierszy a wartością netto oferty (rabat całej oferty albo łączny), VAT — różnica
 * brutto i netto, zadatek od kwoty do zapłaty. Dzięki temu kwoty na stronie zawsze się sumują.
 */
export function weddingPricingSummary(input: {
  rows: WeddingPricingRow[];
  totalNet: number;
  totalGross: number;
  vatRates: number[];
  depositPercent: unknown;
}): WeddingPricingSummary {
  const rowsTotal = round(input.rows.reduce((sum, row) => sum + row.amount, 0));
  const net = round(input.totalNet);
  const gap = round(rowsTotal - net);
  const discount = gap >= 0.01 ? gap : 0;
  const vat = Math.max(0, round(input.totalGross - net));
  const rates = [...new Set(input.vatRates.filter((rate) => Number.isFinite(rate) && rate > 0).map((rate) => round(rate)))];
  const total = round(net + vat);
  const requested = input.depositPercent == null || input.depositPercent === '' ? NaN : Number(input.depositPercent);
  const depositPercent = Number.isFinite(requested) ? Math.min(100, Math.max(0, Math.round(requested))) : WEDDING_DEPOSIT_DEFAULT;
  const deposit = depositPercent > 0 ? round(total * depositPercent / 100) : 0;
  return {
    rowsTotal,
    discount,
    discountPercent: discount > 0 && rowsTotal > 0 ? discount / rowsTotal * 100 : 0,
    net,
    vat,
    vatLabel: rates.length === 1 ? `VAT ${String(rates[0]).replace('.', ',')}%` : 'VAT',
    total,
    depositPercent,
    deposit,
    balance: round(total - deposit),
  };
}

/** Sezon cennika do zdania „Ceny według cennika na …”: „sezon 2027” dla pełnego roku, inaczej „okres 01.05.2027 – 30.09.2027”. */
export function weddingSeasonLabel(from: string, to: string, english: boolean) {
  const date = (value: string) => {
    const [year, month, day] = String(value || '').slice(0, 10).split('-');
    return year && month && day ? `${day}.${month}.${year}` : String(value || '');
  };
  const fromYear = String(from || '').slice(0, 4);
  if (/^\d{4}-01-01/.test(from) && String(to || '').startsWith(`${fromYear}-12-31`)) {
    return english ? `${fromYear} season` : `sezon ${fromYear}`;
  }
  return `${english ? 'period' : 'okres'} ${date(from)} – ${date(to)}`;
}

/** Warunki: wiersz = warunek, bez pustych i powtórzeń. */
export function weddingTerms(text: unknown) {
  const seen = new Set<string>();
  return String(text ?? '').split(/\r?\n/)
    .map((line) => line.replace(/^[\s•\-–—*]+/, '').replace(/\s+/g, ' ').trim())
    .filter((line) => {
      const key = line.toLocaleLowerCase('pl-PL');
      if (!line || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 12);
}

const LABELS = {
  pl: {
    title: 'WASZA WYCENA', continued: 'WASZA WYCENA · CIĄG DALSZY', offer: 'OFERTA NR', client: 'Dla:', item: 'POZYCJA', amount: 'KWOTA',
    itemsTotal: 'Suma pozycji', discount: 'Rabat', net: 'Wartość netto', total: 'RAZEM', totalGross: 'RAZEM DO ZAPŁATY',
    deposit: (percent: number) => `Zadatek ${percent}% przy podpisaniu umowy`, balance: 'Pozostało do zapłaty', terms: 'WARUNKI',
    before: 'przed rabatem', days: 'dni', vatNote: 'Kwoty pozycji netto, VAT doliczony w podsumowaniu.', currency: 'zł',
  },
  en: {
    title: 'YOUR QUOTE', continued: 'YOUR QUOTE · CONTINUED', offer: 'OFFER NO.', client: 'For:', item: 'ITEM', amount: 'AMOUNT',
    itemsTotal: 'Items total', discount: 'Discount', net: 'Net value', total: 'TOTAL', totalGross: 'TOTAL TO PAY',
    deposit: (percent: number) => `${percent}% deposit on signing the contract`, balance: 'Balance', terms: 'TERMS',
    before: 'before discount', days: 'days', vatNote: 'Item amounts exclude VAT; VAT is added in the summary.', currency: 'PLN',
  },
};

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const LEFT = 45;
const RIGHT = PAGE_WIDTH - 45;
/** Dół treści (od góry strony) — niżej jest stopka dokumentu. */
const CONTENT_BOTTOM = 770;

const hexColor = (hex: string, fallback: string): RGB => {
  const value = /^#?([\da-f]{6})$/i.exec(String(hex || ''))?.[1] || fallback.slice(1);
  return rgb(parseInt(value.slice(0, 2), 16) / 255, parseInt(value.slice(2, 4), 16) / 255, parseInt(value.slice(4, 6), 16) / 255);
};

/** Kwoty bez groszy, gdy wszystkie na stronie są pełne; inaczej wszystkie z groszami. Grupy tysięcy zawsze (także 4 cyfry). */
function moneyFormatter(amounts: number[], english: boolean, currency: string) {
  const decimals = amounts.some((value) => Math.abs(round(value) - Math.round(value)) >= 0.005) ? 2 : 0;
  return (value: number) => {
    const sign = value < 0 ? '−' : '';
    const [whole, fraction] = Math.abs(round(value)).toFixed(decimals).split('.');
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, english ? ',' : ' ');
    return `${sign}${grouped}${fraction ? (english ? '.' : ',') + fraction : ''} ${currency}`;
  };
}

const quantityText = (value: number, english: boolean) => {
  const text = String(round(value));
  return english ? text : text.replace('.', ',');
};

/** Strony „WASZA WYCENA” dodane na końcu dokumentu; zwraca liczbę stron. */
export function drawWeddingPricingPages(pdf: PDFDocument, input: WeddingPricingInput): number {
  const t = input.english ? LABELS.en : LABELS.pl;
  const { regular, bold, heading } = input.fonts;
  const primary = hexColor(input.colors.primary, '#1c1f33');
  const accent = hexColor(input.colors.accent, '#d3bb73');
  const surface = hexColor(input.colors.surface, '#faf7f2');
  const muted = rgb(0.42, 0.4, 0.38);
  const white = rgb(1, 1, 1);
  const { summary } = input;
  const money = moneyFormatter([
    ...input.rows.flatMap((row) => [row.amount, row.unitPrice, row.listAmount ?? 0]),
    summary.rowsTotal, summary.discount, summary.net, summary.vat, summary.total, summary.deposit, summary.balance,
  ], input.english, t.currency);

  // Znaki spoza kroju: nagłówek przechodzi na krój tekstu, w tekście znak znika (zamiast błędu PDF).
  const charsets = new Map<PDFFont, Set<number>>();
  const supports = (font: PDFFont, text: string) => {
    let set = charsets.get(font);
    if (!set) {
      try { set = new Set(font.getCharacterSet()); } catch { set = new Set(); }
      charsets.set(font, set);
    }
    if (!set.size) return true;
    for (const char of text) if (char !== ' ' && !set.has(char.codePointAt(0)!)) return false;
    return true;
  };
  const clean = (font: PDFFont, text: string) => {
    const value = String(text ?? '').replace(/[\t\r\n]+/g, ' ');
    if (supports(font, value)) return value;
    const set = charsets.get(font)!;
    return [...value].filter((char) => char === ' ' || set.has(char.codePointAt(0)!)).join('');
  };
  const headingFor = (text: string) => (supports(heading, text) ? heading : regular);

  const width = (font: PDFFont, text: string, size: number) => font.widthOfTextAtSize(clean(font, text), size);
  const fit = (font: PDFFont, text: string, size: number, max: number) => {
    let value = clean(font, text).trim();
    if (font.widthOfTextAtSize(value, size) <= max) return value;
    while (value && font.widthOfTextAtSize(`${value}…`, size) > max) value = value.slice(0, -1).trimEnd();
    return `${value}…`;
  };
  const wrap = (font: PDFFont, text: string, size: number, max: number) => {
    const lines: string[] = [];
    for (const paragraph of clean(font, String(text ?? '')).split(/\s*\n\s*/)) {
      let line = '';
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        const candidate = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(candidate, size) <= max) { line = candidate; continue; }
        if (line) lines.push(line);
        line = word;
        // Słowo dłuższe niż wiersz — łamane po znakach.
        while (font.widthOfTextAtSize(line, size) > max && line.length > 1) {
          let cut = line.length - 1;
          while (cut > 1 && font.widthOfTextAtSize(line.slice(0, cut), size) > max) cut -= 1;
          lines.push(line.slice(0, cut));
          line = line.slice(cut);
        }
      }
      if (line) lines.push(line);
    }
    return lines;
  };

  let page: PDFPage = null as unknown as PDFPage;
  let top = 0;
  let pages = 0;
  /** Tekst od górnej krawędzi wiersza (`y` liczone od góry strony). */
  const text = (value: string, x: number, y: number, font: PDFFont, size: number, color: RGB, align: 'left' | 'right' = 'left') => {
    const content = clean(font, value);
    if (!content) return;
    const ascent = font.heightAtSize(size, { descender: false });
    page.drawText(content, { x: align === 'right' ? x - font.widthOfTextAtSize(content, size) : x, y: PAGE_HEIGHT - y - ascent, size, font, color });
  };
  const rule = (y: number, from = LEFT, to = RIGHT, thickness = 0.5, opacity = 0.6) => {
    page.drawLine({ start: { x: from, y: PAGE_HEIGHT - y }, end: { x: to, y: PAGE_HEIGHT - y }, thickness, color: accent, opacity });
  };

  const startPage = (first: boolean) => {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    pages += 1;
    page.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, color: surface });
    const band = first ? 138 : 86;
    page.drawRectangle({ x: 0, y: PAGE_HEIGHT - band, width: PAGE_WIDTH, height: band, color: primary });
    page.drawRectangle({ x: 0, y: PAGE_HEIGHT - band - 3, width: PAGE_WIDTH, height: 3, color: accent });
    if (first) {
      if (input.offerNumber) text(fit(regular, `${t.offer} ${input.offerNumber}`.toLocaleUpperCase('pl-PL'), 8, RIGHT - LEFT), LEFT, 38, regular, 8, accent);
      text(t.title, LEFT, 56, headingFor(t.title), 30, accent);
      if (input.subtitle) text(fit(regular, input.subtitle, 10, RIGHT - LEFT), LEFT, 106, regular, 10, surface);
      top = band + 28;
    } else {
      text(t.continued, LEFT, 34, headingFor(t.continued), 18, accent);
      top = band + 30;
    }
  };
  const columnHeader = () => {
    text(t.item, LEFT, top, regular, 7.5, muted);
    text(t.amount, RIGHT, top, regular, 7.5, muted, 'right');
    rule(top + 14, LEFT, RIGHT, 0.8, 1);
    top += 18;
  };

  startPage(true);
  if (input.client) {
    text(fit(regular, `${t.client} ${input.client}`, 10.5, RIGHT - LEFT), LEFT, top, regular, 10.5, primary);
    top += 18;
  }
  const notes = [...input.notes, ...(summary.vat > 0 ? [t.vatNote] : [])].filter(Boolean);
  for (const line of notes.flatMap((note) => wrap(regular, note, 8.5, RIGHT - LEFT))) {
    text(line, LEFT, top, regular, 8.5, muted);
    top += 12;
  }
  top += input.client || notes.length ? 14 : 0;
  columnHeader();

  // Pozycje: nazwa (dodatek — wcięty, „+”), pod nią ilość × cena i rabat pozycji; kwota w prawej kolumnie.
  const nameWidth = RIGHT - LEFT - 120;
  input.rows.forEach((row, rowIndex) => {
    const indent = row.addon ? 14 : 0;
    const font = row.addon ? regular : bold;
    const size = row.addon ? 9.5 : 10.5;
    const lineHeight = size * 1.32;
    const name = wrap(font, `${row.addon ? '+ ' : ''}${row.name || '—'}`, size, nameWidth - indent);
    const parts: string[] = [];
    if (row.quantity !== 1 || row.days !== 1) {
      const quantity = `${quantityText(row.quantity, input.english)}${row.unit && !input.english ? ` ${row.unit}` : ''}`;
      parts.push([quantity, row.days !== 1 ? `${row.days} ${t.days}` : '', money(row.unitPrice)].filter(Boolean).join(' × '));
    }
    if (row.listAmount !== null && row.discountPercent > 0) {
      parts.push(`${t.discount.toLocaleLowerCase('pl-PL')} ${String(round(row.discountPercent)).replace('.', input.english ? '.' : ',')}% (${t.before} ${money(row.listAmount)})`);
    }
    const detail = parts.length ? wrap(regular, parts.join(' · '), 8.5, nameWidth - indent) : [];
    const height = 8 + name.length * lineHeight + (detail.length ? 2 + detail.length * 11.5 : 0) + 7;
    if (top + height > CONTENT_BOTTOM) {
      startPage(false);
      columnHeader();
    }
    let y = top + 8;
    name.forEach((line, index) => {
      text(line, LEFT + indent, y, font, size, primary);
      if (index === 0) text(money(row.amount), RIGHT, y, font, size, primary, 'right');
      y += lineHeight;
    });
    if (detail.length) {
      y += 2;
      for (const line of detail) {
        text(line, LEFT + indent + (row.addon ? 9 : 0), y, regular, 8.5, muted);
        y += 11.5;
      }
    }
    top += height;
    // Pozycja z dodatkami — kreska dopiero pod ostatnim dodatkiem.
    if (!input.rows[rowIndex + 1]?.addon) rule(top);
  });

  // Podsumowanie, razem i zadatek — jeden blok (nie dzielony między strony).
  const lines: Array<[string, string]> = [];
  if (summary.discount > 0) {
    lines.push([t.itemsTotal, money(summary.rowsTotal)]);
    lines.push([`${t.discount} ${String(round(summary.discountPercent)).replace('.', input.english ? '.' : ',')}%`, money(-summary.discount)]);
  }
  if (summary.vat > 0) {
    lines.push([t.net, money(summary.net)]);
    lines.push([summary.vatLabel, money(summary.vat)]);
  }
  const totalHeight = 58;
  const depositHeight = summary.deposit > 0 ? 56 : 0;
  const block = 16 + (lines.length ? lines.length * 19 + 6 : 0) + totalHeight + (depositHeight ? 10 + depositHeight : 0);
  if (top + block > CONTENT_BOTTOM) startPage(false);
  top += 16;
  const summaryLeft = RIGHT - 270;
  for (const [label, value] of lines) {
    text(label, summaryLeft, top, regular, 9.5, muted);
    text(value, RIGHT, top, regular, 9.5, primary, 'right');
    top += 19;
  }
  if (lines.length) top += 6;

  page.drawRectangle({ x: LEFT, y: PAGE_HEIGHT - top - totalHeight, width: RIGHT - LEFT, height: totalHeight, color: primary });
  const totalLabel = summary.vat > 0 ? t.totalGross : t.total;
  const totalText = money(summary.total);
  const totalSize = Math.min(22, 22 * (RIGHT - LEFT - 220) / Math.max(1, width(bold, totalText, 22)));
  // Wielkie litery i cyfry wyśrodkowane w pasku (wysokość wersalików ok. 0,72 stopnia pisma).
  const centered = (font: PDFFont, size: number) => top + totalHeight / 2 + size * 0.36 - font.heightAtSize(size, { descender: false });
  const totalFont = headingFor(totalLabel);
  text(fit(totalFont, totalLabel, 13, 190), LEFT + 18, centered(totalFont, 13), totalFont, 13, surface);
  text(totalText, RIGHT - 18, centered(bold, totalSize), bold, totalSize, accent, 'right');
  top += totalHeight;

  if (depositHeight) {
    top += 10;
    page.drawRectangle({
      x: LEFT, y: PAGE_HEIGHT - top - depositHeight, width: RIGHT - LEFT, height: depositHeight,
      color: white, borderColor: accent, borderWidth: 0.8,
    });
    const depositLabel = t.deposit(summary.depositPercent);
    text(fit(bold, depositLabel, 10.5, RIGHT - LEFT - 170), LEFT + 18, top + 13, bold, 10.5, primary);
    text(money(summary.deposit), RIGHT - 18, top + 13, bold, 10.5, primary, 'right');
    text(t.balance, LEFT + 18, top + 35, regular, 9.5, muted);
    text(money(summary.balance), RIGHT - 18, top + 35, regular, 9.5, primary, 'right');
    top += depositHeight;
  }

  // Warunki: nagłówek z kreską i wiersze ze złotym rombem; nagłówek nie zostaje sam na dole strony.
  if (input.terms.length) {
    const termWidth = RIGHT - LEFT - 18;
    const items = input.terms.map((term) => wrap(regular, term, 9.5, termWidth));
    const headingHeight = 34;
    const firstItem = items[0].length * 13.5 + 5;
    top += 24;
    if (top + headingHeight + firstItem > CONTENT_BOTTOM) startPage(false);
    const termsFont = headingFor(t.terms);
    text(t.terms, LEFT, top, termsFont, 14, primary);
    page.drawRectangle({ x: LEFT, y: PAGE_HEIGHT - top - 22, width: 42, height: 1.2, color: accent });
    top += headingHeight;
    for (const item of items) {
      const height = item.length * 13.5 + 5;
      if (top + height > CONTENT_BOTTOM) startPage(false);
      // Romb: kwadrat obrócony o 45° wokół lewego dolnego rogu — środek na wysokości środka małych liter.
      page.drawRectangle({
        x: LEFT + 5, y: PAGE_HEIGHT - top - (regular.heightAtSize(9.5, { descender: false }) - 9.5 * 0.27) - 2.97,
        width: 4.2, height: 4.2, color: accent, rotate: degrees(45),
      });
      let y = top;
      for (const line of item) {
        text(line, LEFT + 18, y, regular, 9.5, primary);
        y += 13.5;
      }
      top += height;
    }
  }
  return pages;
}
