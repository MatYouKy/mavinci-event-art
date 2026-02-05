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
  CreditCard as Edit3,
  Save,
  X,
  UserPlus,
  Image as ImageIcon,
  FileText,
  ZoomIn,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { useMobile } from '@/hooks/useMobile';
import { EmployeeAvatar } from '@/components/EmployeeAvatar';
import TaskAssigneeAvatars from '@/components/crm/TaskAssigneeAvatars';
import LinkEventFileModal from '@/components/crm/LinkEventFileModal';
import Image from 'next/image';
import {
  useGetTaskByIdQuery,
  useUpdateTaskMutation,
  useAddCommentMutation,
  useDeleteCommentMutation,
  useDeleteAttachmentMutation,
} from '@/store/api/tasksApi';
import { IEmployee } from '../../employees/type';

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
    employees: IEmployee;
  }[];
  creator?: IEmployee;
}

interface Comment {
  id: string;
  task_id: string;
  employee_id: string;
  content: string;
  created_at: string;
  employees: IEmployee;
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

export default function TaskDetailPage({ initialTask }: { initialTask: Task | null }) {
  const router = useRouter();
  const params = useParams();
  const taskId = params.id as string;
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const { currentEmployee } = useCurrentEmployee();
  const isMobile = useMobile();

  const {
    data: taskFromApi,
    isLoading: loading,
    refetch,
  } = useGetTaskByIdQuery(taskId, { skip: !taskId });

  const task = taskFromApi ?? initialTask;

  const [updateTask] = useUpdateTaskMutation();
  const [addComment] = useAddCommentMutation();
  const [deleteComment] = useDeleteCommentMutation();
  const [deleteAttachment] = useDeleteAttachmentMutation();

  const [chatItems, setChatItems] = useState<ChatItem[]>([]);
  const [newComment, setNewComment] = useState('');
  const [uploadingFile, setUploadingFile] = useState(false);
  const [showLinkFileModal, setShowLinkFileModal] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedTask, setEditedTask] = useState<Partial<Task>>({});
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [availableEmployees, setAvailableEmployees] = useState<IEmployee[]>([]);
  const [uploadingThumbnail, setUploadingThumbnail] = useState(false);
  const [previewFile, setPreviewFile] = useState<{
    url: string;
    name: string;
    type: string;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (task) {
      const items = mergeChatItems((task as any).comments, (task as any).attachments);
      setChatItems(items);
    }
  }, [task]);

  useEffect(() => {
    if (task?.id) {
      fetchAvailableEmployees();

      const commentsChannel = supabase
        .channel(`task_comments_${task.id}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'task_comments',
            filter: `task_id=eq.${task.id}`,
          },
          async (payload) => {
            const newComment = payload.new as any;

            const { data: employee } = await supabase
              .from('employees')
              .select('name, surname, avatar_url, avatar_metadata')
              .eq('id', newComment.employee_id)
              .maybeSingle();

            if (employee) {
              const chatItem: ChatItem = {
                id: newComment.id,
                type: 'comment',
                created_at: newComment.created_at,
                employee_id: newComment.employee_id,
                employee,
                content: newComment.content,
              };

              setChatItems((prev) =>
                [...prev, chatItem].sort(
                  (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
                ),
              );
            }
          },
        )
        .on(
          'postgres_changes',
          {
            event: 'DELETE',
            schema: 'public',
            table: 'task_comments',
            filter: `task_id=eq.${task.id}`,
          },
          (payload) => {
            const deletedId = payload.old.id;
            setChatItems((prev) =>
              prev.filter((item) => !(item.type === 'comment' && item.id === deletedId)),
            );
          },
        )
        .subscribe();

      const attachmentsChannel = supabase
        .channel(`task_attachments_${task.id}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'task_attachments',
            filter: `task_id=eq.${task.id}`,
          },
          async (payload) => {
            const newAttachment = payload.new as any;

            const { data: employee } = await supabase
              .from('employees')
              .select('name, surname, avatar_url, avatar_metadata')
              .eq('id', newAttachment.uploaded_by)
              .maybeSingle();

            if (employee) {
              const chatItem: ChatItem = {
                id: newAttachment.id,
                type: 'attachment',
                created_at: newAttachment.created_at,
                employee_id: newAttachment.uploaded_by,
                employee,
                attachment: {
                  ...newAttachment,
                  employees: employee,
                },
              };

              setChatItems((prev) => {
                const exists = prev.some((item) => item.id === newAttachment.id);
                if (exists) return prev;

                return [...prev, chatItem].sort(
                  (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
                );
              });
            }
          },
        )
        .on(
          'postgres_changes',
          {
            event: 'DELETE',
            schema: 'public',
            table: 'task_attachments',
            filter: `task_id=eq.${task.id}`,
          },
          (payload) => {
            const deletedId = payload.old.id;
            setChatItems((prev) =>
              prev.filter((item) => !(item.type === 'attachment' && item.id === deletedId)),
            );
          },
        )
        .subscribe();

      return () => {
        supabase.removeChannel(commentsChannel);
        supabase.removeChannel(attachmentsChannel);
      };
    }
  }, [task?.id]);

  useEffect(() => {
    scrollToBottom();
  }, [chatItems]);

  const scrollToBottom = () => {
    setTimeout(() => {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  const mergeChatItems = (comments: any[], attachments: any[]): ChatItem[] => {
    const commentItems: ChatItem[] = (comments || []).map((c) => ({
      id: c.id,
      type: 'comment' as const,
      created_at: c.created_at,
      employee_id: c.employee_id,
      employee: c.employees,
      content: c.content,
    }));

    const attachmentItems: ChatItem[] = (attachments || []).map((a) => ({
      id: a.id,
      type: 'attachment' as const,
      created_at: a.created_at,
      employee_id: a.uploaded_by,
      employee: a.employees,
      attachment: a,
    }));

    return [...commentItems, ...attachmentItems].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
  };

  const handleSendComment = async () => {
    if (!newComment.trim() || !currentEmployee) return;

    const tempId = `temp-${Date.now()}`;
    const commentText = newComment.trim();

    const optimisticComment: ChatItem = {
      id: tempId,
      type: 'comment',
      created_at: new Date().toISOString(),
      employee_id: currentEmployee.id,
      employee: {
        name: currentEmployee.name,
        surname: currentEmployee.surname,
        avatar_url: currentEmployee.avatar_url,
        avatar_metadata: currentEmployee.avatar_metadata,
      },
      content: commentText,
    };

    setChatItems((prev) => [...prev, optimisticComment]);

    setNewComment('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    try {
      await addComment({
        task_id: task?.id,
        employee_id: currentEmployee.id,
        content: commentText,
      }).unwrap();
    } catch (error) {
      console.error('Error adding comment:', error);
      showSnackbar('Błąd podczas dodawania komentarza', 'error');
      setChatItems((prev) => prev.filter((item) => item.id !== tempId));
    }
  };

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0 || !currentEmployee) return;

    const tempIds: string[] = [];

    try {
      setUploadingFile(true);

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const tempId = `temp-${Date.now()}-${i}`;
        tempIds.push(tempId);

        const blobUrl = isImage(file.type) ? URL.createObjectURL(file) : null;

        const optimisticAttachment: ChatItem = {
          id: tempId,
          type: 'attachment',
          created_at: new Date().toISOString(),
          employee_id: currentEmployee.id,
          employee: {
            name: currentEmployee.name,
            surname: currentEmployee.surname,
            avatar_url: currentEmployee.avatar_url,
            avatar_metadata: currentEmployee.avatar_metadata,
          },
          attachment: {
            id: tempId,
            task_id: task?.id,
            event_file_id: null,
            is_linked: false,
            file_name: file.name,
            file_url: blobUrl,
            file_type: file.type,
            file_size: file.size,
            uploaded_by: currentEmployee.id,
            created_at: new Date().toISOString(),
            employees: {
              name: currentEmployee.name,
              surname: currentEmployee.surname,
              avatar_url: currentEmployee.avatar_url,
              avatar_metadata: currentEmployee.avatar_metadata,
            },
          },
        };

        setChatItems((prev) => [...prev, optimisticAttachment]);

        const fileExt = file.name.split('.').pop();
        const fileName = `${Math.random()}.${fileExt}`;
        const filePath = `task-attachments/${task?.id}/${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from('event-files')
          .upload(filePath, file);

        if (uploadError) {
          if (blobUrl) URL.revokeObjectURL(blobUrl);
          throw uploadError;
        }

        const {
          data: { publicUrl },
        } = supabase.storage.from('event-files').getPublicUrl(filePath);

        const { data: newAttachment, error: dbError } = await supabase
          .from('task_attachments')
          .insert({
            task_id: task?.id,
            file_name: file.name,
            file_url: publicUrl,
            file_type: file.type,
            file_size: file.size,
            uploaded_by: currentEmployee.id,
          })
          .select()
          .single();

        if (dbError) {
          if (blobUrl) URL.revokeObjectURL(blobUrl);
          throw dbError;
        }

        if (blobUrl) URL.revokeObjectURL(blobUrl);

        setChatItems((prev) =>
          prev.map((item) =>
            item.id === tempId
              ? {
                  ...item,
                  id: newAttachment.id,
                  attachment: {
                    ...item.attachment!,
                    id: newAttachment.id,
                    file_url: publicUrl,
                  },
                }
              : item,
          ),
        );
      }

      showSnackbar(`Dodano ${files.length} plik(ów)`, 'success');
    } catch (error) {
      console.error('Error uploading file:', error);
      showSnackbar('Błąd podczas przesyłania pliku', 'error');
      setChatItems((prev) => prev.filter((item) => !tempIds.includes(item.id)));
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
      await deleteComment({ commentId, taskId: task?.id }).unwrap();
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
      await deleteAttachment({
        attachmentId,
        taskId: task?.id,
        fileUrl,
        isLinked,
      }).unwrap();

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
      setAvailableEmployees(data as unknown as IEmployee[]);
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
      await updateTask({
        id: task?.id,
        title: editedTask.title,
        description: editedTask.description || null,
        priority: editedTask.priority as any,
        due_date: editedTask.due_date || null,
      }).unwrap();

      showSnackbar('Zadanie zaktualizowane', 'success');
      setIsEditing(false);
    } catch (error) {
      console.error('Error updating task:', error);
      showSnackbar('Błąd podczas aktualizacji zadania', 'error');
    }
  };

  const handleAddAssignee = async (employeeId: string) => {
    try {
      const { error } = await supabase.from('task_assignees').insert({
        task_id: task?.id,
        employee_id: employeeId,
      });

      if (error) throw error;

      showSnackbar('Dodano osobę do zadania', 'success');
      refetch();
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
        .eq('task_id', task?.id)
        .eq('employee_id', employeeId);

      if (error) throw error;

      showSnackbar('Usunięto osobę z zadania', 'success');
      refetch();
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
      const filePath = `task-thumbnails/${task?.id}/${fileName}`;

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
        .eq('id', task?.id);

      if (updateError) throw updateError;

      showSnackbar('Zdjęcie zostało dodane', 'success');
      refetch();
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
        .eq('id', task?.id);

      if (error) throw error;

      showSnackbar('Zdjęcie zostało usunięte', 'success');
      refetch();
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

  const isPDF = (fileType: string) => {
    return fileType === 'application/pdf';
  };

  const handlePreviewFile = (url: string, name: string, type: string) => {
    setPreviewFile({ url, name, type });
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
        <div className={`flex items-center gap-2 ${isMobile ? 'p-2' : 'p-4'}`}>
          <button
            onClick={() => router.back()}
            className={`${isMobile ? 'p-1.5' : 'p-2'} rounded-lg transition-colors hover:bg-[#d3bb73]/10`}
          >
            <ArrowLeft className={`${isMobile ? 'h-4 w-4' : 'h-5 w-5'} text-[#e5e4e2]`} />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className={`${isMobile ? 'text-base' : 'text-xl'} font-bold text-[#e5e4e2]`}>
              {isMobile ? 'Szczegóły' : 'Szczegóły zadania'}
            </h1>
          </div>
          {!isEditing && (
            <button
              onClick={handleStartEdit}
              className={`flex items-center gap-1.5 ${isMobile ? 'px-2 py-1.5 text-xs' : 'px-4 py-2'} rounded-lg bg-[#d3bb73]/10 text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/20`}
            >
              <Edit3 className={`${isMobile ? 'h-3 w-3' : 'h-4 w-4'}`} />
              {isMobile ? 'Edytuj' : 'Edytuj'}
            </button>
          )}
        </div>
      </div>

      {/* Task Details Section - Scrollable */}
      <div className="max-h-[60vh] flex-shrink-0 overflow-y-auto border-b-4 border-[#d3bb73]/20 bg-[#0f1119]">
        <div className={`${isMobile ? 'space-y-3 p-3' : 'space-y-6 p-6'}`}>
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
                  {task?.thumbnail_url ? (
                    <div className="group relative inline-block">
                      <EmployeeAvatar
                        employee={task?.creator as unknown as IEmployee}
                        size={128}
                        showActivityStatus
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

                <div
                  className={`flex ${isMobile ? 'gap-2' : 'gap-3'} border-t border-[#d3bb73]/10 pt-4`}
                >
                  <button
                    onClick={handleSaveEdit}
                    className={`flex items-center ${isMobile ? 'gap-1.5 px-3 py-1.5 text-xs' : 'gap-2 px-4 py-2'} rounded-lg bg-[#d3bb73] font-medium text-[#0a0d1a] transition-colors hover:bg-[#c4ac64]`}
                  >
                    <Save className={`${isMobile ? 'h-3 w-3' : 'h-4 w-4'}`} />
                    Zapisz
                  </button>
                  <button
                    onClick={handleCancelEdit}
                    className={`flex items-center ${isMobile ? 'gap-1.5 px-3 py-1.5 text-xs' : 'gap-2 px-4 py-2'} rounded-lg bg-[#e5e4e2]/10 text-[#e5e4e2] transition-colors hover:bg-[#e5e4e2]/20`}
                  >
                    <X className={`${isMobile ? 'h-3 w-3' : 'h-4 w-4'}`} />
                    Anuluj
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              {/* View Mode */}
              <div className={`${isMobile ? 'space-y-2' : 'space-y-4'}`}>
                <h2 className={`${isMobile ? 'text-lg' : 'text-2xl'} font-bold text-[#e5e4e2]`}>
                  {task.title}
                </h2>

                {task.description && (
                  <div>
                    <h3
                      className={`${isMobile ? 'text-xs' : 'text-sm'} mb-1 font-medium text-[#e5e4e2]/60`}
                    >
                      Opis
                    </h3>
                    <p
                      className={`${isMobile ? 'text-xs' : 'text-sm'} whitespace-pre-wrap text-[#e5e4e2]/80`}
                    >
                      {task.description}
                    </p>
                  </div>
                )}

                {task.thumbnail_url && (
                  <div>
                    <EmployeeAvatar
                      employee={task?.creator as unknown as IEmployee}
                      size={isMobile ? 128 : 256}
                      showActivityStatus
                    />
                  </div>
                )}

                <div className={`flex items-center ${isMobile ? 'gap-2' : 'gap-4'} flex-wrap`}>
                  {task.creator && (
                    <div className="flex items-center gap-1.5">
                      <User className={`${isMobile ? 'h-3 w-3' : 'h-4 w-4'} text-[#e5e4e2]/60`} />
                      <span className={`${isMobile ? 'text-xs' : 'text-sm'} text-[#e5e4e2]/60`}>
                        Autor:
                      </span>
                      <span className={`${isMobile ? 'text-xs' : 'text-sm'} text-[#e5e4e2]`}>
                        {task.creator.name} {task.creator.surname}
                      </span>
                    </div>
                  )}
                  <span
                    className={`${isMobile ? 'px-2 py-0.5 text-[10px]' : 'px-3 py-1 text-xs'} rounded-full ${priorityColors[task.priority]}`}
                  >
                    {priorityLabels[task.priority]}
                  </span>
                  {task.due_date && (
                    <div
                      className={`flex items-center gap-1.5 ${isMobile ? 'text-xs' : 'text-sm'} text-[#e5e4e2]/60`}
                    >
                      <Calendar className={`${isMobile ? 'h-3 w-3' : 'h-4 w-4'}`} />
                      {new Date(task.due_date).toLocaleDateString('pl-PL')}
                    </div>
                  )}
                </div>

                {/* Assignees - Only Avatars */}
                <div>
                  <h3
                    className={`${isMobile ? 'text-xs' : 'text-sm'} font-medium text-[#e5e4e2]/60 ${isMobile ? 'mb-2' : 'mb-3'}`}
                  >
                    Przypisane osoby
                  </h3>
                  <div className="flex items-center -space-x-2">
                    {task.task_assignees.map((assignee) => (
                      <div
                        key={assignee.employee_id}
                        className="group relative"
                        title={`${assignee.employees.name} ${assignee.employees.surname}`}
                      >
                        <EmployeeAvatar
                          employee={assignee.employees as unknown as IEmployee}
                          size={isMobile ? 32 : 40}
                          showActivityStatus={true}
                        />
                        {(task.created_by === currentEmployee?.id ||
                          currentEmployee?.id === assignee.employee_id) && (
                          <button
                            onClick={() => handleRemoveAssignee(assignee.employee_id)}
                            className={`absolute -right-1 -top-1 ${isMobile ? 'p-0.5' : 'p-1'} z-10 rounded-full bg-red-500 opacity-0 shadow-lg transition-opacity hover:bg-red-600 group-hover:opacity-100`}
                            title="Usuń"
                          >
                            <X className={`${isMobile ? 'h-2.5 w-2.5' : 'h-3 w-3'} text-white`} />
                          </button>
                        )}
                      </div>
                    ))}
                    <button
                      onClick={() => setShowAssignModal(true)}
                      className={`${isMobile ? 'h-8 w-8 border' : 'h-10 w-10 border-2'} ml-2 flex items-center justify-center rounded-full border-[#d3bb73]/40 bg-[#d3bb73]/20 transition-colors hover:bg-[#d3bb73]/30`}
                      title="Dodaj osobę"
                    >
                      <UserPlus className={`${isMobile ? 'h-4 w-4' : 'h-5 w-5'} text-[#d3bb73]`} />
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
          className={`overflow-y-auto ${isMobile ? 'space-y-2 p-2' : 'space-y-4 p-6'}`}
          style={{
            minHeight: chatItems.length === 0 ? '200px' : '200px',
            maxHeight: '500px',
          }}
        >
          {chatItems.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-[#e5e4e2]/40">
              <p className={`${isMobile ? 'text-xs' : 'text-sm'}`}>
                Brak wiadomości. Rozpocznij konwersację.
              </p>
            </div>
          ) : (
            chatItems.map((item) => (
              <div key={item.id} className={isMobile ? 'space-y-1' : 'flex gap-3'}>
                {isMobile ? (
                  <>
                    {/* Mobile: Avatar + Info na górze */}
                    <div className="flex items-center gap-2 px-1">
                      <EmployeeAvatar
                        employee={item.employee as unknown as IEmployee}
                        size={28}
                        className="flex-shrink-0"
                        showActivityStatus
                      />
                      <span className="text-xs font-medium text-[#e5e4e2]">
                        {item.employee.name} {item.employee.surname}
                      </span>
                      <span className="ml-auto text-[10px] text-[#e5e4e2]/40">
                        {new Date(item.created_at).toLocaleString('pl-PL', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                    {/* Treść na pełną szerokość */}
                    <div className="w-full">
                      {item.type === 'comment' && (
                        <div className="group rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-2">
                          <div className="flex items-start gap-1.5">
                            <p className="flex-1 whitespace-pre-wrap text-xs text-[#e5e4e2]">
                              {item.content}
                            </p>
                            {canDeleteComment(item.employee_id) && (
                              <button
                                onClick={() => handleDeleteComment(item.id)}
                                className="flex-shrink-0 rounded p-1 opacity-0 transition-opacity hover:bg-red-500/10 group-hover:opacity-100"
                                title="Usuń"
                              >
                                <Trash2 className="h-3 w-3 text-red-400" />
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                      {item.type === 'attachment' && item.attachment && (
                        <div className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-2">
                          <div className="flex items-center gap-2">
                            {item.attachment.file_url && (
                              <button
                                onClick={() =>
                                  handlePreviewFile(
                                    item.attachment!.file_url!,
                                    item.attachment!.file_name,
                                    item.attachment!.file_type,
                                  )
                                }
                                className="group relative flex-shrink-0"
                              >
                                {isImage(item.attachment.file_type) ? (
                                  <>
                                    <EmployeeAvatar
                                      employee={item.employee as unknown as IEmployee}
                                      size={128}
                                      showActivityStatus
                                    />
                           
                                    <div className="absolute inset-0 flex items-center justify-center rounded bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                                      <ZoomIn className="h-4 w-4 text-white" />
                                    </div>
                                  </>
                                ) : isPDF(item.attachment.file_type) ? (
                                  <div className="flex h-8 w-8 items-center justify-center rounded bg-red-500/20 transition-colors group-hover:bg-red-500/30">
                                    <FileText className="h-4 w-4 text-red-400" />
                                  </div>
                                ) : (
                                  <div className="flex h-8 w-8 items-center justify-center rounded bg-[#d3bb73]/10 transition-colors group-hover:bg-[#d3bb73]/20">
                                    <File className="h-4 w-4 text-[#d3bb73]" />
                                  </div>
                                )}
                              </button>
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="mb-0.5 flex items-center gap-1">
                                <p className="truncate text-xs font-medium text-[#e5e4e2]">
                                  {item.attachment.file_name}
                                </p>
                                {item.attachment.is_linked && (
                                  <ExternalLink className="h-2.5 w-2.5 flex-shrink-0 text-blue-400" />
                                )}
                              </div>
                              <p className="text-[10px] text-[#e5e4e2]/60">
                                {formatFileSize(item.attachment.file_size)}
                              </p>
                            </div>
                            <div className="flex gap-1">
                              {item.attachment.file_url && (
                                <a
                                  href={item.attachment.file_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="rounded p-1.5 transition-colors hover:bg-[#d3bb73]/10"
                                  title="Pobierz"
                                >
                                  <Download className="h-3 w-3 text-[#d3bb73]" />
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
                                className="rounded p-1.5 transition-colors hover:bg-red-500/10"
                                title={item.attachment.is_linked ? 'Odlinkuj' : 'Usuń'}
                              >
                                <Trash2 className="h-3 w-3 text-red-400" />
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    {/* Desktop: Avatar po lewej, treść obok */}
                    <EmployeeAvatar
                      employee={item.employee as unknown as IEmployee}
                      size={40}
                      className="flex-shrink-0"
                      showActivityStatus
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
                            {item.attachment.file_url && (
                              <button
                                onClick={() =>
                                  handlePreviewFile(
                                    item.attachment!.file_url!,
                                    item.attachment!.file_name,
                                    item.attachment!.file_type,
                                  )
                                }
                                className="group relative flex-shrink-0"
                              >
                                {isImage(item.attachment.file_type) ? (
                                  <>
                                    <Image
                                      src={item.attachment.file_url as string}
                                      alt={item.attachment.file_name}
                                      width={isMobile ? 128 : 256}
                                      height={isMobile ? 128 : 256}
                                    />
                                    <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                                      <ZoomIn className="h-5 w-5 text-white" />
                                    </div>
                                  </>
                                ) : isPDF(item.attachment.file_type) ? (
                                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-red-500/20 transition-colors group-hover:bg-red-500/30">
                                    <FileText className="h-6 w-6 text-red-400" />
                                  </div>
                                ) : (
                                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[#d3bb73]/10 transition-colors group-hover:bg-[#d3bb73]/20">
                                    <File className="h-6 w-6 text-[#d3bb73]" />
                                  </div>
                                )}
                              </button>
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
                  </>
                )}
              </div>
            ))
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Input Area */}
        <div
          className={`${isMobile ? 'p-2' : 'p-4'} relative border-t border-[#d3bb73]/10 bg-[#0f1119]`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {isDragging && (
            <div className="absolute inset-0 z-50 flex items-center justify-center rounded-lg border-2 border-dashed border-[#d3bb73] bg-[#d3bb73]/10">
              <div className="text-center">
                <Paperclip
                  className={`${isMobile ? 'h-8 w-8' : 'h-12 w-12'} mx-auto mb-2 text-[#d3bb73]`}
                />
                <p className={`text-[#d3bb73] ${isMobile ? 'text-xs' : 'font-medium'}`}>
                  Upuść pliki tutaj
                </p>
              </div>
            </div>
          )}
          <div className={`flex ${isMobile ? 'gap-1' : 'gap-2'}`}>
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
              className={`${isMobile ? 'p-2' : 'p-3'} rounded-lg transition-colors hover:bg-[#d3bb73]/10 disabled:opacity-50`}
              title="Dodaj plik"
            >
              <Paperclip className={`${isMobile ? 'h-4 w-4' : 'h-5 w-5'} text-[#e5e4e2]/60`} />
            </button>
            {task.event_id && (
              <button
                onClick={() => setShowLinkFileModal(true)}
                className={`${isMobile ? 'p-2' : 'p-3'} rounded-lg transition-colors hover:bg-[#d3bb73]/10`}
                title="Dodaj z wydarzenia"
              >
                <LinkIcon className={`${isMobile ? 'h-4 w-4' : 'h-5 w-5'} text-blue-400`} />
              </button>
            )}
            <textarea
              ref={textareaRef}
              value={newComment}
              onChange={handleTextareaChange}
              onKeyDown={handleKeyDown}
              placeholder={
                isMobile ? 'Napisz...' : 'Napisz wiadomość... (Shift+Enter dla nowej linii)'
              }
              className={`flex-1 rounded-lg border border-[#d3bb73]/20 bg-[#1a1d2e] ${isMobile ? 'px-2 py-2 text-xs' : 'px-4 py-3'} resize-none text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:border-[#d3bb73]/50 focus:outline-none ${isMobile ? 'min-h-[36px]' : 'min-h-[48px]'} max-h-[200px]`}
              rows={1}
            />
            <button
              onClick={handleSendComment}
              disabled={!newComment.trim() || uploadingFile}
              className={`${isMobile ? 'px-3 py-2' : 'px-6 py-3'} rounded-lg bg-[#d3bb73] font-medium text-[#0f1119] transition-colors hover:bg-[#d3bb73]/90 disabled:cursor-not-allowed disabled:opacity-50`}
            >
              <Send className={`${isMobile ? 'h-4 w-4' : 'h-5 w-5'}`} />
            </button>
          </div>
          {!isMobile && (
            <p className="mt-2 px-6 pb-4 text-xs text-[#e5e4e2]/40">
              Przeciągnij i upuść pliki lub zdjęcia aby je dodać
            </p>
          )}
        </div>
      </div>

      {/* Link Event File Modal */}
      {task.event_id && (
        <LinkEventFileModal
          isOpen={showLinkFileModal}
          onClose={() => setShowLinkFileModal(false)}
          taskId={taskId}
          eventId={task.event_id}
          onFileLinked={() => {}}
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

      {/* File Preview Modal */}
      {previewFile && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          onClick={() => setPreviewFile(null)}
        >
          <div
            className="relative flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg bg-[#0f1119]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[#d3bb73]/10 p-4">
              <h3 className="truncate pr-4 text-lg font-semibold text-[#e5e4e2]">
                {previewFile.name}
              </h3>
              <div className="flex gap-2">
                <a
                  href={previewFile.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  download
                  className="rounded-lg p-2 transition-colors hover:bg-[#d3bb73]/10"
                  title="Pobierz"
                >
                  <Download className="h-5 w-5 text-[#d3bb73]" />
                </a>
                <button
                  onClick={() => setPreviewFile(null)}
                  className="rounded-lg p-2 transition-colors hover:bg-red-500/10"
                >
                  <X className="h-5 w-5 text-red-400" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto p-4">
              {isImage(previewFile.type) && (
                <div className="flex min-h-full items-center justify-center">
                  <Image
                    src={previewFile.url}
                    alt={previewFile.name}
                    width={isMobile ? 128 : 512}
                    height={isMobile ? 128 : 512}
                  />
                </div>
              )}

              {isPDF(previewFile.type) && (
                <iframe
                  src={previewFile.url}
                  className="h-[calc(90vh-120px)] w-full rounded-lg"
                  title={previewFile.name}
                />
              )}

              {!isImage(previewFile.type) && !isPDF(previewFile.type) && (
                <div className="flex min-h-[400px] flex-col items-center justify-center text-center">
                  <File className="mb-4 h-16 w-16 text-[#d3bb73]" />
                  <p className="mb-2 text-lg text-[#e5e4e2]">{previewFile.name}</p>
                  <p className="mb-6 text-sm text-[#e5e4e2]/60">
                    Podgląd niedostępny dla tego typu pliku
                  </p>
                  <a
                    href={previewFile.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    download
                    className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-3 font-medium text-[#0a0d1a] transition-colors hover:bg-[#b8a05e]"
                  >
                    <Download className="h-5 w-5" />
                    Pobierz plik
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
