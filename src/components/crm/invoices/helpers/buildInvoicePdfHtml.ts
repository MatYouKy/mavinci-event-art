import { InvoiceItem } from '@/app/(crm)/crm/invoices/[id]/page';

export interface SettledInvoicePdfRef {
  id?: string;
  invoiceNumber: string;
  invoiceType: string;
  issueDate?: string;
  totalNet: number;
  totalVat: number;
  totalGross: number;
}

interface InvoicePdfData {
  footerNote: string;
  signatureName: string;
  website: string;
  invoiceNumber: string;
  invoiceType: string;
  issueDate: string;
  saleDate: string;
  issuePlace: string;
  paymentMethod: string;
  paymentDueDate: string;
  bankAccount: string;
  bankName?: string;
  sellerName: string;
  sellerNip: string;
  sellerStreet: string;
  sellerCity: string;
  sellerPostalCode: string;
  buyerName: string;
  buyerNip?: string;
  buyerStreet: string;
  buyerCity: string;
  buyerPostalCode: string;
  totalNet: number;
  totalVat: number;
  totalGross: number;
  companyLogoUrl?: string | null;
  isProforma: boolean;
  items: Array<{
    positionNumber: number;
    name: string;
    unit: string;
    quantity: number;
    priceNet: number;
    vatRate: number;
    valueNet: number;
    vatAmount: number;
    valueGross: number;
  }>;
  invoice_items?: Array<InvoiceItem>;
  settledInvoices?: SettledInvoicePdfRef[];
  settlementSummary?: {
    invoiceTotalNet: number;
    invoiceTotalVat: number;
    invoiceTotalGross: number;
    settledNet: number;
    settledVat: number;
    settledGross: number;
    remainingNet: number;
    remainingVat: number;
    remainingGross: number;
  };
}

function getTypeLabel(type: string, invoiceNumber?: string) {
  if (type === 'final' || invoiceNumber?.startsWith('FKO/')) {
    return 'Faktura końcowa';
  }

  const labels: Record<string, string> = {
    vat: 'Faktura VAT',
    proforma: 'Faktura Proforma',
    advance: 'Faktura zaliczkowa',
    corrective: 'Faktura korygująca',
    final: 'Faktura końcowa',
  };

  return labels[type] || 'Faktura VAT';
}

