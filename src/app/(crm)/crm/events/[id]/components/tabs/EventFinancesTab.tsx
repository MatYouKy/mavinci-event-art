'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/browser';
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Receipt,
  Plus,
  Trash2,
  Edit,
  Check,
  X,
  FileText,
  Calendar,
  Fuel,
  Users,
  Package,
  Truck,
  Upload,
  Eye,
  AlertCircle,
  Building2,
  User,
  Info,
} from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';

interface FinancialSummary {
  expected_revenue: number;
  actual_revenue: number;
  estimated_costs: number;
  actual_costs: number;
  expected_profit: number;
  actual_profit: number;
  profit_margin_expected: number;
  profit_margin_actual: number;
  invoices_count: number;
  invoices_paid_count: number;
  invoices_total: number;
  costs_count: number;
  costs_paid_count: number;
  costs_total: number;
  cash_budget: number;
  actual_cash_revenue: number;
  total_revenue: number;
  client_type: string;
  is_cash_only: boolean;
}

interface CashTransaction {
  id: string;
  transaction_date: string;
  amount: number;
  description: string;
  transaction_type: 'income' | 'expense';
  category: string | null;
  confirmed: boolean;
  handled_by_name: string | null;
  notes: string | null;
}

interface Invoice {
  id: string;
  invoice_number: string;
  invoice_type: string;
  status: string;
  issue_date: string;
  total_gross: number;
  buyer_name: string;
}

interface Cost {
  id: string;
  name: string;
  description: string;
  amount: number;
  cost_date: string;
  status: string;
  payment_method: string;
  category: { name: string; color: string };
  subcontractor?: { company_name: string };
  created_by_name: string;
}

interface ClientInfo {
  client_type: string;
  client_name: string;
  client_nip: string | null;
  is_business: boolean;
  can_invoice: boolean;
}

interface Props {
  eventId: string;
}

