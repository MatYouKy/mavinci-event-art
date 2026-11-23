import {
  showcaseMediaKey, type ShowcaseBlock, type ShowcaseContent, type ShowcaseMedia, type ShowcaseUrls,
} from '@/lib/showcase/showcaseShared';

/*
 * Rozdziały oferty z Prezentacji (`design_config.chapter_item_ids` kategorii szablonu): wybrane karty z Prezentacji
 * („Jak to robimy?”, „Zespół”…) jako strony PDF po stronie „O nas”, przed stronami produktów. Treść żyje w jednym miejscu —
 * zmiana karty (tekst, zdjęcie, osoba) zmienia kolejne oferty. Na stronę trafia: zdjęcie główne, tytuł, hasło, wstęp
 * i bloki: tekst, punkty (kafelki, kroki, lista ✓), zdjęcia (duże, siatka), specyfikacja, pytania klientów. Bez bloków
 * „Z katalogu produktów” (ceny katalogowe — wycena jest na stronie wyceny) i „Realizacje” (strona www).
 *
 * Ten plik buduje HTML (bez zależności serwera — da się go sprawdzić osobno); PDF składa Chromium
 * (`chapterPages.server.ts`), strony trafiają do dokumentu oferty, a stopkę i numery stron dokłada wspólna pętla.
 */

export const CHAPTER_LIMITS = { chapters: 12, largePhotos: 4, gridPhotos: 12, photosTotal: 48 } as const;

export type ChapterPhoto = { url: string; caption: string; width: number | null; height: number | null };
export type ChapterBlock =
  | { kind: 'text'; title: string; paragraphs: string[] }
  | { kind: 'points'; style: 'benefits' | 'steps' | 'checklist'; title: string; intro: string; rows: Array<{ title: string; text: string }> }
  | { kind: 'photos'; style: 'large' | 'grid'; title: string; intro: string; photos: ChapterPhoto[] }
  | { kind: 'specs' | 'faq'; title: string; intro: string; rows: Array<{ title: string; text: string }> };
export type Chapter = { title: string; tagline: string; lead: string; hero: ChapterPhoto | null; blocks: ChapterBlock[] };

export type ChapterDocument = {
  chapters: Chapter[];
  colors: { primary: string; accent: string; surface: string };
  /** Kroje jako adresy `data:` (Chromium nie pobiera ich z sieci); bez kroju nagłówków — krój tekstu. */
  fonts: { heading: string | null; regular: string; bold: string };
  /** Napis nad tytułem (np. nazwa marki). */
  eyebrow: string;
};

const paragraphs = (value: string) => value.split(/\n\s*\n|\n/).map((line) => line.trim()).filter(Boolean);
const rowsOf = (block: ShowcaseBlock) => block.rows
  .map((row) => ({ title: row.title.trim(), text: row.text.trim() }))
  .filter((row) => row.title || row.text);

