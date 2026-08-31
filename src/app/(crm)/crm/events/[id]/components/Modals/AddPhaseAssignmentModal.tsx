'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { X, Search, UserPlus, Sparkles, Calendar, AlertTriangle } from 'lucide-react';
import { EventPhase, PhaseConflict } from '@/store/api/eventPhasesApi';
import { useGetEventPhasesQuery } from '@/store/api/eventPhasesApi';
import { useGetEmployeesQuery } from '@/app/(crm)/crm/employees/store/employeeApi';
import { useGetEventEmployeesQuery } from '../../../store/api/eventsApi';
import { useSnackbar } from '@/contexts/SnackbarContext';
import Image from 'next/image';
import { supabase } from '@/lib/supabase/browser';
import { useEventWorkspace } from '@/components/crm/events/EventWorkspaceProvider';

interface AddPhaseAssignmentModalProps {
  open: boolean;
  onClose: () => void;
  phase: EventPhase;
  eventId: string;
  eventOffers?: any[]; // Oferty z produktami
}

interface SuggestedEmployee {
  employee: any;
  reason: string;
  matchScore: number; // 0-100
  requiredSkills: string[];
}

export const AddPhaseAssignmentModal: React.FC<AddPhaseAssignmentModalProps> = ({
  open,
  onClose,
  phase,
  eventId,
  eventOffers = [],
}) => {
  const [isSaving, setIsSaving] = useState(false);
  const [conflicts, setConflicts] = useState<PhaseConflict[]>([]);
  const [checkingConflicts, setCheckingConflicts] = useState(false);
  const [acceptConflicts, setAcceptConflicts] = useState(false);
  const [conflictReason, setConflictReason] = useState('');
  const { data: allPhases = [] } = useGetEventPhasesQuery(eventId);
  const { data: eventEmployees = [] } = useGetEventEmployeesQuery(eventId, {
    skip: !eventId,
  });
  const {
    data: allEmployees = [],
    isLoading: employeesLoading,
  } = useGetEmployeesQuery({
    activeOnly: true,
  });

  const { showSnackbar } = useSnackbar();
  const { refresh: refreshWorkspace } = useEventWorkspace();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState<any | null>(null);
  const [selectedPhases, setSelectedPhases] = useState<Set<string>>(new Set([phase.id]));
  const [existingPhaseIds, setExistingPhaseIds] = useState<Set<string>>(new Set());
  const [assignToAllPhases, setAssignToAllPhases] = useState(false);
  const [role, setRole] = useState('technician');

  const phasesToAssign = useMemo(
    () =>
      assignToAllPhases
        ? allPhases.filter((item) => !existingPhaseIds.has(item.id))
        : allPhases.filter((item) => selectedPhases.has(item.id) && !existingPhaseIds.has(item.id)),
    [allPhases, assignToAllPhases, existingPhaseIds, selectedPhases],
  );

  const selectedPhaseKey = useMemo(
    () => phasesToAssign.map((item) => item.id).sort().join(','),
    [phasesToAssign],
  );

  const absenceConflicts = useMemo(
    () => conflicts.filter((conflict) => conflict.conflict_type === 'absence'),
    [conflicts],
  );
  const realizationConflicts = useMemo(
    () => conflicts.filter((conflict) => conflict.conflict_type === 'phase'),
    [conflicts],
  );

  const eventTeamIds = useMemo(
    () => new Set(eventEmployees.map((assignment: any) => assignment.employee_id)),
    [eventEmployees],
  );

  // Oblicz sugerowanych pracowników na podstawie wymagań w produktach
  const suggestedEmployees = useMemo<SuggestedEmployee[]>(() => {
    if (!allEmployees.length) return [];

    const suggestions: SuggestedEmployee[] = [];

    // Pobierz wymagane umiejętności z produktów w ofertach
    const requiredSkills = new Set<string>();
    eventOffers.forEach((offer) => {
      offer.offer_items?.forEach((item: any) => {
        const product = item.offer_product;
        if (product?.staff_requirements) {
          product.staff_requirements.forEach((req: any) => {
            req.required_skills?.forEach((skill: any) => {
              requiredSkills.add(skill.name || skill.skill?.name);
            });
          });
        }
      });
    });

    // Oceń każdego pracownika
    allEmployees.forEach((emp) => {
      const empSkills = emp.employee_skills || [];
      const empSkillNames = empSkills
        .map((es: any) => es.skills?.name || es.skill?.name)
        .filter(Boolean);

      // Oblicz match score
      let matchScore = 0;
      const matchedSkills: string[] = [];

      requiredSkills.forEach((reqSkill) => {
        if (empSkillNames.includes(reqSkill)) {
          matchScore += 20;
          matchedSkills.push(reqSkill);
        }
      });

      // Dodaj punkty za doświadczenie
      if (emp.years_experience > 5) matchScore += 10;
      if (emp.years_experience > 10) matchScore += 10;

      // Jeśli pracownik ma jakieś dopasowanie, dodaj do sugestii
      if (matchScore > 0) {
        suggestions.push({
          employee: emp,
          reason:
            matchedSkills.length > 0
              ? `Umiejętności: ${matchedSkills.join(', ')}`
              : 'Doświadczony pracownik',
          matchScore,
          requiredSkills: matchedSkills,
        });
      }
    });

    // Sortuj po score
    return suggestions.sort((a, b) => b.matchScore - a.matchScore).slice(0, 5);
  }, [allEmployees, eventOffers]);

  // Filtruj pracowników przez wyszukiwarkę
  const filteredEmployees = useMemo(() => {
    const employees = [...allEmployees].sort((left, right) => {
      const leftInTeam = eventTeamIds.has(left.id) ? 0 : 1;
      const rightInTeam = eventTeamIds.has(right.id) ? 0 : 1;
      if (leftInTeam !== rightInTeam) return leftInTeam - rightInTeam;
      return `${left.name} ${left.surname}`.localeCompare(`${right.name} ${right.surname}`, 'pl');
    });

    if (!searchQuery) return employees;

    const query = searchQuery.toLowerCase();
    return employees.filter((emp) => {
      const fullName = `${emp.name} ${emp.surname}`.toLowerCase();
      const email = (emp.email || '').toLowerCase();
      return fullName.includes(query) || email.includes(query);
    });
  }, [allEmployees, eventTeamIds, searchQuery]);

  // Reset po zamknięciu
  useEffect(() => {
    if (!open) {
      setSelectedEmployee(null);
      setSelectedPhases(new Set([phase.id]));
      setExistingPhaseIds(new Set());
      setAssignToAllPhases(false);
      setSearchQuery('');
      setRole('technician');
      setConflicts([]);
      setCheckingConflicts(false);
      setAcceptConflicts(false);
      setConflictReason('');
    }
  }, [open, phase.id]);

  // Konflikt dotyczy wyłącznie realnej obecności w wybranych etapach timeline.
  // Sam dostęp do wydarzenia, autorstwo lub rola sprzedawcy nie blokują terminu.
  useEffect(() => {
    let cancelled = false;

    setAcceptConflicts(false);
    setConflictReason('');

    if (!selectedEmployee || phasesToAssign.length === 0) {
      setConflicts([]);
      setCheckingConflicts(false);
      return () => {
        cancelled = true;
      };
    }

    const loadConflicts = async () => {
      setCheckingConflicts(true);
      try {
        const results = await Promise.all(
          phasesToAssign.map(async (selectedPhase) => {
            const { data, error } = await supabase.rpc('get_employee_realization_conflicts', {
              p_employee_id: selectedEmployee.id,
              p_event_id: eventId,
              p_phase_id: selectedPhase.id,
            });
            if (error) throw error;

            return ((data || []) as PhaseConflict[]).map((conflict) => ({
              ...conflict,
              requested_phase_id: selectedPhase.id,
              requested_phase_name: selectedPhase.name,
            }));
          }),
        );

        if (cancelled) return;

        const uniqueConflicts = new Map<string, PhaseConflict>();
        results.flat().forEach((conflict) => {
          const key = `${conflict.requested_phase_id}:${conflict.conflict_type}:${conflict.conflict_id}`;
          uniqueConflicts.set(key, conflict);
        });
        setConflicts(Array.from(uniqueConflicts.values()));
      } catch (error) {
        if (cancelled) return;
        console.error('Employee realization conflict check failed:', error);
        setConflicts([]);
        showSnackbar('Nie udało się sprawdzić konfliktów obsady realizacyjnej', 'error');
      } finally {
        if (!cancelled) setCheckingConflicts(false);
      }
    };

    void loadConflicts();
    return () => {
      cancelled = true;
    };
  }, [eventId, phasesToAssign, selectedEmployee, selectedPhaseKey, showSnackbar]);

  const handleEmployeeSelect = async (emp: any) => {
    setSelectedEmployee(emp);
    setAssignToAllPhases(false);

    const phaseIds = allPhases.map((item) => item.id);
    if (phaseIds.length === 0) return;

    const { data, error } = await supabase
      .from('event_phase_assignments')
      .select('phase_id')
      .eq('employee_id', emp.id)
      .in('phase_id', phaseIds);

    if (error) {
      showSnackbar('Nie udało się sprawdzić obecnych przypisań pracownika', 'error');
      return;
    }

    const assignedIds = new Set<string>(
      (data || [])
        .map((assignment) => assignment.phase_id)
        .filter((phaseId): phaseId is string => Boolean(phaseId)),
    );
    setExistingPhaseIds(assignedIds);

    const preferredPhase = !assignedIds.has(phase.id)
      ? phase.id
      : allPhases.find((item) => !assignedIds.has(item.id))?.id;
    setSelectedPhases(preferredPhase ? new Set([preferredPhase]) : new Set());
  };

  const handlePhaseToggle = (phaseId: string) => {
    if (existingPhaseIds.has(phaseId)) return;

    setSelectedPhases((prev) => {
      const next = new Set(prev);
      if (next.has(phaseId)) {
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

    if (phasesToAssign.length === 0) {
      showSnackbar('Wybierz co najmniej jeden etap timeline', 'warning');
      return;
    }

    if (checkingConflicts) {
      showSnackbar('Poczekaj na zakończenie sprawdzania dostępności', 'warning');
      return;
    }

    if (absenceConflicts.length > 0) {
      showSnackbar(
        'Pracownik ma nieobecność w godzinach wybranego etapu. Najpierw wyjaśnij nieobecność.',
        'error',
      );
      return;
    }

    if (realizationConflicts.length > 0 && !acceptConflicts) {
      showSnackbar('Potwierdź świadomą akceptację konfliktu realizacyjnego', 'warning');
      return;
    }

    if (realizationConflicts.length > 0 && conflictReason.trim().length < 10) {
      showSnackbar('Opisz sposób rozdzielenia pracy (minimum 10 znaków)', 'warning');
      return;
    }

    try {
      setIsSaving(true);
      const { data: insertedCount, error } = await supabase.rpc(
        'assign_event_employee_to_phases_with_conflict_decision',
        {
          p_event_id: eventId,
          p_employee_id: selectedEmployee.id,
          p_phase_ids: phasesToAssign.map((item) => item.id),
          p_role: role,
          p_accept_conflicts: realizationConflicts.length > 0 && acceptConflicts,
          p_conflict_reason:
            realizationConflicts.length > 0 && acceptConflicts ? conflictReason.trim() : null,
        },
      );
      if (error) throw error;

      refreshWorkspace('event_phase_assignments');
      refreshWorkspace('employee_assignments');

      const phaseCount = Number(insertedCount ?? phasesToAssign.length);
      showSnackbar(
        realizationConflicts.length > 0 && acceptConflicts
          ? 'Pracownik przypisany. Konflikt zaakceptowany i zapisany z uzasadnieniem.'
          : assignToAllPhases
            ? `Pracownik przypisany do wszystkich etapów timeline (${phaseCount})`
            : `Pracownik przypisany do ${phaseCount} ${phaseCount === 1 ? 'etapu' : 'etapów'} timeline`,
        'success',
      );
      onClose();
    } catch (err: any) {
      showSnackbar(err?.message || 'Błąd podczas przypisywania pracownika', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-[#1c1f33] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#d3bb73]/20 px-6 py-4">
          <div className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-[#d3bb73]" />
            <div>
              <h2 className="text-lg font-semibold text-[#e5e4e2]">Dodaj pracownika do timeline</h2>
              <p className="text-sm text-[#e5e4e2]/50">
                Wybierz osobę i etapy, w których ma pracować
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-[#e5e4e2]/50 hover:bg-[#e5e4e2]/10 hover:text-[#e5e4e2]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {employeesLoading ? (
            <div className="flex h-64 items-center justify-center">
              <div className="text-center">
                <div className="mb-2 text-[#d3bb73]">Ładowanie pracowników...</div>
                <div className="text-sm text-[#e5e4e2]/50">Pobieranie listy z systemu</div>
              </div>
            </div>
          ) : !selectedEmployee ? (
            <>
              {/* Sugerowani pracownicy */}
              {suggestedEmployees.length > 0 && (
                <div className="mb-6">
                  <div className="mb-3 flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-[#d3bb73]" />
                    <h3 className="text-sm font-semibold text-[#e5e4e2]">Sugerowani pracownicy</h3>
                  </div>
                  <div className="space-y-2">
                    {suggestedEmployees.map(({ employee, reason, matchScore }) => (
                      <button
                        key={employee.id}
                        onClick={() => handleEmployeeSelect(employee)}
                        className="w-full rounded-lg border border-[#d3bb73]/40 bg-[#d3bb73]/5 p-3 text-left transition-all hover:border-[#d3bb73] hover:bg-[#d3bb73]/10"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            {employee.avatar_url ? (
                              <Image
                                src={employee.avatar_url}
                                alt={employee.name}
                                width={40}
                                height={40}
                                className="h-10 w-10 rounded-full object-cover"
                              />
                            ) : (
                              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#d3bb73]/20 text-[#d3bb73]">
                                {employee.name?.[0]}
                              </div>
                            )}
                            <div>
                              <div className="font-medium text-[#e5e4e2]">
                                {employee.name} {employee.surname}
                              </div>
                              <div className="text-xs text-[#d3bb73]">{reason}</div>
                            </div>
                          </div>
                          <div className="rounded-full bg-[#d3bb73]/20 px-3 py-1 text-xs font-bold text-[#d3bb73]">
                            {matchScore}%
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Wyszukiwarka */}
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Search className="h-4 w-4 text-[#e5e4e2]/50" />
                    <h3 className="text-sm font-semibold text-[#e5e4e2]">
                      {suggestedEmployees.length > 0 ? 'Wszyscy pracownicy' : 'Wybierz pracownika'}
                    </h3>
                  </div>
                  <span className="text-xs text-[#e5e4e2]/50">
                    {allEmployees.length} {allEmployees.length === 1 ? 'pracownik' : 'pracowników'}{' '}
                    w systemie
                  </span>
                </div>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Wyszukaj pracownika po nazwisku lub e-mailu..."
                  className="mb-3 w-full rounded-lg border border-[#d3bb73]/20 bg-[#0d0f1a] px-4 py-2 text-[#e5e4e2] placeholder-[#e5e4e2]/30 focus:border-[#d3bb73] focus:outline-none"
                />
                {searchQuery && (
                  <div className="mb-2 text-xs text-[#e5e4e2]/50">
                    Znaleziono: {filteredEmployees.length}{' '}
                    {filteredEmployees.length === 1
                      ? 'pracownik'
                      : filteredEmployees.length < 5
                        ? 'pracowników'
                        : 'pracowników'}
                  </div>
                )}
                <div className="max-h-64 space-y-2 overflow-y-auto">
                  {filteredEmployees.length === 0 ? (
                    <div className="py-8 text-center text-sm text-[#e5e4e2]/50">
                      Nie znaleziono pracowników pasujących do wyszukiwania
                    </div>
                  ) : (
                    filteredEmployees.map((employee) => (
                      <button
                        key={employee.id}
                        onClick={() => handleEmployeeSelect(employee)}
                        className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0d0f1a] p-3 text-left transition-all hover:border-[#d3bb73] hover:bg-[#d3bb73]/5"
                      >
                        <div className="flex items-center gap-3">
                          {employee.avatar_url ? (
                            <Image
                              src={employee.avatar_url}
                              alt={employee.name}
                              width={40}
                              height={40}
                              className="h-10 w-10 rounded-full object-cover"
                            />
                          ) : (
                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#e5e4e2]/10 text-[#e5e4e2]">
                              {employee.name?.[0]}
                            </div>
                          )}
                          <div>
                            <div className="flex items-center gap-2 font-medium text-[#e5e4e2]">
                              <span>{employee.name} {employee.surname}</span>
                              {eventTeamIds.has(employee.id) && (
                                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                                  Zespół wydarzenia
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-[#e5e4e2]/50">{employee.email}</div>
                          </div>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </>
          ) : (
            <>
              {/* Wybrany pracownik */}
              <div className="mb-6 rounded-lg border border-[#d3bb73] bg-[#d3bb73]/10 p-4">
                <div className="mb-2 text-xs font-semibold uppercase text-[#e5e4e2]/50">
                  Wybrany pracownik
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {selectedEmployee.avatar_url ? (
                      <Image
                        src={selectedEmployee.avatar_url}
                        alt={selectedEmployee.name}
                        width={48}
                        height={48}
                        className="h-12 w-12 rounded-full object-cover"
                      />
                    ) : (
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#d3bb73]/20 text-lg font-bold text-[#d3bb73]">
                        {selectedEmployee.name?.[0]}
                      </div>
                    )}
                    <div>
                      <div className="text-lg font-semibold text-[#e5e4e2]">
                        {selectedEmployee.name} {selectedEmployee.surname}
                      </div>
                      <div className="text-sm text-[#e5e4e2]/70">{selectedEmployee.email}</div>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setSelectedEmployee(null);
                      setExistingPhaseIds(new Set());
                    }}
                    className="text-sm text-[#e5e4e2]/50 hover:text-[#e5e4e2]"
                  >
                    Zmień
                  </button>
                </div>
              </div>

              {!eventTeamIds.has(selectedEmployee.id) && (
                <div className="mb-4 rounded-lg border border-blue-400/20 bg-blue-400/10 p-3 text-sm text-blue-100">
                  Ta osoba nie jest jeszcze w zespole wydarzenia. Przy zapisie otrzyma dostęp do
                  eventu i zostanie dodana do wybranych etapów timeline.
                </div>
              )}

              {/* Konflikty */}
              {checkingConflicts && (
                <div className="mb-4 rounded-lg border border-[#d3bb73]/20 bg-[#d3bb73]/5 p-3 text-sm text-[#e5e4e2]/65">
                  Sprawdzam faktyczną obecność pracownika w wybranych etapach…
                </div>
              )}

              {!checkingConflicts && conflicts.length > 0 && (
                <div className="mb-4 space-y-3">
                  <div
                    className={`rounded-lg border p-3 ${
                      absenceConflicts.length > 0
                        ? 'border-red-500/25 bg-red-500/10'
                        : 'border-amber-400/25 bg-amber-400/10'
                    }`}
                  >
                    <div
                      className={`mb-2 flex items-start gap-2 text-sm font-semibold ${
                        absenceConflicts.length > 0 ? 'text-red-300' : 'text-amber-200'
                      }`}
                    >
                      <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
                      <span>
                        {absenceConflicts.length > 0
                          ? 'Nieobecność blokuje przypisanie do realizacji'
                          : `Nakładająca się praca na ${realizationConflicts.length} ${
                              realizationConflicts.length === 1 ? 'etapie' : 'etapach'
                            }`}
                      </span>
                    </div>
                    <p className="mb-3 text-xs text-[#e5e4e2]/60">
                      Konflikt wynika wyłącznie z godzin pracy na timeline. Autor, sprzedawca i
                      osoby mające sam dostęp do innych wydarzeń nie są tutaj uwzględniane.
                    </p>

                    <div className="space-y-2">
                      {conflicts.map((conflict) => {
                        const formatDate = (value: string) =>
                          new Date(value).toLocaleString('pl-PL', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          });
                        const isAbsence = conflict.conflict_type === 'absence';

                        return (
                          <div
                            key={`${conflict.requested_phase_id}:${conflict.conflict_type}:${conflict.conflict_id}`}
                            className={`rounded border p-2 ${
                              isAbsence
                                ? 'border-red-400/20 bg-red-500/5'
                                : 'border-amber-300/20 bg-amber-300/5'
                            }`}
                          >
                            <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-[#e5e4e2]/80">
                              <span>{isAbsence ? 'Nieobecność' : 'Inna realizacja'}</span>
                              {conflict.requested_phase_name && (
                                <span className="rounded bg-white/5 px-2 py-0.5 text-[10px] text-[#e5e4e2]/55">
                                  Dotyczy: {conflict.requested_phase_name}
                                </span>
                              )}
                              {conflict.conflict_status && (
                                <span className="ml-auto rounded bg-white/5 px-2 py-0.5 text-[10px] text-[#e5e4e2]/55">
                                  {conflict.conflict_status === 'approved' && 'Zatwierdzona'}
                                  {conflict.conflict_status === 'pending' && 'Oczekuje'}
                                  {conflict.conflict_status === 'accepted' && 'Zaakceptowana'}
                                </span>
                              )}
                            </div>
                            <div className="mt-1 text-xs font-semibold text-[#e5e4e2]">
                              {conflict.event_name}
                              {conflict.phase_name && ` — ${conflict.phase_name}`}
                            </div>
                            <div className="mt-1 text-[11px] text-[#e5e4e2]/55">
                              {formatDate(conflict.assignment_start)} –{' '}
                              {formatDate(conflict.assignment_end)}
                            </div>
                            {conflict.conflict_details?.role && (
                              <div className="mt-1 text-[10px] text-[#e5e4e2]/45">
                                Rola na drugiej realizacji: {conflict.conflict_details.role}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {realizationConflicts.length > 0 && absenceConflicts.length === 0 && (
                    <div className="rounded-lg border border-amber-300/25 bg-[#111421] p-4">
                      <label className="flex cursor-pointer items-start gap-3">
                        <input
                          type="checkbox"
                          checked={acceptConflicts}
                          onChange={(event) => setAcceptConflicts(event.target.checked)}
                          className="mt-0.5 h-4 w-4 accent-[#d3bb73]"
                        />
                        <span>
                          <span className="block text-sm font-medium text-[#e5e4e2]">
                            Akceptuję nakładanie się pracy
                          </span>
                          <span className="mt-1 block text-xs leading-5 text-[#e5e4e2]/55">
                            Potwierdzam, że przejazd, godziny obecności i zakres koordynacji zostały
                            sprawdzone. Decyzja będzie widoczna w kontroli wydarzenia.
                          </span>
                        </span>
                      </label>

                      {acceptConflicts && (
                        <div className="mt-3">
                          <label className="mb-1 block text-xs font-medium text-[#d3bb73]">
                            Uzasadnienie i sposób podziału pracy
                          </label>
                          <textarea
                            value={conflictReason}
                            onChange={(event) => setConflictReason(event.target.value)}
                            rows={3}
                            placeholder="Np. koordynuje oba wydarzenia, a na miejscu jest w godz. 18:00–20:00; pozostały czas przejmuje lider techniczny."
                            className="w-full resize-none rounded-lg border border-[#d3bb73]/20 bg-[#0d0f1a] px-3 py-2 text-sm text-[#e5e4e2] placeholder:text-[#e5e4e2]/25 focus:border-[#d3bb73] focus:outline-none"
                          />
                          <div className="mt-1 text-right text-[10px] text-[#e5e4e2]/35">
                            Minimum 10 znaków
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Rola */}
              <div className="mb-6">
                <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Rola</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0d0f1a] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                >
                  <option value="technician">Technik</option>
                  <option value="dj">DJ</option>
                  <option value="konferansjer">Konferansjer</option>
                  <option value="assistant">Asystent</option>
                  <option value="specialist">Specjalista</option>
                  <option value="coordinator">Koordynator</option>
                  <option value="driver">Kierowca</option>
                </select>
              </div>

              {/* Wybór faz */}
              {allPhases.length > 0 && (
                <div className="mb-6">
                  <div className="mb-3 flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-[#d3bb73]" />
                    <h3 className="text-sm font-semibold text-[#e5e4e2]">
                      Wybierz etapy timeline
                    </h3>
                  </div>

                  {/* Checkbox: Przypisz do wszystkich etapów timeline */}
                  <label className="mb-4 flex cursor-pointer items-center gap-3 rounded-lg border-2 border-[#d3bb73] bg-[#d3bb73]/10 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={assignToAllPhases}
                      onChange={(e) => setAssignToAllPhases(e.target.checked)}
                      className="h-5 w-5 accent-[#d3bb73]"
                    />
                    <div className="flex-1">
                      <div className="text-sm font-bold text-[#e5e4e2]">
                        Przypisz do wszystkich etapów timeline
                      </div>
                      <div className="text-xs text-[#e5e4e2]/60">
                        Utworzy brakujące wpisy w{' '}
                        {allPhases.filter((item) => !existingPhaseIds.has(item.id)).length} etapach
                      </div>
                    </div>
                  </label>

                  {!assignToAllPhases && (
                    <div className="space-y-2">
                      {allPhases.map((p) => (
                        <label
                          key={p.id}
                          className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 transition-all hover:border-[#d3bb73] hover:bg-[#d3bb73]/5 ${
                            selectedPhases.has(p.id)
                              ? 'border-[#d3bb73] bg-[#d3bb73]/10'
                              : 'border-[#d3bb73]/20 bg-[#0d0f1a]'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={selectedPhases.has(p.id)}
                            onChange={() => handlePhaseToggle(p.id)}
                            disabled={existingPhaseIds.has(p.id)}
                            className="h-4 w-4"
                          />
                          <div className="flex-1">
                            <div className="flex items-center gap-2 text-sm font-medium text-[#e5e4e2]">
                              <span>{p.name}</span>
                              {existingPhaseIds.has(p.id) && (
                                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-300">
                                  Już przypisany
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-[#e5e4e2]/50">
                              {new Date(p.start_time).toLocaleString('pl-PL')} -{' '}
                              {new Date(p.end_time).toLocaleString('pl-PL')}
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

        {/* Footer */}
        {selectedEmployee && (
          <div className="border-t border-[#d3bb73]/20 px-6 py-4">
            <div className="flex justify-between">
              <button
                onClick={onClose}
                className="rounded-lg border border-[#d3bb73]/20 px-4 py-2 text-[#e5e4e2] hover:bg-[#e5e4e2]/10"
              >
                Anuluj
              </button>
              <button
                onClick={handleSubmit}
                disabled={isSaving || checkingConflicts}
                className="rounded-lg bg-[#d3bb73] px-6 py-2 font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-50"
              >
                {isSaving
                  ? 'Przypisywanie...'
                  : checkingConflicts
                    ? 'Sprawdzanie dostępności...'
                    : realizationConflicts.length > 0 && acceptConflicts
                      ? 'Przypisz i zaakceptuj konflikt'
                      : `Przypisz do ${phasesToAssign.length} ${
                          phasesToAssign.length === 1 ? 'etapu' : 'etapów'
                        }`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
