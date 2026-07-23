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
import Slider from '@react-native-community/slider';
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

// --- Notification setup ---

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

async function scheduleMeetingAlerts(meeting: Meeting) {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const notif of scheduled) {
    if (notif.content.data?.meetingId === meeting.id) {
      await Notifications.cancelScheduledNotificationAsync(notif.identifier);
    }
  }

  const meetingTime = new Date(meeting.datetime_start).getTime();
  const now = Date.now();

  const alerts = [
    { minutes: meeting.alert_1_minutes, label: 'Przypomnienie', priority: Notifications.AndroidNotificationPriority.DEFAULT },
    { minutes: meeting.alert_2_minutes, label: 'Przypomnienie', priority: Notifications.AndroidNotificationPriority.HIGH },
    { minutes: meeting.alert_critical_minutes, label: 'PILNE', priority: Notifications.AndroidNotificationPriority.MAX },
  ];

  for (const alert of alerts) {
    if (!alert.minutes || alert.minutes <= 0) continue;

    const triggerTime = meetingTime - alert.minutes * 60 * 1000;
    if (triggerTime <= now) continue;

    const secondsUntilTrigger = Math.floor((triggerTime - now) / 1000);

    await Notifications.scheduleNotificationAsync({
      content: {
        title: `${alert.label}: ${meeting.title}`,
        body: `Spotkanie za ${minutesToLabel(alert.minutes)}`,
        sound: true,
        priority: alert.priority,
        data: { meetingId: meeting.id },
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
    alert_1_enabled: true,
    alert_1_minutes: 1440,
    alert_2_enabled: true,
    alert_2_minutes: 120,
    alert_critical_enabled: true,
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
        const myMeetings = data.filter((m: any) =>
          m.created_by === employee.id ||
          m.meeting_participants?.some((p: any) => p.employee_id === employee.id)
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
  }, [employee]);

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
      alert_critical_minutes: 30,
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
    const hasAlerts = !!(item.alert_1_minutes || item.alert_2_minutes || item.alert_critical_minutes);

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
            {hasAlerts && upcoming && (
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

  // --- Alert Slider Component ---
  const AlertSlider = ({
    label,
    enabled,
    onToggle,
    value,
    onValueChange,
    isCritical,
  }: {
    label: string;
    enabled: boolean;
    onToggle: (val: boolean) => void;
    value: number;
    onValueChange: (val: number) => void;
    isCritical?: boolean;
  }) => (
    <View style={styles.alertSliderBlock}>
      <View style={styles.alertSliderHeader}>
        <View style={styles.alertSliderLabelRow}>
          <Feather
            name={isCritical ? 'alert-triangle' : 'bell'}
            size={14}
            color={isCritical ? colors.status.error : colors.text.secondary}
          />
          <Text style={[styles.alertSliderLabel, isCritical && { color: colors.status.error }]}>
            {label}
          </Text>
        </View>
        <Switch
          value={enabled}
          onValueChange={onToggle}
          trackColor={{ false: colors.background.primary, true: isCritical ? colors.status.error + '55' : colors.primary.gold + '55' }}
          thumbColor={enabled ? (isCritical ? colors.status.error : colors.primary.gold) : colors.text.tertiary}
        />
      </View>
      {enabled && (
        <View style={styles.alertSliderBody}>
          <Slider
            style={styles.slider}
            minimumValue={SLIDER_MIN}
            maximumValue={SLIDER_MAX}
            step={SLIDER_STEP}
            value={value}
            onValueChange={onValueChange}
            minimumTrackTintColor={isCritical ? colors.status.error : colors.primary.gold}
            maximumTrackTintColor={colors.background.primary}
            thumbTintColor={isCritical ? colors.status.error : colors.primary.gold}
          />
          <Text style={[styles.alertSliderValue, isCritical && { color: colors.status.error }]}>
            {minutesToLabel(value)} przed
          </Text>
        </View>
      )}
    </View>
  );

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
            <TouchableOpacity onPress={() => { setShowNewMeeting(false); resetForm(); }}>
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

              <AlertSlider
                label="Alert 1"
                enabled={form.alert_1_enabled}
                onToggle={(v) => setForm((f) => ({ ...f, alert_1_enabled: v }))}
                value={form.alert_1_minutes}
                onValueChange={(v) => setForm((f) => ({ ...f, alert_1_minutes: v }))}
              />

              <AlertSlider
                label="Alert 2"
                enabled={form.alert_2_enabled}
                onToggle={(v) => setForm((f) => ({ ...f, alert_2_enabled: v }))}
                value={form.alert_2_minutes}
                onValueChange={(v) => setForm((f) => ({ ...f, alert_2_minutes: v }))}
              />

              <AlertSlider
                label="Alert krytyczny"
                enabled={form.alert_critical_enabled}
                onToggle={(v) => setForm((f) => ({ ...f, alert_critical_enabled: v }))}
                value={form.alert_critical_minutes}
                onValueChange={(v) => setForm((f) => ({ ...f, alert_critical_minutes: v }))}
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
                {!selectedMeeting.alert_1_minutes && !selectedMeeting.alert_2_minutes && !selectedMeeting.alert_critical_minutes && (
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
    marginBottom: spacing.md,
  },
  alertSliderBlock: {
    marginBottom: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.primary,
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
    ...typography.body,
    color: colors.text.secondary,
    fontWeight: '500',
  },
  alertSliderBody: {
    marginTop: spacing.sm,
  },
  slider: {
    width: '100%',
    height: 40,
  },
  alertSliderValue: {
    ...typography.caption,
    color: colors.primary.gold,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: -4,
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
