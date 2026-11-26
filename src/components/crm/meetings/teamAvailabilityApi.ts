import { supabase } from '@/lib/supabase/browser';
import {
  availabilityFromRow,
  schedulePersonFromRow,
  type AvailabilityBlock,
  type SchedulePerson,
} from '@/lib/CRM/meetings/teamAvailability';

/*
 * Spotkania w CRM: osoby z zakresu planu i ich zajętość (funkcje bazy `get_schedule_people`, `get_team_availability`) oraz
 * e-mail do uczestników spoza firmy po zapisie / usunięciu spotkania — serwer CRM (`/bridge/native/v1/meetings`, `op=notify`,
 * token sesji pracownika, jak na Macu i w telefonie). Opis: docs/team-availability.md.
 */

export async function fetchSchedulePeople(): Promise<SchedulePerson[]> {
  const { data, error } = await supabase.rpc('get_schedule_people');
  if (error) throw error;
  return ((data ?? []) as Array<Record<string, unknown>>).map(schedulePersonFromRow);
}

export async function fetchAvailability(
  employeeIds: string[], from: Date, to: Date, excludeMeetingId?: string | null,
): Promise<AvailabilityBlock[]> {
  const ids = Array.from(new Set(employeeIds)).slice(0, 60);
  if (!ids.length) return [];
  const { data, error } = await supabase.rpc('get_team_availability', {
    p_employee_ids: ids,
    p_from: from.toISOString(),
    p_to: to.toISOString(),
    p_exclude_meeting: excludeMeetingId ?? null,
  });
  if (error) throw error;
  return ((data ?? []) as Array<Record<string, unknown>>)
    .map(availabilityFromRow)
    .filter((block): block is AvailabilityBlock => block !== null);
}

/** Stan spotkania sprzed zmiany — serwer porównuje go z zapisanym (zaproszenie, zmiana, odwołanie, „nieaktualne”). */
export interface MeetingMailBefore {
  start: string;
  end: string | null;
  allDay: boolean;
  location: string;
  status: string;
  contactIds: string[];
}

export interface MeetingMailResult {
  sent: number;
  skipped: string[];
  failed: Array<{ name: string; error: string }>;
  noMailbox: boolean;
  message: string | null;
}

export async function notifyMeetingContacts(
  meetingId: string, before: MeetingMailBefore | null, scope: 'single' | 'future' = 'single',
): Promise<MeetingMailResult> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Sesja wygasła. Zaloguj się ponownie.');
  const response = await fetch('/bridge/native/v1/meetings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'x-mavinci-client': 'web', 'Content-Type': 'application/json' },
    body: JSON.stringify({ op: 'notify', id: meetingId, before, scope }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || 'Nie udało się wysłać wiadomości do osób spoza firmy.');
  return {
    sent: Number(body?.sent) || 0,
    skipped: Array.isArray(body?.skipped) ? body.skipped.map(String) : [],
    failed: Array.isArray(body?.failed) ? body.failed : [],
    noMailbox: body?.noMailbox === true,
    message: typeof body?.message === 'string' ? body.message : null,
  };
}

/** Komunikat po wysyłce do snackbara: „success” (wysłano), „warning” (część albo nic), brak — nic do wysłania. */
export function meetingMailNotice(result: MeetingMailResult): { text: string; type: 'success' | 'warning' } | null {
  if (!result.message) return null;
  return { text: result.message, type: result.sent > 0 && !result.failed.length && !result.skipped.length ? 'success' : 'warning' };
}
