import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  Image,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Modal,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { colors, spacing, typography, borderRadius } from '../theme';
import EmployeeAvatar from '../components/EmployeeAvatar';
import { SearchableDropdown } from '@/components/SearchableDropdown';

interface TaskDetailScreenProps {
  route: {
    params: {
      taskId: string;
    };
  };
  navigation: any;
}

interface Task {
  id: string;
  title: string;
  description: string | null;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: string;
  due_date: string | null;
  event_id: string | null;
  created_at: string;
}

interface Comment {
  id: string;
  content: string;
  created_at: string;
  employees: {
    name: string;
    surname: string;
  };
}

interface AvailableEmployee {
  id: string;
  name: string;
  surname: string | null;
  avatar_url: string | null;
  avatar_metadata?: any;
}

interface Attachment {
  id: string;
  file_name: string;
  file_type: string;
  file_size: number;
  is_linked: boolean;
  created_at: string;
  employees: {
    name: string;
    surname: string;
  };
}

interface Assignee {
  employee_id: string;
  employees: {
    id: string;
    name: string;
    surname: string | null;
    avatar_url: string | null;
    avatar_metadata: any;
  };
}

const priorityColors = {
  low: { bg: colors.background.tertiary, text: colors.text.secondary },
  medium: { bg: '#1e3a8a20', text: '#3b82f6' },
  high: { bg: '#ea580c20', text: '#f97316' },
  urgent: { bg: '#dc262620', text: '#ef4444' },
};

const priorityLabels = {
  low: 'Niski',
  medium: 'Średni',
  high: 'Wysoki',
  urgent: 'Pilne',
};

const PRIORITY_OPTIONS: Task['priority'][] = ['low', 'medium', 'high', 'urgent'];

const STATUS_OPTIONS: { id: string; label: string; color: string }[] = [
  { id: 'todo', label: 'Do zrobienia', color: '#94a3b8' },
  { id: 'in_progress', label: 'W trakcie', color: '#3b82f6' },
  { id: 'review', label: 'Do sprawdzenia', color: '#f59e0b' },
  { id: 'done', label: 'Zakończone', color: '#10b981' },
];

