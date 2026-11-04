'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import ResponsiveActionBar, { Action } from '@/components/crm/ResponsiveActionBar';
import {
  buildInvoicePdfHtml,
  SettledInvoicePdfRef,
} from '@/components/crm/invoices/helpers/buildInvoicePdfHtml';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { useInvoiceFinanceAccess } from '@/hooks/useInvoiceFinanceAccess';
import { resolveInvoiceIssuerName } from '@/lib/invoices/resolveInvoiceIssuerName';
import { loadCanonicalBankPaymentDisplay, formatCanonicalBankPayment, type CanonicalBankPaymentDisplay } from '@/lib/invoices/canonicalBankPaymentDisplay';
import { getInvoiceKsefRecipient } from '@/lib/invoices/ksefRecipient';
import { getInvoicePartyDataCorrection } from '@/lib/invoices/partyDataCorrection';
import InvoicePrintPreview, { invoicePrintCaption } from '@/components/crm/invoices/print/InvoicePrintPreview';
import { invoicePdfFileName } from '@/lib/invoices/print/invoicePrintData';
import SystemBadge from '@/components/UI/SystemBadge';

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
  payment_status: 'unpaid' | 'partially_paid' | 'paid' | 'overdue' | 'refund_due' | 'partially_refunded' | 'refunded' | 'not_applicable' | null;
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
  buyer_country?: string | null;
  payment_method: string;
  bank_account: string;
  total_net: number;
  total_vat: number;
  total_gross: number;
  currency_code: string;
  issue_place: string;
  pdf_url: string | null;
  pdf_generated_at: string | null;
  updated_at?: string | null;
  event_id: string | null;
  organization_id: string | null;
  billing_arrangement: 'direct' | 'hotel' | 'agency' | 'other';
  service_recipient_organization_id: string | null;
  service_recipient_contact_id: string | null;
  ksef_recipient_snapshot?: unknown;
  buyer_contact_id: string | null;
  related_invoice_id: string | null;
  is_proforma: boolean;
  proforma_converted_to_invoice_id: string | null;
  correction_reason: string | null;
  correction_kind?: 'amount' | 'party_data' | null;
  correction_party_data_before?: unknown;
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
  const recipientPreview = useMemo(() => {
    try {
      return {
        recipient: invoice ? getInvoiceKsefRecipient(invoice) : undefined,
        partyDataBefore: invoice ? getInvoicePartyDataCorrection(invoice) : null,
        error: null,
      };
    } catch (error) {
      return {
        recipient: undefined,
        partyDataBefore: null,
        error: error instanceof Error ? error.message : 'Nie można odczytać danych odbiorcy zapisanych na fakturze.',
      };
    }
  }, [invoice]);
  const invoiceRecipient = recipientPreview.recipient;
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
  const [changingStatus, setChangingStatus] = useState(false);
  const statusChangeInFlight = useRef(false);

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
      if (recipientPreview.error) throw new Error(recipientPreview.error);
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
        buyerCountryCode: ['POLSKA', 'POLAND', ''].includes(String(invoice.buyer_country ?? '').toUpperCase()) ? 'PL' : String(invoice.buyer_country).toUpperCase(),
        recipient: invoiceRecipient,
        totalNet: invoice.total_net,
        totalVat: invoice.total_vat,
        totalGross: invoice.total_gross,
        currencyCode: invoice.currency_code || 'PLN',
        companyLogoUrl: invoice.company_logo_url
          ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/company-logos/${invoice.company_logo_url}`
          : null,
        correctionReason: invoice.correction_reason || undefined,
        correctionKind: invoice.correction_kind,
        correctionPartyDataBefore: recipientPreview.partyDataBefore,
        correctedInvoiceNumber: invoice.corrected_invoice_number || undefined,
        correctedInvoiceIssueDate: invoice.corrected_invoice_issue_date || undefined,
        correctedInvoiceKsefNumber: invoice.corrected_invoice_ksef_number || undefined,
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

    // Bez zapisanego PDF drukujemy aktualny wydruk z serwera (ten sam co w podglądzie).
    const printFromPreview = () => {
      if (!invoice) return;
      const printWindow = window.open(
        `/bridge/invoices/invoice-pdf/preview?invoiceId=${encodeURIComponent(invoice.id)}`,
        '_blank',
      );
      printWindow?.addEventListener('load', () => printWindow.print());
    };

    if (!pdfPath) {
      printFromPreview();
      return;
    }

    try {
      const url = await getSignedUrl(pdfPath);
      if (!url) {
        printFromPreview();
        return;
      }
      const printWindow = window.open(url, '_blank');
      if (printWindow) {
        printWindow.addEventListener('load', () => {
          printWindow.print();
        });
      }
    } catch {
      printFromPreview();
    }
  };

  const handleSendEmail = () => {
    setShowSendEmailModal(true);
  };

  const handleStatusChange = async (newStatus: 'paid' | 'sent' | 'cancelled') => {
    if (!invoice || statusChangeInFlight.current || !canChangeInvoiceStatus) return;
    if (newStatus === 'paid' && !canMarkInvoicePaid) return;
    if (newStatus === 'sent' && !canMarkInvoiceSent) return;
    if (newStatus === 'cancelled' && !canCancelInvoice) return;

    statusChangeInFlight.current = true;
    setChangingStatus(true);
    try {
      const updateData: Record<string, string | number | null> = { status: newStatus };
      if (newStatus === 'paid') {
        // This is the target total paid, not another payment added to the full invoice value.
        const targetPaidAmount = Number(isFinalInvoice(invoice)
          ? invoice.settlement_summary?.remainingGross
          : invoice.total_gross);
        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        let confirmedPaymentDate = '';
        const confirmed = await showConfirm({
          title: 'Potwierdź pełną zapłatę',
          confirmText: 'Oznacz jako opłaconą',
          message: (
            <div className="space-y-3 text-left">
              <p>Faktura <strong>{invoice.invoice_number}</strong> · {invoice.buyer_name}</p>
              <p>Łączna potwierdzona zapłata: <strong>{targetPaidAmount.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {invoice.currency_code || 'PLN'}</strong>.</p>
              {isFinalInvoice(invoice) && <p className="text-xs">To kwota po odjęciu rozliczonych zaliczek.</p>}
              {canonicalBankPayment && <p className="text-xs">{formatCanonicalBankPayment(canonicalBankPayment)}</p>}
              <label className="block text-sm">
                Data pełnej zapłaty
                <input
                  type="date"
                  required
                  max={today}
                  onChange={(event) => { confirmedPaymentDate = event.target.value; }}
                  className="mt-1 block w-full rounded-lg border border-[#d3bb73]/10 bg-black/20 px-3 py-2 text-[#e5e4e2]"
                />
              </label>
              <p className="text-xs text-[#e5e4e2]/60">Potwierdź po sprawdzeniu wpłaty. To ręczne potwierdzenie pełnego rozliczenia, nie dopasowanie do wyciągu.</p>
            </div>
          ),
          validate: () => {
            const parsedDate = new Date(`${confirmedPaymentDate}T12:00:00Z`);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(confirmedPaymentDate)
              || !Number.isFinite(parsedDate.getTime())
              || parsedDate.toISOString().slice(0, 10) !== confirmedPaymentDate
              || confirmedPaymentDate > today) {
              showSnackbar('Podaj rzeczywistą datę zapłaty, nie późniejszą niż dzisiaj.', 'warning');
              return false;
            }
            return true;
          },
        });
        if (!confirmed) return;
        updateData.payment_status = 'paid';
        updateData.paid_amount = targetPaidAmount;
        updateData.paid_at = new Date(`${confirmedPaymentDate}T12:00:00`).toISOString();
        updateData.paid_date = confirmedPaymentDate;
      } else if (newStatus === 'cancelled') {
        const confirmed = await showConfirm(`Czy chcesz anulować fakturę ${invoice.invoice_number}?`, 'Anulowanie faktury');
        if (!confirmed) return;
      }

      // Do not overwrite a payment/status changed by another user while this page was open.
      let updateQuery = supabase.from('invoices').update(updateData)
        .eq('id', invoice.id).eq('status', invoice.status);
      updateQuery = invoice.payment_status == null
        ? updateQuery.is('payment_status', null)
        : updateQuery.eq('payment_status', invoice.payment_status);
      updateQuery = invoice.paid_amount == null
        ? updateQuery.is('paid_amount', null)
        : updateQuery.eq('paid_amount', invoice.paid_amount);
      const { data, error } = await updateQuery.select('id').maybeSingle();
      if (error) throw error;
      if (!data) {
        await fetchInvoice({ background: true });
        showSnackbar('Nie zapisano zmiany. Dane mogły się zmienić lub nie masz uprawnień. Sprawdź odświeżoną fakturę.', 'warning');
        return;
      }

      await fetchInvoice({ background: true });
      showSnackbar(newStatus === 'paid'
        ? 'Potwierdzono zapłatę. Rozliczenie powiązanego wydarzenia przeliczono automatycznie.'
        : 'Status faktury został zmieniony', 'success');
    } catch (err) {
      console.error('Error updating status:', err);
      showSnackbar('Nie udało się zmienić statusu. Sprawdź płatności i powiązania faktury przed ponowną próbą.', 'error');
    } finally {
      statusChangeInFlight.current = false;
      setChangingStatus(false);
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
    if (type === 'corrective' && invoice?.correction_kind === 'party_data') return 'Faktura korygująca dane';
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
  const isPartyDataCorrection = invoice.correction_kind === 'party_data';


  const previewSettlementSummary =
    invoice.settlement_summary ?? finalSettlementPreview?.settlementSummary;

  const isFinalInvoicePreview =
    invoice.invoice_type === 'final' || invoice.invoice_number?.startsWith('FKO/');

  const previewAmountToPay = isFinalInvoicePreview
    ? Number(previewSettlementSummary?.remainingGross ?? invoice.total_gross ?? 0)
    : Number(invoice.total_gross ?? 0);

  const paidAmount = Number(invoice.paid_amount ?? 0);
  const isRefund = invoice.invoice_type === 'corrective' && Number(invoice.total_gross ?? 0) < 0;
  const paymentBaseAmount = isRefund ? Math.abs(previewAmountToPay) : previewAmountToPay;

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
  const canChangeInvoiceStatus = financeAccess.canManageCompanyFinance || financeAccess.canIssueInvoices;
  const isProformaDocument = invoice.is_proforma || invoice.invoice_type === 'proforma';
  const printCaption = invoicePrintCaption(invoice);
  const hasPaymentBasis = !isFinalInvoicePreview || (invoice.settlement_summary != null
    && Number.isFinite(Number(invoice.settlement_summary.remainingGross)));
  const canMarkInvoicePaid = canChangeInvoiceStatus
    && !isPartyDataCorrection
    && ['issued', 'sent', 'overdue', 'paid'].includes(invoice.status)
    && ['unpaid', 'overdue', 'partially_paid'].includes(paymentStatus)
    && !isProformaDocument && !isRefund && hasPaymentBasis
    && Number.isFinite(paymentBaseAmount) && paymentBaseAmount > 0;
  const canMarkInvoiceSent = canChangeInvoiceStatus && invoice.status === 'issued';
  const canCancelInvoice = canChangeInvoiceStatus
    && !['paid', 'cancelled'].includes(invoice.status)
    && !['paid', 'partially_paid', 'partially_refunded', 'refunded'].includes(paymentStatus)
    && paidAmount === 0 && !canonicalBankPayment
    && !invoice.ksef_reference_number && !['pending', 'sent', 'accepted'].includes(ksefStatus);

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
              <SystemBadge value={paymentStatus} label={paymentStatus === 'refund_due' ? 'Do zwrotu' : paymentStatus === 'partially_refunded' ? 'Częściowo zwrócona' : undefined} />
              {relatedData.event && (
                <button
                  type="button"
                  onClick={() => router.push(`/crm/events/${relatedData.event!.id}?tab=finances`)}
                  className="inline-flex items-center gap-1.5 text-[#d3bb73] hover:text-[#e5e4e2]"
                >
                  <Calendar className="h-3.5 w-3.5" />
                  Wydarzenie: {relatedData.event.name}
                </button>
              )}
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
            {recipientPreview.error ? (
              <p role="alert" className="mt-3 rounded-lg bg-red-500/10 p-3 text-sm text-red-300">{recipientPreview.error}</p>
            ) : invoice.ksef_recipient_snapshot == null && invoice.service_recipient_organization_id && invoice.service_recipient_organization_id !== invoice.organization_id ? (
              <p role="status" className="mt-3 text-xs text-[#d3bb73]">
                Ta faktura ma powiązanego odbiorcę, ale nie ma utrwalonych danych odbiorcy z chwili jej wystawienia. Wizualizacja nie uzupełnia ich bieżącymi danymi kontaktu. Przed wysłaniem do KSeF sprawdź odbiorcę w podsumowaniu wysyłki.
              </p>
            ) : null}
            {canonicalBankPayment && (
              <details className="mt-3 text-xs text-emerald-200">
                <summary className="cursor-pointer">{formatCanonicalBankPayment(canonicalBankPayment)}</summary>
                <p className="mt-2 text-[#e5e4e2]/55">Potwierdzone dopasowanie przez powiązaną fakturę KSeF. Nie jest dodawane do ręcznych oznaczeń płatności; dane wystawionego dokumentu pozostają bez zmian.</p>
              </details>
            )}
            {bankPaymentReadError && <p role="status" className="mt-3 text-xs text-amber-200">Nie udało się odczytać dopasowań do wyciągu przez KSeF. Nie oznacza to braku zapłaty.</p>}
            {(canMarkInvoicePaid || canMarkInvoiceSent || canCancelInvoice) && (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-black/15 p-3" aria-label="Zmiana statusu faktury">
                <div className="text-sm text-[#e5e4e2]/70">
                  {canMarkInvoicePaid ? <>
                    Pozostało do potwierdzenia: <strong className="text-[#d3bb73]">{Math.max(paymentBaseAmount - paidAmount, 0).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {invoice.currency_code || 'PLN'}</strong>
                    <p className="mt-1 text-xs text-[#e5e4e2]/50">Według statusu faktury. Sprawdź wpłatę przed potwierdzeniem.</p>
                  </> : 'Zmiana statusu faktury'}
                </div>
                <div className="flex flex-wrap gap-2">
                  {canMarkInvoicePaid && (
                    <button type="button" disabled={changingStatus} onClick={() => handleStatusChange('paid')}
                      className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#c4ac64] disabled:cursor-wait disabled:opacity-50">
                      {changingStatus ? <Loader className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                      Oznacz jako opłaconą
                    </button>
                  )}
                  {canMarkInvoiceSent && (
                    <button type="button" disabled={changingStatus} onClick={() => handleStatusChange('sent')}
                      className="inline-flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-sm text-[#e5e4e2]/80 hover:bg-white/10 disabled:opacity-50">
                      <Send className="h-4 w-4" />Oznacz jako wysłaną
                    </button>
                  )}
                  {canCancelInvoice && (
                    <button type="button" disabled={changingStatus} onClick={() => handleStatusChange('cancelled')}
                      className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-300 hover:bg-red-400/10 disabled:opacity-50">
                      <XCircle className="h-4 w-4" />Anuluj fakturę
                    </button>
                  )}
                </div>
              </div>
            )}
            {!hasPaymentBasis && !['draft', 'cancelled'].includes(invoice.status) && (
              <p role="status" className="mt-3 text-xs text-amber-200">Przed potwierdzeniem zapłaty tej faktury końcowej trzeba uzupełnić jej zapisane rozliczenie zaliczek.</p>
            )}
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
                              {isPartyDataCorrection ? 'Dane nabywcy / odbiorcy - bez zmiany kwot' : invoice.correction_scope === 'full'
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

          <InvoicePrintPreview
            invoiceId={invoice.id}
            revision={[
              invoice.updated_at,
              invoice.pdf_generated_at,
              invoice.payment_status,
              invoice.paid_amount,
              invoice.ksef_status,
              invoice.ksef_reference_number,
              items.length,
            ].map((value) => String(value ?? '')).join('|')}
            caption={printCaption.caption}
            tone={printCaption.tone}
            fileName={invoicePdfFileName(invoice.invoice_number, isProformaDocument)}
            height={1180}
            className="mx-auto mb-6 w-full max-w-[920px]"
          />

        </div>


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
