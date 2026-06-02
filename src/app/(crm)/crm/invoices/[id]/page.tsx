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
  FilePlus2,
  FileDown,
  Loader,
  RefreshCw,
} from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';
import SendInvoiceEmailModal from '@/components/crm/SendInvoiceEmailModal';
import ConvertProformaModal from '@/components/crm/ConvertProformaModal';
import KSeFSendModal from '@/components/crm/KSeFSendModal';
import PermissionGuard from '@/components/crm/PermissionGuard';
import { useDialog } from '@/contexts/DialogContext';
import Image from 'next/image';
import ResponsiveActionBar, { Action } from '@/components/crm/ResponsiveActionBar';
import {
  buildInvoicePdfHtml,
  SettledInvoicePdfRef,
} from '@/components/crm/invoices/helpers/buildInvoicePdfHtml';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';

interface Invoice {
  buyer_is_private_person: boolean;
  bank_name: string;
  company_logo_url: string | null;
  my_company: {
    logo_url: string | null;
  } | null;
  id: string;
  invoice_number: string;
  invoice_type: string;
  status: string;
  payment_status: 'unpaid' | 'partial' | 'paid' | null;
  paid_amount: number | null;
  paid_at: string | null;
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
  issue_place: string;
  pdf_url: string | null;
  pdf_generated_at: string | null;
  event_id: string | null;
  organization_id: string | null;
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
    event_date: string;
    contact_person_id?: string | null;
  } | null;
  organization?: { id: string; name: string; nip: string; email?: string } | null;
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
}

export interface InvoiceItem {
  id: string;
  position_number: number;
  name: string;
  unit: string;
  quantity: number;
  price_net: number;
  vat_rate: number;
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
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [relatedData, setRelatedData] = useState<RelatedData>({});
  const [loading, setLoading] = useState(true);
  const [showSendEmailModal, setShowSendEmailModal] = useState(false);
  const [showConvertProformaModal, setShowConvertProformaModal] = useState(false);
  const [showKSeFModal, setShowKSeFModal] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [pdfPath, setPdfPath] = useState<string | null>(null);
  const [lastBase64, setLastBase64] = useState<string | null>(null);
  const [emailSentCount, setEmailSentCount] = useState(0);
  const [showRelations, setShowRelations] = useState(false);

  const [finalSettlementPreview, setFinalSettlementPreview] = useState<{
    settledInvoices?: SettledInvoicePdfRef[];
    settlementSummary?: Invoice['settlement_summary'];
  } | null>(null);

  const fetchInvoice = useCallback(async () => {
    try {
      const [invoiceRes, itemsRes] = await Promise.all([
        supabase
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
          .eq('id', params.id)
          .single(),

        supabase
          .from('invoice_items')
          .select('*')
          .eq('invoice_id', params.id)
          .order('position_number'),
      ]);

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

        if (invoiceRes.data.event_id && results[resultIndex]?.data) {
          related.event = results[resultIndex].data;
          resultIndex++;
        }

        if (invoiceRes.data.organization_id && results[resultIndex]?.data) {
          related.organization = results[resultIndex].data;
          resultIndex++;
        }

        if (invoiceRes.data.related_invoice_id && results[resultIndex]?.data) {
          related.relatedInvoice = results[resultIndex].data;
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

        setRelatedData(related);
      }

      if (itemsRes.data) setItems(itemsRes.data);
    } catch (err) {
      console.error('Error fetching invoice:', err);
      showSnackbar('Blad podczas ladowania faktury', 'error');
    } finally {
      setLoading(false);
    }
  }, [params.id]);

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

  const handleKsefSuccess = useCallback(async () => {
    await fetchInvoice();
  }, [fetchInvoice]);

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
    if (!invoice) return;

    setGenerating(true);

