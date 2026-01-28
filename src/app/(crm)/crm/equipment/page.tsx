'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Plus,
  Search,
  Package,
  Grid,
  List,
  Plug,
  Trash2,
  ChevronRight,
  FolderTree,
  Layers,
  MapPin,
  Cable,
  Copy,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { ThreeDotMenu } from '@/components/UI/ThreeDotMenu/ThreeDotMenu';
import ResponsiveActionBar, { Action } from '@/components/crm/ResponsiveActionBar';
import { supabase } from '@/lib/supabase/browser';

// ⬇️ RTK Query – feed + kategorie + delete
import {
  useGetEquipmentFeedQuery,
  useGetEquipmentCategoriesQuery,
  useDeleteEquipmentMutation,
} from './store/equipmentApi';

import type { EquipmentCatalogItem } from './hooks/useEquipmentCatalog';
import Popover from '@/components/UI/Tooltip';

type UnitStatus = 'available' | 'damaged' | 'in_service' | 'retired';

interface WarehouseCategory {
  id: string;
  parent_id: string | null;
  name: string;
  description: string | null;
  icon: string | null;
  color: string;
  level: number;
  order_index: number;
}

interface EquipmentUnit {
  id: string;
  status: UnitStatus;
}

interface EquipmentListItem {
  id: string;
  name: string;
  warehouse_category_id: string | null;
  brand?: string | null; // dla kits może być null
  model?: string | null; // dla kits może być null
  thumbnail_url: string | null;
  created_at?: string | null;
  is_kit?: boolean;
  equipment_units?: EquipmentUnit[]; // dla kits może być []
}

