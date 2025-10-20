'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, Calendar, User, Paperclip, Send, Download, Trash2, Link as LinkIcon, ExternalLink, File } from 'lucide-react';
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

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (taskId) {
      fetchTask();
      fetchChatItems();

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
          }
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
          }
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
      const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .eq('id', taskId)
        .single();

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
            employees: employee || { name: '', surname: '', avatar_url: null, avatar_metadata: null },
          };
        })
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

      const comments: ChatItem[] = (commentsData || []).map(c => ({
        id: c.id,
        type: 'comment' as const,
        created_at: c.created_at,
        employee: c.employees,
        content: c.content,
      }));

      const attachments: ChatItem[] = (attachmentsData || []).map(a => ({
        id: a.id,
        type: 'attachment' as const,
        created_at: a.created_at,
        employee: a.employees,
        attachment: a,
      }));

      const allItems = [...comments, ...attachments].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );

      setChatItems(allItems);
    } catch (error) {
      console.error('Error fetching chat items:', error);
    }
  };

  const handleSendComment = async () => {
    if (!newComment.trim() || !currentEmployee) return;

    try {
      const { error } = await supabase
        .from('task_comments')
        .insert({
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

        const { data: { publicUrl } } = supabase.storage
          .from('event-files')
          .getPublicUrl(filePath);

        const { error: dbError } = await supabase
          .from('task_attachments')
          .insert({
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

  const handleDeleteAttachment = async (attachmentId: string, fileUrl: string | null, isLinked: boolean) => {
    const confirmed = await showConfirm(
      isLinked ? 'Czy na pewno chcesz odlinkować ten plik?' : 'Czy na pewno chcesz usunąć ten plik?',
      isLinked ? 'Odlinkuj plik' : 'Usuń plik'
    );

    if (!confirmed) return;

    try {
      if (!isLinked && fileUrl) {
        const filePath = fileUrl.split('/event-files/')[1];
        if (filePath) {
          await supabase.storage.from('event-files').remove([filePath]);
        }
      }

      const { error } = await supabase
        .from('task_attachments')
        .delete()
        .eq('id', attachmentId);

      if (error) throw error;

      showSnackbar(isLinked ? 'Plik został odlinkowany' : 'Plik został usunięty', 'success');
    } catch (error) {
      console.error('Error deleting attachment:', error);
      showSnackbar('Błąd podczas usuwania pliku', 'error');
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#0a0d1a]">
        <div className="animate-spin w-8 h-8 border-2 border-[#d3bb73] border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!task) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#0a0d1a]">
        <p className="text-[#e5e4e2]/60">Nie znaleziono zadania</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-[#0a0d1a]">
      {/* Header */}
      <div className="flex items-center gap-4 p-6 bg-[#0f1119] border-b border-[#d3bb73]/10">
        <button
          onClick={() => router.back()}
          className="p-2 hover:bg-[#d3bb73]/10 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-[#e5e4e2]" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-[#e5e4e2]">{task.title}</h1>
        </div>
      </div>

      {/* Task Meta Info */}
      <div className="bg-[#0f1119] border-b border-[#d3bb73]/10">
        <div className="p-6 space-y-4">
          {/* Creator & Priority Row */}
          <div className="flex items-center gap-4 flex-wrap">
            {task.creator && (
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-[#e5e4e2]/60" />
                <span className="text-sm text-[#e5e4e2]/60">Utworzono przez:</span>
                <span className="text-sm text-[#e5e4e2]">
                  {task.creator.name} {task.creator.surname}
                </span>
              </div>
            )}
            <span className={`text-xs px-3 py-1 rounded-full ${priorityColors[task.priority]}`}>
              {priorityLabels[task.priority]}
            </span>
            <span className="text-xs px-3 py-1 rounded-full bg-[#d3bb73]/10 text-[#d3bb73]">
              {task.status}
            </span>
            {task.due_date && (
              <div className="flex items-center gap-2 text-sm text-[#e5e4e2]/60">
                <Calendar className="w-4 h-4" />
                {new Date(task.due_date).toLocaleDateString('pl-PL')}
              </div>
            )}
          </div>

          {/* Description */}
          {task.description && (
            <p className="text-sm text-[#e5e4e2]/80">{task.description}</p>
          )}

          {/* Assignees */}
          {task.task_assignees.length > 0 && (
            <div className="flex items-center gap-3">
              <span className="text-sm text-[#e5e4e2]/60">Przypisane osoby:</span>
              <TaskAssigneeAvatars assignees={task.task_assignees} maxVisible={10} />
            </div>
          )}
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4 min-h-0">

        {chatItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-[#e5e4e2]/40">
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
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-medium text-[#e5e4e2]">
                    {item.employee.name} {item.employee.surname}
                  </span>
                  <span className="text-xs text-[#e5e4e2]/40">
                    {new Date(item.created_at).toLocaleString('pl-PL')}
                  </span>
                </div>

                {item.type === 'comment' && (
                  <div className="bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg p-3">
                    <p className="text-sm text-[#e5e4e2] whitespace-pre-wrap">{item.content}</p>
                  </div>
                )}

                {item.type === 'attachment' && item.attachment && (
                  <div className="bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg p-3">
                    <div className="flex items-center gap-3">
                      {isImage(item.attachment.file_type) && item.attachment.file_url ? (
                        <img
                          src={item.attachment.file_url}
                          alt={item.attachment.file_name}
                          className="w-48 h-32 object-cover rounded-lg"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-lg bg-[#d3bb73]/10 flex items-center justify-center">
                          <File className="w-6 h-6 text-[#d3bb73]" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="text-sm text-[#e5e4e2] font-medium truncate">
                            {item.attachment.file_name}
                          </p>
                          {item.attachment.is_linked && (
                            <ExternalLink className="w-3 h-3 text-blue-400 flex-shrink-0" title="Plik z wydarzenia" />
                          )}
                        </div>
                        <p className="text-xs text-[#e5e4e2]/60">{formatFileSize(item.attachment.file_size)}</p>
                      </div>
                      <div className="flex gap-2">
                        {item.attachment.file_url && (
                          <a
                            href={item.attachment.file_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-2 hover:bg-[#d3bb73]/10 rounded-lg transition-colors"
                            title="Pobierz"
                          >
                            <Download className="w-4 h-4 text-[#d3bb73]" />
                          </a>
                        )}
                        <button
                          onClick={() => handleDeleteAttachment(item.attachment!.id, item.attachment!.file_url, item.attachment!.is_linked)}
                          className="p-2 hover:bg-red-500/10 rounded-lg transition-colors"
                          title={item.attachment.is_linked ? 'Odlinkuj' : 'Usuń'}
                        >
                          <Trash2 className="w-4 h-4 text-red-400" />
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
        className="p-4 bg-[#0f1119] border-t border-[#d3bb73]/10 relative"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isDragging && (
          <div className="absolute inset-0 bg-[#d3bb73]/10 border-2 border-dashed border-[#d3bb73] rounded-lg flex items-center justify-center z-50">
            <div className="text-center">
              <Paperclip className="w-12 h-12 text-[#d3bb73] mx-auto mb-2" />
              <p className="text-[#d3bb73] font-medium">Upuść pliki tutaj</p>
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
            className="p-3 hover:bg-[#d3bb73]/10 rounded-lg transition-colors disabled:opacity-50"
            title="Dodaj plik"
          >
            <Paperclip className="w-5 h-5 text-[#e5e4e2]/60" />
          </button>
          {task.event_id && (
            <button
              onClick={() => setShowLinkFileModal(true)}
              className="p-3 hover:bg-[#d3bb73]/10 rounded-lg transition-colors"
              title="Dodaj z wydarzenia"
            >
              <LinkIcon className="w-5 h-5 text-blue-400" />
            </button>
          )}
          <textarea
            ref={textareaRef}
            value={newComment}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            placeholder="Napisz wiadomość... (Shift+Enter dla nowej linii)"
            className="flex-1 bg-[#1a1d2e] border border-[#d3bb73]/20 rounded-lg px-4 py-3 text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:outline-none focus:border-[#d3bb73]/50 resize-none min-h-[48px] max-h-[200px]"
            rows={1}
          />
          <button
            onClick={handleSendComment}
            disabled={!newComment.trim() || uploadingFile}
            className="px-6 py-3 bg-[#d3bb73] hover:bg-[#d3bb73]/90 text-[#0f1119] rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
        <p className="text-xs text-[#e5e4e2]/40 mt-2">
          Przeciągnij i upuść pliki lub zdjęcia aby je dodać
        </p>
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
    </div>
  );
}
