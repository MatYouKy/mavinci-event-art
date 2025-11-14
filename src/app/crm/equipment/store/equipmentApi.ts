import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import {
  IEquipment,
  IEquipmentHistory,
  IEquipmentUnit,
  IStorageLocation,
} from '../types/equipment.types';
import { ISingleImage } from '@/types/image';
import { CreateConnectorBody, IConnectorType, UpdateConnectorBody } from '../connectors/connector.type';

type ID = string;

export type FeedParams = {
  q?: string;
  category?: string | null;
  page?: number;
  limit?: number;
};

export const baseUrl = process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:4000';

export const equipmentApi = createApi({
  reducerPath: 'equipmentApi',
  baseQuery: fetchBaseQuery({
    baseUrl: `${baseUrl}/api/mavinci/crm`,
    credentials: 'include',
    prepareHeaders: (headers) => {
      if (typeof window !== 'undefined') {
        const token = localStorage.getItem('token');
        if (token) headers.set('authorization', `Bearer ${token}`);
      }
      return headers;
    },
  }),
  tagTypes: [
    'Equipment',
    'EquipmentList',
    'Units',
    'Gallery',
    'History',
    'Categories',
    'StorageLocations',
    'ConnectorTypes',
  ],
  endpoints: (builder) => ({
    getUnitsByEquipment: builder.query<IEquipmentUnit[], string>({
      query: (eid) => `/equipment/${eid}/units`,
      transformResponse: (res: { units?: IEquipmentUnit[] } | undefined) => res?.units ?? [],
      providesTags: (_res, _err, eid) => [{ type: 'Units', id: eid }],
    }),
    /* ===================== LISTA / FEED ===================== */

    getEquipmentList: builder.query<IEquipment[], void>({
      query: () => `/equipment`,
      transformResponse: (res: { equipment: IEquipment[] }) => res?.equipment ?? [],
      providesTags: ['EquipmentList'],
    }),
    getEquipmentById: builder.query<IEquipment, string>({
      query: (id) => `/equipment/${id}`,
      transformResponse: (res: { equipment: IEquipment }) => res?.equipment,
      providesTags: (_r, _e, id) => [{ type: 'Equipment', id }],
    }),

    getEquipmentFeed: builder.query<
      { items: IEquipment[]; page: number; hasMore: boolean; total?: number },
      FeedParams
    >({
      query: ({ q = '', category = null, page = 0, limit = 24 }) => {
        const params = new URLSearchParams();
        if (q) params.set('q', q);
        if (category) params.set('category', category);
        params.set('page', String(page));
        params.set('limit', String(limit));
        return `/equipment?${params.toString()}`;
      },
      transformResponse: (res: any) => {
        if (Array.isArray(res?.equipment)) {
          return {
            items: res.equipment,
            page: 0,
            hasMore: false,
            total: res.equipment.length,
          };
        }
        return res;
      },
      serializeQueryArgs: ({ endpointName, queryArgs }) => {
        const { q = '', category = '', page = 0, limit = 24 } = queryArgs || {};
        return `${endpointName}|q:${q}|cat:${category}|p:${page}|l:${limit}`;
      },
      merge: (currentCache, newData) => {
        if (newData.page === 0) currentCache.items = newData.items;
        else currentCache.items = [...currentCache.items, ...newData.items];
        currentCache.page = newData.page;
        currentCache.hasMore = newData.hasMore;
        currentCache.total = newData.total;
      },
      forceRefetch({ currentArg, previousArg }) {
        if (!currentArg || !previousArg) return true;
        const a = { ...currentArg, page: 0 };
        const b = { ...previousArg, page: 0 };
        return JSON.stringify(a) !== JSON.stringify(b);
      },
      providesTags: ['EquipmentList'],
    }),

    /* ===================== SZCZEGÓŁY ===================== */

    getEquipmentDetails: builder.query<
      {
        equipment: IEquipment;
        gallery: ISingleImage[];
        units: IEquipmentUnit[];
        components: any[];
        history: IEquipmentHistory[];
      },
      ID
    >({
      query: (eid) => `/equipment/${eid}`,
      providesTags: (_r, _e, id) => [{ type: 'Equipment', id }],
    }),

    /* ===================== CRUD SPRZĘTU ===================== */

    createEquipment: builder.mutation<{ equipment: IEquipment }, FormData>({
      query: (payload) => {
        console.log('payload', payload);
        return {
          url: `/equipment?page_type=mavinci/crm/equipment`,
          method: 'POST',
          body: payload,
        };
      },
      invalidatesTags: ['EquipmentList'],
    }),

    updateEquipment: builder.mutation<{ equipment: IEquipment }, { id: ID; patch: FormData }>({
      query: ({ id, patch }) => ({
        url: `/equipment/${id}?page_type=mavinci/crm/equipment`,
        method: 'PATCH',
        body: patch,
      }),
      invalidatesTags: (_r, _e, { id }) => [{ type: 'Equipment', id }, 'EquipmentList'],
    }),

    deleteEquipment: builder.mutation<{ id: ID }, ID>({
      query: (id) => ({
        url: `/equipment/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: ['EquipmentList'],
    }),

    /* ===================== UNITS ===================== */

    addUnit: builder.mutation<
      { unit: IEquipmentUnit },
      { eid: ID; payload: Partial<IEquipmentUnit> }
    >({
      query: ({ eid, payload }) => ({
        url: `/equipment/${eid}/units`,
        method: 'POST',
        body: payload,
      }),
      invalidatesTags: (_r, _e, { eid }) => [
        { type: 'Units', id: eid },
        { type: 'Equipment', id: eid },
      ],
    }),

    deleteUnit: builder.mutation<{ id: ID }, { eid: ID; uid: ID }>({
      query: ({ eid, uid }) => ({
        url: `/equipment/${eid}/units/${uid}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_r, _e, { eid }) => [
        { type: 'Units', id: eid },
        { type: 'Equipment', id: eid },
      ],
    }),

    /* ===================== GALERIA ===================== */

    addGalleryItem: builder.mutation<
      { item: ISingleImage[] | ISingleImage },
      { eid: ID; payload: { image: { url: string; alt?: string }; is_main?: boolean } }
    >({
      query: ({ eid, payload }) => ({
        url: `/equipment/${eid}/gallery`,
        method: 'POST',
        body: payload,
      }),
      invalidatesTags: (_r, _e, { eid }) => [
        { type: 'Gallery', id: eid },
        { type: 'Equipment', id: eid },
      ],
    }),

    setMainGalleryItem: builder.mutation<{ ok: true }, { eid: ID; gid: ID }>({
      query: ({ eid, gid }) => ({
        url: `/equipment/${eid}/gallery/${gid}/main`,
        method: 'PATCH',
      }),
      invalidatesTags: (_r, _e, { eid }) => [
        { type: 'Gallery', id: eid },
        { type: 'Equipment', id: eid },
      ],
    }),

    /* ===================== HISTORIA ===================== */

    addHistoryEntry: builder.mutation<
      { entry: IEquipmentHistory },
      {
        eid: ID;
        payload: Partial<IEquipmentHistory> & { quantity_change?: number; quantity_after?: number };
      }
    >({
      query: ({ eid, payload }) => ({
        url: `/equipment/${eid}/history`,
        method: 'POST',
        body: payload,
      }),
      invalidatesTags: (_r, _e, { eid }) => [{ type: 'History', id: eid }],
    }),

    /* ===================== KATEGORIE ===================== */

    getEquipmentCategories: builder.query<any[], void>({
      query: () => `/equipment/categories`,
      transformResponse: (res: { categories: any[] }) => res?.categories ?? [],
      providesTags: ['Categories'],
    }),

    /* ===================== STORAGE LOCATIONS ===================== */

    getStorageLocations: builder.query<IStorageLocation[], void>({
      query: () => `/storage-locations`,
      transformResponse: (res: { locations: IStorageLocation[] }) => res?.locations ?? [],
      providesTags: ['StorageLocations'],
    }),

    getStorageLocationById: builder.query<IStorageLocation, ID>({
      query: (id) => `/storage-locations/${id}`,
      transformResponse: (res: { location: IStorageLocation }) => res.location,
      providesTags: (_r, _e, id) => [{ type: 'StorageLocations', id }],
    }),

    createStorageLocation: builder.mutation<
      { location: IStorageLocation },
      Partial<IStorageLocation>
    >({
      query: (payload) => ({
        url: `/storage-locations`,
        method: 'POST',
        body: payload,
      }),
      invalidatesTags: ['StorageLocations'],
    }),

    updateStorageLocation: builder.mutation<
      { location: IStorageLocation },
      { id: ID; patch: Partial<IStorageLocation> }
    >({
      query: ({ id, patch }) => ({
        url: `/storage-locations/${id}`,
        method: 'PATCH',
        body: patch,
      }),
      invalidatesTags: (_r, _e, { id }) => [{ type: 'StorageLocations', id }, 'StorageLocations'],
    }),

    deleteStorageLocation: builder.mutation<{ id: ID }, ID>({
      query: (id) => ({
        url: `/storage-locations/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: ['StorageLocations'],
    }),
    /* ===================== CONNECTOR TYPES ===================== */

    getConnectors: builder.query<IConnectorType[], void>({
      query: () => ({ url: 'connectors', method: 'GET' }),
      providesTags: (result) =>
        result
          ? [
              ...result.map(({ _id }) => ({ type: 'ConnectorTypes' as const, id: _id })),
              { type: 'ConnectorTypes', id: 'LIST' },
            ]
          : [{ type: 'ConnectorTypes', id: 'LIST' }],

      transformResponse: (res: { connectors?: IConnectorType[] } | IConnectorType[]) => {
        const list = Array.isArray(res) ? res : (res?.connectors ?? []);
        return [...list].sort((a, b) => a.name.localeCompare(b.name));
      },
    }),
    getConnectorsById: builder.query<IConnectorType, string>({
      query: (id) => ({ url: `connectors/${id}`, method: 'GET' }),
      providesTags: (_r, _e, id) => [{ type: 'ConnectorTypes', id }],
      transformResponse: (res: { connector: IConnectorType }) => res?.connector,
    }),

    // multipart: body -> FormData
    createConnector: builder.mutation<
      IConnectorType,
      { data: CreateConnectorBody; thumbnail?: File | null }
    >({
      query: ({ data, thumbnail }) => {
        console.log('data', data);
        console.log('thumbnail', thumbnail);
        if (thumbnail) {
          console.log('thumbnail jest aktywny');
          const fd = new FormData();
          fd.append('name', data.name);
          if (data.description) fd.append('description', data.description);
          if (data.common_uses) fd.append('common_uses', data.common_uses);
          fd.append('is_active', String(data.is_active ?? true));
          if (thumbnail) fd.append('thumbnail', thumbnail);
          return {
            url: 'connectors?page_type=mavinci/crm/connectors',
            method: 'POST',
            body: fd,
          };
        }
        return {
          url: 'connectors?page_type=mavinci/crm/connectors',
          method: 'POST',
          body: data,
          headers: { 'Content-Type': 'application/json' },
        };
      },
      invalidatesTags: [{ type: 'ConnectorTypes', id: 'LIST' }],
    }),

    updateConnector: builder.mutation<
      IConnectorType,
      { id: string; data: UpdateConnectorBody; thumbnail?: File | null }
    >({
      query: ({ id, data, thumbnail }) => {
        if (thumbnail) {
          const fd = new FormData();
          fd.append('name', data.name);
          if (data.description) fd.append('description', data.description);
          if (data.common_uses) fd.append('common_uses', data.common_uses);
          fd.append('is_active', String(data.is_active ?? true));
          if (thumbnail) fd.append('thumbnail', thumbnail);
          return {
            url: `connectors/${id}?page_type=mavinci/crm/connectors`,
            method: 'PATCH',
            body: fd,
          };
        }
        return {
          url: `connectors/${id}?page_type=mavinci/crm/connectors`,
          method: 'PATCH',
          body: data,
          headers: { 'Content-Type': 'application/json' },
        };
      },
      invalidatesTags: (res, err, { id }) => [
        { type: 'ConnectorTypes', id },
        { type: 'ConnectorTypes', id: 'LIST' },
      ],
    }),

    deleteConnector: builder.mutation<{ id: string }, string>({
      query: (id) => ({ url: `connectors/${id}`, method: 'DELETE' }),
      invalidatesTags: (_res, _err, id) => [
        { type: 'ConnectorTypes', id },
        { type: 'ConnectorTypes', id: 'LIST' },
      ],
    }),
    //Cables
    // equipmentApi.ts (fragment: endpoints)
    updateCableQuantity: builder.mutation<
      { ok: true; equipmentId: string; quantity: number },
      { id: string; quantity: number }
    >({
      query: ({ id, quantity }) => ({
        url: `/equipment/${id}/cable/quantity`,
        method: 'PATCH',
        body: { quantity },
      }),
      invalidatesTags: (_r, _e, { id }) => [{ type: 'Equipment', id }, 'EquipmentList'],
    }),

    updateCableSpecs: builder.mutation<
      {
        ok: true;
        equipmentId: string;
        cable: { length_meters: string; connector_in: string; connector_out: string };
      },
      { id: string; cable: { length_meters: string; connector_in: string; connector_out: string } }
    >({
      query: ({ id, cable }) => ({
        url: `/equipment/${id}/cable/specs`,
        method: 'PATCH',
        body: cable,
      }),
      invalidatesTags: (_r, _e, { id }) => [{ type: 'Equipment', id }],
    }),

    upsertUnit: builder.mutation<
      { equipmentId: string; units: IEquipmentUnit[] },
      { eid: string; unit: Partial<IEquipmentUnit> }
    >({
      query: ({ eid, unit }) => ({
        url: `/equipment/${eid}/units`,
        method: 'POST',
        body: { unit },
      }),
      invalidatesTags: (_r, _e, { eid }) => [{ type: 'Units', id: eid }],
    }),

    duplicateUnit: builder.mutation<
      { equipmentId: string; newUnit: IEquipmentUnit },
      { eid: string; uid: string }
    >({
      query: ({ eid, uid }) => ({
        url: `/equipment/${eid}/units/${uid}/duplicate`,
        method: 'POST',
      }),
      invalidatesTags: (_r, _e, { eid }) => [{ type: 'Units', id: eid }],
    }),

    addUnitEvent: builder.mutation<
      { equipmentId: string; unitId: string },
      { eid: string; uid: string; event: any }
    >({
      query: ({ eid, uid, event }) => ({
        url: `/equipment/${eid}/units/${uid}/events`,
        method: 'POST',
        body: { event },
      }),
      invalidatesTags: (_r, _e, { eid }) => [
        { type: 'Units', id: eid },
        { type: 'History', id: eid },
      ],
    }),

    patchCableQuantity: builder.mutation<
      { ok: true; equipmentId: string; quantity: number },
      { id: string; quantity: number }
    >({
      query: ({ id, quantity }) => ({
        url: `/equipment/${id}/cable/quantity`,
        method: 'PATCH',
        body: { quantity },
      }),
      invalidatesTags: (_r, _e, { id }) => [
        {
          type: 'Equipment',
          id,
        },
      ],
    }),

    // PATCH /api/equipment/:id/cable/specs   body: { length_meters, connector_in, connector_out }
    patchCableSpecs: builder.mutation<
      {
        ok: true;
        equipmentId: string;
        cable: {
          length_meters: number;
          connector_in: string;
          connector_out: string;
        };
        equipment?: any;
      },
      {
        id: string;
        length_meters: number;
        connector_in: string; // ObjectId (string)
        connector_out: string; // ObjectId (string)
      }
    >({
      query: ({ id, ...body }) => ({
        url: `/equipment/${id}/cable/specs`,
        method: 'PATCH',
        body,
      }),
      invalidatesTags: (_r, _e, { id }) => [{ type: 'Equipment', id }, 'EquipmentList'],
    }),
  }),
});

export const {
  /* EQUIPMENT */
  useGetEquipmentListQuery,
  useGetEquipmentFeedQuery,
  useGetEquipmentDetailsQuery,
  useCreateEquipmentMutation,
  useUpdateEquipmentMutation,
  useDeleteEquipmentMutation,
  useGetEquipmentByIdQuery,

  /* UNITS */
  useAddUnitMutation,
  useGetUnitsByEquipmentQuery,
  useDeleteUnitMutation,
  useUpsertUnitMutation,
  useDuplicateUnitMutation,
  useAddUnitEventMutation,

  /* GALLERY */
  useAddGalleryItemMutation,
  useSetMainGalleryItemMutation,

  /* HISTORY */
  useAddHistoryEntryMutation,

  /* CATEGORIES */
  useGetEquipmentCategoriesQuery,

  /* STORAGE LOCATIONS */
  useGetStorageLocationsQuery,
  useGetStorageLocationByIdQuery,
  useCreateStorageLocationMutation,
  useUpdateStorageLocationMutation,
  useDeleteStorageLocationMutation,

  /* CONNECTOR TYPES */
  useGetConnectorsQuery,
  useLazyGetConnectorsQuery,
  useGetConnectorsByIdQuery,
  useCreateConnectorMutation,
  useUpdateConnectorMutation,
  useDeleteConnectorMutation,

  /* CABLES */
  usePatchCableQuantityMutation,
  usePatchCableSpecsMutation,
} = equipmentApi;

export const {
  usePatchCableQuantityMutation: useUpdateCableQuantityMutation,
  usePatchCableSpecsMutation: useUpdateCableSpecsMutation,
} = equipmentApi;
