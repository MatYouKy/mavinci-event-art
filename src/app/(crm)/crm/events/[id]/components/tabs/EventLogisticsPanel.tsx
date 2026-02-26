'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Truck,
  MapPin,
  Clock,
  Plus,
  Edit,
  Trash2,
  Calendar,
  User,
  Package,
  CheckCircle,
  AlertCircle,
  Navigation,
  Fuel,
  DollarSign,
  Users,
  ChevronDown,
  ChevronUp,
  X,
  Gauge,
  TruckIcon,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import AddEventVehicleModal from '../../../../../../../components/crm/AddEventVehicleModal';
import VehicleHandoverModal from '../../../../../../../components/crm/VehicleHandoverModal';
import Popover from '@/components/UI/Tooltip';
import { useEventLogisticsLazy } from '../../../hooks/useEventVehicles';

interface EventLogisticsProps {
  eventId: string;
  eventLocation: string;
  eventDate: string;
  canManage: boolean;
}

interface EventVehicle {
  id: string;
  vehicle_id: string | null;
  role: string;
  driver_id: string | null;
  is_external: boolean;
  external_company_name: string | null;
  external_rental_cost: number | null;
  departure_location: string | null;
  departure_time: string | null;
  arrival_time: string | null;
  return_departure_time: string | null;
  return_arrival_time: string | null;
  estimated_distance_km: number | null;
  actual_distance_km: number | null;
  fuel_cost_estimate: number | null;
  toll_cost_estimate: number | null;
  loading_time_minutes: number;
  preparation_time_minutes: number;
  travel_time_minutes: number;
  status: string;
  notes: string | null;
  conflicts_count?: number;
  has_trailer: boolean;
  trailer_vehicle_id: string | null;
  is_trailer_external: boolean;
  external_trailer_name: string | null;
  external_trailer_company: string | null;
  external_trailer_rental_cost: number | null;
  pickup_odometer: number | null;
  pickup_timestamp: string | null;
  return_odometer: number | null;
  return_timestamp: string | null;
  return_notes: string | null;
  is_in_use: boolean;
  invitation_status: string;
  invited_at: string | null;
  responded_at: string | null;
  external_trailer_return_date: string | null;
  external_trailer_return_location: string | null;
  external_trailer_notes: string | null;
  vehicles: {
    name: string;
    registration_number: string;
    fuel_type: string;
  } | null;
  trailer: {
    name: string;
    registration_number: string;
    fuel_type: string;
  } | null;
  driver: {
    id: string;
    name: string;
    surname: string;
  } | null;
}

interface LogisticsActivity {
  id: string;
  activity_type: string;
  title: string;
  description: string | null;
  location: string | null;
  start_time: string | null;
  end_time: string | null;
  duration_minutes: number | null;
  responsible_employee_id: string | null;
  required_crew_count: number;
  status: string;
  sort_order: number;
  responsible_employee: {
    name: string;
    surname: string;
  } | null;
}

interface LoadingItem {
  id: string;
  checklist_type: string;
  item_name: string;
  quantity: number;
  weight_kg: number | null;
  fragile: boolean;
  priority: string;
  loaded: boolean;
  unloaded: boolean;
  vehicle_id: string | null;
  vehicles: {
    name: string;
  } | null;
}

