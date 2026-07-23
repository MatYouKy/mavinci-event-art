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
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, typography } from '../theme';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import * as Notifications from 'expo-notifications';

// --- Types ---

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
  participants?: { employee_id: string; employee_name?: string }[];
}

interface NewMeetingForm {
  title: string;
  location_text: string;
  datetime_start: string;
  datetime_end: string;
  notes: string;
  alert_1_minutes: number;
  alert_2_minutes: number;
  alert_critical_minutes: number;
}

// --- Alert presets ---

const ALERT_PRESETS = [
  { label: 'Brak', value: 0 },
  { label: '15 min przed', value: 15 },
  { label: '30 min przed', value: 30 },
  { label: '1 godz. przed', value: 60 },
  { label: '2 godz. przed', value: 120 },
  { label: '1 dzień przed', value: 1440 },
  { label: '2 dni przed', value: 2880 },
];

// --- Notification setup ---

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

async function scheduleMeetingAlerts(meeting: Meeting) {
  // Cancel existing alerts for this meeting
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const notif of scheduled) {
    if (notif.content.data?.meetingId === meeting.id) {
      await Notifications.cancelScheduledNotificationAsync(notif.identifier);
    }
  }

  const meetingTime = new Date(meeting.datetime_start).getTime();
  const now = Date.now();

  const alerts = [
    { minutes: meeting.alert_1_minutes, type: 'Przypomnienie', sound: true, priority: 'default' as const },
    { minutes: meeting.alert_2_minutes, type: 'Przypomnienie', sound: true, priority: 'high' as const },
    { minutes: meeting.alert_critical_minutes, type: 'PILNE', sound: true, priority: 'max' as const },
  ];

  for (const alert of alerts) {
    if (!alert.minutes || alert.minutes <= 0) continue;

    const triggerTime = meetingTime - alert.minutes * 60 * 1000;
    if (triggerTime <= now) continue;

    const secondsUntilTrigger = Math.floor((triggerTime - now) / 1000);

    await Notifications.scheduleNotificationAsync({
      content: {
        title: `${alert.type}: ${meeting.title}`,
        body: alert.minutes >= 1440
          ? `Spotkanie za ${Math.round(alert.minutes / 1440)} dni`
          : alert.minutes >= 60
            ? `Spotkanie za ${Math.round(alert.minutes / 60)} godz.`
            : `Spotkanie za ${alert.minutes} min!`,
        sound: true,
        priority: alert.priority === 'max'
          ? Notifications.AndroidNotificationPriority.MAX
          : alert.priority === 'high'
            ? Notifications.AndroidNotificationPriority.HIGH
            : Notifications.AndroidNotificationPriority.DEFAULT,
        data: { meetingId: meeting.id, alertType: alert.type },
      },
      trigger: { seconds: secondsUntilTrigger },
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
    alert_1_minutes: 1440,
    alert_2_minutes: 120,
    alert_critical_minutes: 30,
  });

  useEffect(() => {
    requestNotificationPermissions();
  }, []);

  const fetchMeetings = useCallback(async (isRefresh = false) => {
    if (!employee) return;
    if (isRefresh) setRefreshing(true);
    else setIsLoading(true);

    try {
      const { data, error } = await supabase
        .from('meetings')
        .select(`
          *,
          meeting_participants(employee_id)
        `)
        .is('deleted_at', null)
        .order('datetime_start', { ascending: true });

      if (!error && data) {
        // Filter meetings where current employee is participant or creator
        const myMeetings = data.filter((m: any) =>
          m.created_by === employee.id ||
          m.meeting_participants?.some((p: any) => p.employee_id === employee.id)
        );
        setMeetings(myMeetings);

        // Schedule alerts for upcoming meetings
        for (const meeting of myMeetings) {
          const meetingTime = new Date(meeting.datetime_start).getTime();
          if (meetingTime > Date.now()) {
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
  }, [employee]);

  useEffect(() => {
    fetchMeetings();
  }, [fetchMeetings]);

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
          alert_1_minutes: form.alert_1_minutes || null,
          alert_2_minutes: form.alert_2_minutes || null,
          alert_critical_minutes: form.alert_critical_minutes || null,
        })
        .select()
        .single();

      if (error) throw error;

      // Add creator as participant
      if (data) {
        await supabase.from('meeting_participants').insert({
          meeting_id: data.id,
          employee_id: employee.id,
        });

        // Schedule notifications
        scheduleMeetingAlerts(data);
      }

      setShowNewMeeting(false);
      setForm({
        title: '',
        location_text: '',
        datetime_start: '',
        datetime_end: '',
        notes: '',
        alert_1_minutes: 1440,
        alert_2_minutes: 120,
        alert_critical_minutes: 30,
      });
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

          // Cancel scheduled notifications
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

  const getAlertLabel = (minutes: number | null) => {
    if (!minutes || minutes <= 0) return 'Brak';
    const preset = ALERT_PRESETS.find((p) => p.value === minutes);
    return preset ? preset.label : `${minutes} min przed`;
  };

  const isUpcoming = (dateStr: string) => new Date(dateStr).getTime() > Date.now();

  const upcomingMeetings = meetings.filter((m) => isUpcoming(m.datetime_start));
  const pastMeetings = meetings.filter((m) => !isUpcoming(m.datetime_start));

  const renderMeetingCard = ({ item }: { item: Meeting }) => {
    const upcoming = isUpcoming(item.datetime_start);

    return (
      <TouchableOpacity
        style={[styles.meetingCard, !upcoming && styles.meetingCardPast]}
        activeOpacity={0.7}
        onPress={() => setSelectedMeeting(item)}
      >
        <View style={[styles.meetingStripe, { backgroundColor: item.color || colors.primary.gold }]} />
        <View style={styles.meetingContent}>
          <View style={styles.meetingHeader}>
            <Text style={[styles.meetingTitle, !upcoming && styles.textPast]} numberOfLines={1}>
              {item.title}
            </Text>
            {item.alert_critical_minutes && item.alert_critical_minutes > 0 && upcoming && (
              <Feather name="bell" size={14} color={colors.primary.gold} />
            )}
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
              <Text style={styles.meetingMetaText} numberOfLines={1}>{item.location_text}</Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
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
        <TouchableOpacity
          style={styles.addButton}
          onPress={() => setShowNewMeeting(true)}
        >
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
        stickyHeaderIndices={upcomingMeetings.length > 0 ? [0] : undefined}
      />

      {/* New Meeting Modal */}
      <Modal visible={showNewMeeting} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowNewMeeting(false)}>
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

            {/* Alert settings */}
            <View style={styles.alertsSection}>
              <Text style={styles.alertsSectionTitle}>
                <Feather name="bell" size={16} color={colors.primary.gold} /> Alerty
              </Text>

              <Text style={styles.fieldLabel}>Alert 1 (przypomnienie)</Text>
              <View style={styles.alertPresets}>
                {ALERT_PRESETS.map((preset) => (
                  <TouchableOpacity
                    key={`a1-${preset.value}`}
                    style={[
                      styles.alertPresetChip,
                      form.alert_1_minutes === preset.value && styles.alertPresetChipActive,
                    ]}
                    onPress={() => setForm((f) => ({ ...f, alert_1_minutes: preset.value }))}
                  >
                    <Text
                      style={[
                        styles.alertPresetText,
                        form.alert_1_minutes === preset.value && styles.alertPresetTextActive,
                      ]}
                    >
                      {preset.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.fieldLabel}>Alert 2 (przypomnienie)</Text>
              <View style={styles.alertPresets}>
                {ALERT_PRESETS.map((preset) => (
                  <TouchableOpacity
                    key={`a2-${preset.value}`}
                    style={[
                      styles.alertPresetChip,
                      form.alert_2_minutes === preset.value && styles.alertPresetChipActive,
                    ]}
                    onPress={() => setForm((f) => ({ ...f, alert_2_minutes: preset.value }))}
                  >
                    <Text
                      style={[
                        styles.alertPresetText,
                        form.alert_2_minutes === preset.value && styles.alertPresetTextActive,
                      ]}
                    >
                      {preset.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.fieldLabel}>Alert krytyczny (z dźwiękiem)</Text>
              <View style={styles.alertPresets}>
                {ALERT_PRESETS.map((preset) => (
                  <TouchableOpacity
                    key={`ac-${preset.value}`}
                    style={[
                      styles.alertPresetChip,
                      styles.alertPresetChipCritical,
                      form.alert_critical_minutes === preset.value && styles.alertPresetChipCriticalActive,
                    ]}
                    onPress={() => setForm((f) => ({ ...f, alert_critical_minutes: preset.value }))}
                  >
                    <Text
                      style={[
                        styles.alertPresetText,
                        form.alert_critical_minutes === preset.value && styles.alertPresetTextCriticalActive,
                      ]}
                    >
                      {preset.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
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
                  {formatDate(selectedMeeting.datetime_start)} • {formatTime(selectedMeeting.datetime_start)}
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
                <Text style={styles.detailSectionLabel}>Alerty przypominające</Text>
                <View style={styles.alertRow}>
                  <Feather name="bell" size={14} color={colors.text.secondary} />
                  <Text style={styles.alertRowText}>
                    Alert 1: {getAlertLabel(selectedMeeting.alert_1_minutes)}
                  </Text>
                </View>
                <View style={styles.alertRow}>
                  <Feather name="bell" size={14} color={colors.text.secondary} />
                  <Text style={styles.alertRowText}>
                    Alert 2: {getAlertLabel(selectedMeeting.alert_2_minutes)}
                  </Text>
                </View>
                <View style={styles.alertRow}>
                  <Feather name="alert-triangle" size={14} color={colors.status.error} />
                  <Text style={[styles.alertRowText, { color: colors.status.error }]}>
                    Krytyczny: {getAlertLabel(selectedMeeting.alert_critical_minutes)}
                  </Text>
                </View>
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
    borderBottomColor: colors.border.primary,
  },
  headerTitle: {
    ...typography.h2,
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
    ...typography.caption,
    color: colors.primary.gold,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: spacing.sm,
    backgroundColor: colors.background.primary,
    paddingVertical: spacing.xs,
  },
  meetingCard: {
    flexDirection: 'row',
    backgroundColor: colors.background.secondary,
    borderRadius: 12,
    marginBottom: spacing.sm,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border.primary,
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
    ...typography.body,
    color: colors.text.primary,
    fontWeight: '600',
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
    ...typography.caption,
    color: colors.text.tertiary,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
    gap: spacing.sm,
  },
  emptyText: {
    ...typography.body,
    color: colors.text.secondary,
    marginTop: spacing.sm,
  },
  emptySubtext: {
    ...typography.caption,
    color: colors.text.tertiary,
  },
  // Modal
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
    borderBottomColor: colors.border.primary,
  },
  modalTitle: {
    ...typography.body,
    color: colors.text.primary,
    fontWeight: '600',
  },
  modalCancel: {
    ...typography.body,
    color: colors.text.secondary,
  },
  modalSave: {
    ...typography.body,
    color: colors.primary.gold,
    fontWeight: '600',
  },
  modalBody: {
    flex: 1,
    padding: spacing.lg,
  },
  fieldLabel: {
    ...typography.caption,
    color: colors.text.secondary,
    marginBottom: 6,
    marginTop: spacing.md,
  },
  input: {
    backgroundColor: colors.background.secondary,
    borderWidth: 1,
    borderColor: colors.border.primary,
    borderRadius: 10,
    padding: spacing.md,
    color: colors.text.primary,
    ...typography.body,
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  // Alerts section
  alertsSection: {
    marginTop: spacing.xl,
    padding: spacing.md,
    backgroundColor: colors.background.secondary,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border.primary,
  },
  alertsSectionTitle: {
    ...typography.body,
    color: colors.primary.gold,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  alertPresets: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: spacing.sm,
  },
  alertPresetChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: colors.background.primary,
    borderWidth: 1,
    borderColor: colors.border.primary,
  },
  alertPresetChipActive: {
    backgroundColor: colors.primary.gold + '22',
    borderColor: colors.primary.gold,
  },
  alertPresetChipCritical: {
    borderColor: colors.border.primary,
  },
  alertPresetChipCriticalActive: {
    backgroundColor: colors.status.error + '22',
    borderColor: colors.status.error,
  },
  alertPresetText: {
    ...typography.caption,
    color: colors.text.secondary,
  },
  alertPresetTextActive: {
    color: colors.primary.gold,
    fontWeight: '600',
  },
  alertPresetTextCriticalActive: {
    color: colors.status.error,
    fontWeight: '600',
  },
  // Detail modal
  detailTitle: {
    ...typography.h2,
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
    ...typography.body,
    color: colors.text.secondary,
    flex: 1,
  },
  detailNotesSection: {
    marginTop: spacing.lg,
    padding: spacing.md,
    backgroundColor: colors.background.secondary,
    borderRadius: 10,
  },
  detailSectionLabel: {
    ...typography.caption,
    color: colors.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  detailNotes: {
    ...typography.body,
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
    ...typography.body,
    color: colors.text.secondary,
  },
});
