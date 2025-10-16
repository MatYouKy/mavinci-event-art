'use client';

import { useState, useEffect } from 'react';
import { Plus, X, Trash2, CreditCard as Edit, Calendar, User } from 'lucide-react';
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
  event_id: string | null;
  created_at: string;
  updated_at: string;
  assignees?: Array<{
    employee: {
      id: string;
      name: string;
      surname: string;
      avatar_url: string | null;
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
  const { showSnackbar } = useSnackbar();

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

    const tasksChannel = supabase
      .channel(`event_tasks_${eventId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tasks',
          filter: `event_id=eq.${eventId}`,
        },
        () => {
          fetchTasks();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(tasksChannel);
    };
  }, [eventId]);

  const fetchTasks = async () => {
    try {
      setLoading(true);

      const { data, error} = await supabase
        .from('tasks')
        .select(`
          *,
          assignees:task_assignees(
            employee:employees!task_assignees_employee_id_fkey(
              id,
              name,
              surname,
              avatar_url
            )
          )
        `)
        .eq('event_id', eventId)
        .order('order_index', { ascending: true });

      if (error) throw error;

      setTasks(data || []);
    } catch (err) {
      console.error('Error fetching tasks:', err);
      showSnackbar('Błąd podczas pobierania zadań', 'error');
    } finally {
      setLoading(false);
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
        status: formData.board_column as 'todo' | 'in_progress' | 'review' | 'completed' | 'cancelled',
        due_date: formData.due_date || null,
        event_id: eventId,
        is_private: false,
        owner_id: null,
      };

      if (editingTask) {
        const { error } = await supabase
          .from('tasks')
          .update(taskData)
          .eq('id', editingTask.id);

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
      const { error } = await supabase
        .from('tasks')
        .delete()
        .eq('id', taskId);

      if (error) throw error;
      showSnackbar('Zadanie usunięte', 'success');
      await fetchTasks();
    } catch (err) {
      console.error('Error deleting task:', err);
      showSnackbar('Błąd podczas usuwania zadania', 'error');
    }
  };

  const handleMoveTask = async (taskId: string, newColumn: string) => {
    try {
      const { error } = await supabase
        .from('tasks')
        .update({
          board_column: newColumn,
          status: newColumn as 'todo' | 'in_progress' | 'review' | 'completed' | 'cancelled',
        })
        .eq('id', taskId);

      if (error) throw error;
      await fetchTasks();
    } catch (err) {
      console.error('Error moving task:', err);
      showSnackbar('Błąd podczas przenoszenia zadania', 'error');
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
            className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#d3bb73]/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Nowe zadanie
          </button>
        )}
      </div>

      <div className="overflow-x-auto pb-4">
        <div className="flex gap-4 min-w-max">
          {columns.map((column) => {
            const columnTasks = getColumnTasks(column.id);

            return (
              <div
                key={column.id}
                className={`bg-[#1c1f33] border rounded-xl p-4 ${column.color} w-80 flex-shrink-0`}
              >
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-medium text-[#e5e4e2]">{column.label}</h3>
                  <span className="text-xs text-[#e5e4e2]/60 bg-[#0f1119] px-2 py-1 rounded">
                    {columnTasks.length}
                  </span>
                </div>

                <div className="space-y-3 max-h-[calc(100vh-300px)] overflow-y-auto pr-2">
                  {columnTasks.map((task) => (
                    <div
                      key={task.id}
                      className="bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg p-3 hover:border-[#d3bb73]/30 transition-all group"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <h4 className="text-sm font-medium text-[#e5e4e2] flex-1">
                          {task.title}
                        </h4>
                        {canManage && (
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => handleOpenModal(task)}
                              className="text-[#d3bb73] hover:text-[#d3bb73]/80 transition-colors"
                            >
                              <Edit className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDelete(task.id)}
                              className="text-red-400 hover:text-red-300 transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                      </div>

                      {task.description && (
                        <p className="text-xs text-[#e5e4e2]/60 mb-2 line-clamp-2">
                          {task.description}
                        </p>
                      )}

                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs px-2 py-1 rounded ${priorityColors[task.priority]}`}>
                          {priorityLabels[task.priority]}
                        </span>

                        {task.due_date && (
                          <span className="text-xs text-[#e5e4e2]/60 flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {new Date(task.due_date).toLocaleDateString('pl-PL')}
                          </span>
                        )}

                        {task.assignees && task.assignees.length > 0 && (
                          <div className="flex items-center gap-1">
                            <User className="w-3 h-3 text-[#e5e4e2]/60" />
                            <span className="text-xs text-[#e5e4e2]/60">
                              {task.assignees.length}
                            </span>
                          </div>
                        )}
                      </div>

                      {canManage && column.id !== 'completed' && (
                        <div className="mt-3 pt-3 border-t border-[#d3bb73]/10">
                          <select
                            value={task.board_column}
                            onChange={(e) => handleMoveTask(task.id, e.target.value)}
                            className="w-full text-xs bg-[#1c1f33] border border-[#d3bb73]/20 rounded px-2 py-1 text-[#e5e4e2] focus:outline-none focus:ring-1 focus:ring-[#d3bb73]"
                          >
                            {columns.map((col) => (
                              <option key={col.id} value={col.id}>
                                Przenieś do: {col.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  ))}

                  {columnTasks.length === 0 && (
                    <div className="text-center py-8 text-[#e5e4e2]/40 text-sm">
                      Brak zadań
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#1c1f33] rounded-xl p-6 max-w-md w-full border border-[#d3bb73]/20">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-medium text-[#e5e4e2]">
                {editingTask ? 'Edytuj zadanie' : 'Nowe zadanie'}
              </h3>
              <button
                onClick={handleCloseModal}
                className="text-[#e5e4e2]/60 hover:text-[#e5e4e2] transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[#e5e4e2]/80 mb-2">
                  Tytuł *
                </label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="w-full px-3 py-2 bg-[#0f1119] border border-[#d3bb73]/30 rounded-lg text-[#e5e4e2] focus:outline-none focus:ring-2 focus:ring-[#d3bb73]/50"
                  placeholder="Nazwa zadania"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[#e5e4e2]/80 mb-2">
                  Opis
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-3 py-2 bg-[#0f1119] border border-[#d3bb73]/30 rounded-lg text-[#e5e4e2] focus:outline-none focus:ring-2 focus:ring-[#d3bb73]/50 resize-none"
                  rows={3}
                  placeholder="Szczegóły zadania"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[#e5e4e2]/80 mb-2">
                  Priorytet
                </label>
                <select
                  value={formData.priority}
                  onChange={(e) => setFormData({ ...formData, priority: e.target.value as any })}
                  className="w-full px-3 py-2 bg-[#0f1119] border border-[#d3bb73]/30 rounded-lg text-[#e5e4e2] focus:outline-none focus:ring-2 focus:ring-[#d3bb73]/50"
                >
                  <option value="low">Niski</option>
                  <option value="medium">Średni</option>
                  <option value="high">Wysoki</option>
                  <option value="urgent">Pilne</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-[#e5e4e2]/80 mb-2">
                  Kolumna
                </label>
                <select
                  value={formData.board_column}
                  onChange={(e) => setFormData({ ...formData, board_column: e.target.value })}
                  className="w-full px-3 py-2 bg-[#0f1119] border border-[#d3bb73]/30 rounded-lg text-[#e5e4e2] focus:outline-none focus:ring-2 focus:ring-[#d3bb73]/50"
                >
                  {columns.map((col) => (
                    <option key={col.id} value={col.id}>
                      {col.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-[#e5e4e2]/80 mb-2">
                  Termin
                </label>
                <input
                  type="date"
                  value={formData.due_date}
                  onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
                  className="w-full px-3 py-2 bg-[#0f1119] border border-[#d3bb73]/30 rounded-lg text-[#e5e4e2] focus:outline-none focus:ring-2 focus:ring-[#d3bb73]/50"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="flex-1 px-4 py-2 bg-[#0f1119] text-[#e5e4e2] rounded-lg hover:bg-[#0f1119]/80 transition-colors"
                >
                  Anuluj
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors font-medium"
                >
                  {editingTask ? 'Zapisz' : 'Dodaj'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
