import 'server-only';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { chromium, type Browser } from 'playwright';
import { PDFDocument } from 'pdf-lib';
import {
  downloadInvoicePrintLogo,
  PrintLogoLookupError,
  resolveInvoicePrintLogoSource,
} from '@/lib/invoices/resolveInvoicePrintLogo';

/**
 * Wspólny renderer wydruków na serwerze Next: HTML → Chromium (Playwright) → PDF.
 * Używają go faktury i karta imprezy. Wydruk nie pobiera niczego z sieci —
 * logo, font i obrazy są osadzone w HTML przed renderem.
 */

export const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

let interFontCss: Promise<string> | null = null;

const STATIC_INTER = [
  [400, 'Inter-Regular.ttf'],
  [500, 'Inter-Medium.ttf'],
  [600, 'Inter-SemiBold.ttf'],
  [700, 'Inter-Bold.ttf'],
] as const;

const fontFace = (bytes: Buffer, weight: string) =>
  `@font-face{font-family:'Inter';src:url(data:font/ttf;base64,${bytes.toString('base64')}) format('truetype');font-weight:${weight};font-style:normal;font-display:block;}`;

/**
 * Inter osadzony w HTML — Chromium bez sieci i bez fontów systemowych serwera.
 * Statyczne odmiany (public/fonts/invoice) dają w PDF zwykłe fonty TrueType: mniejszy plik, ostry druk
 * i tekst do zaznaczenia. Bez nich — Inter zmienny, a w ostateczności kroje zapasowe szablonu.
 */
export function loadPrintFontCss(): Promise<string> {
  if (!interFontCss) {
    const root = join(process.cwd(), 'public', 'fonts');
    interFontCss = Promise.all(STATIC_INTER.map(([, file]) => readFile(join(root, 'invoice', file))))
      .then((files) => files.map((bytes, index) => fontFace(bytes, String(STATIC_INTER[index][0]))).join(''))
      .catch(() => readFile(join(root, 'Inter-Variable.ttf')).then((bytes) => fontFace(bytes, '100 900')))
      .catch(() => {
        interFontCss = null;
        return '';
      });
  }
  return interFontCss;
}

// Plik logo w pamięci serwera Next (klucz: ścieżka pliku, 15 min). Wybór logo („Logo do druku”) czytamy
// z bazy przy każdym wydruku, więc zmiana w brandbooku działa od razu; pobranie pliku ze Storage — raz.
// Gdy baza lub Storage chwilowo nie odpowiada, wydruk korzysta z ostatnio pobranego pliku.
const LOGO_TTL_MS = 15 * 60_000;
const logoCache = new Map<string, { dataUrl: string; at: number }>();
const lastLogoSourceByCompany = new Map<string, string>();

/** Logo do druku firmy (brandbook) jako data URI. */
export async function resolveCachedPrintLogo(admin: SupabaseClient, companyId: string | null | undefined) {
  let source: string;
  try {
    source = await resolveInvoicePrintLogoSource(admin, companyId);
    lastLogoSourceByCompany.set(companyId || '', source);
  } catch (error) {
    const fallback = lastLogoSourceByCompany.get(companyId || '');
    const cachedFallback = fallback ? logoCache.get(fallback) : undefined;
    if (cachedFallback && error instanceof PrintLogoLookupError) return cachedFallback.dataUrl;
    throw error;
  }
  const cached = logoCache.get(source);
  if (cached && Date.now() - cached.at < LOGO_TTL_MS) return cached.dataUrl;
  try {
    const dataUrl = await downloadInvoicePrintLogo(admin, source);
    logoCache.set(source, { dataUrl, at: Date.now() });
    return dataUrl;
  } catch (error) {
    if (cached) return cached.dataUrl;
    throw error;
  }
}

// Jedna przeglądarka na proces: podgląd PDF bez kilkusekundowego startu Chromium przy każdym otwarciu.
let browserPromise: Promise<Browser> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let activeRenders = 0;
const BROWSER_IDLE_MS = 90_000;

function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium
      .launch({ args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none'] })
      .then((browser) => {
        browser.on('disconnected', () => {
          browserPromise = null;
        });
        return browser;
      })
      .catch((error) => {
        browserPromise = null;
        throw error;
      });
  }
  return browserPromise;
}

function scheduleIdleClose() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    if (activeRenders > 0 || !browserPromise) return;
    const pending = browserPromise;
    browserPromise = null;
    try {
      await (await pending).close();
    } catch {
      // przeglądarka mogła się już zamknąć
    }
  }, BROWSER_IDLE_MS);
}

export type PrintDocument = {
  html: string;
  /** Stopka na każdej stronie: lewa część (np. numer dokumentu) i prawa (np. strona WWW) + „Strona X z Y”. */
  footer: { left: string; right: string };
};

export type RenderedPdf = { pdf: Buffer; pageCount: number };

export async function renderHtmlToPdf(document: PrintDocument): Promise<RenderedPdf> {
  activeRenders += 1;
  if (idleTimer) clearTimeout(idleTimer);
  try {
    const browser = await getBrowser();
    const context = await browser.newContext({ javaScriptEnabled: false });
    try {
      const page = await context.newPage();
      await page.route('**/*', (route) => route.abort());
      await page.setContent(document.html, { waitUntil: 'load' });
      await page.emulateMedia({ media: 'print' });
      const pdfBytes = await page.pdf({
        format: 'A4',
        preferCSSPageSize: true,
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate: `
          <div style="width:100%;padding:0 12mm;color:#6b7280;font-family:Helvetica,Arial,sans-serif;font-size:7.5px;display:flex;align-items:center;justify-content:space-between;gap:12px;box-sizing:border-box;">
            <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:72%;">${escapeHtml(document.footer.left)}</span>
            <span style="white-space:nowrap;">${escapeHtml(document.footer.right)}${document.footer.right ? ' · ' : ''}Strona <span class="pageNumber"></span> z <span class="totalPages"></span></span>
          </div>`,
        margin: { top: '12mm', right: '12mm', bottom: '16mm', left: '12mm' },
      });
      const pdf = Buffer.from(pdfBytes);
      const pageCount = (await PDFDocument.load(pdf, { updateMetadata: false })).getPageCount();
      return { pdf, pageCount };
    } finally {
      await context.close().catch(() => undefined);
    }
  } finally {
    activeRenders -= 1;
    scheduleIdleClose();
  }
}

/** Nagłówek Content-Disposition z nazwą pliku w UTF-8. */
export function pdfContentDisposition(fileName: string, download: boolean) {
  return `${download ? 'attachment' : 'inline'}; filename="${fileName.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
