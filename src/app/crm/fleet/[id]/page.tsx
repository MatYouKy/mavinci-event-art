'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Car,
  ArrowLeft,
  CreditCard as Edit,
  Fuel,
  Wrench,
  Shield,
  Calendar,
  MapPin,
  Gauge,
  Plus,
  AlertTriangle,
  Clock,
  User,
  Trash2,
  Activity,
  Image as ImageIcon,
  X,
} from 'lucide-react';

import { useVehicleDetail } from '@/app/crm/fleet/hooks/useVehicleDetail';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';

import AddMaintenanceModal from '@/components/crm/AddMaintenanceModal';
import AddInsuranceModal from '@/components/crm/AddInsuranceModal';
import AddFuelEntryModal from '@/components/crm/AddFuelEntryModal';
import VehicleGallery from '@/components/crm/VehicleGallery';
import VehicleAttributesPanel from '@/components/crm/VehicleAttributesPanel';
import VehicleLicenseRequirementsPanel from '@/components/crm/VehicleLicenseRequirementsPanel';

interface Vehicle {
  id: string;
  vehicle_type: string;
  name: string;
  brand: string;
  model: string;
  year: number;
  registration_number: string;
  vin: string;
  status: string;
  category: string;
  fuel_type: string;
  current_mileage: number;
  color: string;
  power_hp: number;
  engine_capacity: number;
  transmission: string;
  ownership_type: string;
  purchase_date: string;
  purchase_price: number;
  description: string;
  notes: string;
  created_at: string;
  in_use?: boolean;
  in_use_by?: string | null;
  in_use_event?: string | null;
  in_use_event_id?: string | null;
  pickup_timestamp?: string | null;
}

interface FuelEntry {
  id: string;
  date: string;
  location: string;
  odometer_reading: number;
  fuel_type: string;
  liters: number;
  price_per_liter: number;
  total_cost: number;
  avg_consumption: number;
  distance_since_last: number;
  is_full_tank: boolean;
  notes: string;
  filled_by: string;
  employees: { name: string; surname: string } | null;
}

interface MaintenanceRecord {
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
  source: 'maintenance_records' | 'periodic_inspections' | 'oil_changes' | 'timing_belt_changes';
}

interface InsurancePolicy {
  id: string;
  type: string;
  insurance_company: string;
  policy_number: string;
  start_date: string;
  end_date: string;
  premium_amount: number;
  status: string;
  notes: string;
}

interface VehicleHandover {
  id: string;
  handover_type: 'pickup' | 'return';
  odometer_reading: number;
  timestamp: string;
  notes: string | null;
  event_name: string;
  event_date: string;
  event_location: string;
  driver_name: string;
  driver_email: string;
}

