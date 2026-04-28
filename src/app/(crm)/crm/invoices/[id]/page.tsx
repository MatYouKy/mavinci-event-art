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
import { buildInvoicePdfHtml } from '@/components/crm/invoices/helpers/buildInvoicePdfHtml';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';

interface Invoice {
  bank_name: string;
  company_logo_url: string;
  id: string;
  invoice_number: string;
  invoice_type: string;
  status: string;
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
  relatedInvoice?: { id: string; invoice_number: string; invoice_type: string } | null;
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

  useEffect(() => {
    fetchInvoice();
  }, [params.id]);

  const fetchInvoice = async () => {
    try {
      const [invoiceRes, itemsRes] = await Promise.all([
        supabase.from('invoices').select('*').eq('id', params.id).single(),
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
              .select('id, invoice_number, invoice_type')
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
  };

  useEffect(() => {
    if (!invoice) return;
    const checkSentEmails = async () => {
      const { count } = await supabase
        .from('sent_emails')
        .select('id', { count: 'exact', head: true })
        .ilike('subject', `%${invoice.invoice_number}%`);
      setEmailSentCount(count || 0);
    };
    checkSentEmails();
  }, [invoice]);

  const buildHtmlForPdfData = useCallback(() => {
    if (!invoice) return '';

    console.log('[buildHtmlForPdfData] ->  invoice', invoice);

    const effectiveInvoiceType =
      invoice.invoice_type === 'proforma' || invoice.is_proforma
        ? 'proforma'
        : invoice.invoice_type;

    return buildInvoicePdfHtml({
      footerNote:
        invoice.footer_note || '',
      signatureName: invoice.signature_name || 'Mateusz Kwiatkowski',
      website: invoice.website || 'www.mavinci.pl',
      invoiceNumber: invoice.invoice_number,
      invoiceType: effectiveInvoiceType,
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
      items: items.map((item) => ({
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
      invoice_items: invoice.invoice_items || ([] as any as InvoiceItem[]),
      isProforma: false,
    });
  }, [invoice, items]);

  const handleGeneratePDF = async () => {
    if (!invoice) return;
    setGenerating(true);
    try {
      const { data: freshItems } = await supabase
        .from('invoice_items')
        .select('*')
        .eq('invoice_id', invoice.id)
        .order('position_number', { ascending: true });

      if (freshItems && freshItems.length > 0) {
        setItems(freshItems);
        setInvoice((prev) => (prev ? { ...prev, invoice_items: freshItems } : prev));
      }

      const html = buildInvoicePdfHtml({
        footerNote:
          invoice.footer_note || '',
        signatureName: invoice.signature_name || 'Mateusz Kwiatkowski',
        website: invoice.website || 'www.mavinci.pl',
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
        items: (freshItems || items).map((item: any) => ({
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
        invoice_items: (freshItems || invoice.invoice_items || []) as any,
        isProforma: false,
      });
      const response = await fetch('/bridge/invoices/invoice-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          html,
          fileName: `Faktura_${invoice.invoice_number}.pdf`,
          invoiceId: invoice.id,
          eventId: invoice.event_id,
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
        showSnackbar('PDF wygenerowany (brak powiazanego eventu do zapisu)', 'info');
      }
    } catch (err: any) {
      console.error('Error generating PDF:', err);
      showSnackbar(err.message || 'Blad generowania PDF', 'error');
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

    let safeStatus = newStatus;

    console.log('[STATUS_CHANGE_BEFORE]', {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoice_number,
      invoiceType: invoice.invoice_type,
      isProforma: invoice.is_proforma,
      currentStatus: invoice.status,
      requestedStatus: newStatus,
    });

    if (invoice.is_proforma) {
      const allowed = ['draft', 'proforma', 'cancelled'];

      if (!allowed.includes(newStatus)) {
        safeStatus = 'proforma';
      }
    } else {
      if (newStatus === 'proforma') {
        safeStatus = 'draft';
      }
    }

    console.log('[STATUS_CHANGE_AFTER]', {
      safeStatus,
    });

    try {
      const { error } = await supabase
        .from('invoices')
        .update({ status: safeStatus })
        .eq('id', params.id);

      if (error) throw error;

      setInvoice((prev) => (prev ? { ...prev, status: safeStatus } : null));
      showSnackbar('Status faktury zostal zmieniony', 'success');
    } catch (err) {
      console.error('Error updating status:', err);
      showSnackbar('Blad podczas zmiany statusu', 'error');
    }
  };

  const [sendingToKSeF, setSendingToKSeF] = useState(false);

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

  const getTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      vat: 'Faktura VAT',
      proforma: 'Faktura Proforma',
      advance: 'Faktura Zaliczkowa',
      corrective: 'Korygujaca',
    };
    return labels[type] || type;
  };

  return (
    <PermissionGuard module="invoices">
      <div className="min-h-screen bg-[#0a0d1a] p-6">
        <div className="mx-auto max-w-5xl">
          <button
            onClick={() => router.back()}
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

          {invoice.invoice_type === 'corrective' && (
            <div className="mb-6 rounded-xl border border-orange-500/30 bg-orange-500/10 p-6">
              <h3 className="mb-4 text-lg font-medium text-orange-400">Faktura korygujaca</h3>
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
                  <div className="mb-1 text-xs text-[#e5e4e2]/40">Data wystawienia korygowanej</div>
                  <div className="text-[#e5e4e2]">
                    {invoice.corrected_invoice_issue_date
                      ? new Date(invoice.corrected_invoice_issue_date).toLocaleDateString('pl-PL')
                      : '-'}
                  </div>
                </div>
                <div>
                  <div className="mb-1 text-xs text-[#e5e4e2]/40">Nr KSeF korygowanej</div>
                  <div className="text-[#e5e4e2]">
                    {invoice.corrected_invoice_ksef_number || 'Nie wyslano do KSeF'}
                  </div>
                </div>
                <div>
                  <div className="mb-1 text-xs text-[#e5e4e2]/40">Zakres korekty</div>
                  <div className="text-[#e5e4e2]">
                    {invoice.correction_scope === 'full' ? 'Calosc faktury' : 'Czesc faktury'}
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

          {(relatedData.event ||
            relatedData.organization ||
            relatedData.relatedInvoice ||
            (relatedData.relatedInvoices && relatedData.relatedInvoices.length > 0)) && (
            <div className="mb-6 rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
              <h3 className="mb-4 flex items-center gap-2 text-lg font-medium text-[#e5e4e2]">
                <LinkIcon className="h-5 w-5 text-[#d3bb73]" />
                Powiazania
              </h3>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {relatedData.event && (
                  <div
                    onClick={() => router.push(`/crm/events/${relatedData.event!.id}`)}
                    className="cursor-pointer rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] p-4 transition-colors hover:border-[#d3bb73]/40"
                  >
                    <div className="flex items-start gap-3">
                      <Calendar className="mt-0.5 h-5 w-5 text-blue-400" />
                      <div className="flex-1">
                        <div className="mb-1 text-xs text-[#e5e4e2]/40">Event</div>
                        <div className="font-medium text-[#e5e4e2]">{relatedData.event.name}</div>
                        <div className="mt-1 text-xs text-[#e5e4e2]/60">
                          {new Date(relatedData.event.event_date).toLocaleDateString('pl-PL')}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {relatedData.organization && (
                  <div
                    onClick={() => router.push(`/crm/contacts/${relatedData.organization!.id}`)}
                    className="cursor-pointer rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] p-4 transition-colors hover:border-[#d3bb73]/40"
                  >
                    <div className="flex items-start gap-3">
                      <Building2 className="mt-0.5 h-5 w-5 text-[#d3bb73]" />
                      <div className="flex-1">
                        <div className="mb-1 text-xs text-[#e5e4e2]/40">Organizacja</div>
                        <div className="font-medium text-[#e5e4e2]">
                          {relatedData.organization.name}
                        </div>
                        {relatedData.organization.nip && (
                          <div className="mt-1 text-xs text-[#e5e4e2]/60">
                            NIP: {relatedData.organization.nip}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {relatedData.relatedInvoice && (
                  <div
                    onClick={() => router.push(`/crm/invoices/${relatedData.relatedInvoice!.id}`)}
                    className="cursor-pointer rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] p-4 transition-colors hover:border-[#d3bb73]/40"
                  >
                    <div className="flex items-start gap-3">
                      <FileText className="mt-0.5 h-5 w-5 text-orange-400" />
                      <div className="flex-1">
                        <div className="mb-1 text-xs text-[#e5e4e2]/40">Powiazana faktura</div>
                        <div className="font-medium text-[#e5e4e2]">
                          {relatedData.relatedInvoice.invoice_number}
                        </div>
                        <div className="mt-1 text-xs text-[#e5e4e2]/60">
                          {getTypeLabel(relatedData.relatedInvoice.invoice_type)}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {relatedData.relatedInvoices && relatedData.relatedInvoices.length > 0 && (
                  <div className="rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] p-4">
                    <div className="flex items-start gap-3">
                      <FileText className="mt-0.5 h-5 w-5 text-orange-400" />
                      <div className="flex-1">
                        <div className="mb-2 text-xs text-[#e5e4e2]/40">Faktury korygujace</div>
                        {relatedData.relatedInvoices.map((rel) => (
                          <div
                            key={rel.id}
                            onClick={() => router.push(`/crm/invoices/${rel.id}`)}
                            className="mb-1 cursor-pointer text-[#e5e4e2] hover:text-[#d3bb73]"
                          >
                            {rel.invoice_number}{' '}
                            <span className="text-xs text-[#e5e4e2]/60">
                              ({getTypeLabel(rel.invoice_type)})
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="mb-6 flex items-center justify-between">
            <div>
              <h1 className="mb-2 text-3xl font-light text-[#e5e4e2]">
                Faktura {invoice.invoice_number}
              </h1>
              <div className="flex items-center gap-3">
                <p className="text-[#e5e4e2]/60">
                  {getTypeLabel(invoice.invoice_type)}
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
            className="invoice-preview mx-auto mb-6 rounded-xl bg-white text-black"
            style={{ width: '794px', minHeight: '1123px', padding: '60px' }}
          >
            <div className="mb-12 flex items-start justify-between">
              <div className="flex items-center gap-4">
                {invoice.company_logo_url ? (
                  <Image
                    width={128}
                    height={128}
                    src={`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/company-logos/${invoice.company_logo_url}`}
                    alt="Logo firmy"
                    className="h-16 w-auto object-contain"
                  />
                ) : (
                  <Image
                    src="https://mavinci.pl/shape-mavinci-black.png"
                    alt="Logo firmy"
                    className="h-16 w-auto object-contain"
                    width={128}
                    height={128}
                  />
                )}
              </div>
              <div className="text-right text-sm">
                <div className="mb-4">
                  <div className="text-gray-600">Miejsce wystawienia</div>
                  <div className="font-medium">{invoice.issue_place}</div>
                </div>
                <div className="mb-4">
                  <div className="text-gray-600">Data wystawienia</div>
                  <div className="font-medium">
                    {new Date(invoice.issue_date).toLocaleDateString('pl-PL')}
                  </div>
                </div>
                <div>
                  <div className="text-gray-600">Data sprzedazy</div>
                  <div className="font-medium">
                    {new Date(invoice.sale_date).toLocaleDateString('pl-PL')}
                  </div>
                </div>
              </div>
            </div>

            <div className="mb-12 grid grid-cols-2 gap-12">
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

            <div className="mb-8 text-center">
              <div className="text-2xl font-bold">
                {getTypeLabel(invoice.invoice_type)} {invoice.invoice_number}
              </div>
            </div>

            <table className="mb-8 w-full text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="border border-gray-300 p-2 text-left">Lp.</th>
                  <th className="border border-gray-300 p-2 text-left">Nazwa towaru lub uslugi</th>
                  <th className="border border-gray-300 p-2">Jm.</th>
                  <th className="border border-gray-300 p-2">Ilosc</th>
                  <th className="border border-gray-300 p-2">Cena netto</th>
                  <th className="border border-gray-300 p-2">Wartosc netto</th>
                  <th className="border border-gray-300 p-2">Stawka VAT</th>
                  <th className="border border-gray-300 p-2">Kwota VAT</th>
                  <th className="border border-gray-300 p-2">Wartosc brutto</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td className="border border-gray-300 p-2">{item.position_number}</td>
                    <td className="border border-gray-300 p-2">{item.name}</td>
                    <td className="border border-gray-300 p-2 text-center">{item.unit}</td>
                    <td className="border border-gray-300 p-2 text-right">{item.quantity}</td>
                    <td className="border border-gray-300 p-2 text-right">
                      {item.price_net.toFixed(2)}
                    </td>
                    <td className="border border-gray-300 p-2 text-right">
                      {item.value_net.toFixed(2)}
                    </td>
                    <td className="border border-gray-300 p-2 text-center">{item.vat_rate}%</td>
                    <td className="border border-gray-300 p-2 text-right">
                      {item.vat_amount.toFixed(2)}
                    </td>
                    <td className="border border-gray-300 p-2 text-right font-medium">
                      {item.value_gross.toFixed(2)}
                    </td>
                  </tr>
                ))}

                <tr className="bg-gray-100 font-bold">
                  <td colSpan={5} className="border border-gray-300 p-2 text-right">
                    Razem
                  </td>
                  <td className="border border-gray-300 p-2 text-right">
                    {invoice.total_net.toFixed(2)}
                  </td>
                  <td className="border border-gray-300 p-2"></td>
                  <td className="border border-gray-300 p-2 text-right">
                    {invoice.total_vat.toFixed(2)}
                  </td>
                  <td className="border border-gray-300 p-2 text-right">
                    {invoice.total_gross.toFixed(2)}
                  </td>
                </tr>
              </tbody>
            </table>

            <div className="mb-8 grid grid-cols-2 gap-12 text-sm">
              <div>
                <div className="mb-2">
                  <span className="text-gray-600">Sposob platnosci:</span> {invoice.payment_method}
                </div>
                <div className="mb-2">
                  <span className="text-gray-600">Termin platnosci:</span>{' '}
                  {new Date(invoice.payment_due_date).toLocaleDateString('pl-PL')}
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
                  <span className="text-gray-600">Do zaplaty:</span>{' '}
                  <span className="text-lg font-bold">{invoice.total_gross.toFixed(2)} PLN</span>
                </div>
              </div>
            </div>

            <div className="mb-8 text-xs text-gray-600">
              {invoice.footer_note || ''}
            </div>

            <div className="flex justify-end">
              <div className="w-64 border-t border-gray-300 pt-2 text-center">
                <div className="mb-1 text-sm">
                  {invoice.signature_name || 'Mateusz Kwiatkowski'}
                </div>
                <div className="text-xs text-gray-600">Podpis osoby upowazionej do wystawienia</div>
              </div>
            </div>

            <div className="mt-8 text-center text-xs text-gray-500">
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
            onSuccess={async () => {
              await fetchInvoice();
            }}
            onError={() => {}}
            onClose={() => setShowKSeFModal(false)}
          />
        )}
      </div>
    </PermissionGuard>
  );
}
