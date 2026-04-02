'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/browser';
import { FileText, Plus, Search, Filter, Download, Eye, CreditCard as Edit, Trash2, CheckCircle, Clock, Send, XCircle, DollarSign, Calendar, Building2, Building } from 'lucide-react';
import KSeFIntegrationPanel from '@/components/crm/KSeFIntegrationPanel';
import FinancialDashboard from '@/components/crm/FinancialDashboard';
import PermissionGuard from '@/components/crm/PermissionGuard';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import ResponsiveActionBar from '@/components/crm/ResponsiveActionBar';

interface Invoice {
  id: string;
  invoice_number: string;
  invoice_type: 'vat' | 'proforma' | 'advance' | 'corrective';
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
    name: string | null;
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
  const [filterCompany, setFilterCompany] = useState<string>('all');
  const [showFilters, setShowFilters] = useState(false);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'invoices' | 'ksef'>('dashboard');
  const [myCompanies, setMyCompanies] = useState<any[]>([]);

  const { canManageModule } = useCurrentEmployee();

  const canManageInvoices = useMemo(() => canManageModule('invoices'), [canManageModule]);

  console.log('canManageInvoices', canManageInvoices);

  useEffect(() => {
    fetchInvoices();
    fetchMyCompanies();
  }, []);

  const fetchMyCompanies = async () => {
    try {
      const { data, error } = await supabase
        .from('my_companies')
        .select('id, name')
        .eq('is_active', true)
        .order('is_default', { ascending: false });

      if (error) throw error;
      setMyCompanies(data || []);
    } catch (err) {
      console.error('Error fetching companies:', err);
    }
  };

