import 'server-only';
import type { NativeContext } from './auth';
import { taskDueIso, warsawToday } from '@/lib/CRM/tasks/taskDue';

/*
 * Widżety „Kalendarz” i „Spotkania” — Mac (pulpit, Centrum powiadomień) oraz iPhone i iPad (ekran główny, ekran blokady):
 * `GET /bridge/native/v1/widgets?op=calendar|meetings`. Widżet działa jako osobny proces z sesją z kontenera grupy aplikacji
 * (`FinderShared`; na telefonie — sesja rozszerzenia Plików), tokenem pracownika: RLS i reguły jak w CRM.
 *
 * - `calendar` — plan pracownika (`get_employee_schedule`, jak „Mój plan” na pulpicie CRM, Maca i telefonu): eventy, fazy,
 *   spotkania, zadania z terminem, kontakty w zapytaniach, oddzwonienia i nieobecności — od początku dzisiejszego dnia (czas
 *   polski) przez 7 dni, bez pozycji już zakończonych.
 * - `meetings` — spotkania pracownika (autor albo uczestnik; bez odwołanych i bez odrzuconych przez niego): trwające i na
 *   14 dni naprzód, z jego odpowiedzią, statusem, miejscem, organizatorem i liczbą uczestników.
 * Każda pozycja ma cel kliknięcia (`target` + `targetId`): event, spotkanie, zadanie, zapytanie albo kontakt — widżet otwiera
 * go w aplikacji (`mavinci://event/<id>` na Macu, `mavinci-crm://event/<id>` na telefonie).
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const CALENDAR_DAYS = 7;
const MEETING_DAYS = 14;
const CALENDAR_LIMIT = 150;
const MEETINGS_LIMIT = 60;
const UUID = '[\\da-f]{8}-(?:[\\da-f]{4}-){3}[\\da-f]{12}';
const COLOR = /^#(?:[\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i;

type Row = Record<string, any>;

export type WidgetTarget = 'event' | 'meeting' | 'task' | 'inquiry' | 'contact';

const KINDS = new Set(['event', 'phase', 'meeting', 'inquiry', 'task', 'call', 'absence']);
const KIND_LABELS: Record<string, string> = {
  event: 'Event',
  phase: 'Faza eventu',
  meeting: 'Spotkanie',
  inquiry: 'Kontakt w zapytaniu',
  task: 'Zadanie',
  call: 'Oddzwonienie',
  absence: 'Nieobecność',
};

/** Cel kliknięcia z adresu CRM pozycji planu (`/crm/events/<id>`, `/crm/meetings?meetingId=<id>`, `/crm/tasks/<id>`…). */
function targetOf(kind: string, itemId: string, url: unknown): { target: WidgetTarget | null; targetId: string | null } {
  const path = typeof url === 'string' ? url : '';
  const rules: [WidgetTarget, string][] = [
    ['event', '/crm/events/'],
    ['task', '/crm/tasks/'],
    ['inquiry', '/crm/inquiries/'],
    ['contact', '/crm/contacts/'],
  ];
  for (const [target, prefix] of rules) {
    const found = new RegExp(`^${prefix}(${UUID})`, 'i').exec(path)?.[1];
    if (found) return { target, targetId: found.toLowerCase() };
  }
  const meeting = new RegExp(`[?&]meetingId=(${UUID})`, 'i').exec(path)?.[1];
  if (meeting) return { target: 'meeting', targetId: meeting.toLowerCase() };
  if (kind === 'meeting' && new RegExp(`^${UUID}$`, 'i').test(itemId)) return { target: 'meeting', targetId: itemId.toLowerCase() };
  return { target: null, targetId: null };
}

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);

const fullName = (value: any) => {
  if (!value || typeof value !== 'object') return '';
  const name = `${value.name ?? ''} ${value.surname ?? ''}`.trim();
  return String(value.nickname || name || '');
};

