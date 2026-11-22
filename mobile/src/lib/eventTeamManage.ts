import { supabase } from './supabase';
import { mapTeamTransportVehicles, TEAM_TRANSPORT_VEHICLE_SELECT, type TeamTransportVehicle } from './teamTransport';

/*
 * Zarządzanie zespołem eventu w aplikacji — te same zapytania i zapisy co CRM (`useEventTeam`, `TeamMembersList`,
 * `AddEventEmployeeModal`) i Mac (`src/lib/native/eventCard.ts`): tokenem pracownika, o wyniku decyduje baza (RLS, RPC).
 * Kierownika realizacji wyznacza RPC `appoint_realization_manager` / `revoke_realization_manager`.
 * Zapis, który RLS po cichu pominął (0 wierszy), aplikacja zgłasza jako brak uprawnień zamiast „zapisano”.
 */

export const EVENT_TEAM_PERMISSIONS = [
  { key: 'can_edit_event', title: 'Edycja eventu', detail: 'Może edytować podstawowe informacje o evencie' },
  { key: 'can_edit_agenda', title: 'Edycja agendy', detail: 'Może edytować agendę eventu' },
  { key: 'can_edit_phases', title: 'Edycja harmonogramu', detail: 'Może edytować harmonogram (timeline) eventu' },
  { key: 'can_edit_tasks', title: 'Zarządzanie zadaniami', detail: 'Może tworzyć, edytować i usuwać zadania' },
  { key: 'can_edit_files', title: 'Zarządzanie plikami', detail: 'Może dodawać i usuwać pliki' },
  { key: 'can_edit_equipment', title: 'Zarządzanie sprzętem', detail: 'Może dodawać i usuwać sprzęt' },
  { key: 'can_invite_members', title: 'Zapraszanie członków', detail: 'Może zapraszać innych pracowników do zespołu' },
  { key: 'can_view_budget', title: 'Widok budżetu', detail: 'Może przeglądać informacje finansowe' },
] as const;

export type EventTeamPermissionKey = (typeof EVENT_TEAM_PERMISSIONS)[number]['key'];
export type EventTeamPermissions = Record<EventTeamPermissionKey, boolean>;

const PERMISSION_KEYS = EVENT_TEAM_PERMISSIONS.map((item) => item.key) as EventTeamPermissionKey[];

export const emptyTeamPermissions = (): EventTeamPermissions =>
  Object.fromEntries(PERMISSION_KEYS.map((key) => [key, false])) as EventTeamPermissions;

const permissionsPayload = (permissions: Partial<Record<string, boolean>>) =>
  Object.fromEntries(PERMISSION_KEYS.map((key) => [key, permissions[key] === true])) as EventTeamPermissions;

export type ManagedAssignment = {
  id: string;
  employeeId: string;
  role: string | null;
  responsibilities: string | null;
  status: string;
  invitationEmailSent: boolean;
  transportVehicleId: string | null;
  permissions: EventTeamPermissions;
};

export type EventTeamLeadership = { managerId: string | null; canManage: boolean; canChange: boolean };

export type EventTeamManageData = {
  assignments: ManagedAssignment[];
  /** null — nie udało się odczytać kierownika realizacji (bez czynności kierownika). */
  leadership: EventTeamLeadership | null;
  /** Auta wydarzenia do przydziału dojazdu; null — brak dostępu do logistyki albo błąd odczytu. */
  vehicles: TeamTransportVehicle[] | null;
};

type DbError = { code?: string; message?: string } | null | undefined;

const missingPhasesColumn = (error: DbError) =>
  error?.code === 'PGRST204' && String(error.message || '').includes('can_edit_phases');

export class TeamChangeError extends Error {}

/** Czytelny komunikat: tekst z bazy (RPC zwracają polskie komunikaty), brak uprawnień, brak sieci. */
export function teamErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof TeamChangeError) return error.message;
  const raw = error && typeof error === 'object' ? (error as { code?: string; message?: string }) : null;
  const message = String(raw?.message || '');
  if (/Failed to fetch|Network request failed|fetch failed/i.test(message)) return 'Brak połączenia. Spróbuj ponownie za chwilę.';
  if (raw?.code === '42501' || /row-level security|permission denied/i.test(message)) {
    return 'Nie masz uprawnień do tej zmiany w zespole.';
  }
  // Komunikaty z RAISE EXCEPTION w bazie (kody P0xxx) są po polsku — pokazujemy je wprost; techniczne zastępujemy.
  return /^P0/.test(raw?.code || '') && message ? message : fallback;
}

