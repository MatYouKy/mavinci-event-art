import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';
import { BROCHURE_IMAGE_PROFILES, installBrochureImageOptimization } from '@/lib/brochures/optimizePdfImages.server';
import { cleanShowcaseContent, showcaseMediaUrls } from '@/lib/showcase/showcase.server';
import { CHAPTER_LIMITS, chapterDocumentHtml, chapterFromShowcase, type Chapter } from './chapterHtml';

/*
 * Rozdziały oferty z Prezentacji — serwer: karty (`sales_showcase_items`, klient serwisowy generatora PDF) w kolejności
 * z kategorii szablonu, podpisane adresy zdjęć (`showcaseMediaUrls`), HTML z `chapterHtml.ts` i PDF z Chromium
 * (jak broszury: zdjęcia pomniejszane do rozmiaru na stronie — `installBrochureImageOptimization`, kroje osadzone).
 * Karta wyłączona albo usunięta jest pomijana; zdjęcie, którego nie da się pobrać — także (bez pustej ramki).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Identyfikatory kart z `design_config.chapter_item_ids` (kolejność zachowana, bez powtórzeń). */
export function chapterItemIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids = value.map((item) => String(item || '').toLowerCase()).filter((item) => UUID.test(item));
  return Array.from(new Set(ids)).slice(0, CHAPTER_LIMITS.chapters);
}

/** Karty Prezentacji jako rozdziały (puste karty pomijane). */
export async function loadOfferChapters(supabase: SupabaseClient, ids: string[]): Promise<Chapter[]> {
  if (!ids.length) return [];
  const { data, error } = await supabase.from('sales_showcase_items').select('id, title, tagline, content, is_active').in('id', ids);
  if (error) throw new Error('Nie udało się odczytać rozdziałów z Prezentacji. Spróbuj ponownie za chwilę.');
  const rows = (data || []) as Array<Record<string, any>>;
  const items = ids
    .map((id) => rows.find((row) => String(row.id).toLowerCase() === id))
    .filter((row): row is Record<string, any> => Boolean(row) && row!.is_active !== false)
    .map((row) => ({ title: String(row.title || ''), tagline: String(row.tagline || ''), content: cleanShowcaseContent(row.content) }));
  const media = items.flatMap((item) => [
    item.content.hero,
    ...item.content.blocks.filter((block) => !block.hidden && block.kind === 'photos').flatMap((block) => block.photos),
  ]);
  const urls = media.some(Boolean) ? await showcaseMediaUrls(supabase, media) : {};
  const budget = { photos: CHAPTER_LIMITS.photosTotal };
  return items
    .map((item) => chapterFromShowcase(item, urls, budget))
    .filter((chapter) => chapter.title || chapter.lead || chapter.hero || chapter.blocks.length);
}

/** Krój jako adres `data:` (Chromium nie pobiera go z sieci); nieznany format — null. */
export function fontDataUrl(bytes: ArrayBuffer | null): string | null {
  if (!bytes || bytes.byteLength < 4) return null;
  const buffer = Buffer.from(bytes);
  const signature = buffer.subarray(0, 4).toString('ascii');
  const mime = buffer.readUInt32BE(0) === 0x00010000 || signature === 'true' ? 'font/ttf'
    : signature === 'OTTO' ? 'font/otf'
      : signature === 'wOFF' ? 'font/woff'
        : signature === 'wOF2' ? 'font/woff2' : null;
  return mime ? `data:${mime};base64,${buffer.toString('base64')}` : null;
}

/** PDF rozdziałów (A4). `compact` — ponowna próba generatora: zdjęcia w mniejszej rozdzielczości. */
export async function renderOfferChapterPdf(input: {
  chapters: Chapter[];
  colors: { primary: string; accent: string; surface: string };
  fonts: { heading: ArrayBuffer | null; regular: ArrayBuffer; bold: ArrayBuffer };
  eyebrow: string;
  compact: boolean;
}): Promise<Uint8Array> {
  const regular = fontDataUrl(input.fonts.regular);
  const bold = fontDataUrl(input.fonts.bold);
  if (!regular || !bold) throw new Error('Nie udało się przygotować czcionek rozdziałów z Prezentacji.');
  const html = chapterDocumentHtml({
    chapters: input.chapters,
    colors: input.colors,
    fonts: { heading: fontDataUrl(input.fonts.heading), regular, bold },
    eyebrow: input.eyebrow,
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  try {
    browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=medium'] });
    const page = await browser.newPage();
    // Rozmiary zdjęć liczone dla układu wydruku.
    await page.emulateMedia({ media: 'print' });
    const images = await installBrochureImageOptimization(page, []);
    await page.setContent(html, { waitUntil: 'load', timeout: 60_000 });
    await page.evaluate(async () => {
      await document.fonts.ready;
      // Zdjęcie, którego nie udało się pobrać, znika razem z ramką; pusta galeria — razem z blokiem.
      for (const image of Array.from(document.images)) {
        if (image.complete && image.naturalWidth > 0) continue;
        (image.closest('figure') || image.closest('.hero') || image).remove();
      }
      document.querySelectorAll('.photos .gallery').forEach((gallery) => {
        if (!gallery.children.length) gallery.closest('.block')?.remove();
      });
    });
    await images.apply(input.compact ? BROCHURE_IMAGE_PROFILES[2] : BROCHURE_IMAGE_PROFILES[1]);
    const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
    return new Uint8Array(pdf);
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
