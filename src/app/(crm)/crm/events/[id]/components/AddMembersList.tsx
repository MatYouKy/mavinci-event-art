import { systemLabel } from '@/lib/ui/systemLabels';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { X, Mail, Send } from 'lucide-react';
import { EmployeeAvatar } from '@/components/EmployeeAvatar';
import { Pencil as EditIcon, UserCheck, UserMinus, Trash2, User, ChevronUp, ChevronDown, AlertCircle, Car } from 'lucide-react';
import {
  mapTeamTransportVehicles,
  summarizeTeamTransport,
  TEAM_TRANSPORT_VEHICLE_SELECT,
  teamTransportVehicleLabel,
  type TeamTransportVehicle,
} from '@/lib/CRM/events/teamTransport';
import { Employee } from '@/lib/permissions';
import ResponsiveActionBar from '@/components/crm/ResponsiveActionBar';
import { IEmployee } from '@/app/(crm)/crm/employees/type';
import { EmployeeAssignment } from '@/components/crm/Calendar';
import { useSnackbar } from '@/contexts/SnackbarContext';

interface TeamMembersListProps {
  eventId: string;
  employees: Employee[] | any[];
  onRemove: (id: string) => void;
  canManageTeam?: boolean;
  currentUserId?: string | null;
  eventCreatorId?: string;
}

const getEmployeeLabel = (employee?: any) => {
  if (!employee) return 'Brak danych pracownika';

  if (employee.nickname && employee.nickname.trim().length > 0) {
    return employee.nickname;
  }

  const name = `${employee.name ?? ''} ${employee.surname ?? ''}`.trim();
  return name.length > 0 ? name : 'Brak danych pracownika';
};

