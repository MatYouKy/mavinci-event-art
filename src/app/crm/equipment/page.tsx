'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Plus, Search, Package, Grid, List, Trash2, ChevronRight,
  FolderTree, Layers, MapPin
} from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { ThreeDotMenu } from '@/components/UI/ThreeDotMenu/ThreeDotMenu';
import ResponsiveActionBar from '@/components/crm/ResponsiveActionBar';

// ⬇️ RTK Query – feed + kategorie + delete
import {
  useGetEquipmentFeedQuery,
  useGetEquipmentCategoriesQuery,
  useDeleteEquipmentMutation,
} from './store/equipmentApi';

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
  brand?: string | null;          // dla kits może być null
  model?: string | null;          // dla kits może być null
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
  const [activeTab, setActiveTab] = useState<string>('all'); // 'all' | categoryId
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
  const [itemTypeFilter, setItemTypeFilter] = useState<'all' | 'equipment' | 'kits'>('all');

  // Paginacja do infinite scroll
  const [page, setPage] = useState(0);
  const limit = 24;

  // Kategoria do filtra feedu (z activeTab, ale bez 'all')
  const categoryId = activeTab !== 'all' ? activeTab : null;

  // Hooki RTKQ
  const { data: categories = [], isLoading: catLoading, isError: catError, refetch: refetchCats } =
    useGetEquipmentCategoriesQuery();

  const {
    data: feed,
    isLoading,
    isFetching, // true również przy dociąganiu kolejnych stron
    isError,
    refetch,
  } = useGetEquipmentFeedQuery({ q: searchTerm, categoryId, itemType: itemTypeFilter, page, limit });

  const [deleteEquipment, { isLoading: deleting }] = useDeleteEquipmentMutation();

  // Reset strony przy zmianie filtrów
  useEffect(() => {
    setPage(0);
  }, [searchTerm, categoryId, itemTypeFilter]);

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
      { rootMargin: '800px' }
    );

    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, isFetching]);

  // Lista elementów do renderu
  const items: EquipmentListItem[] = useMemo(() => feed?.items ?? [], [feed]);

  // Kategorie – helpery
  const mainCategories: WarehouseCategory[] = useMemo(
    () => categories.filter((c) => c.level === 1),
    [categories]
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
    } catch {
      showSnackbar('Błąd podczas usuwania', 'error');
    }
  };

  // Błędy / loading (kategorie albo feed)
  if (isError || catError) {
    return (
      <div className="text-[#e5e4e2]/80">
        Coś poszło nie tak.{' '}
        <button className="underline" onClick={() => { refetch(); refetchCats(); }}>
          Spróbuj ponownie
        </button>
      </div>
    );
  }

  if (isLoading || catLoading) {
    return <div className="flex items-center justify-center h-64 text-[#e5e4e2]/60">Ładowanie...</div>;
  }

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-light text-[#e5e4e2]">Magazyn</h2>

        {/* Desktop */}
        <div className="hidden md:flex gap-2">
          {canManageModule('equipment') && (
            <>
              <button
                onClick={() => router.push('/crm/equipment/categories')}
                className="flex items-center gap-2 bg-[#1c1f33] border border-[#d3bb73]/20 text-[#e5e4e2] px-4 py-2 rounded-lg hover:border-[#d3bb73]/40"
              >
                <FolderTree className="w-4 h-4" />
                Kategorie
              </button>
              <button
                onClick={() => router.push('/crm/equipment/kits')}
                className="flex items-center gap-2 bg-[#1c1f33] border border-[#d3bb73]/20 text-[#e5e4e2] px-4 py-2 rounded-lg hover:border-[#d3bb73]/40"
              >
                <Layers className="w-4 h-4" />
                Zestawy
              </button>
              <button
                onClick={() => router.push('/crm/equipment/locations')}
                className="flex items-center gap-2 bg-[#1c1f33] border border-[#d3bb73]/20 text-[#e5e4e2] px-4 py-2 rounded-lg hover:border-[#d3bb73]/40"
              >
                <MapPin className="w-4 h-4" />
                Lokalizacje
              </button>
            </>
          )}
          {canCreateInModule('equipment') && (
            <button
              onClick={() => router.push('/crm/equipment/new')}
              className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg hover:bg-[#d3bb73]/90"
            >
              <Plus className="w-4 h-4" />
              Dodaj
            </button>
          )}
        </div>

        {/* Mobile */}
        <div className="flex md:hidden gap-2">
          {canManageModule('equipment') && (
            <div className="relative">
              <ThreeDotMenu
                menuPosition="right-top"
                menu_items={[
                  {
                    children: (
                      <div className="flex items-center gap-2 px-4 py-2">
                        <FolderTree className="w-4 h-4" />
                        <span>Kategorie</span>
                      </div>
                    ),
                    onClick: () => router.push('/crm/equipment/categories'),
                  },
                  {
                    children: (
                      <div className="flex items-center gap-2 px-4 py-2">
                        <Layers className="w-4 h-4" />
                        <span>Zestawy</span>
                      </div>
                    ),
                    onClick: () => router.push('/crm/equipment/kits'),
                  },
                  {
                    children: (
                      <div className="flex items-center gap-2 px-4 py-2">
                        <MapPin className="w-4 h-4" />
                        <span>Lokalizacje</span>
                      </div>
                    ),
                    onClick: () => router.push('/crm/equipment/locations'),
                  },
                ]}
              />
            </div>
          )}
          {canCreateInModule('equipment') && (
            <button
              onClick={() => router.push('/crm/equipment/new')}
              className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg hover:bg-[#d3bb73]/90"
            >
              <Plus className="w-4 h-4" />
              Dodaj
            </button>
          )}
        </div>
      </div>

      {/* TABS */}
      <div className="flex gap-2 border-b border-[#d3bb73]/10 overflow-x-auto">
        <button
          onClick={() => setActiveTab('all')}
          className={`px-4 py-2 text-sm relative whitespace-nowrap ${activeTab === 'all' ? 'text-[#d3bb73]' : 'text-[#e5e4e2]/60'}`}
        >
          <div className="flex items-center gap-2">
            <Package className="w-4 h-4" />
            Wszystko
          </div>
          {activeTab === 'all' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#d3bb73]" />}
        </button>

        {mainCategories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setActiveTab(cat.id)}
            className={`px-4 py-2 text-sm relative whitespace-nowrap ${activeTab === cat.id ? 'text-[#d3bb73]' : 'text-[#e5e4e2]/60'}`}
          >
            {cat.name}
            {activeTab === cat.id && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#d3bb73]" />}
          </button>
        ))}
      </div>

      {/* Filtry typu */}
      <div className="flex gap-2">
            {(['all', 'equipment', 'kits'] as const).map((k) => (
              <button
                key={k}
                onClick={() => setItemTypeFilter(k)}
                className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                  itemTypeFilter === k ? 'bg-[#d3bb73] text-[#1c1f33]' : 'bg-[#1c1f33] text-[#e5e4e2] hover:bg-[#1c1f33]/80'
                }`}
              >
                {k === 'all' ? 'Wszystko' : k === 'equipment' ? 'Tylko sprzęt' : 'Tylko zestawy'}
              </button>
            ))}
          </div>

          {/* Search + toggle view */}
          <div className="flex gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#e5e4e2]/40" />
              <input
                type="text"
                placeholder="Szukaj..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-[#1c1f33] border border-[#d3bb73]/10 rounded-lg pl-10 pr-4 py-2.5 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setViewMode('list')}
                className={`p-2 rounded-lg ${viewMode === 'list' ? 'bg-[#d3bb73] text-[#1c1f33]' : 'bg-[#1c1f33] text-[#e5e4e2]'}`}
              >
                <List className="w-5 h-5" />
              </button>
              <button
                onClick={() => setViewMode('grid')}
                className={`p-2 rounded-lg ${viewMode === 'grid' ? 'bg-[#d3bb73] text-[#1c1f33]' : 'bg-[#1c1f33] text-[#e5e4e2]'}`}
              >
                <Grid className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Lista */}
          {items.length === 0 ? (
            <div className="text-center py-12 text-[#e5e4e2]/60">Brak sprzętu</div>
          ) : viewMode === 'grid' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {items.map((item) => {
                const stock = getStock(item);
                return (
                  <div
                    key={item.id}
                    onClick={() =>
                      router.push(item.is_kit ? `/crm/equipment/kits?edit=${item.id}` : `/crm/equipment/${item.id}`)
                    }
                    className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6 hover:border-[#d3bb73]/30 cursor-pointer relative"
                  >
{canManageModule('equipment') && (
  <div
    className="absolute top-2 right-2"
    onClick={(e) => e.stopPropagation()}
  >
    <ResponsiveActionBar
      actions={[
        {
          label: deleting ? 'Usuwanie…' : 'Usuń',
          onClick: () => {
            // ignorujemy Promise żeby zgadzał się typ () => void
            void handleDelete(item.id);
          },
          icon: <Trash2 className="w-4 h-4" />,
          variant: 'danger',
        },
      ]}
    />
  </div>
)}
                    <div className="relative">
                      {item.thumbnail_url ? (
                        <img src={item.thumbnail_url} alt={item.name} className="w-full h-32 object-cover rounded-lg mb-4" />
                      ) : (
                        <div className="w-full h-32 bg-[#0f1119] rounded-lg mb-4 flex items-center justify-center">
                          <Package className="w-12 h-12 text-[#e5e4e2]/40" />
                        </div>
                      )}
                      {item.is_kit && (
                        <div className="absolute top-2 left-2 bg-[#d3bb73] text-[#1c1f33] text-xs font-medium px-2 py-1 rounded">
                          ZESTAW
                        </div>
                      )}
                    </div>
                    <h3 className="text-[#e5e4e2] font-medium mb-2">
                      {item.name}
                      {item.is_kit && <span className="ml-2 text-xs text-[#d3bb73]">ZESTAW</span>}
                    </h3>
                    {item.warehouse_category_id && (
                      <p className="text-xs text-[#e5e4e2]/40 mb-2 flex items-center gap-1">
                        <ChevronRight className="w-3 h-3" />
                        {getCategoryPath(item.warehouse_category_id)}
                      </p>
                    )}
                    <div className="flex justify-between text-sm">
                      {item.is_kit ? (
                        <span className="text-[#e5e4e2]/60 italic">Zestaw</span>
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
            <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl overflow-hidden">
              {items.map((item) => {
                const stock = getStock(item);
                return (
                  <div
                    key={item.id}
                    onClick={() =>
                      router.push(item.is_kit ? `/crm/equipment/kits?edit=${item.id}` : `/crm/equipment/${item.id}`)
                    }
                    className="flex items-center gap-4 p-4 hover:bg-[#0f1119] cursor-pointer border-b border-[#d3bb73]/5 last:border-0"
                  >
                    <div className="relative">
                      {item.thumbnail_url ? (
                        <img src={item.thumbnail_url} alt={item.name} className="w-12 h-12 rounded-lg object-cover" />
                      ) : (
                        <div className="w-12 h-12 bg-[#0f1119] rounded-lg flex items-center justify-center">
                          <Package className="w-6 h-6 text-[#e5e4e2]/40" />
                        </div>
                      )}
                      {item.is_kit && (
                        <div className="absolute -top-1 -left-1 bg-[#d3bb73] text-[#1c1f33] text-[10px] font-medium px-1 rounded">
                          KIT
                        </div>
                      )}
                    </div>
                    <div className="flex-1">
                      <h3 className="text-[#e5e4e2] font-medium">
                        {item.name}
                        {item.is_kit && <span className="ml-2 text-xs text-[#d3bb73]">ZESTAW</span>}
                      </h3>
                      <div className="flex gap-2 text-sm text-[#e5e4e2]/60">
                        {item.brand && <span>{item.brand}</span>}
                        {item.warehouse_category_id && (
                          <>
                            <span>•</span>
                            <span className="flex items-center gap-1">
                              <ChevronRight className="w-3 h-3" />
                              {getCategoryPath(item.warehouse_category_id)}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      {item.is_kit ? (
                        <span className="text-sm text-[#e5e4e2]/60 italic">Zestaw</span>
                      ) : (
                        <span className={`text-sm ${stock.color}`}>
                          {stock.available}/{stock.total}
                        </span>
                      )}
                      {canManageModule('equipment') && (
  <div
    className="absolute top-2 right-2"
    onClick={(e) => e.stopPropagation()}
  >
    <ResponsiveActionBar
      actions={[
        {
          label: deleting ? 'Usuwanie…' : 'Usuń',
          onClick: () => {
            // ignorujemy Promise żeby zgadzał się typ () => void
            void handleDelete(item.id);
          },
          icon: <Trash2 className="w-4 h-4" />,
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