'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/browser';
import {
  ArrowLeft,
  Download,
  CreditCard as Edit,
  Printer,
  Send,
  CheckCircle,
  XCircle,
  Building2,
  Calendar,
  FileText,
  Link as LinkIcon,
  FileDown,
  Loader,
  RefreshCw,
  Eye,
  ChevronDown,
} from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';
import SendInvoiceEmailModal from '@/components/crm/SendInvoiceEmailModal';
import ConvertProformaModal from '@/components/crm/ConvertProformaModal';
import KSeFSendModal from '@/components/crm/KSeFSendModal';
import FinalInvoiceWizardModal from '@/components/crm/FinalInvoiceWizardModal';
import InvoiceDocumentActionsMenu, { type InvoiceDocumentAction } from '@/components/crm/invoices/InvoiceDocumentActionsMenu';
import PermissionGuard from '@/components/crm/PermissionGuard';
import { useDialog } from '@/contexts/DialogContext';
import Image from 'next/image';
import ResponsiveActionBar, { Action } from '@/components/crm/ResponsiveActionBar';
import {
  buildInvoicePdfHtml,
  SettledInvoicePdfRef,
} from '@/components/crm/invoices/helpers/buildInvoicePdfHtml';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { useInvoiceFinanceAccess } from '@/hooks/useInvoiceFinanceAccess';
import { resolveInvoiceIssuerName } from '@/lib/invoices/resolveInvoiceIssuerName';
import { loadCanonicalBankPaymentDisplay, formatCanonicalBankPayment, type CanonicalBankPaymentDisplay } from '@/lib/invoices/canonicalBankPaymentDisplay';
import { getPaymentAwareInvoiceFooterNote } from '@/lib/invoices/paymentAwareFooterNote';

type KSeFSendSuccess = {
  ksef_reference_number: string;
  ksef_timestamp: string;
};