/** Plan pracownika na 7 dni (od dzisiejszej północy czasu polskiego), bez pozycji zakończonych. */
export async function calendarWidget(ctx: NativeContext) {
  const now = Date.now();
  const fromIso = taskDueIso(warsawToday(now), '00:00') ?? new Date(now - 12 * HOUR).toISOString();
  const from = Date.parse(fromIso);
  const { data, error } = await ctx.supabase.rpc('get_employee_schedule', {
    p_employee_ids: [ctx.employee.id],
    p_from: new Date(from).toISOString(),
    p_to: new Date(from + CALENDAR_DAYS * DAY).toISOString(),
  });
  if (error) throw error;
  const items = (Array.isArray(data) ? (data as Row[]) : [])
    .flatMap((row) => {
      const kind = String(row.kind ?? '');
      const start = Date.parse(row.starts_at);
      const rawEnd = Date.parse(row.ends_at);
      if (!KINDS.has(kind) || !Number.isFinite(start) || !Number.isFinite(rawEnd)) return [];
      if (String(row.employee_id ?? '') !== ctx.employee.id) return [];
      const end = Math.max(rawEnd, start + 15 * MINUTE);
      if (end <= now) return [];
      const itemId = String(row.item_id ?? '');
      return [{
        id: `${kind}:${itemId}:${start}`,
        kind,
        title: text(row.title) ?? KIND_LABELS[kind],
        subtitle: text(row.subtitle),
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
        allDay: row.all_day === true,
        status: typeof row.status === 'string' ? row.status : null,
        color: typeof row.color === 'string' && COLOR.test(row.color) ? row.color : '#64748b',
        ...targetOf(kind, itemId, row.url),
      }];
    })
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || Number(b.allDay) - Number(a.allDay) || a.title.localeCompare(b.title, 'pl'));
  return {
    items: items.slice(0, CALENDAR_LIMIT),
    total: items.length,
    from: fromIso,
    days: CALENDAR_DAYS,
    generatedAt: new Date(now).toISOString(),
  };
}

/** Spotkania pracownika: trwające i na 14 dni naprzód (autor albo uczestnik, bez odwołanych i odrzuconych). */
export async function meetingsWidget(ctx: NativeContext) {
  const now = Date.now();
  const me = ctx.employee.id;
  const { data, error } = await ctx.supabase
    .from('meetings')
    .select(
      `id,title,datetime_start,datetime_end,is_all_day,color,location_text,status,is_private,created_by,
       location:locations(name),
       creator:employees!meetings_created_by_fkey(name,surname,nickname),
       participants:meeting_participants(employee_id,contact_id,response)`,
    )
    .is('deleted_at', null)
    .gte('datetime_start', new Date(now - 2 * DAY).toISOString())
    .lt('datetime_start', new Date(now + MEETING_DAYS * DAY).toISOString())
    .order('datetime_start')
    .limit(1000);
  if (error) throw error;
  const meetings = ((data || []) as Row[])
    .flatMap((m) => {
      const status = String(m.status || 'confirmed');
      if (status === 'cancelled') return [];
      const participants = (Array.isArray(m.participants) ? m.participants : []) as Row[];
      const own = participants.find((p) => p.employee_id === me);
      const mine = m.created_by === me;
      if (!mine && !own) return [];
      const response = mine ? 'accepted' : String(own?.response || 'accepted');
      if (response === 'declined') return [];
      const start = Date.parse(m.datetime_start);
      if (!Number.isFinite(start)) return [];
      const allDay = !!m.is_all_day;
      const rawEnd = m.datetime_end ? Date.parse(m.datetime_end) : NaN;
      const end = Number.isFinite(rawEnd) && rawEnd > start ? rawEnd : start + (allDay ? DAY : HOUR);
      if (end <= now) return [];
      return [{
        id: String(m.id),
        title: text(m.title) ?? 'Spotkanie',
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
        allDay,
        color: typeof m.color === 'string' && COLOR.test(m.color) ? m.color : '#d3bb73',
        location: text(m.location?.name) ?? text(m.location_text),
        status: status === 'tentative' ? 'tentative' : 'confirmed',
        response: ['accepted', 'tentative', 'pending'].includes(response) ? response : 'accepted',
        organizer: mine ? null : fullName(m.creator) || null,
        mine,
        participants: participants.filter((p) => p.employee_id === m.created_by || p.response !== 'declined').length,
        isPrivate: !!m.is_private,
      }];
    })
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || a.title.localeCompare(b.title, 'pl'));
  return {
    meetings: meetings.slice(0, MEETINGS_LIMIT),
    total: meetings.length,
    pending: meetings.filter((m) => m.response === 'pending').length,
    generatedAt: new Date(now).toISOString(),
  };
}
