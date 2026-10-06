'use client';

import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import {
  Plus,
  CheckSquare,
  User,
  Calendar,
  MoreVertical,
  X,
  Trash2,
  CreditCard as Edit,
  GripVertical,
  Play,
  Clock,
  Paperclip,
  FileText,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { shouldAutomateTaskTimer } from '@/lib/CRM/tasks/taskTimerPreference';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { useMobile } from '@/hooks/useMobile';
import TaskCard from '@/components/crm/TaskCard';
import SellerDatePicker from '@/app/(public)/seller/_components/SellerDatePicker';
import {
  useGetTasksListQuery,
  useCreateTaskMutation,
  useUpdateTaskMutation,
  useDeleteTaskMutation,
} from '@/store/api/tasksApi';
import { IEmployee } from '@/app/(crm)/crm/employees/type';
import { useEmployees } from '../employees/hooks/useEmployees';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';
type TaskStatus = 'todo' | 'in_progress' | 'review' | 'completed' | 'cancelled';
type TaskBoardColumn = 'todo' | 'in_progress' | 'review' | 'completed';

function TaskAttachmentPreview({ file }: { file: File }) {
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!file.type.startsWith('image/')) { setPreview(null); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return preview
    ? <img src={preview} alt={file.name} className="h-12 w-12 shrink-0 rounded object-cover" />
    : <FileText className="h-12 w-12 shrink-0 p-2 text-[#d3bb73]" />;
}

interface TaskColumnProps {
  column: { id: string; label: string; color: string };
  tasks: any[];
  draggedTask: any | null;
  dragOverColumn: TaskBoardColumn | null;
  canManage: boolean;
  canMove: boolean;
  canCreate: boolean;
  activeTimer: any;
  isMobile: boolean;
  onDragOver: (e: React.DragEvent, columnId: string) => void;
  onDragLeave: () => void;
  onDrop: (columnId: string) => void;
  onDragStart: (task: any) => void;
  onDragEnd: () => void;
  onEdit: (task?: any, defaultColumn?: string) => void;
  onDelete: (taskId: string) => void;
  onStartTimer: (task: any) => void;
}

const TaskColumn = memo(function TaskColumn({
  column,
  tasks,
  draggedTask,
  dragOverColumn,
  canManage,
  canMove,
  canCreate,
  activeTimer,
  isMobile,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragStart,
  onDragEnd,
  onEdit,
  onDelete,
  onStartTimer,
}: TaskColumnProps) {
  return (
    <div
      onDragOver={(e) => onDragOver(e, column.id)}
      onDragLeave={onDragLeave}
      onDrop={() => onDrop(column.id)}
      className={`flex flex-col border bg-[#1c1f33] transition-all ${
        dragOverColumn === column.id ? 'border-[#d3bb73]/20 bg-[#d3bb73]/10' : column.color
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
          <span className="text-sm text-[#e5e4e2]/60">{tasks.length}</span>
          {canCreate && (
            <button
              onClick={() => onEdit(undefined, column.id)}
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
        {tasks.map((task) => {
          return (
            <div
              key={task.id}
              draggable={canMove}
              onDragStart={() => onDragStart(task)}
              onDragEnd={onDragEnd}
              className="cursor-move"
            >
              <TaskCard
                task={task}
                isDragging={draggedTask?.id === task.id}
                canManage={canManage}
                showDragHandle={canManage}
                onEdit={onEdit}
                onDelete={onDelete}
                additionalActions={canMove ? (
                  <button
                    onClick={() => onStartTimer(task)}
                    disabled={activeTimer?.task_id === task.id}
                    className={`flex w-full items-center justify-center gap-1 rounded px-2 py-1 text-xs transition-colors ${
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
                ) : undefined}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
});

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
    employees: IEmployee;
  }[];
}

interface Employee {
  id: string;
  name: string;
  surname: string;
  email: string;
}

