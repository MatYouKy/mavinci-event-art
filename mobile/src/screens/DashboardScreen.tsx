import { useOperationalStages } from '../hooks/useOperationalStages';
import { OPERATIONAL_LABELS, usesOperationalStages } from '../lib/operationalStages';
import React, { useState, useCallback } from 'react';
import { useForegroundEffect } from '../hooks/useForegroundEffect';
import { createRefreshQueue } from '../lib/refreshQueue';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  useWindowDimensions,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { sortTasksByUrgency } from '../lib/taskSort';
import { colors, spacing, typography, borderRadius } from '../theme';

const TABLET_BREAKPOINT = 768;

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
  creator_name: string | null;
}

interface DashboardTask {
  id: string;
  title: string;
  priority: string;
  status: string;
  board_column: string;
  due_date: string | null;
  created_at: string | null;
}

export default function DashboardScreen() {
  const { employee } = useAuth();
  const navigation = useNavigation<any>();
  const [upcomingEvents, setUpcomingEvents] = useState<DashboardEvent[]>([]);
  const [myTasks, setMyTasks] = useState<DashboardTask[]>([]);
  const [damaged, setDamaged] = useState<any[]>([]);
  const [loadError, setLoadError] = useState('');
  const isWarehouse = employee?.permissions?.includes('equipment_manage') === true;
  const operational = usesOperationalStages(employee);
  const { stage, error: stageError } = useOperationalStages(upcomingEvents, operational);
  const [loading, setLoading] = useState(false);
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BREAKPOINT;

  useForegroundEffect(
    (signal) => {
      if (!employee?.id) return;
      const queue = createRefreshQueue(signal, () => loadDashboardData());
      void queue.refresh();

      const taskAssigneesChannel = supabase
        .channel(`dashboard_task_assignees_${employee.id}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'task_assignees',
            filter: `employee_id=eq.${employee.id}`,
          },
          () => {
            queue.schedule();
          },
        )
        .subscribe();

      const tasksChannel = supabase
        .channel(`dashboard_tasks_${employee.id}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tasks' }, () => {
          queue.schedule();
        })
        .subscribe();

      const employeeAssignmentsChannel = supabase
        .channel(`dashboard_employee_assignments_${employee.id}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'employee_assignments',
            filter: `employee_id=eq.${employee.id}`,
          },
          () => {
            queue.schedule();
          },
        )
        .subscribe();

      const eventsChannel = supabase
        .channel(`dashboard_events_${employee.id}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'events' }, () => {
          queue.schedule();
        })
        .subscribe();

      const warehouseChannel = isWarehouse
        ? supabase
            .channel(`dashboard_warehouse_${employee.id}`)
            .on(
              'postgres_changes',
              { event: '*', schema: 'public', table: 'equipment_units' },
              () => queue.schedule(),
            )
            .on(
              'postgres_changes',
              { event: '*', schema: 'public', table: 'event_warehouse_handoffs' },
              () => queue.schedule(),
            )
            .on(
              'postgres_changes',
              { event: '*', schema: 'public', table: 'event_realizations' },
              () => queue.schedule(),
            )
            .subscribe()
        : null;

      return () => {
        return Promise.all([
          supabase.removeChannel(taskAssigneesChannel),
          supabase.removeChannel(tasksChannel),
          supabase.removeChannel(employeeAssignmentsChannel),
          supabase.removeChannel(eventsChannel),
          ...(warehouseChannel ? [supabase.removeChannel(warehouseChannel)] : []),
        ]);
      };
    },
    [employee?.id, isWarehouse],
  );

  const loadDashboardData = useCallback(async () => {
    if (!employee?.id) return;
    setLoading(true);
    setLoadError('');
    try {
      // Fetch upcoming events assigned to this employee (accepted) or created by them
      const { data: assignedEventIds, error: assignmentError } = await supabase
        .from('employee_assignments')
        .select('event_id')
        .eq('employee_id', employee.id)
        .eq('status', 'accepted');

      if (assignmentError) throw assignmentError;
      const acceptedIds = assignedEventIds?.map((a) => a.event_id) ?? [];

      // Also fetch events created by this employee
      const { data: createdEvents, error: createdError } = await supabase
        .from('events')
        .select('id')
        .eq('created_by', employee.id)
        .gte('event_date', new Date().toISOString().split('T')[0])
        .not('status', 'eq', 'cancelled');

      if (createdError) throw createdError;
      const createdIds = (createdEvents ?? []).map((e) => e.id);
      const eventIds = [...new Set([...acceptedIds, ...createdIds])];

      let events: DashboardEvent[] = [];
      if (eventIds.length > 0) {
        const { data, error } = await supabase
          .from('events')
          .select(
            `
            id, name, event_date, status,
            event_categories(name, color),
            creator:employees!created_by(name, surname)
          `,
          )
          .in('id', eventIds)
          .gte('event_date', new Date().toISOString().split('T')[0])
          .not('status', 'eq', 'cancelled')
          .order('event_date', { ascending: true })
          .limit(8);

        if (error) throw error;
        events = (data ?? []).map((e: any) => ({
          id: e.id,
          name: e.name,
          event_date: e.event_date,
          status: e.status,
          category_name: e.event_categories?.name ?? null,
          category_color: e.event_categories?.color ?? null,
          creator_name: e.creator
            ? [e.creator.name, e.creator.surname].filter(Boolean).join(' ')
            : null,
        }));
      }
      const [realizations, warehouseEvents, broken] = await Promise.all([
        supabase.rpc('get_my_realizations'),
        isWarehouse
          ? supabase
              .from('events')
              .select('id,name,event_date,status')
              .in('status', [
                'offer_accepted',
                'in_preparation',
                'ready_for_live',
                'in_progress',
                'invoiced',
                'settled',
              ])
              .or(`status.not.in.(invoiced,settled),event_end_date.gte.${new Date().toISOString()}`)
              .order('event_date', { ascending: true })
              .limit(30)
          : Promise.resolve({ data: [], error: null }),
        isWarehouse
          ? supabase
              .from('equipment_units')
              .select(
                'id,equipment_id,unit_serial_number,condition_notes,equipment:equipment_items(name)',
              )
              .eq('status', 'damaged')
              .order('updated_at', { ascending: false })
              .limit(20)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (realizations.error || warehouseEvents.error || broken.error)
        throw realizations.error || warehouseEvents.error || broken.error;
      const warehouseRows = warehouseEvents.data || [];
      const warehouseStates = warehouseRows.length
        ? await supabase.rpc('get_event_operational_states', {
            p_event_ids: warehouseRows.map((event: any) => event.id),
          })
        : { data: [], error: null };
      if (warehouseStates.error) throw warehouseStates.error;
      const states = new Map(
        (warehouseStates.data || []).map((row: any) => [row.event_id, row.status]),
      );
      const merged = new Map(events.map((event) => [event.id, event]));
      for (const entry of [...warehouseRows, ...(realizations.data || [])]) {
        const event = {
          ...entry,
          operational_status: entry.operational_status || states.get(entry.id),
        };
        if (
          ['completed', 'settled', 'cancelled'].includes(event.operational_status || event.status)
        ) {
          merged.delete(event.id);
          continue;
        }
        merged.set(event.id, {
          ...event,
          status: event.operational_status || event.status,
          category_name: null,
          category_color: null,
          creator_name: null,
        });
      }
      setUpcomingEvents(
        [...merged.values()].sort(
          (a, b) => new Date(a.event_date).getTime() - new Date(b.event_date).getTime(),
        ),
      );
      setDamaged(broken.data || []);

      // Filter assignments on the server: a large employee history must not become
      // an oversized URL containing every assigned task UUID.
      const { data: tasks, error: tasksError } = await supabase
        .from('tasks')
        .select(
          'id, title, priority, status, board_column, due_date, created_at, task_assignees!inner(employee_id)',
        )
        .eq('task_assignees.employee_id', employee.id)
        .in('board_column', ['todo', 'in_progress', 'review'])
        .limit(50);

      if (tasksError) throw tasksError;
      setMyTasks(sortTasksByUrgency(tasks ?? []).slice(0, 8));
    } catch (error) {
      console.error('Error loading dashboard:', error);
      setLoadError(
        'Nie udało się odświeżyć wszystkich danych. Pociągnij ekran w dół, aby ponowić.',
      );
    } finally {
      setLoading(false);
    }
  }, [employee?.id, isWarehouse]);

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

      {!!(loadError || stageError) && (
        <Text accessibilityRole="alert" style={{ color: colors.status.error, padding: 16 }}>
          {loadError || stageError}
        </Text>
      )}
      {isWarehouse && (
        <View style={{ paddingHorizontal: 16, gap: 12 }}>
          <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
            {[
              { screen: 'Equipment', label: 'Sprzęt' },
              { screen: 'Events', label: 'Wydarzenia' },
              { screen: 'Tasks', label: 'Moje zadania' },
            ].map((item) => (
              <TouchableOpacity
                key={item.screen}
                accessibilityRole="button"
                onPress={() => navigation.navigate(item.screen)}
                style={{
                  padding: 12,
                  borderRadius: 8,
                  backgroundColor: colors.background.secondary,
                }}
              >
                <Text style={{ color: colors.primary.gold }}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={{ color: colors.text.primary, fontSize: 18 }}>Uszkodzony sprzęt</Text>
          {damaged.length === 0 && !loadError && (
            <Text style={{ color: colors.text.secondary }}>
              Brak egzemplarzy oznaczonych jako uszkodzone.
            </Text>
          )}
          {damaged.map((unit) => (
            <TouchableOpacity
              key={unit.id}
              accessibilityRole="button"
              onPress={() => navigation.navigate('Equipment', { equipmentId: unit.equipment_id })}
              style={{ padding: 12, borderRadius: 8, backgroundColor: colors.background.secondary }}
            >
              <Text style={{ color: colors.text.primary }}>
                {(Array.isArray(unit.equipment) ? unit.equipment[0] : unit.equipment)?.name ||
                  'Sprzęt'}{' '}
                · <Text style={{ color: colors.status.error }}>Uszkodzony</Text>
              </Text>
              {!!unit.unit_serial_number && (
                <Text style={{ color: colors.text.secondary }}>
                  Nr seryjny: {unit.unit_serial_number}
                </Text>
              )}
              {!!unit.condition_notes && (
                <Text style={{ color: colors.text.secondary }}>{unit.condition_notes}</Text>
              )}
            </TouchableOpacity>
          ))}
          {damaged.length === 20 && (
            <Text style={{ color: colors.text.secondary }}>
              Pokazano 20 ostatnio aktualizowanych egzemplarzy.
            </Text>
          )}
        </View>
      )}
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

      <View style={isTablet ? styles.tabletColumns : undefined}>
        {/* Upcoming Events */}
        <View style={[styles.section, isTablet && styles.tabletColumn]}>
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
                        backgroundColor: (EVENT_STATUS_COLORS[stage(event)] || '#6b7280') + '20',
                        borderColor: (EVENT_STATUS_COLORS[stage(event)] || '#6b7280') + '40',
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.badgeText,
                        { color: EVENT_STATUS_COLORS[stage(event)] || '#6b7280' },
                      ]}
                    >
                      {(operational
                        ? OPERATIONAL_LABELS[stage(event)]
                        : EVENT_STATUS_LABELS[event.status]) || 'Wydarzenie'}
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
                  {event.creator_name && (
                    <>
                      <Text style={styles.separator}>•</Text>
                      <Feather name="user" color={colors.text.tertiary} size={12} />
                      <Text style={styles.cardDate}>{event.creator_name}</Text>
                    </>
                  )}
                </View>
              </TouchableOpacity>
            ))
          )}
        </View>

        {/* My Tasks */}
        <View style={[styles.section, isTablet && styles.tabletColumn]}>
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
                  {task.due_date &&
                    (() => {
                      const isOverdue =
                        new Date(task.due_date) < new Date() && task.board_column !== 'completed';
                      return (
                        <>
                          <Text style={styles.separator}>•</Text>
                          <Text style={[styles.cardDate, isOverdue && styles.overdueDate]}>
                            {isOverdue ? 'Zaległe: ' : ''}
                            {new Date(task.due_date).toLocaleDateString('pl-PL', {
                              day: 'numeric',
                              month: 'short',
                            })}
                          </Text>
                        </>
                      );
                    })()}
                </View>
              </TouchableOpacity>
            ))
          )}
        </View>
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
    fontFamily: 'MBFAtom',
    textTransform: 'uppercase',
    letterSpacing: 2,
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
    fontFamily: 'MBFAtom',
    textTransform: 'uppercase',
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
    fontFamily: 'MBFAtom',
    textTransform: 'uppercase',
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
  separator: {
    fontSize: typography.fontSizes.xs,
    color: colors.text.tertiary,
    marginHorizontal: 4,
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
  emptyState: {
    alignItems: 'center',
    padding: spacing.xxxl,
    gap: spacing.md,
  },
  emptyText: {
    fontSize: typography.fontSizes.md,
    color: colors.text.tertiary,
  },
  tabletColumns: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  tabletColumn: {
    flex: 1,
  },
  overdueDate: {
    color: colors.status?.error ?? '#ef4444',
    fontWeight: '700',
  },
});
