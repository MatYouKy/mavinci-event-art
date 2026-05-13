import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { Loader2, X } from 'lucide-react';
import { useEmployees } from '@/app/(crm)/crm/employees/hooks/useEmployees';
import { useEventTeam } from '../../../hooks/useEventTeam';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';

export function AddEventEmployeeModal({
  isOpen,
  onClose,
  eventId,
}: {
  isOpen: boolean;
  onClose: () => void;
  eventId: string;
}) {
  const [selectedEmployee, setSelectedEmployee] = useState('');
  const [role, setRole] = useState('');
  const [responsibilities, setResponsibilities] = useState('');
  const [accessLevels, setAccessLevels] = useState<any[]>([]);
  const [selectedAccessLevel, setSelectedAccessLevel] = useState('');
  const [canEditEvent, setCanEditEvent] = useState(false);
  const [canEditAgenda, setCanEditAgenda] = useState(false);
  const [canEditTasks, setCanEditTasks] = useState(false);
  const [canEditFiles, setCanEditFiles] = useState(false);
  const [canEditEquipment, setCanEditEquipment] = useState(false);
  const [canInviteMembers, setCanInviteMembers] = useState(false);
  const [canViewBudget, setCanViewBudget] = useState(false);
  const [employeesInPhases, setEmployeesInPhases] = useState<any[]>([]);
  const [loadingPhases, setLoadingPhases] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();

  const { list: employees, loading } = useEmployees({ activeOnly: true });

  const {
    employees: eventEmployees,
    addEmployee,
    isLoading: isAddingEmployee,
  } = useEventTeam(eventId);

  useEffect(() => {
    if (isOpen) {
      fetchAccessLevels();
      fetchEmployeesInPhases();
    }
  }, [isOpen, eventId]);

  // Realtime subscription for phase assignments
  useEffect(() => {
    if (!isOpen || !eventId) return;

    const channel = supabase
      .channel(`event_phase_assignments_${eventId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'event_phase_assignments',
        },
        (payload) => {
          fetchEmployeesInPhases();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isOpen, eventId]);

  const fetchAccessLevels = async () => {
    const { data, error } = await supabase.from('access_levels').select('*').order('order_index');

    if (!error && data) {
      setAccessLevels(data);
      const defaultLevel = data.find((l) => l.slug === 'employee');
      if (defaultLevel) {
        setSelectedAccessLevel(defaultLevel.id);
      }
    }
  };

  const fetchEmployeesInPhases = async () => {
    setLoadingPhases(true);
    try {
      const { data: phaseAssignments, error } = await supabase
        .from('event_phase_assignments')
        .select(
          `
          employee_id,
          phase_id,
          assignment_start,
          assignment_end,
          phase_work_start,
          phase_work_end,
          event_phases!inner(
            id,
            name,
            start_time,
            end_time,
            event_id
          )
        `,
        )
        .eq('event_phases.event_id', eventId);

      if (error) throw error;

      const employeeMap = new Map();
      phaseAssignments?.forEach((assignment: any) => {
        const empId = assignment.employee_id;
        if (!employeeMap.has(empId)) {
          employeeMap.set(empId, {
            employee_id: empId,
            phases: [],
          });
        }
        employeeMap.get(empId).phases.push({
          phase_id: assignment.phase_id,
          phase_name: assignment.event_phases.name,
          assignment_start: assignment.assignment_start,
          assignment_end: assignment.assignment_end,
          phase_work_start: assignment.phase_work_start,
          phase_work_end: assignment.phase_work_end,
        });
      });

      setEmployeesInPhases(Array.from(employeeMap.values()));
    } catch (error) {
      console.error('Error fetching employees in phases:', error);
      showSnackbar('Błąd podczas pobierania pracowników z faz', 'error');
    } finally {
      setLoadingPhases(false);
    }
  };

  const availableEmployees = useMemo(() => {
    if (!employees) return [];

    const employeesInPhasesIds = new Set(employeesInPhases.map((e) => e.employee_id));
    const alreadyAssignedIds = new Set(eventEmployees?.map((e: any) => e.employee_id) || []);

    return employees.filter(
      (emp) => employeesInPhasesIds.has(emp.id) && !alreadyAssignedIds.has(emp.id),
    );
  }, [employees, employeesInPhases, eventEmployees]);

  const selectedEmployeePhases = useMemo(() => {
    if (!selectedEmployee) return [];
    const employeeData = employeesInPhases.find((e) => e.employee_id === selectedEmployee);
    return employeeData?.phases || [];
  }, [selectedEmployee, employeesInPhases]);

  const handleSubmit = async () => {
    setIsSubmitting(true);
    if (!selectedEmployee) {
      const confirmed = await showConfirm('Wybierz pracownika', 'error');
      if (!confirmed) return;
      return;
    }
    const permissions = {
      can_edit_event: canEditEvent,
      can_edit_agenda: canEditAgenda,
      can_edit_tasks: canEditTasks,
      can_edit_files: canEditFiles,
      can_edit_equipment: canEditEquipment,
      can_invite_members: canInviteMembers,
      can_view_budget: canViewBudget,
    };
    try {
      await addEmployee({
        employeeId: selectedEmployee,
        role,
        responsibilities,
        access_level_id: selectedAccessLevel,
        permissions,
      });
      setSelectedEmployee('');
      setRole('');
      setResponsibilities('');
      setCanEditEvent(false);
      setCanEditAgenda(false);
      setCanEditTasks(false);
      setCanEditFiles(false);
      setCanEditEquipment(false);
      setCanInviteMembers(false);
      setCanViewBudget(false);
      showSnackbar('Pracownik dodany do zespołu', 'success');
      onClose();
    } catch (error) {
      console.error('Error adding employee:', error);
      showSnackbar('Błąd podczas dodawania pracownika', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const hasAnyPermission =
    canEditEvent ||
    canEditAgenda ||
    canEditTasks ||
    canEditFiles ||
    canEditEquipment ||
    canInviteMembers ||
    canViewBudget;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center overflow-y-auto bg-black/50 p-4">
      <div className="relative my-8 max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-[#d3bb73]/20 bg-[#0f1119] p-6">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-light text-[#e5e4e2]">Dodaj osobę do zespołu</h2>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Pracownik</label>
            <select
              value={selectedEmployee}
              onChange={(e) => setSelectedEmployee(e.target.value)}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              disabled={loading || loadingPhases}
            >
              <option value="">
                {loading || loadingPhases
                  ? 'Ładowanie...'
                  : availableEmployees.length === 0
                    ? 'Brak pracowników przypisanych do faz'
                    : 'Wybierz pracownika...'}
              </option>

              {!loading && !loadingPhases && availableEmployees.length > 0 ? (
                availableEmployees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name} {emp.surname} {emp.occupation ? `- ${emp.occupation}` : ''}
                  </option>
                ))
              ) : loading || loadingPhases ? (
                <option disabled>Ładowanie...</option>
              ) : null}
            </select>
            <p className="mt-1 text-xs text-[#e5e4e2]/40">
              Widoczni są tylko pracownicy przypisani do faz wydarzenia
            </p>
          </div>

          {selectedEmployeePhases.length > 0 && (
            <div className="rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33]/50 p-3">
              <label className="mb-2 block text-sm font-medium text-[#e5e4e2]/80">
                Przypisane fazy
              </label>
              <div className="space-y-2">
                {selectedEmployeePhases.map((phase: any) => (
                  <div
                    key={phase.phase_id}
                    className="flex items-start justify-between rounded-md bg-[#0f1119] p-2"
                  >
                    <div className="flex-1">
                      <p className="text-sm font-medium text-[#d3bb73]">{phase.phase_name}</p>
                      <p className="mt-1 text-xs text-[#e5e4e2]/60">
                        Praca:{' '}
                        {new Date(phase.phase_work_start).toLocaleString('pl-PL', {
                          day: '2-digit',
                          month: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}{' '}
                        -{' '}
                        {new Date(phase.phase_work_end).toLocaleString('pl-PL', {
                          day: '2-digit',
                          month: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Rola w evencie</label>
            <input
              type="text"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              placeholder="np. Lead Audio, Technician..."
            />
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Zakres odpowiedzialności</label>
            <textarea
              value={responsibilities}
              onChange={(e) => setResponsibilities(e.target.value)}
              className="min-h-[80px] w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              placeholder="Opisz zakres obowiązków..."
            />
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Poziom dostępu</label>
            <select
              value={selectedAccessLevel}
              onChange={(e) => setSelectedAccessLevel(e.target.value)}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
            >
              {accessLevels.map((level) => (
                <option key={level.id} value={level.id}>
                  {level.name} - {level.description}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-[#e5e4e2]/40">
              Określa domyślny zakres widoczności dla tej osoby
            </p>
          </div>

          <div className="border-t border-[#d3bb73]/10 pt-4">
            <label className="mb-3 flex items-center gap-2 text-sm text-[#e5e4e2]/80">
              <input
                type="checkbox"
                checked={hasAnyPermission}
                onChange={(e) => {
                  const checked = e.target.checked;
                  if (!checked) {
                    setCanEditEvent(false);
                    setCanEditAgenda(false);
                    setCanEditTasks(false);
                    setCanEditFiles(false);
                    setCanEditEquipment(false);
                    setCanInviteMembers(false);
                    setCanViewBudget(false);
                  }
                }}
                className="h-4 w-4 rounded border-[#d3bb73]/20 bg-[#1c1f33] text-[#d3bb73] focus:ring-[#d3bb73]"
              />
              <span className="font-medium">Nadaj uprawnienia współpracownika</span>
            </label>

            {hasAnyPermission && (
              <div className="ml-6 space-y-2 rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33]/50 p-3">
                <p className="mb-3 text-xs text-[#e5e4e2]/60">
                  Zaznacz uprawnienia które chcesz nadać:
                </p>
                <label className="flex items-center gap-2 text-sm text-[#e5e4e2]/70">
                  <input
                    type="checkbox"
                    checked={canEditEvent}
                    onChange={(e) => setCanEditEvent(e.target.checked)}
                    className="h-4 w-4 rounded border-[#d3bb73]/20 bg-[#1c1f33] text-[#d3bb73]"
                  />
                  Edycja wydarzenia (nazwa, data, lokalizacja)
                </label>
                <label className="flex items-center gap-2 text-sm text-[#e5e4e2]/70">
                  <input
                    type="checkbox"
                    checked={canEditAgenda}
                    onChange={(e) => setCanEditAgenda(e.target.checked)}
                    className="h-4 w-4 rounded border-[#d3bb73]/20 bg-[#1c1f33] text-[#d3bb73]"
                  />
                  Edycja agendy
                </label>
                <label className="flex items-center gap-2 text-sm text-[#e5e4e2]/70">
                  <input
                    type="checkbox"
                    checked={canEditTasks}
                    onChange={(e) => setCanEditTasks(e.target.checked)}
                    className="h-4 w-4 rounded border-[#d3bb73]/20 bg-[#1c1f33] text-[#d3bb73]"
                  />
                  Zarządzanie zadaniami
                </label>
                <label className="flex items-center gap-2 text-sm text-[#e5e4e2]/70">
                  <input
                    type="checkbox"
                    checked={canEditFiles}
                    onChange={(e) => setCanEditFiles(e.target.checked)}
                    className="h-4 w-4 rounded border-[#d3bb73]/20 bg-[#1c1f33] text-[#d3bb73]"
                  />
                  Zarządzanie plikami
                </label>
                <label className="flex items-center gap-2 text-sm text-[#e5e4e2]/70">
                  <input
                    type="checkbox"
                    checked={canEditEquipment}
                    onChange={(e) => setCanEditEquipment(e.target.checked)}
                    className="h-4 w-4 rounded border-[#d3bb73]/20 bg-[#1c1f33] text-[#d3bb73]"
                  />
                  Zarządzanie sprzętem
                </label>
                <label className="flex items-center gap-2 text-sm text-[#e5e4e2]/70">
                  <input
                    type="checkbox"
                    checked={canInviteMembers}
                    onChange={(e) => setCanInviteMembers(e.target.checked)}
                    className="h-4 w-4 rounded border-[#d3bb73]/20 bg-[#1c1f33] text-[#d3bb73]"
                  />
                  Zapraszanie członków zespołu
                </label>
                <label className="flex items-center gap-2 text-sm text-[#e5e4e2]/70">
                  <input
                    type="checkbox"
                    checked={canViewBudget}
                    onChange={(e) => setCanViewBudget(e.target.checked)}
                    className="h-4 w-4 rounded border-[#d3bb73]/20 bg-[#1c1f33] text-[#d3bb73]"
                  />
                  Widok budżetu
                </label>
              </div>
            )}
          </div>

          <div className="flex gap-3 pt-4">
            <button
              onClick={handleSubmit}
              className="flex-1 rounded-lg bg-[#d3bb73] px-4 py-2 font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
            >
              Dodaj
            </button>
            <button
              onClick={onClose}
              disabled={isSubmitting}
              className="rounded-lg px-4 py-2 text-[#e5e4e2]/60 hover:bg-[#1c1f33]"
            >
              Anuluj
            </button>
          </div>
        </div>
        {isSubmitting && (
          <div className="absolute inset-0 z-50 flex items-center justify-center rounded-xl">
            {/* blur + przyciemnienie */}
            <div className="absolute inset-0 rounded-xl bg-black/40 backdrop-blur-[1.2px]" />

            {/* loader */}
            <div className="flex items-center justify-center p-8">
              <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-[#d3bb73]"></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
