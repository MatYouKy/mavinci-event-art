import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useForegroundEffect } from '../hooks/useForegroundEffect';
import { createRefreshQueue } from '../lib/refreshQueue';
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
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { Feather } from '@expo/vector-icons';
import { colors, spacing, typography } from '../theme';
import { supabase } from '../lib/supabase';
import { sortTasksByUrgency } from '../lib/taskSort';
import { fetchEmployeeTasks, createPrivateEmployeeTask } from '../services/employeeTasks';
import { useAuth } from '../contexts/AuthContext';
import EmployeeAvatar from '../components/EmployeeAvatar';

type TasksStackParamList = {
  TasksList: undefined;
  TaskDetail: {
    taskId: string;
  };
};

type TasksNavigationProp = NativeStackNavigationProp<TasksStackParamList, 'TasksList'>;

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



const BOARD_COLUMNS = [
  { id: 'todo', title: 'Do zrobienia', color: '#eab308' },
  { id: 'in_progress', title: 'W trakcie', color: '#3b82f6' },
  { id: 'review', title: 'Sprawdzenie', color: '#a855f7' },
  { id: 'completed', title: 'Zakończone', color: '#10b981' },
];

const CARD_HEIGHT = 110;
const COLUMN_SWIPE_THRESHOLD = Math.min(100, SCREEN_WIDTH * 0.24);
const COLUMN_SWIPE_ACTIVATION = 8;
const COLUMN_EDGE_SWITCH_ZONE = 44;
const COLUMN_EDGE_UNLOCK_ZONE = 96;

