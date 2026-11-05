import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildInvoicePdfHtml,
  getInvoicePrintTypeLabel,
  INVOICE_PRINT_TEMPLATE_VERSION,
} from '@/components/crm/invoices/helpers/buildInvoicePdfHtml';
import { generateKsefInvoiceQrDataUrl } from '@/lib/ksef/qr';
import { resolveInvoiceIssuerName } from '@/lib/invoices/resolveInvoiceIssuerName';
import { invoiceRowToPdfData, isProformaInvoiceRow, type InvoicePrintRow } from '@/lib/invoices/print/invoicePrintData';
import {
  escapeHtml,
  loadPrintFontCss,
  renderHtmlToPdf,
  resolveCachedPrintLogo,
  type RenderedPdf,
} from '@/lib/print/pdfRenderer.server';

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
          <a href="${escapeHtml(qr.verificationUrl)}"><img src="${qr.dataUrl}" alt="Kod QR KSeF" /></a>
          <div class="ksef-verification-number">${escapeHtml(ksefInvoice.ksef_reference_number)}</div>
        </div>`,
      );
    }
  }
  // Bez zapisanego XML (brak kodu QR) zostaje sam numer KSeF.
  html = html.replace(
    qrPlaceholder,
    data.ksefNumber
      ? `<div class="ksef-verification"><div class="ksef-verification-title">Numer KSeF</div><div class="ksef-verification-number">${escapeHtml(data.ksefNumber)}</div></div>`
      : '',
  );
  html = html.replace('/*invoice-print-fonts*/', await loadPrintFontCss());

  const isProforma = isProformaInvoiceRow(invoice);
  const typeLabel = getInvoicePrintTypeLabel(data.invoiceType, data.invoiceNumber);
  // Stopka na każdej stronie: przyjęta w KSeF — numer KSeF; wcześniej — wizualizacja do wysłania do KSeF.
  const footerLeft = isProforma
    ? `${typeLabel} ${data.invoiceNumber} · nie jest fakturą VAT`
    : data.ksefNumber
      ? `${typeLabel} ${data.invoiceNumber} · numer KSeF: ${data.ksefNumber}`
      : data.ksefPending
        ? `Wizualizacja: ${typeLabel} ${data.invoiceNumber} · czeka na numer KSeF`
        : `Wizualizacja: ${typeLabel} ${data.invoiceNumber} · wymaga wysłania do KSeF`;
  return {
    html,
    fileTitle: `${isProforma || data.ksefNumber ? '' : 'Wizualizacja — '}${typeLabel} ${data.invoiceNumber}`,
    footer: { left: footerLeft, right: data.website || '' },
    isProforma,
  };
}

export type RenderedInvoicePdf = RenderedPdf;

/** PDF faktury — wspólny renderer wydruków (jedna przeglądarka na proces serwera Next). */
export function renderInvoicePdf(document: InvoicePrintDocument): Promise<RenderedInvoicePdf> {
  return renderHtmlToPdf(document);
}

/** Rewizja wydruku: zmiana faktury albo szablonu = nowy podgląd (pamięć podręczna klienta). */
export function invoicePrintRevision(invoice: { updated_at?: string | null; pdf_generated_at?: string | null }) {
  return [INVOICE_PRINT_TEMPLATE_VERSION, invoice.updated_at || '', invoice.pdf_generated_at || ''].join('|');
}
