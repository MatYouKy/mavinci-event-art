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

interface EquipmentCategory {
  id: string;
  name: string;
  icon_name?: string;
  item_count?: number;
}

interface EquipmentItem {
  id: string;
  name: string;
  description: string | null;
  thumbnail_url: string | null;
  category_id: string;
  category_name?: string;
  status?: string;
}

type ViewMode = 'categories' | 'items';

export default function EquipmentScreen() {
  const [viewMode, setViewMode] = useState<ViewMode>('categories');
  const [categories, setCategories] = useState<EquipmentCategory[]>([]);
  const [items, setItems] = useState<EquipmentItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<EquipmentCategory | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchCategories = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('warehouse_categories')
        .select('id, name, icon_name')
        .order('name');

      if (error) throw error;

      const categoriesWithCounts = await Promise.all(
        (data ?? []).map(async (cat) => {
          const { count } = await supabase
            .from('equipment_items')
            .select('*', { count: 'exact', head: true })
            .eq('category_id', cat.id);

          return { ...cat, item_count: count ?? 0 };
        })
      );

      setCategories(categoriesWithCounts);
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
        let query = supabase
          .from('equipment_items')
          .select(
            `id, name, description, thumbnail_url, category_id,
             warehouse_categories!equipment_items_category_id_fkey(name)`
          )
          .order('name');

        if (categoryId) {
          query = query.eq('category_id', categoryId);
        }

        if (searchQuery.trim()) {
          query = query.ilike('name', `%${searchQuery.trim()}%`);
        }

        const { data, error } = await query.limit(100);

        if (error) throw error;

        const mapped = (data ?? []).map((item: any) => ({
          id: item.id,
          name: item.name,
          description: item.description,
          thumbnail_url: item.thumbnail_url,
          category_id: item.category_id,
          category_name: item.warehouse_categories?.name ?? '',
        }));

        setItems(mapped);
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
      fetchCategories();
    } else {
      fetchItems(selectedCategory?.id);
    }
  }, [viewMode, selectedCategory?.id, fetchCategories, fetchItems]);

  const handleCategoryPress = (category: EquipmentCategory) => {
    setSelectedCategory(category);
    setViewMode('items');
  };

  const handleBackToCategories = () => {
    setSelectedCategory(null);
    setViewMode('categories');
    setSearchQuery('');
  };

  const handleSearch = () => {
    if (searchQuery.trim()) {
      setSelectedCategory(null);
      setViewMode('items');
      fetchItems();
    }
  };

  const renderCategory = ({ item }: { item: EquipmentCategory }) => (
    <TouchableOpacity
      style={styles.categoryCard}
      onPress={() => handleCategoryPress(item)}
    >
      <View style={styles.categoryIcon}>
        <Feather name="box" size={24} color={colors.primary.gold} />
      </View>
      <View style={styles.categoryInfo}>
        <Text style={styles.categoryName}>{item.name}</Text>
        <Text style={styles.categoryCount}>
          {item.item_count} {item.item_count === 1 ? 'element' : 'elementów'}
        </Text>
      </View>
      <Feather name="chevron-right" size={20} color={colors.text.tertiary} />
    </TouchableOpacity>
  );

  const renderItem = ({ item }: { item: EquipmentItem }) => (
    <TouchableOpacity style={styles.itemCard}>
      {item.thumbnail_url ? (
        <Image source={{ uri: item.thumbnail_url }} style={styles.itemImage} />
      ) : (
        <View style={styles.itemImagePlaceholder}>
          <Feather name="package" size={24} color={colors.text.tertiary} />
        </View>
      )}
      <View style={styles.itemInfo}>
        <Text style={styles.itemName} numberOfLines={2}>
          {item.name}
        </Text>
        {item.category_name && (
          <Text style={styles.itemCategory}>{item.category_name}</Text>
        )}
        {item.description && (
          <Text style={styles.itemDescription} numberOfLines={2}>
            {item.description}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {/* Search bar */}
      <View style={styles.searchContainer}>
        {viewMode === 'items' && selectedCategory && (
          <TouchableOpacity
            onPress={handleBackToCategories}
            style={styles.backButton}
          >
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
            <TouchableOpacity
              onPress={() => {
                setSearchQuery('');
                if (viewMode === 'items' && !selectedCategory) {
                  setViewMode('categories');
                }
              }}
            >
              <Feather name="x" size={16} color={colors.text.tertiary} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Header for items view */}
      {viewMode === 'items' && selectedCategory && (
        <View style={styles.categoryHeader}>
          <Text style={styles.categoryHeaderText}>{selectedCategory.name}</Text>
          <Text style={styles.categoryHeaderCount}>
            {items.length} elementów
          </Text>
        </View>
      )}

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary.gold} />
        </View>
      ) : viewMode === 'categories' ? (
        <FlatList
          data={categories}
          keyExtractor={(item) => item.id}
          renderItem={renderCategory}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={isLoading}
              onRefresh={fetchCategories}
              tintColor={colors.primary.gold}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Feather name="package" size={48} color={colors.text.tertiary} />
              <Text style={styles.emptyText}>Brak kategorii sprzętu</Text>
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
              refreshing={isLoading}
              onRefresh={() => fetchItems(selectedCategory?.id)}
              tintColor={colors.primary.gold}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Feather name="inbox" size={48} color={colors.text.tertiary} />
              <Text style={styles.emptyText}>Brak sprzętu w tej kategorii</Text>
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
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  backButton: {
    padding: spacing.xs,
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
  },
  searchText: {
    flex: 1,
    color: colors.text.primary,
    fontSize: 14,
  },
  categoryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  categoryHeaderText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text.primary,
  },
  categoryHeaderCount: {
    fontSize: 13,
    color: colors.text.tertiary,
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
  },
  categoryIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: colors.primary.gold + '15',
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
  },
  itemImage: {
    width: 60,
    height: 60,
    borderRadius: 8,
    backgroundColor: colors.background.tertiary,
  },
  itemImagePlaceholder: {
    width: 60,
    height: 60,
    borderRadius: 8,
    backgroundColor: colors.background.tertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemInfo: {
    flex: 1,
    marginLeft: spacing.md,
    justifyContent: 'center',
  },
  itemName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text.primary,
  },
  itemCategory: {
    fontSize: 12,
    color: colors.primary.gold,
    marginTop: 2,
  },
  itemDescription: {
    fontSize: 12,
    color: colors.text.tertiary,
    marginTop: 4,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
  },
  emptyText: {
    marginTop: spacing.md,
    fontSize: 14,
    color: colors.text.tertiary,
  },
});
