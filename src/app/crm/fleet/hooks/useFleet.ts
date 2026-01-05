// hooks/useFleet.ts
import { useMemo, useState } from 'react';
import { useGetFleetVehiclesQuery } from '../api/fleetApi';
import type { FleetVehicleVM } from '../types/fleet.types';

export function useFleet() {
  const { data: vehicles = [], isLoading, isFetching, error, refetch } = useGetFleetVehiclesQuery();

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  const filteredVehicles = useMemo(() => {
    let filtered: FleetVehicleVM[] = [...vehicles];

    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      filtered = filtered.filter(
        (v) =>
          v.name?.toLowerCase().includes(s) ||
          v.brand?.toLowerCase().includes(s) ||
          v.model?.toLowerCase().includes(s) ||
          v.registration_number?.toLowerCase().includes(s) ||
          v.vin?.toLowerCase().includes(s)
      );
    }

    if (statusFilter !== 'all') filtered = filtered.filter((v) => v.status === statusFilter);
    if (categoryFilter !== 'all') filtered = filtered.filter((v) => v.category === categoryFilter);

    return filtered;
  }, [vehicles, searchTerm, statusFilter, categoryFilter]);

  const stats = useMemo(() => {
    const total = vehicles.length;
    const active = vehicles.filter((v) => v.status === 'active').length;
    const in_service = vehicles.filter((v) => v.status === 'in_service').length;
    const totalCost = vehicles.reduce((sum, v) => sum + (v.yearly_maintenance_cost || 0) + (v.yearly_fuel_cost || 0), 0);
    const averageMileage = Math.round(
      vehicles.reduce((sum, v) => sum + (v.current_mileage || 0), 0) / Math.max(total, 1)
    );
    return { total, active, in_service, totalCost, averageMileage };
  }, [vehicles]);

  return {
    vehicles,
    filteredVehicles,
    stats,
    isLoading,
    isFetching,
    error,
    refetch,

    searchTerm,
    setSearchTerm,
    statusFilter,
    setStatusFilter,
    categoryFilter,
    setCategoryFilter,
  };
}