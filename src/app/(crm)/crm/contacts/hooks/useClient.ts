import { useMemo, useCallback } from 'react';
import {
  useGetClientsListQuery,
  useCreateOrganizationMutation,
  useCreateContactMutation,
  useUpdateOrganizationByIdMutation,
  useUpdateContactByIdMutation,
  useDeleteOrganizationByIdMutation,
  useDeleteContactByIdMutation,
} from '../store/clientsApi';
import type {
  ClientsTab,
  ClientEntityType,
  UUID,
  CreateOrganizationPayload,
  CreateContactPayload,
  UpdateOrganizationPayload,
  UpdateContactPayload,
} from '../types';

export function useClients(tab: ClientsTab = 'all') {
  const listQuery = useGetClientsListQuery({ tab });

  const [createOrg, createOrgState] = useCreateOrganizationMutation();
  const [createContact, createContactState] = useCreateContactMutation();

  const [updateOrg, updateOrgState] = useUpdateOrganizationByIdMutation();
  const [updateContact, updateContactState] = useUpdateContactByIdMutation();

  const [deleteOrg, deleteOrgState] = useDeleteOrganizationByIdMutation();
  const [deleteContact, deleteContactState] = useDeleteContactByIdMutation();

  const isMutating =
    createOrgState.isLoading ||
    createContactState.isLoading ||
    updateOrgState.isLoading ||
    updateContactState.isLoading ||
    deleteOrgState.isLoading ||
    deleteContactState.isLoading;

  const create = useCallback(
    async (entityType: ClientEntityType, payload: CreateOrganizationPayload | CreateContactPayload) => {
      if (entityType === 'organization') return await createOrg(payload as CreateOrganizationPayload).unwrap();
      // contact lub individual => oba siedzą w contacts, różni je contact_type
      return await createContact(payload as CreateContactPayload).unwrap();
    },
    [createOrg, createContact],
  );

  const updateById = useCallback(
    async (entityType: ClientEntityType, id: UUID, data: UpdateOrganizationPayload | UpdateContactPayload) => {
      if (entityType === 'organization') return await updateOrg({ id, data: data as UpdateOrganizationPayload }).unwrap();
      return await updateContact({ id, data: data as UpdateContactPayload }).unwrap();
    },
    [updateOrg, updateContact],
  );

  const deleteById = useCallback(
    async (entityType: ClientEntityType, id: UUID) => {
      if (entityType === 'organization') return await deleteOrg(id).unwrap();
      return await deleteContact(id).unwrap();
    },
    [deleteOrg, deleteContact],
  );

  const api = useMemo(
    () => ({
      list: listQuery.data ?? [],
      loading: listQuery.isLoading,
      fetching: listQuery.isFetching,
      error: listQuery.error,

      refetch: listQuery.refetch,

      create,
      updateById,
      deleteById,

      isMutating,
    }),
    [listQuery, create, updateById, deleteById, isMutating],
  );

  return api;
}