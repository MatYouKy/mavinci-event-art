import { useCallback, useEffect, useRef } from 'react';
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

  // --- lazy trigger ---
  const [lazyGetById] = useLazyGetLocationByIdQuery();

  /**
   * ✅ Stabilizacja: trzymamy trigger w refie,
   * żeby `getById` NIE zmieniał referencji nawet jeśli trigger się zmienia.
   */
  const lazyGetByIdRef = useRef(lazyGetById);

  useEffect(() => {
    lazyGetByIdRef.current = lazyGetById;
  }, [lazyGetById]);

  // --- mutations ---
  const [createLocation, createState] = useCreateLocationMutation();
  const [updateLocation, updateState] = useUpdateLocationByIdMutation();
  const [deleteLocation, deleteState] = useDeleteLocationByIdMutation();

  const create = useCallback(async (data: LocationCreateInput) => {
    return await createLocation(data).unwrap();
  }, [createLocation]);

  const updateById = useCallback(async (id: string, data: LocationUpdateInput) => {
    return await updateLocation({ id, data }).unwrap();
  }, [updateLocation]);

  const deleteById = useCallback(async (id: string) => {
    return await deleteLocation(id).unwrap();
  }, [deleteLocation]);

  /**
   * ✅ TERAZ `getById` jest stabilne (dep array = [])
   * i nie powoduje pętli w useEffect w komponentach.
   */
  const getById = useCallback(async (id: string) => {
    return await lazyGetByIdRef.current(id).unwrap();
  }, []);

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