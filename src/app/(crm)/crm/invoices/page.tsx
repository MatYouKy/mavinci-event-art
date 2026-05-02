'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/browser';
import { FileText, Plus, Search, Filter, Download, Eye, Trash2, CheckCircle, Clock, Send, XCircle, DollarSign, Calendar, Building, MoreVertical, Settings, RotateCcw, AlertTriangle, RefreshCw, Save, LayoutGrid, Table2 } from 'lucide-react';
import KSeFIntegrationPanel from '@/components/crm/KSeFIntegrationPanel';
import FinancialDashboard from '@/components/crm/FinancialDashboard';
import KSeFFinancialDashboard from '@/components/crm/KSeFFinancialDashboard';
import PermissionGuard from '@/components/crm/PermissionGuard';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import ResponsiveActionBar from '@/components/crm/ResponsiveActionBar';
import { useDialog } from '@/contexts/DialogContext';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { InvoiceSettingsTab } from '@/components/crm/invoices/tabs/InvoiceSettingsTab';
import FinalInvoiceWizardModal from '@/components/crm/FinalInvoiceWizardModal';

interface Invoice {
  ksef_status: string;
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

function InvoiceContextMenu({ invoice, onView, onDelete, onCorrection, canManage, isAdmin }: {
  invoice: Invoice;
  onView: () => void;
  onDelete: () => void;
  onCorrection: () => void;
  canManage: boolean;
  isAdmin: boolean;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className="rounded-lg p-2 text-[#e5e4e2]/60 transition-colors hover:bg-[#d3bb73]/10 hover:text-[#d3bb73]"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open && (
        <div
          className="absolute right-0 top-full z-[9999] mt-1 w-52 overflow-hidden rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] shadow-2xl"
          style={{ zIndex: 9999 }}
        >
          {invoice.pdf_url && (
            <button
              onClick={(e) => { e.stopPropagation(); window.open(invoice.pdf_url!, '_blank'); setOpen(false); }}
              className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-[#e5e4e2] transition-colors hover:bg-[#d3bb73]/10"
            >
              <Download className="h-4 w-4 text-[#e5e4e2]/40" />
              Pobierz PDF
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onView(); setOpen(false); }}
            className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-[#e5e4e2] transition-colors hover:bg-[#d3bb73]/10"
          >
            <Eye className="h-4 w-4 text-[#e5e4e2]/40" />
            Zobacz fakture
          </button>
          {(canManage || isAdmin) && invoice.invoice_type !== 'corrective' && (
            <button
              onClick={(e) => { e.stopPropagation(); onCorrection(); setOpen(false); }}
              className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-[#e5e4e2] transition-colors hover:bg-[#d3bb73]/10"
            >
              <RotateCcw className="h-4 w-4 text-orange-400/60" />
              <span className="text-orange-400">Wystaw korekte</span>
            </button>
          )}
          {(canManage || isAdmin) && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(); setOpen(false); }}
              className="flex w-full items-center gap-3 border-t border-[#d3bb73]/10 px-4 py-3 text-left text-sm text-red-400 transition-colors hover:bg-red-500/10"
            >
              <Trash2 className="h-4 w-4" />
              Usun fakture
            </button>
          )}
        </div>
      )}
    </div>
  );
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
  const [activeTab, setActiveTab] = useState<'dashboard' | 'local' | 'ksef' | 'settings'>('dashboard');
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');
  const [myCompanies, setMyCompanies] = useState<any[]>([]);
  const [showFinalInvoiceWizard, setShowFinalInvoiceWizard] = useState(false);

  const { canManageModule, isAdmin, employee: currentEmployee } = useCurrentEmployee();

  const allowedCompanyIds = useMemo<string[] | null>(() => {
    if (isAdmin) return null;
    const ids = (currentEmployee as any)?.my_company_ids;
    if (!Array.isArray(ids) || ids.length === 0) return null;
    return ids as string[];
  }, [isAdmin, currentEmployee]);
  const { showConfirm } = useDialog();
  const { showSnackbar } = useSnackbar();

  const canManageInvoices = useMemo(() => canManageModule('invoices'), [canManageModule]);

