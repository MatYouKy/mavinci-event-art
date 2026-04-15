'use client';

import { useState, useEffect } from 'react';
import { X, Send, Mail, Loader, Paperclip } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';

interface SendInvoiceEmailModalProps {
  invoiceId: string;
  invoiceNumber: string;
  clientEmail?: string;
  clientName?: string;
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

function buildInvoiceHtml(invoice: InvoiceData, items: InvoiceItem[]): string {
  const itemsRows = items
    .map(
      (item) => `
    <tr>
      <td style="border:1px solid #d1d5db;padding:6px 8px">${item.position_number}</td>
      <td style="border:1px solid #d1d5db;padding:6px 8px">${item.name}</td>
      <td style="border:1px solid #d1d5db;padding:6px 8px;text-align:center">${item.unit}</td>
      <td style="border:1px solid #d1d5db;padding:6px 8px;text-align:right">${item.quantity}</td>
      <td style="border:1px solid #d1d5db;padding:6px 8px;text-align:right">${item.price_net.toFixed(2)}</td>
      <td style="border:1px solid #d1d5db;padding:6px 8px;text-align:right">${item.value_net.toFixed(2)}</td>
      <td style="border:1px solid #d1d5db;padding:6px 8px;text-align:center">${item.vat_rate}%</td>
      <td style="border:1px solid #d1d5db;padding:6px 8px;text-align:right">${item.vat_amount.toFixed(2)}</td>
      <td style="border:1px solid #d1d5db;padding:6px 8px;text-align:right;font-weight:600">${item.value_gross.toFixed(2)}</td>
    </tr>`,
    )
    .join('');

  const logoUrl = invoice.company_logo_url || '/logo-mavinci-crm.png';
  const logoSrc = logoUrl.startsWith('http')
    ? logoUrl
    : `${window.location.origin}${logoUrl}`;

  return `
    <div style="font-family:Arial,Helvetica,sans-serif;width:210mm;padding:15mm;box-sizing:border-box;color:#111;font-size:12px;line-height:1.5">
      <table style="width:100%;border-collapse:collapse;margin-bottom:30px">
        <tr>
          <td style="vertical-align:top">
            <img src="${logoSrc}" alt="Logo" style="height:50px;width:auto" crossorigin="anonymous" />
          </td>
          <td style="text-align:right;font-size:11px;vertical-align:top">
            <div style="margin-bottom:10px">
              <div style="color:#666">Miejsce wystawienia</div>
              <div style="font-weight:600">${invoice.issue_place || ''}</div>
            </div>
            <div style="margin-bottom:10px">
              <div style="color:#666">Data wystawienia</div>
              <div style="font-weight:600">${new Date(invoice.issue_date).toLocaleDateString('pl-PL')}</div>
            </div>
            <div>
              <div style="color:#666">Data sprzedaży</div>
              <div style="font-weight:600">${new Date(invoice.sale_date).toLocaleDateString('pl-PL')}</div>
            </div>
          </td>
        </tr>
      </table>

      <table style="width:100%;border-collapse:collapse;margin-bottom:30px">
        <tr>
          <td style="width:50%;vertical-align:top;padding-right:20px">
            <div style="color:#666;font-size:11px;margin-bottom:4px">Sprzedawca</div>
            <div style="font-weight:600">${invoice.seller_name}</div>
            <div>NIP: ${invoice.seller_nip}</div>
            <div>${invoice.seller_street || ''}</div>
            <div>${invoice.seller_postal_code || ''} ${invoice.seller_city || ''}</div>
          </td>
          <td style="width:50%;vertical-align:top;padding-left:20px">
            <div style="color:#666;font-size:11px;margin-bottom:4px">Nabywca</div>
            <div style="font-weight:600">${invoice.buyer_name}</div>
            ${invoice.buyer_nip ? `<div>NIP: ${invoice.buyer_nip}</div>` : ''}
            <div>${invoice.buyer_street || ''}</div>
            <div>${invoice.buyer_postal_code || ''} ${invoice.buyer_city || ''}</div>
          </td>
        </tr>
      </table>

      <div style="text-align:center;margin-bottom:20px">
        <div style="font-size:18px;font-weight:700">
          ${getTypeLabel(invoice.invoice_type)} ${invoice.invoice_number}
        </div>
      </div>

      <table style="width:100%;border-collapse:collapse;margin-bottom:20px;font-size:11px">
        <thead>
          <tr style="background:#f3f4f6">
            <th style="border:1px solid #d1d5db;padding:6px 8px;text-align:left">Lp.</th>
            <th style="border:1px solid #d1d5db;padding:6px 8px;text-align:left">Nazwa towaru lub usługi</th>
            <th style="border:1px solid #d1d5db;padding:6px 8px;text-align:center">Jm.</th>
            <th style="border:1px solid #d1d5db;padding:6px 8px;text-align:center">Ilość</th>
            <th style="border:1px solid #d1d5db;padding:6px 8px;text-align:center">Cena netto</th>
            <th style="border:1px solid #d1d5db;padding:6px 8px;text-align:center">Wartość netto</th>
            <th style="border:1px solid #d1d5db;padding:6px 8px;text-align:center">VAT</th>
            <th style="border:1px solid #d1d5db;padding:6px 8px;text-align:center">Kwota VAT</th>
            <th style="border:1px solid #d1d5db;padding:6px 8px;text-align:center">Brutto</th>
          </tr>
        </thead>
        <tbody>
          ${itemsRows}
          <tr style="background:#f3f4f6;font-weight:700">
            <td colspan="5" style="border:1px solid #d1d5db;padding:6px 8px;text-align:right">Razem</td>
            <td style="border:1px solid #d1d5db;padding:6px 8px;text-align:right">${invoice.total_net.toFixed(2)}</td>
            <td style="border:1px solid #d1d5db;padding:6px 8px"></td>
            <td style="border:1px solid #d1d5db;padding:6px 8px;text-align:right">${invoice.total_vat.toFixed(2)}</td>
            <td style="border:1px solid #d1d5db;padding:6px 8px;text-align:right">${invoice.total_gross.toFixed(2)}</td>
          </tr>
        </tbody>
      </table>

      <table style="width:100%;border-collapse:collapse;margin-bottom:20px;font-size:11px">
        <tr>
          <td style="width:50%;vertical-align:top;padding-right:20px">
            <div style="margin-bottom:4px"><span style="color:#666">Sposób płatności:</span> ${invoice.payment_method || ''}</div>
            <div style="margin-bottom:4px"><span style="color:#666">Termin płatności:</span> ${new Date(invoice.payment_due_date).toLocaleDateString('pl-PL')}</div>
            <div style="margin-bottom:4px"><span style="color:#666">Numer konta:</span></div>
            <div style="font-family:monospace">${invoice.bank_account || ''}</div>
            ${invoice.bank_name ? `<div style="margin-top:4px"><span style="color:#666">Nazwa banku:</span> ${invoice.bank_name}</div>` : ''}
          </td>
          <td style="width:50%;vertical-align:top;padding-left:20px">
            <div><span style="color:#666">Do zapłaty:</span> <span style="font-size:16px;font-weight:700">${invoice.total_gross.toFixed(2)} PLN</span></div>
          </td>
        </tr>
      </table>

      <div style="font-size:9px;color:#666;margin-bottom:20px">
        Niniejsza faktura jest wezwaniem do zapłaty zgodnie z artykułem 455kc.
        Po przekroczeniu terminu płatności będą naliczane ustawowe odsetki za zwłokę.
      </div>

      <table style="width:100%;border-collapse:collapse">
        <tr>
          <td style="text-align:right">
            <div style="width:180px;border-top:1px solid #d1d5db;padding-top:8px;text-align:center;margin-left:auto">
              <div style="font-size:11px;margin-bottom:2px">Mateusz Kwiatkowski</div>
              <div style="font-size:9px;color:#666">Podpis osoby upoważnionej do wystawienia</div>
            </div>
          </td>
        </tr>
      </table>

      <div style="margin-top:20px;text-align:center;font-size:9px;color:#999">www.mavinci.pl</div>
    </div>
  `;
}

export default function SendInvoiceEmailModal({
  invoiceId,
  invoiceNumber,
  clientEmail = '',
  clientName = '',
  onClose,
  onSent,
}: SendInvoiceEmailModalProps) {
  const { showSnackbar } = useSnackbar();
  const [loading, setLoading] = useState(false);
  const [pdfReady, setPdfReady] = useState(false);
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

    const html = buildInvoiceHtml(invoice, items);

    const html2pdf = (await import('html2pdf.js')).default;

    const element = document.createElement('div');
    element.innerHTML = html;
    element.style.width = '210mm';
    element.style.position = 'absolute';
    element.style.left = '-9999px';
    document.body.appendChild(element);

    try {
      const pdfBlob = await html2pdf()
        .set({
          margin: 0,
          filename: `Faktura_${invoiceNumber}.pdf`,
          html2canvas: { scale: 2, useCORS: true, logging: false },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        })
        .from(element)
        .output('blob');

      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onloadend = () => {
          const result = reader.result as string;
          const base64 = result.split(',')[1];
          resolve(base64);
        };
        reader.onerror = reject;
      });

      reader.readAsDataURL(pdfBlob);
      const base64 = await base64Promise;

      return {
        base64,
        filename: `Faktura_${invoiceNumber}.pdf`,
      };
    } finally {
      document.body.removeChild(element);
    }
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

      showSnackbar('Generuję PDF faktury...', 'info');

      let attachments: Array<{ filename: string; content: string; contentType: string }> = [];

      try {
        const pdfData = await generateInvoicePDF();
        attachments.push({
          filename: pdfData.filename,
          content: pdfData.base64,
          contentType: 'application/pdf',
        });
        showSnackbar('PDF wygenerowany, wysyłam email...', 'info');
      } catch (pdfError: any) {
        console.error('Error generating PDF:', pdfError);
        showSnackbar(
          `Nie udało się wygenerować PDF: ${pdfError.message}. Wysyłam bez załącznika.`,
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
                <strong>Załącznik:</strong> Faktura_{invoiceNumber}.pdf
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
