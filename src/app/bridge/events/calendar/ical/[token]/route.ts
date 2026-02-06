import { NextResponse } from 'next/server';
import { foldLine, icsEscape, toIcsUtc } from '@/lib/ical';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabaseServer = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

type MeetingRow = {
  id: string;
  title: string | null;
  datetime_start: string;
  datetime_end: string | null;
  notes: string | null;
  location_text: string | null;
  created_by: string | null;
  is_all_day: boolean | null;
  deleted_at: string | null;
};

type EventRow = {
  id: string;
  name: string;
  description: string | null;
  notes: string | null;
  location: string | null;
  event_date: string; // timestamptz
  event_end_date: string | null; // timestamptz
  created_by: string | null;
  status: string | null;
  // opcjonalnie: organizacja/kategoria jeśli kiedyś dołączysz joinem
};

type EmployeeRow = {
  id: string;
  role: string | null;
  permissions: any | null;
  is_active: boolean | null;
};

type IcsItem = {
  uid: string;
  dtstart: string;
  dtend?: string;
  summary: string;
  location?: string;
  description?: string;
};

function buildIcs(items: IcsItem[], calendarName: string) {
  const now = toIcsUtc(new Date());

  const lines: string[] = [];
  lines.push('BEGIN:VCALENDAR');
  lines.push('VERSION:2.0');
  lines.push('PRODID:-//MAVINCI CRM//Calendar Feed//PL');
  lines.push('CALSCALE:GREGORIAN');
  lines.push('METHOD:PUBLISH');
  lines.push(foldLine(`X-WR-CALNAME:${icsEscape(calendarName)}`));
  lines.push('X-WR-TIMEZONE:UTC');

  for (const it of items) {
    lines.push('BEGIN:VEVENT');
    lines.push(foldLine(`UID:${icsEscape(it.uid)}`));
    lines.push(`DTSTAMP:${now}`);
    lines.push(`DTSTART:${it.dtstart}`);
    if (it.dtend) lines.push(`DTEND:${it.dtend}`);
    lines.push(foldLine(`SUMMARY:${icsEscape(it.summary)}`));
    if (it.location) lines.push(foldLine(`LOCATION:${icsEscape(it.location)}`));
    if (it.description) lines.push(foldLine(`DESCRIPTION:${icsEscape(it.description)}`));
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

function isAdminEmployee(me: EmployeeRow) {
  const perms = me.permissions;
  const hasAdminPerm = Array.isArray(perms) ? perms.includes('admin') : false;
  return me.role === 'admin' || hasAdminPerm;
}

async function getEmployeeOrThrow(employeeId: string) {
  const { data, error } = await supabaseServer
    .from('employees')
    .select('id, role, permissions, is_active')
    .eq('id', employeeId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error('Employee not found');
  return data as EmployeeRow;
}

async function getVisibleMeetings(employeeId: string, isAdmin: boolean) {
  if (isAdmin) {
    const { data, error } = await supabaseServer
      .from('meetings')
      .select(
        'id,title,datetime_start,datetime_end,notes,location_text,created_by,is_all_day,deleted_at',
      )
      .is('deleted_at', null)
      .order('datetime_start', { ascending: true });

    if (error) throw error;
    return (data ?? []) as MeetingRow[];
  }

  const { data: ownMeetings, error: ownErr } = await supabaseServer
    .from('meetings')
    .select(
      'id,title,datetime_start,datetime_end,notes,location_text,created_by,is_all_day,deleted_at',
    )
    .is('deleted_at', null)
    .eq('created_by', employeeId);

  if (ownErr) throw ownErr;

  const { data: participantRows, error: partErr } = await supabaseServer
    .from('meeting_participants')
    .select('meeting_id')
    .eq('employee_id', employeeId);

  if (partErr) throw partErr;

  const ids = (participantRows ?? [])
    .map((r: any) => r.meeting_id)
    .filter(Boolean) as string[];

  let participantMeetings: MeetingRow[] = [];
  if (ids.length) {
    const { data, error } = await supabaseServer
      .from('meetings')
      .select(
        'id,title,datetime_start,datetime_end,notes,location_text,created_by,is_all_day,deleted_at',
      )
      .is('deleted_at', null)
      .in('id', ids);

    if (error) throw error;
    participantMeetings = (data ?? []) as MeetingRow[];
  }

  const map = new Map<string, MeetingRow>();
  for (const m of [...(ownMeetings ?? []), ...participantMeetings]) map.set(m.id, m);

  return Array.from(map.values()).sort(
    (a, b) => new Date(a.datetime_start).getTime() - new Date(b.datetime_start).getTime(),
  );
}

async function getVisibleEvents(employeeId: string, isAdmin: boolean) {
  if (isAdmin) {
    const { data, error } = await supabaseServer
      .from('events')
      .select('id,name,description,notes,location,event_date,event_end_date,created_by,status')
      .order('event_date', { ascending: true });

    if (error) throw error;
    return (data ?? []) as EventRow[];
  }

  const { data: ownEvents, error: ownErr } = await supabaseServer
    .from('events')
    .select('id,name,description,notes,location,event_date,event_end_date,created_by,status')
    .eq('created_by', employeeId);

  if (ownErr) throw ownErr;

  const { data: assignedRows, error: assErr } = await supabaseServer
    .from('event_employees')
    .select('event_id')
    .eq('employee_id', employeeId);

  if (assErr) throw assErr;

  const ids = (assignedRows ?? []).map((r: any) => r.event_id).filter(Boolean) as string[];

  let assignedEvents: EventRow[] = [];
  if (ids.length) {
    const { data, error } = await supabaseServer
      .from('events')
      .select('id,name,description,notes,location,event_date,event_end_date,created_by,status')
      .in('id', ids);

    if (error) throw error;
    assignedEvents = (data ?? []) as EventRow[];
  }

  const map = new Map<string, EventRow>();
  for (const e of [...(ownEvents ?? []), ...assignedEvents]) map.set(e.id, e);

  return Array.from(map.values()).sort(
    (a, b) => new Date(a.event_date).getTime() - new Date(b.event_date).getTime(),
  );
}

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  try {
    const token = params.token;

    // 1) token -> employee_id
    const { data: tokenRow, error: tokenErr } = await supabaseServer
      .from('calendar_feed_tokens')
      .select('employee_id')
      .eq('token', token)
      .maybeSingle();

    if (tokenErr) throw tokenErr;
    if (!tokenRow?.employee_id) return new NextResponse('Not found', { status: 404 });

    // best-effort bump
    supabaseServer
      .from('calendar_feed_tokens')
      .update({ last_used_at: new Date().toISOString() })
      .eq('token', token);

    // 2) employee + admin?
    const me = await getEmployeeOrThrow(tokenRow.employee_id);
    if (me.is_active === false) return new NextResponse('Not found', { status: 404 });

    const isAdmin = isAdminEmployee(me);

    // 3) pobierz widoczne rzeczy
    const [meetings, events] = await Promise.all([
      getVisibleMeetings(me.id, isAdmin),
      getVisibleEvents(me.id, isAdmin),
    ]);

    // 4) mapuj do ICS
    const items: IcsItem[] = [];

    for (const m of meetings) {
      const summary = m.title?.trim() ? m.title : 'Spotkanie';
      const location = m.location_text?.trim() ? m.location_text : undefined;
      const description = m.notes?.trim() ? m.notes : undefined;

      const uid = `meeting-${m.id}@mavinci-crm`;

      if (m.is_all_day) {
        // all-day (VALUE=DATE) — ale tu masz już datetime_start, więc zostawiamy UTC datetime
        // Jeśli kiedyś chcesz prawdziwe all-day: zrób DTSTART;VALUE=DATE i DTEND;VALUE=DATE
        items.push({
          uid,
          dtstart: toIcsUtc(m.datetime_start),
          dtend: m.datetime_end ? toIcsUtc(m.datetime_end) : undefined,
          summary,
          location,
          description,
        });
      } else {
        items.push({
          uid,
          dtstart: toIcsUtc(m.datetime_start),
          dtend: m.datetime_end ? toIcsUtc(m.datetime_end) : undefined,
          summary,
          location,
          description,
        });
      }
    }

    for (const e of events) {
      const summary = e.name?.trim() ? e.name : 'Wydarzenie';
      const location = e.location?.trim() ? e.location : undefined;

      // opis: status + description + notes (ładnie)
      const descParts: string[] = [];
      if (e.status) descParts.push(`Status: ${e.status}`);
      if (e.description?.trim()) descParts.push(e.description.trim());
      if (e.notes?.trim()) descParts.push(e.notes.trim());
      const description = descParts.length ? descParts.join('\\n\\n') : undefined;

      items.push({
        uid: `event-${e.id}@mavinci-crm`,
        dtstart: toIcsUtc(e.event_date),
        dtend: e.event_end_date ? toIcsUtc(e.event_end_date) : undefined,
        summary,
        location,
        description,
      });
    }

    // 5) sort po DTSTART
    items.sort((a, b) => a.dtstart.localeCompare(b.dtstart));

    const ics = buildIcs(items, 'MAVINCI CRM — Kalendarz');

    return new NextResponse(ics, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'inline; filename="mavinci.ics"',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
      },
    });
  } catch (e: any) {
    console.error('iCal feed error:', e);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}