import type { InvoiceItem } from '@/app/(crm)/crm/invoices/[id]/page';
import type { FA3Recipient } from '@/lib/ksef/generateFA3XML';
import { getPaymentAwareInvoiceFooterNote } from '@/lib/invoices/paymentAwareFooterNote';
import { getInvoicePartyDataCorrection, type InvoicePartyDataBefore } from '@/lib/invoices/partyDataCorrection';
import { amountInWordsPl } from '@/lib/invoices/print/amountInWords';

/** Zmiana wersji = nowy podgląd wydruku u wszystkich (pamięć podręczna podglądu). */
export const INVOICE_PRINT_TEMPLATE_VERSION = '2026-11-05.1';

export interface SettledInvoicePdfRef {
  id?: string;
  invoiceNumber: string;
  invoiceType: string;
  issueDate?: string;
  totalNet: number;
  totalVat: number;
  totalGross: number;
}

type VatCode = '23' | '8' | '5' | '0' | '0 KR' | '0 WDT' | '0 EX' | 'zw' | 'np' | 'np I' | 'np II' | 'oo';

export interface InvoicePdfData {
  paymentStatus?: 'unpaid' | 'partially_paid' | 'paid' | 'overdue' | 'refund_due' | 'partially_refunded' | 'refunded' | 'not_applicable' | null;
  paidAmount?: number | null;
  paidAt?: string | null;