  const handleDeleteInvoice = async (invoice: Invoice) => {
    if (!isAdmin && canManageInvoices) {
      const confirmed = await showConfirm({
        title: 'Wymagane potwierdzenie administratora',
        message: `Usuwanie faktury ${invoice.invoice_number} wymaga potwierdzenia przez administratora. Czy na pewno chcesz kontynuowac?`,
        confirmText: 'Usun (wymaga admin)',
        cancelText: 'Anuluj',
      });
      if (!confirmed) return;
    } else if (isAdmin) {
      const confirmed = await showConfirm({
        title: 'Usuwanie faktury',
        message: `Czy na pewno chcesz usunac fakture ${invoice.invoice_number}? Tej operacji nie mozna cofnac.`,
        confirmText: 'Usun',
        cancelText: 'Anuluj',
      });
      if (!confirmed) return;
    }

    try {
      const { error } = await supabase
        .from('invoices')
        .delete()
        .eq('id', invoice.id);

      if (error) throw error;
      showSnackbar('Faktura zostala usunieta', 'success');
      fetchInvoices();
    } catch (err) {
      console.error('Error deleting invoice:', err);
      showSnackbar('Blad podczas usuwania faktury', 'error');
    }
  };

  const handleCreateCorrection = async (invoice: Invoice) => {
    if (!isAdmin && canManageInvoices) {
      const confirmed = await showConfirm({
        title: 'Wymagane potwierdzenie administratora',
        message: `Wystawienie korekty do faktury ${invoice.invoice_number} wymaga potwierdzenia przez administratora. Czy na pewno chcesz kontynuowac?`,
        confirmText: 'Wystaw korekte (wymaga admin)',
        cancelText: 'Anuluj',
      });
      if (!confirmed) return;
    }

    router.push(`/crm/invoices/new?type=corrective&related=${invoice.id}`);
  };

  useEffect(() => {
    fetchInvoices();
    fetchMyCompanies();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowedCompanyIds]);

  const fetchMyCompanies = async () => {
    try {
      const { data, error } = await supabase
        .from('my_companies')
        .select('id, name')
        .eq('is_active', true)
        .order('is_default', { ascending: false });

      if (error) throw error;
      const filtered = allowedCompanyIds
        ? (data || []).filter((c: any) => allowedCompanyIds.includes(c.id))
        : data || [];
      setMyCompanies(filtered);
    } catch (err) {
      console.error('Error fetching companies:', err);
    }
  };

  const fetchInvoices = async () => {
    try {
      let query = supabase
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

      if (allowedCompanyIds) {
        query = query.in('my_company_id', allowedCompanyIds);
      }

      const { data, error } = await query;

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
      proforma: 'Faktura Proforma',
      advance: 'Zaliczkowa',
      corrective: 'Korygująca',
    };

    return (
      <span className="rounded bg-[#1c1f33] px-2 py-1 text-xs text-[#e5e4e2]/60">
        {typeLabels[type as keyof typeof typeLabels] || type}
      </span>
    );
  };

  const getRowColor = (invoice: Invoice) => {
    if (invoice.status === 'paid') return 'bg-green-500/[0.06] hover:bg-green-500/[0.12]';
    if (invoice.invoice_type === 'corrective') return 'bg-red-500/[0.06] hover:bg-red-500/[0.12]';
    if (invoice.invoice_type === 'advance') return 'bg-amber-500/[0.06] hover:bg-amber-500/[0.12]';
    if (invoice.invoice_type === 'proforma') return 'bg-blue-500/[0.04] hover:bg-blue-500/[0.08]';
    return 'hover:bg-[#0f1119]';
  };

