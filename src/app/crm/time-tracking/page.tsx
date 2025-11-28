'use client';

import { useState, useEffect } from 'react';
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
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
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

  const fetchData = async () => {
    try {
      setLoading(true);

      // Sprawdź aktywny timer
      const { data: activeData } = await supabase
        .from('time_entries')
        .select(`
          *,
          tasks (
            title,
            event_id
          ),
          events (
            name
          )
        `)
        .eq('employee_id', employee!.id)
        .is('end_time', null)
        .maybeSingle();

      setActiveTimer(activeData || null);

      // Pobierz wpisy
      let query = supabase
        .from(viewMode === 'all' && isAdmin ? 'admin_time_entries_view' : 'time_entries')
        .select(`
          *,
          tasks (
            title,
            event_id
          ),
          events (
            name
          )
        `)
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
      setEntries(data || []);
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
        .select(`
          id,
          title,
          event_id,
          events (name)
        `)
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
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-[#e5e4e2]/60">Ładowanie...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f1119] p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Nagłówek */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[#e5e4e2] flex items-center gap-3">
              <Clock className="w-8 h-8 text-[#d3bb73]" />
              Śledzenie czasu pracy
            </h1>
            <p className="text-sm text-[#e5e4e2]/60 mt-1">
              {isAdmin && adminView === 'dashboard'
                ? 'Raport czasu pracy zespołu'
                : 'Loguj swój czas pracy i zarządzaj wpisami'}
            </p>
          </div>
          {isAdmin && (
            <div className="flex gap-2">
              <button
                onClick={() => setAdminView('dashboard')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                  adminView === 'dashboard'
                    ? 'bg-[#d3bb73] text-[#1c1f33]'
                    : 'bg-[#1c1f33] text-[#e5e4e2] hover:bg-[#1c1f33]/80'
                }`}
              >
                <BarChart3 className="w-4 h-4" />
                Dashboard
              </button>
              <button
                onClick={() => setAdminView('list')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                  adminView === 'list'
                    ? 'bg-[#d3bb73] text-[#1c1f33]'
                    : 'bg-[#1c1f33] text-[#e5e4e2] hover:bg-[#1c1f33]/80'
                }`}
              >
                <List className="w-4 h-4" />
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
              <div className="bg-gradient-to-r from-green-500/20 to-blue-500/20 border border-green-500/30 rounded-xl p-6">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse" />
                      <span className="text-sm text-[#e5e4e2]/60">Timer aktywny</span>
                    </div>
                    <h3 className="text-xl font-semibold text-[#e5e4e2] mb-1">
                      {activeTimer.task_id && activeTimer.tasks
                        ? `${activeTimer.tasks.title} (Task)`
                        : activeTimer.title || activeTimer.task_title || 'Praca'}
                    </h3>
                    {activeTimer.description && (
                      <p className="text-sm text-[#e5e4e2]/60">{activeTimer.description}</p>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-4xl font-mono font-bold text-[#d3bb73] mb-3">
                      {formatDuration(elapsedTime)}
                    </div>
                    <button
                      onClick={stopTimer}
                      className="flex items-center gap-2 bg-red-500 text-white px-6 py-2 rounded-lg hover:bg-red-600 transition-colors"
                    >
                      <Square className="w-4 h-4" />
                      Zatrzymaj
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-[#e5e4e2] mb-1">
                      Brak aktywnego timera
                    </h3>
                    <p className="text-sm text-[#e5e4e2]/60">
                      Rozpocznij nowy timer lub dodaj wpis ręcznie
                    </p>
                  </div>
                  <button
                    onClick={() => setShowAddModal(true)}
                    className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-6 py-2 rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
                  >
                    <Play className="w-4 h-4" />
                    Rozpocznij timer
                  </button>
                </div>
              </div>
            )}

            {/* Statystyki */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/10 p-4">
                <div className="flex items-center gap-3 mb-2">
                  <Clock className="w-5 h-5 text-blue-400" />
                  <span className="text-sm text-[#e5e4e2]/60">Łącznie</span>
                </div>
                <div className="text-2xl font-bold text-[#e5e4e2]">
                  {formatMinutes(totalMinutes)}
                </div>
              </div>

              <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/10 p-4">
                <div className="flex items-center gap-3 mb-2">
                  <DollarSign className="w-5 h-5 text-green-400" />
                  <span className="text-sm text-[#e5e4e2]/60">Płatne</span>
                </div>
                <div className="text-2xl font-bold text-[#d3bb73]">
                  {formatMinutes(billableMinutes)}
                </div>
              </div>

              <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/10 p-4">
                <div className="flex items-center gap-3 mb-2">
                  <Calendar className="w-5 h-5 text-purple-400" />
                  <span className="text-sm text-[#e5e4e2]/60">Wpisów</span>
                </div>
                <div className="text-2xl font-bold text-[#e5e4e2]">{entries.length}</div>
              </div>

          <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/10 p-4">
            <div className="flex items-center gap-3 mb-2">
              <CheckCircle className="w-5 h-5 text-yellow-400" />
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
          <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/10 p-4">
            <div className="flex items-center gap-2 mb-4">
              <Filter className="w-4 h-4 text-[#d3bb73]" />
              <span className="text-sm font-medium text-[#e5e4e2]">Filtry</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">Pracownik</label>
                <select
                  value={filterEmployee}
                  onChange={(e) => setFilterEmployee(e.target.value)}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
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
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">Data od</label>
                <input
                  type="date"
                  value={filterDateFrom}
                  onChange={(e) => setFilterDateFrom(e.target.value)}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                />
              </div>
              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">Data do</label>
                <input
                  type="date"
                  value={filterDateTo}
                  onChange={(e) => setFilterDateTo(e.target.value)}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
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
              className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/10 p-4"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h4 className="font-semibold text-[#e5e4e2]">
                      {entry.task_id && entry.tasks
                        ? `${entry.tasks.title} (Task)`
                        : entry.title || entry.task_title || 'Praca'}
                    </h4>
                    {entry.is_billable && (
                      <span className="px-2 py-1 bg-green-500/20 text-green-400 text-xs rounded">
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
                    <p className="text-sm text-[#e5e4e2]/60 mb-2">{entry.description}</p>
                  )}
                  {entry.event_name && (
                    <p className="text-xs text-[#e5e4e2]/40">Wydarzenie: {entry.event_name}</p>
                  )}
                  <div className="flex items-center gap-4 text-sm text-[#e5e4e2]/60 mt-2">
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
                <div className="text-right flex items-center gap-4">
                  <div>
                    <div className="text-2xl font-bold text-[#d3bb73]">
                      {formatMinutes(entry.duration_minutes)}
                    </div>
                    {entry.hourly_rate && (
                      <div className="text-xs text-[#e5e4e2]/40 mt-1">
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
                        className="text-blue-400 hover:text-blue-300 p-2"
                        title="Edytuj"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                    )}
                    {isAdmin && entry.edit_count && entry.edit_count > 0 && (
                      <button
                        onClick={() => {
                          setHistoryEntryId(entry.id);
                          setShowHistoryModal(true);
                        }}
                        className="text-yellow-400 hover:text-yellow-300 p-2 relative"
                        title="Historia zmian"
                      >
                        <History className="w-4 h-4" />
                        <span className="absolute -top-1 -right-1 bg-yellow-500 text-[#1c1f33] text-xs rounded-full w-4 h-4 flex items-center justify-center">
                          {entry.edit_count}
                        </span>
                      </button>
                    )}
                    {viewMode === 'my' && (
                      <button
                        onClick={() => deleteEntry(entry.id)}
                        className="text-red-400 hover:text-red-300 p-2"
                        title="Usuń"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}

          {entries.length === 0 && (
            <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/10 p-12 text-center">
              <Clock className="w-12 h-12 text-[#e5e4e2]/20 mx-auto mb-4" />
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
    task.title.toLowerCase().includes(inputValue.toLowerCase())
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[#0f1119] border border-[#d3bb73]/20 rounded-xl p-6 max-w-md w-full">
        <h2 className="text-xl font-light text-[#e5e4e2] mb-6">Rozpocznij timer</h2>

        <div className="space-y-4">
          <div className="relative">
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">
              Nazwa zadania
            </label>
            <input
              type="text"
              value={inputValue}
              onChange={(e) => handleInputChange(e.target.value)}
              onFocus={() => inputValue && setShowSuggestions(true)}
              placeholder="Wpisz nazwę lub wybierz z listy..."
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
            />

            {showSuggestions && filteredTasks.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                {filteredTasks.map((task) => (
                  <button
                    key={task.id}
                    onClick={() => handleSelectTask(task)}
                    className="w-full text-left px-4 py-3 hover:bg-[#d3bb73]/10 transition-colors border-b border-[#d3bb73]/5 last:border-b-0"
                  >
                    <div className="text-[#e5e4e2] font-medium">{task.title}</div>
                    {task.events && (
                      <div className="text-xs text-[#e5e4e2]/60 mt-1">
                        {task.events.name}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}

            {selectedTaskId && (
              <div className="mt-2 flex items-center gap-2 text-xs text-green-400">
                <CheckCircle className="w-4 h-4" />
                <span>Powiązane z zadaniem</span>
              </div>
            )}

            {inputValue && !selectedTaskId && filteredTasks.length === 0 && (
              <div className="mt-2 flex items-center gap-2 text-xs text-blue-400">
                <CheckCircle className="w-4 h-4" />
                <span>Własny tytuł zostanie utworzony</span>
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">
              Opis (opcjonalnie)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Co będziesz robić?"
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73] resize-y"
            />
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={handleStart}
            className="flex-1 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg hover:bg-[#d3bb73]/90 font-medium"
          >
            <Play className="w-4 h-4 inline mr-2" />
            Rozpocznij
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-[#e5e4e2]/60 hover:bg-[#1c1f33]"
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
  const [startDate, setStartDate] = useState(
    new Date(entry.start_time).toISOString().slice(0, 10)
  );
  const [startTime, setStartTime] = useState(
    new Date(entry.start_time).toISOString().slice(11, 16)
  );
  const [endDate, setEndDate] = useState(
    entry.end_time ? new Date(entry.end_time).toISOString().slice(0, 10) : ''
  );
  const [endTime, setEndTime] = useState(
    entry.end_time ? new Date(entry.end_time).toISOString().slice(11, 16) : ''
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[#0f1119] border border-[#d3bb73]/20 rounded-xl p-6 max-w-lg w-full">
        <h2 className="text-xl font-light text-[#e5e4e2] mb-6">Edytuj wpis czasu</h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">Tytuł</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
            />
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">Opis</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73] resize-y"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Data rozpoczęcia</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
              />
            </div>
            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Godzina rozpoczęcia</label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Data zakończenia</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
              />
            </div>
            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Godzina zakończenia</label>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
              />
            </div>
          </div>

          <div className="bg-[#1c1f33] rounded-lg p-4 border border-[#d3bb73]/10">
            <div className="flex items-center justify-between">
              <span className="text-sm text-[#e5e4e2]/60">Czas trwania:</span>
              <span className="text-lg font-bold text-[#d3bb73]">{calculateDuration()}</span>
            </div>
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={handleSave}
            className="flex-1 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg hover:bg-[#d3bb73]/90 font-medium"
          >
            Zapisz zmiany
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-[#e5e4e2]/60 hover:bg-[#1c1f33]"
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[#0f1119] border border-[#d3bb73]/20 rounded-xl p-6 max-w-3xl w-full max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-light text-[#e5e4e2] flex items-center gap-3">
            <History className="w-6 h-6 text-[#d3bb73]" />
            Historia zmian
          </h2>
          <button
            onClick={onClose}
            className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]"
          >
            ✕
          </button>
        </div>

        {loading ? (
          <div className="text-center py-12 text-[#e5e4e2]/60">Ładowanie...</div>
        ) : history.length === 0 ? (
          <div className="text-center py-12 text-[#e5e4e2]/60">Brak historii zmian</div>
        ) : (
          <div className="space-y-4">
            {history.map((item) => (
              <div
                key={item.id}
                className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/10 p-4"
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <span
                      className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${getActionColor(
                        item.action
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
                  <div className="space-y-2 mt-3">
                    {item.changed_fields.map((field: string) => (
                      <div
                        key={field}
                        className="flex items-start gap-4 text-sm border-t border-[#d3bb73]/5 pt-2"
                      >
                        <div className="font-medium text-[#e5e4e2]/60 min-w-[120px]">
                          {getFieldName(field)}:
                        </div>
                        <div className="flex-1 flex items-center gap-3">
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
                  <div className="text-sm text-[#e5e4e2]/60 mt-2">
                    Wpis został utworzony
                  </div>
                )}

                {item.action === 'deleted' && (
                  <div className="text-sm text-[#e5e4e2]/60 mt-2">
                    Wpis został usunięty
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
