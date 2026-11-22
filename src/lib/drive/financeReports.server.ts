import 'server-only';
import { escapeHtml, loadPrintFontCss, renderHtmlToPdf } from '@/lib/print/pdfRenderer.server';

/*
 * Raporty Finansów w Dysku (PDF na serwerze Next, wspólny renderer wydruków):
 * • „Zamknięcie miesiąca — <miesiąc>” (folder miesiąca w Księgowości): lista kontrolna przed przekazaniem i zamknięciem miesiąca
 *   (wyciąg, płatności z dokumentem, dokumenty spoza KSeF uzupełnione, XML z KSeF, przekazanie księgowej, błędy, pytania
 *   księgowej, zamknięcie) i szczegóły spraw do wyjaśnienia — dane jak „Dla księgowej” w Centrum finansów;
 * • „Do wyjaśnienia — <firma>” (folder Do wyjaśnienia): otwarte sprawy firmy ze wszystkich miesięcy i sprzęt bez dokumentu albo
 *   bez ustalonej własności.
 * Dane przygotowuje `drive.server.ts`; tu tylko szablony. Zmiana szablonu — podnieś `FINANCE_REPORT_VERSION` w `drive.server.ts`.
 */

const money = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const plDate = (value: string | null | undefined) => (value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10).split('-').reverse().join('.') : '');
const amountText = (value: number | null | undefined, currency = 'PLN') => (value === null || value === undefined || !Number.isFinite(value) ? ''
  : `${money.format(value)} ${currency === 'PLN' ? 'zł' : currency}`);
const MONTHS = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];
export const monthLabel = (year: number, month: number) => `${MONTHS[month - 1] || ''} ${year}`;

export type ReportDocument = { number: string; counterparty: string; date: string | null; amount: number | null; currency: string; note?: string };
export type ReportPayment = {
  date: string | null; amount: number | null; currency: string; counterparty: string; reference: string; note: string; acknowledged: boolean;
  /** Miesiąc rozliczenia (raport „Do wyjaśnienia”). */
  year?: number; month?: number;
};
export type ReportCheck = { label: string; state: 'ok' | 'todo' | 'info'; detail: string };

export type MonthCloseReport = {
  company: string;
  year: number;
  month: number;
  checks: ReportCheck[];
  payments: ReportPayment[];
  incomplete: ReportDocument[];
  pending: ReportDocument[];
  followups: ReportPayment[];
  blockers: string[];
  warnings: string[];
  /** Dane przekazania niedostępne (błąd odczytu) — raport zawiera wtedy tylko część pozycji. */
  partial: string;
};

export type ClarifyReport = {
  company: string;
  openMonths: Array<{ year: number; month: number; handedOverAt: string | null }>;
  incomplete: ReportDocument[];
  ksefWithoutXml: ReportDocument[];
  followups: ReportPayment[];
  undocumented: Array<{ equipment: string; quantity: number; ownership: string; note: string }>;
  unassigned: Array<{ equipment: string; quantity: number; total: number }>;
  unassignedTotal: number;
  /** Partie sprzętu liczone z widocznych firm (bez dostępu do wszystkich — liczba może być zawyżona). */
  unassignedNote: string;
};

const CSS = `
  @page{size:A4;margin:12mm}
  *{box-sizing:border-box}
  body{font-family:'Inter',Helvetica,Arial,sans-serif;font-size:9px;color:#111827;margin:0}
  h1{font-size:17px;margin:0 0 2px;font-weight:700}
  h2{font-size:11px;margin:14px 0 4px;font-weight:700;text-transform:uppercase;letter-spacing:.05em}
  .meta{color:#6b7280;margin-bottom:8px}
  .note{color:#6b7280;margin:0 0 4px}
  .empty{color:#9ca3af;margin:0}
  table{width:100%;border-collapse:collapse;table-layout:fixed}
  th{background:#f3f4f6;font-weight:600;font-size:8px;text-transform:uppercase;letter-spacing:.04em;color:#374151;text-align:left;padding:4px;border-bottom:1px solid #d1d5db}
  td{padding:4px;border-bottom:1px solid #eef0f3;vertical-align:top;overflow-wrap:anywhere}
  .r{text-align:right;white-space:nowrap}
  .sub{color:#6b7280;font-size:8px;margin-top:1px}
  .checks td{padding:6px 4px}
  .state{font-weight:700;white-space:nowrap}
  .ok{color:#047857}.todo{color:#b45309}.info{color:#4b5563}
  .box{border:1px solid #fde68a;background:#fffbeb;border-radius:4px;padding:6px 8px;margin:6px 0}
  ul{margin:2px 0 0 14px;padding:0}
`;

