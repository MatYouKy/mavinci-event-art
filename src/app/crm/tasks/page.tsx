'use client';

import { useState, useEffect, useRef } from 'react';
import { Plus, CheckSquare, User, Calendar, MoreVertical, X, Trash2, Edit, GripVertical, Play, Clock } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import TaskCard from '@/components/crm/TaskCard';

interface Task {
  id: string;
  title: string;
  description: string | null;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'todo' | 'in_progress' | 'review' | 'completed' | 'cancelled';
  board_column: string;
  order_index: number;
  due_date: string | null;
  created_by: string | null;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
  employees_created?: { name: string; surname: string } | null;
  employees_assigned?: { name: string; surname: string } | null;
  currently_working_by?: string | null;
  currently_working_employee?: {
    name: string;
    surname: string;
    avatar_url: string | null;
    avatar_metadata?: any;
  } | null;
  task_assignees: { employee_id: string; employees: { name: string; surname: string; avatar_url: string | null; avatar_metadata?: any } }[];
}

interface Employee {
  id: string;
  name: string;
  surname: string;
  email: string;
}

export default function TasksPage() {
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const { canCreateInModule, canManageModule, currentEmployee } = useCurrentEmployee();

  const canCreateTasks = canCreateInModule('tasks');
  const canManageTasks = canManageModule('tasks');

  const [tasks, setTasks] = useState<Task[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [draggedTask, setDraggedTask] = useState<Task | null>(null);
  const [showTimerModal, setShowTimerModal] = useState(false);
  const [taskToStart, setTaskToStart] = useState<Task | null>(null);
  const [activeTimer, setActiveTimer] = useState<any>(null);

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    priority: 'medium' as const,
    board_column: 'todo',
    due_date: '',
    assigned_employees: [] as string[],
  });

  const [employeeSearch, setEmployeeSearch] = useState('');
  const [filteredEmployees, setFilteredEmployees] = useState<Employee[]>([]);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const autoScrollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const columns = [
    { id: 'todo', label: 'Do zrobienia', color: 'border-yellow-500/30' },
    { id: 'in_progress', label: 'W trakcie', color: 'border-blue-500/30' },
    { id: 'review', label: 'Sprawdzenie', color: 'border-purple-500/30' },
    { id: 'completed', label: 'Zakończone', color: 'border-green-500/30' },
  ];

  const priorityColors = {
    low: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
    medium: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    urgent: 'bg-red-500/20 text-red-400 border-red-500/30',
  };

  const priorityLabels = {
    low: 'Niski',
    medium: 'Średni',
    high: 'Wysoki',
    urgent: 'Pilne',
  };

  useEffect(() => {
    fetchTasks();
    fetchEmployees();

    const tasksChannel = supabase
      .channel('tasks_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tasks',
        },
        (payload) => {
          console.log('Tasks realtime event:', payload);
          fetchTasks();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'task_assignees',
        },
        (payload) => {
          console.log('Task assignees realtime event:', payload);
          fetchTasks();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(tasksChannel);
    };
  }, []);

  useEffect(() => {
    if (currentEmployee) {
      checkActiveTimer();
    }
  }, [currentEmployee]);

  const fetchTasks = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .eq('is_private', false)
        .is('event_id', null);

      if (error) throw error;

      const tasksWithAssignees = await Promise.all(
        (data || []).map(async (task) => {
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
                employees: employee || { name: '', surname: '', avatar_url: null, avatar_metadata: null },
              };
            })
          );

          let currently_working_employee = null;
          if (task.currently_working_by) {
            const { data: workingEmployee } = await supabase
              .from('employees')
              .select('name, surname, avatar_url, avatar_metadata')
              .eq('id', task.currently_working_by)
              .maybeSingle();

            currently_working_employee = workingEmployee;
          }

          // Get comments count
          const { count } = await supabase
            .from('task_comments')
            .select('*', { count: 'exact', head: true })
            .eq('task_id', task.id);

          return {
            ...task,
            currently_working_employee,
            task_assignees: assigneesWithEmployees,
            comments_count: count || 0,
          };
        })
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
      console.error('Error fetching tasks:', error);
      showSnackbar('Błąd podczas ładowania zadań', 'error');
    } finally {
      setLoading(false);
    }
  };

  const fetchEmployees = async () => {
    try {
      const { data, error } = await supabase
        .from('employees')
        .select('id, name, surname, email')
        .order('name');

      if (error) throw error;
      setEmployees(data || []);
    } catch (error) {
      console.error('Error fetching employees:', error);
    }
  };

  const checkActiveTimer = async () => {
    if (!currentEmployee) return;

    try {
      const { data, error } = await supabase
        .from('time_entries')
        .select('*, tasks(title)')
        .eq('employee_id', currentEmployee.id)
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
        employee_id: currentEmployee?.id,
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

  const handleOpenModal = (task?: Task, defaultColumn?: string) => {
    if (task) {
      setEditingTask(task);
      setFormData({
        title: task.title,
        description: task.description || '',
        priority: task.priority,
        board_column: task.board_column,
        due_date: task.due_date ? task.due_date.split('T')[0] : '',
        assigned_employees: task.task_assignees.map(a => a.employee_id),
      });
    } else {
      setEditingTask(null);
      setFormData({
        title: '',
        description: '',
        priority: 'medium',
        board_column: defaultColumn || 'todo',
        due_date: '',
        assigned_employees: [],
      });
    }
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setEditingTask(null);
    setEmployeeSearch('');
    setFilteredEmployees([]);
  };

  const handleEmployeeSearch = (value: string) => {
    setEmployeeSearch(value);
    if (value.trim()) {
      const filtered = employees.filter(
        (emp) =>
          !formData.assigned_employees.includes(emp.id) &&
          (`${emp.name} ${emp.surname}`.toLowerCase().includes(value.toLowerCase()) ||
            emp.email.toLowerCase().includes(value.toLowerCase()))
      );
      setFilteredEmployees(filtered.slice(0, 5));
    } else {
      setFilteredEmployees([]);
    }
  };

  const handleAddEmployee = (employeeId: string) => {
    setFormData({
      ...formData,
      assigned_employees: [...formData.assigned_employees, employeeId],
    });
    setEmployeeSearch('');
    setFilteredEmployees([]);
  };

  const handleRemoveEmployee = (employeeId: string) => {
    setFormData({
      ...formData,
      assigned_employees: formData.assigned_employees.filter((id) => id !== employeeId),
    });
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

        await supabase
          .from('task_assignees')
          .delete()
          .eq('task_id', editingTask.id);

        if (formData.assigned_employees.length > 0) {
          const assignees = formData.assigned_employees.map(employee_id => ({
            task_id: editingTask.id,
            employee_id,
            assigned_by: currentEmployee?.id,
          }));

          const { error: assignError } = await supabase
            .from('task_assignees')
            .insert(assignees);

          if (assignError) throw assignError;
        }

        showSnackbar('Zadanie zostało zaktualizowane', 'success');
      } else {
        const { data: task, error } = await supabase
          .from('tasks')
          .insert({
            title: formData.title,
            description: formData.description || null,
            priority: formData.priority,
            board_column: formData.board_column,
            due_date: formData.due_date || null,
            status: 'todo',
            is_private: false,
            event_id: null,
            owner_id: null,
            created_by: currentEmployee?.id,
          })
          .select()
          .single();

        if (error) throw error;

        if (formData.assigned_employees.length > 0) {
          const assignees = formData.assigned_employees.map(employee_id => ({
            task_id: task.id,
            employee_id,
            assigned_by: currentEmployee?.id,
          }));

          const { error: assignError } = await supabase
            .from('task_assignees')
            .insert(assignees);

          if (assignError) throw assignError;
        }

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
      'Usuń zadanie'
    );

    if (!confirmed) return;

    try {
      const { error } = await supabase
        .from('tasks')
        .delete()
        .eq('id', taskId);

      if (error) throw error;

      showSnackbar('Zadanie zostało usunięte', 'success');
      fetchTasks();
    } catch (error: any) {
      console.error('Error deleting task:', error);
      showSnackbar(error.message || 'Błąd podczas usuwania zadania', 'error');
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
      return;
    }

    const oldColumn = draggedTask.board_column;
    const taskId = draggedTask.id;

    if (columnId === 'in_progress' && oldColumn !== 'in_progress') {
      if (activeTimer && activeTimer.task_id !== taskId) {
        setDraggedTask(null);
        setDragOverColumn(null);
        stopAutoScroll();
        showSnackbar('Zakończ poprzednie zadanie aby rozpocząć kolejne lub przenieś je do zrobienia', 'warning');
        return;
      }

      if (!activeTimer) {
        setTasks(prevTasks =>
          prevTasks.map(task =>
            task.id === taskId ? { ...task, board_column: columnId } : task
          )
        );
        setDraggedTask(null);
        setDragOverColumn(null);
        stopAutoScroll();

        try {
          const { error } = await supabase
            .from('tasks')
            .update({
              board_column: columnId,
              currently_working_by: currentEmployee?.id || null
            })
            .eq('id', taskId);

          if (error) throw error;

          await startTimer(draggedTask);
        } catch (error) {
          console.error('Error moving task:', error);
          showSnackbar('Błąd podczas przenoszenia zadania', 'error');

          setTasks(prevTasks =>
            prevTasks.map(task =>
              task.id === taskId ? { ...task, board_column: oldColumn } : task
            )
          );
        }
        return;
      }
    }

    if ((columnId === 'review' || columnId === 'completed') && oldColumn === 'in_progress') {
      if (activeTimer && activeTimer.task_id === taskId) {
        const shouldStopTimer = await showConfirm(
          'Zatrzymać czas pracy?',
          'Zadanie jest przenoszone do kolejnego etapu. Czy chcesz zatrzymać licznik czasu?'
        );

        if (shouldStopTimer) {
          try {
            await supabase
              .from('time_entries')
              .update({ end_time: new Date().toISOString() })
              .eq('id', activeTimer.id);

            await checkActiveTimer();
          } catch (error) {
            console.error('Error stopping timer:', error);
          }
        }
      }
    }

    setTasks(prevTasks =>
      prevTasks.map(task =>
        task.id === taskId ? { ...task, board_column: columnId } : task
      )
    );
    setDraggedTask(null);
    setDragOverColumn(null);
    stopAutoScroll();

    try {
      const updateData: any = { board_column: columnId };

      if (columnId !== 'in_progress') {
        updateData.currently_working_by = null;
      }

      const { error } = await supabase
        .from('tasks')
        .update(updateData)
        .eq('id', taskId);

      if (error) throw error;
    } catch (error) {
      console.error('Error moving task:', error);
      showSnackbar('Błąd podczas przenoszenia zadania', 'error');

      setTasks(prevTasks =>
        prevTasks.map(task =>
          task.id === taskId ? { ...task, board_column: oldColumn } : task
        )
      );
    }
  };

  const getTasksByColumn = (columnId: string) => {
    return tasks.filter(task => task.board_column === columnId);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-[#e5e4e2]/60">Ładowanie zadań...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-4 px-2">
        <h2 className="text-2xl font-light text-[#e5e4e2]">Zadania</h2>
        {canCreateTasks && (
          <button
            onClick={() => handleOpenModal()}
            className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#d3bb73]/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Nowe zadanie
          </button>
        )}
      </div>

      <div ref={scrollContainerRef} className="flex-1 overflow-x-auto pb-4">
        <div className="flex gap-4 px-2" style={{ minWidth: 'min-content' }}>
          {columns.map(column => (
            <div
              key={column.id}
              onDragOver={(e) => handleDragOver(e, column.id)}
              onDragLeave={handleDragLeave}
              onDrop={() => handleDrop(column.id)}
              className={`flex-shrink-0 bg-[#1c1f33] border-2 rounded-xl p-4 flex flex-col transition-all ${
                dragOverColumn === column.id
                  ? 'border-[#d3bb73] bg-[#d3bb73]/5'
                  : column.color
              }`}
              style={{ width: '320px', maxHeight: 'calc(100vh - 200px)' }}
            >
              <div className="flex items-center justify-between mb-4 flex-shrink-0">
                <h3 className="font-medium text-[#e5e4e2]">{column.label}</h3>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-[#e5e4e2]/60">
                    {getTasksByColumn(column.id).length}
                  </span>
                  {canCreateTasks && (
                    <button
                      onClick={() => handleOpenModal(undefined, column.id)}
                      className="p-1 text-[#d3bb73] hover:bg-[#d3bb73]/10 rounded transition-colors"
                      title="Dodaj zadanie"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-3 overflow-y-auto flex-1 pr-2 -mr-2">
                {getTasksByColumn(column.id).map(task => (
                  <div
                    key={task.id}
                    draggable
                    onDragStart={() => handleDragStart(task)}
                    onDragEnd={() => {
                      setDraggedTask(null);
                      stopAutoScroll();
                    }}
                    className="cursor-move"
                  >
                    <TaskCard
                      task={task}
                      isDragging={draggedTask?.id === task.id}
                      canManage={canManageTasks}
                      showDragHandle={true}
                      onEdit={handleOpenModal}
                      onDelete={handleDeleteTask}
                      additionalActions={
                        <button
                          onClick={() => handleStartTimer(task)}
                          disabled={activeTimer?.task_id === task.id}
                          className={`w-full flex items-center justify-center gap-1 text-xs px-2 py-1 rounded transition-colors ${
                            activeTimer?.task_id === task.id
                              ? 'bg-green-500/20 text-green-400 cursor-default'
                              : 'bg-[#d3bb73]/10 text-[#d3bb73] hover:bg-[#d3bb73]/20'
                          }`}
                          title={
                            activeTimer?.task_id === task.id
                              ? 'Timer aktywny'
                              : 'Rozpocznij zadanie'
                          }
                        >
                          {activeTimer?.task_id === task.id ? (
                            <>
                              <Clock className="w-3 h-3 animate-pulse" />
                              <span>Aktywny</span>
                            </>
                          ) : (
                            <>
                              <Play className="w-3 h-3" />
                              <span>Rozpocznij</span>
                            </>
                          )}
                        </button>
                      }
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-[#d3bb73]/10">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-light text-[#e5e4e2]">
                  {editingTask ? 'Edytuj zadanie' : 'Nowe zadanie'}
                </h3>
                <button
                  onClick={handleCloseModal}
                  className="text-[#e5e4e2]/60 hover:text-[#e5e4e2] transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                  Tytuł *
                </label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                  placeholder="Wprowadź tytuł zadania"
                  required
                />
              </div>

              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                  Opis
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={4}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                  placeholder="Wprowadź opis zadania"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                    Priorytet
                  </label>
                  <select
                    value={formData.priority}
                    onChange={(e) => setFormData({ ...formData, priority: e.target.value as any })}
                    className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                  >
                    <option value="low">Niski</option>
                    <option value="medium">Średni</option>
                    <option value="high">Wysoki</option>
                    <option value="urgent">Pilne</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                    Kolumna
                  </label>
                  <select
                    value={formData.board_column}
                    onChange={(e) => setFormData({ ...formData, board_column: e.target.value })}
                    className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                  >
                    {columns.map(col => (
                      <option key={col.id} value={col.id}>
                        {col.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                  Termin wykonania
                </label>
                <input
                  type="date"
                  value={formData.due_date}
                  onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                />
              </div>

              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                  Przypisani pracownicy
                </label>

                {formData.assigned_employees.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {formData.assigned_employees.map((empId) => {
                      const employee = employees.find((e) => e.id === empId);
                      if (!employee) return null;
                      return (
                        <div
                          key={empId}
                          className="flex items-center gap-2 px-3 py-1 bg-[#d3bb73]/20 text-[#d3bb73] rounded-full text-sm"
                        >
                          <span>
                            {employee.name} {employee.surname}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleRemoveEmployee(empId)}
                            className="hover:text-[#d3bb73]/70 transition-colors"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="relative">
                  <input
                    type="text"
                    value={employeeSearch}
                    onChange={(e) => handleEmployeeSearch(e.target.value)}
                    placeholder="Wpisz imię, nazwisko lub email..."
                    className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                  />

                  {filteredEmployees.length > 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                      {filteredEmployees.map((employee) => (
                        <button
                          key={employee.id}
                          type="button"
                          onClick={() => handleAddEmployee(employee.id)}
                          className="w-full text-left px-4 py-2 hover:bg-[#d3bb73]/10 transition-colors text-sm text-[#e5e4e2] flex items-center justify-between"
                        >
                          <span>
                            {employee.name} {employee.surname}
                          </span>
                          <span className="text-xs text-[#e5e4e2]/60">{employee.email}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="flex-1 px-4 py-2 bg-[#e5e4e2]/10 text-[#e5e4e2] rounded-lg hover:bg-[#e5e4e2]/20 transition-colors"
                >
                  Anuluj
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
                >
                  {editingTask ? 'Zapisz' : 'Utwórz'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showTimerModal && activeTimer && taskToStart && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-[#0f1119] border border-[#d3bb73]/20 rounded-xl p-6 max-w-md w-full">
            <div className="flex items-center gap-3 mb-4">
              <div className="bg-yellow-500/20 p-3 rounded-lg">
                <Clock className="w-6 h-6 text-yellow-400" />
              </div>
              <div>
                <h2 className="text-xl font-light text-[#e5e4e2]">Timer już aktywny</h2>
                <p className="text-sm text-[#e5e4e2]/60">Masz włączony timer dla innego zadania</p>
              </div>
            </div>

            <div className="bg-[#1c1f33] rounded-lg p-4 mb-4 border border-[#d3bb73]/10">
              <div className="text-sm text-[#e5e4e2]/60 mb-2">Aktualnie pracujesz nad:</div>
              <div className="text-[#e5e4e2] font-medium mb-1">
                {activeTimer.tasks?.title || activeTimer.title || 'Bez nazwy'}
              </div>
              <div className="text-xs text-[#e5e4e2]/40">
                Rozpoczęty: {new Date(activeTimer.start_time).toLocaleTimeString('pl-PL', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </div>
            </div>

            <div className="bg-[#1c1f33] rounded-lg p-4 mb-6 border border-[#d3bb73]/10">
              <div className="text-sm text-[#e5e4e2]/60 mb-2">Chcesz rozpocząć:</div>
              <div className="text-[#e5e4e2] font-medium">{taskToStart.title}</div>
            </div>

            <div className="space-y-3">
              <button
                onClick={stopCurrentTimerAndStartNew}
                className="w-full bg-[#d3bb73] text-[#1c1f33] px-4 py-3 rounded-lg hover:bg-[#d3bb73]/90 font-medium transition-colors"
              >
                Zatrzymaj poprzedni i rozpocznij nowy
              </button>
              <button
                onClick={() => {
                  setShowTimerModal(false);
                  setTaskToStart(null);
                }}
                className="w-full bg-[#1c1f33] text-[#e5e4e2] px-4 py-3 rounded-lg hover:bg-[#1c1f33]/80 border border-[#d3bb73]/20 transition-colors"
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
