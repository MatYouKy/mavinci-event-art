import { supabase } from './supabase';
import {
  availabilityFromRow,
  schedulePersonFromRow,
  type AvailabilityBlock,
  type SchedulePerson,
} from './teamAvailability';

/*
 * Spotkania w telefonie (docs/team-availability.md): osoby z zakresu planu i ich zajętość — te same funkcje bazy co CRM
 * i Mac (`get_schedule_people`, `get_team_availability`), e-mail do uczestników spoza firmy po zapisie / usunięciu spotkania —
 * serwer CRM (`/bridge/native/v1/meetings`, `op=notify`, token pracownika), dział i przełożony — `set_employee_structure`.
 */

const CRM_URL = (process.env.EXPO_PUBLIC_CRM_URL || 'https://mavinci.pl').replace(/\/+$/, '');
const MEETINGS_ENDPOINT = `${CRM_URL}/bridge/native/v1/meetings`;

export async function fetchSchedulePeople(): Promise<SchedulePerson[]> {
  const { data, error } = await supabase.rpc('get_schedule_people');
  if (error) throw new Error(error.message || 'Nie udało się wczytać pracowników.');
  return ((data ?? []) as Array<Record<string, unknown>>).map(schedulePersonFromRow);
}

export async function fetchAvailability(
  employeeIds: string[], from: Date, to: Date, excludeMeetingId?: string | null,
): Promise<AvailabilityBlock[]> {
  const ids = Array.from(new Set(employeeIds.filter(Boolean))).slice(0, 60);
  if (!ids.length) return [];
  const { data, error } = await supabase.rpc('get_team_availability', {
    p_employee_ids: ids,
    p_from: from.toISOString(),
    p_to: to.toISOString(),
    p_exclude_meeting: excludeMeetingId ?? null,
  });
  if (error) throw new Error(error.message || 'Nie udało się pobrać zajętości.');
  return ((data ?? []) as Array<Record<string, unknown>>)
    .map(availabilityFromRow)
    .filter((block): block is AvailabilityBlock => block !== null);
}

/** Dział i przełożony pracownika (administrator albo „Zarządzanie pracownikami”; baza pilnuje pętli w piramidzie). */
export async function saveEmployeeStructure(employeeId: string, department: string, supervisorId: string | null): Promise<void> {
  const { error } = await supabase.rpc('set_employee_structure', {
    p_employee_id: employeeId, p_department: department, p_supervisor_id: supervisorId,
  });
  if (error) throw new Error(error.message || 'Nie udało się zapisać działu.');
}

/** Stan spotkania sprzed zmiany — serwer wybiera wiadomość (zaproszenie, zmiana, odwołanie, „nieaktualne”). */
export type MeetingMailBefore = {
  start: string;
  end: string | null;
  allDay: boolean;
  location: string;
  status: string;
  contactIds: string[];
};

export type MeetingMailResult = { sent: number; skipped: string[]; failedCount: number; noMailbox: boolean; message: string | null };

export async function notifyMeetingContacts(
  meetingId: string, before: MeetingMailBefore | null, scope: 'single' | 'future' = 'single',
): Promise<MeetingMailResult> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Zaloguj się ponownie.');
  let response: Response;
  try {
    response = await fetch(MEETINGS_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`, 'x-mavinci-client': 'phone', Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ op: 'notify', id: meetingId, before, scope }),
    });
  } catch {
    throw new Error('Brak połączenia z serwerem CRM — e-mail do osób spoza firmy nie został wysłany.');
  }
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || !body) throw new Error(typeof body?.error === 'string' ? body.error : 'Nie udało się wysłać e-maila do osób spoza firmy.');
  return {
    sent: Number(body.sent) || 0,
    skipped: Array.isArray(body.skipped) ? body.skipped.map(String) : [],
    failedCount: Array.isArray(body.failed) ? body.failed.length : 0,
    noMailbox: body.noMailbox === true,
    message: typeof body.message === 'string' ? body.message : null,
  };
}

/** Wybór osób w widoku „Pracownicy” — zapamiętany na czas działania aplikacji (jak widok osi czasu). */
let peopleSelection: string[] | null = null;
export const peopleSelectionMemory = {
  get: (): string[] | null => peopleSelection,
  set: (ids: string[]) => {
    peopleSelection = ids;
  },
};
