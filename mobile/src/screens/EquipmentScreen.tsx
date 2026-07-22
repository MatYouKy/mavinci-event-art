import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  Image,
  ScrollView,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing } from '../theme';
import { supabase } from '../lib/supabase';

interface WarehouseCategory {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  level: number;
  parent_id: string | null;
}

export interface EquipmentListItem {
  id: string;
  name: string;
  brand: string | null;
  model: string | null;
  thumbnail_url: string | null;
  warehouse_category_id: string | null;
  category_name?: string;
  category_color?: string;
  is_kit?: boolean;
  unit_count: number;
  available_count: number;
}

interface Props {
  onItemPress?: (item: EquipmentListItem) => void;
}

const ICON_MAP: Record<string, string> = {
  'volume-2': 'volume-2',
  lightbulb: 'sun',
  video: 'video',
  layers: 'layers',
  sparkles: 'zap',
  package: 'package',
  wrench: 'tool',
  warehouse: 'home',
};

export default function EquipmentScreen({ onItemPress }: Props) {
  const [items, setItems] = useState<EquipmentListItem[]>([]);
  const [categories, setCategories] = useState<WarehouseCategory[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setIsLoading(true);

    try {
      // Fetch all categories (for filter chips)
      const { data: catsData } = await supabase
        .from('warehouse_categories')
        .select('id, name, icon, color, level, parent_id')
        .eq('is_active', true)
        .gte('level', 2)
        .order('order_index')
        .order('name');

      setCategories(catsData ?? []);

      // Fetch all equipment items
      const { data: itemsData } = await supabase
        .from('equipment_items')
        .select(`
          id, name, brand, model, thumbnail_url, warehouse_category_id,
          warehouse_categories ( name, color )
        `)
        .eq('is_active', true)
        .order('name')
        .limit(500);

      // Fetch all kits
      const { data: kitsData } = await supabase
        .from('equipment_kits')
        .select(`
          id, name, thumbnail_url, warehouse_category_id,
          warehouse_categories ( name, color )
        `)
        .eq('is_active', true)
        .order('name');

      // Fetch unit counts for all items
      const allItemIds = (itemsData ?? []).map((i: any) => i.id);
      let unitCounts: Record<string, { total: number; available: number }> = {};

      if (allItemIds.length > 0) {
        const { data: units } = await supabase
          .from('equipment_units')
          .select('equipment_id, status')
          .in('equipment_id', allItemIds);

        if (units) {
          for (const unit of units) {
            if (!unitCounts[unit.equipment_id]) {
              unitCounts[unit.equipment_id] = { total: 0, available: 0 };
            }
            unitCounts[unit.equipment_id].total++;
            if (unit.status === 'available') {
              unitCounts[unit.equipment_id].available++;
            }
          }
        }
      }

      const mappedItems: EquipmentListItem[] = (itemsData ?? []).map((item: any) => ({
        id: item.id,
        name: item.name,
        brand: item.brand,
        model: item.model,
        thumbnail_url: item.thumbnail_url,
        warehouse_category_id: item.warehouse_category_id,
        category_name: item.warehouse_categories?.name ?? null,
        category_color: item.warehouse_categories?.color ?? null,
        is_kit: false,
        unit_count: unitCounts[item.id]?.total ?? 0,
        available_count: unitCounts[item.id]?.available ?? 0,
      }));

      const mappedKits: EquipmentListItem[] = (kitsData ?? []).map((kit: any) => ({
        id: kit.id,
        name: kit.name,
        brand: null,
        model: null,
        thumbnail_url: kit.thumbnail_url,
        warehouse_category_id: kit.warehouse_category_id,
        category_name: kit.warehouse_categories?.name ?? null,
        category_color: kit.warehouse_categories?.color ?? null,
        is_kit: true,
        unit_count: 0,
        available_count: 0,
      }));

      setItems([...mappedKits, ...mappedItems]);
    } catch (error) {
      console.error('Error fetching equipment:', error);
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filteredItems = useMemo(() => {
    let result = items;

    if (selectedCategoryId) {
      result = result.filter((i) => i.warehouse_category_id === selectedCategoryId);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          (i.brand && i.brand.toLowerCase().includes(q)) ||
          (i.model && i.model.toLowerCase().includes(q))
      );
    }

    return result;
  }, [items, selectedCategoryId, searchQuery]);

  const handleItemPress = (item: EquipmentListItem) => {
    if (onItemPress) onItemPress(item);
  };

  const renderCategoryChip = (cat: WarehouseCategory) => {
    const isSelected = selectedCategoryId === cat.id;
    return (
      <TouchableOpacity
        key={cat.id}
        style={[styles.chip, isSelected && styles.chipActive]}
        onPress={() => setSelectedCategoryId(isSelected ? null : cat.id)}
        activeOpacity={0.7}
      >
        <Text
          style={[styles.chipText, isSelected && styles.chipTextActive]}
          numberOfLines={1}
        >
          {cat.name}
        </Text>
      </TouchableOpacity>
    );
  };

  const renderItem = ({ item }: { item: EquipmentListItem }) => (
    <TouchableOpacity
      style={styles.itemCard}
      onPress={() => handleItemPress(item)}
      activeOpacity={0.7}
    >
      {item.thumbnail_url ? (
        <Image source={{ uri: item.thumbnail_url }} style={styles.itemImage} />
      ) : (
        <View style={[styles.itemImagePlaceholder, item.is_kit && styles.kitPlaceholder]}>
          <Feather
            name={item.is_kit ? 'archive' : 'package'}
            size={20}
            color={item.is_kit ? colors.primary.gold : colors.text.tertiary}
          />
        </View>
      )}
      <View style={styles.itemInfo}>
        <View style={styles.itemNameRow}>
          {item.is_kit && (
            <View style={styles.kitBadge}>
              <Text style={styles.kitBadgeText}>KIT</Text>
            </View>
          )}
          <Text style={styles.itemName} numberOfLines={1}>
            {item.name}
          </Text>
        </View>
        {(item.brand || item.model) && (
          <Text style={styles.itemSubtitle} numberOfLines={1}>
            {[item.brand, item.model].filter(Boolean).join(' ')}
          </Text>
        )}
        <View style={styles.itemFooter}>
          {item.category_name && (
            <View style={styles.categoryTag}>
              <View
                style={[styles.categoryDot, { backgroundColor: item.category_color || colors.primary.gold }]}
              />
              <Text style={styles.categoryTagText} numberOfLines={1}>
                {item.category_name}
              </Text>
            </View>
          )}
          {!item.is_kit && item.unit_count > 0 && (
            <View style={styles.availabilityBadge}>
              <View
                style={[
                  styles.availDot,
                  { backgroundColor: item.available_count > 0 ? colors.status.success : colors.status.error },
                ]}
              />
              <Text style={styles.availText}>
                {item.available_count}/{item.unit_count}
              </Text>
            </View>
          )}
        </View>
      </View>
      <Feather name="chevron-right" size={16} color={colors.text.tertiary} />
    </TouchableOpacity>
  );

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
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
          placeholder="Szukaj sprzętu..."
          placeholderTextColor={colors.text.tertiary}
          value={searchQuery}
          onChangeText={setSearchQuery}
          returnKeyType="search"
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <Feather name="x" size={16} color={colors.text.tertiary} />
          </TouchableOpacity>
        )}
      </View>

      {/* Category filter chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipsContainer}
        contentContainerStyle={styles.chipsContent}
      >
        <TouchableOpacity
          style={[styles.chip, !selectedCategoryId && styles.chipActive]}
          onPress={() => setSelectedCategoryId(null)}
          activeOpacity={0.7}
        >
          <Text style={[styles.chipText, !selectedCategoryId && styles.chipTextActive]}>
            Wszystko
          </Text>
        </TouchableOpacity>
        {categories.map(renderCategoryChip)}
      </ScrollView>

      {/* Results count */}
      <View style={styles.resultsBar}>
        <Text style={styles.resultsText}>
          {filteredItems.length} {filteredItems.length === 1 ? 'element' : 'elementów'}
        </Text>
      </View>

      {/* Items list */}
      <FlatList
        data={filteredItems}
        keyExtractor={(item) => `${item.is_kit ? 'kit' : 'eq'}-${item.id}`}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => fetchData(true)}
            tintColor={colors.primary.gold}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Feather name="inbox" size={48} color={colors.text.tertiary} />
            <Text style={styles.emptyText}>Brak wyników</Text>
            <Text style={styles.emptySubtext}>
              {searchQuery
                ? `Nie znaleziono "${searchQuery}"`
                : 'Brak sprzętu w tej kategorii'}
            </Text>
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
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background.primary,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
    backgroundColor: colors.background.secondary,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  searchInput: {
    flex: 1,
    color: colors.text.primary,
    fontSize: 14,
  },
  chipsContainer: {
    maxHeight: 44,
  },
  chipsContent: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    gap: 8,
    flexDirection: 'row',
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: colors.background.secondary,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  chipActive: {
    backgroundColor: colors.primary.gold + '20',
    borderColor: colors.primary.gold,
  },
  chipText: {
    fontSize: 12,
    color: colors.text.secondary,
    fontWeight: '500',
  },
  chipTextActive: {
    color: colors.primary.gold,
    fontWeight: '600',
  },
  resultsBar: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  resultsText: {
    fontSize: 11,
    color: colors.text.tertiary,
  },
  list: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
  },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background.secondary,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  itemImage: {
    width: 50,
    height: 50,
    borderRadius: 8,
    backgroundColor: colors.background.tertiary,
  },
  itemImagePlaceholder: {
    width: 50,
    height: 50,
    borderRadius: 8,
    backgroundColor: colors.background.tertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kitPlaceholder: {
    backgroundColor: colors.primary.gold + '15',
  },
  itemInfo: {
    flex: 1,
    marginLeft: 12,
  },
  itemNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  kitBadge: {
    backgroundColor: colors.primary.gold,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
  },
  kitBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: colors.background.primary,
    letterSpacing: 0.5,
  },
  itemName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text.primary,
    flex: 1,
  },
  itemSubtitle: {
    fontSize: 12,
    color: colors.text.secondary,
    marginTop: 2,
  },
  itemFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 10,
  },
  categoryTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  categoryDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  categoryTagText: {
    fontSize: 11,
    color: colors.text.tertiary,
    maxWidth: 120,
  },
  availabilityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  availDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  availText: {
    fontSize: 11,
    color: colors.text.tertiary,
  },
  emptyState: {
    alignItems: 'center',
    paddingTop: 80,
    gap: spacing.sm,
  },
  emptyText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text.secondary,
  },
  emptySubtext: {
    fontSize: 13,
    color: colors.text.tertiary,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
  },
});
