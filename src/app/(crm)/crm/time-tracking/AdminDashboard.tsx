'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Clock,
  Users,
  Calendar,
  DollarSign,
  TrendingUp,
  Filter,
  Download,
  ChevronDown,
  User,
  Briefcase,
  ChevronRight,
  ExternalLink,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';

interface TimeEntry {
  id: string;
  employee_id: string;
  title: string | null;
  description: string | null;
  start_time: string;
  end_time: string | null;
  duration_minutes: number | null;
  is_billable: boolean;
  hourly_rate: number | null;
  tags: string[];
  task_id: string | null;
  event_id: string | null;
  tasks?: {
    title: string;
  } | null;
}

interface Employee {
  id: string;
  name: string;
  surname: string;
  avatar_url: string | null;
}

interface EmployeeStats {
  employee_id: string;
  employee_name: string;
  employee_surname: string;
  avatar_url: string | null;
  total_hours: number;
  billable_hours: number;
  total_revenue: number;
  entries_count: number;
  active_days: number;
}

interface DailyStats {
  date: string;
  total_minutes: number;
  entries_count: number;
  employees_count: number;
}

export default function AdminDashboard() {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeStats, setEmployeeStats] = useState<EmployeeStats[]>([]);
  const [dailyStats, setDailyStats] = useState<DailyStats[]>([]);
  const [activeEntries, setActiveEntries] = useState<Map<string, TimeEntry>>(new Map());

  const [dateFrom, setDateFrom] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 7);
    return date.toISOString().split('T')[0];
  });

  const [dateTo, setDateTo] = useState(() => {
    return new Date().toISOString().split('T')[0];
  });

  const [selectedEmployee, setSelectedEmployee] = useState<string>('all');
  const [selectedPeriod, setSelectedPeriod] = useState<'week' | 'month' | 'custom'>('week');

  useEffect(() => {
    fetchData();
  }, [dateFrom, dateTo, selectedEmployee]);

  useEffect(() => {
    if (selectedPeriod === 'week') {
      const date = new Date();
      date.setDate(date.getDate() - 7);
      setDateFrom(date.toISOString().split('T')[0]);
      setDateTo(new Date().toISOString().split('T')[0]);
    } else if (selectedPeriod === 'month') {
      const date = new Date();
      date.setDate(date.getDate() - 30);
      setDateFrom(date.toISOString().split('T')[0]);
      setDateTo(new Date().toISOString().split('T')[0]);
    }
  }, [selectedPeriod]);

  // Realtime subscription dla admin dashboard
  useEffect(() => {
    const channel = supabase
      .channel('admin_time_entries_realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'time_entries',
        },
        (payload) => {
          console.log('Admin: Time entry changed:', payload);
          // Odśwież dane po każdej zmianie
          fetchData();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [dateFrom, dateTo, selectedEmployee]);

  const fetchData = async () => {
    try {
      setLoading(true);

      // 1. Pobierz AKTYWNE timery (zawsze, niezależnie od dat)
      let activeQuery = supabase
        .from('time_entries')
        .select(
          `
          *,
          employees!time_entries_employee_id_fkey(id, name, surname, avatar_url),
          tasks(title, event_id, events(name)),
          events(name)
        `,
        )
        .is('end_time', null);

      if (selectedEmployee !== 'all') {
        activeQuery = activeQuery.eq('employee_id', selectedEmployee);
      }

      const { data: activeEntriesData, error: activeError } = await activeQuery;
      if (activeError) throw activeError;

      // 2. Pobierz wpisy z wybranego okresu
      let query = supabase
        .from('time_entries')
        .select(
          `
          *,
          employees!time_entries_employee_id_fkey(id, name, surname, avatar_url),
          tasks(title, event_id, events(name)),
          events(name)
        `,
        )
        .gte('start_time', dateFrom)
        .lte('start_time', dateTo + 'T23:59:59')
        .order('start_time', { ascending: false });

      if (selectedEmployee !== 'all') {
        query = query.eq('employee_id', selectedEmployee);
      }

      const { data: entriesData, error: entriesError } = await query;

      if (entriesError) throw entriesError;

      // 3. Pobierz pracowników
      const { data: employeesData, error: employeesError } = await supabase
        .from('employees')
        .select('id, name, surname, avatar_url')
        .eq('is_active', true)
        .order('name');

      if (employeesError) throw employeesError;

      // 4. Połącz aktywne timery z wpisami historycznymi (bez duplikatów)
      const allEntries = [...(activeEntriesData || [])];
      const activeIds = new Set((activeEntriesData || []).map((e: any) => e.id));
      (entriesData || []).forEach((entry: any) => {
        if (!activeIds.has(entry.id)) {
          allEntries.push(entry);
        }
      });

      setEntries(allEntries);
      setEmployees(employeesData || []);

      // 5. Stwórz mapę aktywnych timerów
      const activeMap = new Map<string, TimeEntry>();
      allEntries.forEach((entry: any) => {
        if (!entry.end_time) {
          activeMap.set(entry.employee_id, entry);
        }
      });
      setActiveEntries(activeMap);

      calculateStats(allEntries);
    } catch (error) {
      console.error('Error fetching data:', error);
      showSnackbar('Błąd podczas pobierania danych', 'error');
    } finally {
      setLoading(false);
    }
  };

  const calculateStats = (entriesData: any[]) => {
    const employeeMap = new Map<string, EmployeeStats>();
    const dailyMap = new Map<string, DailyStats>();

    entriesData.forEach((entry) => {
      if (!entry.end_time) return;

      const empId = entry.employee_id;
      const empData = entry.employees;
      const duration = entry.duration_minutes || 0;
      const revenue =
        entry.is_billable && entry.hourly_rate ? (duration / 60) * entry.hourly_rate : 0;

      if (!employeeMap.has(empId)) {
        employeeMap.set(empId, {
          employee_id: empId,
          employee_name: empData?.name || 'Nieznany',
          employee_surname: empData?.surname || '',
          avatar_url: empData?.avatar_url || null,
          total_hours: 0,
          billable_hours: 0,
          total_revenue: 0,
          entries_count: 0,
          active_days: 0,
        });
      }

      const stats = employeeMap.get(empId)!;
      stats.total_hours += duration / 60;
      stats.entries_count += 1;
      stats.total_revenue += revenue;

      if (entry.is_billable) {
        stats.billable_hours += duration / 60;
      }

      const date = entry.start_time.split('T')[0];
      if (!dailyMap.has(date)) {
        dailyMap.set(date, {
          date,
          total_minutes: 0,
          entries_count: 0,
          employees_count: 0,
        });
      }

      const dailyStat = dailyMap.get(date)!;
      dailyStat.total_minutes += duration;
      dailyStat.entries_count += 1;
    });

    employeeMap.forEach((stats) => {
      const uniqueDays = new Set(
        entriesData
          .filter((e) => e.employee_id === stats.employee_id && e.end_time)
          .map((e) => e.start_time.split('T')[0]),
      );
      stats.active_days = uniqueDays.size;
    });

    dailyMap.forEach((dailyStat) => {
      const uniqueEmployees = new Set(
        entriesData
          .filter((e) => e.start_time.split('T')[0] === dailyStat.date && e.end_time)
          .map((e) => e.employee_id),
      );
      dailyStat.employees_count = uniqueEmployees.size;
    });

    setEmployeeStats(
      Array.from(employeeMap.values()).sort((a, b) => b.total_hours - a.total_hours),
    );
    setDailyStats(Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date)));
  };

  const formatHours = (hours: number) => {
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return `${h}h ${m}m`;
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('pl-PL', {
      style: 'currency',
      currency: 'PLN',
    }).format(amount);
  };

  const totalStats = {
    totalHours: employeeStats.reduce((sum, s) => sum + s.total_hours, 0),
    billableHours: employeeStats.reduce((sum, s) => sum + s.billable_hours, 0),
    totalRevenue: employeeStats.reduce((sum, s) => sum + s.total_revenue, 0),
    activeEmployees: employeeStats.length,
  };

  const handleExport = () => {
    const csv = [
      ['Pracownik', 'Łączny czas', 'Czas rozliczalny', 'Przychód', 'Liczba wpisów', 'Aktywne dni'],
      ...employeeStats.map((s) => [
        `${s.employee_name} ${s.employee_surname}`,
        formatHours(s.total_hours),
        formatHours(s.billable_hours),
        formatCurrency(s.total_revenue),
        s.entries_count.toString(),
        s.active_days.toString(),
      ]),
    ]
      .map((row) => row.join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `raport-czasu-pracy-${dateFrom}-${dateTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-[#e5e4e2]/60">Ładowanie danych...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-light text-[#e5e4e2]">Raport czasu pracy</h2>
        <button
          onClick={handleExport}
          className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] hover:border-[#d3bb73]/40"
        >
          <Download className="h-4 w-4" />
          Eksportuj CSV
        </button>
      </div>

      <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-4">
          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Okres</label>
            <div className="flex gap-2">
              <button
                onClick={() => setSelectedPeriod('week')}
                className={`flex-1 rounded-lg px-3 py-2 text-sm transition-colors ${
                  selectedPeriod === 'week'
                    ? 'bg-[#d3bb73] text-[#1c1f33]'
                    : 'bg-[#0f1119] text-[#e5e4e2] hover:bg-[#0f1119]/80'
                }`}
              >
                Tydzień
              </button>
              <button
                onClick={() => setSelectedPeriod('month')}
                className={`flex-1 rounded-lg px-3 py-2 text-sm transition-colors ${
                  selectedPeriod === 'month'
                    ? 'bg-[#d3bb73] text-[#1c1f33]'
                    : 'bg-[#0f1119] text-[#e5e4e2] hover:bg-[#0f1119]/80'
                }`}
              >
                Miesiąc
              </button>
              <button
                onClick={() => setSelectedPeriod('custom')}
                className={`flex-1 rounded-lg px-3 py-2 text-sm transition-colors ${
                  selectedPeriod === 'custom'
                    ? 'bg-[#d3bb73] text-[#1c1f33]'
                    : 'bg-[#0f1119] text-[#e5e4e2] hover:bg-[#0f1119]/80'
                }`}
              >
                Własny
              </button>
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Od</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                setSelectedPeriod('custom');
              }}
              className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Do</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                setSelectedPeriod('custom');
              }}
              className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Pracownik</label>
            <select
              value={selectedEmployee}
              onChange={(e) => setSelectedEmployee(e.target.value)}
              className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
            >
              <option value="all">Wszyscy pracownicy</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name} {emp.surname}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <div className="rounded-lg bg-[#0f1119] p-4">
            <div className="mb-2 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#d3bb73]/20">
                <Clock className="h-5 w-5 text-[#d3bb73]" />
              </div>
              <div className="text-sm text-[#e5e4e2]/60">Łączny czas</div>
            </div>
            <div className="text-2xl font-bold text-[#e5e4e2]">
              {formatHours(totalStats.totalHours)}
            </div>
          </div>

          <div className="rounded-lg bg-[#0f1119] p-4">
            <div className="mb-2 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/20">
                <TrendingUp className="h-5 w-5 text-green-400" />
              </div>
              <div className="text-sm text-[#e5e4e2]/60">Rozliczalny</div>
            </div>
            <div className="text-2xl font-bold text-[#e5e4e2]">
              {formatHours(totalStats.billableHours)}
            </div>
          </div>

          <div className="rounded-lg bg-[#0f1119] p-4">
            <div className="mb-2 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/20">
                <DollarSign className="h-5 w-5 text-blue-400" />
              </div>
              <div className="text-sm text-[#e5e4e2]/60">Przychód</div>
            </div>
            <div className="text-2xl font-bold text-[#e5e4e2]">
              {formatCurrency(totalStats.totalRevenue)}
            </div>
          </div>

          <div className="rounded-lg bg-[#0f1119] p-4">
            <div className="mb-2 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-500/20">
                <Users className="h-5 w-5 text-purple-400" />
              </div>
              <div className="text-sm text-[#e5e4e2]/60">Aktywnych</div>
            </div>
            <div className="text-2xl font-bold text-[#e5e4e2]">{totalStats.activeEmployees}</div>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
        <h3 className="mb-4 text-lg font-medium text-[#e5e4e2]">Pracownicy</h3>
        <div className="space-y-3">
          {employeeStats.map((stats) => (
            <button
              key={stats.employee_id}
              onClick={() => router.push(`/crm/time-tracking/${stats.employee_id}`)}
              className="group w-full cursor-pointer rounded-lg bg-[#0f1119] p-4 text-left transition-colors hover:bg-[#0f1119]/80"
            >
              <div className="flex items-center justify-between">
                <div className="flex flex-1 items-center gap-4">
                  {stats.avatar_url ? (
                    <img
                      src={stats.avatar_url}
                      alt={`${stats.employee_name} ${stats.employee_surname}`}
                      className="h-12 w-12 rounded-full object-cover"
                    />
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#d3bb73]/20">
                      <User className="h-6 w-6 text-[#d3bb73]" />
                    </div>
                  )}
                  <div className="flex-1">
                    <div className="flex items-center gap-2 font-medium text-[#e5e4e2]">
                      {stats.employee_name} {stats.employee_surname}
                      {activeEntries.has(stats.employee_id) && (
                        <span className="flex items-center gap-1.5 rounded-full bg-green-500/20 px-2 py-0.5">
                          <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-400"></div>
                          <span className="text-xs font-medium text-green-400">Aktywny</span>
                        </span>
                      )}
                      <ChevronRight className="h-4 w-4 text-[#d3bb73] opacity-0 transition-opacity group-hover:opacity-100" />
                    </div>
                    <div className="flex items-center gap-2 text-sm text-[#e5e4e2]/60">
                      <span>
                        {stats.entries_count} wpisów • {stats.active_days} dni
                      </span>
                      {activeEntries.has(stats.employee_id) && (
                        <>
                          <span>•</span>
                          {activeEntries.get(stats.employee_id)?.task_id &&
                          activeEntries.get(stats.employee_id)?.tasks?.title ? (
                            <span className="flex items-center gap-1.5 text-green-400">
                              <span>
                                {activeEntries.get(stats.employee_id)?.tasks?.title}
                              </span>
                              <Link
                                href={`/crm/tasks/${activeEntries.get(stats.employee_id)?.task_id}`}
                                target="_blank"
                                className="inline-flex items-center gap-1 rounded bg-green-500/10 px-1.5 py-0.5 text-xs font-medium text-green-400 transition-colors hover:bg-green-500/20"
                                title="Otwórz task"
                              >
                                <ExternalLink className="h-3 w-3" />
                              </Link>
                            </span>
                          ) : (
                            <span className="text-green-400">
                              {activeEntries.get(stats.employee_id)?.title ||
                                'W trakcie pracy'}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xl font-bold text-[#d3bb73]">
                    {formatHours(stats.total_hours)}
                  </div>
                  <div className="text-sm text-[#e5e4e2]/60">
                    {formatHours(stats.billable_hours)} rozliczalnych
                  </div>
                  {stats.total_revenue > 0 && (
                    <div className="mt-1 text-sm text-green-400">
                      {formatCurrency(stats.total_revenue)}
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#1c1f33]">
                <div
                  className="h-full bg-[#d3bb73] transition-all"
                  style={{
                    width: `${totalStats.totalHours > 0 ? (stats.total_hours / totalStats.totalHours) * 100 : 0}%`,
                  }}
                />
              </div>
            </button>
          ))}

          {employeeStats.length === 0 && (
            <div className="py-8 text-center text-[#e5e4e2]/60">
              Brak danych dla wybranego okresu
            </div>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
        <h3 className="mb-4 text-lg font-medium text-[#e5e4e2]">Aktywność dzienna</h3>
        <div className="space-y-2">
          {dailyStats.map((stat) => (
            <div
              key={stat.date}
              className="flex items-center justify-between rounded-lg bg-[#0f1119] p-3"
            >
              <div className="flex items-center gap-4">
                <div className="w-24 text-sm text-[#e5e4e2]/60">
                  {new Date(stat.date).toLocaleDateString('pl-PL', {
                    day: '2-digit',
                    month: 'short',
                    weekday: 'short',
                  })}
                </div>
                <div className="font-medium text-[#e5e4e2]">
                  {formatHours(stat.total_minutes / 60)}
                </div>
              </div>
              <div className="flex items-center gap-4 text-sm text-[#e5e4e2]/60">
                <span>{stat.entries_count} wpisów</span>
                <span>{stat.employees_count} pracowników</span>
              </div>
            </div>
          ))}

          {dailyStats.length === 0 && (
            <div className="py-8 text-center text-[#e5e4e2]/60">
              Brak danych dla wybranego okresu
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