export default function EventLogisticsPanel({
  eventId,
  eventLocation,
  eventDate,
  canManage,
}: EventLogisticsProps) {
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const { employee } = useCurrentEmployee();

  const [loading, setLoading] = useState(true);
  const [expandedSection, setExpandedSection] = useState<string>('vehicles');

  const [showVehicleModal, setShowVehicleModal] = useState(false);
  const [editingVehicleId, setEditingVehicleId] = useState<string | null>(null);
  const [showTimelineModal, setShowTimelineModal] = useState(false);
  const [showLoadingModal, setShowLoadingModal] = useState(false);
  const [showHandoverModal, setShowHandoverModal] = useState(false);
  const [selectedVehicleForHandover, setSelectedVehicleForHandover] = useState<EventVehicle | null>(
    null,
  );

  const { fetchLogistics, data, isLoading, isFetching, error } = useEventLogisticsLazy();

  const fetchLogisticsRef = useRef(fetchLogistics);

  useEffect(() => {
    fetchLogisticsRef.current = fetchLogistics;
  }, [fetchLogistics]);

  const vehicles = data?.vehicles ?? ([] as EventVehicle[]);
  const timeline = data?.timeline ?? ([] as LogisticsActivity[]);
  const loadingItems = data?.loadingItems ?? ([] as LoadingItem[]);

  useEffect(() => {
    if (!eventId) return;

    const args = { eventId, canManage, employeeId: employee?.id ?? null };

    fetchLogisticsRef.current(args);

    const channel = supabase
      .channel(`event_vehicles_changes_${eventId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'event_vehicles', filter: `event_id=eq.${eventId}` },
        () => {
          console.log('event_vehicles changed - refreshing logistics');
          fetchLogisticsRef.current(args);
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'event_phases', filter: `event_id=eq.${eventId}` },
        () => {
          console.log('event_phases changed - refreshing logistics');
          fetchLogisticsRef.current(args);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [eventId, canManage, employee?.id]); // <-- bez fetchLogistics

  const handleDeleteVehicle = async (vehicleId: string) => {
    const confirmed = await showConfirm({
      title: 'Usuń pojazd',
      message: 'Czy na pewno chcesz usunąć ten pojazd z wydarzenia?',
    });

    if (!confirmed) return;

    try {
      const { error } = await supabase.from('event_vehicles').delete().eq('id', vehicleId);

      if (error) throw error;

      showSnackbar('Pojazd został usunięty', 'success');
      fetchLogistics({ eventId, canManage, employeeId: employee?.id ?? null });
    } catch (error: any) {
      console.error('Error deleting vehicle:', error);
      showSnackbar(error.message || 'Błąd podczas usuwania pojazdu', 'error');
    }
  };

  const getActivityTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      loading: 'Załadunek',
      unloading: 'Rozładunek',
      setup: 'Montaż/Setup',
      rehearsal: 'Próba',
      event: 'Wydarzenie',
      breakdown: 'Demontaż',
      packing: 'Pakowanie',
    };
    return labels[type] || type;
  };

  const getActivityTypeColor = (type: string) => {
    const colors: Record<string, string> = {
      loading: 'bg-blue-500/20 text-blue-400',
      unloading: 'bg-purple-500/20 text-purple-400',
      setup: 'bg-green-500/20 text-green-400',
      rehearsal: 'bg-yellow-500/20 text-yellow-400',
      event: 'bg-red-500/20 text-red-400',
      breakdown: 'bg-orange-500/20 text-orange-400',
      packing: 'bg-cyan-500/20 text-cyan-400',
    };
    return colors[type] || 'bg-gray-500/20 text-gray-400';
  };

  const getStatusBadge = (status: string) => {
    const config: Record<string, { label: string; class: string }> = {
      planned: { label: 'Planowane', class: 'bg-blue-500/20 text-blue-400' },
      in_transit: { label: 'W drodze', class: 'bg-yellow-500/20 text-yellow-400' },
      arrived: { label: 'Dotarło', class: 'bg-green-500/20 text-green-400' },
      returning: { label: 'Powrót', class: 'bg-orange-500/20 text-orange-400' },
      completed: { label: 'Zakończone', class: 'bg-green-500/20 text-green-400' },
      pending: { label: 'Oczekuje', class: 'bg-gray-500/20 text-gray-400' },
      in_progress: { label: 'W trakcie', class: 'bg-yellow-500/20 text-yellow-400' },
      delayed: { label: 'Opóźnione', class: 'bg-red-500/20 text-red-400' },
      cancelled: { label: 'Anulowane', class: 'bg-red-500/20 text-red-400' },
    };
    const item = config[status] || config.pending;
    return <span className={`rounded px-2 py-1 text-xs ${item.class}`}>{item.label}</span>;
  };

  const calculateTotalCost = () => {
    return vehicles.reduce((sum, v) => {
      return sum + (v.fuel_cost_estimate || 0) + (v.toll_cost_estimate || 0);
    }, 0);
  };

  const calculateTotalDistance = () => {
    return vehicles.reduce((sum, v) => sum + (v.estimated_distance_km || 0), 0);
  };

  const toggleSection = (section: string) => {
    setExpandedSection(expandedSection === section ? '' : section);
  };

  if (isLoading || isFetching) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-[#d3bb73]"></div>
        <div className="text-[#e5e4e2]/60">Ładowanie danych logistycznych...</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Podsumowanie */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <div className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm text-[#e5e4e2]/60">Pojazdy</span>
            <Truck className="h-5 w-5 text-[#d3bb73]" />
          </div>
          <div className="text-2xl font-bold text-[#e5e4e2]">{vehicles.length}</div>
        </div>

        <div className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm text-[#e5e4e2]/60">Dystans</span>
            <Navigation className="h-5 w-5 text-[#d3bb73]" />
          </div>
          <div className="text-2xl font-bold text-[#e5e4e2]">
            {calculateTotalDistance().toFixed(0)} km
          </div>
        </div>

        <div className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm text-[#e5e4e2]/60">Koszt transportu</span>
            <DollarSign className="h-5 w-5 text-[#d3bb73]" />
          </div>
          <div className="text-2xl font-bold text-[#e5e4e2]">
            {calculateTotalCost().toFixed(0)} zł
          </div>
        </div>

        <div className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm text-[#e5e4e2]/60">Zadania</span>
            <Clock className="h-5 w-5 text-[#d3bb73]" />
          </div>
          <div className="text-2xl font-bold text-[#e5e4e2]">{timeline.length}</div>
        </div>
      </div>

      {/* Pojazdy */}
      <div className="overflow-hidden rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33]">
        <div className="flex items-center justify-between p-4">
          <div className="flex flex-1 items-center gap-3">
            <Truck className="h-5 w-5 text-[#d3bb73]" />
            <h3 className="text-lg font-semibold text-[#e5e4e2]">Transport</h3>
            <span className="text-sm text-[#e5e4e2]/60">({vehicles.length})</span>
          </div>
          <div className="flex items-center gap-2">
            {canManage && (
              <button
                onClick={() => setShowVehicleModal(true)}
                className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-3 py-1.5 text-sm text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
              >
                <Plus className="h-4 w-4" />
                Dodaj pojazd
              </button>
            )}
            <button
              onClick={() => toggleSection('vehicles')}
              className="rounded p-1 transition-colors hover:bg-[#0f1119]/50"
            >
              {expandedSection === 'vehicles' ? (
                <ChevronUp className="h-5 w-5 text-[#e5e4e2]/60" />
              ) : (
                <ChevronDown className="h-5 w-5 text-[#e5e4e2]/60" />
              )}
            </button>
          </div>
        </div>

        {expandedSection === 'vehicles' && (
          <div className="border-t border-[#d3bb73]/10">
            {vehicles.length === 0 ? (
              <div className="p-8 text-center">
                <Truck className="mx-auto mb-3 h-12 w-12 text-[#e5e4e2]/20" />
                <p className="text-[#e5e4e2]/60">Brak przypisanych pojazdów</p>
              </div>
            ) : (
              <div className="divide-y divide-[#d3bb73]/5">
                {vehicles.map((vehicle) => {
                  const vehicleName = vehicle.vehicles?.name ?? null;
                  const imageUrl = vehicle.vehicles?.thumb_url ?? null;
                  return (
                    <div key={vehicle.id} className="p-4 hover:bg-[#0f1119]/30">
                      {/* Nagłówek z przyciskami akcji */}
                      <div className="mb-3 flex items-start justify-between">
                        <div className="flex flex-wrap items-center gap-3">
                          {imageUrl ? (
                            <Popover
                              trigger={
                                <img
                                  src={imageUrl}
                                  alt={vehicleName ?? 'Pojazd'}
                                  className="h-10 w-10 rounded border border-[#d3bb73]/20 object-cover"
                                  loading="lazy"
                                />
                              }
                              content={
                                <img
                                  src={imageUrl}
                                  alt={vehicleName ?? 'Pojazd'}
                                  className="h-auto cursor-pointer rounded-lg object-contain transition-all"
                                />
                              }
                              openOn="hover"
                            />
                          ) : (
                            <div className="flex h-10 w-10 items-center justify-center rounded border border-[#d3bb73]/20 bg-[#1c1f33]">
                              <TruckIcon className="h-5 w-5 text-[#e5e4e2]/60" />
                            </div>
                          )}

                          <h4 className="font-semibold text-[#e5e4e2]">
                            {vehicle.is_external
                              ? `${vehicle.external_company_name || 'Zewnętrzny'}`
                              : vehicle.vehicles?.name || 'Brak nazwy'}
                          </h4>
                          {!vehicle.is_external && vehicle.vehicles?.registration_number && (
                            <span className="text-sm text-[#e5e4e2]/60">
                              {vehicle.vehicles.registration_number}
                            </span>
                          )}
                          {vehicle.is_external && (
                            <span className="rounded bg-purple-500/20 px-2 py-1 text-xs text-purple-400">
                              Zewnętrzny
                            </span>
                          )}
                          {vehicle.is_in_use && (
                            <span className="flex items-center gap-1 rounded bg-green-500/20 px-2 py-1 text-xs text-green-400">
                              <CheckCircle className="h-3 w-3" />W użytkowaniu
                            </span>
                          )}
                          {getStatusBadge(vehicle.status)}
                          {vehicle.conflicts_count && vehicle.conflicts_count > 0 && (
                            <span className="flex items-center gap-1 rounded bg-orange-500/20 px-2 py-1 text-xs text-orange-400">
                              <AlertCircle className="h-3 w-3" />
                              Konflikt
                            </span>
                          )}
                        </div>

                        {/* Przyciski akcji */}
                        <div className="flex items-center gap-2">
                          {/* Przycisk odbioru tylko dla kierowcy */}
                          {employee && vehicle.driver_id === employee.id && (
                            <button
                              onClick={() => {
                                setSelectedVehicleForHandover(vehicle);
                                setShowHandoverModal(true);
                              }}
                              className={`flex items-center gap-2 rounded-lg px-4 py-2 font-medium transition-colors ${
                                vehicle.is_in_use
                                  ? 'bg-blue-500/20 text-blue-400 hover:bg-blue-500/30'
                                  : 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                              } `}
                              title={vehicle.is_in_use ? 'Zdaj pojazd' : 'Odbierz pojazd'}
                            >
                              <Gauge className="h-5 w-5" />
                              {vehicle.is_in_use ? 'Zdaj pojazd' : 'Odbierz pojazd'}
                            </button>
                          )}

                          {/* Przyciski zarządzania tylko dla managerów */}
                          {canManage && (
                            <>
                              <button
                                onClick={() => {
                                  setEditingVehicleId(vehicle.id);
                                  setShowVehicleModal(true);
                                }}
                                className="rounded p-1.5 transition-colors hover:bg-blue-500/20"
                                title="Edytuj pojazd"
                              >
                                <Edit className="h-4 w-4 text-blue-400" />
                              </button>
                              <button
                                onClick={() => handleDeleteVehicle(vehicle.id)}
                                className="rounded p-1.5 transition-colors hover:bg-red-500/20"
                                title="Usuń pojazd"
                              >
                                <Trash2 className="h-4 w-4 text-red-400" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Szczegóły pojazdu */}
                      <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-5">
                        <div>
                          <span className="text-[#e5e4e2]/60">Rola:</span>
                          <p className="text-[#e5e4e2]">
                            {vehicle.role === 'transport_equipment'
                              ? 'Transport sprzętu'
                              : vehicle.role === 'transport_crew'
                                ? 'Transport ekipy'
                                : 'Wsparcie'}
                          </p>
                        </div>
                        {vehicle.driver && (
                          <div>
                            <span className="text-[#e5e4e2]/60">Kierowca:</span>
                            <p className="text-[#e5e4e2]">
                              {vehicle.driver.name} {vehicle.driver.surname}
                            </p>
                          </div>
                        )}
                        <div>
                          <span className="text-[#e5e4e2]/60">Wyjazd:</span>
                          <p className="text-[#e5e4e2]">
                            {vehicle.departure_time
                              ? new Date(vehicle.departure_time).toLocaleTimeString('pl-PL', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })
                              : '-'}
                          </p>
                        </div>
                        <div>
                          <span className="text-[#e5e4e2]/60">Dystans:</span>
                          <p className="text-[#e5e4e2]">{vehicle.estimated_distance_km || 0} km</p>
                        </div>
                        <div>
                          <span className="text-[#e5e4e2]/60">Koszt szac.:</span>
                          <p className="text-[#e5e4e2]">
                            {(
                              (vehicle.fuel_cost_estimate || 0) +
                              (vehicle.toll_cost_estimate || 0) +
                              (vehicle.external_rental_cost || 0) +
                              (vehicle.external_trailer_rental_cost || 0)
                            ).toFixed(0)}{' '}
                            zł
                          </p>
                        </div>
                      </div>

                      {vehicle.has_trailer && (
                        <div className="mt-3 border-t border-[#d3bb73]/10 pt-3">
                          <div className="mb-2 flex items-center gap-2">
                            <Package className="h-4 w-4 text-[#d3bb73]" />
                            <span className="text-sm font-medium text-[#d3bb73]">Przyczepka</span>
                          </div>
                          <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                            {vehicle.is_trailer_external ? (
                              <>
                                <div>
                                  <span className="text-[#e5e4e2]/60">Nazwa:</span>
                                  <p className="text-[#e5e4e2]">
                                    {vehicle.external_trailer_name || '-'}
                                  </p>
                                </div>
                                <div>
                                  <span className="text-[#e5e4e2]/60">Firma:</span>
                                  <p className="text-[#e5e4e2]">
                                    {vehicle.external_trailer_company || '-'}
                                  </p>
                                </div>
                                <div>
                                  <span className="text-[#e5e4e2]/60">Koszt wynajmu:</span>
                                  <p className="text-[#e5e4e2]">
                                    {vehicle.external_trailer_rental_cost?.toFixed(0) || 0} zł
                                  </p>
                                </div>
                                <div>
                                  <span className="text-[#e5e4e2]/60">Miejsce zwrotu:</span>
                                  <p className="text-[#e5e4e2]">
                                    {vehicle.external_trailer_return_location || '-'}
                                  </p>
                                </div>
                              </>
                            ) : (
                              <>
                                <div>
                                  <span className="text-[#e5e4e2]/60">Nazwa:</span>
                                  <p className="text-[#e5e4e2]">{vehicle.trailer?.name || '-'}</p>
                                </div>
                                <div>
                                  <span className="text-[#e5e4e2]/60">Rejestracja:</span>
                                  <p className="text-[#e5e4e2]">
                                    {vehicle.trailer?.registration_number || '-'}
                                  </p>
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Harmonogram */}
      <div className="overflow-hidden rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33]">
        <div
          onClick={() => toggleSection('timeline')}
          className="flex w-full items-center justify-between p-4 transition-colors hover:bg-[#0f1119]/50"
        >
          <div className="flex items-center gap-3">
            <Clock className="h-5 w-5 text-[#d3bb73]" />
            <h3 className="text-lg font-semibold text-[#e5e4e2]">Harmonogram logistyczny</h3>
            <span className="text-sm text-[#e5e4e2]/60">({timeline.length})</span>
          </div>
          <div className="flex items-center gap-2">
            {canManage && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowTimelineModal(true);
                }}
                className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-3 py-1.5 text-sm text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
              >
                <Plus className="h-4 w-4" />
                Dodaj zadanie
              </button>
            )}
            {expandedSection === 'timeline' ? (
              <ChevronUp className="h-5 w-5 text-[#e5e4e2]/60" />
            ) : (
              <ChevronDown className="h-5 w-5 text-[#e5e4e2]/60" />
            )}
          </div>
        </div>

        {expandedSection === 'timeline' && (
          <div className="border-t border-[#d3bb73]/10">
            {timeline.length === 0 ? (
              <div className="p-8 text-center">
                <Clock className="mx-auto mb-3 h-12 w-12 text-[#e5e4e2]/20" />
                <p className="text-[#e5e4e2]/60">Brak zadań w harmonogramie</p>
              </div>
            ) : (
              <div className="divide-y divide-[#d3bb73]/5">
                {timeline.map((activity) => (
                  <div key={activity.id} className="p-4 hover:bg-[#0f1119]/30">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="mb-2 flex items-center gap-3">
                          <span
                            className={`rounded px-2 py-1 text-xs ${getActivityTypeColor(
                              activity.activity_type,
                            )}`}
                          >
                            {getActivityTypeLabel(activity.activity_type)}
                          </span>
                          <h4 className="font-semibold text-[#e5e4e2]">{activity.title}</h4>
                          {getStatusBadge(activity.status)}
                        </div>
                        {activity.description && (
                          <p className="mb-2 text-sm text-[#e5e4e2]/60">{activity.description}</p>
                        )}
                        <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                          {activity.start_time && (
                            <div>
                              <span className="text-[#e5e4e2]/60">Start:</span>
                              <p className="text-[#e5e4e2]">
                                {new Date(activity.start_time).toLocaleString('pl-PL', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </p>
                            </div>
                          )}
                          {activity.duration_minutes && (
                            <div>
                              <span className="text-[#e5e4e2]/60">Czas:</span>
                              <p className="text-[#e5e4e2]">{activity.duration_minutes} min</p>
                            </div>
                          )}
                          {activity.responsible_employee && (
                            <div>
                              <span className="text-[#e5e4e2]/60">Odpowiedzialny:</span>
                              <p className="text-[#e5e4e2]">
                                {activity.responsible_employee.name}{' '}
                                {activity.responsible_employee.surname}
                              </p>
                            </div>
                          )}
                          <div>
                            <span className="text-[#e5e4e2]/60">Ekipa:</span>
                            <p className="text-[#e5e4e2]">{activity.required_crew_count} os.</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal dodawania pojazdu */}
      {showVehicleModal && (
        <AddEventVehicleModal
          eventId={eventId}
          eventDate={eventDate}
          eventLocation={eventLocation}
          existingVehicleIds={vehicles.map((v) => v.vehicle_id).filter(Boolean) as string[]}
          editingVehicleId={editingVehicleId || undefined}
          onClose={() => {
            setShowVehicleModal(false);
            setEditingVehicleId(null);
          }}
          onSuccess={() => {
            fetchLogistics({ eventId, canManage, employeeId: employee?.id ?? null });
            setEditingVehicleId(null);
          }}
        />
      )}

      {/* Modal odbioru/zdania pojazdu */}
      {showHandoverModal && selectedVehicleForHandover && (
        <VehicleHandoverModal
          vehicle={selectedVehicleForHandover}
          onClose={() => {
            setShowHandoverModal(false);
            setSelectedVehicleForHandover(null);
          }}
          onSuccess={() => {
            fetchLogistics({ eventId, canManage, employeeId: employee?.id ?? null });
            setShowHandoverModal(false);
            setSelectedVehicleForHandover(null);
          }}
        />
      )}
    </div>
  );
}
