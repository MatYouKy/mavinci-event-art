import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  Keyboard,
  KeyboardAvoidingView,
} from 'react-native';
import SwipeableRow from '../components/SwipeableRow';

import * as Notifications from 'expo-notifications';

import { Feather } from '@expo/vector-icons';
import { colors, spacing, typography } from '../theme';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { SearchableDropdown } from '../components/SearchableDropdown';
import DateTimePicker from '@react-native-community/datetimepicker';

// --- Types ---
type MeetingPickerType = 'startDate' | 'startTime' | 'endDate' | 'endTime';
interface Employee {
  id: string;
  name: string;
  surname: string;
}

interface Location {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
}

interface Meeting {
  id: string;
  title: string;
  location_text: string | null;
  datetime_start: string | null;
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
  color: string;
  location_text: string;
  datetime_start: Date;
  datetime_end: Date;
  notes: string;
  alert_1_enabled: boolean;
  alert_1_minutes: number;
  alert_2_enabled: boolean;
  alert_2_minutes: number;
  alert_critical_enabled: boolean;
  alert_critical_minutes: number;
}

// --- Helpers ---

const DEFAULT_MEETING_COLOR = '#d3bb73';

const MEETING_COLORS = [
  { value: '#d3bb73', label: 'Złoty' },
  { value: '#3b82f6', label: 'Niebieski' },
  { value: '#22c55e', label: 'Zielony' },
  { value: '#a855f7', label: 'Fioletowy' },
  { value: '#ec4899', label: 'Różowy' },
  { value: '#f97316', label: 'Pomarańczowy' },
  { value: '#ef4444', label: 'Czerwony' },
  { value: '#64748b', label: 'Szary' },
];

const ALERT_OPTIONS = [
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 60, label: '1 godz.' },
  { value: 120, label: '2 godz.' },
  { value: 360, label: '6 godz.' },
  { value: 720, label: '12 godz.' },
  { value: 1440, label: '1 dzień' },
  { value: 2880, label: '2 dni' },
  { value: 4320, label: '3 dni' },
  { value: 10080, label: '7 dni' },
];

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

// Notification handler is set globally in App.tsx - do not duplicate here