  const fetchInvoices = async () => {
    try {
      const { data, error } = await supabase
        .from('invoices')
        .select(
          `
          *,
          event:events(name),
          organization:organizations(name),
          my_company:my_companies(id, name)
        `,
        )
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
      draft: {
        label: 'Szkic',
        color: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
        icon: Clock,
      },
      issued: {
        label: 'Wystawiona',
        color: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
        icon: FileText,
      },
      sent: {
        label: 'Wysłana',
        color: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
        icon: Send,
      },
      paid: {
        label: 'Opłacona',
        color: 'bg-green-500/20 text-green-400 border-green-500/30',
        icon: CheckCircle,
      },
      overdue: {
        label: 'Przeterminowana',
        color: 'bg-red-500/20 text-red-400 border-red-500/30',
        icon: Clock,
      },
      cancelled: {
        label: 'Anulowana',
        color: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
        icon: XCircle,
      },
    };

    const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.draft;
    const Icon = config.icon;

    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium ${config.color}`}
      >
        <Icon className="h-3.5 w-3.5" />
        {config.label}
      </span>
    );
  };

  const getTypeBadge = (type: string) => {
    const typeLabels = {
      vat: 'Faktura VAT',
      proforma: 'Proforma',
      advance: 'Zaliczkowa',
      corrective: 'Korygująca',
    };

    return (
      <span className="rounded bg-[#1c1f33] px-2 py-1 text-xs text-[#e5e4e2]/60">
        {typeLabels[type as keyof typeof typeLabels] || type}
      </span>
    );
  };

  const filteredInvoices = invoices.filter((invoice) => {
    const matchesSearch =
      invoice.invoice_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      invoice.buyer_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (invoice.buyer_nip && invoice.buyer_nip.includes(searchTerm));

    const matchesType = filterType === 'all' || invoice.invoice_type === filterType;
    const matchesStatus = filterStatus === 'all' || invoice.status === filterStatus;
    const matchesCompany = filterCompany === 'all' || (invoice as any).my_company_id === filterCompany;

    return matchesSearch && matchesType && matchesStatus && matchesCompany;
  });

  const totalNet = filteredInvoices.reduce((sum, inv) => sum + Number(inv.total_net), 0);
  const totalGross = filteredInvoices.reduce((sum, inv) => sum + Number(inv.total_gross), 0);
  const paidAmount = filteredInvoices
    .filter((inv) => inv.status === 'paid')
    .reduce((sum, inv) => sum + Number(inv.total_gross), 0);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-[#e5e4e2]/60">Ładowanie...</div>
      </div>
    );
  }

  return (
    <PermissionGuard module="invoices">
      <div className="min-h-screen bg-[#0a0d1a] p-6">
        <div className="mx-auto max-w-[1800px]">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="mb-2 text-3xl font-light text-[#e5e4e2]">Faktury VAT</h1>
            <p className="text-[#e5e4e2]/60">Zarządzaj fakturami i dokumentami finansowymi</p>
          </div>

          <ResponsiveActionBar
            actions={canManageInvoices ? [
              {
                label: 'Wystaw fakturę',
                onClick: () => router.push('/crm/invoices/new'),
                icon: <Plus className="h-5 w-5" />,
                variant: 'primary',
              },
            ] : []}
          />
        </div>

        <div className="flex gap-2 overflow-x-auto border-b border-[#d3bb73]/10 mb-6">
        {[
          { id: 'dashboard', label: 'Dashboard', icon: DollarSign },
          { id: 'ksef', label: 'KSeF', icon: FileText },
          { id: 'local', label: 'Lokalne faktury', icon: Building },
        ]
          .filter((tab) => {
            return true;
          })
          .map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'border-[#d3bb73] text-[#d3bb73]'
                    : 'border-transparent text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
      </div>

        {activeTab === 'dashboard' ? (
          <FinancialDashboard />
        ) : activeTab === 'ksef' ? (
          <KSeFIntegrationPanel />
        ) : (
          <>
        {/* Original content */}

        {/* Stats */}
        <div className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-4">
          <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
            <div className="mb-2 flex items-center gap-3">
              <FileText className="h-5 w-5 text-[#d3bb73]" />
              <span className="text-sm text-[#e5e4e2]/60">Wszystkie faktury</span>
            </div>
            <div className="text-2xl font-light text-[#e5e4e2]">{filteredInvoices.length}</div>
          </div>

          <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
            <div className="mb-2 flex items-center gap-3">
              <DollarSign className="h-5 w-5 text-blue-400" />
              <span className="text-sm text-[#e5e4e2]/60">Suma netto</span>
            </div>
            <div className="text-2xl font-light text-[#e5e4e2]">
              {totalNet.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} zł
            </div>
          </div>

          <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
            <div className="mb-2 flex items-center gap-3">
              <DollarSign className="h-5 w-5 text-[#d3bb73]" />
              <span className="text-sm text-[#e5e4e2]/60">Suma brutto</span>
            </div>
            <div className="text-2xl font-light text-[#e5e4e2]">
              {totalGross.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} zł
            </div>
          </div>

          <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
            <div className="mb-2 flex items-center gap-3">
              <CheckCircle className="h-5 w-5 text-green-400" />
              <span className="text-sm text-[#e5e4e2]/60">Opłacone</span>
            </div>
            <div className="text-2xl font-light text-green-400">
              {paidAmount.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} zł
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="mb-6 rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          <div className="flex flex-col gap-4 lg:flex-row">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#e5e4e2]/40" />
                <input
                  type="text"
                  placeholder="Szukaj po numerze, nazwie lub NIP..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] py-3 pl-12 pr-4 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                />
              </div>
            </div>

            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-2 rounded-lg border px-4 py-3 transition-colors ${
                showFilters
                  ? 'border-[#d3bb73] bg-[#d3bb73] text-[#1c1f33]'
                  : 'border-[#d3bb73]/20 bg-[#0a0d1a] text-[#e5e4e2] hover:border-[#d3bb73]/40'
              }`}
            >
              <Filter className="h-5 w-5" />
              Filtry
            </button>
          </div>

