'use client';

import { useState, useEffect } from 'react';
import { X, Send, Mail, Loader, Paperclip } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { buildInvoicePdfHtml } from './invoices/helpers/buildInvoicePdfHtml';
import { buildCompanySignatureHtml } from '@/lib/buildCompanySignature';

interface SendInvoiceEmailModalProps {
  invoiceId: string;
  invoiceNumber: string;
  clientEmail?: string;
  clientName?: string;
  pdfStoragePath?: string | null;
  onClose: () => void;
  onSent?: () => void;
}

interface InvoiceData {
  id: string;
  invoice_number: string;
  invoice_type: string;
  is_proforma: boolean;
  issue_date: string;
  sale_date: string;
  issue_place: string;
  payment_method: string;
  payment_due_date: string;
  bank_account: string;
  bank_name: string;
  seller_name: string;
  seller_nip: string;
  seller_street: string;
  seller_city: string;
  seller_postal_code: string;
  buyer_name: string;
  buyer_nip: string;
  buyer_street: string;
  buyer_city: string;
  buyer_postal_code: string;
  total_net: number;
  total_vat: number;
  total_gross: number;
  company_logo_url: string | null;
  status: string;
  footer_note: string;
  signature_name: string;
  website: string;
}

interface InvoiceItem {
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

function getTypeLabel(type: string) {
  const labels: Record<string, string> = {
    standard: 'Faktura VAT',
    proforma: 'Faktura Proforma',
    corrective: 'Faktura korygująca',
  };
  return labels[type] || 'Faktura VAT';
}

export default function SendInvoiceEmailModal({
  invoiceId,
  invoiceNumber,
  clientEmail = '',
  clientName = '',
  pdfStoragePath,
  onClose,
  onSent,
}: SendInvoiceEmailModalProps) {
  const { showSnackbar } = useSnackbar();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    to: clientEmail,
    subject: `Faktura ${invoiceNumber}`,
    message: `Dzień dobry,

W załączeniu przesyłam fakturę ${invoiceNumber}.

W razie pytań proszę o kontakt.`,
  });

  useEffect(() => {
    if (clientEmail) {
      setFormData((prev) => ({ ...prev, to: clientEmail }));
    }
  }, [clientEmail]);

  const generateInvoicePDF = async (): Promise<{ base64: string; filename: string }> => {
    const [invoiceRes, itemsRes] = await Promise.all([
      supabase.from('invoices').select('*').eq('id', invoiceId).single(),
      supabase
        .from('invoice_items')
        .select('*')
        .eq('invoice_id', invoiceId)
        .order('position_number'),
    ]);
  
    if (invoiceRes.error || !invoiceRes.data) {
      throw new Error('Nie znaleziono faktury');
    }
  
    const invoice = invoiceRes.data as InvoiceData;
    const items = (itemsRes.data || []) as InvoiceItem[];
  
    const html = buildInvoicePdfHtml({
      isProforma: invoice.is_proforma,
      footerNote: invoice.footer_note,
      signatureName: invoice.signature_name,
      website: invoice.website,
      invoiceNumber: invoice.invoice_number,
      invoiceType: invoice.invoice_type,
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
    });
  
    const response = await fetch('/bridge/invoices/invoice-pdf', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        html,
        fileName: `Faktura_${invoiceNumber}.pdf`,
      }),
    });
  
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new Error(error?.error || 'Nie udało się wygenerować PDF');
    }
  
    const result = await response.json();
  
    if (!result?.base64) {
      throw new Error('Route nie zwrócił zawartości PDF');
    }
  
    return {
      base64: result.base64,
      filename: result.filename || `Faktura_${invoiceNumber}.pdf`,
    };
  };

  const handleSend = async () => {
    if (!formData.to.trim()) {
      showSnackbar('Wprowadź adres email odbiorcy', 'error');
      return;
    }

    if (!formData.subject.trim()) {
      showSnackbar('Wprowadź temat wiadomości', 'error');
      return;
    }

    setLoading(true);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        showSnackbar('Brak sesji użytkownika', 'error');
        setLoading(false);
        return;
      }

      let attachments: Array<{ filename: string; content: string; contentType: string }> = [];

      try {
        let base64: string;
        const filename = `Faktura_${invoiceNumber}.pdf`;

        if (pdfStoragePath) {
          showSnackbar('Pobieram PDF ze storage...', 'info');
          const { data: signedData, error: signedErr } = await supabase.storage
            .from('event-files')
            .createSignedUrl(pdfStoragePath, 300);

          if (signedErr || !signedData?.signedUrl) {
            throw new Error('Nie udalo sie pobrac PDF ze storage');
          }

          const pdfResp = await fetch(signedData.signedUrl);
          if (!pdfResp.ok) throw new Error('Blad pobierania PDF');
          const buffer = await pdfResp.arrayBuffer();
          base64 = btoa(
            new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), ''),
          );
        } else {
          showSnackbar('Generuje PDF faktury...', 'info');
          const pdfData = await generateInvoicePDF();
          base64 = pdfData.base64;
        }

        attachments.push({
          filename,
          content: base64,
          contentType: 'application/pdf',
        });
        showSnackbar('PDF gotowy, wysylam email...', 'info');
      } catch (pdfError: any) {
        console.error('Error preparing PDF:', pdfError);
        showSnackbar(
          `Nie udalo sie przygotowac PDF: ${pdfError.message}. Wysylam bez zalacznika.`,
          'warning',
        );
      }

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/send-invoice-email`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            invoiceId,
            to: formData.to,
            subject: formData.subject,
            message: formData.message,
            attachments,
            signatureHtml: (await buildCompanySignatureHtml()).html,
          }),
        },
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || error.message || 'Błąd podczas wysyłania email');
      }

      showSnackbar('Faktura wysłana przez email z załącznikiem PDF', 'success');
      onSent?.();
      onClose();
    } catch (error: any) {
      console.error('Error sending email:', error);
      showSnackbar(error.message || 'Błąd podczas wysyłania email', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33]">
        <div className="flex items-center justify-between border-b border-[#d3bb73]/20 p-6">
          <div className="flex items-center gap-3">
            <Mail className="h-6 w-6 text-[#d3bb73]" />
            <h2 className="text-xl font-light text-[#e5e4e2]">Wyślij fakturę przez email</h2>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            className="rounded-lg p-2 text-[#e5e4e2]/60 transition-colors hover:bg-[#d3bb73]/10 hover:text-[#e5e4e2]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-6">
          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">
              Do (email odbiorcy) <span className="text-red-400">*</span>
            </label>
            <input
              type="email"
              value={formData.to}
              onChange={(e) => setFormData({ ...formData, to: e.target.value })}
              disabled={loading}
              placeholder="klient@example.com"
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none disabled:opacity-50"
            />
            {clientName && <p className="mt-1 text-xs text-[#e5e4e2]/40">Klient: {clientName}</p>}
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">
              Temat <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={formData.subject}
              onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
              disabled={loading}
              placeholder="Faktura..."
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none disabled:opacity-50"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Treść wiadomości</label>
            <textarea
              value={formData.message}
              onChange={(e) => setFormData({ ...formData, message: e.target.value })}
              disabled={loading}
              rows={8}
              placeholder="Wpisz treść wiadomości..."
              className="w-full resize-none rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none disabled:opacity-50"
            />
          </div>

          <div className="rounded-lg border border-[#d3bb73]/20 bg-[#d3bb73]/10 p-4">
            <p className="text-sm text-[#d3bb73]">
              <strong>Nadawca:</strong> Systemowa skrzynka email CRM
            </p>
            <div className="mt-2 flex items-center gap-2 text-sm text-[#e5e4e2]/60">
              <Paperclip className="h-4 w-4 text-[#d3bb73]" />
              <span>
                <strong>Zalacznik:</strong> Faktura_{invoiceNumber}.pdf
                {pdfStoragePath ? ' (z zapisanego PDF)' : ' (zostanie wygenerowany)'}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-[#d3bb73]/20 p-6">
          <button
            onClick={onClose}
            disabled={loading}
            className="rounded-lg px-6 py-2.5 text-[#e5e4e2]/80 transition-colors hover:bg-[#d3bb73]/10 disabled:opacity-50"
          >
            Anuluj
          </button>
          <button
            onClick={handleSend}
            disabled={loading}
            className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-2.5 font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader className="h-4 w-4 animate-spin" />
                Wysyłanie...
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                Wyślij fakturę
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