export default function VehicleDetailPage() {
  const params = useParams();
  const router = useRouter();

  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const { canManageModule, isAdmin } = useCurrentEmployee();
  const canManage = canManageModule('fleet');

  const vehicleId = params.id as string;
  const { data, isLoading, refetch } = useVehicleDetail(vehicleId);

  const vehicleDetail = useVehicleDetail(vehicleId);

  const vehicle = (data as any)?.vehicle?.data ?? (data as any)?.vehicle ?? null;

  const fuelEntries = (data as any)?.fuelEntries?.data ?? (data as any)?.fuelEntries ?? [];

  const insurancePolicies =
    (data as any)?.insurancePolicies?.data ?? (data as any)?.insurancePolicies ?? [];

  const vehicleAlerts = (data as any)?.vehicleAlerts?.data ?? (data as any)?.vehicleAlerts ?? [];

  const handoverHistory =
    (data as any)?.handoverHistory?.data ?? (data as any)?.handoverHistory ?? [];

  const grouped = (data as any)?.maintenanceRecords?.data ?? (data as any)?.maintenanceRecords;

  // grouped maintenance z hooka
  const maintenance = grouped?.maintenance ?? [];
  const inspections = grouped?.inspections ?? [];
  const oil = grouped?.oil ?? [];
  const timing = grouped?.timing ?? [];
  const repairs = grouped?.repairs ?? [];

  // spłaszcz do jednej listy (tak jak renderujesz)
  const allMaintenance: MaintenanceRecord[] = [
    ...maintenance?.map((r: any) => ({ ...r, source: 'maintenance_records' as const })),
    ...inspections?.map((r: any) => ({
      id: r.id,
      type:
        r.inspection_type === 'technical_inspection' ? 'Przegląd techniczny' : 'Przegląd okresowy',
      date: r.inspection_date,
      odometer_reading: r.odometer_reading,
      title: `${r.inspection_type === 'technical_inspection' ? 'Przegląd techniczny' : 'Przegląd okresowy'} - ${r.passed ? 'Pozytywny' : 'Negatywny'}`,
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
    ...oil.map((r: any) => ({
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
    ...timing.map((r: any) => ({
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
    ...repairs.map((r: any) => ({
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
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const [activeTab, setActiveTab] = useState<
    'overview' | 'fuel' | 'maintenance' | 'insurance' | 'gallery' | 'history'
  >('overview');

  const [showMaintenanceModal, setShowMaintenanceModal] = useState(false);
  const [showInsuranceModal, setShowInsuranceModal] = useState(false);
  const [showFuelModal, setShowFuelModal] = useState(false);

  const formatDate = (date: string) => {
    if (!date) return '-';
    return new Date(date).toLocaleDateString('pl-PL');
  };

  const formatCurrency = (amount: number) => {
    if (!amount) return '-';
    return `${amount.toFixed(2)} zł`;
  };

  const getDaysUntil = (date: string) => {
    if (!date) return null;
    const days = Math.ceil((new Date(date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    return days;
  };

  const upcomingMaintenance = allMaintenance.filter(
    (r) =>
      r.next_service_date &&
      (getDaysUntil(r.next_service_date) ?? 0) > 0 &&
      (getDaysUntil(r.next_service_date) ?? 0) <= 30,
  );

  const expiringInsurance = vehicleAlerts
    .map((alert) => {
      const policy = insurancePolicies.find((p) => p.id === alert.related_id);
      return policy || null;
    })
    .filter(Boolean) as InsurancePolicy[];

  const totalFuelCost = fuelEntries.reduce((sum, f) => sum + (f.total_cost || 0), 0);
  const totalMaintenanceCost = allMaintenance.reduce((sum, m) => sum + (m.total_cost || 0), 0);
  const totalInsuranceCost = insurancePolicies
    .filter((p) => p.status === 'active')
    .reduce((sum, i) => sum + (i.premium_amount || 0), 0);

  const avgConsumption =
    fuelEntries.filter((f) => f.avg_consumption).reduce((sum, f) => sum + f.avg_consumption, 0) /
    Math.max(fuelEntries.filter((f) => f.avg_consumption).length, 1);

  const getStatusBadge = (status: string, inUse: boolean = false) => {
    if (inUse) {
      return (
        <span className="flex items-center gap-2 rounded border border-[#d3bb73]/30 bg-[#d3bb73]/20 px-3 py-1 text-sm text-[#d3bb73]">
          <Activity className="h-4 w-4" />W użytkowaniu
        </span>
      );
    }

    const config: Record<string, { label: string; class: string }> = {
      active: { label: 'Dostępny', class: 'bg-green-500/20 text-green-400' },
      inactive: { label: 'Nieaktywny', class: 'bg-gray-500/20 text-gray-400' },
      in_service: { label: 'W serwisie', class: 'bg-orange-500/20 text-orange-400' },
      completed: { label: 'Zakończony', class: 'bg-green-500/20 text-green-400' },
      scheduled: { label: 'Zaplanowany', class: 'bg-blue-500/20 text-blue-400' },
      expired: { label: 'Wygasłe', class: 'bg-red-500/20 text-red-400' },
    };
    const c = config[status] || config.inactive;
    return <span className={`rounded px-2 py-1 text-xs ${c.class}`}>{c.label}</span>;
  };

  const handleDeleteMaintenanceRecord = async (record: MaintenanceRecord) => {
    const confirmed = await showConfirm(
      'Czy na pewno chcesz usunąć ten wpis serwisowy?',
      'Tej operacji nie można cofnąć.',
    );
    if (!confirmed) return;

    try {
      const { error } = await supabase.from(record.source).delete().eq('id', record.id);
      if (error) throw error;

      showSnackbar('Wpis serwisowy został usunięty', 'success');
      refetch();
    } catch (error) {
      console.error('Error deleting maintenance record:', error);
      showSnackbar('Błąd podczas usuwania wpisu', 'error');
    }
  };

  const handleDeleteInsurance = async (policy: InsurancePolicy) => {
    const confirmed = await showConfirm(
      'Czy na pewno chcesz usunąć to ubezpieczenie?',
      'Tej operacji nie można cofnąć.',
    );
    if (!confirmed) return;

    try {
      const { error } = await supabase.from('insurance_policies').delete().eq('id', policy.id);
      if (error) throw error;

      showSnackbar('Ubezpieczenie zostało usunięte', 'success');
      refetch();
    } catch (error) {
      console.error('Error deleting insurance:', error);
      showSnackbar('Błąd podczas usuwania ubezpieczenia', 'error');
    }
  };

  const handleEndUsage = async () => {
    if (!vehicle?.in_use_event_id) return;

    const confirmed = await showConfirm(
      'Zakończ użytkowanie pojazdu',
      'Czy na pewno chcesz zakończyć użytkowanie tego pojazdu? Pojazd zostanie zwolniony z wydarzenia.',
    );
    if (!confirmed) return;

    try {
      const { error } = await supabase
        .from('event_vehicles')
        .update({ is_in_use: false })
        .eq('vehicle_id', vehicleId)
        .eq('event_id', vehicle.in_use_event_id)
        .eq('is_in_use', true);

      if (error) throw error;

      showSnackbar('Użytkowanie pojazdu zostało zakończone', 'success');
      refetch();
    } catch (error) {
      console.error('Error ending vehicle usage:', error);
      showSnackbar('Błąd podczas kończenia użytkowania pojazdu', 'error');
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-[#d3bb73]" />
      </div>
    );
  }

  if (!vehicle) {
    return (
      <div className="p-6">
        <div className="text-center">
          <Car className="mx-auto mb-4 h-16 w-16 text-[#e5e4e2]/20" />
          <p className="text-lg text-[#e5e4e2]/60">Nie znaleziono pojazdu</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <button
            onClick={() => router.push('/crm/fleet')}
            className="mb-4 flex items-center gap-2 text-[#e5e4e2]/60 hover:text-[#e5e4e2]"
          >
            <ArrowLeft className="h-4 w-4" />
            Powrót do listy
          </button>

          <div className="flex items-center gap-4">
            <h1 className="text-3xl font-bold text-[#e5e4e2]">{vehicle.name}</h1>
            {getStatusBadge(vehicle.status, vehicle.in_use || false)}
          </div>

          <p className="mt-1 text-[#e5e4e2]/60">
            {vehicle.brand} {vehicle.model} {vehicle.year && `(${vehicle.year})`}
          </p>

          {vehicle.in_use && vehicle.in_use_by && (
            <div className="mt-2 flex items-center gap-3 rounded-lg border border-[#d3bb73]/30 bg-[#d3bb73]/10 p-3">
              <div className="flex-1">
                <p className="flex items-center gap-2 text-sm text-[#d3bb73]">
                  <User className="h-4 w-4" />
                  Użytkowany przez: {vehicle.in_use_by}
                  {vehicle.in_use_event && (
                    <span className="text-[#e5e4e2]/60">
                      {' • '}
                      <button
                        onClick={() => router.push(`/crm/events/${vehicle.in_use_event_id}`)}
                        className="hover:underline"
                      >
                        {vehicle.in_use_event}
                      </button>
                    </span>
                  )}
                </p>

                {vehicle.pickup_timestamp && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-[#e5e4e2]/60">
                    <Clock className="h-3 w-3" />
                    Odbiór: {new Date(vehicle.pickup_timestamp).toLocaleString('pl-PL')}
                  </p>
                )}
              </div>

              {canManage && (
                <button
                  onClick={handleEndUsage}
                  className="flex items-center gap-2 rounded-lg bg-red-500/20 px-3 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/30"
                  title="Zakończ użytkowanie pojazdu"
                >
                  <X className="h-4 w-4" />
                  Zakończ użytkowanie
                </button>
              )}
            </div>
          )}
        </div>

        {canManage && (
          <button
            onClick={() => router.push(`/crm/fleet/${vehicleId}/edit`)}
            className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-3 font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
          >
            <Edit className="h-5 w-5" />
            Edytuj
          </button>
        )}
      </div>

      {/* Alerty */}
      {(upcomingMaintenance.length > 0 || expiringInsurance.length > 0) && (
        <div className="space-y-2">
          {upcomingMaintenance.map((m) => {
            const days = getDaysUntil(m.next_service_date!);
            return (
              <div
                key={m.id}
                className="flex items-center gap-3 rounded-lg border border-orange-500/20 bg-orange-500/10 p-4"
              >
                <AlertTriangle className="h-5 w-5 flex-shrink-0 text-orange-400" />
                <div className="flex-1">
                  <p className="font-medium text-orange-400">Zbliżający się przegląd</p>
                  <p className="text-sm text-[#e5e4e2]/80">
                    {m.title} - za {days} {days === 1 ? 'dzień' : 'dni'} (
                    {formatDate(m.next_service_date!)})
                  </p>
                </div>
              </div>
            );
          })}

          {expiringInsurance.map((i) => {
            const days = getDaysUntil(i.end_date);
            return (
              <div
                key={i.id}
                className="flex items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/10 p-4"
              >
                <Shield className="h-5 w-5 flex-shrink-0 text-red-400" />
                <div className="flex-1">
                  <p className="font-medium text-red-400">Wygasające ubezpieczenie</p>
                  <p className="text-sm text-[#e5e4e2]/80">
                    {i.type.toUpperCase()} ({i.insurance_company}) - za {days}{' '}
                    {days === 1 ? 'dzień' : 'dni'} ({formatDate(i.end_date)})
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Statystyki */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        {vehicle.vehicle_type !== 'trailer' && (
          <>
            <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm text-[#e5e4e2]/60">Przebieg</span>
                <Gauge className="h-5 w-5 text-[#d3bb73]" />
              </div>
              <div className="text-2xl font-bold text-[#e5e4e2]">
                {vehicle.current_mileage?.toLocaleString()} km
              </div>
            </div>

            <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm text-[#e5e4e2]/60">Śr. zużycie</span>
                <Activity className="h-5 w-5 text-[#d3bb73]" />
              </div>
              <div className="text-2xl font-bold text-[#e5e4e2]">
                {avgConsumption > 0 ? `${avgConsumption.toFixed(1)} l/100km` : '-'}
              </div>
            </div>

            <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm text-[#e5e4e2]/60">Koszt paliwa</span>
                <Fuel className="h-5 w-5 text-[#d3bb73]" />
              </div>
              <div className="text-2xl font-bold text-[#e5e4e2]">
                {(totalFuelCost / 1000).toFixed(1)}k zł
              </div>
            </div>
          </>
        )}

        <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm text-[#e5e4e2]/60">Koszt serwisu</span>
            <Wrench className="h-5 w-5 text-[#d3bb73]" />
          </div>
          <div className="text-2xl font-bold text-[#e5e4e2]">
            {(totalMaintenanceCost / 1000).toFixed(1)}k zł
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-[#d3bb73]/10">
        <div className="flex gap-4">
          {[
            { id: 'overview', label: 'Informacje', icon: Car },
            ...(vehicle.vehicle_type !== 'trailer'
              ? [{ id: 'fuel', label: 'Tankowania', icon: Fuel }]
              : []),
            { id: 'maintenance', label: 'Serwis i naprawy', icon: Wrench },
            { id: 'insurance', label: 'Ubezpieczenia', icon: Shield },
            { id: 'history', label: 'Historia użytkowania', icon: Clock },
            { id: 'gallery', label: 'Galeria', icon: ImageIcon },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 border-b-2 px-4 py-3 transition-colors ${
                activeTab === tab.id
                  ? 'border-[#d3bb73] text-[#d3bb73]'
                  : 'border-transparent text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
              }`}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === 'overview' && (
          <div className="space-y-6">
            <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
              <h2 className="mb-4 text-xl font-semibold text-[#e5e4e2]">Dane podstawowe</h2>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <span className="text-sm text-[#e5e4e2]/60">Marka i model</span>
                  <p className="font-medium text-[#e5e4e2]">
                    {vehicle.brand} {vehicle.model}
                  </p>
                </div>

                <div>
                  <span className="text-sm text-[#e5e4e2]/60">Rok produkcji</span>
                  <p className="font-medium text-[#e5e4e2]">{vehicle.year || '-'}</p>
                </div>

                <div>
                  <span className="text-sm text-[#e5e4e2]/60">Numer rejestracyjny</span>
                  <p className="font-medium text-[#e5e4e2]">{vehicle.registration_number || '-'}</p>
                </div>

                <div>
                  <span className="text-sm text-[#e5e4e2]/60">VIN</span>
                  <p className="font-medium text-[#e5e4e2]">{vehicle.vin || '-'}</p>
                </div>

                <div>
                  <span className="text-sm text-[#e5e4e2]/60">Kolor</span>
                  <p className="font-medium text-[#e5e4e2]">{vehicle.color || '-'}</p>
                </div>

                <div>
                  <span className="text-sm text-[#e5e4e2]/60">Kategoria</span>
                  <p className="font-medium text-[#e5e4e2]">{vehicle.category || '-'}</p>
                </div>

                {vehicle.vehicle_type !== 'trailer' && (
                  <>
                    <div>
                      <span className="text-sm text-[#e5e4e2]/60">Typ paliwa</span>
                      <p className="font-medium text-[#e5e4e2]">{vehicle.fuel_type || '-'}</p>
                    </div>

                    <div>
                      <span className="text-sm text-[#e5e4e2]/60">Skrzynia biegów</span>
                      <p className="font-medium text-[#e5e4e2]">{vehicle.transmission || '-'}</p>
                    </div>

                    <div>
                      <span className="text-sm text-[#e5e4e2]/60">Moc</span>
                      <p className="font-medium text-[#e5e4e2]">
                        {vehicle.power_hp ? `${vehicle.power_hp} KM` : '-'}
                      </p>
                    </div>

                    <div>
                      <span className="text-sm text-[#e5e4e2]/60">Pojemność silnika</span>
                      <p className="font-medium text-[#e5e4e2]">
                        {vehicle.engine_capacity ? `${vehicle.engine_capacity} cm³` : '-'}
                      </p>
                    </div>
                  </>
                )}

                <div>
                  <span className="text-sm text-[#e5e4e2]/60">Typ własności</span>
                  <p className="font-medium text-[#e5e4e2]">{vehicle.ownership_type || '-'}</p>
                </div>

                <div>
                  <span className="text-sm text-[#e5e4e2]/60">Data zakupu</span>
                  <p className="font-medium text-[#e5e4e2]">{formatDate(vehicle.purchase_date)}</p>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
              <VehicleAttributesPanel vehicleId={vehicleId} canEdit={canManage} />
            </div>

            <VehicleLicenseRequirementsPanel vehicleId={vehicleId} canEdit={canManage} />

            {(vehicle.description || vehicle.notes) && (
              <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
                <h2 className="mb-4 text-xl font-semibold text-[#e5e4e2]">Dodatkowe informacje</h2>

                {vehicle.description && (
                  <div className="mb-4">
                    <span className="text-sm text-[#e5e4e2]/60">Opis</span>
                    <p className="mt-1 text-[#e5e4e2]">{vehicle.description}</p>
                  </div>
                )}

                {vehicle.notes && (
                  <div>
                    <span className="text-sm text-[#e5e4e2]/60">Notatki</span>
                    <p className="mt-1 text-[#e5e4e2]">{vehicle.notes}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === 'fuel' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-[#e5e4e2]">Historia tankowań</h2>

              {canManage && (
                <button
                  onClick={() => setShowFuelModal(true)}
                  className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
                >
                  <Plus className="h-4 w-4" />
                  Dodaj tankowanie
                </button>
              )}
            </div>

            {fuelEntries.length === 0 ? (
              <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-12 text-center">
                <Fuel className="mx-auto mb-4 h-16 w-16 text-[#e5e4e2]/20" />
                <p className="text-[#e5e4e2]/60">Brak wpisów tankowania</p>
              </div>
            ) : (
              <div className="space-y-3">
                {fuelEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-4"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="mb-2 flex items-center gap-3">
                          <Calendar className="h-4 w-4 text-[#d3bb73]" />
                          <span className="font-medium text-[#e5e4e2]">
                            {formatDate(entry.date)}
                          </span>

                          {entry.is_full_tank && (
                            <span className="rounded bg-green-500/20 px-2 py-0.5 text-xs text-green-400">
                              Pełny bak
                            </span>
                          )}
                        </div>

                        <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
                          <div>
                            <span className="text-[#e5e4e2]/60">Stacja</span>
                            <p className="text-[#e5e4e2]">{entry.location || '-'}</p>
                          </div>

                          <div>
                            <span className="text-[#e5e4e2]/60">Przebieg</span>
                            <p className="text-[#e5e4e2]">
                              {entry.odometer_reading?.toLocaleString()} km
                            </p>
                          </div>

                          <div>
                            <span className="text-[#e5e4e2]/60">Litry</span>
                            <p className="text-[#e5e4e2]">{entry.liters?.toFixed(2)} l</p>
                          </div>

                          <div>
                            <span className="text-[#e5e4e2]/60">Koszt</span>
                            <p className="font-medium text-[#e5e4e2]">
                              {formatCurrency(entry.total_cost)}
                            </p>
                          </div>
                        </div>

                        {entry.avg_consumption && (
                          <div className="mt-2 flex items-center gap-2 text-sm">
                            <Activity className="h-4 w-4 text-[#d3bb73]" />
                            <span className="text-[#e5e4e2]/60">Średnie zużycie:</span>
                            <span className="font-medium text-[#d3bb73]">
                              {entry.avg_consumption.toFixed(1)} l/100km
                            </span>
                            {entry.distance_since_last && (
                              <span className="text-[#e5e4e2]/40">
                                ({entry.distance_since_last} km)
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'maintenance' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-[#e5e4e2]">Historia serwisu i napraw</h2>

              {canManage && (
                <button
                  onClick={() => setShowMaintenanceModal(true)}
                  className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
                >
                  <Plus className="h-4 w-4" />
                  Dodaj wpis serwisowy
                </button>
              )}
            </div>

            {allMaintenance.length === 0 ? (
              <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-12 text-center">
                <Wrench className="mx-auto mb-4 h-16 w-16 text-[#e5e4e2]/20" />
                <p className="text-[#e5e4e2]/60">Brak wpisów serwisowych</p>
              </div>
            ) : (
              <div className="space-y-3">
                {allMaintenance.map((record) => (
                  <div
                    key={record.id}
                    className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-4"
                  >
                    <div className="mb-3 flex items-start justify-between">
                      <div className="flex-1">
                        <div className="mb-2 flex items-center gap-3">
                          <h3 className="font-medium text-[#e5e4e2]">{record.title}</h3>
                          {getStatusBadge(record.status || '')}
                        </div>

                        <div className="flex items-center gap-4 text-sm text-[#e5e4e2]/60">
                          <span className="flex items-center gap-1">
                            <Calendar className="h-4 w-4" />
                            {formatDate(record.date)}
                          </span>

                          <span className="flex items-center gap-1">
                            <Gauge className="h-4 w-4" />
                            {record.odometer_reading?.toLocaleString()} km
                          </span>
                        </div>
                      </div>

                      <div className="flex items-start gap-3">
                        <div className="text-right">
                          <div className="text-lg font-medium text-[#d3bb73]">
                            {formatCurrency(record.total_cost || 0)}
                          </div>
                          <div className="text-xs text-[#e5e4e2]/60">
                            Robocizna: {formatCurrency(record.labor_cost || 0)}
                          </div>
                          <div className="text-xs text-[#e5e4e2]/60">
                            Części: {formatCurrency(record.parts_cost || 0)}
                          </div>
                        </div>

                        {isAdmin && (
                          <button
                            onClick={() => handleDeleteMaintenanceRecord(record)}
                            className="rounded-lg p-2 text-red-400 transition-colors hover:bg-red-500/10 hover:text-red-300"
                            title="Usuń wpis"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    {record.description && (
                      <p className="mb-2 text-sm text-[#e5e4e2]/80">{record.description}</p>
                    )}

                    {record.service_provider && (
                      <div className="text-sm text-[#e5e4e2]/60">
                        Warsztat: {record.service_provider}
                      </div>
                    )}

                    {record.next_service_date && (
                      <div className="mt-3 flex items-center gap-2 border-t border-[#d3bb73]/10 pt-3 text-sm">
                        <Clock className="h-4 w-4 text-orange-400" />
                        <span className="text-[#e5e4e2]/60">Następny serwis:</span>
                        <span className="font-medium text-[#e5e4e2]">
                          {formatDate(record.next_service_date)}
                        </span>
                        {record.next_service_mileage && (
                          <span className="text-[#e5e4e2]/60">
                            lub przy {record.next_service_mileage?.toLocaleString()} km
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'insurance' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-[#e5e4e2]">Ubezpieczenia</h2>

              {canManage && (
                <button
                  onClick={() => setShowInsuranceModal(true)}
                  className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
                >
                  <Plus className="h-4 w-4" />
                  Dodaj ubezpieczenie
                </button>
              )}
            </div>

            {insurancePolicies.length === 0 ? (
              <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-12 text-center">
                <Shield className="mx-auto mb-4 h-16 w-16 text-[#e5e4e2]/20" />
                <p className="text-[#e5e4e2]/60">Brak polis ubezpieczeniowych</p>
              </div>
            ) : (
              <div className="space-y-3">
                {insurancePolicies.map((policy) => {
                  const daysUntilExpiry = getDaysUntil(policy.end_date);
                  const isExpiringSoon =
                    daysUntilExpiry && daysUntilExpiry > 0 && daysUntilExpiry <= 60;

                  return (
                    <div
                      key={policy.id}
                      className={`rounded-lg border bg-[#1c1f33] p-4 ${
                        isExpiringSoon ? 'border-red-500/30 bg-red-500/5' : 'border-[#d3bb73]/10'
                      }`}
                    >
                      <div className="mb-3 flex items-start justify-between">
                        <div className="flex-1">
                          <div className="mb-2 flex items-center gap-3">
                            <h3 className="font-medium uppercase text-[#e5e4e2]">{policy.type}</h3>
                            {getStatusBadge(policy.status)}
                            {isExpiringSoon && (
                              <span className="flex items-center gap-1 rounded bg-red-500/20 px-2 py-0.5 text-xs text-red-400">
                                <AlertTriangle className="h-3 w-3" />
                                Wygasa za {daysUntilExpiry} dni
                              </span>
                            )}
                          </div>

                          <div className="mb-1 text-sm text-[#e5e4e2]/80">
                            {policy.insurance_company}
                          </div>
                          <div className="text-sm text-[#e5e4e2]/60">
                            Polisa: {policy.policy_number}
                          </div>
                        </div>

                        <div className="flex items-start gap-3">
                          <div className="text-right">
                            <div className="text-lg font-medium text-[#d3bb73]">
                              {formatCurrency(policy.premium_amount)}
                            </div>
                            <div className="text-xs text-[#e5e4e2]/60">składka roczna</div>
                          </div>

                          {isAdmin && (
                            <button
                              onClick={() => handleDeleteInsurance(policy)}
                              className="rounded-lg p-2 text-red-400 transition-colors hover:bg-red-500/10 hover:text-red-300"
                              title="Usuń ubezpieczenie"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-6 text-sm">
                        <div>
                          <span className="text-[#e5e4e2]/60">Początek:</span>
                          <span className="ml-2 text-[#e5e4e2]">
                            {formatDate(policy.start_date)}
                          </span>
                        </div>

                        <div>
                          <span className="text-[#e5e4e2]/60">Koniec:</span>
                          <span className="ml-2 text-[#e5e4e2]">{formatDate(policy.end_date)}</span>
                        </div>
                      </div>

                      {policy.notes && (
                        <div className="mt-2 text-sm text-[#e5e4e2]/80">{policy.notes}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === 'history' && (
          <div className="space-y-4">
            <div className="rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] p-6">
              <h3 className="mb-4 text-lg font-semibold text-[#e5e4e2]">
                Historia odbiorów i zdań pojazdu
              </h3>

              {handoverHistory.length === 0 ? (
                <div className="py-12 text-center">
                  <Clock className="mx-auto mb-3 h-12 w-12 text-[#e5e4e2]/20" />
                  <p className="text-[#e5e4e2]/60">Brak historii użytkowania pojazdu</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {handoverHistory.map((handover) => (
                    <div
                      key={handover.id}
                      className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-4"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="mb-2 flex items-center gap-3">
                            <span
                              className={`rounded px-2 py-1 text-xs font-medium ${
                                handover.handover_type === 'pickup'
                                  ? 'bg-blue-500/20 text-blue-400'
                                  : 'bg-green-500/20 text-green-400'
                              }`}
                            >
                              {handover.handover_type === 'pickup' ? 'Odbiór' : 'Zdanie'}
                            </span>
                            <span className="font-medium text-[#e5e4e2]">
                              {handover.odometer_reading.toLocaleString('pl-PL')} km
                            </span>
                          </div>

                          <div className="space-y-1 text-sm">
                            <div className="flex items-center gap-2 text-[#e5e4e2]/80">
                              <User className="h-4 w-4 text-[#d3bb73]" />
                              <span>{handover.driver_name}</span>
                            </div>

                            <div className="flex items-center gap-2 text-[#e5e4e2]/80">
                              <Calendar className="h-4 w-4 text-[#d3bb73]" />
                              <span>{formatDate(handover.timestamp)}</span>
                              <span className="text-[#e5e4e2]/60">
                                {new Date(handover.timestamp).toLocaleTimeString('pl-PL', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                            </div>

                            <div className="flex items-center gap-2 text-[#e5e4e2]/80">
                              <Activity className="h-4 w-4 text-[#d3bb73]" />
                              <span>{handover.event_name}</span>
                            </div>

                            {handover.event_location && (
                              <div className="flex items-center gap-2 text-[#e5e4e2]/60">
                                <MapPin className="h-4 w-4 text-[#d3bb73]/60" />
                                <span>{handover.event_location}</span>
                              </div>
                            )}

                            {handover.notes && (
                              <div className="mt-2 border-t border-[#d3bb73]/10 pt-2">
                                <p className="text-sm text-[#e5e4e2]/70">{handover.notes}</p>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'gallery' && (
          <div className="space-y-4">
            <VehicleGallery vehicleId={vehicleId} canManage={canManage} />
          </div>
        )}
      </div>

      {/* Modals */}
      {showFuelModal && vehicle && (
        <AddFuelEntryModal
          vehicleId={vehicleId}
          vehicleName={vehicle.name}
          currentMileage={vehicle.current_mileage}
          onClose={() => setShowFuelModal(false)}
          onSuccess={refetch}
        />
      )}

      {showMaintenanceModal && vehicle && (
        <AddMaintenanceModal
          vehicleId={vehicleId}
          vehicleName={vehicle.name}
          currentMileage={vehicle.current_mileage}
          onClose={() => setShowMaintenanceModal(false)}
          onSuccess={refetch}
        />
      )}

      {showInsuranceModal && vehicle && (
        <AddInsuranceModal
          vehicleId={vehicleId}
          vehicleName={vehicle.name}
          onClose={() => setShowInsuranceModal(false)}
          onSuccess={refetch}
        />
      )}
    </div>
  );
}