    try {
      const resolvedEventId = invoice.event_id || relatedData.relatedInvoice?.event_id || null;

      const { data: freshItems } = await supabase
        .from('invoice_items')
        .select('*')
        .eq('invoice_id', invoice.id)
        .order('position_number', { ascending: true });

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

      const normalizedPaymentStatus: 'unpaid' | 'partial' | 'paid' =
        invoice.payment_status || (invoice.status === 'paid' ? 'paid' : 'unpaid');

      const normalizedPaidAmount =
        normalizedPaymentStatus === 'paid' ? pdfAmountToPay : Number(invoice.paid_amount ?? 0);

      const html = buildInvoicePdfHtml({
        paymentStatus: normalizedPaymentStatus,
        paidAmount: normalizedPaidAmount,
        paidAt: invoice.paid_at,

        buyerIsPrivatePerson: invoice.buyer_is_private_person,
        footerNote: invoice.footer_note || '',
        signatureName: invoice.signature_name || 'Mateusz Kwiatkowski',
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
          valueNet: item.value_net,
          vatAmount: item.vat_amount,
          valueGross: item.value_gross,
        })),
        invoice_items: (freshItems || invoice.invoice_items || []) as InvoiceItem[],
        isProforma: false,
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
      updateData.paid_amount = Number(invoice.total_gross ?? 0);
      updateData.paid_at = new Date().toISOString();
      updateData.payment_due_date = new Date().toISOString().split('T')[0];
    }

    if (safeStatus !== 'paid' && invoice.payment_status === 'paid') {
      updateData.payment_status = 'unpaid';
      updateData.paid_amount = 0;
      updateData.paid_at = null;
    }

    try {
      const { error } = await supabase.from('invoices').update(updateData).eq('id', params.id);

      if (error) throw error;

      setInvoice((prev) => (prev ? { ...prev, ...updateData } : null));
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

    if (invoice?.status === 'draft' && !invoice?.is_proforma) {
      nextActions.push({
        label: 'Wyslij do KSeF',
        icon: <Send className="h-4 w-4" />,
        onClick: handleSendToKSeF,
        variant: 'primary',
      });
    }

    if (
      (invoice?.status === 'issued' || invoice?.status === 'sent') &&
      invoice.invoice_type !== 'corrective'
    ) {
      nextActions.push({
        label: 'Wystaw korekte',
        icon: <FilePlus2 className="h-4 w-4" />,
        onClick: () => router.push(`/crm/invoices/new?type=corrective&related=${invoice.id}`),
        variant: 'default',
      });
    }

    return nextActions;
  }, [invoice, router, generating, pdfPath, emailButtonLabel]);

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
  const paidAmount = Number(invoice.paid_amount ?? 0);

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
  const amountToPay =
    paymentStatus === 'paid'
      ? 0
      : paymentStatus === 'partial'
        ? Math.max(previewAmountToPay - paidAmount, 0)
        : previewAmountToPay;

  return (
    <PermissionGuard module="invoices">
      <div className="min-h-screen bg-[#0a0d1a] p-6">
        <div className="mx-auto max-w-5xl">
          <button
            onClick={() => router.push('/crm/invoices')}
            className="mb-6 flex items-center gap-2 text-[#e5e4e2]/60 hover:text-[#d3bb73]"
          >
            <ArrowLeft className="h-5 w-5" />
            Powrot
          </button>

          {invoice.is_proforma && (
            <div className="mb-6 rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-6">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h3 className="mb-2 text-lg font-medium text-yellow-400">Faktura Proforma</h3>
                  <p className="mb-4 text-sm text-[#e5e4e2]/80">
                    Ta proforma nie zostanie wyslana do KSeF. Aby wystawic prawnie wiazaca fakture
                    VAT, uzyj przycisku ponizej.
                  </p>

                  {!invoice.proforma_converted_to_invoice_id ? (
                    <button
                      onClick={handleConvertToVAT}
                      className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
                    >
                      <CheckCircle className="h-4 w-4" />
                      Wystaw fakture na podstawie proformy
                    </button>
                  ) : (
                    <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-3">
                      <div className="mb-2 text-sm font-medium text-green-400">
                        Faktura VAT zostala wystawiona
                      </div>
                      <button
                        onClick={() =>
                          router.push(`/crm/invoices/${invoice.proforma_converted_to_invoice_id}`)
                        }
                        className="text-sm text-[#d3bb73] hover:underline"
                      >
                        Zobacz fakture VAT
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {!invoice.is_proforma &&
            invoice.related_invoice_id &&
            invoice.invoice_type !== 'corrective' && (
              <div className="mb-6 rounded-xl border border-blue-500/30 bg-blue-500/10 p-4">
                <div className="text-sm text-[#e5e4e2]/80">
                  Wystawiona na podstawie proformy:
                  <button
                    onClick={() => router.push(`/crm/invoices/${invoice.related_invoice_id}`)}
                    className="ml-2 text-[#d3bb73] hover:underline"
                  >
                    Zobacz proforme
                  </button>
                </div>
              </div>
            )}

          {(relatedData.event ||
            relatedData.organization ||
            relatedData.relatedInvoice ||
            (relatedData.relatedInvoices && relatedData.relatedInvoices.length > 0)) && (
            <div className="mb-6 overflow-hidden rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]">
              <button
                type="button"
                onClick={() => setShowRelations((prev) => !prev)}
                className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-[#d3bb73]/5"
              >
                <div className="flex items-center gap-2">
                  <LinkIcon className="h-4 w-4 text-[#d3bb73]" />
                  <span className="text-sm font-medium text-[#e5e4e2]">Powiązania</span>

                  <span className="rounded-full border border-[#d3bb73]/20 px-2 py-0.5 text-xs text-[#e5e4e2]/50">
                    {
                      [
                        relatedData.event,
                        relatedData.organization,
                        relatedData.relatedInvoice,
                        ...(relatedData.relatedInvoices ?? []),
                      ].filter(Boolean).length
                    }
                  </span>
                </div>

                <span className="text-xs text-[#d3bb73]">{showRelations ? 'Ukryj' : 'Pokaż'}</span>
              </button>

              {showRelations && (
                <div className="border-t border-[#d3bb73]/10 p-4">
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

                    {relatedData.organization && (
                      <button
                        type="button"
                        onClick={() => router.push(`/crm/contacts/${relatedData.organization!.id}`)}
                        className="flex items-center gap-3 rounded-lg border border-[#d3bb73]/10 bg-[#0a0d1a] p-3 text-left transition-colors hover:border-[#d3bb73]/40"
                      >
                        <Building2 className="h-4 w-4 shrink-0 text-[#d3bb73]" />
                        <div className="min-w-0">
                          <div className="text-[11px] uppercase tracking-wide text-[#e5e4e2]/40">
                            Organizacja
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

          <div className="mb-6 flex items-center justify-between">
            <div>
              <h1 className="mb-2 text-3xl font-light text-[#e5e4e2]">
                Faktura {invoice.invoice_number}
              </h1>
              <div className="flex items-center gap-3">
                <p className="text-[#e5e4e2]/60">
                  {getTypeLabel(invoice.invoice_type, invoice.invoice_number)}
                  {invoice.is_proforma ? ' (Faktura Proforma)' : ''}
                </p>
                {pdfPath && (
                  <span className="rounded-full bg-green-500/20 px-2.5 py-0.5 text-xs font-medium text-green-400">
                    PDF wygenerowany
                  </span>
                )}
                {emailSentCount > 0 && (
                  <span className="rounded-full bg-blue-500/20 px-2.5 py-0.5 text-xs font-medium text-blue-400">
                    Email wyslany ({emailSentCount}x)
                  </span>
                )}
              </div>
            </div>
            <ResponsiveActionBar disabledBackground actions={actions} mobileBreakpoint={900} />
          </div>

          {invoice.ksef_status && (
            <div
              className={`mb-6 rounded-xl border p-4 ${
                invoice.ksef_status === 'accepted'
                  ? 'border-green-500/30 bg-green-500/10'
                  : invoice.ksef_status === 'rejected'
                    ? 'border-red-500/30 bg-red-500/10'
                    : invoice.ksef_status === 'sent'
                      ? 'border-blue-500/30 bg-blue-500/10'
                      : 'border-[#d3bb73]/20 bg-[#1c1f33]'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className={`flex h-8 w-8 items-center justify-center rounded-full ${
                      invoice.ksef_status === 'accepted'
                        ? 'bg-green-500/20 text-green-400'
                        : invoice.ksef_status === 'rejected'
                          ? 'bg-red-500/20 text-red-400'
                          : 'bg-blue-500/20 text-blue-400'
                    }`}
                  >
                    {invoice.ksef_status === 'accepted' ? (
                      <CheckCircle className="h-5 w-5" />
                    ) : invoice.ksef_status === 'rejected' ? (
                      <XCircle className="h-5 w-5" />
                    ) : (
                      <Send className="h-5 w-5" />
                    )}
                  </div>
                  <div>
                    <div className="text-sm font-medium text-[#e5e4e2]">
                      KSeF:{' '}
                      {invoice.ksef_status === 'accepted'
                        ? 'Zaakceptowana'
                        : invoice.ksef_status === 'rejected'
                          ? 'Odrzucona'
                          : invoice.ksef_status === 'sent'
                            ? 'Wyslana'
                            : 'Szkic'}
                    </div>
                    {invoice.ksef_reference_number && (
                      <div className="text-xs text-[#e5e4e2]/60">
                        Nr ref.: {invoice.ksef_reference_number}
                      </div>
                    )}
                  </div>
                </div>
                {invoice.ksef_sent_at && (
                  <div className="text-xs text-[#e5e4e2]/40">
                    {new Date(invoice.ksef_sent_at).toLocaleString('pl-PL')}
                  </div>
                )}
              </div>
              {invoice.ksef_error && (
                <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-sm text-red-400">
                  {invoice.ksef_error}
                </div>
              )}
            </div>
          )}

          <div
            className="invoice-preview mx-auto mb-6 flex flex-col rounded-xl bg-white text-black"
            style={{ width: '794px', minHeight: '1123px', padding: '42px 48px' }}
          >
            {!invoice.buyer_is_private_person && (
              <div className="-mx-12 -mt-[42px] mb-6 bg-gray-500 py-1.5 text-center text-xs font-bold uppercase tracking-[0.35em] text-white">
                Wizualizacja
              </div>
            )}
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
                  {paymentStatus === 'paid'
                    ? `Zapłacono${invoice.paid_at ? ` (${new Date(invoice.paid_at).toLocaleDateString('pl-PL')})` : ''}`
                    : paymentStatus === 'partial'
                      ? `Częściowo zapłacono: ${paidAmount.toFixed(2)} PLN`
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
                      ? 'Kwota korekty:'
                      : paymentStatus === 'paid'
                        ? 'Zapłacono:'
                        : paymentStatus === 'partial'
                          ? 'Pozostało do zapłaty:'
                          : 'Do zapłaty:'}
                  </span>{' '}
                  <span className="text-base font-bold">{amountToPay.toFixed(2)} PLN</span>
                </div>
              </div>
            </div>

            <div className="mb-5 text-[10px] leading-snug text-gray-600">
              <span style={{ whiteSpace: 'pre-wrap', fontWeight: '700' }}>Uwagi:</span>{' '}
              {invoice.footer_note || ''}
            </div>

            <div className="flex justify-end">
              <div className="w-64 border-t border-gray-300 pt-2 text-center text-xs">
                <div className="mb-1 text-sm">
                  {invoice.signature_name || 'Mateusz Kwiatkowski'}
                </div>
                <div className="text-[10px] leading-snug text-gray-600">
                  Podpis osoby upowazionej do wystawienia
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
              width: 210mm;
              height: 297mm;
              margin: 0;
              padding: 20mm;
              background: white;
              box-shadow: none;
              border-radius: 0;
            }

            @page {
              size: A4;
              margin: 0;
            }
          }
        `}</style>

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
        {showSendEmailModal && invoice && (
          <SendInvoiceEmailModal
            invoiceId={invoice.id}
            invoiceNumber={invoice.invoice_number}
            clientEmail={relatedData.primaryContact?.email || relatedData.organization?.email || ''}
            clientName={relatedData.primaryContact?.name || relatedData.organization?.name || ''}
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
            onSuccess={handleKsefSuccess}
            onError={handleKsefError}
            onClose={() => setShowKSeFModal(false)}
          />
        )}
      </div>
    </PermissionGuard>
  );
}
