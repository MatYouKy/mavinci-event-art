import { createApi, fakeBaseQuery } from '@reduxjs/toolkit/query/react';
import { supabase } from '@/lib/supabase/browser';

export const rentalApi = createApi({
  reducerPath: 'rentalApi',
  baseQuery: fakeBaseQuery(),
  tagTypes: ['RentalEquipment'],
  endpoints: (builder) => ({
    getRentalEquipmentDetails: builder.query<any, string>({
      async queryFn(id) {
        const { data, error } = await supabase
          .from('subcontractor_rental_equipment')
          .select(
            `
            *,
            subcontractor:subcontractors(
              id,
              company_name,
              organization:organizations(
                id,
                name,
                email,
                phone
              )
            ),
            warehouse_categories(
              id,
              name,
              level,
              parent_id
            )
          `,
          )
          .eq('id', id)
          .maybeSingle();

        if (error) {
          console.error('getRentalEquipmentDetails - error:', error);
          return { error: error as any };
        }

        if (!data) {
          return { error: { message: 'Rental equipment not found' } as any };
        }

        return { data };
      },
      providesTags: (_res, _err, id) => [{ type: 'RentalEquipment', id }],
    }),

    updateRentalEquipment: builder.mutation<any, { id: string; updates: any }>({
      async queryFn({ id, updates }) {
        const { data, error } = await supabase
          .from('subcontractor_rental_equipment')
          .update(updates)
          .eq('id', id)
          .select()
          .single();

        if (error) {
          console.error('updateRentalEquipment - error:', error);
          return { error: error as any };
        }

        return { data };
      },
      invalidatesTags: (_res, _err, { id }) => [
        { type: 'RentalEquipment', id },
        { type: 'RentalEquipment', id: 'LIST' },
      ],
    }),

    getAllRentalEquipment: builder.query<any[], void>({
      async queryFn() {
        const { data, error } = await supabase
          .from('subcontractor_rental_equipment')
          .select(
            `
            *,
            subcontractor:subcontractors(
              id,
              company_name,
              organization:organizations(
                id,
                name
              )
            ),
            warehouse_categories(
              id,
              name,
              level,
              parent_id
            )
          `,
          )
          .eq('is_active', true)
          .order('created_at', { ascending: false });

        if (error) {
          console.error('getAllRentalEquipment - error:', error);
          return { error: error as any };
        }

        return { data: data || [] };
      },
      providesTags: [{ type: 'RentalEquipment', id: 'LIST' }],
    }),

    deleteRentalEquipment: builder.mutation<void, string>({
      async queryFn(id) {
        const { error } = await supabase
          .from('subcontractor_rental_equipment')
          .delete()
          .eq('id', id);

        if (error) {
          console.error('deleteRentalEquipment - error:', error);
          return { error: error as any };
        }

        return { data: undefined };
      },
      invalidatesTags: (_res, _err, id) => [
        { type: 'RentalEquipment', id },
        { type: 'RentalEquipment', id: 'LIST' },
      ],
    }),
  }),
});

export const {
  useGetRentalEquipmentDetailsQuery,
  useUpdateRentalEquipmentMutation,
  useGetAllRentalEquipmentQuery,
  useDeleteRentalEquipmentMutation,
} = rentalApi;
