export interface SaldeoControlReportPayment {
  /** Stable bank transaction identifier, used to group a transfer once in an appendix. */
  id?: string;
  date: string;
  postingDate: string;
  reference: string;
  counterparty: string;
  title: string;
  bankAmount: number;
  bankCurrency: string;
  allocatedAmount: number;
  documentAmount: number | null;
  documentCurrency: string;
  note: string;
  collective: boolean;
  statementName: string;
  linkedDocuments?: Array<{
    /** Canonical invoice identity; a CRM and KSeF copy must use the same key. */
    key?: string;
    number: string;
    counterparty: string;
    allocatedAmount: number | null;
    documentAmount: number | null;
    currency: string;
    ksefReference?: string;
  }>;
}

export interface SaldeoControlReportDocument {
  number: string;
  kind: string;
  source: string;
  date: string;
  dueDate: string;
  counterparty: string;
  amount: number | null;
  currency: string;
  note: string;
  ksefReference: string;
  disposition: string;
  payments: SaldeoControlReportPayment[];
  hasPaymentLink?: boolean;
}

export interface SaldeoControlReportTransaction {
  date: string;
  postingDate: string;
  reference: string;
  counterparty: string;
  title: string;
  amount: number;
  currency: string;
  direction: string;
  status: string;
  allocatedAmount: number;
  remainingAmount: number;
  note: string;
  statementName: string;
  documents: string;
  statementOnly?: boolean;
  awaitingDocument?: boolean;
}

export interface SaldeoControlReportFollowup {
  reference: string;
  date: string;
  amount: number;
  currency: string;
  counterparty: string;
  note: string;
  acknowledgedAt: string;
  status: string;
}

export interface SaldeoControlReportFile {
  recipient: 'saldeo' | 'accountant';
  disposition?: 'send' | 'already_sent';
  filename: string;
  contentType: string;
  size: number;
  /** Base64 of the exact prepared attachment, without a data URL prefix. */
  content: string;
  sha256: string;
  description: string;
}

export interface SaldeoControlReportInput {
  companyName: string;
  period: string;
  createdAt: string;
  revision: string;
  sender: string;
  saldeoRecipient: string;
  accountantRecipient: string;
  blockers: string[];
  warnings: string[];
  documents: SaldeoControlReportDocument[];
  transactions: SaldeoControlReportTransaction[];
  followups?: SaldeoControlReportFollowup[];
  files: SaldeoControlReportFile[];
  excludedInvoiceCount: number;
  hiddenTransactionCount: number;
}

const allowedAttachmentTypes = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'text/plain',
  'text/csv',
  'text/html',
  'application/octet-stream',
]);

