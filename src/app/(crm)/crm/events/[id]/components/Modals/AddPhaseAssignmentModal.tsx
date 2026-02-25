'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { X, Search, UserPlus, Sparkles, Clock, Calendar } from 'lucide-react';
import {
  EventPhase,
  useCreatePhaseAssignmentMutation,
  useLazyGetEmployeeConflictsQuery,
} from '@/store/api/eventPhasesApi';
import { useGetEventPhasesQuery } from '@/store/api/eventPhasesApi';
import { useSnackbar } from '@/contexts/SnackbarContext';

interface AddPhaseAssignmentModalProps {
  open: boolean;
  onClose: () => void;
  phase: EventPhase;
  eventId: string;
  availableEmployees: any[];
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
  availableEmployees,
  eventOffers = [],
}) => {
  const [createAssignment, { isLoading }] = useCreatePhaseAssignmentMutation();
  const [checkConflicts, { data: conflicts, isFetching: checkingConflicts }] =
    useLazyGetEmployeeConflictsQuery();
  const { data: allPhases = [] } = useGetEventPhasesQuery(eventId);
  const { showSnackbar } = useSnackbar();

  // State
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState<any | null>(null);
  const [selectedPhases, setSelectedPhases] = useState<Set<string>>(new Set([phase.id]));
  const [showPhaseSelector, setShowPhaseSelector] = useState(false);
  const [role, setRole] = useState('technician');

  // Oblicz sugerowanych pracowników na podstawie wymagań w produktach
  const suggestedEmployees = useMemo<SuggestedEmployee[]>(() => {
    const suggestions: SuggestedEmployee[] = [];

    // Pobierz wymagane umiejętności z produktów w ofertach
    const requiredSkills = new Set<string>();
    eventOffers.forEach(offer => {
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
    availableEmployees.forEach(emp => {
      const empSkills = emp.employee_skills || emp.skills || [];
      const empSkillNames = empSkills.map((s: any) => s.skill?.name || s.name).filter(Boolean);

      // Oblicz match score
      let matchScore = 0;
      const matchedSkills: string[] = [];

      requiredSkills.forEach(reqSkill => {
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
          reason: matchedSkills.length > 0
            ? `Umiejętności: ${matchedSkills.join(', ')}`
            : 'Doświadczony pracownik',
          matchScore,
          requiredSkills: matchedSkills,
        });
      }
    });

    // Sortuj po score
    return suggestions.sort((a, b) => b.matchScore - a.matchScore).slice(0, 5);
  }, [availableEmployees, eventOffers]);

  // Filtruj pracowników przez wyszukiwarkę
  const filteredEmployees = useMemo(() => {
    if (!searchQuery) return availableEmployees;

    const query = searchQuery.toLowerCase();
    return availableEmployees.filter(emp => {
      const fullName = `${emp.name} ${emp.surname}`.toLowerCase();
      const email = (emp.email || '').toLowerCase();
      return fullName.includes(query) || email.includes(query);
    });
  }, [availableEmployees, searchQuery]);

  // Inne fazy do przypisania
  const otherPhases = useMemo(() => {
    return allPhases.filter(p => p.id !== phase.id);
  }, [allPhases, phase.id]);

  // Reset po zamknięciu
  useEffect(() => {
    if (!open) {
      setSelectedEmployee(null);
      setSelectedPhases(new Set([phase.id]));
      setShowPhaseSelector(false);
      setSearchQuery('');
      setRole('technician');
    }
  }, [open, phase.id]);

  // Sprawdź konflikty gdy wybrano pracownika
  useEffect(() => {
    if (selectedEmployee && phase) {
      checkConflicts({
        employeeId: selectedEmployee.id,
        startTime: phase.start_time,
        endTime: phase.end_time,
      });
    }
  }, [selectedEmployee, phase, checkConflicts]);

  const handleEmployeeSelect = (emp: any) => {
    setSelectedEmployee(emp);

    // Pokaż selector faz tylko jeśli są inne fazy
    if (otherPhases.length > 0) {
      setShowPhaseSelector(true);
    }
  };

  const handlePhaseToggle = (phaseId: string) => {
    setSelectedPhases(prev => {
      const next = new Set(prev);
      if (next.has(phaseId)) {
        // Nie pozwól usunąć głównej fazy
        if (phaseId === phase.id) return prev;
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

    try {
      // Przypisz do wszystkich wybranych faz
      const promises = Array.from(selectedPhases).map(phaseId => {
        const targetPhase = allPhases.find(p => p.id === phaseId);
        if (!targetPhase) return Promise.resolve();

        return createAssignment({
          phase_id: phaseId,
          employee_id: selectedEmployee.id,
          role,
          assignment_start: targetPhase.start_time,
          assignment_end: targetPhase.end_time,
        }).unwrap();
      });

      await Promise.all(promises);

      const phaseCount = selectedPhases.size;
      showSnackbar(
        `Pracownik przypisany do ${phaseCount} ${phaseCount === 1 ? 'fazy' : 'faz'}`,
        'success'
      );
      onClose();
    } catch (err: any) {
      showSnackbar(err.message || 'Błąd podczas przypisywania pracownika', 'error');
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-3xl max-h-[90vh] overflow-hidden rounded-lg bg-[#1c1f33] shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#d3bb73]/20 px-6 py-4">
          <div className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-[#d3bb73]" />
            <div>
              <h2 className="text-lg font-semibold text-[#e5e4e2]">Dodaj pracownika do fazy</h2>
              <p className="text-sm text-[#e5e4e2]/50">{phase.name}</p>
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
          {!selectedEmployee ? (
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
                              <img
                                src={employee.avatar_url}
                                alt={employee.name}
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
                <div className="mb-3 flex items-center gap-2">
                  <Search className="h-4 w-4 text-[#e5e4e2]/50" />
                  <h3 className="text-sm font-semibold text-[#e5e4e2]">
                    {suggestedEmployees.length > 0 ? 'Wszyscy pracownicy' : 'Wybierz pracownika'}
                  </h3>
                </div>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Wyszukaj pracownika..."
                  className="mb-3 w-full rounded-lg border border-[#d3bb73]/20 bg-[#0d0f1a] px-4 py-2 text-[#e5e4e2] placeholder-[#e5e4e2]/30 focus:border-[#d3bb73] focus:outline-none"
                />
                <div className="max-h-64 space-y-2 overflow-y-auto">
                  {filteredEmployees.map(employee => (
                    <button
                      key={employee.id}
                      onClick={() => handleEmployeeSelect(employee)}
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0d0f1a] p-3 text-left transition-all hover:border-[#d3bb73] hover:bg-[#d3bb73]/5"
                    >
                      <div className="flex items-center gap-3">
                        {employee.avatar_url ? (
                          <img
                            src={employee.avatar_url}
                            alt={employee.name}
                            className="h-10 w-10 rounded-full object-cover"
                          />
                        ) : (
                          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#e5e4e2]/10 text-[#e5e4e2]">
                            {employee.name?.[0]}
                          </div>
                        )}
                        <div>
                          <div className="font-medium text-[#e5e4e2]">
                            {employee.name} {employee.surname}
                          </div>
                          <div className="text-xs text-[#e5e4e2]/50">{employee.email}</div>
                        </div>
                      </div>
                    </button>
                  ))}
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
                      <img
                        src={selectedEmployee.avatar_url}
                        alt={selectedEmployee.name}
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
                    onClick={() => setSelectedEmployee(null)}
                    className="text-sm text-[#e5e4e2]/50 hover:text-[#e5e4e2]"
                  >
                    Zmień
                  </button>
                </div>
              </div>

              {/* Konflikty */}
              {conflicts && conflicts.length > 0 && (
                <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 p-3">
                  <div className="mb-1 text-sm font-semibold text-red-400">
                    ⚠️ Znaleziono konflikty czasowe
                  </div>
                  <div className="text-xs text-red-300">
                    Pracownik jest już przypisany do {conflicts.length} innych zadań w tym czasie
                  </div>
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
                  <option value="assistant">Asystent</option>
                  <option value="specialist">Specjalista</option>
                  <option value="coordinator">Koordynator</option>
                  <option value="driver">Kierowca</option>
                </select>
              </div>

              {/* Wybór faz */}
              {showPhaseSelector && otherPhases.length > 0 && (
                <div className="mb-6">
                  <div className="mb-3 flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-[#d3bb73]" />
                    <h3 className="text-sm font-semibold text-[#e5e4e2]">
                      Przypisz również do innych faz?
                    </h3>
                  </div>
                  <div className="space-y-2">
                    {/* Główna faza - zawsze zaznaczona */}
                    <div className="flex items-center gap-2 rounded-lg border border-[#d3bb73] bg-[#d3bb73]/10 px-3 py-2">
                      <input
                        type="checkbox"
                        checked={true}
                        disabled
                        className="h-4 w-4"
                      />
                      <div className="flex-1">
                        <div className="text-sm font-medium text-[#e5e4e2]">{phase.name}</div>
                        <div className="text-xs text-[#e5e4e2]/50">
                          {new Date(phase.start_time).toLocaleString('pl-PL')} -{' '}
                          {new Date(phase.end_time).toLocaleString('pl-PL')}
                        </div>
                      </div>
                    </div>

                    {/* Inne fazy */}
                    {otherPhases.map(p => (
                      <label
                        key={p.id}
                        className="flex cursor-pointer items-center gap-2 rounded-lg border border-[#d3bb73]/20 bg-[#0d0f1a] px-3 py-2 transition-all hover:border-[#d3bb73] hover:bg-[#d3bb73]/5"
                      >
                        <input
                          type="checkbox"
                          checked={selectedPhases.has(p.id)}
                          onChange={() => handlePhaseToggle(p.id)}
                          className="h-4 w-4"
                        />
                        <div className="flex-1">
                          <div className="text-sm font-medium text-[#e5e4e2]">{p.name}</div>
                          <div className="text-xs text-[#e5e4e2]/50">
                            {new Date(p.start_time).toLocaleString('pl-PL')} -{' '}
                            {new Date(p.end_time).toLocaleString('pl-PL')}
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
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
                disabled={isLoading}
                className="rounded-lg bg-[#d3bb73] px-6 py-2 font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-50"
              >
                {isLoading ? 'Przypisywanie...' : `Przypisz do ${selectedPhases.size} ${selectedPhases.size === 1 ? 'fazy' : 'faz'}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
