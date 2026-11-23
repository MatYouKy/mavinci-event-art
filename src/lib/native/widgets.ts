import 'server-only';
import type { NativeContext } from './auth';
import { eventsAccess } from './events';
import { taskDueIso, warsawOffsetMinutes, warsawToday } from '@/lib/CRM/tasks/taskDue';
import { usesOperationalStages } from '@/lib/CRM/events/operationalStages';
import { isEventAwaitingOperationalConfirmation } from '@/lib/CRM/events/eventVisibility';

/*
 * Widżety „Kalendarz”, „Spotkania” i „Wydarzenia” — Mac (pulpit, Centrum powiadomień) oraz iPhone i iPad (ekran główny, ekran
 * blokady): `GET /bridge/native/v1/widgets?op=calendar|meetings|events`. Widżet działa jako osobny proces z sesją z kontenera grupy aplikacji
 * (`FinderShared`; na telefonie — sesja rozszerzenia Plików), tokenem pracownika: RLS i reguły jak w CRM.
 *
 * - `calendar` — plan pracownika (`get_employee_schedule`, jak „Mój plan” na pulpicie CRM, Maca i telefonu): eventy, fazy,
 *   spotkania, zadania z terminem, kontakty w zapytaniach, oddzwonienia i nieobecności — od początku dzisiejszego dnia (czas
 *   polski) przez 7 dni, bez pozycji już zakończonych.
 * - `meetings` — spotkania pracownika (autor albo uczestnik; bez odwołanych i bez odrzuconych przez niego): trwające i na
 *   14 dni naprzód, z jego odpowiedzią, statusem, miejscem, organizatorem i liczbą uczestników.
 * - `events` — najbliższe eventy: widoczne dla pracownika jak na liście Eventów (RLS) i jego realizacje, trwające i zaczynające
 *   się w ciągu 30 dni, bez anulowanych; miejsce, klient, kolor kategorii, etap sprzedaży eventów niepotwierdzonych (tylko dla
 *   osób widzących etapy sprzedaży — jak lista Eventów) i wyróżnienie zapytań / ofert do wysłania na 72 godziny przed eventem.
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
const EVENT_DAYS = 30;
const EVENTS_LIMIT = 60;
/** Etapy sprzedaży eventu jeszcze niepotwierdzonego (od „Oferta zaakceptowana” event jest potwierdzony — bez dopisku). */
const EVENT_SALES_STAGES: Record<string, string> = {
  inquiry: 'Zapytanie',
  offer_to_send: 'Oferta do wysłania',
  offer_sent: 'Oferta wysłana',
};
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

/** Godzina i minuta czasu polskiego dla chwili `ms` (np. [0, 0] — event zapisany jako sam dzień). */
function warsawClock(ms: number): [number, number] {
  const local = new Date(ms + warsawOffsetMinutes(ms) * MINUTE);
  return [local.getUTCHours(), local.getUTCMinutes()];
}

/** Koniec dnia (północ czasu polskiego po dniu chwili `ms`). */
function warsawDayEnd(ms: number): number {
  const lastMinute = Date.parse(taskDueIso(warsawToday(ms), '23:59') ?? '');
  return Number.isFinite(lastMinute) ? lastMinute + MINUTE : ms + 6 * HOUR;
}

/** Najbliższe eventy: trwające i zaczynające się w ciągu 30 dni (lista Eventów — RLS — i realizacje pracownika), bez anulowanych. */
export async function eventsWidget(ctx: NativeContext) {
  const now = Date.now();
  const generatedAt = new Date(now).toISOString();
  if (!eventsAccess(ctx).canView) return { events: [], total: 0, days: EVENT_DAYS, available: false, generatedAt };
  const from = new Date(now - 7 * DAY).toISOString();
  const to = new Date(now + EVENT_DAYS * DAY).toISOString();
  const [list, mine] = await Promise.all([
    ctx.supabase
      .from('events')
      .select(
        `id,name,event_date,event_end_date,status,location,
         organizations:organizations!events_organization_id_fkey(name,alias),
         contacts(first_name,last_name),
         event_categories(name,color),
         locations(name)`,
      )
      .gte('event_date', from)
      .lt('event_date', to)
      .order('event_date')
      .limit(500),
    ctx.supabase.rpc('get_my_realizations'),
  ]);
  if (list.error) throw list.error;
  const rows = new Map<string, Row>(((list.data || []) as Row[]).map((row) => [String(row.id), row]));
  // Realizacje pracownika (kierownik realizacji) — także te, których lista Eventów nie pokazuje; bez funkcji — sama lista.
  for (const row of (Array.isArray(mine.data) ? mine.data : []) as Row[]) {
    const time = Date.parse(row?.event_date);
    if (!row?.id || rows.has(String(row.id)) || !Number.isFinite(time) || time < now - 7 * DAY || time >= now + EVENT_DAYS * DAY) continue;
    rows.set(String(row.id), { ...row, location: row.location_name });
  }
  // Etapy sprzedaży — jak lista Eventów: osoby bez dostępu do sprzedaży i finansów widzą etapy operacyjne (bez dopisku).
  const sales = !usesOperationalStages({ role: ctx.employee.role, access_level: ctx.employee.accessLevel, permissions: ctx.employee.permissions });
  const events = Array.from(rows.values())
    .flatMap((e) => {
      const status = String(e.status || 'inquiry');
      if (status === 'cancelled') return [];
      const start = Date.parse(e.event_date);
      if (!Number.isFinite(start)) return [];
      const rawEnd = e.event_end_date ? Date.parse(e.event_end_date) : NaN;
      const end = Number.isFinite(rawEnd) && rawEnd > start ? rawEnd : warsawDayEnd(start);
      if (end <= now) return [];
      const [hour, minute] = warsawClock(start);
      const contact = [e.contacts?.first_name, e.contacts?.last_name].filter(Boolean).join(' ');
      return [{
        id: String(e.id),
        title: text(e.name) ?? 'Event',
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
        allDay: hour === 0 && minute === 0,
        color: typeof e.event_categories?.color === 'string' && COLOR.test(e.event_categories.color) ? e.event_categories.color : '#d3bb73',
        location: text(e.locations?.name) ?? text(e.location),
        client: text(e.organizations?.alias) ?? text(e.organizations?.name) ?? text(contact),
        category: text(e.event_categories?.name),
        stage: sales ? EVENT_SALES_STAGES[status] ?? null : null,
        attention: sales && isEventAwaitingOperationalConfirmation({ status, event_date: e.event_date }, new Date(now)),
      }];
    })
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || a.title.localeCompare(b.title, 'pl'));
  return {
    events: events.slice(0, EVENTS_LIMIT),
    total: events.length,
    days: EVENT_DAYS,
    available: true,
    generatedAt,
  };
}
