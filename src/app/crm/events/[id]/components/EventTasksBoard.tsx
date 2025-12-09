'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Plus,
  X,
  Trash2,
  CreditCard as Edit,
  Calendar,
  User,
  GripVertical,
  UserPlus,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import TaskCard from '../../../../../components/crm/TaskCard';

interface Task {
  id: string;
  title: string;
  description: string | null;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'todo' | 'in_progress' | 'review' | 'completed' | 'cancelled';
  board_column: string;
  order_index: number;
  due_date: string | null;
  event_id: string | null;
  created_at: string;
  updated_at: string;
  currently_working_by?: string | null;
  currently_working_employee?: {
    name: string;
    surname: string;
    avatar_url: string | null;
    avatar_metadata?: any;
  } | null;
  assignees?: Array<{
    employee: {
      id: string;
      name: string;
      surname: string;
      avatar_url: string | null;
      email: string | null;
      phone_number: string | null;
    };
  }>;
}

interface EventTasksBoardProps {
  eventId: string;
  canManage: boolean;
}

export default function EventTasksBoard({ eventId, canManage }: EventTasksBoardProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [draggedTask, setDraggedTask] = useState<Task | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [assigningTask, setAssigningTask] = useState<Task | null>(null);
  const [availableEmployees, setAvailableEmployees] = useState<any[]>([]);
  const [activeTimer, setActiveTimer] = useState<any>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const autoScrollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const { currentEmployee } = useCurrentEmployee();

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    priority: 'medium' as 'low' | 'medium' | 'high' | 'urgent',
    board_column: 'todo',
    due_date: '',
  });

  const columns = [
    { id: 'todo', label: 'Do zrobienia', color: 'border-yellow-500/30 bg-yellow-500/5' },
    { id: 'in_progress', label: 'W trakcie', color: 'border-blue-500/30 bg-blue-500/5' },
    { id: 'review', label: 'Do sprawdzenia', color: 'border-purple-500/30 bg-purple-500/5' },
    { id: 'completed', label: 'Ukończone', color: 'border-green-500/30 bg-green-500/5' },
  ];

  const priorityColors = {
    low: 'bg-gray-500/20 text-gray-400',
    medium: 'bg-blue-500/20 text-blue-400',
    high: 'bg-orange-500/20 text-orange-400',
    urgent: 'bg-red-500/20 text-red-400',
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
    if (currentEmployee?.id) {
      checkActiveTimer();
    }

    const tasksChannel = supabase
      .channel(`event_tasks_${eventId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'tasks',
          filter: `event_id=eq.${eventId}`,
        },
        async (payload) => {
          const updatedTask = payload.new as Task;

          const { data: assigneesData } = await supabase
            .from('task_assignees')
            .select(`
              employee:employees!task_assignees_employee_id_fkey(
                id,
                name,
                surname,
                avatar_url,
                email,
                phone_number
              )
            `)
            .eq('task_id', updatedTask.id);

          let currently_working_employee = null;
          if (updatedTask.currently_working_by) {
            const { data: workingEmployee } = await supabase
              .from('employees')
              .select('name, surname, avatar_url, avatar_metadata')
              .eq('id', updatedTask.currently_working_by)
              .maybeSingle();

            currently_working_employee = workingEmployee;
          }

          const { count } = await supabase
            .from('task_comments')
            .select('*', { count: 'exact', head: true })
            .eq('task_id', updatedTask.id);

          setTasks(prevTasks => {
            const taskExists = prevTasks.some(t => t.id === updatedTask.id);

            if (taskExists) {
              return prevTasks.map(task =>
                task.id === updatedTask.id
                  ? {
                      ...task,
                      ...updatedTask,
                      assignees: assigneesData || [],
                      currently_working_employee,
                      comments_count: count || 0,
                    }
                  : task
              );
            }

            return prevTasks;
          });
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'tasks',
          filter: `event_id=eq.${eventId}`,
        },
        () => {
          fetchTasks();
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'tasks',
          filter: `event_id=eq.${eventId}`,
        },
        (payload) => {
          const deletedTaskId = payload.old.id;
          setTasks(prevTasks => prevTasks.filter(t => t.id !== deletedTaskId));
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'task_assignees',
        },
        async (payload) => {
          const newAssignee = payload.new as any;

          const { data: employee } = await supabase
            .from('employees')
            .select('id, name, surname, avatar_url, email, phone_number')
            .eq('id', newAssignee.employee_id)
            .maybeSingle();

          if (employee) {
            setTasks(prevTasks =>
              prevTasks.map(task =>
                task.id === newAssignee.task_id
                  ? {
                      ...task,
                      assignees: [
                        ...(task.assignees || []),
                        { employee }
                      ]
                    }
                  : task
              )
            );
          }
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'task_assignees',
        },
        (payload) => {
          const deletedAssignee = payload.old as any;

          setTasks(prevTasks =>
            prevTasks.map(task =>
              task.id === deletedAssignee.task_id
                ? {
                    ...task,
                    assignees: (task.assignees || []).filter(
                      a => a.employee.id !== deletedAssignee.employee_id
                    )
                  }
                : task
            )
          );
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'task_comments',
        },
        async (payload) => {
          const comment = payload.eventType === 'DELETE' ? payload.old : payload.new;
          const taskId = comment.task_id;

          const { count } = await supabase
            .from('task_comments')
            .select('*', { count: 'exact', head: true })
            .eq('task_id', taskId);

          setTasks(prevTasks =>
            prevTasks.map(task =>
              task.id === taskId
                ? { ...task, comments_count: count || 0 }
                : task
            )
          );
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(tasksChannel);
      if (autoScrollIntervalRef.current) {
        clearInterval(autoScrollIntervalRef.current);
      }
    };
  }, [eventId, currentEmployee?.id]);

  const fetchTasks = async () => {
    try {
      setLoading(true);

      const { data, error } = await supabase
        .from('tasks')
        .select(
          `
          *,
          assignees:task_assignees(
            employee:employees!task_assignees_employee_id_fkey(
              id,
              name,
              surname,
              avatar_url,
              email,
              phone_number
            )
          ),
          currently_working_employee:employees!tasks_currently_working_by_fkey(
            name,
            surname,
            avatar_url,
            avatar_metadata
          )
        `,
        )
        .eq('event_id', eventId)
        .order('order_index', { ascending: true });

      if (error) throw error;

      // Add comments count to each task
      const tasksWithCounts = await Promise.all(
        (data || []).map(async (task) => {
          const { count } = await supabase
            .from('task_comments')
            .select('*', { count: 'exact', head: true })
            .eq('task_id', task.id);

          return {
            ...task,
            comments_count: count || 0,
          };
        }),
      );

      setTasks(tasksWithCounts);
    } catch (err) {
      console.error('Error fetching tasks:', err);
      showSnackbar('Błąd podczas pobierania zadań', 'error');
    } finally {
      setLoading(false);
    }
  };

  const fetchEmployees = async () => {
    try {
      const { data, error } = await supabase
        .from('employees')
        .select('id, name, surname, avatar_url')
        .order('name');

      if (error) throw error;
      setAvailableEmployees(data || []);
    } catch (err) {
      console.error('Error fetching employees:', err);
    }
  };

  const checkActiveTimer = async () => {
    if (!currentEmployee?.id) return;

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

  const startTimer = async (task: Task) => {
    if (!currentEmployee?.id) return;

    try {
      const { error } = await supabase.from('time_entries').insert({
        employee_id: currentEmployee.id,
        task_id: task.id,
        event_id: eventId,
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

  const handleOpenModal = (task?: Task) => {
    if (task) {
      setEditingTask(task);
      setFormData({
        title: task.title,
        description: task.description || '',
        priority: task.priority,
        board_column: task.board_column,
        due_date: task.due_date || '',
      });
    } else {
      setEditingTask(null);
      setFormData({
        title: '',
        description: '',
        priority: 'medium',
        board_column: 'todo',
        due_date: '',
      });
    }
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setEditingTask(null);
    setFormData({
      title: '',
      description: '',
      priority: 'medium',
      board_column: 'todo',
      due_date: '',
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.title.trim()) {
      showSnackbar('Tytuł zadania jest wymagany', 'error');
      return;
    }

    try {
      const taskData = {
        title: formData.title.trim(),
        description: formData.description.trim() || null,
        priority: formData.priority,
        board_column: formData.board_column,
        status: formData.board_column as
          | 'todo'
          | 'in_progress'
          | 'review'
          | 'completed'
          | 'cancelled',
        due_date: formData.due_date || null,
        event_id: eventId,
        is_private: false,
        owner_id: null,
        created_by: currentEmployee?.id,
      };

      if (editingTask) {
        const { error } = await supabase.from('tasks').update(taskData).eq('id', editingTask.id);

        if (error) throw error;
        showSnackbar('Zadanie zaktualizowane', 'success');
      } else {
        const maxOrderQuery = await supabase
          .from('tasks')
          .select('order_index')
          .eq('event_id', eventId)
          .eq('board_column', formData.board_column)
          .order('order_index', { ascending: false })
          .limit(1)
          .maybeSingle();

        const nextOrder = maxOrderQuery.data ? maxOrderQuery.data.order_index + 1 : 0;

        const { error } = await supabase
          .from('tasks')
          .insert([{ ...taskData, order_index: nextOrder }]);

        if (error) throw error;
        showSnackbar('Zadanie dodane', 'success');
      }

      await fetchTasks();
      handleCloseModal();
    } catch (err) {
      console.error('Error saving task:', err);
      showSnackbar('Błąd podczas zapisywania zadania', 'error');
    }
  };

  const handleDelete = async (taskId: string) => {
    if (!confirm('Czy na pewno chcesz usunąć to zadanie?')) return;

    try {
      const { error } = await supabase.from('tasks').delete().eq('id', taskId);

      if (error) throw error;
      showSnackbar('Zadanie usunięte', 'success');
      await fetchTasks();
    } catch (err) {
      console.error('Error deleting task:', err);
      showSnackbar('Błąd podczas usuwania zadania', 'error');
    }
  };

  const handleMoveTask = async (taskId: string, newColumn: string, oldColumn: string) => {
    if (newColumn === 'in_progress' && oldColumn !== 'in_progress') {
      if (activeTimer && activeTimer.task_id !== taskId) {
        showSnackbar('Zakończ poprzednie zadanie aby rozpocząć kolejne lub przenieś je do zrobienia', 'warning');
        return;
      }

      setTasks(prevTasks =>
        prevTasks.map(task =>
          task.id === taskId
            ? {
                ...task,
                board_column: newColumn,
                status: newColumn as 'todo' | 'in_progress' | 'review' | 'completed' | 'cancelled',
                currently_working_by: currentEmployee?.id || null,
              }
            : task
        )
      );

      try {
        const { error } = await supabase
          .from('tasks')
          .update({
            board_column: newColumn,
            status: newColumn as 'todo' | 'in_progress' | 'review' | 'completed' | 'cancelled',
            currently_working_by: currentEmployee?.id || null,
          })
          .eq('id', taskId);

        if (error) throw error;

        if (!activeTimer) {
          const task = tasks.find(t => t.id === taskId);
          if (task) {
            await startTimer(task);
          }
        }
      } catch (err) {
        console.error('Error moving task:', err);
        showSnackbar('Błąd podczas przenoszenia zadania', 'error');

        setTasks(prevTasks =>
          prevTasks.map(task =>
            task.id === taskId
              ? { ...task, board_column: oldColumn }
              : task
          )
        );
      }
      return;
    }

    if ((newColumn === 'review' || newColumn === 'completed') && oldColumn === 'in_progress') {
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
        task.id === taskId
          ? {
              ...task,
              board_column: newColumn,
              status: newColumn as 'todo' | 'in_progress' | 'review' | 'completed' | 'cancelled',
              currently_working_by: newColumn !== 'in_progress' ? null : task.currently_working_by,
            }
          : task
      )
    );

    try {
      const updateData: any = {
        board_column: newColumn,
        status: newColumn as 'todo' | 'in_progress' | 'review' | 'completed' | 'cancelled',
      };

      if (newColumn !== 'in_progress') {
        updateData.currently_working_by = null;
      }

      const { error } = await supabase
        .from('tasks')
        .update(updateData)
        .eq('id', taskId);

      if (error) throw error;
    } catch (err) {
      console.error('Error moving task:', err);
      showSnackbar('Błąd podczas przenoszenia zadania', 'error');

      setTasks(prevTasks =>
        prevTasks.map(task =>
          task.id === taskId ? { ...task, board_column: oldColumn } : task
        )
      );
    }
  };

  const handleAutoScroll = (e: React.DragEvent) => {
    if (!scrollContainerRef.current) return;

    const container = scrollContainerRef.current;
    const rect = container.getBoundingClientRect();
    const scrollThreshold = 100;
    const scrollSpeed = 10;

    const distanceFromLeft = e.clientX - rect.left;
    const distanceFromRight = rect.right - e.clientX;

    if (autoScrollIntervalRef.current) {
      clearInterval(autoScrollIntervalRef.current);
      autoScrollIntervalRef.current = null;
    }

    if (distanceFromLeft < scrollThreshold && container.scrollLeft > 0) {
      autoScrollIntervalRef.current = setInterval(() => {
        container.scrollLeft -= scrollSpeed;
      }, 16);
    } else if (distanceFromRight < scrollThreshold) {
      autoScrollIntervalRef.current = setInterval(() => {
        container.scrollLeft += scrollSpeed;
      }, 16);
    }
  };

  const handleDragStart = (e: React.DragEvent, task: Task) => {
    setDraggedTask(task);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnd = () => {
    setDraggedTask(null);
    setDragOverColumn(null);
    if (autoScrollIntervalRef.current) {
      clearInterval(autoScrollIntervalRef.current);
      autoScrollIntervalRef.current = null;
    }
  };

  const handleDragOver = (e: React.DragEvent, columnId: string) => {
    e.preventDefault();
    setDragOverColumn(columnId);
    handleAutoScroll(e);
  };

  const handleDrop = async (e: React.DragEvent, columnId: string) => {
    e.preventDefault();
    setDragOverColumn(null);

    if (autoScrollIntervalRef.current) {
      clearInterval(autoScrollIntervalRef.current);
      autoScrollIntervalRef.current = null;
    }

    if (!draggedTask || draggedTask.board_column === columnId) {
      setDraggedTask(null);
      return;
    }

    const oldColumn = draggedTask.board_column;
    await handleMoveTask(draggedTask.id, columnId, oldColumn);
    setDraggedTask(null);
  };

  const handleOpenAssignModal = (task: Task) => {
    setAssigningTask(task);
    setShowAssignModal(true);
  };

  const handleCloseAssignModal = () => {
    setShowAssignModal(false);
    setAssigningTask(null);
  };

  const handleToggleAssignee = async (employeeId: string) => {
    if (!assigningTask) return;

    try {
      const isAssigned = assigningTask.assignees?.some((a) => a.employee.id === employeeId);

      if (isAssigned) {
        const { error } = await supabase
          .from('task_assignees')
          .delete()
          .eq('task_id', assigningTask.id)
          .eq('employee_id', employeeId);

        if (error) throw error;
        showSnackbar('Pracownik odłączony', 'success');
      } else {
        const { error: assignError } = await supabase
          .from('task_assignees')
          .insert([{ task_id: assigningTask.id, employee_id: employeeId }]);

        if (assignError) throw assignError;

        // Automatycznie dodaj pracownika do zespołu wydarzenia
        // Najpierw sprawdź czy już istnieje
        const { data: existing } = await supabase
          .from('employee_assignments')
          .select('id')
          .eq('event_id', eventId)
          .eq('employee_id', employeeId)
          .maybeSingle();

        if (!existing) {
          const { error: teamError } = await supabase.from('employee_assignments').insert([
            {
              event_id: eventId,
              employee_id: employeeId,
              role: 'Członek zespołu',
            },
          ]);

          if (teamError) {
            console.error('Error adding to team:', teamError);
          } else {
            console.log('Added employee to team');
          }
        }

        showSnackbar('Pracownik przypisany', 'success');
      }

      await fetchTasks();
    } catch (err) {
      console.error('Error toggling assignee:', err);
      showSnackbar('Błąd podczas zmiany przypisania', 'error');
    }
  };

  const getColumnTasks = (columnId: string) => {
    return tasks.filter((task) => task.board_column === columnId);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-[#e5e4e2]/60">Ładowanie zadań...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-light text-[#e5e4e2]">Zadania wydarzenia</h2>
        {canManage && (
          <button
            onClick={() => handleOpenModal()}
            className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
          >
            <Plus className="h-4 w-4" />
            Nowe zadanie
          </button>
        )}
      </div>

      <div className="overflow-x-auto pb-4" ref={scrollContainerRef}>
        <div className="flex min-w-max gap-4">
          {columns.map((column) => {
            const columnTasks = getColumnTasks(column.id);

            return (
              <div
                key={column.id}
                className={`rounded-xl border bg-[#1c1f33] p-4 ${column.color} w-80 flex-shrink-0 transition-all ${
                  dragOverColumn === column.id ? 'scale-[1.02] ring-2 ring-[#d3bb73]/50' : ''
                }`}
                onDragOver={(e) => handleDragOver(e, column.id)}
                onDrop={(e) => handleDrop(e, column.id)}
                onDragLeave={() => setDragOverColumn(null)}
              >
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="font-medium text-[#e5e4e2]">{column.label}</h3>
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-[#0f1119] px-2 py-1 text-xs text-[#e5e4e2]/60">
                      {columnTasks.length}
                    </span>
                    {canManage && (
                      <button
                        onClick={() => {
                          setEditingTask(null);
                          setShowModal(true);
                        }}
                        className="rounded p-1 text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/10"
                        title="Dodaj zadanie"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="max-h-[calc(100vh-300px)] space-y-3 overflow-y-auto pr-2">
                  {columnTasks.map((task) => (
                    <div
                      key={task.id}
                      draggable={canManage}
                      onDragStart={(e) => handleDragStart(e, task)}
                      onDragEnd={handleDragEnd}
                      className={canManage ? 'cursor-move' : ''}
                    >
                      <TaskCard
                        task={task}
                        isDragging={draggedTask?.id === task.id}
                        canManage={canManage}
                        showDragHandle={canManage}
                        onEdit={handleOpenModal}
                        onDelete={handleDelete}
                        onAssign={handleOpenAssignModal}
                      />
                    </div>
                  ))}

                  {columnTasks.length === 0 && (
                    <div className="py-8 text-center text-sm text-[#e5e4e2]/40">Brak zadań</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] p-6">
            <div className="mb-6 flex items-center justify-between">
              <h3 className="text-lg font-medium text-[#e5e4e2]">
                {editingTask ? 'Edytuj zadanie' : 'Nowe zadanie'}
              </h3>
              <button
                onClick={handleCloseModal}
                className="text-[#e5e4e2]/60 transition-colors hover:text-[#e5e4e2]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-[#e5e4e2]/80">Tytuł *</label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="w-full rounded-lg border border-[#d3bb73]/30 bg-[#0f1119] px-3 py-2 text-[#e5e4e2] focus:outline-none focus:ring-2 focus:ring-[#d3bb73]/50"
                  placeholder="Nazwa zadania"
                  required
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-[#e5e4e2]/80">Opis</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full resize-none rounded-lg border border-[#d3bb73]/30 bg-[#0f1119] px-3 py-2 text-[#e5e4e2] focus:outline-none focus:ring-2 focus:ring-[#d3bb73]/50"
                  rows={3}
                  placeholder="Szczegóły zadania"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-[#e5e4e2]/80">
                  Priorytet
                </label>
                <select
                  value={formData.priority}
                  onChange={(e) => setFormData({ ...formData, priority: e.target.value as any })}
                  className="w-full rounded-lg border border-[#d3bb73]/30 bg-[#0f1119] px-3 py-2 text-[#e5e4e2] focus:outline-none focus:ring-2 focus:ring-[#d3bb73]/50"
                >
                  <option value="low">Niski</option>
                  <option value="medium">Średni</option>
                  <option value="high">Wysoki</option>
                  <option value="urgent">Pilne</option>
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-[#e5e4e2]/80">Kolumna</label>
                <select
                  value={formData.board_column}
                  onChange={(e) => setFormData({ ...formData, board_column: e.target.value })}
                  className="w-full rounded-lg border border-[#d3bb73]/30 bg-[#0f1119] px-3 py-2 text-[#e5e4e2] focus:outline-none focus:ring-2 focus:ring-[#d3bb73]/50"
                >
                  {columns.map((col) => (
                    <option key={col.id} value={col.id}>
                      {col.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-[#e5e4e2]/80">Termin</label>
                <input
                  type="date"
                  value={formData.due_date}
                  onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
                  className="w-full rounded-lg border border-[#d3bb73]/30 bg-[#0f1119] px-3 py-2 text-[#e5e4e2] focus:outline-none focus:ring-2 focus:ring-[#d3bb73]/50"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="flex-1 rounded-lg bg-[#0f1119] px-4 py-2 text-[#e5e4e2] transition-colors hover:bg-[#0f1119]/80"
                >
                  Anuluj
                </button>
                <button
                  type="submit"
                  className="flex-1 rounded-lg bg-[#d3bb73] px-4 py-2 font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
                >
                  {editingTask ? 'Zapisz' : 'Dodaj'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showAssignModal && assigningTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] p-6">
            <div className="mb-6 flex items-center justify-between">
              <h3 className="text-lg font-medium text-[#e5e4e2]">Przypisz pracowników</h3>
              <button
                onClick={handleCloseAssignModal}
                className="text-[#e5e4e2]/60 transition-colors hover:text-[#e5e4e2]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mb-4">
              <h4 className="mb-2 text-sm font-medium text-[#e5e4e2]">{assigningTask.title}</h4>
              <p className="text-xs text-[#e5e4e2]/60">Wybierz pracowników do przypisania</p>
            </div>

            <div className="max-h-96 space-y-2 overflow-y-auto">
              {availableEmployees.map((employee) => {
                const isAssigned = assigningTask.assignees?.some(
                  (a) => a.employee.id === employee.id,
                );

                return (
                  <button
                    key={employee.id}
                    onClick={() => handleToggleAssignee(employee.id)}
                    className={`flex w-full items-center gap-3 rounded-lg border p-3 transition-all ${
                      isAssigned
                        ? 'border-[#d3bb73]/50 bg-[#d3bb73]/10 hover:bg-[#d3bb73]/20'
                        : 'border-[#d3bb73]/10 bg-[#0f1119] hover:border-[#d3bb73]/30'
                    }`}
                  >
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#d3bb73]/20">
                      {employee.avatar_url ? (
                        <img
                          src={employee.avatar_url}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="text-sm text-[#e5e4e2]">
                          {employee.name[0]}
                          {employee.surname[0]}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 text-left">
                      <div className="text-sm font-medium text-[#e5e4e2]">
                        {employee.nickname || employee.name}
                      </div>
                    </div>
                    {isAssigned && (
                      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[#d3bb73]">
                        <svg
                          className="h-3 w-3 text-[#1c1f33]"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="mt-6">
              <button
                onClick={handleCloseAssignModal}
                className="w-full rounded-lg bg-[#d3bb73] px-4 py-2 font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
              >
                Zamknij
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
