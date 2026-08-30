'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/browser';
import { DollarSign, TrendingUp, TrendingDown, Receipt, Plus, Trash2, CreditCard as Edit, Check, X, FileText, Calendar, Fuel, Users, Package, Truck, Upload, Eye, AlertCircle, Building2, User, Info, Calculator, BarChart3 } from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';
import FinalInvoiceWizardModal from '@/components/crm/FinalInvoiceWizardModal';
import EventFinancialControls from '@/components/crm/events/EventFinancialControls';
import { getOfferTotals } from '@/lib/CRM/Offers/offerTotals';

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
  billing_arrangement?: 'direct' | 'hotel' | 'agency' | 'other';
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

interface AcceptedOffer {
  total_amount: number;
  subtotal: number;
  tax_percent: number;
  tax_amount: number;
  discount_percent?: number;
  discount_amount?: number;
  created_by?: string | null;
}

interface ProfitabilitySubcontractorTask {
  id: string;
  agreed_cost: number | null;
  total_cost: number | null;
  status: string;
  payment_status: string;
}

interface ProfitabilityTimeEntry {
  id: string;
  duration_minutes: number | null;
  hourly_rate: number | null;
  employee?: {
    name?: string | null;
    surname?: string | null;
  } | null;
}

interface EventSalesperson {
  name: string;
  surname: string;
}

interface EventCommission {
  id: string;
  beneficiary_type: 'salesperson' | 'hotel' | 'partner' | 'employee' | 'other';
  beneficiary_name: string;
  calculation_type: 'percent' | 'fixed';
  rate: number;
  base_amount: number;
  amount: number;
  status: 'planned' | 'approved' | 'paid' | 'cancelled';
}

interface Props {
  eventId: string;
}

