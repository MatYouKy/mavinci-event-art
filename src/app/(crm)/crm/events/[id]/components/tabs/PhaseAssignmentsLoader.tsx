'use client';

import React, { useCallback, useEffect, useRef, useState, memo } from 'react';
import {
  EventPhase,
  useGetPhaseAssignmentsQuery,
  useGetPhaseVehiclesQuery,
  useGetPhaseEquipmentQuery,
} from '@/store/api/eventPhasesApi';

export interface PhaseAssignmentsData {
  phase: EventPhase;
  assignments: any[];
  vehicleAssignments: any[];
  equipmentAssignments: any[];
}

/**
 * Stabilny "hash" listy: id + start/end + updated_at (lub inne pola czasu)
 * Uwaga: nie używamy JSON.stringify całych obiektów (drogo + niestabilnie).
 */
const makeListKey = (list: any[], type: 'emp' | 'veh' | 'eq') => {
  if (!Array.isArray(list) || list.length === 0) return `${type}:0`;

  // sort po id żeby zmiana kolejności nie generowała fałszywych zmian
  const items = [...list].sort((a, b) => String(a?.id ?? '').localeCompare(String(b?.id ?? '')));

  return (
    `${type}:${items.length}:` +
    items
      .map((x) => {
        const id = x?.id ?? '';

        // employees assignments potrafią mieć różne nazwy pól
        const start =
          x?.assignment_start ??
          x?.phase_work_start ??
          x?.start_time ??
          x?.assigned_start ??
          '';

        const end =
          x?.assignment_end ??
          x?.phase_work_end ??
          x?.end_time ??
          x?.assigned_end ??
          '';

        const upd = x?.updated_at ?? '';

        return `${id}|${start}|${end}|${upd}`;
      })
      .join(',')
  );
};

/**
 * Pojedynczy loader dla jednej fazy
 */
const SinglePhaseLoader: React.FC<{
  phase: EventPhase;
  onDataLoaded: (data: PhaseAssignmentsData) => void;
}> = memo(({ phase, onDataLoaded }) => {
  const { data: assignments = [] } = useGetPhaseAssignmentsQuery(phase.id);
  const { data: vehicleAssignments = [] } = useGetPhaseVehiclesQuery(phase.id);
  const { data: equipmentAssignments = [] } = useGetPhaseEquipmentQuery(phase.id);

  // 🔒 stabilny klucz zmian dla tej fazy
  const phaseDataKeyRef = useRef<string>('');

  useEffect(() => {
    const empKey = makeListKey(assignments, 'emp');
    const vehKey = makeListKey(vehicleAssignments, 'veh');
    const eqKey = makeListKey(equipmentAssignments, 'eq');
    const nextKey = `${phase.id}__${empKey}__${vehKey}__${eqKey}`;

    // ✅ jeśli nic się realnie nie zmieniło (czasy/updated_at/ilość/id) -> nie emituj
    if (phaseDataKeyRef.current === nextKey) return;
    phaseDataKeyRef.current = nextKey;

    onDataLoaded({
      phase,
      assignments,
      vehicleAssignments,
      equipmentAssignments,
    });
  }, [phase, assignments, vehicleAssignments, equipmentAssignments, onDataLoaded]);

  return null;
});
SinglePhaseLoader.displayName = 'SinglePhaseLoader';

interface PhaseAssignmentsLoaderProps {
  phases: EventPhase[];
  onAllDataLoaded: (data: PhaseAssignmentsData[]) => void;
}

/**
 * Helper komponent który pobiera dane dla wszystkich faz.
 * Tworzy osobny komponent dla każdej fazy aby uniknąć błędów React hooks.
 */
export const PhaseAssignmentsLoader: React.FC<PhaseAssignmentsLoaderProps> = ({
  phases,
  onAllDataLoaded,
}) => {
  const [loadedData, setLoadedData] = useState<Map<string, PhaseAssignmentsData>>(new Map());

  // ✅ trzymamy callback w ref, żeby nie generował pętli gdy rodzic tworzy nową funkcję na każdym renderze
  const onAllDataLoadedRef = useRef(onAllDataLoaded);
  useEffect(() => {
    onAllDataLoadedRef.current = onAllDataLoaded;
  }, [onAllDataLoaded]);

  // ✅ trzymamy klucze faz, żeby nie aktualizować mapy gdy dane są identyczne
  const phaseKeyMapRef = useRef<Map<string, string>>(new Map());

  const handlePhaseDataLoaded = useCallback((data: PhaseAssignmentsData) => {
    const empKey = makeListKey(data.assignments, 'emp');
    const vehKey = makeListKey(data.vehicleAssignments, 'veh');
    const eqKey = makeListKey(data.equipmentAssignments, 'eq');
    const nextKey = `${data.phase.id}__${empKey}__${vehKey}__${eqKey}`;

    const prevKey = phaseKeyMapRef.current.get(data.phase.id);
    if (prevKey === nextKey) return; // ✅ nic się nie zmieniło

    phaseKeyMapRef.current.set(data.phase.id, nextKey);

    setLoadedData((prev) => {
      const next = new Map(prev);
      next.set(data.phase.id, data);
      return next;
    });
  }, []);

  // Gdy wszystkie fazy są załadowane, wywołaj callback
  const lastEmittedKeyRef = useRef<string>('');

  useEffect(() => {
    if (phases.length === 0) return;
    if (loadedData.size !== phases.length) return;

    const allData = phases
      .map((phase) => loadedData.get(phase.id))
      .filter(Boolean) as PhaseAssignmentsData[];

    // ✅ emitKey oparty o klucze faz (nie o referencje tablic)
    const emitKey = phases
      .map((p) => phaseKeyMapRef.current.get(p.id) ?? `${p.id}__missing`)
      .join('||');

    if (lastEmittedKeyRef.current === emitKey) return;
    lastEmittedKeyRef.current = emitKey;

    onAllDataLoadedRef.current(allData);
  }, [loadedData, phases]);

  return (
    <>
      {phases.map((phase) => (
        <SinglePhaseLoader key={phase.id} phase={phase} onDataLoaded={handlePhaseDataLoaded} />
      ))}
    </>
  );
};