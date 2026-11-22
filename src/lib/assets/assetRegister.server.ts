import 'server-only';
import { escapeHtml, loadPrintFontCss, renderHtmlToPdf } from '@/lib/print/pdfRenderer.server';
import { ASSET_OWNERSHIPS, type AssetOwnership, type AssetRegisterRow } from './assetsShared';

/*
 * Rejestr majątku firmy (Dysk → Finanse → firma → Majątek): PDF do wglądu i CSV dla księgowej. Partie sprzętu firmy według
 * własności (środki trwałe, wyposażenie, leasing i najem) z dokumentem zakupu; na końcu sztuki firmy bez wskazanego dokumentu.
 * Sprzęt prywatny nie należy do firmy — nie ma go w rejestrze. Render: wspólny renderer wydruków na serwerze Next. Zmiana
 * szablonu — podnieś `ASSET_REGISTER_VERSION` w `drive.server.ts`.
 */

const COMPANY_OWNERSHIPS: AssetOwnership[] = ['asset', 'equipment', 'leased'];
const money = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const plDate = (value: string | null) => (value ? value.slice(0, 10).split('-').reverse().join('.') : '');
const amountText = (value: number | null, currency: string) => (value === null ? '' : `${money.format(value)}${currency && currency !== 'PLN' ? ` ${currency}` : ''}`);
const equipmentName = (row: AssetRegisterRow) => [row.equipment, [row.brand, row.model].filter(Boolean).join(' ')].filter(Boolean).join(' — ');

/** Sumy w PLN (partie w innych walutach — osobno, bez przeliczania). */
function totals(rows: AssetRegisterRow[]) {
  const pln = rows.filter((row) => row.currency === 'PLN');
  const other = rows.filter((row) => row.currency !== 'PLN' && (row.netAmount !== null || row.grossAmount !== null));
  return {
    quantity: rows.reduce((sum, row) => sum + row.quantity, 0),
    net: pln.reduce((sum, row) => sum + (row.netAmount || 0), 0),
    gross: pln.reduce((sum, row) => sum + (row.grossAmount || 0), 0),
    otherCurrencies: other.length,
  };
}

function sectionHtml(title: string, rows: AssetRegisterRow[], note = '') {
  if (!rows.length) return `<h2>${escapeHtml(title)}</h2><p class="empty">Brak pozycji.</p>`;
  const sum = totals(rows);
  const body = rows.map((row) => `<tr>
      <td>${escapeHtml(equipmentName(row))}${row.notes ? `<div class="sub">${escapeHtml(row.notes)}</div>` : ''}</td>
      <td class="r">${row.quantity}</td><td>${escapeHtml(plDate(row.acquiredOn))}</td>
      <td class="r">${escapeHtml(amountText(row.netAmount, row.currency))}</td><td class="r">${escapeHtml(amountText(row.grossAmount, row.currency))}</td>
      <td>${row.document ? `${escapeHtml(row.document)}${row.counterparty ? `<div class="sub">${escapeHtml(row.counterparty)}${row.documentDate ? ` · ${escapeHtml(plDate(row.documentDate))}` : ''}</div>` : ''}`
        : `<span class="missing">brak dokumentu</span>${row.documentNote ? `<div class="sub">${escapeHtml(row.documentNote)}</div>` : ''}`}</td>
    </tr>`).join('');
  return `<h2>${escapeHtml(title)}</h2>${note ? `<p class="note">${escapeHtml(note)}</p>` : ''}
    <table><colgroup><col style="width:33%"><col style="width:6%"><col style="width:10%"><col style="width:12%"><col style="width:12%"><col style="width:27%"></colgroup>
    <thead><tr><th>Sprzęt</th><th class="r">Szt.</th><th>Data zakupu</th><th class="r">Netto (PLN)</th><th class="r">Brutto (PLN)</th><th>Dokument zakupu</th></tr></thead>
    <tbody>${body}</tbody>
    <tfoot><tr><td>Razem</td><td class="r">${sum.quantity}</td><td></td><td class="r">${money.format(sum.net)}</td><td class="r">${money.format(sum.gross)}</td>
      <td>${sum.otherCurrencies ? `${sum.otherCurrencies} poz. w innych walutach — poza sumą` : ''}</td></tr></tfoot></table>`;
}

