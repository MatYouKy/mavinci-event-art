'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Search, Package, Trash2, Layers, MapPin, ChevronRight, Plug } from 'lucide-react';

import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { ResponsiveActionBar, Action } from '@/components/crm/ResponsiveActionBar';

import { useGetEquipmentFeedQuery, useDeleteEquipmentMutation } from './store/equipmentApi';
import { useAuth } from '@/features/auth/hooks/useAuth';
import {
  EquipmentCategories,
  EquipmentMainCategory,
  EquipmentMainCategoryLabels,
  IEquipment,
  IEquipmentUnit,
} from './types/equipment.types';
import { ItemActions } from '@/components/UI/ItemAction';
import { ViewModeType } from '@/components/UI/types/view.type';
import { ViewMode } from '@/components/crm/ViewMode/ViewMode';
import { EquipmentTable } from './components/EquipmentTable';
import { ThumbnailHoverPopper } from '@/components/UI/ThumbnailPopover';

type ItemTypeFilter = 'all' | 'equipment' | 'kits';

type SearchScope = 'all' | 'name' | 'brand' | 'model' | 'category';
type StockInfo = { available: number; total: number; color: string };

const normAny = (v: unknown) =>
  String(v ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

export default function EquipmentPage() {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const { canCreateInModule, canManageModule } = useCurrentEmployee();
  const { isAdmin } = useAuth();

  /* UI state */
  const [activeTab, setActiveTab] = useState<string>('all'); // 'all' | 'cables' | categoryId
  const [searchTerm, setSearchTerm] = useState('');
  const [searchScope, setSearchScope] = useState<SearchScope>('all'); // ⬅ NOWE
  const [viewMode, setViewMode] = useState<ViewModeType>('table');
  const [itemTypeFilter, setItemTypeFilter] = useState<ItemTypeFilter>('all');
  // paging dla feedu (nadal działa dla listy i grida, ale wyłączamy podczas search)
  const [page, setPage] = useState(0);
  const limit = 12;

  const canManage = isAdmin || canManageModule('equipment');
  const categoryId = activeTab !== 'all' ? activeTab : null;

  const searching = !!searchTerm.trim();
  const bigLimit = 1000; // ustaw rozsądny max, np. 500–2000

  const {
    data: feed,
    isLoading,
    isFetching,
    isError,
    refetch,
  } = useGetEquipmentFeedQuery({
    q: searching ? searchTerm : undefined,
    category: categoryId,
    page: searching ? 0 : page, // zawsze 0 gdy search
    limit: searching ? bigLimit : limit, // duży limit przy search
  });

  console.log('feed', feed);

  const [deleteEquipment, { isLoading: deleting }] = useDeleteEquipmentMutation();

  useEffect(() => {
    setPage(0);
  }, [searchTerm, searchScope, categoryId, itemTypeFilter]);

  // SCROLL tylko dla listy/grida — obserwujemy kontener listy
  const listRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const feedHasMore = !!feed?.hasMore;

  // podczas aktywnego searcha NIE dokładamy stron
  const enableInfinite = !searchTerm && viewMode !== 'table';

  useEffect(() => {
    if (!enableInfinite || !feedHasMore || isFetching) return;
    const root = listRef.current;
    const sentinel = sentinelRef.current;
    if (!root || !sentinel) return;

    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) setPage((p) => p + 1);
      },
      { root, rootMargin: '600px', threshold: 0 },
    );

    io.observe(sentinel);
    return () => io.disconnect();
  }, [enableInfinite, feedHasMore, isFetching]);

  // surowe elementy z API
  const items: IEquipment[] = useMemo(() => (feed?.items ?? []) as unknown as IEquipment[], [feed]);

  // 🔎 lokalne filtrowanie: zależne od scope
  const displayedItems = useMemo(() => {
    const q = normAny(searchTerm).trim();
    if (!q) return items;

    const match = (it: IEquipment) => {
      const name = normAny(it.name);
      const brand = normAny(it.brand);
      const model = normAny(it.model);
      const category = normAny(it.category); // np. 'audio'
      const subcategory = normAny(it.subcategory); // np. '1' lub 'stage'

      const categoryLabel = normAny(
        it.category != null
          ? EquipmentMainCategoryLabels[it.category as EquipmentMainCategory]
          : '',
      );

      // dodatkowo: etykieta subkategorii (jeśli masz mapę etykiet)
      const subcategoryLabel = normAny(
        it.category != null
          ? EquipmentCategories[it.category as EquipmentMainCategory]?.[Number(it.subcategory)]
          : '',
      );

      switch (searchScope) {
        case 'name':
          return name.includes(q);
        case 'brand':
          return brand.includes(q);
        case 'model':
          return model.includes(q);
        case 'category':
          return category.includes(q) || categoryLabel.includes(q) || subcategoryLabel.includes(q);
        case 'all':
        default:
          return (
            name.includes(q) ||
            brand.includes(q) ||
            model.includes(q) ||
            category.includes(q) ||
            subcategory.includes(q) ||
            subcategoryLabel.includes(q) ||
            categoryLabel.includes(q)
          );
      }
    };

    return items.filter(match);
  }, [items, searchTerm, searchScope]);

  const colorize = (available: number, total: number): StockInfo => {
    if (!total) return { available: 0, total: 0, color: 'text-gray-400' };
    const pct = (available / total) * 100;
    if (pct === 0) return { available, total, color: 'text-red-400' };
    if (pct < 50) return { available, total, color: 'text-orange-400' };
    return { available, total, color: 'text-green-400' };
  };


  // const getStock = (item: IEquipment): StockInfo => {
  //   if (item.is_kit) return { available: 0, total: 0, color: 'text-gray-400' };

  //   const q = item.quantity as any;


  //   // --- UNITIZED (jednostki) ---
  //   const units: IEquipmentUnit[] = (q?.units ?? []) as IEquipmentUnit[];
  //   const statusOf = (u: any) =>
  //     u.status ?? u.new_status ?? u.current_status ?? u.state ?? 'available';

  //   const total = units.length;
  //   const available = units.filter((u) => statusOf(u) === 'available').length;

  //   return colorize(available, total);
  // };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const ok = await showConfirm('Czy na pewno chcesz usunąć?', 'Usuń');
    if (!ok) return;
    try {
      await deleteEquipment(id).unwrap();
      showSnackbar('Usunięto', 'success');
      setPage(0);
      refetch();
    } catch {
      showSnackbar('Błąd podczas usuwania', 'error');
    }
  };

  const actions: Action[] = useMemo(() => {
    const baseActions: Action[] = [
      {
        label: 'Zestawy',
        onClick: () => router.push('/crm/equipment/kits'),
        icon: <Layers className="h-4 w-4" />,
        variant: 'default',
      },
      {
        label: 'Wtyczki',
        onClick: () => router.push('/crm/equipment/connectors'),
        icon: <Plug className="h-4 w-4" />,
        variant: 'default',
      },
      {
        label: 'Lokalizacje',
        onClick: () => router.push('/crm/equipment/locations'),
        icon: <MapPin className="h-4 w-4" />,
        variant: 'default',
      },
    ];

    const createAction: Action[] =
      isAdmin || canCreateInModule('equipment')
        ? [
            {
              label: 'Dodaj',
              onClick: () => router.push('/crm/equipment/new'),
              icon: <Plus className="h-4 w-4" />,
              variant: 'primary',
            },
          ]
        : [];

    return [...baseActions, ...createAction];
  }, [isAdmin, canCreateInModule, router]);

  /* ---------------- render ---------------- */
  if (isError) {
    return (
      <div className="text-[#e5e4e2]/80">
        Coś poszło nie tak.{' '}
        <button className="underline" onClick={() => refetch()}>
          Spróbuj ponownie
        </button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center text-[#e5e4e2]/60">Ładowanie...</div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-130px)] flex-col">
      {/* HEADER */}
      <div className="flex items-center justify-between border-b border-[#d3bb73]/10 bg-[#0f1119]/80 backdrop-blur-sm py-2 px-3">
        <h2 className="text-xl md:text-2xl font-light text-[#e5e4e2]">Magazyn</h2>
        <div className="ml-auto">
          <ResponsiveActionBar actions={actions} />
        </div>
      </div>

      {/* FILTRY + TABS + PSTRYCZKI */}
      <div className="space-y-2 border-b border-[#d3bb73]/10 bg-[#0f1119] px-3 py-2">
        {/* tabs */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          <button
            onClick={() => setActiveTab('all')}
            className={`relative whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition ${activeTab === 'all' ? 'text-[#0f1119] bg-[#d3bb73]' : 'text-[#e5e4e2]/70 hover:text-[#e5e4e2]'}`}
          >
            Wszystko
          </button>
        </div>

        {/* pstryczki + search */}
        {activeTab !== 'cables' && (
          <>
            <div className="flex items-center justify-between">
              <div className="w-full flex flex-wrap items-center gap-2">
                {/* typ wyświetlania */}
                <ViewMode viewMode={viewMode} setViewMode={setViewMode} />

                {/* filtr typu (placeholder) */}
                <div className="inline-flex rounded-lg overflow-hidden border border-[#d3bb73]/20 ml-auto">
                  {(['all', 'equipment', 'kits'] as const).map((k) => (
                    <button
                      key={k}
                      onClick={() => setItemTypeFilter(k)}
                      className={`px-2.5 py-1.5 text-xs capitalize ${itemTypeFilter === k ? 'bg-[#d3bb73] text-[#1c1f33]' : 'text-[#e5e4e2] bg-[#0f1119]'}`}
                      aria-pressed={itemTypeFilter === k}
                    >
                      {k === 'all' ? 'Wszystko' : k === 'equipment' ? 'Sprzęt' : 'Zestawy'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* SEARCH + SCOPE */}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#e5e4e2]/40" />
                <input
                  type="text"
                  placeholder={
                    searchScope === 'name'
                      ? 'Szukaj po nazwie…'
                      : searchScope === 'brand'
                        ? 'Szukaj po marce…'
                        : searchScope === 'model'
                          ? 'Szukaj po modelu…'
                          : 'Szukaj (nazwa, marka, model)…'
                  }
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setPage(0);
                  }}
                  className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] py-2 pl-9 pr-3 text-sm text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
                />
              </div>

              {/* zakres wyszukiwania */}
              <div className="inline-flex shrink-0 overflow-hidden rounded-lg border border-[#d3bb73]/20">
                {(['all', 'name', 'brand', 'model', 'category'] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => {
                      setSearchScope(s);
                      setPage(0);
                    }}
                    className={`px-2.5 py-2 text-xs ${
                      searchScope === s
                        ? 'bg-[#d3bb73] text-[#1c1f33]'
                        : 'text-[#e5e4e2] bg-[#0f1119]'
                    }`}
                    title={
                      s === 'all'
                        ? 'Szukaj we wszystkim'
                        : s === 'name'
                          ? 'Szukaj po nazwie'
                          : s === 'brand'
                            ? 'Szukaj po marce'
                            : s === 'model'
                              ? 'Szukaj po modelu'
                              : s === 'category'
                                ? 'Szukaj po kategorii'
                                : ''
                    }
                  >
                    {s === 'all'
                      ? 'Wszystko'
                      : s === 'name'
                        ? 'Nazwa'
                        : s === 'brand'
                          ? 'Marka'
                          : s === 'model'
                            ? 'Model'
                            : s === 'category'
                              ? 'Kategoria'
                              : ''}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* LISTA — tylko to się scrolluje */}
      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto p-2">
        {activeTab === 'cables' ? (
          <div className="py-12 text-center text-[#e5e4e2]/60">Brak sprzętu</div>
        ) : displayedItems.length === 0 ? (
          <div className="py-12 text-center text-[#e5e4e2]/60">Brak sprzętu</div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 gap-3 auto-rows-max md:grid-cols-2 lg:grid-cols-3">
            {displayedItems.map((item) => {
              // const stock = getStock(item);
              return (
                <div
                  key={item._id}
                  onClick={() =>
                    router.push(
                      item.is_kit
                        ? `/crm/equipment/kits?edit=${item._id}`
                        : `/crm/equipment/${item._id}`,
                    )
                  }
                  className="relative cursor-pointer rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-3 hover:border-[#d3bb73]/30"
                >
                  {canManage && (
                    <div className="absolute right-2 top-2" onClick={(e) => e.stopPropagation()}>
                      <ResponsiveActionBar
                        actions={[
                          {
                            label: deleting ? 'Usuwanie…' : 'Usuń',
                            // onClick: (e) => handleDelete(item._id, e as any),
                            onClick: () => {},
                            icon: <Trash2 className="h-4 w-4" />,
                            variant: 'danger',
                          },
                        ]}
                      />
                    </div>
                  )}
                  <div className="relative">
                    <ThumbnailHoverPopper
                      src={item.gallery.length > 0 ? item.thumbnail_url : null}
                      alt={item.name}
                      size={112}
                      previewMax={336}
                      nullIcon={<Package className="h-10 w-10 text-[#e5e4e2]/40" />}
                    />

                    {item.is_kit && (
                      <div className="absolute left-2 top-2 rounded bg-[#d3bb73] px-2 py-1 text-xs font-medium text-[#1c1f33]">
                        ZESTAW
                      </div>
                    )}
                  </div>
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-medium text-[#e5e4e2]">{item.name}</h3>
                    {item.brand && <span className="text-xs text-[#e5e4e2]/60">{item.brand}</span>}
                    {item.model && <span className="text-xs text-[#e5e4e2]/60">{item.model}</span>}
                  </div>
                  {/* <div className="mt-1 text-sm">
                    {item.is_kit ? (
                      <span className="italic text-[#e5e4e2]/60">Zestaw</span>
                    ) : (
                      <span className={stock.color}>
                        {stock.available}/{stock.total}
                      </span>
                    )}
                  </div> */}
                </div>
              );
            })}
          </div>
        ) : viewMode === 'table' ? (
          <EquipmentTable
            rows={displayedItems}
            onDelete={handleDelete}
            canManage={canManage}
            searchTerm={searchTerm}
          />
        ) : (
          <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]">
            {displayedItems.map((item) => {
              // const stock = getStock(item);
              return (
                <div
                  key={item._id}
                  onClick={() =>
                    router.push(
                      item.is_kit
                        ? `/crm/equipment/kits?edit=${item._id}`
                        : `/crm/equipment/${item._id}`,
                    )
                  }
                  className="flex cursor-pointer items-center gap-4 border-b border-[#d3bb73]/5 p-3 last:border-0 hover:bg-[#0f1119]"
                >
                  <div className="relative">
                    {item.gallery.length > 0 ? (
                      <ThumbnailHoverPopper
                        src={item.gallery.length > 0 ? item.thumbnail_url : null}
                        alt={item.name}
                        size={40}
                        previewMax={336}
                        nullIcon={<Package className="h-10 w-10 text-[#e5e4e2]/40" />}
                      />
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#0f1119]">
                        <Package className="h-5 w-5 text-[#e5e4e2]/40" />
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-medium text-[#e5e4e2]">
                      {item.name}{' '}
                      {item.brand && (
                        <span className="text-md text-[#e5e4e2]/60">{` | ${item.brand}`}</span>
                      )}{' '}
                      {item.model && (
                        <span className="text-md text-[#e5e4e2]/60">{` - ${item.model}`}</span>
                      )}
                    </h3>

                    {item.category && (
                      <div className="flex flex-wrap items-center text-xs text-[#e5e4e2]/60">
                        <span>
                          {EquipmentMainCategoryLabels[item.category as EquipmentMainCategory]}
                        </span>
                        {item.subcategory && (
                          <>
                            <ChevronRight className="mx-1 h-3 w-3 opacity-70" />
                            <span>
                              {EquipmentCategories[item.category as EquipmentMainCategory]?.[
                                Number(item.subcategory)
                              ] ?? item.subcategory}
                            </span>
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  {item.brand && (
                    <span className="flex min-w-24">
                      <span className="shrink-0 rounded border border-[#d3bb73]/20 bg-[#1c1f33] px-2 py-0.5 text-xs text-[#e5e4e2]/80">
                        {item.brand}
                      </span>
                    </span>
                  )}

                  <div className="flex items-center gap-4">
                    {/* {item.is_kit ? (
                      <span className="text-sm italic text-[#e5e4e2]/60">Zestaw</span>
                    ) : (
                      <span className={`text-sm ${stock.color}`}>
                        {stock.available}/{stock.total}
                      </span>
                    )} */}
                  </div>

                  <div className="ml-auto">
                    <ItemActions
                      onDelete={(e) => handleDelete(item._id, e as any)}
                      canManage={canManage}
                      withTitles={false}
                      collapseBelow="md"
                      className="ml-auto"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* sentinel + status (nie dotyczy tabeli i aktywnego searcha) */}
        <div ref={sentinelRef} />
        {isFetching && enableInfinite && (
          <div className="py-4 text-center text-[#e5e4e2]/60">Ładowanie…</div>
        )}
        {!feedHasMore && enableInfinite && !isFetching && displayedItems.length > 0 && (
          <div className="py-4 text-center text-[#e5e4e2]/40">To już wszystko 🎉</div>
        )}
      </div>
    </div>
  );
}
