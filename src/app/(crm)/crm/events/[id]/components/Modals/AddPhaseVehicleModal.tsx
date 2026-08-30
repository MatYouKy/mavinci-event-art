'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Car, Check, Clock, Search, UserRound, X } from 'lucide-react';
import { useGetFleetVehiclesQuery } from '@/app/(crm)/crm/fleet/api/fleetApi';
import { useGetEmployeesQuery } from '@/app/(crm)/crm/employees/store/employeeApi';
import {
  EventPhase,
  useGetEventPhasesQuery,
} from '@/store/api/eventPhasesApi';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useEventWorkspace } from '@/components/crm/events/EventWorkspaceProvider';

type VehicleConflict = {
  id: string;
  label: string;
  start: string;
  end: string;
};

const blockedVehicleStatuses = new Set([
  'inactive',
  'in_service',
  'under_repair',
  'sold',
  'scrapped',
]);

const formatDateTime = (value: string) =>
  new Date(value).toLocaleString('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

export function AddPhaseVehicleModal({
  open,
  onClose,
  phase,
  eventId,
}: {
  open: boolean;
  onClose: () => void;
  phase: EventPhase;
  eventId: string;
}) {
  const { showSnackbar } = useSnackbar();
  const { refresh: refreshWorkspace } = useEventWorkspace();
  const { data: vehicles = [], isLoading: vehiclesLoading } = useGetFleetVehiclesQuery(undefined, {
    skip: !open,
  });
  const { data: employees = [], isLoading: employeesLoading } = useGetEmployeesQuery(
    { activeOnly: true },
    { skip: !open },
  );
  const { data: phases = [] } = useGetEventPhasesQuery(eventId, { skip: !open || !eventId });
  const [saving, setSaving] = useState(false);

  const [search, setSearch] = useState('');
  const [selectedVehicleId, setSelectedVehicleId] = useState('');
  const [driverId, setDriverId] = useState('');
  const [selectedPhaseIds, setSelectedPhaseIds] = useState<Set<string>>(new Set([phase.id]));
  const [existingPhaseIds, setExistingPhaseIds] = useState<Set<string>>(new Set());
  const [purpose, setPurpose] = useState('Transport sprzętu');
  const [notes, setNotes] = useState('');
  const [bufferBefore, setBufferBefore] = useState(0);
  const [bufferAfter, setBufferAfter] = useState(0);
  const [conflicts, setConflicts] = useState<VehicleConflict[]>([]);
  const [checkingConflicts, setCheckingConflicts] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSearch('');
    setSelectedVehicleId('');
    setDriverId('');
    setSelectedPhaseIds(new Set([phase.id]));
    setExistingPhaseIds(new Set());
    setPurpose('Transport sprzętu');
    setNotes('');
    setBufferBefore(0);
    setBufferAfter(0);
    setConflicts([]);
  }, [open, phase.id]);

  const selectedPhases = useMemo(
    () => phases.filter((item) => selectedPhaseIds.has(item.id)),
    [phases, selectedPhaseIds],
  );

  const assignmentWindow = useMemo(() => {
    if (selectedPhases.length === 0) return null;
    const start = Math.min(...selectedPhases.map((item) => new Date(item.start_time).getTime()));
    const end = Math.max(...selectedPhases.map((item) => new Date(item.end_time).getTime()));
    return {
      start: new Date(start - Math.max(0, bufferBefore) * 60_000).toISOString(),
      end: new Date(end + Math.max(0, bufferAfter) * 60_000).toISOString(),
    };
  }, [bufferAfter, bufferBefore, selectedPhases]);

  useEffect(() => {
    if (!open || !selectedVehicleId || phases.length === 0) {
      setExistingPhaseIds(new Set());
      return;
    }

    let active = true;
    const loadExistingAssignments = async () => {
      const { data, error } = await supabase
        .from('event_phase_vehicles')
        .select('phase_id')
        .eq('vehicle_id', selectedVehicleId)
        .in(
          'phase_id',
          phases.map((item) => item.id),
        );

      if (!active) return;
      if (error) {
        showSnackbar('Nie udało się sprawdzić przypisań pojazdu', 'error');
        return;
      }

      const assigned = new Set<string>((data || []).map((item) => item.phase_id));
      setExistingPhaseIds(assigned);
      setSelectedPhaseIds((current) => {
        const next = new Set(Array.from(current).filter((phaseId) => !assigned.has(phaseId)));
        if (next.size === 0) {
          const firstAvailable = phases.find((item) => !assigned.has(item.id));
          if (firstAvailable) next.add(firstAvailable.id);
        }
        return next;
      });
    };

    void loadExistingAssignments();
    return () => {
      active = false;
    };
  }, [open, phases, selectedVehicleId, showSnackbar]);

  useEffect(() => {
    if (!open || !selectedVehicleId || !assignmentWindow) {
      setConflicts([]);
      return;
    }

    let active = true;
    const checkConflicts = async () => {
      setCheckingConflicts(true);
      const { data, error } = await supabase
        .from('event_phase_vehicles')
        .select(
          `
          id,
          phase_id,
          assigned_start,
          assigned_end,
          phase:event_phases!event_phase_vehicles_phase_id_fkey(id,event_id,name)
        `,
        )
        .eq('vehicle_id', selectedVehicleId)
        .lt('assigned_start', assignmentWindow.end)
        .gt('assigned_end', assignmentWindow.start);

      if (!active) return;
      if (error) {
        console.error('Vehicle phase conflict check failed:', error);
        setConflicts([]);
      } else {
        const nextConflicts = (data || [])
          .filter((item: any) => {
            const relatedPhase = Array.isArray(item.phase) ? item.phase[0] : item.phase;
            return relatedPhase?.event_id !== eventId;
          })
          .map((item: any) => {
            const relatedPhase = Array.isArray(item.phase) ? item.phase[0] : item.phase;
            return {
              id: item.id,
              label: relatedPhase?.name || 'Inna faza wydarzenia',
              start: item.assigned_start,
              end: item.assigned_end,
            };
          });
        setConflicts(nextConflicts);
      }
      setCheckingConflicts(false);
    };

    void checkConflicts();
    return () => {
      active = false;
    };
  }, [assignmentWindow, eventId, open, selectedVehicleId]);

  const filteredVehicles = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('pl-PL');
    return vehicles
      .filter((vehicle) => vehicle.category !== 'trailer')
      .filter((vehicle) => {
        if (!query) return true;
        return [vehicle.name, vehicle.brand, vehicle.model, vehicle.registration_number]
          .filter(Boolean)
          .some((value) => String(value).toLocaleLowerCase('pl-PL').includes(query));
      })
      .sort((left, right) => {
        const leftBlocked = blockedVehicleStatuses.has(left.status) ? 1 : 0;
        const rightBlocked = blockedVehicleStatuses.has(right.status) ? 1 : 0;
        if (leftBlocked !== rightBlocked) return leftBlocked - rightBlocked;
        return String(left.name || left.registration_number).localeCompare(
          String(right.name || right.registration_number),
          'pl',
        );
      });
  }, [search, vehicles]);

  const selectVehicle = (vehicleId: string) => {
    const vehicle = vehicles.find((item) => item.id === vehicleId);
    setSelectedVehicleId(vehicleId);
    setDriverId(vehicle?.assigned_to || '');
    setConflicts([]);
  };

  const togglePhase = (phaseId: string) => {
    if (existingPhaseIds.has(phaseId)) return;
    setSelectedPhaseIds((current) => {
      const next = new Set(current);
      if (next.has(phaseId)) next.delete(phaseId);
      else next.add(phaseId);
      return next;
    });
  };

  const handleSave = async () => {
    if (!selectedVehicleId) {
      showSnackbar('Wybierz pojazd', 'warning');
      return;
    }
    if (selectedPhases.length === 0) {
      showSnackbar('Wybierz co najmniej jedną fazę', 'warning');
      return;
    }
    if (conflicts.length > 0) {
      showSnackbar('Pojazd jest zajęty w wybranym terminie', 'error');
      return;
    }

    try {
      setSaving(true);
      const { error } = await supabase.rpc(
        'assign_event_vehicle_to_phases',
        {
          p_event_id: eventId,
          p_vehicle_id: selectedVehicleId,
          p_phase_ids: selectedPhases.map((targetPhase) => targetPhase.id),
          p_driver_id: driverId || null,
          p_buffer_before_minutes: Math.max(0, bufferBefore),
          p_buffer_after_minutes: Math.max(0, bufferAfter),
          p_purpose: purpose.trim() || null,
          p_notes: notes.trim() || null,
        },
      );
      if (error) throw error;

      refreshWorkspace('event_phase_vehicles');
      refreshWorkspace('event_vehicles');
      showSnackbar(
        selectedPhases.length === 1
          ? 'Pojazd przypisano do fazy'
          : `Pojazd przypisano do ${selectedPhases.length} faz`,
        'success',
      );
      onClose();
    } catch (error: any) {
      console.error('Failed to assign vehicle to phases:', error);
      showSnackbar(error?.message || 'Nie udało się przypisać pojazdu', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#d3bb73]/10 px-5 py-4">
          <div>
            <h3 className="text-lg font-medium text-[#e5e4e2]">Przypisz pojazd do fazy</h3>
            <p className="mt-1 text-xs text-[#e5e4e2]/50">
              {phase.name} · możesz zaznaczyć również kolejne fazy
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-[#e5e4e2]/60 hover:bg-white/5 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 overflow-hidden lg:grid-cols-[1.05fr_.95fr]">
          <div className="min-h-0 overflow-y-auto border-b border-[#d3bb73]/10 p-5 lg:border-b-0 lg:border-r">
            <label className="relative block">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#e5e4e2]/35" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Szukaj po nazwie, modelu lub rejestracji…"
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0b0d16] py-2.5 pl-10 pr-3 text-sm text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
              />
            </label>

            <div className="mt-4 space-y-2">
              {vehiclesLoading ? (
                <p className="py-10 text-center text-sm text-[#e5e4e2]/45">Ładowanie floty…</p>
              ) : filteredVehicles.length === 0 ? (
                <p className="py-10 text-center text-sm text-[#e5e4e2]/45">
                  Brak pasujących pojazdów
                </p>
              ) : (
                filteredVehicles.map((vehicle) => {
                  const selected = selectedVehicleId === vehicle.id;
                  const blocked = blockedVehicleStatuses.has(vehicle.status);
                  return (
                    <button
                      key={vehicle.id}
                      type="button"
                      disabled={blocked}
                      onClick={() => selectVehicle(vehicle.id)}
                      className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                        selected
                          ? 'border-[#d3bb73] bg-[#d3bb73]/10'
                          : 'border-[#d3bb73]/10 bg-[#111421] hover:border-[#d3bb73]/30'
                      } disabled:cursor-not-allowed disabled:opacity-40`}
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#d3bb73]/10">
                        <Car className="h-5 w-5 text-[#d3bb73]" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-[#e5e4e2]">
                          {vehicle.name ||
                            `${vehicle.brand || ''} ${vehicle.model || ''}`.trim() ||
                            'Pojazd'}
                        </p>
                        <p className="truncate text-xs text-[#e5e4e2]/45">
                          {[vehicle.brand, vehicle.model, vehicle.registration_number]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      </div>
                      <span
                        className={`rounded-full px-2 py-1 text-[10px] ${blocked ? 'bg-red-500/15 text-red-300' : 'bg-emerald-500/15 text-emerald-300'}`}
                      >
                        {blocked ? 'Niedostępny' : 'Dostępny'}
                      </span>
                      {selected && <Check className="h-5 w-5 text-[#d3bb73]" />}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div className="min-h-0 overflow-y-auto p-5">
            <div className="space-y-5">
              <section>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#d3bb73]">
                  Fazy wydarzenia
                </p>
                <div className="space-y-2">
                  {phases.map((item) => {
                    const alreadyAssigned = existingPhaseIds.has(item.id);
                    const checked = selectedPhaseIds.has(item.id);
                    return (
                      <label
                        key={item.id}
                        className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 ${checked ? 'border-[#d3bb73]/40 bg-[#d3bb73]/10' : 'border-[#d3bb73]/10 bg-[#111421]'} ${alreadyAssigned ? 'opacity-50' : 'cursor-pointer'}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked || alreadyAssigned}
                          disabled={alreadyAssigned}
                          onChange={() => togglePhase(item.id)}
                          className="accent-[#d3bb73]"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm text-[#e5e4e2]">{item.name}</p>
                          <p className="text-[11px] text-[#e5e4e2]/45">
                            {formatDateTime(item.start_time)} – {formatDateTime(item.end_time)}
                          </p>
                        </div>
                        {alreadyAssigned && (
                          <span className="text-[10px] text-[#d3bb73]">Już przypisany</span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </section>

              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs text-[#e5e4e2]/55">
                  Bufor przed fazą (min)
                  <input
                    type="number"
                    min="0"
                    step="15"
                    value={bufferBefore}
                    onChange={(event) =>
                      setBufferBefore(Math.max(0, Number(event.target.value) || 0))
                    }
                    className="mt-1.5 w-full rounded-lg border border-[#d3bb73]/15 bg-[#0b0d16] px-3 py-2 text-sm text-[#e5e4e2]"
                  />
                </label>
                <label className="text-xs text-[#e5e4e2]/55">
                  Bufor po fazie (min)
                  <input
                    type="number"
                    min="0"
                    step="15"
                    value={bufferAfter}
                    onChange={(event) =>
                      setBufferAfter(Math.max(0, Number(event.target.value) || 0))
                    }
                    className="mt-1.5 w-full rounded-lg border border-[#d3bb73]/15 bg-[#0b0d16] px-3 py-2 text-sm text-[#e5e4e2]"
                  />
                </label>
              </div>

              <label className="block text-xs text-[#e5e4e2]/55">
                <UserRound className="mr-1 inline h-4 w-4" /> Kierowca (opcjonalnie)
                <select
                  value={driverId}
                  onChange={(event) => setDriverId(event.target.value)}
                  disabled={employeesLoading}
                  className="mt-1.5 w-full rounded-lg border border-[#d3bb73]/15 bg-[#0b0d16] px-3 py-2.5 text-sm text-[#e5e4e2]"
                >
                  <option value="">Bez przypisanego kierowcy</option>
                  {employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.name} {employee.surname}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-xs text-[#e5e4e2]/55">
                Cel użycia
                <select
                  value={purpose}
                  onChange={(event) => setPurpose(event.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-[#d3bb73]/15 bg-[#0b0d16] px-3 py-2.5 text-sm text-[#e5e4e2]"
                >
                  <option>Transport sprzętu</option>
                  <option>Transport ekipy</option>
                  <option>Transport gości lub klienta</option>
                  <option>Obsługa techniczna</option>
                  <option>Inne</option>
                </select>
              </label>

              <label className="block text-xs text-[#e5e4e2]/55">
                Notatki
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  rows={3}
                  placeholder="Trasa, miejsce odbioru, załadunek, dodatkowe ustalenia…"
                  className="mt-1.5 w-full resize-y rounded-lg border border-[#d3bb73]/15 bg-[#0b0d16] px-3 py-2 text-sm text-[#e5e4e2]"
                />
              </label>

              {assignmentWindow && (
                <div className="flex items-start gap-2 rounded-lg border border-[#d3bb73]/15 bg-[#111421] p-3 text-xs text-[#e5e4e2]/60">
                  <Clock className="mt-0.5 h-4 w-4 shrink-0 text-[#d3bb73]" />
                  <span>
                    Łączny zakres rezerwacji: {formatDateTime(assignmentWindow.start)} –{' '}
                    {formatDateTime(assignmentWindow.end)}
                  </span>
                </div>
              )}

              {(checkingConflicts || conflicts.length > 0) && (
                <div
                  className={`rounded-lg border p-3 ${conflicts.length ? 'border-red-500/30 bg-red-500/10' : 'border-[#d3bb73]/15 bg-[#111421]'}`}
                >
                  <div className="flex items-center gap-2 text-xs font-medium text-[#e5e4e2]">
                    <AlertTriangle
                      className={`h-4 w-4 ${conflicts.length ? 'text-red-400' : 'text-[#d3bb73]'}`}
                    />
                    {checkingConflicts
                      ? 'Sprawdzanie dostępności…'
                      : 'Pojazd koliduje z innym wydarzeniem'}
                  </div>
                  {conflicts.map((conflict) => (
                    <p key={conflict.id} className="mt-2 text-xs text-red-300">
                      {conflict.label}: {formatDateTime(conflict.start)} –{' '}
                      {formatDateTime(conflict.end)}
                    </p>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-[#d3bb73]/10 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[#d3bb73]/15 px-4 py-2 text-sm text-[#e5e4e2] hover:bg-white/5"
          >
            Anuluj
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={
              saving ||
              checkingConflicts ||
              !selectedVehicleId ||
              selectedPhases.length === 0 ||
              conflicts.length > 0
            }
            className="rounded-lg bg-[#d3bb73] px-5 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {saving ? 'Przypisywanie…' : `Przypisz do ${selectedPhases.length || 0} faz`}
          </button>
        </div>
      </div>
    </div>
  );
}
