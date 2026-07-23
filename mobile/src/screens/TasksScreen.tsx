import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  Animated,
  PanResponder,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { Feather } from '@expo/vector-icons';
import { colors, spacing, typography } from '../theme';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import EmployeeAvatar from '../components/EmployeeAvatar';

type TasksStackParamList = {
  Tasks: undefined;
  TaskDetail: {
    taskId: string;
  };
};

type TasksNavigationProp = NativeStackNavigationProp<TasksStackParamList, 'Tasks'>;

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
  sort_order?: number;
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
  urgent: '#ef4444',
  high: '#f97316',
  medium: '#3b82f6',
  low: colors.text.secondary,
};

const priorityLabels = {
  urgent: 'Pilne',
  high: 'Wysoki',
  medium: 'Średni',
  low: 'Niski',
};

const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };

const BOARD_COLUMNS = [
  { id: 'todo', title: 'Do zrobienia', color: '#eab308' },
  { id: 'in_progress', title: 'W trakcie', color: '#3b82f6' },
  { id: 'review', title: 'Sprawdzenie', color: '#a855f7' },
  { id: 'completed', title: 'Zakończone', color: '#10b981' },
];

const CARD_HEIGHT = 110;

function DraggableTaskCard({
  task,
  index,
  totalCount,
  onPress,
  onLongPress,
  onMoveUp,
  onMoveDown,
  isReordering,
}: {
  task: Task;
  index: number;
  totalCount: number;
  onPress: () => void;
  onLongPress: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  isReordering: boolean;
}) {
  const pan = useRef(new Animated.ValueXY()).current;
  const scale = useRef(new Animated.Value(1)).current;
  const [isDragging, setIsDragging] = useState(false);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => isReordering,
      onMoveShouldSetPanResponder: (_, gestureState) =>
        isReordering && Math.abs(gestureState.dy) > 5,
      onPanResponderGrant: () => {
        setIsDragging(true);
        Animated.spring(scale, { toValue: 1.03, useNativeDriver: true }).start();
      },
      onPanResponderMove: (_, gestureState) => {
        pan.setValue({ x: 0, y: gestureState.dy });
      },
      onPanResponderRelease: (_, gestureState) => {
        setIsDragging(false);
        Animated.spring(scale, { toValue: 1, useNativeDriver: true }).start();

        const movedSlots = Math.round(gestureState.dy / CARD_HEIGHT);
        if (movedSlots < 0) {
          for (let i = 0; i < Math.abs(movedSlots); i++) onMoveUp();
        } else if (movedSlots > 0) {
          for (let i = 0; i < movedSlots; i++) onMoveDown();
        }

        Animated.spring(pan, {
          toValue: { x: 0, y: 0 },
          useNativeDriver: true,
        }).start();
      },
    }),
  ).current;

  const assignees = task.task_assignees ?? [];

  return (
    <Animated.View
      style={[
        styles.taskCard,
        isDragging && styles.taskCardDragging,
        {
          transform: [{ translateX: pan.x }, { translateY: pan.y }, { scale }],
          zIndex: isDragging ? 100 : 1,
        },
      ]}
      {...(isReordering ? panResponder.panHandlers : {})}
    >
      <TouchableOpacity
        onPress={isReordering ? undefined : onPress}
        onLongPress={isReordering ? undefined : onLongPress}
        delayLongPress={500}
        activeOpacity={isReordering ? 1 : 0.7}
      >
        <View style={styles.taskHeader}>
          <Text style={styles.taskTitle} numberOfLines={2}>
            {task.title}
          </Text>
          <View
            style={[
              styles.priorityBadge,
              { backgroundColor: `${priorityColors[task.priority]}20` },
            ]}
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

        <View style={styles.taskFooterRow}>
          <View style={styles.assignees}>
            {assignees.slice(0, 3).map((assignee, idx) => (
              <View
                key={assignee.employee_id}
                style={[styles.avatarWrapper, { marginLeft: idx > 0 ? -8 : 0 }]}
              >
                {assignee.employees && (
                  <EmployeeAvatar
                    avatarUrl={assignee.employees.avatar_url}
                    avatarMetadata={assignee.employees.avatar_metadata}
                    employeeName={`${assignee.employees.name} ${assignee.employees.surname}`}
                    size={24}
                  />
                )}
              </View>
            ))}
            {assignees.length > 3 && (
              <View style={styles.moreAvatars}>
                <Text style={styles.moreAvatarsText}>+{assignees.length - 3}</Text>
              </View>
            )}
          </View>

          {isReordering && (
            <View style={styles.reorderButtons}>
              <TouchableOpacity
                style={[styles.reorderBtn, index === 0 && styles.reorderBtnDisabled]}
                onPress={onMoveUp}
                disabled={index === 0}
              >
                <Feather
                  name="chevron-up"
                  size={18}
                  color={index === 0 ? colors.text.secondary : colors.primary.gold}
                />
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.reorderBtn,
                  index === totalCount - 1 && styles.reorderBtnDisabled,
                ]}
                onPress={onMoveDown}
                disabled={index === totalCount - 1}
              >
                <Feather
                  name="chevron-down"
                  size={18}
                  color={index === totalCount - 1 ? colors.text.secondary : colors.primary.gold}
                />
              </TouchableOpacity>
            </View>
          )}
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