/** Karta Prezentacji → rozdział (adresy zdjęć z `showcaseMediaUrls`; zdjęcie bez adresu jest pomijane). */
export function chapterFromShowcase(
  item: { title: string; tagline: string; content: ShowcaseContent },
  urls: ShowcaseUrls,
  budget = { photos: CHAPTER_LIMITS.photosTotal },
): Chapter {
  const photo = (media: ShowcaseMedia | null | undefined): ChapterPhoto | null => {
    if (!media || budget.photos <= 0) return null;
    const url = urls[showcaseMediaKey(media)]?.url;
    if (!url || !/^https:\/\//i.test(url)) return null;
    budget.photos -= 1;
    return { url, caption: media.caption.trim(), width: media.width, height: media.height };
  };
  // Zdjęcie główne przed blokami — przy wyczerpanym limicie zdjęć zostaje.
  const hero = photo(item.content.hero);
  const blocks: ChapterBlock[] = [];
  for (const block of item.content.blocks) {
    if (block.hidden) continue;
    const title = block.title.trim();
    const intro = block.text.trim();
    if (block.kind === 'text') {
      const text = paragraphs(block.text);
      if (text.length) blocks.push({ kind: 'text', title, paragraphs: text });
    } else if (block.kind === 'points') {
      const rows = rowsOf(block);
      const style = block.style === 'steps' || block.style === 'checklist' ? block.style : 'benefits';
      if (rows.length) blocks.push({ kind: 'points', style, title, intro, rows });
    } else if (block.kind === 'photos') {
      const style = block.style === 'grid' ? 'grid' : 'large';
      const limit = style === 'grid' ? CHAPTER_LIMITS.gridPhotos : CHAPTER_LIMITS.largePhotos;
      const photos: ChapterPhoto[] = [];
      for (const media of block.photos) {
        if (photos.length >= limit) break;
        const value = photo(media);
        if (value) photos.push(value);
      }
      if (photos.length) blocks.push({ kind: 'photos', style, title, intro, photos });
    } else if (block.kind === 'specs' || block.kind === 'faq') {
      const rows = rowsOf(block);
      if (rows.length) blocks.push({ kind: block.kind, title, intro, rows });
    }
  }
  return {
    title: item.title.trim(),
    tagline: item.tagline.trim(),
    lead: item.content.lead.trim(),
    hero,
    blocks,
  };
}

const escape = (value: string) => value
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const color = (value: string, fallback: string) => (/^#[0-9a-f]{6}$/i.test(value) ? value : fallback);
/** Tylko adresy `data:` kroju (zbudowane na serwerze) — nic, co mogłoby zamknąć regułę CSS. */
const fontSource = (value: string | null) => (value && /^data:font\/(ttf|otf|woff2?);base64,[A-Za-z0-9+/=]+$/.test(value) ? value : null);

function blockHtml(block: ChapterBlock): string {
  const head = `${block.title ? `<h2>${escape(block.title)}</h2>` : ''}${'intro' in block && block.intro ? `<p class="intro">${escape(block.intro)}</p>` : ''}`;
  if (block.kind === 'text') {
    return `<section class="block text">${head}${block.paragraphs.map((line) => `<p>${escape(line)}</p>`).join('')}</section>`;
  }
  if (block.kind === 'points') {
    const items = block.rows.map((row, index) => {
      const marker = block.style === 'steps' ? `<span class="marker">${String(index + 1).padStart(2, '0')}</span>`
        : block.style === 'checklist' ? '<span class="marker">✓</span>' : '';
      return `<li>${marker}<div>${row.title ? `<h3>${escape(row.title)}</h3>` : ''}${row.text ? `<p>${escape(row.text)}</p>` : ''}</div></li>`;
    }).join('');
    return `<section class="block points ${block.style}">${head}<ul>${items}</ul></section>`;
  }
  if (block.kind === 'photos') {
    const figures = block.photos.map((photo) => {
      const ratio = photo.width && photo.height ? Math.min(1.25, Math.max(0.45, photo.height / photo.width)) : 0.62;
      const style = block.style === 'large' ? ` style="aspect-ratio:${(1 / ratio).toFixed(3)}"` : '';
      return `<figure><img src="${escape(photo.url)}" alt=""${style}>${photo.caption ? `<figcaption>${escape(photo.caption)}</figcaption>` : ''}</figure>`;
    }).join('');
    return `<section class="block photos ${block.style}">${head}<div class="gallery">${figures}</div></section>`;
  }
  if (block.kind === 'specs') {
    const rows = block.rows.map((row) => `<tr><th>${escape(row.title)}</th><td>${escape(row.text)}</td></tr>`).join('');
    return `<section class="block specs">${head}<table>${rows}</table></section>`;
  }
  const rows = block.rows.map((row) => `<div class="qa"><dt>${escape(row.title)}</dt><dd>${escape(row.text)}</dd></div>`).join('');
  return `<section class="block faq">${head}<dl>${rows}</dl></section>`;
}

/** Dokument HTML (A4, wydruk): każdy rozdział od nowej strony, długie rozdziały na kolejnych stronach. */
export function chapterDocumentHtml(document: ChapterDocument): string {
  const primary = color(document.colors.primary, '#1c1f33');
  const accent = color(document.colors.accent, '#d3bb73');
  const surface = color(document.colors.surface, '#faf7f2');
  const line = `rgba(${[1, 3, 5].map((offset) => parseInt(accent.slice(offset, offset + 2), 16)).join(', ')}, 0.55)`;
  const heading = fontSource(document.fonts.heading);
  const regular = fontSource(document.fonts.regular);
  const bold = fontSource(document.fonts.bold);
  const faces = [
    regular ? `@font-face{font-family:'OfferBody';src:url(${regular});font-weight:400;font-style:normal;}` : '',
    bold ? `@font-face{font-family:'OfferBody';src:url(${bold});font-weight:700;font-style:normal;}` : '',
    heading ? `@font-face{font-family:'OfferHeading';src:url(${heading});font-weight:400;font-style:normal;}` : '',
  ].join('');
  const chapters = document.chapters.map((chapter) => `
<article class="chapter">
  ${chapter.hero ? `<div class="hero"><img src="${escape(chapter.hero.url)}" alt=""></div>` : ''}
  <header class="${chapter.hero ? '' : 'plain'}">
    ${document.eyebrow ? `<p class="eyebrow">${escape(document.eyebrow)}</p>` : ''}
    <h1>${escape(chapter.title)}</h1>
    ${chapter.tagline ? `<p class="tagline">${escape(chapter.tagline)}</p>` : ''}
    <div class="rule"></div>
    ${chapter.lead ? paragraphs(chapter.lead).map((line) => `<p class="lead">${escape(line)}</p>`).join('') : ''}
  </header>
  ${chapter.blocks.map(blockHtml).join('\n  ')}
</article>`).join('\n');
  return `<!doctype html>
<html lang="pl"><head><meta charset="utf-8"><title>Rozdziały oferty</title>
<style>
${faces}
@page { size: A4; margin: 15mm 16mm 21mm 16mm; background: ${surface}; }
:root { --primary: ${primary}; --accent: ${accent}; --surface: ${surface}; --line: ${line}; --text: #24252b; --muted: #6b6560; }
* { box-sizing: border-box; }
html { background: var(--surface); }
body { margin: 0; color: var(--text); font-family: 'OfferBody', 'Noto Sans', 'DejaVu Sans', sans-serif; font-size: 10pt; line-height: 1.5;
  -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.chapter { break-before: page; }
.chapter:first-child { break-before: auto; }
.hero { height: 98mm; border-radius: 3mm; overflow: hidden; background: var(--primary); }
.hero img { width: 100%; height: 100%; object-fit: cover; display: block; }
header { padding-top: 8mm; break-inside: avoid; }
header.plain { padding-top: 14mm; }
.eyebrow { margin: 0 0 2mm; font-size: 7.5pt; letter-spacing: .16em; text-transform: uppercase; color: var(--accent); }
h1, h2 { font-family: 'OfferHeading', 'OfferBody', sans-serif; font-weight: 400; text-transform: uppercase; color: var(--primary); }
h1 { margin: 0; font-size: 28pt; line-height: 1.08; letter-spacing: .01em; }
.tagline { margin: 3mm 0 0; font-size: 12pt; line-height: 1.4; color: var(--muted); }
.rule { width: 18mm; height: 1.3pt; background: var(--accent); margin: 6mm 0 5mm; }
.lead { margin: 0 0 3mm; font-size: 11pt; line-height: 1.55; }
.block { margin-top: 9mm; }
h2 { margin: 0 0 4mm; font-size: 14pt; line-height: 1.2; break-after: avoid; }
h2::after { content: ''; display: block; width: 11mm; height: 1pt; background: var(--accent); margin-top: 2.2mm; }
.intro { margin: -1mm 0 4mm; color: var(--muted); break-after: avoid; }
.text p { margin: 0 0 3mm; orphans: 3; widows: 3; }
ul { list-style: none; margin: 0; padding: 0; }
.points.benefits ul { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; }
.points.benefits li { background: #fff; border-top: 1.3pt solid var(--accent); border-radius: 0 0 2.5mm 2.5mm; padding: 4mm 4.5mm; break-inside: avoid; }
.points.steps li, .points.checklist li { display: flex; gap: 4mm; padding: 3mm 0; border-bottom: .5pt solid var(--line); break-inside: avoid; }
.points .marker { flex: 0 0 auto; color: var(--accent); font-weight: 700; }
.points.steps .marker { width: 9mm; height: 9mm; border-radius: 50%; border: 1pt solid var(--accent); display: flex; align-items: center; justify-content: center; font-size: 9pt; }
.points.checklist .marker { width: 5mm; font-size: 11pt; line-height: 1.3; }
.points h3 { margin: 0 0 1mm; font-size: 10.5pt; line-height: 1.35; color: var(--primary); font-weight: 700; }
.points p { margin: 0; }
.photos.large .gallery figure { margin: 0 0 4mm; break-inside: avoid; }
.photos.large img { width: 100%; max-height: 125mm; object-fit: cover; border-radius: 2.5mm; display: block; }
.photos.grid .gallery { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3mm; }
.photos.grid figure { margin: 0; break-inside: avoid; }
.photos.grid img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: 2mm; display: block; }
figcaption { margin-top: 1.5mm; font-size: 8pt; line-height: 1.35; color: var(--muted); }
.specs table { width: 100%; border-collapse: collapse; }
.specs th, .specs td { text-align: left; vertical-align: top; padding: 2.2mm 0; border-bottom: .5pt solid var(--line); }
.specs th { width: 42%; padding-right: 4mm; font-weight: 400; color: var(--muted); }
.specs tr { break-inside: avoid; }
.faq dl { margin: 0; }
.faq .qa { padding: 3mm 0; border-bottom: .5pt solid var(--line); break-inside: avoid; }
.faq dt { font-weight: 700; color: var(--primary); }
.faq dd { margin: 1mm 0 0; }
</style></head>
<body>
${chapters}
</body></html>`;
}
