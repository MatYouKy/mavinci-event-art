// src/app/crm/locations/store/api/locationsApi.ts
import { createApi, fakeBaseQuery } from '@reduxjs/toolkit/query/react';
import { supabase } from '@/lib/supabase/browser';
import type { ILocation, LocationCreateInput, LocationUpdateInput } from './type';

export type LocationsApiErrorStatus = 'CUSTOM_ERROR' | 'FETCH_ERROR' | 'NOT_FOUND';

export interface LocationsApiError {
  status: LocationsApiErrorStatus;
  error: string;
}

export const locationsApi = createApi({
  reducerPath: 'locationsApi',
  baseQuery: fakeBaseQuery<LocationsApiError>(),
  tagTypes: ['Locations', 'Location'],
  endpoints: (builder) => ({
    // LISTA
    getLocationsList: builder.query<ILocation[], void>({
      async queryFn() {
        try {
          const { data, error } = await supabase
            .from('locations')
            .select('*')
            .order('name', { ascending: true });

          if (error) throw error;
          return { data: (data || []) as ILocation[] };
        } catch (e: any) {
          return { error: { status: 'FETCH_ERROR', error: e.message } as any };
        }
      },
      providesTags: (result) =>
        result
          ? [
              ...result.map((l) => ({ type: 'Location' as const, id: l.id })),
              { type: 'Locations' as const, id: 'LIST' },
            ]
          : [{ type: 'Locations' as const, id: 'LIST' }],
    }),

    // PO ID
    getLocationById: builder.query<ILocation, string>({
      async queryFn(id) {
        try {
          const { data, error } = await supabase
            .from('locations')
            .select('*')
            .eq('id', id)
            .single();

          if (error) throw error;
          return { data: data as ILocation };
        } catch (e: any) {
          return { error: { status: 'FETCH_ERROR', error: e.message } as any };
        }
      },
      providesTags: (_res, _err, id) => [{ type: 'Location', id }],
    }),

    // CREATE
    createLocation: builder.mutation<ILocation, LocationCreateInput>({
      async queryFn(payload) {
        try {
          const { data, error } = await supabase
            .from('locations')
            .insert([normalizeLocationPayload(payload)])
            .select()
            .single();

          if (error) throw error;
          return { data: data as ILocation };
        } catch (e: any) {
          return { error: { status: 'FETCH_ERROR', error: e.message } as any };
        }
      },
      invalidatesTags: [{ type: 'Locations', id: 'LIST' }],
    }),

    // UPDATE
    updateLocationById: builder.mutation<ILocation, { id: string; data: LocationUpdateInput }>({
      async queryFn({ id, data }) {
        try {
          const { data: updated, error } = await supabase
            .from('locations')
            .update(normalizeLocationPayload(data))
            .eq('id', id)
            .select()
            .single();

          if (error) throw error;
          return { data: updated as ILocation };
        } catch (e: any) {
          return { error: { status: 'FETCH_ERROR', error: e.message } as any };
        }
      },
      invalidatesTags: (_res, _err, { id }) => [
        { type: 'Location', id },
        { type: 'Locations', id: 'LIST' },
      ],
    }),

    // DELETE
    deleteLocationById: builder.mutation<{ success: true }, string>({
      async queryFn(id) {
        try {
          const { error } = await supabase.from('locations').delete().eq('id', id);
          if (error) throw error;
          return { data: { success: true } };
        } catch (e: any) {
          return { error: { status: 'FETCH_ERROR', error: e.message } as any };
        }
      },
      invalidatesTags: (_res, _err, id) => [
        { type: 'Location', id },
        { type: 'Locations', id: 'LIST' },
      ],
    }),
  }),
});

function normalizeLocationPayload<T extends Record<string, any>>(input: T) {
  // Supabase lubi null zamiast '' w polach opcjonalnych
  const out: any = { ...input };

  const toNull = (v: any) => (v === '' || v === undefined ? null : v);

  out.address = toNull(out.address);
  out.city = toNull(out.city);
  out.postal_code = toNull(out.postal_code);
  out.country = toNull(out.country);
  out.nip = toNull(out.nip);
  out.contact_person_name = toNull(out.contact_person_name);
  out.contact_phone = toNull(out.contact_phone);
  out.contact_email = toNull(out.contact_email);
  out.notes = toNull(out.notes);
  out.google_maps_url = toNull(out.google_maps_url);
  out.google_place_id = toNull(out.google_place_id);
  out.formatted_address = toNull(out.formatted_address);

  // latitude/longitude zostawiamy jak są (null/number)
  return out as T;
}

export const {
  useGetLocationsListQuery,
  useGetLocationByIdQuery,
  useCreateLocationMutation,
  useUpdateLocationByIdMutation,
  useDeleteLocationByIdMutation,
  useLazyGetLocationByIdQuery,
} = locationsApi;
