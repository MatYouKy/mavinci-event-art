// hooks/useLazyVehicleById.ts
'use client';

import { useCallback } from 'react';
import { useLazyGetVehicleByIdQuery } from '@/app/crm/fleet/api/fleetApi';
// import type { VehicleDB } from '@/app/crm/fleet/types'; // jeśli masz typy osobno

export const useLazyVehicleById = () => {
  const [trigger, result] = useLazyGetVehicleByIdQuery();

  const load = useCallback(
    async (vehicleId: string) => {
      if (!vehicleId) return null;
      // unwrap => rzuci wyjątek, jeśli error (fajne do try/catch)
      return await trigger(vehicleId, true).unwrap();
    },
    [trigger],
  );

  return {
    load, // <--- wywołujesz ręcznie
    vehicle: result.data ?? null,
    data: result.data,
    isLoading: result.isLoading,
    isFetching: result.isFetching,
    isUninitialized: result.isUninitialized,
    error: result.error,
    reset: result.reset,
  };
};