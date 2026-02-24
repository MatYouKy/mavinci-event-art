'use client';

import React, { useEffect, useState } from 'react';
import { EventPhase, useGetPhaseAssignmentsQuery, useGetPhaseVehiclesQuery, useGetPhaseEquipmentQuery } from '@/store/api/eventPhasesApi';

export interface PhaseAssignmentsData {
  phase: EventPhase;
  assignments: any[];
  vehicleAssignments: any[];
  equipmentAssignments: any[];
}

/**
 * Pojedynczy loader dla jednej fazy
 */
const SinglePhaseLoader: React.FC<{
  phase: EventPhase;
  onDataLoaded: (data: PhaseAssignmentsData) => void;
}> = ({ phase, onDataLoaded }) => {
  const { data: assignments = [] } = useGetPhaseAssignmentsQuery(phase.id);
  const { data: vehicleAssignments = [] } = useGetPhaseVehiclesQuery(phase.id);
  const { data: equipmentAssignments = [] } = useGetPhaseEquipmentQuery(phase.id);

  useEffect(() => {
    onDataLoaded({
      phase,
      assignments,
      vehicleAssignments,
      equipmentAssignments,
    });
  }, [phase, assignments, vehicleAssignments, equipmentAssignments, onDataLoaded]);

  return null;
};

interface PhaseAssignmentsLoaderProps {
  phases: EventPhase[];
  onAllDataLoaded: (data: PhaseAssignmentsData[]) => void;
}

/**
 * Helper komponent który pobiera dane dla wszystkich faz.
 * Tworzy osobny komponent dla każdej fazy aby uniknąć błędów React hooks.
 */
export const PhaseAssignmentsLoader: React.FC<PhaseAssignmentsLoaderProps> = ({ phases, onAllDataLoaded }) => {
  const [loadedData, setLoadedData] = useState<Map<string, PhaseAssignmentsData>>(new Map());

  const handlePhaseDataLoaded = (data: PhaseAssignmentsData) => {
    setLoadedData(prev => {
      const next = new Map(prev);
      next.set(data.phase.id, data);
      return next;
    });
  };

  // Gdy wszystkie fazy są załadowane, wywołaj callback
  useEffect(() => {
    if (loadedData.size === phases.length && phases.length > 0) {
      const allData = phases.map(phase => loadedData.get(phase.id)!).filter(Boolean);
      onAllDataLoaded(allData);
    }
  }, [loadedData, phases, onAllDataLoaded]);

  return (
    <>
      {phases.map(phase => (
        <SinglePhaseLoader
          key={phase.id}
          phase={phase}
          onDataLoaded={handlePhaseDataLoaded}
        />
      ))}
    </>
  );
};
