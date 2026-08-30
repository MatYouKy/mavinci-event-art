import type { InvoiceItem } from '@/app/(crm)/crm/invoices/[id]/page';

export interface SettledInvoicePdfRef {
  id?: string;
  invoiceNumber: string;
  invoiceType: string;
  issueDate?: string;
  totalNet: number;
  totalVat: number;
  totalGross: number;
}

export interface InvoicePdfData {
  paymentStatus?: 'unpaid' | 'partially_paid' | 'paid' | 'overdue' | 'refund_due' | 'partially_refunded' | 'refunded' | null;
  paidAmount?: number | null;
  paidAt?: string | null;

  buyerIsPrivatePerson: boolean;
  footerNote: string;
  signatureName: string;
  website?: string | null;
  showPreviewWatermark?: boolean;
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
  currencyCode?: string;
  companyLogoUrl?: string | null;
  isProforma: boolean;
  correctionReason?: string;
  correctedInvoiceNumber?: string;
  correctedInvoiceIssueDate?: string;
  items: Array<{
    positionNumber: number;
    name: string;
    unit: string;
    quantity: number;
    priceNet: number;
    vatRate: number;
    vatCode?: '23' | '8' | '5' | '0' | '0 KR' | '0 WDT' | '0 EX' | 'zw' | 'np' | 'np I' | 'np II' | 'oo';
    vatExemptionReason?: string | null;
    valueNet: number;
    vatAmount: number;
    valueGross: number;
    unitPriceNet?: number;
  }>;
  invoice_items?: Array<InvoiceItem>;
  orderItems?: Array<{
    positionNumber: number;
    name: string;
    unit: string;
    quantity: number;
    priceNet: number;
    vatRate: number;
    vatCode?: '23' | '8' | '5' | '0' | '0 KR' | '0 WDT' | '0 EX' | 'zw' | 'np' | 'np I' | 'np II' | 'oo';
    vatExemptionReason?: string | null;
    valueNet: number;
    vatAmount: number;
    valueGross: number;
  }>;
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
    unitPriceNet?: number;
  };
}

