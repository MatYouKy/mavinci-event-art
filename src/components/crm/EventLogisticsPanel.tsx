'use client';

import { useState, useEffect } from 'react';
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
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';

interface EventLogisticsProps {
  eventId: string;
  eventLocation: string;
  eventDate: string;
  canManage: boolean;
}

interface EventVehicle {
  id: string;
  vehicle_id: string;
  role: string;
  driver_id: string | null;
  departure_location: string | null;
  departure_time: string | null;
  arrival_time: string | null;
  return_departure_time: string | null;
  return_arrival_time: string | null;
  estimated_distance_km: number | null;
  actual_distance_km: number | null;
  fuel_cost_estimate: number | null;
  toll_cost_estimate: number | null;
  status: string;
  notes: string | null;
  vehicles: {
    name: string;
    registration_number: string;
    fuel_type: string;
  };
  driver: {
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

  const [vehicles, setVehicles] = useState<EventVehicle[]>([]);
  const [timeline, setTimeline] = useState<LogisticsActivity[]>([]);
  const [loadingItems, setLoadingItems] = useState<LoadingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedSection, setExpandedSection] = useState<string>('vehicles');

  const [showVehicleModal, setShowVehicleModal] = useState(false);
  const [showTimelineModal, setShowTimelineModal] = useState(false);
  const [showLoadingModal, setShowLoadingModal] = useState(false);

  useEffect(() => {
    fetchLogisticsData();
  }, [eventId]);

