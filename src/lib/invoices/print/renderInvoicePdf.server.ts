import 'server-only';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { chromium, type Browser } from 'playwright';
import { PDFDocument } from 'pdf-lib';
import { buildInvoicePdfHtml, INVOICE_PRINT_TEMPLATE_VERSION } from '@/components/crm/invoices/helpers/buildInvoicePdfHtml';
import { generateKsefInvoiceQrDataUrl } from '@/lib/ksef/qr';
import { resolveInvoiceIssuerName } from '@/lib/invoices/resolveInvoiceIssuerName';
import { resolveInvoicePrintLogo } from '@/lib/invoices/resolveInvoicePrintLogo';
import { invoiceRowToPdfData, isProformaInvoiceRow, type InvoicePrintRow } from '@/lib/invoices/print/invoicePrintData';

/**
 * Wydruk faktury po stronie serwera: jeden szablon HTML → Chromium → PDF.
 * Ten sam wynik dostaje podgląd na stronie faktury, podgląd w uzgadnianiu,
 * pobranie, wysyłka e-mailem i zapis w dokumentach wydarzenia.
 */

export const INVOICE_PRINT_SELECT = '*,invoice_items(*),invoice_order_items(*)';

export class InvoicePrintError extends Error {
  constructor(message: string, readonly status = 422) {
    super(message);
  }
}

const escapeHtml = (value: unknown) =>
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
function loadInterFontCss(): Promise<string> {
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

// Logo z brandbooka w pamięci serwera Next (15 min): podgląd nie pobiera pliku ze Storage przy każdym otwarciu
// i działa dalej, gdy Supabase Storage chwilowo nie odpowiada, a logo było już pobrane.
const LOGO_TTL_MS = 15 * 60_000;
const logoCache = new Map<string, { dataUrl: string; at: number }>();

async function resolveCachedPrintLogo(admin: SupabaseClient, companyId: string | null | undefined) {
  const key = companyId || '';
  const cached = logoCache.get(key);
  if (cached && Date.now() - cached.at < LOGO_TTL_MS) return cached.dataUrl;
  try {
    const dataUrl = await resolveInvoicePrintLogo(admin, companyId);
    logoCache.set(key, { dataUrl, at: Date.now() });
    return dataUrl;
  } catch (error) {
    if (cached) return cached.dataUrl;
    throw error;
  }
}

export type InvoicePrintDocument = {
  html: string;
  fileTitle: string;
  footer: { left: string; right: string };
  isProforma: boolean;
};

/** HTML wydruku z danymi utrwalonymi na fakturze, logo z brandbooka, kodem QR KSeF i osadzonym fontem. */
export async function buildInvoicePrintDocument(
  admin: SupabaseClient,
  invoice: InvoicePrintRow,
): Promise<InvoicePrintDocument> {
  const issuerName = await resolveInvoiceIssuerName(admin, invoice);
  if (!issuerName) {
    throw new InvoicePrintError(
      'Nie można ustalić imienia i nazwiska osoby wystawiającej fakturę. Uzupełnij dane wystawiającego w fakturze lub imię i nazwisko jej autora w CRM, a następnie spróbuj ponownie.',
    );
  }

  let companyLogoUrl: string;
  try {
    companyLogoUrl = await resolveCachedPrintLogo(admin, invoice.my_company_id);
  } catch (error) {
    throw new InvoicePrintError(error instanceof Error ? error.message : 'Nie udało się pobrać logo do wydruku.');
  }

  const data = invoiceRowToPdfData(invoice, { companyLogoUrl, signatureName: issuerName });
  let html = buildInvoicePdfHtml(data);

  const qrPlaceholder = '<div id="ksef-verification-placeholder"></div>';
  if (invoice.ksef_reference_number && invoice.ksef_status === 'accepted') {
    const [{ data: ksefInvoice }, { data: credentials }] = await Promise.all([
      admin
        .from('ksef_invoices')
        .select('xml_content,ksef_reference_number,sync_status')
        .eq('invoice_id', invoice.id)
        .eq('ksef_reference_number', invoice.ksef_reference_number)
        .eq('sync_status', 'synced')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from('ksef_credentials')
        .select('is_test_environment')
        .eq('my_company_id', invoice.my_company_id)
        .eq('is_active', true)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (ksefInvoice?.xml_content) {
      const qr = await generateKsefInvoiceQrDataUrl({
        sellerNip: invoice.seller_nip,
        issueDate: invoice.issue_date,
        xmlContent: ksefInvoice.xml_content,
        environment: credentials?.is_test_environment ? 'test' : 'production',
      });
      html = html.replace(
        qrPlaceholder,
        `<div class="ksef-verification">
          <a href="${escapeHtml(qr.verificationUrl)}"><img src="${qr.dataUrl}" alt="Kod weryfikacyjny KSeF" /></a>
          <div class="ksef-verification-text">
            <div class="ksef-verification-title">Weryfikacja w KSeF</div>
            <div class="ksef-verification-number">${escapeHtml(ksefInvoice.ksef_reference_number)}</div>
            <div class="ksef-verification-hint">Zeskanuj kod, aby sprawdzić fakturę w Krajowym Systemie e-Faktur.</div>
          </div>
        </div>`,
      );
    }
  }
  html = html.replace(qrPlaceholder, '');
  html = html.replace('/*invoice-print-fonts*/', await loadInterFontCss());

  const isProforma = isProformaInvoiceRow(invoice);
  const typeLabel = isProforma ? 'Pro forma' : data.invoiceType === 'corrective' ? 'Korekta' : 'Faktura';
  return {
    html,
    fileTitle: `${typeLabel} ${data.invoiceNumber}`,
    footer: {
      left: `${typeLabel} ${data.invoiceNumber}${data.sellerName ? ` · ${data.sellerName}` : ''}`,
      right: data.website || '',
    },
    isProforma,
  };
}

// Jedna przeglądarka na proces: podgląd PDF bez kilkusekundowego startu Chromium przy każdym otwarciu faktury.
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

export type RenderedInvoicePdf = { pdf: Buffer; pageCount: number };

export async function renderInvoicePdf(document: InvoicePrintDocument): Promise<RenderedInvoicePdf> {
  activeRenders += 1;
  if (idleTimer) clearTimeout(idleTimer);
  try {
    const browser = await getBrowser();
    const context = await browser.newContext({ javaScriptEnabled: false });
    try {
      const page = await context.newPage();
      // Wydruk nie pobiera niczego z sieci: logo, font i kod QR są osadzone w HTML.
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
            <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:60%;">${escapeHtml(document.footer.left)}</span>
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

/** Rewizja wydruku: zmiana faktury albo szablonu = nowy podgląd (pamięć podręczna klienta). */
export function invoicePrintRevision(invoice: { updated_at?: string | null; pdf_generated_at?: string | null }) {
  return [INVOICE_PRINT_TEMPLATE_VERSION, invoice.updated_at || '', invoice.pdf_generated_at || ''].join('|');
}
