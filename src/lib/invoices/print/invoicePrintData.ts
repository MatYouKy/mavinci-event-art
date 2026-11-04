import type { InvoicePdfData } from '@/components/crm/invoices/helpers/buildInvoicePdfHtml';
import { getInvoiceKsefRecipient } from '@/lib/invoices/ksefRecipient';
import { getInvoicePartyDataCorrection } from '@/lib/invoices/partyDataCorrection';

/**
 * Jeden mapper „wiersz faktury z bazy → dane wydruku”.
 * Z niego korzysta generator PDF (zapis do dokumentów), podgląd PDF na stronie faktury
 * i podgląd dokumentu w uzgadnianiu — każdy widzi ten sam wydruk.
 */

type Row = Record<string, any>;

const numberOrZero = (value: unknown) => {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
};

const text = (value: unknown) => (value == null ? '' : String(value));

export const normalizeInvoiceCountryCode = (value: unknown) => {
  const raw = text(value).trim().toUpperCase();
  return ['', 'POLSKA', 'POLAND', 'PL'].includes(raw) ? 'PL' : raw;
};

const mapItem = (item: Row, index: number): InvoicePdfData['items'][number] => ({
  positionNumber: Number(item.position_number ?? index + 1),
  name: text(item.name),
  unit: text(item.unit) || 'szt.',
  quantity: numberOrZero(item.quantity),
  priceNet: numberOrZero(item.price_net),
  vatRate: numberOrZero(item.vat_rate),
  vatCode: item.vat_code ?? undefined,
  vatExemptionReason: item.vat_exemption_reason ?? null,
  valueNet: numberOrZero(item.value_net),
  vatAmount: numberOrZero(item.vat_amount),
  valueGross: numberOrZero(item.value_gross),
});

/** Wiersz `invoices` z `invoice_items(*)` i `invoice_order_items(*)` (odczyt z bazy, bez wygenerowanych typów). */
export type InvoicePrintRow = any;

export function isProformaInvoiceRow(invoice: Row) {
  return invoice.invoice_type === 'proforma' || Boolean(invoice.is_proforma);
}

export function invoiceRowToPdfData(
  invoice: InvoicePrintRow,
  options: { companyLogoUrl: string | null; signatureName: string },
): InvoicePdfData {
  const items = Array.isArray(invoice.invoice_items)
    ? [...invoice.invoice_items].sort((a, b) => Number(a.position_number ?? 0) - Number(b.position_number ?? 0))
    : [];
  const orderItems = Array.isArray(invoice.invoice_order_items)
    ? [...invoice.invoice_order_items].sort((a, b) => Number(a.position_number ?? 0) - Number(b.position_number ?? 0))
    : [];
  const settledInvoices = Array.isArray(invoice.settled_invoices)
    ? invoice.settled_invoices.map((settled: Row) => ({
        id: settled.id,
        invoiceNumber: text(settled.invoiceNumber ?? settled.invoice_number),
        invoiceType: text(settled.invoiceType ?? settled.invoice_type) || 'advance',
        issueDate: settled.issueDate ?? settled.issue_date ?? undefined,
        totalNet: numberOrZero(settled.totalNet ?? settled.total_net),
        totalVat: numberOrZero(settled.totalVat ?? settled.total_vat),
        totalGross: numberOrZero(settled.totalGross ?? settled.total_gross),
      }))
    : [];
  const isProforma = isProformaInvoiceRow(invoice);
  const ksefAccepted = invoice.ksef_status === 'accepted' && Boolean(invoice.ksef_reference_number);

  return {
    paymentStatus: invoice.payment_status ?? (invoice.status === 'paid' ? 'paid' : 'unpaid'),
    paidAmount: numberOrZero(invoice.paid_amount),
    paidAt: invoice.paid_at ?? invoice.paid_date ?? null,
    buyerIsPrivatePerson: Boolean(invoice.buyer_is_private_person),
    footerNote: text(invoice.footer_note),
    signatureName: options.signatureName,
    showPreviewWatermark: true,
    website: invoice.website ?? null,
    invoiceNumber: text(invoice.invoice_number),
    invoiceType: isProforma ? 'proforma' : text(invoice.invoice_type) || 'vat',
    issueDate: text(invoice.issue_date),
    saleDate: text(invoice.sale_date),
    issuePlace: text(invoice.issue_place),
    paymentMethod: text(invoice.payment_method) || 'Przelew',
    paymentDueDate: text(invoice.payment_due_date),
    bankAccount: text(invoice.bank_account),
    bankName: text(invoice.bank_name),
    bankSwift: text(invoice.bank_swift_code),
    sellerName: text(invoice.seller_name),
    sellerNip: text(invoice.seller_nip),
    sellerStreet: text(invoice.seller_street),
    sellerCity: text(invoice.seller_city),
    sellerPostalCode: text(invoice.seller_postal_code),
    sellerCountryCode: normalizeInvoiceCountryCode(invoice.seller_country),
    sellerEmail: text(invoice.seller_email),
    sellerPhone: text(invoice.seller_phone),
    buyerName: text(invoice.buyer_name),
    buyerNip: text(invoice.buyer_nip),
    buyerStreet: text(invoice.buyer_street),
    buyerCity: text(invoice.buyer_city),
    buyerPostalCode: text(invoice.buyer_postal_code),
    buyerCountryCode: normalizeInvoiceCountryCode(invoice.buyer_country),
    recipient: getInvoiceKsefRecipient(invoice),
    totalNet: numberOrZero(invoice.total_net),
    totalVat: numberOrZero(invoice.total_vat),
    totalGross: numberOrZero(invoice.total_gross),
    currencyCode: text(invoice.currency_code) || 'PLN',
    companyLogoUrl: options.companyLogoUrl,
    isProforma,
    ksefNumber: ksefAccepted ? text(invoice.ksef_reference_number) : undefined,
    correctionReason: invoice.correction_reason ?? undefined,
    correctionKind: invoice.correction_kind ?? null,
    correctionPartyDataBefore: getInvoicePartyDataCorrection(invoice),
    correctedInvoiceNumber: invoice.corrected_invoice_number ?? undefined,
    correctedInvoiceIssueDate: invoice.corrected_invoice_issue_date ?? undefined,
    correctedInvoiceKsefNumber: invoice.corrected_invoice_ksef_number ?? undefined,
    items: items.map(mapItem),
    invoice_items: items as InvoicePdfData['invoice_items'],
    orderItems: orderItems.map(mapItem),
    settledInvoices,
    settlementSummary: invoice.settlement_summary ?? undefined,
  };
}

/** Nazwa pliku PDF faktury — ta sama w podglądzie, pobraniu i zapisie w dokumentach wydarzenia. */
export function invoicePdfFileName(invoiceNumber: string | null | undefined, isProforma = false) {
  const safe = text(invoiceNumber).trim().replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_');
  return `${isProforma ? 'Proforma' : 'Faktura'}_${safe || 'dokument'}.pdf`;
}
