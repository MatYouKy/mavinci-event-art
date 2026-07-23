import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Calendar, DateData } from 'react-native-calendars';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, typography } from '../theme';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import PermissionGate from '../components/PermissionGate';
import EventDetailScreen from './EventDetailScreen';

interface CalendarEvent {
  id: string;
  name: string;
  event_date: string;
  event_end_date: string | null;
  status: string;
  color?: string;
  location?: string;
  is_meeting?: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  pending: colors.status.warning,
  confirmed: colors.status.info,
  in_progress: '#7c3aed',
  completed: colors.status.success,
  cancelled: colors.status.error,
  meeting: colors.primary.gold,
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Oczekujące',
  confirmed: 'Potwierdzone',
  in_progress: 'W trakcie',
  completed: 'Zakończone',
  cancelled: 'Anulowane',
  meeting: 'Spotkanie',
};

function CalendarContent({ onEventPress }: { onEventPress: (eventId: string) => void }) {
  const { employee } = useAuth();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().split('T')[0]
  );

  const fetchEvents = useCallback(async () => {
    if (!employee?.id) return;
    setIsLoading(true);

    try {
      const { data: assignedRows } = await supabase
        .from('employee_assignments')
        .select('event_id')
        .eq('employee_id', employee.id);

      const assignedIds = (assignedRows ?? []).map((r) => r.event_id).filter(Boolean);

      let allEvents: CalendarEvent[] = [];

      if (assignedIds.length > 0) {
        const { data: eventData } = await supabase
          .from('events')
          .select('id, name, event_date, event_end_date, status, location')
          .in('id', assignedIds);

        if (eventData) {
          allEvents = eventData.map((e) => ({
            ...e,
            is_meeting: false,
          }));
        }
      }

      const { data: ownEvents } = await supabase
        .from('events')
        .select('id, name, event_date, event_end_date, status, location')
        .eq('created_by', employee.id);

      if (ownEvents) {
        const existingIds = new Set(allEvents.map((e) => e.id));
        for (const e of ownEvents) {
          if (!existingIds.has(e.id)) {
            allEvents.push({ ...e, is_meeting: false });
          }
        }
      }

      const { data: meetings } = await supabase
        .from('meetings')
        .select('id, title, datetime_start, datetime_end, location_text')
        .is('deleted_at', null)
        .eq('created_by', employee.id);

      if (meetings) {
        for (const m of meetings) {
          allEvents.push({
            id: m.id,
            name: m.title ?? 'Spotkanie',
            event_date: m.datetime_start,
            event_end_date: m.datetime_end,
            status: 'meeting',
            location: m.location_text ?? undefined,
            is_meeting: true,
          });
        }
      }

      const { data: participantRows } = await supabase
        .from('meeting_participants')
        .select('meeting_id')
        .eq('employee_id', employee.id);

      if (participantRows && participantRows.length > 0) {
        const meetingIds = participantRows.map((r) => r.meeting_id).filter(Boolean);
        const existingMeetingIds = new Set(
          allEvents.filter((e) => e.is_meeting).map((e) => e.id)
        );

        const missingIds = meetingIds.filter((id) => !existingMeetingIds.has(id));
        if (missingIds.length > 0) {
          const { data: participantMeetings } = await supabase
            .from('meetings')
            .select('id, title, datetime_start, datetime_end, location_text')
            .is('deleted_at', null)
            .in('id', missingIds);

          if (participantMeetings) {
            for (const m of participantMeetings) {
              allEvents.push({
                id: m.id,
                name: m.title ?? 'Spotkanie',
                event_date: m.datetime_start,
                event_end_date: m.datetime_end,
                status: 'meeting',
                location: m.location_text ?? undefined,
                is_meeting: true,
              });
            }
          }
        }
      }

      setEvents(allEvents);
    } catch (error) {
      console.error('Error fetching calendar events:', error);
    } finally {
      setIsLoading(false);
    }
  }, [employee?.id]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const markedDates = useMemo(() => {
    const marks: Record<string, any> = {};

    for (const event of events) {
      const date = event.event_date?.split('T')[0];
      if (!date) continue;

      const color = STATUS_COLORS[event.status] || colors.primary.gold;

      if (!marks[date]) {
        marks[date] = { dots: [{ color }] };
      } else if (marks[date].dots.length < 3) {
        marks[date].dots.push({ color });
      }
    }

    if (selectedDate) {
      marks[selectedDate] = {
        ...marks[selectedDate],
        selected: true,
        selectedColor: colors.primary.gold + '33',
      };
    }

    return marks;
  }, [events, selectedDate]);

  const eventsForSelectedDate = useMemo(() => {
    if (!selectedDate) return [];
    return events
      .filter((e) => e.event_date?.startsWith(selectedDate))
      .sort(
        (a, b) =>
          new Date(a.event_date).getTime() - new Date(b.event_date).getTime()
      );
  }, [events, selectedDate]);

  const renderEvent = ({ item }: { item: CalendarEvent }) => {
    const statusColor = STATUS_COLORS[item.status] || colors.text.tertiary;
    const time = new Date(item.event_date).toLocaleTimeString('pl-PL', {
      hour: '2-digit',
      minute: '2-digit',
    });

    return (
      <TouchableOpacity style={styles.eventCard} activeOpacity={0.7} onPress={() => onEventPress(item.id)}>
        <View style={[styles.eventIndicator, { backgroundColor: statusColor }]} />
        <View style={styles.eventContent}>
          <Text style={styles.eventTime}>{time}</Text>
          <Text style={styles.eventTitle} numberOfLines={1}>
            {item.name}
          </Text>
          {item.location && (
            <View style={styles.eventLocationRow}>
              <Feather name="map-pin" size={12} color={colors.text.tertiary} />
              <Text style={styles.eventLocation} numberOfLines={1}>
                {item.location}
              </Text>
            </View>
          )}
          <View style={styles.eventStatusRow}>
            <View style={[styles.statusBadge, { backgroundColor: statusColor + '22' }]}>
              <Text style={[styles.statusText, { color: statusColor }]}>
                {STATUS_LABELS[item.status] || item.status}
              </Text>
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary.gold} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Calendar
        current={selectedDate}
        onDayPress={(day: DateData) => setSelectedDate(day.dateString)}
        markingType="multi-dot"
        markedDates={markedDates}
        theme={{
          backgroundColor: colors.background.primary,
          calendarBackground: colors.background.primary,
          textSectionTitleColor: colors.text.secondary,
          selectedDayBackgroundColor: colors.primary.gold,
          selectedDayTextColor: '#000',
          todayTextColor: colors.primary.gold,
          dayTextColor: colors.text.primary,
          textDisabledColor: colors.text.tertiary + '66',
          monthTextColor: colors.text.primary,
          arrowColor: colors.primary.gold,
          textDayFontWeight: '500',
          textMonthFontWeight: '700',
          textDayHeaderFontWeight: '600',
        }}
        style={styles.calendar}
      />

      <View style={styles.eventsSection}>
        <Text style={styles.sectionTitle}>
          {selectedDate === new Date().toISOString().split('T')[0]
            ? 'Dzisiaj'
            : new Date(selectedDate + 'T00:00:00').toLocaleDateString('pl-PL', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              })}
          {eventsForSelectedDate.length > 0 &&
            ` (${eventsForSelectedDate.length})`}
        </Text>

        {eventsForSelectedDate.length === 0 ? (
          <View style={styles.emptyState}>
            <Feather name="calendar" size={32} color={colors.text.tertiary} />
            <Text style={styles.emptyText}>Brak wydarzeń w tym dniu</Text>
          </View>
        ) : (
          <FlatList
            data={eventsForSelectedDate}
            keyExtractor={(item) => item.id}
            renderItem={renderEvent}
            refreshControl={
              <RefreshControl
                refreshing={isLoading}
                onRefresh={fetchEvents}
                tintColor={colors.primary.gold}
              />
            }
            contentContainerStyle={styles.eventsList}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background.primary,
  },
  calendar: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
  },
  eventsSection: {
    flex: 1,
    paddingTop: spacing.md,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text.primary,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
    textTransform: 'capitalize',
  },
  eventsList: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.lg,
  },
  eventCard: {
    flexDirection: 'row',
    backgroundColor: colors.background.secondary,
    borderRadius: 12,
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },
  eventIndicator: {
    width: 4,
  },
  eventContent: {
    flex: 1,
    padding: spacing.md,
  },
  eventTime: {
    fontSize: 12,
    color: colors.text.tertiary,
    marginBottom: 4,
  },
  eventTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text.primary,
    marginBottom: 4,
  },
  eventLocationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 6,
  },
  eventLocation: {
    fontSize: 12,
    color: colors.text.tertiary,
    flex: 1,
  },
  eventStatusRow: {
    flexDirection: 'row',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: spacing.xl,
  },
  emptyText: {
    marginTop: spacing.sm,
    fontSize: 14,
    color: colors.text.tertiary,
  },
});

export default function CalendarScreen({ initialMeetingId }: { initialMeetingId?: string | null }) {
  const [selectedEventId, setSelectedEventId] = useState<string | null>(initialMeetingId ?? null);

  useEffect(() => {
    if (initialMeetingId) {
      setSelectedEventId(initialMeetingId);
    }
  }, [initialMeetingId]);

  if (selectedEventId) {
    return (
      <EventDetailScreen
        eventId={selectedEventId}
        onBack={() => setSelectedEventId(null)}
      />
    );
  }

  return (
    <PermissionGate module="calendar">
      <CalendarContent onEventPress={(id) => setSelectedEventId(id)} />
    </PermissionGate>
  );
}
