import 'server-only';
import { NextResponse } from 'next/server';

/*
 * Zadanie wydruku dla lokalnego silnika PDF w aplikacji na Maca. Serwer przygotowuje dokładnie ten sam HTML i te same
 * ustawienia, które dziś trafiają do Chromium (Playwright `page.setContent` + `page.pdf`), a Mac drukuje je w Chrome
 * zainstalowanym na komputerze (DevTools Protocol, `Page.printToPDF` z identycznymi parametrami). Dokument jest więc taki sam,
 * a serwer nie uruchamia przeglądarki. Gdy dokument trzeba zapisać w CRM (pliki wydarzenia, umowy), Mac odsyła gotowy PDF
 * (`?finalize=1`) i serwer wykonuje dalszą część tym samym kodem co przy generowaniu u siebie.
 */

/** Opcje jak `page.pdf()` w Playwright (te, których używają nasze trasy). */
export type PrintPdfOptions = {
  format?: 'A4' | 'A3' | 'A5' | 'Letter' | 'Legal';
  width?: string;
  height?: string;
  landscape?: boolean;
  preferCSSPageSize?: boolean;
  printBackground?: boolean;
  displayHeaderFooter?: boolean;
  headerTemplate?: string;
  footerTemplate?: string;
  margin?: { top?: string; right?: string; bottom?: string; left?: string };
  scale?: number;
};

export type PrintJob = {
  version: 1;
  /** HTML przekazywany do `page.setContent`. */
  html: string;
  /** Znacznik, w który Mac wstawia CSS fontów Inter (te same pliki i ten sam zapis co `loadPrintFontCss`); `null` — bez fontów. */
  fontsMarker: string | null;
  /** Czy strona może wykonywać skrypty (karta imprezy: nie). */
  javascript: boolean;
  /** `none` — żadnych zapytań sieciowych; `trusted` — tylko hosty z `allowedHosts` (jak `restrictPageNetwork`); `open` — bez ograniczeń. */
  network: 'none' | 'trusted' | 'open';
  allowedHosts: string[];
  /** Jak `waitUntil` w `page.setContent`. */
  waitUntil: 'load' | 'networkidle';
  /** Po załadowaniu: `document.fonts.ready` i wszystkie obrazy (jak `page.evaluate` w trasach agendy i kalkulacji). */
  waitForAssets: boolean;
  /** `page.emulateMedia({ media: 'print' })` przed drukiem. */
  emulatePrintMedia: boolean;
  pdf: PrintPdfOptions;
  /** Nazwa pliku do podglądu / pobrania. */
  fileName: string;
  /** Czy Mac ma odesłać gotowy PDF do zapisu w CRM (`?finalize=1`, multipart: `file` + `payload`). */
  finalize: boolean;
};

export const localRenderRequested = (request: Request) => new URL(request.url).searchParams.get('render') === 'local';
export const finalizeRequested = (request: Request) => new URL(request.url).searchParams.get('finalize') === '1';

export const printJobResponse = (job: PrintJob) =>
  NextResponse.json({ job }, { headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });

const hostOf = (value?: string | null) => {
  if (!value) return null;
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
};

/** Hosty dozwolone w wydruku — ta sama lista co w `restrictPageNetwork`. */
export function trustedPrintHosts(extraOrigins: Array<string | null | undefined> = []) {
  return Array.from(
    new Set(
      [
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SITE_URL,
        process.env.NEXT_PUBLIC_APP_URL,
        process.env.NEXT_PUBLIC_FRONTEND_URL,
        'https://fonts.googleapis.com',
        'https://fonts.gstatic.com',
        ...extraOrigins,
      ]
        .map(hostOf)
        .filter((host): host is string => Boolean(host)),
    ),
  );
}

/** Gotowy PDF z Maca: multipart `file` (application/pdf) i `payload` (JSON pierwotnego żądania). */
export async function readFinalizedPdf(request: Request, maxBytes = 40 * 1024 * 1024): Promise<{ pdf: Buffer; payload: any }> {
  const form = await request.formData();
  const file = form.get('file');
  const raw = form.get('payload');
  if (!(file instanceof File)) throw new Error('Brak pliku PDF.');
  if (file.size <= 0 || file.size > maxBytes) throw new Error('Nieprawidłowy rozmiar pliku PDF.');
  const pdf = Buffer.from(await file.arrayBuffer());
  if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('Plik nie jest dokumentem PDF.');
  let payload: any = {};
  if (typeof raw === 'string' && raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new Error('Nieprawidłowe dane żądania.');
    }
  }
  return { pdf, payload };
}
