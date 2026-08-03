import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  useWindowDimensions,
} from 'react-native';
import { Calendar, DateData, LocaleConfig } from 'react-native-calendars';

LocaleConfig.locales['pl'] = {
  monthNames: [
    'Styczeń',
    'Luty',
    'Marzec',
    'Kwiecień',
    'Maj',
    'Czerwiec',
    'Lipiec',
    'Sierpień',
    'Wrzesień',
    'Październik',
    'Listopad',
    'Grudzień',
  ],
  monthNamesShort: [
    'Sty',
    'Lut',
    'Mar',
    'Kwi',
    'Maj',
    'Cze',
    'Lip',
    'Sie',
    'Wrz',
    'Paź',
    'Lis',
    'Gru',
  ],
  dayNames: ['Niedziela', 'Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota'],
  dayNamesShort: ['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'Sb'],
  today: 'Dziś',
};
LocaleConfig.defaultLocale = 'pl';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, typography } from '../theme';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import PermissionGate from '../components/PermissionGate';
import EventDetailScreen from './EventDetailScreen';
import TaskDetailScreen from './TaskDetailScreen';
import NewInquiryModal from './NewInquiryModal';
import { STATUS_COLORS, STATUS_LABELS } from './EventsScreen';
import MeetingsScreen from './MeetingsScreen';

interface CalendarEvent {
  id: string;
  name: string;
  event_date: string;
  event_end_date: string | null;
  status: string;

  location?: string;
  creator_name?: string | null;

  category_id?: string | null;
  category_name?: string | null;
  category_color?: string | null;
  category_icon_svg?: string | null;

  is_meeting?: boolean;
  is_inquiry?: boolean;
}

