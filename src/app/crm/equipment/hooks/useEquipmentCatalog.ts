'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  useGetEquipmentFeedQuery,
  useLazyGetEquipmentFeedQuery,
} from '@/app/crm/equipment/store/equipmentApi';
import { WarehouseCategory } from '@/store/slices/equipmentSlice';

type ItemType = 'all' | 'equipment' | 'kits';

export type EquipmentCatalogItem = {
  id: string;
  name: string;
  warehouse_category_id: string | null;
  thumbnail_url?: string | null;
  description?: string | null;
  created_at?: string | null;
  available_quantity: number | null;
  is_active?: boolean;

  // equipment-only:
  brand?: string | null;
  model?: string | null;
  equipment_units?: any[];
  warehouse_categories?: WarehouseCategory;

  // flags:
  is_kit?: boolean;
  is_cable?: boolean;

  // cable-only (jeśli showCablesOnly)
  stock_quantity?: number | null;
};

type Params = {
  q?: string;
  categoryId?: string | null;
  itemType?: ItemType;
  showCablesOnly?: boolean;
  limit?: number;
  enabled?: boolean;
  activeOnly?: boolean;
};

export function useEquipmentCatalog({
  q = '',
  categoryId = null,
  itemType = 'all',
  showCablesOnly = false,
  limit = 24,
  enabled = true,
  activeOnly = false,
}: Params) {
  const [page, setPage] = useState(0);

  // Query (RTKQ robi cache i merge u Ciebie w endpoint'cie)
  const feedArgs = useMemo(
    () => ({ q, categoryId, itemType, showCablesOnly, page, limit, activeOnly }),
    [q, categoryId, itemType, showCablesOnly, page, limit, activeOnly],
  );

  const { data, isFetching, isLoading, isError, error, refetch } = useGetEquipmentFeedQuery(
    feedArgs,
    {
      skip: !enabled,
    },
  );

  // Lazy do “load more” (żeby mieć pełną kontrolę)
  const [triggerFeed, lazy] = useLazyGetEquipmentFeedQuery();

  // reset page gdy zmieniają się filtry (page -> 0)
  useEffect(() => {
    setPage(0);
  }, [q, categoryId, itemType, showCablesOnly, limit, activeOnly]);

  const items = data?.items ?? [];

  const total = data?.total ?? null;
  const hasMore = !!data?.hasMore;

  const loadMore = useCallback(async () => {
    if (!enabled) return;
    if (isFetching) return;
    if (!hasMore) return;

    const nextPage = page + 1;
    setPage(nextPage);

    // opcjonalnie: trigger lazy (nie jest konieczne, bo zmiana page uruchomi query)
    // ale to daje możliwość await i obsługi błędu tu
    await triggerFeed({ q, categoryId, itemType, showCablesOnly, page: nextPage, limit, activeOnly }).unwrap();
  }, [
    enabled,
    isFetching,
    hasMore,
    page,
    triggerFeed,
    q,
    categoryId,
    itemType,
    showCablesOnly,
    limit,
    activeOnly,
  ]);

  const reset = useCallback(() => {
    setPage(0);
    if (enabled) refetch();
  }, [enabled, refetch]);

  return {
    // data
    items,
    total,
    page,
    hasMore,

    // status
    isLoading: isLoading && page === 0,
    isFetching,
    isError,
    error,

    // actions
    refetch,
    loadMore,
    reset,

    // info o lazy (jakbyś chciał np. spinner osobny)
    lazy,
  };
}
