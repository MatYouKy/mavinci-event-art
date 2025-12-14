'use client';

import { createApi, fakeBaseQuery } from '@reduxjs/toolkit/query/react';
import { supabase } from '@/lib/supabase';
import type { PostgrestError } from '@supabase/supabase-js';
import type { IEventCategory } from '@/app/crm/event-categories/types';

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

/** ===== Types from your component ===== */

export interface Product {
  id: string;
  name: string;
  description: string;
  base_price: number;
  unit: string;
  category?: IEventCategory | null;
  category_id?: string | null;
}

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

export interface OfferItemDraft {
  id: string;
  product_id?: string;
  name: string;
  description: string;
  qty: number;
  unit: string;
  unit_price: number;
  discount_percent: number;
  subtotal: number;
  equipment_ids?: string[];
  subcontractor_id?: string;
  needs_subcontractor?: boolean;
}

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
  offerItems: OfferItemDraft[];
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

  offerItems: OfferItemDraft[];

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

export const offerWizardApi = createApi({
  reducerPath: 'offerWizardApi',
  baseQuery: fakeBaseQuery<SupabaseRTKError>(),
  tagTypes: [
    'Organizations',
    'Contacts',
    'OfferProducts',
    'OfferProductCategories',
    'EquipmentItems',
    'Subcontractors',
    'OfferConflicts',
  ],
  endpoints: (builder) => ({
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
            .select('id, first_name, last_name, full_name, email, phone, company_name, contact_type')
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
    getOfferProducts: builder.query<Product[], void>({
      providesTags: ['OfferProducts'],
      queryFn: async () => {
        try {
          const { data, error } = await supabase
            .from('offer_products')
            .select(
              `
              *,
              category:offer_product_categories(name, icon)
            `,
            )
            .eq('is_active', true)
            .order('display_order');

          if (error) return { error: toRtkError(error) };
          return { data: (data ?? []) as Product[] };
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
            .from('offer_product_categories')
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
    checkOfferCartEquipmentConflictsV2: builder.mutation<EquipmentConflictRow[], CheckConflictsArgs>({
      invalidatesTags: ['OfferConflicts'],
      queryFn: async ({ eventId, offerItems, selectedAlt, conflicts }) => {
        try {
          if (!eventId) return { data: [] };

          const payload = (offerItems || [])
            .filter((i) => !!i.product_id)
            .map((i) => ({
              product_id: i.product_id,
              quantity: i.qty ?? 1, // db: quantity
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
            organization_id: clientType === 'business' ? organizationId ?? null : null,
            contact_id: clientType === 'individual' ? contactId ?? null : null,
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
              item.product_id && typeof item.product_id === 'string' && item.product_id.trim() !== ''
                ? item.product_id
                : null,
            name: item.name,
            description: item.description || null,
            quantity: item.qty,
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
  }),
});

export const {
  useGetOrganizationsQuery,
  useGetContactsIndividualsQuery,
  useCreateContactIndividualMutation,

  useGetOfferProductsQuery,
  useGetOfferProductCategoriesQuery,

  useGetEquipmentItemsQuery,
  useGetSubcontractorsQuery,

  useCheckOfferCartEquipmentConflictsV2Mutation,
  useCreateOfferWizardMutation,
} = offerWizardApi;