  buyerIsPrivatePerson: boolean;
  footerNote: string;
  signatureName: string;
  website?: string | null;
  /** Kept for callers; every rendered invoice is labelled as a visualization. */
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
  bankSwift?: string;
  sellerName: string;
  sellerNip: string;
  sellerStreet: string;
  sellerCity: string;
  sellerPostalCode: string;
  sellerCountryCode?: string;
  sellerEmail?: string;
  sellerPhone?: string;
  buyerName: string;
  buyerNip?: string;
  buyerStreet: string;
  buyerCity: string;
  buyerPostalCode: string;
  buyerCountryCode?: string;
  /** Recipient captured on this invoice, never read from the current contact record. */
  recipient?: FA3Recipient;
  totalNet: number;
  totalVat: number;
  totalGross: number;
  currencyCode?: string;
  companyLogoUrl?: string | null;
  isProforma: boolean;
  /** Numer KSeF przyjętej faktury (pokazywany w nagłówku wydruku). */
  ksefNumber?: string;
  /** Faktura wysłana do KSeF, czeka na numer. */
  ksefPending?: boolean;
  correctionReason?: string;
  correctionKind?: string | null;
  correctionPartyDataBefore?: InvoicePartyDataBefore | null;
  correctedInvoiceNumber?: string;
  correctedInvoiceIssueDate?: string;
  correctedInvoiceKsefNumber?: string;
  items: Array<{
    positionNumber: number;
    name: string;
    unit: string;
    quantity: number;
    priceNet: number;
    vatRate: number;
    vatCode?: VatCode;
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
    vatCode?: VatCode;
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

export function getInvoicePrintTypeLabel(type: string, invoiceNumber?: string) {
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

const COUNTRY_NAMES: Record<string, string> = {
  PL: 'Polska', DE: 'Niemcy', CZ: 'Czechy', SK: 'Słowacja', LT: 'Litwa', GB: 'Wielka Brytania', FR: 'Francja',
  NL: 'Holandia', AT: 'Austria', IT: 'Włochy', ES: 'Hiszpania', US: 'Stany Zjednoczone', UA: 'Ukraina',
};

export const buildInvoicePdfHtml = (data: InvoicePdfData) => {
  const esc = (s: unknown) =>
    String(s ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');

  /** Daty z bazy (YYYY-MM-DD) bez przesunięcia strefy czasowej: 04.11.2026. */
  const formatDate = (value?: string | null) => {
    if (!value) return '';
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
    if (match) return `${match[3]}.${match[2]}.${match[1]}`;
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? String(value)
      : date.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  const money = (value?: number | null) => {
    const rounded = Number(Number(value || 0).toFixed(2));
    return Object.is(rounded, -0) ? 0 : rounded;
  };

  /** 12 840,00 — separator tysięcy zawsze (także 8 500,00), przecinek dziesiętny. */
  const formatMoney = (value?: number | null) => {
    const number = money(value);
    const [whole, fraction] = Math.abs(number).toFixed(2).split('.');
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return `${number < 0 ? '−' : ''}${grouped},${fraction}`;
  };

  const formatSignedMoney = (value?: number | null) => {
    const number = money(value);
    return `${number > 0 ? '+' : ''}${formatMoney(number)}`;
  };

  const formatQuantity = (value?: number | null) => {
    const number = Number(value || 0);
    const text = Number.isInteger(number) ? String(number) : String(Number(number.toFixed(4)));
    const [whole, fraction] = text.replace('-', '').split('.');
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return `${number < 0 ? '−' : ''}${grouped}${fraction ? `,${fraction}` : ''}`;
  };

  const vatLabel = (vatRate: number, vatCode?: VatCode) =>
    vatCode && ['zw', 'np', 'np I', 'np II', 'oo'].includes(vatCode) ? vatCode.toUpperCase() : `${vatCode || vatRate}%`;

  const formatAccount = (value?: string | null) => {
    const raw = String(value || '').trim();
    const compact = raw.replace(/\s+/g, '');
    if (/^(PL)?\d{26}$/i.test(compact)) {
      const prefix = compact.length === 28 ? `${compact.slice(0, 2).toUpperCase()} ` : '';
      const digits = compact.length === 28 ? compact.slice(2) : compact;
      return `${prefix}${digits.slice(0, 2)} ${digits.slice(2).replace(/(\d{4})(?=\d)/g, '$1 ')}`;
    }
    return raw;
  };

  const isCorrectiveInvoice = data.invoiceType === 'corrective';
  const partyDataBefore = getInvoicePartyDataCorrection({
    invoice_type: data.invoiceType, correction_kind: data.correctionKind,
    correction_party_data_before: data.correctionPartyDataBefore,
  });
  const isPartyDataCorrection = partyDataBefore !== null;
  if (isPartyDataCorrection && (
    [data.totalNet, data.totalVat, data.totalGross, data.paidAmount ?? 0].some((amount) => Number(amount) !== 0)
    || data.items.length || data.invoice_items?.length || data.orderItems?.length || data.settledInvoices?.length
  )) throw new Error('Korekta danych stron nie może zawierać zmiany kwot, pozycji ani rozliczenia płatności.');
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

  const paymentStatus: NonNullable<InvoicePdfData['paymentStatus']> =
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

  const footerNote = getPaymentAwareInvoiceFooterNote(data.footerNote, {
    paymentStatus,
    amountDue: invoiceTotalToPay,
    paidAmount,
    isRefund,
  });

  const isSettled = paymentStatus === 'paid' || paymentStatus === 'refunded';

  const paymentLabel = isRefund
    ? paymentStatus === 'refunded'
      ? 'Zwrócono'
      : paymentStatus === 'partially_refunded'
        ? 'Pozostało do zwrotu'
        : 'Do zwrotu'
    : isCorrectiveInvoice && money(data.totalGross) === 0
      ? 'Suma korekt'
    : paymentStatus === 'paid'
      ? 'Zapłacono'
      : paymentStatus === 'partially_paid'
        ? isCorrectiveInvoice ? 'Pozostało do dopłaty' : 'Pozostało do zapłaty'
        : isCorrectiveInvoice ? 'Do dopłaty' : 'Do zapłaty';

  const displayedAmount = isSettled ? paidAmount : remainingAmount;
  const displayedAmountText = isSettled
    ? formatMoney(paidAmount)
    : formatMoney(remainingAmount);

  const paymentStatusText = isSettled
    ? paymentStatus === 'refunded'
      ? 'Zwrot wykonany'
      : isCash ? 'Zapłacono gotówką' : 'Zapłacono'
    : paymentStatus === 'partially_paid'
      ? 'Częściowo opłacono'
      : paymentStatus === 'partially_refunded'
        ? 'Częściowo zwrócono'
        : paymentStatus === 'refund_due' || isRefund
          ? 'Do zwrotu'
          : paymentStatus === 'overdue'
            ? 'Po terminie płatności'
            : 'Do zapłaty';

  const paymentDetailText = isSettled
    ? paymentStatus === 'refunded'
      ? (data.paidAt ? `Zwrot wykonano dnia ${formatDate(data.paidAt)}` : 'Zwrot wykonany')
      : (data.paidAt ? `Opłacono dnia ${formatDate(data.paidAt)}` : 'Faktura opłacona')
    : paymentStatus === 'partially_paid' || paymentStatus === 'partially_refunded'
      ? `${paymentStatus === 'partially_refunded' ? 'Zwrócono' : 'Wpłacono'} ${formatMoney(paidAmount)} ${currencyCode}${
          data.paidAt ? ` dnia ${formatDate(data.paidAt)}` : ''
        }`
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

  const correctiveItems =
    isCorrectiveInvoice && data.invoice_items?.some((i) => i.before_quantity != null)
      ? data.invoice_items
      : null;

  /** Zestawienie według stawek VAT (art. 106e ust. 1 pkt 13–14): netto, VAT i brutto dla każdej stawki. */
  type RateRow = { label: string; order: number; net: number; vat: number; gross: number };
  const rateOrder = (label: string) => {
    const percent = Number.parseFloat(label);
    if (Number.isFinite(percent)) return 100 - percent;
    return 200 + ['ZW', 'NP', 'NP I', 'NP II', 'OO'].indexOf(label);
  };
  const summarizeRates = (rows: Array<{ label: string; net: number; vat: number; gross: number }>) => {
    const map = new Map<string, RateRow>();
    for (const row of rows) {
      const entry = map.get(row.label) ?? { label: row.label, order: rateOrder(row.label), net: 0, vat: 0, gross: 0 };
      entry.net += row.net;
      entry.vat += row.vat;
      entry.gross += row.gross;
      map.set(row.label, entry);
    }
    return [...map.values()].sort((a, b) => a.order - b.order);
  };

  const rateRows = correctiveItems
    ? summarizeRates(correctiveItems.map((item) => {
        const c = getCorrectionValues(item);
        return { label: vatLabel(c.vatRate, item.vat_code), net: c.correctionNet, vat: c.correctionVat, gross: c.correctionGross };
      }))
    : summarizeRates(invoiceItems.map((item) => ({
        label: vatLabel(item.vatRate, item.vatCode),
        net: Number(item.valueNet || 0),
        vat: Number(item.vatAmount || 0),
        gross: Number(item.valueGross || 0),
      })));

  const exemptionReasons = [...new Set(
    [...invoiceItems, ...(data.orderItems ?? [])]
      .filter((item) => item.vatCode === 'zw' && item.vatExemptionReason)
      .map((item) => String(item.vatExemptionReason)),
  )];

  const typeLabel = isPartyDataCorrection ? 'Faktura korygująca dane' : getInvoicePrintTypeLabel(data.invoiceType, data.invoiceNumber);
  // Faktura przyjęta w KSeF: wystarczy numer KSeF i kod QR (blok przy podpisie, stopka) — bez dodatkowego opisu.
  // Przed przyjęciem: krótki wpis, że to wizualizacja i faktura wymaga wysłania do KSeF. Pro forma nie jest fakturą VAT.
  const visualizationNoticeHtml = data.isProforma
    ? `<div class="doc-notice keep"><strong>Pro forma — to nie jest faktura VAT.</strong> Dokument informacyjny: nie jest wysyłany do KSeF i nie stanowi podstawy do odliczenia podatku VAT.</div>`
    : data.ksefNumber
      ? ''
      : data.ksefPending
        ? `<div class="doc-notice keep"><strong>Wizualizacja faktury</strong> — wysłana do KSeF, czeka na nadanie numeru KSeF.</div>`
        : `<div class="doc-notice keep"><strong>Wizualizacja faktury</strong> — wymaga wysłania do KSeF.</div>`;
  const signed = correctiveItems ? formatSignedMoney : formatMoney;

  const partyLines = (party: {
    name?: string | null; nip?: string | null; street?: string | null; postalCode?: string | null; city?: string | null;
    countryCode?: string | null; email?: string | null; phone?: string | null; extra?: string;
  }) => `
    <div class="party-name">${esc(party.name)}</div>
    ${party.street ? `<div>${esc(party.street)}</div>` : ''}
    ${party.postalCode || party.city ? `<div>${esc([party.postalCode, party.city].filter(Boolean).join(' '))}</div>` : ''}
    ${party.countryCode && party.countryCode !== 'PL' ? `<div>${esc(COUNTRY_NAMES[party.countryCode] || party.countryCode)}</div>` : ''}
    ${party.nip ? `<div class="party-id"><span>NIP</span> ${esc(party.nip)}</div>` : ''}
    ${party.email || party.phone ? `<div class="party-contact">${[party.email, party.phone].filter(Boolean).map(esc).join(' · ')}</div>` : ''}
    ${party.extra || ''}
  `;

  const rows = invoiceItems.length
    ? invoiceItems
        .map(
          (item) => `
          <tr>
            <td class="num muted">${item.positionNumber}</td>
            <td class="name">
              ${esc(item.name)}
              ${item.vatCode === 'zw' && item.vatExemptionReason ? `<div class="item-note">Podstawa zwolnienia: ${esc(item.vatExemptionReason)}</div>` : ''}
            </td>
            <td class="num">${formatQuantity(item.quantity)}</td>
            <td class="center muted">${esc(item.unit)}</td>
            <td class="num">${formatMoney(item.priceNet)}</td>
            <td class="num">${formatMoney(item.valueNet)}</td>
            <td class="center">${esc(vatLabel(item.vatRate, item.vatCode))}</td>
            <td class="num">${formatMoney(item.vatAmount)}</td>
            <td class="num strong">${formatMoney(item.valueGross)}</td>
          </tr>
        `,
        )
        .join('')
    : `
      <tr>
        <td colspan="9" class="center muted">Brak pozycji</td>
      </tr>
    `;

  const standardItemsHtml = `
    <table class="items">
      <colgroup>
        <col style="width: 4%" />
        <col style="width: 33%" />
        <col style="width: 6.5%" />
        <col style="width: 5.5%" />
        <col style="width: 11%" />
        <col style="width: 11.5%" />
        <col style="width: 6%" />
        <col style="width: 10%" />
        <col style="width: 12.5%" />
      </colgroup>
      <thead>
        <tr>
          <th class="num">Lp.</th>
          <th>Nazwa towaru lub usługi</th>
          <th class="num">Ilość</th>
          <th class="center">J.m.</th>
          <th class="num">Cena netto</th>
          <th class="num">Wartość netto</th>
          <th class="center">VAT</th>
          <th class="num">Kwota VAT</th>
          <th class="num">Wartość brutto</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;

  const correctiveItemsHtml = correctiveItems
    ? `
    <table class="items corrective">
      <colgroup>
        <col style="width: 4%" />
        <col style="width: 21%" />
        <col style="width: 12%" />
        <col style="width: 6%" />
        <col style="width: 7%" />
        <col style="width: 10%" />
        <col style="width: 11%" />
        <col style="width: 6%" />
        <col style="width: 10%" />
        <col style="width: 13%" />
      </colgroup>
      <thead>
        <tr>
          <th class="num">Lp.</th>
          <th>Nazwa towaru lub usługi</th>
          <th></th>
          <th class="num">Ilość</th>
          <th class="center">J.m.</th>
          <th class="num">Cena netto</th>
          <th class="num">Wartość netto</th>
          <th class="center">VAT</th>
          <th class="num">Kwota VAT</th>
          <th class="num">Wartość brutto</th>
        </tr>
      </thead>
      ${correctiveItems
        .map((item, idx) => {
          const c = getCorrectionValues(item);
          return `
          <tbody class="correction-group">
            <tr class="before">
              <td rowspan="3" class="num muted">${idx + 1}</td>
              <td rowspan="3" class="name">${esc(item.name)}</td>
              <td class="row-tag">Przed korektą</td>
              <td class="num">${formatQuantity(c.beforeQty)}</td>
              <td class="center muted">${esc(item.unit)}</td>
              <td class="num">${formatMoney(c.beforePrice)}</td>
              <td class="num">${formatMoney(c.beforeNet)}</td>
              <td class="center">${esc(vatLabel(c.vatRate, item.vat_code))}</td>
              <td class="num">${formatMoney(c.beforeVat)}</td>
              <td class="num">${formatMoney(c.beforeGross)}</td>
            </tr>
            <tr class="after">
              <td class="row-tag">Po korekcie</td>
              <td class="num">${formatQuantity(c.afterQty)}</td>
              <td class="center muted">${esc(item.unit)}</td>
              <td class="num">${formatMoney(c.afterPrice)}</td>
              <td class="num">${formatMoney(c.afterNet)}</td>
              <td class="center">${esc(vatLabel(c.vatRate, item.vat_code))}</td>
              <td class="num">${formatMoney(c.afterVat)}</td>
              <td class="num">${formatMoney(c.afterGross)}</td>
            </tr>
            <tr class="difference">
              <td class="row-tag strong">Różnica</td>
              <td colspan="3"></td>
              <td class="num strong">${formatSignedMoney(c.correctionNet)}</td>
              <td></td>
              <td class="num strong">${formatSignedMoney(c.correctionVat)}</td>
              <td class="num strong">${formatSignedMoney(c.correctionGross)}</td>
            </tr>
          </tbody>`;
        })
        .join('')}
    </table>`
    : '';

  const correctionTotalsHtml = correctiveItems
    ? (() => {
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
          { beforeNet: 0, beforeVat: 0, beforeGross: 0, correctionNet: 0, correctionVat: 0, correctionGross: 0 },
        );
        return `
        <table class="totals-table">
          <colgroup><col style="width: 31%" /><col style="width: 23%" /><col style="width: 21%" /><col style="width: 25%" /></colgroup>
          <thead>
            <tr><th>Korekta</th><th class="num">Netto</th><th class="num">VAT</th><th class="num">Brutto</th></tr>
          </thead>
          <tbody>
            <tr><td>Przed korektą</td><td class="num">${formatMoney(totals.beforeNet)}</td><td class="num">${formatMoney(totals.beforeVat)}</td><td class="num">${formatMoney(totals.beforeGross)}</td></tr>
            <tr><td>Po korekcie</td><td class="num">${formatMoney(totals.beforeNet + totals.correctionNet)}</td><td class="num">${formatMoney(totals.beforeVat + totals.correctionVat)}</td><td class="num">${formatMoney(totals.beforeGross + totals.correctionGross)}</td></tr>
            <tr class="total"><td>Różnica</td><td class="num">${formatSignedMoney(totals.correctionNet)}</td><td class="num">${formatSignedMoney(totals.correctionVat)}</td><td class="num">${formatSignedMoney(totals.correctionGross)}</td></tr>
          </tbody>
        </table>`;
      })()
    : '';

  const vatSummaryHtml = `
    <table class="totals-table">
      <colgroup><col style="width: 31%" /><col style="width: 23%" /><col style="width: 21%" /><col style="width: 25%" /></colgroup>
      <thead>
        <tr>
          <th>Stawka VAT</th>
          <th class="num">Netto</th>
          <th class="num">VAT</th>
          <th class="num">Brutto</th>
        </tr>
      </thead>
      <tbody>
        ${rateRows
          .map((row) => `<tr><td>${esc(row.label)}</td><td class="num">${signed(row.net)}</td><td class="num">${signed(row.vat)}</td><td class="num">${signed(row.gross)}</td></tr>`)
          .join('')}
        <tr class="total">
          <td>Razem</td>
          <td class="num">${signed(data.totalNet)}</td>
          <td class="num">${signed(data.totalVat)}</td>
          <td class="num">${signed(data.totalGross)}</td>
        </tr>
      </tbody>
    </table>`;

  const settlementTableHtml =
    isFinalInvoice && data.settlementSummary
      ? (() => {
          const summary = data.settlementSummary;
          const advances = data.settledInvoices ?? [];
          return `
        <table class="totals-table">
          <colgroup><col style="width: 40%" /><col style="width: 20%" /><col style="width: 18%" /><col style="width: 22%" /></colgroup>
          <thead>
            <tr><th>Rozliczenie zaliczek</th><th class="num">Netto</th><th class="num">VAT</th><th class="num">Brutto</th></tr>
          </thead>
          <tbody>
            <tr><td>Wartość faktury końcowej</td><td class="num">${formatMoney(summary.invoiceTotalNet)}</td><td class="num">${formatMoney(summary.invoiceTotalVat)}</td><td class="num">${formatMoney(summary.invoiceTotalGross)}</td></tr>
            ${advances
              .map(
                (inv) => `<tr class="advance"><td>Zaliczka ${esc(inv.invoiceNumber)}${inv.issueDate ? `<div class="item-note">z dnia ${esc(formatDate(inv.issueDate))}</div>` : ''}</td><td class="num">${formatMoney(-inv.totalNet)}</td><td class="num">${formatMoney(-inv.totalVat)}</td><td class="num">${formatMoney(-inv.totalGross)}</td></tr>`,
              )
              .join('')}
            ${advances.length !== 1 ? `<tr><td>Rozliczone zaliczki${advances.length ? ' razem' : ''}</td><td class="num">${formatMoney(-summary.settledNet)}</td><td class="num">${formatMoney(-summary.settledVat)}</td><td class="num">${formatMoney(-summary.settledGross)}</td></tr>` : ''}
            <tr class="total"><td>Pozostało do zapłaty</td><td class="num">${formatMoney(summary.remainingNet)}</td><td class="num">${formatMoney(summary.remainingVat)}</td><td class="num">${formatMoney(summary.remainingGross)}</td></tr>
          </tbody>
        </table>`;
        })()
      : '';

  // Faktura końcowa bez zapisanego podsumowania: sama lista rozliczanych zaliczek.
  const finalSettlementHtml =
    isFinalInvoice && !data.settlementSummary && data.settledInvoices?.length
      ? `
      <section class="block keep">
        <h3>Rozliczane faktury zaliczkowe</h3>
        <ul class="advance-list">
          ${data.settledInvoices
            .map(
              (inv) => `<li><span>${esc(inv.invoiceNumber)}${inv.issueDate ? ` <span class="muted">z dnia ${esc(formatDate(inv.issueDate))}</span>` : ''}</span><span class="num">${formatMoney(inv.totalGross)} ${esc(currencyCode)} brutto</span></li>`,
            )
            .join('')}
        </ul>
      </section>`
      : '';

  const partyCorrectionHtml = partyDataBefore ? (() => {
    const afterBuyer = {
      name: data.buyerName, nip: data.buyerNip, street: data.buyerStreet,
      postalCode: data.buyerPostalCode, city: data.buyerCity, countryCode: data.buyerCountryCode || 'PL',
    };
    const rowsFor = (label: string, before: Record<string, unknown> | null, after: Record<string, unknown> | null, recipient: boolean) => {
      const fields = [
        ['name', 'Nazwa'], ['nip', 'NIP'], ['street', 'Ulica i numer'], ['postalCode', 'Kod pocztowy'],
        ['city', 'Miejscowość'], ['countryCode', 'Kraj'], ...(recipient ? [['internalId', 'Numer wewnętrzny KSeF']] : []),
      ];
      return `<tr class="group"><th colspan="3">${esc(label)}</th></tr>` + fields.map(([key, title]) => {
        const value = (party: Record<string, unknown> | null) => party
          ? esc(party[key] || '-') : (key === 'name' ? 'Nie wskazano oddzielnego odbiorcy' : '-');
        const changed = value(before) !== value(after);
        return `<tr${changed ? ' class="changed"' : ''}><td class="muted">${esc(title)}</td><td>${value(before)}</td><td>${value(after)}</td></tr>`;
      }).join('');
    };
    return `<table class="items party-correction">
      <colgroup><col style="width: 22%"/><col style="width: 39%"/><col style="width: 39%"/></colgroup>
      <thead><tr><th>Pole</th><th>Przed korektą</th><th>Po korekcie</th></tr></thead>
      <tbody>
        ${rowsFor('Nabywca', { ...partyDataBefore.buyer }, afterBuyer, false)}
        ${rowsFor('Odbiorca', partyDataBefore.recipient ? { ...partyDataBefore.recipient } : null, data.recipient ? { ...data.recipient } : null, true)}
      </tbody>
    </table>
    <div class="notice keep">
      <strong>Korekta danych — bez zmiany kwot.</strong>
      <div>Zmiana netto: 0,00 ${esc(currencyCode)}; VAT: 0,00 ${esc(currencyCode)}; brutto: 0,00 ${esc(currencyCode)}.</div>
      <div>Kwoty i rozliczenie płatności faktury pierwotnej pozostają bez zmian. Ta korekta nie tworzy nowej należności ani zwrotu.</div>
    </div>`;
  })() : '';

  const orderItemsHtml =
    data.invoiceType === 'advance' && data.orderItems?.length
      ? `
        <section class="block">
          <h3>Pełna wartość zamówienia</h3>
          <table class="items compact">
            <colgroup>
              <col style="width: 5%" />
              <col style="width: 37%" />
              <col style="width: 7%" />
              <col style="width: 6%" />
              <col style="width: 12%" />
              <col style="width: 13%" />
              <col style="width: 7%" />
              <col style="width: 13%" />
            </colgroup>
            <thead>
              <tr>
                <th class="num">Lp.</th>
                <th>Nazwa towaru lub usługi</th>
                <th class="num">Ilość</th>
                <th class="center">J.m.</th>
                <th class="num">Cena netto</th>
                <th class="num">Wartość netto</th>
                <th class="center">VAT</th>
                <th class="num">Wartość brutto</th>
              </tr>
            </thead>
            <tbody>
              ${data.orderItems
                .map(
                  (item) => `
                    <tr>
                      <td class="num muted">${item.positionNumber}</td>
                      <td class="name">
                        ${esc(item.name)}
                        ${item.vatCode === 'zw' && item.vatExemptionReason ? `<div class="item-note">Podstawa zwolnienia: ${esc(item.vatExemptionReason)}</div>` : ''}
                      </td>
                      <td class="num">${formatQuantity(item.quantity)}</td>
                      <td class="center muted">${esc(item.unit)}</td>
                      <td class="num">${formatMoney(item.priceNet)}</td>
                      <td class="num">${formatMoney(item.valueNet)}</td>
                      <td class="center">${esc(vatLabel(item.vatRate, item.vatCode))}</td>
                      <td class="num strong">${formatMoney(item.valueGross)}</td>
                    </tr>`,
                )
                .join('')}
              <tr class="sum">
                <td colspan="5" class="num">Wartość zamówienia</td>
                <td class="num">${formatMoney(data.orderItems.reduce((sum, item) => sum + item.valueNet, 0))}</td>
                <td></td>
                <td class="num">${formatMoney(data.orderItems.reduce((sum, item) => sum + item.valueGross, 0))}</td>
              </tr>
            </tbody>
          </table>
        </section>`
      : '';

  const correctionReferenceHtml =
    isCorrectiveInvoice && data.correctedInvoiceNumber
      ? `
    <div class="reference keep">
      <div><span class="label">Korekta do faktury</span> <strong>${esc(data.correctedInvoiceNumber)}</strong>${data.correctedInvoiceIssueDate ? ` z dnia <strong>${esc(formatDate(data.correctedInvoiceIssueDate))}</strong>` : ''}</div>
      ${data.correctedInvoiceKsefNumber ? `<div><span class="label">Numer KSeF faktury korygowanej</span> ${esc(data.correctedInvoiceKsefNumber)}</div>` : ''}
      ${data.correctionReason ? `<div><span class="label">Przyczyna korekty</span> ${esc(data.correctionReason)}</div>` : ''}
    </div>`
      : '';

  const metaCells: Array<[string, string]> = [
    ['Data wystawienia', formatDate(data.issueDate)],
    ['Data sprzedaży', formatDate(data.saleDate)],
    ...(!isPartyDataCorrection && !isCash && data.paymentDueDate ? [['Termin płatności', formatDate(data.paymentDueDate)] as [string, string]] : []),
    ['Miejsce wystawienia', data.issuePlace],
  ];
  const visibleMetaCells = metaCells.filter(([, value]) => value);

  const paymentRows: Array<[string, string]> = [
    ['Sposób płatności', data.paymentMethod ? data.paymentMethod.charAt(0).toUpperCase() + data.paymentMethod.slice(1) : ''],
    ...(!isCash && data.paymentDueDate ? [['Termin płatności', formatDate(data.paymentDueDate)] as [string, string]] : []),
    ...(!isCash && data.bankAccount ? [['Numer konta', formatAccount(data.bankAccount)] as [string, string]] : []),
    ...(!isCash && data.bankName ? [['Bank', data.bankName] as [string, string]] : []),
    ...(!isCash && data.bankSwift ? [['SWIFT/BIC', data.bankSwift] as [string, string]] : []),
    ...(!isCash && !isSettled && !isRefund && remainingAmount > 0 ? [['Tytuł przelewu', data.invoiceNumber] as [string, string]] : []),
  ];

  const statusTone = isSettled
    ? 'paid'
    : paymentStatus === 'overdue'
      ? 'overdue'
      : paymentStatus === 'partially_paid' || paymentStatus === 'partially_refunded'
        ? 'partial'
        : 'due';

  const paymentHtml = `
    <div class="payment-card">
      <h3>Płatność</h3>
      <dl class="payment-list">
        ${paymentRows.map(([label, value]) => label === 'Numer konta'
          ? `<div class="stack"><dt>${esc(label)}</dt><dd class="account">${esc(value)}</dd></div>`
          : `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}
        <div><dt>Status</dt><dd><span class="status status-${statusTone}">${esc(paymentStatusText)}</span>${paymentDetailText ? `<div class="status-detail">${esc(paymentDetailText)}</div>` : ''}</dd></div>
      </dl>
    </div>`;

  const totalBoxHtml = `
    <div class="total-box total-${statusTone}">
      <div class="total-label">${esc(paymentLabel)}</div>
      <div class="total-amount">${displayedAmountText}<span class="total-currency">${esc(currencyCode)}</span></div>
      <div class="total-words">Słownie: ${esc(amountInWordsPl(Math.abs(displayedAmount), currencyCode))}</div>
    </div>`;

  const notesHtml = footerNote || exemptionReasons.length
    ? `
    <section class="notes keep">
      <h3>Uwagi</h3>
      ${footerNote ? `<div class="notes-text">${esc(footerNote)}</div>` : ''}
      ${exemptionReasons.length ? `<div class="notes-text">Podstawa zwolnienia z VAT: ${exemptionReasons.map(esc).join('; ')}</div>` : ''}
    </section>`
    : '';

  const summaryHtml = isPartyDataCorrection
    ? ''
    : `
  <section class="summary keep">
    <div class="summary-left">${paymentHtml}</div>
    <div class="summary-right">
      ${vatSummaryHtml}
      ${correctionTotalsHtml}
      ${settlementTableHtml}
      ${totalBoxHtml}
    </div>
  </section>`;

  return `<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8" />
  <title>${data.isProforma ? '' : 'Wizualizacja — '}${esc(typeLabel)} ${esc(data.invoiceNumber)}</title>
  <style>
    /*invoice-print-fonts*/

    @page {
      size: A4;
      margin: 12mm 12mm 16mm;
    }

    :root {
      --ink: #111827;
      --text: #1f2937;
      --muted: #6b7280;
      --faint: #9ca3af;
      --line: #e5e7eb;
      --line-strong: #d1d5db;
      --panel: #f6f7f9;
      --paid: #047857;
      --paid-bg: #ecfdf5;
      --due: #92400e;
      --due-bg: #fffbeb;
      --overdue: #b91c1c;
      --overdue-bg: #fef2f2;
    }

    *, *::before, *::after { box-sizing: border-box; }

    html, body { margin: 0; padding: 0; width: 100%; min-width: 0; }

    body {
      font-family: 'Inter', 'Helvetica Neue', Helvetica, Arial, sans-serif;
      font-size: 9pt;
      line-height: 1.45;
      color: var(--text);
      background: #fff;
      font-variant-numeric: tabular-nums;
      font-feature-settings: 'tnum' 1;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      overflow-wrap: anywhere;
    }

    h3 {
      margin: 0 0 6px;
      font-size: 7pt;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--muted);
    }

    .muted { color: var(--muted); }
    .strong { font-weight: 600; color: var(--ink); }
    .center { text-align: center; }
    .num { text-align: right; white-space: nowrap; }
    .keep { break-inside: avoid; page-break-inside: avoid; }

    .doc-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 24px;
      padding-bottom: 14px;
      border-bottom: 2px solid var(--ink);
    }
    .logo-slot { flex: 0 1 46%; min-height: 14mm; display: flex; align-items: center; }
    .logo { display: block; max-width: 62mm; max-height: 20mm; object-fit: contain; object-position: left center; }
    .doc-title { flex: 1 1 54%; text-align: right; }
    .doc-kind { font-size: 8pt; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); }
    .doc-number { margin-top: 2px; font-size: 19pt; font-weight: 700; line-height: 1.15; letter-spacing: -0.01em; color: var(--ink); }
    .doc-badges { margin-top: 6px; display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 6px; }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border: 1px solid var(--line-strong);
      border-radius: 999px;
      font-size: 6.8pt;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--muted);
      white-space: nowrap;
    }
    .badge-ksef { border-color: #a7f3d0; color: var(--paid); background: var(--paid-bg); }

    .meta {
      display: grid;
      grid-template-columns: repeat(${Math.max(visibleMetaCells.length, 1)}, minmax(0, 1fr));
      margin-top: 12px;
      background: var(--panel);
      border-radius: 6px;
      overflow: hidden;
    }
    .meta > div { padding: 7px 10px; box-shadow: inset 1px 0 0 #fff; }
    .meta > div:first-child { box-shadow: none; }
    .meta-label { font-size: 6.8pt; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
    .meta-value { margin-top: 1px; font-size: 9.5pt; font-weight: 600; color: var(--ink); }
    .doc-notice {
      margin-top: 8px;
      padding: 7px 12px;
      border-left: 3px solid var(--ink);
      border-radius: 0 6px 6px 0;
      background: var(--panel);
      font-size: 7.8pt;
      line-height: 1.4;
      color: var(--text);
    }
    .doc-notice strong { color: var(--ink); font-weight: 600; }
    .nowrap { white-space: nowrap; }

    .parties {
      display: grid;
      grid-template-columns: repeat(${data.recipient ? 3 : 2}, minmax(0, 1fr));
      gap: 18px;
      margin: 18px 0 16px;
    }
    .party { min-width: 0; }
    .party-name { font-size: 10pt; font-weight: 600; color: var(--ink); margin-bottom: 2px; line-height: 1.3; }
    .party-id { margin-top: 3px; color: var(--ink); }
    .party-id span { color: var(--muted); font-size: 7.5pt; font-weight: 600; letter-spacing: 0.04em; margin-right: 2px; }
    .party-contact { margin-top: 3px; color: var(--muted); font-size: 8pt; }

    .reference {
      margin: 0 0 14px;
      padding: 8px 12px;
      border-left: 3px solid var(--ink);
      background: var(--panel);
      border-radius: 0 6px 6px 0;
      font-size: 8.5pt;
    }
    .reference .label { color: var(--muted); margin-right: 4px; }

    table { border-collapse: collapse; width: 100%; max-width: 100%; table-layout: fixed; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; page-break-inside: avoid; }

    .items th {
      padding: 6px;
      font-size: 7pt;
      font-weight: 600;
      letter-spacing: 0.02em;
      line-height: 1.25;
      text-transform: uppercase;
      color: var(--muted);
      text-align: left;
      border-bottom: 1.5px solid var(--ink);
      vertical-align: bottom;
    }
    .items th.num { text-align: right; white-space: normal; }
    .items th.center { text-align: center; }
    .items td {
      padding: 7px 6px;
      border-bottom: 1px solid var(--line);
      vertical-align: top;
      color: var(--text);
      overflow-wrap: anywhere;
    }
    .items td.name { color: var(--ink); }
    .items.compact td { padding: 5px 6px; }
    .items tr.sum td { border-bottom: 0; border-top: 1.5px solid var(--ink); font-weight: 600; color: var(--ink); }
    .item-note { margin-top: 2px; color: var(--muted); font-size: 7.5pt; }

    .items.corrective tbody.correction-group { break-inside: avoid; page-break-inside: avoid; }
    .items.corrective tr.before td { color: var(--muted); border-bottom: 0; padding-bottom: 2px; }
    .items.corrective tr.after td { border-bottom: 0; padding-top: 2px; padding-bottom: 2px; }
    .items.corrective tr.difference td { padding-top: 3px; padding-bottom: 5px; background: var(--panel); }
    .items.corrective td[rowspan] { border-bottom: 1px solid var(--line); background: #fff; }
    .row-tag { font-size: 6.8pt; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); white-space: nowrap; }

    .party-correction tr.group th { padding-top: 10px; color: var(--ink); border-bottom: 1px solid var(--line-strong); }
    .party-correction tr.changed td { background: var(--due-bg); }

    .summary {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr);
      gap: 22px;
      margin-top: 16px;
      align-items: start;
    }

    .totals-table th {
      padding: 5px 6px;
      font-size: 7pt;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--muted);
      text-align: left;
      border-bottom: 1px solid var(--line-strong);
    }
    .totals-table th.num { text-align: right; white-space: normal; }
    .totals-table td { padding: 5px 6px; border-bottom: 1px solid var(--line); }
    .totals-table tr.advance td { color: var(--muted); }
    .totals-table tr.total td { font-weight: 700; color: var(--ink); border-bottom: 0; border-top: 1.5px solid var(--ink); }
    .totals-table + .totals-table { margin-top: 12px; }

    .total-box { margin-top: 12px; padding: 12px 14px; border-radius: 8px; background: var(--ink); color: #fff; }
    .total-box.total-paid { background: var(--paid); }
    .total-label { font-size: 7.5pt; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; opacity: 0.8; }
    .total-amount { margin-top: 2px; font-size: 20pt; font-weight: 700; letter-spacing: -0.01em; line-height: 1.15; white-space: nowrap; }
    .total-currency { margin-left: 6px; font-size: 11pt; font-weight: 600; opacity: 0.85; }
    .total-words { margin-top: 4px; font-size: 7.8pt; opacity: 0.85; line-height: 1.35; }

    .payment-card { padding: 12px 14px; background: var(--panel); border-radius: 8px; }
    .payment-list { margin: 0; display: grid; gap: 6px; }
    .payment-list > div { display: grid; grid-template-columns: 30mm minmax(0, 1fr); gap: 8px; align-items: baseline; }
    .payment-list dt { color: var(--muted); font-size: 8pt; }
    .payment-list dd { margin: 0; color: var(--ink); font-weight: 500; }
    .payment-list > div.stack { grid-template-columns: minmax(0, 1fr); gap: 1px; padding: 2px 0; }
    .payment-list dd.account { font-size: 10pt; font-weight: 600; letter-spacing: 0.02em; white-space: nowrap; }
    .status { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 7.5pt; font-weight: 600; background: var(--due-bg); color: var(--due); }
    .status-paid { background: var(--paid-bg); color: var(--paid); }
    .status-overdue { background: var(--overdue-bg); color: var(--overdue); }
    .status-detail { margin-top: 2px; font-size: 8pt; color: var(--muted); font-weight: 400; }

    .block { margin-top: 18px; }
    .advance-list { list-style: none; margin: 0 0 10px; padding: 0; border-top: 1px solid var(--line); }
    .advance-list li { display: flex; justify-content: space-between; gap: 12px; padding: 5px 6px; border-bottom: 1px solid var(--line); }

    .notice { margin-top: 12px; padding: 10px 12px; border-radius: 6px; background: var(--panel); font-size: 8.5pt; }

    .notes { margin-top: 16px; padding-top: 10px; border-top: 1px solid var(--line); }
    .notes-text { white-space: pre-wrap; font-size: 8.5pt; color: var(--text); }
    .notes-text + .notes-text { margin-top: 4px; }

    .tail { break-inside: avoid; page-break-inside: avoid; }
    .closing {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      gap: 24px;
      margin-top: 24px;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .closing-left { flex: 1 1 auto; min-width: 0; }
    /* Kod QR KSeF, pod nim numer KSeF faktury. */
    .ksef-verification { display: inline-flex; flex-direction: column; align-items: flex-start; gap: 3px; }
    .ksef-verification img { display: block; width: 26mm; height: 26mm; }
    .ksef-verification-title { font-size: 7pt; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
    .ksef-verification-number { font-size: 7.5pt; font-weight: 600; color: var(--ink); white-space: nowrap; }

    .signature { flex: 0 0 62mm; text-align: center; }
    .signature-name { font-size: 9.5pt; font-weight: 600; color: var(--ink); padding-bottom: 6px; }
    .signature-line { border-top: 1px solid var(--line-strong); padding-top: 4px; font-size: 7pt; color: var(--muted); }
  </style>
</head>

<body>
  <header class="doc-header">
    <div class="logo-slot">
      ${data.companyLogoUrl ? `<img src="${esc(data.companyLogoUrl)}" alt="Logo" class="logo" />` : `<div class="party-name">${esc(data.sellerName)}</div>`}
    </div>
    <div class="doc-title">
      <div class="doc-kind">${esc(typeLabel)}</div>
      <div class="doc-number">${esc(data.invoiceNumber)}</div>
      ${data.isProforma ? '<div class="doc-badges"><span class="badge">Wizualizacja pro formy</span></div>' : ''}
    </div>
  </header>

  ${visibleMetaCells.length ? `<div class="meta">${visibleMetaCells.map(([label, value]) => `<div><div class="meta-label">${esc(label)}</div><div class="meta-value">${esc(value)}</div></div>`).join('')}</div>` : ''}
  ${visualizationNoticeHtml}

  <section class="parties">
    <div class="party">
      <h3>Sprzedawca</h3>
      ${partyLines({
        name: data.sellerName, nip: data.sellerNip, street: data.sellerStreet, postalCode: data.sellerPostalCode,
        city: data.sellerCity, countryCode: data.sellerCountryCode, email: data.sellerEmail, phone: data.sellerPhone,
      })}
    </div>
    <div class="party">
      <h3>Nabywca</h3>
      ${partyLines({
        name: data.buyerName, nip: data.buyerNip, street: data.buyerStreet, postalCode: data.buyerPostalCode,
        city: data.buyerCity, countryCode: data.buyerCountryCode,
      })}
    </div>
    ${data.recipient ? `
    <div class="party">
      <h3>Odbiorca</h3>
      ${partyLines({
        name: data.recipient.name, nip: data.recipient.nip, street: data.recipient.street, postalCode: data.recipient.postalCode,
        city: data.recipient.city, countryCode: data.recipient.countryCode,
        extra: data.recipient.internalId ? `<div class="party-contact">Numer identyfikacji wewnętrznej KSeF: <strong>${esc(data.recipient.internalId)}</strong></div>` : '',
      })}
    </div>` : ''}
  </section>

  ${correctionReferenceHtml}

  ${isPartyDataCorrection ? partyCorrectionHtml : correctiveItems ? correctiveItemsHtml : standardItemsHtml}

  ${orderItemsHtml}

  <div class="tail keep">
  ${summaryHtml}
  ${finalSettlementHtml}

  ${notesHtml}

  <section class="closing">
    <div class="closing-left">
      <div id="ksef-verification-placeholder"></div>
    </div>
    <div class="signature">
      <div class="signature-name">${esc(data.signatureName?.trim() || 'Brak danych osoby wystawiającej')}</div>
      <div class="signature-line">Imię i nazwisko osoby upoważnionej do wystawienia</div>
    </div>
  </section>
  </div>
</body>
</html>`;
};
