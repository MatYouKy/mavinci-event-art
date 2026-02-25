'use client';

import React, { useState, useMemo, useCallback, memo, useRef, useEffect } from 'react';
import Image from 'next/image';
import { Trash2, GripVertical, Save, X } from 'lucide-react';
import { EventPhase, useDeletePhaseAssignmentMutation, useUpdatePhaseAssignmentMutation } from '@/store/api/eventPhasesApi';
import { PhaseAssignmentsData } from './PhaseAssignmentsLoader';
import { useTimelineDrag } from './useTimelineDrag';

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

const getInitials = (name: string) =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join('');

// ============================================
// PODKOMPONENTY - zmemoizowane
// ============================================

// Przyciski akcji - zapisz/odrzuć
interface ActionButtonsProps {
  onSave: () => void;
  onDiscard: () => void;
  isLoading?: boolean;
}

const ActionButtons = memo<ActionButtonsProps>(({ onSave, onDiscard, isLoading }) => (
  <div className="absolute top-4 right-4 z-50 flex gap-2 animate-in fade-in slide-in-from-top-2 duration-200">
    <button
      onClick={onSave}
      disabled={isLoading}
      className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-semibold text-[#1a1a1a] shadow-lg transition-all hover:bg-[#e5cd85] hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
      title="Zapisz zmiany (Enter)"
    >
      <Save className="h-4 w-4" />
      Zapisz zmiany
    </button>
    <button
      onClick={onDiscard}
      disabled={isLoading}
      className="flex items-center gap-2 rounded-lg bg-red-500/90 px-4 py-2 text-sm font-semibold text-white shadow-lg transition-all hover:bg-red-600 hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
      title="Odrzuć zmiany (Esc)"
    >
      <X className="h-4 w-4" />
      Odrzuć
    </button>
  </div>
));
ActionButtons.displayName = 'ActionButtons';

// Avatar komponent
const ResourceAvatar = memo<{ avatar_url?: string; name: string }>(({ avatar_url, name }) => {
  if (avatar_url) {
    return (
      <Image
        src={avatar_url}
        alt={name}
        width={24}
        height={24}
        className="h-6 w-6 rounded-full object-cover"
      />
    );
  }
  return (
    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#d3bb73]/25 text-[10px] font-bold text-[#d3bb73]">
      {getInitials(name)}
    </div>
  );
});
ResourceAvatar.displayName = 'ResourceAvatar';

// Resize Handle komponent
const ResizeHandle = memo<{
  side: 'left' | 'right';
  onMouseDown: (e: React.MouseEvent) => void;
}>(({ side, onMouseDown }) => (
  <div
    className={`${side === 'left' ? 'absolute left-0 top-0 bottom-0' : ''} w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 hover:bg-[#d3bb73]/40 flex items-center justify-center ${side === 'right' ? 'h-full' : ''}`}
    onMouseDown={onMouseDown}
  >
    <GripVertical className="h-3 w-3 text-[#d3bb73]" />
  </div>
));
ResizeHandle.displayName = 'ResizeHandle';

// Delete Button komponent
const DeleteButton = memo<{ onClick: (e: React.MouseEvent) => void }>(({ onClick }) => (
  <button
    onClick={onClick}
    className="opacity-0 group-hover:opacity-100 transition-opacity rounded p-1 hover:bg-red-500/20 text-red-400"
    title="Usuń z fazy"
  >
    <Trash2 className="h-3 w-3" />
  </button>
));
DeleteButton.displayName = 'DeleteButton';

// ============================================
// GŁÓWNY ASSIGNMENT BAR
// ============================================
interface AssignmentBarProps {
  assignment: Assignment;
  resource: ResourceRow;
  position: { left: string; width: string };
  phaseColor: string;
  heightPx: number;
  isEmployee: boolean;
  hoveredAssignment: string | null;
  formatTime: (date: string) => string;
  timelineBounds: { start: Date; end: Date };
  zoomLevel: 'days' | 'hours' | 'minutes';
  onHoverChange: (id: string | null) => void;
  onDelete: (assignmentId: string, phaseId: string) => void;
  onTimeUpdate: (assignmentId: string, newStart: Date, newEnd: Date, originalStart: string, originalEnd: string) => void;
  containerRef?: React.RefObject<HTMLDivElement>;
  editedTimes?: { start: Date; end: Date } | null; // Tymczasowe czasy z edycji
}

const AssignmentBar = memo<AssignmentBarProps>(({
  assignment,
  resource,
  position,
  phaseColor,
  heightPx,
  isEmployee,
  hoveredAssignment,
  formatTime,
  timelineBounds,
  zoomLevel,
  onHoverChange,
  onDelete,
  onTimeUpdate,
  containerRef,
  editedTimes,
}) => {
  const barRef = useRef<HTMLDivElement>(null);
  const [dragPreview, setDragPreview] = useState<{ left: string; width: string } | null>(null);

  // Użyj editedTimes jeśli dostępne, w przeciwnym razie oryginalne czasy
  const displayStartTime = editedTimes ? editedTimes.start.toISOString() : assignment.start_time;
  const displayEndTime = editedTimes ? editedTimes.end.toISOString() : assignment.end_time;

  const { dragMode, startDrag } = useTimelineDrag({
    timelineBounds,
    zoomLevel,
    onDragEnd: (newStart, newEnd) => {
      if (assignment.id) {
        onTimeUpdate(assignment.id, newStart, newEnd, assignment.start_time, assignment.end_time);
      }
      setDragPreview(null);
    },
  });

  // Live preview podczas drag - sprawdzaj atrybuty data-* na containerze
  useEffect(() => {
    if (!dragMode || !containerRef?.current) return;

    const interval = setInterval(() => {
      const container = containerRef.current;
      if (!container) return;

      const dragStart = container.getAttribute('data-drag-start');
      const dragEnd = container.getAttribute('data-drag-end');

      if (dragStart && dragEnd) {
        const start = new Date(dragStart).getTime();
        const end = new Date(dragEnd).getTime();
        const totalDuration = timelineBounds.end.getTime() - timelineBounds.start.getTime();
        const left = ((start - timelineBounds.start.getTime()) / totalDuration) * 100;
        const width = ((end - start) / totalDuration) * 100;

        setDragPreview({
          left: `${Math.max(0, left)}%`,
          width: `${Math.max(1, width)}%`,
        });
      }
    }, 16); // ~60fps

    return () => clearInterval(interval);
  }, [dragMode, containerRef, timelineBounds]);

  const isHovered = hoveredAssignment === assignment.id;
  const isDragging = !!dragMode;

  // Jeśli są editedTimes, przelicz pozycję na ich podstawie
  const displayPosition = useMemo(() => {
    if (!editedTimes) return position;

    const start = editedTimes.start.getTime();
    const end = editedTimes.end.getTime();
    const totalDuration = timelineBounds.end.getTime() - timelineBounds.start.getTime();
    const left = ((start - timelineBounds.start.getTime()) / totalDuration) * 100;
    const width = ((end - start) / totalDuration) * 100;

    return {
      left: `${Math.max(0, left)}%`,
      width: `${Math.max(1, width)}%`,
    };
  }, [editedTimes, position, timelineBounds]);

  const currentPosition = dragPreview || displayPosition;

  // Zwiększona wysokość podczas drag lub edycji
  const barHeight = (isDragging || editedTimes) ? heightPx * 1.2 : heightPx - 12;

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (containerRef?.current) {
      startDrag(
        'resize-start',
        e.clientX,
        new Date(displayStartTime),
        new Date(displayEndTime),
        containerRef.current
      );
    }
  }, [startDrag, displayStartTime, displayEndTime, containerRef]);

  const handleResizeEnd = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (containerRef?.current) {
      startDrag(
        'resize-end',
        e.clientX,
        new Date(displayStartTime),
        new Date(displayEndTime),
        containerRef.current
      );
    }
  }, [startDrag, displayStartTime, displayEndTime, containerRef]);

  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete(assignment.id!, assignment.phaseId!);
  }, [onDelete, assignment.id, assignment.phaseId]);

  return (
    <div
      ref={barRef}
      className="group absolute flex items-center justify-between rounded border-l-4 px-3 shadow-sm transition-all hover:shadow-lg cursor-pointer"
      style={{
        top: `${(heightPx - barHeight) / 2}px`,
        height: `${barHeight}px`,
        left: currentPosition.left,
        width: currentPosition.width,
        backgroundColor: isDragging ? `${phaseColor}40` : `${phaseColor}25`,
        borderLeftColor: phaseColor,
        opacity: isDragging ? 0.9 : 1,
        transform: isDragging ? 'scale(1.02)' : 'scale(1)',
        zIndex: isDragging ? 100 : 'auto',
        boxShadow: isDragging ? '0 4px 12px rgba(211, 187, 115, 0.3)' : undefined,
      }}
      title={`${resource.name}\n${formatTime(displayStartTime)} - ${formatTime(
        displayEndTime,
      )}${assignment.role ? `\nRola: ${assignment.role}` : ''}${editedTimes ? '\n[EDYCJA]' : ''}`}
      onMouseEnter={() => onHoverChange(assignment.id ?? null)}
      onMouseLeave={() => onHoverChange(null)}
    >
      {/* Left resize handle - tylko dla pracowników */}
      {isEmployee && assignment.phaseId && containerRef?.current && (
        <ResizeHandle side="left" onMouseDown={handleResizeStart} />
      )}

      <div className="flex items-center gap-2 overflow-hidden flex-1">
        <ResourceAvatar avatar_url={resource.avatar_url} name={resource.name} />

        <span className="truncate text-xs font-semibold text-[#e5e4e2]">
          {resource.name}
        </span>

        {isEmployee && assignment.role && (
          <span className="truncate text-[10px] text-[#e5e4e2]/60">{assignment.role}</span>
        )}

        {assignment.quantity && assignment.quantity > 1 && (
          <span className="ml-1 rounded bg-[#d3bb73]/30 px-1.5 py-0.5 text-[10px] font-bold text-[#d3bb73]">
            x{assignment.quantity}
          </span>
        )}
      </div>

      {/* Right resize handle + Delete button */}
      {isEmployee && assignment.phaseId && containerRef?.current && (
        <div className="flex items-center gap-1">
          <DeleteButton onClick={handleDelete} />
          <ResizeHandle side="right" onMouseDown={handleResizeEnd} />
        </div>
      )}
    </div>
  );
});