export function TasksPageClient({ initialTasks, inquiryId, employeeId, canManageInquiry, openCreateModal = false, onCreateModalHandled }: {
  initialTasks: Task[];
  inquiryId?: string;
  employeeId?: string;
  canManageInquiry?: boolean;
  openCreateModal?: boolean;
  onCreateModalHandled?: () => void;
}) {
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const { canCreateInModule, canManageModule, canViewModule, currentEmployee, isAdmin } =
    useCurrentEmployee();

  const canCreateTasks = inquiryId ? Boolean(canManageInquiry) : canCreateInModule('tasks');
  const canManageTasks = inquiryId ? Boolean(canManageInquiry) : canManageModule('tasks');
  const canMoveTasks = inquiryId ? Boolean(canManageInquiry) : canViewModule('tasks');

  const { currentData: tasks = initialTasks, isLoading: loading, isError, refetch } = useGetTasksListQuery(employeeId ? { employeeId } : inquiryId ? { inquiryId } : undefined, { refetchOnMountOrArgChange: true });
  const [createTask] = useCreateTaskMutation();
  const [updateTask] = useUpdateTaskMutation();
  const [deleteTask] = useDeleteTaskMutation();

  const [employees, setEmployees] = useState<Employee[]>([] as Employee[]);
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

  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [dueDateValid, setDueDateValid] = useState(true);
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [filteredEmployees, setFilteredEmployees] = useState<Employee[]>([]);
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);
  const [savedTaskId, setSavedTaskId] = useState<string | null>(null);
  const savedTaskIdRef = useRef<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<TaskBoardColumn | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const autoScrollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isMobile = useMobile(1024);
  const [activeColumnIndex, setActiveColumnIndex] = useState(0);
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);

  const columns = [
    { id: 'todo', label: 'Do zrobienia', color: 'border-yellow-500/10' },
    { id: 'in_progress', label: 'W trakcie', color: 'border-blue-500/10' },
    { id: 'review', label: 'Sprawdzenie', color: 'border-purple-500/10' },
    { id: 'completed', label: 'Zakończone', color: 'border-green-500/10' },
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
  }, []);

  useEffect(() => {
    if (currentEmployee) {
      checkActiveTimer();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    if (task ? !canManageTasks : !canCreateTasks) return;
    setDueDateValid(true);
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
        assigned_employees: currentEmployee?.id ? [currentEmployee.id] : [],
      });
    }
    setAttachmentFiles([]);
    setSavedTaskId(null);
    savedTaskIdRef.current = null;
    setShowModal(true);
  };

  const handleCloseModal = () => {
    if (savingRef.current) return;
    setShowModal(false);
    setEditingTask(null);
    setEmployeeSearch('');
    setFilteredEmployees([]);
    setAttachmentFiles([]);
    setSavedTaskId(null);
    savedTaskIdRef.current = null;
  };

  useEffect(() => {
    if (!openCreateModal || !canCreateTasks) return;
    handleOpenModal();
    onCreateModalHandled?.();
    // This flag is an explicit request from the inquiry toolbar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openCreateModal, canCreateTasks]);

  const handleAttachmentSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    setAttachmentFiles((previous) => [...previous, ...selected.filter((file) =>
      !previous.some((existing) => existing.name === file.name && existing.size === file.size && existing.lastModified === file.lastModified),
    )]);
    e.target.value = '';
  };

  const uploadTaskAttachments = async (taskId: string) => {
    if (!currentEmployee) throw new Error('Brak zalogowanego pracownika');
    for (const file of attachmentFiles) {
      const extension = file.name.includes('.') ? file.name.split('.').pop()?.replace(/[^a-zA-Z0-9]/g, '') : '';
      const filePath = `task-attachments/${taskId}/${crypto.randomUUID()}${extension ? `.${extension}` : ''}`;
      const { error: uploadError } = await supabase.storage.from('event-files').upload(filePath, file);
      if (uploadError) throw new Error(`Nie udało się przesłać pliku „${file.name}”.`);
      const { data: { publicUrl } } = supabase.storage.from('event-files').getPublicUrl(filePath);
      const { error } = await supabase.from('task_attachments').insert({
        task_id: taskId,
        file_name: file.name,
        file_url: publicUrl,
        file_type: file.type || 'application/octet-stream',
        file_size: file.size,
        uploaded_by: currentEmployee.id,
      });
      if (error) {
        await supabase.storage.from('event-files').remove([filePath]);
        throw new Error(`Nie udało się zapisać załącznika „${file.name}”.`);
      }
      // Remove completed uploads so retrying never duplicates them.
      setAttachmentFiles((previous) => previous.filter((pending) => pending !== file));
    }
  };

  const handleEmployeeSearch = (value: string) => {
    setEmployeeSearch(value);
    if (value.trim()) {
      const filtered = employees.filter(
        (emp) =>
          !formData.assigned_employees.includes(emp.id) &&
          (`${emp.name} ${emp.surname}`.toLowerCase().includes(value.toLowerCase()) ||
            (emp.email || '').toLowerCase().includes(value.toLowerCase())),
      );
      setFilteredEmployees(filtered.slice(0, 5));
    } else {
      setFilteredEmployees([]);
    }
  };

  const handleAddEmployee = (employeeId: string) => {
    setFormData({
      ...formData,
      assigned_employees: [...new Set([...formData.assigned_employees, employeeId])],
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
    if (savingRef.current || (editingTask ? !canManageTasks : !canCreateTasks)) return;
    if (!dueDateValid) { showSnackbar('Podaj poprawną datę w formacie DD.MM.RRRR.', 'warning'); return; }

    if (!formData.title.trim()) {
      showSnackbar('Tytuł zadania jest wymagany', 'warning');
      return;
    }

    if (!currentEmployee) { showSnackbar('Poczekaj na załadowanie danych pracownika.', 'warning'); return; }
    savingRef.current = true;
    setSaving(true);
    try {
      if (!savedTaskIdRef.current && editingTask) {
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

        savedTaskIdRef.current = editingTask.id;
        setSavedTaskId(editingTask.id);
      } else if (!savedTaskIdRef.current) {
        const created = await createTask({
          title: formData.title,
          description: formData.description || null,
          priority: formData.priority,
          board_column: formData.board_column,
          due_date: formData.due_date || null,
          assigned_employees: formData.assigned_employees,
          created_by: currentEmployee?.id || undefined,
          owner_id: currentEmployee?.id || null,
          is_private: false,
          inquiry_id: inquiryId,
        }).unwrap();

        savedTaskIdRef.current = created.id;
        setSavedTaskId(created.id);
      }

      if (savedTaskIdRef.current) await uploadTaskAttachments(savedTaskIdRef.current);
      showSnackbar(editingTask ? 'Zadanie zostało zaktualizowane' : 'Zadanie zostało utworzone', 'success');
      savingRef.current = false;
      handleCloseModal();
    } catch (error) {
      console.error('Error saving task:', error);
      showSnackbar(savedTaskIdRef.current
        ? `Zadanie zapisane. ${error instanceof Error ? error.message : 'Nie udało się przesłać załączników.'} Ponów przesyłanie pozostałych plików.`
        : 'Błąd podczas zapisywania zadania', 'error');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleDeleteTask = useCallback(
    async (taskId: string) => {
      if (!canManageTasks) return;
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
    },
    [deleteTask, showConfirm, showSnackbar, canManageTasks],
  );

  const handleAutoScroll = useCallback((e: React.DragEvent) => {
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
  }, []);

  const stopAutoScroll = useCallback(() => {
    if (autoScrollIntervalRef.current) {
      clearInterval(autoScrollIntervalRef.current);
      autoScrollIntervalRef.current = null;
    }
  }, []);

  const handleDragStart = useCallback((task: Task) => {
    setDraggedTask(task);
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent, columnId: string) => {
      e.preventDefault();
      setDragOverColumn(columnId as TaskBoardColumn);
      handleAutoScroll(e);
    },
    [handleAutoScroll],
  );

  const handleDragLeave = useCallback(() => {
    setDragOverColumn(null);
  }, []);

  const handleDrop = async (columnId: string) => {
    if (!canMoveTasks) return;
    if (!draggedTask || draggedTask.board_column === columnId) {
      setDraggedTask(null);
      return;
    }

    const oldColumn = draggedTask.board_column;
    const taskId = draggedTask.id;

    let automateTimer = true;
    if (columnId === 'in_progress' || oldColumn === 'in_progress') {
      try {
        automateTimer = await shouldAutomateTaskTimer(currentEmployee?.id, isAdmin);
      } catch (error) {
        console.error('Error reading task timer preference:', error);
        setDraggedTask(null);
        setDragOverColumn(null);
        stopAutoScroll();
        showSnackbar('Nie udało się wczytać ustawień czasu pracy. Spróbuj ponownie.', 'error');
        return;
      }
    }

    if (automateTimer && columnId === 'in_progress' && oldColumn !== 'in_progress') {
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

    if (automateTimer && (columnId === 'review' || columnId === 'completed') && oldColumn === 'in_progress') {
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

  const getTasksByColumn = useCallback(
    (columnId: string) => {
      return tasks.filter((task) => task.board_column === columnId);
    },
    [tasks],
  );

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

  if (isError) {
    return <div role="alert" className="rounded-xl bg-[#1c1f33] p-6 text-sm text-[#e5e4e2]">Nie udało się wczytać zadań. <button type="button" onClick={() => void refetch()} className="ml-2 text-[#d3bb73]">Spróbuj ponownie</button></div>;
  }

  if (loading && !initialTasks.length) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-[#d3bb73]"></div>
      </div>
    );
  }

  return (
    <div className={`mx-auto flex min-h-0 w-full max-w-[1400px] flex-col overflow-hidden ${inquiryId ? 'h-[650px] max-h-[80vh] min-h-[420px]' : 'h-full'}`}>
      <div
        className={`mb-3 flex flex-shrink-0 flex-wrap items-center justify-between gap-3 ${isMobile ? 'px-2' : 'px-2'}`}
      >
        {!isMobile && <h2 className="text-2xl font-light text-[#e5e4e2]">{employeeId ? 'Moje zadania' : inquiryId ? 'Działania sprzedażowe' : 'Zadania firmowe'}</h2>}

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
        className={`min-h-0 flex-1 overflow-y-hidden ${
          isMobile ? 'overflow-x-hidden pb-2' : 'overflow-x-auto pb-4'
        }`}
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
            <TaskColumn
              key={column.id}
              column={column}
              tasks={getTasksByColumn(column.id)}
              draggedTask={draggedTask}
              dragOverColumn={dragOverColumn}
              canManage={canManageTasks}
              canMove={canMoveTasks}
              canCreate={canCreateTasks}
              activeTimer={activeTimer}
              isMobile={isMobile}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onDragStart={handleDragStart}
              onDragEnd={() => {
                setDraggedTask(null);
                stopAutoScroll();
              }}
              onEdit={handleOpenModal}
              onDelete={handleDeleteTask}
              onStartTimer={handleStartTimer}
            />
          ))}
        </div>
      </div>

      {isMobile && (
        <div className="flex flex-shrink-0 justify-center gap-3 border-t border-[#d3bb73]/10 bg-[#0d0f17] px-2 py-3">
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
              <fieldset disabled={saving || Boolean(savedTaskId)} className="space-y-4">
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

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Załączniki</label>
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-[#d3bb73]/10 px-4 py-2 text-sm text-[#d3bb73] hover:bg-[#d3bb73]/20">
                  <input type="file" multiple onChange={handleAttachmentSelect} className="sr-only" disabled={saving || Boolean(savedTaskId)} />
                  <Paperclip className="h-4 w-4" /> Dodaj pliki
                </label>
                <p className="mt-2 text-xs text-[#e5e4e2]/60">Zdjęcia, PDF-y, dokumenty i inne pliki. Możesz wybrać kilka naraz.</p>
                <div className="mt-3 space-y-2">
                  {attachmentFiles.map((file, index) => (
                    <div key={`${file.name}-${file.lastModified}-${index}`} className="flex items-center gap-3 rounded-lg bg-[#e5e4e2]/5 p-2">
                      <TaskAttachmentPreview file={file} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-[#e5e4e2]" title={file.name}>{file.name}</p>
                        <p className="text-xs text-[#e5e4e2]/60">{(file.size / 1024).toLocaleString('pl-PL', { maximumFractionDigits: 1 })} KB</p>
                      </div>
                      <button type="button" disabled={saving || Boolean(savedTaskId)} onClick={() => setAttachmentFiles((previous) => previous.filter((_, i) => i !== index))} aria-label={`Usuń załącznik ${file.name}`} className="rounded p-2 text-red-400 hover:bg-red-500/10 disabled:opacity-50">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
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
                <SellerDatePicker
                  label="Termin wykonania"
                  value={formData.due_date}
                  onChange={(due_date) => setFormData((previous) => ({ ...previous, due_date }))}
                  onValidityChange={setDueDateValid}
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

              </fieldset>
              {savedTaskId && !saving && <p role="status" className="text-sm text-amber-300">Zadanie jest zapisane. Pozostałe pliki oczekują na ponowne przesłanie.</p>}
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="flex-1 rounded-lg bg-[#e5e4e2]/10 px-4 py-2 text-[#e5e4e2] transition-colors hover:bg-[#e5e4e2]/20"
                >
                  {savedTaskId ? 'Zamknij' : 'Anuluj'}
                </button>
                <button
                  type="submit"
                  disabled={saving || !dueDateValid}
                  className="flex-1 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:opacity-50"
                >
                  {saving ? 'Zapisywanie…' : savedTaskId ? 'Ponów przesyłanie' : editingTask ? 'Zapisz' : 'Utwórz'}
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
