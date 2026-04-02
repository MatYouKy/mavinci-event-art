'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Calendar,
  Building2,
  FileText,
  ArrowUp,
  ArrowDown,
  BarChart3,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';

interface FinancialData {
  totalRevenue: number;
  totalCost: number;
  profit: number;
  invoicesCount: number;
  paidInvoices: number;
  pendingInvoices: number;
}

interface MonthlyData {
  month: string;
  revenue: number;
  cost: number;
  profit: number;
}

export default function FinancialDashboard() {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedCompany, setSelectedCompany] = useState<string>('all');
  const [myCompanies, setMyCompanies] = useState<any[]>([]);
  const [financialData, setFinancialData] = useState<FinancialData>({
    totalRevenue: 0,
    totalCost: 0,
    profit: 0,
    invoicesCount: 0,
    paidInvoices: 0,
    pendingInvoices: 0,
  });
  const [monthlyData, setMonthlyData] = useState<MonthlyData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const now = new Date();
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    setDateFrom(firstDayOfMonth.toISOString().slice(0, 10));
    setDateTo(now.toISOString().slice(0, 10));
  }, []);

  useEffect(() => {
    fetchMyCompanies();
  }, []);

  useEffect(() => {
    if (dateFrom && dateTo) {
      fetchFinancialData();
    }
  }, [dateFrom, dateTo, selectedCompany]);

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

  const fetchFinancialData = async () => {
    try {
      setLoading(true);

      let query = supabase
        .from('invoices')
        .select('*')
        .gte('issue_date', dateFrom)
        .lte('issue_date', dateTo);

      if (selectedCompany !== 'all') {
        query = query.eq('my_company_id', selectedCompany);
      }

      const { data: invoices, error } = await query;

      if (error) throw error;

      const revenue = invoices?.reduce((sum, inv) => {
        if (inv.invoice_type !== 'corrective') {
          return sum + (inv.total_gross || 0);
        }
        return sum;
      }, 0) || 0;

      const paid = invoices?.filter((inv) => inv.status === 'paid').length || 0;
      const pending = invoices?.filter((inv) =>
        ['issued', 'sent'].includes(inv.status)
      ).length || 0;

      const { data: costs } = await supabase
        .from('event_costs')
        .select('amount, cost_date')
        .gte('cost_date', dateFrom)
        .lte('cost_date', dateTo);

      const totalCost = costs?.reduce((sum, cost) => sum + (cost.amount || 0), 0) || 0;

      setFinancialData({
        totalRevenue: revenue,
        totalCost,
        profit: revenue - totalCost,
        invoicesCount: invoices?.length || 0,
        paidInvoices: paid,
        pendingInvoices: pending,
      });

      generateMonthlyData(invoices || [], costs || []);
    } catch (err) {
      console.error('Error fetching financial data:', err);
    } finally {
      setLoading(false);
    }
  };

  const generateMonthlyData = (invoices: any[], costs: any[]) => {
    const monthsMap = new Map<string, MonthlyData>();

    invoices.forEach((invoice) => {
      const month = invoice.issue_date?.slice(0, 7) || '';
      if (!month) return;

      if (!monthsMap.has(month)) {
        monthsMap.set(month, { month, revenue: 0, cost: 0, profit: 0 });
      }

      const data = monthsMap.get(month)!;
      if (invoice.invoice_type !== 'corrective') {
        data.revenue += invoice.total_gross || 0;
      }
    });

    costs.forEach((cost) => {
      const month = cost.cost_date?.slice(0, 7) || '';
      if (!month) return;

      if (!monthsMap.has(month)) {
        monthsMap.set(month, { month, revenue: 0, cost: 0, profit: 0 });
      }

      const data = monthsMap.get(month)!;
      data.cost += cost.amount || 0;
    });

    monthsMap.forEach((data) => {
      data.profit = data.revenue - data.cost;
    });

    const sortedData = Array.from(monthsMap.values()).sort((a, b) =>
      a.month.localeCompare(b.month)
    );

    setMonthlyData(sortedData);
  };

  const profitMargin = useMemo(() => {
    if (financialData.totalRevenue === 0) return 0;
    return ((financialData.profit / financialData.totalRevenue) * 100).toFixed(1);
  }, [financialData]);

  const formatCurrency = (amount: number) => {
    return amount.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="text-lg text-[#d3bb73]">Ładowanie danych finansowych...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Filtry */}
      <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Moja firma</label>
            <select
              value={selectedCompany}
              onChange={(e) => setSelectedCompany(e.target.value)}
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
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Data od</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Data do</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Karty z głównymi wskaźnikami */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          <div className="mb-2 flex items-center gap-3">
            <TrendingUp className="h-5 w-5 text-green-400" />
            <span className="text-sm text-[#e5e4e2]/60">Przychody</span>
          </div>
          <div className="text-2xl font-light text-green-400">
            {formatCurrency(financialData.totalRevenue)} zł
          </div>
        </div>

        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          <div className="mb-2 flex items-center gap-3">
            <TrendingDown className="h-5 w-5 text-red-400" />
            <span className="text-sm text-[#e5e4e2]/60">Koszty</span>
          </div>
          <div className="text-2xl font-light text-red-400">
            {formatCurrency(financialData.totalCost)} zł
          </div>
        </div>

        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          <div className="mb-2 flex items-center gap-3">
            <DollarSign className="h-5 w-5 text-[#d3bb73]" />
            <span className="text-sm text-[#e5e4e2]/60">Zysk</span>
          </div>
          <div className={`text-2xl font-light ${financialData.profit >= 0 ? 'text-[#d3bb73]' : 'text-red-400'}`}>
            {formatCurrency(financialData.profit)} zł
          </div>
          <div className="mt-1 text-xs text-[#e5e4e2]/60">
            Marża: {profitMargin}%
          </div>
        </div>

        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          <div className="mb-2 flex items-center gap-3">
            <FileText className="h-5 w-5 text-blue-400" />
            <span className="text-sm text-[#e5e4e2]/60">Faktury</span>
          </div>
          <div className="text-2xl font-light text-[#e5e4e2]">
            {financialData.invoicesCount}
          </div>
          <div className="mt-1 space-y-1 text-xs text-[#e5e4e2]/60">
            <div className="flex justify-between">
              <span>Opłacone:</span>
              <span className="text-green-400">{financialData.paidInvoices}</span>
            </div>
            <div className="flex justify-between">
              <span>Oczekujące:</span>
              <span className="text-yellow-400">{financialData.pendingInvoices}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Wykres miesięczny */}
      <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
        <div className="mb-6 flex items-center gap-3">
          <BarChart3 className="h-6 w-6 text-[#d3bb73]" />
          <h3 className="text-lg font-light text-[#e5e4e2]">Zestawienie miesięczne</h3>
        </div>

        {monthlyData.length === 0 ? (
          <div className="py-12 text-center text-[#e5e4e2]/60">
            Brak danych dla wybranego okresu
          </div>
        ) : (
          <div className="space-y-4">
            {monthlyData.map((data) => {
              const maxValue = Math.max(
                ...monthlyData.map((d) => Math.max(d.revenue, d.cost))
              );

              return (
                <div key={data.month} className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-[#e5e4e2]/80">
                      {new Date(data.month + '-01').toLocaleDateString('pl-PL', {
                        year: 'numeric',
                        month: 'long',
                      })}
                    </span>
                    <span className={`font-medium ${data.profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {formatCurrency(data.profit)} zł
                    </span>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <div className="w-20 text-xs text-green-400">Przychód</div>
                      <div className="flex-1 overflow-hidden rounded-full bg-[#0a0d1a]">
                        <div
                          className="h-2 rounded-full bg-green-400/80 transition-all"
                          style={{ width: `${(data.revenue / maxValue) * 100}%` }}
                        />
                      </div>
                      <div className="w-32 text-right text-xs text-[#e5e4e2]/80">
                        {formatCurrency(data.revenue)} zł
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="w-20 text-xs text-red-400">Koszt</div>
                      <div className="flex-1 overflow-hidden rounded-full bg-[#0a0d1a]">
                        <div
                          className="h-2 rounded-full bg-red-400/80 transition-all"
                          style={{ width: `${(data.cost / maxValue) * 100}%` }}
                        />
                      </div>
                      <div className="w-32 text-right text-xs text-[#e5e4e2]/80">
                        {formatCurrency(data.cost)} zł
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
