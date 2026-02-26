'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { Plus, Filter, AlertCircle, Clock, ChevronDown, Save, RotateCcw } from 'lucide-react';
import {
  useGetEventPhasesQuery,
  useUpdatePhaseMutation,
  useDeletePhaseMutation,
  EventPhase,
  eventPhasesApi,
} from '@/store/api/eventPhasesApi';
import { PhaseTimelineView } from './PhaseTimelineView';
import { PhaseResourcesPanel } from './PhaseResourcesPanel';
import { ResourceTimeline } from './ResourceTimeline';
import { PhaseAssignmentsLoader, PhaseAssignmentsData } from './PhaseAssignmentsLoader';
import { AddPhaseModal } from '../Modals/AddPhaseModal';
import { EditPhaseModal } from '../Modals/EditPhaseModal';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import {
  useGetEventEmployeesQuery,
  useGetEventVehiclesQuery,
  useGetEventEquipmentQuery,
} from '../../../store/api/eventsApi';
import { useAppDispatch } from '@/store/hooks';
import { supabase } from '@/lib/supabase/client';

interface EventPhasesTimelineProps {
  eventId: string;
  eventStartDate: string;
  eventEndDate: string;
}

type ZoomLevel = 'days' | 'hours' | 'minutes';
type ResourceFilter = 'all' | 'selected' | 'event';

