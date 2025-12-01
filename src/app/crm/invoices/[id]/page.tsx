'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { ArrowLeft, Download, Edit, Printer, Send, CheckCircle, XCircle, Building2, Calendar, FileText, Link as LinkIcon } from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';

interface Invoice {
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
  event_id: string | null;
  organization_id: string | null;
  related_invoice_id: string | null;
}

interface RelatedData {
  event?: { id: string; name: string; event_date: string } | null;
  organization?: { id: string; name: string; nip: string } | null;
  relatedInvoice?: { id: string; invoice_number: string; invoice_type: string } | null;
  relatedInvoices?: Array<{ id: string; invoice_number: string; invoice_type: string; relation_type: string }>;
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

export default function InvoiceDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [relatedData, setRelatedData] = useState<RelatedData>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchInvoice();
  }, [params.id]);

  const fetchInvoice = async () => {
    try {
      const [invoiceRes, itemsRes] = await Promise.all([
        supabase.from('invoices').select('*').eq('id', params.id).single(),
        supabase.from('invoice_items').select('*').eq('invoice_id', params.id).order('position_number')
      ]);

      if (invoiceRes.data) {
        setInvoice(invoiceRes.data);

        const promises = [];

        if (invoiceRes.data.event_id) {
          promises.push(
            supabase.from('events').select('id, name, event_date').eq('id', invoiceRes.data.event_id).maybeSingle()
          );
        }

        if (invoiceRes.data.organization_id) {
          promises.push(
            supabase.from('organizations').select('id, name, nip').eq('id', invoiceRes.data.organization_id).maybeSingle()
          );
        }

        if (invoiceRes.data.related_invoice_id) {
          promises.push(
            supabase.from('invoices').select('id, invoice_number, invoice_type').eq('id', invoiceRes.data.related_invoice_id).maybeSingle()
          );
        }

        promises.push(
          supabase.rpc('get_related_invoices', { p_invoice_id: params.id })
        );

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

        setRelatedData(related);
      }

      if (itemsRes.data) setItems(itemsRes.data);
    } catch (err) {
      console.error('Error fetching invoice:', err);
      showSnackbar('Błąd podczas ładowania faktury', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleGeneratePDF = async () => {
    showSnackbar('Generowanie PDF - wkrótce dostępne', 'info');
  };

  const handleStatusChange = async (newStatus: string) => {
    try {
      const { error } = await supabase
        .from('invoices')
        .update({ status: newStatus })
        .eq('id', params.id);

      if (error) throw error;

      setInvoice(prev => prev ? { ...prev, status: newStatus } : null);
      showSnackbar('Status faktury został zmieniony', 'success');
    } catch (err) {
      console.error('Error updating status:', err);
      showSnackbar('Błąd podczas zmiany statusu', 'error');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0a0d1a]">
        <div className="text-[#e5e4e2]/60">Ładowanie...</div>
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0a0d1a]">
        <div className="text-[#e5e4e2]/60">Faktura nie została znaleziona</div>
      </div>
    );
  }

  const getTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      vat: 'Faktura VAT',
      proforma: 'Proforma',
      advance: 'Zaliczkowa',
      corrective: 'Korygująca'
    };
    return labels[type] || type;
  };

  return (
    <div className="min-h-screen bg-[#0a0d1a] p-6">
      <div className="max-w-5xl mx-auto">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 text-[#e5e4e2]/60 hover:text-[#d3bb73] mb-6"
        >
          <ArrowLeft className="w-5 h-5" />
          Powrót
        </button>

        {/* Relations Section */}
        {(relatedData.event || relatedData.organization || relatedData.relatedInvoice || (relatedData.relatedInvoices && relatedData.relatedInvoices.length > 0)) && (
          <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6 mb-6">
            <h3 className="text-lg font-medium text-[#e5e4e2] mb-4 flex items-center gap-2">
              <LinkIcon className="w-5 h-5 text-[#d3bb73]" />
              Powiązania
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {relatedData.event && (
                <div
                  onClick={() => router.push(`/crm/events/${relatedData.event!.id}`)}
                  className="bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg p-4 hover:border-[#d3bb73]/40 cursor-pointer transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <Calendar className="w-5 h-5 text-blue-400 mt-0.5" />
                    <div className="flex-1">
                      <div className="text-xs text-[#e5e4e2]/40 mb-1">Event</div>
                      <div className="text-[#e5e4e2] font-medium">{relatedData.event.name}</div>
                      <div className="text-xs text-[#e5e4e2]/60 mt-1">
                        {new Date(relatedData.event.event_date).toLocaleDateString('pl-PL')}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {relatedData.organization && (
                <div
                  onClick={() => router.push(`/crm/contacts?org=${relatedData.organization!.id}`)}
                  className="bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg p-4 hover:border-[#d3bb73]/40 cursor-pointer transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <Building2 className="w-5 h-5 text-[#d3bb73] mt-0.5" />
                    <div className="flex-1">
                      <div className="text-xs text-[#e5e4e2]/40 mb-1">Organizacja</div>
                      <div className="text-[#e5e4e2] font-medium">{relatedData.organization.name}</div>
                      {relatedData.organization.nip && (
                        <div className="text-xs text-[#e5e4e2]/60 mt-1">NIP: {relatedData.organization.nip}</div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {relatedData.relatedInvoice && (
                <div
                  onClick={() => router.push(`/crm/invoices/${relatedData.relatedInvoice!.id}`)}
                  className="bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg p-4 hover:border-[#d3bb73]/40 cursor-pointer transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <FileText className="w-5 h-5 text-purple-400 mt-0.5" />
                    <div className="flex-1">
                      <div className="text-xs text-[#e5e4e2]/40 mb-1">Powiązana faktura</div>
                      <div className="text-[#e5e4e2] font-medium">{relatedData.relatedInvoice.invoice_number}</div>
                      <div className="text-xs text-[#e5e4e2]/60 mt-1">{getTypeLabel(relatedData.relatedInvoice.invoice_type)}</div>
                    </div>
                  </div>
                </div>
              )}

              {relatedData.relatedInvoices && relatedData.relatedInvoices.length > 0 && (
                <div className="bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <FileText className="w-5 h-5 text-orange-400 mt-0.5" />
                    <div className="flex-1">
                      <div className="text-xs text-[#e5e4e2]/40 mb-2">Faktury korygujące</div>
                      {relatedData.relatedInvoices.map((rel) => (
                        <div
                          key={rel.id}
                          onClick={() => router.push(`/crm/invoices/${rel.id}`)}
                          className="text-[#e5e4e2] hover:text-[#d3bb73] cursor-pointer mb-1"
                        >
                          {rel.invoice_number} <span className="text-xs text-[#e5e4e2]/60">({getTypeLabel(rel.invoice_type)})</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Header Actions */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-light text-[#e5e4e2] mb-2">
              Faktura {invoice.invoice_number}
            </h1>
            <p className="text-[#e5e4e2]/60">
              {getTypeLabel(invoice.invoice_type)}
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleGeneratePDF}
              className="flex items-center gap-2 px-4 py-2 bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] hover:bg-[#d3bb73]/5"
            >
              <Download className="w-4 h-4" />
              Pobierz PDF
            </button>
            <button
              onClick={handleGeneratePDF}
              className="flex items-center gap-2 px-4 py-2 bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] hover:bg-[#d3bb73]/5"
            >
              <Printer className="w-4 h-4" />
              Drukuj
            </button>
            {invoice.status === 'draft' && (
              <button
                onClick={() => handleStatusChange('issued')}
                className="flex items-center gap-2 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90"
              >
                <CheckCircle className="w-4 h-4" />
                Wystaw
              </button>
            )}
          </div>
        </div>

        {/* Invoice Preview */}
        <div className="bg-white text-black rounded-xl p-12 mb-6">
          {/* Header */}
          <div className="flex justify-between items-start mb-12">
            <div>
              <div className="text-4xl font-bold mb-2">MAVINCI</div>
              <div className="text-sm text-gray-600">event & art</div>
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
                <div className="text-gray-600">Data sprzedaży</div>
                <div className="font-medium">
                  {new Date(invoice.sale_date).toLocaleDateString('pl-PL')}
                </div>
              </div>
            </div>
          </div>

          {/* Seller & Buyer */}
          <div className="grid grid-cols-2 gap-12 mb-12">
            <div>
              <div className="text-sm text-gray-600 mb-2">Sprzedawca</div>
              <div className="font-medium">{invoice.seller_name}</div>
              <div className="text-sm">NIP: {invoice.seller_nip}</div>
              <div className="text-sm">{invoice.seller_street}</div>
              <div className="text-sm">{invoice.seller_postal_code} {invoice.seller_city}</div>
            </div>
            <div>
              <div className="text-sm text-gray-600 mb-2">Nabywca</div>
              <div className="font-medium">{invoice.buyer_name}</div>
              {invoice.buyer_nip && <div className="text-sm">NIP: {invoice.buyer_nip}</div>}
              <div className="text-sm">{invoice.buyer_street}</div>
              <div className="text-sm">{invoice.buyer_postal_code} {invoice.buyer_city}</div>
            </div>
          </div>

          {/* Invoice Number */}
          <div className="text-center mb-8">
            <div className="text-2xl font-bold">Faktura VAT {invoice.invoice_number}</div>
          </div>

          {/* Items Table */}
          <table className="w-full mb-8 text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="border border-gray-300 p-2 text-left">Lp.</th>
                <th className="border border-gray-300 p-2 text-left">Nazwa towaru lub usługi</th>
                <th className="border border-gray-300 p-2">Jm.</th>
                <th className="border border-gray-300 p-2">Ilość</th>
                <th className="border border-gray-300 p-2">Cena netto</th>
                <th className="border border-gray-300 p-2">Wartość netto</th>
                <th className="border border-gray-300 p-2">Stawka VAT</th>
                <th className="border border-gray-300 p-2">Kwota VAT</th>
                <th className="border border-gray-300 p-2">Wartość brutto</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="border border-gray-300 p-2">{item.position_number}</td>
                  <td className="border border-gray-300 p-2">{item.name}</td>
                  <td className="border border-gray-300 p-2 text-center">{item.unit}</td>
                  <td className="border border-gray-300 p-2 text-right">{item.quantity}</td>
                  <td className="border border-gray-300 p-2 text-right">{item.price_net.toFixed(2)}</td>
                  <td className="border border-gray-300 p-2 text-right">{item.value_net.toFixed(2)}</td>
                  <td className="border border-gray-300 p-2 text-center">{item.vat_rate}%</td>
                  <td className="border border-gray-300 p-2 text-right">{item.vat_amount.toFixed(2)}</td>
                  <td className="border border-gray-300 p-2 text-right font-medium">{item.value_gross.toFixed(2)}</td>
                </tr>
              ))}
              <tr className="font-medium">
                <td colSpan={5} className="border border-gray-300 p-2 text-right">W tym</td>
                <td className="border border-gray-300 p-2 text-right">{invoice.total_net.toFixed(2)}</td>
                <td className="border border-gray-300 p-2 text-center">23%</td>
                <td className="border border-gray-300 p-2 text-right">{invoice.total_vat.toFixed(2)}</td>
                <td className="border border-gray-300 p-2 text-right">{invoice.total_gross.toFixed(2)}</td>
              </tr>
              <tr className="font-bold bg-gray-100">
                <td colSpan={5} className="border border-gray-300 p-2 text-right">Razem</td>
                <td className="border border-gray-300 p-2 text-right">{invoice.total_net.toFixed(2)}</td>
                <td className="border border-gray-300 p-2"></td>
                <td className="border border-gray-300 p-2 text-right">{invoice.total_vat.toFixed(2)}</td>
                <td className="border border-gray-300 p-2 text-right">{invoice.total_gross.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>

          {/* Payment Details */}
          <div className="grid grid-cols-2 gap-12 mb-8 text-sm">
            <div>
              <div className="mb-2">
                <span className="text-gray-600">Sposób płatności:</span> {invoice.payment_method}
              </div>
              <div className="mb-2">
                <span className="text-gray-600">Termin płatności:</span>{' '}
                {new Date(invoice.payment_due_date).toLocaleDateString('pl-PL')}
              </div>
              <div>
                <span className="text-gray-600">Numer konta:</span>
                <div className="font-mono">{invoice.bank_account}</div>
              </div>
            </div>
            <div>
              <div className="mb-2">
                <span className="text-gray-600">Do zapłaty:</span>{' '}
                <span className="font-bold text-lg">{invoice.total_gross.toFixed(2)} PLN</span>
              </div>
              <div className="text-gray-600 text-xs">
                Słownie: {/* Tu można dodać funkcję zamiany liczby na słowa */}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="text-xs text-gray-600 mb-8">
            Niniejsza faktura jest wezwaniem do zapłaty zgodnie z artykułem 455kc. po przekroczeniu terminu płatności będą naliczane ustawowe odsetki za zwłokę.
          </div>

          {/* Signature */}
          <div className="flex justify-end">
            <div className="text-center border-t border-gray-300 pt-2 w-64">
              <div className="text-sm mb-1">Mateusz Kwiatkowski</div>
              <div className="text-xs text-gray-600">Podpis osoby upoważnionej do wystawienia</div>
            </div>
          </div>

          <div className="text-center mt-8 text-xs text-gray-500">
            www.mavinci.pl
          </div>
        </div>

        {/* Status Change */}
        {invoice.status !== 'paid' && invoice.status !== 'cancelled' && (
          <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
            <h3 className="text-lg font-medium text-[#e5e4e2] mb-4">Zmiana statusu</h3>
            <div className="flex gap-3">
              {invoice.status === 'issued' && (
                <button
                  onClick={() => handleStatusChange('sent')}
                  className="flex items-center gap-2 px-4 py-2 bg-purple-500/20 text-purple-400 border border-purple-500/30 rounded-lg hover:bg-purple-500/30"
                >
                  <Send className="w-4 h-4" />
                  Oznacz jako wysłaną
                </button>
              )}
              {(invoice.status === 'issued' || invoice.status === 'sent') && (
                <button
                  onClick={() => handleStatusChange('paid')}
                  className="flex items-center gap-2 px-4 py-2 bg-green-500/20 text-green-400 border border-green-500/30 rounded-lg hover:bg-green-500/30"
                >
                  <CheckCircle className="w-4 h-4" />
                  Oznacz jako opłaconą
                </button>
              )}
              <button
                onClick={() => handleStatusChange('cancelled')}
                className="flex items-center gap-2 px-4 py-2 bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/30"
              >
                <XCircle className="w-4 h-4" />
                Anuluj fakturę
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
