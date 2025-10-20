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
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { colors, spacing, typography, borderRadius } from '../theme';

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

export default function TaskDetailScreen({ route, navigation }: TaskDetailScreenProps) {
  const { taskId } = route.params;
  const { employee } = useAuth();
  const [task, setTask] = useState<Task | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [activeTab, setActiveTab] = useState<'details' | 'comments' | 'files'>('details');

  useEffect(() => {
    fetchTask();
    fetchComments();
    fetchAttachments();

    // Subscribe to realtime updates
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

    return () => {
      supabase.removeChannel(commentsChannel);
    };
  }, [taskId]);

  const fetchTask = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .eq('id', taskId)
        .single();

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
        .select(`
          id,
          content,
          created_at,
          employees:employee_id (
            name,
            surname
          )
        `)
        .eq('task_id', taskId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setComments(commentsData || []);
    } catch (error) {
      console.error('Error fetching comments:', error);
    }
  };

  const fetchAttachments = async () => {
    try {
      const { data, error } = await supabase
        .from('task_attachments')
        .select(`
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
    if (!newComment.trim() || !employee) return;

    try {
      const { error } = await supabase
        .from('task_comments')
        .insert({
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

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchTask(), fetchComments(), fetchAttachments()]);
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
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Feather name="arrow-left" size={24} color={colors.text.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {task.title}
        </Text>
      </View>

      {/* Tabs */}
      <View style={styles.tabsContainer}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'details' && styles.tabActive]}
          onPress={() => setActiveTab('details')}
        >
          <Feather name="info" size={16} color={activeTab === 'details' ? colors.primary.gold : colors.text.tertiary} />
          <Text style={[styles.tabText, activeTab === 'details' && styles.tabTextActive]}>
            Szczegóły
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'comments' && styles.tabActive]}
          onPress={() => setActiveTab('comments')}
        >
          <Feather name="message-square" size={16} color={activeTab === 'comments' ? colors.primary.gold : colors.text.tertiary} />
          <Text style={[styles.tabText, activeTab === 'comments' && styles.tabTextActive]}>
            Czat ({comments.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'files' && styles.tabActive]}
          onPress={() => setActiveTab('files')}
        >
          <Feather name="file" size={16} color={activeTab === 'files' ? colors.primary.gold : colors.text.tertiary} />
          <Text style={[styles.tabText, activeTab === 'files' && styles.tabTextActive]}>
            Pliki ({attachments.length})
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary.gold} />
        }
      >
        {activeTab === 'details' && (
          <View style={styles.detailsContainer}>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Informacje podstawowe</Text>

              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Priorytet:</Text>
                <View style={[styles.priorityBadge, { backgroundColor: priorityColors[task.priority].bg }]}>
                  <Text style={[styles.priorityText, { color: priorityColors[task.priority].text }]}>
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
                          <Feather name="link" size={10} color={colors.primary.burgundy} />
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
    </View>
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
    backgroundColor: colors.primary.burgundy + '20',
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  linkedText: {
    fontSize: 10,
    color: colors.primary.burgundy,
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
});