const STATE_LABEL: Record<ReportCheck['state'], string> = { ok: '✓ gotowe', todo: '• do zrobienia', info: 'ℹ informacja' };

function documentsTable(rows: ReportDocument[], empty: string) {
  if (!rows.length) return `<p class="empty">${escapeHtml(empty)}</p>`;
  return `<table><colgroup><col style="width:24%"><col style="width:34%"><col style="width:12%"><col style="width:14%"><col style="width:16%"></colgroup>
    <thead><tr><th>Dokument</th><th>Kontrahent</th><th>Data</th><th class="r">Kwota</th><th>Uwagi</th></tr></thead><tbody>${rows.map((row) => `<tr>
      <td>${escapeHtml(row.number || '—')}</td><td>${escapeHtml(row.counterparty || '—')}</td><td>${escapeHtml(plDate(row.date))}</td>
      <td class="r">${escapeHtml(amountText(row.amount, row.currency))}</td><td>${escapeHtml(row.note || '')}</td></tr>`).join('')}</tbody></table>`;
}

function paymentsTable(rows: ReportPayment[], empty: string, withPeriod = false) {
  if (!rows.length) return `<p class="empty">${escapeHtml(empty)}</p>`;
  return `<table><colgroup>${withPeriod ? '<col style="width:12%">' : ''}<col style="width:12%"><col style="width:30%"><col style="width:16%"><col style="width:${withPeriod ? 30 : 42}%"></colgroup>
    <thead><tr>${withPeriod ? '<th>Miesiąc</th>' : ''}<th>Data</th><th>Kontrahent</th><th class="r">Kwota</th><th>Tytuł / uwagi</th></tr></thead><tbody>${rows.map((row) => `<tr>
      ${withPeriod ? `<td>${escapeHtml(row.month && row.year ? `${String(row.month).padStart(2, '0')}.${row.year}` : '')}</td>` : ''}
      <td>${escapeHtml(plDate(row.date))}</td><td>${escapeHtml(row.counterparty || '—')}</td><td class="r">${escapeHtml(amountText(row.amount, row.currency))}</td>
      <td>${escapeHtml(row.reference)}${row.note ? `<div class="sub">${escapeHtml(row.note)}</div>` : ''}${row.acknowledged ? '<div class="sub">świadomie bez dokumentu (zgoda na przekazanie reszty)</div>' : ''}</td>
    </tr>`).join('')}</tbody></table>`;
}

const list = (items: string[]) => (items.length ? `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : '');

/** HTML „Zamknięcie miesiąca”. */
export function monthCloseHtml(report: MonthCloseReport, fontCss: string, generatedAt: Date) {
  const stamp = new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', dateStyle: 'long', timeStyle: 'short' }).format(generatedAt);
  const done = report.checks.filter((check) => check.state === 'ok').length;
  const required = report.checks.filter((check) => check.state !== 'info').length;
  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><style>${fontCss}${CSS}</style></head><body>
    <h1>Zamknięcie miesiąca — ${escapeHtml(monthLabel(report.year, report.month))}</h1>
    <p class="meta">${escapeHtml(report.company)} · stan na ${escapeHtml(stamp)} · gotowe ${done} z ${required}. Dane jak „Dla księgowej” w Centrum finansów.</p>
    ${report.partial ? `<div class="box">${escapeHtml(report.partial)}</div>` : ''}
    <h2>Lista kontrolna</h2>
    <table class="checks"><colgroup><col style="width:36%"><col style="width:16%"><col style="width:48%"></colgroup><tbody>${report.checks.map((check) => `<tr>
      <td>${escapeHtml(check.label)}</td><td class="state ${check.state}">${STATE_LABEL[check.state]}</td><td>${escapeHtml(check.detail)}</td></tr>`).join('')}</tbody></table>
    ${report.blockers.length ? `<h2>Błędy przekazania</h2>${list(report.blockers)}` : ''}
    <h2>Płatności bez dokumentu</h2>${paymentsTable(report.payments, 'Każda płatność z wyciągu ma dokument (albo nie wymaga dokumentu).')}
    <h2>Dokumenty spoza KSeF do uzupełnienia</h2>${documentsTable(report.incomplete, 'Wszystkie dokumenty spoza KSeF mają sprzedawcę, numer i kwotę.')}
    <h2>Dokumenty czekające na przekazanie księgowej</h2>${documentsTable(report.pending, 'Wszystkie dokumenty z plikiem przekazano księgowej.')}
    <h2>Pytania księgowej i płatności oczekujące na dokument</h2>${paymentsTable(report.followups, 'Brak otwartych pytań księgowej.')}
    ${report.warnings.length ? `<h2>Uwagi</h2>${list(report.warnings)}` : ''}
  </body></html>`;
}

