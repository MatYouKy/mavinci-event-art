'use client';

import { useState, useEffect, useRef } from 'react';
import { Plus, CheckSquare, User, Calendar, MoreVertical, X, Trash2, CreditCard as Edit, GripVertical, Play, Clock } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { useMobile } from '@/hooks/useMobile';
import TaskCard from '@/components/crm/TaskCard';
import { useGetTasksListQuery, useCreateTaskMutation, useUpdateTaskMutation, useDeleteTaskMutation } from '@/store/api/tasksApi';

type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';
type TaskStatus = 'todo' | 'in_progress' | 'review' | 'completed' | 'cancelled';
type TaskBoardColumn = 'todo' | 'in_progress' | 'review' | 'completed';

interface Task {
  id: string;
  title: string;
  description: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  board_column: TaskBoardColumn;
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
  task_assignees: {
    employee_id: string;
    employees: { name: string; surname: string; avatar_url: string | null; avatar_metadata?: any };
  }[];
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

  const { data: tasks = [], isLoading: loading } = useGetTasksListQuery();
  const [createTask] = useCreateTaskMutation();
  const [updateTask] = useUpdateTaskMutation();
  const [deleteTask] = useDeleteTaskMutation();

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [draggedTask, setDraggedTask] = useState<Task | null>(null);
  const [showTimerModal, setShowTimerModal] = useState(false);
  const [taskToStart, setTaskToStart] = useState<Task | null>(null);
  const [activeTimer, setActiveTimer] = useState<any>(null);

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    priority: 'medium' as TaskPriority,
    board_column: 'todo' as TaskBoardColumn,
    due_date: '',
    assigned_employees: [] as string[],
  });

  const [employeeSearch, setEmployeeSearch] = useState('');
  const [filteredEmployees, setFilteredEmployees] = useState<Employee[]>([]);
  const [dragOverColumn, setDragOverColumn] = useState<TaskBoardColumn | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const autoScrollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isMobile = useMobile(1024);
  const [activeColumnIndex, setActiveColumnIndex] = useState(0);
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);

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
    fetchEmployees();

    const tasksChannel = supabase
      .channel('tasks_changes')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'tasks',
        },
        async (payload) => {
          const updatedTask = payload.new as Task;

          const { data: assignees } = await supabase
            .from('task_assignees')
            .select('employee_id')
            .eq('task_id', updatedTask.id);

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
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'tasks',
        },
        async (payload) => {
          const newTask = payload.new as Task;

          const { data: assignees } = await supabase
            .from('task_assignees')
            .select('employee_id')
            .eq('task_id', newTask.id);

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

          let currently_working_employee = null;
          if (newTask.currently_working_by) {
            const { data: workingEmployee } = await supabase
              .from('employees')
              .select('name, surname, avatar_url, avatar_metadata')
              .eq('id', newTask.currently_working_by)
              .maybeSingle();

            currently_working_employee = workingEmployee;
          }

          const { count } = await supabase
            .from('task_comments')
            .select('*', { count: 'exact', head: true })
            .eq('task_id', newTask.id);
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'tasks',
        },
        (payload) => {
          const deletedTaskId = payload.old.id;
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
            .select('name, surname, avatar_url, avatar_metadata')
            .eq('id', newAssignee.employee_id)
            .maybeSingle();

          if (employee) {
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
        },
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
        assigned_employees: task.task_assignees.map((a) => a.employee_id),
      });
    } else {
      setEditingTask(null);
      setFormData({
        title: '',
        description: '',
        priority: 'medium',
        board_column: (defaultColumn || 'todo') as TaskBoardColumn,
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
            emp.email.toLowerCase().includes(value.toLowerCase())),
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
        await updateTask({
          id: editingTask.id,
          title: formData.title,
          description: formData.description || null,
          priority: formData.priority,
          board_column: formData.board_column,
          due_date: formData.due_date || null,
          assigned_employees: formData.assigned_employees,
          assigned_by: currentEmployee?.id,
        }).unwrap();

        showSnackbar('Zadanie zostało zaktualizowane', 'success');
      } else {
        await createTask({
          title: formData.title,
          description: formData.description || null,
          priority: formData.priority,
          board_column: formData.board_column,
          due_date: formData.due_date || null,
          assigned_employees: formData.assigned_employees,
          created_by: currentEmployee?.id,
        }).unwrap();

        showSnackbar('Zadanie zostało utworzone', 'success');
      }

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
      await deleteTask(taskId).unwrap();
      showSnackbar('Zadanie zostało usunięte', 'success');
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
    setDragOverColumn(columnId as TaskBoardColumn);
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
        showSnackbar(
          'Zakończ poprzednie zadanie aby rozpocząć kolejne lub przenieś je do zrobienia',
          'warning',
        );
        return;
      }

      if (!activeTimer) {
        setDraggedTask(null);
        setDragOverColumn(null);
        stopAutoScroll();

        try {
          await updateTask({
            id: taskId,
            board_column: columnId,
            currently_working_by: currentEmployee?.id || null,
          }).unwrap();

          await startTimer(draggedTask);
          showSnackbar('Zadanie rozpoczęte', 'success');
        } catch (error) {
          console.error('Error moving task:', error);
          showSnackbar('Błąd podczas przenoszenia zadania', 'error');
        }
        return;
      }
    }

    if ((columnId === 'review' || columnId === 'completed') && oldColumn === 'in_progress') {
      if (activeTimer && activeTimer.task_id === taskId) {
        const shouldStopTimer = await showConfirm(
          'Zatrzymać czas pracy?',
          'Zadanie jest przenoszone do kolejnego etapu. Czy chcesz zatrzymać licznik czasu?',
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

    setDraggedTask(null);
    setDragOverColumn(null);
    stopAutoScroll();

    try {
      const updateData: any = { board_column: columnId as TaskBoardColumn };

      if (columnId !== 'in_progress') {
        updateData.currently_working_by = null;
      }

      await updateTask({
        id: taskId,
        ...updateData,
      }).unwrap();

      showSnackbar('Zadanie przeniesione', 'success');
    } catch (error) {
      console.error('Error moving task:', error);
      showSnackbar('Błąd podczas przenoszenia zadania', 'error');
    }
  };

  const getTasksByColumn = (columnId: string) => {
    return tasks.filter((task) => task.board_column === columnId);
  };

  const minSwipeDistance = 50;

  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    setTouchEnd(e.targetTouches[0].clientX);
  };

  const handleTouchEnd = () => {
    if (!touchStart || !touchEnd) return;

    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > minSwipeDistance;
    const isRightSwipe = distance < -minSwipeDistance;

    if (isLeftSwipe && activeColumnIndex < columns.length - 1) {
      setIsTransitioning(true);
      setTimeout(() => {
        setActiveColumnIndex((prev) => prev + 1);
        setIsTransitioning(false);
      }, 200);
    }

    if (isRightSwipe && activeColumnIndex > 0) {
      setIsTransitioning(true);
      setTimeout(() => {
        setActiveColumnIndex((prev) => prev - 1);
        setIsTransitioning(false);
      }, 200);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-[#d3bb73]"></div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-80px)] flex-col">
      <div
        className={`mb-3 flex flex-shrink-0 flex-wrap items-center justify-between gap-3 ${isMobile ? 'px-2' : 'px-2'}`}
      >
        {!isMobile && <h2 className="text-2xl font-light text-[#e5e4e2]">Zadania</h2>}

        {canCreateTasks && (
          <button
            onClick={() => handleOpenModal()}
            className={`flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 ${isMobile ? 'ml-auto' : ''}`}
          >
            <Plus className="h-4 w-4" />
            {isMobile ? '+' : 'Nowe zadanie'}
          </button>
        )}
      </div>

      <div
        ref={scrollContainerRef}
        className={`flex-1 overflow-y-hidden ${isMobile ? 'overflow-x-hidden pb-2' : 'overflow-x-auto pb-4'}`}
        onTouchStart={isMobile ? handleTouchStart : undefined}
        onTouchMove={isMobile ? handleTouchMove : undefined}
        onTouchEnd={isMobile ? handleTouchEnd : undefined}
      >
        <div
          className={`flex h-full transition-opacity duration-200 ${isMobile ? 'w-full px-2' : 'gap-4 px-2'} ${isTransitioning ? 'opacity-0' : 'opacity-100'}`}
          style={{
            minWidth: isMobile ? '100%' : 'min-content',
          }}
        >
          {(isMobile ? [columns[activeColumnIndex]] : columns).map((column) => (
            <div
              key={column.id}
              onDragOver={(e) => handleDragOver(e, column.id)}
              onDragLeave={handleDragLeave}
              onDrop={() => handleDrop(column.id)}
              className={`flex flex-col border-2 bg-[#1c1f33] transition-all ${
                dragOverColumn === column.id ? 'border-[#d3bb73] bg-[#d3bb73]/5' : column.color
              } ${isMobile ? 'w-full rounded-lg p-2' : 'flex-shrink-0 rounded-xl p-4'}`}
              style={{
                width: isMobile ? '100%' : '320px',
                height: '100%',
              }}
            >
              <div
                className={`flex flex-shrink-0 items-center justify-between ${isMobile ? 'mb-2' : 'mb-4'}`}
              >
                <h3 className="font-medium text-[#e5e4e2]">{column.label}</h3>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-[#e5e4e2]/60">
                    {getTasksByColumn(column.id).length}
                  </span>
                  {canCreateTasks && (
                    <button
                      onClick={() => handleOpenModal(undefined, column.id)}
                      className="rounded p-1 text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/10"
                      title="Dodaj zadanie"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>

              <div
                className={`flex-1 overflow-y-auto ${isMobile ? '-mr-1 space-y-2 pr-1' : '-mr-2 space-y-3 pr-2'}`}
              >
                {getTasksByColumn(column.id).map((task) => (
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
                          className={`flex w-full items-center justify-center gap-1 rounded px-2 py-1 text-xs transition-colors ${
                            activeTimer?.task_id === task.id
                              ? 'cursor-default bg-green-500/20 text-green-400'
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
                      }
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {isMobile && (
        <div className="flex flex-shrink-0 justify-center gap-3 py-3 px-2 bg-[#0d0f17] border-t border-[#d3bb73]/10">
          {columns.map((_, index) => (
            <button
              key={index}
              onClick={() => {
                if (index !== activeColumnIndex) {
                  setIsTransitioning(true);
                  setTimeout(() => {
                    setActiveColumnIndex(index);
                    setIsTransitioning(false);
                  }, 200);
                }
              }}
              className={`h-2.5 rounded-full transition-all ${
                index === activeColumnIndex ? 'w-10 bg-[#d3bb73]' : 'w-2.5 bg-[#e5e4e2]/40'
              }`}
              aria-label={`Przejdź do sekcji ${index + 1}`}
            />
          ))}
        </div>
      )}

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
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Tytuł *</label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
                  placeholder="Wprowadź tytuł zadania"
                  required
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Opis</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={4}
                  className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
                  placeholder="Wprowadź opis zadania"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-2 block text-sm text-[#e5e4e2]/60">Priorytet</label>
                  <select
                    value={formData.priority}
                    onChange={(e) => setFormData({ ...formData, priority: e.target.value as any })}
                    className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
                  >
                    <option value="low">Niski</option>
                    <option value="medium">Średni</option>
                    <option value="high">Wysoki</option>
                    <option value="urgent">Pilne</option>
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-sm text-[#e5e4e2]/60">Kolumna</label>
                  <select
                    value={formData.board_column}
                    onChange={(e) =>
                      setFormData({ ...formData, board_column: e.target.value as TaskBoardColumn })
                    }
                    className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
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
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Termin wykonania</label>
                <input
                  type="date"
                  value={formData.due_date}
                  onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
                  className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                  Przypisani pracownicy
                </label>

                {formData.assigned_employees.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-2">
                    {formData.assigned_employees.map((empId) => {
                      const employee = employees.find((e) => e.id === empId);
                      if (!employee) return null;
                      return (
                        <div
                          key={empId}
                          className="flex items-center gap-2 rounded-full bg-[#d3bb73]/20 px-3 py-1 text-sm text-[#d3bb73]"
                        >
                          <span>
                            {employee.name} {employee.surname}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleRemoveEmployee(empId)}
                            className="transition-colors hover:text-[#d3bb73]/70"
                          >
                            <X className="h-3 w-3" />
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
                    className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
                  />

                  {filteredEmployees.length > 0 && (
                    <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] shadow-lg">
                      {filteredEmployees.map((employee) => (
                        <button
                          key={employee.id}
                          type="button"
                          onClick={() => handleAddEmployee(employee.id)}
                          className="flex w-full items-center justify-between px-4 py-2 text-left text-sm text-[#e5e4e2] transition-colors hover:bg-[#d3bb73]/10"
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
