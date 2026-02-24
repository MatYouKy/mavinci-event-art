'use client';

import React, { useState, useMemo } from 'react';
import { User, Car, ChevronDown, ChevronRight, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import { EventPhase } from '@/store/api/eventPhasesApi';
import {
  useGetPhaseAssignmentsQuery,
  useGetPhaseVehiclesQuery,
} from '@/store/api/eventPhasesApi';

interface ResourceTimelineProps {
  eventId: string;
  phases: EventPhase[];
  timelineBounds: { start: Date; end: Date };
  zoomLevel: 'days' | 'hours' | 'minutes';
  employees: any[];
  vehicles: any[];
}

type ResourceType = 'employee' | 'vehicle';

interface ResourceRow {
  id: string;
  type: ResourceType;
  name: string;
  avatar_url?: string;
  assignments: {
    phase: EventPhase;
    start_time: string;
    end_time: string;
    role?: string;
  }[];
}

export const ResourceTimeline: React.FC<ResourceTimelineProps> = ({
  phases,
  timelineBounds,
  zoomLevel,
  employees,
  vehicles,
}) => {
  const [expandedResources, setExpandedResources] = useState<Set<string>>(new Set());
  const [rowHeight, setRowHeight] = useState<'compact' | 'normal' | 'expanded'>('normal');

  const totalDuration = timelineBounds.end.getTime() - timelineBounds.start.getTime();

  // Pobierz wszystkie przypisania dla wszystkich faz
  const phaseAssignments = phases.map(phase => {
    const { data: assignments = [] } = useGetPhaseAssignmentsQuery(phase.id);
    const { data: vehicleAssignments = [] } = useGetPhaseVehiclesQuery(phase.id);
    return { phase, assignments, vehicleAssignments };
  });

  // Stwórz wiersze dla pracowników
  const employeeRows: ResourceRow[] = useMemo(() => {
    return employees.map(emp => {
      const assignments = phaseAssignments
        .flatMap(({ phase, assignments }) => {
          const assignment = assignments.find((a: any) => a.employee_id === emp.id);
          if (!assignment) return [];
          return [{
            phase,
            start_time: assignment.assignment_start || phase.start_time,
            end_time: assignment.assignment_end || phase.end_time,
            role: assignment.role,
          }];
        })
        .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());

      return {
        id: emp.id,
        type: 'employee' as ResourceType,
        name: `${emp.name} ${emp.surname}`,
        avatar_url: emp.avatar_url,
        assignments,
      };
    });
  }, [employees, phaseAssignments]);

  // Stwórz wiersze dla pojazdów
  const vehicleRows: ResourceRow[] = useMemo(() => {
    return vehicles.map(veh => {
      const vehicle = veh.vehicle || veh;
      const assignments = phaseAssignments
        .flatMap(({ phase, vehicleAssignments }) => {
          const assignment = vehicleAssignments.find((v: any) => v.vehicle_id === vehicle.id);
          if (!assignment) return [];
          return [{
            phase,
            start_time: assignment.assigned_start || phase.start_time,
            end_time: assignment.assigned_end || phase.end_time,
          }];
        })
        .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());

      return {
        id: vehicle.id,
        type: 'vehicle' as ResourceType,
        name: vehicle.name || vehicle.registration_number || 'Bez nazwy',
        assignments,
      };
    });
  }, [vehicles, phaseAssignments]);

  // Filtruj tylko te zasoby, które mają przypisania
  const activeEmployees = employeeRows.filter(row => row.assignments.length > 0);
  const activeVehicles = vehicleRows.filter(row => row.assignments.length > 0);

  const getRowHeightPx = () => {
    switch (rowHeight) {
      case 'compact': return 40;
      case 'normal': return 60;
      case 'expanded': return 80;
      default: return 60;
    }
  };

  const heightPx = getRowHeightPx();

  const toggleExpand = (id: string) => {
    const newSet = new Set(expandedResources);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setExpandedResources(newSet);
  };

  const getAssignmentPosition = (startTime: string, endTime: string) => {
    const start = new Date(startTime).getTime();
    const end = new Date(endTime).getTime();

    const left = ((start - timelineBounds.start.getTime()) / totalDuration) * 100;
    const width = ((end - start) / totalDuration) * 100;

    return { left: `${Math.max(0, left)}%`, width: `${Math.max(1, width)}%` };
  };

  const formatTime = (date: string): string => {
    const d = new Date(date);
    if (zoomLevel === 'days') {
      return d.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' });
    } else {
      return d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
    }
  };

  const renderResourceRow = (resource: ResourceRow, index: number) => {
    const isExpanded = expandedResources.has(resource.id);
    const Icon = resource.type === 'employee' ? User : Car;

    return (
      <div key={resource.id} className="relative border-b border-[#d3bb73]/10">
        {/* Resource Label */}
        <div
          className="flex items-center gap-2 border-r border-[#d3bb73]/10 bg-[#1c1f33]/50 px-3 transition-colors hover:bg-[#1c1f33]/80"
          style={{ height: `${heightPx}px` }}
        >
          <button
            onClick={() => toggleExpand(resource.id)}
            className="rounded p-1 transition-colors hover:bg-[#d3bb73]/20"
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4 text-[#d3bb73]" />
            ) : (
              <ChevronRight className="h-4 w-4 text-[#d3bb73]" />
            )}
          </button>
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#d3bb73]/20">
            <Icon className="h-4 w-4 text-[#d3bb73]" />
          </div>
          <div className="flex-1 overflow-hidden">
            <p className="truncate text-sm font-medium text-[#e5e4e2]">{resource.name}</p>
            <p className="text-xs text-[#e5e4e2]/50">
              {resource.assignments.length} {resource.assignments.length === 1 ? 'przypisanie' : 'przypisań'}
            </p>
          </div>
        </div>

        {/* Timeline Row */}
        <div className="absolute left-0 right-0 top-0" style={{ height: `${heightPx}px`, paddingLeft: '240px' }}>
          {resource.assignments.map((assignment, idx) => {
            const position = getAssignmentPosition(assignment.start_time, assignment.end_time);
            const phaseColor = assignment.phase.color || assignment.phase.phase_type?.color || '#3b82f6';

            return (
              <div
                key={idx}
                className="absolute flex items-center rounded border-l-4 px-2 shadow"
                style={{
                  top: '4px',
                  bottom: '4px',
                  left: position.left,
                  width: position.width,
                  backgroundColor: `${phaseColor}30`,
                  borderLeftColor: phaseColor,
                }}
              >
                <div className="flex-1 overflow-hidden">
                  <p className="truncate text-xs font-semibold text-[#e5e4e2]">
                    {assignment.phase.name}
                  </p>
                  {isExpanded && (
                    <p className="truncate text-xs text-[#e5e4e2]/70">
                      {formatTime(assignment.start_time)} - {formatTime(assignment.end_time)}
                    </p>
                  )}
                  {assignment.role && isExpanded && (
                    <p className="truncate text-xs text-[#e5e4e2]/50">{assignment.role}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  if (activeEmployees.length === 0 && activeVehicles.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center">
        <p className="text-sm text-[#e5e4e2]/50">
          Brak przypisanych zasobów do faz
        </p>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Controls */}
      <div className="mb-4 flex items-center justify-between border-b border-[#d3bb73]/10 pb-3">
        <h3 className="text-sm font-semibold text-[#e5e4e2]">Harmonogram Zasobów</h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[#e5e4e2]/50">Wysokość wierszy:</span>
          <div className="flex gap-1 rounded-lg bg-[#1c1f33] p-1">
            <button
              onClick={() => setRowHeight('compact')}
              className={`rounded px-2 py-1 text-xs transition-colors ${
                rowHeight === 'compact'
                  ? 'bg-[#d3bb73] text-[#1c1f33]'
                  : 'text-[#e5e4e2]/70 hover:bg-[#d3bb73]/20'
              }`}
            >
              Kompaktowy
            </button>
            <button
              onClick={() => setRowHeight('normal')}
              className={`rounded px-2 py-1 text-xs transition-colors ${
                rowHeight === 'normal'
                  ? 'bg-[#d3bb73] text-[#1c1f33]'
                  : 'text-[#e5e4e2]/70 hover:bg-[#d3bb73]/20'
              }`}
            >
              Normalny
            </button>
            <button
              onClick={() => setRowHeight('expanded')}
              className={`rounded px-2 py-1 text-xs transition-colors ${
                rowHeight === 'expanded'
                  ? 'bg-[#d3bb73] text-[#1c1f33]'
                  : 'text-[#e5e4e2]/70 hover:bg-[#d3bb73]/20'
              }`}
            >
              Rozszerzony
            </button>
          </div>
        </div>
      </div>

      {/* Timeline Grid */}
      <div className="relative" style={{ paddingLeft: '240px', minHeight: '200px' }}>
        {/* Grid Lines (aligned with main timeline) */}
        <div className="absolute inset-0" style={{ left: '240px' }}>
          {Array.from({ length: 24 }, (_, i) => (
            <div
              key={i}
              className="absolute h-full border-l border-[#d3bb73]/5"
              style={{ left: `${(i / 24) * 100}%` }}
            />
          ))}
        </div>
      </div>

      {/* Resources */}
      <div className="relative">
        {/* Employees Section */}
        {activeEmployees.length > 0 && (
          <div className="mb-4">
            <div className="mb-2 flex items-center gap-2 px-3">
              <User className="h-4 w-4 text-[#d3bb73]" />
              <span className="text-xs font-semibold uppercase tracking-wide text-[#e5e4e2]/70">
                Pracownicy ({activeEmployees.length})
              </span>
            </div>
            {activeEmployees.map((employee, index) => renderResourceRow(employee, index))}
          </div>
        )}

        {/* Vehicles Section */}
        {activeVehicles.length > 0 && (
          <div>
            <div className="mb-2 flex items-center gap-2 px-3">
              <Car className="h-4 w-4 text-[#d3bb73]" />
              <span className="text-xs font-semibold uppercase tracking-wide text-[#e5e4e2]/70">
                Pojazdy ({activeVehicles.length})
              </span>
            </div>
            {activeVehicles.map((vehicle, index) => renderResourceRow(vehicle, index))}
          </div>
        )}
      </div>
    </div>
  );
};
