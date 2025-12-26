'use client';

import { createApi, fakeBaseQuery } from '@reduxjs/toolkit/query/react';
import { supabase } from '@/lib/supabase';
import type { PostgrestError } from '@supabase/supabase-js';
import type { IEventCategory } from '@/app/crm/event-categories/types';
import {
  CreateOfferProductEquipmentArgs,
  IOfferItemDraft,
  IProduct,
  OfferProductEquipmentRow,
} from '../types';

type SupabaseRTKError = {
  status: 'SUPABASE_ERROR' | 'UNKNOWN_ERROR';
  data: {
    message: string;
    code?: string;
    details?: string | null;
    hint?: string | null;
  };
};

const toRtkError = (error: PostgrestError | any): SupabaseRTKError => {
  if (!error) {
    return { status: 'UNKNOWN_ERROR', data: { message: 'Unknown error' } };
  }

  // Supabase PostgrestError shape
  if (typeof error === 'object' && 'message' in error) {
    return {
      status: 'SUPABASE_ERROR',
      data: {
        message: error.message ?? 'Supabase error',
        code: error.code,
        details: error.details ?? null,
        hint: error.hint ?? null,
      },
    };
  }

  return {
    status: 'UNKNOWN_ERROR',
    data: { message: String(error) },
  };
};

export type EquipmentConflictRow = {
  item_type: 'item' | 'kit';
  item_id: string;
  item_name: string;
  required_qty: number;
  total_qty: number;
  reserved_qty: number;
  available_qty: number;
  shortage_qty: number;
  conflict_until: string | null;
  conflicts: any[];
  alternatives: Array<{
    item_type: 'item' | 'kit';
    item_id: string;
    item_name: string;
    total_qty: number;
    reserved_qty: number;
    available_qty: number;
    warehouse_category_id?: string;
  }>;
};

export type SelectedAltMap = Record<
  string,
  {
    item_id: string; // to_item_id
    qty: number;
  }
>;

