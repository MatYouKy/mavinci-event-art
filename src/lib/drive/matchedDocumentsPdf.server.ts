import 'server-only';
import { PDFDocument } from 'pdf-lib';
import { escapeHtml, loadPrintFontCss, renderHtmlToPdf } from '@/lib/print/pdfRenderer.server';
import { monthLabel } from './financeReports.server';

/*
 * „Dopasowane faktury (PDF)” (Uzgodnienie wyciągów, CRM i Mac — `docs/bank-reconciliation.md`, sekcja 11): jeden plik dla
 * księgowej. Na początku zestawienie płatności z wyciągu za miesiąc z przypisanymi dokumentami i numerem strony, na której
 * zaczyna się każdy dokument; dalej same dokumenty — faktury z KSeF (wizualizacja), faktury CRM (wydruk) i dokumenty spoza
 * KSeF (wgrany PDF albo zdjęcie JPG / PNG). Dokument bez pliku albo w formacie, którego nie da się wstawić do PDF, jest na
 * liście „Bez pliku w zestawieniu” z powodem. Po zestawieniu — załącznik „Płatności bez dokumentu” (sekcja 18): płatności
 * miesiąca, którym brakuje dokumentu, ze stanem i powodem (opis wpisany w CRM, propozycja, co system znalazł w dokumentach
 * kontrahenta — `bankUnmatchedReasons.ts`). Dane i pliki zbiera `financeMatchedDocumentsPdf` (`drive.server.ts`).
 */

export type MatchedDocumentRef = { key: string; number: string; party: string; amount: number };

export type MatchedPayment = {
  date: string;
  /** Data księgowania, gdy operacja jest z innego miesiąca niż wyciąg (np. karta 29.09, zaksięgowana 01.10). */
  booked: string | null;
  account: 'regular' | 'vat';
  credit: boolean;
  amount: number;
  currency: string;
  counterparty: string;
  title: string;
  documents: MatchedDocumentRef[];
};

export type MatchedFile = {
  key: string;
  number: string;
  party: string;
  /** „Faktura KSeF”, „Faktura CRM”, „Dokument spoza KSeF”. */
  sourceLabel: string;
  bytes: Uint8Array | null;
  mime: string;
  /** Powód, dla którego pliku nie ma w zestawieniu. */
  problem: string | null;
};

/** Płatność bez dokumentu (w całości albo w części) — wiersz załącznika. */
export type UnmatchedPayment = {
  date: string;
  booked: string | null;
  account: 'regular' | 'vat';
  credit: boolean;
  amount: number;
  /** Brakująca część (przy płatności częściowo rozliczonej mniejsza niż kwota). */
  remaining: number;
  currency: string;
  counterparty: string;
  title: string;
  /** „Brak dokumentu · opisana”, „Częściowo rozliczona”, „Propozycja”… */
  state: string;
  reasons: string[];
};

export type MatchedReport = {
  company: string;
  year: number;
  month: number;
  payments: MatchedPayment[];
  files: MatchedFile[];
  unmatched: UnmatchedPayment[];
};

export type MatchedPdf = { pdf: Buffer; documents: number; pages: number; skipped: Array<{ number: string; party: string; problem: string }> };

const money = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const amountText = (value: number, currency: string) => `${money.format(value)} ${currency === 'PLN' ? 'zł' : currency}`;
const plDate = (value: string | null | undefined) => (value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10).split('-').reverse().join('.') : '');

const CSS = `
  @page{size:A4;margin:12mm}
  *{box-sizing:border-box}
  body{font-family:'Inter',Helvetica,Arial,sans-serif;font-size:8.5px;color:#111827;margin:0}
  h1{font-size:17px;margin:0 0 2px;font-weight:700}
  h2{font-size:11px;margin:14px 0 4px;font-weight:700;text-transform:uppercase;letter-spacing:.05em}
  .meta{color:#6b7280;margin-bottom:4px}
  .note{color:#6b7280;margin:0 0 8px}
  table{width:100%;border-collapse:collapse;table-layout:fixed}
  th{background:#f3f4f6;font-weight:600;font-size:7.5px;text-transform:uppercase;letter-spacing:.04em;color:#374151;text-align:left;padding:4px;border-bottom:1px solid #d1d5db}
  td{padding:4px;border-bottom:1px solid #eef0f3;vertical-align:top;overflow-wrap:anywhere}
  tr{page-break-inside:avoid}
  .r{text-align:right;white-space:nowrap}
  .sub{color:#6b7280;font-size:7.5px;margin-top:1px}
  .doc{margin-bottom:2px}
  .page{font-weight:600;white-space:nowrap}
  .missing{color:#b45309}
  .state{font-weight:600;color:#b45309}
  .why{margin-bottom:2px}
  .why:before{content:'• ';color:#9ca3af}
  .empty{color:#6b7280;margin:6px 0 0}
`;

const isPdf = (bytes: Uint8Array) => bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
const isPng = (bytes: Uint8Array) => bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
const isJpeg = (bytes: Uint8Array) => bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;

