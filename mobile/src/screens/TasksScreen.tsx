import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  Dimensions,
  Modal,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, typography } from '../theme';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import EmployeeAvatar from '../components/EmployeeAvatar';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const COLUMN_WIDTH = SCREEN_WIDTH - 32;

interface Task {
  id: string;
  title: string;
  description: string | null;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: string;
  board_column: string;
  due_date: string | null;
  created_at: string;
  task_assignees: {
    employee_id: string;
    employees: {
      name: string;
      surname: string;
      avatar_url: string | null;
      avatar_metadata: any;
    };
  }[];
}

const priorityColors = {
  low: colors.text.secondary,
  medium: '#3b82f6',
  high: '#f97316',
  urgent: '#ef4444',
};

const priorityLabels = {
  low: 'Niski',
  medium: 'Średni',
  high: 'Wysoki',
  urgent: 'Pilne',
};

const BOARD_COLUMNS = [
  { id: 'todo', title: 'Do zrobienia', color: '#eab308' },
  { id: 'in_progress', title: 'W trakcie', color: '#3b82f6' },
  { id: 'review', title: 'Sprawdzenie', color: '#a855f7' },
  { id: 'completed', title: 'Zakończone', color: '#10b981' },
];

export default function TasksScreen() {
  const navigation = useNavigation();
  const { employee } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [showColumnPicker, setShowColumnPicker] = useState(false);

  useEffect(() => {
    if (employee) {
      fetchTasks();
    }

    const channel = supabase
      .channel('tasks_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tasks',
        },
        () => {
          if (employee) {
            fetchTasks();
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [employee]);

  const fetchTasks = async () => {
    try {
      if (!employee) return;

      // Fetch tasks where employee is creator
      const { data: createdTasks, error: error1 } = await supabase
        .from('tasks')
        .select('*')
        .eq('created_by', employee.id)
        .eq('is_private', false)
        .is('event_id', null);

      if (error1) throw error1;

      // Fetch tasks where employee is assigned
      const { data: assignedTasksData, error: error2 } = await supabase
        .from('task_assignees')
        .select('task_id')
        .eq('employee_id', employee.id);

      if (error2) throw error2;

      // Get unique task IDs
      const assignedTaskIds = assignedTasksData?.map((ta) => ta.task_id) || [];

      // Fetch assigned tasks
      let assignedTasks: any[] = [];
      if (assignedTaskIds.length > 0) {
        const { data: fetchedTasks, error: error3 } = await supabase
          .from('tasks')
          .select('*')
          .in('id', assignedTaskIds)
          .eq('is_private', false)
          .is('event_id', null);

        if (error3) throw error3;
        assignedTasks = fetchedTasks || [];
      }

      // Combine and deduplicate
      const allTasks = [...(createdTasks || []), ...assignedTasks];
      const uniqueTasks = Array.from(new Map(allTasks.map((task) => [task.id, task])).values());

      // Fetch assignees for all tasks
      const taskIds = uniqueTasks.map((t) => t.id);
      if (taskIds.length > 0) {
        const { data: assigneesData, error: error4 } = await supabase
          .from('task_assignees')
          .select('task_id, employee_id')
          .in('task_id', taskIds);

        if (error4) throw error4;

        // Fetch employee details
        const employeeIds = [...new Set(assigneesData?.map((a) => a.employee_id) || [])];
        if (employeeIds.length > 0) {
          const { data: employeesData, error: error5 } = await supabase
            .from('employees')
            .select('id, name, surname, avatar_url, avatar_metadata')
            .in('id', employeeIds);

          if (error5) throw error5;

          // Map employees by ID
          const employeesMap = new Map(employeesData?.map((e) => [e.id, e]) || []);

          // Attach assignees to tasks
          uniqueTasks.forEach((task) => {
            const taskAssignees = assigneesData?.filter((a) => a.task_id === task.id) || [];
            task.task_assignees = taskAssignees.map((ta) => ({
              employee_id: ta.employee_id,
              employees: employeesMap.get(ta.employee_id),
            }));
          });
        }
      }

      uniqueTasks.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );

      setTasks(uniqueTasks);
    } catch (error) {
      console.error('Error fetching tasks:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    fetchTasks();
  };

  const moveTask = async (taskId: string, newColumn: string) => {
    try {
      const { error } = await supabase
        .from('tasks')
        .update({ board_column: newColumn })
        .eq('id', taskId);

      if (error) throw error;

      // Update local state
      setTasks((prev) =>
        prev.map((task) => (task.id === taskId ? { ...task, board_column: newColumn } : task)),
      );
    } catch (error) {
      console.error('Error moving task:', error);
    }
  };

  const filteredTasks = tasks.filter((task) =>
    task.title.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const getTasksByColumn = (columnId: string) => {
    return filteredTasks.filter((task) => task.board_column === columnId);
  };

  const renderTaskCard = (task: Task) => (
    <TouchableOpacity
      key={task.id}
      style={styles.taskCard}
      onPress={() => navigation.navigate('TaskDetail' as never, { taskId: task.id } as never)}
      onLongPress={() => {
        setSelectedTask(task);
        setShowColumnPicker(true);
      }}
      delayLongPress={500}
    >
      <View style={styles.taskHeader}>
        <Text style={styles.taskTitle} numberOfLines={2}>
          {task.title}
        </Text>
        <View
          style={[styles.priorityBadge, { backgroundColor: `${priorityColors[task.priority]}20` }]}
        >
          <Text style={[styles.priorityText, { color: priorityColors[task.priority] }]}>
            {priorityLabels[task.priority]}
          </Text>
        </View>
      </View>

      {task.description && (
        <Text style={styles.taskDescription} numberOfLines={2}>
          {task.description}
        </Text>
      )}

      <View style={styles.taskFooter}>
        <View style={styles.assignees}>
          {task.task_assignees.slice(0, 3).map((assignee, index) => (
            <View
              key={assignee.employee_id}
              style={[styles.avatarWrapper, { marginLeft: index > 0 ? -8 : 0 }]}
            >
              <EmployeeAvatar
                avatarUrl={assignee.employees.avatar_url}
                avatarMetadata={assignee.employees.avatar_metadata}
                employeeName={`${assignee.employees.name} ${assignee.employees.surname}`}
                size={24}
              />
            </View>
          ))}
          {task.task_assignees.length > 3 && (
            <View style={styles.moreAvatars}>
              <Text style={styles.moreAvatarsText}>+{task.task_assignees.length - 3}</Text>
            </View>
          )}
        </View>

        {task.due_date && (
          <View style={styles.dueDateContainer}>
            <Feather name="calendar" size={12} color={colors.text.secondary} />
            <Text style={styles.dueDate}>
              {new Date(task.due_date).toLocaleDateString('pl-PL', {
                day: '2-digit',
                month: '2-digit',
              })}
            </Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={colors.primary.gold} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.searchContainer}>
          <Feather
            name="search"
            size={20}
            color={colors.text.secondary}
            style={styles.searchIcon}
          />
          <TextInput
            style={styles.searchInput}
            placeholder="Szukaj zadań..."
            placeholderTextColor={colors.text.secondary}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Feather name="x" size={20} color={colors.text.secondary} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        style={styles.boardContainer}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[colors.primary.gold]}
          />
        }
      >
        {BOARD_COLUMNS.map((column) => {
          const columnTasks = getTasksByColumn(column.id);
          return (
            <View key={column.id} style={styles.column}>
              <View style={[styles.columnHeader, { borderLeftColor: column.color }]}>
                <Text style={styles.columnTitle}>{column.title}</Text>
                <View style={styles.columnBadge}>
                  <Text style={styles.columnCount}>{columnTasks.length}</Text>
                </View>
              </View>

              <ScrollView
                style={styles.columnContent}
                contentContainerStyle={styles.columnContentContainer}
                showsVerticalScrollIndicator={false}
              >
                {columnTasks.length === 0 ? (
                  <View style={styles.emptyColumn}>
                    <Feather name="inbox" size={32} color={colors.text.secondary} />
                    <Text style={styles.emptyText}>Brak zadań</Text>
                  </View>
                ) : (
                  columnTasks.map((task) => renderTaskCard(task))
                )}
              </ScrollView>
            </View>
          );
        })}
      </ScrollView>

      <View style={styles.hintContainer}>
        <Feather name="info" size={14} color={colors.text.secondary} />
        <Text style={styles.hintText}>Przytrzymaj zadanie, aby przenieść do innej kolumny</Text>
      </View>

      <Modal
        visible={showColumnPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowColumnPicker(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowColumnPicker(false)}
        >
          <View style={styles.columnPickerModal}>
            <Text style={styles.modalTitle}>Przenieś zadanie do:</Text>
            {BOARD_COLUMNS.map((column) => (
              <TouchableOpacity
                key={column.id}
                style={[
                  styles.columnOption,
                  selectedTask?.board_column === column.id && styles.columnOptionActive,
                ]}
                onPress={() => {
                  if (selectedTask) {
                    moveTask(selectedTask.id, column.id);
                  }
                  setShowColumnPicker(false);
                  setSelectedTask(null);
                }}
              >
                <View style={[styles.columnColorIndicator, { backgroundColor: column.color }]} />
                <Text style={styles.columnOptionText}>{column.title}</Text>
                {selectedTask?.board_column === column.id && (
                  <Feather name="check" size={20} color={colors.primary.gold} />
                )}
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={styles.modalCancelButton}
              onPress={() => {
                setShowColumnPicker(false);
                setSelectedTask(null);
              }}
            >
              <Text style={styles.modalCancelText}>Anuluj</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background.primary,
  },
  header: {
    padding: spacing.md,
    backgroundColor: colors.background.secondary,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.primary,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background.primary,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border.primary,
  },
  searchIcon: {
    marginRight: spacing.sm,
  },
  searchInput: {
    flex: 1,
    height: 44,
    color: colors.text.primary,
    fontSize: typography.fontSizes.md,
  },
  boardContainer: {
    flex: 1,
  },
  column: {
    width: COLUMN_WIDTH,
    marginHorizontal: 16,
    paddingBottom: spacing.md,
  },
  columnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.background.secondary,
    borderRadius: 8,
    marginBottom: spacing.sm,
    borderLeftWidth: 4,
  },
  columnTitle: {
    fontSize: typography.fontSizes.md,
    fontWeight: typography.fontWeights.bold,
    color: colors.text.primary,
  },
  columnBadge: {
    backgroundColor: colors.primary.gold,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 12,
    minWidth: 24,
    alignItems: 'center',
  },
  columnCount: {
    fontSize: typography.fontSizes.xs,
    fontWeight: typography.fontWeights.bold,
    color: colors.background.primary,
  },
  columnContent: {
    flex: 1,
  },
  columnContentContainer: {
    paddingBottom: spacing.xl,
  },
  taskCard: {
    backgroundColor: colors.background.secondary,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border.primary,
  },
  taskHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  taskTitle: {
    flex: 1,
    fontSize: typography.fontSizes.md,
    fontWeight: typography.fontWeights.bold,
    color: colors.text.primary,
    marginRight: spacing.sm,
  },
  priorityBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: 6,
  },
  priorityText: {
    fontSize: typography.fontSizes.xs,
    fontWeight: typography.fontWeights.medium,
  },
  taskDescription: {
    fontSize: typography.fontSizes.sm,
    color: colors.text.secondary,
    lineHeight: 18,
    marginBottom: spacing.sm,
  },
  taskFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  assignees: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarWrapper: {
    borderWidth: 2,
    borderColor: colors.background.secondary,
    borderRadius: 12,
  },
  moreAvatars: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.primary.gold,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: -8,
    borderWidth: 2,
    borderColor: colors.background.secondary,
  },
  moreAvatarsText: {
    fontSize: 10,
    fontWeight: typography.fontWeights.bold,
    color: colors.background.primary,
  },
  dueDateContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  dueDate: {
    fontSize: typography.fontSizes.xs,
    color: colors.text.secondary,
  },
  emptyColumn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
  },
  emptyText: {
    fontSize: typography.fontSizes.sm,
    color: colors.text.secondary,
    marginTop: spacing.sm,
  },
  hintContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.background.secondary,
    borderTopWidth: 1,
    borderTopColor: colors.border.primary,
  },
  hintText: {
    flex: 1,
    fontSize: typography.fontSizes.xs,
    color: colors.text.secondary,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  columnPickerModal: {
    backgroundColor: colors.background.secondary,
    borderRadius: 12,
    padding: spacing.lg,
    width: '100%',
    maxWidth: 400,
    borderWidth: 1,
    borderColor: colors.border.primary,
  },
  modalTitle: {
    fontSize: typography.fontSizes.lg,
    fontWeight: typography.fontWeights.bold,
    color: colors.text.primary,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  columnOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: 8,
    marginBottom: spacing.sm,
    backgroundColor: colors.background.primary,
    borderWidth: 1,
    borderColor: colors.border.primary,
  },
  columnOptionActive: {
    borderColor: colors.primary.gold,
    borderWidth: 2,
  },
  columnColorIndicator: {
    width: 4,
    height: 24,
    borderRadius: 2,
    marginRight: spacing.md,
  },
  columnOptionText: {
    flex: 1,
    fontSize: typography.fontSizes.md,
    color: colors.text.primary,
    fontWeight: typography.fontWeights.medium,
  },
  modalCancelButton: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: 8,
    backgroundColor: colors.background.primary,
    borderWidth: 1,
    borderColor: colors.border.primary,
    alignItems: 'center',
  },
  modalCancelText: {
    fontSize: typography.fontSizes.md,
    color: colors.text.secondary,
    fontWeight: typography.fontWeights.medium,
  },
});
