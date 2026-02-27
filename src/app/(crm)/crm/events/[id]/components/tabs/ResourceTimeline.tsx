/* eslint-disable react-hooks/exhaustive-deps */
'use client';

import React, { useState, useMemo, useCallback, memo, useRef, useEffect } from 'react';
import Image from 'next/image';
import { Trash2, GripVertical, Save, X } from 'lucide-react';
import {
  EventPhase,
  useDeletePhaseAssignmentMutation,
  useUpdatePhaseAssignmentMutation,
  useUpdatePhaseVehicleMutation,
  useUpdatePhaseEquipmentMutation,
} from '@/store/api/eventPhasesApi';
import { PhaseAssignmentsData } from './PhaseAssignmentsLoader';
import { useTimelineDrag } from './useTimelineDrag';
import { useSnackbar } from '@/contexts/SnackbarContext';

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
  focusedAssignment: string | null;
  formatTime: (date: string) => string;
  timelineBounds: { start: Date; end: Date };
  zoomLevel: 'days' | 'hours' | 'minutes';
  onHoverChange: (id: string | null) => void;
  onFocusChange: (id: string | null) => void;
  onDelete: (assignmentId: string, phaseId: string) => void;
  onTimeUpdate: (assignmentId: string, newStart: Date, newEnd: Date, originalStart: string, originalEnd: string, resourceType: 'employee' | 'vehicle' | 'equipment') => void;
  onContextMenu?: (e: React.MouseEvent, assignment: Assignment, resource: ResourceRow) => void;
  containerRef?: React.RefObject<HTMLDivElement>;
  editedTimes?: { start: Date; end: Date } | null; // Tymczasowe czasy z edycji
  resourceType: 'employee' | 'vehicle' | 'equipment';
}