export const EventPhasesTimeline: React.FC<EventPhasesTimelineProps> = ({
  eventId,
  eventStartDate,
  eventEndDate,
}) => {
  const dispatch = useAppDispatch();
  const { data: phases = [], isLoading } = useGetEventPhasesQuery(eventId);
  const { data: eventEmployees = [] } = useGetEventEmployeesQuery(eventId, { skip: !eventId });
  const { data: eventVehicles = [] } = useGetEventVehiclesQuery(eventId, { skip: !eventId });
  const { data: eventEquipment = [] } = useGetEventEquipmentQuery(eventId, { skip: !eventId });

  console.log('[EventPhasesTimeline] Resources:', {
    vehiclesCount: eventVehicles.length,
    equipmentCount: eventEquipment.length,
    vehicles: eventVehicles,
    equipment: eventEquipment,
  });
  const [updatePhase] = useUpdatePhaseMutation();
  const [deletePhase] = useDeletePhaseMutation();
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();

  const [zoomLevel, setZoomLevel] = useState<ZoomLevel>('hours');
  const [resourceFilter, setResourceFilter] = useState<ResourceFilter>('all');
  const [selectedPhase, setSelectedPhase] = useState<EventPhase | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showResourcePanel, setShowResourcePanel] = useState(false);
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [draftChanges, setDraftChanges] = useState<
    Record<string, { start_time: string; end_time: string }>
  >({});
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [phaseAssignments, setPhaseAssignments] = useState<PhaseAssignmentsData[]>([]);

  // Realtime subscription dla przypisań pojazdów do faz
  useEffect(() => {
    if (!eventId) return;

    console.log('[EventPhasesTimeline] Setting up realtime for event_phase_vehicles');

    const channel = supabase
      .channel(`event_phase_vehicles_${eventId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'event_phase_vehicles',
        },
        (payload) => {
          console.log('[EventPhasesTimeline] event_phase_vehicles changed:', payload);

          // Invaliduj cache dla wszystkich faz tego wydarzenia
          phases.forEach((phase) => {
            dispatch(
              eventPhasesApi.util.invalidateTags([{ type: 'PhaseVehicles', id: phase.id }])
            );
          });
        }
      )
      .subscribe();

    return () => {
      console.log('[EventPhasesTimeline] Cleaning up realtime subscription');
      supabase.removeChannel(channel);
    };
  }, [eventId, phases, dispatch]);

  const timelineBounds = useMemo(() => {
    // Główne godziny wydarzenia to tylko agenda, ale timeline musi uwzględniać wszystkie fazy
    // (np. załadunek przed eventem, rozładunek po evencie)
    const eventStart = new Date(eventStartDate);
    const eventEnd = new Date(eventEndDate);

    if (phases.length === 0) {
      return { start: eventStart, end: eventEnd };
    }

    // Znajdź najwcześniejszą i najpóźniejszą fazę
    const phaseStarts = phases.map((p) => new Date(p.start_time).getTime());
    const phaseEnds = phases.map((p) => new Date(p.end_time).getTime());

    const earliestPhase = Math.min(...phaseStarts);
    const latestPhase = Math.max(...phaseEnds);

    // Timeline pokazuje od najwcześniejszej fazy do najpóźniejszej
    const start = new Date(Math.min(earliestPhase, eventStart.getTime()));
    const end = new Date(Math.max(latestPhase, eventEnd.getTime()));

    return { start, end };
  }, [eventStartDate, eventEndDate, phases]);

  const phaseConflicts = useMemo(() => {
    const conflicts: Record<string, boolean> = {};
    phases.forEach((phase, index) => {
      const phaseStart = new Date(phase.start_time);
      const phaseEnd = new Date(phase.end_time);

      const hasConflict = phases.some((otherPhase, otherIndex) => {
        if (index === otherIndex) return false;
        const otherStart = new Date(otherPhase.start_time);
        const otherEnd = new Date(otherPhase.end_time);

        return (
          (phaseStart >= otherStart && phaseStart < otherEnd) ||
          (phaseEnd > otherStart && phaseEnd <= otherEnd) ||
          (phaseStart <= otherStart && phaseEnd >= otherEnd)
        );
      });

      conflicts[phase.id] = hasConflict;
    });
    return conflicts;
  }, [phases]);

  const handlePhaseResizeDraft = (phaseId: string, newStart: Date, newEnd: Date) => {
    setDraftChanges((prev) => ({
      ...prev,
      [phaseId]: {
        start_time: newStart.toISOString(),
        end_time: newEnd.toISOString(),
      },
    }));
    setHasUnsavedChanges(true);
  };

  const handleSaveChanges = async () => {
    try {
      const promises = Object.entries(draftChanges).map(([phaseId, changes]) =>
        updatePhase({
          id: phaseId,
          ...changes,
        }).unwrap(),
      );

      await Promise.all(promises);
      showSnackbar('Zmiany zapisane pomyślnie', 'success');
      setDraftChanges({});
      setHasUnsavedChanges(false);
    } catch (error: any) {
      showSnackbar(error.message || 'Błąd podczas zapisywania zmian', 'error');
    }
  };

  const handleDiscardChanges = () => {
    setDraftChanges({});
    setHasUnsavedChanges(false);
    showSnackbar('Zmiany odrzucone', 'info');
  };

  const handlePhaseDelete = async (phaseId: string) => {
    const confirmed = await showConfirm({
      title: 'Usuń fazę',
      message: 'Czy na pewno chcesz usunąć tę fazę? Wszystkie przypisania zostaną utracone.',
      confirmText: 'Usuń',
      cancelText: 'Anuluj',
    });

    if (confirmed) {
      try {
        await deletePhase(phaseId).unwrap();
        showSnackbar('Faza usunięta', 'success');
        if (selectedPhase?.id === phaseId) {
          setSelectedPhase(null);
          setShowResourcePanel(false);
        }
      } catch (error: any) {
        showSnackbar(error.message || 'Błąd podczas usuwania fazy', 'error');
      }
    }
  };

  const handlePhaseClick = (phase: EventPhase) => {
    setSelectedPhase(phase);
    setShowResourcePanel(true);
  };

  const handlePhaseDoubleClick = (phase: EventPhase) => {
    setSelectedPhase(phase);
    setShowEditModal(true);
  };

  const zoomLevels: { value: ZoomLevel; label: string }[] = [
    { value: 'days', label: 'Dni' },
    { value: 'hours', label: 'Godziny' },
    { value: 'minutes', label: 'Minuty' },
  ];

  const resourceFilters: { value: ResourceFilter; label: string }[] = [
    { value: 'all', label: 'Wszystkie zasoby' },
    { value: 'selected', label: 'Tylko wybrane' },
    { value: 'event', label: 'Z tego wydarzenia' },
  ];

  const hasConflicts = Object.values(phaseConflicts).some((c) => c);

  // Merge original phases with draft changes for display
  const displayPhases = useMemo(() => {
    return phases.map((phase) => {
      const draft = draftChanges[phase.id];
      if (draft) {
        return { ...phase, ...draft };
      }
      return phase;
    });
  }, [phases, draftChanges]);

  // Prepare employees data (extract from both old and new assignments)
  const employees = useMemo(() => {
    const employeeMap = new Map();

    console.log('[EventPhasesTimeline] Building employees list:', {
      eventEmployeesCount: eventEmployees.length,
      phaseAssignmentsCount: phaseAssignments.length,
    });

    // Add employees from event assignments (old system)
    eventEmployees.forEach((assignment: any) => {
      if (assignment.employee) {
        employeeMap.set(assignment.employee.id, assignment.employee);
        console.log('[EventPhasesTimeline] Added from event:', assignment.employee.name, assignment.employee.surname);
      }
    });

    // Add employees from phase assignments (new system)
    phaseAssignments.forEach((phaseData) => {
      console.log('[EventPhasesTimeline] Phase:', phaseData.phase.name, 'assignments:', phaseData.assignments.length);
      phaseData.assignments.forEach((assignment: any) => {
        console.log('[EventPhasesTimeline] Assignment:', assignment);
        if (assignment.employee && !employeeMap.has(assignment.employee.id)) {
          employeeMap.set(assignment.employee.id, assignment.employee);
          console.log('[EventPhasesTimeline] Added from phase:', assignment.employee.name, assignment.employee.surname);
        }
      });
    });

    const result = Array.from(employeeMap.values()).filter((emp: any) => emp);
    console.log('[EventPhasesTimeline] Final employees:', result.map(e => `${e.name} ${e.surname}`));
    return result;
  }, [eventEmployees, phaseAssignments]);

  const employeesFromAssignments = useMemo(() => {
    const map = new Map<string, any>();
  
    phaseAssignments.forEach(pa => {
      pa.assignments?.forEach((a: any) => {
        if (a.employee_id && a.employee) {
          map.set(a.employee_id, { ...a.employee, id: a.employee_id });
        }
      });
    });
  
    return Array.from(map.values());
  }, [phaseAssignments]);

  if (isLoading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="text-[#e5e4e2]/60">Ładowanie faz...</div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#d3bb73]/10 bg-[#1c1f33] p-4">
        <div className="flex items-center gap-3">
          <Clock className="h-5 w-5 text-[#d3bb73]" />
          <h2 className="text-lg font-semibold text-[#e5e4e2]">Fazy Wydarzenia</h2>
          <span className="rounded-full bg-[#d3bb73]/20 px-3 py-1 text-xs font-medium text-[#d3bb73]">
            {phases.length}
          </span>
          {hasConflicts && (
            <div className="flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-1">
              <AlertCircle className="h-3.5 w-3.5 text-red-400" />
              <span className="text-xs text-red-400">Nakładające się fazy!</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Draft Changes Actions */}
          {hasUnsavedChanges && (
            <>
              <button
                onClick={handleSaveChanges}
                className="flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-500/20 px-4 py-1.5 text-sm font-medium text-green-400 transition-colors hover:bg-green-500/30"
              >
                <Save className="h-4 w-4" />
                Zapisz zmiany
              </button>
              <button
                onClick={handleDiscardChanges}
                className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/20 px-4 py-1.5 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/30"
              >
                <RotateCcw className="h-4 w-4" />
                Odrzuć
              </button>
            </>
          )}

          {/* Zoom Controls */}
          <div className="flex items-center gap-1 rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] p-1">
            {zoomLevels.map((level) => (
              <button
                key={level.value}
                onClick={() => setZoomLevel(level.value)}
                className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                  zoomLevel === level.value
                    ? 'bg-[#d3bb73] text-[#1c1f33]'
                    : 'text-[#e5e4e2]/60 hover:bg-[#d3bb73]/10 hover:text-[#e5e4e2]'
                }`}
              >
                {level.label}
              </button>
            ))}
          </div>

          {/* Resource Filter */}
          <div className="relative">
            <button
              onClick={() => setShowFilterMenu(!showFilterMenu)}
              className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-1.5 text-sm text-[#e5e4e2]/80 transition-colors hover:border-[#d3bb73]/40 hover:bg-[#0f1119]"
            >
              <Filter className="h-4 w-4" />
              {resourceFilters.find((f) => f.value === resourceFilter)?.label}
              <ChevronDown className="h-3.5 w-3.5" />
            </button>

            {showFilterMenu && (
              <div className="absolute right-0 top-full z-10 mt-1 w-48 rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] py-1 shadow-xl">
                {resourceFilters.map((filter) => (
                  <button
                    key={filter.value}
                    onClick={() => {
                      setResourceFilter(filter.value);
                      setShowFilterMenu(false);
                    }}
                    className={`w-full px-3 py-2 text-left text-sm transition-colors ${
                      resourceFilter === filter.value
                        ? 'bg-[#d3bb73]/20 text-[#d3bb73]'
                        : 'text-[#e5e4e2]/80 hover:bg-[#d3bb73]/10'
                    }`}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Add Phase Button */}
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/30 bg-[#d3bb73] px-4 py-1.5 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
          >
            <Plus className="h-4 w-4" />
            Dodaj Fazę
          </button>
        </div>
      </div>

      {/* Timeline View */}
      {phases.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-12">
          <Clock className="h-16 w-16 text-[#e5e4e2]/20" />
          <div className="text-center">
            <h3 className="mb-2 text-lg font-medium text-[#e5e4e2]">Brak faz</h3>
            <p className="mb-4 text-sm text-[#e5e4e2]/60">
              Podziel wydarzenie na fazy (montaż, realizacja, demontaż)
            </p>
            <button
              onClick={() => setShowAddModal(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-[#d3bb73]/30 bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
            >
              <Plus className="h-4 w-4" />
              Dodaj Pierwszą Fazę
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col bg-[#0f1119]">
          {/* Scrollowalny kontener (X i Y) */}
          <div className="flex-1 overflow-x-auto overflow-y-auto" style={{ maxHeight: '70vh' }}>
            <div style={{ minWidth: '1200px' }}>
              {/* Main Phase Timeline */}
              <div className="mb-6">
                <div className="mb-2 px-6">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-[#e5e4e2]/70">
                    Fazy Główne
                  </h3>
                </div>
                <PhaseTimelineView
                  phases={displayPhases}
                  timelineBounds={timelineBounds}
                  zoomLevel={zoomLevel}
                  selectedPhase={selectedPhase}
                  phaseConflicts={phaseConflicts}
                  onPhaseClick={handlePhaseClick}
                  onPhaseDoubleClick={handlePhaseDoubleClick}
                  onPhaseResize={handlePhaseResizeDraft}
                  onPhaseDelete={handlePhaseDelete}
                  eventStartDate={eventStartDate}
                  eventEndDate={eventEndDate}
                />
              </div>

              {/* Separator between main phases and resources */}
              <div className="mx-6 my-6 border-t-2 border-[#d3bb73]/30"></div>

              {/* Resource Timeline */}
              <div className="mb-2 px-6">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-[#e5e4e2]/70">
                  Zasoby Wydarzenia
                </h3>
              </div>
              <div className="mt-2">
                <ResourceTimeline
                  eventId={eventId}
                  phases={displayPhases}
                  phaseAssignments={phaseAssignments}
                  timelineBounds={timelineBounds}
                  zoomLevel={zoomLevel}
                  employees={employeesFromAssignments}
                  vehicles={eventVehicles}
                  equipment={eventEquipment}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Phase Assignments Loader - pobiera dane w tle */}
      <PhaseAssignmentsLoader
        phases={phases}
        onAllDataLoaded={(next) => {
          setPhaseAssignments((prev) => {
            // jeśli loader daje w kółko te same dane, to zatrzymasz re-render
            const prevStr = JSON.stringify(prev);
            const nextStr = JSON.stringify(next);
            return prevStr === nextStr ? prev : next;
          });
        }}
      />

      {/* Add Phase Modal */}
      <AddPhaseModal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        eventId={eventId}
        eventStartDate={eventStartDate}
        eventEndDate={eventEndDate}
        existingPhases={phases}
      />

      {/* Edit Phase Modal */}
      <EditPhaseModal
        open={showEditModal}
        onClose={() => {
          setShowEditModal(false);
          setSelectedPhase(null);
        }}
        phase={selectedPhase}
      />

      {/* Resource Panel */}
      {showResourcePanel && selectedPhase && (
        <PhaseResourcesPanel
          phase={selectedPhase}
          eventId={eventId}
          onClose={() => {
            setShowResourcePanel(false);
            setSelectedPhase(null);
          }}
          resourceFilter={resourceFilter}
        />
      )}
    </div>
  );
};
