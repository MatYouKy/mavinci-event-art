'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
  Clock,
  ArrowLeft,
  Calendar,
  Tag,
  DollarSign,
  TrendingUp,
  User,
  History,
  Trash2,
  Edit3,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  List,
  TableIcon,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { EmployeeAvatar } from '@/components/EmployeeAvatar';

interface TimeEntry {
  id: string;
  employee_id: string;
  task_id: string | null;
  event_id: string | null;
  title: string | null;
  description: string | null;
  start_time: string;
  end_time: string | null;
  duration_minutes: number | null;
  is_billable: boolean;
  hourly_rate: number | null;
  tags: string[];
  edit_count?: number;
  tasks?: {
    title: string;
    event_id: string | null;
    events?: {
      name: string;
    };
  } | null;
  events?: {
    name: string;
  } | null;
}

interface Employee {
  id: string;
  name: string;
  surname: string;
  email: string;
  phone_number: string | null;
  avatar_url: string | null;
  avatar_metadata?: any;
}

interface HistoryEntry {
  id: string;
  time_entry_id: string;
  action: 'created' | 'updated' | 'deleted';
  changed_at: string;
  changed_by: string;
  employee_name: string;
  employee_surname: string;
  changed_fields?: string[];
  old_values?: any;
  new_values?: any;
}

interface TaskStats {
  task_id: string | null;
  task_title: string;
  event_name: string | null;
  total_minutes: number;
  entries_count: number;
  last_worked: string;
}