function getTypeLabel(type: string, invoiceNumber?: string) {
  if (type === 'final' || invoiceNumber?.startsWith('FKO/')) return 'Faktura końcowa';

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
  const esc = (s: unknown) =>
    String(s ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');

  const formatDate = (value?: string | null) => {
    if (!value) return '';
    return new Date(value).toLocaleDateString('pl-PL');
  };

  const money = (value?: number | null) => {
    const rounded = Number(Number(value || 0).toFixed(2));
    return Object.is(rounded, -0) ? 0 : rounded;
  };

  const formatMoney = (value?: number | null) => money(value).toFixed(2);

  const formatSignedMoney = (value?: number | null) => {
    const number = money(value);
    return `${number > 0 ? '+' : ''}${number.toFixed(2)}`;
  };

  const vatLabel = (
    vatRate: number,
    vatCode?: '23' | '8' | '5' | '0' | '0 KR' | '0 WDT' | '0 EX' | 'zw' | 'np' | 'np I' | 'np II' | 'oo',
  ) => (vatCode && ['zw', 'np', 'np I', 'np II', 'oo'].includes(vatCode) ? vatCode.toUpperCase() : `${vatCode || vatRate}%`);

  const isCorrectiveInvoice = data.invoiceType === 'corrective';
  const currencyCode = data.currencyCode || 'PLN';
  const isFinalInvoice =
    data.invoiceType === 'final' || data.invoiceNumber?.startsWith('FKO/');

  const invoiceTotalToPay =
    isFinalInvoice && data.settlementSummary
      ? money(data.settlementSummary.remainingGross)
      : money(data.totalGross);

  const paymentMethod = data.paymentMethod?.toLowerCase().trim() || '';

  const isCash =
    paymentMethod === 'gotówka' ||
    paymentMethod === 'gotowka' ||
    paymentMethod === 'cash';

  const paymentStatus: 'unpaid' | 'partially_paid' | 'paid' | 'overdue' | 'refund_due' | 'partially_refunded' | 'refunded' =
    data.paymentStatus || (isCash ? 'paid' : 'unpaid');

  const isRefund = isCorrectiveInvoice && data.totalGross < 0;
  const refundAmount = Math.abs(invoiceTotalToPay);

  const paidAmount =
    paymentStatus === 'paid' || paymentStatus === 'refunded'
      ? (isRefund ? refundAmount : invoiceTotalToPay)
      : money(data.paidAmount ?? 0);

  const remainingAmount =
    paymentStatus === 'paid' || paymentStatus === 'refunded'
      ? 0
      : paymentStatus === 'partially_paid' || paymentStatus === 'partially_refunded'
        ? Math.max((isRefund ? refundAmount : invoiceTotalToPay) - paidAmount, 0)
        : isRefund
          ? refundAmount
          : invoiceTotalToPay;

  const paymentLabel = isRefund
    ? paymentStatus === 'refunded'
      ? 'Zwrócono:'
      : paymentStatus === 'partially_refunded'
        ? 'Pozostało do zwrotu:'
        : 'Do zwrotu:'
    : isCorrectiveInvoice
      ? 'Suma korekt:'
    : paymentStatus === 'paid'
      ? 'Zapłacono:'
      : paymentStatus === 'partially_paid'
        ? 'Pozostało do zapłaty:'
        : 'Do zapłaty:';

  const paymentInfoHtml =
    paymentStatus === 'paid' || paymentStatus === 'refunded'
      ? `
        <div style="margin-top: 4px; font-size: 10px; color: #666;">
          ${paymentStatus === 'refunded'
            ? (data.paidAt ? `Zwrot wykonano dnia: ${esc(formatDate(data.paidAt))}` : 'Zwrot wykonany')
            : (data.paidAt ? `Opłacono dnia: ${esc(formatDate(data.paidAt))}` : 'Faktura opłacona')}
        </div>
      `
      : paymentStatus === 'partially_paid' || paymentStatus === 'partially_refunded'
        ? `
          <div style="margin-top: 4px; font-size: 10px; color: #666;">
            ${paymentStatus === 'partially_refunded' ? 'Zwrócono' : 'Zapłacono'}: ${formatMoney(paidAmount)} ${esc(currencyCode)}${
              data.paidAt ? ` dnia ${esc(formatDate(data.paidAt))}` : ''
            }
          </div>
        `
        : '';

  const invoiceItems =
    data.items && data.items.length > 0
      ? data.items
      : data.invoice_items && data.invoice_items.length > 0
        ? data.invoice_items.map((item: InvoiceItem, idx: number) => ({
            positionNumber: item.position_number ?? idx + 1,
            name: item.name,
            unit: item.unit,
            quantity: Number(item.quantity),
            priceNet: Number(item.price_net ?? item.price_net ?? 0),
            vatRate: Number(item.vat_rate ?? 0),
            vatCode: item.vat_code,
            vatExemptionReason: item.vat_exemption_reason,
            valueNet: Number(item.value_net ?? item.total_net ?? 0),
            vatAmount: Number(item.vat_amount ?? item.total_vat ?? 0),
            valueGross: Number(item.value_gross ?? item.total_gross ?? 0),
          }))
        : [];

  const getCorrectionValues = (item: InvoiceItem) => {
    const vatRate = Number(item.vat_rate ?? 0);

    const beforeQty = Number(item.before_quantity ?? 0);
    const beforePrice = Number(item.before_price_net ?? item.price_net ?? 0);
    const beforeNet = money(item.before_value_net ?? beforeQty * beforePrice);
    const beforeVat = money(item.before_vat_amount ?? (beforeNet * vatRate) / 100);
    const beforeGross = money(item.before_value_gross ?? beforeNet + beforeVat);

    const afterQty = Number(item.after_quantity ?? item.quantity ?? 0);
    const afterPrice = Number(item.after_price_net ?? item.price_net ?? 0);
    const afterNet = money(item.after_value_net ?? afterQty * afterPrice);
    const afterVat = money(item.after_vat_amount ?? (afterNet * vatRate) / 100);
    const afterGross = money(item.after_value_gross ?? afterNet + afterVat);

    const correctionNet = money(item.value_net ?? afterNet - beforeNet);
    const correctionVat = money(item.vat_amount ?? afterVat - beforeVat);
    const correctionGross = money(item.value_gross ?? afterGross - beforeGross);

    return {
      vatRate,
      beforeQty,
      beforePrice,
      beforeNet,
      beforeVat,
      beforeGross,
      afterQty,
      afterPrice,
      afterNet,
      afterVat,
      afterGross,
      correctionNet,
      correctionVat,
      correctionGross,
    };
  };

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
                — ${formatMoney(inv.totalGross)} ${esc(currencyCode)} brutto
              </div>
            `,
          )
          .join('')}
      </div>
    `
      : '';

  const correctiveItems =
    isCorrectiveInvoice && data.invoice_items?.some((i) => i.before_quantity != null)
      ? data.invoice_items
      : null;

  const rows = invoiceItems.length
    ? invoiceItems
        .map(
          (item) => `
          <tr>
            <td>${item.positionNumber}</td>
            <td>
              ${esc(item.name)}
              ${item.vatCode === 'zw' && item.vatExemptionReason ? `<div class="item-note">Podstawa zwolnienia: ${esc(item.vatExemptionReason)}</div>` : ''}
            </td>
            <td class="center">${esc(item.unit)}</td>
            <td class="right">${item.quantity}</td>
            <td class="right">${formatMoney(item.priceNet)}</td>
            <td class="right">${formatMoney(item.valueNet)}</td>
            <td class="center">${esc(vatLabel(item.vatRate, item.vatCode))}</td>
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

  const correctiveItemsHtml = correctiveItems
    ? correctiveItems
        .map((item, idx) => {
          const correction = getCorrectionValues(item);

          return `
            <tr style="background: #f9fafb;">
              <td rowspan="2" style="vertical-align: middle;">${idx + 1}</td>
              <td rowspan="2" style="vertical-align: middle;">${esc(item.name)}</td>
              <td style="font-size: 9px; color: #666;">Przed korektą</td>
              <td class="center">${esc(item.unit)}</td>
              <td class="right">${correction.beforeQty}</td>
              <td class="right">${formatMoney(correction.beforePrice)}</td>
              <td class="right">${formatMoney(correction.beforeNet)}</td>
              <td class="center">${esc(vatLabel(correction.vatRate, item.vat_code))}</td>
              <td class="right">${formatMoney(correction.beforeVat)}</td>
              <td class="right">${formatMoney(correction.beforeGross)}</td>
            </tr>

            <tr>
              <td style="font-size: 9px; color: #666;">Po korekcie</td>
              <td class="center">${esc(item.unit)}</td>
              <td class="right">${correction.afterQty}</td>
              <td class="right">${formatMoney(correction.afterPrice)}</td>
              <td class="right">${formatMoney(correction.afterNet)}</td>
              <td class="center">${esc(vatLabel(correction.vatRate, item.vat_code))}</td>
              <td class="right">${formatMoney(correction.afterVat)}</td>
              <td class="right strong">${formatMoney(correction.afterGross)}</td>
            </tr>
          `;
        })
        .join('')
    : '';

  const orderItemsHtml =
    data.invoiceType === 'advance' && data.orderItems?.length
      ? `
        <div class="order-section">
          <div class="settlement-title">Pełna wartość zamówienia</div>
          <table>
            <thead>
              <tr>
                <th style="width: 4%">Lp.</th>
                <th style="width: 38%">Nazwa towaru lub usługi</th>
                <th style="width: 7%">Jm.</th>
                <th style="width: 8%">Ilość</th>
                <th style="width: 12%">Cena netto</th>
                <th style="width: 12%">Netto</th>
                <th style="width: 7%">VAT</th>
                <th style="width: 12%">Brutto</th>
              </tr>
            </thead>
            <tbody>
              ${data.orderItems
                .map(
                  (item) => `
                    <tr>
                      <td>${item.positionNumber}</td>
                      <td>
                        ${esc(item.name)}
                        ${item.vatCode === 'zw' && item.vatExemptionReason ? `<div class="item-note">Podstawa zwolnienia: ${esc(item.vatExemptionReason)}</div>` : ''}
                      </td>
                      <td class="center">${esc(item.unit)}</td>
                      <td class="right">${item.quantity}</td>
                      <td class="right">${formatMoney(item.priceNet)}</td>
                      <td class="right">${formatMoney(item.valueNet)}</td>
                      <td class="center">${esc(vatLabel(item.vatRate, item.vatCode))}</td>
                      <td class="right strong">${formatMoney(item.valueGross)}</td>
                    </tr>`,
                )
                .join('')}
              <tr>
                <td colspan="5" class="right strong">Wartość zamówienia</td>
                <td class="right strong">${formatMoney(data.orderItems.reduce((sum, item) => sum + item.valueNet, 0))}</td>
                <td></td>
                <td class="right strong">${formatMoney(data.orderItems.reduce((sum, item) => sum + item.valueGross, 0))} ${esc(currencyCode)}</td>
              </tr>
            </tbody>
          </table>
        </div>`
      : '';

  return `<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8" />
  <title>${esc(getTypeLabel(data.invoiceType, data.invoiceNumber))} ${esc(data.invoiceNumber)}</title>
  <style>
    @page {
      size: A4;
      margin: 10mm 10mm 17mm;
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
      margin: 0;
      width: auto;
      box-sizing: border-box;
      display: block;
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
      width: 100%;
      table-layout: fixed;
    }

    thead {
      display: table-header-group;
    }

    tr,
    .summary,
    .settlement-box,
    .advance-list,
    .order-section,
    .closing-section,
    .ksef-verification {
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .item-note {
      margin-top: 2px;
      color: #555;
      font-size: 9px;
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
      background: #6b7280;
      color: #ffffff;
      text-align: center;
      letter-spacing: 6px;
      font-size: 12px;
      font-weight: 700;
      padding: 6px 0;
      margin: 0 0 16px;
      width: 100%;
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
      margin: 32px 5% 0;
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

    .order-section {
      margin-top: 18px;
    }

    .ksef-verification {
      margin-top: 18px;
      padding-top: 10px;
      border-top: 1px solid #d1d5db;
      text-align: right;
    }

    .ksef-verification img {
      display: inline-block;
      width: 112px;
      height: 112px;
    }

    .ksef-label {
      margin-top: 3px;
      font-size: 8px;
      line-height: 1.25;
      overflow-wrap: anywhere;
    }
  </style>
</head>

<body>
${data.showPreviewWatermark
  ? `<div class="preview-banner">Wizualizacja</div>`
  : ''}

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

  ${
    isCorrectiveInvoice && data.correctedInvoiceNumber
      ? `
    <div style="margin-bottom: 14px; font-size: 11px; border: 1px solid #d1d5db; padding: 8px 12px; background: #f9fafb;">
      <span style="color: #666;">Korekta do faktury:</span>
      <strong>${esc(data.correctedInvoiceNumber)}</strong>
      ${data.correctedInvoiceIssueDate ? ` z dnia <strong>${esc(formatDate(data.correctedInvoiceIssueDate))}</strong>` : ''}
      ${data.correctionReason ? `<br/><span style="color: #666;">Przyczyna korekty:</span> ${esc(data.correctionReason)}` : ''}
    </div>
  `
      : ''
  }

  ${
    correctiveItems
      ? `
    <table>
      <thead>
        <tr>
          <th style="width: 2%">Lp.</th>
          <th style="width: 28%">Nazwa towaru lub usługi</th>
          <th style="width: 5%; font-size: 9px;"></th>
          <th style="width: 3%">Jm.</th>
          <th style="width: 5%">Ilość</th>
          <th style="width: 10%">Cena netto</th>
          <th style="width: 12%">Wartość netto</th>
          <th style="width: 5%">VAT</th>
          <th style="width: 9%">Kwota VAT</th>
          <th style="width: 11%">Brutto</th>
        </tr>
      </thead>
      <tbody>
        ${correctiveItemsHtml}
      </tbody>
    </table>

    ${(() => {
      const totals = correctiveItems.reduce(
        (sum, item) => {
          const c = getCorrectionValues(item);

          return {
            beforeNet: sum.beforeNet + c.beforeNet,
            beforeVat: sum.beforeVat + c.beforeVat,
            beforeGross: sum.beforeGross + c.beforeGross,
            correctionNet: sum.correctionNet + c.correctionNet,
            correctionVat: sum.correctionVat + c.correctionVat,
            correctionGross: sum.correctionGross + c.correctionGross,
          };
        },
        {
          beforeNet: 0,
          beforeVat: 0,
          beforeGross: 0,
          correctionNet: 0,
          correctionVat: 0,
          correctionGross: 0,
        },
      );

      return `
        <table style="margin-left: auto; margin-top: 8px; width: auto; font-size: 11px;">
          <tbody>
            <tr>
              <td class="right strong" style="padding: 4px 10px;">Przed korektą:</td>
              <td class="right" style="padding: 4px 10px;">${formatMoney(totals.beforeNet)}</td>
              <td class="right" style="padding: 4px 10px;">${formatMoney(totals.beforeVat)}</td>
              <td class="right" style="padding: 4px 10px;">${formatMoney(totals.beforeGross)}</td>
            </tr>
            <tr>
              <td class="right strong" style="padding: 4px 10px;">Suma korekt:</td>
              <td class="right" style="padding: 4px 10px;">${formatSignedMoney(totals.correctionNet)}</td>
              <td class="right" style="padding: 4px 10px;">${formatSignedMoney(totals.correctionVat)}</td>
              <td class="right" style="padding: 4px 10px;">${formatSignedMoney(totals.correctionGross)}</td>
            </tr>
            <tr style="font-weight: 700;">
              <td class="right strong" style="padding: 4px 10px;">Po korekcie:</td>
              <td class="right" style="padding: 4px 10px;">${formatMoney(totals.beforeNet + totals.correctionNet)}</td>
              <td class="right" style="padding: 4px 10px;">${formatMoney(totals.beforeVat + totals.correctionVat)}</td>
              <td class="right" style="padding: 4px 10px;">${formatMoney(totals.beforeGross + totals.correctionGross)}</td>
            </tr>
          </tbody>
        </table>
      `;
    })()}
  `
      : `
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
  `
  }

  ${orderItemsHtml}
  ${settledInvoicesHtml}
  ${finalSettlementHtml}

  <div class="closing-section">
  <div class="summary">
<div class="summary-left">
  <div>
    <span class="meta-label">Sposób płatności:</span> ${esc(data.paymentMethod)}
  </div>

<div style="margin-top: 4px;">
  <span class="meta-label">Status płatności:</span>

  ${
    paymentStatus === 'paid' || paymentStatus === 'refunded'
      ? `
        ${paymentStatus === 'refunded' ? 'Zwrot wykonany' : 'Zapłacono'}
        ${
          data.paidAt
            ? `<div style="margin-top: 2px;">
                <span class="meta-label">Data opłacenia:</span>
                ${esc(formatDate(data.paidAt))}
              </div>`
            : ''
        }
      `
      : paymentStatus === 'partially_paid'
        ? `Częściowo opłacono`
        : paymentStatus === 'partially_refunded'
          ? 'Częściowo zwrócono'
          : paymentStatus === 'refund_due'
            ? 'Do zwrotu'
            : 'Do zapłaty'
  }
</div>

  ${
    paymentStatus === 'partially_paid' || paymentStatus === 'partially_refunded'
      ? `
        <div style="margin-top: 4px;">
          <span class="meta-label">${paymentStatus === 'partially_refunded' ? 'Zwrócono:' : 'Wpłacono:'}</span>
          ${formatMoney(paidAmount)} ${esc(currencyCode)}
        </div>
      `
      : ''
  }

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
        <span class="meta-label">${esc(paymentLabel)}</span>
        <span class="amount">
        ${
          paymentStatus === 'paid' || paymentStatus === 'refunded'
            ? formatMoney(paidAmount)
            : isCorrectiveInvoice
              ? (isRefund ? formatMoney(remainingAmount) : formatSignedMoney(remainingAmount))
              : formatMoney(remainingAmount)
        } ${esc(currencyCode)}
        </span>
        ${paymentInfoHtml}
      </div>
    </div>
  </div>

  <div class="footer-note">
    ${data.footerNote ? `<span style="white-space: pre-wrap; font-weight: 700;">Uwagi:</span> ${esc(data.footerNote)}` : ''}
  </div>

  <div class="signature">
    <div class="signature-container">
      <div class="signature-employee">${esc(data.signatureName)}</div>
      <div class="signature-line">
        <div class="signature-role">Podpis osoby upoważnionej do wystawienia</div>
      </div>
    </div>
  </div>

  <div id="ksef-verification-placeholder"></div>
  </div>
</body>
</html>`;
};
