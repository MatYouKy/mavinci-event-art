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
  Linking,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, typography, borderRadius } from '../theme';
import { supabase, Employee } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { isAdmin, canManage } from '../lib/permissions';
import PermissionGate from '../components/PermissionGate';
import EmployeeAvatar from '../components/EmployeeAvatar';

interface EmployeeListItem extends Employee {
  is_active?: boolean;
  occupation?: string | null;
  region?: string | null;
}

function EmployeesContent() {
  const { employee: currentEmployee } = useAuth();
  const [employees, setEmployees] = useState<EmployeeListItem[]>([]);
  const [filtered, setFiltered] = useState<EmployeeListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedFilter, setSelectedFilter] = useState<'all' | 'active' | 'admin'>('all');

  const fetchEmployees = useCallback(async () => {
    const { data, error } = await supabase
      .from('employees')
      .select('*')
      .order('name', { ascending: true });

    if (!error && data) {
      setEmployees(data);
    }
  }, []);

  const loadAll = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setIsLoading(true);
      try {
        await fetchEmployees();
      } finally {
        setIsLoading(false);
        setRefreshing(false);
      }
    },
    [fetchEmployees]
  );

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    let result = employees;

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (e) =>
          e.name?.toLowerCase().includes(q) ||
          e.surname?.toLowerCase().includes(q) ||
          e.nickname?.toLowerCase().includes(q) ||
          e.email?.toLowerCase().includes(q) ||
          e.role?.toLowerCase().includes(q)
      );
    }

    if (selectedFilter === 'active') {
      result = result.filter((e) => e.is_active !== false);
    } else if (selectedFilter === 'admin') {
      result = result.filter((e) => e.access_level === 'admin' || e.role === 'admin');
    }

    setFiltered(result);
  }, [employees, search, selectedFilter]);

  const getAccessBadge = (emp: EmployeeListItem) => {
    if (emp.access_level === 'admin' || emp.role === 'admin') {
      return { label: 'Admin', color: colors.primary.gold };
    }
    if (emp.access_level === 'manager') {
      return { label: 'Manager', color: '#3B82F6' };
    }
    return { label: 'Pracownik', color: colors.text.tertiary };
  };

  const handleCall = (phone: string) => {
    Linking.openURL(`tel:${phone}`);
  };

  const handleEmail = (email: string) => {
    Linking.openURL(`mailto:${email}`);
  };

  const renderEmployee = ({ item }: { item: EmployeeListItem }) => {
    const badge = getAccessBadge(item);
    const fullName = [item.name, item.surname].filter(Boolean).join(' ');
    const displayName = item.nickname || fullName;
    const isCurrentUser = item.id === currentEmployee?.id;

    return (
      <View style={[styles.card, isCurrentUser && styles.cardCurrentUser]}>
        <View style={styles.cardHeader}>
          <EmployeeAvatar
            avatarUrl={item.avatar_url}
            avatarMetadata={item.avatar_metadata}
            employeeName={displayName}
            size={52}
          />
          <View style={styles.cardInfo}>
            <View style={styles.nameRow}>
              <Text style={styles.employeeName} numberOfLines={1}>
                {displayName}
              </Text>
              {isCurrentUser && (
                <View style={styles.youBadge}>
                  <Text style={styles.youBadgeText}>Ty</Text>
                </View>
              )}
            </View>
            {item.nickname && fullName !== item.nickname && (
              <Text style={styles.fullNameSubtitle} numberOfLines={1}>
                {fullName}
              </Text>
            )}
            <Text style={styles.employeeRole} numberOfLines={1}>
              {item.occupation || item.role || 'Brak stanowiska'}
            </Text>
            <View style={styles.badgeRow}>
              <View style={[styles.accessBadge, { borderColor: badge.color + '60' }]}>
                <Text style={[styles.accessBadgeText, { color: badge.color }]}>
                  {badge.label}
                </Text>
              </View>
              {item.is_active === false && (
                <View style={[styles.accessBadge, { borderColor: colors.status.error + '60' }]}>
                  <Text style={[styles.accessBadgeText, { color: colors.status.error }]}>
                    Nieaktywny
                  </Text>
                </View>
              )}
            </View>
          </View>
        </View>

        {/* Contact actions */}
        <View style={styles.contactRow}>
          {item.email && (
            <TouchableOpacity
              style={styles.contactButton}
              onPress={() => handleEmail(item.email)}
            >
              <Feather name="mail" size={14} color={colors.primary.gold} />
              <Text style={styles.contactText} numberOfLines={1}>
                {item.email}
              </Text>
            </TouchableOpacity>
          )}
          {item.phone && (
            <TouchableOpacity
              style={styles.contactButton}
              onPress={() => handleCall(item.phone!)}
            >
              <Feather name="phone" size={14} color={colors.status.success} />
              <Text style={styles.contactText} numberOfLines={1}>
                {item.phone}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Permissions summary (visible only to admins/managers) */}
        {canManage(currentEmployee, 'employees') && item.permissions && item.permissions.length > 0 && (
          <View style={styles.permissionsRow}>
            <Feather name="key" size={12} color={colors.text.tertiary} />
            <Text style={styles.permissionsText} numberOfLines={1}>
              {item.permissions.length} uprawnień
            </Text>
          </View>
        )}
      </View>
    );
  };

  const filters: { key: typeof selectedFilter; label: string }[] = [
    { key: 'all', label: 'Wszyscy' },
    { key: 'active', label: 'Aktywni' },
    { key: 'admin', label: 'Admini' },
  ];

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary.gold} />
        <Text style={styles.loadingText}>Ładowanie pracowników...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Search */}
      <View style={styles.searchContainer}>
        <Feather name="search" size={18} color={colors.text.tertiary} />
        <TextInput
          style={styles.searchInput}
          placeholder="Szukaj pracownika..."
          placeholderTextColor={colors.text.tertiary}
          value={search}
          onChangeText={setSearch}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Feather name="x" size={18} color={colors.text.tertiary} />
          </TouchableOpacity>
        )}
      </View>

      {/* Filter chips */}
      <View style={styles.filterRow}>
        {filters.map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[styles.filterChip, selectedFilter === f.key && styles.filterChipActive]}
            onPress={() => setSelectedFilter(f.key)}
          >
            <Text
              style={[
                styles.filterChipText,
                selectedFilter === f.key && styles.filterChipTextActive,
              ]}
            >
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
        <View style={styles.countBadge}>
          <Text style={styles.countText}>{filtered.length}</Text>
        </View>
      </View>

      {/* List */}
      <FlatList
        data={filtered}
        renderItem={renderEmployee}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadAll(true)}
            tintColor={colors.primary.gold}
            colors={[colors.primary.gold]}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Feather name="users" size={48} color={colors.text.tertiary} />
            <Text style={styles.emptyTitle}>Brak pracowników</Text>
            <Text style={styles.emptySubtitle}>
              {search ? 'Nie znaleziono pasujących wyników' : 'Lista pracowników jest pusta'}
            </Text>
          </View>
        }
      />
    </View>
  );
}

