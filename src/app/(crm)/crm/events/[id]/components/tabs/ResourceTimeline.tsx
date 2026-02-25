'use client';

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { User, Car, Package, ChevronDown, ChevronRight, Info, Search, Pencil, Trash2, Copy, AlertTriangle } from 'lucide-react';
import { EventPhase } from '@/store/api/eventPhasesApi';
import { PhaseAssignmentsData } from './PhaseAssignmentsLoader';
import { TimelineTooltip, TooltipContent } from './TimelineTooltip';
import { useTimelineDrag, DragMode } from './useTimelineDrag';

interface ResourceTimelineProps {
  eventId: string;
  phases: EventPhase[];
  phaseAssignments: PhaseAssignmentsData[];
  timelineBounds: { start: Date; end: Date };
  zoomLevel: 'days' | 'hours' | 'minutes';
  employees: any[];
  vehicles: any[];
  equipment: any[];
}

type ResourceType = 'employee' | 'vehicle' | 'equipment';

interface Assignment {
  id?: string;
  phase: EventPhase;
  phaseId: string;
  resourceId: string;
  resourceType: ResourceType;
  start_time: string;
  end_time: string;
  role?: string;
  quantity?: number;
  isFullRange?: boolean;
}

interface ResourceRow {
  id: string;
  type: ResourceType;
  name: string;
  avatar_url?: string;
  category?: string;
  assignments: Assignment[];
  hasConflicts?: boolean;
}