interface Invoice {
  buyer_is_private_person: boolean;
  bank_name: string;
  company_logo_url: string | null;
  my_company: {
    logo_url: string | null;
  } | null;
  id: string;
  invoice_number: string;
  my_company_id: string | null;
  invoice_type: string;
  status: string;
  payment_status: 'unpaid' | 'partially_paid' | 'paid' | 'overdue' | 'refund_due' | 'partially_refunded' | 'refunded' | null;
  paid_amount: number | null;
  paid_at: string | null;
  paid_date?: string | null;
  issue_date: string;
  sale_date: string;
  payment_due_date: string;
  seller_name: string;
  seller_nip: string;
  seller_street: string;
  seller_postal_code: string;
  seller_city: string;
  buyer_name: string;
  buyer_nip: string;
  buyer_street: string;
  buyer_postal_code: string;
  buyer_city: string;
  payment_method: string;
  bank_account: string;
  total_net: number;
  total_vat: number;
  total_gross: number;
  currency_code: string;
  issue_place: string;
  pdf_url: string | null;
  pdf_generated_at: string | null;
  event_id: string | null;
  organization_id: string | null;
  billing_arrangement: 'direct' | 'hotel' | 'agency' | 'other';
  service_recipient_organization_id: string | null;
  service_recipient_contact_id: string | null;
  buyer_contact_id: string | null;
  related_invoice_id: string | null;
  is_proforma: boolean;
  proforma_converted_to_invoice_id: string | null;
  correction_reason: string | null;
  correction_scope: string | null;
  corrected_invoice_number: string | null;
  corrected_invoice_issue_date: string | null;
  corrected_invoice_ksef_number: string | null;
  corrected_invoice_was_in_ksef: boolean;
  ksef_reference_number: string | null;
  ksef_status: string | null;
  ksef_error: string | null;
  ksef_sent_at: string | null;
  footer_note: string;
  signature_name: string;
  created_by?: string | null;
  website: string;
  invoice_items?: InvoiceItem[];
  settled_invoices?: SettledInvoicePdfRef[];
  settlement_summary?: {
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

interface RelatedData {
  event?: {
    id: string;
    name: string;
    event_date: string | null;
    contact_person_id?: string | null;
  } | null;
  organization?: { id: string; name: string; nip: string; email?: string } | null;
  serviceRecipientOrganization?: {
    id: string;
    name: string;
    nip: string;
    email?: string;
  } | null;
  primaryContact?: { id: string; name: string; email?: string | null } | null;
  relatedInvoice?: {
    id: string;
    invoice_number: string;
    invoice_type: string;
    event_id?: string | null;
  } | null;
  relatedInvoices?: Array<{
    id: string;
    invoice_number: string;
    invoice_type: string;
    relation_type: string;
  }>;
  settlementEvents?: Array<{
    id: string;
    name: string;
    event_date: string;
    allocated_gross: number;
  }>;
}

export interface InvoiceItem {
  id: string;
  position_number: number;
  name: string;
  unit: string;
  quantity: number;
  price_net: number;
  vat_rate: number;
  vat_code?: '23' | '8' | '5' | '0' | '0 KR' | '0 WDT' | '0 EX' | 'zw' | 'np' | 'np I' | 'np II' | 'oo';
  vat_exemption_reason?: string | null;
  value_net: number;
  vat_amount: number;
  value_gross: number;
  before_quantity?: number | null;
  before_price_net?: number | null;
  before_value_net?: number | null;
  before_vat_amount?: number | null;
  before_value_gross?: number | null;
  after_quantity?: number | null;
  after_price_net?: number | null;
  after_value_net?: number | null;
  after_vat_amount?: number | null;
  after_value_gross?: number | null;
  total_net?: number | null;
  total_vat?: number | null;
  total_gross?: number | null;
}

export default function InvoiceDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const { employee } = useCurrentEmployee();
  const { access: financeAccess, loading: financeAccessLoading, error: financeAccessError } = useInvoiceFinanceAccess();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [issuerPreview, setIssuerPreview] = useState<{
    invoiceId: string;
    name: string | null;
    error: boolean;
  } | null>(null);
  const invoiceSignatureName = invoice?.signature_name?.trim()
    || (issuerPreview?.invoiceId === invoice?.id ? issuerPreview?.name : null)
    || '';

  useEffect(() => {
    let active = true;
    setIssuerPreview(null);
    if (invoice) {
      resolveInvoiceIssuerName(supabase, invoice)
        .then((name) => { if (active) setIssuerPreview({ invoiceId: invoice.id, name, error: false }); })
        .catch(() => { if (active) setIssuerPreview({ invoiceId: invoice.id, name: null, error: true }); });
    }
    return () => { active = false; };
  }, [invoice?.id, invoice?.signature_name, invoice?.created_by]);
  const [canonicalBankPayment, setCanonicalBankPayment] = useState<CanonicalBankPaymentDisplay | null>(null);
  const [bankPaymentReadError, setBankPaymentReadError] = useState(false);

  useEffect(() => {
    let active = true;
    setCanonicalBankPayment(null);
    setBankPaymentReadError(false);
    if (invoice && financeAccess?.canViewCompanyFinance) {
      loadCanonicalBankPaymentDisplay([invoice])
        .then((payments) => { if (active) setCanonicalBankPayment(payments[invoice.id] || null); })
        .catch(() => { if (active) setBankPaymentReadError(true); });
    }
    return () => { active = false; };
  }, [invoice, financeAccess]);
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [relatedData, setRelatedData] = useState<RelatedData>({});
  const [loading, setLoading] = useState(true);
  const [showSendEmailModal, setShowSendEmailModal] = useState(false);
  const [showConvertProformaModal, setShowConvertProformaModal] = useState(false);
  const [showKSeFModal, setShowKSeFModal] = useState(false);
  const [completedKsefSend, setCompletedKsefSend] = useState<{
    invoiceId: string;
    result: KSeFSendSuccess;
  } | null>(null);
  const [showFinalInvoiceModal, setShowFinalInvoiceModal] = useState(false);
  const [showKsefDetails, setShowKsefDetails] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [pdfPath, setPdfPath] = useState<string | null>(null);
  const [lastBase64, setLastBase64] = useState<string | null>(null);
  const [emailSentCount, setEmailSentCount] = useState(0);
  const [showRelations, setShowRelations] = useState(false);

  const [finalSettlementPreview, setFinalSettlementPreview] = useState<{
    settledInvoices?: SettledInvoicePdfRef[];
    settlementSummary?: Invoice['settlement_summary'];
  } | null>(null);

  const fetchInvoice = useCallback(async ({ background = false }: { background?: boolean } = {}) => {
    if (financeAccessLoading) return;
    if (!financeAccess || financeAccess.scope === 'none') {
      setInvoice(null);
      setItems([]);
      setRelatedData({});
      setLoading(false);
      return;
    }
    // Refreshing after KSeF success must not unmount the completed send modal.
    if (!background) setLoading(true);
    try {
      let invoiceQuery = supabase
          .from('invoices')
          .select(
            `
            *,
            my_company:my_companies (
              id,
              name,
              logo_url
            )
          `,
          )
          .eq('id', params.id);
      if (financeAccess.scope === 'sales') {
        invoiceQuery = invoiceQuery.in('created_by', [financeAccess.employeeId, financeAccess.authUserId]);
      }
      const invoiceRes = await invoiceQuery.maybeSingle();
      if (invoiceRes.error) throw invoiceRes.error;
      if (!invoiceRes.data) {
        setInvoice(null);
        setItems([]);
        setRelatedData({});
        return;
      }
      const itemsRes = await supabase
          .from('invoice_items')
          .select('*')
          .eq('invoice_id', params.id)
          .order('position_number');

      if (invoiceRes.data) {
        setInvoice({ ...invoiceRes.data, invoice_items: itemsRes.data || [] });
        setPdfPath(invoiceRes.data.pdf_url || null);

        const promises = [];

        if (invoiceRes.data.event_id) {
          promises.push(
            supabase
              .from('events')
              .select('id, name, event_date, contact_person_id')
              .eq('id', invoiceRes.data.event_id)
              .maybeSingle(),
          );
        }

        if (invoiceRes.data.organization_id) {
          promises.push(
            supabase
              .from('organizations')
              .select('id, name, nip, email')
              .eq('id', invoiceRes.data.organization_id)
              .maybeSingle(),
          );
        }

        const hasSeparateServiceRecipient =
          invoiceRes.data.service_recipient_organization_id &&
          invoiceRes.data.service_recipient_organization_id !== invoiceRes.data.organization_id;

        if (hasSeparateServiceRecipient) {
          promises.push(
            supabase
              .from('organizations')
              .select('id, name, nip, email')
              .eq('id', invoiceRes.data.service_recipient_organization_id)
              .maybeSingle(),
          );
        }

        if (invoiceRes.data.related_invoice_id) {
          promises.push(
            supabase
              .from('invoices')
              .select('id, invoice_number, invoice_type, event_id')
              .eq('id', invoiceRes.data.related_invoice_id)
              .maybeSingle(),
          );
        }

        promises.push(supabase.rpc('get_related_invoices', { p_invoice_id: params.id }));

        const results = await Promise.all(promises);

        const related: RelatedData = {};
        let resultIndex = 0;

        if (invoiceRes.data.event_id) {
          if (results[resultIndex]?.data) related.event = results[resultIndex].data;
          resultIndex++;
        }

        if (invoiceRes.data.organization_id) {
          if (results[resultIndex]?.data) related.organization = results[resultIndex].data;
          resultIndex++;
        }

        if (hasSeparateServiceRecipient) {
          if (results[resultIndex]?.data) {
            related.serviceRecipientOrganization = results[resultIndex].data;
          }
          resultIndex++;
        }

        if (invoiceRes.data.related_invoice_id) {
          if (results[resultIndex]?.data) related.relatedInvoice = results[resultIndex].data;
          resultIndex++;
        }

        if (results[resultIndex]?.data) {
          related.relatedInvoices = results[resultIndex].data;
        }

        if (invoiceRes.data.event_id) {
          const contactPersonId =
            related.event?.contact_person_id || invoiceRes.data.contact_person_id;

          if (contactPersonId) {
            const { data: contact, error: contactError } = await supabase
              .from('contacts')
              .select('id, first_name, last_name, full_name, email')
              .eq('id', contactPersonId)
              .maybeSingle();

            if (contactError) {
              console.error('Error fetching contact:', contactError);
            }

            if (contact) {
              related.primaryContact = {
                id: contact.id,
                name:
                  contact.full_name ||
                  `${contact.first_name ?? ''} ${contact.last_name ?? ''}`.trim(),
                email: contact.email ?? null,
              };
            }
          }
        }

        const { data: settlementLinks } = await supabase
          .from('event_invoice_settlements')
          .select('event_id,allocated_gross,shared_event_count')
          .eq('id', invoiceRes.data.id);

        if (settlementLinks && settlementLinks.length > 1) {
          const otherLinks = settlementLinks.filter(
            (link) => link.event_id !== invoiceRes.data.event_id,
          );
          const { data: settlementEvents } = await supabase
            .from('events')
            .select('id,name,event_date')
            .in('id', otherLinks.map((link) => link.event_id));

          related.settlementEvents = (settlementEvents || []).map((event) => ({
            ...event,
            allocated_gross: Number(
              otherLinks.find((link) => link.event_id === event.id)?.allocated_gross || 0,
            ),
          }));
        }

        setRelatedData(related);
      }

      if (itemsRes.data) setItems(itemsRes.data);
    } catch (err) {
      console.error('Error fetching invoice:', err);
      showSnackbar('Blad podczas ladowania faktury', 'error');
    } finally {
      if (!background) setLoading(false);
    }
  }, [params.id, financeAccess, financeAccessLoading]);

  useEffect(() => {
    fetchInvoice();
  }, [fetchInvoice]);

  useEffect(() => {
    if (!invoice) return;

    const relatedLoaded =
      Boolean(invoice.related_invoice_id) || Boolean(relatedData.relatedInvoices);

    if (!relatedLoaded) return;

    (async () => {
      const data = await buildFinalSettlementData(invoice);
      setFinalSettlementPreview(data);
    })();
  }, [invoice?.id, invoice?.related_invoice_id, relatedData.relatedInvoices?.length]);

  const isFinalInvoice = (invoice?: Invoice | null) =>
    Boolean(invoice?.invoice_type === 'final' || invoice?.invoice_number?.startsWith('FKO/'));

  const buildFinalSettlementData = async (currentInvoice: Invoice) => {
    if (!isFinalInvoice(currentInvoice)) {
      return {
        settledInvoices: undefined,
        settlementSummary: undefined,
      };
    }

    const relatedAdvanceIds = Array.from(
      new Set(
        [
          currentInvoice.related_invoice_id,
          ...(relatedData.relatedInvoices ?? []).map((rel) => rel.id),
        ].filter(Boolean),
      ),
    ) as string[];

    if (!relatedAdvanceIds.length) {
      return {
        settledInvoices: undefined,
        settlementSummary: undefined,
      };
    }

    const { data: advanceInvoices, error } = await supabase
      .from('invoices')
      .select('id, invoice_number, invoice_type, issue_date, total_net, total_vat, total_gross')
      .in('id', relatedAdvanceIds)
      .in('invoice_type', ['advance']);
    // .eq('invoice_type', 'advance');

    if (error) {
      console.error('Error fetching settled advance invoices:', error);
    }

    const settledInvoices: SettledInvoicePdfRef[] = (advanceInvoices ?? []).map((inv) => ({
      id: inv.id,
      invoiceNumber: inv.invoice_number,
      invoiceType: inv.invoice_type,
      issueDate: inv.issue_date,
      totalNet: Number(inv.total_net ?? 0),
      totalVat: Number(inv.total_vat ?? 0),
      totalGross: Number(inv.total_gross ?? 0),
    }));

    const settledNet = settledInvoices.reduce((sum, inv) => sum + inv.totalNet, 0);
    const settledVat = settledInvoices.reduce((sum, inv) => sum + inv.totalVat, 0);
    const settledGross = settledInvoices.reduce((sum, inv) => sum + inv.totalGross, 0);

    return {
      settledInvoices,
      settlementSummary: {
        invoiceTotalNet: Number(currentInvoice.total_net ?? 0),
        invoiceTotalVat: Number(currentInvoice.total_vat ?? 0),
        invoiceTotalGross: Number(currentInvoice.total_gross ?? 0),
        settledNet,
        settledVat,
        settledGross,
        remainingNet: Number(currentInvoice.total_net ?? 0) - settledNet,
        remainingVat: Number(currentInvoice.total_vat ?? 0) - settledVat,
        remainingGross: Number(currentInvoice.total_gross ?? 0) - settledGross,
      },
    };
  };

  const handleKsefSuccess = useCallback(async (result: KSeFSendSuccess) => {
    // Keep the terminal result above the modal so an incidental remount cannot resend.
    setCompletedKsefSend({ invoiceId: params.id, result });
    setInvoice((current) => current?.id === params.id
      ? { ...current, ksef_status: 'accepted', ksef_reference_number: result.ksef_reference_number, ksef_error: null }
      : current);
    await fetchInvoice({ background: true });
  }, [fetchInvoice, params.id]);

  const handleKsefError = useCallback((error: string) => {
    console.error('[KSeF error]', error);
  }, []);

  useEffect(() => {
    if (!invoice) return;

    (async () => {
      const data = await buildFinalSettlementData(invoice);
      setFinalSettlementPreview(data);
    })();
  }, [invoice, relatedData.relatedInvoices]);

  const handleGeneratePDF = async () => {
    if (!invoice || generating) return;

    setGenerating(true);

    try {
      const resolvedEventId = invoice.event_id || relatedData.relatedInvoice?.event_id || null;

      const [{ data: freshItems }, { data: freshOrderItems }] = await Promise.all([
        supabase
          .from('invoice_items')
          .select('*')
          .eq('invoice_id', invoice.id)
          .order('position_number', { ascending: true }),
        supabase
          .from('invoice_order_items')
          .select('*')
          .eq('invoice_id', invoice.id)
          .order('position_number', { ascending: true }),
      ]);

      const pdfItems = freshItems || items;

      if (freshItems && freshItems.length > 0) {
        setItems(freshItems);
        setInvoice((prev) => (prev ? { ...prev, invoice_items: freshItems } : prev));
      }

      const finalSettlementData = await buildFinalSettlementData(invoice);

      const pdfAmountToPay =
        (invoice.invoice_type === 'final' || invoice.invoice_number?.startsWith('FKO/')) &&
        finalSettlementData.settlementSummary
          ? Number(finalSettlementData.settlementSummary.remainingGross ?? 0)
          : Number(invoice.total_gross ?? 0);

      const normalizedPaymentStatus: NonNullable<Invoice['payment_status']> =
        invoice.payment_status || (invoice.status === 'paid' ? 'paid' : 'unpaid');

      const normalizedPaidAmount =
        normalizedPaymentStatus === 'paid' || normalizedPaymentStatus === 'refunded'
          ? Math.abs(pdfAmountToPay)
          : Number(invoice.paid_amount ?? 0);

      const html = buildInvoicePdfHtml({
        paymentStatus: normalizedPaymentStatus,
        paidAmount: normalizedPaidAmount,
        paidAt: invoice.paid_at || invoice.paid_date || null,

        buyerIsPrivatePerson: invoice.buyer_is_private_person,
        footerNote: invoice.footer_note || '',
        signatureName: invoiceSignatureName,
        showPreviewWatermark: true,
        website: invoice.website || null,
        invoiceNumber: invoice.invoice_number,
        invoiceType:
          invoice.invoice_type === 'proforma' || invoice.is_proforma
            ? 'proforma'
            : invoice.invoice_type,
        issueDate: invoice.issue_date,
        saleDate: invoice.sale_date,
        issuePlace: invoice.issue_place,
        paymentMethod: invoice.payment_method,
        paymentDueDate: invoice.payment_due_date,
        bankAccount: invoice.bank_account,
        bankName: invoice.bank_name,
        sellerName: invoice.seller_name,
        sellerNip: invoice.seller_nip,
        sellerStreet: invoice.seller_street,
        sellerCity: invoice.seller_city,
        sellerPostalCode: invoice.seller_postal_code,
        buyerName: invoice.buyer_name,
        buyerNip: invoice.buyer_nip,
        buyerStreet: invoice.buyer_street,
        buyerCity: invoice.buyer_city,
        buyerPostalCode: invoice.buyer_postal_code,
        totalNet: invoice.total_net,
        totalVat: invoice.total_vat,
        totalGross: invoice.total_gross,
        currencyCode: invoice.currency_code || 'PLN',
        companyLogoUrl: invoice.company_logo_url
          ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/company-logos/${invoice.company_logo_url}`
          : null,
        correctionReason: invoice.correction_reason || undefined,
        correctedInvoiceNumber: invoice.corrected_invoice_number || undefined,
        correctedInvoiceIssueDate: invoice.corrected_invoice_issue_date || undefined,
        items: pdfItems.map((item: InvoiceItem) => ({
          positionNumber: item.position_number,
          name: item.name,
          unit: item.unit,
          quantity: item.quantity,
          priceNet: item.price_net,
          vatRate: item.vat_rate,
          vatCode: item.vat_code,
          vatExemptionReason: item.vat_exemption_reason,
          valueNet: item.value_net,
          vatAmount: item.vat_amount,
          valueGross: item.value_gross,
        })),
        invoice_items: (freshItems || invoice.invoice_items || []) as InvoiceItem[],
        orderItems: (freshOrderItems || []).map((item) => ({
          positionNumber: item.position_number,
          name: item.name,
          unit: item.unit,
          quantity: Number(item.quantity),
          priceNet: Number(item.price_net),
          vatRate: Number(item.vat_rate),
          vatCode: item.vat_code,
          vatExemptionReason: item.vat_exemption_reason,
          valueNet: Number(item.value_net),
          vatAmount: Number(item.vat_amount),
          valueGross: Number(item.value_gross),
        })),
        isProforma: invoice.invoice_type === 'proforma' || invoice.is_proforma,
        settledInvoices: invoice.settled_invoices ?? finalSettlementData.settledInvoices,
        settlementSummary: invoice.settlement_summary ?? finalSettlementData.settlementSummary,
      });

      const response = await fetch('/bridge/invoices/invoice-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          html,
          fileName: `Faktura_${invoice.invoice_number}.pdf`,
          invoiceId: invoice.id,
          eventId: resolvedEventId,
          organizationId: invoice.organization_id || null,
          buyerContactId: invoice.buyer_contact_id || null,
          createdBy: employee?.id ?? null,
          previousPdfPath: pdfPath,
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => null);
        throw new Error(err?.error || 'Blad generowania PDF');
      }

      const result = await response.json();

      if (result.base64) {
        setLastBase64(result.base64);
      }

      if (result.storagePath) {
        setPdfPath(result.storagePath);
        setInvoice((prev) =>
          prev
            ? { ...prev, pdf_url: result.storagePath, pdf_generated_at: new Date().toISOString() }
            : null,
        );
        showSnackbar('PDF wygenerowany i zapisany', 'success');
      } else {
        showSnackbar('PDF wygenerowany', 'success');
      }
    } catch (err: unknown | Error) {
      if (err instanceof Error) {
        console.error('Error generating PDF:', err);
        showSnackbar(err.message, 'error');
      } else {
        console.error('Error generating PDF:', err);
        showSnackbar('Nieznany błąd podczas generowania PDF', 'error');
      }
    } finally {
      setGenerating(false);
    }
  };

  const getSignedUrl = async (path: string): Promise<string | null> => {
    const { data, error } = await supabase.storage.from('event-files').createSignedUrl(path, 3600);
    if (error || !data?.signedUrl) {
      console.error('Error creating signed URL:', error);
      return null;
    }
    return data.signedUrl;
  };

  const downloadFromBase64 = (base64: string) => {
    const byteChars = atob(base64);
    const byteNumbers = new Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
    const blob = new Blob([new Uint8Array(byteNumbers)], { type: 'application/pdf' });
    const blobUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = `Faktura_${invoice?.invoice_number}.pdf`;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    }, 100);
  };

  const handleDownloadPDF = async () => {
    if (lastBase64) {
      downloadFromBase64(lastBase64);
      return;
    }

    if (!pdfPath) {
      showSnackbar('Najpierw wygeneruj PDF', 'warning');
      return;
    }

    try {
      const url = await getSignedUrl(pdfPath);
      if (!url) {
        showSnackbar('Nie mozna pobrac pliku. Wygeneruj PDF ponownie.', 'error');
        setPdfPath(null);
        return;
      }
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = pdfPath.split('/').pop() || `Faktura_${invoice?.invoice_number}.pdf`;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      setTimeout(() => {
        document.body.removeChild(link);
        window.URL.revokeObjectURL(blobUrl);
      }, 100);
    } catch (err) {
      console.error('Error downloading PDF:', err);
      showSnackbar('Blad pobierania PDF', 'error');
    }
  };

  const handlePreviewPDF = async () => {
    if (!pdfPath && !lastBase64) {
      showSnackbar('Najpierw wygeneruj PDF', 'warning');
      return;
    }

    const previewWindow = window.open('', '_blank');
    if (!previewWindow) {
      showSnackbar('Przeglądarka zablokowała nowe okno podglądu', 'warning');
      return;
    }
    previewWindow.opener = null;

    try {
      if (lastBase64) {
        const byteChars = atob(lastBase64);
        const byteNumbers = new Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
        const blob = new Blob([new Uint8Array(byteNumbers)], { type: 'application/pdf' });
        const blobUrl = window.URL.createObjectURL(blob);
        previewWindow.location.href = blobUrl;
        setTimeout(() => window.URL.revokeObjectURL(blobUrl), 60_000);
        return;
      }

      const url = await getSignedUrl(pdfPath!);
      if (!url) {
        previewWindow.close();
        showSnackbar('Nie można otworzyć PDF. Wygeneruj dokument ponownie.', 'error');
        return;
      }
      previewWindow.location.href = url;
    } catch (err) {
      previewWindow.close();
      console.error('Error previewing PDF:', err);
      showSnackbar('Błąd podczas otwierania podglądu PDF', 'error');
    }
  };

  const handlePrintPDF = async () => {
    if (lastBase64) {
      const byteChars = atob(lastBase64);
      const byteNumbers = new Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
      const blob = new Blob([new Uint8Array(byteNumbers)], { type: 'application/pdf' });
      const blobUrl = window.URL.createObjectURL(blob);
      const printWindow = window.open(blobUrl, '_blank');
      if (printWindow) {
        printWindow.addEventListener('load', () => {
          printWindow.print();
        });
      }
      return;
    }

    if (!pdfPath) {
      window.print();
      return;
    }

    try {
      const url = await getSignedUrl(pdfPath);
      if (!url) {
        window.print();
        return;
      }
      const printWindow = window.open(url, '_blank');
      if (printWindow) {
        printWindow.addEventListener('load', () => {
          printWindow.print();
        });
      }
    } catch {
      window.print();
    }
  };

  const handleSendEmail = () => {
    setShowSendEmailModal(true);
  };

  const handleStatusChange = async (newStatus: string) => {
    if (!invoice) return;

    const safeStatus = newStatus;

    const updateData: Record<string, string | number | null> = {
      status: safeStatus,
    };

    if (safeStatus === 'paid') {
      updateData.payment_status = 'paid';
      updateData.paid_amount = Math.abs(Number(invoice.total_gross ?? 0));
      updateData.paid_at = new Date().toISOString();
      updateData.paid_date = new Date().toISOString().split('T')[0];
    }

    if (safeStatus !== 'paid' && ['paid', 'refunded'].includes(invoice.payment_status || '')) {
      updateData.payment_status = 'unpaid';
      updateData.paid_amount = 0;
      updateData.paid_at = null;
      updateData.paid_date = null;
    }

    try {
      const { error } = await supabase.from('invoices').update(updateData).eq('id', params.id);

      if (error) throw error;

      await fetchInvoice();
      showSnackbar('Status faktury został zmieniony', 'success');
    } catch (err) {
      console.error('Error updating status:', err);
      showSnackbar('Błąd podczas zmiany statusu', 'error');
    }
  };

  const handleConvertToVAT = () => {
    setShowConvertProformaModal(true);
  };

  const handleSendToKSeF = async () => {
    if (!invoice || showKSeFModal || !financeAccess?.canIssueInvoices
      || completedKsefSend?.invoiceId === invoice.id
      || ['pending', 'sent', 'accepted'].includes(invoice.ksef_status?.trim().toLowerCase() || '')
      || invoice.ksef_reference_number) return;
    const confirmed = await showConfirm(
      'Czy na pewno chcesz wyslac te fakture do KSeF? Tej operacji nie mozna cofnac.',
      'Tej operacji nie mozna cofnac.',
    );
    if (!confirmed) return;
    setShowKSeFModal(true);
  };

  const emailButtonLabel = emailSentCount > 0 ? 'Wyslij email ponownie' : 'Wyslij email';

  const actions = useMemo<Action[]>(() => {
    const nextActions: Action[] = [];

    if (invoice?.status !== 'cancelled') {
      nextActions.push({
        label: 'Edytuj',
        icon: <Edit className="h-4 w-4" />,
        onClick: () => router.push(`/crm/invoices/${invoice!.id}/edit`),
        variant: 'default',
      });
    }

    if (!pdfPath) {
      nextActions.push({
        label: generating ? 'Generowanie...' : 'Generuj PDF',
        icon: generating ? (
          <Loader className="h-4 w-4 animate-spin" />
        ) : (
          <FileDown className="h-4 w-4" />
        ),
        onClick: handleGeneratePDF,
        variant: 'primary',
      });
    } else {
      nextActions.push(
        {
          label: generating ? 'Regenerowanie...' : 'Regeneruj PDF',
          icon: generating ? (
            <Loader className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          ),
          onClick: handleGeneratePDF,
          variant: 'default',
        },
        {
          label: 'Podgląd PDF',
          icon: <Eye className="h-4 w-4" />,
          onClick: handlePreviewPDF,
          variant: 'default',
        },
        {
          label: 'Pobierz PDF',
          icon: <Download className="h-4 w-4" />,
          onClick: handleDownloadPDF,
          variant: 'default',
        },
        {
          label: 'Drukuj',
          icon: <Printer className="h-4 w-4" />,
          onClick: handlePrintPDF,
          variant: 'default',
        },
      );
    }

    if (invoice?.status !== 'cancelled') {
      nextActions.push({
        label: emailButtonLabel,
        icon: <Send className="h-4 w-4" />,
        onClick: handleSendEmail,
        variant: 'default',
      });
    }

    const normalizedKsefStatus = invoice?.ksef_status?.trim().toLowerCase() || '';
    const ksefSubmissionInProgressOrFinished =
      ['pending', 'sent', 'accepted'].includes(normalizedKsefStatus) ||
      Boolean(invoice?.ksef_reference_number) ||
      completedKsefSend?.invoiceId === invoice?.id;
    const canSendToKSeF =
      financeAccess?.canIssueInvoices &&
      !invoice?.is_proforma &&
      invoice?.invoice_type !== 'proforma' &&
      invoice?.status !== 'cancelled' &&
      !invoice?.buyer_is_private_person &&
      !ksefSubmissionInProgressOrFinished;

    if (canSendToKSeF) {
      nextActions.push({
        label: normalizedKsefStatus === 'rejected' ? 'Wyślij ponownie do KSeF' : 'Wyślij do KSeF',
        icon: <Send className="h-4 w-4" />,
        onClick: handleSendToKSeF,
        variant: 'primary',
        pin: true,
      });
    }

    return nextActions;
  }, [invoice, router, generating, pdfPath, emailButtonLabel, financeAccess, completedKsefSend, showKSeFModal]);

  if (financeAccessLoading) {
    return <div className="p-6 text-sm text-[#e5e4e2]/60">Sprawdzanie dostępu do faktury…</div>;
  }
  if (financeAccessError || !financeAccess || financeAccess.scope === 'none') {
    return <div role="alert" className="p-6 text-sm text-[#e5e4e2]/70">{financeAccessError || 'Brak dostępu do faktury.'}</div>;
  }
  if (financeAccess.scope === 'sales' && invoice && invoice.created_by !== financeAccess.employeeId && invoice.created_by !== financeAccess.authUserId) {
    return <div role="alert" className="p-6 text-sm text-[#e5e4e2]/70">Możesz otwierać tylko faktury wystawione przez Ciebie.</div>;
  }
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0d1a]">
        <div className="text-[#e5e4e2]/60">Ladowanie...</div>
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0d1a]">
        <div className="text-[#e5e4e2]/60">Faktura nie zostala znaleziona</div>
      </div>
    );
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

  const paymentStatus = invoice.payment_status || (invoice.status === 'paid' ? 'paid' : 'unpaid');
  const paymentDate = invoice.paid_at || invoice.paid_date || null;


  const previewSettlementSummary =
    invoice.settlement_summary ?? finalSettlementPreview?.settlementSummary;

  const previewSettledInvoices =
    invoice.settled_invoices ?? finalSettlementPreview?.settledInvoices ?? [];

  const isFinalInvoicePreview =
    invoice.invoice_type === 'final' || invoice.invoice_number?.startsWith('FKO/');

  const previewAmountToPay = isFinalInvoicePreview
    ? Number(previewSettlementSummary?.remainingGross ?? invoice.total_gross ?? 0)
    : Number(invoice.total_gross ?? 0);

  const companyLogoUrl = invoice?.my_company?.logo_url || invoice?.company_logo_url || null;
  const money = (value: number) => {
    const rounded = Number(value.toFixed(2));
    return Object.is(rounded, -0) ? 0 : rounded;
  };

  const getCorrectionValues = (item: InvoiceItem) => {
    const vatRate = Number(item.vat_rate ?? 0);

    const beforeQty = Number(item.before_quantity ?? 0);
    const beforePrice = Number(item.before_price_net ?? item.price_net ?? 0);
    const beforeNet = money(Number(item.before_value_net ?? beforeQty * beforePrice));
    const beforeVat = money(Number(item.before_vat_amount ?? (beforeNet * vatRate) / 100));
    const beforeGross = money(Number(item.before_value_gross ?? beforeNet + beforeVat));

    const correctionNet = money(Number(item.value_net ?? 0));
    const correctionVat = money(Number(item.vat_amount ?? (correctionNet * vatRate) / 100));
    const correctionGross = money(Number(item.value_gross ?? correctionNet + correctionVat));

    const correctionQty =
      correctionNet !== 0 && beforePrice !== 0
        ? money(Math.abs(correctionNet / beforePrice))
        : Math.abs(Number(item.before_quantity ?? 1));

    const correctionPrice =
      correctionQty !== 0 ? money(correctionNet / correctionQty) : correctionNet;

    return {
      vatRate,

      beforeQty,
      beforePrice,
      beforeNet,
      beforeVat,
      beforeGross,

      correctionQty,
      correctionPrice: -correctionPrice,
      correctionNet: -correctionNet,
      correctionVat: -correctionVat,
      correctionGross: -correctionGross,
    };
  };

  const formatSignedMoney = (value?: number) => {
    const number = Number(value || 0);
    return `${number > 0 ? '+' : ''}${number.toFixed(2)}`;
  };

  // const formatSignedQuantity = (value?: number) => {
  //   const number = Number(value || 0);
  //   if (!number) return '0';
  //   return `${number > 0 ? '+' : ''}${number}`;
  // };
  const paidAmount = Number(invoice.paid_amount ?? 0);
  const isRefund = invoice.invoice_type === 'corrective' && Number(invoice.total_gross ?? 0) < 0;
  const paymentBaseAmount = isRefund ? Math.abs(previewAmountToPay) : previewAmountToPay;
  const footerNote = getPaymentAwareInvoiceFooterNote(invoice.footer_note, {
    paymentStatus,
    amountDue: previewAmountToPay,
    paidAmount,
    isRefund,
  });

  const amountToDisplay =
    paymentStatus === 'paid' || paymentStatus === 'refunded'
      ? paidAmount > 0
        ? paidAmount
        : paymentBaseAmount
      : paymentStatus === 'partially_paid' || paymentStatus === 'partially_refunded'
        ? Math.max(paymentBaseAmount - paidAmount, 0)
        : paymentBaseAmount;

  const canCreateRelatedDocument = !invoice.is_proforma
    && ['issued', 'sent', 'paid', 'overdue'].includes(invoice.status);
  const documentActions: InvoiceDocumentAction[] = [];
  if (canCreateRelatedDocument && invoice.invoice_type === 'advance') {
    documentActions.push(
      {
        label: 'Kolejna faktura zaliczkowa',
        description: 'Nowa zaliczka dla tego samego zamówienia, z osobną kwotą i wpłatą.',
        onClick: () => router.push(`/crm/invoices/new?type=advance&advanceFrom=${invoice.id}`),
      },
      {
        label: 'Faktura końcowa',
        description: 'Rozlicz powiązane zaliczki i ustal pozostałą dopłatę.',
        icon: <CheckCircle className="h-4 w-4" />,
        onClick: () => setShowFinalInvoiceModal(true),
      },
    );
  }
  if (canCreateRelatedDocument && ['vat', 'advance', 'final'].includes(invoice.invoice_type)) {
    documentActions.push({
      label: 'Faktura korygująca',
      description: 'Utwórz osobny dokument korygujący tę fakturę.',
      icon: <Edit className="h-4 w-4" />,
      onClick: () => router.push(`/crm/invoices/new?type=corrective&related=${invoice.id}`),
    });
  }
  if (invoice.is_proforma && invoice.status !== 'cancelled' && !invoice.proforma_converted_to_invoice_id) {
    documentActions.push({
      label: 'Faktura z pro formy',
      description: 'Utwórz fakturę VAT lub zaliczkową na podstawie tej pro formy.',
      onClick: handleConvertToVAT,
    });
  }
  const relationCount = [
    relatedData.event, relatedData.organization, relatedData.serviceRecipientOrganization,
    relatedData.relatedInvoice, ...(relatedData.settlementEvents ?? []), ...(relatedData.relatedInvoices ?? []),
  ].filter(Boolean).length;
  const ksefStatus = invoice.ksef_status?.trim().toLowerCase() || '';
  const ksefLabel = ({
    accepted: 'Zaakceptowana', rejected: 'Odrzucona', sent: 'Wysłana',
    pending: 'W trakcie wysyłki', error: 'Błąd wysyłki', draft: 'Szkic', not_sent: 'Niewysłana',
  } as Record<string, string>)[ksefStatus] || 'Status do sprawdzenia';

  return (
    <PermissionGuard module={financeAccess.scope === 'sales' ? undefined : 'invoices'}>
      <div className="min-h-screen bg-[#0a0d1a] p-6">
        <div className="mx-auto max-w-5xl">
          <button
            onClick={() => router.push('/crm/invoices')}
            className="mb-4 flex items-center gap-2 text-sm text-[#e5e4e2]/60 hover:text-[#d3bb73] print:hidden"
          >
            <ArrowLeft className="h-5 w-5" />
            Powrót
          </button>

          <section className="mb-5 rounded-xl bg-[#1c1f33] p-4 sm:p-5 print:hidden" aria-label="Informacje i akcje faktury">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="mb-1 text-xs text-[#e5e4e2]/55">{getTypeLabel(invoice.invoice_type, invoice.invoice_number)}</p>
                <h1 className="break-words text-2xl font-light uppercase text-[#e5e4e2] sm:text-3xl">
                  {invoice.invoice_number}
                </h1>
                <p className="mt-1 max-w-lg truncate text-sm text-[#e5e4e2]/60" title={invoice.buyer_name}>
                  {invoice.buyer_name}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <InvoiceDocumentActionsMenu actions={documentActions} />
                <ResponsiveActionBar disabledBackground compact actions={actions} mobileBreakpoint={900} />
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
              {paymentStatus === 'paid' && <span className="inline-flex items-center gap-1.5 text-emerald-300"><CheckCircle className="h-3.5 w-3.5" />Opłacona</span>}
              {pdfPath && <span className="inline-flex items-center gap-1.5 text-[#e5e4e2]/55"><FileText className="h-3.5 w-3.5" />PDF gotowy</span>}
              {emailSentCount > 0 && <span className="text-[#e5e4e2]/55">Wysłano e-mail: {emailSentCount}×</span>}
              {!invoice.is_proforma && invoice.related_invoice_id && (
                <button
                  type="button"
                  onClick={() => router.push(`/crm/invoices/${invoice.related_invoice_id}`)}
                  className="inline-flex items-center gap-1.5 text-[#d3bb73] hover:text-[#e5e4e2]"
                >
                  <LinkIcon className="h-3.5 w-3.5" />
                  {invoice.invoice_type === 'corrective' ? 'Dokument korygowany' : relatedData.relatedInvoice?.invoice_type === 'proforma' ? 'Pro forma' : 'Dokument źródłowy'}
                  {relatedData.relatedInvoice?.invoice_number && `: ${relatedData.relatedInvoice.invoice_number}`}
                </button>
              )}
              {relationCount > 0 && (
                <button
                  type="button"
                  onClick={() => setShowRelations((previous) => !previous)}
                  aria-expanded={showRelations}
                  aria-controls="invoice-relations"
                  className="inline-flex items-center gap-1.5 text-[#d3bb73] hover:text-[#e5e4e2]"
                >
                  Powiązania ({relationCount})
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showRelations ? 'rotate-180' : ''}`} />
                </button>
              )}
              {(ksefStatus || invoice.ksef_reference_number) && (
                <button
                  type="button"
                  onClick={() => setShowKsefDetails((previous) => !previous)}
                  aria-expanded={showKsefDetails}
                  aria-controls="invoice-ksef-details"
                  className={`inline-flex items-center gap-1.5 ${ksefStatus === 'accepted' ? 'text-emerald-300' : ['rejected', 'error'].includes(ksefStatus) ? 'text-red-300' : 'text-[#d3bb73]'}`}
                >
                  {ksefStatus === 'accepted' ? <CheckCircle className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
                  KSeF: {ksefLabel}
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showKsefDetails ? 'rotate-180' : ''}`} />
                </button>
              )}
            </div>

            {invoice.is_proforma && (
              <p className="mt-3 text-xs text-[#e5e4e2]/55">
                Pro forma nie jest wysyłana do KSeF.
                {invoice.proforma_converted_to_invoice_id && (
                  <button type="button" onClick={() => router.push(`/crm/invoices/${invoice.proforma_converted_to_invoice_id}`)} className="ml-2 text-[#d3bb73] hover:underline">Zobacz wystawioną fakturę</button>
                )}
              </p>
            )}
            {showKsefDetails && (
              <div id="invoice-ksef-details" className="mt-3 flex flex-wrap items-start justify-between gap-3 rounded-lg bg-black/15 p-3 text-xs text-[#e5e4e2]/65">
                <div>
                  <span className="block text-[#e5e4e2]/45">Numer KSeF</span>
                  <span className="mt-1 block break-all select-text">{invoice.ksef_reference_number || 'Jeszcze nie nadano'}</span>
                </div>
                {invoice.ksef_sent_at && <div><span className="block text-[#e5e4e2]/45">Data wysyłki</span><span className="mt-1 block">{new Date(invoice.ksef_sent_at).toLocaleString('pl-PL')}</span></div>}
              </div>
            )}
            {invoice.ksef_error && <p role="alert" className="mt-3 rounded-lg bg-red-500/10 p-3 text-sm text-red-300">{invoice.ksef_error}</p>}
            {canonicalBankPayment && (
              <details className="mt-3 text-xs text-emerald-200">
                <summary className="cursor-pointer">{formatCanonicalBankPayment(canonicalBankPayment)}</summary>
                <p className="mt-2 text-[#e5e4e2]/55">Potwierdzone dopasowanie przez powiązaną fakturę KSeF. Nie jest dodawane do ręcznych oznaczeń płatności; dane wystawionego dokumentu pozostają bez zmian.</p>
              </details>
            )}
            {bankPaymentReadError && <p role="status" className="mt-3 text-xs text-amber-200">Nie udało się odczytać dopasowań do wyciągu przez KSeF. Nie oznacza to braku zapłaty.</p>}
          </section>

          {showRelations && (relatedData.event ||
            relatedData.organization ||
            relatedData.serviceRecipientOrganization ||
            relatedData.relatedInvoice ||
            (relatedData.settlementEvents && relatedData.settlementEvents.length > 0) ||
            (relatedData.relatedInvoices && relatedData.relatedInvoices.length > 0)) && (
            <div id="invoice-relations" className="mb-5 overflow-hidden rounded-xl bg-[#1c1f33] print:hidden">
              {showRelations && (
                <div className="p-4">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {relatedData.event && (
                      <button
                        type="button"
                        onClick={() => router.push(`/crm/events/${relatedData.event!.id}`)}
                        className="flex items-center gap-3 rounded-lg border border-[#d3bb73]/10 bg-[#0a0d1a] p-3 text-left transition-colors hover:border-[#d3bb73]/40"
                      >
                        <Calendar className="h-4 w-4 shrink-0 text-blue-400" />
                        <div className="min-w-0">
                          <div className="text-[11px] uppercase tracking-wide text-[#e5e4e2]/40">
                            Event
                          </div>
                          <div className="truncate text-sm font-medium text-[#e5e4e2]">
                            {relatedData.event.name}
                          </div>
                          <div className="text-xs text-[#e5e4e2]/50">
                            {new Date(relatedData.event.event_date).toLocaleDateString('pl-PL')}
                          </div>
                        </div>
                      </button>
                    )}

                    {relatedData.settlementEvents?.map((settlementEvent) => (
                      <button
                        key={settlementEvent.id}
                        type="button"
                        onClick={() => router.push(`/crm/events/${settlementEvent.id}`)}
                        className="flex items-center gap-3 rounded-lg border border-sky-400/15 bg-sky-400/5 p-3 text-left transition-colors hover:border-sky-300/40"
                      >
                        <LinkIcon className="h-4 w-4 shrink-0 text-sky-300" />
                        <div className="min-w-0">
                          <div className="text-[11px] uppercase tracking-wide text-sky-300/70">
                            Wspólne rozliczenie
                          </div>
                          <div className="truncate text-sm font-medium text-[#e5e4e2]">
                            {settlementEvent.name}
                          </div>
                          <div className="text-xs text-[#e5e4e2]/50">
                            {settlementEvent.event_date
                              ? new Date(settlementEvent.event_date).toLocaleDateString('pl-PL')
                              : 'Termin nieustalony'}{' '}
                            ·{' '}
                            udział {settlementEvent.allocated_gross.toLocaleString('pl-PL', {
                              minimumFractionDigits: 2,
                            })}{' '}
                            zł
                          </div>
                        </div>
                      </button>
                    ))}

                    {relatedData.organization && (
                      <button
                        type="button"
                        onClick={() => router.push(`/crm/contacts/${relatedData.organization!.id}`)}
                        className="flex items-center gap-3 rounded-lg border border-[#d3bb73]/10 bg-[#0a0d1a] p-3 text-left transition-colors hover:border-[#d3bb73]/40"
                      >
                        <Building2 className="h-4 w-4 shrink-0 text-[#d3bb73]" />
                        <div className="min-w-0">
                          <div className="text-[11px] uppercase tracking-wide text-[#e5e4e2]/40">
                            {invoice.billing_arrangement === 'direct'
                              ? 'Organizacja'
                              : 'Nabywca i płatnik faktury'}
                          </div>
                          <div className="truncate text-sm font-medium text-[#e5e4e2]">
                            {relatedData.organization.name}
                          </div>
                          {relatedData.organization.nip && (
                            <div className="text-xs text-[#e5e4e2]/50">
                              NIP: {relatedData.organization.nip}
                            </div>
                          )}
                        </div>
                      </button>
                    )}

                    {relatedData.serviceRecipientOrganization && (
                      <button
                        type="button"
                        onClick={() =>
                          router.push(
                            `/crm/contacts/${relatedData.serviceRecipientOrganization!.id}`,
                          )
                        }
                        className="flex items-center gap-3 rounded-lg border border-sky-400/20 bg-sky-400/5 p-3 text-left transition-colors hover:border-sky-400/40"
                      >
                        <Building2 className="h-4 w-4 shrink-0 text-sky-300" />
                        <div className="min-w-0">
                          <div className="text-[11px] uppercase tracking-wide text-sky-200/60">
                            Klient wydarzenia
                          </div>
                          <div className="truncate text-sm font-medium text-[#e5e4e2]">
                            {relatedData.serviceRecipientOrganization.name}
                          </div>
                          <div className="text-xs text-[#e5e4e2]/50">
                            {invoice.billing_arrangement === 'hotel'
                              ? 'Płatność realizowana przez hotel'
                              : invoice.billing_arrangement === 'agency'
                                ? 'Płatność realizowana przez agencję'
                                : 'Płatność realizowana przez inną organizację'}
                          </div>
                        </div>
                      </button>
                    )}

                    {relatedData.relatedInvoice && (
                      <button
                        type="button"
                        onClick={() =>
                          router.push(`/crm/invoices/${relatedData.relatedInvoice!.id}`)
                        }
                        className="flex items-center gap-3 rounded-lg border border-[#d3bb73]/10 bg-[#0a0d1a] p-3 text-left transition-colors hover:border-[#d3bb73]/40"
                      >
                        <FileText className="h-4 w-4 shrink-0 text-orange-400" />
                        <div className="min-w-0">
                          <div className="text-[11px] uppercase tracking-wide text-[#e5e4e2]/40">
                            Powiązana faktura
                          </div>
                          <div className="truncate text-sm font-medium text-[#e5e4e2]">
                            {relatedData.relatedInvoice.invoice_number}
                          </div>
                          <div className="text-xs text-[#e5e4e2]/50">
                            {getTypeLabel(
                              relatedData.relatedInvoice.invoice_type,
                              relatedData.relatedInvoice.invoice_number,
                            )}
                          </div>
                        </div>
                      </button>
                    )}

                    {relatedData.relatedInvoices && relatedData.relatedInvoices.length > 0 && (
                      <div className="rounded-lg border border-[#d3bb73]/10 bg-[#0a0d1a] p-3">
                        <div className="mb-2 flex items-center gap-2">
                          <FileText className="h-4 w-4 text-orange-400" />
                          <div className="text-[11px] uppercase tracking-wide text-[#e5e4e2]/40">
                            Powiązane faktury
                          </div>
                        </div>

                        <div className="space-y-1">
                          {relatedData.relatedInvoices.map((rel) => (
                            <button
                              key={rel.id}
                              type="button"
                              onClick={() => router.push(`/crm/invoices/${rel.id}`)}
                              className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[#d3bb73]/10"
                            >
                              <span className="truncate text-sm font-medium text-[#e5e4e2]">
                                {rel.invoice_number}
                              </span>
                              <span className="shrink-0 text-xs text-[#e5e4e2]/50">
                                {getTypeLabel(rel.invoice_type, rel.invoice_number)}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="mt-4">
                    {invoice.invoice_type === 'corrective' && (
                      <div className="mb-6 rounded-xl border border-orange-500/30 bg-orange-500/10 p-6">
                        <h3 className="mb-4 text-lg font-medium text-orange-400">
                          Faktura korygujaca
                        </h3>
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                          <div>
                            <div className="mb-1 text-xs text-[#e5e4e2]/40">Faktura korygowana</div>
                            {invoice.corrected_invoice_number ? (
                              <button
                                onClick={() =>
                                  invoice.related_invoice_id &&
                                  router.push(`/crm/invoices/${invoice.related_invoice_id}`)
                                }
                                className="font-medium text-[#d3bb73] hover:underline"
                              >
                                {invoice.corrected_invoice_number}
                              </button>
                            ) : (
                              <div className="text-[#e5e4e2]/60">-</div>
                            )}
                          </div>
                          <div>
                            <div className="mb-1 text-xs text-[#e5e4e2]/40">
                              Data wystawienia korygowanej
                            </div>
                            <div className="text-[#e5e4e2]">
                              {invoice.corrected_invoice_issue_date
                                ? new Date(invoice.corrected_invoice_issue_date).toLocaleDateString(
                                    'pl-PL',
                                  )
                                : '-'}
                            </div>
                          </div>
                          <div>
                            <div className="mb-1 text-xs text-[#e5e4e2]/40">
                              Nr KSeF korygowanej
                            </div>
                            <div className="text-[#e5e4e2]">
                              {invoice.corrected_invoice_ksef_number || 'Nie wyslano do KSeF'}
                            </div>
                          </div>
                          <div>
                            <div className="mb-1 text-xs text-[#e5e4e2]/40">Zakres korekty</div>
                            <div className="text-[#e5e4e2]">
                              {invoice.correction_scope === 'full'
                                ? 'Calosc faktury'
                                : 'Czesc faktury'}
                            </div>
                          </div>
                        </div>
                        {invoice.correction_reason && (
                          <div className="mt-4">
                            <div className="mb-1 text-xs text-[#e5e4e2]/40">Przyczyna korekty</div>
                            <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-3 text-sm text-[#e5e4e2]">
                              {invoice.correction_reason}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          <div
            className="invoice-preview mx-auto mb-6 flex flex-col rounded-xl bg-white text-black"
            style={{ width: '794px', minHeight: '1123px', padding: '42px 48px' }}
          >
            <div className="-mx-12 -mt-[42px] mb-6 bg-gray-100 py-1.5 text-center text-xs font-bold uppercase tracking-[0.15em] text-gray-600">
              {invoice.is_proforma || invoice.invoice_type === 'proforma' ? 'Wizualizacja pro formy' : 'Wizualizacja faktury'}
            </div>
            <div className="mb-6 flex items-start justify-between">
              <div className="flex items-center gap-4">
                {companyLogoUrl ? (
                  <Image
                    width={256}
                    height={256}
                    src={`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/company-logos/${companyLogoUrl}`}
                    alt="Logo firmy"
                    className="max-h-32 max-w-[300px] object-contain"
                  />
                ) : null}
              </div>
              <div className="space-y-2 text-right text-xs leading-tight">
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-gray-500">
                    Miejsce wystawienia
                  </div>
                  <div className="font-medium text-black">{invoice.issue_place}</div>
                </div>

                <div>
                  <div className="text-[10px] uppercase tracking-wide text-gray-500">
                    Data wystawienia
                  </div>
                  <div className="font-medium text-black">
                    {new Date(invoice.issue_date).toLocaleDateString('pl-PL')}
                  </div>
                </div>

                <div>
                  <div className="text-[10px] uppercase tracking-wide text-gray-500">
                    Data sprzedaży
                  </div>
                  <div className="font-medium text-black">
                    {new Date(invoice.sale_date).toLocaleDateString('pl-PL')}
                  </div>
                </div>
              </div>
            </div>

            <div className="mb-3 grid grid-cols-2 gap-8 text-sm leading-snug">
              <div>
                <div className="mb-2 text-sm text-gray-600">Sprzedawca</div>
                <div className="font-medium">{invoice.seller_name}</div>
                <div className="text-sm">NIP: {invoice.seller_nip}</div>
                <div className="text-sm">{invoice.seller_street}</div>
                <div className="text-sm">
                  {invoice.seller_postal_code} {invoice.seller_city}
                </div>
              </div>
              <div>
                <div className="mb-2 text-sm text-gray-600">Nabywca</div>
                <div className="font-medium">{invoice.buyer_name}</div>
                {invoice.buyer_nip && <div className="text-sm">NIP: {invoice.buyer_nip}</div>}
                <div className="text-sm">{invoice.buyer_street}</div>
                <div className="text-sm">
                  {invoice.buyer_postal_code} {invoice.buyer_city}
                </div>
              </div>
            </div>

            <div className="mb-2 text-center">
              <div className="text-2xl font-bold">
                {getTypeLabel(invoice.invoice_type, invoice.invoice_number)}{' '}
                {invoice.invoice_number}
              </div>
            </div>

            {invoice.invoice_type === 'corrective' &&
            items.some((i) => i.before_quantity != null) ? (
              <div className="mb-8">
                {invoice.corrected_invoice_number && (
                  <div className="mb-4 text-center text-sm">
                    Dotyczy:{' '}
                    {relatedData.relatedInvoice?.invoice_type === 'final'
                      ? 'Faktura koncowa'
                      : 'Faktura'}{' '}
                    {invoice.corrected_invoice_number} z dnia:{' '}
                    {invoice.corrected_invoice_issue_date
                      ? new Date(invoice.corrected_invoice_issue_date).toLocaleDateString('pl-PL')
                      : '-'}
                  </div>
                )}
                <table className="mb-4 w-full text-sm">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="border border-gray-300 px-1.5 py-1 text-left">Lp.</th>
                      <th className="border border-gray-300 px-1.5 py-1 text-left">
                        Nazwa towaru lub uslugi
                      </th>
                      <th className="border border-gray-300 px-1.5 py-1">Jm.</th>
                      <th className="border border-gray-300 px-1.5 py-1">Ilosc</th>
                      <th className="border border-gray-300 px-1.5 py-1">Cena netto</th>
                      <th className="border border-gray-300 px-1.5 py-1">Wartosc netto</th>
                      <th className="border border-gray-300 px-1.5 py-1">Stawka VAT</th>
                      <th className="border border-gray-300 px-1.5 py-1">Kwota VAT</th>
                      <th className="border border-gray-300 px-1.5 py-1">Wartosc brutto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => {
                      const correction = getCorrectionValues(item);
                      return (
                        <tr key={item.id} className="group">
                          <td className="border border-gray-300 px-1.5 py-1 align-top" rowSpan={3}>
                            {item.position_number}
                          </td>
                          <td colSpan={8} className="border border-gray-300 p-0">
                            <table className="w-full">
                              <tbody>
                                <tr>
                                  <td className="border-b border-gray-200 px-1.5 py-1 text-left">
                                    <span className="text-xs text-gray-500">Przed korektą:</span>
                                    <br />
                                    {item.name}
                                  </td>

                                  <td className="w-[50px] border-b border-gray-200 px-1.5 py-1 text-center">
                                    {item.unit}
                                  </td>

                                  <td className="w-[60px] border-b border-gray-200 px-1.5 py-1 text-right">
                                    {correction.beforeQty}
                                  </td>

                                  <td className="w-[80px] border-b border-gray-200 px-1.5 py-1 text-right">
                                    {correction.beforePrice.toFixed(2)}
                                  </td>

                                  <td className="w-[90px] border-b border-gray-200 px-1.5 py-1 text-right">
                                    {correction.beforeNet.toFixed(2)}
                                  </td>

                                  <td className="w-[50px] border-b border-gray-200 px-1.5 py-1 text-center">
                                    {item.vat_rate}%
                                  </td>

                                  <td className="w-[80px] border-b border-gray-200 px-1.5 py-1 text-right">
                                    {correction.beforeVat.toFixed(2)}
                                  </td>

                                  <td className="w-[90px] border-b border-gray-200 px-1.5 py-1 text-right">
                                    {correction.beforeGross.toFixed(2)}
                                  </td>
                                </tr>

                                <tr>
                                  <td className="border-b border-gray-200 px-1.5 py-1 text-left">
                                    <span className="text-xs text-gray-500">Korekta:</span>
                                    <br />
                                    {item.name}
                                  </td>

                                  <td className="border-b border-gray-200 px-1.5 py-1 text-center">
                                    {item.unit}
                                  </td>

                                  <td className="border-b border-gray-200 px-1.5 py-1 text-right">
                                    {correction.correctionQty}
                                  </td>

                                  <td className="border-b border-gray-200 px-1.5 py-1 text-right">
                                    {correction.correctionPrice < 0 ? '' : '-'}
                                    {Math.abs(correction.correctionPrice).toFixed(2)}
                                  </td>

                                  <td className="border-b border-gray-200 px-1.5 py-1 text-right">
                                    {correction.correctionNet < 0 ? '' : '-'}
                                    {Math.abs(correction.correctionNet).toFixed(2)}
                                  </td>

                                  <td className="border-b border-gray-200 px-1.5 py-1 text-center">
                                    {item.vat_rate}%
                                  </td>

                                  <td className="border-b border-gray-200 px-1.5 py-1 text-right">
                                    {correction.correctionVat < 0 ? '' : '-'}
                                    {Math.abs(correction.correctionVat).toFixed(2)}
                                  </td>

                                  <td className="border-b border-gray-200 px-1.5 py-1 text-right">
                                    {correction.correctionGross < 0 ? '' : '-'}
                                    {Math.abs(correction.correctionGross).toFixed(2)}
                                  </td>
                                </tr>
                                {/* <tr className="bg-gray-50 font-medium">
                                  <td className="px-1.5 py-1 text-left">
                                    <span className="text-xs">Korekta</span>
                                  </td>
                                  <td className="px-1.5 py-1 text-center"></td>
                                  <td className="px-1.5 py-1 text-right">
                                    {formatSignedQuantity(correction.correctionQty)}
                                  </td>
                                  <td className="px-1.5 py-1 text-right">
                                    {formatSignedMoney(correction.correctionPrice)}
                                  </td>
                                  <td className="px-1.5 py-1 text-right">
                                    {item.value_net.toFixed(2)}
                                  </td>
                                  <td className="px-1.5 py-1 text-center">{item.vat_rate}%</td>
                                  <td className="px-1.5 py-1 text-right">
                                    {item.vat_amount.toFixed(2)}
                                  </td>
                                  <td className="px-1.5 py-1 text-right">
                                    {item.value_gross.toFixed(2)}
                                  </td>
                                </tr> */}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {(() => {
                  const totalBeforeNet = items.reduce(
                    (sum, i) => sum + (i.before_quantity ?? 0) * (i.before_price_net ?? 0),
                    0,
                  );
                  const totalAfterNet = items.reduce((sum, i) => {
                    const aq = i.after_quantity ?? i.before_quantity ?? 0;
                    const ap = i.after_price_net ?? i.before_price_net ?? 0;
                    return sum + aq * ap;
                  }, 0);
                  const totalBeforeVat = items.reduce(
                    (sum, i) =>
                      sum +
                      Math.round(
                        (i.before_quantity ?? 0) * (i.before_price_net ?? 0) * i.vat_rate,
                      ) /
                        100,
                    0,
                  );
                  const totalAfterVat = items.reduce((sum, i) => {
                    const aq = i.after_quantity ?? i.before_quantity ?? 0;
                    const ap = i.after_price_net ?? i.before_price_net ?? 0;
                    return sum + Math.round(aq * ap * i.vat_rate) / 100;
                  }, 0);
                  const totalBeforeGross = totalBeforeNet + totalBeforeVat;
                  const totalAfterGross = totalAfterNet + totalAfterVat;
                  return (
                    <table className="mb-4 ml-auto w-auto text-sm">
                      <tbody>
                        <tr className="font-medium">
                          <td className="border border-gray-300 bg-gray-100 px-3 py-1 text-right">
                            Przed korektą:
                          </td>
                          <td className="border border-gray-300 px-3 py-1 text-right">
                            {totalBeforeNet.toFixed(2)}
                          </td>
                          <td className="border border-gray-300 px-3 py-1 text-right">
                            {totalBeforeVat.toFixed(2)}
                          </td>
                          <td className="border border-gray-300 px-3 py-1 text-right">
                            {totalBeforeGross.toFixed(2)}
                          </td>
                        </tr>
                        <tr className="font-medium">
                          <td className="border border-gray-300 bg-gray-100 px-3 py-1 text-right">
                            Korekta:
                          </td>
                          <td className="border border-gray-300 px-3 py-1 text-right">
                            {invoice.total_net.toFixed(2)}
                          </td>
                          <td className="border border-gray-300 px-3 py-1 text-right">
                            {invoice.total_vat.toFixed(2)}
                          </td>
                          <td className="border border-gray-300 px-3 py-1 text-right">
                            {invoice.total_gross.toFixed(2)}
                          </td>
                        </tr>
                        <tr className="font-bold">
                          <td className="border border-gray-300 bg-gray-100 px-3 py-1 text-right">
                            Po korekcie:
                          </td>
                          <td className="border border-gray-300 px-3 py-1 text-right">
                            {totalAfterNet.toFixed(2)}
                          </td>
                          <td className="border border-gray-300 px-3 py-1 text-right">
                            {totalAfterVat.toFixed(2)}
                          </td>
                          <td className="border border-gray-300 px-3 py-1 text-right">
                            {totalAfterGross.toFixed(2)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  );
                })()}

                <div className="border border-gray-300 bg-gray-100 p-3 text-sm font-bold">
                  <div className="flex justify-between">
                    <span>{invoice.total_gross < 0 ? 'Razem do zwrotu:' : 'Suma korekt:'}</span>
                    <span>{formatSignedMoney(invoice.total_gross)} PLN</span>
                  </div>
                </div>
              </div>
            ) : (
              <table className="mb-8 w-full text-sm">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="border border-gray-300 px-1.5 py-1 text-left">Lp.</th>
                    <th className="border border-gray-300 px-1.5 py-1 text-left">
                      Nazwa towaru lub uslugi
                    </th>
                    <th className="border border-gray-300 px-1.5 py-1">Jm.</th>
                    <th className="border border-gray-300 px-1.5 py-1">Ilosc</th>
                    <th className="border border-gray-300 px-1.5 py-1">Cena netto</th>
                    <th className="border border-gray-300 px-1.5 py-1">Wartosc netto</th>
                    <th className="border border-gray-300 px-1.5 py-1">Stawka VAT</th>
                    <th className="border border-gray-300 px-1.5 py-1">Kwota VAT</th>
                    <th className="border border-gray-300 px-1.5 py-1">Wartosc brutto</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td className="border border-gray-300 px-1.5 py-1">{item.position_number}</td>
                      <td className="border border-gray-300 px-1.5 py-1">{item.name}</td>
                      <td className="border border-gray-300 px-1.5 py-1 text-center">
                        {item.unit}
                      </td>
                      <td className="border border-gray-300 px-1.5 py-1 text-right">
                        {item.quantity}
                      </td>
                      <td className="border border-gray-300 px-1.5 py-1 text-right">
                        {item.price_net.toFixed(2)}
                      </td>
                      <td className="border border-gray-300 px-1.5 py-1 text-right">
                        {item.value_net.toFixed(2)}
                      </td>
                      <td className="border border-gray-300 px-1.5 py-1 text-center">
                        {item.vat_rate}%
                      </td>
                      <td className="border border-gray-300 px-1.5 py-1 text-right">
                        {item.vat_amount.toFixed(2)}
                      </td>
                      <td className="border border-gray-300 px-1.5 py-1 text-right font-medium">
                        {item.value_gross.toFixed(2)}
                      </td>
                    </tr>
                  ))}

                  <tr className="bg-gray-100 font-bold">
                    <td colSpan={5} className="border border-gray-300 px-1.5 py-1 text-right">
                      Razem
                    </td>
                    <td className="border border-gray-300 px-1.5 py-1 text-right">
                      {invoice.total_net.toFixed(2)}
                    </td>
                    <td className="border border-gray-300 px-1.5 py-1"></td>
                    <td className="border border-gray-300 px-1.5 py-1 text-right">
                      {invoice.total_vat.toFixed(2)}
                    </td>
                    <td className="border border-gray-300 px-1.5 py-1 text-right">
                      {invoice.total_gross.toFixed(2)}
                    </td>
                  </tr>
                </tbody>
              </table>
            )}

            {previewSettledInvoices.length > 0 && (
              <div className="mb-4 text-sm">
                <div className="mb-2 font-bold">Rozliczane faktury zaliczkowe</div>

                <div className="overflow-hidden border border-gray-300">
                  {previewSettledInvoices.map((inv) => (
                    <div
                      key={inv.id || inv.invoiceNumber}
                      className="flex justify-between border-b border-gray-300 px-2 py-1 last:border-b-0"
                    >
                      <span>
                        {inv.invoiceNumber}
                        {inv.issueDate
                          ? ` z dnia ${new Date(inv.issueDate).toLocaleDateString('pl-PL')}`
                          : ''}
                      </span>
                      <span className="font-medium">
                        {Number(inv.totalGross || 0).toFixed(2)} PLN brutto
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {previewSettlementSummary && (
              <div className="mb-8 text-sm">
                <div className="mb-2 font-bold">Rozliczenie zaliczek</div>

                <table className="w-full text-sm">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="border border-gray-300 p-2 text-left">Opis</th>
                      <th className="border border-gray-300 p-2 text-right">Netto</th>
                      <th className="border border-gray-300 p-2 text-right">VAT</th>
                      <th className="border border-gray-300 p-2 text-right">Brutto</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="border border-gray-300 p-2">Wartość faktury końcowej</td>
                      <td className="border border-gray-300 p-2 text-right">
                        {previewSettlementSummary.invoiceTotalNet.toFixed(2)}
                      </td>
                      <td className="border border-gray-300 p-2 text-right">
                        {previewSettlementSummary.invoiceTotalVat.toFixed(2)}
                      </td>
                      <td className="border border-gray-300 p-2 text-right font-medium">
                        {previewSettlementSummary.invoiceTotalGross.toFixed(2)}
                      </td>
                    </tr>

                    <tr>
                      <td className="border border-gray-300 p-2">Rozliczone zaliczki</td>
                      <td className="border border-gray-300 p-2 text-right">
                        {previewSettlementSummary.settledNet.toFixed(2)}
                      </td>
                      <td className="border border-gray-300 p-2 text-right">
                        {previewSettlementSummary.settledVat.toFixed(2)}
                      </td>
                      <td className="border border-gray-300 p-2 text-right font-medium">
                        {previewSettlementSummary.settledGross.toFixed(2)}
                      </td>
                    </tr>

                    <tr className="bg-gray-100 font-bold">
                      <td className="border border-gray-300 p-2">Pozostało do zapłaty</td>
                      <td className="border border-gray-300 p-2 text-right">
                        {previewSettlementSummary.remainingNet.toFixed(2)}
                      </td>
                      <td className="border border-gray-300 p-2 text-right">
                        {previewSettlementSummary.remainingVat.toFixed(2)}
                      </td>
                      <td className="border border-gray-300 p-2 text-right">
                        {previewSettlementSummary.remainingGross.toFixed(2)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            <div className="mb-5 grid grid-cols-2 gap-8 text-xs leading-snug">
              <div>
                <div className="mb-2">
                  <span className="text-gray-600">Sposob platnosci:</span> {invoice.payment_method}
                </div>
                <div className="mb-2">
                  <span className="text-gray-600">Termin platnosci:</span>{' '}
                  {new Date(invoice.payment_due_date).toLocaleDateString('pl-PL')}
                </div>
                <div className="mb-2">
                  <span className="text-gray-600">Status płatności:</span>{' '}
                  {paymentStatus === 'refunded'
                    ? `Zwrot wykonany${paymentDate ? ` (${new Date(paymentDate).toLocaleDateString('pl-PL')})` : ''}`
                    : paymentStatus === 'partially_refunded'
                      ? `Częściowo zwrócono: ${paidAmount.toFixed(2)} ${invoice.currency_code || 'PLN'}`
                      : paymentStatus === 'refund_due'
                        ? 'Do zwrotu nabywcy'
                  : paymentStatus === 'paid'
                    ? `Zapłacono${paymentDate ? ` (${new Date(paymentDate).toLocaleDateString('pl-PL')})` : ''}`
                    : paymentStatus === 'partially_paid'
                      ? `Częściowo zapłacono: ${paidAmount.toFixed(2)} ${invoice.currency_code || 'PLN'}`
                      : 'Do zapłaty'}
                </div>
                <div>
                  <span className="text-gray-600">Numer konta:</span>
                  <div className="font-mono">{invoice.bank_account}</div>
                </div>
                <div>
                  <span className="text-gray-600">Nazwa banku:</span>
                  <div className="font-mono">{invoice.bank_name}</div>
                </div>
              </div>
              <div>
                <div className="mb-2">
                  <span className="text-gray-600">
                    {invoice.invoice_type === 'corrective'
                      ? isRefund
                        ? paymentStatus === 'refunded'
                          ? 'Zwrócono:'
                          : paymentStatus === 'partially_refunded'
                            ? 'Pozostało do zwrotu:'
                            : 'Do zwrotu:'
                        : 'Kwota korekty:'
                      : paymentStatus === 'paid'
                        ? 'Zapłacono:'
                        : paymentStatus === 'partially_paid'
                          ? 'Pozostało do zapłaty:'
                          : 'Do zapłaty:'}
                  </span>{' '}
                  <span className="text-base font-bold">
                    {amountToDisplay.toFixed(2)} {invoice.currency_code || 'PLN'}
                  </span>
                </div>
              </div>
            </div>

            <div className="mb-5 text-[10px] leading-snug text-gray-600">
              {footerNote && (
                <span style={{ whiteSpace: 'pre-wrap', fontWeight: '700' }}>Uwagi:</span>
              )}{' '}
              {footerNote && (
                <span style={{ whiteSpace: 'pre-wrap' }}>{footerNote}</span>
              )}
            </div>

            <div className="flex justify-end">
              <div className="w-64 border-t border-gray-300 pt-2 text-center text-xs">
                <div className="mb-1 text-sm">
                  {invoiceSignatureName || (issuerPreview?.invoiceId !== invoice.id
                    ? 'Odczytywanie danych wystawcy…'
                    : issuerPreview.error ? 'Nie udało się odczytać danych wystawcy'
                    : 'Brak imienia i nazwiska wystawcy — uzupełnij jego profil')}
                </div>
                <div className="text-[10px] leading-snug text-gray-600">
                  Podpis osoby upoważnionej do wystawienia
                </div>
              </div>
            </div>

            <div className="mt-[auto] text-center text-xs text-gray-500">
              {invoice.website || 'www.mavinci.pl'}
            </div>
          </div>

          {invoice.status !== 'paid' && invoice.status !== 'cancelled' && (
            <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
              <h3 className="mb-4 text-lg font-medium text-[#e5e4e2]">Zmiana statusu</h3>
              <div className="flex gap-3">
                {invoice.status === 'issued' && (
                  <button
                    onClick={() => handleStatusChange('sent')}
                    className="flex items-center gap-2 rounded-lg border border-blue-500/30 bg-blue-500/20 px-4 py-2 text-blue-400 hover:bg-blue-500/30"
                  >
                    <Send className="h-4 w-4" />
                    Oznacz jako wyslana
                  </button>
                )}
                {(invoice.status === 'issued' || invoice.status === 'sent') && (
                  <button
                    onClick={() => handleStatusChange('paid')}
                    className="flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-500/20 px-4 py-2 text-green-400 hover:bg-green-500/30"
                  >
                    <CheckCircle className="h-4 w-4" />
                    Oznacz jako oplacona
                  </button>
                )}
                <button
                  onClick={() => handleStatusChange('cancelled')}
                  className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/20 px-4 py-2 text-red-400 hover:bg-red-500/30"
                >
                  <XCircle className="h-4 w-4" />
                  Anuluj fakture
                </button>
              </div>
            </div>
          )}
        </div>

        <style jsx global>{`
          @media print {
            body * {
              visibility: hidden;
            }

            .invoice-preview,
            .invoice-preview * {
              visibility: visible;
            }

            .invoice-preview {
              position: absolute;
              left: 0;
              top: 0;
              width: 100%;
              min-height: calc(297mm - 27mm);
              margin: 0;
              padding: 0;
              background: white;
              box-shadow: none;
              border-radius: 0;
              box-sizing: border-box;
            }

            @page {
              size: A4;
              margin: 10mm 10mm 17mm;
            }
          }
        `}</style>

        {generating && (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-[#090b13]/85 p-4 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="invoice-pdf-progress-title"
            aria-live="assertive"
          >
            <div className="w-full max-w-md rounded-2xl border border-[#d3bb73]/25 bg-[#1c1f33] p-8 text-center shadow-2xl">
              <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-[#d3bb73]/10">
                <Loader className="h-8 w-8 animate-spin text-[#d3bb73]" />
              </div>
              <h2
                id="invoice-pdf-progress-title"
                className="text-xl font-semibold text-[#e5e4e2]"
              >
                {pdfPath ? 'Regenerowanie dokumentu PDF' : 'Generowanie dokumentu PDF'}
              </h2>
              <p className="mt-3 text-sm leading-6 text-[#e5e4e2]/65">
                Pobieramy aktualne dane faktury, przygotowujemy strony i zapisujemy dokument.
              </p>
              <div className="mt-6 h-1.5 overflow-hidden rounded-full bg-black/30">
                <div className="h-full w-1/2 animate-pulse rounded-full bg-[#d3bb73]" />
              </div>
              <p className="mt-4 text-xs text-[#e5e4e2]/45">
                Operacja może potrwać kilkanaście sekund. Nie zamykaj tego okna.
              </p>
            </div>
          </div>
        )}

        {showConvertProformaModal && invoice && (
          <ConvertProformaModal
            proformaId={invoice.id}
            proformaNumber={invoice.invoice_number}
            onClose={() => setShowConvertProformaModal(false)}
            onConverted={(newId) => {
              setShowConvertProformaModal(false);
              router.push(`/crm/invoices/${newId}`);
            }}
          />
        )}
        {showFinalInvoiceModal && invoice && (
          <FinalInvoiceWizardModal
            initialAdvanceInvoiceId={invoice.id}
            onClose={() => setShowFinalInvoiceModal(false)}
            onCreated={(newId) => {
              setShowFinalInvoiceModal(false);
              router.push(`/crm/invoices/${newId}`);
            }}
          />
        )}
        {showSendEmailModal && invoice && (
          <SendInvoiceEmailModal
            invoiceId={invoice.id}
            invoiceNumber={invoice.invoice_number}
            clientEmail={relatedData.organization?.email || relatedData.primaryContact?.email || ''}
            clientName={relatedData.organization?.name || relatedData.primaryContact?.name || ''}
            pdfStoragePath={pdfPath}
            onClose={() => setShowSendEmailModal(false)}
            onSent={() => {
              showSnackbar('Faktura wyslana', 'success');
              setEmailSentCount((prev) => prev + 1);
            }}
          />
        )}
        {showKSeFModal && invoice && (
          <KSeFSendModal
            invoiceId={invoice.id}
            invoiceNumber={invoice.invoice_number}
            completedResult={completedKsefSend?.invoiceId === invoice.id ? completedKsefSend.result : null}
            onSuccess={async (result) => {
              await handleKsefSuccess(result);
              await handleGeneratePDF();
            }}
            onError={handleKsefError}
            onClose={() => setShowKSeFModal(false)}
          />
        )}
      </div>
    </PermissionGuard>
  );
}
