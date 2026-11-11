import 'server-only';
import type { NativeContext } from './auth';
import { collectionItems, collectionState, invalidateNativeSync } from './sync';

/*
 * Kopia Spotkań na Macu (`/crm/meetings`): wszystkie spotkania widoczne dla pracownika — te same reguły co strona w przeglądarce
 * (RLS: własne, z udziałem pracownika, a dla osób z kalendarzem firmy — firmowe; prywatne widzą tylko autor i uczestnicy).
 * Zmiany (także odpowiedzi uczestników i status) wykrywa skrót treści koszyków (`sync.ts`).
 */

export const MEETINGS_SET = 'meetings';
const PAGE = 1000;

type Row = Record<string, any>;
type Item = { id: string; item: Record<string, unknown> };

const fullName = (value: any) => {
  if (!value || typeof value !== 'object') return '';
  const name = `${value.name ?? ''} ${value.surname ?? ''}`.trim();
  return String(value.nickname || name || '');
};

async function loadMeetings(ctx: NativeContext): Promise<Item[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await ctx.supabase
      .from('meetings')
      .select(
        `id,title,datetime_start,datetime_end,is_all_day,color,notes,location_id,location_text,created_by,is_private,status,
         series_id,recurrence_days,recurrence_index,alert_1_minutes,alert_2_minutes,alert_critical_minutes,related_event_ids,
         location:locations(name),
         creator:employees!meetings_created_by_fkey(name,surname,nickname),
         participants:meeting_participants(id,employee_id,contact_id,response,responded_at,
           employee:employees(name,surname,nickname),
           contact:contacts(first_name,last_name,full_name))`,
      )
      .is('deleted_at', null)
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return rows.map((m) => {
    const participants = ((m.participants || []) as Row[])
      .map((p) => ({
        id: String(p.id),
        employeeId: p.employee_id ?? null,
        contactId: p.contact_id ?? null,
        name: p.employee
          ? fullName(p.employee) || 'Pracownik'
          : String(p.contact?.full_name || `${p.contact?.first_name ?? ''} ${p.contact?.last_name ?? ''}`.trim() || 'Kontakt'),
        response: p.employee_id && p.employee_id === m.created_by ? 'accepted' : String(p.response || 'accepted'),
        respondedAt: p.responded_at ?? null,
      }))
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    return {
      id: String(m.id),
      item: {
        id: String(m.id),
        title: String(m.title || 'Spotkanie'),
        start: m.datetime_start,
        end: m.datetime_end ?? null,
        allDay: !!m.is_all_day,
        color: m.color || '#d3bb73',
        notes: m.notes ?? '',
        locationId: m.location_id ?? null,
        locationText: m.location_text ?? '',
        locationName: m.location?.name ?? '',
        createdBy: m.created_by ?? null,
        creatorName: fullName(m.creator),
        isPrivate: !!m.is_private,
        status: m.status || 'confirmed',
        seriesId: m.series_id ?? null,
        recurrenceDays: Number(m.recurrence_days || 0),
        recurrenceIndex: m.recurrence_index ?? null,
        alert1: m.alert_1_minutes ?? null,
        alert2: m.alert_2_minutes ?? null,
        alertCritical: m.alert_critical_minutes ?? null,
        relatedEventIds: Array.isArray(m.related_event_ids) ? m.related_event_ids : [],
        participants,
      },
    };
  });
}

export const meetingsState = (ctx: NativeContext, hash?: string) => collectionState(ctx, MEETINGS_SET, loadMeetings, hash);
export const meetingsItems = (ctx: NativeContext, buckets: unknown[]) => collectionItems(ctx, MEETINGS_SET, loadMeetings, buckets);
/** Zmiana spotkania widoczna od razu dla wszystkich uczestników (każdy ma własną migawkę zbioru). */
export const invalidateMeetings = () => invalidateNativeSync([MEETINGS_SET]);
