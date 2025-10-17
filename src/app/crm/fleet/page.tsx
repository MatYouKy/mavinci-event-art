'use client';

import { useState, useEffect } from 'react';
import {
  Car,
  Plus,
  Search,
  Filter,
  Calendar,
  Fuel,
  Wrench,
  FileText,
  AlertTriangle,
  TrendingUp,
  Users,
  MapPin,
  Edit,
  Trash2,
  Eye,
  Shield,
  DollarSign,
  Activity,
  Gauge,
  Clock,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { useRouter } from 'next/navigation';

interface Vehicle {
  id: string;
  name: string;
  brand: string;
  model: string;
  registration_number: string;
  vin: string;
  year: number;
  status: string;
  ownership_type: string;
  category: string;
  current_mileage: number;
  fuel_type: string;
  primary_image_url: string | null;
  assigned_to: string | null;
  assigned_employee_name: string | null;
  assigned_employee_surname: string | null;
  upcoming_services: number;
  expiring_insurance: number;
  yearly_maintenance_cost: number;
  yearly_fuel_cost: number;
  avg_fuel_consumption_3months: number;
}

export default function FleetPage() {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const { canCreateInModule, canManageModule } = useCurrentEmployee();

  const canManage = canManageModule('fleet');
  const canCreate = canCreateInModule('fleet');

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [filteredVehicles, setFilteredVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');

  // Statystyki
  const [stats, setStats] = useState({
    total: 0,
    active: 0,
    in_service: 0,
    totalCost: 0,
    averageMileage: 0,
  });

  useEffect(() => {
    fetchVehicles();
  }, []);

  useEffect(() => {
    filterVehicles();
  }, [vehicles, searchTerm, statusFilter, categoryFilter]);

  const fetchVehicles = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('fleet_overview')
        .select('*')
        .order('name', { ascending: true });

      if (error) throw error;

      setVehicles(data || []);
      calculateStats(data || []);
    } catch (error) {
      console.error('Error fetching vehicles:', error);
      showSnackbar('Błąd podczas ładowania pojazdów', 'error');
    } finally {
      setLoading(false);
    }
  };

  const calculateStats = (data: Vehicle[]) => {
    const total = data.length;
    const active = data.filter((v) => v.status === 'active').length;
    const in_service = data.filter((v) => v.status === 'in_service').length;
    const totalCost = data.reduce(
      (sum, v) => sum + (v.yearly_maintenance_cost || 0) + (v.yearly_fuel_cost || 0),
      0
    );
    const averageMileage =
      data.reduce((sum, v) => sum + (v.current_mileage || 0), 0) / Math.max(total, 1);

    setStats({
      total,
      active,
      in_service,
      totalCost,
      averageMileage: Math.round(averageMileage),
    });
  };

  const filterVehicles = () => {
    let filtered = [...vehicles];

    // Filtr wyszukiwania
    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      filtered = filtered.filter(
        (v) =>
          v.name?.toLowerCase().includes(search) ||
          v.brand?.toLowerCase().includes(search) ||
          v.model?.toLowerCase().includes(search) ||
          v.registration_number?.toLowerCase().includes(search) ||
          v.vin?.toLowerCase().includes(search)
      );
    }

    // Filtr statusu
    if (statusFilter !== 'all') {
      filtered = filtered.filter((v) => v.status === statusFilter);
    }

    // Filtr kategorii
    if (categoryFilter !== 'all') {
      filtered = filtered.filter((v) => v.category === categoryFilter);
    }

    setFilteredVehicles(filtered);
  };

  const handleDeleteVehicle = async (id: string, name: string) => {
    const confirmed = await showConfirm(
      'Czy na pewno chcesz usunąć pojazd?',
      `Pojazd "${name}" zostanie trwale usunięty wraz z całą historią.`
    );

    if (!confirmed) return;

    try {
      const { error } = await supabase.from('vehicles').delete().eq('id', id);

      if (error) throw error;

      showSnackbar('Pojazd został usunięty', 'success');
      fetchVehicles();
    } catch (error) {
      console.error('Error deleting vehicle:', error);
      showSnackbar('Błąd podczas usuwania pojazdu', 'error');
    }
  };

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      active: { label: 'Aktywny', class: 'bg-green-500/20 text-green-400' },
      inactive: { label: 'Nieaktywny', class: 'bg-gray-500/20 text-gray-400' },
      in_service: { label: 'W serwisie', class: 'bg-orange-500/20 text-orange-400' },
      sold: { label: 'Sprzedany', class: 'bg-blue-500/20 text-blue-400' },
      scrapped: { label: 'Złomowany', class: 'bg-red-500/20 text-red-400' },
    };

    const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.inactive;
    return <span className={`px-2 py-1 rounded text-xs ${config.class}`}>{config.label}</span>;
  };

  const getCategoryIcon = (category: string) => {
    const icons = {
      personal_car: <Car className="w-5 h-5" />,
      van: <Car className="w-5 h-5" />,
      truck: <Car className="w-5 h-5" />,
      bus: <Car className="w-5 h-5" />,
      motorcycle: <Car className="w-5 h-5" />,
      trailer: <Car className="w-5 h-5" />,
    };
    return icons[category as keyof typeof icons] || <Car className="w-5 h-5" />;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#d3bb73]"></div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[#e5e4e2] flex items-center gap-3">
            <Car className="w-8 h-8 text-[#d3bb73]" />
            Flota Pojazdów
          </h1>
          <p className="text-[#e5e4e2]/60 mt-1">
            Zarządzaj pojazdami firmowymi, tankowaniami, przeglądami i ubezpieczeniami
          </p>
        </div>
        {canCreate && (
          <button
            onClick={() => router.push('/crm/fleet/new')}
            className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-6 py-3 rounded-lg hover:bg-[#d3bb73]/90 transition-colors font-medium"
          >
            <Plus className="w-5 h-5" />
            Dodaj pojazd
          </button>
        )}
      </div>

      {/* Statystyki */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/10 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-[#e5e4e2]/60">Wszystkie pojazdy</span>
            <Car className="w-5 h-5 text-[#d3bb73]" />
          </div>
          <div className="text-2xl font-bold text-[#e5e4e2]">{stats.total}</div>
        </div>

        <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/10 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-[#e5e4e2]/60">Aktywne</span>
            <CheckCircle className="w-5 h-5 text-green-400" />
          </div>
          <div className="text-2xl font-bold text-[#e5e4e2]">{stats.active}</div>
        </div>

        <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/10 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-[#e5e4e2]/60">W serwisie</span>
            <Wrench className="w-5 h-5 text-orange-400" />
          </div>
          <div className="text-2xl font-bold text-[#e5e4e2]">{stats.in_service}</div>
        </div>

        <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/10 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-[#e5e4e2]/60">Koszty roczne</span>
            <DollarSign className="w-5 h-5 text-[#d3bb73]" />
          </div>
          <div className="text-2xl font-bold text-[#e5e4e2]">
            {(stats.totalCost / 1000).toFixed(1)}k zł
          </div>
        </div>

        <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/10 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-[#e5e4e2]/60">Śr. przebieg</span>
            <Gauge className="w-5 h-5 text-[#d3bb73]" />
          </div>
          <div className="text-2xl font-bold text-[#e5e4e2]">
            {stats.averageMileage.toLocaleString()} km
          </div>
        </div>
      </div>

      {/* Filtry i wyszukiwanie */}
      <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/10 p-4">
        <div className="flex flex-col md:flex-row gap-4">
          {/* Wyszukiwarka */}
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-[#e5e4e2]/40" />
              <input
                type="text"
                placeholder="Szukaj po nazwie, marce, modelu, rejestracji lub VIN..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg pl-10 pr-4 py-2 text-[#e5e4e2] placeholder:text-[#e5e4e2]/40 focus:outline-none focus:border-[#d3bb73]/50"
              />
            </div>
          </div>

          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
          >
            <option value="all">Wszystkie statusy</option>
            <option value="active">Aktywny</option>
            <option value="inactive">Nieaktywny</option>
            <option value="in_service">W serwisie</option>
            <option value="sold">Sprzedany</option>
            <option value="scrapped">Złomowany</option>
          </select>

          {/* Category filter */}
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
          >
            <option value="all">Wszystkie kategorie</option>
            <option value="personal_car">Samochód osobowy</option>
            <option value="van">Bus/Van</option>
            <option value="truck">Ciężarówka</option>
            <option value="bus">Autobus</option>
            <option value="motorcycle">Motocykl</option>
            <option value="trailer">Przyczepa</option>
          </select>

          {/* View mode toggle */}
          <div className="flex gap-2">
            <button
              onClick={() => setViewMode('cards')}
              className={`px-4 py-2 rounded-lg transition-colors ${
                viewMode === 'cards'
                  ? 'bg-[#d3bb73] text-[#1c1f33]'
                  : 'bg-[#0f1119] text-[#e5e4e2] hover:bg-[#0f1119]/80'
              }`}
            >
              Karty
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={`px-4 py-2 rounded-lg transition-colors ${
                viewMode === 'table'
                  ? 'bg-[#d3bb73] text-[#1c1f33]'
                  : 'bg-[#0f1119] text-[#e5e4e2] hover:bg-[#0f1119]/80'
              }`}
            >
              Tabela
            </button>
          </div>
        </div>
      </div>

      {/* Lista pojazdów */}
      {filteredVehicles.length === 0 ? (
        <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/10 p-12 text-center">
          <Car className="w-16 h-16 text-[#e5e4e2]/20 mx-auto mb-4" />
          <p className="text-[#e5e4e2]/60 text-lg">
            {searchTerm || statusFilter !== 'all' || categoryFilter !== 'all'
              ? 'Nie znaleziono pojazdów spełniających kryteria'
              : 'Brak pojazdów. Dodaj pierwszy pojazd do floty.'}
          </p>
        </div>
      ) : viewMode === 'cards' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredVehicles.map((vehicle) => (
            <div
              key={vehicle.id}
              className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/10 overflow-hidden hover:border-[#d3bb73]/30 transition-colors"
            >
              {/* Image */}
              <div className="h-48 bg-[#0f1119] flex items-center justify-center relative">
                {vehicle.primary_image_url ? (
                  <img
                    src={vehicle.primary_image_url}
                    alt={vehicle.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <Car className="w-24 h-24 text-[#e5e4e2]/20" />
                )}
                <div className="absolute top-2 right-2">{getStatusBadge(vehicle.status)}</div>
              </div>

              {/* Content */}
              <div className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h3 className="text-lg font-semibold text-[#e5e4e2] mb-1">
                      {vehicle.name}
                    </h3>
                    <p className="text-sm text-[#e5e4e2]/60">
                      {vehicle.brand} {vehicle.model} {vehicle.year && `(${vehicle.year})`}
                    </p>
                  </div>
                  {getCategoryIcon(vehicle.category)}
                </div>

                <div className="space-y-2 mb-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-[#e5e4e2]/60">Rejestracja:</span>
                    <span className="text-[#e5e4e2] font-medium">
                      {vehicle.registration_number || '-'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-[#e5e4e2]/60">Przebieg:</span>
                    <span className="text-[#e5e4e2] font-medium">
                      {vehicle.current_mileage?.toLocaleString() || 0} km
                    </span>
                  </div>
                  {vehicle.assigned_employee_name && (
                    <div className="flex items-center gap-2 text-sm">
                      <Users className="w-4 h-4 text-[#d3bb73]" />
                      <span className="text-[#e5e4e2]/80">
                        {vehicle.assigned_employee_name} {vehicle.assigned_employee_surname}
                      </span>
                    </div>
                  )}
                </div>

                {/* Alerts */}
                {(vehicle.upcoming_services > 0 || vehicle.expiring_insurance > 0) && (
                  <div className="flex gap-2 mb-4">
                    {vehicle.upcoming_services > 0 && (
                      <div className="flex items-center gap-1 text-xs text-orange-400 bg-orange-500/10 px-2 py-1 rounded">
                        <Wrench className="w-3 h-3" />
                        {vehicle.upcoming_services} przegląd
                        {vehicle.upcoming_services > 1 ? 'y' : ''}
                      </div>
                    )}
                    {vehicle.expiring_insurance > 0 && (
                      <div className="flex items-center gap-1 text-xs text-red-400 bg-red-500/10 px-2 py-1 rounded">
                        <Shield className="w-3 h-3" />
                        Ubezp.
                      </div>
                    )}
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2">
                  <button
                    onClick={() => router.push(`/crm/fleet/${vehicle.id}`)}
                    className="flex-1 flex items-center justify-center gap-2 bg-[#d3bb73]/10 text-[#d3bb73] px-4 py-2 rounded-lg hover:bg-[#d3bb73]/20 transition-colors text-sm"
                  >
                    <Eye className="w-4 h-4" />
                    Szczegóły
                  </button>
                  {canManage && (
                    <>
                      <button
                        onClick={() => router.push(`/crm/fleet/${vehicle.id}/edit`)}
                        className="flex items-center justify-center bg-[#0f1119] text-[#e5e4e2] px-3 py-2 rounded-lg hover:bg-[#0f1119]/80 transition-colors"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteVehicle(vehicle.id, vehicle.name)}
                        className="flex items-center justify-center bg-red-500/10 text-red-400 px-3 py-2 rounded-lg hover:bg-red-500/20 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/10 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-[#0f1119] border-b border-[#d3bb73]/10">
                <tr>
                  <th className="text-left p-4 text-sm font-medium text-[#e5e4e2]/60">Pojazd</th>
                  <th className="text-left p-4 text-sm font-medium text-[#e5e4e2]/60">
                    Rejestracja
                  </th>
                  <th className="text-left p-4 text-sm font-medium text-[#e5e4e2]/60">
                    Przebieg
                  </th>
                  <th className="text-left p-4 text-sm font-medium text-[#e5e4e2]/60">
                    Przypisany
                  </th>
                  <th className="text-left p-4 text-sm font-medium text-[#e5e4e2]/60">Status</th>
                  <th className="text-left p-4 text-sm font-medium text-[#e5e4e2]/60">Alerty</th>
                  <th className="text-right p-4 text-sm font-medium text-[#e5e4e2]/60">
                    Akcje
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredVehicles.map((vehicle) => (
                  <tr
                    key={vehicle.id}
                    className="border-b border-[#d3bb73]/5 hover:bg-[#0f1119]/50 transition-colors"
                  >
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        {getCategoryIcon(vehicle.category)}
                        <div>
                          <div className="font-medium text-[#e5e4e2]">{vehicle.name}</div>
                          <div className="text-sm text-[#e5e4e2]/60">
                            {vehicle.brand} {vehicle.model}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="p-4 text-[#e5e4e2]">
                      {vehicle.registration_number || '-'}
                    </td>
                    <td className="p-4 text-[#e5e4e2]">
                      {vehicle.current_mileage?.toLocaleString() || 0} km
                    </td>
                    <td className="p-4 text-[#e5e4e2]/80">
                      {vehicle.assigned_employee_name
                        ? `${vehicle.assigned_employee_name} ${vehicle.assigned_employee_surname}`
                        : '-'}
                    </td>
                    <td className="p-4">{getStatusBadge(vehicle.status)}</td>
                    <td className="p-4">
                      <div className="flex gap-2">
                        {vehicle.upcoming_services > 0 && (
                          <Wrench className="w-4 h-4 text-orange-400" />
                        )}
                        {vehicle.expiring_insurance > 0 && (
                          <Shield className="w-4 h-4 text-red-400" />
                        )}
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => router.push(`/crm/fleet/${vehicle.id}`)}
                          className="p-2 text-[#d3bb73] hover:bg-[#d3bb73]/10 rounded-lg transition-colors"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        {canManage && (
                          <>
                            <button
                              onClick={() => router.push(`/crm/fleet/${vehicle.id}/edit`)}
                              className="p-2 text-[#e5e4e2] hover:bg-[#0f1119] rounded-lg transition-colors"
                            >
                              <Edit className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDeleteVehicle(vehicle.id, vehicle.name)}
                              className="p-2 text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