const noRows = () =>
  new TeamChangeError('Zmiana nie została zapisana — nie masz uprawnień do zmiany tej osoby w zespole (decyduje baza).');

export async function loadEventTeamManage(eventId: string): Promise<EventTeamManageData> {
  const [assignments, leadership, vehicles] = await Promise.all([
    supabase.from('employee_assignments').select('*').eq('event_id', eventId).order('created_at', { ascending: true }),
    supabase.rpc('get_event_realization_assignment', { p_event_id: eventId }),
    supabase.from('event_vehicles').select(TEAM_TRANSPORT_VEHICLE_SELECT).eq('event_id', eventId).order('created_at', { ascending: true }),
  ]);
  if (assignments.error) throw assignments.error;
  const lead = leadership.error ? null : (leadership.data as Record<string, any> | null);
  return {
    assignments: ((assignments.data ?? []) as any[]).map((row) => ({
      id: String(row.id),
      employeeId: String(row.employee_id || ''),
      role: row.role || null,
      responsibilities: row.responsibilities || null,
      status: row.status || 'pending',
      invitationEmailSent: row.invitation_email_sent === true,
      transportVehicleId: row.transport_event_vehicle_id ? String(row.transport_event_vehicle_id) : null,
      permissions: permissionsPayload(row),
    })),
    leadership: lead
      ? {
          managerId: lead.realization?.manager_id ? String(lead.realization.manager_id) : null,
          canManage: lead.can_manage === true,
          canChange: lead.can_change === true,
        }
      : null,
    vehicles: vehicles.error ? null : mapTeamTransportVehicles((vehicles.data ?? []) as any[]),
  };
}

export type TeamCandidate = {
  id: string;
  name: string;
  surname: string;
  nickname: string | null;
  avatarUrl: string | null;
  avatarMetadata: any;
};

export type TeamCandidatePhase = { phaseId: string; name: string; workStart: string | null; workEnd: string | null };

/** „Dodaj osobę do zespołu”: aktywni pracownicy i fazy timeline, do których osoba jest już przypisana w tym evencie. */
export async function fetchTeamCandidates(
  eventId: string,
): Promise<{ employees: TeamCandidate[]; phases: Record<string, TeamCandidatePhase[]>; phasesError: boolean }> {
  const [employees, phases] = await Promise.all([
    supabase.rpc('employees_public_list'),
    supabase
      .from('event_phase_assignments')
      .select('employee_id, phase_id, phase_work_start, phase_work_end, event_phases!inner(id, name, event_id)')
      .eq('event_phases.event_id', eventId),
  ]);
  if (employees.error) throw employees.error;
  const byEmployee: Record<string, TeamCandidatePhase[]> = {};
  for (const row of (phases.data ?? []) as any[]) {
    const phase = Array.isArray(row.event_phases) ? row.event_phases[0] : row.event_phases;
    (byEmployee[String(row.employee_id)] ||= []).push({
      phaseId: String(row.phase_id),
      name: phase?.name ?? '',
      workStart: row.phase_work_start ?? null,
      workEnd: row.phase_work_end ?? null,
    });
  }
  return {
    employees: ((employees.data ?? []) as any[])
      .filter((row) => row?.is_active === true)
      .map((row) => ({
        id: String(row.id),
        name: row.name ?? '',
        surname: row.surname ?? '',
        nickname: row.nickname ?? null,
        avatarUrl: row.avatar_url ?? null,
        avatarMetadata: row.avatar_metadata ?? null,
      })),
    phases: byEmployee,
    phasesError: Boolean(phases.error),
  };
}

export type InvitationMode = 'invitation' | 'timeline_update';

/** Zaproszenie / aktualny timeline e-mailem (`send-event-invitation`) — jak w CRM. */
export async function sendEventTeamInvitation(
  assignmentId: string,
  includePhases: boolean,
  mode: InvitationMode,
): Promise<'sent' | 'skipped'> {
  const { data, error } = await supabase.functions.invoke('send-event-invitation', {
    body: { assignmentId, includePhases, mode },
  });
  if (error) {
    throw new TeamChangeError(
      mode === 'timeline_update'
        ? 'Nie wysłano harmonogramu. Sprawdź, czy pracownik ma przypisaną co najmniej jedną fazę.'
        : 'Błąd podczas wysyłania zaproszenia.',
    );
  }
  return (data as { skipped?: boolean } | null)?.skipped ? 'skipped' : 'sent';
}