  const fetchLogisticsData = async () => {
    try {
      setLoading(true);

      const [vehiclesRes, timelineRes, loadingRes] = await Promise.all([
        supabase
          .from('event_vehicles')
          .select(`
            *,
            vehicles(name, registration_number, fuel_type),
            driver:employees!event_vehicles_driver_id_fkey(name, surname)
          `)
          .eq('event_id', eventId)
          .order('created_at', { ascending: true }),

        supabase
          .from('event_logistics_timeline')
          .select(`
            *,
            responsible_employee:employees(name, surname)
          `)
          .eq('event_id', eventId)
          .order('sort_order', { ascending: true }),

        supabase
          .from('event_loading_checklist')
          .select(`
            *,
            vehicles(name)
          `)
          .eq('event_id', eventId)
          .order('sort_order', { ascending: true }),
      ]);

      if (vehiclesRes.error) throw vehiclesRes.error;
      if (timelineRes.error) throw timelineRes.error;
      if (loadingRes.error) throw loadingRes.error;

      setVehicles(vehiclesRes.data || []);
      setTimeline(timelineRes.data || []);
      setLoadingItems(loadingRes.data || []);
    } catch (error) {
      console.error('Error fetching logistics:', error);
      showSnackbar('Błąd podczas ładowania danych logistycznych', 'error');
    } finally {
      setLoading(false);
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
    return <span className={`px-2 py-1 rounded text-xs ${item.class}`}>{item.label}</span>;
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

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#d3bb73]"></div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Podsumowanie */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-[#0f1119] rounded-lg border border-[#d3bb73]/10 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-[#e5e4e2]/60">Pojazdy</span>
            <Truck className="w-5 h-5 text-[#d3bb73]" />
          </div>
          <div className="text-2xl font-bold text-[#e5e4e2]">{vehicles.length}</div>
        </div>

        <div className="bg-[#0f1119] rounded-lg border border-[#d3bb73]/10 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-[#e5e4e2]/60">Dystans</span>
            <Navigation className="w-5 h-5 text-[#d3bb73]" />
          </div>
          <div className="text-2xl font-bold text-[#e5e4e2]">
            {calculateTotalDistance().toFixed(0)} km
          </div>
        </div>

        <div className="bg-[#0f1119] rounded-lg border border-[#d3bb73]/10 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-[#e5e4e2]/60">Koszt transportu</span>
            <DollarSign className="w-5 h-5 text-[#d3bb73]" />
          </div>
          <div className="text-2xl font-bold text-[#e5e4e2]">
            {calculateTotalCost().toFixed(0)} zł
          </div>
        </div>

        <div className="bg-[#0f1119] rounded-lg border border-[#d3bb73]/10 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-[#e5e4e2]/60">Zadania</span>
            <Clock className="w-5 h-5 text-[#d3bb73]" />
          </div>
          <div className="text-2xl font-bold text-[#e5e4e2]">{timeline.length}</div>
        </div>
      </div>

      {/* Pojazdy */}
      <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/10 overflow-hidden">
        <button
          onClick={() => toggleSection('vehicles')}
          className="w-full flex items-center justify-between p-4 hover:bg-[#0f1119]/50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <Truck className="w-5 h-5 text-[#d3bb73]" />
            <h3 className="text-lg font-semibold text-[#e5e4e2]">Transport</h3>
            <span className="text-sm text-[#e5e4e2]/60">({vehicles.length})</span>
          </div>
          <div className="flex items-center gap-2">
            {canManage && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowVehicleModal(true);
                }}
                className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-3 py-1.5 rounded-lg hover:bg-[#d3bb73]/90 transition-colors text-sm"
              >
                <Plus className="w-4 h-4" />
                Dodaj pojazd
              </button>
            )}
            {expandedSection === 'vehicles' ? (
              <ChevronUp className="w-5 h-5 text-[#e5e4e2]/60" />
            ) : (
              <ChevronDown className="w-5 h-5 text-[#e5e4e2]/60" />
            )}
          </div>
        </button>

        {expandedSection === 'vehicles' && (
          <div className="border-t border-[#d3bb73]/10">
            {vehicles.length === 0 ? (
              <div className="p-8 text-center">
                <Truck className="w-12 h-12 text-[#e5e4e2]/20 mx-auto mb-3" />
                <p className="text-[#e5e4e2]/60">Brak przypisanych pojazdów</p>
              </div>
            ) : (
              <div className="divide-y divide-[#d3bb73]/5">
                {vehicles.map((vehicle) => (
                  <div key={vehicle.id} className="p-4 hover:bg-[#0f1119]/30">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h4 className="font-semibold text-[#e5e4e2]">
                            {vehicle.vehicles.name}
                          </h4>
                          <span className="text-sm text-[#e5e4e2]/60">
                            {vehicle.vehicles.registration_number}
                          </span>
                          {getStatusBadge(vehicle.status)}
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
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
                            <span className="text-[#e5e4e2]/60">Dystans:</span>
                            <p className="text-[#e5e4e2]">
                              {vehicle.estimated_distance_km || 0} km
                            </p>
                          </div>
                          <div>
                            <span className="text-[#e5e4e2]/60">Koszt szac.:</span>
                            <p className="text-[#e5e4e2]">
                              {((vehicle.fuel_cost_estimate || 0) +
                                (vehicle.toll_cost_estimate || 0)).toFixed(0)}{' '}
                              zł
                            </p>
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

      {/* Harmonogram */}
      <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/10 overflow-hidden">
        <button
          onClick={() => toggleSection('timeline')}
          className="w-full flex items-center justify-between p-4 hover:bg-[#0f1119]/50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <Clock className="w-5 h-5 text-[#d3bb73]" />
            <h3 className="text-lg font-semibold text-[#e5e4e2]">
              Harmonogram logistyczny
            </h3>
            <span className="text-sm text-[#e5e4e2]/60">({timeline.length})</span>
          </div>
          <div className="flex items-center gap-2">
            {canManage && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowTimelineModal(true);
                }}
                className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-3 py-1.5 rounded-lg hover:bg-[#d3bb73]/90 transition-colors text-sm"
              >
                <Plus className="w-4 h-4" />
                Dodaj zadanie
              </button>
            )}
            {expandedSection === 'timeline' ? (
              <ChevronUp className="w-5 h-5 text-[#e5e4e2]/60" />
            ) : (
              <ChevronDown className="w-5 h-5 text-[#e5e4e2]/60" />
            )}
          </div>
        </button>

        {expandedSection === 'timeline' && (
          <div className="border-t border-[#d3bb73]/10">
            {timeline.length === 0 ? (
              <div className="p-8 text-center">
                <Clock className="w-12 h-12 text-[#e5e4e2]/20 mx-auto mb-3" />
                <p className="text-[#e5e4e2]/60">Brak zadań w harmonogramie</p>
              </div>
            ) : (
              <div className="divide-y divide-[#d3bb73]/5">
                {timeline.map((activity) => (
                  <div key={activity.id} className="p-4 hover:bg-[#0f1119]/30">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <span
                            className={`px-2 py-1 rounded text-xs ${getActivityTypeColor(
                              activity.activity_type
                            )}`}
                          >
                            {getActivityTypeLabel(activity.activity_type)}
                          </span>
                          <h4 className="font-semibold text-[#e5e4e2]">{activity.title}</h4>
                          {getStatusBadge(activity.status)}
                        </div>
                        {activity.description && (
                          <p className="text-sm text-[#e5e4e2]/60 mb-2">
                            {activity.description}
                          </p>
                        )}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
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
                              <p className="text-[#e5e4e2]">
                                {activity.duration_minutes} min
                              </p>
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
                            <p className="text-[#e5e4e2]">
                              {activity.required_crew_count} os.
                            </p>
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

      {/* Lista załadunkowa */}
      <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/10 overflow-hidden">
        <button
          onClick={() => toggleSection('loading')}
          className="w-full flex items-center justify-between p-4 hover:bg-[#0f1119]/50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <Package className="w-5 h-5 text-[#d3bb73]" />
            <h3 className="text-lg font-semibold text-[#e5e4e2]">
              Lista załadunkowa
            </h3>
            <span className="text-sm text-[#e5e4e2]/60">({loadingItems.length})</span>
          </div>
          <div className="flex items-center gap-2">
            {canManage && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowLoadingModal(true);
                }}
                className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-3 py-1.5 rounded-lg hover:bg-[#d3bb73]/90 transition-colors text-sm"
              >
                <Plus className="w-4 h-4" />
                Dodaj pozycję
              </button>
            )}
            {expandedSection === 'loading' ? (
              <ChevronUp className="w-5 h-5 text-[#e5e4e2]/60" />
            ) : (
              <ChevronDown className="w-5 h-5 text-[#e5e4e2]/60" />
            )}
          </div>
        </button>

        {expandedSection === 'loading' && (
          <div className="border-t border-[#d3bb73]/10">
            {loadingItems.length === 0 ? (
              <div className="p-8 text-center">
                <Package className="w-12 h-12 text-[#e5e4e2]/20 mx-auto mb-3" />
                <p className="text-[#e5e4e2]/60">Brak pozycji na liście załadunkowej</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-[#0f1119] border-b border-[#d3bb73]/10">
                    <tr>
                      <th className="text-left p-3 text-sm font-medium text-[#e5e4e2]/60">
                        Pozycja
                      </th>
                      <th className="text-left p-3 text-sm font-medium text-[#e5e4e2]/60">
                        Ilość
                      </th>
                      <th className="text-left p-3 text-sm font-medium text-[#e5e4e2]/60">
                        Waga
                      </th>
                      <th className="text-left p-3 text-sm font-medium text-[#e5e4e2]/60">
                        Pojazd
                      </th>
                      <th className="text-center p-3 text-sm font-medium text-[#e5e4e2]/60">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {loadingItems.map((item) => (
                      <tr
                        key={item.id}
                        className="border-b border-[#d3bb73]/5 hover:bg-[#0f1119]/30"
                      >
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            {item.fragile && (
                              <AlertCircle className="w-4 h-4 text-orange-400" />
                            )}
                            <span className="text-[#e5e4e2]">{item.item_name}</span>
                          </div>
                        </td>
                        <td className="p-3 text-[#e5e4e2]">{item.quantity}</td>
                        <td className="p-3 text-[#e5e4e2]">
                          {item.weight_kg ? `${item.weight_kg} kg` : '-'}
                        </td>
                        <td className="p-3 text-[#e5e4e2]">
                          {item.vehicles?.name || '-'}
                        </td>
                        <td className="p-3">
                          <div className="flex items-center justify-center gap-2">
                            {item.loaded ? (
                              <CheckCircle className="w-5 h-5 text-green-400" />
                            ) : (
                              <div className="w-5 h-5 rounded-full border-2 border-[#e5e4e2]/20" />
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
