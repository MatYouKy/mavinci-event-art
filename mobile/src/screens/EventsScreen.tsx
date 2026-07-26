import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  Switch,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing } from '../theme';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export interface EventListItem {
  id: string;
  name: string;
  event_date: string;
  event_end_date: string | null;
  status: string;
  category_name: string | null;
  category_color: string | null;
  location_name: string | null;
  organization_name: string | null;
  creator_name: string | null;
}

interface Props {
  onEventPress: (event: EventListItem) => void;
}

const normalizeStatus = (status: string | null | undefined) =>
  String(status || '')
    .trim()
    .toLowerCase();

const getEventStartTimestamp = (event: EventListItem) => {
  const timestamp = new Date(event.event_date).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
};

const getEventEndTimestamp = (event: EventListItem) => {
  const source = event.event_end_date || event.event_date;
  const timestamp = new Date(source).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
};

const isPastEvent = (event: EventListItem) => {
  return getEventEndTimestamp(event) < Date.now();
};

export const STATUS_LABELS: Record<string, string> = {
  inquiry: 'Zapytanie',
  offer_to_send: 'Oferta do wysłania',
  offer_sent: 'Oferta wysłana',
  offer_accepted: 'Oferta zaakceptowana',
  in_preparation: 'W przygotowaniu',
  ready_for_live: 'Gotowy do realizacji',
  in_progress: 'W trakcie',
  completed: 'Zrealizowany',
  cancelled: 'Anulowany',
  invoiced: 'Zafakturowany',
  settled: 'Rozliczony',
};

export const STATUS_COLORS: Record<string, string> = {
  inquiry: '#3b82f6', // blue-500
  offer_to_send: '#6366f1', // indigo-500
  offer_sent: '#a855f7', // purple-500
  offer_accepted: '#22c55e', // green-500
  in_preparation: '#eab308', // yellow-500
  ready_for_live: '#10b981', // emerald-500
  in_progress: '#a855f7', // purple-500
  completed: '#22c55e', // green-500
  cancelled: '#ef4444', // red-500
  invoiced: '#d3bb73', // custom
  settled: '#10b981', // emerald-500
};