export default function EmployeesScreen() {
  return (
    <PermissionGate module="employees">
      <EmployeesContent />
    </PermissionGate>
  );
}

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
  loadingText: {
    marginTop: spacing.md,
    fontSize: typography.fontSizes.sm,
    color: colors.text.tertiary,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background.secondary,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    height: 44,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  searchInput: {
    flex: 1,
    marginLeft: spacing.sm,
    fontSize: typography.fontSizes.md,
    color: colors.text.primary,
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  filterChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    backgroundColor: colors.background.secondary,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  filterChipActive: {
    backgroundColor: colors.primary.gold + '20',
    borderColor: colors.primary.gold,
  },
  filterChipText: {
    fontSize: typography.fontSizes.xs,
    fontWeight: typography.fontWeights.medium as any,
    color: colors.text.secondary,
  },
  filterChipTextActive: {
    color: colors.primary.gold,
  },
  countBadge: {
    marginLeft: 'auto',
    backgroundColor: colors.background.tertiary,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  countText: {
    fontSize: typography.fontSizes.xs,
    fontWeight: typography.fontWeights.bold as any,
    color: colors.text.secondary,
  },
  listContent: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
  },
  card: {
    backgroundColor: colors.background.secondary,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  cardCurrentUser: {
    borderColor: colors.primary.gold + '40',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  cardInfo: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  employeeName: {
    fontSize: typography.fontSizes.md,
    fontWeight: typography.fontWeights.bold as any,
    color: colors.text.primary,
    flexShrink: 1,
  },
  youBadge: {
    backgroundColor: colors.primary.gold + '30',
    borderRadius: borderRadius.sm,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  youBadgeText: {
    fontSize: 10,
    fontWeight: typography.fontWeights.bold as any,
    color: colors.primary.gold,
  },
  fullNameSubtitle: {
    fontSize: typography.fontSizes.xs,
    color: colors.text.tertiary,
    marginTop: 1,
  },
  employeeRole: {
    fontSize: typography.fontSizes.sm,
    color: colors.text.secondary,
    marginTop: 2,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  accessBadge: {
    borderWidth: 1,
    borderRadius: borderRadius.sm,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  accessBadgeText: {
    fontSize: 10,
    fontWeight: typography.fontWeights.semibold as any,
  },
  contactRow: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border.default,
    gap: spacing.xs,
  },
  contactButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: 2,
  },
  contactText: {
    fontSize: typography.fontSizes.xs,
    color: colors.text.secondary,
    flex: 1,
  },
  permissionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border.default,
  },
  permissionsText: {
    fontSize: typography.fontSizes.xs,
    color: colors.text.tertiary,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl * 2,
  },
  emptyTitle: {
    fontSize: typography.fontSizes.lg,
    fontWeight: typography.fontWeights.bold as any,
    color: colors.text.primary,
    marginTop: spacing.md,
  },
  emptySubtitle: {
    fontSize: typography.fontSizes.sm,
    color: colors.text.tertiary,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
});
