'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Plus,
  X,
  Trash2,
  CreditCard as Edit,
  GripVertical,
  Calendar,
  Play,
  Clock,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import TaskAssigneeAvatars from '@/components/crm/TaskAssigneeAvatars';

interface Task {
  id: string;
  title: string;
  description: string | null;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'todo' | 'in_progress' | 'review' | 'completed' | 'cancelled';
  board_column: string;
  order_index: number;
  due_date: string | null;
  created_at: string;
  updated_at: string;
  is_private: boolean;
  task_assignees?: {
    employee_id: string;
    employees: { name: string; surname: string; avatar_url: string | null; avatar_metadata?: any };
  }[];
}

interface PrivateTasksBoardProps {
  employeeId: string;
  isOwnProfile: boolean;
}

export default function PrivateTasksBoard({ employeeId, isOwnProfile }: PrivateTasksBoardProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [draggedTask, setDraggedTask] = useState<Task | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const autoScrollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const [showTimerModal, setShowTimerModal] = useState(false);
  const [taskToStart, setTaskToStart] = useState<Task | null>(null);
  const [activeTimer, setActiveTimer] = useState<any>(null);

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    priority: 'medium' as 'low' | 'medium' | 'high' | 'urgent',
    board_column: 'todo',
    due_date: '',
  });

  const columns = [
    { id: 'todo', label: 'Do zrobienia', color: 'border-yellow-500/30' },
    { id: 'in_progress', label: 'W trakcie', color: 'border-blue-500/30' },
    { id: 'review', label: 'Do sprawdzenia', color: 'border-purple-500/30' },
    { id: 'completed', label: 'Ukończone', color: 'border-green-500/30' },
  ];

  const priorityColors = {
    low: 'bg-gray-500/20 text-gray-400 border border-gray-500/30',
    medium: 'bg-blue-500/20 text-blue-400 border border-blue-500/30',
    high: 'bg-orange-500/20 text-orange-400 border border-orange-500/30',
    urgent: 'bg-red-500/20 text-red-400 border border-red-500/30',
  };

  const priorityLabels = {
    low: 'Niski',
    medium: 'Średni',
    high: 'Wysoki',
    urgent: 'Pilne',
  };

  useEffect(() => {
    fetchTasks();
    checkActiveTimer();

    const tasksChannel = supabase
      .channel(`private_tasks_${employeeId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tasks',
        },
        (payload) => {
          console.log('Private tasks realtime event:', payload);
          fetchTasks();
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'task_assignees',
        },
        (payload) => {
          console.log('Private task assignees realtime event:', payload);
          fetchTasks();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(tasksChannel);
    };
  }, [employeeId]);

  const fetchTasks = async () => {
    try {
      setLoading(true);

      const { data: privateTasks, error: privateError } = await supabase
        .from('tasks')
        .select('*')
        .eq('is_private', true)
        .eq('owner_id', employeeId);

      if (privateError) throw privateError;

      const { data: assignedTasks, error: assignedError } = await supabase
        .from('tasks')
        .select(
          `
          *,
          task_assignees!inner(employee_id)
        `,
        )
        .eq('task_assignees.employee_id', employeeId)
        .eq('is_private', false);

      if (assignedError) throw assignedError;

      const allTasksBase = [...(privateTasks || []), ...(assignedTasks || [])];

      const tasksWithAssignees = await Promise.all(
        allTasksBase.map(async (task) => {
          const { data: assignees } = await supabase
            .from('task_assignees')
            .select('employee_id')
            .eq('task_id', task.id);

          const assigneesWithEmployees = await Promise.all(
            (assignees || []).map(async (assignee) => {
              const { data: employee } = await supabase
                .from('employees')
                .select('name, surname, avatar_url, avatar_metadata')
                .eq('id', assignee.employee_id)
                .maybeSingle();

              return {
                employee_id: assignee.employee_id,
                employees: employee || {
                  name: '',
                  surname: '',
                  avatar_url: null,
                  avatar_metadata: null,
                },
              };
            }),
          );

          return {
            ...task,
            task_assignees: assigneesWithEmployees,
          };
        }),
      );

      const priorityOrder = { urgent: 4, high: 3, medium: 2, low: 1 };

      const sortedTasks = tasksWithAssignees.sort((a, b) => {
        const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
        if (priorityDiff !== 0) return priorityDiff;

        if (a.due_date && b.due_date) {
          return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
        }
        if (a.due_date) return -1;
        if (b.due_date) return 1;

        return a.order_index - b.order_index;
      });

      setTasks(sortedTasks);
    } catch (error) {
      console.error('Error fetching assigned tasks:', error);
      showSnackbar('Błąd podczas ładowania zadań', 'error');
    } finally {
      setLoading(false);
    }
  };

  const checkActiveTimer = async () => {
    try {
      const { data, error } = await supabase
        .from('time_entries')
        .select('*, tasks(title)')
        .eq('employee_id', employeeId)
        .is('end_time', null)
        .maybeSingle();

      if (error) throw error;
      setActiveTimer(data);
    } catch (error) {
      console.error('Error checking active timer:', error);
    }
  };

  const handleStartTimer = async (task: Task) => {
    if (activeTimer) {
      setTaskToStart(task);
      setShowTimerModal(true);
    } else {
      await startTimer(task);
    }
  };

  const startTimer = async (task: Task) => {
    try {
      const { error } = await supabase.from('time_entries').insert({
        employee_id: employeeId,
        task_id: task.id,
        event_id: null,
        title: null,
        description: null,
        start_time: new Date().toISOString(),
        end_time: null,
        is_billable: false,
        tags: [],
      });

      if (error) throw error;
      showSnackbar(`Timer rozpoczęty dla: ${task.title}`, 'success');
      checkActiveTimer();
    } catch (error) {
      console.error('Error starting timer:', error);
      showSnackbar('Błąd podczas uruchamiania timera', 'error');
    }
  };

  const stopCurrentTimerAndStartNew = async () => {
    if (!activeTimer || !taskToStart) return;

    try {
      const { error: stopError } = await supabase
        .from('time_entries')
        .update({ end_time: new Date().toISOString() })
        .eq('id', activeTimer.id);

      if (stopError) throw stopError;

      await startTimer(taskToStart);
      setShowTimerModal(false);
      setTaskToStart(null);
    } catch (error) {
      console.error('Error switching timers:', error);
      showSnackbar('Błąd podczas przełączania timerów', 'error');
    }
  };

  const handleAutoScroll = (e: React.DragEvent) => {
    if (!scrollContainerRef.current) return;

    const container = scrollContainerRef.current;
    const rect = container.getBoundingClientRect();
    const threshold = 100;
    const scrollSpeed = 10;
    const mouseX = e.clientX;

    if (autoScrollIntervalRef.current) {
      clearInterval(autoScrollIntervalRef.current);
      autoScrollIntervalRef.current = null;
    }

    if (mouseX < rect.left + threshold) {
      autoScrollIntervalRef.current = setInterval(() => {
        container.scrollLeft -= scrollSpeed;
      }, 16);
    } else if (mouseX > rect.right - threshold) {
      autoScrollIntervalRef.current = setInterval(() => {
        container.scrollLeft += scrollSpeed;
      }, 16);
    }
  };

  const stopAutoScroll = () => {
    if (autoScrollIntervalRef.current) {
      clearInterval(autoScrollIntervalRef.current);
      autoScrollIntervalRef.current = null;
    }
  };

  const handleDragStart = (task: Task) => {
    setDraggedTask(task);
  };

  const handleDragOver = (e: React.DragEvent, columnId: string) => {
    e.preventDefault();
    setDragOverColumn(columnId);
    handleAutoScroll(e);
  };

  const handleDragLeave = () => {
    setDragOverColumn(null);
  };

  const handleDrop = async (columnId: string) => {
    if (!draggedTask || draggedTask.board_column === columnId) {
      setDraggedTask(null);
      setDragOverColumn(null);
      stopAutoScroll();
      return;
    }

    const oldColumn = draggedTask.board_column;
    const taskId = draggedTask.id;

    setTasks((prevTasks) =>
      prevTasks.map((task) => (task.id === taskId ? { ...task, board_column: columnId } : task)),
    );
    setDraggedTask(null);
    setDragOverColumn(null);
    stopAutoScroll();

    try {
      console.log('Updating task column:', { taskId, oldColumn, newColumn: columnId });
      const { error, data } = await supabase
        .from('tasks')
        .update({ board_column: columnId })
        .eq('id', taskId)
        .select();

      if (error) throw error;
      console.log('Task updated successfully:', data);

      if (columnId === 'in_progress' && oldColumn !== 'in_progress' && !activeTimer) {
        await handleStartTimer(draggedTask);
      }
    } catch (error) {
      console.error('Error moving task:', error);
      showSnackbar('Błąd podczas przenoszenia zadania', 'error');

      setTasks((prevTasks) =>
        prevTasks.map((task) => (task.id === taskId ? { ...task, board_column: oldColumn } : task)),
      );
    }
  };

  const handleOpenModal = (task?: Task, defaultColumn?: string) => {
    if (task) {
      setEditingTask(task);
      setFormData({
        title: task.title,
        description: task.description || '',
        priority: task.priority,
        board_column: task.board_column,
        due_date: task.due_date ? task.due_date.split('T')[0] : '',
      });
    } else {
      setEditingTask(null);
      setFormData({
        title: '',
        description: '',
        priority: 'medium',
        board_column: defaultColumn || 'todo',
        due_date: '',
      });
    }
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setEditingTask(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.title.trim()) {
      showSnackbar('Tytuł zadania jest wymagany', 'warning');
      return;
    }

    try {
      if (editingTask) {
        const { error } = await supabase
          .from('tasks')
          .update({
            title: formData.title,
            description: formData.description || null,
            priority: formData.priority,
            board_column: formData.board_column,
            due_date: formData.due_date || null,
          })
          .eq('id', editingTask.id);

        if (error) throw error;
        showSnackbar('Zadanie zostało zaktualizowane', 'success');
      } else {
        const { data: newTask, error: insertError } = await supabase
          .from('tasks')
          .insert({
            title: formData.title,
            description: formData.description || null,
            priority: formData.priority,
            board_column: formData.board_column,
            due_date: formData.due_date || null,
            status: 'todo',
            is_private: true,
            owner_id: employeeId,
            created_by: employeeId,
          })
          .select()
          .single();

        if (insertError) throw insertError;

        const { error: assignError } = await supabase.from('task_assignees').insert({
          task_id: newTask.id,
          employee_id: employeeId,
        });

        if (assignError) throw assignError;
        showSnackbar('Zadanie zostało utworzone', 'success');
      }

      fetchTasks();
      handleCloseModal();
    } catch (error) {
      console.error('Error saving task:', error);
      showSnackbar('Błąd podczas zapisywania zadania', 'error');
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    const confirmed = await showConfirm(
      'Czy na pewno chcesz usunąć to zadanie? Usunięte zostaną również wszystkie powiązane wpisy czasu pracy. Ta operacja jest nieodwracalna.',
      'Usuń zadanie',
    );

    if (!confirmed) return;

    try {
      const { error } = await supabase.from('tasks').delete().eq('id', taskId);

      if (error) throw error;

      fetchTasks();
      showSnackbar('Zadanie zostało usunięte', 'success');
    } catch (error: any) {
      console.error('Error deleting task:', error);
      showSnackbar(error.message || 'Błąd podczas usuwania zadania', 'error');
    }
  };

  const getTasksByColumn = (columnId: string) => {
    return tasks.filter((task) => task.board_column === columnId);
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-[#e5e4e2]/60">Ładowanie zadań...</div>
      </div>
    );
  }

  if (!isOwnProfile) {
    return (
      <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
        <p className="text-center text-[#e5e4e2]/60">
          Tablica prywatnych zadań jest widoczna tylko dla właściciela.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mb-4 flex items-center justify-between px-2">
        <h3 className="text-lg font-light text-[#e5e4e2]">Moja tablica zadań</h3>
        <button
          onClick={() => handleOpenModal()}
          className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
        >
          <Plus className="h-4 w-4" />
          Nowe zadanie
        </button>
      </div>

      <div ref={scrollContainerRef} className="flex-1 overflow-x-auto pb-4">
        <div className="flex gap-4 px-2" style={{ minWidth: 'min-content' }}>
          {columns.map((column) => (
            <div
              key={column.id}
              onDragOver={(e) => handleDragOver(e, column.id)}
              onDragLeave={handleDragLeave}
              onDrop={() => handleDrop(column.id)}
              className={`flex flex-shrink-0 flex-col rounded-xl border-2 bg-[#1c1f33] p-4 transition-all ${
                dragOverColumn === column.id ? 'border-[#d3bb73] bg-[#d3bb73]/5' : column.color
              }`}
              style={{ width: '320px', maxHeight: 'calc(100vh - 400px)' }}
            >
              <div className="mb-4 flex flex-shrink-0 items-center justify-between">
                <h3 className="font-medium text-[#e5e4e2]">{column.label}</h3>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-[#e5e4e2]/60">
                    {getTasksByColumn(column.id).length}
                  </span>
                  <button
                    onClick={() => handleOpenModal(undefined, column.id)}
                    className="rounded p-1 text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/10"
                    title="Dodaj zadanie"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="-mr-2 flex-1 space-y-3 overflow-y-auto pr-2">
                {getTasksByColumn(column.id).map((task) => (
                  <div
                    key={task.id}
                    draggable
                    onDragStart={() => handleDragStart(task)}
                    onDragEnd={() => {
                      setDraggedTask(null);
                      stopAutoScroll();
                    }}
                    className={`group cursor-move rounded-lg border bg-[#0f1119] p-4 transition-all ${
                      draggedTask?.id === task.id
                        ? 'border-[#d3bb73]/50 opacity-50'
                        : 'border-[#d3bb73]/10 hover:border-[#d3bb73]/30'
                    }`}
                  >
                    <div className="mb-2 flex items-start justify-between">
                      <div className="flex flex-1 items-start gap-2">
                        <GripVertical className="mt-1 h-4 w-4 flex-shrink-0 text-[#e5e4e2]/40" />
                        <h4 className="flex-1 text-sm font-medium text-[#e5e4e2]">{task.title}</h4>
                      </div>
                      <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          onClick={() => handleOpenModal(task)}
                          className="rounded p-1 text-[#d3bb73] hover:bg-[#d3bb73]/10"
                        >
                          <Edit className="h-3 w-3" />
                        </button>
                        <button
                          onClick={() => handleDeleteTask(task.id)}
                          className="rounded p-1 text-red-400 hover:bg-red-500/10"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>

                    {task.description && (
                      <p className="mb-2 line-clamp-2 text-xs text-[#e5e4e2]/60">
                        {task.description}
                      </p>
                    )}

                    <div className="mb-2 flex items-center gap-2">
                      <span
                        className={`rounded border px-2 py-0.5 text-[10px] ${
                          priorityColors[task.priority]
                        }`}
                      >
                        {priorityLabels[task.priority]}
                      </span>
                      {task.due_date && (
                        <div className="flex items-center gap-1 text-[10px] text-[#e5e4e2]/40">
                          <Calendar className="h-3 w-3" />
                          {new Date(task.due_date).toLocaleDateString('pl-PL')}
                        </div>
                      )}
                    </div>

                    {task.task_assignees && task.task_assignees.length > 0 && (
                      <div className="mb-2">
                        <TaskAssigneeAvatars assignees={task.task_assignees} />
                      </div>
                    )}

                    <div className="mt-2 flex items-center justify-between border-t border-[#d3bb73]/5 pt-2">
                      <button
                        onClick={() => handleStartTimer(task)}
                        disabled={activeTimer?.task_id === task.id}
                        className={`flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors ${
                          activeTimer?.task_id === task.id
                            ? 'cursor-default bg-green-500/20 text-green-400'
                            : 'bg-[#d3bb73]/10 text-[#d3bb73] hover:bg-[#d3bb73]/20'
                        }`}
                        title={
                          activeTimer?.task_id === task.id ? 'Timer aktywny' : 'Rozpocznij zadanie'
                        }
                      >
                        {activeTimer?.task_id === task.id ? (
                          <>
                            <Clock className="h-3 w-3 animate-pulse" />
                            <span>Aktywny</span>
                          </>
                        ) : (
                          <>
                            <Play className="h-3 w-3" />
                            <span>Rozpocznij</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33]">
            <div className="border-b border-[#d3bb73]/10 p-6">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-light text-[#e5e4e2]">
                  {editingTask ? 'Edytuj zadanie' : 'Nowe zadanie'}
                </h3>
                <button
                  onClick={handleCloseModal}
                  className="text-[#e5e4e2]/60 transition-colors hover:text-[#e5e4e2]"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 p-6">
              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/80">Tytuł</label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/80">Opis</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="min-h-[100px] w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-2 block text-sm text-[#e5e4e2]/80">Priorytet</label>
                  <select
                    value={formData.priority}
                    onChange={(e) => setFormData({ ...formData, priority: e.target.value as any })}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                  >
                    <option value="low">Niski</option>
                    <option value="medium">Średni</option>
                    <option value="high">Wysoki</option>
                    <option value="urgent">Pilne</option>
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-sm text-[#e5e4e2]/80">Kolumna</label>
                  <select
                    value={formData.board_column}
                    onChange={(e) => setFormData({ ...formData, board_column: e.target.value })}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                  >
                    {columns.map((col) => (
                      <option key={col.id} value={col.id}>
                        {col.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/80">Termin</label>
                <input
                  type="date"
                  value={formData.due_date}
                  onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="flex-1 rounded-lg bg-[#e5e4e2]/10 px-4 py-2 text-[#e5e4e2] transition-colors hover:bg-[#e5e4e2]/20"
                >
                  Anuluj
                </button>
                <button
                  type="submit"
                  className="flex-1 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
                >
                  {editingTask ? 'Zapisz' : 'Utwórz'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showTimerModal && activeTimer && taskToStart && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-[#d3bb73]/20 bg-[#0f1119] p-6">
            <div className="mb-4 flex items-center gap-3">
              <div className="rounded-lg bg-yellow-500/20 p-3">
                <Clock className="h-6 w-6 text-yellow-400" />
              </div>
              <div>
                <h2 className="text-xl font-light text-[#e5e4e2]">Timer już aktywny</h2>
                <p className="text-sm text-[#e5e4e2]/60">Masz włączony timer dla innego zadania</p>
              </div>
            </div>

            <div className="mb-4 rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-4">
              <div className="mb-2 text-sm text-[#e5e4e2]/60">Aktualnie pracujesz nad:</div>
              <div className="mb-1 font-medium text-[#e5e4e2]">
                {activeTimer.tasks?.title || activeTimer.title || 'Bez nazwy'}
              </div>
              <div className="text-xs text-[#e5e4e2]/40">
                Rozpoczęty:{' '}
                {new Date(activeTimer.start_time).toLocaleTimeString('pl-PL', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </div>
            </div>

            <div className="mb-6 rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-4">
              <div className="mb-2 text-sm text-[#e5e4e2]/60">Chcesz rozpocząć:</div>
              <div className="font-medium text-[#e5e4e2]">{taskToStart.title}</div>
            </div>

            <div className="space-y-3">
              <button
                onClick={stopCurrentTimerAndStartNew}
                className="w-full rounded-lg bg-[#d3bb73] px-4 py-3 font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
              >
                Zatrzymaj poprzedni i rozpocznij nowy
              </button>
              <button
                onClick={() => {
                  setShowTimerModal(false);
                  setTaskToStart(null);
                }}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-3 text-[#e5e4e2] transition-colors hover:bg-[#1c1f33]/80"
              >
                Anuluj
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
