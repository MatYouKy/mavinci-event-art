'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
  ArrowLeft,
  Calendar,
  User,
  Paperclip,
  Send,
  Download,
  Trash2,
  Link as LinkIcon,
  ExternalLink,
  File,
  UserMinus,
  Edit3,
  Save,
  X,
  UserPlus,
  Image as ImageIcon,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { EmployeeAvatar } from '@/components/EmployeeAvatar';
import TaskAssigneeAvatars from '@/components/crm/TaskAssigneeAvatars';
import LinkEventFileModal from '@/components/crm/LinkEventFileModal';

interface Task {
  id: string;
  title: string;
  description: string | null;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: string;
  board_column: string;
  due_date: string | null;
  event_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  thumbnail_url: string | null;
  task_assignees: {
    employee_id: string;
    employees: {
      name: string;
      surname: string;
      avatar_url: string | null;
      avatar_metadata?: any;
    };
  }[];
  creator?: {
    name: string;
    surname: string;
    avatar_url: string | null;
    avatar_metadata?: any;
  };
}

interface Employee {
  id: string;
  name: string;
  surname: string;
  avatar_url: string | null;
  avatar_metadata?: any;
}

interface Comment {
  id: string;
  task_id: string;
  employee_id: string;
  content: string;
  created_at: string;
  employees: {
    name: string;
    surname: string;
    avatar_url: string | null;
    avatar_metadata?: any;
  };
}

interface Attachment {
  id: string;
  task_id: string;
  event_file_id: string | null;
  is_linked: boolean;
  file_name: string;
  file_url: string | null;
  file_type: string;
  file_size: number;
  uploaded_by: string;
  created_at: string;
  employees: {
    name: string;
    surname: string;
    avatar_url: string | null;
    avatar_metadata?: any;
  };
}

interface ChatItem {
  id: string;
  type: 'comment' | 'attachment';
  created_at: string;
  employee_id: string;
  employee: {
    name: string;
    surname: string;
    avatar_url: string | null;
    avatar_metadata?: any;
  };
  content?: string;
  attachment?: Attachment;
}

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