export default function EventsScreen({ onEventPress }: Props) {
  const { employee } = useAuth();
  const [events, setEvents] = useState<EventListItem[]>([]);
  const [filtered, setFiltered] = useState<EventListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [showPastEvents, setShowPastEvents] = useState(false);

  const fetchEvents = useCallback(
    async (isRefresh = false) => {
      if (!employee?.id) return;

      if (isRefresh) setRefreshing(true);
      else setIsLoading(true);

      try {
        const isAdmin = employee.role === 'admin';

        let eventIds: string[] | null = null;

        if (!isAdmin) {
          const { data: assignments, error: assignmentsError } = await supabase
            .from('employee_assignments')
            .select('event_id')
            .eq('employee_id', employee.id)
            .eq('status', 'accepted');

          if (assignmentsError) throw assignmentsError;

          const { data: created, error: createdError } = await supabase
            .from('events')
            .select('id')
            .eq('created_by', employee.id);

          if (createdError) throw createdError;

          const assignedIds = (assignments ?? [])
            .map((assignment) => assignment.event_id)
            .filter(Boolean);

          const createdIds = (created ?? []).map((event) => event.id).filter(Boolean);

          eventIds = [...new Set([...assignedIds, ...createdIds])];

          if (eventIds.length === 0) {
            setEvents([]);
            setFiltered([]);
            return;
          }
        }

        let query = supabase
          .from('events')
          .select(
            `
            id,
            name,
            event_date,
            event_end_date,
            status,
            created_by,
            event_categories(name, color),
            locations(name),
            organizations(name, alias),
            creator:employees!created_by(name, surname)
          `,
          )
          .order('event_date', { ascending: true })
          .limit(500);

        if (!isAdmin && eventIds) {
          query = query.in('id', eventIds);
        }

        const { data, error } = await query;

        if (error) throw error;

        const mapped: EventListItem[] = (data || []).map((event: any) => {
          const creator = event.creator;

          const creatorName = creator
            ? [creator.name, creator.surname].filter(Boolean).join(' ')
            : null;

          return {
            id: event.id,
            name: event.name,
            event_date: event.event_date,
            event_end_date: event.event_end_date,
            status: normalizeStatus(event.status),
            category_name: event.event_categories?.name ?? null,
            category_color: event.event_categories?.color ?? null,
            location_name: event.locations?.name ?? null,
            organization_name: event.organizations?.alias || event.organizations?.name || null,
            creator_name: creatorName,
          };
        });

        console.log('ROLE:', employee.role);
        console.log('IS ADMIN:', isAdmin);
        console.log('EVENTS COUNT:', mapped.length);

        setEvents(mapped);
      } catch (error) {
        console.error('Error fetching events:', error);
      } finally {
        setIsLoading(false);
        setRefreshing(false);
      }
    },
    [employee?.id, employee?.role],
  );

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  useEffect(() => {
    let result = [...events];

    if (!showPastEvents) {
      result = result.filter((event) => !isPastEvent(event));
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();

      result = result.filter(
        (event) =>
          event.name.toLowerCase().includes(q) ||
          event.organization_name?.toLowerCase().includes(q) ||
          event.location_name?.toLowerCase().includes(q),
      );
    }

    if (statusFilter) {
      result = result.filter((event) => event.status === statusFilter);
    }

    result.sort((a, b) => {
      const aPast = isPastEvent(a);
      const bPast = isPastEvent(b);

      if (aPast !== bPast) {
        return aPast ? 1 : -1;
      }

      if (!aPast && !bPast) {
        return getEventStartTimestamp(a) - getEventStartTimestamp(b);
      }

      return getEventStartTimestamp(b) - getEventStartTimestamp(a);
    });

    setFiltered(result);
  }, [events, search, statusFilter, showPastEvents]);

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('pl-PL', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const renderEvent = ({ item }: { item: EventListItem }) => (
    <TouchableOpacity
      style={styles.eventCard}
      onPress={() => onEventPress(item)}
      activeOpacity={0.7}
    >
      <View style={styles.eventHeader}>
        <View style={styles.eventCategoryDot}>
          {item.category_color && (
            <View style={[styles.dot, { backgroundColor: item.category_color }]} />
          )}
        </View>
        <View style={styles.eventInfo}>
          <Text style={styles.eventName} numberOfLines={1}>
            {item.name}
          </Text>
          {item.organization_name && (
            <Text style={styles.eventOrg} numberOfLines={1}>
              {item.organization_name}
            </Text>
          )}
        </View>
        <View
          style={[
            styles.statusBadge,
            { backgroundColor: (STATUS_COLORS[item.status] || '#6b7280') + '20' },
          ]}
        >
          <Text style={[styles.statusText, { color: STATUS_COLORS[item.status] || '#6b7280' }]}>
            {STATUS_LABELS[item.status] || item.status}
          </Text>
        </View>
      </View>
      <View style={styles.eventMeta}>
        <Feather name="calendar" size={12} color={colors.text.tertiary} />
        <Text style={styles.eventDate}>{formatDate(item.event_date)}</Text>
        {item.location_name && (
          <>
            <Feather
              name="map-pin"
              size={12}
              color={colors.text.tertiary}
              style={{ marginLeft: 12 }}
            />
            <Text style={styles.eventLocation} numberOfLines={1}>
              {item.location_name}
            </Text>
          </>
        )}
      </View>
      {item.creator_name && (
        <View style={styles.eventMeta}>
          <Feather name="user" size={12} color={colors.text.tertiary} />
          <Text style={styles.eventCreator} numberOfLines={1}>
            {item.creator_name}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );

  const statusFilters = [
    { key: null, label: 'Wszystkie' },
    { key: 'inquiry', label: 'Zapytania' },
    { key: 'offer_to_send', label: 'Do wysłania' },
    { key: 'offer_sent', label: 'Wysłane' },
    { key: 'offer_accepted', label: 'Zaakceptowane' },
    { key: 'in_preparation', label: 'W przygotowaniu' },
    { key: 'ready_for_live', label: 'Gotowe' },
    { key: 'in_progress', label: 'W trakcie' },
    { key: 'completed', label: 'Zrealizowane' },
    { key: 'invoiced', label: 'Zafakturowane' },
    { key: 'settled', label: 'Rozliczone' },
    { key: 'cancelled', label: 'Anulowane' },
  ];

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary.gold} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Search */}
      <View style={styles.searchContainer}>
        <Feather name="search" size={16} color={colors.text.tertiary} />
        <TextInput
          style={styles.searchInput}
          placeholder="Szukaj wydarzeń..."
          placeholderTextColor={colors.text.tertiary}
          value={search}
          onChangeText={setSearch}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Feather name="x" size={16} color={colors.text.tertiary} />
          </TouchableOpacity>
        )}
      </View>

      {/* Status filters */}
      <View style={styles.filtersRow}>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={statusFilters}
          keyExtractor={(item) => item.key || 'all'}
          renderItem={({ item: f }) => (
            <TouchableOpacity
              style={[styles.filterChip, statusFilter === f.key && styles.filterChipActive]}
              onPress={() => setStatusFilter(f.key)}
            >
              <Text
                style={[
                  styles.filterChipText,
                  statusFilter === f.key && styles.filterChipTextActive,
                ]}
              >
                {f.label}
              </Text>
            </TouchableOpacity>
          )}
        />
      </View>
      <View style={styles.pastEventsToggle}>
        <View style={styles.pastEventsToggleText}>
          <Feather
            name="clock"
            size={16}
            color={showPastEvents ? colors.primary.gold : colors.text.tertiary}
          />

          <View>
            <Text style={styles.pastEventsToggleTitle}>Pokaż przeszłe wydarzenia</Text>

            <Text style={styles.pastEventsToggleDescription}>
              {showPastEvents
                ? 'Przeszłe wydarzenia są widoczne na końcu listy'
                : 'Lista pokazuje tylko wydarzenia aktualne i nadchodzące'}
            </Text>
          </View>
        </View>

        <Switch
          value={showPastEvents}
          onValueChange={setShowPastEvents}
          trackColor={{
            false: colors.background.secondary,
            true: `${colors.primary.gold}55`,
          }}
          thumbColor={showPastEvents ? colors.primary.gold : colors.text.tertiary}
        />
      </View>

      {/* Events list */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={renderEvent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => fetchEvents(true)}
            tintColor={colors.primary.gold}
          />
        }
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Feather name="calendar" size={48} color={colors.text.tertiary} />
            <Text style={styles.emptyText}>Brak wydarzeń</Text>
          </View>
        }
      />
    </View>
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
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background.secondary,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: colors.text.primary,
    padding: 0,
  },
  filtersRow: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: colors.background.secondary,
    marginRight: 8,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  filterChipActive: {
    backgroundColor: colors.primary.gold + '20',
    borderColor: colors.primary.gold,
  },
  filterChipText: {
    fontSize: 12,
    color: colors.text.secondary,
    fontWeight: '500',
  },
  filterChipTextActive: {
    color: colors.primary.gold,
    fontWeight: '600',
  },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: 20,
  },
  eventCard: {
    backgroundColor: colors.background.secondary,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  eventHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  eventCategoryDot: {
    width: 16,
    alignItems: 'center',
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  eventInfo: {
    flex: 1,
  },
  eventName: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text.primary,
  },
  eventOrg: {
    fontSize: 12,
    color: colors.text.secondary,
    marginTop: 1,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  eventMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 4,
  },
  eventDate: {
    fontSize: 11,
    color: colors.text.tertiary,
    marginLeft: 2,
  },
  eventLocation: {
    fontSize: 11,
    color: colors.text.tertiary,
    marginLeft: 2,
    flex: 1,
  },
  eventCreator: {
    fontSize: 11,
    color: colors.text.tertiary,
    marginLeft: 2,
    flex: 1,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 12,
  },
  emptyText: {
    fontSize: 14,
    color: colors.text.tertiary,
  },

  pastEventsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border.default,
    backgroundColor: colors.background.secondary,
    gap: 12,
  },

  pastEventsToggleText: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingRight: 16,
  },

  pastEventsToggleTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text.primary,
  },

  pastEventsToggleDescription: {
    marginTop: 2,
    fontSize: 10,
    lineHeight: 14,
    color: colors.text.tertiary,
  },
});
