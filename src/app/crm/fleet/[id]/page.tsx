'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Car,
  ArrowLeft,
  Edit,
  Fuel,
  Wrench,
  Shield,
  FileText,
  Calendar,
  MapPin,
  Gauge,
  DollarSign,
  Plus,
  AlertTriangle,
  Clock,
  User,
  TrendingUp,
  TrendingDown,
  Activity,
  Image as ImageIcon,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import AddMaintenanceModal from '@/components/crm/AddMaintenanceModal';
import AddInsuranceModal from '@/components/crm/AddInsuranceModal';
import AddFuelEntryModal from '@/components/crm/AddFuelEntryModal';
import VehicleGallery from '@/components/crm/VehicleGallery';
import VehicleAttributesPanel from '@/components/crm/VehicleAttributesPanel';
import VehicleLicenseRequirementsPanel from '@/components/crm/VehicleLicenseRequirementsPanel';

interface Vehicle {
  id: string;
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
  description: string;
  service_provider: string;
  labor_cost: number;
  parts_cost: number;
  total_cost: number;
  next_service_date: string;
  next_service_mileage: number;
  status: string;
  notes: string;
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
  const { canManageModule } = useCurrentEmployee();
  const canManage = canManageModule('fleet');

  const vehicleId = params.id as string;
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [fuelEntries, setFuelEntries] = useState<FuelEntry[]>([]);
  const [maintenanceRecords, setMaintenanceRecords] = useState<MaintenanceRecord[]>([]);
  const [insurancePolicies, setInsurancePolicies] = useState<InsurancePolicy[]>([]);
  const [handoverHistory, setHandoverHistory] = useState<VehicleHandover[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'fuel' | 'maintenance' | 'insurance' | 'gallery' | 'history'>('overview');

  const [showMaintenanceModal, setShowMaintenanceModal] = useState(false);
  const [showInsuranceModal, setShowInsuranceModal] = useState(false);
  const [showFuelModal, setShowFuelModal] = useState(false);

  useEffect(() => {
    if (vehicleId) {
      fetchVehicleData();
    }
  }, [vehicleId]);

  const fetchVehicleData = async () => {
    try {
      setLoading(true);

      const [vehicleRes, fuelRes, maintenanceRes, insuranceRes, handoverRes] = await Promise.all([
        supabase.from('vehicles').select('*').eq('id', vehicleId).single(),
        supabase
          .from('fuel_entries')
          .select('*, employees(name, surname)')
          .eq('vehicle_id', vehicleId)
          .order('date', { ascending: false })
          .limit(10),
        supabase
          .from('maintenance_records')
          .select('*')
          .eq('vehicle_id', vehicleId)
          .order('date', { ascending: false })
          .limit(10),
        supabase
          .from('insurance_policies')
          .select('*')
          .eq('vehicle_id', vehicleId)
          .order('end_date', { ascending: false }),
        supabase
          .from('vehicle_handover_history')
          .select('*')
          .eq('vehicle_id', vehicleId)
          .order('timestamp', { ascending: false }),
      ]);

      if (vehicleRes.error) throw vehicleRes.error;

      setVehicle(vehicleRes.data);
      setFuelEntries(fuelRes.data || []);
      setMaintenanceRecords(maintenanceRes.data || []);
      setInsurancePolicies(insuranceRes.data || []);
      setHandoverHistory(handoverRes.data || []);
    } catch (error) {
      console.error('Error fetching vehicle data:', error);
      showSnackbar('Błąd podczas ładowania danych pojazdu', 'error');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (date: string) => {
    if (!date) return '-';
    return new Date(date).toLocaleDateString('pl-PL');
  };

  const formatCurrency = (amount: number) => {
    if (!amount) return '-';
    return `${amount.toFixed(2)} zł`;
  };

  const getStatusBadge = (status: string) => {
    const config: Record<string, { label: string; class: string }> = {
      active: { label: 'Aktywny', class: 'bg-green-500/20 text-green-400' },
      inactive: { label: 'Nieaktywny', class: 'bg-gray-500/20 text-gray-400' },
      in_service: { label: 'W serwisie', class: 'bg-orange-500/20 text-orange-400' },
      completed: { label: 'Zakończony', class: 'bg-green-500/20 text-green-400' },
      scheduled: { label: 'Zaplanowany', class: 'bg-blue-500/20 text-blue-400' },
      expired: { label: 'Wygasłe', class: 'bg-red-500/20 text-red-400' },
    };
    const c = config[status] || config.inactive;
    return <span className={`px-2 py-1 rounded text-xs ${c.class}`}>{c.label}</span>;
  };

  const getDaysUntil = (date: string) => {
    if (!date) return null;
    const days = Math.ceil((new Date(date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    return days;
  };

  const upcomingMaintenance = maintenanceRecords.filter(
    (r) => r.next_service_date && getDaysUntil(r.next_service_date)! > 0 && getDaysUntil(r.next_service_date)! <= 30
  );

  const expiringInsurance = insurancePolicies.filter(
    (p) => p.status === 'active' && getDaysUntil(p.end_date)! > 0 && getDaysUntil(p.end_date)! <= 60
  );

  const totalFuelCost = fuelEntries.reduce((sum, f) => sum + (f.total_cost || 0), 0);
  const totalMaintenanceCost = maintenanceRecords.reduce((sum, m) => sum + (m.total_cost || 0), 0);
  const totalInsuranceCost = insurancePolicies
    .filter((p) => p.status === 'active')
    .reduce((sum, i) => sum + (i.premium_amount || 0), 0);

  const avgConsumption =
    fuelEntries.filter((f) => f.avg_consumption).reduce((sum, f) => sum + f.avg_consumption, 0) /
    Math.max(fuelEntries.filter((f) => f.avg_consumption).length, 1);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#d3bb73]"></div>
      </div>
    );
  }

  if (!vehicle) {
    return (
      <div className="p-6">
        <div className="text-center">
          <Car className="w-16 h-16 text-[#e5e4e2]/20 mx-auto mb-4" />
          <p className="text-[#e5e4e2]/60 text-lg">Nie znaleziono pojazdu</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <button
            onClick={() => router.back()}
            className="flex items-center gap-2 text-[#e5e4e2]/60 hover:text-[#e5e4e2] mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            Powrót do listy
          </button>
          <div className="flex items-center gap-4">
            <h1 className="text-3xl font-bold text-[#e5e4e2]">{vehicle.name}</h1>
            {getStatusBadge(vehicle.status)}
          </div>
          <p className="text-[#e5e4e2]/60 mt-1">
            {vehicle.brand} {vehicle.model} {vehicle.year && `(${vehicle.year})`}
          </p>
        </div>
        {canManage && (
          <button
            onClick={() => router.push(`/crm/fleet/${vehicleId}/edit`)}
            className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-6 py-3 rounded-lg hover:bg-[#d3bb73]/90 transition-colors font-medium"
          >
            <Edit className="w-5 h-5" />
            Edytuj
          </button>
        )}
      </div>

      {/* Alerty */}
      {(upcomingMaintenance.length > 0 || expiringInsurance.length > 0) && (
        <div className="space-y-2">
          {upcomingMaintenance.map((m) => {
            const days = getDaysUntil(m.next_service_date);
            return (
              <div
                key={m.id}
                className="flex items-center gap-3 bg-orange-500/10 border border-orange-500/20 rounded-lg p-4"
              >
                <AlertTriangle className="w-5 h-5 text-orange-400 flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-orange-400 font-medium">Zbliżający się przegląd</p>
                  <p className="text-[#e5e4e2]/80 text-sm">
                    {m.title} - za {days} {days === 1 ? 'dzień' : 'dni'} ({formatDate(m.next_service_date)})
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
                className="flex items-center gap-3 bg-red-500/10 border border-red-500/20 rounded-lg p-4"
              >
                <Shield className="w-5 h-5 text-red-400 flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-red-400 font-medium">Wygasające ubezpieczenie</p>
                  <p className="text-[#e5e4e2]/80 text-sm">
                    {i.type.toUpperCase()} ({i.insurance_company}) - za {days} {days === 1 ? 'dzień' : 'dni'} (
                    {formatDate(i.end_date)})
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Statystyki */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/10 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-[#e5e4e2]/60">Przebieg</span>
            <Gauge className="w-5 h-5 text-[#d3bb73]" />
          </div>
          <div className="text-2xl font-bold text-[#e5e4e2]">
            {vehicle.current_mileage?.toLocaleString()} km
          </div>
        </div>

        <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/10 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-[#e5e4e2]/60">Śr. zużycie</span>
            <Activity className="w-5 h-5 text-[#d3bb73]" />
          </div>
          <div className="text-2xl font-bold text-[#e5e4e2]">
            {avgConsumption > 0 ? `${avgConsumption.toFixed(1)} l/100km` : '-'}
          </div>
        </div>

        <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/10 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-[#e5e4e2]/60">Koszt paliwa</span>
            <Fuel className="w-5 h-5 text-[#d3bb73]" />
          </div>
          <div className="text-2xl font-bold text-[#e5e4e2]">
            {(totalFuelCost / 1000).toFixed(1)}k zł
          </div>
        </div>

        <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/10 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-[#e5e4e2]/60">Koszt serwisu</span>
            <Wrench className="w-5 h-5 text-[#d3bb73]" />
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
            { id: 'fuel', label: 'Tankowania', icon: Fuel },
            { id: 'maintenance', label: 'Serwis i naprawy', icon: Wrench },
            { id: 'insurance', label: 'Ubezpieczenia', icon: Shield },
            { id: 'history', label: 'Historia użytkowania', icon: Clock },
            { id: 'gallery', label: 'Galeria', icon: ImageIcon },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-[#d3bb73] text-[#d3bb73]'
                  : 'border-transparent text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Podstawowe dane */}
            <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/10 p-6">
              <h2 className="text-xl font-semibold text-[#e5e4e2] mb-4">Dane podstawowe</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <span className="text-sm text-[#e5e4e2]/60">Marka i model</span>
                  <p className="text-[#e5e4e2] font-medium">
                    {vehicle.brand} {vehicle.model}
                  </p>
                </div>
                <div>
                  <span className="text-sm text-[#e5e4e2]/60">Rok produkcji</span>
                  <p className="text-[#e5e4e2] font-medium">{vehicle.year || '-'}</p>
                </div>
                <div>
                  <span className="text-sm text-[#e5e4e2]/60">Numer rejestracyjny</span>
                  <p className="text-[#e5e4e2] font-medium">{vehicle.registration_number || '-'}</p>
                </div>
                <div>
                  <span className="text-sm text-[#e5e4e2]/60">VIN</span>
                  <p className="text-[#e5e4e2] font-medium">{vehicle.vin || '-'}</p>
                </div>
                <div>
                  <span className="text-sm text-[#e5e4e2]/60">Kolor</span>
                  <p className="text-[#e5e4e2] font-medium">{vehicle.color || '-'}</p>
                </div>
                <div>
                  <span className="text-sm text-[#e5e4e2]/60">Kategoria</span>
                  <p className="text-[#e5e4e2] font-medium">{vehicle.category || '-'}</p>
                </div>
                <div>
                  <span className="text-sm text-[#e5e4e2]/60">Typ paliwa</span>
                  <p className="text-[#e5e4e2] font-medium">{vehicle.fuel_type || '-'}</p>
                </div>
                <div>
                  <span className="text-sm text-[#e5e4e2]/60">Skrzynia biegów</span>
                  <p className="text-[#e5e4e2] font-medium">{vehicle.transmission || '-'}</p>
                </div>
                <div>
                  <span className="text-sm text-[#e5e4e2]/60">Moc</span>
                  <p className="text-[#e5e4e2] font-medium">
                    {vehicle.power_hp ? `${vehicle.power_hp} KM` : '-'}
                  </p>
                </div>
                <div>
                  <span className="text-sm text-[#e5e4e2]/60">Pojemność silnika</span>
                  <p className="text-[#e5e4e2] font-medium">
                    {vehicle.engine_capacity ? `${vehicle.engine_capacity} cm³` : '-'}
                  </p>
                </div>
                <div>
                  <span className="text-sm text-[#e5e4e2]/60">Typ własności</span>
                  <p className="text-[#e5e4e2] font-medium">{vehicle.ownership_type || '-'}</p>
                </div>
                <div>
                  <span className="text-sm text-[#e5e4e2]/60">Data zakupu</span>
                  <p className="text-[#e5e4e2] font-medium">{formatDate(vehicle.purchase_date)}</p>
                </div>
              </div>
            </div>

            {/* Właściwości pojazdu */}
            <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/10 p-6">
              <VehicleAttributesPanel vehicleId={vehicleId} canEdit={canManage} />
            </div>

            {/* Wymagane kategorie prawa jazdy */}
            <VehicleLicenseRequirementsPanel vehicleId={vehicleId} canEdit={canManage} />

            {/* Opis i notatki */}
            {(vehicle.description || vehicle.notes) && (
              <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/10 p-6">
                <h2 className="text-xl font-semibold text-[#e5e4e2] mb-4">Dodatkowe informacje</h2>
                {vehicle.description && (
                  <div className="mb-4">
                    <span className="text-sm text-[#e5e4e2]/60">Opis</span>
                    <p className="text-[#e5e4e2] mt-1">{vehicle.description}</p>
                  </div>
                )}
                {vehicle.notes && (
                  <div>
                    <span className="text-sm text-[#e5e4e2]/60">Notatki</span>
                    <p className="text-[#e5e4e2] mt-1">{vehicle.notes}</p>
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
                  className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Dodaj tankowanie
                </button>
              )}
            </div>

            {fuelEntries.length === 0 ? (
              <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/10 p-12 text-center">
                <Fuel className="w-16 h-16 text-[#e5e4e2]/20 mx-auto mb-4" />
                <p className="text-[#e5e4e2]/60">Brak wpisów tankowania</p>
              </div>
            ) : (
              <div className="space-y-3">
                {fuelEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/10 p-4"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <Calendar className="w-4 h-4 text-[#d3bb73]" />
                          <span className="text-[#e5e4e2] font-medium">{formatDate(entry.date)}</span>
                          {entry.is_full_tank && (
                            <span className="px-2 py-0.5 bg-green-500/20 text-green-400 text-xs rounded">
                              Pełny bak
                            </span>
                          )}
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                          <div>
                            <span className="text-[#e5e4e2]/60">Stacja</span>
                            <p className="text-[#e5e4e2]">{entry.location || '-'}</p>
                          </div>
                          <div>
                            <span className="text-[#e5e4e2]/60">Przebieg</span>
                            <p className="text-[#e5e4e2]">{entry.odometer_reading?.toLocaleString()} km</p>
                          </div>
                          <div>
                            <span className="text-[#e5e4e2]/60">Litry</span>
                            <p className="text-[#e5e4e2]">{entry.liters?.toFixed(2)} l</p>
                          </div>
                          <div>
                            <span className="text-[#e5e4e2]/60">Koszt</span>
                            <p className="text-[#e5e4e2] font-medium">{formatCurrency(entry.total_cost)}</p>
                          </div>
                        </div>
                        {entry.avg_consumption && (
                          <div className="mt-2 flex items-center gap-2 text-sm">
                            <Activity className="w-4 h-4 text-[#d3bb73]" />
                            <span className="text-[#e5e4e2]/60">Średnie zużycie:</span>
                            <span className="text-[#d3bb73] font-medium">
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
                  className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Dodaj wpis serwisowy
                </button>
              )}
            </div>

            {maintenanceRecords.length === 0 ? (
              <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/10 p-12 text-center">
                <Wrench className="w-16 h-16 text-[#e5e4e2]/20 mx-auto mb-4" />
                <p className="text-[#e5e4e2]/60">Brak wpisów serwisowych</p>
              </div>
            ) : (
              <div className="space-y-3">
                {maintenanceRecords.map((record) => (
                  <div
                    key={record.id}
                    className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/10 p-4"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="text-[#e5e4e2] font-medium">{record.title}</h3>
                          {getStatusBadge(record.status)}
                        </div>
                        <div className="flex items-center gap-4 text-sm text-[#e5e4e2]/60">
                          <span className="flex items-center gap-1">
                            <Calendar className="w-4 h-4" />
                            {formatDate(record.date)}
                          </span>
                          <span className="flex items-center gap-1">
                            <Gauge className="w-4 h-4" />
                            {record.odometer_reading?.toLocaleString()} km
                          </span>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[#d3bb73] font-medium text-lg">
                          {formatCurrency(record.total_cost)}
                        </div>
                        <div className="text-xs text-[#e5e4e2]/60">
                          Robocizna: {formatCurrency(record.labor_cost)}
                        </div>
                        <div className="text-xs text-[#e5e4e2]/60">
                          Części: {formatCurrency(record.parts_cost)}
                        </div>
                      </div>
                    </div>
                    {record.description && (
                      <p className="text-sm text-[#e5e4e2]/80 mb-2">{record.description}</p>
                    )}
                    {record.service_provider && (
                      <div className="text-sm text-[#e5e4e2]/60">
                        Warsztat: {record.service_provider}
                      </div>
                    )}
                    {record.next_service_date && (
                      <div className="mt-3 pt-3 border-t border-[#d3bb73]/10 flex items-center gap-2 text-sm">
                        <Clock className="w-4 h-4 text-orange-400" />
                        <span className="text-[#e5e4e2]/60">Następny serwis:</span>
                        <span className="text-[#e5e4e2] font-medium">
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
                  className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Dodaj ubezpieczenie
                </button>
              )}
            </div>

            {insurancePolicies.length === 0 ? (
              <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/10 p-12 text-center">
                <Shield className="w-16 h-16 text-[#e5e4e2]/20 mx-auto mb-4" />
                <p className="text-[#e5e4e2]/60">Brak polis ubezpieczeniowych</p>
              </div>
            ) : (
              <div className="space-y-3">
                {insurancePolicies.map((policy) => {
                  const daysUntilExpiry = getDaysUntil(policy.end_date);
                  const isExpiringSoon = daysUntilExpiry && daysUntilExpiry > 0 && daysUntilExpiry <= 60;

                  return (
                    <div
                      key={policy.id}
                      className={`bg-[#1c1f33] rounded-lg border p-4 ${
                        isExpiringSoon
                          ? 'border-red-500/30 bg-red-500/5'
                          : 'border-[#d3bb73]/10'
                      }`}
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <h3 className="text-[#e5e4e2] font-medium uppercase">
                              {policy.type}
                            </h3>
                            {getStatusBadge(policy.status)}
                            {isExpiringSoon && (
                              <span className="px-2 py-0.5 bg-red-500/20 text-red-400 text-xs rounded flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3" />
                                Wygasa za {daysUntilExpiry} dni
                              </span>
                            )}
                          </div>
                          <div className="text-sm text-[#e5e4e2]/80 mb-1">
                            {policy.insurance_company}
                          </div>
                          <div className="text-sm text-[#e5e4e2]/60">
                            Polisa: {policy.policy_number}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-[#d3bb73] font-medium text-lg">
                            {formatCurrency(policy.premium_amount)}
                          </div>
                          <div className="text-xs text-[#e5e4e2]/60">składka roczna</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-6 text-sm">
                        <div>
                          <span className="text-[#e5e4e2]/60">Początek:</span>
                          <span className="text-[#e5e4e2] ml-2">{formatDate(policy.start_date)}</span>
                        </div>
                        <div>
                          <span className="text-[#e5e4e2]/60">Koniec:</span>
                          <span className="text-[#e5e4e2] ml-2">{formatDate(policy.end_date)}</span>
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

        {/* Gallery Tab */}
        {activeTab === 'history' && (
          <div className="space-y-4">
            <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/20 p-6">
              <h3 className="text-lg font-semibold text-[#e5e4e2] mb-4">
                Historia odbiorów i zdań pojazdu
              </h3>

              {handoverHistory.length === 0 ? (
                <div className="text-center py-12">
                  <Clock className="w-12 h-12 text-[#e5e4e2]/20 mx-auto mb-3" />
                  <p className="text-[#e5e4e2]/60">Brak historii użytkowania pojazdu</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {handoverHistory.map((handover) => (
                    <div
                      key={handover.id}
                      className="bg-[#0f1119] rounded-lg p-4 border border-[#d3bb73]/10"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <span
                              className={`px-2 py-1 rounded text-xs font-medium ${
                                handover.handover_type === 'pickup'
                                  ? 'bg-blue-500/20 text-blue-400'
                                  : 'bg-green-500/20 text-green-400'
                              }`}
                            >
                              {handover.handover_type === 'pickup' ? 'Odbiór' : 'Zdanie'}
                            </span>
                            <span className="text-[#e5e4e2] font-medium">
                              {handover.odometer_reading.toLocaleString('pl-PL')} km
                            </span>
                          </div>

                          <div className="space-y-1 text-sm">
                            <div className="flex items-center gap-2 text-[#e5e4e2]/80">
                              <User className="w-4 h-4 text-[#d3bb73]" />
                              <span>{handover.driver_name}</span>
                            </div>

                            <div className="flex items-center gap-2 text-[#e5e4e2]/80">
                              <Calendar className="w-4 h-4 text-[#d3bb73]" />
                              <span>{formatDate(handover.timestamp)}</span>
                              <span className="text-[#e5e4e2]/60">
                                {new Date(handover.timestamp).toLocaleTimeString('pl-PL', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                            </div>

                            <div className="flex items-center gap-2 text-[#e5e4e2]/80">
                              <Activity className="w-4 h-4 text-[#d3bb73]" />
                              <span>{handover.event_name}</span>
                            </div>

                            {handover.event_location && (
                              <div className="flex items-center gap-2 text-[#e5e4e2]/60">
                                <MapPin className="w-4 h-4 text-[#d3bb73]/60" />
                                <span>{handover.event_location}</span>
                              </div>
                            )}

                            {handover.notes && (
                              <div className="mt-2 pt-2 border-t border-[#d3bb73]/10">
                                <p className="text-[#e5e4e2]/70 text-sm">{handover.notes}</p>
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
          onSuccess={fetchVehicleData}
        />
      )}

      {showMaintenanceModal && vehicle && (
        <AddMaintenanceModal
          vehicleId={vehicleId}
          vehicleName={vehicle.name}
          currentMileage={vehicle.current_mileage}
          onClose={() => setShowMaintenanceModal(false)}
          onSuccess={fetchVehicleData}
        />
      )}

      {showInsuranceModal && vehicle && (
        <AddInsuranceModal
          vehicleId={vehicleId}
          vehicleName={vehicle.name}
          onClose={() => setShowInsuranceModal(false)}
          onSuccess={fetchVehicleData}
        />
      )}
    </div>
  );
}