function CalendarContent({ onEventPress }: { onEventPress: (eventId: CalendarEvent) => void }) {
  const { employee } = useAuth();
  const { width, height } = useWindowDimensions();
  const isWideLayout = width > height && width >= 768;
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [inquiryModalVisible, setInquiryModalVisible] = useState(false);

  const fetchEvents = useCallback(async () => {
    if (!employee?.id) return;

    setIsLoading(true);

    try {
      let allEvents: CalendarEvent[] = [];

      // ==========================================
      // Pobierz ID wydarzeń przypisanych i własnych
      // ==========================================

      const [{ data: assignedRows }, { data: ownRows }] = await Promise.all([
        supabase.from('employee_assignments').select('event_id').eq('employee_id', employee.id),

        supabase.from('events').select('id').eq('created_by', employee.id),
      ]);

      const eventIds = [
        ...(assignedRows ?? []).map((r) => r.event_id),
        ...(ownRows ?? []).map((r) => r.id),
      ].filter(Boolean);

      const uniqueEventIds = [...new Set(eventIds)];

      // ==========================================
      // Pobierz wydarzenia wraz z kategoriami
      // ==========================================

      if (uniqueEventIds.length > 0) {
        const { data: eventData, error } = await supabase
          .from('events')
          .select(
            `
            id,
            name,
            event_date,
            event_end_date,
            status,
            location,
            category_id,
            creator:employees!created_by(
              name,
              surname
            ),
            category:event_categories!category_id(
              id,
              name,
              color,
              icon:custom_icons!icon_id(
                svg_code
              )
            )
          `,
          )
          .in('id', uniqueEventIds);

        if (error) {
          console.error(error);
        }

        if (eventData) {
          allEvents = eventData.map((event: any) => ({
            id: event.id,
            name: event.name,
            event_date: event.event_date,
            event_end_date: event.event_end_date,
            status: event.status,
            location: event.location,
            creator_name: event.creator
              ? [event.creator.name, event.creator.surname].filter(Boolean).join(' ')
              : null,

            category_id: event.category_id,
            category_name: event.category?.name ?? 'Wydarzenie',
            category_color: event.category?.color ?? colors.primary.gold,
            category_icon_svg: event.category?.icon?.svg_code ?? null,

            is_meeting: false,
            is_inquiry: false,
          }));
        }
      }

      // ==========================================
      // Spotkania utworzone przeze mnie
      // ==========================================

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

            category_name: 'Spotkanie',
            category_color: '#8B5CF6',
            category_icon_svg: null,

            is_meeting: true,
            is_inquiry: false,
          });
        }
      }

      // ==========================================
      // Spotkania, na które jestem zaproszony
      // ==========================================

      const { data: participantRows } = await supabase
        .from('meeting_participants')
        .select('meeting_id')
        .eq('employee_id', employee.id);

      if (participantRows?.length) {
        const existingMeetingIds = new Set(allEvents.filter((e) => e.is_meeting).map((e) => e.id));

        const meetingIds = participantRows
          .map((r) => r.meeting_id)
          .filter((id) => !existingMeetingIds.has(id));

        if (meetingIds.length) {
          const { data: participantMeetings } = await supabase
            .from('meetings')
            .select('id, title, datetime_start, datetime_end, location_text')
            .is('deleted_at', null)
            .in('id', meetingIds);

          if (participantMeetings) {
            for (const m of participantMeetings) {
              allEvents.push({
                id: m.id,
                name: m.title ?? 'Spotkanie',
                event_date: m.datetime_start,
                event_end_date: m.datetime_end,
                status: 'meeting',
                location: m.location_text ?? undefined,

                category_name: 'Spotkanie',
                category_color: '#8B5CF6',
                category_icon_svg: null,

                is_meeting: true,
                is_inquiry: false,
              });
            }
          }
        }
      }

      // ==========================================
      // Zapytania
      // ==========================================

      const { data: inquiryTasks } = await supabase
        .from('tasks')
        .select('id, title, due_date, inquiry_details')
        .eq('is_inquiry', true)
        .neq('board_column', 'completed')
        .not('due_date', 'is', null);

      if (inquiryTasks) {
        for (const t of inquiryTasks) {
          allEvents.push({
            id: `inquiry-${t.id}`,
            name: t.title || 'Zapytanie',
            event_date: t.due_date!,
            event_end_date: null,
            status: 'inquiry',
            location: t.inquiry_details?.location_text ?? undefined,

            category_name: 'Zapytanie',
            category_color: '#3b82f6',
            category_icon_svg: null,

            is_meeting: false,
            is_inquiry: true,
          });
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

      const color =
      event.category_color ||
      STATUS_COLORS[event.status] ||
      colors.primary.gold;

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
      .sort((a, b) => new Date(a.event_date).getTime() - new Date(b.event_date).getTime());
  }, [events, selectedDate]);

  const renderEvent = ({ item }: { item: CalendarEvent }) => {
    const badgeColor = item.category_color || STATUS_COLORS[item.status] || colors.text.tertiary;

    const badgeLabel = item.category_name || STATUS_LABELS[item.status] || item.status;

    const time = new Date(item.event_date).toLocaleTimeString('pl-PL', {
      hour: '2-digit',
      minute: '2-digit',
    });

    return (
      <TouchableOpacity
        style={styles.eventCard}
        activeOpacity={0.7}
        onPress={() => onEventPress(item)}
      >
        <View
          style={[
            styles.eventIndicator,
            {
              backgroundColor: badgeColor,
            },
          ]}
        />

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

          {item.creator_name && (
            <View style={styles.eventLocationRow}>
              <Feather name="user" size={12} color={colors.text.tertiary} />

              <Text style={styles.eventLocation} numberOfLines={1}>
                {item.creator_name}
              </Text>
            </View>
          )}

          <View style={styles.eventStatusRow}>
            <View
              style={[
                styles.statusBadge,
                {
                  backgroundColor: `${badgeColor}22`,
                  borderColor: `${badgeColor}55`,
                },
              ]}
            >
              <Text
                style={[
                  styles.statusText,
                  {
                    color: badgeColor,
                  },
                ]}
              >
                {badgeLabel}
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
    <View style={[styles.container, isWideLayout && styles.containerRow]}>
      <View style={isWideLayout ? styles.calendarColumn : undefined}>
        <Calendar
        firstDay={1}
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
        style={[styles.calendar, isWideLayout && styles.calendarWide]}
        />
      </View>

      <View style={[styles.eventsSection, isWideLayout && styles.eventsSectionWide]}>
        <Text style={styles.sectionTitle}>
          {selectedDate === new Date().toISOString().split('T')[0]
            ? 'Dzisiaj'
            : new Date(selectedDate + 'T00:00:00').toLocaleDateString('pl-PL', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              })}
          {eventsForSelectedDate.length > 0 && ` (${eventsForSelectedDate.length})`}
        </Text>

        <TouchableOpacity style={styles.addInquiryBtn} onPress={() => setInquiryModalVisible(true)}>
          <Feather name="phone-call" size={16} color={colors.primary.gold} />
          <Text style={styles.addInquiryBtnText}>Dodaj zapytanie</Text>
        </TouchableOpacity>

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

      <NewInquiryModal
        visible={inquiryModalVisible}
        onClose={() => setInquiryModalVisible(false)}
        initialDate={selectedDate}
        onSaved={fetchEvents}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },
  containerRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  calendarColumn: {
    flex: 1,
    maxWidth: 480,
    borderRightWidth: 1,
    borderRightColor: colors.border.default,
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
  calendarWide: {
    borderBottomWidth: 0,
  },
  eventsSection: {
    flex: 1,
    paddingTop: spacing.md,
  },
  eventsSectionWide: {
    flex: 1.3,
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
    borderWidth: 1,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
  },
  addInquiryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary.gold + '15',
    borderWidth: 1,
    borderColor: colors.primary.gold + '40',
    borderRadius: 10,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  addInquiryBtnText: {
    fontSize: typography.fontSizes.sm,
    fontWeight: '600',
    color: colors.primary.gold,
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
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(
    initialMeetingId ?? null,
  );
  const [selectedInquiryId, setSelectedInquiryId] = useState<string | null>(null);

  useEffect(() => {
    if (initialMeetingId) {
      setSelectedMeetingId(initialMeetingId);
    }
  }, [initialMeetingId]);

  const handleEventPress = (item: CalendarEvent) => {
    if (item.is_meeting || item.status === 'meeting') {
      setSelectedMeetingId(item.id);
      return;
    }

    if (item.id.startsWith('inquiry-')) {
      setSelectedInquiryId(item.id.replace('inquiry-', ''));
      return;
    }

    setSelectedEventId(item.id);
  };

  if (selectedInquiryId) {
    return (
      <TaskDetailScreen
        route={{ params: { taskId: selectedInquiryId } }}
        navigation={{ goBack: () => setSelectedInquiryId(null) }}
      />
    );
  }

  if (selectedMeetingId) {
    return (
      <MeetingsScreen
        initialMeetingId={selectedMeetingId}
        onBack={() => setSelectedMeetingId(null)}
      />
    );
  }

  if (selectedEventId) {
    return <EventDetailScreen eventId={selectedEventId} onBack={() => setSelectedEventId(null)} />;
  }

  return (
    <PermissionGate module="calendar">
      <CalendarContent onEventPress={handleEventPress} />
    </PermissionGate>
  );
}