export type AddTeamMemberInput = {
  employeeId: string;
  role: string;
  responsibilities: string;
  permissions: Partial<EventTeamPermissions>;
  sendInvitation: boolean;
  includePhases: boolean;
};

/**
 * Dodanie do zespołu (`addEventEmployee`): przypisanie z uprawnieniami (zakres widoczności z roli pracownika ustawia baza),
 * zgodność ze starszą bazą bez `can_edit_phases`, zaproszenie e-mailem. Nieudana wiadomość nie cofa dodania.
 */
export async function addEventTeamMember(
  eventId: string,
  input: AddTeamMemberInput,
): Promise<{ invitation: 'sent' | 'skipped' | 'failed' | 'none' }> {
  const payload: Record<string, unknown> = {
    event_id: eventId,
    employee_id: input.employeeId,
    role: input.role.trim(),
    responsibilities: input.responsibilities.trim() || null,
    access_level_id: null,
    ...permissionsPayload(input.permissions),
  };
  let { data, error } = await supabase.from('employee_assignments').insert(payload).select('id, status').single();
  if (missingPhasesColumn(error)) {
    const { can_edit_phases: _phases, ...compatible } = payload;
    const retry = await supabase.from('employee_assignments').insert(compatible).select('id, status').single();
    data = retry.data;
    error = retry.error;
  }
  if (error) {
    if (error.code === '23505') throw new TeamChangeError('Ta osoba jest już w zespole eventu.');
    throw error;
  }
  const row = data as { id?: string; status?: string } | null;
  if (!row?.id || row.status !== 'pending' || !input.sendInvitation) return { invitation: 'none' };
  try {
    return { invitation: await sendEventTeamInvitation(String(row.id), input.includePhases, 'invitation') };
  } catch {
    return { invitation: 'failed' };
  }
}

/** Uprawnienia w evencie (`savePermissions`) — ze zgodnością ze starszą bazą bez `can_edit_phases`. */
export async function saveEventTeamPermissions(eventId: string, assignmentId: string, permissions: Partial<EventTeamPermissions>) {
  const form = { ...permissionsPayload(permissions), permissions_updated_at: new Date().toISOString() } as Record<string, unknown>;
  let { data, error } = await supabase
    .from('employee_assignments')
    .update(form)
    .eq('id', assignmentId)
    .eq('event_id', eventId)
    .select('id');
  if (missingPhasesColumn(error)) {
    const { can_edit_phases: _phases, ...compatible } = form;
    const retry = await supabase
      .from('employee_assignments')
      .update(compatible)
      .eq('id', assignmentId)
      .eq('event_id', eventId)
      .select('id');
    data = retry.data;
    error = retry.error;
  }
  if (error) throw error;
  if (!data?.length) throw noRows();
}

export async function updateEventTeamRole(eventId: string, assignmentId: string, role: string, responsibilities: string) {
  const { data, error } = await supabase
    .from('employee_assignments')
    .update({ role: role.trim(), responsibilities: responsibilities.trim() })
    .eq('id', assignmentId)
    .eq('event_id', eventId)
    .select('id');
  if (error) throw error;
  if (!data?.length) throw noRows();
}

export async function removeEventTeamMember(eventId: string, assignmentId: string) {
  const { data, error } = await supabase
    .from('employee_assignments')
    .delete()
    .eq('id', assignmentId)
    .eq('event_id', eventId)
    .select('id');
  if (error) throw error;
  if (!data?.length) throw noRows();
}

/** Którym autem jedzie osoba (kierowcę ustawia logistyka). `null` — bez auta / dojazd własny. */
export async function setEventTeamTransport(eventId: string, assignmentId: string, eventVehicleId: string | null) {
  const { data, error } = await supabase
    .from('employee_assignments')
    .update({ transport_event_vehicle_id: eventVehicleId })
    .eq('id', assignmentId)
    .eq('event_id', eventId)
    .select('id');
  if (error) {
    if (error.code === 'PGRST204') {
      throw new TeamChangeError('Przypisanie do auta wymaga aktualizacji bazy (migracja 20261112214000_event_team_transport.sql).');
    }
    throw error;
  }
  if (!data?.length) throw noRows();
}

/** Mianowanie / odwołanie kierownika realizacji (RPC sprawdza prawo do prowadzenia realizacji). */
export async function changeRealizationManager(eventId: string, employeeId: string, revoke: boolean) {
  const { error } = await supabase.rpc(revoke ? 'revoke_realization_manager' : 'appoint_realization_manager', {
    p_event_id: eventId,
    p_employee_id: employeeId,
  });
  if (error) throw error;
}