export const buildInvoicePdfHtml = (data: InvoicePdfData) => {
  const esc = (s: any) =>
    String(s ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');

  const formatDate = (value?: string) => {
    if (!value) return '';
    return new Date(value).toLocaleDateString('pl-PL');
  };

  const formatMoney = (value?: number) => Number(value || 0).toFixed(2);

  const invoiceItems =
    data.items && data.items.length > 0
      ? data.items
      : data.invoice_items && data.invoice_items.length > 0
        ? data.invoice_items.map((item: any, idx: number) => ({
            positionNumber: item.position_number ?? idx + 1,
            name: item.name,
            unit: item.unit,
            quantity: Number(item.quantity),
            priceNet: Number(item.price_net ?? item.unit_price_net ?? 0),
            vatRate: Number(item.vat_rate ?? 0),
            valueNet: Number(item.value_net ?? item.total_net ?? 0),
            vatAmount: Number(item.vat_amount ?? item.total_vat ?? 0),
            valueGross: Number(item.value_gross ?? item.total_gross ?? 0),
          }))
        : [];

        const paymentMethod = data.paymentMethod?.toLowerCase().trim() || '';
const isCash = paymentMethod === 'gotówka' || paymentMethod === 'gotowka' || paymentMethod === 'cash';

const label = isCash ? 'Zapłacono:' : 'Do zapłaty:';

const isFinalInvoice =
  data.invoiceType === 'final' || data.invoiceNumber?.startsWith('FKO/');

  const amountToPay = isFinalInvoice && data.settlementSummary
  ? data.settlementSummary.remainingGross
  : data.totalGross;

  const finalSettlementHtml =
  isFinalInvoice && data.settlementSummary
    ? `
      <div class="settlement-box">
        <div class="settlement-title">Rozliczenie zaliczek</div>

        <table class="settlement-table">
          <thead>
            <tr>
              <th>Opis</th>
              <th>Netto</th>
              <th>VAT</th>
              <th>Brutto</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Wartość faktury końcowej</td>
              <td class="right">${formatMoney(data.settlementSummary.invoiceTotalNet)}</td>
              <td class="right">${formatMoney(data.settlementSummary.invoiceTotalVat)}</td>
              <td class="right strong">${formatMoney(data.settlementSummary.invoiceTotalGross)}</td>
            </tr>
            <tr>
              <td>Rozliczone zaliczki</td>
              <td class="right">${formatMoney(data.settlementSummary.settledNet)}</td>
              <td class="right">${formatMoney(data.settlementSummary.settledVat)}</td>
              <td class="right strong">${formatMoney(data.settlementSummary.settledGross)}</td>
            </tr>
            <tr>
              <td class="strong">Pozostało do zapłaty</td>
              <td class="right strong">${formatMoney(data.settlementSummary.remainingNet)}</td>
              <td class="right strong">${formatMoney(data.settlementSummary.remainingVat)}</td>
              <td class="right strong">${formatMoney(data.settlementSummary.remainingGross)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    `
    : '';

    const settledInvoicesHtml =
  isFinalInvoice && data.settledInvoices?.length
    ? `
      <div class="advance-list">
        <div class="settlement-title">Rozliczane faktury zaliczkowe</div>
        ${data.settledInvoices
          .map(
            (inv) => `
              <div class="advance-row">
                ${esc(inv.invoiceNumber)}
                ${inv.issueDate ? ` z dnia ${esc(formatDate(inv.issueDate))}` : ''}
                — ${formatMoney(inv.totalGross)} PLN brutto
              </div>
            `,
          )
          .join('')}
      </div>
    `
    : '';

  const rows = invoiceItems.length
  ? invoiceItems
      .map(
        (item) => `
          <tr>
            <td>${item.positionNumber}</td>
            <td>${esc(item.name)}</td>
            <td class="center">${esc(item.unit)}</td>
            <td class="right">${item.quantity}</td>
            <td class="right">${formatMoney(item.priceNet)}</td>
            <td class="right">${formatMoney(item.valueNet)}</td>
            <td class="center">${item.vatRate}%</td>
            <td class="right">${formatMoney(item.vatAmount)}</td>
            <td class="right strong">${formatMoney(item.valueGross)}</td>
          </tr>
        `,
      )
      .join('')
  : `
      <tr>
        <td colspan="9" class="center">Brak pozycji</td>
      </tr>
    `;

  return `<!DOCTYPE html>
<html lang="pl">

<head>
  <meta charset="UTF-8" />
    <title>${esc(getTypeLabel(data.invoiceType, data.invoiceNumber))} ${esc(data.invoiceNumber)}</title>
     <style>
    @page {
      size: A4;
      margin: 10mm;
    }

    html,
    body {
      margin: 0;
      padding: 0;
    }

    body {
      font-family: Arial, Helvetica, sans-serif;
      color: #111;
      font-size: 12px;
      line-height: 1.45;
      margin: 10mm;
      min-height: calc(297mm - 20mm);
      width: calc(210mm - 20mm);
      box-sizing: border-box;

      display: flex;
      flex-direction: column;
    }

    .top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 24px;
      gap: 20px;
    }

    .logo {
      max-height: 50px;
      width: auto;
    }

    .meta {
      text-align: right;
      font-size: 11px;
      margin-right: 5px;
    }

    .meta-label {
      color: #666;
    }

    .parties {
      display: table;
      width: 100%;
      table-layout: fixed;
      margin-bottom: 24px;
    }

    .party {
      display: table-cell;
      width: 50%;
      vertical-align: top;
    }

    .party-left {
      padding-right: 12px;
    }

    .party-right {
      padding-left: 12px;
    }

    .section-label {
      color: #666;
      font-size: 11px;
      margin-bottom: 4px;
    }

    .strong {
      font-weight: 700;
    }

    .title {
      text-align: center;
      font-size: 18px;
      font-weight: 700;
      margin-bottom: 20px;
    }

    table {
      border-collapse: collapse;
      width: calc(100% - 2mm);
      table-layout: fixed;
    }

    th,
    td {
      border: 1px solid #d1d5db;
      padding: 6px 8px;
      font-size: 11px;
      vertical-align: top;
      color: #111;
    }

    th {
      background: #e5e7eb;
      font-size: 11px;
      font-weight: 700;
      text-align: left;
      color: #111;
    }

    .preview-banner {
      width: 100%;
      background: #6b7280;
      color: #ffffff;
      text-align: center;
      letter-spacing: 6px;
      font-size: 12px;
      font-weight: 700;
      padding: 6px 0;
      margin: -10mm -10mm 16px -10mm;
      width: calc(100% + 20mm);
      box-sizing: border-box;
      text-transform: uppercase;
    }

    .center {
      text-align: center;
    }

    .right {
      text-align: right;
    }

    .summary {
      margin-top: 20px;
      display: table;
      width: 100%;
      table-layout: fixed;
    }

    .summary-left,
    .summary-right {
      display: table-cell;
      width: 50%;
      vertical-align: top;
    }

    .summary-left {
      padding-right: 12px;
    }

    .summary-right {
      padding-left: 12px;
    }

    .bank-box {
      font-size: 12px;
      margin-top: 4px;
    }

    .amount {
      font-size: 16px;
      font-weight: 700;
    }

    .footer-note {
      margin-top: 30px;
      font-size: 10px;
      color: #000;
    }

    .signature {
      margin: 60px 5% 0;
      text-align: right;
    }

    .signature-container {
      display: inline-block;
      width: auto;
    }

    .signature-line {
      display: inline-block;
      width: 180px;
      border-top: 1px solid #d1d5db;
      padding: 4px 0;
      text-align: center;
    }

    .signature-employee {
      font-size: 12px;
      font-weight: 700;
      color: #000;
      margin-bottom: 4px;
      text-align: center;
    }

    .signature-role {
      font-size: 9px;
      color: #666;
    }

    .footer-website {
      margin-top: auto;
      text-align: center;
      font-size: 9px;
      color: #999;
      padding-top: 12px;
    }

    .settlement-box {
  margin-top: 16px;
  }

  .settlement-title {
    font-size: 12px;
    font-weight: 700;
    margin-bottom: 6px;
  }

  .settlement-table th,
  .settlement-table td {
    font-size: 10.5px;
    padding: 5px 7px;
  }

  .settlement-table th:first-child,
  .settlement-table td:first-child {
    width: 46%;
  }
      .advance-list {
    margin-top: 14px;
    font-size: 11px;
  }

  .advance-row {
    border: 1px solid #d1d5db;
    border-bottom: 0;
    padding: 5px 7px;
  }

  .advance-row:last-child {
    border-bottom: 1px solid #d1d5db;
  }
  </style>
</head>

<body>
  <div class="preview-banner">Wizualizacja</div>
  <div class="top">
    <div>
      ${data.companyLogoUrl ? `<img src="${esc(data.companyLogoUrl)}" alt="Logo" class="logo" />` : ''}
    </div>
    <div class="meta">
      <div><span class="meta-label">Miejsce wystawienia:</span> <strong>${esc(data.issuePlace)}</strong></div>
      <div><span class="meta-label">Data wystawienia:</span> <strong>${esc(formatDate(data.issueDate))}</strong></div>
      <div><span class="meta-label">Data sprzedaży:</span> <strong>${esc(formatDate(data.saleDate))}</strong></div>
    </div>
  </div>

  <div class="parties">
    <div class="party party-left">
      <div class="section-label">Sprzedawca</div>
      <div class="strong">${esc(data.sellerName)}</div>
      <div>NIP: ${esc(data.sellerNip)}</div>
      <div>${esc(data.sellerStreet)}</div>
      <div>${esc(data.sellerPostalCode)} ${esc(data.sellerCity)}</div>
    </div>
    <div class="party party-right">
      <div class="section-label">Nabywca</div>
      <div class="strong">${esc(data.buyerName)}</div>
      ${data.buyerNip ? `<div>NIP: ${esc(data.buyerNip)}</div>` : ''}
      <div>${esc(data.buyerStreet)}</div>
      <div>${esc(data.buyerPostalCode)} ${esc(data.buyerCity)}</div>
    </div>
  </div>

  <div class="title">
  ${esc(getTypeLabel(data.invoiceType, data.invoiceNumber))} ${esc(data.invoiceNumber)}
  </div>

  <table>
    <thead>
      <tr>
        <th style="width: 2%">Lp.</th>
        <th style="width: 38%">Nazwa towaru lub usługi</th>
        <th style="width: 3%">Jm.</th>
        <th style="width: 3%">Ilość</th>
        <th style="width: 10%">Cena netto</th>
        <th style="width: 12%">Wartość netto</th>
        <th style="width: 5%">VAT</th>
        <th style="width: 9%">Kwota VAT</th>
        <th style="width: 9%">Brutto</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
      <tr>
        <td colspan="5" class="right strong">Razem</td>
        <td class="right strong">${formatMoney(data.totalNet)}</td>
        <td></td>
        <td class="right strong">${formatMoney(data.totalVat)}</td>
        <td class="right strong">${formatMoney(data.totalGross)}</td>
      </tr>
    </tbody>
  </table>
    </table>

  ${settledInvoicesHtml}
  ${finalSettlementHtml}

<div class="summary">
  <div class="summary-left">
    <div>
      <span class="meta-label">Sposób płatności:</span> ${esc(data.paymentMethod)}
    </div>

    ${!isCash ? `
      <div>
        <span class="meta-label">Termin płatności:</span> ${esc(formatDate(data.paymentDueDate))}
      </div>
      <div>
        <span class="meta-label">Numer konta:</span>
        <span class="bank-box">${esc(data.bankAccount)}</span>
      </div>
      ${data.bankName ? `
        <div style="margin-top: 4px;">
          <span class="meta-label">Nazwa banku:</span> ${esc(data.bankName)}
        </div>
      ` : ''}
    ` : ''}
  </div>

  <div class="summary-right">
    <div>
      <span class="meta-label">${esc(label)}</span>
      <span class="amount">${formatMoney(amountToPay)} PLN</span>
    </div>
  </div>
</div>

  <div class="footer-note">
    ${esc(data.footerNote)}
  </div>

  <div class="signature">
    <div class="signature-container">
      <div class="signature-employee">${esc(data.signatureName)}</div>
      <div class="signature-line">
        <div class="signature-role">Podpis osoby upoważnionej do wystawienia</div>
      </div>
    </div>
  </div>


  <div class="footer-website">${esc(data.website)}</div>
</body>
</html>`;
};