export default function EventFinancesTab({ eventId }: Props) {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();

  const [summary, setSummary] = useState<FinancialSummary | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [costs, setCosts] = useState<Cost[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [clientInfo, setClientInfo] = useState<ClientInfo | null>(null);
  const [cashTransactions, setCashTransactions] = useState<CashTransaction[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showAddCashModal, setShowAddCashModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showAddCost, setShowAddCost] = useState(false);

  // Formularz kosztu
  const [costForm, setCostForm] = useState({
    name: '',
    description: '',
    amount: 0,
    cost_date: new Date().toISOString().split('T')[0],
    category_id: '',
    status: 'pending' as 'pending' | 'approved' | 'paid' | 'rejected',
    payment_method: 'transfer',
  });

  useEffect(() => {
    checkAdminPermissions();
    fetchFinancialData();
  }, [eventId]);

  const checkAdminPermissions = async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.user?.id) return;

    const { data: employee } = await supabase
      .from('employees')
      .select('role, permissions')
      .eq('id', session.user.id)
      .single();

    const hasFinancesAccess =
      employee?.role === 'admin' || employee?.permissions?.includes('finances_manage');
    setIsAdmin(hasFinancesAccess);
  };

  const fetchFinancialData = async () => {
    try {
      const [summaryRes, invoicesRes, costsRes, categoriesRes, clientInfoRes] = await Promise.all([
        supabase.rpc('get_event_financial_summary', { p_event_id: eventId }),
        supabase
          .from('invoices')
          .select('*')
          .eq('event_id', eventId)
          .order('issue_date', { ascending: false }),
        supabase
          .from('event_costs')
          .select(
            `
          *,
          category:event_cost_categories(name, color),
          subcontractor:subcontractors(company_name),
          creator:created_by(name, surname)
        `,
          )
          .eq('event_id', eventId)
          .order('cost_date', { ascending: false }),
        supabase.from('event_cost_categories').select('*').eq('is_active', true).order('name'),
        supabase.rpc('get_event_client_info', { p_event_id: eventId }),
      ]);

      if (summaryRes.data?.[0]) setSummary(summaryRes.data[0]);
      if (invoicesRes.data) setInvoices(invoicesRes.data);
      if (clientInfoRes.data?.[0]) setClientInfo(clientInfoRes.data[0]);
      if (costsRes.data) {
        const formattedCosts = costsRes.data.map((cost: any) => ({
          ...cost,
          created_by_name: cost.creator ? `${cost.creator.name} ${cost.creator.surname}` : 'System',
        }));
        setCosts(formattedCosts);
      }
      if (categoriesRes.data) setCategories(categoriesRes.data);

      // Pobierz transakcje gotówkowe (tylko dla adminów)
      if (isAdmin) {
        const cashRes = await supabase
          .from('event_cash_transactions')
          .select('*')
          .eq('event_id', eventId)
          .order('transaction_date', { ascending: false });

        if (cashRes.data) setCashTransactions(cashRes.data);
      }
    } catch (err) {
      console.error('Error fetching financial data:', err);
      showSnackbar('Błąd podczas ładowania danych finansowych', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleAddCost = async () => {
    if (!costForm.name || !costForm.category_id || costForm.amount <= 0) {
      showSnackbar('Wypełnij wszystkie wymagane pola', 'error');
      return;
    }

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data: employee } = await supabase
        .from('employees')
        .select('id')
        .eq('email', user?.email)
        .maybeSingle();

      const { error } = await supabase.from('event_costs').insert({
        event_id: eventId,
        ...costForm,
        created_by: employee?.id,
      });

      if (error) throw error;

      showSnackbar('Koszt został dodany', 'success');
      setShowAddCost(false);
      setCostForm({
        name: '',
        description: '',
        amount: 0,
        cost_date: new Date().toISOString().split('T')[0],
        category_id: '',
        status: 'pending',
        payment_method: 'transfer',
      });
      fetchFinancialData();
    } catch (err: any) {
      console.error('Error adding cost:', err);
      showSnackbar(err.message || 'Błąd podczas dodawania kosztu', 'error');
    }
  };

  const handleDeleteCost = async (costId: string) => {
    if (!confirm('Czy na pewno chcesz usunąć ten koszt?')) return;

    try {
      const { error } = await supabase.from('event_costs').delete().eq('id', costId);
      if (error) throw error;

      showSnackbar('Koszt został usunięty', 'success');
      fetchFinancialData();
    } catch (err: any) {
      console.error('Error deleting cost:', err);
      showSnackbar(err.message || 'Błąd podczas usuwania kosztu', 'error');
    }
  };

  const handleUpdateCostStatus = async (costId: string, newStatus: string) => {
    try {
      const { error } = await supabase
        .from('event_costs')
        .update({ status: newStatus })
        .eq('id', costId);

      if (error) throw error;

      showSnackbar('Status kosztu został zaktualizowany', 'success');
      fetchFinancialData();
    } catch (err: any) {
      console.error('Error updating cost status:', err);
      showSnackbar(err.message || 'Błąd podczas aktualizacji statusu', 'error');
    }
  };

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { label: string; color: string }> = {
      pending: {
        label: 'Oczekujący',
        color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
      },
      approved: { label: 'Zatwierdzony', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
      paid: { label: 'Zapłacony', color: 'bg-green-500/20 text-green-400 border-green-500/30' },
      rejected: { label: 'Odrzucony', color: 'bg-red-500/20 text-red-400 border-red-500/30' },
    };

    const config = statusConfig[status] || statusConfig.pending;
    return (
      <span
        className={`inline-flex items-center rounded-lg border px-2.5 py-1 text-xs font-medium ${config.color}`}
      >
        {config.label}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-[#d3bb73]"></div>
        <div className="text-[#e5e4e2]/60">Ładowanie danych finansowych...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Client Info Banner */}
      {clientInfo && (
        <div
          className={`rounded-xl border p-4 ${
            clientInfo.is_business
              ? 'border-blue-500/30 bg-blue-500/10'
              : 'border-yellow-500/30 bg-yellow-500/10'
          }`}
        >
          <div className="flex items-start gap-3">
            {clientInfo.is_business ? (
              <Building2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-400" />
            ) : (
              <User className="mt-0.5 h-5 w-5 flex-shrink-0 text-yellow-400" />
            )}
            <div className="flex-1">
              <div className="mb-1 flex items-center gap-3">
                <span className="font-medium text-[#e5e4e2]">
                  {clientInfo.is_business ? 'Klient businessowy' : 'Klient indywidualny'}
                </span>
                <span
                  className={`rounded px-2 py-1 text-xs ${
                    clientInfo.can_invoice
                      ? 'bg-green-500/20 text-green-400'
                      : 'bg-red-500/20 text-red-400'
                  }`}
                >
                  {clientInfo.can_invoice
                    ? 'Można wystawiać faktury'
                    : 'Brak możliwości fakturowania'}
                </span>
              </div>
              <div className="text-sm text-[#e5e4e2]/80">
                {clientInfo.client_name}
                {clientInfo.client_nip && (
                  <span className="ml-2 text-[#e5e4e2]/60">NIP: {clientInfo.client_nip}</span>
                )}
              </div>
              {!clientInfo.is_business && (
                <div className="mt-2 flex items-start gap-2 text-xs text-[#e5e4e2]/60">
                  <Info className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <span>
                    Dla klientów indywidualnych nie można wystawiać faktur VAT. Jeśli klient
                    prowadzi działalność gospodarczą, oznacz go jako klienta businessowego i dodaj
                    NIP.
                  </span>
                </div>
              )}
              {clientInfo.is_business && !clientInfo.can_invoice && (
                <div className="mt-2 flex items-start gap-2 text-xs text-yellow-400">
                  <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <span>
                    Klient nie ma uzupełnionego NIP. Dodaj NIP aby móc wystawiać faktury VAT.
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Financial Summary */}
      {summary && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-[#d3bb73]/20 bg-[#0a0d1a] p-6">
            <div className="mb-2 flex items-center gap-3">
              <TrendingUp className="h-5 w-5 text-green-400" />
              <span className="text-sm text-[#e5e4e2]/60">Przychód faktyczny</span>
            </div>
            <div className="text-2xl font-light text-green-400">
              {summary.actual_revenue.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} zł
            </div>
            <div className="mt-1 text-xs text-[#e5e4e2]/40">
              Plan: {summary.expected_revenue.toLocaleString('pl-PL', { minimumFractionDigits: 2 })}{' '}
              zł
            </div>
          </div>

          <div className="rounded-xl border border-[#d3bb73]/20 bg-[#0a0d1a] p-6">
            <div className="mb-2 flex items-center gap-3">
              <TrendingDown className="h-5 w-5 text-red-400" />
              <span className="text-sm text-[#e5e4e2]/60">Koszty faktyczne</span>
            </div>
            <div className="text-2xl font-light text-red-400">
              {summary.actual_costs.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} zł
            </div>
            <div className="mt-1 text-xs text-[#e5e4e2]/40">
              Plan: {summary.estimated_costs.toLocaleString('pl-PL', { minimumFractionDigits: 2 })}{' '}
              zł
            </div>
          </div>

          <div className="rounded-xl border border-[#d3bb73]/20 bg-[#0a0d1a] p-6">
            <div className="mb-2 flex items-center gap-3">
              <DollarSign className="h-5 w-5 text-[#d3bb73]" />
              <span className="text-sm text-[#e5e4e2]/60">Zysk faktyczny</span>
            </div>
            <div
              className={`text-2xl font-light ${summary.actual_profit >= 0 ? 'text-[#d3bb73]' : 'text-red-400'}`}
            >
              {summary.actual_profit.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} zł
            </div>
            <div className="mt-1 text-xs text-[#e5e4e2]/40">
              Marża: {summary.profit_margin_actual.toFixed(2)}%
            </div>
          </div>

          <div className="rounded-xl border border-[#d3bb73]/20 bg-[#0a0d1a] p-6">
            <div className="mb-2 flex items-center gap-3">
              <Receipt className="h-5 w-5 text-purple-400" />
              <span className="text-sm text-[#e5e4e2]/60">Bilans</span>
            </div>
            {clientInfo?.can_invoice && (
              <div className="text-sm text-[#e5e4e2]/80">
                Faktury: {summary.invoices_count} ({summary.invoices_paid_count} opłacone)
              </div>
            )}
            <div className="text-sm text-[#e5e4e2]/80">
              Koszty: {summary.costs_count} ({summary.costs_paid_count} zapłacone)
            </div>
          </div>
        </div>
      )}

      {/* Invoices Section - Only show for business clients */}
      {clientInfo?.can_invoice && (
        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-lg font-medium text-[#e5e4e2]">
              <FileText className="h-5 w-5 text-[#d3bb73]" />
              Faktury ({invoices.length})
            </h3>
            <button
              onClick={() => router.push(`/crm/invoices/new?event=${eventId}`)}
              className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm text-[#1c1f33] hover:bg-[#d3bb73]/90"
            >
              <Plus className="h-4 w-4" />
              Wystaw fakturę
            </button>
          </div>

          {invoices.length === 0 ? (
            <div className="py-8 text-center text-[#e5e4e2]/40">Brak faktur dla tego eventu</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-[#d3bb73]/10 bg-[#0f1119]">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-[#e5e4e2]/60">
                      Numer
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-[#e5e4e2]/60">
                      Typ
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-[#e5e4e2]/60">
                      Nabywca
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-[#e5e4e2]/60">
                      Data
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-[#e5e4e2]/60">
                      Kwota
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-[#e5e4e2]/60">
                      Status
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-[#e5e4e2]/60">
                      Akcje
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#d3bb73]/10">
                  {invoices.map((invoice) => (
                    <tr key={invoice.id} className="transition-colors hover:bg-[#0f1119]">
                      <td className="px-4 py-3 text-[#e5e4e2]">{invoice.invoice_number}</td>
                      <td className="px-4 py-3">
                        <span className="rounded bg-[#0a0d1a] px-2 py-1 text-xs text-[#e5e4e2]/60">
                          {invoice.invoice_type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[#e5e4e2]/80">{invoice.buyer_name}</td>
                      <td className="px-4 py-3 text-[#e5e4e2]/80">
                        {new Date(invoice.issue_date).toLocaleDateString('pl-PL')}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-[#d3bb73]">
                        {invoice.total_gross.toLocaleString('pl-PL', { minimumFractionDigits: 2 })}{' '}
                        zł
                      </td>
                      <td className="px-4 py-3">{getStatusBadge(invoice.status)}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => router.push(`/crm/invoices/${invoice.id}`)}
                          className="rounded-lg p-2 text-[#e5e4e2]/60 hover:bg-[#d3bb73]/10 hover:text-[#d3bb73]"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Costs Section */}
      <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-medium text-[#e5e4e2]">
            <Receipt className="h-5 w-5 text-red-400" />
            Koszty ({costs.length})
          </h3>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowAddCost(!showAddCost)}
              className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm text-[#1c1f33] hover:bg-[#d3bb73]/90"
            >
              <Plus className="h-4 w-4" />
              Dodaj koszt
            </button>
          </div>
        </div>

        {/* Add Cost Form */}
        {showAddCost && (
          <div className="mb-4 rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] p-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Nazwa *</label>
                <input
                  type="text"
                  value={costForm.name}
                  onChange={(e) => setCostForm({ ...costForm, name: e.target.value })}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2]"
                  placeholder="np. Paliwo - dojazd do eventu"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Kategoria *</label>
                <select
                  value={costForm.category_id}
                  onChange={(e) => setCostForm({ ...costForm, category_id: e.target.value })}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2]"
                >
                  <option value="">Wybierz kategorię...</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Kwota (PLN) *</label>
                <input
                  type="number"
                  step="0.01"
                  value={costForm.amount}
                  onChange={(e) => setCostForm({ ...costForm, amount: parseFloat(e.target.value) })}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2]"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Data kosztu</label>
                <input
                  type="date"
                  value={costForm.cost_date}
                  onChange={(e) => setCostForm({ ...costForm, cost_date: e.target.value })}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2]"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Status</label>
                <select
                  value={costForm.status}
                  onChange={(e) => setCostForm({ ...costForm, status: e.target.value as any })}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2]"
                >
                  <option value="pending">Oczekujący</option>
                  <option value="approved">Zatwierdzony</option>
                  <option value="paid">Zapłacony</option>
                </select>
              </div>

              <div className="col-span-2">
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Opis</label>
                <textarea
                  value={costForm.description}
                  onChange={(e) => setCostForm({ ...costForm, description: e.target.value })}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2]"
                  rows={2}
                  placeholder="Dodatkowe informacje..."
                />
              </div>
            </div>

            <div className="mt-4 flex gap-3">
              <button
                onClick={handleAddCost}
                className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] hover:bg-[#d3bb73]/90"
              >
                <Check className="h-4 w-4" />
                Zapisz
              </button>
              <button
                onClick={() => setShowAddCost(false)}
                className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/20 px-4 py-2 text-[#e5e4e2] hover:bg-[#d3bb73]/5"
              >
                <X className="h-4 w-4" />
                Anuluj
              </button>
            </div>
          </div>
        )}

        {/* Costs List */}
        {costs.length === 0 ? (
          <div className="py-8 text-center text-[#e5e4e2]/40">Brak kosztów dla tego eventu</div>
        ) : (
          <div className="space-y-3">
            {costs.map((cost) => (
              <div key={cost.id} className="rounded-lg border border-[#d3bb73]/10 bg-[#0a0d1a] p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="mb-2 flex items-center gap-3">
                      <div
                        className="h-3 w-3 rounded-full"
                        style={{ backgroundColor: cost.category?.color || '#d3bb73' }}
                      />
                      <span className="font-medium text-[#e5e4e2]">{cost.name}</span>
                      <span className="rounded bg-[#1c1f33] px-2 py-1 text-xs text-[#e5e4e2]/40">
                        {cost.category?.name}
                      </span>
                      {getStatusBadge(cost.status)}
                    </div>
                    {cost.description && (
                      <p className="mb-2 text-sm text-[#e5e4e2]/60">{cost.description}</p>
                    )}
                    <div className="flex items-center gap-4 text-xs text-[#e5e4e2]/40">
                      <span>Data: {new Date(cost.cost_date).toLocaleDateString('pl-PL')}</span>
                      {cost.subcontractor && (
                        <span>Podwykonawca: {cost.subcontractor.company_name}</span>
                      )}
                      <span>Dodane przez: {cost.created_by_name}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="mr-4 text-right">
                      <div className="text-lg font-medium text-red-400">
                        {cost.amount.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} zł
                      </div>
                    </div>

                    {cost.status !== 'paid' && (
                      <button
                        onClick={() =>
                          handleUpdateCostStatus(
                            cost.id,
                            cost.status === 'pending' ? 'approved' : 'paid',
                          )
                        }
                        className="rounded-lg p-2 text-green-400 hover:bg-green-500/10"
                        title={cost.status === 'pending' ? 'Zatwierdź' : 'Oznacz jako zapłacony'}
                      >
                        <Check className="h-4 w-4" />
                      </button>
                    )}

                    <button
                      onClick={() => handleDeleteCost(cost.id)}
                      className="rounded-lg p-2 text-red-400 hover:bg-red-500/10"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Cash Budget Section (only for individual clients and admins) */}
      {isAdmin && clientInfo?.client_type === 'individual' && (
        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-lg font-medium text-[#e5e4e2]">
              <DollarSign className="h-5 w-5 text-[#d3bb73]" />
              Budżet gotówkowy ({cashTransactions.length})
              <span className="rounded bg-yellow-500/20 px-2 py-1 text-xs text-yellow-400">
                Tylko dla admina
              </span>
            </h3>
            <button
              onClick={() => setShowAddCashModal(true)}
              className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm text-[#1c1f33] hover:bg-[#d3bb73]/90"
            >
              <Plus className="h-4 w-4" />
              Dodaj transakcję
            </button>
          </div>

          {/* Cash Summary */}
          {summary && (
            <div className="mb-6 grid grid-cols-3 gap-4">
              <div className="rounded-lg border border-blue-500/20 bg-[#0a0d1a] p-4">
                <div className="mb-1 text-xs text-[#e5e4e2]/60">Budżet z oferty</div>
                <div className="text-xl font-light text-blue-400">
                  {summary.expected_revenue.toLocaleString('pl-PL', { minimumFractionDigits: 2 })}{' '}
                  zł
                </div>
                <div className="mt-1 text-xs text-[#e5e4e2]/40">Planowany przychód</div>
              </div>
              <div className="rounded-lg border border-red-500/20 bg-[#0a0d1a] p-4">
                <div className="mb-1 text-xs text-[#e5e4e2]/60">Koszty</div>
                <div className="text-xl font-light text-red-400">
                  {summary.actual_costs.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} zł
                </div>
                <div className="mt-1 text-xs text-[#e5e4e2]/40">Poniesione wydatki</div>
              </div>
              <div className="rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] p-4">
                <div className="mb-1 text-xs text-[#e5e4e2]/60">Łączny przychód</div>
                <div
                  className={`text-xl font-light ${summary.expected_revenue - summary.actual_costs >= 0 ? 'text-[#d3bb73]' : 'text-red-400'}`}
                >
                  {(summary.expected_revenue - summary.actual_costs).toLocaleString('pl-PL', {
                    minimumFractionDigits: 2,
                  })}{' '}
                  zł
                </div>
                <div className="mt-1 text-xs text-[#e5e4e2]/40">Budżet - Koszty</div>
              </div>
            </div>
          )}

          {/* Cash Transactions List */}
          {cashTransactions.length === 0 ? (
            <div className="py-8 text-center text-[#e5e4e2]/40">Brak transakcji gotówkowych</div>
          ) : (
            <div className="space-y-2">
              {cashTransactions.map((transaction) => (
                <div
                  key={transaction.id}
                  className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-4 transition-colors hover:border-[#d3bb73]/30"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="mb-2 flex items-center gap-3">
                        <span
                          className={`text-sm font-medium ${
                            transaction.transaction_type === 'income'
                              ? 'text-green-400'
                              : 'text-red-400'
                          }`}
                        >
                          {transaction.transaction_type === 'income' ? '+ ' : '- '}
                          {transaction.amount.toLocaleString('pl-PL', {
                            minimumFractionDigits: 2,
                          })}{' '}
                          zł
                        </span>
                        <span
                          className={`rounded px-2 py-1 text-xs ${
                            transaction.confirmed
                              ? 'bg-green-500/20 text-green-400'
                              : 'bg-yellow-500/20 text-yellow-400'
                          }`}
                        >
                          {transaction.confirmed ? 'Potwierdzone' : 'Oczekuje'}
                        </span>
                        <span className="text-xs text-[#e5e4e2]/40">
                          {new Date(transaction.transaction_date).toLocaleDateString('pl-PL')}
                        </span>
                      </div>
                      <div className="mb-1 text-sm text-[#e5e4e2]/80">
                        {transaction.description}
                      </div>
                      {transaction.handled_by_name && (
                        <div className="text-xs text-[#e5e4e2]/60">
                          Obsłużone przez: {transaction.handled_by_name}
                        </div>
                      )}
                      {transaction.notes && (
                        <div className="mt-1 text-xs text-[#e5e4e2]/40">
                          Notatka: {transaction.notes}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 rounded-lg border border-blue-500/20 bg-blue-500/10 p-3">
            <div className="flex items-start gap-2 text-xs text-blue-400">
              <Info className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>
                Budżet gotówkowy jest widoczny tylko dla administratorów i służy do księgowania
                rozliczeń gotówkowych z klientami indywidualnymi. Transakcje są zapisywane na
                subkoncie GOTÓWKA.
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Financial Alert */}
      {summary && summary.actual_profit < 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4">
          <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-400" />
          <div>
            <div className="mb-1 font-medium text-red-400">Uwaga: Event generuje stratę</div>
            <div className="text-sm text-[#e5e4e2]/80">
              Koszty przekraczają przychody o{' '}
              {Math.abs(summary.actual_profit).toLocaleString('pl-PL', {
                minimumFractionDigits: 2,
              })}{' '}
              zł. Rozważ optymalizację kosztów lub zwiększenie ceny usługi.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
