'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Plus,
  Search,
  Package,
  Grid,
  List,
  Trash2,
  ChevronRight,
  FolderTree,
  Layers,
  MapPin,
  Cable,
  Copy,
  SlidersHorizontal,
  X,
  Table2,
} from 'lucide-react';
import Image from 'next/image';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import ResponsiveActionBar, { Action } from '@/components/crm/ResponsiveActionBar';
import { supabase } from '@/lib/supabase/browser';

import {
  useGetEquipmentFeedQuery,
  useGetEquipmentCategoriesQuery,
  useDeleteEquipmentMutation,
} from './store/equipmentApi';

import type { EquipmentCatalogItem } from './hooks/useEquipmentCatalog';
import Popover from '@/components/UI/Tooltip';
import { ViewMode } from '../settings/page';
import { useUserPreferences } from '@/hooks/useUserPreferences';

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
  brand?: string | null;
  model?: string | null;
  thumbnail_url: string | null;
  created_at?: string | null;
  is_kit?: boolean;
  equipment_units?: EquipmentUnit[];
}

export default function EquipmentPageClient({ viewMode: initialViewMode }: { viewMode: ViewMode }) {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const { canCreateInModule, canManageModule } = useCurrentEmployee();

  // UI
  const [activeTab, setActiveTab] = useState<string>('all'); // 'all' | categoryId | 'cables'
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setLocalViewMode] = useState<ViewMode>(initialViewMode);
  const [itemTypeFilter, setItemTypeFilter] = useState<'all' | 'equipment' | 'kits'>('all');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isFilterOpen, setIsFilterOpen] = useState(false);

  const { setViewMode: setGlobalViewMode } = useUserPreferences();
  const handleViewModeChange = async (mode: ViewMode) => {
    setLocalViewMode(mode);
    await setGlobalViewMode('equipment', mode);
  };


  // Infinite scroll
  const [page, setPage] = useState(0);
  const limit = 200;

  const categoryId = activeTab !== 'all' && activeTab !== 'cables' ? activeTab : null;

  // RTKQ
  const {
    data: categories = [],
    isLoading: catLoading,
    isError: catError,
    refetch: refetchCats,
  } = useGetEquipmentCategoriesQuery();

  const {
    data: feed,
    isLoading,
    isFetching,
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

  // Akumulator stron
  const [accItems, setAccItems] = useState<EquipmentCatalogItem[]>([]);
  const scrollBoxRef = useRef<HTMLDivElement | null>(null);
  const observerTargetRef = useRef<HTMLDivElement | null>(null);
  const loadingMoreRef = useRef(false);

  // Reset przy zmianie filtrów / tabów
  useEffect(() => {
    setPage(0);
    setAccItems([]);
    loadingMoreRef.current = false;
  }, [searchTerm, categoryId, itemTypeFilter, activeTab]);

  // Doklejanie stron
  useEffect(() => {
    const newItems = (feed?.items ?? []) as EquipmentCatalogItem[];

    setAccItems((prev) => {
      if (page === 0) return newItems;

      const map = new Map<string, EquipmentCatalogItem>();
      for (const it of prev) map.set(it.id, it);
      for (const it of newItems) map.set(it.id, it);
      return Array.from(map.values());
    });
  }, [feed?.items, page]);

  const items = accItems;

  // total / hasMore
  const totalAll =
    (feed as any)?.total ?? (feed as any)?.totalCount ?? (feed as any)?.count ?? null;

  const hasMore =
    typeof (feed as any)?.hasMore === 'boolean'
      ? !!(feed as any)?.hasMore
      : totalAll != null
        ? items.length < Number(totalAll)
        : (feed?.items ?? []).length === limit; // fallback

  // zdejmij blokadę po fetchu
  useEffect(() => {
    if (!isFetching) loadingMoreRef.current = false;
  }, [isFetching]);

  // ✅ IO 1:1 jak w Messages: root = scrollBoxRef, target = observerTargetRef
  useEffect(() => {
    const root = scrollBoxRef.current;
    const target = observerTargetRef.current;
    if (!root || !target) return;

    const io = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (!first?.isIntersecting) return;

        if (!hasMore) return;
        if (isFetching) return;

        if (loadingMoreRef.current) return;
        loadingMoreRef.current = true;

        setPage((p) => p + 1);
      },
      {
        root,
        threshold: 0.1,
        rootMargin: '600px 0px',
      },
    );

    io.observe(target);
    return () => io.disconnect();
  }, [hasMore, isFetching]);

  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c] as const)), [categories]);

  const getCategoryPath = (categoryId2: string | null): string => {
    if (!categoryId2) return '';
    let cur = byId.get(categoryId2);
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

  const handleDelete = async (id: string, isKit: boolean) => {
    const ok = await showConfirm('Czy na pewno chcesz usunąć?', 'Usuń');
    if (!ok) return;

    try {
      if (!isKit) {
        await deleteEquipment(id).unwrap();
      } else {
        const { error } = await supabase.from('equipment_kits').delete().eq('id', id);
        if (error) throw error;
      }
      showSnackbar('Usunięto', 'success');

      setPage(0);
      setAccItems([]);
      loadingMoreRef.current = false;
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
      } = original as any;

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
      setAccItems([]);
      loadingMoreRef.current = false;
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

  const canManageEquipment = useMemo(() => canManageModule('equipment'), [canManageModule]);

  // ====== ERR / LOADING ======
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

  const showEmpty = !isFetching && items.length === 0;

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <div className="mt-2 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-light text-[#e5e4e2]">Magazyn</h2>
          <div className="mt-1 text-sm text-[#e5e4e2]/60">
            Wyświetlasz: <span className="text-[#e5e4e2]">{items.length}</span> /{' '}
            <span className="text-[#e5e4e2]">{totalAll ?? '?'}</span>
          </div>
        </div>

        <ResponsiveActionBar actions={equipmentActions} />
      </div>

      {/* Filtry typu + Search + toggle view */}
      <div className="flex items-center gap-4">
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
              onClick={() => handleViewModeChange('list')}
              className={`rounded-lg p-2 ${
                viewMode === 'list' ? 'bg-[#d3bb73] text-[#1c1f33]' : 'bg-[#1c1f33] text-[#e5e4e2]'
              }`}
            >
              <List className="h-5 w-5" />
            </button>
            <button
              onClick={() => handleViewModeChange('grid')}
              className={`rounded-lg p-2 ${
                viewMode === 'grid' ? 'bg-[#d3bb73] text-[#1c1f33]' : 'bg-[#1c1f33] text-[#e5e4e2]'
              }`}
            >
              <Grid className="h-5 w-5" />
            </button>
            <button
              onClick={() => handleViewModeChange('table')}
              className={`rounded-lg p-2 ${
                viewMode === 'table' ? 'bg-[#d3bb73] text-[#1c1f33]' : 'bg-[#1c1f33] text-[#e5e4e2]'
              }`}
              aria-label="Widok tabeli"
            >
              <Table2 className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Mobile */}
        <div className="flex w-full items-center gap-2 md:hidden">
          <button
            onClick={() => setIsSearchOpen(true)}
            className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-2 text-[#e5e4e2]"
            aria-label="Szukaj"
          >
            <Search className="h-5 w-5" />
          </button>

          <button
            onClick={() => setIsFilterOpen(true)}
            className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-2 text-[#e5e4e2]"
            aria-label="Filtry"
          >
            <SlidersHorizontal className="h-5 w-5" />
          </button>

          <div className="flex-1" />

          <div className="flex gap-2">
            <button
              onClick={() => handleViewModeChange('list')}
              className={`rounded-lg p-2 ${
                viewMode === 'list' ? 'bg-[#d3bb73] text-[#1c1f33]' : 'bg-[#1c1f33] text-[#e5e4e2]'
              }`}
              aria-label="Widok listy"
            >
              <List className="h-5 w-5" />
            </button>
            <button
              onClick={() => handleViewModeChange('grid')}
              className={`rounded-lg p-2 ${
                viewMode === 'grid' ? 'bg-[#d3bb73] text-[#1c1f33]' : 'bg-[#1c1f33] text-[#e5e4e2]'
              }`}
              aria-label="Widok siatki"
            >
              <Grid className="h-5 w-5" />
            </button>
            <button
              onClick={() => handleViewModeChange('table')}
              className={`rounded-lg p-2 ${
                viewMode === 'table' ? 'bg-[#d3bb73] text-[#1c1f33]' : 'bg-[#1c1f33] text-[#e5e4e2]'
              }`}
              aria-label="Widok tabeli"
            >
              <Table2 className="h-5 w-5" />
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

      {/* ✅ SCROLL BOX (root dla IO) */}
      <div ref={scrollBoxRef} className="max-h-[calc(100vh-420px)]">
        {showEmpty ? (
          <div className="py-12 text-center text-[#e5e4e2]/60">Brak sprzętu</div>
        ) : (
          viewMode === 'grid' && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {items.map((item) => {
                const stock = getStock(item as any as EquipmentListItem);
                return (
                  <div
                    key={item.id}
                    onClick={() => {
                      if ((item as any).is_kit) router.push(`/crm/equipment/kits?edit=${item.id}`);
                      else router.push(`/crm/equipment/${item.id}`);
                    }}
                    className="relative cursor-pointer rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6 hover:border-[#d3bb73]/30"
                  >
                    {canManageModule('equipment') && (
                      <div className="absolute right-2 top-2" onClick={(e) => e.stopPropagation()}>
                        <ResponsiveActionBar
                          mobileBreakpoint={2000}
                          disabledBackground
                          actions={[
                            {
                              label: 'Duplikuj',
                              onClick: () => void handleDuplicate(item.id),
                              icon: <Copy className="h-4 w-4" />,
                              variant: 'default',
                            },
                            {
                              label: deleting ? 'Usuwanie…' : 'Usuń',
                              onClick: () => void handleDelete(item.id, !!(item as any).is_kit),
                              icon: <Trash2 className="h-4 w-4" />,
                              variant: 'danger',
                            },
                          ]}
                        />
                      </div>
                    )}

                    <div
                      className="relative"
                      onClick={(e) => {
                        e.stopPropagation();
                        if ((item as any).is_kit)
                          router.push(`/crm/equipment/kits?edit=${item.id}`);
                        else router.push(`/crm/equipment/${item.id}`);
                      }}
                    >
                      {(item as any).thumbnail_url ? (
                        <Popover
                          trigger={
                            <Image
                              src={(item as any).thumbnail_url}
                              alt={(item as any).name}
                              width={128}
                              height={128}
                              className="mb-4 h-32 w-full cursor-pointer rounded-lg object-cover"
                            />
                          }
                          content={
                            <Image
                              src={(item as any).thumbnail_url}
                              alt={(item as any).name ?? 'Sprzęt'}
                              width={300}
                              height={300}
                              className="h-auto cursor-pointer rounded-lg object-contain transition-all"
                            />
                          }
                          openOn="hover"
                        />
                      ) : (
                        <div className="mb-4 flex h-32 w-full cursor-pointer items-center justify-center rounded-lg bg-[#0f1119]">
                          <Package className="h-12 w-12 text-[#e5e4e2]/40" />
                        </div>
                      )}

                      {!!(item as any).is_kit && (
                        <div className="pointer-events-none absolute left-2 top-2 rounded bg-[#d3bb73] px-2 py-1 text-xs font-medium text-[#1c1f33]">
                          ZESTAW
                        </div>
                      )}
                    </div>

                    <h3 className="mb-2 font-medium text-[#e5e4e2]">
                      {(item as any).name}
                      {!!(item as any).is_kit && (
                        <span className="ml-2 text-xs text-[#d3bb73]">ZESTAW</span>
                      )}
                      {(item as any).is_active === false && (
                        <span className="ml-2 text-xs text-red-400">NIEAKTYWNY</span>
                      )}
                    </h3>

                    {(item as any).warehouse_category_id && (
                      <p className="mb-2 flex items-center gap-1 text-xs text-[#e5e4e2]/40">
                        <ChevronRight className="h-3 w-3" />
                        {getCategoryPath((item as any).warehouse_category_id)}
                      </p>
                    )}

                    <div className="flex justify-between text-sm">
                      {!!(item as any).is_kit ? (
                        <span className="italic text-[#e5e4e2]/60">Zestaw</span>
                      ) : (
                        <span className={stock.color}>
                          {stock.available}/{stock.total}
                        </span>
                      )}
                      {(item as any).brand && (
                        <span className="text-[#e5e4e2]/60">{(item as any).brand}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}
        {viewMode === 'list' && (
          <div className="overflow-hidden rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]">
            {items.map((item) => {
              const stock = getStock(item as any as EquipmentListItem);
              return (
                <div
                  key={item.id}
                  onClick={() => {
                    if ((item as any).is_kit) router.push(`/crm/equipment/kits?edit=${item.id}`);
                    else router.push(`/crm/equipment/${item.id}`);
                  }}
                  className="flex cursor-pointer items-center gap-4 border-b border-[#d3bb73]/5 p-4 last:border-0 hover:bg-[#0f1119]"
                >
                  <div
                    className="relative"
                    onClick={(e) => {
                      e.stopPropagation();
                      if ((item as any).is_kit) router.push(`/crm/equipment/kits?edit=${item.id}`);
                      else router.push(`/crm/equipment/${item.id}`);
                    }}
                  >
                    {(item as any).thumbnail_url ? (
                      <Popover
                        trigger={
                          <Image
                            src={(item as any).thumbnail_url}
                            alt={(item as any).name ?? 'Sprzęt'}
                            width={48}
                            height={48}
                            className="h-12 w-12 cursor-pointer rounded-lg object-cover"
                          />
                        }
                        content={
                          <Image
                            width={300}
                            height={300}
                            src={(item as any).thumbnail_url}
                            alt={(item as any).name ?? 'Sprzęt'}
                            className="h-auto cursor-pointer rounded-lg object-contain transition-all"
                          />
                        }
                        openOn="hover"
                      />
                    ) : (
                      <div className="flex h-12 w-12 cursor-pointer items-center justify-center rounded-lg bg-[#0f1119]">
                        <Package className="h-6 w-6 text-[#e5e4e2]/40" />
                      </div>
                    )}

                    {!!(item as any).is_kit && (
                      <div className="pointer-events-none absolute -left-1 -top-1 rounded bg-[#d3bb73] px-1 text-[10px] font-medium text-[#1c1f33]">
                        KIT
                      </div>
                    )}
                  </div>

                  <div className="flex-1">
                    <h3 className="font-medium text-[#e5e4e2]">
                      {(item as any).name}
                      {!!(item as any).is_kit && (
                        <span className="ml-2 text-xs text-[#d3bb73]">ZESTAW</span>
                      )}
                      {(item as any).is_active === false && (
                        <span className="ml-2 text-xs text-red-400">NIEAKTYWNY</span>
                      )}
                    </h3>

                    <div className="flex gap-2 text-sm text-[#e5e4e2]/60">
                      {(item as any).brand && <span>{(item as any).brand}</span>}
                      {(item as any).warehouse_category_id && (
                        <>
                          <span>•</span>
                          <span className="flex items-center gap-1">
                            <ChevronRight className="h-3 w-3" />
                            {getCategoryPath((item as any).warehouse_category_id)}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    {!!(item as any).is_kit ? (
                      <span className="text-sm italic text-[#e5e4e2]/60">Zestaw</span>
                    ) : (
                      <span className={`text-sm ${stock.color}`}>
                        {stock.available}/{stock.total}
                      </span>
                    )}

                    {canManageEquipment && (
                      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        <ResponsiveActionBar
                          disabledBackground
                          mobileBreakpoint={2000}
                          actions={[
                            {
                              label: 'Duplikuj',
                              onClick: () => void handleDuplicate(item.id),
                              icon: <Copy className="h-4 w-4" />,
                              variant: 'default',
                            },
                            {
                              label: deleting ? 'Usuwanie…' : 'Usuń',
                              onClick: () => void handleDelete(item.id, !!(item as any).is_kit),
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
        {viewMode === 'table' && (
          <div className="overflow-hidden rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="bg-[#0f1119] text-[#e5e4e2]/70">
                  <tr className="border-b border-[#d3bb73]/10">
                    <th className="px-4 py-3 text-left font-medium">Nazwa</th>
                    <th className="px-4 py-3 text-left font-medium">Typ</th>
                    <th className="px-4 py-3 text-left font-medium">Kategoria</th>
                    <th className="px-4 py-3 text-left font-medium">Marka / Model</th>
                    <th className="px-4 py-3 text-left font-medium">Stan</th>
                    <th className="px-4 py-3 text-right font-medium">Akcje</th>
                  </tr>
                </thead>

                <tbody>
                  {items.map((item) => {
                    const isKit = !!(item as any).is_kit;
                    const stock = getStock(item as any as EquipmentListItem);
                    const categoryPath = (item as any).warehouse_category_id
                      ? getCategoryPath((item as any).warehouse_category_id)
                      : '';

                    return (
                      <tr
                        key={item.id}
                        onClick={() => {
                          if (isKit) router.push(`/crm/equipment/kits?edit=${item.id}`);
                          else router.push(`/crm/equipment/${item.id}`);
                        }}
                        className="cursor-pointer border-b border-[#d3bb73]/5 text-[#e5e4e2] hover:bg-[#0f1119]"
                      >
                        {/* Nazwa + miniatura */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            {(item as any).thumbnail_url ? (
                              <Popover
                                trigger={
                                  <Image
                                    src={(item as any).thumbnail_url}
                                    alt={(item as any).name ?? 'Sprzęt'}
                                    width={48}
                                    height={48}
                                    className="h-10 w-10 rounded-lg object-cover"
                                  />
                                }
                                content={
                                  <Image
                                    src={(item as any).thumbnail_url}
                                    alt={(item as any).name ?? 'Sprzęt'}
                                    width={300}
                                    height={300}
                                    className="h-auto rounded-lg object-contain transition-all"
                                  />
                                }
                                openOn="hover"
                              />
                            ) : (
                              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#0f1119]">
                                <Package className="h-5 w-5 text-[#e5e4e2]/40" />
                              </div>
                            )}

                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="truncate font-medium">{(item as any).name}</span>
                                {isKit && (
                                  <span className="rounded bg-[#d3bb73] px-2 py-0.5 text-[11px] font-semibold text-[#1c1f33]">
                                    ZESTAW
                                  </span>
                                )}
                                {(item as any).is_active === false && (
                                  <span className="rounded bg-red-500/15 px-2 py-0.5 text-[11px] font-semibold text-red-300">
                                    NIEAKTYWNY
                                  </span>
                                )}
                              </div>
                              {!!(item as any).id && (
                                <div className="truncate text-xs text-[#e5e4e2]/40">
                                  {item.brand} {item.model}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* Typ */}
                        <td className="px-4 py-3 text-[#e5e4e2]/70">
                          {isKit ? 'Zestaw' : 'Sprzęt'}
                        </td>

                        {/* Kategoria */}
                        <td className="px-4 py-3 text-[#e5e4e2]/70">
                          {categoryPath ? (
                            <span className="inline-flex items-center gap-1">
                              <ChevronRight className="h-3 w-3" />
                              <span className="max-w-[320px] truncate">{categoryPath}</span>
                            </span>
                          ) : (
                            <span className="text-[#e5e4e2]/40">—</span>
                          )}
                        </td>

                        {/* Marka/Model */}
                        <td className="px-4 py-3 text-[#e5e4e2]/70">
                          {(item as any).brand || (item as any).model ? (
                            <span>
                              {(item as any).brand ?? '—'}
                              {(item as any).model ? ` / ${(item as any).model}` : ''}
                            </span>
                          ) : (
                            <span className="text-[#e5e4e2]/40">—</span>
                          )}
                        </td>

                        {/* Stan (stock) */}
                        <td className="px-4 py-3">
                          {isKit ? (
                            <span className="italic text-[#e5e4e2]/60">Zestaw</span>
                          ) : (
                            <span className={`${stock.color} font-medium`}>
                              {stock.available}/{stock.total}
                            </span>
                          )}
                        </td>

                        {/* Akcje */}
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <div className="flex justify-end">
                            {canManageEquipment ? (
                              <ResponsiveActionBar
                                disabledBackground
                                mobileBreakpoint={2000}
                                actions={[
                                  {
                                    label: 'Duplikuj',
                                    onClick: () => void handleDuplicate(item.id),
                                    icon: <Copy className="h-4 w-4" />,
                                    variant: 'default',
                                  },
                                  {
                                    label: deleting ? 'Usuwanie…' : 'Usuń',
                                    onClick: () => void handleDelete(item.id, isKit),
                                    icon: <Trash2 className="h-4 w-4" />,
                                    variant: 'danger',
                                  },
                                ]}
                              />
                            ) : (
                              <span className="text-[#e5e4e2]/30">—</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {/* ✅ TO BYŁO KLUCZOWE: target dla IO (musi być w DOM) */}
        <div ref={observerTargetRef} className="h-1" />

        {/* opcjonalny loader w środku scrollboxa (jak w Messages) */}
        {hasMore && (
          <div className="flex items-center justify-center py-6 text-[#e5e4e2]/60">
            {isFetching ? 'Ładowanie…' : ' '}
          </div>
        )}
        {!hasMore && !isFetching && items.length > 0 && (
          <div className="py-6 text-center text-[#e5e4e2]/40">Koniec listy ✅</div>
        )}
      </div>
    </div>
  );
}
