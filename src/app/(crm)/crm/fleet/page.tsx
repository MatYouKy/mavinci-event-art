'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  Car,
  Plus,
  Search,
  Fuel,
  Wrench,
  Users,
  Edit,
  Trash2,
  Eye,
  Shield,
  DollarSign,
  Activity,
  Gauge,
  CheckCircle,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { useRouter } from 'next/navigation';
import QuickFuelModal from '@/components/crm/QuickFuelModal';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import Popover from '@/components/UI/Tooltip';
import { ChevronLeft, ChevronRight, LayoutGrid, List } from 'lucide-react';
import { IVehicle } from './types/fleet.types';
import { useAppDispatch } from '@/store/hooks';
import { fleetApi, useDeleteVehicleMutation, useGetFleetVehiclesQuery } from './api/fleetApi';

export default function FleetPage() {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const { canCreateInModule, canManageModule } = useCurrentEmployee();
  const { getViewMode, setViewMode: saveViewMode } = useUserPreferences();
  const [deletingVehicleId, setDeletingVehicleId] = useState<string | null>(null);

  const dispatch = useAppDispatch();

  const {
    data: vehicles = [],
    isLoading,
    refetch,
  } = useGetFleetVehiclesQuery(undefined, {
    refetchOnMountOrArgChange: false, // ✅ nie odświeżaj przy powrocie na stronę
    refetchOnFocus: false,
    refetchOnReconnect: true,
  });

  const [deleteVehicle] = useDeleteVehicleMutation();

  const [quickFuelVehicle, setQuickFuelVehicle] = useState<IVehicle | null>(null);
  const [imageIndexes, setImageIndexes] = useState<Record<string, number>>({});
  const [hoveredVehicleId, setHoveredVehicleId] = useState<string | null>(null);

  const canManage = canManageModule('fleet');
  const canCreate = canCreateInModule('fleet');

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'cards' | 'table'>(
    getViewMode('fleet') === 'grid' ? 'cards' : 'table',
  );

  useEffect(() => {
    const channel = supabase
      .channel('fleet_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_vehicles' }, () => {
        dispatch(fleetApi.util.invalidateTags([{ type: 'Fleet', id: 'LIST' }]));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicle_alerts' }, () => {
        dispatch(fleetApi.util.invalidateTags([{ type: 'Fleet', id: 'LIST' }]));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'insurance_policies' }, () => {
        dispatch(fleetApi.util.invalidateTags([{ type: 'Fleet', id: 'LIST' }]));
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [dispatch]);

  const stats = useMemo(() => {
    const total = vehicles.length;
    const active = vehicles.filter((v) => v.status === 'active').length;
    const in_service = vehicles.filter((v) => v.status === 'in_service').length;

    const totalCost = vehicles.reduce(
      (sum, v) => sum + (v.yearly_maintenance_cost || 0) + (v.yearly_fuel_cost || 0),
      0,
    );

    const averageMileage =
      vehicles.reduce((sum, v) => sum + (v.current_mileage || 0), 0) / Math.max(total, 1);

    return {
      total,
      active,
      in_service,
      totalCost,
      averageMileage: Math.round(averageMileage),
    };
  }, [vehicles]);

  const filteredVehicles = vehicles.filter((v) => {
    const search = searchTerm.trim().toLowerCase();

    const matchesSearch =
      !search ||
      v.name?.toLowerCase().includes(search) ||
      v.brand?.toLowerCase().includes(search) ||
      v.model?.toLowerCase().includes(search) ||
      v.registration_number?.toLowerCase().includes(search) ||
      v.vin?.toLowerCase().includes(search);

    const matchesStatus = statusFilter === 'all' || v.status === statusFilter;
    const matchesCategory = categoryFilter === 'all' || v.category === categoryFilter;

    return matchesSearch && matchesStatus && matchesCategory;
  });

  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const handleDeleteVehicle = async (id: string, name: string) => {
    const confirmed = await showConfirm(
      'Czy na pewno chcesz usunąć pojazd?',
      `Pojazd "${name}" zostanie trwale usunięty wraz z całą historią.`,
    );
    if (!confirmed) return;

    const startedAt = Date.now();
    setDeletingVehicleId(id);

    try {
      await deleteVehicle({ vehicleId: id }).unwrap();

      // wymuś widoczność loadera
      const elapsed = Date.now() - startedAt;
      if (elapsed < 450) await delay(450 - elapsed);

      showSnackbar('Pojazd został usunięty', 'success');

      // ✅ usuń z cache ręcznie (bez “mignięcia” przez refetch)
      dispatch(
        fleetApi.util.updateQueryData('getFleetVehicles', undefined, (draft) => {
          const idx = draft.findIndex((v) => v.id === id);
          if (idx !== -1) draft.splice(idx, 1);
        }),
      );

      // opcjonalnie: jeśli masz mocne “enrichment” po stronie API i chcesz pewność,
      // możesz po chwili zrobić invalidate:
      // setTimeout(() => dispatch(fleetApi.util.invalidateTags([{ type:'Fleet', id:'LIST' }])), 500);
    } catch (e) {
      console.error(e);
      showSnackbar('Błąd podczas usuwania pojazdu', 'error');
    } finally {
      setDeletingVehicleId((curr) => (curr === id ? null : curr));
    }
  };

  const getStatusBadge = (status: string, inUse: boolean = false) => {
    if (inUse) {
      return (
        <span className="inline-flex w-auto items-center gap-1 whitespace-nowrap rounded border border-[#d3bb73]/30 bg-[#d3bb73]/20 px-2 py-1 text-xs text-[#d3bb73]">
          <Activity className="h-3 w-3" />W użytkowaniu
        </span>
      );
    }

    const statusConfig = {
      active: { label: 'Dostępny', class: 'bg-green-500/20 text-green-400' },
      inactive: { label: 'Nieaktywny', class: 'bg-gray-500/20 text-gray-400' },
      in_service: { label: 'W serwisie', class: 'bg-orange-500/20 text-orange-400' },
      sold: { label: 'Sprzedany', class: 'bg-blue-500/20 text-blue-400' },
      scrapped: { label: 'Złomowany', class: 'bg-red-500/20 text-red-400' },
    };

    const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.inactive;
    return (
      <span
        className={`inline-block w-auto whitespace-nowrap rounded px-2 py-1 text-xs ${config.class}`}
      >
        {config.label}
      </span>
    );
  };

  const getCategoryIcon = (category: string) => {
    const icons = {
      personal_car: <Car className="h-5 w-5" />,
      van: <Car className="h-5 w-5" />,
      truck: <Car className="h-5 w-5" />,
      bus: <Car className="h-5 w-5" />,
      motorcycle: <Car className="h-5 w-5" />,
      trailer: <Car className="h-5 w-5" />,
    };
    return icons[category as keyof typeof icons] || <Car className="h-5 w-5" />;
  };

  const renderAvatar = (
    name: string | null,
    surname: string | null,
    avatarUrl: string | null,
    avatarMetadata: any,
    size: number = 28,
  ) => {
    const position = avatarMetadata?.desktop?.position || { posX: 0, posY: 0, scale: 1 };
    const objectFit = avatarMetadata?.desktop?.objectFit || 'cover';
    const initials = name && surname ? `${name[0]}${surname[0]}`.toUpperCase() : '?';

    return (
      <div
        className="relative cursor-pointer overflow-hidden rounded-full border-2 border-[#0f1119] bg-[#1c1f33] transition-colors hover:border-[#d3bb73]/40"
        style={{ width: `${size}px`, height: `${size}px` }}
      >
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={`${name} ${surname}`}
            className="h-full w-full"
            style={{
              objectFit: objectFit as any,
              transform: `translate(${position.posX}%, ${position.posY}%) scale(${position.scale})`,
            }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-[#1c1f33] text-xs font-medium text-[#e5e4e2]/60">
            {initials}
          </div>
        )}
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-[#d3bb73]"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-3 text-3xl font-bold text-[#e5e4e2]">
            <Car className="h-8 w-8 text-[#d3bb73]" />
            Flota Pojazdów
          </h1>
          <p className="mt-1 text-[#e5e4e2]/60">
            Zarządzaj pojazdami firmowymi, tankowaniami, przeglądami i ubezpieczeniami
          </p>
        </div>
        {canCreate && (
          <button
            onClick={() => router.push('/crm/fleet/new')}
            className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-3 font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
          >
            <Plus className="h-5 w-5" />
            Dodaj pojazd
          </button>
        )}
      </div>

      {/* Statystyki */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
        <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm text-[#e5e4e2]/60">Wszystkie pojazdy</span>
            <Car className="h-5 w-5 text-[#d3bb73]" />
          </div>
          <div className="text-2xl font-bold text-[#e5e4e2]">{stats.total}</div>
        </div>

        <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm text-[#e5e4e2]/60">Aktywne</span>
            <CheckCircle className="h-5 w-5 text-green-400" />
          </div>
          <div className="text-2xl font-bold text-[#e5e4e2]">{stats.active}</div>
        </div>

        <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm text-[#e5e4e2]/60">W serwisie</span>
            <Wrench className="h-5 w-5 text-orange-400" />
          </div>
          <div className="text-2xl font-bold text-[#e5e4e2]">{stats.in_service}</div>
        </div>

        <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm text-[#e5e4e2]/60">Koszty roczne</span>
            <DollarSign className="h-5 w-5 text-[#d3bb73]" />
          </div>
          <div className="text-2xl font-bold text-[#e5e4e2]">
            {(stats.totalCost / 1000).toFixed(1)}k zł
          </div>
        </div>

        <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm text-[#e5e4e2]/60">Śr. przebieg</span>
            <Gauge className="h-5 w-5 text-[#d3bb73]" />
          </div>
          <div className="text-2xl font-bold text-[#e5e4e2]">
            {stats.averageMileage.toLocaleString()} km
          </div>
        </div>
      </div>

      {/* Filtry i wyszukiwanie */}
      <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-4">
        <div className="flex flex-col gap-4 md:flex-row">
          {/* Wyszukiwarka */}
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 transform text-[#e5e4e2]/40" />
              <input
                type="text"
                placeholder="Szukaj po nazwie, marce, modelu, rejestracji lub VIN..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] py-2 pl-10 pr-4 text-[#e5e4e2] placeholder:text-[#e5e4e2]/40 focus:border-[#d3bb73]/50 focus:outline-none"
              />
            </div>
          </div>

          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
          >
            <option value="all">Wszystkie statusy</option>
            <option value="active">Dostępny</option>
            <option value="inactive">Nieaktywny</option>
            <option value="in_service">W serwisie</option>
            <option value="sold">Sprzedany</option>
            <option value="scrapped">Złomowany</option>
          </select>

          {/* Category filter */}
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
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
              onClick={() => {
                setViewMode('cards');
                saveViewMode('fleet', 'grid');
              }}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 transition-colors ${
                viewMode === 'cards'
                  ? 'bg-[#d3bb73] text-[#1c1f33]'
                  : 'bg-[#0f1119] text-[#e5e4e2] hover:bg-[#0f1119]/80'
              }`}
            >
              <LayoutGrid className="h-4 w-4" />
              Kafelki
            </button>
            <button
              onClick={() => {
                setViewMode('table');
                saveViewMode('fleet', 'list');
              }}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 transition-colors ${
                viewMode === 'table'
                  ? 'bg-[#d3bb73] text-[#1c1f33]'
                  : 'bg-[#0f1119] text-[#e5e4e2] hover:bg-[#0f1119]/80'
              }`}
            >
              <List className="h-4 w-4" />
              Lista
            </button>
          </div>
        </div>
      </div>

      {/* Lista pojazdów */}
      {filteredVehicles.length === 0 ? (
        <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-12 text-center">
          <Car className="mx-auto mb-4 h-16 w-16 text-[#e5e4e2]/20" />
          <p className="text-lg text-[#e5e4e2]/60">
            {searchTerm || statusFilter !== 'all' || categoryFilter !== 'all'
              ? 'Nie znaleziono pojazdów spełniających kryteria'
              : 'Brak pojazdów. Dodaj pierwszy pojazd do floty.'}
          </p>
        </div>
      ) : viewMode === 'cards' ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredVehicles.map((vehicle) => {
            const isRowDeleting = deletingVehicleId === vehicle.id;
            return (
              <div
                key={vehicle.id}
                className={`overflow-hidden rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] transition-colors hover:border-[#d3bb73]/30 ${
                  isRowDeleting ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
                }`}
              >
                {/* Image Carousel */}
                <div
                  className="group relative flex h-48 cursor-pointer items-center justify-center bg-[#0f1119]"
                  onClick={() => router.push(`/crm/fleet/${vehicle.id}`)}
                >
                  {vehicle.all_images.length > 0 ? (
                    <>
                      <img
                        src={vehicle.all_images[imageIndexes[vehicle.id] || 0]?.image_url}
                        alt={
                          vehicle.all_images[imageIndexes[vehicle.id] || 0]?.title || vehicle.name
                        }
                        className="h-full w-full object-cover"
                      />
                      {vehicle.all_images.length > 1 && (
                        <>
                          {(imageIndexes[vehicle.id] || 0) > 0 && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setImageIndexes((prev) => ({
                                  ...prev,
                                  [vehicle.id]: Math.max(0, (prev[vehicle.id] || 0) - 1),
                                }));
                              }}
                              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white opacity-0 transition-opacity hover:bg-black/70 group-hover:opacity-100"
                            >
                              <ChevronLeft className="h-4 w-4" />
                            </button>
                          )}
                          {(imageIndexes[vehicle.id] || 0) < vehicle.all_images.length - 1 && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setImageIndexes((prev) => ({
                                  ...prev,
                                  [vehicle.id]: Math.min(
                                    vehicle.all_images.length - 1,
                                    (prev[vehicle.id] || 0) + 1,
                                  ),
                                }));
                              }}
                              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white opacity-0 transition-opacity hover:bg-black/70 group-hover:opacity-100"
                            >
                              <ChevronRight className="h-4 w-4" />
                            </button>
                          )}
                          <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1">
                            {vehicle.all_images.map((_, idx) => (
                              <div
                                key={idx}
                                className={`h-1.5 w-1.5 rounded-full ${
                                  idx === (imageIndexes[vehicle.id] || 0)
                                    ? 'bg-white'
                                    : 'bg-white/40'
                                }`}
                              />
                            ))}
                          </div>
                        </>
                      )}
                    </>
                  ) : (
                    <Car className="h-24 w-24 text-[#e5e4e2]/20" />
                  )}
                  <div className="absolute right-2 top-2">
                    {getStatusBadge(vehicle.status, vehicle.in_use)}
                  </div>
                </div>

                {/* Content */}
                <div className="p-4">
                  <div className="mb-2 flex items-start justify-between">
                    <div>
                      <h3 className="mb-1 text-lg font-semibold text-[#e5e4e2]">{vehicle.name}</h3>
                      <p className="text-sm text-[#e5e4e2]/60">
                        {vehicle.brand} {vehicle.model} {vehicle.year && `(${vehicle.year})`}
                      </p>
                    </div>
                    {getCategoryIcon(vehicle.category)}
                  </div>

                  <div className="mb-4 space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-[#e5e4e2]/60">Rejestracja:</span>
                      <span className="font-medium text-[#e5e4e2]">
                        {vehicle.registration_number || '-'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-[#e5e4e2]/60">Przebieg:</span>
                      <span className="font-medium text-[#e5e4e2]">
                        {vehicle.current_mileage?.toLocaleString() || 0} km
                      </span>
                    </div>
                    {vehicle.assigned_employee_name && (
                      <div className="flex items-center gap-2 text-sm">
                        <Users className="h-4 w-4 text-[#d3bb73]" />
                        <span className="text-[#e5e4e2]/80">
                          {vehicle.assigned_employee_name} {vehicle.assigned_employee_surname}
                        </span>
                      </div>
                    )}
                    {vehicle.in_use && vehicle.in_use_by && (
                      <div className="flex items-center gap-2 rounded bg-[#d3bb73]/10 px-2 py-1 text-sm">
                        <Activity className="h-4 w-4 text-[#d3bb73]" />
                        <span className="font-medium text-[#d3bb73]">{vehicle.in_use_by}</span>
                        {vehicle.in_use_event && (
                          <span className="text-xs text-[#e5e4e2]/60">
                            • {vehicle.in_use_event}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Alerts and Status */}
                  {(vehicle.upcoming_services > 0 || vehicle.expiring_insurance > 0) && (
                    <div className="mb-4 flex flex-wrap gap-2">
                      {vehicle.upcoming_services > 0 && (
                        <div className="flex items-center gap-1 rounded bg-orange-500/10 px-2 py-1 text-xs text-orange-400">
                          <Wrench className="h-3 w-3" />
                          {vehicle.upcoming_services} przegląd
                          {vehicle.upcoming_services > 1 ? 'y' : ''}
                        </div>
                      )}
                      {vehicle.expiring_insurance > 0 && (
                        <div className="flex items-center gap-1 rounded bg-red-500/10 px-2 py-1 text-xs text-red-400">
                          <Shield className="h-3 w-3" />
                          Ubezp.
                        </div>
                      )}
                    </div>
                  )}

                  {/* Quick Action: Fuel */}
                  {canManage && (
                    <button
                      onClick={() => setQuickFuelVehicle(vehicle as unknown as IVehicle)}
                      className="mb-2 flex w-full items-center justify-center gap-2 rounded-lg bg-[#d3bb73]/10 px-4 py-2 text-sm text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/20"
                    >
                      <Fuel className="h-4 w-4" />
                      Dodaj tankowanie
                    </button>
                  )}

                  {/* Actions */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => router.push(`/crm/fleet/${vehicle.id}`)}
                      className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#0f1119] px-4 py-2 text-sm text-[#e5e4e2] transition-colors hover:bg-[#0f1119]/80"
                    >
                      <Eye className="h-4 w-4" />
                      Szczegóły
                    </button>
                    {canManage && (
                      <>
                        <button
                          onClick={() => router.push(`/crm/fleet/${vehicle.id}/edit`)}
                          className="flex items-center justify-center rounded-lg bg-[#0f1119] px-3 py-2 text-[#e5e4e2] transition-colors hover:bg-[#0f1119]/80"
                        >
                          <Edit className="h-4 w-4" />
                        </button>

                        <button
                          onClick={() => handleDeleteVehicle(vehicle.id, vehicle.name)}
                          disabled={isRowDeleting}
                          className={`flex items-center justify-center rounded-lg px-3 py-2 transition-colors ${
                            isRowDeleting
                              ? 'cursor-not-allowed bg-red-500/10 text-red-400 opacity-60'
                              : 'bg-red-500/10 text-red-400 hover:bg-red-500/20'
                          }`}
                        >
                          {isRowDeleting ? (
                            <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-red-400" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33]">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-[#d3bb73]/10 bg-[#0f1119]">
                <tr>
                  <th className="p-4 text-left text-sm font-medium text-[#e5e4e2]/60">Pojazd</th>
                  <th className="p-4 text-left text-sm font-medium text-[#e5e4e2]/60">
                    Rejestracja
                  </th>
                  <th className="p-4 text-left text-sm font-medium text-[#e5e4e2]/60">Przebieg</th>
                  <th className="p-4 text-left text-sm font-medium text-[#e5e4e2]/60">
                    Przypisany
                  </th>
                  <th className="p-4 text-left text-sm font-medium text-[#e5e4e2]/60">Status</th>
                  <th className="p-4 text-left text-sm font-medium text-[#e5e4e2]/60">Alerty</th>
                  <th className="p-4 text-right text-sm font-medium text-[#e5e4e2]/60">Akcje</th>
                </tr>
              </thead>
              <tbody>
                {filteredVehicles.map((vehicle) => {
                  const isRowDeleting = deletingVehicleId === vehicle.id;
                  const imageUrl = vehicle?.thumb_url ?? null;
                  return (
                    <tr
                      key={vehicle.id}
                      className={`border-b border-[#d3bb73]/5 transition-colors hover:bg-[#0f1119]/50 ${
                        isRowDeleting ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
                      }`}
                    >
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <div
                            className="relative flex h-16 w-16 flex-shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-lg bg-[#0f1119] transition-all hover:ring-2 hover:ring-[#d3bb73]/50"
                            onClick={() => router.push(`/crm/fleet/${vehicle.id}`)}
                            onMouseEnter={() => setHoveredVehicleId(vehicle.id)}
                            onMouseLeave={() => setHoveredVehicleId(null)}
                          >
                            {imageUrl ? (
                              <Popover
                                trigger={
                                  <img
                                    src={imageUrl}
                                    alt={vehicle.name ?? 'Pojazd'}
                                    className="h-16 w-16 object-cover"
                                    loading="lazy"
                                  />
                                }
                                content={
                                  <img
                                    src={imageUrl}
                                    alt={vehicle.name ?? 'Pojazd'}
                                    className="h-auto cursor-pointer rounded-lg object-contain transition-all"
                                  />
                                }
                                openOn="hover"
                              />
                            ) : (
                              <Car className="h-8 w-8 text-[#e5e4e2]/20" />
                            )}

                            {/* Popover on hover */}
                            {hoveredVehicleId === vehicle.id && vehicle.all_images.length > 0 && (
                              <div className="pointer-events-none absolute left-20 top-0 z-50 w-64 rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] p-2 shadow-2xl">
                                <img
                                  src={vehicle.all_images[0]?.image_url}
                                  alt={vehicle.name}
                                  className="h-48 w-full rounded object-cover"
                                />
                                {vehicle.all_images.length > 1 && (
                                  <div className="mt-2 text-center text-xs text-[#e5e4e2]/60">
                                    +{vehicle.all_images.length - 1} więcej
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                          <div
                            className="cursor-pointer"
                            onClick={() => router.push(`/crm/fleet/${vehicle.id}`)}
                          >
                            <div className="font-medium text-[#e5e4e2]">{vehicle.name}</div>
                            <div className="text-sm text-[#e5e4e2]/60">
                              {vehicle.brand} {vehicle.model}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="p-4 text-[#e5e4e2]">{vehicle.registration_number || '-'}</td>
                      <td className="p-4 text-[#e5e4e2]">
                        {vehicle.current_mileage?.toLocaleString() || 0} km
                      </td>
                      <td className="p-4 text-[#e5e4e2]/80">
                        {vehicle.in_use && vehicle.in_use_driver_id && (
                          <Popover
                            content={
                              <div className="min-w-[200px] items-center justify-center p-3">
                                <div className="flex items-center justify-center">
                                  <div
                                    onClick={() =>
                                      router.push(`/crm/employees/${vehicle.in_use_driver_id}`)
                                    }
                                  >
                                    {renderAvatar(
                                      vehicle.in_use_driver_name,
                                      vehicle.in_use_driver_surname,
                                      vehicle.in_use_driver_avatar_url,
                                      vehicle.in_use_driver_avatar_metadata,
                                      48,
                                    )}
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <button
                                      onClick={() =>
                                        router.push(`/crm/employees/${vehicle.in_use_driver_id}`)
                                      }
                                      className="block w-full truncate text-left text-sm font-medium text-[#e5e4e2] transition-colors hover:text-[#d3bb73]"
                                    >
                                      {vehicle.in_use_driver_name} {vehicle.in_use_driver_surname}
                                    </button>
                                    <div className="mt-1 text-xs text-[#e5e4e2]/60">
                                      Kliknij aby przejść do profilu
                                    </div>
                                  </div>
                                </div>
                              </div>
                            }
                          >
                            {renderAvatar(
                              vehicle.in_use_driver_name,
                              vehicle.in_use_driver_surname,
                              vehicle.in_use_driver_avatar_url,
                              vehicle.in_use_driver_avatar_metadata,
                              28,
                            )}
                            <p className="ml-4 mt-1 text-xs text-[#e5e4e2]/60">
                              {`${vehicle.in_use_driver_name} ${vehicle.in_use_driver_surname}`}{' '}
                            </p>
                          </Popover>
                        )}
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          {getStatusBadge(vehicle.status, vehicle.in_use)}
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="flex gap-2">
                          {vehicle.upcoming_services > 0 && (
                            <Wrench className="h-4 w-4 text-orange-400" />
                          )}
                          {vehicle.expiring_insurance > 0 && (
                            <Shield className="h-4 w-4 text-red-400" />
                          )}
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => router.push(`/crm/fleet/${vehicle.id}`)}
                            className="rounded-lg p-2 text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/10"
                            title="Podgląd"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setQuickFuelVehicle(vehicle as unknown as IVehicle)}
                            className="rounded-lg p-2 text-blue-400 transition-colors hover:bg-blue-500/10"
                            title="Dodaj tankowanie"
                          >
                            <Fuel className="h-4 w-4" />
                          </button>
                          {canManage && (
                            <>
                              <button
                                onClick={() => router.push(`/crm/fleet/${vehicle.id}/edit`)}
                                className="rounded-lg p-2 text-[#e5e4e2] transition-colors hover:bg-[#0f1119]"
                                title="Edytuj"
                              >
                                <Edit className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => handleDeleteVehicle(vehicle.id, vehicle.name)}
                                disabled={isRowDeleting}
                                className="rounded-lg p-2 text-red-400 transition-colors hover:bg-red-500/10"
                                title="Usuń"
                              >
                                {isRowDeleting ? (
                                  <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-red-400" />
                                ) : (
                                  <Trash2 className="h-4 w-4" />
                                )}
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Quick Fuel Modal */}
      {quickFuelVehicle && (
        <QuickFuelModal
          vehicleId={quickFuelVehicle.id}
          vehicleName={quickFuelVehicle.name}
          currentMileage={quickFuelVehicle.current_mileage || 0}
          onClose={() => setQuickFuelVehicle(null)}
          onSuccess={() => {
            refetch();
          }}
        />
      )}
    </div>
  );
}
