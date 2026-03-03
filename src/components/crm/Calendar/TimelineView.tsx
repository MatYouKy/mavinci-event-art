'use client';

import { useState, useMemo } from 'react';
import { CalendarEvent } from './types';
import { Truck, User, Box, Calendar, MapPin, Clock } from 'lucide-react';

interface TimelineViewProps {
  currentDate: Date;
  events: CalendarEvent[];
  onEventClick: (event: CalendarEvent) => void;
  vehicles: any[];
  employees: any[];
  equipment: any[];
  eventsWithAssignments?: any[];
}

type ResourceType = 'vehicles' | 'employees' | 'equipment';

interface ResourceFilter {
  vehicles: boolean;
  employees: boolean;
  equipment: boolean;
}

// Kolorystyka dla statusów i typów zasobów
const RESOURCE_COLORS = {
  vehicles: {
    available: 'bg-blue-500/20 border-blue-500/50 text-blue-400',
    busy: 'bg-orange-500/20 border-orange-500/50 text-orange-400',
    maintenance: 'bg-red-500/20 border-red-500/50 text-red-400',
    reserved: 'bg-purple-500/20 border-purple-500/50 text-purple-400',
  },
  employees: {
    available: 'bg-green-500/20 border-green-500/50 text-green-400',
    busy: 'bg-yellow-500/20 border-yellow-500/50 text-yellow-400',
    sick: 'bg-red-500/20 border-red-500/50 text-red-400',
    vacation: 'bg-purple-500/20 border-purple-500/50 text-purple-400',
  },
  equipment: {
    available: 'bg-teal-500/20 border-teal-500/50 text-teal-400',
    busy: 'bg-amber-500/20 border-amber-500/50 text-amber-400',
    maintenance: 'bg-red-500/20 border-red-500/50 text-red-400',
    reserved: 'bg-indigo-500/20 border-indigo-500/50 text-indigo-400',
  },
};

const STATUS_COLORS = {
  pending: 'bg-gray-500/20 border-gray-500/50 text-gray-400',
  confirmed: 'bg-blue-500/20 border-blue-500/50 text-blue-400',
  in_progress: 'bg-yellow-500/20 border-yellow-500/50 text-yellow-400',
  completed: 'bg-green-500/20 border-green-500/50 text-green-400',
  cancelled: 'bg-red-500/20 border-red-500/50 text-red-400',
  planning: 'bg-purple-500/20 border-purple-500/50 text-purple-400',
};