async function scheduleMeetingAlerts(meeting: Meeting) {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();

  for (const notification of scheduled) {
    if (notification.content.data?.meetingId === meeting.id) {
      await Notifications.cancelScheduledNotificationAsync(notification.identifier);
    }
  }

  const meetingTime = new Date(meeting.datetime_start || '').getTime();
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

    const triggerTime = meetingTime - alert.minutes * 60 * 1000;

    if (triggerTime <= now) continue;

    const secondsUntilTrigger = Math.max(1, Math.floor((triggerTime - now) / 1000));

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
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
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

interface MeetingsScreenProps {
  initialMeetingId?: string | null;
  onBack?: () => void;
}

export default function MeetingsScreen({ initialMeetingId, onBack }: MeetingsScreenProps) {
  const { employee } = useAuth();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isSavingMeeting, setIsSavingMeeting] = useState(false);
  const [showNewMeeting, setShowNewMeeting] = useState(false);
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);
  const [editingMeeting, setEditingMeeting] = useState<Meeting | null>(null);

  const createInitialForm = (): NewMeetingForm => {
    const start = new Date();

    start.setSeconds(0, 0);

    const roundedMinutes = Math.ceil(start.getMinutes() / 5) * 5;

    if (roundedMinutes >= 60) {
      start.setHours(start.getHours() + 1, 0, 0, 0);
    } else {
      start.setMinutes(roundedMinutes, 0, 0);
    }

    return {
      title: '',
      color: DEFAULT_MEETING_COLOR,
      location_text: '',
      datetime_start: start,
      datetime_end: new Date(start.getTime() + 60 * 60 * 1000),
      notes: '',
      alert_1_enabled: true,
      alert_1_minutes: 1440,
      alert_2_enabled: true,
      alert_2_minutes: 120,
      alert_critical_enabled: true,
      alert_critical_minutes: 15,
    };
  };

  const [locations, setLocations] = useState<Location[]>([]);
  const [locationSearch, setLocationSearch] = useState('');
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);

  const [form, setForm] = useState<NewMeetingForm>(createInitialForm);
  const [selectedParticipants, setSelectedParticipants] = useState<Employee[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [participantSearch, setParticipantSearch] = useState('');
  const [openedDropdown, setOpenedDropdown] = useState<string | null>(null);

  const [activeMeetingPicker, setActiveMeetingPicker] = useState<MeetingPickerType | null>(null);

  const meetingFormScrollRef = useRef<ScrollView>(null);
  const savingMeetingRef = useRef(false);

  const handleFormInputFocus = () => {
    setActiveMeetingPicker(null);
  };

  const openMeetingPicker = (picker: MeetingPickerType) => {
    Keyboard.dismiss();
    setOpenedDropdown(null);
    setActiveMeetingPicker(picker);

    requestAnimationFrame(() => {
      meetingFormScrollRef.current?.scrollTo({ y: 110, animated: true });
    });
  };

  useEffect(() => {
    requestNotificationPermissions();
  }, []);

  useEffect(() => {
    const fetchFormData = async () => {
      const [employeesRes, locationsRes] = await Promise.all([
        supabase
          .from('employees')
          .select('id, name, surname')
          .eq('is_active', true)
          .order('surname'),

        supabase.from('locations').select('id, name, address, city').order('name'),
      ]);

      if (employeesRes.error) {
        console.error('Błąd pobierania pracowników:', employeesRes.error);
      } else {
        setEmployees((employeesRes.data as Employee[]) || []);
      }

      if (locationsRes.error) {
        console.error('Błąd pobierania lokalizacji:', locationsRes.error);
      } else {
        setLocations((locationsRes.data as Location[]) || []);
      }
    };

    fetchFormData();
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
        if (error) {
          console.error('Błąd pobierania spotkań:', error);
          return;
        }

        if (data) {
          const normalizedMeetings: Meeting[] = data.map((meeting: any) => ({
            ...meeting,
            participants: meeting.meeting_participants || [],
          }));

          const myMeetings = normalizedMeetings.filter(
            (meeting) =>
              meeting.created_by === employee.id ||
              meeting.participants?.some((participant) => participant.employee_id === employee.id),
          );

          setMeetings(myMeetings);

          for (const meeting of myMeetings) {
            if (meeting.datetime_start && new Date(meeting.datetime_start).getTime() > Date.now()) {
              await scheduleMeetingAlerts(meeting);
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

  useEffect(() => {
    if (!initialMeetingId || meetings.length === 0) return;

    const meeting = meetings.find((item) => item.id === initialMeetingId);

    if (meeting) {
      setSelectedMeeting(meeting);
    }
  }, [initialMeetingId, meetings]);

  const resetForm = () => {
    setForm(createInitialForm());
    setSelectedParticipants([]);
    setParticipantSearch('');
    setOpenedDropdown(null);
    setActiveMeetingPicker(null);
    setSelectedLocation(null);
    setLocationSearch('');
  };
  const openEditMeeting = (meeting: Meeting) => {
    const start = meeting.datetime_start ? new Date(meeting.datetime_start) : new Date();

    const matchedLocation =
      locations.find((location) => {
        const label = [location.name, location.city].filter(Boolean).join(', ');
        return label === meeting.location_text || location.name === meeting.location_text;
      }) ?? null;

    setSelectedLocation(matchedLocation);
    setLocationSearch(matchedLocation ? '' : meeting.location_text || '');

    const end = meeting.datetime_end
      ? new Date(meeting.datetime_end)
      : new Date(start.getTime() + 60 * 60 * 1000);

    setForm({
      title: meeting.title || '',
      color: meeting.color || DEFAULT_MEETING_COLOR,
      location_text: matchedLocation?.name || meeting.location_text || '',
      datetime_start: start,
      datetime_end: end,
      notes: meeting.notes || '',
      alert_1_enabled: meeting.alert_1_minutes !== null,
      alert_1_minutes: meeting.alert_1_minutes ?? 1440,
      alert_2_enabled: meeting.alert_2_minutes !== null,
      alert_2_minutes: meeting.alert_2_minutes ?? 120,
      alert_critical_enabled: meeting.alert_critical_minutes !== null,
      alert_critical_minutes: meeting.alert_critical_minutes ?? 15,
    });

    setEditingMeeting(meeting);
    setSelectedMeeting(null);
    setShowNewMeeting(true);
    setActiveMeetingPicker(null);

    // Load participants for this meeting
    const participantIds = (meeting.participants || []).map((p) => p.employee_id);
    const matched = employees.filter((e) => participantIds.includes(e.id));
    setSelectedParticipants(matched);
    setParticipantSearch('');
    setOpenedDropdown(null);
  };

  const handleSaveMeeting = async () => {
    if (savingMeetingRef.current) return;

    if (!employee || !form.title.trim()) {
      Alert.alert('Błąd', 'Podaj tytuł spotkania');
      return;
    }

    if (!form.datetime_start) {
      Alert.alert('Błąd', 'Podaj datę i godzinę rozpoczęcia');
      return;
    }

    if (!form.datetime_end) {
      Alert.alert('Błąd', 'Podaj datę i godzinę zakończenia');
      return;
    }

    if (form.datetime_end.getTime() <= form.datetime_start.getTime()) {
      Alert.alert(
        'Nieprawidłowy termin',
        'Godzina zakończenia musi być późniejsza niż rozpoczęcie.',
      );
      return;
    }

    savingMeetingRef.current = true;
    setIsSavingMeeting(true);

    const payload = {
      title: form.title.trim(),
      color: form.color,
      location_text: form.location_text.trim() || null,
      datetime_start: form.datetime_start.toISOString(),
      datetime_end: form.datetime_end.toISOString(),
      notes: form.notes.trim() || null,
      alert_1_minutes: form.alert_1_enabled ? form.alert_1_minutes : null,
      alert_2_minutes: form.alert_2_enabled ? form.alert_2_minutes : null,
      alert_critical_minutes: form.alert_critical_enabled ? form.alert_critical_minutes : null,
    };

    try {
      if (editingMeeting) {
        const { data, error } = await supabase
          .from('meetings')
          .update(payload)
          .eq('id', editingMeeting.id)
          .select()
          .single();

        if (error) throw error;

        if (data) {
          // Update participants: delete existing and re-insert
          await supabase.from('meeting_participants').delete().eq('meeting_id', editingMeeting.id);
          const participantsToInsert = selectedParticipants.map((p) => ({
            meeting_id: editingMeeting.id,
            employee_id: p.id,
          }));
          if (!selectedParticipants.some((p) => p.id === employee.id)) {
            participantsToInsert.push({ meeting_id: editingMeeting.id, employee_id: employee.id });
          }
          if (participantsToInsert.length > 0) {
            await supabase.from('meeting_participants').insert(participantsToInsert);
          }
          await scheduleMeetingAlerts(data as Meeting);
        }
      } else {
        const { data, error } = await supabase
          .from('meetings')
          .insert({
            ...payload,
            created_by: employee.id,
          })
          .select()
          .single();

        if (error) throw error;

        if (data) {
          const participantsToInsert = selectedParticipants.map((p) => ({
            meeting_id: data.id,
            employee_id: p.id,
          }));
          // Always include creator
          if (!selectedParticipants.some((p) => p.id === employee.id)) {
            participantsToInsert.push({ meeting_id: data.id, employee_id: employee.id });
          }
          const { error: participantError } = await supabase
            .from('meeting_participants')
            .insert(participantsToInsert);

          if (participantError) throw participantError;

          await scheduleMeetingAlerts(data as Meeting);

        }
      }

      setShowNewMeeting(false);
      setEditingMeeting(null);
      resetForm();
      await fetchMeetings();
    } catch (err: any) {
      Alert.alert(
        'Błąd',
        err.message ||
          (editingMeeting ? 'Nie udało się zapisać zmian' : 'Nie udało się utworzyć spotkania'),
      );
    } finally {
      savingMeetingRef.current = false;
      setIsSavingMeeting(false);
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

  const upcomingMeetings = meetings.filter((m) => isUpcoming(m.datetime_start || ''));
  const pastMeetings = meetings.filter((m) => !isUpcoming(m.datetime_start || ''));
  const availableMeetingColors = MEETING_COLORS.some(
    (option) => option.value.toLowerCase() === form.color.toLowerCase(),
  )
    ? MEETING_COLORS
    : [{ value: form.color, label: 'Obecny' }, ...MEETING_COLORS];

const renderMeetingCard = ({ item }: { item: Meeting }) => {
  const upcoming = isUpcoming(item.datetime_start || '');
  const hasAlerts = !!(
    item.alert_1_minutes ||
    item.alert_2_minutes ||
    item.alert_critical_minutes
  );

  return (
    <SwipeableRow onDelete={() => handleDeleteMeeting(item.id)}>
      <TouchableOpacity
        style={[styles.meetingCard, !upcoming && styles.meetingCardPast]}
        activeOpacity={0.7}
        onPress={() => setSelectedMeeting(item)}
      >
        <View
          style={[
            styles.meetingStripe,
            { backgroundColor: item.color || colors.primary.gold },
          ]}
        />

        <View style={styles.meetingContent}>
          <View style={styles.meetingHeader}>
            <Text
              style={[styles.meetingTitle, !upcoming && styles.textPast]}
              numberOfLines={1}
            >
              {item.title}
            </Text>

            {hasAlerts && upcoming && (
              <Feather
                name="bell"
                size={14}
                color={colors.primary.gold}
              />
            )}
          </View>

          <View style={styles.meetingMeta}>
            <Feather
              name="clock"
              size={12}
              color={colors.text.tertiary}
            />

            <Text style={styles.meetingMetaText}>
              {formatDate(item.datetime_start || '')} •{' '}
              {formatTime(item.datetime_start || '')}
              {item.datetime_end &&
                ` – ${formatTime(item.datetime_end || '')}`}
            </Text>
          </View>

          {item.location_text && (
            <View style={styles.meetingMeta}>
              <Feather
                name="map-pin"
                size={12}
                color={colors.text.tertiary}
              />

              <Text
                style={styles.meetingMetaText}
                numberOfLines={1}
              >
                {item.location_text}
              </Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
    </SwipeableRow>
  );
};

  const AlertTimePicker = ({
    label,
    enabled,
    onToggle,
    value,
    onValueChange,
    isCritical,
  }: {
    label: string;
    enabled: boolean;
    onToggle: (value: boolean) => void;
    value: number;
    onValueChange: (value: number) => void;
    isCritical?: boolean;
  }) => {
    const availableAlertOptions = ALERT_OPTIONS.some((option) => option.value === value)
      ? ALERT_OPTIONS
      : [{ value, label: minutesToLabel(value) }, ...ALERT_OPTIONS].sort(
          (first, second) => first.value - second.value,
        );

    return (
      <View
        style={[
          styles.alertPickerBlock,
          isCritical && styles.alertPickerBlockCritical,
          enabled && styles.alertPickerBlockEnabled,
        ]}
      >
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
            {enabled && (
              <Text style={[styles.alertCurrentValue, isCritical && styles.alertCriticalText]}>
                {minutesToLabel(value)} przed
              </Text>
            )}
          </View>

          <Switch
            style={styles.alertSwitch}
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
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.alertOptions}
          >
            {availableAlertOptions.map((option) => {
              const selected = option.value === value;

              return (
                <TouchableOpacity
                  key={option.value}
                  style={[
                    styles.alertOption,
                    selected && styles.alertOptionSelected,
                    selected && isCritical && styles.alertOptionCriticalSelected,
                  ]}
                  onPress={() => onValueChange(option.value)}
                  activeOpacity={0.75}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${label}: ${option.label} przed spotkaniem`}
                >
                  <Text
                    style={[
                      styles.alertOptionText,
                      selected && styles.alertOptionTextSelected,
                    ]}
                  >
                    {option.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
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
        <TouchableOpacity
          style={styles.addButton}
          onPress={() => {
            setEditingMeeting(null);
            resetForm();
            setShowNewMeeting(true);
          }}
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
      />

      {/* New Meeting Modal */}
      <Modal
        visible={showNewMeeting}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => {
          if (!savingMeetingRef.current) setShowNewMeeting(false);
        }}
      >
        <KeyboardAvoidingView
          style={styles.modalContainer}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
        >
          <View style={styles.modalHeader}>
            <TouchableOpacity
              disabled={isSavingMeeting}
              style={isSavingMeeting ? styles.modalActionDisabled : undefined}
              onPress={() => {
                setShowNewMeeting(false);
                setEditingMeeting(null);
                resetForm();
              }}
            >
              <Text style={styles.modalCancel}>Anuluj</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>
              {editingMeeting ? 'Edytuj spotkanie' : 'Nowe spotkanie'}
            </Text>
            <TouchableOpacity
              onPress={handleSaveMeeting}
              disabled={isSavingMeeting}
              style={[styles.modalSaveButton, isSavingMeeting && styles.modalActionDisabled]}
            >
              {isSavingMeeting ? (
                <ActivityIndicator size="small" color={colors.primary.gold} />
              ) : (
                <Text style={styles.modalSave}>{editingMeeting ? 'Zapisz' : 'Dodaj'}</Text>
              )}
            </TouchableOpacity>
          </View>

          <ScrollView
            ref={meetingFormScrollRef}
            style={styles.modalBody}
            contentContainerStyle={styles.modalBodyContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
            showsVerticalScrollIndicator
          >
            <Text style={styles.fieldLabel}>Tytuł *</Text>
            <TextInput
              style={styles.input}
              value={form.title}
              onChangeText={(t) => setForm((f) => ({ ...f, title: t }))}
              placeholder="Nazwa spotkania"
              placeholderTextColor={colors.text.tertiary}
              onFocus={handleFormInputFocus}
            />

            <Text style={styles.fieldLabel}>Termin *</Text>

            <View style={styles.dateTimeCard}>
              <View style={styles.dateTimeSection}>
                <Text style={styles.dateTimeSectionLabel}>Rozpoczęcie</Text>

                <View style={styles.dateTimeButtonsRow}>
                  <TouchableOpacity
                    style={[styles.dateTimeButton, styles.dateButton]}
                    onPress={() => openMeetingPicker('startDate')}
                    activeOpacity={0.7}
                  >
                    <Feather name="calendar" size={18} color={colors.primary.gold} />

                    <View style={styles.dateTimeButtonContent}>
                      <Text style={styles.dateTimeButtonLabel}>Data</Text>
                      <Text style={styles.dateTimeButtonValue} numberOfLines={1}>
                        {form.datetime_start?.toLocaleDateString('pl-PL', {
                          weekday: 'short',
                          day: '2-digit',
                          month: 'long',
                          year: 'numeric',
                        })}
                      </Text>
                    </View>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.dateTimeButton, styles.hourButton]}
                    onPress={() => openMeetingPicker('startTime')}
                    activeOpacity={0.7}
                  >
                    <Feather name="clock" size={18} color={colors.primary.gold} />

                    <View style={styles.dateTimeButtonContent}>
                      <Text style={styles.dateTimeButtonLabel}>Godzina</Text>
                      <Text style={styles.dateTimeButtonValue}>
                        {form.datetime_start?.toLocaleTimeString('pl-PL', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </Text>
                    </View>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.dateTimeDivider} />

              <View style={styles.dateTimeSection}>
                <Text style={styles.dateTimeSectionLabel}>Zakończenie</Text>

                <View style={styles.dateTimeButtonsRow}>
                  <TouchableOpacity
                    style={[styles.dateTimeButton, styles.dateButton]}
                    onPress={() => openMeetingPicker('endDate')}
                    activeOpacity={0.7}
                  >
                    <Feather name="calendar" size={18} color={colors.primary.gold} />

                    <View style={styles.dateTimeButtonContent}>
                      <Text style={styles.dateTimeButtonLabel}>Data</Text>
                      <Text style={styles.dateTimeButtonValue} numberOfLines={1}>
                        {form.datetime_end?.toLocaleDateString('pl-PL', {
                          weekday: 'short',
                          day: '2-digit',
                          month: 'long',
                          year: 'numeric',
                        })}
                      </Text>
                    </View>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.dateTimeButton, styles.hourButton]}
                    onPress={() => openMeetingPicker('endTime')}
                    activeOpacity={0.7}
                  >
                    <Feather name="clock" size={18} color={colors.primary.gold} />

                    <View style={styles.dateTimeButtonContent}>
                      <Text style={styles.dateTimeButtonLabel}>Godzina</Text>
                      <Text style={styles.dateTimeButtonValue}>
                        {form.datetime_end?.toLocaleTimeString('pl-PL', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </Text>
                    </View>
                  </TouchableOpacity>
                </View>
              </View>
            </View>

            {activeMeetingPicker && (
              <View style={styles.meetingPickerContainer}>
                {Platform.OS === 'ios' && (
                  <View style={styles.meetingPickerHeader}>
                    <Text style={styles.meetingPickerTitle}>
                      {activeMeetingPicker.endsWith('Date') ? 'Wybierz datę' : 'Wybierz godzinę'}
                    </Text>

                    <TouchableOpacity onPress={() => setActiveMeetingPicker(null)}>
                      <Text style={styles.meetingPickerDone}>Gotowe</Text>
                    </TouchableOpacity>
                  </View>
                )}

                <DateTimePicker
                  value={
                    activeMeetingPicker.startsWith('start')
                      ? form.datetime_start || new Date()
                      : form.datetime_end || new Date()
                  }
                  mode={activeMeetingPicker.endsWith('Date') ? 'date' : 'time'}
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  is24Hour
                  locale="pl-PL"
                  minuteInterval={5}
                  minimumDate={
                    activeMeetingPicker === 'endDate'
                      ? form.datetime_start || new Date()
                      : undefined
                  }
                  themeVariant="dark"
                  onChange={(event, selectedDate) => {
                    if (Platform.OS === 'android') {
                      setActiveMeetingPicker(null);
                    }

                    if (event.type === 'dismissed' || !selectedDate) {
                      return;
                    }

                    setForm((current) => {
                      let start = new Date(current.datetime_start || new Date());
                      let end = new Date(current.datetime_end || new Date());

                      if (activeMeetingPicker === 'startDate') {
                        start.setFullYear(
                          selectedDate.getFullYear(),
                          selectedDate.getMonth(),
                          selectedDate.getDate(),
                        );
                      }

                      if (activeMeetingPicker === 'startTime') {
                        start.setHours(selectedDate.getHours(), selectedDate.getMinutes(), 0, 0);
                      }

                      if (activeMeetingPicker === 'endDate') {
                        end.setFullYear(
                          selectedDate.getFullYear(),
                          selectedDate.getMonth(),
                          selectedDate.getDate(),
                        );
                      }

                      if (activeMeetingPicker === 'endTime') {
                        end.setHours(selectedDate.getHours(), selectedDate.getMinutes(), 0, 0);
                      }

                      if (end.getTime() <= start.getTime()) {
                        end = new Date(start.getTime() + 60 * 60 * 1000);
                      }

                      return {
                        ...current,
                        datetime_start: start,
                        datetime_end: end,
                      };
                    });
                  }}
                />
              </View>
            )}

            <SearchableDropdown<Location>
              dropdownId="location"
              openedDropdown={openedDropdown}
              setOpenedDropdown={setOpenedDropdown}
              label="Lokalizacja"
              placeholder="Wyszukaj lokalizację..."
              items={locations}
              textValue={locationSearch}
              onTextChange={(text) => {
                setLocationSearch(text);

                if (selectedLocation) {
                  setSelectedLocation(null);
                }

                setForm((current) => ({
                  ...current,
                  location_text: text,
                }));
              }}
              onSelect={(location) => {
                const label = [location.name, location.city].filter(Boolean).join(', ');

                setSelectedLocation(location);
                setLocationSearch('');

                setForm((current) => ({
                  ...current,
                  location_text: label,
                }));
              }}
              onClear={() => {
                setSelectedLocation(null);
                setLocationSearch('');

                setForm((current) => ({
                  ...current,
                  location_text: '',
                }));
              }}
              renderItem={(location) => {
                const main = [location.name, location.city].filter(Boolean).join(', ');

                return location.address ? `${main} — ${location.address}` : main;
              }}
              getFilterText={(location) =>
                `${location.name} ${location.city || ''} ${location.address || ''}`
              }
              selectedLabel={
                selectedLocation
                  ? [selectedLocation.name, selectedLocation.city].filter(Boolean).join(', ')
                  : null
              }
              icon="map-pin"
              onFocus={handleFormInputFocus}
            />

            {/* Participants */}
            <SearchableDropdown<Employee>
              dropdownId="participants"
              openedDropdown={openedDropdown}
              setOpenedDropdown={setOpenedDropdown}
              label="Przypisz pracownika"
              placeholder="Wyszukaj pracownika..."
              items={employees.filter(
                (e) => e.id !== employee?.id && !selectedParticipants.some((p) => p.id === e.id),
              )}
              textValue={participantSearch}
              onTextChange={setParticipantSearch}
              onSelect={(emp) => {
                setSelectedParticipants((prev) => [...prev, emp]);
                setParticipantSearch('');
              }}
              onClear={() => setParticipantSearch('')}
              renderItem={(emp) => `${emp.name || ''} ${emp.surname || ''}`.trim() || 'Brak nazwy'}
              getFilterText={(emp) => `${emp.name || ''} ${emp.surname || ''}`}
              selectedLabel={null}
              icon="user"
              onFocus={handleFormInputFocus}
            />
            {selectedParticipants.length > 0 && (
              <View style={styles.participantChips}>
                {selectedParticipants.map((p) => (
                  <View key={p.id} style={styles.participantChip}>
                    <Feather name="user" size={12} color={colors.primary.gold} />
                    <Text style={styles.participantChipText} numberOfLines={1}>
                      {`${p.name || ''} ${p.surname || ''}`.trim()}
                    </Text>
                    <TouchableOpacity
                      onPress={() =>
                        setSelectedParticipants((prev) => prev.filter((x) => x.id !== p.id))
                      }
                      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    >
                      <Feather name="x" size={14} color={colors.text.tertiary} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            <Text style={styles.fieldLabel}>Notatki</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={form.notes}
              onChangeText={(t) => setForm((f) => ({ ...f, notes: t }))}
              placeholder="Dodatkowe informacje..."
              placeholderTextColor={colors.text.tertiary}
              multiline
              numberOfLines={3}
              onFocus={handleFormInputFocus}
            />

            <Text style={styles.fieldLabel}>Kolor spotkania</Text>
            <View style={styles.colorPicker}>
              {availableMeetingColors.map((option) => {
                const selected = form.color.toLowerCase() === option.value.toLowerCase();

                return (
                  <TouchableOpacity
                    key={option.value}
                    style={[styles.colorOption, selected && styles.colorOptionSelected]}
                    onPress={() => setForm((current) => ({ ...current, color: option.value }))}
                    activeOpacity={0.75}
                    accessibilityRole="button"
                    accessibilityLabel={`Kolor spotkania: ${option.label}`}
                    accessibilityState={{ selected }}
                  >
                    <View style={[styles.colorSwatch, { backgroundColor: option.value }]}>
                      {selected && <Feather name="check" size={16} color="#ffffff" />}
                    </View>
                    <Text style={[styles.colorLabel, selected && styles.colorLabelSelected]}>
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Alerts */}
            <View style={styles.alertsSection}>
              <View style={styles.alertsSectionHeader}>
                <Feather name="bell" size={15} color={colors.primary.gold} />
                <View>
                  <Text style={styles.alertsSectionTitle}>Przypomnienia</Text>
                  <Text style={styles.alertsSectionDescription}>
                    Włącz i wybierz, kiedy przypomnieć.
                  </Text>
                </View>
              </View>

              <AlertTimePicker
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
        </KeyboardAvoidingView>
      </Modal>

      {/* Meeting Detail Modal */}
      <Modal
        visible={!!selectedMeeting}
        onRequestClose={() => setSelectedMeeting(null)}
        animationType="slide"
        presentationStyle="pageSheet"
      >
        {selectedMeeting && (
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <TouchableOpacity
                onPress={() => {
                  setSelectedMeeting(null);

                  if (initialMeetingId) {
                    onBack?.();
                  }
                }}
              >
                <Text style={styles.modalCancel}>Zamknij</Text>
              </TouchableOpacity>

              <Text style={styles.modalTitle}>Szczegóły</Text>

              <View style={styles.detailHeaderActions}>
                <TouchableOpacity
                  style={styles.detailHeaderButton}
                  onPress={() => openEditMeeting(selectedMeeting)}
                >
                  <Feather name="edit-2" size={19} color={colors.primary.gold} />
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.detailHeaderButton}
                  onPress={() => handleDeleteMeeting(selectedMeeting.id)}
                >
                  <Feather name="trash-2" size={20} color={colors.status.error} />
                </TouchableOpacity>
              </View>
            </View>

            <ScrollView
              style={styles.modalBody}
              keyboardShouldPersistTaps="handled"
              onScrollBeginDrag={() => setOpenedDropdown(null)}
            >
              <Text style={styles.detailTitle}>{selectedMeeting.title}</Text>

              <View style={styles.detailRow}>
                <Feather name="clock" size={16} color={colors.primary.gold} />
                <Text style={styles.detailText}>
                  {formatDate(selectedMeeting.datetime_start || '')} •{' '}
                  {formatTime(selectedMeeting.datetime_start || '')}
                  {selectedMeeting.datetime_end &&
                    ` – ${formatTime(selectedMeeting.datetime_end || '')}`}
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

              {selectedMeeting.participants && selectedMeeting.participants.length > 0 && (
                <View style={styles.detailNotesSection}>
                  <Text style={styles.detailSectionLabel}>Uczestnicy</Text>
                  <View style={styles.participantChips}>
                    {selectedMeeting.participants.map((p) => {
                      const emp = employees.find((e) => e.id === p.employee_id);
                      return (
                        <View key={p.employee_id} style={styles.participantChip}>
                          <Feather name="user" size={12} color={colors.primary.gold} />
                          <Text style={styles.participantChipText} numberOfLines={1}>
                            {emp ? `${emp.name || ''} ${emp.surname || ''}`.trim() : 'Pracownik'}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
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

  modalSaveButton: {
    minWidth: 56,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },

  modalActionDisabled: {
    opacity: 0.55,
  },

  modalBody: {
    flex: 1,
  },

  modalBodyContent: {
    padding: spacing.lg,
    paddingBottom: 120,
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

  colorPicker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: 12,
    backgroundColor: colors.background.secondary,
  },

  colorOption: {
    width: 66,
    alignItems: 'center',
    gap: 5,
    paddingVertical: 6,
    borderRadius: 10,
  },

  colorOptionSelected: {
    backgroundColor: `${colors.primary.gold}12`,
  },

  colorSwatch: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.22)',
  },

  colorLabel: {
    fontSize: 10,
    color: colors.text.tertiary,
  },

  colorLabelSelected: {
    color: colors.text.primary,
    fontWeight: typography.fontWeights.semibold as any,
  },

  alertsSection: {
    marginTop: spacing.lg,
    padding: spacing.sm,
    backgroundColor: colors.background.secondary,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border.default,
  },

  alertsSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
    marginBottom: spacing.sm,
  },

  alertsSectionTitle: {
    fontSize: typography.fontSizes.sm,
    fontWeight: typography.fontWeights.semibold as any,
    color: colors.text.primary,
  },

  alertsSectionDescription: {
    marginTop: 1,
    fontSize: 10,
    color: colors.text.tertiary,
  },

  alertSliderHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  alertSliderLabelRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },

  alertSliderLabel: {
    fontSize: typography.fontSizes.sm,
    fontWeight: typography.fontWeights.medium as any,
    color: colors.text.secondary,
  },

  alertCurrentValue: {
    fontSize: 10,
    color: colors.primary.gold,
  },

  alertCriticalText: {
    color: colors.status.error,
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

  participantChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  participantChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary.gold + '15',
    borderWidth: 1,
    borderColor: colors.primary.gold + '30',
    borderRadius: 16,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  participantChipText: {
    fontSize: typography.fontSizes.xs,
    color: colors.text.primary,
    fontWeight: '500',
    maxWidth: 120,
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
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: 10,
    backgroundColor: colors.background.primary,
  },

  alertPickerBlockEnabled: {
    borderColor: `${colors.primary.gold}30`,
  },

  alertPickerBlockCritical: {
    borderColor: `${colors.status.error}28`,
  },

  alertSwitch: {
    transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }],
  },

  alertOptions: {
    gap: 6,
    paddingTop: spacing.sm,
    paddingRight: spacing.sm,
  },

  alertOption: {
    minHeight: 30,
    justifyContent: 'center',
    paddingHorizontal: 11,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: colors.border.default,
    backgroundColor: colors.background.secondary,
  },

  alertOptionSelected: {
    borderColor: colors.primary.gold,
    backgroundColor: `${colors.primary.gold}22`,
  },

  alertOptionCriticalSelected: {
    borderColor: colors.status.error,
    backgroundColor: `${colors.status.error}18`,
  },

  alertOptionText: {
    fontSize: 11,
    color: colors.text.tertiary,
  },

  alertOptionTextSelected: {
    color: colors.text.primary,
    fontWeight: typography.fontWeights.semibold as any,
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

  dateTimeCard: {
    backgroundColor: colors.background.secondary,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: 14,
    overflow: 'hidden',
  },

  dateTimeSection: {
    padding: spacing.md,
  },

  dateTimeSectionLabel: {
    fontSize: typography.fontSizes.xs,
    fontWeight: typography.fontWeights.semibold as any,
    color: colors.text.secondary,
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  dateTimeButtonsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },

  dateTimeButton: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border.default,
    backgroundColor: colors.background.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },

  dateButton: {
    flex: 1,
  },

  hourButton: {
    width: 116,
  },

  dateTimeButtonContent: {
    flex: 1,
  },

  dateTimeButtonLabel: {
    fontSize: 10,
    color: colors.text.tertiary,
    marginBottom: 2,
  },

  dateTimeButtonValue: {
    fontSize: typography.fontSizes.sm,
    fontWeight: typography.fontWeights.semibold as any,
    color: colors.text.primary,
  },

  dateTimeDivider: {
    height: 1,
    backgroundColor: colors.border.default,
  },

  meetingPickerContainer: {
    marginTop: spacing.sm,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: colors.background.secondary,
    borderWidth: 1,
    borderColor: colors.border.default,
  },

  meetingPickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
  },

  meetingPickerTitle: {
    fontSize: typography.fontSizes.sm,
    fontWeight: typography.fontWeights.semibold as any,
    color: colors.text.primary,
  },

  meetingPickerDone: {
    fontSize: typography.fontSizes.sm,
    fontWeight: typography.fontWeights.semibold as any,
    color: colors.primary.gold,
  },
  detailHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },

  detailHeaderButton: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 17,
  },
});