function DraggableTaskCard({
  task,
  index,
  totalCount,
  onPress,
  onLongPress,
  onMoveUp,
  onMoveDown,
  columnIndex,
  onMoveToColumn,
  onPreviewColumnChange,
  onHorizontalDragStateChange,
  isReordering,
}: {
  task: Task;
  index: number;
  totalCount: number;
  onPress: () => void;
  onLongPress: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  columnIndex: number;
  onMoveToColumn: (columnId: string) => void;
  onPreviewColumnChange: (columnIndex: number) => void;
  onHorizontalDragStateChange: (active: boolean) => void;
  isReordering: boolean;
}) {
  const pan = useRef(new Animated.ValueXY()).current;
  const scale = useRef(new Animated.Value(1)).current;
  const [isDragging, setIsDragging] = useState(false);
  const [dragTargetIndex, setDragTargetIndex] = useState<number | null>(null);

  const latestPropsRef = useRef({
    isReordering,
    columnIndex,
    onMoveUp,
    onMoveDown,
    onMoveToColumn,
    onPreviewColumnChange,
    onHorizontalDragStateChange,
  });
  latestPropsRef.current = {
    isReordering,
    columnIndex,
    onMoveUp,
    onMoveDown,
    onMoveToColumn,
    onPreviewColumnChange,
    onHorizontalDragStateChange,
  };

  const longPressArmedRef = useRef(false);
  const panActiveRef = useRef(false);
  const horizontalDragRef = useRef(false);
  const previewColumnIndexRef = useRef(columnIndex);
  const edgeLockRef = useRef<'left' | 'right' | null>(null);

  const finishHorizontalDrag = (animate = true, restoreSourceColumn = true) => {
    if (
      restoreSourceColumn &&
      previewColumnIndexRef.current !== latestPropsRef.current.columnIndex
    ) {
      latestPropsRef.current.onPreviewColumnChange(latestPropsRef.current.columnIndex);
    }

    previewColumnIndexRef.current = latestPropsRef.current.columnIndex;
    edgeLockRef.current = null;
    longPressArmedRef.current = false;
    panActiveRef.current = false;
    horizontalDragRef.current = false;
    setDragTargetIndex(null);
    setIsDragging(false);
    latestPropsRef.current.onHorizontalDragStateChange(false);

    Animated.spring(scale, { toValue: 1, useNativeDriver: true }).start();
    if (animate) {
      Animated.spring(pan, {
        toValue: { x: 0, y: 0 },
        useNativeDriver: true,
      }).start();
    } else {
      pan.setValue({ x: 0, y: 0 });
    }
  };

  const armHorizontalDrag = () => {
    if (latestPropsRef.current.isReordering) return;

    longPressArmedRef.current = true;
    previewColumnIndexRef.current = latestPropsRef.current.columnIndex;
    edgeLockRef.current = null;
    setIsDragging(true);
    latestPropsRef.current.onHorizontalDragStateChange(true);
    Animated.spring(scale, { toValue: 1.03, useNativeDriver: true }).start();
  };

  const handlePressOut = () => {
    setTimeout(() => {
      if (longPressArmedRef.current && !panActiveRef.current) {
        finishHorizontalDrag();
      }
    }, 0);
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        if (latestPropsRef.current.isReordering) {
          return Math.abs(gestureState.dy) > 5 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx);
        }

        return (
          longPressArmedRef.current &&
          Math.abs(gestureState.dx) > COLUMN_SWIPE_ACTIVATION &&
          Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.2
        );
      },
      onMoveShouldSetPanResponderCapture: (_, gestureState) =>
        longPressArmedRef.current &&
        Math.abs(gestureState.dx) > COLUMN_SWIPE_ACTIVATION &&
        Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.2,
      onPanResponderGrant: () => {
        panActiveRef.current = true;
        horizontalDragRef.current = !latestPropsRef.current.isReordering;
        setIsDragging(true);
        Animated.spring(scale, { toValue: 1.03, useNativeDriver: true }).start();
      },
      onPanResponderMove: (_, gestureState) => {
        if (latestPropsRef.current.isReordering) {
          pan.setValue({ x: 0, y: gestureState.dy });
          return;
        }

        const sourceColumnIndex = latestPropsRef.current.columnIndex;
        let previewColumnIndex = previewColumnIndexRef.current;
        const movedEnough = Math.abs(gestureState.dx) > COLUMN_SWIPE_ACTIVATION;

        if (
          edgeLockRef.current &&
          gestureState.moveX > COLUMN_EDGE_UNLOCK_ZONE &&
          gestureState.moveX < SCREEN_WIDTH - COLUMN_EDGE_UNLOCK_ZONE
        ) {
          edgeLockRef.current = null;
        }

        if (
          movedEnough &&
          !edgeLockRef.current &&
          gestureState.moveX <= COLUMN_EDGE_SWITCH_ZONE &&
          previewColumnIndex < BOARD_COLUMNS.length - 1
        ) {
          previewColumnIndex += 1;
          previewColumnIndexRef.current = previewColumnIndex;
          edgeLockRef.current = 'left';
          latestPropsRef.current.onPreviewColumnChange(previewColumnIndex);
        } else if (
          movedEnough &&
          !edgeLockRef.current &&
          gestureState.moveX >= SCREEN_WIDTH - COLUMN_EDGE_SWITCH_ZONE &&
          previewColumnIndex > 0
        ) {
          previewColumnIndex -= 1;
          previewColumnIndexRef.current = previewColumnIndex;
          edgeLockRef.current = 'right';
          latestPropsRef.current.onPreviewColumnChange(previewColumnIndex);
        }

        const pageCompensation = (previewColumnIndex - sourceColumnIndex) * SCREEN_WIDTH;
        pan.setValue({ x: gestureState.dx + pageCompensation, y: 0 });

        if (previewColumnIndex !== sourceColumnIndex) {
          setDragTargetIndex(previewColumnIndex);
        } else if (movedEnough) {
          const directionalTarget = gestureState.dx < 0
            ? sourceColumnIndex + 1
            : sourceColumnIndex - 1;
          setDragTargetIndex(
            directionalTarget >= 0 && directionalTarget < BOARD_COLUMNS.length
              ? directionalTarget
              : null,
          );
        } else {
          setDragTargetIndex(null);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (latestPropsRef.current.isReordering) {
          setIsDragging(false);
          panActiveRef.current = false;
          Animated.spring(scale, { toValue: 1, useNativeDriver: true }).start();

          const movedSlots = Math.round(gestureState.dy / CARD_HEIGHT);
          if (movedSlots < 0) {
            for (let i = 0; i < Math.abs(movedSlots); i++) {
              latestPropsRef.current.onMoveUp();
            }
          } else if (movedSlots > 0) {
            for (let i = 0; i < movedSlots; i++) {
              latestPropsRef.current.onMoveDown();
            }
          }

          Animated.spring(pan, {
            toValue: { x: 0, y: 0 },
            useNativeDriver: true,
          }).start();
          return;
        }

        const currentColumnIndex = latestPropsRef.current.columnIndex;
        let targetIndex = previewColumnIndexRef.current;

        if (targetIndex === currentColumnIndex && Math.abs(gestureState.dx) >= COLUMN_SWIPE_THRESHOLD) {
          targetIndex = gestureState.dx < 0 ? currentColumnIndex + 1 : currentColumnIndex - 1;
        }

        const shouldMove = targetIndex >= 0 &&
          targetIndex < BOARD_COLUMNS.length &&
          targetIndex !== currentColumnIndex;

        if (!shouldMove) {
          finishHorizontalDrag();
          return;
        }

        latestPropsRef.current.onMoveToColumn(BOARD_COLUMNS[targetIndex].id);
        finishHorizontalDrag(false, false);
      },
      onPanResponderTerminate: () => finishHorizontalDrag(),
      onPanResponderTerminationRequest: () => false,
    }),
  ).current;

  useEffect(
    () => () => {
      if (longPressArmedRef.current || horizontalDragRef.current) {
        latestPropsRef.current.onHorizontalDragStateChange(false);
      }
    },
    [],
  );

  const assignees = task.task_assignees ?? [];

  return (
    <Animated.View
      style={[
        styles.taskCard,
        isDragging && styles.taskCardDragging,
        dragTargetIndex !== null && {
          borderColor: BOARD_COLUMNS[dragTargetIndex].color,
        },
        {
          transform: [{ translateX: pan.x }, { translateY: pan.y }, { scale }],
          zIndex: isDragging ? 100 : 1,
        },
      ]}
      {...panResponder.panHandlers}
    >
      <TouchableOpacity
        onPress={isReordering ? undefined : onPress}
        onLongPress={isReordering ? undefined : armHorizontalDrag}
        onPressOut={isReordering ? undefined : handlePressOut}
        delayLongPress={400}
        activeOpacity={isReordering ? 1 : 0.7}
      >
        {dragTargetIndex !== null && (
          <View
            style={[
              styles.dragTargetBadge,
              { borderColor: BOARD_COLUMNS[dragTargetIndex].color },
            ]}
          >
            <Feather
              name={dragTargetIndex > columnIndex ? 'arrow-right' : 'arrow-left'}
              size={14}
              color={BOARD_COLUMNS[dragTargetIndex].color}
            />
            <Text style={styles.dragTargetText}>
              Przenieś do: {BOARD_COLUMNS[dragTargetIndex].title}
            </Text>
          </View>
        )}

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

          {!isReordering && !isDragging && (
            <TouchableOpacity
              style={styles.taskMoreButton}
              onPress={onLongPress}
              hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
            >
              <Feather name="more-horizontal" size={18} color={colors.text.secondary} />
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

export default function TasksScreen() {
  const navigation = useNavigation<TasksNavigationProp>();
  const { employee, session } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [isReordering, setIsReordering] = useState(false);
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [customOrder, setCustomOrder] = useState<Record<string, string[]>>({});
  const boardScrollRef = useRef<ScrollView>(null);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newPriority, setNewPriority] = useState<Task['priority']>('medium');
  const [newColumn, setNewColumn] = useState<string>('todo');
  const creatingRef = useRef(false);

  useForegroundEffect((signal) => {
    if (!employee?.id) return;
    const queue = createRefreshQueue(signal, () => fetchTasks());
    void queue.refresh();

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
            queue.schedule();
          }
        },
      )
      .subscribe();

    return () => {
      return supabase.removeChannel(channel);
    };
  }, [employee, session?.user.id]);

  const fetchTasks = async () => {
    try {
      if (!employee || !session?.user.id) return;

      const uniqueTasks = await fetchEmployeeTasks(supabase, employee.id, session.user.id);

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

  const resetCreateForm = () => {
    setNewTitle('');
    setNewDescription('');
    setNewPriority('medium');
    setNewColumn('todo');
  };

  const createTask = async () => {
    if (!employee || creatingRef.current) return;
  
    const title = newTitle.trim();
  
    if (!title) {
      Alert.alert('Brak tytułu', 'Podaj tytuł zadania.');
      return;
    }
  
    creatingRef.current = true;
    setCreating(true);
  
    try {
      await createPrivateEmployeeTask(supabase, employee.id, {
        title,
        description: newDescription.trim() || null,
        priority: newPriority,
        column: newColumn,
      });

      resetCreateForm();
      setShowCreateModal(false);
  
      await fetchTasks();
    } catch (error: any) {
      console.error('Błąd tworzenia zadania:', error);
  
      Alert.alert(
        'Błąd',
        error?.message || 'Nie udało się utworzyć zadania.',
      );
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  };

  const moveTask = async (taskId: string, newColumn: string) => {
    const previousTask = tasks.find((task) => task.id === taskId);
    if (!previousTask || previousTask.board_column === newColumn) return;

    const previousColumnIndex = BOARD_COLUMNS.findIndex(
      (column) => column.id === previousTask.board_column,
    );
    const targetColumnIndex = BOARD_COLUMNS.findIndex((column) => column.id === newColumn);

    setTasks((current) =>
      current.map((task) =>
        task.id === taskId
          ? { ...task, board_column: newColumn, status: newColumn }
          : task,
      ),
    );

    if (targetColumnIndex >= 0) {
      setTimeout(() => {
        boardScrollRef.current?.scrollTo({
          x: targetColumnIndex * SCREEN_WIDTH,
          animated: true,
        });
      }, 40);
    }

    try {
      const updateData: Record<string, string | null> = {
        board_column: newColumn,
        status: newColumn,
      };

      if (newColumn !== 'in_progress') {
        updateData.currently_working_by = null;
      }

      const { error } = await supabase
        .from('tasks')
        .update(updateData)
        .eq('id', taskId)
        .select('id')
        .single();

      if (error) throw error;
    } catch (error) {
      console.error('Error moving task:', error);
      setTasks((current) =>
        current.map((task) => (task.id === taskId ? previousTask : task)),
      );

      if (previousColumnIndex >= 0) {
        boardScrollRef.current?.scrollTo({
          x: previousColumnIndex * SCREEN_WIDTH,
          animated: true,
        });
      }

      Alert.alert('Błąd', 'Nie udało się przenieść zadania. Przywrócono poprzednią kolumnę.');
    }
  };

  const filteredTasks = tasks.filter((task) =>
    task.title.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const getTasksByColumn = useCallback(
    (columnId: string): Task[] => {
      const columnTasks = filteredTasks.filter((task) => task.board_column === columnId);
      const sorted = sortTasksByUrgency(columnTasks);

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
          <TouchableOpacity
            style={styles.addTaskButton}
            onPress={() => setShowCreateModal(true)}
          >
            <Feather name="plus" size={22} color={colors.background.primary} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        ref={boardScrollRef}
        horizontal
        pagingEnabled
        removeClippedSubviews={false}
        showsHorizontalScrollIndicator={false}
        style={styles.boardContainer}
        scrollEnabled={!isReordering && !draggingTaskId}
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
                scrollEnabled={!isReordering && !draggingTaskId}
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
                      columnIndex={BOARD_COLUMNS.findIndex((item) => item.id === column.id)}
                      onMoveToColumn={(targetColumnId) => {
                        void moveTask(task.id, targetColumnId);
                      }}
                      onPreviewColumnChange={(targetColumnIndex) => {
                        boardScrollRef.current?.scrollTo({
                          x: targetColumnIndex * SCREEN_WIDTH,
                          animated: false,
                        });
                      }}
                      onHorizontalDragStateChange={(active) => {
                        setDraggingTaskId((current) =>
                          active ? task.id : current === task.id ? null : current,
                        );
                      }}
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
            : draggingTaskId
              ? 'Przeciągnij do krawędzi ekranu, aby przejść do kolejnej kolumny'
              : 'Przytrzymaj zadanie i przesuń je w lewo lub w prawo'}
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

      <Modal
        visible={showCreateModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => {
          if (!creating) {
            resetCreateForm();
            setShowCreateModal(false);
          }
        }}
      >
        <KeyboardAvoidingView
          style={styles.createModalContainer}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.createModalHeader}>
            <TouchableOpacity
              onPress={() => {
                if (!creating) {
                  resetCreateForm();
                  setShowCreateModal(false);
                }
              }}
              style={styles.createModalCloseBtn}
            >
              <Feather name="x" size={24} color={colors.text.primary} />
            </TouchableOpacity>
            <Text style={styles.createModalHeaderTitle}>Nowe zadanie</Text>
            <TouchableOpacity
              onPress={createTask}
              disabled={creating}
              style={styles.createModalSaveBtn}
            >
              {creating ? (
                <ActivityIndicator size="small" color={colors.primary.gold} />
              ) : (
                <Text style={styles.createModalSaveBtnText}>Zapisz</Text>
              )}
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.createModalForm}
            contentContainerStyle={styles.createModalFormContent}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Tytuł</Text>
              <TextInput
                style={styles.formInput}
                value={newTitle}
                onChangeText={setNewTitle}
                placeholder="Co jest do zrobienia?"
                placeholderTextColor={colors.text.secondary}
                autoFocus
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Opis</Text>
              <TextInput
                style={[styles.formInput, styles.formTextArea]}
                value={newDescription}
                onChangeText={setNewDescription}
                placeholder="Dodaj szczegóły (opcjonalnie)"
                placeholderTextColor={colors.text.secondary}
                multiline
                numberOfLines={4}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Priorytet</Text>
              <View style={styles.chipRow}>
                {(['low', 'medium', 'high', 'urgent'] as Task['priority'][]).map((p) => {
                  const active = newPriority === p;
                  return (
                    <TouchableOpacity
                      key={p}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: active ? `${priorityColors[p]}30` : colors.background.primary,
                          borderColor: active ? priorityColors[p] : colors.border.default,
                        },
                      ]}
                      onPress={() => setNewPriority(p)}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          { color: active ? priorityColors[p] : colors.text.secondary },
                        ]}
                      >
                        {priorityLabels[p]}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Kolumna</Text>
              <View style={styles.chipRow}>
                {BOARD_COLUMNS.map((column) => {
                  const active = newColumn === column.id;
                  return (
                    <TouchableOpacity
                      key={column.id}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: active ? `${column.color}30` : colors.background.primary,
                          borderColor: active ? column.color : colors.border.default,
                        },
                      ]}
                      onPress={() => setNewColumn(column.id)}
                    >
                      <View style={[styles.chipDot, { backgroundColor: column.color }]} />
                      <Text
                        style={[
                          styles.chipText,
                          { color: active ? colors.text.primary : colors.text.secondary },
                        ]}
                      >
                        {column.title}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

          </ScrollView>
        </KeyboardAvoidingView>
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
  addTaskButton: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: colors.primary.gold,
    justifyContent: 'center',
    alignItems: 'center',
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
    fontFamily: 'MBFAtom',
    textTransform: 'uppercase',
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
  dragTargetBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    marginBottom: spacing.sm,
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: colors.background.primary,
  },
  dragTargetText: {
    fontSize: typography.fontSizes.xs,
    fontWeight: typography.fontWeights.medium,
    color: colors.text.primary,
  },
  taskHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  taskTitle: {
    fontFamily: 'MBFAtom',
    textTransform: 'uppercase',
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
  taskMoreButton: {
    width: 30,
    height: 30,
    marginLeft: spacing.sm,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border.default,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background.primary,
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
    fontFamily: 'MBFAtom',
    textTransform: 'uppercase',
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
  createModalContainer: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },
  createModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
    backgroundColor: colors.background.secondary,
  },
  createModalCloseBtn: {
    padding: spacing.xs,
  },
  createModalHeaderTitle: {
    fontFamily: 'MBFAtom',
    textTransform: 'uppercase',
    fontSize: typography.fontSizes.lg,
    fontWeight: typography.fontWeights.bold,
    color: colors.text.primary,
  },
  createModalSaveBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.primary.gold + '20',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.primary.gold + '40',
    minWidth: 72,
    alignItems: 'center',
  },
  createModalSaveBtnText: {
    fontSize: typography.fontSizes.sm,
    fontWeight: typography.fontWeights.bold,
    color: colors.primary.gold,
  },
  createModalForm: {
    flex: 1,
  },
  createModalFormContent: {
    padding: spacing.md,
    paddingBottom: 120,
  },
  formGroup: {
    marginBottom: spacing.lg,
  },
  formLabel: {
    fontSize: typography.fontSizes.sm,
    color: colors.text.secondary,
    fontWeight: typography.fontWeights.medium,
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  formInput: {
    backgroundColor: colors.background.secondary,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: typography.fontSizes.md,
    color: colors.text.primary,
  },
  formTextArea: {
    minHeight: 100,
    textAlignVertical: 'top',
    paddingTop: spacing.sm,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 20,
    borderWidth: 1,
  },
  chipDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  chipText: {
    fontSize: typography.fontSizes.sm,
    fontWeight: typography.fontWeights.medium,
  },
});
