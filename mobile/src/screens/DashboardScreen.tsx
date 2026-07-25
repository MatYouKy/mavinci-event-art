import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { colors, spacing, typography, borderRadius } from '../theme';

// --- Labels matching main CRM ---

const EVENT_STATUS_LABELS: Record<string, string> = {
  inquiry: 'Zapytanie',
  offer_to_send: 'Oferta do wysłania',
  offer_sent: 'Oferta wysłana',
  offer_accepted: 'Oferta zaakceptowana',
  in_preparation: 'W przygotowaniu',
  in_progress: 'W trakcie',
  completed: 'Zrealizowany',
  cancelled: 'Anulowany',
  invoiced: 'Zafakturowany',
  ready_for_live: 'Gotowy do realizacji',
};

const EVENT_STATUS_COLORS: Record<string, string> = {
  inquiry: '#6b7280',
  offer_to_send: '#3b82f6',
  offer_sent: '#6366f1',
  offer_accepted: '#34d399',
  in_preparation: '#eab308',
  in_progress: '#a855f7',
  completed: '#22c55e',
  cancelled: '#ef4444',
  invoiced: '#d3bb73',
  ready_for_live: '#10b981',
};

const TASK_STATUS_LABELS: Record<string, string> = {
  todo: 'Do zrobienia',
  in_progress: 'W trakcie',
  review: 'Sprawdzenie',
  completed: 'Zakończone',
};

const TASK_STATUS_COLORS: Record<string, string> = {
  todo: '#eab308',
  in_progress: '#3b82f6',
  review: '#a855f7',
  completed: '#10b981',
};

const PRIORITY_LABELS: Record<string, string> = {
  urgent: 'Pilne',
  high: 'Wysoki',
  medium: 'Średni',
  low: 'Niski',
};

const PRIORITY_COLORS: Record<string, string> = {
  urgent: '#ef4444',
  high: '#f97316',
  medium: '#3b82f6',
  low: '#6b7280',
};

interface DashboardEvent {
  id: string;
  name: string;
  event_date: string;
  status: string;
  category_name: string | null;
  category_color: string | null;
}

interface DashboardTask {
  id: string;
  title: string;
  priority: string;
  status: string;
  board_column: string;
  due_date: string | null;
}