AssignmentBar.displayName = 'AssignmentBar';

// Stan edycji dla assignment
interface EditState {
  assignmentId: string;
  originalStart: string;
  originalEnd: string;
  newStart: Date;
  newEnd: Date;
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
  const [rowHeight, setRowHeight] = useState<'compact' | 'normal' | 'expanded'>('normal');
  const [hoveredAssignment, setHoveredAssignment] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Mutations
  const [deleteAssignment] = useDeletePhaseAssignmentMutation();
  const [updateAssignment, { isLoading: isUpdating }] = useUpdatePhaseAssignmentMutation();

  console.log('vehicles', vehicles);
  console.log('equipment', equipment);

  const totalDuration = timelineBounds.end.getTime() - timelineBounds.start.getTime();

  const isFullRangeAssignment = useMemo(
    () => (startTime: string, endTime: string) => {
      const start = new Date(startTime).getTime();
      const end = new Date(endTime).getTime();
      const eventStart = timelineBounds.start.getTime();
      const eventEnd = timelineBounds.end.getTime();
      const tolerance = 60 * 1000;
      return Math.abs(start - eventStart) < tolerance && Math.abs(end - eventEnd) < tolerance;
    },
    [timelineBounds],
  );

  const getRowHeightPx = () => {
    switch (rowHeight) {
      case 'compact':
        return 40;
      case 'expanded':
        return 80;
      default:
        return 60;
    }
  };