/** Plik dokumentu → PDF (PDF bez zmian, zdjęcie JPG / PNG — strona A4 z marginesem); inny format — `null`. */
async function documentPdf(bytes: Uint8Array): Promise<PDFDocument | null> {
  if (isPdf(bytes)) return PDFDocument.load(bytes, { updateMetadata: false });
  if (!isPng(bytes) && !isJpeg(bytes)) return null;
  const doc = await PDFDocument.create();
  const image = isPng(bytes) ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  const landscape = image.width > image.height;
  const [width, height] = landscape ? [841.89, 595.28] : [595.28, 841.89];
  const margin = 28;
  const scale = Math.min((width - 2 * margin) / image.width, (height - 2 * margin) / image.height);
  const page = doc.addPage([width, height]);
  page.drawImage(image, {
    x: (width - image.width * scale) / 2,
    y: (height - image.height * scale) / 2,
    width: image.width * scale,
    height: image.height * scale,
  });
  return doc;
}

function coverHtml(report: MatchedReport, starts: Map<string, number>, skipped: MatchedFile[], totalPages: number, fontCss: string) {
  const stamp = new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', dateStyle: 'long', timeStyle: 'short' }).format(new Date());
  const files = new Map(report.files.map((file) => [file.key, file]));
  const rows = report.payments.map((payment) => {
    const documents = payment.documents.map((ref) => {
      const file = files.get(ref.key);
      const start = starts.get(ref.key);
      return `<div class="doc">${escapeHtml(ref.number || 'dokument bez numeru')}${ref.party ? ` · ${escapeHtml(ref.party)}` : ''}
        <span class="sub"> · ${escapeHtml(amountText(ref.amount, payment.currency))}${file ? ` · ${escapeHtml(file.sourceLabel)}` : ''}</span>
        ${start ? ` <span class="page">→ str. ${start}</span>` : ' <span class="missing">· bez pliku</span>'}</div>`;
    }).join('');
    return `<tr>
      <td>${escapeHtml(plDate(payment.date))}${payment.booked ? `<div class="sub">zaksięgowana ${escapeHtml(plDate(payment.booked))}</div>` : ''}
        <div class="sub">${payment.account === 'vat' ? 'rachunek VAT' : 'rachunek bieżący'}</div></td>
      <td>${escapeHtml(payment.counterparty || 'Bez nazwy kontrahenta')}${payment.title ? `<div class="sub">${escapeHtml(payment.title)}</div>` : ''}</td>
      <td class="r">${payment.credit ? '+' : '−'}${escapeHtml(amountText(payment.amount, payment.currency))}</td>
      <td>${documents}</td>
    </tr>`;
  }).join('');
  const unmatched = report.unmatched.length
    ? `<h2>Załącznik: płatności bez dokumentu (${report.unmatched.length}) — dlaczego nie są dopasowane</h2>
      <p class="note">Płatności z wyciągów za miesiąc, którym brakuje dokumentu (w całości albo w części), według uzgodnienia wyciągów
        w CRM: stan, opis wpisany w CRM („Opisz brak dokumentu”), propozycja do zatwierdzenia i to, co system znalazł w dokumentach
        kontrahenta (KSeF, faktury CRM, dokumenty spoza KSeF).</p>
      <table><colgroup><col style="width:11%"><col style="width:24%"><col style="width:12%"><col style="width:12%"><col style="width:41%"></colgroup>
      <thead><tr><th>Data</th><th>Kontrahent / tytuł</th><th class="r">Kwota</th><th>Stan</th><th>Dlaczego</th></tr></thead>
      <tbody>${report.unmatched.map((payment) => `<tr>
        <td>${escapeHtml(plDate(payment.date))}${payment.booked ? `<div class="sub">zaksięgowana ${escapeHtml(plDate(payment.booked))}</div>` : ''}
          <div class="sub">${payment.account === 'vat' ? 'rachunek VAT' : 'rachunek bieżący'}</div></td>
        <td>${escapeHtml(payment.counterparty || 'Bez nazwy kontrahenta')}${payment.title ? `<div class="sub">${escapeHtml(payment.title)}</div>` : ''}</td>
        <td class="r">${payment.credit ? '+' : '−'}${escapeHtml(amountText(payment.amount, payment.currency))}${payment.remaining < payment.amount - 0.009
          ? `<div class="sub">brakuje ${escapeHtml(amountText(payment.remaining, payment.currency))}</div>` : ''}</td>
        <td class="state">${escapeHtml(payment.state)}</td>
        <td>${payment.reasons.length ? payment.reasons.map((reason) => `<div class="why">${escapeHtml(reason)}</div>`).join('') : '—'}</td>
      </tr>`).join('')}</tbody></table>`
    : '';
  const missing = skipped.length
    ? `<h2>Bez pliku w zestawieniu (${skipped.length})</h2>
      <table><colgroup><col style="width:28%"><col style="width:32%"><col style="width:40%"></colgroup>
      <thead><tr><th>Dokument</th><th>Kontrahent</th><th>Powód</th></tr></thead><tbody>${skipped.map((file) => `<tr>
        <td>${escapeHtml(file.number || 'dokument bez numeru')}<div class="sub">${escapeHtml(file.sourceLabel)}</div></td>
        <td>${escapeHtml(file.party || '—')}</td><td>${escapeHtml(file.problem || 'brak pliku')}</td></tr>`).join('')}</tbody></table>`
    : '';
  const included = report.files.length - skipped.length;
  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><style>${fontCss}${CSS}</style></head><body>
    <h1>Dopasowane dokumenty — ${escapeHtml(monthLabel(report.year, report.month))}</h1>
    <p class="meta">${escapeHtml(report.company)} · stan na ${escapeHtml(stamp)} · płatności: ${report.payments.length} · dokumenty w pliku: ${included}
      ${report.unmatched.length ? `· bez dokumentu: ${report.unmatched.length} (załącznik)` : ''} · stron: ${totalPages}</p>
    <p class="note">Płatności z wyciągów za miesiąc z przypisanymi dokumentami (faktury z KSeF, faktury CRM, dokumenty spoza KSeF) — według
      uzgodnienia wyciągów w CRM. „str.” — strona tego pliku, na której zaczyna się dokument; dokument opłacony kilkoma przelewami
      jest w pliku raz.</p>
    ${report.payments.length ? `<table><colgroup><col style="width:13%"><col style="width:33%"><col style="width:14%"><col style="width:40%"></colgroup>
      <thead><tr><th>Data</th><th>Kontrahent / tytuł</th><th class="r">Kwota</th><th>Dokumenty</th></tr></thead>
      <tbody>${rows}</tbody></table>` : '<p class="empty">W tym miesiącu żadna płatność z wyciągu nie ma jeszcze przypisanego dokumentu.</p>'}
    ${missing}
    ${unmatched}
  </body></html>`;
}

/** Zestawienie i dokumenty w jednym PDF. */
export async function renderMatchedDocumentsPdf(report: MatchedReport): Promise<MatchedPdf> {
  const loaded: Array<{ file: MatchedFile; doc: PDFDocument }> = [];
  const skipped: MatchedFile[] = [];
  for (const file of report.files) {
    if (!file.bytes || !file.bytes.byteLength) {
      skipped.push({ ...file, problem: file.problem || 'brak pliku dokumentu' });
      continue;
    }
    try {
      const doc = await documentPdf(file.bytes);
      if (doc && doc.getPageCount() > 0) loaded.push({ file, doc });
      else skipped.push({ ...file, problem: 'format pliku nie pozwala wstawić go do PDF (np. HEIC, WebP) — otwórz go w CRM' });
    } catch {
      skipped.push({ ...file, problem: 'nie udało się odczytać pliku (uszkodzony albo zabezpieczony hasłem PDF)' });
    }
  }
  const documentPages = loaded.reduce((sum, entry) => sum + entry.doc.getPageCount(), 0);
  const fontCss = await loadPrintFontCss();
  // „Zestawienie · Strona 1 z 2” — numeracja stopki dotyczy samego zestawienia, „str.” w tabeli — całego pliku.
  const footer = { left: `Dopasowane dokumenty — ${monthLabel(report.year, report.month)} — ${report.company}`, right: 'Zestawienie' };
  // Numery stron zależą od długości zestawienia — drugi przebieg, gdy pierwszy dał inną liczbę stron.
  const render = (coverPages: number) => {
    const starts = new Map<string, number>();
    let next = coverPages + 1;
    for (const entry of loaded) {
      starts.set(entry.file.key, next);
      next += entry.doc.getPageCount();
    }
    return renderHtmlToPdf({ html: coverHtml(report, starts, skipped, coverPages + documentPages, fontCss), footer });
  };
  let cover = await render(1);
  if (cover.pageCount !== 1) {
    const pages = cover.pageCount;
    cover = await render(pages);
    if (cover.pageCount !== pages) cover = await render(cover.pageCount);
  }
  const out = await PDFDocument.create();
  out.setTitle(`Dopasowane dokumenty — ${monthLabel(report.year, report.month)} — ${report.company}`);
  out.setCreator('Mavinci CRM');
  out.setProducer('Mavinci CRM');
  const coverDoc = await PDFDocument.load(cover.pdf, { updateMetadata: false });
  for (const page of await out.copyPages(coverDoc, coverDoc.getPageIndices())) out.addPage(page);
  for (const entry of loaded) {
    for (const page of await out.copyPages(entry.doc, entry.doc.getPageIndices())) out.addPage(page);
  }
  return {
    pdf: Buffer.from(await out.save()),
    documents: loaded.length,
    pages: out.getPageCount(),
    skipped: skipped.map((file) => ({ number: file.number, party: file.party, problem: file.problem || 'brak pliku dokumentu' })),
  };
}
