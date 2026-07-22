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
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing } from '../theme';
import { supabase } from '../lib/supabase';

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
}

interface Props {
  onEventPress: (event: EventListItem) => void;
}

const STATUS_LABELS: Record<string, string> = {
  inquiry: 'Zapytanie',
  negotiation: 'Negocjacje',
  confirmed: 'Potwierdzone',
  in_preparation: 'W przygotowaniu',
  ready: 'Gotowe',
  in_progress: 'W trakcie',
  completed: 'Zakończone',
  cancelled: 'Anulowane',
  settled: 'Rozliczone',
};

const STATUS_COLORS: Record<string, string> = {
  inquiry: '#a78bfa',
  negotiation: '#fbbf24',
  confirmed: '#34d399',
  in_preparation: '#60a5fa',
  ready: '#22c55e',
  in_progress: '#3b82f6',
  completed: '#6b7280',
  cancelled: '#ef4444',
  settled: '#10b981',
};

export default function EventsScreen({ onEventPress }: Props) {
  const [events, setEvents] = useState<EventListItem[]>([]);
  const [filtered, setFiltered] = useState<EventListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  const fetchEvents = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setIsLoading(true);

    try {
      const { data, error } = await supabase
        .from('events')
        .select(`
          id, name, event_date, event_end_date, status,
          event_categories(name, color),
          locations(name),
          organizations(name, alias)
        `)
        .order('event_date', { ascending: false })
        .limit(100);

      if (error) throw error;

      const mapped: EventListItem[] = (data || []).map((e: any) => ({
        id: e.id,
        name: e.name,
        event_date: e.event_date,
        event_end_date: e.event_end_date,
        status: e.status,
        category_name: e.event_categories?.name ?? null,
        category_color: e.event_categories?.color ?? null,
        location_name: e.locations?.name ?? null,
        organization_name: e.organizations?.alias || e.organizations?.name || null,
      }));

      setEvents(mapped);
    } catch (error) {
      console.error('Error fetching events:', error);
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  useEffect(() => {
    let result = events;

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.organization_name?.toLowerCase().includes(q) ||
          e.location_name?.toLowerCase().includes(q)
      );
    }

    if (statusFilter) {
      result = result.filter((e) => e.status === statusFilter);
    }

    setFiltered(result);
  }, [events, search, statusFilter]);

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
          <Text
            style={[
              styles.statusText,
              { color: STATUS_COLORS[item.status] || '#6b7280' },
            ]}
          >
            {STATUS_LABELS[item.status] || item.status}
          </Text>
        </View>
      </View>
      <View style={styles.eventMeta}>
        <Feather name="calendar" size={12} color={colors.text.tertiary} />
        <Text style={styles.eventDate}>{formatDate(item.event_date)}</Text>
        {item.location_name && (
          <>
            <Feather name="map-pin" size={12} color={colors.text.tertiary} style={{ marginLeft: 12 }} />
            <Text style={styles.eventLocation} numberOfLines={1}>
              {item.location_name}
            </Text>
          </>
        )}
      </View>
    </TouchableOpacity>
  );

  const statusFilters = [
    { key: null, label: 'Wszystkie' },
    { key: 'confirmed', label: 'Potwierdzone' },
    { key: 'in_preparation', label: 'W przygotowaniu' },
    { key: 'in_progress', label: 'W trakcie' },
    { key: 'completed', label: 'Zakończone' },
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
              style={[
                styles.filterChip,
                statusFilter === f.key && styles.filterChipActive,
              ]}
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
});
