import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  Alert,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing } from '../theme';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import PermissionGate from '../components/PermissionGate';

interface TimeEntry {
  id: string;
  title: string | null;
  description: string | null;
  start_time: string;
  end_time: string | null;
  duration_minutes: number | null;
  task_id: string | null;
  event_id: string | null;
  task_title?: string | null;
  event_name?: string | null;
}

function TimeTrackingContent() {
  const { employee } = useAuth();
  const [activeEntry, setActiveEntry] = useState<TimeEntry | null>(null);
  const [todayEntries, setTodayEntries] = useState<TimeEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    if (!employee?.id) return;

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const tomorrowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();

    const [activeRes, todayRes] = await Promise.all([
      supabase
        .from('time_entries')
        .select('*, tasks(title), events(name)')
        .eq('employee_id', employee.id)
        .is('end_time', null)
        .order('start_time', { ascending: false })
        .limit(1),
      supabase
        .from('time_entries')
        .select('*, tasks(title), events(name)')
        .eq('employee_id', employee.id)
        .gte('start_time', todayStart)
        .lt('start_time', tomorrowStart)
        .not('end_time', 'is', null)
        .order('start_time', { ascending: false }),
    ]);

    const active = activeRes.data?.[0] || null;
    if (active) {
      setActiveEntry({
        ...active,
        task_title: (active as any).tasks?.title || null,
        event_name: (active as any).events?.name || null,
      });
    } else {
      setActiveEntry(null);
    }

    setTodayEntries(
      (todayRes.data || []).map((e: any) => ({
        ...e,
        task_title: e.tasks?.title || null,
        event_name: e.events?.name || null,
      }))
    );
  }, [employee?.id]);

  const loadAll = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setIsLoading(true);
      try {
        await fetchData();
      } finally {
        setIsLoading(false);
        setRefreshing(false);
      }
    },
    [fetchData]
  );

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const overtimeCheckedRef = useRef(false);

  // Timer interval
  useEffect(() => {
    if (!activeEntry) {
      setElapsed(0);
      overtimeCheckedRef.current = false;
  
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
  
      return;
    }
  
    const updateElapsed = () => {
      const start = new Date(activeEntry.start_time).getTime();
      const now = Date.now();
  
      setElapsed(Math.max(0, Math.floor((now - start) / 1000)));
    };
  
    updateElapsed();
  
    intervalRef.current = setInterval(updateElapsed, 1000);
  
    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [activeEntry]);

  // 8-hour notification: call backend RPC once when threshold is crossed
  useEffect(() => {
    if (elapsed >= 8 * 3600 && !overtimeCheckedRef.current && activeEntry) {
      overtimeCheckedRef.current = true;
      supabase.rpc('check_my_overtime_timer').then(({ error }) => {
        if (error) {
          console.warn('Overtime notification RPC failed:', error.message);
        }
      });
    }
  }, [elapsed, activeEntry]);

  const startWork = async () => {
    if (!employee?.id) return;
    if (!taskTitle.trim()) {
      Alert.alert('Wymagane', 'Wpisz nazwę zadania przed rozpoczęciem pracy');
      return;
    }

    setIsStarting(true);
    try {
      const { data, error } = await supabase
        .from('time_entries')
        .insert({
          employee_id: employee.id,
          title: taskTitle.trim(),
          description: taskDescription.trim() || null,
          start_time: new Date().toISOString(),
        })
        .select('*, tasks(title), events(name)')
        .single();

      if (error) throw error;

      setActiveEntry({
        ...data,
        task_title: (data as any).tasks?.title || null,
        event_name: (data as any).events?.name || null,
      });
      setTaskTitle('');
      setTaskDescription('');
    } catch (err: any) {
      Alert.alert('Błąd', err.message || 'Nie udało się rozpocząć pracy');
    } finally {
      setIsStarting(false);
    }
  };

  const stopWork = async () => {
    if (!activeEntry) return;

    Alert.alert('Zakończ pracę', 'Czy chcesz zakończyć bieżące zadanie?', [
      { text: 'Anuluj', style: 'cancel' },
      {
        text: 'Zakończ',
        onPress: async () => {
          setIsStopping(true);
          try {
            const { error } = await supabase
              .from('time_entries')
              .update({ end_time: new Date().toISOString() })
              .eq('id', activeEntry.id);

            if (error) throw error;

            setActiveEntry(null);
            await fetchData();
          } catch (err: any) {
            Alert.alert('Błąd', err.message || 'Nie udało się zakończyć pracy');
          } finally {
            setIsStopping(false);
          }
        },
      },
    ]);
  };

  const formatDuration = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const formatDurationMinutes = (minutes: number | null) => {
    if (!minutes) return '0min';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h > 0) return `${h}h ${m}min`;
    return `${m}min`;
  };

  const formatTime = (dateStr: string) =>
    new Date(dateStr).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });

  const getTodayTotal = () => {
    const completedMinutes = todayEntries.reduce((sum, e) => sum + (e.duration_minutes || 0), 0);
    const activeMinutes = activeEntry ? Math.floor(elapsed / 60) : 0;
    return completedMinutes + activeMinutes;
  };

  const isOver8Hours = elapsed >= 8 * 3600;

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary.gold} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => loadAll(true)}
          tintColor={colors.primary.gold}
        />
      }
    >
      {/* Active timer or start form */}
      {activeEntry ? (
        <View style={styles.activeTimerCard}>
          <View style={styles.timerPulse}>
            <View style={[styles.timerDot, isOver8Hours && styles.timerDotWarning]} />
          </View>
          <Text style={styles.timerLabel}>W trakcie pracy</Text>
          <Text style={[styles.timerValue, isOver8Hours && styles.timerValueWarning]}>
            {formatDuration(elapsed)}
          </Text>
          {isOver8Hours && (
            <View style={styles.warningBanner}>
              <Feather name="alert-triangle" size={14} color={colors.status.warning} />
              <Text style={styles.warningText}>
                Minęło 8 godzin pracy. Rozważ zakończenie.
              </Text>
            </View>
          )}
          <View style={styles.activeTaskInfo}>
            <Feather name="file-text" size={14} color={colors.text.secondary} />
            <Text style={styles.activeTaskTitle}>{activeEntry.title || activeEntry.task_title}</Text>
          </View>
          {activeEntry.description && (
            <Text style={styles.activeTaskDesc}>{activeEntry.description}</Text>
          )}
          <Text style={styles.activeStartTime}>
            Rozpoczęto: {formatTime(activeEntry.start_time)}
          </Text>
          <TouchableOpacity
            style={[styles.stopButton, isStopping && styles.buttonDisabled]}
            onPress={stopWork}
            disabled={isStopping}
            activeOpacity={0.7}
          >
            {isStopping ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <>
                <Feather name="square" size={18} color={colors.white} />
                <Text style={styles.stopButtonText}>Zakończ pracę</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.startCard}>
          <View style={styles.startCardHeader}>
            <Feather name="play-circle" size={20} color={colors.primary.gold} />
            <Text style={styles.startCardTitle}>Rozpocznij pracę</Text>
          </View>
          <TextInput
            style={styles.input}
            placeholder="Nazwa zadania *"
            placeholderTextColor={colors.text.tertiary}
            value={taskTitle}
            onChangeText={setTaskTitle}
          />
          <TextInput
            style={[styles.input, styles.inputMultiline]}
            placeholder="Opis (opcjonalnie)"
            placeholderTextColor={colors.text.tertiary}
            value={taskDescription}
            onChangeText={setTaskDescription}
            multiline
            numberOfLines={2}
          />
          <TouchableOpacity
            style={[styles.startButton, isStarting && styles.buttonDisabled]}
            onPress={startWork}
            disabled={isStarting}
            activeOpacity={0.7}
          >
            {isStarting ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <>
                <Feather name="play" size={18} color={colors.white} />
                <Text style={styles.startButtonText}>Start</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* Today summary */}
      <View style={styles.summaryCard}>
        <Text style={styles.summaryTitle}>Dzisiaj</Text>
        <View style={styles.summaryRow}>
          <View style={styles.summaryItem}>
            <Feather name="clock" size={16} color={colors.primary.gold} />
            <Text style={styles.summaryValue}>{formatDurationMinutes(getTodayTotal())}</Text>
            <Text style={styles.summaryLabel}>Łącznie</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Feather name="list" size={16} color={colors.primary.gold} />
            <Text style={styles.summaryValue}>
              {todayEntries.length + (activeEntry ? 1 : 0)}
            </Text>
            <Text style={styles.summaryLabel}>Zadań</Text>
          </View>
        </View>
        {/* 8h progress bar */}
        <View style={styles.progressSection}>
          <View style={styles.progressBarBg}>
            <View
              style={[
                styles.progressBarFill,
                {
                  width: `${Math.min((getTodayTotal() / 480) * 100, 100)}%`,
                  backgroundColor:
                    getTodayTotal() >= 480 ? colors.status.warning : colors.status.success,
                },
              ]}
            />
          </View>
          <Text style={styles.progressLabel}>
            {formatDurationMinutes(getTodayTotal())} / 8h
          </Text>
        </View>
      </View>

      {/* Today entries */}
      {todayEntries.length > 0 && (
        <View style={styles.entriesSection}>
          <Text style={styles.entriesSectionTitle}>Zakończone dzisiaj</Text>
          {todayEntries.map((entry) => (
            <View key={entry.id} style={styles.entryRow}>
              <View style={styles.entryIconBg}>
                <Feather name="check-circle" size={14} color={colors.status.success} />
              </View>
              <View style={styles.entryContent}>
                <Text style={styles.entryTitle} numberOfLines={1}>
                  {entry.title || entry.task_title || 'Bez tytułu'}
                </Text>
                <View style={styles.entryMeta}>
                  <Text style={styles.entryTime}>
                    {formatTime(entry.start_time)} - {entry.end_time ? formatTime(entry.end_time) : '?'}
                  </Text>
                  {entry.event_name && (
                    <Text style={styles.entryEvent} numberOfLines={1}>
                      {entry.event_name}
                    </Text>
                  )}
                </View>
              </View>
              <Text style={styles.entryDuration}>
                {formatDurationMinutes(entry.duration_minutes)}
              </Text>
            </View>
          ))}
        </View>
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background.primary,
  },

  // Active timer
  activeTimerCard: {
    margin: spacing.md,
    padding: 24,
    backgroundColor: colors.background.secondary,
    borderRadius: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.primary.gold + '30',
  },
  timerPulse: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.status.success + '30',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  timerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.status.success,
  },
  timerDotWarning: {
    backgroundColor: colors.status.warning,
  },
  timerLabel: {
    fontSize: 12,
    color: colors.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  },
  timerValue: {
    fontSize: 40,
    fontWeight: '200',
    color: colors.primary.gold,
    fontVariant: ['tabular-nums'],
    letterSpacing: 2,
  },
  timerValueWarning: {
    color: colors.status.warning,
  },
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.status.warning + '15',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 12,
    width: '100%',
  },
  warningText: {
    fontSize: 12,
    color: colors.status.warning,
    fontWeight: '600',
    flex: 1,
  },
  activeTaskInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
  },
  activeTaskTitle: {
    fontSize: 14,
    color: colors.text.primary,
    fontWeight: '600',
  },
  activeTaskDesc: {
    fontSize: 12,
    color: colors.text.secondary,
    marginTop: 4,
    textAlign: 'center',
  },
  activeStartTime: {
    fontSize: 11,
    color: colors.text.tertiary,
    marginTop: 8,
  },
  stopButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.status.error,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 24,
    marginTop: 20,
    width: '100%',
  },
  stopButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.white,
  },

  // Start card
  startCard: {
    margin: spacing.md,
    padding: 20,
    backgroundColor: colors.background.secondary,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  startCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
  },
  startCardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text.primary,
  },
  input: {
    backgroundColor: colors.background.tertiary,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: colors.text.primary,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  inputMultiline: {
    minHeight: 60,
    textAlignVertical: 'top',
  },
  startButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.status.success,
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 6,
  },
  startButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.white,
  },
  buttonDisabled: {
    opacity: 0.6,
  },

  // Summary
  summaryCard: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    padding: 16,
    backgroundColor: colors.background.secondary,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  summaryTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  summaryValue: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text.primary,
  },
  summaryLabel: {
    fontSize: 11,
    color: colors.text.tertiary,
  },
  summaryDivider: {
    width: 1,
    height: 36,
    backgroundColor: colors.border.default,
  },
  progressSection: {
    marginTop: 14,
  },
  progressBarBg: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.background.tertiary,
    overflow: 'hidden',
    marginBottom: 4,
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  progressLabel: {
    fontSize: 10,
    color: colors.text.tertiary,
    textAlign: 'right',
  },

  // Entries list
  entriesSection: {
    marginHorizontal: spacing.md,
  },
  entriesSectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.text.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
    gap: 10,
  },
  entryIconBg: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.status.success + '15',
    alignItems: 'center',
    justifyContent: 'center',
  },
  entryContent: {
    flex: 1,
  },
  entryTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text.primary,
  },
  entryMeta: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 2,
  },
  entryTime: {
    fontSize: 11,
    color: colors.text.tertiary,
  },
  entryEvent: {
    fontSize: 11,
    color: colors.primary.gold,
    maxWidth: 120,
  },
  entryDuration: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text.primary,
  },
});

export default function TimeTrackingScreen() {
  return (
    <PermissionGate module="time_tracking">
      <TimeTrackingContent />
    </PermissionGate>
  );
}
