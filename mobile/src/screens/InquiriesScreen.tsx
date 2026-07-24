import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, typography } from '../theme';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

type InquiriesStackParamList = {
  InquiriesList: undefined;
  InquiryDetail: { taskId: string };
};

type NavigationProp = NativeStackNavigationProp<InquiriesStackParamList, 'InquiriesList'>;

interface Inquiry {
  id: string;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  board_column: string;
  due_date: string | null;
  created_at: string;
  inquiry_details: {
    termin?: string | null;
    location_text?: string | null;
    scope?: string | null;
    budget?: string | null;
    client_text?: string | null;
    client_phone?: string | null;
    client_email?: string | null;
  } | null;
}

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  todo: { label: 'Do zrobienia', color: '#eab308' },
  in_progress: { label: 'W trakcie', color: '#3b82f6' },
  review: { label: 'Do sprawdzenia', color: '#a855f7' },
  completed: { label: 'Zrealizowane', color: '#10b981' },
};

export default function InquiriesScreen() {
  const { employee } = useAuth();
  const navigation = useNavigation<NavigationProp>();
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');

  const fetchInquiries = useCallback(async () => {
    if (!employee?.id) return;
    setIsLoading(true);

    try {
      let query = supabase
        .from('tasks')
        .select('id, title, description, priority, status, board_column, due_date, created_at, inquiry_details')
        .eq('is_inquiry', true)
        .order('created_at', { ascending: false });

      if (filter === 'pending') {
        query = query.neq('board_column', 'completed');
      }

      const { data, error } = await query;
      if (error) throw error;
      setInquiries(data || []);
    } catch (error) {
      console.error('Error fetching inquiries:', error);
    } finally {
      setIsLoading(false);
    }
  }, [employee?.id, filter]);

  useEffect(() => {
    fetchInquiries();
  }, [fetchInquiries]);

  useEffect(() => {
    if (!employee?.id) return;
    const channel = supabase
      .channel('inquiries_realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tasks', filter: 'is_inquiry=eq.true' },
        () => { fetchInquiries(); }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [employee?.id, fetchInquiries]);

  const getDaysAgo = (dateStr: string) => {
    const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
    if (diff === 0) return 'dzisiaj';
    if (diff === 1) return 'wczoraj';
    return `${diff} dni temu`;
  };

  const renderInquiry = ({ item }: { item: Inquiry }) => {
    const statusCfg = STATUS_CONFIG[item.board_column] || STATUS_CONFIG.todo;
    const details = item.inquiry_details;
    const isOverdue = item.due_date && new Date(item.due_date) < new Date() && item.board_column !== 'completed';

    return (
      <TouchableOpacity
        style={[styles.card, isOverdue && styles.cardOverdue]}
        activeOpacity={0.7}
        onPress={() => navigation.navigate('InquiryDetail', { taskId: item.id })}
      >
        <View style={styles.cardHeader}>
          <View style={[styles.priorityDot, { backgroundColor: '#ef4444' }]} />
          <Text style={styles.cardTitle} numberOfLines={1}>{item.title.replace('Zapytanie: ', '')}</Text>
          {isOverdue && (
            <View style={styles.overdueBadge}>
              <Feather name="alert-circle" size={12} color="#ef4444" />
            </View>
          )}
        </View>

        <View style={styles.cardDetails}>
          {details?.client_phone && (
            <View style={styles.detailRow}>
              <Feather name="phone" size={12} color={colors.text.tertiary} />
              <Text style={styles.detailText}>{details.client_phone}</Text>
            </View>
          )}
          {details?.location_text && (
            <View style={styles.detailRow}>
              <Feather name="map-pin" size={12} color={colors.text.tertiary} />
              <Text style={styles.detailText}>{details.location_text}</Text>
            </View>
          )}
          {details?.scope && (
            <View style={styles.detailRow}>
              <Feather name="briefcase" size={12} color={colors.text.tertiary} />
              <Text style={styles.detailText} numberOfLines={1}>{details.scope}</Text>
            </View>
          )}
          {item.due_date && (
            <View style={styles.detailRow}>
              <Feather name="calendar" size={12} color={isOverdue ? '#ef4444' : colors.text.tertiary} />
              <Text style={[styles.detailText, isOverdue && { color: '#ef4444' }]}>
                {new Date(item.due_date).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short', year: 'numeric' })}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.cardFooter}>
          <View style={[styles.statusBadge, { backgroundColor: statusCfg.color + '20' }]}>
            <Text style={[styles.statusText, { color: statusCfg.color }]}>{statusCfg.label}</Text>
          </View>
          <Text style={styles.timeAgo}>{getDaysAgo(item.created_at)}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.filterRow}>
        <TouchableOpacity
          style={[styles.filterBtn, filter === 'pending' && styles.filterBtnActive]}
          onPress={() => setFilter('pending')}
        >
          <Text style={[styles.filterText, filter === 'pending' && styles.filterTextActive]}>
            Oczekujące
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterBtn, filter === 'all' && styles.filterBtnActive]}
          onPress={() => setFilter('all')}
        >
          <Text style={[styles.filterText, filter === 'all' && styles.filterTextActive]}>
            Wszystkie
          </Text>
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={colors.primary.gold} />
        </View>
      ) : inquiries.length === 0 ? (
        <View style={styles.emptyState}>
          <Feather name="inbox" size={48} color={colors.text.tertiary} />
          <Text style={styles.emptyTitle}>Brak zapytań</Text>
          <Text style={styles.emptySubtitle}>
            {filter === 'pending' ? 'Wszystkie zapytania zostały obsłużone' : 'Nie ma jeszcze żadnych zapytań'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={inquiries}
          keyExtractor={(item) => item.id}
          renderItem={renderInquiry}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={isLoading} onRefresh={fetchInquiries} tintColor={colors.primary.gold} />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
  },
  filterBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 20,
    backgroundColor: colors.background.secondary,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  filterBtnActive: {
    backgroundColor: colors.primary.gold + '20',
    borderColor: colors.primary.gold,
  },
  filterText: {
    fontSize: typography.fontSizes.sm,
    color: colors.text.secondary,
    fontWeight: '500',
  },
  filterTextActive: {
    color: colors.primary.gold,
    fontWeight: '600',
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
  },
  card: {
    backgroundColor: colors.background.secondary,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  cardOverdue: {
    borderColor: '#ef4444' + '60',
    borderLeftWidth: 3,
    borderLeftColor: '#ef4444',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  priorityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  cardTitle: {
    flex: 1,
    fontSize: typography.fontSizes.md,
    fontWeight: '600',
    color: colors.text.primary,
  },
  overdueBadge: {
    padding: 4,
  },
  cardDetails: {
    gap: 4,
    marginBottom: spacing.sm,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  detailText: {
    fontSize: typography.fontSizes.xs,
    color: colors.text.tertiary,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  timeAgo: {
    fontSize: typography.fontSizes.xs,
    color: colors.text.tertiary,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  emptyTitle: {
    fontSize: typography.fontSizes.lg,
    fontWeight: '700',
    color: colors.text.primary,
    marginTop: spacing.md,
  },
  emptySubtitle: {
    fontSize: typography.fontSizes.sm,
    color: colors.text.tertiary,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
});
