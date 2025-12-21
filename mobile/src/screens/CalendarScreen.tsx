import React, { useState, useMemo } from 'react';
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
import { useGetCalendarEventsQuery } from '../../../../src/store/api/calendarApi';

interface CalendarEvent {
  id: string;
  name: string;
  event_date: string;
  event_end_date: string | null;
  status: string;
  color?: string;
  location?: string;
  organization?: { name: string } | null;
  category?: { name: string; color?: string } | null;
  is_meeting?: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  pending: colors.status.warning,
  confirmed: colors.status.info,
  completed: colors.status.success,
  cancelled: colors.status.error,
  meeting: colors.primary.gold,
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'W trakcie',
  confirmed: 'Potwierdzone',
  completed: 'Zakończone',
  cancelled: 'Anulowane',
  meeting: 'Spotkanie',
};

export default function CalendarScreen() {
  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().split('T')[0]
  );

  const { data: events = [], isLoading, refetch } = useGetCalendarEventsQuery();

  const markedDates = useMemo(() => {
    const marked: any = {};

    events.forEach((event) => {
      const date = event.event_date.split('T')[0];
      if (!marked[date]) {
        marked[date] = {
          marked: true,
          dots: [],
        };
      }
      marked[date].dots.push({
        color: event.color || STATUS_COLORS[event.status] || colors.primary.gold,
      });
    });

    marked[selectedDate] = {
      ...marked[selectedDate],
      selected: true,
      selectedColor: colors.primary.gold,
    };

    return marked;
  }, [events, selectedDate]);

  const eventsForSelectedDate = useMemo(() => {
    return events.filter((event) => {
      const eventDate = event.event_date.split('T')[0];
      return eventDate === selectedDate;
    });
  }, [events, selectedDate]);

  const onDayPress = (day: DateData) => {
    setSelectedDate(day.dateString);
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString('pl-PL', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const renderEventItem = ({ item }: { item: CalendarEvent }) => {
    const statusColor = item.color || STATUS_COLORS[item.status] || colors.primary.gold;

    return (
      <TouchableOpacity style={styles.eventCard}>
        <View style={[styles.eventIndicator, { backgroundColor: statusColor }]} />
        <View style={styles.eventContent}>
          <View style={styles.eventHeader}>
            <Text style={styles.eventTitle} numberOfLines={1}>
              {item.name}
            </Text>
            <View
              style={[
                styles.statusBadge,
                { backgroundColor: statusColor + '20', borderColor: statusColor },
              ]}
            >
              <Text style={[styles.statusText, { color: statusColor }]}>
                {STATUS_LABELS[item.status] || item.status}
              </Text>
            </View>
          </View>

          <View style={styles.eventDetails}>
            <View style={styles.detailRow}>
              <Feather name="clock" size={14} color={colors.text.secondary} />
              <Text style={styles.detailText}>
                {formatTime(item.event_date)}
                {item.event_end_date && ` - ${formatTime(item.event_end_date)}`}
              </Text>
            </View>

            {item.location && (
              <View style={styles.detailRow}>
                <Feather name="map-pin" size={14} color={colors.text.secondary} />
                <Text style={styles.detailText} numberOfLines={1}>
                  {item.location}
                </Text>
              </View>
            )}

            {item.organization && (
              <View style={styles.detailRow}>
                <Feather name="briefcase" size={14} color={colors.text.secondary} />
                <Text style={styles.detailText} numberOfLines={1}>
                  {item.organization.name}
                </Text>
              </View>
            )}

            {item.category && (
              <View style={styles.detailRow}>
                <Feather name="tag" size={14} color={colors.text.secondary} />
                <Text style={styles.detailText}>{item.category.name}</Text>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <Feather name="calendar" size={64} color={colors.text.tertiary} />
      <Text style={styles.emptyTitle}>Brak wydarzeń</Text>
      <Text style={styles.emptySubtitle}>
        Nie masz żadnych wydarzeń zaplanowanych na ten dzień
      </Text>
    </View>
  );

  const selectedDateFormatted = new Date(selectedDate + 'T00:00:00').toLocaleDateString(
    'pl-PL',
    {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }
  );

  return (
    <View style={styles.container}>
      <Calendar
        current={selectedDate}
        onDayPress={onDayPress}
        markedDates={markedDates}
        markingType="multi-dot"
        theme={{
          calendarBackground: colors.background.secondary,
          textSectionTitleColor: colors.text.secondary,
          selectedDayBackgroundColor: colors.primary.gold,
          selectedDayTextColor: colors.background.primary,
          todayTextColor: colors.primary.gold,
          dayTextColor: colors.text.primary,
          textDisabledColor: colors.text.disabled,
          monthTextColor: colors.text.primary,
          textMonthFontSize: typography.fontSizes.lg,
          textDayFontSize: typography.fontSizes.md,
          textMonthFontWeight: typography.fontWeights.bold,
          arrowColor: colors.primary.gold,
          dotColor: colors.primary.gold,
        }}
        style={styles.calendar}
      />

      <View style={styles.eventsContainer}>
        <View style={styles.eventsHeader}>
          <Text style={styles.selectedDateText}>{selectedDateFormatted}</Text>
          <Text style={styles.eventCount}>
            {eventsForSelectedDate.length}{' '}
            {eventsForSelectedDate.length === 1 ? 'wydarzenie' : 'wydarzeń'}
          </Text>
        </View>

        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary.gold} />
          </View>
        ) : (
          <FlatList
            data={eventsForSelectedDate}
            renderItem={renderEventItem}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.eventsList}
            ListEmptyComponent={renderEmptyState}
            refreshControl={
              <RefreshControl
                refreshing={isLoading}
                onRefresh={refetch}
                tintColor={colors.primary.gold}
              />
            }
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
  calendar: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
  },
  eventsContainer: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },
  eventsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
  },
  selectedDateText: {
    fontSize: typography.fontSizes.md,
    fontWeight: typography.fontWeights.semiBold,
    color: colors.text.primary,
    textTransform: 'capitalize',
  },
  eventCount: {
    fontSize: typography.fontSizes.sm,
    color: colors.text.secondary,
  },
  eventsList: {
    padding: spacing.md,
  },
  eventCard: {
    flexDirection: 'row',
    backgroundColor: colors.background.secondary,
    borderRadius: 12,
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  eventIndicator: {
    width: 4,
  },
  eventContent: {
    flex: 1,
    padding: spacing.md,
  },
  eventHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  eventTitle: {
    flex: 1,
    fontSize: typography.fontSizes.md,
    fontWeight: typography.fontWeights.semiBold,
    color: colors.text.primary,
    marginRight: spacing.sm,
  },
  statusBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  statusText: {
    fontSize: typography.fontSizes.xs,
    fontWeight: typography.fontWeights.medium,
  },
  eventDetails: {
    gap: spacing.xs,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  detailText: {
    fontSize: typography.fontSizes.sm,
    color: colors.text.secondary,
    flex: 1,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl * 2,
    gap: spacing.md,
  },
  emptyTitle: {
    fontSize: typography.fontSizes.lg,
    fontWeight: typography.fontWeights.semiBold,
    color: colors.text.secondary,
  },
  emptySubtitle: {
    fontSize: typography.fontSizes.md,
    color: colors.text.tertiary,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