export function TeamMembersList({
  eventId,
  employees,
  onRemove,
  canManageTeam = false,
  currentUserId = null,
  eventCreatorId,
}: TeamMembersListProps) {
  const { showSnackbar } = useSnackbar();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRole, setEditRole] = useState('');
  const [editResponsibilities, setEditResponsibilities] = useState('');
  const [sendingInvitation, setSendingInvitation] = useState<string | null>(null);
  const [leadership, setLeadership] = useState<any>(null);
  const [leaderBusy, setLeaderBusy] = useState(false);
  const [leaderError, setLeaderError] = useState('');
  // Transport: auta wydarzenia (kierowca z logistyki) i przypisanie pozostałych osób do aut.
  const [transportVehicles, setTransportVehicles] = useState<TeamTransportVehicle[] | null>(null);
  const [transportFor, setTransportFor] = useState<any | null>(null);
  const [transportBusy, setTransportBusy] = useState(false);
  const loadTransport = useCallback(async () => {
    const { data, error } = await supabase
      .from('event_vehicles')
      .select(TEAM_TRANSPORT_VEHICLE_SELECT)
      .eq('event_id', eventId)
      .order('created_at', { ascending: true });
    setTransportVehicles(error ? null : mapTeamTransportVehicles((data || []) as any[]));
  }, [eventId]);
  useEffect(() => {
    void loadTransport();
    window.addEventListener('focus', loadTransport);
    return () => window.removeEventListener('focus', loadTransport);
  }, [loadTransport, employees.length]);
  const transportSummary = transportVehicles && transportVehicles.length > 0
    ? summarizeTeamTransport(transportVehicles, employees.filter((item: any) => item.employee).map((item: any) => ({
      employeeId: String(item.employee_id || item.employee?.id || ''),
      transportVehicleId: item.transport_event_vehicle_id ?? null,
      rejected: item.status === 'rejected',
    })))
    : null;
  const setTransport = async (assignmentId: string, vehicleId: string | null) => {
    if (transportBusy) return;
    setTransportBusy(true);
    try {
      const { error } = await supabase
        .from('employee_assignments')
        .update({ transport_event_vehicle_id: vehicleId })
        .eq('id', assignmentId)
        .eq('event_id', eventId);
      if (error) throw error;
      setTransportFor(null);
      await loadTransport();
      showSnackbar(vehicleId ? 'Zapisano transport' : 'Bez auta — dojazd własny', 'success');
    } catch (error: any) {
      showSnackbar(error?.code === 'PGRST204'
        ? 'Przypisanie do auta wymaga aktualizacji bazy (migracja 20261112214000).'
        : error?.message || 'Nie udało się zapisać transportu.', 'error');
    } finally {
      setTransportBusy(false);
    }
  };
  const loadLeadership = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_event_realization_assignment', {
      p_event_id: eventId,
    });
    if (error) {
      console.error('Nie udało się odczytać kierownika realizacji:', error);
      setLeaderError('Nie udało się odczytać kierownika realizacji. Spróbuj ponownie.');
      setLeadership(null);
    } else {
      setLeadership(data);
      setLeaderError('');
    }
  }, [eventId]);
  useEffect(() => {
    void loadLeadership();
    window.addEventListener('focus', loadLeadership);
    return () => window.removeEventListener('focus', loadLeadership);
  }, [loadLeadership]);
  const changeLeader = async (employeeId: string, revoke: boolean) => {
    if (leaderBusy) return;
    setLeaderBusy(true);
    try {
      const { error } = await supabase.rpc(
        revoke ? 'revoke_realization_manager' : 'appoint_realization_manager',
        { p_event_id: eventId, p_employee_id: employeeId },
      );
      if (error) throw error;
      await loadLeadership();
      window.dispatchEvent(new Event('realization-manager-changed'));
      showSnackbar(revoke ? 'Odebrano rolę kierownika realizacji.' : 'Wyznaczono kierownika realizacji.', 'success');
    } catch (error: any) {
      showSnackbar(error.message || 'Nie udało się zmienić kierownika realizacji.', 'error');
    } finally {
      setLeaderBusy(false);
    }
  };


  const [permissionsModal, setPermissionsModal] = useState<{
    isOpen: boolean;
    assignment: any;
  } | null>(null);
  const [permissionsForm, setPermissionsForm] = useState({
    can_edit_event: false,
    can_edit_phases: false,
    can_edit_agenda: false, 
    can_edit_tasks: false,
    can_edit_files: false,
    can_edit_equipment: false,
    can_invite_members: false,
    can_view_budget: false,
  });

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  const openPermissionsModal = (assignment: any) => {
    setPermissionsForm({
      can_edit_event: assignment.can_edit_event || false,
      can_edit_phases: assignment.can_edit_phases || false,
      can_edit_agenda: assignment.can_edit_agenda || false,
      can_edit_tasks: assignment.can_edit_tasks || false,
      can_edit_files: assignment.can_edit_files || false,
      can_edit_equipment: assignment.can_edit_equipment || false,
      can_invite_members: assignment.can_invite_members || false,
      can_view_budget: assignment.can_view_budget || false,
    });
    setPermissionsModal({ isOpen: true, assignment });
  };

  const savePermissions = async () => {
    if (!permissionsModal) return;

    try {
      let { error } = await supabase
        .from('employee_assignments')
        .update({
          ...permissionsForm,
          permissions_updated_at: new Date().toISOString(),
        })
        .eq('id', permissionsModal.assignment.id);

      if (error?.code === 'PGRST204' && error.message?.includes('can_edit_phases')) {
        const { can_edit_phases: _phasePermission, ...compatiblePermissions } = permissionsForm;
        const retry = await supabase
          .from('employee_assignments')
          .update({
            ...compatiblePermissions,
            permissions_updated_at: new Date().toISOString(),
          })
          .eq('id', permissionsModal.assignment.id);
        error = retry.error;
      }

      if (error) throw error;

      setPermissionsModal(null);
      window.location.reload();
    } catch (error) {
      console.error('Error updating permissions:', error);
      alert('Błąd podczas aktualizacji uprawnień');
    }
  };

  const startEdit = (item: any) => {
    setEditingId(item.id);
    setEditRole(item.role || '');
    setEditResponsibilities(item.responsibilities || '');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditRole('');
    setEditResponsibilities('');
  };

  const saveEdit = async (id: string) => {
    try {
      const { error } = await supabase
        .from('employee_assignments')
        .update({
          role: editRole,
          responsibilities: editResponsibilities,
        })
        .eq('id', id);

      if (error) throw error;

      setEditingId(null);
      window.location.reload();
    } catch (error) {
      console.error('Error updating assignment:', error);
      alert('Błąd podczas aktualizacji');
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'accepted':
        return (
          <span className="rounded-full bg-green-500/20 px-2 py-1 text-xs text-green-400">
            Zaakceptowano
          </span>
        );
      case 'rejected':
        return (
          <span className="rounded-full bg-red-500/20 px-2 py-1 text-xs text-red-400">
            Odrzucono
          </span>
        );
      default:
        return (
          <span className="rounded-full bg-yellow-500/20 px-2 py-1 text-xs text-yellow-400">
            Oczekuje
          </span>
        );
    }
  };

  const sendInvitation = async (
    assignmentId: string,
    options: { includePhases?: boolean; mode?: 'invitation' | 'timeline_update' } = {},
  ) => {
    setSendingInvitation(assignmentId);
    try {
      const result = await supabase.functions.invoke('send-event-invitation', {
        body: {
          assignmentId,
          includePhases: options.includePhases ?? false,
          mode: options.mode ?? 'invitation',
        },
      });

      if (result.error) {
        console.error('Error sending invitation:', result.error);
        showSnackbar(
          options.mode === 'timeline_update'
            ? 'Nie wysłano harmonogramu. Sprawdź, czy pracownik ma przypisaną co najmniej jedną fazę.'
            : 'Błąd podczas wysyłania zaproszenia',
          'error',
        );
        return;
      }

      showSnackbar(
        result.data?.skipped
          ? 'Zaproszenie nie jest potrzebne — nie wysłano wiadomości.'
          : options.mode === 'timeline_update'
          ? 'Uzupełniony harmonogram został wysłany'
          : 'Zaproszenie zostało wysłane',
        result.data?.skipped ? 'info' : 'success',
      );
      window.location.reload();
    } catch (error) {
      console.error('Exception sending invitation:', error);
      showSnackbar('Błąd podczas wysyłania zaproszenia', 'error');
    } finally {
      setSendingInvitation(null);
    }
  };



  return (
    <>
      <div className="space-y-3" aria-busy={leaderBusy}>
        {leaderError && (
          <p role="alert" className="text-sm text-red-300">
            {leaderError}{' '}
            <button type="button" onClick={() => void loadLeadership()} className="underline">Ponów odczyt</button>
          </p>
        )}
        {leaderBusy && <p role="status" className="text-sm text-[#d3bb73]">Zapisywanie roli kierownika…</p>}
        {transportSummary && (
          <div className={`rounded-lg border p-3 text-sm ${transportSummary.warnings.length ? 'border-amber-400/40 bg-amber-400/10' : 'border-[#d3bb73]/10 bg-[#0f1119]'}`}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Car className={`h-4 w-4 ${transportSummary.warnings.length ? 'text-amber-300' : 'text-[#d3bb73]'}`} />
              {transportSummary.loads.map((load) => (
                <span key={load.vehicle.id} className={load.overCapacity ? 'text-amber-300' : 'text-[#e5e4e2]'}>
                  {load.vehicle.name} {load.people}/{load.vehicle.seats ?? '?'}
                </span>
              ))}
              {transportSummary.withoutVehicle > 0 && (
                <span className="text-[#e5e4e2]/60">Bez auta: {transportSummary.withoutVehicle} os.</span>
              )}
            </div>
            {transportSummary.warnings.map((warning) => (
              <p key={warning} className="mt-1 text-xs text-amber-300">{warning}</p>
            ))}
          </div>
        )}
        {employees.length > 0 ? (
          employees.map((item) => {
            const isEditing = editingId === item.id;
            const employeeId = item.employee_id || item.employee?.id;
            const isLeader = leadership?.realization?.manager_id === employeeId;
            const isExpanded = expandedId === item.id;
            const normalizeRoleLabel = (label: string) => label.trim().replace(/\s+/g, ' ').toLocaleLowerCase('pl-PL');
            const responsibilityRoles = (item.responsibility_roles || []).filter(
              (label: string, index: number, labels: string[]) => label.trim() && labels.findIndex(
                candidate => normalizeRoleLabel(candidate) === normalizeRoleLabel(label),
              ) === index,
            );
            const roleLabel = item.role ? systemLabel(item.role, 'role', { preserveCustom: true }) : '';
            const roleAlreadyShown = responsibilityRoles.some(
              (label: string) => normalizeRoleLabel(label) === normalizeRoleLabel(roleLabel),
            );
            {!item.employee && <div>Brak danych pracownika (RLS / relacja)</div>}
            return item.employee && (
              <div
                key={item.id}
                className={`overflow-hidden rounded-lg border bg-[#0f1119] ${
                  item.status === 'rejected' ? 'border-red-500/30' : 'border-[#d3bb73]/10'
                }`}
              >
                <div
                  onClick={() => !isEditing && toggleExpand(item.id)}
                  className="flex cursor-pointer items-center gap-4 p-4 transition-colors hover:bg-[#d3bb73]/5"
                >
                  <EmployeeAvatar
                    size={50}
                    employee={item.employee ?? null}
                    avatarUrl={item.employee?.avatar_url ?? null}
                    avatarMetadata={item.employee?.avatar_metadata ?? null}
                    employeeName={getEmployeeLabel(item.employee)}
                    showActivityStatus
                  />

                  <div className="min-w-0 flex-1">
                    <h3 className="font-medium text-[#e5e4e2]">
                      {getEmployeeLabel(item.employee)}
                    </h3>
                    {responsibilityRoles.length > 0 && <p className="text-sm text-[#d3bb73]">{responsibilityRoles.join(' · ')}</p>}
                    {roleLabel && !roleAlreadyShown && !isEditing && (
                      <p className="text-sm text-[#d3bb73]">{roleLabel}</p>
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      {getStatusBadge(item.status || 'pending')}
                      {isLeader && <span className="rounded-full bg-[#d3bb73]/15 px-2 py-1 text-xs text-[#d3bb73]">Kierownik realizacji</span>}
                      {(() => {
                        const driven = transportVehicles?.find((vehicle) => vehicle.driverId === employeeId);
                        const riding = transportVehicles?.find((vehicle) => vehicle.id === item.transport_event_vehicle_id);
                        if (!driven && !riding) return null;
                        return (
                          <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-1 text-xs text-[#e5e4e2]/80">
                            <Car className="h-3 w-3" />
                            {driven ? `Kierowca · ${driven.name}` : riding?.name}
                          </span>
                        );
                      })()}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {!isEditing && !item.automatic_member && (canManageTeam || leadership?.can_manage) && (
                      <div onClick={(e) => e.stopPropagation()}>
                        <ResponsiveActionBar
                          alwaysDropdown
                          compact
                          disabledBackground
                          actions={[
                            {
                              label: isLeader ? 'Odbierz uprawnienia kierownika' : 'Mianuj kierownikiem realizacji',
                              onClick: () => void changeLeader(employeeId, isLeader),
                              icon: isLeader ? <UserMinus className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />,
                              variant: isLeader ? 'danger' : 'default',
                              show: !!leadership?.can_manage && (isLeader || item.status === 'accepted'),
                              disabled: leaderBusy || !leadership?.can_change,
                            },
                            {
                              label: 'Wyślij zaproszenie',
                              onClick: () => sendInvitation(item.id, { includePhases: false }),
                              icon: sendingInvitation === item.id ? (
                                <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#d3bb73] border-t-transparent" />
                              ) : (
                                <Send className="h-4 w-4" />
                              ),
                              variant: 'default',
                              show: canManageTeam && item.status === 'pending' && !item.invitation_email_sent,
                              disabled: sendingInvitation === item.id,
                            },
                            {
                              label: 'Wyślij aktualny timeline',
                              onClick: () =>
                                sendInvitation(item.id, {
                                  includePhases: true,
                                  mode: 'timeline_update',
                                }),
                              icon:
                                sendingInvitation === item.id ? (
                                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#d3bb73] border-t-transparent" />
                                ) : (
                                  <Mail className="h-4 w-4" />
                                ),
                              variant: 'default',
                              show: canManageTeam && item.status !== 'rejected',
                              disabled: sendingInvitation === item.id,
                            },
                            {
                              label: 'Edytuj rolę i obowiązki',
                              onClick: () => startEdit(item),
                              icon: <EditIcon className="h-4 w-4" />,
                              variant: 'primary',
                              show: canManageTeam,
                            },
                            {
                              label: 'Jedzie autem…',
                              onClick: () => setTransportFor(item),
                              icon: <Car className="h-4 w-4" />,
                              variant: 'default',
                              show: canManageTeam && !!transportVehicles?.length && item.status !== 'rejected' &&
                                !transportVehicles?.some((vehicle) => vehicle.driverId === employeeId),
                            },
                            {
                              label: 'Uprawnienia w wydarzeniu',
                              onClick: () => openPermissionsModal(item),
                              icon: <User className="h-4 w-4" />,
                              variant: 'default',
                              show: canManageTeam,
                            },
                            {
                              label: 'Usuń z zespołu',
                              onClick: () => onRemove(item.id),
                              icon: <Trash2 className="h-4 w-4" />,
                              variant: 'danger',
                              show: canManageTeam,
                            },
                          ]}
                        />
                      </div>
                    )}
                  </div>
                </div>

                {isEditing && (
                  <div className="space-y-3 border-t border-[#d3bb73]/10 p-4">
                    <div>
                      <label className="mb-2 block text-sm text-[#e5e4e2]/60">Rola</label>
                      <input
                        type="text"
                        value={editRole}
                        onChange={(e) => setEditRole(e.target.value)}
                        className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                        placeholder="np. Lead Audio, Technician..."
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                        Zakres odpowiedzialności
                      </label>
                      <textarea
                        value={editResponsibilities}
                        onChange={(e) => setEditResponsibilities(e.target.value)}
                        className="min-h-[80px] w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                        placeholder="Opisz zakres obowiązków..."
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => saveEdit(item.id)}
                        className="rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] hover:bg-[#d3bb73]/90"
                      >
                        Zapisz
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="rounded-lg px-4 py-2 text-[#e5e4e2]/60 hover:bg-[#1c1f33]"
                      >
                        Anuluj
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <div className="text-center text-sm text-[#e5e4e2]/60">Brak członków w zespole</div>
        )}
      </div>

      {transportFor && transportSummary && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !transportBusy && setTransportFor(null)}>
          <div className="w-full max-w-md rounded-xl border border-[#d3bb73]/20 bg-[#0f1119] p-6" onClick={(event) => event.stopPropagation()}>
            <h2 className="mb-1 text-xl font-light text-[#e5e4e2]">Jedzie autem</h2>
            <p className="mb-4 text-sm text-[#e5e4e2]/60">
              {getEmployeeLabel(transportFor.employee)} · kierowców przypisujesz w logistyce.
            </p>
            <div className="space-y-2">
              {transportSummary.loads.map((load) => {
                const selected = transportFor.transport_event_vehicle_id === load.vehicle.id;
                const full = load.vehicle.seats !== null && load.people >= load.vehicle.seats && !selected;
                return (
                  <button
                    key={load.vehicle.id}
                    type="button"
                    disabled={transportBusy}
                    onClick={() => void setTransport(transportFor.id, load.vehicle.id)}
                    className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm ${
                      selected ? 'border-[#d3bb73] bg-[#d3bb73]/10 text-[#d3bb73]' : 'border-[#d3bb73]/10 text-[#e5e4e2] hover:bg-[#d3bb73]/5'
                    }`}
                  >
                    <span>{teamTransportVehicleLabel(load)}</span>
                    {full && <span className="text-xs text-amber-300">brak miejsc</span>}
                  </button>
                );
              })}
              <button
                type="button"
                disabled={transportBusy}
                onClick={() => void setTransport(transportFor.id, null)}
                className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${
                  !transportFor.transport_event_vehicle_id ? 'border-[#d3bb73] bg-[#d3bb73]/10 text-[#d3bb73]' : 'border-[#d3bb73]/10 text-[#e5e4e2]/80 hover:bg-[#d3bb73]/5'
                }`}
              >
                Bez auta (dojazd własny)
              </button>
            </div>
            <div className="mt-4 flex justify-end">
              <button type="button" onClick={() => setTransportFor(null)} disabled={transportBusy} className="rounded-lg px-4 py-2 text-[#e5e4e2]/60 hover:bg-[#1c1f33]">
                Zamknij
              </button>
            </div>
          </div>
        </div>
      )}

      {permissionsModal?.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-[#d3bb73]/20 bg-[#0f1119] p-6">
            <div className="mb-6">
              <h2 className="mb-2 text-xl font-light text-[#e5e4e2]">Zarządzaj uprawnieniami</h2>
              <p className="text-sm text-[#e5e4e2]/60">
                {getEmployeeLabel(permissionsModal.assignment.employee)}
              </p>
            </div>

            <div className="mb-6 space-y-3">
              <label className="flex cursor-pointer items-start gap-3 rounded-lg bg-[#1c1f33] p-3 transition-colors hover:bg-[#1c1f33]/80">
                <input
                  type="checkbox"
                  checked={permissionsForm.can_edit_event}
                  onChange={(e) =>
                    setPermissionsForm({ ...permissionsForm, can_edit_event: e.target.checked })
                  }
                  className="mt-1 h-4 w-4 rounded border-[#d3bb73]/30 bg-[#0f1119] text-[#d3bb73] focus:ring-[#d3bb73] focus:ring-offset-[#0f1119]"
                />
                <div>
                  <div className="font-medium text-[#e5e4e2]">Edycja wydarzenia</div>
                  <div className="text-xs text-[#e5e4e2]/60">
                    Może edytować podstawowe informacje o wydarzeniu
                  </div>
                </div>
              </label>

              <label className="flex cursor-pointer items-start gap-3 rounded-lg bg-[#1c1f33] p-3 transition-colors hover:bg-[#1c1f33]/80">
                <input
                  type="checkbox"
                  checked={permissionsForm.can_edit_agenda}
                  onChange={(e) =>
                    setPermissionsForm({ ...permissionsForm, can_edit_agenda: e.target.checked })
                  }
                  className="mt-1 h-4 w-4 rounded border-[#d3bb73]/30 bg-[#0f1119] text-[#d3bb73] focus:ring-[#d3bb73] focus:ring-offset-[#0f1119]"
                />
                <div>
                  <div className="font-medium text-[#e5e4e2]">Edycja agendy</div>
                  <div className="text-xs text-[#e5e4e2]/60">
                    Może edytować fazy wydarzenia
                  </div>
                </div>
              </label>
              <label className="flex cursor-pointer items-start gap-3 rounded-lg bg-[#1c1f33] p-3 transition-colors hover:bg-[#1c1f33]/80">
                <input
                  type="checkbox"
                  checked={permissionsForm.can_edit_phases}
                  onChange={(e) =>
                    setPermissionsForm({ ...permissionsForm, can_edit_phases: e.target.checked })
                  }
                  className="mt-1 h-4 w-4 rounded border-[#d3bb73]/30 bg-[#0f1119] text-[#d3bb73] focus:ring-[#d3bb73] focus:ring-offset-[#0f1119]"
                />
                <div>
                  <div className="font-medium text-[#e5e4e2]">Edycja harmonogramu</div>
                  <div className="text-xs text-[#e5e4e2]/60">
                    Może edytować harmonogram wydarzenia
                  </div>
                </div>
              </label>

              <label className="flex cursor-pointer items-start gap-3 rounded-lg bg-[#1c1f33] p-3 transition-colors hover:bg-[#1c1f33]/80">
                <input
                  type="checkbox"
                  checked={permissionsForm.can_edit_tasks}
                  onChange={(e) =>
                    setPermissionsForm({ ...permissionsForm, can_edit_tasks: e.target.checked })
                  }
                  className="mt-1 h-4 w-4 rounded border-[#d3bb73]/30 bg-[#0f1119] text-[#d3bb73] focus:ring-[#d3bb73] focus:ring-offset-[#0f1119]"
                />
                <div>
                  <div className="font-medium text-[#e5e4e2]">Zarządzanie zadaniami</div>
                  <div className="text-xs text-[#e5e4e2]/60">
                    Może tworzyć, edytować i usuwać zadania
                  </div>
                </div>
              </label>

              <label className="flex cursor-pointer items-start gap-3 rounded-lg bg-[#1c1f33] p-3 transition-colors hover:bg-[#1c1f33]/80">
                <input
                  type="checkbox"
                  checked={permissionsForm.can_edit_files}
                  onChange={(e) =>
                    setPermissionsForm({ ...permissionsForm, can_edit_files: e.target.checked })
                  }
                  className="mt-1 h-4 w-4 rounded border-[#d3bb73]/30 bg-[#0f1119] text-[#d3bb73] focus:ring-[#d3bb73] focus:ring-offset-[#0f1119]"
                />
                <div>
                  <div className="font-medium text-[#e5e4e2]">Zarządzanie plikami</div>
                  <div className="text-xs text-[#e5e4e2]/60">Może dodawać i usuwać pliki</div>
                </div>
              </label>

              <label className="flex cursor-pointer items-start gap-3 rounded-lg bg-[#1c1f33] p-3 transition-colors hover:bg-[#1c1f33]/80">
                <input
                  type="checkbox"
                  checked={permissionsForm.can_edit_equipment}
                  onChange={(e) =>
                    setPermissionsForm({ ...permissionsForm, can_edit_equipment: e.target.checked })
                  }
                  className="mt-1 h-4 w-4 rounded border-[#d3bb73]/30 bg-[#0f1119] text-[#d3bb73] focus:ring-[#d3bb73] focus:ring-offset-[#0f1119]"
                />
                <div>
                  <div className="font-medium text-[#e5e4e2]">Zarządzanie sprzętem</div>
                  <div className="text-xs text-[#e5e4e2]/60">Może dodawać i usuwać sprzęt</div>
                </div>
              </label>

              <label className="flex cursor-pointer items-start gap-3 rounded-lg bg-[#1c1f33] p-3 transition-colors hover:bg-[#1c1f33]/80">
                <input
                  type="checkbox"
                  checked={permissionsForm.can_invite_members}
                  onChange={(e) =>
                    setPermissionsForm({ ...permissionsForm, can_invite_members: e.target.checked })
                  }
                  className="mt-1 h-4 w-4 rounded border-[#d3bb73]/30 bg-[#0f1119] text-[#d3bb73] focus:ring-[#d3bb73] focus:ring-offset-[#0f1119]"
                />
                <div>
                  <div className="font-medium text-[#e5e4e2]">Zapraszanie członków</div>
                  <div className="text-xs text-[#e5e4e2]/60">
                    Może zapraszać innych pracowników do zespołu
                  </div>
                </div>
              </label>

              <label className="flex cursor-pointer items-start gap-3 rounded-lg bg-[#1c1f33] p-3 transition-colors hover:bg-[#1c1f33]/80">
                <input
                  type="checkbox"
                  checked={permissionsForm.can_view_budget}
                  onChange={(e) =>
                    setPermissionsForm({ ...permissionsForm, can_view_budget: e.target.checked })
                  }
                  className="mt-1 h-4 w-4 rounded border-[#d3bb73]/30 bg-[#0f1119] text-[#d3bb73] focus:ring-offset-[#0f1119]"
                />
                <div>
                  <div className="font-medium text-[#e5e4e2]">Widok budżetu</div>
                  <div className="text-xs text-[#e5e4e2]/60">
                    Może przeglądać informacje finansowe
                  </div>
                </div>
              </label>
            </div>

            <div className="flex gap-3">
              <button
                onClick={savePermissions}
                className="flex-1 rounded-lg bg-[#d3bb73] px-4 py-2 font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
              >
                Zapisz
              </button>
              <button
                onClick={() => setPermissionsModal(null)}
                className="rounded-lg px-4 py-2 text-[#e5e4e2]/60 hover:bg-[#1c1f33]"
              >
                Anuluj
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
