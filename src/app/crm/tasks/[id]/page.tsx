'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, Calendar, User, MessageSquare, Image as ImageIcon, FileText, Send, X, Upload, Download, Trash2, Edit } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import TaskAssigneeAvatars from '@/components/crm/TaskAssigneeAvatars';

interface Task {
  id: string;
  title: string;
  description: string | null;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: string;
  board_column: string;
  due_date: string | null;
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
  file_name: string;
  file_url: string;
  file_type: string;
  file_size: number;
  uploaded_by: string;
  created_at: string;
  employees: {
    name: string;
    surname: string;
  };
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
  const [comments, setComments] = useState<Comment[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [newComment, setNewComment] = useState('');
  const [uploadingFile, setUploadingFile] = useState(false);
  const [activeTab, setActiveTab] = useState<'details' | 'comments' | 'files'>('details');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const commentsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (taskId) {
      fetchTask();
      fetchComments();
      fetchAttachments();

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
            fetchComments();
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
            fetchAttachments();
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
    if (activeTab === 'comments' && comments.length > 0) {
      setTimeout(scrollToBottom, 100);
    }
  }, [comments.length, activeTab]);

  const scrollToBottom = () => {
    commentsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
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

      setTask({
        ...data,
        task_assignees: assigneesWithEmployees,
      });
    } catch (error) {
      console.error('Error fetching task:', error);
      showSnackbar('Błąd podczas ładowania zadania', 'error');
    } finally {
      setLoading(false);
    }
  };

  const fetchComments = async () => {
    try {
      const { data: commentsData, error } = await supabase
        .from('task_comments')
        .select('*')
        .eq('task_id', taskId)
        .order('created_at', { ascending: true });

      if (error) throw error;

      const commentsWithEmployees = await Promise.all(
        (commentsData || []).map(async (comment) => {
          const { data: employee } = await supabase
            .from('employees')
            .select('name, surname, avatar_url, avatar_metadata')
            .eq('id', comment.employee_id)
            .maybeSingle();

          return {
            ...comment,
            employees: employee || { name: '', surname: '', avatar_url: null, avatar_metadata: null },
          };
        })
      );

      setComments(commentsWithEmployees);
    } catch (error) {
      console.error('Error fetching comments:', error);
    }
  };

  const fetchAttachments = async () => {
    try {
      const { data, error } = await supabase
        .from('task_attachments')
        .select(`
          *,
          employees:uploaded_by (
            name,
            surname
          )
        `)
        .eq('task_id', taskId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setAttachments(data || []);
    } catch (error) {
      console.error('Error fetching attachments:', error);
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
      fetchComments();
      showSnackbar('Komentarz został dodany', 'success');
    } catch (error) {
      console.error('Error adding comment:', error);
      showSnackbar('Błąd podczas dodawania komentarza', 'error');
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentEmployee) return;

    try {
      setUploadingFile(true);

      const fileExt = file.name.split('.').pop();
      const fileName = `${Math.random()}.${fileExt}`;
      const filePath = `task-attachments/${taskId}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('task-files')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('task-files')
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

      fetchAttachments();
      showSnackbar('Plik został dodany', 'success');
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

  const handleDeleteAttachment = async (attachmentId: string, fileUrl: string) => {
    const confirmed = await showConfirm(
      'Czy na pewno chcesz usunąć ten plik?',
      'Usuń plik'
    );

    if (!confirmed) return;

    try {
      const filePath = fileUrl.split('/task-files/')[1];

      await supabase.storage
        .from('task-files')
        .remove([filePath]);

      const { error } = await supabase
        .from('task_attachments')
        .delete()
        .eq('id', attachmentId);

      if (error) throw error;

      fetchAttachments();
      showSnackbar('Plik został usunięty', 'success');
    } catch (error) {
      console.error('Error deleting attachment:', error);
      showSnackbar('Błąd podczas usuwania pliku', 'error');
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const isImage = (fileType: string) => {
    return fileType.startsWith('image/');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-[#e5e4e2]/60">Ładowanie zadania...</div>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <div className="text-[#e5e4e2]/60 mb-4">Nie znaleziono zadania</div>
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 text-[#d3bb73] hover:text-[#d3bb73]/80 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Wróć
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={() => router.back()}
          className="p-2 hover:bg-[#d3bb73]/10 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-[#e5e4e2]" />
        </button>
        <h1 className="text-2xl font-light text-[#e5e4e2] flex-1">{task.title}</h1>
        <button
          onClick={() => router.push(`/crm/tasks`)}
          className="px-4 py-2 bg-[#d3bb73]/10 text-[#d3bb73] rounded-lg hover:bg-[#d3bb73]/20 transition-colors text-sm"
        >
          <Edit className="w-4 h-4 inline mr-2" />
          Edytuj zadanie
        </button>
      </div>

      <div className="flex gap-2 mb-6 border-b border-[#d3bb73]/10">
        <button
          onClick={() => setActiveTab('details')}
          className={`px-4 py-2 text-sm transition-colors ${
            activeTab === 'details'
              ? 'text-[#d3bb73] border-b-2 border-[#d3bb73]'
              : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
          }`}
        >
          <FileText className="w-4 h-4 inline mr-2" />
          Szczegóły
        </button>
        <button
          onClick={() => setActiveTab('comments')}
          className={`px-4 py-2 text-sm transition-colors ${
            activeTab === 'comments'
              ? 'text-[#d3bb73] border-b-2 border-[#d3bb73]'
              : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
          }`}
        >
          <MessageSquare className="w-4 h-4 inline mr-2" />
          Komentarze ({comments.length})
        </button>
        <button
          onClick={() => setActiveTab('files')}
          className={`px-4 py-2 text-sm transition-colors ${
            activeTab === 'files'
              ? 'text-[#d3bb73] border-b-2 border-[#d3bb73]'
              : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
          }`}
        >
          <ImageIcon className="w-4 h-4 inline mr-2" />
          Pliki ({attachments.length})
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {activeTab === 'details' && (
          <div className="space-y-6">
            <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-lg p-6">
              <h3 className="text-sm font-medium text-[#e5e4e2]/60 mb-4">Informacje podstawowe</h3>

              <div className="space-y-4">
                <div className="flex items-center gap-4">
                  <span className="text-sm text-[#e5e4e2]/60 w-32">Priorytet:</span>
                  <span className={`px-3 py-1 rounded text-sm ${priorityColors[task.priority]}`}>
                    {priorityLabels[task.priority]}
                  </span>
                </div>

                {task.due_date && (
                  <div className="flex items-center gap-4">
                    <span className="text-sm text-[#e5e4e2]/60 w-32">Termin:</span>
                    <div className="flex items-center gap-2 text-[#e5e4e2]">
                      <Calendar className="w-4 h-4" />
                      {new Date(task.due_date).toLocaleDateString('pl-PL', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                      })}
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-4">
                  <span className="text-sm text-[#e5e4e2]/60 w-32">Status:</span>
                  <span className="text-[#e5e4e2]">{task.board_column}</span>
                </div>

                {task.task_assignees.length > 0 && (
                  <div className="flex items-start gap-4">
                    <span className="text-sm text-[#e5e4e2]/60 w-32">Przypisani:</span>
                    <TaskAssigneeAvatars assignees={task.task_assignees} maxVisible={10} />
                  </div>
                )}
              </div>
            </div>

            {task.description && (
              <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-lg p-6">
                <h3 className="text-sm font-medium text-[#e5e4e2]/60 mb-4">Opis</h3>
                <p className="text-[#e5e4e2] whitespace-pre-wrap">{task.description}</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'comments' && (
          <div className="flex flex-col h-full">
            <div className="flex-1 space-y-3 mb-4 overflow-y-auto">
              {comments.length === 0 ? (
                <div className="text-center text-[#e5e4e2]/40 py-12 text-sm">
                  Brak komentarzy. Dodaj pierwszy komentarz.
                </div>
              ) : (
                comments.map((comment) => (
                  <div key={comment.id} className="flex items-start gap-3 py-2 hover:bg-[#1c1f33]/30 rounded-lg px-2 -mx-2 transition-colors">
                    <div
                      className="w-8 h-8 rounded-full bg-[#d3bb73]/20 flex items-center justify-center overflow-hidden flex-shrink-0"
                    >
                      {comment.employees.avatar_url ? (
                        <img
                          src={comment.employees.avatar_url}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="text-xs text-[#e5e4e2]">
                          {comment.employees.name[0]}{comment.employees.surname[0]}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 mb-1">
                        <span className="text-sm font-medium text-[#e5e4e2]">
                          {comment.employees.name} {comment.employees.surname}
                        </span>
                        <span className="text-xs text-[#e5e4e2]/40">
                          {new Date(comment.created_at).toLocaleString('pl-PL', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                      <p className="text-sm text-[#e5e4e2] whitespace-pre-wrap leading-relaxed">{comment.content}</p>
                    </div>
                  </div>
                ))
              )}
              <div ref={commentsEndRef} />
            </div>

            <div className="flex gap-2 pt-3 border-t border-[#d3bb73]/10">
              <div
                className="w-8 h-8 rounded-full bg-[#d3bb73]/20 flex items-center justify-center overflow-hidden flex-shrink-0"
              >
                {currentEmployee?.avatar_url ? (
                  <img
                    src={currentEmployee.avatar_url}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-xs text-[#e5e4e2]">
                    {currentEmployee?.name?.[0]}{currentEmployee?.surname?.[0]}
                  </span>
                )}
              </div>
              <div className="flex-1 flex gap-2">
                <input
                  type="text"
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendComment();
                    }
                  }}
                  placeholder="Napisz komentarz..."
                  className="flex-1 bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-3 py-2 text-sm text-[#e5e4e2] placeholder:text-[#e5e4e2]/40 focus:outline-none focus:border-[#d3bb73]/30"
                />
                <button
                  onClick={handleSendComment}
                  disabled={!newComment.trim()}
                  className="px-3 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'files' && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <input
                ref={fileInputRef}
                type="file"
                onChange={handleFileUpload}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingFile}
                className="flex items-center gap-2 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors disabled:opacity-50 text-sm"
              >
                <Upload className="w-4 h-4" />
                {uploadingFile ? 'Przesyłanie...' : 'Dodaj plik'}
              </button>
            </div>

            {attachments.length === 0 ? (
              <div className="text-center text-[#e5e4e2]/40 py-12 text-sm">
                Brak plików. Dodaj pierwszy plik.
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {attachments.map((attachment) => (
                  <div
                    key={attachment.id}
                    className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-lg overflow-hidden group hover:border-[#d3bb73]/30 transition-colors"
                  >
                    {isImage(attachment.file_type) ? (
                      <div className="w-full aspect-square bg-[#0f1119] relative group">
                        <img
                          src={attachment.file_url}
                          alt={attachment.file_name}
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                          <a
                            href={attachment.file_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
                            title="Pobierz"
                          >
                            <Download className="w-4 h-4" />
                          </a>
                          <button
                            onClick={() => handleDeleteAttachment(attachment.id, attachment.file_url)}
                            className="p-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
                            title="Usuń"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="w-full aspect-square bg-[#0f1119] flex flex-col items-center justify-center relative group">
                        <FileText className="w-12 h-12 text-[#e5e4e2]/20 mb-2" />
                        <span className="text-xs text-[#e5e4e2]/60 font-medium">
                          {attachment.file_name.split('.').pop()?.toUpperCase()}
                        </span>
                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                          <a
                            href={attachment.file_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
                            title="Pobierz"
                          >
                            <Download className="w-4 h-4" />
                          </a>
                          <button
                            onClick={() => handleDeleteAttachment(attachment.id, attachment.file_url)}
                            className="p-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
                            title="Usuń"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="p-2">
                      <h4 className="text-xs text-[#e5e4e2] truncate mb-1" title={attachment.file_name}>
                        {attachment.file_name}
                      </h4>
                      <div className="flex items-center justify-between text-xs text-[#e5e4e2]/40">
                        <span>{formatFileSize(attachment.file_size)}</span>
                        <span>{attachment.employees.name[0]}{attachment.employees.surname[0]}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
