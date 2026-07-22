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
  Image,
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
  is_active: boolean;
}

interface EquipmentItem {
  id: string;
  name: string;
  brand: string | null;
  model: string | null;
  description: string | null;
  thumbnail_url: string | null;
  warehouse_category_id: string | null;
  is_active: boolean;
  is_kit?: boolean;
  unit_count?: number;
  available_count?: number;
}

type ViewMode = 'categories' | 'items';

const ICON_MAP: Record<string, string> = {
  'volume-2': 'volume-2',
  'lightbulb': 'sun',
  'video': 'video',
  'layers': 'layers',
  'sparkles': 'zap',
  'package': 'package',
  'wrench': 'tool',
  'warehouse': 'home',
};

function getFeatherIcon(icon: string | null): string {
  if (!icon) return 'box';
  return ICON_MAP[icon] || 'box';
}

export default function EquipmentScreen() {
  const [viewMode, setViewMode] = useState<ViewMode>('categories');
  const [categories, setCategories] = useState<WarehouseCategory[]>([]);
  const [items, setItems] = useState<EquipmentItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<WarehouseCategory | null>(null);
  const [parentStack, setParentStack] = useState<WarehouseCategory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [itemCounts, setItemCounts] = useState<Record<string, number>>({});

  const fetchCategories = useCallback(async (parentId: string | null = null) => {
    setIsLoading(true);
    try {
      let query = supabase
        .from('warehouse_categories')
        .select('id, name, icon, color, level, parent_id, is_active')
        .eq('is_active', true)
        .order('order_index')
        .order('name');

      if (parentId) {
        query = query.eq('parent_id', parentId);
      } else {
        query = query.is('parent_id', null);
      }

      const { data, error } = await query;
      if (error) throw error;

      const cats = data ?? [];
      setCategories(cats);

      // Fetch item counts for each category (including nested)
      const counts: Record<string, number> = {};
      await Promise.all(
        cats.map(async (cat) => {
          const { count } = await supabase
            .from('equipment_items')
            .select('*', { count: 'exact', head: true })
            .eq('warehouse_category_id', cat.id)
            .eq('is_active', true);
          counts[cat.id] = count ?? 0;
        })
      );
      setItemCounts(counts);
    } catch (error) {
      console.error('Error fetching categories:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchItems = useCallback(
    async (categoryId?: string) => {
      setIsLoading(true);
      try {
        // Fetch equipment items
        let itemQuery = supabase
          .from('equipment_items')
          .select(`
            id, name, brand, model, description, thumbnail_url,
            warehouse_category_id, is_active
          `)
          .eq('is_active', true)
          .order('name');

        if (categoryId) {
          itemQuery = itemQuery.eq('warehouse_category_id', categoryId);
        }

        if (searchQuery.trim()) {
          itemQuery = itemQuery.or(
            `name.ilike.%${searchQuery.trim()}%,brand.ilike.%${searchQuery.trim()}%,model.ilike.%${searchQuery.trim()}%`
          );
        }

        const { data: itemsData, error: itemsError } = await itemQuery.limit(100);
        if (itemsError) throw itemsError;

        // Fetch equipment kits
        let kitQuery = supabase
          .from('equipment_kits')
          .select('id, name, description, thumbnail_url, warehouse_category_id, is_active')
          .eq('is_active', true)
          .order('name');

        if (categoryId) {
          kitQuery = kitQuery.eq('warehouse_category_id', categoryId);
        }

        if (searchQuery.trim()) {
          kitQuery = kitQuery.ilike('name', `%${searchQuery.trim()}%`);
        }

        const { data: kitsData, error: kitsError } = await kitQuery.limit(50);
        if (kitsError) throw kitsError;

        // Fetch unit counts for items
        const itemIds = (itemsData ?? []).map((i) => i.id);
        let unitCounts: Record<string, { total: number; available: number }> = {};

        if (itemIds.length > 0) {
          const { data: units } = await supabase
            .from('equipment_units')
            .select('equipment_id, status')
            .in('equipment_id', itemIds);

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

        const mappedItems: EquipmentItem[] = (itemsData ?? []).map((item) => ({
          id: item.id,
          name: item.name,
          brand: item.brand,
          model: item.model,
          description: item.description,
          thumbnail_url: item.thumbnail_url,
          warehouse_category_id: item.warehouse_category_id,
          is_active: item.is_active,
          is_kit: false,
          unit_count: unitCounts[item.id]?.total ?? 0,
          available_count: unitCounts[item.id]?.available ?? 0,
        }));

        const mappedKits: EquipmentItem[] = (kitsData ?? []).map((kit) => ({
          id: kit.id,
          name: kit.name,
          brand: null,
          model: null,
          description: kit.description,
          thumbnail_url: kit.thumbnail_url,
          warehouse_category_id: kit.warehouse_category_id,
          is_active: kit.is_active,
          is_kit: true,
          unit_count: 0,
          available_count: 0,
        }));

        // Kits first, then items
        setItems([...mappedKits, ...mappedItems]);
      } catch (error) {
        console.error('Error fetching equipment:', error);
      } finally {
        setIsLoading(false);
      }
    },
    [searchQuery]
  );

  useEffect(() => {
    if (viewMode === 'categories') {
      fetchCategories(selectedCategory?.id ?? null);
    } else {
      fetchItems(selectedCategory?.id);
    }
  }, [viewMode, selectedCategory?.id]);

  const handleCategoryPress = async (category: WarehouseCategory) => {
    // Check if category has subcategories
    const { count } = await supabase
      .from('warehouse_categories')
      .select('*', { count: 'exact', head: true })
      .eq('parent_id', category.id)
      .eq('is_active', true);

    if (count && count > 0) {
      setParentStack((prev) => [...prev, category]);
      setSelectedCategory(category);
      setViewMode('categories');
    } else {
      setParentStack((prev) => [...prev, category]);
      setSelectedCategory(category);
      setViewMode('items');
    }
  };

  const handleBack = () => {
    if (viewMode === 'items') {
      // Go back to categories at same level
      setViewMode('categories');
      return;
    }

    const newStack = [...parentStack];
    newStack.pop();
    const parent = newStack.length > 0 ? newStack[newStack.length - 1] : null;
    setParentStack(newStack);
    setSelectedCategory(parent);
    setViewMode('categories');
  };

  const handleSearch = () => {
    if (searchQuery.trim()) {
      setViewMode('items');
      fetchItems();
    }
  };

  const handleClearSearch = () => {
    setSearchQuery('');
    if (!selectedCategory) {
      setViewMode('categories');
      setParentStack([]);
      fetchCategories(null);
    } else {
      setViewMode('items');
      fetchItems(selectedCategory.id);
    }
  };

  const canGoBack = parentStack.length > 0 || viewMode === 'items';

  const renderCategory = ({ item }: { item: WarehouseCategory }) => {
    const count = itemCounts[item.id] ?? 0;
    const iconName = getFeatherIcon(item.icon);

    return (
      <TouchableOpacity
        style={styles.categoryCard}
        onPress={() => handleCategoryPress(item)}
        activeOpacity={0.7}
      >
        <View style={[styles.categoryIcon, { backgroundColor: (item.color ?? colors.primary.gold) + '20' }]}>
          <Feather
            name={iconName as any}
            size={22}
            color={item.color ?? colors.primary.gold}
          />
        </View>
        <View style={styles.categoryInfo}>
          <Text style={styles.categoryName}>{item.name}</Text>
          {count > 0 && (
            <Text style={styles.categoryCount}>
              {count} {count === 1 ? 'element' : 'elementów'}
            </Text>
          )}
        </View>
        <Feather name="chevron-right" size={18} color={colors.text.tertiary} />
      </TouchableOpacity>
    );
  };

  const renderItem = ({ item }: { item: EquipmentItem }) => (
    <TouchableOpacity style={styles.itemCard} activeOpacity={0.7}>
      {item.thumbnail_url ? (
        <Image source={{ uri: item.thumbnail_url }} style={styles.itemImage} />
      ) : (
        <View style={[styles.itemImagePlaceholder, item.is_kit && styles.kitPlaceholder]}>
          <Feather
            name={item.is_kit ? 'archive' : 'package'}
            size={22}
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
          <Text style={styles.itemName} numberOfLines={2}>
            {item.name}
          </Text>
        </View>
        {(item.brand || item.model) && (
          <Text style={styles.itemBrandModel} numberOfLines={1}>
            {[item.brand, item.model].filter(Boolean).join(' ')}
          </Text>
        )}
        {!item.is_kit && item.unit_count !== undefined && item.unit_count > 0 && (
          <View style={styles.unitStatusRow}>
            <View style={styles.unitDot}>
              <View style={[
                styles.dot,
                { backgroundColor: (item.available_count ?? 0) > 0 ? colors.status.success : colors.status.error }
              ]} />
            </View>
            <Text style={styles.unitStatusText}>
              {item.available_count}/{item.unit_count} dostępnych
            </Text>
          </View>
        )}
        {item.description && !item.brand && !item.model && (
          <Text style={styles.itemDescription} numberOfLines={1}>
            {item.description}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );

  const breadcrumbText = parentStack.map((c) => c.name).join(' > ');

  return (
    <View style={styles.container}>
      {/* Search bar */}
      <View style={styles.searchContainer}>
        {canGoBack && (
          <TouchableOpacity onPress={handleBack} style={styles.backButton}>
            <Feather name="arrow-left" size={20} color={colors.text.primary} />
          </TouchableOpacity>
        )}
        <View style={styles.searchInput}>
          <Feather name="search" size={16} color={colors.text.tertiary} />
          <TextInput
            style={styles.searchText}
            placeholder="Szukaj sprzętu..."
            placeholderTextColor={colors.text.tertiary}
            value={searchQuery}
            onChangeText={setSearchQuery}
            onSubmitEditing={handleSearch}
            returnKeyType="search"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={handleClearSearch}>
              <Feather name="x" size={16} color={colors.text.tertiary} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Breadcrumb */}
      {parentStack.length > 0 && (
        <View style={styles.breadcrumb}>
          <Feather name="folder" size={12} color={colors.text.tertiary} />
          <Text style={styles.breadcrumbText} numberOfLines={1}>
            {breadcrumbText}
          </Text>
        </View>
      )}

      {/* Header for items view */}
      {viewMode === 'items' && selectedCategory && (
        <View style={styles.categoryHeader}>
          <View style={styles.headerLeft}>
            <View style={[
              styles.headerIcon,
              { backgroundColor: (selectedCategory.color ?? colors.primary.gold) + '15' }
            ]}>
              <Feather
                name={getFeatherIcon(selectedCategory.icon) as any}
                size={16}
                color={selectedCategory.color ?? colors.primary.gold}
              />
            </View>
            <Text style={styles.categoryHeaderText}>{selectedCategory.name}</Text>
          </View>
          <Text style={styles.categoryHeaderCount}>
            {items.length} el.
          </Text>
        </View>
      )}

      {/* Content */}
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary.gold} />
          <Text style={styles.loadingText}>Ładowanie...</Text>
        </View>
      ) : viewMode === 'categories' ? (
        <FlatList
          data={categories}
          keyExtractor={(item) => item.id}
          renderItem={renderCategory}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={false}
              onRefresh={() => fetchCategories(selectedCategory?.id ?? null)}
              tintColor={colors.primary.gold}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Feather name="folder" size={48} color={colors.text.tertiary} />
              <Text style={styles.emptyText}>Brak podkategorii</Text>
              <Text style={styles.emptySubtext}>
                Ta kategoria nie zawiera podkategorii
              </Text>
            </View>
          }
        />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={false}
              onRefresh={() => fetchItems(selectedCategory?.id)}
              tintColor={colors.primary.gold}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Feather name="inbox" size={48} color={colors.text.tertiary} />
              <Text style={styles.emptyText}>Brak sprzętu</Text>
              <Text style={styles.emptySubtext}>
                {searchQuery
                  ? `Nie znaleziono wyników dla "${searchQuery}"`
                  : 'Ta kategoria jest pusta'}
              </Text>
            </View>
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
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  loadingText: {
    fontSize: 13,
    color: colors.text.tertiary,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.background.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchInput: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background.secondary,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  searchText: {
    flex: 1,
    color: colors.text.primary,
    fontSize: 14,
  },
  breadcrumb: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xs,
    gap: 6,
  },
  breadcrumbText: {
    fontSize: 11,
    color: colors.text.tertiary,
    flex: 1,
  },
  categoryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  headerIcon: {
    width: 28,
    height: 28,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryHeaderText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text.primary,
  },
  categoryHeaderCount: {
    fontSize: 12,
    color: colors.text.tertiary,
    backgroundColor: colors.background.secondary,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    overflow: 'hidden',
  },
  list: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
  },
  categoryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background.secondary,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  categoryIcon: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryInfo: {
    flex: 1,
    marginLeft: spacing.md,
  },
  categoryName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text.primary,
  },
  categoryCount: {
    fontSize: 12,
    color: colors.text.tertiary,
    marginTop: 2,
  },
  itemCard: {
    flexDirection: 'row',
    backgroundColor: colors.background.secondary,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  itemImage: {
    width: 56,
    height: 56,
    borderRadius: 8,
    backgroundColor: colors.background.tertiary,
  },
  itemImagePlaceholder: {
    width: 56,
    height: 56,
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
    marginLeft: spacing.md,
    justifyContent: 'center',
  },
  itemNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
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
  itemBrandModel: {
    fontSize: 12,
    color: colors.text.secondary,
    marginTop: 2,
  },
  unitStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 4,
  },
  unitDot: {
    width: 14,
    height: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  unitStatusText: {
    fontSize: 11,
    color: colors.text.tertiary,
  },
  itemDescription: {
    fontSize: 12,
    color: colors.text.tertiary,
    marginTop: 3,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
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
