// hooks/useVehicleDetail.ts
import { useMemo } from 'react';
import { useGetVehicleDetailQuery } from '../api/fleetApi';
import type { InsurancePolicyDB } from '../types/fleet.types';

type MaintenanceSource = 'maintenance_records' | 'periodic_inspections' | 'oil_changes' | 'timing_belt_changes';
export interface MaintenanceVM {
  id: string;
  type: string;
  date: string;
  odometer_reading: number;
  title: string;
  description?: string;
  service_provider?: string;
  labor_cost?: number;
  parts_cost?: number;
  total_cost?: number;
  next_service_date?: string;
  next_service_mileage?: number;
  status?: string;
  notes?: string;
  valid_until?: string;
  performed_by?: { name: string; surname: string } | null;
  source: MaintenanceSource;
}

export function useVehicleDetail(vehicleId: string) {
  const { data, isLoading, isFetching, error, refetch } = useGetVehicleDetailQuery({ vehicleId }, { skip: !vehicleId });

  const formatDate = (date?: string | null) => (!date ? '-' : new Date(date).toLocaleDateString('pl-PL'));
  const getDaysUntil = (date?: string | null) => {
    if (!date) return null;
    return Math.ceil((new Date(date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  };

  const maintenanceRecords: MaintenanceVM[] = useMemo(() => {
    if (!data) return [];

    const { maintenance, inspections, oil, timing, repairs } = data.maintenanceRecords;

    const all: MaintenanceVM[] = [
      ...(maintenance || []).map((r: any) => ({ ...r, source: 'maintenance_records' as const })),
      ...(inspections || []).map((r: any) => ({
        id: r.id,
        type: r.inspection_type === 'technical_inspection' ? 'Przegląd techniczny' : 'Przegląd okresowy',
        date: r.inspection_date,
        odometer_reading: r.odometer_reading,
        title: `${r.inspection_type === 'technical_inspection' ? 'Przegląd techniczny' : 'Przegląd okresowy'} - ${
          r.passed ? 'Pozytywny' : 'Negatywny'
        }`,
        description: r.defects_noted || 'Brak uwag',
        service_provider: r.service_provider,
        labor_cost: 0,
        parts_cost: 0,
        total_cost: r.cost || 0,
        notes: r.notes,
        valid_until: r.valid_until,
        performed_by: r.performed_by,
        source: 'periodic_inspections' as const,
      })),
      ...(oil || []).map((r: any) => ({
        id: r.id,
        type: 'Wymiana oleju',
        date: r.change_date,
        odometer_reading: r.odometer_reading,
        title: 'Wymiana oleju i filtrów',
        description: `Następna wymiana: ${r.next_change_due_mileage} km lub ${r.next_change_due_date}`,
        service_provider: r.service_provider,
        labor_cost: r.labor_cost || 0,
        parts_cost: r.parts_cost || 0,
        total_cost: r.total_cost || 0,
        notes: r.notes,
        source: 'oil_changes' as const,
      })),
      ...(timing || []).map((r: any) => ({
        id: r.id,
        type: 'Wymiana rozrządu',
        date: r.change_date,
        odometer_reading: r.odometer_reading,
        title: 'Wymiana rozrządu',
        description: `Następna wymiana: ${r.next_change_due_mileage} km`,
        service_provider: r.service_provider,
        labor_cost: r.labor_cost || 0,
        parts_cost: r.parts_cost || 0,
        total_cost: r.total_cost || 0,
        notes: r.notes,
        source: 'timing_belt_changes' as const,
      })),
      ...(repairs || []).map((r: any) => ({
        id: r.id,
        type: r.type || 'Naprawa',
        date: r.date,
        odometer_reading: r.odometer_reading,
        title: r.title,
        description: r.description,
        service_provider: r.service_provider,
        labor_cost: r.labor_cost || 0,
        parts_cost: r.parts_cost || 0,
        total_cost: r.total_cost || 0,
        status: r.status,
        notes: r.notes,
        next_service_date: r.next_service_date,
        next_service_mileage: r.next_service_mileage,
        source: 'maintenance_records' as const,
      })),
    ];

    all.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return all;
  }, [data]);

  const upcomingMaintenance = useMemo(() => {
    return maintenanceRecords.filter((r) => {
      const days = getDaysUntil(r.next_service_date || null);
      return !!days && days > 0 && days <= 30;
    });
  }, [maintenanceRecords]);

  const expiringInsurance: InsurancePolicyDB[] = useMemo(() => {
    if (!data) return [];
    // u Ciebie alert.related_id -> policy.id
    return data.vehicleAlerts
      .map((a) => data.insurancePolicies.find((p) => p.id === a.related_id) || null)
      .filter(Boolean) as InsurancePolicyDB[];
  }, [data]);

  const totals = useMemo(() => {
    if (!data) return { totalFuelCost: 0, totalMaintenanceCost: 0, totalInsuranceCost: 0, avgConsumption: 0 };

    const totalFuelCost = data.fuelEntries.reduce((sum, f: any) => sum + (f.total_cost || 0), 0);
    const totalMaintenanceCost = maintenanceRecords.reduce((sum, m) => sum + (m.total_cost || 0), 0);
    const totalInsuranceCost = data.insurancePolicies.filter((p) => p.status === 'active').reduce((sum, i) => sum + (i.premium_amount || 0), 0);

    const cons = data.fuelEntries.filter((f: any) => f.avg_consumption);
    const avgConsumption = cons.reduce((sum: number, f: any) => sum + f.avg_consumption, 0) / Math.max(cons.length, 1);

    return { totalFuelCost, totalMaintenanceCost, totalInsuranceCost, avgConsumption };
  }, [data, maintenanceRecords]);

  return {
    data,
    vehicle: data?.vehicle ?? null,
    fuelEntries: data?.fuelEntries ?? [],
    insurancePolicies: data?.insurancePolicies ?? [],
    handoverHistory: data?.handoverHistory ?? [],
    vehicleAlerts: data?.vehicleAlerts ?? [],

    maintenanceRecords,
    upcomingMaintenance,
    expiringInsurance,

    totals,
    formatDate,
    getDaysUntil,

    isLoading,
    isFetching,
    error,
    refetch,
  };
}