  const getCardBorderColor = (invoice: Invoice) => {
    if (invoice.status === 'paid') return 'border-l-green-500';
    if (invoice.invoice_type === 'corrective') return 'border-l-red-500';
    if (invoice.invoice_type === 'advance') return 'border-l-amber-500';
    if (invoice.invoice_type === 'proforma') return 'border-l-blue-400';
    return 'border-l-[#d3bb73]/30';
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
                label: 'Faktura końcowa',
                onClick: () => setShowFinalInvoiceWizard(true),
                icon: <FileText className="h-5 w-5" />,
                variant: 'default',
              },
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
          ...(canManageInvoices ? [{ id: 'settings', label: 'Ustawienia faktur', icon: Settings }] : []),
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
          <>
            <KSeFFinancialDashboard />
            <div className="mt-8">
              <h3 className="text-xl font-light text-[#e5e4e2] mb-6">Faktury lokalne</h3>
              <FinancialDashboard />
            </div>
          </>
        ) : activeTab === 'ksef' ? (
          <KSeFIntegrationPanel />
        ) : activeTab === 'settings' ? (
          <InvoiceSettingsTab />
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

            <div className="flex items-center gap-2">
              <div className="flex overflow-hidden rounded-lg border border-[#d3bb73]/20">
                <button
                  onClick={() => setViewMode('table')}
                  className={`flex items-center gap-1.5 px-3 py-3 text-sm transition-colors ${
                    viewMode === 'table'
                      ? 'bg-[#d3bb73]/20 text-[#d3bb73]'
                      : 'text-[#e5e4e2]/50 hover:text-[#e5e4e2]'
                  }`}
                  title="Widok tabeli"
                >
                  <Table2 className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setViewMode('cards')}
                  className={`flex items-center gap-1.5 border-l border-[#d3bb73]/20 px-3 py-3 text-sm transition-colors ${
                    viewMode === 'cards'
                      ? 'bg-[#d3bb73]/20 text-[#d3bb73]'
                      : 'text-[#e5e4e2]/50 hover:text-[#e5e4e2]'
                  }`}
                  title="Widok kart"
                >
                  <LayoutGrid className="h-4 w-4" />
                </button>
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

        {filteredInvoices.length === 0 ? (
          <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] py-16 text-center">
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
        ) : viewMode === 'table' ? (
          <div className="overflow-hidden rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]">
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
                    <th className="hidden px-6 py-4 text-left text-xs font-medium uppercase tracking-wider text-[#e5e4e2]/60 lg:table-cell">
                      Firma
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider text-[#e5e4e2]/60">
                      Data wystawienia
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider text-[#e5e4e2]/60">
                      Termin platnosci
                    </th>
                    <th className="px-6 py-4 text-right text-xs font-medium uppercase tracking-wider text-[#e5e4e2]/60">
                      Netto
                    </th>
                    <th className="px-6 py-4 text-right text-xs font-medium uppercase tracking-wider text-[#e5e4e2]/60">
                      Brutto
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider text-[#e5e4e2]/60">
                      Status
                    </th>
                    <th className="px-6 py-4 text-right text-xs font-medium uppercase tracking-wider text-[#e5e4e2]/60">
                      Akcje
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#d3bb73]/5">
                  {filteredInvoices.map((invoice) => (
                    <tr
                      key={invoice.id}
                      className={`cursor-pointer transition-colors ${getRowColor(invoice)}`}
                      onClick={() => router.push(`/crm/invoices/${invoice.id}`)}
                    >
                      <td className="whitespace-nowrap px-6 py-3.5">
                        <div className="font-medium text-[#e5e4e2]">{invoice.invoice_number}</div>
                        {invoice.event && (
                          <div className="mt-0.5 text-xs text-[#e5e4e2]/40">{invoice.event.name}</div>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-6 py-3.5">
                        {getTypeBadge(invoice.invoice_type)}
                      </td>
                      <td className="px-6 py-3.5">
                        <div className="max-w-[200px] truncate text-[#e5e4e2]">{invoice.buyer_name}</div>
                        {invoice.buyer_nip && (
                          <div className="mt-0.5 text-xs text-[#e5e4e2]/40">
                            NIP: {invoice.buyer_nip}
                          </div>
                        )}
                      </td>
                      <td className="hidden whitespace-nowrap px-6 py-3.5 lg:table-cell">
                        <div className="text-xs text-[#e5e4e2]/50">
                          {(invoice as any).my_company?.name || '-'}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-6 py-3.5 text-sm text-[#e5e4e2]/80">
                        {new Date(invoice.issue_date).toLocaleDateString('pl-PL')}
                      </td>
                      <td className="whitespace-nowrap px-6 py-3.5">
                        <div className="flex items-center gap-1.5 text-sm text-[#e5e4e2]/80">
                          <Calendar className="h-3.5 w-3.5 text-[#e5e4e2]/30" />
                          {new Date(invoice.payment_due_date).toLocaleDateString('pl-PL')}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-6 py-3.5 text-right text-sm text-[#e5e4e2]/70">
                        {Number(invoice.total_net).toLocaleString('pl-PL', {
                          minimumFractionDigits: 2,
                        })}{' '}
                        zl
                      </td>
                      <td className="whitespace-nowrap px-6 py-3.5 text-right">
                        <div className="font-medium text-[#d3bb73]">
                          {Number(invoice.total_gross).toLocaleString('pl-PL', {
                            minimumFractionDigits: 2,
                          })}{' '}
                          zl
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-6 py-3.5">
                        <div className="flex items-center gap-2">
                          {getStatusBadge(invoice.status)}
                          {invoice.ksef_status && (
                            <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${
                              invoice.ksef_status === 'accepted'
                                ? 'bg-green-500/20 text-green-400'
                                : invoice.ksef_status === 'rejected'
                                  ? 'bg-red-500/20 text-red-400'
                                  : 'bg-blue-500/20 text-blue-400'
                            }`}>
                              KSeF
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-6 py-3.5 text-right">
                        <div className="flex items-center justify-end">
                          <InvoiceContextMenu
                            invoice={invoice}
                            onView={() => router.push(`/crm/invoices/${invoice.id}`)}
                            onDelete={() => handleDeleteInvoice(invoice)}
                            onCorrection={() => handleCreateCorrection(invoice)}
                            canManage={canManageInvoices}
                            isAdmin={isAdmin}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-[#d3bb73]/10 bg-[#0f1119] px-6 py-3">
              <div className="flex items-center justify-between text-xs text-[#e5e4e2]/40">
                <span>{filteredInvoices.length} {filteredInvoices.length === 1 ? 'faktura' : filteredInvoices.length < 5 ? 'faktury' : 'faktur'}</span>
                <div className="flex items-center gap-6">
                  <span>Netto: <span className="text-[#e5e4e2]/70">{totalNet.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} zl</span></span>
                  <span>Brutto: <span className="font-medium text-[#d3bb73]">{totalGross.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} zl</span></span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredInvoices.map((invoice) => (
              <div
                key={invoice.id}
                className={`cursor-pointer rounded-xl border border-[#d3bb73]/10 border-l-4 bg-[#1c1f33] p-5 transition-all hover:border-[#d3bb73]/20 hover:shadow-lg ${getCardBorderColor(invoice)}`}
                onClick={() => router.push(`/crm/invoices/${invoice.id}`)}
              >
                <div className="mb-3 flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-[#e5e4e2]">{invoice.invoice_number}</div>
                    <div className="mt-0.5 text-xs text-[#e5e4e2]/40">{getTypeBadge(invoice.invoice_type)}</div>
                  </div>
                  <div className="ml-3 flex items-center gap-2">
                    {getStatusBadge(invoice.status)}
                    {invoice.ksef_status && (
                      <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${
                        invoice.ksef_status === 'accepted'
                          ? 'bg-green-500/20 text-green-400'
                          : invoice.ksef_status === 'rejected'
                            ? 'bg-red-500/20 text-red-400'
                            : 'bg-blue-500/20 text-blue-400'
                      }`}>
                        KSeF
                      </span>
                    )}
                  </div>
                </div>

                <div className="mb-3">
                  <div className="truncate text-sm text-[#e5e4e2]/80">{invoice.buyer_name}</div>
                  {invoice.buyer_nip && (
                    <div className="text-xs text-[#e5e4e2]/40">NIP: {invoice.buyer_nip}</div>
                  )}
                </div>

                {invoice.event && (
                  <div className="mb-3 truncate text-xs text-[#e5e4e2]/40">{invoice.event.name}</div>
                )}

                <div className="flex items-end justify-between border-t border-[#d3bb73]/10 pt-3">
                  <div className="space-y-1 text-xs text-[#e5e4e2]/50">
                    <div className="flex items-center gap-1.5">
                      <Calendar className="h-3 w-3" />
                      {new Date(invoice.issue_date).toLocaleDateString('pl-PL')}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Clock className="h-3 w-3" />
                      Termin: {new Date(invoice.payment_due_date).toLocaleDateString('pl-PL')}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-[#e5e4e2]/40">
                      {Number(invoice.total_net).toLocaleString('pl-PL', { minimumFractionDigits: 2 })} zl netto
                    </div>
                    <div className="text-lg font-medium text-[#d3bb73]">
                      {Number(invoice.total_gross).toLocaleString('pl-PL', { minimumFractionDigits: 2 })} zl
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        </>
        )}
        </div>
      </div>
      {showFinalInvoiceWizard && (
        <FinalInvoiceWizardModal
          onClose={() => setShowFinalInvoiceWizard(false)}
          onCreated={(id) => {
            setShowFinalInvoiceWizard(false);
            router.push(`/crm/invoices/${id}`);
          }}
        />
      )}
    </PermissionGuard>
  );
}