export default function TaskDetailScreen({ route, navigation }: TaskDetailScreenProps) {
  const { taskId } = route.params;
  const { employee } = useAuth();
  const [task, setTask] = useState<Task | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [activeTab, setActiveTab] = useState<'details' | 'comments' | 'files'>('details');
  const [showEditModal, setShowEditModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editPriority, setEditPriority] = useState<Task['priority']>('medium');
  const [editStatus, setEditStatus] = useState<string>('todo');
  const [availableEmployees, setAvailableEmployees] = useState<AvailableEmployee[]>([]);
  const [editAssigneeIds, setEditAssigneeIds] = useState<Set<string>>(new Set());
  const [openedDropdown, setOpenedDropdown] = useState<string | null>(null);
  const [employeeSearch, setEmployeeSearch] = useState('');

  useEffect(() => {
    fetchTask();
    fetchComments();
    fetchAttachments();
    fetchAssignees();

    // Subscribe to realtime updates
    const commentsChannel = supabase
      .channel(`task_comments_changes_${taskId}`)
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
        },
      )
      .subscribe();

    const assigneesChannel = supabase
      .channel(`task_assignees_changes_${taskId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'task_assignees',
          filter: `task_id=eq.${taskId}`,
        },
        () => {
          fetchAssignees();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(commentsChannel);
      supabase.removeChannel(assigneesChannel);
    };
  }, [taskId]);

  const fetchTask = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase.from('tasks').select('*').eq('id', taskId).single();

      if (error) throw error;
      setTask(data);
    } catch (error) {
      console.error('Error fetching task:', error);
      Alert.alert('Błąd', 'Nie udało się załadować zadania');
    } finally {
      setLoading(false);
    }
  };

  const fetchComments = async () => {
    try {
      const { data: commentsData, error } = await supabase
        .from('task_comments')
        .select(
          `
          id,
          content,
          created_at,
          employees:employee_id (
            name,
            surname
          )
        `,
        )
        .eq('task_id', taskId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setComments((commentsData as unknown as Comment[]) || []);
    } catch (error) {
      console.error('Error fetching comments:', error);
    }
  };

  const fetchAssignees = async () => {
    try {
      const { data, error } = await supabase
        .from('task_assignees')
        .select(
          `
          employee_id,
          employees:employee_id (
            id,
            name,
            surname,
            avatar_url,
            avatar_metadata
          )
        `,
        )
        .eq('task_id', taskId);

      if (error) throw error;
      setAssignees((data as unknown as Assignee[]) || []);
    } catch (error) {
      console.error('Error fetching assignees:', error);
    }
  };

  const fetchAttachments = async () => {
    try {
      const { data, error } = await supabase
        .from('task_attachments')
        .select(
          `
          id,
          file_name,
          file_type,
          file_size,
          is_linked,
          created_at,
          employees:uploaded_by (
            name,
            surname
          )
        `,
        )
        .eq('task_id', taskId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setAttachments((data as unknown as Attachment[]) || ([] as any));
    } catch (error) {
      console.error('Error fetching attachments:', error);
    }
  };

  const handleSendComment = async () => {
    if (!newComment.trim() || !employee) return;

    try {
      const { error } = await supabase.from('task_comments').insert({
        task_id: taskId,
        employee_id: employee.id,
        content: newComment.trim(),
      });

      if (error) throw error;

      setNewComment('');
      fetchComments();
    } catch (error) {
      console.error('Error adding comment:', error);
      Alert.alert('Błąd', 'Nie udało się dodać komentarza');
    }
  };

  const openEditModal = () => {
    if (!task) return;
    setEditTitle(task.title);
    setEditDescription(task.description || '');
    setEditPriority(task.priority);
    setEditStatus(task.status);
    setEditAssigneeIds(new Set(assignees.map((a) => a.employee_id)));
    setShowEditModal(true);
    (async () => {
      const { data } = await supabase
        .from('employees')
        .select('id, name, surname, avatar_url, avatar_metadata')
        .order('name')
        .limit(200);
      setAvailableEmployees((data as any[]) || []);
    })();
  };

  const toggleEditAssignee = (id: string) => {
    setEditAssigneeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectEmployee = (selectedEmployee: AvailableEmployee) => {
    setEditAssigneeIds((prev) => {
      const next = new Set(prev);
      next.add(selectedEmployee.id);
      return next;
    });

    setEmployeeSearch('');
    setOpenedDropdown(null);
  };

  const handleSaveEdit = async () => {
    if (!task) return;
    const title = editTitle.trim();
    if (!title) {
      Alert.alert('Błąd', 'Tytuł zadania nie może być pusty');
      return;
    }
    try {
      setSaving(true);
      const { error } = await supabase
        .from('tasks')
        .update({
          title,
          description: editDescription.trim() || null,
          priority: editPriority,
          status: editStatus,
        })
        .eq('id', task.id);
      if (error) throw error;

      const currentIds = new Set(assignees.map((a) => a.employee_id));
      const nextIds = editAssigneeIds;
      const toAdd = [...nextIds].filter((id) => !currentIds.has(id));
      const toRemove = [...currentIds].filter((id) => !nextIds.has(id));

      if (toRemove.length > 0) {
        const { error: delError } = await supabase
          .from('task_assignees')
          .delete()
          .eq('task_id', task.id)
          .in('employee_id', toRemove);
        if (delError) throw delError;
      }

      if (toAdd.length > 0) {
        const rows = toAdd.map((employee_id) => ({
          task_id: task.id,
          employee_id,
        }));
        const { error: insError } = await supabase.from('task_assignees').insert(rows);
        if (insError) throw insError;
      }

      setShowEditModal(false);
      await Promise.all([fetchTask(), fetchAssignees()]);
    } catch (error) {
      console.error('Error updating task:', error);
      Alert.alert('Błąd', 'Nie udało się zaktualizować zadania');
    } finally {
      setSaving(false);
    }
  };

  const selectableEmployees = availableEmployees.filter((emp) => !editAssigneeIds.has(emp.id));

  const selectedEmployees = availableEmployees.filter((emp) => editAssigneeIds.has(emp.id));

  const handleDeleteTask = () => {
    if (!task) return;
    Alert.alert(
      'Usuń zadanie',
      'Czy na pewno chcesz usunąć to zadanie? Tej operacji nie można cofnąć.',
      [
        { text: 'Anuluj', style: 'cancel' },
        {
          text: 'Usuń',
          style: 'destructive',
          onPress: async () => {
            try {
              setDeleting(true);
              const { error } = await supabase.from('tasks').delete().eq('id', task.id);
              if (error) throw error;
              navigation.goBack();
            } catch (error) {
              console.error('Error deleting task:', error);
              Alert.alert('Błąd', 'Nie udało się usunąć zadania');
              setDeleting(false);
            }
          },
        },
      ],
    );
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchTask(), fetchComments(), fetchAttachments(), fetchAssignees()]);
    setRefreshing(false);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('pl-PL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary.gold} />
      </View>
    );
  }

  if (!task) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.errorText}>Nie znaleziono zadania</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 0}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Feather name="arrow-left" size={24} color={colors.text.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {task.title}
        </Text>
        <TouchableOpacity onPress={openEditModal} style={styles.headerAction} disabled={deleting}>
          <Feather name="edit-2" size={20} color={colors.primary.gold} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleDeleteTask}
          style={styles.headerAction}
          disabled={deleting}
        >
          {deleting ? (
            <ActivityIndicator size="small" color={colors.status.error} />
          ) : (
            <Feather name="trash-2" size={20} color={colors.status.error} />
          )}
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={styles.tabsContainer}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'details' && styles.tabActive]}
          onPress={() => setActiveTab('details')}
        >
          <Feather
            name="info"
            size={16}
            color={activeTab === 'details' ? colors.primary.gold : colors.text.tertiary}
          />
          <Text style={[styles.tabText, activeTab === 'details' && styles.tabTextActive]}>
            Szczegóły
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'comments' && styles.tabActive]}
          onPress={() => setActiveTab('comments')}
        >
          <Feather
            name="message-square"
            size={16}
            color={activeTab === 'comments' ? colors.primary.gold : colors.text.tertiary}
          />
          <Text style={[styles.tabText, activeTab === 'comments' && styles.tabTextActive]}>
            Czat ({comments.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'files' && styles.tabActive]}
          onPress={() => setActiveTab('files')}
        >
          <Feather
            name="file"
            size={16}
            color={activeTab === 'files' ? colors.primary.gold : colors.text.tertiary}
          />
          <Text style={[styles.tabText, activeTab === 'files' && styles.tabTextActive]}>
            Pliki ({attachments.length})
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary.gold}
          />
        }
      >
        {activeTab === 'details' && (
          <View style={styles.detailsContainer}>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Informacje podstawowe</Text>

              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Priorytet:</Text>
                <View
                  style={[
                    styles.priorityBadge,
                    { backgroundColor: priorityColors[task.priority].bg },
                  ]}
                >
                  <Text
                    style={[styles.priorityText, { color: priorityColors[task.priority].text }]}
                  >
                    {priorityLabels[task.priority]}
                  </Text>
                </View>
              </View>

              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Status:</Text>
                <Text style={styles.infoValue}>{task.status}</Text>
              </View>

              {task.due_date && (
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Termin:</Text>
                  <Text style={styles.infoValue}>{formatDate(task.due_date)}</Text>
                </View>
              )}
              <View style={styles.assigneesSection}>
                <View style={styles.assigneesHeader}>
                  <Text style={styles.infoLabel}>Przypisane osoby:</Text>

                  {assignees.length > 0 && (
                    <Text style={styles.assigneesCount}>{assignees.length}</Text>
                  )}
                </View>

                {assignees.length === 0 ? (
                  <Text style={styles.emptyInline}>Brak przypisanych osób</Text>
                ) : (
                  <View style={styles.avatarStack}>
                    {assignees.slice(0, 5).map((assignee, index) => {
                      const emp = assignee.employees;

                      if (!emp) {
                        return null;
                      }

                      const displayName =
                        [emp.name, emp.surname].filter(Boolean).join(' ') || 'Pracownik';

                      return (
                        <View
                          key={assignee.employee_id}
                          style={[
                            styles.avatarStackItem,
                            index > 0 && styles.avatarStackItemOverlap,
                            {
                              zIndex: assignees.length - index,
                            },
                          ]}
                        >
                          <EmployeeAvatar
                            avatarUrl={emp.avatar_url}
                            avatarMetadata={emp.avatar_metadata}
                            employeeName={displayName}
                            size={38}
                          />
                        </View>
                      );
                    })}

                    {assignees.length > 5 && (
                      <View
                        style={[
                          styles.avatarStackItem,
                          styles.avatarStackItemOverlap,
                          styles.remainingAssignees,
                        ]}
                      >
                        <Text style={styles.remainingAssigneesText}>+{assignees.length - 5}</Text>
                      </View>
                    )}
                  </View>
                )}
              </View>
            </View>

            {task.description && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Opis</Text>
                <Text style={styles.description}>{task.description}</Text>
              </View>
            )}
          </View>
        )}

        {activeTab === 'comments' && (
          <View style={styles.commentsContainer}>
            {comments.length === 0 ? (
              <Text style={styles.emptyText}>Brak komentarzy</Text>
            ) : (
              comments.map((comment) => (
                <View key={comment.id} style={styles.commentCard}>
                  <View style={styles.commentHeader}>
                    <Text style={styles.commentAuthor}>
                      {comment.employees.name} {comment.employees.surname}
                    </Text>
                    <Text style={styles.commentDate}>{formatDate(comment.created_at)}</Text>
                  </View>
                  <Text style={styles.commentText}>{comment.content}</Text>
                </View>
              ))
            )}
          </View>
        )}

        {activeTab === 'files' && (
          <View style={styles.filesContainer}>
            {attachments.length === 0 ? (
              <Text style={styles.emptyText}>Brak plików</Text>
            ) : (
              attachments.map((attachment) => (
                <View key={attachment.id} style={styles.fileCard}>
                  <View style={styles.fileIcon}>
                    <Feather name="file" size={24} color={colors.primary.gold} />
                  </View>
                  <View style={styles.fileInfo}>
                    <Text style={styles.fileName} numberOfLines={1}>
                      {attachment.file_name}
                    </Text>
                    <View style={styles.fileMetaRow}>
                      <Text style={styles.fileMeta}>{formatFileSize(attachment.file_size)}</Text>
                      {attachment.is_linked && (
                        <View style={styles.linkedBadge}>
                          <Feather name="link" size={10} color={colors.primary.gold} />
                          <Text style={styles.linkedText}>Z wydarzenia</Text>
                        </View>
                      )}
                    </View>
                  </View>
                </View>
              ))
            )}
          </View>
        )}
      </ScrollView>

      {/* Comment Input */}
      {activeTab === 'comments' && (
        <View style={styles.commentInputContainer}>
          <TextInput
            style={styles.commentInput}
            value={newComment}
            onChangeText={setNewComment}
            placeholder="Napisz komentarz..."
            placeholderTextColor={colors.text.tertiary}
            multiline
          />
          <TouchableOpacity
            style={[styles.sendButton, !newComment.trim() && styles.sendButtonDisabled]}
            onPress={handleSendComment}
            disabled={!newComment.trim()}
          >
            <Feather name="send" size={20} color={colors.text.primary} />
          </TouchableOpacity>
        </View>
      )}
      {/* Edit Modal */}
      <Modal
        visible={showEditModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowEditModal(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edytuj zadanie</Text>
              <TouchableOpacity onPress={() => setShowEditModal(false)} disabled={saving}>
                <Feather name="x" size={24} color={colors.text.primary} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
              <Text style={styles.formLabel}>Tytuł</Text>
              <TextInput
                style={styles.formInput}
                value={editTitle}
                onChangeText={setEditTitle}
                placeholder="Tytuł zadania"
                placeholderTextColor={colors.text.tertiary}
              />

              <Text style={styles.formLabel}>Opis</Text>
              <TextInput
                style={[styles.formInput, styles.formInputMultiline]}
                value={editDescription}
                onChangeText={setEditDescription}
                placeholder="Opcjonalny opis"
                placeholderTextColor={colors.text.tertiary}
                multiline
              />

              <Text style={styles.formLabel}>Priorytet</Text>
              <View style={styles.chipRow}>
                {PRIORITY_OPTIONS.map((p) => {
                  const active = editPriority === p;
                  return (
                    <TouchableOpacity
                      key={p}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: active
                            ? priorityColors[p].bg
                            : colors.background.primary,
                          borderColor: active ? priorityColors[p].text : colors.border.default,
                        },
                      ]}
                      onPress={() => setEditPriority(p)}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          {
                            color: active ? priorityColors[p].text : colors.text.secondary,
                          },
                        ]}
                      >
                        {priorityLabels[p]}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.formLabel}>Status</Text>
              <View style={styles.chipRow}>
                {STATUS_OPTIONS.map((s) => {
                  const active = editStatus === s.id;
                  return (
                    <TouchableOpacity
                      key={s.id}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: active ? `${s.color}30` : colors.background.primary,
                          borderColor: active ? s.color : colors.border.default,
                        },
                      ]}
                      onPress={() => setEditStatus(s.id)}
                    >
                      <View style={[styles.chipDot, { backgroundColor: s.color }]} />
                      <Text
                        style={[
                          styles.chipText,
                          {
                            color: active ? colors.text.primary : colors.text.secondary,
                          },
                        ]}
                      >
                        {s.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <View style={styles.employeePickerSection}>
                {availableEmployees.length === 0 ? (
                  <View style={styles.employeeEmpty}>
                    <ActivityIndicator size="small" color={colors.primary.gold} />
                  </View>
                ) : (
                  <>
                    <SearchableDropdown<AvailableEmployee>
                      dropdownId="task-assignees"
                      openedDropdown={openedDropdown}
                      setOpenedDropdown={setOpenedDropdown}
                      label={`Przypisani pracownicy (${editAssigneeIds.size})`}
                      placeholder="Wyszukaj pracownika..."
                      items={selectableEmployees}
                      textValue={employeeSearch}
                      onTextChange={setEmployeeSearch}
                      onSelect={handleSelectEmployee}
                      onClear={() => {
                        setEmployeeSearch('');
                      }}
                      renderItem={(emp) => [emp.name, emp.surname].filter(Boolean).join(' ')}
                      getFilterText={(emp) => [emp.name, emp.surname].filter(Boolean).join(' ')}
                      selectedLabel={null}
                      icon="user"
                    />

                    {selectedEmployees.length > 0 && (
                      <View style={styles.selectedEmployeesList}>
                        {selectedEmployees.map((emp) => {
                          const fullName =
                            [emp.name, emp.surname].filter(Boolean).join(' ') || 'Pracownik';

                          return (
                            <View key={emp.id} style={styles.selectedEmployeeRow}>
                              <EmployeeAvatar
                                avatarUrl={emp.avatar_url}
                                avatarMetadata={emp.avatar_metadata}
                                employeeName={fullName}
                                size={34}
                              />

                              <Text style={styles.selectedEmployeeName} numberOfLines={1}>
                                {fullName}
                              </Text>

                              <TouchableOpacity
                                style={styles.removeEmployeeButton}
                                onPress={() => toggleEditAssignee(emp.id)}
                                hitSlop={{
                                  top: 8,
                                  right: 8,
                                  bottom: 8,
                                  left: 8,
                                }}
                              >
                                <Feather name="x" size={17} color={colors.text.tertiary} />
                              </TouchableOpacity>
                            </View>
                          );
                        })}
                      </View>
                    )}

                    {editAssigneeIds.size === 0 && (
                      <Text style={styles.noSelectedEmployees}>
                        Nie przypisano żadnego pracownika
                      </Text>
                    )}
                  </>
                )}
              </View>
            </ScrollView>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonSecondary]}
                onPress={() => setShowEditModal(false)}
                disabled={saving}
              >
                <Text style={styles.modalButtonSecondaryText}>Anuluj</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalButton,
                  styles.modalButtonPrimary,
                  (saving || !editTitle.trim()) && styles.modalButtonDisabled,
                ]}
                onPress={handleSaveEdit}
                disabled={saving || !editTitle.trim()}
              >
                {saving ? (
                  <ActivityIndicator size="small" color={colors.text.primary} />
                ) : (
                  <Text style={styles.modalButtonPrimaryText}>Zapisz</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background.primary,
  },
  errorText: {
    color: colors.status.error,
    fontSize: typography.fontSizes.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    paddingTop: spacing.xxl,
    backgroundColor: colors.background.secondary,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
  },
  backButton: {
    marginRight: spacing.md,
  },
  headerTitle: {
    flex: 1,
    fontSize: typography.fontSizes.lg,
    fontWeight: typography.fontWeights.bold,
    color: colors.text.primary,
  },
  tabsContainer: {
    flexDirection: 'row',
    backgroundColor: colors.background.secondary,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    gap: spacing.xs,
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: colors.primary.gold,
  },
  tabText: {
    fontSize: typography.fontSizes.sm,
    color: colors.text.tertiary,
  },
  tabTextActive: {
    color: colors.primary.gold,
    fontWeight: typography.fontWeights.semibold,
  },
  content: {
    flex: 1,
  },
  detailsContainer: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  card: {
    backgroundColor: colors.background.secondary,
    borderRadius: borderRadius.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  cardTitle: {
    fontSize: typography.fontSizes.md,
    fontWeight: typography.fontWeights.semibold,
    color: colors.text.primary,
    marginBottom: spacing.md,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  infoLabel: {
    fontSize: typography.fontSizes.sm,
    color: colors.text.secondary,
  },
  infoValue: {
    fontSize: typography.fontSizes.sm,
    color: colors.text.primary,
    fontWeight: typography.fontWeights.medium,
  },
  priorityBadge: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
  },
  priorityText: {
    fontSize: typography.fontSizes.xs,
    fontWeight: typography.fontWeights.semibold,
  },
  description: {
    fontSize: typography.fontSizes.sm,
    color: colors.text.primary,
    lineHeight: 20,
  },
  commentsContainer: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  commentCard: {
    backgroundColor: colors.background.secondary,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  commentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  commentAuthor: {
    fontSize: typography.fontSizes.sm,
    fontWeight: typography.fontWeights.semibold,
    color: colors.text.primary,
  },
  commentDate: {
    fontSize: typography.fontSizes.xs,
    color: colors.text.tertiary,
  },
  commentText: {
    fontSize: typography.fontSizes.sm,
    color: colors.text.secondary,
    lineHeight: 20,
  },
  filesContainer: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  fileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background.secondary,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border.default,
    gap: spacing.md,
  },
  fileIcon: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.md,
    backgroundColor: colors.background.tertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileInfo: {
    flex: 1,
  },
  fileName: {
    fontSize: typography.fontSizes.sm,
    fontWeight: typography.fontWeights.medium,
    color: colors.text.primary,
    marginBottom: spacing.xs,
  },
  fileMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  fileMeta: {
    fontSize: typography.fontSizes.xs,
    color: colors.text.tertiary,
  },
  linkedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary.gold + '20',
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  linkedText: {
    fontSize: 10,
    color: colors.primary.gold,
  },
  emptyText: {
    textAlign: 'center',
    color: colors.text.tertiary,
    fontSize: typography.fontSizes.sm,
    paddingVertical: spacing.xxl,
  },
  commentInputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: spacing.md,
    backgroundColor: colors.background.secondary,
    borderTopWidth: 1,
    borderTopColor: colors.border.default,
    gap: spacing.sm,
  },
  commentInput: {
    flex: 1,
    backgroundColor: colors.background.primary,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border.default,
    padding: spacing.md,
    color: colors.text.primary,
    fontSize: typography.fontSizes.sm,
    maxHeight: 100,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.md,
    backgroundColor: colors.primary.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  emptyInline: {
    fontSize: typography.fontSizes.sm,
    color: colors.text.tertiary,
  },
  assigneesList: {
    gap: spacing.md,
  },
  assigneeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  assigneeName: {
    flex: 1,
    fontSize: typography.fontSizes.sm,
    color: colors.text.primary,
    fontWeight: typography.fontWeights.medium,
  },
  assigneesSection: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border.default,
  },

  assigneesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },

  assigneesCount: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: 10,
    backgroundColor: colors.background.tertiary,
    color: colors.text.secondary,
    fontSize: typography.fontSizes.xs,
    textAlign: 'center',
    lineHeight: 20,
  },

  avatarStack: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 42,
    paddingLeft: 2,
  },

  avatarStackItem: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background.secondary,
    borderWidth: 2,
    borderColor: colors.background.secondary,
  },

  avatarStackItemOverlap: {
    marginLeft: -12,
  },

  remainingAssignees: {
    backgroundColor: colors.background.tertiary,
  },

  remainingAssigneesText: {
    fontSize: typography.fontSizes.xs,
    fontWeight: typography.fontWeights.semibold,
    color: colors.text.primary,
  },
  headerAction: {
    marginLeft: spacing.sm,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: colors.background.secondary,
    borderTopLeftRadius: borderRadius.lg,
    borderTopRightRadius: borderRadius.lg,
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
  },
  modalTitle: {
    fontSize: typography.fontSizes.lg,
    fontWeight: typography.fontWeights.bold,
    color: colors.text.primary,
  },
  modalBody: {
    padding: spacing.lg,
  },
  formLabel: {
    fontSize: typography.fontSizes.sm,
    fontWeight: typography.fontWeights.semibold,
    color: colors.text.secondary,
    marginBottom: spacing.xs,
    marginTop: spacing.md,
  },
  formInput: {
    backgroundColor: colors.background.primary,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border.default,
    padding: spacing.md,
    color: colors.text.primary,
    fontSize: typography.fontSizes.sm,
  },
  formInputMultiline: {
    minHeight: 90,
    textAlignVertical: 'top',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    gap: spacing.xs,
  },
  chipDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  chipText: {
    fontSize: typography.fontSizes.xs,
    fontWeight: typography.fontWeights.medium,
  },
  modalFooter: {
    flexDirection: 'row',
    padding: spacing.lg,
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border.default,
  },
  modalButton: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalButtonSecondary: {
    backgroundColor: colors.background.primary,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  modalButtonSecondaryText: {
    color: colors.text.secondary,
    fontSize: typography.fontSizes.sm,
    fontWeight: typography.fontWeights.medium,
  },
  modalButtonPrimary: {
    backgroundColor: colors.primary.gold,
  },
  modalButtonPrimaryText: {
    color: colors.text.primary,
    fontSize: typography.fontSizes.sm,
    fontWeight: typography.fontWeights.semibold,
  },
  modalButtonDisabled: {
    opacity: 0.5,
  },
  employeeList: {
    gap: spacing.xs,
  },
  employeeEmpty: {
    padding: spacing.md,
    alignItems: 'center',
  },
  employeeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border.default,
    backgroundColor: colors.background.primary,
    gap: spacing.sm,
  },
  employeeRowActive: {
    borderColor: colors.primary.gold,
    backgroundColor: `${colors.primary.gold}15`,
  },
  employeeAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  employeeAvatarPlaceholder: {
    backgroundColor: colors.background.tertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  employeeInitials: {
    fontSize: typography.fontSizes.xs,
    fontWeight: typography.fontWeights.bold,
    color: colors.text.primary,
  },
  employeeName: {
    flex: 1,
    fontSize: typography.fontSizes.sm,
    color: colors.text.primary,
    fontWeight: typography.fontWeights.medium,
  },
  employeeCheck: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: colors.border.default,
    alignItems: 'center',
    justifyContent: 'center',
  },
  employeeCheckActive: {
    backgroundColor: colors.primary.gold,
    borderColor: colors.primary.gold,
  },

  employeePickerSection: {
    marginTop: spacing.md,
  },

  selectedEmployeesList: {
    gap: spacing.xs,
    marginTop: spacing.xs,
  },

  selectedEmployeeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: borderRadius.md,
    backgroundColor: colors.background.primary,
  },

  selectedEmployeeName: {
    flex: 1,
    fontSize: typography.fontSizes.sm,
    fontWeight: typography.fontWeights.medium,
    color: colors.text.primary,
  },

  removeEmployeeButton: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.full,
    backgroundColor: colors.background.tertiary,
  },

  noSelectedEmployees: {
    marginTop: spacing.xs,
    fontSize: typography.fontSizes.xs,
    color: colors.text.tertiary,
  },
});
