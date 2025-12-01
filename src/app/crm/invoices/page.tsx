'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import {
  FileText,
  Plus,
  Search,
  Filter,
  Download,
  Eye,
  Edit,
  Trash2,
  CheckCircle,
  Clock,
  Send,
  XCircle,
  DollarSign,
  Calendar
} from 'lucide-react';

interface Invoice {
  id: string;
  invoice_number: string;
  invoice_type: 'proforma' | 'advance' | 'final' | 'corrective';
  status: 'draft' | 'issued' | 'sent' | 'paid' | 'overdue' | 'cancelled';
  issue_date: string;
  sale_date: string;
  payment_due_date: string;
  paid_date: string | null;
  buyer_name: string;
  buyer_nip: string | null;
  total_net: number;
  total_vat: number;
  total_gross: number;
  pdf_url: string | null;
  event_id: string | null;
  organization_id: string | null;
  created_at: string;
  event?: {
    title: string;
  };
  organization?: {
    name: string;
  };
}

export default function InvoicesPage() {
  const router = useRouter();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    fetchInvoices();
  }, []);

  const fetchInvoices = async () => {
    try {
      const { data, error } = await supabase
        .from('invoices')
        .select(`
          *,
          event:events(title),
          organization:organizations(name)
        `)
        .order('issue_date', { ascending: false });

      if (error) {
        console.error('Error fetching invoices:', error);
        return;
      }

      setInvoices(data || []);
    } catch (err) {
      console.error('Error:', err);
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      draft: { label: 'Szkic', color: 'bg-gray-500/20 text-gray-400 border-gray-500/30', icon: Clock },
      issued: { label: 'Wystawiona', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30', icon: FileText },
      sent: { label: 'Wysłana', color: 'bg-purple-500/20 text-purple-400 border-purple-500/30', icon: Send },
      paid: { label: 'Opłacona', color: 'bg-green-500/20 text-green-400 border-green-500/30', icon: CheckCircle },
      overdue: { label: 'Przeterminowana', color: 'bg-red-500/20 text-red-400 border-red-500/30', icon: Clock },
      cancelled: { label: 'Anulowana', color: 'bg-gray-500/20 text-gray-400 border-gray-500/30', icon: XCircle }
    };

    const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.draft;
    const Icon = config.icon;

    return (
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border ${config.color}`}>
        <Icon className="w-3.5 h-3.5" />
        {config.label}
      </span>
    );
  };

  const getTypeBadge = (type: string) => {
    const typeLabels = {
      proforma: 'Proforma',
      advance: 'Zaliczkowa',
      final: 'Końcowa',
      corrective: 'Korygująca'
    };

    return (
      <span className="text-xs text-[#e5e4e2]/60 bg-[#1c1f33] px-2 py-1 rounded">
        {typeLabels[type as keyof typeof typeLabels] || type}
      </span>
    );
  };

  const filteredInvoices = invoices.filter(invoice => {
    const matchesSearch =
      invoice.invoice_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      invoice.buyer_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (invoice.buyer_nip && invoice.buyer_nip.includes(searchTerm));

    const matchesType = filterType === 'all' || invoice.invoice_type === filterType;
    const matchesStatus = filterStatus === 'all' || invoice.status === filterStatus;

    return matchesSearch && matchesType && matchesStatus;
  });

  const totalNet = filteredInvoices.reduce((sum, inv) => sum + Number(inv.total_net), 0);
  const totalGross = filteredInvoices.reduce((sum, inv) => sum + Number(inv.total_gross), 0);
  const paidAmount = filteredInvoices
    .filter(inv => inv.status === 'paid')
    .reduce((sum, inv) => sum + Number(inv.total_gross), 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-[#e5e4e2]/60">Ładowanie...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0d1a] p-6">
      <div className="max-w-[1800px] mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-light text-[#e5e4e2] mb-2">Faktury VAT</h1>
            <p className="text-[#e5e4e2]/60">Zarządzaj fakturami i dokumentami finansowymi</p>
          </div>
          <button
            onClick={() => router.push('/crm/invoices/new')}
            className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-6 py-3 rounded-lg font-medium hover:bg-[#d3bb73]/90 transition-colors"
          >
            <Plus className="w-5 h-5" />
            Wystaw fakturę
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
            <div className="flex items-center gap-3 mb-2">
              <FileText className="w-5 h-5 text-[#d3bb73]" />
              <span className="text-sm text-[#e5e4e2]/60">Wszystkie faktury</span>
            </div>
            <div className="text-2xl font-light text-[#e5e4e2]">{filteredInvoices.length}</div>
          </div>

          <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
            <div className="flex items-center gap-3 mb-2">
              <DollarSign className="w-5 h-5 text-blue-400" />
              <span className="text-sm text-[#e5e4e2]/60">Suma netto</span>
            </div>
            <div className="text-2xl font-light text-[#e5e4e2]">
              {totalNet.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} zł
            </div>
          </div>

          <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
            <div className="flex items-center gap-3 mb-2">
              <DollarSign className="w-5 h-5 text-[#d3bb73]" />
              <span className="text-sm text-[#e5e4e2]/60">Suma brutto</span>
            </div>
            <div className="text-2xl font-light text-[#e5e4e2]">
              {totalGross.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} zł
            </div>
          </div>

          <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
            <div className="flex items-center gap-3 mb-2">
              <CheckCircle className="w-5 h-5 text-green-400" />
              <span className="text-sm text-[#e5e4e2]/60">Opłacone</span>
            </div>
            <div className="text-2xl font-light text-green-400">
              {paidAmount.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} zł
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6 mb-6">
          <div className="flex flex-col lg:flex-row gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#e5e4e2]/40" />
                <input
                  type="text"
                  placeholder="Szukaj po numerze, nazwie lub NIP..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg pl-12 pr-4 py-3 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                />
              </div>
            </div>

            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-2 px-4 py-3 rounded-lg border transition-colors ${
                showFilters
                  ? 'bg-[#d3bb73] border-[#d3bb73] text-[#1c1f33]'
                  : 'bg-[#0a0d1a] border-[#d3bb73]/20 text-[#e5e4e2] hover:border-[#d3bb73]/40'
              }`}
            >
              <Filter className="w-5 h-5" />
              Filtry
            </button>
          </div>

          {showFilters && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 pt-4 border-t border-[#d3bb73]/10">
              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">Typ faktury</label>
                <select
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value)}
                  className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                >
                  <option value="all">Wszystkie typy</option>
                  <option value="proforma">Proforma</option>
                  <option value="advance">Zaliczkowa</option>
                  <option value="final">Końcowa</option>
                  <option value="corrective">Korygująca</option>
                </select>
              </div>

              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">Status</label>
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                >
                  <option value="all">Wszystkie statusy</option>
                  <option value="draft">Szkic</option>
                  <option value="issued">Wystawiona</option>
                  <option value="sent">Wysłana</option>
                  <option value="paid">Opłacona</option>
                  <option value="overdue">Przeterminowana</option>
                  <option value="cancelled">Anulowana</option>
                </select>
              </div>
            </div>
          )}
        </div>

        {/* List */}
        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl overflow-hidden">
          {filteredInvoices.length === 0 ? (
            <div className="text-center py-16">
              <FileText className="w-16 h-16 text-[#e5e4e2]/20 mx-auto mb-4" />
              <p className="text-[#e5e4e2]/60 mb-4">
                {invoices.length === 0 ? 'Brak faktur' : 'Brak wyników wyszukiwania'}
              </p>
              {invoices.length === 0 && (
                <button
                  onClick={() => router.push('/crm/invoices/new')}
                  className="text-[#d3bb73] hover:text-[#d3bb73]/80"
                >
                  Wystaw pierwszą fakturę
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-[#0f1119] border-b border-[#d3bb73]/10">
                  <tr>
                    <th className="px-6 py-4 text-left text-xs font-medium text-[#e5e4e2]/60 uppercase tracking-wider">
                      Numer
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-medium text-[#e5e4e2]/60 uppercase tracking-wider">
                      Typ
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-medium text-[#e5e4e2]/60 uppercase tracking-wider">
                      Nabywca
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-medium text-[#e5e4e2]/60 uppercase tracking-wider">
                      Data wystawienia
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-medium text-[#e5e4e2]/60 uppercase tracking-wider">
                      Termin płatności
                    </th>
                    <th className="px-6 py-4 text-right text-xs font-medium text-[#e5e4e2]/60 uppercase tracking-wider">
                      Kwota brutto
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-medium text-[#e5e4e2]/60 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-4 text-right text-xs font-medium text-[#e5e4e2]/60 uppercase tracking-wider">
                      Akcje
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#d3bb73]/10">
                  {filteredInvoices.map((invoice) => (
                    <tr
                      key={invoice.id}
                      className="hover:bg-[#0f1119] transition-colors cursor-pointer"
                      onClick={() => router.push(`/crm/invoices/${invoice.id}`)}
                    >
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="font-medium text-[#e5e4e2]">{invoice.invoice_number}</div>
                        {invoice.event && (
                          <div className="text-xs text-[#e5e4e2]/40 mt-1">{invoice.event.title}</div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {getTypeBadge(invoice.invoice_type)}
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-[#e5e4e2]">{invoice.buyer_name}</div>
                        {invoice.buyer_nip && (
                          <div className="text-xs text-[#e5e4e2]/40 mt-1">NIP: {invoice.buyer_nip}</div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-[#e5e4e2]/80">
                        {new Date(invoice.issue_date).toLocaleDateString('pl-PL')}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2 text-[#e5e4e2]/80">
                          <Calendar className="w-4 h-4 text-[#e5e4e2]/40" />
                          {new Date(invoice.payment_due_date).toLocaleDateString('pl-PL')}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <div className="font-medium text-[#d3bb73]">
                          {Number(invoice.total_gross).toLocaleString('pl-PL', { minimumFractionDigits: 2 })} zł
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {getStatusBadge(invoice.status)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <div className="flex items-center justify-end gap-2">
                          {invoice.pdf_url && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                window.open(invoice.pdf_url!, '_blank');
                              }}
                              className="p-2 text-[#e5e4e2]/60 hover:text-[#d3bb73] hover:bg-[#d3bb73]/10 rounded-lg transition-colors"
                              title="Pobierz PDF"
                            >
                              <Download className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              router.push(`/crm/invoices/${invoice.id}`);
                            }}
                            className="p-2 text-[#e5e4e2]/60 hover:text-[#d3bb73] hover:bg-[#d3bb73]/10 rounded-lg transition-colors"
                            title="Zobacz szczegóły"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