export default function DashboardScreen() {
  const { employee } = useAuth();
  const navigation = useNavigation<any>();
  const [upcomingEvents, setUpcomingEvents] = useState<DashboardEvent[]>([]);
  const [myTasks, setMyTasks] = useState<DashboardTask[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadDashboardData();
  }, [employee?.id]);

  const loadDashboardData = useCallback(async () => {
    if (!employee?.id) return;
    setLoading(true);
    try {
      // Fetch upcoming events assigned to this employee (accepted) or created by them
      const { data: assignedEventIds } = await supabase
        .from('employee_assignments')
        .select('event_id')
        .eq('employee_id', employee.id)
        .eq('status', 'accepted');

      const acceptedIds = assignedEventIds?.map((a) => a.event_id) ?? [];

      // Also fetch events created by this employee
      const { data: createdEvents } = await supabase
        .from('events')
        .select('id')
        .eq('created_by', employee.id)
        .gte('event_date', new Date().toISOString().split('T')[0])
        .not('status', 'eq', 'cancelled');

      const createdIds = (createdEvents ?? []).map((e) => e.id);
      const eventIds = [...new Set([...acceptedIds, ...createdIds])];

      let events: DashboardEvent[] = [];
      if (eventIds.length > 0) {
        const { data } = await supabase
          .from('events')
          .select(`
            id, name, event_date, status,
            event_categories(name, color)
          `)
          .in('id', eventIds)
          .gte('event_date', new Date().toISOString().split('T')[0])
          .not('status', 'eq', 'cancelled')
          .order('event_date', { ascending: true })
          .limit(8);

        events = (data ?? []).map((e: any) => ({
          id: e.id,
          name: e.name,
          event_date: e.event_date,
          status: e.status,
          category_name: e.event_categories?.name ?? null,
          category_color: e.event_categories?.color ?? null,
        }));
      }
      setUpcomingEvents(events);

      // Fetch tasks assigned to the employee
      const { data: assignedTaskIds } = await supabase
        .from('task_assignees')
        .select('task_id')
        .eq('employee_id', employee.id);

      const taskIds = assignedTaskIds?.map((a) => a.task_id) ?? [];

      let tasks: DashboardTask[] = [];
      if (taskIds.length > 0) {
        const { data } = await supabase
          .from('tasks')
          .select('id, title, priority, status, board_column, due_date')
          .in('id', taskIds)
          .in('board_column', ['todo', 'in_progress', 'review'])
          .order('due_date', { ascending: true, nullsFirst: false })
          .limit(8);

        tasks = data ?? [];
      }
      setMyTasks(tasks);
    } catch (error) {
      console.error('Error loading dashboard:', error);
    } finally {
      setLoading(false);
    }
  }, [employee?.id]);

  const handleEventPress = (event: DashboardEvent) => {
    navigation.navigate('Events', {
      screen: 'EventDetail',
      params: { eventId: event.id },
    });
  };

  const handleTaskPress = (task: DashboardTask) => {
    navigation.navigate('Tasks', {
      screen: 'TaskDetail',
      params: { taskId: task.id },
    });
  };

  return (
    <ScrollView
      style={styles.container}
      refreshControl={
        <RefreshControl
          refreshing={loading}
          onRefresh={loadDashboardData}
          tintColor={colors.primary.gold}
        />
      }
    >
      {/* Welcome Header */}
      <View style={styles.header}>
        <Text style={styles.greeting}>Witaj,</Text>
        <Text style={styles.name}>{employee?.nickname || employee?.name}</Text>
      </View>

      {/* Quick Stats */}
      <View style={styles.statsGrid}>
        <View style={[styles.statCard, { borderLeftColor: colors.primary.gold }]}>
          <Feather name="calendar" color={colors.primary.gold} size={24} />
          <Text style={styles.statValue}>{upcomingEvents.length}</Text>
          <Text style={styles.statLabel}>Nadchodzące wydarzenia</Text>
        </View>

        <View style={[styles.statCard, { borderLeftColor: colors.status.info }]}>
          <Feather name="check-square" color={colors.status.info} size={24} />
          <Text style={styles.statValue}>{myTasks.length}</Text>
          <Text style={styles.statLabel}>Moje zadania</Text>
        </View>
      </View>

      {/* Upcoming Events */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Nadchodzące wydarzenia</Text>
        {upcomingEvents.length === 0 ? (
          <View style={styles.emptyState}>
            <Feather name="calendar" color={colors.text.tertiary} size={48} />
            <Text style={styles.emptyText}>Brak nadchodzących wydarzeń</Text>
          </View>
        ) : (
          upcomingEvents.map((event) => (
            <TouchableOpacity
              key={event.id}
              style={styles.card}
              onPress={() => handleEventPress(event)}
              activeOpacity={0.7}
            >
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle} numberOfLines={2}>
                  {event.name}
                </Text>
              </View>

              <View style={styles.labelsRow}>
                {event.category_name && (
                  <View
                    style={[
                      styles.badge,
                      {
                        backgroundColor: (event.category_color || '#6b7280') + '20',
                        borderColor: (event.category_color || '#6b7280') + '40',
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.badgeDot,
                        { backgroundColor: event.category_color || '#6b7280' },
                      ]}
                    />
                    <Text
                      style={[styles.badgeText, { color: event.category_color || '#6b7280' }]}
                    >
                      {event.category_name}
                    </Text>
                  </View>
                )}

                <View
                  style={[
                    styles.badge,
                    {
                      backgroundColor: (EVENT_STATUS_COLORS[event.status] || '#6b7280') + '20',
                      borderColor: (EVENT_STATUS_COLORS[event.status] || '#6b7280') + '40',
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.badgeText,
                      { color: EVENT_STATUS_COLORS[event.status] || '#6b7280' },
                    ]}
                  >
                    {EVENT_STATUS_LABELS[event.status] || event.status}
                  </Text>
                </View>
              </View>

              <View style={styles.cardFooter}>
                <Feather name="calendar" color={colors.text.tertiary} size={14} />
                <Text style={styles.cardDate}>
                  {new Date(event.event_date).toLocaleDateString('pl-PL', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </Text>
              </View>
            </TouchableOpacity>
          ))
        )}
      </View>

      {/* My Tasks */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Moje zadania</Text>
        {myTasks.length === 0 ? (
          <View style={styles.emptyState}>
            <Feather name="check-square" color={colors.text.tertiary} size={48} />
            <Text style={styles.emptyText}>Brak zadań do wykonania</Text>
          </View>
        ) : (
          myTasks.map((task) => (
            <TouchableOpacity
              key={task.id}
              style={styles.card}
              onPress={() => handleTaskPress(task)}
              activeOpacity={0.7}
            >
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle} numberOfLines={2}>
                  {task.title}
                </Text>
                <View
                  style={[
                    styles.priorityBadge,
                    { borderColor: PRIORITY_COLORS[task.priority] || '#6b7280' },
                  ]}
                >
                  <Text
                    style={[
                      styles.priorityText,
                      { color: PRIORITY_COLORS[task.priority] || '#6b7280' },
                    ]}
                  >
                    {PRIORITY_LABELS[task.priority] || task.priority}
                  </Text>
                </View>
              </View>

              <View style={styles.cardFooter}>
                <View
                  style={[
                    styles.statusDot,
                    {
                      backgroundColor:
                        TASK_STATUS_COLORS[task.board_column] || colors.text.tertiary,
                    },
                  ]}
                />
                <Text style={styles.cardMeta}>
                  {TASK_STATUS_LABELS[task.board_column] || task.board_column}
                </Text>
                {task.due_date && (
                  <>
                    <Text style={styles.separator}>•</Text>
                    <Text style={styles.cardDate}>
                      {new Date(task.due_date).toLocaleDateString('pl-PL', {
                        day: 'numeric',
                        month: 'short',
                      })}
                    </Text>
                  </>
                )}
              </View>
            </TouchableOpacity>
          ))
        )}
      </View>

      <View style={{ height: spacing.xxxl }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },
  header: {
    padding: spacing.xl,
    paddingBottom: spacing.lg,
  },
  greeting: {
    fontSize: typography.fontSizes.md,
    color: colors.text.secondary,
    fontWeight: typography.fontWeights.light,
  },
  name: {
    fontSize: typography.fontSizes.xxxl,
    color: colors.text.primary,
    fontWeight: typography.fontWeights.bold,
  },
  statsGrid: {
    flexDirection: 'row',
    padding: spacing.md,
    gap: spacing.md,
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.background.secondary,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    borderLeftWidth: 4,
    gap: spacing.sm,
  },
  statValue: {
    fontSize: typography.fontSizes.xxxl,
    fontWeight: typography.fontWeights.bold,
    color: colors.text.primary,
  },
  statLabel: {
    fontSize: typography.fontSizes.sm,
    color: colors.text.secondary,
  },
  section: {
    padding: spacing.md,
    gap: spacing.md,
  },
  sectionTitle: {
    fontSize: typography.fontSizes.xl,
    fontWeight: typography.fontWeights.semibold,
    color: colors.text.primary,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.background.secondary,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border.default,
    gap: spacing.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  cardTitle: {
    flex: 1,
    fontSize: typography.fontSizes.md,
    fontWeight: typography.fontWeights.semibold,
    color: colors.text.primary,
  },
  labelsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    gap: 4,
  },
  badgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  badgeText: {
    fontSize: typography.fontSizes.xs,
    fontWeight: typography.fontWeights.medium,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: 2,
  },
  cardDate: {
    fontSize: typography.fontSizes.xs,
    color: colors.text.tertiary,
  },
  cardMeta: {
    fontSize: typography.fontSizes.xs,
    color: colors.text.secondary,
  },
  priorityBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
  },
  priorityText: {
    fontSize: typography.fontSizes.xs,
    fontWeight: typography.fontWeights.medium,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  separator: {
    color: colors.text.tertiary,
    fontSize: typography.fontSizes.xs,
  },
  emptyState: {
    alignItems: 'center',
    padding: spacing.xxxl,
    gap: spacing.md,
  },
  emptyText: {
    fontSize: typography.fontSizes.md,
    color: colors.text.tertiary,
  },
});
