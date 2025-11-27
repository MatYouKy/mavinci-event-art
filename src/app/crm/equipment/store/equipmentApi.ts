// src/app/crm/equipment/store/equipmentApi.ts
import { createApi } from '@reduxjs/toolkit/query/react';
import { fakeBaseQuery } from '@reduxjs/toolkit/query';
import { supabase } from '@/lib/supabase';
import { WarehouseCategoryRow } from '../categories/page';

type FeedParams = {
  q?: string;                // wyszukiwarka
  categoryId?: string|null;  // filtr kategorii (opcjonalnie)
  itemType?: 'all'|'equipment'|'kits';
  showCablesOnly?: boolean;  // czy pokazać tylko kable
  page?: number;             // numer strony (0,1,2…)
  limit?: number;            // ile rekordów na stronę
};

export const equipmentApi = createApi({
  reducerPath: 'equipmentApi',
  baseQuery: fakeBaseQuery(), // ← to chcieliśmy
  tagTypes: ['Equipment', 'EquipmentList', 'Units', 'ConnectorTypes', 'StorageLocations', 'Categories'],

  endpoints: (builder) => ({

    // === LISTA (dla /crm/equipment) ===
getEquipmentList: builder.query<{
  equipment_items: any[];
  equipment_kits: any[];
  warehouse_categories: any[];
}, void>({
  async queryFn() {
    const { data: categories, error: catErr } = await supabase
      .from('warehouse_categories')
      .select('*')
      .order('level')
      .order('name');
    if (catErr) return { error: catErr as any };

    const { data: items, error: itemsErr } = await supabase
      .from('equipment_items')
      .select(`
        id, name, warehouse_category_id, brand, model, thumbnail_url, description,
        warehouse_categories:warehouse_categories(*),
        equipment_units:equipment_units(id, status)
      `)
      .order('name');
    if (itemsErr) return { error: itemsErr as any };

    // <-- tu wchodzi poprawiona wersja dla kits
    const { data: kitsRaw, error: kitsErr } = await supabase
      .from('equipment_kits')
      .select(`
        id,
        name,
        warehouse_category_id,
        thumbnail_url,
        description,
        warehouse_categories:warehouse_categories(*)
      `)
      .order('name');
    if (kitsErr) return { error: kitsErr as any };

    const kits = (kitsRaw ?? []).map(k => ({ ...k, is_kit: true, equipment_units: [] }));

    return {
      data: {
        equipment_items: items ?? [],
        equipment_kits: kits,
        warehouse_categories: categories ?? [],
      },
    };
  },
  providesTags: ['EquipmentList'],
}),
getEquipmentFeed: builder.query<{
      items: any[];                     // połączone items + kits + cables
      total?: number | null;
      page: number;
      hasMore: boolean;
    }, FeedParams>({
      async queryFn({ q='', categoryId=null, itemType='all', showCablesOnly=false, page=0, limit=24 }) {
        const from = page * limit;
        const to   = from + limit - 1;

        // Jeśli pokazujemy tylko kable
        if (showCablesOnly) {
          let cablesQ = supabase
            .from('cables')
            .select(`
              id, name, warehouse_category_id, thumbnail_url, description, created_at, stock_quantity,
              cable_units:cable_units(id, status)
            `, { count: 'exact' })
            .is('deleted_at', null)
            .eq('is_active', true)
            .order('created_at', { ascending: false })
            .range(from, to);

          if (q) cablesQ = cablesQ.ilike('name', `%${q}%`);

          const cablesRes = await cablesQ;
          if (cablesRes.error) return { error: cablesRes.error as any };

          const cables = (cablesRes.data ?? []).map(c => ({
            ...c,
            is_cable: true,
            is_kit: false,
            equipment_units: c.cable_units || []
          }));

          const hasMore = (from + cables.length) < (cablesRes.count ?? 0);

          return { data: { items: cables, total: cablesRes.count, page, hasMore } };
        }

        // Pobierz podkategorie, jeśli categoryId jest kategoria główną
        let categoryIds: string[] = [];
        if (categoryId) {
          const { data: allCategories } = await supabase
            .from('warehouse_categories')
            .select('id, parent_id, level');

          if (allCategories) {
            const selectedCat = allCategories.find(c => c.id === categoryId);
            if (selectedCat) {
              // Dodaj wybraną kategorię
              categoryIds.push(categoryId);

              // Jeśli to kategoria level 1, dodaj wszystkie jej podkategorie
              if (selectedCat.level === 1) {
                const subcats = allCategories.filter(c => c.parent_id === categoryId);
                categoryIds.push(...subcats.map(c => c.id));
              }
            }
          }
        }

        // --- sprzęty (bez kabli) ---
        let itemsQ = supabase
          .from('equipment_items')
          .select(`
            id, name, warehouse_category_id, brand, model, thumbnail_url, description, created_at,
            equipment_units:equipment_units(id, status)
          `, { count: 'exact' })
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .range(from, to);

        if (q) itemsQ = itemsQ.or(`name.ilike.%${q}%,brand.ilike.%${q}%`);
        if (categoryIds.length > 0) itemsQ = itemsQ.in('warehouse_category_id', categoryIds);

        // --- kity ---
        let kitsQ = supabase
          .from('equipment_kits')
          .select(`
            id, name, warehouse_category_id, thumbnail_url, description, created_at
          `, { count: 'exact' })
          .order('created_at', { ascending: false })
          .range(from, to);

        if (q) kitsQ = kitsQ.ilike('name', `%${q}%`);
        if (categoryIds.length > 0) kitsQ = kitsQ.in('warehouse_category_id', categoryIds);

        const [itemsRes, kitsRes] = await Promise.all([itemsQ, kitsQ]);

        if (itemsRes.error) return { error: itemsRes.error as any };
        if (kitsRes.error)  return { error: kitsRes.error as any };

        // złącz i posortuj (po created_at DESC)
        let merged = [
          ...(itemsRes.data ?? []).map(i => ({ ...i, is_kit: false, is_cable: false })),
          ...(kitsRes.data  ?? []).map(k => ({ ...k, is_kit: true, is_cable: false, equipment_units: [] })),
        ].sort((a,b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));

        // filtr typu (all/equipment/kits)
        if (itemType === 'equipment') merged = merged.filter(i => !i.is_kit && !i.is_cable);
        if (itemType === 'kits')      merged = merged.filter(i =>  i.is_kit);

        const approxCount =
          (itemType !== 'kits' ? (itemsRes.count ?? 0) : 0) +
          (itemType !== 'equipment' ? (kitsRes.count ?? 0) : 0);

        const hasMore = (from + merged.length) < approxCount;

        return { data: { items: merged, total: approxCount, page, hasMore } };
      },
      // cache po parametrach
      serializeQueryArgs: ({ endpointName, queryArgs }) => {
        const { q='', categoryId=null, itemType='all' } = queryArgs ?? {};
        return `${endpointName}|q:${q}|cat:${categoryId}|type:${itemType}`;
      },
      // po zmianie page nie chcemy nadpisać cache klucza — RTKQ wywoła merge
      merge: (currentCache, newData) => {
        if (newData.page === 0) {
          currentCache.items = newData.items;
        } else {
          currentCache.items = [...currentCache.items, ...newData.items];
        }
        currentCache.page = newData.page;
        currentCache.hasMore = newData.hasMore;
        currentCache.total = newData.total;
      },
      forceRefetch({ currentArg, previousArg }) {
        // reset, gdy zmieni się q/category/itemType
        return JSON.stringify({ ...currentArg, page: 0 }) !== JSON.stringify({ ...previousArg, page: 0 });
      },
      providesTags: (_r) => ['EquipmentList'],
    }),
    // equipmentApi.ts
updateCableQuantity: builder.mutation<
  void,
  { equipmentId: string; quantity: number }
>({
  async queryFn({ equipmentId, quantity }) {
    const { error } = await supabase
      .from('equipment_items')
      .update({ cable_stock_quantity: quantity })
      .eq('id', equipmentId);

    if (error) return { error: error as any };
    return { data: undefined };
  },
  // odświeży szczegóły konkretnego sprzętu oraz listing (jeśli tak tagujesz)
  invalidatesTags: (_r, _e, { equipmentId }) => [
    { type: 'Equipment', id: equipmentId },
    'EquipmentList',
  ],
}),


    // szczegóły sprzętu
    getEquipmentDetails: builder.query<any, string>({
      async queryFn(id) {
        const { data, error } = await supabase
          .from('equipment_items')
          .select(`
            *,
            warehouse_categories:warehouse_categories(*),
            equipment_stock:equipment_stock(*),
            equipment_components:equipment_components(*),
            equipment_images:equipment_images(*)
          `)
          .eq('id', id)
          .single();
        if (error) return { error: error as any };
        return { data };
      },
      providesTags: (_res, _err, id) => [{ type: 'Equipment', id }],
    }),

    // szczegóły kabla
    getCableDetails: builder.query<any, string>({
      async queryFn(id) {
        console.log('getCableDetails - fetching cable:', id);
        const { data, error } = await supabase
          .from('cables')
          .select(`
            *,
            warehouse_categories:warehouse_categories(*),
            storage_location:storage_locations(id, name),
            connector_in_type:connector_types!cables_connector_in_fkey(id, name, thumbnail_url),
            connector_out_type:connector_types!cables_connector_out_fkey(id, name, thumbnail_url)
          `)
          .eq('id', id)
          .single();
        if (error) {
          console.error('getCableDetails - error:', error);
          return { error: error as any };
        }
        console.log('getCableDetails - fetched data:', data);
        return { data };
      },
      providesTags: (_res, _err, id) => {
        console.log('getCableDetails - providing tag for:', id);
        return [{ type: 'Equipment', id }];
      },
    }),

    // jednostki kabla
    getCableUnits: builder.query<any[], string>({
      async queryFn(cableId) {
        const { data, error } = await supabase
          .from('cable_units')
          .select(`
            *,
            storage_locations:storage_locations(id, name)
          `)
          .eq('cable_id', cableId)
          .order('created_at', { ascending: false });

        if (error) return { error: error as any };
        return { data: data ?? [] };
      },
      providesTags: (result, _err, id) => [
        { type: 'Units', id },
        ...((result ?? []).map((u: any) => ({ type: 'Units' as const, id: u.id }))),
      ],
    }),

    // aktualizacja sprzętu
    updateEquipmentItem: builder.mutation<
      { success: true },
      { id: string; payload: Record<string, any> }
    >({
      async queryFn({ id, payload }) {
        const { error } = await supabase
          .from('equipment_items')
          .update(payload)
          .eq('id', id);

        if (error) return { error: error as any };
        return { data: { success: true } };
      },
      invalidatesTags: (_result, _error, { id }) => [
        { type: 'Equipment', id },
        'EquipmentList',
      ],
    }),

    // aktualizacja kabla
    updateCable: builder.mutation<
      { success: true },
      { id: string; payload: Record<string, any> }
    >({
      async queryFn({ id, payload }) {
        console.log('updateCable mutation - updating cable:', id, payload);

        // Sprawdź sesję użytkownika
        const { data: { session } } = await supabase.auth.getSession();
        console.log('Current session:', session ? `User: ${session.user.email}` : 'NO SESSION');

        const { data, error } = await supabase
          .from('cables')
          .update(payload)
          .eq('id', id)
          .select()
          .single();

        if (error) {
          console.error('updateCable mutation - error:', error);
          return { error: error as any };
        }

        console.log('updateCable mutation - success, updated data:', data);
        return { data };
      },
      invalidatesTags: (_result, _error, { id }) => {
        console.log('Invalidating tags for cable:', id);
        return [
          { type: 'Equipment', id },
          'EquipmentList',
        ];
      },
    }),

    // dodawanie jednostki kabla
    addCableUnit: builder.mutation<
      { success: true },
      { cable_id: string; serial_number?: string; status?: string }
    >({
      async queryFn({ cable_id, serial_number, status = 'available' }) {
        const { error } = await supabase
          .from('cable_units')
          .insert({ cable_id, serial_number, status });

        if (error) return { error: error as any };
        return { data: { success: true } };
      },
      invalidatesTags: (_result, _error, { cable_id }) => [
        { type: 'Units', id: cable_id },
      ],
    }),

    // usuwanie jednostki kabla
    deleteCableUnit: builder.mutation<
      { success: true },
      { id: string; cable_id: string }
    >({
      async queryFn({ id }) {
        const { error } = await supabase
          .from('cable_units')
          .delete()
          .eq('id', id);

        if (error) return { error: error as any };
        return { data: { success: true } };
      },
      invalidatesTags: (_result, _error, { cable_id }) => [
        { type: 'Units', id: cable_id },
      ],
    }),

    // kasowanie pojedynczego sprzętu (nie dotyczy kitów)
deleteEquipment: builder.mutation<{ success: true }, string>({
  async queryFn(id) {
    // 1) spróbuj w equipment_items
    const { error: delItemsErr } = await supabase
      .from('equipment_items')
      .delete()
      .eq('id', id);

    if (!delItemsErr) {
      return { data: { success: true } };
    }

    // 2) jeśli błąd, spróbuj w equipment_kits
    const { error: delKitsErr } = await supabase
      .from('equipment_kits')
      .delete()
      .eq('id', id);

    if (!delKitsErr) {
      return { data: { success: true } };
    }

    // 3) zwróć pierwszy błąd (często bardziej informacyjny)
    return { error: delItemsErr as any };
  },
  invalidatesTags: ['Equipment'],
}),

    // === JEDNOSTKI SPRZĘTU dla danego equipment_id ===
    getUnitsByEquipment: builder.query<any[], string>({
      async queryFn(equipmentId) {
        const { data, error } = await supabase
          .from('equipment_units')
          .select(`
            *,
            storage_locations:storage_locations(id, name)
          `)
          .eq('equipment_id', equipmentId)
          .order('created_at', { ascending: false });

        if (error) return { error: error as any };
        return { data: data ?? [] };
      },
      providesTags: (result, _err, id) => [
        { type: 'Units', id },
        ...((result ?? []).map((u: any) => ({ type: 'Units' as const, id: u.id }))),
      ],
    }),

    // === SŁOWNIKI ===
    getConnectorTypes: builder.query<any[], void>({
      async queryFn() {
        const { data, error } = await supabase
          .from('connector_types')
          .select('*')
          .eq('is_active', true)
          .order('name');
        if (error) return { error: error as any };
        return { data: data ?? [] };
      },
      providesTags: ['ConnectorTypes'],
    }),

    getStorageLocations: builder.query<any[], void>({
      async queryFn() {
        const { data, error } = await supabase
          .from('storage_locations')
          .select('id, name')
          .eq('is_active', true)
          .order('name');
        if (error) return { error: error as any };
        return { data: data ?? [] };
      },
      providesTags: ['StorageLocations'],
    }),
        getEquipmentCategories: builder.query<any[], void>({
      async queryFn() {
        const { data, error } = await supabase
          .from('warehouse_categories')
          .select('*')
          .eq('is_active', true)
          .order('level', { ascending: true })
          .order('order_index', { ascending: true });
        if (error) return { error: error as any };
        return { data: data ?? [] };
      },
      providesTags: ['Categories'],
    }),

    // equipmentApi.ts (only the 3 category mutations changed)

// Return the inserted row so `data` is always defined
createWarehouseCategory: builder.mutation<
  WarehouseCategoryRow, // return type
  {
    name: string;
    description: string | null;
    level: 1 | 2;
    parent_id: string | null;
    order_index: number;
    color?: string;
    special_properties: { name: string; value: boolean }[];
  }
>({
  async queryFn(payload) {
    const { data, error } = await supabase
      .from('warehouse_categories')
      .insert({
        ...payload,
        is_active: true,
        color: payload.color ?? '#d3bb73',
        created_at: new Date().toISOString(),
      })
      .select('*')      // 👈 ensure a row is returned
      .single();        // 👈 single row

    if (error) return { error: error as any };
    return { data: data as WarehouseCategoryRow };
  },
  invalidatesTags: ['Categories'],
}),

// Return the updated row (via .select().single())
updateWarehouseCategory: builder.mutation<
  WarehouseCategoryRow, // return the updated row
  {
    id: string;
    name?: string;
    description?: string | null;
    special_properties?: { name: string; value: boolean }[];
  }
>({
  async queryFn({ id, ...patch }) {
    const { data, error } = await supabase
      .from('warehouse_categories')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')      // 👈 return the updated row
      .single();

    if (error) return { error: error as any };
    return { data: data as WarehouseCategoryRow };
  },
  invalidatesTags: ['Categories'],
}),

// Return a success object (not undefined)
deleteWarehouseCategory: builder.mutation<
  { success: true },            // explicit non-undefined payload
  { id: string }
>({
  async queryFn({ id }) {
    const { error } = await supabase
      .from('warehouse_categories')
      .delete()
      .eq('id', id);

    if (error) return { error: error as any };
    return { data: { success: true } };   // 👈 defined data
  },
  invalidatesTags: ['Categories'],
}),
   
  }),
});

export const {
  useGetEquipmentCategoriesQuery,
  useCreateWarehouseCategoryMutation,
  useUpdateWarehouseCategoryMutation,
  useDeleteWarehouseCategoryMutation,

  useGetEquipmentListQuery,
  useGetEquipmentDetailsQuery,
  useGetCableDetailsQuery,
  useGetUnitsByEquipmentQuery,
  useGetCableUnitsQuery,
  useGetConnectorTypesQuery,
  useGetStorageLocationsQuery,
  useUpdateEquipmentItemMutation,
  useUpdateCableMutation,
  useAddCableUnitMutation,
  useDeleteCableUnitMutation,
  useDeleteEquipmentMutation,
  useGetEquipmentFeedQuery,
  useLazyGetEquipmentFeedQuery,
  useUpdateCableQuantityMutation,
} = equipmentApi;