export default function EmployeeTimeTrackingPage() {
  const router = useRouter();
  const params = useParams();
  const employeeId = params.employeeId as string;
  const { showSnackbar } = useSnackbar();
  const { employee: currentEmployee, isAdmin } = useCurrentEmployee();

  const [loading, setLoading] = useState(true);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [taskStats, setTaskStats] = useState<TaskStats[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showDeletedOnly, setShowDeletedOnly] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'table'>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('time-tracking-view-mode') as 'list' | 'table') || 'list';
    }
    return 'list';
  });
  const [activeEntry, setActiveEntry] = useState<TimeEntry | null>(null);
  const [liveTime, setLiveTime] = useState<string>('00:00:00');

  const [dateFrom, setDateFrom] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    return date.toISOString().split('T')[0];
  });

  const [dateTo, setDateTo] = useState(() => {
    return new Date().toISOString().split('T')[0];
  });

  useEffect(() => {
    if (employeeId) {
      fetchData();
    }
  }, [employeeId, dateFrom, dateTo]);

  useEffect(() => {
    const active = entries.find((e) => !e.end_time);
    setActiveEntry(active || null);
  }, [entries]);

  useEffect(() => {
    if (!activeEntry) {
      setLiveTime('00:00:00');
      return;
    }

    const updateTimer = () => {
      const start = new Date(activeEntry.start_time);
      const now = new Date();
      const diffMs = now.getTime() - start.getTime();
      const diffSeconds = Math.floor(diffMs / 1000);

      const hours = Math.floor(diffSeconds / 3600);
      const minutes = Math.floor((diffSeconds % 3600) / 60);
      const seconds = diffSeconds % 60;

      setLiveTime(
        `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`,
      );
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [activeEntry]);

  const fetchData = async () => {
    try {
      setLoading(true);

      const { data: empData, error: empError } = await supabase
        .from('employees')
        .select('*')
        .eq('id', employeeId)
        .maybeSingle();

      if (empError) throw empError;
      if (!empData) {
        showSnackbar('Nie znaleziono pracownika', 'error');
        router.push('/crm/time-tracking');
        return;
      }

      setEmployee(empData);

      const { data: entriesData, error: entriesError } = await supabase
        .from('time_entries')
        .select(
          `
          *,
          tasks (
            title,
            event_id,
            events (name)
          ),
          events (
            name
          )
        `,
        )
        .eq('employee_id', employeeId)
        .gte('start_time', dateFrom)
        .lte('start_time', dateTo + 'T23:59:59')
        .order('start_time', { ascending: false });

      if (entriesError) throw entriesError;
      setEntries(entriesData || []);

      calculateTaskStats(entriesData || []);

      if (isAdmin) {
        const { data: historyData, error: historyError } = await supabase
          .from('admin_time_entries_history_view')
          .select('*')
          .eq('employee_id', employeeId)
          .gte('changed_at', dateFrom)
          .lte('changed_at', dateTo + 'T23:59:59')
          .order('changed_at', { ascending: false });

        if (historyError) throw historyError;
        setHistory(historyData || []);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
      showSnackbar('Błąd podczas ładowania danych', 'error');
    } finally {
      setLoading(false);
    }
  };

  const calculateTaskStats = (entriesData: TimeEntry[]) => {
    const taskMap = new Map<string, TaskStats>();

    entriesData.forEach((entry) => {
      if (!entry.end_time) return;

      const taskKey = entry.task_id || 'no-task';
      const taskTitle = entry.tasks?.title || entry.title || 'Praca bez zadania';
      const eventName = entry.tasks?.events?.name || entry.events?.name || null;

      if (!taskMap.has(taskKey)) {
        taskMap.set(taskKey, {
          task_id: entry.task_id,
          task_title: taskTitle,
          event_name: eventName,
          total_minutes: 0,
          entries_count: 0,
          last_worked: entry.start_time,
        });
      }

      const stats = taskMap.get(taskKey)!;
      stats.total_minutes += entry.duration_minutes || 0;
      stats.entries_count += 1;

      if (new Date(entry.start_time) > new Date(stats.last_worked)) {
        stats.last_worked = entry.start_time;
      }
    });

    setTaskStats(Array.from(taskMap.values()).sort((a, b) => b.total_minutes - a.total_minutes));
  };

  const formatHours = (minutes: number) => {
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return `${h}h ${m}m`;
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('pl-PL', {
      style: 'currency',
      currency: 'PLN',
    }).format(amount);
  };

  const handleViewModeChange = (mode: 'list' | 'table') => {
    setViewMode(mode);
    if (typeof window !== 'undefined') {
      localStorage.setItem('time-tracking-view-mode', mode);
    }
  };

  const handleDelete = async (entryId: string) => {
    if (!isAdmin) {
      showSnackbar('Brak uprawnień do usuwania wpisów', 'error');
      return;
    }

    if (!confirm('Czy na pewno chcesz usunąć ten wpis czasu pracy? Ta operacja jest nieodwracalna.')) {
      return;
    }

    try {
      const { error } = await supabase.from('time_entries').delete().eq('id', entryId);

      if (error) throw error;

      showSnackbar('Wpis został usunięty', 'success');
      fetchData();
    } catch (error) {
      console.error('Error deleting time entry:', error);
      showSnackbar('Błąd podczas usuwania wpisu', 'error');
    }
  };

  const totalMinutes = entries
    .filter((e) => e.duration_minutes)
    .reduce((sum, e) => sum + (e.duration_minutes || 0), 0);

  const billableMinutes = entries
    .filter((e) => e.duration_minutes && e.is_billable)
    .reduce((sum, e) => sum + (e.duration_minutes || 0), 0);

  const totalRevenue = entries
    .filter((e) => e.is_billable && e.hourly_rate && e.duration_minutes)
    .reduce((sum, e) => sum + ((e.duration_minutes || 0) / 60) * (e.hourly_rate || 0), 0);

  const filteredHistory = showDeletedOnly ? history.filter((h) => h.action === 'deleted') : history;

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0f1119]">
        <div className="text-[#e5e4e2]/60">Ładowanie...</div>
      </div>
    );
  }

  if (!employee) {
    return null;
  }

  return (
    <div className="min-h-screen bg-[#0f1119] p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <button
          onClick={() => router.push('/crm/time-tracking')}
          className="mb-4 flex items-center gap-2 text-[#e5e4e2]/60 transition-colors hover:text-[#e5e4e2]"
        >
          <ArrowLeft className="h-4 w-4" />
          Powrót do raportu
        </button>

        <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          <div className="flex items-center gap-6">
            <EmployeeAvatar employee={employee} size={80} className="flex-shrink-0" />
            <div className="flex-1">
              <div className="mb-2 flex items-center gap-3">
                <h1 className="text-3xl font-light text-[#e5e4e2]">
                  {employee.name} {employee.surname}
                </h1>
                {activeEntry && (
                  <span className="flex items-center gap-1.5 rounded-full bg-green-500/20 px-3 py-1">
                    <div className="h-2 w-2 animate-pulse rounded-full bg-green-400"></div>
                    <span className="text-sm font-medium text-green-400">Aktywny licznik</span>
                  </span>
                )}
              </div>
              <div className="flex gap-4 text-sm text-[#e5e4e2]/60">
                <span>{employee.email}</span>
                {employee.phone_number && <span>{employee.phone_number}</span>}
              </div>
            </div>
          </div>
        </div>

        {activeEntry && (
          <div className="rounded-lg border border-green-500/20 bg-[#1c1f33] p-6">
            <div className="mb-4 flex items-center gap-2 text-green-400">
              <Clock className="h-5 w-5" />
              <h3 className="text-lg font-medium">Aktualnie naliczany czas pracy</h3>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <div className="mb-2 text-sm text-[#e5e4e2]/60">Zadanie</div>
                <div className="text-lg font-medium text-[#e5e4e2]">
                  {activeEntry.tasks?.title || activeEntry.title || 'Praca'}
                </div>
                {(activeEntry.tasks?.events?.name || activeEntry.events?.name) && (
                  <div className="mt-1 text-sm text-[#e5e4e2]/60">
                    Wydarzenie: {activeEntry.tasks?.events?.name || activeEntry.events?.name}
                  </div>
                )}
                {activeEntry.description && (
                  <div className="mt-2 text-sm text-[#e5e4e2]/60">{activeEntry.description}</div>
                )}
              </div>
              <div>
                <div className="mb-2 text-sm text-[#e5e4e2]/60">Rozpoczęto</div>
                <div className="text-[#e5e4e2]">
                  {new Date(activeEntry.start_time).toLocaleString('pl-PL')}
                </div>
                <div className="mt-4 text-sm text-[#e5e4e2]/60">Czas trwania</div>
                <div className="text-3xl font-bold text-green-400">{liveTime}</div>
                {activeEntry.hourly_rate && (
                  <div className="mt-2 text-sm text-[#e5e4e2]/60">
                    Stawka: {activeEntry.hourly_rate} zł/h
                  </div>
                )}
                {activeEntry.is_billable && (
                  <div className="mt-1 inline-block rounded-full bg-green-500/20 px-2 py-1 text-xs text-green-400">
                    Płatne
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          <div className="mb-6 flex items-center gap-4">
            <div className="grid flex-1 grid-cols-2 gap-4">
              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Od</label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Do</label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <div className="rounded-lg bg-[#0f1119] p-4">
              <div className="mb-2 flex items-center gap-3">
                <Clock className="h-5 w-5 text-blue-400" />
                <span className="text-sm text-[#e5e4e2]/60">Łączny czas</span>
              </div>
              <div className="text-2xl font-bold text-[#e5e4e2]">{formatHours(totalMinutes)}</div>
            </div>

            <div className="rounded-lg bg-[#0f1119] p-4">
              <div className="mb-2 flex items-center gap-3">
                <DollarSign className="h-5 w-5 text-green-400" />
                <span className="text-sm text-[#e5e4e2]/60">Rozliczalny</span>
              </div>
              <div className="text-2xl font-bold text-[#d3bb73]">
                {formatHours(billableMinutes)}
              </div>
            </div>

            <div className="rounded-lg bg-[#0f1119] p-4">
              <div className="mb-2 flex items-center gap-3">
                <TrendingUp className="h-5 w-5 text-purple-400" />
                <span className="text-sm text-[#e5e4e2]/60">Przychód</span>
              </div>
              <div className="text-2xl font-bold text-[#e5e4e2]">
                {formatCurrency(totalRevenue)}
              </div>
            </div>

            <div className="rounded-lg bg-[#0f1119] p-4">
              <div className="mb-2 flex items-center gap-3">
                <Calendar className="h-5 w-5 text-yellow-400" />
                <span className="text-sm text-[#e5e4e2]/60">Wpisów</span>
              </div>
              <div className="text-2xl font-bold text-[#e5e4e2]">{entries.length}</div>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          <h3 className="mb-4 flex items-center gap-2 text-lg font-medium text-[#e5e4e2]">
            <Tag className="h-5 w-5 text-[#d3bb73]" />
            Czas pracy według zadań
          </h3>
          <div className="space-y-3">
            {taskStats.map((stat, index) => (
              <div key={index} className="rounded-lg bg-[#0f1119] p-4">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex-1">
                    <h4 className="font-medium text-[#e5e4e2]">{stat.task_title}</h4>
                    {stat.event_name && (
                      <p className="mt-1 text-sm text-[#e5e4e2]/60">
                        Wydarzenie: {stat.event_name}
                      </p>
                    )}
                    <div className="mt-1 text-xs text-[#e5e4e2]/40">
                      {stat.entries_count} wpisów • Ostatnio:{' '}
                      {new Date(stat.last_worked).toLocaleDateString('pl-PL')}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-[#d3bb73]">
                      {formatHours(stat.total_minutes)}
                    </div>
                  </div>
                </div>

                <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#1c1f33]">
                  <div
                    className="h-full bg-[#d3bb73] transition-all"
                    style={{
                      width: `${totalMinutes > 0 ? (stat.total_minutes / totalMinutes) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
            ))}

            {taskStats.length === 0 && (
              <div className="py-8 text-center text-[#e5e4e2]/60">
                Brak danych dla wybranego okresu
              </div>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-lg font-medium text-[#e5e4e2]">
              <Clock className="h-5 w-5 text-[#d3bb73]" />
              Wszystkie wpisy czasu
            </h3>
            <div className="flex items-center gap-2 rounded-lg bg-[#0f1119] p-1">
              <button
                onClick={() => handleViewModeChange('list')}
                className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                  viewMode === 'list'
                    ? 'bg-[#d3bb73] text-[#0f1119]'
                    : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
                }`}
              >
                <List className="h-4 w-4" />
                Lista
              </button>
              <button
                onClick={() => handleViewModeChange('table')}
                className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                  viewMode === 'table'
                    ? 'bg-[#d3bb73] text-[#0f1119]'
                    : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
                }`}
              >
                <TableIcon className="h-4 w-4" />
                Tabela
              </button>
            </div>
          </div>
          {viewMode === 'list' ? (
            <div className="space-y-3">
            {entries.map((entry) => (
              <div key={entry.id} className="rounded-lg border border-[#d3bb73]/5 bg-[#0f1119] p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="mb-2 flex items-center gap-3">
                      <h4 className="font-semibold text-[#e5e4e2]">
                        {entry.tasks?.title || entry.title || 'Praca'}
                      </h4>
                      {entry.is_billable && (
                        <span className="rounded bg-green-500/20 px-2 py-1 text-xs text-green-400">
                          Płatne
                        </span>
                      )}
                      {isAdmin && entry.edit_count && entry.edit_count > 0 && (
                        <span className="flex items-center gap-1 rounded bg-yellow-500/20 px-2 py-1 text-xs text-yellow-400">
                          <Edit3 className="h-3 w-3" />
                          {entry.edit_count}
                        </span>
                      )}
                    </div>
                    {entry.description && (
                      <p className="mb-2 text-sm text-[#e5e4e2]/60">{entry.description}</p>
                    )}
                    {(entry.tasks?.events?.name || entry.events?.name) && (
                      <p className="text-xs text-[#e5e4e2]/40">
                        Wydarzenie: {entry.tasks?.events?.name || entry.events?.name}
                      </p>
                    )}
                    <div className="mt-2 flex items-center gap-4 text-sm text-[#e5e4e2]/60">
                      <span>
                        {new Date(entry.start_time).toLocaleDateString('pl-PL', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </span>
                      <span>
                        {new Date(entry.start_time).toLocaleTimeString('pl-PL', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                        {' - '}
                        {entry.end_time
                          ? new Date(entry.end_time).toLocaleTimeString('pl-PL', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : 'w trakcie'}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <div className="text-2xl font-bold text-[#d3bb73]">
                      {formatHours(entry.duration_minutes || 0)}
                    </div>
                    {entry.hourly_rate && (
                      <div className="text-xs text-[#e5e4e2]/40">{entry.hourly_rate} zł/h</div>
                    )}
                    {isAdmin && (
                      <button
                        onClick={() => handleDelete(entry.id)}
                        className="mt-2 flex items-center gap-1 rounded-lg bg-red-500/10 px-3 py-1.5 text-sm text-red-400 transition-colors hover:bg-red-500/20"
                        title="Usuń wpis"
                      >
                        <Trash2 className="h-4 w-4" />
                        Usuń
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {entries.length === 0 && (
              <div className="py-8 text-center text-[#e5e4e2]/60">
                Brak wpisów czasu dla wybranego okresu
              </div>
            )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div className="mb-3 text-sm text-[#e5e4e2]/60">
                Wyświetlanie {entries.length} {entries.length === 1 ? 'wpisu' : entries.length < 5 ? 'wpisów' : 'wpisów'}
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#d3bb73]/10 text-left text-xs uppercase text-[#e5e4e2]/60">
                    <th className="px-3 py-3 font-medium">Data</th>
                    <th className="px-3 py-3 font-medium">Godziny</th>
                    <th className="px-3 py-3 font-medium">Zadanie / Tytuł</th>
                    <th className="px-3 py-3 font-medium">Wydarzenie</th>
                    <th className="px-3 py-3 font-medium">Opis</th>
                    <th className="px-3 py-3 text-center font-medium">Czas</th>
                    <th className="px-3 py-3 text-center font-medium">Stawka</th>
                    <th className="px-3 py-3 text-center font-medium">Status</th>
                    {isAdmin && <th className="px-3 py-3 text-center font-medium">Edycje</th>}
                    {isAdmin && <th className="px-3 py-3 text-center font-medium">Akcje</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#d3bb73]/5">
                  {entries.map((entry) => (
                    <tr
                      key={entry.id}
                      className="transition-colors hover:bg-[#d3bb73]/5"
                    >
                      <td className="px-3 py-3 text-[#e5e4e2]">
                        {new Date(entry.start_time).toLocaleDateString('pl-PL', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                        })}
                      </td>
                      <td className="px-3 py-3 text-[#e5e4e2]/80">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-xs">
                            {new Date(entry.start_time).toLocaleTimeString('pl-PL', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                          <span className="text-xs text-[#e5e4e2]/40">
                            {entry.end_time
                              ? new Date(entry.end_time).toLocaleTimeString('pl-PL', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })
                              : 'w trakcie'}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="max-w-xs">
                          <div className="truncate font-medium text-[#e5e4e2]">
                            {entry.tasks?.title || entry.title || 'Praca'}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="max-w-xs">
                          {(entry.tasks?.events?.name || entry.events?.name) && (
                            <span className="truncate text-xs text-[#e5e4e2]/60">
                              {entry.tasks?.events?.name || entry.events?.name}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="max-w-xs">
                          {entry.description && (
                            <span className="truncate text-xs text-[#e5e4e2]/60">
                              {entry.description}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span className="font-bold text-[#d3bb73]">
                          {formatHours(entry.duration_minutes || 0)}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-center text-[#e5e4e2]/60">
                        {entry.hourly_rate ? (
                          <span className="text-xs">{entry.hourly_rate} zł/h</span>
                        ) : (
                          <span className="text-xs text-[#e5e4e2]/40">-</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-center">
                        {entry.is_billable ? (
                          <span className="inline-flex rounded-full bg-green-500/20 px-2 py-0.5 text-xs text-green-400">
                            Płatne
                          </span>
                        ) : (
                          <span className="inline-flex rounded-full bg-gray-500/20 px-2 py-0.5 text-xs text-gray-400">
                            Niepłatne
                          </span>
                        )}
                      </td>
                      {isAdmin && (
                        <td className="px-3 py-3 text-center">
                          {entry.edit_count && entry.edit_count > 0 ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-yellow-500/20 px-2 py-0.5 text-xs text-yellow-400">
                              <Edit3 className="h-3 w-3" />
                              {entry.edit_count}
                            </span>
                          ) : (
                            <span className="text-xs text-[#e5e4e2]/40">-</span>
                          )}
                        </td>
                      )}
                      {isAdmin && (
                        <td className="px-3 py-3 text-center">
                          <button
                            onClick={() => handleDelete(entry.id)}
                            className="inline-flex items-center gap-1 rounded-lg bg-red-500/10 px-2 py-1 text-xs text-red-400 transition-colors hover:bg-red-500/20"
                            title="Usuń wpis"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>

              {entries.length === 0 && (
                <div className="py-8 text-center text-[#e5e4e2]/60">
                  Brak wpisów czasu dla wybranego okresu
                </div>
              )}
            </div>
          )}
        </div>

        {isAdmin && (
          <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-lg font-medium text-[#e5e4e2]">
                <History className="h-5 w-5 text-[#d3bb73]" />
                Historia zmian i usunięć
                <span className="text-sm font-normal text-[#e5e4e2]/60">(tylko dla adminów)</span>
              </h3>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm text-[#e5e4e2]/60">
                  <input
                    type="checkbox"
                    checked={showDeletedOnly}
                    onChange={(e) => setShowDeletedOnly(e.target.checked)}
                    className="rounded border-[#d3bb73]/20"
                  />
                  Tylko usunięte
                </label>
                <button
                  onClick={() => setShowHistory(!showHistory)}
                  className="flex items-center gap-2 text-[#e5e4e2]/60 transition-colors hover:text-[#e5e4e2]"
                >
                  {showHistory ? (
                    <>
                      <ChevronUp className="h-4 w-4" />
                      Ukryj
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-4 w-4" />
                      Pokaż ({filteredHistory.length})
                    </>
                  )}
                </button>
              </div>
            </div>

            {showHistory && (
              <div className="mt-4 space-y-3">
                {filteredHistory.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-lg border border-[#d3bb73]/5 bg-[#0f1119] p-4"
                  >
                    <div className="mb-3 flex items-start justify-between">
                      <div>
                        <span
                          className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${
                            item.action === 'created'
                              ? 'bg-green-500/20 text-green-400'
                              : item.action === 'updated'
                                ? 'bg-blue-500/20 text-blue-400'
                                : 'bg-red-500/20 text-red-400'
                          }`}
                        >
                          {item.action === 'created'
                            ? 'Utworzono'
                            : item.action === 'updated'
                              ? 'Edytowano'
                              : 'Usunięto'}
                        </span>
                        {item.action === 'deleted' && (
                          <span className="ml-2 flex items-center gap-1 text-xs text-red-400">
                            <AlertTriangle className="h-3 w-3" />
                            Wpis nieodwracalnie usunięty
                          </span>
                        )}
                      </div>
                      <div className="text-right">
                        <div className="text-sm text-[#e5e4e2]">
                          {item.employee_name} {item.employee_surname}
                        </div>
                        <div className="text-xs text-[#e5e4e2]/60">
                          {new Date(item.changed_at).toLocaleString('pl-PL')}
                        </div>
                      </div>
                    </div>

                    {item.action === 'updated' && item.changed_fields && (
                      <div className="mt-3 space-y-2">
                        {item.changed_fields.map((field: string) => (
                          <div
                            key={field}
                            className="flex items-start gap-4 border-t border-[#d3bb73]/5 pt-2 text-sm"
                          >
                            <div className="min-w-[120px] font-medium text-[#e5e4e2]/60">
                              {field}:
                            </div>
                            <div className="flex flex-1 items-center gap-3">
                              <div className="flex-1">
                                <div className="text-red-400 line-through">
                                  {String(item.old_values?.[field] || 'brak')}
                                </div>
                              </div>
                              <div className="text-[#e5e4e2]/40">→</div>
                              <div className="flex-1">
                                <div className="text-green-400">
                                  {String(item.new_values?.[field] || 'brak')}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}

                {filteredHistory.length === 0 && (
                  <div className="py-8 text-center text-[#e5e4e2]/60">
                    {showDeletedOnly
                      ? 'Brak usuniętych wpisów'
                      : 'Brak historii zmian dla wybranego okresu'}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
