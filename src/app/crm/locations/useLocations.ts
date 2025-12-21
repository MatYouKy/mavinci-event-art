// src/app/crm/locations/hooks/useLocations.ts
import { useCallback } from 'react';
import {
  useGetLocationsListQuery,
  useGetLocationByIdQuery,
  useLazyGetLocationByIdQuery,
  useCreateLocationMutation,
  useUpdateLocationByIdMutation,
  useDeleteLocationByIdMutation,
} from './locationsApi';
import type { LocationCreateInput, LocationUpdateInput } from './type';

export function useLocations(options?: { locationId?: string }) {
  const listQuery = useGetLocationsListQuery();

  const locationQuery = useGetLocationByIdQuery(options?.locationId as string, {
    skip: !options?.locationId,
  });

  const [lazyGetById] = useLazyGetLocationByIdQuery();

  const [createLocation, createState] = useCreateLocationMutation();
  const [updateLocation, updateState] = useUpdateLocationByIdMutation();
  const [deleteLocation, deleteState] = useDeleteLocationByIdMutation();

  const create = useCallback(
    async (data: LocationCreateInput) => {
      return await createLocation(data).unwrap();
    },
    [createLocation],
  );

  const updateById = useCallback(
    async (id: string, data: LocationUpdateInput) => {
      return await updateLocation({ id, data }).unwrap();
    },
    [updateLocation],
  );

  const deleteById = useCallback(
    async (id: string) => {
      return await deleteLocation(id).unwrap();
    },
    [deleteLocation],
  );

  const getById = useCallback(
    async (id: string) => {
      return await lazyGetById(id).unwrap();
    },
    [lazyGetById],
  );

  return {
    // LIST
    list: listQuery.data ?? [],
    loading: listQuery.isLoading,
    error: listQuery.error,
    refetch: listQuery.refetch,

    // SINGLE (opcjonalnie pod details page)
    location: locationQuery.data ?? null,
    locationLoading: locationQuery.isLoading,
    locationError: locationQuery.error,

    // CRUD
    create,
    updateById,
    deleteById,
    getById,

    // stany mutacji
    isCreating: createState.isLoading,
    isUpdating: updateState.isLoading,
    isDeleting: deleteState.isLoading,
  };
}