export default function TaskDetailPage() {
  const router = useRouter();
  const params = useParams();
  const taskId = params.id as string;
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const { currentEmployee } = useCurrentEmployee();

  const [task, setTask] = useState<Task | null>(null);
  const [chatItems, setChatItems] = useState<ChatItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [newComment, setNewComment] = useState('');
  const [uploadingFile, setUploadingFile] = useState(false);
  const [showLinkFileModal, setShowLinkFileModal] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedTask, setEditedTask] = useState<Partial<Task>>({});
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [availableEmployees, setAvailableEmployees] = useState<Employee[]>([]);
  const [uploadingThumbnail, setUploadingThumbnail] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (taskId) {
      fetchTask();
      fetchChatItems();
      fetchAvailableEmployees();

      const commentsChannel = supabase
        .channel('task_comments_changes')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'task_comments',
            filter: `task_id=eq.${taskId}`,
          },
          () => {
            fetchChatItems();
          },
        )
        .subscribe();

      const attachmentsChannel = supabase
        .channel('task_attachments_changes')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'task_attachments',
            filter: `task_id=eq.${taskId}`,
          },
          () => {
            fetchChatItems();
          },
        )
        .subscribe();

      return () => {
        supabase.removeChannel(commentsChannel);
        supabase.removeChannel(attachmentsChannel);
      };
    }
  }, [taskId]);

  useEffect(() => {
    scrollToBottom();
  }, [chatItems]);

  const scrollToBottom = () => {
    setTimeout(() => {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  const fetchTask = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase.from('tasks').select('*').eq('id', taskId).single();

      if (error) throw error;

      const { data: assignees } = await supabase
        .from('task_assignees')
        .select('employee_id')
        .eq('task_id', taskId);

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

      let creator = null;
      if (data.created_by) {
        const { data: creatorData } = await supabase
          .from('employees')
          .select('name, surname, avatar_url, avatar_metadata')
          .eq('id', data.created_by)
          .maybeSingle();
        creator = creatorData;
      }

      setTask({
        ...data,
        task_assignees: assigneesWithEmployees,
        creator,
      });
    } catch (error) {
      console.error('Error fetching task:', error);
      showSnackbar('Błąd podczas ładowania zadania', 'error');
    } finally {
      setLoading(false);
    }
  };

  const fetchChatItems = async () => {
    try {
      const { data: commentsData } = await supabase
        .from('task_comments')
        .select('*, employees:employee_id(name, surname, avatar_url, avatar_metadata)')
        .eq('task_id', taskId)
        .order('created_at', { ascending: true });

      const { data: attachmentsData } = await supabase
        .from('task_attachments')
        .select('*, employees:uploaded_by(name, surname, avatar_url, avatar_metadata)')
        .eq('task_id', taskId)
        .order('created_at', { ascending: true });

      const comments: ChatItem[] = (commentsData || []).map((c) => ({
        id: c.id,
        type: 'comment' as const,
        created_at: c.created_at,
        employee_id: c.employee_id,
        employee: c.employees,
        content: c.content,
      }));

      const attachments: ChatItem[] = (attachmentsData || []).map((a) => ({
        id: a.id,
        type: 'attachment' as const,
        created_at: a.created_at,
        employee_id: a.uploaded_by,
        employee: a.employees,
        attachment: a,
      }));

      const allItems = [...comments, ...attachments].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );

      setChatItems(allItems);
    } catch (error) {
      console.error('Error fetching chat items:', error);
    }
  };

  const handleSendComment = async () => {
    if (!newComment.trim() || !currentEmployee) return;

    try {
      const { error } = await supabase.from('task_comments').insert({
        task_id: taskId,
        employee_id: currentEmployee.id,
        content: newComment.trim(),
      });

      if (error) throw error;

      setNewComment('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    } catch (error) {
      console.error('Error adding comment:', error);
      showSnackbar('Błąd podczas dodawania komentarza', 'error');
    }
  };

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0 || !currentEmployee) return;

    try {
      setUploadingFile(true);

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fileExt = file.name.split('.').pop();
        const fileName = `${Math.random()}.${fileExt}`;
        const filePath = `task-attachments/${taskId}/${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from('event-files')
          .upload(filePath, file);

        if (uploadError) throw uploadError;

        const {
          data: { publicUrl },
        } = supabase.storage.from('event-files').getPublicUrl(filePath);

        const { error: dbError } = await supabase.from('task_attachments').insert({
          task_id: taskId,
          file_name: file.name,
          file_url: publicUrl,
          file_type: file.type,
          file_size: file.size,
          uploaded_by: currentEmployee.id,
        });

        if (dbError) throw dbError;
      }

      showSnackbar(`Dodano ${files.length} plik(ów)`, 'success');
    } catch (error) {
      console.error('Error uploading file:', error);
      showSnackbar('Błąd podczas przesyłania pliku', 'error');
    } finally {
      setUploadingFile(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    const confirmed = await showConfirm(
      'Czy na pewno chcesz usunąć ten komentarz?',
      'Usuń komentarz',
    );

    if (!confirmed) return;

    try {
      const { error } = await supabase.from('task_comments').delete().eq('id', commentId);

      if (error) throw error;

      showSnackbar('Komentarz został usunięty', 'success');
    } catch (error) {
      console.error('Error deleting comment:', error);
      showSnackbar('Błąd podczas usuwania komentarza', 'error');
    }
  };

  const handleDeleteAttachment = async (
    attachmentId: string,
    fileUrl: string | null,
    isLinked: boolean,
  ) => {
    const confirmed = await showConfirm(
      isLinked
        ? 'Czy na pewno chcesz odlinkować ten plik?'
        : 'Czy na pewno chcesz usunąć ten plik?',
      isLinked ? 'Odlinkuj plik' : 'Usuń plik',
    );

    if (!confirmed) return;

    try {
      if (!isLinked && fileUrl) {
        const filePath = fileUrl.split('/event-files/')[1];
        if (filePath) {
          await supabase.storage.from('event-files').remove([filePath]);
        }
      }

      const { error } = await supabase.from('task_attachments').delete().eq('id', attachmentId);

      if (error) throw error;

      showSnackbar(isLinked ? 'Plik został odlinkowany' : 'Plik został usunięty', 'success');
    } catch (error) {
      console.error('Error deleting attachment:', error);
      showSnackbar('Błąd podczas usuwania pliku', 'error');
    }
  };

  const handleUnassignSelf = async () => {
    if (!currentEmployee) return;

    const confirmed = await showConfirm(
      'Czy na pewno chcesz wypisać się z tego zadania?',
      'Wypisz się',
    );

    if (!confirmed) return;

    try {
      const { error } = await supabase
        .from('task_assignees')
        .delete()
        .eq('task_id', taskId)
        .eq('employee_id', currentEmployee.id);

      if (error) throw error;

      showSnackbar('Wypisano z zadania', 'success');
      fetchTask();
    } catch (error) {
      console.error('Error unassigning:', error);
      showSnackbar('Błąd podczas wypisywania się', 'error');
    }
  };

  const fetchAvailableEmployees = async () => {
    try {
      const { data, error } = await supabase
        .from('employees')
        .select('id, name, surname, avatar_url, avatar_metadata')
        .order('name');

      if (error) throw error;
      setAvailableEmployees(data || []);
    } catch (error) {
      console.error('Error fetching employees:', error);
    }
  };

  const handleStartEdit = () => {
    if (!task) return;
    setEditedTask({
      title: task.title,
      description: task.description,
      priority: task.priority,
      due_date: task.due_date,
    });
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditedTask({});
  };

  const handleSaveEdit = async () => {
    if (!task || !editedTask.title?.trim()) {
      showSnackbar('Tytuł zadania jest wymagany', 'warning');
      return;
    }

    try {
      const { error } = await supabase
        .from('tasks')
        .update({
          title: editedTask.title,
          description: editedTask.description || null,
          priority: editedTask.priority,
          due_date: editedTask.due_date || null,
        })
        .eq('id', taskId);

      if (error) throw error;

      showSnackbar('Zadanie zaktualizowane', 'success');
      setIsEditing(false);
      fetchTask();
    } catch (error) {
      console.error('Error updating task:', error);
      showSnackbar('Błąd podczas aktualizacji zadania', 'error');
    }
  };

  const handleAddAssignee = async (employeeId: string) => {
    try {
      const { error } = await supabase.from('task_assignees').insert({
        task_id: taskId,
        employee_id: employeeId,
      });

      if (error) throw error;

      showSnackbar('Dodano osobę do zadania', 'success');
      fetchTask();
    } catch (error: any) {
      if (error?.code === '23505') {
        showSnackbar('Ta osoba jest już przypisana do zadania', 'info');
      } else {
        console.error('Error adding assignee:', error);
        showSnackbar('Błąd podczas dodawania osoby', 'error');
      }
    }
  };

  const handleRemoveAssignee = async (employeeId: string) => {
    const confirmed = await showConfirm(
      'Czy na pewno chcesz usunąć tę osobę z zadania?',
      'Usuń przypisanie',
    );

    if (!confirmed) return;

    try {
      const { error } = await supabase
        .from('task_assignees')
        .delete()
        .eq('task_id', taskId)
        .eq('employee_id', employeeId);

      if (error) throw error;

      showSnackbar('Usunięto osobę z zadania', 'success');
      fetchTask();
    } catch (error) {
      console.error('Error removing assignee:', error);
      showSnackbar('Błąd podczas usuwania osoby', 'error');
    }
  };

  const handleThumbnailUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentEmployee) return;

    try {
      setUploadingThumbnail(true);

      const fileExt = file.name.split('.').pop();
      const fileName = `${Math.random()}.${fileExt}`;
      const filePath = `task-thumbnails/${taskId}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('event-files')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const {
        data: { publicUrl },
      } = supabase.storage.from('event-files').getPublicUrl(filePath);

      const { error: updateError } = await supabase
        .from('tasks')
        .update({ thumbnail_url: publicUrl })
        .eq('id', taskId);

      if (updateError) throw updateError;

      showSnackbar('Zdjęcie zostało dodane', 'success');
      fetchTask();
    } catch (error) {
      console.error('Error uploading thumbnail:', error);
      showSnackbar('Błąd podczas przesyłania zdjęcia', 'error');
    } finally {
      setUploadingThumbnail(false);
    }
  };

  const handleRemoveThumbnail = async () => {
    if (!task?.thumbnail_url) return;

    const confirmed = await showConfirm('Czy na pewno chcesz usunąć zdjęcie?', 'Usuń zdjęcie');

    if (!confirmed) return;

    try {
      const filePath = task.thumbnail_url.split('/event-files/')[1];
      if (filePath) {
        await supabase.storage.from('event-files').remove([filePath]);
      }

      const { error } = await supabase
        .from('tasks')
        .update({ thumbnail_url: null })
        .eq('id', taskId);

      if (error) throw error;

      showSnackbar('Zdjęcie zostało usunięte', 'success');
      fetchTask();
    } catch (error) {
      console.error('Error removing thumbnail:', error);
      showSnackbar('Błąd podczas usuwania zdjęcia', 'error');
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileUpload(files);
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setNewComment(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = e.target.scrollHeight + 'px';
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendComment();
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const isImage = (fileType: string) => {
    return fileType.startsWith('image/');
  };

  const canDeleteComment = (commentEmployeeId: string) => {
    if (!currentEmployee) return false;

    return (
      currentEmployee.id === commentEmployeeId ||
      currentEmployee.role === 'admin' ||
      currentEmployee.permissions?.includes('tasks_manage') ||
      task?.created_by === currentEmployee.id
    );
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0a0d1a]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#d3bb73] border-t-transparent" />
      </div>
    );
  }

  if (!task) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0a0d1a]">
        <p className="text-[#e5e4e2]/60">Nie znaleziono zadania</p>
      </div>
    );
  }

  return (
    <div className="bg-[#0a0d1a]">
      {/* Header - Sticky */}
      <div className="sticky top-0 z-10 border-b border-[#d3bb73]/10 bg-[#0f1119]">
        <div className="flex items-center gap-4 p-4">
          <button
            onClick={() => router.back()}
            className="rounded-lg p-2 transition-colors hover:bg-[#d3bb73]/10"
          >
            <ArrowLeft className="h-5 w-5 text-[#e5e4e2]" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold text-[#e5e4e2]">Szczegóły zadania</h1>
          </div>
          {!isEditing && (
            <button
              onClick={handleStartEdit}
              className="flex items-center gap-2 rounded-lg bg-[#d3bb73]/10 px-4 py-2 text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/20"
            >
              <Edit3 className="h-4 w-4" />
              Edytuj
            </button>
          )}
        </div>
      </div>

      {/* Task Details Section - Scrollable */}
      <div className="max-h-[60vh] flex-shrink-0 overflow-y-auto border-b-4 border-[#d3bb73]/20 bg-[#0f1119]">
        <div className="space-y-6 p-6">
          {isEditing ? (
            <>
              {/* Edit Mode */}
              <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-sm font-medium text-[#e5e4e2]/60">
                    Tytuł zadania *
                  </label>
                  <input
                    type="text"
                    value={editedTask.title || ''}
                    onChange={(e) => setEditedTask({ ...editedTask, title: e.target.value })}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1a1d2e] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-[#e5e4e2]/60">Opis</label>
                  <textarea
                    value={editedTask.description || ''}
                    onChange={(e) => setEditedTask({ ...editedTask, description: e.target.value })}
                    rows={4}
                    className="w-full resize-none rounded-lg border border-[#d3bb73]/20 bg-[#1a1d2e] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                  />
                </div>

                {/* Thumbnail in Edit Mode */}
                <div>
                  <label className="mb-2 block text-sm font-medium text-[#e5e4e2]/60">
                    Zdjęcie
                  </label>
                  {task.thumbnail_url ? (
                    <div className="group relative inline-block">
                      <img
                        src={task.thumbnail_url}
                        alt="Task thumbnail"
                        className="h-32 w-48 rounded-lg border-2 border-[#d3bb73]/20 object-cover"
                      />
                      <button
                        onClick={handleRemoveThumbnail}
                        className="absolute right-2 top-2 rounded-lg bg-red-500/90 p-1.5 opacity-0 transition-opacity hover:bg-red-500 group-hover:opacity-100"
                      >
                        <Trash2 className="h-4 w-4 text-white" />
                      </button>
                    </div>
                  ) : (
                    <label className="flex h-32 w-48 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-[#d3bb73]/30 transition-colors hover:bg-[#d3bb73]/5">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleThumbnailUpload}
                        className="hidden"
                        disabled={uploadingThumbnail}
                      />
                      <ImageIcon className="mb-2 h-8 w-8 text-[#d3bb73]/50" />
                      <span className="text-xs text-[#e5e4e2]/50">
                        {uploadingThumbnail ? 'Przesyłanie...' : 'Dodaj zdjęcie'}
                      </span>
                    </label>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-[#e5e4e2]/60">
                      Priorytet
                    </label>
                    <select
                      value={editedTask.priority || 'medium'}
                      onChange={(e) =>
                        setEditedTask({ ...editedTask, priority: e.target.value as any })
                      }
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1a1d2e] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                    >
                      <option value="low">Niski</option>
                      <option value="medium">Średni</option>
                      <option value="high">Wysoki</option>
                      <option value="urgent">Pilne</option>
                    </select>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-[#e5e4e2]/60">
                      Termin
                    </label>
                    <input
                      type="date"
                      value={editedTask.due_date ? editedTask.due_date.split('T')[0] : ''}
                      onChange={(e) => setEditedTask({ ...editedTask, due_date: e.target.value })}
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1a1d2e] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="flex gap-3 border-t border-[#d3bb73]/10 pt-4">
                  <button
                    onClick={handleSaveEdit}
                    className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 font-medium text-[#0a0d1a] transition-colors hover:bg-[#c4ac64]"
                  >
                    <Save className="h-4 w-4" />
                    Zapisz
                  </button>
                  <button
                    onClick={handleCancelEdit}
                    className="flex items-center gap-2 rounded-lg bg-[#e5e4e2]/10 px-4 py-2 text-[#e5e4e2] transition-colors hover:bg-[#e5e4e2]/20"
                  >
                    <X className="h-4 w-4" />
                    Anuluj
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              {/* View Mode */}
              <div className="space-y-4">
                <h2 className="text-2xl font-bold text-[#e5e4e2]">{task.title}</h2>

                {task.description && (
                  <div>
                    <h3 className="mb-2 text-sm font-medium text-[#e5e4e2]/60">Opis</h3>
                    <p className="whitespace-pre-wrap text-sm text-[#e5e4e2]/80">
                      {task.description}
                    </p>
                  </div>
                )}

                {task.thumbnail_url && (
                  <div>
                    <img
                      src={task.thumbnail_url}
                      alt="Task thumbnail"
                      className="h-32 w-48 rounded-lg border-2 border-[#d3bb73]/20 object-cover"
                    />
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-4">
                  {task.creator && (
                    <div className="flex items-center gap-2">
                      <User className="h-4 w-4 text-[#e5e4e2]/60" />
                      <span className="text-sm text-[#e5e4e2]/60">Autor:</span>
                      <span className="text-sm text-[#e5e4e2]">
                        {task.creator.name} {task.creator.surname}
                      </span>
                    </div>
                  )}
                  <span
                    className={`rounded-full px-3 py-1 text-xs ${priorityColors[task.priority]}`}
                  >
                    {priorityLabels[task.priority]}
                  </span>
                  {task.due_date && (
                    <div className="flex items-center gap-2 text-sm text-[#e5e4e2]/60">
                      <Calendar className="h-4 w-4" />
                      {new Date(task.due_date).toLocaleDateString('pl-PL')}
                    </div>
                  )}
                </div>

                {/* Assignees - Only Avatars */}
                <div>
                  <h3 className="mb-3 text-sm font-medium text-[#e5e4e2]/60">Przypisane osoby</h3>
                  <div className="flex items-center -space-x-2">
                    {task.task_assignees.map((assignee) => (
                      <div
                        key={assignee.employee_id}
                        className="group relative"
                        title={`${assignee.employees.name} ${assignee.employees.surname}`}
                      >
                        <EmployeeAvatar
                          employee={{
                            avatar_url: assignee.employees.avatar_url,
                            avatar_metadata: assignee.employees.avatar_metadata,
                            name: assignee.employees.name,
                            surname: assignee.employees.surname,
                          }}
                          size={40}
                        />
                        {(task.created_by === currentEmployee?.id ||
                          currentEmployee?.id === assignee.employee_id) && (
                          <button
                            onClick={() => handleRemoveAssignee(assignee.employee_id)}
                            className="absolute -right-1 -top-1 z-10 rounded-full bg-red-500 p-1 opacity-0 shadow-lg transition-opacity hover:bg-red-600 group-hover:opacity-100"
                            title="Usuń"
                          >
                            <X className="h-3 w-3 text-white" />
                          </button>
                        )}
                      </div>
                    ))}
                    <button
                      onClick={() => setShowAssignModal(true)}
                      className="ml-2 flex h-10 w-10 items-center justify-center rounded-full border-2 border-[#d3bb73]/40 bg-[#d3bb73]/20 transition-colors hover:bg-[#d3bb73]/30"
                      title="Dodaj osobę"
                    >
                      <UserPlus className="h-5 w-5 text-[#d3bb73]" />
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Chat Area */}
      <div className="border-b-4 border-[#d3bb73]/20 bg-[#0f1119]">
        <div
          className="space-y-4 overflow-y-auto p-6"
          style={{
            minHeight: chatItems.length === 0 ? '200px' : '200px',
            maxHeight: '500px',
          }}
        >
          {chatItems.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-[#e5e4e2]/40">
              <p className="text-sm">Brak wiadomości. Rozpocznij konwersację.</p>
            </div>
          ) : (
            chatItems.map((item) => (
              <div key={item.id} className="flex gap-3">
                <EmployeeAvatar
                  employee={{
                    avatar_url: item.employee.avatar_url,
                    avatar_metadata: item.employee.avatar_metadata,
                    name: item.employee.name,
                    surname: item.employee.surname,
                  }}
                  size={40}
                  className="flex-shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="text-sm font-medium text-[#e5e4e2]">
                      {item.employee.name} {item.employee.surname}
                    </span>
                    <span className="text-xs text-[#e5e4e2]/40">
                      {new Date(item.created_at).toLocaleString('pl-PL')}
                    </span>
                  </div>

                  {item.type === 'comment' && (
                    <div className="group rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-3">
                      <div className="flex items-start gap-2">
                        <p className="flex-1 whitespace-pre-wrap text-sm text-[#e5e4e2]">
                          {item.content}
                        </p>
                        {canDeleteComment(item.employee_id) && (
                          <button
                            onClick={() => handleDeleteComment(item.id)}
                            className="flex-shrink-0 rounded-lg p-1.5 opacity-0 transition-opacity hover:bg-red-500/10 group-hover:opacity-100"
                            title="Usuń komentarz"
                          >
                            <Trash2 className="h-3.5 w-3.5 text-red-400" />
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {item.type === 'attachment' && item.attachment && (
                    <div className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-3">
                      <div className="flex items-center gap-3">
                        {isImage(item.attachment.file_type) && item.attachment.file_url ? (
                          <img
                            src={item.attachment.file_url}
                            alt={item.attachment.file_name}
                            className="h-32 w-48 rounded-lg object-cover"
                          />
                        ) : (
                          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[#d3bb73]/10">
                            <File className="h-6 w-6 text-[#d3bb73]" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="mb-1 flex items-center gap-2">
                            <p className="truncate text-sm font-medium text-[#e5e4e2]">
                              {item.attachment.file_name}
                            </p>
                            {item.attachment.is_linked && (
                              <ExternalLink className="h-3 w-3 flex-shrink-0 text-blue-400" />
                            )}
                          </div>
                          <p className="text-xs text-[#e5e4e2]/60">
                            {formatFileSize(item.attachment.file_size)}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          {item.attachment.file_url && (
                            <a
                              href={item.attachment.file_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="rounded-lg p-2 transition-colors hover:bg-[#d3bb73]/10"
                              title="Pobierz"
                            >
                              <Download className="h-4 w-4 text-[#d3bb73]" />
                            </a>
                          )}
                          <button
                            onClick={() =>
                              handleDeleteAttachment(
                                item.attachment!.id,
                                item.attachment!.file_url,
                                item.attachment!.is_linked,
                              )
                            }
                            className="rounded-lg p-2 transition-colors hover:bg-red-500/10"
                            title={item.attachment.is_linked ? 'Odlinkuj' : 'Usuń'}
                          >
                            <Trash2 className="h-4 w-4 text-red-400" />
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Input Area */}
        <div
          className="relative border-t border-[#d3bb73]/10 bg-[#0f1119] p-4"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {isDragging && (
            <div className="absolute inset-0 z-50 flex items-center justify-center rounded-lg border-2 border-dashed border-[#d3bb73] bg-[#d3bb73]/10">
              <div className="text-center">
                <Paperclip className="mx-auto mb-2 h-12 w-12 text-[#d3bb73]" />
                <p className="font-medium text-[#d3bb73]">Upuść pliki tutaj</p>
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={(e) => handleFileUpload(e.target.files)}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingFile}
              className="rounded-lg p-3 transition-colors hover:bg-[#d3bb73]/10 disabled:opacity-50"
              title="Dodaj plik"
            >
              <Paperclip className="h-5 w-5 text-[#e5e4e2]/60" />
            </button>
            {task.event_id && (
              <button
                onClick={() => setShowLinkFileModal(true)}
                className="rounded-lg p-3 transition-colors hover:bg-[#d3bb73]/10"
                title="Dodaj z wydarzenia"
              >
                <LinkIcon className="h-5 w-5 text-blue-400" />
              </button>
            )}
            <textarea
              ref={textareaRef}
              value={newComment}
              onChange={handleTextareaChange}
              onKeyDown={handleKeyDown}
              placeholder="Napisz wiadomość... (Shift+Enter dla nowej linii)"
              className="max-h-[200px] min-h-[48px] flex-1 resize-none rounded-lg border border-[#d3bb73]/20 bg-[#1a1d2e] px-4 py-3 text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:border-[#d3bb73]/50 focus:outline-none"
              rows={1}
            />
            <button
              onClick={handleSendComment}
              disabled={!newComment.trim() || uploadingFile}
              className="rounded-lg bg-[#d3bb73] px-6 py-3 font-medium text-[#0f1119] transition-colors hover:bg-[#d3bb73]/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send className="h-5 w-5" />
            </button>
          </div>
          <p className="mt-2 px-6 pb-4 text-xs text-[#e5e4e2]/40">
            Przeciągnij i upuść pliki lub zdjęcia aby je dodać
          </p>
        </div>
      </div>

      {/* Link Event File Modal */}
      {task.event_id && (
        <LinkEventFileModal
          isOpen={showLinkFileModal}
          onClose={() => setShowLinkFileModal(false)}
          taskId={taskId}
          eventId={task.event_id}
          onFileLinked={fetchChatItems}
        />
      )}

      {/* Assign Employee Modal */}
      {showAssignModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-lg bg-[#0f1119]">
            <div className="flex items-center justify-between border-b border-[#d3bb73]/10 p-4">
              <h3 className="text-lg font-semibold text-[#e5e4e2]">Przypisz osobę</h3>
              <button
                onClick={() => setShowAssignModal(false)}
                className="rounded-lg p-2 transition-colors hover:bg-[#d3bb73]/10"
              >
                <X className="h-5 w-5 text-[#e5e4e2]" />
              </button>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto p-4">
              {availableEmployees
                .filter((emp) => !task.task_assignees.some((a) => a.employee_id === emp.id))
                .map((employee) => (
                  <button
                    key={employee.id}
                    onClick={() => {
                      handleAddAssignee(employee.id);
                      setShowAssignModal(false);
                    }}
                    className="flex w-full items-center gap-3 rounded-lg bg-[#1a1d2e] p-3 transition-colors hover:bg-[#1a1d2e]/80"
                  >
                    <EmployeeAvatar employee={employee} size={32} />
                    <span className="text-sm text-[#e5e4e2]">
                      {employee.name} {employee.surname}
                    </span>
                  </button>
                ))}
              {availableEmployees.filter(
                (emp) => !task.task_assignees.some((a) => a.employee_id === emp.id),
              ).length === 0 && (
                <p className="py-8 text-center text-sm text-[#e5e4e2]/60">
                  Wszyscy dostępni pracownicy są już przypisani do tego zadania
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
