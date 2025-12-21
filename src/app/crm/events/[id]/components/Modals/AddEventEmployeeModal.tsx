import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Loader2, X } from 'lucide-react';
import { useEmployees } from '@/app/crm/employees/hooks/useEmployees';
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

  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();

  const { list: employees, loading } = useEmployees({ activeOnly: true });

  const { employees: eventEmployees, addEmployee } = useEventTeam(eventId);

  useEffect(() => {
    if (isOpen) {
      fetchAccessLevels();
    }
  }, [isOpen]);

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

  if (!isOpen) return null;

  const handleSubmit = async () => {

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 p-4">
      <div className="my-8 max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-[#d3bb73]/20 bg-[#0f1119] p-6">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-light text-[#e5e4e2]">Dodaj osobę do zespołu</h2>
          <button onClick={onClose} className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]">
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
            >
              <option value="">Wybierz pracownika...</option>

              {!loading && employees ? (
                employees?.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name} {emp.surname} {emp.occupation ? `- ${emp.occupation}` : ''}
                  </option>
                ))
              ) : (
               <Loader2 className="w-4 h-4 animate-spin" />
              )}
            </select>
          </div>

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
              className="rounded-lg px-4 py-2 text-[#e5e4e2]/60 hover:bg-[#1c1f33]"
            >
              Anuluj
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