export default function EventFinancesTab({ eventId }: Props) {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();

  const [summary, setSummary] = useState<FinancialSummary | null>(null);
  const [acceptedOffer, setAcceptedOffer] = useState<AcceptedOffer | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [costs, setCosts] = useState<Cost[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [clientInfo, setClientInfo] = useState<ClientInfo | null>(null);
  const [cashTransactions, setCashTransactions] = useState<CashTransaction[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showAddCashModal, setShowAddCashModal] = useState(false);
  const [showFinalInvoiceModal, setShowFinalInvoiceModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showAddCost, setShowAddCost] = useState(false);
  const [financialSource, setFinancialSource] = useState<'offer' | 'calculation'>('offer');
  const [acceptedCalcName, setAcceptedCalcName] = useState<string | null>(null);
  const [profitabilitySubcontractors, setProfitabilitySubcontractors] = useState<ProfitabilitySubcontractorTask[]>([]);
  const [profitabilityTimeEntries, setProfitabilityTimeEntries] = useState<ProfitabilityTimeEntry[]>([]);
  const [eventSalesperson, setEventSalesperson] = useState<EventSalesperson | null>(null);
  const [assignedEmployeeCount, setAssignedEmployeeCount] = useState(0);
  const [eventCommissions, setEventCommissions] = useState<EventCommission[]>([]);
  const [commissionsAvailable, setCommissionsAvailable] = useState(true);
  const [showAddCommission, setShowAddCommission] = useState(false);
  const [commissionForm, setCommissionForm] = useState({
    beneficiary_type: 'hotel' as EventCommission['beneficiary_type'],
    beneficiary_name: '',
    calculation_type: 'percent' as EventCommission['calculation_type'],
    rate: 0,
    amount: 0,
    status: 'planned' as EventCommission['status'],
  });

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
      const [summaryRes, invoicesRes, costsRes, categoriesRes, clientInfoRes, offerRes, subcontractorsRes, timeEntriesRes, commissionsRes, assignmentsRes] = await Promise.all([
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
        supabase
          .from('offers')
          .select('total_amount, subtotal, discount_percent, discount_amount, tax_percent, tax_amount, created_by')
          .eq('event_id', eventId)
          .eq('status', 'accepted')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('subcontractor_tasks')
          .select('id, agreed_cost, total_cost, status, payment_status')
          .eq('event_id', eventId)
          .neq('status', 'cancelled'),
        supabase
          .from('time_entries')
          .select('id, duration_minutes, hourly_rate, employee:employees(name, surname)')
          .eq('event_id', eventId)
          .not('end_time', 'is', null),
        supabase
          .from('event_commissions')
          .select('id, beneficiary_type, beneficiary_name, calculation_type, rate, base_amount, amount, status')
          .eq('event_id', eventId)
          .neq('status', 'cancelled')
          .order('created_at', { ascending: false }),
        supabase
          .from('employee_assignments')
          .select('employee_id')
          .eq('event_id', eventId),
      ]);

      if (summaryRes.data?.[0]) setSummary(summaryRes.data[0]);
      if (invoicesRes.data) setInvoices(invoicesRes.data);
      if (clientInfoRes.data?.[0]) setClientInfo(clientInfoRes.data[0]);
      setAcceptedOffer(offerRes.data || null);
      setProfitabilitySubcontractors(subcontractorsRes.data || []);
      setProfitabilityTimeEntries((timeEntriesRes.data || []) as ProfitabilityTimeEntry[]);
      setEventCommissions((commissionsRes.data || []) as EventCommission[]);
      setCommissionsAvailable(!commissionsRes.error);
      setAssignedEmployeeCount(new Set((assignmentsRes.data || []).map((assignment) => assignment.employee_id)).size);
      if (costsRes.data) {
        const formattedCosts = costsRes.data.map((cost: any) => ({
          ...cost,
          created_by_name: cost.creator ? `${cost.creator.name} ${cost.creator.surname}` : 'System',
        }));
        setCosts(formattedCosts);
      }
      if (categoriesRes.data) setCategories(categoriesRes.data);

      if (offerRes.data?.created_by) {
        const { data: salespersonData } = await supabase
          .from('employees')
          .select('name, surname')
          .eq('id', offerRes.data.created_by)
          .maybeSingle();
        setEventSalesperson(salespersonData || null);
      } else {
        setEventSalesperson(null);
      }

      // Fetch financial source info
      const { data: eventFinSource } = await supabase
        .from('events')
        .select('financial_source, accepted_calculation_id')
        .eq('id', eventId)
        .maybeSingle();

      if (eventFinSource?.financial_source === 'calculation') {
        setFinancialSource('calculation');
        if (eventFinSource.accepted_calculation_id) {
          const { data: calcData } = await supabase
            .from('event_calculations')
            .select('name')
            .eq('id', eventFinSource.accepted_calculation_id)
            .maybeSingle();
          setAcceptedCalcName(calcData?.name || null);
        }
      } else {
        setFinancialSource('offer');
        setAcceptedCalcName(null);
      }

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

  const handleAddCommission = async () => {
    if (!commissionForm.beneficiary_name.trim()) {
      showSnackbar('Podaj beneficjenta prowizji', 'warning');
      return;
    }

    const currentExpectedRevenue = acceptedOffer
      ? getOfferTotals(acceptedOffer).gross
      : Number(summary?.expected_revenue || 0);
    const baseAmount = commissionForm.calculation_type === 'percent' ? currentExpectedRevenue : 0;
    const amount = commissionForm.calculation_type === 'percent'
      ? baseAmount * Number(commissionForm.rate || 0) / 100
      : Number(commissionForm.amount || 0);
    if (amount <= 0) {
      showSnackbar('Kwota prowizji musi być większa od zera', 'warning');
      return;
    }

    try {
      const { data: authData } = await supabase.auth.getUser();
      const userId = authData.user?.id;
      const { data: employee } = userId
        ? await supabase
            .from('employees')
            .select('id')
            .eq('id', userId)
            .maybeSingle()
        : { data: null };
      const { error } = await supabase.from('event_commissions').insert({
        event_id: eventId,
        beneficiary_type: commissionForm.beneficiary_type,
        beneficiary_name: commissionForm.beneficiary_name.trim(),
        calculation_type: commissionForm.calculation_type,
        rate: commissionForm.calculation_type === 'percent' ? Number(commissionForm.rate || 0) : 0,
        base_amount: baseAmount,
        amount,
        status: commissionForm.status,
        created_by: employee?.id || null,
      });
      if (error) throw error;

      setCommissionForm({
        beneficiary_type: 'hotel',
        beneficiary_name: '',
        calculation_type: 'percent',
        rate: 0,
        amount: 0,
        status: 'planned',
      });
      setShowAddCommission(false);
      showSnackbar('Prowizja została dodana do rentowności wydarzenia', 'success');
      await fetchFinancialData();
    } catch (error: any) {
      console.error('Error adding event commission:', error);
      showSnackbar(error?.message || 'Nie udało się zapisać prowizji', 'error');
    }
  };

  const handleDeleteCommission = async (commissionId: string) => {
    const { error } = await supabase.from('event_commissions').delete().eq('id', commissionId);
    if (error) {
      showSnackbar('Nie udało się usunąć prowizji', 'error');
      return;
    }
    setEventCommissions((current) => current.filter((commission) => commission.id !== commissionId));
    showSnackbar('Prowizja została usunięta', 'success');
  };

  const handleUpdateCommissionStatus = async (commissionId: string, status: EventCommission['status']) => {
    const { error } = await supabase.from('event_commissions').update({ status }).eq('id', commissionId);
    if (error) {
      showSnackbar('Nie udało się zmienić statusu prowizji', 'error');
      return;
    }
    setEventCommissions((current) => current.map((commission) => (
      commission.id === commissionId ? { ...commission, status } : commission
    )));
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

  const expectedRevenue = acceptedOffer
    ? getOfferTotals(acceptedOffer).gross
    : Number(summary?.expected_revenue || 0);
  const actualRevenue = Number(summary?.actual_revenue || 0);
  const isEmployeeCost = (cost: Cost) => /personel|pracown|wynagrodz|pensj/i.test(cost.category?.name || '');
  const registeredPlannedCosts = costs
    .filter((cost) => cost.status !== 'rejected' && !cost.subcontractor && !isEmployeeCost(cost))
    .reduce((sum, cost) => sum + Number(cost.amount || 0), 0);
  const registeredActualCosts = costs
    .filter((cost) => ['approved', 'paid'].includes(cost.status) && !cost.subcontractor && !isEmployeeCost(cost))
    .reduce((sum, cost) => sum + Number(cost.amount || 0), 0);
  const plannedEmployeeCostsFromRegister = costs
    .filter((cost) => cost.status !== 'rejected' && isEmployeeCost(cost))
    .reduce((sum, cost) => sum + Number(cost.amount || 0), 0);
  const actualEmployeeCosts = profitabilityTimeEntries.reduce((sum, entry) => {
    const hourlyRate = Number(entry.hourly_rate || 0);
    return sum + (Number(entry.duration_minutes || 0) / 60) * hourlyRate;
  }, 0);
  const plannedEmployeeCosts = plannedEmployeeCostsFromRegister || actualEmployeeCosts;
  const plannedSubcontractorCosts = profitabilitySubcontractors.reduce(
    (sum, task) => sum + Number(task.agreed_cost || task.total_cost || 0),
    0,
  );
  const actualSubcontractorCosts = profitabilitySubcontractors
    .filter((task) => task.payment_status === 'paid' || task.status === 'completed')
    .reduce((sum, task) => sum + Number(task.agreed_cost || task.total_cost || 0), 0);
  const hasExplicitSalesCommission = eventCommissions.some((commission) => commission.beneficiary_type === 'salesperson');
  const explicitPlannedCommissions = eventCommissions
    .filter((commission) => commission.status !== 'cancelled')
    .reduce((sum, commission) => sum + Number(commission.amount || 0), 0);
  const explicitActualCommissions = eventCommissions
    .filter((commission) => ['approved', 'paid'].includes(commission.status))
    .reduce((sum, commission) => sum + Number(commission.amount || 0), 0);
  const plannedCommissions = explicitPlannedCommissions;
  const actualCommissions = explicitActualCommissions;
  const plannedTotalCosts = registeredPlannedCosts + plannedEmployeeCosts + plannedSubcontractorCosts + plannedCommissions;
  const actualTotalCosts = registeredActualCosts + actualEmployeeCosts + actualSubcontractorCosts + actualCommissions;
  const plannedProfit = expectedRevenue - plannedTotalCosts;
  const actualProfit = actualRevenue - actualTotalCosts;
  const plannedMargin = expectedRevenue > 0 ? plannedProfit / expectedRevenue * 100 : 0;
  const actualMargin = actualRevenue > 0 ? actualProfit / actualRevenue * 100 : 0;
  const profitabilityRows = [
    { label: 'Pozostałe koszty', planned: registeredPlannedCosts, actual: registeredActualCosts, color: '#ef4444' },
    { label: 'Pracownicy', planned: plannedEmployeeCosts, actual: actualEmployeeCosts, color: '#3b82f6' },
    { label: 'Podwykonawcy', planned: plannedSubcontractorCosts, actual: actualSubcontractorCosts, color: '#f59e0b' },
    { label: 'Prowizje', planned: plannedCommissions, actual: actualCommissions, color: '#8b5cf6' },
  ];
  const maxProfitabilityCost = Math.max(...profitabilityRows.map((row) => Math.max(row.planned, row.actual)), 1);
  const missingSubcontractorCosts = profitabilitySubcontractors.filter(
    (task) => Number(task.agreed_cost || task.total_cost || 0) <= 0,
  ).length;
  const missingEmployeeRates = profitabilityTimeEntries.filter(
    (entry) => Number(entry.hourly_rate || 0) <= 0,
  ).length;
  const pendingCosts = costs.filter((cost) => cost.status === 'pending').length;
  const profitabilityIssues = [
    missingSubcontractorCosts > 0 ? `${missingSubcontractorCosts} zleceń podwykonawców bez kosztu` : null,
    missingEmployeeRates > 0 ? `${missingEmployeeRates} wpisów czasu bez stawki` : null,
    assignedEmployeeCount > 0 && profitabilityTimeEntries.length === 0
      ? `${assignedEmployeeCount} przypisanych pracowników bez zarejestrowanego czasu`
      : null,
    acceptedOffer && !acceptedOffer.created_by ? 'Oferta nie ma przypisanego autora / sprzedawcy' : null,
    acceptedOffer?.created_by && !hasExplicitSalesCommission ? 'Nie zarejestrowano prowizji sprzedawcy' : null,
    !commissionsAvailable ? 'Uruchom migrację rejestru prowizji' : null,
    pendingCosts > 0 ? `${pendingCosts} kosztów czeka na zatwierdzenie` : null,
  ].filter(Boolean) as string[];

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
      <EventFinancialControls eventId={eventId} invoices={invoices} canManage={isAdmin} />
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
              <span className="text-sm text-[#e5e4e2]/60">Przychód planowany</span>
            </div>
            {financialSource === 'calculation' && acceptedCalcName && (
              <div className="mb-2 flex items-center gap-1.5 rounded bg-blue-500/15 px-2 py-1 text-xs text-blue-400">
                <Calculator className="h-3 w-3" />
                <span>Źródło: kalkulacja &bdquo;{acceptedCalcName}&rdquo;</span>
              </div>
            )}
            {acceptedOffer ? (
              <>
                <div className="text-2xl font-light text-[#d3bb73]">
                  {getOfferTotals(acceptedOffer).gross.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} zł
                </div>
                <div className="mt-2 space-y-0.5 text-xs text-[#e5e4e2]/40">
                  <div>
                    Netto:{' '}
                    <span className="text-[#e5e4e2]/60">
                      {getOfferTotals(acceptedOffer).net.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} zł
                    </span>
                  </div>
                  <div>
                    VAT ({acceptedOffer.tax_percent ?? 23}%):{' '}
                    <span className="text-[#e5e4e2]/60">
                      {getOfferTotals(acceptedOffer).taxAmount.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} zł
                    </span>
                  </div>
                  <div>
                    Brutto:{' '}
                    <span className="text-[#e5e4e2]/60">
                      {getOfferTotals(acceptedOffer).gross.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} zł
                    </span>
                  </div>
                </div>
                {summary.actual_revenue > 0 && (
                  <div className="mt-2 border-t border-[#d3bb73]/10 pt-2 text-xs text-green-400">
                    Zapłacono: {summary.actual_revenue.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} zł
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="text-2xl font-light text-green-400">
                  {summary.expected_revenue.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} zł
                </div>
                {summary.actual_revenue > 0 && (
                  <div className="mt-1 text-xs text-green-400">
                    Zapłacono: {summary.actual_revenue.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} zł
                  </div>
                )}
              </>
            )}
          </div>

          <div className="rounded-xl border border-[#d3bb73]/20 bg-[#0a0d1a] p-6">
            <div className="mb-2 flex items-center gap-3">
              <TrendingDown className="h-5 w-5 text-red-400" />
              <span className="text-sm text-[#e5e4e2]/60">Koszty faktyczne</span>
            </div>
            <div className="text-2xl font-light text-red-400">
              {actualTotalCosts.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} zł
            </div>
            <div className="mt-1 text-xs text-[#e5e4e2]/40">
              Plan: {plannedTotalCosts.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} zł
            </div>
          </div>

          <div className="rounded-xl border border-[#d3bb73]/20 bg-[#0a0d1a] p-6">
            <div className="mb-2 flex items-center gap-3">
              <DollarSign className="h-5 w-5 text-[#d3bb73]" />
              <span className="text-sm text-[#e5e4e2]/60">Zysk faktyczny</span>
            </div>
            <div
              className={`text-2xl font-light ${actualProfit >= 0 ? 'text-[#d3bb73]' : 'text-red-400'}`}
            >
              {actualProfit.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} zł
            </div>
            <div className="mt-1 text-xs text-[#e5e4e2]/40">
              Marża: {actualMargin.toFixed(2)}%
            </div>
          </div>

          <div className="rounded-xl border border-[#d3bb73]/20 bg-[#0a0d1a] p-6">
            <div className="mb-2 flex items-center gap-3">
              <Receipt className="h-5 w-5 text-[#d3bb73]" />
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

      {summary && (
        <section className="rounded-xl border border-[#d3bb73]/15 bg-[#111522] p-5">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="flex items-center gap-2 text-lg font-medium text-[#e5e4e2]">
                <BarChart3 className="h-5 w-5 text-[#d3bb73]" />
                Rentowność wydarzenia
              </h3>
              <p className="mt-1 max-w-3xl text-xs text-[#e5e4e2]/45">
                Plan korzysta z zaakceptowanej oferty i kosztów przewidywanych. Wykonanie korzysta z zatwierdzonych kosztów,
                czasu pracy, zakończonych zleceń podwykonawców i faktycznych wpływów.
              </p>
            </div>
            <span className={`rounded-full px-3 py-1 text-xs ${profitabilityIssues.length === 0 ? 'bg-green-500/15 text-green-300' : 'bg-amber-500/15 text-amber-300'}`}>
              {profitabilityIssues.length === 0 ? 'Dane kompletne' : `${profitabilityIssues.length} elementów do uzupełnienia`}
            </span>
          </div>

          <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg border border-white/5 bg-[#0a0d1a] p-4">
              <div className="text-xs text-[#e5e4e2]/45">Przychód</div>
              <div className="mt-1 text-lg text-green-300">{expectedRevenue.toLocaleString('pl-PL')} zł</div>
              <div className="mt-1 text-[11px] text-[#e5e4e2]/35">Wpływy: {actualRevenue.toLocaleString('pl-PL')} zł</div>
            </div>
            <div className="rounded-lg border border-white/5 bg-[#0a0d1a] p-4">
              <div className="text-xs text-[#e5e4e2]/45">Wszystkie koszty</div>
              <div className="mt-1 text-lg text-red-300">{plannedTotalCosts.toLocaleString('pl-PL')} zł</div>
              <div className="mt-1 text-[11px] text-[#e5e4e2]/35">Poniesione: {actualTotalCosts.toLocaleString('pl-PL')} zł</div>
            </div>
            <div className="rounded-lg border border-white/5 bg-[#0a0d1a] p-4">
              <div className="text-xs text-[#e5e4e2]/45">Prognozowany wynik</div>
              <div className={`mt-1 text-lg ${plannedProfit >= 0 ? 'text-[#d3bb73]' : 'text-red-400'}`}>
                {plannedProfit.toLocaleString('pl-PL')} zł
              </div>
              <div className="mt-1 text-[11px] text-[#e5e4e2]/35">Marża {plannedMargin.toLocaleString('pl-PL', { maximumFractionDigits: 1 })}%</div>
            </div>
            <div className="rounded-lg border border-white/5 bg-[#0a0d1a] p-4">
              <div className="text-xs text-[#e5e4e2]/45">Wynik faktyczny</div>
              <div className={`mt-1 text-lg ${actualProfit >= 0 ? 'text-[#d3bb73]' : 'text-red-400'}`}>
                {actualProfit.toLocaleString('pl-PL')} zł
              </div>
              <div className="mt-1 text-[11px] text-[#e5e4e2]/35">Marża {actualMargin.toLocaleString('pl-PL', { maximumFractionDigits: 1 })}%</div>
            </div>
          </div>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-4">
              {profitabilityRows.map((row) => (
                <div key={row.label}>
                  <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
                    <span className="text-[#e5e4e2]/70">{row.label}</span>
                    <span className="text-[#e5e4e2]/50">
                      plan {row.planned.toLocaleString('pl-PL')} zł · wykonanie {row.actual.toLocaleString('pl-PL')} zł
                    </span>
                  </div>
                  <div className="space-y-1">
                    <div className="h-2 overflow-hidden rounded-full bg-white/5">
                      <div className="h-full rounded-full opacity-45" style={{ width: `${Math.max(row.planned / maxProfitabilityCost * 100, row.planned > 0 ? 2 : 0)}%`, backgroundColor: row.color }} />
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-white/5">
                      <div className="h-full rounded-full" style={{ width: `${Math.max(row.actual / maxProfitabilityCost * 100, row.actual > 0 ? 2 : 0)}%`, backgroundColor: row.color }} />
                    </div>
                  </div>
                </div>
              ))}
              <div className="flex items-center gap-4 text-[10px] text-[#e5e4e2]/35">
                <span><i className="mr-1 inline-block h-2 w-4 rounded bg-[#d3bb73]/35" />Plan</span>
                <span><i className="mr-1 inline-block h-2 w-4 rounded bg-[#d3bb73]" />Wykonanie</span>
              </div>
            </div>

            <aside className="rounded-lg border border-white/5 bg-[#0a0d1a] p-4">
              <div className="mb-3 text-sm font-medium text-[#e5e4e2]">Jakość kalkulacji</div>
              {profitabilityIssues.length > 0 ? (
                <ul className="space-y-2 text-xs text-amber-200/80">
                  {profitabilityIssues.map((issue) => (
                    <li key={issue} className="flex gap-2">
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>{issue}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-green-300/80">Najważniejsze źródła kosztów mają kompletne wartości.</p>
              )}
              <p className="mt-4 border-t border-white/5 pt-3 text-[11px] leading-relaxed text-[#e5e4e2]/35">
                Kwoty bez kompletnego źródła są wskazywane jako brak danych. Dzięki temu późniejsza analiza AI otrzyma fakty,
                a nie wartości domyślne udające rzeczywiste koszty.
              </p>
            </aside>
          </div>

          <div className="mt-6 border-t border-white/5 pt-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-[#e5e4e2]">Prowizje i polecenia</div>
                <div className="mt-0.5 text-[11px] text-[#e5e4e2]/35">Sprzedawcy, hotele, sale, partnerzy i pozostali beneficjenci.</div>
              </div>
              {isAdmin && commissionsAvailable && (
                <button
                  type="button"
                  onClick={() => setShowAddCommission((visible) => !visible)}
                  className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/25 px-3 py-2 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/10"
                >
                  <Plus className="h-3.5 w-3.5" /> Dodaj prowizję
                </button>
              )}
            </div>

            {!commissionsAvailable && (
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
                Rejestr prowizji będzie dostępny po uruchomieniu migracji `20260831170000_create_event_commissions_for_profitability.sql`.
              </div>
            )}

            {showAddCommission && commissionsAvailable && (
              <div className="mb-4 grid gap-3 rounded-lg border border-[#d3bb73]/15 bg-[#0a0d1a] p-4 md:grid-cols-2 xl:grid-cols-6">
                <select
                  value={commissionForm.beneficiary_type}
                  onChange={(event) => setCommissionForm({ ...commissionForm, beneficiary_type: event.target.value as EventCommission['beneficiary_type'] })}
                  className="rounded-lg border border-white/10 bg-[#111522] px-3 py-2 text-sm text-[#e5e4e2]"
                >
                  <option value="salesperson">Sprzedawca</option>
                  <option value="hotel">Hotel / sala</option>
                  <option value="partner">Partner</option>
                  <option value="employee">Pracownik</option>
                  <option value="other">Inny</option>
                </select>
                <input
                  value={commissionForm.beneficiary_name}
                  onChange={(event) => setCommissionForm({ ...commissionForm, beneficiary_name: event.target.value })}
                  placeholder="Nazwa lub osoba"
                  className="rounded-lg border border-white/10 bg-[#111522] px-3 py-2 text-sm text-[#e5e4e2] xl:col-span-2"
                />
                <select
                  value={commissionForm.calculation_type}
                  onChange={(event) => setCommissionForm({ ...commissionForm, calculation_type: event.target.value as EventCommission['calculation_type'] })}
                  className="rounded-lg border border-white/10 bg-[#111522] px-3 py-2 text-sm text-[#e5e4e2]"
                >
                  <option value="percent">Procent przychodu</option>
                  <option value="fixed">Stała kwota</option>
                </select>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={commissionForm.calculation_type === 'percent' ? commissionForm.rate : commissionForm.amount}
                  onChange={(event) => commissionForm.calculation_type === 'percent'
                    ? setCommissionForm({ ...commissionForm, rate: Number(event.target.value || 0) })
                    : setCommissionForm({ ...commissionForm, amount: Number(event.target.value || 0) })}
                  placeholder={commissionForm.calculation_type === 'percent' ? 'Procent' : 'Kwota'}
                  className="rounded-lg border border-white/10 bg-[#111522] px-3 py-2 text-sm text-[#e5e4e2]"
                />
                <button
                  type="button"
                  onClick={handleAddCommission}
                  className="rounded-lg bg-[#d3bb73] px-3 py-2 text-sm font-medium text-[#111522] hover:bg-[#e2ce91]"
                >
                  Zapisz
                </button>
              </div>
            )}

            <div className="space-y-2">
              {!hasExplicitSalesCommission && eventSalesperson && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/5 bg-[#0a0d1a] px-4 py-3 text-xs">
                  <div>
                    <span className="text-[#e5e4e2]">{eventSalesperson.name} {eventSalesperson.surname}</span>
                    <span className="ml-2 text-[#e5e4e2]/35">autor oferty / sprzedawca</span>
                  </div>
                  <span className="text-amber-300/70">uzupełnij prowizję</span>
                </div>
              )}
              {eventCommissions.map((commission) => (
                <div key={commission.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/5 bg-[#0a0d1a] px-4 py-3 text-xs">
                  <div>
                    <span className="text-[#e5e4e2]">{commission.beneficiary_name}</span>
                    <span className="ml-2 text-[#e5e4e2]/35">{commission.beneficiary_type} · {commission.status}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[#d3bb73]">
                      {commission.calculation_type === 'percent' ? `${commission.rate}% · ` : ''}
                      {Number(commission.amount || 0).toLocaleString('pl-PL')} zł
                    </span>
                    {isAdmin && (
                      <>
                        <select
                          value={commission.status}
                          onChange={(event) => handleUpdateCommissionStatus(commission.id, event.target.value as EventCommission['status'])}
                          className="rounded border border-white/10 bg-[#111522] px-2 py-1 text-[11px] text-[#e5e4e2]/70"
                        >
                          <option value="planned">Planowana</option>
                          <option value="approved">Zatwierdzona</option>
                          <option value="paid">Wypłacona</option>
                        </select>
                        <button type="button" onClick={() => handleDeleteCommission(commission.id)} className="rounded p-1 text-red-300 hover:bg-red-500/10">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
              {commissionsAvailable && eventCommissions.length === 0 && !eventSalesperson && (
                <div className="rounded-lg border border-dashed border-white/10 px-4 py-5 text-center text-xs text-[#e5e4e2]/30">Brak zarejestrowanych prowizji.</div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Invoices Section - Only show for business clients */}
      {clientInfo?.can_invoice && (
        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-lg font-medium text-[#e5e4e2]">
              <FileText className="h-5 w-5 text-[#d3bb73]" />
              Faktury ({invoices.length})
            </h3>
            <div className="flex items-center gap-2">
              {invoices.some((i) => i.invoice_type === 'advance') && (
                <button
                  onClick={() => setShowFinalInvoiceModal(true)}
                  className="flex items-center gap-2 rounded-lg border border-[#d3bb73] px-4 py-2 text-sm text-[#d3bb73] hover:bg-[#d3bb73]/10"
                >
                  <FileText className="h-4 w-4" />
                  Wystaw fakturę końcową
                </button>
              )}
              <button
                onClick={() => router.push(`/crm/invoices/new?event=${eventId}`)}
                className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm text-[#1c1f33] hover:bg-[#d3bb73]/90"
              >
                <Plus className="h-4 w-4" />
                Wystaw fakturę
              </button>
            </div>
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
                      <td className="px-4 py-3 text-[#e5e4e2]/80">
                        <div>{invoice.buyer_name}</div>
                        {invoice.billing_arrangement &&
                          invoice.billing_arrangement !== 'direct' && (
                            <div className="mt-1 text-[11px] text-sky-300">
                              {invoice.billing_arrangement === 'hotel'
                                ? 'Płatność przez hotel'
                                : invoice.billing_arrangement === 'agency'
                                  ? 'Płatność przez agencję'
                                  : 'Płatność przez inną organizację'}
                            </div>
                          )}
                      </td>
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

      {showFinalInvoiceModal && (
        <FinalInvoiceWizardModal
          initialEventId={eventId}
          onClose={() => setShowFinalInvoiceModal(false)}
          onCreated={(invoiceId) => {
            setShowFinalInvoiceModal(false);
            router.push(`/crm/invoices/${invoiceId}`);
          }}
        />
      )}
    </div>
  );
}