const AssignmentBar = memo<AssignmentBarProps>(({
  assignment,
  resource,
  position,
  phaseColor,
  heightPx,
  isEmployee,
  hoveredAssignment,
  focusedAssignment,
  formatTime,
  timelineBounds,
  zoomLevel,
  onHoverChange,
  onFocusChange,
  onDelete,
  onTimeUpdate,
  onContextMenu,
  containerRef,
  editedTimes,
  resourceType,
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
        onTimeUpdate(assignment.id, newStart, newEnd, assignment.start_time, assignment.end_time, resourceType);
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
  const isFocused = focusedAssignment === assignment.id;
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

  // Zwiększona wysokość podczas drag lub edycji (ale nie focusu)
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

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    // Kliknięcie ustawia focus na to przypisanie
    onFocusChange(assignment.id ?? null);
  }, [onFocusChange, assignment.id]);

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
        zIndex: isDragging ? 100 : isFocused ? 90 : 'auto',
        boxShadow: isDragging ? '0 4px 12px rgba(211, 187, 115, 0.3)' : undefined,
      }}
      title={`${resource.name}\n${formatTime(displayStartTime)} - ${formatTime(
        displayEndTime,
      )}${assignment.role ? `\nRola: ${assignment.role}` : ''}${editedTimes ? '\n[EDYCJA]' : ''}`}
      onClick={handleClick}
      onMouseEnter={() => onHoverChange(assignment.id ?? null)}
      onMouseLeave={() => onHoverChange(null)}
      onContextMenu={(e) => {
        if (onContextMenu) {
          e.preventDefault();
          onContextMenu(e, assignment, resource);
        }
      }}
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
  resourceType: 'employee' | 'vehicle' | 'equipment'; // Typ zasobu
  status: 'dirty' | 'saving';
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
  const [rowHeight, setRowHeight] = useState<'compact' | 'normal' | 'expanded'>('compact');
  const [hoveredAssignment, setHoveredAssignment] = useState<string | null>(null);
  const [focusedAssignment, setFocusedAssignment] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    assignment: Assignment;
    resource: ResourceRow;
  } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const { showSnackbar } = useSnackbar();
  // Mutations
  const [deleteAssignment] = useDeletePhaseAssignmentMutation();
  const [updateAssignment, { isLoading: isUpdatingEmployee }] = useUpdatePhaseAssignmentMutation();
  const [updateVehicle, { isLoading: isUpdatingVehicle }] = useUpdatePhaseVehicleMutation();
  const [updateEquipment, { isLoading: isUpdatingEquipment }] = useUpdatePhaseEquipmentMutation();

  const isUpdating = isUpdatingEmployee || isUpdatingVehicle || isUpdatingEquipment;

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

  // Funkcja wykrywająca nakładające się przypisania pracownika
  const detectOverlaps = useCallback((assignments: Assignment[]) => {
    const overlaps: Array<{
      start: Date;
      end: Date;
      assignments: Assignment[];
    }> = [];

    for (let i = 0; i < assignments.length; i++) {
      for (let j = i + 1; j < assignments.length; j++) {
        const a1 = assignments[i];
        const a2 = assignments[j];

        const start1 = new Date(a1.start_time);
        const end1 = new Date(a1.end_time);
        const start2 = new Date(a2.start_time);
        const end2 = new Date(a2.end_time);

        // Sprawdź czy nakładają się
        const overlapStart = new Date(Math.max(start1.getTime(), start2.getTime()));
        const overlapEnd = new Date(Math.min(end1.getTime(), end2.getTime()));

        if (overlapStart < overlapEnd) {
          overlaps.push({
            start: overlapStart,
            end: overlapEnd,
            assignments: [a1, a2],
          });
        }
      }
    }

    return overlaps;
  }, []);

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
  const handleTimeUpdate = useCallback((
    assignmentId: string,
    newStart: Date,
    newEnd: Date,
    originalStart: string,
    originalEnd: string,
    resourceType: 'employee' | 'vehicle' | 'equipment'
  ) => {
    setEditState({
      assignmentId,
      originalStart,
      originalEnd,
      newStart,
      newEnd,
      resourceType,
      status: 'dirty',
    });
  }, []);

  // Zapisz zmiany
  const handleSaveChanges = useCallback(async () => {
    setEditState({ ...editState, status: 'saving' });
    if (!editState) return;

    try {
      let result;

      // Użyj odpowiedniej mutacji w zależności od typu zasobu
      if (editState.resourceType === 'employee') {
        result = await updateAssignment({
          id: editState.assignmentId,
          assignment_start: editState.newStart.toISOString(),
          assignment_end: editState.newEnd.toISOString(),
          // WAŻNE: Aktualizuj też phase_work aby constraint był spełniony
          phase_work_start: editState.newStart.toISOString(),
          phase_work_end: editState.newEnd.toISOString(),
        }).unwrap();
      } else if (editState.resourceType === 'vehicle') {
        result = await updateVehicle({
          id: editState.assignmentId,
          assigned_start: editState.newStart.toISOString(),
          assigned_end: editState.newEnd.toISOString(),
        }).unwrap();
      } else if (editState.resourceType === 'equipment') {
        result = await updateEquipment({
          id: editState.assignmentId,
          assigned_start: editState.newStart.toISOString(),
          assigned_end: editState.newEnd.toISOString(),
        }).unwrap();
      }

      showSnackbar('Zmiany zapisane pomyślnie', 'success');
      // NIE czyścimy editState tutaj - poczekaj aż dane się odświeżą z API
      // editState zostanie wyczyszczony przez useEffect poniżej
    } catch (error: any) {
      console.error('❌ Failed to update assignment:', error);
      console.error('Error details:', {
        message: error?.message,
        status: error?.status,
        data: error?.data,
        originalStatus: error?.originalStatus,
      });

      const errorMsg = error?.data?.message || error?.message || 'Nie udało się zaktualizować czasu';
      alert(`Błąd: ${errorMsg}`);

      showSnackbar('Błąd podczas zapisywania zmian', 'error');
    }
  }, [editState, updateAssignment, updateVehicle, updateEquipment]);

  // Odrzuć zmiany
  const handleDiscardChanges = useCallback(() => {
    setEditState(null);
    setFocusedAssignment(null); // Resetuj focus przy odrzuceniu zmian
    showSnackbar('Zmiany odrzucone', 'info');
  }, []);

  // Auto-clear editState gdy dane z API się zaktualizują
  const getApiTimes = (a: any, type: EditState['resourceType']) => {
    if (type === 'employee') {
      return { start: a.assignment_start, end: a.assignment_end };
    }
    // vehicle + equipment
    return { start: a.assigned_start, end: a.assigned_end };
  };

  useEffect(() => {
    if (!editState) return;
  
    const currentAssignment = phaseAssignments
      .flatMap(p => [
        ...(p.assignments || []),
        ...(p.vehicleAssignments || []),
        ...(p.equipmentAssignments || []),
      ])
      .find((a: any) => a.id === editState.assignmentId);
  
    if (!currentAssignment) return;
  
    const getApiTimes = (a: any) => {
      if (editState.resourceType === 'employee') {
        return {
          start: a.assignment_start ?? a.phase_work_start ?? a.start_time,
          end: a.assignment_end ?? a.phase_work_end ?? a.end_time,
        };
      }
      // vehicle / equipment
      return {
        start: a.assigned_start ?? a.start_time,
        end: a.assigned_end ?? a.end_time,
      };
    };
  
    const api = getApiTimes(currentAssignment);
    if (!api.start || !api.end) return;
  
    const apiStart = new Date(api.start).getTime();
    const apiEnd = new Date(api.end).getTime();
  
    const editedStart = editState.newStart.getTime();
    const editedEnd = editState.newEnd.getTime();
  
    const tolerance = 1000;
  
    if (Math.abs(apiStart - editedStart) < tolerance && Math.abs(apiEnd - editedEnd) < tolerance) {
      setEditState(null);
      setFocusedAssignment(null); // Resetuj focus po zapisaniu
      showSnackbar('Zmiany zapisane pomyślnie', 'success');
    }
  }, [editState, phaseAssignments, showSnackbar]);

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

  // Zamykanie menu kontekstowego przy kliknięciu
  useEffect(() => {
    if (!contextMenu) return;

    const handleClick = () => setContextMenu(null);
    const handleScroll = () => setContextMenu(null);

    window.addEventListener('click', handleClick);
    window.addEventListener('scroll', handleScroll, true);

    return () => {
      window.removeEventListener('click', handleClick);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [contextMenu]);

  const handleHoverChange = useCallback((id: string | null) => {
    setHoveredAssignment(id);
  }, []);

  const handleFocusChange = useCallback((id: string | null) => {
    setFocusedAssignment(id);
  }, []);

  const formatTime = useCallback((date: string): string => {
    const d = new Date(date);
    if (zoomLevel === 'days') {
      return d.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' });
    }
    return d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
  }, [zoomLevel]);

  // Funkcja wyrównania przypisania do fazy
  const handleAlignToPhase = useCallback(async (assignment: Assignment) => {
    if (!assignment.id || !assignment.phase) {
      showSnackbar('Brak informacji o fazie', 'error');
      return;
    }

    const phaseStartTime = assignment.phase.start_time;
    const phaseEndTime = assignment.phase.end_time;

    // Aktualizuj przypisanie aby wyrównać do fazy
    try {
      if (assignment.resourceType === 'employee') {
        await updateAssignment({
          id: assignment.id,
          assignment_start: phaseStartTime,
          assignment_end: phaseEndTime,
        }).unwrap();
      } else if (assignment.resourceType === 'vehicle') {
        await updateVehicle({
          id: assignment.id,
          assigned_start: phaseStartTime,
          assigned_end: phaseEndTime,
        }).unwrap();
      } else if (assignment.resourceType === 'equipment') {
        await updateEquipment({
          id: assignment.id,
          assigned_start: phaseStartTime,
          assigned_end: phaseEndTime,
        }).unwrap();
      }

      showSnackbar('Przypisanie wyrównane do fazy', 'success');
    } catch (error: any) {
      console.error('Failed to align to phase:', error);
      showSnackbar(error?.message || 'Błąd podczas wyrównywania do fazy', 'error');
    }
  }, [updateAssignment, updateVehicle, updateEquipment, showSnackbar]);

  // Handler menu kontekstowego
  const handleContextMenu = useCallback((e: React.MouseEvent, assignment: Assignment, resource: ResourceRow) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      assignment,
      resource,
    });
  }, []);

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
    return vehicles.map((veh: any) => {
      // veh = rekord z event_vehicles
      // veh.vehicle = (opcjonalnie) zembedowany rekord z vehicles
      const vehicleObj = veh.vehicle ?? null;

      // ✅ NAJWAŻNIEJSZE: ID do matchowania musi być vehicle_id (z floty), nie id z event_vehicles
      const fleetVehicleId: string | null = veh.vehicle_id ?? vehicleObj?.id ?? null;

      // ✅ DLA POJAZDÓW: Tworzymy JEDNĄ CIĄGŁĄ LINIĘ od najwcześniejszej do najpóźniejszej fazy
      // Zbierz wszystkie przypisania z faz aby znaleźć zakres czasowy
      const allPhaseAssignments: { start: Date; end: Date; phase: any; id: string }[] = [];

      phaseAssignments.forEach(({ phase, vehicleAssignments }: any) => {
        const found = (vehicleAssignments ?? []).filter(
          (v: any) => v?.vehicle_id === fleetVehicleId
        );

        found.forEach((v: any) => {
          const startTime = v.assigned_start || phase.start_time;
          const endTime = v.assigned_end || phase.end_time;
          allPhaseAssignments.push({
            start: new Date(startTime),
            end: new Date(endTime),
            phase,
            id: v.id,
          });
        });
      });

      let assignments: Assignment[] = [];

      if (allPhaseAssignments.length > 0) {
        // Znajdź najwcześniejszy start i najpóźniejszy koniec
        const earliestStart = new Date(Math.min(...allPhaseAssignments.map(a => a.start.getTime())));
        const latestEnd = new Date(Math.max(...allPhaseAssignments.map(a => a.end.getTime())));

        // Utwórz JEDNO przypisanie obejmujące cały czas
        assignments = [{
          id: `vehicle_continuous_${veh.id}`,
          phase: allPhaseAssignments[0].phase, // używamy pierwszej fazy jako referencji
          phaseId: allPhaseAssignments[0].phase.id,
          resourceId: fleetVehicleId!,
          resourceType: 'vehicle',
          start_time: earliestStart.toISOString(),
          end_time: latestEnd.toISOString(),
          isFullRange: isFullRangeAssignment(earliestStart.toISOString(), latestEnd.toISOString()),
        }];
      }

      if (
        assignments.length === 0 &&
        // Fallback: jeśli to pojazd logistyczny z event_vehicles, a nie ma przypisań do faz
        veh.vehicle_available_from &&
        veh.vehicle_available_until &&
        fleetVehicleId
      ) {
        assignments = [{
          id: `event_vehicle_${veh.id}`,
          phase: null as any,
          phaseId: null as any,
          resourceId: fleetVehicleId,
          resourceType: 'vehicle',
          start_time: veh.vehicle_available_from,
          end_time: veh.vehicle_available_until,
          isFullRange: false,
        }];
      }

      // ✅ Nazwa do UI: najpierw z embed, potem fallback
      const displayName =
        vehicleObj?.name
          ? `${vehicleObj.name}${vehicleObj.registration_number ? ` (${vehicleObj.registration_number})` : ''}`
          : (veh.external_vehicle_name
              ? veh.external_vehicle_name
              : (veh.vehicle_id ? `Pojazd ${veh.vehicle_id.slice(0, 6)}…` : 'Bez nazwy'));

      return {
        id: fleetVehicleId ?? veh.id, // id wiersza
        type: 'vehicle',
        name: displayName,
        avatar_url: vehicleObj?.thumb_url ?? null,
        assignments,
      };
    });
  }, [vehicles, phaseAssignments, isFullRangeAssignment]);

  // =========================
  // EQUIPMENT
  // =========================
  const equipmentRows: ResourceRow[] = useMemo(() => {

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

    // Wykryj nakładające się przypisania tylko dla pracowników
    const overlaps = isEmployee ? detectOverlaps(resource.assignments) : [];

    return (
      <div key={resource.id} className="relative border-b border-[#d3bb73]/10 overflow-hidden">
        <div ref={containerRef} className="relative" style={{ height: `${heightPx}px` }}>
          {/* Renderuj nakładające się obszary (kreskowany wzór) */}
          {overlaps.map((overlap, idx) => {
            const position = getAssignmentPosition(
              overlap.start.toISOString(),
              overlap.end.toISOString()
            );

            return (
              <div
                key={`overlap-${idx}`}
                className="absolute pointer-events-none z-50"
                style={{
                  left: position.left,
                  width: position.width,
                  top: 0,
                  height: '100%',
                  background: 'repeating-linear-gradient(45deg, #ef4444 0px, #ef4444 4px, transparent 4px, transparent 8px)',
                  opacity: 0.5,
                  borderLeft: '2px solid #ef4444',
                  borderRight: '2px solid #ef4444',
                }}
                title={`Konflikt: ${overlap.assignments.length} przypisań w tym samym czasie`}
              />
            );
          })}

          {/* Renderuj wszystkie przypisania */}
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
                focusedAssignment={focusedAssignment}
                formatTime={formatTime}
                timelineBounds={timelineBounds}
                zoomLevel={zoomLevel}
                onHoverChange={handleHoverChange}
                onFocusChange={handleFocusChange}
                onDelete={handleDeleteEmployeeAssignment}
                onTimeUpdate={handleTimeUpdate}
                onContextMenu={handleContextMenu}
                containerRef={containerRef}
                editedTimes={
                  editState?.assignmentId === assignment.id
                    ? { start: editState.newStart, end: editState.newEnd }
                    : null
                }
                resourceType={assignment.resourceType || resource.type}
              />
            );
          })}
        </div>
      </div>
    );
  }, [
    heightPx,
    hoveredAssignment,
    focusedAssignment,
    formatTime,
    timelineBounds,
    zoomLevel,
    handleHoverChange,
    handleFocusChange,
    handleDeleteEmployeeAssignment,
    handleTimeUpdate,
    handleContextMenu,
    getAssignmentPosition,
    editState,
    detectOverlaps,
  ]);

  if (filteredEmployees.length === 0 && filteredVehicles.length === 0 && filteredEquipment.length === 0) {
    return null;
  }

  return (
    <div className="relative">
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
      {/* Przyciski akcji - pokazują się gdy jest editState */}
      {editState?.status === 'dirty' && (
        <ActionButtons
          onSave={handleSaveChanges}
          onDiscard={handleDiscardChanges}
          isLoading={isUpdating}
        />
      )}

      <div className="mb-3 flex items-center justify-between px-6">
        
      </div>

      <div
        className="relative"
        onClick={(e) => {
          // Kliknięcie w tło usuwa focus
          if (e.target === e.currentTarget) {
            setFocusedAssignment(null);
          }
        }}
      >
        {filteredEmployees.map(renderResourceRow)}
        <h3 className="text-sm font-semibold uppercase tracking-wide text-[#e5e4e2]/70 mt-2">
          Pojazdy
        </h3>
        {filteredVehicles.map(renderResourceRow)}
        {filteredEquipment.map(renderResourceRow)}
      </div>

      {/* Menu kontekstowe */}
      {contextMenu && (
        <div
          className="fixed z-[9999] rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] shadow-xl"
          style={{
            left: `${contextMenu.x}px`,
            top: `${contextMenu.y}px`,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="py-1">
            {contextMenu.assignment.phase && (
              <button
                onClick={() => {
                  handleAlignToPhase(contextMenu.assignment);
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-3 px-4 py-2 text-sm text-[#e5e4e2] transition-colors hover:bg-[#d3bb73]/20"
              >
                <span>🎯</span>
                <div className="flex flex-col items-start">
                  <span className="font-medium">Wyrównaj do fazy</span>
                  <span className="text-xs text-[#e5e4e2]/60">
                    {contextMenu.assignment.phase.name}
                  </span>
                </div>
              </button>
            )}

            {/* Separator */}
            {contextMenu.assignment.phase && (
              <div className="my-1 h-px bg-[#d3bb73]/10" />
            )}

            {/* Przycisk usuń */}
            {contextMenu.assignment.id && contextMenu.assignment.phaseId && (
              <button
                onClick={() => {
                  if (confirm(`Czy na pewno chcesz usunąć przypisanie: ${contextMenu.resource.name}?`)) {
                    handleDeleteEmployeeAssignment(contextMenu.assignment.id!, contextMenu.assignment.phaseId!);
                    setContextMenu(null);
                  }
                }}
                className="flex w-full items-center gap-3 px-4 py-2 text-sm text-red-400 transition-colors hover:bg-red-500/20"
              >
                <Trash2 className="h-4 w-4" />
                <span className="font-medium">Usuń przypisanie</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};