export const ResourceTimeline: React.FC<ResourceTimelineProps> = ({
  phases,
  phaseAssignments,
  timelineBounds,
  zoomLevel,
  employees,
  vehicles,
  equipment,
}) => {
  const [expandedResources, setExpandedResources] = useState<Set<string>>(new Set());
  const [rowHeight, setRowHeight] = useState<'compact' | 'normal' | 'expanded'>('normal');
  const [showEquipmentDetails, setShowEquipmentDetails] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showOnlyAssigned, setShowOnlyAssigned] = useState(false);
  const [showOnlyConflicts, setShowOnlyConflicts] = useState(false);
  const [hideFullRange, setHideFullRange] = useState(false);
  const [hoveredAssignment, setHoveredAssignment] = useState<Assignment | null>(null);
  const [tooltipState, setTooltipState] = useState<{ x: number; y: number; assignment: Assignment | null }>({ x: 0, y: 0, assignment: null });
  const [currentTime, setCurrentTime] = useState(new Date());
  const timelineContainerRef = useRef<HTMLDivElement>(null);

  const totalDuration = timelineBounds.end.getTime() - timelineBounds.start.getTime();

  // Update current time every 60 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  // Calculate NOW position
  const nowPosition = useMemo(() => {
    const now = currentTime.getTime();
    const start = timelineBounds.start.getTime();
    const end = timelineBounds.end.getTime();
    if (now < start || now > end) return null;
    return ((now - start) / totalDuration) * 100;
  }, [currentTime, timelineBounds, totalDuration]);

  // Sprawdź czy przypisanie to full range
  const isFullRangeAssignment = useMemo(
    () => (startTime: string, endTime: string) => {
      const start = new Date(startTime).getTime();
      const end = new Date(endTime).getTime();
      const eventStart = timelineBounds.start.getTime();
      const eventEnd = timelineBounds.end.getTime();

      const tolerance = 60 * 1000; // 1 minuta tolerancji
      return Math.abs(start - eventStart) < tolerance && Math.abs(end - eventEnd) < tolerance;
    },
    [timelineBounds]
  );

  // Wykryj konflikty w przypisaniach zasobu
  const detectConflicts = (assignments: Assignment[]): boolean => {
    for (let i = 0; i < assignments.length; i++) {
      for (let j = i + 1; j < assignments.length; j++) {
        const a1Start = new Date(assignments[i].start_time).getTime();
        const a1End = new Date(assignments[i].end_time).getTime();
        const a2Start = new Date(assignments[j].start_time).getTime();
        const a2End = new Date(assignments[j].end_time).getTime();

        // Check overlap
        if ((a1Start < a2End && a1End > a2Start) || (a2Start < a1End && a2End > a1Start)) {
          return true;
        }
      }
    }
    return false;
  };

  // Callbacks for assignment actions (to be implemented by parent)
  const handleEditAssignment = (assignment: Assignment) => {
    console.log('[ResourceTimeline] Edit assignment:', assignment);
    // TODO: Show edit modal
  };

  const handleDeleteAssignment = (assignment: Assignment) => {
    console.log('[ResourceTimeline] Delete assignment:', assignment);
    // TODO: Call delete API
  };

  const handleDuplicateAssignment = (assignment: Assignment) => {
    console.log('[ResourceTimeline] Duplicate assignment:', assignment);
    // TODO: Call create API with same data
  };

  const handleAssignmentDragEnd = (assignment: Assignment, newStart: Date, newEnd: Date) => {
    console.log('[ResourceTimeline] Assignment drag ended:', {
      assignment,
      newStart,
      newEnd,
    });
    // TODO: Call update API
  };

  // Stwórz wiersze dla pracowników
  const employeeRows: ResourceRow[] = useMemo(() => {
    console.log('[ResourceTimeline] Processing employees:', {
      employeesCount: employees.length,
      phaseAssignmentsCount: phaseAssignments.length,
      phaseAssignments: phaseAssignments.map(pa => ({
        phaseId: pa.phase.id,
        phaseName: pa.phase.name,
        assignmentsCount: pa.assignments.length,
        assignments: pa.assignments,
      })),
    });

    return employees.map(emp => {
      const assignments = phaseAssignments
        .flatMap(({ phase, assignments }) => {
          const assignment = assignments.find((a: any) => a.employee_id === emp.id);
          if (!assignment) return [];

          // Pomiń koordynatora - chyba że ma dodatkową konkretną rolę zasobową
          if (assignment.role === 'coordinator' || assignment.role === 'lead') {
            console.log(`[ResourceTimeline] Skipping ${emp.name} - role: ${assignment.role}`);
            return [];
          }

          const startTime = assignment.assignment_start || phase.start_time;
          const endTime = assignment.assignment_end || phase.end_time;
          return [{
            id: assignment.id,
            phase,
            phaseId: phase.id,
            resourceId: emp.id,
            resourceType: 'employee' as ResourceType,
            start_time: startTime,
            end_time: endTime,
            role: assignment.role,
            isFullRange: isFullRangeAssignment(startTime, endTime),
          }];
        })
        .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());

      const hasConflicts = detectConflicts(assignments);
      console.log(`[ResourceTimeline] Employee ${emp.name}: ${assignments.length} assignments, conflicts: ${hasConflicts}`);

      return {
        id: emp.id,
        type: 'employee' as ResourceType,
        name: `${emp.name} ${emp.surname}`,
        avatar_url: emp.avatar_url,
        assignments,
        hasConflicts,
      };
    });
  }, [employees, phaseAssignments, isFullRangeAssignment]);

  // Stwórz wiersze dla pojazdów
  const vehicleRows: ResourceRow[] = useMemo(() => {
    return vehicles.map(veh => {
      const vehicle = veh.vehicle || veh;
      const assignments = phaseAssignments
        .flatMap(({ phase, vehicleAssignments }) => {
          const assignment = vehicleAssignments.find((v: any) => v.vehicle_id === vehicle.id);
          if (!assignment) return [];
          const startTime = assignment.assigned_start || phase.start_time;
          const endTime = assignment.assigned_end || phase.end_time;
          return [{
            phase,
            start_time: startTime,
            end_time: endTime,
            isFullRange: isFullRangeAssignment(startTime, endTime),
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
  }, [vehicles, phaseAssignments, isFullRangeAssignment]);

  // Stwórz wiersze dla sprzętu
  const equipmentRows: ResourceRow[] = useMemo(() => {
    const equipmentMap = new Map<string, ResourceRow>();

    equipment.forEach((item: any) => {
      const equipmentItem = item.equipment_items || item;
      const itemId = equipmentItem.id;

      if (!equipmentMap.has(itemId)) {
        equipmentMap.set(itemId, {
          id: itemId,
          type: 'equipment' as ResourceType,
          name: equipmentItem.name || 'Bez nazwy',
          category: equipmentItem.equipment_categories?.name,
          assignments: [],
        });
      }

      // Dodaj przypisania z faz
      phaseAssignments.forEach(({ phase, equipmentAssignments }) => {
        const assignment = equipmentAssignments.find((e: any) =>
          e.equipment_item_id === itemId || e.kit_id === itemId
        );
        if (assignment) {
          const row = equipmentMap.get(itemId)!;
          const startTime = phase.start_time;
          const endTime = phase.end_time;
          row.assignments.push({
            phase,
            start_time: startTime,
            end_time: endTime,
            quantity: assignment.quantity,
            isFullRange: isFullRangeAssignment(startTime, endTime),
          });
        }
      });
    });

    return Array.from(equipmentMap.values())
      .filter(row => row.assignments.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [equipment, phaseAssignments, isFullRangeAssignment]);

  // Filtruj zasoby według kryteriów
  const filterResources = (rows: ResourceRow[]): ResourceRow[] => {
    return rows.filter(row => {
      // Filtr: tylko przypisane
      if (showOnlyAssigned && row.assignments.length === 0) return false;

      // Filtr: tylko konflikty
      if (showOnlyConflicts && !row.hasConflicts) return false;

      // Filtr: ukryj full-range
      if (hideFullRange) {
        const hasNonFullRange = row.assignments.some(a => !a.isFullRange);
        if (!hasNonFullRange) return false;
      }

      // Wyszukiwanie
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return row.name.toLowerCase().includes(query);
      }

      return true;
    });
  };

  const filteredEmployees = filterResources(employeeRows.filter(row => row.assignments.length > 0));
  const filteredVehicles = filterResources(vehicleRows.filter(row => row.assignments.length > 0));
  const filteredEquipment = filterResources(equipmentRows);

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

    let Icon = Package;
    if (resource.type === 'employee') Icon = User;
    if (resource.type === 'vehicle') Icon = Car;

    // Sprawdź czy wszystkie przypisania to full range
    const allFullRange = resource.assignments.every(a => a.isFullRange);

    return (
      <div key={resource.id} className="relative border-b border-[#d3bb73]/10">
        {/* Resource Label */}
        <div
          className="flex items-center gap-2 border-r border-[#d3bb73]/10 bg-[#1c1f33]/50 px-3 transition-colors hover:bg-[#1c1f33]/80"
          style={{ height: `${heightPx}px`, width: '280px', position: 'absolute', left: 0, zIndex: 10 }}
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
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-medium text-[#e5e4e2]">{resource.name}</p>
              {allFullRange && resource.assignments.length === 1 && (
                <span className="rounded bg-green-500/20 px-1.5 py-0.5 text-[10px] font-medium text-green-400">
                  Full
                </span>
              )}
            </div>
            {resource.category && (
              <p className="truncate text-xs text-[#e5e4e2]/50">{resource.category}</p>
            )}
            {resource.type === 'equipment' && resource.assignments.length > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowEquipmentDetails(showEquipmentDetails === resource.id ? null : resource.id);
                }}
                className="mt-1 flex items-center gap-1 text-xs text-[#d3bb73] hover:underline"
              >
                <Info className="h-3 w-3" />
                <span>Zobacz detale</span>
              </button>
            )}
          </div>
        </div>

        {/* Timeline Row */}
        <div
          className="relative"
          style={{ height: `${heightPx}px`, paddingLeft: '280px' }}
        >
          {resource.assignments.map((assignment, idx) => {
            const position = getAssignmentPosition(assignment.start_time, assignment.end_time);
            const phaseColor = assignment.phase.color || assignment.phase.phase_type?.color || '#3b82f6';

            return (
              <div
                key={idx}
                className="absolute flex items-center rounded border-l-4 px-2 shadow transition-all hover:shadow-lg"
                style={{
                  top: '4px',
                  bottom: '4px',
                  left: position.left,
                  width: position.width,
                  backgroundColor: assignment.isFullRange ? `${phaseColor}20` : `${phaseColor}30`,
                  borderLeftColor: phaseColor,
                  borderLeftWidth: assignment.isFullRange ? '2px' : '4px',
                }}
              >
                <div className="flex-1 overflow-hidden">
                  {!assignment.isFullRange && (
                    <p className="truncate text-xs font-semibold text-[#e5e4e2]">
                      {assignment.phase.name}
                    </p>
                  )}
                  {isExpanded && !assignment.isFullRange && (
                    <p className="truncate text-xs text-[#e5e4e2]/70">
                      {formatTime(assignment.start_time)} - {formatTime(assignment.end_time)}
                    </p>
                  )}
                  {assignment.role && isExpanded && (
                    <p className="truncate text-xs text-[#e5e4e2]/50">{assignment.role}</p>
                  )}
                  {assignment.quantity && assignment.quantity > 1 && (
                    <span className="ml-1 rounded bg-[#d3bb73]/30 px-1.5 py-0.5 text-[10px] font-bold text-[#d3bb73]">
                      x{assignment.quantity}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Equipment Details Modal */}
        {showEquipmentDetails === resource.id && resource.type === 'equipment' && (
          <div className="absolute left-[280px] top-full z-50 mt-1 w-80 rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] p-4 shadow-xl">
            <h4 className="mb-2 text-sm font-semibold text-[#e5e4e2]">Zablokowany w fazach:</h4>
            <ul className="space-y-2">
              {resource.assignments.map((assignment, idx) => (
                <li key={idx} className="text-xs text-[#e5e4e2]/70">
                  <div className="flex items-center gap-2">
                    <div
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: assignment.phase.color || '#3b82f6' }}
                    />
                    <span className="font-medium">{assignment.phase.name}</span>
                  </div>
                  <div className="ml-4 mt-1 text-[#e5e4e2]/50">
                    {formatTime(assignment.start_time)} - {formatTime(assignment.end_time)}
                    {assignment.quantity && assignment.quantity > 1 && (
                      <span className="ml-2 text-[#d3bb73]">Ilość: {assignment.quantity}</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  };

  if (activeEmployees.length === 0 && activeVehicles.length === 0 && activeEquipment.length === 0) {
    return null;
  }

  return (
    <div className="relative">
      {/* Controls */}
      <div className="mb-3 flex items-center justify-between px-6">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-[#e5e4e2]/70">
          Zasoby Wydarzenia
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[#e5e4e2]/50">Wysokość:</span>
          <div className="flex gap-1 rounded-lg bg-[#1c1f33] p-1">
            <button
              onClick={() => setRowHeight('compact')}
              className={`rounded px-2 py-1 text-xs transition-colors ${
                rowHeight === 'compact'
                  ? 'bg-[#d3bb73] text-[#1c1f33]'
                  : 'text-[#e5e4e2]/70 hover:bg-[#d3bb73]/20'
              }`}
            >
              S
            </button>
            <button
              onClick={() => setRowHeight('normal')}
              className={`rounded px-2 py-1 text-xs transition-colors ${
                rowHeight === 'normal'
                  ? 'bg-[#d3bb73] text-[#1c1f33]'
                  : 'text-[#e5e4e2]/70 hover:bg-[#d3bb73]/20'
              }`}
            >
              M
            </button>
            <button
              onClick={() => setRowHeight('expanded')}
              className={`rounded px-2 py-1 text-xs transition-colors ${
                rowHeight === 'expanded'
                  ? 'bg-[#d3bb73] text-[#1c1f33]'
                  : 'text-[#e5e4e2]/70 hover:bg-[#d3bb73]/20'
              }`}
            >
              L
            </button>
          </div>
        </div>
      </div>

      {/* Resources */}
      <div className="relative">
        {/* Employees */}
        {activeEmployees.map((employee, index) => renderResourceRow(employee, index))}

        {/* Vehicles */}
        {activeVehicles.map((vehicle, index) => renderResourceRow(vehicle, index + activeEmployees.length))}

        {/* Equipment */}
        {activeEquipment.map((equip, index) =>
          renderResourceRow(equip, index + activeEmployees.length + activeVehicles.length)
        )}
      </div>
    </div>
  );
};