/** HTML „Do wyjaśnienia”. */
export function clarifyHtml(report: ClarifyReport, fontCss: string, generatedAt: Date) {
  const stamp = new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', dateStyle: 'long', timeStyle: 'short' }).format(generatedAt);
  const months = report.openMonths.length
    ? `<table><colgroup><col style="width:30%"><col style="width:70%"></colgroup><thead><tr><th>Miesiąc</th><th>Stan</th></tr></thead><tbody>${report.openMonths.map((entry) => `<tr>
      <td>${escapeHtml(monthLabel(entry.year, entry.month))}</td><td>${entry.handedOverAt ? `przekazany księgowej ${escapeHtml(plDate(entry.handedOverAt))}, niezamknięty` : 'nieprzekazany księgowej, niezamknięty'}</td></tr>`).join('')}</tbody></table>`
    : '<p class="empty">Wszystkie minione miesiące z ostatniego roku są zamknięte.</p>';
  const undocumented = report.undocumented.length
    ? `<table><colgroup><col style="width:44%"><col style="width:10%"><col style="width:20%"><col style="width:26%"></colgroup><thead><tr><th>Sprzęt</th><th class="r">Szt.</th><th>Własność</th><th>Gdzie jest dokument</th></tr></thead><tbody>${report.undocumented.map((row) => `<tr>
      <td>${escapeHtml(row.equipment)}</td><td class="r">${row.quantity}</td><td>${escapeHtml(row.ownership)}</td><td>${escapeHtml(row.note)}</td></tr>`).join('')}</tbody></table>`
    : '<p class="empty">Każda partia sprzętu firmy ma dokument zakupu.</p>';
  const unassigned = report.unassigned.length
    ? `<p class="note">${escapeHtml(`Razem ${report.unassignedTotal} szt. bez opisanej własności (Magazyn → sprzęt → „Zakup”). ${report.unassignedNote}`.trim())}</p>
      <table><colgroup><col style="width:64%"><col style="width:18%"><col style="width:18%"></colgroup><thead><tr><th>Sprzęt</th><th class="r">Bez własności</th><th class="r">W Magazynie</th></tr></thead><tbody>${report.unassigned.map((row) => `<tr>
      <td>${escapeHtml(row.equipment)}</td><td class="r">${row.quantity}</td><td class="r">${row.total}</td></tr>`).join('')}</tbody></table>`
    : '<p class="empty">Każda sztuka sprzętu ma opisaną własność.</p>';
  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><style>${fontCss}${CSS}</style></head><body>
    <h1>Do wyjaśnienia — ${escapeHtml(report.company)}</h1>
    <p class="meta">Stan na ${escapeHtml(stamp)}. Otwarte sprawy firmy ze wszystkich miesięcy — szczegóły miesiąca: Księgowość → rok → miesiąc → „Zamknięcie miesiąca”.</p>
    <h2>Niezamknięte miesiące (ostatni rok)</h2>${months}
    <h2>Dokumenty spoza KSeF do uzupełnienia</h2>${documentsTable(report.incomplete, 'Wszystkie dokumenty spoza KSeF mają sprzedawcę, numer i kwotę.')}
    <h2>Pytania księgowej i płatności oczekujące na dokument</h2>${paymentsTable(report.followups, 'Brak otwartych pytań księgowej.', true)}
    <h2>Faktury z KSeF bez pobranego XML</h2>${documentsTable(report.ksefWithoutXml, 'Wszystkie faktury z KSeF mają pobrany XML.')}
    <h2>Sprzęt firmy bez dokumentu zakupu</h2>${undocumented}
    <h2>Sprzęt bez ustalonej własności (wszystkie firmy)</h2>${unassigned}
  </body></html>`;
}

export async function renderMonthClosePdf(report: MonthCloseReport): Promise<Buffer> {
  const html = monthCloseHtml(report, await loadPrintFontCss(), new Date());
  const { pdf } = await renderHtmlToPdf({ html, footer: { left: `Zamknięcie miesiąca — ${monthLabel(report.year, report.month)} — ${report.company}`, right: '' } });
  return pdf;
}

export async function renderClarifyPdf(report: ClarifyReport): Promise<Buffer> {
  const html = clarifyHtml(report, await loadPrintFontCss(), new Date());
  const { pdf } = await renderHtmlToPdf({ html, footer: { left: `Do wyjaśnienia — ${report.company}`, right: '' } });
  return pdf;
}