  const heightPx = getRowHeightPx();

  const getAssignmentPosition = useCallback((startTime: string, endTime: string) => {
    const start = new Date(startTime).getTime();
    const end = new Date(endTime).getTime();
    const left = ((start - timelineBounds.start.getTime()) / totalDuration) * 100;
    const width = ((end - start) / totalDuration) * 100;
    return { left: `${Math.max(0, left)}%`, width: `${Math.max(1, width)}%` };
  }, [timelineBounds, totalDuration]);

  // Handlers for employee assignments - zmemoizowane
  const handleDeleteEmployeeAssignment = useCallback(async (assignmentId: string, phaseId: string) => {
    if (!confirm('Czy na pewno chcesz usunąć tego pracownika z fazy?')) return;

    try {
      await deleteAssignment({ id: assignmentId, phase_id: phaseId }).unwrap();
    } catch (error) {
      console.error('Failed to delete assignment:', error);
      alert('Nie udało się usunąć przypisania');
    }
  }, [deleteAssignment]);

  // Callback po drag - ustawia stan edycji
  const handleTimeUpdate = useCallback((assignmentId: string, newStart: Date, newEnd: Date, originalStart: string, originalEnd: string) => {
    setEditState({
      assignmentId,
      originalStart,
      originalEnd,
      newStart,
      newEnd,
    });
  }, []);