const amountFormatter = new Intl.NumberFormat('pl-PL', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function text(value: string | null | undefined, fallback = '—'): string {
  return escapeHtml(value?.trim() || fallback);
}

function amount(value: number | null, currency: string): string {
  if (value === null || !Number.isFinite(value)) return 'Brak kwoty';
  return `${escapeHtml(amountFormatter.format(value))} ${text(currency, 'brak waluty')}`;
}

function date(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(value);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : text(value);
}

function generatedAt(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return text(value);
  return escapeHtml(new Intl.DateTimeFormat('pl-PL', {
    dateStyle: 'long',
    timeStyle: 'medium',
    timeZone: 'Europe/Warsaw',
  }).format(parsed));
}

function fileSize(value: number): string {
  if (!Number.isFinite(value) || value < 0) return 'Brak rozmiaru';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${amountFormatter.format(value / 1024)} KB`;
  return `${amountFormatter.format(value / (1024 * 1024))} MB`;
}

function attachmentData(file: SaldeoControlReportFile): { mime: string; base64: string } | null {
  const candidateType = file.contentType.split(';')[0].trim().toLowerCase();
  const mime = allowedAttachmentTypes.has(candidateType) ? candidateType : 'application/octet-stream';
  const base64 = file.content.replace(/\s/g, '');
  if (!base64 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) {
    return null;
  }
  return { mime, base64 };
}

function renderList(values: string[], emptyText: string): string {
  if (!values.length) return `<p class="muted">${escapeHtml(emptyText)}</p>`;
  return `<ul>${values.map(value => `<li>${escapeHtml(value)}</li>`).join('')}</ul>`;
}

function renderPayment(payment: SaldeoControlReportPayment, index: number): string {
  return `<article class="payment">
    <h4>Płatność ${index + 1}${payment.collective ? ' <span class="tag">Płatność zbiorcza / kilka dokumentów</span>' : ''}</h4>
    <dl class="metadata">
      <div><dt>Data operacji / księgowania</dt><dd>${date(payment.date)} / ${date(payment.postingDate)}</dd></div>
      <div><dt>Nadawca / odbiorca</dt><dd>${text(payment.counterparty)}</dd></div>
      <div><dt>Kwota całej operacji bankowej</dt><dd>${amount(payment.bankAmount, payment.bankCurrency)}</dd></div>
      <div><dt>Przypisano z operacji do tego dokumentu</dt><dd>${amount(payment.allocatedAmount, payment.bankCurrency)}</dd></div>
      <div><dt>Rozliczono w walucie dokumentu</dt><dd>${amount(payment.documentAmount, payment.documentCurrency)}</dd></div>
      <div><dt>Numer referencyjny płatności z wyciągu</dt><dd>${text(payment.reference, 'Brak numeru referencyjnego')}</dd></div>
      <div class="wide"><dt>Wyciąg źródłowy</dt><dd>${text(payment.statementName)}</dd></div>
      <div class="wide"><dt>Pełny tytuł przelewu</dt><dd class="multiline">${text(payment.title)}</dd></div>
      <div class="wide"><dt>Opis / wyjaśnienie płatności</dt><dd class="multiline">${text(payment.note, 'Brak dodatkowego opisu')}</dd></div>
    </dl>
    ${payment.linkedDocuments?.length ? `<h4>Dokumenty rozliczane tą płatnością (${payment.linkedDocuments.length})</h4>
      <div class="table-wrap"><table><thead><tr><th>Numer dokumentu</th><th>Kontrahent</th><th>Przypisano z płatności</th><th>Rozliczono w walucie dokumentu</th></tr></thead><tbody>${payment.linkedDocuments.map(linkedDocument => `<tr>
        <td>${text(linkedDocument.number, 'Dokument bez numeru')}</td>
        <td>${text(linkedDocument.counterparty)}</td>
        <td>${amount(linkedDocument.allocatedAmount, payment.bankCurrency)}</td>
        <td>${amount(linkedDocument.documentAmount, linkedDocument.currency)}</td>
      </tr>`).join('')}</tbody></table></div>` : ''}
    ${payment.bankCurrency && payment.documentCurrency && payment.bankCurrency.toUpperCase() !== payment.documentCurrency.toUpperCase()
      ? '<p class="small">Płatność i dokument mają różne waluty. Sprawdź przypisane kwoty w obu walutach; kwota całego przelewu nie musi być kwotą rozliczoną z tym dokumentem.</p>'
      : ''}
    ${payment.collective ? '<p class="small">Kwota całej operacji może powtarzać się przy kilku dokumentach. Nie sumuj jej ponownie; do rozliczenia danego dokumentu służy kwota przypisania.</p>' : ''}
  </article>`;
}

function renderDocument(document: SaldeoControlReportDocument, index: number): string {
  const hasPaymentLink = document.hasPaymentLink ?? document.payments.length > 0;
  return `<article class="document" id="document-${index + 1}">
    <div class="document-heading"><h3>${index + 1}. ${text(document.number, 'Dokument bez numeru')}</h3><span class="document-amount">${amount(document.amount, document.currency)}</span></div>
    <p class="disposition">Plan przekazania: ${text(document.disposition, 'Nie określono — wymaga kontroli')}</p>
    <dl class="metadata">
      <div><dt>Rodzaj / źródło</dt><dd>${text(document.kind)} / ${text(document.source)}</dd></div>
      <div><dt>Kontrahent</dt><dd>${text(document.counterparty)}</dd></div>
      <div><dt>Data dokumentu</dt><dd>${date(document.date)}</dd></div>
      <div><dt>Termin płatności</dt><dd>${date(document.dueDate)}</dd></div>
      <div class="wide"><dt>Numer KSeF</dt><dd>${text(document.ksefReference, 'Nie dotyczy / brak numeru KSeF')}</dd></div>
      ${!hasPaymentLink ? `<div class="wide"><dt>Opis przekazywany z CRM</dt><dd class="multiline note">${text(document.note, 'Brak dodatkowego opisu dokumentu')}</dd></div>` : ''}
    </dl>
    <h4>Powiązane płatności (${document.payments.length})</h4>
    ${document.payments.length
      ? document.payments.map(renderPayment).join('')
      : hasPaymentLink
        ? '<p class="muted">Zapisano powiązanie z płatnością, ale jej szczegóły nie są dostępne w tym zestawieniu.</p>'
        : '<p class="muted">Brak przypisanej płatności w tym zestawieniu. Nie oznacza to automatycznie, że dokument jest nieopłacony.</p>'}
  </article>`;
}

function renderTransaction(transaction: SaldeoControlReportTransaction, index: number): string {
  return `<tr>
    <td><strong>${index + 1}.</strong><br>${date(transaction.date)}<br><span class="small">Księgowanie: ${date(transaction.postingDate)}</span></td>
    <td><strong>${amount(transaction.amount, transaction.currency)}</strong><br>${text(transaction.direction)}<br><span class="small">${transaction.statementOnly ? 'Dokument nie jest wymagany' : `Przypisano: ${amount(transaction.allocatedAmount, transaction.currency)}<br>Pozostało: ${amount(transaction.remainingAmount, transaction.currency)}`}</span></td>
    <td><strong>${text(transaction.counterparty, 'Nieznany kontrahent')}</strong><p class="multiline">${text(transaction.title)}</p><p class="small">Ref.: ${text(transaction.reference)}<br>Wyciąg: ${text(transaction.statementName)}</p></td>
    <td><strong>${text(transaction.status, 'Brak statusu')}</strong>${transaction.awaitingDocument && !transaction.statementOnly ? '<p><span class="tag">Dokument do dosłania</span></p><p class="small">Świadomie pozostawiono do uzupełnienia. Nie oznacza to dopasowania ani rozliczenia płatności.</p>' : ''}${transaction.statementOnly ? `<p>Operacja ujęta tylko na wyciągu i w rejestrze bankowym — bez osobnego dokumentu do Saldeo.</p>${transaction.documents.trim() ? `<p class="multiline">${text(transaction.documents)}</p>` : ''}` : `<p class="multiline">${text(transaction.documents, 'Brak powiązanych dokumentów')}</p>`}</td>
    <td class="multiline">${text(transaction.note, 'Brak dodatkowego opisu')}</td>
  </tr>`;
}

function renderFollowups(followups: SaldeoControlReportFollowup[]): string {
  if (!followups.length) return '<p class="muted">Nie zapisano dokumentów do późniejszego dosłania w tej paczce.</p>';
  return `<div class="table-wrap"><table class="followups"><thead><tr><th>Wydatek z wyciągu</th><th>Kwota</th><th>Opis z analizy</th><th>Potwierdzenie / status</th></tr></thead><tbody>${followups.map((followup, index) => `<tr>
    <td><strong>${index + 1}. ${date(followup.date)}</strong><br>${text(followup.counterparty, 'Nieznany kontrahent')}<p class="small">Nr płatności: ${text(followup.reference, 'Brak numeru referencyjnego')}</p></td>
    <td>${amount(followup.amount, followup.currency)}</td>
    <td class="multiline">${text(followup.note, 'Brak zapisanego opisu w analizie')}</td>
    <td><strong>${text(followup.status, 'Dokument do dosłania')}</strong><p class="small">Potwierdzono świadome pozostawienie do uzupełnienia: ${generatedAt(followup.acknowledgedAt)}</p></td>
  </tr>`).join('')}</tbody></table></div>`;
}

function renderFiles(files: SaldeoControlReportFile[], recipient: 'saldeo' | 'accountant'): string {
  const selected = files.filter(file => file.recipient === recipient);
  if (!selected.length) return '<p class="muted">Brak przygotowanych załączników dla tego odbiorcy.</p>';
  return `<div class="table-wrap"><table class="files"><thead><tr><th>Dokładny załącznik</th><th>Zawartość / rola</th><th>Rozmiar i identyfikator</th></tr></thead><tbody>${selected.map(file => {
    const attachment = attachmentData(file);
    return `<tr><td>${attachment
      ? `<a class="download" href="data:${attachment.mime};base64,${attachment.base64}" download="${escapeHtml(file.filename)}">Pobierz: ${text(file.filename)}</a>`
      : `<strong>${text(file.filename)}</strong><p class="error">Nie udało się osadzić załącznika. Wygeneruj plik kontrolny ponownie przed wysyłką.</p>`}
      <br><span class="small">${text(attachment?.mime || 'application/octet-stream')}</span>
      <p class="${file.disposition === 'already_sent' ? 'muted' : 'ready'}">${file.disposition === 'already_sent' ? 'Pomijany — identyczny raport wysłano wcześniej' : 'Do wysłania w tej paczce'}</p></td>
      <td class="multiline">${text(file.description)}</td>
      <td>${escapeHtml(fileSize(file.size))}<br><span class="small">SHA-256:</span><br><code>${text(file.sha256, 'Brak skrótu — wymaga ponownego przygotowania')}</code></td></tr>`;
  }).join('')}</tbody></table></div>`;
}

function renderTotals(transactions: SaldeoControlReportTransaction[]): string {
  const totals = new Map<string, { income: number; expenses: number; count: number }>();
  transactions.forEach(transaction => {
    if (!Number.isFinite(transaction.amount)) return;
    const currency = transaction.currency.trim().toUpperCase() || 'Brak waluty';
    const total = totals.get(currency) || { income: 0, expenses: 0, count: 0 };
    const direction = transaction.direction.toLocaleLowerCase('pl-PL').trim();
    const explicitExpense = /^(expense|outgoing|debit|wydatek|wypłata|wypływ|obciążenie)$/.test(direction);
    const explicitIncome = /^(income|incoming|credit|wpływ|wpłata|przychód|uznanie)$/.test(direction);
    if (explicitExpense || (!explicitIncome && transaction.amount < 0)) total.expenses += Math.abs(transaction.amount);
    else total.income += Math.abs(transaction.amount);
    total.count += 1;
    totals.set(currency, total);
  });
  if (!totals.size) return '<p class="muted">Brak transakcji do podsumowania.</p>';
  return `<table class="totals"><thead><tr><th>Waluta</th><th>Liczba operacji</th><th>Wpływy</th><th>Wydatki</th></tr></thead><tbody>${Array.from(totals.entries()).map(([currency, total]) => `<tr><td>${escapeHtml(currency)}</td><td>${total.count}</td><td>${amount(total.income, currency)}</td><td>${amount(total.expenses, currency)}</td></tr>`).join('')}</tbody></table>
    <p class="small">Sumy dotyczą wyłącznie operacji ujętych poniżej. Wydatki pokazano jako kwoty bez znaku minus. Waluty są liczone osobno; nie jest to wynik księgowy ani ponowne sumowanie przypisań do faktur.</p>`;
}

/**
 * A bank appendix contains only confirmed one-transfer/many-invoice groups.
 * Callers supply invoice-only canonical linkedDocuments, never personnel entries.
 * One transaction can appear beside many invoices in the internal review; the
 * outgoing appendix keeps it once and does not infer links from amounts or notes.
 */
export function saldeoCollectivePayments(payments: SaldeoControlReportPayment[]): SaldeoControlReportPayment[] {
  const grouped = new Map<string, SaldeoControlReportPayment>();
  for (const payment of payments) {
    if (!payment.collective) continue;
    const documents = new Map<string, NonNullable<SaldeoControlReportPayment['linkedDocuments']>[number]>();
    for (const document of payment.linkedDocuments || []) {
      const key = document.key || JSON.stringify([document.number, document.counterparty, document.currency]);
      if (!documents.has(key)) documents.set(key, document);
    }
    if (documents.size < 2) continue;
    const key = payment.id || JSON.stringify([payment.statementName, payment.reference, payment.date, payment.bankAmount, payment.bankCurrency]);
    if (!grouped.has(key)) grouped.set(key, { ...payment, linkedDocuments: [...documents.values()] });
  }
  return [...grouped.values()].sort((left, right) => left.date.localeCompare(right.date)
    || left.reference.localeCompare(right.reference) || (left.id || '').localeCompare(right.id || ''));
}

function csvCell(value: unknown): string {
  const raw = String(value ?? '');
  // Descriptions and invoice numbers are text, never spreadsheet formulas.
  const safe = /^[\s]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** Accounting appendix only — not the full internal reconciliation register. */
export function buildSaldeoCollectivePaymentCsv(payments: SaldeoControlReportPayment[]): string {
  const rows: unknown[][] = [[
    'Grupa płatności', 'Wyciąg źródłowy', 'Data operacji', 'Data księgowania', 'Numer płatności z wyciągu',
    'Kontrahent przelewu', 'Tytuł przelewu', 'Kwota całego przelewu — tylko raz w grupie', 'Waluta przelewu',
    'Numer faktury / dokumentu', 'Kontrahent dokumentu', 'Numer KSeF — plik nie jest wysyłany ponownie',
    'Przypisano z przelewu', 'Rozliczono w walucie dokumentu', 'Waluta dokumentu',
  ]];
  saldeoCollectivePayments(payments).forEach((payment, groupIndex) => {
    payment.linkedDocuments!.forEach((document, index) => rows.push([
      groupIndex + 1, index === 0 ? payment.statementName : '', index === 0 ? payment.date : '',
      index === 0 ? payment.postingDate : '', index === 0 ? payment.reference || 'Brak numeru referencyjnego na wyciągu' : '',
      index === 0 ? payment.counterparty : '', index === 0 ? payment.title : '',
      index === 0 && Number.isFinite(payment.bankAmount) ? payment.bankAmount.toFixed(2) : '', payment.bankCurrency,
      document.number, document.counterparty, document.ksefReference || '',
      document.allocatedAmount != null && Number.isFinite(document.allocatedAmount) ? document.allocatedAmount.toFixed(2) : 'Brak zapisanej kwoty',
      document.documentAmount != null && Number.isFinite(document.documentAmount) ? document.documentAmount.toFixed(2) : 'Brak zapisanej kwoty',
      document.currency,
    ]));
  });
  return '\uFEFF' + rows.map((row) => row.map(csvCell).join(';')).join('\r\n');
}

/** A printable companion to unchanged source statements, not a replacement. */
export function buildSaldeoCollectivePaymentHtml(input: {
  companyName: string;
  period: string;
  payments: SaldeoControlReportPayment[];
}): string {
  const payments = saldeoCollectivePayments(input.payments);
  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
  <meta name="referrer" content="no-referrer"><title>Płatności zbiorcze — ${text(input.companyName)} — ${text(input.period)}</title>
  <style>
    *{box-sizing:border-box}body{margin:0;background:#f5f4f3;color:#29252b;font:14px/1.5 Arial,Helvetica,sans-serif}main{max-width:1050px;margin:auto;padding:30px 22px}
    header,article{background:white;padding:24px;border-radius:10px;margin-bottom:20px}h1{font-size:25px;margin:0 0 8px}h2{font-size:18px;margin:0 0 14px}p{margin:8px 0}
    dl{display:grid;grid-template-columns:1fr 1fr;gap:12px 24px}dt{font-size:12px;color:#6b656d}dd{margin:0;overflow-wrap:anywhere}.wide{grid-column:1/-1}.muted{color:#6b656d;font-size:12px}.title{white-space:pre-wrap}
    table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:12px}th,td{text-align:left;vertical-align:top;padding:10px 8px;border-bottom:1px solid #eee9ec;overflow-wrap:anywhere}th{background:#f5f2f4;font-weight:600}.notice{background:#f8f3e6;padding:10px 12px;border-radius:6px}
    @media(max-width:640px){main{padding:12px}header,article{padding:16px}dl{grid-template-columns:1fr}.table-wrap{overflow:auto}table{min-width:650px}}
    @media print{@page{size:A4;margin:12mm}body{background:white;font-size:10pt}main{padding:0}header,article{padding:10px 0;border-radius:0}h2{break-after:avoid}dl>div,tr{break-inside:avoid}table{min-width:0;font-size:8pt}thead{display:table-header-group}.table-wrap{overflow:visible}}
  </style></head><body><main><header><h1>PŁATNOŚCI ZBIORCZE — OPIS DO WYCIĄGÓW</h1>
  <p><strong>${text(input.companyName)} · ${text(input.period)}</strong></p>
  <p>Wyłącznie przelewy powiązane w CRM z co najmniej dwiema fakturami lub dokumentami zakupowymi (${payments.length}). Jeden przelew pokazano raz, z kwotą przypisaną do każdego dokumentu.</p>
  <p class="muted">Ten załącznik uzupełnia oryginalne wyciągi; nie zmienia ich treści. Numer KSeF identyfikuje dokument już dostępny w KSeF — nie oznacza ponownej wysyłki faktury. Pozostałe przelewy, kadry, podatki i wewnętrzna lista braków nie są częścią tego opisu.</p></header>
  ${payments.map((payment, index) => {
    const documents = payment.linkedDocuments!;
    const allAmountsKnown = documents.every((document) => document.allocatedAmount != null && Number.isFinite(document.allocatedAmount));
    const allocated = documents.reduce((total, document) => total + (document.allocatedAmount || 0), 0);
    const difference = Math.round((payment.bankAmount - allocated) * 100) / 100;
    return `<article><h2>${index + 1}. ${date(payment.date)} · ${amount(payment.bankAmount, payment.bankCurrency)}</h2>
      <dl><div><dt>Numer płatności z wyciągu</dt><dd>${text(payment.reference, 'Brak numeru referencyjnego — szukaj po dacie, tytule i kwocie')}</dd></div>
      <div><dt>Data księgowania</dt><dd>${date(payment.postingDate)}</dd></div>
      <div><dt>Kontrahent przelewu</dt><dd>${text(payment.counterparty)}</dd></div><div><dt>Wyciąg źródłowy</dt><dd>${text(payment.statementName)}</dd></div>
      <div class="wide"><dt>Tytuł przelewu</dt><dd class="title">${text(payment.title)}</dd></div></dl>
      <div class="table-wrap"><table><thead><tr><th>Dokument / numer KSeF</th><th>Kontrahent</th><th>Przypisano z przelewu</th><th>Rozliczono w walucie dokumentu</th></tr></thead><tbody>
      ${documents.map((document) => `<tr><td><strong>${text(document.number, 'Dokument bez numeru')}</strong>${document.ksefReference ? `<p class="muted">KSeF: ${text(document.ksefReference)}</p>` : ''}</td><td>${text(document.counterparty)}</td><td>${amount(document.allocatedAmount, payment.bankCurrency)}</td><td>${amount(document.documentAmount, document.currency)}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="muted">Cała operacja: ${amount(payment.bankAmount, payment.bankCurrency)}. ${allAmountsKnown ? `Łącznie przypisano do powyższych dokumentów: ${amount(allocated, payment.bankCurrency)}.` : 'Nie wszystkie kwoty przypisań są dostępne — nie należy domyślnie przypisywać całego przelewu do każdej faktury.'} Kwoty przelewu nie należy ponownie doliczać do sum faktur.</p>
      ${allAmountsKnown && Math.abs(difference) > 0.01 ? `<p class="notice">${difference > 0 ? 'Część przelewu poza powyższym przypisaniem' : 'Kwota przypisań przewyższa przelew — wymaga kontroli'}: ${amount(Math.abs(difference), payment.bankCurrency)}. Zestawienie nie potwierdza pełnego rozliczenia tej operacji.</p>` : ''}</article>`;
  }).join('') || '<article><p>W tym okresie nie ma potwierdzonych płatności zbiorczych do opisania.</p></article>'}
  <footer class="muted">Załącznik informacyjny z zapisanych powiązań CRM. Nie jest fakturą, dodatkowym kosztem ani potwierdzeniem automatycznego utworzenia rozrachunków w Saldeo.</footer>
  </main></body></html>`;
}

/** Builds an offline review snapshot only. It never uploads, fetches or sends any data. */
export function buildSaldeoControlReport(input: SaldeoControlReportInput): string {
  const invalidAttachments = input.files.filter(file => !attachmentData(file));
  const blockers = [...input.blockers];
  if (invalidAttachments.length) {
    blockers.push(`Nie można otworzyć ${invalidAttachments.length} przygotowanych załączników w tym pliku kontrolnym. Przygotuj paczkę ponownie.`);
  }
  const saldeoFiles = input.files.filter(file => file.recipient === 'saldeo' && file.disposition !== 'already_sent');
  const accountantFiles = input.files.filter(file => file.recipient === 'accountant' && file.disposition !== 'already_sent');
  const followups = input.followups || [];

  return `<!doctype html>
<html lang="pl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
  <meta name="referrer" content="no-referrer">
  <title>Plik kontrolny — ${escapeHtml(input.companyName)} — ${escapeHtml(input.period)}</title>
  <style>
    * { box-sizing: border-box; }
    html { color-scheme: light; }
    body { margin: 0; color: #25222a; background: #f5f4f3; font-family: Arial, Helvetica, sans-serif; font-size: 14px; line-height: 1.5; }
    main { max-width: 1220px; margin: 0 auto; padding: 32px 24px 60px; }
    h1 { margin: 8px 0 12px; font-size: 27px; line-height: 1.25; }
    h2 { margin: 0 0 16px; font-size: 21px; }
    h3 { margin: 0; font-size: 17px; }
    h4 { margin: 18px 0 10px; font-size: 14px; }
    p { margin: 8px 0; }
    a { color: #6b2840; text-decoration-thickness: 1px; text-underline-offset: 3px; overflow-wrap: anywhere; }
    a:focus-visible { outline: 1px solid #6b2840; outline-offset: 3px; }
    code { font-size: 10px; overflow-wrap: anywhere; word-break: break-word; }
    header, section { margin-bottom: 22px; background: #fff; border-radius: 12px; padding: 24px; box-shadow: 0 2px 10px rgba(37,34,42,.035); }
    header { background: #efe8eb; }
    nav { display: flex; flex-wrap: wrap; gap: 8px 20px; margin-top: 20px; }
    .eyebrow { color: #72243d; font-size: 12px; font-weight: 700; letter-spacing: .07em; }
    .muted, .small, dt { color: #65616b; }
    .small { font-size: 12px; }
    .multiline { white-space: pre-wrap; overflow-wrap: anywhere; }
    .metadata { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 12px 24px; margin: 16px 0; }
    .metadata div { min-width: 0; }
    .metadata .wide { grid-column: 1 / -1; }
    dt { font-size: 12px; margin-bottom: 2px; }
    dd { margin: 0; overflow-wrap: anywhere; }
    .summary { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 12px; margin: 20px 0; }
    .summary div { background: #f5f3f4; padding: 12px 14px; border-radius: 8px; }
    .summary strong { display: block; font-size: 22px; color: #69293e; }
    .summary span { font-size: 12px; }
    .notice { padding: 16px 20px; background: #f3efe1; border-radius: 8px; }
    .blockers { background: #fbefee; }
    .error { color: #963c34; }
    .ready { color: #326249; }
    ul, ol { margin: 10px 0; padding-left: 22px; }
    li { margin: 6px 0; overflow-wrap: anywhere; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 12px; }
    th { text-align: left; color: #65616b; font-weight: 600; background: #f5f3f4; }
    th, td { vertical-align: top; padding: 12px 10px; border-bottom: 1px solid rgba(37,34,42,.07); overflow-wrap: anywhere; }
    td p { margin: 7px 0; }
    tbody tr:last-child td { border-bottom: 0; }
    .files th:nth-child(1) { width: 32%; }
    .files th:nth-child(2) { width: 38%; }
    .files th:nth-child(3) { width: 30%; }
    .transactions th:nth-child(1) { width: 12%; }
    .transactions th:nth-child(2) { width: 16%; }
    .transactions th:nth-child(3) { width: 29%; }
    .transactions th:nth-child(4) { width: 21%; }
    .transactions th:nth-child(5) { width: 22%; }
    .download { display: inline-block; padding: 5px 0; font-weight: 600; }
    .document { margin-top: 18px; padding: 20px; background: #faf9f9; border-radius: 10px; }
    .document-heading { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 10px; }
    .document-amount { font-size: 17px; font-weight: 700; }
    .disposition { color: #69293e; font-weight: 600; }
    .note { background: #f1edf0; padding: 10px 12px; border-radius: 6px; }
    .payment { background: #fff; padding: 1px 16px 12px; margin-top: 12px; border-radius: 8px; }
    .tag { display: inline-block; margin-left: 6px; color: #6c5530; background: #f3efdf; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 400; }
    footer { padding: 0 6px; color: #65616b; font-size: 12px; }
    @media (max-width: 720px) {
      main { padding: 16px 10px 32px; }
      header, section { padding: 18px 14px; }
      h1 { font-size: 23px; }
      .metadata { grid-template-columns: minmax(0,1fr); }
      .summary { grid-template-columns: repeat(2,minmax(0,1fr)); }
      .table-wrap { overflow-x: auto; }
      .files, .transactions, .followups { min-width: 760px; }
      .document { padding: 16px 12px; }
    }
    @media print {
      @page { size: A4; margin: 12mm; }
      body { background: #fff; font-size: 10pt; }
      main { max-width: none; margin: 0; padding: 0; }
      header, section { box-shadow: none; padding: 12px 0; border-radius: 0; margin-bottom: 12px; }
      header { background: #fff; }
      nav { display: none; }
      h1 { font-size: 20pt; }
      h2 { font-size: 16pt; break-after: avoid; }
      h3, h4 { break-after: avoid; }
      .summary, .metadata > div, .payment, tr { break-inside: avoid; }
      .document { padding: 12px; margin-top: 12px; }
      .document-heading { break-after: avoid; }
      .table-wrap { overflow: visible; }
      .files, .transactions, .followups { min-width: 0; }
      table { font-size: 8pt; }
      th, td { padding: 7px 5px; }
      thead { display: table-header-group; }
      a { color: #25222a; text-decoration: none; }
      .small { font-size: 8pt; }
      footer { font-size: 8pt; }
    }
  </style>
</head>
<body>
<main>
  <header>
    <div class="eyebrow">PLIK KONTROLNY — NICZEGO NIE WYSŁANO</div>
    <h1>${escapeHtml(input.companyName)} · ${escapeHtml(input.period)}</h1>
    <p>To jest wewnętrzny plik kontroli CRM, zawierający również dane, które nie będą wysyłane. Utworzenie ani otwarcie tego pliku nie wysyła wiadomości i nie zmienia danych w Saldeo. Faktyczną paczkę określa wyłącznie spis załączników w sekcji 2.</p>
    <dl class="metadata">
      <div><dt>Przygotowano</dt><dd>${generatedAt(input.createdAt)} (czas polski)</dd></div>
      <div><dt>Wersja kontrolowanej paczki</dt><dd><code>${text(input.revision)}</code></dd></div>
      <div><dt>Konto nadawcy</dt><dd>${text(input.sender, 'Nie wybrano nadawcy')}</dd></div>
      <div><dt>Firma / okres</dt><dd>${text(input.companyName)} / ${text(input.period)}</dd></div>
      <div><dt>Odbiorca dokumentów — Saldeo</dt><dd>${text(input.saldeoRecipient, 'Nie podano odbiorcy Saldeo')}</dd></div>
      <div><dt>Odbiorca wyciągów i opisu płatności zbiorczych — księgowa</dt><dd>${text(input.accountantRecipient, 'Nie podano odbiorcy księgowej')}</dd></div>
    </dl>
    <nav aria-label="Sekcje pliku kontrolnego"><a href="#control">Kontrola przed wysyłką</a><a href="#files">Dokładne załączniki</a><a href="#documents">Dokumenty i płatności</a><a href="#transactions">Transakcje i opisy</a><a href="#followups">Dokumenty do dosłania (${followups.length})</a></nav>
  </header>

  <section id="control">
    <h2>1. Kontrola przed wysyłką</h2>
    <div class="summary">
      <div><strong>${input.documents.length}</strong><span>Dokumentów w zestawieniu</span></div>
      <div><strong>${input.transactions.length}</strong><span>Transakcji w zestawieniu</span></div>
      <div><strong>${saldeoFiles.length}</strong><span>Załączników do Saldeo</span></div>
      <div><strong>${accountantFiles.length}</strong><span>Załączników do księgowej</span></div>
    </div>
    <div class="notice ${blockers.length ? 'blockers' : ''}">
      <h3 class="${blockers.length ? 'error' : 'ready'}">${blockers.length ? `Wysyłka wymaga uzupełnienia (${blockers.length})` : 'Brak wykrytych blokad — nadal wymagane jest Twoje sprawdzenie'}</h3>
      ${renderList(blockers, 'Automatyczna kontrola nie wykryła blokad. Nie jest to potwierdzenie poprawności księgowej dokumentów.')}
    </div>
    <h3 style="margin-top:20px">Uwagi i rzeczy do sprawdzenia</h3>
    ${renderList(input.warnings, 'Brak dodatkowych ostrzeżeń w momencie przygotowania paczki.')}
    <ol>
      <li>Sprawdź firmę, okres oraz oba adresy odbiorców.</li>
      <li>Otwórz przygotowane załączniki z następnej sekcji: szczególnie opisane faktury, dokumenty spoza KSeF i wyciągi.</li>
      <li>Sprawdź numery i kwoty dokumentów, terminy, opisy, powiązania oraz płatności zbiorcze i walutowe.</li>
      ${followups.length ? '<li>Sprawdź listę dokumentów do dosłania. Potwierdzono świadome pozostawienie tych wydatków bez dokumentu na czas wysyłki pozostałej paczki; braki nadal wymagają późniejszego uzupełnienia.</li>' : ''}
      <li>Jeżeli coś wymaga poprawy, wróć do CRM i przygotuj nowy plik kontrolny. Ten plik jest migawką i sam się nie aktualizuje.</li>
      <li>Wysyłkę uruchom dopiero po świadomym potwierdzeniu tej paczki w CRM. Pobranie tego pliku nie jest zgodą na wysłanie.</li>
    </ol>
    <p class="small">Wyłączone faktury: ${escapeHtml(input.excludedInvoiceCount)}. Transakcje pominięte w zestawieniu: ${escapeHtml(input.hiddenTransactionCount)}. Brak pozycji w tej paczce nie oznacza, że dokument nie istnieje w bazie.</p>
    <h3 style="margin-top:20px">Kwoty operacji bankowych według waluty</h3>
    ${renderTotals(input.transactions)}
  </section>

  <section id="files">
    <h2>2. Dokładne pliki przygotowane do wysłania</h2>
    <p>Załączniki są zapisane wewnątrz tego pliku kontrolnego. „Pobierz” zapisuje lokalnie dokładnie przygotowany plik — nie łączy się z CRM ani nie wysyła go do odbiorcy. Skróty SHA-256 identyfikują jego zawartość. Pliki oznaczone jako wysłane wcześniej pozostają dostępne do kontroli, ale nie będą wysyłane ponownie i nie są liczone jako nowe załączniki.</p>
    <p class="small">Wydruk zawiera spis załączników, ale nie ich pliki. Zachowaj wersję HTML, aby móc je pobierać.</p>
    <h3 style="margin:20px 0 12px">Do Saldeo — ${text(input.saldeoRecipient)}</h3>
    ${renderFiles(input.files, 'saldeo')}
    <h3 style="margin:24px 0 12px">Do księgowej — ${text(input.accountantRecipient)}</h3>
    ${renderFiles(input.files, 'accountant')}
    <div class="notice" style="margin-top:20px">
      <strong>Co zostanie przekazane, a co nie?</strong>
      <p>Do Saldeo przekazywane są dokumenty spoza KSeF. Faktury obecne w KSeF nie są wysyłane ponownie. Księgowa otrzymuje oryginalne wyciągi oraz osobny, kompaktowy opis wyłącznie płatności zbiorczych. Wiążący spis przygotowanych załączników znajduje się powyżej.</p>
      <p>Sekcje 3–5 poniżej służą tylko Twojej kontroli: pełny rejestr dopasowań, kadry, podatki i lista braków pozostają w CRM. Nie są automatycznie dołączane do wiadomości. Opis płatności zbiorczych uzupełnia niezmieniony wyciąg, a nie zastępuje jego oryginału.</p>
      <p>Wysyłka e-mailem nie ustawia automatycznie rozrachunków ani statusów płatności w Saldeo i nie potwierdza odczytu dokumentów przez Saldeo.</p>
    </div>
  </section>

  <section id="documents">
    <h2>3. Kontrola wewnętrzna: dokumenty i przypisane płatności</h2>
    <p class="small">Porównaj te dane z oryginałem i dokładnym załącznikiem z sekcji 2. Opis rozliczenia nie zmienia treści oryginalnej faktury.</p>
    ${input.documents.length ? input.documents.map(renderDocument).join('') : '<p class="muted">Brak dokumentów w przygotowanym zestawieniu.</p>'}
  </section>

  <section id="transactions">
    <h2>4. Kontrola wewnętrzna: transakcje i wyjaśnienia</h2>
    <p class="small">Pełny tytuł, numer referencyjny i nazwa wyciągu pozwalają odszukać operację w źródle. Opłaty, podatki i pozostałe wyjaśnione operacje nie muszą mieć przypisanej faktury.</p>
    ${input.transactions.length ? `<div class="table-wrap"><table class="transactions"><thead><tr><th>Data</th><th>Kwoty</th><th>Kontrahent i źródło</th><th>Status / dokumenty</th><th>Opis i wyjaśnienie</th></tr></thead><tbody>${input.transactions.map(renderTransaction).join('')}</tbody></table></div>` : '<p class="muted">Brak transakcji w przygotowanym zestawieniu.</p>'}
  </section>

  <section id="followups">
    <h2>5. Wewnętrzna lista dokumentów do dosłania (${followups.length})</h2>
    <p>To lista wydatków bankowych, dla których dokumenty trzeba jeszcze odnaleźć i dosłać. Nie jest to lista dokumentów ani osobnych plików wysyłanych w tej paczce.</p>
    <p>Świadome potwierdzenie pozwala wysłać pozostałe przygotowane dokumenty, pozostawiając te braki na liście do uzupełnienia w CRM. Nie tworzy powiązania z fakturą, nie zmienia płatności na rozliczoną i nie potwierdza wysłania ani otrzymania brakującego dokumentu.</p>
    ${renderFollowups(followups)}
    <p class="small">Kwoty służą odnalezieniu operacji na wyciągu. Nie doliczaj ich ponownie do kosztów ani sum transakcji z tego raportu. Lista przedstawia stan w chwili przygotowania pliku kontrolnego; po uzupełnieniu dokumentów przygotuj nową paczkę do dosłania.</p>
  </section>

  <footer>
    <p><strong>Dane poufne.</strong> Ten plik zawiera dokumenty źródłowe, dane kontrahentów oraz informacje finansowe i może zawierać dane kadrowe. Przechowuj go lokalnie w bezpiecznym miejscu. Nie publikuj go i nie przekazuj osobom nieuprawnionym.</p>
    <p>Plik jest samowystarczalny: nie zawiera skryptów, zasobów zewnętrznych, adresów dostępowych do plików ani PIN-u Saldeo. Kontrolowana wersja: <code>${text(input.revision)}</code>.</p>
  </footer>
</main>
</body>
</html>`;
}