/** HTML rejestru (A4 poziomo). */
export function assetRegisterHtml(companyName: string, rows: AssetRegisterRow[], fontCss: string, generatedAt: Date) {
  const sections = COMPANY_OWNERSHIPS.map((key) => {
    const meta = ASSET_OWNERSHIPS.find((entry) => entry.key === key)!;
    return sectionHtml(meta.plural, rows.filter((row) => row.ownership === key), meta.description);
  }).join('');
  const missing = rows.filter((row) => !row.document);
  const stamp = new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', dateStyle: 'long', timeStyle: 'short' }).format(generatedAt);
  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><style>${fontCss}
    @page{size:A4 landscape;margin:12mm}
    *{box-sizing:border-box}
    body{font-family:'Inter',Helvetica,Arial,sans-serif;font-size:9px;color:#111827;margin:0}
    h1{font-size:17px;margin:0 0 2px;font-weight:700}
    h2{font-size:11px;margin:14px 0 4px;font-weight:700;text-transform:uppercase;letter-spacing:.05em}
    .meta{color:#6b7280;margin-bottom:8px}
    .note{color:#6b7280;margin:0 0 4px}
    .empty{color:#9ca3af;margin:0}
    table{width:100%;border-collapse:collapse;table-layout:fixed}
    td{overflow-wrap:anywhere}
    th{background:#f3f4f6;font-weight:600;font-size:8px;text-transform:uppercase;letter-spacing:.04em;color:#374151;text-align:left;padding:4px;border-bottom:1px solid #d1d5db}
    td{padding:4px;border-bottom:1px solid #eef0f3;vertical-align:top}
    tfoot td{font-weight:700;border-top:1px solid #d1d5db;border-bottom:none}
    .r{text-align:right;white-space:nowrap}
    .sub{color:#6b7280;font-size:8px;margin-top:1px}
    .missing{color:#b45309;font-weight:600}
    .summary{display:flex;gap:10px;margin:6px 0 2px}
    .summary div{border:1px solid #e5e7eb;border-radius:4px;padding:5px 8px}
    .summary span{display:block;color:#6b7280;font-size:7.5px;text-transform:uppercase;letter-spacing:.05em}
  </style></head><body>
    <h1>Rejestr majątku — ${escapeHtml(companyName)}</h1>
    <p class="meta">Stan na ${escapeHtml(stamp)}. Sprzęt z Magazynu przypisany do firmy (CRM → Magazyn → sprzęt → „Zakup”). Sprzęt prywatny nie należy do firmy i nie ma go w rejestrze.</p>
    <div class="summary">${COMPANY_OWNERSHIPS.map((key) => {
      const meta = ASSET_OWNERSHIPS.find((entry) => entry.key === key)!;
      return `<div><span>${escapeHtml(meta.plural)}</span>${totals(rows.filter((row) => row.ownership === key)).quantity} szt.</div>`;
    }).join('')}<div><span>Bez dokumentu zakupu</span>${missing.reduce((sum, row) => sum + row.quantity, 0)} szt.</div></div>
    ${sections}
    ${missing.length ? sectionHtml('Do wyjaśnienia — bez dokumentu zakupu', missing, 'Wskaż fakturę albo dokument w karcie sprzętu (Zakup) albo opisz, gdzie jest dokument.') : ''}
  </body></html>`;
}

/** PDF rejestru. */
export async function renderAssetRegisterPdf(companyName: string, rows: AssetRegisterRow[]): Promise<Buffer> {
  const html = assetRegisterHtml(companyName, rows, await loadPrintFontCss(), new Date());
  const { pdf } = await renderHtmlToPdf({ html, footer: { left: `Rejestr majątku — ${companyName}`, right: '' } });
  return pdf;
}

const csvCell = (value: unknown) => {
  const raw = value === null || value === undefined ? '' : String(value);
  return /[";\n\r]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
};
const csvAmount = (value: number | null) => (value === null ? '' : value.toFixed(2).replace('.', ','));

/** CSV dla księgowej (średniki, przecinek dziesiętny, UTF-8 z BOM — Excel w polskich ustawieniach). */
export function assetRegisterCsv(rows: AssetRegisterRow[]): string {
  const header = ['Własność', 'Sprzęt', 'Marka', 'Model', 'Ilość', 'Data zakupu', 'Netto', 'Brutto', 'Waluta', 'Dokument zakupu', 'Kontrahent',
    'Data dokumentu', 'Gdzie jest dokument', 'Uwagi'];
  const lines = rows.filter((row) => COMPANY_OWNERSHIPS.includes(row.ownership)).map((row) => [
    ASSET_OWNERSHIPS.find((entry) => entry.key === row.ownership)?.label || row.ownership, row.equipment, row.brand, row.model, row.quantity,
    row.acquiredOn || '', csvAmount(row.netAmount), csvAmount(row.grossAmount), row.currency, row.document, row.counterparty, row.documentDate || '',
    row.documentNote, row.notes,
  ].map(csvCell).join(';'));
  return `﻿${[header.map(csvCell).join(';'), ...lines].join('\r\n')}\r\n`;
}
