import { useMemo, useState } from 'react';
import { IVehicle } from '../types/fleet.types';

export function useFleetFilters(vehicles: IVehicle[]) {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');

  const filteredVehicles = useMemo(() => {
    let filtered = vehicles;

    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      filtered = filtered.filter((v) =>
        [v.name, v.brand, v.model, v.registration_number, v.vin]
          .filter(Boolean)
          .some((x) => String(x).toLowerCase().includes(s)),
      );
    }

    if (statusFilter !== 'all') {
      filtered = filtered.filter((v) => v.status === statusFilter);
    }

    if (categoryFilter !== 'all') {
      filtered = filtered.filter((v) => v.category === categoryFilter);
    }

    return filtered;
  }, [vehicles, searchTerm, statusFilter, categoryFilter]);

  return {
    searchTerm,
    setSearchTerm,
    statusFilter,
    setStatusFilter,
    categoryFilter,
    setCategoryFilter,
    filteredVehicles,
  };
}