export default function EquipmentPage() {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const { canCreateInModule, canManageModule } = useCurrentEmployee();

  // Zakres UI
  const [activeTab, setActiveTab] = useState<string>('all'); // 'all' | categoryId | 'cables'
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
  const [itemTypeFilter, setItemTypeFilter] = useState<'all' | 'equipment' | 'kits'>('all');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isFilterOpen, setIsFilterOpen] = useState(false);

  // Paginacja do infinite scroll
  const [page, setPage] = useState(0);
  const limit = 100; // Zwiększony limit dla lepszej wydajności infinite scroll

  // Kategoria do filtra feedu (z activeTab, ale bez 'all' i 'cables')
  const categoryId = activeTab !== 'all' && activeTab !== 'cables' ? activeTab : null;

  // Hooki RTKQ
  const {
    data: categories = [],
    isLoading: catLoading,
    isError: catError,
    refetch: refetchCats,
  } = useGetEquipmentCategoriesQuery();

  const {
    data: feed,
    isLoading,
    isFetching, // true również przy dociąganiu kolejnych stron
    isError,
    refetch,
  } = useGetEquipmentFeedQuery({
    q: searchTerm,
    categoryId,
    itemType: itemTypeFilter,
    showCablesOnly: activeTab === 'cables',
    page,
    limit,
  });

  const [deleteEquipment, { isLoading: deleting }] = useDeleteEquipmentMutation();

  // Reset strony przy zmianie filtrów
  useEffect(() => {
    setPage(0);
  }, [searchTerm, categoryId, itemTypeFilter, activeTab]);

  // IntersectionObserver – strażnik na dole listy
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const hasMore = !!feed?.hasMore;

  useEffect(() => {
    if (!hasMore || isFetching) return;
    const el = sentinelRef.current;
    if (!el) return;

    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setPage((p) => p + 1);
        }
      },
      { rootMargin: '800px' },
    );

    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, isFetching]);

  // Lista elementów do renderu
  const items: EquipmentCatalogItem[] = useMemo(() => feed?.items ?? [], [feed]);

  // Kategorie – helpery
  const mainCategories: WarehouseCategory[] = useMemo(
    () => categories.filter((c) => c.level === 1),
    [categories],
  );

  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const getCategoryPath = (categoryId: string | null): string => {
    if (!categoryId) return '';
    let cur = byId.get(categoryId);
    if (!cur) return '';
    const chain = [cur.name];
    while (cur.parent_id) {
      cur = byId.get(cur.parent_id);
      if (!cur) break;
      chain.unshift(cur.name);
    }
    return chain.join(' > ');
  };

  const getStock = (item: EquipmentListItem) => {
    if (item.is_kit) return { available: 0, total: 0, color: 'text-gray-400' };
    const total = item.equipment_units?.length ?? 0;
    const available = (item.equipment_units ?? []).filter((u) => u.status === 'available').length;
    if (total === 0) return { available: 0, total: 0, color: 'text-gray-400' };
    const pct = (available / total) * 100;
    if (pct === 0) return { available, total, color: 'text-red-400' };
    if (pct < 50) return { available, total, color: 'text-orange-400' };
    return { available, total, color: 'text-green-400' };
  };

  const handleDelete = async (id: string) => {
    const ok = await showConfirm('Czy na pewno chcesz usunąć?', 'Usuń');
    if (!ok) return;

    try {
      await deleteEquipment(id).unwrap();
      showSnackbar('Usunięto', 'success');

      // po usunięciu odśwież bieżący feed od strony 0
      setPage(0);
      refetch();
    } catch (error: any) {
      console.error('Delete error:', error);
      showSnackbar(error?.message || 'Błąd podczas usuwania', 'error');
    }
  };

  const handleDuplicate = async (id: string) => {
    const ok = await showConfirm('Czy na pewno chcesz zduplikować ten przedmiot?', 'Duplikuj');
    if (!ok) return;

    try {
      const { data: original, error: fetchError } = await supabase
        .from('equipment_items')
        .select('*')
        .eq('id', id)
        .single();

      if (fetchError) throw fetchError;

      const {
        name,
        warehouse_category_id,
        brand,
        model,
        description,
        thumbnail_url,
        dimensions_cm,
        weight_kg,
        power_consumption_w,
        storage_location_id,
      } = original;

      const { error: insertError } = await supabase.from('equipment_items').insert({
        name: `${name} (kopia)`,
        warehouse_category_id,
        brand,
        model,
        description,
        thumbnail_url,
        dimensions_cm,
        weight_kg,
        power_consumption_w,
        storage_location_id,
      });

      if (insertError) throw insertError;

      showSnackbar('Przedmiot zduplikowany pomyślnie', 'success');
      setPage(0);
      refetch();
    } catch (error) {
      console.error('Error duplicating equipment:', error);
      showSnackbar('Błąd podczas duplikowania', 'error');
    }
  };

  const equipmentActions = useMemo(() => {
    const actions: Action[] = [];

    if (canManageModule('equipment')) {
      actions.push(
        {
          label: 'Kategorie',
          onClick: () => router.push('/crm/equipment/categories'),
          icon: <FolderTree className="h-4 w-4" />,
          variant: 'default',
          show: true,
        },
        {
          label: 'Zestawy',
          onClick: () => router.push('/crm/equipment/kits'),
          icon: <Layers className="h-4 w-4" />,
          variant: 'default',
          show: true,
        },
        {
          label: 'Lokalizacje',
          onClick: () => router.push('/crm/equipment/locations'),
          icon: <MapPin className="h-4 w-4" />,
          variant: 'default',
          show: true,
        },
        {
          label: 'Przewody',
          onClick: () => router.push('/crm/equipment/cables'),
          icon: <Cable className="h-4 w-4" />,
          variant: 'default',
          show: true,
        },
      );
    }

    if (canCreateInModule('equipment')) {
      actions.push({
        label: 'Dodaj',
        onClick: () => router.push('/crm/equipment/new'),
        icon: <Plus className="h-4 w-4" />,
        variant: 'primary',
        show: true,
      });
    }

    return actions;
  }, [router, canManageModule, canCreateInModule]);

  // Błędy / loading (kategorie albo feed)
  if (isError || catError) {
    return (
      <div className="text-[#e5e4e2]/80">
        Coś poszło nie tak.{' '}
        <button
          className="underline"
          onClick={() => {
            refetch();
            refetchCats();
          }}
        >
          Spróbuj ponownie
        </button>
      </div>
    );
  }

  if (isLoading || catLoading) {
    return (
      <div className="flex h-64 items-center justify-center text-[#e5e4e2]/60">Ładowanie...</div>
    );
  }

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <div className="mt-2 flex items-center justify-between">
        <h2 className="text-2xl font-light text-[#e5e4e2]">Magazyn</h2>
        <div className="flex items-center gap-3 pt-2">
          <ResponsiveActionBar actions={equipmentActions} />
        </div>
      </div>

      {/* TABS */}
      {/* Filtry typu + Search + toggle view */}
      <div className="flex items-center gap-4">
        {/* Desktop: zostaje jak było */}
        <div className="hidden gap-2 md:flex">
          {(['all', 'equipment', 'kits'] as const).map((k) => (
            <button
              key={k}
              onClick={() => setItemTypeFilter(k)}
              className={`rounded-lg px-4 py-2 text-sm transition-colors ${
                itemTypeFilter === k
                  ? 'bg-[#d3bb73] text-[#1c1f33]'
                  : 'bg-[#1c1f33] text-[#e5e4e2] hover:bg-[#1c1f33]/80'
              }`}
            >
              {k === 'all' ? 'Wszystko' : k === 'equipment' ? 'Tylko sprzęt' : 'Tylko zestawy'}
            </button>
          ))}
        </div>

        <div className="hidden flex-1 gap-4 md:flex">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#e5e4e2]/40" />
            <input
              type="text"
              placeholder="Szukaj..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] py-2.5 pl-10 pr-4 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setViewMode('list')}
              className={`rounded-lg p-2 ${viewMode === 'list' ? 'bg-[#d3bb73] text-[#1c1f33]' : 'bg-[#1c1f33] text-[#e5e4e2]'}`}
            >
              <List className="h-5 w-5" />
            </button>
            <button
              onClick={() => setViewMode('grid')}
              className={`rounded-lg p-2 ${viewMode === 'grid' ? 'bg-[#d3bb73] text-[#1c1f33]' : 'bg-[#1c1f33] text-[#e5e4e2]'}`}
            >
              <Grid className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Mobile: tylko ikonki */}
        <div className="flex w-full items-center gap-2 md:hidden">
          {/* Lupka */}
          <button
            onClick={() => setIsSearchOpen(true)}
            className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-2 text-[#e5e4e2]"
            aria-label="Szukaj"
          >
            <Search className="h-5 w-5" />
          </button>

          {/* Filtry */}
          <button
            onClick={() => setIsFilterOpen(true)}
            className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-2 text-[#e5e4e2]"
            aria-label="Filtry"
          >
            {/* jeśli nie masz Filter icon w lucide, użyj SlidersHorizontal */}
            <SlidersHorizontal className="h-5 w-5" />
          </button>

          <div className="flex-1" />

          {/* Toggle view */}
          <div className="flex gap-2">
            <button
              onClick={() => setViewMode('list')}
              className={`rounded-lg p-2 ${viewMode === 'list' ? 'bg-[#d3bb73] text-[#1c1f33]' : 'bg-[#1c1f33] text-[#e5e4e2]'}`}
              aria-label="Widok listy"
            >
              <List className="h-5 w-5" />
            </button>
            <button
              onClick={() => setViewMode('grid')}
              className={`rounded-lg p-2 ${viewMode === 'grid' ? 'bg-[#d3bb73] text-[#1c1f33]' : 'bg-[#1c1f33] text-[#e5e4e2]'}`}
              aria-label="Widok siatki"
            >
              <Grid className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>

      {/* MODAL: Search */}
      {isSearchOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            className="absolute inset-0 bg-black/60"
            onClick={() => setIsSearchOpen(false)}
            aria-label="Zamknij"
          />
          <div className="absolute left-1/2 top-6 w-[calc(100%-24px)] -translate-x-1/2 rounded-2xl border border-[#d3bb73]/15 bg-[#0f1119] p-4 shadow-2xl">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#e5e4e2]/40" />
                <input
                  autoFocus
                  type="text"
                  placeholder="Szukaj..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] py-2.5 pl-10 pr-10 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
                />
                {!!searchTerm && (
                  <button
                    onClick={() => setSearchTerm('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-[#e5e4e2]/60 hover:text-[#e5e4e2]"
                    aria-label="Wyczyść"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              <button
                onClick={() => setIsSearchOpen(false)}
                className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2]"
              >
                Zamknij
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Filters */}
      {isFilterOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            className="absolute inset-0 bg-black/60"
            onClick={() => setIsFilterOpen(false)}
            aria-label="Zamknij"
          />
          <div className="absolute left-1/2 top-6 w-[calc(100%-24px)] -translate-x-1/2 rounded-2xl border border-[#d3bb73]/15 bg-[#0f1119] p-4 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-medium text-[#e5e4e2]">Filtry</div>
              <button
                onClick={() => setIsFilterOpen(false)}
                className="rounded-md p-1 text-[#e5e4e2]/60 hover:text-[#e5e4e2]"
                aria-label="Zamknij"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex flex-col gap-2">
              {(['all', 'equipment', 'kits'] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => {
                    setItemTypeFilter(k);
                    setIsFilterOpen(false);
                  }}
                  className={`rounded-lg px-4 py-2 text-left text-sm transition-colors ${
                    itemTypeFilter === k
                      ? 'bg-[#d3bb73] text-[#1c1f33]'
                      : 'bg-[#1c1f33] text-[#e5e4e2] hover:bg-[#1c1f33]/80'
                  }`}
                >
                  {k === 'all' ? 'Wszystko' : k === 'equipment' ? 'Tylko sprzęt' : 'Tylko zestawy'}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Lista */}
      {items.length === 0 ? (
        <div className="py-12 text-center text-[#e5e4e2]/60">Brak sprzętu</div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => {
            const stock = getStock(item as EquipmentListItem);
            return (
              <div
                key={item.id}
                onClick={() => {
                  if (item.is_kit) {
                    router.push(`/crm/equipment/kits?edit=${item.id}`);
                  } else {
                    router.push(`/crm/equipment/${item.id}`);
                  }
                }}
                className="relative cursor-pointer rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6 hover:border-[#d3bb73]/30"
              >
                {canManageModule('equipment') && (
                  <div className="absolute right-2 top-2" onClick={(e) => e.stopPropagation()}>
                    <ResponsiveActionBar
                      actions={[
                        {
                          label: 'Duplikuj',
                          onClick: () => {
                            void handleDuplicate(item.id);
                          },
                          icon: <Copy className="h-4 w-4" />,
                          variant: 'default',
                        },
                        {
                          label: deleting ? 'Usuwanie…' : 'Usuń',
                          onClick: () => {
                            // ignorujemy Promise żeby zgadzał się typ () => void
                            void handleDelete(item.id);
                          },
                          icon: <Trash2 className="h-4 w-4" />,
                          variant: 'danger',
                        },
                      ]}
                    />
                  </div>
                )}
                <div className="relative">
                  {item.thumbnail_url ? (
                    <Popover
                      trigger={
                        <img
                          src={item.thumbnail_url}
                          alt={item.name}
                          className="mb-4 h-32 w-full rounded-lg object-cover"
                        />
                      }
                      content={
                        <img
                          src={item.thumbnail_url}
                          alt={item.name ?? 'Sprzęt'}
                          className="h-auto cursor-pointer rounded-lg object-contain transition-all"
                        />
                      }
                      openOn="hover"
                    />
                  ) : (
                    <div className="mb-4 flex h-32 w-full items-center justify-center rounded-lg bg-[#0f1119]">
                      <Package className="h-12 w-12 text-[#e5e4e2]/40" />
                    </div>
                  )}
                  {item.is_kit && (
                    <div className="absolute left-2 top-2 rounded bg-[#d3bb73] px-2 py-1 text-xs font-medium text-[#1c1f33]">
                      ZESTAW
                    </div>
                  )}
                </div>
                <h3 className="mb-2 font-medium text-[#e5e4e2]">
                  {item.name}
                  {item.is_kit && <span className="ml-2 text-xs text-[#d3bb73]">ZESTAW</span>}
                  {item.is_active === false && (
                    <span className="ml-2 text-xs text-red-400">NIEAKTYWNY</span>
                  )}
                </h3>
                {item.warehouse_category_id && (
                  <p className="mb-2 flex items-center gap-1 text-xs text-[#e5e4e2]/40">
                    <ChevronRight className="h-3 w-3" />
                    {getCategoryPath(item.warehouse_category_id)}
                  </p>
                )}
                <div className="flex justify-between text-sm">
                  {item.is_kit ? (
                    <span className="italic text-[#e5e4e2]/60">Zestaw</span>
                  ) : (
                    <span className={stock.color}>
                      {stock.available}/{stock.total}
                    </span>
                  )}
                  {item.brand && <span className="text-[#e5e4e2]/60">{item.brand}</span>}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]">
          {items.map((item) => {
            const stock = getStock(item as EquipmentListItem);
            return (
              <div
                key={item.id}
                onClick={() => {
                  if (item.is_kit) {
                    router.push(`/crm/equipment/kits?edit=${item.id}`);
                  } else {
                    router.push(`/crm/equipment/${item.id}`);
                  }
                }}
                className="flex cursor-pointer items-center gap-4 border-b border-[#d3bb73]/5 p-4 last:border-0 hover:bg-[#0f1119]"
              >
                <div className="relative">
                  {item.thumbnail_url ? (
                    <Popover
                      trigger={
                        <img
                          src={item.thumbnail_url}
                          alt={item.name ?? 'Sprzęt'}
                          className="h-12 w-12 rounded-lg object-cover"
                        />
                      }
                      content={
                        <img
                          src={item.thumbnail_url}
                          alt={item.name ?? 'Sprzęt'}
                          className="h-auto cursor-pointer rounded-lg object-contain transition-all"
                        />
                      }
                      openOn="hover"
                    />
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[#0f1119]">
                      <Package className="h-6 w-6 text-[#e5e4e2]/40" />
                    </div>
                  )}
                  {item.is_kit && (
                    <div className="absolute -left-1 -top-1 rounded bg-[#d3bb73] px-1 text-[10px] font-medium text-[#1c1f33]">
                      KIT
                    </div>
                  )}
                </div>
                <div className="flex-1">
                  <h3 className="font-medium text-[#e5e4e2]">
                    {item.name}
                    {item.is_kit && <span className="ml-2 text-xs text-[#d3bb73]">ZESTAW</span>}
                    {item.is_active === false && (
                      <span className="ml-2 text-xs text-red-400">NIEAKTYWNY</span>
                    )}
                  </h3>
                  <div className="flex gap-2 text-sm text-[#e5e4e2]/60">
                    {item.brand && <span>{item.brand}</span>}
                    {item.warehouse_category_id && (
                      <>
                        <span>•</span>
                        <span className="flex items-center gap-1">
                          <ChevronRight className="h-3 w-3" />
                          {getCategoryPath(item.warehouse_category_id)}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  {item.is_kit ? (
                    <span className="text-sm italic text-[#e5e4e2]/60">Zestaw</span>
                  ) : (
                    <span className={`text-sm ${stock.color}`}>
                      {stock.available}/{stock.total}
                    </span>
                  )}
                  {canManageModule('equipment') && (
                    <div className="absolute right-2 top-2" onClick={(e) => e.stopPropagation()}>
                      <ResponsiveActionBar
                        actions={[
                          {
                            label: 'Duplikuj',
                            onClick: () => {
                              void handleDuplicate(item.id);
                            },
                            icon: <Copy className="h-4 w-4" />,
                            variant: 'default',
                          },
                          {
                            label: deleting ? 'Usuwanie…' : 'Usuń',
                            onClick: () => {
                              // ignorujemy Promise żeby zgadzał się typ () => void
                              void handleDelete(item.id);
                            },
                            icon: <Trash2 className="h-4 w-4" />,
                            variant: 'danger',
                          },
                        ]}
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Sentinel do infinite scroll + status */}
      <div ref={sentinelRef} />
      {isFetching && <div className="py-6 text-center text-[#e5e4e2]/60">Ładowanie…</div>}
      {!hasMore && !isFetching && items.length > 0 && (
        <div className="py-6 text-center text-[#e5e4e2]/40">To już wszystko 🎉</div>
      )}
    </div>
  );
}
