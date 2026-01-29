'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Clock,
  Play,
  Pause,
  Square,
  Plus,
  Calendar,
  Filter,
  Download,
  ChevronDown,
  ChevronUp,
  Tag,
  DollarSign,
  CheckCircle,
  XCircle,
  Edit,
  Trash2,
  History,
  BarChart3,
  List,
  ExternalLink,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import AdminDashboard from './AdminDashboard';

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
  employee_name?: string;
  employee_surname?: string;
  task_title?: string;
  event_name?: string;
  tasks?: {
    title: string;
    event_id: string | null;
  } | null;
  events?: {
    name: string;
  } | null;
}

interface Task {
  id: string;
  title: string;
  event_id: string | null;
  events?: {
    name: string;
  };
}

export default function TimeTrackingPage() {
  const { showSnackbar } = useSnackbar();
  const { employee, loading: employeeLoading, isAdmin } = useCurrentEmployee();
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activeTimer, setActiveTimer] = useState<TimeEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null);
  const [historyEntryId, setHistoryEntryId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'my' | 'all'>('my');
  const [filterEmployee, setFilterEmployee] = useState<string>('');
  const [filterDateFrom, setFilterDateFrom] = useState<string>('');
  const [filterDateTo, setFilterDateTo] = useState<string>('');
  const [allEmployees, setAllEmployees] = useState<any[]>([]);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [adminView, setAdminView] = useState<'dashboard' | 'list'>('dashboard');

  useEffect(() => {
    if (!employeeLoading && employee) {
      fetchData();
      fetchTasks();
      if (isAdmin) {
        fetchAllEmployees();
      }
    }
  }, [employee, employeeLoading, viewMode, filterEmployee, filterDateFrom, filterDateTo, isAdmin]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (activeTimer) {
      interval = setInterval(() => {
        const start = new Date(activeTimer.start_time).getTime();
        const now = Date.now();
        setElapsedTime(Math.floor((now - start) / 1000));
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [activeTimer]);

  // Realtime subscription dla time_entries
  useEffect(() => {
    if (!employee) return;

    const channel = supabase
      .channel('time_entries_realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'time_entries',
        },
        (payload) => {
          console.log('Time entry changed:', payload);
          // Odśwież dane po każdej zmianie
          fetchData();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [employee, viewMode, filterEmployee, filterDateFrom, filterDateTo]);

  const fetchData = async () => {
    try {
      setLoading(true);

      // Sprawdź aktywny timer użytkownika
      const { data: activeData } = await supabase
        .from('time_entries')
        .select(
          `
          *,
          tasks (
            title,
            event_id
          ),
          events (
            name
          )
        `,
        )
        .eq('employee_id', employee!.id)
        .is('end_time', null)
        .maybeSingle();

      setActiveTimer(activeData || null);

      // Pobierz AKTYWNE timery (zawsze, niezależnie od filtrów)
      let activeQuery = supabase
        .from('time_entries')
        .select(
          `
          *,
          tasks (
            title,
            event_id
          ),
          events (
            name
          )
        `,
        )
        .is('end_time', null);

      // Dla widoku "my" pokaż tylko swoje aktywne
      if (viewMode === 'my') {
        activeQuery = activeQuery.eq('employee_id', employee!.id);
      }

      // Jeśli filtrujemy po konkretnym pracowniku
      if (filterEmployee) {
        activeQuery = activeQuery.eq('employee_id', filterEmployee);
      }

      const { data: activeEntries, error: activeError } = await activeQuery;
      if (activeError) throw activeError;

      // Pobierz wpisy z wybranego okresu
      let query = supabase
        .from('time_entries')
        .select(
          `
          *,
          tasks (
            title,
            event_id
          ),
          events (
            name
          )
        `,
        )
        .order('start_time', { ascending: false })
        .limit(100);

      if (viewMode === 'my') {
        query = query.eq('employee_id', employee!.id);
      }

      if (filterEmployee) {
        query = query.eq('employee_id', filterEmployee);
      }

      if (filterDateFrom) {
        query = query.gte('start_time', filterDateFrom);
      }

      if (filterDateTo) {
        query = query.lte('start_time', filterDateTo);
      }

      const { data, error } = await query;

      if (error) throw error;

      // Połącz aktywne wpisy z wpisami historycznymi (bez duplikatów)
      const allEntries = [...(activeEntries || [])];
      const activeIds = new Set((activeEntries || []).map((e: any) => e.id));
      (data || []).forEach((entry: any) => {
        if (!activeIds.has(entry.id)) {
          allEntries.push(entry);
        }
      });

      setEntries(allEntries);
    } catch (error) {
      console.error('Error fetching time entries:', error);
      showSnackbar('Błąd podczas ładowania wpisów czasu', 'error');
    } finally {
      setLoading(false);
    }
  };

  const fetchTasks = async () => {
    try {
      const { data, error } = await supabase
        .from('tasks')
        .select(
          `
          id,
          title,
          event_id,
          events (name)
        `,
        )
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      setTasks(data || []);
    } catch (error) {
      console.error('Error fetching tasks:', error);
    }
  };

  const fetchAllEmployees = async () => {
    try {
      const { data, error } = await supabase
        .from('employees')
        .select('id, name, surname, email')
        .eq('is_active', true)
        .order('name', { ascending: true });

      if (error) throw error;
      setAllEmployees(data || []);
    } catch (error) {
      console.error('Error fetching employees:', error);
    }
  };

  const startTimer = async (taskId: string | null, title: string | null, description: string) => {
    try {
      const { data, error } = await supabase
        .from('time_entries')
        .insert([
          {
            employee_id: employee!.id,
            task_id: taskId,
            title: title,
            description: description || null,
            start_time: new Date().toISOString(),
          },
        ])
        .select()
        .single();

      if (error) throw error;
      setActiveTimer(data);
      showSnackbar('Timer rozpoczęty!', 'success');
      fetchData();
    } catch (error) {
      console.error('Error starting timer:', error);
      showSnackbar('Błąd podczas uruchamiania timera', 'error');
    }
  };

  const stopTimer = async () => {
    if (!activeTimer) return;

    try {
      const { error } = await supabase
        .from('time_entries')
        .update({ end_time: new Date().toISOString() })
        .eq('id', activeTimer.id);

      if (error) throw error;
      setActiveTimer(null);
      setElapsedTime(0);
      showSnackbar('Timer zatrzymany!', 'success');
      fetchData();
    } catch (error) {
      console.error('Error stopping timer:', error);
      showSnackbar('Błąd podczas zatrzymywania timera', 'error');
    }
  };

  const deleteEntry = async (id: string) => {
    if (!confirm('Czy na pewno chcesz usunąć ten wpis czasu?')) return;

    try {
      const { error } = await supabase.from('time_entries').delete().eq('id', id);

      if (error) throw error;
      showSnackbar('Wpis usunięty', 'success');
      fetchData();
    } catch (error) {
      console.error('Error deleting entry:', error);
      showSnackbar('Błąd podczas usuwania wpisu', 'error');
    }
  };

  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const formatMinutes = (minutes: number | null) => {
    if (!minutes) return '0h 0m';
    const h = Math.floor(minutes / 60);
    const m = Math.floor(minutes % 60);
    return `${h}h ${m}m`;
  };

  const totalMinutes = entries
    .filter((e) => e.duration_minutes)
    .reduce((sum, e) => sum + (e.duration_minutes || 0), 0);

  const billableMinutes = entries
    .filter((e) => e.duration_minutes && e.is_billable)
    .reduce((sum, e) => sum + (e.duration_minutes || 0), 0);

  if (employeeLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-[#e5e4e2]/60">Ładowanie...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f1119] p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Nagłówek */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="flex items-center gap-3 text-2xl font-bold text-[#e5e4e2]">
              <Clock className="h-8 w-8 text-[#d3bb73]" />
              Śledzenie czasu pracy
            </h1>
            <p className="mt-1 text-sm text-[#e5e4e2]/60">
              {isAdmin && adminView === 'dashboard'
                ? 'Raport czasu pracy zespołu'
                : 'Loguj swój czas pracy i zarządzaj wpisami'}
            </p>
          </div>
          {isAdmin && (
            <div className="flex gap-2">
              <button
                onClick={() => setAdminView('dashboard')}
                className={`flex items-center gap-2 rounded-lg px-4 py-2 transition-colors ${
                  adminView === 'dashboard'
                    ? 'bg-[#d3bb73] text-[#1c1f33]'
                    : 'bg-[#1c1f33] text-[#e5e4e2] hover:bg-[#1c1f33]/80'
                }`}
              >
                <BarChart3 className="h-4 w-4" />
                Dashboard
              </button>
              <button
                onClick={() => setAdminView('list')}
                className={`flex items-center gap-2 rounded-lg px-4 py-2 transition-colors ${
                  adminView === 'list'
                    ? 'bg-[#d3bb73] text-[#1c1f33]'
                    : 'bg-[#1c1f33] text-[#e5e4e2] hover:bg-[#1c1f33]/80'
                }`}
              >
                <List className="h-4 w-4" />
                Lista
              </button>
            </div>
          )}
        </div>

        {/* Admin Dashboard */}
        {isAdmin && adminView === 'dashboard' ? (
          <AdminDashboard />
        ) : (
          <>
            {/* Aktywny timer */}
            {activeTimer ? (
              <div className="rounded-xl border border-green-500/30 bg-gradient-to-r from-green-500/20 to-blue-500/20 p-6">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="mb-2 flex items-center gap-3">
                      <div className="h-3 w-3 animate-pulse rounded-full bg-green-500" />
                      <span className="text-sm text-[#e5e4e2]/60">Timer aktywny</span>
                    </div>
                    <h3 className="mb-1 flex items-center gap-2 text-xl font-semibold text-[#e5e4e2]">
                      {activeTimer.task_id && activeTimer.tasks ? (
                        <>
                          <span>{activeTimer.tasks.title}</span>
                          <Link
                            href={`/crm/tasks/${activeTimer.task_id}`}
                            target="_blank"
                            className="inline-flex items-center gap-1 rounded bg-[#d3bb73]/10 px-2 py-1 text-xs font-medium text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/20"
                            title="Otwórz task"
                          >
                            <ExternalLink className="h-3 w-3" />
                            Task
                          </Link>
                        </>
                      ) : (
                        activeTimer.title || activeTimer.task_title || 'Praca'
                      )}
                    </h3>
                    {activeTimer.description && (
                      <p className="text-sm text-[#e5e4e2]/60">{activeTimer.description}</p>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="mb-3 font-mono text-4xl font-bold text-[#d3bb73]">
                      {formatDuration(elapsedTime)}
                    </div>
                    <button
                      onClick={stopTimer}
                      className="flex items-center gap-2 rounded-lg bg-red-500 px-6 py-2 text-white transition-colors hover:bg-red-600"
                    >
                      <Square className="h-4 w-4" />
                      Zatrzymaj
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="mb-1 text-lg font-semibold text-[#e5e4e2]">
                      Brak aktywnego timera
                    </h3>
                    <p className="text-sm text-[#e5e4e2]/60">
                      Rozpocznij nowy timer lub dodaj wpis ręcznie
                    </p>
                  </div>
                  <button
                    onClick={() => setShowAddModal(true)}
                    className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
                  >
                    <Play className="h-4 w-4" />
                    Rozpocznij timer
                  </button>
                </div>
              </div>
            )}

            {/* Statystyki */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
              <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-4">
                <div className="mb-2 flex items-center gap-3">
                  <Clock className="h-5 w-5 text-blue-400" />
                  <span className="text-sm text-[#e5e4e2]/60">Łącznie</span>
                </div>
                <div className="text-2xl font-bold text-[#e5e4e2]">
                  {formatMinutes(totalMinutes)}
                </div>
              </div>

              <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-4">
                <div className="mb-2 flex items-center gap-3">
                  <DollarSign className="h-5 w-5 text-green-400" />
                  <span className="text-sm text-[#e5e4e2]/60">Płatne</span>
                </div>
                <div className="text-2xl font-bold text-[#d3bb73]">
                  {formatMinutes(billableMinutes)}
                </div>
              </div>

              <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-4">
                <div className="mb-2 flex items-center gap-3">
                  <Calendar className="h-5 w-5 text-purple-400" />
                  <span className="text-sm text-[#e5e4e2]/60">Wpisów</span>
                </div>
                <div className="text-2xl font-bold text-[#e5e4e2]">{entries.length}</div>
              </div>

              <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-4">
                <div className="mb-2 flex items-center gap-3">
                  <CheckCircle className="h-5 w-5 text-yellow-400" />
                  <span className="text-sm text-[#e5e4e2]/60">Śr. dziennie</span>
                </div>
                <div className="text-2xl font-bold text-[#e5e4e2]">
                  {entries.length > 0
                    ? formatMinutes(Math.floor(totalMinutes / Math.max(1, entries.length / 5)))
                    : '0h 0m'}
                </div>
              </div>
            </div>

            {/* Filtry */}
            {viewMode === 'all' && isAdmin && (
              <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-4">
                <div className="mb-4 flex items-center gap-2">
                  <Filter className="h-4 w-4 text-[#d3bb73]" />
                  <span className="text-sm font-medium text-[#e5e4e2]">Filtry</span>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div>
                    <label className="mb-2 block text-sm text-[#e5e4e2]/60">Pracownik</label>
                    <select
                      value={filterEmployee}
                      onChange={(e) => setFilterEmployee(e.target.value)}
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
                    >
                      <option value="">Wszyscy pracownicy</option>
                      {allEmployees.map((emp) => (
                        <option key={emp.id} value={emp.id}>
                          {emp.name} {emp.surname}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-2 block text-sm text-[#e5e4e2]/60">Data od</label>
                    <input
                      type="date"
                      value={filterDateFrom}
                      onChange={(e) => setFilterDateFrom(e.target.value)}
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm text-[#e5e4e2]/60">Data do</label>
                    <input
                      type="date"
                      value={filterDateTo}
                      onChange={(e) => setFilterDateTo(e.target.value)}
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Lista wpisów */}
            <div className="space-y-3">
              {entries.map((entry) => (
                <div
                  key={entry.id}
                  className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-4"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="mb-2 flex items-center gap-3">
                        <h4 className="flex items-center gap-2 font-semibold text-[#e5e4e2]">
                          {entry.task_id && entry.tasks ? (
                            <>
                              <span>{entry.tasks.title}</span>
                              <Link
                                href={`/crm/tasks/${entry.task_id}`}
                                target="_blank"
                                className="inline-flex items-center gap-1 rounded bg-[#d3bb73]/10 px-2 py-1 text-xs font-medium text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/20"
                                title="Otwórz task"
                              >
                                <ExternalLink className="h-3 w-3" />
                                Przejdź
                              </Link>
                            </>
                          ) : (
                            entry.title || entry.task_title || 'Praca'
                          )}
                        </h4>
                        {entry.is_billable && (
                          <span className="rounded bg-green-500/20 px-2 py-1 text-xs text-green-400">
                            Płatne
                          </span>
                        )}
                        {viewMode === 'all' && (
                          <span className="text-sm text-[#e5e4e2]/60">
                            {entry.employee_name} {entry.employee_surname}
                          </span>
                        )}
                      </div>
                      {entry.description && (
                        <p className="mb-2 text-sm text-[#e5e4e2]/60">{entry.description}</p>
                      )}
                      {entry.event_name && (
                        <p className="text-xs text-[#e5e4e2]/40">Wydarzenie: {entry.event_name}</p>
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
                    <div className="flex items-center gap-4 text-right">
                      <div>
                        <div className="text-2xl font-bold text-[#d3bb73]">
                          {formatMinutes(entry.duration_minutes)}
                        </div>
                        {entry.hourly_rate && (
                          <div className="mt-1 text-xs text-[#e5e4e2]/40">
                            {entry.hourly_rate} zł/h
                          </div>
                        )}
                      </div>
                      <div className="flex gap-2">
                        {viewMode === 'my' && entry.end_time && (
                          <button
                            onClick={() => {
                              setEditingEntry(entry);
                              setShowEditModal(true);
                            }}
                            className="p-2 text-blue-400 hover:text-blue-300"
                            title="Edytuj"
                          >
                            <Edit className="h-4 w-4" />
                          </button>
                        )}
                        {isAdmin && entry.edit_count && entry.edit_count > 0 && (
                          <button
                            onClick={() => {
                              setHistoryEntryId(entry.id);
                              setShowHistoryModal(true);
                            }}
                            className="relative p-2 text-yellow-400 hover:text-yellow-300"
                            title="Historia zmian"
                          >
                            <History className="h-4 w-4" />
                            <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-yellow-500 text-xs text-[#1c1f33]">
                              {entry.edit_count}
                            </span>
                          </button>
                        )}
                        {viewMode === 'my' && (
                          <button
                            onClick={() => deleteEntry(entry.id)}
                            className="p-2 text-red-400 hover:text-red-300"
                            title="Usuń"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              {entries.length === 0 && (
                <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-12 text-center">
                  <Clock className="mx-auto mb-4 h-12 w-12 text-[#e5e4e2]/20" />
                  <p className="text-[#e5e4e2]/60">Brak wpisów czasu pracy</p>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {showAddModal && (
        <StartTimerModal
          tasks={tasks}
          onClose={() => setShowAddModal(false)}
          onStart={(taskId, title, description) => {
            startTimer(taskId, title, description);
            setShowAddModal(false);
          }}
        />
      )}

      {showEditModal && editingEntry && (
        <EditEntryModal
          entry={editingEntry}
          onClose={() => {
            setShowEditModal(false);
            setEditingEntry(null);
          }}
          onSave={async (updated) => {
            try {
              const { error } = await supabase
                .from('time_entries')
                .update({
                  title: updated.title,
                  description: updated.description,
                  start_time: updated.start_time,
                  end_time: updated.end_time,
                })
                .eq('id', updated.id);

              if (error) throw error;
              showSnackbar('Wpis zaktualizowany', 'success');
              setShowEditModal(false);
              setEditingEntry(null);
              fetchData();
            } catch (error) {
              console.error('Error updating entry:', error);
              showSnackbar('Błąd podczas aktualizacji', 'error');
            }
          }}
        />
      )}

      {showHistoryModal && historyEntryId && (
        <HistoryModal
          entryId={historyEntryId}
          onClose={() => {
            setShowHistoryModal(false);
            setHistoryEntryId(null);
          }}
        />
      )}
    </div>
  );
}

function StartTimerModal({
  tasks,
  onClose,
  onStart,
}: {
  tasks: Task[];
  onClose: () => void;
  onStart: (taskId: string | null, title: string | null, description: string) => void;
}) {
  const [inputValue, setInputValue] = useState('');
  const [description, setDescription] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const filteredTasks = tasks.filter((task) =>
    task.title.toLowerCase().includes(inputValue.toLowerCase()),
  );

  const handleSelectTask = (task: Task) => {
    setInputValue(task.title);
    setSelectedTaskId(task.id);
    setShowSuggestions(false);
  };

  const handleInputChange = (value: string) => {
    setInputValue(value);
    setSelectedTaskId(null);
    setShowSuggestions(value.length > 0);
  };

  const handleStart = () => {
    if (!inputValue.trim()) {
      alert('Podaj tytuł zadania');
      return;
    }

    onStart(selectedTaskId, selectedTaskId ? null : inputValue, description);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl border border-[#d3bb73]/20 bg-[#0f1119] p-6">
        <h2 className="mb-6 text-xl font-light text-[#e5e4e2]">Rozpocznij timer</h2>

        <div className="space-y-4">
          <div className="relative">
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Nazwa zadania</label>
            <input
              type="text"
              value={inputValue}
              onChange={(e) => handleInputChange(e.target.value)}
              onFocus={() => inputValue && setShowSuggestions(true)}
              placeholder="Wpisz nazwę lub wybierz z listy..."
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
            />

            {showSuggestions && filteredTasks.length > 0 && (
              <div className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] shadow-lg">
                {filteredTasks.map((task) => (
                  <button
                    key={task.id}
                    onClick={() => handleSelectTask(task)}
                    className="w-full border-b border-[#d3bb73]/5 px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-[#d3bb73]/10"
                  >
                    <div className="font-medium text-[#e5e4e2]">{task.title}</div>
                    {task.events && (
                      <div className="mt-1 text-xs text-[#e5e4e2]/60">{task.events.name}</div>
                    )}
                  </button>
                ))}
              </div>
            )}

            {selectedTaskId && (
              <div className="mt-2 flex items-center gap-2 text-xs text-green-400">
                <CheckCircle className="h-4 w-4" />
                <span>Powiązane z zadaniem</span>
              </div>
            )}

            {inputValue && !selectedTaskId && filteredTasks.length === 0 && (
              <div className="mt-2 flex items-center gap-2 text-xs text-blue-400">
                <CheckCircle className="h-4 w-4" />
                <span>Własny tytuł zostanie utworzony</span>
              </div>
            )}
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Opis (opcjonalnie)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Co będziesz robić?"
              className="w-full resize-y rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
            />
          </div>
        </div>

        <div className="mt-6 flex gap-3">
          <button
            onClick={handleStart}
            className="flex-1 rounded-lg bg-[#d3bb73] px-4 py-2 font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
          >
            <Play className="mr-2 inline h-4 w-4" />
            Rozpocznij
          </button>
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-[#e5e4e2]/60 hover:bg-[#1c1f33]"
          >
            Anuluj
          </button>
        </div>
      </div>
    </div>
  );
}

function EditEntryModal({
  entry,
  onClose,
  onSave,
}: {
  entry: TimeEntry;
  onClose: () => void;
  onSave: (updated: TimeEntry) => void;
}) {
  const [title, setTitle] = useState(entry.title || '');
  const [description, setDescription] = useState(entry.description || '');
  const [startDate, setStartDate] = useState(new Date(entry.start_time).toISOString().slice(0, 10));
  const [startTime, setStartTime] = useState(
    new Date(entry.start_time).toISOString().slice(11, 16),
  );
  const [endDate, setEndDate] = useState(
    entry.end_time ? new Date(entry.end_time).toISOString().slice(0, 10) : '',
  );
  const [endTime, setEndTime] = useState(
    entry.end_time ? new Date(entry.end_time).toISOString().slice(11, 16) : '',
  );

  const handleSave = () => {
    if (!title.trim()) {
      alert('Podaj tytuł');
      return;
    }

    const start = new Date(`${startDate}T${startTime}:00`).toISOString();
    const end = endDate && endTime ? new Date(`${endDate}T${endTime}:00`).toISOString() : null;

    onSave({
      ...entry,
      title,
      description,
      start_time: start,
      end_time: end,
    });
  };

  const calculateDuration = () => {
    if (!endDate || !endTime) return '---';
    const start = new Date(`${startDate}T${startTime}:00`);
    const end = new Date(`${endDate}T${endTime}:00`);
    const minutes = Math.floor((end.getTime() - start.getTime()) / 60000);
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h}h ${m}m`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-xl border border-[#d3bb73]/20 bg-[#0f1119] p-6">
        <h2 className="mb-6 text-xl font-light text-[#e5e4e2]">Edytuj wpis czasu</h2>

        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Tytuł</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Opis</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full resize-y rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Data rozpoczęcia</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Godzina rozpoczęcia</label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Data zakończenia</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Godzina zakończenia</label>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              />
            </div>
          </div>

          <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-[#e5e4e2]/60">Czas trwania:</span>
              <span className="text-lg font-bold text-[#d3bb73]">{calculateDuration()}</span>
            </div>
          </div>
        </div>

        <div className="mt-6 flex gap-3">
          <button
            onClick={handleSave}
            className="flex-1 rounded-lg bg-[#d3bb73] px-4 py-2 font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
          >
            Zapisz zmiany
          </button>
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-[#e5e4e2]/60 hover:bg-[#1c1f33]"
          >
            Anuluj
          </button>
        </div>
      </div>
    </div>
  );
}

function HistoryModal({ entryId, onClose }: { entryId: string; onClose: () => void }) {
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchHistory();
  }, [entryId]);

  const fetchHistory = async () => {
    try {
      const { data, error } = await supabase
        .from('admin_time_entries_history_view')
        .select('*')
        .eq('time_entry_id', entryId)
        .order('changed_at', { ascending: false });

      if (error) throw error;
      setHistory(data || []);
    } catch (error) {
      console.error('Error fetching history:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatValue = (value: any) => {
    if (value === null || value === undefined) return 'brak';
    if (typeof value === 'boolean') return value ? 'tak' : 'nie';
    if (typeof value === 'string' && value.match(/^\d{4}-\d{2}-\d{2}T/)) {
      return new Date(value).toLocaleString('pl-PL');
    }
    return String(value);
  };

  const getFieldName = (field: string) => {
    const names: Record<string, string> = {
      title: 'Tytuł',
      description: 'Opis',
      start_time: 'Czas rozpoczęcia',
      end_time: 'Czas zakończenia',
      is_billable: 'Płatne',
      hourly_rate: 'Stawka godzinowa',
      tags: 'Tagi',
    };
    return names[field] || field;
  };

  const getActionColor = (action: string) => {
    switch (action) {
      case 'created':
        return 'bg-green-500/20 text-green-400';
      case 'updated':
        return 'bg-blue-500/20 text-blue-400';
      case 'deleted':
        return 'bg-red-500/20 text-red-400';
      default:
        return 'bg-gray-500/20 text-gray-400';
    }
  };

  const getActionName = (action: string) => {
    switch (action) {
      case 'created':
        return 'Utworzono';
      case 'updated':
        return 'Edytowano';
      case 'deleted':
        return 'Usunięto';
      default:
        return action;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[80vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-[#d3bb73]/20 bg-[#0f1119] p-6">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="flex items-center gap-3 text-xl font-light text-[#e5e4e2]">
            <History className="h-6 w-6 text-[#d3bb73]" />
            Historia zmian
          </h2>
          <button onClick={onClose} className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]">
            ✕
          </button>
        </div>

        {loading ? (
          <div className="py-12 text-center text-[#e5e4e2]/60">Ładowanie...</div>
        ) : history.length === 0 ? (
          <div className="py-12 text-center text-[#e5e4e2]/60">Brak historii zmian</div>
        ) : (
          <div className="space-y-4">
            {history.map((item) => (
              <div key={item.id} className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-4">
                <div className="mb-3 flex items-start justify-between">
                  <div>
                    <span
                      className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${getActionColor(
                        item.action,
                      )}`}
                    >
                      {getActionName(item.action)}
                    </span>
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
                          {getFieldName(field)}:
                        </div>
                        <div className="flex flex-1 items-center gap-3">
                          <div className="flex-1">
                            <div className="text-red-400 line-through">
                              {formatValue(item.old_values?.[field])}
                            </div>
                          </div>
                          <div className="text-[#e5e4e2]/40">→</div>
                          <div className="flex-1">
                            <div className="text-green-400">
                              {formatValue(item.new_values?.[field])}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {item.action === 'created' && (
                  <div className="mt-2 text-sm text-[#e5e4e2]/60">Wpis został utworzony</div>
                )}

                {item.action === 'deleted' && (
                  <div className="mt-2 text-sm text-[#e5e4e2]/60">Wpis został usunięty</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
