import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Modal,
  TextInput,
  ScrollView,
  Alert,
  Platform,
  Switch,
} from 'react-native';

import * as Notifications from 'expo-notifications';

import { Feather } from '@expo/vector-icons';
import { colors, spacing, typography } from '../theme';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';

// --- Types ---
type AlertPickerType = 'alert_1' | 'alert_2' | 'alert_critical';
interface Meeting {
  id: string;
  title: string;
  location_text: string | null;
  datetime_start: string;
  datetime_end: string | null;
  notes: string | null;
  color: string;
  is_all_day: boolean;
  created_by: string | null;
  alert_1_minutes: number | null;
  alert_2_minutes: number | null;
  alert_critical_minutes: number | null;
  participants?: { employee_id: string }[];
}

interface NewMeetingForm {
  title: string;
  location_text: string;
  datetime_start: string;
  datetime_end: string;
  notes: string;
  alert_1_enabled: boolean;
  alert_1_minutes: number;
  alert_2_enabled: boolean;
  alert_2_minutes: number;
  alert_critical_enabled: boolean;
  alert_critical_minutes: number;
}

// --- Helpers ---

const SLIDER_MIN = 15;
const SLIDER_MAX = 2880; // 2 days in minutes
const SLIDER_STEP = 15;

function minutesToLabel(minutes: number): string {
  if (minutes >= 1440) {
    const days = Math.round(minutes / 1440);
    return days === 1 ? '1 dzień' : `${days} dni`;
  }
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (mins === 0) return hours === 1 ? '1 godz.' : `${hours} godz.`;
    return `${hours} godz. ${mins} min`;
  }
  return `${minutes} min`;
}

function minutesToPickerDate(minutes: number): Date {
  const date = new Date();
  date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return date;
}

