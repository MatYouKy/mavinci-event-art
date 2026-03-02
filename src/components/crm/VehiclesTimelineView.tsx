'use client';

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Calendar,
  Wrench,
  Car,
  Filter,
  X,
  MapPin,
  User,
} from 'lucide-react';

interface VehicleTimelineEntry {
  id: string;
  type: 'event' | 'maintenance';
  start_date: string;
  end_date: string;
  title: string;
  description: string;
  status: string;
  color: string;
  related_id: string;
  event_name?: string;
  driver_name?: string;
  location?: string;
}

interface Vehicle {
  id: string;
  name: string;
  brand: string;
  model: string;
  registration_number: string;
  status: string;
  vehicle_type: string;
}

interface VehicleWithTimeline extends Vehicle {
  timeline: VehicleTimelineEntry[];
}

type ZoomLevel = 'day' | 'week' | 'month';

export default function VehiclesTimelineView() {
  const { showSnackbar } = useSnackbar();
  const [vehicles, setVehicles] = useState<VehicleWithTimeline[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [zoomLevel, setZoomLevel] = useState<ZoomLevel>('week');
  const [showFilters, setShowFilters] = useState(false);

  // Filtry
  const [filters, setFilters] = useState({
    searchQuery: '',
    vehicleTypes: [] as string[],
    statuses: [] as string[],
  });

  const fetchVehiclesWithTimeline = async () => {
    try {
      setIsLoading(true);

      // Pobierz pojazdy
      const { data: vehiclesData, error: vehiclesError } = await supabase
        .from('vehicles')
        .select('id, name, brand, model, registration_number, status, vehicle_type')
        .order('name');

      if (vehiclesError) throw vehiclesError;

      // Oblicz zakres dat
      const startDate = getStartDate();
      const endDate = getEndDate();

      // Pobierz timeline dla każdego pojazdu
      const vehiclesWithTimeline = await Promise.all(
        (vehiclesData || []).map(async (vehicle) => {
          const { data: timelineData, error: timelineError } = await supabase.rpc(
            'get_vehicle_timeline',
            {
              p_vehicle_id: vehicle.id,
              p_start_date: startDate.toISOString(),
              p_end_date: endDate.toISOString(),
            },
          );

          if (timelineError) {
            console.error('Error fetching timeline:', timelineError);
            return { ...vehicle, timeline: [] };
          }

          return { ...vehicle, timeline: timelineData || [] };
        }),
      );

      setVehicles(vehiclesWithTimeline);
    } catch (error) {
      console.error('Error fetching vehicles:', error);
      showSnackbar('Błąd podczas ładowania pojazdów', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchVehiclesWithTimeline();
  }, [currentDate, zoomLevel]);

  const getStartDate = () => {
    const date = new Date(currentDate);
    if (zoomLevel === 'day') {
      date.setDate(date.getDate() - 3);
    } else if (zoomLevel === 'week') {
      date.setDate(date.getDate() - 14);
    } else {
      date.setMonth(date.getMonth() - 1);
    }
    return date;
  };

  const getEndDate = () => {
    const date = new Date(currentDate);
    if (zoomLevel === 'day') {
      date.setDate(date.getDate() + 4);
    } else if (zoomLevel === 'week') {
      date.setDate(date.getDate() + 14);
    } else {
      date.setMonth(date.getMonth() + 2);
    }
    return date;
  };

  const getDaysInView = () => {
    if (zoomLevel === 'day') return 7;
    if (zoomLevel === 'week') return 28;
    return 90;
  };

  const generateTimelineColumns = () => {
    const days = getDaysInView();
    const startDate = getStartDate();
    const columns = [];

    for (let i = 0; i < days; i++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);
      columns.push(date);
    }

    return columns;
  };

  const columns = useMemo(() => generateTimelineColumns(), [currentDate, zoomLevel]);

  const getColumnWidth = () => {
    if (zoomLevel === 'day') return 120;
    if (zoomLevel === 'week') return 60;
    return 30;
  };

  const columnWidth = getColumnWidth();

  const navigatePrevious = () => {
    const newDate = new Date(currentDate);
    if (zoomLevel === 'day') {
      newDate.setDate(newDate.getDate() - 7);
    } else if (zoomLevel === 'week') {
      newDate.setDate(newDate.getDate() - 28);
    } else {
      newDate.setMonth(newDate.getMonth() - 3);
    }
    setCurrentDate(newDate);
  };

  const navigateNext = () => {
    const newDate = new Date(currentDate);
    if (zoomLevel === 'day') {
      newDate.setDate(newDate.getDate() + 7);
    } else if (zoomLevel === 'week') {
      newDate.setDate(newDate.getDate() + 28);
    } else {
      newDate.setMonth(newDate.getMonth() + 3);
    }
    setCurrentDate(newDate);
  };

  const navigateToday = () => {
    setCurrentDate(new Date());
  };

  const calculatePosition = (startDate: string) => {
    const start = new Date(startDate);
    const timelineStart = getStartDate();
    const diffTime = start.getTime() - timelineStart.getTime();
    const diffDays = diffTime / (1000 * 60 * 60 * 24);
    return Math.max(0, diffDays * columnWidth);
  };

  const calculateWidth = (startDate: string, endDate: string) => {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffTime = end.getTime() - start.getTime();
    const diffDays = diffTime / (1000 * 60 * 60 * 24);
    return Math.max(columnWidth * 0.8, diffDays * columnWidth);
  };

  const isToday = (date: Date) => {
    const today = new Date();
    return (
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear()
    );
  };

  const filteredVehicles = useMemo(() => {
    return vehicles.filter((vehicle) => {
      // Filtr tekstowy
      if (filters.searchQuery) {
        const query = filters.searchQuery.toLowerCase();
        const matchesQuery =
          vehicle.name.toLowerCase().includes(query) ||
          vehicle.brand.toLowerCase().includes(query) ||
          vehicle.model.toLowerCase().includes(query) ||
          vehicle.registration_number?.toLowerCase().includes(query);

        if (!matchesQuery) return false;
      }

      // Filtr typu pojazdu
      if (filters.vehicleTypes.length > 0) {
        if (!filters.vehicleTypes.includes(vehicle.vehicle_type)) return false;
      }

      // Filtr statusu
      if (filters.statuses.length > 0) {
        if (!filters.statuses.includes(vehicle.status)) return false;
      }

      return true;
    });
  }, [vehicles, filters]);

  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (filters.searchQuery) count++;
    if (filters.vehicleTypes.length > 0) count++;
    if (filters.statuses.length > 0) count++;
    return count;
  }, [filters]);

  const toggleFilter = (category: 'vehicleTypes' | 'statuses', value: string) => {
    setFilters((prev) => {
      const current = prev[category];
      const newValues = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      return { ...prev, [category]: newValues };
    });
  };

  const clearFilters = () => {
    setFilters({
      searchQuery: '',
      vehicleTypes: [],
      statuses: [],
    });
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-[#d3bb73]" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-[#e5e4e2]">Timeline wykorzystania pojazdów</h2>
          <p className="mt-1 text-sm text-[#e5e4e2]/60">
            Widok wykorzystania {filteredVehicles.length} pojazdów
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Nawigacja dat */}
          <div className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] p-1">
            <button
              onClick={navigatePrevious}
              className="rounded p-2 hover:bg-[#d3bb73]/10"
              title="Poprzedni okres"
            >
              <ChevronLeft className="h-4 w-4 text-[#e5e4e2]" />
            </button>

            <button
              onClick={navigateToday}
              className="rounded px-3 py-2 text-sm font-medium text-[#e5e4e2] hover:bg-[#d3bb73]/10"
            >
              Dzisiaj
            </button>

            <button
              onClick={navigateNext}
              className="rounded p-2 hover:bg-[#d3bb73]/10"
              title="Następny okres"
            >
              <ChevronRight className="h-4 w-4 text-[#e5e4e2]" />
            </button>
          </div>

          {/* Zoom */}
          <div className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] p-1">
            <button
              onClick={() => setZoomLevel('day')}
              className={`rounded px-3 py-2 text-sm font-medium transition-colors ${
                zoomLevel === 'day'
                  ? 'bg-[#d3bb73] text-[#1c1f33]'
                  : 'text-[#e5e4e2] hover:bg-[#d3bb73]/10'
              }`}
              title="Widok dzienny"
            >
              <ZoomIn className="h-4 w-4" />
            </button>

            <button
              onClick={() => setZoomLevel('week')}
              className={`rounded px-3 py-2 text-sm font-medium transition-colors ${
                zoomLevel === 'week'
                  ? 'bg-[#d3bb73] text-[#1c1f33]'
                  : 'text-[#e5e4e2] hover:bg-[#d3bb73]/10'
              }`}
              title="Widok tygodniowy"
            >
              <Calendar className="h-4 w-4" />
            </button>

            <button
              onClick={() => setZoomLevel('month')}
              className={`rounded px-3 py-2 text-sm font-medium transition-colors ${
                zoomLevel === 'month'
                  ? 'bg-[#d3bb73] text-[#1c1f33]'
                  : 'text-[#e5e4e2] hover:bg-[#d3bb73]/10'
              }`}
              title="Widok miesięczny"
            >
              <ZoomOut className="h-4 w-4" />
            </button>

            <button
              onClick={() => setShowFilters(true)}
              className="relative rounded px-3 py-2 text-sm font-medium text-[#e5e4e2] hover:bg-[#d3bb73]/10"
              title="Filtry"
            >
              <Filter className="h-4 w-4" />
              {activeFiltersCount > 0 && (
                <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[#d3bb73] text-xs font-bold text-[#1c1f33]">
                  {activeFiltersCount}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Timeline Grid */}
      <div className="flex flex-1 overflow-hidden rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33]">
        {/* Sidebar z nazwami */}
        <div className="w-64 flex-shrink-0 border-r border-[#d3bb73]/20 bg-[#0f1119]">
          <div className="sticky top-0 z-10 border-b border-[#d3bb73]/20 bg-[#0f1119] p-4">
            <div className="text-sm font-medium text-[#e5e4e2]">Pojazdy</div>
          </div>

          <div className="overflow-y-auto" style={{ height: 'calc(100% - 57px)' }}>
            {filteredVehicles.map((vehicle) => (
              <div
                key={vehicle.id}
                className="flex h-16 items-center border-b border-[#d3bb73]/10 px-4 hover:bg-[#1c1f33]/50"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Car className="h-4 w-4 text-[#d3bb73]" />
                    <div className="font-medium text-[#e5e4e2]">{vehicle.name}</div>
                  </div>
                  <div className="mt-0.5 text-xs text-[#e5e4e2]/60">
                    {vehicle.brand} {vehicle.model}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Timeline Content */}
        <div className="flex-1 overflow-x-auto">
          {/* Header z datami */}
          <div className="sticky top-0 z-10 flex border-b border-[#d3bb73]/20 bg-[#0f1119]">
            {columns.map((date, idx) => (
              <div
                key={idx}
                className={`flex-shrink-0 border-r border-[#d3bb73]/10 p-2 text-center ${
                  isToday(date) ? 'bg-[#d3bb73]/20' : ''
                }`}
                style={{ width: `${columnWidth}px` }}
              >
                <div className="text-xs font-medium text-[#e5e4e2]">
                  {date.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' })}
                </div>
                <div className="text-xs text-[#e5e4e2]/60">
                  {date.toLocaleDateString('pl-PL', { weekday: 'short' })}
                </div>
              </div>
            ))}
          </div>

          {/* Rows */}
          <div className="relative">
            {/* Today indicator */}
            {(() => {
              const todayPosition = calculatePosition(new Date().toISOString());
              return (
                <div
                  className="pointer-events-none absolute top-0 z-20 h-full w-0.5 bg-red-500"
                  style={{ left: `${todayPosition}px` }}
                />
              );
            })()}

            {/* Rows z timelinami */}
            {filteredVehicles.map((vehicle) => (
              <div
                key={vehicle.id}
                className="relative h-16 border-b border-[#d3bb73]/10"
                style={{ width: `${columns.length * columnWidth}px` }}
              >
                {/* Grid lines */}
                {columns.map((_, idx) => (
                  <div
                    key={idx}
                    className="absolute top-0 h-full border-r border-[#d3bb73]/5"
                    style={{ left: `${idx * columnWidth}px`, width: `${columnWidth}px` }}
                  />
                ))}

                {/* Timeline entries */}
                {vehicle.timeline.map((entry) => {
                  const left = calculatePosition(entry.start_date);
                  const width = calculateWidth(entry.start_date, entry.end_date);

                  return (
                    <div
                      key={entry.id}
                      className="absolute top-2 h-12 cursor-pointer overflow-hidden rounded px-2 py-1 text-xs text-white transition-all hover:z-10 hover:shadow-lg"
                      style={{
                        left: `${left}px`,
                        width: `${width}px`,
                        backgroundColor: entry.color,
                      }}
                      title={`${entry.title}\n${entry.description}`}
                    >
                      <div className="flex h-full flex-col justify-center">
                        <div className="flex items-center gap-1 font-medium">
                          {entry.type === 'event' ? (
                            <Calendar className="h-3 w-3 flex-shrink-0" />
                          ) : (
                            <Wrench className="h-3 w-3 flex-shrink-0" />
                          )}
                          <span className="truncate">{entry.title}</span>
                        </div>

                        {entry.location && width > 100 && (
                          <div className="mt-0.5 flex items-center gap-1 text-[10px] opacity-80">
                            <MapPin className="h-2.5 w-2.5 flex-shrink-0" />
                            <span className="truncate">{entry.location}</span>
                          </div>
                        )}

                        {entry.driver_name && width > 150 && (
                          <div className="mt-0.5 flex items-center gap-1 text-[10px] opacity-80">
                            <User className="h-2.5 w-2.5 flex-shrink-0" />
                            <span className="truncate">{entry.driver_name}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Modal filtrów */}
      {showFilters && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] shadow-xl">
            <div className="flex items-center justify-between border-b border-[#d3bb73]/20 p-4">
              <h3 className="text-lg font-semibold text-[#e5e4e2]">Filtry</h3>
              <button
                onClick={() => setShowFilters(false)}
                className="rounded p-1 hover:bg-[#d3bb73]/10"
              >
                <X className="h-5 w-5 text-[#e5e4e2]" />
              </button>
            </div>

            <div className="max-h-[600px] space-y-4 overflow-y-auto p-4">
              {/* Wyszukiwanie */}
              <div>
                <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                  Szukaj pojazdu
                </label>
                <input
                  type="text"
                  value={filters.searchQuery}
                  onChange={(e) => setFilters({ ...filters, searchQuery: e.target.value })}
                  placeholder="Nazwa, marka, model, rejestracja..."
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:border-[#d3bb73] focus:outline-none"
                />
              </div>

              {/* Typ pojazdu */}
              <div>
                <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                  Typ pojazdu
                </label>
                <div className="space-y-2">
                  {['van', 'truck', 'car', 'trailer'].map((type) => (
                    <label key={type} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={filters.vehicleTypes.includes(type)}
                        onChange={() => toggleFilter('vehicleTypes', type)}
                        className="h-4 w-4 rounded border-[#d3bb73]/20 bg-[#0f1119] text-[#d3bb73] focus:ring-[#d3bb73]"
                      />
                      <span className="text-sm text-[#e5e4e2]/80 capitalize">{type}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Status */}
              <div>
                <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Status</label>
                <div className="space-y-2">
                  {['active', 'in_service', 'inactive'].map((status) => (
                    <label key={status} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={filters.statuses.includes(status)}
                        onChange={() => toggleFilter('statuses', status)}
                        className="h-4 w-4 rounded border-[#d3bb73]/20 bg-[#0f1119] text-[#d3bb73] focus:ring-[#d3bb73]"
                      />
                      <span className="text-sm text-[#e5e4e2]/80">
                        {status === 'active'
                          ? 'Dostępny'
                          : status === 'in_service'
                            ? 'W serwisie'
                            : 'Nieaktywny'}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex gap-2 border-t border-[#d3bb73]/20 p-4">
              <button
                onClick={clearFilters}
                className="flex-1 rounded-lg border border-[#d3bb73]/20 px-4 py-2 text-sm font-medium text-[#e5e4e2] hover:bg-[#d3bb73]/10"
              >
                Wyczyść
              </button>
              <button
                onClick={() => setShowFilters(false)}
                className="flex-1 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
              >
                Zastosuj
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
