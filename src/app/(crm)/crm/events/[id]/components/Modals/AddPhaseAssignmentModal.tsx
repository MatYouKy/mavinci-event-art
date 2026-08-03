'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  X,
  Search,
  UserPlus,
  Sparkles,
  Calendar,
} from 'lucide-react';
import Image from 'next/image';

import {
  EventPhase,
  useCreatePhaseAssignmentMutation,
  useGetEventPhasesQuery,
  useLazyGetEmployeeConflictsQuery,
} from '@/store/api/eventPhasesApi';

import { useGetEmployeesQuery } from '@/app/(crm)/crm/employees/store/employeeApi';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { supabase } from '@/lib/supabase/browser';

interface AddPhaseAssignmentModalProps {
  open: boolean;
  onClose: () => void;
  phase: EventPhase;
  eventId: string;
  eventOffers?: any[];
}

interface SuggestedEmployee {
  employee: any;
  reason: string;
  matchScore: number;
  requiredSkills: string[];
}

interface PhaseAssignmentRow {
  employee_id: string;
}

export const AddPhaseAssignmentModal: React.FC<
  AddPhaseAssignmentModalProps
> = ({
  open,
  onClose,
  phase,
  eventId,
  eventOffers = [],
}) => {
  const [createAssignment, { isLoading }] =
    useCreatePhaseAssignmentMutation();

  const [
    checkConflicts,
    {
      data: conflicts,
      isFetching: checkingConflicts,
    },
  ] = useLazyGetEmployeeConflictsQuery();

  const {
    data: allPhases = [],
  } = useGetEventPhasesQuery(eventId);

  const {
    data: allEmployees = [],
    isLoading: employeesLoading,
    error: employeesError,
  } = useGetEmployeesQuery({
    activeOnly: false,
  });

  const { showSnackbar } = useSnackbar();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState<any | null>(
    null,
  );

  const [selectedPhases, setSelectedPhases] = useState<Set<string>>(
    new Set([phase.id]),
  );

  const [showPhaseSelector, setShowPhaseSelector] = useState(false);
  const [assignToAllPhases, setAssignToAllPhases] = useState(false);
  const [role, setRole] = useState('technician');

  const [assignedEmployeeIds, setAssignedEmployeeIds] = useState<
    Set<string>
  >(new Set());

  const [assignmentsLoading, setAssignmentsLoading] = useState(false);

  /**
   * Pobiera pracowników przypisanych do aktualnie otwartej fazy.
   * Wykonuje jedno zapytanie po otwarciu modala.
   */
  useEffect(() => {
    if (!open || !phase?.id) {
      return;
    }

    let isMounted = true;

    const fetchAssignedEmployees = async () => {
      setAssignmentsLoading(true);

      try {
        const { data, error } = await supabase
          .from('event_phase_assignments')
          .select('employee_id')
          .eq('phase_id', phase.id);

        if (error) {
          throw error;
        }

        if (!isMounted) {
          return;
        }

        const ids = new Set(
          ((data as PhaseAssignmentRow[] | null) ?? [])
            .map((assignment) => assignment.employee_id)
            .filter(Boolean),
        );

        setAssignedEmployeeIds(ids);
      } catch (error) {
        console.error(
          'Błąd pobierania pracowników przypisanych do fazy:',
          error,
        );

        if (isMounted) {
          setAssignedEmployeeIds(new Set());
        }
      } finally {
        if (isMounted) {
          setAssignmentsLoading(false);
        }
      }
    };

    fetchAssignedEmployees();

    return () => {
      isMounted = false;
    };
  }, [open, phase?.id]);

  /**
   * Lista pracowników dostępnych do przypisania.
   * Usuwa osoby już przypisane do aktualnej fazy.
   */
  const availableEmployees = useMemo(() => {
    return allEmployees.filter(
      (employee) => !assignedEmployeeIds.has(employee.id),
    );
  }, [allEmployees, assignedEmployeeIds]);

  /**
   * Sugerowani pracownicy.
   * Sugestie również powstają wyłącznie z dostępnych pracowników.
   */
  const suggestedEmployees = useMemo<SuggestedEmployee[]>(() => {
    if (!availableEmployees.length) {
      return [];
    }

    const suggestions: SuggestedEmployee[] = [];
    const requiredSkills = new Set<string>();

    eventOffers.forEach((offer) => {
      offer.offer_items?.forEach((item: any) => {
        const product = item.offer_product;

        product?.staff_requirements?.forEach((requirement: any) => {
          requirement.required_skills?.forEach((skill: any) => {
            const skillName = skill.name || skill.skill?.name;

            if (skillName) {
              requiredSkills.add(skillName);
            }
          });
        });
      });
    });

    availableEmployees.forEach((employee) => {
      const employeeSkills = employee.employee_skills || [];

      const employeeSkillNames = employeeSkills
        .map(
          (employeeSkill: any) =>
            employeeSkill.skills?.name ||
            employeeSkill.skill?.name,
        )
        .filter(Boolean);

      let matchScore = 0;
      const matchedSkills: string[] = [];

      requiredSkills.forEach((requiredSkill) => {
        if (employeeSkillNames.includes(requiredSkill)) {
          matchScore += 20;
          matchedSkills.push(requiredSkill);
        }
      });

      if (employee.years_experience > 5) {
        matchScore += 10;
      }

      if (employee.years_experience > 10) {
        matchScore += 10;
      }

      if (matchScore > 0) {
        suggestions.push({
          employee,
          reason:
            matchedSkills.length > 0
              ? `Umiejętności: ${matchedSkills.join(', ')}`
              : 'Doświadczony pracownik',
          matchScore,
          requiredSkills: matchedSkills,
        });
      }
    });

    return suggestions
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, 5);
  }, [availableEmployees, eventOffers]);

  /**
   * Lista po zastosowaniu wyszukiwarki.
   * Bazuje na availableEmployees, więc osoby przypisane nie wrócą
   * nawet po wpisaniu ich nazwiska.
   */
  const filteredEmployees = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    if (!query) {
      return availableEmployees;
    }

    return availableEmployees.filter((employee) => {
      const fullName = `${employee.name || ''} ${
        employee.surname || ''
      }`
        .trim()
        .toLowerCase();

      const email = (employee.email || '').toLowerCase();

      return (
        fullName.includes(query) ||
        email.includes(query)
      );
    });
  }, [availableEmployees, searchQuery]);

  const otherPhases = useMemo(() => {
    return allPhases.filter(
      (availablePhase) => availablePhase.id !== phase.id,
    );
  }, [allPhases, phase.id]);

  useEffect(() => {
    if (!open) {
      setSelectedEmployee(null);
      setSelectedPhases(new Set([phase.id]));
      setShowPhaseSelector(false);
      setAssignToAllPhases(false);
      setSearchQuery('');
      setRole('technician');
      setAssignedEmployeeIds(new Set());
    }
  }, [open, phase.id]);

  useEffect(() => {
    if (!selectedEmployee || !phase) {
      return;
    }

    checkConflicts({
      employeeId: selectedEmployee.id,
      startTime: phase.start_time,
      endTime: phase.end_time,
    });
  }, [selectedEmployee, phase, checkConflicts]);

  const handleEmployeeSelect = (employee: any) => {
    if (assignedEmployeeIds.has(employee.id)) {
      showSnackbar(
        'Ten pracownik jest już przypisany do tej fazy',
        'warning',
      );
      return;
    }

    setSelectedEmployee(employee);

    if (otherPhases.length > 0) {
      setShowPhaseSelector(true);
    }
  };

  const handlePhaseToggle = (phaseId: string) => {
    setSelectedPhases((previous) => {
      const next = new Set(previous);

      if (next.has(phaseId)) {
        if (phaseId === phase.id) {
          return previous;
        }

        next.delete(phaseId);
      } else {
        next.add(phaseId);
      }

      return next;
    });
  };

  const handleSubmit = async () => {
    if (!selectedEmployee) {
      showSnackbar('Wybierz pracownika', 'warning');
      return;
    }

    if (assignedEmployeeIds.has(selectedEmployee.id)) {
      showSnackbar(
        'Ten pracownik jest już przypisany do tej fazy',
        'warning',
      );
      return;
    }

    try {
      const phaseIdsToAssign = assignToAllPhases
        ? allPhases.map((availablePhase) => availablePhase.id)
        : Array.from(selectedPhases);

      /**
       * Pobieramy istniejące przypisania wybranego pracownika
       * do wszystkich wybranych faz jednym zapytaniem.
       *
       * Dzięki temu nie próbujemy drugi raz dodać go do faz,
       * do których już jest przypisany.
       */
      const { data: existingAssignments, error: existingError } =
        await supabase
          .from('event_phase_assignments')
          .select('phase_id')
          .eq('employee_id', selectedEmployee.id)
          .in('phase_id', phaseIdsToAssign);

      if (existingError) {
        throw existingError;
      }

      const alreadyAssignedPhaseIds = new Set(
        (existingAssignments ?? []).map(
          (assignment: any) => assignment.phase_id,
        ),
      );

      const missingPhaseIds = phaseIdsToAssign.filter(
        (phaseId) => !alreadyAssignedPhaseIds.has(phaseId),
      );

      if (missingPhaseIds.length === 0) {
        showSnackbar(
          'Pracownik jest już przypisany do wszystkich wybranych faz',
          'info',
        );
        return;
      }

      const promises = missingPhaseIds.map((phaseId) => {
        const targetPhase = allPhases.find(
          (availablePhase) => availablePhase.id === phaseId,
        );

        if (!targetPhase) {
          return Promise.resolve();
        }

        return createAssignment({
          phase_id: phaseId,
          employee_id: selectedEmployee.id,
          role,
          assignment_start: targetPhase.start_time,
          assignment_end: targetPhase.end_time,
          phase_work_start: targetPhase.start_time,
          phase_work_end: targetPhase.end_time,
        }).unwrap();
      });

      await Promise.all(promises);

      setAssignedEmployeeIds((previous) => {
        const next = new Set(previous);

        if (missingPhaseIds.includes(phase.id)) {
          next.add(selectedEmployee.id);
        }

        return next;
      });

      const skippedCount =
        phaseIdsToAssign.length - missingPhaseIds.length;

      let message =
        missingPhaseIds.length === 1
          ? 'Pracownik został przypisany do 1 fazy'
          : `Pracownik został przypisany do ${missingPhaseIds.length} faz`;

      if (skippedCount > 0) {
        message += `. Pominięto ${skippedCount} już istniejących przypisań`;
      }

      showSnackbar(message, 'success');
      onClose();
    } catch (error: any) {
      console.error(
        'Błąd podczas przypisywania pracownika:',
        error,
      );

      showSnackbar(
        error?.data?.message ||
          error?.message ||
          'Błąd podczas przypisywania pracownika',
        'error',
      );
    }
  };

  if (!open) {
    return null;
  }

  const listLoading =
    employeesLoading || assignmentsLoading;

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-[#1c1f33] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#d3bb73]/20 px-6 py-4">
          <div className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-[#d3bb73]" />

            <div>
              <h2 className="text-lg font-semibold text-[#e5e4e2]">
                Dodaj pracownika do fazy
              </h2>

              <p className="text-sm text-[#e5e4e2]/50">
                {phase.name}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-[#e5e4e2]/50 hover:bg-[#e5e4e2]/10 hover:text-[#e5e4e2]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {listLoading ? (
            <div className="flex h-64 items-center justify-center">
              <div className="text-center">
                <div className="mb-2 text-[#d3bb73]">
                  Ładowanie pracowników...
                </div>

                <div className="text-sm text-[#e5e4e2]/50">
                  Pobieranie dostępnych osób
                </div>
              </div>
            </div>
          ) : employeesError ? (
            <div className="flex h-64 items-center justify-center">
              <div className="text-center">
                <div className="mb-2 text-red-400">
                  Nie udało się pobrać pracowników
                </div>

                <div className="text-sm text-[#e5e4e2]/50">
                  Odśwież stronę i spróbuj ponownie
                </div>
              </div>
            </div>
          ) : !selectedEmployee ? (
            <>
              {availableEmployees.length === 0 ? (
                <div className="flex h-64 items-center justify-center">
                  <div className="text-center">
                    <UserPlus className="mx-auto mb-3 h-10 w-10 text-[#e5e4e2]/30" />

                    <div className="font-medium text-[#e5e4e2]">
                      Wszyscy pracownicy są już przypisani
                    </div>

                    <div className="mt-1 text-sm text-[#e5e4e2]/50">
                      Do tej fazy nie można przypisać kolejnej dostępnej osoby
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  {suggestedEmployees.length > 0 && (
                    <div className="mb-6">
                      <div className="mb-3 flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-[#d3bb73]" />

                        <h3 className="text-sm font-semibold text-[#e5e4e2]">
                          Sugerowani pracownicy
                        </h3>
                      </div>

                      <div className="space-y-2">
                        {suggestedEmployees.map(
                          ({
                            employee,
                            reason,
                            matchScore,
                          }) => (
                            <button
                              key={employee.id}
                              type="button"
                              onClick={() =>
                                handleEmployeeSelect(employee)
                              }
                              className="w-full rounded-lg border border-[#d3bb73]/40 bg-[#d3bb73]/5 p-3 text-left transition-all hover:border-[#d3bb73] hover:bg-[#d3bb73]/10"
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                  {employee.avatar_url ? (
                                    <Image
                                      src={employee.avatar_url}
                                      alt={`${employee.name || ''} ${
                                        employee.surname || ''
                                      }`}
                                      width={40}
                                      height={40}
                                      className="h-10 w-10 rounded-full object-cover"
                                    />
                                  ) : (
                                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#d3bb73]/20 text-[#d3bb73]">
                                      {employee.name?.[0] || '?'}
                                    </div>
                                  )}

                                  <div>
                                    <div className="font-medium text-[#e5e4e2]">
                                      {employee.name}{' '}
                                      {employee.surname}
                                    </div>

                                    <div className="text-xs text-[#d3bb73]">
                                      {reason}
                                    </div>
                                  </div>
                                </div>

                                <div className="rounded-full bg-[#d3bb73]/20 px-3 py-1 text-xs font-bold text-[#d3bb73]">
                                  {matchScore}%
                                </div>
                              </div>
                            </button>
                          ),
                        )}
                      </div>
                    </div>
                  )}

                  <div>
                    <div className="mb-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Search className="h-4 w-4 text-[#e5e4e2]/50" />

                        <h3 className="text-sm font-semibold text-[#e5e4e2]">
                          {suggestedEmployees.length > 0
                            ? 'Dostępni pracownicy'
                            : 'Wybierz pracownika'}
                        </h3>
                      </div>

                      <span className="text-xs text-[#e5e4e2]/50">
                        {availableEmployees.length}{' '}
                        {availableEmployees.length === 1
                          ? 'dostępny pracownik'
                          : 'dostępnych pracowników'}
                      </span>
                    </div>

                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(event) =>
                        setSearchQuery(event.target.value)
                      }
                      placeholder="Wyszukaj pracownika po nazwisku lub e-mailu..."
                      className="mb-3 w-full rounded-lg border border-[#d3bb73]/20 bg-[#0d0f1a] px-4 py-2 text-[#e5e4e2] placeholder-[#e5e4e2]/30 focus:border-[#d3bb73] focus:outline-none"
                    />

                    {searchQuery && (
                      <div className="mb-2 text-xs text-[#e5e4e2]/50">
                        Znaleziono: {filteredEmployees.length}
                      </div>
                    )}

                    <div className="max-h-64 space-y-2 overflow-y-auto">
                      {filteredEmployees.length === 0 ? (
                        <div className="py-8 text-center text-sm text-[#e5e4e2]/50">
                          Nie znaleziono dostępnych pracowników
                        </div>
                      ) : (
                        filteredEmployees.map((employee) => (
                          <button
                            key={employee.id}
                            type="button"
                            onClick={() =>
                              handleEmployeeSelect(employee)
                            }
                            className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0d0f1a] p-3 text-left transition-all hover:border-[#d3bb73] hover:bg-[#d3bb73]/5"
                          >
                            <div className="flex items-center gap-3">
                              {employee.avatar_url ? (
                                <Image
                                  src={employee.avatar_url}
                                  alt={`${employee.name || ''} ${
                                    employee.surname || ''
                                  }`}
                                  width={40}
                                  height={40}
                                  className="h-10 w-10 rounded-full object-cover"
                                />
                              ) : (
                                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#e5e4e2]/10 text-[#e5e4e2]">
                                  {employee.name?.[0] || '?'}
                                </div>
                              )}

                              <div>
                                <div className="font-medium text-[#e5e4e2]">
                                  {employee.name}{' '}
                                  {employee.surname}
                                </div>

                                {employee.email && (
                                  <div className="text-xs text-[#e5e4e2]/50">
                                    {employee.email}
                                  </div>
                                )}
                              </div>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              <div className="mb-6 rounded-lg border border-[#d3bb73] bg-[#d3bb73]/10 p-4">
                <div className="mb-2 text-xs font-semibold uppercase text-[#e5e4e2]/50">
                  Wybrany pracownik
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {selectedEmployee.avatar_url ? (
                      <Image
                        src={selectedEmployee.avatar_url}
                        alt={`${selectedEmployee.name || ''} ${
                          selectedEmployee.surname || ''
                        }`}
                        width={48}
                        height={48}
                        className="h-12 w-12 rounded-full object-cover"
                      />
                    ) : (
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#d3bb73]/20 text-lg font-bold text-[#d3bb73]">
                        {selectedEmployee.name?.[0] || '?'}
                      </div>
                    )}

                    <div>
                      <div className="text-lg font-semibold text-[#e5e4e2]">
                        {selectedEmployee.name}{' '}
                        {selectedEmployee.surname}
                      </div>

                      {selectedEmployee.email && (
                        <div className="text-sm text-[#e5e4e2]/70">
                          {selectedEmployee.email}
                        </div>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setSelectedEmployee(null);
                      setShowPhaseSelector(false);
                    }}
                    className="text-sm text-[#e5e4e2]/50 hover:text-[#e5e4e2]"
                  >
                    Zmień
                  </button>
                </div>
              </div>

              {checkingConflicts && (
                <div className="mb-4 rounded-lg border border-[#d3bb73]/20 bg-[#d3bb73]/5 p-3 text-sm text-[#d3bb73]">
                  Sprawdzanie konfliktów czasowych...
                </div>
              )}

              {conflicts && conflicts.length > 0 && (
                <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 p-3">
                  <div className="mb-2 text-sm font-semibold text-red-400">
                    ⚠️ Znaleziono {conflicts.length} konfliktów czasowych
                  </div>

                  <div className="space-y-2">
                    {conflicts.map((conflict) => {
                      const startDate = new Date(
                        conflict.assignment_start,
                      );

                      const endDate = new Date(
                        conflict.assignment_end,
                      );

                      const formatDate = (date: Date) =>
                        date.toLocaleString('pl-PL', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        });

                      return (
                        <div
                          key={conflict.conflict_id}
                          className="rounded border border-red-400/20 bg-red-500/5 p-2"
                        >
                          <div className="mb-1 flex items-center gap-2 text-xs font-medium text-red-300">
                            {conflict.conflict_type ===
                              'absence' && (
                              <>
                                <span>🏖️</span>
                                <span>Nieobecność</span>
                              </>
                            )}

                            {conflict.conflict_type ===
                              'event' && (
                              <>
                                <span>📅</span>
                                <span>Wydarzenie</span>
                              </>
                            )}

                            {conflict.conflict_type ===
                              'phase' && (
                              <>
                                <span>⚙️</span>
                                <span>Faza wydarzenia</span>
                              </>
                            )}

                            {conflict.conflict_status && (
                              <span className="ml-auto rounded bg-red-400/20 px-2 py-0.5 text-[10px]">
                                {conflict.conflict_status}
                              </span>
                            )}
                          </div>

                          <div className="mb-1 text-xs font-semibold text-red-200">
                            {conflict.event_name}

                            {conflict.phase_name &&
                              ` - ${conflict.phase_name}`}
                          </div>

                          <div className="text-[11px] text-red-200/70">
                            {formatDate(startDate)} –{' '}
                            {formatDate(endDate)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="mb-6">
                <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                  Rola
                </label>

                <select
                  value={role}
                  onChange={(event) =>
                    setRole(event.target.value)
                  }
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0d0f1a] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                >
                  <option value="technician">Technik</option>
                  <option value="dj">DJ</option>
                  <option value="konferansjer">
                    Konferansjer
                  </option>
                  <option value="assistant">Asystent</option>
                  <option value="specialist">
                    Specjalista
                  </option>
                  <option value="coordinator">
                    Koordynator
                  </option>
                  <option value="driver">Kierowca</option>
                </select>
              </div>

              {showPhaseSelector && otherPhases.length > 0 && (
                <div className="mb-6">
                  <div className="mb-3 flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-[#d3bb73]" />

                    <h3 className="text-sm font-semibold text-[#e5e4e2]">
                      Przypisz również do innych faz?
                    </h3>
                  </div>

                  <label className="mb-4 flex cursor-pointer items-center gap-3 rounded-lg border-2 border-[#d3bb73] bg-[#d3bb73]/10 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={assignToAllPhases}
                      onChange={(event) =>
                        setAssignToAllPhases(
                          event.target.checked,
                        )
                      }
                      className="h-5 w-5 accent-[#d3bb73]"
                    />

                    <div className="flex-1">
                      <div className="text-sm font-bold text-[#e5e4e2]">
                        Przypisz do całego wydarzenia
                      </div>

                      <div className="text-xs text-[#e5e4e2]/60">
                        System przypisze pracownika do wszystkich{' '}
                        {allPhases.length} faz i pominie istniejące przypisania
                      </div>
                    </div>
                  </label>

                  {!assignToAllPhases && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 rounded-lg border border-[#d3bb73] bg-[#d3bb73]/10 px-3 py-2">
                        <input
                          type="checkbox"
                          checked
                          disabled
                          className="h-4 w-4"
                        />

                        <div className="flex-1">
                          <div className="text-sm font-medium text-[#e5e4e2]">
                            {phase.name}
                          </div>

                          <div className="text-xs text-[#e5e4e2]/50">
                            {new Date(
                              phase.start_time,
                            ).toLocaleString('pl-PL')}{' '}
                            –{' '}
                            {new Date(
                              phase.end_time,
                            ).toLocaleString('pl-PL')}
                          </div>
                        </div>
                      </div>

                      {otherPhases.map((availablePhase) => (
                        <label
                          key={availablePhase.id}
                          className="flex cursor-pointer items-center gap-2 rounded-lg border border-[#d3bb73]/20 bg-[#0d0f1a] px-3 py-2 transition-all hover:border-[#d3bb73] hover:bg-[#d3bb73]/5"
                        >
                          <input
                            type="checkbox"
                            checked={selectedPhases.has(
                              availablePhase.id,
                            )}
                            onChange={() =>
                              handlePhaseToggle(
                                availablePhase.id,
                              )
                            }
                            className="h-4 w-4"
                          />

                          <div className="flex-1">
                            <div className="text-sm font-medium text-[#e5e4e2]">
                              {availablePhase.name}
                            </div>

                            <div className="text-xs text-[#e5e4e2]/50">
                              {new Date(
                                availablePhase.start_time,
                              ).toLocaleString('pl-PL')}{' '}
                              –{' '}
                              {new Date(
                                availablePhase.end_time,
                              ).toLocaleString('pl-PL')}
                            </div>
                          </div>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {selectedEmployee && (
          <div className="border-t border-[#d3bb73]/20 px-6 py-4">
            <div className="flex justify-between">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-[#d3bb73]/20 px-4 py-2 text-[#e5e4e2] hover:bg-[#e5e4e2]/10"
              >
                Anuluj
              </button>

              <button
                type="button"
                onClick={handleSubmit}
                disabled={isLoading}
                className="rounded-lg bg-[#d3bb73] px-6 py-2 font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isLoading
                  ? 'Przypisywanie...'
                  : assignToAllPhases
                    ? `Przypisz do całego wydarzenia`
                    : `Przypisz do ${selectedPhases.size} ${
                        selectedPhases.size === 1
                          ? 'fazy'
                          : 'faz'
                      }`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};