export default function TasksScreen() {
  const navigation = useNavigation<TasksNavigationProp>();
  const { employee } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [isReordering, setIsReordering] = useState(false);
  const [customOrder, setCustomOrder] = useState<Record<string, string[]>>({});

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

      const { data: createdTasks, error: error1 } = await supabase
        .from('tasks')
        .select('*')
        .eq('created_by', employee.id)
        .eq('is_private', false)
        .is('event_id', null);

      if (error1) throw error1;

      const { data: assignedTasksData, error: error2 } = await supabase
        .from('task_assignees')
        .select('task_id')
        .eq('employee_id', employee.id);

      if (error2) throw error2;

      const assignedTaskIds = assignedTasksData?.map((ta) => ta.task_id) || [];

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

      const allTasks = [...(createdTasks || []), ...assignedTasks];
      const uniqueTasks = Array.from(new Map(allTasks.map((task) => [task.id, task])).values());

      const taskIds = uniqueTasks.map((t) => t.id);
      if (taskIds.length > 0) {
        const { data: assigneesData, error: error4 } = await supabase
          .from('task_assignees')
          .select('task_id, employee_id')
          .in('task_id', taskIds);

        if (error4) throw error4;

        const employeeIds = [...new Set(assigneesData?.map((a) => a.employee_id) || [])];
        if (employeeIds.length > 0) {
          const { data: employeesData, error: error5 } = await supabase
            .from('employees')
            .select('id, name, surname, avatar_url, avatar_metadata')
            .in('id', employeeIds);

          if (error5) throw error5;

          const employeesMap = new Map(employeesData?.map((e) => [e.id, e]) || []);

          uniqueTasks.forEach((task) => {
            const taskAssignees = assigneesData?.filter((a) => a.task_id === task.id) || [];
            task.task_assignees = taskAssignees.map((ta) => ({
              employee_id: ta.employee_id,
              employees: employeesMap.get(ta.employee_id),
            }));
          });
        }
      }

      setTasks(uniqueTasks as Task[]);
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

      setTasks((prev) =>
        prev.map((task) => (task.id === taskId ? { ...task, board_column: newColumn } : task)),
      );
    } catch (error) {
      console.error('Error moving task:', error);
    }
  };

  const sortByPriority = (taskList: Task[]): Task[] => {
    return [...taskList].sort((a, b) => {
      const pA = priorityOrder[a.priority] ?? 4;
      const pB = priorityOrder[b.priority] ?? 4;
      if (pA !== pB) return pA - pB;
      if (a.due_date && b.due_date) return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
      if (a.due_date) return -1;
      if (b.due_date) return 1;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  };

  const filteredTasks = tasks.filter((task) =>
    task.title.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const getTasksByColumn = useCallback(
    (columnId: string): Task[] => {
      const columnTasks = filteredTasks.filter((task) => task.board_column === columnId);
      const sorted = sortByPriority(columnTasks);

      const order = customOrder[columnId];
      if (order && order.length > 0) {
        const orderMap = new Map(order.map((id, idx) => [id, idx]));
        return sorted.sort((a, b) => {
          const idxA = orderMap.get(a.id);
          const idxB = orderMap.get(b.id);
          if (idxA !== undefined && idxB !== undefined) return idxA - idxB;
          if (idxA !== undefined) return -1;
          if (idxB !== undefined) return 1;
          return 0;
        });
      }

      return sorted;
    },
    [filteredTasks, customOrder],
  );

  const reorderTask = (columnId: string, fromIndex: number, toIndex: number) => {
    const columnTasks = getTasksByColumn(columnId);
    if (toIndex < 0 || toIndex >= columnTasks.length) return;

    const newOrder = columnTasks.map((t) => t.id);
    const [moved] = newOrder.splice(fromIndex, 1);
    newOrder.splice(toIndex, 0, moved);

    setCustomOrder((prev) => ({ ...prev, [columnId]: newOrder }));
  };

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
        <View style={styles.searchRow}>
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
          <TouchableOpacity
            style={[styles.reorderToggle, isReordering && styles.reorderToggleActive]}
            onPress={() => setIsReordering(!isReordering)}
          >
            <Feather
              name="move"
              size={20}
              color={isReordering ? colors.background.primary : colors.primary.gold}
            />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        style={styles.boardContainer}
        scrollEnabled={!isReordering}
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
                scrollEnabled={!isReordering}
              >
                {columnTasks.length === 0 ? (
                  <View style={styles.emptyColumn}>
                    <Feather name="inbox" size={32} color={colors.text.secondary} />
                    <Text style={styles.emptyText}>Brak zadań</Text>
                  </View>
                ) : (
                  columnTasks.map((task, idx) => (
                    <DraggableTaskCard
                      key={task.id}
                      task={task}
                      index={idx}
                      totalCount={columnTasks.length}
                      isReordering={isReordering}
                      onPress={() => navigation.navigate('TaskDetail', { taskId: task.id })}
                      onLongPress={() => {
                        setSelectedTask(task);
                        setShowColumnPicker(true);
                      }}
                      onMoveUp={() => reorderTask(column.id, idx, idx - 1)}
                      onMoveDown={() => reorderTask(column.id, idx, idx + 1)}
                    />
                  ))
                )}
              </ScrollView>
            </View>
          );
        })}
      </ScrollView>

      <View style={styles.hintContainer}>
        <Feather name="info" size={14} color={colors.text.secondary} />
        <Text style={styles.hintText}>
          {isReordering
            ? 'Przeciągnij kartę lub użyj strzałek aby zmienić kolejność'
            : 'Przytrzymaj zadanie, aby przenieść do innej kolumny'}
        </Text>
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
    borderBottomColor: colors.border.default,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  searchContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background.primary,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border.default,
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
  reorderToggle: {
    width: 44,
    height: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.primary.gold,
    justifyContent: 'center',
    alignItems: 'center',
  },
  reorderToggleActive: {
    backgroundColor: colors.primary.gold,
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
    borderColor: colors.border.default,
  },
  taskCardDragging: {
    borderColor: colors.primary.gold,
    shadowColor: colors.primary.gold,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
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
  taskFooterRow: {
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
  reorderButtons: {
    flexDirection: 'row',
    gap: 4,
  },
  reorderBtn: {
    width: 30,
    height: 30,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border.default,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background.primary,
  },
  reorderBtnDisabled: {
    opacity: 0.4,
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
    borderTopColor: colors.border.default,
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
    borderColor: colors.border.default,
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
    borderColor: colors.border.default,
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
    borderColor: colors.border.default,
    alignItems: 'center',
  },
  modalCancelText: {
    fontSize: typography.fontSizes.md,
    color: colors.text.secondary,
    fontWeight: typography.fontWeights.medium,
  },
});