function pickerDateToMinutes(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

// --- Notification setup ---

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

async function scheduleMeetingAlerts(meeting: Meeting) {
  const scheduled =
    await Notifications.getAllScheduledNotificationsAsync();

  for (const notification of scheduled) {
    if (notification.content.data?.meetingId === meeting.id) {
      await Notifications.cancelScheduledNotificationAsync(
        notification.identifier,
      );
    }
  }

  const meetingTime = new Date(meeting.datetime_start).getTime();
  const now = Date.now();

  const alerts = [
    {
      minutes: meeting.alert_1_minutes,
      label: 'Przypomnienie',
      priority: Notifications.AndroidNotificationPriority.DEFAULT,
    },
    {
      minutes: meeting.alert_2_minutes,
      label: 'Przypomnienie',
      priority: Notifications.AndroidNotificationPriority.HIGH,
    },
    {
      minutes: meeting.alert_critical_minutes,
      label: 'PILNE',
      priority: Notifications.AndroidNotificationPriority.MAX,
    },
  ];

  for (const alert of alerts) {
    if (!alert.minutes || alert.minutes <= 0) continue;

    const triggerTime =
      meetingTime - alert.minutes * 60 * 1000;

    if (triggerTime <= now) continue;

    const secondsUntilTrigger = Math.max(
      1,
      Math.floor((triggerTime - now) / 1000),
    );

    await Notifications.scheduleNotificationAsync({
      content: {
        title: `${alert.label}: ${meeting.title}`,
        body: `Spotkanie za ${minutesToLabel(alert.minutes)}`,
        sound: true,
        priority: alert.priority,
        data: {
          type: 'meeting_reminder',
          meetingId: meeting.id,
        },
      },
      trigger: {
        type:
          Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: secondsUntilTrigger,
        repeats: false,
      },
    });
  }
}

async function requestNotificationPermissions() {
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

// --- Main Screen ---

export default function MeetingsScreen() {
  const { employee } = useAuth();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showNewMeeting, setShowNewMeeting] = useState(false);
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);
  const [form, setForm] = useState<NewMeetingForm>({
    title: '',
    location_text: '',
    datetime_start: '',
    datetime_end: '',
    notes: '',
    alert_1_enabled: true,
    alert_1_minutes: 1440,
    alert_2_enabled: true,
    alert_2_minutes: 120,
    alert_critical_enabled: true,
    alert_critical_minutes: 15,
  });

  const [activeAlertPicker, setActiveAlertPicker] = useState<AlertPickerType | null>(null);

  useEffect(() => {
    requestNotificationPermissions();
  }, []);

  const fetchMeetings = useCallback(
    async (isRefresh = false) => {
      if (!employee) return;
      if (isRefresh) setRefreshing(true);
      else setIsLoading(true);

      try {
        const { data, error } = await supabase
          .from('meetings')
          .select(
            `
          *,
          meeting_participants(employee_id)
        `,
          )
          .is('deleted_at', null)
          .order('datetime_start', { ascending: true });

        if (!error && data) {
          const myMeetings = data.filter(
            (m: any) =>
              m.created_by === employee.id ||
              m.meeting_participants?.some((p: any) => p.employee_id === employee.id),
          );
          setMeetings(myMeetings);

          for (const meeting of myMeetings) {
            if (new Date(meeting.datetime_start).getTime() > Date.now()) {
              scheduleMeetingAlerts(meeting);
            }
          }
        }
      } catch (err) {
        // silently fail
      } finally {
        setIsLoading(false);
        setRefreshing(false);
      }
    },
    [employee],
  );

  useEffect(() => {
    fetchMeetings();
  }, [fetchMeetings]);

  const resetForm = () => {
    setForm({
      title: '',
      location_text: '',
      datetime_start: '',
      datetime_end: '',
      notes: '',
      alert_1_enabled: true,
      alert_1_minutes: 1440,
      alert_2_enabled: true,
      alert_2_minutes: 120,
      alert_critical_enabled: true,
      alert_critical_minutes: 15,
    });
  };

  const handleCreateMeeting = async () => {
    if (!employee || !form.title.trim()) {
      Alert.alert('Błąd', 'Podaj tytuł spotkania');
      return;
    }
    if (!form.datetime_start) {
      Alert.alert('Błąd', 'Podaj datę i godzinę rozpoczęcia');
      return;
    }

    try {
      const { data, error } = await supabase
        .from('meetings')
        .insert({
          title: form.title.trim(),
          location_text: form.location_text.trim() || null,
          datetime_start: form.datetime_start,
          datetime_end: form.datetime_end || null,
          notes: form.notes.trim() || null,
          created_by: employee.id,
          alert_1_minutes: form.alert_1_enabled ? form.alert_1_minutes : null,
          alert_2_minutes: form.alert_2_enabled ? form.alert_2_minutes : null,
          alert_critical_minutes: form.alert_critical_enabled ? form.alert_critical_minutes : null,
        })
        .select()
        .single();

      if (error) throw error;

      if (data) {
        await supabase.from('meeting_participants').insert({
          meeting_id: data.id,
          employee_id: employee.id,
        });
        scheduleMeetingAlerts(data);
      }

      setShowNewMeeting(false);
      resetForm();
      fetchMeetings();
    } catch (err: any) {
      Alert.alert('Błąd', err.message || 'Nie udało się utworzyć spotkania');
    }
  };

  const handleDeleteMeeting = async (meetingId: string) => {
    Alert.alert('Usunąć spotkanie?', 'Tej operacji nie można cofnąć.', [
      { text: 'Anuluj', style: 'cancel' },
      {
        text: 'Usuń',
        style: 'destructive',
        onPress: async () => {
          await supabase
            .from('meetings')
            .update({ deleted_at: new Date().toISOString() })
            .eq('id', meetingId);

          const scheduled = await Notifications.getAllScheduledNotificationsAsync();
          for (const notif of scheduled) {
            if (notif.content.data?.meetingId === meetingId) {
              await Notifications.cancelScheduledNotificationAsync(notif.identifier);
            }
          }

          setSelectedMeeting(null);
          fetchMeetings();
        },
      },
    ]);
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('pl-PL', { weekday: 'short', day: 'numeric', month: 'short' });
  };

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
  };

  const isUpcoming = (dateStr: string) => new Date(dateStr).getTime() > Date.now();

  const upcomingMeetings = meetings.filter((m) => isUpcoming(m.datetime_start));
  const pastMeetings = meetings.filter((m) => !isUpcoming(m.datetime_start));

  const renderMeetingCard = ({ item }: { item: Meeting }) => {
    const upcoming = isUpcoming(item.datetime_start);
    const hasAlerts = !!(
      item.alert_1_minutes ||
      item.alert_2_minutes ||
      item.alert_critical_minutes
    );

    return (
      <TouchableOpacity
        style={[styles.meetingCard, !upcoming && styles.meetingCardPast]}
        activeOpacity={0.7}
        onPress={() => setSelectedMeeting(item)}
      >
        <View
          style={[styles.meetingStripe, { backgroundColor: item.color || colors.primary.gold }]}
        />
        <View style={styles.meetingContent}>
          <View style={styles.meetingHeader}>
            <Text style={[styles.meetingTitle, !upcoming && styles.textPast]} numberOfLines={1}>
              {item.title}
            </Text>
            {hasAlerts && upcoming && <Feather name="bell" size={14} color={colors.primary.gold} />}
          </View>
          <View style={styles.meetingMeta}>
            <Feather name="clock" size={12} color={colors.text.tertiary} />
            <Text style={styles.meetingMetaText}>
              {formatDate(item.datetime_start)} • {formatTime(item.datetime_start)}
              {item.datetime_end && ` – ${formatTime(item.datetime_end)}`}
            </Text>
          </View>
          {item.location_text && (
            <View style={styles.meetingMeta}>
              <Feather name="map-pin" size={12} color={colors.text.tertiary} />
              <Text style={styles.meetingMetaText} numberOfLines={1}>
                {item.location_text}
              </Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  const AlertTimePicker = ({
    type,
    label,
    enabled,
    onToggle,
    value,
    onValueChange,
    isCritical,
  }: {
    type: AlertPickerType;
    label: string;
    enabled: boolean;
    onToggle: (value: boolean) => void;
    value: number;
    onValueChange: (value: number) => void;
    isCritical?: boolean;
  }) => {
    const days = Math.floor(value / 1440);
    const remainingMinutes = value % 1440;
    const pickerDate = minutesToPickerDate(remainingMinutes);

    const setDays = (newDays: number) => {
      const safeDays = Math.max(0, Math.min(7, newDays));
      onValueChange(safeDays * 1440 + remainingMinutes);
    };

    const handleTimeChange = (event: DateTimePickerEvent, selectedDate?: Date) => {
      if (Platform.OS === 'android') {
        setActiveAlertPicker(null);
      }

      if (event.type === 'dismissed' || !selectedDate) return;

      const selectedMinutes = pickerDateToMinutes(selectedDate);
      const totalMinutes = days * 1440 + selectedMinutes;

      onValueChange(Math.max(SLIDER_MIN, totalMinutes));
    };

    return (
      <View style={styles.alertPickerBlock}>
        <View style={styles.alertSliderHeader}>
          <View style={styles.alertSliderLabelRow}>
            <Feather
              name={isCritical ? 'alert-triangle' : 'bell'}
              size={14}
              color={isCritical ? colors.status.error : colors.text.secondary}
            />

            <Text
              style={[
                styles.alertSliderLabel,
                isCritical && {
                  color: colors.status.error,
                },
              ]}
            >
              {label}
            </Text>
          </View>

          <Switch
            value={enabled}
            onValueChange={onToggle}
            trackColor={{
              false: colors.background.primary,
              true: isCritical ? `${colors.status.error}55` : `${colors.primary.gold}55`,
            }}
            thumbColor={
              enabled
                ? isCritical
                  ? colors.status.error
                  : colors.primary.gold
                : colors.text.tertiary
            }
          />
        </View>

        {enabled && (
          <View style={styles.alertPickerBody}>
            <Text style={styles.alertPickerDescription}>Powiadomienie:</Text>

            <View style={styles.alertTimeControls}>
              <View style={styles.daysControl}>
                <TouchableOpacity
                  style={styles.daysButton}
                  onPress={() => setDays(days - 1)}
                  disabled={days === 0}
                >
                  <Feather
                    name="minus"
                    size={16}
                    color={days === 0 ? colors.text.tertiary : colors.primary.gold}
                  />
                </TouchableOpacity>

                <View style={styles.daysValue}>
                  <Text style={styles.daysValueNumber}>{days}</Text>
                  <Text style={styles.daysValueLabel}>{days === 1 ? 'dzień' : 'dni'}</Text>
                </View>

                <TouchableOpacity style={styles.daysButton} onPress={() => setDays(days + 1)}>
                  <Feather name="plus" size={16} color={colors.primary.gold} />
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={[styles.timePickerButton, isCritical && styles.timePickerButtonCritical]}
                onPress={() => setActiveAlertPicker(type)}
              >
                <Feather
                  name="clock"
                  size={17}
                  color={isCritical ? colors.status.error : colors.primary.gold}
                />

                <Text
                  style={[
                    styles.timePickerButtonText,
                    isCritical && {
                      color: colors.status.error,
                    },
                  ]}
                >
                  {String(Math.floor(remainingMinutes / 60)).padStart(2, '0')}:
                  {String(remainingMinutes % 60).padStart(2, '0')}
                </Text>
              </TouchableOpacity>
            </View>

            <Text
              style={[
                styles.alertSliderValue,
                isCritical && {
                  color: colors.status.error,
                },
              ]}
            >
              {minutesToLabel(value)} przed spotkaniem
            </Text>

            {activeAlertPicker === type && (
              <DateTimePicker
                value={pickerDate}
                mode="time"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                is24Hour
                minuteInterval={5}
                onChange={handleTimeChange}
                themeVariant="dark"
              />
            )}
          </View>
        )}
      </View>
    );
  };

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary.gold} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Spotkania</Text>
        <TouchableOpacity style={styles.addButton} onPress={() => setShowNewMeeting(true)}>
          <Feather name="plus" size={20} color={colors.background.primary} />
        </TouchableOpacity>
      </View>

      <FlatList
        data={[...upcomingMeetings, ...pastMeetings]}
        keyExtractor={(item) => item.id}
        renderItem={renderMeetingCard}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => fetchMeetings(true)}
            tintColor={colors.primary.gold}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Feather name="calendar" size={48} color={colors.text.tertiary} />
            <Text style={styles.emptyText}>Brak spotkań</Text>
            <Text style={styles.emptySubtext}>Dodaj nowe spotkanie przyciskiem +</Text>
          </View>
        }
        ListHeaderComponent={
          upcomingMeetings.length > 0 ? (
            <Text style={styles.sectionTitle}>Nadchodzące ({upcomingMeetings.length})</Text>
          ) : null
        }
      />

      {/* New Meeting Modal */}
      <Modal visible={showNewMeeting} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity
              onPress={() => {
                setShowNewMeeting(false);
                resetForm();
              }}
            >
              <Text style={styles.modalCancel}>Anuluj</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Nowe spotkanie</Text>
            <TouchableOpacity onPress={handleCreateMeeting}>
              <Text style={styles.modalSave}>Zapisz</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
            <Text style={styles.fieldLabel}>Tytuł *</Text>
            <TextInput
              style={styles.input}
              value={form.title}
              onChangeText={(t) => setForm((f) => ({ ...f, title: t }))}
              placeholder="Nazwa spotkania"
              placeholderTextColor={colors.text.tertiary}
            />

            <Text style={styles.fieldLabel}>Data i godzina rozpoczęcia *</Text>
            <TextInput
              style={styles.input}
              value={form.datetime_start}
              onChangeText={(t) => setForm((f) => ({ ...f, datetime_start: t }))}
              placeholder="YYYY-MM-DD HH:MM"
              placeholderTextColor={colors.text.tertiary}
            />

            <Text style={styles.fieldLabel}>Data i godzina zakończenia</Text>
            <TextInput
              style={styles.input}
              value={form.datetime_end}
              onChangeText={(t) => setForm((f) => ({ ...f, datetime_end: t }))}
              placeholder="YYYY-MM-DD HH:MM"
              placeholderTextColor={colors.text.tertiary}
            />

            <Text style={styles.fieldLabel}>Lokalizacja</Text>
            <TextInput
              style={styles.input}
              value={form.location_text}
              onChangeText={(t) => setForm((f) => ({ ...f, location_text: t }))}
              placeholder="Miejsce spotkania"
              placeholderTextColor={colors.text.tertiary}
            />

            <Text style={styles.fieldLabel}>Notatki</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={form.notes}
              onChangeText={(t) => setForm((f) => ({ ...f, notes: t }))}
              placeholder="Dodatkowe informacje..."
              placeholderTextColor={colors.text.tertiary}
              multiline
              numberOfLines={3}
            />

            {/* Alert sliders */}
            <View style={styles.alertsSection}>
              <Text style={styles.alertsSectionTitle}>Alerty (opcjonalne)</Text>

              <AlertTimePicker
                type="alert_1"
                label="Alert 1"
                enabled={form.alert_1_enabled}
                onToggle={(value) =>
                  setForm((current) => ({
                    ...current,
                    alert_1_enabled: value,
                  }))
                }
                value={form.alert_1_minutes}
                onValueChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    alert_1_minutes: value,
                  }))
                }
              />

              <AlertTimePicker
                type="alert_2"
                label="Alert 2"
                enabled={form.alert_2_enabled}
                onToggle={(value) =>
                  setForm((current) => ({
                    ...current,
                    alert_2_enabled: value,
                  }))
                }
                value={form.alert_2_minutes}
                onValueChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    alert_2_minutes: value,
                  }))
                }
              />

              <AlertTimePicker
                type="alert_critical"
                label="Alert krytyczny"
                enabled={form.alert_critical_enabled}
                onToggle={(value) =>
                  setForm((current) => ({
                    ...current,
                    alert_critical_enabled: value,
                  }))
                }
                value={form.alert_critical_minutes}
                onValueChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    alert_critical_minutes: value,
                  }))
                }
                isCritical
              />
            </View>

            <View style={{ height: 60 }} />
          </ScrollView>
        </View>
      </Modal>

      {/* Meeting Detail Modal */}
      <Modal visible={!!selectedMeeting} animationType="slide" presentationStyle="pageSheet">
        {selectedMeeting && (
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setSelectedMeeting(null)}>
                <Text style={styles.modalCancel}>Zamknij</Text>
              </TouchableOpacity>
              <Text style={styles.modalTitle}>Szczegóły</Text>
              <TouchableOpacity onPress={() => handleDeleteMeeting(selectedMeeting.id)}>
                <Feather name="trash-2" size={20} color={colors.status.error} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody}>
              <Text style={styles.detailTitle}>{selectedMeeting.title}</Text>

              <View style={styles.detailRow}>
                <Feather name="clock" size={16} color={colors.primary.gold} />
                <Text style={styles.detailText}>
                  {formatDate(selectedMeeting.datetime_start)} •{' '}
                  {formatTime(selectedMeeting.datetime_start)}
                  {selectedMeeting.datetime_end && ` – ${formatTime(selectedMeeting.datetime_end)}`}
                </Text>
              </View>

              {selectedMeeting.location_text && (
                <View style={styles.detailRow}>
                  <Feather name="map-pin" size={16} color={colors.primary.gold} />
                  <Text style={styles.detailText}>{selectedMeeting.location_text}</Text>
                </View>
              )}

              {selectedMeeting.notes && (
                <View style={styles.detailNotesSection}>
                  <Text style={styles.detailSectionLabel}>Notatki</Text>
                  <Text style={styles.detailNotes}>{selectedMeeting.notes}</Text>
                </View>
              )}

              <View style={styles.detailAlertsSection}>
                <Text style={styles.detailSectionLabel}>Alerty</Text>
                {selectedMeeting.alert_1_minutes ? (
                  <View style={styles.alertRow}>
                    <Feather name="bell" size={14} color={colors.text.secondary} />
                    <Text style={styles.alertRowText}>
                      Alert 1: {minutesToLabel(selectedMeeting.alert_1_minutes)} przed
                    </Text>
                  </View>
                ) : null}
                {selectedMeeting.alert_2_minutes ? (
                  <View style={styles.alertRow}>
                    <Feather name="bell" size={14} color={colors.text.secondary} />
                    <Text style={styles.alertRowText}>
                      Alert 2: {minutesToLabel(selectedMeeting.alert_2_minutes)} przed
                    </Text>
                  </View>
                ) : null}
                {selectedMeeting.alert_critical_minutes ? (
                  <View style={styles.alertRow}>
                    <Feather name="alert-triangle" size={14} color={colors.status.error} />
                    <Text style={[styles.alertRowText, { color: colors.status.error }]}>
                      Krytyczny: {minutesToLabel(selectedMeeting.alert_critical_minutes)} przed
                    </Text>
                  </View>
                ) : null}
                {!selectedMeeting.alert_1_minutes &&
                  !selectedMeeting.alert_2_minutes &&
                  !selectedMeeting.alert_critical_minutes && (
                    <Text style={styles.alertRowText}>Brak alertów</Text>
                  )}
              </View>
            </ScrollView>
          </View>
        )}
      </Modal>
    </View>
  );
}

