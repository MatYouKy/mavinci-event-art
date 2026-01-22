import { createApi, fakeBaseQuery } from '@reduxjs/toolkit/query/react';
import { supabase } from '@/lib/supabase/browser';
import type {
  ClientsTab,
  UnifiedClient,
  OrganizationRow,
  ContactRow,
  CreateOrganizationPayload,
  UpdateOrganizationPayload,
  CreateContactPayload,
  UpdateContactPayload,
  UUID,
} from '../types';

export type ClientsApiErrorStatus = 'CUSTOM_ERROR' | 'FETCH_ERROR' | 'NOT_FOUND';
export interface ClientsApiError {
  status: ClientsApiErrorStatus;
  message: string;
}

const toErr = (status: ClientsApiErrorStatus, message: string) =>
  ({ status, message }) as ClientsApiError;

const safe = <T>(v: T | null | undefined, fallback: T) => v ?? fallback;

export const clientsApi = createApi({
  reducerPath: 'clientsApi',
  baseQuery: fakeBaseQuery<ClientsApiError>(),
  tagTypes: ['ClientsList', 'ClientById', 'Org', 'Contact', 'OrgContacts'],
  endpoints: (builder) => ({
    /**
     * UNIFIED LIST (all / clients / subcontractors)
     * Uwaga: to jest "JS-unifier". Docelowo najlepiej przenieść do RPC,
     * ale już teraz będzie szybkie, bo to 2-3 zapytania + mapy liczników.
     */
    getClientsList: builder.query<UnifiedClient[], { tab?: ClientsTab } | void>({
      async queryFn(arg) {
        try {
          const tab = (arg as { tab?: ClientsTab })?.tab ?? 'all';

          // 1) relacje (do liczników)
          const { data: rels, error: relErr } = await supabase
            .from('contact_organizations')
            .select('organization_id, contact_id')
            .eq('is_current', true);

          if (relErr) return { error: toErr('CUSTOM_ERROR', relErr.message) };

          const orgContactCounts = new Map<string, number>();
          const contactOrgCounts = new Map<string, number>();

          for (const r of rels || []) {
            if (r.organization_id)
              orgContactCounts.set(
                r.organization_id,
                (orgContactCounts.get(r.organization_id) || 0) + 1,
              );
            if (r.contact_id)
              contactOrgCounts.set(r.contact_id, (contactOrgCounts.get(r.contact_id) || 0) + 1);
          }

          const unified: UnifiedClient[] = [];

          // 2) organizations
          if (tab === 'all' || tab === 'clients' || tab === 'subcontractors') {
            const orgTypeFilter =
              tab === 'subcontractors' ? 'subcontractor' : tab === 'clients' ? 'client' : null;

            let orgQuery = supabase
              .from('organizations')
              .select('*')
              .order('created_at', { ascending: false });

            if (orgTypeFilter) orgQuery = orgQuery.eq('organization_type', orgTypeFilter);

            const { data: orgs, error: orgErr } = await orgQuery;
            if (orgErr) return { error: toErr('CUSTOM_ERROR', orgErr.message) };

            for (const org of orgs || []) {
              unified.push({
                id: org.id,
                entityType: 'organization',
                source: 'organizations',
                name: safe(org.alias, org.name),
                email: org.email ?? null,
                phone: org.phone ?? null,
                city: org.city ?? null,
                status: (org.status as any) ?? null,
                rating: org.rating ?? null,
                tags: org.tags ?? null,
                created_at: org.created_at,
                contacts_count: orgContactCounts.get(org.id) || 0,
                raw: org as OrganizationRow,
              });
            }
          }

          // 3) contacts (kontakt firmowy + indywidualny)
          if (tab === 'all' || tab === 'clients') {
            const { data: contacts, error: cErr } = await supabase
              .from('contacts')
              .select('*')
              .in('contact_type', ['contact', 'individual'])
              .order('created_at', { ascending: false });

            if (cErr) return { error: toErr('CUSTOM_ERROR', cErr.message) };

            for (const c of contacts || []) {
              unified.push({
                id: c.id,
                entityType: c.contact_type === 'individual' ? 'individual' : 'contact',
                source: 'contacts',
                name: c.full_name ?? (`${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || '—'),
                email: c.email ?? null,
                phone: c.phone ?? null,
                mobile: c.mobile ?? null,
                city: c.city ?? null,
                status: c.status ?? null,
                rating: c.rating ?? null,
                avatar_url: c.avatar_url ?? null,
                tags: c.tags ?? null,
                created_at: c.created_at,
                organizations_count: contactOrgCounts.get(c.id) || 0,
                raw: c as ContactRow,
              });
            }
          }

          return { data: unified };
        } catch (e: any) {
          return { error: toErr('FETCH_ERROR', e?.message ?? 'Unknown error') };
        }
      },
      providesTags: (result) =>
        result ? [{ type: 'ClientsList', id: 'LIST' }] : [{ type: 'ClientsList', id: 'LIST' }],
    }),

    /**
     * Pobierz ORGANIZATION po ID
     */
    getOrganizationById: builder.query<OrganizationRow, UUID>({
      async queryFn(id) {
        try {
          const { data, error } = await supabase
            .from('organizations')
            .select('*')
            .eq('id', id)
            .single();
          if (error) return { error: toErr('CUSTOM_ERROR', error.message) };
          if (!data) return { error: toErr('NOT_FOUND', 'Organization not found') };
          return { data: data as OrganizationRow };
        } catch (e: any) {
          return { error: toErr('FETCH_ERROR', e?.message ?? 'Unknown error') };
        }
      },
      providesTags: (_res, _err, id) => [
        { type: 'Org', id },
        { type: 'ClientById', id },
      ],
    }),

    /**
     * Pobierz CONTACT (w tym INDIVIDUAL) po ID
     */
    getContactById: builder.query<ContactRow, UUID>({
      async queryFn(id) {
        try {
          const { data, error } = await supabase.from('contacts').select('*').eq('id', id).single();
          if (error) return { error: toErr('CUSTOM_ERROR', error.message) };
          if (!data) return { error: toErr('NOT_FOUND', 'Contact not found') };
          return { data: data as ContactRow };
        } catch (e: any) {
          return { error: toErr('FETCH_ERROR', e?.message ?? 'Unknown error') };
        }
      },
      providesTags: (_res, _err, id) => [
        { type: 'Contact', id },
        { type: 'ClientById', id },
      ],
    }),

    /**
     * Kontakty organizacji (join po contact_organizations)
     */
    getContactsForOrganization: builder.query<ContactRow[], UUID>({
      async queryFn(organizationId) {
        try {
          const { data, error } = await supabase
            .from('contact_organizations')
            .select(`contact:contacts(*)`)
            .eq('organization_id', organizationId)
            .eq('is_current', true);

          if (error) return { error: toErr('CUSTOM_ERROR', error.message) };

          const contacts = (data || []).map((x: any) => x.contact).filter(Boolean) as ContactRow[];

          return { data: contacts };
        } catch (e: any) {
          return { error: toErr('FETCH_ERROR', e?.message ?? 'Unknown error') };
        }
      },
      providesTags: (_res, _err, orgId) => [{ type: 'OrgContacts', id: orgId }],
    }),

    // ---------- CREATE ----------
    createOrganization: builder.mutation<OrganizationRow, CreateOrganizationPayload>({
      async queryFn(payload) {
        try {
          const { data, error } = await supabase
            .from('organizations')
            .insert(payload)
            .select()
            .single();
          if (error) return { error: toErr('CUSTOM_ERROR', error.message) };
          return { data: data as OrganizationRow };
        } catch (e: any) {
          return { error: toErr('FETCH_ERROR', e?.message ?? 'Unknown error') };
        }
      },
      invalidatesTags: [{ type: 'ClientsList', id: 'LIST' }],
    }),

    createContact: builder.mutation<ContactRow, CreateContactPayload>({
      async queryFn(payload) {
        try {
          const { data, error } = await supabase.from('contacts').insert(payload).select().single();
          if (error) return { error: toErr('CUSTOM_ERROR', error.message) };
          return { data: data as ContactRow };
        } catch (e: any) {
          return { error: toErr('FETCH_ERROR', e?.message ?? 'Unknown error') };
        }
      },
      invalidatesTags: [{ type: 'ClientsList', id: 'LIST' }],
    }),

    // ---------- UPDATE ----------
    updateOrganizationById: builder.mutation<
      OrganizationRow,
      { id: UUID; data: UpdateOrganizationPayload }
    >({
      async queryFn({ id, data }) {
        try {
          const { data: updated, error } = await supabase
            .from('organizations')
            .update(data)
            .eq('id', id)
            .select()
            .single();

          if (error) return { error: toErr('CUSTOM_ERROR', error.message) };
          return { data: updated as OrganizationRow };
        } catch (e: any) {
          return { error: toErr('FETCH_ERROR', e?.message ?? 'Unknown error') };
        }
      },
      invalidatesTags: (_res, _err, { id }) => [
        { type: 'Org', id },
        { type: 'ClientById', id },
        { type: 'ClientsList', id: 'LIST' },
      ],
    }),

    updateContactById: builder.mutation<ContactRow, { id: UUID; data: UpdateContactPayload }>({
      async queryFn({ id, data }) {
        try {
          const { data: updated, error } = await supabase
            .from('contacts')
            .update(data)
            .eq('id', id)
            .select()
            .single();

          if (error) return { error: toErr('CUSTOM_ERROR', error.message) };
          return { data: updated as ContactRow };
        } catch (e: any) {
          return { error: toErr('FETCH_ERROR', e?.message ?? 'Unknown error') };
        }
      },
      invalidatesTags: (_res, _err, { id }) => [
        { type: 'Contact', id },
        { type: 'ClientById', id },
        { type: 'ClientsList', id: 'LIST' },
      ],
    }),

    // ---------- DELETE ----------
    deleteOrganizationById: builder.mutation<void, UUID>({
      async queryFn(id) {
        try {
          const { error } = await supabase.from('organizations').delete().eq('id', id);
          if (error) return { error: toErr('CUSTOM_ERROR', error.message) };
          return { data: undefined };
        } catch (e: any) {
          return { error: toErr('FETCH_ERROR', e?.message ?? 'Unknown error') };
        }
      },
      invalidatesTags: (_res, _err, id) => [
        { type: 'Org', id },
        { type: 'ClientById', id },
        { type: 'ClientsList', id: 'LIST' },
      ],
    }),

    deleteContactById: builder.mutation<void, UUID>({
      async queryFn(id) {
        try {
          const { error } = await supabase.from('contacts').delete().eq('id', id);
          if (error) return { error: toErr('CUSTOM_ERROR', error.message) };
          return { data: undefined };
        } catch (e: any) {
          return { error: toErr('FETCH_ERROR', e?.message ?? 'Unknown error') };
        }
      },
      invalidatesTags: (_res, _err, id) => [
        { type: 'Contact', id },
        { type: 'ClientById', id },
        { type: 'ClientsList', id: 'LIST' },
      ],
    }),
  }),
});

export const {
  useGetClientsListQuery,
  useGetOrganizationByIdQuery,
  useGetContactByIdQuery,
  useGetContactsForOrganizationQuery,

  useCreateOrganizationMutation,
  useCreateContactMutation,
  useUpdateOrganizationByIdMutation,
  useUpdateContactByIdMutation,
  useDeleteOrganizationByIdMutation,
  useDeleteContactByIdMutation,
} = clientsApi;