          {showFilters && (
            <div className="mt-4 grid grid-cols-1 gap-4 border-t border-[#d3bb73]/10 pt-4 md:grid-cols-3">
              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Moja firma</label>
                <select
                  value={filterCompany}
                  onChange={(e) => setFilterCompany(e.target.value)}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                >
                  <option value="all">Wszystkie firmy</option>
                  {myCompanies.map((company) => (
                    <option key={company.id} value={company.id}>
                      {company.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Typ faktury</label>
                <select
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value)}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                >
                  <option value="all">Wszystkie typy</option>
                  <option value="vat">Faktura VAT</option>
                  <option value="proforma">Proforma</option>
                  <option value="advance">Zaliczkowa</option>
                  <option value="corrective">Korygująca</option>
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Status</label>
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
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
        <div className="overflow-hidden rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]">
          {filteredInvoices.length === 0 ? (
            <div className="py-16 text-center">
              <FileText className="mx-auto mb-4 h-16 w-16 text-[#e5e4e2]/20" />
              <p className="mb-4 text-[#e5e4e2]/60">
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
                <thead className="border-b border-[#d3bb73]/10 bg-[#0f1119]">
                  <tr>
                    <th className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider text-[#e5e4e2]/60">
                      Numer
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider text-[#e5e4e2]/60">
                      Typ
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider text-[#e5e4e2]/60">
                      Nabywca
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider text-[#e5e4e2]/60">
                      Data wystawienia
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider text-[#e5e4e2]/60">
                      Termin płatności
                    </th>
                    <th className="px-6 py-4 text-right text-xs font-medium uppercase tracking-wider text-[#e5e4e2]/60">
                      Kwota brutto
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider text-[#e5e4e2]/60">
                      Status
                    </th>
                    <th className="px-6 py-4 text-right text-xs font-medium uppercase tracking-wider text-[#e5e4e2]/60">
                      Akcje
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#d3bb73]/10">
                  {filteredInvoices.map((invoice) => (
                    <tr
                      key={invoice.id}
                      className="cursor-pointer transition-colors hover:bg-[#0f1119]"
                      onClick={() => router.push(`/crm/invoices/${invoice.id}`)}
                    >
                      <td className="whitespace-nowrap px-6 py-4">
                        <div className="font-medium text-[#e5e4e2]">{invoice.invoice_number}</div>
                        {invoice.event && (
                          <div className="mt-1 text-xs text-[#e5e4e2]/40">{invoice.event.name}</div>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4">
                        {getTypeBadge(invoice.invoice_type)}
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-[#e5e4e2]">{invoice.buyer_name}</div>
                        {invoice.buyer_nip && (
                          <div className="mt-1 text-xs text-[#e5e4e2]/40">
                            NIP: {invoice.buyer_nip}
                          </div>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-[#e5e4e2]/80">
                        {new Date(invoice.issue_date).toLocaleDateString('pl-PL')}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4">
                        <div className="flex items-center gap-2 text-[#e5e4e2]/80">
                          <Calendar className="h-4 w-4 text-[#e5e4e2]/40" />
                          {new Date(invoice.payment_due_date).toLocaleDateString('pl-PL')}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-right">
                        <div className="font-medium text-[#d3bb73]">
                          {Number(invoice.total_gross).toLocaleString('pl-PL', {
                            minimumFractionDigits: 2,
                          })}{' '}
                          zł
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4">
                        {getStatusBadge(invoice.status)}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {invoice.pdf_url && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                window.open(invoice.pdf_url!, '_blank');
                              }}
                              className="rounded-lg p-2 text-[#e5e4e2]/60 transition-colors hover:bg-[#d3bb73]/10 hover:text-[#d3bb73]"
                              title="Pobierz PDF"
                            >
                              <Download className="h-4 w-4" />
                            </button>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              router.push(`/crm/invoices/${invoice.id}`);
                            }}
                            className="rounded-lg p-2 text-[#e5e4e2]/60 transition-colors hover:bg-[#d3bb73]/10 hover:text-[#d3bb73]"
                            title="Zobacz szczegóły"
                          >
                            <Eye className="h-4 w-4" />
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
        </>
        )}
        </div>
      </div>
    </PermissionGuard>
  );
}