// --- Styles ---

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },

  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background.primary,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: Platform.OS === 'ios' ? 56 : spacing.lg,
    paddingBottom: spacing.md,
    backgroundColor: colors.background.primary,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
  },

  headerTitle: {
    fontSize: typography.fontSizes.xl,
    fontWeight: typography.fontWeights.bold as any,
    color: colors.text.primary,
  },

  addButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary.gold,
    justifyContent: 'center',
    alignItems: 'center',
  },

  list: {
    padding: spacing.md,
    paddingBottom: 100,
  },

  sectionTitle: {
    fontSize: typography.fontSizes.xs,
    fontWeight: typography.fontWeights.medium as any,
    color: colors.primary.gold,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: spacing.sm,
    paddingVertical: spacing.xs,
  },

  meetingCard: {
    flexDirection: 'row',
    backgroundColor: colors.background.secondary,
    borderRadius: 12,
    marginBottom: spacing.sm,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border.default,
  },

  meetingCardPast: {
    opacity: 0.5,
  },

  meetingStripe: {
    width: 4,
  },

  meetingContent: {
    flex: 1,
    padding: spacing.md,
  },

  meetingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },

  meetingTitle: {
    fontSize: typography.fontSizes.md,
    fontWeight: typography.fontWeights.semibold as any,
    color: colors.text.primary,
    flex: 1,
    marginRight: spacing.sm,
  },

  textPast: {
    color: colors.text.tertiary,
  },

  meetingMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },

  meetingMetaText: {
    fontSize: typography.fontSizes.xs,
    color: colors.text.tertiary,
  },

  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
    gap: spacing.sm,
  },

  emptyText: {
    fontSize: typography.fontSizes.md,
    color: colors.text.secondary,
    marginTop: spacing.sm,
  },

  emptySubtext: {
    fontSize: typography.fontSizes.xs,
    color: colors.text.tertiary,
  },

  modalContainer: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },

  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: Platform.OS === 'ios' ? 56 : spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
  },

  modalTitle: {
    fontSize: typography.fontSizes.md,
    fontWeight: typography.fontWeights.semibold as any,
    color: colors.text.primary,
  },

  modalCancel: {
    fontSize: typography.fontSizes.md,
    color: colors.text.secondary,
  },

  modalSave: {
    fontSize: typography.fontSizes.md,
    fontWeight: typography.fontWeights.semibold as any,
    color: colors.primary.gold,
  },

  modalBody: {
    flex: 1,
    padding: spacing.lg,
  },

  fieldLabel: {
    fontSize: typography.fontSizes.xs,
    color: colors.text.secondary,
    marginBottom: 6,
    marginTop: spacing.md,
  },

  input: {
    backgroundColor: colors.background.secondary,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: 10,
    padding: spacing.md,
    color: colors.text.primary,
    fontSize: typography.fontSizes.md,
  },

  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },

  alertsSection: {
    marginTop: spacing.xl,
    padding: spacing.md,
    backgroundColor: colors.background.secondary,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border.default,
  },

  alertsSectionTitle: {
    fontSize: typography.fontSizes.md,
    fontWeight: typography.fontWeights.semibold as any,
    color: colors.primary.gold,
    marginBottom: spacing.md,
  },

  alertSliderHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  alertSliderLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },

  alertSliderLabel: {
    fontSize: typography.fontSizes.md,
    fontWeight: typography.fontWeights.medium as any,
    color: colors.text.secondary,
  },

  alertSliderValue: {
    fontSize: typography.fontSizes.xs,
    fontWeight: typography.fontWeights.semibold as any,
    color: colors.primary.gold,
    textAlign: 'center',
    marginTop: spacing.sm,
  },

  detailTitle: {
    fontSize: typography.fontSizes.xl,
    fontWeight: typography.fontWeights.bold as any,
    color: colors.text.primary,
    marginBottom: spacing.lg,
  },

  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: spacing.md,
  },

  detailText: {
    flex: 1,
    fontSize: typography.fontSizes.md,
    color: colors.text.secondary,
  },

  detailNotesSection: {
    marginTop: spacing.lg,
    padding: spacing.md,
    backgroundColor: colors.background.secondary,
    borderRadius: 10,
  },

  detailSectionLabel: {
    fontSize: typography.fontSizes.xs,
    color: colors.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },

  detailNotes: {
    fontSize: typography.fontSizes.md,
    color: colors.text.secondary,
    lineHeight: 22,
  },

  detailAlertsSection: {
    marginTop: spacing.lg,
    padding: spacing.md,
    backgroundColor: colors.background.secondary,
    borderRadius: 10,
  },

  alertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },

  alertRowText: {
    fontSize: typography.fontSizes.md,
    color: colors.text.secondary,
  },

  alertPickerBlock: {
    marginBottom: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
  },

  alertPickerBody: {
    marginTop: spacing.md,
  },

  alertPickerDescription: {
    fontSize: typography.fontSizes.xs,
    color: colors.text.tertiary,
    marginBottom: spacing.sm,
  },

  alertTimeControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },

  daysControl: {
    flex: 1,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border.default,
    backgroundColor: colors.background.primary,
    paddingHorizontal: spacing.xs,
  },

  daysButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },

  daysValue: {
    alignItems: 'center',
    justifyContent: 'center',
  },

  daysValueNumber: {
    fontSize: 16,
    fontWeight: typography.fontWeights.semibold as any,
    color: colors.text.primary,
  },

  daysValueLabel: {
    fontSize: 10,
    color: colors.text.tertiary,
  },

  timePickerButton: {
    minWidth: 108,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: `${colors.primary.gold}55`,
    backgroundColor: `${colors.primary.gold}10`,
    paddingHorizontal: spacing.md,
  },

  timePickerButtonCritical: {
    borderColor: `${colors.status.error}55`,
    backgroundColor: `${colors.status.error}10`,
  },

  timePickerButtonText: {
    fontSize: 16,
    fontWeight: typography.fontWeights.semibold as any,
    color: colors.primary.gold,
    fontVariant: ['tabular-nums'],
  },
});
