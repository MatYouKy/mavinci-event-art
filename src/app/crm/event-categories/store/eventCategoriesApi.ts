'use client';

import { createApi, fakeBaseQuery } from '@reduxjs/toolkit/query/react';
import { supabase, SupabaseRTKError } from '@/lib/supabase';
import type { ICustomIcon, IEventCategory } from '@/app/crm/event-categories/types';
import { toRtkError } from '@/lib/supabase';


export type ContractTemplateRow = { id: string; name: string };
export type OfferTemplateCategoryRow = { id: string; name: string; color: string };

export type UpsertEventCategoryArgs = {
  id?: string; // jak jest -> update, jak nie -> insert
  name: string;
  color: string;
  description?: string | null;
  is_active: boolean;
  icon_id?: string | null;
  contract_template_id?: string | null;
  default_offer_template_category_id?: string | null;
};

export type UpsertCustomIconArgs = {
  id?: string;
  name: string;
  svg_code: string;
  preview_color: string;
};

export const eventCategoriesApi = createApi({
  reducerPath: 'eventCategoriesApi',
  baseQuery: fakeBaseQuery<SupabaseRTKError>(),
  tagTypes: ['EventCategories', 'CustomIcons', 'ContractTemplates', 'OfferTemplateCategories'],
  endpoints: (builder) => ({
    /** ===== CATEGORIES ===== */
    getEventCategories: builder.query<IEventCategory[], void>({
      providesTags: (res) =>
        res
          ? [
              { type: 'EventCategories' as const, id: 'LIST' },
              ...res.map((c: any) => ({ type: 'EventCategories' as const, id: c.id })),
            ]
          : [{ type: 'EventCategories' as const, id: 'LIST' }],
      queryFn: async () => {
        try {
          const { data, error } = await supabase
            .from('event_categories')
            .select(`*, icon:custom_icons(id, name, svg_code, preview_color)`)
            .order('name');

          if (error) return { error: toRtkError(error) };
          return { data: (data ?? []) as IEventCategory[] };
        } catch (e) {
          return { error: toRtkError(e) };
        }
      },
    }),

    upsertEventCategory: builder.mutation<IEventCategory, UpsertEventCategoryArgs>({
      invalidatesTags: (res, err, arg) => [
        { type: 'EventCategories', id: 'LIST' },
        ...(arg.id ? [{ type: 'EventCategories' as const, id: arg.id }] : []),
      ],
      queryFn: async (args) => {
        try {
          const payload = {
            name: args.name,
            color: args.color,
            description: args.description ?? null,
            is_active: args.is_active,
            icon_id: args.icon_id ?? null,
            contract_template_id: args.contract_template_id ?? null,
            default_offer_template_category_id: args.default_offer_template_category_id ?? null,
            updated_at: new Date().toISOString(),
          };

          if (args.id) {
            const { data, error } = await supabase
              .from('event_categories')
              .update(payload)
              .eq('id', args.id)
              .select(`*, icon:custom_icons(id, name, svg_code, preview_color)`)
              .single();

            if (error) return { error: toRtkError(error) };
            return { data: data as IEventCategory };
          }

          const { data, error } = await supabase
            .from('event_categories')
            .insert([{ ...payload }])
            .select(`*, icon:custom_icons(id, name, svg_code, preview_color)`)
            .single();

          if (error) return { error: toRtkError(error) };
          return { data: data as IEventCategory };
        } catch (e) {
          return { error: toRtkError(e) };
        }
      },
    }),

    deleteEventCategory: builder.mutation<{ success: true }, { id: string }>({
      invalidatesTags: (_res, _err, arg) => [
        { type: 'EventCategories', id: 'LIST' },
        { type: 'EventCategories', id: arg.id },
      ],
      queryFn: async ({ id }) => {
        try {
          const { error } = await supabase.from('event_categories').delete().eq('id', id);
          if (error) return { error: toRtkError(error) };
          return { data: { success: true } };
        } catch (e) {
          return { error: toRtkError(e) };
        }
      },
    }),

    /** ===== ICONS ===== */
    getCustomIcons: builder.query<ICustomIcon[], void>({
      providesTags: (res) =>
        res
          ? [
              { type: 'CustomIcons' as const, id: 'LIST' },
              ...res.map((i: any) => ({ type: 'CustomIcons' as const, id: i.id })),
            ]
          : [{ type: 'CustomIcons' as const, id: 'LIST' }],
      queryFn: async () => {
        try {
          const { data, error } = await supabase.from('custom_icons').select('*').order('name');
          if (error) return { error: toRtkError(error) };
          return { data: (data ?? []) as ICustomIcon[] };
        } catch (e) {
          return { error: toRtkError(e) };
        }
      },
    }),

    upsertCustomIcon: builder.mutation<ICustomIcon, UpsertCustomIconArgs>({
      invalidatesTags: (res, err, arg) => [
        { type: 'CustomIcons', id: 'LIST' },
        ...(arg.id ? [{ type: 'CustomIcons' as const, id: arg.id }] : []),
        // bo kategorie mają embed icon -> po zmianie ikony warto odświeżyć listę kategorii
        { type: 'EventCategories', id: 'LIST' },
      ],
      queryFn: async (args) => {
        try {
          // jeśli chcesz robić twarde permission-check po stronie serwera,
          // to i tak powinno być w RLS / policy. Tu tylko CRUD.

          const payload = {
            name: args.name,
            svg_code: args.svg_code,
            preview_color: args.preview_color,
            updated_at: new Date().toISOString(),
          };

          if (args.id) {
            const { data, error } = await supabase
              .from('custom_icons')
              .update(payload)
              .eq('id', args.id)
              .select()
              .single();

            if (error) return { error: toRtkError(error) };
            return { data: data as ICustomIcon };
          }

          const { data, error } = await supabase
            .from('custom_icons')
            .insert([{ ...payload }])
            .select()
            .single();

          if (error) return { error: toRtkError(error) };
          return { data: data as ICustomIcon };
        } catch (e) {
          return { error: toRtkError(e) };
        }
      },
    }),

    deleteCustomIcon: builder.mutation<{ success: true }, { id: string }>({
      invalidatesTags: (_res, _err, arg) => [
        { type: 'CustomIcons', id: 'LIST' },
        { type: 'CustomIcons', id: arg.id },
        { type: 'EventCategories', id: 'LIST' },
      ],
      queryFn: async ({ id }) => {
        try {
          const { error } = await supabase.from('custom_icons').delete().eq('id', id);
          if (error) return { error: toRtkError(error) };
          return { data: { success: true } };
        } catch (e) {
          return { error: toRtkError(e) };
        }
      },
    }),

    /** ===== HELPERS FOR SELECTS ===== */
    getContractTemplates: builder.query<ContractTemplateRow[], void>({
      providesTags: [{ type: 'ContractTemplates', id: 'LIST' }],
      queryFn: async () => {
        try {
          const { data, error } = await supabase
            .from('contract_templates')
            .select('id, name')
            .eq('is_active', true)
            .order('name');

          if (error) return { error: toRtkError(error) };
          return { data: (data ?? []) as ContractTemplateRow[] };
        } catch (e) {
          return { error: toRtkError(e) };
        }
      },
    }),

    getOfferTemplateCategories: builder.query<OfferTemplateCategoryRow[], void>({
      providesTags: [{ type: 'OfferTemplateCategories', id: 'LIST' }],
      queryFn: async () => {
        try {
          const { data, error } = await supabase
            .from('offer_template_categories')
            .select('id, name, color')
            .order('is_default', { ascending: false })
            .order('name');

          if (error) return { error: toRtkError(error) };
          return { data: (data ?? []) as OfferTemplateCategoryRow[] };
        } catch (e) {
          return { error: toRtkError(e) };
        }
      },
    }),
  }),
});

export const {
  useGetEventCategoriesQuery,
  useUpsertEventCategoryMutation,
  useDeleteEventCategoryMutation,

  useGetCustomIconsQuery,
  useUpsertCustomIconMutation,
  useDeleteCustomIconMutation,

  useGetContractTemplatesQuery,
  useGetOfferTemplateCategoriesQuery,
} = eventCategoriesApi;