export interface OrganizationRow {
  id: string;
  name: string;
  nip?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface ContactRow {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
  company_name?: string | null;
  contact_type?: string | null;
}

export interface OfferProductCategoryRow {
  id: string;
  name: string;
  icon?: string | null;
  is_active?: boolean;
  display_order?: number | null;
}

export interface EquipmentItemRow {
  id: string;
  name: string;
  brand?: string | null;
  model?: string | null;
}

export interface SubcontractorRow {
  id: string;
  contact_person?: string | null;
  company_name?: string | null;
  specialization?: string[] | null;
  status?: string | null;
}

/** ===== Helpers matching your existing logic ===== */

const buildSubstitutionsForRpc = ({
  selectedAlt,
  conflicts,
}: {
  selectedAlt: SelectedAltMap;
  conflicts: EquipmentConflictRow[];
}) => {
  return (conflicts || [])
    .map((c) => {
      const key = `${c.item_type}|${c.item_id}`;
      const pick = selectedAlt?.[key];
      if (!pick?.item_id) return null;

      return {
        from_item_id: c.item_id,
        to_item_id: pick.item_id,
        qty: pick.qty ?? c.shortage_qty ?? 1,
      };
    })
    .filter(Boolean) as Array<{ from_item_id: string; to_item_id: string; qty: number }>;
};

const buildSubstitutionsForInsert = ({
  offerId,
  selectedAlt,
  conflicts,
}: {
  offerId: string;
  selectedAlt: SelectedAltMap;
  conflicts: EquipmentConflictRow[];
}) => {
  const rows = buildSubstitutionsForRpc({ selectedAlt, conflicts });
  return rows.map((r) => ({ ...r, offer_id: offerId }));
};

/** ===== Payloads ===== */

export type CheckConflictsArgs = {
  eventId: string;
  offerItems: IOfferItemDraft[];
  selectedAlt: SelectedAltMap;
  conflicts: EquipmentConflictRow[]; // potrzebne do zbudowania substitutions payload
};

export type CreateContactIndividualArgs = {
  name: string;
  surname: string;
  email?: string;
  phone?: string;
};

export type CreateOfferWizardArgs = {
  eventId: string;

  clientType: 'individual' | 'business';
  organizationId?: string | null;
  contactId?: string | null;

  offer_number?: string | null;
  valid_until?: string | null;
  notes?: string | null;

  createdByEmployeeId: string;

  offerItems: IOfferItemDraft[];

  // do substitutions:
  selectedAlt: SelectedAltMap;
  conflicts: EquipmentConflictRow[];

  // jeśli chcesz od razu dopiąć sprzęt do eventu po stworzeniu oferty:
  syncEquipmentToEvent?: boolean;
};

export type CreateOfferWizardResult = {
  offerId: string;
  offerNumber: string | null;
};

const tagTypes = [
  'Organizations',
  'Contacts',
  'OfferProducts',
  'OfferProductCategories',
  'EquipmentItems',
  'Subcontractors',
  'OfferConflicts',
  'Offers',
  'Offer',
  'OfferProductEquipment',
] as const;

export const offerWizardApi = createApi({
  reducerPath: 'offerWizardApi',
  baseQuery: fakeBaseQuery<SupabaseRTKError>(),
  tagTypes,
  endpoints: (builder) => ({
    getOffers: builder.query<any[], void>({
      providesTags: (res) =>
        res
          ? [
              { type: 'Offers' as const, id: 'LIST' },
              ...res.map((o: any) => ({ type: 'Offer' as const, id: o.id })),
            ]
          : [{ type: 'Offers' as const, id: 'LIST' }],
      queryFn: async () => {
        try {
          const { data, error } = await supabase
            .from('offers')
            .select(
              `
              *,
              event:events!event_id(
                name,
                event_date,
                organization_id,
                contact_person_id
              ),
              creator:employees!created_by(name, surname)
            `,
            )
            .order('created_at', { ascending: false });

          if (error) return { error: toRtkError(error) };

          // (opcjonalnie) enrichment jak u Ciebie
          const rows = data ?? [];
          if (rows.length === 0) return { data: rows };

          const orgIds = rows.map((o: any) => o.event?.organization_id).filter(Boolean);
          const contactIds = rows.map((o: any) => o.event?.contact_person_id).filter(Boolean);

          let orgsMap: Record<string, any> = {};
          let contactsMap: Record<string, any> = {};

          if (orgIds.length) {
            const { data: orgs, error: e1 } = await supabase
              .from('organizations')
              .select('id, name')
              .in('id', orgIds);
            if (e1) return { error: toRtkError(e1) };
            orgsMap = Object.fromEntries((orgs || []).map((o: any) => [o.id, o]));
          }

          if (contactIds.length) {
            const { data: contacts, error: e2 } = await supabase
              .from('contacts')
              .select('id, first_name, last_name, company_name')
              .in('id', contactIds);
            if (e2) return { error: toRtkError(e2) };
            contactsMap = Object.fromEntries((contacts || []).map((c: any) => [c.id, c]));
          }

          const enriched = rows.map((offer: any) => {
            const event = offer.event as any;
            if (event) {
              if (event.organization_id && orgsMap[event.organization_id]) {
                event.organization = orgsMap[event.organization_id];
              }
              if (event.contact_person_id && contactsMap[event.contact_person_id]) {
                event.contact = contactsMap[event.contact_person_id];
              }
            }
            return offer;
          });

          return { data: enriched };
        } catch (e) {
          return { error: toRtkError(e) };
        }
      },
    }),

    getOfferById: builder.query<any, { offerId: string }>({
      providesTags: (_res, _err, arg) => [{ type: 'Offer' as const, id: arg.offerId }],
      queryFn: async ({ offerId }) => {
        try {
          const { data, error } = await supabase
            .from('offers')
            .select(
              `
              *,
              organization:organizations!organization_id(name, email),
              event:events!event_id(
                name,
                event_date,
                location,
                contact:contacts(email, first_name, last_name)
              ),
              last_generated_by_employee:employees!last_generated_by(
                id,
                name,
                surname
              ),
              offer_items(
                id,
                product_id,
                quantity,
                unit_price,
                discount_percent,
                discount_amount,
                subtotal,
                total,
                display_order,
                product:offer_products(
                  id,
                  name,
                  description,
                  pdf_page_url,
                  pdf_thumbnail_url
                )
              )
            `,
            )
            .eq('id', offerId)
            .maybeSingle();

          if (error) return { error: toRtkError(error) };
          if (!data) return { error: toRtkError({ message: 'Nie znaleziono oferty' }) as any };
          return { data };
        } catch (e) {
          return { error: toRtkError(e) };
        }
      },
    }),

    updateOfferById: builder.mutation<any, { offerId: string; patch: Record<string, any> }>({
      invalidatesTags: (_res, _err, arg) => [
        { type: 'Offer', id: arg.offerId },
        { type: 'Offers', id: 'LIST' },
      ],
      queryFn: async ({ offerId, patch }) => {
        try {
          const { data, error } = await supabase
            .from('offers')
            .update(patch)
            .eq('id', offerId)
            .select(
              `
              *,
              organization:organizations!organization_id(name, email),
              event:events!event_id(
                name,
                event_date,
                location,
                contact:contacts(email, first_name, last_name)
              ),
              last_generated_by_employee:employees!last_generated_by(
                id,
                name,
                surname
              ),
              offer_items(
                id,
                product_id,
                quantity,
                unit_price,
                discount_percent,
                discount_amount,
                subtotal,
                total,
                display_order,
                product:offer_products(
                  id,
                  name,
                  description,
                  pdf_page_url,
                  pdf_thumbnail_url
                )
              )
            `,
            )
            .maybeSingle();

          if (error) return { error: toRtkError(error) };
          if (!data) return { error: toRtkError({ message: 'Nie znaleziono oferty' }) as any };

          return { data };
        } catch (e) {
          return { error: toRtkError(e) };
        }
      },
    }),

    deleteOfferById: builder.mutation<{ success: true }, { offerId: string }>({
      invalidatesTags: (_res, _err, arg) => [
        { type: 'Offer', id: arg.offerId },
        { type: 'Offers', id: 'LIST' },
      ],
      queryFn: async ({ offerId }) => {
        try {
          // jeśli masz FK z offer_items i nie masz ON DELETE CASCADE,
          // to najpierw usuń offer_items:
          const { error: itemsErr } = await supabase
            .from('offer_items')
            .delete()
            .eq('offer_id', offerId);
          if (itemsErr) return { error: toRtkError(itemsErr) };

          const { error } = await supabase.from('offers').delete().eq('id', offerId);
          if (error) return { error: toRtkError(error) };

          return { data: { success: true } };
        } catch (e) {
          return { error: toRtkError(e) };
        }
      },
    }),

    /** ===== Step 1 ===== */
    getOrganizations: builder.query<OrganizationRow[], void>({
      providesTags: ['Organizations'],
      queryFn: async () => {
        try {
          const { data, error } = await supabase
            .from('organizations')
            .select('id, name, nip, email, phone')
            .order('name');

          if (error) return { error: toRtkError(error) };
          return { data: (data ?? []) as OrganizationRow[] };
        } catch (e) {
          return { error: toRtkError(e) };
        }
      },
    }),

    getContactsIndividuals: builder.query<ContactRow[], void>({
      providesTags: ['Contacts'],
      queryFn: async () => {
        try {
          const { data, error } = await supabase
            .from('contacts')
            .select(
              'id, first_name, last_name, full_name, email, phone, company_name, contact_type',
            )
            .eq('contact_type', 'individual')
            .order('last_name');

          if (error) return { error: toRtkError(error) };
          return { data: (data ?? []) as ContactRow[] };
        } catch (e) {
          return { error: toRtkError(e) };
        }
      },
    }),

    createContactIndividual: builder.mutation<ContactRow, CreateContactIndividualArgs>({
      invalidatesTags: ['Contacts'],
      queryFn: async (body) => {
        try {
          const { data, error } = await supabase
            .from('contacts')
            .insert([
              {
                name: body.name,
                surname: body.surname,
                email: body.email || null,
                phone: body.phone || null,
                contact_type: 'individual',
              },
            ])
            .select()
            .single();

          if (error) return { error: toRtkError(error) };
          return { data: data as ContactRow };
        } catch (e) {
          return { error: toRtkError(e) };
        }
      },
    }),

    /** ===== Step 3 ===== */
    getOfferProducts: builder.query<IProduct[], void>({
      providesTags: ['OfferProducts'],
      queryFn: async () => {
        try {
          const { data, error } = await supabase
            .from('offer_products')
            .select(
              `
              *,
              category:event_categories(name, icon)
            `,
            )
            .eq('is_active', true)
            .order('display_order');

          if (error) return { error: toRtkError(error) };
          return { data: (data ?? []) as IProduct[] };
        } catch (e) {
          return { error: toRtkError(e) };
        }
      },
    }),

    getOfferProductCategories: builder.query<OfferProductCategoryRow[], void>({
      providesTags: ['OfferProductCategories'],
      queryFn: async () => {
        try {
          const { data, error } = await supabase
            .from('event_categories')
            .select('*')
            .eq('is_active', true)
            .order('display_order');

          if (error) return { error: toRtkError(error) };
          return { data: (data ?? []) as OfferProductCategoryRow[] };
        } catch (e) {
          return { error: toRtkError(e) };
        }
      },
    }),

    /** ===== Step 4 (custom items) ===== */
    getEquipmentItems: builder.query<EquipmentItemRow[], void>({
      providesTags: ['EquipmentItems'],
      queryFn: async () => {
        try {
          const { data, error } = await supabase
            .from('equipment_items')
            .select('id, name, brand, model')
            .eq('is_active', true)
            .is('deleted_at', null)
            .order('name');

          if (error) return { error: toRtkError(error) };
          return { data: (data ?? []) as EquipmentItemRow[] };
        } catch (e) {
          return { error: toRtkError(e) };
        }
      },
    }),

    getSubcontractors: builder.query<SubcontractorRow[], void>({
      providesTags: ['Subcontractors'],
      queryFn: async () => {
        try {
          const { data, error } = await supabase
            .from('subcontractors')
            .select('id, contact_person, company_name, specialization, status')
            .eq('status', 'active')
            .order('company_name');

          if (error) return { error: toRtkError(error) };
          return { data: (data ?? []) as SubcontractorRow[] };
        } catch (e) {
          return { error: toRtkError(e) };
        }
      },
    }),

    /** ===== Conflicts (RPC) ===== */
    checkOfferCartEquipmentConflictsV2: builder.mutation<
      EquipmentConflictRow[],
      CheckConflictsArgs
    >({
      invalidatesTags: ['OfferConflicts'],
      queryFn: async ({ eventId, offerItems, selectedAlt, conflicts }) => {
        try {
          if (!eventId) return { data: [] };

          const payload = (offerItems || [])
            .filter((i) => !!i.product_id)
            .map((i) => ({
              product_id: i.product_id,
              quantity: i.quantity ?? 1, // db: quantity
            }));

          const substitutionsPayload = buildSubstitutionsForRpc({
            selectedAlt,
            conflicts,
          });

          const { data, error } = await supabase.rpc('check_offer_cart_equipment_conflicts_v2', {
            p_event_id: eventId,
            p_items: payload,
            p_substitutions: substitutionsPayload,
          });

          if (error) return { error: toRtkError(error) };

          const rows = Array.isArray(data) ? data : [];
          return { data: rows as EquipmentConflictRow[] };
        } catch (e) {
          return { error: toRtkError(e) };
        }
      },
    }),

    /** ===== Create whole offer (wizard submit) ===== */
    createOfferWizard: builder.mutation<CreateOfferWizardResult, CreateOfferWizardArgs>({
      // tu możesz dodać invalidacje np. listy ofert/event equipment
      queryFn: async (args) => {
        try {
          const {
            eventId,
            clientType,
            organizationId,
            contactId,
            offer_number,
            valid_until,
            notes,
            createdByEmployeeId,
            offerItems,
            selectedAlt,
            conflicts,
            syncEquipmentToEvent = true,
          } = args;

          if (!eventId?.trim()) {
            return { error: toRtkError({ message: 'Brak ID wydarzenia' }) as any };
          }
          if (!createdByEmployeeId?.trim()) {
            return { error: toRtkError({ message: 'Brak createdByEmployeeId' }) as any };
          }
          if (!offerItems?.length) {
            return { error: toRtkError({ message: 'Brak pozycji w ofercie' }) as any };
          }

          const totalAmount = offerItems.reduce((sum, i) => sum + (i.subtotal ?? 0), 0);

          // 1) offers
          const offerInsert: any = {
            event_id: eventId,
            client_type: clientType,
            organization_id: clientType === 'business' ? (organizationId ?? null) : null,
            contact_id: clientType === 'individual' ? (contactId ?? null) : null,
            valid_until: valid_until || null,
            notes: notes || null,
            status: 'draft',
            total_amount: totalAmount,
            created_by: createdByEmployeeId,
            offer_number: offer_number?.trim() ? offer_number.trim() : null,
          };

          const { data: offerResult, error: offerError } = await supabase
            .from('offers')
            .insert([offerInsert])
            .select()
            .single();

          if (offerError) return { error: toRtkError(offerError) };

          const offerId = offerResult.id as string;

          // 2) offer_items
          const itemsToInsert = offerItems.map((item, index) => ({
            offer_id: offerId,
            product_id:
              item.product_id &&
              typeof item.product_id === 'string' &&
              item.product_id.trim() !== ''
                ? item.product_id
                : null,
            name: item.name,
            description: item.description || null,
            quantity: item.quantity,
            unit: item.unit,
            unit_price: item.unit_price,
            unit_cost: 0,
            discount_percent: item.discount_percent || 0,
            discount_amount: 0,
            transport_cost: 0,
            logistics_cost: 0,
            display_order: index + 1,
            notes: null,
          }));

          const { error: itemsError } = await supabase.from('offer_items').insert(itemsToInsert);
          if (itemsError) return { error: toRtkError(itemsError) };

          // 3) substitutions (offer_equipment_substitutions)
          const substitutionsPayload = buildSubstitutionsForInsert({
            offerId,
            selectedAlt,
            conflicts,
          });

          if (substitutionsPayload.length > 0) {
            const { error: subsError } = await supabase
              .from('offer_equipment_substitutions')
              .insert(substitutionsPayload);

            if (subsError) return { error: toRtkError(subsError) };
          }

          // 4) (opcjonalnie) sync do event_equipment
          if (syncEquipmentToEvent) {
            const { error: syncErr } = await supabase.rpc('sync_offer_equipment_to_event', {
              p_offer_id: offerId,
            });
            if (syncErr) return { error: toRtkError(syncErr) };
          }

          return {
            data: {
              offerId,
              offerNumber: (offerResult.offer_number ?? null) as string | null,
            },
          };
        } catch (e) {
          return { error: toRtkError(e) };
        }
      },
    }),
    getOfferProductEquipmentByProductId: builder.query<
      OfferProductEquipmentRow[],
      { productId: string }
    >({
      providesTags: (res, _err, arg) =>
        res
          ? [
              { type: 'OfferProductEquipment' as const, id: `PRODUCT:${arg.productId}` },
              ...res.map((r) => ({ type: 'OfferProductEquipment' as const, id: r.id })),
            ]
          : [{ type: 'OfferProductEquipment' as const, id: `PRODUCT:${arg.productId}` }],
      queryFn: async ({ productId }) => {
        try {
          const { data, error } = await supabase
            .from('offer_product_equipment')
            .select('*')
            .eq('product_id', productId)
            .order('created_at', { ascending: true });

          if (error) return { error: toRtkError(error) };
          return { data: (data ?? []) as OfferProductEquipmentRow[] };
        } catch (e) {
          return { error: toRtkError(e) };
        }
      },
    }),

    addOfferProductEquipment: builder.mutation<
      OfferProductEquipmentRow,
      CreateOfferProductEquipmentArgs
    >({
      invalidatesTags: (_res, _err, arg) => [
        { type: 'OfferProductEquipment', id: `PRODUCT:${arg.product_id}` },
      ],
      queryFn: async (arg) => {
        try {
          const base = {
            product_id: arg.product_id,
            quantity: arg.quantity ?? 1,
            is_optional: arg.is_optional ?? false,
            notes: arg.notes ?? null,
          };

          // ITEM: masz UNIQUE (product_id, equipment_item_id) -> upsert
          if (arg.mode === 'item') {
            const { data, error } = await supabase
              .from('offer_product_equipment')
              .upsert(
                {
                  ...base,
                  equipment_item_id: arg.equipment_item_id,
                  equipment_kit_id: null,
                },
                { onConflict: 'product_id,equipment_item_id' },
              )
              .select('*')
              .single();

            if (error) return { error: toRtkError(error) };
            return { data: data as OfferProductEquipmentRow };
          }

          // KIT: brak unique -> insert
          const { data, error } = await supabase
            .from('offer_product_equipment')
            .insert({
              ...base,
              equipment_item_id: null,
              equipment_kit_id: arg.equipment_kit_id,
            })
            .select('*')
            .single();

          if (error) return { error: toRtkError(error) };
          return { data: data as OfferProductEquipmentRow };
        } catch (e) {
          return { error: toRtkError(e) };
        }
      },
    }),

    deleteOfferProductEquipment: builder.mutation<
      { success: true },
      { id: string; productId: string }
    >({
      invalidatesTags: (_res, _err, arg) => [
        { type: 'OfferProductEquipment', id: `PRODUCT:${arg.productId}` },
      ],
      queryFn: async ({ id }) => {
        try {
          const { error } = await supabase.from('offer_product_equipment').delete().eq('id', id);

          if (error) return { error: toRtkError(error) };
          return { data: { success: true } };
        } catch (e) {
          return { error: toRtkError(e) };
        }
      },
    }),
    updateOfferProductEquipment: builder.mutation<
      OfferProductEquipmentRow,
      { id: string; patch: { quantity?: number; is_optional?: boolean; notes?: string | null } }
    >({
      invalidatesTags: (_res, _err, arg) => [{ type: 'OfferProductEquipment', id: arg.id }],
      queryFn: async ({ id, patch }) => {
        const { data, error } = await supabase
          .from('offer_product_equipment')
          .update(patch)
          .eq('id', id)
          .select('*')
          .single();

        if (error) return { error: toRtkError(error) };
        return { data: data as OfferProductEquipmentRow };
      },
    }),
  }),
});

export const {
  useGetOffersQuery,
  useGetOfferByIdQuery,
  useUpdateOfferByIdMutation,
  useDeleteOfferByIdMutation,
  useGetOrganizationsQuery,
  useGetContactsIndividualsQuery,
  useCreateContactIndividualMutation,

  useGetOfferProductsQuery,
  useGetOfferProductCategoriesQuery,

  useGetEquipmentItemsQuery,
  useGetSubcontractorsQuery,

  useCheckOfferCartEquipmentConflictsV2Mutation,
  useCreateOfferWizardMutation,
  useLazyGetOfferByIdQuery,

  useGetOfferProductEquipmentByProductIdQuery,
  useAddOfferProductEquipmentMutation,
  useDeleteOfferProductEquipmentMutation,
  useUpdateOfferProductEquipmentMutation,
} = offerWizardApi;