export default function TimelineView({
  currentDate,
  events,
  onEventClick,
  vehicles = [],
  employees = [],
  equipment = [],
  eventsWithAssignments = [],
}: TimelineViewProps) {
  const [resourceFilters, setResourceFilters] = useState<ResourceFilter>({
    vehicles: true,
    employees: true,
    equipment: true,
  });

  // Generuj zakres dat dla tygodnia
  const weekStart = useMemo(() => {
    const date = new Date(currentDate);
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    date.setDate(diff);
    date.setHours(0, 0, 0, 0);
    return date;
  }, [currentDate]);

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(weekStart);
      date.setDate(weekStart.getDate() + i);
      return date;
    });
  }, [weekStart]);

  // Użyj eventsWithAssignments jeśli są dostępne, w przeciwnym razie events
  const timelineEvents = eventsWithAssignments.length > 0 ? eventsWithAssignments : events;

  // Przygotuj dane timeline dla pojazdów
  const vehicleTimeline = useMemo(() => {
    if (!resourceFilters.vehicles) return [];

    return vehicles.map((vehicle) => {
      const assignments = timelineEvents.filter((event: any) => {
        const eventVehicles = event.event_vehicles || [];
        return eventVehicles.some((ev: any) => ev.vehicle_id === vehicle.id);
      });

      return {
        id: vehicle.id,
        name: vehicle.name,
        type: 'vehicle' as const,
        registration: vehicle.registration_number,
        assignments: assignments.map((event: any) => ({
          event,
          startDate: new Date(event.event_date),
          endDate: event.event_end_date ? new Date(event.event_end_date) : new Date(event.event_date),
          status: event.status,
        })),
      };
    });
  }, [vehicles, timelineEvents, resourceFilters.vehicles]);

  // Przygotuj dane timeline dla pracowników
  const employeeTimeline = useMemo(() => {
    if (!resourceFilters.employees) return [];

    return employees.map((employee) => {
      const assignments = timelineEvents.filter((event: any) => {
        const assignedEmployees = event.employee_assignments || [];
        return assignedEmployees.some((a: any) => a.employee_id === employee.id);
      });

      return {
        id: employee.id,
        name: `${employee.name} ${employee.surname}`,
        type: 'employee' as const,
        nickname: employee.nickname,
        assignments: assignments.map((event: any) => ({
          event,
          startDate: new Date(event.event_date),
          endDate: event.event_end_date ? new Date(event.event_end_date) : new Date(event.event_date),
          status: event.status,
        })),
      };
    });
  }, [employees, timelineEvents, resourceFilters.employees]);

  // Przygotuj dane timeline dla sprzętu
  const equipmentTimeline = useMemo(() => {
    if (!resourceFilters.equipment) return [];

    return equipment.map((item) => {
      const assignments = timelineEvents.filter((event: any) => {
        const eventEquipment = event.event_equipment || [];
        return eventEquipment.some((eq: any) => eq.equipment_item_id === item.id);
      });

      return {
        id: item.id,
        name: item.name,
        type: 'equipment' as const,
        category: item.category?.name,
        assignments: assignments.map((event: any) => ({
          event,
          startDate: new Date(event.event_date),
          endDate: event.event_end_date ? new Date(event.event_end_date) : new Date(event.event_date),
          status: event.status,
        })),
      };
    });
  }, [equipment, timelineEvents, resourceFilters.equipment]);

  const allResources = [...vehicleTimeline, ...employeeTimeline, ...equipmentTimeline];

  const toggleResourceFilter = (type: ResourceType) => {
    setResourceFilters((prev) => ({
      ...prev,
      [type]: !prev[type],
    }));
  };

  // Oblicz pozycję i szerokość paska wydarzenia na timeline
  const getEventPosition = (startDate: Date, endDate: Date) => {
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);

    const totalWeekMs = weekEnd.getTime() - weekStart.getTime();
    const startMs = Math.max(startDate.getTime(), weekStart.getTime());
    const endMs = Math.min(endDate.getTime(), weekEnd.getTime());

    const left = ((startMs - weekStart.getTime()) / totalWeekMs) * 100;
    const width = ((endMs - startMs) / totalWeekMs) * 100;

    return { left: `${left}%`, width: `${width}%` };
  };

  // Sprawdź czy wydarzenie jest w zakresie tygodnia
  const isEventInWeek = (startDate: Date, endDate: Date) => {
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);

    return startDate < weekEnd && endDate > weekStart;
  };

  const getResourceIcon = (type: string) => {
    switch (type) {
      case 'vehicle':
        return <Truck className="h-4 w-4" />;
      case 'employee':
        return <User className="h-4 w-4" />;
      case 'equipment':
        return <Box className="h-4 w-4" />;
      default:
        return null;
    }
  };

  const hasActiveFilters = !resourceFilters.vehicles || !resourceFilters.employees || !resourceFilters.equipment;

  return (
    <div className="space-y-4">
      {/* Filtry zasobów */}
      <div className="flex items-center gap-3 rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-4">
        <span className="text-sm text-[#e5e4e2]/60">Pokaż:</span>

        <button
          onClick={() => toggleResourceFilter('vehicles')}
          className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
            resourceFilters.vehicles
              ? 'bg-blue-500/20 border border-blue-500/50 text-blue-400'
              : 'bg-[#0f1119] border border-[#d3bb73]/10 text-[#e5e4e2]/40'
          }`}
        >
          <Truck className="h-4 w-4" />
          Pojazdy ({vehicles.length})
        </button>

        <button
          onClick={() => toggleResourceFilter('employees')}
          className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
            resourceFilters.employees
              ? 'bg-green-500/20 border border-green-500/50 text-green-400'
              : 'bg-[#0f1119] border border-[#d3bb73]/10 text-[#e5e4e2]/40'
          }`}
        >
          <User className="h-4 w-4" />
          Pracownicy ({employees.length})
        </button>

        <button
          onClick={() => toggleResourceFilter('equipment')}
          className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
            resourceFilters.equipment
              ? 'bg-teal-500/20 border border-teal-500/50 text-teal-400'
              : 'bg-[#0f1119] border border-[#d3bb73]/10 text-[#e5e4e2]/40'
          }`}
        >
          <Box className="h-4 w-4" />
          Sprzęt ({equipment.length})
        </button>

        {hasActiveFilters && (
          <button
            onClick={() => setResourceFilters({ vehicles: true, employees: true, equipment: true })}
            className="ml-auto text-sm text-[#d3bb73] hover:text-[#d3bb73]/80"
          >
            Pokaż wszystkie
          </button>
        )}
      </div>

      {/* Timeline header - dni tygodnia */}
      <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-4">
        <div className="flex">
          <div className="w-48 flex-shrink-0 border-r border-[#d3bb73]/10 pr-4">
            <span className="text-sm font-medium text-[#e5e4e2]">Zasób</span>
          </div>
          <div className="flex-1 pl-4">
            <div className="grid grid-cols-7 gap-px">
              {weekDays.map((day, idx) => (
                <div key={idx} className="text-center">
                  <div className="text-xs text-[#e5e4e2]/60">
                    {day.toLocaleDateString('pl-PL', { weekday: 'short' })}
                  </div>
                  <div className={`text-sm ${
                    day.toDateString() === new Date().toDateString()
                      ? 'font-bold text-[#d3bb73]'
                      : 'text-[#e5e4e2]'
                  }`}>
                    {day.getDate()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Timeline rows - zasoby */}
      <div className="space-y-2">
        {allResources.length === 0 ? (
          <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-8 text-center">
            <p className="text-sm text-[#e5e4e2]/60">
              Brak zasobów do wyświetlenia. Wybierz przynajmniej jeden typ zasobu.
            </p>
          </div>
        ) : (
          allResources.map((resource) => (
            <div
              key={`${resource.type}-${resource.id}`}
              className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-4 hover:bg-[#1c1f33]/80 transition-colors"
            >
              <div className="flex">
                {/* Nazwa zasobu */}
                <div className="w-48 flex-shrink-0 border-r border-[#d3bb73]/10 pr-4">
                  <div className="flex items-center gap-2">
                    {getResourceIcon(resource.type)}
                    <div className="flex-1 overflow-hidden">
                      <div className="truncate text-sm font-medium text-[#e5e4e2]">
                        {resource.name}
                      </div>
                      {resource.type === 'vehicle' && (
                        <div className="truncate text-xs text-[#e5e4e2]/60">
                          {(resource as any).registration}
                        </div>
                      )}
                      {resource.type === 'employee' && (resource as any).nickname && (
                        <div className="truncate text-xs text-[#e5e4e2]/60">
                          @{(resource as any).nickname}
                        </div>
                      )}
                      {resource.type === 'equipment' && (resource as any).category && (
                        <div className="truncate text-xs text-[#e5e4e2]/60">
                          {(resource as any).category}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Timeline z wydarzeniami */}
                <div className="relative flex-1 pl-4">
                  {/* Linie pionowe dla dni */}
                  <div className="absolute inset-0 grid grid-cols-7 gap-px">
                    {weekDays.map((_, idx) => (
                      <div
                        key={idx}
                        className="border-r border-[#d3bb73]/5"
                      />
                    ))}
                  </div>

                  {/* Wydarzenia */}
                  <div className="relative h-12">
                    {resource.assignments
                      .filter((assignment) =>
                        isEventInWeek(assignment.startDate, assignment.endDate)
                      )
                      .map((assignment, idx) => {
                        const position = getEventPosition(
                          assignment.startDate,
                          assignment.endDate
                        );
                        const colorClass = STATUS_COLORS[assignment.status as keyof typeof STATUS_COLORS] || STATUS_COLORS.pending;

                        // Przygotuj obiekt CalendarEvent dla kliknięcia
                        const calendarEvent: CalendarEvent = {
                          id: assignment.event.id,
                          name: assignment.event.name,
                          event_date: assignment.event.event_date,
                          event_end_date: assignment.event.event_end_date,
                          status: assignment.event.status,
                          location: assignment.event.location || '',
                        };

                        return (
                          <div
                            key={`${assignment.event.id}-${idx}`}
                            className={`absolute top-1 h-10 rounded border cursor-pointer overflow-hidden transition-all hover:z-10 hover:shadow-lg ${colorClass}`}
                            style={{
                              left: position.left,
                              width: position.width,
                              minWidth: '40px',
                            }}
                            onClick={() => onEventClick(calendarEvent)}
                            title={`${assignment.event.name}\n${assignment.startDate.toLocaleDateString('pl-PL')} - ${assignment.endDate.toLocaleDateString('pl-PL')}\n${assignment.event.location || ''}`}
                          >
                            <div className="flex h-full items-center px-2">
                              <div className="flex-1 overflow-hidden">
                                <div className="truncate text-xs font-medium">
                                  {assignment.event.name}
                                </div>
                                {assignment.event.location && (
                                  <div className="flex items-center gap-1 text-xs opacity-70">
                                    <MapPin className="h-2.5 w-2.5" />
                                    <span className="truncate">{assignment.event.location}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}

                    {resource.assignments.length === 0 && (
                      <div className="flex h-full items-center justify-center">
                        <span className="text-xs text-[#e5e4e2]/30">Brak przypisań</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Legenda kolorów */}
      <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-4">
        <div className="text-sm font-medium text-[#e5e4e2] mb-3">Legenda statusów</div>
        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <div className={`h-3 w-8 rounded border ${STATUS_COLORS.pending}`} />
            <span className="text-xs text-[#e5e4e2]/60">Oczekujące</span>
          </div>
          <div className="flex items-center gap-2">
            <div className={`h-3 w-8 rounded border ${STATUS_COLORS.confirmed}`} />
            <span className="text-xs text-[#e5e4e2]/60">Potwierdzone</span>
          </div>
          <div className="flex items-center gap-2">
            <div className={`h-3 w-8 rounded border ${STATUS_COLORS.in_progress}`} />
            <span className="text-xs text-[#e5e4e2]/60">W trakcie</span>
          </div>
          <div className="flex items-center gap-2">
            <div className={`h-3 w-8 rounded border ${STATUS_COLORS.completed}`} />
            <span className="text-xs text-[#e5e4e2]/60">Zakończone</span>
          </div>
          <div className="flex items-center gap-2">
            <div className={`h-3 w-8 rounded border ${STATUS_COLORS.cancelled}`} />
            <span className="text-xs text-[#e5e4e2]/60">Anulowane</span>
          </div>
          <div className="flex items-center gap-2">
            <div className={`h-3 w-8 rounded border ${STATUS_COLORS.planning}`} />
            <span className="text-xs text-[#e5e4e2]/60">Planowanie</span>
          </div>
        </div>
      </div>
    </div>
  );
}