  // Zapisz zmiany
  const handleSaveChanges = useCallback(async () => {
    if (!editState) return;

    try {
      await updateAssignment({
        id: editState.assignmentId,
        assignment_start: editState.newStart.toISOString(),
        assignment_end: editState.newEnd.toISOString(),
      }).unwrap();
      setEditState(null);
    } catch (error) {
      console.error('Failed to update assignment:', error);
      alert('Nie udało się zaktualizować czasu');
    }
  }, [editState, updateAssignment]);

  // Odrzuć zmiany
  const handleDiscardChanges = useCallback(() => {
    setEditState(null);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    if (!editState) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !isUpdating) {
        e.preventDefault();
        handleSaveChanges();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleDiscardChanges();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editState, isUpdating, handleSaveChanges, handleDiscardChanges]);

  const handleHoverChange = useCallback((id: string | null) => {
    setHoveredAssignment(id);
  }, []);

  const formatTime = useCallback((date: string): string => {
    const d = new Date(date);
    if (zoomLevel === 'days') {
      return d.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' });
    }
    return d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
  }, [zoomLevel]);

  // =========================
  // EMPLOYEES
  // =========================
  const employeeRows: ResourceRow[] = useMemo(() => {
    const getEmployeeMatchId = (emp: any) => emp.auth_user_id ?? emp.user_id ?? emp.id;

    return employees.map((emp) => {
      const empMatchId = getEmployeeMatchId(emp);

      const assignments = phaseAssignments
        .flatMap(({ phase, assignments }) => {
          const matches = (assignments ?? []).filter((a: any) => a?.employee_id === empMatchId);
          if (matches.length === 0) return [];

          return matches
            .filter((a: any) => a?.role !== 'coordinator' && a?.role !== 'lead')
            .map((a: any) => {
              const startTime = a.assignment_start || phase.start_time;
              const endTime = a.assignment_end || phase.end_time;

              return {
                id: a.id,
                phase,
                phaseId: phase.id,
                resourceId: empMatchId,
                resourceType: 'employee' as ResourceType,
                start_time: startTime,
                end_time: endTime,
                role: a.role,
                isFullRange: isFullRangeAssignment(startTime, endTime),
              };
            });
        })
        .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());

      return {
        id: empMatchId,
        type: 'employee',
        name: `${emp.name} ${emp.surname}`,
        avatar_url: emp.avatar_url,
        assignments,
      };
    });
  }, [employees, phaseAssignments, isFullRangeAssignment]);

  // =========================
  // VEHICLES
  // =========================
  const vehicleRows: ResourceRow[] = useMemo(() => {
    console.log('[ResourceTimeline] Processing vehicles:', {
      vehiclesCount: vehicles.length,
      vehicles: vehicles.map(v => ({ id: v.id, registration: v.registration_number, vehicle: v.vehicle })),
      phaseAssignments: phaseAssignments.map(pa => ({
        phase: pa.phase.name,
        vehicleAssignmentsCount: pa.vehicleAssignments?.length || 0,
      })),
    });

    return vehicles.map((veh) => {
      const vehicle = veh.vehicle || veh;
      const vehicleId = vehicle?.id;

      // Pobierz przypisania z event_phase_vehicles (nowy system)
      const phaseAssignmentsList = phaseAssignments
        .flatMap(({ phase, vehicleAssignments }) => {
          const found = (vehicleAssignments ?? []).filter(
            (v: any) => v?.vehicle_id === vehicleId,
          );
          if (found.length === 0) return [];

          return found.map((v: any) => {
            const startTime = v.assigned_start || phase.start_time;
            const endTime = v.assigned_end || phase.end_time;

            return {
              id: v.id,
              phase,
              phaseId: phase.id,
              resourceId: vehicleId,
              resourceType: 'vehicle' as ResourceType,
              start_time: startTime,
              end_time: endTime,
              isFullRange: isFullRangeAssignment(startTime, endTime),
            };
          });
        });

      // Jeśli pojazd jest z event_vehicles (Logistyka) ale nie ma przypisań do faz,
      // pokaż go jako "dostępny na całe wydarzenie"
      if (phaseAssignmentsList.length === 0 && veh.vehicle_available_from && veh.vehicle_available_until) {
        // To jest pojazd z zakładki Logistyka - pokaż całą jego dostępność
        phaseAssignmentsList.push({
          id: veh.id, // event_vehicle id
          phase: null as any, // brak konkretnej fazy
          phaseId: null as any,
          resourceId: vehicleId,
          resourceType: 'vehicle' as ResourceType,
          start_time: veh.vehicle_available_from,
          end_time: veh.vehicle_available_until,
          isFullRange: false,
        });
      }

      const assignments = phaseAssignmentsList.sort((a, b) =>
        new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
      );

      return {
        id: vehicleId,
        type: 'vehicle',
        name: vehicle?.name || vehicle?.registration_number || 'Bez nazwy',
        avatar_url: vehicle?.avatar_url,
        assignments,
      };
    });
  }, [vehicles, phaseAssignments, isFullRangeAssignment]);

  // =========================
  // EQUIPMENT
  // =========================
  const equipmentRows: ResourceRow[] = useMemo(() => {
    console.log('[ResourceTimeline] Processing equipment:', {
      equipmentCount: equipment.length,
      equipment: equipment.map(e => ({ id: e.id, name: e.equipment_items?.name || e.name })),
      phaseAssignments: phaseAssignments.map(pa => ({
        phase: pa.phase.name,
        equipmentAssignmentsCount: pa.equipmentAssignments?.length || 0,
      })),
    });

    const equipmentMap = new Map<string, ResourceRow>();

    equipment.forEach((item: any) => {
      const equipmentItem = item.equipment_items || item;
      const itemId = equipmentItem?.id;
      if (!itemId) return;

      if (!equipmentMap.has(itemId)) {
        equipmentMap.set(itemId, {
          id: itemId,
          type: 'equipment',
          name: equipmentItem?.name || 'Bez nazwy',
          category: equipmentItem?.equipment_categories?.name,
          avatar_url: equipmentItem?.avatar_url, // jeśli masz
          assignments: [],
        });
      }

      phaseAssignments.forEach(({ phase, equipmentAssignments }) => {
        const matches = (equipmentAssignments ?? []).filter(
          (e: any) => e?.equipment_item_id === itemId || e?.kit_id === itemId,
        );
        if (matches.length === 0) return;

        const row = equipmentMap.get(itemId)!;

        matches.forEach((m: any) => {
          const startTime = m.assigned_start || phase.start_time;
          const endTime = m.assigned_end || phase.end_time;

          row.assignments.push({
            id: m.id,
            phase,
            phaseId: phase.id,
            resourceId: itemId,
            resourceType: 'equipment',
            start_time: startTime,
            end_time: endTime,
            quantity: m.quantity,
            isFullRange: isFullRangeAssignment(startTime, endTime),
          });
        });
      });
    });

    return Array.from(equipmentMap.values())
      .filter((row) => row.assignments.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [equipment, phaseAssignments, isFullRangeAssignment]);

  // pokazuj tylko z przypisaniami (jak wcześniej)
  const filteredEmployees = employeeRows.filter((r) => r.assignments.length > 0);
  const filteredVehicles = vehicleRows.filter((r) => r.assignments.length > 0);
  const filteredEquipment = equipmentRows.filter((r) => r.assignments.length > 0);

  const renderResourceRow = useCallback((resource: ResourceRow) => {
    const isEmployee = resource.type === 'employee';

    return (
      <div key={resource.id} className="relative border-b border-[#d3bb73]/10 overflow-hidden">
        <div ref={containerRef} className="relative" style={{ height: `${heightPx}px` }}>
          {resource.assignments.map((assignment, idx) => {
            const position = getAssignmentPosition(assignment.start_time, assignment.end_time);
            const phaseColor =
              assignment.phase?.color || assignment.phase?.phase_type?.color || '#3b82f6';

            return (
              <AssignmentBar
                key={assignment.id ?? idx}
                assignment={assignment}
                resource={resource}
                position={position}
                phaseColor={phaseColor}
                heightPx={heightPx}
                isEmployee={isEmployee}
                hoveredAssignment={hoveredAssignment}
                formatTime={formatTime}
                timelineBounds={timelineBounds}
                zoomLevel={zoomLevel}
                onHoverChange={handleHoverChange}
                onDelete={handleDeleteEmployeeAssignment}
                onTimeUpdate={handleTimeUpdate}
                containerRef={containerRef}
                editedTimes={
                  editState?.assignmentId === assignment.id
                    ? { start: editState.newStart, end: editState.newEnd }
                    : null
                }
              />
            );
          })}
        </div>
      </div>
    );
  }, [
    heightPx,
    hoveredAssignment,
    formatTime,
    timelineBounds,
    zoomLevel,
    handleHoverChange,
    handleDeleteEmployeeAssignment,
    handleTimeUpdate,
    getAssignmentPosition,
    editState,
  ]);

  if (filteredEmployees.length === 0 && filteredVehicles.length === 0 && filteredEquipment.length === 0) {
    return null;
  }

  return (
    <div className="relative">
      {/* Przyciski akcji - pokazują się gdy jest editState */}
      {editState && (
        <ActionButtons
          onSave={handleSaveChanges}
          onDiscard={handleDiscardChanges}
          isLoading={isUpdating}
        />
      )}

      <div className="mb-3 flex items-center justify-between px-6">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-[#e5e4e2]/70">
          Zasoby Wydarzenia
        </h3>

        <div className="flex items-center gap-2">
          <span className="text-xs text-[#e5e4e2]/50">Wysokość:</span>
          <div className="flex gap-1 rounded-lg bg-[#1c1f33] p-1">
            {(['compact', 'normal', 'expanded'] as const).map((size) => (
              <button
                key={size}
                onClick={() => setRowHeight(size)}
                className={`rounded px-2 py-1 text-xs ${
                  rowHeight === size
                    ? 'bg-[#d3bb73] text-[#1c1f33]'
                    : 'text-[#e5e4e2]/70 hover:bg-[#d3bb73]/20'
                }`}
              >
                {size === 'compact' ? 'S' : size === 'normal' ? 'M' : 'L'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="relative">
        {filteredEmployees.map(renderResourceRow)}
        {filteredVehicles.map(renderResourceRow)}
        {filteredEquipment.map(renderResourceRow)}
      </div>
    </div>
  );
};