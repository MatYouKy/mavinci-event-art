'use client';

import { useState, useEffect, useRef } from 'react';
import { Plus, X, Trash2, Edit, GripVertical, Calendar } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';

interface Task {
  id: string;
  title: string;
  description: string | null;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'todo' | 'in_progress' | 'review' | 'completed' | 'cancelled';
  board_column: string;
  order_index: number;
  due_date: string | null;
  is_private: boolean;
  owner_id: string | null;
  created_at: string;
  updated_at: string;
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
  }, [employeeId]);

  const fetchTasks = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .eq('is_private', true)
        .eq('owner_id', employeeId)
        .order('order_index', { ascending: true });

      if (error) throw error;
      setTasks(data || []);
    } catch (error) {
      console.error('Error fetching private tasks:', error);
      showSnackbar('Błąd podczas ładowania zadań', 'error');
    } finally {
      setLoading(false);
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
        .update({ board_column: columnId })
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

  const handleOpenModal = (task?: Task) => {
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
        board_column: 'todo',
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
        const { error } = await supabase
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
          });

        if (error) throw error;
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
    if (!confirm('Czy na pewno chcesz usunąć to zadanie?')) return;

    try {
      const { error } = await supabase
        .from('tasks')
        .delete()
        .eq('id', taskId);

      if (error) throw error;

      fetchTasks();
      showSnackbar('Zadanie zostało usunięte', 'success');
    } catch (error) {
      console.error('Error deleting task:', error);
      showSnackbar('Błąd podczas usuwania zadania', 'error');
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

  if (!isOwnProfile) {
    return (
      <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
        <p className="text-[#e5e4e2]/60 text-center">
          Tablica prywatnych zadań jest widoczna tylko dla właściciela.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-4 px-2">
        <h3 className="text-lg font-light text-[#e5e4e2]">Moja tablica zadań</h3>
        <button
          onClick={() => handleOpenModal()}
          className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#d3bb73]/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Nowe zadanie
        </button>
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
              style={{ width: '320px', maxHeight: 'calc(100vh - 400px)' }}
            >
              <div className="flex items-center justify-between mb-4 flex-shrink-0">
                <h3 className="font-medium text-[#e5e4e2]">{column.label}</h3>
                <span className="text-sm text-[#e5e4e2]/60">
                  {getTasksByColumn(column.id).length}
                </span>
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
                    className={`bg-[#0f1119] border rounded-lg p-4 cursor-move transition-all group ${
                      draggedTask?.id === task.id
                        ? 'opacity-50 border-[#d3bb73]/50'
                        : 'border-[#d3bb73]/10 hover:border-[#d3bb73]/30'
                    }`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-start gap-2 flex-1">
                        <GripVertical className="w-4 h-4 text-[#e5e4e2]/40 mt-1 flex-shrink-0" />
                        <h4 className="text-sm font-medium text-[#e5e4e2] flex-1">
                          {task.title}
                        </h4>
                      </div>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => handleOpenModal(task)}
                          className="p-1 text-[#d3bb73] hover:bg-[#d3bb73]/10 rounded"
                        >
                          <Edit className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => handleDeleteTask(task.id)}
                          className="p-1 text-red-400 hover:bg-red-500/10 rounded"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>

                    {task.description && (
                      <p className="text-xs text-[#e5e4e2]/60 mb-2 line-clamp-2">
                        {task.description}
                      </p>
                    )}

                    <div className="flex items-center gap-2 mb-2">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] border ${
                          priorityColors[task.priority]
                        }`}
                      >
                        {priorityLabels[task.priority]}
                      </span>
                      {task.due_date && (
                        <div className="flex items-center gap-1 text-[10px] text-[#e5e4e2]/40">
                          <Calendar className="w-3 h-3" />
                          {new Date(task.due_date).toLocaleDateString('pl-PL')}
                        </div>
                      )}
                    </div>
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
                <label className="block text-sm text-[#e5e4e2]/80 mb-2">Tytuł</label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="w-full px-4 py-2 bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                  required
                />
              </div>

              <div>
                <label className="block text-sm text-[#e5e4e2]/80 mb-2">Opis</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-4 py-2 bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73] min-h-[100px]"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-[#e5e4e2]/80 mb-2">Priorytet</label>
                  <select
                    value={formData.priority}
                    onChange={(e) => setFormData({ ...formData, priority: e.target.value as any })}
                    className="w-full px-4 py-2 bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                  >
                    <option value="low">Niski</option>
                    <option value="medium">Średni</option>
                    <option value="high">Wysoki</option>
                    <option value="urgent">Pilne</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm text-[#e5e4e2]/80 mb-2">Kolumna</label>
                  <select
                    value={formData.board_column}
                    onChange={(e) => setFormData({ ...formData, board_column: e.target.value })}
                    className="w-full px-4 py-2 bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                  >
                    {columns.map(col => (
                      <option key={col.id} value={col.id}>{col.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm text-[#e5e4e2]/80 mb-2">Termin</label>
                <input
                  type="date"
                  value={formData.due_date}
                  onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
                  className="w-full px-4 py-2 bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                />
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
    </div>
  );
}
