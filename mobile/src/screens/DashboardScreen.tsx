import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { supabase, Event, Task } from '../lib/supabase';
import { colors, spacing, typography, borderRadius } from '../theme';

export default function DashboardScreen() {
  const { employee } = useAuth();
  const [upcomingEvents, setUpcomingEvents] = useState<Event[]>([]);
  const [myTasks, setMyTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    setLoading(true);
    try {
      // Load upcoming events
      const { data: events } = await supabase
        .from('events')
        .select('*')
        .gte('event_date', new Date().toISOString())
        .order('event_date', { ascending: true })
        .limit(5);

      if (events) setUpcomingEvents(events);

      // Load my tasks
      if (employee) {
        const { data: tasks } = await supabase
          .from('tasks')
          .select('*')
          .eq('assigned_to', employee.id)
          .in('status', ['todo', 'in_progress'])
          .order('due_date', { ascending: true })
          .limit(5);

        if (tasks) setMyTasks(tasks);
      }
    } catch (error) {
      console.error('Error loading dashboard:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'todo':
        return colors.text.tertiary;
      case 'in_progress':
        return colors.status.info;
      case 'done':
        return colors.status.success;
      default:
        return colors.text.secondary;
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent':
        return colors.status.error;
      case 'high':
        return colors.status.warning;
      case 'medium':
        return colors.status.info;
      default:
        return colors.text.tertiary;
    }
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
            <TouchableOpacity key={event.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>{event.title}</Text>
                <View style={[styles.badge, { backgroundColor: colors.primary.gold + '20' }]}>
                  <Text style={[styles.badgeText, { color: colors.primary.gold }]}>
                    {event.status}
                  </Text>
                </View>
              </View>
              {event.description && (
                <Text style={styles.cardDescription} numberOfLines={2}>
                  {event.description}
                </Text>
              )}
              <View style={styles.cardFooter}>
                <Feather name="calendar" color={colors.text.tertiary} size={16} />
                <Text style={styles.cardDate}>
                  {new Date(event.event_date).toLocaleDateString('pl-PL')}
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
            <TouchableOpacity key={task.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>{task.title}</Text>
                <View
                  style={[styles.priorityBadge, { borderColor: getPriorityColor(task.priority) }]}
                >
                  <Feather name="alert-circle" color={getPriorityColor(task.priority)} size={12} />
                </View>
              </View>
              {task.description && (
                <Text style={styles.cardDescription} numberOfLines={2}>
                  {task.description}
                </Text>
              )}
              <View style={styles.cardFooter}>
                <View
                  style={[styles.statusDot, { backgroundColor: getStatusColor(task.status) }]}
                />
                <Text style={styles.cardMeta}>{task.status}</Text>
                {task.due_date && (
                  <>
                    <Text style={styles.separator}>•</Text>
                    <Text style={styles.cardDate}>
                      {new Date(task.due_date).toLocaleDateString('pl-PL')}
                    </Text>
                  </>
                )}
              </View>
            </TouchableOpacity>
          ))
        )}
      </View>
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
  },
  cardTitle: {
    flex: 1,
    fontSize: typography.fontSizes.md,
    fontWeight: typography.fontWeights.semibold,
    color: colors.text.primary,
  },
  cardDescription: {
    fontSize: typography.fontSizes.sm,
    color: colors.text.secondary,
    lineHeight: typography.lineHeights.normal * typography.fontSizes.sm,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  cardDate: {
    fontSize: typography.fontSizes.xs,
    color: colors.text.tertiary,
  },
  cardMeta: {
    fontSize: typography.fontSizes.xs,
    color: colors.text.secondary,
  },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
  },
  badgeText: {
    fontSize: typography.fontSizes.xs,
    fontWeight: typography.fontWeights.medium,
  },
  priorityBadge: {
    width: 24,
    height: 24,
    borderRadius: borderRadius.full,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: borderRadius.full,
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
