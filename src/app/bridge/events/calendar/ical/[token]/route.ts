import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { foldLine, icsEscape, toIcsUtc } from '@/lib/ical';

type MeetingRow = {
  id: string;
  title: string | null;
  datetime_start: string;
  datetime_end: string | null;
  notes: string | null;
  location_text: string | null;
  created_by: string | null;
  color: string | null;
  is_all_day: boolean | null;
  deleted_at: string | null;
};

function buildIcs(meetings: MeetingRow[], calendarName: string) {
  const now = toIcsUtc(new Date());

  const lines: string[] = [];
  lines.push('BEGIN:VCALENDAR');
  lines.push('VERSION:2.0');
  lines.push('PRODID:-//MAVINCI CRM//Calendar Feed//PL');
  lines.push('CALSCALE:GREGORIAN');
  lines.push('METHOD:PUBLISH');
  lines.push(foldLine(`X-WR-CALNAME:${icsEscape(calendarName)}`));
  lines.push('X-WR-TIMEZONE:UTC');

  for (const m of meetings) {
    const uid = `${m.id}@mavinci-crm`;
    const summary = m.title?.trim() ? m.title : 'Spotkanie';
    const location = m.location_text?.trim() ? m.location_text : '';
    const description = m.notes?.trim() ? m.notes : '';

    // Jeśli all-day: w iCal używa się DTSTART;VALUE=DATE i DTEND;VALUE=DATE (DTEND = dzień+1)
    // Jeśli nie masz typowych all-day w meetings, możesz to pominąć; zostawiam poprawnie.
    const isAllDay = Boolean(m.is_all_day);

    lines.push('BEGIN:VEVENT');
    lines.push(foldLine(`UID:${icsEscape(uid)}`));
    lines.push(`DTSTAMP:${now}`);

    if (isAllDay) {
      const start = new Date(m.datetime_start);
      const y = start.getUTCFullYear();
      const mo = String(start.getUTCMonth() + 1).padStart(2, '0');
      const da = String(start.getUTCDate()).padStart(2, '0');
      const dtStartDate = `${y}${mo}${da}`;

      // DTEND w trybie DATE jest "exclusive" => następny dzień
      const end = new Date(Date.UTC(y, start.getUTCMonth(), start.getUTCDate() + 1));
      const ey = end.getUTCFullYear();
      const emo = String(end.getUTCMonth() + 1).padStart(2, '0');
      const eda = String(end.getUTCDate()).padStart(2, '0');
      const dtEndDate = `${ey}${emo}${eda}`;

      lines.push(`DTSTART;VALUE=DATE:${dtStartDate}`);
      lines.push(`DTEND;VALUE=DATE:${dtEndDate}`);
    } else {
      lines.push(`DTSTART:${toIcsUtc(m.datetime_start)}`);
      if (m.datetime_end) {
        lines.push(`DTEND:${toIcsUtc(m.datetime_end)}`);
      }
    }

    lines.push(foldLine(`SUMMARY:${icsEscape(summary)}`));
    if (location) lines.push(foldLine(`LOCATION:${icsEscape(location)}`));
    if (description) lines.push(foldLine(`DESCRIPTION:${icsEscape(description)}`));

    // Możesz dodać URL do CRM
    // lines.push(foldLine(`URL:https://twojadomena.pl/crm/calendar/meetings/${m.id}`));

    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');

  return lines.join('\r\n') + '\r\n';
}

/**
 * Widoczność spotkań dla usera:
 * - created_by = employeeId
 * - LUB user jest uczestnikiem (meeting_participants.employee_id)
 * - LUB user jest admin (permissions contains 'admin' OR role = 'admin')
 *
 * Jeśli masz już swoje reguły, tu je dokładnie odzwierciedlamy.
 */
async function getVisibleMeetings(employeeId: string) {
  // sprawdź admina
  const { data: me, error: meErr } = await supabaseServer
    .from('employees')
    .select('id, role, permissions, is_active')
    .eq('id', employeeId)
    .maybeSingle();

  if (meErr) throw meErr;
  if (!me) throw new Error('Employee not found');
  if (me.is_active === false) return [];

  const isAdmin =
    me.role === 'admin' || (Array.isArray(me.permissions) && me.permissions.includes('admin'));

  if (isAdmin) {
    const { data, error } = await supabaseServer
      .from('meetings')
      .select('id,title,datetime_start,datetime_end,notes,location_text,created_by,color,is_all_day,deleted_at')
      .is('deleted_at', null)
      .order('datetime_start', { ascending: true });

    if (error) throw error;
    return (data ?? []) as MeetingRow[];
  }

  // meetings gdzie created_by = employeeId
  const { data: ownMeetings, error: ownErr } = await supabaseServer
    .from('meetings')
    .select('id,title,datetime_start,datetime_end,notes,location_text,created_by,color,is_all_day,deleted_at')
    .is('deleted_at', null)
    .eq('created_by', employeeId);

  if (ownErr) throw ownErr;

  // meetings gdzie jest uczestnikiem
  const { data: participantRows, error: partErr } = await supabaseServer
    .from('meeting_participants')
    .select('meeting_id')
    .eq('employee_id', employeeId);

  if (partErr) throw partErr;

  const participantMeetingIds = (participantRows ?? []).map((r: any) => r.meeting_id).filter(Boolean);

  let participantMeetings: MeetingRow[] = [];
  if (participantMeetingIds.length > 0) {
    const { data: pm, error: pmErr } = await supabaseServer
      .from('meetings')
      .select('id,title,datetime_start,datetime_end,notes,location_text,created_by,color,is_all_day,deleted_at')
      .is('deleted_at', null)
      .in('id', participantMeetingIds);

    if (pmErr) throw pmErr;
    participantMeetings = (pm ?? []) as MeetingRow[];
  }

  // merge unique
  const map = new Map<string, MeetingRow>();
  for (const m of [...(ownMeetings ?? []), ...participantMeetings]) map.set(m.id, m as MeetingRow);

  // sort
  return Array.from(map.values()).sort((a, b) => {
    return new Date(a.datetime_start).getTime() - new Date(b.datetime_start).getTime();
  });
}

export async function GET(
  _req: Request,
  { params }: { params: { token: string } },
) {
  try {
    const token = params.token;

    // 1) znajdź ownera tokena
    const { data: tokenRow, error: tokenErr } = await supabaseServer
      .from('calendar_feed_tokens')
      .select('employee_id')
      .eq('token', token)
      .maybeSingle();

    if (tokenErr) throw tokenErr;
    if (!tokenRow?.employee_id) {
      return new NextResponse('Not found', { status: 404 });
    }

    // 2) bump last_used_at (opcjonalnie)
    await supabaseServer
      .from('calendar_feed_tokens')
      .update({ last_used_at: new Date().toISOString() })
      .eq('token', token);

    // 3) pobierz meetings widoczne dla usera
    const meetings = await getVisibleMeetings(tokenRow.employee_id);

    // 4) wygeneruj ICS
    const ics = buildIcs(meetings, 'MAVINCI CRM — Spotkania');

    // 5) headers (ważne dla subskrypcji)
    return new NextResponse(ics, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Cache-Control': 'public, max-age=60', // możesz dać 300/600
      },
    });
  } catch (e: any) {
    console.error('iCal feed error:', e);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}